"""
Trying to destroy the overnight result before trusting it.

The headline is strong enough to be suspicious: VFV.TO overnight-only returns
+22.99% net CAGR at Sharpe 2.06, alpha +13.78%/yr with t=6.52, 15 of 15 calendar
years positive, and 8.9x headroom over the modelled cost. Results that good are
usually a measurement artefact, and there are two specific reasons to think this
one might be.

THE SMOKING GUN THAT PROMPTED THIS FILE. Two pairs of ETFs track essentially the
same thing and disagree wildly about the size of the overnight premium:

    VFV.TO  +26.34% overnight     ZSP.TO  +21.56%     both = S&P 500, CAD unhedged
    XIC.TO  +22.18% overnight     XIU.TO  +10.98%     both = broad Canadian equity

The same underlying market cannot pay two different risk premia. So at least one
of these numbers is not a risk premium. And the direction is damning: XIC trades
$24M a day and shows DOUBLE the overnight return of XIU, which trades $193M a
day. A genuine premium for bearing closed-market risk has no reason to be larger
on the less liquid fund. A measurement artefact has every reason to be.

THE ALTERNATIVE HYPOTHESIS, stated precisely. If the opening print is a noisy or
stale estimate of fair value rather than a price anyone can trade, then whenever
it prints too high the measured overnight return (close -> open) is inflated and
the measured intraday return (open -> close) is deflated by the SAME error, which
then reverses within the day. That produces exactly the pattern observed - large
positive overnight, large negative intraday - with no tradeable edge whatsoever,
because you cannot sell at a price that does not exist. It should also be worse
on less liquid funds, which is what the XIU/XIC pair shows.

FOUR TESTS, each of which could kill it:
  1. Do overnight and intraday returns MEAN-REVERT against each other? A strongly
     negative correlation is the signature of a pricing error shared between the
     two legs. A genuine premium should leave them roughly independent.
  2. Does the measured premium scale with ILLIQUIDITY across the universe? If
     thinner funds show bigger premia, it is an artefact, not compensation.
  3. Do same-underlying pairs agree once cost is accounted for? They must.
  4. Does the edge survive being forced to trade AWAY from the open - filling at
     a blend of the open and some of the day's range, which is what a real order
     into an uncertain auction actually gets?
"""
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng

SYMS = ['VFV.TO', 'ZSP.TO', 'ZQQ.TO', 'XQQ.TO', 'XIU.TO', 'XIC.TO', 'HXT.TO',
        'ZEB.TO', 'XFN.TO', 'XEG.TO', 'XGD.TO', 'XEF.TO', 'XSP.TO', 'XUT.TO',
        'XMA.TO', 'XST.TO', 'XRE.TO', 'XEC.TO']


def corr(a, b):
    n = min(len(a), len(b))
    a, b = a[-n:], b[-n:]
    ma, mb = st.mean(a), st.mean(b)
    va = sum((x - ma) ** 2 for x in a) ** 0.5
    vb = sum((x - mb) ** 2 for x in b) ** 0.5
    if va == 0 or vb == 0:
        return 0.0
    return sum((a[i] - ma) * (b[i] - mb) for i in range(n)) / (va * vb)


D = {}
for s in SYMS:
    try:
        bars = tsx_data.get(s)
    except Exception:
        continue
    if len(bars) < 750:
        continue
    D[s] = {'bars': bars, 'on': eng.overnight_returns(bars),
            'id': eng.intraday_returns(bars), 'tot': eng.total_returns(bars),
            'dv': tsx_data.UNIVERSE.get(s, ('', '', 0))[2],
            'rt': tsx_data.cost_model(s, bars)[0]}

# ---------------------------------------------------------------- 1. reversal
print('=' * 116)
print('TEST 1: DO OVERNIGHT AND INTRADAY RETURNS REVERSE AGAINST EACH OTHER?')
print('  A shared pricing error in the open makes ON and ID mirror each other.')
print('  A genuine premium leaves them roughly independent.')
print('=' * 116)
print('  {:10}{:>13}{:>13}{:>13}{:>15}{:>16}'.format(
    'symbol', 'corr(ON,ID)', 'corr same-day', 'ON next-day', 'median $vol', 'verdict'))
print('  ' + '-' * 96)
for s, d in sorted(D.items(), key=lambda kv: -kv[1]['dv']):
    c_same = corr(d['on'], d['id'])
    # ON[t] vs ID[t-1]: is today's gap related to yesterday's session?
    c_lag = corr(d['on'][1:], d['id'][:-1])
    flag = 'ARTEFACT?' if c_same < -0.25 else ('suspicious' if c_same < -0.12 else 'ok')
    print('  {:10}{:>13}{:>13}{:>13}{:>15}{:>16}'.format(
        s, '{:+.3f}'.format(c_same), '{:+.3f}'.format(c_same),
        '{:+.3f}'.format(c_lag), '${:,.0f}'.format(d['dv']), flag))

