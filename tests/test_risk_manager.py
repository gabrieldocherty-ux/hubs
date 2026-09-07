import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import RiskConfig
from core.circuit_breaker import CircuitBreaker
from core.kelly import KellySizer
from core.risk_manager import RiskManager, RiskRejection, TradeRequest


def make_risk_manager(**overrides):
    defaults = dict(
        max_leverage=10,
        max_position_pct_of_capital=0.20,
        kelly_fraction=0.25,
        kelly_min_edge=0.02,
        kelly_max_size_multiplier=2.0,
        daily_loss_breaker_pct=0.10,
        require_stop_loss=True,
    )
    defaults.update(overrides)
    config = RiskConfig(**defaults)
    kelly = KellySizer(kelly_fraction=config.kelly_fraction, min_edge=config.kelly_min_edge, max_size_multiplier=config.kelly_max_size_multiplier)
    breaker = CircuitBreaker(daily_loss_limit_pct=config.daily_loss_breaker_pct)
    return RiskManager(config, kelly, breaker)


def test_rejects_trade_without_stop_loss():
    rm = make_risk_manager()
    request = TradeRequest("BTC", True, 50000, None, None, 100)
    try:
        rm.approve_trade(request, account_capital=1000, current_total_exposure_usd=0)
        assert False, "should have rejected"
    except RiskRejection:
        pass


def test_caps_position_size_to_max_pct():
    rm = make_risk_manager(max_position_pct_of_capital=0.10)
    request = TradeRequest("BTC", True, 50000, 49000, 52000, base_size_usd=5000)
    approved = rm.approve_trade(request, account_capital=1000, current_total_exposure_usd=0)
    assert approved.size_usd <= 100, f"expected <= 10% of 1000 capital, got {approved.size_usd}"


def test_caps_leverage_to_configured_max():
    rm = make_risk_manager(max_leverage=5)
    # very tight stop implies very high leverage from the naive formula - must be clamped
    request = TradeRequest("BTC", True, 50000, 49900, 50200, base_size_usd=100)
    approved = rm.approve_trade(request, account_capital=1000, current_total_exposure_usd=0)
    assert approved.leverage <= 5, f"leverage should be capped at 5, got {approved.leverage}"


def test_circuit_breaker_blocks_new_trades_once_tripped():
    rm = make_risk_manager(daily_loss_breaker_pct=0.10)
    rm.breaker.record_realized_pnl(pnl=-150, current_capital=1000)  # -15% > 10% limit
    request = TradeRequest("BTC", True, 50000, 49000, 52000, base_size_usd=100)
    try:
        rm.approve_trade(request, account_capital=850, current_total_exposure_usd=0)
        assert False, "should have rejected due to tripped breaker"
    except RiskRejection:
        pass


if __name__ == "__main__":
    test_rejects_trade_without_stop_loss()
    test_caps_position_size_to_max_pct()
    test_caps_leverage_to_configured_max()
    test_circuit_breaker_blocks_new_trades_once_tripped()
    print("All risk_manager tests passed.")


# --------------------------------------------------------------------------
# Sleeve allocation (the 75% daily / 25% macro split) and the $10 exchange
# minimum. Both live in the risk manager rather than the strategy layer, so a
# family cannot exceed its allocation just by adding another strategy to itself.
# --------------------------------------------------------------------------

ALLOC = {"daily": 0.75, "macro": 0.25}


def make_allocated_rm(**overrides):
    defaults = dict(
        max_leverage=10,
        max_position_pct_of_capital=0.20,
        kelly_fraction=0.25,
        kelly_min_edge=0.02,
        kelly_max_size_multiplier=2.0,
        daily_loss_breaker_pct=0.10,
        require_stop_loss=True,
    )
    defaults.update(overrides)
    config = RiskConfig(**defaults)
    kelly = KellySizer(kelly_fraction=config.kelly_fraction,
                       min_edge=config.kelly_min_edge,
                       max_size_multiplier=config.kelly_max_size_multiplier)
    breaker = CircuitBreaker(daily_loss_limit_pct=config.daily_loss_breaker_pct)
    return RiskManager(config, kelly, breaker, allocation=ALLOC)


