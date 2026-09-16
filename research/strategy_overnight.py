"""
STRATEGY 1 (the day-trading one): hold only overnight, sit in cash all day.

Buy on the close, sell on the next open. Roughly a 17.5 hour hold, 252 round
trips a year, never holding through a single trading session. Long-only, no
leverage, no shorting - executable exactly as written in a Wealthsimple account.

THE MECHANISM, stated before any number is quoted. Equity risk premium is
compensation for bearing risk you cannot escape. Overnight is when you genuinely
cannot escape it: the market is shut, news arrives - earnings, central banks,
geopolitics, and for Canadian ETFs the entire Asian and European sessions - and
you carry the gap with no ability to hedge, trim or stop out. During the day you
can do all three. So the compensation should concentrate in the hours when
holders are least able to react, and it does. Whoever is flat overnight and long
intraday is choosing to skip the paid hours and take the unpaid ones.

This is one of the most robustly documented anomalies in equities (Kelly & Clark
2011; Lachance 2015; Bogousslavsky 2021 on the intraday/overnight split), and it
has survived publication, which matters - most anomalies do not.

WHAT WOULD MAKE IT FALSE, tested below in order of how likely each is to kill it:
  1. The opening price is not tradeable. THE critical assumption. ETF opening
     prints are unreliable, spreads are widest at the open, and an execution a few
     basis points away from the official open destroys a per-night edge measured
     in single-digit basis points. Section 4 finds the breakeven cost and asks how
     many multiples of the modelled spread the edge survives.
  2. It is concentrated in a few crisis nights rather than being a steady premium.
     Section 3 trims, drops the best days, and breaks it out by calendar year.
  3. It has decayed since publication. Section 3's year-by-year table shows it.
  4. T+1 settlement makes daily recycling impossible in a cash account. Section 5.

NUMBER OF TRIALS: ONE, for the headline. The unconditional strategy has no
lookback, no threshold, no parameter of any kind - there is nothing to fit and
nothing to search, which is the strongest evidential position a backtest can
occupy. Variants explored afterwards are counted and deflated separately.
"""
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng

CANDIDATES = ['VFV.TO', 'ZQQ.TO', 'ZSP.TO', 'XQQ.TO', 'ZEB.TO', 'HXT.TO',
              'XIU.TO', 'XIC.TO', 'XFN.TO', 'XEG.TO', 'XGD.TO', 'XEF.TO']

print('=' * 118)
print('STRATEGY 1: OVERNIGHT-ONLY  (buy MOC, sell MOO)  -  the day-trading strategy')
print('=' * 118)

# ---------------------------------------------------------------- 1. net of real costs
print('\n1. NET OF MODELLED COSTS, per instrument. 252 round trips a year.')
print('   Cost per round trip is from tsx_data.cost_model: tick-based, x2 safety.')
print('   {:10}{:>7}{:>9}{:>11}{:>11}{:>10}{:>9}{:>9}{:>10}'.format(
    'symbol', 'yrs', 'RT cost', 'GROSS', 'NET cagr', 'B&H cagr', 'Sharpe', 'maxDD', 'cost/yr'))
print('   ' + '-' * 104)

rows = {}
for sym in CANDIDATES:
    bars = tsx_data.get(sym)
    if len(bars) < 750:
        continue
    rt, _, _ = tsx_data.cost_model(sym, bars)
    on = eng.overnight_returns(bars)
    tot = eng.total_returns(bars)
    # weight 1.0 every night; a full in-and-out cycle each day = one round trip
    net = [r - rt for r in on]
    rows[sym] = {'bars': bars, 'rt': rt, 'on': on, 'tot': tot, 'net': net}
    print('   {:10}{:>7.1f}{:>9}{:>11}{:>11}{:>10}{:>9}{:>9}{:>10}'.format(
        sym, len(bars) / 252.0, '{:.1f}bp'.format(rt * 1e4),
        '{:+.2%}'.format(inst.cagr(on)), '{:+.2%}'.format(inst.cagr(net)),
        '{:+.2%}'.format(inst.cagr(tot)), '{:.2f}'.format(inst.sharpe(net)),
        '{:.1%}'.format(inst.max_drawdown(net)), '{:.1%}'.format(rt * 252)))

# ---------------------------------------------------------------- 2. the hard test
print('\n2. DEFLATED SHARPE + ALPHA vs SIMPLY OWNING IT')
print('   n_trials=1: the unconditional strategy has no parameters to search.')
print('   Alpha is measured against buy-and-hold of the SAME instrument, so a')
print('   rising market cannot be mistaken for skill.')
for sym, d in rows.items():
    print('\n' + inst.report(sym + ' overnight', d['net'], bench=d['tot'], n_trials=1))

