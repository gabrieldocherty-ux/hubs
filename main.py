#!/usr/bin/env python3
"""
Entry point.

    python main.py --mode paper                # simulated, no real orders, logs to journal, loops forever
    python main.py --mode paper --once          # same, but runs exactly one check-and-act cycle then exits
    python main.py --mode testnet    # real orders against Hyperliquid testnet
    python main.py --mode live       # real money - do not use until backtested + validated

Two ways to keep this running:
  1. `--interval` loop (default): polls prices every `--interval` seconds,
     forever, in one long-lived process. Simple, but needs something to keep
     that process alive - fine on a machine you're going to leave a terminal
     open on.
  2. `--once`: does a single pass over all coins (check for a new closed bar,
     check stop/target, look for a signal, act) and exits immediately. Meant
     to be invoked on a recurring schedule from OUTSIDE this process (cron,
     Windows Task Scheduler, or Claude's own scheduled tasks) - nothing needs
     to stay running between invocations, because every piece of state that
     must survive (open paper positions, the adaptive strategy's shadow
     track record, which bar was last seen) is persisted to data/*.json by
     core/state_store.py and reloaded at the top of the next run. Use this
     mode if there's no reliable way to keep a background process alive on
     the machine actually placing trades.

Polling-based rather than a websocket stream either way - simpler and safer
to reason about for a first version. Can move to Info's websocket
subscriptions later once the strategy itself is proven; no reason to add
that complexity before there's an edge worth reacting to quickly.
"""

import argparse
import time
from pathlib import Path

from api.hyperliquid_client import HyperliquidClient
from config.settings import get_settings
from core.circuit_breaker import CircuitBreaker
from core.executor import Executor
from core.kelly import KellySizer
from core.risk_manager import RiskManager
from core.adaptive_optimizer import AdaptiveTrendStrategy
from core.analytics import buy_hold_return, compute_stats, format_report
from core.state_store import load_json, save_json
from core.trade_log import log_closed_trade, make_trade, read_trades
from wallet.agent_wallet import AgentWallet

BAR_MS = {"15m": 15 * 60 * 1000, "1h": 60 * 60 * 1000, "4h": 4 * 60 * 60 * 1000, "1d": 24 * 60 * 60 * 1000}

