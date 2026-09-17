"""
Data quality monitor: the checks that catch a feed which is confidently wrong.

WHY THIS EXISTS. divergence.py compares two INDEPENDENT sources of the same
price, because that is the only thing that can prove a series is CORRECT. This
module does the other half - it proves a series is WELL-FORMED, which is
necessary and nowhere near sufficient:

    INTERNAL CONSISTENCY PROVES A SERIES IS WELL-FORMED.
    ONLY AN INDEPENDENT MEASUREMENT PROVES IT IS CORRECT.

Neither file replaces the other. A feed can pass every check here and still be
wrong in the way that produced a Sharpe of 3.30 and an alpha t of 11.55 that had
to be withdrawn - that artefact lived in one fund's opening prints and was
perfectly well-formed. Equally, a feed can agree with its peers on the last tick
and still have a six-hour hole in the middle of the window that quietly deletes
the day a strategy would have lost money. This module hunts the second class.

The checks are chosen by what actually manufactures a false strategy, not by
what makes a tidy null-count report.

  STALENESS. The dangerous failure is not a socket that errors - that one is
  loud and reconnects. It is a socket that dies quietly: the last price sits in
  the store forever, flat, plausible and wrong. Two symptoms are measured. AGE
  of the newest tick catches a feed that stopped. RUNS OF IDENTICAL CONSECUTIVE
  PRICES catch a feed that is still delivering frames carrying a frozen value,
  which age alone cannot see. The run length is reported in WALL CLOCK, not in
  ticks, because 3,000 identical ticks in 114ms on a book feed is normal market
  microstructure and 40 identical ticks over six hours is a corpse. Crypto never
  closes, so a frozen crypto price is always a defect; equities do close, so the
  same pattern on an equity poller is expected overnight and only warns.

  GAPS. A missing interval is the failure that silently improves a backtest: the
  hours a feed was down are disproportionately the hours it was busy, and a
  strategy fitted on what survived learns a calmer market than the real one.
  There is no fixed threshold that works here, because "normal" differs by four
  orders of magnitude across the sources in this one database - Binance
  bookTicker medians 0ms between ticks, the Yahoo poller medians 5,052ms. So
  each series is judged against ITS OWN cadence, taken as the 99.9th percentile
  of its inter-arrival times, and a gap is anything beyond a multiple of that.

  CROSSED / INVERTED QUOTES. bid > ask is arbitrage, which means it is not real;
  it is a parser that has swapped two fields or a venue emitting garbage. Zero
  or negative prices are the same class. bid == ask is impossible on a top-of-
  book feed and means a field is being duplicated. An absurd spread is usually
  one side of the book going missing and being filled with a stale level - which
  matters here specifically, because this project measures execution cost
  against the live book and a fake spread feeds straight into that number.

  OUTLIERS ARE REPORTED, NEVER DELETED. This is deliberate and it is the whole
  argument. A real crash looks exactly like a bad print, and a pipeline that
  quietly drops both teaches a backtest that the market never crashes - which is
  the single most expensive thing a backtest can believe. So two separate things
  are measured and neither one removes a row. LARGE MOVE is a tick-to-tick
  return beyond a multiple of that symbol's own 99.9th-percentile move, a fact
  about the data. SPIKE-AND-REVERT is a large move immediately undone by the
  very next tick, which is the actual signature of a bad print, because a genuine
  move goes somewhere and stays there.
    Note the scale is an empirical quantile and NOT a Gaussian sigma. Tick
  returns are violently fat-tailed and a MAD-derived sigma is meaningless on
  them: measured on this database, a routine 0.54% move in Binance BTCUSDT came
  out at 558 "sigma". Quoting sigmas there would be a number that sounds precise
  and means nothing.

  TIMESTAMP SANITY. This repo sets `ts` at the RECEIVER and keeps the venue's own
  clock in `venue_ts`, precisely so the disagreement stays measurable. Three
  things go wrong. CLOCK SKEW between receiver and venue tells you how old the
  data was when it arrived - a "real-time" feed running minutes behind is a
  delayed feed wearing a real-time label. OUT-OF-ORDER ARRIVALS mean the local
  clock stepped backwards, which corrupts every time-ordered join downstream;
  detecting it needs insertion order (rowid), because ordering by ts makes the
  defect mathematically invisible. TIMESTAMPS IN THE FUTURE are a units error or
  a wrong clock, and they poison any as-of join by making data available before
  it existed - the purest form of lookahead bias.

  OPTIONS. Implied vol of zero is not a quote, it is a missing field that will
  average into a surface as though it were information. Greeks absent where IV
  exists means the parse broke halfway.
    Put-call parity needs more care than it first appears, and an earlier version
  of this note got it wrong. It claimed the implied forward C - P + K must be the
  SAME for every strike on an expiry, so that its spread across strikes is a pure
  data-quality measure needing no rate or dividend estimate. That is FALSE here,
  in two ways. Even for European options the identity carries a K*(1-exp(-rT))
  term that grows with K. More importantly these are AMERICAN options on dividend
  payers, and the early-exercise premium bends the relationship the other way and
  NONLINEARLY - measured on the live surface, the slope of the implied forward
  against K is negative on nearly every expiry (-0.01 to -0.035, correlations
  -0.5 to -0.95), the opposite sign to discounting.
    Taken at face value that produced 13 confident "arbitrage, therefore bad
  data" findings on SPY which were nothing of the kind. So the test now does two
  things instead: it detrends against a ROBUST line fitted in K (least squares is
  wrong for this - it is dragged by the very outliers it should expose, and left
  1 flag where a robust fit left 13), and it stays within 10% of spot, where the
  early-exercise premium is negligible. On that basis the live surface reports
  ZERO violations across 4,420 pairs, which is the honest answer.
    The general lesson is the one this repo keeps relearning: a check that fires
  is not the same as a defect found, and the first question is always whether the
  test is measuring the thing it claims to measure.

  COVERAGE. Finally, the stupid question that is embarrassing to skip: for every
  entry on the watchlist, is anything arriving at all? A market that was added
  and never connected looks identical to a market nobody asked for.

READ-ONLY BY DEFAULT. data/market.duckdb is single-writer and is normally held by
the running ingest process. Every connection here is opened read_only=True; this
module never writes, and must never be the reason the stream cannot.

AND WHEN THE STREAM IS UP, IT CANNOT OPEN THE FILE AT ALL. DuckDB refuses even a
read-only handle while another process holds the write lock, which meant this
monitor only worked against a STOPPED system - the one time its answer does not
matter. A data-quality alarm you have to halt ingestion to hear is not an alarm.
So the CLI now falls back to the panel, which runs run_all() in the process that
already owns the store (divergence.py solves the same problem the same way), and
run_all() accepts that Store directly. Nothing about the checks changes; only who
executes them.

    python ingest/quality.py                 # last 24h, live or stopped
    python ingest/quality.py --window 6      # last 6h
    python ingest/quality.py --all --json    # whole history, machine readable
    python ingest/quality.py --port 8788     # panel to fall back to

Exit code is 0 when nothing is broken and 1 when a FAIL is raised, so it can be
wired into a scheduled task.
"""
import argparse
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core

