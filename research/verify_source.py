"""Cross-validate Hyperliquid candles against independent venues.
If HL's data disagrees with the rest of the market, everything downstream is junk."""
import sys, json, urllib.request, time
sys.path.insert(0, 'research')
import hl_data

def get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent':'research/1.0'})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())

def try_binance(sym, limit=400):
    try:
        d = get_json(f'https://api.binance.com/api/v3/klines?symbol={sym}&interval=1d&limit={limit}')
        return {int(k[0]): float(k[4]) for k in d}
    except Exception as e:
        return {'__err__': str(e)[:120]}

def try_coinbase(pair):
    try:
        d = get_json(f'https://api.exchange.coinbase.com/products/{pair}/candles?granularity=86400')
        return {int(r[0])*1000: float(r[4]) for r in d}
    except Exception as e:
        return {'__err__': str(e)[:120]}

for coin, bsym, cbpair in [('BTC','BTCUSDT','BTC-USD'), ('ETH','ETHUSDT','ETH-USD'), ('SOL','SOLUSDT','SOL-USD')]:
    bars, rep = hl_data.get_candles(coin, '1d', 1200)
    hl = {b['t']: b['c'] for b in bars}
    print(f'\n=== {coin} (HL n={rep["n"]}, coverage {rep["coverage_pct"]:.1f}%) ===')
    print(f'  HL latest close: {bars[-1]["c"]}')
    for name, other in (('binance', try_binance(bsym)), ('coinbase', try_coinbase(cbpair))):
        if '__err__' in other:
            print(f'  {name}: unavailable ({other["__err__"]})'); continue
        common = sorted(set(hl) & set(other))
        if not common:
            print(f'  {name}: no overlapping timestamps ({len(other)} bars fetched)'); continue
        diffs = [abs(hl[t]-other[t])/other[t] for t in common]
        worst = max(range(len(common)), key=lambda i: diffs[i])
        print(f'  {name}: {len(common)} overlapping days | mean abs diff {sum(diffs)/len(diffs)*100:.4f}% '
              f'| max {diffs[worst]*100:.3f}% (HL {hl[common[worst]]} vs {other[common[worst]]})')
