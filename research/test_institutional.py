"""
An independent audit of research/institutional.py - the statistical machinery
every validation claim in this project rests on.

The hypothesis under test is uncomfortable: if any of these five functions is
wrong, then every "validated", "rejected", "DSR 0.97", "alpha t=3.1" statement
ever written in this repo is wrong too, and nobody would have noticed, because
each function is only ever checked against its own output.

So nothing here checks institutional.py against institutional.py. Every test
either

  (a) computes the answer a SECOND, independent way - by hand arithmetic on a
      tiny dataset, by a separately-written closed form, or from a textbook
      analytic value (kurtosis of a uniform is exactly 1.8, no sampling), or
  (b) constructs synthetic data where the correct answer is known by
      construction - pure noise configs MUST give PBO ~= 0.5, a strategy with
      zero true edge MUST fail a correctly-deflated Sharpe test at roughly the
      nominal rate - and measures whether the function delivers it.

That (b) class is the one that matters. Matching a formula only proves the code
implements the formula the auditor also believes in. Calibrating against a known
null proves the formula does the job it is being trusted to do.

Run:  python -m pytest research/test_institutional.py -q
      python research/test_institutional.py     (prints the measured numbers)
"""
import math
import random
import statistics as st
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import institutional as inst
from statistics import NormalDist

NORM = NormalDist()


# ------------------------------------------------------------------ helpers
def gauss_series(n, mu=0.0, sd=1.0, seed=1):
    rng = random.Random(seed)
    return [rng.gauss(mu, sd) for _ in range(n)]


def ar1_series(n, rho, sd=1.0, seed=1):
    """AR(1) with a known population lag-1 autocorrelation of exactly rho."""
    rng = random.Random(seed)
    out, x = [], 0.0
    innov = sd * math.sqrt(1 - rho * rho)
    for _ in range(n + 500):                    # burn-in so it starts stationary
        x = rho * x + rng.gauss(0.0, innov)
        out.append(x)
    return out[500:]


def acf1(xs):
    """Lag-1 autocorrelation, written from the definition, not reused."""
    m = st.mean(xs)
    num = sum((xs[i] - m) * (xs[i + 1] - m) for i in range(len(xs) - 1))
    den = sum((x - m) ** 2 for x in xs)
    return num / den if den else 0.0


def ols_reference(y, x):
    """Textbook simple OLS, written independently of institutional.attribution.

    Solves the 2x2 normal equations directly rather than using the deviation
    form, so an algebra slip in one would not be mirrored in the other:

        [ n      Sx  ] [a]   [ Sy  ]
        [ Sx     Sxx ] [b] = [ Sxy ]

    Standard errors are the textbook ones:
        s^2      = SSE / (n - 2)                 <- n-2, two params estimated
        se(beta) = s / sqrt(Sum (x-xbar)^2)
        se(alpha)= s * sqrt(1/n + xbar^2 / Sum (x-xbar)^2)
    """
    n = len(y)
    Sx = sum(x)
    Sy = sum(y)
    Sxx = sum(xi * xi for xi in x)
    Sxy = sum(x[i] * y[i] for i in range(n))
    det = n * Sxx - Sx * Sx
    a = (Sxx * Sy - Sx * Sxy) / det
    b = (n * Sxy - Sx * Sy) / det
    resid = [y[i] - (a + b * x[i]) for i in range(n)]
    sse = sum(e * e for e in resid)
    s2 = sse / (n - 2)
    xbar = Sx / n
    sxx_dev = sum((xi - xbar) ** 2 for xi in x)
    se_a = math.sqrt(s2 * (1.0 / n + xbar * xbar / sxx_dev))
    se_b = math.sqrt(s2 / sxx_dev)
    ybar = Sy / n
    sst = sum((yi - ybar) ** 2 for yi in y)
    return {'alpha': a, 'beta': b, 't_alpha': a / se_a, 't_beta': b / se_b,
            'se_alpha': se_a, 'se_beta': se_b, 'sse': sse, 'r2': 1 - sse / sst,
            's': math.sqrt(s2)}


def dsr_reference(returns, n_trials, sr_variance=None):
    """Bailey & Lopez de Prado DSR, written out from the published definition.

        SR0 = sqrt(V) * [ (1-gamma) Z^-1(1 - 1/N) + gamma Z^-1(1 - 1/(N e)) ]
        DSR = Z[ (SRhat - SR0) sqrt(T-1) / sqrt(1 - g3 SRhat + (g4-1)/4 SRhat^2) ]

    with g4 the NON-excess kurtosis (3 for a normal) and gamma Euler-Mascheroni.
    """
    T = len(returns)
    mu = sum(returns) / T
    var = sum((r - mu) ** 2 for r in returns) / T           # population, as code does
    sd = math.sqrt(var)
    sr = mu / sd
    g3 = sum((r - mu) ** 3 for r in returns) / (T * sd ** 3)
    g4 = sum((r - mu) ** 4 for r in returns) / (T * sd ** 4)
    if sr_variance is None:
        sr_variance = (1 - g3 * sr + ((g4 - 1) / 4.0) * sr ** 2) / (T - 1)
    if n_trials < 2:
        sr0 = 0.0
    else:
        g = 0.5772156649015329
        sr0 = math.sqrt(sr_variance) * (
            (1 - g) * NORM.inv_cdf(1 - 1.0 / n_trials)
            + g * NORM.inv_cdf(1 - 1.0 / (n_trials * math.e)))
    denom = 1 - g3 * sr + ((g4 - 1) / 4.0) * sr ** 2
    z = (sr - sr0) * math.sqrt(T - 1) / math.sqrt(denom)
    return NORM.cdf(z), sr, sr0