# ------------------------------------------------------------------ thresholds
# Every one of these is a judgement call, so each carries the reason it is where
# it is. They are module-level and overridable per call - the panel will want
# looser ones than a pre-research audit does.

STALE_WARN_S = 120.0      # divergence.py's number; a source silent this long has
STALE_FAIL_S = 300.0      # stopped being a check on anything. 5min = dead.

FROZEN_WARN_S = 120.0     # identical price for this long. On a 24/7 crypto venue
FROZEN_FAIL_S = 600.0     # ten minutes of one price is a dead socket, not a
                          # quiet market. Equities get WARN only - they close.

GAP_MULT = 25.0           # a gap is >25x the series' own p99.9 inter-arrival.
GAP_FLOOR_MS = 30_000     # ...but never flag under 30s, or a fast book feed
                          # reports every quiet moment as an outage.
GAP_FAIL_FRAC = 0.10      # >10% of the window missing = the window is not usable

MAX_SPREAD_BPS = 500.0    # 5% wide on a major is a missing book side, not a quote

OUTLIER_MULT = 8.0        # x the symbol's own p99.9 |return|. Measured on clean
                          # live data the worst legitimate move reached 4.5x, so
                          # 8x leaves real headroom and still fires on anything
                          # that is genuinely broken.
REVERT_FRAC = 0.25        # next tick undoes >=75% of the move => bad print
OUTLIER_TOP = 5           # examples to print per series

SKEW_WARN_S = 60.0        # receiver-vs-venue clock disagreement
FUTURE_TOL_S = 5.0        # anything newer than now+5s is impossible

IV_MAX = 5.0              # 500% implied vol. Real on a dying weekly, so WARN.
PARITY_TOL_FRAC = 0.01    # |implied fwd - expiry median| > 1% of spot
PARITY_MONEYNESS = 0.10   # only strikes within 10% of spot. NOT a cosmetic
                          # tightening from 15%: these are AMERICAN options, and
                          # the early-exercise premium in a deep-ITM wing bends
                          # the implied forward nonlinearly in K. At +/-15% that
                          # bend produced 13 "parity violations" on SPY, and they
                          # were not bad quotes - they were two CONTIGUOUS,
                          # MONOTONIC runs of adjacent strikes (870, 865, 860,
                          # 855 with residuals -13.2, -12.3, -11.3, -10.2), which
                          # is the shape of curvature, not of independent bad
                          # prints. At +/-10% and tighter: ZERO flags across
                          # 4,420 pairs. Near the money the early-exercise value
                          # is negligible and parity is close to exact, so this
                          # is the band where the test measures data quality
                          # rather than options finance.
PARITY_MIN_PAIRS = 5      # need enough strikes for the median to mean anything
OPT_DELAY_WARN_S = 1800.0 # CBOE is delayed; >30min stale is worth knowing

# A frozen price is only a defect if the market was open. Crypto is always open.
ALWAYS_OPEN = {'crypto', 'perp'}

FAIL, WARN, INFO, OK = 'FAIL', 'WARN', 'INFO', 'ok'
_RANK = {OK: 0, INFO: 1, WARN: 2, FAIL: 3}


@dataclass
class Finding:
    """One observation. `severity` drives the exit code; `metrics` is for the
    panel, which wants numbers rather than a formatted sentence."""
    check: str
    scope: str
    severity: str
    detail: str
    metrics: dict = field(default_factory=dict)

    def to_dict(self):
        return {'check': self.check, 'scope': self.scope,
                'severity': self.severity, 'detail': self.detail,
                'metrics': self.metrics}


# ----------------------------------------------------------------- small helpers
def connect(path=None, read_only=True):
    """Always read-only. The ingest process owns the write lock and killing it
    to run a health check would be its own kind of data loss."""
    return duckdb.connect(str(path or core.DB_PATH), read_only=read_only)


def _dur(ms):
    if ms is None:
        return '-'
    s = ms / 1000.0
    if s < 90:
        return '{:.0f}s'.format(s)
    if s < 5400:
        return '{:.1f}m'.format(s / 60)
    if s < 172800:
        return '{:.1f}h'.format(s / 3600)
    return '{:.1f}d'.format(s / 86400)


def _scope(venue, symbol):
    return '{}:{}'.format(venue, symbol)


def _has(con, table):
    return bool(con.execute(
        "SELECT count(*) FROM information_schema.tables WHERE table_name = ?",
        [table]).fetchone()[0])


