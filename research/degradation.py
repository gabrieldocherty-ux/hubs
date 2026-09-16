"""
STRATEGY DEGRADATION MONITOR - the disciplined version of "let strategies evolve
after mistakes".

WHY THE NAIVE VERSION DESTROYS THE BOOK
---------------------------------------
The request is reasonable and the naive implementation of it is fatal. "Evolve
after mistakes" implemented as "the strategy had a bad month, so retune it"
does this:

  * Every number that justified trading this strategy came from an OUT-OF-SAMPLE
    test. The train/test split, the quarterly walk-forward, the parameter
    neighbourhood - all of it is evidence precisely because the parameters were
    chosen WITHOUT seeing that data. The moment a parameter is chosen using live
    results, the live period stops being out-of-sample. There is then no
    evidence left anywhere that the strategy works: the backtest was fitted on
    the backtest window and the live window has now also been fitted on.
  * Retuning after losses is a systematically biased operator. Losses cluster
    where the trade distribution's left tail lives. Deleting the parameter cells
    that produced them raises the backtested mean and lowers the backtested
    variance every single time, whether or not anything real changed. It always
    "works". That is exactly what makes it worthless.
  * S3's median trade is a loss. D1 wins 65% of the time and still has losing
    runs by construction. The modal outcome of a good strategy is a losing
    trade, so "it made a mistake" carries almost no information on its own. Any
    rule that fires on it fires constantly.

So the disciplined version has to answer a harder question than "is it losing":

    Is it losing MORE than its own resampled history ever did?

and it has to answer it with a threshold written down BEFORE the live data
existed, together with the response, so that no judgement call is made after
seeing a bad run. Anything decided afterwards is a decision made by a person who
already knows the answer they want.

WHAT THIS FILE PRODUCES
-----------------------
1. DRAWDOWN PROFILE. For each live strategy (S3, D1, B1, M3), bootstrap its own
   backtest trade sequence a few thousand times and read off the distribution of
   worst-k-trade runs, worst drawdown, and longest losing streak. This converts
   "it is down 9%" into "it is down more than 95% of its own resampled histories
   ever were", which is the only version of that sentence with content.

2. A SEQUENTIAL TEST with a pre-registered false-alarm rate. See the long
   justification at `calibrate_boundary` for why a Monte-Carlo-calibrated
   square-root confidence boundary was chosen over a textbook SPRT.

3. A LADDER of responses: full size -> half size -> paused -> retired, with
   pre-registered promotion rules so it is reversible. Retuning appears nowhere
   on it, because the only honest response to "the evidence for this edge has
   weakened" is to give it less capital. Changing WHAT it does destroys the
   evidence; changing HOW MUCH it gets does not.

4. The baselines file `config/degradation_baselines.json`, consumed by
   `core/degradation_monitor.py`, plus a replay of the backtest history through
   the finished monitor (bottom of this file).

A NOTE ON UNITS - this one matters and is easy to get wrong.
The backtest's pnl_pct is NET of the modelled 0.190% round trip and of real
funding. The live log's pnl_pct (core/trade_log.make_trade) is the RAW price
move: gross of fees, slippage and funding. Comparing them directly hands every
live trade a free +0.19% versus the baseline, which biases the monitor towards
never firing - the dangerous direction. The monitor therefore charges live
trades the same 0.190% the baseline was built at. That is deliberately harsher
than the measured 0.100%: the point is a like-for-like comparison against the
registered distribution, not an estimate of true cost. Funding is still
unmodelled on the live side and remains a known gap (see the report).
"""
import sys, os, json, math, random, statistics as st, datetime
sys.path.insert(0, 'research')

import engine, pooled, hl_data
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout
from strategies_macro import donchian_turtle
import run_basis

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'config', 'degradation_baselines.json')

SEED = 20260907
N_SIMS = 20000          # paths for boundary calibration
N_BOOT = 5000           # paths for the drawdown profile
BLOCK = 5               # moving-block length for the clustering sensitivity check

