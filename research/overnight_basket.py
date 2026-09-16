"""
Can the overnight sleeve run across several instruments at once?

THE REQUEST BEHIND THIS FILE was to trade 2-3 times a day. Sequentially that is
blocked twice over: T+1 settlement means the cash from a morning sale is not
buyable again until the next business day, and the return decomposition says a
trading day contains exactly two streams - a positive overnight and a NEGATIVE
intraday - so a second daily round trip means deliberately buying the losing leg.

In PARALLEL it is a different question, and a better one. Three instruments held
overnight is three buys at the close and three sells at the open: six orders a day,
one round trip each, no settlement conflict. And it attacks the single genuine
weakness of the sleeve, which is that its entire alpha depends on execution
quality at one instrument's opening auction. Three independent auctions should
average out a good deal of that.

WHAT WOULD MAKE THIS FAIL, and is tested below:
  1. The instruments are the same bet. Overnight equity returns are driven by
     global risk appetite, so VFV and ZQQ may be near-identical overnight even
     though they look like different funds.
  2. Diversification does not survive the bad fill. If the basket's advantage
     evaporates once realistic execution is imposed, it is cosmetic.
  3. The extra names have thinner headroom. VFV clears its breakeven by 8.9x;
     ZQQ by 5.6x and XGD by 3.6x. Averaging in weaker names lowers the margin
     even if it raises the Sharpe.
  4. Capital fragmentation. $1000 split three ways is $333 a position, and the
     costs modelled here are proportional - but any FIXED per-trade fee would
     scale inversely with position size and hit a three-way split hardest. That
     is checked explicitly at the end because it is the one thing that would
     reverse the conclusion.
"""
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng

BASKET = ['VFV.TO', 'ZQQ.TO', 'XGD.TO']
WIDER = ['VFV.TO', 'ZQQ.TO', 'XGD.TO', 'ZSP.TO', 'XIC.TO']
CAPITAL = 1000.0
BAD_FILL = 0.10          # sell 10% of the way from the open toward the session low


def streams(sym):
    """Overnight returns at the official open and at a realistic bad fill, plus
    the date index so several instruments can be aligned on a common calendar."""
    bars = tsx_data.get(sym)
    rt = tsx_data.cost_model(sym, bars)[0]
    good, bad, ds = {}, {}, []
    for i in range(1, len(bars)):
        c0, o = bars[i - 1]['c'], bars[i]['o']
        fill = o - BAD_FILL * (o - bars[i]['l'])
        d = bars[i]['d']
        good[d] = (o - c0) / c0 - rt
        bad[d] = (fill - c0) / c0 - rt
        ds.append(d)
    return good, bad, rt, bars


DATA = {s: streams(s) for s in WIDER}


def align(syms, which=0):
    common = None
    for s in syms:
        keys = set(DATA[s][which])
        common = keys if common is None else (common & keys)
    common = sorted(common)
    return common, {s: [DATA[s][which][d] for d in common] for s in syms}


def corr(a, b):
    n = min(len(a), len(b))
    a, b = a[-n:], b[-n:]
    ma, mb = st.mean(a), st.mean(b)
    va = sum((x - ma) ** 2 for x in a) ** 0.5
    vb = sum((x - mb) ** 2 for x in b) ** 0.5
    return sum((a[i] - ma) * (b[i] - mb) for i in range(n)) / (va * vb) if va and vb else 0.0


# ------------------------------------------------------------------ 1. same bet?
print('=' * 112)
print('1. ARE THE OVERNIGHT STREAMS DIFFERENT BETS?')
print('   Overnight equity returns are driven by global risk appetite, so funds')
print('   that look different may be the same thing after dark.')
print('=' * 112)
common, S = align(WIDER)
print('   common window: {} days = {:.1f} years'.format(len(common), len(common) / 252))
print('\n   {:10}'.format('') + ''.join('{:>10}'.format(s.split('.')[0]) for s in WIDER))
for a in WIDER:
    print('   {:10}'.format(a.split('.')[0]) + ''.join(
        '{:>10}'.format('{:+.2f}'.format(corr(S[a], S[b]))) for b in WIDER))

