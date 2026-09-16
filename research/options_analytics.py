"""
Three tradeable quantities from the stored option surface: VRP, skew, term structure.

WHAT THIS IS FOR. ingest/options.py proved the data is obtainable and stores it.
This turns the surface into the three things that are actually INFORMATION rather
than restatements of price, and - just as importantly - refuses to report any of
them as a finding when the stored history cannot support it.

--------------------------------------------------------------------------------
MECHANISM FIRST, NUMBERS SECOND. Each of the three, with the counterparty named.
--------------------------------------------------------------------------------

1. VOLATILITY RISK PREMIUM. Implied vol systematically exceeds the realised vol
   that subsequently arrives. WHO IS ON THE OTHER SIDE AND WHY THEY CANNOT STOP:
   the buyer of index optionality is overwhelmingly a hedger under a mandate, not
   a speculator with a view - pension and insurance books with drawdown limits,
   vol-target and risk-parity funds whose exposure is a function of vol, banks
   hedging the short-vol exposure embedded in structured retail products. They buy
   protection because their mandate requires it, at whatever the screen says.
   WHY THE PREMIUM IS NOT ARBITRAGED AWAY: it is not a mispricing. The seller is
   short a payoff whose losses arrive precisely when every other asset he owns is
   also falling, with unbounded gap risk. That is genuinely undesirable exposure,
   so it is genuinely paid for. This is the key asymmetry to hold on to - the
   premium persists BECAUSE the tail is real, which means the tail will eventually
   arrive and a measurement that has not yet seen one is not evidence of safety.

2. SKEW. Puts are dearer than equidistant calls. Same hedger, plus dealers who are
   structurally long the calls retail sells and short the puts retail buys, and
   who charge for the inventory they cannot lay off. The LEVEL of skew is a
   near-constant of equity markets and carries almost no information. What carries
   information is the CHANGE: skew steepening while spot is still making highs
   means hedgers are bidding for protection ahead of a move, which is a different
   statement from "vol is high".

3. TERM STRUCTURE. Near-dated vs far-dated implied vol. Normally upward-sloping
   (contango) because near-dated vol is cheap to supply and far-dated vol carries
   more unknowns. It INVERTS under stress, and the inversion leads rather than
   lags because it is caused by a scramble for immediate protection rather than by
   the damage already done.

--------------------------------------------------------------------------------
THE TWO CONSTRAINTS THAT DECIDE WHAT MAY BE CLAIMED HERE
--------------------------------------------------------------------------------

DELAYED QUOTES. The CBOE payload carries its own timestamp, ingest/options.py
honours it in quote_ts, and the lag is MEASURED in section 0 rather than assumed.
Nothing in this file is an intraday signal and none is proposed. Everything here
is end-of-day by construction: a term-structure slope, a skew level and a 30-day
realised-vol comparison do not change materially over the observed lag. If a
future analysis needs quotes fresher than that, it must say so out loud rather
than quietly assume the stored surface can support it.

A SECOND, SHARPER CONSEQUENCE OF THE DELAY, found in the data rather than reasoned
from it: the CBOE file itself only refreshes periodically, so polling faster than
it updates yields the SAME quote again. The two polls in the database ten minutes
apart carry identical quote_ts values. Snapshots are therefore counted by DISTINCT
quote_ts, never by row-insert time, or the history would be overstated by exactly
the factor you poll at.

SELECTIVE STORAGE. store_chain() keeps only contracts with open interest or
volume. Section 5 MEASURES what that costs rather than speculating, by fetching
one chain with keep_all into a separate database and re-running the identical
analytics before and after applying the same filter. Short version of the result,
with the full numbers below: it barely touches ATM IV and 25-delta skew, and it
badly distorts any statistic built on a median across the whole smile - which
includes ingest/options.py's own surface() query.

--------------------------------------------------------------------------------
WHY IT CONNECTS TO A READ-ONLY DATABASE, AND WHAT THAT FORCED
--------------------------------------------------------------------------------
data/market.duckdb is held open by the collector, and DuckDB is single-writer, so
this connects read-only. ingest/options.py's surface() and skew() both call
ensure_schema() first, which issues CREATE TABLE IF NOT EXISTS - and DuckDB
rejects any CREATE on a read-only connection outright. Rather than reimplement
those two queries (and then have them drift), the connection is wrapped so DDL is
swallowed and everything else passes through. The real query in ingest/options.py
stays the single source of truth for what "skew" means in this project.
"""
import argparse
import datetime
import json
import math
import statistics as st
import sys
import time
from pathlib import Path

import duckdb
import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'research'))
sys.path.insert(0, str(ROOT / 'ingest'))

import tsx_data                      # noqa: E402  the project's Yahoo OHLC puller
import core as ingest_core           # noqa: E402  ingest/core.py, NOT the repo's core/ package
import options as opt                # noqa: E402  ingest/options.py

DB = ROOT / 'data' / 'market.duckdb'
CACHE = ROOT / 'research' / 'data'
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
TRADING_DAYS = 252


# ===========================================================================
# read-only plumbing
# ===========================================================================
class _NullResult:
    def fetchall(self):
        return []

    def fetchone(self):
        return None

    def df(self):
        raise RuntimeError('no dataframe on a swallowed DDL statement')


