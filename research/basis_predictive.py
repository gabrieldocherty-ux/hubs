"""
Does perp-spot basis predict anything? Measure first, build second.

Building a strategy and reading its equity curve is a bad way to answer this -
the strategy's stops, timeouts and sizing all inject their own behaviour, and a
positive result could come from any of them. A bucketed forward-return test
isolates the question: conditional on today's basis, what happens next?

Two problems handled explicitly:

 * OUTLIERS. BTC's raw basis has a standard deviation of 13.5% around a median
   of -0.014%. That is not an economic dislocation, it is a thin-book print on
   a young spot pair. Real arbitrage holds these within a few tenths of a
   percent, so days beyond a sanity bound are treated as bad data and excluded,
   with the count reported. Silently winsorising them into the sample would let
   data errors drive the result.

 * LOOKAHEAD. Buckets are cut on a TRAILING percentile, never a full-sample one.
   A full-sample decile is how the earlier funding-crowding work appears to have
   produced a signal that did not survive honest re-testing.
"""
import sys, json, statistics as st
sys.path.insert(0, 'research')
import engine, hl_data

SPOT = {'BTC': '@142', 'ETH': '@151', 'SOL': '@156', 'HYPE': '@107'}
SANITY = 0.02          # |basis| above 2% on a daily close is a bad print, not a trade
HORIZONS = [1, 3, 7, 14]


def build(coin):
    perp, _ = hl_data.get_candles(coin, '1d', 1200)
    spot, _ = hl_data.get_candles(SPOT[coin], '1d', 1200)
    smap = {b['t']: b['c'] for b in spot if b['c'] > 0 and b['v'] > 0}
    rows, dropped = [], 0
    for i, b in enumerate(perp):
        s = smap.get(b['t'])
        if s is None:
            continue
        bas = (b['c'] - s) / s
        if abs(bas) > SANITY:
            dropped += 1
            continue
        rows.append({'i': i, 't': b['t'], 'perp': b['c'], 'basis': bas})
    return perp, rows, dropped


print('=' * 116)
print('FORWARD RETURNS BY BASIS BUCKET  (trailing 180d percentile, bad prints excluded)')
print('=' * 116)
summary = {}
for coin in SPOT:
    perp, rows, dropped = build(coin)
    closes = [b['c'] for b in perp]
    buckets = {'high': [], 'low': [], 'mid': []}
    for k, r in enumerate(rows):
        hist = [x['basis'] for x in rows[max(0, k - 180):k + 1]]
        if len(hist) < 60:
            continue
        hs = sorted(hist)
        hi, lo = hs[int(len(hs) * .90)], hs[int(len(hs) * .10)]
        tag = 'high' if r['basis'] >= hi else ('low' if r['basis'] <= lo else 'mid')
        fwd = {}
        for h in HORIZONS:
            j = r['i'] + h
            if j < len(closes):
                fwd[h] = (closes[j] - closes[r['i']]) / closes[r['i']]
        if fwd:
            buckets[tag].append(fwd)

    print('\n{}   usable days {}   excluded as bad prints: {}'.format(
        coin, len(rows), dropped))
    print('  {:<10}{:>7}'.format('bucket', 'n') +
          ''.join('{:>14}'.format('fwd {}d'.format(h)) for h in HORIZONS))
    stats = {}
    for tag in ('high', 'mid', 'low'):
        b = buckets[tag]
        if not b:
            continue
        line = '  {:<10}{:>7}'.format(tag, len(b))
        stats[tag] = {}
        for h in HORIZONS:
            vals = [x[h] for x in b if h in x]
            m = st.mean(vals) if vals else None
            stats[tag][h] = m
            line += '{:>14}'.format('{:+.2f}%'.format(m * 100) if m is not None else '-')
        print(line)
    # the number that matters: does high differ from low?
    spread = '  {:<10}{:>7}'.format('HIGH-LOW', '')
    for h in HORIZONS:
        a, b2 = stats.get('high', {}).get(h), stats.get('low', {}).get(h)
        spread += '{:>14}'.format('{:+.2f}%'.format((a - b2) * 100)
                                  if a is not None and b2 is not None else '-')
    print(spread)
    summary[coin] = stats

print('\n' + '=' * 116)
print('POOLED HIGH-minus-LOW SPREAD (the only number that matters)')
print('=' * 116)
for h in HORIZONS:
    diffs = [summary[c]['high'][h] - summary[c]['low'][h]
             for c in summary
             if summary[c].get('high', {}).get(h) is not None
             and summary[c].get('low', {}).get(h) is not None]
    if diffs:
        agree = sum(1 for x in diffs if x < 0)
        print('  {:>3}d horizon: mean spread {:+.3f}%   coins with NEGATIVE spread '
              '(crowded-long underperforms): {}/{}'.format(
                  h, st.mean(diffs) * 100, agree, len(diffs)))

print("""
  What would support a tradable signal: a spread that is consistently signed
  across all four coins and large relative to the 0.19% round-trip cost. A
  spread that flips sign between coins, or sits inside the cost, is noise.""")