# Hyperliquid spot pairs for the basket, needed by strategies that trade the
# perp/spot basis. These are the venue's own internal pair IDs (@142 etc), not
# tickers - resolved from `spotMeta` and pinned here so a reordering of that
# response cannot silently repoint a strategy at the wrong market.
SPOT_PAIR = {"BTC": "@142", "ETH": "@151", "SOL": "@156", "HYPE": "@107"}
CYCLE_STATE_FILE = "data/bot_cycle_state.json"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["paper", "testnet", "live"], default="paper")
    parser.add_argument("--coins", default="BTC,ETH,SOL", help="comma-separated list, e.g. BTC,ETH,SOL")
    parser.add_argument("--interval", type=int, default=60, help="seconds between price/stop-loss checks (ignored with --once)")
    parser.add_argument("--bar-interval", default="4h", choices=["15m", "1h", "4h", "1d"], help="candle size the strategy trades on - must match what it was backtested on")
    parser.add_argument("--base-size-usd", type=float, default=None,
                        help="notional per position. Defaults to base_size_usd in "
                             "config/settings.json (currently sized for the ~10%/yr target).")
    parser.add_argument("--market-data", default="mainnet", choices=["mainnet", "testnet"],
                        dest="market_data",
                        help="where PAPER mode reads prices from. Defaults to mainnet: "
                             "testnet is a separate thin market (HYPE traded at $22.87 there "
                             "vs $83.93 on mainnet on 2026-09-05), so a testnet paper record "
                             "would not describe the real market. No orders are ever placed in "
                             "paper mode regardless.")
    parser.add_argument("--strategy", default="adaptive_trend",
                        choices=["adaptive_trend", "forced_flow", "range_break", "basis",
                                 "donchian"],
                        help="adaptive_trend (default, the validated 4h SMA basket) | "
                             "forced_flow / range_break (daily-bar forced-flow strategies) | "
                             "basis (perp-spot dislocation; needs spot data, BTC/ETH/HYPE only "
                             "- it does not work on SOL) | donchian (55/20 breakout, the MACRO "
                             "sleeve). All of these need --bar-interval 1d. Note adaptive_trend "
                             "was CUT on cost efficiency 2026-09-05 - it pays 30.9%/yr in "
                             "execution cost for a negative trimmed expectancy.")
    parser.add_argument("--once", action="store_true", help="run a single check-and-act cycle and exit, instead of looping - for scheduler-driven invocation")
    args = parser.parse_args()

    settings = get_settings()
    if args.base_size_usd is None:
        args.base_size_usd = settings.base_size_usd
    if args.mode == "live" and not settings.is_mainnet:
        raise SystemExit("config/settings.json network must be 'mainnet' to run --mode live. Refusing to proceed.")
    if args.mode != "live" and settings.is_mainnet:
        raise SystemExit("config/settings.json network is 'mainnet' but --mode isn't 'live'. Refusing - set network to 'testnet' for paper/testnet modes.")

    if args.mode == "paper":
        # Paper mode never signs or sends anything - no wallet needed at all,
        # so it can start generating a real paper-trading track record before
        # the one-time wallet approval step happens.
        from core.paper_account import PaperTradingClient
        client = PaperTradingClient(
            starting_capital=settings.paper_starting_capital,
            network=settings.network,
            market_data=args.market_data,
        )
        print(f"Paper mode: simulated starting capital ${settings.paper_starting_capital:.2f} "
              f"(no wallet required), market data from {args.market_data}")
    else:
        wallet = AgentWallet(settings.wallet_file)
        if not wallet.has_saved_wallet:
            raise SystemExit("No agent wallet set up yet. Run: python wallet/agent_wallet.py setup")
        if not wallet.unlock():
            raise SystemExit("Failed to unlock wallet.")
        client = HyperliquidClient(settings, wallet)
    kelly = KellySizer(
        kelly_fraction=settings.risk.kelly_fraction,
        min_edge=settings.risk.kelly_min_edge,
        max_size_multiplier=settings.risk.kelly_max_size_multiplier,
    )
    breaker = CircuitBreaker(daily_loss_limit_pct=settings.risk.daily_loss_breaker_pct)
    risk_manager = RiskManager(settings.risk, kelly, breaker, allocation=settings.allocation)
    executor = Executor(
        client, risk_manager, settings.vault_journal_path, dry_run=(args.mode == "paper")
    )
    coins = [c.strip().upper() for c in args.coins.split(",") if c.strip()]
    # Note: breaker and kelly are currently shared account-wide (matches the
    # risk manager's account-level circuit breaker design) - each coin gets
    # its own strategy instance and position/price-history state.
    #
    # bar_interval must match what the strategy was backtested on (4h) - the
    # strategy only ever sees one "close" per real 4h bar, never per poll.
    # args.interval (the poll cadence) stays frequent for stop-loss checking
    # and price freshness, decoupled from the bar the SMA is computed over.
    bar_ms = BAR_MS[args.bar_interval]
    cycle_state = load_json(CYCLE_STATE_FILE, {})
    state = {}
    for coin in coins:
        now_ms = int(time.time() * 1000)
        adaptive_state_path = f"data/adaptive_state_{coin}.json"
        strategy_obj = _build_strategy(args.strategy, adaptive_state_path)
        # Some strategies need a longer warm-up than the 4h default: the daily
        # ones compute a 20-day channel and ATR, and the basis one needs enough
        # history for its trailing percentile window.
        # Each strategy declares how much history it needs; seeding too few bars
        # would leave it silently unable to signal rather than erroring.
        seed_bars_needed = getattr(strategy_obj, "min_bars", 90)
        if getattr(strategy_obj, "needs_spot", False):
            seed_bars_needed = max(seed_bars_needed, 260)
        lookback_ms = seed_bars_needed * bar_ms
        seed_candles = client.candles(coin, args.bar_interval, now_ms - lookback_ms, now_ms)
        seed_closes = [float(c["c"]) for c in seed_candles]
        # Full OHLCV bars too: the forced-flow strategies need high/low/volume,
        # not just closes. Kept as a parallel list so the existing closes-only
        # strategies are untouched.
        seed_bars = [_to_bar(c) for c in seed_candles]
        # Basis strategies need the matching SPOT series as well. Fetched only
        # when the selected strategy actually asks for it, so the default path
        # makes no extra network calls.
        seed_spot = []
        if getattr(strategy_obj, "needs_spot", False):
            pair = SPOT_PAIR.get(coin)
            if pair is None:
                raise SystemExit(
                    f"--strategy basis needs a spot pair for {coin}; known: {sorted(SPOT_PAIR)}")
            spot_lookback = 260 * bar_ms   # enough for the 180d percentile window
            seed_spot = [_to_bar(c) for c in
                         client.candles(pair, args.bar_interval,
                                        now_ms - spot_lookback, now_ms)]
            print(f"[{coin}] seeded {len(seed_spot)} spot bars from {pair}")
        seeded_last_bar_time = seed_candles[-1]["t"] if seed_candles else 0
        saved = cycle_state.get(coin, {})
        # Prefer the persisted last_bar_time over the freshly-seeded one so a
        # bar that closed between the previous invocation and this one is
        # still correctly detected as "new" below - only fall back to the
        # seed value the very first time this coin has ever been run.
        last_bar_time = saved.get("last_bar_time", seeded_last_bar_time)
        print(f"[{coin}] seeded {len(seed_closes)} historical {args.bar_interval} bars")
        state[coin] = {
            "strategy": strategy_obj,
            "adaptive_state_path": adaptive_state_path,
            "closes": seed_closes,
            "bars": seed_bars,
            "spot_bars": seed_spot,
            "position_bars_held": saved.get("position_bars_held", 0),
            "last_open_position": None,
            "cycles_since_report": saved.get("cycles_since_report", 0),
            "last_bar_time": last_bar_time,
        }

    _alloc = ", ".join("{} {:.0%}".format(k, v) for k, v in sorted(settings.allocation.items()))
    print(f"Allocation: {_alloc} | ${args.base_size_usd:.2f} per position "
          f"({args.base_size_usd / max(client.account_value(), 1e-9):.1%} of capital)")
    print(f"Starting in --mode {args.mode} on {settings.network}, watching {coins}{' (single cycle)' if args.once else '. Ctrl+C to stop.'}")

    if args.once:
        _run_cycle(coins, state, client, breaker, kelly, executor, settings, args)
        _save_cycle_state(coins, state)
        return

    try:
        while True:
            _run_cycle(coins, state, client, breaker, kelly, executor, settings, args)
            _save_cycle_state(coins, state)  # save every pass too, not just at exit - a crash shouldn't lose state
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("Stopped by user.")
        _save_cycle_state(coins, state)


