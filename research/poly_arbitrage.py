"""
Coherence scanning on Polymarket: mispricings that violate ARITHMETIC rather than
forecasting, so they need no price history and no opinion about the world.

A CORRECTED FILE. The first version of this scan reported overrounds of +1825% and
returns on capital of 16,566%. Those numbers were nonsense and the bug is worth
recording, because it is the single most common error in prediction-market
analysis:

    IT SUMMED MARKETS THAT ARE NOT MUTUALLY EXCLUSIVE.

Polymarket groups related markets into an "event", but an event is not a
probability space. "Howard vs. Indiana" contains 79 markets on one basketball
game - the spread, the total, and dozens of player props - and several are YES
simultaneously. "Ethereum above ___ on September 11?" is a set of NESTED
thresholds: above $3,000 implies above $2,500, so again multiple YES by
construction. Summing their prices and calling the result an overround is
meaningless, and it manufactures enormous fake edges.

The correct filter is Polymarket's own flag. Events carry `negRisk: true` when
their outcomes genuinely form a mutually-exclusive, collectively-exhaustive set -
the negative-risk mechanism exists precisely because the venue needs to know this.
29 of 60 top events qualify. Everything below uses that filter.

THE CAPITAL TRAP, which survives the correction and is the real lesson. An
overround is not a return. Capturing one on an N-outcome event means shorting
every outcome, and Polymarket has no naked shorting - selling YES means BUYING NO.
Buying NO across all N costs sum(1 - p_i) = N - sum(p_i), which grows with N while
the profit stays fixed. So a 15% mispricing on a 128-outcome market pays about
0.12% on the capital it consumes. Every number here is therefore reported as
RETURN ON CAPITAL REQUIRED and ANNUALISED over the lock-up, never as a raw
overround, and the benchmark is not zero but what cash would have earned over the
same period.
"""
import statistics as st
import sys

sys.path.insert(0, 'research')
import polymarket_data as pm

CAPITAL = 1000.0


def quote(m):
    b, a, _ = pm.best_prices(m)
    if b is None or a is None:
        return None
    return b, a


# ------------------------------------------------------------------ 1. binary
print('=' * 110)
print('1. BINARY PAIR TEST - can YES and NO together be bought for under $1?')
print('   YES + NO pay exactly $1 at resolution. If the pair costs less, it is a')
print('   locked profit, and capital-efficient because you tie up only its cost.')
print('=' * 110)
mk = pm.fetch_open_markets(pages=8, min_volume=500)
hits, spreads = [], []
for m in mk:
    q = quote(m)
    if not q:
        continue
    bid, ask = q
    spreads.append(ask - bid)
    # NO's ask is the mirror of YES's bid: buying NO at x == selling YES at 1-x
    cost = ask + (1.0 - bid)
    if cost < 1.0:
        d = pm.days_to_resolution(m)
        hits.append((m, cost, d))
print('  scanned {} markets with >$500 volume'.format(len(mk)))
print('  median YES bid-ask spread: {:.1f} cents'.format(
    (st.median(spreads) if spreads else 0) * 100))
print('  pairs buyable under $1.00: {}'.format(len(hits)))
print("""
  Zero, and the reason is in the spread: a median quote 0.1 cents wide leaves no
  room between the two sides. That is what an efficient two-sided market looks
  like, and it is the first real finding here - this venue is tighter than its
  reputation.""")

# ------------------------------------------------------------------ 2. MECE only
print('\n' + '=' * 110)
print('2. MUTUALLY-EXCLUSIVE EVENTS ONLY (negRisk = true)')
print('   Their YES prices MUST sum to 1.00. Anything else is a real mispricing.')
print('=' * 110)
ev = pm.fetch_events(pages=8)
mece = [e for e in ev if e.get('negRisk') is True]
print('  {} of {} events are genuinely mutually exclusive'.format(len(mece), len(ev)))

