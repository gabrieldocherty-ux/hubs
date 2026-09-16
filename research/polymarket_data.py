"""
Polymarket data layer, and an honest statement of what can and cannot be tested.

ACCESS. Polymarket is geo-blocked in Ontario following an April 2025 OSC
enforcement action, with a province-wide ban running to at least April 2027. Gabe
has confirmed he will not be in Ontario. Elsewhere in Canada it remains a legal
grey area - the CSA's 2017 blanket ban on short-term binary options to retail
technically covers prediction-market contracts, and non-enforcement is not the
same thing as permission. That is a fact about the venue, recorded here so it is
not forgotten later.

THE DATA CONSTRAINT, established by three separate probes rather than assumed.
The /prices-history endpoint returns NOTHING for resolved markets - at every
fidelity from 60 to 1440 minutes, with and without explicit startTs/endTs, on ten
different high-volume markets. /batch-prices-history returns HTTP 400. This
matches open issues in Polymarket's own client repository. Resolved markets carry
their settled outcome but their quoted prices have converged to 0 or 1, so they
say nothing about what the market believed beforehand.

The consequence is blunt: THE CLASSIC STUDY CANNOT BE BACKTESTED. Testing
favourite-longshot bias needs the price at some time T against the outcome at
resolution, and the price at time T is not retrievable. Any claim about
calibration built on this API would be fabricated.

SO TWO THINGS ARE BUILT INSTEAD, both of which work on LIVE data only:

  1. COHERENCE / ARBITRAGE SCANNING (poly_arbitrage.py). Some mispricings are
     detectable without any history at all, because they are violations of
     arithmetic rather than of forecasting:
       * A binary market's YES and NO must sum to 1.00. If both can be BOUGHT for
         less than 1.00 combined, the pair pays $1 at resolution whatever happens.
       * A mutually-exclusive, collectively-exhaustive set of outcomes must sum to
         1.00 across all of them.
       * Nested markets must be ordered: "X by June" can never be worth more than
         "X by December", because June happening implies December happening.
     These need no forecast and no history - only current quotes.

  2. FORWARD COLLECTION (poly_collector.py). Snapshot live prices on open markets
     now, wait for them to resolve, then measure calibration properly. This is
     exactly what this project already did for Hyperliquid open interest, which
     the venue also refused to serve historically. Slow, but it is the only route
     to a real calibration study and every day not collecting is a row that can
     never be recovered.

WHAT TO EXPECT, stated before looking. Genuine risk-free arbitrage on a venue this
large should be rare and fleeting in liquid markets. Where it may persist is in
long-dated or illiquid markets - because closing an arbitrage there means locking
capital at ~$0.99 for a year to collect a cent, and almost nobody wants that
trade. Which means the interesting question is not "is there an arb" but "is the
ANNUALISED return on the locked capital worth more than cash", and that is what
the scanner reports.
"""
import datetime
import json
import time
from pathlib import Path

import requests

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
GAMMA = 'https://gamma-api.polymarket.com'
CLOB = 'https://clob.polymarket.com'
CACHE = Path(__file__).parent / 'data'
CACHE.mkdir(exist_ok=True)

# Polymarket historically charged no trading fee, but markets now carry `fee` and
# `feesEnabled` fields, so the fee is read PER MARKET rather than assumed to be
# zero. Gas on Polygon is small but not nil.
GAS_USD = 0.02
RISK_FREE = 0.03          # what locked capital could otherwise earn


# Live request counter. Running flat out without measuring the rate is how you
# find the ceiling by hitting it - and Polymarket throttles by DELAYING rather
# than rejecting, so you would not even get an error, just silently slower data.
STATS = {'requests': 0, 'started': time.time(), 'throttled': 0}


def rate():
    el = max(1e-6, time.time() - STATS['started'])
    return STATS['requests'] / el


def _get(url, params=None, tries=3):
    STATS['requests'] += 1
    for i in range(tries):
        try:
            r = requests.get(url, params=params or {}, headers=UA, timeout=30)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 429:
                STATS['throttled'] += 1
                time.sleep(2.0 * (i + 1))       # back off hard on an explicit 429
        except Exception:
            pass
        time.sleep(0.4 * (i + 1))
    return None


def parse_json_field(v):
    """Gamma returns several fields as JSON-encoded STRINGS rather than arrays."""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return None
    return v


def fetch_open_markets(pages=20, per_page=200, min_volume=0):
    """Every open, active market, newest first. Paginated because the API caps
    each response."""
    out, offset = [], 0
    for _ in range(pages):
        b = _get(GAMMA + '/markets',
                 {'limit': per_page, 'offset': offset, 'closed': 'false',
                  'active': 'true', 'order': 'volumeNum', 'ascending': 'false'})
        if not isinstance(b, list) or not b:
            break
        out.extend(b)
        offset += len(b)
        if len(b) < per_page:
            break
        time.sleep(0.2)
    if min_volume:
        out = [m for m in out if float(m.get('volumeNum') or 0) >= min_volume]
    return out


