"""
Compact the Polymarket tick log into something queryable.

THE PROBLEM THIS SOLVES. poly_track.jsonl has passed 11 million rows and 4.75 GB,
growing about 2.2 GB a day. Disk is not the constraint - there are hundreds of
gigabytes free - but QUERYABILITY is. Every analysis over that file parses 4.75 GB
of JSON line by line to answer a question that touches a handful of columns, and it
gets worse every hour the collector runs. Answering the actual open question -
whether a contract priced near 0.80 shortly before expiry resolves YES more often
than 0.80 implies - should be a few seconds of columnar scan, not minutes of JSON
parsing.

WHY A SEPARATE DATABASE FILE. DuckDB permits exactly one read-write process, and
data/market.duckdb is owned by the running ingest process. Writing Polymarket data
there would either fail outright or force the collector and the panel to fight over
a lock. data/poly.duckdb is its own file with its own writer, so the two systems
stay independent - which is also the right boundary, because one is live venue data
and the other is a research log.

THE JSONL IS NOT DELETED. It stays as the append-only source of truth, because a
collector that writes directly into a database has a failure mode a log does not: a
corrupted write can lose everything, whereas a truncated JSON line loses one row and
the parser skips it. Compaction is idempotent and incremental - it records the last
byte offset consumed, so re-running only reads what arrived since, and the collector
never has to stop.

TWO DEFECTS FIXED HERE, both found by running it rather than reading it.

1. IT LOADED AT 50 ROWS PER SECOND. Not a typo: 20,000 rows took 392 seconds, which
   puts the 11.2M-row backlog at 61 HOURS. The cause was `executemany`, which binds
   row by row through DuckDB's prepared-statement API - the slowest way into a
   columnar database. The first suspicion was the three ART indexes on `track`, and
   that was WRONG and worth recording: with indexes, without indexes, and building
   the indexes after the load all measured 50 rows/sec exactly. The indexes cost
   nothing; the binding cost everything.

   Measured alternatives on the same 20,000 real rows:

       executemany (old)              50 rows/sec     backlog 61.1 h
       temp CSV + COPY            71,388 rows/sec     backlog  0.04 h
       raw JSONL slice + read_json  110,849 rows/sec  backlog  0.03 h

   The winner is also the simplest: hand DuckDB the raw lines and let it parse them.
   Python stops touching the JSON entirely. 2,177x faster, and the backlog goes from
   sixty-one hours to about a minute.

2. A CRASH DUPLICATED EVERYTHING. Rows were inserted as it went but the byte offset
   was only written at the very END, so any interruption left the data in but the
   offset unmoved, and the next run re-read and re-inserted the same rows. This was
   not hypothetical - the table held 120,646 rows while the state file still read
   offset 0. The offset now lives IN THE DATABASE and is committed in the SAME
   TRANSACTION as the rows it accounts for, so the two cannot disagree: either both
   land or neither does.

   The old JSON state file is ignored on purpose. It cannot be trusted to describe
   what is in the table, and now that a full rebuild costs about a minute, `rebuild`
   is a better answer than reconciliation.

    python research/poly_compact.py compact     # incremental, safe to repeat
    python research/poly_compact.py rebuild     # drop and reload from scratch
    python research/poly_compact.py summary
"""
import io
import json
import pathlib
import sys
import time

import duckdb

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'poly_track.jsonl'
DB = ROOT / 'data' / 'poly.duckdb'
STAGE = ROOT / 'data' / '_poly_stage.jsonl'

DDL = """
CREATE TABLE IF NOT EXISTS track (
    ts          TIMESTAMP,
    market_id   VARCHAR,
    question    VARCHAR,
    coin        VARCHAR,
    win_start   TIMESTAMP,
    win_end     TIMESTAMP,
    dur_min     DOUBLE,
    mins_left   DOUBLE,
    started     BOOLEAN,
    bid         DOUBLE,
    ask         DOUBLE,
    last        DOUBLE,
    mid         DOUBLE,
    spread      DOUBLE,
    spot        DOUBLE,
    beat        DOUBLE,
    gap         DOUBLE
);
CREATE TABLE IF NOT EXISTS compact_state (
    id       INTEGER PRIMARY KEY,
    offset_b BIGINT,
    rows_in  BIGINT
);
CREATE INDEX IF NOT EXISTS idx_track_mid ON track (market_id, ts);
CREATE INDEX IF NOT EXISTS idx_track_left ON track (mins_left);
CREATE INDEX IF NOT EXISTS idx_track_coin ON track (coin, ts);
"""