def _to_bar(candle) -> dict:
    """Hyperliquid candle -> the OHLCV dict shape the strategies expect."""
    return {
        "t": candle["t"],
        "o": float(candle["o"]),
        "h": float(candle["h"]),
        "l": float(candle["l"]),
        "c": float(candle["c"]),
        "v": float(candle.get("v") or 0.0),
    }


def _build_strategy(name: str, adaptive_state_path: str):
    """Strategy selection. The default stays AdaptiveTrendStrategy so nothing
    about what is currently paper trading changes unless --strategy is passed
    explicitly - the live default has its own validation history and is not
    swapped out as a side effect of adding new strategies."""
    if name == "adaptive_trend":
        return AdaptiveTrendStrategy.load_or_new(adaptive_state_path)
    if name == "forced_flow":
        from core.strategies.forced_flow import ForcedFlowContinuation
        return ForcedFlowContinuation()
    if name == "range_break":
        from core.strategies.forced_flow import RangeBreakCascade
        return RangeBreakCascade()
    if name == "basis":
        from core.strategies.basis_dislocation import BasisDislocation
        return BasisDislocation()
    if name == "donchian":
        from core.strategies.donchian_breakout import DonchianBreakout
        return DonchianBreakout()
    raise SystemExit("Unknown --strategy {!r}".format(name))


def _save_cycle_state(coins, state) -> None:
    cycle_state = {
        coin: {
            "last_bar_time": state[coin]["last_bar_time"],
            "cycles_since_report": state[coin]["cycles_since_report"],
            "position_bars_held": state[coin]["position_bars_held"],
        }
        for coin in coins
    }
    save_json(CYCLE_STATE_FILE, cycle_state)
    for coin in coins:
        s = state[coin]
        if hasattr(s["strategy"], "save"):
            s["strategy"].save(s["adaptive_state_path"])


