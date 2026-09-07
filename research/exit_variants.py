"""
Testing the exit properly, because the accrual curve is confounded.

The diagnostic said all three strategies are BACK-LOADED - cumulative return
still climbing at the timeout, win rate rising with days held (S3 50%->66%,
D1 62%->73%, B1 58%->74%). Read naively that says "hold longer".

It cannot be read naively. SURVIVORSHIP: trades stopped out early leave the
sample, so later-day averages are computed on survivors, which are
disproportionately winners. S3's sample falls 202->166 by day 11 and B1's
178->43 by day 8. A rising win rate partly just means the losers already left.

So the accrual curve is a REASON to look at longer holds, not evidence for
them. The clean test is the counterfactual: run the whole backtest with a
different exit and put it through the same gate as everything else. That is
what happens below.

Three exits, each with a rationale rather than a sweep:
  FIXED      the current design; a timeout at N days.
  TRAILING   an ATR trailing stop with no timeout - the mechanically correct
             answer to a back-loaded curve WITH survivorship, because it lets
             a winner run for as long as it keeps working instead of guessing
             a cutoff, while cutting the losers the fixed timeout carries.
  BOTH       a trailing stop with a long backstop timeout, so a position cannot
             be held indefinitely by a drifting stop.
"""
import sys
sys.path.insert(0, 'research')
import engine, pooled

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']


def forced_flow_exit(params):
    """S3's entry, with a selectable exit."""
    vol_mult, atr_mult = params['vol_mult'], params['atr_mult']
    mode = params.get('exit', 'fixed')
    hold = params.get('hold', 10)
    trail_atr = params.get('trail_atr', 2.5)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
                state['vma'] = engine.sma_series([b['v'] for b in bars], 20)
            atr = state['atr'][i]
            if atr is None:
                return None

            if pos is not None:
                held = i - pos['entry_i']
                if mode in ('fixed', 'both') and held >= hold:
                    return {'exit': True, 'reason': 'timeout'}
                if mode in ('trail', 'both'):
                    # ratchet the stop behind the best price seen since entry
                    if pos['dir'] == 'long':
                        peak = max(b['h'] for b in bars[pos['entry_i']:i + 1])
                        if bars[i]['c'] < peak - trail_atr * atr:
                            return {'exit': True, 'reason': 'trail'}
                    else:
                        trough = min(b['l'] for b in bars[pos['entry_i']:i + 1])
                        if bars[i]['c'] > trough + trail_atr * atr:
                            return {'exit': True, 'reason': 'trail'}
                return None

            vma = state['vma'][i]
            today = bars[i]
            if not vma or vma <= 0 or today['v'] < vol_mult * vma:
                return None
            px = today['c']
            want = ('long' if today['c'] > today['o']
                    else 'short' if today['c'] < today['o'] else None)
            if want is None:
                return None
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None, 'reason': 'vol spike'}
        return sig
    return factory


def gate(label, params, **kw):
    _, m = pooled.pooled(forced_flow_exit, params, COINS, 60, name=label, **kw)
    if m.n == 0:
        print('  {:<34} NO TRADES'.format(label))
        return None
    tr, te = pooled.pooled_split(m)
    yr = pooled.pooled_yearly(m)
    pos = sum(1 for _, r in yr if r.expectancy > 0)
    print('  {:<34} n={:<4} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%} '
          'train={:>7.2%} test={:>7.2%} yr={}/{} hold={:>4.1f}d CAGR={:>6.1%}'.format(
              label, m.n, m.win_rate, m.expectancy, m.trimmed_expectancy(0.05),
              tr.expectancy if tr else 0, te.expectancy if te else 0,
              pos, len(yr), m.avg_days_held, m.account_cagr(0.20)))
    return m


BASE = {'vol_mult': 1.5, 'atr_mult': 2.5}

print('=' * 132)
print('S3 EXIT VARIANTS - full gate on each. Baseline is the shipped 10-day timeout.')
print('=' * 132)
print('\n  -- fixed timeout, varying length (the naive read of the accrual curve) --')
base = gate('BASELINE fixed 10d (shipped)', dict(BASE, exit='fixed', hold=10))
for h in (14, 20, 30, 45):
    gate('fixed {}d'.format(h), dict(BASE, exit='fixed', hold=h))

print('\n  -- ATR trailing stop, no timeout (lets winners run, cuts losers) --')
for ta in (1.5, 2.0, 2.5, 3.0, 4.0):
    gate('trail {:.1f}xATR, no timeout'.format(ta), dict(BASE, exit='trail', trail_atr=ta))

print('\n  -- trailing stop with a long backstop timeout --')
for ta in (2.0, 2.5, 3.0):
    gate('trail {:.1f}xATR + 30d cap'.format(ta),
         dict(BASE, exit='both', trail_atr=ta, hold=30))

print('\n' + '=' * 132)
print('COST STRESS on the leading candidates (a longer hold trades fewer times,')
print('so it should be LESS cost-sensitive - worth confirming rather than assuming)')
print('=' * 132)
for label, p in (('shipped fixed 10d', dict(BASE, exit='fixed', hold=10)),
                 ('fixed 20d', dict(BASE, exit='fixed', hold=20)),
                 ('trail 3.0xATR', dict(BASE, exit='trail', trail_atr=3.0))):
    row = '  {:<26}'.format(label)
    for mult in (1, 2, 3):
        _, m = pooled.pooled(forced_flow_exit, p, COINS, 60, name='c',
                             fee=engine.TAKER_FEE * mult,
                             slippage=engine.SLIPPAGE * mult)
        row += '{:>10}'.format('{:+.2f}%'.format(m.trimmed_expectancy(0.05) * 100) if m.n else '-')
    print(row + '   (trimmed at 1x / 2x / 3x costs)')
