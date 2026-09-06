"""
Are the macro "strategies" actually different strategies?

If TSMOM, the MA cross and the Donchian breakout are long the same coin on the
same days, then delivering three of them per coin is delivering one bet three
times and calling it diversification. That would be a worse outcome than
reporting fewer strategies, because it would understate the real risk
concentration. Measured, not assumed.

Also measures the regime decay directly: trend edge by calendar year, pooled.
"""
import sys, datetime
sys.path.insert(0, 'research')
import engine, pooled
from strategies_macro import tsmom, golden_cross, donchian_turtle, vol_target_trend

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
SETS = [
    ('TSMOM(120)', tsmom, {'look': 120, 'atr_mult': 4.0}, 150),
    ('TSMOM(90)', tsmom, {'look': 90, 'atr_mult': 4.0}, 120),
    ('MACross(20/100)', golden_cross, {'fast': 20, 'slow': 100, 'atr_mult': 4.0}, 110),
    ('GoldenX(50/200)', golden_cross, {'fast': 50, 'slow': 200, 'atr_mult': 4.0}, 210),
    ('Donchian(55/20)', donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0}, 85),
    ('Donchian(80/30)', donchian_turtle, {'entry_n': 80, 'exit_n': 30, 'atr_mult': 3.0}, 110),
]

print('POSITION OVERLAP - fraction of co-invested bars on the SAME side')
print('(1.00 = identical trade; ~0.50 = unrelated; measured on the extended daily window)\n')

for coin in COINS:
    bars, fund = pooled.load(coin, extended=True)
    series = {}
    for label, fn, params, warm in SETS:
        if len(bars) < warm + 60:
            continue
        s, _ = pooled.position_series(bars, fn, params, coin, fund, warm)
        series[label] = s
    labels = list(series)
    print(coin)
    print('    ' + ''.join('{:>18}'.format(l[:17]) for l in labels))
    for a in labels:
        row = '{:<18}'.format(a[:17])
        for b in labels:
            ov, n = pooled.overlap(series[a], series[b])
            row += '{:>18}'.format('-' if ov is None else '{:.2f}'.format(ov))
        print('  ' + row)
    print()

print('\nTREND EDGE BY CALENDAR YEAR (pooled across all four coins)')
print('If the edge is stable this row is flat. If it decayed, it will show here.\n')
for label, fn, params, warm in SETS:
    per, merged = pooled.pooled(fn, params, COINS, warm, extended=True, name=label)
    if merged.n == 0:
        continue
    yr = pooled.pooled_yearly(merged)
    print('{:<18}'.format(label) + '  '.join(
        '{}:{:>7}'.format(y, '{:+.1f}%'.format(r.expectancy * 100)) for y, r in yr))
    print('{:<18}'.format('') + '  '.join(
        '{}:{:>7}'.format(y, 'n={}'.format(r.n)) for y, r in yr))
