"""
Core of the market data network: one tick shape, one store, one watchlist.

DESIGN DECISION THAT EVERYTHING ELSE FOLLOWS FROM. Every venue speaks a different
dialect - Binance sends 24hr ticker frames, Hyperliquid sends its own l2Book and
trades payloads, an equity feed sends NBBO quotes. If those differences reach the
storage layer, every downstream query has to know which venue it is reading and
the whole thing calcifies. So each provider's only job is to translate into ONE
normalised Tick, and nothing past this module ever sees a venue-specific field.

STORAGE IS DUCKDB, NOT JSONL. The research collectors so far append JSON lines,
which is fine at 16,000 rows and hopeless at the scale being built toward - a
single equity options chain can carry thousands of strikes updating continuously,
and "read the whole file and parse every line" stops working long before that.
DuckDB is columnar, handles time-range scans natively, needs no server, and reads
Parquet directly. Writes are BATCHED because committing per tick would make the
database the bottleneck rather than the network.

THE WATCHLIST IS THE CONTROL SURFACE. Markets are added and removed there, and the
runner picks the change up without a restart. That is deliberate: the panel will
eventually write to this same file, so the command line and the UI drive the
identical mechanism rather than two parallel ones that can disagree.
"""
import json
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

import duckdb

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data'
DATA.mkdir(exist_ok=True)
DB_PATH = DATA / 'market.duckdb'
WATCHLIST = ROOT / 'config' / 'watchlist.json'
WATCHLIST.parent.mkdir(exist_ok=True)


# --------------------------------------------------------------------- the tick
@dataclass
class Tick:
    """One normalised observation. Every provider emits exactly this.

    `ts` is milliseconds since epoch and is set by the RECEIVER, not taken from
    the venue's own payload. Venue clocks disagree with each other and with this
    machine, and a store keyed on a foreign clock cannot be joined across venues -
    which is the entire point of having one. The venue's own timestamp is kept in
    `venue_ts` so the discrepancy stays measurable rather than lost.
    """
    ts: int
    venue: str
    symbol: str
    kind: str = 'crypto'          # crypto | perp | equity | option | prediction
    bid: Optional[float] = None
    ask: Optional[float] = None
    last: Optional[float] = None
    bid_size: Optional[float] = None
    ask_size: Optional[float] = None
    volume: Optional[float] = None
    venue_ts: Optional[int] = None
    extra: Optional[str] = None   # JSON string for anything venue-specific

    @property
    def mid(self):
        if self.bid is not None and self.ask is not None:
            return (self.bid + self.ask) / 2.0
        return self.last


DDL = """
CREATE TABLE IF NOT EXISTS ticks (
    ts        BIGINT,
    venue     VARCHAR,
    symbol    VARCHAR,
    kind      VARCHAR,
    bid       DOUBLE,
    ask       DOUBLE,
    last      DOUBLE,
    bid_size  DOUBLE,
    ask_size  DOUBLE,
    volume    DOUBLE,
    venue_ts  BIGINT,
    extra     VARCHAR
);
CREATE INDEX IF NOT EXISTS idx_ticks_sym_ts ON ticks (symbol, ts);
CREATE INDEX IF NOT EXISTS idx_ticks_ts     ON ticks (ts);
"""

COLS = ['ts', 'venue', 'symbol', 'kind', 'bid', 'ask', 'last',
        'bid_size', 'ask_size', 'volume', 'venue_ts', 'extra']


