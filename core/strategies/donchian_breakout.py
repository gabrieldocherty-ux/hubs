"""
Donchian channel breakout (daily bars, 1-2 month holds) - the macro sleeve.

WHY THIS EXISTS: the cost-efficiency review on 2026-09-05 cut the live
SMA(20,60)/4h strategy from the macro sleeve, which left that sleeve empty.
This is the replacement, and the comparison that drove it:

                        SMA(20,60) 4h        Donchian(55/20) 1d
  net expectancy           +0.55%/trade         +12.85%/trade
  TRIMMED (5%)             -0.78%   <-- no       +1.82%
                                        edge outside the tail
  trades / year             163                   16
  annual cost drag         30.9%                 3.1%
  correlation w/ daily     +0.44 to +0.45        -0.04 to -0.06
  win rate                  29.7%                 49.0%
  median trade             -3.14%                -1.31%
  account max DD           -26.9%                -12.5%

The SMA was paying 30.9% of notional a year in execution costs for an edge that
does not exist outside its tail, AND correlating +0.44 with the daily sleeve -
so it was not even diversifying while it did so. Donchian gets a comparable
recent-year result (2024 +2.83%, 2025 +2.26%, 2026 +2.25%) at a tenth of the
trading cost, with genuinely uncorrelated monthly returns.

HYPOTHESIS (mechanism): a break of a multi-month range is where resting stop and
liquidation orders concentrate, and on a leveraged venue the liquidation engine
converts that into further forced flow in the same direction. Separately, a
range that has held for 55 days is a price level slower participants have
anchored on, so breaking it forces a repricing that plays out over weeks rather
than instantly. This is the Turtle system's original specification, taken at its
published parameters rather than fitted here.

HONEST STATUS: CONDITIONAL, not fully validated - and this matters.
* Its edge DECAYED sharply: train +49.4%/trade vs test +2.24%/trade. The huge
  full-sample expectancy (+12.85%) is carried by 2020-2023; recent years are a
  much more modest +2.2% to +2.8%.
* n=49 pooled across four coins over 3.25 years. That is a thin sample, and the
  1-2 month holding horizon means it cannot be thickened without more calendar
  time.
* Trend following generally decayed in this market after 2023 (see the vault) -
  this strategy is not exempt from that finding, it is the least-bad expression
  of it.
* It is kept because it is cheap to run, genuinely uncorrelated with the daily
  sleeve, and still positive in every recent year - NOT because it is expected
  to produce the headline number.
"""

from typing import List, Optional

from core.strategy_base import Direction, Signal, Strategy


def _atr(bars: List[dict], n: int = 20) -> Optional[float]:
    if len(bars) < n + 1:
        return None
    trs = []
    for i in range(len(bars) - n, len(bars)):
        pc = bars[i - 1]["c"]
        trs.append(max(bars[i]["h"] - bars[i]["l"],
                       abs(bars[i]["h"] - pc), abs(bars[i]["l"] - pc)))
    return sum(trs) / len(trs)


class DonchianBreakout(Strategy):
    """
    Entry:  close above the `entry_n`-day high (long) or below the `entry_n`-day
            low (short). The channel is computed from bars BEFORE today, so
            today's own high cannot define the level it is breaking.
    Stop:   `stop_atr` x ATR(20) - MANDATORY, set at entry.
    Exit:   the stop, or price closing back through the opposite `exit_n`-day
            channel (a trailing exit). Signalled via should_exit() so live
            behaviour matches the backtest, which used the same trailing rule.

    Validated numbers (pooled BTC/ETH/SOL/HYPE, 2023-06 to 2026-09, real
    funding, 0.19% round-trip cost, next-bar-open fills, intra-bar stops):
        n=49  win rate 49.0%  expectancy +12.85%/trade  trimmed(5%) +1.82%
        4 of 4 calendar years positive; average hold 44 days
        account CAGR +36.0%, max drawdown -12.5% at the 20%-of-capital rail
        annual execution cost drag 3.1% of notional - the cheapest to run of
        anything in the library
    Read those alongside the CONDITIONAL caveats in the module docstring: the
    headline expectancy is inflated by 2023 and should not be planned against.
    """

    name = "donchian_breakout"
    sleeve = "macro"
    min_bars = 130      # 55d channel + 20d ATR + headroom

    def __init__(self, entry_n: int = 55, exit_n: int = 20, stop_atr: float = 3.0):
        self.entry_n = entry_n
        self.exit_n = exit_n
        self.stop_atr = stop_atr

    def evaluate(self, market_data: dict) -> Optional[Signal]:
        bars = market_data.get("bars")
        if not bars or len(bars) < self.entry_n + 25:
            return None

        atr = _atr(bars, 20)
        if atr is None or atr <= 0:
            return None

        prior = bars[-self.entry_n - 1:-1]          # excludes today
        hh = max(b["h"] for b in prior)
        ll = min(b["l"] for b in prior)

        price = bars[-1]["c"]
        coin = market_data["coin"]

        if price > hh:
            return Signal(coin, Direction.LONG, price, price - self.stop_atr * atr, None,
                          "broke {}d high ({:.4g}); trail out on the {}d low, "
                          "{:.1f}xATR stop".format(self.entry_n, hh, self.exit_n, self.stop_atr))
        if price < ll:
            return Signal(coin, Direction.SHORT, price, price + self.stop_atr * atr, None,
                          "broke {}d low ({:.4g}); trail out on the {}d high, "
                          "{:.1f}xATR stop".format(self.entry_n, ll, self.exit_n, self.stop_atr))
        return None

    def should_exit(self, market_data: dict, is_long: bool, bars_held: int) -> Optional[str]:
        """Trailing channel exit. This is the strategy's real exit - the ATR stop
        is the disaster backstop underneath it, not the normal way out."""
        bars = market_data.get("bars")
        if not bars or len(bars) < self.exit_n + 2:
            return None
        prior = bars[-self.exit_n - 1:-1]
        price = bars[-1]["c"]
        if is_long and price < min(b["l"] for b in prior):
            return "donchian_trail_exit"
        if not is_long and price > max(b["h"] for b in prior):
            return "donchian_trail_exit"
        return None
