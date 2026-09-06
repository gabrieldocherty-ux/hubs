"""
Probe Hyperliquid for data sources not yet used, before building on any of them.

Everything validated so far comes from price, volume and funding. The strategies
that failed mostly failed because they were re-derivations of those same three
series. Genuinely new strategies need genuinely new information, and the two
candidates that would most directly test the forced-flow hypothesis are:

  * LIQUIDATION history - the mechanism's actual observable, rather than the
    range/volume proxies currently standing in for it.
  * OPEN INTEREST history - positioning build-up and unwind, which is different
    information from either price or funding.

The mandate's rule applies before any of it is trusted: check the endpoint is
real, check the series is not silently gapped or wrong, and sanity-check it
against something already trusted. This script only establishes what EXISTS and
whether it is usable - no strategy is built here.
"""
import json
import sys
import time
import urllib.error
import urllib.request

API = 'https://api.hyperliquid.xyz/info'


def post(payload, timeout=25):
    req = urllib.request.Request(API, data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


def probe(label, payload, show=400):
    try:
        r = post(payload)
    except urllib.error.HTTPError as e:
        body = ''
        try:
            body = e.read().decode()[:160]
        except Exception:
            pass
        print('  {:<34} HTTP {} {}'.format(label, e.code, body))
        return None
    except Exception as e:
        print('  {:<34} ERROR {}'.format(label, str(e)[:110]))
        return None
    kind = type(r).__name__
    size = len(r) if isinstance(r, (list, dict)) else '-'
    s = json.dumps(r)
    print('  {:<34} OK  {} len={}  {}'.format(label, kind, size, s[:show]))
    return r


now = int(time.time() * 1000)
day = 86_400_000

print('=' * 110)
print('1. OPEN INTEREST - is there any HISTORICAL series, or only a live snapshot?')
print('=' * 110)
meta, ctxs = post({'type': 'metaAndAssetCtxs'})
btc_i = next(i for i, u in enumerate(meta['universe']) if u['name'] == 'BTC')
c = ctxs[btc_i]
print('  live BTC ctx fields: {}'.format(sorted(c.keys())))
print('  openInterest={}  dayNtlVlm={}  premium={}  oraclePx={}  markPx={}'.format(
    c.get('openInterest'), c.get('dayNtlVlm'), c.get('premium'),
    c.get('oraclePx'), c.get('markPx')))
probe('candleSnapshot (has OI field?)', {'type': 'candleSnapshot', 'req': {
    'coin': 'BTC', 'interval': '1d', 'startTime': now - 3 * day, 'endTime': now}}, 500)

print('\n' + '=' * 110)
print('2. LIQUIDATIONS - the forced-flow mechanism observed directly')
print('=' * 110)
for label, payload in [
    ('liquidations', {'type': 'liquidations', 'coin': 'BTC',
                      'startTime': now - 2 * day, 'endTime': now}),
    ('userLiquidations', {'type': 'userLiquidations', 'coin': 'BTC'}),
    ('liquidatable', {'type': 'liquidatable'}),
    ('recentTrades', {'type': 'recentTrades', 'coin': 'BTC'}),
]:
    probe(label, payload, 300)

print('\n' + '=' * 110)
print('3. SPOT MARKETS - is a perp/spot basis series constructible?')
print('=' * 110)
sm = probe('spotMeta', {'type': 'spotMeta'}, 200)
if sm:
    toks = {t['index']: t['name'] for t in sm.get('tokens', [])}
    pairs = []
    for p in sm.get('universe', []):
        a, b = p.get('tokens', [None, None])[:2]
        pairs.append((p.get('name'), toks.get(a), toks.get(b)))
    named = [p for p in pairs if p[1] in ('BTC', 'UBTC', 'ETH', 'UETH', 'SOL', 'USOL', 'HYPE')]
    print('  spot pairs relevant to our basket: {}'.format(named[:12]))
    print('  total spot pairs: {}'.format(len(pairs)))
    for nm in [p[0] for p in named[:4]]:
        probe('spot candles {}'.format(nm), {'type': 'candleSnapshot', 'req': {
            'coin': nm, 'interval': '1d', 'startTime': now - 5 * day, 'endTime': now}}, 220)

print('\n' + '=' * 110)
print('4. PREMIUM / ORACLE SPREAD - already in the live ctx; is it historical anywhere?')
print('=' * 110)
probe('predictedFundings', {'type': 'predictedFundings'}, 260)
probe('metaAndAssetCtxs premium (live only)',
      {'type': 'metaAndAssetCtxs'}, 0)
print('  -> premium is a live snapshot field; no historical endpoint observed.')

print('\n' + '=' * 110)
print('VERDICT (what is actually usable for backtesting)')
print('=' * 110)
print("""  Backtesting needs a HISTORICAL series. A live snapshot cannot be used to
  build one retroactively - it could only be recorded going forward, which
  means any strategy based on it is untestable today and would need months of
  collection first. That distinction decides what is worth pursuing now.""")
