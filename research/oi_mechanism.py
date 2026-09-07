"""
Why did the edge not generalise - and is there a principled way to say which
coins it should work on?

The expansion test came back negative in a specific way: on six unseen coins the
MEAN expectancy survived (S3 +2.06%, D1 +3.38%) but the TRIMMED mean collapsed
to roughly zero (-0.04% and -0.54%), win rates fell to coin-flip, and only 2 of
4 years were positive. So the mean is being carried by a few outliers while the
body of the distribution has no edge.

The mechanism predicts exactly which coins should fail. A liquidation cascade
requires a large LEVERAGED POSITION BASE to liquidate. Open interest measures
that base directly. On a coin with little open interest, an outsized volume day
is more likely idiosyncratic flow - one big buyer - than a forced cascade, so
the signal fires on the wrong thing.

That gives a falsifiable, EX-ANTE screen: per-coin edge should scale with open
interest. This matters beyond curiosity, because the alternative on offer is to
keep the coins that happened to work (XRP, kPEPE) and drop the ones that did
not (FARTCOIN, AAVE) - which is selecting on the outcome, and would manufacture
a result out of noise.

If OI predicts the edge, there is a defensible rule. If it does not, expansion
is simply dead and the honest answer is that breadth is unavailable.
"""
import json
import sys
import urllib.request

sys.path.insert(0, 'research')
import pooled
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout

ORIGINAL = ['BTC', 'ETH', 'SOL', 'HYPE']
NEW = ['XRP', 'FARTCOIN', 'WLD', 'SUI', 'AAVE', 'kPEPE']
ALL = ORIGINAL + NEW

S3P = {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}
D1P = {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}


def post(payload):
    req = urllib.request.Request('https://api.hyperliquid.xyz/info',
                                 data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())


meta, ctxs = post({'type': 'metaAndAssetCtxs'})
oi = {}
for u, c in zip(meta['universe'], ctxs):
    mark = float(c.get('markPx') or 0)
    oi[u['name']] = {
        'oi_usd': float(c.get('openInterest') or 0) * mark,
        'vol': float(c.get('dayNtlVlm') or 0),
        'lev': u.get('maxLeverage'),
    }

per_s3, _ = pooled.pooled(volume_spike, S3P, ALL, 60, name='S3')
per_d1, _ = pooled.pooled(range_breakout, D1P, ALL, 60, name='D1')

rows = []
for c in ALL:
    if c not in per_s3 or not per_s3[c].n:
        continue
    info = oi.get(c, {})
    rows.append({
        'coin': c,
        'seen': c in ORIGINAL,
        'oi_usd': info.get('oi_usd', 0),
        'lev': info.get('lev'),
        'oi_over_vol': (info.get('oi_usd', 0) / info['vol']) if info.get('vol') else 0,
        's3_trim': per_s3[c].trimmed_expectancy(0.05),
        's3_wr': per_s3[c].win_rate,
        'd1_trim': per_d1[c].trimmed_expectancy(0.05) if c in per_d1 and per_d1[c].n else None,
    })
rows.sort(key=lambda r: -r['oi_usd'])

print('=' * 112)
print('DOES OPEN INTEREST PREDICT WHERE THE CASCADE EDGE WORKS?')
print('=' * 112)
print('{:<10}{:>8}{:>18}{:>9}{:>11}{:>12}{:>12}'.format(
    'coin', 'seen?', 'open interest $', 'maxLev', 'OI/volume', 'S3 trim5', 'D1 trim5'))
print('-' * 112)
for r in rows:
    print('{:<10}{:>8}{:>18,.0f}{:>9}{:>11.2f}{:>12}{:>12}'.format(
        r['coin'], 'dev' if r['seen'] else 'OOS', r['oi_usd'], str(r['lev']),
        r['oi_over_vol'],
        '{:+.2f}%'.format(r['s3_trim'] * 100),
        '{:+.2f}%'.format(r['d1_trim'] * 100) if r['d1_trim'] is not None else '-'))


def corr(a, b):
    import statistics as st
    n = len(a)
    if n < 4:
        return None
    ma, mb = st.mean(a), st.mean(b)
    va = sum((x - ma) ** 2 for x in a) ** .5
    vb = sum((y - mb) ** 2 for y in b) ** .5
    if va == 0 or vb == 0:
        return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (va * vb)


import math
logoi = [math.log(max(r['oi_usd'], 1)) for r in rows]
print('\n  correlation of log(open interest) with S3 trimmed edge: {:+.2f}'.format(
    corr(logoi, [r['s3_trim'] for r in rows]) or 0))
d1rows = [r for r in rows if r['d1_trim'] is not None]
print('  correlation of log(open interest) with D1 trimmed edge: {:+.2f}'.format(
    corr([math.log(max(r['oi_usd'], 1)) for r in d1rows],
         [r['d1_trim'] for r in d1rows]) or 0))

print('\n' + '=' * 112)
print('THE DECISIVE SPLIT: coins above vs below $500M open interest')
print('  (a threshold that separates the majors from the rest, chosen on the')
print('   mechanism - a big leveraged base - not on which coins performed)')
print('=' * 112)
THRESH = 500_000_000
for label, sel in (('OI >= $500M', [r for r in rows if r['oi_usd'] >= THRESH]),
                   ('OI <  $500M', [r for r in rows if r['oi_usd'] < THRESH])):
    if not sel:
        continue
    coins = [r['coin'] for r in sel]
    _, m3 = pooled.pooled(volume_spike, S3P, coins, 60, name='s')
    _, md = pooled.pooled(range_breakout, D1P, coins, 60, name='d')
    print('\n  {}  ({} coins: {})'.format(label, len(coins), ', '.join(coins)))
    print('    S3  ' + pooled.describe(m3, ''))
    print('    D1  ' + pooled.describe(md, ''))

print("""
  If the high-OI group keeps a positive trimmed edge and the low-OI group does
  not, the mechanism holds and open interest is a legitimate ex-ante filter -
  one that could be applied to any future coin without looking at its returns.
  If both groups look the same, OI explains nothing and the four-coin result
  was specific to those four coins.""")
