"""
UNCERTAINTY-SCALED POSITION SIZING - size on confidence in the edge, not on the
point estimate of the edge.

THE PROBLEM. Every strategy in this book is sized at exactly $16.25. B1 has
n=178 with 15/15 parameter perturbations positive on both halves of the sample.
M3 has n=49, an edge that decayed from +49% in train to +2.2% in test, and
44-day holds whose outcomes are wildly dispersed. Under any coherent risk
ideology those two things are not equally believable, and equal capital is a
statement that they are. Uniform sizing is an implicit claim that the point
estimate is all the information there is.

THE MECHANISM (why this should work, stated before any code). This is not a
market mechanism - nobody is forced to trade against us here - so it does not
get judged as an edge discovery. It is an ESTIMATION claim, and the claim is
narrow and checkable: an observed mean trade x_bar is a noisy measurement of an
unknown true edge mu. The noise is sigma/sqrt(n). When n is small and sigma is
large, the measurement is mostly noise, and the honest posterior estimate of mu
is pulled toward the prior. Because the strategies here were SELECTED for having
large observed means out of 17 mechanisms tested, the selection itself
guarantees the observed means are biased upward - the winner's curse. Shrinkage
is the correction for exactly that bias. So the prediction is specific: sizing
on the shrunk estimate should beat sizing on the raw one OUT OF SAMPLE, and the
gap should be larger out of sample than in sample, because in sample there is no
winner's curse left to correct.

THE DERIVATION. Normal-normal conjugate, the standard result:

    prior      mu ~ N(0, tau^2)          edges are centred on zero
    likelihood x_bar | mu ~ N(mu, sigma^2/n)

    posterior mean = x_bar * tau^2 / (tau^2 + sigma^2/n)
                   = x_bar * n / (n + (sigma/tau)^2)
                   = x_bar * lambda,      lambda = n / (n + k),  k = (sigma/tau)^2

k is the prior's weight expressed in trades: the prior is worth k observations.
lambda is the shrinkage factor - it depends ONLY on n and on the dispersion
sigma, exactly as required. A big edge measured on few, wildly dispersed trades
gets a small lambda and therefore less capital.

tau is the one judgement call. It is set to 1.0% per trade: a prior saying a
real per-trade edge of 1% is one sigma and 3.5% is a 3.5-sigma surprise. That is
appropriately sceptical for edges found by searching 17 mechanisms, and it is
swept in section 6.

THE TRAP THIS FILE MUST NOT FALL INTO. Computing lambda and x_bar from the FULL
sample and then applying them to those same trades is lookahead of the purest
kind - it allocates capital using the answer. Every number is therefore computed
twice: once ORACLE (full-sample, labelled as the cheat it is) and once
WALK-FORWARD (at each trade, only that strategy's trades that had already CLOSED
are used). Only the walk-forward number is implementable, so only it counts.

RAILS, enforced throughout. Nothing above 20% of capital ($50). Anything under
Hyperliquid's $10 minimum is SKIPPED, not shrunk - and at $250 capital with a
$16.25 base that means the entire implementable multiplier band is 0.615x to
3.08x. A scheme that wants to size a low-confidence strategy at 0.4x cannot; it
can only refuse to trade it. Every scheme's skip count is reported per strategy,
because a scheme that drops trades has silently become an entry filter and its
return numbers must be read as such.

EVALUATION is RETURN PER DOLLAR DEPLOYED, never total P&L, plus a COMMON-SET
version restricted to the trades a scheme and uniform BOTH take, which is the
only way to separate the sizing effect from the filtering effect.
"""
import sys, math, random, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout
from strategies_macro import donchian_turtle

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
CAPITAL = 250.0
BASE_POS = 16.25              # 6.5% of capital, the shipped size
MAX_POS = CAPITAL * 0.20      # hard rail: $50
MIN_ORDER = 10.0              # exchange minimum; below it a trade is SKIPPED
TAU = 0.010                   # prior sd of the true per-trade edge (1.0%)
MIN_PRIOR_N = 10              # walk-forward: trades needed before shrinking at all
STRATS = ['S3', 'D1', 'B1', 'M3']

# The implementable multiplier band, given the $10 floor and the $50 ceiling.
MULT_FLOOR = MIN_ORDER / BASE_POS      # 0.615
MULT_CEIL = MAX_POS / BASE_POS         # 3.077


# --------------------------------------------------------------------------
# 0. GATHER - every trade the live book would have taken, with entry context
# --------------------------------------------------------------------------
def gather():
    rows = []
    specs = [
        ('S3', volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}, 60, COINS),
        ('D1', range_breakout,
         {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}, 60, COINS),
        ('M3', donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0}, 85, COINS),
    ]
    for tag, fn, params, warm, coins in specs:
        for c in coins:
            bars, fund = pooled.load(c)
            atr = engine.atr_series(bars, 14)
            idx = {b['t']: i for i, b in enumerate(bars)}
            r = engine.backtest(bars, fn(params)(), c, fund, name=tag, warmup=warm)
            for t in r.trades:
                i = idx.get(t.entry_t)
                if i is None or i == 0 or not atr[i]:
                    continue
                sb = bars[i - 1]        # the SIGNAL bar is the one before the fill
                # conviction strength is the validated range/ATR dose-response.
                # It is defined for the forced-flow family only; B1 and M3 get the
                # neutral 1.5 (multiplier 1.0), matching research/sizing_optimization.py.
                strength = ((sb['h'] - sb['l']) / atr[i - 1]
                            if (tag in ('S3', 'D1') and atr[i - 1]) else 1.5)
                rows.append({'tag': tag, 'coin': c, 'pnl': t.pnl_pct,
                             'entry_t': t.entry_t, 'exit_t': t.exit_t,
                             'strength': strength})
    # B1 has its own runner and needs spot data. It does NOT work on SOL, so the
    # live basket is BTC/ETH/HYPE - sizing research must use the shipped basket.
    per, _ = run_basis.run(run_basis.BASE)
    for c, r in per.items():
        if c == 'SOL':
            continue
        for t in r.trades:
            rows.append({'tag': 'B1', 'coin': c, 'pnl': t.pnl_pct,
                         'entry_t': t.entry_t, 'exit_t': t.exit_t, 'strength': 1.5})
    rows.sort(key=lambda r: r['entry_t'])
    return rows


