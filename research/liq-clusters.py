"""
LIQUIDATION-PRICE CLUSTERING - can we get IN FRONT of the forced flow?

HYPOTHESIS (the mechanism, stated before any code)
--------------------------------------------------
The one continuation mechanism this project has been able to confirm is forced
liquidation flow: on a leveraged perp venue, when price reaches the level at
which a cohort of leveraged positions becomes insolvent, the exchange's own
liquidation engine emits market orders in the SAME direction as the move. Those
orders are not discretionary. The margin engine cannot decide to wait for a
better price, cannot decide the move is overdone, and cannot stop. That is why
S3 (volume-spike continuation) works and why almost nothing else in the
CONTINUATION family does.

But S3 and D1 are both REACTIVE. They detect the cascade after it has started,
from the volume print or the range break it leaves behind - which means they buy
the second half of the move at best. The trigger points are, in principle,
knowable in advance: a long opened at price P with leverage L is liquidated at
approximately P*(1 - 1/L), and a short at approximately P*(1 + 1/L). We cannot
see Hyperliquid's per-account position ledger, but we can build a PROXY for it:
treat trailing volume-weighted price levels as a distribution of entry prices,
map every entry level through each plausible leverage tier to its liquidation
price, delete the ones price has already run through (those positions are gone),
and what remains is a map of price levels where forced selling should cluster.

The trade this implies: when price approaches a dense band of liquidation
levels, position for the cascade THROUGH it rather than waiting for the volume
spike to tell you it happened.

WHY IT MIGHT NOT BE TRUE - the honest priors against it, up front
-----------------------------------------------------------------
 1. The proxy may be too coarse. Traded volume at a price is not open interest
    opened at that price. Most volume is churn between market makers who carry
    no directional leverage at all, and the leverage-tier mix is invented.
 2. Everyone can compute this. Liquidation heatmaps are a retail product sold on
    several sites. If the level is visible, market makers can pre-position
    against the cascade and absorb it, which would make dense bands act as
    SUPPORT rather than as accelerant. That is a real possibility and is tested
    explicitly here as the inverted trade.
 3. Density clusters where price has recently spent time, so "dense band below"
    is partly just "price is near the top of its recent range". That makes this
    a disguised momentum/range signal, which this project has rejected many
    times. The dose-response and overlap checks are what separate the two.

WHAT THIS SCRIPT DOES, IN ORDER
-------------------------------
  0. Build the liquidation-density proxy and SHOW ITS DISTRIBUTION before
     trading a single bar of it.
  1. Conditional forward returns with no trading rules and no costs - if dense
     bands do not bend the forward return distribution at all, nothing built on
     top can work and the idea dies here for free.
  2. The cascade trade (through the band) through the full pooled gate.
  3. The INVERTED trade (band as support) - because a clean negative on the
     cascade is only half an answer.
  4. BEFORE vs ON the volume spike. This is the whole point of the idea: if
     entering on band proximity alone does not beat entering on the spike
     (S3's actual behaviour), the premise is refuted regardless of whether the
     numbers are positive.
  5. Dose-response over density deciles, parameter neighbourhood, cost stress,
     train/test, per-year, and overlap against the live book.
"""
import sys, math, datetime, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, hl_data

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']

# ---------------------------------------------------------------------------
# Base parameters. Chosen from the MECHANISM before any result was seen, and
# held fixed for the primary test. Every deviation from these is counted as a
# variant at the bottom of the run.
# ---------------------------------------------------------------------------
BASE = {
    'window': 90,       # trailing days treated as the pool of live entry prices
    'halflife': 30,     # older entries are likelier already closed -> decay them
    'tiers': (5, 10, 20),   # leverage tiers, equally weighted (task specification)
    'band': 0.05,       # a liq level within 5% of spot is "reachable soon"
    'pct_win': 180,     # trailing window for the density percentile (regime-adj)
    'thresh': 0.80,     # act only in the top quintile of trailing density
    'hold': 5,
    'atr_mult': 2.5,
    'require_approach': True,   # price must be moving TOWARD the band
}
WARMUP = 280            # window + pct_win, plus slack


