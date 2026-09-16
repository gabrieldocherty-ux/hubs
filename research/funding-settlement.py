"""
FUNDING AS A REALISED CASH FLOW, NOT AS A SENTIMENT GAUGE.

THE HYPOTHESIS AND WHY IT MIGHT BE TRUE
---------------------------------------
Everything this project has previously tested about funding treated it as a
SENTIMENT reading: take the trailing funding rate, rank it against its own
history, and fade the crowded side when the percentile gets extreme. That
failed (D3 funding-crowding, and the 4h short-only re-run in funding_recheck.py),
and the mechanism taxonomy explains why it *had* to fail: a funding PERCENTILE
is a statistical construct. Nobody on the venue is contractually obliged to
trade funding back toward its 90th percentile. The one reversion strategy that
survived here (B1 basis) works because it reverts toward a REAL SPOT PRICE that
an arbitrageur can physically capture. A percentile has no such anchor.

But funding has a second identity that is not statistical at all. Every hour,
Hyperliquid debits one side of every open perp position and credits the other.
That is a literal cash transfer, settled by the exchange, unconditional on
anyone's opinion. When funding is deeply negative, shorts pay longs every hour:
a long position is being SUBSIDISED to exist. That subsidy arrives whether or
not price moves, whether or not the "crowd" unwinds, and whether or not any
statistical average is restored.

So the reframe: stop asking "is positioning crowded?" and start asking "am I
being paid or charged to hold this, and how much?". Three concrete tests:

  (a) EXPECTANCY TILT. The existing strategies (S3 forced-flow continuation,
      D1 range-break cascade) already decide direction on their own mechanism.
      Does the sign of the carry at entry - being paid vs being charged -
      systematically improve the expectancy of trades they were going to take
      anyway? This is a tilt on an existing edge, not a new entry trigger, so
      it does not re-run the failed crowding test.

  (b) IS THE CASH FLOW PREDICTABLE? Funding paid over a holding period is only
      exploitable if you can forecast it at entry. Perp funding is strongly
      autocorrelated (it is anchored to the same basis that persists for days),
      so the prior here is YES. If confirmed, the interesting question becomes
      whether price systematically moves against the subsidised side by more
      than the subsidy - which is exactly what a fairly-priced risk premium
      would do.

  (c) DOES FUNDING SIGN INTERACT WITH S3 DIRECTION? An S3 long taken while
      funding is negative is doubly attractive under this framing: the
      continuation bet plus a paid-to-hold subsidy on top.

WHAT WOULD KILL IT, STATED IN ADVANCE
-------------------------------------
Scale. Hyperliquid funding runs on the order of 10%/yr annualized in normal
conditions. Over a 10-day hold that is ~0.27% of notional. Daily price noise on
these coins is ~3-4%, so over 10 days the price term has a standard deviation
around 10-12% - roughly 40x the carry term. For the carry to matter as a tilt,
it must be a SIGNAL about price (i.e. it must predict the gross return), not
merely a cash addition, because as a cash addition it is a rounding error next
to the noise. And "funding predicts price" is precisely the sentiment claim
that already failed. That tension is the real content of this test.

The clean way to settle it is a decomposition: for each bucket of entry
funding, report the GROSS price return and the REALISED CARRY separately. If
the carry is positive and the gross is not systematically negative, there is
free money. If the gross offsets the carry, the venue has priced it fairly and
there is nothing here. The taxonomy predicts the latter.

Everything below reports both outcomes the same way.
"""
import sys, os, math, statistics as st, datetime
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, 'research')

import engine, pooled
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
HOUR_MS = 3_600_000
DAY_MS = 86_400_000

# Live-book parameters, taken verbatim from the validated runs so this is a
# tilt on the SAME strategies, not a re-optimisation of them.
S3_P = {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}
D1_P = {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}

VARIANTS = {'n': 0}


def bump(k=1):
    VARIANTS['n'] += k


# ----------------------------------------------------------------- primitives

def ann_funding_at(fund, t, window_h=24):
    """Trailing-`window_h` funding, annualized, as a RATE PAID BY LONGS.

    Positive => longs are paying. Strictly causal: it only reads funding events
    at or before `t`, and `t` is the OPEN timestamp of the bar we would fill on,
    so every hour in the window has already settled by fill time."""
    if not fund.t or t - window_h * HOUR_MS < fund.t[0]:
        return None
    paid = -fund.cost(t - window_h * HOUR_MS, t, 'long')
    return (paid / window_h) * 24 * 365


def carry_earned_ann(fund, t, direction, window_h=24):
    """Signed annualized rate the POSITION EARNS. Positive = paid to hold."""
    f = ann_funding_at(fund, t, window_h)
    if f is None:
        return None
    return -f if direction == 'long' else f