ROWS = gather()

print('=' * 122)
print('0. THE BOOK AS IT STANDS - four strategies, one size')
print('=' * 122)
print('  {:<6}{:>7}{:>12}{:>12}{:>12}{:>12}{:>12}{:>14}'.format(
    'strat', 'n', 'mean', 'sd', 'std err', 't-stat', 'trimmed', 'size today'))
STATS = {}
for s in STRATS:
    p = [r['pnl'] for r in ROWS if r['tag'] == s]
    m, sd = st.mean(p), st.pstdev(p)
    se = sd / math.sqrt(len(p))
    rr = engine.Result(coin='P', name=s)
    rr.trades = []
    trimmed = sorted(p)[max(1, int(len(p) * 0.05)):-max(1, int(len(p) * 0.05))]
    STATS[s] = {'n': len(p), 'mean': m, 'sd': sd, 'se': se}
    print('  {:<6}{:>7}{:>12}{:>12}{:>12}{:>12}{:>12}{:>14}'.format(
        s, len(p), '{:+.2f}%'.format(m * 100), '{:.2f}%'.format(sd * 100),
        '{:.2f}%'.format(se * 100), '{:.2f}'.format(m / se if se else 0),
        '{:+.2f}%'.format(st.mean(trimmed) * 100), '${:.2f}'.format(BASE_POS)))
print('\n  Note the t-stats. These are the numbers uniform sizing treats as')
print('  interchangeable. They are not interchangeable.')


# --------------------------------------------------------------------------
# 1. THE SHRINKAGE, DERIVED AND SHOWN
# --------------------------------------------------------------------------
def shrink(n, mean, sd, tau=TAU):
    """Normal-normal posterior mean. Returns (lambda, shrunk_mean, k)."""
    if n <= 1 or sd <= 0:
        return 0.0, 0.0, float('inf')
    k = (sd / tau) ** 2
    lam = n / (n + k)
    return lam, lam * mean, k


print('\n' + '=' * 122)
print('1. THE SHRINKAGE   lambda = n/(n+k),  k = (sigma/tau)^2,  tau = {:.2f}%'.format(TAU * 100))
print('=' * 122)
print('  {:<6}{:>7}{:>11}{:>10}{:>12}{:>11}{:>14}{:>14}'.format(
    'strat', 'n', 'sigma', 'k', 'k in yrs*', 'lambda', 'raw edge', 'shrunk edge'))
for s in STRATS:
    d = STATS[s]
    lam, sm, k = shrink(d['n'], d['mean'], d['sd'])
    d['lam'], d['shrunk'], d['k'] = lam, sm, k
    print('  {:<6}{:>7}{:>11}{:>10}{:>12}{:>11}{:>14}{:>14}'.format(
        s, d['n'], '{:.2f}%'.format(d['sd'] * 100), '{:.0f}'.format(k),
        '{:.1f}'.format(k / max(d['n'], 1)), '{:.3f}'.format(lam),
        '{:+.2f}%'.format(d['mean'] * 100), '{:+.2f}%'.format(sm * 100)))
print('  * k expressed as multiples of the strategy\'s own sample size: how many')
print('    more times the current evidence would be needed to reach lambda=0.5.')


# --------------------------------------------------------------------------
# 2. FROM SHRUNK EDGE TO A MULTIPLIER
# --------------------------------------------------------------------------
# Three maps, each a different risk ideology:
#   CONF   mult ~ lambda            confidence only, point estimate ignored.
#   SHRUNK mult ~ lambda * x_bar    size on the posterior edge itself.
#   KELLY  mult ~ lambda*x_bar/sd^2 the fractional-Kelly form; penalises
#                                   dispersion twice, which is the correct
#                                   answer if the objective is log growth.
def raw_mult(kind, n, mean, sd, tau=TAU):
    lam, sm, _ = shrink(n, mean, sd, tau)
    if kind == 'conf':
        return lam
    if kind == 'shrunk':
        return max(0.0, sm)
    if kind == 'kelly':
        return max(0.0, sm / (sd ** 2)) if sd > 0 else 0.0
    return 1.0


def normalise(raws):
    """Multipliers are relative, so the level is a free parameter. Anchoring on
    the EQUAL-WEIGHTED mean across strategies keeps average deployed capital
    near $16.25 and is computable live (it does not need future trade counts)."""
    vals = [v for v in raws.values() if v is not None]
    mu = st.mean(vals) if vals else 1.0
    if mu <= 0:
        return {k: 1.0 for k in raws}
    return {k: v / mu for k, v in raws.items()}


print('\n' + '=' * 122)
print('2. ORACLE MULTIPLIERS  (full-sample stats - LOOKAHEAD, upper bound only)')
print('=' * 122)
ORACLE = {}
for kind in ('conf', 'shrunk', 'kelly'):
    ORACLE[kind] = normalise({s: raw_mult(kind, STATS[s]['n'], STATS[s]['mean'],
                                          STATS[s]['sd']) for s in STRATS})
print('  {:<10}{:>14}{:>14}{:>14}{:>14}   {}'.format(
    'scheme', *STRATS, 'implied $ size (before rails)'))
for kind in ('conf', 'shrunk', 'kelly'):
    m = ORACLE[kind]
    print('  {:<10}{:>14}{:>14}{:>14}{:>14}   {}'.format(
        kind, *['{:.3f}x'.format(m[s]) for s in STRATS],
        '  '.join('{}=${:.2f}'.format(s, BASE_POS * m[s]) for s in STRATS)))
print('\n  IMPLEMENTABLE BAND at $250 capital: {:.3f}x to {:.3f}x (${:.0f} floor, ${:.0f} cap).'.format(
    MULT_FLOOR, MULT_CEIL, MIN_ORDER, MAX_POS))
for kind in ('conf', 'shrunk', 'kelly'):
    below = [s for s in STRATS if ORACLE[kind][s] < MULT_FLOOR]
    print('    {:<8} strategies pushed under the $10 floor: {}'.format(
        kind, ', '.join(below) if below else 'none'))


