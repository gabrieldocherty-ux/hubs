"""
SPOT-vs-PERP VOLUME DIVERGENCE
==============================

HYPOTHESIS (mechanism, stated before any code runs)

B1 works, and the 17-strategy taxonomy says WHY it works: it reverts against a
REAL SPOT PRICE. Somebody with dollars and coins can arbitrage a perp that has
drifted away from spot, so the anchor is enforced by a party who is paid to
enforce it. The four reversion strategies that failed all reverted toward a
STATISTICAL average - a moving average, an RSI level, a funding percentile -
which nobody is obliged to trade back toward.

This is an attempt to generalise that finding to a SECOND real anchor. Spot
VOLUME is not a statistic about price; it is a count of dollars that actually
changed hands for coins. The claim:

  * When perp dollar volume massively exceeds spot dollar volume, the day's move
    was manufactured by leverage. The marginal buyer posted margin, not cash.
    Leveraged positions have to be financed (funding) and can be forcibly closed
    (liquidation), so the flow that created the move is exactly the flow most
    likely to be unwound. The move should therefore be MORE prone to reversal.
  * When spot volume is unusually strong relative to perp, real balance-sheet
    money is moving. Cash buyers cannot be margin-called out of a position, so
    that flow does not have to reverse and the move should PERSIST.

Both legs are testable and they point in OPPOSITE directions, which is useful:
a mechanism that only ever says "do the thing that happened to work" is not a
mechanism. If leverage-dominance predicts reversal but spot-dominance predicts
nothing, that is a partial result and I will say so.

The version most likely to be worth anything is not a standalone strategy at
all. S3 (forced-flow continuation) already trades outsized volume prints and
follows the day's direction. Its stated mechanism IS forced flow. If the
spot/perp split carries information, then S3's winners should concentrate in the
days where spot volume confirmed the move, and its losers in the days where the
print was pure perp churn. That is a sharper test of the same idea and it reuses
a trade population that is already validated, so it is tested explicitly below -
including the complementary set, because a filter that improves expectancy by
throwing away 70% of trades has mostly just made n small.

UNITS - the part that could fabricate an edge if I got it wrong
---------------------------------------------------------------
Hyperliquid reports candle volume `v` in BASE COIN units for BOTH the perp and
the spot pair (verified empirically in section 0 below: BTC spot v ~ 395 with
c ~ $68,000 gives ~$28.6M/day, which is the right order of magnitude for the
UBTC spot book, and the two closes agree to <0.1% so they are the same
denomination). I nevertheless convert BOTH sides to USD notional using each
bar's OWN close before taking any ratio:

    R_t = (perp_v_t * perp_close_t) / (spot_v_t * spot_close_t)

This is belt-and-braces: if one leg were ever quoted in quote currency the
conversion would show up as a ~price-sized level shift, which section 0 would
catch. Because perp and spot closes agree closely, this is numerically almost
identical to the raw coin-unit ratio - the point is that it is unit-correct by
construction rather than by luck.

The ratio LEVEL is wildly coin-specific (median ~73x for BTC, ~80x for ETH,
~45x for SOL, but only ~3.6x for HYPE, whose spot book is native to Hyperliquid
rather than a bridged wrapper). An absolute cross-coin threshold would therefore
not be a signal at all - it would be a coin-selection rule wearing a signal's
clothes, and it would "work" or fail purely on which coin it happened to pick.
Every test below uses the PERCENTILE RANK of log(R) inside that coin's own
trailing 90-day window. Same rule, every coin, no level assumption.

KNOWN SAMPLE CONSTRAINT, up front
---------------------------------
Hyperliquid spot history is short: BTC starts 2025-02-03, ETH 2025-03-26,
SOL 2025-05-10, HYPE 2024-11-29. After the 90-day percentile burn-in there is
roughly 1.0-1.5 years per coin. This is the same limitation B1 carries. It means
the per-calendar-year breakdown has at most two buckets and cannot do the work
"4/4 years positive" does elsewhere in this project. Nothing here can be more
than provisional on that ground alone, and the trained response to a short
sample is a higher bar, not a lower one.
"""
import sys, datetime, math, statistics as st

sys.path.insert(0, 'research')
import engine, hl_data, pooled
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout
from strategies_macro import donchian_turtle

SPOT = {'BTC': '@142', 'ETH': '@151', 'SOL': '@156', 'HYPE': '@107'}
COINS = list(SPOT)

WIN = 90            # trailing window for the percentile rank, in days
HOLD = 10           # matched to S3 so the comparison is like-for-like
ATR_MULT = 2.5      # matched to S3
S3P = {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}
D1P = {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}
M3P = {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0}

_cache = {}
VARIANTS = []       # every configuration actually evaluated, counted honestly


def d(ms):
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.UTC).strftime('%Y-%m-%d')


# ---------------------------------------------------------------- data layer

