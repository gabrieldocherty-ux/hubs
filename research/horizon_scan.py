"""
Choose macro parameters by HOLDING HORIZON, not by return.

The mandate specifies a 1-2 month holding horizon for the macro family. That is
a design constraint set before any result is seen, so selecting the lookback
that produces a ~30-60 day average hold is a legitimate choice - unlike picking
the lookback with the best expectancy, which is just curve fitting with extra
steps. This prints hold length and expectancy side by side so the selection can
be audited: if I later pick a parameter that is both the horizon match AND the
return maximum, that coincidence should be visible here rather than hidden.
"""
import sys, datetime
sys.path.insert(0, 'research')
import engine, hl_data
from strategies_macro import tsmom, golden_cross, donchian_turtle

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
FUNDING_START = int(datetime.datetime(2023, 6, 8).timestamp() * 1000)


def load(coin):
    bars, _ = hl_data.get_candles(coin, '1d', 2200)
    bars = [b for b in bars if b['t'] >= FUNDING_START]
    return bars, engine.FundingCurve(hl_data.get_funding(coin, 1250))


data = {c: load(c) for c in COINS}

print('M1 TSMOM - average hold (days) and expectancy by lookback')
print('{:<8}'.format('look') + ''.join('{:>22}'.format(c) for c in COINS))
for look in (30, 45, 60, 75, 90, 120, 150, 180):
    row = '{:<8}'.format(look)
    for c in COINS:
        bars, f = data[c]
        r = engine.backtest(bars, tsmom({'look': look, 'atr_mult': 4.0})(), c, f,
                            name='t', warmup=max(130, look + 20))
        row += '{:>10}'.format('{:.0f}d/n{}'.format(r.avg_days_held, r.n)) + \
               '{:>12}'.format('{:+.2f}%'.format(r.expectancy * 100) if r.n else '-')
    print(row)

print('\nM2 GOLDEN CROSS - average hold by (fast,slow)')
print('{:<12}'.format('fast/slow') + ''.join('{:>22}'.format(c) for c in COINS))
for fast, slow in ((20, 100), (30, 120), (50, 200), (25, 150), (40, 160)):
    row = '{:<12}'.format('{}/{}'.format(fast, slow))
    for c in COINS:
        bars, f = data[c]
        if len(bars) < slow + 80:
            row += '{:>22}'.format('insufficient')
            continue
        r = engine.backtest(bars, golden_cross({'fast': fast, 'slow': slow, 'atr_mult': 4.0})(),
                            c, f, name='g', warmup=slow + 10)
        row += '{:>10}'.format('{:.0f}d/n{}'.format(r.avg_days_held, r.n)) + \
               '{:>12}'.format('{:+.2f}%'.format(r.expectancy * 100) if r.n else '-')
    print(row)

print('\nM3 DONCHIAN - average hold by (entry_n, exit_n)')
print('{:<12}'.format('entry/exit') + ''.join('{:>22}'.format(c) for c in COINS))
for en, xn in ((20, 10), (55, 20), (80, 30), (100, 40), (55, 30)):
    row = '{:<12}'.format('{}/{}'.format(en, xn))
    for c in COINS:
        bars, f = data[c]
        r = engine.backtest(bars, donchian_turtle({'entry_n': en, 'exit_n': xn, 'atr_mult': 3.0})(),
                            c, f, name='d', warmup=en + 30)
        row += '{:>10}'.format('{:.0f}d/n{}'.format(r.avg_days_held, r.n)) + \
               '{:>12}'.format('{:+.2f}%'.format(r.expectancy * 100) if r.n else '-')
    print(row)