def _sleeve_exposure(client, state, sleeve: str) -> float:
    """Open notional currently held by one strategy family.

    Computed from the client's real open positions rather than a running
    counter, so it cannot drift out of sync with what is actually on the book -
    a stale exposure figure would silently let a sleeve exceed its allocation.
    """
    total = 0.0
    for coin, s in state.items():
        if getattr(s["strategy"], "sleeve", "daily") != sleeve:
            continue
        pos = client.get_position(coin)
        if pos:
            total += pos["size"] * pos["entry_price"]
    return total


def _net_exposure(client, coins) -> float:
    """Signed notional across the whole book: longs positive, shorts negative.

    Computed from the client's real positions rather than a running counter, so
    it cannot drift out of sync. This is what the correlation rail acts on -
    gross exposure cannot tell four aligned bets from four offsetting ones.
    """
    net = 0.0
    for coin in coins:
        pos = client.get_position(coin)
        if not pos:
            continue
        notional = pos["size"] * pos["entry_price"]
        net += notional if pos["is_long"] else -notional
    return net


def _record_close(trade, coin, kelly, breaker, capital, settings) -> None:
    """Everything that must happen when a position closes, in one place.

    Closes can now originate from two paths - an exchange-side/simulated
    stop-or-target, and a strategy's own signal-driven exit - and both must feed
    the trade log, the Kelly sizer and the circuit breaker. Duplicating this
    bookkeeping per path is how a loss ends up not counting against the daily
    breaker, so it lives here once.
    """
    log_closed_trade(trade)
    from core.kelly import TradeOutcome
    kelly.record_outcome(TradeOutcome(trade.won, trade.pnl_usd))
    breaker.record_realized_pnl(trade.pnl_usd, capital)
    from journal import journal_writer
    journal_writer.log_trade_closed(settings.vault_journal_path, coin, trade.exit_price,
                                    trade.pnl_usd, f"auto-logged ({trade.reason})")
    print(f"[{coin}] CLOSED {trade.direction} pnl=${trade.pnl_usd:+.2f} "
          f"({trade.pnl_pct:+.2%}) variant={trade.strategy_variant} reason={trade.reason}")