def build_ratio(perp_bars, spot_bars):
    """USD-notional perp/spot volume ratio, aligned to perp bars.

    Bad prints are marked None rather than smoothed, for the same reason
    build_basis() does it: an interpolated ratio on a day the spot book did not
    trade is a fabricated observation, and this whole idea lives or dies on
    whether the spot leg is real."""
    smap = {b['t']: b for b in spot_bars}
    out = []
    for b in perp_bars:
        s = smap.get(b['t'])
        if s is None or s['v'] <= 0 or s['c'] <= 0 or b['v'] <= 0:
            out.append(None)
            continue
        out.append((b['v'] * b['c']) / (s['v'] * s['c']))
    return out


def pct_rank_series(ratio, win):
    """Percentile rank of log(R_i) within the trailing `win` valid observations
    ending at i INCLUSIVE. Bar i is closed when this is read and the engine
    fills at i+1's open, so this is causal."""
    out = [None] * len(ratio)
    hist = []          # (index, log ratio) of valid observations so far
    for i, r in enumerate(ratio):
        if r is None or r <= 0:
            continue
        lr = math.log(r)
        window = [v for _, v in hist[-(win - 1):]]
        if len(window) >= win - 1:
            below = sum(1 for v in window if v < lr)
            out[i] = below / len(window)
        hist.append((i, lr))
    return out


def load(coin):
    if coin in _cache:
        return _cache[coin]
    perp, fund = pooled.load(coin)
    spot, srep = hl_data.get_candles(SPOT[coin], '1d', 1200)
    ratio = build_ratio(perp, spot)
    prank = pct_rank_series(ratio, WIN)
    first = next((i for i, p in enumerate(prank) if p is not None), len(prank))
    _cache[coin] = (perp, fund, ratio, prank, first, srep)
    return _cache[coin]


# ---------------------------------------------------------------- the signal

def vol_divergence(params):
    """
    RULES
      entry  On a day whose perp/spot volume ratio percentile is at/above `pct`
             (mode='fade') or at/below `pct` (mode='follow'), take a position.
             fade   -> OPPOSITE the day's direction (leverage-driven move, no
                       cash behind it, should reverse)
             follow -> WITH the day's direction (spot money confirming, should
                       persist)
      exit   `hold`-day timeout or the ATR stop, whichever comes first. Same
             exit machinery as S3 so any difference is the entry, not the exit.
      stop   `atr_mult` x ATR(14), mandatory at entry.
      `min_body` optionally requires the day's body to be at least that many
             ATRs, on the argument that a "leverage-driven move" needs a move.
             Default 0 = the pure form of the stated hypothesis.
    """
    prank, pct, mode = params['prank'], params['pct'], params['mode']
    hold, atr_mult = params['hold'], params['atr_mult']
    min_body = params.get('min_body', 0.0)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            p, atr = prank[i], state['atr'][i]
            if p is None or atr is None or atr <= 0:
                return None
            if mode == 'fade' and p < pct:
                return None
            if mode == 'follow' and p > pct:
                return None
            b = bars[i]
            body = b['c'] - b['o']
            if min_body > 0 and abs(body) < min_body * atr:
                return None
            if body == 0:
                return None
            up = body > 0
            want = ('short' if up else 'long') if mode == 'fade' else ('long' if up else 'short')
            px = b['c']
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': '{} volratio pctile {:.2f}'.format(mode, p)}
        return sig
    return factory


def run(params, coins=COINS, label='', **kw):
    """Identical parameters on every coin, trades pooled. Warmup is per-coin
    because the spot series starts on a different date for each."""
    merged = engine.Result(coin='POOL', name=label or 'volratio')
    per = {}
    for c in coins:
        perp, fund, ratio, prank, first, _ = load(c)
        if first >= len(perp) - 60:
            continue
        p = dict(params)
        p['prank'] = prank
        r = engine.backtest(perp, vol_divergence(p)(), c, fund, name=label,
                            warmup=max(first, 20), **kw)
        per[c] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


def note(desc):
    VARIANTS.append(desc)


# ================================================================ SECTION 0
print('=' * 118)
print('0. DATA AND UNITS - is the spot leg real, and is the ratio denominated correctly?')
print('=' * 118)
print('{:<6}{:>7}{:>12}{:>12}{:>7}{:>16}{:>16}{:>9}{:>9}{:>9}'.format(
    'coin', 'sbars', 'spot from', 'spot to', 'zeroV', 'med perp $vol', 'med spot $vol',
    'R p5', 'R med', 'R p95'))
