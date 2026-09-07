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

        # 4. Leverage - implied by stop distance, but hard-capped regardless
        stop_distance_pct = abs(request.entry_price - request.stop_loss_price) / request.entry_price
        # Risk 1x the Kelly-approved size in $ terms means leverage is size/margin;
        # this bot always treats size_usd as notional and derives required margin,
        # so leverage is a function of how tight the stop is, capped hard below.
        implied_leverage = max(1, round(1 / max(stop_distance_pct, 0.001)))
        leverage = min(implied_leverage, self.config.max_leverage)

        return ApprovedTrade(
            coin=request.coin,
            is_buy=request.is_buy,
            size_usd=round(size_usd, 2),
            leverage=leverage,
            entry_price=request.entry_price,
            stop_loss_price=request.stop_loss_price,
            take_profit_price=request.take_profit_price,
        )