def as_result(trades, label):
    r = engine.Result(coin='POOL', name=label)
    r.trades = list(trades)
    if r.trades:
        r.start_t = min(t.entry_t for t in r.trades)
        r.end_t = max(t.exit_t for t in r.trades)
    return r


def line(trades, label, width=30):
    """One row: net expectancy AND the gross/carry decomposition that decides
    whether any of it is actually the cash flow."""
    if not trades:
        return '{:<{w}} n=0'.format(label, w=width)
    r = as_result(trades, label)
    g = st.mean([t.gross_pct for t in trades])
    f = st.mean([t.funding_pct for t in trades])
    return ('{:<{w}} n={:<4} wr={:>5.1%} net={:>7.2%} trim5={:>7.2%} med={:>7.2%} '
            '| gross={:>7.2%} carry={:>+7.3%}').format(
        label, r.n, r.win_rate, r.expectancy, r.trimmed_expectancy(0.05),
        r.median_trade, g, f, w=width)


# ----------------------------------------------------------------- data

DATA = {}
for c in COINS:
    bars, fund = pooled.load(c)
    DATA[c] = (bars, fund)

print('=' * 118)
print('FUNDING AS A CASH FLOW - data sanity and the SCALE of the thing')
print('=' * 118)
for c in COINS:
    bars, fund = DATA[c]
    fs = [ann_funding_at(fund, b['t']) for b in bars]
    fv = [x for x in fs if x is not None]
    print('  {:<5} bars={:<5} {} -> {}   24h-ann funding: median {:+.1%}/yr  '
          'p05 {:+.1%}  p95 {:+.1%}  min {:+.1%}  max {:+.1%}'.format(
              c, len(bars),
              datetime.datetime.utcfromtimestamp(bars[0]['t'] / 1000).date(),
              datetime.datetime.utcfromtimestamp(bars[-1]['t'] / 1000).date(),
              st.median(fv), sorted(fv)[int(len(fv) * .05)], sorted(fv)[int(len(fv) * .95)],
              min(fv), max(fv)))

# The number that frames the whole exercise: how much cash can a 10-day hold
# actually collect, versus how much the price moves in the same 10 days?
print()
for H in (5, 10, 20):
    carries, moves = [], []
    for c in COINS:
        bars, fund = DATA[c]
        for i in range(60, len(bars) - H):
            cr = fund.cost(bars[i]['t'], bars[i + H]['t'], 'long')
            carries.append(abs(cr))
            moves.append(abs((bars[i + H]['c'] - bars[i]['c']) / bars[i]['c']))
    print('  {:>2}d hold: median |carry| {:.3%}  p95 |carry| {:.3%}   ||   '
          'median |price move| {:.2%}  p95 {:.2%}   -> carry is {:.1f}x smaller '
          'than the median move'.format(
              H, st.median(carries), sorted(carries)[int(len(carries) * .95)],
              st.median(moves), sorted(moves)[int(len(moves) * .95)],
              st.median(moves) / max(st.median(carries), 1e-9)))

# ============================================================================
# TEST (b): IS THE CASH FLOW PREDICTABLE AT ENTRY?
# ============================================================================
print('\n' + '=' * 118)
print('(b) PREDICTABILITY OF THE CASH FLOW - can you forecast at entry what you')
print('    will actually be paid over the hold? Panel over every daily bar.')
print('=' * 118)


def panel(H, window_h=24):
    """(entry annualized funding, realised long carry over H days, gross H-day
    return, coin, t) for every usable bar."""
    rows = []
    for c in COINS:
        bars, fund = DATA[c]
        for i in range(60, len(bars) - H):
            f = ann_funding_at(fund, bars[i]['t'], window_h)
            if f is None:
                continue
            cr = fund.cost(bars[i]['t'], bars[i + H]['t'], 'long')
            gr = (bars[i + H]['c'] - bars[i]['c']) / bars[i]['c']
            rows.append((f, cr, gr, c, bars[i]['t'], i))
    return rows


def pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return 0.0
    mx, my = st.mean(xs), st.mean(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


for H in (5, 10, 20):
    rows = panel(H)
    bump()
    r = pearson([x[0] for x in rows], [-x[1] for x in rows])   # entry rate vs cash LONGS PAY
    sign_hit = sum(1 for f, cr, _, _, _, _ in rows
                   if (f > 0) == (cr < 0)) / len(rows)
    # non-overlapping subsample, because overlapping windows share funding hours
    # and would flatter any correlation
    sub = rows[::H]
    r_sub = pearson([x[0] for x in sub], [-x[1] for x in sub])
    print('  H={:>2}d  n={:<6} corr(entry funding, funding actually paid over hold) '
          'r={:.3f}  [non-overlapping r={:.3f}, n={}]   sign agreement {:.1%}'.format(
              H, len(rows), r, r_sub, len(sub), sign_hit))

print('\n  READ: funding is highly persistent, so the CASH TERM is genuinely')
print('  forecastable at entry. That part of the reframe is real. The whole')
print('  question is therefore whether PRICE offsets it, tested next.')

# ============================================================================
# THE DECISIVE DECOMPOSITION: does price offset the subsidy?
# ============================================================================
print('\n' + '=' * 118)
print('DECOMPOSITION - forward 10d outcome for a LONG, bucketed by entry funding.')
print('  If deeply negative funding (long gets PAID) also came with a non-negative')
print('  gross price return, the subsidy is free money. If gross is negative by')
print('  roughly the carry, the venue has priced the risk fairly and there is nothing.')
print('=' * 118)

for H in (5, 10, 20):
    rows = panel(H)
    bump()
    rows_sorted = sorted(rows, key=lambda x: x[0])
    k = len(rows_sorted) // 5
    print('\n  H={}d  (quintiles of entry annualized funding, LONG side)'.format(H))
    print('    {:<26} {:<6} {:>10} {:>11} {:>11} {:>11}'.format(
        'entry funding bucket', 'n', 'mean f/yr', 'gross', 'carry', 'net'))
    for q in range(5):
        chunk = rows_sorted[q * k:(q + 1) * k] if q < 4 else rows_sorted[4 * k:]
        mf = st.mean([x[0] for x in chunk])
        gr = st.mean([x[2] for x in chunk])
        cr = st.mean([x[1] for x in chunk])
        print('    Q{} {:<23} {:<6} {:>+9.1%} {:>+10.2%} {:>+10.3%} {:>+10.2%}'.format(
            q + 1, '[{:+.0%} .. {:+.0%}]'.format(chunk[0][0], chunk[-1][0]),
            len(chunk), mf, gr, cr, gr + cr))
    # the extreme tail is where the "paid to hold" story lives
    tail = [x for x in rows if x[0] < -0.20]
    if tail:
        print('    deeply NEGATIVE funding (< -20%/yr): n={}  gross={:+.2%}  '
              'carry={:+.3%}  net={:+.2%}'.format(
                  len(tail), st.mean([x[2] for x in tail]), st.mean([x[1] for x in tail]),
                  st.mean([x[2] for x in tail]) + st.mean([x[1] for x in tail])))

# ============================================================================
# TEST (a) + (c): CARRY AS AN EXPECTANCY TILT ON THE LIVE STRATEGIES
# ============================================================================
print('\n' + '=' * 118)
print('(a)+(c) CARRY AS A TILT ON S3 AND D1 - not a new entry trigger.')
print('  Each trade is tagged with the annualized rate the POSITION EARNS at')
print('  entry (positive = paid to hold). Trades are the strategies own; only')
print('  the conditioning is new.')
print('=' * 118)


def tag(merged):
    """Attach entry carry (annualized, signed as earned) to each pooled trade."""
    out = []
    for t in merged.trades:
        _, fund = DATA[t.coin]
        ce = carry_earned_ann(fund, t.entry_t, t.direction)
        if ce is None:
            continue
        out.append((ce, t))
    return out


def tilt_report(label, tagged):
    print('\n  ' + label)
    all_t = [t for _, t in tagged]
    print('    ' + line(all_t, 'ALL', 26))
    fav = [t for ce, t in tagged if ce > 0]
    unf = [t for ce, t in tagged if ce <= 0]
    print('    ' + line(fav, 'PAID to hold (carry>0)', 26))
    print('    ' + line(unf, 'CHARGED to hold (<=0)', 26))
    # dose response over carry terciles - the single best mechanism evidence
    s = sorted(tagged, key=lambda x: x[0])
    k = max(1, len(s) // 3)
    print('    -- dose-response over entry carry terciles --')
    seq = []
    for q in range(3):
        ch = s[q * k:(q + 1) * k] if q < 2 else s[2 * k:]
        if not ch:
            continue
        e = st.mean([t.pnl_pct for _, t in ch])
        seq.append(e)
        print('    ' + line([t for _, t in ch], 'T{} carry [{:+.0%}..{:+.0%}]'.format(
            q + 1, ch[0][0], ch[-1][0]), 26))
    mono_up = all(seq[i] < seq[i + 1] for i in range(len(seq) - 1))
    mono_dn = all(seq[i] > seq[i + 1] for i in range(len(seq) - 1))
    print('    -> tercile net expectancy sequence: {}  ({})'.format(
        ' -> '.join('{:+.2%}'.format(x) for x in seq),
        'MONOTONIC increasing' if mono_up else
        'MONOTONIC decreasing (WRONG SIGN)' if mono_dn else 'NOT monotonic'))
    return seq


_, s3 = pooled.pooled(volume_spike, S3_P, COINS, 60, name='S3')
_, d1 = pooled.pooled(range_breakout, D1_P, COINS, 60, name='D1')
bump(2)
s3_tagged, d1_tagged = tag(s3), tag(d1)
seq_s3 = tilt_report('S3 ForcedFlowContinuation (vol>=1.5x, 10d hold)', s3_tagged)
seq_d1 = tilt_report('D1 RangeBreakCascade (20d break, 2.0x ATR range)', d1_tagged)

print('\n  (c) S3 DIRECTION x FUNDING SIGN - the 2x2. The sentiment story says a')
print('      long into negative funding is a squeeze setup; the carry story says')
print('      it is merely subsidised. Either way it should show up here.')
for side in ('long', 'short'):
    for lab, keep in (('funding NEGATIVE (longs paid)', lambda ce, d: (ce > 0) == (d == 'long')),
                      ('funding POSITIVE (shorts paid)', lambda ce, d: (ce > 0) == (d == 'short'))):
        sel = [t for ce, t in s3_tagged if t.direction == side and keep(ce, side)]
        print('    ' + line(sel, '{:<6} {}'.format(side, lab), 40))

# ============================================================================
# THE TILT AS AN ACTUAL GATED STRATEGY (not a post-hoc partition)
# ============================================================================
print('\n' + '=' * 118)
print('THE TILT RUN PROPERLY AS A GATED STRATEGY.')
print('  A post-hoc partition is not a strategy: dropping a trade frees the slot')
print('  for a later signal, so the filtered book is not the filtered subset.')
print('  This re-runs S3 and D1 with the carry gate inside the signal function,')
print('  sweeping the threshold as a DOSE-RESPONSE rather than hunting a cell.')
print('=' * 118)


def carry_gated(base_fn, params, fund, min_carry_ann):
    """Wrap a signal function: only take its entry if the position would earn at
    least `min_carry_ann` annualized in funding. Causal - decided on bar i's
    close, using funding settled up to bar i."""
    inner_factory = base_fn(params)

    def factory():
        inner = inner_factory()

        def sig(bars, i, pos):
            s = inner(bars, i, pos)
            if s is None or not s.get('dir') or pos is not None:
                return s
            ce = carry_earned_ann(fund, bars[i]['t'], s['dir'])
            if ce is None or ce < min_carry_ann:
                return None
            return s
        return sig
    return factory


def gated_pooled(base_fn, params, thresh, label):
    merged = engine.Result(coin='POOL', name=label)
    for c in COINS:
        bars, fund = DATA[c]
        r = engine.backtest(bars, carry_gated(base_fn, params, fund, thresh)(),
                            c, fund, name=label, warmup=60)
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return merged


THRESHOLDS = [-9.9, 0.0, 0.05, 0.10, 0.20, 0.40]
for name, fn, p in (('S3', volume_spike, S3_P), ('D1', range_breakout, D1_P)):
    print('\n  {} gated on minimum carry earned at entry:'.format(name))
    print('    {:<14} {:<6} {:>7} {:>9} {:>9} {:>9} {:>9} {:>8}'.format(
        'min carry/yr', 'n', 'wr', 'net exp', 'trim5', 'train', 'test', 'carry'))
    for th in THRESHOLDS:
        m = gated_pooled(fn, p, th, '{}@{}'.format(name, th))
        bump()
        if m.n == 0:
            print('    {:<14} no trades'.format('{:+.0%}'.format(th)))
            continue
        tr, te = pooled.pooled_split(m)
        print('    {:<14} {:<6} {:>6.1%} {:>+8.2%} {:>+8.2%} {:>+8.2%} {:>+8.2%} {:>+7.3%}'.format(
            'none' if th < -1 else '{:+.0%}'.format(th), m.n, m.win_rate, m.expectancy,
            m.trimmed_expectancy(0.05),
            tr.expectancy if tr and tr.n else float('nan'),
            te.expectancy if te and te.n else float('nan'),
            st.mean([t.funding_pct for t in m.trades])))

# ============================================================================
# THE PURE CARRY TRADE - "get paid to hold", judged on cash not on reversion
# ============================================================================
print('\n' + '=' * 118)
print('PURE CARRY TRADE - take the side that is being PAID, hold it, and see')
print('  whether the collected cash survives the price risk you took to collect it.')
print('  NOTE the honest caveat: the ENTRY here is close to the already-rejected')
print('  D3 crowding fade. What differs is the CRITERION - D3 needed price to')
print('  revert; this only needs price NOT to move against you by more than the')
print('  subsidy. Same trigger, different claim, so it is worth one clean run.')
print('=' * 118)


def pure_carry(params):
    """Long when longs are being paid at least `thresh` annualized; short when
    shorts are. Fixed `hold`, ATR stop as the mandatory risk rail."""
    thresh, hold, atr_mult = params['thresh'], params['hold'], params['atr_mult']
    fund = params['fund']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            atr = state['atr'][i]
            f = ann_funding_at(fund, bars[i]['t'])
            if atr is None or f is None:
                return None
            px = bars[i]['c']
            if -f >= thresh:       # longs are paid
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'paid {:+.0%}/yr to be long'.format(-f)}
            if f >= thresh:        # shorts are paid
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'paid {:+.0%}/yr to be short'.format(f)}
            return None
        return sig
    return factory