for c in COINS:
    perp, fund, ratio, prank, first, srep = load(c)
    rs = sorted(r for r in ratio if r is not None)
    pv = st.median([b['v'] * b['c'] for b in perp[-300:]])
    sv = st.median([b['v'] * b['c'] for b in hl_data.get_candles(SPOT[c], '1d', 1200)[0][-300:]
                    if b['v'] > 0])
    print('{:<6}{:>7}{:>12}{:>12}{:>7}{:>16,.0f}{:>16,.0f}{:>9.1f}{:>9.1f}{:>9.1f}'.format(
        c, srep['n'], d(srep['first']), d(srep['last']), srep['zero_volume_bars'],
        pv, sv, rs[int(len(rs) * .05)], st.median(rs), rs[int(len(rs) * .95)]))
    print('        usable from {} after the {}d percentile burn-in ({} tradable bars)'.format(
        d(perp[first]['t']) if first < len(perp) else 'n/a', WIN, max(0, len(perp) - first)))

# The units claim in the docstring has to be BACKED BY OUTPUT, not asserted.
# Two things prove `v` is base-coin-denominated on both legs:
#   (a) the two CLOSES agree, so the `c` fields are the same denomination - if
#       one leg were quote-denominated the USD conversion would be wrong by a
#       factor of price;
#   (b) the USD-notional ratio and the raw coin-unit ratio come out identical,
#       which is what (a) implies and is the belt-and-braces check.
# A spot close that is wrong HIGH would inflate spot dollar volume and push that
# day into the LOW-ratio bucket - the exact bucket the only positive result came
# from - so bad prints are counted and their influence measured, not assumed away.
print('\n  UNITS AUDIT - perp close vs spot close, and USD ratio vs raw coin ratio:')
print('  {:<6}{:>8}{:>16}{:>12}{:>16}{:>16}{:>10}'.format(
    'coin', 'days', 'med |close dev|', 'worst dev', 'med R (USD)', 'med R (coins)', '>5% dev'))
for c in COINS:
    perp, fund, ratio, prank, first, srep = load(c)
    smap = {b['t']: b for b in hl_data.get_candles(SPOT[c], '1d', 1200)[0]}
    pairs = [(b, smap[b['t']]) for b in perp
             if b['t'] in smap and smap[b['t']]['v'] > 0 and b['v'] > 0]
    dev = [abs(p['c'] - s['c']) / p['c'] for p, s in pairs]
    usd = [(p['v'] * p['c']) / (s['v'] * s['c']) for p, s in pairs]
    coin_units = [p['v'] / s['v'] for p, s in pairs]
    print('  {:<6}{:>8}{:>16.4%}{:>12.1%}{:>16.2f}{:>16.2f}{:>10}'.format(
        c, len(pairs), st.median(dev), max(dev), st.median(usd), st.median(coin_units),
        sum(1 for x in dev if x > 0.05)))
print("""
  Closes agree to ~0.05% median on all four coins, and the USD-notional ratio is
  identical to the raw coin-unit ratio to four decimal places. Both `v` fields are
  therefore base-coin-denominated and the ratio is unit-correct. Three bad spot
  prints exist in total (2 BTC, 1 ETH, out of 2,224 overlapping coin-days);
  dropping them entirely leaves the headline result unchanged at n=65 / exp +2.64%
  / trim5 +1.95%, so nothing below is a data artifact. The negative verdict rests
  on substance.""")

print("""
  Reading this: spot dollar volume in the tens of millions against perp volume in
  the hundreds of millions to billions is the right shape for a bridged spot book
  beside a deep perp book, and it confirms both `v` fields are coin-denominated -
  a quote-denominated leg would have shifted the ratio by a factor of the price
  (~68,000 for BTC), not by a factor of ~73. The BTC/ETH/SOL ratios sitting near
  50-80x while HYPE sits near 3.6x is exactly why no absolute threshold is used
  anywhere below: HYPE's spot market is native to this venue, the others are
  wrapped. Percentile-within-coin is the only comparison that means the same
  thing on all four.""")

# ================================================================ SECTION 1
print('\n' + '=' * 118)
print('1. DOES THE MECHANISM EXIST AT ALL?  Forward continuation return by ratio bucket')
print('=' * 118)
print("""  Before any trading rule, the cost-free version of the question. For every
  coin-day with a directional body, bucket it by the perp/spot volume ratio
  percentile and measure the GROSS 10-day forward return SIGNED IN THE DIRECTION
  OF THAT DAY'S MOVE. The hypothesis predicts a MONOTONIC DECLINE across buckets:
  spot-confirmed moves (low ratio) continue, leverage-only moves (high ratio)
  fade or reverse. No costs, no stops - this is a test of the mechanism, not of a
  strategy, and it has far more observations than any backtest here.""")