# ---------------------------------------------------------------------------
# 0. THE PROXY
# ---------------------------------------------------------------------------
def build_density(bars, window, halflife, tiers, band):
    """Return per-bar dicts of the liquidation-density proxy.

    For every trailing bar j we take its volume-weighted typical price as a
    stand-in for "positions were opened here", weight it by that bar's volume
    and by an exponential decay in age (positions opened long ago are more
    likely already closed), and push it through each leverage tier to a
    liquidation price.

    The step that makes this a position map rather than a price histogram: a
    long opened at bar j only still EXISTS at bar i if price has not already
    traded through its liquidation level between j+1 and i. Levels that have
    already been hit are deleted, because that cohort was liquidated once and
    cannot be liquidated again. Without this the map is just a smoothed price
    history and would show clusters at levels that were wiped out months ago.

    Outputs per bar i:
      dl    long-liquidation weight sitting in (c*(1-band), c], as a fraction
            of all surviving weight  -> fuel for a downside cascade
      ds    short-liquidation weight in [c, c*(1+band)) , same normalisation
            -> fuel for an upside squeeze
      dist_l / dist_s  weighted centroid distance to that band, in % of spot
      alive fraction of raw weight whose levels have not yet been hit
    """
    n = len(bars)
    lam = math.log(2) / halflife
    tw = 1.0 / len(tiers)
    hi = [b['h'] for b in bars]
    lo = [b['l'] for b in bars]
    tp = [(b['h'] + b['l'] + b['c']) / 3.0 for b in bars]
    vol = [b['v'] for b in bars]

    # aggregate profile of surviving long-liq levels by distance, for reporting
    profile = [0.0] * 41          # bins of 0.5% from 0% to -20%
    out = [None] * n
    for i in range(n):
        if i < window + 1:
            continue
        c = bars[i]['c']
        lo_edge, hi_edge = c * (1 - band), c * (1 + band)
        run_min, run_max = lo[i], hi[i]
        tot = raw = 0.0
        bl = bs = 0.0
        cl_num = cs_num = 0.0
        for j in range(i - 1, i - window - 1, -1):
            if j < i - 1:
                # extend the "has price been here since" interval by bar j+1
                if lo[j + 1] < run_min:
                    run_min = lo[j + 1]
                if hi[j + 1] > run_max:
                    run_max = hi[j + 1]
            w = vol[j] * math.exp(-lam * (i - j)) * tw
            if w <= 0:
                continue
            p = tp[j]
            for L in tiers:
                raw += 2 * w
                ql = p * (1 - 1.0 / L)
                if run_min > ql:                      # cohort still alive
                    tot += w
                    if lo_edge < ql <= c:
                        bl += w
                        cl_num += w * ql
                    d = (ql / c - 1) * 100
                    if -20.0 <= d <= 0.0:
                        profile[int(round(-d * 2))] += w
                qs = p * (1 + 1.0 / L)
                if run_max < qs:
                    tot += w
                    if c <= qs < hi_edge:
                        bs += w
                        cs_num += w * qs
        if tot <= 0:
            continue
        out[i] = {
            'dl': bl / tot, 'ds': bs / tot,
            'dist_l': (cl_num / bl / c - 1) * 100 if bl > 0 else None,
            'dist_s': (cs_num / bs / c - 1) * 100 if bs > 0 else None,
            'alive': tot / raw if raw > 0 else 0.0,
        }
    return out, profile


def pct_series(dens, key, win):
    """Causal trailing percentile of the density series - regime-adjusted, so a
    high-volatility year cannot flood the sample with 'dense' readings."""
    n = len(dens)
    out = [None] * n
    vals = []
    idx = []
    for i in range(n):
        if dens[i] is None:
            continue
        v = dens[i][key]
        hist = [vals[k] for k in range(len(vals)) if idx[k] >= i - win]
        if len(hist) >= 60:
            out[i] = sum(1 for h in hist if h <= v) / len(hist)
        vals.append(v)
        idx.append(i)
    return out