# Charged to live trades so they are measured on the same ruler as the baseline.
ROUND_TRIP_COST = 2 * (engine.TAKER_FEE + engine.SLIPPAGE)   # 0.190%

# The account's real sizing, used only to translate per-unit-notional drawdown
# into "what this feels like in dollars". $16.25 on $250.
POSITION_FRACTION = 16.25 / 250.0

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']


# --------------------------------------------------------------------------
# 1. The live book, reproduced exactly as deployed
# --------------------------------------------------------------------------

def live_book():
    """The four strategies actually in the book, with the coins they actually
    run on. B1 is deliberately BTC/ETH/HYPE - it does not work on SOL, and a
    baseline built on coins the strategy is not allowed to trade would be a
    baseline for a strategy that does not exist."""
    out = {}

    _, s3 = pooled.pooled(volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5},
                          COINS, 60, name='S3')
    out['forced_flow'] = ('S3 ForcedFlowContinuation', s3, COINS)

    _, d1 = pooled.pooled(range_breakout,
                          {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0},
                          COINS, 60, name='D1')
    out['range_break'] = ('D1 RangeBreakCascade', d1, COINS)

    # B1: run_basis.run() pools over all four; rebuild on the deployed subset.
    b1_coins = ['BTC', 'ETH', 'HYPE']
    per_b1, _ = run_basis.run(run_basis.BASE)
    b1 = engine.Result(coin='POOL', name='B1')
    for c in b1_coins:
        if c in per_b1:
            b1.trades.extend(per_b1[c].trades)
            b1.start_t = min(b1.start_t or per_b1[c].start_t, per_b1[c].start_t)
            b1.end_t = max(b1.end_t, per_b1[c].end_t)
    b1.trades.sort(key=lambda t: t.entry_t)
    out['basis'] = ('B1 BasisDislocation (BTC/ETH/HYPE)', b1, b1_coins)

    _, m3 = pooled.pooled(donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0},
                          COINS, 85, name='M3')
    out['donchian'] = ('M3 DonchianBreakout', m3, COINS)
    return out


def realised_sequence(result):
    """Trade P&Ls in the order they were REALISED (by exit), not signalled.

    The pooled lists are sorted by entry. A monitor sees P&L when a position
    closes, so exit order is the sequence it will actually observe. On
    overlapping positions across four coins the two orders differ, and the
    drawdown of a sequence is order-dependent."""
    return [t.pnl_pct for t in sorted(result.trades, key=lambda t: t.exit_t)]


# --------------------------------------------------------------------------
# 2. Drawdown profile by bootstrap
# --------------------------------------------------------------------------

def _path_stats(path, ks):
    """Worst-k-trade run for each k, max drawdown, longest losing streak.

    Drawdown here is on the ADDITIVE sum of per-trade returns, i.e. per unit of
    notional deployed. That is the right unit: every position is a fixed $16.25
    regardless of equity, so the account does not compound trade-to-trade the
    way a full-notional equity curve would. Multiply by POSITION_FRACTION to get
    account percent."""
    n = len(path)
    cum = [0.0] * (n + 1)
    for i, r in enumerate(path):
        cum[i + 1] = cum[i] + r

    worst_k = {}
    for k in ks:
        if k > n:
            worst_k[k] = None
            continue
        w = min(cum[i + k] - cum[i] for i in range(n - k + 1))
        worst_k[k] = w

    peak = cum[0]
    mdd = 0.0
    for v in cum:
        peak = max(peak, v)
        mdd = min(mdd, v - peak)

    streak = worst_streak = 0
    for r in path:
        if r <= 0:
            streak += 1
            worst_streak = max(worst_streak, streak)
        else:
            streak = 0
    return worst_k, mdd, worst_streak


