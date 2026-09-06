"""
D1 RangeBreakout is the leading candidate, so it gets the hardest look.

The question is not "can I find a good number" - I already have one. It is
whether the edge exists across a NEIGHBOURHOOD of reasonable parameters. A
strategy that works at n=20 but not n=18 or n=25 is a saturated edge: I fitted
the lookback to this sample and it will not survive contact with new data.

Also included: a decay check on the CURRENTLY LIVE default (SMA 20/60 on 4h).
The macro results showed trend edge collapsing after 2023 across every variant
tested, and the live strategy is from that same family. If it has decayed too,
Gabe needs to know - that is a finding about what is running with his money
(paper, for now), not an academic aside.
"""
import sys
sys.path.insert(0, 'research')
import engine, pooled
from strategies_daily import range_breakout

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
BASE = {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 1.5}


def row(label, params, warm=60):
    per, m = pooled.pooled(range_breakout, params, COINS, warm, name=label)
    if m.n == 0:
        return '{:<34} no trades'.format(label), 0
    tr, te = pooled.pooled_split(m)
    return ('{:<34} n={:<4} exp={:>7.2%} trim5={:>7.2%} wr={:>5.1%} '
            'train={:>7.2%} test={:>7.2%} CAGR={:>6.1%}'.format(
                label, m.n, m.expectancy, m.trimmed_expectancy(0.05), m.win_rate,
                tr.expectancy if tr else 0, te.expectancy if te else 0,
                m.account_cagr(0.20))), m.trimmed_expectancy(0.05)


print('=' * 118)
print('D1 PARAMETER NEIGHBOURHOOD  (pooled BTC/ETH/SOL/HYPE, tradeable window, real funding)')
print('=' * 118)
print(row('BASELINE n=20 atr2.5 hold10 r1.5', BASE)[0])
print()
results = []
for key, values in [('n', [10, 14, 15, 25, 30, 40]),
                    ('atr_mult', [1.5, 2.0, 3.0, 4.0]),
                    ('max_hold', [3, 5, 7, 15, 20, 30]),
                    ('atr_ratio', [0.0, 1.0, 1.25, 1.75, 2.0, 2.5])]:
    for v in values:
        p = dict(BASE)
        p[key] = v
        line, tr5 = row('  {}={}'.format(key, v), p)
        print(line)
        results.append((key, v, tr5))
    print()

pos = sum(1 for _, _, t in results if t > 0)
print('NEIGHBOURHOOD SUMMARY: {}/{} perturbations have positive trimmed expectancy'.format(
    pos, len(results)))

print('\n' + '=' * 118)
print('COST SENSITIVITY (does the edge survive worse execution than modeled?)')
print('=' * 118)
for mult in (1, 1.5, 2, 3):
    per, m = pooled.pooled(range_breakout, BASE, COINS, 60, name='cost',
                           slippage=engine.SLIPPAGE * mult, fee=engine.TAKER_FEE * mult)
    print('  {}x costs ({:.3f}% round trip): exp={:>7.2%} trim5={:>7.2%} CAGR={:>6.1%}'.format(
        mult, 2 * (engine.SLIPPAGE + engine.TAKER_FEE) * mult * 100,
        m.expectancy, m.trimmed_expectancy(0.05), m.account_cagr(0.20)))

print('\n' + '=' * 118)
print('LIVE DEFAULT DECAY CHECK: SMA(20,60) on 4h - the strategy currently paper trading')
print('=' * 118)


def sma_cross(params):
    fast, slow, stop_pct = params['fast'], params['slow'], params['stop_pct']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'f' not in state:
                c = [b['c'] for b in bars]
                state['f'] = engine.sma_series(c, fast)
                state['s'] = engine.sma_series(c, slow)
            f, s = state['f'], state['s']
            if None in (f[i], s[i], f[i - 1], s[i - 1]):
                return None
            px = bars[i]['c']
            if f[i - 1] <= s[i - 1] and f[i] > s[i]:
                return {'dir': 'long', 'stop': px * (1 - stop_pct), 'target': None, 'reason': 'x-up'}
            if f[i - 1] >= s[i - 1] and f[i] < s[i]:
                return {'dir': 'short', 'stop': px * (1 + stop_pct), 'target': None, 'reason': 'x-dn'}
            return None
        return sig
    return factory


live = {'fast': 20, 'slow': 60, 'stop_pct': 0.03}
for label, coins in (('BTC/ETH/SOL (the live basket)', ['BTC', 'ETH', 'SOL']),
                     ('all four incl HYPE', COINS)):
    per, m = pooled.pooled(sma_cross, live, coins, 61, interval='4h', name='live default')
    tr, te = pooled.pooled_split(m)
    print('\n  {}'.format(label))
    print('  ' + pooled.describe(m, 'POOLED'))
    print('  ' + pooled.describe(tr, '  train'))
    print('  ' + pooled.describe(te, '  test'))
    yr = pooled.pooled_yearly(m)
    print('  by year: ' + '  '.join('{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n)
                                    for y, r in yr))
    for c in coins:
        if c in per:
            print('  ' + pooled.describe(per[c], '  ' + c))