def test_macro_sleeve_cannot_exceed_its_allocation():
    """25% of $1000 is $250. A macro trade with $245 already open may only take
    the remaining $5 - and $5 is under the exchange minimum, so it is rejected."""
    rm = make_allocated_rm()
    req = TradeRequest("BTC", True, 50000, 48500, None, 100, sleeve="macro")
    try:
        rm.approve_trade(req, account_capital=1000,
                         current_total_exposure_usd=245, sleeve_exposure_usd=245)
        assert False, "should have rejected - macro sleeve is full"
    except RiskRejection as e:
        assert "minimum" in str(e) or "sleeve" in str(e)


def test_macro_sleeve_full_rejects_outright():
    rm = make_allocated_rm()
    req = TradeRequest("BTC", True, 50000, 48500, None, 100, sleeve="macro")
    try:
        rm.approve_trade(req, account_capital=1000,
                         current_total_exposure_usd=250, sleeve_exposure_usd=250)
        assert False, "should have rejected"
    except RiskRejection as e:
        assert "sleeve" in str(e)


def test_daily_sleeve_has_room_where_macro_does_not():
    """The same $200 of open exposure is fine for daily (cap $750) and fatal
    for macro (cap $250) - which is the whole point of the split."""
    rm = make_allocated_rm()
    ok = rm.approve_trade(
        TradeRequest("BTC", True, 50000, 48500, None, 100, sleeve="daily"),
        account_capital=1000, current_total_exposure_usd=200, sleeve_exposure_usd=200)
    assert ok.size_usd > 0

    tight = rm.approve_trade(
        TradeRequest("BTC", True, 50000, 48500, None, 100, sleeve="macro"),
        account_capital=1000, current_total_exposure_usd=200, sleeve_exposure_usd=200)
    assert tight.size_usd == 50, "macro should be trimmed to the $250 sleeve cap"


def test_sleeve_cap_trims_rather_than_rejects_when_room_remains():
    rm = make_allocated_rm()
    approved = rm.approve_trade(
        TradeRequest("BTC", True, 50000, 48500, None, 100, sleeve="macro"),
        account_capital=1000, current_total_exposure_usd=170, sleeve_exposure_usd=170)
    assert approved.size_usd == 80


def test_below_exchange_minimum_is_rejected_not_silently_shrunk():
    """A $6 order is refused by Hyperliquid. Catching it here makes the skipped
    trade visible instead of surfacing as an opaque exchange error."""
    rm = make_allocated_rm()
    req = TradeRequest("BTC", True, 50000, 48500, None, 6, sleeve="daily")
    try:
        rm.approve_trade(req, account_capital=1000, current_total_exposure_usd=0)
        assert False, "should have rejected an order under the $10 minimum"
    except RiskRejection as e:
        assert "minimum" in str(e)


def test_unknown_sleeve_defaults_to_unrestricted_not_zero():
    """A strategy that forgets to declare a sleeve must not be silently blocked
    from trading - it falls back to the other rails, which still bind."""
    rm = RiskManager(*_bare_parts())
    approved = rm.approve_trade(
        TradeRequest("BTC", True, 50000, 48500, None, 100, sleeve="unlabelled"),
        account_capital=1000, current_total_exposure_usd=0)
    assert approved.size_usd > 0


def _bare_parts():
    config = RiskConfig(
        max_leverage=10, max_position_pct_of_capital=0.20, kelly_fraction=0.25,
        kelly_min_edge=0.02, kelly_max_size_multiplier=2.0,
        daily_loss_breaker_pct=0.10, require_stop_loss=True)
    return (config,
            KellySizer(kelly_fraction=0.25, min_edge=0.02, max_size_multiplier=2.0),
            CircuitBreaker(daily_loss_limit_pct=0.10))