# ---------------------------------------------------------------- 3. is it a few nights?
print('\n' + '=' * 118)
print('3. IS IT A STEADY PREMIUM OR A HANDFUL OF NIGHTS?')
print('=' * 118)
print('   {:10}{:>12}{:>12}{:>12}{:>12}{:>14}'.format(
    'symbol', 'net CAGR', 'ex-best 10', 'ex-best 25', 'median day', 'yrs positive'))
print('   ' + '-' * 74)
for sym, d in rows.items():
    net = d['net']
    s = sorted(net)
    ex10 = inst.cagr(s[:-10]) if len(s) > 10 else 0
    ex25 = inst.cagr(s[:-25]) if len(s) > 25 else 0
    # by calendar year
    yr = {}
    ds = eng.dates(d['bars'])
    for i, r in enumerate(net):
        if i < len(ds):
            yr.setdefault(ds[i][:4], []).append(r)
    pos = sum(1 for v in yr.values() if sum(v) > 0)
    print('   {:10}{:>12}{:>12}{:>12}{:>12}{:>14}'.format(
        sym, '{:+.2%}'.format(inst.cagr(net)), '{:+.2%}'.format(ex10),
        '{:+.2%}'.format(ex25), '{:+.3f}%'.format(st.median(net) * 100),
        '{}/{}'.format(pos, len(yr))))
print("""
   'ex-best 10' removes the ten best nights entirely. A premium that survives that
   is a premium; one that does not is a lottery ticket that happened to pay.""")

# ---------------------------------------------------------------- 4. THE decisive test
print('\n' + '=' * 118)
print('4. COST STRESS - THE TEST THAT DECIDES THIS')
print('   The opening print is the weak point. ETF spreads are widest at the open')
print('   and the official open may not be executable. So: how many multiples of')
print('   the modelled spread can this pay before it dies?')
print('=' * 118)
print('   {:10}{:>10}{:>10}{:>10}{:>10}{:>10}{:>12}{:>11}'.format(
    'symbol', '1x', '2x', '3x', '5x', '10x', 'breakeven', 'headroom'))
print('   ' + '-' * 84)
for sym, d in rows.items():
    on, rt = d['on'], d['rt']
    cells = []
    for m in (1, 2, 3, 5, 10):
        cells.append('{:+.1%}'.format(inst.cagr([r - rt * m for r in on])))
    be = st.mean(on)                      # per-night gross = breakeven round trip
    print('   {:10}{:>10}{:>10}{:>10}{:>10}{:>10}{:>12}{:>11}'.format(
        sym, *cells, '{:.1f}bp'.format(be * 1e4), '{:.1f}x'.format(be / rt if rt else 0)))
print("""
   'breakeven' is the round-trip cost at which the edge is exactly zero, and
   'headroom' is that divided by the modelled cost. Below ~3x headroom this is not
   safely tradeable: the modelled spread is a mid-session estimate, and the open is
   where spreads are worst. Anything under 2x should be treated as REJECTED on
   execution risk regardless of how good its Sharpe looks.""")

# ---------------------------------------------------------------- 5. T+1
print('\n' + '=' * 118)
print('5. T+1 SETTLEMENT - the constraint that decides how much capital works')
print('=' * 118)
best = max(rows, key=lambda s: inst.cagr(rows[s]['net'])) if rows else None
if best:
    d = rows[best]
    full = inst.cagr(d['net'])
    half = inst.cagr([r * 0.5 for r in d['net']])
    print("""   Sale proceeds settle T+1. In a CASH account the dollars from selling at
   Tuesday's open are not available to buy again until Wednesday, so the strategy
   can only be run every OTHER night - or on half the capital every night.

   {} at full capital every night : {:+.2%} CAGR
   {} on half capital every night : {:+.2%} CAGR   <- the realistic cash-account figure

   This must be confirmed against the live account before sizing: some brokers
   permit buying with unsettled proceeds, some do not, and getting it wrong causes
   a good-faith violation rather than a fill. Treat the half-capital number as the
   planning figure until verified.""".format(best, full, best, half))

print('\n' + '=' * 118)
print('ON $1000, what the realistic figure means in dollars')
print('=' * 118)
if best:
    d = rows[best]
    for label, series in (('full capital', d['net']),
                          ('half capital (T+1 safe)', [r * 0.5 for r in d['net']])):
        c = inst.cagr(series)
        ci = inst.block_bootstrap_ci(series, block=21, draws=2000)
        print('   {:26} {:+.2%}/yr  = ${:,.0f}/yr on $1000{}'.format(
            label, c, 1000 * c,
            '   [p5 {:+.1%} .. p95 {:+.1%}]'.format(ci['p5'], ci['p95']) if ci else ''))
    print("""
   The confidence interval is a BLOCK bootstrap (21-day blocks), which preserves
   losing streaks. Resampling single days independently would understate the
   downside, a failure mode already recorded in this project's risk skill.""")
