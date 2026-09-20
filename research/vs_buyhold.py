r"""
Does it actually beat holding the thing? The gate every strategy here must pass.

WHY THIS EXISTS. The Wealthsimple book carried two strategies with alpha
t-statistics of 2.78 and 3.22 and a third at 4.45, and NOT ONE of the 60 cells
ever produced more money than simply owning the instrument. ZEB.TO trend, the
strongest of them, ended at 91.0% of buy-and-hold over 16.3 years. The ordering
across instruments was the tell: the HIGHER the alpha t-statistic, the CLOSER to
buy-and-hold - t=4.45 kept 91%, t=1.55 kept 51%. The statistic was measuring how
little damage the low-beta drag did.

Decomposed exactly, on a long/flat rule:

    alpha = (w_bar - beta) * E[x]  +  Cov(w, x)  -  costs
            \_____ exposure gap ___/   \_ timing _/

On ZEB that was +5.19% + 3.02% - 0.10%. SIXTY-FOUR PERCENT of the "alpha" was the
exposure-gap term - being out of a rising market, which alpha-versus-benchmark
rewards and a brokerage account does not. The same trap appeared independently in
deflated_sharpe(), where VFV BUY AND HOLD scores DSR 0.9508 at an honest trial
count: doing nothing passes.

So this file exists to ask the blunt question first, before any alpha, DSR, PBO or
expectancy number is quoted: DID IT MAKE MORE MONEY THAN NOT BOTHERING.

WHAT IS DIFFERENT ABOUT THE CRYPTO BOOK, and why the answer is not automatic.
S3, D1, M3 and B1 are LONG/SHORT, not long/flat. The exposure-gap term does not
apply the same way, because a short position has negative beta rather than zero,
and a rule that is short in a rising market loses money outright instead of merely
lagging. That makes the comparison harder to pass, not easier - and it also makes
the SIDE DECOMPOSITION below the interesting part. A long/flat rule cannot tell
you whether its edge is beta or skill; a long/short one can, by asking whether the
short side makes money at all. If the longs carry everything, the strategy is a
worse index fund. If the shorts carry their weight, there is something there that
buy-and-hold cannot replicate no matter how the market moves.

Buy-and-hold here is the HONEST benchmark for this account: hold the coin, no
leverage, no rebalancing, paying the same round-trip cost once to get in.

    python research/vs_buyhold.py            # all four strategies
    python research/vs_buyhold.py D1 B1
"""
import math
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import institutional as inst
import stress_crypto as sc
import tsx_engine as eng

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']


def equity(rets):
    eq = 1.0
    for r in rets:
        eq *= (1 + r)
    return eq


def side_split(weights, rets, cost_rt):
    """Return (long_contrib, short_contrib, flat_share, long_share, short_share).

    Contributions are summed simple returns net of the cost charged on that side's
    own turnover - so the two halves add to roughly the whole and can be compared
    directly against each other.
    """
    lo = sh = 0.0
    nl = ns = nf = 0
    prev = 0.0
    for i, w in enumerate(weights):
        turn = abs(w - prev)
        pnl = w * rets[i] - turn * (cost_rt / 2.0)
        if w > 0:
            lo += pnl
            nl += 1
        elif w < 0:
            sh += pnl
            ns += 1
        else:
            nf += 1
        prev = w
    n = max(1, len(weights))
    return lo, sh, nf / n, nl / n, ns / n


def exposure_decomposition(weights, rets):
    """alpha = (w_bar - beta) * E[x] + Cov(w, x), the identity that exposed the
    equity result. Reported per strategy so the same thing cannot hide here."""
    n = min(len(weights), len(rets))
    w, x = weights[:n], rets[:n]
    wb, xb = st.mean(w), st.mean(x)
    vx = sum((v - xb) ** 2 for v in x)
    if vx <= 0:
        return None
    strat = [w[i] * x[i] for i in range(n)]
    sb = st.mean(strat)
    beta = sum((x[i] - xb) * (strat[i] - sb) for i in range(n)) / vx
    cov = sum((w[i] - wb) * (x[i] - xb) for i in range(n)) / n
    return {'exposure': wb, 'beta': beta,
            'gap_term': (wb - beta) * xb * inst.TRADING_DAYS,
            'timing_term': cov * inst.TRADING_DAYS}


