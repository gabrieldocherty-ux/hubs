r"""
B1 loses when it is short into a rally. Should it take that trade at all?

THE MECHANISM, STATED BEFORE ANY NUMBER.
B1 shorts when the perp sits rich to spot at the 90th percentile of its own
trailing window. The trade is supposed to pay because the premium reverts. But B1
emits ONE perp leg - no spot leg - so what actually pays is the PERP PRICE going
down, and the premium can revert perfectly well while price rises: spot simply
rises faster. That is not a hypothetical. It is B1's recorded failure mode:

  - 2026H2: the trigger fired short on 35 of 38 signals, short share went 48% ->
    84%, into rallies of +30% (BTC) to +53% (ETH). Expectancy -2.60%.
  - The live paper account: HYPE short at 77.499, exited 85.209, -9.95%, reason
    "basis_normalised". The basis did revert. The trade still lost badly.
  - In backtest, 9 stop-outs average -11.38% and destroy roughly a third of gross.

So the hypothesis is specific and falsifiable: A RICH BASIS IN A STRONG UPTREND IS
MORE LIKELY TO RESOLVE BY PRICE CONTINUING UP THAN BY THE PERP FALLING BACK. If
that is true, suppressing the short when trend is strongly against it should
remove a chunk of the left tail without removing much of the edge. If it is false,
the filter will cut winners in proportion and expectancy will barely move - which
is the outcome that kills the idea, and it gets reported either way.

WHAT WOULD MAKE THIS OVERFITTING, and how it is avoided. Adding a trend filter to
a counter-trend rule is a standard move, which means it is also a standard way to
manufacture a backtest. Guards: the mechanism above was written first; ONE filter
family is tested, not a search over indicators; the same filter is applied on both
sides rather than tuned per-side; a handful of lookbacks are shown together so the
shape is visible rather than the best cell; and anything that survives goes through
research/gate.py, which asks the money question before anything else.

    python research/b1_trend_filter.py
"""
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import engine
import hl_data
import institutional as inst
import pooled
import tsx_engine as teng
from strategies_basis import build_basis

COINS = ['BTC', 'ETH', 'HYPE']
SPOT = {'BTC': '@142', 'ETH': '@151', 'SOL': '@156', 'HYPE': '@107'}
BASE = {'pct': 0.90, 'win': 180, 'atr_mult': 2.5, 'max_hold': 7, 'min_hist': 60}


def b1_filtered(params, trend_n=0):
    """B1, optionally refusing the side that fights a trend of length trend_n.

    trend_n = 0 disables the filter and reproduces the shipped rule exactly.
    The test is symmetric: shorts are refused above the average, longs below it.
    Refusing only the losing side would be fitting to the outcome.
    """
    pct, win, atr_mult = params['pct'], params['win'], params['atr_mult']
    max_hold, min_hist = params['max_hold'], params.get('min_hist', 60)
    basis = params['basis']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
                state['ma'] = (teng.sma([b['c'] for b in bars], trend_n)
                               if trend_n else None)
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
            # trend_n = 0 disables the filter, so NOTHING is refused. This read
            # up = dn = True, which refused BOTH sides and produced a baseline of
            # zero trades - the missing row that gave it away.
            up = dn = False
            if trend_n:
                ma = state['ma'][i]
                if ma is None:
                    return None
                up = px > ma          # trend is UP: refuse the short
                dn = px < ma          # trend is DOWN: refuse the long
            if b >= hi and not up:
                return {'dir': 'short', 'stop': px + atr_mult * atr,
                        'target': None, 'reason': 'rich'}
            if b <= lo and not dn:
                return {'dir': 'long', 'stop': px - atr_mult * atr,
                        'target': None, 'reason': 'cheap'}
            return None
        return sig
    return factory


def load(coin):
    bars, fund = pooled.load(coin, False)
    spot, _ = hl_data.get_candles(SPOT[coin], '1d', 1200)
    basis = build_basis(bars, spot)
    first = next((i for i, b in enumerate(basis) if b is not None), 0)
    return bars[first:], basis[first:], fund


def run(trend_n):
    trades = []
    for c in COINS:
        bars, basis, fund = load(c)
        p = dict(BASE)
        p['basis'] = basis
        r = engine.backtest(bars, b1_filtered(p, trend_n)(), c, fund,
                            name='b1', warmup=p['min_hist'])
        trades += r.trades
    if not trades:
        return None
    pnl = [t.pnl_pct for t in trades]
    sp = sorted(pnl)
    k = max(1, int(len(pnl) * 0.05))
    sl = [t.pnl_pct for t in trades if t.exit_reason == 'stop_loss']
    shorts = [t.pnl_pct for t in trades if t.direction == 'short']
    longs = [t.pnl_pct for t in trades if t.direction == 'long']
    return {'n': len(trades), 'exp': st.mean(pnl),
            'trim': st.mean(sp[k:-k]) if len(sp) > 2 * k else st.mean(sp),
            'wr': sum(1 for t in trades if t.won) / len(trades),
            'total': sum(pnl), 'worst': min(pnl),
            'n_stop': len(sl), 'stop_mean': st.mean(sl) if sl else 0.0,
            'n_short': len(shorts), 'short_exp': st.mean(shorts) if shorts else 0.0,
            'n_long': len(longs), 'long_exp': st.mean(longs) if longs else 0.0}


if __name__ == '__main__':
    print('B1 + TREND FILTER. Refuse the side that fights the trend.')
    print('Mechanism stated in the docstring, before these numbers. Symmetric filter.')
    print()
    print('{:<14}{:>6}{:>11}{:>11}{:>8}{:>11}{:>9}{:>11}'.format(
        'filter', 'n', 'exp/trade', 'trimmed', 'win%', 'TOTAL', 'stops', 'worst'))
    print('-' * 82)
    rows = []
    for tn in (0, 20, 50, 100, 200):
        r = run(tn)
        if not r:
            continue
        rows.append((tn, r))
        print('{:<14}{:>6}{:>11}{:>11}{:>8}{:>11}{:>9}{:>11}'.format(
            'none (shipped)' if tn == 0 else 'SMA{}'.format(tn), r['n'],
            '{:+.3%}'.format(r['exp']), '{:+.3%}'.format(r['trim']),
            '{:.0%}'.format(r['wr']), '{:+.1%}'.format(r['total']),
            '{} @ {:+.1%}'.format(r['n_stop'], r['stop_mean']),
            '{:+.1%}'.format(r['worst'])))

    print()
    print('  SIDE BREAKDOWN - the filter is supposed to act on the SHORT side')
    print('  {:<14}{:>10}{:>13}{:>10}{:>13}'.format(
        'filter', 'n short', 'short exp', 'n long', 'long exp'))
    print('  ' + '-' * 60)
    for tn, r in rows:
        print('  {:<14}{:>10}{:>13}{:>10}{:>13}'.format(
            'none' if tn == 0 else 'SMA{}'.format(tn), r['n_short'],
            '{:+.3%}'.format(r['short_exp']), r['n_long'],
            '{:+.3%}'.format(r['long_exp'])))
    print()
    print('  READ IT THIS WAY. If the filter works, TOTAL should hold up while the')
    print('  worst trade and the stop-out damage shrink. If expectancy per trade is')
    print('  flat and TOTAL just falls with the trade count, the filter is cutting')
    print('  winners and losers in equal proportion and there is nothing here.')
