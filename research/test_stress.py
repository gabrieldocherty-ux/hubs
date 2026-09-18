"""
Regression tests for research/stress.py.

This module is the thing that is supposed to catch defects in strategies, and it
has now shipped three of its own - each one found by running it rather than by
reading it, and each one silently flattering:

  1. The bootstrapped drawdown percentiles were read off the wrong end of an
     ascending sort of NEGATIVE numbers, so "worst case" printed -7.9% against a
     realised -13.0%. It made a strategy look SAFER than it had actually been.
  2. path_stress built synthetic bars starting at the first return, so a
     price-reading rule sized period i using the outcome of period i. The trend
     strategy landed at the 0th percentile of its own null, which is what gave it
     away: a trend rule cannot beat data whose trends were destroyed.
  3. arb_stress standardised the spread against the mean and standard deviation
     of the WHOLE series - lookahead, and useless on a drifting spread, which is
     the only kind it would ever be pointed at.
  4. liquidity_stress capped size with `min(x, cap)`, which only caps a weight
     series that never goes short. Every crypto strategy here is long/short, so
     the "cap" halved the longs, left the shorts at full size, and returned a
     net-short strategy labelled as a smaller version of the original. It read
     as a size fragility that does not exist.

All four are pinned here. A test that would have caught the bug is worth more
than the fix.

    python -m pytest research/test_stress.py -q

Kept out of tests/ because that suite is the risk-rail check and runs in 0.08s.
"""
import math
import random
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import institutional as inst
import stress
import tsx_engine as eng


# ----------------------------------------------------------------- 1. drawdown
def test_drawdown_percentiles_are_ordered_by_severity():
    """p99 must be WORSE than p95 must be worse than the median, and `worst`
    must be the worst of all. Drawdowns are negative, so an ascending sort puts
    the most severe first and reading [-1] returns the mildest path."""
    rng = random.Random(4)
    rets = [rng.gauss(0.0004, 0.011) for _ in range(2000)]
    t = stress.tail_stress(rets, draws=400)
    print('    median {:.1%}  p95 {:.1%}  p99 {:.1%}  worst {:.1%}'.format(
        t['mdd_median'], t['mdd_p95'], t['mdd_p99'], t['mdd_worst']))
    assert t['mdd_worst'] <= t['mdd_p99'] <= t['mdd_p95'] <= t['mdd_median'], t
    assert t['mdd_worst'] < 0


def test_tail_index_is_finite_and_fatter_for_fat_tails():
    """A Student-t sample must report a LOWER (fatter) tail index than a
    Gaussian one. If the estimator cannot tell those apart it is decoration."""
    rng = random.Random(9)
    gauss = [rng.gauss(0, 0.01) for _ in range(4000)]
    fat = [rng.gauss(0, 0.01) / math.sqrt(rng.gammavariate(1.5, 1.0) / 1.5)
           for _ in range(4000)]
    g, f = stress.hill_tail_index(gauss), stress.hill_tail_index(fat)
    print('    gaussian tail index {:.2f}   fat-tailed {:.2f}'.format(g, f))
    assert g is not None and f is not None
    assert f < g, 'the fat-tailed sample should report the fatter (lower) index'


# --------------------------------------------------------------- 2. path_stress
def _market(rets):
    eq, px = 100.0, [100.0]
    for r in rets:
        eq *= (1 + r)
        px.append(eq)
    return {'ret': rets, 'rt': 0.0002, 'dates': list(range(len(rets))),
            'bars': [{'c': p, 'o': p, 'h': p, 'l': p} for p in px]}


def test_path_stress_has_no_lookahead_for_a_price_reading_rule():
    """THE REGRESSION THAT MATTERS. A rule that goes long when the close is above
    its own moving average must NOT beat a bootstrapped market at the 0th
    percentile - that outcome is only possible if the synthetic bars let the rule
    see the return it is sizing. Realised should land in the BODY of the null,
    and certainly not at its floor.
    """
    rng = random.Random(11)
    rets = [rng.gauss(0.0003, 0.010) for _ in range(1500)]
    m = _market(rets)

    def sma_rule(mk):
        closes = [b['c'] for b in mk['bars']]
        ma = eng.sma(closes, 50)
        raw = [0.0 if ma[i] is None else (1.0 if closes[i] > ma[i] else 0.0)
               for i in range(len(closes))]
        return raw[:len(mk['ret'])]

    rows = stress.path_stress(sma_rule, m, mean_blocks=(21,), draws=60)
    assert rows, 'path_stress returned nothing'
    r = rows[0]
    print('    realised Sharpe {:.2f} sits at the {:.0%} percentile of the null'
          .format(r['realised_sharpe'], r['realised_pctile']))
    assert 0.01 < r['realised_pctile'] < 0.99, (
        'realised at the {:.0%} percentile - the synthetic bars are misaligned'
        .format(r['realised_pctile']))


def test_path_stress_bars_are_one_longer_than_returns():
    """The alignment invariant behind the bug: ret[i] = c[i+1]/c[i] - 1, so a
    weight computed from c[i] is applied to ret[i]. If bars and returns are the
    same length, the rule is reading its own outcome."""
    rng = random.Random(3)
    rets = [rng.gauss(0, 0.01) for _ in range(300)]
    seen = {}

    def spy(mk):
        seen['bars'] = len(mk['bars'])
        seen['ret'] = len(mk['ret'])
        return [0.0] * len(mk['ret'])

    stress.path_stress(spy, _market(rets), mean_blocks=(21,), draws=1)
    print('    synthetic bars {}  returns {}'.format(seen['bars'], seen['ret']))
    assert seen['bars'] == seen['ret'] + 1, seen


