"""
WILDCARD: average PRINT SIZE as a direct public observable of forced flow, and
the price concession owed to a liquidity provider that is not allowed to leave.

--------------------------------------------------------------------------
THE MECHANISM, stated precisely before a single line of code runs
--------------------------------------------------------------------------

Every forced-flow strategy in this book so far - S3 forced-flow continuation,
D1 range-break cascade, M3 Donchian - identifies forced flow by VOLUME. Volume
is a quantity measure. It answers "how much traded", and it cannot distinguish
ten thousand retail traders getting excited from forty traders being liquidated.
That conflation is almost certainly why S3 wins 55% of the time and not 75%:
most of its volume spikes are not forced flow at all, they are enthusiasm.

There is a second, completely different observable sitting in the same candle
feed that this project has never used: `n`, the number of trades in the bar.
Notional divided by trade count is the AVERAGE PRINT SIZE, and print size is a
COMPOSITION measure, not a quantity measure. It answers "how many people did
this volume come from".

Why that separates forced from discretionary flow on a perpetuals venue
specifically. When Hyperliquid liquidates a position, the liquidation engine
sends the WHOLE position as one aggressive market order. It is not sliced into
child orders, it is not worked over an hour, it does not wait for a better
level, and it does not care what the book looks like - the position must be
closed to keep the account solvent, right now. Discretionary flow is the exact
opposite: anyone trading size on purpose slices it precisely to avoid paying
impact. So forced flow is structurally few-and-huge and discretionary flow is
structurally many-and-small, and average print size reads that difference
directly off public data. This is not a proxy for forced flow; it is close to a
measurement of it.

WHO IS FORCED, AND WHICH SIDE OF MY TRADE THEY ARE ON. Two parties, and the
second is the one that matters:

  1. The liquidated trader. Forced, but already gone by the time the daily bar
     closes. Not tradable after the fact.

  2. Whoever absorbed the print. On Hyperliquid the absorber of last resort is
     HLP, a public vault that quotes as a matter of protocol rather than as a
     matter of appetite. A market maker on a normal venue that does not like
     the flow can simply stop quoting and go home. HLP cannot go home. A
     designated liquidity provider that is not permitted to withdraw has only
     one lever left: PRICE. It must be paid to take inventory it did not want,
     and then it must work that inventory back off, because carrying a large
     one-sided book is the risk it is being paid to avoid, not one it wants to
     keep. The concession it charges on the way in, and the inventory it is
     compelled to unwind afterwards, is the thing this strategy is trying to
     buy.

THE ENTRY CONDITION FOLLOWS FROM THAT, AND IT IS THE OPPOSITE OF S3's. The
concession story only holds when a SMALL number of forced orders hit a book
that was not braced for them. If the whole market is trading heavily, the move
is a consensus repricing and there is no concession to collect - the forced
seller is one of thousands and gets absorbed at fair value. So the setup is:

    print size abnormally LARGE   *and*   total volume ORDINARY OR LOW.

Few, huge, price-insensitive orders on an otherwise quiet day. That day's price
move is a liquidity event, not information, and it should partially revert as
the absorbed inventory is worked off. Direction: FADE the day.

--------------------------------------------------------------------------
WHY THIS IS NOT A STRATEGY THIS PROJECT ALREADY OWNS
--------------------------------------------------------------------------
  * Not S3. S3 REQUIRES a volume spike. This REQUIRES THE ABSENCE of one - the
    entry conditions are disjoint on the same variable, and the sign convention
    is opposite (S3 follows the day, this fades it). Overlap is bounded near
    zero by construction, and it is still measured below rather than assumed.
  * Not D1/M3. No breakout condition of any kind; those are continuation.
  * Not S1 short-term reversal, which this project tested and rejected (1 of 12
    configs positive). S1 conditions on a large PRICE move alone. This
    conditions on flow COMPOSITION and explicitly throws away the high-volume
    days. If print composition turns out to be inert, this collapses into S1
    and deserves to die exactly as S1 did - and the dose-response test below is
    built to force that admission.
  * It obeys the project's own hard-won rule that REVERSION NEEDS A REAL
    ANCHOR. The four rejected reversion strategies all reverted toward a
    statistical construct - a moving average, an RSI level, a funding
    percentile - which nobody is under any obligation to trade back toward. The
    anchor here is not a statistic. It is an inventory position sitting on the
    book of an identified party who is structurally obliged to reduce it.

--------------------------------------------------------------------------
WHAT KILLS IT - written down in advance so the result cannot be rationalised
--------------------------------------------------------------------------
  1. NO DOSE-RESPONSE across print-size buckets. If a 2.5x print day does not
     revert harder than a 1.2x print day, the composition variable is inert,
     the mechanism is absent, and any headline number is a threshold fit.
  2. THE SAME EFFECT AT HIGH VOLUME. The concession claim is specifically that
     it needs a thin, unbraced book. If fading works just as well on the
     high-volume days, then this is not a concession, it is generic reversal,
     and generic reversal is already rejected here. High-volume days are run as
     an explicit PLACEBO on the identical signal.
  3. Trimmed expectancy <= 0. Tail-driven, dead.
  4. n < 50 pooled. Indicative only, and said out loud.
  5. Overlap > 0.6 with S3 / D1 / B1 / M3. Same bet, adds nothing.

--------------------------------------------------------------------------
DATA HONESTY, UP FRONT
--------------------------------------------------------------------------
The trade-count field is NOT usable over the venue's whole history. Through
2023 the implied average print sits at $99, $149, $158 - identical to the
dollar across BTC, ETH and SOL in the same months. Three different markets do
not agree on their average trade size to the dollar; that is a venue-side
quantisation artefact from Hyperliquid's early days, not a market fact. Using
it would manufacture print-size "spikes" out of a reporting change. The sample
therefore starts 2023-11-01, once the series decouples across coins and starts
behaving like a real trade count. That costs ~8 months of history and it is the
right trade. HYPE's perp begins 2024-12-05 regardless.
"""
import sys
import datetime
import statistics as st

