"""Loads config/settings.json (copy from settings.example.json and edit)."""

import json
from dataclasses import dataclass
from pathlib import Path

CONFIG_PATH = Path(__file__).parent / "settings.json"


@dataclass
class RiskConfig:
    max_leverage: int
    max_position_pct_of_capital: float
    kelly_fraction: float
    kelly_min_edge: float
    kelly_max_size_multiplier: float
    daily_loss_breaker_pct: float
    require_stop_loss: bool
    max_net_exposure_pct: float = 0.50


@dataclass
class Settings:
    network: str
    master_account_address: str
    wallet_file: str
    risk: RiskConfig
    vault_journal_path: str
    paper_starting_capital: float
    base_size_usd: float = 16.25
    allocation: dict = None          # sleeve -> share of total capital

    def __post_init__(self):
        if self.allocation is None:
            self.allocation = {"daily": 0.75, "macro": 0.25}

    @property
    def is_mainnet(self) -> bool:
        return self.network == "mainnet"

    def sleeve_cap_usd(self, sleeve: str, capital: float) -> float:
        """Max open notional the given family may hold, in dollars."""
        return capital * float(self.allocation.get(sleeve, 0.0) or 0.0)


def get_settings() -> Settings:
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"{CONFIG_PATH} not found. Copy settings.example.json to settings.json and edit it first."
        )
    with open(CONFIG_PATH) as f:
        data = json.load(f)
    return Settings(
        network=data["network"],
        master_account_address=data["master_account_address"],
        wallet_file=data["wallet_file"],
        risk=RiskConfig(**{k: v for k, v in data["risk"].items()
                          if not k.startswith("_")}),
        vault_journal_path=data.get("notify", {}).get("vault_path", ""),
        paper_starting_capital=data.get("paper_starting_capital", 250.0),
        base_size_usd=float(data.get("base_size_usd", 16.25)),
        allocation={k: v for k, v in (data.get("allocation") or {}).items()
                    if not k.startswith("_")} or None,
    )