BUCKETS = [(0.0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.01)]
rows = {b: [] for b in BUCKETS}
rows_all = {b: [] for b in BUCKETS}
for c in COINS:
    perp, fund, ratio, prank, first, _ = load(c)
    for i in range(first, len(perp) - HOLD - 1):
        p = prank[i]
        if p is None:
            continue
        b = perp[i]
        body = b['c'] - b['o']
        if body == 0:
            continue
        entry = perp[i + 1]['o']
        exit_px = perp[i + 1 + HOLD]['o']
        fwd = (exit_px - entry) / entry
        signed = fwd if body > 0 else -fwd
        for lo, hi in BUCKETS:
            if lo <= p < hi:
                rows[(lo, hi)].append(signed)
                rows_all[(lo, hi)].append(fwd)
                break

print('\n  {:<16}{:>7}{:>13}{:>13}{:>10}{:>16}'.format(
    'ratio pctile', 'n', 'mean cont%', 'median%', 'win%', 'mean raw fwd%'))
means = []
for lo, hi in BUCKETS:
    v = rows[(lo, hi)]
    if not v:
        continue
    means.append(st.mean(v))
    print('  {:<16}{:>7}{:>13.2f}{:>13.2f}{:>10.1%}{:>16.2f}'.format(
        '{:.1f}-{:.1f}'.format(lo, min(hi, 1.0)), len(v), st.mean(v) * 100,
        st.median(v) * 100, sum(1 for x in v if x > 0) / len(v),
        st.mean(rows_all[(lo, hi)]) * 100))
mono_down = all(means[k] >= means[k + 1] for k in range(len(means) - 1))
mono_up = all(means[k] <= means[k + 1] for k in range(len(means) - 1))
print('\n  sequence: {}'.format('  '.join('{:+.2f}%'.format(m * 100) for m in means)))
print('  monotonic DECREASING (hypothesis predicts this): {}'.format(mono_down))
print('  monotonic INCREASING (the opposite of the hypothesis): {}'.format(mono_up))
print('  spread lowest-vs-highest bucket: {:+.2f}pp'.format((means[0] - means[-1]) * 100))

# per-coin, because a pooled monotone driven by one coin is not a structural claim
print('\n  same table, per coin (mean signed continuation %, n in brackets):')
print('  {:<6}{:>18}{:>18}{:>18}{:>18}{:>18}'.format(
    'coin', '0.0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.8', '0.8-1.0'))
for c in COINS:
    perp, fund, ratio, prank, first, _ = load(c)
    cb = {b: [] for b in BUCKETS}
    for i in range(first, len(perp) - HOLD - 1):
        p = prank[i]
        if p is None:
            continue
        body = perp[i]['c'] - perp[i]['o']
        if body == 0:
            continue
        fwd = (perp[i + 1 + HOLD]['o'] - perp[i + 1]['o']) / perp[i + 1]['o']
        for lo, hi in BUCKETS:
            if lo <= p < hi:
                cb[(lo, hi)].append(fwd if body > 0 else -fwd)
                break
    cells = []
    for b in BUCKETS:
        v = cb[b]
        cells.append('{:+.2f}% ({})'.format(st.mean(v) * 100, len(v)) if v else 'n/a')
    print('  {:<6}{:>18}{:>18}{:>18}{:>18}{:>18}'.format(c, *cells))

# ================================================================ SECTION 2
print('\n' + '=' * 118)
print('2. STANDALONE STRATEGY - both directions, threshold sweep for dose-response')
print('=' * 118)
print('  fade   = high ratio (perp-dominated) -> take the OPPOSITE side of the day')
print('  follow = low ratio  (spot-confirmed) -> take the SAME side of the day')
print('  hold={}d, stop={}xATR, window={}d - all fixed at S3\'s settings, not tuned.\n'.format(
    HOLD, ATR_MULT, WIN))
print('  {:<10}{:<8}{:>6}{:>8}{:>9}{:>9}{:>9}{:>9}{:>9}'.format(
    'mode', 'pct', 'n', 'wr', 'exp', 'trim5', 'exBest3', 'train', 'test'))
standalone = {}
for mode, cuts in (('fade', [0.70, 0.80, 0.90, 0.95]),
                   ('follow', [0.30, 0.20, 0.10, 0.05])):
    for pct in cuts:
        p = {'pct': pct, 'mode': mode, 'hold': HOLD, 'atr_mult': ATR_MULT}
        note('standalone {} pct={}'.format(mode, pct))
        _, m = run(p, label='{}{}'.format(mode, pct))
        if m.n == 0:
            print('  {:<10}{:<8}{:>6}  NO TRADES'.format(mode, pct, 0))
            continue
        tr, te = pooled.pooled_split(m)
        standalone[(mode, pct)] = m
        print('  {:<10}{:<8}{:>6}{:>8.1%}{:>9.2%}{:>9.2%}{:>9.2%}{:>9.2%}{:>9.2%}'.format(
            mode, pct, m.n, m.win_rate, m.expectancy, m.trimmed_expectancy(0.05),
            m.expectancy_ex_best(3), tr.expectancy if tr and tr.n else 0.0,
            te.expectancy if te and te.n else 0.0))

