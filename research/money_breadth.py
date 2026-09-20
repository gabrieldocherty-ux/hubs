r"""
The breadth test, re-run against MONEY instead of alpha.

WHY. The trend family's headline was a breadth statistic - mean alpha t across all
60 instrument x config cells = +1.986, p = 0.0005 / 0.0040 / 0.0370 against
bootstrap nulls - and it was read as "the family has an edge everywhere, so the
single winning cell is not a fluke". Then terminal wealth was checked and **0 of
those 60 cells ever beat buy-and-hold**. A breadth statistic computed from 60
money-losing cells cannot mean what it was taken to mean.

So the same breadth question is asked again, of the only quantity that pays for
anything: log terminal wealth relative to buy-and-hold.

THE TEST THAT ACTUALLY SEPARATES THE TWO HYPOTHESES. "Loses to buy-and-hold" is
consistent with two very different worlds, and telling them apart is the point:

  A. THE SIGNAL IS WORTHLESS. Being out of the market some of the time is the
     only thing happening, and any rule with the same exposure would do as well.
  B. THE SIGNAL WORKS, BUT REDUCED EXPOSURE COSTS MORE THAN IT ADDS. The rule
     really does pick its moments, and still loses, because in a market that
     rises 10%/yr being flat 30% of the time is a 3%/yr hole the timing cannot
     fill.

These have opposite implications. Under (A) the strategy is noise and should go.
Under (B) it is a real but unlevered-unusable edge - the same conclusion the ZEB
variance-timing result reached, and worth knowing because leverage or a different
instrument could change the arithmetic.

THE SHUFFLED-TIMING NULL DISTINGUISHES THEM. Circularly rotate the weight series
by a random offset. That preserves EXACTLY: the number of switches, every block
length, the total exposure, and the autocorrelation of the position series. It
destroys ONLY the alignment between the rule and the market. So the null is "a
rule with identical trading behaviour that is not looking at anything", and the
question becomes: does the real rule beat its own shuffled twin in MONEY?

    python research/money_breadth.py
"""
import math
import random
import statistics as st
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import institutional as inst
import tsx_data
import tsx_engine as eng

SYMBOLS = ['ZEB.TO', 'XIC.TO', 'XIU.TO', 'HXT.TO', 'VFV.TO', 'ZQQ.TO']
GRID = [(n, c) for n in (50, 100, 150, 200, 250) for c in (1, 3)]
DRAWS = 400


def trend(bars, n, c):
    cl = [b['c'] for b in bars]
    ma = eng.sma(cl, n)
    raw = [0.0 if ma[i] is None else (1.0 if cl[i] > ma[i] else 0.0)
           for i in range(len(bars))]
    if c > 1:
        raw = [1.0 if i + 1 >= c and all(x == 1.0 for x in raw[i - c + 1:i + 1])
               else 0.0 for i in range(len(raw))]
    return raw[:len(bars) - 1]


def logwealth(rets):
    t = 0.0
    for r in rets:
        t += math.log1p(r) if r > -1 else -20.0
    return t


def rotate(w, k):
    k %= len(w)
    return w[-k:] + w[:-k] if k else list(w)


def main():
    rng = random.Random(20260920)
    print('BREADTH ON MONEY, not on alpha.')
    print('Relative log wealth = log(strategy) - log(buy and hold). Negative means')
    print('it lost to simply owning the thing.')
    print()
    print('{:<9}{:<11}{:>10}{:>11}{:>12}{:>11}{:>9}'.format(
        'symbol', 'cell', 'rel log', 'terminal', 'shuffle med', 'beats shuf', 'p'))
    print('-' * 74)
    rows = []
    for sym in SYMBOLS:
        bars = tsx_data.get(sym)
        bh = eng.total_returns(bars)
        rt = tsx_data.cost_model(sym, bars)[0]
        lb = logwealth(bh)
        for (n, c) in GRID:
            w = trend(bars, n, c)
            m = min(len(w), len(bh))
            w, r = w[:m], bh[:m]
            s = eng.run(w, r, rt)
            rel = logwealth(s) - logwealth(r)
            null = []
            for _ in range(DRAWS):
                ws = rotate(w, rng.randrange(m))
                null.append(logwealth(eng.run(ws, r, rt)) - logwealth(r))
            null.sort()
            p = (sum(1 for v in null if v >= rel) + 1) / (len(null) + 1)
            med = st.median(null)
            rows.append((sym, n, c, rel, math.exp(rel), med, p))
            print('{:<9}{:<11}{:>10}{:>11}{:>12}{:>11}{:>9}'.format(
                sym, 'SMA{} x{}'.format(n, c), '{:+.4f}'.format(rel),
                '{:.1%}'.format(math.exp(rel)), '{:+.4f}'.format(med),
                'YES' if rel > med else 'no', '{:.3f}'.format(p)))

    print()
    print('=' * 74)
    beat_bh = sum(1 for r in rows if r[3] > 0)
    beat_sh = sum(1 for r in rows if r[3] > r[5])
    sig = sum(1 for r in rows if r[6] < 0.05)
    print('  cells beating BUY AND HOLD in money:      {:>2} of {}'.format(beat_bh, len(rows)))
    print('  cells beating their own SHUFFLED twin:    {:>2} of {}'.format(beat_sh, len(rows)))
    print('  cells doing so at p < 0.05:               {:>2} of {}'.format(sig, len(rows)))
    print()
    print('  mean relative log wealth: {:+.4f}  (= {:.1%} of buy and hold)'.format(
        st.mean([r[3] for r in rows]), math.exp(st.mean([r[3] for r in rows]))))
    print('  mean SHUFFLED relative:   {:+.4f}  (= {:.1%})'.format(
        st.mean([r[5] for r in rows]), math.exp(st.mean([r[5] for r in rows]))))
    print()
    print('  HOW TO READ IT. Column "beats shuf" separates the two worlds: if the')
    print('  real rule beats a randomly-rotated copy of itself, the SIGNAL adds')
    print('  money relative to trading the same amount blindly - even while losing')
    print('  to full exposure. If it does not, the only thing the rule ever did was')
    print('  be out of the market.')
    print()
    for sym in SYMBOLS:
        sub = [r for r in rows if r[0] == sym]
        bs = sum(1 for r in sub if r[3] > r[5])
        print('    {:<9} beats its shuffled twin in {:>2}/{} cells, '
              'median terminal {:.1%}'.format(
                  sym, bs, len(sub), math.exp(st.median([r[3] for r in sub]))))


if __name__ == '__main__':
    main()
