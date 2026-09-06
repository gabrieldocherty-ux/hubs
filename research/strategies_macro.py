"""
MACRO / TREND FAMILY - daily bars, 1-2 month intended holding horizon.

Every strategy here carries a stated mechanism. "This parameter combination
backtested well" is not a hypothesis and does not qualify. Parameters are taken
from published convention where one exists (Turtle 55/20, golden cross 50/200,
TSMOM 60-90d) rather than fitted, precisely so the neighbourhood test in
validate.py is measuring robustness and not measuring my own curve fitting.

All of these hold through funding periods, so real funding cost is charged.
"""
import sys
sys.path.insert(0, 'research')
import engine


# ---------------------------------------------------------------- M1
def tsmom(params):
    """
    M1 TIME-SERIES MOMENTUM.

    HYPOTHESIS (mechanism): time-series momentum is the most heavily documented
    anomaly in futures markets (Moskowitz/Ooi/Pedersen 2012, 58 instruments,
    25 years). The mechanism is under-reaction to slowly-diffusing information
    plus positive-feedback flows from trend followers who scale in as a move
    matures. Crypto perps should express it strongly: retail-dominated, no
    valuation anchor to pull price back, and highly reflexive leverage flows.

    RULES: go long if the trailing `look`-day return is positive, short if
    negative. Re-evaluated daily; the position only changes when the sign of
    that trailing return flips, which is what produces a multi-week hold.
    Stop = `atr_mult` x ATR(14) from entry - volatility-scaled, not a flat %,
    so the stop means the same thing in a calm and a violent regime.
    """
    look = params['look']
    atr_mult = params['atr_mult']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if i < look + 1:
                return None
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
            atr = state['atr'][i]
            if atr is None:
                return None
            px = bars[i]['c']
            ret = (px - bars[i - look]['c']) / bars[i - look]['c']
            want = 'long' if ret > 0 else 'short'
            if pos is not None and pos['dir'] == want:
                return None
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': 'TSMOM {}d ret {:+.1%}'.format(look, ret)}
        return sig
    return factory


# ---------------------------------------------------------------- M2
def golden_cross(params):
    """
    M2 LONG-HORIZON MA REGIME (golden / death cross).

    HYPOTHESIS (mechanism): same under-reaction/flow mechanism as M1, but the
    double-smoothing suppresses the whipsaw that kills raw momentum in choppy
    regimes - you trade the regime, not the wiggle. This project already found
    SMA(50,200) strongly positive on BOTH halves of 55 years of Nasdaq
    Composite data (vault, 2026-09-04 update 8) while faster variants decayed
    train->test, which is direct evidence the 50/200 setting is not a crypto-
    specific curve fit. Testing whether the same structure holds on crypto.

    RULES: long while SMA(fast) > SMA(slow), short while below. Volatility-
    scaled stop. Deliberately slow: this should hold for months.
    """
    fast, slow, atr_mult = params['fast'], params['slow'], params['atr_mult']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'f' not in state:
                c = [b['c'] for b in bars]
                state['f'] = engine.sma_series(c, fast)
                state['s'] = engine.sma_series(c, slow)
                state['atr'] = engine.atr_series(bars, 14)
            f, s, atr = state['f'][i], state['s'][i], state['atr'][i]
            if None in (f, s, atr):
                return None
            want = 'long' if f > s else 'short'
            if pos is not None and pos['dir'] == want:
                return None
            px = bars[i]['c']
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': 'SMA{}/{} regime {}'.format(fast, slow, want)}
        return sig
    return factory


# ---------------------------------------------------------------- M3
def donchian_turtle(params):
    """
    M3 DONCHIAN BREAKOUT (Turtle-style), daily.

    HYPOTHESIS (mechanism): a break of a long-established range is where
    resting stop and liquidation orders are concentrated. On a leveraged perp
    venue that clustering is not folklore - liquidation engines mechanically
    convert a range break into further forced flow in the same direction.
    Additionally a multi-month range break is the point at which slower
    participants are forced to re-price, so information gets impounded over
    weeks rather than instantly.

    NOTE: this project previously rejected Donchian(55) on 4h BARS. That is a
    different test - at 4h the same channel fires on intraday noise and pays
    the round-trip cost far more often. This is the daily-bar version with an
    ATR trailing exit, which is what the Turtle system actually specified.

    RULES: long on close above the `entry_n`-day high, short below the
    `entry_n`-day low. Exit on the opposite `exit_n`-day channel (trailing),
    with a hard ATR stop underneath as the mandatory risk rail.
    """
    entry_n, exit_n, atr_mult = params['entry_n'], params['exit_n'], params['atr_mult']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'hh' not in state:
                h = [b['h'] for b in bars]
                l = [b['l'] for b in bars]
                state['hh'] = engine.rolling_max(h, entry_n)
                state['ll'] = engine.rolling_min(l, entry_n)
                state['xh'] = engine.rolling_max(h, exit_n)
                state['xl'] = engine.rolling_min(l, exit_n)
                state['atr'] = engine.atr_series(bars, 20)
            if i < 1:
                return None
            hh, ll = state['hh'][i - 1], state['ll'][i - 1]
            atr = state['atr'][i]
            if None in (hh, ll, atr):
                return None
            px = bars[i]['c']

            if pos is not None:
                xh, xl = state['xh'][i - 1], state['xl'][i - 1]
                if pos['dir'] == 'long' and xl is not None and px < xl:
                    return {'exit': True, 'reason': 'donchian trail exit'}
                if pos['dir'] == 'short' and xh is not None and px > xh:
                    return {'exit': True, 'reason': 'donchian trail exit'}
                return None

            if px > hh:
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'break {}d high'.format(entry_n)}
            if px < ll:
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'break {}d low'.format(entry_n)}
            return None
        return sig
    return factory


