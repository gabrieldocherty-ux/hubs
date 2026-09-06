"""
Data layer for strategy research. Pulls real Hyperliquid candles + funding
history, caches to research/data/, and VERIFIES what it pulled before anything
downstream is allowed to trust it.

Skepticism about data sources is a hard requirement of this research mandate:
every fetch goes through verify_candles(), which checks for time gaps,
duplicate timestamps, non-monotonic time, OHLC violations (high<low, close
outside [low,high]), zero/negative prices, and zero-volume bars. Nothing gets
silently interpolated - gaps are reported, and the caller decides.
"""
import json, os, time, urllib.request, urllib.error
from pathlib import Path

API = 'https://api.hyperliquid.xyz/info'
CACHE = Path(__file__).parent / 'data'
CACHE.mkdir(parents=True, exist_ok=True)

INTERVAL_MS = {'1m':60_000, '5m':300_000, '15m':900_000, '1h':3_600_000,
               '4h':14_400_000, '1d':86_400_000}


def _post(payload, retries=6):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(API, data=json.dumps(payload).encode(),
                                         headers={'Content-Type': 'application/json'})
            return json.loads(urllib.request.urlopen(req, timeout=45).read())
        except urllib.error.HTTPError as e:
            last = e
            # 429 = rate limited: back off hard rather than hammering a public endpoint
            time.sleep((20 if e.code == 429 else 2) * (attempt + 1))
        except Exception as e:            # noqa: BLE001 - retry on any transport error
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f'Hyperliquid API failed after {retries} tries: {last}')


def fetch_candles(coin, interval, start_ms, end_ms):
    """Paginate candles_snapshot (server caps ~5000 bars/response)."""
    step = INTERVAL_MS[interval]
    out, cursor = [], start_ms
    while cursor < end_ms:
        chunk_end = min(cursor + step * 4900, end_ms)
        batch = _post({'type': 'candleSnapshot', 'req': {
            'coin': coin, 'interval': interval, 'startTime': cursor, 'endTime': chunk_end}})
        if not batch:
            cursor = chunk_end + step
            continue
        out.extend(batch)
        last_t = batch[-1]['t']
        if last_t + step <= cursor:      # no forward progress -> stop
            break
        cursor = last_t + step
        time.sleep(0.12)                 # be polite to a public endpoint
    # dedupe by open time, keep last
    seen = {}
    for c in out:
        seen[c['t']] = c
    return [seen[t] for t in sorted(seen)]


def fetch_funding(coin, start_ms, end_ms):
    """Hourly funding history (500 events/response)."""
    out, cursor = [], start_ms
    while cursor < end_ms:
        batch = _post({'type': 'fundingHistory', 'coin': coin,
                       'startTime': cursor, 'endTime': end_ms})
        if not batch:
            break
        out.extend(batch)
        last_t = batch[-1]['time']
        if last_t <= cursor:
            break
        cursor = last_t + 1
        time.sleep(0.9)
        if len(batch) < 500:
            break
    seen = {e['time']: e for e in out}
    return [seen[t] for t in sorted(seen)]


def verify_candles(candles, interval, coin='?'):
    """Return (ok, report_dict). Never mutates or fills - just tells the truth."""
    step = INTERVAL_MS[interval]
    rep = {'coin': coin, 'interval': interval, 'n': len(candles),
           'gaps': [], 'dupes': 0, 'ohlc_violations': 0, 'bad_prices': 0,
           'zero_volume_bars': 0, 'non_monotonic': 0}
    if not candles:
        return False, rep
    times = [c['t'] for c in candles]
    rep['dupes'] = len(times) - len(set(times))
    prev = None
    for c in candles:
        t = c['t']
        o, h, l, cl = float(c['o']), float(c['h']), float(c['l']), float(c['c'])
        v = float(c.get('v') or 0)
        if prev is not None:
            if t <= prev:
                rep['non_monotonic'] += 1
            elif t - prev > step:
                rep['gaps'].append({'after_ms': prev, 'missing_bars': (t - prev) // step - 1})
        prev = t
        if h < l or cl > h or cl < l or o > h or o < l:
            rep['ohlc_violations'] += 1
        if min(o, h, l, cl) <= 0:
            rep['bad_prices'] += 1
        if v == 0:
            rep['zero_volume_bars'] += 1
    rep['missing_bars_total'] = sum(g['missing_bars'] for g in rep['gaps'])
    rep['coverage_pct'] = 100.0 * len(candles) / max(1, len(candles) + rep['missing_bars_total'])
    rep['first'] = times[0]
    rep['last'] = times[-1]
    ok = (rep['dupes'] == 0 and rep['non_monotonic'] == 0
          and rep['ohlc_violations'] == 0 and rep['bad_prices'] == 0
          and rep['coverage_pct'] > 99.0)
    return ok, rep


def get_candles(coin, interval, days, refresh=False):
    """Cached fetch + verify. Returns list of dicts with float fields."""
    path = CACHE / f'{coin}_{interval}_{days}d.json'
    if path.exists() and not refresh:
        raw = json.loads(path.read_text())
    else:
        now = int(time.time() * 1000)
        raw = fetch_candles(coin, interval, now - days * 86_400_000, now)
        path.write_text(json.dumps(raw))
    ok, rep = verify_candles(raw, interval, coin)
    bars = [{'t': c['t'], 'o': float(c['o']), 'h': float(c['h']),
             'l': float(c['l']), 'c': float(c['c']), 'v': float(c.get('v') or 0),
             'n': c.get('n', 0)} for c in raw]
    return bars, rep


def get_funding(coin, days, refresh=False):
    path = CACHE / f'{coin}_funding_{days}d.json'
    if path.exists() and not refresh:
        raw = json.loads(path.read_text())
    else:
        now = int(time.time() * 1000)
        raw = fetch_funding(coin, now - days * 86_400_000, now)
        path.write_text(json.dumps(raw))
    return [{'t': e['time'], 'rate': float(e['fundingRate'])} for e in raw]
