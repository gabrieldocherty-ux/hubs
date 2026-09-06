"""
Adaptive parameter selection for the trend-following strategy.

Why shadow evaluation instead of "adjust after every live trade": this
strategy only generates ~40 live trades/year (4h bars), which is nowhere near
enough data to safely retune parameters against its own results without
massively overfitting to noise. Instead, every candidate parameter set is
evaluated on EVERY incoming price bar as a hypothetical ("shadow") position,
using the exact same walk-forward logic as the backtester. That gives each
candidate far more data points to be judged on, and the live bot only ever
switches to whichever candidate has the best real rolling track record - with
a minimum sample size and a cooldown before it's allowed to switch again, so
it can't flap based on a couple of lucky/unlucky bars.

This is "the strategy adjusts itself" done in a way that's statistically
defensible rather than reactive noise-chasing - worth understanding before
changing MIN_SAMPLE_TO_SWITCH or SWITCH_COOLDOWN_BARS below.

State (which variant is active, each candidate's shadow track record) is
persisted via save()/load() - main.py can run as a one-shot `--once`
invocation on a timer, so this accumulated history has to survive between
process runs instead of living only in memory.
"""

from dataclasses import dataclass, field
from typing import List, Optional

from core.state_store import load_json, save_json
from core.strategies.trend_following import SmaCrossTrend
from core.strategy_base import Direction, Signal

MIN_SAMPLE_TO_SWITCH = 15   # shadow trades a candidate needs before it can become active
SWITCH_COOLDOWN_BARS = 30   # bars to wait after a switch before allowing another

# Candidate parameter sets - deliberately a small, sane set (not a fine grid,
# which would just be overfitting with extra steps). (20, 60) is the
# researched/backtested default; the others bracket it.
CANDIDATES = [(10, 30), (20, 60), (30, 90)]


@dataclass
class ShadowPosition:
    direction: str
    entry_price: float


@dataclass
class CandidateTrack:
    fast: int
    slow: int
    strategy: SmaCrossTrend
    shadow_position: Optional[ShadowPosition] = None
    shadow_pnls: List[float] = field(default_factory=list)

    @property
    def variant_name(self) -> str:
        return f"sma_{self.fast}_{self.slow}"

    @property
    def sample_size(self) -> int:
        return len(self.shadow_pnls)

    @property
    def expectancy(self) -> float:
        return sum(self.shadow_pnls) / len(self.shadow_pnls) if self.shadow_pnls else float("-inf")


class AdaptiveTrendStrategy:
    # SMA(20,60) on 4h is the trend expression, so it draws on the MACRO
    # allocation even though it holds for days rather than months.
    sleeve = "macro"
    """Implements the same Strategy interface (evaluate()) as any other
    strategy, so main.py/executor.py don't need to know adaptation is
    happening underneath."""

    name = "adaptive_sma_cross"

    def __init__(self):
        self.candidates = [
            CandidateTrack(fast=f, slow=s, strategy=SmaCrossTrend(fast_period=f, slow_period=s))
            for f, s in CANDIDATES
        ]
        self.active_index = 1  # start on the researched (20, 60) default
        self.bars_since_switch = 0
        self.switch_log: List[str] = []

    def _update_shadows(self, market_data: dict) -> None:
        price = market_data["closes"][-1]
        for c in self.candidates:
            if c.shadow_position is None:
                signal = c.strategy.evaluate(market_data)
                if signal is not None:
                    c.shadow_position = ShadowPosition(signal.direction.value, signal.entry_price)
            else:
                # Close the shadow position on an opposite signal (mirrors backtester logic)
                signal = c.strategy.evaluate(market_data)
                if signal is not None and signal.direction.value != c.shadow_position.direction:
                    entry = c.shadow_position.entry_price
                    pnl = (
                        (price - entry) / entry
                        if c.shadow_position.direction == "long"
                        else (entry - price) / entry
                    )
                    c.shadow_pnls.append(pnl)
                    c.shadow_pnls = c.shadow_pnls[-100:]  # bounded rolling window
                    c.shadow_position = ShadowPosition(signal.direction.value, price)

    def _maybe_switch_active(self) -> None:
        self.bars_since_switch += 1
        if self.bars_since_switch < SWITCH_COOLDOWN_BARS:
            return

        eligible = [c for c in self.candidates if c.sample_size >= MIN_SAMPLE_TO_SWITCH]
        if not eligible:
            return

        best = max(eligible, key=lambda c: c.expectancy)
        best_idx = self.candidates.index(best)
        if best_idx != self.active_index and best.expectancy > self.candidates[self.active_index].expectancy:
            old = self.candidates[self.active_index]
            self.switch_log.append(
                f"Switched active variant {old.variant_name} (expectancy {old.expectancy:.3%}, "
                f"n={old.sample_size}) -> {best.variant_name} (expectancy {best.expectancy:.3%}, n={best.sample_size})"
            )
            self.active_index = best_idx
            self.bars_since_switch = 0

    def evaluate(self, market_data: dict) -> Optional[Signal]:
        self._update_shadows(market_data)
        self._maybe_switch_active()
        active = self.candidates[self.active_index]
        signal = active.strategy.evaluate(market_data)
        if signal is not None:
            signal.confidence = f"[{active.variant_name}, active by shadow-eval] {signal.confidence}"
        return signal

    @property
    def active_variant_name(self) -> str:
        return self.candidates[self.active_index].variant_name

    # --- persistence -----------------------------------------------------
    def to_dict(self) -> dict:
        return {
            "active_index": self.active_index,
            "bars_since_switch": self.bars_since_switch,
            "switch_log": self.switch_log[-20:],  # bounded - this is a log, not a ledger
            "candidates": [
                {
                    "fast": c.fast,
                    "slow": c.slow,
                    "shadow_position": (
                        {"direction": c.shadow_position.direction, "entry_price": c.shadow_position.entry_price}
                        if c.shadow_position else None
                    ),
                    "shadow_pnls": c.shadow_pnls,
                }
                for c in self.candidates
            ],
        }

    def _load_dict(self, data: dict) -> None:
        self.active_index = data.get("active_index", self.active_index)
        self.bars_since_switch = data.get("bars_since_switch", 0)
        self.switch_log = data.get("switch_log", [])
        saved_candidates = {(c["fast"], c["slow"]): c for c in data.get("candidates", [])}
        for c in self.candidates:
            saved = saved_candidates.get((c.fast, c.slow))
            if not saved:
                continue
            c.shadow_pnls = saved.get("shadow_pnls", [])
            sp = saved.get("shadow_position")
            c.shadow_position = ShadowPosition(sp["direction"], sp["entry_price"]) if sp else None

    def save(self, path: str) -> None:
        save_json(path, self.to_dict())

    @classmethod
    def load_or_new(cls, path: str) -> "AdaptiveTrendStrategy":
        strategy = cls()
        data = load_json(path, None)
        if data:
            strategy._load_dict(data)
        return strategy
