"""
The single place all sizing/leverage/stop-loss decisions must pass through.
Nothing else in this codebase should place an order without going through
RiskManager.approve_trade() first - that's what makes the hard ceilings
actually hard rather than advisory.
"""

from dataclasses import dataclass
from typing import Optional

from config.settings import RiskConfig
from core.circuit_breaker import CircuitBreaker
from core.kelly import KellySizer


@dataclass
class TradeRequest:
    coin: str
    is_buy: bool
    entry_price: float
    stop_loss_price: float
    take_profit_price: Optional[float]
    base_size_usd: float          # fallback size before Kelly/ceilings applied
    sleeve: str = "daily"         # which strategy family this belongs to
    asset_max_leverage: Optional[int] = None   # the VENUE's cap for this coin


@dataclass
class ApprovedTrade:
    coin: str
    is_buy: bool
    size_usd: float
    leverage: int
    entry_price: float
    stop_loss_price: float
    take_profit_price: Optional[float]


class RiskRejection(Exception):
    pass


MIN_ORDER_USD = 10.0   # Hyperliquid rejects anything smaller

# Hyperliquid sets maintenance margin at "half of the initial margin at max
# leverage" - verified against the docs and the venue's own margin tables. The
# critical word is AT MAX LEVERAGE: the maintenance rate is a property of the
# ASSET, not of the leverage the trader picks.
#
#     maintenance_rate = MAINTENANCE_FRACTION / asset_max_leverage
#
# which on 2026-09-07 gives 1.25% for BTC (40x), 2.00% for ETH (25x), 2.50% for
# SOL (20x) and 5.00% for HYPE (10x).
#
# An earlier version of this file modelled liquidation as MAINTENANCE_FRACTION/L,
# treating maintenance as half of the CHOSEN margin. That was wrong, though wrong
# in the safe direction - it put liquidation nearer than it really is and so used
# less leverage than necessary, tying up $146 of a $250 account in margin at full
# book instead of $75.
MAINTENANCE_FRACTION = 0.5
# Fallback when the venue's cap for a coin is unknown. 10x is the most
# conservative assumption among the coins traded here, since a LOWER max leverage
# implies a HIGHER maintenance rate and therefore nearer liquidation.
DEFAULT_ASSET_MAX_LEVERAGE = 10
# How much further away liquidation must sit than the stop. 2x means a gap
# straight through the stop still exits near a chosen price rather than being
# force-closed by the exchange.
LIQUIDATION_BUFFER = 2.0


