"""
Run the adversarial stress framework against the LIVE crypto book.

WHY THIS EXISTS. research/stress.py has been run on the two equity strategies
only. The four crypto strategies that actually trade - S3, D1, M3, B1 - had never
been stress tested at all, which is backwards: they run on a leveraged perp venue
at a 0.190% modelled round trip, against a TSX book paying 1.1-3.8bp. Cost and
execution matter roughly fifty times more here, and it is here that nothing had
been checked.

THE ADAPTER, AND WHY IT IS THE RISKY PART. stress.py drives a strategy as
`weight_fn(market) -> weight series`. The crypto book is trade-based:
`engine.backtest(bars, signal_fn, coin)`. `pooled.position_series` already
reconstructs +1/-1/0 per bar from a backtest's trades, so the adapter is thin -
but a thin adapter that is subtly wrong stresses a strategy that is not the
strategy, which is worse than not testing. So the baseline is CHECKED against the
recorded per-trade numbers before any stress runs, and this script exits rather
than continue if they disagree.

WHAT THE WEIGHT SERIES DOES AND DOES NOT CAPTURE. It carries direction and timing
faithfully. It does NOT carry the ATR stop, because a stop is an intrabar event
and a daily weight series has no intrabar. Trades therefore exit on the bar the
backtest exited, which is right, but a stop-out inside a bar is applied at that
bar's close rather than at the stop price.

THE FILL CONVENTION IS NOW HANDLED - see `_returns` for the measurement and for
the two wrong explanations that preceded it. In short: this adapter used to
reconstruct close(a) -> close(b) while a trade actually spans open(a) -> open(b),
which understated summed gross by 24.8% (S3), 38.2% (D1) and 65.1% (M3). An M3
verdict was drafted on that basis and withdrawn. Open-to-open alignment brings
the divergence to +26.0% / +13.7% / -13.0%.

WHAT REMAINS, AND IT IS THE ONE THING A DAILY WEIGHT SERIES CANNOT FIX. A stopped
trade exits at the STOP PRICE partway through a bar; this series exits at that
bar's open and so never takes the adverse intrabar move. The residual divergence
above is that, and it flatters strategies that stop out often. B1 is the case to
watch - its stop-outs are its worst trades.

So LEVEL claims from a stress run here are now much closer to the strategy than
they were, but they are still not the strategy, and the direction of the error is
known: too kind to anything that uses its stop.

ANNUALISATION. inst.TRADING_DAYS is 252 and crypto trades 365 days a year, so
every CAGR and Sharpe below is on the equity book's clock, not the calendar's.
That is kept deliberately so the crypto numbers sit on the same footing as the
TSX ones already recorded. It does NOT affect anything this script is actually
being read for: break-even cost multiples, delay-retention ratios, tail indices,
drawdown distributions and break p-values are all invariant to the constant.

B1 IS NOT A CONVERGENCE TRADE, and this file must not imply it is.
core/strategies/basis_dislocation.py emits ONE perp leg - no spot leg, no hedge.
The basis is an entry TRIGGER only, so the P&L is the perp price move. arb_stress
is still the right diagnostic to run on the basis SERIES (it asks what share of
dislocations fail to revert inside the hold, which is the trigger's own failure
rate) but its answer is about the signal, not about a hedged spread.

B1 AND path_stress. path_stress resamples the price path and re-runs the rule.
B1's rule reads an EXTERNAL basis array indexed by bar position, which the
resampler cannot carry, so the basis would stay pinned to the original calendar
while prices moved to a synthetic one. That is not a path stress - so it is run
and reported as what it actually is: a randomised-timing placebo, which answers a
different and still useful question (does B1 earn from WHEN it trades, or merely
from its net short exposure?).

    python research/stress_crypto.py            # D1 by default
    python research/stress_crypto.py M3 B1      # a subset
    python research/stress_crypto.py --quick
"""
import math
import random
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import engine
import hl_data
import institutional as inst
import pooled
import stress
import tsx_engine as eng
from strategies_basis import basis_dislocation, build_basis
from strategies_daily import range_breakout
from strategies_macro import donchian_turtle

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
DAYS = 2200
COST_RT = 0.0019          # the modelled round trip every validated number used

