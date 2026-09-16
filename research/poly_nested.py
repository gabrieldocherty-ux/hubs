"""
Nested-window coherence: a relative-value test that needs no forecast at all.

WHY NOT MARKET MAKING. The obvious play on these markets is to rest orders inside
the spread. It is also the most crowded activity on the venue and Polymarket
actively SUBSIDISES it - every one of the 2,100 near-expiry markets carries
rewardsMaxSpread 4.5 and rewardsMinSize 50, meaning the exchange pays people to
quote within 4.5 cents at $50 minimum size. A $1,000 account entering that is
competing for a subsidy against firms whose entire business is capturing it, while
taking the adverse selection that comes with being filled. It is the base strategy
and it is base for a reason.

THE STRUCTURE NOBODY HAS TO FORECAST. At any moment Polymarket runs SEVERAL
overlapping "Up or Down" windows on the same coin that share the same start:

    Bitcoin Up or Down - 10:00PM-10:05PM     (5 minutes)
    Bitcoin Up or Down - 10:00PM-10:15PM     (15 minutes)
    Bitcoin Up or Down - 10PM ET             (60 minutes)

All three ask the same question - "will BTC be above its 10:00PM price?" - at three
different horizons, against ONE shared reference price. That makes them linked by
arithmetic rather than by opinion, and the link is a strict ordering:

    IF PRICE IS CURRENTLY ABOVE the start, more time left means more chance to give
    the lead back, so:      P(5min) > P(15min) > P(60min)

    IF PRICE IS CURRENTLY BELOW the start, more time left means more chance to
    recover, so:            P(5min) < P(15min) < P(60min)

Both orderings converge toward 0.5 as the horizon lengthens, because a longer
window is closer to a coin flip. This is not a model - it is a property of any
process whose increments are roughly symmetric, and it holds whatever the drift or
volatility happens to be.

A MARKET THAT VIOLATES THE ORDERING IS INTERNALLY INCONSISTENT, and the trade is to
buy the one that is too cheap and sell the one that is too dear. No view on
Bitcoin is required, no price feed is required, and crucially the position is a
SPREAD - so being wrong about direction costs nothing as long as the inconsistency
closes.

WHY THIS MIGHT ACTUALLY BE UNCROWDED, unlike making. The liquidity rewards pay for
quoting INSIDE ONE MARKET. Nothing pays anyone to enforce consistency ACROSS
markets, and the three windows are separate order books with separate makers.
Cross-book relationships are exactly what tends to get left unpoliced on venues
where the incentives are per-book.

WHAT WOULD KILL IT, checked below: violations may be smaller than the spread that
has to be crossed twice to capture them, which is the same wall that has killed
most fast ideas in this project. That is measured, not assumed.
"""
import datetime
import re
import statistics as st
import sys
from collections import defaultdict
from zoneinfo import ZoneInfo

sys.path.insert(0, 'research')
import polymarket_data as pm

ET = ZoneInfo('America/New_York')
UTC = datetime.timezone.utc
RANGE_RE = re.compile(
    r'([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*([AP]M)\s*-\s*'
    r'(\d{1,2})(?::(\d{2}))?\s*([AP]M)', re.I)
SINGLE_RE = re.compile(r'([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*([AP]M)\s*ET', re.I)
MONTHS = {m: i + 1 for i, m in enumerate(
    ['january', 'february', 'march', 'april', 'may', 'june', 'july',
     'august', 'september', 'october', 'november', 'december'])}
COINS = [('bitcoin', 'BTC'), ('ethereum', 'ETH'), ('solana', 'SOL'),
         ('xrp', 'XRP'), ('bnb', 'BNB'), ('zcash', 'ZEC'), ('dogecoin', 'DOGE')]


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
    m = RANGE_RE.search(q or '')
    if m and MONTHS.get(m.group(1).lower()):
        mon = MONTHS[m.group(1).lower()]
        s = _mk(mon, m.group(2), m.group(3), m.group(4), m.group(5), yr)
        e = _mk(mon, m.group(2), m.group(6), m.group(7), m.group(8), yr)
        if e <= s:
            e += datetime.timedelta(hours=12)
        return s, e
    m = SINGLE_RE.search(q or '')
    if m and MONTHS.get(m.group(1).lower()):
        mon = MONTHS[m.group(1).lower()]
        s = _mk(mon, m.group(2), m.group(3), m.group(4), m.group(5), yr)
        return s, s + datetime.timedelta(hours=1)
    return None, None


def coin_of(q):
    ql = (q or '').lower()
    for name, tag in COINS:
        if name in ql:
            return tag
    return None


print('=' * 116)
print('NESTED-WINDOW COHERENCE ON "UP OR DOWN" MARKETS')
print('=' * 116)
mk = pm.fetch_expiring_soon(max_hours=3.0)
now = datetime.datetime.now(UTC)

