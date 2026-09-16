"""
Compact the Polymarket tick log into something queryable.

THE PROBLEM THIS SOLVES. poly_track.jsonl has reached 11.2 million rows and
4.3 GB, growing about 2.2 GB a day. Disk is not the constraint - there are
hundreds of gigabytes free - but QUERYABILITY is. Every analysis over that file
parses 4.3 GB of JSON line by line to answer a question that touches a handful of
columns, and it gets worse every hour the collector runs. Answering the actual
open question - whether a contract priced near 0.80 shortly before expiry resolves
YES more often than 0.80 implies - should be a few seconds of columnar scan, not
minutes of JSON parsing.

WHY A SEPARATE DATABASE FILE. DuckDB permits exactly one read-write process, and
data/market.duckdb is owned by the running ingest process. Writing Polymarket data
there would either fail outright or force the collector and the panel to fight
over a lock. data/poly.duckdb is its own file with its own writer, so the two
systems stay independent - which is also the right boundary, because one is live
venue data and the other is a research log.

THE JSONL IS NOT DELETED. It stays as the append-only source of truth, because a
collector that writes directly into a database has a failure mode a log does not:
a corrupted write can lose everything, whereas a truncated JSON line loses one row
and the parser skips it. Compaction is idempotent and incremental - it records the
last byte offset consumed, so re-running only reads what arrived since, and the
collector never has to stop.
"""
import datetime
import json
import pathlib
import sys
import time

import duckdb

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'data' / 'poly_track.jsonl'
DB = ROOT / 'data' / 'poly.duckdb'
STATE = ROOT / 'data' / 'poly_compact_state.json'

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
CREATE INDEX IF NOT EXISTS idx_track_mid ON track (market_id, ts);
CREATE INDEX IF NOT EXISTS idx_track_left ON track (mins_left);
CREATE INDEX IF NOT EXISTS idx_track_coin ON track (coin, ts);
"""

COLS = ['ts', 'market_id', 'question', 'coin', 'win_start', 'win_end', 'dur_min',
        'mins_left', 'started', 'bid', 'ask', 'last', 'mid', 'spread', 'spot',
        'beat', 'gap']


def _ts(v):
    if not v:
        return None
    try:
        return datetime.datetime.fromisoformat(v)
    except (ValueError, TypeError):
        return None


def load_state():
    if STATE.exists():
        try:
            return json.loads(STATE.read_text())
        except Exception:
            pass
    return {'offset': 0, 'rows': 0}


def compact(batch=100_000, max_rows=None):
    con = duckdb.connect(str(DB))
    for stmt in DDL.strip().split(';'):
        if stmt.strip():
            con.execute(stmt)

    state = load_state()
    start_offset = state['offset']
    total = 0
    skipped = 0
    t0 = time.time()
    buf = []

    with SRC.open('r', encoding='utf-8', errors='replace') as f:
        f.seek(start_offset)
        while True:
            line = f.readline()
            if not line:
                break
            # A partial final line means the collector is mid-write. Stop before
            # it rather than consuming a truncated record, and leave the offset
            # where it is so the next pass picks the line up whole.
            if not line.endswith('\n'):
                break
            try:
                r = json.loads(line)
            except Exception:
                skipped += 1
                continue
            buf.append([
                _ts(r.get('ts')), str(r.get('id') or ''), (r.get('q') or '')[:160],
                r.get('coin'), _ts(r.get('start')), _ts(r.get('end')),
                r.get('dur_min'), r.get('mins_left'), bool(r.get('started')),
                r.get('bid'), r.get('ask'), r.get('last'), r.get('mid'),
                r.get('spread'), r.get('spot'), r.get('beat'), r.get('gap')])
            if len(buf) >= batch:
                con.executemany('INSERT INTO track ({}) VALUES ({})'.format(
                    ','.join(COLS), ','.join('?' * len(COLS))), buf)
                total += len(buf)
                buf = []
                print('  {:>12,} rows  {:.0f}s  {:.0f}k rows/s'.format(
                    total, time.time() - t0,
                    total / max(1, time.time() - t0) / 1000), flush=True)
                if max_rows and total >= max_rows:
                    break
        end_offset = f.tell()

    if buf:
        con.executemany('INSERT INTO track ({}) VALUES ({})'.format(
            ','.join(COLS), ','.join('?' * len(COLS))), buf)
        total += len(buf)

    STATE.write_text(json.dumps({'offset': end_offset,
                                 'rows': state['rows'] + total}))
    n = con.execute('SELECT count(*) FROM track').fetchone()[0]
    con.close()
    return {'inserted': total, 'skipped': skipped, 'table_rows': n,
            'from_offset': start_offset, 'to_offset': end_offset,
            'seconds': time.time() - t0}


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
        print('\nobservations inside the final 2 minutes of a window '
              '(the ones that answer the 0.80 question):')
        for lo, hi, label in ((0, 1, '0-1 min'), (1, 2, '1-2 min'),
                              (2, 5, '2-5 min')):
            row = con.execute(
                'SELECT count(*), count(DISTINCT market_id) FROM track '
                'WHERE started AND mins_left >= ? AND mins_left < ?',
                [lo, hi]).fetchone()
            print('  {:10} {:>12,} rows across {:>7,} markets'.format(
                label, row[0], row[1]))
        print('\nprice distribution in the final minute:')
        for lo, hi in ((0.0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.0)):
            c = con.execute(
                'SELECT count(*) FROM track WHERE started AND mins_left < 1 '
                'AND mid >= ? AND mid < ?', [lo, hi]).fetchone()[0]
            print('  {:.1f}-{:.1f}  {:>12,}'.format(lo, hi, c))
    finally:
        con.close()


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'compact'
    if cmd == 'compact':
        src_mb = SRC.stat().st_size / 1e6 if SRC.exists() else 0
        print('compacting {:.0f} MB of JSONL into {}'.format(src_mb, DB.name))
        r = compact()
        db_mb = DB.stat().st_size / 1e6
        print('\ninserted {:,} rows in {:.0f}s ({} malformed lines skipped)'.format(
            r['inserted'], r['seconds'], r['skipped']))
        print('table now holds {:,} rows'.format(r['table_rows']))
        print('{:.0f} MB JSONL -> {:.0f} MB DuckDB  ({:.1f}x smaller)'.format(
            src_mb, db_mb, src_mb / db_mb if db_mb else 0))
    elif cmd == 'summary':
        summary()
    else:
        print('usage: poly_compact.py [compact|summary]')
