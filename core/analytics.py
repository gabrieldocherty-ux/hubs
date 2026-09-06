"""
Profitability / alpha / risk reporting from the structured trade log.

"Alpha" here is the simple, honest definition: strategy return minus what you
would have made just buy-and-holding the same asset over the same period.
It is NOT a beta-adjusted CAPM alpha - that needs a real benchmark
regression, which isn't worth pretending to have with a few dozen trades.
Said plainly in the report so nobody reads more precision into this than
exists.
"""

import math
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional

from core.trade_log import ClosedTrade, read_trades


@dataclass
class PerformanceStats:
    n_trades: int
    win_rate: float
    avg_win_pct: float
    avg_loss_pct: float
    expectancy_pct: float
    total_return_pct: float           # sum of pnl_pct, unsized - shape of returns, not compounded equity
    max_drawdown_pct: float           # on the same unsized cumulative-return series
    sharpe_like: float                # mean/stdev of per-trade returns, NOT annualized - a shape signal only
    buy_hold_return_pct: Optional[float]
    alpha_pct: Optional[float]        # total_return_pct - buy_hold_return_pct, only if benchmark provided


def _max_drawdown(cumulative: List[float]) -> float:
    peak = float("-inf")
    max_dd = 0.0
    for v in cumulative:
        peak = max(peak, v)
        max_dd = min(max_dd, v - peak)
    return max_dd


def compute_stats(trades: List[ClosedTrade], buy_hold_return_pct: Optional[float] = None) -> PerformanceStats:
    if not trades:
        return PerformanceStats(0, 0, 0, 0, 0, 0, 0, 0, buy_hold_return_pct, None)

    pnls = [t.pnl_pct for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [-p for p in pnls if p <= 0]

    cumulative, running = [], 0.0
    for p in pnls:
        running += p
        cumulative.append(running)

    mean = sum(pnls) / len(pnls)
    variance = sum((p - mean) ** 2 for p in pnls) / len(pnls)
    stdev = math.sqrt(variance)
    sharpe_like = mean / stdev if stdev > 0 else 0.0

    total_return_pct = cumulative[-1]
    alpha = (total_return_pct - buy_hold_return_pct) if buy_hold_return_pct is not None else None

    return PerformanceStats(
        n_trades=len(trades),
        win_rate=len(wins) / len(trades),
        avg_win_pct=sum(wins) / len(wins) if wins else 0.0,
        avg_loss_pct=sum(losses) / len(losses) if losses else 0.0,
        expectancy_pct=mean,
        total_return_pct=total_return_pct,
        max_drawdown_pct=_max_drawdown(cumulative),
        sharpe_like=sharpe_like,
        buy_hold_return_pct=buy_hold_return_pct,
        alpha_pct=alpha,
    )


def format_report(stats: PerformanceStats, coin: str) -> str:
    if stats.n_trades == 0:
        return f"# Performance Report - {coin}\n\nNo closed trades yet.\n"

    lines = [
        f"# Performance Report - {coin}",
        f"Generated: {datetime.now().isoformat(timespec='seconds')}",
        "",
        f"- Trades: {stats.n_trades}",
        f"- Win rate: {stats.win_rate:.1%}",
        f"- Avg win: {stats.avg_win_pct:.2%} | Avg loss: {stats.avg_loss_pct:.2%}",
        f"- Expectancy per trade: {stats.expectancy_pct:.3%}",
        f"- Total return (unsized, sum of trade returns): {stats.total_return_pct:.2%}",
        f"- Max drawdown (on that same unsized series): {stats.max_drawdown_pct:.2%}",
        f"- Sharpe-like ratio (mean/stdev of trade returns, NOT annualized): {stats.sharpe_like:.2f}",
    ]
    if stats.buy_hold_return_pct is not None:
        lines += [
            f"- Buy-and-hold return over same period: {stats.buy_hold_return_pct:.2%}",
            f"- Alpha vs buy-and-hold (simple, not beta-adjusted): {stats.alpha_pct:+.2%}",
        ]
    lines.append(
        "\nCaveat: 'Sharpe-like' and 'alpha' here are simplified, honest approximations "
        "for a small trade sample - not institutional-grade risk-adjusted metrics. Treat "
        "direction and rough magnitude as meaningful; don't over-read the precision."
    )
    return "\n".join(lines) + "\n"


def buy_hold_return(closes: List[float]) -> float:
    return (closes[-1] - closes[0]) / closes[0]
