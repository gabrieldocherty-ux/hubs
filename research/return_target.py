"""
What return can these strategies actually produce, and what does chasing a
target do to the risk?

The framing matters. You cannot set a return target on a trading system - the
edge is whatever it is. The only dial is POSITION SIZE, and it scales return and
drawdown together, near enough linearly at small sizes and worse than linearly
once losses start compounding. So "aim for 10%" has to be turned into "what
sizing produces a median 10%, and what does the bad tail look like there".

Method: bootstrap. Resample the actual validated trade sequence with
replacement, one year's worth of trades at a time, 20,000 times, at each
position size. That gives a DISTRIBUTION of annual outcomes rather than the
single historical path, which is the only honest way to answer this with n<250
trades - the backtest's own CAGR is one draw from this distribution, and
quoting it as the expected return would be the standard way to mislead someone.

Costs are re-run at the measured live rate (~0.10% round trip, from
cost_model.py) alongside the conservative 0.19% the validation used.
"""
import sys, random, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
SIZES = [0.05, 0.10, 0.15, 0.20, 0.30, 0.40, 0.50]
N_BOOT = 20000
random.seed(11)

MEASURED_FEE = 0.00045
MEASURED_SLIP = 0.00005      # ~0.5bp per side measured on the live book at our size


def get(name, cost='validated'):
    kw = {} if cost == 'validated' else {'fee': MEASURED_FEE, 'slippage': MEASURED_SLIP}
    if name == 'S3':
        _, m = pooled.pooled(volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5},
                             COINS, 60, name='S3', **kw)
    elif name == 'D1':
        _, m = pooled.pooled(range_breakout,
                             {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0},
                             COINS, 60, name='D1', **kw)
    elif name == 'B1':
        _, m = run_basis.run(run_basis.BASE, **kw)
    return m


def bootstrap(trades, trades_per_year, size, n_boot=N_BOOT):
    """Distribution of one year's account return at `size` notional per position."""
    r = [t.pnl_pct for t in trades]
    n = max(1, int(round(trades_per_year)))
    out = []
    for _ in range(n_boot):
        eq = 1.0
        for _ in range(n):
            eq *= (1 + random.choice(r) * size)
            if eq <= 0.01:
                eq = 0.01
                break
        out.append(eq - 1)
    out.sort()
    return out


def pctile(sorted_vals, p):
    return sorted_vals[min(len(sorted_vals) - 1, int(len(sorted_vals) * p))]


print('=' * 112)
print('1. THE STRATEGIES AT THE MEASURED COST vs THE CONSERVATIVE ONE USED FOR VALIDATION')
print('=' * 112)
print('{:<6}{:<26}{:>7}{:>11}{:>12}{:>13}{:>11}'.format(
    'id', 'cost basis', 'n', 'exp/trade', 'trades/yr', 'per-trade sd', 'acct CAGR'))
store = {}
for name in ('S3', 'D1', 'B1'):
    for cost in ('validated', 'measured'):
        m = get(name, cost)
        sd = st.pstdev([t.pnl_pct for t in m.trades])
        label = '0.190% (validation)' if cost == 'validated' else '0.100% (live book)'
        print('{:<6}{:<26}{:>7}{:>11}{:>12}{:>13}{:>11}'.format(
            name, label, m.n, '{:+.2f}%'.format(m.expectancy * 100),
            '{:.1f}'.format(m.trades_per_year()), '{:.2f}%'.format(sd * 100),
            '{:+.1f}%'.format(m.account_cagr(0.20) * 100)))
        if cost == 'validated':
            store[name] = m
    print()