def approx(a, b, tol=1e-9):
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


# =========================================================== BASIC STATISTICS
def test_kurtosis_is_non_excess():
    """The docstring promises non-excess (normal = 3). Checked against two
    distributions whose population kurtosis is known EXACTLY, so there is no
    sampling error to argue about.

      uniform on [0,1]  -> kurtosis exactly 9/5 = 1.8
      two-point +-1     -> kurtosis exactly 1.0
    """
    n = 200000
    unif = [(i + 0.5) / n for i in range(n)]     # deterministic uniform grid
    k = inst.kurtosis(unif)
    assert abs(k - 1.8) < 1e-3, 'uniform kurtosis should be 1.8, got {}'.format(k)

    two_point = [1.0, -1.0] * 5000
    assert abs(inst.kurtosis(two_point) - 1.0) < 1e-12

    # and a normal sample lands near 3, not near 0 - which is what "non-excess"
    # means in practice
    g = gauss_series(200000, seed=11)
    kg = inst.kurtosis(g)
    assert 2.9 < kg < 3.1, 'normal sample kurtosis {} - not the 3.0 convention'.format(kg)


def test_skew_exact_on_hand_computed_set():
    """xs = [0,0,0,4]: mean 1, deviations (-1,-1,-1,3),
       pvar = (1+1+1+9)/4 = 3, sd = sqrt(3)
       m3   = (-1-1-1+27)/4 = 6
       skew = 6 / 3^1.5 = 6/5.196152 = 1.1547005"""
    xs = [0.0, 0.0, 0.0, 4.0]
    assert approx(inst.skew(xs), 6.0 / (3.0 ** 1.5), 1e-12)
    assert abs(inst.skew(gauss_series(100000, seed=3))) < 0.03


def test_sharpe_hand_computed():
    """rets = [0.01,-0.01,0.02,0.00]: mean 0.005,
       pvar = ((.005)^2+(.015)^2+(.015)^2+(.005)^2)/4 = (25+225+225+25)e-6/4
            = 125e-6, sd = 0.01118034
       SR_period = 0.005/0.01118034 = 0.4472136;  x sqrt(252) = 7.0993"""
    r = [0.01, -0.01, 0.02, 0.00]
    expect = (0.005 / math.sqrt(125e-6)) * math.sqrt(252)
    assert approx(inst.sharpe(r), expect, 1e-12)
    assert inst.sharpe([0.01]) == 0.0
    assert inst.sharpe([0.01, 0.01]) == 0.0          # zero dispersion -> 0


def test_max_drawdown_and_cagr_hand_computed():
    """+50%, -50%, +10%  ->  equity 1.5, 0.75, 0.825; peak 1.5; mdd = 0.75/1.5-1 = -0.5"""
    r = [0.5, -0.5, 0.1]
    assert approx(inst.max_drawdown(r), -0.5, 1e-12)
    eq = 1.5 * 0.5 * 1.1                              # = 0.825
    yrs = 3 / 252.0
    assert approx(inst.cagr(r), eq ** (1 / yrs) - 1, 1e-9)
    # total wipeout: equity 0 -> the -1.0 guard fires rather than a math domain error
    assert inst.cagr([-1.0, 0.1]) == -1.0


# ================================================================ 1.  DSR
def test_expected_max_sharpe_approximates_expected_max_of_n_normals():
    """With sr_variance = 1 the SR0 hurdle IS the expected maximum of n_trials
    iid standard normals. That expectation is measurable by Monte Carlo, which
    is genuinely independent of the Bailey/Lopez de Prado closed form."""
    rng = random.Random(42)
    for n_trials in (5, 20, 50, 200):
        draws = [max(rng.gauss(0, 1) for _ in range(n_trials)) for _ in range(20000)]
        mc = st.mean(draws)
        closed = inst.expected_max_sharpe(n_trials, 1.0)
        rel = abs(closed - mc) / mc
        assert rel < 0.04, 'n={} closed form {:.4f} vs MC E[max] {:.4f} ({:.1%} off)'.format(
            n_trials, closed, mc, rel)


def test_expected_max_sharpe_monotone_and_scaled():
    assert inst.expected_max_sharpe(1, 1.0) == 0.0
    vals = [inst.expected_max_sharpe(n, 1.0) for n in (2, 5, 10, 50, 500)]
    assert all(vals[i] < vals[i + 1] for i in range(len(vals) - 1))
    # scales as sqrt(variance)
    assert approx(inst.expected_max_sharpe(50, 4.0),
                  2 * inst.expected_max_sharpe(50, 1.0), 1e-12)


