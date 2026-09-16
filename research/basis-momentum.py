"""
B1 REFINEMENT: THE RATE OF CHANGE OF THE BASIS, NOT ITS LEVEL.

HYPOTHESIS (mechanism, stated before any code runs).

B1 works - it is the one reversion strategy in this book that survived - and the
stated reason is that it reverts against a REAL anchor. The perp and the spot
book price the same asset on the same venue. When the perp trades rich, someone
is paying a premium for levered exposure that an unlevered buyer of the actual
coin is not paying. Funding and the cash-and-carry arbitrage both pull that gap
shut, so the gap is a positioning extreme with a real force acting on it.

But B1 measures the LEVEL of that gap against its own trailing percentile, and a
level conflates two states that a forced-flow story says are opposites:

  STATE A - basis high and STILL CLIMBING. Levered longs are still being added
  faster than spot. Nobody is being forced out yet. Fading this is standing in
  front of the flow while it is still building; the premium can keep widening
  for as long as the leverage keeps arriving.

  STATE B - basis high and ALREADY ROLLING OVER. The premium peaked and is
  contracting. The marginal levered long has stopped arriving and existing ones
  are being closed - either voluntarily, or by the liquidation engine, which is
  the "cannot stop" part of the mechanism. The unwind is underway and the trade
  is riding it rather than fighting it.

If the mechanism is what the project believes it is, the rate of change should
separate A from B, and B should carry essentially all of B1's edge. That is a
FALSIFIABLE prediction, and the dose-response version of it - more negative
basis momentum at a high basis level gives a better short - is the single
strongest piece of mechanism evidence available in this harness.

WHAT IS BEING EVALUATED. Three separate things, and they are NOT judged the same
way:

  (a) A REFINEMENT of B1: same entries, gated on basis momentum. This will
      overlap ~1.0 with B1 by construction and that is fine. A refinement has to
      beat the thing it refines on TRIMMED expectancy and on the out-of-sample
      half, both, or it is just a smaller sample of the same trades.

  (b) A STANDALONE signal: basis momentum with no level condition at all. This
      is a NEW strategy and is judged by the full standard including overlap
      against S3 / D1 / B1 / M3.

  (c) ACCELERATION (second difference) added on top of (a). Judged as a
      refinement of the refinement, with a much higher bar, because by this
      point the multiple-testing count is real.

Also tested, because a negative would be informative and a positive would be
strong: B1 does not work on SOL. If momentum-conditioning rescues SOL, that is
evidence the momentum split is capturing something structural rather than
re-slicing three coins' worth of luck.

DATA LIMITATION, restated because it does not go away: HL spot starts 2024-11
(HYPE) to 2025-05 (SOL). Everything here lives inside one broad market period,
the coins are highly correlated, and the pooled n is not four independent
samples. Any conclusion is provisional on that.
"""
import sys, datetime, statistics as st

sys.path.insert(0, 'research')
import engine, pooled, hl_data
from strategies_basis import basis_dislocation, build_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout

SPOT = {'BTC': '@142', 'ETH': '@151', 'SOL': '@156', 'HYPE': '@107'}
B1_COINS = ['BTC', 'ETH', 'HYPE']       # shipped B1 basket - it does NOT work on SOL
ALL_COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
RT = 2 * (engine.TAKER_FEE + engine.SLIPPAGE)      # 0.190% modelled round trip

# Shipped B1 operating point. Nothing below changes any of these; the only thing
# added is the momentum gate. Changing two things at once would make it
# impossible to attribute an improvement.
BASE = {'pct': 0.90, 'win': 180, 'atr_mult': 2.5, 'max_hold': 7, 'min_hist': 60}

VARIANTS = 0            # honest multiple-testing counter, incremented per config run
_cache = {}


# ----------------------------------------------------------------------------
# data
# ----------------------------------------------------------------------------
def load(coin):
    if coin in _cache:
        return _cache[coin]
    perp, fund = pooled.load(coin)
    spot, _ = hl_data.get_candles(SPOT[coin], '1d', 1200)
    basis = build_basis(perp, spot)
    first = next((i for i, b in enumerate(basis) if b is not None), 0)
    _cache[coin] = (perp, fund, basis, first)
    return _cache[coin]


