"""
Tests for the perp-spot basis strategy.

The bad-print filter gets the most attention here. Raw BTC basis on this venue
has a standard deviation of 13.5% around a median of -0.014% because the spot
pair is young and thin; if a wick ever reaches the signal, the strategy trades
a data error at full size. That filter is load-bearing, so it is tested rather
than trusted.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.strategies.basis_dislocation import BasisDislocation, compute_basis
from core.strategy_base import Direction


def bars(n=200, price=100.0):
    return [{"t": i * 86400000, "o": price, "h": price + 1, "l": price - 1,
             "c": price, "v": 1000.0} for i in range(n)]


def spot_for(perp, basis_pct=0.0):
    """Spot series implying a constant basis of `basis_pct` against the perp."""
    return [{"t": b["t"], "o": b["c"], "h": b["c"], "l": b["c"],
             "c": b["c"] / (1 + basis_pct), "v": 500.0} for b in perp]


def test_flat_basis_produces_no_signal():
    p = bars()
    md = {"coin": "BTC", "bars": p, "spot_bars": spot_for(p, 0.0)}
    assert BasisDislocation().evaluate(md) is None


def test_rich_perp_goes_short_and_cheap_perp_goes_long():
    p = bars()
    s = spot_for(p, 0.0)
    # give the history some spread so percentiles are meaningful
    for i in range(0, len(s) - 1):
        s[i]["c"] = p[i]["c"] / (1 + (0.0005 if i % 2 else -0.0005))

    s[-1]["c"] = p[-1]["c"] / 1.01          # perp 1% rich -> short
    sig = BasisDislocation().evaluate({"coin": "BTC", "bars": p, "spot_bars": s})
    assert sig is not None and sig.direction == Direction.SHORT
    assert sig.stop_loss_price > sig.entry_price

    s[-1]["c"] = p[-1]["c"] / 0.99          # perp 1% cheap -> long
    sig = BasisDislocation().evaluate({"coin": "BTC", "bars": p, "spot_bars": s})
    assert sig is not None and sig.direction == Direction.LONG
    assert sig.stop_loss_price < sig.entry_price


def test_bad_print_is_ignored_not_traded():
    """A 40% 'basis' is a thin-book wick, not a dislocation. It must not signal."""
    p = bars()
    s = spot_for(p, 0.0)
    for i in range(0, len(s) - 1):
        s[i]["c"] = p[i]["c"] / (1 + (0.0005 if i % 2 else -0.0005))
    s[-1]["c"] = p[-1]["c"] / 1.40
    assert BasisDislocation().evaluate({"coin": "BTC", "bars": p, "spot_bars": s}) is None


def test_compute_basis_marks_bad_data_as_none():
    p = bars(5)
    s = spot_for(p, 0.0)
    s[2]["c"] = p[2]["c"] / 1.50            # out of bounds -> None
    s[3]["v"] = 0.0                         # zero volume -> untrustworthy -> None
    out = compute_basis(p, s)
    assert out[2] is None and out[3] is None
    assert out[0] is not None and abs(out[0]) < 1e-9


def test_missing_spot_data_is_safe():
    p = bars()
    assert BasisDislocation().evaluate({"coin": "BTC", "bars": p, "spot_bars": []}) is None
    assert BasisDislocation().evaluate({"coin": "BTC", "bars": p}) is None


def test_thin_history_does_not_trade():
    """Fewer than min_history valid observations must produce nothing, so the
    strategy cannot fire off a percentile computed from a handful of points."""
    p = bars(30)
    s = spot_for(p, 0.0)
    s[-1]["c"] = p[-1]["c"] / 1.01
    assert BasisDislocation().evaluate({"coin": "BTC", "bars": p, "spot_bars": s}) is None


def test_timeout_exit_fires_even_without_spot_data():
    """The deliberate divergence from the research code: a risk control that
    stops applying when a data feed hiccups is not a risk control."""
    st = BasisDislocation(max_hold=7)
    p = bars()
    assert st.should_exit({"coin": "BTC", "bars": p, "spot_bars": []}, True, 7) == "timeout"
    assert st.should_exit({"coin": "BTC", "bars": p, "spot_bars": []}, True, 3) is None


def test_exit_on_reversion_to_median():
    st = BasisDislocation()
    p = bars()
    s = spot_for(p, 0.0)
    for i in range(len(s)):
        s[i]["c"] = p[i]["c"] / (1 + (0.0005 if i % 2 else -0.0005))
    s[-1]["c"] = p[-1]["c"]                 # basis back to ~0, i.e. the median
    assert st.should_exit({"coin": "BTC", "bars": p, "spot_bars": s}, False, 1) == "basis_normalised"


def test_every_signal_carries_a_stop_loss():
    p = bars()
    s = spot_for(p, 0.0)
    for i in range(0, len(s) - 1):
        s[i]["c"] = p[i]["c"] / (1 + (0.0005 if i % 2 else -0.0005))
    for mult in (1.01, 0.99, 1.005, 0.995):
        s[-1]["c"] = p[-1]["c"] / mult
        sig = BasisDislocation().evaluate({"coin": "BTC", "bars": p, "spot_bars": s})
        if sig is None:
            continue
        assert sig.stop_loss_price is not None and sig.stop_loss_price > 0
        if sig.direction == Direction.LONG:
            assert sig.stop_loss_price < sig.entry_price
        else:
            assert sig.stop_loss_price > sig.entry_price
