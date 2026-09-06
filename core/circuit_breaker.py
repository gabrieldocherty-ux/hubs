"""
Daily loss circuit breaker - halts new trades once cumulative loss for the
UTC trading day crosses a threshold. This is a hard backstop independent of
whatever the strategy/Kelly sizer thinks is a good idea.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class CircuitBreaker:
    daily_loss_limit_pct: float          # e.g. 0.10 = halt at -10% of day-start capital
    day_start_capital: float = 0.0
    day_start_date: str = ""
    realized_pnl_today: float = 0.0
    tripped: bool = False
    trip_reason: str = ""

    def _today(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")

    def start_day_if_needed(self, current_capital: float) -> None:
        today = self._today()
        if today != self.day_start_date:
            self.day_start_date = today
            self.day_start_capital = current_capital
            self.realized_pnl_today = 0.0
            self.tripped = False
            self.trip_reason = ""

    def record_realized_pnl(self, pnl: float, current_capital: float) -> None:
        self.start_day_if_needed(current_capital)
        self.realized_pnl_today += pnl
        if self.day_start_capital > 0:
            loss_pct = -self.realized_pnl_today / self.day_start_capital
            if loss_pct >= self.daily_loss_limit_pct:
                self.tripped = True
                self.trip_reason = (
                    f"Daily loss {loss_pct:.1%} >= limit {self.daily_loss_limit_pct:.1%}"
                )

    def can_trade(self, current_capital: float) -> bool:
        self.start_day_if_needed(current_capital)
        return not self.tripped

    def manual_reset(self) -> None:
        """Only ever called by Gabe, never by the bot itself."""
        self.tripped = False
        self.trip_reason = ""