def roc(basis, k):
    """Basis rate of change over k days, in basis units (a fraction, not a %).

    None-propagating on purpose: a missing spot print must not silently become a
    zero change, which would read as 'flat basis' and let a trade through the
    gate on absent data."""
    out = []
    for i in range(len(basis)):
        if i < k or basis[i] is None or basis[i - k] is None:
            out.append(None)
        else:
            out.append(basis[i] - basis[i - k])
    return out


def second_diff(mom, k):
    """Acceleration: change in the rate of change. Same None discipline."""
    out = []
    for i in range(len(mom)):
        if i < k or mom[i] is None or mom[i - k] is None:
            out.append(None)
        else:
            out.append(mom[i] - mom[i - k])
    return out


# ----------------------------------------------------------------------------
# signal factories
# ----------------------------------------------------------------------------
def basis_mom_dislocation(params):
    """B1's exact rules, plus a momentum gate on the ENTRY only.

    gate:
      'off'  - identical to shipped B1 (used as the in-script parity control).
      'turn' - short only when the basis is already falling (the unwind has
               begun); long only when it is already rising. This is the
               hypothesis.
      'with' - the inverse gate: short only while the basis is still climbing.
               Run purely as a falsification control. If 'with' is as good as
               'turn' the momentum split is capturing nothing.

    mom_thr is a magnitude in basis units: 0.0 means 'any roll-over at all',
    larger values demand a faster one. Sweeping it is the dose-response test.

    accel_gate, when on, additionally requires the roll-over to be accelerating.
    """
    pct, win, atr_mult = params['pct'], params['win'], params['atr_mult']
    max_hold, min_hist = params['max_hold'], params.get('min_hist', 60)
    basis, mom = params['basis'], params['mom']
    accel = params.get('accel')
    gate = params.get('gate', 'off')
    thr = params.get('mom_thr', 0.0)
    accel_gate = params.get('accel_gate', False)
    both = params.get('both_sides', True)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
            atr = state['atr'][i]
            b = basis[i] if i < len(basis) else None
            if atr is None or b is None:
                return None

            hist = [x for x in basis[max(0, i - win):i + 1] if x is not None]
            if len(hist) < min_hist:
                return None
            hs = sorted(hist)
            hi = hs[min(len(hs) - 1, int(len(hs) * pct))]
            lo = hs[max(0, int(len(hs) * (1 - pct)))]
            med = hs[len(hs) // 2]

            # Exits are UNCHANGED from B1. The claim under test is about entry
            # selection; changing the exit too would confound the attribution.
            if pos is not None:
                if i - pos['entry_i'] >= max_hold:
                    return {'exit': True, 'reason': 'timeout'}
                if pos['dir'] == 'short' and b <= med:
                    return {'exit': True, 'reason': 'basis normalised'}
                if pos['dir'] == 'long' and b >= med:
                    return {'exit': True, 'reason': 'basis normalised'}
                return None

            m = mom[i] if i < len(mom) else None
            if gate != 'off' and m is None:
                return None
            a = accel[i] if (accel_gate and accel and i < len(accel)) else None
            if accel_gate and a is None:
                return None

            px = bars[i]['c']
            if b >= hi:
                if gate == 'turn' and not (m <= -thr):
                    return None
                if gate == 'with' and not (m >= thr):
                    return None
                if accel_gate and not (a <= 0):
                    return None
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'rich {:+.3f}% roc {:+.3f}%'.format(
                            b * 100, (m or 0) * 100)}
            if both and b <= lo:
                if gate == 'turn' and not (m >= thr):
                    return None
                if gate == 'with' and not (m <= -thr):
                    return None
                if accel_gate and not (a >= 0):
                    return None
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'cheap {:+.3f}% roc {:+.3f}%'.format(
                            b * 100, (m or 0) * 100)}
            return None
        return sig
    return factory