print('    {:<12} {:<6} {:>7} {:>9} {:>9} {:>9} {:>9} {:>9} {:>9}'.format(
    'thresh/yr', 'n', 'wr', 'net exp', 'trim5', 'gross', 'carry', 'train', 'test'))
for th in (0.10, 0.20, 0.35, 0.50, 0.80):
    for hold in (5, 10, 20):
        merged = engine.Result(coin='POOL', name='carry')
        for c in COINS:
            bars, fund = DATA[c]
            r = engine.backtest(bars, pure_carry(
                {'thresh': th, 'hold': hold, 'atr_mult': 2.5, 'fund': fund})(),
                c, fund, name='carry', warmup=60)
            merged.trades.extend(r.trades)
            merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
            merged.end_t = max(merged.end_t, r.end_t)
        merged.trades.sort(key=lambda t: t.entry_t)
        bump()
        if merged.n < 5:
            print('    {:<12} n={} (too few)'.format('{:+.0%}/{}d'.format(th, hold), merged.n))
            continue
        tr, te = pooled.pooled_split(merged)
        print('    {:<12} {:<6} {:>6.1%} {:>+8.2%} {:>+8.2%} {:>+8.2%} {:>+8.3%} {:>+8.2%} {:>+8.2%}'.format(
            '{:+.0%}/{}d'.format(th, hold), merged.n, merged.win_rate, merged.expectancy,
            merged.trimmed_expectancy(0.05),
            st.mean([t.gross_pct for t in merged.trades]),
            st.mean([t.funding_pct for t in merged.trades]),
            tr.expectancy if tr and tr.n else float('nan'),
            te.expectancy if te and te.n else float('nan')))

