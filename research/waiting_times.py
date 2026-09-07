"""
How long do you actually wait?

Two different waits, and they get confused with each other:

  WAIT FOR A TRADE  - calendar time between one signal and the next on a given
                      coin. This is what "nothing is happening" feels like.
  WAIT IN A TRADE   - holding period once filled, already known at ~10 days.

Plus the two that actually matter for someone watching a new account:

  TIME TO FIRST     - from a standing start, how long until anything happens at
                      all, across the whole basket.
  DROUGHTS          - the worst historical gap, because that is the one that
                      makes a person conclude the bot is broken when it is not.

All measured on real signal timestamps rather than assumed from trade counts -
an average of 66 trades a year does not mean one every 5.5 days, because
signals cluster in volatile periods and vanish in quiet ones.
"""
import sys, datetime, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout
from strategies_macro import donchian_turtle

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']


def per_coin(fn, params, warm, coins=COINS, interval='1d'):
    per, m = pooled.pooled(fn, params, coins, warm, interval=interval, name='x')
    return per, m


SETS = [
    ('S3 forced-flow', volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}, 60, COINS),
    ('D1 range-break', range_breakout,
     {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}, 60, COINS),
    ('M3 Donchian (macro)', donchian_turtle,
     {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0}, 85, COINS),
]

print('=' * 116)
print('1. WAIT BETWEEN TRADES, PER COIN  (calendar days from one entry to the next)')
print('=' * 116)
print('  {:<22}{:<7}{:>8}{:>12}{:>12}{:>12}{:>14}'.format(
    'strategy', 'coin', 'trades', 'median gap', 'mean gap', 'p90 gap', 'LONGEST'))
book = {}
for label, fn, params, warm, coins in SETS:
    per, m = per_coin(fn, params, warm, coins)
    book[label] = (per, m)
    for c in coins:
        r = per.get(c)
        if not r or r.n < 2:
            continue
        ts = sorted(t.entry_t for t in r.trades)
        gaps = [(b - a) / 86_400_000 for a, b in zip(ts, ts[1:])]
        print('  {:<22}{:<7}{:>8}{:>12}{:>12}{:>12}{:>14}'.format(
            label, c, r.n, '{:.0f}d'.format(st.median(gaps)),
            '{:.0f}d'.format(st.mean(gaps)),
            '{:.0f}d'.format(sorted(gaps)[int(len(gaps) * .90)]),
            '{:.0f}d'.format(max(gaps))))
    print()

print('=' * 116)
print('2. THE WHOLE BASKET - how long between ANY trade, anywhere?')
print('   (this is what actually determines whether the bot looks alive)')
print('=' * 116)
for label, (per, m) in book.items():
    ts = sorted(t.entry_t for t in m.trades)
    if len(ts) < 2:
        continue
    gaps = [(b - a) / 86_400_000 for a, b in zip(ts, ts[1:])]
    print('  {:<24} {} trades across {} coins | median gap {:.1f}d, p90 {:.0f}d, '
          'longest {:.0f}d'.format(
              label, m.n, len(per), st.median(gaps),
              sorted(gaps)[int(len(gaps) * .90)], max(gaps)))

allts = sorted(t.entry_t for _, (per, m) in book.items() for t in m.trades)
gaps = [(b - a) / 86_400_000 for a, b in zip(allts, allts[1:])]
print('\n  ALL THREE TOGETHER: {} trades | median gap {:.1f}d, p90 {:.0f}d, longest {:.0f}d'.format(
    len(allts), st.median(gaps), sorted(gaps)[int(len(gaps) * .90)], max(gaps)))

print('\n' + '=' * 116)
print('3. FROM A STANDING START - how long until the FIRST trade?')
print('   Simulated by dropping a start date on every day of history and')
print('   measuring the wait to the next signal anywhere in the basket.')
print('=' * 116)
waits = []
for i in range(0, len(allts) - 1):
    # every real day between signals contributes a possible start point
    start = allts[i]
    nxt = allts[i + 1]
    span_days = int((nxt - start) / 86_400_000)
    for d in range(max(1, span_days)):
        waits.append(span_days - d)
waits.sort()
if waits:
    print('  {:<28}{:>12}'.format('you wait at most', 'with probability'))
    for p in (0.25, 0.50, 0.75, 0.90, 0.95, 0.99):
        print('  {:<28}{:>12}'.format(
            '{:.0f} days'.format(waits[int(len(waits) * p)]), '{:.0%}'.format(p)))
    print('\n  mean wait {:.1f} days, worst {:.0f} days'.format(st.mean(waits), max(waits)))

print('\n' + '=' * 116)
print('4. HOW MUCH OF THE TIME IS THE BOT ACTUALLY IN THE MARKET?')
print('=' * 116)
print('  {:<24}{:>14}{:>16}{:>18}'.format(
    'strategy', 'avg hold', 'exposure', 'days flat per year'))
for label, (per, m) in book.items():
    exp = m.exposure_pct()
    print('  {:<24}{:>14}{:>16}{:>18}'.format(
        label, '{:.1f}d'.format(m.avg_days_held), '{:.0%}'.format(min(1.0, exp)),
        '{:.0f}'.format(365 * max(0.0, 1 - min(1.0, exp)))))
print("""
  Exposure over 100% means several coins are held at once, not that the bot is
  levered - each coin has its own position.""")

print('\n' + '=' * 116)
print('5. WHAT THIS MEANS FOR WATCHING A NEW ACCOUNT')
print('=' * 116)
print("""  The waits above are the reason a quiet week means nothing. Concretely, over
  a 60-day window the basket should produce roughly:
      S3  ~11 trades      D1  ~4 trades      M3  ~3 trades
  and the LONGEST historical droughts show stretches several times that long
  with nothing at all. A month of silence is well inside normal - it is not
  evidence the bot has stopped, which is why the hourly brief reports a stale
  summary file separately from reporting no trades.""")
