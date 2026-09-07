"""
Four ways to make more money here, and only one of them is free.

$3.49 median over 60 days is 1.4% of a $250 account. The percentage is on
target; the dollar figure is small because the capital is small. Worth being
precise about which lever does what, because three of the four trade something
away and one does not:

  1. MORE CAPITAL      - scales dollars exactly, changes risk% not at all.
                         Entirely Gabe's call; nothing to research.
  2. BIGGER POSITIONS  - scales return AND drawdown together. Available now,
                         bounded by the 20% rail. Not free.
  3. MORE BREADTH      - more independent bets tightens the outcome
                         distribution, which then JUSTIFIES a larger position
                         size at the same risk. This is the only lever that
                         improves the return-to-risk ratio rather than trading
                         one for the other.
  4. BETTER EDGE       - higher expectancy per trade. Hardest, slowest, and the
                         research record says most attempts fail.

This quantifies 1-3 so the trade-offs are visible. Lever 3 is then pursued
properly in coin_expansion.py, because it is the one worth work.
"""
import sys, random, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_macro import donchian_turtle

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
random.seed(41)
N = 20000


def book():
    _, s3 = pooled.pooled(volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5},
                          COINS, 60, name='S3')
    _, b1 = run_basis.run(run_basis.BASE)
    _, m3 = pooled.pooled(donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0},
                          COINS, 85, name='M3')
    return [(s3, 0.375), (b1, 0.375), (m3, 0.25)]


def year(components, size, n_boot=N):
    out = []
    for _ in range(n_boot):
        eq = 1.0
        for r, w in components:
            n = max(0, int(round(r.trades_per_year())))
            pnl = [t.pnl_pct for t in r.trades]
            if not pnl or n == 0:
                continue
            for _ in range(n):
                eq *= (1 + random.choice(pnl) * size * w)
            if eq <= 0.01:
                eq = 0.01
        out.append(eq - 1)
    out.sort()
    return out


def p(v, q):
    return v[min(len(v) - 1, int(len(v) * q))]


BOOK = book()

print('=' * 112)
print('LEVER 1 - MORE CAPITAL   (same 6.5% sizing, same risk, same percentages)')
print('=' * 112)
d = year(BOOK, 0.065)
print('  {:<14}{:>16}{:>16}{:>16}{:>16}'.format('capital', '60d median', '1yr p5', '1yr MEDIAN', '1yr p95'))
for cap in (250, 500, 1000, 2500, 5000, 10000):
    print('  {:<14}{:>16}{:>16}{:>16}{:>16}'.format(
        '${:,}'.format(cap),
        '${:,.2f}'.format(cap * p(d, .50) * 60 / 365.25),
        '${:,.0f}'.format(cap * p(d, .05)),
        '${:,.0f}'.format(cap * p(d, .50)),
        '${:,.0f}'.format(cap * p(d, .95))))
print("""
  Nothing about the strategies changes. This is the only lever that raises the
  dollar figure without raising the chance of a bad outcome - the percentages
  in every row are identical. Whether the account should be larger is a
  question about Gabe's risk capital, not about trading.""")

print('\n' + '=' * 112)
print('LEVER 2 - BIGGER POSITIONS   ($250 account. Return and drawdown move together.)')
print('=' * 112)
print('  {:<12}{:>13}{:>13}{:>13}{:>13}{:>12}{:>10}'.format(
    'size', '60d median', '1yr p5', '1yr MEDIAN', '1yr p95', 'P(down yr)', 'vs rail'))
for size in (0.065, 0.10, 0.15, 0.20, 0.30):
    dd = year(BOOK, size)
    down = sum(1 for x in dd if x < 0) / len(dd)
    rail = 'OK' if size <= 0.20 else 'OVER 20%'
    print('  {:<12}{:>13}{:>13}{:>13}{:>13}{:>12}{:>10}'.format(
        '{:.1f}% (${:.2f})'.format(size * 100, 250 * size),
        '${:.2f}'.format(250 * p(dd, .50) * 60 / 365.25),
        '${:.0f}'.format(250 * p(dd, .05)),
        '${:.0f}'.format(250 * p(dd, .50)),
        '${:.0f}'.format(250 * p(dd, .95)),
        '{:.0f}%'.format(down * 100), rail))
print("""
  Real, immediate, and not free: this buys return with drawdown one-for-one.
  Note the $10 exchange minimum sets a floor here, not a ceiling - at 6.5% a
  position is $16.25, and there is little room BELOW before orders get refused.""")

print('\n' + '=' * 112)
print('LEVER 3 - MORE BREADTH   (what happens if the same edge runs on more coins)')
print('=' * 112)
print('  Modelled by scaling trade COUNT while holding per-trade expectancy fixed -')
print('  which is exactly what adding coins does if the mechanism is universal.')
print('  {:<20}{:>13}{:>13}{:>13}{:>13}{:>12}'.format(
    'universe', 'trades/yr', '1yr p5', '1yr MEDIAN', '1yr p95', 'P(down yr)'))
for mult, label in ((1.0, '4 coins (today)'), (1.5, '6 coins'), (2.0, '8 coins'),
                    (3.0, '12 coins')):
    scaled = []
    for r, w in BOOK:
        c = engine.Result(coin='POOL', name=r.name)
        c.trades = r.trades
        c.start_t, c.end_t = r.start_t, r.end_t
        c._mult = mult
        scaled.append((c, w))
    # scale trade count by replaying the sampler with more draws
    out = []
    for _ in range(N):
        eq = 1.0
        for r, w in scaled:
            n = max(0, int(round(r.trades_per_year() * mult)))
            pnl = [t.pnl_pct for t in r.trades]
            for _ in range(n):
                eq *= (1 + random.choice(pnl) * 0.065 * w)
            if eq <= 0.01:
                eq = 0.01
        out.append(eq - 1)
    out.sort()
    down = sum(1 for x in out if x < 0) / len(out)
    tpy = sum(r.trades_per_year() * mult for r, _ in scaled)
    print('  {:<20}{:>13.0f}{:>13}{:>13}{:>13}{:>12}'.format(
        label, tpy, '${:.0f}'.format(250 * p(out, .05)),
        '${:.0f}'.format(250 * p(out, .50)), '${:.0f}'.format(250 * p(out, .95)),
        '{:.0f}%'.format(down * 100)))
print("""
  The median rises roughly in proportion, but the important column is p5: more
  independent bets pull the BAD case up faster than the median, because the
  outcome distribution tightens. A tighter distribution is what justifies a
  larger position size at unchanged risk - which is why breadth compounds with
  lever 2 instead of merely adding to it.

  CAVEAT this model does not capture: those extra coins are less liquid and
  highly correlated with the existing four, so real breadth gain is smaller
  than the arithmetic suggests. Whether the edge survives on them at all is an
  empirical question - tested properly in coin_expansion.py, not assumed here.""")
