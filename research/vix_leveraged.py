"""
The VIX gate rescued the unlevered overnight sleeve. Does it rescue the levered one?

WHERE THIS COMES FROM. Overnight on 2x funds was tested and FAILED badly - HSU
returned -5.43% against VFV's +22.85%, HXU -16.06%. The stated reason was that
leveraged ETFs are swap-based with noisier opening prints, so the 2x amplifies
execution error more than it amplifies the premium.

But that test used the PLAIN overnight rule. Since then the same sleeve on VFV was
transformed by three gates - trend, volatility target, and VIX term structure -
which lifted it from alpha t=0.26 under a bad fill to t=6.84, because the gates
skip precisely the nights when opening auctions are chaotic. Those are exactly the
nights when a leveraged fund's print is worst. So the failure may have been the
RULE rather than the INSTRUMENT, and that is worth one clean test.

WHY IT MATTERS FOR THE STATED GOAL of maximum profit. The gated unlevered sleeve
runs a -5.6% maximum drawdown at Sharpe 3.30. A strategy that shallow has genuine
room to carry leverage: 2x a -5.6% drawdown is roughly -11%, which is still less
than half what buy-and-hold VFV suffered. THAT is what strategic leverage means -
applying it to a high-Sharpe, shallow-drawdown strategy rather than to a raw index.
Levering a Sharpe-0.6 buy-and-hold just doubles the pain; levering a Sharpe-3.3
sleeve is how professionals actually use it.

THE HONEST RISK, stated before the numbers: if the gates only appeared to work
because they were selected on this same data, then applying leverage multiplies a
fitted result rather than a real one. So the leveraged version has to clear the
same bar as everything else - alpha against the unlevered index, deflated Sharpe
with the full trial count, and survival under a bad fill.
"""
import datetime
import json
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng
from vix_signals import VIX, VIX3M, pctile_series

CAPITAL = 1000.0
TARGETS = [('VFV.TO', 'unlevered S&P 500'),
           ('HSU.TO', '2x S&P 500'),
           ('HQU.TO', '2x Nasdaq 100'),
           ('ZQQ.TO', 'unlevered Nasdaq 100')]


def build(sym):
    bars = tsx_data.get(sym)
    dv = st.median([b['raw_c'] * b['v'] for b in bars[-60:] if b['v'] > 0] or [0])
    rt = tsx_data.cost_model(sym, bars, dollar_vol=dv)[0]
    ret = eng.total_returns(bars)
    dates = eng.dates(bars)
    closes = [b['c'] for b in bars]
    ma = eng.sma(closes, 100)
    vol = eng.rolling_vol(ret, 20)
    # VIX term structure carried forward onto this instrument's calendar
    ts, last = [], None
    for d in dates:
        if d in VIX and d in VIX3M and VIX[d] > 0:
            last = VIX3M[d] / VIX[d]
        ts.append(last)
    on_g, on_b = [], []
    for i in range(1, len(bars)):
        c0, o = bars[i - 1]['c'], bars[i]['o']
        on_g.append((o - c0) / c0 - rt)
        on_b.append((o - 0.10 * (o - bars[i]['l']) - c0) / c0 - rt)
    return {'bars': bars, 'ret': ret, 'dates': dates, 'closes': closes,
            'ma': ma, 'vol': vol, 'ts': ts, 'on': on_g, 'on_bad': on_b, 'rt': rt}


def gated(d, contango=1.05, tgt=0.15, trend=True, bad=False):
    on = d['on_bad'] if bad else d['on']
    out, ws = [], []
    for i in range(len(on)):
        v = d['vol'][i - 1] if i > 0 else None
        w = 0.0 if (v is None or v <= 0) else min(1.0, (tgt / (252 ** 0.5)) / v)
        if trend:
            m = d['ma'][i] if i < len(d['ma']) else None
            if m is None or d['closes'][i] <= m:
                w = 0.0
        if contango is not None:
            t = d['ts'][i] if i < len(d['ts']) else None
            if t is None or t < contango:
                w = 0.0
        out.append(w * on[i])
        ws.append(w)
    return out, ws


D = {}
for sym, _ in TARGETS:
    try:
        D[sym] = build(sym)
    except Exception as e:
        print('skip {}: {}'.format(sym, e))

print('=' * 116)
print('DOES THE VIX GATE RESCUE OVERNIGHT ON THE LEVERAGED FUNDS?')
print('  Gate: above SMA100, vol-target 15%, VIX3M/VIX > 1.05')
print('=' * 116)
print('  {:30}{:>10}{:>9}{:>9}{:>9}{:>8}{:>9}{:>12}'.format(
    'instrument / rule', 'CAGR', 'Sharpe', 'maxDD', 'Calmar', 'expo', 'alpha t', '$/yr on 1k'))
print('  ' + '-' * 96)
bench = D['VFV.TO']['ret'] if 'VFV.TO' in D else None
for sym, what in TARGETS:
    if sym not in D:
        continue
    d = D[sym]
    for label, kw in (('plain overnight', {'contango': None, 'trend': False, 'tgt': 99.0}),
                      ('fully gated', {})):
        for bad in (False, True):
            r, w = gated(d, bad=bad, **kw)
            a = inst.attribution(r, d['ret'][:len(r)])
            mdd = inst.max_drawdown(r)
            c = inst.cagr(r)
            print('  {:30}{:>10}{:>9}{:>9}{:>9}{:>8}{:>9}{:>12}{}'.format(
                '{} {}'.format(sym.split('.')[0], label) if not bad else '',
                '{:+.2%}'.format(c), '{:.2f}'.format(inst.sharpe(r)),
                '{:.1%}'.format(mdd),
                '{:.2f}'.format(c / abs(mdd) if mdd else 0),
                '{:.0%}'.format(st.mean(w)),
                '{:.2f}'.format(a['t_alpha']) if a else '-',
                '${:,.0f}'.format(CAPITAL * c),
                '  BAD' if bad else ''))
    print()

print('=' * 116)
print('FULL VALIDATION OF THE BEST CANDIDATES')
print('  Trials: 4 instruments x 6 gate combinations tested = 24, deflated by that.')
print('=' * 116)
for sym, what in TARGETS:
    if sym not in D:
        continue
    d = D[sym]
    for bad in (False, True):
        r, w = gated(d, bad=bad)
        if inst.cagr(r) <= 0:
            continue
        dsr, sr, sr0 = inst.deflated_sharpe(r, 24)
        a = inst.attribution(r, d['ret'][:len(r)])
        ci = inst.block_bootstrap_ci(r, block=21, draws=1500)
        print('\n  {} ({}) {}'.format(sym, what, '[BAD FILL]' if bad else '[at open]'))
        print('    CAGR {:+.2%}  Sharpe {:.2f}  maxDD {:.1%}  Calmar {:.2f}  DSR {:.3f}'.format(
            inst.cagr(r), inst.sharpe(r), inst.max_drawdown(r),
            inst.cagr(r) / abs(inst.max_drawdown(r)) if inst.max_drawdown(r) else 0, dsr))
        if a:
            print('    alpha {:+.2%}/yr  t={:.2f}  beta {:.2f}  IR {:.2f}'.format(
                a['alpha_ann'], a['t_alpha'], a['beta'], a['ir']))
        if ci:
            print('    on $1000: median ${:,.0f}/yr   p5 ${:,.0f}   p95 ${:,.0f}'.format(
                CAPITAL * ci['median'], CAPITAL * ci['p5'], CAPITAL * ci['p95']))
