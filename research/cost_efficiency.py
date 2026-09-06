"""
Which strategies actually earn their keep after execution cost?

"Low return" is ambiguous and the ambiguity matters. Per-trade expectancy is the
wrong ranking on its own: a strategy earning +0.55% per trade 163 times a year
pays the round-trip cost 163 times, while one earning +3.51% twenty-four times a
year pays it 24 times. The metrics that decide it:

  GROSS edge      expectancy before fees/slippage (funding stays in - it is a
                  real cost of holding, not an execution cost)
  COST SHARE      cost / gross edge. How much of the raw edge execution eats.
                  A strategy keeping 40% of its gross edge is fragile: a modest
                  worsening in fills or spreads takes it to zero.
  ANNUAL DRAG     cost x trades per year. What the strategy pays for the right
                  to trade, per year, at full notional.
  NET TRIMMED     the 5% symmetric trimmed mean after all costs. This is the
                  one that decides whether the edge lives in the body of the
                  distribution or only in its tail.

The cut rule applied at the bottom is stated BEFORE the results are read, so it
cannot be tuned to spare a favourite.
"""
import sys
sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout, funding_crowding, capitulation_reversion, vol_squeeze
from strategies_macro import tsmom, donchian_turtle, funding_regime

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
RT_COST = 2 * (engine.TAKER_FEE + engine.SLIPPAGE)          # 0.190% modelled
RT_MEASURED = 2 * (engine.TAKER_FEE + engine.MEASURED_SLIPPAGE)  # ~0.100% live book


def sma_cross(params):
    fast, slow, stop_pct = params['fast'], params['slow'], params['stop_pct']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'f' not in state:
                c = [b['c'] for b in bars]
                state['f'] = engine.sma_series(c, fast)
                state['s'] = engine.sma_series(c, slow)
            f, s = state['f'], state['s']
            if None in (f[i], s[i], f[i - 1], s[i - 1]):
                return None
            px = bars[i]['c']
            if f[i - 1] <= s[i - 1] and f[i] > s[i]:
                return {'dir': 'long', 'stop': px * (1 - stop_pct), 'target': None, 'reason': 'x'}
            if f[i - 1] >= s[i - 1] and f[i] < s[i]:
                return {'dir': 'short', 'stop': px * (1 + stop_pct), 'target': None, 'reason': 'x'}
            return None
        return sig
    return factory


SPECS = [
    ('S3',   'daily', 'Forced-Flow Continuation', volume_spike,
     {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}, 60, '1d', COINS),
    ('D1',   'daily', 'Range-Break Cascade', range_breakout,
     {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}, 60, '1d', COINS),
    ('LIVE', 'macro', 'SMA(20,60) 4h [LIVE NOW]', sma_cross,
     {'fast': 20, 'slow': 60, 'stop_pct': 0.03}, 61, '4h', COINS),
    ('M3',   'macro', 'Donchian 55/20', donchian_turtle,
     {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0}, 85, '1d', COINS),
    ('M1',   'macro', 'TSMOM 120d', tsmom, {'look': 120, 'atr_mult': 4.0}, 150, '1d', COINS),
    ('M5',   'macro', 'Funding-Regime Trend', funding_regime,
     {'fund_n': 14, 'trend_n': 50, 'atr_mult': 4.0, 'funding': None}, 90, '1d', COINS),
    ('D3',   'daily', 'Funding-Crowding Fade', funding_crowding,
     {'fund_n': 3, 'pct': 0.90, 'pct_win': 180, 'atr_mult': 3.0, 'max_hold': 10,
      'funding': None}, 200, '1d', COINS),
    ('D2',   'daily', 'Capitulation Reversion', capitulation_reversion,
     {'z': 2.0, 'vol_n': 60, 'hold': 5, 'atr_mult': 2.5, 'vol_mult': 1.5}, 90, '1d', COINS),
    ('D4',   'daily', 'Volatility Squeeze', vol_squeeze,
     {'vol_n': 20, 'pct': 0.30, 'n': 20, 'atr_mult': 2.5, 'max_hold': 10}, 280, '1d', COINS),
]

rows = []
for sid, family, label, fn, params, warm, interval, coins in SPECS:
    _, m = pooled.pooled(fn, params, coins, warm, interval=interval, name=sid)
    if m.n == 0:
        continue
    rows.append({'id': sid, 'family': family, 'label': label, 'r': m})

_, b1 = run_basis.run(run_basis.BASE)
rows.append({'id': 'B1', 'family': 'daily', 'label': 'Perp-Spot Basis Dislocation', 'r': b1})
rows.sort(key=lambda x: -x['r'].trimmed_expectancy(0.05))

