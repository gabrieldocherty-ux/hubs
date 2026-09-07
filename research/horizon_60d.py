"""
What does 60 days actually look like, per strategy, in dollars?

The honest framing has to come first: there are ZERO closed trades. Everything
below is resampled from backtested trade distributions, so it is a statement
about what these strategies did historically, not a forecast.

And 60 days is short. At their real trade rates the strategies get between 3 and
18 trades in that window, which means the outcome is dominated by which handful
of trades happen to land - not by the edge. This script quantifies that rather
than hiding it: alongside the expected profit it reports the SPREAD, the chance
of finishing down, and how long you would actually have to run before a result
distinguishes a working strategy from a dead one.

Sizing: $16.25 per position (6.5% of the $250 account), which is what
config/settings.json currently uses. The 75/25 sleeve caps are checked but
rarely bind at these trade rates - concurrency averages ~3 positions in the
daily sleeve against 11 slots.
"""
import sys, random, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout
from strategies_macro import donchian_turtle

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
CAPITAL = 250.0
POS = 16.25
DAYS = 60
N_BOOT = 40000
random.seed(31)


def load():
    out = {}
    _, out['S3'] = pooled.pooled(volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5},
                                 COINS, 60, name='S3')
    _, out['D1'] = pooled.pooled(range_breakout,
                                 {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0},
                                 COINS, 60, name='D1')
    _, out['B1'] = run_basis.run(run_basis.BASE)
    _, out['M3'] = pooled.pooled(donchian_turtle,
                                 {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0},
                                 COINS, 85, name='M3')
    return out


def sim(result, days, n_boot=N_BOOT, pos=POS):
    """Bootstrap `days` of trading. Trade count is itself random (Poisson-ish),
    because pretending you get exactly the average number of trades understates
    the variance - and at these rates the trade count IS most of the variance."""
    rate = result.trades_per_year() * days / 365.25
    r = [t.pnl_pct for t in result.trades]
    out = []
    for _ in range(n_boot):
        # Poisson draw for how many trades actually occur in the window
        n, L, k, p = 0, 2.718281828 ** -rate, 0, 1.0
        while True:
            k += 1
            p *= random.random()
            if p <= L:
                n = k - 1
                break
            if k > 400:
                n = int(rate)
                break
        out.append(sum(random.choice(r) for _ in range(n)) * pos if n else 0.0)
    out.sort()
    return out, rate


def pct(v, p):
    return v[min(len(v) - 1, int(len(v) * p))]


BOOK = load()
LABEL = {'S3': 'Forced-Flow Continuation', 'D1': 'Range-Break Cascade',
         'B1': 'Basis Dislocation', 'M3': 'Donchian 55/20 (macro)'}

print('=' * 122)
print('PROJECTED 60-DAY P&L PER STRATEGY  -  $250 account, $16.25 per position')
print('  ZERO closed trades so far. This is resampled from backtests, not a forecast.')
print('=' * 122)
print('{:<6}{:<26}{:>9}{:>11}{:>11}{:>11}{:>11}{:>12}'.format(
    'id', 'strategy', 'trades', 'p5 (bad)', 'p25', 'MEDIAN', 'p95 (good)', 'P(down)'))
print('-' * 122)
tot = {}
for k in ('S3', 'B1', 'D1', 'M3'):
    d, rate = sim(BOOK[k], DAYS)
    tot[k] = d
    down = sum(1 for x in d if x < 0) / len(d)
    print('{:<6}{:<26}{:>9.1f}{:>11}{:>11}{:>11}{:>11}{:>12}'.format(
        k, LABEL[k], rate,
        '${:+.2f}'.format(pct(d, .05)), '${:+.2f}'.format(pct(d, .25)),
        '${:+.2f}'.format(pct(d, .50)), '${:+.2f}'.format(pct(d, .95)),
        '{:.0f}%'.format(down * 100)))

# whole book, respecting the 75/25 split (macro at quarter weight)
comb = []
for i in range(N_BOOT):
    comb.append(tot['S3'][random.randrange(N_BOOT)] * 0.375
                + tot['B1'][random.randrange(N_BOOT)] * 0.375
                + tot['M3'][random.randrange(N_BOOT)] * 0.25)
comb.sort()
down = sum(1 for x in comb if x < 0) / len(comb)
print('-' * 122)
print('{:<6}{:<26}{:>9}{:>11}{:>11}{:>11}{:>11}{:>12}'.format(
    '', 'WHOLE BOOK (75/25)', '', '${:+.2f}'.format(pct(comb, .05)),
    '${:+.2f}'.format(pct(comb, .25)), '${:+.2f}'.format(pct(comb, .50)),
    '${:+.2f}'.format(pct(comb, .95)), '{:.0f}%'.format(down * 100)))
print('{:<32}{:>9}{:>11}{:>11}{:>11}{:>11}'.format(
    '  as % of the $250 account', '',
    '{:+.1f}%'.format(pct(comb, .05) / CAPITAL * 100),
    '{:+.1f}%'.format(pct(comb, .25) / CAPITAL * 100),
    '{:+.1f}%'.format(pct(comb, .50) / CAPITAL * 100),
    '{:+.1f}%'.format(pct(comb, .95) / CAPITAL * 100)))

print("""
  Read the SPREAD, not the median. The gap between a bad and a good 60 days is
  many times the median itself - which is what "too short to conclude anything"
  looks like in numbers. A 60-day loss would not mean the strategies are broken,
  and a 60-day gain would not mean they work.""")

print('\n' + '=' * 122)
print('HOW LONG BEFORE A RESULT ACTUALLY MEANS SOMETHING?')
print('  Reporting the horizon at which the 5th percentile finally clears zero -')
print('  i.e. when even a bad run is profitable, so a loss becomes real evidence.')
print('=' * 122)
print('{:<6}{:<26}'.format('id', 'strategy') +
      ''.join('{:>13}'.format('{}d'.format(d)) for d in (60, 120, 180, 365, 730)))
for k in ('S3', 'B1', 'D1', 'M3'):
    row = '{:<6}{:<26}'.format(k, LABEL[k])
    for d in (60, 120, 180, 365, 730):
        dist, _ = sim(BOOK[k], d, n_boot=12000)
        row += '{:>13}'.format('${:+.0f}'.format(pct(dist, .05)))
    print(row)
print('\n  (each cell is the 5th-percentile outcome at that horizon - the point')
print('   where it turns positive is roughly when a losing run stops being normal)')

print('\n' + '=' * 122)
print('WHAT 60 DAYS IS ACTUALLY GOOD FOR')
print('=' * 122)
print("""  Not measuring profit - measuring whether the MACHINERY works:
    - do signals fire at the rate the backtest implies? (S3 ~11 trades, B1 ~18,
      D1 ~4, M3 ~3 in 60 days - a big miss means the live data path differs
      from the backtest's)
    - do fills land near the modelled price, and is real slippage close to the
      0.091-0.100% measured on the book?
    - do stops trigger when they should, and does the daily loss breaker behave?
    - does the $10 minimum-order guard ever fire?
  Those are answerable in 60 days. "Is the edge real" is not.""")