class _DDLSwallowingCon:
    """Passes reads through; turns CREATE/INSERT/DROP/... into no-ops.

    This exists for exactly one reason: to let ingest/options.py's surface() and
    skew() run unmodified against a read-only connection. It is deliberately
    whitelist-free and blunt - anything that would MUTATE is dropped on the floor,
    which is the correct behaviour for an analytics module that must never be the
    thing that corrupts the collector's database.
    """
    WRITE = {'CREATE', 'INSERT', 'DROP', 'ALTER', 'UPDATE', 'DELETE', 'COPY'}

    def __init__(self, con):
        self._con = con
        self.swallowed = 0

    def execute(self, sql, params=None):
        head = sql.strip().split(None, 1)[0].upper() if sql.strip() else ''
        if head in self.WRITE:
            self.swallowed += 1
            return _NullResult()
        return self._con.execute(sql, params) if params is not None else self._con.execute(sql)

    def executemany(self, *_a, **_k):
        self.swallowed += 1
        return _NullResult()


class ReadOnlyStore:
    """Duck-types ingest/core.Store closely enough for options.py's read queries."""

    def __init__(self, path=DB):
        self.raw = duckdb.connect(str(path), read_only=True)
        self.con = _DDLSwallowingCon(self.raw)

    def q(self, sql, params=None):
        return self.con.execute(sql, params).fetchall()

    def close(self):
        self.raw.close()


# ===========================================================================
# 0. what is actually in the database
# ===========================================================================
def inventory(store):
    """Snapshot audit. Counts DISTINCT quote_ts, not rows and not insert times.

    Returns one dict per underlying. `snapshots` is the only number that may be
    used to gate a time-series claim.
    """
    out = []
    for und, in store.q('SELECT DISTINCT underlying FROM options ORDER BY 1'):
        row = store.q("""
            SELECT count(*), count(DISTINCT quote_ts), count(DISTINCT ts),
                   min(quote_ts), max(quote_ts),
                   min(ts - quote_ts) / 60000.0, max(ts - quote_ts) / 60000.0,
                   count(DISTINCT expiry), max(spot)
            FROM options WHERE underlying = ?""", [und])[0]
        span = 0.0
        if row[3] and row[4]:
            span = (row[4] - row[3]) / 86_400_000.0
        out.append({'underlying': und, 'rows': row[0], 'snapshots': row[1],
                    'polls': row[2], 'first_q': row[3], 'last_q': row[4],
                    'span_days': span, 'lag_min_lo': row[5], 'lag_min_hi': row[6],
                    'expiries': row[7], 'spot': row[8]})
    return out


def _fmt_ts(ms):
    if not ms:
        return '?'
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime('%Y-%m-%d %H:%M')


# ===========================================================================
# 1. term structure
# ===========================================================================
def atm_iv_by_expiry(store, und, min_dte=1, max_dte=400):
    """ATM implied vol per expiry, interpolated in STRIKE to the spot price.

    NOT the median IV across the smile. That distinction is the single most
    important implementation choice in this file. A median over every stored
    strike is a weighted average of the whole smile, so it moves whenever the
    COUNT of stored wing strikes moves - and the stored wing count is decided by
    the open-interest filter, not by the market. Section 5 measures the damage.
    ATM IV is immune because the at-the-money contract is always liquid enough to
    be kept, on any filter anyone would plausibly apply.

    Both the call and the put at each strike are averaged. At the money they are
    tied together by put-call parity, so a large disagreement between them is a
    stale quote rather than information, and averaging is the cheap defence.
    """
    rows = store.q("""
        SELECT expiry, min(dte) AS dte, strike,
               avg(CASE WHEN cp = 'C' THEN iv END) AS civ,
               avg(CASE WHEN cp = 'P' THEN iv END) AS piv,
               max(spot) AS spot
        FROM options
        WHERE underlying = ? AND iv > 0 AND dte BETWEEN ? AND ?
          AND quote_ts = (SELECT max(quote_ts) FROM options WHERE underlying = ?)
        GROUP BY expiry, strike ORDER BY 2, 3""", [und, min_dte, max_dte, und])
    by_exp = {}
    for expiry, dte, strike, civ, piv, spot in rows:
        by_exp.setdefault((expiry, dte, spot), []).append((strike, civ, piv))

    out = []
    for (expiry, dte, spot), strikes in sorted(by_exp.items(), key=lambda kv: kv[0][1]):
        if not spot:
            continue
        pts = []
        for k, civ, piv in strikes:
            ivs = [v for v in (civ, piv) if v and v > 0]
            if ivs:
                pts.append((k, sum(ivs) / len(ivs), len(ivs)))
        if not pts:
            continue
        pts.sort()
        below = [p for p in pts if p[0] <= spot]
        above = [p for p in pts if p[0] >= spot]
        if below and above:
            k1, v1, n1 = below[-1]
            k2, v2, n2 = above[0]
            iv = v1 if k2 == k1 else v1 + (v2 - v1) * (spot - k1) / (k2 - k1)
            both = min(n1, n2) == 2
        else:
            k1, iv, n1 = (below or above)[-1 if below else 0]
            both = n1 == 2
        out.append({'expiry': expiry, 'dte': dte, 'atm_iv': iv, 'spot': spot,
                    'strikes': len(pts), 'two_sided': both})
    return out


