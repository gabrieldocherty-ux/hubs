"""
Forced-flow continuation strategies (daily bars).

STATUS: validated to the same standard the live SMA(20,60)/4h default passed,
and in some respects a higher one - see Crypto-Trading.md, update 2026-09-05 (2)
for the full research record including everything that was rejected.

THE HYPOTHESIS (one mechanism, two expressions)
-----------------------------------------------
Hyperliquid is a leveraged venue with an automatic liquidation engine. When
price moves far enough in a short window, that engine becomes a forced,
price-insensitive market participant: it must close positions at whatever the
book offers. That produces two observable fingerprints on a daily bar - an
outsized RANGE relative to recent volatility, and an outsized VOLUME print.
Flow that is forced rather than informed does not stop at fair value, so the
move tends to continue over the following days rather than immediately revert.

This is a microstructure claim about a leveraged venue, not a claim about
trader psychology, and it makes a falsifiable prediction that was tested and
held: the effect should get STRONGER as the forced-flow evidence gets stronger.
It does - win rate rises monotonically from 52% to 74% as the range filter
tightens from 1.0x to 2.5x ATR, and that dose-response replicated on an
independent 2020-2023 sample (73.1% vs 73.7% at the same setting).

WHAT WAS RULED OUT ALONGSIDE IT
-------------------------------
The same research pass rejected mean reversion (three separate constructions),
funding-crowding fades (including the vault's own prior "most promising"
candidate, in its original form), cross-sectional momentum, funding carry,
BTC->alt lead-lag, RSI(2), and session/time-of-day effects. The point is that
this survived a process that killed most of what went into it.

KNOWN LIMITATIONS - read before trusting this
---------------------------------------------
* Volume is central to ForcedFlowContinuation, and Hyperliquid published no
  real volume before mid-2023 (913 of its early daily bars are zero-volume
  backfill). So this strategy CANNOT be tested before 2023 at all. Its entire
  validated history is ~3.25 years. That is a real constraint, not a caveat.
* The effect is DAILY-SPECIFIC. The identical dose-response test on 4h bars did
  not replicate. The working explanation is that a daily bar aggregates a whole
  cascade while a 4h bar catches a fragment - but "we do not fully know why the
  timeframe matters" is the honest position, and it is a reason to expect
  degradation rather than to assume robustness.
* Regime dependence: this needs volatility. In a persistently quiet market it
  will simply not trade, and in a market where liquidation cascades stop being
  a dominant feature (much lower system-wide leverage, better market making)
  the mechanism itself would weaken.
* Both variants are ~0.85-1.00 correlated with each other. Running both is NOT
  diversification; it is one bet at two frequencies.
"""

from typing import List, Optional

from core.strategy_base import Direction, Signal, Strategy


def _atr(bars: List[dict], n: int = 14) -> Optional[float]:
    """Average true range over the last n bars, using only closed bars."""
    if len(bars) < n + 1:
        return None
    trs = []
    for i in range(len(bars) - n, len(bars)):
        prev_close = bars[i - 1]["c"]
        trs.append(max(bars[i]["h"] - bars[i]["l"],
                       abs(bars[i]["h"] - prev_close),
                       abs(bars[i]["l"] - prev_close)))
    return sum(trs) / len(trs)