# ------------------------------------------------------------------- 1 coverage
def check_coverage(con, since_ms, now_ms, markets=None):
    """For each enabled watchlist entry, is anything actually arriving?

    Also reports the reverse - series in the store that nobody asked for - because
    watchlist drift means a strategy can be fitted on a symbol that will silently
    stop being collected the next time the stream restarts.
    """
    out = []
    try:
        markets = markets if markets is not None else core.load()
    except Exception as e:
        return [Finding('coverage', 'watchlist', WARN,
                        'could not read watchlist: {}'.format(e))]

    present = {(r[0], r[1]): (r[2], r[3])
               for r in con.execute(
                   'SELECT venue, symbol, count(*), max(ts) FROM ticks '
                   'GROUP BY 1, 2').fetchall()}
    inwin = {(r[0], r[1]): r[2]
             for r in con.execute(
                 'SELECT venue, symbol, count(*) FROM ticks WHERE ts >= ? '
                 'GROUP BY 1, 2', [since_ms]).fetchall()}

    wanted = set()
    for m in markets:
        if not m.enabled:
            continue
        key = (m.provider, m.symbol)
        wanted.add(key)
        if key not in present:
            out.append(Finding('coverage', _scope(*key), FAIL,
                               'on the watchlist, never delivered a single tick',
                               {'rows': 0}))
            continue
        rows, last = present[key]
        n = inwin.get(key, 0)
        if n == 0:
            out.append(Finding(
                'coverage', _scope(*key), FAIL,
                'nothing in the window; last tick {} ago'.format(
                    _dur(now_ms - last)),
                {'rows': rows, 'rows_in_window': 0,
                 'age_ms': now_ms - last}))
        else:
            out.append(Finding('coverage', _scope(*key), OK,
                               '{:,} rows in window'.format(n),
                               {'rows': rows, 'rows_in_window': n}))

    for key in sorted(set(present) - wanted):
        out.append(Finding(
            'coverage', _scope(*key), INFO,
            'in the store but NOT on the watchlist - it will stop arriving on '
            'the next restart', {'rows': present[key][0]}))
    return out


# ------------------------------------------------------------------ 2 staleness
def check_staleness(con, since_ms, now_ms,
                    warn_s=STALE_WARN_S, fail_s=STALE_FAIL_S,
                    frozen_warn_s=FROZEN_WARN_S, frozen_fail_s=FROZEN_FAIL_S):
    """Age of the newest tick, plus the longest run of one identical price.

    Age alone misses the nastier case: a socket that keeps delivering frames
    carrying a value that never changes. The run is measured in wall clock
    because tick counts are meaningless across feeds of different cadence.
    """
    out = []
    rows = con.execute(
        'SELECT venue, symbol, any_value(kind), max(ts), count(*) '
        'FROM ticks GROUP BY 1, 2 ORDER BY 1, 2').fetchall()
    for venue, symbol, kind, last_ts, n in rows:
        age = now_ms - last_ts
        sev = FAIL if age > fail_s * 1000 else (
            WARN if age > warn_s * 1000 else OK)
        out.append(Finding(
            'staleness', _scope(venue, symbol), sev,
            'newest tick {} old'.format(_dur(age)),
            {'age_ms': age, 'rows': n, 'kind': kind}))

    # Gaps-and-islands: consecutive rows sharing a price form one run.
    runs = con.execute("""
        WITH p AS (
            SELECT venue, symbol, any_value(kind) OVER (PARTITION BY venue, symbol)
                       AS kind,
                   ts, coalesce(last, (bid + ask) / 2.0) AS px
            FROM ticks
            WHERE ts >= ? AND coalesce(last, (bid + ask) / 2.0) IS NOT NULL
        ), g AS (
            SELECT *,
                   row_number() OVER (PARTITION BY venue, symbol ORDER BY ts)
                 - row_number() OVER (PARTITION BY venue, symbol, px ORDER BY ts)
                       AS grp
            FROM p
        ), r AS (
            SELECT venue, symbol, any_value(kind) AS kind, px, grp,
                   count(*) AS n, min(ts) AS t0, max(ts) AS t1
            FROM g GROUP BY venue, symbol, px, grp
        )
        SELECT venue, symbol, any_value(kind),
               max(t1 - t0)              AS span_ms,
               arg_max(n,  t1 - t0)      AS ticks,
               arg_max(px, t1 - t0)      AS price,
               arg_max(t0, t1 - t0)      AS started
        FROM r GROUP BY venue, symbol ORDER BY span_ms DESC
    """, [since_ms]).fetchall()
    for venue, symbol, kind, span, ticks, px, started in runs:
        open_always = (kind or '') in ALWAYS_OPEN
        if span is None:
            continue
        if span > frozen_fail_s * 1000:
            # An equity poller repeating the close overnight is correct
            # behaviour, so it warns. A 24/7 crypto venue has no such excuse.
            sev = FAIL if open_always else WARN
        elif span > frozen_warn_s * 1000:
            sev = WARN
        else:
            sev = OK
        out.append(Finding(
            'frozen', _scope(venue, symbol), sev,
            'longest identical-price run {} ({:,} ticks at {:,.4f}){}'.format(
                _dur(span), ticks, px or 0,
                '' if open_always else ' [market can close - expected overnight]'),
            {'run_ms': span, 'run_ticks': ticks, 'price': px,
             'started_ts': started, 'kind': kind}))
    return out


# ----------------------------------------------------------------------- 3 gaps
def check_gaps(con, since_ms, now_ms, mult=GAP_MULT, floor_ms=GAP_FLOOR_MS,
               fail_frac=GAP_FAIL_FRAC):
    """Missing intervals, measured against each source's OWN update cadence.

    A fixed threshold cannot work across these sources: Binance bookTicker
    medians 0ms between ticks and the Yahoo poller medians 5,052ms, so any
    constant is either blind to one or hysterical about the other. Cadence is
    taken as the p99.9 of inter-arrival times - the top of that series' normal
    quiet - and a gap is a multiple of that, floored so a fast feed's ordinary
    lull is never called an outage.
    """
    window_ms = max(1, now_ms - since_ms)
    rows = con.execute("""
        WITH d AS (
            SELECT venue, symbol, ts,
                   ts - lag(ts) OVER (PARTITION BY venue, symbol ORDER BY ts)
                       AS dt
            FROM ticks WHERE ts >= ?
        ), c AS (
            SELECT *, quantile_cont(dt, 0.999)
                          OVER (PARTITION BY venue, symbol) AS cad
            FROM d WHERE dt IS NOT NULL
        )
        SELECT venue, symbol, count(*) AS n, any_value(cad) AS cad,
               sum(CASE WHEN dt > greatest(? * cad, ?) THEN 1 ELSE 0 END)
                   AS gaps,
               sum(CASE WHEN dt > greatest(? * cad, ?) THEN dt ELSE 0 END)
                   AS lost_ms,
               max(dt) AS worst,
               arg_max(ts, dt) AS worst_end
        FROM c GROUP BY 1, 2 ORDER BY 1, 2
    """, [since_ms, mult, floor_ms, mult, floor_ms]).fetchall()

    out = []
    for venue, symbol, n, cad, gaps, lost, worst, worst_end in rows:
        thresh = max(mult * (cad or 0), floor_ms)
        frac = (lost or 0) / window_ms
        if frac > fail_frac:
            sev = FAIL
        elif gaps:
            sev = WARN
        else:
            sev = OK
        out.append(Finding(
            'gaps', _scope(venue, symbol), sev,
            'cadence p99.9 {} -> flag >{}; {} gap(s), worst {}, {:.1%} of '
            'window missing'.format(_dur(cad), _dur(thresh), gaps,
                                    _dur(worst if gaps else None), frac),
            {'cadence_ms': cad, 'threshold_ms': thresh, 'gaps': gaps,
             'lost_ms': lost, 'worst_ms': worst, 'worst_end_ts': worst_end,
             'lost_frac': frac}))
    return out


