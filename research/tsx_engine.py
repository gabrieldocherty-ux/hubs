"""
Long/flat backtest engine for a Wealthsimple TSX account, plus the return
decomposition every equity desk starts from.

CONSTRAINTS BAKED IN, because they are the account's, not preferences:
  * Position is in [0, 1]. NO SHORTING - Wealthsimple offers none.
  * NO LEVERAGE.
  * Cost is charged on TURNOVER, per instrument, from tsx_data.cost_model.
  * Signals use data through day t-1 and trade at day t. A signal computed from
    day t's close that trades at day t's close is not implementable without a
    time machine, and it is the single easiest way to fabricate an edge.

THE DECOMPOSITION. A daily bar contains two entirely different return streams and
mixing them hides where the money is:

    OVERNIGHT   close[t-1] -> open[t]     the gap, earned while the market is shut
    INTRADAY    open[t]    -> close[t]    earned while it is open
    TOTAL       close[t-1] -> close[t]    what buy-and-hold gets

They are not the same size and, in most equity markets studied, they are not even
the same sign. That is a structural fact about who holds risk when, and it is the
basis of the only genuinely fast strategy this account can execute - so it is
measured first, before any strategy is proposed on top of it.
"""
import sys

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data


def overnight_returns(bars):
    """close[t-1] -> open[t]. What you earn holding only while the market is shut."""
    return [(bars[i]['o'] - bars[i - 1]['c']) / bars[i - 1]['c']
            for i in range(1, len(bars))]


def intraday_returns(bars):
    """open[t] -> close[t]. What you earn holding only while it is open."""
    return [(bars[i]['c'] - bars[i]['o']) / bars[i]['o'] for i in range(1, len(bars))]


def total_returns(bars):
    """close[t-1] -> close[t]. Buy and hold."""
    return [(bars[i]['c'] - bars[i - 1]['c']) / bars[i - 1]['c']
            for i in range(1, len(bars))]


def dates(bars):
    return [b['d'] for b in bars[1:]]


def run(weights, rets, cost_rt, start_w=0.0):
    """Apply a weight series to a return series, charging cost on turnover.

    weights[i] is the exposure held over period i, and must have been decided
    using information available BEFORE period i. Cost is charged on the change in
    weight: going 0 -> 1 pays half a round trip (one side), and 1 -> 0 pays the
    other half, so a full in-and-out cycle costs exactly one round trip.
    """
    out = []
    prev = start_w
    for i, w in enumerate(weights):
        turn = abs(w - prev)
        out.append(w * rets[i] - turn * (cost_rt / 2.0))
        prev = w
    return out


def turnover_per_year(weights, periods=inst.TRADING_DAYS):
    if len(weights) < 2:
        return 0.0
    t = sum(abs(weights[i] - weights[i - 1]) for i in range(1, len(weights)))
    return t / (len(weights) / periods)


def lag(signal, k=1):
    """Shift a signal forward so period i uses only information through i-k.
    Every strategy here passes its raw signal through this."""
    return [0.0] * k + list(signal[:-k]) if k else list(signal)


def sma(xs, n):
    out, s = [], 0.0
    for i, x in enumerate(xs):
        s += x
        if i >= n:
            s -= xs[i - n]
        out.append(s / n if i >= n - 1 else None)
    return out


def rolling_vol(rets, n):
    import statistics as st
    out = []
    for i in range(len(rets)):
        if i < n - 1:
            out.append(None)
        else:
            w = rets[i - n + 1:i + 1]
            out.append(st.pstdev(w) if len(w) > 1 else None)
    return out


if __name__ == '__main__':
    print('=' * 110)
    print('RETURN DECOMPOSITION: where does the money actually get made?')
    print('  Annualised, gross of all costs. This is a property of the market,')
    print('  not a strategy - it says which hours are worth being exposed to.')
    print('=' * 110)
    print('  {:10} {:>6} {:>11} {:>11} {:>11} {:>9} {:>9} {:>9}'.format(
        'symbol', 'yrs', 'TOTAL', 'OVERNIGHT', 'INTRADAY', 'ON Sh', 'ID Sh', 'ON share'))
    print('  ' + '-' * 96)

    for sym in ['XIU.TO', 'XIC.TO', 'VFV.TO', 'ZSP.TO', 'XQQ.TO', 'ZQQ.TO',
                'ZEB.TO', 'XFN.TO', 'XEG.TO', 'XGD.TO', 'HXT.TO', 'XEF.TO']:
        try:
            bars = tsx_data.get(sym)
        except Exception:
            continue
        if len(bars) < 500:
            continue
        tot, on, idy = total_returns(bars), overnight_returns(bars), intraday_returns(bars)
        c_t, c_on, c_id = inst.cagr(tot), inst.cagr(on), inst.cagr(idy)
        share = (c_on / c_t) if c_t else 0.0
        print('  {:10} {:>6.1f} {:>11} {:>11} {:>11} {:>9} {:>9} {:>9}'.format(
            sym, len(bars) / 252.0, '{:+.2%}'.format(c_t), '{:+.2%}'.format(c_on),
            '{:+.2%}'.format(c_id), '{:.2f}'.format(inst.sharpe(on)),
            '{:.2f}'.format(inst.sharpe(idy)),
            '{:.0%}'.format(share) if c_t else '-'))

    print("""
  HOW TO READ THIS. 'ON share' is the fraction of buy-and-hold's total return that
  was earned overnight. Values near or above 100% mean the intraday session
  contributed nothing or was negative - i.e. all of the compensation for holding
  the asset was paid while the market was closed.

  If that holds here it is the basis of a genuinely fast strategy: hold only
  overnight, sit in cash all day. It is also the one high-frequency idea this
  account can actually execute, since it needs no shorting and no leverage.

  It is NOT free money, and the mechanism says why: overnight is when you cannot
  react. The market is shut, news arrives, and you carry gap risk with no ability
  to hedge or exit. That is a real risk premium being paid for a real risk borne,
  which is exactly what a durable edge should look like - and it means the
  drawdowns, when they come, arrive as gaps you could not have avoided.

  The costs to beat, per round trip, are in tsx_data.py: 3.8bp on XIU.TO and
  1.1bp on VFV.TO. An every-day strategy pays that ~252 times a year.""")