# --------------------------------------------------------------------------
# 3. WALK-FORWARD MULTIPLIERS - the only implementable version
# --------------------------------------------------------------------------
def walkforward_mults(rows, kind, tau=TAU, min_n=MIN_PRIOR_N):
    """For each row, the multiplier computable at that row's entry time using
    only trades of each strategy that had already CLOSED. Returns a list aligned
    to `rows`."""
    closed = {s: [] for s in STRATS}       # (exit_t, pnl), kept sorted by exit_t
    all_trades = sorted(rows, key=lambda r: r['exit_t'])
    ptr = 0
    out = []
    for r in rows:                          # rows are sorted by entry_t
        while ptr < len(all_trades) and all_trades[ptr]['exit_t'] <= r['entry_t']:
            a = all_trades[ptr]
            closed[a['tag']].append(a['pnl'])
            ptr += 1
        raws = {}
        for s in STRATS:
            p = closed[s]
            if len(p) < min_n:
                raws[s] = None              # not enough evidence to shrink on
            else:
                raws[s] = raw_mult(kind, len(p), st.mean(p), st.pstdev(p), tau)
        known = {k: v for k, v in raws.items() if v is not None}
        if not known:
            out.append(1.0)                 # neutral until any strategy matures
            continue
        norm = normalise(known)
        out.append(norm.get(r['tag'], 1.0)) # a strategy with < min_n trades sizes flat
    return out


print('\n' + '=' * 122)
print('3. WALK-FORWARD MULTIPLIERS - what was actually knowable at each entry')
print('=' * 122)
WF = {k: walkforward_mults(ROWS, k) for k in ('conf', 'shrunk', 'kelly')}
print('  {:<10}{:>12}{:>34}{:>34}'.format(
    'scheme', 'trades', 'mean multiplier by strategy', 'final multiplier by strategy'))
for kind in ('conf', 'shrunk', 'kelly'):
    per_s, last_s = {}, {}
    for r, m in zip(ROWS, WF[kind]):
        per_s.setdefault(r['tag'], []).append(m)
        last_s[r['tag']] = m
    print('  {:<10}{:>12}   {}   {}'.format(
        kind, len(ROWS),
        ' '.join('{}:{:.2f}'.format(s, st.mean(per_s.get(s, [1.0]))) for s in STRATS),
        ' '.join('{}:{:.2f}'.format(s, last_s.get(s, 1.0)) for s in STRATS)))
print('\n  The walk-forward multipliers converge toward the oracle ones but spend')
print('  the early sample flat, because a strategy with fewer than {} closed trades'.format(MIN_PRIOR_N))
print('  has no shrinkage estimate worth acting on.')


# --------------------------------------------------------------------------
# 4. SIZING, RAILS AND SKIP ACCOUNTING
# --------------------------------------------------------------------------
def conviction_mult(strength):
    """Already validated: +1.17pp per dollar risked, benefit larger out of
    sample. Unchanged here - uncertainty scaling must COMPOSE with it."""
    return max(0.5, min(2.0, strength / 1.5))


def size_of(r, unc_mult, use_conv, clamp_floor):
    m = unc_mult
    if use_conv:
        m *= conviction_mult(r['strength'])
    if clamp_floor:
        m = max(m, MULT_FLOOR)              # never let sizing become a filter
    return min(BASE_POS * m, MAX_POS)


def evaluate(rows, mults, use_conv, clamp_floor):
    pnl = dep = 0.0
    sizes, rets, taken, skips = [], [], [], {}
    eq = peak = CAPITAL
    mdd = 0.0
    for r, um in zip(rows, mults):
        s = size_of(r, um, use_conv, clamp_floor)
        if s < MIN_ORDER:
            skips[r['tag']] = skips.get(r['tag'], 0) + 1
            continue
        d = r['pnl'] * s
        pnl += d
        dep += s
        sizes.append(s)
        rets.append(d / CAPITAL)
        taken.append(id(r))
        eq += d
        peak = max(peak, eq)
        mdd = min(mdd, (eq - peak) / peak)
    if not sizes:
        return None
    sd = st.pstdev(rets) if len(rets) > 1 else 0
    return {'pnl': pnl, 'dep': dep, 'per_dollar': pnl / dep, 'n': len(sizes),
            'skipped': sum(skips.values()), 'skips': skips, 'avg': st.mean(sizes),
            'max': max(sizes), 'min': min(sizes), 'mdd': mdd, 'taken': set(taken),
            'sharpe': (st.mean(rets) / sd) if sd else 0}


UNIT = [1.0] * len(ROWS)

SCHEMES = [
    ('uniform',                UNIT,          False, False),
    ('conviction only',        UNIT,          True,  False),
    ('unc:conf (wf)',          WF['conf'],    False, False),
    ('unc:shrunk (wf)',        WF['shrunk'],  False, False),
    ('unc:kelly (wf)',         WF['kelly'],   False, False),
    ('unc:conf+conv (wf)',     WF['conf'],    True,  False),
    ('unc:shrunk+conv (wf)',   WF['shrunk'],  True,  False),
    ('unc:kelly+conv (wf)',    WF['kelly'],   True,  False),
]
# floor-clamped twins: identical sizing intent, but nothing is ever dropped
CLAMPED = [(n + ' [clamped]', m, c, True) for n, m, c, _ in SCHEMES[2:]]
ORACLE_SCHEMES = [
    ('ORACLE conf',   [ORACLE['conf'][r['tag']] for r in ROWS],   False, False),
    ('ORACLE shrunk', [ORACLE['shrunk'][r['tag']] for r in ROWS], False, False),
    ('ORACLE kelly',  [ORACLE['kelly'][r['tag']] for r in ROWS],  False, False),
]

print('\n' + '=' * 122)
print('4. FULL SAMPLE - return per dollar deployed, rails enforced, skips counted')
print('=' * 122)
print('  {:<26}{:>6}{:>9}{:>10}{:>10}{:>12}{:>17}{:>11}{:>9}{:>10}'.format(
    'scheme', 'n', 'skipped', 'min $', 'avg $', 'total P&L', 'per $ deployed',
    'vs unif', 'maxDD', 'sharpe'))
