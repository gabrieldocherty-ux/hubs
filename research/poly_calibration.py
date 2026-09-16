"""
Is a Polymarket crypto-window contract priced near 0.80 calibrated?

THE QUESTION. These are short-duration markets of the form "will COIN be above
LEVEL at TIME". If a contract trades at 0.80 a minute before its window closes,
does it resolve YES about 80% of the time? If it resolves YES materially more
often, buying at 0.80 is a positive-expectancy trade; materially less often, and
selling is.

THE MECHANISM THAT WOULD HAVE TO BE TRUE, stated before any number is computed.
For a durable edge there must be someone on the other side who is not free to
correct it. Two candidate stories, and they predict OPPOSITE signs:

  FAVOURITE-LONGSHOT BIAS. The best-documented regularity in betting markets:
  longshots are overpriced and favourites underpriced, because bettors pay for
  the lottery. If it holds here, 0.80 resolves YES MORE than 80% and the cheap
  tails resolve YES LESS than their price.

  CAPITAL COST NEAR EXPIRY. Buying at 0.80 to win 1.00 ties up capital for a 25%
  gross return, and a seller must post the complement. If collateral is scarce in
  the final minute, prices sit BELOW true probability and 0.80 resolves YES MORE
  than 80% - the same direction, for a different reason.

Both stories point one way, which is a warning rather than a comfort: it means a
positive result is what I expect, and expecting a result is how one gets
manufactured. The controls below are therefore the important part of this file.

THREE WAYS THIS ANALYSIS HAS ALREADY GONE WRONG IN THIS PROJECT, each guarded:

  ASK = 1.00 IS NOT A PRICE. It means NO OFFER EXISTS. An earlier pass put 60
  contracts in a "0.9-1.0" bucket at a mean price of 1.000 and read a -0.383 bias
  off it. Every row here requires a genuine two-sided quote.

  DIRECTION WAS PARSED FROM TEXT. An earlier pass derived YES/NO from the question
  and the parent event title, and a parent containing "hit" flipped every "dip to"
  market, manufacturing +0.998 edges. This file NEVER parses direction, and never
  reconstructs an outcome from spot versus the level either. It uses the VENUE'S
  OWN SETTLEMENT, harvested by poly_daemon.py into data/poly_outcomes.json as
  outcomePrices on closed markets.

  WHY NOT READ RESOLUTION FROM THE PRICE LOG: because it is not in there. The
  collector tracks a market until its window closes and then drops it. Of 12,140
  tracked markets, exactly 72 have any observation past expiry, and ZERO have both
  a near-expiry two-sided quote and a post-expiry price. An earlier version of this
  file tried that join and correctly returned nothing. The outcomes file is the
  only source of truth for what happened, and it covers 11,919 of them.

  ROWS ARE NOT THE SAMPLE SIZE. One market snapshotted 300 times is ONE
  observation of ONE outcome. Every count here is DISTINCT MARKETS, and the
  confidence intervals use that number, not the row count.

WHAT WOULD MAKE THIS UNTRADEABLE EVEN IF THE EDGE IS REAL: the spread. An edge of
two points on a contract quoted 0.78/0.82 is not an edge. The realised spread is
measured and charged.
"""
import math
import pathlib
import sys

import duckdb

ROOT = pathlib.Path(__file__).resolve().parent.parent
DB = ROOT / 'data' / 'poly.duckdb'
OUTCOMES = ROOT / 'data' / 'poly_outcomes.json'

# A window is "about to close" here. Wide enough for a real sample, tight enough
# that the price is a genuine near-expiry price.
NEAR_LO, NEAR_HI = 0.0, 2.0
# Resolution is read this far PAST the close, so the contract has had time to
# settle rather than being caught mid-print.
SETTLED_BEFORE = -5.0
YES_ABOVE, NO_BELOW = 0.90, 0.10

BUCKETS = [(0.02, 0.10), (0.10, 0.20), (0.20, 0.30), (0.30, 0.40), (0.40, 0.50),
           (0.50, 0.60), (0.60, 0.70), (0.70, 0.80), (0.80, 0.90), (0.90, 0.98)]

