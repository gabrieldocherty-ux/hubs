"""
Strategy interface. A strategy only decides direction/stop/target - it never
sees or touches sizing, leverage, or order placement, all of which go through
RiskManager and HyperliquidClient. This separation is what makes it possible
to swap/add strategies without ever risking the safety-critical path.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Protocol


class Direction(Enum):
    LONG = "long"
    SHORT = "short"


@dataclass
class Signal:
    coin: str
    direction: Direction
    entry_price: float
    stop_loss_price: float
    take_profit_price: Optional[float]
    confidence: str  # free-text rationale, goes straight into the trade journal


class Strategy(Protocol):
    name: str

    def evaluate(self, market_data: dict) -> Optional[Signal]:
        """
        market_data: whatever the strategy needs (recent candles, funding
        rate, orderbook, etc.) - shape is strategy-specific, assembled by
        main.py's data loop, not by this interface.
        Return None if there's no trade right now - "no signal" must always
        be a valid, common outcome. A strategy that always finds a trade is
        almost certainly overfit or ignoring cost.
        """
        ...
