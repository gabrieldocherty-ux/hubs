"""
Where should the stop actually sit? Maximum Adverse Excursion analysis.

The stop is currently 2.5x ATR because that seemed reasonable. Nothing has ever
asked what the data says. The right question is not "which stop backtests best"
- that is circular, because the stop determines the outcome it is being fitted
to, and it is one of the most reliable ways to overfit a system. The right
question is a property of the MARKET rather than of the stop:

    For a trade that eventually WORKS, how far does it go against you first?

That is Maximum Adverse Excursion (MAE). If winners rarely dip more than 1.5x
ATR against entry, a 2.5x stop is too wide and every loser costs more than it
needs to. If winners routinely dip 3x, a 2.5x stop is cutting the trades that
would have paid.

METHOD, and the part that matters: MAE has to be measured with the stop
effectively REMOVED. A trade that was stopped out never reveals where it would
have gone, so measuring excursion on stopped trades only tells you about the
stop. So every strategy is re-run with a 12x ATR stop - wide enough that almost
nothing hits it - and the full adverse path of every trade is recorded, along
with what the trade eventually did.

Then the trade-off at each candidate stop distance is direct arithmetic rather
than a fit:
    - winners cut     : trades that ended positive but dipped past that level
    - losers truncated: trades that ended negative and dipped past it (a saving)
    - net effect      : what moving the stop there would have done to total P&L
"""
import sys, statistics as st
sys.path.insert(0, 'research')
import engine, pooled

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
WIDE = 12.0          # effectively "no stop", so the true path is observable
HOLD = 10


def wide_stop_strategy(params):
    """S3's entry with a deliberately huge stop, so trades run their course."""
    vol_mult = params['vol_mult']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
                state['vma'] = engine.sma_series([b['v'] for b in bars], 20)
            atr = state['atr'][i]
            if atr is None or atr <= 0:
                return None
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= HOLD else None
            vma, b = state['vma'][i], bars[i]
            if not vma or vma <= 0 or b['v'] < vol_mult * vma:
                return None
            want = 'long' if b['c'] > b['o'] else ('short' if b['c'] < b['o'] else None)
            if want is None:
                return None
            px = b['c']
            stop = px - WIDE * atr if want == 'long' else px + WIDE * atr
            return {'dir': want, 'stop': stop, 'target': None, 'reason': 'x'}
        return sig
    return factory


def collect():
    """For every trade: MAE in ATR units, final gross return, and context."""
    rows = []
    for c in COINS:
        bars, fund = pooled.load(c)
        atr = engine.atr_series(bars, 14)
        idx = {b['t']: i for i, b in enumerate(bars)}
        r = engine.backtest(bars, wide_stop_strategy({'vol_mult': 1.5})(), c, fund,
                            name='mae', warmup=60)
        for t in r.trades:
            i0, i1 = idx.get(t.entry_t), idx.get(t.exit_t)
            if i0 is None or i1 is None or not atr[i0]:
                continue
            a = atr[i0]
            worst = 0.0
            for j in range(i0, min(i1 + 1, len(bars))):
                if t.direction == 'long':
                    adverse = (t.entry_price - bars[j]['l']) / a
                else:
                    adverse = (bars[j]['h'] - t.entry_price) / a
                worst = max(worst, adverse)
            sb = bars[i0 - 1] if i0 > 0 else bars[i0]
            strength = (sb['h'] - sb['l']) / atr[i0 - 1] if i0 > 0 and atr[i0 - 1] else None
            rows.append({'coin': c, 'mae_atr': worst, 'pnl': t.pnl_pct,
                         'won': t.pnl_pct > 0, 'strength': strength,
                         'atr_pct': a / t.entry_price})
    return rows


ROWS = collect()
W = [r for r in ROWS if r['won']]
L = [r for r in ROWS if not r['won']]

print('=' * 112)
print('1. HOW FAR DOES A TRADE GO AGAINST YOU BEFORE IT WORKS?')
print('   ({} trades, run with a {}x ATR stop so the true path is visible)'.format(len(ROWS), WIDE))
print('=' * 112)
print('  {:<24}{:>10}{:>12}{:>12}{:>12}{:>12}'.format(
    'group', 'n', 'median MAE', 'p75', 'p90', 'p95'))
