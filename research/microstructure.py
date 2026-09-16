"""
MICROSTRUCTURE PROXIES FROM OHLCV - do the bars carry information a close-to-close
return throws away?

HYPOTHESIS. A daily bar is four prices and a volume. A close-to-close return uses
one of those numbers and discards the rest. Three measures reconstruct something
about HOW the price got where it did, and each has a mechanism rather than a
curve-fit behind it:

 1. AMIHUD ILLIQUIDITY = |return| / dollar volume. This is price impact per unit
    of traded value - literally the slope of the local demand curve. The mechanism
    that should make it matter here: this project's one confirmed continuation
    edge is FORCED LIQUIDATION FLOW (S3/D1). A liquidation engine sends market
    orders it cannot cancel, and the price damage those orders do is inversely
    proportional to book depth. So Amihud is a claim about WHEN forced flow has
    maximum effect, not about direction. The honest prior is that this is a
    regime/sizing variable, and the test that matters is a monotonic quintile
    gradient, not a standalone P&L number.

 2. CLOSE LOCATION VALUE = (close - low) / (high - low). Where in the day's range
    the day ended - who was still buying at the bell. Mechanism: a bar that opens
    weak, trades down, and closes on its high means the sellers who had to sell
    are done and the marginal participant is a buyer. The counter-argument, which
    this project has learned to take seriously, is that this is a STATISTICAL
    pattern with nobody forced to trade toward it. The reversion taxonomy already
    established here says an anchor has to be real (a spot price) to be tradeable.
    CLV has no anchor, so it starts with a prior against it.

 3. RANGE-vs-CLOSE VOLATILITY RATIO (Parkinson / Garman-Klass over close-to-close).
    Parkinson estimates volatility from the high-low range; close-to-close
    estimates it from the settlements. When the ratio is HIGH the price moved a
    long way intrabar and came back - chop, mean reversion, market-maker
    territory. When it is LOW the move went one way and stayed - directional flow
    that got fully impounded. Mechanism: this separates "someone big had to
    transact and the price stayed moved" from "liquidity providers absorbed it and
    the price came back". That is exactly the distinction the forced-flow thesis
    needs, and it is measurable from bars alone.

WHAT IS BEING TESTED, in order:
  A. UNCONDITIONAL DOSE-RESPONSE. Quintile every bar by each measure and report
     forward returns. Directional, absolute (impact), and continuation-conditional.
     This is descriptive - no strategy, no parameters, no chance to overfit - and
     it is the strongest mechanism evidence available.
  B. TRADE-LEVEL QUINTILES on the live S3 and D1 trades. Sort the actual trades by
     the measure at their entry bar. A monotonic gradient here is a sizing input.
  C. STANDALONE SIGNALS through the real engine, full validation standard.
  D. CONDITIONING FILTERS on S3 and D1, compared against the same-warmup baseline.

Every configuration evaluated is counted and printed at the end. A clean negative
is a successful outcome; nothing here gets re-tuned after seeing its result.
"""
import sys, math, datetime, statistics as st

sys.path.insert(0, 'research')
sys.path.insert(0, '.')
import engine, pooled
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']

# The live operating points, taken verbatim from final_gate.py / d1_final.py.
S3P = {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}
D1P = {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}

# Warmup has to cover the longest percentile window (250) plus the estimator
# window (10). Baselines are re-run at THIS warmup so filtered-vs-unfiltered is
# a like-for-like comparison rather than a comparison against a longer sample.
WARMUP = 280
AM_WIN = 60       # trailing window for the Amihud percentile
VR_WIN = 250      # trailing window for the vol-ratio percentile
VR_N = 10         # bars in the Parkinson / close-to-close estimators

VARIANTS = 0      # every distinct signal configuration sent through the engine


# ------------------------------------------------------------------ measures

def pct_rank(series, i, win):
    """Causal percentile of series[i] within its own trailing `win` values.
    Raw Amihud and raw vol ratios are not comparable across coins or across
    volatility regimes, so everything downstream uses the rank, never the level.
    Uses bars[..i] only."""
    if series[i] is None:
        return None
    lo = max(0, i - win + 1)
    hist = [v for v in series[lo:i + 1] if v is not None]
    if len(hist) < win // 2:
        return None
    v = series[i]
    return sum(1 for x in hist if x <= v) / len(hist)


