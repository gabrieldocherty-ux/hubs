"""
Perp-spot basis dislocation (daily bars).

STATUS: validated 2026-09-05 to the same standard as the forced-flow pair, with
one important difference in its favour and one against. In its favour: it is
the only strategy found so far that is genuinely INDEPENDENT of the others
(same-side overlap with ForcedFlowContinuation is 0.35-0.59, at or below the
~0.50 two unrelated strategies would show, versus 0.73-1.00 among the trend
variants). Against: it has the shortest history of anything shipped here.

THE HYPOTHESIS
--------------
Hyperliquid runs a perp book and a spot book for the same asset. The perp is
where leverage lives; spot is where unlevered ownership lives. When the perp
trades rich to spot, leveraged buyers are bidding for exposure faster than
anyone will buy the underlying, and the premium is the price of that impatience
- paid by people using borrowed money, who are structurally the weakest holders
in the market. Positioning extremes of that kind unwind.

WHY THIS IS NOT THE REJECTED FUNDING STRATEGY
---------------------------------------------
Funding is the mechanism that PULLS the perp back toward the index: a clamped
formula computed against an external oracle. Basis is the RAW dislocation
funding is reacting to. Measured correlation between them on daily closes is
-0.06 (BTC), -0.01 (ETH), +0.14 (SOL), +0.46 (HYPE), with same-sign agreement
near 50%. They are close to orthogonal. The funding-crowding fade (D3) was
tested and failed; this is a different signal, not that one relabelled.

VALIDATED NUMBERS (pooled BTC/ETH/SOL/HYPE, real funding, 0.19% round trip,
next-bar-open fills, intra-bar stops)
-------------------------------------------------------------------------
    n=178   win rate 54.5%   expectancy +1.68%/trade   trimmed(5%) +1.39%
    median trade +0.86%      train +1.34% / test +2.09%   (no decay)
    ALL 15 of 15 parameter perturbations positive, and every one of them
      positive on BOTH train and test - a complete plateau, not a spike
    survives 4x modelled costs (+1.68% -> +1.11%)
    account CAGR +43.3%, max drawdown -15.6% at the 20%-of-capital rail
    per coin: BTC +1.73%, ETH +1.12%, HYPE +3.21%, SOL +0.22% (SOL's trimmed
      mean is -0.09% - it does NOT work on SOL, see limitations)

A dose-response supports the mechanism rather than a fitted threshold: raising
the percentile cut from 0.80 to 0.95 raises the trimmed expectancy monotonically
(0.74% -> 1.08% -> 1.39% -> 2.04%). The more extreme the dislocation, the bigger
the edge, which is what the hypothesis predicts and what a curve fit generally
does not produce.

KNOWN LIMITATIONS - these are the reasons to size this conservatively
---------------------------------------------------------------------
* SHORTEST HISTORY OF ANYTHING HERE. HL spot data begins 2025-02 (BTC),
  2025-03 (ETH), 2025-05 (SOL), 2024-11 (HYPE) - roughly 1.3-1.8 years, versus
  3.25 for the forced-flow work. n=178 pooled.
* ONE MARKET PERIOD. All four coins share that same short window and crypto
  majors are highly correlated, so "4 of 4 coins agree" is much weaker evidence
  here than the same phrase would be over a decade. A single regime could
  produce it.
* THE MOST RECENT HALF-YEAR IS NEGATIVE (2026H2: -2.50% over 25 trades, a
  partial period). 3 of 4 half-years are positive. This is not yet enough data
  to say whether that is noise or the start of decay - it is the single most
  important thing to watch in live paper results.
* DOES NOT WORK ON SOL (trimmed -0.09%). Run it on BTC/ETH/HYPE, or accept that
  SOL contributes nothing.
* SPOT DATA HAS BAD PRINTS. Raw BTC basis has a standard deviation of 13.5%
  around a median of -0.014%, from thin-book wicks on a young spot pair. Any
  reading beyond +/-2% is treated as a data error and ignored rather than
  traded - if that filter is ever removed, the strategy will trade noise.
* COUNTER-TREND BY CONSTRUCTION. It buys what is falling and sells what is
  rising. That profile is right most of the time and occasionally very wrong,
  which is exactly how an account that is "usually profitable" blows up. The
  ATR stop is not a formality here; it is the whole defence.

KNOWN DIVERGENCE FROM THE RESEARCH CODE (4 trades out of 178)
-------------------------------------------------------------
The research implementation bails out of its whole signal function when today's
spot print is unusable, which means an open position could sail past its
max_hold timeout purely because spot data was missing. `should_exit()` below
checks the timeout FIRST, so the position closes on schedule regardless of spot
availability. That is a deliberate robustness fix, not an accident: a risk
control that silently stops applying when a data feed hiccups is not a risk
control. It produces 174 trades instead of 178 and +1.72% instead of +1.68%.
The figures quoted above are the RESEARCH ones - the slightly worse of the two -
so nothing here is claimed on the basis of the change. `research/parity_test.py`
asserts the two stay within tolerance of each other.
"""

from typing import List, Optional

from core.strategy_base import Direction, Signal, Strategy