# ---------------------------------------------------------------------------
# THE STRATEGIES
# ---------------------------------------------------------------------------
def liq_cascade(params):
    """Position for the cascade THROUGH a dense liquidation band.

    Dense long-liq band just below + price falling -> short, because the next
    leg down hands the market a block of forced sell orders.
    Dense short-liq band just above + price rising -> long (squeeze fuel).
    `invert` flips it, which is the 'the band is absorbed, it acts as support'
    hypothesis rather than the accelerant one.
    """
    dl_p, ds_p = params['pl'], params['ps']
    thresh, hold, atr_mult = params['thresh'], params['hold'], params['atr_mult']
    invert = params.get('invert', False)
    approach = params.get('require_approach', True)
    vol_gate = params.get('vol_gate', None)   # None | 'spike' | 'quiet'

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
                state['vma'] = engine.sma_series([b['v'] for b in bars], 20)
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            atr, vma = state['atr'][i], state['vma'][i]
            if atr is None or vma is None or vma <= 0 or i < 1:
                return None
            if vol_gate == 'spike' and bars[i]['v'] < 1.5 * vma:
                return None
            if vol_gate == 'quiet' and bars[i]['v'] >= 1.5 * vma:
                return None
            pl, ps = dl_p[i], ds_p[i]
            falling = bars[i]['c'] < bars[i - 1]['c']
            want = None
            if pl is not None and pl >= thresh and (falling or not approach):
                want = 'short'
                strength = pl
            if ps is not None and ps >= thresh and (not falling or not approach):
                if want is None or ps > strength:
                    want = 'long'
                    strength = ps
            if want is None:
                return None
            if invert:
                want = 'long' if want == 'short' else 'short'
            px = bars[i]['c']
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': 'liq band pct {:.2f}'.format(strength)}
        return sig
    return factory


# ---------------------------------------------------------------------------
# plumbing: per-coin density is expensive, so build once and reuse
# ---------------------------------------------------------------------------
_D = {}


def load(coin, window, halflife, tiers, band, pct_win):
    key = (coin, window, halflife, tiers, band, pct_win)
    if key in _D:
        return _D[key]
    bars, fund = pooled.load(coin)
    dens, profile = build_density(bars, window, halflife, tiers, band)
    pl = pct_series(dens, 'dl', pct_win)
    ps = pct_series(dens, 'ds', pct_win)
    _D[key] = (bars, fund, dens, pl, ps, profile)
    return _D[key]


def run(params, name='LQ', **kw):
    merged = engine.Result(coin='POOL', name=name)
    per = {}
    for c in COINS:
        bars, fund, dens, pl, ps, _ = load(c, params['window'], params['halflife'],
                                           params['tiers'], params['band'],
                                           params['pct_win'])
        p = dict(params)
        p['pl'], p['ps'] = pl, ps
        if len(bars) < WARMUP + 40:
            continue
        r = engine.backtest(bars, liq_cascade(p)(), c, fund, name=name,
                            warmup=WARMUP, **kw)
        per[c] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


VARIANTS = [0]


def show(params, label, **kw):
    VARIANTS[0] += 1
    _, m = run(params, **kw)
    print('  ' + pooled.describe(m, label))
    return m


# ---------------------------------------------------------------------------
def phase0():
    print('=' * 118)
    print('PHASE 0  -  THE LIQUIDATION-DENSITY PROXY, BEFORE TRADING IT')
    print('=' * 118)
    print('  Proxy: trailing {}d of volume-weighted typical prices, half-life {}d,'.format(
        BASE['window'], BASE['halflife']))
    print('  mapped through {}x leverage to liq levels, levels already traded through deleted.'.format(
        '/'.join(str(t) for t in BASE['tiers'])))
    print('  dl = share of surviving liq weight sitting within {:.0%} BELOW spot.\n'.format(BASE['band']))
    agg_prof = [0.0] * 41
    for c in COINS:
        bars, fund, dens, pl, ps, prof = load(c, BASE['window'], BASE['halflife'],
                                              BASE['tiers'], BASE['band'], BASE['pct_win'])
        d = [x for x in dens[WARMUP:] if x is not None]
        if not d:
            continue
        dl = sorted(x['dl'] for x in d)
        ds = sorted(x['ds'] for x in d)
        q = lambda a, f: a[min(len(a) - 1, int(len(a) * f))]   # noqa: E731
        print('  {:<5} bars={:<5} alive-frac={:.2f}   dl p10/50/90/99 = {:.3f}/{:.3f}/{:.3f}/{:.3f}'
              '   ds p50/90 = {:.3f}/{:.3f}'.format(
                  c, len(d), st.mean(x['alive'] for x in d),
                  q(dl, .10), q(dl, .50), q(dl, .90), q(dl, .99), q(ds, .50), q(ds, .90)))
        dd = [x['dist_l'] for x in d if x['dist_l'] is not None]
        if dd:
            print('        weighted centroid of the below-spot band sits {:.2f}% under spot '
                  '(median {:.2f}%)'.format(st.mean(dd), st.median(dd)))
        for k in range(41):
            agg_prof[k] += prof[k]
    tot = sum(agg_prof) or 1.0
    print('\n  AGGREGATE PROFILE of surviving LONG-liquidation weight by distance below spot')
    print('  (all coins, all bars - this is the shape the trade is betting on):')
    for k in range(0, 41, 2):
        d = -k / 2.0
        share = agg_prof[k] / tot
        print('    {:>6.1f}%  {:<44} {:.3f}'.format(d, '#' * int(share * 700), share))
    print('\n  READ THIS SHAPE FIRST. If the profile is smooth and monotone rather than')
    print('  lumpy, there are no discrete "bands" to trade - only a gradient, and the')
    print('  whole premise of a targetable cluster is weaker than the story implies.')


