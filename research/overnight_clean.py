"""
Re-running the gated overnight strategy on instruments whose opening prints are
trustworthy, after the cross-instrument check found an artefact.

WHAT WENT WRONG. The headline strategy was built on VFV.TO and reported +20.51%
CAGR at Sharpe 3.30 with alpha t=11.55. A cross-source verification then found
that VFV's overnight return (+22.53%/yr) cannot be right:

    SPY     (US-listed, S&P 500)            overnight  +8.92%/yr
    XSP.TO  (TSX, S&P 500, CAD-HEDGED)      overnight +10.80%/yr
    ZSP.TO  (TSX, S&P 500, CAD-unhedged)    overnight +16.81%/yr
    VFV.TO  (TSX, S&P 500, CAD-unhedged)    overnight +22.53%/yr

VFV and ZSP hold the same index in the same currency on the same exchange and
differ by 5.7 percentage points a year. That is not a risk premium; two wrappers
around one index cannot pay differently. And it is not currency: USD/CAD's
overnight drift is +2.10%/yr and its correlation with VFV's overnight return is
-0.010, so the FX explanation fails outright. +9.57%/yr is left unexplained.

WHY THE EARLIER ARTEFACT TEST MISSED IT. An overnight/intraday reversal
correlation was run on VFV and came back -0.016, which looked clean, and XIC/XFN/
XRE were rejected on that basis at -0.20 to -0.26. But that test only detects
DAY-LEVEL mean reversion. A systematic bias in where the open prints - consistently
a few basis points high, reverting over the session - produces almost no day-level
correlation while still inflating the overnight leg enormously. The
cross-instrument comparison catches what the correlation test cannot, and it
should have been run first.

THE LESSON, which generalises past this project: internal consistency checks tell
you a series is well-formed. Only an INDEPENDENT measurement of the same
underlying thing tells you it is correct. Two funds on one index are exactly that
independent measurement, and they were available the whole time.

SO: rebuild the identical strategy on the clean instruments and report what is
actually there. SPY is the reference - a US-listed, enormously liquid fund whose
opening auction is a real, tradeable, exchange-published price. XSP.TO is the
tradeable-in-Canada version whose overnight figure agrees with SPY.
"""
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import market_data
import tsx_data
import tsx_engine as eng
from vix_signals import VIX, VIX3M

CAPITAL = 1000.0


def load(sym):
    if sym.endswith('.TO'):
        bars = tsx_data.get(sym)
        rt = tsx_data.cost_model(sym, bars)[0]
    else:
        import datetime
        b, _ = market_data.get_bars(sym, '1d', '25y')
        for x in b:
            x['d'] = datetime.datetime.fromtimestamp(
                x['t'] / 1000, datetime.timezone.utc).date().isoformat()
            x['raw_c'] = x['c']
        bars = b
        # US ETF: $0 commission at most brokers, ~1c spread on a ~$600 share,
        # doubled for safety, matching how every other cost here is modelled
        rt = 2 * 0.01 / bars[-1]['c']
    return bars, rt


def gated(sym, contango=1.05, tgt=0.15, trend_n=100, bad=False):
    bars, rt = load(sym)
    ret = eng.total_returns(bars)
    dates = eng.dates(bars)
    closes = [b['c'] for b in bars]
    ma = eng.sma(closes, trend_n)
    vol = eng.rolling_vol(ret, 20)
    ts, last = [], None
    for d in dates:
        if d in VIX and d in VIX3M and VIX[d] > 0:
            last = VIX3M[d] / VIX[d]
        ts.append(last)
    out, ws = [], []
    for i in range(1, len(bars)):
        k = i - 1
        c0, o = bars[i - 1]['c'], bars[i]['o']
        r = (o - c0) / c0 - rt
        if bad:
            r = (o - 0.10 * (o - bars[i]['l']) - c0) / c0 - rt
        v = vol[k - 1] if k > 0 else None
        w = 0.0 if (v is None or v <= 0) else min(1.0, (tgt / (252 ** 0.5)) / v)
        m = ma[k] if k < len(ma) else None
        if m is None or closes[k] <= m:
            w = 0.0
        t = ts[k] if k < len(ts) else None
        if t is None or t < contango:
            w = 0.0
        out.append(w * r)
        ws.append(w)
    return out, ws, ret, rt


