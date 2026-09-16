"""
CANDIDATE 3: volatility-managed exposure. Plus the portfolio that combines
whatever actually survived.

Turn-of-month was tested first and REJECTED - across 72 cells (6 instruments x 12
windows) exactly one cleared DSR 0.95, alpha t-statistics clustered around zero,
ZEB was outright negative and HXT returned a PBO of 85.7%. Its returns tracked its
exposure: hold the market 24% of the time, earn roughly 24% of the market. That is
not a strategy, it is a smaller position, and no amount of window-tuning changes
it. Rather than force a third sleeve out of it, a different mechanism gets tested.

THE MECHANISM HERE IS DIFFERENT IN KIND. Trend and overnight both try to forecast
RETURNS. This forecasts VOLATILITY, which is a far easier problem: volatility is
strongly autocorrelated - a turbulent month is followed by a turbulent month -
while returns are close to unforecastable. Moreira & Muir (2017, Journal of
Finance) show that scaling exposure by inverse realised variance raises Sharpe
across equity factors, because the scaling reduces risk MORE than it reduces
return. You end up small in exactly the periods that produce the deepest
drawdowns, and those periods announce themselves in advance.

AN HONEST PRIOR AGAINST IT. This project TESTED volatility targeting on
Hyperliquid perps and it FAILED. That is a real strike and it is recorded here
rather than buried. Two reasons it may still work on equity indices: crypto
volatility is both higher and less persistent, and the crypto test scaled
positions in a long/short book where the stop already adapted to volatility via
ATR. Neither applies to a long/flat equity sleeve. But the prior is negative, so
the bar is the same as for everything else - deflated Sharpe, PBO across the whole
grid, and alpha against simply owning the thing.
"""
import math
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng

CORE = ['VFV.TO', 'XIU.TO', 'ZQQ.TO', 'XIC.TO', 'HXT.TO']


def load(sym):
    bars = tsx_data.get(sym)
    return {'bars': bars, 'ret': eng.total_returns(bars), 'dates': eng.dates(bars),
            'rt': tsx_data.cost_model(sym, bars)[0]}


def volmanaged_weights(rets, lookback, target_vol, cap=1.0):
    """Weight = target_vol / realised_vol, capped at `cap` because there is no
    leverage available in this account - which is itself a material constraint,
    since the published version of this strategy relies on levering UP in calm
    periods and here we can only scale DOWN.

    The volatility used for period i is measured through period i-1. Using period
    i's own volatility to size period i is a textbook lookahead and would make any
    vol-scaling rule look brilliant.
    """
    vol = eng.rolling_vol(rets, lookback)
    w = []
    for i in range(len(rets)):
        v = vol[i - 1] if i > 0 else None
        if v is None or v <= 0:
            w.append(0.0)
        else:
            w.append(min(cap, (target_vol / math.sqrt(252)) / v))
    return w


print('=' * 120)
print('CANDIDATE 3: VOLATILITY-MANAGED EXPOSURE  (long/flat, no leverage available)')
print('=' * 120)
GRID = [(lb, tv) for lb in (20, 40, 60) for tv in (0.10, 0.12, 0.15, 0.20)]
print('  Grid: {} configurations (the DSR trial count)'.format(len(GRID)))

survivors = {}
for sym in CORE:
    d = load(sym)
    bh = d['ret']
    print('\n  {}   buy & hold: {:+.2%} CAGR, Sharpe {:.2f}, maxDD {:.1%}'.format(
        sym, inst.cagr(bh), inst.sharpe(bh), inst.max_drawdown(bh)))
    print('  {:<18}{:>10}{:>9}{:>9}{:>9}{:>10}{:>9}{:>10}'.format(
        'config', 'CAGR', 'Sharpe', 'maxDD', 'expo', 'trades/yr', 'DSR', 'alpha t'))
    cfgs = {}
    for lb, tv in GRID:
        w = volmanaged_weights(bh, lb, tv)
        r = eng.run(w, bh, d['rt'])
        cfgs['{}_{}'.format(lb, tv)] = r
        dsr, _, _ = inst.deflated_sharpe(r, len(GRID))
        a = inst.attribution(r, bh)
        print('  {:<18}{:>10}{:>9}{:>9}{:>9}{:>10}{:>9}{:>10}'.format(
            'vol{} tgt{:.0%}'.format(lb, tv), '{:+.2%}'.format(inst.cagr(r)),
            '{:.2f}'.format(inst.sharpe(r)), '{:.1%}'.format(inst.max_drawdown(r)),
            '{:.0%}'.format(st.mean(w)), '{:.1f}'.format(eng.turnover_per_year(w) / 2),
            '{:.3f}'.format(dsr), '{:.2f}'.format(a['t_alpha']) if a else '-'))
    p = inst.pbo(cfgs)
    print('  PBO across the {} configs: {}'.format(
        len(cfgs), '{:.1%}'.format(p) if p is not None else 'n/a'))
    survivors[sym] = (d, cfgs)

print("""
  THE KEY COLUMN IS 'alpha t', NOT CAGR. A long/flat strategy that holds ~60% of
  the time in a rising market will show a positive CAGR and a respectable Sharpe
  while adding nothing whatsoever - it is simply a smaller position in the index.
  Alpha measured against the index itself is what separates the two, and a
  t-statistic under about 2 means the strategy has not demonstrably beaten just
  owning less of the thing.""")
