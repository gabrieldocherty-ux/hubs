"""
Reaching for maximum return: the actual frontier, including leverage.

THE FACT THAT HAS TO COME FIRST. Every strategy built so far REDUCES return and
reduces risk by more. Buy-and-hold VFV returned +17.50% a year; the vol-managed
version returned +14.05%. The vol-managed sleeve is better on Sharpe (1.33 vs
1.11), on drawdown (-13.0% vs -27.4%) and on Calmar (1.08 vs 0.64) - but it is
WORSE on raw return, and it will always be worse on raw return, because it spends
part of its life in cash. If the objective is maximum dollars rather than maximum
dollars-per-unit-of-risk, a risk-reduction overlay is the wrong tool.

So this file asks a different question honestly: what actually maximises return
here, and exactly what does it cost in drawdown?

THE LEVER NOT YET USED. Wealthsimple can trade TSX-listed leveraged ETFs in CAD
with no FX fee and no commission - HSU (2x S&P 500), HXU (2x TSX 60), HQU (2x
Nasdaq 100). These are real 2x exposure available inside the account's
constraints, and no margin agreement is required because the leverage lives
inside the fund.

WHY THEY ARE NOT SIMPLY 'TWICE AS GOOD', and this is the whole reason to test
rather than assume:
  * DAILY RESET. They deliver 2x the DAILY return, compounded. Over any period
    longer than a day the result is path-dependent, not 2x the period return.
  * VOLATILITY DECAY. In a choppy market a 2x fund loses value even when the
    index is flat, because -10% then +11.1% returns the index to par but leaves
    the 2x fund down about 2%. The drag scales with the SQUARE of volatility.
  * MER around 1.15% a year versus 0.09% for VFV, plus wider spreads.
  * A -50% index move takes a 2x fund to roughly -75%, and that is not a
    recoverable position on a small account.

THE ONE COMBINATION THAT IS ACTUALLY PRINCIPLED. Volatility decay scales with the
square of volatility, and the vol-managed rule already cuts exposure precisely
when volatility is high. So applying the vol overlay TO a leveraged fund attacks
the leveraged fund's specific weakness - lever the calm, de-lever the storm. That
is how a professional would use these instruments, and it is tested below against
the naive buy-and-hold-the-2x version.

Everything is reported with its drawdown attached. A return number without its
drawdown is not an answer to 'what is the maximum return', it is half of one.
"""
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng
from strategy_volmanaged import volmanaged_weights

CAPITAL = 1000.0
LEVERAGED = {
    'HSU.TO': '2x S&P 500 (daily)',
    'HXU.TO': '2x S&P/TSX 60 (daily)',
    'HQU.TO': '2x Nasdaq 100 (daily)',
}

print('=' * 118)
print('0. ARE THE LEVERAGED FUNDS ACTUALLY THERE, AND WHAT DO THEY COST?')
print('=' * 118)
print('  {:10}{:26}{:>7}{:>9}{:>10}{:>12}{:>11}'.format(
    'symbol', 'what', 'yrs', 'price', 'RT cost', 'CAGR', 'maxDD'))
print('  ' + '-' * 88)
LEV = {}
for sym, what in LEVERAGED.items():
    try:
        bars = tsx_data.get(sym)
    except Exception as e:
        print('  {:10}{:26} FETCH FAILED {}'.format(sym, what, e))
        continue
    if len(bars) < 500:
        print('  {:10}{:26} only {} bars - too short'.format(sym, what, len(bars)))
        continue
    # not in UNIVERSE, so pass dollar volume explicitly from recent data
    dv = st.median([b['raw_c'] * b['v'] for b in bars[-60:] if b['v'] > 0] or [0])
    rt = tsx_data.cost_model(sym, bars, dollar_vol=dv)[0]
    ret = eng.total_returns(bars)
    LEV[sym] = {'bars': bars, 'ret': ret, 'rt': rt, 'dv': dv}
    print('  {:10}{:26}{:>7.1f}{:>9}{:>10}{:>12}{:>11}'.format(
        sym, what, len(bars) / 252.0, '{:.2f}'.format(bars[-1]['raw_c']),
        '{:.1f}bp'.format(rt * 1e4), '{:+.2%}'.format(inst.cagr(ret)),
        '{:.1%}'.format(inst.max_drawdown(ret))))

# ------------------------------------------------------------------ decay check
print('\n' + '=' * 118)
print('1. HOW MUCH DOES THE DAILY RESET ACTUALLY COST?')
print('   Compare the real 2x fund against a synthetic "2x the index return,')
print('   compounded daily" built from the unlevered fund. The gap is decay + fees.')
print('=' * 118)
PAIRS = [('HSU.TO', 'VFV.TO', 'S&P 500'), ('HXU.TO', 'XIU.TO', 'TSX 60'),
         ('HQU.TO', 'ZQQ.TO', 'Nasdaq 100')]