sys.path.insert(0, 'research')
import engine
import pooled
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout
from strategies_macro import donchian_turtle

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']

# See the data-honesty note in the module docstring. Before this date the
# trade-count field is quantised and agrees across unrelated coins to the
# dollar, so print size is not measurable.
SAMPLE_START = int(datetime.datetime(2023, 11, 1).timestamp() * 1000)

# Base configuration. Every value here is argued from the mechanism or borrowed
# unchanged from an existing validated strategy, NOT selected by looking at
# results. Stated before the first run so the neighbourhood sweep below is a
# robustness check rather than a search.
#   win=20      the same baseline window S3 uses on volume - borrowed, not tuned
#   pz=1.5      the same 1.5x multiple S3 uses on volume - borrowed, not tuned
#   vcap=1.0    volume at or below its own average: the "unbraced book"
#               condition, and what makes this disjoint from S3
#   hold=3      inventory is worked off in days; the concession is not a trend
#   atr_mult=2.5 project-standard stop
BASE = {'win': 20, 'pz': 1.5, 'vcap': 1.0, 'vmin': 0.0, 'hold': 3, 'atr_mult': 2.5}

DAY_MS = 86_400_000
_cache = {}


def load(coin):
    """Daily bars + real funding, with the final bar dropped.

    The last candle is the day in progress. Its notional is a fraction of a
    full day's, so it would score as an abnormally QUIET day and could fire a
    spurious signal on the most recent bar - the one that would go live."""
    if coin not in _cache:
        bars, fund = pooled.load(coin)
        _cache[coin] = (bars[:-1], fund)
    return _cache[coin]


def notional(b):
    """Dollar traded value. Candle 'v' is base units, so it needs a price.
    Typical price (h+l+c)/3 rather than the close, so a violent intraday
    reversal does not misstate the day's traded value."""
    return b['v'] * (b['h'] + b['l'] + b['c']) / 3.0