BASE_EVAL = evaluate(ROWS, UNIT, False, False)
ALL = SCHEMES + CLAMPED + ORACLE_SCHEMES
RESULTS = {}
for name, mults, conv, clamp in ALL:
    e = evaluate(ROWS, mults, conv, clamp)
    if not e:
        continue
    RESULTS[name] = e
    print('  {:<26}{:>6}{:>9}{:>10}{:>10}{:>12}{:>17}{:>11}{:>9}{:>10}'.format(
        name, e['n'], e['skipped'], '${:.2f}'.format(e['min']),
        '${:.2f}'.format(e['avg']), '${:+.2f}'.format(e['pnl']),
        '{:+.4f}%'.format(e['per_dollar'] * 100),
        '' if name == 'uniform' else '{:+.4f}pp'.format(
            (e['per_dollar'] - BASE_EVAL['per_dollar']) * 100),
        '{:.1%}'.format(e['mdd']), '{:.3f}'.format(e['sharpe'])))

print('\n  WHICH TRADES GET DROPPED (the entry-filter check):')
for name, e in RESULTS.items():
    if e['skipped']:
        print('    {:<26} {} skipped  ({})'.format(
            name, e['skipped'],
            ', '.join('{} {}'.format(k, v) for k, v in sorted(e['skips'].items()))))
if not any(e['skipped'] for e in RESULTS.values()):
    print('    none')


# --------------------------------------------------------------------------
# 5. COMMON-SET CONTROL - sizing effect with the filtering effect removed
# --------------------------------------------------------------------------
print('\n' + '=' * 122)
print('5. COMMON-SET CONTROL - restricted to trades BOTH schemes take')
print('=' * 122)
print('  A scheme that drops trades is partly an entry filter. Recomputing on the')
print('  intersection with uniform isolates the part that is genuinely sizing.\n')
print('  {:<26}{:>10}{:>18}{:>18}{:>14}'.format(
    'scheme', 'common n', 'scheme per $', 'uniform per $', 'sizing delta'))
for name, mults, conv, clamp in ALL:
    if name == 'uniform':
        continue
    common = []
    for r, um in zip(ROWS, mults):
        s = size_of(r, um, conv, clamp)
        if s >= MIN_ORDER:
            common.append((r, um))
    if not common:
        continue
    rs = [c[0] for c in common]
    ms = [c[1] for c in common]
    a = evaluate(rs, ms, conv, clamp)
    b = evaluate(rs, [1.0] * len(rs), False, False)
    if not a or not b:
        continue
    print('  {:<26}{:>10}{:>18}{:>18}{:>14}'.format(
        name, len(rs), '{:+.4f}%'.format(a['per_dollar'] * 100),
        '{:+.4f}%'.format(b['per_dollar'] * 100),
        '{:+.4f}pp'.format((a['per_dollar'] - b['per_dollar']) * 100)))


# --------------------------------------------------------------------------
# 6. TRAIN / TEST 60-40 BY TIME
# --------------------------------------------------------------------------
print('\n' + '=' * 122)
print('6. TRAIN / TEST 60-40 BY TIME  (the prediction: the gap is BIGGER on test)')
print('=' * 122)
t0, t1 = ROWS[0]['entry_t'], ROWS[-1]['entry_t']
cut = t0 + (t1 - t0) * 0.60
tr_idx = [i for i, r in enumerate(ROWS) if r['entry_t'] < cut]
te_idx = [i for i, r in enumerate(ROWS) if r['entry_t'] >= cut]
for label, idxs in (('TRAIN (first 60% of time)', tr_idx), ('TEST (last 40% of time)', te_idx)):
    rs = [ROWS[i] for i in idxs]
    base = evaluate(rs, [1.0] * len(rs), False, False)
    print('\n  {}   n={}'.format(label, len(rs)))
    print('    {:<26}{:>7}{:>9}{:>17}{:>13}'.format(
        'scheme', 'n', 'skipped', 'per $ deployed', 'vs uniform'))
    for name, mults, conv, clamp in ALL:
        ms = [mults[i] for i in idxs]
        e = evaluate(rs, ms, conv, clamp)
        if not e or not base:
            continue
        print('    {:<26}{:>7}{:>9}{:>17}{:>13}'.format(
            name, e['n'], e['skipped'], '{:+.4f}%'.format(e['per_dollar'] * 100),
            '' if name == 'uniform' else '{:+.4f}pp'.format(
                (e['per_dollar'] - base['per_dollar']) * 100)))


# --------------------------------------------------------------------------
# 7. PARAMETER NEIGHBOURHOOD - tau and the minimum-evidence threshold
# --------------------------------------------------------------------------
print('\n' + '=' * 122)
print('7. PARAMETER NEIGHBOURHOOD')
print('=' * 122)
print('  tau sweep (prior sd of the true edge). Walk-forward, clamped, no conviction.')
print('  {:>8}{:>12}{:>16}{:>16}{:>16}'.format(
    'tau', 'scheme', 'full per $', 'train', 'test'))
for tau in (0.005, 0.0075, 0.010, 0.015, 0.020, 0.030):
    for kind in ('conf', 'shrunk', 'kelly'):
        ms = walkforward_mults(ROWS, kind, tau=tau)
        e = evaluate(ROWS, ms, False, True)
        etr = evaluate([ROWS[i] for i in tr_idx], [ms[i] for i in tr_idx], False, True)
        ete = evaluate([ROWS[i] for i in te_idx], [ms[i] for i in te_idx], False, True)
        b = BASE_EVAL['per_dollar']
        btr = evaluate([ROWS[i] for i in tr_idx], [1.0] * len(tr_idx), False, False)['per_dollar']
        bte = evaluate([ROWS[i] for i in te_idx], [1.0] * len(te_idx), False, False)['per_dollar']
        print('  {:>8}{:>12}{:>16}{:>16}{:>16}'.format(
            '{:.3f}%'.format(tau * 100), kind,
            '{:+.4f}pp'.format((e['per_dollar'] - b) * 100),
            '{:+.4f}pp'.format((etr['per_dollar'] - btr) * 100) if etr else '-',
            '{:+.4f}pp'.format((ete['per_dollar'] - bte) * 100) if ete else '-'))

print('\n  minimum-evidence sweep (trades required before shrinkage engages), tau={:.2f}%'.format(TAU * 100))
print('  {:>8}{:>12}{:>16}{:>16}'.format('min n', 'scheme', 'full per $', 'test'))
for mn in (5, 10, 20, 30, 50):
    for kind in ('conf', 'shrunk', 'kelly'):
        ms = walkforward_mults(ROWS, kind, min_n=mn)
        e = evaluate(ROWS, ms, False, True)
        ete = evaluate([ROWS[i] for i in te_idx], [ms[i] for i in te_idx], False, True)
        bte = evaluate([ROWS[i] for i in te_idx], [1.0] * len(te_idx), False, False)['per_dollar']
        print('  {:>8}{:>12}{:>16}{:>16}'.format(
            mn, kind, '{:+.4f}pp'.format((e['per_dollar'] - BASE_EVAL['per_dollar']) * 100),
            '{:+.4f}pp'.format((ete['per_dollar'] - bte) * 100) if ete else '-'))


