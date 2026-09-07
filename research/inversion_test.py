"""
If a strategy reliably loses, can you just trade the opposite and win?

Good question, and the arithmetic looks encouraging at first. Write the net
result of a trade as G - C, where G is the raw price move in your favour and C
is the round-trip cost (0.190% modelled here). Flipping the direction flips G
but NOT C, because you pay to trade in either direction:

    original   net = G - C
    inverted   net = -G - C

So inverting only profits when the strategy's GROSS loss exceeds the cost of
trading it, i.e. when the original net is worse than -2C = -0.38%. Anything
losing less than that is losing to friction, not to a real anti-edge, and
flipping it just pays the friction in the other direction.

Three candidates clear that bar on paper:
    S5 RSI(2) reversal     net -0.94% on n=899  -> gross about -0.75%
    D5 BTC lead-lag        net -1.18% on n=311  -> gross about -0.99%
    D3 funding-crowding    net -0.62% on n=165  -> gross about -0.43%

But the arithmetic assumes inverting simply negates the outcome, and it does
not. Two reasons it fails in practice:

  STOPS ARE NOT SYMMETRIC. A stop-loss truncates the losing tail and lets the
  winning tail run. Invert the direction and the stop now truncates what used
  to be the winning tail. The inverted trade exits at different times and
  different prices - so you cannot negate the P&L, you have to re-run it. That
  is what this script does.

  FUNDING FLIPS SIGN. Longs pay funding and shorts receive it. A strategy that
  lost partly because it was long into positive funding does not automatically
  win by being short.

And the deeper trap, which no amount of re-running fixes: a subgroup found by
slicing the data five ways AFTER seeing the results (the range<1.0xATR bucket,
n=17) will contain the unluckiest slice by construction. Inverting the worst
looking bucket is data mining with the sign changed.
"""
import sys
sys.path.insert(0, 'research')
import engine, pooled, hl_data
from strategies_daily import funding_crowding, btc_leadlag
from strategies_batch2 import rsi2

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
ALTS = ['ETH', 'SOL', 'HYPE']
RT = 2 * (engine.TAKER_FEE + engine.SLIPPAGE)


def invert(strategy_fn):
    """Wrap a strategy so every entry is taken the other way round, with the
    stop mirrored to the correct side. Re-run rather than negated, so stop
    behaviour and funding are handled honestly."""
    def wrapped(params):
        inner = strategy_fn(params)

        def factory():
            sig = inner()

            def flipped(bars, i, pos):
                s = sig(bars, i, pos)
                if s is None or s.get('exit'):
                    return s
                d = s.get('dir')
                if not d:
                    return s
                px = bars[i]['c']
                # mirror the stop distance onto the other side of entry
                dist = abs(px - s['stop'])
                nd = 'short' if d == 'long' else 'long'
                return {'dir': nd,
                        'stop': px + dist if nd == 'short' else px - dist,
                        'target': None,
                        'reason': 'INVERTED: ' + str(s.get('reason', ''))}
            return flipped
        return factory
    return wrapped


CASES = [
    ('S5 RSI(2) reversal', rsi2,
     {'lo': 10, 'hi': 90, 'hold': 2, 'atr_mult': 2.5}, 60, '1d', COINS),
    ('D5 BTC lead-lag', btc_leadlag,
     {'look': 3, 'thresh': 1.0, 'hold': 3, 'atr_mult': 2.5,
      'btc_bars': hl_data.get_candles('BTC', '1d', 2200)[0]}, 90, '1d', ALTS),
    ('D3 funding-crowding', funding_crowding,
     {'fund_n': 3, 'pct': 0.90, 'pct_win': 180, 'atr_mult': 3.0, 'max_hold': 10,
      'funding': None}, 200, '1d', COINS),
]

print('=' * 118)
print('WHAT INVERTING A LOSING STRATEGY ACTUALLY DOES')
print('  round-trip cost {:.3f}% -> a strategy must lose more than {:.2f}% for'.format(
    RT * 100, 2 * RT * 100))
print('  inversion to have anything to work with')
print('=' * 118)

for label, fn, params, warm, iv, coins in CASES:
    _, orig = pooled.pooled(fn, params, coins, warm, interval=iv, name=label)
    _, inv = pooled.pooled(invert(fn), params, coins, warm, interval=iv, name=label + ' INV')
    if not orig.n or not inv.n:
        print('\n{}: no trades'.format(label))
        continue
    gross_o = sum(t.gross_pct for t in orig.trades) / orig.n
    gross_i = sum(t.gross_pct for t in inv.trades) / inv.n
    to, ti = pooled.pooled_split(orig), pooled.pooled_split(inv)

    print('\n' + '-' * 118)
    print('{}'.format(label))
    print('  {:<14}{:>7}{:>11}{:>11}{:>11}{:>11}{:>11}{:>11}'.format(
        '', 'n', 'win rate', 'gross', 'net exp', 'trimmed', 'train', 'test'))
    for nm, r, g, sp in (('original', orig, gross_o, to), ('INVERTED', inv, gross_i, ti)):
        tr, te = sp
        print('  {:<14}{:>7}{:>11}{:>11}{:>11}{:>11}{:>11}{:>11}'.format(
            nm, r.n, '{:.1%}'.format(r.win_rate), '{:+.2f}%'.format(g * 100),
            '{:+.2f}%'.format(r.expectancy * 100),
            '{:+.2f}%'.format(r.trimmed_expectancy(0.05) * 100),
            '{:+.2f}%'.format(tr.expectancy * 100) if tr else '-',
            '{:+.2f}%'.format(te.expectancy * 100) if te else '-'))
    naive = -orig.expectancy - RT
    print('  naive prediction if inverting simply negated the result: {:+.2f}%'.format(naive * 100))
    print('  what actually happened when re-run:                      {:+.2f}%   (gap {:+.2f}%)'.format(
        inv.expectancy * 100, (inv.expectancy - naive) * 100))
    print('  trades: {} original vs {} inverted{}'.format(
        orig.n, inv.n, '  <- the stop changes which trades survive' if orig.n != inv.n else ''))

print('\n' + '=' * 118)
print('THE WEAK-SIGNAL BUCKET (range < 1.0x ATR, n=17, -5.01%) - why not invert that?')
print('=' * 118)
print("""  It clears the arithmetic bar easily. It should not be traded anyway:

  n=17. With a per-trade spread around 8-10%, the standard error on that mean is
  roughly 2.4% - so -5.01% sits about 2 standard errors from zero. That is
  suggestive, not established.

  Worse, the bucket was found by cutting the trades five ways AFTER seeing the
  outcomes. The worst of five slices looks bad partly BECAUSE it is the worst of
  five - the same reason the best of five looks good. Inverting the unluckiest
  subgroup is the same data-mining error as adopting the luckiest one, with the
  sign changed.

  The honest use of that finding is what conviction sizing already does: put
  LESS on weak signals. That does not require the -5.01% to be exactly right,
  only for the ranking to hold - which it does, monotonically, across all five
  buckets and on an independent window.""")