def print_ratio_series(bars, win, base_units=False):
    """P[i] = average print size on day i / mean average-print over the
    PREVIOUS `win` days.

    A ratio and not a level, because the level drifts enormously as the venue
    grows: BTC's median print went $1.4k -> $12k -> $5k over this sample. Any
    fixed dollar threshold would be a date filter wearing a strategy costume.

    Strictly causal - the baseline window ends at i-1, so P[i] is known the
    moment bar i closes and the engine still fills at bar i+1's open.

    `base_units=True` measures print size in coin units instead of dollars.
    Dollars is the economically correct unit (a forced order is a dollar risk),
    but over a 20-day baseline a strong price trend biases the dollar ratio
    upward, and since this strategy FADES, that bias would tilt it short. The
    base-unit version has no price in it at all and is run as a control."""
    sizes = [None] * len(bars)
    for i, b in enumerate(bars):
        if b['n']:
            sizes[i] = (b['v'] if base_units else notional(b)) / b['n']
    out = [None] * len(bars)
    for i in range(len(bars)):
        if i < win:
            continue
        hist = [s for s in sizes[i - win:i] if s]
        if sizes[i] is None or len(hist) < win * 0.9:
            continue
        m = sum(hist) / len(hist)
        if m > 0:
            out[i] = sizes[i] / m
    return out


def notional_ratio_series(bars, win):
    """V[i] = day i's dollar volume / mean of the previous `win` days. This is
    S3's variable, used here as a GATE IN THE OPPOSITE DIRECTION."""
    vals = [notional(b) for b in bars]
    out = [None] * len(bars)
    for i in range(len(bars)):
        if i < win:
            continue
        m = sum(vals[i - win:i]) / win
        if m > 0:
            out[i] = vals[i] / m
    return out


def start_index(bars, extra=0):
    for i, b in enumerate(bars):
        if b['t'] >= SAMPLE_START:
            return i + extra
    return len(bars)


# ---------------------------------------------------------------------------
# PHASE 1 - EVENT STUDY. No strategy, no stop, no parameters fitted: just
# "conditional on print composition, what happens next". If there is no
# dose-response here, nothing downstream is worth running.
# ---------------------------------------------------------------------------

def fade_forward(bars, i, h):
    """Return to a FADE of day i, entered at the earliest honest price (day
    i+1's open, matching the engine's fill convention) and held h days."""
    if i + 1 >= len(bars) or i + h >= len(bars):
        return None
    o = bars[i + 1]['o']
    if o <= 0:
        return None
    raw = (bars[i + h]['c'] - o) / o
    day = bars[i]['c'] - bars[i]['o']
    if day == 0:
        return None
    return -raw if day > 0 else raw


def collect(win=20, base_units=False):
    """Pooled coin-days: (print ratio, volume ratio, fade returns by horizon)."""
    rows = []
    for c in COINS:
        bars, _ = load(c)
        P = print_ratio_series(bars, win, base_units)
        V = notional_ratio_series(bars, win)
        i0 = start_index(bars)
        for i in range(i0, len(bars)):
            if P[i] is None or V[i] is None:
                continue
            f = {h: fade_forward(bars, i, h) for h in (1, 2, 3, 5, 10)}
            if f[3] is None:
                continue
            rows.append((c, P[i], V[i], f))
    return rows


def msd(xs):
    if not xs:
        return float('nan'), float('nan'), 0
    m = st.mean(xs)
    se = st.stdev(xs) / len(xs) ** 0.5 if len(xs) > 1 else float('nan')
    return m, se, len(xs)