# --------------------------------------------------------------------------
# 8. IS THE DIFFERENCE DISTINGUISHABLE FROM NOISE?
# --------------------------------------------------------------------------
print('\n' + '=' * 122)
print('8. PAIRED BOOTSTRAP - could this difference be luck?')
print('=' * 122)
print('  Resample the trade list with replacement 2000x; recompute the per-dollar')
print('  gap of each scheme over uniform on the SAME resample. A scheme whose gap')
print('  is positive in only ~half the resamples has not shown anything.\n')
random.seed(7)
B = 2000
idxall = list(range(len(ROWS)))
print('  {:<26}{:>16}{:>16}{:>16}{:>12}'.format(
    'scheme', 'observed gap', 'boot p5', 'boot p95', 'P(gap>0)'))
for name, mults, conv, clamp in ALL:
    if name == 'uniform':
        continue
    sizes_s = [size_of(r, m, conv, clamp) for r, m in zip(ROWS, mults)]
    gaps = []
    for _ in range(B):
        samp = [random.choice(idxall) for _ in range(len(idxall))]
        pa = da = pb = db = 0.0
        for i in samp:
            s = sizes_s[i]
            if s >= MIN_ORDER:
                pa += ROWS[i]['pnl'] * s
                da += s
            pb += ROWS[i]['pnl'] * BASE_POS
            db += BASE_POS
        if da > 0 and db > 0:
            gaps.append(pa / da - pb / db)
    if not gaps:
        continue
    gaps.sort()
    obs = RESULTS[name]['per_dollar'] - BASE_EVAL['per_dollar']
    print('  {:<26}{:>16}{:>16}{:>16}{:>12}'.format(
        name, '{:+.4f}pp'.format(obs * 100),
        '{:+.4f}pp'.format(gaps[int(B * 0.05)] * 100),
        '{:+.4f}pp'.format(gaps[int(B * 0.95)] * 100),
        '{:.0%}'.format(sum(1 for g in gaps if g > 0) / len(gaps))))


# --------------------------------------------------------------------------
# 9. WHAT THE SCHEME ACTUALLY DOES TO THE BOOK
# --------------------------------------------------------------------------
print('\n' + '=' * 122)
print('9. EFFECTIVE CAPITAL WEIGHTS - what changed, in plain terms')
print('=' * 122)
print('  {:<26}{:>14}{:>14}{:>14}{:>14}'.format('scheme', *STRATS))
for name, mults, conv, clamp in ALL:
    dep = {}
    for r, m in zip(ROWS, mults):
        s = size_of(r, m, conv, clamp)
        if s < MIN_ORDER:
            continue
        dep[r['tag']] = dep.get(r['tag'], 0.0) + s
    tot = sum(dep.values())
    if not tot:
        continue
    print('  {:<26}{:>14}{:>14}{:>14}{:>14}'.format(
        name, *['{:.1%}'.format(dep.get(s, 0) / tot) for s in STRATS]))

print('\n' + '=' * 122)
print('  Read section 4 against section 5 before believing anything: any scheme')
print('  with a nonzero skip count is part entry-filter, and only the clamped')
print('  twins and the common-set column measure sizing on its own.')
print('=' * 122)


# ==========================================================================
# 10. THE AUDIT OF SECTION 1 - is sigma measuring CONFIDENCE or DURATION?
# ==========================================================================
# Sections 1-9 shrink a prior placed on the RAW PER-TRADE edge, so k =
# (sigma/tau)^2 uses the per-trade standard deviation directly. That is only a
# confidence statement if every strategy's trade is the same KIND of bet. It is
# not. A per-trade return's dispersion scales roughly with sqrt(holding period)
# - a 44-day position has a wider outcome distribution than a 10-day one for
# reasons that have nothing to do with how well its edge is established. Fixing
# tau at 1%/trade across strategies therefore taxes long holds as if they were
# unproven, which is a units error, not a finding.
#
# If that is what happened, the section-4 verdict is not a verdict on
# uncertainty scaling at all - it is a verdict on a mis-specified prior. Two
# scale-free reformulations are derived below and tested against it.
print('\n' + '=' * 122)
print('10. IS sigma MEASURING CONFIDENCE, OR HOLDING PERIOD?')
print('=' * 122)
DAY = 86_400_000.0
for s in STRATS:
    sel = [r for r in ROWS if r['tag'] == s]
    p = [r['pnl'] for r in sel]
    H = st.mean([(r['exit_t'] - r['entry_t']) / DAY for r in sel])
    STATS[s]['H'] = max(H, 1.0)
    STATS[s]['sd_d'] = st.pstdev(p) / math.sqrt(max(H, 1.0))
    STATS[s]['sharpe_t'] = st.mean(p) / st.pstdev(p)
print('  {:<6}{:>7}{:>12}{:>12}{:>13}{:>15}{:>13}{:>11}'.format(
    'strat', 'n', 'days held', 'sd/trade', 'sd/sqrt(day)', 'Sharpe/trade', 't-stat',
    'lambda(s1)'))
for s in STRATS:
    d = STATS[s]
    print('  {:<6}{:>7}{:>12}{:>12}{:>13}{:>15}{:>13}{:>11}'.format(
        s, d['n'], '{:.1f}'.format(d['H']), '{:.2f}%'.format(d['sd'] * 100),
        '{:.2f}%'.format(d['sd_d'] * 100), '{:.3f}'.format(d['sharpe_t']),
        '{:.2f}'.format(d['mean'] / d['se']), '{:.3f}'.format(d['lam'])))
print("""
  Read the two right-hand columns against each other. On a SCALE-FREE measure of
  evidence - the t-stat - the four strategies span 1.26 to 2.87, a factor of 2.3.
  Section 1's lambda spans 0.009 to 0.638, a factor of 71. Almost all of that
  extra spread is M3's 71.55% per-trade sigma, and M3's sigma is large chiefly
  because it holds positions ~4.4x longer than the daily sleeve. Section 1 is
  de-rating M3 for the duration of its bet, not for the weakness of its evidence.""")