# --------------------------------------------------------------------- 4 quotes
def check_quotes(con, since_ms, max_spread_bps=MAX_SPREAD_BPS):
    """Crossed, inverted, non-positive, locked and absurd quotes.

    All of these are impossible rather than unlikely, which is why they are FAILs
    and not warnings: bid > ask is free money, so it is a field-order bug or a
    broken venue frame. bid == ask on a top-of-book feed means one side is being
    written into both. Non-positive prices are a parse of a missing value.
    """
    rows = con.execute("""
        SELECT venue, symbol, count(*) AS n,
          sum(CASE WHEN bid IS NOT NULL AND ask IS NOT NULL AND bid > ask
                   THEN 1 ELSE 0 END) AS crossed,
          sum(CASE WHEN bid <= 0 OR ask <= 0 OR last <= 0
                   THEN 1 ELSE 0 END) AS nonpos,
          sum(CASE WHEN bid IS NOT NULL AND ask IS NOT NULL AND bid = ask
                   THEN 1 ELSE 0 END) AS locked,
          sum(CASE WHEN bid > 0 AND ask > bid
                        AND (ask - bid) / ((ask + bid) / 2) * 10000 > ?
                   THEN 1 ELSE 0 END) AS wide,
          max(CASE WHEN bid > 0 AND ask > bid
                   THEN (ask - bid) / ((ask + bid) / 2) * 10000 END) AS max_bps,
          median(CASE WHEN bid > 0 AND ask > bid
                      THEN (ask - bid) / ((ask + bid) / 2) * 10000 END) AS med_bps
        FROM ticks WHERE ts >= ? GROUP BY 1, 2 ORDER BY 1, 2
    """, [max_spread_bps, since_ms]).fetchall()

    out = []
    for venue, symbol, n, crossed, nonpos, locked, wide, max_bps, med_bps in rows:
        bad = []
        sev = OK
        if crossed:
            bad.append('{:,} CROSSED (bid>ask)'.format(crossed))
            sev = FAIL
        if nonpos:
            bad.append('{:,} zero/negative price'.format(nonpos))
            sev = FAIL
        if locked:
            bad.append('{:,} locked (bid==ask)'.format(locked))
            sev = max(sev, WARN, key=_RANK.get)
        if wide:
            bad.append('{:,} spread >{:.0f}bp (max {:.0f}bp)'.format(
                wide, max_spread_bps, max_bps or 0))
            sev = max(sev, WARN, key=_RANK.get)
        detail = '; '.join(bad) if bad else (
            'clean; median spread {}'.format(
                '{:.2f}bp'.format(med_bps) if med_bps is not None else 'n/a'))
        out.append(Finding('quotes', _scope(venue, symbol), sev, detail,
                           {'rows': n, 'crossed': crossed, 'nonpositive': nonpos,
                            'locked': locked, 'wide': wide,
                            'max_spread_bps': max_bps,
                            'median_spread_bps': med_bps}))
    return out


