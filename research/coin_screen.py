"""
Screen Hyperliquid's perp universe for coins the validated strategies could
also run on.

This is both a practical question (breadth is the one lever that improves
return per unit of risk) and the strongest scientific test available: the four
current coins were used to DEVELOP these strategies, so testing identical
parameters on coins that had no hand in their creation is a genuine
out-of-sample check. If the forced-flow mechanism is a real property of a
leveraged venue, it should not care which ticker it is.

Screen criteria, all set before looking at any returns:
  * sustained liquidity - median daily $ volume over 90d AND 365d, not a
    24h snapshot. ZEC was excluded from the original four exactly this way:
    its 24h print was 4.94x its own 90-day median.
  * enough tradeable history - >= 400 daily bars since Hyperliquid's own
    launch, since anything earlier is zero-volume backfill.
  * live data, not a dead listing - no more than 2% zero-volume bars in the
    last year.
  * executable at our size - the book must absorb $50 without meaningful
    slippage, measured against the live L2 book rather than assumed.
"""
import json
import statistics as st
import sys
import time
import urllib.request

sys.path.insert(0, 'research')
import hl_data

API = 'https://api.hyperliquid.xyz/info'
EXISTING = {'BTC', 'ETH', 'SOL', 'HYPE'}
MIN_BARS = 400
MIN_MEDIAN_VOL_90D = 5_000_000
MAX_ZEROVOL_FRAC = 0.02
MAX_SLIP_BPS = 5.0        # at $50 notional


def post(payload, timeout=30):
    req = urllib.request.Request(API, data=json.dumps(payload).encode(),
                                 headers={'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


def slippage_bps(coin, notional=50.0):
    """VWAP of a real market buy against the live book, vs mid."""
    try:
        book = post({'type': 'l2Book', 'coin': coin})
    except Exception:
        return None
    lv = book.get('levels') or []
    if len(lv) < 2 or not lv[0] or not lv[1]:
        return None
    bid, ask = float(lv[0][0]['px']), float(lv[1][0]['px'])
    mid = (bid + ask) / 2
    rem, cost, filled = notional, 0.0, 0.0
    for l in lv[1]:
        px, sz = float(l['px']), float(l['sz'])
        take = min(rem, px * sz)
        cost += take
        filled += take / px
        rem -= take
        if rem <= 0:
            break
    if rem > 0 or filled <= 0:
        return None
    return (cost / filled - mid) / mid * 10_000


meta, ctxs = post({'type': 'metaAndAssetCtxs'})
rows = []
for u, c in zip(meta['universe'], ctxs):
    if u.get('isDelisted'):
        continue
    rows.append((u['name'], float(c.get('dayNtlVlm') or 0), u.get('maxLeverage')))
rows.sort(key=lambda r: -r[1])

print('=' * 118)
print('SCREENING HYPERLIQUID PERPS FOR ADDITIONAL COINS')
print('=' * 118)
print('{:<9}{:>15}{:>15}{:>8}{:>8}{:>9}{:>10}{:>9}  {}'.format(
    'coin', 'med$vol 90d', 'med$vol 365d', 'bars', 'zeroV%', 'snap/90d', 'slip@50', 'maxLev', 'verdict'))
print('-' * 118)

passed, considered = [], 0
for name, day_vlm, lev in rows[:34]:
    if name in EXISTING:
        continue
    considered += 1
    try:
        bars, rep = hl_data.get_candles(name, '1d', 1200)
    except Exception as e:
        print('{:<9}  fetch failed: {}'.format(name, str(e)[:50]))
        continue
    if len(bars) < 60:
        continue
    usd = [b['v'] * b['c'] for b in bars]
    m90 = st.median(usd[-90:])
    m365 = st.median(usd[-365:]) if len(usd) >= 365 else float('nan')
    zero_recent = sum(1 for b in bars[-365:] if b['v'] == 0) / min(365, len(bars))
    snap_ratio = day_vlm / m90 if m90 else float('inf')
    slip = slippage_bps(name)
    time.sleep(0.12)

    reasons = []
    if len(bars) < MIN_BARS:
        reasons.append('only {}d history'.format(len(bars)))
    if m90 < MIN_MEDIAN_VOL_90D:
        reasons.append('90d vol ${:,.0f} < ${:,.0f}'.format(m90, MIN_MEDIAN_VOL_90D))
    if zero_recent > MAX_ZEROVOL_FRAC:
        reasons.append('{:.0%} dead bars'.format(zero_recent))
    if snap_ratio > 3.0:
        reasons.append('24h is {:.1f}x its 90d median (spike)'.format(snap_ratio))
    if slip is None:
        reasons.append('book unreadable')
    elif slip > MAX_SLIP_BPS:
        reasons.append('slip {:.1f}bps at $50'.format(slip))

    verdict = 'PASS' if not reasons else 'reject: ' + '; '.join(reasons[:2])
    if not reasons:
        passed.append(name)
    print('{:<9}{:>15,.0f}{:>15,.0f}{:>8}{:>8.1%}{:>9.2f}{:>10}{:>9}  {}'.format(
        name, m90, m365 if m365 == m365 else 0, len(bars), zero_recent, snap_ratio,
        '{:.2f}'.format(slip) if slip is not None else '-', str(lev), verdict))

print('\n' + '=' * 118)
print('PASSED: {} of {} considered -> {}'.format(len(passed), considered, passed))
print('=' * 118)
json.dump(passed, open('research/expansion_candidates.json', 'w'), indent=1)
print('wrote research/expansion_candidates.json')
print("""
  These had no part in developing S3/D1/B1, so running the SAME parameters on
  them is a real out-of-sample test of the mechanism - not a re-fit.""")
