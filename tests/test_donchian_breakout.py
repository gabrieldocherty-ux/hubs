"""
Tests for the Donchian macro strategy.

The channel-exclusion rule gets the most attention: if today's own high is
allowed into the channel it is breaking, the strategy can never signal a
breakout at all (price cannot exceed a maximum it is part of). That is a silent
failure - no error, just a strategy that never trades.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.strategies.donchian_breakout import DonchianBreakout
from core.strategy_base import Direction


def flat(n=140, price=100.0, band=1.0):
    return [{"t": i * 86400000, "o": price, "h": price + band,
             "l": price - band, "c": price, "v": 1000.0} for i in range(n)]


def test_no_signal_inside_the_range():
    assert DonchianBreakout().evaluate({"coin": "BTC", "bars": flat()}) is None


def test_breakout_above_channel_goes_long():
    bars = flat()
    bars[-1] = {"t": 99, "o": 100.0, "h": 106.0, "l": 100.0, "c": 105.0, "v": 1000.0}
    sig = DonchianBreakout().evaluate({"coin": "BTC", "bars": bars})
    assert sig is not None and sig.direction == Direction.LONG
    assert sig.stop_loss_price < sig.entry_price


def test_breakdown_below_channel_goes_short():
    bars = flat()
    bars[-1] = {"t": 99, "o": 100.0, "h": 100.0, "l": 94.0, "c": 95.0, "v": 1000.0}
    sig = DonchianBreakout().evaluate({"coin": "BTC", "bars": bars})
    assert sig is not None and sig.direction == Direction.SHORT
    assert sig.stop_loss_price > sig.entry_price


def test_channel_excludes_today_so_a_breakout_is_reachable():
    """Regression guard: with today included in its own channel, price can never
    exceed the max it belongs to, and the strategy would never signal."""
    bars = flat()
    bars[-1] = {"t": 99, "o": 100.0, "h": 106.0, "l": 100.0, "c": 105.0, "v": 1000.0}
    assert DonchianBreakout().evaluate({"coin": "BTC", "bars": bars}) is not None


def test_every_signal_carries_a_stop_loss():
    for last in ({"t": 99, "o": 100.0, "h": 106.0, "l": 100.0, "c": 105.0, "v": 1000.0},
                 {"t": 99, "o": 100.0, "h": 100.0, "l": 94.0, "c": 95.0, "v": 1000.0}):
        bars = flat()
        bars[-1] = last
        sig = DonchianBreakout().evaluate({"coin": "BTC", "bars": bars})
        assert sig is not None
        assert sig.stop_loss_price is not None and sig.stop_loss_price > 0


def test_trailing_exit_fires_on_opposite_channel():
    st = DonchianBreakout(exit_n=20)
    bars = flat()
    bars[-1] = {"t": 99, "o": 100.0, "h": 100.0, "l": 90.0, "c": 92.0, "v": 1000.0}
    assert st.should_exit({"coin": "BTC", "bars": bars}, True, 5) == "donchian_trail_exit"
    assert st.should_exit({"coin": "BTC", "bars": bars}, False, 5) is None


def test_insufficient_history_returns_none():
    st = DonchianBreakout()
    assert st.evaluate({"coin": "BTC", "bars": flat(20)}) is None
    assert st.evaluate({"coin": "BTC", "bars": []}) is None
    assert st.evaluate({"coin": "BTC"}) is None


def test_declares_macro_sleeve():
    """The 75/25 split depends on this label being right - a macro strategy
    mislabelled as daily would draw on the wrong allocation."""
    assert DonchianBreakout().sleeve == "macro"