for label, grp in (('eventual WINNERS', W), ('eventual LOSERS', L), ('all trades', ROWS)):
    m = sorted(r['mae_atr'] for r in grp)
    if not m:
        continue
    print('  {:<24}{:>10}{:>12}{:>12}{:>12}{:>12}'.format(
        label, len(m), '{:.2f}x'.format(st.median(m)),
        '{:.2f}x'.format(m[int(len(m) * .75)]), '{:.2f}x'.format(m[int(len(m) * .90)]),
        '{:.2f}x'.format(m[int(len(m) * .95)])))
print("""
  The gap between the two rows is the whole signal. If winners dip far less than
  losers, a stop can separate them. If both dip about the same, no stop distance
  can tell them apart and the stop is purely a loss cap, not a filter.""")

print('\n' + '=' * 112)
print('2. WHAT MOVING THE STOP WOULD ACTUALLY DO')
print('   For each candidate distance: which trades it catches, and the net P&L effect')
print('=' * 112)
print('  {:<12}{:>12}{:>16}{:>16}{:>14}{:>14}'.format(
    'stop (xATR)', 'trades hit', 'winners cut', 'losers caught', 'net P&L chg', 'new total'))
base_total = sum(r['pnl'] for r in ROWS)
for stop in (1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 8.0):
    win_cut = los_cut = 0
    delta = 0.0
    for r in ROWS:
        if r['mae_atr'] <= stop:
            continue                       # trade never reaches the stop; unchanged
        # trade would have been stopped: outcome becomes roughly -stop*atr%
        stopped_pnl = -stop * r['atr_pct'] - 2 * (engine.TAKER_FEE + engine.SLIPPAGE)
        delta += stopped_pnl - r['pnl']
        if r['won']:
            win_cut += 1
        else:
            los_cut += 1
    hit = win_cut + los_cut
    print('  {:<12}{:>12}{:>16}{:>16}{:>14}{:>14}'.format(
        '{:.1f}x'.format(stop), hit, win_cut, los_cut,
        '{:+.1f}%'.format(delta * 100), '{:+.1f}%'.format((base_total + delta) * 100)))
print("""
  'net P&L chg' is what tightening the stop to that level would have done in
  total, summed across every trade, in percentage points. Positive means the
  losers it caught outweighed the winners it cut.""")

print('\n' + '=' * 112)
print('3. IS THE ADVERSE EXCURSION PREDICTABLE FROM ANYTHING OBSERVABLE?')
print('   (this is what would justify a CONDITIONAL stop rather than a fixed one)')
print('=' * 112)
by_strength = {'weak <1.5x': [], 'mid 1.5-2.5x': [], 'strong >=2.5x': []}
for r in ROWS:
    s = r['strength']
    if s is None:
        continue
    k = 'weak <1.5x' if s < 1.5 else ('mid 1.5-2.5x' if s < 2.5 else 'strong >=2.5x')
    by_strength[k].append(r)
print('  {:<18}{:>8}{:>14}{:>14}{:>14}{:>12}'.format(
    'signal strength', 'n', 'median MAE', 'p90 MAE', 'win rate', 'mean pnl'))
for k, grp in by_strength.items():
    if len(grp) < 10:
        continue
    m = sorted(r['mae_atr'] for r in grp)
    print('  {:<18}{:>8}{:>14}{:>14}{:>14}{:>12}'.format(
        k, len(grp), '{:.2f}x'.format(st.median(m)),
        '{:.2f}x'.format(m[int(len(m) * .90)]),
        '{:.0%}'.format(sum(1 for r in grp if r['won']) / len(grp)),
        '{:+.2f}%'.format(st.mean([r['pnl'] for r in grp]) * 100)))

print()
print('  {:<18}{:>8}{:>14}{:>14}{:>14}'.format('coin', 'n', 'median MAE', 'p90 MAE', 'win rate'))
for c in COINS:
    grp = [r for r in ROWS if r['coin'] == c]
    if len(grp) < 10:
        continue
    m = sorted(r['mae_atr'] for r in grp)
    print('  {:<18}{:>8}{:>14}{:>14}{:>14}'.format(
        c, len(grp), '{:.2f}x'.format(st.median(m)),
        '{:.2f}x'.format(m[int(len(m) * .90)]),
        '{:.0%}'.format(sum(1 for r in grp if r['won']) / len(grp))))
print("""
  A conditional stop is only justified if MAE differs MATERIALLY between groups.
  If every group dips about the same in ATR units, then ATR already normalises
  it and a single multiple is the right answer - which would be a real finding,
  because it means the current design is correct rather than merely untested.""")