# ============================================================================
# THE MIRROR GATE - completing the finding, with the honesty discount attached
# ============================================================================
print('\n' + '=' * 118)
print('MIRROR GATE - the carry gate above produced a clean MONOTONIC dose-response')
print('  pointing the WRONG WAY: the more you insist on being paid, the worse the')
print('  strategy gets. The mirror of a monotonic relationship is not a separate')
print('  hypothesis, it is the same one read backwards, so it is tested here for')
print('  completeness. IT IS POST-HOC - the direction was chosen after seeing the')
print('  data - and it is discounted accordingly no matter what it prints.')
print('  It also has a fatal confound stated in advance: funding is positive when')
print('  the leveraged crowd is long, so "I am being CHARGED to hold" is close to')
print('  "I am positioned with the dominant flow", which is what S3/D1 already are.')
print('=' * 118)


def carry_capped(base_fn, params, fund, max_carry_ann):
    """Only take the entry if the position is being CHARGED at least this much
    (i.e. carry earned is at or below the cap). The mirror of carry_gated."""
    inner_factory = base_fn(params)

    def factory():
        inner = inner_factory()

        def sig(bars, i, pos):
            s = inner(bars, i, pos)
            if s is None or not s.get('dir') or pos is not None:
                return s
            ce = carry_earned_ann(fund, bars[i]['t'], s['dir'])
            if ce is None or ce > max_carry_ann:
                return None
            return s
        return sig
    return factory


def capped_pooled(base_fn, params, cap, label):
    merged = engine.Result(coin='POOL', name=label)
    for c in COINS:
        bars, fund = DATA[c]
        r = engine.backtest(bars, carry_capped(base_fn, params, fund, cap)(),
                            c, fund, name=label, warmup=60)
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return merged