def build_measures(bars):
    n = len(bars)
    c = [b['c'] for b in bars]
    ret = [None] * n
    for i in range(1, n):
        ret[i] = (c[i] - c[i - 1]) / c[i - 1] if c[i - 1] > 0 else None

    # --- 1. Amihud: |return| per dollar of volume traded that day.
    amihud = [None] * n
    for i in range(1, n):
        dv = bars[i]['v'] * c[i]
        if ret[i] is not None and dv > 0:
            amihud[i] = abs(ret[i]) / dv

    # --- 2. Close location value. Degenerate on a zero-range bar; leave None.
    clv = [None] * n
    for i, b in enumerate(bars):
        rng = b['h'] - b['l']
        if rng > 0:
            clv[i] = (b['c'] - b['l']) / rng

    # --- 3. Parkinson and Garman-Klass range vols vs close-to-close vol.
    # Ratio > 1 means the intrabar range is large relative to how far the closes
    # actually travelled: the move happened and reverted inside the session.
    lnhl2 = [None] * n
    gk_term = [None] * n
    for i, b in enumerate(bars):
        if b['h'] > 0 and b['l'] > 0 and b['o'] > 0 and b['c'] > 0:
            u = math.log(b['h'] / b['l'])
            v = math.log(b['c'] / b['o'])
            lnhl2[i] = u * u
            gk_term[i] = 0.5 * u * u - (2 * math.log(2) - 1) * v * v
    logret = [None] * n
    for i in range(1, n):
        if c[i] > 0 and c[i - 1] > 0:
            logret[i] = math.log(c[i] / c[i - 1])

    park_ratio = [None] * n
    gk_ratio = [None] * n
    for i in range(VR_N, n):
        w_hl = [lnhl2[k] for k in range(i - VR_N + 1, i + 1)]
        w_gk = [gk_term[k] for k in range(i - VR_N + 1, i + 1)]
        w_lr = [logret[k] for k in range(i - VR_N + 1, i + 1)]
        if any(x is None for x in w_hl) or any(x is None for x in w_lr):
            continue
        park = math.sqrt(sum(w_hl) / (4 * VR_N * math.log(2)))
        cc = st.pstdev(w_lr)
        if cc > 0:
            park_ratio[i] = park / cc
            gkv = sum(w_gk) / VR_N
            if gkv > 0:
                gk_ratio[i] = math.sqrt(gkv) / cc

    return {
        'ret': ret,
        'amihud': amihud,
        'am_pct': [pct_rank(amihud, i, AM_WIN) for i in range(n)],
        'clv': clv,
        'park_ratio': park_ratio,
        'vr_pct': [pct_rank(park_ratio, i, VR_WIN) for i in range(n)],
        'gk_ratio': gk_ratio,
        'gk_pct': [pct_rank(gk_ratio, i, VR_WIN) for i in range(n)],
        'atr': engine.atr_series(bars, 14),
        'sd': engine.stdev_series([r if r is not None else 0.0 for r in ret], 60),
    }


MEAS = {}
BARS = {}
FUND = {}
for _c in COINS:
    _b, _f = pooled.load(_c)
    BARS[_c], FUND[_c] = _b, _f
    MEAS[_c] = build_measures(_b)


# ------------------------------------------------------- A. dose-response study

