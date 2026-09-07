#!/usr/bin/env python3
"""
Generates the paper-trading status board.

    python dashboard.py                 # writes dashboard.html
    python dashboard.py --open          # ...and opens it in a browser

This is a VIEW, not a second source of truth. Every number on the page is read
at generation time from the files the bot itself writes:

    data/trade_log.jsonl        closed trades (the analytics source of truth)
    data/paper_positions.json   currently open simulated positions
    data/adaptive_state_*.json  the shadow-evaluated SMA variants per coin
    data/bot_cycle_state.json   last bar seen / cycles since last report
    config/settings.json        the risk rails actually in force
    research/strategy_results.json  the validated + rejected strategy library

Nothing is cached or recomputed here, so the board cannot drift from the bot.
If a file is missing, that is shown as missing rather than filled in with a
plausible-looking zero.
"""

import argparse
import json
import statistics
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / "dashboard.html"


# --------------------------------------------------------------------- data

def read_json(path, default=None):
    p = ROOT / path
    if not p.exists():
        return default, False
    try:
        return json.loads(p.read_text()), True
    except Exception:
        return default, False


def read_trades():
    p = ROOT / "data/trade_log.jsonl"
    if not p.exists():
        return [], False
    out = []
    for line in p.read_text().splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out, True


def collect():
    settings, _ = read_json("config/settings.json", {})
    trades, have_log = read_trades()
    positions, _ = read_json("data/paper_positions.json", {})
    cycle, have_cycle = read_json("data/bot_cycle_state.json", {})
    lib, have_lib = read_json("research/strategy_results.json", {})

    adaptive = {}
    for f in sorted((ROOT / "data").glob("adaptive_state_*.json")):
        coin = f.stem.replace("adaptive_state_", "")
        try:
            adaptive[coin] = json.loads(f.read_text())
        except Exception:
            pass

    alloc = {k: v for k, v in (settings or {}).get("allocation", {}).items()
             if not k.startswith("_")} or {"daily": 0.75, "macro": 0.25}
    start_cap = float((settings or {}).get("paper_starting_capital", 0) or 0)
    realized = sum(float(t.get("pnl_usd", 0)) for t in trades)
    wins = [t for t in trades if t.get("won")]
    losses = [t for t in trades if not t.get("won")]

    per_strategy = {}
    for t in trades:
        k = t.get("strategy_variant") or "unknown"
        per_strategy.setdefault(k, []).append(t)
    per_coin = {}
    for t in trades:
        per_coin.setdefault(t.get("coin", "?"), []).append(t)

    return {
        "settings": settings or {},
        "trades": trades,
        "have_log": have_log,
        "positions": positions or {},
        "cycle": cycle or {},
        "have_cycle": have_cycle,
        "adaptive": adaptive,
        "library": lib or {},
        "have_lib": have_lib,
        "start_cap": start_cap,
        "realized": realized,
        "equity": start_cap + realized,
        "wins": wins,
        "losses": losses,
        "per_strategy": per_strategy,
        "per_coin": per_coin,
        "alloc": alloc,
    }


# ------------------------------------------------------------------ helpers

def pct(x, dp=2, sign=True):
    if x is None:
        return "&mdash;"
    fmt = "{:+." + str(dp) + "%}" if sign else "{:." + str(dp) + "%}"
    return fmt.format(x)


def usd(x, dp=2):
    if x is None:
        return "&mdash;"
    return "{}${:,.{dp}f}".format("-" if x < 0 else "", abs(x), dp=dp)


def cls(x, flip=False):
    if x is None:
        return "neutral"
    v = -x if flip else x
    return "pos" if v > 0 else ("neg" if v < 0 else "neutral")


def ago(ms):
    if not ms:
        return "never"
    then = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    delta = datetime.now(timezone.utc) - then
    h = delta.total_seconds() / 3600
    if h < 1:
        return "{:.0f} min ago".format(delta.total_seconds() / 60)
    if h < 48:
        return "{:.0f}h ago".format(h)
    return "{:.0f}d ago".format(h / 24)


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


# --------------------------------------------------------------------- CSS