def basis_momentum_only(params):
    """STANDALONE: trade the rate of change with NO level condition.

    Direction follows the same forced-flow story as the gate: a basis that is
    contracting sharply means levered longs are being closed, so the perp should
    keep underperforming - SHORT. A basis expanding sharply means levered longs
    are arriving - LONG. Thresholds are trailing percentiles of the momentum's
    own distribution, never full-sample, so there is no lookahead in the cut.

    If this comes out strongly NEGATIVE the inverse would be the tradable claim,
    and it must be said out loud rather than quietly re-signed - flipping a
    strategy's sign after seeing its result is a free parameter.
    """
    pct, win, atr_mult = params['pct'], params['win'], params['atr_mult']
    max_hold, min_hist = params['max_hold'], params.get('min_hist', 60)
    mom = params['mom']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
            atr = state['atr'][i]
            m = mom[i] if i < len(mom) else None
            if atr is None or m is None:
                return None
            hist = [x for x in mom[max(0, i - win):i + 1] if x is not None]
            if len(hist) < min_hist:
                return None
            hs = sorted(hist)
            hi = hs[min(len(hs) - 1, int(len(hs) * pct))]
            lo = hs[max(0, int(len(hs) * (1 - pct)))]

            if pos is not None:
                if i - pos['entry_i'] >= max_hold:
                    return {'exit': True, 'reason': 'timeout'}
                # the momentum reversing is the signal going away
                if pos['dir'] == 'short' and m >= 0:
                    return {'exit': True, 'reason': 'roc flat'}
                if pos['dir'] == 'long' and m <= 0:
                    return {'exit': True, 'reason': 'roc flat'}
                return None

            px = bars[i]['c']
            if m <= lo:
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'basis contracting {:+.3f}%'.format(m * 100)}
            if m >= hi:
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'basis expanding {:+.3f}%'.format(m * 100)}
            return None
        return sig
    return factory


# ----------------------------------------------------------------------------
# pooled runner
# ----------------------------------------------------------------------------
def run(factory_fn, params, coins, label='x', count=True, **kw):
    global VARIANTS
    if count:
        VARIANTS += 1
    merged = engine.Result(coin='POOL', name=label)
    per = {}
    k = params.get('mom_k', 0)
    for c in coins:
        perp, fund, basis, first = load(c)
        p = dict(params)
        p['basis'] = basis
        p['mom'] = roc(basis, k) if k else [None] * len(basis)
        if params.get('accel_gate'):
            p['accel'] = second_diff(p['mom'], k)
        warm = first + p.get('min_hist', 60) + 2 * k
        if len(perp) < warm + 40:
            continue
        r = engine.backtest(perp, factory_fn(p)(), c, fund, name=label,
                            warmup=warm, **kw)
        per[c] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


def row(label, r, extra=''):
    if r is None or r.n == 0:
        print('  {:<30} NO TRADES'.format(label))
        return
    print('  {:<30} n={:<4} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%} exBest3={:>7.2%} '
          'med={:>7.2%} n/yr={:>5.1f} {}'.format(
              label, r.n, r.win_rate, r.expectancy, r.trimmed_expectancy(0.05),
              r.expectancy_ex_best(3), r.median_trade, r.trades_per_year(), extra))


def tt(label, r):
    """One line plus its train/test split - the decisive comparison here."""
    a, b = pooled.pooled_split(r)
    row(label, r)
    print('      train(60%) n={:<4} exp={:>7.2%} trim5={:>7.2%}   |   '
          'test(40%) n={:<4} exp={:>7.2%} trim5={:>7.2%}'.format(
              a.n if a else 0, a.expectancy if a else 0,
              a.trimmed_expectancy(0.05) if a else 0,
              b.n if b else 0, b.expectancy if b else 0,
              b.trimmed_expectancy(0.05) if b else 0))
    return a, b


def hr(title):
    print('\n' + '=' * 118)
    print(title)
    print('=' * 118)


# ============================================================================
# PART 0 - what the momentum series actually looks like
# ============================================================================
hr('PART 0 - BASIS AND ITS RATE OF CHANGE: descriptive, before any strategy')
for c in ALL_COINS:
    perp, fund, basis, first = load(c)
    vals = [b for b in basis if b is not None]
    m3 = [x for x in roc(basis, 3) if x is not None]
    if not vals or not m3:
        continue
    # autocorrelation of the 3d change - if the roll-over persists at all, a
    # gate on it has something to condition on; if it is white noise it cannot.
    s = [x for x in roc(basis, 3)]
    pairs = [(s[i - 1], s[i]) for i in range(1, len(s)) if s[i] is not None and s[i - 1] is not None]
    if len(pairs) > 30:
        xs = [p[0] for p in pairs]
        ys = [p[1] for p in pairs]
        mx, my = st.mean(xs), st.mean(ys)
        cov = sum((a - mx) * (b - my) for a, b in pairs) / len(pairs)
        ac = cov / (st.pstdev(xs) * st.pstdev(ys)) if st.pstdev(xs) and st.pstdev(ys) else 0
    else:
        ac = float('nan')
    print('  {:<5} valid basis days={:<5} median={:+.4f}%  sd={:.4f}%  |  d3 sd={:.4f}%  '
          'lag1 autocorr(d3)={:+.2f}  first valid i={}'.format(
              c, len(vals), st.median(vals) * 100, st.pstdev(vals) * 100,
              st.pstdev(m3) * 100, ac, first))