def bootstrap_profile(pnls, horizon, ks, n_boot=N_BOOT, block=None, seed=SEED):
    """Resample the trade sequence and report the distribution of bad runs.

    block=None is the iid bootstrap: it assumes trades are exchangeable. They
    are not - four correlated coins hold positions simultaneously, so a bad week
    produces several bad trades at once. The iid bootstrap therefore UNDERSTATES
    clustered drawdown. block=k resamples contiguous runs of k trades instead,
    which preserves that clustering. Both are reported; the block numbers are
    the ones to trust when they disagree."""
    rng = random.Random(seed)
    rows = {'mdd': [], 'streak': []}
    for k in ks:
        rows['w%d' % k] = []
    n = len(pnls)
    for _ in range(n_boot):
        if block:
            path = []
            while len(path) < horizon:
                s = rng.randrange(n)
                path.extend(pnls[(s + j) % n] for j in range(block))
            path = path[:horizon]
        else:
            path = [pnls[rng.randrange(n)] for _ in range(horizon)]
        wk, mdd, streak = _path_stats(path, ks)
        for k in ks:
            if wk[k] is not None:
                rows['w%d' % k].append(wk[k])
        rows['mdd'].append(mdd)
        rows['streak'].append(streak)
    return rows


def pct(vals, q):
    if not vals:
        return None
    s = sorted(vals)
    i = min(len(s) - 1, max(0, int(round(q * (len(s) - 1)))))
    return s[i]


# --------------------------------------------------------------------------
# 3. The sequential test
# --------------------------------------------------------------------------
#
# WHY A CALIBRATED SQUARE-ROOT BOUNDARY AND NOT AN SPRT
# -----------------------------------------------------
# Wald's SPRT is the textbook answer and it is the wrong tool here, for three
# specific reasons:
#
#  (a) It needs a fully specified likelihood under BOTH hypotheses. These trade
#      distributions are violently non-normal - S3's mean is +1.80% while its
#      median is negative, the mass sits at the stop and the profit is in a thin
#      right tail. There is no tractable parametric family that fits, and a
#      Gaussian SPRT would mis-weight exactly the tail that carries the edge.
#      A likelihood ratio computed from the wrong density is a precise-looking
#      number with an unknown error rate, which is worse than a crude number
#      with a known one.
#  (b) The SPRT terminates. It accepts H0 or H1 and stops. The response ladder
#      here is explicitly REVERSIBLE and open-ended: the monitor must keep
#      reporting forever, and a strategy that recovers must be able to climb
#      back up. An absorbing decision rule is the wrong shape for that.
#  (c) The SPRT's error rates are bounds under its own model. Here the error
#      rate can be made EXACT by construction, because the null hypothesis is
#      an empirical distribution we already possess: resample the backtest
#      trades, and count how often the boundary is crossed by a strategy whose
#      edge is intact. No distributional assumption anywhere.
#
# The rule. With mu0 and sigma0 the backtest mean and stdev per trade, and S_n
# the cumulative live P&L after n trades, DEMOTE when
#
#       S_n  <  n*mu0 - c * sigma0 * sqrt(n)        and   n >= min_trades
#
# The sqrt(n) shape is chosen because under the null S_n - n*mu0 is a random
# walk whose spread grows as sqrt(n): a boundary of that shape has roughly
# constant crossing hazard per trade, so the test is not front- or back-loaded.
# A fixed-percentage drawdown threshold, by contrast, is nearly impossible to
# cross early and nearly certain to be crossed eventually, which means its real
# false-alarm rate depends entirely on how long you happen to run it.
#
# c is not chosen. It is CALIBRATED so that the probability of crossing AT ANY
# POINT in a pre-registered horizon equals the alpha for that rung. This is the
# multiple-comparisons fix: a boundary set at each n's own 5th percentile is
# crossed by a healthy strategy far more often than 5% of the time, because the
# path gets many chances. Calibrating the whole path fixes that.