class Store:
    """Batched DuckDB writer.

    Thread-safe by a plain lock rather than anything clever: providers run in an
    asyncio loop but the DuckDB connection is not async, so the write is a short
    critical section. Batching by SIZE and by AGE together matters - size alone
    would leave the last few ticks of a quiet symbol unwritten indefinitely, which
    is exactly the data you want during a halt.
    """

    def __init__(self, path=DB_PATH, batch_size=500, max_age=2.0):
        self.con = duckdb.connect(str(path))
        for stmt in DDL.strip().split(';'):
            if stmt.strip():
                self.con.execute(stmt)
        self.batch_size = batch_size
        self.max_age = max_age
        self._buf = []
        self._last_flush = time.time()
        self._lock = threading.Lock()
        self.written = 0

    def add(self, tick: Tick):
        with self._lock:
            self._buf.append([getattr(tick, c) for c in COLS])
            due = (len(self._buf) >= self.batch_size
                   or time.time() - self._last_flush >= self.max_age)
        if due:
            self.flush()

    def flush(self):
        with self._lock:
            if not self._buf:
                self._last_flush = time.time()
                return 0
            rows, self._buf = self._buf, []
            self._last_flush = time.time()
        self.con.executemany(
            'INSERT INTO ticks ({}) VALUES ({})'.format(
                ','.join(COLS), ','.join('?' * len(COLS))), rows)
        self.written += len(rows)
        return len(rows)

    def stats(self):
        self.flush()
        row = self.con.execute(
            'SELECT count(*), count(DISTINCT symbol), min(ts), max(ts) FROM ticks'
        ).fetchone()
        return {'rows': row[0], 'symbols': row[1], 'first': row[2], 'last': row[3]}

    def latest(self, limit=20):
        self.flush()
        return self.con.execute(
            'SELECT symbol, venue, kind, last, bid, ask, ts FROM ticks '
            'QUALIFY row_number() OVER (PARTITION BY symbol ORDER BY ts DESC) = 1 '
            'ORDER BY symbol LIMIT ?', [limit]).fetchall()

    def close(self):
        self.flush()
        self.con.close()


# --------------------------------------------------------------------- watchlist
@dataclass
class Market:
    provider: str                 # binance | hyperliquid | yahoo | polymarket
    symbol: str
    kind: str = 'crypto'
    enabled: bool = True
    note: str = ''

    def key(self):
        return '{}:{}'.format(self.provider, self.symbol)


DEFAULT_WATCHLIST = [
    Market('hyperliquid', 'BTC', 'perp', note='the existing research universe'),
    Market('hyperliquid', 'ETH', 'perp'),
    Market('hyperliquid', 'SOL', 'perp'),
    Market('hyperliquid', 'HYPE', 'perp'),
    Market('binance', 'BTCUSDT', 'crypto', note='cross-venue reference'),
    Market('binance', 'ETHUSDT', 'crypto'),
    Market('yahoo', 'VFV.TO', 'equity', note='validated vol-managed sleeve'),
    Market('yahoo', 'XIU.TO', 'equity', note='validated trend sleeve'),
]


def load() -> list:
    if not WATCHLIST.exists():
        save(DEFAULT_WATCHLIST)
        return list(DEFAULT_WATCHLIST)
    raw = json.loads(WATCHLIST.read_text())
    return [Market(**m) for m in raw]


def save(markets):
    WATCHLIST.write_text(json.dumps([asdict(m) for m in markets], indent=2))


def add(provider, symbol, kind='crypto', note=''):
    ms = load()
    m = Market(provider, symbol, kind, True, note)
    if any(x.key() == m.key() for x in ms):
        return False, 'already watching {}'.format(m.key())
    ms.append(m)
    save(ms)
    return True, 'added {}'.format(m.key())


def remove(provider, symbol):
    ms = load()
    key = '{}:{}'.format(provider, symbol)
    keep = [m for m in ms if m.key() != key]
    if len(keep) == len(ms):
        return False, 'not watching {}'.format(key)
    save(keep)
    return True, 'removed {}'.format(key)


def enable(provider, symbol, on=True):
    ms = load()
    key = '{}:{}'.format(provider, symbol)
    hit = False
    for m in ms:
        if m.key() == key:
            m.enabled = on
            hit = True
    if hit:
        save(ms)
    return hit, ('enabled ' if on else 'disabled ') + key if hit else 'not found'