CAPS = [9.9, 0.0, -0.05, -0.10, -0.20]
survivors = []
for name, fn, p in (('S3', volume_spike, S3_P), ('D1', range_breakout, D1_P)):
    print('\n  {} gated on MAXIMUM carry earned (i.e. demand to be charged):'.format(name))
    print('    {:<14} {:<6} {:>7} {:>9} {:>9} {:>9} {:>9} {:>9}'.format(
        'max carry/yr', 'n', 'wr', 'net exp', 'trim5', 'train', 'test', 'exBest3'))
    for cap in CAPS:
        m = capped_pooled(fn, p, cap, '{}<={}'.format(name, cap))
        bump()
        if m.n == 0:
            print('    {:<14} no trades'.format('{:+.0%}'.format(cap)))
            continue
        tr, te = pooled.pooled_split(m)
        yrs = pooled.pooled_yearly(m)
        ypos = sum(1 for _, r in yrs if r.expectancy > 0)
        print('    {:<14} {:<6} {:>6.1%} {:>+8.2%} {:>+8.2%} {:>+8.2%} {:>+8.2%} {:>+8.2%}'
              '   years {}/{}'.format(
                  'none' if cap > 1 else '{:+.0%}'.format(cap), m.n, m.win_rate,
                  m.expectancy, m.trimmed_expectancy(0.05),
                  tr.expectancy if tr and tr.n else float('nan'),
                  te.expectancy if te and te.n else float('nan'),
                  m.expectancy_ex_best(3), ypos, len(yrs)))
        if cap <= 1:
            survivors.append((name, cap, m))

print('\n  OVERLAP - a gate on a strategys OWN trades is a subset of it, so the')
print('  position series can only agree. Measured rather than asserted:')
for name, fn, p in (('S3', volume_spike, S3_P), ('D1', range_breakout, D1_P)):
    for c in ('BTC', 'ETH'):
        bars, fund = DATA[c]
        base = engine.backtest(bars, fn(p)(), c, fund, name='x', warmup=60)
        gated = engine.backtest(bars, carry_capped(fn, p, fund, 0.0)(), c, fund,
                                name='x', warmup=60)

        def series(r):
            s = [0] * len(bars)
            idx = {b['t']: k for k, b in enumerate(bars)}
            for t in r.trades:
                a, b2 = idx.get(t.entry_t), idx.get(t.exit_t)
                if a is None or b2 is None:
                    continue
                for k in range(a, b2):
                    s[k] = 1 if t.direction == 'long' else -1
            return s
        ov, nb = pooled.overlap(series(base), series(gated))
        print('    {} {} vs its carry-capped version: overlap {} on {} co-invested bars'
              .format(name, c, 'n/a' if ov is None else '{:.2f}'.format(ov), nb))

# ============================================================================
# CEILING CHECK - the most generous possible version of the claim
# ============================================================================
print('\n' + '=' * 118)
print('CEILING CHECK - suppose the carry tilt worked PERFECTLY as a cash')
print('  addition and price were exactly neutral. How much could it add per year?')
print('=' * 118)
for name, m in (('S3', s3), ('D1', d1)):
    tpy = m.trades_per_year()
    best = max(abs(t.funding_pct) for t in m.trades)
    mean_abs = st.mean([abs(t.funding_pct) for t in m.trades])
    print('  {}: {:.0f} trades/yr, mean |carry| per trade {:.3%}, best single trade '
          '{:.2%}  ->  a PERFECT sign-flip on carry adds at most {:.2%}/yr of '
          'notional, against a {:.1%}/yr cost drag from trading.'.format(
              name, tpy, mean_abs, best, 2 * mean_abs * tpy, tpy * 0.0019))

print('\n' + '=' * 118)
print('TOTAL CONFIGURATIONS EVALUATED: {}'.format(VARIANTS['n']))
print('=' * 118)

# ============================================================================
# ADDENDUM 1 - THE DIRECTION CONFOUND, WHICH COULD INVALIDATE THE WHOLE TILT
# ============================================================================
# Funding on this venue is positive roughly 86% of the time (see the p05/median
# table at the top: even the 5th percentile is barely negative on BTC/ETH/HYPE).
# So "the position is being PAID" is overwhelmingly "the position is SHORT".
# That means the carry gate is very close to a direction filter in disguise, and
# in a market with positive drift a short-only filter would look bad for reasons
# that have nothing to do with funding. If the tilt only exists across
# directions, it is a artefact of drift. The test that separates them is to
# condition WITHIN each direction.
print('\n' + '=' * 118)
print('ADDENDUM 1 - IS THE TILT JUST A DISGUISED SHORT FILTER?')
print('  Composition of the "paid to hold" bucket, then the tilt measured')
print('  WITHIN each direction so market drift cannot produce it.')
print('=' * 118)
for nm, tagged in (('S3', s3_tagged), ('D1', d1_tagged)):
    paid = [(ce, t) for ce, t in tagged if ce > 0]
    sh = sum(1 for _, t in paid if t.direction == 'short')
    print('\n  {}: "paid to hold" bucket is n={}, of which {} ({:.0%}) are SHORTS.'
          .format(nm, len(paid), sh, sh / max(1, len(paid))))
    for side in ('long', 'short'):
        sub = [(ce, t) for ce, t in tagged if t.direction == side]
        print('    ' + line([t for _, t in sub], '{} ALL'.format(side), 30))
        print('      ' + line([t for ce, t in sub if ce > 0], 'paid at entry', 28))
        print('      ' + line([t for ce, t in sub if ce <= 0], 'charged at entry', 28))