# ---------------------------------------------------------------------------
def phase1():
    print('\n' + '=' * 118)
    print('PHASE 1  -  CONDITIONAL FORWARD RETURNS, NO TRADING RULES, NO COSTS')
    print('=' * 118)
    print('  If a dense band below spot really is cascade fuel, forward returns should be')
    print('  MORE NEGATIVE when dl is high. If it is absorbed support, more positive. If it')
    print('  is flat, the proxy carries no information and everything downstream is noise.\n')
    rows = []
    for c in COINS:
        bars, fund, dens, pl, ps, _ = load(c, BASE['window'], BASE['halflife'],
                                           BASE['tiers'], BASE['band'], BASE['pct_win'])
        cl = [b['c'] for b in bars]
        for i in range(WARMUP, len(bars) - 6):
            if pl[i] is None:
                continue
            r3 = (cl[i + 3] - cl[i]) / cl[i]
            r5 = (cl[i + 5] - cl[i]) / cl[i]
            # did price actually reach into the band within 5 days?
            reach = min(b['l'] for b in bars[i + 1:i + 6]) <= cl[i] * (1 - BASE['band'] * 0.5)
            rows.append((pl[i], ps[i], r3, r5, reach, bars[i]['c'] < bars[i - 1]['c']))
    print('  n bars = {}'.format(len(rows)))
    for tag, key in (('dl (long-liq fuel below)', 0), ('ds (short-liq fuel above)', 1)):
        print('\n  by {} decile:'.format(tag))
        print('    {:<10} {:>6} {:>10} {:>10} {:>10}'.format(
            'decile', 'n', 'fwd3d', 'fwd5d', 'P(reach)'))
        for d in range(10):
            sel = [r for r in rows if r[key] is not None
                   and d / 10.0 <= r[key] < (d + 1) / 10.0 + (1e-9 if d == 9 else 0)]
            if len(sel) < 20:
                continue
            print('    {:<10} {:>6} {:>9.2%} {:>9.2%} {:>9.1%}'.format(
                '{}-{}'.format(d * 10, d * 10 + 10), len(sel),
                st.mean(r[2] for r in sel), st.mean(r[3] for r in sel),
                st.mean(1.0 if r[4] else 0.0 for r in sel)))
    # the directional version actually traded: dense band + price already falling
    print('\n  the traded conditional (dl>=0.80 AND price falling) vs its complement:')
    a = [r for r in rows if r[0] is not None and r[0] >= 0.80 and r[5]]
    b = [r for r in rows if not (r[0] is not None and r[0] >= 0.80 and r[5])]
    for lbl, s in (('signal-on ', a), ('signal-off', b)):
        if s:
            print('    {} n={:<6} fwd3d={:+.2%} fwd5d={:+.2%}'.format(
                lbl, len(s), st.mean(x[2] for x in s), st.mean(x[3] for x in s)))
    print('\n  A short wants fwd returns NEGATIVE in the signal-on row. Note the sign.')


