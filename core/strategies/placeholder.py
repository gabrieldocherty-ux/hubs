"""
PLACEHOLDER - not a validated strategy. Exists only so the rest of the
pipeline (backtester, risk manager, executor) has something to run against
end-to-end. Do not point this at real money.

Gabe asked for "proven math/edge" - that means an actual strategy needs
research + backtesting before it goes anywhere near config.json's mode=live.
This file is intentionally simplistic (a naive moving-average cross) so
running the backtester against it will show mediocre/negative results,
which is the honest starting point.
"""

from typing import Optional

from core.strategy_base import Direction, Signal, Strategy


class PlaceholderMACross(Strategy):
    name = "placeholder_ma_cross"

    def __init__(self, fast_period: int = 10, slow_period: int = 30, stop_pct: float = 0.02):
        self.fast_period = fast_period
        self.slow_period = slow_period
        self.stop_pct = stop_pct

    def evaluate(self, market_data: dict) -> Optional[Signal]:
        closes = market_data.get("closes")
        if not closes or len(closes) < self.slow_period + 1:
            return None

        fast_ma = sum(closes[-self.fast_period:]) / self.fast_period
        slow_ma = sum(closes[-self.slow_period:]) / self.slow_period
        prev_fast_ma = sum(closes[-self.fast_period - 1:-1]) / self.fast_period
        prev_slow_ma = sum(closes[-self.slow_period - 1:-1]) / self.slow_period

        price = closes[-1]
        coin = market_data["coin"]

        crossed_up = prev_fast_ma <= prev_slow_ma and fast_ma > slow_ma
        crossed_down = prev_fast_ma >= prev_slow_ma and fast_ma < slow_ma

        if crossed_up:
            stop = price * (1 - self.stop_pct)
            return Signal(coin, Direction.LONG, price, stop, None, "fast MA crossed above slow MA")
        if crossed_down:
            stop = price * (1 + self.stop_pct)
            return Signal(coin, Direction.SHORT, price, stop, None, "fast MA crossed below slow MA")
        return None