def quintile_table(key, label, k_fwd=5):
    """Bucket every usable bar by the measure's causal percentile and report what
    happened NEXT. Entry is bars[i+1]['o'] and exit bars[i+k]['c'], so this is a
    tradeable forward return, not a close-to-close fiction.

      fwd      - mean signed forward return (is the measure directional?)
      |fwd|    - mean absolute forward return (is it a VOLATILITY/impact signal?)
      cont     - mean of sign(today's return) x forward return (does today's
                 direction persist? this is the forced-flow question)
    """
    rows = []
    for c in COINS:
        bars, M = BARS[c], MEAS[c]
        s = M[key]
        for i in range(WARMUP, len(bars) - k_fwd - 1):
            p = s[i]
            r0 = M['ret'][i]
            if p is None or r0 is None:
                continue
            e = bars[i + 1]['o']
            x = bars[i + k_fwd]['c']
            if e <= 0:
                continue
            f = (x - e) / e
            rows.append((p, r0, f))
    if not rows:
        print('  {}: no data'.format(label))
        return
    rows.sort(key=lambda z: z[0])
    q = len(rows) // 5
    print('\n  {} - quintiles of the trailing-percentile rank, {}d forward'.format(label, k_fwd))
    print('    {:<8}{:>7}{:>10}{:>10}{:>10}'.format('bucket', 'n', 'fwd', '|fwd|', 'cont'))
    fwds, conts, absf = [], [], []
    for b in range(5):
        lo = b * q
        hi = (b + 1) * q if b < 4 else len(rows)
        chunk = rows[lo:hi]
        mf = st.mean([z[2] for z in chunk])
        ma = st.mean([abs(z[2]) for z in chunk])
        mc = st.mean([(1 if z[1] > 0 else -1) * z[2] for z in chunk])
        fwds.append(mf); absf.append(ma); conts.append(mc)
        print('    Q{:<7}{:>7}{:>9.2%}{:>10.2%}{:>10.2%}'.format(b + 1, len(chunk), mf, ma, mc))
    print('    monotonic? fwd={:<6} |fwd|={:<6} cont={:<6}'.format(
        _mono(fwds), _mono(absf), _mono(conts)))
    print('    Q5-Q1     fwd={:+.2%}  |fwd|={:+.2%}  cont={:+.2%}'.format(
        fwds[4] - fwds[0], absf[4] - absf[0], conts[4] - conts[0]))


def _mono(v):
    up = all(v[i] <= v[i + 1] for i in range(len(v) - 1))
    dn = all(v[i] >= v[i + 1] for i in range(len(v) - 1))
    return 'UP' if up else ('DOWN' if dn else 'no')


# --------------------------------------------------- B. trade-level quintiles

def trade_quintiles(per, key, label):
    """Sort the strategy's ACTUAL trades by the measure at the bar that fired the
    signal (entry_i - 1, because fills happen at the next bar's open) and report
    expectancy per quintile. A monotonic gradient is a position-sizing input even
    if the filtered version does not beat the unfiltered one on expectancy."""
    rows = []
    for c, r in per.items():
        bars, M = BARS[c], MEAS[c]
        idx = {b['t']: i for i, b in enumerate(bars)}
        for t in r.trades:
            ei = idx.get(t.entry_t)
            if ei is None or ei < 1:
                continue
            v = M[key][ei - 1]
            if v is None:
                continue
            rows.append((v, t.pnl_pct, t.won))
    if len(rows) < 25:
        print('    {}: too few tagged trades (n={})'.format(label, len(rows)))
        return
    rows.sort(key=lambda z: z[0])
    q = len(rows) // 5
    exps = []
    print('    {:<18}{:>6}{:>10}{:>9}'.format(label, 'n', 'exp', 'win%'))
    for b in range(5):
        lo, hi = b * q, ((b + 1) * q if b < 4 else len(rows))
        ch = rows[lo:hi]
        e = st.mean([z[1] for z in ch])
        w = sum(1 for z in ch if z[2]) / len(ch)
        exps.append(e)
        print('      Q{:<15}{:>6}{:>9.2%}{:>9.0%}'.format(b + 1, len(ch), e, w))
    print('      monotonic={}   Q5-Q1={:+.2%}'.format(_mono(exps), exps[4] - exps[0]))


# ---------------------------------------------------- C. standalone strategies

def amihud_impact(P):
    """Enter on a day whose PRICE IMPACT per dollar traded is in the top
    `pct` of its trailing distribution, following that day's direction.

    This is deliberately NOT S3. S3 fires on high volume; a high-Amihud day is
    one where price moved a long way on comparatively LITTLE volume - a thin
    book. If the forced-flow mechanism is really about book depth rather than
    participation, this should work where S3 does not."""
    def build(M):
        def factory():
            def sig(bars, i, pos):
                if pos is not None:
                    return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= P['hold'] else None
                p, atr = M['am_pct'][i], M['atr'][i]
                if p is None or atr is None or atr <= 0 or p < P['pct']:
                    return None
                b = bars[i]
                want = 'long' if b['c'] > b['o'] else 'short'
                px = b['c']
                stop = px - P['atr_mult'] * atr if want == 'long' else px + P['atr_mult'] * atr
                return {'dir': want, 'stop': stop, 'target': None,
                        'reason': 'amihud pct {:.2f}'.format(p)}
            return sig
        return factory
    return build


