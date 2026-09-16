"""
VOLATILITY-REGIME CONDITIONING OF THE EXISTING BOOK.

This is not a new strategy. It is a proposed OVERLAY on the four strategies
already validated here (S3 forced-flow, D1 range-break, B1 basis, M3 Donchian),
and if it works it is worth more than a fifth strategy would be, because it
costs no new trades and no new mechanism - it only moves capital between bets
that are already earning.

HYPOTHESIS (the mechanism, stated before any code runs):

  The two genuinely independent bets in this book should have OPPOSITE
  volatility preferences, because their mechanisms depend on opposite states of
  the market's risk-absorption capacity.

  * FORCED-FLOW CONTINUATION (S3/D1, and M3 by extension) is a claim about
    liquidation cascades. A cascade needs two things: leveraged positions
    sitting at their maintenance margin, and a book too thin to absorb the
    margin engine's market orders. Both of those are what high realised
    volatility IS. In a calm tape the same volume print gets absorbed by market
    makers and the move does not extend, so continuation should be WEAK in low
    vol and STRONG in high vol.

  * BASIS REVERSION (B1) is a claim about arbitrage. The perp-spot gap closes
    because someone can short the perp, buy the spot, and collect the
    convergence. That trade requires balance-sheet capacity, a spot book deep
    enough to lift, and a tolerable margin-of-error. In a violent tape the
    arbitrageur widens his quote or steps away entirely - the gap can persist or
    get wider before it closes, and the ATR stop takes you out first. So
    reversion should be STRONG in calm and WEAK in chaos.

  WHO IS FORCED TO TRADE AGAINST YOU AND WHY THEY CANNOT STOP: unchanged from
  the underlying strategies (margin engines for the continuation family, basis
  arbitrageurs for B1). The regime claim is about WHEN those actors are present,
  not about a new actor. That is the only reason this is worth testing at all -
  it inherits a mechanism rather than inventing one.

  IF TRUE: a regime variable tilts capital between the daily sleeve's two
  members rather than adding a third bet, and the static 75/25 is leaving money
  on the table. IF FALSE: the static split is already the right answer, which is
  a genuinely useful finding and the honest default.

THE MULTIPLE-TESTING PROBLEM, stated up front because it dominates this study:
  4 strategies x 3 regime variables x 5 quintiles = 60 cells. At a 5% false
  positive rate, THREE of those cells look significant by pure chance. Reading
  the biggest number off a 60-cell grid and calling it a regime effect is
  exactly the error this project exists to avoid. Two defences are applied:

  1. PERMUTATION NULL. For each (strategy, regime) pair the regime labels are
     shuffled among that strategy's own trades 2000 times, and the observed
     top-minus-bottom quintile spread is scored against that null. This asks
     "how often does a spread this big appear when the regime variable is
     known to be meaningless?" - it calibrates the grid instead of trusting it.
  2. TRAIN/TEST ON THE REGIME EFFECT ITSELF. Quintile expectancies are computed
     separately on the first 60% and last 40% of the sample. A regime effect
     that is real should have the same SIGN in both halves. A rule fit on the
     whole history is worthless, so the allocation test is scored on the test
     window only, using a tilt direction fixed by the mechanism above rather
     than by the training numbers.

WHAT IS DELIBERATELY NOT DONE: no parameter hunting. The regime lookbacks (20d
vol, 60d vol-of-vol, 20d efficiency ratio, 252d ranking window) are the obvious
defaults and are not swept. Quintile cut points are fixed at 0.2/0.4/0.6/0.8 of
the trailing percentile, so no boundary is fitted to the data. Funding
dispersion was on the candidate list and is deliberately EXCLUDED - it is a
cross-sectional variable that would need a fourth regime axis and 20 more cells
for no additional mechanism, and the cell count is already the binding problem.
"""
import sys, math, random, datetime, statistics as st

sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout
from strategies_macro import donchian_turtle

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
random.seed(1717)
N_PERM = 2000

# Quintile edges on a trailing PERCENTILE, so they are fixed a priori and cannot
# be fitted. Q1 = calmest/weakest fifth of history, Q5 = most extreme fifth.
EDGES = [0.2, 0.4, 0.6, 0.8]
QNAMES = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5']


# ---------------------------------------------------------------- regime variables

