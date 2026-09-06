"""
The gate. A strategy is not "validated" because one backtest was positive -
it has to survive all of this, and the failures get reported the same as the
passes.

  1. FULL SAMPLE       - baseline, and enough trades to say anything at all.
  2. TRAIN/TEST SPLIT  - 60/40 by time. Positive on BOTH halves. A sign flip
                         between halves is the signature of noise, not edge
                         (this project has rejected three strategies on it).
  3. QUARTERLY WALK-FORWARD - the coarse split hides bad regimes; this finds
                         them. Reports positive-quarter count and worst quarter.
  4. PARAMETER NEIGHBOURHOOD - re-run with each parameter nudged. If the edge
                         only exists at one exact setting, it is a saturated
                         edge (curve fit), not a strategy. This is the single
                         most important overfitting check here.
  5. COST SENSITIVITY  - must survive 2x modeled fees+slippage.
  6. CROSS-COIN        - a mechanism claimed to be universal should show up on
                         more than one coin. Reported by the caller.
"""
import statistics as st
import sys
sys.path.insert(0, 'research')
import engine


def split_result(bars, signal_factory, coin, fund, name, warmup, lo, hi, **kw):
    return engine.backtest(bars, signal_factory(), coin, fund, name=name,
                           warmup=warmup, start_i=lo, end_i=hi, **kw)


def quarterly(bars, signal_factory, coin, fund, name, warmup, n_chunks=None, **kw):
    """Sequential time chunks of ~one quarter each across the usable window."""
    usable = len(bars) - warmup
    if usable < 40:
        return []
    span_days = (bars[-1]['t'] - bars[warmup]['t']) / 86_400_000
    if n_chunks is None:
        n_chunks = max(2, int(round(span_days / 91.0)))
    out = []
    step = usable // n_chunks
    for k in range(n_chunks):
        lo = warmup + k * step
        hi = warmup + (k + 1) * step if k < n_chunks - 1 else len(bars) - 1
        r = split_result(bars, signal_factory, coin, fund, '{} Q{}'.format(name, k + 1),
                         warmup, lo, hi, **kw)
        out.append(r)
    return out


def neighbourhood(bars, coin, fund, name, warmup, base_params, factory_from_params,
                  perturbations, **kw):
    """factory_from_params(params) -> signal_factory. perturbations: {key: [values]}"""
    rows = []
    for key, values in perturbations.items():
        for v in values:
            p = dict(base_params)
            if p.get(key) == v:
                continue
            p[key] = v
            r = engine.backtest(bars, factory_from_params(p)(), coin, fund,
                                name='{} [{}={}]'.format(name, key, v), warmup=warmup, **kw)
            rows.append((key, v, r))
    return rows


def full_report(bars, coin, fund, name, warmup, base_params, factory_from_params,
                perturbations, verbose=True, **kw):
    """Run the whole gate. Returns a dict summarising every stage."""
    fac = lambda: factory_from_params(base_params)()   # noqa: E731
    full = engine.backtest(bars, fac(), coin, fund, name=name, warmup=warmup, **kw)

    usable_lo, usable_hi = warmup, len(bars) - 1
    cut = usable_lo + int((usable_hi - usable_lo) * 0.60)
    train = split_result(bars, lambda: factory_from_params(base_params)(), coin, fund,
                         name + ' TRAIN', warmup, usable_lo, cut, **kw)
    test = split_result(bars, lambda: factory_from_params(base_params)(), coin, fund,
                        name + ' TEST', warmup, cut, usable_hi, **kw)

    qs = quarterly(bars, lambda: factory_from_params(base_params)(), coin, fund,
                   name, warmup, **kw)
    q_pos = sum(1 for q in qs if q.n > 0 and q.expectancy > 0)
    q_with_trades = sum(1 for q in qs if q.n > 0)
    worst_q = min((q for q in qs if q.n > 0), key=lambda q: q.expectancy, default=None)

    nb = neighbourhood(bars, coin, fund, name, warmup, base_params,
                       factory_from_params, perturbations, **kw)
    nb_exp = [r.expectancy for _, _, r in nb if r.n >= 5]
    nb_pos = sum(1 for e in nb_exp if e > 0)

    cost2 = engine.backtest(bars, fac(), coin, fund, name=name + ' 2x cost', warmup=warmup,
                            slippage=engine.SLIPPAGE * 2, fee=engine.TAKER_FEE * 2, **kw)

    rep = {
        'coin': coin, 'name': name, 'params': dict(base_params),
        'full': full, 'train': train, 'test': test, 'quarters': qs,
        'q_positive': q_pos, 'q_total': q_with_trades,
        'worst_quarter': worst_q, 'neighbourhood': nb,
        'nb_positive': nb_pos, 'nb_total': len(nb_exp),
        'nb_median_exp': st.median(nb_exp) if nb_exp else None,
        'cost2x': cost2,
    }
    rep['verdict'], rep['reasons'] = judge(rep)
    if verbose:
        print_report(rep)
    return rep