def fetch_expiring_soon(pages=30, per_page=100, max_hours=6.0):
    """Open markets ordered by END DATE, not volume.

    This exists because ordering by volume silently hides exactly the markets the
    near-expiry study needs. A market resolving in twenty minutes has accumulated
    far less lifetime volume than a presidential election running for two years, so
    a volume-ranked pull returns a hundred long-dated markets and zero short-dated
    ones - which is why the first expiry scan came back empty. The sort key was the
    bug, not the absence of markets.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    iso = now.isoformat().replace('+00:00', 'Z')
    out, offset = [], 0
    for _ in range(pages):
        # end_date_min is essential, not an optimisation. Sorting open markets by
        # endDate ascending WITHOUT it returns thousands of stale markets whose end
        # date is long past but which were never closed, and the genuinely
        # short-dated ones sit far beyond any reasonable page limit. That is why
        # the first two attempts at this returned zero rows at every horizon.
        b = _get(GAMMA + '/markets',
                 {'limit': per_page, 'offset': offset, 'closed': 'false',
                  'active': 'true', 'order': 'endDate', 'ascending': 'true',
                  'end_date_min': iso})
        if not isinstance(b, list) or not b:
            break
        stop = False
        for m in b:
            d = days_to_resolution(m, now)
            if d is None or d <= 0:
                continue
            if d * 24 <= max_hours:
                out.append(m)
            else:
                stop = True          # ascending, so everything after is later
        offset += len(b)
        if stop or len(b) < per_page:
            break
        time.sleep(0.05)     # 0.2s x 30 pages was 6s of pure sleep per pass
    return out


def fetch_events(pages=12, per_page=100):
    """Events group related markets - an election with one market per candidate,
    say. Grouping matters because the coherence tests are defined across a GROUP
    of markets, not within one."""
    out, offset = [], 0
    for _ in range(pages):
        b = _get(GAMMA + '/events',
                 {'limit': per_page, 'offset': offset, 'closed': 'false',
                  'active': 'true', 'order': 'volume', 'ascending': 'false'})
        if not isinstance(b, list) or not b:
            break
        out.extend(b)
        offset += len(b)
        if len(b) < per_page:
            break
        time.sleep(0.2)
    return out


def book(token_id):
    """Live order book for one outcome token. bids are descending, asks ascending."""
    return _get(CLOB + '/book', {'token_id': token_id})


def best_prices(m):
    """Best bid/ask for the YES side, from the gamma snapshot.

    bestBid can be None on a market nobody is bidding, which is common on dead
    longshots - returning None rather than 0 keeps that distinguishable from a
    genuine zero bid.
    """
    def f(x):
        try:
            return float(x)
        except (TypeError, ValueError):
            return None
    return f(m.get('bestBid')), f(m.get('bestAsk')), f(m.get('lastTradePrice'))


def days_to_resolution(m, now=None):
    d = m.get('endDate') or m.get('endDateIso')
    if not d:
        return None
    try:
        end = datetime.datetime.fromisoformat(d.replace('Z', '+00:00'))
    except Exception:
        return None
    now = now or datetime.datetime.now(datetime.timezone.utc)
    return max(0.0, (end - now).total_seconds() / 86400.0)


def annualise(profit_frac, days):
    """Annualised return on capital that is LOCKED until resolution.

    This is the number that decides whether a prediction-market trade is worth
    doing at all. A 1.5% edge is excellent over a week and worthless over three
    years, and prediction markets are full of the second kind - which is precisely
    why the obvious mispricings persist.
    """
    if not days or days <= 0:
        return 0.0
    yrs = days / 365.0
    if yrs < 1 / 365:
        yrs = 1 / 365
    try:
        return (1 + profit_frac) ** (1 / yrs) - 1
    except Exception:
        return 0.0


def market_fee(m):
    try:
        if m.get('feesEnabled'):
            return float(m.get('fee') or 0) / 10_000.0    # bps -> fraction
    except Exception:
        pass
    return 0.0


if __name__ == '__main__':
    print('=' * 100)
    print('POLYMARKET DATA AVAILABILITY - what can actually be used')
    print('=' * 100)
    mk = fetch_open_markets(pages=6, min_volume=1000)
    print('open markets with >$1k volume: {}'.format(len(mk)))
    with_quotes = [m for m in mk if best_prices(m)[0] is not None
                   and best_prices(m)[1] is not None]
    print('with a two-sided quote:        {}'.format(len(with_quotes)))
    fees = [market_fee(m) for m in mk]
    print('markets charging a fee:        {} of {}'.format(
        sum(1 for f in fees if f > 0), len(fees)))
    horizons = [d for d in (days_to_resolution(m) for m in mk) if d is not None]
    if horizons:
        horizons.sort()
        print('days to resolution: min {:.0f}  median {:.0f}  max {:.0f}'.format(
            horizons[0], horizons[len(horizons) // 2], horizons[-1]))
        print('  resolving within 30 days: {}'.format(sum(1 for d in horizons if d <= 30)))
        print('  resolving within 7 days:  {}'.format(sum(1 for d in horizons if d <= 7)))
    ev = fetch_events(pages=3)
    print('\nevents pulled: {}'.format(len(ev)))
    multi = [e for e in ev if len(e.get('markets') or []) > 2]
    print('events with 3+ markets (coherence-testable): {}'.format(len(multi)))
    if multi:
        e = multi[0]
        print('  example: "{}" with {} outcomes'.format(
            (e.get('title') or '')[:60], len(e['markets'])))