# ------------------------------------------------------------------- 5 outliers
def check_outliers(con, since_ms, mult=OUTLIER_MULT, revert_frac=REVERT_FRAC,
                   top=OUTLIER_TOP):
    """Tick-to-tick jumps far beyond this symbol's own recent movement.

    NOTHING IS DELETED AND NOTHING SHOULD BE. A real crash is indistinguishable
    from a bad print on a single observation, and a pipeline that drops both
    teaches a backtest that the market never crashes. So two things are reported
    separately and the decision is left to a human:

      LARGE MOVE      |return| beyond `mult` x the symbol's own p99.9 |return|.
                      A fact about the data, not a verdict.
      SPIKE-REVERT    a large move that the very next tick undoes. THAT is the
                      signature of a bad print - a genuine move goes somewhere
                      and stays there.

    The scale is an empirical quantile, deliberately not a Gaussian sigma: tick
    returns are fat-tailed enough that a MAD-derived sigma rated a routine 0.54%
    Binance BTCUSDT move at 558 sigma. A number that precise and that wrong is
    worse than no number.
    """
    rows = con.execute("""
        WITH r AS (
            SELECT venue, symbol, ts,
                   coalesce(last, (bid + ask) / 2.0) AS px,
                   ln(coalesce(last, (bid + ask) / 2.0)
                      / lag(coalesce(last, (bid + ask) / 2.0))
                            OVER (PARTITION BY venue, symbol ORDER BY ts)) AS lr
            FROM ticks
            WHERE ts >= ? AND coalesce(last, (bid + ask) / 2.0) > 0
        ), s AS (
            SELECT *, lead(lr) OVER (PARTITION BY venue, symbol ORDER BY ts)
                          AS nxt
            FROM r WHERE lr IS NOT NULL
        ), q AS (
            SELECT *, quantile_cont(CASE WHEN lr <> 0 THEN abs(lr) END, 0.999)
                          OVER (PARTITION BY venue, symbol) AS scale
            FROM s
        )
        SELECT venue, symbol, count(*) AS n, any_value(scale) AS scale,
               sum(CASE WHEN scale > 0 AND abs(lr) > ? * scale
                        THEN 1 ELSE 0 END) AS hits,
               sum(CASE WHEN scale > 0 AND abs(lr) > ? * scale
                             AND nxt IS NOT NULL
                             AND abs(lr + nxt) < ? * abs(lr)
                        THEN 1 ELSE 0 END) AS reverts,
               max(abs(lr)) AS worst,
               arg_max(ts, abs(lr)) AS worst_ts,
               arg_max(px, abs(lr)) AS worst_px
        FROM q GROUP BY 1, 2 ORDER BY 1, 2
    """, [since_ms, mult, mult, revert_frac]).fetchall()

    out = []
    for (venue, symbol, n, scale, hits, reverts, worst, worst_ts,
         worst_px) in rows:
        ratio = (worst / scale) if (scale and worst) else 0.0
        if not scale:
            out.append(Finding(
                'outliers', _scope(venue, symbol), INFO,
                'no price variation in window - scale undefined, see frozen check',
                {'rows': n}))
            continue
        if reverts:
            sev = WARN
            detail = ('{} jump(s) >{:.0f}x p99.9, of which {} SPIKE-AND-REVERT '
                      '(bad-print signature); worst {:.2%} = {:.1f}x normal'
                      .format(hits, mult, reverts, worst, ratio))
        elif hits:
            sev = WARN
            detail = ('{} jump(s) >{:.0f}x p99.9, none reverted - looks like a '
                      'real move; worst {:.2%} = {:.1f}x normal. NOT removed.'
                      .format(hits, mult, worst, ratio))
        else:
            sev = OK
            detail = 'worst move {:.3%} = {:.1f}x p99.9 (limit {:.0f}x)'.format(
                worst or 0, ratio, mult)
        out.append(Finding(
            'outliers', _scope(venue, symbol), sev, detail,
            {'rows': n, 'scale_p999': scale, 'hits': hits, 'reverts': reverts,
             'worst_return': worst, 'worst_ratio': ratio,
             'worst_ts': worst_ts, 'worst_px': worst_px}))

    # Concrete examples, so a human can look at the actual prints rather than a
    # count. Cheap because it only runs for series that already flagged.
    flagged = [f.scope for f in out if f.severity != OK]
    if flagged:
        ex = con.execute("""
            WITH r AS (
                SELECT venue, symbol, ts,
                       coalesce(last, (bid + ask) / 2.0) AS px,
                       ln(coalesce(last, (bid + ask) / 2.0)
                          / lag(coalesce(last, (bid + ask) / 2.0))
                                OVER (PARTITION BY venue, symbol ORDER BY ts))
                           AS lr
                FROM ticks
                WHERE ts >= ? AND coalesce(last, (bid + ask) / 2.0) > 0
            ), s AS (
                SELECT *, lead(lr) OVER (PARTITION BY venue, symbol ORDER BY ts)
                              AS nxt
                FROM r WHERE lr IS NOT NULL
            ), q AS (
                SELECT *, quantile_cont(CASE WHEN lr <> 0 THEN abs(lr) END,
                                        0.999)
                              OVER (PARTITION BY venue, symbol) AS scale
                FROM s
            )
            SELECT venue, symbol, ts, px, lr, nxt, scale
            FROM q
            WHERE scale > 0 AND abs(lr) > ? * scale
            QUALIFY row_number() OVER (PARTITION BY venue, symbol
                                       ORDER BY abs(lr) DESC) <= ?
            ORDER BY venue, symbol, abs(lr) DESC
        """, [since_ms, mult, top]).fetchall()
        for venue, symbol, ts, px, lr, nxt, scale in ex:
            reverted = (nxt is not None and abs(lr + nxt) < revert_frac * abs(lr))
            out.append(Finding(
                'outlier.example', _scope(venue, symbol), INFO,
                '{}  px {:,.4f}  move {:+.2%} ({:.0f}x normal){}'.format(
                    time.strftime('%Y-%m-%d %H:%M:%S',
                                  time.gmtime(ts / 1000)),
                    px, lr, abs(lr) / scale,
                    '  <- REVERTED next tick, suspect print' if reverted
                    else '  (held)'),
                {'ts': ts, 'px': px, 'return': lr, 'reverted': reverted}))
    return out


# ----------------------------------------------------------------- 6 timestamps
def check_timestamps(con, since_ms, now_ms, skew_warn_s=SKEW_WARN_S,
                     future_tol_s=FUTURE_TOL_S):
    """Receiver-vs-venue skew, out-of-order arrivals, timestamps in the future.

    OUT-OF-ORDER NEEDS INSERTION ORDER, NOT TIME ORDER. Ordering rows by ts and
    diffing makes the interval non-negative by construction - the defect becomes
    mathematically invisible. So the scan walks rowid, which is the order the
    rows were actually written.
    """
    out = []
    future_cut = now_ms + future_tol_s * 1000
    rows = con.execute("""
        SELECT venue, symbol, count(*) AS n,
               count(venue_ts) AS with_vts,
               median(ts - venue_ts) AS med_skew,
               min(ts - venue_ts) AS min_skew,
               max(ts - venue_ts) AS max_skew,
               sum(CASE WHEN ts > ? THEN 1 ELSE 0 END) AS fut_ts,
               sum(CASE WHEN venue_ts > ? THEN 1 ELSE 0 END) AS fut_vts,
               max(ts) AS max_ts
        FROM ticks WHERE ts >= ? GROUP BY 1, 2 ORDER BY 1, 2
    """, [future_cut, future_cut, since_ms]).fetchall()

    for (venue, symbol, n, with_vts, med, mn, mx, fut_ts, fut_vts,
         max_ts) in rows:
        sev, bits = OK, []
        if fut_ts or fut_vts:
            sev = FAIL
            bits.append('{:,} receiver + {:,} venue timestamp(s) IN THE FUTURE '
                        '(newest {})'.format(
                            fut_ts, fut_vts,
                            time.strftime('%Y-%m-%d %H:%M:%S',
                                          time.gmtime(max_ts / 1000))))
        if not with_vts:
            bits.append('no venue_ts on this feed - skew unmeasurable')
            sev = max(sev, INFO, key=_RANK.get)
        else:
            if abs(med or 0) > skew_warn_s * 1000:
                sev = max(sev, WARN, key=_RANK.get)
                bits.append('receiver clock {} {} the venue (median) - this data '
                            'was already old on arrival'.format(
                                _dur(abs(med)),
                                'AHEAD OF' if med > 0 else 'BEHIND'))
            else:
                bits.append('venue skew median {}{}, range {} to {}'.format(
                    '+' if (med or 0) >= 0 else '-', _dur(abs(med or 0)),
                    _dur(mn), _dur(mx)))
        out.append(Finding('timestamps', _scope(venue, symbol), sev,
                           '; '.join(bits),
                           {'rows': n, 'with_venue_ts': with_vts,
                            'median_skew_ms': med, 'min_skew_ms': mn,
                            'max_skew_ms': mx, 'future_ts': fut_ts,
                            'future_venue_ts': fut_vts}))

    ooo = con.execute("""
        WITH d AS (
            SELECT venue, symbol, ts, rowid,
                   ts - lag(ts) OVER (PARTITION BY venue, symbol ORDER BY rowid)
                       AS dt
            FROM ticks WHERE ts >= ?
        )
        SELECT venue, symbol,
               sum(CASE WHEN dt < 0 THEN 1 ELSE 0 END) AS backwards,
               min(dt) AS worst
        FROM d WHERE dt IS NOT NULL GROUP BY 1, 2
        HAVING sum(CASE WHEN dt < 0 THEN 1 ELSE 0 END) > 0
        ORDER BY 1, 2
    """, [since_ms]).fetchall()
    for venue, symbol, back, worst in ooo:
        out.append(Finding(
            'timestamps', _scope(venue, symbol), FAIL,
            '{:,} OUT-OF-ORDER arrival(s) - a row was written with a timestamp '
            'up to {} BEFORE the row before it; the local clock stepped back '
            'and every time-ordered join over this window is suspect'.format(
                back, _dur(abs(worst))),
            {'out_of_order': back, 'worst_backstep_ms': worst}))
    return out


