"""
DAILY-BAR FAMILY - short horizon, higher trade frequency (target 2-10 day holds).

These are deliberately NOT the trend family at a faster speed. The overlap check
(overlap_check.py) showed the macro trend variants are 0.73-1.00 correlated with
each other - running the same mechanism faster would just add a seventh copy of
the same bet. So each strategy here is built on a mechanism that is structurally
distinct from "price has been going up, so buy":

  D1  liquidation-cascade continuation  (microstructure)
  D2  forced-seller mean reversion      (liquidity provision)
  D3  funding crowding                  (positioning / revealed preference)
  D4  volatility-regime transition      (vol clustering)
  D5  cross-asset lead-lag              (information diffusion between coins)

Prior-work warning, stated up front: this project has ALREADY rejected a
continuous z-score mean reversion on 4h bars, and a Fear&Greed contrarian trade.
D2 is a different construction (event-driven, daily, with a confirmation
requirement) but it is attacking the same general direction, so it starts with a
prior against it and needs to clear the bar convincingly, not narrowly.
"""
import sys
sys.path.insert(0, 'research')
import engine


# ---------------------------------------------------------------- D1
def range_breakout(params):
    """
    D1 SHORT-RANGE BREAKOUT (liquidation cascade continuation).

    HYPOTHESIS (mechanism): on a leveraged perp venue, resting stop-losses and
    liquidation triggers cluster just beyond recent range extremes. When price
    trades through a short-term extreme, the venue's own liquidation engine
    mechanically produces further same-direction market orders. That is a
    microstructure effect specific to leveraged venues - not a claim about
    investor psychology - and it should decay within days as the cascade
    exhausts, which is why this is a short-horizon strategy and not a trend one.

    RULES: enter on a close beyond the `n`-day extreme, but only when the day's
    range is unusually large (`atr_ratio` x ATR) - the cascade thesis requires
    evidence of forced flow, not a quiet drift through the level. Exit on a
    fixed `max_hold` timeout or an ATR stop, whichever comes first.
    """
    n, atr_mult, max_hold, atr_ratio = (params['n'], params['atr_mult'],
                                        params['max_hold'], params['atr_ratio'])

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'hh' not in state:
                state['hh'] = engine.rolling_max([b['h'] for b in bars], n)
                state['ll'] = engine.rolling_min([b['l'] for b in bars], n)
                state['atr'] = engine.atr_series(bars, 14)
            if i < 1:
                return None
            hh, ll, atr = state['hh'][i - 1], state['ll'][i - 1], state['atr'][i]
            if None in (hh, ll, atr) or atr <= 0:
                return None
            if pos is not None:
                if i - pos['entry_i'] >= max_hold:
                    return {'exit': True, 'reason': 'timeout'}
                return None
            b = bars[i]
            rng = b['h'] - b['l']
            if rng < atr_ratio * atr:
                return None            # no evidence of forced flow
            px = b['c']
            if px > hh:
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'break {}d high on {:.1f}x ATR range'.format(n, rng / atr)}
            if px < ll:
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'break {}d low on {:.1f}x ATR range'.format(n, rng / atr)}
            return None
        return sig
    return factory


