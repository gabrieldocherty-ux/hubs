"""
Honest backtest engine for strategy research.

Design decisions that matter (each one costs the strategy money versus a naive
backtest, which is exactly the point):

 * NO LOOKAHEAD. A signal is computed from bars[0..i] (bar i already closed)
   and filled at bar i+1's OPEN. Never at the close of the bar that produced
   the signal - that is the single most common way a backtest lies.
 * INTRA-BAR STOPS. Stops/targets are checked against each bar's low/high,
   not its close. If a bar touches both the stop and the target, we assume
   the STOP filled first. Pessimistic by construction, because we cannot know
   the intra-bar path.
 * GAP-THROUGH STOPS. If a bar OPENS beyond the stop, the fill is that open,
   not the stop price - a real stop cannot fill better than the market.
 * REAL FUNDING. Perp funding accrues from Hyperliquid's actual published
   funding history, interval-weighted (correct across HL's 8h->1h schedule
   change), charged to longs and credited to shorts.
 * COSTS BOTH SIDES. Taker fee + slippage on entry and on exit.
"""
import bisect
import math
import statistics as st
from dataclasses import dataclass, field
from typing import List, Optional

# See core/backtester.py for the full measured cost breakdown. Short version:
# real round-trip cost at this account's order size is 0.091%-0.100%, measured
# against the live book. These constants keep the conservative 0.19% used for
# every validated result, because the strategies trade on volatile days when the
# book is thinner than the calm snapshot, and because restating the constant
# would silently improve every number already recorded in the vault.
TAKER_FEE = 0.00045
SLIPPAGE = 0.0005
MEASURED_SLIPPAGE = 0.00005
HOUR_MS = 3_600_000
YEAR_MS = 365.25 * 86_400_000


@dataclass
class Trade:
    coin: str
    direction: str
    entry_t: int
    exit_t: int
    entry_price: float
    exit_price: float
    gross_pct: float
    funding_pct: float
    cost_pct: float
    pnl_pct: float
    bars_held: int
    days_held: float
    exit_reason: str

    @property
    def won(self):
        return self.pnl_pct > 0