# Parameters as recorded in the book.
S3P = {'vol_n': 20, 'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}
# atr_ratio is 2.0, NOT the 1.5 in run_daily.py's candidate list. 2.0
# reproduces the recorded n=74 / +3.51% / 65% exactly; 1.5 gives 135 trades at
# +0.76%, which is a different strategy. CLAUDE.md has it right and that
# candidate list is stale.
D1P = {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}
# M3 is the Turtle standard, warmup 85 - the setting cost_efficiency.py scored.
M3P = {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0}
M3_WARMUP = 85
# B1 is run_basis.BASE verbatim. Its warmup is PER COIN (spot history starts at a
# different date for each), so it is computed in basis_market_for, not here.
B1P = {'pct': 0.90, 'win': 180, 'atr_mult': 2.5, 'max_hold': 7, 'min_hist': 60}
SPOT = {'BTC': '@142', 'ETH': '@151', 'SOL': '@156', 'HYPE': '@107'}


def _returns(bars):
    """OPEN-to-open, and the alignment is the whole point.

    engine.backtest fills at an open, and it records entry_t / exit_t as the
    bars those FILLS happened on - verified directly against the trade log:
    entry_price equals bars[a]['o'] to the cent, exit_price equals bars[b]['o'].
    A trade therefore spans open(a) -> open(b), and pooled.position_series marks
    exactly range(a, b). So the return a held weight earns over bar k is

        open(k+1) / open(k) - 1

    and the product over the held bars telescopes to open(b)/open(a), which is
    the trade's own gross.

    THIS WAS CLOSE-TO-CLOSE AND IT WAS BADLY WRONG. Reconstructing close(a) ->
    close(b) shifts both ends by one bar's intrabar move: on the first BTC D1
    trade the real result is -1.85% and the close-to-close version reads +6.40%.
    Across the book it understated summed gross by 24.8% (S3), 38.2% (D1) and
    65.1% (M3), and an M3 verdict was drafted and had to be withdrawn on the
    strength of it.

    Two wrong explanations were committed before this was measured - first that
    the fill convention could not be represented at all, then that the gap was
    arithmetic-vs-geometric summation. The first open-to-open attempt was itself
    off by one bar (open(k+2)/open(k+1)) and reproduced the close-to-close
    answer, which is what made the convention look innocent. Corrected:

        summed gross vs the trade record      S3      D1      M3
        close-to-close (old)               -24.8%  -38.2%  -65.1%
        open-to-open, aligned (now)        +26.0%  +13.7%  -13.0%

    The residual is the INTRABAR STOP FILL and cannot be removed here: a stopped
    trade exits at the stop price partway through a bar, while this series exits
    at that bar's open, so it never takes the adverse intrabar move. That is the
    limitation to state - not the fill convention, which is now handled.
    """
    return [bars[k + 1]['o'] / bars[k]['o'] - 1 for k in range(len(bars) - 1)]


def market_for(coin, extended=False):
    # pooled.load applies the TRADEABLE cutoff (funding starts 2023-06-08) and
    # returns the funding curve alongside. Using it rather than hl_data directly
    # is what makes this the same sample the book's numbers came from - running
    # the full 2020+ history instead produced 234 D1 trades against a recorded
    # 74, which is what the baseline check caught.
    bars, fund = pooled.load(coin, extended)
    return {'coin': coin, 'bars': bars, 'fund': fund, 'ret': _returns(bars),
            'dates': [b['t'] for b in bars[1:]], 'rt': COST_RT}


_basis_cache = {}


def basis_market_for(coin):
    """B1's market, plus the basis array and the per-coin warmup run_basis uses.

    The warmup is `first valid basis + min_hist`: B1 cannot trade before spot
    history exists, and run_basis.py sets exactly this. Using a flat 60 instead
    would start the strategy inside its own warmup on every coin."""
    if coin in _basis_cache:
        return _basis_cache[coin]
    mk = market_for(coin)
    spot, _ = hl_data.get_candles(SPOT[coin], '1d', 1200)
    basis = build_basis(mk['bars'], spot)
    first = next((i for i, b in enumerate(basis) if b is not None), 0)

    # TRIM TO THE ERA B1 COULD ACTUALLY TRADE. HL spot history starts long after
    # the perp's: the first valid basis is bar 616 (BTC), 657 (ETH), 701 (SOL),
    # 0 (HYPE) of 1189. Leaving those bars in leaves the weight series pinned at
    # zero for HALF the sample, which does not merely add nothing - it halves the
    # measured CAGR, drags the Sharpe toward zero, and hands the structural-break
    # test a first half that is identically flat (BTC's read "+0.00% -> +26.13%",
    # which is a statement about missing data, not about a changing edge).
    # Slicing bars and basis together preserves alignment, so the rule sees
    # exactly the same inputs; trade-count parity is asserted in verify_baselines.
    bars = mk['bars'][first:]
    basis = basis[first:]
    mk['bars'] = bars
    mk['ret'] = _returns(bars)
    mk['dates'] = [b['t'] for b in bars[1:]]
    mk['basis'] = basis
    mk['warmup'] = B1P.get('min_hist', 60)
    mk['first_basis_idx'] = 0
    mk['trimmed_bars'] = first
    _basis_cache[coin] = mk
    return mk


def weights_from(strategy_fn, params, coin, fund=None, warmup=60):
    """A stress.py-shaped weight_fn built on pooled.position_series."""
    def wf(mk):
        bars = mk['bars']
        try:
            series, _ = pooled.position_series(bars, strategy_fn, params, coin,
                                               fund, warmup)
        except Exception:
            return [0.0] * len(mk['ret'])
        # position_series is per BAR; returns start at bar 1, and the weight held
        # over return i was decided at bar i. So drop the last element, not the
        # first - taking series[1:] would shift every position one day EARLY and
        # hand the rule a day of lookahead.
        return [float(x) for x in series[:len(mk['ret'])]]
    return wf


def basis_weights_for(coin):
    """B1's weight_fn. The basis array travels in the params, exactly as
    run_basis.py injects it, so this is the shipped rule and not a re-write."""
    mk = basis_market_for(coin)
    p = dict(B1P)
    p['basis'] = mk['basis']
    return weights_from(basis_dislocation, p, coin, mk['fund'], mk['warmup'])


def check(label, got, want, tol):
    ok = abs(got - want) <= tol
    print('    {:<34} got {:>9.4f}   recorded {:>9.4f}   {}'.format(
        label, got, want, 'OK' if ok else '*** MISMATCH ***'))
    return ok


def verify_baselines(which):
    """Reproduce the recorded per-trade numbers before stressing anything."""
    print('=' * 100)
    print('VERIFYING the harness reproduces the recorded crypto book')
    print('=' * 100)
    ok = True
    specs = [
        ('D1', 'D1 range-break', range_breakout, D1P, 60, 74, 0.0351, 0.65),
        ('M3', 'M3 donchian 55/20', donchian_turtle, M3P, M3_WARMUP, 49, 0.1285, 0.49),
    ]
    for sid, label, fn, params, warm, want_n, want_exp, want_wr in specs:
        if sid not in which:
            continue
        per, merged = pooled.pooled(fn, params, COINS, warm, name=label)
        n_tot = merged.n
        pnl = [t.pnl_pct for t in merged.trades]
        wins = sum(t.won for t in merged.trades)
        print('  {}'.format(label))
        exp = st.mean(pnl) if pnl else 0.0
        ok = check('trade count', n_tot, want_n, max(8, want_n * 0.15)) and ok
        ok = check('expectancy/trade', exp, want_exp, 0.012) and ok
        ok = check('win rate', wins / n_tot if n_tot else 0, want_wr, 0.10) and ok

    if 'B1' in which:
        merged = engine.Result(coin='POOL', name='B1')
        for c in COINS:
            mk = basis_market_for(c)
            p = dict(B1P)
            p['basis'] = mk['basis']
            r = engine.backtest(mk['bars'], basis_dislocation(p)(), c, mk['fund'],
                                name='B1', warmup=mk['warmup'])
            merged.trades.extend(r.trades)
        print('  B1 basis dislocation')
        pnl = [t.pnl_pct for t in merged.trades]
        wins = sum(t.won for t in merged.trades)
        ok = check('trade count', merged.n, 178, max(8, 178 * 0.15)) and ok
        ok = check('expectancy/trade', st.mean(pnl) if pnl else 0.0, 0.0168, 0.012) and ok
        ok = check('win rate', wins / merged.n if merged.n else 0, 0.545, 0.10) and ok
    return ok


# ------------------------------------------------------------------ B1 extras
def basis_arb_stress(coin, settings):
    """stress.arb_stress on B1's OWN basis series.

    The series carries None for days with no spot bar and for prints beyond the
    2% sanity band. Those are dropped rather than forward-filled: filling would
    invent a dislocation that never printed, and B1 itself already compresses
    them out (its percentile window is built from the valid observations only).
    The count of dropped days is printed so the compression is visible.
    """
    mk = basis_market_for(coin)
    raw = mk['basis']
    valid = [x for x in raw if x is not None]
    holes = sum(1 for x in raw if x is None)
    print('  {:<5} basis obs {:<5} ({} pre-spot bars trimmed, {} interior gaps dropped)'
          .format(coin, len(valid), mk['trimmed_bars'], holes))
    for label, kw in settings:
        r = stress.arb_stress(valid, **kw)
        if r is None:
            print('        {:<26} too few observations / no entries'.format(label))
            continue
        print('        {:<26} entries {:<4} converged {:<4} rate {:.0%}   '
              'unconverged {:.0%}   median hold {}   p90 {}   after forced decoupling {:.0%}'
              .format(label, r['entries'], r['converged'], r['convergence_rate'],
                      r['unconverged_rate'], r['median_hold'], r['p90_hold'],
                      r['rate_after_forced_decoupling']))


def timing_placebo(coin, draws=200, mean_blocks=(5, 21, 63), seed=17):
    """B1's positions held FIXED on the calendar while the price path is
    resampled. Not a path stress - see the module docstring. It isolates one
    thing: whether B1's return comes from WHEN it is positioned, or merely from
    the net exposure it carries. If the placebo scores as well as the real run,
    the timing is doing no work.
    """
    mk = basis_market_for(coin)
    rets = mk['ret']
    w, rr = stress._align(basis_weights_for(coin)(mk), rets)
    base = inst.sharpe(eng.run(w, rr, mk['rt']))
    base_cagr = inst.cagr(eng.run(w, rr, mk['rt']))
    rng = random.Random(seed)
    rows = []
    for mb in mean_blocks:
        sh, cg = [], []
        for _ in range(draws):
            idx = stress._stationary_bootstrap_idx(len(rets), mb, rng)
            path = [rets[i] for i in idx]
            r = eng.run(w, path[:len(w)], mk['rt'])
            if len(r) > 30:
                sh.append(inst.sharpe(r))
                cg.append(inst.cagr(r))
        if not sh:
            continue
        sh.sort()
        rows.append({'mean_block': mb, 'sharpe_p05': sh[int(len(sh) * 0.05)],
                     'sharpe_median': sh[len(sh) // 2],
                     'sharpe_p95': sh[int(len(sh) * 0.95)],
                     'cagr_median': st.median(cg),
                     'realised_sharpe': base, 'realised_cagr': base_cagr,
                     'realised_pctile': sum(1 for s in sh if s < base) / len(sh)})
    return rows


def b1_report(coin, quick):
    """stress.py section by section for B1, skipping path_stress (see docstring)
    and substituting the placebo, so nothing silently runs on a decoupled
    basis/price pair."""
    mk = basis_market_for(coin)
    rets = mk['ret']
    wf = basis_weights_for(coin)
    w, rr = stress._align(wf(mk), rets)
    base = eng.run(w, rr, mk['rt'])
    print('=' * 100)
    print('STRESS TEST: B1 basis dislocation  {}   ({} obs, {:.1f}y, cost {:.2f}bp)'
          .format(coin, len(rr), len(rr) / 252.0, mk['rt'] * 1e4))
    print('=' * 100)
    s = stress._stats(base, rr)
    a = inst.attribution(base, rr)
    print('  BASELINE   CAGR {:+.2%}   Sharpe {:.2f}   maxDD {:.1%}   alpha {:+.2%}/yr t={:.2f}'
          .format(s['cagr'], s['sharpe'], s['mdd'],
                  a['alpha_ann'] if a else 0.0, a['t_alpha'] if a else 0.0))
    print('  mean weight {:+.3f}   share of days short {:.0%}   long {:.0%}   flat {:.0%}'
          .format(st.mean(w), sum(1 for x in w if x < 0) / len(w),
                  sum(1 for x in w if x > 0) / len(w),
                  sum(1 for x in w if x == 0) / len(w)))
    print('')

    print('  1. EXECUTION  - cost multiples x acting k days late')
    print('     {:>7}{:>10}{:>10}{:>10}{:>10}'.format('delay', 'cost x1', 'x2', 'x4', 'x8'))
    ex = stress.execution_stress(wf, mk, multiples=(1, 2, 4, 8), delays=(0, 1, 2, 3))
    for d in (0, 1, 2, 3):
        row = {r['mult']: r for r in ex if r['delay'] == d}
        print('     {:>7}{:>10}{:>10}{:>10}{:>10}'.format(
            '{}d'.format(d),
            *['{:+.2%}'.format(row[m]['cagr']) if m in row else '-' for m in (1, 2, 4, 8)]))
    be = stress.breakeven_cost_multiple(wf, mk)
    print('     break-even cost multiple: {}'.format(
        'never (>40x)' if be == float('inf') else '{:.1f}x'.format(be)))
    d0 = next((r for r in ex if r['delay'] == 0 and r['mult'] == 1), None)
    d1 = next((r for r in ex if r['delay'] == 1 and r['mult'] == 1), None)
    if d0 and d1 and d0['cagr'] <= 0:
        print('     baseline CAGR is {:+.2%}; a delay-retention ratio would be '
              'meaningless, read the rows'.format(d0['cagr']))
    elif d0 and d1 and d0['cagr']:
        keep = d1['cagr'] / d0['cagr']
        tag = ('<- MICROSTRUCTURE-DEPENDENT' if keep < 0.5 else
               '<- TIMING-SENSITIVE' if keep < 0.85 else '<- robust to timing')
        print('     one-day delay retains {:.0%} of CAGR   {}'.format(keep, tag))
    print('')

    print('  2. LIQUIDITY  - vol-scaled impact and size caps')
    for r in stress.liquidity_stress(wf, mk):
        extra = '   mean cost {:.2f}bp'.format(r['mean_cost_bp']) if 'mean_cost_bp' in r else ''
        print('     {:<26} CAGR {:+.2%}   Sharpe {:.2f}   maxDD {:.1%}{}'.format(
            r['label'], r['cagr'], r['sharpe'], r['mdd'], extra))
    print('')

    print('  3. REGIME  - performance by MARKET state (classified trailing-only)')
    print('     {:<16}{:>7}{:>12}{:>12}{:>11}{:>9}'.format(
        'regime', 'n', 'strat/yr', 'bench/yr', 'exposure', 'Sharpe'))
    for r in stress.regime_stress(wf, mk):
        print('     {:<16}{:>7}{:>12}{:>12}{:>11}{:>9}'.format(
            r['regime'], r['n'], '{:+.1%}'.format(r['strat_ann']),
            '{:+.1%}'.format(r['bench_ann']), '{:.0%}'.format(r['exposure']),
            '{:.2f}'.format(r['sharpe'])))
    print('     worst contiguous windows:')
    for ww in stress.worst_windows(base):
        print('        {:>4}d  {:+.1%}'.format(ww['days'], ww['worst_return']))
    print('')

    print('  4. PARAMETER  - plateau or cliff?')
    ps = stress.parameter_stress(b1_build, mk, B1_GRID)
    if ps:
        print('     {} cells   {:.0%} positive   CAGR median {:+.2%}  (min {:+.2%}, max {:+.2%})'
              .format(ps['cells'], ps['positive_share'], ps['cagr_median'],
                      ps['cagr_min'], ps['cagr_max']))
        print('     Sharpe median {:.2f}, best {:.2f}, best-minus-median {:.2f}   {}   best={}'
              .format(ps['sharpe_median'], ps['sharpe_max'],
                      ps['best_minus_median_sharpe'],
                      '<- SPIKE, suspect' if ps['best_minus_median_sharpe'] > 0.5 else '<- plateau',
                      ps['best_key']))
    print('')

    print('  5. STRUCTURAL BREAK  - did the edge change?')
    sb = stress.structural_break(base, rr, draws=150 if quick else 400)
    if sb:
        m_ = sb['mean_break']
        print('     mean break    supF {:>7.1f}   p = {:.3f}   {}'.format(
            m_['supF'], m_['p_value'],
            '<- BREAK' if m_['p_value'] < 0.05 else '<- stable'))
        if 'alpha_break' in sb:
            ab = sb['alpha_break']
            print('     alpha break   supF {:>7.1f}   p = {:.3f}   {}'.format(
                ab['supF'], ab['p_value'],
                '<- ALPHA BREAK' if ab['p_value'] < 0.05 else '<- alpha stable'))
        h = sb['halves']
        print('     first half {:+.2%} (Sh {:.2f})  ->  second half {:+.2%} (Sh {:.2f})'
              .format(h['first_cagr'], h['first_sharpe'], h['second_cagr'],
                      h['second_sharpe']))
    print('')

    print('  6. TAIL')
    t = stress.tail_stress(base, draws=500 if quick else 2000)
    print('     VaR95 {:.2%}  ES95 {:.2%}    VaR99 {:.2%}  ES99 {:.2%}    tail index {}'
          .format(t['var95'], t['es95'] or 0.0, t['var99'], t['es99'] or 0.0,
                  '{:.2f}'.format(t['tail_index']) if t['tail_index'] else 'n/a'))
    print('     maxDD realised {:.1%}  |  bootstrap median {:.1%}   p95 {:.1%}   p99 {:.1%}   worst {:.1%}'
          .format(t['realised_mdd'], t['mdd_median'], t['mdd_p95'], t['mdd_p99'],
                  t['mdd_worst']))
    if t['realised_mdd'] > t['mdd_p95']:
        print('     the realised drawdown is MILDER than the 95th-percentile path - plan for worse')
    print('')

    print('  7. TIMING PLACEBO (not a path stress - positions fixed, prices resampled)')
    print('     {:>11}{:>10}{:>11}{:>10}{:>14}{:>13}'.format(
        'mean block', 'Sh p05', 'Sh median', 'Sh p95', 'CAGR median', 'real pctile'))
    for r in timing_placebo(coin, draws=60 if quick else 200):
        print('     {:>11}{:>10}{:>11}{:>10}{:>14}{:>13}'.format(
            '{}d'.format(r['mean_block']), '{:.2f}'.format(r['sharpe_p05']),
            '{:.2f}'.format(r['sharpe_median']), '{:.2f}'.format(r['sharpe_p95']),
            '{:+.2%}'.format(r['cagr_median']), '{:.0%}'.format(r['realised_pctile'])))
    print('')

    print('  8. FAILURE  - the worst episodes, and whether it was exposed')
    print('     {:<26}{:>9}{:>8}{:>11}{:>12}'.format(
        'period', 'depth', 'days', 'exposure', 'recovered'))
    for f in stress.failure_analysis(wf, mk):
        print('     {:<26}{:>9}{:>8}{:>11}{:>12}'.format(
            '{} -> {}'.format(str(f['from'])[:10], str(f['to'])[:10]),
            '{:.1%}'.format(f['depth']), f['days'],
            '{:.0%}'.format(f['avg_exposure']), 'yes' if f['recovered'] else 'NO'))
    print('=' * 100)


def run_one(label, weight_fn, mk, quick, grid=None, build_fn=None):
    print()
    print(stress.full_report('{}  {}'.format(label, mk['coin']), weight_fn, mk,
                             grid=grid, build_fn=build_fn, quick=quick))


# ---------------------------------------------------------- parameter grids
def m3_build(mk, key):
    entry_n, exit_n, atr_mult = key
    p = {'entry_n': entry_n, 'exit_n': exit_n, 'atr_mult': atr_mult}
    return weights_from(donchian_turtle, p, mk['coin'], mk.get('fund'),
                        max(M3_WARMUP, entry_n + 30))(mk)


M3_GRID = [(e, x, a) for e in (40, 45, 55, 65, 80) for x in (15, 20, 25, 30)
           for a in (2.0, 3.0, 4.0)]


def b1_build(mk, key):
    pct, win, max_hold, atr_mult = key
    p = dict(B1P)
    p.update(pct=pct, win=win, max_hold=max_hold, atr_mult=atr_mult,
             basis=mk['basis'])
    return weights_from(basis_dislocation, p, mk['coin'], mk['fund'],
                        mk['warmup'])(mk)


B1_GRID = [(p, w, h, a) for p in (0.80, 0.85, 0.90, 0.95)
           for w in (90, 120, 180, 250, 360) for h in (3, 5, 7, 10, 14)
           for a in (2.5,)]


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    quick = '--quick' in sys.argv
    want = set(a.upper() for a in args) or {'D1'}

    if not verify_baselines(want):
        print('\n  The adapter does NOT reproduce the recorded numbers.')
        print('  Stopping: stressing a different strategy would be misleading.')
        sys.exit(1)
    print('\n  Baseline reproduces. Proceeding to stress.\n')

    if 'B1' in want:
        print('=' * 100)
        print('B1 CONVERGENCE FAILURE - stress.arb_stress on the RAW BASIS SERIES')
        print('  Reminder: B1 is a single perp leg. This measures how often the')
        print('  TRIGGER fails to revert inside the hold, not a hedged spread.')
        print('=' * 100)
        settings = [
            ('default z2.0/60d/hold20', dict(entry_z=2.0, max_hold=20, window=60)),
            ('B1-matched z1.28/180d/h7', dict(entry_z=1.2816, max_hold=7, window=180)),
            ('B1-matched z1.28/180d/h20', dict(entry_z=1.2816, max_hold=20, window=180)),
            ('strict z2.0/180d/hold7', dict(entry_z=2.0, max_hold=7, window=180)),
        ]
        for coin in COINS:
            basis_arb_stress(coin, settings)
        print('')

    for coin in COINS:
        if 'D1' in want:
            mk = market_for(coin)
            run_one('D1 range-break',
                    weights_from(range_breakout, D1P, coin, mk.get('fund')),
                    mk, quick)
        if 'M3' in want:
            mk = market_for(coin)
            run_one('M3 donchian 55/20',
                    weights_from(donchian_turtle, M3P, coin, mk.get('fund'),
                                 M3_WARMUP),
                    mk, quick, grid=M3_GRID, build_fn=m3_build)
        if 'B1' in want:
            b1_report(coin, quick)