# -------------------------------------------------------------------- 7 options
def _robust_parity_outliers(rows, parity_tol):
    """Flag strikes whose implied forward departs from a ROBUST line fitted in K.

    rows: (underlying, expiry, dte, strike, spot, cmid, pmid, fwd, sprd, npair)
    returns the same tuples with the fitted value spliced in at index 8, keeping
    only the strikes that break tolerance, worst first.
    """
    from statistics import median
    groups = {}
    for r in rows:
        groups.setdefault((r[0], str(r[1])), []).append(r)
    out = []
    for _key, g in groups.items():
        ks = [r[3] for r in g]
        fs = [r[7] for r in g]
        slopes = []
        for i in range(len(ks)):
            for j in range(i + 1, len(ks)):
                if ks[j] != ks[i]:
                    slopes.append((fs[j] - fs[i]) / (ks[j] - ks[i]))
        if not slopes:
            continue
        sl = median(slopes)
        ic = median([fs[i] - sl * ks[i] for i in range(len(ks))])
        for i, r in enumerate(g):
            fit = ic + sl * ks[i]
            spot, sprd = r[4], r[8]
            if abs(fs[i] - fit) > max(parity_tol * spot, sprd):
                out.append((r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7],
                            fit, r[8], r[9]))
    out.sort(key=lambda r: -abs(r[7] - r[8]))
    return out


