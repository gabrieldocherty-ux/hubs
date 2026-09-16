"""
Adversarial stress testing: try to break a strategy before the market does.

THE DESIGN PRINCIPLE, AND WHY IT IS NOT A MONTE CARLO SIMULATOR.
The obvious way to "stress test" a strategy is to take its realised daily returns,
resample them a few thousand times, and read off the spread of outcomes. That is
worse than useless here, and it is worth being precise about why, because the
output LOOKS like rigorous risk analysis:

  1. It treats the return distribution as a property of the STRATEGY. It is not.
     It is a property of the strategy interacting with the particular market it
     traded. Resampling those returns cannot produce a market the strategy never
     saw, which is the only kind that matters.
  2. The strategy never reacts. Real stress changes WHEN a rule trades, not just
     what it earns - a trend rule in a choppy tape trades more and loses on
     whipsaws, and no amount of resampling its historical returns will show that.
  3. Independent resampling destroys volatility clustering, and volatility
     clustering is what MAKES drawdowns. Every risk number comes out flattering.
  4. It answers "the same edge with different luck", which assumes the edge. The
     question worth asking is whether the edge survives a different world.

So everything here follows one rule instead:

        PERTURB THE INPUTS AND RE-RUN THE RULE.
        NEVER RESAMPLE THE OUTPUTS.

A strategy in this file is a function from market data to a weight series. Stress
changes the market data, the cost of acting on it, or the timing of acting on it,
and then runs the SAME rule again, so the rule's own behaviour changes in
response. What comes back out is a genuinely different equity curve, not a
reshuffling of the old one.

WHAT THIS IS DEFENDING AGAINST, concretely. This project published a strategy at
Sharpe 3.30 with an alpha t-statistic of 11.55 and had to withdraw it: the edge
was an artefact of one fund's opening prints. It also spent two docstrings
explaining a PBO bias that did not exist, because the null had been measured from
six draws of a statistic whose standard deviation is 0.22. Both failures share a
shape - a number was produced, it was not attacked hard enough, and it was
believed. The point of this module is to do the attacking on purpose.

HONEST LIMITS OF WHAT IS HERE. Every test below perturbs a world that is still
built from the ONE history that actually happened. Nothing here can tell you about
a regime absent from the sample. The structural-break and regime sections are the
closest available substitute, and they are not the same thing.
"""
import math
import random
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import institutional as inst
import tsx_engine as eng

TRADING_DAYS = inst.TRADING_DAYS


# ===================================================================== helpers
def _align(weights, rets):
    """Weight series in this repo are sometimes one shorter than the return
    series (already lagged by construction). Line them up without silently
    inventing an observation."""
    n = min(len(weights), len(rets))
    return list(weights[:n]), list(rets[:n])


def run_with_costs(weights, rets, cost_series, start_w=0.0):
    """eng.run(), but cost per unit of turnover VARIES by period.

    The fixed-cost version is right for a calm market and wrong for the days that
    matter: spreads widen and depth thins exactly when a signal fires hardest.
    A constant cost assumption quietly hands the strategy free liquidity in every
    crisis it trades through.
    """
    out = []
    prev = start_w
    for i, w in enumerate(weights):
        turn = abs(w - prev)
        out.append(w * rets[i] - turn * (cost_series[i] / 2.0))
        prev = w
    return out


def _stats(rets, bench=None):
    if not rets or len(rets) < 30:
        return None
    s = inst.summary(rets)
    d = {'cagr': s['cagr'], 'sharpe': s['sharpe'], 'mdd': s['mdd'],
         'calmar': s['calmar'], 'n': len(rets)}
    if bench is not None:
        a = inst.attribution(rets, bench[:len(rets)])
        d['alpha'] = a['alpha_ann'] if a else None
        d['t_alpha'] = a['t_alpha'] if a else None
    return d


