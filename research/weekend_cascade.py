"""
Does the forced-flow edge get stronger when the book is thinner?

HYPOTHESIS (derived from the validated mechanism, not from scanning): crypto
trades 24/7, but the people who provide liquidity to it do not. Market makers
run smaller inventory over weekends, institutional desks are closed, and
traditional-finance hedging venues are shut. So the SAME amount of forced
liquidation flow should move price further on a Saturday than on a Wednesday -
a thinner book converts the same forced sell into a bigger cascade.

That is a falsifiable prediction from a mechanism this project has already
validated, which makes it different from asking "which day of the week is
best". The distinction matters: testing all seven days and keeping the winner is
data mining with a ~30% chance of a spurious hit. This test has a direction
specified in advance (weekend > weekday) and a stated reason.

THREE LEVELS, because a mechanism should hold at every step, not just the last:
  1. Is the book actually thinner at weekends? (the premise)
  2. Are cascade events bigger at weekends? (the intermediate effect)
  3. Do cascade TRADES pay better at weekends? (the tradable claim)
If 3 holds while 1 and 2 do not, the result is a coincidence wearing a
mechanism's clothes and should be rejected regardless of how good it looks.
"""
import sys, datetime, statistics as st
sys.path.insert(0, 'research')
import engine, pooled
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']


def is_weekend(ms):
    return datetime.datetime.utcfromtimestamp(ms / 1000).weekday() >= 5


print('=' * 112)
print('LEVEL 1 - PREMISE: is the market actually quieter at weekends?')
print('=' * 112)
print('{:<7}{:>16}{:>16}{:>10}{:>16}{:>16}{:>10}'.format(
    'coin', 'wkday $vol', 'wkend $vol', 'ratio', 'wkday range%', 'wkend range%', 'ratio'))
prem = []
for c in COINS:
    bars, _ = pooled.load(c)
    wd = [b for b in bars if not is_weekend(b['t'])]
    we = [b for b in bars if is_weekend(b['t'])]
    if not wd or not we:
        continue
    vwd = st.median([b['v'] * b['c'] for b in wd])
    vwe = st.median([b['v'] * b['c'] for b in we])
    rwd = st.median([(b['h'] - b['l']) / b['c'] for b in wd]) * 100
    rwe = st.median([(b['h'] - b['l']) / b['c'] for b in we]) * 100
    prem.append((vwe / vwd, rwe / rwd))
    print('{:<7}{:>16,.0f}{:>16,.0f}{:>10.2f}{:>16.2f}{:>16.2f}{:>10.2f}'.format(
        c, vwd, vwe, vwe / vwd, rwd, rwe, rwe / rwd))
print('\n  Volume ratio < 1 means weekends really are thinner (premise holds).')
print('  Range ratio < 1 means weekends are also CALMER, which cuts against the')
print('  idea that thin books amplify moves - worth noting either way.')

print('\n' + '=' * 112)
print('LEVEL 2 - INTERMEDIATE: are cascade EVENTS bigger at weekends?')
print('   (a cascade event = a day whose range >= 2x ATR, the D1 trigger)')
print('=' * 112)
print('{:<7}{:>12}{:>12}{:>14}{:>14}'.format('coin', 'wkday n', 'wkend n', 'wkend share', 'expected 28.6%'))
for c in COINS:
    bars, _ = pooled.load(c)
    atr = engine.atr_series(bars, 14)
    ev = [b for i, b in enumerate(bars)
          if atr[i] and (b['h'] - b['l']) >= 2.0 * atr[i]]
    if not ev:
        continue
    we = sum(1 for b in ev if is_weekend(b['t']))
    print('{:<7}{:>12}{:>12}{:>14}{:>14}'.format(
        c, len(ev) - we, we, '{:.1%}'.format(we / len(ev)), '2 of 7 days'))
print('\n  If thin books amplified cascades, weekends would hold MORE than their')
print('  28.6% share of cascade days. Less than that means the opposite.')

print('\n' + '=' * 112)
print('LEVEL 3 - TRADABLE: do cascade trades entered at weekends pay better?')
print('=' * 112)
for label, fn, params in (
        ('S3 forced-flow', volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}),
        ('D1 range-break', range_breakout,
         {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0})):
    _, m = pooled.pooled(fn, params, COINS, 60, name=label)
    we = [t for t in m.trades if is_weekend(t.entry_t)]
    wd = [t for t in m.trades if not is_weekend(t.entry_t)]
    print('\n{}  (pooled n={})'.format(label, m.n))
    for name, ts in (('weekday entry', wd), ('weekend entry', we)):
        if not ts:
            print('  {:<16} none'.format(name))
            continue
        e = st.mean([t.pnl_pct for t in ts])
        w = sum(1 for t in ts if t.won) / len(ts)
        med = st.median([t.pnl_pct for t in ts])
        print('  {:<16} n={:<4} wr={:>5.1%} exp={:>7.2%} median={:>7.2%}'.format(
            name, len(ts), w, e, med))
    if we and wd:
        d = st.mean([t.pnl_pct for t in we]) - st.mean([t.pnl_pct for t in wd])
        # crude two-sample check: is the gap large next to its own noise?
        pooled_sd = st.pstdev([t.pnl_pct for t in m.trades])
        se = pooled_sd * ((1 / len(we) + 1 / len(wd)) ** 0.5)
        print('  weekend minus weekday: {:+.2f}%  (standard error {:.2f}%, '
              '{:.1f} SE from zero)'.format(d * 100, se * 100, abs(d / se) if se else 0))

print('\n' + '=' * 112)
print('VERDICT GUIDE')
print('=' * 112)
print("""  A result worth acting on needs all three levels pointing the same way AND a
  weekend-minus-weekday gap of at least ~2 standard errors. Anything less is a
  subgroup difference of the kind that appears by chance whenever a sample is
  split, and this project has already rejected several of those.""")
