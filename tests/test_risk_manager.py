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


# --------------------------------------------------------------------------
# Leverage must keep the STOP inside the liquidation price. The old formula
# (leverage = 1/stop_distance) put the stop one full unit of initial margin
# away, but liquidation happens at partial margin loss - so liquidation always
# came first and the mandatory stop would never have fired on a live position.
# --------------------------------------------------------------------------

def liquidation_distance(leverage, asset_max_leverage=10, maintenance_fraction=0.5):
    """How far price must move against the position before the exchange
    force-closes it.

    Hyperliquid sets maintenance margin at half the initial margin AT THE ASSET
    MAX LEVERAGE, so the maintenance RATE is a property of the coin, not of the
    leverage chosen:
        maintenance_rate     = maintenance_fraction / asset_max_leverage
        liquidation_distance = 1/leverage - maintenance_rate
    """
    return 1.0 / leverage - maintenance_fraction / asset_max_leverage


def test_stop_always_sits_inside_liquidation():
    """The property that matters, checked across the real range of stop widths
    seen on these coins (BTC ~8% up to HYPE ~45% at the 99th percentile)."""
    rm = make_risk_manager()
    for stop_pct in (0.02, 0.05, 0.08, 0.12, 0.15, 0.20, 0.30, 0.45):
        entry = 100.0
        approved = rm.approve_trade(
            TradeRequest("BTC", True, entry, entry * (1 - stop_pct), None, 100),
            account_capital=1000, current_total_exposure_usd=0)
        liq = liquidation_distance(approved.leverage)
        assert liq > stop_pct, (
            "stop {:.1%} sits beyond liquidation {:.1%} at {}x leverage".format(
                stop_pct, liq, approved.leverage))


def test_liquidation_keeps_a_two_times_buffer_where_physically_possible():
    """Not merely inside liquidation - comfortably inside, so a gap through the
    stop still exits near a chosen price instead of being force-closed.

    There is still a hard floor: at 1x leverage on a 10x-max asset, liquidation
    sits at 1/1 - 0.05 = 95% away, so a stop wider than 47.5% cannot have a 2x
    buffer at any leverage. That is physics, not a bug - and the right behaviour
    there is to pin leverage at its minimum, which is what is asserted.
    """
    rm = make_risk_manager()
    for stop_pct in (0.05, 0.10, 0.20, 0.30, 0.45):
        entry = 100.0
        approved = rm.approve_trade(
            TradeRequest("BTC", True, entry, entry * (1 - stop_pct), None, 100),
            account_capital=1000, current_total_exposure_usd=0)
        liq = liquidation_distance(approved.leverage)
        if liq >= 2 * stop_pct * 0.999:
            continue
        assert approved.leverage == 1, (
            "no 2x buffer available at stop {:.0%}, so leverage must be pinned to "
            "1x, got {}x".format(stop_pct, approved.leverage))
        assert liq > stop_pct, (
            "even at 1x the stop {:.0%} sits beyond liquidation {:.0%} - this "
            "stop is too wide to protect at any leverage".format(stop_pct, liq))


def test_wider_stops_get_lower_leverage():
    """A wider stop needs liquidation further away, which means less leverage.
    The old formula did the opposite of this."""
    rm = make_risk_manager()
    levs = []
    for stop_pct in (0.03, 0.08, 0.15, 0.30):
        approved = rm.approve_trade(
            TradeRequest("BTC", True, 100.0, 100.0 * (1 - stop_pct), None, 100),
            account_capital=1000, current_total_exposure_usd=0)
        levs.append(approved.leverage)
    assert levs == sorted(levs, reverse=True), levs


def test_leverage_never_below_one_or_above_the_ceiling():
    rm = make_risk_manager(max_leverage=10)
    for stop_pct in (0.001, 0.01, 0.50, 0.90):
        approved = rm.approve_trade(
            TradeRequest("BTC", True, 100.0, 100.0 * (1 - stop_pct), None, 100),
            account_capital=1000, current_total_exposure_usd=0)
        assert 1 <= approved.leverage <= 10


# --------------------------------------------------------------------------
# Conviction sizing. Scales position size by signal strength, bounded. The
# bounds are load-bearing: without a floor a weak signal sizes under the $10
# minimum and gets SKIPPED, which silently turns a sizing rule into an entry
# filter; without a ceiling one strong signal can consume the book.
# --------------------------------------------------------------------------

def make_conviction_rm(baseline=1.5):
    config = RiskConfig(
        max_leverage=10, max_position_pct_of_capital=0.20, kelly_fraction=0.25,
        kelly_min_edge=0.02, kelly_max_size_multiplier=2.0,
        daily_loss_breaker_pct=0.10, require_stop_loss=True)
    return RiskManager(
        config, KellySizer(kelly_fraction=0.25, min_edge=0.02, max_size_multiplier=2.0),
        CircuitBreaker(daily_loss_limit_pct=0.10),
        conviction_sizing=True, conviction_baseline=baseline)


def _sized(rm, strength, base=100.0, capital=10000):
    return rm.approve_trade(
        TradeRequest("BTC", True, 50000, 48500, None, base, strength=strength),
        account_capital=capital, current_total_exposure_usd=0).size_usd


def test_stronger_signals_get_more_size():
    rm = make_conviction_rm()
    sizes = [_sized(rm, s) for s in (1.0, 1.5, 2.0, 2.5)]
    assert sizes == sorted(sizes), sizes
    assert sizes[0] < sizes[-1]


def test_average_strength_gets_the_base_size():
    """A baseline-strength signal must be unchanged, or the whole book is
    silently resized when this is switched on."""
    rm = make_conviction_rm(baseline=1.5)
    assert abs(_sized(rm, 1.5) - 100.0) < 0.01


def test_scaling_is_bounded_at_both_ends():
    rm = make_conviction_rm(baseline=1.5)
    assert abs(_sized(rm, 0.01) - 50.0) < 0.01, "floor must hold at 0.5x"
    assert abs(_sized(rm, 99.0) - 200.0) < 0.01, "ceiling must hold at 2.0x"


def test_missing_strength_is_sized_normally():
    """A strategy that does not report strength must not be penalised."""
    rm = make_conviction_rm()
    assert abs(_sized(rm, None) - 100.0) < 0.01


def test_disabled_by_default():
    """Switching this on is a deliberate act, not a side effect of an upgrade."""
    rm = make_risk_manager()
    approved = rm.approve_trade(
        TradeRequest("BTC", True, 50000, 48500, None, 100, strength=3.0),
        account_capital=10000, current_total_exposure_usd=0)
    assert abs(approved.size_usd - 100.0) < 0.01


def test_conviction_never_breaches_the_position_cap():
    """A 2x scale-up must still be caught by the 20%-of-capital rail."""
    rm = make_conviction_rm()
    size = _sized(rm, 5.0, base=200.0, capital=1000)
    assert size <= 200.0, "20% of $1000 is $200"