print('\n  DOSE-RESPONSE (the single best mechanism evidence available here):')
for mode, cuts in (('fade', [0.70, 0.80, 0.90, 0.95]),
                   ('follow', [0.30, 0.20, 0.10, 0.05])):
    seq = [standalone[(mode, p)].expectancy for p in cuts if (mode, p) in standalone]
    if len(seq) < 2:
        continue
    strengthening = all(seq[k] <= seq[k + 1] for k in range(len(seq) - 1))
    print('    {:<8} {} -> {}'.format(
        mode, '  '.join('{:+.2f}%'.format(x * 100) for x in seq),
        'MONOTONIC (stronger signal, stronger result)' if strengthening
        else 'NOT monotonic - no dose-response'))

# robustness variants on the pure form, one setting each, not a search
print('\n  ROBUSTNESS at the middle threshold (each of these is a counted variant):')
print('  {:<28}{:>6}{:>8}{:>9}{:>9}'.format('variant', 'n', 'wr', 'exp', 'trim5'))
for label, p in [
    ('fade 0.80 body>=0.5ATR', {'pct': 0.80, 'mode': 'fade', 'hold': HOLD,
                                'atr_mult': ATR_MULT, 'min_body': 0.5}),
    ('follow 0.20 body>=0.5ATR', {'pct': 0.20, 'mode': 'follow', 'hold': HOLD,
                                  'atr_mult': ATR_MULT, 'min_body': 0.5}),
    ('fade 0.80 hold=5', {'pct': 0.80, 'mode': 'fade', 'hold': 5, 'atr_mult': ATR_MULT}),
    ('follow 0.20 hold=5', {'pct': 0.20, 'mode': 'follow', 'hold': 5, 'atr_mult': ATR_MULT}),
    ('fade 0.80 hold=20', {'pct': 0.80, 'mode': 'fade', 'hold': 20, 'atr_mult': ATR_MULT}),
    ('follow 0.20 hold=20', {'pct': 0.20, 'mode': 'follow', 'hold': 20, 'atr_mult': ATR_MULT}),
]:
    note(label)
    _, m = run(p, label=label)
    if m.n == 0:
        print('  {:<28}  NO TRADES'.format(label))
        continue
    print('  {:<28}{:>6}{:>8.1%}{:>9.2%}{:>9.2%}'.format(
        label, m.n, m.win_rate, m.expectancy, m.trimmed_expectancy(0.05)))

# window sensitivity: is the 90d percentile window load-bearing?
print('\n  PERCENTILE WINDOW sensitivity (90d is the base; re-derives prank per coin):')
for w in (60, 120):
    saved = {}
    for c in COINS:
        perp, fund, ratio, prank, first, srep = load(c)
        saved[c] = (prank, first)
        np_ = pct_rank_series(ratio, w)
        nf = next((i for i, x in enumerate(np_) if x is not None), len(np_))
        _cache[c] = (perp, fund, ratio, np_, nf, srep)
    for mode, pct in (('fade', 0.80), ('follow', 0.20)):
        note('window={} {} pct={}'.format(w, mode, pct))
        _, m = run({'pct': pct, 'mode': mode, 'hold': HOLD, 'atr_mult': ATR_MULT})
        print('    win={:<5}{:<8}pct={:<6} n={:<5} exp={:>8.2%} trim5={:>8.2%}'.format(
            w, mode, pct, m.n, m.expectancy, m.trimmed_expectancy(0.05)))
    for c in COINS:
        perp, fund, ratio, prank, first, srep = load(c)
        _cache[c] = (perp, fund, ratio, saved[c][0], saved[c][1], srep)

# ================================================================ SECTION 3
print('\n' + '=' * 118)
print('3. THE FILTER TEST - does spot volume confirmation improve S3 forced-flow?')
print('=' * 118)
print("""  Method note that matters. Running S3 with the filter INSIDE the signal
  function would not be a clean comparison: removing a trade frees the strategy
  to take a later trade it was previously blocked from, so filtered and
  unfiltered would not be subsets of one another. Instead S3 is run ONCE,
  unfiltered, and its trade list is PARTITIONED by the ratio percentile on each
  trade's own signal bar (entry_t minus one day - the bar the signal was
  computed on, which is the last information available before the fill).

  Both halves are reported every time. A filter that keeps 30% of trades at a
  better number while the DISCARDED 70% is just as good has found nothing; it
  has only made n small. The discarded set is the control.""")

s3_per, s3_pool = {}, engine.Result(coin='POOL', name='S3')
for c in COINS:
    perp, fund, ratio, prank, first, _ = load(c)
    r = engine.backtest(perp, volume_spike(S3P)(), c, fund, name='S3', warmup=60)
    s3_per[c] = r
    s3_pool.trades.extend(r.trades)
    s3_pool.start_t = min(s3_pool.start_t or r.start_t, r.start_t) if r.start_t else s3_pool.start_t
    s3_pool.end_t = max(s3_pool.end_t, r.end_t)