def test_deflated_sharpe_matches_the_published_formula():
    """Reimplementation check. This proves the code implements the B&LdP
    expression - it does NOT prove the expression is the right thing to trust;
    test_deflated_sharpe_calibration below does that."""
    for seed in (1, 2, 3):
        r = [x for x in gauss_series(600, mu=0.0004, sd=0.01, seed=seed)]
        for n_trials in (1, 2, 10, 100):
            got, sr, sr0 = inst.deflated_sharpe(r, n_trials)
            exp, esr, esr0 = dsr_reference(r, n_trials)
            assert approx(got, exp, 1e-12), (seed, n_trials, got, exp)
            assert approx(sr, esr * math.sqrt(252), 1e-12)
            assert approx(sr0, esr0 * math.sqrt(252), 1e-12)


def test_deflated_sharpe_reduces_to_psr_at_one_trial():
    r = gauss_series(500, mu=0.0005, sd=0.01, seed=5)
    dsr, sr, sr0 = inst.deflated_sharpe(r, 1)
    assert sr0 == 0.0
    T = len(r)
    mu, sd = st.mean(r), st.pstdev(r)
    s = mu / sd
    g3, g4 = inst.skew(r), inst.kurtosis(r)
    psr = NORM.cdf(s * math.sqrt(T - 1) / math.sqrt(1 - g3 * s + ((g4 - 1) / 4) * s ** 2))
    assert approx(dsr, psr, 1e-12)


def test_deflated_sharpe_is_monotone_decreasing_in_trials():
    r = gauss_series(800, mu=0.0006, sd=0.01, seed=9)
    d = [inst.deflated_sharpe(r, n)[0] for n in (1, 2, 5, 20, 100, 1000)]
    assert all(d[i] >= d[i + 1] for i in range(len(d) - 1)), d
    assert d[0] - d[-1] > 0.01, 'trial count barely moved DSR: {}'.format(d)


def test_deflated_sharpe_calibration_under_the_null():
    """THE test. Simulate the exact thing DSR exists to catch: run N backtests
    on pure noise, keep the best one, ask DSR whether it is real.

    A correctly calibrated deflation should almost never return DSR > 0.95 here,
    because by construction there is no edge in any of these series. The
    undeflated version (n_trials=1) should fail loudly, which is what makes the
    comparison informative rather than vacuous.
    """
    rng = random.Random(2024)
    N_TRIALS, T, REPS = 20, 750, 500
    deflated_hits = naive_hits = 0
    for _ in range(REPS):
        best_r, best_sr = None, -1e9
        for _ in range(N_TRIALS):
            r = [rng.gauss(0.0, 0.01) for _ in range(T)]
            s = st.mean(r) / st.pstdev(r)
            if s > best_sr:
                best_sr, best_r = s, r
        if inst.deflated_sharpe(best_r, N_TRIALS)[0] > 0.95:
            deflated_hits += 1
        if inst.deflated_sharpe(best_r, 1)[0] > 0.95:
            naive_hits += 1
    d_rate, n_rate = deflated_hits / REPS, naive_hits / REPS
    print('    [null calibration] DSR>0.95 on best-of-{} pure noise:'
          ' deflated {:.1%}  undeflated {:.1%}'.format(N_TRIALS, d_rate, n_rate))
    assert d_rate < 0.10, 'deflation lets {:.1%} of pure noise through at 0.95'.format(d_rate)
    assert n_rate > 0.30, 'undeflated control did not misfire ({:.1%}) - ' \
                          'test is not exercising anything'.format(n_rate)


def test_passing_excess_kurtosis_would_inflate_dsr():
    """The kurtosis docstring warns that feeding EXCESS kurtosis silently
    inflates DSR. Confirm the warning is real and measure the size, because if
    any caller ever hands in an excess-kurtosis sr_variance this is the damage."""
    r = gauss_series(600, mu=0.0005, sd=0.01, seed=17)
    T = len(r)
    mu, sd = st.mean(r), st.pstdev(r)
    s = mu / sd
    g3 = inst.skew(r)
    correct = inst.kurtosis(r)
    excess = correct - 3.0

    def z_for(g4):
        return NORM.cdf(s * math.sqrt(T - 1) /
                        math.sqrt(1 - g3 * s + ((g4 - 1) / 4) * s ** 2))
    assert z_for(excess) >= z_for(correct)
    assert approx(inst.deflated_sharpe(r, 1)[0], z_for(correct), 1e-12)


def test_deflated_sharpe_guards():
    assert inst.deflated_sharpe([0.01] * 5, 10) == (0.0, 0.0, 0.0)       # T < 10
    assert inst.deflated_sharpe([0.01] * 50, 10) == (0.0, 0.0, 0.0)      # zero sd