class RiskManager:
    def __init__(self, config: RiskConfig, kelly: KellySizer, breaker: CircuitBreaker,
                 allocation: Optional[dict] = None):
        self.config = config
        self.kelly = kelly
        self.breaker = breaker
        # Share of total capital each strategy family may hold as OPEN NOTIONAL.
        # This is an exposure cap, not a separate pot to size against - see
        # config/settings.json for why that distinction matters at $250 capital.
        self.allocation = allocation or {"daily": 1.0, "macro": 1.0}

    def approve_trade(
        self,
        request: TradeRequest,
        account_capital: float,
        current_total_exposure_usd: float,
        sleeve_exposure_usd: float = 0.0,
        net_exposure_usd: float = 0.0,
    ) -> ApprovedTrade:
        # 1. Circuit breaker - absolute veto, checked first
        if not self.breaker.can_trade(account_capital):
            raise RiskRejection(f"Circuit breaker tripped: {self.breaker.trip_reason}")

        # 2. Stop-loss is mandatory, full stop
        if self.config.require_stop_loss and request.stop_loss_price is None:
            raise RiskRejection("No stop-loss on trade request - refusing to place a naked position")

        # 3. Size: Kelly-adjusted, falling back to base size, then hard-capped
        size_usd = self.kelly.size_trade(account_capital, request.base_size_usd)
        max_position_usd = account_capital * self.config.max_position_pct_of_capital
        size_usd = min(size_usd, max_position_usd)

        # 3b. Sleeve cap - the 75/25 daily/macro split. Enforced here rather than
        # in the strategy layer so a family cannot quietly exceed its allocation
        # by adding another strategy to itself.
        sleeve_weight = float(self.allocation.get(request.sleeve, 1.0) or 0.0)
        sleeve_cap = account_capital * sleeve_weight
        if sleeve_exposure_usd + size_usd > sleeve_cap:
            size_usd = max(0.0, sleeve_cap - sleeve_exposure_usd)
            if size_usd <= 0:
                raise RiskRejection(
                    "{} sleeve is at its {:.0%} allocation "
                    "(${:.2f} of ${:.2f} used)".format(
                        request.sleeve, sleeve_weight, sleeve_exposure_usd, sleeve_cap))

        # 3c. NET DIRECTIONAL exposure. Every other rail here is blind to
        # correlation: it caps each trade and each family, so four positions all
        # long and four positions offsetting each other look identical - even
        # though the first is 4x one bet. On a venue where the majors move
        # together that is the difference between a normal day and a breaker
        # trip. Measured 2026-09-07: the book reached 58% net one-way, where a
        # correlated gap day costs ~9.4% of capital against a 10% daily breaker.
        net_cap_pct = getattr(self.config, "max_net_exposure_pct", None)
        if net_cap_pct:
            signed = size_usd if request.is_buy else -size_usd
            projected = net_exposure_usd + signed
            cap = account_capital * net_cap_pct
            # only block when the trade makes the imbalance WORSE - a trade that
            # offsets an existing lean should always be allowed through
            if abs(projected) > cap and abs(projected) > abs(net_exposure_usd):
                room = max(0.0, cap - abs(net_exposure_usd))
                if room < MIN_ORDER_USD:
                    raise RiskRejection(
                        "net directional exposure would reach ${:.2f} against a "
                        "${:.2f} cap ({:.0%} of capital) - the book is already "
                        "leaning {} and this adds to it".format(
                            abs(projected), cap, net_cap_pct,
                            "long" if net_exposure_usd > 0 else "short"))
                size_usd = min(size_usd, room)

        if current_total_exposure_usd + size_usd > account_capital * 1.0:
            # Never let total exposure across positions exceed 1x capital at
            # notional-before-leverage level; leverage is applied on top of
            # this, bounded separately below.
            size_usd = max(0.0, account_capital - current_total_exposure_usd)

        if size_usd <= 0:
            raise RiskRejection("No capital available for this trade under current exposure limits")

        # Below the exchange minimum the order is REFUSED, not filled smaller -
        # so the trade is skipped entirely. Rejecting it here makes that visible
        # instead of letting it surface as an opaque exchange error, and it is
        # worth noticing: systematically skipping trades after a losing run (when
        # Kelly has scaled size down) is a different strategy from the validated
        # one, not a more cautious version of it.
        if size_usd < MIN_ORDER_USD:
            raise RiskRejection(
                "sized to ${:.2f}, below Hyperliquid's ${:.0f} minimum order - "
                "skipping rather than sending an order that would be rejected".format(
                    size_usd, MIN_ORDER_USD))

        # 4. Leverage - chosen so the STOP fires before the exchange liquidates.
        #
        # This previously set leverage = 1 / stop_distance, which puts the stop
        # exactly one unit of initial margin away. That is backwards: liquidation
        # happens at PARTIAL margin loss (maintenance margin is roughly half the
        # initial requirement), so liquidation always arrived FIRST. Measured
        # 2026-09-07 against real ATR: the stop sat beyond the liquidation price
        # on 96% of BTC bars, 99% of ETH, and 100% of SOL and HYPE. The
        # mandatory stop-loss - this project's most-repeated safety rail - would
        # not have fired on a live position; the liquidation engine would have,
        # at whatever price the book offered, taking the whole margin.
        #
        # Correct direction: liquidation distance must be a MULTIPLE of the stop
        # distance. With maintenance at ~half of initial,
        #     liquidation distance ~= 0.5 / L
        # and requiring that to be at least LIQUIDATION_BUFFER times the stop:
        #     L <= 0.5 / (buffer * stop_distance)
        #
        # Leverage costs nothing to lower here. P&L is computed on NOTIONAL, so
        # leverage changes only how much margin is posted and therefore how far
        # away the forced-liquidation price sits - never how much a move earns
        # or loses. Lower is strictly safer and gives up no return.
        # Liquidation happens when equity falls below the maintenance requirement:
        #     margin posted (notional/L) + PnL  <  maintenance_rate * notional
        # so the adverse move that liquidates is
        #     liquidation_distance = 1/L - maintenance_rate
        # Requiring that to be at least LIQUIDATION_BUFFER times the stop gives
        #     L <= 1 / (buffer * stop_distance + maintenance_rate)
        stop_distance_pct = abs(request.entry_price - request.stop_loss_price) / request.entry_price
        asset_lev = request.asset_max_leverage or DEFAULT_ASSET_MAX_LEVERAGE
        maintenance_rate = MAINTENANCE_FRACTION / max(1, asset_lev)
        denom = LIQUIDATION_BUFFER * max(stop_distance_pct, 0.001) + maintenance_rate
        safe_leverage = int(1.0 / denom) if denom > 0 else 1
        leverage = max(1, min(safe_leverage, self.config.max_leverage, asset_lev))

        return ApprovedTrade(
            coin=request.coin,
            is_buy=request.is_buy,
            size_usd=round(size_usd, 2),
            leverage=leverage,
            entry_price=request.entry_price,
            stop_loss_price=request.stop_loss_price,
            take_profit_price=request.take_profit_price,
        )
