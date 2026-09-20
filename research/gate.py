r"""
The gate. One entry point that runs every check in the order that matters.

WHY THIS EXISTS. Over one week this project found six separate ways its own
validation apparatus produced flattering answers, and every one was caught by
testing the tool rather than trusting it:

  - PBO's null was read as ~0.60 from SIX draws of a statistic whose sd is 0.22.
    It is 0.5. Two wrong explanations were committed before it was measured.
  - deflated_sharpe() on TOTAL return measures beta. VFV buy-and-hold scores
    DSR 0.9508 at an honest trial count: doing nothing passes.
  - alpha-versus-benchmark rewards being under-exposed to a rising market. On
    ZEB, 64% of the "alpha" was the exposure-gap term, and 0 of 60 cells in that
    family ever beat buy-and-hold.
  - pooled.overlap is not a correlation. It scored 0.94 on 14% of bars.
  - the crypto stress adapter was misaligned by one bar, inverting a published
    mechanism finding.
  - liquidity_stress capped size with min(x, cap), which silently turns a
    long/short book net-short.

The knowledge from those is currently spread across six docstrings. A docstring
cannot stop anyone quoting an alpha t-statistic without checking terminal wealth.
This file can, by running the checks in an order where the cheap disqualifying
question comes FIRST and refusing to print a verdict when it has not been asked.

THE ORDER IS THE POINT.

  GATE 0  MONEY.      Did it beat holding the thing? If not, did it beat a copy
                      of itself that trades identically while looking at nothing?
                      Everything downstream is meaningless until this is answered,
                      because a strategy that loses to buy-and-hold does not need
                      a Sharpe ratio, it needs a reason to exist.
  GATE 1  MECHANISM.  Stated BEFORE the numbers, by a human, in one sentence. Not
                      automatable and not optional - this function refuses to
                      report without it. "The numbers look good" is how the
                      withdrawn overnight strategy got published.
  GATE 2  COST.       Break-even multiple by bisection.
  GATE 3  TIMING.     What one bar of delay costs. The cheapest test for telling a
                      risk premium from a microstructure artefact.
  GATE 4  OVERFIT.    PBO as a p-value against its own shape's null, never raw.
                      DSR on the ACTIVE return, never the total.
  GATE 5  TAIL.       The drawdown DISTRIBUTION, not the one that happened.
  GATE 6  BREAK.      sup-F at an unknown date, null by stationary bootstrap.

A strategy that fails GATE 0 can still be worth having - the TSX volatility
overlay halves drawdown and that is a real product - but it must then be described
as a risk overlay and never as alpha. This file prints that distinction rather than
leaving it to be inferred.

    from gate import evaluate
    evaluate('D1 range-break BTC', weight_fn, market,
             mechanism='Stops cluster beyond 20d extremes; a >=2x ATR break '
                       'discharges them, so the move continues for 1-2 days.')
"""
import math
import random
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import institutional as inst
import stress
import tsx_engine as eng


def _equity(rets):
    eq = 1.0
    for r in rets:
        eq *= (1 + r)
    return eq


def _rotate(w, k):
    k %= len(w)
    return w[-k:] + w[:-k] if k else list(w)


