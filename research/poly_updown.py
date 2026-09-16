"""
Testing the idea properly: is a near-expiry "Up or Down" contract mispriced?

THE IDEA, as put: when a contract trades around 0.80 shortly before it ends, it
resolves a particular way often enough to be worth trading. That is the
favourite-longshot bias, and it is one of the best-replicated findings in wagering
markets - so it deserves a real test rather than an opinion.

WHY THESE MARKETS MAKE IT TESTABLE, where nothing else on Polymarket was. A
"Bitcoin Up or Down - 9:45PM-10:00PM ET" contract resolves YES if BTC ends the
window above where it STARTED it. That means the strike is a known price at a
known instant, so at any moment inside the window the true probability is:

    P(YES) = P( BTC's move over the remaining minutes > -(how far it is already up) )

Every term on the right is measurable. The current gap comes from live price
against the window's opening price; the distribution of remaining moves comes from
5,058 real one-minute candles. So fair value can be computed CONTINUOUSLY and
compared to what is quoted, with no waiting for resolutions and no reliance on
Polymarket's absent price history.

WHAT WOULD MAKE THE IDEA WORK, stated before the numbers: quotes sitting
systematically BELOW fair value at high prices. A contract worth 0.95 quoted at
0.80 is the favourite being underpriced, which is the bias, and buying it is the
trade. Quotes matching fair value means the market is efficient at this horizon
and the idea does not pay as stated - in which case the honest move is to change
the idea rather than the standard.

THE RISK THAT DOES NOT SHOW UP IN ANY OF THIS. Polymarket settles against its own
declared source at its own declared instant, not against Hyperliquid's last trade.
Every fair value here is computed from Hyperliquid. If the two sources disagree by
a few dollars at the settlement moment - entirely possible on a contract whose
outcome turns on a $20 move - the trade can be right about the world and still
lose. That basis risk is unmeasurable from here and is the single largest reason
to size small.
"""
import datetime
import re
import statistics as st
import sys
from zoneinfo import ZoneInfo

sys.path.insert(0, 'research')
import hl_data
import polymarket_data as pm

ET = ZoneInfo('America/New_York')
UTC = datetime.timezone.utc

# "Bitcoin Up or Down - September 12, 9:45PM-10:00PM ET"
RANGE_RE = re.compile(
    r'([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*([AP]M)\s*-\s*'
    r'(\d{1,2})(?::(\d{2}))?\s*([AP]M)', re.I)
# "Bitcoin Up or Down - September 12, 9PM ET"  (an hourly window)
SINGLE_RE = re.compile(r'([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*([AP]M)', re.I)
MONTHS = {m: i + 1 for i, m in enumerate(
    ['january', 'february', 'march', 'april', 'may', 'june', 'july',
     'august', 'september', 'october', 'november', 'december'])}


def _mk(month, day, hh, mm, ampm, year):
    h = int(hh) % 12
    if ampm.upper() == 'PM':
        h += 12
    return datetime.datetime(year, month, int(day), h, int(mm or 0), tzinfo=ET)


def parse_window(q, end_iso):
    """Recover the window's start and end from the question text.

    The end date is also available as a field, but the START is only in the title,
    and the start is what defines the strike - so the title has to be parsed.
    """
    try:
        end_dt = datetime.datetime.fromisoformat((end_iso or '').replace('Z', '+00:00'))
    except Exception:
        return None, None
    yr = end_dt.astimezone(ET).year
    m = RANGE_RE.search(q or '')
    if m:
        mon = MONTHS.get(m.group(1).lower())
        if not mon:
            return None, None
        s = _mk(mon, m.group(2), m.group(3), m.group(4), m.group(5), yr)
        e = _mk(mon, m.group(2), m.group(6), m.group(7), m.group(8), yr)
        if e <= s:
            e += datetime.timedelta(hours=12)
        return s.astimezone(UTC), e.astimezone(UTC)
    m = SINGLE_RE.search(q or '')
    if m:
        mon = MONTHS.get(m.group(1).lower())
        if not mon:
            return None, None
        s = _mk(mon, m.group(2), m.group(3), m.group(4), m.group(5), yr)
        return s.astimezone(UTC), (s + datetime.timedelta(hours=1)).astimezone(UTC)
    return None, None


COIN_RE = [('bitcoin', 'BTC'), ('ethereum', 'ETH'), ('solana', 'SOL')]


def coin_of(q):
    ql = (q or '').lower()
    for name, tag in COIN_RE:
        if name in ql:
            return tag
    return None