def test_dsr_fallback_variance_direction_depends_on_grid_dispersion():
    """The sr_variance=None fallback substitutes the sampling variance of a SINGLE
    Sharpe for the spread of Sharpes ACROSS trials. An earlier version of this
    test asserted the fallback always UNDERSTATES the real spread. It does not -
    which way it errs depends on whether the configurations differ in genuine
    quality, and the earlier test happened to construct the one case where the
    direction reverses (every config with the same true mean).

    Ratio = across-trial Var / fallback Var. Below 1 the fallback is too harsh
    and DSR comes out understated (safe); above 1 DSR comes out flattering.
    """
    def ratio(load, disp, T=750, NCFG=12, reps=24):
        out = []
        for rep in range(reps):
            rng = random.Random(9000 + rep)
            common = [rng.gauss(0.0004, 0.010) for _ in range(T)]
            cfgs = []
            for _ in range(NCFG):
                mu = rng.gauss(0.0, disp)
                idio = [rng.gauss(mu, 0.004) for _ in range(T)]
                cfgs.append([load * common[i] + idio[i] for i in range(T)])
            srs = [st.mean(c) / st.pstdev(c) for c in cfgs]
            best = max(srs)
            ref = cfgs[srs.index(best)]
            single = (1 - inst.skew(ref) * best
                      + ((inst.kurtosis(ref) - 1) / 4) * best ** 2) / (T - 1)
            out.append(st.variance(srs) / single)
        return st.median(out)

    tight = ratio(0.8, 0.0)        # correlated grid, no genuine dispersion
    spread = ratio(0.0, 0.0020)    # independent configs of genuinely different quality
    print('    [sr_variance] identical configs, correlated grid: ratio {:.2f}'.format(tight))
    print('    [sr_variance] dispersed configs, independent:     ratio {:.1f}'.format(spread))
    assert tight < 1.0, 'expected the fallback to be too harsh here, got {:.2f}'.format(tight)
    assert spread > 5.0, 'expected the fallback to flatter here, got {:.1f}'.format(spread)

    # And the consequence for DSR, in the safe corner the real grids occupy.
    rng = random.Random(77)
    T, NCFG = 750, 12
    common = [rng.gauss(0.0004, 0.010) for _ in range(T)]
    cfgs = [[0.8 * common[i] + g[i] for i in range(T)]
            for g in ([[rng.gauss(0.0, 0.004) for _ in range(T)] for _ in range(NCFG)])]
    srs = [st.mean(c) / st.pstdev(c) for c in cfgs]
    ref = cfgs[srs.index(max(srs))]
    across = inst.trial_sr_variance({str(i): c for i, c in enumerate(cfgs)})
    dsr_fb, _, sr0_fb = inst.deflated_sharpe(ref, NCFG)
    dsr_tr, _, sr0_tr = inst.deflated_sharpe(ref, NCFG, sr_variance=across)
    print('    [sr_variance] SR0 hurdle {:.2f} -> {:.2f};  DSR {:.3f} -> {:.3f}'
          .format(sr0_fb, sr0_tr, dsr_fb, dsr_tr))
    assert sr0_tr < sr0_fb, 'true across-trial variance should lower the hurdle here'
    assert dsr_tr >= dsr_fb, 'so DSR should rise: the fallback was the harsh one'


# ================================================================ 2.  PBO
def _pbo_null(n_cfg, T, seed, n_splits=10):
    rng = random.Random(seed)
    return inst.pbo({'c{}'.format(i): [rng.gauss(0, 0.01) for _ in range(T)]
                     for i in range(n_cfg)}, n_splits=n_splits)


def test_pbo_on_pure_noise_is_about_one_half():
    """Configurations with no edge and no relationship to each other: the
    in-sample winner is a coin flip out of sample, so PBO must sit at 0.5.

    THIS TEST WAS PREVIOUSLY UNDERPOWERED AND THAT CAUSED A REAL ERROR. It drew
    12 universes and demanded the mean fall in 0.42-0.58. Per-universe sd is 0.22,
    so 12 draws carry a standard error of 0.06 and the check was flaky by
    construction - it happened to draw 0.597 and was read as evidence that the
    null was really ~0.60, which was then written into institutional.py twice with
    two different wrong explanations. 400 draws put the standard error near 0.011.
    """
    nd = inst.pbo_null(20, 1000, draws=400)
    se = nd['sd'] / math.sqrt(nd['draws'])
    print('    [pbo null] mean {:.4f}  sd {:.3f}  se {:.4f}  z vs 0.5 = {:+.1f}'
          .format(nd['mean'], nd['sd'], se, (nd['mean'] - 0.5) / se))
    assert abs(nd['mean'] - 0.5) < 4 * se, (
        'pure-noise PBO centred at {:.4f}, not 0.5'.format(nd['mean']))
    assert nd['sd'] > 0.15, (
        'a single PBO is supposed to be noisy; sd came out {:.3f}'.format(nd['sd']))


def test_pbo_null_engine_matches_the_real_pbo():
    """pbo_null uses a block-sum shortcut instead of calling pbo(). If the two
    ever diverge, every null and p-value in this repo is measuring the wrong
    estimator. Same seeds, same draw order, so they must agree exactly."""
    T, NCFG, SEEDS = 1000, 20, 8
    slow = []
    for seed in range(1000, 1000 + SEEDS):
        rng = random.Random(seed)
        slow.append(inst.pbo({'c{}'.format(i): [rng.gauss(0, 0.01) for _ in range(T)]
                              for i in range(NCFG)}))
    fast = [inst._cscv_draw(NCFG, T, 10, seed) for seed in range(1000, 1000 + SEEDS)]
    print('    [engine] pbo() mean {:.4f}   _cscv_draw() mean {:.4f}'
          .format(st.mean(slow), st.mean(fast)))
    for a, b in zip(slow, fast):
        assert abs(a - b) < 1e-9, (a, b)


