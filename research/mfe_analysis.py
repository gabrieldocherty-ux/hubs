"""
When should a position be LEFT? Maximum Favourable Excursion analysis.

MAE analysis answered where the stop belongs by asking how far a trade goes
against you before it works. MFE is its mirror and answers the other half: how
far does a trade go IN YOUR FAVOUR before it closes, and how much of that peak
is handed back by holding to the timeout?

Three exit questions this can settle, none of which have been asked here:

  1. ARE EXITS CUTTING WINNERS SHORT? If trades routinely close near their peak,
     the timeout is well placed. If they close far below it, the exit is late
     and profit is being given back.
  2. WOULD A PROFIT TARGET HELP? Every strategy here exits on a timeout or a
     stop; none has ever had a target. The MFE distribution says where one
     would sit - the standard construction is the 25th/50th/75th percentile of
     historical MFE for the setup.
  3. IS THERE A GIVE-BACK PROBLEM? Trades that reach a high MFE and still end
     negative are the specific failure a target or trailing exit fixes. Counting
     them says whether that failure actually exists here or is hypothetical.

METHOD: as with MAE, the stop is widened to 12x ATR so trades run their course
and the true favourable path is observable. Excursion is measured in ATR units
so it is comparable across coins and volatility regimes.
"""
import sys, statistics as st
sys.path.insert(0, 'research')
import engine, pooled

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
WIDE = 12.0
RT = 2 * (engine.TAKER_FEE + engine.SLIPPAGE)


def strat(params):
    """S3 entry, huge stop, settable hold - so the full path is visible."""
    vol_mult, hold = params['vol_mult'], params['hold']

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
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
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


def collect(hold=10):
    rows = []
    for c in COINS:
        bars, fund = pooled.load(c)
        atr = engine.atr_series(bars, 14)
        idx = {b['t']: i for i, b in enumerate(bars)}
        r = engine.backtest(bars, strat({'vol_mult': 1.5, 'hold': hold})(), c, fund,
                            name='mfe', warmup=60)
        for t in r.trades:
            i0, i1 = idx.get(t.entry_t), idx.get(t.exit_t)
            if i0 is None or i1 is None or not atr[i0]:
                continue
            a = atr[i0]
            best = worst = 0.0
            best_day = 0
            for j in range(i0, min(i1 + 1, len(bars))):
                if t.direction == 'long':
                    fav = (bars[j]['h'] - t.entry_price) / a
                    adv = (t.entry_price - bars[j]['l']) / a
                else:
                    fav = (t.entry_price - bars[j]['l']) / a
                    adv = (bars[j]['h'] - t.entry_price) / a
                if fav > best:
                    best, best_day = fav, j - i0
                worst = max(worst, adv)
            exit_atr = (t.gross_pct * t.entry_price) / a
            rows.append({'coin': c, 'mfe': best, 'mae': worst, 'exit_atr': exit_atr,
                         'peak_day': best_day, 'pnl': t.pnl_pct, 'won': t.pnl_pct > 0,
                         'atr_pct': a / t.entry_price})
    return rows


ROWS = collect(10)
W = [r for r in ROWS if r['won']]
L = [r for r in ROWS if not r['won']]

print('=' * 112)
print('1. HOW FAR DO TRADES RUN IN YOUR FAVOUR? ({} trades)'.format(len(ROWS)))
print('=' * 112)
print('  {:<22}{:>9}{:>12}{:>12}{:>12}{:>12}'.format(
    'group', 'n', 'median MFE', 'p25', 'p75', 'p90'))
for label, grp in (('eventual WINNERS', W), ('eventual LOSERS', L), ('all', ROWS)):
    m = sorted(r['mfe'] for r in grp)
    if not m:
        continue
    print('  {:<22}{:>9}{:>12}{:>12}{:>12}{:>12}'.format(
        label, len(m), '{:.2f}x'.format(st.median(m)),
        '{:.2f}x'.format(m[int(len(m) * .25)]), '{:.2f}x'.format(m[int(len(m) * .75)]),
        '{:.2f}x'.format(m[int(len(m) * .90)])))

print('\n' + '=' * 112)
print('2. HOW MUCH OF THE PEAK IS GIVEN BACK?')
print('=' * 112)
cap = [r for r in ROWS if r['mfe'] > 0.1]
give = [(r['mfe'] - r['exit_atr']) / r['mfe'] for r in cap if r['mfe'] > 0]
print('  median share of the peak handed back by holding to the timeout: {:.0%}'.format(
    st.median(give)))
