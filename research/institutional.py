"""
The validation machinery a professional systematic desk uses, in pure stdlib.

This project already had good habits - trimmed expectancy, train/test splits,
dose-response, variant counting. What it did NOT have is the formal apparatus that
turns "I tried 52 variants, so be careful" into an actual number. That gap is what
this module closes, and it is the difference between careful amateur work and
institutional work.

Four tools, each solving a specific way backtests lie.

1. DEFLATED SHARPE RATIO (Bailey & Lopez de Prado, 2014)
   The problem: run enough backtests and one will look excellent by chance. A
   Sharpe of 1.5 found after 50 trials is not the same evidence as a Sharpe of 1.5
   found on the first try, but conventional statistics treat them identically.
   DSR takes the number of trials, the sample length, and the SKEW and KURTOSIS of
   the returns, and returns the probability that the true Sharpe exceeds zero. It
   penalises exactly the things that flatter a backtest: many trials, short
   samples, negative skew (small gains, rare large losses), and fat tails.
   Read it as: DSR > 0.95 is a genuine result; DSR < 0.90 is not evidence.

2. PROBABILITY OF BACKTEST OVERFITTING (Bailey et al., 2016)
   The problem: picking the best of N parameter configurations is itself a fitting
   procedure, so the winner's in-sample rank tells you nothing. PBO uses
   combinatorially symmetric cross-validation - split the series into S blocks,
   take every possible half as training, pick the config that wins in-sample, then
   look at where it ranks out-of-sample. PBO is how often the in-sample winner
   lands below the median out-of-sample. Above 0.5 the selection procedure is
   worse than random and the "best" parameters are noise.

3. PURGED WALK-FORWARD
   The problem: a plain train/test split leaks when a strategy holds positions for
   k periods, because a trade opened just before the boundary resolves inside the
   test set. Purging removes observations that overlap the boundary and an embargo
   drops a further gap after it.

4. FACTOR ATTRIBUTION
   The problem, and the one most likely to be flattering us: a long-only strategy
   in a market that went up will make money whether or not it has any skill. The
   only question that matters is whether it beats simply holding the thing. This
   regresses strategy returns on the benchmark to split them into BETA (exposure
   you could have had for free) and ALPHA (what the signal actually added), and
   reports the t-statistic of the alpha.

Everything is stdlib - statistics.NormalDist supplies the normal CDF and its
inverse, so no numpy or scipy is required.
"""
import itertools
import math
import statistics as st
from statistics import NormalDist

N = NormalDist()
EULER = 0.5772156649015329
TRADING_DAYS = 252


# --------------------------------------------------------------------- basics
def sharpe(returns, periods=TRADING_DAYS, rf=0.0):
    """Annualised Sharpe. `returns` are per-period simple returns."""
    if len(returns) < 2:
        return 0.0
    ex = [r - rf / periods for r in returns]
    sd = st.pstdev(ex)
    if sd == 0:
        return 0.0
    return (st.mean(ex) / sd) * math.sqrt(periods)


def max_drawdown(returns):
    eq, peak, mdd = 1.0, 1.0, 0.0
    for r in returns:
        eq *= (1 + r)
        peak = max(peak, eq)
        mdd = min(mdd, eq / peak - 1)
    return mdd


def cagr(returns, periods=TRADING_DAYS):
    if not returns:
        return 0.0
    eq = 1.0
    for r in returns:
        eq *= (1 + r)
    yrs = len(returns) / periods
    return eq ** (1 / yrs) - 1 if yrs > 0 and eq > 0 else -1.0


def summary(returns, periods=TRADING_DAYS):
    mdd = max_drawdown(returns)
    c = cagr(returns, periods)
    return {'n': len(returns), 'cagr': c, 'sharpe': sharpe(returns, periods),
            'mdd': mdd, 'calmar': (c / abs(mdd)) if mdd else 0.0,
            'vol': st.pstdev(returns) * math.sqrt(periods) if len(returns) > 1 else 0.0,
            'hit': sum(1 for r in returns if r > 0) / len(returns) if returns else 0.0}


