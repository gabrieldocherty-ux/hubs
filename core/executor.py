"""
Ties signal -> risk approval -> exchange order -> journal entry together.
This is the only place that's allowed to call HyperliquidClient's order
methods - main.py's loop calls this, never the client directly.
"""

from typing import Optional

from api.hyperliquid_client import HyperliquidClient
from core.risk_manager import RiskManager, RiskRejection, TradeRequest
from core.strategy_base import Signal
from journal import journal_writer


class Executor:
    def __init__(self, client: HyperliquidClient, risk_manager: RiskManager, vault_journal_path: str, dry_run: bool = True):
        self.client = client
        self.risk_manager = risk_manager
        self.vault_journal_path = vault_journal_path
        self.dry_run = dry_run  # True for --mode paper: everything runs except the real order call

    def try_execute(self, signal: Signal, base_size_usd: float,
                    sleeve: str = "daily", sleeve_exposure_usd: float = 0.0,
                    net_exposure_usd: float = 0.0) -> Optional[str]:
        """`sleeve` is the strategy family this signal belongs to ("daily" or
        "macro"), and `sleeve_exposure_usd` is the notional that family already
        has open. Both are needed for the risk manager to enforce the
        75/25 allocation - it cannot infer them from the signal alone."""
        account_capital = self.client.account_value()
        current_exposure = self.client.total_position_notional()

        request = TradeRequest(
            coin=signal.coin,
            is_buy=(signal.direction.value == "long"),
            entry_price=signal.entry_price,
            stop_loss_price=signal.stop_loss_price,
            take_profit_price=signal.take_profit_price,
            base_size_usd=base_size_usd,
            sleeve=sleeve,
            asset_max_leverage=(self.client.asset_max_leverage(signal.coin)
                                if hasattr(self.client, "asset_max_leverage") else None),
            strength=getattr(signal, "strength", None),
        )

        try:
            approved = self.risk_manager.approve_trade(
                request, account_capital, current_exposure,
                sleeve_exposure_usd=sleeve_exposure_usd,
                net_exposure_usd=net_exposure_usd)
        except RiskRejection as e:
            return f"REJECTED: {e}"

        if self.dry_run:
            journal_writer.log_trade_opened(self.vault_journal_path, approved, signal)
            if hasattr(self.client, "open_paper_position"):
                self.client.open_paper_position(
                    approved.coin, approved.is_buy, approved.size_usd / approved.entry_price,
                    approved.entry_price, approved.stop_loss_price, approved.take_profit_price,
                    sleeve=sleeve,
                )
            return f"PAPER TRADE (simulated, not sent to exchange): {approved}"

        self.client.set_leverage(approved.coin, approved.leverage)
        result = self.client.place_entry_with_stop_and_target(
            coin=approved.coin,
            is_buy=approved.is_buy,
            size=approved.size_usd / approved.entry_price,
            entry_price=approved.entry_price,
            stop_loss_price=approved.stop_loss_price,
            take_profit_price=approved.take_profit_price,
        )
        journal_writer.log_trade_opened(self.vault_journal_path, approved, signal)
        return f"LIVE ORDER SENT: {result}"