def event_study(rows, label):
    print('\n' + '-' * 112)
    print('EVENT STUDY [{}] - mean FADE return by print-size bucket, split on '
          'whether volume was ordinary or elevated'.format(label))
    print('-' * 112)
    ps = sorted(r[1] for r in rows)
    cuts = [ps[int(len(ps) * q)] for q in (0.2, 0.4, 0.6, 0.8, 0.95)]
    print('  print-ratio quintile cuts: ' + '  '.join('{:.2f}'.format(c) for c in cuts))

    def bucket(p):
        for k, c in enumerate(cuts):
            if p < c:
                return k
        return len(cuts)

    names = ['Q1 <{:.2f}'.format(cuts[0]), 'Q2', 'Q3', 'Q4',
             'Q5 {:.2f}-{:.2f}'.format(cuts[3], cuts[4]),
             'top5% >{:.2f}'.format(cuts[4])]

    for vlabel, keep in [('VOLUME ORDINARY  (v_ratio <= 1.0)  <- the mechanism claim',
                          lambda v: v <= 1.0),
                         ('VOLUME ELEVATED  (v_ratio >= 1.5)  <- PLACEBO, S3 territory',
                          lambda v: v >= 1.5)]:
        print('\n  {}'.format(vlabel))
        print('    {:<16}{:>7}  {}'.format('bucket', 'n', ''.join(
            '{:>18}'.format('h={}d'.format(h)) for h in (1, 3, 5, 10))))
        for k in range(len(cuts) + 1):
            sel = [r for r in rows if bucket(r[1]) == k and keep(r[2])]
            if not sel:
                continue
            cells = ''
            for h in (1, 3, 5, 10):
                xs = [r[3][h] for r in sel if r[3][h] is not None]
                m, se, n = msd(xs)
                cells += '{:>10.2%}+-{:.2%}'.format(m, se) if n else '{:>18}'.format('-')
            print('    {:<16}{:>7}  {}'.format(names[k], len(sel), cells))


# ---------------------------------------------------------------------------
# PHASE 2 - the tradable version, through the honest engine.
# ---------------------------------------------------------------------------

def print_concession(params):
    """Fade a day whose prints were abnormally large but whose total volume was
    ordinary: few huge price-insensitive orders into an unbraced book."""
    win, pz, vcap = params['win'], params['pz'], params['vcap']
    vmin, hold, atr_mult = params['vmin'], params['hold'], params['atr_mult']
    base_units = params.get('base_units', False)
    invert = params.get('invert', False)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'P' not in state:
                state['P'] = print_ratio_series(bars, win, base_units)
                state['V'] = notional_ratio_series(bars, win)
                state['atr'] = engine.atr_series(bars, 14)
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            p, v, atr = state['P'][i], state['V'][i], state['atr'][i]
            if None in (p, v, atr) or atr <= 0:
                return None
            if p < pz or v > vcap or v < vmin:
                return None
            b = bars[i]
            move = b['c'] - b['o']
            if move == 0:
                return None
            up = move > 0
            # FADE by default. invert=True trades the same days as CONTINUATION,
            # which is the diagnostic for "big prints are information, not a
            # liquidity event" - and if that is what wins, it is S3's mechanism
            # and belongs to S3.
            want = ('long' if up else 'short') if invert else ('short' if up else 'long')
            px = b['c']
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': 'print {:.2f}x on {:.2f}x volume'.format(p, v)}
        return sig
    return factory


def run(params, name='WC', **kw):
    merged = engine.Result(coin='POOL', name=name)
    per = {}
    for c in COINS:
        bars, fund = load(c)
        warm = max(start_index(bars), params['win'] + 20)
        if len(bars) < warm + 60:
            continue
        r = engine.backtest(bars, print_concession(params)(), c, fund,
                            name=name, warmup=warm, **kw)
        per[c] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