def trailing_pct_rank(vals, win=252, min_hist=120):
    """Causal percentile rank of vals[i] within its own trailing `win` window.

    Using a trailing rank rather than a full-sample z-score matters: a
    full-sample percentile would tell a 2023 trade where 2026's volatility
    ranked, which is lookahead of the most seductive kind (it feels like a
    'regime definition' rather than a signal)."""
    out = [None] * len(vals)
    for i in range(len(vals)):
        if vals[i] is None:
            continue
        hist = [v for v in vals[max(0, i - win + 1):i + 1] if v is not None]
        if len(hist) < min_hist:
            continue
        below = sum(1 for v in hist if v < vals[i])
        out[i] = below / (len(hist) - 1) if len(hist) > 1 else None
    return out


def efficiency_ratio(closes, n=20):
    """Kaufman efficiency ratio: net move / total path travelled over n bars.

    An ADX-like trend-strength measure with no smoothing parameters to tune.
    High = the market went somewhere in a straight line (trending); low = it
    covered the same ground repeatedly (chopping). This is the variable most
    likely to separate a continuation edge from a reversion edge if the split is
    about market STRUCTURE rather than about volatility LEVEL."""
    out = [None] * len(closes)
    for i in range(n, len(closes)):
        path = sum(abs(closes[k] - closes[k - 1]) for k in range(i - n + 1, i + 1))
        if path > 0:
            out[i] = abs(closes[i] - closes[i - n]) / path
    return out


def vol_of_vol(rv, n=60):
    """Dispersion of realised vol itself. High vol-of-vol = the regime is
    CHANGING, which is a different state from 'vol is high and stable'. A
    liquidation cascade is a vol-of-vol event more than a vol-level event: it is
    the transition that catches leverage offside, not the plateau."""
    out = [None] * len(rv)
    for i in range(len(rv)):
        w = [v for v in rv[max(0, i - n + 1):i + 1] if v is not None]
        if len(w) >= max(20, n // 2):
            out[i] = st.pstdev(w)
    return out


def build_regimes(bars):
    closes = [b['c'] for b in bars]
    rv = engine.logret_vol_series(closes, 20)
    return {
        'RV20': trailing_pct_rank(rv),
        'VOV60': trailing_pct_rank(vol_of_vol(rv, 60)),
        'ER20': trailing_pct_rank(efficiency_ratio(closes, 20)),
    }


REGIME_LABEL = {
    'RV20': 'realised vol (20d) percentile',
    'VOV60': 'vol-of-vol (60d of 20d RV) percentile',
    'ER20': 'trend efficiency ratio (20d) percentile',
}


# ---------------------------------------------------------------- strategy book

print('loading book (cached candles + funding)...', file=sys.stderr)
_, S3 = pooled.pooled(volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5},
                      COINS, 60, name='S3')
_, D1 = pooled.pooled(range_breakout, {'n': 20, 'atr_mult': 2.5, 'max_hold': 10,
                                       'atr_ratio': 2.0}, COINS, 60, name='D1')
_, B1 = run_basis.run(run_basis.BASE)
_, M3 = pooled.pooled(donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0},
                      COINS, 85, name='M3')
BOOK = [('S3', S3, 'forced-flow continuation'), ('D1', D1, 'range-break cascade'),
        ('B1', B1, 'basis dislocation'), ('M3', M3, 'donchian 55/20 [macro]')]

# Per-coin bar index and regime series, built once.
BARS, IDX, REG = {}, {}, {}
for c in COINS:
    bars, _f = pooled.load(c)
    BARS[c] = bars
    IDX[c] = {b['t']: i for i, b in enumerate(bars)}
    REG[c] = build_regimes(bars)


def regime_at_entry(trade, key):
    """Regime percentile on the SIGNAL bar - the bar whose close produced the
    trade - not the fill bar. The engine fills at bars[i+1]['o'], so bars[i+1]'s
    own close (and therefore its vol) is not knowable when the order goes in.
    Off-by-one here would quietly inject a day of lookahead into every cell."""
    i = IDX[trade.coin].get(trade.entry_t)
    if i is None or i < 1:
        return None
    return REG[trade.coin][key][i - 1]


def bucket(p):
    if p is None:
        return None
    for k, e in enumerate(EDGES):
        if p < e:
            return k
    return 4


def cells(trades, key):
    """Trade pnl lists per quintile, plus the count with no regime value."""
    out = [[] for _ in range(5)]
    missing = 0
    for t in trades:
        b = bucket(regime_at_entry(t, key))
        if b is None:
            missing += 1
        else:
            out[b].append(t.pnl_pct)
    return out, missing


def mean(v):
    return sum(v) / len(v) if v else 0.0