print('=' * 112)
print('2. BOOTSTRAPPED ONE-YEAR OUTCOMES BY POSITION SIZE  (conservative 0.19% cost)')
print('   20,000 resampled years. "median" is the typical year, not a promise.')
print('=' * 112)
for name in ('S3', 'B1'):
    m = store[name]
    print('\n{}  ({}, {:.0f} trades/yr, expectancy {:+.2f}%/trade)'.format(
        name, m.name if m.name else name, m.trades_per_year(), m.expectancy * 100))
    print('  {:<10}{:>12}{:>12}{:>12}{:>12}{:>14}'.format(
        'size', 'p5 (bad)', 'p25', 'MEDIAN', 'p95 (good)', 'P(lose money)'))
    for size in SIZES:
        dist = bootstrap(m.trades, m.trades_per_year(), size)
        loss_p = sum(1 for x in dist if x < 0) / len(dist)
        print('  {:<10}{:>12}{:>12}{:>12}{:>12}{:>14}'.format(
            '{:.0f}% notl'.format(size * 100),
            '{:+.1f}%'.format(pctile(dist, .05) * 100),
            '{:+.1f}%'.format(pctile(dist, .25) * 100),
            '{:+.1f}%'.format(pctile(dist, .50) * 100),
            '{:+.1f}%'.format(pctile(dist, .95) * 100),
            '{:.0f}%'.format(loss_p * 100)))

print('\n' + '=' * 112)
print('3. THE TWO UNCORRELATED STRATEGIES RUN TOGETHER')
print('   S3 and B1 overlap only 0.35-0.59, so combining them should raise return')
print('   per unit of risk rather than just stacking risk.')
print('=' * 112)
combo = engine.Result(coin='POOL', name='S3+B1')
combo.trades = sorted(store['S3'].trades + store['B1'].trades, key=lambda t: t.entry_t)
combo.start_t = min(store['S3'].start_t, store['B1'].start_t)
combo.end_t = max(store['S3'].end_t, store['B1'].end_t)
print('  combined: n={} expectancy {:+.2f}%/trade  {:.0f} trades/yr'.format(
    combo.n, combo.expectancy * 100, combo.trades_per_year()))
print('  {:<10}{:>12}{:>12}{:>12}{:>12}{:>14}'.format(
    'size', 'p5 (bad)', 'p25', 'MEDIAN', 'p95 (good)', 'P(lose money)'))
target_rows = []
for size in SIZES:
    dist = bootstrap(combo.trades, combo.trades_per_year(), size)
    loss_p = sum(1 for x in dist if x < 0) / len(dist)
    med = pctile(dist, .50)
    target_rows.append((size, med, pctile(dist, .05), loss_p))
    print('  {:<10}{:>12}{:>12}{:>12}{:>12}{:>14}'.format(
        '{:.0f}% notl'.format(size * 100),
        '{:+.1f}%'.format(pctile(dist, .05) * 100),
        '{:+.1f}%'.format(pctile(dist, .25) * 100),
        '{:+.1f}%'.format(med * 100),
        '{:+.1f}%'.format(pctile(dist, .95) * 100),
        '{:.0f}%'.format(loss_p * 100)))

print('\n' + '=' * 112)
print('4. WHAT SIZING HITS A 10% TARGET?')
print('=' * 112)
for label, want in (('10% per YEAR', 0.10), ('10% per MONTH (= 214%/yr)', 3.138)):
    hit = None
    for size in [x / 100 for x in range(1, 201)]:
        dist = bootstrap(combo.trades, combo.trades_per_year(), size, n_boot=3000)
        if pctile(dist, .50) >= want:
            hit = (size, pctile(dist, .05), pctile(dist, .50), pctile(dist, .95),
                   sum(1 for x in dist if x < 0) / len(dist))
            break
    if hit:
        size, p5, p50, p95, lp = hit
        print('\n  {}: needs ~{:.0f}% of capital per position'.format(label, size * 100))
        print('     median {:+.0f}%   bad year (p5) {:+.0f}%   good year (p95) {:+.0f}%   '
              'chance of losing money {:.0f}%'.format(p50 * 100, p5 * 100, p95 * 100, lp * 100))
        if size > 0.20:
            print('     >>> EXCEEDS the 20%-of-capital risk rail in config/settings.json.')
    else:
        print('\n  {}: NOT REACHABLE at any sizing up to 200% of capital per position.'.format(label))
        print('     Sizing past a point makes the median WORSE, not better - losses compound')
        print('     against a smaller base than gains compound for. That is volatility drag,')
        print('     and no amount of leverage gets around it.')
