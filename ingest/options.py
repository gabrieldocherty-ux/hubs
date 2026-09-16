"""
Options chains from CBOE, free and without credentials.

WHAT THIS CORRECTS. This project previously concluded that options data required a
paid key, on the evidence of Yahoo returning 401 and Stooq serving a bot
challenge. That was a generalisation from two failures, and it was wrong: CBOE - the
actual options exchange - publishes full delayed chains directly. SPY alone is
13,100 contracts across 34 expiries, and every one carries implied volatility and
the complete greek set.

WHY OPTIONS ARE WORTH THE TROUBLE. Every strategy this project has tested reads
PRICE. Implied volatility is a different kind of information: it is the market's
forecast of future movement, quoted and tradeable. That makes several questions
answerable that price alone cannot touch -

  VOLATILITY RISK PREMIUM  does implied vol systematically exceed the volatility
                           that subsequently arrives? It usually does, and the
                           gap is one of the most robustly documented edges in
                           finance. Sellers are paid to carry variance risk.
  SKEW                     puts are normally dearer than equidistant calls. The
                           SIZE of that asymmetry moves, and it moves ahead of
                           realised stress rather than after it.
  TERM STRUCTURE           near-dated versus far-dated implied vol inverts under
                           stress, the same signal the VIX3M/VIX ratio gave in the
                           earlier work but per-underlying rather than index-wide.

THE LIMITATION, STATED PLAINLY. These quotes are DELAYED. The payload carries its
own timestamp and it is honoured in the stored row, so nothing here can be mistaken
for live. That rules out intraday options trading. It does NOT rule out the
research above, all of which is end-of-day by nature - and it is a perfectly
adequate basis for deciding whether an edge exists BEFORE paying for a real-time
feed.

STORAGE IS SELECTIVE ON PURPOSE. A full SPY chain is 5.8MB and most of it is dead
strikes with no open interest and no volume - contracts that exist on paper and
have never traded. Storing every one on every poll would bloat the database
without adding information, so by default only contracts with open interest or
volume are kept. The full surface can be stored when a study genuinely needs the
dead wings, by passing keep_all.
"""
import datetime
import json
import re
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
CBOE = 'https://cdn.cboe.com/api/global/delayed_quotes/options/{}.json'

# CBOE prefixes index symbols with an underscore; equities and ETFs are bare.
INDEX = {'SPX', 'VIX', 'NDX', 'RUT', 'DJX'}

OPT_DDL = """
CREATE TABLE IF NOT EXISTS options (
    ts          BIGINT,
    quote_ts    BIGINT,
    underlying  VARCHAR,
    spot        DOUBLE,
    contract    VARCHAR,
    expiry      DATE,
    strike      DOUBLE,
    cp          VARCHAR,   -- 'C' or 'P'. Named cp, not `right`,
                           -- because RIGHT is a SQL reserved word
                           -- (RIGHT JOIN) and DuckDB rejects it.
    dte         INTEGER,
    bid         DOUBLE,
    ask         DOUBLE,
    bid_size    DOUBLE,
    ask_size    DOUBLE,
    last        DOUBLE,
    iv          DOUBLE,
    delta       DOUBLE,
    gamma       DOUBLE,
    theta       DOUBLE,
    vega        DOUBLE,
    rho         DOUBLE,
    theo        DOUBLE,
    open_interest DOUBLE,
    volume      DOUBLE
);
CREATE INDEX IF NOT EXISTS idx_opt_und_ts ON options (underlying, ts);
CREATE INDEX IF NOT EXISTS idx_opt_exp ON options (underlying, expiry, strike);
"""

OPT_COLS = ['ts', 'quote_ts', 'underlying', 'spot', 'contract', 'expiry', 'strike',
            'cp', 'dte', 'bid', 'ask', 'bid_size', 'ask_size', 'last', 'iv',
            'delta', 'gamma', 'theta', 'vega', 'rho', 'theo', 'open_interest',
            'volume']