# ---------------------------------------------------------------------------
def gate(m, label):
    tr, te = pooled.pooled_split(m)
    print('  ' + pooled.describe(m, label))
    print('  ' + pooled.describe(tr, '  train(60%)'))
    print('  ' + pooled.describe(te, '  test(40%)'))
    yr = pooled.pooled_yearly(m)
    if yr:
        print('  by year: {}/{} positive   '.format(
            sum(1 for _, r in yr if r.expectancy > 0), len(yr)) +
            '  '.join('{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n) for y, r in yr))
    return tr, te


def phase2():
    print('\n' + '=' * 118)
    print('PHASE 2  -  THE CASCADE TRADE (position THROUGH the dense band)')
    print('=' * 118)
    per, m = run(BASE)
    VARIANTS[0] += 1
    tr, te = gate(m, 'POOLED cascade')
    for c in COINS:
        if c in per and per[c].n:
            print('  ' + pooled.describe(per[c], c))
    for side in ('long', 'short'):
        ts = [t for t in m.trades if t.direction == side]
        if ts:
            print('     {:<6} n={:<4} wr={:>5.1%} exp={:>7.2%}'.format(
                side, len(ts), sum(1 for t in ts if t.won) / len(ts),
                st.mean(t.pnl_pct for t in ts)))
    return m


def phase3():
    print('\n' + '=' * 118)
    print('PHASE 3  -  THE INVERTED TRADE (dense band as SUPPORT, flow absorbed)')
    print('=' * 118)
    p = dict(BASE); p['invert'] = True
    VARIANTS[0] += 1
    _, m = run(p, name='LQ-inv')
    gate(m, 'POOLED inverted')
    return m


def phase4():
    print('\n' + '=' * 118)
    print('PHASE 4  -  THE POINT OF THE WHOLE IDEA: BEFORE vs ON the volume spike')
    print('=' * 118)
    print('  A  band proximity alone, no volume condition        -> BEFORE the cascade')
    print('  B  band proximity AND a >=1.5x volume print         -> ON the cascade')
    print('  C  band proximity AND a QUIET tape (<1.5x volume)   -> strictly pre-emptive')
    print('  D  volume spike alone, no band condition            -> S3, the incumbent\n')
    a = show(BASE, 'A before (band only)')
    p = dict(BASE); p['vol_gate'] = 'spike'
    b = show(p, 'B on-spike (band+vol)')
    p = dict(BASE); p['vol_gate'] = 'quiet'
    q = show(p, 'C quiet tape')
    # S3 as actually specified in the live book
    from strategies_batch2 import volume_spike
    merged = engine.Result(coin='POOL', name='S3')
    for c in COINS:
        bars, fund = pooled.load(c)
        r = engine.backtest(bars, volume_spike({'vol_mult': 1.5, 'hold': 10,
                                                'atr_mult': 2.5})(), c, fund,
                            name='S3', warmup=WARMUP)
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    print('  ' + pooled.describe(merged, 'D S3 incumbent'))
    print('\n  VERDICT ON THE PREMISE: the idea is only interesting if A (or C) beats D.')
    return a, b, q, merged


def phase5(m):
    print('\n' + '=' * 118)
    print('PHASE 5  -  DOSE-RESPONSE: does a DENSER band give a bigger cascade?')
    print('=' * 118)
    print('  This is the single best mechanism evidence available. A monotone ladder is')
    print('  hard to fake; a flat or inverted ladder means the density number is decorative.\n')
    print('  {:<16} {:>5} {:>9} {:>9} {:>9}'.format('threshold', 'n', 'exp', 'trim5', 'wr'))
    for th in (0.50, 0.60, 0.70, 0.80, 0.90, 0.95):
        p = dict(BASE); p['thresh'] = th
        VARIANTS[0] += 1
        _, mm = run(p)
        if mm.n == 0:
            continue
        print('  pct>={:<11.2f} {:>5} {:>8.2%} {:>8.2%} {:>8.1%}'.format(
            th, mm.n, mm.expectancy, mm.trimmed_expectancy(0.05), mm.win_rate))

def phase6(m):
    print('\n' + '=' * 118)
    print('PHASE 6  -  PARAMETER NEIGHBOURHOOD')
    print('=' * 118)
    res = []
    for key, vals in [('window', [45, 60, 120, 180]),
                      ('halflife', [10, 20, 60]),
                      ('band', [0.03, 0.04, 0.07, 0.10]),
                      ('hold', [3, 7, 10]),
                      ('atr_mult', [1.5, 2.0, 3.5]),
                      ('tiers', [(10,), (5, 10), (10, 20, 50)]),
                      ('require_approach', [False])]:
        for v in vals:
            p = dict(BASE); p[key] = v
            VARIANTS[0] += 1
            _, mm = run(p)
            if mm.n == 0:
                continue
            t1, t2 = pooled.pooled_split(mm)
            res.append((mm.expectancy, mm.trimmed_expectancy(0.05)))
            print('  {:<16}={:<12} n={:<4} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%} '
                  'train={:>7.2%} test={:>7.2%}'.format(
                      key, str(v), mm.n, mm.win_rate, mm.expectancy,
                      mm.trimmed_expectancy(0.05),
                      t1.expectancy if t1 and t1.n else 0.0,
                      t2.expectancy if t2 and t2.n else 0.0))
    print('  -> {}/{} perturbations positive on mean, {}/{} positive on trimmed'.format(
        sum(1 for a, _ in res if a > 0), len(res),
        sum(1 for _, b in res if b > 0), len(res)))

    print('\n' + '=' * 118)
    print('COST STRESS  (annual drag = trades/yr x 0.190%)')
    print('=' * 118)
    if m.n:
        tpy = m.trades_per_year()
        print('  {:.0f} trades/yr -> {:.1f}%/yr of notional in execution cost at the modelled rate'.format(
            tpy, tpy * 0.190))
    for mult in (1, 2, 4):
        VARIANTS[0] += 1
        _, mm = run(BASE, slippage=engine.SLIPPAGE * mult, fee=engine.TAKER_FEE * mult)
        print('  {}x ({:.2f}% round trip): n={:<4} exp={:>7.2%} trim5={:>7.2%} CAGR={:>6.1%}'.format(
            mult, 2 * (engine.SLIPPAGE + engine.TAKER_FEE) * mult * 100, mm.n,
            mm.expectancy, mm.trimmed_expectancy(0.05), mm.account_cagr(0.20)))


def phase7():
    print('\n' + '=' * 118)
    print('PHASE 7  -  OVERLAP WITH THE LIVE BOOK (is this even a new bet?)')
    print('=' * 118)
    from strategies_batch2 import volume_spike
    from strategies_daily import range_breakout
    from strategies_macro import donchian_turtle
    others = {
        'S3 forced_flow': (volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}),
        'D1 range_break': (range_breakout, {'n': 20, 'atr_mult': 2.5, 'max_hold': 10,
                                            'atr_ratio': 2.0}),
        'M3 donchian': (donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 2.5}),
    }
    agg = {k: [0, 0] for k in others}
    for c in COINS:
        bars, fund, dens, pl, ps, _ = load(c, BASE['window'], BASE['halflife'],
                                           BASE['tiers'], BASE['band'], BASE['pct_win'])
        p = dict(BASE); p['pl'], p['ps'] = pl, ps
        s1, _ = pooled.position_series(bars, lambda q: liq_cascade(q), p, c, fund, WARMUP)
        line = '  {:<5}'.format(c)
        for k, (fn, pp) in others.items():
            s2, _ = pooled.position_series(bars, fn, pp, c, fund, WARMUP)
            ov, nb = pooled.overlap(s1, s2)
            line += '  {}={}'.format(k.split()[0], 'n/a' if ov is None else '{:.2f}'.format(ov))
            if ov is not None:
                agg[k][0] += ov * nb
                agg[k][1] += nb
        print(line)
    print('  pooled:', '  '.join('{}={:.2f}'.format(k.split()[0], v[0] / v[1])
                                 for k, v in agg.items() if v[1]))
    # B1 basis needs spot data; reuse the basis harness
    try:
        import run_basis
        from strategies_basis import basis_dislocation
        tot = [0.0, 0]
        for c in COINS:
            perp, fund, basis, first = run_basis.load(c)
            bars, _f, dens, pl, ps, _ = load(c, BASE['window'], BASE['halflife'],
                                             BASE['tiers'], BASE['band'], BASE['pct_win'])
            if len(bars) != len(perp):
                continue
            p = dict(BASE); p['pl'], p['ps'] = pl, ps
            s1, _ = pooled.position_series(bars, lambda q: liq_cascade(q), p, c, fund, WARMUP)
            pb = dict(run_basis.BASE); pb['basis'] = basis
            s2, _ = pooled.position_series(perp, lambda q: basis_dislocation(q), pb, c, fund,
                                           max(WARMUP, first + 60))
            ov, nb = pooled.overlap(s1, s2)
            if ov is not None:
                tot[0] += ov * nb; tot[1] += nb
        if tot[1]:
            print('  pooled: B1={:.2f}'.format(tot[0] / tot[1]))
    except Exception as e:      # noqa: BLE001 - overlap is diagnostic, not load-bearing
        print('  B1 overlap unavailable: {}'.format(e))