@dataclass
class Result:
    coin: str
    name: str
    trades: List[Trade] = field(default_factory=list)
    bars: int = 0
    start_t: int = 0
    end_t: int = 0

    @property
    def n(self):
        return len(self.trades)

    @property
    def win_rate(self):
        return sum(t.won for t in self.trades) / self.n if self.n else 0.0

    @property
    def expectancy(self):
        return sum(t.pnl_pct for t in self.trades) / self.n if self.n else 0.0

    @property
    def total_return(self):
        eq = 1.0
        for t in self.trades:
            eq *= (1 + t.pnl_pct)
        return eq - 1

    @property
    def avg_win(self):
        w = [t.pnl_pct for t in self.trades if t.won]
        return sum(w) / len(w) if w else 0.0

    @property
    def avg_loss(self):
        l = [-t.pnl_pct for t in self.trades if not t.won]
        return sum(l) / len(l) if l else 0.0

    @property
    def profit_factor(self):
        g = sum(t.pnl_pct for t in self.trades if t.won)
        b = -sum(t.pnl_pct for t in self.trades if not t.won)
        if b > 0:
            return g / b
        return float('inf') if g > 0 else 0.0

    @property
    def avg_days_held(self):
        return sum(t.days_held for t in self.trades) / self.n if self.n else 0.0

    @property
    def max_drawdown(self):
        eq = peak = 1.0
        mdd = 0.0
        for t in self.trades:
            eq *= (1 + t.pnl_pct)
            peak = max(peak, eq)
            mdd = min(mdd, (eq - peak) / peak)
        return mdd

    @property
    def sharpe_per_trade(self):
        if self.n < 2:
            return 0.0
        r = [t.pnl_pct for t in self.trades]
        sd = st.pstdev(r)
        return st.mean(r) / sd if sd > 0 else 0.0

    def annualized_return(self):
        if self.n == 0 or self.end_t <= self.start_t:
            return 0.0
        yrs = (self.end_t - self.start_t) / YEAR_MS
        base = 1 + self.total_return
        if yrs <= 0:
            return 0.0
        if base <= 0:
            return -1.0
        return base ** (1 / yrs) - 1

    def trades_per_year(self):
        yrs = (self.end_t - self.start_t) / YEAR_MS
        return self.n / yrs if yrs > 0 else 0.0

    def exposure_pct(self):
        """Fraction of the window actually spent holding a position."""
        span = self.end_t - self.start_t
        if span <= 0:
            return 0.0
        held = sum(t.exit_t - t.entry_t for t in self.trades)
        return held / span

    # ---- the metrics that stop a positive average from masquerading as an edge ----

    @property
    def median_trade(self):
        """A positive mean with a deeply negative median means the edge is a
        handful of outliers, not a repeatable process."""
        return st.median([t.pnl_pct for t in self.trades]) if self.n else 0.0

    def expectancy_ex_best(self, k=3):
        """Expectancy with the k biggest winners deleted. If a strategy only
        works because of two or three lottery trades, this exposes it.

        Note this is deliberately ASYMMETRIC and therefore unfair to any
        positive-skew strategy - trend following is *supposed* to make its money
        in a few trades. Use it as a flag, not a verdict; trimmed_expectancy()
        below is the fair version."""
        if self.n <= k:
            return 0.0
        r = sorted((t.pnl_pct for t in self.trades), reverse=True)[k:]
        return sum(r) / len(r)

    def trimmed_expectancy(self, frac=0.05):
        """Symmetric trimmed mean: drop the top AND bottom `frac` of trades.
        Robust to outliers in both tails, so unlike expectancy_ex_best it does
        not structurally penalise positive skew. If this stays positive, the
        edge lives in the body of the distribution rather than its tail."""
        if self.n < 10:
            return self.expectancy
        r = sorted(t.pnl_pct for t in self.trades)
        k = max(1, int(self.n * frac))
        core = r[k:-k]
        return sum(core) / len(core) if core else 0.0

    def account_equity(self, position_pct=0.20):
        """Compounded ACCOUNT equity at the project's real sizing rail: notional
        capped at `position_pct` of capital (config risk.max_position_pct_of_capital).
        Full-notional compounding is not what this bot would actually experience."""
        eq = peak = 1.0
        mdd = 0.0
        curve = [1.0]
        for t in self.trades:
            eq *= (1 + t.pnl_pct * position_pct)
            if eq <= 0:
                eq = 1e-9
            curve.append(eq)
            peak = max(peak, eq)
            mdd = min(mdd, (eq - peak) / peak)
        return {'final': eq, 'return': eq - 1, 'max_dd': mdd, 'curve': curve}

    def account_cagr(self, position_pct=0.20):
        a = self.account_equity(position_pct)
        yrs = (self.end_t - self.start_t) / YEAR_MS
        if yrs <= 0 or a['final'] <= 0:
            return 0.0
        return a['final'] ** (1 / yrs) - 1

    def line(self):
        if self.n == 0:
            return '{:<34}{:<6}NO TRADES'.format(self.name, self.coin)
        return ('{:<34}{:<6}n={:<4} wr={:>5.1%} exp={:>7.2%} tot={:>8.1%} '
                'ann={:>7.1%} pf={:>5.2f} dd={:>6.1%} hold={:>5.1f}d n/yr={:>4.1f}').format(
            self.name, self.coin, self.n, self.win_rate, self.expectancy,
            self.total_return, self.annualized_return(), self.profit_factor,
            self.max_drawdown, self.avg_days_held, self.trades_per_year())