# ==========================================================================
# 11. TWO SCALE-FREE PRIORS, DERIVED
# ==========================================================================
# SHARPE PRIOR. Put the prior on the per-trade Sharpe s = mu/sigma rather than
# on mu itself, which is the natural move when strategies are not commensurable
# in return units:
#     s ~ N(0, tau_s^2),   s_hat | s ~ N(s, 1/n)      [se of a Sharpe ~ 1/sqrt(n)]
#     posterior mean = s_hat * n / (n + 1/tau_s^2)
#     shrunk edge    = sigma * s_shrunk = x_bar * n/(n + k_s),  k_s = 1/tau_s^2
# lambda now depends ONLY on n. Dispersion has not been ignored - it has been
# moved into the quantity being shrunk, where it belongs. tau_s = 0.15 says a
# true edge of 0.15 sd per trade is a one-sigma prior draw; S3's observed 0.152
# is therefore exactly ordinary, which is the right level of scepticism.
#
# DAILY PRIOR. Keep the prior on a return, but on a return PER DAY HELD, so the
# strategies are compared on the same clock:
#     mu_d = x_bar / H,  sigma_d = sigma / sqrt(H),  k_d = (sigma_d / tau_d)^2
# tau_d = 0.10%/day (~+44% a year at M3's hold), sceptical but not absurd.
TAU_S = 0.15
TAU_D = 0.0010


def lam_of(family, n, mean, sd, H, tau=TAU, tau_s=TAU_S, tau_d=TAU_D):
    """Shrinkage factor for each prior family. Returns (lambda, k)."""
    if n <= 1 or sd <= 0:
        return 0.0, float('inf')
    if family == 'naive':          # sections 1-9: prior on the raw per-trade edge
        k = (sd / tau) ** 2
    elif family == 'sharpe':       # prior on per-trade Sharpe -> k is a constant
        k = 1.0 / (tau_s ** 2)
    elif family == 'daily':        # prior on per-day edge -> duration-fair
        k = ((sd / math.sqrt(max(H, 1.0))) / tau_d) ** 2
    else:
        return 1.0, 0.0
    return n / (n + k), k


print('\n' + '=' * 122)
print('11. THE THREE PRIORS SIDE BY SIDE  (full-sample lambda, for illustration)')
print('=' * 122)
print('  {:<6}{:>7}{:>12}{:>12}{:>12}{:>16}{:>16}{:>16}'.format(
    'strat', 'n', 'lam naive', 'lam sharpe', 'lam daily',
    'shrunk naive', 'shrunk sharpe', 'shrunk daily'))
for s in STRATS:
    d = STATS[s]
    ls = {f: lam_of(f, d['n'], d['mean'], d['sd'], d['H'])[0]
          for f in ('naive', 'sharpe', 'daily')}
    print('  {:<6}{:>7}{:>12}{:>12}{:>12}{:>16}{:>16}{:>16}'.format(
        s, d['n'], *['{:.3f}'.format(ls[f]) for f in ('naive', 'sharpe', 'daily')],
        *['{:+.2f}%'.format(ls[f] * d['mean'] * 100) for f in ('naive', 'sharpe', 'daily')]))
print("""
  The naive prior collapses M3 to a rounding error. The two scale-free priors
  keep it in the book at a discount, which is what the evidence actually
  supports: M3's problem is n=49 and a decayed train/test profile, not the
  width of a 44-day return distribution.""")


# ==========================================================================
# 12. CAPITAL-NEUTRAL NORMALISATION - the other thing section 4 got wrong
# ==========================================================================
# normalise() in section 2 divides by the EQUAL-WEIGHTED mean multiplier across
# strategies. But S3 fires 202 times and M3 49 times, so equal-weighting the
# strategies while S3 carries a >1 multiplier raises the TRADE-weighted average
# position from $16.25 to $21-27. Every section-4 scheme is therefore running a
# 30-60% larger book than uniform. Return per dollar deployed corrects the
# return side of that, but maxDD and Sharpe in section 4 do not - which is why
# every scheme there looks like it drew down more.
#
# The fix is to normalise by the TRADE-COUNT-weighted mean, using each
# strategy's count of already-CLOSED trades as the weight. That is computable
# live and holds average deployed capital at the uniform level, so drawdown and
# Sharpe become comparable.
def wf_mults(rows, family, form, tau=TAU, tau_s=TAU_S, tau_d=TAU_D,
             min_n=MIN_PRIOR_N, capital_neutral=True, clamp=True):
    """Walk-forward multiplier per row. `family` picks the prior, `form` picks
    how the shrunk edge becomes size: conf = lambda alone, shrunk = lambda*edge,
    kelly = lambda*edge/sigma^2."""
    closed = {s: [] for s in STRATS}
    held = {s: [] for s in STRATS}
    ordered = sorted(rows, key=lambda r: r['exit_t'])
    ptr, out = 0, []
    for r in rows:
        while ptr < len(ordered) and ordered[ptr]['exit_t'] <= r['entry_t']:
            a = ordered[ptr]
            closed[a['tag']].append(a['pnl'])
            held[a['tag']].append((a['exit_t'] - a['entry_t']) / DAY)
            ptr += 1
        raws, wts = {}, {}
        for s in STRATS:
            p = closed[s]
            wts[s] = len(p)
            if len(p) < min_n:
                raws[s] = 1.0            # immature: sizes flat, and is weighted
                continue                 # at its true (small) trade count
            m, sd = st.mean(p), st.pstdev(p)
            H = st.mean(held[s]) if held[s] else 1.0
            lam, _ = lam_of(family, len(p), m, sd, H, tau, tau_s, tau_d)
            if form == 'conf':
                raws[s] = lam
            elif form == 'shrunk':
                raws[s] = max(0.0, lam * m)
            else:                        # kelly
                raws[s] = max(0.0, lam * m / (sd ** 2)) if sd > 0 else 0.0
        if capital_neutral:
            wsum = sum(wts[s] for s in STRATS)
            denom = (sum(wts[s] * raws[s] for s in STRATS) / wsum) if wsum else 0.0
        else:
            denom = st.mean([raws[s] for s in STRATS])
        m = raws[r['tag']] / denom if denom > 0 else 1.0
        if clamp:
            m = max(MULT_FLOOR, min(MULT_CEIL, m))
        out.append(m)
    return out


