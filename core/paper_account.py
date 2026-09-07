"""
Drop-in stand-in for HyperliquidClient when --mode paper. Needs ONLY
Hyperliquid's public Info API - no wallet, no signing, no real account at
all - because paper trading never signs or sends anything. Capital and
positions are simulated: capital starts at settings.paper_starting_capital
and moves only via realized PnL recorded in the trade log; open positions are
tracked here (including their stop/target so main.py's loop can check for a
simulated close each cycle, the same way it would poll a real exchange
position).

Open positions are persisted to `state_file` (JSON) on every open/close,
not just held in memory - main.py can run as a one-shot `--once` invocation
on a timer rather than a permanently-running process, so anything that must
survive between invocations has to be written to disk.
"""

from typing import Optional

from hyperliquid.info import Info
from hyperliquid.utils import constants

from core.state_store import load_json, save_json
from core.trade_log import read_trades


class PaperTradingClient:
    def __init__(self, starting_capital: float, network: str = "mainnet",
                 state_file: str = "data/paper_positions.json", market_data: str = "mainnet"):
        # Paper mode ALWAYS reads market data from mainnet by default, whatever
        # `network` says. This is deliberate and it matters: testnet is a
        # separate, thinly-traded market whose prices are not the real ones.
        # Measured 2026-09-05 - testnet HYPE was $22.87 against mainnet's
        # $83.93, a 3.7x difference, and even BTC differed by ~0.7%. A paper
        # track record built on testnet prices would be a record of a market
        # that does not exist, and against strategies whose edge is 1-3% per
        # trade a 0.7% price error is not a rounding detail.
        #
        # There is no risk in reading mainnet here: paper mode never signs or
        # sends anything, so this is public market data only. `network` still
        # governs the real client used for testnet/live order placement.
        base_url = (constants.MAINNET_API_URL if market_data == "mainnet"
                    else constants.TESTNET_API_URL)
        self.info = Info(base_url, skip_ws=True)
        self.market_data_source = market_data
        self.starting_capital = starting_capital
        self.state_file = state_file
        self._open: dict = load_json(state_file, {})  # coin -> {size, is_long, entry_price, stop_loss_price, take_profit_price}

    def _persist(self) -> None:
        save_json(self.state_file, self._open)

    def asset_max_leverage(self, coin: str):
        """The VENUE's leverage cap for this coin, cached after the first call.

        The risk manager needs it because Hyperliquid's maintenance margin is
        half the initial margin AT MAX LEVERAGE - so the maintenance rate is a
        property of the asset (1.25% for BTC at 40x, 5% for HYPE at 10x), and
        the liquidation price cannot be computed without it.
        """
        if not hasattr(self, "_lev_cache"):
            try:
                meta = self.info.meta()
                self._lev_cache = {u["name"]: u.get("maxLeverage")
                                   for u in meta.get("universe", [])}
            except Exception:
                self._lev_cache = {}
        return self._lev_cache.get(coin)

    def mid_price(self, coin: str) -> float:
        return float(self.info.all_mids()[coin])

    def candles(self, coin: str, interval: str, start_ms: int, end_ms: int):
        return self.info.candles_snapshot(coin, interval, start_ms, end_ms)

    def account_value(self) -> float:
        realized = sum(t.pnl_usd for t in read_trades())
        return self.starting_capital + realized

    def total_position_notional(self) -> float:
        return sum(p["size"] * p["entry_price"] for p in self._open.values())

    def get_position(self, coin: str) -> Optional[dict]:
        return self._open.get(coin)

    def open_paper_position(self, coin, is_long, size, entry_price, stop_loss_price,
                            take_profit_price, sleeve="daily"):
        # `sleeve` is recorded on the position so exposure can be attributed to a
        # strategy family after the fact - the dashboard and the risk manager both
        # need to know which allocation a live position is consuming, and inferring
        # it later from whichever strategy happens to be running is guesswork.
        self._open[coin] = {
            "size": size, "is_long": is_long, "entry_price": entry_price,
            "stop_loss_price": stop_loss_price, "take_profit_price": take_profit_price,
            "sleeve": sleeve,
        }
        self._persist()

    def check_paper_exit(self, coin: str, current_price: float) -> Optional[str]:
        """Returns 'stop_loss' / 'take_profit' if the simulated position should
        close at current_price, else None. Caller is responsible for actually
        closing it (removing from self._open) once logged."""
        pos = self._open.get(coin)
        if pos is None:
            return None
        if pos["is_long"]:
            if current_price <= pos["stop_loss_price"]:
                return "stop_loss"
            if pos["take_profit_price"] and current_price >= pos["take_profit_price"]:
                return "take_profit"
        else:
            if current_price >= pos["stop_loss_price"]:
                return "stop_loss"
            if pos["take_profit_price"] and current_price <= pos["take_profit_price"]:
                return "take_profit"
        return None

    def close_paper_position(self, coin: str):
        self._open.pop(coin, None)
        self._persist()