print('  mean: {:.0%}'.format(st.mean(give)))
print('  trades exiting within 25% of their peak: {:.0%}'.format(
    sum(1 for g in give if g <= 0.25) / len(give)))
print('  trades handing back MORE THAN HALF the peak: {:.0%}'.format(
    sum(1 for g in give if g > 0.50) / len(give)))
reversed_ = [r for r in ROWS if r['mfe'] >= 1.0 and not r['won']]
print('\n  trades that reached +1.0x ATR in profit and STILL ended negative: {} of {} ({:.0%})'.format(
    len(reversed_), len(ROWS), len(reversed_) / len(ROWS)))
print('  ...of {} trades that ever reached +1.0x: {:.0%} of them'.format(
    sum(1 for r in ROWS if r['mfe'] >= 1.0),
    len(reversed_) / max(1, sum(1 for r in ROWS if r['mfe'] >= 1.0))))
print("""
  This is the give-back problem, quantified. A large share means the exit is
  systematically late and a profit target or trailing rule would recover it. A
  small share means the timeout is already close to the peak and a target would
  mostly just cap winners.""")

print('\n' + '=' * 112)
print('3. WHEN DOES THE PEAK ACTUALLY HAPPEN?')
print('=' * 112)
days = {}
for r in ROWS:
    days.setdefault(r['peak_day'], []).append(r)
print('  {:<12}{:>10}{:>14}{:>16}'.format('peak on day', 'n', 'share', 'median MFE'))
for d in sorted(days):
    g = days[d]
    if len(g) < 5:
        continue
    print('  {:<12}{:>10}{:>14}{:>16}'.format(
        d, len(g), '{:.0%}'.format(len(g) / len(ROWS)),
        '{:.2f}x'.format(st.median([r['mfe'] for r in g]))))

print('\n' + '=' * 112)
print('4. WOULD A PROFIT TARGET HAVE HELPED?')
print('   Standard construction: place the target at a percentile of historical MFE.')
print('   Simulated on the real paths - a target only fires if MFE reached it.')
print('=' * 112)
base_total = sum(r['pnl'] for r in ROWS)
print('  {:<20}{:>12}{:>16}{:>16}{:>16}'.format(
    'target', 'trades hit', 'winners capped', 'net P&L change', 'new total'))
for tgt in (0.5, 1.0, 1.5, 2.0, 3.0, 4.0):
    delta = 0.0
    hit = capped = 0
    for r in ROWS:
        if r['mfe'] < tgt:
            continue                      # never reached the target; unchanged
        hit += 1
        target_pnl = tgt * r['atr_pct'] - RT
        if target_pnl < r['pnl']:
            capped += 1
        delta += target_pnl - r['pnl']
    print('  {:<20}{:>12}{:>16}{:>16}{:>16}'.format(
        '{:.1f}x ATR'.format(tgt), hit, capped,
        '{:+.1f}%'.format(delta * 100), '{:+.1f}%'.format((base_total + delta) * 100)))
print("""
  'winners capped' counts trades that would have gone on to make MORE than the
  target. A target is only worth having if the give-back it prevents outweighs
  the upside it cuts - and with a positive-skew strategy that is a high bar,
  because the few very large winners are where the edge lives.""")

print('\n' + '=' * 112)
print('5. THE MFE/MAE RATIO - is the setup even worth taking?')
print('=' * 112)
print('  {:<22}{:>12}{:>12}{:>14}'.format('group', 'median MFE', 'median MAE', 'MFE/MAE'))
for label, grp in (('winners', W), ('losers', L), ('all', ROWS)):
    mf = st.median([r['mfe'] for r in grp])
    ma = st.median([r['mae'] for r in grp])
    print('  {:<22}{:>12}{:>12}{:>14}'.format(
        label, '{:.2f}x'.format(mf), '{:.2f}x'.format(ma),
        '{:.2f}'.format(mf / ma) if ma else '-'))
print("""
  Across all trades this is the reward-to-risk the setup actually offers before
  any exit rule is applied. Below 1.0 means the average trade goes further
  against you than for you, and no exit rule fixes a setup like that.""")