def test_pbo_pvalue_is_what_should_be_quoted():
    """A low PBO is much weaker evidence than it looks, because the null's own sd
    is ~0.22. This pins the published results to honest p-values."""
    nd = inst.pbo_null(12, 3471, draws=300)
    r = inst.pbo_pvalue(0.103, 12, 3471, null=nd)
    print('    [published] vol-managed PBO 0.103 -> p = {:.3f} ({:.1f} sd below null)'
          .format(r['p_value'], r['sd_below_null']))
    assert 0.01 < r['p_value'] < 0.08, r
    # A PBO sitting at the null must not read as evidence of anything.
    mid = inst.pbo_pvalue(nd['median'], 12, 3471, null=nd)
    print('    [control]   PBO at the null median -> p = {:.2f}'.format(mid['p_value']))
    assert mid['p_value'] > 0.4, mid


def test_pbo_rank_normalisation_biases_small_grids_low():
    """DEFECT PROBE. rank = index / (n_configs - 1) puts the rank values on a
    grid {0, 1/(n-1), ..., 1}. For an ODD number of configs one value lands
    exactly on 0.5 and the strict `rank < 0.5` test does not count it, so the
    null PBO is (n-1)/(2n), not 0.5. On a 3-config grid that is 0.333.
    """
    for n_cfg in (3, 5, 9):
        vals = [_pbo_null(n_cfg, 1000, 100 + s) for s in range(16)]
        m = st.mean(vals)
        predicted = (n_cfg - 1) / (2.0 * n_cfg)
        print('    [pbo small-grid bias] {} configs: measured {:.3f}, '
              'predicted (n-1)/2n = {:.3f}, unbiased would be 0.500'.format(
                  n_cfg, m, predicted))
        assert abs(m - predicted) < 0.06, (n_cfg, m, predicted)
        assert m < 0.47, 'expected a downward (flattering) bias at n={}'.format(n_cfg)


def test_pbo_detects_a_genuinely_superior_config():
    """One config has a real edge in every sub-period. The in-sample winner is
    then the out-of-sample winner every time and PBO must collapse to 0."""
    rng = random.Random(5)
    T = 1000
    cfgs = {'good': [rng.gauss(0.0015, 0.01) for _ in range(T)]}
    for i in range(9):
        cfgs['n{}'.format(i)] = [rng.gauss(0.0, 0.01) for _ in range(T)]
    p = inst.pbo(cfgs)
    print('    [pbo, one real winner] {:.3f}'.format(p))
    assert p < 0.05, p