print('=' * 126)
print('COST EFFICIENCY - what each strategy pays to trade, and what it keeps')
print('=' * 126)
print('{:<6}{:<30}{:>6}{:>8}{:>10}{:>9}{:>10}{:>10}{:>11}{:>11}'.format(
    'id', 'strategy', 'n', 'tr/yr', 'GROSS', 'cost', 'share', 'NET exp', 'NET trim5', 'yr drag'))
print('-' * 126)
for row in rows:
    m = row['r']
    net = m.expectancy
    gross = net + RT_COST                      # add back only execution cost
    share = RT_COST / gross if gross > 0 else float('inf')
    drag = RT_COST * m.trades_per_year()
    row.update(gross=gross, share=share, drag=drag, net=net,
               trim=m.trimmed_expectancy(0.05))
    print('{:<6}{:<30}{:>6}{:>8.0f}{:>10}{:>9}{:>10}{:>10}{:>11}{:>11}'.format(
        row['id'], row['label'][:29], m.n, m.trades_per_year(),
        '{:+.2f}%'.format(gross * 100), '{:.3f}%'.format(RT_COST * 100),
        ('{:.0f}%'.format(share * 100) if share != float('inf') else 'ALL'),
        '{:+.2f}%'.format(net * 100), '{:+.2f}%'.format(row['trim'] * 100),
        '{:.1f}%'.format(drag * 100)))

print("""
  GROSS   = expectancy with execution cost added back (funding left in - it is a
            holding cost, not something better execution avoids)
  share   = what fraction of the gross edge execution consumes
  yr drag = cost x trades/year: the annual toll at full notional
  NET trim5 = the 5% symmetric trimmed mean, i.e. the edge in the body of the
            distribution rather than its tail. This is the decisive column.""")

print('\n' + '=' * 126)
print('CUT RULE (stated before reading the table, so it cannot be tuned to spare a favourite)')
print('=' * 126)
print("""  CUT if ANY of:
    (a) net trimmed expectancy <= 0        - no edge outside the tail
    (b) cost share > 40% of gross edge     - too little headroom; a modest
                                             worsening in fills kills it
    (c) net expectancy < 2x round-trip cost (0.38%) - the edge is not large
                                             enough relative to what it pays
  KEEP otherwise. Correlation is handled separately: a KEEP that duplicates
  another KEEP is a sizing decision, not a cut.""")

keep, cut = [], []
for row in rows:
    reasons = []
    if row['trim'] <= 0:
        reasons.append('trimmed expectancy {:+.2f}% <= 0'.format(row['trim'] * 100))
    if row['share'] > 0.40:
        reasons.append('cost eats {:.0f}% of gross edge'.format(row['share'] * 100))
    if row['net'] < 2 * RT_COST:
        reasons.append('net {:+.2f}% < 2x cost ({:.2f}%)'.format(
            row['net'] * 100, 2 * RT_COST * 100))
    (cut if reasons else keep).append((row, reasons))

print('\n  KEEP ({}):'.format(len(keep)))
for row, _ in keep:
    print('    {:<6}{:<32} net {:+.2f}%/trade, trimmed {:+.2f}%, cost share {:.0f}%'.format(
        row['id'], row['label'][:31], row['net'] * 100, row['trim'] * 100, row['share'] * 100))
print('\n  CUT ({}):'.format(len(cut)))
for row, reasons in cut:
    print('    {:<6}{:<32} {}'.format(row['id'], row['label'][:31], '; '.join(reasons)))

print('\n' + '=' * 126)
print('SENSITIVITY: does the verdict change at the MEASURED live-book cost (0.100%)?')
print('=' * 126)
print('  If a strategy only survives at the lower cost figure, that is worth knowing -')
print('  it means the verdict rests on an execution assumption rather than on edge.')
print('  {:<6}{:<30}{:>14}{:>14}{:>16}'.format('id', 'strategy', 'net @0.190%', 'net @0.100%', 'verdict change'))
for sid, family, label, fn, params, warm, interval, coins in SPECS:
    _, mm = pooled.pooled(fn, params, coins, warm, interval=interval, name=sid,
                          fee=engine.TAKER_FEE, slippage=engine.MEASURED_SLIPPAGE)
    if mm.n == 0:
        continue
    base = next((r for r in rows if r['id'] == sid), None)
    if base is None:
        continue
    was_cut = any(r['id'] == sid for r, _ in cut)
    now_ok = (mm.trimmed_expectancy(0.05) > 0 and mm.expectancy >= 2 * RT_MEASURED
              and RT_MEASURED / (mm.expectancy + RT_MEASURED) <= 0.40)
    change = 'CUT -> keep' if (was_cut and now_ok) else ('unchanged' if was_cut == (not now_ok)
                                                        else 'keep -> CUT')
    print('  {:<6}{:<30}{:>14}{:>14}{:>16}'.format(
        sid, label[:29], '{:+.2f}%'.format(base['net'] * 100),
        '{:+.2f}%'.format(mm.expectancy * 100), change))