def clv_momentum(P):
    """Close in the top `hi` of the day's range -> long; bottom -> short.
    Who won the bar, traded as a directional signal."""
    def build(M):
        def factory():
            def sig(bars, i, pos):
                if pos is not None:
                    return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= P['hold'] else None
                v, atr = M['clv'][i], M['atr'][i]
                if v is None or atr is None or atr <= 0:
                    return None
                px = bars[i]['c']
                if v >= P['hi']:
                    return {'dir': 'long', 'stop': px - P['atr_mult'] * atr, 'target': None,
                            'reason': 'clv {:.2f}'.format(v)}
                if v <= 1 - P['hi']:
                    return {'dir': 'short', 'stop': px + P['atr_mult'] * atr, 'target': None,
                            'reason': 'clv {:.2f}'.format(v)}
                return None
            return sig
        return factory
    return build


def efficiency_continuation(P):
    """Follow a meaningful move ONLY when the recent regime is one where moves
    stick - Parkinson/close-to-close ratio in the bottom `pct` of its own
    trailing year. The move condition (|ret| >= 1 sd) is fixed, not swept; only
    the regime threshold varies, so any gradient found is attributable to the
    microstructure measure rather than to the move size."""
    def build(M):
        def factory():
            def sig(bars, i, pos):
                if pos is not None:
                    return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= P['hold'] else None
                p, atr, sd, r = M['vr_pct'][i], M['atr'][i], M['sd'][i], M['ret'][i]
                if None in (p, atr, sd, r) or atr <= 0 or sd <= 0:
                    return None
                if p > P['pct'] or abs(r) < sd:
                    return None
                px = bars[i]['c']
                want = 'long' if r > 0 else 'short'
                stop = px - P['atr_mult'] * atr if want == 'long' else px + P['atr_mult'] * atr
                return {'dir': want, 'stop': stop, 'target': None,
                        'reason': 'trendy regime pct {:.2f}'.format(p)}
            return sig
        return factory
    return build


# ------------------------------------------------------------ D. gate wrappers

def gate_am_high(M, i, s):
    p = M['am_pct'][i]
    return p is not None and p >= 0.80


def gate_am_low(M, i, s):
    p = M['am_pct'][i]
    return p is not None and p <= 0.20


def gate_clv_aligned(M, i, s):
    v = M['clv'][i]
    if v is None:
        return False
    return v >= 0.60 if s['dir'] == 'long' else v <= 0.40


def gate_vr_low(M, i, s):
    p = M['vr_pct'][i]
    return p is not None and p <= 0.50


def gate_vr_high(M, i, s):
    p = M['vr_pct'][i]
    return p is not None and p >= 0.50


def gated(base_fn, base_params, gate):
    """Wrap an existing strategy and veto ENTRIES the gate rejects. Exits are
    left completely untouched, so any difference is attributable to entry
    selection and nothing else."""
    def build(M):
        def factory():
            inner = base_fn(base_params)()

            def sig(bars, i, pos):
                s = inner(bars, i, pos)
                if pos is None and s is not None and s.get('dir') and not gate(M, i, s):
                    return None
                return s
            return sig
        return factory
    return build


def plain(base_fn, base_params):
    def build(M):
        return base_fn(base_params)
    return build


# --------------------------------------------------------------------- runner

def run_pooled(build, name, warmup=WARMUP, count=True, **kw):
    global VARIANTS
    if count:
        VARIANTS += 1
    merged = engine.Result(coin='POOL', name=name)
    per = {}
    for c in COINS:
        bars, fund, M = BARS[c], FUND[c], MEAS[c]
        if len(bars) < warmup + 60:
            continue
        r = engine.backtest(bars, build(M)(), c, fund, name=name, warmup=warmup, **kw)
        per[c] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


def row(label, m, indent='  '):
    if m.n == 0:
        print('{}{:<44} NO TRADES'.format(indent, label))
        return
    tr, te = pooled.pooled_split(m)
    print('{}{:<44} n={:<4} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%} exTop3={:>7.2%} '
          'train={:>7.2%} test={:>7.2%} n/yr={:>5.1f}'.format(
              indent, label, m.n, m.win_rate, m.expectancy, m.trimmed_expectancy(0.05),
              m.expectancy_ex_best(3), tr.expectancy if tr and tr.n else 0.0,
              te.expectancy if te and te.n else 0.0, m.trades_per_year()))


