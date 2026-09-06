"""HL serves daily candles predating its own launch. Verify or discard them."""
import sys, json, urllib.request, datetime
sys.path.insert(0,'research'); import hl_data
def d(ms): return datetime.datetime.utcfromtimestamp(ms/1000).strftime('%Y-%m-%d')

def binance_daily(sym, start_ms, end_ms):
    out={}; cur=start_ms
    while cur < end_ms:
        u=(f'https://api.binance.com/api/v3/klines?symbol={sym}&interval=1d'
           f'&startTime={cur}&endTime={end_ms}&limit=1000')
        req=urllib.request.Request(u, headers={'User-Agent':'r/1.0'})
        k=json.loads(urllib.request.urlopen(req,timeout=30).read())
        if not k: break
        for r in k: out[int(r[0])]=float(r[4])
        nxt=int(k[-1][0])+86400000
        if nxt<=cur: break
        cur=nxt
    return out

for coin,sym in (('BTC','BTCUSDT'),('ETH','ETHUSDT'),('SOL','SOLUSDT')):
    bars,rep = hl_data.get_candles(coin,'1d',2200)
    hl={b['t']:b['c'] for b in bars}
    ext=binance_daily(sym, min(hl), max(hl))
    cutoff=int(datetime.datetime(2023,5,24).timestamp()*1000)   # HL listing era
    for label, sel in (('PRE-launch (<2023-05-24)',[t for t in hl if t<cutoff]),
                       ('POST-launch (>=2023-05-24)',[t for t in hl if t>=cutoff])):
        common=sorted(set(sel)&set(ext))
        if not common: print(f'{coin} {label}: no overlap'); continue
        diffs=[abs(hl[t]-ext[t])/ext[t] for t in common]
        worst=max(range(len(common)), key=lambda i:diffs[i])
        vols=[b['v'] for b in bars if b['t'] in set(sel)]
        zero=sum(1 for v in vols if v==0)
        print(f'{coin} {label}: n={len(common)} meandiff={sum(diffs)/len(diffs)*100:.4f}% '
              f'max={diffs[worst]*100:.2f}% @{d(common[worst])} | zero-vol bars {zero}/{len(vols)}')
