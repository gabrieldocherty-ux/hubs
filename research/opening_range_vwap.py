"""
Opening range break -> extension -> pullback to VWAP. Tested where it is supposed
to work, and where it is not.

THE SETUP, as stated by its author:
  1. Price breaks the opening range (the first 30 minutes).
  2. The move extends at least one full range width past the break.
  3. No close back through VWAP on the way.
  Then the first touch of VWAP is the entry, because "the algos that missed the
  leg are waiting there to fill".

WHY IT IS WORTH TESTING RATHER THAN DISMISSING. This project's mechanism taxonomy
says reversion works only against a REAL anchor - B1 survives because it reverts
against a spot price somebody can arbitrage, while the four rejected reversion
strategies all reverted toward a computed statistic (a moving average, an RSI
level, a funding percentile). VWAP is computed, which puts it in the losing
family. But it has a better claim than a moving average: it is the price at which
money actually changed hands, so it is roughly where the marginal participant's
P&L breaks even, and execution desks genuinely are benchmarked against it. That
is a weak-but-real story, and the question "is VWAP a real anchor or a computed
one" generalises well beyond this one setup. So it gets a real test.

THE EXPERIMENT IS DESIGNED AS TWO CONTROLS ON ONE HYPOTHESIS, not three symbols
picked for variety:

  QQQ  Nasdaq-100. A real 09:30 opening auction. If the effect exists anywhere,
       it exists here - opening-range behaviour in equities is a documented
       effect with genuine mechanism behind it (overnight information releasing
       into a single-price auction).
  GLD  Gold. THE SAME NYSE Arca session, a completely different asset class and
       participant base. Holding session structure constant while changing the
       asset separates "this is about auctions" from "this is about equity flow".
  BTC  Hyperliquid perp. No session, no open, no auction - 24/7. The session has
       to be INVENTED by slicing the tape at an arbitrary UTC hour. This is the
       control that should fail, and the anchor is varied below precisely so the
       result cannot be blamed on one unlucky choice of arbitrary hour.

WHAT THE AUTHOR DOES NOT SPECIFY, and therefore what had to be chosen here: no
stop, no target, no exit, no holding period, no sizing. A setup with no exit is
not a strategy, so the house defaults apply - a stop at a multiple of the opening
range width, flat by the close, and the neighbourhood of both swept rather than
tuned.

TWO HONEST TIMEFRAMES, because neither alone is enough:
  1h  721 sessions per instrument over ~2 years. Statistically meaningful, but
      only 6 bars follow the opening range, so break, extension, pullback and
      exit all have to fit in six hourly steps.
  30m 60 sessions. Matches the stated 30-minute opening range exactly and leaves
      12 bars of room, but 60 sessions is indicative only and is labelled as such.
  They cross-check each other. Agreement in sign is evidence; disagreement means
  the effect is fragile to how you look at it.

EXECUTION IS MODELLED TWICE ON PURPOSE. "The first touch of the line is your
entry" quietly assumes you get filled AT VWAP. That is the optimistic case and it
is reported, but the headline number uses this project's standard - signal at a
bar's close, fill at the NEXT bar's open. The gap between the two is the part of
the claimed edge that is execution fantasy rather than edge, and it is worth
seeing as a number.

Costs are per-instrument and each is roughly twice realistic, matching how this
project models Hyperliquid (0.190% against 0.091-0.100% measured):
  QQQ/GLD 0.040% round trip (true cost nearer 0.02%: ~1c spread on a $600 share)
  BTC     0.190% round trip (the existing house model)
This asymmetry is the single most important number in the file. An intraday edge
that cannot pay a 0.190% crypto toll may comfortably pay a 0.040% ETF toll, so
the same setup can be dead in one venue and alive in another for reasons that
have nothing to do with whether the pattern is real.

NOTE: requires the `tzdata` package (pure data, no code) because Windows ships no
IANA timezone database and sessions must be grouped by true exchange-local date.
"""
import datetime
import statistics as st
import sys

sys.path.insert(0, 'research')
import hl_data
import market_data

BTC_COST = 0.0019
EQ_COST = 0.0004


