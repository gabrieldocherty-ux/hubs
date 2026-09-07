"""
The exit I have not tested: a trailing stop that only ARMS after a threshold profit.

MFE analysis found a real give-back problem:
  - 66% of trades hand back more than half their peak
  - only 10% exit within 25% of their peak
  - 26% of trades that reached +1.0x ATR in profit still ended NEGATIVE

Two fixes were already tried and both failed, for opposite reasons:

  PROFIT TARGETS cap the upside. Tight ones are catastrophic (a 0.5x ATR target
  costs -234pp) because this is a positive-skew strategy - the few very large
  winners are where the edge lives, and a target sells them early. Only a very
  wide 4.0x target helped (+43pp), and the sweep around it is non-monotonic
  (2.0x -17pp, 3.0x -29pp, 4.0x +43pp), which is the signature of noise rather
  than a real level.

  TRAILING STOPS FROM ENTRY cut winners before they develop. Every variant
  scored below baseline, win rate falling 55% -> 38-45%, because a cascade move
  is internally noisy and a stop trailing from the first bar gets shaken out
  inside the very move it is meant to ride.

The construction that addresses both is the one neither test used: **a trailing
stop that does not exist until the trade is already meaningfully profitable.**
Early on the trade is left completely alone, so it can breathe through the noise
that killed the from-entry trail. Once it has reached the arming threshold, the
trail protects what has been made, which is what the give-back numbers say is
being lost.

This is also the standard construction in the literature - arm after roughly half
the historical median MFE, then trail by about 1 ATR.

Two parameters, both with a stated rationale rather than a sweep:
  ARM at 1.5x ATR   ~half of the 2.88x median MFE of eventual winners
  TRAIL by 1.5x ATR ~the 75th percentile of winners' adverse excursion, so
                    normal retracement inside a live move does not trigger it
Both are then swept anyway, because a rationale is not evidence.
"""
import sys, statistics as st
sys.path.insert(0, 'research')
import engine, pooled

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
RT = 2 * (engine.TAKER_FEE + engine.SLIPPAGE)


def armed_trail(params):
    """S3 entry; exit on stop, timeout, or a trail that only arms after profit."""
    vol_mult, hold = params['vol_mult'], params['hold']
    stop_atr = params['stop_atr']
    arm_at = params.get('arm_at')          # None = no trail at all (baseline)
    trail_by = params.get('trail_by', 1.5)

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
                if i - pos['entry_i'] >= hold:
                    return {'exit': True, 'reason': 'timeout'}
                if arm_at is not None:
                    entry = pos['entry']
                    seg = bars[pos['entry_i']:i + 1]
                    if pos['dir'] == 'long':
                        peak = max(b['h'] for b in seg)
                        mfe = (peak - entry) / atr
                        if mfe >= arm_at and bars[i]['c'] < peak - trail_by * atr:
                            return {'exit': True, 'reason': 'armed_trail'}
                    else:
                        trough = min(b['l'] for b in seg)
                        mfe = (entry - trough) / atr
                        if mfe >= arm_at and bars[i]['c'] > trough + trail_by * atr:
                            return {'exit': True, 'reason': 'armed_trail'}
                return None

            vma, b = state['vma'][i], bars[i]
            if not vma or vma <= 0 or b['v'] < vol_mult * vma:
                return None
            want = 'long' if b['c'] > b['o'] else ('short' if b['c'] < b['o'] else None)
            if want is None:
                return None
            px = b['c']
            stop = px - stop_atr * atr if want == 'long' else px + stop_atr * atr
            return {'dir': want, 'stop': stop, 'target': None, 'reason': 'x'}
        return sig
    return factory


def gate(label, params, **kw):
    _, m = pooled.pooled(armed_trail, params, COINS, 60, name=label, **kw)
    if not m.n:
        print('  {:<40} NO TRADES'.format(label))
        return None
    tr, te = pooled.pooled_split(m)
    yr = pooled.pooled_yearly(m)
    pos = sum(1 for _, r in yr if r.expectancy > 0)
    print('  {:<40}{:>6}{:>9}{:>10}{:>10}{:>9}{:>10}{:>10}{:>6}{:>9}'.format(
        label, m.n, '{:.0%}'.format(m.win_rate), '{:+.2f}%'.format(m.expectancy * 100),
        '{:+.2f}%'.format(m.trimmed_expectancy(0.05) * 100),
        '{:.1f}d'.format(m.avg_days_held),
        '{:+.2f}%'.format(tr.expectancy * 100) if tr else '-',
        '{:+.2f}%'.format(te.expectancy * 100) if te else '-',
        '{}/{}'.format(pos, len(yr)), '{:+.1f}%'.format(m.account_cagr(0.20) * 100)))
    return m


BASE = {'vol_mult': 1.5, 'hold': 10, 'stop_atr': 2.5}
HDR = '  {:<40}{:>6}{:>9}{:>10}{:>10}{:>9}{:>10}{:>10}{:>6}{:>9}'.format(
    'variant', 'n', 'win', 'net exp', 'trim5', 'hold', 'train', 'test', 'yrs', 'CAGR')

print('=' * 132)
print('ARMED TRAILING STOP - trail only exists after the trade is already in profit')
print('=' * 132)
print(HDR)
base = gate('BASELINE: no trail (shipped)', dict(BASE))
print()
for arm in (1.0, 1.5, 2.0, 3.0):
    for trail in (1.0, 1.5, 2.0):
        gate('arm at {:.1f}x, trail by {:.1f}x'.format(arm, trail),
             dict(BASE, arm_at=arm, trail_by=trail))
    print()

print('=' * 132)
print('CONTROL: trailing from ENTRY (no arming) - the version already rejected')
print('=' * 132)
print(HDR)
for trail in (1.5, 2.0):
    gate('trail {:.1f}x from entry (no arm)'.format(trail),
         dict(BASE, arm_at=0.0, trail_by=trail))

print('\n' + '=' * 132)
print('COST STRESS on the best armed variant')
print('=' * 132)
print(HDR)
for mult in (1, 2, 3):
    gate('arm 1.5x trail 1.5x @ {}x costs'.format(mult),
         dict(BASE, arm_at=1.5, trail_by=1.5),
         fee=engine.TAKER_FEE * mult, slippage=engine.SLIPPAGE * mult)

print('\n' + '=' * 132)
print('DOES IT ACTUALLY FIX THE GIVE-BACK? (exit reasons, best armed variant)')
print('=' * 132)
_, m = pooled.pooled(armed_trail, dict(BASE, arm_at=1.5, trail_by=1.5), COINS, 60, name='x')
by = {}
for t in m.trades:
    by.setdefault(t.exit_reason, []).append(t)
for reason, ts in sorted(by.items(), key=lambda kv: -len(kv[1])):
    e = st.mean([t.pnl_pct for t in ts])
    w = sum(1 for t in ts if t.won) / len(ts)
    print('  {:<18} n={:<4} ({:>5.1%} of trades)  win rate {:>5.1%}  avg pnl {:>7.2%}'.format(
        reason, len(ts), len(ts) / m.n, w, e))