def skew(xs):
    if len(xs) < 3:
        return 0.0
    m, s = st.mean(xs), st.pstdev(xs)
    if s == 0:
        return 0.0
    return sum((x - m) ** 3 for x in xs) / (len(xs) * s ** 3)


def kurtosis(xs):
    """NON-excess kurtosis (normal = 3.0), which is the convention the DSR
    formula below expects. Passing excess kurtosis here would silently shift the
    variance term and inflate every DSR."""
    if len(xs) < 4:
        return 3.0
    m, s = st.mean(xs), st.pstdev(xs)
    if s == 0:
        return 3.0
    return sum((x - m) ** 4 for x in xs) / (len(xs) * s ** 4)


# --------------------------------------------------------------------- 1. DSR
def expected_max_sharpe(n_trials, sr_variance):
    """The Sharpe you should EXPECT as the maximum of n_trials independent
    strategies that all have zero true edge. This is the bar a candidate has to
    clear before it counts as evidence of anything."""
    if n_trials < 2:
        return 0.0
    a = N.inv_cdf(1 - 1.0 / n_trials)
    b = N.inv_cdf(1 - 1.0 / (n_trials * math.e))
    return math.sqrt(sr_variance) * ((1 - EULER) * a + EULER * b)


def trial_sr_variance(config_returns):
    """Var of the Sharpe estimates ACROSS the trials actually run.

    This is the quantity Bailey & Lopez de Prado's SR0 requires, and it is NOT the
    sampling variance of one Sharpe. WHICH WAY the substitution errs was measured
    rather than assumed, because the answer is not one-directional. Sweeping grid
    correlation (`load`, the weight on a shared factor) against how much the
    configurations genuinely differ in true performance, as the ratio
    across-trial Var / single-SR fallback Var:

        true-mean dispersion        load 0.8   load 0.3   load 0.0
        0      identical configs        0.18       0.59       0.94
        0.0002 mild                     0.47       1.47       2.33
        0.0008 large                    4.89      15.15      24.49
        0.0020 extreme                 28.09      78.57     115.84

    Below 1 the fallback OVERSTATES the spread, raising the SR0 hurdle and making
    DSR too harsh - safe. Above 1 it UNDERSTATES, and DSR comes out flattering.
    The crossover sits at very little genuine dispersion, so a grid whose members
    differ in real quality lands in the flattering half, sometimes by 100x.

    THE TABLE ABOVE IS NOT REPRODUCIBLE FROM WHAT IS WRITTEN, and that is a
    defect in this docstring rather than in the finding. It does not state its
    generator - in particular whether the shared factor was normalised out of
    total variance - so an independent sweep reproduces the SHAPE (ratio below 1
    only for near-identical configs, crossover at very little dispersion, past
    100x at high dispersion) but not the magnitudes, and finds a much weaker
    dependence on load. Treat the columns as illustrative of the direction, not
    as measurements to be quoted.

    "THE PUBLISHED GRIDS SIT IN THE SAFE CORNER" IS TRUE OF THE GRIDS AS
    PUBLISHED AND FALSE OF THE SEARCH AS PERFORMED. Per instrument it holds and
    reproduces exactly: the vol-managed 12-config grid gives an across/fallback
    ratio of 0.06 and lowers SR0 from 0.456 to 0.112; the trend 10-config grid
    gives 0.26 (0.319 -> 0.161). But those grids were each run over SIX
    instruments, and pooling the trials that were actually searched brings
    cross-instrument dispersion in:

        vol-managed, 72 cells   ratio 0.06 -> 0.47   still safe
        trend,       60 cells   ratio 0.26 -> 1.16   NO LONGER SAFE

    Above 1 the fallback understates the spread and DSR comes out flattering -
    the exact failure this docstring warns about. So the safe-corner claim must
    be checked against the trial set you actually searched, not the grid you
    happen to be holding. Pass that whole set.
    """
    srs = []
    for r in config_returns.values():
        if len(r) < 2:
            continue
        sd = st.pstdev(r)
        if sd > 0:
            srs.append(st.mean(r) / sd)
    return st.variance(srs) if len(srs) > 1 else None


