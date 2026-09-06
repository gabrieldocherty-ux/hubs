"""
Fractional Kelly position sizing, adapted from the Polymarket-bot's core/kelly.py
for perpetuals (size expressed as $ notional, capped by a leverage ceiling
elsewhere in risk_manager.py - this module only answers "how much edge-adjusted
capital should this trade risk", not "how much leverage to use").

f* = (p * b - q) / b
  p = probability of winning (from strategy's tracked win rate)
  q = 1 - p
  b = odds = avg_win / avg_loss

Full Kelly assumes your edge estimate is exact, which it never is - so this
always applies `kelly_fraction` (default 0.25, i.e. quarter-Kelly) and a hard
multiplier cap vs a base size, matching the conservative defaults already used
in Polymarket-bot.
"""

from collections import deque
from dataclasses import dataclass, field


@dataclass
class TradeOutcome:
    won: bool
    pnl: float


@dataclass
class KellySizer:
    kelly_fraction: float = 0.25
    min_edge: float = 0.02
    max_size_multiplier: float = 2.0
    lookback_trades: int = 50
    _history: deque = field(default_factory=lambda: deque(maxlen=50))

    def __post_init__(self):
        self._history = deque(maxlen=self.lookback_trades)

    def record_outcome(self, outcome: TradeOutcome) -> None:
        self._history.append(outcome)

    def has_enough_data(self) -> bool:
        return len(self._history) >= max(20, self.lookback_trades // 2)

    def _stats(self):
        wins = [t.pnl for t in self._history if t.won]
        losses = [-t.pnl for t in self._history if not t.won]
        p = len(wins) / len(self._history) if self._history else 0.0
        avg_win = sum(wins) / len(wins) if wins else 0.0
        avg_loss = sum(losses) / len(losses) if losses else 0.0
        return p, avg_win, avg_loss

    def kelly_fraction_of_capital(self) -> float:
        """
        Returns the fraction of capital to risk on the next trade, already
        scaled by kelly_fraction. Returns 0 if there isn't enough trade
        history yet or the measured edge is below min_edge - in both cases
        the caller should fall back to a small fixed base size, not zero.
        """
        if not self.has_enough_data():
            return 0.0

        p, avg_win, avg_loss = self._stats()
        if avg_loss <= 0:
            return 0.0
        b = avg_win / avg_loss
        q = 1 - p
        f_star = (p * b - q) / b if b > 0 else 0.0

        edge = p * avg_win - q * avg_loss
        if edge < self.min_edge or f_star <= 0:
            return 0.0

        return max(0.0, f_star * self.kelly_fraction)

    def size_trade(self, capital: float, base_size: float) -> float:
        """
        capital: total capital allocated to this strategy
        base_size: fallback $ size to use when there's no Kelly data yet
        Returns the $ notional to risk on this trade, before any leverage
        or hard-ceiling checks in risk_manager.py.
        """
        kelly_frac = self.kelly_fraction_of_capital()
        if kelly_frac <= 0:
            return base_size
        kelly_size = capital * kelly_frac
        return min(kelly_size, base_size * self.max_size_multiplier)