def test_pbo_detects_a_constructed_overfit():
    """Adversarial construction: every config's second half is the NEGATIVE of
    its first half. Whatever wins in sample must lose out of sample, so a
    working PBO has to report a number close to 1."""
    rng = random.Random(6)
    T = 1000
    cfgs = {}
    for i in range(10):
        first = [rng.gauss(0, 0.01) for _ in range(T // 2)]
        cfgs['c{}'.format(i)] = first + [-x for x in first]
    p = inst.pbo(cfgs, n_splits=2)
    print('    [pbo, constructed overfit, 2 splits] {:.3f}'.format(p))
    assert p > 0.9, p


def test_pbo_drops_the_tail_of_the_series():
    """T % n_splits observations at the end never enter any block. Harmless at
    T=1000/S=10 but silent, and it is always the MOST RECENT data that is cut."""
    T, S = 1007, 10
    size = T // S
    used = size * S
    assert used == 1000 and T - used == 7


def test_pbo_combo_subsampling_is_systematic_not_random():
    """DEFECT PROBE. When C(S, S/2) exceeds max_combos the code keeps every
    step-th combination of a LEXICOGRAPHIC list. That is a structured stride,
    not a sample: some blocks land in the training half far more often than
    others. Measured here on S=16 (12870 combos) capped to 300.
    """
    import itertools
    S, cap = 16, 300
    combos = list(itertools.combinations(range(S), S // 2))
    step = max(1, len(combos) // cap)
    kept = combos[::step]
    counts = [sum(1 for c in kept if b in c) for b in range(S)]
    exp = len(kept) * (S // 2) / S
    spread = (max(counts) - min(counts)) / exp
    print('    [pbo stride] block train-membership counts {} (expected {:.0f} each,'
          ' spread {:.1%})'.format(counts, exp, spread))
    assert spread > 0.10, 'expected the lexicographic stride to unbalance blocks'
    # a genuine random subsample of the same size does not do this
    rng = random.Random(1)
    rand_kept = rng.sample(combos, len(kept))
    rc = [sum(1 for c in rand_kept if b in c) for b in range(S)]
    rspread = (max(rc) - min(rc)) / exp
    print('    [pbo stride] random subsample of equal size spread {:.1%}'.format(rspread))
    assert rspread < spread


def test_pbo_guards():
    assert inst.pbo({'a': [0.01] * 100}) is None            # needs >= 2 configs
    assert inst.pbo({'a': [0.01] * 3, 'b': [0.01] * 3}) is None   # too short


# ============================================================ 3.  PURGED FOLDS
def test_purged_folds_leak_nothing_inside_the_hold_window():
    """The property that matters: a training observation opened at j resolves at
    j + hold. If j + hold lands in the test fold, that training row already
    knows the test outcome. Assert it never happens, for every fold, over a
    sweep of k / hold / embargo."""
    for n_obs in (200, 503, 1000):
        for k in (3, 5, 10):
            for hold in (0, 1, 5, 21):
                for emb in (0.0, 0.01, 0.05):
                    folds = list(inst.purged_folds(n_obs, k=k, hold=hold, embargo=emb))
                    assert folds, (n_obs, k, hold, emb)
                    e = int(n_obs * emb)
                    for train, test in folds:
                        lo, hi = test[0], test[-1] + 1
                        assert test == list(range(lo, hi))
                        for j in train:
                            # forward leak: the trade opened at j resolves in test
                            assert not (lo <= j + hold and j < lo), \
                                'train {} + hold {} reaches into test [{},{})'.format(
                                    j, hold, lo, hi)
                            # the test fold itself, plus hold + embargo after it
                            assert not (lo <= j < hi + hold + e), \
                                'train {} inside test/embargo [{},{})'.format(
                                    j, lo, hi + hold + e)


def test_purged_folds_cover_every_observation_exactly_once_in_test():
    for n_obs, k in ((1000, 5), (1007, 5), (997, 10)):
        seen = []
        for _, test in inst.purged_folds(n_obs, k=k, hold=1):
            seen.extend(test)
        assert sorted(seen) == list(range(n_obs)), (n_obs, k, len(seen))


def test_purged_folds_embargo_is_one_sided_by_design():
    """Lopez de Prado's embargo is applied only AFTER the test set (serial
    correlation runs forward). Documented here so nobody 'fixes' it later."""
    train, test = list(inst.purged_folds(1000, k=5, hold=0, embargo=0.05))[2]
    lo, hi = test[0], test[-1] + 1
    assert (lo - 1) in train, 'no gap before the test fold - this is intentional'
    assert (hi + 49) not in train and (hi + 50) in train   # 1000*0.05 = 50


def test_purged_folds_degenerate_input_yields_nothing():
    assert list(inst.purged_folds(3, k=5)) == []
    assert list(inst.purged_folds(0, k=5)) == []


# ============================================================ 4.  ATTRIBUTION
HAND_X = [1.0, 2.0, 3.0, 4.0, 5.0] * 10       # n = 50, mean 3, Sum(x-xbar)^2 = 100
HAND_Y = [2.0, 4.0, 5.0, 4.0, 5.0] * 10       # mean 4


def test_attribution_alpha_and_beta_match_hand_arithmetic():
    """Worked by hand on the block [1..5] / [2,4,5,4,5], tiled 10x:
         xbar=3  ybar=4   Sum(x-xbar)^2 = 10 per block -> 100
         Sum(x-xbar)(y-ybar) = 4+0+0+0+2 = 6 per block -> 60
         beta  = 60/100 = 0.6
         alpha = 4 - 0.6*3 = 2.2
         fitted 2.8,3.4,4.0,4.6,5.2 ; resid -0.8,0.6,1.0,-0.6,-0.2 (sums to 0)
         SSE   = 0.64+0.36+1.00+0.36+0.04 = 2.4 per block -> 24.0
    """
    a = inst.attribution(HAND_Y, HAND_X, periods=252)
    assert approx(a['beta'], 0.6, 1e-12), a['beta']
    assert approx(a['alpha_ann'], 2.2 * 252, 1e-12)
    ref = ols_reference(HAND_Y, HAND_X)
    assert approx(ref['beta'], 0.6, 1e-12)
    assert approx(ref['alpha'], 2.2, 1e-12)
    assert approx(ref['sse'], 24.0, 1e-12)
    assert approx(a['r2'], ref['r2'], 1e-12)


def test_attribution_t_alpha_uses_the_wrong_standard_error():
    """DEFECT. The intercept standard error in simple OLS is

        se(alpha) = s * sqrt( 1/n + xbar^2 / Sum(x - xbar)^2 )

    institutional.py uses s / sqrt(n), dropping the xbar^2 / Sxx term entirely,
    and computes s with an n divisor instead of n-2. Both errors push the same
    way: the reported t_alpha is too BIG. Overstatement factor is

        sqrt(n/(n-2)) * sqrt(1 + mean(x)^2 / popvar(x))

    On the hand dataset that is large because x has a big mean relative to its
    spread. On daily returns it is small - quantified in the next test - but the
    formula is wrong either way.
    """
    a = inst.attribution(HAND_Y, HAND_X)
    ref = ols_reference(HAND_Y, HAND_X)
    n = len(HAND_X)
    mx = st.mean(HAND_X)
    factor = math.sqrt(n / (n - 2.0)) * math.sqrt(1 + mx ** 2 / st.pvariance(HAND_X))
    print('    [attribution] reported t_alpha {:.4f}  correct OLS t_alpha {:.4f}'
          '  overstated {:.2f}x'.format(a['t_alpha'], ref['t_alpha'],
                                        a['t_alpha'] / ref['t_alpha']))
    assert a['t_alpha'] > ref['t_alpha']
    assert approx(a['t_alpha'] / ref['t_alpha'], factor, 1e-9), (
        a['t_alpha'] / ref['t_alpha'], factor)
    # and the beta the code reports IS right - the defect is confined to the SE
    assert approx(a['beta'], ref['beta'], 1e-12)


def test_attribution_t_alpha_error_on_realistic_daily_returns():
    """Size the defect where it actually bites this project: daily-frequency
    benchmark returns, where mean/sd per period is ~0.05 and the dropped term is
    therefore tiny. Reported so the finding can be ranked honestly rather than
    dramatically."""
    rng = random.Random(31)
    T = 1500
    bench = [rng.gauss(0.0004, 0.011) for _ in range(T)]
    strat = [0.55 * bench[i] + rng.gauss(0.00015, 0.006) for i in range(T)]
    a = inst.attribution(strat, bench)
    ref = ols_reference(strat, bench)
    ratio = a['t_alpha'] / ref['t_alpha']
    print('    [attribution, daily] t_alpha reported {:.3f} vs correct {:.3f}'
          '  ({:+.2%} overstated)'.format(a['t_alpha'], ref['t_alpha'], ratio - 1))
    assert ratio > 1.0
    assert ratio < 1.01, 'daily-frequency inflation should be under 1%'


def test_attribution_t_alpha_error_explodes_at_low_frequency():
    """The same bug at MONTHLY frequency, where mean/sd per period is large.
    Nothing in institutional.py stops a caller passing monthly or quarterly
    series - `periods` is a free parameter - and there the dropped term is not
    negligible."""
    rng = random.Random(32)
    T = 400
    bench = [rng.gauss(0.008, 0.012) for _ in range(T)]      # ~0.67 monthly mean/sd
    strat = [0.6 * bench[i] + rng.gauss(0.001, 0.010) for i in range(T)]
    a = inst.attribution(strat, bench, periods=12)
    ref = ols_reference(strat, bench)
    ratio = a['t_alpha'] / ref['t_alpha']
    print('    [attribution, monthly] t_alpha reported {:.3f} vs correct {:.3f}'
          '  ({:.2f}x overstated)'.format(a['t_alpha'], ref['t_alpha'], ratio))
    assert ratio > 1.1, ratio


def test_attribution_r2_and_ir_are_right():
    rng = random.Random(8)
    T = 800
    bench = [rng.gauss(0.0004, 0.011) for _ in range(T)]
    strat = [0.7 * bench[i] + rng.gauss(0.0002, 0.004) for i in range(T)]
    a = inst.attribution(strat, bench)
    ref = ols_reference(strat, bench)
    assert approx(a['r2'], ref['r2'], 1e-12)
    # te_ann / ir are built off the n-divisor residual sd, so they are the
    # population version by design - assert exactly that, so a later change
    # to n-2 shows up as a test failure rather than a silent shift
    resid = [strat[i] - (ref['alpha'] + ref['beta'] * bench[i]) for i in range(T)]
    assert approx(a['te_ann'], st.pstdev(resid) * math.sqrt(252), 1e-12)
    assert approx(a['ir'], a['alpha_ann'] / a['te_ann'], 1e-12)


def test_attribution_silently_tail_aligns_mismatched_lengths():
    """HAZARD. attribution takes the LAST n of each series. pbo() and the
    engine elsewhere align from the FRONT. Two different conventions in one
    module, neither announced, and callers in this repo pass benchmarks both
    ways (`bench` full-length, and `bench[:len(r)]` pre-trimmed).
    """
    rng = random.Random(4)
    bench = [rng.gauss(0.0004, 0.01) for _ in range(500)]
    strat = [b * 2 for b in bench[300:]]           # the LAST 200, beta must be 2
    a = inst.attribution(strat, bench)
    assert approx(a['beta'], 2.0, 1e-9), a['beta']
    # front-aligning instead gives an unrelated, near-zero beta - the exact
    # failure a caller produces by passing bench[:len(r)] for a series that was
    # truncated by a warm-up window at the FRONT
    b2 = inst.attribution(strat, bench[:len(strat)])
    assert abs(b2['beta'] - 2.0) > 0.5, b2['beta']
    print('    [alignment] tail-aligned beta {:.3f} vs front-aligned {:.3f}'
          ' (truth = 2.000)'.format(a['beta'], b2['beta']))


def test_attribution_guards():
    assert inst.attribution([0.01] * 29, [0.01] * 29) is None       # n < 30
    assert inst.attribution([0.01] * 50, [0.01] * 50) is None       # zero var x


# ====================================================== 5.  BLOCK BOOTSTRAP
def test_block_bootstrap_preserves_autocorrelation_and_iid_does_not():
    """The claim in the docstring is that block sampling keeps streaks intact.
    Measure it: build an AR(1) with rho = 0.5, resample it both ways, and read
    the lag-1 autocorrelation back off the resampled paths.

    A moving-block bootstrap cannot preserve rho exactly - one join per block
    breaks the chain - so the target is rho * (1 - 1/block), and that prediction
    is checked too, because a function that preserved MORE than that would be
    the suspicious one.
    """
    rho, block, n = 0.5, 21, 2000
    base = ar1_series(n, rho, seed=13)
    print('    [bootstrap] source series lag-1 acf {:.3f} (target rho {:.2f})'.format(
        acf1(base), rho))

    rng = random.Random(99)
    blk_acf, iid_acf = [], []
    for _ in range(200):
        s = []
        for _ in range(n // block):
            i = rng.randint(0, n - block)
            s.extend(base[i:i + block])
        blk_acf.append(acf1(s))
        iid_acf.append(acf1([base[rng.randint(0, n - 1)] for _ in range(len(s))]))
    b, i_ = st.mean(blk_acf), st.mean(iid_acf)
    predicted = rho * (1 - 1.0 / block)
    print('    [bootstrap] block-resampled acf {:.3f} (predicted {:.3f});'
          ' iid-resampled acf {:.3f}'.format(b, predicted, i_))
    assert abs(i_) < 0.05, 'iid control should destroy autocorrelation, got {:.3f}'.format(i_)
    assert b > 0.35, 'block bootstrap did not preserve autocorrelation: {:.3f}'.format(b)
    assert abs(b - predicted) < 0.06, (b, predicted)


def test_block_bootstrap_ci_shape_and_ordering():
    r = ar1_series(1000, 0.3, sd=0.01, seed=21)
    ci = inst.block_bootstrap_ci(r, block=21, draws=800)
    assert set(ci) == {'p5', 'median', 'p95'}
    assert ci['p5'] <= ci['median'] <= ci['p95']
    assert inst.block_bootstrap_ci(r[:50], block=21) is None      # n < 3*block


def test_block_bootstrap_ci_is_deterministic_for_a_given_seed():
    r = ar1_series(800, 0.2, sd=0.01, seed=22)
    a = inst.block_bootstrap_ci(r, block=21, draws=400)
    b = inst.block_bootstrap_ci(r, block=21, draws=400)
    assert a == b
    c = inst.block_bootstrap_ci(r, block=21, draws=400, seed=8)
    assert c != a


def test_block_bootstrap_underweights_the_edges_of_the_series():
    """DEFECT PROBE. In a moving-block bootstrap with start index drawn
    uniformly from [0, n-block], observation j is contained in

        min(j, n-block, block-1, n-block-j+block-1) + 1

    distinct blocks - so the first and last (block-1) observations are sampled
    up to `block` times LESS often than an interior one. With block=21 the
    oldest and newest 20 observations carry ~1/21 the weight of the middle.

    This project has already been burned once by a bootstrap that structurally
    could not produce the event that causes ruin. If the worst day of the sample
    is near either edge, this shrinks it further.
    """
    n, block, draws = 1000, 21, 40000
    rng = random.Random(123)
    counts = [0] * n
    for _ in range(draws):
        i = rng.randint(0, n - block)
        for j in range(i, i + block):
            counts[j] += 1
    interior = st.mean(counts[block:n - block])
    print('    [bootstrap edges] obs 0 sampled {}x, obs {} sampled {}x,'
          ' interior mean {:.0f}x -> edge weight {:.2f}% of interior'.format(
              counts[0], n - 1, counts[n - 1], interior,
              100.0 * counts[0] / interior))
    assert counts[0] < 0.10 * interior
    assert counts[n - 1] < 0.10 * interior


def test_block_bootstrap_cannot_generate_an_unseen_tail():
    """Not a bug - a hard limit, and one this project has already recorded as a
    past failure. Assert it explicitly so the limitation is a test, not a memo:
    no resampled path ever contains a day worse than the worst observed day."""
    r = ar1_series(900, 0.2, sd=0.01, seed=31)
    worst = min(r)
    got = inst.block_bootstrap_ci(r, stat=lambda s: min(s), block=21, draws=1500)
    assert got['p5'] >= worst - 1e-15
    assert got['median'] >= worst - 1e-15
    print('    [bootstrap tail] worst observed day {:.4%}; worst day any resampled'
          ' path produced {:.4%}'.format(worst, got['p5']))


def test_block_bootstrap_default_stat_annualises_at_252():
    """The default statistic is cagr() at its DEFAULT periods=252. Every caller
    in research/ passes daily series so this happens to be right, but a 4h or
    hourly series would be annualised by 252 with no warning."""
    r = [0.001] * 1000
    ci = inst.block_bootstrap_ci(r, block=21, draws=50)
    nb = 1000 // 21
    expect = (1.001 ** (nb * 21)) ** (1 / ((nb * 21) / 252.0)) - 1
    assert approx(ci['median'], expect, 1e-9)


# =================================================================== report()
def test_report_runs_and_does_not_crash_on_a_short_benchmark():
    r = gauss_series(400, mu=0.0005, sd=0.01, seed=44)
    b = gauss_series(400, mu=0.0003, sd=0.011, seed=45)
    out = inst.report('unit-test', r, b, n_trials=12)
    assert 'DSR' in out and 'alpha' in out
    short = inst.report('no-bench', r, b[:10], n_trials=12)
    assert 'alpha' not in short          # attribution returned None, line dropped


if __name__ == '__main__':
    fns = [(k, v) for k, v in sorted(globals().items()) if k.startswith('test_')]
    fails = []
    for name, fn in fns:
        try:
            fn()
            print('PASS  {}'.format(name))
        except AssertionError as e:
            fails.append((name, e))
            print('FAIL  {}  {}'.format(name, e))
        except Exception as e:                                  # noqa
            fails.append((name, e))
            print('ERROR {}  {!r}'.format(name, e))
    print('\n{} passed, {} failed, of {}'.format(len(fns) - len(fails), len(fails), len(fns)))
