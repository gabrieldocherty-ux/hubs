"""
Honest backtester: walks forward through historical candles bar-by-bar so the
strategy only ever sees data up to "now" (no lookahead), applies a fee +
estimated slippage cost to every simulated trade, and reports the stats the
Kelly sizer needs (win rate, avg win, avg loss) plus expectancy.

This is the gate mentioned everywhere else in this codebase: a strategy does
not get to run in `--mode live` (or even testnet, really) until this has been
run against it and produced a positive, cost-inclusive expectancy over a
reasonable sample size and time range.
"""

from dataclasses import dataclass, field
from typing import List, Optional

from core.strategy_base import Direction, Strategy

# Cost model. MEASURED against Hyperliquid's live order book on 2026-09-05 at
# this account's actual order size ($10-$250 notional), not assumed:
#
#   taker fee                     0.045%  (base tier; this account has no volume
#                                          history, so no tier discount applies)
#   maker fee                     0.015%  (not used - every strategy here sends
#                                          market orders on a daily-bar signal)
#   slippage incl. half-spread    0.006%  BTC, 0.020% ETH, 0.048% SOL, 0.006% HYPE
#   => real round trip            0.091%-0.100%
#
# ASSUMED_SLIPPAGE stays at 0.05% per side (0.19% round trip) deliberately, which
# is roughly DOUBLE the measured cost. Two reasons, and neither is laziness:
#   1. That book snapshot was taken in calm conditions. The forced-flow
#      strategies trade specifically on cascade days, when spreads widen and
#      depth thins - exactly the days a calm-market measurement flatters.
#   2. Every validated result in Crypto-Trading.md was produced at 0.19%. Moving
#      the constant would silently restate all of them upward.
# The strategies survive 3-4x this figure anyway, so execution cost is not the
# binding constraint on any of them - which is the actual finding here.
TAKER_FEE = 0.00045
MAKER_FEE = 0.00015
ASSUMED_SLIPPAGE = 0.0005
MEASURED_SLIPPAGE = 0.00005   # live-book reality, for reference/sensitivity runs


@dataclass
class BacktestTrade:
    direction: Direction
    entry_price: float
    exit_price: float
    stop_loss_price: float
    pnl_pct: float
    won: bool


@dataclass
class BacktestReport:
    trades: List[BacktestTrade] = field(default_factory=list)

    @property
    def win_rate(self) -> float:
        return sum(1 for t in self.trades if t.won) / len(self.trades) if self.trades else 0.0

    @property
    def avg_win_pct(self) -> float:
        wins = [t.pnl_pct for t in self.trades if t.won]
        return sum(wins) / len(wins) if wins else 0.0

    @property
    def avg_loss_pct(self) -> float:
        losses = [-t.pnl_pct for t in self.trades if not t.won]
        return sum(losses) / len(losses) if losses else 0.0

    @property
    def expectancy_pct(self) -> float:
        """Average pnl per trade, already net of the modeled costs."""
        return sum(t.pnl_pct for t in self.trades) / len(self.trades) if self.trades else 0.0

    def summary(self) -> str:
        n = len(self.trades)
        if n == 0:
            return "No trades generated over this window - strategy is too conservative, or window too short."
        verdict = "POSITIVE (cost-inclusive)" if self.expectancy_pct > 0 else "NEGATIVE or break-even"
        return (
            f"{n} trades | win rate {self.win_rate:.1%} | "
            f"avg win {self.avg_win_pct:.2%} | avg loss {self.avg_loss_pct:.2%} | "
            f"expectancy/trade {self.expectancy_pct:.3%} | edge: {verdict}"
        )


def run_backtest(
    strategy: Strategy,
    coin: str,
    closes: List[float],
    warmup_bars: int = 30,
) -> BacktestReport:
    report = BacktestReport()
    open_signal = None

    for i in range(warmup_bars, len(closes)):
        window = closes[: i + 1]
        price = closes[i]

        if open_signal is None:
            signal = strategy.evaluate({"coin": coin, "closes": window})
            if signal is not None:
                open_signal = signal
            continue

        # Manage the open position: exit on stop, or on an opposite signal
        hit_stop = (
            (open_signal.direction == Direction.LONG and price <= open_signal.stop_loss_price)
            or (open_signal.direction == Direction.SHORT and price >= open_signal.stop_loss_price)
        )
        opposite_signal = strategy.evaluate({"coin": coin, "closes": window})
        should_exit = hit_stop or (
            opposite_signal is not None and opposite_signal.direction != open_signal.direction
        )

        if should_exit:
            exit_price = open_signal.stop_loss_price if hit_stop else price
            raw_pct = (
                (exit_price - open_signal.entry_price) / open_signal.entry_price
                if open_signal.direction == Direction.LONG
                else (open_signal.entry_price - exit_price) / open_signal.entry_price
            )
            cost = 2 * (TAKER_FEE + ASSUMED_SLIPPAGE)  # entry + exit, both taker-ish
            pnl_pct = raw_pct - cost
            report.trades.append(
                BacktestTrade(
                    direction=open_signal.direction,
                    entry_price=open_signal.entry_price,
                    exit_price=exit_price,
                    stop_loss_price=open_signal.stop_loss_price,
                    pnl_pct=pnl_pct,
                    won=pnl_pct > 0,
                )
            )
            open_signal = opposite_signal if (opposite_signal and not hit_stop) else None

    return report


def _cli():
    import argparse
    import time as _time

    from api.hyperliquid_client import HyperliquidClient
    from config.settings import get_settings
    from core.strategies.placeholder import PlaceholderMACross
    from wallet.agent_wallet import AgentWallet

    parser = argparse.ArgumentParser()
    parser.add_argument("--strategy", default="placeholder_ma_cross")
    parser.add_argument("--coin", default="BTC")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--interval", default="1h", help="candle interval, e.g. 15m, 1h, 1d")
    args = parser.parse_args()

    settings = get_settings()
    wallet = AgentWallet(settings.wallet_file)
    if wallet.has_saved_wallet:
        wallet.unlock()
        client = HyperliquidClient(settings, wallet)
    else:
        # Backtesting only needs the public Info API, no wallet required
        from hyperliquid.info import Info
        from hyperliquid.utils import constants
        info = Info(constants.TESTNET_API_URL if not settings.is_mainnet else constants.MAINNET_API_URL, skip_ws=True)
        client = None

    now_ms = int(_time.time() * 1000)
    start_ms = now_ms - args.days * 24 * 60 * 60 * 1000

    if client:
        candles = client.candles(args.coin, args.interval, start_ms, now_ms)
    else:
        candles = info.candles_snapshot(args.coin, args.interval, start_ms, now_ms)

    closes = [float(c["c"]) for c in candles]
    print(f"Pulled {len(closes)} candles for {args.coin} over {args.days}d at {args.interval} resolution")

    if args.strategy == "placeholder_ma_cross":
        strategy = PlaceholderMACross()
    else:
        raise SystemExit(f"Unknown strategy: {args.strategy}")

    report = run_backtest(strategy, args.coin, closes)
    print(report.summary())
    if report.expectancy_pct <= 0:
        print("\nNo validated edge here - do not enable Kelly sizing or go live on this strategy as-is.")


if __name__ == "__main__":
    _cli()
