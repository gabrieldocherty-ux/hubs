"""
Would a ~36 hour hold beat the current 4-10 day holds?

The intuition behind it is sound and worth stating properly: less time in the
market is less exposure, and faster capital turnover compounds more often. Both
are real. This tests whether they win here.

36 hours on daily bars is 1-2 bars, so hold=1 and hold=2 are both tested, along
with everything up to the shipped setting, for all three daily strategies.

Two forces pull against the intuition, and the test is really about which is
bigger:

  ACCRUAL SHAPE. The exit-anatomy work found the edge is BACK-loaded - S3's
  average cumulative return runs +0.33% at day 1, +1.23% at day 2, +5.15% by
  day 10, with win rate climbing 50% -> 66%. Cutting at 36 hours takes the
  worst part of that curve.

  COST PER TRADE. The 0.190% round trip is paid per TRADE, not per day. A
  10-day hold pays it about 36 times a year per coin; a 1.5-day hold could pay
  it 240 times. That is the difference between roughly 7% and 45% of notional
  a year in friction, and it comes straight off the top.
"""
import sys
sys.path.insert(0, 'research')
import engine, pooled

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
RT = 2 * (engine.TAKER_FEE + engine.SLIPPAGE)


def flex_hold(params):
    """S3 / D1 entry with a settable hold, so hold length is the only variable."""
    kind = params['kind']
    hold = params['hold']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
                state['vma'] = engine.sma_series([b['v'] for b in bars], 20)
                state['hh'] = engine.rolling_max([b['h'] for b in bars], 20)
                state['ll'] = engine.rolling_min([b['l'] for b in bars], 20)
            atr = state['atr'][i]
            if atr is None or atr <= 0 or i < 1:
                return None
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            b = bars[i]
            px = b['c']
            if kind == 'S3':
                vma = state['vma'][i]
                if not vma or vma <= 0 or b['v'] < 1.5 * vma:
                    return None
                want = 'long' if b['c'] > b['o'] else ('short' if b['c'] < b['o'] else None)
            else:
                if (b['h'] - b['l']) < 2.0 * atr:
                    return None
                hh, ll = state['hh'][i - 1], state['ll'][i - 1]
                if hh is None or ll is None:
                    return None
                want = 'long' if px > hh else ('short' if px < ll else None)
            if want is None:
                return None
            stop = px - 2.5 * atr if want == 'long' else px + 2.5 * atr
            return {'dir': want, 'stop': stop, 'target': None, 'reason': 'x'}
        return sig
    return factory


def row(label, params):
    _, m = pooled.pooled(flex_hold, params, COINS, 60, name=label)
    if not m.n:
        print('  {:<26} NO TRADES'.format(label))
        return
    tr, te = pooled.pooled_split(m)
    gross = m.expectancy + RT
    print('  {:<26}{:>7}{:>11}{:>11}{:>11}{:>11}{:>11}{:>12}{:>11}'.format(
        label, m.n, '{:.0f}'.format(m.trades_per_year()),
        '{:+.2f}%'.format(gross * 100), '{:+.2f}%'.format(m.expectancy * 100),
        '{:+.2f}%'.format(m.trimmed_expectancy(0.05) * 100),
        '{:.0%}'.format(m.win_rate),
        '{:.1f}%'.format(RT * m.trades_per_year() * 100),
        '{:+.1f}%'.format(m.account_cagr(0.20) * 100)))


for kind, shipped in (('S3', 10), ('D1', 10)):
    print('\n' + '=' * 126)
    print('{} - hold length swept from 36 hours upward'.format(kind))
    print('=' * 126)
    print('  {:<26}{:>7}{:>11}{:>11}{:>11}{:>11}{:>11}{:>12}{:>11}'.format(
        'hold', 'n', 'trades/yr', 'GROSS', 'net exp', 'trim5', 'win rate',
        'cost/yr', 'acct CAGR'))
    for h in (1, 2, 3, 4, 5, 7, 10, 14):
        row('{} bar{}{}'.format(h, '' if h == 1 else 's',
                                '  <- 36h' if h in (1, 2) else
                                '  <- shipped' if h == shipped else ''),
            {'kind': kind, 'hold': h})

print('\n' + '=' * 126)
print('B1 BASIS - already the shortest holder at 4.2 days average')
print('=' * 126)
import run_basis
print('  {:<26}{:>7}{:>11}{:>11}{:>11}{:>11}{:>12}'.format(
    'max_hold', 'n', 'trades/yr', 'net exp', 'trim5', 'win rate', 'cost/yr'))
for h in (1, 2, 3, 5, 7, 10):
    p = dict(run_basis.BASE)
    p['max_hold'] = h
    _, m = run_basis.run(p)
    if not m.n:
        continue
    print('  {:<26}{:>7}{:>11}{:>11}{:>11}{:>11}{:>12}'.format(
        '{} bar{}{}'.format(h, '' if h == 1 else 's',
                            '  <- 36h' if h in (1, 2) else
                            '  <- shipped' if h == 7 else ''),
        m.n, '{:.0f}'.format(m.trades_per_year()),
        '{:+.2f}%'.format(m.expectancy * 100),
        '{:+.2f}%'.format(m.trimmed_expectancy(0.05) * 100),
        '{:.0%}'.format(m.win_rate),
        '{:.1f}%'.format(RT * m.trades_per_year() * 100)))

print("""
==============================================================================================================================
READING THIS
  GROSS is the edge before execution cost; net is what is left after it. The
  gap between them widens as the hold shortens, because the round trip is paid
  per TRADE and a shorter hold means more of them. 'cost/yr' is that toll in
  full: round-trip cost times trades per year, at full notional.

  A short hold wins only if GROSS holds up as the hold shortens. If gross falls
  AND the cost rises, both forces push the same way and the case is closed.""")