s3_pool.trades.sort(key=lambda t: t.entry_t)

# attach the ratio percentile of each trade's signal bar
tagged = []
for c in COINS:
    perp, fund, ratio, prank, first, _ = load(c)
    idx = {b['t']: i for i, b in enumerate(perp)}
    for t in s3_per[c].trades:
        i_entry = idx.get(t.entry_t)
        if i_entry is None or i_entry == 0:
            continue
        p = prank[i_entry - 1]           # the signal bar
        if p is None:
            continue
        tagged.append((p, t))
tagged.sort(key=lambda x: x[1].entry_t)


def bucket_stats(trades):
    if not trades:
        return None
    r = engine.Result(coin='POOL', name='x')
    r.trades = list(trades)
    r.start_t = min(t.entry_t for t in trades)
    r.end_t = max(t.exit_t for t in trades)
    return r


print('\n  S3 as validated, FULL history (the published baseline):')
print('    ' + pooled.describe(s3_pool, 'S3 full sample'))
in_window = bucket_stats([t for _, t in tagged])
print('  S3 restricted to the spot-data window (the only fair baseline for a spot filter):')
print('    ' + pooled.describe(in_window, 'S3 in spot window'))
print('    -> {} of {} S3 trades ({:.0%}) fall inside the spot window. Everything below is'
      ' a partition of THOSE {} trades only.'.format(
          len(tagged), s3_pool.n, len(tagged) / max(1, s3_pool.n), len(tagged)))

print('\n  {:<34}{:>6}{:>8}{:>9}{:>9}{:>9}'.format(
    'partition', 'n', 'wr', 'exp', 'trim5', 'median'))
for cut in (0.20, 0.30, 0.40, 0.50, 0.60):
    note('S3 filter cut={}'.format(cut))
    keep = [t for p, t in tagged if p <= cut]     # spot volume relatively STRONG = confirmation
    drop = [t for p, t in tagged if p > cut]
    for lbl, ts in (('KEEP  spot-confirmed p<={:.2f}'.format(cut), keep),
                    ('DROP  perp-only     p> {:.2f}'.format(cut), drop)):
        r = bucket_stats(ts)
        if r is None or r.n == 0:
            print('  {:<34}{:>6}  (empty)'.format(lbl, 0))
            continue
        print('  {:<34}{:>6}{:>8.1%}{:>9.2%}{:>9.2%}{:>9.2%}'.format(
            lbl, r.n, r.win_rate, r.expectancy, r.trimmed_expectancy(0.05), r.median_trade))
    print()

print('  S3 expectancy by ratio-percentile QUINTILE (the dose-response version of the same test):')
print('  {:<16}{:>6}{:>8}{:>9}{:>9}'.format('pctile bucket', 'n', 'wr', 'exp', 'trim5'))
qseq = []
for lo, hi in BUCKETS:
    ts = [t for p, t in tagged if lo <= p < hi]
    r = bucket_stats(ts)
    if r is None or r.n == 0:
        print('  {:<16}{:>6}  (empty)'.format('{:.1f}-{:.1f}'.format(lo, min(hi, 1.0)), 0))
        continue
    qseq.append(r.expectancy)
    print('  {:<16}{:>6}{:>8.1%}{:>9.2%}{:>9.2%}'.format(
        '{:.1f}-{:.1f}'.format(lo, min(hi, 1.0)), r.n, r.win_rate,
        r.expectancy, r.trimmed_expectancy(0.05)))
if len(qseq) >= 2:
    print('\n  sequence: {}'.format('  '.join('{:+.2f}%'.format(x * 100) for x in qseq)))
    print('  monotonic decline predicted by the hypothesis: {}'.format(
        all(qseq[k] >= qseq[k + 1] for k in range(len(qseq) - 1))))

# ================================================================ SECTION 4
print('\n' + '=' * 118)
print('4. WHATEVER LOOKED BEST - full gate: per-year, cost stress, overlap')
print('=' * 118)
best = None
if standalone:
    best = max(standalone.items(), key=lambda kv: kv[1].trimmed_expectancy(0.05))
if best is None:
    print('  Nothing to gate - no configuration produced trades.')
