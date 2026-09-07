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

    # THE BOOK. Every validated strategy runs against the same shared paper
    # account on LIVE mainnet prices, each in its own `book` namespace so two
    # strategies holding the same coin cannot overwrite each other's position.
    #
    # Running only one strategy - which is what this did until 2026-09-07 - meant
    # everything the research validated sat idle while the one strategy that
    # FAILED the cost cut was the only thing trading.
    #
    # B1 basis deliberately excludes SOL: it does not work there (trimmed -0.09%).
    # adaptive_trend stays listed only so the open SOL position it already holds
    # can be managed to its exit; it was cut on cost efficiency.
    BOOK = [
        ("forced_flow", "1d", "BTC,ETH,SOL,HYPE", "s3"),
        ("range_break", "1d", "BTC,ETH,SOL,HYPE", "d1"),
        ("basis", "1d", "BTC,ETH,HYPE", "b1"),
        ("donchian", "1d", "BTC,ETH,SOL,HYPE", "m3"),
        ("adaptive_trend", "4h", "BTC,ETH,SOL", ""),
    ]

    rc = 0
    import json
    cfg = json.loads((ROOT / "config" / "settings.json").read_text())
    base = str(cfg.get("base_size_usd", 16.25))
    import main as bot

    for strategy, interval, coins, book in BOOK:
        label = book or strategy
        print("\n--- {} ({} on {} bars) ---".format(label, strategy, interval))
        try:
            sys.argv = ["main.py", "--mode", "paper", "--coins", coins,
                        "--bar-interval", interval, "--once",
                        "--base-size-usd", base, "--strategy", strategy]
            if book:
                sys.argv += ["--book", book]
            bot.main()
        except SystemExit as e:
            code = int(e.code or 0)
            if code:
                rc = code
                print("{} exited with code {}".format(label, code))
        except Exception:
            # One strategy failing must not stop the rest of the book - a data
            # hiccup on one coin should not silently halt everything else.
            rc = 1
            print("{} FAILED:\n{}".format(label, traceback.format_exc()))

    # Snapshot open interest / premium / book depth. Hyperliquid serves none of
    # these historically, so every cycle that does not run this is a row that
    # can never be recovered. Cheap now, and the only route to a positioning
    # dataset later.
    try:
        from core import oi_collector
        got = oi_collector.collect()
        st = oi_collector.stats()
        print("OI snapshot: {} rows written | history {} rows / {:.2f} days".format(
            len(got), st["rows"], st["days"]))
    except Exception:
        print("OI collection failed (non-fatal):\n" + traceback.format_exc())

    # Record what changed this hour. Runs in Python, not in a Claude prompt, so
    # the record has no hole in it for every hour the app happened to be closed.
    try:
        from core import change_log
        summary = change_log.record(cycle_note="rc={}".format(rc))
        print("CHANGE SUMMARY: " + change_log.headline(summary))
        if summary["material"]:
            print("  material events this cycle:")
            for e in summary["events"]:
                print("    - " + e["text"])
    except Exception:
        print("change tracking failed:\n" + traceback.format_exc())

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
