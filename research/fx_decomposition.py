"""
Is the overnight "equity risk premium" actually an FX effect?

A SERIOUS PROBLEM, found by cross-checking data sources rather than by any
strategy test. VFV.TO and SPY hold the SAME INDEX and trade the SAME HOURS
(09:30-16:00 ET, TSX and NYSE respectively). Their overnight/intraday split should
therefore look similar. It does not, and not by a little:

    VFV.TO   overnight +22.53%/yr   intraday  -6.77%/yr
    SPY      overnight  +8.92%/yr   intraday  +2.28%/yr

A 13.6 percentage point annual gap in the overnight leg on the same underlying.
One of those numbers is not measuring what it claims to.

THE LIKELY EXPLANATION, and it is mechanical rather than mysterious. VFV is
CAD-denominated and UNHEDGED, so its value is the S&P 500 in USD multiplied by the
USD/CAD exchange rate:

    VFV return  =  S&P return  +  USDCAD return   (approximately, in logs)

Equities stop trading at 16:00 and resume at 09:30. FX NEVER STOPS. So VFV's
17.5-hour "overnight" window contains 17.5 hours of currency movement, while its
6.5-hour intraday window contains only 6.5 hours of it. If USD/CAD has any drift
at all, roughly 73% of that drift lands mechanically in the overnight bucket -
with no risk premium involved, and no counterparty being compensated for anything.

WHAT THIS WOULD MEAN FOR THE HEADLINE STRATEGY. The gated overnight sleeve on
VFV - Sharpe 3.30, alpha t=11.55 - would be harvesting a mixture of two things: a
genuine equity overnight premium, and a currency drift that happens to be
time-sliced into the window being traded. The second is not an edge the stated
mechanism predicts, and if it dominates, the mechanism story is wrong even where
the profit is real.

THE DECISIVE TEST is a hedged twin. XSP.TO is the SAME S&P 500 exposure, on the
same exchange, in the same currency, but CURRENCY-HEDGED. If the overnight effect
is FX, XSP should look like SPY. If it is equity risk premium, XSP should look
like VFV. There is no third possibility, which is what makes it decisive.
"""
import datetime
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import market_data
import tsx_data
import tsx_engine as eng


def by_date(bars, getter):
    out = {}
    for i in range(1, len(bars)):
        d = bars[i]['d'] if 'd' in bars[i] else datetime.datetime.fromtimestamp(
            bars[i]['t'] / 1000, datetime.timezone.utc).date().isoformat()
        out[d] = getter(bars, i)
    return out


ON = lambda b, i: (b[i]['o'] - b[i - 1]['c']) / b[i - 1]['c']
ID = lambda b, i: (b[i]['c'] - b[i]['o']) / b[i]['o']
TOT = lambda b, i: (b[i]['c'] - b[i - 1]['c']) / b[i - 1]['c']

print('=' * 104)
print('1. THE HEDGED TWIN TEST - the decisive one')
print('   VFV.TO  S&P 500, CAD, UNHEDGED   |   XSP.TO  S&P 500, CAD, HEDGED')
print('   Same index, same exchange, same hours. Only the currency exposure differs.')
print('=' * 104)

SERIES = {}
for sym in ('VFV.TO', 'XSP.TO', 'ZSP.TO', 'XIU.TO'):
    try:
        b = tsx_data.get(sym)
        SERIES[sym] = {'on': by_date(b, ON), 'id': by_date(b, ID), 'tot': by_date(b, TOT)}
    except Exception as e:
        print('  {} failed: {}'.format(sym, e))

for sym in ('SPY',):
    b, _ = market_data.get_bars(sym, '1d', '10y')
    for x in b:
        x['d'] = datetime.datetime.fromtimestamp(
            x['t'] / 1000, datetime.timezone.utc).date().isoformat()
    SERIES[sym] = {'on': by_date(b, ON), 'id': by_date(b, ID), 'tot': by_date(b, TOT)}

# USD/CAD, so the currency leg can be measured directly rather than inferred
try:
    fx, _ = market_data.get_bars('CAD=X', '1d', '10y')
    for x in fx:
        x['d'] = datetime.datetime.fromtimestamp(
            x['t'] / 1000, datetime.timezone.utc).date().isoformat()
    SERIES['USDCAD'] = {'on': by_date(fx, ON), 'id': by_date(fx, ID),
                        'tot': by_date(fx, TOT)}
    print('  USD/CAD series: {} days'.format(len(SERIES['USDCAD']['on'])))
except Exception as e:
    print('  USD/CAD fetch failed: {}'.format(e))

common = None
for s in ('VFV.TO', 'XSP.TO', 'SPY'):
    if s in SERIES:
        k = set(SERIES[s]['on'])
        common = k if common is None else (common & k)
common = sorted(common or [])
print('  common trading days across VFV / XSP / SPY: {}'.format(len(common)))

