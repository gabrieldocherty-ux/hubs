"""
Continuous collector: every data stream this project needs, at the fastest rate
that is actually safe.

WHY A DAEMON AND NOT A SCHEDULED TASK. Windows Task Scheduler's finest granularity
is one minute. These crypto windows are five minutes long, so once a minute gives
five observations per market - enough to see that the contract lags the
underlying, nowhere near enough to measure by how much or to act on it. A
long-running loop can poll every few seconds.

WHAT THE RATE LIMITS ACTUALLY ALLOW (checked, not assumed):
    Gamma /markets      300 requests / 10s
    Gamma /events       500 / 10s
    CLOB book/price   1,500 / 10s
One /markets page returns 100 markets WITH their bid/ask, so a complete
near-expiry sweep costs about four requests. At a 10-second cadence that is
0.4 requests/second against a 30/second ceiling - roughly 1% of the allowance.
Going faster is possible; it is not obviously useful, because the underlying
candles are minute-resolution and the marginal information in a 2-second poll of a
5-minute market is small. 10 seconds is chosen as fast enough to capture the lag
and slow enough to be a good citizen.

Polymarket throttles by DELAYING rather than rejecting, so the failure mode of
being too aggressive is not an error you would notice - it is silently slower data
and a degraded relationship with the venue. Hence the deliberate margin.

THE STREAMS, each at the rate its data actually changes:
    near-expiry tick      every 10s    the active experiment: contract vs underlying
    resolution harvest    every  5m    joins settled outcomes back to recorded prices
    broad snapshot        every 15m    the wider calibration study across all markets
    open-interest         every  1h    Hyperliquid OI, already collected elsewhere

CRASH SAFETY. Every stream appends to its own JSONL as it goes, so a kill at any
moment loses at most one pass. The loop catches and logs exceptions per stream
rather than dying - one endpoint failing must not stop the others, a lesson this
project already learned when a single strategy error silently halted a whole
scheduled cycle.
"""
import datetime
import json
import pathlib
import sys
import time
import traceback

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
ROOT = HERE.parent
LOG = ROOT / 'data' / 'poly_daemon.log'
LOG.parent.mkdir(exist_ok=True)

sys.path.insert(0, str(ROOT))      # so `from core import ...` resolves
import poly_collector
import poly_tracker
import polymarket_data as pm

TICKS = ROOT / 'data' / 'poly_track.jsonl'
OUTCOMES = ROOT / 'data' / 'poly_outcomes.json'

# seconds between passes for each stream
# 'snapshot' covers ALL markets including politics and sport, where there is no
# underlying price feed and therefore no computable fair value - it can only ever
# support a slow calibration study, never a tradeable signal. Demoted to hourly so
# the request budget goes to the crypto assets, which are the ones that can be
# priced.
# tick: 0 = run continuously, back-to-back, with only the MIN_GAP floor below.
# A pass costs about 6 requests and takes ~2s, so continuous polling lands near
# 3 requests/second against a documented 30/second ceiling on Gamma /markets -
# roughly a tenth of the allowance. The floor exists so that if the API ever
# answers instantly the loop cannot spin into a hot request storm.
INTERVALS = {'tick': 0, 'harvest': 300, 'snapshot': 3600, 'oi': 3600}
MIN_GAP = 0.5