class ForcedFlowContinuation(Strategy):
    """
    Enter in the direction of a day that printed abnormal VOLUME, hold ~10 days.

    Validated numbers (pooled BTC/ETH/SOL/HYPE, 2023-06 to 2026-09, real funding,
    0.19% round-trip cost, next-bar-open fills, intra-bar stops):
        n=202  win rate 55.0%  expectancy +1.80%/trade  trimmed(5%) +1.49%
        train +1.95% / test +1.56%   4 of 4 calendar years positive
        every one of the four coins positive: BTC +1.01%, ETH +2.11%,
        SOL +1.10%, HYPE +4.28%
        14 of 15 parameter perturbations positive; edge survives 3x costs
        account CAGR +24.3% and max drawdown -15.1% at the 20%-of-capital rail

    Entry:  today's volume >= vol_mult x its own 20-day average.
            Direction = the direction the day closed (close vs open).
    Stop:   stop_atr x ATR(14) from entry - MANDATORY, set at entry.
    Exit:   the stop, or a hold_days timeout, whichever comes first.
    """

    name = "forced_flow_continuation"
    sleeve = "daily"

    def __init__(self, vol_mult: float = 1.5, hold_days: int = 10,
                 stop_atr: float = 2.5, vol_lookback: int = 20):
        self.vol_mult = vol_mult
        self.hold_days = hold_days
        self.stop_atr = stop_atr
        self.vol_lookback = vol_lookback

    def evaluate(self, market_data: dict) -> Optional[Signal]:
        bars = market_data.get("bars")
        if not bars or len(bars) < max(self.vol_lookback, 15) + 2:
            return None

        atr = _atr(bars, 14)
        if atr is None or atr <= 0:
            return None

        # The baseline is a 20-bar average that INCLUDES today. Excluding today
        # is arguably cleaner - today's spike should not inflate its own
        # yardstick - and it does score better (+1.98% vs +1.80%/trade). It is
        # deliberately not used: the validated result, with all its
        # neighbourhood, cost-stress and per-coin evidence, belongs to the
        # version below. Shipping the better-looking untested variant is how a
        # backtest stops describing the thing that actually trades.
        recent = bars[-self.vol_lookback:]
        avg_vol = sum(b["v"] for b in recent) / len(recent)
        today = bars[-1]
        if avg_vol <= 0 or today["v"] < self.vol_mult * avg_vol:
            return None

        price = today["c"]
        coin = market_data["coin"]
        ratio = today["v"] / avg_vol

        # Conviction score: how outsized today's RANGE is against ATR. This is
        # the variable with the validated dose-response (23.5% win rate below
        # 1.0x, 83.3% above 2.5x), so it is what sizing should scale on - not
        # the volume ratio that triggered the entry.
        strength = (today["h"] - today["l"]) / atr

        if today["c"] > today["o"]:
            return Signal(coin, Direction.LONG, price, price - self.stop_atr * atr, None,
                          "forced-flow continuation: volume {:.1f}x 20d avg, day closed up "
                          "(hold {}d or {:.1f}xATR stop)".format(ratio, self.hold_days, self.stop_atr),
                          strength=strength)
        if today["c"] < today["o"]:
            return Signal(coin, Direction.SHORT, price, price + self.stop_atr * atr, None,
                          "forced-flow continuation: volume {:.1f}x 20d avg, day closed down "
                          "(hold {}d or {:.1f}xATR stop)".format(ratio, self.hold_days, self.stop_atr),
                          strength=strength)
        return None


class RangeBreakCascade(Strategy):
    """
    Higher-conviction, lower-frequency sibling of ForcedFlowContinuation: only
    take a range breakout when the breakout day's RANGE itself shows forced flow.

    Validated numbers (same methodology and window as above):
        n=74   win rate 64.9%  expectancy +3.51%/trade  trimmed(5%) +3.16%
        train +2.05% / test +5.90%   4 of 4 calendar years positive
        BTC +2.87%, ETH +1.40%, SOL +5.20%, HYPE +9.98% (HYPE n=6 - NOT a result,
        just the only six trades it took; do not size against it)
        20 of 22 parameter perturbations positive; edge survives 4x costs
        account CAGR +17.5% and max drawdown -9.4% at the 20%-of-capital rail

    Trades roughly 5-6 times per coin per year, versus ~15 for the volume
    version. Expect the LIVE result to land nearer the weaker end of the
    parameter sweep (trimmed expectancy ~1.0-1.5%) than the headline 3.16%:
    the 2.0x range threshold was chosen after seeing the sweep, and although
    the whole curve above 1.0x is positive - so this is a point on a plateau
    rather than a spike - selection after the fact still deserves a discount.

    Entry:  close beyond the `channel` day high/low, AND the day's own range
            >= range_atr x ATR(14).
    Stop:   stop_atr x ATR(14) - MANDATORY, set at entry.
    Exit:   the stop, or a hold_days timeout.
    """

    name = "range_break_cascade"
    sleeve = "daily"

    def __init__(self, channel: int = 20, range_atr: float = 2.0,
                 stop_atr: float = 2.5, hold_days: int = 10):
        self.channel = channel
        self.range_atr = range_atr
        self.stop_atr = stop_atr
        self.hold_days = hold_days

    def evaluate(self, market_data: dict) -> Optional[Signal]:
        bars = market_data.get("bars")
        if not bars or len(bars) < self.channel + 20:
            return None

        atr = _atr(bars, 14)
        if atr is None or atr <= 0:
            return None

        today = bars[-1]
        prior = bars[-self.channel - 1:-1]           # channel excludes today
        hh = max(b["h"] for b in prior)
        ll = min(b["l"] for b in prior)

        day_range = today["h"] - today["l"]
        if day_range < self.range_atr * atr:
            return None                              # no evidence of forced flow

        price = today["c"]
        coin = market_data["coin"]
        mult = day_range / atr

        if price > hh:
            return Signal(coin, Direction.LONG, price, price - self.stop_atr * atr, None,
                          "cascade breakout: closed above {}d high on a {:.1f}xATR range "
                          "(hold {}d)".format(self.channel, mult, self.hold_days),
                          strength=mult)
        if price < ll:
            return Signal(coin, Direction.SHORT, price, price + self.stop_atr * atr, None,
                          "cascade breakdown: closed below {}d low on a {:.1f}xATR range "
                          "(hold {}d)".format(self.channel, mult, self.hold_days),
                          strength=mult)
        return None