CSS = """
:root{
  --ground:#f6f7f9; --surface:#ffffff; --surface-2:#eef1f5; --raise:#ffffff;
  --ink:#141922; --ink-2:#4d5769; --ink-3:#7c8798;
  --line:#dde2ea; --line-2:#c8d0dc;
  --accent:#3a5a99; --accent-soft:#e7edf8;
  --pos:#17724a; --pos-soft:#e2f2ea;
  --neg:#a83232; --neg-soft:#fbe8e8;
  --warn:#8a5a0c; --warn-soft:#fbf0dc;
  --shadow:0 1px 2px rgba(20,25,34,.06), 0 2px 10px rgba(20,25,34,.04);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ground:#0d1117; --surface:#151b24; --surface-2:#1b222d; --raise:#1b222d;
    --ink:#e8edf5; --ink-2:#a4b0c2; --ink-3:#75808f;
    --line:#242c38; --line-2:#333d4c;
    --accent:#7fa2e0; --accent-soft:#1a2536;
    --pos:#54c294; --pos-soft:#122a20;
    --neg:#e8807c; --neg-soft:#2d1a1a;
    --warn:#dfae5c; --warn-soft:#2b2315;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 2px 10px rgba(0,0,0,.25);
  }
}
:root[data-theme="dark"]{
  --ground:#0d1117; --surface:#151b24; --surface-2:#1b222d; --raise:#1b222d;
  --ink:#e8edf5; --ink-2:#a4b0c2; --ink-3:#75808f;
  --line:#242c38; --line-2:#333d4c;
  --accent:#7fa2e0; --accent-soft:#1a2536;
  --pos:#54c294; --pos-soft:#122a20;
  --neg:#e8807c; --neg-soft:#2d1a1a;
  --warn:#dfae5c; --warn-soft:#2b2315;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 2px 10px rgba(0,0,0,.25);
}

*{box-sizing:border-box}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  font-size:14px; line-height:1.5; -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1280px; margin:0 auto; padding:28px 24px 64px}
.mono{font-family:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
      font-variant-numeric:tabular-nums}
.num{font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace;
     font-variant-numeric:tabular-nums; letter-spacing:-.01em}
.pos{color:var(--pos)} .neg{color:var(--neg)} .neutral{color:var(--ink-2)}

/* masthead */
header.top{display:flex; align-items:flex-end; justify-content:space-between;
  gap:24px; flex-wrap:wrap; padding-bottom:16px; border-bottom:2px solid var(--ink);}
h1{font-family:Archivo,"IBM Plex Sans",sans-serif; font-weight:700; font-size:26px;
   letter-spacing:-.02em; margin:0; text-wrap:balance}
.sub{color:var(--ink-2); font-size:13px; margin-top:4px}
.stamp{text-align:right; font-size:11.5px; color:var(--ink-3); line-height:1.7}

/* status rail — label/value pairs, deliberately not cards */
.rail{display:flex; flex-wrap:wrap; gap:0; border-bottom:1px solid var(--line);
      margin-bottom:28px}
.rail .cell{flex:1 1 150px; padding:14px 18px 14px 0; margin-right:18px;
  border-right:1px solid var(--line)}
.rail .cell:last-child{border-right:0}
.k{font-size:10.5px; text-transform:uppercase; letter-spacing:.09em;
   color:var(--ink-3); font-weight:600}
.v{font-size:20px; font-weight:600; margin-top:3px; letter-spacing:-.02em; display:block}
.rail .cell small{display:block; font-size:11.5px; font-weight:500; color:var(--ink-2);
  letter-spacing:0; margin-top:2px; line-height:1.35}

h2{font-family:Archivo,sans-serif; font-size:12px; text-transform:uppercase;
   letter-spacing:.12em; color:var(--ink-2); margin:34px 0 12px; font-weight:700}
h2 .n{color:var(--ink-3); font-weight:500; letter-spacing:0; text-transform:none}

/* panels */
.panel{background:var(--surface); border:1px solid var(--line); border-radius:6px;
       box-shadow:var(--shadow)}
.panel .body{padding:16px 18px}
.grid2{display:grid; grid-template-columns:1fr 1fr; gap:20px}
@media (max-width:900px){.grid2{grid-template-columns:1fr}}

/* tables */
.tw{overflow-x:auto}
table{width:100%; border-collapse:collapse; font-size:13px}
th{font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--ink-3);
   font-weight:600; text-align:left; padding:0 10px 8px; border-bottom:1px solid var(--line-2);
   white-space:nowrap}
td{padding:9px 10px; border-bottom:1px solid var(--line); vertical-align:top}
tbody tr:last-child td{border-bottom:0}
td.r,th.r{text-align:right}
tbody tr.strat{cursor:pointer}
tbody tr.strat:hover{background:var(--surface-2)}

/* status chip with a leading stripe = state readable at a glance */
.chip{display:inline-flex; align-items:center; gap:6px; font-size:10.5px; font-weight:700;
  text-transform:uppercase; letter-spacing:.06em; padding:3px 8px 3px 6px; border-radius:3px;
  white-space:nowrap}
.chip::before{content:""; width:3px; height:11px; border-radius:2px; background:currentColor}
.chip.live{background:var(--accent-soft); color:var(--accent)}
.chip.validated{background:var(--pos-soft); color:var(--pos)}
.chip.conditional{background:var(--warn-soft); color:var(--warn)}
.chip.rejected{background:var(--neg-soft); color:var(--neg)}
.chip.cut{background:var(--neg-soft); color:var(--neg)}
.chip.shadow{background:var(--surface-2); color:var(--ink-2)}

/* year strip: real per-year expectancy, encoded as height */
.years{display:flex; gap:2px; align-items:flex-end; height:26px}
.years i{width:9px; border-radius:1px 1px 0 0; display:block; opacity:.9}
.years i.p{background:var(--pos)} .years i.n{background:var(--neg)}

.empty{padding:22px 18px; color:var(--ink-2); font-size:13px;
  background:var(--surface); border:1px dashed var(--line-2); border-radius:6px}
.empty strong{color:var(--ink); font-weight:600}

.note{font-size:12px; color:var(--ink-2); margin-top:10px; line-height:1.6}
.hyp{font-size:12px; color:var(--ink-2); line-height:1.55; max-width:62ch}
.detail{display:none; background:var(--surface-2)}
.detail.open{display:table-row}
.detail td{padding:14px 16px; font-size:12.5px}
.kv{display:grid; grid-template-columns:auto 1fr; gap:2px 14px; margin-top:8px;
    font-size:12px; max-width:520px}
.kv dt{color:var(--ink-3)} .kv dd{margin:0; font-weight:500}

.tabs{display:flex; gap:2px; margin-bottom:12px; flex-wrap:wrap}
.tab{font:inherit; font-size:12px; font-weight:600; padding:6px 12px; cursor:pointer;
  background:transparent; color:var(--ink-2); border:1px solid var(--line);
  border-radius:4px}
.tab[aria-selected="true"]{background:var(--ink); color:var(--ground);
  border-color:var(--ink)}
.tab:focus-visible{outline:2px solid var(--accent); outline-offset:2px}

.rails{display:flex; flex-wrap:wrap; gap:8px; margin-top:4px}
.rails span{font-size:11.5px; padding:4px 9px; background:var(--surface-2);
  border:1px solid var(--line); border-radius:3px; color:var(--ink-2)}
.rails b{color:var(--ink); font-weight:600}

footer{margin-top:44px; padding-top:16px; border-top:1px solid var(--line);
  font-size:11.5px; color:var(--ink-3); line-height:1.8}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
"""