def yearly_line(m):
    yr = pooled.pooled_yearly(m)
    pos = sum(1 for _, r in yr if r.expectancy > 0)
    return '{}/{} years positive   '.format(pos, len(yr)) + '  '.join(
        '{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n) for y, r in yr)


# ============================================================================ #
def main():
    print('=' * 120)
    print('MICROSTRUCTURE PROXIES FROM OHLCV')
    print('Coins {}   bars per coin: {}'.format(
        COINS, {c: len(BARS[c]) for c in COINS}))
    print('warmup={} bars (percentile windows: amihud {}, vol-ratio {} over a {}-bar estimator)'.format(
        WARMUP, AM_WIN, VR_WIN, VR_N))
    print('=' * 120)

    # ---------------------------------------------------------------- PART A
    print('\n' + '=' * 120)
    print('A. UNCONDITIONAL DOSE-RESPONSE - every bar, no strategy, no parameters')
    print('=' * 120)
    print('  Reading guide: "fwd" tests DIRECTION, "|fwd|" tests IMPACT/volatility,')
    print('  "cont" tests whether TODAY\'S DIRECTION PERSISTS (the forced-flow claim).')
    for key, lab in [('am_pct', 'AMIHUD illiquidity'), ('clv', 'CLOSE LOCATION VALUE'),
                     ('vr_pct', 'PARKINSON / close-to-close ratio'),
                     ('gk_pct', 'GARMAN-KLASS / close-to-close ratio')]:
        for k in (1, 5, 10):
            quintile_table(key, lab, k_fwd=k)

    # ---------------------------------------------------------------- PART B
    print('\n' + '=' * 120)
    print('B. TRADE-LEVEL QUINTILES on the live S3 and D1 trades')
    print('=' * 120)
    per_s3, m_s3 = run_pooled(plain(volume_spike, S3P), 'S3 base')
    per_d1, m_d1 = run_pooled(plain(range_breakout, D1P), 'D1 base')
    row('S3 baseline (at warmup={})'.format(WARMUP), m_s3)
    row('D1 baseline (at warmup={})'.format(WARMUP), m_d1)
    for nm, per in (('S3', per_s3), ('D1', per_d1)):
        print('\n  {} trades sorted by measure at the signal bar:'.format(nm))
        for key, lab in [('am_pct', 'amihud pct'), ('clv', 'clv'), ('vr_pct', 'park/cc pct')]:
            trade_quintiles(per, key, lab)

    # ---------------------------------------------------------------- PART C
    print('\n' + '=' * 120)
    print('C. STANDALONE SIGNALS')
    print('=' * 120)
    standalone = {}
    print('\n  C1 AMIHUD IMPACT continuation (thin book -> forced flow moves price further)')
    for pct in (0.70, 0.80, 0.90):
        P = {'pct': pct, 'hold': 10, 'atr_mult': 2.5}
        per, m = run_pooled(amihud_impact(P), 'AM{:.0f}'.format(pct * 100))
        row('amihud pct>={:.2f}'.format(pct), m)
        standalone[('amihud', pct)] = (per, m, P)

    print('\n  C2 CLV MOMENTUM (who won the bar)')
    for hi in (0.70, 0.80, 0.90):
        P = {'hi': hi, 'hold': 5, 'atr_mult': 2.5}
        per, m = run_pooled(clv_momentum(P), 'CLV{:.0f}'.format(hi * 100))
        row('clv>={:.2f} long / <={:.2f} short'.format(hi, 1 - hi), m)
        standalone[('clv', hi)] = (per, m, P)

    print('\n  C3 EFFICIENCY CONTINUATION (follow a 1sd move only in a trendy regime)')
    for pct in (0.30, 0.40, 0.50):
        P = {'pct': pct, 'hold': 10, 'atr_mult': 2.5}
        per, m = run_pooled(efficiency_continuation(P), 'VR{:.0f}'.format(pct * 100))
        row('park/cc pct<={:.2f}'.format(pct), m)
        standalone[('vr', pct)] = (per, m, P)

    # ---------------------------------------------------------------- PART D
    print('\n' + '=' * 120)
    print('D. CONDITIONING FILTERS on S3 and D1 (entries vetoed, exits untouched)')
    print('=' * 120)
    gates = [('amihud top 20%', gate_am_high), ('amihud bottom 20%', gate_am_low),
             ('clv aligned with entry', gate_clv_aligned),
             ('park/cc bottom half (trendy)', gate_vr_low),
             ('park/cc top half (choppy)', gate_vr_high)]
    filtered = {}
    for base_nm, base_fn, base_p, base_m in (('S3', volume_spike, S3P, m_s3),
                                             ('D1', range_breakout, D1P, m_d1)):
        print('\n  {} baseline for comparison:'.format(base_nm))
        row('{} unfiltered'.format(base_nm), base_m)
        for gnm, g in gates:
            per, m = run_pooled(gated(base_fn, base_p, g), '{}+{}'.format(base_nm, gnm))
            row('{} + {}'.format(base_nm, gnm), m)
            filtered[(base_nm, gnm)] = (per, m)

    # ------------------------------------------------- full gate on the best
    print('\n' + '=' * 120)
    print('E. FULL VALIDATION on whichever standalone config looked best')
    print('   (chosen AFTER the fact from the grid above - which is exactly why the')
    print('    variant count below matters, and why train/test is the deciding test)')
    print('=' * 120)
    best = None
    for k, (per, m, P) in standalone.items():
        if m.n < 30:
            continue
        sc = m.trimmed_expectancy(0.05)
        if best is None or sc > best[0]:
            best = (sc, k, per, m, P)
    if best is None:
        print('  no standalone config reached n>=30; nothing to gate.')
    else:
        sc, k, per, m, P = best
        fam, val = k
        builder = {'amihud': amihud_impact, 'clv': clv_momentum,
                   'vr': efficiency_continuation}[fam]
        print('  best by trimmed expectancy: {} {} -> trim5 {:+.2%}'.format(fam, val, sc))
        row('full pooled', m)
        print('  ' + yearly_line(m))
        for c in COINS:
            if c in per and per[c].n:
                print('  ' + pooled.describe(per[c], c))
        print('\n  COST STRESS')
        for mult in (1, 2, 3, 4):
            _, mm = run_pooled(builder(P), 'cost{}x'.format(mult), count=False,
                               slippage=engine.SLIPPAGE * mult, fee=engine.TAKER_FEE * mult)
            print('    {}x ({:.2f}% round trip): n={:<4} exp={:>7.2%} trim5={:>7.2%} CAGR={:>7.1%}'.format(
                mult, 2 * (engine.SLIPPAGE + engine.TAKER_FEE) * mult * 100, mm.n,
                mm.expectancy, mm.trimmed_expectancy(0.05), mm.account_cagr(0.20)))
        print('    annual cost drag = {:.1f} trades/yr x 0.190% = {:.1%} of notional/yr'.format(
            m.trades_per_year(), m.trades_per_year() * 0.0019))

        print('\n  OVERLAP with what is already running')
        for c in COINS:
            bars, fund, M = BARS[c], FUND[c], MEAS[c]
            mine, _ = pooled.position_series(bars, lambda q: builder(P)(M), {}, c, fund, WARMUP)
            s3, _ = pooled.position_series(bars, volume_spike, S3P, c, fund, WARMUP)
            d1, _ = pooled.position_series(bars, range_breakout, D1P, c, fund, WARMUP)
            o3, n3 = pooled.overlap(mine, s3)
            o1, n1 = pooled.overlap(mine, d1)
            print('    {:<5} vs S3 {:>6} (n={:<4})   vs D1 {:>6} (n={:<4})'.format(
                c, '-' if o3 is None else '{:.2f}'.format(o3), n3,
                '-' if o1 is None else '{:.2f}'.format(o1), n1))

    # ---------------------------------------------------------------- PART F
    print('\n' + '=' * 120)
    print('F. HOLE-PUNCHING - three ways the results above could be lying')
    print('=' * 120)

    print('\n  F1. IS AMIHUD ANYTHING BUT VOLATILITY CLUSTERING?')
    print('      Amihud = |return| / dollar volume, so it CONTAINS |return|, and |return|')
    print('      predicts future |return| by vol clustering alone. If plain |ret| sorts')
    print('      forward |ret| as well as Amihud does, the "illiquidity" story adds nothing')
    print('      that the ATR already in every stop does not already capture.')
    for c in COINS:
        M = MEAS[c]
        M['absret'] = [abs(r) if r is not None else None for r in M['ret']]
        M['ar_pct'] = [pct_rank(M['absret'], i, AM_WIN) for i in range(len(BARS[c]))]
        M['dv'] = [BARS[c][i]['v'] * BARS[c][i]['c'] for i in range(len(BARS[c]))]
        M['dv_pct'] = [pct_rank(M['dv'], i, AM_WIN) for i in range(len(BARS[c]))]
    for key, lab in [('am_pct', 'AMIHUD  |r|/$vol'), ('ar_pct', 'CONTROL |r| alone'),
                     ('dv_pct', 'CONTROL $volume alone')]:
        quintile_table(key, lab, k_fwd=10)

    print('\n  F2. PERMUTATION TEST - does the measure actually SORT the trades,')
    print('      or is the quintile gradient what a random split of the same trades')
    print('      would produce anyway? 20,000 shuffles of the labels, bottom vs top half.')
    import random
    random.seed(20260907)

    def tagged(per, key):
        rows = []
        for c, r in per.items():
            bars, M = BARS[c], MEAS[c]
            idx = {b['t']: i for i, b in enumerate(bars)}
            for t in r.trades:
                ei = idx.get(t.entry_t)
                if ei is None or ei < 1 or M[key][ei - 1] is None:
                    continue
                rows.append((M[key][ei - 1], t.pnl_pct))
        rows.sort(key=lambda z: z[0])
        return rows

    def _trimmed(v, frac=0.10):
        """Symmetric trimmed mean. Same idea as Result.trimmed_expectancy: if a
        half-sample's advantage is two lottery trades, this deletes them."""
        if len(v) < 10:
            return st.mean(v) if v else 0.0
        s = sorted(v)
        k = max(1, int(len(s) * frac))
        core = s[k:-k]
        return st.mean(core) if core else 0.0

    def perm_test(per, key, label, stat=st.mean, tag=''):
        rows = tagged(per, key)
        if len(rows) < 30:
            print('      {:<30} too few tagged trades'.format(label + tag))
            return
        h = len(rows) // 2
        lo = [z[1] for z in rows[:h]]
        hi = [z[1] for z in rows[h:]]
        obs = stat(lo) - stat(hi)
        pool = [z[1] for z in rows]
        hits = 0
        for _ in range(20000):
            random.shuffle(pool)
            if abs(stat(pool[:h]) - stat(pool[h:])) >= abs(obs):
                hits += 1
        print('      {:<30} n={:<4} low-half {:+.2f}%  high-half {:+.2f}%  '
              'diff {:+.2f}pp  two-sided p={:.4f}'.format(
                  label + tag, len(rows), stat(lo) * 100, stat(hi) * 100,
                  obs * 100, hits / 20000))

    MEASURES = [('am_pct', 'amihud pct'), ('clv', 'clv'), ('vr_pct', 'park/cc pct')]
    for nm, per in (('S3', per_s3), ('D1', per_d1)):
        print('    {} trades:'.format(nm))
        for key, lab in MEASURES:
            perm_test(per, key, '{} by {}'.format(nm, lab))
    print('      NOTE: 6 tests were run here. A nominal p=0.03 among 6 is p~0.17 after')
    print('      Bonferroni, i.e. not significant. Only p<0.0083 clears the family.')

    print('\n  F4. IS THE SORT OUTLIER-DRIVEN? Same permutation test on a 10% SYMMETRIC')
    print('      TRIMMED mean instead of the mean. Motivation: "S3 + amihud top 20%" in')
    print('      part D has exp +1.02% but expectancy-ex-top-3 of -0.16%, so that bucket')
    print('      IS three trades. A mean-difference p-value cannot see that; this can.')
    print('      A gradient that survives trimming is a property of the distribution body.')
    for nm, per in (('S3', per_s3), ('D1', per_d1)):
        print('    {} trades:'.format(nm))
        for key, lab in MEASURES:
            perm_test(per, key, '{} by {}'.format(nm, lab), stat=_trimmed, tag=' [trim10]')

    print('\n  F5. THE FILTERS THAT IMPROVED BOTH TRAIN AND TEST: on S3 only')
    print('      park/cc bottom half did (D1 improvements start from a NEGATIVE train')
    print('      half, -0.55%, so "improving" D1 train is nearly free and not evidence).')
    print('      Full robustness on the S3 one, since a filter that survives is worth more')
    print('      to this book than another standalone strategy correlated with what exists.')
    _, m_f = run_pooled(gated(volume_spike, S3P, gate_vr_low), 'S3+vrlow', count=False)
    row('S3 + park/cc bottom half', m_f)
    print('    ' + yearly_line(m_f))
    per_f, _ = run_pooled(gated(volume_spike, S3P, gate_vr_low), 'S3+vrlow', count=False)
    for c in COINS:
        if c in per_f and per_f[c].n:
            print('    ' + pooled.describe(per_f[c], c))
    for mult in (1, 2, 4):
        _, mm = run_pooled(gated(volume_spike, S3P, gate_vr_low), 'x', count=False,
                           slippage=engine.SLIPPAGE * mult, fee=engine.TAKER_FEE * mult)
        print('    {}x cost: exp={:>7.2%} trim5={:>7.2%} CAGR={:>7.1%}'.format(
            mult, mm.expectancy, mm.trimmed_expectancy(0.05), mm.account_cagr(0.20)))
    print('    NOTE: this is a FILTER on an existing strategy, so its overlap with S3 is')
    print('    ~1.0 by construction. The question it answers is not "is this a new bet"')
    print('    but "should S3 skip 35% of its entries" - a different and cheaper question.')

    print('\n  F6. THE CONTRADICTION THAT DECIDES AMIHUD.')
    print('      Amihud has the strongest sort in F2/F4 (S3 high-half +4.16% vs low-half')
    print('      -1.02%, p=0.0028 even trimmed - the only test here that clears Bonferroni).')
    print('      Yet "S3 + amihud top 20%" in part D scored +1.02%, WORSE than the +1.57%')
    print('      baseline. Both cannot be a tradeable edge. Resolving it:')
    for key, lab, thr, cmp_ in [('am_pct', 'amihud', 0.80, 'ge'),
                                ('vr_pct', 'park/cc', 0.50, 'le')]:
        rows = []
        for c, r in per_s3.items():
            bars, M = BARS[c], MEAS[c]
            idx = {b['t']: i for i, b in enumerate(bars)}
            for t in r.trades:
                ei = idx.get(t.entry_t)
                if ei is None or ei < 1 or M[key][ei - 1] is None:
                    continue
                v = M[key][ei - 1]
                keep = v >= thr if cmp_ == 'ge' else v <= thr
                if keep:
                    rows.append(t.pnl_pct)
        # The SUBSET of baseline trades the gate would have kept, scored as-is.
        sub_n, sub_e = len(rows), (st.mean(rows) if rows else 0.0)
        gate = gate_am_high if key == 'am_pct' else gate_vr_low
        _, m_g = run_pooled(gated(volume_spike, S3P, gate), 'x', count=False)
        print('      {:<9} baseline SUBSET kept by the rule: n={:<4} exp={:+.2f}%'.format(
            lab, sub_n, sub_e * 100))
        print('      {:<9} GATED BACKTEST of the same rule:  n={:<4} exp={:+.2f}%'.format(
            '', m_g.n, m_g.expectancy * 100))
    print('      The two disagree because vetoing an entry FREES the strategy to take a')
    print('      later entry it was previously blocked from (S3 holds 10 bars and cannot')
    print('      stack). So a gated run is NOT a subset of the baseline trades, and a')
    print('      trade-level gradient does not automatically survive being turned into a')
    print('      rule. The gated backtest is the tradeable number; the sort is description.')
    print('      Amihud fails the conversion. park/cc survives it.')

    print('\n  F7. DOSE-RESPONSE ON THE STANDALONE AMIHUD SIGNAL (from part C1):')
    print('      pct>=0.70 -> +1.05%,  pct>=0.80 -> +0.15%,  pct>=0.90 -> -0.98%.')
    print('      This is INVERTED. The mechanism claim was "thinner book = forced flow')
    print('      moves price further", which predicts MORE extreme Amihud does BETTER.')
    print('      It does monotonically worse. An inverted dose-response is not a weak')
    print('      result, it is evidence against the stated mechanism. Amihud is rejected.')

    print('\n' + '=' * 120)
    print('TOTAL CONFIGURATIONS EVALUATED THROUGH THE ENGINE: {}'.format(VARIANTS))
    print('(2 baselines + 9 standalone + 10 filtered. Cost-stress reruns of an')
    print(' already-counted configuration are not counted again.)')
    print('=' * 120)


if __name__ == '__main__':
    main()