# ---------------------------------------------------------------- M4
def vol_target_trend(params):
    """
    M4 VOLATILITY-REGIME-FILTERED TREND.

    HYPOTHESIS (mechanism): the trend edge is real but its risk is wildly
    non-stationary, and trend-following performs badly when realized vol is
    exploding (that is when moves are liquidation-driven noise rather than
    directional information). Rather than scale size - which the risk manager
    owns, not the strategy - this simply declines to hold a trend position
    while realized volatility is in its own top decile.

    This is the one honest way a strategy can express "risk framing" without
    touching the sizing rails: it changes WHEN it is in the market, not HOW BIG.

    RULES: M1's trend signal, gated off when trailing `vol_n`-day realized vol
    exceeds its own trailing `vol_pctile` percentile over the past year.
    """
    look, atr_mult = params['look'], params['atr_mult']
    vol_n, pct = params['vol_n'], params['vol_pctile']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'vol' not in state:
                c = [b['c'] for b in bars]
                state['vol'] = engine.logret_vol_series(c, vol_n)
                state['atr'] = engine.atr_series(bars, 14)
            if i < look + 260:
                return None
            vol, atr = state['vol'][i], state['atr'][i]
            if None in (vol, atr):
                return None
            hist = [v for v in state['vol'][i - 252:i + 1] if v is not None]
            if len(hist) < 100:
                return None
            hist_sorted = sorted(hist)
            thresh = hist_sorted[min(len(hist_sorted) - 1, int(len(hist_sorted) * pct))]
            if vol > thresh:
                return {'exit': True, 'reason': 'vol regime too hot'} if pos else None
            px = bars[i]['c']
            ret = (px - bars[i - look]['c']) / bars[i - look]['c']
            want = 'long' if ret > 0 else 'short'
            if pos is not None and pos['dir'] == want:
                return None
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': 'trend {} in calm vol'.format(want)}
        return sig
    return factory


# ---------------------------------------------------------------- M5
def funding_regime(params):
    """
    M5 FUNDING-REGIME TREND.

    HYPOTHESIS (mechanism): perp funding is the price of leveraged directional
    exposure and is paid in real cash. Sustained positive funding means longs
    are persistently willing to pay to be long - a revealed-preference measure
    of structural demand that, unlike a sentiment survey, costs money to fake.
    Sustained negative funding is the mirror image. The claim is that the SIGN
    of the multi-week funding trend identifies the macro regime.

    This is deliberately a different information source from every price-based
    strategy in this file, which is the point: if it works, it diversifies.

    RULES: long when trailing `fund_n`-day average funding is positive AND
    price is above its `trend_n`-day average (funding alone is too slow to time
    entry); short when both are negative. ATR stop.
    """
    fund_n, trend_n, atr_mult = params['fund_n'], params['trend_n'], params['atr_mult']
    fcurve = params['funding']          # injected by the runner; this strategy needs it

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'ma' not in state:
                c = [b['c'] for b in bars]
                state['ma'] = engine.sma_series(c, trend_n)
                state['atr'] = engine.atr_series(bars, 14)
                state['fund'] = engine.funding_annualized_series(
                    bars, fcurve, lookback_hours=fund_n * 24)
            ma, atr, fnd = state['ma'][i], state['atr'][i], state['fund'][i]
            if None in (ma, atr, fnd):
                return None
            px = bars[i]['c']
            if fnd > 0 and px > ma:
                want = 'long'
            elif fnd < 0 and px < ma:
                want = 'short'
            else:
                return {'exit': True, 'reason': 'funding/trend disagree'} if pos else None
            if pos is not None and pos['dir'] == want:
                return None
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': 'funding {:+.0f}%/yr + trend'.format(fnd * 100)}
        return sig
    return factory


MACRO = {
    'M1_tsmom': (tsmom, {'look': 60, 'atr_mult': 4.0},
                 {'look': [40, 50, 75, 90, 120], 'atr_mult': [3.0, 5.0, 6.0]}),
    'M2_golden_cross': (golden_cross, {'fast': 50, 'slow': 200, 'atr_mult': 4.0},
                        {'fast': [30, 40, 60, 75], 'slow': [150, 175, 225, 250],
                         'atr_mult': [3.0, 5.0]}),
    'M3_donchian': (donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0},
                    {'entry_n': [40, 45, 65, 80], 'exit_n': [15, 25, 30],
                     'atr_mult': [2.0, 4.0]}),
    'M4_vol_trend': (vol_target_trend,
                     {'look': 60, 'atr_mult': 4.0, 'vol_n': 20, 'vol_pctile': 0.90},
                     {'look': [45, 75, 90], 'vol_pctile': [0.80, 0.85, 0.95],
                      'vol_n': [15, 30]}),
    'M5_funding_regime': (funding_regime, {'fund_n': 14, 'trend_n': 50, 'atr_mult': 4.0},
                          {'fund_n': [7, 21, 30], 'trend_n': [30, 70, 100],
                           'atr_mult': [3.0, 5.0]}),
}