# ---------------------------------------------------------------- D2
def capitulation_reversion(params):
    """
    D2 FORCED-SELLER MEAN REVERSION.

    HYPOTHESIS (mechanism): most large single-day moves in crypto perps are not
    repricing on news - they are liquidation cascades, where the marginal seller
    is a margin engine that must sell at any price. Liquidity providers who
    absorb that flow are compensated for it, and the price impact that came from
    forced flow (rather than information) partially reverses once the cascade
    stops. The compensation for taking the other side is the edge.

    The distinguishing test versus "buy every dip": a forced-liquidation cascade
    should show BOTH an outsized move AND an outsized volume print. A large move
    on ordinary volume is more likely to be information, which should NOT revert.

    RULES: after a day closing down more than `z` standard deviations (of the
    trailing `vol_n`-day return distribution) on volume above `vol_mult` x its
    own 20-day average, go long. Exit on a `hold` day timeout or an ATR stop.
    Long-only by default: the same cascade logic on the upside is a short into
    an uptrend, which is a different and much worse bet in a market with
    positive drift.
    """
    z, vol_n, hold, atr_mult, vol_mult = (params['z'], params['vol_n'], params['hold'],
                                          params['atr_mult'], params['vol_mult'])
    allow_short_side = params.get('both_sides', False)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'sd' not in state:
                c = [b['c'] for b in bars]
                rets = [0.0] + [(c[k] - c[k - 1]) / c[k - 1] for k in range(1, len(c))]
                state['rets'] = rets
                state['sd'] = engine.stdev_series(rets, vol_n)
                state['atr'] = engine.atr_series(bars, 14)
                state['vma'] = engine.sma_series([b['v'] for b in bars], 20)
            if pos is not None:
                if i - pos['entry_i'] >= hold:
                    return {'exit': True, 'reason': 'timeout'}
                return None
            sd, atr, vma = state['sd'][i], state['atr'][i], state['vma'][i]
            if None in (sd, atr, vma) or sd <= 0 or vma <= 0:
                return None
            r = state['rets'][i]
            vol_ok = bars[i]['v'] >= vol_mult * vma
            if not vol_ok:
                return None
            px = bars[i]['c']
            if r < -z * sd:
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'capitulation {:.1f}sd on {:.1f}x vol'.format(r / sd, bars[i]['v'] / vma)}
            if allow_short_side and r > z * sd:
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'blowoff {:.1f}sd on {:.1f}x vol'.format(r / sd, bars[i]['v'] / vma)}
            return None
        return sig
    return factory


# ---------------------------------------------------------------- D3
def funding_crowding(params):
    """
    D3 FUNDING-CROWDING FADE.

    HYPOTHESIS (mechanism): perp funding is the clearing price for leveraged
    directional exposure. When funding reaches an extreme, one side is paying a
    large, continuous, real cash cost to hold its position - which means that
    side is crowded and its holders are, by construction, weak hands (they bleed
    every hour they are wrong). Crowded positioning unwinds, and the unwind is
    directional. Unlike a sentiment survey, this signal costs money to fake.

    Prior work (vault, 2026-09-04 update 8) found top-decile funding preceded
    negative forward returns on BTC/ETH/SOL and built a short-only version that
    held up on ETH/SOL but decayed on BTC. It was explicitly left un-validated
    pending a walk-forward. This is that test, on daily bars, with the funding
    percentile computed causally against a trailing window (the earlier version
    risked using a full-sample decile, which is lookahead).

    RULES: short when trailing-`fund_n`-day annualized funding is above its own
    trailing-`pct_win`-day `pct` percentile; long on the mirror image. Exit when
    funding normalises past the median, on an ATR stop, or after `max_hold` days.
    """
    fund_n, pct, pct_win = params['fund_n'], params['pct'], params['pct_win']
    atr_mult, max_hold = params['atr_mult'], params['max_hold']
    fcurve = params['funding']
    both = params.get('both_sides', True)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'f' not in state:
                state['f'] = engine.funding_annualized_series(bars, fcurve,
                                                              lookback_hours=fund_n * 24)
                state['atr'] = engine.atr_series(bars, 14)
            f, atr = state['f'][i], state['atr'][i]
            if None in (f, atr):
                return None
            hist = [v for v in state['f'][max(0, i - pct_win):i + 1] if v is not None]
            if len(hist) < max(40, pct_win // 3):
                return None
            hs = sorted(hist)
            hi = hs[min(len(hs) - 1, int(len(hs) * pct))]
            lo = hs[max(0, int(len(hs) * (1 - pct)))]
            med = hs[len(hs) // 2]

            if pos is not None:
                if i - pos['entry_i'] >= max_hold:
                    return {'exit': True, 'reason': 'timeout'}
                if pos['dir'] == 'short' and f <= med:
                    return {'exit': True, 'reason': 'funding normalised'}
                if pos['dir'] == 'long' and f >= med:
                    return {'exit': True, 'reason': 'funding normalised'}
                return None

            px = bars[i]['c']
            if f >= hi:
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'crowded long, funding {:+.0f}%/yr'.format(f * 100)}
            if both and f <= lo:
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'crowded short, funding {:+.0f}%/yr'.format(f * 100)}
            return None
        return sig
    return factory


