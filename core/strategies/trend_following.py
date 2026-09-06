"""
SMA(fast)/SMA(slow) crossover trend-following strategy on 4h bars.

Status: CANDIDATE, not proven. Backtested on 1 year of real Hyperliquid BTC
and ETH 4h data (2026-09-04 research pass): positive cost-inclusive
expectancy on BOTH a 60/40 train/test split, on both assets - that's real
signal it's not pure noise, but it's a small sample (~40 trades/asset/year)
from a mostly-trending market regime, and it does NOT yet account for
perpetual funding rate cost, which matters for a strategy that holds
multi-day directional exposure. Treat this as the leading candidate to keep
validating (more history, funding-inclusive costs, other regimes), not as
settled.

See Desktop/Claude-Brain/Projects/Crypto-Trading.md for the full research
notes and Projects/Lessons-Learned.md as this gets more trade history.
"""

from typing import Optional

from core.strategy_base import Direction, Signal, Strategy


class SmaCrossTrend(Strategy):
    name = "sma_cross_trend"

    def __init__(self, fast_period: int = 20, slow_period: int = 60, stop_pct: float = 0.03):
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
            return Signal(coin, Direction.LONG, price, stop, None,
                          f"SMA{self.fast_period}/{self.slow_period} crossed up (candidate strategy, see Crypto-Trading.md)")
        if crossed_down:
            stop = price * (1 + self.stop_pct)
            return Signal(coin, Direction.SHORT, price, stop, None,
                          f"SMA{self.fast_period}/{self.slow_period} crossed down (candidate strategy, see Crypto-Trading.md)")
        return None