# --------------------------------------------------------------------------- results
class Res:
    """Deliberately lightweight - engine.Result carries funding fields that mean
    nothing for an ETF, and borrowing it would imply a funding model that does
    not exist here."""

    def __init__(self, label):
        self.label = label
        self.pnl = []          # net fractional return per trade
        self.gross = []
        self.meta = []

    def add(self, gross, cost, info=None):
        self.gross.append(gross)
        self.pnl.append(gross - cost)
        self.meta.append(info or {})

    @property
    def n(self):
        return len(self.pnl)

    @property
    def expectancy(self):
        return st.mean(self.pnl) if self.pnl else 0.0

    @property
    def gross_expectancy(self):
        return st.mean(self.gross) if self.gross else 0.0

    @property
    def win_rate(self):
        return sum(1 for p in self.pnl if p > 0) / len(self.pnl) if self.pnl else 0.0

    def trimmed(self, frac=0.05):
        """5% symmetric trimmed mean - the decisive metric in this project. A
        positive mean with a negative trimmed value means two lucky trades."""
        if len(self.pnl) < 10:
            return self.expectancy
        s = sorted(self.pnl)
        k = int(len(s) * frac)
        core = s[k:len(s) - k] if k else s
        return st.mean(core) if core else 0.0

    def ex_best(self, k=3):
        if len(self.pnl) <= k:
            return 0.0
        return st.mean(sorted(self.pnl)[:-k])

    def se(self):
        """Standard error of the mean trade. An edge under one SE from zero is
        not distinguishable from nothing regardless of how it looks."""
        if len(self.pnl) < 2:
            return 0.0
        return st.pstdev(self.pnl) / (len(self.pnl) ** 0.5)


def vwap_series(bars):
    """Session-anchored VWAP: cumulative typical price weighted by volume.
    Element i is the VWAP THROUGH bar i inclusive."""
    out, pv, vv = [], 0.0, 0.0
    for b in bars:
        tp = (b['h'] + b['l'] + b['c']) / 3.0
        pv += tp * b['v']
        vv += b['v']
        out.append(pv / vv if vv > 0 else b['c'])
    return out


# --------------------------------------------------------------------------- the setup
def find_entry(bars, p):
    """Locate the ENTRY only. No stop, no target, no exit.

    Split out from run_session deliberately, because "the setup does not work" and
    "the exit I chose does not work" are different claims and the first cannot be
    made without isolating the entry. The source of this setup specifies no exit at
    all, so every exit tested here is mine, and mine could simply be wrong.

    No-lookahead discipline throughout: every condition tested on bar i uses only
    information complete at bar i's close, and the VWAP-touch test uses the VWAP
    known BEFORE bar i began (vwap[i-1]) rather than one computed with bar i's own
    volume in it, which would be mildly circular.
    """
    or_bars = p['or_bars']
    if len(bars) < or_bars + 3:
        return None

    orb = bars[:or_bars]
    hi = max(b['h'] for b in orb)
    lo = min(b['l'] for b in orb)
    width = hi - lo
    if width <= 0:
        return None

    vw = vwap_series(bars)

    broke = None          # 'long' / 'short'
    break_i = None
    extended = False
    entry = None

    for i in range(or_bars, len(bars) - 1):
        b = bars[i]

        # ---- 1. the opening range break
        if broke is None:
            if b['c'] > hi:
                broke, break_i = 'long', i
            elif b['c'] < lo:
                broke, break_i = 'short', i
            if broke is None:
                continue
            if not p['allow_same_bar_ext']:
                continue

        # ---- 3. no close back through VWAP on the way (checked continuously
        #         from the break until entry; this is the condition that is
        #         supposed to prove the leg is "clean")
        if p['require_vwap_hold'] and i > break_i:
            if broke == 'long' and b['c'] < vw[i]:
                return None
            if broke == 'short' and b['c'] > vw[i]:
                return None

        # ---- 2. extension at least one full range width past the break
        if not extended:
            need = hi + p['ext_mult'] * width if broke == 'long' else lo - p['ext_mult'] * width
            if (broke == 'long' and b['h'] >= need) or (broke == 'short' and b['l'] <= need):
                extended = True
            continue

        # ---- 4. first touch of VWAP after the extension is satisfied
        ref_vw = vw[i - 1]
        touched = b['l'] <= ref_vw <= b['h']
        if not touched:
            continue

        nxt = bars[i + 1]
        fill = ref_vw if p['fill_at_vwap'] else nxt['o']
        entry = {'i': i + 1, 'price': fill, 'dir': broke,
                 'stop_dist': p['stop_mult'] * width, 'width': width,
                 'or_hi': hi, 'or_lo': lo}
        break

    return entry