def const_maturity_iv(atm_rows, target_dte):
    """Interpolate to a fixed maturity in TOTAL VARIANCE, not in vol.

    Variance is additive in time and vol is not, so interpolating vol directly
    biases the answer whenever the curve is sloped - which is always. Returns
    (iv, flag) where flag says whether the target was bracketed or extrapolated.
    """
    pts = sorted([(r['dte'], r['atm_iv']) for r in atm_rows if r['dte'] > 0 and r['atm_iv']])
    if not pts:
        return None, 'no data'
    if target_dte <= pts[0][0]:
        return pts[0][1], 'clamped to {}d'.format(pts[0][0])
    if target_dte >= pts[-1][0]:
        return pts[-1][1], 'clamped to {}d'.format(pts[-1][0])
    for i in range(1, len(pts)):
        t1, v1 = pts[i - 1]
        t2, v2 = pts[i]
        if t1 <= target_dte <= t2:
            w1, w2 = v1 * v1 * t1, v2 * v2 * t2
            w = w1 + (w2 - w1) * (target_dte - t1) / (t2 - t1)
            return math.sqrt(max(w, 0.0) / target_dte), 'interpolated {}-{}d'.format(t1, t2)
    return pts[-1][1], 'fallback'


def term_structure(store, und, near=30, far=90):
    atm = atm_iv_by_expiry(store, und)
    iv_n, fn = const_maturity_iv(atm, near)
    iv_f, ff = const_maturity_iv(atm, far)
    if iv_n is None or iv_f is None:
        return None
    return {'und': und, 'atm': atm, 'near_dte': near, 'far_dte': far,
            'iv_near': iv_n, 'iv_far': iv_f, 'near_flag': fn, 'far_flag': ff,
            'slope': iv_f - iv_n, 'ratio': (iv_f / iv_n) if iv_n else None,
            'inverted': iv_n > iv_f}


# ===========================================================================
# 2. skew
# ===========================================================================
def skew_term(store, und, targets=(7, 30, 60, 90)):
    """25-delta put IV minus 25-delta call IV across several maturities.

    The per-maturity number comes straight from ingest/options.py's skew(), which
    stays the definition of record. What is added here is (a) running it across
    the curve rather than at one maturity, because skew steepens into short dates
    under stress and a single 30-day reading hides that, and (b) reporting how
    much of the needed history exists for the only question that matters - how it
    MOVES.
    """
    out = []
    for t in targets:
        s = opt.skew(store, und, dte_target=t)
        if s:
            s['target'] = t
            out.append(s)
    return out


def wing_coverage(store, und):
    """How far into the wings the STORED chain actually reaches, per expiry.

    This is the diagnostic for the selective-storage worry. If the filter were
    eating the wings, |delta| would stop well short of 0 on the strikes that
    survive, and a 25-delta skew would quietly become a 35-delta skew with the
    same name. Reports the minimum |delta| reached on each side.
    """
    return store.q("""
        SELECT min(dte) AS dte, expiry,
               min(CASE WHEN cp = 'P' THEN abs(delta) END) AS p_min,
               min(CASE WHEN cp = 'C' THEN abs(delta) END) AS c_min,
               count(*) AS n,
               sum(CASE WHEN abs(delta) BETWEEN 0.20 AND 0.30 THEN 1 ELSE 0 END) AS near25
        FROM options
        WHERE underlying = ? AND iv > 0 AND delta IS NOT NULL AND dte > 0
          AND quote_ts = (SELECT max(quote_ts) FROM options WHERE underlying = ?)
        GROUP BY expiry ORDER BY 1 LIMIT 8""", [und, und])


# ===========================================================================
# 3. realised volatility  (price history reused, not re-downloaded)
# ===========================================================================
def underlying_bars(sym, rng='25y', refresh=False):
    """Daily OHLC for an option underlying, via research/tsx_data.py's fetcher.

    tsx_data.fetch() is the project's existing Yahoo puller and it is symbol
    agnostic, so it is reused rather than a fourth downloader being written. Its
    sibling get() is NOT used only because get() caches under a 'tsx_' prefix,
    and filing SPY/QQQ/GLD under that name in a shared cache directory would
    assert something false about where they are listed. Same fetch, own cache key.

    The adjusted OHLC matters here rather than being cosmetic: unadjusted SPY has
    a ~0.4% downward gap on every quarterly ex-dividend date, and realised vol
    computed across those gaps is biased UP - which would understate the
    volatility risk premium, i.e. bias the answer against the thing being tested.
    """
    CACHE.mkdir(exist_ok=True)
    path = CACHE / 'und_{}_{}.json'.format(sym.replace('^', '').replace('.', '_'), rng)
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    bars = tsx_data.fetch(sym, rng)
    path.write_text(json.dumps(bars))
    time.sleep(0.35)
    return bars


def index_series(sym, rng='25y'):
    """Daily closes of a volatility index as {date: level}.

    Shares the cache file and format written by research/vix_signals.py's
    get_index(). That module cannot simply be imported because it executes its
    entire study at import time, so the cache contract is matched instead of the
    function being called.
    """
    CACHE.mkdir(exist_ok=True)
    path = CACHE / 'idx_{}_{}.json'.format(sym.replace('^', ''), rng)
    if path.exists():
        return json.loads(path.read_text())
    r = requests.get('https://query1.finance.yahoo.com/v8/finance/chart/{}'.format(sym),
                     params={'interval': '1d', 'range': rng}, headers=UA, timeout=30)
    r.raise_for_status()
    res = r.json()['chart']['result'][0]
    ts, q = res['timestamp'], res['indicators']['quote'][0]
    out = {}
    for i, t in enumerate(ts):
        c = q['close'][i]
        if c:
            out[datetime.date.fromtimestamp(t).isoformat()] = float(c)
    path.write_text(json.dumps(out))
    time.sleep(0.35)
    return out


def log_returns(bars):
    out = []
    for i in range(1, len(bars)):
        a, b = bars[i - 1]['c'], bars[i]['c']
        out.append(math.log(b / a) if a > 0 and b > 0 else 0.0)
    return out