MIN_TRADES = 15
MIN_TRADES_MACRO = 8


def judge(rep, min_trades=None):
    """Mechanical pass/fail so a good-looking chart cannot talk its way through."""
    f, tr, te = rep['full'], rep['train'], rep['test']
    reasons = []
    macro = f.avg_days_held >= 20
    need = min_trades or (MIN_TRADES_MACRO if macro else MIN_TRADES)

    if f.n < need:
        reasons.append('sample too small (n={} < {})'.format(f.n, need))
    if f.expectancy <= 0:
        reasons.append('full-sample expectancy not positive ({:.2%})'.format(f.expectancy))
    if tr.n == 0 or te.n == 0:
        reasons.append('a split half produced no trades')
    else:
        if tr.expectancy <= 0 or te.expectancy <= 0:
            reasons.append('train/test not both positive ({:.2%} / {:.2%})'.format(
                tr.expectancy, te.expectancy))
    if rep['q_total'] >= 3 and rep['q_positive'] / rep['q_total'] < 0.5:
        reasons.append('under half of quarters positive ({}/{})'.format(
            rep['q_positive'], rep['q_total']))
    if rep['nb_total'] >= 4:
        frac = rep['nb_positive'] / rep['nb_total']
        if frac < 0.6:
            reasons.append('parameter-fragile: only {}/{} neighbours positive'.format(
                rep['nb_positive'], rep['nb_total']))
    if rep['cost2x'].n and rep['cost2x'].expectancy <= 0:
        reasons.append('edge dies at 2x costs ({:.2%})'.format(rep['cost2x'].expectancy))

    # A positive average per trade is NOT an edge on its own. Two ways it lies:
    if f.n:
        acct = f.account_cagr(0.20)
        if acct <= 0:
            reasons.append('compounds negative at the real 20% sizing rail '
                           '(account CAGR {:.1%}) - volatility drag eats the mean'.format(acct))
        if f.n > 6 and f.expectancy_ex_best(3) <= 0:
            reasons.append('edge is outlier-dependent: expectancy without the 3 best '
                           'trades is {:.2%}'.format(f.expectancy_ex_best(3)))

    if not reasons:
        return 'PASS', []
    hard = [r for r in reasons if 'sample too small' not in r]
    return ('FAIL' if hard else 'INCONCLUSIVE'), reasons


def print_report(rep):
    f = rep['full']
    print('\n' + '=' * 108)
    print('{}  |  {}  |  params={}'.format(rep['name'], rep['coin'], rep['params']))
    print('=' * 108)
    print('  FULL   ', f.line())
    if f.n:
        print('           avg funding/trade {:+.3f}%  exposure {:.0%}  sharpe/trade {:.2f}  '
              'avg win {:.2%} / avg loss {:.2%}'.format(
                  sum(t.funding_pct for t in f.trades) / f.n * 100, f.exposure_pct(),
                  f.sharpe_per_trade, f.avg_win, f.avg_loss))
        acct = f.account_equity(0.20)
        print('           ACCOUNT @20% sizing: return {:+.1%}  CAGR {:+.1%}  maxDD {:.1%}  '
              '| median trade {:+.2%}  exp ex-top3 {:+.2%}'.format(
                  acct['return'], f.account_cagr(0.20), acct['max_dd'],
                  f.median_trade, f.expectancy_ex_best(3)))
    print('  TRAIN  ', rep['train'].line())
    print('  TEST   ', rep['test'].line())
    print('  QUARTERS: {}/{} positive'.format(rep['q_positive'], rep['q_total']), end='')
    if rep['worst_quarter'] is not None:
        wq = rep['worst_quarter']
        print('   worst: exp {:.2%} (n={}, wr {:.0%})'.format(wq.expectancy, wq.n, wq.win_rate))
    else:
        print()
    for q in rep['quarters']:
        if q.n:
            print('      {:<12} n={:<3} exp={:>7.2%} wr={:>5.0%}'.format(
                q.name.split()[-1], q.n, q.expectancy, q.win_rate))
    if rep['nb_total']:
        print('  NEIGHBOURHOOD: {}/{} perturbations positive, median exp {:.2%}'.format(
            rep['nb_positive'], rep['nb_total'], rep['nb_median_exp']))
        for key, v, r in rep['neighbourhood']:
            if r.n >= 5:
                print('      {:<14}={:<8} n={:<4} exp={:>7.2%}'.format(key, str(v), r.n, r.expectancy))
    print('  2x COSTS:', rep['cost2x'].line())
    print('  >>> VERDICT: {}'.format(rep['verdict']))
    for r in rep['reasons']:
        print('        - ' + r)