# Columns declared EXPLICITLY rather than inferred. read_json_auto samples the
# head of a file to guess types, and across 11M rows written over days a sampled
# guess will eventually meet a row that contradicts it - a null where it inferred
# a double, an integer where it inferred a boolean. Declaring the schema makes the
# read deterministic, and try_cast turns any single bad value into a NULL instead
# of killing the batch.
READ_COLS = ("{ts: 'VARCHAR', id: 'VARCHAR', q: 'VARCHAR', coin: 'VARCHAR', "
             "start: 'VARCHAR', \"end\": 'VARCHAR', dur_min: 'DOUBLE', "
             "mins_left: 'DOUBLE', started: 'BOOLEAN', bid: 'DOUBLE', "
             "ask: 'DOUBLE', last: 'DOUBLE', mid: 'DOUBLE', spread: 'DOUBLE', "
             "spot: 'DOUBLE', beat: 'DOUBLE', gap: 'DOUBLE'}")

INSERT_SQL = """
INSERT INTO track (ts, market_id, question, coin, win_start, win_end, dur_min,
                   mins_left, started, bid, ask, last, mid, spread, spot, beat, gap)
SELECT try_cast(ts AS TIMESTAMP), id, substr(q, 1, 160), coin,
       try_cast(start AS TIMESTAMP), try_cast("end" AS TIMESTAMP),
       dur_min, mins_left, coalesce(started, false),
       bid, ask, last, mid, spread, spot, beat, gap
FROM read_json('{path}', columns = {cols}, format = 'newline_delimited',
               ignore_errors = true)
"""


def _connect():
    con = duckdb.connect(str(DB))
    for stmt in DDL.strip().split(';'):
        if stmt.strip():
            con.execute(stmt)
    return con


def get_state(con):
    row = con.execute(
        'SELECT offset_b, rows_in FROM compact_state WHERE id = 1').fetchone()
    return {'offset': row[0], 'rows': row[1]} if row else {'offset': 0, 'rows': 0}


def _read_slice(fh, max_lines, max_bytes):
    """Copy raw lines from the current position into the staging file.

    Returns (lines_written, end_offset). A partial final line means the collector
    is mid-write, so it stops BEFORE it and leaves the offset short - the next pass
    picks that line up whole.
    """
    n = 0
    written = 0
    end = fh.tell()
    with io.open(STAGE, 'w', encoding='utf-8', newline='') as out:
        while n < max_lines and written < max_bytes:
            line = fh.readline()
            if not line:
                break
            if not line.endswith('\n'):
                break
            out.write(line)
            written += len(line)
            n += 1
            end = fh.tell()
    return n, end


def compact(max_lines=500_000, max_bytes=256_000_000, verbose=True):
    con = _connect()
    state = get_state(con)
    start_offset = state['offset']
    total = 0
    t0 = time.time()
    path = str(STAGE).replace('\\', '/')

    with SRC.open('r', encoding='utf-8', errors='replace') as fh:
        fh.seek(start_offset)
        while True:
            n, end = _read_slice(fh, max_lines, max_bytes)
            if not n:
                break
            # The rows and the offset that accounts for them commit TOGETHER.
            # This is the whole fix for the duplication bug: an interruption can
            # no longer leave data in the table that the offset does not know
            # about.
            con.execute('BEGIN TRANSACTION')
            try:
                con.execute(INSERT_SQL.format(path=path, cols=READ_COLS))
                con.execute(
                    'INSERT INTO compact_state (id, offset_b, rows_in) '
                    'VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET '
                    'offset_b = excluded.offset_b, rows_in = excluded.rows_in',
                    [end, state['rows'] + total + n])
                con.execute('COMMIT')
            except Exception:
                con.execute('ROLLBACK')
                raise
            total += n
            if verbose:
                el = time.time() - t0
                print('  {:>12,} rows  {:>5.0f}s  {:>9,} rows/s'.format(
                    total, el, int(total / el) if el else 0), flush=True)

    n_rows = con.execute('SELECT count(*) FROM track').fetchone()[0]
    con.close()
    if STAGE.exists():
        STAGE.unlink()
    return {'inserted': total, 'table_rows': n_rows, 'from_offset': start_offset,
            'to_offset': get_state(_connect())['offset'],
            'seconds': time.time() - t0}


