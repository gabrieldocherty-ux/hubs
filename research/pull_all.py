import sys, time, json, datetime
sys.path.insert(0,'research'); import hl_data
COINS=['BTC','ETH','SOL','HYPE']
def d(ms): return datetime.datetime.utcfromtimestamp(ms/1000).strftime('%Y-%m-%d')
manifest={}
for c in COINS:
    for iv,days in (('1d',2200),('4h',1250)):
        t=time.time(); bars,rep=hl_data.get_candles(c,iv,days)
        manifest[f'{c}_{iv}']={'n':rep['n'],'cov':round(rep['coverage_pct'],3),
            'dupes':rep['dupes'],'ohlc_viol':rep['ohlc_violations'],'bad_px':rep['bad_prices'],
            'zeroV':rep['zero_volume_bars'],'first':d(rep['first']),'last':d(rep['last']),
            'missing':rep['missing_bars_total']}
        print(f'{c} {iv}: {rep["n"]} bars {d(rep["first"])}->{d(rep["last"])} cov={rep["coverage_pct"]:.2f}% '
              f'miss={rep["missing_bars_total"]} zeroV={rep["zero_volume_bars"]} ({time.time()-t:.1f}s)')
    t=time.time(); f=hl_data.get_funding(c,1250)
    manifest[f'{c}_funding']={'n':len(f),'first':d(f[0]['t']),'last':d(f[-1]['t'])}
    print(f'{c} funding: {len(f)} events {d(f[0]["t"])}->{d(f[-1]["t"])} ({time.time()-t:.1f}s)')
json.dump(manifest, open('research/data_manifest.json','w'), indent=1)
