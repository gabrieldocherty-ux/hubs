import sys, json, datetime, urllib.request, statistics as st
sys.path.insert(0,'research')
import hl_data

def d(ms): return datetime.datetime.utcfromtimestamp(ms/1000).strftime('%Y-%m-%d')

for coin in ('HYPE','ZEC','XRP'):
    bars, rep = hl_data.get_candles(coin,'1d',1200)
    usd=[b['v']*b['c'] for b in bars]
    zero_recent = sum(1 for b in bars[-365:] if b['v']==0)
    print(f'{coin}: n={len(bars)} {d(bars[0]["t"])} -> {d(bars[-1]["t"])} | zeroV total={rep["zero_volume_bars"]} last365={zero_recent}'
          f' | px {bars[-1]["c"]} | 24h-snapshot-vs-90d-median ratio', end=' ')
    snap = {r['coin']:r['day_ntl_vlm'] for r in json.load(open('research/liquidity_snapshot.json'))}
    print(f'{snap[coin]/st.median(usd[-90:]):.2f}x')

# external cross-check of HYPE price
try:
    req=urllib.request.Request('https://api.binance.com/api/v3/klines?symbol=HYPEUSDT&interval=1d&limit=200',
                               headers={'User-Agent':'r/1.0'})
    ext={int(k[0]):float(k[4]) for k in json.loads(urllib.request.urlopen(req,timeout=30).read())}
    bars,_=hl_data.get_candles('HYPE','1d',1200); hl={b['t']:b['c'] for b in bars}
    common=sorted(set(hl)&set(ext))
    diffs=[abs(hl[t]-ext[t])/ext[t] for t in common]
    print(f'\nHYPE vs Binance: {len(common)} days, mean abs diff {sum(diffs)/len(diffs)*100:.4f}%, max {max(diffs)*100:.3f}%')
except Exception as e:
    print('\nHYPE binance check failed:', str(e)[:120])

# 4h availability for each coin (the macro/daily research needs both resolutions)
for coin in ('BTC','ETH','SOL','HYPE'):
    b4,r4 = hl_data.get_candles(coin,'4h',820)
    print(f'{coin} 4h: n={r4["n"]} cov={r4["coverage_pct"]:.2f}% dupes={r4["dupes"]} ohlc_viol={r4["ohlc_violations"]} '
          f'{d(b4[0]["t"])}->{d(b4[-1]["t"])}')