# ============================================================================
# PART 1 - MECHANISM MEASUREMENT (no strategy, no stops, no costs)
# ============================================================================
hr('PART 1 - MECHANISM: at a HIGH basis, does the sign of the basis ROC split '
   'forward returns?')
print('  Trailing 180d percentile cut (no lookahead). "fade P&L" = the raw return to')
print('  SHORTING a high basis / LONGING a low basis, gross of costs. Positive = the')
print('  fade worked. Split by the 3-day basis rate of change on the signal day.')

HORIZONS = [3, 7]
buckets = {}
for c in ALL_COINS:
    perp, fund, basis, first = load(c)
    m3 = roc(basis, 3)
    win, pct, min_hist = 180, 0.90, 60
    for i in range(first + min_hist, len(perp) - max(HORIZONS) - 1):
        b, m = basis[i], m3[i]
        if b is None or m is None:
            continue
        hist = [x for x in basis[max(0, i - win):i + 1] if x is not None]
        if len(hist) < min_hist:
            continue
        hs = sorted(hist)
        hi = hs[min(len(hs) - 1, int(len(hs) * pct))]
        lo = hs[max(0, int(len(hs) * (1 - pct)))]
        side = None
        if b >= hi:
            side = -1                    # would short
        elif b <= lo:
            side = +1                    # would long
        if side is None:
            continue
        # the gate's own definition: does the basis roll TOWARD the fade?
        turning = (m <= 0) if side == -1 else (m >= 0)
        for h in HORIZONS:
            fwd = (perp[i + h]['c'] - perp[i]['c']) / perp[i]['c']
            key = (h, 'turning' if turning else 'still building')
            buckets.setdefault(key, []).append(side * fwd)
            buckets.setdefault((h, 'ALL'), []).append(side * fwd)

for h in HORIZONS:
    print('\n  --- {}d forward, all 4 coins pooled ---'.format(h))
    for k in ('ALL', 'turning', 'still building'):
        v = buckets.get((h, k), [])
        if not v:
            continue
        print('    {:<18} n={:<5} mean fade P&L={:+.2f}%  median={:+.2f}%  '
              'hit rate={:.1%}'.format(k, len(v), st.mean(v) * 100,
                                       st.median(v) * 100,
                                       sum(1 for x in v if x > 0) / len(v)))

hr('PART 1b - DOSE-RESPONSE: quintiles of basis ROC on high/low-basis days')
print('  Q1 = basis moving hardest AGAINST the fade (still building), '
      'Q5 = rolling over hardest.')
print('  The mechanism predicts a MONOTONIC rise Q1 -> Q5. Flat = no mechanism.')
rows = []
for c in ALL_COINS:
    perp, fund, basis, first = load(c)
    m3 = roc(basis, 3)
    for i in range(first + 60, len(perp) - 8):
        b, m = basis[i], m3[i]
        if b is None or m is None:
            continue
        hist = [x for x in basis[max(0, i - 180):i + 1] if x is not None]
        if len(hist) < 60:
            continue
        hs = sorted(hist)
        if b >= hs[min(len(hs) - 1, int(len(hs) * 0.90))]:
            side = -1
        elif b <= hs[max(0, int(len(hs) * 0.10))]:
            side = +1
        else:
            continue
        # signed so that a LARGER value always means "rolling over harder"
        rolling = -m if side == -1 else m
        rows.append((rolling, side * (perp[i + 3]['c'] - perp[i]['c']) / perp[i]['c'],
                     side * (perp[i + 7]['c'] - perp[i]['c']) / perp[i]['c']))