# ------------------------------------------------------------------ 2. the basket
print('\n' + '=' * 112)
print('2. THE THREE-NAME BASKET vs VFV ALONE')
print('   Equal weight, rebalanced daily by construction (each name is entered and')
print('   exited every night, so there is no drift to rebalance away).')
print('=' * 112)
for label, which in (('at the official open', 0), ('at a 10% adverse fill', 1)):
    print('\n   --- {} ---'.format(label))
    print('   {:28}{:>10}{:>9}{:>9}{:>9}{:>9}{:>14}'.format(
        'book', 'CAGR', 'Sharpe', 'maxDD', 'Calmar', 'hit', '$/yr on 1k'))
    common_b, Sb = align(BASKET, which)
    basket = [st.mean([Sb[s][i] for s in BASKET]) for i in range(len(common_b))]
    common_w, Sw = align(WIDER, which)
    wide = [st.mean([Sw[s][i] for s in WIDER]) for i in range(len(common_w))]
    solo = Sb['VFV.TO']
    for name, r in (('VFV alone', solo),
                    ('3-name basket', basket),
                    ('5-name basket', wide)):
        c = inst.cagr(r)
        print('   {:28}{:>10}{:>9}{:>9}{:>9}{:>9}{:>14}'.format(
            name, '{:+.2%}'.format(c), '{:.2f}'.format(inst.sharpe(r)),
            '{:.1%}'.format(inst.max_drawdown(r)),
            '{:.2f}'.format(c / abs(inst.max_drawdown(r)) if inst.max_drawdown(r) else 0),
            '{:.0%}'.format(sum(1 for x in r if x > 0) / len(r)),
            '${:,.0f}'.format(CAPITAL * c)))

# ------------------------------------------------------------------ 3. alpha
print('\n' + '=' * 112)
print('3. DOES THE BASKET STILL HAVE ALPHA AT A REALISTIC FILL?')
print('   This is the test VFV alone FAILED: at a 10% adverse fill its alpha')
print('   t-statistic collapsed from 6.52 to 0.26 and what remained was pure beta.')
print('=' * 112)
bench_bars = tsx_data.get('VFV.TO')
bench_by_date = {}
tr = eng.total_returns(bench_bars)
for i, d in enumerate(eng.dates(bench_bars)):
    bench_by_date[d] = tr[i]
for which, label in ((0, 'official open'), (1, '10% adverse fill')):
    common_b, Sb = align(BASKET, which)
    basket = [st.mean([Sb[s][i] for s in BASKET]) for i in range(len(common_b))]
    bench = [bench_by_date.get(d, 0.0) for d in common_b]
    a = inst.attribution(basket, bench)
    dsr, sr, sr0 = inst.deflated_sharpe(basket, 1)
    print('\n   3-name basket @ {}'.format(label))
    print('     CAGR {:+.2%}  Sharpe {:.2f}  DSR {:.3f}'.format(
        inst.cagr(basket), inst.sharpe(basket), dsr))
    if a:
        print('     alpha {:+.2%}/yr   t = {:.2f}   beta {:.2f}   IR {:.2f}'.format(
            a['alpha_ann'], a['t_alpha'], a['beta'], a['ir']))

# ------------------------------------------------------------------ 4. fixed fees
print('\n' + '=' * 112)
print('4. THE THING THAT WOULD REVERSE ALL OF THIS: A FIXED PER-TRADE FEE')
print('   Wealthsimple states $0 commission and no ECN pass-through on TSX-listed')
print('   securities. If that is wrong even by cents, splitting $1000 three ways')
print('   makes it worse, because a fixed fee is a LARGER percentage of a smaller')
print('   position. This is the single question to confirm before trading it.')
print('=' * 112)
common_b, Sb = align(BASKET, 1)
basket_bad = [st.mean([Sb[s][i] for s in BASKET]) for i in range(len(common_b))]
print('   {:22}{:>16}{:>16}{:>16}'.format(
    'fee per side', 'VFV alone $333', '3 names @ $333', '3 names @ $111'))
print('   ' + '-' * 70)
for fee in (0.0, 0.05, 0.10, 0.25, 0.50, 1.00):
    # fee as a fraction of the position, charged twice (buy and sell), per night
    def drag(pos):
        return (2 * fee / pos) if pos else 0
    solo = [r - drag(1000.0) for r in Sb['VFV.TO']]
    b333 = [r - drag(333.0) for r in basket_bad]
    b111 = [r - drag(111.0) for r in basket_bad]
    print('   {:22}{:>16}{:>16}{:>16}'.format(
        '${:.2f}'.format(fee), '{:+.1%}'.format(inst.cagr(solo)),
        '{:+.1%}'.format(inst.cagr(b333)), '{:+.1%}'.format(inst.cagr(b111))))
print("""
   Read the last column. Three $111 positions traded twice a day cannot survive
   even a five-cent fee, because $0.10 round trip on $111 is 9bp and the whole
   edge is ~10bp a night. At small capital, FIXED costs are the enemy and
   percentage costs are survivable - the exact opposite of an institutional book,
   and the reason a bigger position in fewer names can beat a diversified one.""")