def calibrate_boundary(pnls, horizon, alphas, min_trades, n_sims=N_SIMS, seed=SEED + 1):
    """Return {alpha: c} such that P(cross within `horizon` | edge intact) = alpha.

    `min_trades` is a dict {alpha: n} - the minimum sample before that rung may
    fire at all. It is part of the rule, so it is part of the calibration: with
    the early trades excluded the same c crosses less often, and folding it in
    keeps alpha exact instead of merely conservative."""
    rng = random.Random(seed)
    mu = st.mean(pnls)
    sd = st.pstdev(pnls)
    if sd <= 0:
        return {a: float('inf') for a in alphas}
    n = len(pnls)

    # For each path, the running statistic z_n = (S_n - n*mu) / (sigma*sqrt(n)).
    # Crossing at threshold c from trade m onwards <=> min_{n>=m} z_n < -c.
    # So one simulation gives every (alpha, min_trades) pair at once.
    per_min = {m: [] for m in set(min_trades.values())}
    for _ in range(n_sims):
        s = 0.0
        z = [0.0] * (horizon + 1)
        for i in range(1, horizon + 1):
            s += pnls[rng.randrange(n)]
            z[i] = (s - i * mu) / (sd * math.sqrt(i))
        # suffix minima so every min_trades threshold is read off one pass
        suf = [0.0] * (horizon + 2)
        suf[horizon + 1] = float('inf')
        for i in range(horizon, 0, -1):
            suf[i] = min(z[i], suf[i + 1])
        for m in per_min:
            per_min[m].append(suf[min(m, horizon)])

    out = {}
    for a in alphas:
        m = min_trades[a]
        q = pct(per_min[m], a)          # alpha-quantile of the path minimum
        out[a] = -q if q is not None else float('inf')
    return out


def detection_power(pnls, c, min_trades, horizon, n_sims=4000, seed=SEED + 2,
                    edge_scale=0.0):
    """How long until a genuinely broken strategy is caught.

    H1 is the same trade distribution with its mean scaled by `edge_scale`:
    0.0 = the edge is completely gone, 0.5 = the edge halved, shape unchanged.
    Shape-preserving matters - a strategy that dies usually keeps its volatility
    and loses its drift, which is the hardest case to detect and therefore the
    honest one to quote."""
    rng = random.Random(seed)
    mu = st.mean(pnls)
    sd = st.pstdev(pnls)
    shift = mu * (edge_scale - 1.0)      # add this to every draw
    n = len(pnls)
    hits = []
    for _ in range(n_sims):
        s = 0.0
        fired = None
        for i in range(1, horizon + 1):
            s += pnls[rng.randrange(n)] + shift
            if i >= min_trades and s < i * mu - c * sd * math.sqrt(i):
                fired = i
                break
        hits.append(fired)
    caught = [h for h in hits if h is not None]
    return {'detected_frac': len(caught) / len(hits),
            'median_n': pct(caught, 0.50) if caught else None,
            'p90_n': pct(caught, 0.90) if caught else None}


# --------------------------------------------------------------------------
# 4. The ladder (pre-registered here, enforced in core/degradation_monitor.py)
# --------------------------------------------------------------------------
#
# RUNG        ALPHA   MEANING
# full        -       live results are consistent with the registered edge
# half        0.20    a 1-in-5 bad run. Cheap to be wrong in either direction,
#                     so the threshold is loose on purpose: this rung exists to
#                     react early, not to be right.
# paused      0.05    a 1-in-20 run. Conventional, and the point at which the
#                     evidence is worth acting on rather than noting.
# retired     0.01    a 1-in-100 run. At 1% the run is no longer well explained
#                     by the registered distribution at all.
#
# Those are per-strategy, per-horizon whole-path false-alarm rates. Across four
# strategies the chance that at least one gets spuriously halved in a horizon is
# about 1-(0.8^4) = 59%, at least one paused about 19%, at least one retired
# about 4%. That is not a defect to be corrected away - halving one strategy of
# four is a small, reversible cost and the ladder is designed to absorb it. But
# it does mean "one strategy got halved" is an expected event, not news.
#
# PROMOTION (this is what makes it reversible rather than a ratchet):
# a strategy climbs back one rung when cumulative P&L has recovered above that
# rung's boundary plus a hysteresis band of HYSTERESIS*sigma*sqrt(n), AND it has
# closed at least RECOVER_TRADES trades since it was demoted. Without the band
# the state flaps across the boundary trade by trade; without the trade minimum
# a single lucky trade undoes a demotion.
#
# RETIREMENT is absorbing in code. Only Gabe re-enables it. At the 1% rung the
# question is no longer "how much size" but "is the mechanism still there", and
# that is a research question, not a monitoring one.
#
# WHAT IS NOT ON THE LADDER, AND WHY:
#   - retuning parameters
#   - changing stops, holds, entry thresholds
#   - dropping the coins that lost and keeping the ones that won
# Each of these changes WHAT the strategy does using data that has already been
# observed, which converts the live period from evidence into fitting sample and
# leaves no out-of-sample support anywhere. Capital allocation is the only lever
# that can be pulled on live evidence without destroying that evidence, because
# it does not change the trade distribution being measured - it changes how much
# money rides on it. If a mechanism genuinely needs different parameters, that
# is a NEW strategy and it goes through the full gate on data that predates the
# decision, like everything else.

