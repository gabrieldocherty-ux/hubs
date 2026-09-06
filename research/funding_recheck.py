"""
Re-test the vault's funding-crowding lead in ITS OWN form before rejecting it.

The vault (2026-09-04 update 8) called this "the most promising new candidate":
short when trailing-24h annualized funding hits the top decile, exit on funding
unwinding to the median / a stop / a 7-day timeout, on 4h bars, short-only. It
held up on ETH and SOL and decayed to breakeven on BTC, and was explicitly left
pending a walk-forward.

My daily both-sides version failed. That is not the same test, so it is not yet
a refutation of their claim. This runs the original: 4h bars, short-only, 24h
funding window, 7-day timeout.

One methodological difference is kept deliberately, because it is a correctness
fix rather than a variation: the decile threshold is computed from a TRAILING
window, not the full sample. A full-sample decile is lookahead - on any given
day it uses funding readings that had not happened yet. If the original result
depended on that, the original result was measuring the future.
"""
import sys, datetime
sys.path.insert(0, 'research')
import engine, pooled
from strategies_daily import funding_crowding

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']


def report(label, per, merged):
    if merged.n == 0:
        print('\n{}: NO TRADES'.format(label))
        return
    tr, te = pooled.pooled_split(merged)
    print('\n' + '-' * 104)
    print(label)
    print('  ' + pooled.describe(merged, 'POOLED'))
    print('  ' + pooled.describe(tr, '  train'))
    print('  ' + pooled.describe(te, '  test'))
    yr = pooled.pooled_yearly(merged)
    print('  by year: ' + '  '.join('{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n)
                                    for y, r in yr))
    for c in COINS:
        if c in per:
            print('  ' + pooled.describe(per[c], '  ' + c))


print('=' * 104)
print("ORIGINAL FORM: 4h bars, SHORT-ONLY, top-decile funding, 7d timeout")
print('=' * 104)
p = {'fund_n': 1, 'pct': 0.90, 'pct_win': 540, 'atr_mult': 3.0, 'max_hold': 42,
     'funding': None, 'both_sides': False}
per, merged = pooled.pooled(funding_crowding, p, COINS, 560, extended=False,
                            interval='4h', name='fund-crowd 4h short-only',
                            allow_long=False)
report('D3-orig  4h short-only, 24h funding window, 7d timeout', per, merged)

print('\n' + '=' * 104)
print('VARIATIONS - is the failure specific to one setting, or general?')
print('=' * 104)
for label, pp, iv, warm, kw in [
    ('4h short-only, top 5% funding', dict(p, pct=0.95), '4h', 560, {'allow_long': False}),
    ('4h short-only, top 20% funding', dict(p, pct=0.80), '4h', 560, {'allow_long': False}),
    ('4h short-only, 3d funding window', dict(p, fund_n=3), '4h', 560, {'allow_long': False}),
    ('4h BOTH sides, top decile', dict(p, both_sides=True), '4h', 560, {}),
    ('1d short-only, top decile, 7d hold', dict(p, fund_n=1, max_hold=7, pct_win=180),
     '1d', 200, {'allow_long': False}),
]:
    per2, m2 = pooled.pooled(funding_crowding, pp, COINS, warm, extended=False,
                             interval=iv, name=label, **kw)
    if m2.n:
        tr2, te2 = pooled.pooled_split(m2)
        print('  {:<38} n={:<4} exp={:>7.2%}  train={:>7.2%}  test={:>7.2%}  acctCAGR={:>6.1%}'.format(
            label, m2.n, m2.expectancy, tr2.expectancy if tr2 else 0,
            te2.expectancy if te2 else 0, m2.account_cagr(0.20)))
    else:
        print('  {:<38} no trades'.format(label))
