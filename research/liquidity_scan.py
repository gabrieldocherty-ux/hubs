"""Pull real Hyperliquid perp market stats to pick the 4th coin on evidence."""
import json, urllib.request

def post(payload):
    req = urllib.request.Request('https://api.hyperliquid.xyz/info',
        data=json.dumps(payload).encode(), headers={'Content-Type':'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=30).read())

meta, ctxs = post({'type': 'metaAndAssetCtxs'})
rows = []
for u, c in zip(meta['universe'], ctxs):
    if u.get('isDelisted'): continue
    mark = float(c.get('markPx') or 0)
    rows.append({
        'coin': u['name'],
        'day_ntl_vlm': float(c.get('dayNtlVlm') or 0),
        'open_interest_usd': float(c.get('openInterest') or 0) * mark,
        'max_leverage': u.get('maxLeverage'),
        'funding_annual_pct': float(c.get('funding') or 0) * 24 * 365 * 100,
        'mark': mark,
    })
rows.sort(key=lambda r: -r['day_ntl_vlm'])
print(f"{'coin':<10}{'24h volume $':>18}{'open interest $':>18}{'maxLev':>8}{'fund%/yr':>10}")
print('-'*64)
for r in rows[:15]:
    print(f"{r['coin']:<10}{r['day_ntl_vlm']:>18,.0f}{r['open_interest_usd']:>18,.0f}{r['max_leverage']:>8}{r['funding_annual_pct']:>10.1f}")
total = sum(r['day_ntl_vlm'] for r in rows)
print(f"\ntotal 24h perp volume across {len(rows)} listed coins: ${total:,.0f}")
json.dump(rows, open('research/liquidity_snapshot.json','w'), indent=1)
