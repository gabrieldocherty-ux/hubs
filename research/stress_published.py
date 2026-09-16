"""
Run the stress framework against the strategies this project actually published.

WHY THE WEIGHT FUNCTIONS ARE REDEFINED HERE. research/strategy_volmanaged.py and
research/strategy_trend_tom.py do their work at module scope - importing either
one re-runs the entire study. The rules are therefore restated below, and because
a restated rule can silently drift from the original, the first thing this script
does is CHECK the baseline against the published numbers and refuse to continue if
they disagree. A stress test of the wrong strategy is worse than no stress test.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import institutional as inst
import stress
import tsx_data
import tsx_engine as eng


def load(sym):
    bars = tsx_data.get(sym)
    return {'sym': sym, 'bars': bars, 'ret': eng.total_returns(bars),
            'dates': eng.dates(bars), 'rt': tsx_data.cost_model(sym, bars)[0]}


# ---- the published rules, restated (see module docstring) -------------------
def volmanaged(market, lookback=20, target_vol=0.10, cap=1.0):
    rets = market['ret']
    vol = eng.rolling_vol(rets, lookback)
    w = []
    for i in range(len(rets)):
        v = vol[i - 1] if i > 0 else None
        w.append(0.0 if not v or v <= 0
                 else min(cap, (target_vol / math.sqrt(252)) / v))
    return w


def trend(market, n=200, confirm=1):
    bars = market['bars']
    closes = [b['c'] for b in bars]
    ma = eng.sma(closes, n)
    raw = [0.0 if ma[i] is None else (1.0 if closes[i] > ma[i] else 0.0)
           for i in range(len(bars))]
    if confirm > 1:
        raw = [1.0 if i + 1 >= confirm and all(x == 1.0 for x in raw[i - confirm + 1:i + 1])
               else 0.0 for i in range(len(raw))]
    return raw[:len(bars) - 1]


def check(label, got, want, tol):
    ok = abs(got - want) <= tol
    print('    {:<34} got {:>9.4f}   published {:>9.4f}   {}'.format(
        label, got, want, 'OK' if ok else '*** MISMATCH ***'))
    return ok


if __name__ == '__main__':
    quick = '--quick' in sys.argv

    print('=' * 100)
    print('VERIFYING the restated rules reproduce the published results')
    print('=' * 100)

    vfv = load('VFV.TO')
    w, r = stress._align(volmanaged(vfv), vfv['ret'])
    base = eng.run(w, r, vfv['rt'])
    a = inst.attribution(base, r)
    print('  vol-managed VFV.TO (lookback 20, target vol 10%)')
    ok = all([
        check('CAGR', inst.cagr(base), 0.1405, 0.004),
        check('Sharpe', inst.sharpe(base), 1.33, 0.05),
        check('max drawdown', inst.max_drawdown(base), -0.130, 0.01),
        check('alpha t-stat', a['t_alpha'], 2.78, 0.15),
    ])

    xiu = load('XIU.TO')
    grid = [(n, c) for n in (50, 100, 150, 200, 250) for c in (1, 3)]
    best, best_sh = None, -9e9
    for n, c in grid:
        ww, rr = stress._align(trend(xiu, n, c), xiu['ret'])
        sh = inst.sharpe(eng.run(ww, rr, xiu['rt']))
        if sh > best_sh:
            best, best_sh = (n, c), sh
    ww, rr = stress._align(trend(xiu, *best), xiu['ret'])
    tbase = eng.run(ww, rr, xiu['rt'])
    ta = inst.attribution(tbase, rr)
    print('  trend XIU.TO (best cell of the published grid: SMA{} x{})'.format(*best))
    ok = check('alpha t-stat', ta['t_alpha'], 3.22, 0.20) and ok

    if not ok:
        print('\n  The restated rules do NOT reproduce the published numbers.')
        print('  Stopping: stressing a different strategy would be misleading.')
        sys.exit(1)
    print('\n  Baselines reproduce. Proceeding to stress.\n')

    print(stress.full_report(
        'vol-managed VFV.TO  (lookback 20, target 10%)',
        volmanaged, vfv, quick=quick,
        grid=[(lb, tv) for lb in (20, 40, 60) for tv in (0.10, 0.12, 0.15, 0.20)],
        build_fn=lambda m, k: volmanaged(m, k[0], k[1])))
    print()
    print(stress.full_report(
        'trend XIU.TO  (SMA{} x{})'.format(*best),
        lambda m: trend(m, *best), xiu, quick=quick,
        grid=grid, build_fn=lambda m, k: trend(m, k[0], k[1])))