def rebuild():
    """Drop everything and reload from byte zero.

    The right answer whenever the table and the offset might disagree - which was
    the state this file was found in. Reconciling is guesswork; a full reload is
    about a minute and is certain.
    """
    con = _connect()
    con.execute('DELETE FROM track')
    con.execute('DELETE FROM compact_state')
    con.close()
    print('table cleared - reloading from offset 0')
    return compact()


def summary():
    con = duckdb.connect(str(DB), read_only=True)
    try:
        n, mn, mx, mkts = con.execute(
            'SELECT count(*), min(ts), max(ts), count(DISTINCT market_id) '
            'FROM track').fetchone()
        print('rows {:,}   markets {:,}   {} -> {}'.format(n, mkts, mn, mx))
        print('\nby coin:')
        for coin, c, lo, hi in con.execute(
                'SELECT coin, count(*), min(mins_left), max(mins_left) '
                'FROM track GROUP BY coin ORDER BY 2 DESC').fetchall():
            print('  {:6} {:>12,} rows   mins_left {:.1f} .. {:.1f}'.format(
                coin or '?', c, lo or 0, hi or 0))
        print('\nobservations inside the final minutes of a window, counted by '
              'DISTINCT MARKET - which is the real sample size, because one market '
              'snapshotted 300 times is one observation of one outcome:')
        for lo, hi, label in ((0, 1, '0-1 min'), (1, 2, '1-2 min'),
                              (2, 5, '2-5 min')):
            row = con.execute(
                'SELECT count(*), count(DISTINCT market_id) FROM track '
                'WHERE started AND mins_left >= ? AND mins_left < ?',
                [lo, hi]).fetchone()
            print('  {:10} {:>12,} rows across {:>7,} markets'.format(
                label, row[0], row[1]))
        print('\nprice distribution in the final minute (two-sided quotes only - '
              'an ask of 1.00 means NO OFFER EXISTS, not a price of 1.00):')
        for lo, hi in ((0.0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.0)):
            c, m = con.execute(
                'SELECT count(*), count(DISTINCT market_id) FROM track '
                'WHERE started AND mins_left < 1 AND mid >= ? AND mid < ? '
                'AND bid > 0 AND ask < 1.0', [lo, hi]).fetchone()
            print('  {:.1f}-{:.1f}  {:>12,} rows  {:>7,} markets'.format(lo, hi, c, m))
    finally:
        con.close()


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'compact'
    if cmd in ('compact', 'rebuild'):
        src_mb = SRC.stat().st_size / 1e6 if SRC.exists() else 0
        print('{} {:.0f} MB of JSONL into {}'.format(
            'rebuilding from' if cmd == 'rebuild' else 'compacting',
            src_mb, DB.name))
        r = rebuild() if cmd == 'rebuild' else compact()
        db_mb = DB.stat().st_size / 1e6
        print('\ninserted {:,} rows in {:.0f}s'.format(r['inserted'], r['seconds']))
        print('table now holds {:,} rows'.format(r['table_rows']))
        print('{:.0f} MB JSONL -> {:.0f} MB DuckDB  ({:.1f}x smaller)'.format(
            src_mb, db_mb, src_mb / db_mb if db_mb else 0))
    elif cmd == 'summary':
        summary()
    else:
        print('usage: poly_compact.py [compact|rebuild|summary]')
