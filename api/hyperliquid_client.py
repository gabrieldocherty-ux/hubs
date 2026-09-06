"""
Thin wrapper around the official hyperliquid-python-sdk. Defaults to testnet;
mainnet requires an explicit network="mainnet" in config/settings.json, which
is never the example default.
"""

from typing import Optional

from hyperliquid.exchange import Exchange
from hyperliquid.info import Info
from hyperliquid.utils import constants

from config.settings import Settings
from wallet.agent_wallet import AgentWallet


class HyperliquidClient:
    def __init__(self, settings: Settings, wallet: AgentWallet):
        self.settings = settings
        base_url = constants.MAINNET_API_URL if settings.is_mainnet else constants.TESTNET_API_URL
        self.info = Info(base_url, skip_ws=True)
        self.exchange = Exchange(
            wallet.local_account(),
            base_url,
            account_address=settings.master_account_address,
        )

    def account_value(self) -> float:
        state = self.info.user_state(self.settings.master_account_address)
        return float(state["marginSummary"]["accountValue"])

    def get_position(self, coin: str):
        """Returns {"size": float, "is_long": bool, "entry_price": float} or None if flat."""
        state = self.info.user_state(self.settings.master_account_address)
        for p in state.get("assetPositions", []):
            pos = p["position"]
            if pos["coin"] == coin:
                sz = float(pos["szi"])
                if sz != 0:
                    return {"size": abs(sz), "is_long": sz > 0, "entry_price": float(pos["entryPx"])}
        return None

    def total_position_notional(self) -> float:
        state = self.info.user_state(self.settings.master_account_address)
        return sum(
            abs(float(p["position"]["positionValue"]))
            for p in state.get("assetPositions", [])
        )

    def mid_price(self, coin: str) -> float:
        mids = self.info.all_mids()
        return float(mids[coin])

    def candles(self, coin: str, interval: str, start_ms: int, end_ms: int):
        """interval e.g. '1h', '15m', '1d'. Used by the backtester."""
        return self.info.candles_snapshot(coin, interval, start_ms, end_ms)

    def set_leverage(self, coin: str, leverage: int, is_cross: bool = True):
        return self.exchange.update_leverage(leverage, coin, is_cross)

    def place_entry_with_stop_and_target(
        self,
        coin: str,
        is_buy: bool,
        size: float,
        entry_price: float,
        stop_loss_price: float,
        take_profit_price: Optional[float],
    ) -> dict:
        """
        Places the entry order together with its stop-loss (and optional
        take-profit) as one grouped action ("normalTpsl"), so a position is
        never live on the exchange without protective orders already resting.
        This mirrors examples/basic_tpsl.py from the official SDK.
        """
        orders = [
            {
                "coin": coin,
                "is_buy": is_buy,
                "sz": size,
                "limit_px": entry_price,
                "order_type": {"limit": {"tif": "Gtc"}},
                "reduce_only": False,
            },
            {
                "coin": coin,
                "is_buy": not is_buy,
                "sz": size,
                "limit_px": stop_loss_price,
                "order_type": {
                    "trigger": {"isMarket": True, "triggerPx": stop_loss_price, "tpsl": "sl"}
                },
                "reduce_only": True,
            },
        ]
        if take_profit_price is not None:
            orders.append(
                {
                    "coin": coin,
                    "is_buy": not is_buy,
                    "sz": size,
                    "limit_px": take_profit_price,
                    "order_type": {
                        "trigger": {"isMarket": True, "triggerPx": take_profit_price, "tpsl": "tp"}
                    },
                    "reduce_only": True,
                }
            )
        return self.exchange.bulk_orders(orders, grouping="normalTpsl")

    def cancel_all(self, coin: str):
        open_orders = self.info.open_orders(self.settings.master_account_address)
        for o in open_orders:
            if o["coin"] == coin:
                self.exchange.cancel(coin, o["oid"])

    def flatten_position(self, coin: str):
        """
        Emergency: close any open position on this coin immediately via the
        SDK's market_close helper (an IOC limit order at a slippage-adjusted
        price - Hyperliquid has no separate "market order" type). Used by the
        circuit breaker and any manual kill-switch, independent of whatever
        the strategy loop is doing.
        """
        return self.exchange.market_close(coin)
