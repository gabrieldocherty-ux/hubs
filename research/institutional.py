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


def deflated_sharpe(returns, n_trials, periods=TRADING_DAYS, sr_variance=None):
    """Probability the true Sharpe is positive, after deflating for the number of
    trials, the sample length, and the shape of the return distribution.

    Returns (DSR, observed annual SR, the SR0 hurdle) all annualised for reading.
    """
    T = len(returns)
    if T < 10:
        return 0.0, 0.0, 0.0
    sd = st.pstdev(returns)
    if sd == 0:
        return 0.0, 0.0, 0.0
    sr = st.mean(returns) / sd                      # per period, NOT annualised
    g3, g4 = skew(returns), kurtosis(returns)
    # Variance of the Sharpe estimates across trials. Without a real spread of
    # trial results, the standard fallback is the sampling variance of one SR.
    if sr_variance is None:
        sr_variance = (1 - g3 * sr + ((g4 - 1) / 4.0) * sr ** 2) / (T - 1)
    sr0 = expected_max_sharpe(n_trials, sr_variance)
    denom = 1 - g3 * sr + ((g4 - 1) / 4.0) * sr ** 2
    if denom <= 0:
        return 0.0, sr * math.sqrt(periods), sr0 * math.sqrt(periods)
    z = (sr - sr0) * math.sqrt(T - 1) / math.sqrt(denom)
    return N.cdf(z), sr * math.sqrt(periods), sr0 * math.sqrt(periods)


# --------------------------------------------------------------------- 2. PBO
def pbo(config_returns, n_splits=10, max_combos=2000):
    """Probability of Backtest Overfitting via combinatorially symmetric CV.

    config_returns: {name: [per-period returns]} - every configuration you tried,
    aligned on the same clock. Needs at least 2 configs to mean anything; the more
    of the real search you pass in, the more honest the answer.
    """
    names = list(config_returns)
    if len(names) < 2:
        return None
    T = min(len(v) for v in config_returns.values())
    if T < n_splits * 4:
        n_splits = max(2, T // 4)
    if n_splits % 2:
        n_splits -= 1
    if n_splits < 2:
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