def trimmed(v, frac=0.05):
    if len(v) < 10:
        return mean(v)
    s = sorted(v)
    k = max(1, int(len(s) * frac))
    core = s[k:-k]
    return mean(core) if core else 0.0


def spread(buckets):
    """Top quintile minus bottom quintile expectancy. The single number a
    regime claim lives or dies on: if the regime matters, the extremes differ."""
    if not buckets[4] or not buckets[0]:
        return None
    return mean(buckets[4]) - mean(buckets[0])


def monotone_score(buckets):
    """Spearman rank correlation between quintile index and quintile mean, over
    the quintiles that actually have trades. A DOSE-RESPONSE - each step of the
    regime variable moving the result the same way - is far stronger evidence
    than one extreme cell, because chance produces isolated cells easily and
    ordered sequences rarely."""
    pts = [(k, mean(b)) for k, b in enumerate(buckets) if len(b) >= 5]
    if len(pts) < 4:
        return None
    xs = [p[0] for p in pts]
    ys = sorted(range(len(pts)), key=lambda j: pts[j][1])
    rank = [0] * len(pts)
    for r, j in enumerate(ys):
        rank[j] = r
    mx, my = mean(xs), mean(rank)
    num = sum((a - mx) * (b - my) for a, b in zip(xs, rank))
    den = (sum((a - mx) ** 2 for a in xs) * sum((b - my) ** 2 for b in rank)) ** .5
    return num / den if den else None


def perm_pvalue(trades, key, observed, n_perm=N_PERM):
    """Shuffle the regime labels among this strategy's own trades. Preserves the
    strategy's return distribution exactly and destroys only the regime link, so
    the null is 'this regime variable carries no information' rather than some
    parametric fiction. Two-sided on |spread|."""
    labs, rets = [], []
    for t in trades:
        b = bucket(regime_at_entry(t, key))
        if b is not None:
            labs.append(b)
            rets.append(t.pnl_pct)
    if not labs or observed is None:
        return None
    hits = 0
    for _ in range(n_perm):
        random.shuffle(rets)
        g = [[] for _ in range(5)]
        for b, r in zip(labs, rets):
            g[b].append(r)
        s = spread(g)
        if s is not None and abs(s) >= abs(observed):
            hits += 1
    return (hits + 1) / (n_perm + 1)


def split_trades(result, frac=0.60):
    cut = result.start_t + (result.end_t - result.start_t) * frac
    return ([t for t in result.trades if t.entry_t < cut],
            [t for t in result.trades if t.entry_t >= cut])


# ================================================================ 1. THE GRID
VARIANTS = 0
print('=' * 120)
print('1. EXPECTANCY BY REGIME QUINTILE - the 60-cell grid, reported in full including the ugly cells')
print('=' * 120)
print('   Q1 = bottom fifth of the trailing distribution (calmest / least trending), Q5 = top fifth.')
print('   "spread" = Q5 exp - Q1 exp.  "rho" = rank correlation of quintile vs expectancy (dose-response).')
print('   "p(perm)" = two-sided permutation p on |spread| with regime labels shuffled, {} draws.\n'.format(N_PERM))

grid = {}
for sid, res, desc in BOOK:
    print('-' * 120)
    print('{}  {}   (pooled n={}, uncond exp {:+.2f}%, trim5 {:+.2f}%)'.format(
        sid, desc, res.n, res.expectancy * 100, res.trimmed_expectancy(0.05) * 100))
    for key in ('RV20', 'VOV60', 'ER20'):
        b, missing = cells(res.trades, key)
        VARIANTS += 5                     # five cells evaluated per (strategy, regime)
        sp, rho = spread(b), monotone_score(b)
        pv = perm_pvalue(res.trades, key, sp)
        grid[(sid, key)] = (b, sp, rho, pv)
        row = '  {:<7}'.format(key)
        for k in range(5):
            row += ' {} n={:<3} {:>7}'.format(QNAMES[k], len(b[k]),
                                              '{:+.2f}%'.format(mean(b[k]) * 100) if b[k] else '   -  ')
        print(row)
        print('          spread={:>8}  rho={:>6}  p(perm)={:>6}  {}'.format(
            '{:+.2f}%'.format(sp * 100) if sp is not None else 'n/a',
            '{:+.2f}'.format(rho) if rho is not None else 'n/a',
            '{:.3f}'.format(pv) if pv is not None else 'n/a',
            '(dropped {} trades with no regime value)'.format(missing) if missing else ''))

