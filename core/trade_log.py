"""
Structured, append-only trade log (JSON Lines) - the source of truth for
analytics and the adaptive optimizer. The human-readable Trade-Journal.md in
the vault is for Claude/Gabe to read; this file is for code to read reliably
without parsing markdown.
"""

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

DEFAULT_LOG_PATH = Path(__file__).parent.parent / "data" / "trade_log.jsonl"


@dataclass
class ClosedTrade:
    timestamp: str
    coin: str
    direction: str          # "long" | "short"
    strategy_variant: str   # e.g. "sma_10_30" - which parameter set produced this trade
    entry_price: float
    exit_price: float
    size_usd: float
    pnl_usd: float
    pnl_pct: float
    won: bool
    reason: str              # "stop_loss" | "take_profit" | "signal_flip" | "manual"


def log_closed_trade(trade: ClosedTrade, path: Path = DEFAULT_LOG_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a") as f:
        f.write(json.dumps(asdict(trade)) + "\n")


def read_trades(path: Path = DEFAULT_LOG_PATH, coin: Optional[str] = None) -> List[ClosedTrade]:
    if not path.exists():
        return []
    trades = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)
            if coin and data.get("coin") != coin:
                continue
            trades.append(ClosedTrade(**data))
    return trades


def make_trade(coin, direction, variant, entry, exit_price, size_usd, reason) -> ClosedTrade:
    raw = (exit_price - entry) / entry if direction == "long" else (entry - exit_price) / entry
    pnl_usd = raw * size_usd
    return ClosedTrade(
        timestamp=datetime.now(timezone.utc).isoformat(),
        coin=coin,
        direction=direction,
        strategy_variant=variant,
        entry_price=entry,
        exit_price=exit_price,
        size_usd=size_usd,
        pnl_usd=pnl_usd,
        pnl_pct=raw,
        won=pnl_usd > 0,
        reason=reason,
    )