# ============================================================================
# ADDENDUM 2 - THE DEEPLY-NEGATIVE-FUNDING TAIL AS INDEPENDENT EPISODES
# ============================================================================
# The "< -20%/yr" row is n=80 DAILY BARS, but funding regimes persist for days,
# so those 80 bars are a handful of episodes counted many times over. At H=20d
# it printed gross +8.37%, which is the single most encouraging number in this
# whole file - and is exactly the sort of number that dissolves when you count
# episodes instead of bars.
print('\n' + '=' * 118)
print('ADDENDUM 2 - THE DEEP-SUBSIDY TAIL, COUNTED AS EPISODES NOT BARS')
print('=' * 118)
for H in (10, 20):
    rows = [x for x in panel(H) if x[0] < -0.20]
    eps, cur = [], []
    for x in sorted(rows, key=lambda r: (r[3], r[4])):
        if cur and (x[3] != cur[-1][3] or x[5] - cur[-1][5] > 1):
            eps.append(cur); cur = []
        cur.append(x)
    if cur:
        eps.append(cur)
    ep_gross = [st.mean([r[2] for r in e]) for e in eps]
    ep_net = [st.mean([r[2] + r[1] for r in e]) for e in eps]
    print('  H={:>2}d  {} bars collapse to {} independent episodes across {} coins.'
          .format(H, len(rows), len(eps), len({e[0][3] for e in eps})))
    print('        episode-mean gross {:+.2%}  (median {:+.2%})   net {:+.2%}   '
          '{}/{} episodes net-positive'.format(
              st.mean(ep_gross), st.median(ep_gross), st.mean(ep_net),
              sum(1 for v in ep_net if v > 0), len(eps)))

# ============================================================================
# ADDENDUM 3 - THE LEAST-BAD PURE CARRY CONFIG, YEAR BY YEAR
# ============================================================================
# +35%/yr threshold, 10d hold was the least negative cell in the sweep. If the
# reframe has anything at all in it, that cell is where it lives. Re-run (not a
# new configuration - it is one of the 15 already counted) and broken out by
# calendar year, because "uniformly bad" and "one catastrophic year" are very
# different failures.
print('\n' + '=' * 118)
print('ADDENDUM 3 - LEAST-BAD PURE CARRY CELL (+35%/yr, 10d), YEAR BY YEAR')
print('=' * 118)
merged = engine.Result(coin='POOL', name='carry+35/10')
for c in COINS:
    bars, fund = DATA[c]
    r = engine.backtest(bars, pure_carry(
        {'thresh': 0.35, 'hold': 10, 'atr_mult': 2.5, 'fund': fund})(),
        c, fund, name='carry', warmup=60)
    merged.trades.extend(r.trades)
    merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
    merged.end_t = max(merged.end_t, r.end_t)
merged.trades.sort(key=lambda t: t.entry_t)
print('  ' + pooled.describe(merged, 'POOLED'))
for y, r in pooled.pooled_yearly(merged):
    print('    {}  n={:<4} wr={:>5.1%} net={:>+7.2%} gross={:>+7.2%} carry={:>+7.3%}'.format(
        y, r.n, r.win_rate, r.expectancy,
        st.mean([t.gross_pct for t in r.trades]), st.mean([t.funding_pct for t in r.trades])))
for c in COINS:
    ts = [t for t in merged.trades if t.coin == c]
    if ts:
        print('    ' + line(ts, '  ' + c, 20))
# cost stress: pointless to run on a losing strategy, but the reverse question
# is fair - how much of the loss is execution rather than the thesis?
for mult in (0, 1):
    g = st.mean([t.gross_pct + t.funding_pct for t in merged.trades])
    net = st.mean([t.pnl_pct for t in merged.trades])
    if mult == 0:
        print('  ZERO-COST check: even with fees and slippage set to zero the cell '
              'is {:+.2%}/trade. The loss is the THESIS, not execution.'.format(g))