BUILD = """
CREATE OR REPLACE TEMP VIEW near AS
SELECT market_id, coin,
       -- the last genuine two-sided quote before the close. arg_max over
       -- -mins_left picks the observation closest to expiry.
       arg_max(mid,    mins_left * -1) AS px,
       arg_max(ask,    mins_left * -1) AS ask_px,
       arg_max(bid,    mins_left * -1) AS bid_px,
       arg_max(spread, mins_left * -1) AS sprd,
       count(*) AS snaps
FROM track
WHERE started AND mins_left >= {lo} AND mins_left < {hi}
  AND bid > 0 AND ask < 1.0 AND mid IS NOT NULL
GROUP BY market_id, coin;

CREATE OR REPLACE TEMP VIEW joined AS
SELECT n.market_id, n.coin, n.px, n.ask_px, n.bid_px, n.sprd,
       CAST(o.outcome AS INTEGER) AS outcome
FROM near n JOIN outcomes o ON o.market_id = n.market_id;
"""


def wilson(k, n, z=1.96):
    """Wilson interval. The normal approximation is not usable at the extremes,
    which is exactly where the interesting buckets are."""
    if not n:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    r = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - r) / d, (c + r) / d)


def load_outcomes(con):
    """Venue settlement, staged through a file because executemany into DuckDB
    runs at ~50 rows/sec (see poly_compact.py) and this is 12,000 rows."""
    import io as _io
    import json as _json
    raw = _json.loads(OUTCOMES.read_text())
    stage = ROOT / 'data' / '_outcomes_stage.jsonl'
    with _io.open(stage, 'w', encoding='utf-8', newline='') as fh:
        for k, v in raw.items():
            fh.write(_json.dumps({'market_id': str(k), 'outcome': v}) + '\n')
    con.execute(
        "CREATE OR REPLACE TEMP TABLE outcomes AS SELECT * FROM read_json('{}', "
        "columns = {{market_id: 'VARCHAR', outcome: 'DOUBLE'}}, "
        "format = 'newline_delimited')".format(str(stage).replace('\\', '/')))
    stage.unlink()
    return len(raw)