groups = defaultdict(list)
for m in mk:
    q = m.get('question') or ''
    if 'up or down' not in q.lower():
        continue
    tag = coin_of(q)
    s, e = window(q, m.get('endDate'))
    if not tag or not s or not e:
        continue
    bid, ask, last = pm.best_prices(m)
    if bid is None or ask is None:
        continue
    groups[(tag, s)].append({
        'q': q[:44], 'start': s, 'end': e,
        'dur': (e - s).total_seconds() / 60.0,
        'left': (e.astimezone(UTC) - now).total_seconds() / 60.0,
        'bid': bid, 'ask': ask, 'mid': (bid + ask) / 2.0,
        'spread': ask - bid, 'vol': float(m.get('volumeNum') or 0)})

multi = {k: sorted(v, key=lambda r: r['dur']) for k, v in groups.items() if len(v) >= 2}
print('  Up/Down markets found: {}'.format(sum(len(v) for v in groups.values())))
print('  shared-start groups with 2+ horizons: {}'.format(len(multi)))

if not multi:
    print('\n  No overlapping windows in this pull - the nested structure only exists')
    print('  while several horizons on the same start are simultaneously open.')
    raise SystemExit(0)

print('\n  {:10}{:>7}{:>9}{:>8}{:>8}{:>8}{:>9}{:>10}'.format(
    'coin@start', 'dur', 'left', 'bid', 'ask', 'mid', 'spread', 'ordering'))
print('  ' + '-' * 76)
violations = []
for (tag, s), rows in sorted(multi.items(), key=lambda kv: kv[0][1]):
    if len(rows) < 2:
        continue
    lab = '{}@{}'.format(tag, s.astimezone(ET).strftime('%H:%M'))
    mids = [r['mid'] for r in rows]
    # Which side of the start price the group implies: if the SHORTEST window is
    # above 0.5 the market thinks price is currently up, and vice versa. This is
    # inferred from the quotes themselves rather than from a price feed, which is
    # what makes the test independent of any data source.
    up = mids[0] > 0.5
    ok = all(mids[i] >= mids[i + 1] for i in range(len(mids) - 1)) if up else \
         all(mids[i] <= mids[i + 1] for i in range(len(mids) - 1))
    for i, r in enumerate(rows):
        print('  {:10}{:>7}{:>9}{:>8}{:>8}{:>8}{:>9}{:>10}'.format(
            lab if i == 0 else '', '{:.0f}m'.format(r['dur']),
            '{:.1f}m'.format(r['left']), '{:.3f}'.format(r['bid']),
            '{:.3f}'.format(r['ask']), '{:.3f}'.format(r['mid']),
            '{:.3f}'.format(r['spread']),
            ('OK' if ok else 'VIOLATION') if i == 0 else ''))
    if not ok:
        # size the inconsistency, and price it against the cost of capturing it
        worst = 0.0
        pair = None
        for i in range(len(rows) - 1):
            a, b = rows[i], rows[i + 1]
            gap = (b['mid'] - a['mid']) if up else (a['mid'] - b['mid'])
            if gap > worst:
                worst, pair = gap, (a, b)
        if pair:
            cost = pair[0]['spread'] / 2 + pair[1]['spread'] / 2
            violations.append({'lab': lab, 'size': worst, 'cost': cost,
                               'net': worst - cost, 'left': rows[0]['left']})

print('\n' + '=' * 116)
print('VIOLATIONS, PRICED AGAINST THE COST OF CAPTURING THEM')
print('=' * 116)
if violations:
    print('  {:16}{:>14}{:>16}{:>14}{:>12}'.format(
        'group', 'inconsistency', 'spread to cross', 'net', 'mins left'))
    print('  ' + '-' * 72)
    for v in sorted(violations, key=lambda x: -x['net']):
        print('  {:16}{:>14}{:>16}{:>14}{:>12}'.format(
            v['lab'], '{:.3f}'.format(v['size']), '{:.3f}'.format(v['cost']),
            '{:+.3f}'.format(v['net']), '{:.1f}'.format(v['left'])))
    good = [v for v in violations if v['net'] > 0]
    print('\n  violations exceeding their execution cost: {} of {}'.format(
        len(good), len(violations)))
else:
    print('  none - every shared-start group is internally consistent')

spreads = [r['spread'] for v in multi.values() for r in v]
if spreads:
    print('\n  median spread on these markets: {:.3f} ({:.1f} cents)'.format(
        st.median(spreads), st.median(spreads) * 100))
    print("""
  THE BAR THIS HAS TO CLEAR. Capturing an inconsistency means crossing the spread
  on BOTH legs, so the violation must exceed roughly one full spread to be worth
  anything. With a median spread around the value above, an inconsistency smaller
  than that is real but untradeable - the same wall that killed intraday basis on
  Hyperliquid and the opening-range setup on the TSX.

  ONE SNAPSHOT PROVES NOTHING EITHER WAY. What matters is whether violations recur
  and whether they are systematically larger than the spread. poly_collector.py
  should record these groups on every pass so the question has an answer measured
  over thousands of observations rather than one look.""")