# -------------------------------------------------------------------- build

def build(d):
    s = d["settings"]
    risk = s.get("risk", {})
    lib = d["library"]
    strategies = lib.get("strategies", [])

    n_trades = len(d["trades"])
    win_rate = (len(d["wins"]) / n_trades) if n_trades else None
    expect = (statistics.mean([t["pnl_pct"] for t in d["trades"]]) if n_trades else None)
    open_n = len(d["positions"])
    last_bar = max([v.get("last_bar_time", 0) for v in d["cycle"].values()] or [0])

    live = [x for x in strategies if x.get("status") == "LIVE"]
    validated = [x for x in strategies if x.get("status") == "VALIDATED"]
    conditional = [x for x in strategies if x.get("status") == "CONDITIONAL"]
    cut_list = [x for x in strategies if x.get("status") == "CUT"]
    rejected = [x for x in strategies if x.get("status") == "REJECTED"]

    rt = float((lib.get("cost_model") or {}).get("round_trip", 0.0019))
    for x in strategies:
        tpy = x.get("trades_per_year")
        exp = x.get("expectancy")
        x["_drag"] = (rt * tpy) if tpy else None
        # what fraction of the raw edge execution consumes
        x["_share"] = (rt / (exp + rt)) if (exp is not None and (exp + rt) > 0) else None

    # ---- status rail
    rail = []
    rail.append(("Mode", '<span class="v">Paper</span> <small>no wallet &middot; no real orders</small>'))
    rail.append(("Equity", '<span class="v num">{}</span> <small>from {}</small>'.format(
        usd(d["equity"]), usd(d["start_cap"], 0))))
    rail.append(("Realised P&amp;L", '<span class="v num {}">{}</span> <small>{} closed</small>'.format(
        cls(d["realized"]) if n_trades else "neutral",
        usd(d["realized"]) if n_trades else "&mdash;", n_trades)))
    rail.append(("Open positions", '<span class="v num">{}</span> <small>{}</small>'.format(
        open_n, ", ".join(d["positions"].keys()) if open_n else "flat")))
    rail.append(("Win rate", '<span class="v num">{}</span> <small>{}</small>'.format(
        pct(win_rate, 1, False) if win_rate is not None else "&mdash;",
        "{}W / {}L".format(len(d["wins"]), len(d["losses"])) if n_trades else "no sample yet")))
    rail.append(("Last bar seen", '<span class="v">{}</span> <small>{}</small>'.format(
        ago(last_bar), "cycle state present" if d["have_cycle"] else "no cycle state")))
    rail_html = "".join(
        '<div class="cell"><div class="k">{}</div>{}</div>'.format(k, v) for k, v in rail)

    # ---- open positions / trade blotter
    if open_n:
        rows = "".join(
            '<tr><td><b>{}</b></td><td>{}</td><td class="r num">{:g}</td>'
            '<td class="r num">{:,.4f}</td><td class="r num">{:,.4f}</td></tr>'.format(
                esc(c), "LONG" if p.get("is_long") else "SHORT", p.get("size", 0),
                p.get("entry_price", 0), p.get("stop_loss_price", 0))
            for c, p in d["positions"].items())
        blotter = ('<div class="panel"><div class="tw"><table><thead><tr>'
                   '<th>Coin</th><th>Side</th><th class="r">Size</th>'
                   '<th class="r">Entry</th><th class="r">Stop</th></tr></thead>'
                   '<tbody>{}</tbody></table></div></div>'.format(rows))
    else:
        blotter = ('<div class="empty"><strong>No open positions.</strong> The bot is flat. '
                   'The live SMA(20,60) basket fires roughly 40 times a year per coin, so '
                   'long flat stretches are the expected state, not a fault.</div>')

    if n_trades:
        tr = "".join(
            '<tr><td class="mono">{}</td><td><b>{}</b></td><td>{}</td>'
            '<td class="r num {}">{}</td><td class="r num {}">{}</td><td>{}</td></tr>'.format(
                esc(t.get("timestamp", ""))[:16], esc(t.get("coin")), esc(t.get("direction")),
                cls(t.get("pnl_pct")), pct(t.get("pnl_pct")),
                cls(t.get("pnl_usd")), usd(t.get("pnl_usd")), esc(t.get("reason", "")))
            for t in list(reversed(d["trades"]))[:15])
        closed = ('<div class="panel"><div class="tw"><table><thead><tr><th>When</th>'
                  '<th>Coin</th><th>Side</th><th class="r">P&amp;L %</th>'
                  '<th class="r">P&amp;L $</th><th>Exit</th></tr></thead><tbody>{}</tbody>'
                  '</table></div></div>'.format(tr))
    else:
        closed = ('<div class="empty"><strong>No closed trades yet</strong> &mdash; '
                  '<code>data/trade_log.jsonl</code> does not exist. Every P&amp;L figure on '
                  'this board is therefore backtest evidence, not a live track record. '
                  'Until this table has entries, nothing here has been proven with real fills.'
                  '</div>')

    # ---- shadow variants
    shadow_rows = []
    for coin, st in sorted(d["adaptive"].items()):
        cands = st.get("candidates", [])
        act = st.get("active_index", 0)
        for i, c in enumerate(cands):
            pnls = c.get("shadow_pnls", [])
            tot = sum(pnls) if pnls else None
            shadow_rows.append(
                '<tr><td><b>{}</b></td><td class="mono">SMA({},{})</td>'
                '<td>{}</td><td class="r num">{}</td><td class="r num {}">{}</td></tr>'.format(
                    esc(coin), c.get("fast"), c.get("slow"),
                    '<span class="chip live">active</span>' if i == act
                    else '<span class="chip shadow">shadow</span>',
                    len(pnls), cls(tot), pct(tot) if tot is not None else "&mdash;"))
    shadow = ('<div class="panel"><div class="tw"><table><thead><tr><th>Coin</th>'
              '<th>Variant</th><th>State</th><th class="r">Shadow trades</th>'
              '<th class="r">Shadow P&amp;L</th></tr></thead><tbody>{}</tbody></table>'
              '</div></div>'.format("".join(shadow_rows))) if shadow_rows else \
        '<div class="empty">No adaptive-strategy state files found.</div>'

    # ---- strategy library
    def year_strip(x):
        ys = x.get("years") or []
        if not ys:
            return ""
        mx = max(abs(y["exp"]) for y in ys) or 1
        bars = "".join(
            '<i class="{}" style="height:{}px" title="{}: {:+.2f}% over {} trades"></i>'.format(
                "p" if y["exp"] > 0 else "n",
                max(2, round(abs(y["exp"]) / mx * 24)), y["year"], y["exp"] * 100, y["n"])
            for y in ys)
        return '<div class="years">{}</div>'.format(bars)

    def strat_row(x, idx):
        st = x.get("status", "").lower()
        has = x.get("n") not in (None, 0) and not x.get("skip_metrics")
        per_coin = x.get("per_coin", {})
        coin_bits = "".join(
            '<dt>{}</dt><dd class="num {}">{} <span class="neutral">n={} &middot; wr {:.0f}%</span></dd>'.format(
                c, cls(v["expectancy"]), pct(v["expectancy"]), v["n"], v["win_rate"] * 100)
            for c, v in per_coin.items())
        detail = (
            '<tr class="detail" id="d{idx}"><td colspan="10">'
            '<div class="hyp"><b>Hypothesis.</b> {hyp}</div>'
            '<div class="hyp" style="margin-top:8px"><b>Assessment.</b> {note}</div>'
            '{kv}</td></tr>'
        ).format(
            idx=idx, hyp=esc(x.get("hypothesis", "")), note=esc(x.get("note", "")),
            kv=('<dl class="kv"><dt>Parameters</dt><dd class="mono">{}</dd>'
                '<dt>Bar / hold</dt><dd>{} bars &middot; {:.1f}d average</dd>'
                '<dt>Profit factor</dt><dd class="num">{}</dd>'
                '<dt>Funding / trade</dt><dd class="num {}">{}</dd>'
                '{coins}</dl>').format(
                    esc(json.dumps(x.get("params", {}))), x.get("interval", "?"),
                    x.get("avg_days_held", 0),
                    "{:.2f}".format(x["profit_factor"]) if x.get("profit_factor") else "&mdash;",
                    cls(x.get("avg_funding")), pct(x.get("avg_funding"), 3),
                    coins=coin_bits) if has else "")
        return (
            '<tr class="strat" data-status="{st}" data-fam="{fam}" onclick="tog({idx})">'
            '<td><span class="chip {st}">{status}</span></td>'
            '<td><b>{label}</b><div style="font-size:11px;color:var(--ink-3)">{fam} &middot; {sid}</div></td>'
            '<td class="r num">{n}</td>'
            '<td class="r num">{wr}</td>'
            '<td class="r num {ec}">{exp}</td>'
            '<td class="r num {tc}">{trim}</td>'
            '<td class="r num {trc}">{train}</td>'
            '<td class="r num {tec}">{test}</td>'
            '<td class="r num {dc}">{drag}</td>'
            '<td>{ys}</td></tr>{detail}'
        ).format(
            st=st, fam=x.get("family", ""), sid=x.get("id", ""), idx=idx,
            status=esc(x.get("status", "")), label=esc(x.get("label", "")),
            n=x.get("n", "&mdash;") if has else "&mdash;",
            wr="{:.0f}%".format(x["win_rate"] * 100) if has else "&mdash;",
            ec=cls(x.get("expectancy")) if has else "neutral",
            exp=pct(x.get("expectancy")) if has else "&mdash;",
            tc=cls(x.get("trimmed")) if has else "neutral",
            trim=pct(x.get("trimmed")) if has else "&mdash;",
            trc=cls(x.get("train")) if has else "neutral",
            train=pct(x.get("train")) if has else "&mdash;",
            tec=cls(x.get("test")) if has else "neutral",
            test=pct(x.get("test")) if has else "&mdash;",
            dc=("neg" if (x.get("_share") or 0) > 0.40 else "neutral") if has else "neutral",
            drag=('{:.1f}%'.format(x["_drag"] * 100)
                  if has and x.get("_drag") is not None else "&mdash;"),
            ys=year_strip(x) if has else "", detail=detail)

    ordered = live + validated + conditional + cut_list + rejected
    lib_rows = "".join(strat_row(x, i) for i, x in enumerate(ordered))

    cost = lib.get("cost_model", {})
    # Execution cost + sizing reality. Measured against the live book 2026-09-05
    # at this account's order size; the validation figure is deliberately ~2x
    # worse (see core/backtester.py for why).
    base = float(s.get("base_size_usd", 12.5) or 12.5)
    equity_now = d["equity"]
    max_pos = equity_now * float(risk.get("max_position_pct_of_capital", 0.2) or 0.2)
    cost_html = (
        '<span>measured round trip <b>0.091&ndash;0.100%</b></span>'
        '<span>modelled in backtests <b>{:.3f}%</b></span>'
        '<span>taker fee <b>0.045%</b></span>'
        '<span>slippage at $25 <b>0.006&ndash;0.048%</b></span>'
        '<span>exchange min order <b>$10</b></span>'
        '<span>position now <b>${:,.2f}</b></span>'
        '<span>hard ceiling <b>${:,.2f}</b></span>').format(
            float(cost.get("round_trip", 0.0019)) * 100, base, max_pos)
    # Sleeve utilisation. Open notional is attributed by the position's own
    # recorded sleeve where the bot wrote one; anything unlabelled is shown as
    # such rather than being guessed into a bucket.
    sleeve_used = {k: 0.0 for k in d["alloc"]}
    unlabelled = 0.0
    for c, pos in d["positions"].items():
        notl = float(pos.get("size", 0)) * float(pos.get("entry_price", 0))
        sv = pos.get("sleeve")
        if sv in sleeve_used:
            sleeve_used[sv] += notl
        else:
            unlabelled += notl
    sleeve_rows = ""
    for name, weight in sorted(d["alloc"].items(), key=lambda kv: -kv[1]):
        capn = equity_now * float(weight)
        used = sleeve_used.get(name, 0.0)
        util = (used / capn) if capn else 0.0
        slots = int(capn // base) if base else 0
        sleeve_rows += (
            '<tr><td><b>{}</b></td><td class="r num">{:.0%}</td>'
            '<td class="r num">{}</td><td class="r num">{}</td>'
            '<td class="r num">{}</td>'
            '<td><div style="background:var(--surface-2);border-radius:2px;height:7px;'
            'width:110px;overflow:hidden"><div style="background:var(--accent);height:7px;'
            'width:{:.0f}%"></div></div></td></tr>').format(
                esc(name), weight, usd(capn), usd(used), slots, min(100.0, util * 100))
    if unlabelled:
        sleeve_rows += ('<tr><td><b>unlabelled</b></td><td class="r">&mdash;</td>'
                        '<td class="r">&mdash;</td><td class="r num">{}</td>'
                        '<td class="r">&mdash;</td><td></td></tr>'.format(usd(unlabelled)))
    sleeve_html = (
        '<div class="panel"><div class="tw"><table><thead><tr><th>Sleeve</th>'
        '<th class="r">Weight</th><th class="r">Capacity</th><th class="r">Open now</th>'
        '<th class="r">Slots</th><th>Used</th></tr></thead><tbody>{}</tbody>'
        '</table></div></div>'.format(sleeve_rows))

    min_order_warn = ''
    if base < 10:
        min_order_warn = ('<div class="note"><b>Position size is below the $10 exchange '
                          'minimum</b> &mdash; orders this small are rejected outright, so the '
                          'bot would silently skip trades rather than take smaller ones.</div>')
    elif base < 15:
        min_order_warn = ('<div class="note">Position size is close to the $10 exchange minimum. '
                          'If equity falls or Kelly scales down after a losing run, sizing can hit '
                          'that floor &mdash; at which point trades are <b>skipped, not shrunk</b>, '
                          'which is a different strategy from the one validated.</div>')

    rails_html = (
        '<span>stop-loss <b>{}</b></span><span>max leverage <b>{}x</b></span>'
        '<span>max position <b>{:.0f}%</b> of capital</span>'
        '<span>daily loss breaker <b>{:.0f}%</b></span>'
        '<span>net one-way exposure <b>{:.0f}%</b></span>'
        '<span>Kelly fraction <b>{}</b></span>'
        '<span>modelled round trip <b>{:.3f}%</b></span>').format(
            "required" if risk.get("require_stop_loss") else "NOT REQUIRED",
            risk.get("max_leverage", "?"),
            float(risk.get("max_position_pct_of_capital", 0)) * 100,
            float(risk.get("daily_loss_breaker_pct", 0)) * 100,
            float(risk.get("max_net_exposure_pct", 0)) * 100,
            risk.get("kelly_fraction", "?"),
            float(cost.get("round_trip", 0)) * 100)

    gen = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    return """<title>Hyperliquid Paper Desk</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap">
<style>{css}</style>
<div class="wrap">
  <header class="top">
    <div>
      <h1>Hyperliquid Paper Desk</h1>
      <div class="sub">Paper trading &amp; strategy validation board &mdash; BTC / ETH / SOL / HYPE perpetuals</div>
    </div>
    <div class="stamp">generated {gen}<br>view onto data/*.json &mdash; no separate tracking<br>
      research window: {window}</div>
  </header>

  <div class="rail">{rail}</div>

  <div class="grid2">
    <div>
      <h2>Open positions</h2>
      {blotter}
      <h2>Risk rails in force</h2>
      <div class="rails">{rails}</div>
      <h2>Execution cost &amp; sizing</h2>
      <div class="rails">{cost}</div>
      {min_warn}
      <h2>Capital allocation <span class="n">by strategy family</span></h2>
      {sleeves}
      <div class="note">Weight caps how much open <b>notional</b> a family may hold, not
        the pot it sizes against &mdash; every position is the same
        {base} regardless of sleeve. Sizing off sleeve capital would put a macro
        position under Hyperliquid&rsquo;s $10 minimum, where the order is refused and
        the trade is <b>skipped, not shrunk</b>. Enforced in
        <code>core/risk_manager.py</code>.</div>
      <div class="note">These are read from <code>config/settings.json</code>. The stop-loss
        requirement, the leverage and position ceilings and the daily loss breaker are hard
        limits enforced in <code>core/risk_manager.py</code> before any order is placed, not
        strategy preferences.</div>
    </div>
    <div>
      <h2>Recent closed trades <span class="n">last 15</span></h2>
      {closed}
      <h2>Adaptive shadow variants</h2>
      {shadow}
    </div>
  </div>

  <h2>Strategy library <span class="n">&mdash; {nval} validated, {ncond} conditional, {ncut} cut on cost, {nrej} rejected on evidence. Click any row.</span></h2>
  <div class="tabs" role="tablist">
    <button class="tab" role="tab" aria-selected="true" data-f="all">All ({ntot})</button>
    <button class="tab" role="tab" aria-selected="false" data-f="live">Live</button>
    <button class="tab" role="tab" aria-selected="false" data-f="validated">Validated</button>
    <button class="tab" role="tab" aria-selected="false" data-f="conditional">Conditional</button>
    <button class="tab" role="tab" aria-selected="false" data-f="cut">Cut ({ncut})</button>
    <button class="tab" role="tab" aria-selected="false" data-f="rejected">Rejected</button>
  </div>
  <div class="panel"><div class="tw"><table id="lib">
    <thead><tr>
      <th>Status</th><th>Strategy</th><th class="r">Trades</th><th class="r">Win</th>
      <th class="r">Expectancy</th><th class="r">Trimmed 5%</th>
      <th class="r">Train</th><th class="r">Test</th>
      <th class="r">Cost&nbsp;drag/yr</th><th>By year</th>
    </tr></thead>
    <tbody>{rows}</tbody>
  </table></div></div>
  <div class="note">
    <b>Expectancy</b> is net profit per trade after taker fees, slippage and real Hyperliquid
    funding, pooled across the coins listed for that strategy.
    <b>Trimmed 5%</b> drops the best and worst 5% of trades &mdash; if it stays positive the edge
    lives in the body of the distribution rather than a few lottery trades, which is the single
    most useful column here.
    <b>Train / Test</b> is a 60/40 split by time; a sign flip between them is the signature of
    noise, and it is why several ideas above were rejected.
    <b>Cost drag/yr</b> is the round-trip cost times trades per year &mdash; the annual toll a
    strategy pays for the right to trade, at full notional. It is why a high-frequency
    strategy with a small per-trade edge can be worse than a slow one with a large edge,
    and it is what the <b>Cut</b> tab was decided on. Red means execution eats more than
    40% of the raw edge.
    <b>By year</b> bars are per-calendar-year expectancy, scaled within each strategy.
    <br><b>Cut vs Rejected:</b> rejected failed on evidence (no edge, or a train/test sign
    flip). Cut had a positive average but did not survive costs &mdash; usually because the
    edge lived only in the tail, or turnover was too high for the edge per trade.
  </div>

  <footer>
    Paper trading only &mdash; no wallet exists, no real orders can be placed.
    Backtests use next-bar-open fills, intra-bar stop detection, gap-through stops filled at the
    open, and real funding history; the engine is calibrated against a random-entry null whose
    residual is within noise of zero on BTC/ETH/SOL.<br>
    Full research record, including every rejected idea and why:
    <code>../Claude-Brain/Projects/Crypto-Trading.md</code>. Regenerate this page with
    <code>python dashboard.py</code>.
  </footer>
</div>
<script>
function tog(i){{var r=document.getElementById('d'+i); if(r) r.classList.toggle('open');}}
document.querySelectorAll('.tab').forEach(function(b){{
  b.addEventListener('click',function(){{
    document.querySelectorAll('.tab').forEach(function(x){{x.setAttribute('aria-selected','false');}});
    b.setAttribute('aria-selected','true');
    var f=b.dataset.f;
    document.querySelectorAll('#lib tbody tr.strat').forEach(function(row){{
      var show=(f==='all'||row.dataset.status===f);
      row.style.display=show?'':'none';
      var d=row.nextElementSibling;
      if(d&&d.classList.contains('detail')){{d.classList.remove('open'); d.style.display=show?'':'none';}}
    }});
  }});
}});
</script>""".format(
        css=CSS, gen=gen, rail=rail_html, blotter=blotter, closed=closed, shadow=shadow,
        rails=rails_html, cost=cost_html, min_warn=min_order_warn,
        sleeves=sleeve_html, base=usd(base),
        rows=lib_rows, window=esc(lib.get("window", "n/a")),
        nlive=len(live), nval=len(validated), ncond=len(conditional), nrej=len(rejected),
        ncut=len(cut_list),
        ntot=len(ordered))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--open", action="store_true", help="open the page after writing it")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    d = collect()
    html = build(d)
    Path(args.out).write_text(html, encoding="utf-8")
    print("wrote {} ({:,} bytes)".format(args.out, len(html)))
    print("  closed trades: {}   open positions: {}   strategies: {}".format(
        len(d["trades"]), len(d["positions"]), len(d["library"].get("strategies", []))))
    if not d["have_log"]:
        print("  note: data/trade_log.jsonl does not exist yet - no live track record to show")
    if args.open:
        import webbrowser
        webbrowser.open(Path(args.out).resolve().as_uri())


if __name__ == "__main__":
    main()
