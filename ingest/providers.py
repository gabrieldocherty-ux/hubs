"""
Venue adapters. Each one's only job is to turn a venue's dialect into a Tick.

WEBSOCKET WHERE POSSIBLE, POLLING ONLY WHERE FORCED. Everything built in this
project so far ASKS the venue "what is the price now?" every few seconds. That is
the wrong shape at scale: it burns request budget on unchanged data, it bounds
latency at the poll interval, and it does not survive thousands of symbols. A
WebSocket has the venue push updates the moment they happen, so cost scales with
how much the market MOVES rather than with how often you ask.

Crypto venues stream freely. Equities do not - real-time US equity and options
data is licensed, and the free sources are delayed or polled. So the equity
adapter here polls Yahoo, and is written so that swapping in a real feed
(Alpaca, Polygon.io, a broker socket) means replacing one class and nothing else.

RECONNECTION IS NOT OPTIONAL. A socket that dies quietly is worse than one that
never connected, because the gap in the data is invisible. Every adapter
reconnects with exponential backoff and reports its state, so a dead feed shows up
as a dead feed rather than as a flat price.
"""
import asyncio
import json
import random
import time

import aiohttp
import websockets

from core import Tick

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}


def now_ms():
    return int(time.time() * 1000)


class Provider:
    """Base: owns reconnection, backoff and health reporting."""
    name = 'base'

    def __init__(self, symbols, on_tick):
        self.symbols = list(symbols)
        self.on_tick = on_tick
        self.ticks = 0
        self.errors = 0
        self.connected = False
        self.last_tick_at = 0.0

    async def run(self, stop):
        delay = 1.0
        while not stop.is_set():
            try:
                await self._session(stop)
                delay = 1.0                      # a clean session resets backoff
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.errors += 1
                self.connected = False
                # jitter matters: without it every provider reconnects in lockstep
                # after a network blip and hammers the venues simultaneously
                wait = min(60.0, delay) * (1 + random.random() * 0.3)
                print('[{}] {} -> reconnect in {:.1f}s'.format(
                    self.name, type(e).__name__, wait), flush=True)
                await asyncio.sleep(wait)
                delay = min(60.0, delay * 2)

    async def _session(self, stop):
        raise NotImplementedError

    def emit(self, tick):
        self.ticks += 1
        self.last_tick_at = time.time()
        self.on_tick(tick)

    def health(self):
        age = time.time() - self.last_tick_at if self.last_tick_at else None
        return {'provider': self.name, 'symbols': len(self.symbols),
                'connected': self.connected, 'ticks': self.ticks,
                'errors': self.errors,
                'last_tick_age': round(age, 1) if age is not None else None}


class BinanceWS(Provider):
    """Binance combined book-ticker stream.

    bookTicker is chosen over trade or ticker streams because it pushes the best
    bid and ask on every change - which is what a strategy actually needs. A trade
    stream tells you where something printed; it does not tell you where you could
    have transacted.
    """
    name = 'binance'
    URL = 'wss://stream.binance.com:9443/stream?streams={}'

    async def _session(self, stop):
        streams = '/'.join('{}@bookTicker'.format(s.lower()) for s in self.symbols)
        async with websockets.connect(self.URL.format(streams),
                                      ping_interval=20, ping_timeout=20) as ws:
            self.connected = True
            print('[binance] connected: {}'.format(', '.join(self.symbols)), flush=True)
            while not stop.is_set():
                raw = await asyncio.wait_for(ws.recv(), timeout=60)
                msg = json.loads(raw)
                d = msg.get('data') or msg
                if 'b' not in d or 'a' not in d:
                    continue
                self.emit(Tick(
                    ts=now_ms(), venue='binance', symbol=d.get('s', '?'),
                    kind='crypto',
                    bid=float(d['b']), ask=float(d['a']),
                    bid_size=float(d.get('B') or 0), ask_size=float(d.get('A') or 0),
                    last=(float(d['b']) + float(d['a'])) / 2.0))


class HyperliquidWS(Provider):
    """Hyperliquid l2Book stream - the venue this project already trades."""
    name = 'hyperliquid'
    URL = 'wss://api.hyperliquid.xyz/ws'

    async def _session(self, stop):
        async with websockets.connect(self.URL, ping_interval=20,
                                      ping_timeout=20) as ws:
            for sym in self.symbols:
                await ws.send(json.dumps({
                    'method': 'subscribe',
                    'subscription': {'type': 'l2Book', 'coin': sym}}))
            self.connected = True
            print('[hyperliquid] connected: {}'.format(', '.join(self.symbols)),
                  flush=True)
            while not stop.is_set():
                raw = await asyncio.wait_for(ws.recv(), timeout=60)
                msg = json.loads(raw)
                if msg.get('channel') != 'l2Book':
                    continue
                d = msg.get('data') or {}
                levels = d.get('levels') or []
                if len(levels) < 2 or not levels[0] or not levels[1]:
                    continue
                bid, ask = levels[0][0], levels[1][0]
                self.emit(Tick(
                    ts=now_ms(), venue='hyperliquid', symbol=d.get('coin', '?'),
                    kind='perp',
                    bid=float(bid['px']), ask=float(ask['px']),
                    bid_size=float(bid.get('sz') or 0),
                    ask_size=float(ask.get('sz') or 0),
                    last=(float(bid['px']) + float(ask['px'])) / 2.0,
                    venue_ts=d.get('time')))