# ---------------------------------------------------------------- 2. liquidity
print('\n' + '=' * 116)
print('TEST 2: DOES THE PREMIUM SCALE WITH ILLIQUIDITY?')
print('  If thin funds pay more, it is a measurement error, not compensation.')
print('=' * 116)
pts = [(d['dv'], inst.cagr(d['on']), s) for s, d in D.items() if d['dv'] > 0]
pts.sort()
print('  {:10}{:>16}{:>14}{:>14}'.format('symbol', 'median $vol', 'ON gross', 'ON Sharpe'))
print('  ' + '-' * 54)
for dv, c, s in pts:
    print('  {:10}{:>16}{:>14}{:>14}'.format(
        s, '${:,.0f}'.format(dv), '{:+.2%}'.format(c), '{:.2f}'.format(inst.sharpe(D[s]['on']))))
import math
lv = [math.log(p[0]) for p in pts]
cg = [p[1] for p in pts]
print('\n  correlation( log median $volume , overnight CAGR ) = {:+.3f}'.format(corr(lv, cg)))
print('  NEGATIVE means thinner funds show bigger premia = the artefact signature.')

# ---------------------------------------------------------------- 3. pairs
print('\n' + '=' * 116)
print('TEST 3: DO SAME-UNDERLYING PAIRS AGREE?')
print('  They track the same market. They must pay the same premium, or one of')
print('  them is not measuring a premium.')
print('=' * 116)
PAIRS = [('VFV.TO', 'ZSP.TO', 'S&P 500 CAD unhedged'),
         ('XIU.TO', 'XIC.TO', 'broad Canadian equity'),
         ('ZQQ.TO', 'XQQ.TO', 'Nasdaq 100 (unhedged vs hedged)'),
         ('XIU.TO', 'HXT.TO', 'S&P/TSX 60')]
for a, b, what in PAIRS:
    if a not in D or b not in D:
        continue
    # compare only on the overlapping dates, so different histories cannot explain it
    da = {x['d']: i for i, x in enumerate(D[a]['bars'][1:])}
    db = {x['d']: i for i, x in enumerate(D[b]['bars'][1:])}
    common = sorted(set(da) & set(db))
    oa = [D[a]['on'][da[d]] for d in common]
    ob = [D[b]['on'][db[d]] for d in common]
    print('\n  {}  ({} overlapping days)'.format(what, len(common)))
    print('    {:8} ON {:+.2%}/yr  Sharpe {:.2f}   |   {:8} ON {:+.2%}/yr  Sharpe {:.2f}'.format(
        a, inst.cagr(oa), inst.sharpe(oa), b, inst.cagr(ob), inst.sharpe(ob)))
    print('    difference {:+.2%}/yr   correlation between their overnight returns {:+.3f}'.format(
        inst.cagr(oa) - inst.cagr(ob), corr(oa, ob)))

# ---------------------------------------------------------------- 4. bad fills
print('\n' + '=' * 116)
print('TEST 4: FORCED TO TRADE AWAY FROM THE OPEN')
print('  A real order into an opening auction does not get the official print. This')
print('  fills a fraction of the way from the open toward the day\'s extreme against')
print('  us - a direct, honest penalty on the leg the whole strategy depends on.')
print('=' * 116)
print('  {:10}{:>12}{:>12}{:>12}{:>12}{:>12}'.format(
    'symbol', 'at open', '10% adv', '25% adv', '50% adv', 'to close'))
print('  ' + '-' * 70)
for s in ['VFV.TO', 'ZQQ.TO', 'ZSP.TO', 'XQQ.TO', 'XGD.TO', 'XIC.TO', 'XIU.TO']:
    if s not in D:
        continue
    bars = D[s]['bars']
    rt = D[s]['rt']
    cells = []
    for frac in (0.0, 0.10, 0.25, 0.50):
        rs = []
        for i in range(1, len(bars)):
            c0 = bars[i - 1]['c']
            o = bars[i]['o']
            # we are SELLING at the open, so an adverse fill is a LOWER price;
            # walk from the open toward the day's low by `frac` of that distance
            fill = o - frac * (o - bars[i]['l'])
            rs.append((fill - c0) / c0 - rt)
        cells.append('{:+.1%}'.format(inst.cagr(rs)))
    # and the degenerate case: forced to hold to the close instead
    rs_close = [(bars[i]['c'] - bars[i - 1]['c']) / bars[i - 1]['c'] - rt
                for i in range(1, len(bars))]
    print('  {:10}{:>12}{:>12}{:>12}{:>12}{:>12}'.format(
        s, *cells, '{:+.1%}'.format(inst.cagr(rs_close))))
print("""
  '25% adv' means the sale filled a quarter of the way from the official open down
  toward the session low. That is a severe penalty and deliberately so: if the edge
  survives it, the opening print being imperfect does not matter. If it does not,
  the strategy is a measurement of prices rather than a way to earn money.""")
