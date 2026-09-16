"""
Strategy degradation monitor - the disciplined form of "let strategies evolve
after mistakes".

WHY THIS EXISTS, AND WHY IT DOES NOT RETUNE ANYTHING
----------------------------------------------------
The request behind this file is "a strategy should be allowed to evolve after
mistakes". Implemented naively - it had a bad month, so change its parameters -
that instruction destroys the book, for three separate reasons:

  1. IT DELETES THE EVIDENCE. Everything that justified trading S3, D1, B1 and
     M3 is out-of-sample evidence: a 60/40 train/test split, a quarterly
     walk-forward, a parameter neighbourhood sweep, a cost stress. Those numbers
     are evidence *because* the parameters were fixed before that data was seen.
     Choose a parameter using live results and the live window stops being
     out-of-sample too. There is then no un-fitted data left anywhere, and the
     honest description of the strategy becomes "it has never been tested".

  2. RETUNING AFTER LOSSES IS A BIASED OPERATOR. It is applied only after the
     left tail shows up, and it always removes some of that tail. Backtested
     mean rises and backtested variance falls every single time it is used,
     whether or not anything real changed. A procedure that always produces an
     improvement measures nothing.

  3. "IT MADE A MISTAKE" CARRIES ALMOST NO INFORMATION HERE. S3's median trade
     is negative - the modal outcome of a healthy S3 is a loss. D1 wins 65% of
     the time and still has losing runs by construction. A rule that fires on a
     bad trade, or a bad month, fires constantly on strategies that are working
     exactly as registered.

So the only question worth asking is not "is it losing" but:

        Is it losing MORE than its own resampled history ever did?

and it must be answered against a threshold and a response that were both
written down BEFORE the live data existed. Anything chosen afterwards is chosen
by someone who already knows which answer they want.

THE THREE PIECES
----------------
* BASELINE. config/degradation_baselines.json, produced by research/degradation.py
  from each strategy's own backtest trade sequence: mean, stdev, and a bootstrap
  of worst-k-trade runs, max drawdown and longest losing streak. This file is
  pre-registration. Regenerating it after live trades exist is the same act as
  retuning the strategy, one level up, and the note inside it says so.

* SEQUENTIAL TEST. With mu0/sigma0 the registered mean and stdev per trade and
  S_n the cumulative live P&L after n closed trades, a rung fires when

        S_n < n*mu0 - c * sigma0 * sqrt(n)      and    n >= min_trades

  The sqrt(n) shape is used because under the null S_n - n*mu0 is a random walk
  whose spread grows as sqrt(n); a boundary of that shape has roughly constant
  crossing hazard per trade, so the test is neither front- nor back-loaded. A
  fixed "down X%" threshold, by contrast, is nearly impossible to cross early
  and nearly certain to be crossed eventually, so its real false-alarm rate is
  whatever the run length happens to be.

  `c` is not chosen by taste. research/degradation.py CALIBRATES it by Monte
  Carlo on the strategy's own trades so that P(cross anywhere in the registered
  horizon | the edge is intact) equals that rung's alpha exactly. That is the
  multiple-comparisons fix: a boundary set at each n's own 5th percentile is
  crossed by a healthy strategy far more often than 5% of the time because the
  path gets many chances at it.

* LADDER. full -> half -> paused -> retired, at alpha 0.20 / 0.05 / 0.01.
  Escalating, and reversible on the way back up (retirement excepted - see
  below). Parameter re-tuning is not on it, and cannot be added to it, because
  changing WHAT a strategy does invalidates its evidence while changing HOW MUCH
  CAPITAL it gets does not. Capital allocation is the only lever that can be
  pulled on observed live data without destroying the thing being observed: it
  leaves the trade distribution under measurement unchanged and alters only how
  much money rides on it. If a mechanism genuinely wants different parameters,
  that is a NEW strategy and it goes through the full gate on data that predates
  the decision, exactly like every other candidate.

A NOTE ON UNITS - easy to get wrong, and wrong in the dangerous direction.
The baseline's pnl_pct is NET of the modelled 0.190% round trip and of real
funding. The live log's pnl_pct (core/trade_log.make_trade) is the RAW price
move: gross of fees, slippage and funding. Comparing them directly hands every
live trade a free +0.19% against the boundary, which biases the monitor towards
never firing. This module therefore charges each live trade the same 0.190% the
baseline was built at. Live funding is still unmodelled and remains a known gap;
it makes the monitor slightly slow to fire on longs, slightly quick on shorts.

WHAT THIS MODULE DOES NOT DO
----------------------------
It does not place, resize or block orders by itself. It reports a rung and the
size multiplier that rung implies. Wiring that multiplier into
core/risk_manager.py is a live-risk change and is Gabe's call, not this file's -
and see `size_plan()` for a concrete reason it cannot be a one-line change on a
$250 account.
"""

