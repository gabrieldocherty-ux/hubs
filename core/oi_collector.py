"""
Forward-collect open interest and premium, because Hyperliquid does not serve
them historically.

`research/probe_datasources.py` established that open interest, the oracle/mark
premium and the impact prices exist ONLY as a live snapshot - there is no
historical endpoint, and candles carry no OI field. Liquidation history is not
served at all. That makes an entire class of positioning strategies untestable
today, and untestable forever unless someone starts writing the snapshots down.

So this appends one row per hourly cycle. It buys nothing now; in six months it
is a dataset nobody else in this project can reconstruct. The cost is a few
hundred KB a year and one API call per cycle.

Deliberately append-only JSONL with no cleverness: the value is in never having
a gap, so the writing path has as little that can fail as possible.
"""

import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / "data" / "oi_history.jsonl"
API = "https://api.hyperliquid.xyz/info"
COINS = ("BTC", "ETH", "SOL", "HYPE")


def _post(payload, timeout=25):
    req = urllib.request.Request(API, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


def collect(coins=COINS):
    """One row per coin per call. Returns the rows written (possibly empty)."""
    meta, ctxs = _post({"type": "metaAndAssetCtxs"})
    idx = {u["name"]: i for i, u in enumerate(meta["universe"])}
    now = int(time.time() * 1000)
    stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")

    rows = []
    for coin in coins:
        i = idx.get(coin)
        if i is None or i >= len(ctxs):
            continue
        c = ctxs[i]
        mark = float(c.get("markPx") or 0)
        if mark <= 0:
            continue
        # impactPxs is [bid, ask] at a venue-defined notional - a live read on
        # book depth, which is the other thing with no history.
        imp = c.get("impactPxs") or []
        rows.append({
            "t": now, "at": stamp, "coin": coin,
            "oi_base": float(c.get("openInterest") or 0),
            "oi_usd": float(c.get("openInterest") or 0) * mark,
            "mark": mark,
            "oracle": float(c.get("oraclePx") or 0),
            "mid": float(c.get("midPx") or 0) if c.get("midPx") else None,
            "premium": float(c.get("premium") or 0),
            "funding": float(c.get("funding") or 0),
            "day_ntl_vlm": float(c.get("dayNtlVlm") or 0),
            "prev_day_px": float(c.get("prevDayPx") or 0),
            "impact_bid": float(imp[0]) if len(imp) > 0 and imp[0] else None,
            "impact_ask": float(imp[1]) if len(imp) > 1 and imp[1] else None,
        })

    if rows:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        with open(OUT, "a", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
    return rows


def stats():
    """How much history has accumulated - so it is obvious when this silently
    stopped, rather than discovering a gap months later."""
    if not OUT.exists():
        return {"rows": 0, "coins": 0, "first": None, "last": None, "days": 0.0}
    first = last = None
    n = 0
    coins = set()
    with open(OUT, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            n += 1
            coins.add(r.get("coin"))
            first = first or r.get("t")
            last = r.get("t")
    days = ((last - first) / 86_400_000) if (first and last) else 0.0
    return {"rows": n, "coins": len(coins), "first": first, "last": last,
            "days": round(days, 3)}


if __name__ == "__main__":
    got = collect()
    s = stats()
    print("collected {} rows | history: {} rows over {:.2f} days across {} coins".format(
        len(got), s["rows"], s["days"], s["coins"]))