def realised_vol(rets, zero_mean=True):
    """Annualised realised vol from daily log returns.

    zero_mean is the default because that is what a variance swap actually pays
    and what implied vol is therefore quoting against. Subtracting the sample
    mean over a 21-day window removes a drift that the option seller is not in
    fact compensated for, and flatters the premium slightly.
    """
    if len(rets) < 2:
        return None
    if zero_mean:
        var = sum(r * r for r in rets) / len(rets)
    else:
        var = st.pvariance(rets)
    return math.sqrt(var * TRADING_DAYS)


def parkinson_vol(bars):
    """High-low range estimator. Roughly 5x more efficient than close-to-close,
    but it cannot see overnight gaps, so on a gapping instrument it reads LOW.
    Carried as a cross-check on the close-to-close number, not as a replacement."""
    acc, n = 0.0, 0
    for b in bars:
        if b['h'] > 0 and b['l'] > 0:
            acc += math.log(b['h'] / b['l']) ** 2
            n += 1
    if n < 2:
        return None
    return math.sqrt(acc / (4 * math.log(2) * n) * TRADING_DAYS)


# ===========================================================================
# 4. volatility risk premium
# ===========================================================================
def vrp_local_gate(inv, horizon_days=30, want_independent=20):
    """Can VRP be measured from the STORED surface yet? Usually: no, and this says
    by how much rather than just refusing.

    The arithmetic that decides it. VRP at horizon h compares IV on day t with
    realised vol over (t, t+h]. Two things must be true:
      * the surface must contain a snapshot at least h days old, or no forward
        window has finished yet;
      * overlapping windows are not independent observations. Daily snapshots
        spanning S days give about S/h independent readings, NOT S of them.
        Counting the overlapping ones as independent is the single easiest way to
        manufacture a significant-looking result out of nothing.
    """
    out = []
    for row in inv:
        span = row['span_days']
        n_ind = span / horizon_days if horizon_days else 0
        need_days = want_independent * horizon_days
        out.append({
            'underlying': row['underlying'],
            'snapshots': row['snapshots'],
            'span_days': span,
            'independent_windows': n_ind,
            'measurable': row['snapshots'] >= 2 and span >= horizon_days,
            'need_snapshots': max(0, int(math.ceil(need_days)) - row['snapshots']),
            'need_days': need_days,
        })
    return out


def vrp_proxy(underlying='SPY', vol_index='^VIX', horizon=21, rng='25y'):
    """VRP on a long history, using a volatility INDEX as the implied-vol series.

    WHY A PROXY IS USED AT ALL, stated plainly: the stored surface holds one
    snapshot, so it cannot answer whether the premium exists. ^VIX is a 30-day
    implied vol on the S&P 500 published daily since 1990, which answers the
    MECHANISM question today instead of in two years. It is a proxy and is
    labelled as one everywhere it appears.

    THE TWO WAYS THIS PROXY IS NOT THE STORED SURFACE, both of which cut against
    over-claiming:
      * VIX integrates the ENTIRE smile in the variance-swap sense, so it sits
        above the at-the-money IV precisely because skew is positive. A seller of
        an ATM straddle captures materially LESS than the VIX-minus-realised gap
        printed here. Treat the number as an upper bound on the ATM premium.
      * It is SPX, not SPY, and certainly not GLD or QQQ. It says nothing about
        whether those two carry the same premium; that is what the stored surface
        is for once it has history.

    Horizon is 21 TRADING days, the closest whole number to VIX's 30 calendar
    days. Returns per-observation rows plus the aggregate.
    """
    bars = underlying_bars(underlying, rng)
    vix = index_series(vol_index, rng)
    rets = log_returns(bars)                      # rets[i] is the return INTO bars[i+1]
    rows = []
    for i in range(len(bars) - horizon - 1):
        d = bars[i]['d']
        lvl = vix.get(d)
        if not lvl:
            continue
        fwd = rets[i:i + horizon]                 # the h returns strictly after bars[i]
        if len(fwd) < horizon:
            continue
        rv = realised_vol(fwd)
        if rv is None:
            continue
        iv = lvl / 100.0
        rows.append({'d': d, 'iv': iv, 'rv': rv, 'gap': iv - rv,
                     'ratio': (rv / iv) if iv else None})
    return rows


def summarise_gaps(rows, horizon=21):
    """Aggregate with the overlap penalty applied to the t-statistic.

    Overlapping windows share returns, so n is not the sample size. n_eff = n/h is
    the standard crude correction and it is used for the t-stat rather than n,
    which would inflate it by sqrt(21) - about 4.6x.
    """
    if not rows:
        return None
    gaps = [r['gap'] for r in rows]
    n_eff = max(1.0, len(gaps) / horizon)
    sd = st.pstdev(gaps) if len(gaps) > 1 else 0.0
    mean = st.mean(gaps)
    return {'n': len(gaps), 'n_eff': n_eff, 'mean': mean, 'median': st.median(gaps),
            'sd': sd, 'pct_pos': sum(1 for g in gaps if g > 0) / len(gaps),
            't_naive': mean / (sd / math.sqrt(len(gaps))) if sd else 0.0,
            't_eff': mean / (sd / math.sqrt(n_eff)) if sd else 0.0,
            'worst': sorted(rows, key=lambda r: r['gap'])[:5],
            'mean_ratio': st.mean([r['ratio'] for r in rows if r['ratio']])}