# OCC symbol: root, YYMMDD, C|P, then strike x1000 in 8 digits.
# e.g. SPY261130C00629000 -> SPY, 2026-11-30, call, 629.0
OCC = re.compile(r'^([A-Z]+)(\d{6})([CP])(\d{8})$')


def parse_occ(sym):
    m = OCC.match(sym or '')
    if not m:
        return None
    root, ymd, right, strike = m.groups()
    try:
        exp = datetime.date(2000 + int(ymd[:2]), int(ymd[2:4]), int(ymd[4:6]))
    except ValueError:
        return None
    return {'root': root, 'expiry': exp, 'cp': 'C' if right == 'C' else 'P',
            'strike': int(strike) / 1000.0}


def ensure_schema(store):
    for stmt in OPT_DDL.strip().split(';'):
        if stmt.strip():
            store.con.execute(stmt)


def fetch_chain(underlying, timeout=60):
    """One full chain. Returns (underlying_info, [contract dicts])."""
    sym = '_' + underlying if underlying.upper() in INDEX else underlying
    r = requests.get(CBOE.format(sym), headers=UA, timeout=timeout)
    r.raise_for_status()
    j = r.json()
    d = j.get('data') or {}
    qts = None
    if j.get('timestamp'):
        try:
            qts = int(datetime.datetime.fromisoformat(
                j['timestamp']).replace(
                    tzinfo=datetime.timezone.utc).timestamp() * 1000)
        except Exception:
            qts = None
    return {'symbol': underlying, 'spot': d.get('current_price'),
            'bid': d.get('bid'), 'ask': d.get('ask'),
            'iv30': d.get('iv30'), 'volume': d.get('volume'),
            'quote_ts': qts}, (d.get('options') or [])


def store_chain(store, underlying, keep_all=False, min_dte=0, max_dte=400):
    ensure_schema(store)
    info, opts = fetch_chain(underlying)
    now = int(time.time() * 1000)
    today = datetime.date.today()
    rows = []
    for o in opts:
        p = parse_occ(o.get('option'))
        if not p:
            continue
        dte = (p['expiry'] - today).days
        if dte < min_dte or dte > max_dte:
            continue
        oi = o.get('open_interest') or 0
        vol = o.get('volume') or 0
        # Most of a chain is strikes that exist on paper and have never traded.
        # Keeping them multiplies storage without adding information.
        if not keep_all and oi <= 0 and vol <= 0:
            continue
        rows.append([
            now, info['quote_ts'], underlying, info['spot'], o.get('option'),
            p['expiry'], p['strike'], p['cp'], dte,
            o.get('bid'), o.get('ask'), o.get('bid_size'), o.get('ask_size'),
            o.get('last_trade_price'), o.get('iv'), o.get('delta'), o.get('gamma'),
            o.get('theta'), o.get('vega'), o.get('rho'), o.get('theo'), oi, vol])
    if rows:
        store.con.executemany(
            'INSERT INTO options ({}) VALUES ({})'.format(
                ','.join(OPT_COLS), ','.join('?' * len(OPT_COLS))), rows)
    return {'underlying': underlying, 'fetched': len(opts), 'stored': len(rows),
            'spot': info['spot'], 'iv30': info['iv30'],
            'quote_ts': info['quote_ts']}


def surface(store, underlying, limit_expiries=6):
    """Median IV by expiry - the term structure, in one query."""
    ensure_schema(store)
    return store.con.execute("""
        SELECT expiry, min(dte) AS dte, count(*) AS n,
               median(iv) AS iv_med,
               median(CASE WHEN cp='P' THEN iv END) AS iv_put,
               median(CASE WHEN cp='C' THEN iv END) AS iv_call
        FROM options
        WHERE underlying = ? AND iv > 0
          AND ts = (SELECT max(ts) FROM options WHERE underlying = ?)
        GROUP BY expiry ORDER BY dte LIMIT ?
    """, [underlying, underlying, limit_expiries]).fetchall()


