"""
Runner and CLI for the market data network.

    run.py serve [port]      ingest AND serve the panel (one process, one DB writer)
    run.py stream            ingest only, no panel
    run.py list              show the watchlist
    run.py add <prov> <sym> [kind] [note]
    run.py remove <prov> <sym>
    run.py on|off <prov> <sym>
    run.py status            row counts and the latest price per symbol
    run.py query "<sql>"     ad-hoc SQL against the tick store

THE WATCHLIST IS RELOADED WHILE RUNNING. Adding a market from the CLI (or later
from the panel, which writes the same file) takes effect within a few seconds
without restarting the stream. That matters because a restart drops every socket
and leaves a hole in the data for every OTHER symbol - the cost of adding one
market should not be a gap in all of them.
"""
import asyncio
import json
import signal
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import core
import providers as prov


async def stream(with_panel=False, port=8787):
    store = core.Store()
    runner = None
    if with_panel:
        # Same event loop, same process, same store. This is the only arrangement
        # that gives the panel live data without fighting DuckDB's single-writer
        # lock or introducing an export step that lags behind the stream.
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'panel'))
        import server as panelsrv
        panelsrv.attach_store(store)
        from aiohttp import web as aioweb
        runner = aioweb.AppRunner(panelsrv.build_app())
        await runner.setup()
        # 127.0.0.1 only: this serves account state and an order endpoint.
        await aioweb.TCPSite(runner, '127.0.0.1', port).start()
        print('panel on http://127.0.0.1:{}'.format(port), flush=True)
    stop = asyncio.Event()
    markets = core.load()
    sig = {'key': json.dumps(sorted(m.key() for m in markets if m.enabled))}

    adapters = prov.build(markets, store.add)
    if not adapters:
        print('nothing enabled on the watchlist - add something first')
        return
    tasks = [asyncio.create_task(a.run(stop)) for a in adapters]

    async def supervise():
        """Report health, flush on a timer, and pick up watchlist edits."""
        last_report = 0.0
        while not stop.is_set():
            await asyncio.sleep(2)
            store.flush()
            try:
                fresh = core.load()
                key = json.dumps(sorted(m.key() for m in fresh if m.enabled))
            except Exception:
                key = sig['key']
            if key != sig['key']:
                print('\n[watchlist changed - restarting adapters]', flush=True)
                sig['key'] = key
                for t in tasks:
                    t.cancel()
                tasks.clear()
                for a in prov.build(fresh, store.add):
                    adapters.append(a)
                    tasks.append(asyncio.create_task(a.run(stop)))
            if time.time() - last_report >= 15:
                last_report = time.time()
                s = store.stats()
                line = ' | '.join(
                    '{}:{}{}'.format(h['provider'], h['ticks'],
                                     '' if h['connected'] else '(down)')
                    for h in (a.health() for a in adapters))
                print('{}  rows={} symbols={}  {}'.format(
                    time.strftime('%H:%M:%S'), s['rows'], s['symbols'], line),
                    flush=True)

    sup = asyncio.create_task(supervise())

    def shutdown(*_a):
        stop.set()
    for s in ('SIGINT', 'SIGTERM', 'SIGBREAK'):
        if hasattr(signal, s):
            try:
                signal.signal(getattr(signal, s), shutdown)
            except (ValueError, OSError):
                pass

    print('streaming {} adapters - Ctrl+C to stop'.format(len(adapters)))
    try:
        await stop.wait()
    finally:
        for t in tasks + [sup]:
            t.cancel()
        # Let cancellation actually land before the database is touched. Closing
        # DuckDB while its worker threads are still running is what produced the
        # 'PyEval_SaveThread: GIL not held' fatal error on shutdown.
        await asyncio.gather(*[t for t in tasks + [sup]], return_exceptions=True)
        n = store.flush()
        print('\nflushed {} pending rows, total written {}'.format(n, store.written))
        store.close()


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else 'status'

    if cmd in ('stream', 'serve'):
        port = int(args[1]) if len(args) > 1 and args[1].isdigit() else 8787
        try:
            asyncio.run(stream(with_panel=(cmd == 'serve'), port=port))
        except KeyboardInterrupt:
            pass
    elif cmd == 'list':
        ms = core.load()
        print('{:14}{:14}{:10}{:9}  {}'.format(
            'provider', 'symbol', 'kind', 'enabled', 'note'))
        print('-' * 74)
        for m in ms:
            print('{:14}{:14}{:10}{:9}  {}'.format(
                m.provider, m.symbol, m.kind, 'yes' if m.enabled else 'NO', m.note))
        print('\n{} markets, {} enabled'.format(
            len(ms), sum(1 for m in ms if m.enabled)))
    elif cmd == 'add' and len(args) >= 3:
        ok, msg = core.add(args[1], args[2],
                           args[3] if len(args) > 3 else 'crypto',
                           ' '.join(args[4:]) if len(args) > 4 else '')
        print(msg)
    elif cmd == 'remove' and len(args) >= 3:
        print(core.remove(args[1], args[2])[1])
    elif cmd in ('on', 'off') and len(args) >= 3:
        print(core.enable(args[1], args[2], cmd == 'on')[1])
    elif cmd == 'status':
        store = core.Store()
        s = store.stats()
        print('tick store: {} rows, {} symbols'.format(s['rows'], s['symbols']))
        if s['first']:
            span = (s['last'] - s['first']) / 1000.0
            print('span: {:.0f}s   rate: {:.1f} ticks/s'.format(
                span, s['rows'] / span if span > 0 else 0))
        rows = store.latest(40)
        if rows:
            print('\n{:16}{:14}{:10}{:>14}{:>12}{:>12}'.format(
                'symbol', 'venue', 'kind', 'last', 'bid', 'ask'))
            print('-' * 78)
            for sym, venue, kind, last, bid, ask, _ts in rows:
                print('{:16}{:14}{:10}{:>14}{:>12}{:>12}'.format(
                    sym, venue, kind,
                    '{:,.4f}'.format(last) if last else '-',
                    '{:,.4f}'.format(bid) if bid else '-',
                    '{:,.4f}'.format(ask) if ask else '-'))
        store.close()
    elif cmd == 'query' and len(args) >= 2:
        store = core.Store()
        for row in store.con.execute(args[1]).fetchall():
            print(row)
        store.close()
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
