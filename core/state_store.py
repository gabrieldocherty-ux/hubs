"""
Tiny JSON persistence helper. Exists because the bot can't rely on a
long-running background process on Gabe's machine (the automation bridge
that manages his files only gives short-lived, isolated shell sessions - it
can't host something that keeps running between calls). The fix is to make
every run of main.py stateless-but-persistent: `--once` runs exactly one
check-and-act cycle per coin and exits, and anything that needs to survive
to the next invocation (open paper positions, the adaptive strategy's
shadow-evaluation history, which bar was last seen) gets written to a small
JSON file here instead of staying only in memory. A scheduler outside the
bot (see README) then just has to invoke `--once` on a timer - it never has
to keep a process alive itself.
"""

import json
from pathlib import Path


def load_json(path: str, default):
    p = Path(path)
    if not p.exists():
        return default
    try:
        with p.open() as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return default


def save_json(path: str, data) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    with tmp.open("w") as f:
        json.dump(data, f, indent=2)
    tmp.replace(p)  # atomic-ish swap so a crash mid-write can't corrupt state