def gate0_money(w, r, rt, draws=300, seed=11):
    """Terminal wealth against buy-and-hold, and against a shuffled twin.

    The shuffle preserves the switch count, every block length, total exposure
    and the position autocorrelation exactly; it destroys only the alignment
    with the market. So beating it means the SIGNAL adds money, separately from
    the question of whether reduced exposure costs more than the signal adds.
    """
    rng = random.Random(seed)
    s = eng.run(w, r, rt)
    es, eb = _equity(s), _equity(r)
    null = []
    for _ in range(draws):
        null.append(_equity(eng.run(_rotate(w, rng.randrange(len(w))), r, rt)))
    null.sort()
    p = (sum(1 for v in null if v >= es) + 1) / (len(null) + 1)
    # the identity that exposed the equity book
    n = min(len(w), len(r))
    wb, xb = st.mean(w[:n]), st.mean(r[:n])
    vx = sum((v - xb) ** 2 for v in r[:n])
    strat = [w[i] * r[i] for i in range(n)]
    sb = st.mean(strat)
    beta = (sum((r[i] - xb) * (strat[i] - sb) for i in range(n)) / vx) if vx else 0.0
    cov = sum((w[i] - wb) * (r[i] - xb) for i in range(n)) / n
    gap = (wb - beta) * xb * inst.TRADING_DAYS
    tim = cov * inst.TRADING_DAYS
    # REGIME SPLIT, because one terminal number hides the thing that matters most
    # for a rule that is flat much of the time. D1/BTC reads 72.2% of buy-and-hold
    # over a window where BTC rose 195%, and 153% over one where it fell 19%. Both
    # are true; quoting either alone is not. Thirds of the timeline, each scored
    # against what holding did over that same stretch.
    thirds = []
    k = max(1, len(r) // 3)
    for i in range(3):
        lo, hi = i * k, (len(r) if i == 2 else (i + 1) * k)
        rr, ww = r[lo:hi], w[lo:hi]
        if len(rr) < 20:
            continue
        eh = _equity(rr)
        esub = _equity(eng.run(ww, rr, rt))
        thirds.append({'hold': eh - 1, 'strat': esub - 1,
                       'terminal': esub / eh if eh else 0})
    return {'strat': es - 1, 'hold': eb - 1, 'terminal': es / eb if eb else 0,
            'beats_hold': es > eb, 'shuffle_median': st.median(null) - 1,
            'beats_shuffle': es > st.median(null), 'p_vs_shuffle': p,
            'exposure': wb, 'beta': beta, 'gap_term': gap, 'timing_term': tim,
            'gap_share': gap / (gap + tim) if (gap + tim) else None,
            'thirds': thirds}


def gate4_overfit(w, r, rt, bench, grid_returns=None, n_trials=1):
    """PBO as a p-value; DSR on the ACTIVE return.

    Both corrections matter and both were learned the hard way. A raw PBO is
    unreadable without its own shape's null, and a DSR on total return of a
    long/flat rule is a statement about beta.
    """
    s = eng.run(w, r, rt)
    a = inst.attribution(s, bench[:len(s)])
    out = {'sharpe': inst.sharpe(s)}
    if a:
        beta = a['beta']
        act = [s[i] - beta * bench[i] for i in range(min(len(s), len(bench)))]
        out['alpha_t'] = a['t_alpha']
        out['dsr_total'] = inst.deflated_sharpe(s, n_trials)[0]
        out['dsr_active'] = inst.deflated_sharpe(act, n_trials)[0]
        out['active_sharpe'] = inst.sharpe(act)
    if grid_returns and len(grid_returns) > 1:
        pb = inst.pbo(grid_returns)
        if pb is not None:
            T = min(len(v) for v in grid_returns.values())
            pv = inst.pbo_pvalue(pb, len(grid_returns), T, draws=200)
            out['pbo'] = pb
            out['pbo_p'] = pv['p_value'] if pv else None
    return out


def evaluate(name, weight_fn, market, mechanism=None, grid_returns=None,
             n_trials=1, quick=False):
    """Run every gate in order. Refuses to report without a stated mechanism."""
    if not mechanism or len(mechanism.strip()) < 20:
        raise ValueError(
            'GATE 1 FAILED BEFORE IT RAN: no mechanism supplied.\n'
            'State in one sentence WHO is on the other side and under what '
            'obligation, BEFORE looking at the numbers. This is not paperwork - '
            'the strategy this project withdrew had a Sharpe of 3.30, an alpha '
            't of 11.55, and no mechanism anyone had written down.')

    rets, rt = market['ret'], market['rt']
    w, r = stress._align(weight_fn(market), rets)
    L = []
    P = L.append
    P('=' * 100)
    P('GATE REPORT: {}'.format(name))
    P('=' * 100)
    P('  MECHANISM (gate 1, stated before the numbers):')
    for line in _wrap(mechanism, 92):
        P('    ' + line)
    P('')

    g0 = gate0_money(w, r, rt, draws=150 if quick else 300)
    P('  GATE 0 - MONEY. Did it beat holding the thing?')
    P('    strategy {:+.1%}   buy and hold {:+.1%}   terminal {:.1%}   -> {}'.format(
        g0['strat'], g0['hold'], g0['terminal'],
        'BEATS BUY AND HOLD' if g0['beats_hold'] else 'LOSES TO BUY AND HOLD'))
    P('    vs a shuffled copy of itself: median {:+.1%}, p = {:.3f}  -> {}'.format(
        g0['shuffle_median'], g0['p_vs_shuffle'],
        'the SIGNAL adds money' if g0['beats_shuffle'] else
        'the signal adds NOTHING over trading blindly'))
    P('    exposure {:+.0%}  beta {:.2f}   exposure-gap {:+.2%}/yr   timing {:+.2%}/yr'
      .format(g0['exposure'], g0['beta'], g0['gap_term'], g0['timing_term']))
    if g0.get('thirds'):
        P('    BY REGIME - one terminal number hides this, and it is usually the')
        P('    most decision-relevant thing in the report:')
        for i, th in enumerate(g0['thirds']):
            P('      third {}  holding {:+8.1%}   strategy {:+8.1%}   -> {:>6.1%} of hold  {}'
              .format(i + 1, th['hold'], th['strat'], th['terminal'],
                      'BEATS' if th['terminal'] > 1 else ''))
        ups = [t for t in g0['thirds'] if t['hold'] > 0]
        downs = [t for t in g0['thirds'] if t['hold'] <= 0]
        if ups and downs:
            P('      -> beats holding in {}/{} RISING stretches and {}/{} FALLING'
              .format(sum(1 for t in ups if t['terminal'] > 1), len(ups),
                      sum(1 for t in downs if t['terminal'] > 1), len(downs)))
    if g0['gap_share'] is not None and g0['gap_share'] > 0.4:
        P('    *** {:.0%} of the edge is the EXPOSURE GAP - being out of a rising '
          'market.'.format(g0['gap_share']))
        P('        That is not skill. On ZEB.TO this term was 64% and 0 of 60 '
          'cells beat buy-and-hold.')
    P('')

    be = stress.breakeven_cost_multiple(weight_fn, market)
    ex = stress.execution_stress(weight_fn, market, multiples=(1,), delays=(0, 1))
    d0 = next((x for x in ex if x['delay'] == 0), None)
    d1 = next((x for x in ex if x['delay'] == 1), None)
    P('  GATE 2 - COST.   break-even multiple {}'.format(
        'never (>40x)' if be == float('inf') else '{:.1f}x'.format(be)))
    if d0 and d1 and d0['cagr'] > 0:
        keep = d1['cagr'] / d0['cagr']
        P('  GATE 3 - TIMING. one bar late retains {:.0%} of CAGR  -> {}'.format(
            keep, 'microstructure-dependent' if keep < 0.5 else
            'partly in the entry bar' if keep < 0.85 else 'robust'))
    else:
        P('  GATE 3 - TIMING. baseline CAGR is not positive; read the rows, not a ratio')
    P('')

    g4 = gate4_overfit(w, r, rt, rets, grid_returns, n_trials)
    P('  GATE 4 - OVERFIT.')
    P('    Sharpe {:.2f}   alpha t {:.2f}'.format(
        g4['sharpe'], g4.get('alpha_t', float('nan'))))
    if 'dsr_active' in g4:
        P('    DSR on TOTAL return {:.4f}   <- measures beta, do not quote'.format(
            g4['dsr_total']))
        P('    DSR on ACTIVE return {:.4f}  <- the one that means something '
          '(active SR {:.2f})'.format(g4['dsr_active'], g4['active_sharpe']))
    if 'pbo_p' in g4 and g4['pbo_p'] is not None:
        P('    PBO {:.3f}  ->  p = {:.3f} against its own shape\'s null'.format(
            g4['pbo'], g4['pbo_p']))
    P('')

    s = eng.run(w, r, rt)
    t = stress.tail_stress(s, draws=400 if quick else 1500)
    P('  GATE 5 - TAIL.   realised maxDD {:.1%}  |  bootstrap p95 {:.1%}  p99 {:.1%}'
      .format(t['realised_mdd'], t['mdd_p95'], t['mdd_p99']))
    P('    tail index {}{}'.format(
        '{:.2f}'.format(t['tail_index']) if t['tail_index'] else 'n/a',
        '  *** BELOW 2: loss variance is effectively undefined'
        if t['tail_index'] and t['tail_index'] < 2 else ''))
    sb = stress.structural_break(s, rets, draws=120 if quick else 300)
    if sb:
        P('  GATE 6 - BREAK.  mean p = {:.3f}   alpha p = {:.3f}'.format(
            sb['mean_break']['p_value'],
            sb.get('alpha_break', {}).get('p_value', float('nan'))))
    P('')
    P('  VERDICT')
    if g0['beats_hold']:
        P('    Beats buy-and-hold in money. Judge it as a strategy.')
    elif g0['beats_shuffle']:
        P('    LOSES to buy-and-hold, but beats its own shuffled twin: the signal')
        P('    is real and too small to overcome the cost of reduced exposure.')
        P('    Describe as a RISK OVERLAY, never as alpha. Check whether the')
        P('    drawdown reduction is worth the CAGR given up.')
    else:
        P('    LOSES to buy-and-hold AND adds nothing over trading blindly.')
        P('    There is no result here to write up.')
    P('=' * 100)
    return '\n'.join(L)


def _wrap(s, n):
    words, line, out = s.split(), '', []
    for wd in words:
        if len(line) + len(wd) + 1 > n:
            out.append(line)
            line = wd
        else:
            line = (line + ' ' + wd).strip()
    if line:
        out.append(line)
    return out