# ------------------------------------------------------------------ price data
PRICES, DISTS = {}, {}
for tag in ('BTC', 'ETH', 'SOL'):
    try:
        # refresh=True is mandatory here, not a nicety. hl_data caches to disk,
        # and a cache even a few minutes old makes every in-progress window read a
        # gap of exactly 0.000% - because the window's start time falls after the
        # last cached candle, so "price at start" and "price now" resolve to the
        # same stale bar. That silently turns a live edge calculation into noise.
        bars, rep = hl_data.get_candles(tag, '1m', 30, refresh=True)
        PRICES[tag] = {b['t'] // 60000: b['c'] for b in bars if b['c'] > 0}
        cl = [b['c'] for b in bars if b['c'] > 0]
        DISTS[tag] = {n: [cl[i + n] / cl[i] - 1 for i in range(len(cl) - n)]
                      for n in (1, 2, 3, 5, 8, 12, 20, 30, 45, 60)}
        import datetime as _dt
        age = (_dt.datetime.now(_dt.timezone.utc)
               - _dt.datetime.fromtimestamp(rep['last'] / 1000, _dt.timezone.utc))
        print('{} : {} candles, latest ${:,.2f}, data age {:.1f} min'.format(
            tag, len(cl), cl[-1], age.total_seconds() / 60))
        if age.total_seconds() > 300:
            print('   WARNING: data is stale, gap calculations will be wrong')
    except Exception as e:
        print('{} failed: {}'.format(tag, e))


def price_at(tag, dt):
    """Price at a given minute, walking back a little if that minute is missing."""
    key = int(dt.timestamp()) // 60
    for back in range(0, 15):
        if key - back in PRICES.get(tag, {}):
            return PRICES[tag][key - back]
    return None


def fair_up(tag, gap, mins_left):
    """P(the window closes above where it opened), given how far it is up now."""
    d = DISTS.get(tag)
    if not d:
        return None
    n = min(d, key=lambda x: abs(x - max(1, mins_left)))
    mv = d[n]
    return sum(1 for m in mv if m > -gap) / len(mv)


# ------------------------------------------------------------------ live scan
print('\n' + '=' * 118)
print('LIVE "UP OR DOWN" MARKETS: quoted price vs computed fair value')
print('=' * 118)
now = datetime.datetime.now(UTC)
mk = pm.fetch_expiring_soon(max_hours=1.5)
rows = []
for m in mk:
    q = m.get('question') or ''
    if 'up or down' not in q.lower():
        continue
    tag = coin_of(q)
    if not tag or tag not in PRICES:
        continue
    s, e = parse_window(q, m.get('endDate'))
    if not s:
        continue
    p0 = price_at(tag, s)
    p1 = PRICES[tag][max(PRICES[tag])]
    if not p0:
        continue
    gap = p1 / p0 - 1.0
    mins = max(0.1, (e - now).total_seconds() / 60.0) if e else 1.0
    fv = fair_up(tag, gap, int(round(mins)))
    bid, ask, last = pm.best_prices(m)
    if fv is None or ask is None:
        continue
    rows.append({'q': q[:46], 'tag': tag, 'p0': p0, 'p1': p1, 'gap': gap,
                 'mins': mins, 'fv': fv, 'bid': bid, 'ask': ask,
                 'buy_edge': fv - ask,
                 'sell_edge': (bid - fv) if bid is not None else None})

rows.sort(key=lambda r: -(r['buy_edge'] or -9))
print('  BTC ${:,.0f}   |   {} Up/Down markets parsed'.format(
    PRICES['BTC'][max(PRICES['BTC'])] if 'BTC' in PRICES else 0, len(rows)))
if rows:
    print('\n  {:46}{:>7}{:>9}{:>8}{:>8}{:>8}{:>10}{:>10}'.format(
        'market', 'mins', 'gap now', 'bid', 'ask', 'FAIR', 'buy edge', 'sell edge'))
    print('  ' + '-' * 106)
    for r in rows[:18]:
        print('  {:46}{:>7}{:>9}{:>8}{:>8}{:>8}{:>10}{:>10}'.format(
            r['q'], '{:.1f}'.format(r['mins']), '{:+.3%}'.format(r['gap']),
            '{:.3f}'.format(r['bid']) if r['bid'] is not None else '-',
            '{:.3f}'.format(r['ask']), '{:.3f}'.format(r['fv']),
            '{:+.3f}'.format(r['buy_edge']),
            '{:+.3f}'.format(r['sell_edge']) if r['sell_edge'] is not None else '-'))

    edges = [r['buy_edge'] for r in rows]
    print('\n  buy-side edge across all {} markets: mean {:+.3f}  median {:+.3f}'.format(
        len(edges), st.mean(edges), st.median(edges)))
    hi = [r for r in rows if r['ask'] >= 0.70]
    if hi:
        he = [r['buy_edge'] for r in hi]
        print('  among FAVOURITES (ask >= 0.70), n={}: mean {:+.3f}  median {:+.3f}'.format(
            len(hi), st.mean(he), st.median(he)))
    lo = [r for r in rows if r['ask'] <= 0.30]
    if lo:
        le = [r['buy_edge'] for r in lo]
        print('  among LONGSHOTS  (ask <= 0.30), n={}: mean {:+.3f}  median {:+.3f}'.format(
            len(lo), st.mean(le), st.median(le)))
    print("""
  THE TEST OF THE IDEA IS THE LAST TWO LINES. If favourites show a POSITIVE mean
  edge and longshots a NEGATIVE one, the favourite-longshot bias is present and
  buying favourites near expiry is the trade. If both sit near zero, this market is
  efficient at this horizon and the idea needs changing rather than defending.

  One snapshot is not evidence, whatever it says - it is one draw from a noisy
  distribution and the spread alone is 1-2 cents. poly_collector.py accumulates
  these; the same table over a few thousand observations is the answer.""")
else:
    print('  no Up/Down markets parsed - check the title format has not changed')
