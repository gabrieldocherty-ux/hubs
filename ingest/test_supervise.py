"""
Does the supervisor actually restart? All three paths, against a fake child.

A health probe that returns the right string proves nothing about the loop that
is supposed to act on it. The case worth proving is the one a liveness check
CANNOT see: a child that is up, answering HTTP, and storing nothing. That is the
shape of the failure that cost this project ten hours of every market it watches.

The supervisor's constants are monkeypatched down to seconds so the test
finishes; the logic under test is untouched. A fake HTTP server stands in for the
panel so the live stream is never disturbed, and the child is a process that
sleeps - alive by every measure except the one that matters.

Not in tests/ on purpose: that suite runs in 0.08s and is the risk-rail check
that must stay instant. This one takes ~20s and binds a socket.

    python -m pytest ingest/test_supervise.py -q
    python ingest/test_supervise.py
"""
import json
import pathlib
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import supervise

PORT = 8799
STATE = {'rows': 1000, 'advance': False}
SPAWNS = []


class _Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if STATE['advance']:
            STATE['rows'] += 500
        body = json.dumps({'markets': [],
                           'stats': {'rows': STATE['rows'], 'symbols': 12}})
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *a):
        pass


def _fake_spawn(port):
    """A child that stays alive and does nothing - exactly the failure mode a
    liveness-only supervisor reports as green."""
    p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(600)'])
    SPAWNS.append(p)
    return p


def test_supervisor_restart_paths():
    srv = HTTPServer(('127.0.0.1', PORT), _Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    supervise.POLL_S = 0.5
    supervise.STALL_S = 3.0
    supervise.START_GRACE_S = 1.0
    supervise.HEALTHY_S = 2.0
    supervise.BASE_BACKOFF_S = 0.5
    supervise.MAX_BACKOFF_S = 2.0
    supervise.spawn = _fake_spawn
    supervise.log = lambda m: print('    [supervisor] ' + m, flush=True)

    try:
        STATE['advance'] = False
        threading.Thread(target=supervise.supervise, args=(PORT,),
                         daemon=True).start()

        # 1. up, answering, storing nothing
        time.sleep(8)
        assert len(SPAWNS) > 1, 'supervisor did not restart a stalled child'
        print('    PASS stalled child restarted ({} spawns)'.format(len(SPAWNS)))

        # 2. healthy again - must stop restarting
        STATE['advance'] = True
        base = len(SPAWNS)
        time.sleep(6)
        assert len(SPAWNS) == base, 'supervisor restarted a HEALTHY child'
        print('    PASS healthy child left alone')

        # 3. child exits - must be replaced
        base = len(SPAWNS)
        SPAWNS[-1].kill()
        time.sleep(5)
        assert len(SPAWNS) > base, 'supervisor did not replace an exited child'
        print('    PASS exited child replaced')
    finally:
        for p in SPAWNS:
            try:
                p.kill()
            except Exception:
                pass
        srv.shutdown()


if __name__ == '__main__':
    test_supervisor_restart_paths()
    print('all three supervisor paths verified')