# --------------------------------------------------------------------------
# Net directional exposure. Every other rail is blind to correlation: it caps
# each trade and each family, so four aligned positions and four offsetting
# ones look identical - though the first is 4x one bet. On a venue where the
# majors move together, that distinction is the whole risk.
# --------------------------------------------------------------------------

def make_net_rm(cap=0.50):
    config = RiskConfig(
        max_leverage=10, max_position_pct_of_capital=0.20, kelly_fraction=0.25,
        kelly_min_edge=0.02, kelly_max_size_multiplier=2.0,
        daily_loss_breaker_pct=0.10, require_stop_loss=True,
        max_net_exposure_pct=cap)
    return RiskManager(
        config,
        KellySizer(kelly_fraction=0.25, min_edge=0.02, max_size_multiplier=2.0),
        CircuitBreaker(daily_loss_limit_pct=0.10))


def test_adding_to_a_one_sided_book_is_capped():
    """$1000 capital, 50% cap = $500 net. Already $480 long, so a new $100 long
    may only take the remaining $20."""
    rm = make_net_rm()
    approved = rm.approve_trade(
        TradeRequest("BTC", True, 50000, 48500, None, 100),
        account_capital=1000, current_total_exposure_usd=480, net_exposure_usd=480)
    assert approved.size_usd == 20


def test_full_one_sided_book_rejects_outright():
    rm = make_net_rm()
    try:
        rm.approve_trade(
            TradeRequest("BTC", True, 50000, 48500, None, 100),
            account_capital=1000, current_total_exposure_usd=500, net_exposure_usd=500)
        assert False, "should have rejected - book is at its net cap and leaning long"
    except RiskRejection as e:
        assert "net directional" in str(e)


def test_offsetting_trade_is_always_allowed():
    """The rail must never block a trade that REDUCES the imbalance - otherwise
    a leaning book could not be hedged back toward neutral."""
    rm = make_net_rm()
    approved = rm.approve_trade(
        TradeRequest("BTC", False, 50000, 51500, None, 100),   # short against a long book
        account_capital=1000, current_total_exposure_usd=600, net_exposure_usd=600)
    assert approved.size_usd == 100


def test_short_side_is_capped_symmetrically():
    rm = make_net_rm()
    approved = rm.approve_trade(
        TradeRequest("BTC", False, 50000, 51500, None, 100),
        account_capital=1000, current_total_exposure_usd=480, net_exposure_usd=-480)
    assert approved.size_usd == 20


def test_balanced_book_is_not_restricted():
    """Four positions offsetting each other are not one bet, and must not be
    treated as though they were."""
    rm = make_net_rm()
    approved = rm.approve_trade(
        TradeRequest("BTC", True, 50000, 48500, None, 100),
        account_capital=1000, current_total_exposure_usd=800, net_exposure_usd=0)
    assert approved.size_usd == 100


def test_cap_disabled_when_unset():
    """Older configs without the field must keep working unchanged."""
    config = RiskConfig(
        max_leverage=10, max_position_pct_of_capital=0.20, kelly_fraction=0.25,
        kelly_min_edge=0.02, kelly_max_size_multiplier=2.0,
        daily_loss_breaker_pct=0.10, require_stop_loss=True,
        max_net_exposure_pct=0.0)
    rm = RiskManager(config,
                     KellySizer(kelly_fraction=0.25, min_edge=0.02, max_size_multiplier=2.0),
                     CircuitBreaker(daily_loss_limit_pct=0.10))
    approved = rm.approve_trade(
        TradeRequest("BTC", True, 50000, 48500, None, 100),
        account_capital=1000, current_total_exposure_usd=900, net_exposure_usd=900)
    assert approved.size_usd == 100