sig = [(k, v[3]) for k, v in grid.items() if v[3] is not None and v[3] < 0.05]
print('\n  MULTIPLE-TESTING SCORECARD: {} (strategy x regime) pairs tested = {} cells.'.format(
    len(grid), VARIANTS))
print('  Significant at p<0.05 before correction: {} of {}.  Expected by chance at 5%: {:.1f}.'.format(
    len(sig), len(grid), 0.05 * len(grid)))
print('  Bonferroni threshold for {} pairs is p<{:.4f}; pairs clearing it: {}.'.format(
    len(grid), 0.05 / len(grid),
    [k for k, v in grid.items() if v[3] is not None and v[3] < 0.05 / len(grid)] or 'NONE'))


# ================================================ 2. DOES THE EFFECT REPLICATE OUT OF SAMPLE
print('\n' + '=' * 120)
print('2. THE SAME GRID, SPLIT 60/40 BY TIME - a regime effect that is real must keep its SIGN')
print('=' * 120)
print('   A big in-sample spread that flips sign in the test half is the signature of noise,')
print('   and it is the reason a regime rule fit on full history cannot be trusted.\n')
agree = tested = 0
for sid, res, _d in BOOK:
    tr, te = split_trades(res)
    for key in ('RV20', 'VOV60', 'ER20'):
        bt, _ = cells(tr, key)
        bs, _ = cells(te, key)
        s1, s2 = spread(bt), spread(bs)
        ok = '-'
        if s1 is not None and s2 is not None:
            tested += 1
            same = (s1 > 0) == (s2 > 0)
            agree += same
            ok = 'SAME SIGN' if same else 'SIGN FLIP'
        print('  {:<4} {:<7} train n={:<4} spread={:>8}   test n={:<4} spread={:>8}   {}'.format(
            sid, key, len(tr), '{:+.2f}%'.format(s1 * 100) if s1 is not None else 'n/a',
            len(te), '{:+.2f}%'.format(s2 * 100) if s2 is not None else 'n/a', ok))
print('\n  -> {}/{} (strategy x regime) pairs keep the sign of their spread out of sample.'.format(agree, tested))
print('     Coin-flip expectation is {:.1f}/{}.'.format(tested * 0.5, tested))


# ============================ 3. THE ACTUAL HYPOTHESIS: OPPOSITE PREFERENCES FOR S3 vs B1
print('\n' + '=' * 120)
print('3. THE HYPOTHESIS ITSELF - do forced-flow and basis have OPPOSITE regime preferences?')
print('=' * 120)
print('   This is the only claim that would justify a tilt. Everything above is descriptive;')
print('   this is the pre-specified prediction: S3 spread > 0 (needs vol) AND B1 spread < 0 (needs calm).\n')
for key in ('RV20', 'VOV60', 'ER20'):
    s3s, b1s = grid[('S3', key)][1], grid[('B1', key)][1]
    verdict = 'AS PREDICTED' if (s3s is not None and b1s is not None and s3s > 0 > b1s) \
        else 'NOT AS PREDICTED'
    print('  {:<7} {:<44} S3 spread {:>8}   B1 spread {:>8}   -> {}'.format(
        key, REGIME_LABEL[key],
        '{:+.2f}%'.format(s3s * 100) if s3s is not None else 'n/a',
        '{:+.2f}%'.format(b1s * 100) if b1s is not None else 'n/a', verdict))


# ================================================================ 4. ALLOCATION TEST
print('\n' + '=' * 120)
print('4. DOES A REGIME-CONDITIONAL ALLOCATION BEAT THE STATIC ONE, OUT OF SAMPLE?')
print('=' * 120)
print('   Book modelled as allocation.py does it: daily sleeve S3 .375 + B1 .375, macro M3 .25.')
print('   (D1 is excluded from the portfolio - it overlaps S3 0.85-1.00, so funding both is')
print('   one bet counted twice. Its regime cells are still reported above.)')
print('   The TILT DIRECTION IS FIXED BY THE MECHANISM, NOT BY THE TRAINING NUMBERS: in a')
print('   high-vol regime give weight to forced-flow and take it from basis; in a calm regime,')
print('   the reverse. Sleeve total weight is held constant at 0.75, so every row deploys the')
print('   SAME risk budget and the rows differ only in how it is divided. k=1.0 IS the static')
print('   book, so the k sequence doubles as a dose-response: if the tilt captures something')
print('   real, the result should improve monotonically as k rises, then only fail at extremes.\n')