print('=' * 112)
print('THE GATED OVERNIGHT STRATEGY, RE-RUN ON CLEAN INSTRUMENTS')
print('  Identical rules: above SMA100, vol-target 15%, VIX3M/VIX > 1.05.')
print('=' * 112)
print('  {:28}{:>8}{:>10}{:>9}{:>9}{:>9}{:>10}{:>12}'.format(
    'instrument', 'RT cost', 'CAGR', 'Sharpe', 'maxDD', 'expo', 'alpha t', '$/yr on 1k'))
print('  ' + '-' * 96)

RESULTS = {}
for sym, label in (('SPY', 'SPY (US, clean opens)'),
                   ('XSP.TO', 'XSP.TO (CAD-hedged)'),
                   ('VFV.TO', 'VFV.TO (suspect)'),
                   ('ZSP.TO', 'ZSP.TO (suspect)'),
                   ('XIU.TO', 'XIU.TO (Canadian stocks)')):
    for bad in (False, True):
        try:
            r, w, ret, rt = gated(sym, bad=bad)
        except Exception as e:
            print('  {:28} failed: {}'.format(label, e))
            break
        a = inst.attribution(r, ret[:len(r)])
        mdd = inst.max_drawdown(r)
        c = inst.cagr(r)
        if not bad:
            RESULTS[sym] = {'cagr': c, 'sharpe': inst.sharpe(r), 'r': r, 'ret': ret}
        print('  {:28}{:>8}{:>10}{:>9}{:>9}{:>9}{:>10}{:>12}{}'.format(
            label if not bad else '', '{:.1f}bp'.format(rt * 1e4) if not bad else '',
            '{:+.2%}'.format(c), '{:.2f}'.format(inst.sharpe(r)),
            '{:.1%}'.format(mdd), '{:.0%}'.format(st.mean(w)),
            '{:.2f}'.format(a['t_alpha']) if a else '-',
            '${:,.0f}'.format(CAPITAL * c), '   BAD FILL' if bad else ''))
    print()

print('=' * 112)
print('FULL VALIDATION OF THE CLEAN VERSIONS')
print('=' * 112)
for sym in ('SPY', 'XSP.TO'):
    if sym not in RESULTS:
        continue
    for bad in (False, True):
        r, w, ret, rt = gated(sym, bad=bad)
        dsr, sr, sr0 = inst.deflated_sharpe(r, 24)
        a = inst.attribution(r, ret[:len(r)])
        ci = inst.block_bootstrap_ci(r, block=21, draws=1500)
        print('\n  {} {}'.format(sym, '[BAD FILL]' if bad else '[at open]'))
        print('    CAGR {:+.2%}  Sharpe {:.2f}  maxDD {:.1%}  DSR {:.3f}'.format(
            inst.cagr(r), inst.sharpe(r), inst.max_drawdown(r), dsr))
        if a:
            print('    alpha {:+.2%}/yr  t={:.2f}  beta {:.2f}  IR {:.2f}'.format(
                a['alpha_ann'], a['t_alpha'], a['beta'], a['ir']))
        if ci:
            print('    on $1000: median ${:,.0f}/yr  p5 ${:,.0f}  p95 ${:,.0f}'.format(
                CAPITAL * ci['median'], CAPITAL * ci['p5'], CAPITAL * ci['p95']))

print("""
============================================================================================================
HOW TO READ THIS AGAINST THE OLD HEADLINE

  The withdrawn figure was VFV at +20.51% CAGR, Sharpe 3.30, alpha t=11.55. If the
  clean instruments come in far below that, the difference was the artefact and the
  old number should never be quoted again.

  Note what it means if SPY's clean result lands near the VFV BAD-FILL figure
  (+12.62%): the pessimistic fill assumption was not pessimism at all. It was
  accidentally correcting for a bad opening price, which is why it looked so
  punishing. The honest number was hiding in that column the whole time.

  One more constraint returns with SPY: it is US-LISTED, so a Wealthsimple CAD
  account pays 1.5% FX each way - 3% a round trip, which destroys any overnight
  strategy instantly. XSP.TO is the version that is actually tradeable here
  without that penalty, and it is the one to judge.""")
