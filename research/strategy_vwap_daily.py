"""
DAILY VWAP: rolling volume-weighted average price as a proxy for aggregate cost
basis.

WHY THIS IS A DIFFERENT IDEA FROM THE ONE ALREADY REJECTED. The intraday setup
tested earlier used SESSION-anchored VWAP - a statistic that resets every morning
and describes only today's trading. It failed, and the taxonomy explained why:
reversion needs a counterparty under obligation, and nobody is obliged to trade
back toward a number that resets at 9:30.

A ROLLING MULTI-DAY VWAP is a different object. Volume-weighted over 50 or 100
days, it approximates the average price at which the CURRENT holders actually
bought - the aggregate cost basis of the float. That is not a statistic about
prices; it is an estimate of where real people are break-even, and it has a
documented behavioural mechanism attached.

THE MECHANISM: THE DISPOSITION EFFECT. Investors are systematically reluctant to
realise losses and too eager to realise small gains (Shefrin & Statman 1985;
Odean 1998). The consequence for prices is capital gains overhang: when a stock
is above the aggregate cost basis, holders sitting on gains sell too readily,
supplying stock and DAMPING the advance - so good news is underreacted to and the
move continues afterwards. When it is below, holders refuse to sell at a loss,
supply dries up, and bad news is likewise underreacted to.

Grinblatt & Han (2005, Journal of Financial Economics) formalise exactly this and
show that a reference price built from volume-weighted past prices predicts
returns - and that this underreaction is a substantial part of what is otherwise
labelled momentum. So the directional prediction is MOMENTUM, not reversion:
price above its volume-weighted cost basis should keep going.

That prediction is stated before the test, and it is falsifiable: if the profitable
direction turns out to be reversion, the mechanism is wrong and the result is a
curve fit that happens to point the other way.

THE TEST THAT ACTUALLY MATTERS - and it is not whether the strategy makes money.
A long/flat rule on a rising index makes money whether or not the signal works. The
question is whether VOLUME-WEIGHTING ADDS ANYTHING over a plain simple moving
average of the same length. If VWAP(100) and SMA(100) give the same answer, then
volume is decorative, the cost-basis story is untested, and this is just the trend
strategy already validated. Section 3 puts them head to head on identical windows
and reports the correlation of their signals and the difference in their alpha.
"""
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng

CORE = ['VFV.TO', 'XIU.TO', 'ZQQ.TO', 'XIC.TO']
WINDOWS = (20, 50, 100, 200)


def rolling_vwap(bars, n):
    """Volume-weighted average of the typical price over the trailing n bars.

    Element i uses bars i-n+1 .. i inclusive, so it is known at the close of bar i
    and is applied to bar i+1's return by the caller. Typical price (h+l+c)/3 is
    used rather than the close because it better represents where the day's volume
    actually transacted, which is the whole point of the construct.
    """
    out, pv, vv = [], 0.0, 0.0
    q = []
    for i, b in enumerate(bars):
        tp = (b['h'] + b['l'] + b['c']) / 3.0
        v = max(b['v'], 1.0)
        q.append((tp * v, v))
        pv += tp * v
        vv += v
        if len(q) > n:
            opv, ovv = q.pop(0)
            pv -= opv
            vv -= ovv
        out.append(pv / vv if len(q) == n and vv > 0 else None)
    return out


def vwap_weights(bars, n, direction='momentum', band=0.0):
    """Long/flat from price vs the rolling VWAP.

    `band` is a deadband in percent, applied to reduce whipsaw around the line -
    it is a real parameter and is counted in the trial total, not slipped in.
    """
    vw = rolling_vwap(bars, n)
    w = []
    for i in range(len(bars) - 1):
        v, c = vw[i], bars[i]['c']
        if v is None or v <= 0:
            w.append(0.0)
            continue
        dev = (c - v) / v
        if direction == 'momentum':
            w.append(1.0 if dev > band else 0.0)
        else:
            w.append(1.0 if dev < -band else 0.0)
    return w


def sma_weights(bars, n, band=0.0):
    """The control: identical rule, simple average instead of volume-weighted."""
    closes = [b['c'] for b in bars]
    ma = eng.sma(closes, n)
    w = []
    for i in range(len(bars) - 1):
        m, c = ma[i], closes[i]
        if m is None or m <= 0:
            w.append(0.0)
            continue
        w.append(1.0 if (c - m) / m > band else 0.0)
    return w


TRIALS = len(WINDOWS) * 2 * 2      # windows x direction x band settings

print('=' * 116)
print('DAILY VWAP - rolling volume-weighted cost basis, long/flat')
print('  Predicted direction: MOMENTUM (Grinblatt & Han capital-gains overhang).')
print('  Trials in the grid: {}'.format(TRIALS))
print('=' * 116)