ALPHAS = {'half': 0.20, 'paused': 0.05, 'retired': 0.01}
MIN_TRADES = {'half': 10, 'paused': 20, 'retired': 30}
HYSTERESIS = 0.5
RECOVER_TRADES = 5


# --------------------------------------------------------------------------
# 5. Build and report
# --------------------------------------------------------------------------

def horizon_for(result):
    """Two years of expected trades, floored at 60 so a slow macro strategy
    still gets a horizon long enough for the calibration to mean something."""
    tpy = result.trades_per_year()
    return max(60, int(round(tpy * 2)))


def main():
    random.seed(SEED)
    book = live_book()
    ks = [5, 10, 20, 30]
    baselines = {}

    print('=' * 112)
    print('STRATEGY DEGRADATION MONITOR - baseline registration')
    print('=' * 112)
    print('cost charged to live trades for comparability: {:.3%} round trip'.format(ROUND_TRIP_COST))
    print('position fraction used for account translation: {:.1%} (${:.2f} on $250)'.format(
        POSITION_FRACTION, POSITION_FRACTION * 250))

    for key, (label, res, coins) in book.items():
        pnls = realised_sequence(res)
        if len(pnls) < 20:
            print('\n{}: only {} trades - not enough to register a baseline'.format(label, len(pnls)))
            continue
        mu, sd = st.mean(pnls), st.pstdev(pnls)
        hz = horizon_for(res)
        tpy = res.trades_per_year()

        print('\n' + '-' * 112)
        print('{}   [coins: {}]'.format(label, ','.join(coins)))
        print('  n={}  mean={:+.2%}  median={:+.2%}  sd={:.2%}  win={:.1%}  '
              'trades/yr={:.1f}  horizon={} trades (~{:.1f} yr)'.format(
                  len(pnls), mu, st.median(pnls), sd,
                  sum(1 for p in pnls if p > 0) / len(pnls), tpy, hz, hz / tpy if tpy else 0))

        # ---- (1) drawdown profile
        iid = bootstrap_profile(pnls, hz, ks, block=None)
        blk = bootstrap_profile(pnls, hz, ks, block=BLOCK)
        print('  DRAWDOWN PROFILE over {} trades ({} resampled histories each)'.format(hz, N_BOOT))
        print('    {:<26}{:>12}{:>12}{:>12}{:>12}'.format('', 'median', 'p90', 'p95', 'p99'))
        for k in ks:
            row = iid['w%d' % k]
            if not row:
                continue
            print('    worst {:>2}-trade run  iid {:>11} {:>11} {:>11} {:>11}'.format(
                k, *['{:+.1%}'.format(pct(row, q)) for q in (0.50, 0.10, 0.05, 0.01)]))
            rowb = blk['w%d' % k]
            print('    {:<20}block{:>11} {:>11} {:>11} {:>11}'.format(
                '', *['{:+.1%}'.format(pct(rowb, q)) for q in (0.50, 0.10, 0.05, 0.01)]))
        for nm, src in (('iid', iid), ('block', blk)):
            print('    max drawdown     {:<5}{:>11} {:>11} {:>11} {:>11}'.format(
                nm, *['{:+.1%}'.format(pct(src['mdd'], q)) for q in (0.50, 0.10, 0.05, 0.01)]))
        print('      (as account %: multiply by {:.3f} -> p95 iid maxDD {:+.2%} of capital)'.format(
            POSITION_FRACTION, pct(iid['mdd'], 0.05) * POSITION_FRACTION))
        for nm, src in (('iid', iid), ('block', blk)):
            print('    longest losing streak {:<3}{:>7} {:>11} {:>11} {:>11}'.format(
                nm, *[pct(src['streak'], q) for q in (0.50, 0.90, 0.95, 0.99)]))

        # ---- (2) sequential boundary
        cs = calibrate_boundary(pnls, hz, list(ALPHAS.values()),
                                {ALPHAS[r]: MIN_TRADES[r] for r in ALPHAS})
        print('  SEQUENTIAL BOUNDARY  S_n < n*{:+.4f} - c*{:.4f}*sqrt(n)'.format(mu, sd))
        rung_cfg = {}
        for rung in ('half', 'paused', 'retired'):
            a, m = ALPHAS[rung], MIN_TRADES[rung]
            c = cs[a]
            rung_cfg[rung] = {'alpha': a, 'c': round(c, 4), 'min_trades': m}
            # what the boundary actually looks like in money, at two sample sizes
            def line(n):
                return n * mu - c * sd * math.sqrt(n)
            p0 = detection_power(pnls, c, m, hz, edge_scale=0.0)
            p5 = detection_power(pnls, c, m, hz, edge_scale=0.5)
            print('    {:<8} alpha={:.2f} min_n={:<3} c={:.2f} | cum P&L trigger at '
                  'n={}: {:+.1%}   n={}: {:+.1%}'.format(
                      rung, a, m, c, m, line(m), hz, line(hz)))
            print('             power vs DEAD edge: {:.0%} caught, median n={} (p90 {}) | '
                  'vs HALVED edge: {:.0%} caught, median n={}'.format(
                      p0['detected_frac'], p0['median_n'], p0['p90_n'],
                      p5['detected_frac'], p5['median_n']))

        baselines[key] = {
            'label': label,
            'coins': coins,
            'variants': VARIANTS[key],
            'sleeve': SLEEVES[key],
            'n_backtest_trades': len(pnls),
            'mean': round(mu, 6),
            'stdev': round(sd, 6),
            'median': round(st.median(pnls), 6),
            'win_rate': round(sum(1 for p in pnls if p > 0) / len(pnls), 4),
            'trades_per_year': round(tpy, 2),
            'horizon_trades': hz,
            'cost_per_trade': ROUND_TRIP_COST,
            'rungs': rung_cfg,
            'hysteresis': HYSTERESIS,
            'recover_trades': RECOVER_TRADES,
            'drawdown_profile': {
                'bootstrap_paths': N_BOOT,
                'block_len': BLOCK,
                'worst_run': {str(k): {'iid': {q: round(pct(iid['w%d' % k], p), 5)
                                               for q, p in (('p50', 0.50), ('p90', 0.10),
                                                            ('p95', 0.05), ('p99', 0.01))},
                                        'block': {q: round(pct(blk['w%d' % k], p), 5)
                                                  for q, p in (('p50', 0.50), ('p90', 0.10),
                                                               ('p95', 0.05), ('p99', 0.01))}}
                              for k in ks if iid['w%d' % k]},
                'max_drawdown': {'iid': {q: round(pct(iid['mdd'], p), 5)
                                          for q, p in (('p50', 0.50), ('p90', 0.10),
                                                       ('p95', 0.05), ('p99', 0.01))},
                                  'block': {q: round(pct(blk['mdd'], p), 5)
                                            for q, p in (('p50', 0.50), ('p90', 0.10),
                                                         ('p95', 0.05), ('p99', 0.01))}},
                'longest_losing_streak': {'iid': {q: pct(iid['streak'], p)
                                                   for q, p in (('p50', 0.50), ('p90', 0.90),
                                                                ('p95', 0.95), ('p99', 0.99))},
                                           'block': {q: pct(blk['streak'], p)
                                                     for q, p in (('p50', 0.50), ('p90', 0.90),
                                                                  ('p95', 0.95), ('p99', 0.99))}},
            },
        }

    doc = {
        'registered_at': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'generated_by': 'research/degradation.py',
        'seed': SEED,
        'cost_per_trade': ROUND_TRIP_COST,
        'position_fraction': POSITION_FRACTION,
        'note': ('Pre-registered BEFORE any live trade existed (data/trade_log.jsonl did not '
                 'exist at registration). Thresholds and responses are fixed here so that no '
                 'judgement is exercised after seeing a bad run. Re-registering these numbers '
                 'after live data arrives defeats the entire purpose of the file: it is the '
                 'same act as retuning the strategy, one level up.'),
        'strategies': baselines,
    }
    with open(OUT, 'w') as f:
        json.dump(doc, f, indent=1)
    print('\nwrote {}'.format(OUT))
    return book, doc


