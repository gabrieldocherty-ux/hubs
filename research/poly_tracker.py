"""
Per-minute tracker: contract price against the underlying, all the way to expiry.

WHAT THIS RECORDS AND WHY EACH FIELD IS THERE. Once a minute, for every crypto
"Up or Down" market close to resolving:

    contract bid/ask/last   what Polymarket is charging
    underlying price now    what the coin is actually doing, from Hyperliquid
    PRICE TO BEAT           the coin's price at the window's START - the strike
    gap                     how far above/below the strike the coin currently is
    minutes left            how much time remains

The whole point is the JOIN. A single snapshot says whether one quote looked
sensible. A minute-by-minute series says how the quote MOVED as the underlying
moved, which is a different and much more useful question.

THE EDGE THIS IS BUILT TO DETECT, and it is not market making. If the contract
price responds to the underlying with a LAG - Bitcoin moves at 10:03:00 and the
contract only reprices by 10:03:40 - then anyone watching the coin knows the
contract's fair value before the contract does. That is a real microstructure
edge, it requires no inventory and no quoting, and crucially nothing in
Polymarket's liquidity-reward programme pays anyone to remove it: the rewards pay
for quoting inside a spread in ONE book, not for keeping a book synchronised with
an external price feed.

Whether the lag exists is an empirical question, which is what the analysis below
measures: does the change in the underlying's gap at minute t predict the change
in contract price at minute t+1? A positive relationship means the contract
follows, and the size of it says how much.

WHAT WOULD MAKE IT UNTRADEABLE EVEN IF REAL. The median spread on these markets is
one cent on a fifty-cent contract - a 2% round trip. A lag worth less than that is
real and unprofitable, which has been the fate of nearly every fast idea in this
project. The analysis therefore reports the lag in cents next to the spread in
cents, because only the comparison matters.

RUN IT EVERY MINUTE. A five-minute market observed once tells you almost nothing;
observed five times it tells you a trajectory. The scheduler entry is in the
docstring at the bottom.
"""
import datetime
import json
import pathlib
import re
import sys
from zoneinfo import ZoneInfo

# Absolute, not relative. A scheduled task does not inherit the project root as
# its working directory, and a relative 'research' path makes the import fail
# silently under the scheduler while working perfectly when run by hand.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import hl_data
import polymarket_data as pm

ET = ZoneInfo('America/New_York')
UTC = datetime.timezone.utc
OUT = pathlib.Path(__file__).parent.parent / 'data' / 'poly_track.jsonl'
OUT.parent.mkdir(exist_ok=True)

# All EIGHT assets Polymarket runs Up/Down markets on, each verified to have a
# Hyperliquid perp feed so fair value is computable. The previous list covered
# only five and silently dropped BNB, ZCash and Hyperliquid - roughly 259 markets
# a day, a 60% coverage gap that showed up nowhere because the filter just
# returned fewer rows.
#
# ORDER MATTERS. 'hyperliquid' must be tested before 'hype' or the longer name
# would never match, and the asset would be mis-tagged. Polymarket uses both
# spellings for the same token.
COINS = [('bitcoin', 'BTC'), ('ethereum', 'ETH'), ('solana', 'SOL'),
         ('xrp', 'XRP'), ('dogecoin', 'DOGE'), ('bnb', 'BNB'),
         ('zcash', 'ZEC'), ('hyperliquid', 'HYPE'), ('hype', 'HYPE')]
RANGE_RE = re.compile(
    r'([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*([AP]M)\s*-\s*'
    r'(\d{1,2})(?::(\d{2}))?\s*([AP]M)', re.I)
SINGLE_RE = re.compile(
    r'([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*([AP]M)\s*ET', re.I)
MONTHS = {m: i + 1 for i, m in enumerate(
    ['january', 'february', 'march', 'april', 'may', 'june', 'july',
     'august', 'september', 'october', 'november', 'december'])}


def _mk(mon, day, hh, mm, ampm, yr):
    h = int(hh) % 12
    if ampm.upper() == 'PM':
        h += 12
    return datetime.datetime(yr, mon, int(day), h, int(mm or 0), tzinfo=ET)


