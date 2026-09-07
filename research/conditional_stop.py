"""
Should the stop distance depend on the signal, rather than being one number?

MAE analysis found two things worth acting on and one worth NOT acting on:

  * Winners dip a median 0.67x ATR against entry before working; losers dip
    2.19x. A 3.3x separation - so a stop genuinely SEPARATES them here, it is
    not merely a loss cap.
  * 95% of winners never dip past 2.21x. The shipped 2.5x stop sits just above
    that, which is exactly where theory says to put it. Chosen by instinct,
    correct by measurement.
  * Adverse excursion barely differs BY COIN (median 1.08x-1.43x, p90
    3.12x-3.60x). ATR is already doing the normalising, so a per-coin stop is
    not justified. Worth stating: that is the current design being right, not
    merely untested.

But it DOES differ sharply by signal strength:

    weak   (<1.5x ATR range)   median MAE 1.40x   p90 3.92x   win rate 46%
    mid    (1.5-2.5x)          median MAE 1.31x   p90 3.53x   win rate 52%
    strong (>=2.5x)            median MAE 0.65x   p90 2.09x   win rate 85%

A strong cascade goes your way quickly and barely retraces. That is
mechanistically sensible - a genuine forced-flow move does not hesitate - and it
implies strong signals can carry a TIGHTER stop without cutting winners, which
cuts the loss on the ones that do fail.

The obvious trap, and why this is tested rather than asserted: the stop
determines the outcome it would be fitted to, so tuning stop distance against
historical P&L is circular. The defence here is that the RULE comes from the MAE
distribution (a property of the market) rather than from a P&L sweep, and it is
then validated on a train/test split it had no part in choosing.
"""
import sys, statistics as st
sys.path.insert(0, 'research')
import engine, pooled

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
HOLD = 10


def conditional_stop_strategy(params):
    """S3 with a stop that may depend on signal strength.

    `mode`:
      fixed  - one multiple for everything (what ships today)
      tiered - tighter stop on strong signals, wider on weak ones, with the
               levels taken from each tier's own p90 MAE rather than a sweep
    """
    vol_mult = params['vol_mult']
    mode = params.get('mode', 'fixed')
    fixed_atr = params.get('stop_atr', 2.5)
    strong_atr = params.get('strong_atr', 2.0)
    mid_atr = params.get('mid_atr', 2.5)
    weak_atr = params.get('weak_atr', 3.0)

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

            if mode == 'fixed':
                mult = fixed_atr
            else:
                strength = (b['h'] - b['l']) / atr
                mult = (strong_atr if strength >= 2.5
                        else mid_atr if strength >= 1.5 else weak_atr)

            px = b['c']
            stop = px - mult * atr if want == 'long' else px + mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': 'stop {:.1f}xATR'.format(mult)}
        return sig
    return factory


def gate(label, params, **kw):
    _, m = pooled.pooled(conditional_stop_strategy, params, COINS, 60, name=label, **kw)
    if not m.n:
        print('  {:<40} NO TRADES'.format(label))
        return None
    tr, te = pooled.pooled_split(m)
    yr = pooled.pooled_yearly(m)
    pos = sum(1 for _, r in yr if r.expectancy > 0)
    print('  {:<40} n={:<4} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%} '
          'train={:>7.2%} test={:>7.2%} yr={}/{} CAGR={:>6.1%}'.format(
              label, m.n, m.win_rate, m.expectancy, m.trimmed_expectancy(0.05),
              tr.expectancy if tr else 0, te.expectancy if te else 0,
              pos, len(yr), m.account_cagr(0.20)))
    return m


BASE = {'vol_mult': 1.5}

print('=' * 130)
print('1. IS THE SHIPPED 2.5x ACTUALLY WELL PLACED? (fixed stop, swept)')
print('=' * 130)
for s in (1.5, 2.0, 2.5, 3.0, 3.5, 4.0):
    gate('fixed {:.1f}xATR{}'.format(s, '  <- shipped' if s == 2.5 else ''),
         dict(BASE, mode='fixed', stop_atr=s))

print('\n' + '=' * 130)
print('2. CONDITIONAL STOP - tighter on strong signals, wider on weak')
print('   Levels taken from each tier\'s own p90 MAE, not from a P&L sweep')
print('=' * 130)
gate('BASELINE fixed 2.5x', dict(BASE, mode='fixed', stop_atr=2.5))
gate('tiered 2.0 / 2.5 / 3.0 (strong/mid/weak)',
     dict(BASE, mode='tiered', strong_atr=2.0, mid_atr=2.5, weak_atr=3.0))
gate('tiered 2.0 / 2.5 / 4.0 (wider weak)',
     dict(BASE, mode='tiered', strong_atr=2.0, mid_atr=2.5, weak_atr=4.0))
gate('tiered 2.5 / 2.5 / 4.0 (only widen weak)',
     dict(BASE, mode='tiered', strong_atr=2.5, mid_atr=2.5, weak_atr=4.0))
gate('tiered 2.0 / 3.0 / 3.0 (only tighten strong)',
     dict(BASE, mode='tiered', strong_atr=2.0, mid_atr=3.0, weak_atr=3.0))

print('\n' + '=' * 130)
print('3. ROBUSTNESS - does the tiered rule survive its own neighbourhood?')
print('=' * 130)
res = []
for sa in (1.75, 2.0, 2.25):
    for wa in (3.0, 3.5, 4.0):
        m = gate('tiered strong={:.2f} mid=2.5 weak={:.1f}'.format(sa, wa),
                 dict(BASE, mode='tiered', strong_atr=sa, mid_atr=2.5, weak_atr=wa))
        if m:
            res.append(m.trimmed_expectancy(0.05))
base = gate('  (reference) fixed 2.5x', dict(BASE, mode='fixed', stop_atr=2.5))
if res and base:
    better = sum(1 for r in res if r > base.trimmed_expectancy(0.05))
    print('\n  {}/{} tiered variants beat the fixed 2.5x baseline on trimmed expectancy'.format(
        better, len(res)))

print('\n' + '=' * 130)
print('4. COST STRESS on the leading tiered variant')
print('=' * 130)
for mult in (1, 2, 3):
    _, m = pooled.pooled(conditional_stop_strategy,
                         dict(BASE, mode='tiered', strong_atr=2.0, mid_atr=2.5, weak_atr=3.0),
                         COINS, 60, name='c', fee=engine.TAKER_FEE * mult,
                         slippage=engine.SLIPPAGE * mult)
    if m.n:
        print('  {}x costs: exp={:>7.2%} trim5={:>7.2%} CAGR={:>6.1%}'.format(
            mult, m.expectancy, m.trimmed_expectancy(0.05), m.account_cagr(0.20)))
