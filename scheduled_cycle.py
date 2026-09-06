#!/usr/bin/env python3
"""
Single entry point for the scheduled paper-bot cycle: run one cycle, refresh
the dashboard, append everything to data/paper_run.log.

Why this exists rather than a .bat wrapper: the first Task Scheduler attempt
invoked run_paper_cycle.bat, and the run died mid-cycle with exit code
0xC000013A (STATUS_CONTROL_C_EXIT) - the cmd.exe console the task creates can
receive a control event and take the Python child down with it, leaving a
half-finished cycle and a '^C' in the log. Calling python.exe directly removes
cmd.exe from the chain, and doing the log redirection inside Python removes the
dependency on shell redirection surviving that console.

Console control events are also handled explicitly below, so if this process is
ever signalled it records that fact in the log instead of vanishing silently -
this bot has already lost a week to failures that left no trace.
"""

import io
import os
import signal
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
LOG = ROOT / "data" / "paper_run.log"
MAX_LOG_BYTES = 2_000_000        # keep the log from growing without bound


def rotate_if_large():
    try:
        if LOG.exists() and LOG.stat().st_size > MAX_LOG_BYTES:
            keep = LOG.read_text(errors="replace")[-MAX_LOG_BYTES // 2:]
            LOG.write_text("[log truncated]\n" + keep)
    except Exception:
        pass


class Tee(io.TextIOBase):
    """Write to the log and to the real stdout, so a manual run still shows output."""

    def __init__(self, handle, mirror):
        self.handle = handle
        self.mirror = mirror

    def write(self, s):
        self.handle.write(s)
        self.handle.flush()
        try:
            if self.mirror:
                self.mirror.write(s)
                self.mirror.flush()
        except Exception:
            pass
        return len(s)

    def flush(self):
        self.handle.flush()


def main():
    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))
    LOG.parent.mkdir(parents=True, exist_ok=True)
    rotate_if_large()

    real_out, real_err = sys.stdout, sys.stderr
    fh = open(LOG, "a", encoding="utf-8", errors="replace")
    tee = Tee(fh, real_out)
    sys.stdout = tee
    sys.stderr = tee

    def on_signal(signum, frame):
        print("\n!!! cycle interrupted by signal {} at {} - state on disk is still "
              "consistent, the next hourly run picks up from it".format(
                  signum, datetime.now(timezone.utc).isoformat()))
        fh.flush()
        os._exit(130)

    for sig in ("SIGINT", "SIGTERM", "SIGBREAK"):
        if hasattr(signal, sig):
            try:
                signal.signal(getattr(signal, sig), on_signal)
            except (ValueError, OSError):
                pass

    started = datetime.now(timezone.utc)
    print("\n===== cycle start {} =====".format(started.isoformat(timespec="seconds")))

    rc = 0
    try:
        import main as bot
        # Base size comes from config/settings.json so the return target lives in
        # one place, not hardcoded in a scheduler script nobody re-reads.
        import json
        cfg = json.loads((ROOT / "config" / "settings.json").read_text())
        base = str(cfg.get("base_size_usd", 12.5))
        sys.argv = ["main.py", "--mode", "paper", "--coins", "BTC,ETH,SOL",
                    "--bar-interval", "4h", "--once", "--base-size-usd", base]
        bot.main()
    except SystemExit as e:
        rc = int(e.code or 0)
        if rc:
            print("bot exited with code {}".format(rc))
    except Exception:
        rc = 1
        print("CYCLE FAILED:\n" + traceback.format_exc())

    # Refresh the board even if the cycle failed - a stale board that silently
    # stops updating is worse than one that shows the failure.
    try:
        import dashboard
        d = dashboard.collect()
        (ROOT / "dashboard.html").write_text(dashboard.build(d), encoding="utf-8")
        print("dashboard refreshed: {} closed trades, {} open positions".format(
            len(d["trades"]), len(d["positions"])))
    except Exception:
        print("dashboard refresh failed:\n" + traceback.format_exc())

    took = (datetime.now(timezone.utc) - started).total_seconds()
    print("===== cycle end rc={} in {:.1f}s =====".format(rc, took))

    # Restore BOTH streams before closing the file. Getting this order wrong is
    # not cosmetic: if sys.stderr is still the Tee when `fh` closes, CPython's
    # shutdown flush hits a closed file and the process exits 120 - its
    # dedicated "failed to flush stdout/stderr on exit" code - while the log
    # still shows a clean rc=0. That is exactly what Task Scheduler reported
    # before this fix, and a task whose recorded result disagrees with its own
    # log is the kind of thing that hides a real failure later.
    sys.stdout = real_out
    sys.stderr = real_err
    try:
        fh.flush()
        fh.close()
    except Exception:
        pass
    return rc


if __name__ == "__main__":
    sys.exit(main())