STATIC = {'S3': 0.375, 'B1': 0.375, 'M3': 0.25}
SIZE = 0.05                                  # 5% of capital per position, as in allocation.py


def weight_for(trade, sid, key, k):
    """Regime-conditional sleeve weight. Only S3 and B1 are tilted; M3 is the
    macro sleeve and its 0.25 is untouched (tilting it would confound the daily
    test with a sleeve-size change)."""
    w = STATIC[sid]
    if sid == 'M3' or k == 1.0:
        return w
    p = regime_at_entry(trade, key)
    if p is None:
        return w
    if p >= 0.6:                              # high regime: cascade conditions
        t3, t1 = k, 1.0 / k
    elif p <= 0.4:                            # low regime: arbitrage conditions
        t3, t1 = 1.0 / k, k
    else:
        return w
    # renormalise so S3+B1 still sums to 0.75 - constant risk, different division
    tot = STATIC['S3'] * t3 + STATIC['B1'] * t1
    scale = (STATIC['S3'] + STATIC['B1']) / tot
    return w * (t3 if sid == 'S3' else t1) * scale


def portfolio(trades_by_sid, key, k):
    """Sequential compounding of the blended account, trades ordered by EXIT.
    Reports both the compounded annual rate and the plain weighted mean per
    trade - the second is noisier-free of ordering effects and is the number to
    trust when n is modest."""
    rows = []
    for sid, ts in trades_by_sid.items():
        for t in ts:
            rows.append((t.exit_t, t, sid))
    rows.sort(key=lambda r: r[0])
    if not rows:
        return None
    eq = 1.0
    contrib = []
    for _t, t, sid in rows:
        w = weight_for(t, sid, key, k)
        eq *= (1 + t.pnl_pct * SIZE * w)
        contrib.append(t.pnl_pct * w)
        if eq <= 0.01:
            eq = 0.01
    yrs = (rows[-1][0] - rows[0][0]) / engine.YEAR_MS
    cagr = eq ** (1 / yrs) - 1 if yrs > 0 and eq > 0 else 0.0
    return {'n': len(rows), 'cagr': cagr, 'ret': eq - 1,
            'wexp': mean(contrib), 'wtrim': trimmed(contrib), 'yrs': yrs}


PORT = {sid: res for sid, res, _ in BOOK if sid in STATIC}
splits = {sid: split_trades(r) for sid, r in PORT.items()}
train_t = {sid: v[0] for sid, v in splits.items()}
test_t = {sid: v[1] for sid, v in splits.items()}

for key in ('RV20', 'VOV60', 'ER20'):
    print('  regime = {}'.format(REGIME_LABEL[key]))
    print('  {:<26}{:>12}{:>12}{:>14}{:>12}{:>12}{:>14}'.format(
        'tilt k', 'TRAIN CAGR', 'TRAIN wexp', 'TRAIN wtrim5',
        'TEST CAGR', 'TEST wexp', 'TEST wtrim5'))
    for k in (1.0, 1.25, 1.5, 2.0):
        VARIANTS += 1 if k != 1.0 else 0     # k=1.0 is the static baseline, not a variant
        a = portfolio(train_t, key, k)
        b = portfolio(test_t, key, k)
        tag = 'STATIC (baseline)' if k == 1.0 else 'k={:.2f}'.format(k)
        print('  {:<26}{:>12}{:>12}{:>14}{:>12}{:>12}{:>14}'.format(
            tag, '{:+.1f}%'.format(a['cagr'] * 100), '{:+.3f}%'.format(a['wexp'] * 100),
            '{:+.3f}%'.format(a['wtrim'] * 100), '{:+.1f}%'.format(b['cagr'] * 100),
            '{:+.3f}%'.format(b['wexp'] * 100), '{:+.3f}%'.format(b['wtrim'] * 100)))
    print()

# The mirror test. If the tilt direction is capturing signal, INVERTING it must
# hurt. If inverting it helps just as much, the "effect" is noise being reshaped.
print('  MIRROR TEST - the same rule with the tilt direction REVERSED. A real regime')
print('  effect must be ASYMMETRIC: reversing it should cost money. If reversing it is')
print('  free (or profitable), the tilt is not tracking the mechanism.\n')
print('  {:<30}{:>14}{:>14}'.format('', 'TEST CAGR', 'TEST wexp'))
base = portfolio(test_t, 'RV20', 1.0)
print('  {:<30}{:>14}{:>14}'.format('static', '{:+.1f}%'.format(base['cagr'] * 100),
                                    '{:+.3f}%'.format(base['wexp'] * 100)))