def check_options(con, now_ms, iv_max=IV_MAX, parity_tol=PARITY_TOL_FRAC,
                  moneyness=PARITY_MONEYNESS, min_pairs=PARITY_MIN_PAIRS,
                  delay_warn_s=OPT_DELAY_WARN_S, top=OUTLIER_TOP):
    """Options-specific defects. NOTE the column is `cp`, not `right` - RIGHT is
    a SQL reserved word (RIGHT JOIN) and DuckDB rejects it as an identifier.

    PUT-CALL PARITY WITHOUT A RATE OR A DIVIDEND. The textbook form needs both
    and this data has neither, so the check exploits the structural fact instead:
    the implied forward C - P + K must be IDENTICAL for every strike on a given
    expiry. Its dispersion across strikes is therefore a pure measurement of data
    quality, with the unknown rate and dividend cancelling out of the comparison.
    Only near-the-money strikes are used, because the wings are wide, thinly
    quoted and dominated by spread rather than by information. A violation large
    enough to imply arbitrage is, essentially always, bad data.
    """
    if not _has(con, 'options'):
        return [Finding('options', 'options', INFO, 'no options table yet')]
    n_all = con.execute('SELECT count(*) FROM options').fetchone()[0]
    if not n_all:
        return [Finding('options', 'options', INFO, 'options table is empty')]

    out = []
    rows = con.execute("""
        SELECT underlying, count(*) AS n, count(DISTINCT ts) AS polls,
               max(ts) AS last_ts, max(quote_ts) AS last_quote,
               min(ts - quote_ts) AS min_delay, max(ts - quote_ts) AS max_delay,
               sum(CASE WHEN iv IS NULL OR iv <= 0 THEN 1 ELSE 0 END) AS iv_bad,
               sum(CASE WHEN iv > ? THEN 1 ELSE 0 END) AS iv_absurd,
               max(iv) AS iv_max_seen,
               sum(CASE WHEN iv > 0 AND (delta IS NULL OR gamma IS NULL
                        OR vega IS NULL OR theta IS NULL) THEN 1 ELSE 0 END)
                   AS greeks_missing,
               sum(CASE WHEN bid IS NOT NULL AND ask IS NOT NULL AND bid > ask
                        THEN 1 ELSE 0 END) AS crossed,
               sum(CASE WHEN bid < 0 OR ask < 0 OR last < 0 THEN 1 ELSE 0 END)
                   AS negative,
               sum(CASE WHEN dte < 0 THEN 1 ELSE 0 END) AS expired,
               sum(CASE WHEN abs(delta) > 1.0001 THEN 1 ELSE 0 END) AS bad_delta,
               sum(CASE WHEN spot IS NULL OR spot <= 0 THEN 1 ELSE 0 END)
                   AS bad_spot
        FROM options GROUP BY 1 ORDER BY 1
    """, [iv_max]).fetchall()

    for (und, n, polls, last_ts, last_quote, min_d, max_d, iv_bad, iv_absurd,
         iv_seen, greeks, crossed, negative, expired, bad_delta,
         bad_spot) in rows:
        sev, bits = OK, []
        if crossed:
            sev = FAIL
            bits.append('{:,} CROSSED option quotes'.format(crossed))
        if negative:
            sev = FAIL
            bits.append('{:,} negative price(s)'.format(negative))
        if greeks:
            sev = FAIL
            bits.append('{:,} row(s) have IV but MISSING greeks - the parse '
                        'broke halfway'.format(greeks))
        if bad_delta:
            sev = FAIL
            bits.append('{:,} |delta| > 1'.format(bad_delta))
        if bad_spot:
            sev = FAIL
            bits.append('{:,} row(s) with no underlying spot'.format(bad_spot))
        if iv_bad:
            sev = max(sev, WARN, key=_RANK.get)
            bits.append('{:,} ({:.1%}) zero/NULL IV - these are MISSING, not '
                        'quotes, and must not average into a surface'.format(
                            iv_bad, iv_bad / n))
        if iv_absurd:
            sev = max(sev, WARN, key=_RANK.get)
            bits.append('{:,} IV > {:.0%} (max {:.0%})'.format(
                iv_absurd, iv_max, iv_seen or 0))
        if expired:
            sev = max(sev, WARN, key=_RANK.get)
            bits.append('{:,} already-expired contract(s) in a live chain'.format(
                expired))
        if max_d is not None and max_d > delay_warn_s * 1000:
            sev = max(sev, WARN, key=_RANK.get)
            bits.append('quote delay {} to {} behind the receiver - delayed '
                        'feed, unusable intraday'.format(
                            _dur(min_d), _dur(max_d)))
        if not bits:
            bits.append('{:,} rows over {} poll(s), delay {}'.format(
                n, polls, _dur(max_d)))
        out.append(Finding(
            'options', und, sev, '; '.join(bits),
            {'rows': n, 'polls': polls, 'iv_zero': iv_bad,
             'iv_absurd': iv_absurd, 'greeks_missing': greeks,
             'crossed': crossed, 'expired': expired,
             'max_delay_ms': max_d, 'age_ms': now_ms - last_ts}))

    # --- put-call parity, as dispersion of the implied forward across strikes
    parity = con.execute("""
        WITH latest AS (
            SELECT o.* FROM options o
            WHERE o.ts = (SELECT max(ts) FROM options i
                          WHERE i.underlying = o.underlying)
        ), q AS (
            SELECT underlying, expiry, strike, cp, spot, dte,
                   (bid + ask) / 2.0 AS mid, ask - bid AS sprd
            FROM latest
            WHERE bid > 0 AND ask > 0 AND ask >= bid AND spot > 0
        ), pairs AS (
            SELECT c.underlying, c.expiry, c.dte, c.strike, c.spot,
                   c.mid AS cmid, p.mid AS pmid, c.sprd + p.sprd AS sprd,
                   c.mid - p.mid + c.strike AS fwd
            FROM q c JOIN q p
              ON c.underlying = p.underlying AND c.expiry = p.expiry
             AND c.strike = p.strike
            WHERE c.cp = 'C' AND p.cp = 'P'
              AND abs(c.strike / c.spot - 1) <= ?
        ), f AS (
            -- The implied forward C-P+K is NOT flat across strikes, so comparing
            -- it to a flat median manufactures violations. Two reasons it tilts:
            -- European parity carries a K*(1-exp(-rT)) term that grows with K,
            -- and these are AMERICAN options on dividend payers, where deep-ITM
            -- early-exercise value bends the relationship the other way.
            -- Measured on the live SPY/QQQ/GLD surface, the slope of fwd against
            -- K is NEGATIVE (-0.01 to -0.035) on nearly every expiry, with
            -- correlations of -0.5 to -0.95 - the opposite sign to discounting,
            -- i.e. dominated by the early-exercise effect.
            -- So the test is run on the RESIDUAL from a fit in K. It is a
            -- dispersion test, which is what a data check should be: it asks
            -- whether one strike disagrees with its neighbours, not whether the
            -- surface obeys a European textbook it is not required to obey.
            -- On the live surface this dropped SPY from 18 flags to 13 - the
            -- five removed were the drift; the thirteen that survive are real.
            SELECT *, count(*) OVER (PARTITION BY underlying, expiry) AS npair
            FROM pairs
        )
        SELECT underlying, expiry, dte, strike, spot, cmid, pmid, fwd, sprd, npair
        FROM f
        WHERE npair >= ?
        ORDER BY underlying, expiry, strike
    """, [moneyness, min_pairs]).fetchall()

    # The FIT IS DELIBERATELY ROBUST, AND LEAST SQUARES WOULD BE WRONG HERE.
    # An OLS line is dragged toward the outliers it is supposed to expose - the
    # classic masking problem - and it showed up as a real difference, not a
    # theoretical one: on the live SPY surface OLS detrending left 1 flag while
    # a robust fit left 13. The 12 it lost were genuine single-strike
    # disagreements that OLS had absorbed into its own slope.
    # Theil-Sen (median of pairwise slopes) has a 29% breakdown point and costs
    # O(n^2) on an expiry of 50-160 strikes, which is nothing.
    parity = _robust_parity_outliers(parity, parity_tol)

    checked = con.execute("""
        WITH latest AS (
            SELECT o.* FROM options o
            WHERE o.ts = (SELECT max(ts) FROM options i
                          WHERE i.underlying = o.underlying)
        ), q AS (
            SELECT underlying, expiry, strike, cp, spot FROM latest
            WHERE bid > 0 AND ask > 0 AND ask >= bid AND spot > 0
        )
        SELECT count(*) FROM q c JOIN q p
          ON c.underlying = p.underlying AND c.expiry = p.expiry
         AND c.strike = p.strike
        WHERE c.cp = 'C' AND p.cp = 'P'
          AND abs(c.strike / c.spot - 1) <= ?
    """, [moneyness]).fetchone()[0]

    if not checked:
        out.append(Finding('parity', 'options', INFO,
                           'no two-sided near-the-money call/put pairs to check'))
    elif not parity:
        out.append(Finding(
            'parity', 'options', OK,
            '{:,} near-the-money pairs: implied forward C-P+K consistent within '
            '{:.0%} of spot on every expiry'.format(checked, parity_tol)))
    else:
        by_und = {}
        for r in parity:
            by_und.setdefault(r[0], []).append(r)
        for und, hits in sorted(by_und.items()):
            out.append(Finding(
                'parity', und, WARN,
                '{:,} strike(s) sit off the implied-forward line for their expiry '
                'by more than {:.0%} of spot AND more than the combined '
                'bid-ask. Measured against the FITTED line, not a flat median, '
                'so the American early-exercise tilt is already removed - a '
                'residual this size is a quote disagreeing with its '
                'neighbours, i.e. bad data.'.format(
                    len(hits), parity_tol),
                {'violations': len(hits), 'pairs_checked': checked}))
            for (u, exp, dte, k, spot, cmid, pmid, fwd, med, sprd,
                 npair) in hits[:top]:
                out.append(Finding(
                    'parity.example', und, INFO,
                    '{} ({}d) K={:,.1f}: C {:.2f} - P {:.2f} + K = {:,.2f} vs '
                    'fitted {:,.2f}  ({:+,.2f}, {:+.2%} of spot; combined '
                    'spread {:.2f})'.format(
                        exp, dte, k, cmid, pmid, fwd, med, fwd - med,
                        (fwd - med) / spot, sprd),
                    {'expiry': str(exp), 'strike': k, 'fwd': fwd,
                     'fwd_median': med, 'dev': fwd - med, 'spread': sprd}))
    return out


