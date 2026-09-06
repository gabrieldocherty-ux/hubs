"""
Appends one entry per trade to the Claude-Brain vault's Trade-Journal.md,
matching the template already established there, so Claude sessions reading
the vault (per the claude-brain-workflow skill) see the same history the bot
itself is acting on.
"""

from datetime import datetime, timezone
from pathlib import Path

from core.risk_manager import ApprovedTrade
from core.strategy_base import Signal


def log_trade_opened(vault_path: str, trade: ApprovedTrade, signal: Signal) -> None:
    path = Path(__file__).parent.parent / vault_path
    path.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    entry = (
        f"\n## {ts} {trade.coin} {'LONG' if trade.is_buy else 'SHORT'} "
        f"${trade.size_usd:.2f} {trade.leverage}x\n"
        f"- Entry: {trade.entry_price} | Stop: {trade.stop_loss_price} | "
        f"Target: {trade.take_profit_price}\n"
        f"- Signal/rationale: {signal.confidence}\n"
        f"- Status: OPEN\n"
    )
    with open(path, "a") as f:
        f.write(entry)


def log_trade_closed(vault_path: str, coin: str, exit_price: float, pnl_usd: float, lesson: str) -> None:
    path = Path(__file__).parent.parent / vault_path
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    entry = (
        f"\n### CLOSED {ts} {coin}\n"
        f"- Exit: {exit_price} | PnL: ${pnl_usd:+.2f}\n"
        f"- Lesson: {lesson}\n"
    )
    with open(path, "a") as f:
        f.write(entry)
