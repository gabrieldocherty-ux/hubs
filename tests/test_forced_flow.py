"""
Tests for the forced-flow strategies.

Two things matter here: that the strategies fire only when their stated
condition is met, and that EVERY signal carries a stop-loss. The second is a
project safety rail - a strategy that can return a signal without a stop would
be rejected by RiskManager at runtime, but it should never get that far.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.strategies.forced_flow import ForcedFlowContinuation, RangeBreakCascade
from core.strategy_base import Direction


def make_bars(n=60, price=100.0, vol=1000.0, spread=1.0):
    """Flat, quiet market: no signal should ever fire on this."""
    return [{"t": i * 86400000, "o": price, "h": price + spread,
             "l": price - spread, "c": price, "v": vol} for i in range(n)]


def test_no_signal_in_quiet_market():
    bars = make_bars()
    assert ForcedFlowContinuation().evaluate({"coin": "BTC", "bars": bars}) is None
    assert RangeBreakCascade().evaluate({"coin": "BTC", "bars": bars}) is None


def test_forced_flow_needs_volume_spike():
    bars = make_bars()
    bars[-1] = {"t": 99, "o": 100.0, "h": 103.0, "l": 99.0, "c": 102.0, "v": 1000.0}
    assert ForcedFlowContinuation().evaluate({"coin": "BTC", "bars": bars}) is None, \
        "an up day on ORDINARY volume is not forced flow and must not signal"

    bars[-1]["v"] = 5000.0
    sig = ForcedFlowContinuation().evaluate({"coin": "BTC", "bars": bars})
    assert sig is not None and sig.direction == Direction.LONG


def test_forced_flow_short_side():
    bars = make_bars()
    bars[-1] = {"t": 99, "o": 100.0, "h": 101.0, "l": 97.0, "c": 98.0, "v": 5000.0}
    sig = ForcedFlowContinuation().evaluate({"coin": "BTC", "bars": bars})
    assert sig is not None and sig.direction == Direction.SHORT
    assert sig.stop_loss_price > sig.entry_price, "a short's stop must sit ABOVE entry"


def test_range_break_needs_both_breakout_and_outsized_range():
    bars = make_bars()
    # breaks the 20d high, but on a normal-sized range -> no forced-flow evidence
    bars[-1] = {"t": 99, "o": 101.0, "h": 102.0, "l": 101.0, "c": 102.0, "v": 1000.0}
    assert RangeBreakCascade().evaluate({"coin": "BTC", "bars": bars}) is None

    # same breakout, but with a range far larger than ATR
    bars[-1] = {"t": 99, "o": 101.0, "h": 112.0, "l": 100.0, "c": 111.0, "v": 1000.0}
    sig = RangeBreakCascade().evaluate({"coin": "BTC", "bars": bars})
    assert sig is not None and sig.direction == Direction.LONG


def test_every_signal_carries_a_stop_loss():
    """Project safety rail: no naked positions, ever."""
    bars = make_bars()
    cases = [
        {"t": 99, "o": 100.0, "h": 112.0, "l": 100.0, "c": 111.0, "v": 9000.0},
        {"t": 99, "o": 100.0, "h": 100.0, "l": 88.0, "c": 89.0, "v": 9000.0},
    ]
    for strategy in (ForcedFlowContinuation(), RangeBreakCascade()):
        for last in cases:
            b = list(bars)
            b[-1] = last
            sig = strategy.evaluate({"coin": "BTC", "bars": b})
            if sig is None:
                continue
            assert sig.stop_loss_price is not None and sig.stop_loss_price > 0
            if sig.direction == Direction.LONG:
                assert sig.stop_loss_price < sig.entry_price
            else:
                assert sig.stop_loss_price > sig.entry_price


def test_insufficient_history_returns_none():
    for strategy in (ForcedFlowContinuation(), RangeBreakCascade()):
        assert strategy.evaluate({"coin": "BTC", "bars": make_bars(5)}) is None
        assert strategy.evaluate({"coin": "BTC", "bars": []}) is None
        assert strategy.evaluate({"coin": "BTC"}) is None
