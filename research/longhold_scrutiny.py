"""
Is the long-hold improvement a better edge, or just more market beta?

Extending S3's hold from 10 to 30 days raised the trimmed expectancy from
+1.49% to +3.48%. Before treating that as an improvement, three things have to
be ruled out, because each would produce exactly the same number for the wrong
reason:

  1. BETA. Crypto drifted upward across this sample. Holding three times longer
     collects three times more drift. If the gain sits entirely in LONGS while
     shorts are flat or worse, the strategy has not got better at detecting
     cascades - it has just become a slower way to be long crypto, and would
     hand it all back in a bear market.

  2. IDENTITY. A 30-day hold is not a daily-bar strategy any more. If its
     positions now coincide with the trend family, it has migrated into a bet
     the book already has - and it is sitting in the DAILY sleeve while
     behaving like the macro one, which would quietly break the 75/25 split.

  3. FUNDING. Thirty days of funding is three times ten days of it. The engine
     charges real funding, so this is already in the numbers - but it is worth
     seeing the size, because it is the cost that scales with hold length while
     execution cost does not.

Also checked: whether the hold-length curve is smooth. The sweep was NOT
monotonic (10d +1.49%, 14d +1.14%, 20d +1.61%, 30d +3.48%, 45d +3.09%). A dip
at 14 then a jump at 30 is not what a real "longer is better" relationship
looks like, and that non-monotonicity is itself evidence about how much of this
is noise.
"""
import sys, statistics as st
sys.path.insert(0, 'research')
import engine, pooled
from exit_variants import forced_flow_exit
from strategies_macro import tsmom, donchian_turtle

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
BASE = {'vol_mult': 1.5, 'atr_mult': 2.5}

print('=' * 116)
print('1. BETA CHECK - is the gain in longs only?')
print('=' * 116)
print('  {:<20}{:>8}{:>11}{:>11}{:>8}{:>11}{:>11}'.format(
    'hold', 'long n', 'long exp', 'long trim', 'short n', 'short exp', 'short trim'))
for h in (10, 20, 30, 45):
    _, m = pooled.pooled(forced_flow_exit, dict(BASE, exit='fixed', hold=h),
                         COINS, 60, name='h')
    L = engine.Result(coin='L', name='L')
    L.trades = [t for t in m.trades if t.direction == 'long']
    S = engine.Result(coin='S', name='S')
    S.trades = [t for t in m.trades if t.direction == 'short']
    print('  {:<20}{:>8}{:>11}{:>11}{:>8}{:>11}{:>11}'.format(
        'fixed {}d'.format(h), L.n,
        '{:+.2f}%'.format(L.expectancy * 100) if L.n else '-',
        '{:+.2f}%'.format(L.trimmed_expectancy(0.05) * 100) if L.n else '-',
        S.n,
        '{:+.2f}%'.format(S.expectancy * 100) if S.n else '-',
        '{:+.2f}%'.format(S.trimmed_expectancy(0.05) * 100) if S.n else '-'))
print("""
  If the short side stays positive as the hold lengthens, the improvement is
  not drift. If shorts deteriorate while longs carry everything, it is.""")

print('\n' + '=' * 116)
print('2. IDENTITY CHECK - has a 30d-hold S3 become the trend family?')
print('   (fraction of co-invested bars on the SAME side; 0.7+ means one bet)')
print('=' * 116)
print('  {:<10}{:>16}{:>16}{:>16}{:>16}'.format(
    'coin', 'S3-10d vs TSMOM', 'S3-30d vs TSMOM', 'S3-10d vs Donch', 'S3-30d vs Donch'))
for c in COINS:
    bars, fund = pooled.load(c)
    row = '  {:<10}'.format(c)
    s10, _ = pooled.position_series(bars, forced_flow_exit,
                                    dict(BASE, exit='fixed', hold=10), c, fund, 60)
    s30, _ = pooled.position_series(bars, forced_flow_exit,
                                    dict(BASE, exit='fixed', hold=30), c, fund, 60)
    tm, _ = pooled.position_series(bars, tsmom, {'look': 120, 'atr_mult': 4.0}, c, fund, 150)
    dn, _ = pooled.position_series(bars, donchian_turtle,
                                   {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0}, c, fund, 85)
    for a, b in ((s10, tm), (s30, tm), (s10, dn), (s30, dn)):
        ov, n = pooled.overlap(a, b)
        row += '{:>16}'.format('-' if ov is None else '{:.2f} (n{})'.format(ov, n))
    print(row)

print('\n' + '=' * 116)
print('3. FUNDING COST - what does the longer hold actually pay?')
print('=' * 116)
print('  {:<16}{:>14}{:>18}{:>18}'.format('hold', 'avg days', 'funding/trade', 'funding/year'))
for h in (10, 20, 30, 45):
    _, m = pooled.pooled(forced_flow_exit, dict(BASE, exit='fixed', hold=h),
                         COINS, 60, name='h')
    f = sum(t.funding_pct for t in m.trades) / m.n
    print('  {:<16}{:>14.1f}{:>18}{:>18}'.format(
        'fixed {}d'.format(h), m.avg_days_held,
        '{:+.3f}%'.format(f * 100), '{:+.2f}%'.format(f * m.trades_per_year() * 100)))

print('\n' + '=' * 116)
print('4. SMOOTHNESS - is hold length a plateau or a spike?')
print('=' * 116)
print('  {:<12}{:>10}{:>11}{:>11}{:>11}{:>11}'.format(
    'hold', 'n', 'exp', 'trim5', 'train', 'test'))
prev = None
for h in (8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 60):
    _, m = pooled.pooled(forced_flow_exit, dict(BASE, exit='fixed', hold=h),
                         COINS, 60, name='h')
    if not m.n:
        continue
    tr, te = pooled.pooled_split(m)
    t5 = m.trimmed_expectancy(0.05)
    flag = ''
    if prev is not None and t5 < prev:
        flag = '  <- down'
    prev = t5
    print('  {:<12}{:>10}{:>11}{:>11}{:>11}{:>11}{}'.format(
        '{}d'.format(h), m.n, '{:+.2f}%'.format(m.expectancy * 100),
        '{:+.2f}%'.format(t5 * 100),
        '{:+.2f}%'.format(tr.expectancy * 100) if tr else '-',
        '{:+.2f}%'.format(te.expectancy * 100) if te else '-', flag))
print("""
  A real relationship climbs smoothly. Repeated reversals mean the sweep is
  reading noise, and whichever value looks best is the luckiest draw rather
  than the right answer.""")