def main():
    variants = 0

    print('=' * 112)
    print('WILDCARD - PRINT-SIZE CONCESSION: forced flow identified by trade')
    print('           COMPOSITION rather than by volume, then faded.')
    print('=' * 112)

    # ---- data integrity, reported not assumed -----------------------------
    print('\nDATA')
    for c in COINS:
        bars, _ = load(c)
        i0 = start_index(bars)
        usable = [b for b in bars[i0:] if b['n']]
        d0 = datetime.datetime.utcfromtimestamp(bars[i0]['t'] / 1000).date()
        d1 = datetime.datetime.utcfromtimestamp(bars[-1]['t'] / 1000).date()
        print('  {:<5} {} -> {}  bars_in_sample={:<5} with_trade_count={:<5}'.format(
            c, d0, d1, len(bars) - i0, len(usable)))

    rows = collect(BASE['win'])
    print('\n  pooled coin-days with a usable print ratio: {}'.format(len(rows)))
    lowv = sum(1 for r in rows if r[2] <= 1.0)
    print('  of which volume-ordinary (v<=1.0): {}   volume-elevated (v>=1.5): {}'.format(
        lowv, sum(1 for r in rows if r[2] >= 1.5)))

    # correlation between the two observables: if print size were just a
    # restatement of volume there would be nothing new here at all.
    P = [r[1] for r in rows]
    V = [r[2] for r in rows]
    mp, mv = st.mean(P), st.mean(V)
    cov = sum((a - mp) * (b - mv) for a, b in zip(P, V)) / len(P)
    corr = cov / (st.pstdev(P) * st.pstdev(V))
    # PREDICTED near zero. MEASURED +0.62. This is the first thing that went
    # wrong and it is structural, not fixable: busy days have both more trades
    # AND bigger trades, so print size is substantially volume wearing a
    # different hat. It also means the entry condition (big prints, ordinary
    # volume) selects a nearly empty corner of the joint distribution - which
    # is exactly what the trade count below turns out to show.
    print('  corr(print ratio, volume ratio) = {:+.3f}   [predicted ~0 if print size '
          'were a genuinely independent observable]'.format(corr))

    # ---- PHASE 1 ----------------------------------------------------------
    event_study(rows, 'dollar print size')

    # ---- PHASE 2 ----------------------------------------------------------
    print('\n' + '=' * 112)
    print('STRATEGY - base configuration (declared before any run)')
    print('=' * 112)
    per, m = run(BASE)
    variants += 1
    tr, te = pooled.pooled_split(m)
    print('  ' + pooled.describe(m, 'POOLED'))
    if m.n:
        print('  ' + pooled.describe(tr, '  train(60%)'))
        print('  ' + pooled.describe(te, '  test(40%)'))
        print('  trades/yr={:.1f}  exBest3={:+.2%}  median={:+.2%}  avg hold={:.1f}d'.format(
            m.trades_per_year(), m.expectancy_ex_best(3), m.median_trade, m.avg_days_held))
        yr = pooled.pooled_yearly(m)
        print('  by year: {}/{} positive   '.format(
            sum(1 for _, r in yr if r.expectancy > 0), len(yr)) +
            '  '.join('{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n) for y, r in yr))
        for c in COINS:
            if c in per and per[c].n:
                print('  ' + pooled.describe(per[c], c))
        for side in ('long', 'short'):
            ts = [t for t in m.trades if t.direction == side]
            if ts:
                print('    {:<6} n={:<4} wr={:>5.1%} exp={:>7.2%}'.format(
                    side, len(ts), sum(1 for t in ts if t.won) / len(ts),
                    sum(t.pnl_pct for t in ts) / len(ts)))

    # ---- the two diagnostics that decide whether the MECHANISM is real ----
    print('\n' + '=' * 112)
    print('MECHANISM DIAGNOSTICS - these matter more than the number above')
    print('=' * 112)

    print('\n  (a) PLACEBO: identical signal on ELEVATED-volume days. The')
    print('      concession story requires a thin book. If this is just as good,')
    print('      the "unbraced book" condition is decoration.')
    p = dict(BASE); p['vcap'] = 99.0; p['vmin'] = 1.5
    _, mp_ = run(p, 'placebo-highvol'); variants += 1
    print('      ' + pooled.describe(mp_, 'high-vol fade'))

    print('\n  (b) INVERSION: same days traded as CONTINUATION. If continuation')
    print('      wins, big prints are information and this belongs to S3.')
    p = dict(BASE); p['invert'] = True
    _, mi = run(p, 'inverted'); variants += 1
    print('      ' + pooled.describe(mi, 'continuation'))

    print('\n  (c) NO PRINT FILTER: same volume-ordinary days, no print condition')
    print('      at all. This is the S1 short-term-reversal null. If it scores')
    print('      the same, print composition is inert and this is a repeat of a')
    print('      strategy already rejected here.')
    p = dict(BASE); p['pz'] = 0.0
    _, mn = run(p, 'no-print-filter'); variants += 1
    print('      ' + pooled.describe(mn, 'no print filter'))

    print('\n  (d) BASE-UNIT print size (no price in the ratio at all).')
    p = dict(BASE); p['base_units'] = True
    _, mb = run(p, 'base-units'); variants += 1
    print('      ' + pooled.describe(mb, 'coin-unit prints'))

    # ---- dose response in strategy space ---------------------------------
    print('\n' + '=' * 112)
    print('DOSE-RESPONSE (strategy space): stronger print signal -> stronger result?')
    print('=' * 112)
    dose = []
    for pzv in (1.2, 1.35, 1.5, 1.75, 2.0, 2.5):
        p = dict(BASE); p['pz'] = pzv
        _, mm = run(p); variants += 1
        dose.append((pzv, mm))
        print('  pz>={:<5} n={:<4} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%} n/yr={:>5.1f}'.format(
            pzv, mm.n, mm.win_rate, mm.expectancy, mm.trimmed_expectancy(0.05),
            mm.trades_per_year()))

    # ---- parameter neighbourhood -----------------------------------------
    print('\n' + '=' * 112)
    print('PARAMETER NEIGHBOURHOOD')
    print('=' * 112)
    neigh = []
    for key, vals in [('vcap', [0.7, 0.85, 1.2, 1.5]),
                      ('hold', [1, 2, 5, 7, 10]),
                      ('win', [10, 30, 60]),
                      ('atr_mult', [1.5, 2.0, 3.5])]:
        for v in vals:
            p = dict(BASE); p[key] = v
            _, mm = run(p); variants += 1
            if mm.n == 0:
                continue
            t1, t2 = pooled.pooled_split(mm)
            neigh.append(mm.trimmed_expectancy(0.05))
            print('  {:<10}={:<6} n={:<4} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%} '
                  'train={:>7.2%} test={:>7.2%}'.format(
                      key, v, mm.n, mm.win_rate, mm.expectancy,
                      mm.trimmed_expectancy(0.05),
                      t1.expectancy if t1 and t1.n else 0,
                      t2.expectancy if t2 and t2.n else 0))
    if neigh:
        print('  -> {}/{} perturbations positive on trimmed expectancy'.format(
            sum(1 for r in neigh if r > 0), len(neigh)))

    # ---- cost stress ------------------------------------------------------
    print('\n' + '=' * 112)
    print('COST STRESS   (annual drag = trades/yr x 0.190%)')
    print('=' * 112)
    if m.n:
        print('  base: {:.1f} trades/yr x 0.190% = {:.1f}%/yr of notional in cost, '
              'against {:+.2f}% mean edge/trade'.format(
                  m.trades_per_year(), m.trades_per_year() * 0.190, m.expectancy * 100))
    for mult in (1, 2, 4):
        _, mm = run(BASE, slippage=engine.SLIPPAGE * mult, fee=engine.TAKER_FEE * mult)
        print('  {}x ({:.2f}% round trip): n={:<4} exp={:>7.2%} trim5={:>7.2%} '
              'acctCAGR={:>6.1%}'.format(
                  mult, 2 * (engine.SLIPPAGE + engine.TAKER_FEE) * mult * 100,
                  mm.n, mm.expectancy, mm.trimmed_expectancy(0.05), mm.account_cagr(0.20)))

    # ---- overlap ----------------------------------------------------------
    print('\n' + '=' * 112)
    print('OVERLAP vs the live book (>0.6 = same bet, adds nothing)')
    print('=' * 112)
    others = [('S3 forced_flow', volume_spike,
               {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}, 60),
              ('D1 range_break', range_breakout,
               {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}, 60),
              ('M3 donchian', donchian_turtle,
               {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0}, 85)]
    for label, fn, prm, warm in others:
        accum = []
        for c in COINS:
            bars, fund = load(c)
            w = max(start_index(bars), BASE['win'] + 20)
            s1, _ = pooled.position_series(bars, lambda q: print_concession(q),
                                           BASE, c, fund, w)
            s2, _ = pooled.position_series(bars, lambda q: fn(q), prm, c, fund,
                                           max(w, warm))
            ov, n = pooled.overlap(s1, s2)
            accum.append((c, ov, n))
        print('  {:<16} '.format(label) + '   '.join(
            '{}:{}({} bars)'.format(c, 'n/a' if o is None else '{:.2f}'.format(o), n)
            for c, o, n in accum))
    print('  B1 basis: not re-run here - B1 is a perp-vs-spot dislocation fade with')
    print('    no volume or print condition, and it trades BTC/ETH/HYPE only. The')
    print('    entry variables are disjoint; the honest cross-check is the live')
    print('    correlation once both have trades, not a reconstructed series.')

    # ---- addendum ---------------------------------------------------------
    # The most useful thing this dead idea produced is not about this idea. The
    # live book's S3 rests on a stated mechanism - "volume spikes are forced
    # liquidation flow" - and print composition is the first observable this
    # project has had that can actually check that claim. If S3's edge really
    # is forced flow, its CONTINUATION should be strongest on the volume-spike
    # days whose prints are LARGEST (few, huge, forced) and weakest where they
    # are smallest (many, small, discretionary). Descriptive only: no
    # parameters, no strategy, no fitting.
    print('\n' + '=' * 112)
    print("ADDENDUM - does S3's stated mechanism survive a composition test?")
    print('  Volume-elevated days only (v>=1.5). CONTINUATION return by print size.')
    print('  Forced-flow story predicts: bigger prints -> stronger continuation.')
    print('=' * 112)
    hv = [r for r in rows if r[2] >= 1.5]
    ps = sorted(r[1] for r in hv)
    tc = [ps[int(len(ps) * q)] for q in (0.33, 0.67)]
    labels = ['small prints (bottom 3rd)', 'mid prints', 'large prints (top 3rd)']
    print('  {:<28}{:>6}  {}'.format('bucket', 'n', ''.join(
        '{:>18}'.format('h={}d'.format(h)) for h in (3, 5, 10))))
    for k, lab in enumerate(labels):
        sel = [r for r in hv if (r[1] < tc[0] if k == 0 else
                                 (r[1] >= tc[1] if k == 2 else tc[0] <= r[1] < tc[1]))]
        cells = ''
        for h in (3, 5, 10):
            xs = [-r[3][h] for r in sel if r[3][h] is not None]   # negate fade = continue
            mm_, se, n = msd(xs)
            cells += '{:>10.2%}+-{:.2%}'.format(mm_, se) if n else '{:>18}'.format('-')
        print('  {:<28}{:>6}  {}'.format(lab, len(sel), cells))
    print('  Read this cautiously: the standard errors are ~0.8pp, so the spread')
    print('  across buckets is roughly one standard error and is NOT significant.')
    print('  What can be said without overclaiming is the absence: at no horizon')
    print('  do the largest-print days continue MORE than the smallest-print days,')
    print('  and that is precisely what the forced-liquidation story S3 is')
    print('  justified by requires. S3\'s EDGE is not in question here - it is')
    print('  validated and it is live. Its stated MECHANISM is, and a strategy')
    print('  whose mechanism story is wrong is one whose failure mode is unknown.')
    print('  Flag for a dedicated test, not a finding.')

    print('\n' + '=' * 112)
    print('TOTAL CONFIGURATIONS EVALUATED: {}'.format(variants))
    print('=' * 112)


if __name__ == '__main__':
    main()