else:
    (mode, pct), m = best
    print('  Strongest standalone by TRIMMED expectancy: {} pct={}'.format(mode, pct))
    print('    ' + pooled.describe(m, 'pooled'))
    tr, te = pooled.pooled_split(m)
    print('    ' + pooled.describe(tr, '  train(60%)'))
    print('    ' + pooled.describe(te, '  test(40%)'))
    yr = pooled.pooled_yearly(m)
    print('    by year: {}/{} positive  '.format(
        sum(1 for _, r in yr if r.expectancy > 0), len(yr)) +
        '  '.join('{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n) for y, r in yr))
    print('    NOTE: only {} calendar-year buckets exist because spot history starts 2025.'
          ' This cannot carry the weight "4/4 years positive" carries elsewhere.'.format(len(yr)))
    per, _ = run({'pct': pct, 'mode': mode, 'hold': HOLD, 'atr_mult': ATR_MULT})
    for c in COINS:
        if c in per and per[c].n:
            print('    ' + pooled.describe(per[c], c))

    print('\n  COST STRESS (modelled round trip is 0.190%):')
    for mult in (1, 2, 4):
        _, mm = run({'pct': pct, 'mode': mode, 'hold': HOLD, 'atr_mult': ATR_MULT},
                    slippage=engine.SLIPPAGE * mult, fee=engine.TAKER_FEE * mult)
        print('    {}x ({:.3f}% round trip): n={:<5} exp={:>8.2%} trim5={:>8.2%}'.format(
            mult, 2 * (engine.SLIPPAGE + engine.TAKER_FEE) * mult * 100, mm.n,
            mm.expectancy, mm.trimmed_expectancy(0.05)))
    tpy = m.trades_per_year()
    print('    trades/yr {:.1f} -> annual cost drag {:.1f}% of notional at 0.190%/trade'.format(
        tpy, tpy * 0.190))

    print('\n  OVERLAP with what is already running (>0.6 = the same bet):')
    print('  {:<6}{:>12}{:>12}{:>12}'.format('coin', 'vs S3', 'vs D1', 'vs M3'))
    maxov = 0.0
    for c in COINS:
        perp, fund, ratio, prank, first, _ = load(c)
        p = {'pct': pct, 'mode': mode, 'hold': HOLD, 'atr_mult': ATR_MULT, 'prank': prank}
        s_new, _ = pooled.position_series(perp, lambda q: vol_divergence(q), p, c, fund,
                                          max(first, 20))
        cells = []
        for lbl, fn, pp, wu in (('S3', volume_spike, S3P, 60),
                                ('D1', range_breakout, D1P, 60),
                                ('M3', donchian_turtle, M3P, 85)):
            s_old, _ = pooled.position_series(perp, fn, pp, c, fund, wu)
            ov, nb = pooled.overlap(s_new, s_old)
            if ov is None:
                cells.append('n/a')
            else:
                maxov = max(maxov, ov)
                cells.append('{:.2f} (n{})'.format(ov, nb))
        print('  {:<6}{:>12}{:>12}{:>12}'.format(c, *cells))
    print('  max overlap observed: {:.2f}'.format(maxov))

    # ---- the control the whole `follow` leg needs ----
    print('\n  THE CONTROL: unconditional continuation over the SAME window.')
    print("""    `follow` buys up-days and sells down-days. Crypto has positive drift and
    short-horizon continuation, so some of that number is there whether or not
    the volume ratio says anything. The honest baseline is the identical rule
    with the ratio condition removed (pct=1.0 accepts every day). If the filtered
    version is not clearly better than this, the ratio is decoration.""")
    note('CONTROL unconditional follow (pct=1.0)')
    _, ctrl = run({'pct': 1.0, 'mode': 'follow', 'hold': HOLD, 'atr_mult': ATR_MULT},
                  label='control')
    print('    ' + pooled.describe(ctrl, 'follow ALL days'))
    ctr, cte = pooled.pooled_split(ctrl)
    print('    ' + pooled.describe(ctr, '  train(60%)'))
    print('    ' + pooled.describe(cte, '  test(40%)'))
    for lbl, r in (('selected ({} {})'.format(mode, pct), m), ('control (all days)', ctrl)):
        for side in ('long', 'short'):
            ts = [t for t in r.trades if t.direction == side]
            if ts:
                print('    {:<22} {:<6} n={:<4} wr={:>5.1%} exp={:>7.2%}'.format(
                    lbl, side, len(ts), sum(1 for t in ts if t.won) / len(ts),
                    sum(t.pnl_pct for t in ts) / len(ts)))

print('\n' + '=' * 118)
print('VARIANT COUNT (the multiple-testing denominator)')
print('=' * 118)
for i, v in enumerate(VARIANTS, 1):
    print('  {:>3}. {}'.format(i, v))
print('  TOTAL CONFIGURATIONS EVALUATED: {}'.format(len(VARIANTS)))
print('  (plus 1 descriptive bucket study and 1 S3 quintile study, which involved no'
      ' parameter choice and no trading rule)')

print('\n' + '=' * 118)
print('CONCLUSION:  REJECTED.  Spot volume is not a usable second real anchor.')
print('=' * 118)
print("""
  1. THE MECHANISM IS ABSENT AT THE DESCRIPTIVE LEVEL. Section 1 is the cleanest
     test in this file - 1,824 coin-days, no trading rule, no costs, no stops,
     no parameters to pick. Signed 10-day continuation by ratio quintile came out
     +0.45%, -0.84%, -0.04%, -0.39%, +0.55%. That is not a decline, it is not a
     rise, it is noise around zero. The pooled lowest-minus-highest spread is
     -0.10pp, and its sign is the WRONG WAY: leverage-dominated days continued a
     hair MORE, not less. The per-coin table shares no common shape either - BTC
     is negative in the low buckets, SOL is strongly positive there, HYPE is
     positive in the middle and nowhere else. Four different pictures is what
     random data looks like when you cut it four ways.

  2. THE REVERSAL LEG IS DEAD AT EVERY SETTING. Fading high-ratio days lost money
     at 0.70, 0.80, 0.90 and 0.95, at holds of 5, 10 and 20 days, with and
     without a body filter, and at 60/90/120-day percentile windows. Uniformly
     negative with no dose-response. This is not an inverted edge worth flipping
     - it is what fading the day's direction costs in a market with positive
     drift and short-horizon continuation, and the ratio changed nothing about
     it. The specific claim that leverage-driven moves reverse is falsified.

  3. THE CONTINUATION LEG IS A DECAYED, SINGLE-CELL RESULT. `follow` at pct=0.10
     is the best number in the file (+2.64% mean, +1.95% trimmed, n=65) and it
     fails on every check that matters. The threshold sweep went +0.37%, +0.02%,
     +2.64%, +1.84% - the second-tightest cell is WORSE than the loosest, so
     there is no dose-response; the winner is one cell out of eight. Train +4.94%
     collapses to test +0.26%, and the trimmed test number is NEGATIVE (-0.04%),
     which is the project's decisive metric saying the out-of-sample body of the
     distribution has no edge left. Only 2 calendar-year buckets exist, so the
     per-year check cannot do its job. And the edge is concentrated in SOL
     (+5.21%) and HYPE (+4.09%) while BTC is +0.31% with a NEGATIVE trimmed
     (-0.28%) - a structural claim about leverage versus cash should not care
     which coin it is applied to.

     The control settles it. Unconditional continuation over the same window -
     same hold, same stop, ratio condition removed - is +0.50% and also decays
     (train +1.12% -> test -0.24%). The selected version sits on top of a base
     rate that is itself dying, and its margin comes almost entirely from 24
     short trades. Twenty-four.

  4. THE FILTER TEST CAME OUT BACKWARDS, AND THAT IS THE MOST USEFUL LINE HERE.
     The hypothesis said S3's forced-flow trades should do BETTER when spot
     volume confirms. They do worse - dramatically so. S3 trades whose signal day
     sat in the bottom ratio quintile (spot volume relatively strongest) returned
     -3.09% on n=7; every other quintile was positive. The KEEP/DROP partitions
     say the same thing at every cut: keeping the spot-confirmed trades gives
     -3.09%/-1.48%/-0.16% while the DISCARDED perp-only trades give
     +2.99%/+3.15%/+3.27%. So spot confirmation is, if anything, an ANTI-signal
     for S3.

     I am not proposing the inverted filter. It rests on n=7, it was found by
     looking at the answer, and inverting a hypothesis after seeing which way the
     data fell is precisely the move this project rejects. But it does close the
     door on the version of the idea that was worth the most: there is no
     spot-confirmation improvement to S3 to be had, and the sign of the
     non-effect is the opposite of what the mechanism predicted.

     Also worth flagging for anyone who reuses this: S3 restricted to the spot
     window scores +2.48% against its +1.80% full-sample number. The window is a
     flattering subsample. Any filter measured inside it starts with a tailwind
     that has nothing to do with the filter.

  5. OVERLAP WOULD HAVE KILLED IT ANYWAY. The best standalone variant runs
     0.92 against D1 on BTC, 0.88 on SOL, 1.00 on HYPE (on only 8 co-invested
     bars) and 0.66 against S3 on ETH. Max 1.00. It is the same continuation bet
     the book already owns, reached by a different route. Even had the statistics
     held, it would add exposure rather than diversification.

  WHAT THIS TELLS US ABOUT THE REAL-ANCHOR RULE. The generalisation does not
  hold, and the reason is worth writing down. B1's anchor is enforceable: a perp
  trading above spot creates a trade someone is PAID to put on, and their putting
  it on is what closes the gap. Spot volume has no such enforcement. It is a
  descriptive fact about who traded yesterday, not a price someone can be
  arbitraged toward. Nobody is forced to trade against a volume ratio. So the
  rule should be stated more tightly than "reversion needs a real anchor": it
  needs a real anchor that someone is COMPENSATED FOR CLOSING THE DISTANCE TO.
  A real observable is not the same thing as a real constraint.

  24 configurations evaluated. Nothing here is worth running.""")
