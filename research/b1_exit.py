r"""
B1 exits on the BASIS. Its P&L is the PRICE. Are those the same thing?

THE MECHANISM ARGUMENT, STATED BEFORE ANY NUMBER IS COMPUTED.
core/strategies/basis_dislocation.py and research/strategies_basis.py both exit a
position when "the basis reverts past its trailing median". But B1 emits ONE perp
leg - no spot leg, no hedge - so its profit and loss is the perp PRICE move.
Regressing trade P&L on the signed spot move over the hold gives R^2 = 0.982.

So the exit rule keys on a variable that is not what pays. Two possibilities, and
they have opposite consequences:

  A. THE BASIS IS INFORMATIVE ABOUT FUTURE PRICE. Then normalisation genuinely
     means the move is over, the exit is doing real work, and removing it should
     make things worse.
  B. THE BASIS IS ORTHOGONAL TO P&L ONCE THE POSITION IS OPEN. Then the exit is
     firing on noise: it cuts winners and holds losers at random, and it charges
     a round trip every time it does. Removing it should be neutral-to-better,
     and the trades it currently ends early should show no systematic difference
     from the ones it lets run.

THIS IS NOT AN IDLE QUESTION. Of the four closed paper trades on the live account,
THREE are B1 and all three exited on `basis_normalised` - the signal did exactly
what it was designed to do and the trade still lost:

    HYPE long   entry 83.223   exit 79.0105   -5.06%   basis_normalised
    ETH  long   entry 2477.6   exit 2407.05   -2.85%   basis_normalised
    HYPE short  entry 77.499   exit 85.209    -9.95%   basis_normalised

DISCIPLINE, because this is exactly where overfitting enters. Three variants are
tested, not thirty; the hypothesis was written above before any was run; and the
result is reported whether it helps or not. A variant that wins is then put
through research/gate.py, which asks the money question before anything else.

    python research/b1_exit.py
"""
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import engine
import hl_data
import institutional as inst
import pooled
from strategies_basis import build_basis

COINS = ['BTC', 'ETH', 'HYPE']          # B1 does not work on SOL
SPOT = {'BTC': '@142', 'ETH': '@151', 'SOL': '@156', 'HYPE': '@107'}
BASE = {'pct': 0.90, 'win': 180, 'atr_mult': 2.5, 'max_hold': 7, 'min_hist': 60}


def b1(params, use_basis_exit=True):
    """Verbatim basis_dislocation, with the basis EXIT made switchable."""
    pct, win, atr_mult = params['pct'], params['win'], params['atr_mult']
    max_hold, min_hist = params['max_hold'], params.get('min_hist', 60)
    basis = params['basis']

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
                if use_basis_exit:
                    if pos['dir'] == 'short' and b <= med:
                        return {'exit': True, 'reason': 'basis normalised'}
                    if pos['dir'] == 'long' and b >= med:
                        return {'exit': True, 'reason': 'basis normalised'}
                return None
            px = bars[i]['c']
            if b >= hi:
                return {'dir': 'short', 'stop': px + atr_mult * atr,
                        'target': None, 'reason': 'rich'}
            if b <= lo:
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


def run(label, params, use_basis_exit):
    trades = []
    for c in COINS:
        bars, basis, fund = load(c)
        p = dict(params)
        p['basis'] = basis
        r = engine.backtest(bars, b1(p, use_basis_exit)(), c, fund,
                            name=label, warmup=p.get('min_hist', 60))
        trades += r.trades
    if not trades:
        return None
    pnl = [t.pnl_pct for t in trades]
    k = max(1, int(len(pnl) * 0.05))
    sp = sorted(pnl)
    return {'label': label, 'n': len(trades),
            'exp': st.mean(pnl), 'trim': st.mean(sp[k:-k]) if len(sp) > 2 * k else st.mean(sp),
            'median': st.median(pnl),
            'wr': sum(1 for t in trades if t.won) / len(trades),
            'hold': st.mean([t.bars_held for t in trades]),
            'total': sum(pnl), 'trades': trades}


if __name__ == '__main__':
    print('B1 EXIT RULE: does exiting on the BASIS beat exiting on time alone?')
    print('Hypothesis stated in the module docstring, before these numbers.')
    print()
    print('{:<34}{:>6}{:>11}{:>11}{:>10}{:>8}{:>9}'.format(
        'variant', 'n', 'exp/trade', 'trimmed 5%', 'median', 'win%', 'avg hold'))
    print('-' * 90)
    res = []
    for label, params, bex in (
            ('A  current (basis exit, hold 7)', BASE, True),
            ('B  NO basis exit, hold 7', BASE, False),
            ('C  NO basis exit, hold 14', dict(BASE, max_hold=14), False),
            ('D  NO basis exit, hold 21', dict(BASE, max_hold=21), False)):
        r = run(label, params, bex)
        if not r:
            continue
        res.append(r)
        print('{:<34}{:>6}{:>11}{:>11}{:>10}{:>8}{:>9}'.format(
            label, r['n'], '{:+.3%}'.format(r['exp']), '{:+.3%}'.format(r['trim']),
            '{:+.3%}'.format(r['median']), '{:.0%}'.format(r['wr']),
            '{:.1f}'.format(r['hold'])))

    print()
    base = res[0]
    print('  Reference: the recorded B1 is n=178, +1.68%/trade, 54.5% win rate')
    print('  (that figure pools all four coins; this runs the three it trades live)')
    print()
    print('  WHAT ENDED THE CURRENT VERSION\'S TRADES')
    reasons = {}
    for t in base['trades']:
        g = reasons.setdefault(t.exit_reason, [])
        g.append(t.pnl_pct)
    for k, v in sorted(reasons.items(), key=lambda x: -len(x[1])):
        print('    {:<22}{:>5} trades   mean {:+.3%}   median {:+.3%}'.format(
            k, len(v), st.mean(v), st.median(v)))
    print()
    print('  If "basis normalised" trades are no better than the timeouts, the exit')
    print('  is firing on a variable that does not know whether the trade is working.')