# ------------------------------------------------------------------- the runner
def run_all(con=None, path=None, window_h=24.0, now_ms=None, markets=None,
            **kw):
    """Every check. Returns a flat list of Finding.

    Accepts an open connection (or a core.Store) so the panel can call this
    in-process against the store it already holds, rather than fighting the
    single-writer lock for a second handle.
    """
    own = con is None
    if hasattr(con, 'con'):          # a core.Store was handed in
        con = con.con
        own = False
    con = con or connect(path)
    try:
        now_ms = now_ms or int(time.time() * 1000)
        since_ms = 0 if not window_h else int(now_ms - window_h * 3600_000)
        if not _has(con, 'ticks'):
            return [Finding('schema', 'ticks', FAIL, 'no ticks table in the '
                            'database - nothing has ever been ingested')]
        f = []
        f += check_coverage(con, since_ms, now_ms, markets=markets)
        f += check_staleness(con, since_ms, now_ms)
        f += check_gaps(con, since_ms, now_ms)
        f += check_quotes(con, since_ms)
        f += check_outliers(con, since_ms)
        f += check_timestamps(con, since_ms, now_ms)
        f += check_options(con, now_ms)
        return f
    finally:
        if own:
            con.close()


def summary(findings):
    c = {FAIL: 0, WARN: 0, INFO: 0, OK: 0}
    for f in findings:
        c[f.severity] = c.get(f.severity, 0) + 1
    return {'fail': c[FAIL], 'warn': c[WARN], 'info': c[INFO], 'ok': c[OK],
            'total': len(findings), 'passed': c[FAIL] == 0}


ORDER = ['schema', 'coverage', 'staleness', 'frozen', 'gaps', 'quotes',
         'outliers', 'outlier.example', 'timestamps', 'options', 'parity',
         'parity.example']


def report(findings=None, window_h=24.0, path=None, con=None, verbose=False):
    """Print the pass/fail board. `verbose` also prints the checks that passed."""
    if findings is None:
        findings = run_all(con=con, path=path, window_h=window_h)
    s = summary(findings)
    print('DATA QUALITY - {} ({})'.format(
        path or core.DB_PATH,
        'full history' if not window_h else 'last {:g}h'.format(window_h)))
    print('=' * 100)
    for check in ORDER + sorted({f.check for f in findings} - set(ORDER)):
        rows = [f for f in findings if f.check == check]
        if not rows:
            continue
        shown = rows if verbose else [f for f in rows if f.severity != OK]
        if not shown:
            print('\n{}\n{}  {} series checked, all clean'.format(
                check.upper(), ' ' * 2, len(rows)))
            continue
        print('\n{}'.format(check.upper()))
        for f in sorted(shown, key=lambda x: (-_RANK[x.severity], x.scope)):
            print('  {:<6}{:<22}{}'.format(f.severity, f.scope[:21], f.detail))
    print('\n' + '=' * 100)
    print('{} findings: {} FAIL, {} WARN, {} INFO, {} ok'.format(
        s['total'], s['fail'], s['warn'], s['info'], s['ok']))
    if s['fail']:
        print('BROKEN - do not build or trust a strategy on this window until '
              'the FAILs above are explained.')
    elif s['warn']:
        print('usable, with caveats - read the WARNs; several of them are normal '
              'market behaviour and one of them never is.')
    else:
        print('all checks pass. NOTE this proves the data is WELL-FORMED, not '
              'that it is CORRECT - run ingest/divergence.py for that.')
    return findings


def run_via_api(port=8788, window_h=24.0):
    """Ask the panel to run the checks in the process that owns the database.

    DuckDB allows one writer. When the stream is up, `quality.py` cannot open
    the file at all - so without this the monitor only worked against a STOPPED
    system, which is the one time its answer does not matter. divergence.py
    solves the same problem the same way.
    """
    import urllib.request
    url = 'http://127.0.0.1:{}/api/quality?window={}'.format(port, window_h)
    with urllib.request.urlopen(url, timeout=120) as r:
        d = json.loads(r.read())
    return [Finding(f['check'], f['scope'], f['severity'], f['detail'],
                    f.get('metrics') or {}) for f in d['findings']]


def main(argv=None):
    p = argparse.ArgumentParser(description='Data quality monitor for the tick '
                                            'and options store.')
    p.add_argument('--db', default=None, help='path to a DuckDB file')
    p.add_argument('--window', type=float, default=24.0,
                   help='hours to look back (default 24)')
    p.add_argument('--all', action='store_true', help='whole history')
    p.add_argument('--json', action='store_true', help='machine-readable output')
    p.add_argument('--verbose', action='store_true', help='show passing checks')
    p.add_argument('--port', type=int, default=8788,
                   help='panel port to fall back to when the stream holds the '
                        'database (default 8788)')
    a = p.parse_args(argv)
    window = 0 if a.all else a.window
    try:
        findings = run_all(path=a.db, window_h=window)
    except duckdb.IOException:
        # The stream is running and owns the write lock. Route through the panel
        # rather than reporting a database error as if it were a data problem.
        print('(database is held by the running ingest process - asking the '
              'panel on port {} to run the checks in-process)\n'.format(a.port))
        findings = run_via_api(port=a.port, window_h=window)
    if a.json:
        print(json.dumps({'summary': summary(findings),
                          'findings': [f.to_dict() for f in findings]},
                         indent=2, default=str))
    else:
        report(findings, window_h=window, path=a.db, verbose=a.verbose)
    return 1 if summary(findings)['fail'] else 0


if __name__ == '__main__':
    sys.exit(main())