SPECS = {
    'S3': lambda c: (sc.market_for(c),
                     sc.weights_from(__import__('strategies_batch2').volume_spike,
                                     sc.S3P, c, sc.market_for(c)['fund'], 60)),
    'D1': lambda c: (sc.market_for(c),
                     sc.weights_from(sc.range_breakout, sc.D1P, c,
                                     sc.market_for(c)['fund'], 60)),
    'M3': lambda c: (sc.market_for(c),
                     sc.weights_from(sc.donchian_turtle, sc.M3P, c,
                                     sc.market_for(c)['fund'], sc.M3_WARMUP)),
    'B1': lambda c: (sc.basis_market_for(c), sc.basis_weights_for(c)),
}


def run(name):
    build = SPECS[name]
    print()
    print('=' * 104)
    print('{}  vs BUY AND HOLD'.format(name))
    print('=' * 104)
    print('  {:<6}{:>10}{:>11}{:>12}{:>11}{:>11}{:>10}{:>10}{:>11}'.format(
        'coin', 'strat', 'hold', 'TERMINAL', 'strat Sh', 'hold Sh',
        'strat DD', 'hold DD', 'beats?'))
    print('  ' + '-' * 96)
    rows = []
    for c in COINS:
        try:
            mk, wf = build(c)
            w, r = stress_align(wf(mk), mk['ret'])
        except Exception as e:
            print('  {:<6} FAILED {}'.format(c, str(e)[:60]))
            continue
        s = eng.run(w, r, mk['rt'])
        es, eb = equity(s), equity(r)
        rows.append((c, mk, w, r, s, es, eb))
        print('  {:<6}{:>10}{:>11}{:>12}{:>11}{:>11}{:>10}{:>10}{:>11}'.format(
            c, '{:+.1%}'.format(es - 1), '{:+.1%}'.format(eb - 1),
            '{:.1%}'.format(es / eb), '{:.2f}'.format(inst.sharpe(s)),
            '{:.2f}'.format(inst.sharpe(r)), '{:.0%}'.format(inst.max_drawdown(s)),
            '{:.0%}'.format(inst.max_drawdown(r)),
            'YES' if es > eb else 'no'))

    if not rows:
        return
    print()
    print('  WHERE THE MONEY COMES FROM - long side vs short side, net of that')
    print('  side\'s own cost. If the longs carry everything, it is a worse index fund.')
    print('  {:<6}{:>12}{:>12}{:>11}{:>10}{:>10}'.format(
        'coin', 'LONG P&L', 'SHORT P&L', '% flat', '% long', '% short'))
    print('  ' + '-' * 64)
    for c, mk, w, r, s, es, eb in rows:
        lo, sh, f, l, sr = side_split(w, r, mk['rt'])
        print('  {:<6}{:>12}{:>12}{:>11}{:>10}{:>10}'.format(
            c, '{:+.1%}'.format(lo), '{:+.1%}'.format(sh), '{:.0%}'.format(f),
            '{:.0%}'.format(l), '{:.0%}'.format(sr)))

    print()
    print('  THE DECOMPOSITION THAT CAUGHT THE EQUITY BOOK')
    print('  alpha = (exposure - beta) x E[market] + Cov(weight, market)')
    print('  {:<6}{:>11}{:>9}{:>15}{:>15}{:>12}'.format(
        'coin', 'exposure', 'beta', 'exposure gap', 'timing', 'gap share'))
    print('  ' + '-' * 70)
    for c, mk, w, r, s, es, eb in rows:
        d = exposure_decomposition(w, r)
        if not d:
            continue
        tot = d['gap_term'] + d['timing_term']
        print('  {:<6}{:>11}{:>9}{:>15}{:>15}{:>12}'.format(
            c, '{:+.0%}'.format(d['exposure']), '{:.2f}'.format(d['beta']),
            '{:+.2%}/yr'.format(d['gap_term']), '{:+.2%}/yr'.format(d['timing_term']),
            '{:.0%}'.format(d['gap_term'] / tot) if tot else '-'))

    beat = sum(1 for _, _, _, _, _, es, eb in rows if es > eb)
    print()
    print('  VERDICT: {} of {} coins beat buy and hold in money.'.format(beat, len(rows)))