def phase8():
    """DIAGNOSIS, not a new variant. Overlap 0.86 with D1 says the cascade trade
    is mostly a bet the live book already owns, but overlap alone does not say
    WHY. Prior #3 in the docstring predicted the reason: the survival filter
    deletes liq levels price has already run through, so weight only survives
    BELOW spot when price has been grinding UP - which makes 'dense band below'
    a re-encoding of 'price is high in its trailing range'. This measures that
    directly. If the correlation is high, the strategy is a range/momentum
    signal wearing a liquidation costume, and the mechanism story is decoration.
    """
    print('\n' + '=' * 118)
    print('PHASE 8  -  IS THE DENSITY SIGNAL JUST "PRICE IS HIGH IN ITS RANGE"?')
    print('=' * 118)
    tot_dl, tot_ds = [], []
    for c in COINS:
        bars, fund, dens, pl, ps, _ = load(c, BASE['window'], BASE['halflife'],
                                           BASE['tiers'], BASE['band'], BASE['pct_win'])
        hi = engine.rolling_max([b['h'] for b in bars], 20)
        lo = engine.rolling_min([b['l'] for b in bars], 20)
        xs_dl, ys_dl, xs_ds = [], [], []
        for i in range(WARMUP, len(bars)):
            if dens[i] is None or hi[i] is None or hi[i] <= lo[i]:
                continue
            posr = (bars[i]['c'] - lo[i]) / (hi[i] - lo[i])   # 1 = at 20d high
            xs_dl.append(posr); ys_dl.append(dens[i]['dl'])
            xs_ds.append(dens[i]['ds'])
        if len(xs_dl) < 50:
            continue
        r_dl = _corr(xs_dl, ys_dl)
        r_ds = _corr(xs_dl, xs_ds)
        tot_dl.append(r_dl); tot_ds.append(r_ds)
        # and the blunt version: how often is the signal on while price is high?
        on = [x for x, y in zip(xs_dl, [pl[i] for i in range(WARMUP, len(bars))
                                        if dens[i] is not None and hi[i] is not None
                                        and hi[i] > lo[i]]) if y is not None and y >= 0.80]
        print('  {:<5} corr(range-position, dl) = {:+.2f}    corr(range-position, ds) = {:+.2f}'
              '    mean range-position when signal on = {:.2f}'.format(
                  c, r_dl, r_ds, st.mean(on) if on else float('nan')))
    if tot_dl:
        print('\n  mean across coins: dl {:+.2f}, ds {:+.2f}'.format(
            st.mean(tot_dl), st.mean(tot_ds)))
    print('  Read the MAGNITUDE, not the sign. Either sign at |r| ~0.5+ means the density')
    print('  number is a monotone re-encoding of where price sits in its trailing range,')
    print('  and the liquidation arithmetic adds no information a range signal lacks.')
    print('  (Measured: dl NEGATIVE - the long-liq band goes dense near the 20d LOW, because')
    print('  a falling spot is what drags the surviving long-liq levels down toward it. So the')
    print('  short leg is a downside-breakout trade and the long leg an upside one - which is')
    print('  what the 0.86 overlap with D1 and 0.74 with S3 were reporting.)')