class YahooPoll(Provider):
    """Equities, polled.

    A deliberate stopgap. Real-time US equity data is licensed and Yahoo's quote
    endpoint is both unofficial and delayed, so this is adequate for the slow
    strategies already validated - which trade about twice a year - and NOT
    adequate for anything intraday. Swapping in Alpaca, Polygon.io or a broker
    socket means replacing this class only; the Tick contract stays identical.
    """
    name = 'yahoo'
    # v7/finance/quote now requires a crumb + cookie handshake and returns an
    # empty result set without one - it produced zero ticks silently, which is the
    # worst failure mode: a feed that looks connected and delivers nothing. The
    # chart endpoint needs no credentials and is already used elsewhere here.
    URL = 'https://query1.finance.yahoo.com/v8/finance/chart/{}'
    interval = 5.0

    async def _session(self, stop):
        async with aiohttp.ClientSession(headers=UA) as sess:
            self.connected = True
            print('[yahoo] polling: {}'.format(', '.join(self.symbols)), flush=True)
            while not stop.is_set():
                for sym in self.symbols:
                    try:
                        async with sess.get(
                                self.URL.format(sym),
                                params={'interval': '1m', 'range': '1d'},
                                timeout=aiohttp.ClientTimeout(total=20)) as r:
                            if r.status != 200:
                                continue
                            j = await r.json()
                            res = (j.get('chart', {}).get('result') or [None])[0]
                            if not res:
                                continue
                            meta = res.get('meta') or {}
                            px = meta.get('regularMarketPrice')
                            if px is None:
                                continue
                            self.emit(Tick(
                                ts=now_ms(), venue='yahoo', symbol=sym,
                                kind='equity', last=float(px),
                                bid=meta.get('bid') or None,
                                ask=meta.get('ask') or None,
                                volume=meta.get('regularMarketVolume'),
                                venue_ts=(meta.get('regularMarketTime') or 0) * 1000))
                    except (asyncio.TimeoutError, aiohttp.ClientError):
                        self.errors += 1
                await asyncio.sleep(self.interval)


class CoinbaseWS(Provider):
    """Coinbase Advanced Trade ticker - a second independent crypto source.

    Independence is the point, not coverage. This project published a strategy
    with a Sharpe of 3.30 that turned out to be an artefact of one vendor's
    opening prices, and it was caught only because two ETFs on the SAME index
    happened to disagree. A single feed cannot be checked against itself: internal
    consistency proves a series is well-FORMED, never that it is CORRECT. Only an
    independent measurement of the same underlying thing does that.
    """
    name = 'coinbase'
    URL = 'wss://ws-feed.exchange.coinbase.com'

    async def _session(self, stop):
        async with websockets.connect(self.URL, ping_interval=20,
                                      ping_timeout=20) as ws:
            await ws.send(json.dumps({'type': 'subscribe',
                                      'product_ids': self.symbols,
                                      'channels': ['ticker']}))
            self.connected = True
            print('[coinbase] connected: {}'.format(', '.join(self.symbols)), flush=True)
            while not stop.is_set():
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=60))
                if msg.get('type') != 'ticker':
                    continue
                bid, ask = msg.get('best_bid'), msg.get('best_ask')
                if not bid or not ask:
                    continue
                self.emit(Tick(
                    ts=now_ms(), venue='coinbase', symbol=msg.get('product_id', '?'),
                    kind='crypto', bid=float(bid), ask=float(ask),
                    last=float(msg.get('price') or 0) or None,
                    volume=float(msg.get('volume_24h') or 0) or None))


class KrakenWS(Provider):
    """Kraken ticker - a third independent crypto source."""
    name = 'kraken'
    URL = 'wss://ws.kraken.com/v2'

    async def _session(self, stop):
        async with websockets.connect(self.URL, ping_interval=20,
                                      ping_timeout=20) as ws:
            await ws.send(json.dumps({'method': 'subscribe',
                                      'params': {'channel': 'ticker',
                                                 'symbol': self.symbols}}))
            self.connected = True
            print('[kraken] connected: {}'.format(', '.join(self.symbols)), flush=True)
            while not stop.is_set():
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=60))
                if msg.get('channel') != 'ticker':
                    continue
                for d in (msg.get('data') or []):
                    if d.get('bid') is None or d.get('ask') is None:
                        continue
                    self.emit(Tick(
                        ts=now_ms(), venue='kraken', symbol=d.get('symbol', '?'),
                        kind='crypto', bid=float(d['bid']), ask=float(d['ask']),
                        last=float(d.get('last') or 0) or None,
                        bid_size=float(d.get('bid_qty') or 0) or None,
                        ask_size=float(d.get('ask_qty') or 0) or None))


REGISTRY = {'binance': BinanceWS, 'hyperliquid': HyperliquidWS,
            'yahoo': YahooPoll, 'coinbase': CoinbaseWS, 'kraken': KrakenWS}


def build(markets, on_tick):
    """Group enabled markets by provider and instantiate one adapter each.

    One connection per VENUE rather than per symbol - venues multiplex, and a
    socket per symbol would exhaust connection limits long before it exhausted
    bandwidth.
    """
    by_provider = {}
    for m in markets:
        if m.enabled:
            by_provider.setdefault(m.provider, []).append(m.symbol)
    out = []
    for prov, syms in by_provider.items():
        cls = REGISTRY.get(prov)
        if not cls:
            print('[warn] no adapter for provider {!r}, skipping {}'.format(
                prov, syms), flush=True)
            continue
        out.append(cls(syms, on_tick))
    return out