for key in ('RV20', 'VOV60', 'ER20'):
    fwd = portfolio(test_t, key, 1.5)
    inv = portfolio(test_t, key, 1.0 / 1.5)   # k<1 swaps which sleeve is favoured
    VARIANTS += 1
    print('  {:<30}{:>14}{:>14}'.format('{} tilt k=1.50'.format(key),
                                        '{:+.1f}%'.format(fwd['cagr'] * 100),
                                        '{:+.3f}%'.format(fwd['wexp'] * 100)))
    print('  {:<30}{:>14}{:>14}'.format('  ...REVERSED (k=0.67)',
                                        '{:+.1f}%'.format(inv['cagr'] * 100),
                                        '{:+.3f}%'.format(inv['wexp'] * 100)))


# =============================================== 5. THE FITTED RULE (the honest upper bound)
print('\n' + '=' * 120)
print('5. A RULE FIT ON TRAIN, SCORED ON TEST - the upper bound on what regime fitting can buy')
print('=' * 120)
print('   Section 4 fixed the tilt direction from the mechanism. This instead LEARNS the')
print('   direction from the training half - which is what anyone optimising would do - and')
print('   then scores it on data it never saw. If even the fitted version fails out of sample,')
print('   regime conditioning is dead here, not merely mis-specified.\n')

fitted_dir = {}
for key in ('RV20', 'VOV60', 'ER20'):
    d = {}
    for sid in ('S3', 'B1'):
        b, _ = cells(train_t[sid], key)
        hi = mean(b[3] + b[4])
        lo = mean(b[0] + b[1])
        d[sid] = 1 if hi > lo else -1        # +1 = this sleeve prefers HIGH regime
        print('  train: {} {:<7} high(Q4+Q5) exp {:+.2f}% (n={})  low(Q1+Q2) exp {:+.2f}% (n={})  -> prefers {}'.format(
            sid, key, hi * 100, len(b[3]) + len(b[4]), lo * 100, len(b[0]) + len(b[1]),
            'HIGH' if d[sid] == 1 else 'LOW'))
    fitted_dir[key] = d
    if d['S3'] == d['B1']:
        print('        NOTE: train says both sleeves prefer the SAME regime state. A tilt needs')
        print('        them to disagree, so this regime cannot separate them however it is fit.')
    print()


def fitted_weight(trade, sid, key, k):
    w = STATIC[sid]
    if sid == 'M3':
        return w
    p = regime_at_entry(trade, key)
    if p is None or 0.4 < p < 0.6:
        return w
    high = p >= 0.6
    d = fitted_dir[key]
    t3 = k if (high == (d['S3'] == 1)) else 1.0 / k
    t1 = k if (high == (d['B1'] == 1)) else 1.0 / k
    tot = STATIC['S3'] * t3 + STATIC['B1'] * t1
    scale = (STATIC['S3'] + STATIC['B1']) / tot
    return w * (t3 if sid == 'S3' else t1) * scale


def fitted_portfolio(tb, key, k):
    rows = sorted(((t.exit_t, t, sid) for sid, ts in tb.items() for t in ts), key=lambda r: r[0])
    eq, contrib = 1.0, []
    for _x, t, sid in rows:
        w = fitted_weight(t, sid, key, k)
        eq *= (1 + t.pnl_pct * SIZE * w)
        contrib.append(t.pnl_pct * w)
        if eq <= 0.01:
            eq = 0.01
    yrs = (rows[-1][0] - rows[0][0]) / engine.YEAR_MS
    return {'cagr': eq ** (1 / yrs) - 1 if yrs > 0 else 0.0, 'wexp': mean(contrib),
            'wtrim': trimmed(contrib), 'n': len(rows)}


print('  {:<34}{:>14}{:>14}{:>14}'.format('fitted rule, scored on TEST', 'TEST CAGR', 'TEST wexp', 'TEST wtrim5'))
bt = portfolio(test_t, 'RV20', 1.0)
print('  {:<34}{:>14}{:>14}{:>14}'.format('static baseline',
                                          '{:+.1f}%'.format(bt['cagr'] * 100),
                                          '{:+.3f}%'.format(bt['wexp'] * 100),
                                          '{:+.3f}%'.format(bt['wtrim'] * 100)))
