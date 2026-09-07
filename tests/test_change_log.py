"""
Tests for hourly change detection.

The failure mode that matters is a SILENT one: if the diff misses a real event,
the hourly notification says "no change" while a position was opened or a trade
closed. That is worse than no notification at all, because it actively tells
someone nothing happened when something did.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.change_log import diff, headline


def snap(equity=250.0, closed=0, realized=0.0, positions=None, base=16.25, alloc=None):
    return {
        "at": "2026-09-06T00:00:00+00:00",
        "equity": equity, "realized_pnl": realized, "closed_trades": closed, "wins": 0,
        "open_positions": positions or {},
        "base_size_usd": base,
        "allocation": alloc or {"daily": 0.75, "macro": 0.25},
    }


POS = {"SOL": {"dir": "long", "entry": 105.22, "stop": 102.06,
               "sleeve": "macro", "notional": 16.25}}


def test_first_run_is_not_material():
    """Starting tracking is not news - it must not fire a notification."""
    events, material = diff(None, snap())
    assert material is False and events[0]["kind"] == "first_run"


def test_quiet_hour_reports_nothing():
    events, material = diff(snap(), snap())
    assert events == [] and material is False


def test_opened_position_is_detected_and_material():
    events, material = diff(snap(), snap(positions=POS))
    assert material is True
    assert any(e["kind"] == "opened" and e["coin"] == "SOL" for e in events)
    assert "105.22" in events[0]["text"] and "macro" in events[0]["text"]


def test_closed_position_is_detected():
    events, material = diff(snap(positions=POS), snap())
    assert material is True
    assert any(e["kind"] == "closed_position" for e in events)


def test_closed_trade_reports_the_pnl_sign_correctly():
    events, material = diff(snap(), snap(closed=1, realized=-4.2, equity=245.8))
    assert material is True
    t = next(e for e in events if e["kind"] == "trades_closed")
    assert t["n"] == 1 and t["pnl"] == -4.2
    assert "-$4.20" in t["text"], t["text"]

    events, _ = diff(snap(), snap(closed=1, realized=3.5, equity=253.5))
    t = next(e for e in events if e["kind"] == "trades_closed")
    assert "+$3.50" in t["text"], t["text"]


def test_config_changes_are_flagged():
    """Sizing and allocation are the levers that change risk - a silent change
    to either is exactly what should wake someone."""
    events, material = diff(snap(), snap(base=50.0))
    assert material is True and any(e["kind"] == "config" for e in events)

    events, material = diff(snap(), snap(alloc={"daily": 0.5, "macro": 0.5}))
    assert material is True and any(e["kind"] == "config" for e in events)


def test_headline_fits_a_notification_and_leads_with_the_event():
    s = {"equity": 245.8, "realized_pnl": -4.2, "closed_trades": 1, "wins": 0,
         "open_positions": {}, "material": True,
         "events": [{"kind": "trades_closed", "text": "1 trade closed, realised -$4.20"}]}
    h = headline(s)
    assert len(h) < 200
    assert h.startswith("1 trade closed")

    quiet = {"equity": 250.0, "realized_pnl": 0.0, "closed_trades": 0, "wins": 0,
             "open_positions": POS, "material": False, "events": []}
    hq = headline(quiet)
    assert len(hq) < 200 and "SOL long" in hq


def test_headline_never_exceeds_notification_limit():
    many = {f"C{i}": {"dir": "long", "entry": 1.0, "stop": 0.9, "sleeve": "daily",
                      "notional": 16.25} for i in range(30)}
    s = {"equity": 250.0, "realized_pnl": 0.0, "closed_trades": 99, "wins": 0,
         "open_positions": many, "material": False, "events": []}
    assert len(headline(s)) < 200
