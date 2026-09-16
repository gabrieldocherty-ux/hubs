"""
Cross-source divergence monitor: the check that would have caught the artefact.

WHAT THIS IS FOR, stated plainly because it came out of a real failure. This
project published a strategy with a Sharpe of 3.30 and an alpha t-statistic of
11.55, and it was wrong. The overnight "risk premium" on VFV.TO was an artefact of
that fund's opening prints, not a property of the market. It was caught only
because two ETFs tracking the SAME index happened to disagree by 5.7 percentage
points a year - a coincidence of the universe, not a control.

The general lesson, which applies far past that one strategy:

    INTERNAL CONSISTENCY PROVES A SERIES IS WELL-FORMED.
    ONLY AN INDEPENDENT MEASUREMENT PROVES IT IS CORRECT.

Every OHLC check, every duplicate scan, every gap test in this repo asks whether a
series is self-consistent. None of them can detect a feed that is confidently and
consistently wrong. Two sources for one asset can.

HOW IT WORKS. Assets are declared as groups of (venue, symbol) pairs that should
price the same thing. The monitor compares the most recent tick from each, in
basis points, and flags anything beyond a threshold. Small persistent differences
are normal and expected - venues genuinely trade at different prices, and the
Coinbase/Kraken spread on BTC was $21 when this was written. What matters is a
difference that is LARGE, or one that GROWS, or one that appears in a series that
was previously aligned. Those are the signatures of a broken feed rather than a
real market.

A STALE FEED IS THE DANGEROUS CASE, not a noisy one. A dead socket reports its
last price forever and looks perfectly healthy - flat, plausible, and wrong. So
age is reported alongside divergence, because a source that has not updated in
five minutes has stopped being a check on anything.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core

# Assets that should price identically across venues, modulo genuine venue spread.
# Hyperliquid's are PERPS rather than spot, so a small persistent basis is correct
# and expected - that is the B1 strategy's entire subject - and the threshold here
# is set wide enough not to cry wolf about it.
GROUPS = {
    'BTC': [('hyperliquid', 'BTC'), ('binance', 'BTCUSDT'),
            ('coinbase', 'BTC-USD'), ('kraken', 'BTC/USD')],
    'ETH': [('hyperliquid', 'ETH'), ('binance', 'ETHUSDT'),
            ('coinbase', 'ETH-USD'), ('kraken', 'ETH/USD')],
}

WARN_BPS = 25.0        # 0.25% - wider than any honest venue spread on a major
STALE_S = 120.0


def snapshot(st):
    """Most recent tick per (venue, symbol)."""
    st.flush()
    rows = st.con.execute(
        'SELECT venue, symbol, last, bid, ask, ts FROM ticks '
        'QUALIFY row_number() OVER (PARTITION BY venue, symbol ORDER BY ts DESC) = 1'
    ).fetchall()
    return {(r[0], r[1]): {'last': r[2], 'bid': r[3], 'ask': r[4], 'ts': r[5]}
            for r in rows}


def check(st, groups=None, warn_bps=WARN_BPS):
    groups = groups or GROUPS
    snap = snapshot(st)
    now_ms = time.time() * 1000
    report = []
    for asset, members in groups.items():
        seen = []
        for venue, sym in members:
            d = snap.get((venue, sym))
            if not d or not d.get('last'):
                report.append({'asset': asset, 'venue': venue, 'symbol': sym,
                               'status': 'NO DATA', 'price': None, 'age_s': None,
                               'bps': None})
                continue
            age = (now_ms - d['ts']) / 1000.0
            seen.append({'asset': asset, 'venue': venue, 'symbol': sym,
                         'price': d['last'], 'age_s': age,
                         'status': 'STALE' if age > STALE_S else 'ok'})
        if not seen:
            continue
        fresh = [s for s in seen if s['status'] == 'ok']
        ref = sorted(fresh or seen, key=lambda s: s['price'])[len(fresh or seen) // 2]
        for s in seen:
            s['bps'] = (s['price'] / ref['price'] - 1) * 10_000 if ref['price'] else None
            if s['status'] == 'ok' and s['bps'] is not None and abs(s['bps']) > warn_bps:
                s['status'] = 'DIVERGED'
        report += seen
    return report


def report(st=None, warn_bps=WARN_BPS):
    own = st is None
    st = st or core.Store()
    try:
        rows = check(st, warn_bps=warn_bps)
        print('{:7}{:14}{:14}{:>16}{:>11}{:>10}  {}'.format(
            'asset', 'venue', 'symbol', 'price', 'vs median', 'age', 'status'))
        print('-' * 86)
        bad = 0
        for r in rows:
            if r['status'] in ('DIVERGED', 'STALE', 'NO DATA'):
                bad += 1
            print('{:7}{:14}{:14}{:>16}{:>11}{:>10}  {}'.format(
                r['asset'], r['venue'], r['symbol'],
                '{:,.2f}'.format(r['price']) if r['price'] else '—',
                '{:+.1f}bp'.format(r['bps']) if r['bps'] is not None else '—',
                '{:.0f}s'.format(r['age_s']) if r['age_s'] is not None else '—',
                r['status']))
        print()
        if bad:
            print('{} source(s) diverged, stale or missing - investigate before '
                  'trusting any strategy built on them'.format(bad))
        else:
            print('all sources agree within {:.0f}bp and are fresh'.format(warn_bps))
        return rows
    finally:
        if own:
            st.close()


def report_via_api(port=8787):
    """When the ingest process holds the DuckDB write lock - which it does
    whenever the stream is running - the only way in is through the panel that
    shares its store."""
    import json as _json
    import urllib.request
    with urllib.request.urlopen(
            'http://127.0.0.1:{}/api/divergence'.format(port), timeout=10) as r:
        rows = _json.loads(r.read())['rows']
    print('{:7}{:14}{:14}{:>16}{:>11}{:>10}  {}'.format(
        'asset', 'venue', 'symbol', 'price', 'vs median', 'age', 'status'))
    print('-' * 86)
    bad = 0
    for r in rows:
        if r['status'] in ('DIVERGED', 'STALE', 'NO DATA'):
            bad += 1
        print('{:7}{:14}{:14}{:>16}{:>11}{:>10}  {}'.format(
            r['asset'], r['venue'], r['symbol'],
            '{:,.2f}'.format(r['price']) if r['price'] else '-',
            '{:+.1f}bp'.format(r['bps']) if r['bps'] is not None else '-',
            '{:.0f}s'.format(r['age_s']) if r['age_s'] is not None else '-',
            r['status']))
    print()
    print('{} source(s) diverged, stale or missing'.format(bad) if bad
          else 'all sources agree and are fresh')
    return rows


if __name__ == '__main__':
    try:
        report()
    except Exception:
        report_via_api()