class FundingCurve:
    """Interval-weighted funding accrual from real Hyperliquid funding events.

    `backfill_to`: Hyperliquid published no funding before 2023-05-12, but its
    candle history goes back to 2020. Rather than silently charge ZERO funding
    over that era - which would flatter every long-biased strategy - this
    extends the curve backwards at the coin's own MEDIAN observed rate. Crypto
    funding is persistently positive, so this keeps longs paying something
    realistic. It is an assumption, not data, and any result depending on the
    pre-2023 window is reported as such."""

    def __init__(self, events, backfill_to=None):
        self.t = [e['t'] for e in events]
        self.r = [e['rate'] for e in events]
        self.backfilled_before = None
        if backfill_to is not None and self.t and backfill_to < self.t[0]:
            med = st.median(self.r) if self.r else 0.0
            step = 8 * HOUR_MS
            pre_t, pre_r, cur = [], [], backfill_to
            while cur < self.t[0]:
                pre_t.append(cur)
                pre_r.append(med)          # hourly rate; cost() weights it by the 8h span
                cur += step
            self.backfilled_before = self.t[0]
            self.t = pre_t + self.t
            self.r = pre_r + self.r
        n = len(self.t)
        self.span = [(self.t[i + 1] - self.t[i]) for i in range(n - 1)] + [HOUR_MS]
        self.cum = [0.0]
        for i in range(n):
            self.cum.append(self.cum[-1] + self.r[i] * (self.span[i] / HOUR_MS))

    def cost(self, t0, t1, direction):
        """Signed funding over [t0,t1] per unit notional.
        Positive funding rate => longs pay, shorts receive.
        Return is signed as P&L: negative means it cost money."""
        if not self.t or t1 <= t0:
            return 0.0
        i0 = max(0, bisect.bisect_right(self.t, t0) - 1)
        i1 = max(0, bisect.bisect_right(self.t, t1) - 1)
        if i1 <= i0:
            paid = self.r[i0] * ((t1 - t0) / HOUR_MS) if i0 < len(self.r) else 0.0
        else:
            head = self.r[i0] * ((self.t[i0 + 1] - t0) / HOUR_MS) if i0 + 1 < len(self.t) else 0.0
            mid = self.cum[i1] - self.cum[i0 + 1]
            tail = self.r[i1] * ((t1 - self.t[i1]) / HOUR_MS)
            paid = head + mid + tail
        return -paid if direction == 'long' else paid


def backtest(bars, signal_fn, coin, funding=None, name='strategy', warmup=200,
             slippage=SLIPPAGE, fee=TAKER_FEE, allow_long=True, allow_short=True,
             start_i=None, end_i=None):
    """
    signal_fn(bars, i, pos) is evaluated on CLOSED bar i and returns:
      open:  {'dir': 'long'|'short', 'stop': px, 'target': px|None, 'reason': str}
      close: {'exit': True, 'reason': str}
      or None for "do nothing".
    `pos` is the open position dict or None. All fills happen at bars[i+1]['o'].
    """
    res = Result(coin=coin, name=name, bars=len(bars))
    lo = warmup if start_i is None else max(warmup, start_i)
    hi = (len(bars) - 1) if end_i is None else min(len(bars) - 1, end_i)
    if hi - lo < 2:
        return res
    res.start_t = bars[lo]['t']
    res.end_t = bars[hi]['t']
    pos = None
    rt_cost = 2 * (fee + slippage)

    def close_pos(p, exit_px, exit_t, exit_i, reason):
        if p['dir'] == 'long':
            gross = (exit_px - p['entry']) / p['entry']
        else:
            gross = (p['entry'] - exit_px) / p['entry']
        fund = funding.cost(p['entry_t'], exit_t, p['dir']) if funding else 0.0
        res.trades.append(Trade(
            coin=coin, direction=p['dir'], entry_t=p['entry_t'], exit_t=exit_t,
            entry_price=p['entry'], exit_price=exit_px, gross_pct=gross,
            funding_pct=fund, cost_pct=-rt_cost, pnl_pct=gross + fund - rt_cost,
            bars_held=exit_i - p['entry_i'],
            days_held=(exit_t - p['entry_t']) / 86_400_000, exit_reason=reason))

    for i in range(lo, hi):
        nxt = bars[i + 1]

        if pos is not None:
            o, h, l = nxt['o'], nxt['h'], nxt['l']
            stop, tgt = pos['stop'], pos['target']
            hit_stop = hit_tgt = False
            fill = None
            if pos['dir'] == 'long':
                if o <= stop:
                    hit_stop, fill = True, o
                elif l <= stop:
                    hit_stop, fill = True, stop
                if tgt is not None and not hit_stop:
                    if o >= tgt:
                        hit_tgt, fill = True, o
                    elif h >= tgt:
                        hit_tgt, fill = True, tgt
            else:
                if o >= stop:
                    hit_stop, fill = True, o
                elif h >= stop:
                    hit_stop, fill = True, stop
                if tgt is not None and not hit_stop:
                    if o <= tgt:
                        hit_tgt, fill = True, o
                    elif l <= tgt:
                        hit_tgt, fill = True, tgt
            if hit_stop or hit_tgt:
                close_pos(pos, fill, nxt['t'], i + 1,
                          'stop_loss' if hit_stop else 'take_profit')
                pos = None

        sig = signal_fn(bars, i, pos)

        if pos is not None and sig is not None and (
                sig.get('exit') or (sig.get('dir') and sig['dir'] != pos['dir'])):
            close_pos(pos, nxt['o'], nxt['t'], i + 1, sig.get('reason', 'signal_exit'))
            pos = None
            if sig.get('exit'):
                sig = None

        if pos is None and sig is not None and sig.get('dir'):
            if (sig['dir'] == 'long' and allow_long) or (sig['dir'] == 'short' and allow_short):
                pos = {'dir': sig['dir'], 'entry': nxt['o'], 'entry_t': nxt['t'],
                       'entry_i': i + 1, 'stop': sig['stop'],
                       'target': sig.get('target'), 'reason': sig.get('reason', '')}

    if pos is not None:
        close_pos(pos, bars[hi]['c'], bars[hi]['t'], hi, 'end_of_data')
    return res