def bucket_by(rows, keyfn, edges, labels):
    out = []
    for i, (lo, hi) in enumerate(edges):
        sel = [r for r in rows if lo <= keyfn(r) < hi]
        if len(sel) < 20:
            continue
        g = [r['gap'] for r in sel]
        out.append({'label': labels[i], 'n': len(sel), 'mean': st.mean(g),
                    'median': st.median(g),
                    'pct_pos': sum(1 for x in g if x > 0) / len(g),
                    'worst': min(g)})
    return out


def vrp_by_term_structure(rows, rng='25y', horizon=21):
    """Does the premium survive when the curve is INVERTED?

    This is the one question that joins the three sections together, and the
    reason it is worth asking here is that research/vix_signals.py has already
    tested VIX3M/VIX against forward RETURNS - so re-running that would be
    repeating work. What it did not test is inversion against forward VOLATILITY,
    which is the variable the option seller is actually short.

    If the premium is uniformly positive, term structure adds nothing. If it goes
    negative under inversion, then the term structure is not a separate strategy
    at all - it is the FILTER that decides when the premium may be harvested, and
    that is a far more useful thing to own.
    """
    v1 = index_series('^VIX', rng)
    v3 = index_series('^VIX3M', rng)
    out = []
    for r in rows:
        a, b = v1.get(r['d']), v3.get(r['d'])
        if a and b and a > 0:
            rr = dict(r)
            rr['ts_ratio'] = b / a
            out.append(rr)
    return out


# ===========================================================================
# 5. selective-storage bias, measured rather than assumed
# ===========================================================================
KEEP_FILTER_DELETE = """
    DELETE FROM options
    WHERE coalesce(open_interest, 0) <= 0 AND coalesce(volume, 0) <= 0
"""


def bias_check(sym, scratch_db, near=30, far=90):
    """Fetch ONE chain with keep_all, measure everything, then apply the exact
    default filter to the SAME snapshot and measure again.

    Doing it by deletion inside a private database - rather than by fetching
    twice, or by bolting a WHERE clause onto copies of the queries - buys two
    things. There is no timing difference between the two measurements, so any
    difference is the filter and nothing else. And both passes run the REAL
    opt.skew() and opt.surface(), so this measures the functions the project
    actually uses rather than lookalikes of them.

    Writes to its own file. It never touches data/market.duckdb, which is locked
    by the collector and is not this module's to modify in any case.
    """
    scratch_db = Path(scratch_db)
    if scratch_db.exists():
        scratch_db.unlink()
    store = ingest_core.Store(path=str(scratch_db))
    try:
        res = opt.store_chain(store, sym, keep_all=True)
        before = _bias_metrics(store, sym, near, far)
        store.con.execute(KEEP_FILTER_DELETE)
        after = _bias_metrics(store, sym, near, far)
        return {'fetched': res, 'full': before, 'filtered': after}
    finally:
        store.close()


def _bias_metrics(store, sym, near, far):
    n = store.con.execute('SELECT count(*) FROM options WHERE underlying = ?',
                          [sym]).fetchone()[0]
    ts = term_structure(store, sym, near, far)
    sk = opt.skew(store, sym, dte_target=near)
    surf = opt.surface(store, sym, limit_expiries=40)
    med = None
    for expiry, dte, cnt, ivm, ivp, ivc in surf:
        if med is None and dte >= near:
            med = (dte, ivm, cnt)
    wing = store.con.execute("""
        SELECT min(abs(delta)) FROM options
        WHERE underlying = ? AND iv > 0 AND delta IS NOT NULL AND dte > 0""",
                             [sym]).fetchone()[0]
    return {'contracts': n, 'iv_near': ts['iv_near'] if ts else None,
            'iv_far': ts['iv_far'] if ts else None,
            'slope': ts['slope'] if ts else None,
            'skew': sk['skew'] if sk else None,
            'put25': sk['put25'] if sk else None,
            'call25': sk['call25'] if sk else None,
            'median_iv': med[1] if med else None,
            'median_n': med[2] if med else None,
            'min_abs_delta': wing}


# ===========================================================================
# reporting
# ===========================================================================
def banner(n, title):
    print('\n' + '=' * 96)
    print('{}. {}'.format(n, title))
    print('=' * 96)


def pct(x, nd=2):
    return '-' if x is None else '{:.{}f}%'.format(x * 100, nd)