print('\n  {:14}{:>16}{:>16}{:>16}{:>12}'.format(
    'instrument', 'OVERNIGHT/yr', 'INTRADAY/yr', 'TOTAL/yr', 'ON Sharpe'))
print('  ' + '-' * 76)
for sym in ('SPY', 'XSP.TO', 'VFV.TO', 'ZSP.TO', 'USDCAD'):
    if sym not in SERIES:
        continue
    ks = [d for d in common if d in SERIES[sym]['on']] if sym != 'USDCAD' else \
         [d for d in common if d in SERIES[sym]['on']]
    if len(ks) < 200:
        continue
    o = [SERIES[sym]['on'][d] for d in ks]
    i = [SERIES[sym]['id'][d] for d in ks]
    t = [SERIES[sym]['tot'][d] for d in ks]
    print('  {:14}{:>16}{:>16}{:>16}{:>12}'.format(
        sym, '{:+.2%}'.format(inst.cagr(o)), '{:+.2%}'.format(inst.cagr(i)),
        '{:+.2%}'.format(inst.cagr(t)), '{:.2f}'.format(inst.sharpe(o))))

print("""
  READ XSP AGAINST THE OTHER TWO. XSP is the hedged version of exactly what VFV
  holds. If XSP's overnight number sits next to SPY's, the extra return in VFV is
  currency and not equity premium. If XSP sits next to VFV's, the effect is real
  equity premium and the currency is incidental.""")

# ------------------------------------------------------------------ 2
print('\n' + '=' * 104)
print('2. DOES THE ARITHMETIC CLOSE? VFV overnight - SPY overnight = USDCAD overnight?')
print('=' * 104)
if 'USDCAD' in SERIES:
    ks = [d for d in common if d in SERIES['USDCAD']['on']]
    if len(ks) > 200:
        v = [SERIES['VFV.TO']['on'][d] for d in ks]
        s = [SERIES['SPY']['on'][d] for d in ks]
        f = [SERIES['USDCAD']['on'][d] for d in ks]
        resid = [v[i] - s[i] - f[i] for i in range(len(ks))]
        print('  days compared: {}'.format(len(ks)))
        print('  VFV overnight              {:+.2%}/yr'.format(inst.cagr(v)))
        print('  SPY overnight              {:+.2%}/yr'.format(inst.cagr(s)))
        print('  USD/CAD overnight          {:+.2%}/yr'.format(inst.cagr(f)))
        print('  SPY + USDCAD (predicted)   {:+.2%}/yr'.format(
            inst.cagr([s[i] + f[i] for i in range(len(ks))])))
        print('  UNEXPLAINED residual       {:+.2%}/yr'.format(inst.cagr(resid)))

        def corr(a, b):
            ma, mb = st.mean(a), st.mean(b)
            va = sum((x - ma) ** 2 for x in a) ** 0.5
            vb = sum((y - mb) ** 2 for y in b) ** 0.5
            return sum((a[i] - ma) * (b[i] - mb) for i in range(len(a))) / (va * vb) if va and vb else 0
        print('\n  corr(VFV overnight, SPY overnight)    = {:+.3f}'.format(corr(v, s)))
        print('  corr(VFV overnight, USDCAD overnight) = {:+.3f}'.format(corr(v, f)))
        print("""
  If the residual is near zero, VFV's overnight return is fully explained as
  "S&P overnight plus a currency move" and there is no separate Canadian effect to
  discover. A large residual would mean something else is going on in the TSX
  opening print - which would be its own problem.""")

# ------------------------------------------------------------------ 3
print('\n' + '=' * 104)
print('3. WHAT THE FX LEG ACTUALLY IS - drift or premium?')
print('=' * 104)
if 'USDCAD' in SERIES:
    ks = sorted(SERIES['USDCAD']['on'])
    o = [SERIES['USDCAD']['on'][d] for d in ks]
    i = [SERIES['USDCAD']['id'][d] for d in ks]
    t = [SERIES['USDCAD']['tot'][d] for d in ks]
    print('  USD/CAD over {} days'.format(len(ks)))
    print('    "overnight" window (16:00 -> 09:30, 17.5h)  {:+.2%}/yr'.format(inst.cagr(o)))
    print('    "intraday"  window (09:30 -> 16:00,  6.5h)  {:+.2%}/yr'.format(inst.cagr(i)))
    print('    total                                        {:+.2%}/yr'.format(inst.cagr(t)))
    share = 17.5 / 24.0
    print("""
  FX trades continuously, so a currency's drift should split between the two
  windows roughly in proportion to their LENGTH - about {:.0%} into the 17.5-hour
  overnight window and {:.0%} into the 6.5-hour session. That is a mechanical
  time-slicing effect, not compensation for bearing risk, and nobody is on the
  other side of it being forced to pay.

  If the split above is close to that proportion, the FX contribution to the
  overnight strategy is drift being harvested by the clock - real money, but not
  the mechanism that was claimed, and not something that persists if the currency
  trend reverses.""".format(share, 1 - share))