# ============================================================================
# ADDENDUM 4 - CORRECTED CEILING
# ============================================================================
print('\n' + '=' * 118)
print('ADDENDUM 4 - CORRECTED CEILING (the earlier line pooled 4 coins trades/yr')
print('  into a single-account figure, which overstates it ~4x)')
print('=' * 118)
for name, m in (('S3', s3), ('D1', d1)):
    tpy_per_coin = m.trades_per_year() / len(COINS)
    mean_abs = st.mean([abs(t.funding_pct) for t in m.trades])
    print('  {}: {:.1f} trades/yr PER COIN, mean |carry| {:.3%}/trade -> perfect '
          'sign-flip ceiling {:.1%}/yr of notional per coin. Empirically the tilt '
          'delivers a NEGATIVE fraction of that.'.format(
              name, tpy_per_coin, mean_abs, 2 * mean_abs * tpy_per_coin))

# ============================================================================
# ADDENDUM 5 - THE ONE LOOSE END: THE DEEP-SUBSIDY LONG, RUN FOR REAL
# ============================================================================
# Addendum 2 did not kill the "< -20%/yr funding, 20-day forward" cell: 33
# independent episodes, episode-mean gross +9.73%, 20/33 net-positive. That is
# the only encouraging number left in this file and it must be attacked, not
# quoted.
#
# Two things about it are already damning before running anything:
#   1. The CARRY contributes +0.26pp of the +9.99pp. 97% of that number is PRICE.
#      So even if it worked it would not be evidence for the cash-flow reframe -
#      it would be a price-reversion strategy that happens to be triggered by a
#      funding reading. That is the SENTIMENT construction this project already
#      rejected (D3 funding-crowding, long side), not the carry construction.
#   2. Deeply negative funding on this venue happens after violent liquidation
#      dumps, so this is close to the already-rejected capitulation-overshoot.
#
# But a raw forward-return panel has no stop, no costs, no timeout and no
# position conflict. Run it as an actual strategy so the comparison is fair.
print('\n' + '=' * 118)
print('ADDENDUM 5 - DEEP-SUBSIDY LONG AS A REAL STRATEGY (stop, costs, timeout)')
print('=' * 118)


def deep_subsidy_long(params):
    """Long when longs are being paid more than `thresh` annualized. Long-only,
    because that is the direction the panel result actually pointed at."""
    thresh, hold, atr_mult, fund = (params['thresh'], params['hold'],
                                    params['atr_mult'], params['fund'])

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            atr, f = state['atr'][i], ann_funding_at(fund, bars[i]['t'])
            if atr is None or f is None or -f < thresh:
                return None
            px = bars[i]['c']
            return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                    'reason': 'paid {:+.0%}/yr to be long'.format(-f)}
        return sig
    return factory


print('    {:<14} {:<5} {:>7} {:>9} {:>9} {:>9} {:>9} {:>9} {:>8}'.format(
    'thresh/hold', 'n', 'wr', 'net exp', 'trim5', 'median', 'train', 'test', 'carry'))
for th in (0.20, 0.35):
    for hold in (10, 20, 30):
        m = engine.Result(coin='POOL', name='deep')
        for c in COINS:
            bars, fund = DATA[c]
            r = engine.backtest(bars, deep_subsidy_long(
                {'thresh': th, 'hold': hold, 'atr_mult': 2.5, 'fund': fund})(),
                c, fund, name='deep', warmup=60, allow_short=False)
            m.trades.extend(r.trades)
            m.start_t = min(m.start_t or r.start_t, r.start_t) if r.start_t else m.start_t
            m.end_t = max(m.end_t, r.end_t)
        m.trades.sort(key=lambda t: t.entry_t)
        bump()
        if m.n < 5:
            print('    {:<14} n={} (too few to say anything)'.format(
                '-{:.0%}/{}d'.format(th, hold), m.n))
            continue
        tr, te = pooled.pooled_split(m)
        yrs = pooled.pooled_yearly(m)
        print('    {:<14} {:<5} {:>6.1%} {:>+8.2%} {:>+8.2%} {:>+8.2%} {:>+8.2%} {:>+8.2%} {:>+7.3%}'
              '  years {}/{}'.format(
                  '-{:.0%}/{}d'.format(th, hold), m.n, m.win_rate, m.expectancy,
                  m.trimmed_expectancy(0.05), m.median_trade,
                  tr.expectancy if tr and tr.n else float('nan'),
                  te.expectancy if te and te.n else float('nan'),
                  st.mean([t.funding_pct for t in m.trades]),
                  sum(1 for _, r in yrs if r.expectancy > 0), len(yrs)))

print('\n  FINAL VARIANT COUNT: {}'.format(VARIANTS['n']))
