"""Restart the collector daemon if it is not running.

A background process does not survive a reboot, a crash, or the terminal that
launched it going away - and a collector that silently stopped is worse than one
that never started, because the gap in the data is invisible until someone looks.
This is run by the scheduler every few minutes and does nothing at all unless the
daemon is absent.
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PY = r'C:\Users\gdoch\AppData\Local\Programs\Python\Python312\python.exe'
DAEMON = str(ROOT / 'research' / 'poly_daemon.py')


def running():
    out = subprocess.run(
        ['wmic', 'process', 'where', "name='python.exe'", 'get', 'CommandLine'],
        capture_output=True, text=True, timeout=60).stdout
    return 'poly_daemon' in out


if __name__ == '__main__':
    if running():
        print('daemon already running')
        sys.exit(0)
    subprocess.Popen([PY, DAEMON], cwd=str(ROOT),
                     creationflags=subprocess.CREATE_NO_WINDOW
                     if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0)
    print('daemon started')
