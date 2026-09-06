"""Pick the 4th coin on sustained liquidity + usable history, not a 24h snapshot."""
import sys, json, statistics as st
sys.path.insert(0, 'research')
import hl_data

snap = json.load(open('research/liquidity_snapshot.json'))
cands = [r['coin'] for r in snap[:18]]
for must in ('BTC','ETH','SOL'):
    if must not in cands: cands.append(must)

print(f"{'coin':<10}{'hist(d)':>8}{'med$vol 90d':>15}{'med$vol 365d':>15}{'min$vol 90d':>14}{'zeroV':>7}{'cov%':>7}{'maxLev':>7}")
print('-'*84)
rows = []
for coin in cands:
    try:
        bars, rep = hl_data.get_candles(coin, '1d', 1200)
    except Exception as e:
        print(f'{coin:<10} FETCH FAILED: {str(e)[:50]}'); continue
    if len(bars) < 30:
        print(f'{coin:<10}{len(bars):>8}  too little history'); continue
    usd = [b['v']*b['c'] for b in bars]
    m90 = st.median(usd[-90:]); m365 = st.median(usd[-365:]) if len(usd) >= 365 else float('nan')
    mn90 = min(usd[-90:])
    lev = next((r['max_leverage'] for r in snap if r['coin']==coin), None)
    rows.append({'coin':coin,'hist':len(bars),'m90':m90,'m365':m365,'min90':mn90,
                 'cov':rep['coverage_pct'],'zero':rep['zero_volume_bars'],'lev':lev})
    print(f"{coin:<10}{len(bars):>8}{m90:>15,.0f}{m365:>15,.0f}{mn90:>14,.0f}"
          f"{rep['zero_volume_bars']:>7}{rep['coverage_pct']:>7.1f}{str(lev):>7}")
json.dump(rows, open('research/coin_candidates.json','w'), indent=1)
