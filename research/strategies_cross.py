"""
CROSS-SECTIONAL FAMILY - the honest answer to "the macro family is one bet".

The overlap check proved every directional trend variant is 0.73-1.00 correlated
with every other, and the yearly breakdown showed that single bet's edge
collapsing after 2023. Adding a seventh trend variant would not fix either
problem. These two strategies are structurally different because their P&L does
not come from the market going up or down at all - it comes from the SPREAD
between coins. In a flat market both still have something to trade.

Both need every coin's data at once, so the cross-sectional rank is computed
from a timestamp-aligned view built strictly from bars at or before the current
one.
"""
import sys
sys.path.insert(0, 'research')
import engine


def _align(bars, other_bars):
    """Map this coin's bar index -> other coin's close at the same timestamp,
    forward-filled from the PAST only (never from a future bar)."""
    ob = {b['t']: b['c'] for b in other_bars}
    out, last = [], None
    for b in bars:
        v = ob.get(b['t'])
        if v is not None:
            last = v
        out.append(last)
    return out


def xs_momentum(params):
    """
    M6 CROSS-SECTIONAL MOMENTUM (relative strength).

    HYPOTHESIS (mechanism): capital inside crypto rotates rather than arriving
    and leaving all at once. When a narrative takes hold, flows concentrate into
    the coins already outperforming, and that concentration persists for weeks
    because the marginal buyer is slow (retail reallocating, funds rebalancing).
    The claim here is about RELATIVE performance between coins, which means the
    P&L is roughly market-neutral: being long the strongest and short the
    weakest pays off in a flat tape and even in a falling one, provided
    dispersion exists.

    This is the classic Jegadeesh-Titman construction, which is the most
    replicated cross-sectional anomaly in equities. Whether four perps is enough
    breadth for it to work is exactly the open question - with a universe this
    small the ranks are noisy, and that is a real limitation, not a detail.

    RULES: rank the available coins by trailing `look`-day return. Long if this
    coin is the strongest, short if it is the weakest, flat otherwise. Rebalance
    is implicit (the position changes when the rank changes). ATR stop.
    """
    look, atr_mult = params['look'], params['atr_mult']
    peers = params['peers']          # {coin: bars}

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'peer' not in state:
                state['peer'] = {c: _align(bars, b) for c, b in peers.items()}
                state['atr'] = engine.atr_series(bars, 14)
            atr = state['atr'][i]
            if atr is None or i < look + 1:
                return None
            rets = {}
            for c, closes in state['peer'].items():
                now, then = closes[i], closes[i - look]
                if now and then:
                    rets[c] = (now - then) / then
            if len(rets) < 3:
                return None
            me = params['self_coin']
            if me not in rets:
                return None
            order = sorted(rets, key=lambda k: -rets[k])
            px = bars[i]['c']
            if order[0] == me:
                want = 'long'
            elif order[-1] == me:
                want = 'short'
            else:
                return {'exit': True, 'reason': 'no longer an extreme'} if pos else None
            if pos is not None and pos['dir'] == want:
                return None
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': 'xs-mom rank {} of {}'.format(order.index(me) + 1, len(order))}
        return sig
    return factory


def carry_spread(params):
    """
    M7 CROSS-SECTIONAL FUNDING CARRY.

    HYPOTHESIS (mechanism): funding differs between coins at the same moment
    because positioning differs between coins. Being short the highest-funding
    perp and long the lowest-funding one collects that spread as a REAL CASH
    FLOW every hour the position is held - it does not require any price
    prediction to be correct. This is the perp-market version of a carry trade,
    and carry is one of the few return sources that is structurally distinct
    from momentum rather than a repackaging of it.

    The obvious risk, stated plainly: carry trades famously "go up by the stairs
    and down by the elevator". Collecting a small steady payment while carrying
    directional risk works until the crowded side unwinds violently, which is
    exactly when the loss arrives. So the ATR stop here is not a formality - it
    is the entire defence, and any version of this that looks good WITHOUT a
    stop should be distrusted.

    Note the difference from D3, which failed: D3 bet that extreme funding
    PREDICTS PRICE. This one does not predict price at all - it collects the
    funding and hedges the direction across coins. Those are different claims,
    and D3's failure is not evidence against this one.

    RULES: short the coin with the highest trailing-`fund_n`-day funding, long
    the one with the lowest, flat otherwise. Requires a minimum spread
    (`min_spread`, annualized) so it does not trade noise.
    """
    fund_n, atr_mult, min_spread = params['fund_n'], params['atr_mult'], params['min_spread']
    peer_funding = params['peer_funding']      # {coin: FundingCurve}
    me = params['self_coin']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'f' not in state:
                state['f'] = {c: engine.funding_annualized_series(
                    bars, fc, lookback_hours=fund_n * 24) for c, fc in peer_funding.items()}
                state['atr'] = engine.atr_series(bars, 14)
            atr = state['atr'][i]
            if atr is None:
                return None
            vals = {c: s[i] for c, s in state['f'].items() if s[i] is not None}
            if len(vals) < 3 or me not in vals:
                return None
            order = sorted(vals, key=lambda k: -vals[k])
            spread = vals[order[0]] - vals[order[-1]]
            if spread < min_spread:
                return {'exit': True, 'reason': 'spread too thin'} if pos else None
            px = bars[i]['c']
            if order[0] == me:
                want = 'short'       # pays the most funding -> short it, receive
            elif order[-1] == me:
                want = 'long'        # pays the least/receives -> long it
            else:
                return {'exit': True, 'reason': 'not an extreme'} if pos else None
            if pos is not None and pos['dir'] == want:
                return None
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': 'carry {} spread {:+.0f}%/yr'.format(want, spread * 100)}
        return sig
    return factory