# ======================================================== 1. EXECUTION STRESS
def execution_stress(weight_fn, market, multiples=(1, 2, 3, 4, 6, 8),
                     delays=(0, 1, 2, 3)):
    """Cost multiples crossed with execution DELAY.

    Two different failure modes, and only the first is usually tested:

    COST. The repo models 2x measured cost already. Multiplying further finds the
    point where the edge dies, and that number - the break-even multiple - is more
    informative than a pass/fail at any single assumption.

    DELAY is the one that gets missed, and it is not a cost at all. Acting k days
    after the signal means capturing a DIFFERENT set of returns. A strategy whose
    edge is a genuine risk premium barely notices a one-day delay. A strategy
    whose edge is a microstructure artefact loses everything, because the artefact
    has already reverted. This is the cheapest available test for telling the two
    apart, and running it on the withdrawn overnight strategy would have exposed
    that strategy immediately.
    """
    rets, rt = market['ret'], market['rt']
    rows = []
    for delay in delays:
        w = list(weight_fn(market))
        if delay:
            w = ([0.0] * delay + w[:-delay]) if delay < len(w) else [0.0] * len(w)
        ww, rr = _align(w, rets)
        for m in multiples:
            r = eng.run(ww, rr, rt * m)
            s = _stats(r, rets)
            if s:
                rows.append(dict(s, delay=delay, mult=m))
    return rows


def breakeven_cost_multiple(weight_fn, market, hi=40.0, tol=0.01):
    """The cost multiple at which CAGR hits zero. Bisection, not a grid - the
    answer is a single number and it deserves to be reported as one."""
    rets, rt = market['ret'], market['rt']
    w, rr = _align(weight_fn(market), rets)
    f = lambda m: inst.cagr(eng.run(w, rr, rt * m))
    if f(0.0) <= 0:
        return 0.0
    if f(hi) > 0:
        return float('inf')
    lo = 0.0
    while hi - lo > tol:
        mid = (lo + hi) / 2.0
        if f(mid) > 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


# ======================================================== 2. LIQUIDITY STRESS
def impact_costs(weights, rets, base_rt, vol_window=20, k=0.6, crisis_mult=3.0,
                 vol_percentile=0.90):
    """Cost that RISES with volatility, via the square-root impact law.

    cost_i = base_rt * (1 + k * sqrt(vol_i / median_vol)), with a further
    crisis_mult on days in the top vol_percentile of the sample.

    The square-root form is the standard market-impact relationship (Almgren,
    Torre, and essentially every execution desk): impact grows with the square
    root of participation, not linearly. The vol scaling is the part that matters
    for stress, because it couples cost to exactly the days a volatility- or
    trend-sensitive rule changes its position most. A flat cost model prices a
    crisis trade the same as a Tuesday in August.

    This is a MODEL, not a measurement. It is stated here rather than buried so
    the assumption can be argued with.
    """
    vol = eng.rolling_vol(rets, vol_window)
    known = [v for v in vol if v]
    med = st.median(known) if known else None
    if not med:
        return [base_rt] * len(rets)
    cut = sorted(known)[min(len(known) - 1, int(len(known) * vol_percentile))]
    out = []
    for i in range(len(rets)):
        v = vol[i - 1] if i > 0 and vol[i - 1] else med
        c = base_rt * (1.0 + k * math.sqrt(max(v, 1e-12) / med))
        if cut and v >= cut:
            c *= crisis_mult
        out.append(c)
    return out


def liquidity_stress(weight_fn, market, participation_caps=(0.5, 0.25, 0.1)):
    """Two liquidity failures at once: cost that rises with stress, and SIZE you
    cannot get.

    The participation cap is the under-modelled one. At $1,000 it is irrelevant
    and that is worth saying plainly rather than implying a constraint that does
    not bind. It is included because the same strategy at $100,000 on a thin TSX
    listing is a different strategy, and because a rule that only works at full
    size is fragile in a way that a rule degrading gracefully is not.
    """
    rets, rt = market['ret'], market['rt']
    w0, rr = _align(weight_fn(market), rets)
    rows = []
    rows.append(dict(_stats(eng.run(w0, rr, rt), rets), label='baseline'))
    imp = impact_costs(w0, rr, rt)
    rows.append(dict(_stats(run_with_costs(w0, rr, imp), rets),
                     label='vol-scaled impact', mean_cost_bp=st.mean(imp) * 1e4))
    for cap in participation_caps:
        wc = [min(x, cap) for x in w0]
        rows.append(dict(_stats(run_with_costs(wc, rr, imp), rets),
                         label='impact + {:.0%} size cap'.format(cap)))
    return rows