def run_session(bars, p):
    """The entry plus the DEFAULT exit: a stop at a multiple of the opening range
    width, otherwise flat at the session close. This is one exit configuration out
    of many; opening_range_exits.py sweeps the rest."""
    entry = find_entry(bars, p)
    if entry is None:
        return None

    # ---- manage the position to the session close (or a hold cap)
    d = entry['dir']
    px = entry['price']
    stop = px - entry['stop_dist'] if d == 'long' else px + entry['stop_dist']
    last = min(len(bars) - 1, entry['i'] + p['max_hold'] - 1)
    exit_px, reason = None, None

    for j in range(entry['i'], last + 1):
        b = bars[j]
        # stop checked intra-bar from the high/low, and a gap through the stop
        # fills at the open rather than at the stop price
        if d == 'long' and b['l'] <= stop:
            exit_px = min(b['o'], stop) if b['o'] < stop else stop
            reason = 'stop'
            break
        if d == 'short' and b['h'] >= stop:
            exit_px = max(b['o'], stop) if b['o'] > stop else stop
            reason = 'stop'
            break
    if exit_px is None:
        exit_px, reason = bars[last]['c'], 'close'

    gross = (exit_px - px) / px if d == 'long' else (px - exit_px) / px
    return {'gross': gross, 'dir': d, 'reason': reason, 'width_pct': entry['width'] / px,
            'bars_held': (last - entry['i'] + 1)}


BASE = {'or_bars': 1, 'ext_mult': 1.0, 'stop_mult': 1.0, 'max_hold': 99,
        'require_vwap_hold': True, 'allow_same_bar_ext': True, 'fill_at_vwap': False}


def backtest(sessions, p, cost, label):
    r = Res(label)
    for d, bars in sessions:
        t = run_session(bars, p)
        if t:
            r.add(t['gross'], cost, {'date': d, **t})
    return r


# --------------------------------------------------------------------------- data
_cache = {}


def load(sym, interval='1h', rng='730d', anchor=0):
    key = (sym, interval, rng, anchor)
    if key in _cache:
        return _cache[key]
    if sym == 'BTC':
        bars, _ = hl_data.get_candles('BTC', interval, 420)
        sess, short = market_data.utc_sessions(bars, anchor_hour=anchor, min_bars=20)
    else:
        bars, _ = market_data.get_bars(sym, interval, rng)
        sess, short = market_data.sessions(bars, sym, min_bars=5)
    _cache[key] = (sess, short)
    return sess, short


COST = {'QQQ': EQ_COST, 'GLD': EQ_COST, 'BTC': BTC_COST}


def row(label, r, cost):
    if r.n == 0:
        print('  {:<38}{:>6}   no trades'.format(label, 0))
        return
    se = r.se()
    print('  {:<38}{:>6}{:>8}{:>10}{:>10}{:>10}{:>10}{:>9}{:>8}'.format(
        label, r.n, '{:.0%}'.format(r.win_rate),
        '{:+.3f}%'.format(r.gross_expectancy * 100),
        '{:+.3f}%'.format(r.expectancy * 100),
        '{:+.3f}%'.format(r.trimmed() * 100),
        '{:+.3f}%'.format(r.ex_best(3) * 100),
        '{:.2f}'.format(r.expectancy / se) if se else '-',
        '{:.3f}%'.format(cost * 100)))


HDR = '  {:<38}{:>6}{:>8}{:>10}{:>10}{:>10}{:>10}{:>9}{:>8}'.format(
    'variant', 'n', 'win', 'GROSS', 'net', 'trim5', 'ex-best3', 't-stat', 'cost')