def _corr(a, b):
    n = len(a)
    ma, mb = st.mean(a), st.mean(b)
    va = sum((x - ma) ** 2 for x in a); vb = sum((y - mb) ** 2 for y in b)
    if va <= 0 or vb <= 0:
        return 0.0
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb)


def main():
    phase0()
    phase1()
    m = phase2()
    phase3()
    phase4()
    phase5(m)
    phase6(m)
    phase7()
    phase8()
    print('\n' + '=' * 118)
    print('TOTAL BACKTEST CONFIGURATIONS EVALUATED: {}'.format(VARIANTS[0]))
    print('=' * 118)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'diag':
        phase8()
    else:
        main()


# ---------------------------------------------------------------------------
# WHAT THE RUN ACTUALLY SAID  (2026-09-07, 35 configurations)
# ---------------------------------------------------------------------------
CONCLUSION = """
VERDICT: REJECTED. Five independent checks agree, and the one that matters most
is the one the task named as the point of the idea.

1. THERE ARE NO BANDS. The aggregate density profile is smooth and MONOTONE
   INCREASING with distance from spot: 0.000 of surviving weight at spot, 0.003
   at -1%, rising steadily to 0.039 at -18%. No lumps, no clusters, no
   targetable levels. This is geometry, not a market fact - 20x maps to -5%,
   10x to -10%, 5x to -20%, so the tiers smear weight outward - and the
   survival filter deletes precisely the near-spot levels, because those are
   the ones price already ran through. The premise "a dense band sits at a
   knowable price just below spot" is not visible in the proxy at all. Median
   dl is 0.014: about 1.4% of live liquidation weight sits within 5% of spot.

2. GROSS AND COST-FREE, THE SIGNAL PREDICTS NOTHING. Forward returns by dl
   decile are flat and non-monotone (top decile fwd3d -0.10%, fwd5d +0.22%;
   the 30-40 decile is the best at +0.61%/+0.96%). The exact traded conditional
   - dl>=0.80 AND price falling - gives fwd3d +0.07% / fwd5d +0.27% against
   +0.17% / +0.26% for every other bar. Identical, and POSITIVE, when the trade
   built on it is a SHORT.

3. DOSE-RESPONSE IS FLAT AND NON-MONOTONE, which is the check that was supposed
   to carry the mechanism: thresh 0.50/0.60/0.70/0.80/0.90/0.95 gives trimmed
   +0.08 / -0.29 / -0.08 / +0.46 / +0.08 / +0.16 %. A denser band does not give
   a bigger cascade. The chosen 0.80 is simply the best cell in the ladder.

4. THE PREMISE TEST FAILS OUTRIGHT. Entering BEFORE the volume spike scores
   +0.69% (trim +0.46%). S3 entering ON the spike scores +1.57% (trim +1.30%)
   over the same window and coins. Getting in front of the flow is WORSE than
   reacting to it. Worse still, the intersection - dense band AND a 1.5x volume
   print, i.e. a cascade actually running through a level the map called dense
   - is -0.52%. The band filter destroys S3's edge on exactly the days the
   hypothesis says the mechanism is operating. That is the opposite sign from
   the prediction, not a weak confirmation.

5. IT IS NOT A NEW BET ANYWAY. Position overlap: D1 0.86, S3 0.74, M3 0.60,
   B1 0.59. Above the 0.6 kill line against two live strategies.

   Phase 8 diagnoses WHY, and in doing so CORRECTS the reason prior #3 guessed.
   The prior predicted "dense band below = price near the top of its range".
   Measured, the correlation runs the other way: corr(20d range-position, dl) =
   -0.49 across coins (BTC -0.67, ETH -0.43, SOL -0.45, HYPE -0.43), and mean
   range-position when the short signal fires is 0.29, i.e. near the 20d LOW.
   The mechanics are the reverse of the guess - a FALLING spot is what drags the
   surviving long-liq levels down into the 5% band beneath it, so "dense long-liq
   band below" decodes as "price is low and falling". corr with ds is +0.61,
   the mirror.

   The conclusion is unchanged and arguably firmer: at |r| ~0.5-0.6 the density
   number is a monotone re-encoding of position-within-range, so the short leg
   is a downside-breakout trade and the long leg an upside one. This is a
   breakout signal in a liquidation costume, executed at 144 trades/yr, and the
   book already owns that bet in a cheaper form.

The headline +0.69% is not an edge worth arguing over: train +0.17% (trimmed
+0.01%) against test +1.27%, BTC outright negative at -0.45%, 2024 negative,
and the per-coin ordering BTC < ETH < SOL < HYPE is the ordering of realised
volatility rather than of anything mechanical. At 144 trades/yr it pays 27.4%
of notional per year in execution cost, and trimmed expectancy goes negative
at 4x costs.

The inverted (band-as-support) trade is -1.01% pooled, but that is the mirror
of the cascade trade plus a second round trip, so it is not independent
evidence for absorption - it is the same nothing, sign-flipped.
"""