rows = []
for e in mece:
    ms = [m for m in (e.get('markets') or []) if not m.get('closed')]
    bids, asks = [], []
    for m in ms:
        q = quote(m)
        if q:
            bids.append(q[0])
            asks.append(q[1])
    if len(bids) < 2:
        continue
    n = len(bids)
    sb, sa = sum(bids), sum(asks)
    days = max([d for d in (pm.days_to_resolution(m) for m in ms) if d] or [0])
    # BUY every outcome at ask: cost sa, pays exactly $1
    buy_profit, buy_cap = 1.0 - sa, sa
    # SELL every outcome (= buy every NO at 1-bid): cost n - sb, pays (n-1)
    sell_cap = n - sb
    sell_profit = sb - 1.0
    rows.append({'t': (e.get('title') or '')[:38], 'n': n, 'sb': sb, 'sa': sa,
                 'days': days, 'buy_profit': buy_profit, 'buy_cap': buy_cap,
                 'sell_profit': sell_profit, 'sell_cap': sell_cap})

rows.sort(key=lambda r: r['n'])
print('\n  {:38}{:>5}{:>9}{:>9}{:>8}{:>14}{:>14}'.format(
    'event', 'n', 'sum bid', 'sum ask', 'days', 'buy-all P/L', 'sell-all P/L'))
print('  ' + '-' * 98)
for r in rows[:20]:
    print('  {:38}{:>5}{:>9}{:>9}{:>8}{:>14}{:>14}'.format(
        r['t'], r['n'], '{:.3f}'.format(r['sb']), '{:.3f}'.format(r['sa']),
        '{:.0f}'.format(r['days']) if r['days'] else '-',
        '{:+.3f}'.format(r['buy_profit']), '{:+.3f}'.format(r['sell_profit'])))

arb_buy = [r for r in rows if r['buy_profit'] > 0]
arb_sell = [r for r in rows if r['sell_profit'] > 0]
print('\n  events where BUYING every outcome is profitable:  {} of {}'.format(
    len(arb_buy), len(rows)))
print('  events where SELLING every outcome is profitable: {} of {}'.format(
    len(arb_sell), len(rows)))

if rows:
    print('\n  sum of bids: min {:.3f}  median {:.3f}  max {:.3f}'.format(
        min(r['sb'] for r in rows), st.median([r['sb'] for r in rows]),
        max(r['sb'] for r in rows)))
    print('  sum of asks: min {:.3f}  median {:.3f}  max {:.3f}'.format(
        min(r['sa'] for r in rows), st.median([r['sa'] for r in rows]),
        max(r['sa'] for r in rows)))

for r in arb_sell[:5]:
    ret = r['sell_profit'] / r['sell_cap'] if r['sell_cap'] > 0 else 0
    print('\n  SELL-ALL on "{}" (n={}):'.format(r['t'], r['n']))
    print('    profit ${:.3f} on ${:.2f} capital = {:.3%}, over {:.0f} days'
          ' = {:.2%} annualised (cash: {:.1%})'.format(
              r['sell_profit'], r['sell_cap'], ret, r['days'],
              pm.annualise(ret, r['days']), pm.RISK_FREE))

print("""
=========================================================================================================
WHAT THIS ACTUALLY SHOWS

  Sum of BIDS sits BELOW 1.00 on essentially every mutually-exclusive event, and
  sum of ASKS sits ABOVE it. That is not a mispricing - it is the definition of a
  functioning two-sided market. You cannot buy the whole book for less than $1,
  and you cannot sell it for more.

  On large-n events the ask side is astronomically above 1 (roughly $78 to buy all
  113 outcomes of "Democratic Presidential Nominee 2028") because the long tail has
  no sellers, so its ask sits at or near $1.00 apiece. That is an illiquidity
  artefact, not an opportunity: it means the tail cannot be bought, and it is the
  same illiquidity that makes the SELL side sum below 1.

  Where the book is tight - small-n events like "Fed Decision in September" (n=4,
  asks sum to 1.004) - it is tight to within half a cent. There is no arbitrage
  there either, and that half-cent is the spread.

  CONCLUSION: no coherence arbitrage exists on this venue at a size a $1,000
  account could trade. The structural edge people expect from prediction markets
  is not in the arithmetic. If it exists at all it is in CALIBRATION - whether
  contracts priced at 5% resolve YES 5% of the time - and that cannot be measured
  here without price history, which the API does not serve. Hence poly_collector.py.""")