rows.sort(key=lambda r: r[0])
q = max(1, len(rows) // 5)
for k in range(5):
    seg = rows[k * q: (k + 1) * q if k < 4 else len(rows)]
    if not seg:
        continue
    print('    Q{}  n={:<4} roc range [{:+.3f}%,{:+.3f}%]  fade P&L 3d={:+.2f}%  '
          '7d={:+.2f}%'.format(k + 1, len(seg), seg[0][0] * 100, seg[-1][0] * 100,
                               st.mean([r[1] for r in seg]) * 100,
                               st.mean([r[2] for r in seg]) * 100))

# ============================================================================
# PART 2 - (a) THE REFINEMENT: B1 gated on basis momentum
# ============================================================================
hr('PART 2 - (a) REFINEMENT. Baseline is shipped B1 on BTC/ETH/HYPE. '
   'Judge on trimmed + test.')
_, b1 = run(basis_dislocation, BASE, B1_COINS, 'B1 shipped', count=False)
tt('B1 shipped (baseline)', b1)

print()
for k in (1, 3, 5):
    p = dict(BASE, mom_k=k, gate='turn', mom_thr=0.0)
    _, m = run(basis_mom_dislocation, p, B1_COINS, 'turn k={}'.format(k))
    tt('gate=turn  roc({}d)<=0'.format(k), m)

print('\n  FALSIFICATION CONTROL - the inverse gate. If these look the same as')
print('  the above, the split is noise, not a mechanism.')
for k in (1, 3, 5):
    p = dict(BASE, mom_k=k, gate='with', mom_thr=0.0)
    _, m = run(basis_mom_dislocation, p, B1_COINS, 'with k={}'.format(k))
    tt('gate=with  roc({}d)>=0'.format(k), m)

hr('PART 2b - DOSE-RESPONSE ON THE GATE THRESHOLD (k=3). '
   'Stronger roll-over required = stronger result?')
for thr in (0.0, 0.0005, 0.0010, 0.0020, 0.0040):
    p = dict(BASE, mom_k=3, gate='turn', mom_thr=thr)
    _, m = run(basis_mom_dislocation, p, B1_COINS, 'thr {}'.format(thr))
    row('roc(3d) <= -{:.2f}%'.format(thr * 100), m)

# ============================================================================
# PART 3 - (b) STANDALONE basis momentum
# ============================================================================
hr('PART 3 - (b) STANDALONE basis momentum, no level condition. '
   'This is a NEW strategy and gets the full bar.')
for k in (1, 3):
    for pct in (0.80, 0.90, 0.95):
        p = dict(BASE, mom_k=k, pct=pct)
        _, m = run(basis_momentum_only, p, B1_COINS, 'mom-only')
        row('roc({}d) pct={:.2f}'.format(k, pct), m)

print('\n  Same, on all four coins (momentum may not share the level signal\'s '
      'SOL problem):')
for k in (1, 3):
    p = dict(BASE, mom_k=k, pct=0.90)
    _, m = run(basis_momentum_only, p, ALL_COINS, 'mom-only all')
    tt('roc({}d) pct=0.90 ALL4'.format(k), m)

# ============================================================================
# PART 4 - (c) ACCELERATION
# ============================================================================
hr('PART 4 - (c) ACCELERATION: does requiring the roll-over to be SPEEDING UP '
   'add anything?')
for k in (3, 5):
    p = dict(BASE, mom_k=k, gate='turn', mom_thr=0.0, accel_gate=True)
    _, m = run(basis_mom_dislocation, p, B1_COINS, 'accel k={}'.format(k))
    tt('turn + accel({}d)<=0'.format(k), m)

# ============================================================================
# PART 5 - does momentum-conditioning rescue SOL?
# ============================================================================
hr('PART 5 - SOL. B1 fails there. If the gate rescues it, that is structural '
   'evidence.')
for label, fn, p in (('B1 shipped', basis_dislocation, dict(BASE)),
                     ('gate=turn k=1', basis_mom_dislocation, dict(BASE, mom_k=1, gate='turn')),
                     ('gate=turn k=3', basis_mom_dislocation, dict(BASE, mom_k=3, gate='turn')),
                     ('gate=turn k=5', basis_mom_dislocation, dict(BASE, mom_k=5, gate='turn'))):
    _, m = run(fn, p, ['SOL'], 'SOL ' + label, count=(label != 'B1 shipped'))
    row('SOL  ' + label, m)

print('\n  And the full 4-coin basket under the gate (BTC/ETH/SOL/HYPE):')
for k in (1, 3):
    p = dict(BASE, mom_k=k, gate='turn')
    _, m = run(basis_mom_dislocation, p, ALL_COINS, 'all4 k={}'.format(k))
    tt('ALL4 gate=turn k={}'.format(k), m)
_, b1all = run(basis_dislocation, BASE, ALL_COINS, 'B1 all4', count=False)
row('ALL4 B1 shipped (control)', b1all)

# ============================================================================
# PART 6 - full gate on the pre-registered candidate (k=3, thr=0)
# ============================================================================
hr('PART 6 - FULL GATE on the PRE-REGISTERED candidate: gate=turn, roc(3d)<=0, '
   'BTC/ETH/HYPE')
CAND = dict(BASE, mom_k=3, gate='turn', mom_thr=0.0)
_, cand = run(basis_mom_dislocation, CAND, B1_COINS, 'CAND', count=False)
per_c, _ = run(basis_mom_dislocation, CAND, B1_COINS, 'CAND', count=False)

print('\n  per-coin:')
for c in B1_COINS:
    if c in per_c:
        row(c, per_c[c])

print('\n  per calendar year (candidate vs shipped B1):')
yc = dict(pooled.pooled_yearly(cand))
yb = dict(pooled.pooled_yearly(b1))
for y in sorted(set(yc) | set(yb)):
    a, b = yc.get(y), yb.get(y)
    print('    {}  cand n={:<4} exp={:>7.2%}   |   B1 n={:<4} exp={:>7.2%}'.format(
        y, a.n if a else 0, a.expectancy if a else 0,
        b.n if b else 0, b.expectancy if b else 0))

print('\n  half-year stability:')
for name, r in (('cand', cand), ('B1', b1)):
    halves = {}
    for t in r.trades:
        d = datetime.datetime.utcfromtimestamp(t.entry_t / 1000)
        halves.setdefault('{}H{}'.format(d.year, 1 if d.month <= 6 else 2), []).append(t)
    line = '  '.join('{}:{:+.2f}%(n{})'.format(k, st.mean([t.pnl_pct for t in halves[k]]) * 100,
                                               len(halves[k])) for k in sorted(halves))
    pos = sum(1 for k in halves if st.mean([t.pnl_pct for t in halves[k]]) > 0)
    print('    {:<5} {}/{} positive   {}'.format(name, pos, len(halves), line))

print('\n  cost stress (annual drag = trades/yr x 0.190%):')
for mult in (1, 2, 4):
    _, mm = run(basis_mom_dislocation, CAND, B1_COINS, 'cost', count=False,
                slippage=engine.SLIPPAGE * mult, fee=engine.TAKER_FEE * mult)
    _, bb = run(basis_dislocation, BASE, B1_COINS, 'cost', count=False,
                slippage=engine.SLIPPAGE * mult, fee=engine.TAKER_FEE * mult)
    print('    {}x ({:.2f}% RT)  cand exp={:>7.2%} trim5={:>7.2%}  |  '
          'B1 exp={:>7.2%} trim5={:>7.2%}'.format(
              mult, RT * mult * 100, mm.expectancy, mm.trimmed_expectancy(0.05),
              bb.expectancy, bb.trimmed_expectancy(0.05)))
print('    cand drag {:.1f}%/yr of notional (pooled over {} coins) vs B1 {:.1f}%/yr'.format(
    cand.trades_per_year() * RT * 100, len(B1_COINS), b1.trades_per_year() * RT * 100))

print('\n  parameter neighbourhood around the candidate (each nudged alone):')
nb = []
for key, vals in (('pct', [0.85, 0.95]), ('win', [120, 250]),
                  ('max_hold', [5, 10]), ('atr_mult', [2.0, 3.0]),
                  ('mom_k', [2, 4])):
    for v in vals:
        p = dict(CAND)
        p[key] = v
        _, mm = run(basis_mom_dislocation, p, B1_COINS, 'nb')
        if mm.n == 0:
            continue
        t1, t2 = pooled.pooled_split(mm)
        nb.append(mm.trimmed_expectancy(0.05))
        print('    {:<10}={:<6} n={:<4} exp={:>7.2%} trim5={:>7.2%} train={:>7.2%} '
              'test={:>7.2%}'.format(key, v, mm.n, mm.expectancy,
                                     mm.trimmed_expectancy(0.05),
                                     t1.expectancy if t1 else 0, t2.expectancy if t2 else 0))
print('    -> {}/{} neighbours positive on trimmed'.format(
    sum(1 for x in nb if x > 0), len(nb)))

# ============================================================================
# PART 7 - overlap
# ============================================================================
hr('PART 7 - OVERLAP. For the refinement ~1.0 vs B1 is EXPECTED and fine. '
   'It matters for the standalone.')
S3P = {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}
D1P = {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}
for c in B1_COINS:
    perp, fund, basis, first = load(c)
    warm = first + 60 + 6
    pc = dict(CAND, basis=basis, mom=roc(basis, 3))
    pb = dict(BASE, basis=basis)
    pm = dict(BASE, mom_k=3, basis=basis, mom=roc(basis, 3))
    s_cand, _ = pooled.position_series(perp, lambda q: basis_mom_dislocation(q), pc, c, fund, warm)
    s_b1, _ = pooled.position_series(perp, lambda q: basis_dislocation(q), pb, c, fund, warm)
    s_mom, _ = pooled.position_series(perp, lambda q: basis_momentum_only(q), pm, c, fund, warm)
    s_s3, _ = pooled.position_series(perp, volume_spike, S3P, c, fund, 60)
    s_d1, _ = pooled.position_series(perp, range_breakout, D1P, c, fund, 60)
    def ov(a, b):
        v, n = pooled.overlap(a, b)
        return 'n/a' if v is None else '{:.2f}(n{})'.format(v, n)
    print('  {:<5} cand-vs-B1 {:<12} momonly-vs-B1 {:<12} momonly-vs-S3 {:<12} '
          'momonly-vs-D1 {}'.format(c, ov(s_cand, s_b1), ov(s_mom, s_b1),
                                    ov(s_mom, s_s3), ov(s_mom, s_d1)))

hr('VARIANT COUNT')
print('  {} distinct configurations evaluated (baselines and cost/overlap re-runs '
      'excluded, they are not searches).'.format(VARIANTS))

# ============================================================================
# PART 8 - THE TEST THIS WHOLE RESULT TURNS ON
#
# The gate keeps 24 of B1's 134 trades. Any subset of 134 trades has a
# distribution of possible means; the question is not "is 2.34% > 2.16%" but
# "is picking these particular 24 distinguishable from picking 24 at random".
# Without this, a 12% relative improvement on an 82% discarded sample is not
# evidence of anything. This is the same reasoning that killed the intraday
# work, applied to a case where the headline number looks good.
# ============================================================================
import random

hr('PART 8 - RANDOMISATION: is the gated subset better than a random subset of '
   'the same size?')
random.seed(20260907)
cand_t = {(t.coin, t.entry_t) for t in cand.trades}
b1_t = {(t.coin, t.entry_t) for t in b1.trades}
print('  candidate trades that are literally B1 trades: {}/{} '
      '(the rest are re-sequenced, see note)'.format(
          len(cand_t & b1_t), len(cand_t)))

pool_pnl = [t.pnl_pct for t in b1.trades]


def trimmed(v, frac=0.05):
    if len(v) < 10:
        return sum(v) / len(v)
    s = sorted(v)
    k = max(1, int(len(v) * frac))
    core = s[k:-k]
    return sum(core) / len(core) if core else 0.0


for label, r in (('gate=turn k=3 (candidate)', cand),
                 ('gate=turn k=1', run(basis_mom_dislocation,
                                       dict(BASE, mom_k=1, gate='turn'),
                                       B1_COINS, 'k1', count=False)[1])):
    m = len(r.trades)
    obs_e, obs_t = r.expectancy, r.trimmed_expectancy(0.05)
    draws_e, draws_t = [], []
    for _ in range(20000):
        s = random.sample(pool_pnl, m)
        draws_e.append(sum(s) / m)
        draws_t.append(trimmed(s))
    pe = sum(1 for x in draws_e if x >= obs_e) / len(draws_e)
    pt = sum(1 for x in draws_t if x >= obs_t) / len(draws_t)
    print('  {:<26} n={:<3} exp={:+.2f}% -> p={:.3f} vs random subsets   '
          'trim5={:+.2f}% -> p={:.3f}'.format(label, m, obs_e * 100, pe,
                                              obs_t * 100, pt))
print('  (p is the fraction of random same-size subsets of B1 that did at least '
      'as well.\n   p<0.05 would mean the gate selects; anything near 0.3-0.5 '
      'means it does not.)')

hr('PART 9 - WHY THE GATE IS NEARLY EMPTY (a structural point, not a result)')
tot = fall = 0
for c in ALL_COINS:
    perp, fund, basis, first = load(c)
    m3 = roc(basis, 3)
    for i in range(first + 60, len(perp) - 8):
        b, m = basis[i], m3[i]
        if b is None or m is None:
            continue
        hist = [x for x in basis[max(0, i - 180):i + 1] if x is not None]
        if len(hist) < 60:
            continue
        hs = sorted(hist)
        if b >= hs[min(len(hs) - 1, int(len(hs) * 0.90))]:
            tot += 1
            fall += 1 if m <= 0 else 0
print('  On days where the basis is at/above its trailing 90th percentile, the '
      '3d change\n  is negative only {}/{} = {:.1%} of the time. A trailing-'
      'percentile HIGH is\n  almost by construction a basis that just ROSE - the '
      'level and its rate of change\n  are mechanically coupled, so "high and '
      'already rolling over" is a near-empty set,\n  not an independent second '
      'condition.'.format(fall, tot, fall / tot if tot else 0))


# ============================================================================
# VERDICT - written after the run, quoting the numbers the run produced.
#
# REJECTED. All three questions answered negative, and the mechanism test that
# runs BEFORE any strategy is the one that kills it.
#
# (a) REFINEMENT of B1 - REJECTED.
#     The headline looks like a pass: gate=turn roc(3d)<=0 gives exp +2.34% vs
#     B1's +2.16%, trimmed +2.09% vs +1.87%, test +3.93% vs +2.69%. Every one of
#     the four required comparisons improves. It is still rejected, for four
#     reasons that all point the same way:
#       - PART 1 says the hypothesis is BACKWARDS. Gross of costs and stops, at
#         a high basis the days where it is ALREADY ROLLING OVER pay +0.86% (3d)
#         / +0.19% (7d), and the days where it is STILL BUILDING pay +1.58% /
#         +2.48%. The gate selects the worse half of the raw signal. State A is
#         the better fade, not the dangerous one.
#       - PART 2b's DOSE-RESPONSE IS INVERTED, which is the strongest evidence
#         available here and it points down: requiring a faster roll-over gives
#         +2.34% -> +0.72% -> -7.51% -> -8.14% -> -13.37%. More of the supposed
#         signal is monotonically worse.
#       - PART 8: the 24 gated trades are indistinguishable from 24 trades drawn
#         AT RANDOM from B1's 134 (p=0.444 on both mean and trimmed). The 12%
#         relative improvement is what a random 24-trade subset does routinely.
#       - PART 9 explains why it could never have worked: a trailing-percentile
#         basis HIGH is, almost by construction, a basis that just ROSE. The 3d
#         change is negative on only 7.9% of those days. Level and rate of change
#         are mechanically coupled, so "high and already rolling over" is a
#         near-empty set, not an independent second condition. The gate discards
#         82% of the sample to buy a state that barely exists.
#     Note also that only 4 of the candidate's 24 trades are literally B1 trades:
#     skipping entries frees the book to take LATER entries B1 was too busy for,
#     so this is not even a clean filter of B1 and the difference cannot be
#     attributed to the gate alone.
#
# (b) STANDALONE basis momentum - REJECTED, cleanly. All 6 configurations
#     negative (-0.27% to -1.35% net, trimmed negative in all 6), on 3 coins and
#     on 4. Its overlap with B1 is only 0.09-0.17, so this genuinely IS a
#     different signal - it is just a losing one. Flipping its sign is not on the
#     table: that would be a free parameter chosen after seeing the result.
#
# (c) ACCELERATION - adds literally nothing. At k=3 the accel gate binds on zero
#     of the 24 trades (identical result to the row above it); at k=5 it makes
#     things worse (+1.26% vs +1.68%).
#
# SOL is NOT rescued. Gated SOL gives +4.41% (k=1, n=10), -3.20% (k=3, n=7),
# +3.52% (k=5, n=3). The sign flips with the lookback on samples of under ten
# trades. That is noise with a wide spread, not a structural finding.
#
# 36 configurations were evaluated. The best-looking cell in the whole file is
# gate=turn k=1 (n=34, +3.92%, randomisation p=0.055-0.090) - which is exactly
# what the best of 36 draws looks like when nothing is there, and it sits next to
# a k=3 cell at p=0.444 and a k=5 cell at +1.68%. No stability across k.
#
# WHAT IS WORTH KEEPING: the structural point in PART 9. Any future attempt to
# condition B1 on a second basis-derived quantity faces the same problem - the
# percentile level already encodes the recent path. A genuine second condition
# has to come from OUTSIDE the basis series (open interest, liquidation prints,
# spot volume), not from a transform of it.
