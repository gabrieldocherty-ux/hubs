"""
Non-crypto market data, in the same shape the rest of this harness already uses.

Everything in research/ so far has been Hyperliquid perps, where there is no
session and no exchange open. Testing an opening-range strategy needs venues that
HAVE an open, so this pulls equity-hours instruments from Yahoo's public chart
endpoint and hands back the same bar dicts hl_data.py produces:

    {'t': epoch_ms, 'o':, 'h':, 'l':, 'c':, 'v':}

so the analysis code does not care where a series came from.

Two deliberate choices worth stating.

ETFs, NOT FUTURES. NQ=F and GC=F were the obvious picks and are the wrong ones.
Index futures trade close to 23 hours a day, so "the opening range" has no
unambiguous meaning - there is a Globex open, a cash open, and a European open,
and picking one is a free parameter nobody should get to tune. Worse, of the
17,383 hourly NQ=F bars Yahoo returns, only 13,194 carry volume; a VWAP computed
over bars with null volume is not a VWAP. QQQ and GLD trade one clean 09:30-16:00
ET session with a real opening auction and volume on essentially every bar.

REAL TIMEZONES, NOT THE META OFFSET. Yahoo reports a single `gmtoffset` for the
whole response, which is the offset in force TODAY. Grouping two years of bars
into sessions with one fixed offset silently misdates every bar on the other side
of a daylight-saving boundary - roughly half the sample - and would shift the
opening range by an hour for those days. zoneinfo is in the standard library and
knows the actual rules, so sessions are grouped by true exchange-local date.
"""
import datetime
import json
import time
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

CACHE = Path(__file__).parent / 'data'
CACHE.mkdir(exist_ok=True)

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/{}'

# Exchange session, in exchange-local time. Both instruments below are NYSE Arca
# listed and keep US equity regular trading hours.
VENUES = {
    'QQQ': {'tz': 'America/New_York', 'open': (9, 30), 'close': (16, 0),
            'label': 'Nasdaq-100 ETF', 'cost_rt': 0.0004},
    'GLD': {'tz': 'America/New_York', 'open': (9, 30), 'close': (16, 0),
            'label': 'Gold ETF', 'cost_rt': 0.0004},
    'SPY': {'tz': 'America/New_York', 'open': (9, 30), 'close': (16, 0),
            'label': 'S&P 500 ETF', 'cost_rt': 0.0004},
}

# cost_rt above is a ROUND TRIP fraction of notional and is deliberately about
# twice the realistic figure, matching how this project models Hyperliquid
# (0.190% modelled against 0.091-0.100% measured). QQQ's spread is roughly a
# cent on a ~$600 share, i.e. ~0.0017% a side, and commission at a retail broker
# is zero to $0.005/share, so a true round trip is nearer 0.02%. 0.04% is the
# conservative number every result below is produced at.


def fetch(symbol, interval, rng):
    r = requests.get(CHART.format(symbol), headers=UA, timeout=30,
                     params={'interval': interval, 'range': rng})
    r.raise_for_status()
    res = r.json()['chart']['result'][0]
    ts = res['timestamp']
    q = res['indicators']['quote'][0]
    out = []
    for i, t in enumerate(ts):
        o, h, l, c, v = q['open'][i], q['high'][i], q['low'][i], q['close'][i], q['volume'][i]
        if None in (o, h, l, c) or v is None:
            continue                      # Yahoo pads holidays/halts with nulls
        out.append({'t': t * 1000, 'o': float(o), 'h': float(h),
                    'l': float(l), 'c': float(c), 'v': float(v)})
    out.sort(key=lambda b: b['t'])
    return out


def get_bars(symbol, interval='1h', rng='730d', refresh=False):
    path = CACHE / '{}_{}_{}.json'.format(symbol, interval, rng)
    if path.exists() and not refresh:
        bars = json.loads(path.read_text())
    else:
        bars = fetch(symbol, interval, rng)
        path.write_text(json.dumps(bars))
        time.sleep(0.4)                   # be polite to a free endpoint
    return bars, verify(bars, symbol, interval)


def verify(bars, symbol='?', interval='?'):
    """Same spirit as hl_data.verify_candles: say what is wrong with the data
    before anything is inferred from it."""
    rep = {'symbol': symbol, 'interval': interval, 'n': len(bars),
           'ohlc_violations': 0, 'zero_volume': 0, 'dupes': 0}
    if not bars:
        return rep
    seen = set()
    for b in bars:
        if b['t'] in seen:
            rep['dupes'] += 1
        seen.add(b['t'])
        if not (b['l'] <= b['o'] <= b['h'] and b['l'] <= b['c'] <= b['h']):
            rep['ohlc_violations'] += 1
        if b['v'] <= 0:
            rep['zero_volume'] += 1
    rep['first'] = bars[0]['t']
    rep['last'] = bars[-1]['t']
    return rep


def sessions(bars, symbol, min_bars=5):
    """Group bars into exchange-local trading sessions.

    Returns [(date, [bars])] with short sessions dropped. Half days are real -
    the day after Thanksgiving, Christmas Eve - and a 3-bar session cannot
    support a strategy whose first bar is an opening range and which then needs
    room for a break, an extension and a pullback. Dropping them is a data
    decision, so the count is reported rather than hidden.
    """
    tz = ZoneInfo(VENUES[symbol]['tz']) if symbol in VENUES else ZoneInfo('UTC')
    grouped = {}
    for b in bars:
        d = datetime.datetime.fromtimestamp(b['t'] / 1000, tz).date()
        grouped.setdefault(d, []).append(b)
    full, short = [], 0
    for d in sorted(grouped):
        s = grouped[d]
        if len(s) < min_bars:
            short += 1
            continue
        full.append((d, s))
    return full, short


def utc_sessions(bars, anchor_hour=0, min_bars=12):
    """Session grouping for a 24/7 instrument, where no session exists.

    A crypto perp has no open, so one has to be invented. This slices the tape
    at a chosen UTC hour. The choice is arbitrary by construction - that is the
    point of the experiment, and opening_range_vwap.py varies the anchor to show
    the result does not hinge on which arbitrary hour was picked.
    """
    grouped = {}
    for b in bars:
        dt = datetime.datetime.fromtimestamp(b['t'] / 1000, datetime.timezone.utc)
        shifted = dt - datetime.timedelta(hours=anchor_hour)
        grouped.setdefault(shifted.date(), []).append(b)
    full, short = [], 0
    for d in sorted(grouped):
        s = grouped[d]
        if len(s) < min_bars:
            short += 1
            continue
        full.append((d, s))
    return full, short


if __name__ == '__main__':
    for sym in ('QQQ', 'GLD'):
        bars, rep = get_bars(sym, '1h', '730d')
        sess, short = sessions(bars, sym)
        f = datetime.datetime.fromtimestamp(rep['first'] / 1000, datetime.timezone.utc)
        l = datetime.datetime.fromtimestamp(rep['last'] / 1000, datetime.timezone.utc)
        print('{:5} {:6} bars  {} -> {}  {:4} sessions ({} short dropped)  '
              'ohlc_bad={} zero_vol={} dupes={}'.format(
                  sym, rep['n'], f.strftime('%Y-%m-%d'), l.strftime('%Y-%m-%d'),
                  len(sess), short, rep['ohlc_violations'], rep['zero_volume'],
                  rep['dupes']))
        lens = {}
        for _, s in sess:
            lens[len(s)] = lens.get(len(s), 0) + 1
        print('      bars per session: {}'.format(
            ', '.join('{}x{}'.format(v, k) for k, v in sorted(lens.items()))))
