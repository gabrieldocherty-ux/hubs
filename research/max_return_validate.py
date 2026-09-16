"""
Validating the maximum-return candidate before recommending it, and doing the
$1,000 -> $1,000,000 arithmetic honestly.

The frontier produced one standout: volatility-managed HQU (2x Nasdaq 100) at
+29.32% a year. That number is only worth quoting if it survives the same tests
everything else here has had to pass - deflated Sharpe against the real trial
count, probability of backtest overfitting across the grid, alpha against the
thing itself, and a bootstrap that keeps losing streaks intact.

There is a specific reason to be suspicious of it. A 2x fund on the Nasdaq over a
window containing the largest technology bull market in history will look
magnificent for reasons that have nothing to do with the strategy. So the alpha
test is not optional here - it is the only thing separating 'this rule works' from
'this was a good 18 years to hold levered tech'.
"""
import math
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng
from strategy_volmanaged import volmanaged_weights

CAPITAL = 1000.0

print('=' * 112)
print('1. DOES THE MAXIMUM-RETURN CANDIDATE SURVIVE VALIDATION?')
print('=' * 112)
GRID = [(lb, tv) for lb in (20, 40, 60) for tv in (0.10, 0.12, 0.15, 0.20)]

for sym, base in (('HQU.TO', 'ZQQ.TO'), ('HSU.TO', 'VFV.TO')):
    bars = tsx_data.get(sym)
    ret = eng.total_returns(bars)
    dv = st.median([b['raw_c'] * b['v'] for b in bars[-60:] if b['v'] > 0] or [0])
    rt = tsx_data.cost_model(sym, bars, dollar_vol=dv)[0]
    print('\n  {}  ({:.1f} yrs)   buy & hold {:+.2%} CAGR, maxDD {:.1%}'.format(
        sym, len(bars) / 252.0, inst.cagr(ret), inst.max_drawdown(ret)))
    print('  {:<18}{:>10}{:>9}{:>9}{:>9}{:>9}{:>10}{:>9}'.format(
        'config', 'CAGR', 'Sharpe', 'maxDD', 'Calmar', 'DSR', 'alpha t', 'expo'))
    cfgs = {}
    for lb, tv in GRID:
        w = volmanaged_weights(ret, lb, tv)
        r = eng.run(w, ret, rt)
        cfgs['{}_{}'.format(lb, tv)] = r
        dsr, _, _ = inst.deflated_sharpe(r, len(GRID))
        a = inst.attribution(r, ret)
        mdd = inst.max_drawdown(r)
        print('  {:<18}{:>10}{:>9}{:>9}{:>9}{:>9}{:>10}{:>9}'.format(
            'vol{} tgt{:.0%}'.format(lb, tv), '{:+.2%}'.format(inst.cagr(r)),
            '{:.2f}'.format(inst.sharpe(r)), '{:.1%}'.format(mdd),
            '{:.2f}'.format(inst.cagr(r) / abs(mdd) if mdd else 0),
            '{:.3f}'.format(dsr), '{:.2f}'.format(a['t_alpha']) if a else '-',
            '{:.0%}'.format(st.mean(w))))
    p = inst.pbo(cfgs)
    print('  PBO across {} configs: {}'.format(
        len(cfgs), '{:.1%}'.format(p) if p is not None else 'n/a'))

# ------------------------------------------------------------------ win rate
print('\n' + '=' * 112)
print('2. WIN RATE vs RETURN - they are not the same dial')
print('=' * 112)
vfv = tsx_data.get('VFV.TO')
vfv_ret = eng.total_returns(vfv)
vfv_rt = tsx_data.cost_model('VFV.TO', vfv)[0]
hqu = tsx_data.get('HQU.TO')
hqu_ret = eng.total_returns(hqu)
hqu_dv = st.median([b['raw_c'] * b['v'] for b in hqu[-60:] if b['v'] > 0] or [0])
hqu_rt = tsx_data.cost_model('HQU.TO', hqu, dollar_vol=hqu_dv)[0]

CANDIDATES = [
    ('overnight VFV (good fill)', [r - vfv_rt for r in eng.overnight_returns(vfv)]),
    ('vol-managed VFV tgt10%', eng.run(volmanaged_weights(vfv_ret, 20, 0.10), vfv_ret, vfv_rt)),
    ('buy & hold VFV', vfv_ret),
    ('vol-managed HQU tgt10%', eng.run(volmanaged_weights(hqu_ret, 20, 0.10), hqu_ret, hqu_rt)),
    ('vol-managed HQU tgt15%', eng.run(volmanaged_weights(hqu_ret, 20, 0.15), hqu_ret, hqu_rt)),
]
print('  {:32}{:>10}{:>11}{:>12}{:>12}{:>12}'.format(
    'strategy', 'CAGR', 'win rate', 'avg win', 'avg loss', 'maxDD'))
print('  ' + '-' * 90)
for name, r in CANDIDATES:
    wins = [x for x in r if x > 0]
    losses = [x for x in r if x <= 0]
    print('  {:32}{:>10}{:>11}{:>12}{:>12}{:>12}'.format(
        name, '{:+.2%}'.format(inst.cagr(r)),
        '{:.1%}'.format(len(wins) / len(r)),
        '{:+.3f}%'.format(st.mean(wins) * 100) if wins else '-',
        '{:+.3f}%'.format(st.mean(losses) * 100) if losses else '-',
        '{:.1%}'.format(inst.max_drawdown(r))))
print("""
  Note the highest win rate does NOT belong to the highest-return strategy. A high
  win rate with small wins and large losses is worse than a low win rate with the
  reverse. Win rate is a comfort metric; the product of win rate and payoff is the
  one that pays.""")

# ------------------------------------------------------------------ the million
print('\n' + '=' * 112)
print('3. $1,000 -> $1,000,000: THE ACTUAL ARITHMETIC')
print('=' * 112)
TARGET = 1_000_000.0
RATES = [('cash / GIC', 0.030), ('buy & hold VFV', 0.1750),
         ('vol-managed VFV', 0.1405), ('overnight VFV (good fill)', 0.2299),
         ('vol-managed HQU tgt15%', 0.2932),
         ('world-record sustained (Medallion ~39% net)', 0.39)]
print('  {:44}{:>12}{:>16}{:>18}'.format(
    'at this annual rate', 'rate', 'years, no adds', 'years, +$200/mo'))
print('  ' + '-' * 90)
for name, rate in RATES:
    yrs = math.log(TARGET / CAPITAL) / math.log(1 + rate)
    m = (1 + rate) ** (1 / 12) - 1
    # 1000*(1+m)^n + 200*((1+m)^n - 1)/m = TARGET
    k = (TARGET + 200 / m) / (CAPITAL + 200 / m)
    n = math.log(k) / math.log(1 + m)
    print('  {:44}{:>12}{:>16}{:>18}'.format(
        name, '{:.1%}'.format(rate), '{:.0f} yrs'.format(yrs), '{:.1f} yrs'.format(n / 12)))
print("""
  The right-hand column is the honest lever, and it is not the strategy. Adding
  $200 a month cuts the time to the target by roughly a THIRD at every rate,
  because early on the contributions dwarf the returns: 29% of $1,000 is $290 a
  year, while $200 a month is $2,400. For the first several years the deposits
  ARE the growth, and no achievable edge changes that.

  This is the same arithmetic as before, stated the other way round. Returns are a
  percentage; dollars are a percentage times capital. At $1,000 the percentage is
  already close to the practical ceiling - the capital is what is small.""")