import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

ROOT = Path(__file__).parent.parent
BASELINES_PATH = ROOT / "config" / "degradation_baselines.json"
TRADE_LOG_PATH = ROOT / "data" / "trade_log.jsonl"

# The ladder, shallowest first. This ordering IS the escalation order.
RUNGS = ("full", "half", "paused", "retired")
RUNG_INDEX = {r: i for i, r in enumerate(RUNGS)}

# What each rung means in capital terms. Note that nothing here touches
# parameters, coins, stops or holds - by construction, that is the whole point.
SIZE_MULTIPLIER = {"full": 1.0, "half": 0.5, "paused": 0.0, "retired": 0.0}

RUNG_ACTION = {
    "full": "trade at registered size",
    "half": "trade at half size",
    "paused": "stop opening new positions; existing ones exit on their own rules",
    "retired": "stop trading this strategy; only Gabe re-enables it",
}

# Hyperliquid refuses orders under $10 - and refuses them, it does not fill them
# smaller. See size_plan() for why that turns "half size" into a live problem.
MIN_ORDER_USD = 10.0

# Charged to live trades so they are measured on the same ruler as the baseline.
# Deliberately the modelled 0.190%, not the measured 0.100%: the point is a
# like-for-like comparison with the registered distribution, not a cost estimate.
DEFAULT_COST_PER_TRADE = 0.0019


# ---------------------------------------------------------------------------
# Baseline
# ---------------------------------------------------------------------------

@dataclass
class Baseline:
    """One strategy's pre-registered expectations. Read-only by design."""
    key: str
    label: str
    mean: float
    stdev: float
    rungs: Dict[str, dict]              # rung -> {alpha, c, min_trades}
    variants: List[str] = field(default_factory=list)
    coins: List[str] = field(default_factory=list)
    sleeve: str = "daily"
    hysteresis: float = 0.5
    recover_trades: int = 5
    cost_per_trade: float = DEFAULT_COST_PER_TRADE
    horizon_trades: int = 100
    n_backtest_trades: int = 0
    win_rate: float = 0.0
    median: float = 0.0
    trades_per_year: float = 0.0
    drawdown_profile: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, key: str, d: dict) -> "Baseline":
        return cls(
            key=key,
            label=d.get("label", key),
            mean=float(d["mean"]),
            stdev=float(d["stdev"]),
            rungs={r: dict(v) for r, v in d.get("rungs", {}).items()},
            variants=list(d.get("variants", [])),
            coins=list(d.get("coins", [])),
            sleeve=d.get("sleeve", "daily"),
            hysteresis=float(d.get("hysteresis", 0.5)),
            recover_trades=int(d.get("recover_trades", 5)),
            cost_per_trade=float(d.get("cost_per_trade", DEFAULT_COST_PER_TRADE)),
            horizon_trades=int(d.get("horizon_trades", 100)),
            n_backtest_trades=int(d.get("n_backtest_trades", 0)),
            win_rate=float(d.get("win_rate", 0.0)),
            median=float(d.get("median", 0.0)),
            trades_per_year=float(d.get("trades_per_year", 0.0)),
            drawdown_profile=d.get("drawdown_profile", {}),
        )

    def boundary(self, rung: str, n: int) -> Optional[float]:
        """Cumulative live P&L at or below which `rung` fires after n trades.

        None when the rung cannot fire yet, either because n is below its
        pre-registered minimum sample or because the rung is not registered.
        Returning None rather than a very negative number keeps "cannot fire
        yet" distinguishable from "fires only on catastrophe"."""
        cfg = self.rungs.get(rung)
        if cfg is None or n < int(cfg.get("min_trades", 0)) or n <= 0:
            return None
        return n * self.mean - float(cfg["c"]) * self.stdev * math.sqrt(n)

    def expected_pnl(self, n: int) -> float:
        return n * self.mean

    def z_score(self, n: int, cum_pnl: float) -> Optional[float]:
        """(S_n - n*mu0) / (sigma0*sqrt(n)). Standardised distance from the
        registered edge - directly comparable across strategies, which the raw
        cumulative P&L is not."""
        if n <= 0 or self.stdev <= 0:
            return None
        return (cum_pnl - n * self.mean) / (self.stdev * math.sqrt(n))


