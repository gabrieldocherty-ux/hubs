"""
Does the stop-loss actually fire before the exchange liquidates the position?

This has never been checked, and if the answer is no then the mandatory
stop-loss - the project's first and most-repeated safety rail - is decorative,
and the real risk control is Hyperliquid's liquidation engine. Those are very
different outcomes: a stop exits at a price you chose, a liquidation takes the
whole margin plus a penalty and does it at whatever the book offers.

How leverage gets set today (core/risk_manager.py):

    stop_distance_pct = |entry - stop| / entry
    implied_leverage  = round(1 / stop_distance_pct)
    leverage          = min(implied_leverage, max_leverage)     # cap 10x

So the code deliberately sets leverage as the reciprocal of the stop distance.
That means it is TARGETING the situation where hitting the stop costs about one
unit of margin - i.e. the stop and the liquidation price are engineered to sit
close together. Whether that is safe depends entirely on which one is nearer,
and by how much, on real volatility.

Rough liquidation distance for a cross-margin perp is 1/leverage minus the
maintenance margin. Hyperliquid's maintenance margin is half the initial at max
leverage, so for an L-times position liquidation sits near (1/L) x (1 - 0.5) ...
this script uses the conservative and simpler 1/L, then also shows a version
with a maintenance buffer, because the exact formula matters less than whether
the two distances are close at all.
"""
import sys, statistics as st
sys.path.insert(0, 'research')
import engine, pooled

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
MAX_LEV = 10
STOP_ATR = 2.5          # what S3/D1/B1 use
CAPITAL = 250.0
POS = 16.25

print('=' * 116)
print('1. HOW WIDE IS A 2.5x ATR STOP, REALLY?')
print('=' * 116)
print('{:<8}{:>14}{:>14}{:>14}{:>14}{:>16}'.format(
    'coin', 'median stop%', 'p90 stop%', 'p99 stop%', 'widest', 'implied lev @med'))
stats = {}
for c in COINS:
    bars, _ = pooled.load(c)
    atr = engine.atr_series(bars, 14)
    d = [STOP_ATR * atr[i] / bars[i]['c'] for i in range(len(bars))
         if atr[i] and bars[i]['c']]
    d.sort()
    med = st.median(d)
    stats[c] = d
    print('{:<8}{:>14}{:>14}{:>14}{:>14}{:>16}'.format(
        c, '{:.2%}'.format(med), '{:.2%}'.format(d[int(len(d) * .90)]),
        '{:.2%}'.format(d[int(len(d) * .99)]), '{:.2%}'.format(d[-1]),
        '{:.1f}x'.format(1 / med)))

print("""
  'implied lev' is what risk_manager would compute from that stop distance
  (1 / stop_distance), before the 10x cap. Where it exceeds 10, the cap binds
  and leverage is held at 10 - which is the safe direction.""")

print('\n' + '=' * 116)
print('2. THE COMPARISON THAT MATTERS: stop distance vs liquidation distance')
print('=' * 116)
print('  At leverage L, the position is liquidated roughly 1/L away (a touch')
print('  sooner with maintenance margin). The stop must be NEARER than that.')
print()
print('{:<8}{:>12}{:>16}{:>18}{:>18}{:>16}'.format(
    'coin', 'lev used', 'stop dist (med)', 'liq dist @lev', 'stop < liq?', 'margin of safety'))
for c in COINS:
    d = stats[c]
    med = st.median(d)
    implied = 1 / med
    lev = min(MAX_LEV, max(1, round(implied)))
    liq = 1 / lev
    liq_maint = liq * 0.5      # conservative: maintenance margin halves the distance
    safe = med < liq_maint
    print('{:<8}{:>12}{:>16}{:>18}{:>18}{:>16}'.format(
        c, '{}x'.format(lev), '{:.2%}'.format(med),
        '{:.2%} (maint {:.2%})'.format(liq, liq_maint),
        'YES' if safe else 'NO - LIQUIDATES FIRST',
        '{:+.2%}'.format(liq_maint - med)))

print('\n' + '=' * 116)
print('3. HOW OFTEN WOULD THE STOP SIT BEYOND LIQUIDATION?')
print('  (per bar, using that bar\'s actual ATR rather than the median)')
print('=' * 116)
print('{:<8}{:>16}{:>20}{:>20}'.format('coin', 'bars checked', 'stop beyond liq', 'share of bars'))
for c in COINS:
    bars, _ = pooled.load(c)
    atr = engine.atr_series(bars, 14)
    bad = tot = 0
    for i in range(len(bars)):
        if not atr[i] or not bars[i]['c']:
            continue
        sd = STOP_ATR * atr[i] / bars[i]['c']
        lev = min(MAX_LEV, max(1, round(1 / sd)))
        if sd > (1 / lev) * 0.5:
            bad += 1
        tot += 1
    print('{:<8}{:>16}{:>20}{:>20}'.format(c, tot, bad, '{:.1%}'.format(bad / tot if tot else 0)))

print('\n' + '=' * 116)
print('4. WHAT LEVERAGE WOULD ACTUALLY BE SAFE?')
print('  The stop should sit comfortably inside liquidation - a 2x buffer means')
print('  liquidation is twice as far away as the stop, so a gap through the stop')
print('  still exits at a chosen-ish price rather than being force-closed.')
print('=' * 116)
print('{:<8}{:>18}{:>22}{:>22}'.format(
    'coin', 'p99 stop dist', 'max safe lev (2x buf)', 'margin at $16.25 pos'))
for c in COINS:
    d = stats[c]
    p99 = d[int(len(d) * .99)]
    # want liq_maint = 0.5/L >= 2 * stop  ->  L <= 0.25 / stop
    safe_lev = max(1, int(0.25 / p99))
    print('{:<8}{:>18}{:>22}{:>22}'.format(
        c, '{:.2%}'.format(p99), '{}x'.format(safe_lev),
        '${:.2f}'.format(POS / safe_lev)))

print("""
  Note what leverage does and does NOT do here. P&L is computed on NOTIONAL
  ($16.25 a position), so leverage does not change how much a move earns or
  loses - it only changes how much margin is posted and therefore how far away
  the forced-liquidation price sits. Lower leverage on the same notional is
  strictly safer and costs nothing in return. The only thing it consumes is
  free collateral, which on a $250 account holding a handful of positions is
  not the binding constraint.""")
