"""
Second batch of hypotheses. Each is a distinct mechanism, tested quickly and
reported whatever the outcome.

S1 short-term reversal      - pure version of D2 without the volume gate, to
                              isolate whether the volume filter was the problem
                              or the reversion premise itself was.
S2 session effect           - does US-hours flow behave differently from Asia?
S3 volume-spike only        - decomposes D1: is the edge from the range filter,
                              the breakout, or both? A strategy you cannot
                              decompose is one you do not understand.
S4 trend-aligned breakout   - D1 but only in the direction of the longer trend.
S5 RSI(2) extreme           - the classic short-horizon reversal system, included
                              because it is the most widely published version of
                              the idea and therefore the most likely to be
                              arbitraged away. A clean negative here is useful.
"""
import sys
sys.path.insert(0, 'research')
import engine


def st_reversal(params):
    """S1: buy after `look`-day decline exceeding `z` sigma; no volume condition.
    HYPOTHESIS: short-horizon reversal from liquidity provision, same as D2, but
    if D2 failed because the volume gate was wrong rather than because reversion
    is absent, this will separate the two."""
    look, z, hold, atr_mult = params['look'], params['z'], params['hold'], params['atr_mult']
    both = params.get('both_sides', False)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'sd' not in state:
                c = [b['c'] for b in bars]
                rets = [0.0] + [(c[k] - c[k - 1]) / c[k - 1] for k in range(1, len(c))]
                state['sd'] = engine.stdev_series(rets, 60)
                state['c'] = c
                state['atr'] = engine.atr_series(bars, 14)
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            sd, atr, c = state['sd'][i], state['atr'][i], state['c']
            if None in (sd, atr) or sd <= 0 or i < look:
                return None
            r = (c[i] - c[i - look]) / c[i - look]
            norm = r / (sd * (look ** 0.5))
            px = c[i]
            if norm < -z:
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': '{}d decline {:.1f}sd'.format(look, norm)}
            if both and norm > z:
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': '{}d advance {:.1f}sd'.format(look, norm)}
            return None
        return sig
    return factory


def session_effect(params):
    """S2: hold only during a specific 4h slot of the UTC day.
    HYPOTHESIS: institutional flow concentrates in US hours, retail in Asia
    hours, so returns may be systematically different by session. This is close
    to data mining by construction - there are only 6 slots and testing all of
    them will produce a winner by chance - so it is reported as a screen, and
    any hit needs the same cross-coin replication as everything else."""
    slot, hold, atr_mult = params['slot'], params['hold'], params['atr_mult']
    direction = params.get('dir', 'long')
    import datetime as _dt

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
            atr = state['atr'][i]
            if atr is None:
                return None
            if pos is not None:
                return {'exit': True, 'reason': 'slot end'} if i - pos['entry_i'] >= hold else None
            h = _dt.datetime.utcfromtimestamp(bars[i]['t'] / 1000).hour
            if h != slot:
                return None
            px = bars[i]['c']
            stop = px - atr_mult * atr if direction == 'long' else px + atr_mult * atr
            return {'dir': direction, 'stop': stop, 'target': None,
                    'reason': 'session {}:00 UTC'.format(slot)}
        return sig
    return factory


def volume_spike(params):
    """S3: enter on an outsized VOLUME print alone, no range/breakout condition.
    HYPOTHESIS: if D1's edge is really about forced flow, volume alone should
    carry some of it. If this is flat while D1 works, the edge needs the
    breakout too - which is informative about what is actually happening."""
    vol_mult, hold, atr_mult = params['vol_mult'], params['hold'], params['atr_mult']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'vma' not in state:
                state['vma'] = engine.sma_series([b['v'] for b in bars], 20)
                state['atr'] = engine.atr_series(bars, 14)
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            vma, atr = state['vma'][i], state['atr'][i]
            if None in (vma, atr) or vma <= 0:
                return None
            if bars[i]['v'] < vol_mult * vma:
                return None
            b = bars[i]
            want = 'long' if b['c'] > b['o'] else 'short'   # follow the day's direction
            px = b['c']
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': 'volume {:.1f}x avg'.format(b['v'] / vma)}
        return sig
    return factory


def trend_aligned_breakout(params):
    """S4: D1, but only in the direction of the `trend_n`-day trend.
    HYPOTHESIS: cascades that run WITH the prevailing trend should extend
    further, because they trigger stops belonging to traders positioned against
    an established move. Counter-trend cascades should mean-revert faster."""
    n, atr_mult, max_hold, atr_ratio, trend_n = (params['n'], params['atr_mult'],
                                                 params['max_hold'], params['atr_ratio'],
                                                 params['trend_n'])
    invert = params.get('invert', False)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'hh' not in state:
                state['hh'] = engine.rolling_max([b['h'] for b in bars], n)
                state['ll'] = engine.rolling_min([b['l'] for b in bars], n)
                state['atr'] = engine.atr_series(bars, 14)
                state['ma'] = engine.sma_series([b['c'] for b in bars], trend_n)
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= max_hold else None
            if i < 1:
                return None
            hh, ll, atr, ma = state['hh'][i - 1], state['ll'][i - 1], state['atr'][i], state['ma'][i]
            if None in (hh, ll, atr, ma) or atr <= 0:
                return None
            b = bars[i]
            if (b['h'] - b['l']) < atr_ratio * atr:
                return None
            px = b['c']
            up_trend = px > ma
            if px > hh and (up_trend != invert):
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'breakout with trend'}
            if px < ll and ((not up_trend) != invert):
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'breakdown with trend'}
            return None
        return sig
    return factory


def rsi2(params):
    """S5: classic RSI(2) reversal - long below `lo`, short above `hi`.
    HYPOTHESIS: the most published short-horizon reversal system there is.
    Included specifically because its fame makes it the most likely candidate to
    have been arbitraged out; a negative result is the expected outcome and is
    worth recording."""
    lo, hi, hold, atr_mult = params['lo'], params['hi'], params['hold'], params['atr_mult']
    both = params.get('both_sides', True)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'r' not in state:
                state['r'] = engine.rsi_series([b['c'] for b in bars], 2)
                state['atr'] = engine.atr_series(bars, 14)
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            r, atr = state['r'][i], state['atr'][i]
            if None in (r, atr):
                return None
            px = bars[i]['c']
            if r < lo:
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'RSI2 {:.0f}'.format(r)}
            if both and r > hi:
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'RSI2 {:.0f}'.format(r)}
            return None
        return sig
    return factory