def load_baselines(path: Path = BASELINES_PATH) -> Dict[str, Baseline]:
    """Missing or unreadable file returns {} rather than raising. The monitor
    running with nothing registered must report "nothing registered", never take
    down the hourly cycle."""
    p = Path(path)
    if not p.exists():
        return {}
    try:
        doc = json.loads(p.read_text())
    except (ValueError, OSError):
        return {}
    return {k: Baseline.from_dict(k, v) for k, v in doc.get("strategies", {}).items()}


def registered_at(path: Path = BASELINES_PATH) -> Optional[str]:
    p = Path(path)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text()).get("registered_at")
    except (ValueError, OSError):
        return None


# ---------------------------------------------------------------------------
# The ladder
# ---------------------------------------------------------------------------

@dataclass
class MonitorState:
    rung: str = "full"
    n_trades: int = 0
    cum_pnl: float = 0.0
    expected_pnl: float = 0.0
    z: Optional[float] = None
    worst_rung_seen: str = "full"
    first_demotion_n: Optional[int] = None
    trades_since_change: int = 0
    transitions: List[tuple] = field(default_factory=list)   # (n, from, to, why)

    @property
    def size_multiplier(self) -> float:
        return SIZE_MULTIPLIER[self.rung]


def _deepest_breach(bl: Baseline, n: int, cum: float) -> Optional[str]:
    """Deepest rung whose boundary is currently breached, or None.

    Deliberately allows a JUMP rather than one rung per trade. If a strategy's
    cumulative P&L is already below the 1%-alpha boundary, halving it and
    waiting another five trades to look again is a decision that ignores the
    evidence in hand. Demotion is the cheap, reversible direction; promotion is
    the one that has to be earned a rung at a time."""
    for rung in reversed(RUNGS[1:]):        # retired, paused, half
        b = bl.boundary(rung, n)
        if b is not None and cum < b:
            return rung
    return None


def step(state: MonitorState, pnl: float, bl: Baseline) -> MonitorState:
    """Apply one closed trade. Returns the same (mutated) state for convenience.

    `pnl` must already be on the baseline's ruler: net of the same round-trip
    cost the backtest charged. live_pnls() does that conversion."""
    state.n_trades += 1
    state.cum_pnl += pnl
    state.trades_since_change += 1
    n, cum = state.n_trades, state.cum_pnl
    state.expected_pnl = bl.expected_pnl(n)
    state.z = bl.z_score(n, cum)

    if state.rung == "retired":
        # Absorbing in code. At the 1% rung the live question stops being "how
        # much size" and becomes "is the mechanism still there" - which is a
        # research question answered on new out-of-sample data, not a monitoring
        # one answered by waiting.
        return state

    breach = _deepest_breach(bl, n, cum)
    if breach is not None and RUNG_INDEX[breach] > RUNG_INDEX[state.rung]:
        prev = state.rung
        state.rung = breach
        state.transitions.append((n, prev, breach, "breached {} boundary".format(breach)))
        if state.first_demotion_n is None:
            state.first_demotion_n = n
        if RUNG_INDEX[breach] > RUNG_INDEX[state.worst_rung_seen]:
            state.worst_rung_seen = breach
        state.trades_since_change = 0
        return state

    # PROMOTION - one rung at a time, and only once the recovery is both large
    # enough and old enough. Without the hysteresis band the state flaps across
    # the boundary trade by trade; without the trade minimum a single lucky
    # trade undoes a demotion.
    if state.rung != "full" and state.trades_since_change >= bl.recover_trades:
        b = bl.boundary(state.rung, n)
        if b is not None and cum > b + bl.hysteresis * bl.stdev * math.sqrt(n):
            prev = state.rung
            state.rung = RUNGS[RUNG_INDEX[prev] - 1]
            state.transitions.append((n, prev, state.rung, "recovered above {} boundary "
                                                           "+ hysteresis".format(prev)))
            state.trades_since_change = 0
    return state


def replay(pnls: List[float], bl: Baseline) -> MonitorState:
    """Run a whole sequence of already-net trade P&Ls through the ladder."""
    s = MonitorState()
    for p in pnls:
        step(s, p, bl)
    return s


# ---------------------------------------------------------------------------
# Reading the live trade log
# ---------------------------------------------------------------------------