# ------------------------------------------------------------------ 1. direction
print('\n1. IS THE PROFITABLE DIRECTION THE PREDICTED ONE?')
print('   If reversion beats momentum, the stated mechanism is wrong.')
for sym in CORE:
    bars = tsx_data.get(sym)
    ret = eng.total_returns(bars)
    rt = tsx_data.cost_model(sym, bars)[0]
    print('\n  {}   buy & hold {:+.2%} CAGR, Sharpe {:.2f}, maxDD {:.1%}'.format(
        sym, inst.cagr(ret), inst.sharpe(ret), inst.max_drawdown(ret)))
    print('  {:<22}{:>10}{:>9}{:>9}{:>9}{:>10}{:>9}{:>9}'.format(
        'config', 'CAGR', 'Sharpe', 'maxDD', 'expo', 'trades/yr', 'alpha t', 'DSR'))
    for d in ('momentum', 'reversion'):
        for n in WINDOWS:
            w = vwap_weights(bars, n, d)
            r = eng.run(w, ret, rt)
            a = inst.attribution(r, ret)
            dsr, _, _ = inst.deflated_sharpe(r, TRIALS)
            print('  {:<22}{:>10}{:>9}{:>9}{:>9}{:>10}{:>9}{:>9}'.format(
                'VWAP{} {}'.format(n, d[:3]), '{:+.2%}'.format(inst.cagr(r)),
                '{:.2f}'.format(inst.sharpe(r)), '{:.1%}'.format(inst.max_drawdown(r)),
                '{:.0%}'.format(st.mean(w)), '{:.1f}'.format(eng.turnover_per_year(w) / 2),
                '{:.2f}'.format(a['t_alpha']) if a else '-', '{:.3f}'.format(dsr)))

# ------------------------------------------------------------------ 2. PBO
print('\n' + '=' * 116)
print('2. PROBABILITY OF BACKTEST OVERFITTING across the momentum grid')
print('=' * 116)
for sym in CORE:
    bars = tsx_data.get(sym)
    ret = eng.total_returns(bars)
    rt = tsx_data.cost_model(sym, bars)[0]
    cfgs = {}
    for n in WINDOWS:
        for band in (0.0, 0.01):
            cfgs['{}_{}'.format(n, band)] = eng.run(
                vwap_weights(bars, n, 'momentum', band), ret, rt)
    p = inst.pbo(cfgs)
    print('  {:10} PBO {:>8}  across {} configs'.format(
        sym, '{:.1%}'.format(p) if p is not None else 'n/a', len(cfgs)))

# ------------------------------------------------------------------ 3. THE test
print('\n' + '=' * 116)
print('3. THE DECIDING TEST: DOES VOLUME-WEIGHTING ADD ANYTHING OVER A PLAIN SMA?')
print('   Same window, same rule, only the weighting differs. If the signals agree')
print('   and the alphas match, volume is decoration and this is the trend strategy')
print('   already validated, wearing a different name.')
print('=' * 116)
print('  {:10}{:>7}{:>12}{:>12}{:>12}{:>12}{:>14}'.format(
    'symbol', 'window', 'VWAP alpha', 'SMA alpha', 'VWAP t', 'SMA t', 'signal agree'))
print('  ' + '-' * 82)
for sym in CORE:
    bars = tsx_data.get(sym)
    ret = eng.total_returns(bars)
    rt = tsx_data.cost_model(sym, bars)[0]
    for n in WINDOWS:
        wv = vwap_weights(bars, n, 'momentum')
        ws = sma_weights(bars, n)
        rv = eng.run(wv, ret, rt)
        rs = eng.run(ws, ret, rt)
        av, asm = inst.attribution(rv, ret), inst.attribution(rs, ret)
        agree = sum(1 for i in range(len(wv)) if wv[i] == ws[i]) / len(wv)
        print('  {:10}{:>7}{:>12}{:>12}{:>12}{:>12}{:>14}'.format(
            sym if n == WINDOWS[0] else '', n,
            '{:+.2%}'.format(av['alpha_ann']) if av else '-',
            '{:+.2%}'.format(asm['alpha_ann']) if asm else '-',
            '{:.2f}'.format(av['t_alpha']) if av else '-',
            '{:.2f}'.format(asm['t_alpha']) if asm else '-',
            '{:.1%}'.format(agree)))
print("""
  'signal agree' is the fraction of days the two rules held the same position.
  Above ~90% they are the same strategy and any difference in their returns is
  noise, not information from volume. The honest bar for keeping VWAP over SMA is
  a materially higher alpha t-statistic, not a prettier CAGR.""")