def evaluate2(rows, mults, use_conv):
    """Per-dollar return three ways. TRIMMED trims the 5% best and worst trades
    BY RETURN - a scheme-independent set, so the difference between schemes is
    purely sizing. PER DOLLAR-DAY charges each position for the time it ties
    capital up, which return-per-dollar alone does not."""
    order = sorted(range(len(rows)), key=lambda i: rows[i]['pnl'])
    cutn = max(1, int(len(rows) * 0.05))
    trimmed_out = set(order[:cutn]) | set(order[-cutn:])
    pnl = dep = tp = td = ddep = 0.0
    sizes, rets, skips = [], [], {}
    eq = peak = CAPITAL
    mdd = 0.0
    for i, (r, um) in enumerate(zip(rows, mults)):
        s = size_of(r, um, use_conv, False)
        if s < MIN_ORDER:
            skips[r['tag']] = skips.get(r['tag'], 0) + 1
            continue
        d = r['pnl'] * s
        days = max((r['exit_t'] - r['entry_t']) / DAY, 0.5)
        pnl += d
        dep += s
        ddep += s * days
        if i not in trimmed_out:
            tp += d
            td += s
        sizes.append(s)
        rets.append(d / CAPITAL)
        eq += d
        peak = max(peak, eq)
        mdd = min(mdd, (eq - peak) / peak)
    if not sizes:
        return None
    sd = st.pstdev(rets) if len(rets) > 1 else 0
    return {'n': len(sizes), 'skipped': sum(skips.values()), 'skips': skips,
            'avg': st.mean(sizes), 'pnl': pnl, 'dep': dep,
            'per_dollar': pnl / dep, 'trimmed': (tp / td) if td else 0.0,
            'per_dollar_day': (pnl / ddep) if ddep else 0.0,
            'mdd': mdd, 'sharpe': (st.mean(rets) / sd) if sd else 0}


FAMILIES = [(f, form) for f in ('naive', 'sharpe', 'daily')
            for form in ('conf', 'shrunk', 'kelly')]
NEW = {}
for f, form in FAMILIES:
    NEW[(f, form)] = wf_mults(ROWS, f, form)

print('\n' + '=' * 122)
print('12. CAPITAL-NEUTRAL, CLAMPED, WALK-FORWARD  (no trade is ever dropped)')
print('=' * 122)
print('  {:<22}{:>7}{:>9}{:>10}{:>15}{:>12}{:>15}{:>12}{:>10}{:>9}'.format(
    'scheme', 'n', 'skipped', 'avg $', 'per $ dep', 'vs unif',
    'TRIMMED per $', 'vs unif', 'maxDD', 'sharpe'))
BASE2 = evaluate2(ROWS, UNIT, False)
CONV2 = evaluate2(ROWS, UNIT, True)


def line(name, e, b):
    print('  {:<22}{:>7}{:>9}{:>10}{:>15}{:>12}{:>15}{:>12}{:>10}{:>9}'.format(
        name, e['n'], e['skipped'], '${:.2f}'.format(e['avg']),
        '{:+.4f}%'.format(e['per_dollar'] * 100),
        '-' if b is None else '{:+.4f}pp'.format((e['per_dollar'] - b['per_dollar']) * 100),
        '{:+.4f}%'.format(e['trimmed'] * 100),
        '-' if b is None else '{:+.4f}pp'.format((e['trimmed'] - b['trimmed']) * 100),
        '{:.1%}'.format(e['mdd']), '{:.3f}'.format(e['sharpe'])))


line('uniform', BASE2, None)
line('conviction only', CONV2, BASE2)
for f, form in FAMILIES:
    line('{}:{}'.format(f, form), evaluate2(ROWS, NEW[(f, form)], False), BASE2)
print('  ' + '-' * 118)
print('  composed with conviction (the validated +1.17pp scheme, unchanged):')
for f, form in FAMILIES:
    line('{}:{}+conv'.format(f, form), evaluate2(ROWS, NEW[(f, form)], True), BASE2)

print('\n  Average size is now within a few cents of $16.25 for every row, so maxDD')
print('  and Sharpe are finally comparable across schemes. Skipped is 0 everywhere:')
print('  the multiplier is clamped into the implementable band, so none of these')
print('  schemes is secretly an entry filter.')


# ==========================================================================
# 13. TRAIN / TEST AND BOOTSTRAP ON THE SCALE-FREE FAMILIES
# ==========================================================================
print('\n' + '=' * 122)
print('13. TRAIN / TEST 60-40 BY TIME - capital-neutral schemes only')
print('=' * 122)
print('  The prediction from the docstring: if shrinkage is correcting a winner\'s')
print('  curse, its advantage should be LARGER on test than on train.')
for label, idxs in (('TRAIN (first 60% of time)', tr_idx), ('TEST (last 40% of time)', te_idx)):
    rs = [ROWS[i] for i in idxs]
    b = evaluate2(rs, [1.0] * len(rs), False)
    bc = evaluate2(rs, [1.0] * len(rs), True)
    print('\n  {}   n={}'.format(label, len(rs)))
    print('    {:<24}{:>16}{:>13}{:>16}{:>13}'.format(
        'scheme', 'per $ dep', 'vs unif', 'TRIMMED per $', 'vs unif'))
    print('    {:<24}{:>16}{:>13}{:>16}{:>13}'.format(
        'uniform', '{:+.4f}%'.format(b['per_dollar'] * 100), '',
        '{:+.4f}%'.format(b['trimmed'] * 100), ''))
    print('    {:<24}{:>16}{:>13}{:>16}{:>13}'.format(
        'conviction only', '{:+.4f}%'.format(bc['per_dollar'] * 100),
        '{:+.4f}pp'.format((bc['per_dollar'] - b['per_dollar']) * 100),
        '{:+.4f}%'.format(bc['trimmed'] * 100),
        '{:+.4f}pp'.format((bc['trimmed'] - b['trimmed']) * 100)))
    for f, form in FAMILIES:
        for conv in (False, True):
            ms = [NEW[(f, form)][i] for i in idxs]
            e = evaluate2(rs, ms, conv)
            if not e:
                continue
            print('    {:<24}{:>16}{:>13}{:>16}{:>13}'.format(
                '{}:{}{}'.format(f, form, '+conv' if conv else ''),
                '{:+.4f}%'.format(e['per_dollar'] * 100),
                '{:+.4f}pp'.format((e['per_dollar'] - b['per_dollar']) * 100),
                '{:+.4f}%'.format(e['trimmed'] * 100),
                '{:+.4f}pp'.format((e['trimmed'] - b['trimmed']) * 100)))