def skew(store, underlying, dte_target=30):
    """25-delta put IV minus 25-delta call IV on the nearest expiry to target.

    The standard skew measure. Positive means puts are dearer than equidistant
    calls, which is the normal state for equity indices - people pay up for crash
    protection. The size of it is what moves.
    """
    ensure_schema(store)
    row = store.con.execute("""
        WITH latest AS (
            SELECT * FROM options WHERE underlying = ?
              AND ts = (SELECT max(ts) FROM options WHERE underlying = ?)
              AND iv > 0 AND delta IS NOT NULL
        ), pick AS (
            SELECT *, abs(dte - ?) AS d FROM latest
        ), exp AS (SELECT expiry FROM pick ORDER BY d LIMIT 1)
        SELECT
          (SELECT iv FROM pick WHERE cp='P' AND expiry=(SELECT expiry FROM exp)
             ORDER BY abs(abs(delta)-0.25) LIMIT 1) AS put25,
          (SELECT iv FROM pick WHERE cp='C' AND expiry=(SELECT expiry FROM exp)
             ORDER BY abs(abs(delta)-0.25) LIMIT 1) AS call25,
          (SELECT min(dte) FROM pick WHERE expiry=(SELECT expiry FROM exp)) AS dte
    """, [underlying, underlying, dte_target]).fetchone()
    if not row or row[0] is None or row[1] is None:
        return None
    return {'put25': row[0], 'call25': row[1], 'skew': row[0] - row[1], 'dte': row[2]}


DEFAULT_UNDERLYINGS = ['SPY', 'QQQ', 'IWM', 'GLD', 'TLT']


if __name__ == '__main__':
    st = core.Store()
    try:
        syms = sys.argv[1:] or DEFAULT_UNDERLYINGS
        print('{:8}{:>10}{:>10}{:>10}{:>10}  {}'.format(
            'sym', 'spot', 'iv30', 'in chain', 'stored', 'quote time'))
        print('-' * 68)
        for s in syms:
            try:
                r = store_chain(st, s)
                qt = (datetime.datetime.utcfromtimestamp(r['quote_ts'] / 1000)
                      .strftime('%Y-%m-%d %H:%M') if r['quote_ts'] else '?')
                print('{:8}{:>10}{:>10}{:>10}{:>10}  {}'.format(
                    s, '{:,.2f}'.format(r['spot'] or 0),
                    # CBOE's iv30 is ALREADY in percent. Multiplying by 100
                    # again printed SPY's 30-day vol as 1359%, which is not a
                    # number any equity index has ever had.
                    '{:.1f}%'.format(r['iv30']) if r['iv30'] else '-',
                    r['fetched'], r['stored'], qt))
            except Exception as e:
                print('{:8} FAILED {}'.format(s, e))
        for s in syms:
            rows = surface(st, s)
            if not rows:
                continue
            print('\n{} term structure (median IV by expiry)'.format(s))
            print('  {:12}{:>6}{:>7}{:>10}{:>10}{:>10}'.format(
                'expiry', 'dte', 'n', 'IV', 'put IV', 'call IV'))
            for e, dte, n, ivm, ivp, ivc in rows:
                print('  {:12}{:>6}{:>7}{:>10}{:>10}{:>10}'.format(
                    str(e), dte, n,
                    '{:.1%}'.format(ivm) if ivm else '-',
                    '{:.1%}'.format(ivp) if ivp else '-',
                    '{:.1%}'.format(ivc) if ivc else '-'))
            sk = skew(st, s)
            if sk:
                print('  25-delta skew at {}dte: put {:.1%} - call {:.1%} = '
                      '{:+.1%}'.format(sk['dte'], sk['put25'], sk['call25'],
                                       sk['skew']))
    finally:
        st.close()