def read_trade_log(path: Path = TRADE_LOG_PATH) -> List[dict]:
    """The live log, or [] if it does not exist yet - which is the current state
    of the world (zero closed paper trades as of 2026-09-09). A missing file is
    not an error condition, it is the normal starting condition, and a monitor
    that crashes on it would take the hourly cycle down on day one.

    Malformed lines are skipped rather than fatal: the log is append-only and
    written by a scheduled task, so a torn final line after a kill is a realistic
    failure and losing one record is much better than losing the whole file."""
    p = Path(path)
    if not p.exists():
        return []
    out = []
    try:
        lines = p.read_text().splitlines()
    except OSError:
        return []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if isinstance(rec, dict):
            out.append(rec)
    return out


def _ts(rec: dict) -> str:
    return str(rec.get("timestamp") or "")


def live_pnls(records: List[dict], bl: Baseline, since: Optional[str] = None) -> List[float]:
    """This strategy's live trades, on the baseline's ruler, in realised order.

    Three things happen here and each matters:
      * VARIANT FILTER. Only trades whose strategy_variant belongs to this
        baseline. A monitor fed another strategy's trades is measuring noise
        against the wrong distribution.
      * PRE-REGISTRATION CUTOFF. Trades closed before the baseline was
        registered are excluded. Including them would let the monitor be judged
        on data that existed when the thresholds were written, which is the same
        contamination this whole file exists to prevent.
      * COST. The live log records the raw price move; the baseline is net. The
        registered round trip is charged so the two are comparable.
    """
    out = []
    for r in records:
        if bl.variants and r.get("strategy_variant") not in bl.variants:
            continue
        if since and _ts(r) and _ts(r) < since:
            continue
        try:
            raw = float(r.get("pnl_pct"))
        except (TypeError, ValueError):
            continue
        out.append(raw - bl.cost_per_trade)
    return out


# ---------------------------------------------------------------------------
# Sizing - where the $10 minimum bites
# ---------------------------------------------------------------------------

def size_plan(rung: str, base_size_usd: float, min_order_usd: float = MIN_ORDER_USD,
              conviction_min: float = 0.5) -> dict:
    """What `rung` actually means in dollars on THIS account, honestly.

    The rung says "half size". On $250 with base_size_usd $16.25 that is $8.13 -
    under Hyperliquid's $10 minimum, where the order is REFUSED rather than
    filled smaller, so every trade would be skipped. "Half size" would silently
    execute as "paused", and worse, it would not even be an honest pause: with
    conviction sizing on (0.5x-2.0x of base), the strong signals could still
    clear $10 while the weak ones did not. That is not a smaller version of the
    validated strategy, it is a different strategy with an entry filter bolted
    on - the exact failure mode this project has already flagged twice.

    So the plan floors the notional at the exchange minimum and REPORTS that the
    floor bound, rather than quietly shipping a strategy nobody validated. The
    returned `feasible` flag is what a caller should branch on."""
    mult = SIZE_MULTIPLIER.get(rung, 1.0)
    nominal = base_size_usd * mult
    plan = {
        "rung": rung,
        "nominal_size_usd": round(nominal, 2),
        "size_usd": round(nominal, 2),
        "floored_to_minimum": False,
        "feasible": True,
        "note": "",
    }
    if mult == 0.0:
        plan["note"] = "no new positions at this rung"
        return plan
    if nominal < min_order_usd:
        plan["size_usd"] = min_order_usd
        plan["floored_to_minimum"] = True
        plan["effective_multiplier"] = round(min_order_usd / base_size_usd, 3)
        plan["note"] = (
            "half size is ${:.2f}, under the ${:.0f} exchange minimum - floored to the "
            "minimum, so the real multiplier is {:.2f}x not {:.2f}x".format(
                nominal, min_order_usd, min_order_usd / base_size_usd, mult))
    # Conviction sizing multiplies on top of whatever base we hand the risk
    # manager. If the weakest signal lands under the minimum, the rung has
    # become an entry filter instead of a size cut.
    weakest = plan["size_usd"] * conviction_min
    if weakest < min_order_usd:
        plan["feasible"] = False
        plan["note"] = ((plan["note"] + " | ") if plan["note"] else "") + (
            "with conviction sizing at {:.1f}x the weakest signal sizes to ${:.2f}, under the "
            "${:.0f} minimum - at this rung weak signals would be SKIPPED, turning a size cut "
            "into an entry filter. Treat this rung as 'paused' until capital supports it."
            .format(conviction_min, weakest, min_order_usd))
    return plan