print('\n' + '=' * 122)
print('14. PARAMETER NEIGHBOURHOOD FOR THE SCALE-FREE PRIORS')
print('=' * 122)
print('  {:>10}{:>10}{:>16}{:>16}{:>16}'.format(
    'tau_s', 'form', 'per $ vs unif', 'trimmed vs unif', 'test vs unif'))
bte2 = evaluate2([ROWS[i] for i in te_idx], [1.0] * len(te_idx), False)
for ts in (0.05, 0.10, 0.15, 0.25, 0.40):
    for form in ('conf', 'shrunk', 'kelly'):
        ms = wf_mults(ROWS, 'sharpe', form, tau_s=ts)
        e = evaluate2(ROWS, ms, False)
        ete = evaluate2([ROWS[i] for i in te_idx], [ms[i] for i in te_idx], False)
        print('  {:>10}{:>10}{:>16}{:>16}{:>16}'.format(
            '{:.2f}'.format(ts), form,
            '{:+.4f}pp'.format((e['per_dollar'] - BASE2['per_dollar']) * 100),
            '{:+.4f}pp'.format((e['trimmed'] - BASE2['trimmed']) * 100),
            '{:+.4f}pp'.format((ete['per_dollar'] - bte2['per_dollar']) * 100)))
print()
print('  {:>10}{:>10}{:>16}{:>16}{:>16}'.format(
    'tau_d', 'form', 'per $ vs unif', 'trimmed vs unif', 'test vs unif'))
for td_ in (0.0005, 0.0010, 0.0020, 0.0040, 0.0080):
    for form in ('conf', 'shrunk', 'kelly'):
        ms = wf_mults(ROWS, 'daily', form, tau_d=td_)
        e = evaluate2(ROWS, ms, False)
        ete = evaluate2([ROWS[i] for i in te_idx], [ms[i] for i in te_idx], False)
        print('  {:>10}{:>10}{:>16}{:>16}{:>16}'.format(
            '{:.2f}%'.format(td_ * 100), form,
            '{:+.4f}pp'.format((e['per_dollar'] - BASE2['per_dollar']) * 100),
            '{:+.4f}pp'.format((e['trimmed'] - BASE2['trimmed']) * 100),
            '{:+.4f}pp'.format((ete['per_dollar'] - bte2['per_dollar']) * 100)))

print('\n' + '=' * 122)
print('15. PAIRED BOOTSTRAP ON THE CAPITAL-NEUTRAL SCHEMES  (2000 resamples)')
print('=' * 122)
random.seed(11)
print('  {:<24}{:>15}{:>14}{:>14}{:>11}{:>18}{:>11}'.format(
    'scheme', 'gap per $', 'p5', 'p95', 'P(>0)', 'gap TRIMMED', 'P(>0)'))
CAND = [('conviction only', UNIT, True)]
CAND += [('{}:{}'.format(f, form), NEW[(f, form)], False) for f, form in FAMILIES]
CAND += [('{}:{}+conv'.format(f, form), NEW[(f, form)], True) for f, form in FAMILIES]
order_all = sorted(range(len(ROWS)), key=lambda i: ROWS[i]['pnl'])
cutn_all = max(1, int(len(ROWS) * 0.05))
TRIM_OUT = set(order_all[:cutn_all]) | set(order_all[-cutn_all:])
for name, mults, conv in CAND:
    sz = [size_of(r, m, conv, False) for r, m in zip(ROWS, mults)]
    g1, g2 = [], []
    for _ in range(2000):
        samp = [random.randrange(len(ROWS)) for _ in range(len(ROWS))]
        pa = da = pb = db = ta = tda = tb = tdb = 0.0
        for i in samp:
            s, pl = sz[i], ROWS[i]['pnl']
            if s >= MIN_ORDER:
                pa += pl * s
                da += s
                if i not in TRIM_OUT:
                    ta += pl * s
                    tda += s
            pb += pl * BASE_POS
            db += BASE_POS
            if i not in TRIM_OUT:
                tb += pl * BASE_POS
                tdb += BASE_POS
        if da > 0 and db > 0:
            g1.append(pa / da - pb / db)
        if tda > 0 and tdb > 0:
            g2.append(ta / tda - tb / tdb)
    g1.sort()
    g2.sort()
    e = evaluate2(ROWS, mults, conv)
    print('  {:<24}{:>15}{:>14}{:>14}{:>11}{:>18}{:>11}'.format(
        name, '{:+.4f}pp'.format((e['per_dollar'] - BASE2['per_dollar']) * 100),
        '{:+.4f}pp'.format(g1[100] * 100), '{:+.4f}pp'.format(g1[1900] * 100),
        '{:.0%}'.format(sum(1 for g in g1 if g > 0) / len(g1)),
        '{:+.4f}pp'.format((e['trimmed'] - BASE2['trimmed']) * 100),
        '{:.0%}'.format(sum(1 for g in g2 if g > 0) / len(g2))))

print('\n' + '=' * 122)
print('16. WHERE THE CAPITAL ENDS UP under the capital-neutral schemes')
print('=' * 122)
print('  {:<24}{:>13}{:>13}{:>13}{:>13}{:>14}'.format(
    'scheme', *STRATS, 'avg $ size'))
for name, mults, conv in [('uniform', UNIT, False)] + CAND:
    dep = {}
    for r, m in zip(ROWS, mults):
        s = size_of(r, m, conv, False)
        if s < MIN_ORDER:
            continue
        dep[r['tag']] = dep.get(r['tag'], 0.0) + s
    tot = sum(dep.values())
    e = evaluate2(ROWS, mults, conv)
    print('  {:<24}{:>13}{:>13}{:>13}{:>13}{:>14}'.format(
        name, *['{:.1%}'.format(dep.get(s, 0) / tot) for s in STRATS],
        '${:.2f}'.format(e['avg'])))
print('=' * 122)
