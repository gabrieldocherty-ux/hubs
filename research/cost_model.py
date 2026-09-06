"""
Verify what a trade ACTUALLY costs on Hyperliquid, rather than trusting the
0.045% + 0.05% that has been hardcoded in the backtester since day one.

Four components, and the current model only really addresses two of them:
  1. exchange fee      - taker vs maker, and which tier this account is in
  2. slippage          - a function of ORDER SIZE against real book depth, not
                         a constant; at $25 an order this may be far smaller
                         than modelled, which would mean the strategies are
                         being under-credited
  3. spread            - crossing it is part of the cost of a market order
  4. the $10 minimum   - not a rate at all, but a hard constraint that
                         interacts badly with $250 of capital and Kelly sizing

Measured against the live book, so the answer reflects this account's actual
position size rather than a generic assumption.
"""
import json
import sys
import urllib.request

API = 'https://api.hyperliquid.xyz/info'
COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
ORDER_SIZES = [10, 25, 50, 100, 250]          # USD notional per order


def post(payload):
    req = urllib.request.Request(API, data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


print('=' * 104)
print('1. LIVE ORDER BOOK - what does crossing the spread actually cost at our size?')
print('=' * 104)
print('{:<7}{:>12}{:>10}'.format('coin', 'mid', 'spread') +
      ''.join('{:>12}'.format('${}'.format(s)) for s in ORDER_SIZES))
print('{:<7}{:>12}{:>10}'.format('', '', '(bps)') +
      ''.join('{:>12}'.format('slip bps') for s in ORDER_SIZES))
print('-' * 104)

results = {}
for coin in COINS:
    try:
        book = post({'type': 'l2Book', 'coin': coin})
    except Exception as e:
        print('{:<7} book unavailable: {}'.format(coin, str(e)[:60]))
        continue
    levels = book.get('levels') or []
    if len(levels) < 2 or not levels[0] or not levels[1]:
        print('{:<7} empty book'.format(coin))
        continue
    bids, asks = levels[0], levels[1]
    best_bid, best_ask = float(bids[0]['px']), float(asks[0]['px'])
    mid = (best_bid + best_ask) / 2
    spread_bps = (best_ask - best_bid) / mid * 10_000

    row = '{:<7}{:>12,.2f}{:>10.2f}'.format(coin, mid, spread_bps)
    slips = {}
    for size_usd in ORDER_SIZES:
        # walk the ask side, buying `size_usd` of notional
        remaining = size_usd
        cost = 0.0
        filled = 0.0
        for lvl in asks:
            px, sz = float(lvl['px']), float(lvl['sz'])
            avail = px * sz
            take = min(remaining, avail)
            cost += take
            filled += take / px
            remaining -= take
            if remaining <= 0:
                break
        if remaining > 0 or filled <= 0:
            row += '{:>12}'.format('book too thin')
            continue
        vwap = cost / filled
        slip_bps = (vwap - mid) / mid * 10_000
        slips[size_usd] = slip_bps
        row += '{:>12.2f}'.format(slip_bps)
    results[coin] = {'mid': mid, 'spread_bps': spread_bps, 'slips': slips}
    print(row)

print("""
  Slippage here is measured as the VWAP of a real market buy against the live
  book, versus the mid. It already includes crossing half the spread, so it is
  the honest all-in execution cost of one side.""")

print('\n' + '=' * 104)
print('2. FEE SCHEDULE')
print('=' * 104)
print("""  Hyperliquid's published base rates for a new account with no volume history:
      taker  0.045%  (4.5 bps)
      maker  0.015%  (1.5 bps)
  Volume tiers reduce these, but this account has zero volume, so the base
  taker rate is the correct assumption and there is no case for modelling a
  discount. Every strategy here uses market orders on a daily-bar signal, so
  taker is right - claiming the maker rate would mean assuming a limit order
  that may never fill, which would change the strategy's actual trades.""")

if results:
    print('\n' + '=' * 104)
    print('3. ALL-IN ROUND-TRIP COST vs THE MODELLED 0.190%')
    print('=' * 104)
    TAKER = 0.00045
    MODELLED = 2 * (0.00045 + 0.0005)
    print('{:<7}'.format('coin') + ''.join('{:>16}'.format('${} order'.format(s))
                                           for s in ORDER_SIZES))
    for coin, r in results.items():
        row = '{:<7}'.format(coin)
        for s in ORDER_SIZES:
            if s not in r['slips']:
                row += '{:>16}'.format('-')
                continue
            rt = 2 * (TAKER + r['slips'][s] / 10_000)
            row += '{:>16}'.format('{:.3f}%'.format(rt * 100))
        print(row)
    print('\n  modelled in every backtest so far: {:.3f}% round trip'.format(MODELLED * 100))

print('\n' + '=' * 104)
print('4. THE $10 MINIMUM ORDER vs $250 OF CAPITAL')
print('=' * 104)
print("""  Hyperliquid rejects orders below $10 of notional. With $250 of capital and
  the risk manager's 20%-of-capital ceiling, the largest single position is
  $50 - so the tradable band per position is $10 to $50, a range of only 5x.

  That matters for Kelly sizing: once Kelly has enough trade history to start
  scaling positions down after a losing run, it can produce a size under $10,
  which the exchange simply refuses. The position is then not reduced, it is
  SKIPPED - and skipping trades after losses is a different strategy from the
  one that was validated. Worth watching for once real trades start.""")