for key in ('RV20', 'VOV60', 'ER20'):
    for k in (1.5, 2.0):
        VARIANTS += 1
        r = fitted_portfolio(test_t, key, k)
        print('  {:<34}{:>14}{:>14}{:>14}'.format('{} fitted, k={:.2f}'.format(key, k),
                                                  '{:+.1f}%'.format(r['cagr'] * 100),
                                                  '{:+.3f}%'.format(r['wexp'] * 100),
                                                  '{:+.3f}%'.format(r['wtrim'] * 100)))


# ================================================================ 6. BOOTSTRAP ON THE DIFFERENCE
print('\n' + '=' * 120)
print('6. IS ANY TEST-WINDOW DIFFERENCE EVEN DISTINGUISHABLE FROM ZERO?')
print('=' * 120)
print('   Paired bootstrap over the test trades: resample the test set with replacement and')
print('   recompute (tilted weighted expectancy - static weighted expectancy) on the SAME')
print('   resample, so the comparison is paired and the market-direction noise cancels.\n')


def paired_boot(key, k, n_boot=2000):
    rows = [(t, sid) for sid, ts in test_t.items() for t in ts]
    diffs = []
    for _ in range(n_boot):
        s = [rows[random.randrange(len(rows))] for _ in range(len(rows))]
        a = mean([t.pnl_pct * weight_for(t, sid, key, k) for t, sid in s])
        b = mean([t.pnl_pct * STATIC[sid] for t, sid in s])
        diffs.append(a - b)
    diffs.sort()
    return (diffs[int(0.05 * len(diffs))], st.median(diffs), diffs[int(0.95 * len(diffs))],
            sum(1 for d in diffs if d > 0) / len(diffs))


print('  {:<26}{:>12}{:>12}{:>12}{:>16}'.format('tilt', 'p5 diff', 'median', 'p95 diff', 'P(tilt better)'))
for key in ('RV20', 'VOV60', 'ER20'):
    lo, md, hi, pw = paired_boot(key, 1.5)
    print('  {:<26}{:>12}{:>12}{:>12}{:>16}'.format(
        '{} k=1.50'.format(key), '{:+.3f}%'.format(lo * 100), '{:+.3f}%'.format(md * 100),
        '{:+.3f}%'.format(hi * 100), '{:.0%}'.format(pw)))
print('\n  A 90% interval straddling zero means the tilt is indistinguishable from doing nothing,')
print('  and "doing nothing" is free while a regime overlay is code that can break.')


# ================================================================ 7. COST + VARIANT ACCOUNTING
print('\n' + '=' * 120)
print('7. ACCOUNTING')
print('=' * 120)
print('  A regime tilt adds NO trades - it only resizes existing ones - so it carries no')
print('  incremental execution cost and no cost-stress test is meaningful for the overlay')
print('  itself. The underlying strategies were already stressed at 2x and 4x the modelled')
print('  0.190%% round trip. For reference, at the book weights above:')
for sid, res, _d in BOOK:
    if sid in STATIC:
        print('    {:<4} {:>5.0f} trades/yr -> {:>5.1f}%/yr of notional in cost, uncond exp {:+.2f}%/trade'.format(
            sid, res.trades_per_year(), res.trades_per_year() * 0.190, res.expectancy * 100))
print('\n  TOTAL CONFIGURATIONS EVALUATED IN THIS STUDY: {}'.format(VARIANTS))
print('  ({} grid cells + tilt strengths x 3 regimes + 3 mirror runs + 6 fitted runs).'.format(len(grid) * 5))
print('  With that many looks, an uncorrected p<0.05 anywhere in section 1 means nothing on')
print('  its own. The only findings that count are the ones that ALSO survived section 2')
print('  (sign stability out of sample) and section 4/6 (the allocation actually paying).')


# ================================================================ 8. HEADLINE NUMBERS
print('\n' + '=' * 120)
print('8. HEADLINE - the overlay expressed as what it ADDS, which is the only honest framing')
print('=' * 120)
print('   A regime overlay generates no trades of its own, so it has no expectancy of its own.')
print('   Its expectancy IS the incremental weighted return per book trade versus the static')
print('   75/25 weights. Reported for the best-looking tilt (ER20), full sample and test.\n')
full_t = {sid: r.trades for sid, r in PORT.items()}
for label, tb in (('FULL SAMPLE', full_t), ('TRAIN (first 60%)', train_t), ('TEST (last 40%)', test_t)):
    s = portfolio(tb, 'ER20', 1.0)
    a = portfolio(tb, 'ER20', 1.5)
    print('  {:<20} n={:<4}  static wexp {:+.3f}%  ER20 k=1.5 wexp {:+.3f}%  INCREMENTAL {:+.3f}%/trade '
          '(trimmed {:+.3f}%)'.format(label, s['n'], s['wexp'] * 100, a['wexp'] * 100,
                                      (a['wexp'] - s['wexp']) * 100, (a['wtrim'] - s['wtrim']) * 100))
    print('  {:<20}    trades/yr {:.0f}  span {:.2f}y'.format('', s['n'] / s['yrs'], s['yrs']))