def capital_for_feasible_half(base_size_pct: float = 0.065, min_order_usd: float = MIN_ORDER_USD,
                              conviction_min: float = 0.5) -> dict:
    """Account capital at which the `half` rung becomes real rather than a
    disguised pause. Reported so the answer is a number, not a vibe."""
    return {
        "half_size_clears_minimum": min_order_usd / (0.5 * base_size_pct),
        "half_size_clears_minimum_with_conviction":
            min_order_usd / (0.5 * base_size_pct * conviction_min),
    }


# ---------------------------------------------------------------------------
# Top-level evaluation
# ---------------------------------------------------------------------------

def evaluate(baselines_path: Path = BASELINES_PATH,
             trade_log_path: Path = TRADE_LOG_PATH,
             base_size_usd: float = 16.25) -> dict:
    """Current rung for every registered strategy. Safe to call at any time,
    including before either file exists."""
    baselines = load_baselines(baselines_path)
    reg = registered_at(baselines_path)
    if not baselines:
        return {
            "status": "no_baselines",
            "message": ("no pre-registered baselines at {} - run "
                        "research/degradation.py before relying on this monitor"
                        .format(baselines_path)),
            "registered_at": None,
            "strategies": {},
        }

    records = read_trade_log(trade_log_path)
    out = {}
    for key, bl in baselines.items():
        pnls = live_pnls(records, bl, since=reg)
        s = replay(pnls, bl)
        cfg_half = bl.rungs.get("half", {})
        next_fire = bl.boundary("half", max(s.n_trades, int(cfg_half.get("min_trades", 0)) or 1))
        out[key] = {
            "label": bl.label,
            "sleeve": bl.sleeve,
            "rung": s.rung,
            "size_multiplier": s.size_multiplier,
            "action": RUNG_ACTION[s.rung],
            "size_plan": size_plan(s.rung, base_size_usd),
            "n_live_trades": s.n_trades,
            "cum_pnl": round(s.cum_pnl, 6),
            "expected_pnl": round(s.expected_pnl, 6),
            "z": round(s.z, 3) if s.z is not None else None,
            "worst_rung_seen": s.worst_rung_seen,
            "first_demotion_n": s.first_demotion_n,
            "transitions": s.transitions,
            "min_trades_to_first_rung": int(cfg_half.get("min_trades", 0)),
            "next_boundary_half": round(next_fire, 6) if next_fire is not None else None,
            "baseline_mean": bl.mean,
            "baseline_stdev": bl.stdev,
            "baseline_n": bl.n_backtest_trades,
            "sufficient_data": s.n_trades >= int(cfg_half.get("min_trades", 0) or 0),
        }
    status = "ok" if records else "no_live_data"
    return {
        "status": status,
        "message": ("data/trade_log.jsonl does not exist or is empty - zero closed trades, "
                    "so every strategy sits at 'full' by default. That is the absence of "
                    "evidence, not evidence of health." if status == "no_live_data" else ""),
        "registered_at": reg,
        "strategies": out,
    }


def format_report(rep: dict) -> str:
    lines = []
    lines.append("=" * 96)
    lines.append("DEGRADATION MONITOR")
    lines.append("=" * 96)
    if rep["status"] == "no_baselines":
        lines.append("  " + rep["message"])
        return "\n".join(lines)
    lines.append("  baselines registered at: {}".format(rep["registered_at"]))
    if rep["message"]:
        lines.append("  " + rep["message"])
    for key, s in sorted(rep["strategies"].items()):
        lines.append("")
        lines.append("  {:<34} rung={:<8} size x{:.2f}   {}".format(
            s["label"], s["rung"], s["size_multiplier"], s["action"]))
        lines.append("    live n={:<4} cum {:+.2%} vs expected {:+.2%}   z={}   "
                     "worst rung seen: {}".format(
                         s["n_live_trades"], s["cum_pnl"], s["expected_pnl"],
                         "{:+.2f}".format(s["z"]) if s["z"] is not None else "n/a",
                         s["worst_rung_seen"]))
        if not s["sufficient_data"]:
            lines.append("    no rung can fire until n>={} (pre-registered minimum sample)"
                         .format(s["min_trades_to_first_rung"]))
        sp = s["size_plan"]
        if sp["note"]:
            lines.append("    SIZE: {}".format(sp["note"]))
        for (n, a, b, why) in s["transitions"]:
            lines.append("    trade {:<4} {} -> {}  ({})".format(n, a, b, why))
    return "\n".join(lines)


def main():
    print(format_report(evaluate()))


if __name__ == "__main__":
    main()