for lev_s, base_s, what in PAIRS:
    if lev_s not in LEV:
        continue
    lb = LEV[lev_s]['bars']
    bb = tsx_data.get(base_s)
    ld = {b['d']: b for b in lb}
    bd = {b['d']: b for b in bb}
    common = sorted(set(ld) & set(bd))
    if len(common) < 500:
        continue
    lr, sr = [], []
    for i in range(1, len(common)):
        d0, d1 = common[i - 1], common[i]
        lr.append((ld[d1]['c'] - ld[d0]['c']) / ld[d0]['c'])
        sr.append(2.0 * (bd[d1]['c'] - bd[d0]['c']) / bd[d0]['c'])
    print('  {:22} real 2x {:+.2%}/yr   synthetic 2x {:+.2%}/yr   decay+fees {:+.2%}/yr'.format(
        what, inst.cagr(lr), inst.cagr(sr), inst.cagr(lr) - inst.cagr(sr)))

# ------------------------------------------------------------------ the frontier
print('\n' + '=' * 118)
print('2. THE FRONTIER - every option, with its drawdown attached')
print('=' * 118)
vfv = tsx_data.get('VFV.TO')
vfv_ret = eng.total_returns(vfv)
vfv_rt = tsx_data.cost_model('VFV.TO', vfv)[0]
on_good = [r - vfv_rt for r in eng.overnight_returns(vfv)]
on_bad = []
for i in range(1, len(vfv)):
    o = vfv[i]['o']
    fill = o - 0.10 * (o - vfv[i]['l'])
    on_bad.append((fill - vfv[i - 1]['c']) / vfv[i - 1]['c'] - vfv_rt)

OPTIONS = [
    ('cash (CASH.TO ~ risk free)', None, None),
    ('buy & hold VFV', vfv_ret, vfv_rt),
    ('vol-managed VFV tgt10%', eng.run(volmanaged_weights(vfv_ret, 20, 0.10), vfv_ret, vfv_rt), vfv_rt),
    ('vol-managed VFV tgt20%', eng.run(volmanaged_weights(vfv_ret, 20, 0.20), vfv_ret, vfv_rt), vfv_rt),
    ('overnight VFV (good fill)', on_good, vfv_rt),
    ('overnight VFV (bad fill)', on_bad, vfv_rt),
]
for lev_s, base_s, what in PAIRS:
    if lev_s not in LEV:
        continue
    d = LEV[lev_s]
    OPTIONS.append(('buy & hold {} (2x)'.format(lev_s.split('.')[0]), d['ret'], d['rt']))
    for tgt in (0.10, 0.15):
        w = volmanaged_weights(d['ret'], 20, tgt)
        OPTIONS.append(('vol-managed {} tgt{:.0%}'.format(lev_s.split('.')[0], tgt),
                        eng.run(w, d['ret'], d['rt']), d['rt']))

print('  {:32}{:>10}{:>9}{:>9}{:>9}{:>13}{:>15}'.format(
    'option', 'CAGR', 'Sharpe', 'maxDD', 'Calmar', '$/yr on 1k', 'worst yr $'))
print('  ' + '-' * 97)
for name, r, _rt in OPTIONS:
    if r is None:
        print('  {:32}{:>10}{:>9}{:>9}{:>9}{:>13}{:>15}'.format(
            name, '~+3.0%', '-', '0.0%', '-', '$30', '$30'))
        continue
    c = inst.cagr(r)
    mdd = inst.max_drawdown(r)
    ci = inst.block_bootstrap_ci(r, block=21, draws=1200)
    print('  {:32}{:>10}{:>9}{:>9}{:>9}{:>13}{:>15}'.format(
        name, '{:+.2%}'.format(c), '{:.2f}'.format(inst.sharpe(r)),
        '{:.1%}'.format(mdd), '{:.2f}'.format(c / abs(mdd) if mdd else 0),
        '${:,.0f}'.format(CAPITAL * c),
        '${:,.0f}'.format(CAPITAL * ci['p5']) if ci else '-'))

print("""
  'worst yr $' is the 5th-percentile annual outcome from a 21-day block bootstrap -
  roughly a 1-in-20 bad year, with losing streaks preserved.

  MAXIMUM RETURN IS THE TOP OF THE CAGR COLUMN, AND ITS PRICE IS IN THE maxDD
  COLUMN NEXT TO IT. On $1000 a -60% drawdown is -$600, and it is not hypothetical:
  a 2x fund experienced roughly that in 2020 and again in 2022. Recovering from
  -60% requires +150%, which is why deep drawdowns are so much worse than they
  look - the loss and the recovery are not symmetric.""")
