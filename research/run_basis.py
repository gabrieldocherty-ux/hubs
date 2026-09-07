"""Full gate on the basis-dislocation strategy, plus the sub-period test that
matters most: 4-of-4 cross-coin agreement means little when all four coins are
highly correlated and share one short sample window."""
import sys, datetime, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, hl_data
from strategies_basis import basis_dislocation, build_basis

SPOT = {'BTC': '@142', 'ETH': '@151', 'SOL': '@156', 'HYPE': '@107'}
COINS = list(SPOT)
_cache = {}


def load(coin):
    if coin in _cache:
        return _cache[coin]
    perp, fund = pooled.load(coin)
    spot, _ = hl_data.get_candles(SPOT[coin], '1d', 1200)
    basis = build_basis(perp, spot)
    first = next((i for i, b in enumerate(basis) if b is not None), 0)
    _cache[coin] = (perp, fund, basis, first)
    return _cache[coin]


def run(params, warm_extra=0, **kw):
    merged = engine.Result(coin='POOL', name='B1')
    per = {}
    for c in COINS:
        perp, fund, basis, first = load(c)
        p = dict(params)
        p['basis'] = basis
        warm = first + p.get('min_hist', 60) + warm_extra
        if len(perp) < warm + 40:
            continue
        r = engine.backtest(perp, basis_dislocation(p)(), c, fund, name='B1',
                            warmup=warm, **kw)
        per[c] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


BASE = {'pct': 0.90, 'win': 180, 'atr_mult': 2.5, 'max_hold': 7, 'min_hist': 60}


def main():
    """Report body. Guarded so that importing this module for `run()` and
    `BASE` does not dump the entire validation report into someone else's
    output - which it did, into every script that reused it."""

    print('=' * 118)
    print('B1 PERP-SPOT BASIS DISLOCATION - full gate')
    print('=' * 118)
    per, m = run(BASE)
    tr, te = pooled.pooled_split(m)
    print('  ' + pooled.describe(m, 'POOLED'))
    print('  ' + pooled.describe(tr, '  train(60%)'))
    print('  ' + pooled.describe(te, '  test(40%)'))
    yr = pooled.pooled_yearly(m)
    print('  by year: {}/{} positive   '.format(sum(1 for _, r in yr if r.expectancy > 0), len(yr)) +
          '  '.join('{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n) for y, r in yr))
    for c in COINS:
        if c in per and per[c].n:
            r = per[c]
            print('  ' + pooled.describe(r, c))
            for side in ('long', 'short'):
                ts = [t for t in r.trades if t.direction == side]
                if ts:
                    print('        {:<6} n={:<3} wr={:>5.1%} exp={:>7.2%}'.format(
                        side, len(ts), sum(1 for t in ts if t.won) / len(ts),
                        sum(t.pnl_pct for t in ts) / len(ts)))

    print('\n' + '=' * 118)
    print('PARAMETER NEIGHBOURHOOD')
    print('=' * 118)
    res = []
    for key, vals in [('pct', [0.80, 0.85, 0.95]), ('win', [90, 120, 250, 360]),
                      ('max_hold', [3, 5, 10, 14]), ('atr_mult', [1.5, 2.0, 3.0, 4.0])]:
        for v in vals:
            p = dict(BASE)
            p[key] = v
            _, mm = run(p)
            if mm.n == 0:
                continue
            t1, t2 = pooled.pooled_split(mm)
            res.append(mm.trimmed_expectancy(0.05))
            print('  {:<14}={:<6} n={:<4} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%} '
                  'train={:>7.2%} test={:>7.2%}'.format(
                      key, v, mm.n, mm.win_rate, mm.expectancy, mm.trimmed_expectancy(0.05),
                      t1.expectancy if t1 else 0, t2.expectancy if t2 else 0))
    print('  -> {}/{} perturbations positive (trimmed)'.format(sum(1 for r in res if r > 0), len(res)))

    print('\n' + '=' * 118)
    print('COST STRESS')
    print('=' * 118)
    for mult in (1, 2, 3, 4):
        _, mm = run(BASE, slippage=engine.SLIPPAGE * mult, fee=engine.TAKER_FEE * mult)
        print('  {}x ({:.2f}% round trip): n={:<4} exp={:>7.2%} trim5={:>7.2%} CAGR={:>6.1%}'.format(
            mult, 2 * (engine.SLIPPAGE + engine.TAKER_FEE) * mult * 100, mm.n,
            mm.expectancy, mm.trimmed_expectancy(0.05), mm.account_cagr(0.20)))

    print('\n' + '=' * 118)
    print('SUB-PERIOD STABILITY - is this one episode, or a persistent effect?')
    print('=' * 118)
    if m.n:
        halves = {}
        for t in m.trades:
            q = datetime.datetime.utcfromtimestamp(t.entry_t / 1000)
            key = '{}H{}'.format(q.year, 1 if q.month <= 6 else 2)
            halves.setdefault(key, []).append(t)
        for k in sorted(halves):
            ts = halves[k]
            e = st.mean([t.pnl_pct for t in ts])
            w = sum(1 for t in ts if t.won) / len(ts)
            print('  {:<8} n={:<4} wr={:>5.1%} exp={:>7.2%}'.format(k, len(ts), w, e))
        pos = sum(1 for k in halves if st.mean([t.pnl_pct for t in halves[k]]) > 0)
        print('  -> {}/{} half-years positive'.format(pos, len(halves)))

    print('\n' + '=' * 118)
    print('OVERLAP with the validated forced-flow strategy (is this a new bet?)')
    print('=' * 118)
    from strategies_batch2 import volume_spike
    for c in COINS:
        perp, fund, basis, first = load(c)
        p = dict(BASE)
        p['basis'] = basis
        warm = first + 60
        s1, _ = pooled.position_series(perp, lambda q: basis_dislocation(q), p, c, fund, warm)
        s2, _ = pooled.position_series(perp, volume_spike,
                                       {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}, c, fund, 60)
        ov, n = pooled.overlap(s1, s2)
        print('  {:<5} same-side on {} co-invested bars: {}'.format(
            c, n, 'n/a' if ov is None else '{:.2f}'.format(ov)))


if __name__ == '__main__':
    main()