def _run_cycle(coins, state, client, breaker, kelly, executor, settings, args):
    """One pass over every coin: refresh bars, check for a simulated/real
    close, look for a new signal, act on it. Called once by --once, or in a
    loop by the default long-running mode - identical logic either way."""
    bar_ms = BAR_MS[args.bar_interval]
    capital = client.account_value()
    if not breaker.can_trade(capital):
        print(f"circuit breaker tripped account-wide: {breaker.trip_reason} - skipping all coins this cycle")
        return

    for coin in coins:
        s = state[coin]
        try:
            price = client.mid_price(coin)

            # Refresh bars only when a new one has actually closed - keeps
            # the strategy's input identical in shape to backtesting,
            # regardless of how often this loop polls for price/stop checks.
            now_ms = int(time.time() * 1000)
            latest = client.candles(coin, args.bar_interval, now_ms - 2 * bar_ms, now_ms)
            bar_updated = bool(latest) and latest[-1]["t"] != s["last_bar_time"]
            if bar_updated:
                s["last_bar_time"] = latest[-1]["t"]
                s["closes"].append(float(latest[-1]["c"]))
                s["closes"] = s["closes"][-500:]
                s["bars"].append(_to_bar(latest[-1]))
                s["bars"] = s["bars"][-500:]
                s["position_bars_held"] += 1
                if getattr(s["strategy"], "needs_spot", False):
                    pair = SPOT_PAIR.get(coin)
                    fresh = client.candles(pair, args.bar_interval,
                                           now_ms - 3 * bar_ms, now_ms)
                    for c_ in fresh:
                        b_ = _to_bar(c_)
                        if not s["spot_bars"] or b_["t"] > s["spot_bars"][-1]["t"]:
                            s["spot_bars"].append(b_)
                    s["spot_bars"] = s["spot_bars"][-500:]

            closed_trade = None
            if args.mode == "paper":
                exit_reason = client.check_paper_exit(coin, price)
                if exit_reason is not None:
                    pos = client.get_position(coin)
                    direction = "long" if pos["is_long"] else "short"
                    exit_price = pos["take_profit_price"] if exit_reason == "take_profit" else pos["stop_loss_price"]
                    closed_trade = make_trade(
                        coin=coin, direction=direction,
                        variant=getattr(s["strategy"], "active_variant_name", s["strategy"].name),
                        entry=pos["entry_price"], exit_price=exit_price,
                        size_usd=pos["size"] * pos["entry_price"], reason=exit_reason,
                    )
                    client.close_paper_position(coin)
            else:
                current_position = client.get_position(coin)
                if s["last_open_position"] is not None and current_position is None:
                    direction = "long" if s["last_open_position"]["is_long"] else "short"
                    closed_trade = make_trade(
                        coin=coin, direction=direction,
                        variant=getattr(s["strategy"], "active_variant_name", s["strategy"].name),
                        entry=s["last_open_position"]["entry_price"], exit_price=price,
                        size_usd=s["last_open_position"]["size"] * s["last_open_position"]["entry_price"],
                        reason="stop_or_target",
                    )
                s["last_open_position"] = current_position

            if closed_trade is not None:
                _record_close(closed_trade, coin, kelly, breaker, capital, settings)
                s["position_bars_held"] = 0

            # Only ask the strategy for a decision on a bar it hasn't seen
            # yet - otherwise a crossover detected on bar N would look
            # like a fresh signal on every poll until bar N+1 arrives,
            # and the executor would try to re-open the same trade
            # repeatedly.
            market_data = {"coin": coin, "closes": s["closes"], "bars": s["bars"],
                           "spot_bars": s["spot_bars"]}

            # Signal-driven exit. The stop-loss is enforced independently (paper
            # account here, a real exchange-side order in testnet/live), so this
            # only covers the strategy's OWN exits - a timeout or the signal
            # reverting. Without it a strategy validated with those exits would
            # behave differently live than it did in the backtest, which would
            # make its validation meaningless.
            open_pos = client.get_position(coin)
            if (open_pos is not None and closed_trade is None and bar_updated
                    and hasattr(s["strategy"], "should_exit")):
                why = s["strategy"].should_exit(
                    market_data, bool(open_pos["is_long"]), s["position_bars_held"])
                if why:
                    if args.mode == "paper":
                        direction = "long" if open_pos["is_long"] else "short"
                        closed_trade = make_trade(
                            coin=coin, direction=direction,
                            variant=getattr(s["strategy"], "active_variant_name",
                                            s["strategy"].name),
                            entry=open_pos["entry_price"], exit_price=price,
                            size_usd=open_pos["size"] * open_pos["entry_price"], reason=why,
                        )
                        client.close_paper_position(coin)
                        _record_close(closed_trade, coin, kelly, breaker, capital, settings)
                        closed_trade = None
                        s["position_bars_held"] = 0
                    else:
                        print(f"[{coin}] strategy wants exit ({why}) but live/testnet "
                              f"signal-exits are not wired to an order yet - leaving the "
                              f"exchange-side stop/target to manage this position")

            signal = s["strategy"].evaluate(market_data) if bar_updated else None
            if signal is not None:
                sleeve = getattr(s["strategy"], "sleeve", "daily")
                result = executor.try_execute(
                    signal, args.base_size_usd, sleeve=sleeve,
                    sleeve_exposure_usd=_sleeve_exposure(client, state, sleeve),
                    net_exposure_usd=_net_exposure(client, coins))
                s["position_bars_held"] = 0
                print(f"[{coin}] {result}")
                if args.mode != "paper":
                    s["last_open_position"] = client.get_position(coin)
                # paper mode: PaperTradingClient tracks the simulated position itself
            else:
                active = getattr(s["strategy"], "active_variant_name", s["strategy"].name)
                print(f"[{coin}] price={price} no signal (active variant: {active})")

            s["cycles_since_report"] += 1
            if s["cycles_since_report"] >= 50:
                s["cycles_since_report"] = 0
                trades = read_trades(coin=coin)
                bh = buy_hold_return(s["closes"]) if len(s["closes"]) > 1 else None
                stats = compute_stats(trades, buy_hold_return_pct=bh)
                report = format_report(stats, coin)
                print(report)
                vault_dir = (Path(__file__).parent / settings.vault_journal_path).parent
                (vault_dir / f"Performance-Report-{coin}.md").write_text(report)

        except Exception as e:
            print(f"[{coin}] error this cycle (continuing): {e}")


if __name__ == "__main__":
    main()
