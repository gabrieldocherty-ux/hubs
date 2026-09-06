"""
Verify Hyperliquid spot data before building a basis strategy on it.

Two questions, in order, and the second one can kill the idea outright:

 1. IS THE DATA ANY GOOD? These are wrapped/bridged tokens (UBTC, UETH, USOL)
    on a young spot venue. Thin books produce prices that are technically real
    and economically meaningless. Checks: history depth, gaps, zero-volume
    bars, dollar volume, and agreement with the perp.

 2. IS BASIS ACTUALLY DIFFERENT FROM FUNDING? Funding exists precisely to pull
    the perp toward the index, so basis and funding are mechanically coupled.
    If their correlation is near 1, a basis strategy is the funding-crowding
    strategy already rejected (D3) wearing a different hat, and the honest move
    is to say so and stop rather than to relabel a dead idea.
"""
import sys, json, time, statistics as st, datetime
sys.path.insert(0, 'research')
import engine, hl_data

SPOT = {'BTC': '@142', 'ETH': '@151', 'SOL': '@156', 'HYPE': '@107'}
COINS = list(SPOT)


def d(ms):
    return datetime.datetime.utcfromtimestamp(ms / 1000).strftime('%Y-%m-%d')


print('=' * 112)
print('1. SPOT DATA QUALITY')
print('=' * 112)
print('{:<7}{:<8}{:>7}{:>13}{:>13}{:>9}{:>8}{:>14}'.format(
    'coin', 'pair', 'bars', 'first', 'last', 'zeroV', 'cov%', 'med $vol/day'))
spot_bars = {}
for c, pair in SPOT.items():
    bars, rep = hl_data.get_candles(pair, '1d', 1200)
    spot_bars[c] = bars
    usd = [b['v'] * b['c'] for b in bars if b['v']]
    print('{:<7}{:<8}{:>7}{:>13}{:>13}{:>9}{:>8.1f}{:>14,.0f}'.format(
        c, pair, rep['n'], d(rep['first']), d(rep['last']), rep['zero_volume_bars'],
        rep['coverage_pct'], st.median(usd) if usd else 0))

print('\n' + '=' * 112)
print('2. DOES SPOT AGREE WITH THE PERP? (if not, one of them is not a real price)')
print('=' * 112)
basis_series = {}
for c in COINS:
    perp, _ = hl_data.get_candles(c, '1d', 1200)
    pmap = {b['t']: b['c'] for b in perp}
    rows = [(b['t'], pmap[b['t']], b['c'])
            for b in spot_bars[c] if b['t'] in pmap and b['c'] > 0]
    if not rows:
        print('  {}: no overlapping days'.format(c))
        continue
    bas = [(t, (p - s) / s) for t, p, s in rows]
    basis_series[c] = bas
    vals = [b for _, b in bas]
    absv = [abs(v) for v in vals]
    print('  {:<5} n={:<5} basis mean {:+.3f}%  median {:+.3f}%  sd {:.3f}%  '
          'p5 {:+.2f}%  p95 {:+.2f}%  |basis|>1% on {:.1f}% of days'.format(
              c, len(vals), st.mean(vals) * 100, st.median(vals) * 100,
              st.pstdev(vals) * 100, sorted(vals)[int(len(vals) * .05)] * 100,
              sorted(vals)[int(len(vals) * .95)] * 100,
              100 * sum(1 for v in absv if v > 0.01) / len(absv)))

print("""
  A perp/spot basis with a median near zero and a small standard deviation is
  the expected, healthy picture - arbitrage keeps them together. A large or
  wandering basis would mean the spot pair is too thin to arbitrage against,
  which makes it a data artifact rather than a tradable dislocation.""")

print('\n' + '=' * 112)
print('3. IS BASIS DISTINCT FROM FUNDING, OR THE SAME SIGNAL?')
print('=' * 112)


def corr(a, b):
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    if n < 3:
        return None
    ma, mb = st.mean(a), st.mean(b)
    va = sum((x - ma) ** 2 for x in a) ** .5
    vb = sum((x - mb) ** 2 for x in b) ** .5
    if va == 0 or vb == 0:
        return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (va * vb)


for c in COINS:
    if c not in basis_series:
        continue
    perp, _ = hl_data.get_candles(c, '1d', 1200)
    fc = engine.FundingCurve(hl_data.get_funding(c, 1250))
    fseries = engine.funding_annualized_series(perp, fc, lookback_hours=24)
    fmap = {b['t']: f for b, f in zip(perp, fseries) if f is not None}
    pairs = [(bv, fmap[t]) for t, bv in basis_series[c] if t in fmap]
    if len(pairs) < 30:
        print('  {}: too little overlap'.format(c))
        continue
    r = corr([p[0] for p in pairs], [p[1] for p in pairs])
    # also: same-sign agreement, which matters more than r for a signal
    same = sum(1 for b, f in pairs if (b > 0) == (f > 0)) / len(pairs)
    print('  {:<5} n={:<5} corr(basis, 24h funding) = {:+.3f}   same-sign {:.1%}'.format(
        c, len(pairs), r if r is not None else float('nan'), same))

print("""
  Reading this: correlation near +1 means basis IS funding and there is nothing
  new here - D3 already tested that signal and it failed. A moderate
  correlation means basis carries information funding does not, which would
  justify testing it as a separate strategy.""")

json.dump({c: [[t, v] for t, v in b] for c, b in basis_series.items()},
          open('research/basis_series.json', 'w'))
print('\nwrote research/basis_series.json')