# ============================================ 9. WHY IT FAILS: COMMON FACTOR vs ROTATION FACTOR
# Added after reading sections 1-8. This introduces NO new parameters, no new fitting and no
# new variants - it only re-expresses spreads already computed above. It is here because the
# real reason the overlay dies is not visible in any single table.
print('\n' + '=' * 120)
print('9. THE STRUCTURAL REASON THIS FAILS - a regime can only pay if the sleeves DISAGREE')
print('=' * 120)
print("""   A tilt moves capital BETWEEN S3 and B1 at constant total sleeve weight. So the only
   part of a regime effect it can ever monetise is the part where the two sleeves respond
   in OPPOSITE directions. Decompose each pair of spreads into:

       COMMON       = (S3_spread + B1_spread)/2   both sleeves move together. A rotation
                      CANNOT harvest this. Harvesting it would mean scaling the whole book
                      up and down - market timing, a different and untested claim.
       DIFFERENTIAL = (S3_spread - B1_spread)/2   the only harvestable part. The hypothesis
                      predicted this should be strongly POSITIVE (S3 likes vol, B1 likes calm).
""")
print('  {:<8}{:>14}{:>14}{:>14}{:>14}{:>16}'.format(
    'regime', 'S3 spread', 'B1 spread', 'COMMON', 'DIFFERENTIAL', 'harvestable?'))
for key in ('RV20', 'VOV60', 'ER20'):
    s3s, b1s = grid[('S3', key)][1], grid[('B1', key)][1]
    if s3s is None or b1s is None:
        continue
    com, dif = (s3s + b1s) / 2, (s3s - b1s) / 2
    frac = abs(dif) / (abs(dif) + abs(com)) if (abs(dif) + abs(com)) > 0 else 0
    print('  {:<8}{:>14}{:>14}{:>14}{:>14}{:>15.0%}'.format(
        key, '{:+.2f}%'.format(s3s * 100), '{:+.2f}%'.format(b1s * 100),
        '{:+.2f}%'.format(com * 100), '{:+.2f}%'.format(dif * 100), frac))

print('\n  Same decomposition, TRAIN vs TEST - does the harvestable part even keep its sign?')
print('  {:<8}{:>18}{:>18}{:>12}'.format('regime', 'TRAIN differential', 'TEST differential', 'verdict'))
for key in ('RV20', 'VOV60', 'ER20'):
    tr_s3, _ = cells(train_t['S3'], key)
    tr_b1, _ = cells(train_t['B1'], key)
    te_s3, _ = cells(test_t['S3'], key)
    te_b1, _ = cells(test_t['B1'], key)
    a, b = spread(tr_s3), spread(tr_b1)
    c, d = spread(te_s3), spread(te_b1)
    if None in (a, b, c, d):
        continue
    d1, d2 = (a - b) / 2, (c - d) / 2
    print('  {:<8}{:>18}{:>18}{:>12}'.format(
        key, '{:+.2f}%'.format(d1 * 100), '{:+.2f}%'.format(d2 * 100),
        'SAME SIGN' if (d1 > 0) == (d2 > 0) else 'SIGN FLIP'))

print("""
  READ THIS TOGETHER WITH SECTION 5. On ER20 - the only regime whose differential keeps its
  sign - the TRAINING half says S3 prefers HIGH *and B1 also prefers HIGH*. Both sleeves like
  trending markets. So an honest optimiser, fitting on train and scoring on test, produces a
  tilt of EXACTLY ZERO (that is why every ER20/VOV60 row in section 5 reproduces the static
  baseline to three decimals - it is not a coincidence, it is the renormalisation collapsing).

  The ER20 test-window gain in section 4 exists ONLY because section 4 imposes the mechanism's
  direction - S3 favoured in high, B1 favoured in low - which is a direction the training data
  explicitly CONTRADICTS for B1. To trade it you would have to overrule your own in-sample
  evidence with a hypothesis that evidence falsified, and then collect +0.077%/trade whose
  90% bootstrap interval straddles zero and whose full-sample TRIMMED value is NEGATIVE.

  That is not an edge. That is the shape of noise that has been looked at 78 times.""")