SANITY_BOUND = 0.02      # |basis| beyond this on a daily close is a bad print


def _atr(bars: List[dict], n: int = 14) -> Optional[float]:
    if len(bars) < n + 1:
        return None
    trs = []
    for i in range(len(bars) - n, len(bars)):
        pc = bars[i - 1]["c"]
        trs.append(max(bars[i]["h"] - bars[i]["l"],
                       abs(bars[i]["h"] - pc), abs(bars[i]["l"] - pc)))
    return sum(trs) / len(trs)


def compute_basis(perp_bars: List[dict], spot_bars: List[dict]) -> List[Optional[float]]:
    """Timestamp-aligned (perp - spot)/spot. Bad prints become None, never a
    smoothed-over number - a silently interpolated basis is a fabricated trade."""
    smap = {b["t"]: b["c"] for b in spot_bars if b.get("c", 0) > 0 and b.get("v", 0) > 0}
    out = []
    for b in perp_bars:
        s = smap.get(b["t"])
        if not s:
            out.append(None)
            continue
        v = (b["c"] - s) / s
        out.append(None if abs(v) > SANITY_BOUND else v)
    return out


class BasisDislocation(Strategy):
    """
    Entry:  short when today's basis sits at/above the `pct` percentile of its
            own trailing `window` days; long at/below (1 - `pct`). Needs at
            least `min_history` valid observations first, so it never fires off
            a thin window.
    Stop:   `stop_atr` x ATR(14) - MANDATORY, set at entry.
    Exit:   basis reverting past its trailing median, `max_hold` day timeout, or
            the stop. Held by main.py's loop; the strategy signals the exit.

    Needs `spot_bars` in market_data as well as `bars` - main.py fetches those
    when `needs_spot` is set.
    """

    name = "basis_dislocation"
    sleeve = "daily"
    needs_spot = True

    def __init__(self, pct: float = 0.90, window: int = 180, stop_atr: float = 2.5,
                 max_hold: int = 7, min_history: int = 60, both_sides: bool = True):
        self.pct = pct
        self.window = window
        self.stop_atr = stop_atr
        self.max_hold = max_hold
        self.min_history = min_history
        self.both_sides = both_sides

    def evaluate(self, market_data: dict) -> Optional[Signal]:
        bars = market_data.get("bars")
        spot = market_data.get("spot_bars")
        if not bars or not spot or len(bars) < 20:
            return None

        atr = _atr(bars, 14)
        if atr is None or atr <= 0:
            return None

        basis = compute_basis(bars, spot)
        today = basis[-1]
        if today is None:
            return None                     # no usable spot print for today

        hist = [x for x in basis[-self.window:] if x is not None]
        if len(hist) < self.min_history:
            return None

        hs = sorted(hist)
        hi = hs[min(len(hs) - 1, int(len(hs) * self.pct))]
        lo = hs[max(0, int(len(hs) * (1 - self.pct)))]

        # A degenerate distribution has no outliers. If the trailing window has
        # collapsed to (near) a single value, then today's reading equals the
        # 90th percentile trivially and the percentile test fires on a basis of
        # zero - a short on no dislocation whatsoever. That is not hypothetical:
        # it is what a stale or echoing spot feed looks like, and it would have
        # this strategy trading a broken data source at full size. Caught by
        # tests/test_basis_dislocation.py::test_flat_basis_produces_no_signal.
        if hi <= lo:
            return None

        price = bars[-1]["c"]
        coin = market_data["coin"]

        if today >= hi:
            return Signal(coin, Direction.SHORT, price, price + self.stop_atr * atr, None,
                          "perp rich to spot by {:+.3f}% (>= {:.0f}th pct of trailing {}d); "
                          "exit on reversion to median, {}d timeout or {:.1f}xATR stop".format(
                              today * 100, self.pct * 100, self.window,
                              self.max_hold, self.stop_atr))
        if self.both_sides and today <= lo:
            return Signal(coin, Direction.LONG, price, price - self.stop_atr * atr, None,
                          "perp cheap to spot by {:+.3f}% (<= {:.0f}th pct of trailing {}d); "
                          "exit on reversion to median, {}d timeout or {:.1f}xATR stop".format(
                              today * 100, (1 - self.pct) * 100, self.window,
                              self.max_hold, self.stop_atr))
        return None

    def should_exit(self, market_data: dict, is_long: bool, bars_held: int) -> Optional[str]:
        """Consulted by main.py for an open position. The stop itself is enforced
        exchange-side (or by the paper account); this covers the two signal-driven
        exits the backtest modelled, so live behaviour matches what was validated."""
        if bars_held >= self.max_hold:
            return "timeout"
        bars, spot = market_data.get("bars"), market_data.get("spot_bars")
        if not bars or not spot:
            return None
        basis = compute_basis(bars, spot)
        today = basis[-1]
        hist = [x for x in basis[-self.window:] if x is not None]
        if today is None or len(hist) < self.min_history:
            return None
        med = sorted(hist)[len(hist) // 2]
        if (not is_long and today <= med) or (is_long and today >= med):
            return "basis_normalised"
        return None