def _cscv_draw(n_configs, n_obs, n_splits, seed):
    """One pure-noise CSCV draw, via per-block sums.

    Mathematically identical to running pbo() on simulated noise - Sharpe on a
    union of blocks is recoverable from each block's sum and sum of squares - but
    the combination loop stops touching raw observations, so cost no longer scales
    with n_obs. Verified against pbo() on matched seeds: both returned 0.5806.
    """
    import random as _r
    rng = _r.Random(seed)
    size = n_obs // n_splits
    S = [[0.0] * n_splits for _ in range(n_configs)]
    Q = [[0.0] * n_splits for _ in range(n_configs)]
    for c in range(n_configs):
        for b in range(n_splits):
            acc = sq = 0.0
            for _ in range(size):
                x = rng.gauss(0.0, 0.01)
                acc += x
                sq += x * x
            S[c][b] = acc
            Q[c][b] = sq
    n = size * (n_splits // 2)

    def sr_of(c, idx):
        acc = sum(S[c][b] for b in idx)
        sq = sum(Q[c][b] for b in idx)
        v = sq / n - (acc / n) ** 2
        return (acc / n) / math.sqrt(v) if v > 0 else 0.0

    worse = tot = 0
    for tr in itertools.combinations(range(n_splits), n_splits // 2):
        te = tuple(i for i in range(n_splits) if i not in tr)
        ins = [sr_of(c, tr) for c in range(n_configs)]
        best = max(range(n_configs), key=lambda c: ins[c])
        out = [sr_of(c, te) for c in range(n_configs)]
        order = sorted(range(n_configs), key=lambda c: out[c])
        if order.index(best) / max(1, n_configs - 1) < 0.5:
            worse += 1
        tot += 1
    return worse / tot if tot else None


def pbo_null(n_configs, n_obs, n_splits=10, draws=400, seed=70000):
    """The null DISTRIBUTION of PBO for one shape, not a point estimate.

    WHY THIS RETURNS A DISTRIBUTION. The previous version averaged SIX draws and
    returned a single number, and the per-draw spread is sd ~ 0.22 - so its answer
    carried a standard error near 0.09. Seeded at 0 by default, those six draws
    returned 0.593, and that number was reported as "the null" and used to claim
    published results sat far below it. It was noise. Six draws cannot measure a
    mean to better than a tenth, and this function now refuses to pretend
    otherwise: 400 draws by default, and the spread is returned alongside the
    mean so it cannot be quoted without it.

    Returns a dict: mean, sd, median, p01/p05/p10/p25, draws, values.
    """
    vals = [v for v in (_cscv_draw(n_configs, n_obs, n_splits, seed + d)
                        for d in range(draws)) if v is not None]
    if len(vals) < 2:
        return None
    vals.sort()
    q = lambda f: vals[min(len(vals) - 1, int(len(vals) * f))]
    return {'mean': st.mean(vals), 'sd': st.stdev(vals), 'median': q(0.5),
            'p01': q(0.01), 'p05': q(0.05), 'p10': q(0.10), 'p25': q(0.25),
            'draws': len(vals), 'values': vals}


def pbo_pvalue(observed, n_configs, n_obs, n_splits=10, draws=400, seed=70000,
               null=None):
    """P(a no-edge grid of this shape produces a PBO at least this low).

    THIS IS THE NUMBER TO QUOTE, not a raw PBO and not its distance from 0.5. A
    PBO of 0.10 sounds decisive and is not: the null's own sd is ~0.22, so a
    no-edge grid lands below 0.15 about five times in a hundred by luck alone.
    """
    nd = null or pbo_null(n_configs, n_obs, n_splits, draws, seed)
    if not nd:
        return None
    below = sum(1 for v in nd['values'] if v <= observed)
    return {'p_value': (below + 1) / (nd['draws'] + 1),
            'null_mean': nd['mean'], 'null_sd': nd['sd'],
            'sd_below_null': (nd['mean'] - observed) / nd['sd'] if nd['sd'] else None,
            'draws': nd['draws']}


def deflated_sharpe(returns, n_trials, periods=TRADING_DAYS, sr_variance=None):
    """Probability the true Sharpe is positive, after deflating for the number of
    trials, the sample length, and the shape of the return distribution.

    Returns (DSR, observed annual SR, the SR0 hurdle) all annualised for reading.

    FEED THIS THE ACTIVE RETURN, NOT THE TOTAL RETURN, FOR ANY LONG/FLAT RULE.
    This is the single easiest way to get a meaningless pass out of this function
    and this repo walked into it. DSR asks "is the true Sharpe positive". For a
    rule that is long a rising market part of the time, beta answers that for
    free, and the answer has nothing to do with the signal. Measured on this
    repo's own book:

        series                              DSR n=1    n=72    n=204
        VFV.TO BUY AND HOLD (no strategy)    1.0000  0.9508   0.9020
        vol-managed VFV, total return        1.0000  0.9928   0.9815
        trend XIU, total return              1.0000  0.9743   0.9440
        vol-managed VFV, ACTIVE return       0.9963  0.6060   0.4641
        trend XIU, ACTIVE return             0.9993  0.7866   0.6684

    DOING NOTHING SCORES 0.9508 at an honest trial count. Both published
    strategies cleared 0.95 on total return and both FAIL on the active return -
    the part the signal actually added. The total-return figures were not
    evidence of skill; they were evidence the market went up.

    Use attribution() to get beta, subtract beta * benchmark, and deflate that.

    AND NOTE THE TRIAL COUNT BARELY MATTERS ANYWAY. SR0 grows like sqrt(2 ln n),
    so moving 12 -> 72 trials shifts the hurdle 0.46 -> 0.66. DSR is structurally
    insensitive to exactly the correction people reach for it to make. When the
    question is "did this survive the search", a bootstrap max-statistic null over
    the whole search is the number to quote, not this one.
    """
    T = len(returns)
    if T < 10:
        return 0.0, 0.0, 0.0
    sd = st.pstdev(returns)
    if sd == 0:
        return 0.0, 0.0, 0.0
    sr = st.mean(returns) / sd                      # per period, NOT annualised
    g3, g4 = skew(returns), kurtosis(returns)
    # The CORRECT input is the spread of Sharpes across the trials actually run -
    # use trial_sr_variance() and pass it. Falling back to the sampling variance
    # of a SINGLE Sharpe is a different quantity, not an approximation of the same
    # one, and it is called out here because no caller in this repo was passing
    # the real thing.
    if sr_variance is None:
        sr_variance = (1 - g3 * sr + ((g4 - 1) / 4.0) * sr ** 2) / (T - 1)
    sr0 = expected_max_sharpe(n_trials, sr_variance)
    denom = 1 - g3 * sr + ((g4 - 1) / 4.0) * sr ** 2
    if denom <= 0:
        return 0.0, sr * math.sqrt(periods), sr0 * math.sqrt(periods)
    z = (sr - sr0) * math.sqrt(T - 1) / math.sqrt(denom)
    return N.cdf(z), sr * math.sqrt(periods), sr0 * math.sqrt(periods)


# --------------------------------------------------------------------- 2. PBO
MIN_BLOCK = 20        # observations per block; a Sharpe from fewer is noise


def pbo(config_returns, n_splits=10, max_combos=2000, min_block=MIN_BLOCK):
    """Probability of Backtest Overfitting via combinatorially symmetric CV.

    THE NULL IS 0.5. THE PROBLEM IS THE SPREAD, NOT THE CENTRE. Pooled over
    2,400 pure-noise universes (20 configs, T=1,000, 10 splits) this estimator
    returns 0.4991 +/- 0.0041 - dead on 0.5, and the out-of-sample rank of the
    in-sample winner is flat across all 20 rank buckets (4.7-5.4% each against
    5.0% uniform). Six independent seed blocks of 400 all sit within 1.5 standard
    errors of 0.5.

    TWO WRONG EXPLANATIONS WERE COMMITTED TO THIS DOCSTRING BEFORE THAT MEASUREMENT,
    and both are recorded because the way they failed is the lesson. The first
    claimed the null was ~0.60 and that this was inherent to scoring complementary
    splits. The second, after a scaling probe appeared to show decay with sample
    length, claimed it was a finite-sample artefact that vanished as T grew. Both
    rested on 6-to-48-draw samples of a statistic whose per-draw sd is 0.22, which
    gives a standard error of 0.03-0.09 - far too coarse to separate 0.60 from
    0.50. The readings that looked like a consistent 0.59-0.60 bias came from the
    first few seeds: range(12) happens to average 0.597, range(6) 0.593. Three
    small overlapping samples were read as three independent confirmations.

    SO THE REAL CAUTION IS THE OPPOSITE OF THE ONE PREVIOUSLY WRITTEN HERE. The
    centre needs no correction. What needs respecting is that ONE PBO number, from
    ONE dataset, carries roughly +/-0.22 of noise. A PBO of 0.10 is not proof of
    anything on its own - a no-edge grid of the same shape lands at or below 0.147
    five times in a hundred. Quote pbo_pvalue(), which states how often pure noise
    beats the number you measured, rather than the raw PBO or its distance from
    0.5. Measured that way, the two strategies this repo published came out at
    p = 0.026 (vol-managed, PBO 0.103) and p = 0.059 (trend, PBO 0.131) - the
    second does not clear 5%.

    ONE BIAS IS REAL, and it is a different one. For an ODD number of configs the
    rank grid i/(n-1) puts one value exactly on 0.5, and the strict `rank < 0.5`
    test does not count it, so the null becomes (n-1)/(2n) - 0.333 on a 3-config
    grid, not 0.5. Use an even-sized grid, or read against pbo_null() for the
    shape you actually ran.

    pbo_null() simulates INDEPENDENT noise while a real parameter grid holds
    correlated variants of one strategy, so it calibrates the shape effect, not
    the correlation effect.

    GUARDS. This previously accepted three observations, silently built blocks of
    one, computed a "Sharpe" from a single number, and returned 1.0 - a confident
    answer from nothing. Blocks must now hold at least min_block observations.
    """
    names = list(config_returns)
    if len(names) < 2:
        return None
    T = min(len(v) for v in config_returns.values())
    if n_splits % 2:
        n_splits -= 1
    while n_splits >= 2 and T // n_splits < min_block:
        n_splits -= 2
    if n_splits < 2 or T // max(1, n_splits) < min_block:
        return None
    size = T // n_splits
    blocks = [list(range(i * size, (i + 1) * size)) for i in range(n_splits)]

    worse = tot = 0
    combos = list(itertools.combinations(range(n_splits), n_splits // 2))
    if len(combos) > max_combos:
        step = max(1, len(combos) // max_combos)
        combos = combos[::step]
    for tr in combos:
        te = [i for i in range(n_splits) if i not in tr]
        tr_idx = [i for b in tr for i in blocks[b]]
        te_idx = [i for b in te for i in blocks[b]]
        in_s = {n: sharpe([config_returns[n][i] for i in tr_idx]) for n in names}
        best = max(in_s, key=in_s.get)
        out = {n: sharpe([config_returns[n][i] for i in te_idx]) for n in names}
        ranked = sorted(names, key=lambda n: out[n])
        rank = ranked.index(best) / max(1, len(names) - 1)   # 0 worst .. 1 best
        if rank < 0.5:
            worse += 1
        tot += 1
    return worse / tot if tot else None


# --------------------------------------------------------------------- 3. purging
def purged_folds(n_obs, k=5, hold=1, embargo=0.01):
    """K-fold splits with the training observations that overlap each test fold
    removed, plus an embargo after it. Yields (train_idx, test_idx)."""
    fold = n_obs // k
    emb = int(n_obs * embargo)
    for i in range(k):
        lo, hi = i * fold, (n_obs if i == k - 1 else (i + 1) * fold)
        test = list(range(lo, hi))
        train = [j for j in range(n_obs)
                 if j < lo - hold or j >= hi + hold + emb]
        if train and test:
            yield train, test


# --------------------------------------------------------------------- 4. alpha
def attribution(strategy_returns, benchmark_returns, periods=TRADING_DAYS):
    """Split strategy returns into beta (free exposure) and alpha (added value).

    THE question for any long-only strategy: did the signal add anything, or did
    it just hold a rising market part of the time? Reports annualised alpha and
    its t-statistic. An alpha t-stat below ~2 means the strategy has not
    demonstrably beaten simply owning the benchmark.
    """
    n = min(len(strategy_returns), len(benchmark_returns))
    if n < 30:
        return None
    y = strategy_returns[-n:]
    x = benchmark_returns[-n:]
    mx, my = st.mean(x), st.mean(y)
    vx = sum((xi - mx) ** 2 for xi in x)
    if vx == 0:
        return None
    beta = sum((x[i] - mx) * (y[i] - my) for i in range(n)) / vx
    alpha = my - beta * mx
    resid = [y[i] - (alpha + beta * x[i]) for i in range(n)]
    se_res = st.pstdev(resid)
    se_alpha = se_res / math.sqrt(n) if n else 0
    # exposure: fraction of periods actually holding a position
    return {'alpha_ann': alpha * periods, 'beta': beta,
            't_alpha': (alpha / se_alpha) if se_alpha else 0.0,
            'r2': 1 - (st.pvariance(resid) / st.pvariance(y)) if st.pvariance(y) else 0.0,
            'te_ann': se_res * math.sqrt(periods),
            'ir': (alpha * periods) / (se_res * math.sqrt(periods)) if se_res else 0.0}


def block_bootstrap_ci(returns, stat=None, block=21, draws=2000, seed=7, lo=5, hi=95):
    """Confidence interval that preserves serial correlation.

    Resampling single days independently destroys the clustering of losing runs
    and makes every risk number too optimistic - a failure mode already recorded
    in this project's risk skill. Sampling BLOCKS keeps streaks intact.
    """
    import random
    stat = stat or (lambda r: cagr(r))
    rng = random.Random(seed)
    n = len(returns)
    if n < block * 3:
        return None
    out = []
    nb = n // block
    for _ in range(draws):
        s = []
        for _ in range(nb):
            i = rng.randint(0, n - block)
            s.extend(returns[i:i + block])
        out.append(stat(s))
    out.sort()
    return {'p{}'.format(lo): out[int(len(out) * lo / 100)],
            'median': out[len(out) // 2],
            'p{}'.format(hi): out[int(len(out) * hi / 100)]}


def report(name, rets, bench=None, n_trials=1, periods=TRADING_DAYS):
    """One formatted block per strategy. This is the standard output format."""
    s = summary(rets, periods)
    dsr, sr, sr0 = deflated_sharpe(rets, n_trials, periods)
    lines = ['  {:<26} CAGR {:>7}  Sharpe {:>5}  maxDD {:>7}  Calmar {:>5}  hit {:>4}'.format(
        name, '{:+.2%}'.format(s['cagr']), '{:.2f}'.format(s['sharpe']),
        '{:.1%}'.format(s['mdd']), '{:.2f}'.format(s['calmar']), '{:.0%}'.format(s['hit']))]
    lines.append('  {:<26} DSR {:>8}  (SR {:.2f} vs SR0 hurdle {:.2f} at {} trials)'.format(
        '', '{:.3f}'.format(dsr), sr, sr0, n_trials))
    if bench is not None:
        a = attribution(rets, bench, periods)
        if a:
            lines.append('  {:<26} alpha {:>6}/yr  t={:.2f}  beta {:.2f}  IR {:.2f}'.format(
                '', '{:+.2%}'.format(a['alpha_ann']), a['t_alpha'], a['beta'], a['ir']))
    return '\n'.join(lines)
