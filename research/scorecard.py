r"""
The book on one page, scored by the gate that matters.

Every strategy x every coin, judged first on the only question that disqualifies
outright - did it make more money than not bothering - and then on whether the
SIGNAL adds anything over a copy of itself that trades identically while looking
at nothing.

THREE OUTCOMES, NOT TWO. The distinction is the whole reason this file exists:

  BEATS      more money than holding the coin. Judge it as a strategy.
  OVERLAY    loses to holding, but beats its shuffled twin. The signal is real
             and too small to overcome the cost of reduced exposure. A legitimate
             product - it is insurance - but it must never be called alpha.
  NOTHING    loses to holding AND adds nothing over trading blindly.

The regime columns are usually the most decision-relevant thing here. A rule that
is flat most of the time has a terminal-wealth number that depends heavily on what
the market happened to do, and collapsing that to one figure is how "insurance
against falling markets" gets mistaken for "underperformance".

    python research/scorecard.py
"""
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gate
import institutional as inst
import stress
import stress_crypto as sc
import tsx_engine as eng

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']


def specs():
    import strategies_batch2 as sb2
    return {
        'S3': lambda c: (sc.market_for(c),
                         sc.weights_from(sb2.volume_spike, sc.S3P, c,
                                         sc.market_for(c)['fund'], 60)),
        'D1': lambda c: (sc.market_for(c),
                         sc.weights_from(sc.range_breakout, sc.D1P, c,
                                         sc.market_for(c)['fund'], 60)),
        'M3': lambda c: (sc.market_for(c),
                         sc.weights_from(sc.donchian_turtle, sc.M3P, c,
                                         sc.market_for(c)['fund'], sc.M3_WARMUP)),
        'B1': lambda c: (sc.basis_market_for(c), sc.basis_weights_for(c)),
    }


def classify(g):
    if g['beats_hold']:
        return 'BEATS'
    return 'overlay' if g['beats_shuffle'] else 'NOTHING'


def main():
    S = specs()
    print('=' * 100)
    print('THE CRYPTO BOOK, SCORED')
    print('=' * 100)
    print('  {:<4}{:<6}{:>10}{:>10}{:>10}{:>9}{:>8}{:>10}  {}'.format(
        '', 'coin', 'strat', 'hold', 'terminal', 'p vs shuf', 'Sharpe',
        'maxDD', 'verdict'))
    print('  ' + '-' * 94)
    tally = {}
    regimes = {}
    for nm in ('S3', 'D1', 'M3', 'B1'):
        for c in COINS:
            try:
                mk, wf = S[nm](c)
                w, r = stress._align(wf(mk), mk['ret'])
                g = gate.gate0_money(w, r, mk['rt'], draws=200)
            except Exception as e:
                print('  {:<4}{:<6} FAILED {}'.format(nm, c, str(e)[:50]))
                continue
            s = eng.run(w, r, mk['rt'])
            v = classify(g)
            tally.setdefault(nm, []).append(v)
            regimes.setdefault(nm, []).extend(g['thirds'])
            print('  {:<4}{:<6}{:>10}{:>10}{:>10}{:>9}{:>8}{:>10}  {}'.format(
                nm, c, '{:+.0%}'.format(g['strat']), '{:+.0%}'.format(g['hold']),
                '{:.0%}'.format(g['terminal']), '{:.3f}'.format(g['p_vs_shuffle']),
                '{:.2f}'.format(inst.sharpe(s)),
                '{:.0%}'.format(inst.max_drawdown(s)), v))
        print()

    print('=' * 100)
    print('  {:<6}{:>10}{:>11}{:>11}{:>34}'.format(
        'strat', 'BEATS', 'overlay', 'NOTHING', 'terminal vs hold, by regime'))
    print('  ' + '-' * 94)
    for nm in ('S3', 'D1', 'M3', 'B1'):
        t = tally.get(nm, [])
        if not t:
            continue
        rs = regimes.get(nm, [])
        up = [x['terminal'] for x in rs if x['hold'] > 0]
        dn = [x['terminal'] for x in rs if x['hold'] <= 0]
        print('  {:<6}{:>10}{:>11}{:>11}{:>34}'.format(
            nm, t.count('BEATS'), t.count('overlay'), t.count('NOTHING'),
            'rising {:.0%}  falling {:.0%}'.format(
                st.median(up) if up else 0, st.median(dn) if dn else 0)))
    print()
    print('  "rising / falling" is the MEDIAN terminal wealth against holding,')
    print('  across every third of every coin, split by what holding did in that')
    print('  stretch. It is the honest summary of what this book is for.')


if __name__ == '__main__':
    main()