# =========================================================== 3. REGIME STRESS
def classify_regimes(bench_rets, vol_window=60):
    """Regimes from the MARKET, never from the strategy.

    Splitting on the strategy's own outcomes ("what happens in bad months for the
    strategy") is circular and guarantees a scary-looking answer. These labels use
    only trailing benchmark information, so every observation could have been
    classified in real time - and a strategy can therefore be asked the fair
    question: does it earn its keep in each state of the world, or is it one bet
    on one regime?
    """
    vol = eng.rolling_vol(bench_rets, vol_window)
    known = sorted(v for v in vol if v)
    if len(known) < 10:
        return ['all'] * len(bench_rets)
    lo, hi = known[len(known) // 3], known[2 * len(known) // 3]
    peak, dd, eq = -1e18, [], 1.0
    for r in bench_rets:
        eq *= (1 + r)
        peak = max(peak, eq)
        dd.append(eq / peak - 1)
    out = []
    for i in range(len(bench_rets)):
        v = vol[i - 1] if i > 0 and vol[i - 1] else None
        d = dd[i - 1] if i > 0 else 0.0
        if v is None:
            out.append('warmup')
        elif d < -0.15:
            out.append('drawdown >15%')
        elif v >= hi:
            out.append('high vol')
        elif v <= lo:
            out.append('low vol')
        else:
            out.append('mid vol')
    return out


def regime_stress(weight_fn, market):
    rets = market['ret']
    w, rr = _align(weight_fn(market), rets)
    r = eng.run(w, rr, market['rt'])
    labels = classify_regimes(rr)[:len(r)]
    buckets = {}
    for i, lab in enumerate(labels):
        b = buckets.setdefault(lab, {'s': [], 'b': [], 'w': []})
        b['s'].append(r[i])
        b['b'].append(rr[i])
        b['w'].append(w[i])
    rows = []
    for lab, d in buckets.items():
        if len(d['s']) < 20:
            continue
        rows.append({'regime': lab, 'n': len(d['s']),
                     'strat_ann': st.mean(d['s']) * TRADING_DAYS,
                     'bench_ann': st.mean(d['b']) * TRADING_DAYS,
                     'exposure': st.mean(d['w']),
                     'sharpe': inst.sharpe(d['s'])})
    return sorted(rows, key=lambda x: -x['n'])


def worst_windows(rets, lengths=(21, 63, 126, 252)):
    """Worst contiguous stretch of each length - the drawdown an investor would
    actually have had to sit through, rather than a summary statistic about it."""
    out = []
    for L in lengths:
        if len(rets) < L + 1:
            continue
        logs = [math.log1p(x) if x > -1 else -20.0 for x in rets]
        run = sum(logs[:L])
        best, at = run, 0
        for i in range(1, len(logs) - L + 1):
            run += logs[i + L - 1] - logs[i - 1]
            if run < best:
                best, at = run, i
        out.append({'days': L, 'worst_return': math.exp(best) - 1, 'start_idx': at})
    return out


# ======================================================== 4. PARAMETER STRESS
def parameter_stress(build_fn, market, grid):
    """Is the chosen setting a plateau or a cliff edge?

    A real edge is broad: neighbouring parameters work nearly as well, because the
    mechanism does not care about the exact number. An overfit is a spike - the
    chosen cell is excellent and its neighbours are not, which means the number
    was chosen by the noise rather than by the mechanism.

    Reports the share of the grid that stays positive and the gap between best and
    median. A best-minus-median gap that is large relative to the spread of the
    grid is the signature to worry about.
    """
    rets = market['ret']
    res = {}
    for key in grid:
        w, rr = _align(build_fn(market, key), rets)
        s = _stats(eng.run(w, rr, market['rt']), rets)
        if s:
            res[key] = s
    if not res:
        return None
    cagrs = sorted(v['cagr'] for v in res.values())
    sharpes = sorted(v['sharpe'] for v in res.values())
    return {'cells': len(res),
            'positive_share': sum(1 for c in cagrs if c > 0) / len(cagrs),
            'cagr_median': st.median(cagrs), 'cagr_min': cagrs[0], 'cagr_max': cagrs[-1],
            'sharpe_median': st.median(sharpes), 'sharpe_min': sharpes[0],
            'sharpe_max': sharpes[-1],
            'best_minus_median_sharpe': sharpes[-1] - st.median(sharpes),
            'best_key': max(res, key=lambda k: res[k]['sharpe']),
            'per_cell': res}


# ===================================================== 5. STRUCTURAL BREAK
def _mean_break_supf(x):
    """Supremum Wald statistic for a break in mean at an UNKNOWN date.

    Testing a break at a date chosen by looking at the data is the classic way to
    manufacture significance, so the statistic maximises over all candidate dates
    and the null is simulated for that same maximised statistic (Quandt/Andrews).
    Trimmed to the middle 70% because the extremes are unstable by construction.

    Uses prefix sums so the sweep is O(n) rather than O(n^2) - the bootstrap below
    calls this several hundred times.
    """
    n = len(x)
    lo, hi = int(n * 0.15), int(n * 0.85)
    if hi - lo < 20:
        return None, None
    cs, cs2 = [0.0] * (n + 1), [0.0] * (n + 1)
    for i, v in enumerate(x):
        cs[i + 1] = cs[i] + v
        cs2[i + 1] = cs2[i] + v * v
    tot, tot2 = cs[n], cs2[n]
    best, at = 0.0, None
    for k in range(lo, hi):
        na, nb = k, n - k
        if na < 10 or nb < 10:
            continue
        ma, mb = cs[k] / na, (tot - cs[k]) / nb
        va = cs2[k] / na - ma * ma
        vb = (tot2 - cs2[k]) / nb - mb * mb
        se2 = max(va, 0.0) / na + max(vb, 0.0) / nb
        if se2 <= 0:
            continue
        f = (ma - mb) * (ma - mb) / se2
        if f > best:
            best, at = f, k
    return best, at


def _stationary_bootstrap(x, mean_block, rng):
    """Politis & Romano. Block lengths are geometric, so the resampled series is
    stationary - unlike fixed blocks, which put a seam at a predictable period and
    can create artefacts at exactly the horizon being tested."""
    n = len(x)
    p = 1.0 / max(1, mean_block)
    out = []
    i = rng.randrange(n)
    while len(out) < n:
        out.append(x[i])
        if rng.random() < p:
            i = rng.randrange(n)
        else:
            i = (i + 1) % n
    return out


def structural_break(rets, bench=None, draws=400, mean_block=21, seed=11):
    """Did the edge CHANGE, not merely vary?

    The null is simulated by stationary bootstrap of the strategy's own returns,
    which preserves serial dependence while destroying any genuine break. That
    matters: serially correlated data throws up large sup-F values on its own, and
    comparing against a textbook chi-square critical value would declare a break
    in almost any strategy.

    Also reports the same test on the ACTIVE return (strategy minus beta times
    benchmark), because a strategy can look stable while its ALPHA has gone and
    only its market exposure remains. Beta is estimated on the full sample, which
    is a real limitation: a break in beta itself would partly leak into this test.
    """
    rng = random.Random(seed)
    out = {}
    stat, at = _mean_break_supf(rets)
    if stat is None:
        return None

    def _p(observed, series):
        null = []
        for _ in range(draws):
            s, _a = _mean_break_supf(_stationary_bootstrap(series, mean_block, rng))
            if s is not None:
                null.append(s)
        null.sort()
        return ((sum(1 for v in null if v >= observed) + 1) / (len(null) + 1),
                null[int(len(null) * 0.95)] if null else None)

    p, p95 = _p(stat, rets)
    out['mean_break'] = {'supF': stat, 'at_idx': at, 'p_value': p, 'null_p95': p95}
    if bench is not None:
        n = min(len(rets), len(bench))
        a = inst.attribution(rets[:n], bench[:n])
        if a:
            beta = a['beta']
            act = [rets[i] - beta * bench[i] for i in range(n)]
            stat2, at2 = _mean_break_supf(act)
            if stat2 is not None:
                p2, p95b = _p(stat2, act)
                out['alpha_break'] = {'supF': stat2, 'at_idx': at2, 'p_value': p2,
                                      'null_p95': p95b, 'beta_used': beta}
    h = len(rets) // 2
    out['halves'] = {'first_cagr': inst.cagr(rets[:h]),
                     'second_cagr': inst.cagr(rets[h:]),
                     'first_sharpe': inst.sharpe(rets[:h]),
                     'second_sharpe': inst.sharpe(rets[h:])}
    return out


# ================================================================ 6. TAIL RISK
def hill_tail_index(losses, tail_frac=0.05):
    """Hill estimator of the tail index on the LOSS tail.

    Reported because the Gaussian assumption behind ordinary VaR is not merely
    imprecise in the tail, it is the wrong shape. A tail index near or below 2
    means the variance of the loss distribution is effectively undefined in the
    tail, and any risk number built on a standard deviation is then describing
    something the data does not have.

    Lower index = fatter tail. Normal-ish is roughly 4+; equity indices typically
    land near 3.
    """
    xs = sorted((-x for x in losses if x < 0), reverse=True)
    k = max(10, int(len(xs) * tail_frac))
    if len(xs) <= k or k < 10:
        return None
    thr = xs[k]
    if thr <= 0:
        return None
    s = sum(math.log(xs[i] / thr) for i in range(k))
    return k / s if s > 0 else None


def tail_stress(rets, block=21, draws=2000, seed=3):
    """Expected shortfall, tail index, and a drawdown DISTRIBUTION.

    The realised maximum drawdown is one draw from a distribution, not a bound.
    Quoting it as the worst case is one of the most common risk errors in retail
    backtesting: the sample simply may not have contained the bad path yet. The
    block bootstrap here keeps losing streaks intact, because independent
    resampling breaks up exactly the clustering that creates deep drawdowns.

    Note this is the ONE place the module resamples a return series rather than
    re-running the rule, and it is legitimate here because the question is about
    the distribution of PATHS of a given return process, not about whether the
    edge exists.
    """
    rng = random.Random(seed)
    s = sorted(rets)
    n = len(s)
    q = lambda f: s[max(0, min(n - 1, int(n * f)))]
    var95, var99 = q(0.05), q(0.01)
    tail95 = [x for x in s if x <= var95]
    tail99 = [x for x in s if x <= var99]
    mdds = []
    nb = max(1, n // block)
    for _ in range(draws):
        path = []
        for _ in range(nb):
            i = rng.randint(0, max(0, n - block))
            path.extend(rets[i:i + block])
        mdds.append(inst.max_drawdown(path))
    # Drawdowns are NEGATIVE, so ascending order puts the most SEVERE first and
    # mdds[-1] is the mildest path, not the worst. Reading the percentiles off the
    # wrong end reported a "worst case" of -7.9% against a realised -13.0% - a
    # stress test that made the strategy look safer than it had actually been.
    # p95 here means "95% of paths were milder than this".
    mdds.sort()
    n_d = len(mdds)
    return {'var95': var95, 'var99': var99,
            'es95': st.mean(tail95) if tail95 else None,
            'es99': st.mean(tail99) if tail99 else None,
            'tail_index': hill_tail_index(rets),
            'realised_mdd': inst.max_drawdown(rets),
            'mdd_median': mdds[n_d // 2],
            'mdd_p95': mdds[int(n_d * 0.05)],
            'mdd_p99': mdds[int(n_d * 0.01)],
            'mdd_worst': mdds[0]}


# ============================================================= 7. PATH STRESS
def path_stress(weight_fn, market, mean_blocks=(5, 21, 63), draws=200, seed=17):
    """Resample the MARKET, then re-run the rule on it.

    This is the test a naive Monte Carlo is pretending to be. The market's return
    path is resampled by stationary bootstrap and the strategy is recomputed from
    scratch on each synthetic history, so its signals fire in different places and
    its trade count changes. The output is what the rule would have done in a
    market that behaved like this one but did not follow this exact sequence.

    READ THE BLOCK LENGTH BEFORE READING THE RESULT. Bootstrapping destroys serial
    structure at horizons longer than the mean block, and a trend rule's entire
    edge IS serial structure. Running a 200-day trend strategy at a 5-day block is
    not a stress test, it is a test of whether the strategy needs trends, and the
    answer is known in advance. Reporting several block lengths makes that
    dependence visible instead of hiding it inside one number: the honest reading
    is the block length at or above the strategy's own signal horizon.
    """
    rng = random.Random(seed)
    rets = market['ret']
    base_w, base_r = _align(weight_fn(market), rets)
    base = inst.sharpe(eng.run(base_w, base_r, market['rt']))
    rows = []
    for mb in mean_blocks:
        sharpes, cagrs = [], []
        for _ in range(draws):
            path = _stationary_bootstrap(rets, mb, rng)
            # The synthetic bars MUST start one period before the first return,
            # matching the real convention where ret[i] = c[i+1]/c[i] - 1 and a
            # weight computed from c[i] is applied to ret[i].
            #
            # Seeding px with the first return instead made px[i] the close at the
            # END of period i, so a price-reading rule sized period i using the
            # outcome of period i - a textbook lookahead. It inflated the trend
            # strategy's bootstrapped Sharpe to 1.18-1.27 against a realised 0.89
            # and put the real result at the 0th percentile of its own null, which
            # is what exposed it: a trend rule cannot do BETTER on data whose
            # trends have been destroyed. Rules reading only `ret` (the vol-managed
            # sleeve) were unaffected, so the defect was invisible there.
            eq = 100.0
            px = [eq]
            for r in path:
                eq *= (1 + r)
                px.append(eq)
            synth = {'ret': path, 'rt': market['rt'],
                     'bars': [{'c': p, 'o': p, 'h': p, 'l': p} for p in px],
                     'dates': market.get('dates')}
            w, rr = _align(weight_fn(synth), path)
            r = eng.run(w, rr, market['rt'])
            if len(r) > 30:
                sharpes.append(inst.sharpe(r))
                cagrs.append(inst.cagr(r))
        if not sharpes:
            continue
        sharpes.sort()
        rows.append({'mean_block': mb, 'draws': len(sharpes),
                     'sharpe_median': sharpes[len(sharpes) // 2],
                     'sharpe_p05': sharpes[int(len(sharpes) * 0.05)],
                     'sharpe_p95': sharpes[int(len(sharpes) * 0.95)],
                     'cagr_median': st.median(cagrs),
                     'share_beating_zero': sum(1 for s in sharpes if s > 0) / len(sharpes),
                     'realised_sharpe': base,
                     'realised_pctile': sum(1 for s in sharpes if s < base) / len(sharpes)})
    return rows


# ======================================================== 8. FAILURE ANALYSIS
def failure_analysis(weight_fn, market, top=5):
    """WHEN does it lose, and was it exposed at the time?

    A strategy that loses while flat has a different problem from one that loses
    while fully invested, and the summary statistics cannot tell them apart. The
    exposure column is the one to read.
    """
    rets = market['ret']
    w, rr = _align(weight_fn(market), rets)
    r = eng.run(w, rr, market['rt'])
    dates = market.get('dates') or list(range(len(r)))
    eq, peak, episodes, cur = 1.0, 1.0, [], None
    for i, x in enumerate(r):
        eq *= (1 + x)
        if eq >= peak:
            if cur:
                cur['end'] = i
                cur['recovered'] = True
                episodes.append(cur)
                cur = None
            peak = eq
        else:
            d = eq / peak - 1
            if cur is None:
                cur = {'start': i, 'trough': d, 'trough_idx': i}
            elif d < cur['trough']:
                cur['trough'] = d
                cur['trough_idx'] = i
    if cur:
        cur['end'] = len(r) - 1
        cur['recovered'] = False
        episodes.append(cur)
    episodes.sort(key=lambda e: e['trough'])
    out = []
    for e in episodes[:top]:
        seg = slice(e['start'], e['end'] + 1)
        wseg, bseg = w[seg], rr[seg]
        out.append({'from': dates[e['start']] if e['start'] < len(dates) else '?',
                    'to': dates[min(e['end'], len(dates) - 1)],
                    'depth': e['trough'], 'days': e['end'] - e['start'] + 1,
                    'recovered': e['recovered'],
                    'avg_exposure': st.mean(wseg) if wseg else 0.0,
                    'bench_over_period': sum(bseg) if bseg else 0.0})
    return out


# ============================================================== 9. ARBITRAGE
def arb_stress(spread_series, entry_z=2.0, max_hold=20, decouple_frac=0.1, seed=5):
    """Stress specific to convergence trades, where the risk is NOT volatility.

    A relative-value position does not lose because the spread moved. It loses
    because the spread STOPPED converging - the relationship that justified the
    trade broke - and because the position must be carried until it does. Three
    tests:

      HORIZON     what share of entries fail to converge within max_hold? A
                  convergence trade with no time limit is an unbounded loss
                  dressed up as a bounded one.
      DECOUPLING  force a fraction of episodes never to converge and re-measure.
                  This is the actual tail: not a big move, a permanent one.
      LEG RISK    the unconverged rate IS the leg-risk proxy here - those are the
                  episodes left carrying exposure the strategy never intended.
    """
    rng = random.Random(seed)
    if len(spread_series) < 100:
        return None
    m, sd = st.mean(spread_series), st.pstdev(spread_series)
    if sd <= 0:
        return None
    z = [(x - m) / sd for x in spread_series]
    entries, converged, horizons = 0, 0, []
    i = 0
    while i < len(z) - 1:
        if abs(z[i]) >= entry_z:
            entries += 1
            sign = 1 if z[i] > 0 else -1
            hit = None
            for k in range(1, min(max_hold, len(z) - i)):
                if sign * z[i + k] <= 0.5:
                    hit = k
                    break
            if hit:
                converged += 1
                horizons.append(hit)
                i += hit
            else:
                i += max_hold
        else:
            i += 1
    if not entries:
        return None
    forced = sum(1 for _ in range(entries) if rng.random() < decouple_frac)
    return {'entries': entries, 'converged': converged,
            'convergence_rate': converged / entries,
            'median_hold': st.median(horizons) if horizons else None,
            'p90_hold': sorted(horizons)[int(len(horizons) * 0.9)] if horizons else None,
            'unconverged_rate': 1 - converged / entries,
            'rate_after_forced_decoupling': max(0.0, (converged - forced) / entries),
            'note': 'unconverged episodes carry loss until stopped, not until reverted'}


# ================================================================= 10. REPORT
def full_report(name, weight_fn, market, grid=None, build_fn=None, quick=False):
    """Everything above, in one block, with the readings spelled out."""
    rets = market['ret']
    w, rr = _align(weight_fn(market), rets)
    base = eng.run(w, rr, market['rt'])
    L = []
    P = L.append
    P('=' * 100)
    P('STRESS TEST: {}   ({} obs, {:.1f} years, cost {:.2f}bp round trip)'.format(
        name, len(rr), len(rr) / 252.0, market['rt'] * 1e4))
    P('=' * 100)
    s = _stats(base, rr)
    a = inst.attribution(base, rr)
    P('  BASELINE   CAGR {:+.2%}   Sharpe {:.2f}   maxDD {:.1%}   alpha {:+.2%}/yr t={:.2f}'
      .format(s['cagr'], s['sharpe'], s['mdd'],
              a['alpha_ann'] if a else 0.0, a['t_alpha'] if a else 0.0))
    P('')

    P('  1. EXECUTION  - cost multiples x acting k days late')
    P('     {:>7}{:>10}{:>10}{:>10}{:>10}'.format('delay', 'cost x1', 'x2', 'x4', 'x8'))
    ex = execution_stress(weight_fn, market, multiples=(1, 2, 4, 8), delays=(0, 1, 2, 3))
    for d in (0, 1, 2, 3):
        row = {r['mult']: r for r in ex if r['delay'] == d}
        P('     {:>7}{:>10}{:>10}{:>10}{:>10}'.format(
            '{}d'.format(d),
            *['{:+.2%}'.format(row[m]['cagr']) if m in row else '-' for m in (1, 2, 4, 8)]))
    be = breakeven_cost_multiple(weight_fn, market)
    P('     break-even cost multiple: {}'.format(
        'never (>40x)' if be == float('inf') else '{:.1f}x'.format(be)))
    d0 = next((r for r in ex if r['delay'] == 0 and r['mult'] == 1), None)
    d1 = next((r for r in ex if r['delay'] == 1 and r['mult'] == 1), None)
    if d0 and d1 and d0['cagr']:
        keep = d1['cagr'] / d0['cagr']
        P('     one-day delay retains {:.0%} of CAGR   {}'.format(
            keep, '<- MICROSTRUCTURE-DEPENDENT' if keep < 0.5 else '<- robust to timing'))
    P('')

    P('  2. LIQUIDITY  - vol-scaled impact and size caps')
    for r in liquidity_stress(weight_fn, market):
        extra = '   mean cost {:.2f}bp'.format(r['mean_cost_bp']) if 'mean_cost_bp' in r else ''
        P('     {:<26} CAGR {:+.2%}   Sharpe {:.2f}   maxDD {:.1%}{}'.format(
            r['label'], r['cagr'], r['sharpe'], r['mdd'], extra))
    P('')

    P('  3. REGIME  - performance by MARKET state (classified trailing-only)')
    P('     {:<16}{:>7}{:>12}{:>12}{:>11}{:>9}'.format(
        'regime', 'n', 'strat/yr', 'bench/yr', 'exposure', 'Sharpe'))
    for r in regime_stress(weight_fn, market):
        P('     {:<16}{:>7}{:>12}{:>12}{:>11}{:>9}'.format(
            r['regime'], r['n'], '{:+.1%}'.format(r['strat_ann']),
            '{:+.1%}'.format(r['bench_ann']), '{:.0%}'.format(r['exposure']),
            '{:.2f}'.format(r['sharpe'])))
    P('     worst contiguous windows:')
    for ww in worst_windows(base):
        P('        {:>4}d  {:+.1%}'.format(ww['days'], ww['worst_return']))
    P('')

    if grid and build_fn:
        P('  4. PARAMETER  - plateau or cliff?')
        ps = parameter_stress(build_fn, market, grid)
        if ps:
            P('     {} cells   {:.0%} positive   CAGR median {:+.2%}  (min {:+.2%}, max {:+.2%})'
              .format(ps['cells'], ps['positive_share'], ps['cagr_median'],
                      ps['cagr_min'], ps['cagr_max']))
            P('     Sharpe median {:.2f}, best {:.2f}, best-minus-median {:.2f}   {}'.format(
                ps['sharpe_median'], ps['sharpe_max'], ps['best_minus_median_sharpe'],
                '<- SPIKE, suspect' if ps['best_minus_median_sharpe'] > 0.5 else '<- plateau'))
        P('')

    P('  5. STRUCTURAL BREAK  - did the edge change? (null by stationary bootstrap)')
    sb = structural_break(base, rr, draws=150 if quick else 400)
    if sb:
        mb = sb['mean_break']
        P('     mean break    supF {:>7.1f}   p = {:.3f}   {}'.format(
            mb['supF'], mb['p_value'],
            '<- BREAK' if mb['p_value'] < 0.05 else '<- stable'))
        if 'alpha_break' in sb:
            ab = sb['alpha_break']
            P('     alpha break   supF {:>7.1f}   p = {:.3f}   {}'.format(
                ab['supF'], ab['p_value'],
                '<- ALPHA BREAK' if ab['p_value'] < 0.05 else '<- alpha stable'))
        h = sb['halves']
        P('     first half {:+.2%} (Sh {:.2f})  ->  second half {:+.2%} (Sh {:.2f})'.format(
            h['first_cagr'], h['first_sharpe'], h['second_cagr'], h['second_sharpe']))
    P('')

    P('  6. TAIL  - the drawdown DISTRIBUTION, not the one that happened')
    t = tail_stress(base, draws=500 if quick else 2000)
    P('     VaR95 {:.2%}  ES95 {:.2%}    VaR99 {:.2%}  ES99 {:.2%}    tail index {}'.format(
        t['var95'], t['es95'] or 0.0, t['var99'], t['es99'] or 0.0,
        '{:.2f}'.format(t['tail_index']) if t['tail_index'] else 'n/a'))
    P('     maxDD realised {:.1%}  |  bootstrap median {:.1%}   p95 {:.1%}   p99 {:.1%}   worst {:.1%}'
      .format(t['realised_mdd'], t['mdd_median'], t['mdd_p95'], t['mdd_p99'], t['mdd_worst']))
    if t['realised_mdd'] > t['mdd_p95']:
        P('     the realised drawdown is MILDER than the 95th-percentile path - plan for worse')
    P('')

    P('  7. PATH  - resample the market, re-run the rule (read the block length)')
    P('     {:>11}{:>10}{:>11}{:>10}{:>12}{:>13}'.format(
        'mean block', 'Sh p05', 'Sh median', 'Sh p95', 'share Sh>0', 'real pctile'))
    for r in path_stress(weight_fn, market, draws=60 if quick else 200):
        P('     {:>11}{:>10}{:>11}{:>10}{:>12}{:>13}'.format(
            '{}d'.format(r['mean_block']), '{:.2f}'.format(r['sharpe_p05']),
            '{:.2f}'.format(r['sharpe_median']), '{:.2f}'.format(r['sharpe_p95']),
            '{:.0%}'.format(r['share_beating_zero']),
            '{:.0%}'.format(r['realised_pctile'])))
    P('')

    P('  8. FAILURE  - the worst episodes, and whether it was exposed')
    P('     {:<26}{:>9}{:>8}{:>11}{:>12}'.format(
        'period', 'depth', 'days', 'exposure', 'recovered'))
    for f in failure_analysis(weight_fn, market):
        P('     {:<26}{:>9}{:>8}{:>11}{:>12}'.format(
            '{} -> {}'.format(str(f['from'])[:10], str(f['to'])[:10]),
            '{:.1%}'.format(f['depth']), f['days'],
            '{:.0%}'.format(f['avg_exposure']), 'yes' if f['recovered'] else 'NO'))
    P('=' * 100)
    return '\n'.join(L)