# ---------------------------------------------------------------- D4
def vol_squeeze(params):
    """
    D4 VOLATILITY-REGIME TRANSITION.

    HYPOTHESIS (mechanism): volatility clustering is one of the most robust
    empirical regularities in all of finance - quiet periods follow quiet
    periods, violent ones follow violent ones, and the transition between them
    is not symmetric in time. A volatility CONTRACTION is a coiled spring:
    option sellers and market makers accumulate positions that must be hedged
    when range expands, which mechanically amplifies the first real move out of
    the range. The direction is unknowable in advance; the expansion is not.

    Note this trades the SAME direction as the breakout, so it is a cousin of D1
    - the distinguishing feature is the entry CONDITION (vol at a local floor)
    rather than the exit. Its overlap with D1 is measured, not assumed.

    RULES: when `vol_n`-day realized vol sits in the bottom `pct` of its own
    trailing year, arm the setup; take the first close outside the `n`-day range
    in either direction. ATR stop, `max_hold` timeout.
    """
    vol_n, pct, n, atr_mult, max_hold = (params['vol_n'], params['pct'], params['n'],
                                         params['atr_mult'], params['max_hold'])

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'vol' not in state:
                c = [b['c'] for b in bars]
                state['vol'] = engine.logret_vol_series(c, vol_n)
                state['hh'] = engine.rolling_max([b['h'] for b in bars], n)
                state['ll'] = engine.rolling_min([b['l'] for b in bars], n)
                state['atr'] = engine.atr_series(bars, 14)
            if i < 260:
                return None
            if pos is not None:
                if i - pos['entry_i'] >= max_hold:
                    return {'exit': True, 'reason': 'timeout'}
                return None
            vol, atr = state['vol'][i], state['atr'][i]
            hh, ll = state['hh'][i - 1], state['ll'][i - 1]
            if None in (vol, atr, hh, ll):
                return None
            hist = [v for v in state['vol'][i - 252:i + 1] if v is not None]
            if len(hist) < 100:
                return None
            floor = sorted(hist)[int(len(hist) * pct)]
            if vol > floor:
                return None            # not compressed
            px = bars[i]['c']
            if px > hh:
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'expansion out of vol squeeze (up)'}
            if px < ll:
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'expansion out of vol squeeze (down)'}
            return None
        return sig
    return factory


# ---------------------------------------------------------------- D5
def btc_leadlag(params):
    """
    D5 BTC LEAD-LAG.

    HYPOTHESIS (mechanism): information and capital enter crypto through BTC
    first - it has the deepest book, the institutional products, and the macro
    correlation. Altcoins are higher-beta claims on the same risk factor, held
    by a slower and more retail base. So a decisive BTC move should be followed
    by a larger same-direction alt move with a lag of roughly a day.

    This is the one strategy here with a genuine prior AGAINST it: lead-lag at
    daily frequency is the most obvious thing an arbitrageur would remove, and
    if it survives on 2023-2026 data that is more likely to mean I have made an
    error than that I have found free money. Included precisely because it is a
    strong, falsifiable claim - and because a negative result on it is worth as
    much as a positive one.

    RULES: when BTC's `look`-day return exceeds `thresh` sigma of its own
    trailing distribution, take the same direction on the alt next bar. Exit on
    `hold` day timeout or ATR stop. Not applicable to BTC itself.
    """
    look, thresh, hold, atr_mult = (params['look'], params['thresh'],
                                    params['hold'], params['atr_mult'])
    btc_bars = params['btc_bars']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'btc' not in state:
                bt = {b['t']: b['c'] for b in btc_bars}
                closes = [bt.get(b['t']) for b in bars]
                # forward-fill only from the PAST; never from the future
                for k in range(1, len(closes)):
                    if closes[k] is None:
                        closes[k] = closes[k - 1]
                state['btc'] = closes
                rets = [None] * len(closes)
                for k in range(look, len(closes)):
                    if closes[k] and closes[k - look]:
                        rets[k] = (closes[k] - closes[k - look]) / closes[k - look]
                state['brets'] = rets
                state['bsd'] = engine.stdev_series([r if r is not None else 0.0 for r in rets], 60)
                state['atr'] = engine.atr_series(bars, 14)
            if pos is not None:
                if i - pos['entry_i'] >= hold:
                    return {'exit': True, 'reason': 'timeout'}
                return None
            r, sd, atr = state['brets'][i], state['bsd'][i], state['atr'][i]
            if None in (r, sd, atr) or sd <= 0:
                return None
            px = bars[i]['c']
            if r > thresh * sd:
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'BTC {}d +{:.1f}sd'.format(look, r / sd)}
            if r < -thresh * sd:
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'BTC {}d {:.1f}sd'.format(look, r / sd)}
            return None
        return sig
    return factory