def log(msg):
    line = '{} {}'.format(
        datetime.datetime.now(datetime.timezone.utc).strftime('%H:%M:%S'), msg)
    print(line, flush=True)
    try:
        with LOG.open('a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass


def stream_tick():
    rows = poly_tracker.track(max_hours=1.5)
    live = sum(1 for r in rows if r.get('started'))
    return '{} markets, {} in progress'.format(len(rows), live)


def stream_harvest(budget=40):
    """Resolve only markets whose end time has actually PASSED, a bounded number
    per pass.

    The first version called poly_collector.harvest(), which re-queried every
    market ever seen - 100 single-market lookups taking 30.8 seconds, during which
    the 10-second tick stream could not run at all. A slow stream starving a fast
    one is the real bug; capping the work per pass fixes it without losing
    anything, because a market that resolved stays resolved and will be picked up
    on the next pass regardless.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    known = {}
    if OUTCOMES.exists():
        try:
            known = json.loads(OUTCOMES.read_text())
        except Exception:
            known = {}
    due = {}
    if TICKS.exists():
        for line in TICKS.open(encoding='utf-8'):
            try:
                r = json.loads(line)
            except Exception:
                continue
            mid = str(r.get('id'))
            if not mid or known.get(mid) is not None:
                continue
            try:
                end = datetime.datetime.fromisoformat(r['end'])
            except Exception:
                continue
            if end < now:                      # only ask about expired windows
                due[mid] = end
    todo = sorted(due, key=lambda k: due[k])[:budget]
    found = 0
    for mid in todo:
        m = pm._get(pm.GAMMA + '/markets/' + mid)
        if not isinstance(m, dict) or not m.get('closed'):
            continue
        op = pm.parse_json_field(m.get('outcomePrices'))
        outs = pm.parse_json_field(m.get('outcomes'))
        if not op or not outs:
            continue
        try:
            idx = next((k for k, o in enumerate(outs)
                        if str(o).lower() in ('yes', 'up')), 0)
            v = float(op[idx])
        except (ValueError, IndexError, TypeError):
            continue
        if v in (0.0, 1.0):
            known[mid] = v
            found += 1
    if found:
        OUTCOMES.write_text(json.dumps(known))
    return '{} due, {} checked, {} resolved'.format(len(due), len(todo), found)


def stream_snapshot():
    rows = poly_collector.snapshot(min_volume=200, pages=10)
    return '{} observations'.format(len(rows))


def stream_oi():
    try:
        from core import oi_collector
        got = oi_collector.collect()
        return '{} rows'.format(len(got))
    except Exception as e:
        return 'skipped ({})'.format(type(e).__name__)


STREAMS = {'tick': stream_tick, 'harvest': stream_harvest,
           'snapshot': stream_snapshot, 'oi': stream_oi}


def main(run_seconds=None):
    started = time.time()
    last = {k: 0.0 for k in STREAMS}
    fails = {k: 0 for k in STREAMS}
    passes = {k: 0 for k in STREAMS}
    log('daemon starting | intervals: {}'.format(
        ', '.join('{}={}s'.format(k, v) for k, v in INTERVALS.items())))

    while True:
        if run_seconds and (time.time() - started) > run_seconds:
            log('run_seconds reached, stopping. passes: {}'.format(passes))
            return
        now = time.time()
        for name, fn in STREAMS.items():
            if now - last[name] < max(INTERVALS[name], MIN_GAP if name == 'tick' else 0):
                continue
            t0 = time.time()
            try:
                detail = fn()
                took = time.time() - t0
                passes[name] += 1
                fails[name] = 0
                # only log the fast stream occasionally, or it drowns the file
                if name != 'tick' or passes[name] % 60 == 1:
                    log('{:9} {:<34} {:.1f}s  (pass {}, {:.1f} req/s, {} throttled)'.format(
                        name, detail, took, passes[name],
                        pm.rate(), pm.STATS['throttled']))
            except Exception:
                fails[name] += 1
                log('{:9} FAILED ({} in a row)\n{}'.format(
                    name, fails[name], traceback.format_exc(limit=2)))
                # exponential backoff on a failing stream so a broken endpoint
                # does not get hammered, capped so it always eventually retries
                last[name] = time.time() + min(300, 10 * (2 ** min(fails[name], 5)))
                continue
            last[name] = time.time()
        time.sleep(0.1)


if __name__ == '__main__':
    secs = None
    if len(sys.argv) > 1:
        try:
            secs = float(sys.argv[1])
        except ValueError:
            pass
    try:
        main(secs)
    except KeyboardInterrupt:
        log('stopped by user')
