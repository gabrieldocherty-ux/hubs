"""
B1 PERP-SPOT BASIS DISLOCATION.

HYPOTHESIS (mechanism): Hyperliquid runs a perp and a spot book for the same
asset. The perp is where leverage lives; spot is where unlevered ownership
lives. When the perp trades rich to spot, leveraged buyers are bidding for
exposure faster than anyone is willing to buy the underlying - the premium is
the price of that impatience, paid by people using borrowed money. That is a
positioning extreme, and positioning extremes unwind.

WHY THIS IS NOT THE REJECTED FUNDING STRATEGY (D3): funding is the mechanism
that PULLS the perp back to the index, computed from a formula against an
external oracle and clamped. Basis is the RAW dislocation that funding is
reacting to. Measured correlation between the two on daily closes is -0.06
(BTC), -0.01 (ETH), +0.14 (SOL), +0.46 (HYPE), with same-sign agreement near
50% - they are close to orthogonal, so this is a different signal, not the dead
one relabelled.

EVIDENCE BEFORE THE STRATEGY WAS WRITTEN: bucketing days by trailing-percentile
basis and reading forward returns gave a high-minus-low spread of -1.40% (1d),
-2.73% (3d) and -4.30% (7d), negative on 4 of 4 coins at every horizon up to a
week. The strategy below is an attempt to capture that; whether it survives
costs, stops and walk-forward is a separate question the bucketed test cannot
answer - and assuming otherwise is exactly how the funding-crowding idea got
recorded as promising when it was not.

DATA LIMITATION, stated up front: HL spot history starts 2025-02 (BTC),
2025-03 (ETH), 2025-05 (SOL), 2024-11 (HYPE) - between 1.3 and 1.8 years, far
shorter than the perp history, and it covers ONE broad market period for all
four coins. Cross-coin agreement is therefore much less independent than 4/4
makes it sound: these coins are highly correlated, so a single regime could
produce agreement on all of them.
"""
import sys
sys.path.insert(0, 'research')
import engine

SANITY = 0.02      # a daily-close basis beyond 2% is a thin-book print, not a dislocation


def build_basis(perp_bars, spot_bars):
    """Aligned basis series, with bad prints marked None rather than smoothed away."""
    smap = {b['t']: b['c'] for b in spot_bars if b['c'] > 0 and b['v'] > 0}
    out = []
    for b in perp_bars:
        s = smap.get(b['t'])
        if s is None:
            out.append(None)
            continue
        v = (b['c'] - s) / s
        out.append(None if abs(v) > SANITY else v)
    return out


def basis_dislocation(params):
    """
    RULES
      entry  short when today's basis is at/above the `pct` percentile of its own
             trailing `win` days; long when at/below (1-`pct`). Requires at least
             `min_hist` valid observations, so it never trades on a thin window.
      exit   basis reverting past its trailing median, a `max_hold` day timeout,
             or the stop - whichever comes first.
      stop   `atr_mult` x ATR(14), mandatory, set at entry.

    Sizing note (the risk manager owns sizing, not this strategy): this is a
    counter-trend entry, so it should be sized no larger than the trend
    strategies, not larger. A mean-reversion signal that is right most of the
    time and catastrophically wrong occasionally is the classic way to blow up
    an account that was "usually profitable".
    """
    pct, win, atr_mult = params['pct'], params['win'], params['atr_mult']
    max_hold, min_hist = params['max_hold'], params.get('min_hist', 60)
    basis = params['basis']
    both = params.get('both_sides', True)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
            atr = state['atr'][i]
            b = basis[i] if i < len(basis) else None
            if atr is None or b is None:
                return None

            hist = [x for x in basis[max(0, i - win):i + 1] if x is not None]
            if len(hist) < min_hist:
                return None
            hs = sorted(hist)
            hi = hs[min(len(hs) - 1, int(len(hs) * pct))]
            lo = hs[max(0, int(len(hs) * (1 - pct)))]
            med = hs[len(hs) // 2]

            if pos is not None:
                if i - pos['entry_i'] >= max_hold:
                    return {'exit': True, 'reason': 'timeout'}
                if pos['dir'] == 'short' and b <= med:
                    return {'exit': True, 'reason': 'basis normalised'}
                if pos['dir'] == 'long' and b >= med:
                    return {'exit': True, 'reason': 'basis normalised'}
                return None

            px = bars[i]['c']
            if b >= hi:
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'perp rich to spot by {:+.3f}%'.format(b * 100)}
            if both and b <= lo:
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'perp cheap to spot by {:+.3f}%'.format(b * 100)}
            return None
        return sig
    return factory