def main():
    con = duckdb.connect(str(DB), read_only=True)
    n_out = load_outcomes(con)
    con.execute(BUILD.format(lo=NEAR_LO, hi=NEAR_HI))

    res = con.execute('SELECT count(*) FROM joined').fetchone()[0]
    n_near = con.execute('SELECT count(*) FROM near').fetchone()[0]
    print('=' * 96)
    print('POLYMARKET NEAR-EXPIRY CALIBRATION')
    print('=' * 96)
    print('  settled outcomes harvested from the venue: {:,}'.format(n_out))
    print('  markets with a two-sided quote in the final {:.0f}-{:.0f} min: '
          '{:,}'.format(NEAR_LO, NEAR_HI, n_near))
    print('  ...of those, matched to a settlement: {:,}'.format(res))
    base = con.execute('SELECT avg(outcome) FROM joined').fetchone()[0]
    print('  base YES rate across the matched set: {:.4f}'.format(base or 0))
    if res < 200:
        print('\n  NOT ENOUGH RESOLVED MARKETS TO CONCLUDE ANYTHING. Stopping.')
        con.close()
        return

    print()
    print('  {:<12}{:>9}{:>11}{:>11}{:>11}{:>18}{:>10}'.format(
        'price', 'markets', 'implied', 'realised', 'edge', '95% CI', 'spread'))
    print('  ' + '-' * 88)
    rows = []
    for lo, hi in BUCKETS:
        r = con.execute(
            'SELECT count(*), sum(outcome), avg(px), avg(sprd) FROM joined '
            'WHERE outcome IS NOT NULL AND px >= ? AND px < ?', [lo, hi]).fetchone()
        n, k, mpx, msp = r[0], r[1] or 0, r[2], r[3]
        if not n:
            continue
        realised = k / n
        clo, chi = wilson(k, n)
        edge = realised - mpx
        flag = ''
        if clo > mpx:
            flag = '  YES underpriced'
        elif chi < mpx:
            flag = '  YES overpriced'
        rows.append((lo, hi, n, mpx, realised, edge, clo, chi, msp, flag))
        print('  {:<12}{:>9,}{:>11.3f}{:>11.3f}{:>+11.3f}{:>18}{:>10}{}'.format(
            '{:.2f}-{:.2f}'.format(lo, hi), n, mpx, realised, edge,
            '{:.3f}-{:.3f}'.format(clo, chi),
            '{:.3f}'.format(msp) if msp else '-', flag))

    print()
    print('  HOW TO READ "edge": realised YES rate minus the price paid. Positive '
          'means\n  buying YES at that price won more often than the price implied. '
          'A bucket only\n  counts as evidence when its 95% interval EXCLUDES the '
          'implied probability.')

    # ---- the 0.80 question specifically, and whether the spread eats it
    print()
    print('  THE 0.80 QUESTION, and what the spread does to it')
    print('  ' + '-' * 88)
    for lo, hi, label in ((0.75, 0.85, '0.75-0.85'), (0.78, 0.82, '0.78-0.82')):
        r = con.execute(
            'SELECT count(*), sum(outcome), avg(px), avg(sprd), avg(ask_px) '
            'FROM joined WHERE outcome IS NOT NULL AND px >= ? AND px < ?',
            [lo, hi]).fetchone()
        n, k, mpx, msp, mask = r[0], r[1] or 0, r[2], r[3], r[4]
        if not n:
            continue
        realised = k / n
        clo, chi = wilson(k, n)
        # buying at the ASK is what a taker actually pays
        net = realised - (mask or mpx)
        print('  {:<12} {:,} markets   implied {:.3f}   realised {:.3f} '
              '[{:.3f}-{:.3f}]'.format(label, n, mpx, realised, clo, chi))
        print('  {:<12} paying the ASK ({:.3f}): net edge {:+.3f} per contract  {}'
              .format('', mask or 0, net,
                      'TRADEABLE' if net > 0.01 else 'NOT tradeable after cost'))

    # ---- controls
    print()
    print('  CONTROLS')
    print('  ' + '-' * 88)
    per = con.execute(
        'SELECT coin, count(*), avg(outcome), avg(px) FROM joined '
        'WHERE outcome IS NOT NULL AND px >= 0.75 AND px < 0.85 '
        'GROUP BY coin ORDER BY 2 DESC').fetchall()
    print('  the 0.75-0.85 result per coin - a real effect should not live in one:')
    for coin, n, realised, mpx in per:
        print('     {:<6} {:>6,} markets   implied {:.3f}   realised {:.3f}   '
              '{:+.3f}'.format(coin or '?', n, mpx, realised, realised - mpx))

    unmatched = con.execute(
        'SELECT count(*) FROM near n LEFT JOIN outcomes o '
        'ON o.market_id = n.market_id WHERE o.market_id IS NULL').fetchone()[0]
    print('  near-expiry markets with NO harvested settlement, dropped: {:,}'
          .format(unmatched))
    print('     (these are the most recent windows, not yet resolved by the venue;')
    print('      if this were large relative to a bucket the dropped set could')
    print('      carry the result)')

    print()
    print('  SANITY: a calibrated market should track the diagonal. Overall '
          'Brier score,')
    print('  and the same for a constant forecast at the base rate:')
    b = con.execute('SELECT avg((px - outcome) * (px - outcome)), '
                    'avg(outcome) FROM joined').fetchone()
    base_b = con.execute(
        'SELECT avg(({0} - outcome) * ({0} - outcome)) FROM joined'.format(
            b[1])).fetchone()[0]
    print('     market prices {:.4f}   constant-{:.3f} forecast {:.4f}   {}'.format(
        b[0], b[1], base_b,
        'market is informative' if b[0] < base_b else 'market adds nothing'))
    con.close()


if __name__ == '__main__':
    main()