# ---------------- causal indicator helpers (index i uses bars[..i] only) ----------------

def sma(vals, n, i):
    if i + 1 < n:
        return None
    return sum(vals[i - n + 1:i + 1]) / n


def sma_series(vals, n):
    out = [None] * len(vals)
    if n <= 0 or len(vals) < n:
        return out
    run = sum(vals[:n])
    out[n - 1] = run / n
    for i in range(n, len(vals)):
        run += vals[i] - vals[i - n]
        out[i] = run / n
    return out


def ema_series(vals, n):
    k = 2 / (n + 1)
    out = [None] * len(vals)
    acc = None
    for i, v in enumerate(vals):
        acc = v if acc is None else v * k + acc * (1 - k)
        if i >= n - 1:
            out[i] = acc
    return out


def atr_series(bars, n=14):
    out = [None] * len(bars)
    trs = []
    for i, b in enumerate(bars):
        if i == 0:
            tr = b['h'] - b['l']
        else:
            pc = bars[i - 1]['c']
            tr = max(b['h'] - b['l'], abs(b['h'] - pc), abs(b['l'] - pc))
        trs.append(tr)
        if i >= n:
            out[i] = sum(trs[i - n + 1:i + 1]) / n
    return out


def rsi_series(closes, n=14):
    out = [None] * len(closes)
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
        if i >= n:
            ag = sum(gains[i - n:i]) / n
            al = sum(losses[i - n:i]) / n
            out[i] = 100.0 if al == 0 else 100 - 100 / (1 + ag / al)
    return out


def stdev_series(vals, n):
    out = [None] * len(vals)
    for i in range(n - 1, len(vals)):
        out[i] = st.pstdev(vals[i - n + 1:i + 1])
    return out


def logret_vol_series(closes, n):
    """Stdev of log returns over a trailing n-bar window."""
    out = [None] * len(closes)
    rs = [0.0] * len(closes)
    for i in range(1, len(closes)):
        rs[i] = math.log(closes[i] / closes[i - 1]) if closes[i - 1] > 0 else 0.0
    for i in range(n, len(closes)):
        out[i] = st.pstdev(rs[i - n + 1:i + 1])
    return out


def rolling_max(vals, n):
    out = [None] * len(vals)
    for i in range(n - 1, len(vals)):
        out[i] = max(vals[i - n + 1:i + 1])
    return out


def rolling_min(vals, n):
    out = [None] * len(vals)
    for i in range(n - 1, len(vals)):
        out[i] = min(vals[i - n + 1:i + 1])
    return out


def funding_annualized_series(bars, funding: FundingCurve, lookback_hours=24):
    """Trailing-window average funding, annualized, aligned to each bar's close.
    Uses only funding events strictly at or before the bar timestamp (causal)."""
    out = [None] * len(bars)
    if funding is None or not funding.t:
        return out
    for i, b in enumerate(bars):
        t1 = b['t']
        t0 = t1 - lookback_hours * HOUR_MS
        if t0 < funding.t[0]:
            continue
        paid = -funding.cost(t0, t1, 'long')   # raw funding paid by longs
        hrs = lookback_hours
        out[i] = (paid / hrs) * 24 * 365
    return out
