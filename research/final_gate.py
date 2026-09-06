"""
Final gate on the survivors, plus the overlap question that decides whether
there are three strategies here or one.

Survivors going in:
  D1  range breakout with a range>=2xATR forced-flow filter   (n=74)
  S3  volume-spike continuation, no breakout condition        (n=202)
  S4  breakout aligned with the 100d trend                    (n=62)

All three are expressions of the same underlying claim - that forced flow on a
leveraged venue continues short-term. If they hold the same positions, that is
ONE strategy and must be reported as one. S3 is the interesting case: it needs
no breakout at all, so it may be catching a different population of events.
"""
import sys
sys.path.insert(0, 'research')
import engine, pooled
from strategies_daily import range_breakout
from strategies_batch2 import volume_spike, trend_aligned_breakout

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
D1P = {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}
S3P = {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}
S4P = {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0, 'trend_n': 100,
       'invert': False}

print('=' * 100)
print('OVERLAP: are D1 / S3 / S4 the same trade?')
print('=' * 100)
for coin in COINS:
    bars, fund = pooled.load(coin)
    s = {}
    s['D1'], _ = pooled.position_series(bars, range_breakout, D1P, coin, fund, 60)
    s['S3'], _ = pooled.position_series(bars, volume_spike, S3P, coin, fund, 60)
    s['S4'], _ = pooled.position_series(bars, trend_aligned_breakout, S4P, coin, fund, 130)
    print('\n{}'.format(coin))
    for a in s:
        row = '  {:<5}'.format(a)
        for b in s:
            ov, n = pooled.overlap(s[a], s[b])
            row += '{:>16}'.format('-' if ov is None else '{:.2f} (n={})'.format(ov, n))
        print(row + '   [' + ' '.join('{:>6}'.format(x) for x in s) + ']')

print('\n\n' + '=' * 118)
print('S3 VOLUME-SPIKE CONTINUATION - full gate (the highest-sample survivor)')
print('=' * 118)


def s3_row(label, p, **kw):
    per, m = pooled.pooled(volume_spike, p, COINS, 60, name='S3', **kw)
    if m.n == 0:
        print('  {:<40} no trades'.format(label))
        return 0
    tr, te = pooled.pooled_split(m)
    print('  {:<40} n={:<4} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%} train={:>7.2%} test={:>7.2%} CAGR={:>6.1%}'.format(
        label, m.n, m.win_rate, m.expectancy, m.trimmed_expectancy(0.05),
        tr.expectancy if tr else 0, te.expectancy if te else 0, m.account_cagr(0.20)))
    return m.trimmed_expectancy(0.05)


print('\nPARAMETER NEIGHBOURHOOD')
print('  ' + 'baseline vol>=1.5x, hold 10d, stop 2.5xATR'.ljust(40) + '')
s3_row('  BASELINE', S3P)
res = []
for key, vals in [('vol_mult', [1.2, 1.3, 1.75, 2.0, 2.5]),
                  ('hold', [5, 7, 8, 12, 15, 20]),
                  ('atr_mult', [1.5, 2.0, 3.0, 4.0])]:
    for v in vals:
        p = dict(S3P)
        p[key] = v
        res.append(s3_row('  {}={}'.format(key, v), p))
print('  -> {}/{} perturbations positive'.format(sum(1 for r in res if r > 0), len(res)))

print('\nCOST STRESS')
for mult in (1, 2, 3):
    s3_row('  {}x costs'.format(mult), S3P, slippage=engine.SLIPPAGE * mult,
           fee=engine.TAKER_FEE * mult)

print('\nPER COIN + BY YEAR (tradeable window)')
per, m = pooled.pooled(volume_spike, S3P, COINS, 60, name='S3')
print('  ' + pooled.describe(m, 'POOLED'))
yr = pooled.pooled_yearly(m)
print('  by year: {}/{} positive   '.format(sum(1 for _, r in yr if r.expectancy > 0), len(yr)) +
      '  '.join('{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n) for y, r in yr))
for c in COINS:
    if c in per and per[c].n:
        print('  ' + pooled.describe(per[c], c))

print('\nEXTENDED WINDOW 2020+ (independent data)')
per_e, m_e = pooled.pooled(volume_spike, S3P, COINS, 60, extended=True, name='S3')
tr, te = pooled.pooled_split(m_e)
print('  ' + pooled.describe(m_e, 'POOLED'))
print('  ' + pooled.describe(tr, '  train'))
print('  ' + pooled.describe(te, '  test'))
yr = pooled.pooled_yearly(m_e)
print('  by year: {}/{} positive   '.format(sum(1 for _, r in yr if r.expectancy > 0), len(yr)) +
      '  '.join('{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n) for y, r in yr))
for c in COINS:
    if c in per_e and per_e[c].n:
        print('  ' + pooled.describe(per_e[c], c))