def stress_align(w, r):
    n = min(len(w), len(r))
    return [float(x) for x in w[:n]], list(r[:n])


def common_window():
    """Every strategy on the SAME dates, because otherwise this is not a comparison.

    B1's series is trimmed to where Hyperliquid spot history exists - bar 616 of
    1189 on BTC, 701 on SOL - and over that shorter, later window BTC buy-and-hold
    returned -19.0% and SOL -41.3%, against +195.5% and +438.0% on the full one.
    So B1 was being scored against a bear market while D1, S3 and M3 were scored
    against a bull. B1 "beating buy and hold on 3 of 4 coins" is partly a statement
    about when its sample starts.

    Keyed by bar timestamp, so slicing cannot silently misalign a weight from one
    strategy against a return from another.
    """
    out = {}
    for c in COINS:
        series = {}
        for nm, build in SPECS.items():
            try:
                mk, wf = build(c)
                w = [float(x) for x in wf(mk)]
                ts = [b['t'] for b in mk['bars']]
                rr = mk['ret']
                n = min(len(w), len(rr), len(ts))
                series[nm] = {ts[i]: (w[i], rr[i]) for i in range(n)}
            except Exception:
                continue
        if len(series) < 2:
            continue
        keys = set.intersection(*(set(v) for v in series.values()))
        out[c] = (sorted(keys), series)
    return out


def report_common():
    print()
    print('=' * 104)
    print('ALL FOUR ON THE SAME DATES - the only fair cross-strategy comparison')
    print('=' * 104)
    data = common_window()
    for c in COINS:
        if c not in data:
            continue
        keys, series = data[c]
        if len(keys) < 200:
            print('  {}: only {} common bars, skipping'.format(c, len(keys)))
            continue
        rr = [series[list(series)[0]][k][1] for k in keys]
        eb = equity(rr)
        print()
        print('  {}   {} common bars   buy and hold {:+.1%}   Sharpe {:.2f}   '
              'maxDD {:.0%}'.format(c, len(keys), eb - 1, inst.sharpe(rr),
                                    inst.max_drawdown(rr)))
        print('    {:<6}{:>11}{:>12}{:>11}{:>10}{:>12}{:>10}'.format(
            'strat', 'return', 'TERMINAL', 'Sharpe', 'maxDD', 'short P&L', 'beats?'))
        print('    ' + '-' * 72)
        for nm in ('S3', 'D1', 'M3', 'B1'):
            if nm not in series:
                continue
            w = [series[nm][k][0] for k in keys]
            s = eng.run(w, rr, sc.COST_RT)
            es = equity(s)
            _lo, shp, _f, _l, _sr = side_split(w, rr, sc.COST_RT)
            print('    {:<6}{:>11}{:>12}{:>11}{:>10}{:>12}{:>10}'.format(
                nm, '{:+.1%}'.format(es - 1), '{:.1%}'.format(es / eb),
                '{:.2f}'.format(inst.sharpe(s)), '{:.0%}'.format(inst.max_drawdown(s)),
                '{:+.1%}'.format(shp), 'YES' if es > eb else 'no'))


if __name__ == '__main__':
    want = [a.upper() for a in sys.argv[1:] if not a.startswith('-')] or list(SPECS)
    print('Buy and hold = own the perp outright for the whole window, no leverage.')
    print('Costs: {:.2f}bp round trip, the modelled number every validated figure '
          'used.'.format(sc.COST_RT * 1e4))
    if '--common' in sys.argv or not [a for a in sys.argv[1:] if not a.startswith('-')]:
        report_common()
    for nm in want:
        if nm in SPECS:
            run(nm)