# Variant strings the live trade log will actually carry (core/trade_log
# records strategy.active_variant_name or strategy.name).
VARIANTS = {
    'forced_flow': ['forced_flow_continuation'],
    'range_break': ['range_break_cascade'],
    'basis': ['basis_dislocation'],
    'donchian': ['donchian_breakout'],
}
SLEEVES = {'forced_flow': 'daily', 'range_break': 'daily',
           'basis': 'daily', 'donchian': 'macro'}


# --------------------------------------------------------------------------
# 6. HOW THIS WOULD HAVE BEHAVED ON THE BACKTEST HISTORY
# --------------------------------------------------------------------------
#
# The obvious objection to any monitor is that it fires on the strategy it was
# built from. So: replay each strategy's real historical trade sequence through
# the finished monitor, in realised order, and report the rung it would have
# sat at over time. A monitor that pauses a strategy on its own backtest is
# broken. A monitor that never leaves `full` on a sequence with the edge
# deleted is useless. Both are checked.

def replay_report(book, doc):
    sys.path.insert(0, ROOT)
    from core.degradation_monitor import Baseline, replay

    print('\n' + '=' * 112)
    print('REPLAY ON BACKTEST HISTORY - would the monitor have fired on the data it came from?')
    print('=' * 112)
    for key, (label, res, coins) in book.items():
        if key not in doc['strategies']:
            continue
        bl = Baseline.from_dict(key, doc['strategies'][key])
        pnls = realised_sequence(res)

        # (a) the real sequence, as it happened
        st_real = replay(pnls, bl)
        # (b) the second (out-of-sample) half only, started from scratch
        half = pnls[len(pnls) // 2:]
        st_test = replay(half, bl)
        # (c) edge deleted: same trades, mean removed. This is the strategy
        #     dying without changing character - the case the monitor exists for.
        mu = st.mean(pnls)
        dead = [p - mu for p in pnls]
        st_dead = replay(dead, bl)
        # (d) sign flipped: the mechanism inverted. Should be caught fast.
        flip = [-p for p in pnls]
        st_flip = replay(flip, bl)

        print('\n{}'.format(label))
        for nm, s in (('actual history', st_real), ('test half only', st_test),
                      ('edge deleted', st_dead), ('sign flipped', st_flip)):
            worst = s.worst_rung_seen
            print('   {:<16} n={:<4} final rung={:<8} worst rung seen={:<8} '
                  'cum P&L={:+.1%} vs expected {:+.1%}   first demotion at trade {}'.format(
                      nm, s.n_trades, s.rung, worst, s.cum_pnl, s.expected_pnl,
                      s.first_demotion_n if s.first_demotion_n else '-'))


if __name__ == '__main__':
    book, doc = main()
    replay_report(book, doc)