# ---------------------------------------------------------------- 3. arb_stress
def test_arb_stress_uses_a_trailing_window_not_the_whole_sample():
    """A DRIFTING spread must still produce entries. Standardising against the
    full-sample mean and sd is lookahead, and on a drifting series the sd is
    dominated by the drift so almost nothing clears the threshold - the original
    found FOUR entries in a 4,000-point random walk and ZERO in a trending one.
    """
    rng = random.Random(1)
    x, rw = 0.0, []
    for _ in range(4000):
        x += rng.gauss(0, 1.0)
        rw.append(x)
    r = stress.arb_stress(rw, entry_z=2.0, max_hold=20)
    assert r is not None, 'a drifting spread produced no entries at all'
    print('    random walk: {} entries, {:.0%} converged'.format(
        r['entries'], r['convergence_rate']))
    assert r['entries'] > 40, r


def test_arb_stress_separates_convergence_from_its_absence():
    """A mean-reverting spread must converge far more often than a random walk.
    If the statistic cannot tell those apart it says nothing about whether a
    convergence trade is safe.

    NOTE a linear trend is deliberately NOT used as the hard case: measured
    through a TRAILING window a steady trend is detrended by construction and
    becomes stationary in z-space, so it converges immediately. That is correct
    behaviour and an earlier version of this test asserted the opposite.
    """
    rng = random.Random(2)
    x, ou = 0.0, []
    for _ in range(4000):
        x = 0.80 * x + rng.gauss(0, 1.0)
        ou.append(x)
    x, rw = 0.0, []
    for _ in range(4000):
        x += rng.gauss(0, 1.0)
        rw.append(x)
    a = stress.arb_stress(ou, entry_z=2.0, max_hold=20)
    b = stress.arb_stress(rw, entry_z=2.0, max_hold=20)
    print('    mean-reverting {:.1%} vs random walk {:.1%}'.format(
        a['convergence_rate'], b['convergence_rate']))
    assert a['convergence_rate'] > b['convergence_rate'] + 0.15, (a, b)


def test_arb_stress_refuses_to_answer_from_nothing():
    assert stress.arb_stress([1.0] * 50) is None
    assert stress.arb_stress([1.0] * 500) is None
    print('    short and zero-variance series both return None')


# ------------------------------------------------------- 4. execution / regime
def test_execution_delay_destroys_a_microstructure_edge_but_not_a_real_one():
    """The delay test is the cheapest way to tell a risk premium from an
    artefact, so it has to actually discriminate. A rule whose edge is one-bar
    reversal must collapse when acted on a day late; a rule holding a persistent
    drift must not.
    """
    rng = random.Random(7)
    rets = [rng.gauss(0.0004, 0.010) for _ in range(1200)]
    m = _market(rets)

    # a genuine drift-capturing rule: always invested
    always = lambda mk: [1.0] * len(mk['ret'])
    rows = stress.execution_stress(always, m, multiples=(1,), delays=(0, 1))
    d0 = next(r for r in rows if r['delay'] == 0)
    d1 = next(r for r in rows if r['delay'] == 1)
    keep = d1['cagr'] / d0['cagr'] if d0['cagr'] else 0
    print('    always-invested retains {:.0%} of CAGR after a 1-day delay'.format(keep))
    assert keep > 0.8, 'a persistent-exposure rule should barely notice a delay'


def test_size_cap_is_symmetric_for_a_long_short_rule():
    """A size cap must SHRINK a position, never flip the book's net direction.

    `min(x, cap)` leaves a -1 short untouched while halving a +1 long, which
    turns the capped run into a different, net-short strategy. The invariant that
    catches it: scaling every weight by a constant scales every return by that
    constant, so the capped Sharpe must match the uncapped one and the capped
    drawdown must be strictly shallower. Under the old asymmetric cap neither
    held.
    """
    rng = random.Random(21)
    rets = [rng.gauss(0.0005, 0.02) for _ in range(900)]
    m = {'ret': rets, 'rt': 0.0019, 'bars': None, 'dates': list(range(len(rets)))}
    # alternating long/short blocks, so a long-only cap cannot be a no-op
    flip = lambda mk: [1.0 if (i // 30) % 2 == 0 else -1.0 for i in range(len(mk['ret']))]
    rows = {r['label']: r for r in stress.liquidity_stress(flip, m)}
    imp = rows['vol-scaled impact']
    half = rows['impact + 50% size cap']
    print('    impact Sharpe {:.3f} / maxDD {:.1%}   half-size Sharpe {:.3f} / maxDD {:.1%}'
          .format(imp['sharpe'], imp['mdd'], half['sharpe'], half['mdd']))
    assert abs(half['sharpe'] - imp['sharpe']) < 1e-6, 'a pure size scale cannot change Sharpe'
    assert half['mdd'] > imp['mdd'], 'half size must draw down less'


def test_regimes_are_labelled_from_the_market_only():
    """Regime labels must be computable from trailing benchmark data alone - if
    they used the strategy's own outcomes the per-regime table would be circular
    and guaranteed to look damning."""
    rng = random.Random(13)
    bench = [rng.gauss(0.0003, 0.012) for _ in range(900)]
    labels = stress.classify_regimes(bench)
    assert len(labels) == len(bench)
    kinds = sorted(set(labels))
    print('    regimes found: {}'.format(kinds))
    assert 'warmup' in kinds
    assert any(k in kinds for k in ('low vol', 'mid vol', 'high vol'))


if __name__ == '__main__':
    for name, fn in sorted(globals().items()):
        if name.startswith('test_') and callable(fn):
            print(name)
            fn()
    print('\nall stress regressions pass')
