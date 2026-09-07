"""
Hourly change tracking.

Deliberately lives in Python, not in a Claude prompt: the hourly Windows task
runs whether or not Claude is open, so the record of what happened must not
depend on a session existing. Claude reads this afterwards; it does not produce
it. If that were the other way round, every hour the app was closed would be a
hole in the record.

Each cycle snapshots the real state files, diffs against the previous snapshot,
and appends anything that actually changed to data/change_log.jsonl. The current
summary is also written to data/hourly_summary.json for a notifier to read
without replaying the whole log.

What counts as material (and therefore worth waking someone for) is decided
here, once, rather than being re-judged by a language model every hour.
"""

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
SNAPSHOT = ROOT / "data" / "last_snapshot.json"
CHANGELOG = ROOT / "data" / "change_log.jsonl"
SUMMARY = ROOT / "data" / "hourly_summary.json"


def _read_json(path, default):
    p = ROOT / path if not isinstance(path, Path) else path
    try:
        return json.loads(p.read_text()) if p.exists() else default
    except Exception:
        return default


def _read_trades():
    p = ROOT / "data" / "trade_log.jsonl"
    if not p.exists():
        return []
    out = []
    for line in p.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out


def snapshot():
    """Everything worth diffing, in one flat dict."""
    settings = _read_json("config/settings.json", {})
    trades = _read_trades()
    positions = _read_json(ROOT / "data" / "paper_positions.json", {})
    start_cap = float(settings.get("paper_starting_capital", 0) or 0)
    realized = sum(float(t.get("pnl_usd", 0)) for t in trades)
    return {
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "equity": round(start_cap + realized, 4),
        "realized_pnl": round(realized, 4),
        "closed_trades": len(trades),
        "wins": sum(1 for t in trades if t.get("won")),
        "open_positions": {
            c: {
                "dir": "long" if p.get("is_long") else "short",
                "entry": p.get("entry_price"),
                "stop": p.get("stop_loss_price"),
                "sleeve": p.get("sleeve", "?"),
                "notional": round(float(p.get("size", 0)) * float(p.get("entry_price", 0)), 2),
            }
            for c, p in (positions or {}).items()
        },
        "base_size_usd": settings.get("base_size_usd"),
        "allocation": {k: v for k, v in (settings.get("allocation") or {}).items()
                       if not k.startswith("_")},
    }


def diff(prev, cur):
    """What changed, in plain terms. Returns (events, material) where `material`
    means 'a person would want to know now'."""
    events = []
    material = False
    if prev is None:
        return ([{"kind": "first_run", "text": "change tracking started"}], False)

    op, oc = prev.get("open_positions", {}), cur.get("open_positions", {})
    for coin in sorted(set(oc) - set(op)):
        p = oc[coin]
        events.append({"kind": "opened", "coin": coin, "text":
                       "OPENED {} {} @ {} stop {} (${:.2f}, {} sleeve)".format(
                           coin, p["dir"], p["entry"], p["stop"], p["notional"], p["sleeve"])})
        material = True
    for coin in sorted(set(op) - set(oc)):
        events.append({"kind": "closed_position", "coin": coin,
                       "text": "CLOSED position in {}".format(coin)})
        material = True

    dn = cur["closed_trades"] - prev["closed_trades"]
    if dn > 0:
        dp = cur["realized_pnl"] - prev["realized_pnl"]
        events.append({"kind": "trades_closed", "n": dn, "pnl": round(dp, 2), "text":
                       "{} trade{} closed, realised {}${:.2f}".format(
                           dn, "" if dn == 1 else "s", "-" if dp < 0 else "+", abs(dp))})
        material = True

    if prev.get("base_size_usd") != cur.get("base_size_usd"):
        events.append({"kind": "config", "text": "position size changed {} -> {}".format(
            prev.get("base_size_usd"), cur.get("base_size_usd"))})
        material = True
    if prev.get("allocation") != cur.get("allocation"):
        events.append({"kind": "config", "text": "allocation changed {} -> {}".format(
            prev.get("allocation"), cur.get("allocation"))})
        material = True
    return events, material


def record(cycle_note=""):
    """Snapshot, diff, persist. Returns the summary dict."""
    prev = _read_json(SNAPSHOT, None)
    cur = snapshot()
    events, material = diff(prev, cur)

    quiet_since = (prev or {}).get("_quiet_since") or cur["at"]
    if material:
        quiet_since = cur["at"]

    summary = {
        "at": cur["at"],
        "equity": cur["equity"],
        "realized_pnl": cur["realized_pnl"],
        "closed_trades": cur["closed_trades"],
        "wins": cur["wins"],
        "open_positions": cur["open_positions"],
        "events": events,
        "material": material,
        "quiet_since": quiet_since,
        "cycle_note": cycle_note,
    }

    if events and events[0].get("kind") != "first_run":
        CHANGELOG.parent.mkdir(parents=True, exist_ok=True)
        with open(CHANGELOG, "a", encoding="utf-8") as f:
            for e in events:
                f.write(json.dumps({"at": cur["at"], **e}) + "\n")

    SUMMARY.write_text(json.dumps(summary, indent=1), encoding="utf-8")
    cur["_quiet_since"] = quiet_since
    SNAPSHOT.write_text(json.dumps(cur, indent=1), encoding="utf-8")
    return summary


def headline(summary):
    """One line, under 200 chars, leading with the number that matters.
    This is what a notification would say."""
    s = summary
    if s.get("events") and s["material"]:
        first = s["events"][0]["text"]
        extra = " (+{} more)".format(len(s["events"]) - 1) if len(s["events"]) > 1 else ""
        return "{}{} | equity ${:.2f}, {} closed".format(
            first, extra, s["equity"], s["closed_trades"])[:199]
    pos = s.get("open_positions") or {}
    if pos:
        bits = ", ".join("{} {}".format(c, p["dir"]) for c, p in list(pos.items())[:3])
        return "No change. Holding {} | equity ${:.2f}, {} closed trades".format(
            bits, s["equity"], s["closed_trades"])[:199]
    return "No change, flat. Equity ${:.2f}, {} closed trades since start".format(
        s["equity"], s["closed_trades"])[:199]