def window(q, end_iso):
    try:
        yr = datetime.datetime.fromisoformat(
            (end_iso or '').replace('Z', '+00:00')).astimezone(ET).year
    except Exception:
        return None, None
    for rx, ranged in ((RANGE_RE, True), (SINGLE_RE, False)):
        m = rx.search(q or '')
        if not m or not MONTHS.get(m.group(1).lower()):
            continue
        mon = MONTHS[m.group(1).lower()]
        s = _mk(mon, m.group(2), m.group(3), m.group(4), m.group(5), yr)
        if ranged:
            e = _mk(mon, m.group(2), m.group(6), m.group(7), m.group(8), yr)
            if e <= s:
                e += datetime.timedelta(hours=12)
        else:
            e = s + datetime.timedelta(hours=1)
        return s.astimezone(UTC), e.astimezone(UTC)
    return None, None


def coin_of(q):
    ql = (q or '').lower()
    for name, tag in COINS:
        if name in ql:
            return tag
    return None


_PX_CACHE = {'at': 0.0, 'prices': {}}


def _underlying(max_age=15.0):
    """Underlying prices, refreshed at most every `max_age` seconds.

    The series is MINUTE candles, so re-fetching five coins on a ten-second loop
    buys nothing and costs five API round trips plus most of the pass's latency.
    A 30-second cache keeps the data at worst half a candle stale - invisible at
    minute resolution - while cutting the tick from ~5s to well under one.

    The cache is still bounded, deliberately. An UNBOUNDED cache is what made
    every gap read exactly 0.000% earlier: the window's start fell after the last
    cached candle, so 'price at start' and 'price now' resolved to the same bar.
    """
    import time as _t
    if _t.time() - _PX_CACHE['at'] < max_age and _PX_CACHE['prices']:
        return _PX_CACHE['prices']
    # Fetched CONCURRENTLY. Eight coins fetched one after another cost 6.41
    # seconds - by far the dominant term in a pass that otherwise takes 1.89s,
    # and the reason the configured 10-second cadence was really running at 19.6s.
    # These are independent network round trips, so there is no reason to wait for
    # each before starting the next.
    from concurrent.futures import ThreadPoolExecutor

    def _one(tag):
        try:
            bars, _rep = hl_data.get_candles(tag, '1m', 2, refresh=True)
            return tag, {b['t'] // 60000: b['c'] for b in bars if b['c'] > 0}
        except Exception:
            return tag, None

    tags = sorted({t for _n, t in COINS})
    prices = {}
    with ThreadPoolExecutor(max_workers=len(tags)) as ex:
        for tag, got in ex.map(_one, tags):
            if got:
                prices[tag] = got
    if prices:
        _PX_CACHE['at'] = _t.time()
        _PX_CACHE['prices'] = prices
    return prices


def track(max_hours=1.5):
    now = datetime.datetime.now(UTC)
    prices = _underlying()

    def px_at(tag, dt):
        key = int(dt.timestamp()) // 60
        for back in range(0, 20):
            if key - back in prices.get(tag, {}):
                return prices[tag][key - back]
        return None

    mk = pm.fetch_expiring_soon(max_hours=max_hours)
    rows = []
    for m in mk:
        q = m.get('question') or ''
        if 'up or down' not in q.lower():
            continue
        tag = coin_of(q)
        if not tag or tag not in prices or not prices[tag]:
            continue
        s, e = window(q, m.get('endDate'))
        if not s or not e:
            continue
        spot = prices[tag][max(prices[tag])]
        beat = px_at(tag, s)            # the price to beat = the window's open
        bid, ask, last = pm.best_prices(m)
        if bid is None and ask is None:
            continue
        started = now >= s
        rows.append({
            'ts': now.isoformat(timespec='seconds'),
            'id': m.get('id'), 'q': q[:110], 'coin': tag,
            'start': s.isoformat(timespec='seconds'),
            'end': e.isoformat(timespec='seconds'),
            'dur_min': round((e - s).total_seconds() / 60.0, 1),
            'mins_left': round((e - now).total_seconds() / 60.0, 2),
            'started': started,
            'bid': bid, 'ask': ask, 'last': last,
            'mid': (bid + ask) / 2.0 if (bid is not None and ask is not None) else last,
            'spread': (ask - bid) if (bid is not None and ask is not None) else None,
            'spot': spot,
            'beat': beat,                       # price to beat
            'gap': (spot / beat - 1.0) if beat else None,
        })
    if rows:
        with OUT.open('a', encoding='utf-8') as f:
            for r in rows:
                f.write(json.dumps(r) + '\n')
    return rows


def analyse():
    """Does the contract price FOLLOW the underlying, and by how much?

    Builds each market's time series, then asks two things:
      1. How tightly does contract price track the gap CONTEMPORANEOUSLY?
      2. Does the change in gap at minute t predict the change in contract price
         at minute t+1? A positive lagged relationship is the lag - the contract
         still catching up to a move the coin already made.
    """
    import statistics as st
    from collections import defaultdict
    if not OUT.exists():
        print('  no data yet - run: poly_tracker.py track')
        return
    series = defaultdict(list)
    for line in OUT.open(encoding='utf-8'):
        try:
            r = json.loads(line)
        except Exception:
            continue
        if r.get('gap') is None or r.get('mid') is None or not r.get('started'):
            continue
        series[r['id']].append(r)
    stamps = {r['ts'] for v in series.values() for r in v}
    print('  markets tracked: {}   observations: {}   distinct minutes: {}'.format(
        len(series), sum(len(v) for v in series.values()), len(stamps)))
    usable = {k: sorted(v, key=lambda x: x['ts']) for k, v in series.items()
              if len(v) >= 3}
    print('  markets with 3+ observations: {}'.format(len(usable)))
    if not usable:
        print("""
  Not enough yet. Each market needs several minutes of observations before a
  trajectory exists, which means running this every minute rather than on demand.""")
        return

    same, lagged, spreads = [], [], []
    for rows in usable.values():
        for i in range(1, len(rows)):
            dg = rows[i]['gap'] - rows[i - 1]['gap']
            dp = rows[i]['mid'] - rows[i - 1]['mid']
            if dg != 0:
                same.append((dg, dp))
            if i + 1 < len(rows):
                dp_next = rows[i + 1]['mid'] - rows[i]['mid']
                if dg != 0:
                    lagged.append((dg, dp_next))
        spreads += [r['spread'] for r in rows if r['spread'] is not None]

    def corr(pairs):
        if len(pairs) < 10:
            return None
        a = [x for x, _ in pairs]
        b = [y for _, y in pairs]
        ma, mb = st.mean(a), st.mean(b)
        va = sum((x - ma) ** 2 for x in a) ** 0.5
        vb = sum((y - mb) ** 2 for y in b) ** 0.5
        return sum((a[i] - ma) * (b[i] - mb) for i in range(len(a))) / (va * vb) \
            if va and vb else None

    cs, cl = corr(same), corr(lagged)
    print('\n  corr( gap change at t , contract change at t   ) = {}   n={}'.format(
        '{:+.3f}'.format(cs) if cs is not None else 'too few', len(same)))
    print('  corr( gap change at t , contract change at t+1 ) = {}   n={}'.format(
        '{:+.3f}'.format(cl) if cl is not None else 'too few', len(lagged)))
    if spreads:
        print('  median spread: {:.3f} ({:.1f} cents)'.format(
            st.median(spreads), st.median(spreads) * 100))
    print("""
  THE SECOND NUMBER IS THE ONE THAT MATTERS. If it is near zero the contract has
  already fully absorbed the move by the time the minute closes, and there is
  nothing to trade. If it is clearly positive the contract is still catching up -
  and the size of the catch-up, in cents, has to beat the spread in cents before
  any of it is worth doing.""")


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'track'
    if cmd == 'track':
        rows = track()
        started = [r for r in rows if r['started']]
        print('{}  recorded {} markets ({} in progress)'.format(
            datetime.datetime.now(UTC).strftime('%H:%M:%S'), len(rows), len(started)))
        for r in sorted(started, key=lambda x: x['mins_left'])[:6]:
            print('  {:34} {:>6.1f}m left  beat={:.2f} spot={:.2f} gap={:+.3f}%  mid={:.3f}'.format(
                r['q'][:34], r['mins_left'], r['beat'] or 0, r['spot'],
                (r['gap'] or 0) * 100, r['mid'] or 0))
    elif cmd == 'analyse':
        analyse()
    else:
        print('usage: poly_tracker.py [track|analyse]')
