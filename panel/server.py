"""
Local panel: live markets, the strategy library, and a trading section.

WHY A LOCAL SERVER RATHER THAN A HOSTED PAGE. The panel has to read the live tick
store on this machine and will eventually place orders. Both of those are local
concerns, and neither survives being a static page somewhere else.

WHAT IT DELIBERATELY DOES NOT DO. There is a trading section and it is wired to
PAPER only. No code path here can reach a live venue, because the project's rails
say an agent wallet is required for real orders and no wallet exists. The section
is built so the plumbing is real and reviewable before any of it is armed - it
shows what WOULD be sent, and records it, and stops there.

The watchlist is the same config/watchlist.json the ingest CLI edits, so adding a
market in the UI and adding it on the command line are the same operation rather
than two that can drift apart.
"""
import json
import sys
import time
from pathlib import Path

from aiohttp import web

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'ingest'))
import core  # noqa: E402

HERE = Path(__file__).resolve().parent
STRATS = HERE / 'strategies.json'


def _dumps(obj):
    """json.dumps that will not die on a date. Quality findings carry expiry
    dates and timestamps in their detail dicts, and a serializer that raises
    turns a monitoring endpoint into a 500 at exactly the moment it has
    something to report."""
    return json.dumps(obj, default=str)
ORDERS = ROOT / 'data' / 'paper_orders.jsonl'


# DuckDB permits exactly ONE read-write process. The panel opening its own
# connection while the ingest process held the lock produced:
#   IOException: File is already open in python.exe (PID ...)
# Rather than work around that with export files and their attendant lag, the
# ingest process now OWNS the store and hands it to the panel. One writer, one
# process, and the panel reads genuinely live state instead of a stale copy.
_STORE = {'s': None}


def store():
    if _STORE['s'] is None:
        _STORE['s'] = core.Store()      # standalone mode, nothing else running
    return _STORE['s']


def attach_store(st):
    """Called by the runner when panel and ingest share a process."""
    _STORE['s'] = st


async def api_markets(request):
    st = store()
    if True:
        latest = {r[0]: r for r in st.latest(500)}
        out = []
        for m in core.load():
            row = latest.get(m.symbol)
            out.append({
                'provider': m.provider, 'symbol': m.symbol, 'kind': m.kind,
                'enabled': m.enabled, 'note': m.note,
                'last': row[3] if row else None,
                'bid': row[4] if row else None,
                'ask': row[5] if row else None,
                'ts': row[6] if row else None,
                'age_s': round((time.time() * 1000 - row[6]) / 1000, 1) if row else None,
            })
        return web.json_response({'markets': out, 'stats': st.stats()})


async def api_add(request):
    b = await request.json()
    ok, msg = core.add(b.get('provider', ''), b.get('symbol', ''),
                       b.get('kind', 'crypto'), b.get('note', ''))
    return web.json_response({'ok': ok, 'message': msg})


async def api_remove(request):
    b = await request.json()
    ok, msg = core.remove(b.get('provider', ''), b.get('symbol', ''))
    return web.json_response({'ok': ok, 'message': msg})


async def api_toggle(request):
    b = await request.json()
    ok, msg = core.enable(b.get('provider', ''), b.get('symbol', ''),
                          bool(b.get('enabled', True)))
    return web.json_response({'ok': ok, 'message': msg})


async def api_divergence(request):
    """Cross-source agreement. Served from the panel rather than a CLI because
    DuckDB allows one writer and the ingest process holds it - the monitor has to
    live where the store already is."""
    import divergence
    st = store()
    return web.json_response({'rows': divergence.check(st),
                              'warn_bps': divergence.WARN_BPS})


async def api_quality(request):
    """Data quality, served in-process for the same reason divergence is.

    THE MONITOR COULD NOT MONITOR THE RUNNING SYSTEM, which is the only time it
    matters. DuckDB allows one writer, the ingest process holds it, and
    `python ingest/quality.py` therefore refused to open the database at all
    whenever the stream was up - so the checks could only be run against a
    STOPPED system. That is backwards: a data-quality alarm you have to halt
    ingestion to hear is not an alarm.

    run_all() already accepts the shared Store, so this costs nothing but a
    route. ?window=<hours> narrows the lookback; the default is 24h and the
    full options and outlier sweeps are the expensive part, so keep it modest
    if calling this often.
    """
    import quality
    try:
        window = float(request.query.get('window', 24.0))
    except (TypeError, ValueError):
        window = 24.0
    findings = quality.run_all(con=store(), window_h=window)
    return web.json_response({
        'summary': quality.summary(findings),
        'window_h': window,
        'findings': [f.to_dict() for f in findings]}, dumps=_dumps)


async def api_strategies(request):
    return web.json_response(json.loads(STRATS.read_text()))


async def api_history(request):
    sym = request.query.get('symbol', '')
    limit = min(int(request.query.get('limit', 300)), 5000)
    st = store()
    st.flush()
    rows = st.con.execute(
        'SELECT ts, last, bid, ask FROM ticks WHERE symbol = ? '
        'ORDER BY ts DESC LIMIT ?', [sym, limit]).fetchall()
    rows.reverse()
    return web.json_response({'symbol': sym, 'points': [
        {'ts': r[0], 'last': r[1], 'bid': r[2], 'ask': r[3]} for r in rows]})


async def api_order(request):
    """Record a PAPER order. Nothing here can reach a venue.

    The order is written to data/paper_orders.jsonl exactly as it would be sent,
    so the shape can be reviewed against a real API before anything is armed.
    """
    b = await request.json()
    order = {
        'ts': int(time.time() * 1000),
        'mode': 'paper',
        'symbol': b.get('symbol'), 'side': b.get('side'),
        'qty': b.get('qty'), 'limit': b.get('limit'),
        'strategy': b.get('strategy'), 'note': b.get('note', ''),
    }
    if not order['symbol'] or order['side'] not in ('buy', 'sell'):
        return web.json_response({'ok': False, 'message': 'symbol and side required'},
                                 status=400)
    ORDERS.parent.mkdir(exist_ok=True)
    with ORDERS.open('a', encoding='utf-8') as f:
        f.write(json.dumps(order) + '\n')
    return web.json_response({'ok': True, 'order': order,
                              'message': 'recorded as PAPER - not sent to any venue'})


async def api_orders(request):
    if not ORDERS.exists():
        return web.json_response({'orders': []})
    rows = []
    for line in ORDERS.open(encoding='utf-8'):
        try:
            rows.append(json.loads(line))
        except Exception:
            pass
    return web.json_response({'orders': rows[-200:][::-1]})


async def index(request):
    return web.FileResponse(HERE / 'index.html')


def build_app():
    app = web.Application()
    app.add_routes([
        web.get('/', index),
        web.get('/api/markets', api_markets),
        web.post('/api/markets/add', api_add),
        web.post('/api/markets/remove', api_remove),
        web.post('/api/markets/toggle', api_toggle),
        web.get('/api/strategies', api_strategies),
        web.get('/api/divergence', api_divergence),
        web.get('/api/quality', api_quality),
        web.get('/api/history', api_history),
        web.get('/api/orders', api_orders),
        web.post('/api/orders', api_order),
    ])
    return app


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    print('panel on http://127.0.0.1:{}'.format(port))
    # 127.0.0.1 only - never 0.0.0.0. This serves account state and an order
    # endpoint; binding it to every interface would expose both to the network.
    web.run_app(build_app(), host='127.0.0.1', port=port, print=None)
