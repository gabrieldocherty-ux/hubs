"""
Keep the ingest process alive, and notice when it is alive but not working.

WHY THIS EXISTS. The ingest process died and nobody found out for TEN HOURS. All
thirteen series stopped at the same instant - which is the signature of the
process going, not of the feeds going - and the only reason it surfaced at all was
someone running the data-quality check by hand. Ten hours of every market this
project watches is simply gone.

THE FAILURE THAT MATTERS IS NOT THE CRASH. A process that exits is the easy case:
it is absent, and anything watching notices. The dangerous case is the one that
stays up and stops working - a supervisor that only checks liveness will report
green forever while the database receives nothing. `ingest/quality.py` documents
the same idea one level down, about feeds: a dead socket reports its last price
forever and looks perfectly healthy.

So this watches OUTPUT, not just the process:

  EXITED          the child is gone. Restart it.
  NOT INGESTING   the child is up but the store's row count has not moved for
                  STALL_S. That is a hang, a deadlocked writer or every adapter
                  down at once, and it is indistinguishable from healthy by any
                  check that only asks "is the pid there".
  UNREACHABLE     the panel does not answer. Treated as a stall rather than as an
                  immediate kill, because a slow request is not the same as a dead
                  process and this project has already been burned once by reading
                  a short HTTP timeout as evidence that a service was down.

BACKOFF, BECAUSE A RESTART LOOP IS ITS OWN OUTAGE. If the child cannot stay up,
restarting it every two seconds produces a machine that is busy, a log that is
useless, and no data either way. Delay grows geometrically to MAX_BACKOFF_S and
resets only after the child has been genuinely healthy for HEALTHY_S.

WHAT THIS DELIBERATELY DOES NOT DO. It does not install itself as a scheduled
task, and it does not touch any existing one. Whether this runs, and how, is
Gabe's decision - this file only makes that decision available:

    python ingest/supervise.py                 # supervise on the default port
    python ingest/supervise.py --port 8788
    python ingest/supervise.py --dry-run       # report health once and exit

It is paper-side infrastructure. It starts a market-data reader and nothing else;
it cannot place an order and has no path to one.
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
RUN = ROOT / 'ingest' / 'run.py'
LOG = ROOT / 'data' / 'supervise.log'

POLL_S = 20.0           # how often health is sampled
STALL_S = 180.0         # rows unchanged this long = not ingesting.
                        # Generous on purpose: the quietest source here is a
                        # 1-minute equity poller, and outside market hours a
                        # genuinely quiet minute must not look like a stall.
HTTP_TIMEOUT_S = 30.0   # the panel answered in 0.015s after the write-path fix,
                        # but a startup backlog took 43s once. A short timeout
                        # here would manufacture the very outage it is watching
                        # for, so this is deliberately loose.
START_GRACE_S = 90.0    # a fresh child opens DuckDB and connects five adapters
HEALTHY_S = 600.0       # healthy this long => the backoff has earned a reset
BASE_BACKOFF_S = 5.0
MAX_BACKOFF_S = 300.0


def log(msg):
    line = '{}  {}'.format(time.strftime('%Y-%m-%d %H:%M:%S'), msg)
    print(line, flush=True)
    try:
        with open(LOG, 'a', encoding='utf-8') as fh:
            fh.write(line + '\n')
    except OSError:
        pass


def probe(port):
    """(rows, symbols) from the panel, or None if it cannot be reached."""
    try:
        with urllib.request.urlopen(
                'http://127.0.0.1:{}/api/markets'.format(port),
                timeout=HTTP_TIMEOUT_S) as r:
            d = json.loads(r.read())
        s = d.get('stats') or {}
        return s.get('rows'), s.get('symbols')
    except (urllib.error.URLError, OSError, ValueError, TimeoutError):
        return None


def spawn(port):
    log('starting: {} {} serve {}'.format(Path(PY).name, RUN.name, port))
    out = open(ROOT / 'data' / 'ingest.log', 'a', encoding='utf-8')
    return subprocess.Popen([PY, str(RUN), 'serve', str(port)],
                            stdout=out, stderr=subprocess.STDOUT, cwd=str(ROOT))


def supervise(port):
    child = spawn(port)
    started = time.time()
    backoff = BASE_BACKOFF_S
    last_rows, last_change = None, time.time()

    while True:
        time.sleep(POLL_S)
        now = time.time()

        code = child.poll()
        if code is not None:
            log('child EXITED with code {} - restarting in {:.0f}s'.format(
                code, backoff))
            time.sleep(backoff)
            backoff = min(MAX_BACKOFF_S, backoff * 2)
            child = spawn(port)
            started, last_rows, last_change = time.time(), None, time.time()
            continue

        if now - started < START_GRACE_S:
            continue

        p = probe(port)
        if p is None or p[0] is None:
            if now - last_change > STALL_S:
                log('panel UNREACHABLE for {:.0f}s - killing and restarting'
                    .format(now - last_change))
                child.kill()
                child.wait(timeout=30)
            continue

        rows = p[0]
        if last_rows is None or rows > last_rows:
            if last_rows is not None and now - started > HEALTHY_S:
                backoff = BASE_BACKOFF_S
            last_rows, last_change = rows, now
            continue

        # Up, answering, and not storing anything.
        if now - last_change > STALL_S:
            log('NOT INGESTING: rows stuck at {:,} for {:.0f}s - killing and '
                'restarting'.format(rows, now - last_change))
            child.kill()
            child.wait(timeout=30)
            last_change = now


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8788)
    ap.add_argument('--dry-run', action='store_true',
                    help='report health once and exit, starting nothing')
    a = ap.parse_args()

    if a.dry_run:
        p = probe(a.port)
        if p is None:
            print('panel on {} UNREACHABLE - ingest is not serving'.format(a.port))
            return 1
        print('panel on {} healthy: {:,} rows, {} symbols'.format(
            a.port, p[0] or 0, p[1] or 0))
        return 0

    log('supervisor up (port {}, stall threshold {:.0f}s)'.format(a.port, STALL_S))
    try:
        supervise(a.port)
    except KeyboardInterrupt:
        log('supervisor interrupted - leaving the child alone')
        return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