def report(args):
    store = ReadOnlyStore(args.db)
    try:
        inv = inventory(store)
        unds = args.underlyings or [r['underlying'] for r in inv]

        banner(0, 'WHAT IS IN THE DATABASE  (this gates everything below)')
        print('  Snapshots are counted by DISTINCT quote_ts. The `polls` column is how')
        print('  many times the chain was inserted - where it exceeds snapshots, those')
        print('  extra polls re-read the SAME delayed file and added no information.\n')
        print('  {:8}{:>9}{:>11}{:>8}{:>9}{:>10}{:>16}'.format(
            'sym', 'rows', 'snapshots', 'polls', 'expiries', 'span(d)', 'quote lag(min)'))
        print('  ' + '-' * 72)
        for r in inv:
            print('  {:8}{:>9}{:>11}{:>8}{:>9}{:>10.2f}{:>16}'.format(
                r['underlying'], r['rows'], r['snapshots'], r['polls'],
                r['expiries'], r['span_days'],
                '{:.0f} - {:.0f}'.format(r['lag_min_lo'] or 0, r['lag_min_hi'] or 0)))
        for r in inv:
            print('  {:8} latest quote {} UTC   spot {:.2f}'.format(
                r['underlying'], _fmt_ts(r['last_q']), r['spot'] or 0))
        print('\n  THE DELAY, MEASURED: quotes are {:.0f}-{:.0f} minutes stale at insert.'
              ' No intraday'.format(min(r['lag_min_lo'] or 0 for r in inv),
                                    max(r['lag_min_hi'] or 0 for r in inv)))
        print('  use is possible and none is proposed. End-of-day slope, skew and 30-day')
        print('  vol comparisons are unaffected at this lag.')

        banner(1, 'TERM STRUCTURE  (cross-sectional - the one thing ONE snapshot can answer)')
        print('  Near and far are constant-maturity ATM IV, interpolated in total')
        print('  variance. Slope > 0 is contango (calm). Slope < 0 is inversion - the')
        print('  stress signal. This is a CROSS-SECTIONAL quantity: it is read across')
        print('  expiries at a single instant, so unlike the other two it needs no')
        print('  history to be computed. Its PREDICTIVE value does need history.\n')
        print('  {:8}{:>11}{:>11}{:>11}{:>9}{:>12}  {}'.format(
            'sym', f'{args.near}d ATM', f'{args.far}d ATM', 'slope', 'ratio', 'state', 'basis'))
        print('  ' + '-' * 88)
        ts_rows = {}
        for u in unds:
            t = term_structure(store, u, args.near, args.far)
            ts_rows[u] = t
            if not t:
                print('  {:8} no usable expiries'.format(u))
                continue
            print('  {:8}{:>11}{:>11}{:>11}{:>9.3f}{:>12}  {}'.format(
                u, pct(t['iv_near']), pct(t['iv_far']),
                '{:+.2f}pp'.format(t['slope'] * 100), t['ratio'],
                'INVERTED' if t['inverted'] else 'contango',
                '{} / {}'.format(t['near_flag'], t['far_flag'])))

        if args.verbose:
            for u in unds:
                t = ts_rows.get(u)
                if not t:
                    continue
                print('\n  {} ATM term structure by expiry'.format(u))
                print('    {:12}{:>6}{:>10}{:>9}{:>8}'.format(
                    'expiry', 'dte', 'ATM IV', 'strikes', '2-sided'))
                for r in t['atm'][:12]:
                    print('    {:12}{:>6}{:>10}{:>9}{:>8}'.format(
                        str(r['expiry']), r['dte'], pct(r['atm_iv']),
                        r['strikes'], 'yes' if r['two_sided'] else 'no'))

        banner(2, 'SKEW  (level is readable today; the MOVE is what matters and is not)')
        print('  25-delta put IV minus 25-delta call IV, from ingest/options.py\'s')
        print('  skew() at four maturities. Positive is normal and near-universal for')
        print('  equity indices, so the LEVEL carries little information.\n')
        print('  {:8}{:>8}{:>10}{:>10}{:>11}'.format('sym', 'dte', 'put25 IV', 'call25 IV', 'skew'))
        print('  ' + '-' * 48)
        for u in unds:
            for s in skew_term(store, u, tuple(args.skew_targets)):
                print('  {:8}{:>8}{:>10}{:>10}{:>11}'.format(
                    u, s['dte'], pct(s['put25']), pct(s['call25']),
                    '{:+.2f}pp'.format(s['skew'] * 100)))

        print('\n  WING COVERAGE - how deep the STORED chain reaches, per expiry.')
        print('  If the open-interest filter were eating the wings, |delta| would stop')
        print('  short of zero and a "25-delta" skew would silently become something')
        print('  else. near25 counts contracts with |delta| in 0.20-0.30.')
        for u in unds:
            print('\n  {} {:12}{:>6}{:>10}{:>10}{:>9}{:>9}'.format(
                u, 'expiry', 'dte', 'min|d| P', 'min|d| C', 'n', 'near25'))
            for dte, expiry, pmin, cmin, n, near25 in wing_coverage(store, u)[:6]:
                print('  {:8} {:12}{:>6}{:>10}{:>10}{:>9}{:>9}'.format(
                    '', str(expiry), dte,
                    '{:.3f}'.format(pmin) if pmin is not None else '-',
                    '{:.3f}'.format(cmin) if cmin is not None else '-', n, near25))

        banner(3, 'VOLATILITY RISK PREMIUM FROM THE STORED SURFACE  (the gate)')
        print('  VRP compares IV on day t with realised vol over (t, t+{}d]. That needs'.format(args.horizon))
        print('  a snapshot at least {} days old. Overlapping windows are not'.format(args.horizon))
        print('  independent: S days of daily snapshots give about S/{} independent'.format(args.horizon))
        print('  readings, so the requirement is set in DAYS OF SPAN, not snapshot count.\n')
        gates = vrp_local_gate(inv, args.horizon, args.want_independent)
        print('  {:8}{:>11}{:>10}{:>14}{:>14}  {}'.format(
            'sym', 'snapshots', 'span(d)', 'indep windows', 'need span(d)', 'verdict'))
        print('  ' + '-' * 82)
        for g in gates:
            print('  {:8}{:>11}{:>10.2f}{:>14.2f}{:>14.0f}  {}'.format(
                g['underlying'], g['snapshots'], g['span_days'],
                g['independent_windows'], g['need_days'],
                'MEASURABLE' if g['measurable'] else 'INSUFFICIENT HISTORY'))
        worst = max(gates, key=lambda g: g['need_days'] - g['span_days'])
        print('\n  NOT MEASURABLE. {} snapshot(s) spanning {:.2f} days. To get {} roughly'.format(
            max(g['snapshots'] for g in gates), worst['span_days'], args.want_independent))
        print('  independent {}-day windows needs about {:.0f} days of DAILY collection.'.format(
            args.horizon, worst['need_days']))
        print('  Note what that means for the collector: the CBOE file updates slowly, so')
        print('  extra polls per day buy nothing. One snapshot a day is the real rate, and')
        print('  the calendar - not the polling frequency - is the binding constraint.')

        print('\n  What CAN be said today, and what it is not:')
        for u in unds:
            t = ts_rows.get(u)
            if not t:
                continue
            try:
                bars = underlying_bars(u, '5y')
            except Exception as e:
                print('  {:8} price history unavailable: {}'.format(u, e))
                continue
            rets = log_returns(bars)
            rv30 = realised_vol(rets[-21:])
            rv60 = realised_vol(rets[-42:])
            pk = parkinson_vol(bars[-21:])
            print('  {:8} IV(30d) {:>7}   trailing RV(21d) {:>7}  RV(42d) {:>7}  '
                  'Parkinson {:>7}   spread {:>8}'.format(
                      u, pct(t['iv_near'], 1), pct(rv30, 1), pct(rv60, 1), pct(pk, 1),
                      '{:+.1f}pp'.format((t['iv_near'] - rv30) * 100) if rv30 else '-'))
        print('\n  That spread is IV against TRAILING realised vol. It is NOT the VRP and')
        print('  must not be quoted as one. VRP is IV against the vol that arrives NEXT.')
        print('  The two differ most exactly when it matters - after a shock, trailing RV')
        print('  is high and forward RV is usually lower, so this spread reads negative')
        print('  precisely when selling vol has been most profitable.')

        if args.proxy:
            banner(4, 'VOLATILITY RISK PREMIUM ON A LONG PROXY  (^VIX vs forward SPX vol)')
            print('  The stored surface cannot answer whether the premium EXISTS, so it is')
            print('  measured on a 25-year proxy instead of waiting two years to rediscover')
            print('  it. ^VIX is 30-day implied vol on the S&P 500; forward realised vol is')
            print('  computed from {} adjusted closes over the next {} trading days.'.format(
                args.proxy_underlying, args.horizon_trading))
            print('  PROXY CAVEAT, not a footnote: VIX integrates the whole smile, so it')
            print('  sits ABOVE at-the-money IV by roughly the skew. An ATM straddle seller')
            print('  captures less than the gap below. Read it as an upper bound.\n')
            rows = vrp_proxy(args.proxy_underlying, '^VIX', args.horizon_trading, args.rng)
            s = summarise_gaps(rows, args.horizon_trading)
            if not s:
                print('  no overlapping history')
            else:
                print('  observations          {:,} daily, {:.0f} independent {}-day windows'.format(
                    s['n'], s['n_eff'], args.horizon_trading))
                print('  mean  IV - forward RV {:+.2f} vol points'.format(s['mean'] * 100))
                print('  median                {:+.2f} vol points'.format(s['median'] * 100))
                print('  IV exceeded RV on     {:.1%} of days'.format(s['pct_pos']))
                print('  mean  RV / IV         {:.3f}   (realised arrives at {:.0f}% of implied)'.format(
                    s['mean_ratio'], s['mean_ratio'] * 100))
                print('  t-stat, naive         {:.1f}   <- WRONG, treats overlapping windows as independent'.format(
                    s['t_naive']))
                print('  t-stat, overlap-adj   {:.1f}   <- the honest one (n/{} effective)'.format(
                    s['t_eff'], args.horizon_trading))
                print('\n  THE TAIL, which is the mechanism rather than an exception.')
                print('  The five worst windows for a vol seller:')
                print('    {:12}{:>10}{:>12}{:>10}'.format('date', 'VIX', 'fwd RV', 'gap'))
                for w in s['worst']:
                    print('    {:12}{:>10}{:>12}{:>10}'.format(
                        w['d'], pct(w['iv'], 1), pct(w['rv'], 1),
                        '{:+.1f}pp'.format(w['gap'] * 100)))
                print('  A seller collecting ~{:.1f} vol points on the average day was short'.format(
                    s['mean'] * 100))
                print('  {:.0f}+ points in these. The premium is payment for THAT, not a'.format(
                    abs(s['worst'][0]['gap']) * 100))
                print('  mispricing, which is exactly why it has not been arbitraged away.')

                print('\n  BY VIX LEVEL - is the premium bigger when vol is already high?')
                print('    {:22}{:>8}{:>12}{:>12}{:>11}{:>11}'.format(
                    'VIX bucket', 'n', 'mean gap', 'median', '% positive', 'worst'))
                edges = [(0, .13), (.13, .16), (.16, .20), (.20, .26), (.26, .40), (.40, 9)]
                labels = ['VIX < 13', 'VIX 13-16', 'VIX 16-20', 'VIX 20-26',
                          'VIX 26-40', 'VIX > 40']
                for b in bucket_by(rows, lambda r: r['iv'], edges, labels):
                    print('    {:22}{:>8}{:>12}{:>12}{:>11}{:>11}'.format(
                        b['label'], b['n'], '{:+.2f}pp'.format(b['mean'] * 100),
                        '{:+.2f}pp'.format(b['median'] * 100),
                        '{:.0%}'.format(b['pct_pos']),
                        '{:+.1f}pp'.format(b['worst'] * 100)))

                tsr = vrp_by_term_structure(rows, args.rng, args.horizon_trading)
                if tsr:
                    print('\n  BY TERM STRUCTURE - the join between sections 1 and 4.')
                    print('  VIX3M/VIX below 1.00 is INVERSION. research/vix_signals.py already')
                    print('  tested this ratio against forward RETURNS, so that is not repeated;')
                    print('  this tests it against forward VOLATILITY, which is what a vol')
                    print('  seller is actually short and which that study did not cover.')
                    print('    {:22}{:>8}{:>12}{:>12}{:>11}{:>11}'.format(
                        'VIX3M/VIX', 'n', 'mean gap', 'median', '% positive', 'worst'))
                    tedges = [(0, .95), (.95, 1.00), (1.00, 1.05), (1.05, 1.10), (1.10, 9)]
                    tlabels = ['< 0.95 deep inv', '0.95-1.00 inverted', '1.00-1.05 flat',
                               '1.05-1.10 contango', '> 1.10 steep contango']
                    for b in bucket_by(tsr, lambda r: r['ts_ratio'], tedges, tlabels):
                        print('    {:22}{:>8}{:>12}{:>12}{:>11}{:>11}'.format(
                            b['label'], b['n'], '{:+.2f}pp'.format(b['mean'] * 100),
                            '{:+.2f}pp'.format(b['median'] * 100),
                            '{:.0%}'.format(b['pct_pos']),
                            '{:+.1f}pp'.format(b['worst'] * 100)))
    finally:
        store.close()

    if args.bias_check:
        banner(5, 'SELECTIVE-STORAGE BIAS, MEASURED  ({})'.format(args.bias_check))
        print('  One chain fetched with keep_all into a PRIVATE database, measured, then')
        print('  the exact default keep-filter applied by deletion and measured again.')
        print('  Same snapshot both times, and both passes run the real opt.skew() and')
        print('  opt.surface() rather than lookalikes.\n')
        try:
            b = bias_check(args.bias_check, args.bias_db, args.near, args.far)
        except Exception as e:
            print('  bias check failed: {}'.format(e))
            return
        f, g = b['full'], b['filtered']
        print('  chain fetched {} contracts, quote {} UTC'.format(
            b['fetched']['fetched'], _fmt_ts(b['fetched']['quote_ts'])))
        print('\n  {:26}{:>16}{:>16}{:>14}'.format('metric', 'full chain', 'default filter', 'difference'))
        print('  ' + '-' * 72)

        def line(name, a, c, fmt='pct'):
            if a is None or c is None:
                print('  {:26}{:>16}{:>16}{:>14}'.format(name, '-', '-', '-'))
                return
            if fmt == 'pct':
                print('  {:26}{:>16}{:>16}{:>14}'.format(
                    name, pct(a), pct(c), '{:+.3f}pp'.format((c - a) * 100)))
            elif fmt == 'int':
                print('  {:26}{:>16,}{:>16,}{:>14}'.format(name, a, c, '{:+,}'.format(c - a)))
            else:
                print('  {:26}{:>16.4f}{:>16.4f}{:>14}'.format(name, a, c, '{:+.4f}'.format(c - a)))

        line('contracts', f['contracts'], g['contracts'], 'int')
        line('ATM IV {}d'.format(args.near), f['iv_near'], g['iv_near'])
        line('ATM IV {}d'.format(args.far), f['iv_far'], g['iv_far'])
        line('term slope', f['slope'], g['slope'])
        line('25d put IV', f['put25'], g['put25'])
        line('25d call IV', f['call25'], g['call25'])
        line('25d SKEW', f['skew'], g['skew'])
        line('median IV across smile', f['median_iv'], g['median_iv'])
        line('  strikes in that median', f['median_n'], g['median_n'], 'int')
        line('deepest |delta| reached', f['min_abs_delta'], g['min_abs_delta'], 'raw')
        print('\n  READ THIS AS: the filter is safe for anything anchored to a specific')
        print('  DELTA or to the spot price, because those contracts are liquid by')
        print('  definition and always survive it. It is not safe for anything that')
        print('  averages across the whole smile, because the filter changes how many')
        print('  wing strikes are in the average - and the wing count is set by the')
        print('  filter rather than by the market. ingest/options.py\'s surface() uses')
        print('  median(iv), so its term structure is exposed; the ATM term structure in')
        print('  section 1 is the one to build on.')


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    p.add_argument('--db', default=str(DB))
    p.add_argument('--underlyings', nargs='*', default=None)
    p.add_argument('--near', type=int, default=30)
    p.add_argument('--far', type=int, default=90)
    p.add_argument('--horizon', type=int, default=30, help='VRP horizon, calendar days')
    p.add_argument('--horizon-trading', type=int, default=21, help='VRP horizon, trading days')
    p.add_argument('--want-independent', type=int, default=20)
    p.add_argument('--skew-targets', type=int, nargs='*', default=[7, 30, 60, 90])
    p.add_argument('--rng', default='25y')
    p.add_argument('--proxy-underlying', default='SPY')
    p.add_argument('--no-proxy', dest='proxy', action='store_false')
    p.add_argument('--bias-check', default=None, metavar='SYM',
                   help='fetch one chain with keep_all into --bias-db and A/B the filter')
    p.add_argument('--bias-db', default=None)
    p.add_argument('--verbose', action='store_true')
    args = p.parse_args()
    if args.bias_check and not args.bias_db:
        args.bias_db = str(Path(__file__).parent / 'data' / '_bias_check.duckdb')
    report(args)


if __name__ == '__main__':
    main()
