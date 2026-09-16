"""
The validation battery for opening_range_vwap.py.

Kept separate from the strategy module so the setup logic can be imported and
re-tested from elsewhere without dragging a two-hundred-line report with it.

The order below is deliberate. The headline number comes first because that is
what anyone asks for, but it is the LEAST informative thing here. The evidence
that decides the verdict is section 2 (does a bigger extension pay more, as the
mechanism claims) and section 3 (do the three conditions each do anything, or is
this one effect wearing three filters). A good headline with a flat dose-response
and a dead ablation is a fitted backtest.
"""
import statistics as st
import sys

sys.path.insert(0, 'research')
from opening_range_vwap import (BASE, BTC_COST, COST, HDR, Res, backtest, load,
                                row, run_session)

INSTR = ['QQQ', 'GLD', 'BTC']
VARIANTS = 0


def count(n=1):
    global VARIANTS
    VARIANTS += n


def random_entry(sessions, p, cost, label, seed=42):
    """The calibration that matters: same sessions, same direction, same stop and
    the same hold - but enter at a RANDOM post-opening-range bar instead of at the
    VWAP touch. If this scores the same, the VWAP touch is decoration and the
    result is just 'be positioned intraday after a range break'."""
    import random
    rng = random.Random(seed)
    r = Res(label)
    for _, bars in sessions:
        t = run_session(bars, p)
        if not t:
            continue
        orb = bars[:p['or_bars']]
        hi = max(b['h'] for b in orb)
        lo = min(b['l'] for b in orb)
        width = hi - lo
        lo_i, hi_i = p['or_bars'], len(bars) - 2
        if hi_i <= lo_i or width <= 0:
            continue
        i = rng.randint(lo_i, hi_i)
        px = bars[i + 1]['o']
        d = t['dir']
        stop = px - p['stop_mult'] * width if d == 'long' else px + p['stop_mult'] * width
        last = len(bars) - 1
        ex = None
        for j in range(i + 1, last + 1):
            b = bars[j]
            if d == 'long' and b['l'] <= stop:
                ex = stop if b['o'] >= stop else b['o']
                break
            if d == 'short' and b['h'] >= stop:
                ex = stop if b['o'] <= stop else b['o']
                break
        if ex is None:
            ex = bars[last]['c']
        r.add((ex - px) / px if d == 'long' else (px - ex) / px, cost)
    return r


def split(sessions, frac=0.6):
    k = int(len(sessions) * frac)
    return sessions[:k], sessions[k:]


print('=' * 124)
print('OPENING RANGE BREAK -> EXTENSION -> PULLBACK TO VWAP')
print('  QQQ  real 09:30 auction open       | GLD  same session, different asset class')
print('  BTC  no session at all (invented)  | costs: ETF 0.040% RT, BTC 0.190% RT')
print('=' * 124)
for sym in INSTR:
    sess, short = load(sym)
    print('  {:5} {:4} sessions ({} short dropped), median {} bars/session'.format(
        sym, len(sess), short, int(st.median([len(s) for _, s in sess]))))

# ------------------------------------------------------------------ 1. headline
print('\n' + '=' * 124)
print('1. THE SETUP AS STATED  (1h bars, opening range = first bar, flat by close)')
print('=' * 124)
print(HDR)
base_res = {}
for sym in INSTR:
    sess, _ = load(sym)
    r = backtest(sess, BASE, COST[sym], sym)
    base_res[sym] = r
    count()
    row('{}  conservative fill (next open)'.format(sym), r, COST[sym])

print('\n  the same setup, filled AT VWAP - the optimistic case the video implies')
print(HDR)
for sym in INSTR:
    sess, _ = load(sym)
    r = backtest(sess, dict(BASE, fill_at_vwap=True), COST[sym], sym)
    count()
    row('{}  fill at VWAP (optimistic)'.format(sym), r, COST[sym])

# ------------------------------------------------------------------ 2. dose-response
print('\n' + '=' * 124)
print('2. DOSE-RESPONSE ON THE EXTENSION - the mechanism test')
print('   The claim is that a bigger leg means more algos missed it, so a bigger')
print('   extension should give a STRONGER fill at VWAP. That predicts monotonicity.')
print('=' * 124)
for sym in INSTR:
    sess, _ = load(sym)
    print('\n  {}'.format(sym))
    print(HDR)
    for ext in (0.25, 0.5, 0.75, 1.0, 1.5, 2.0):
        r = backtest(sess, dict(BASE, ext_mult=ext), COST[sym], sym)
        count()
        row('extension >= {:.2f}x range width'.format(ext), r, COST[sym])

# ------------------------------------------------------------------ 3. ablation
print('\n' + '=' * 124)
print('3. CONDITION ABLATION - which of the three filters actually does anything?')
print('   Three conjunctive conditions with free parameters is the classic shape of a')
print('   fitted backtest. If dropping one changes nothing, it was never load-bearing.')
print('=' * 124)
for sym in INSTR:
    sess, _ = load(sym)
    print('\n  {}'.format(sym))
    print(HDR)
    for lab, p in (
            ('all three conditions (as stated)', BASE),
            ('  drop: no-close-through-VWAP', dict(BASE, require_vwap_hold=False)),
            ('  drop: extension requirement', dict(BASE, ext_mult=0.0)),
            ('  drop: both, break only', dict(BASE, require_vwap_hold=False, ext_mult=0.0)),
    ):
        r = backtest(sess, p, COST[sym], sym)
        count()
        row(lab, r, COST[sym])

# ------------------------------------------------------------------ 4. null
print('\n' + '=' * 124)
print('4. NULL CALIBRATION - same sessions, same direction, RANDOM entry bar')
print('=' * 124)
print(HDR)
for sym in INSTR:
    sess, _ = load(sym)
    r = random_entry(sess, BASE, COST[sym], sym)
    row('{}  random entry (null)'.format(sym), r, COST[sym])
    b = base_res[sym]
    if r.n and b.n:
        print('       VWAP-touch entry {:+.3f}% net  ->  edge attributable to the touch: '
              '{:+.3f}pp'.format(b.expectancy * 100, (b.expectancy - r.expectancy) * 100))

# ------------------------------------------------------------------ 5. train/test
print('\n' + '=' * 124)
print('5. TRAIN / TEST 60-40 BY TIME')
print('=' * 124)
print('  {:<12}{:>8}{:>12}{:>8}{:>12}{:>14}'.format(
    'instrument', 'n_tr', 'train', 'n_te', 'test', 'decay'))
for sym in INSTR:
    sess, _ = load(sym)
    tr, te = split(sess)
    a = backtest(tr, BASE, COST[sym], sym)
    b = backtest(te, BASE, COST[sym], sym)
    count(2)
    print('  {:<12}{:>8}{:>12}{:>8}{:>12}{:>14}'.format(
        sym, a.n, '{:+.3f}%'.format(a.expectancy * 100),
        b.n, '{:+.3f}%'.format(b.expectancy * 100),
        '{:+.3f}pp'.format((b.expectancy - a.expectancy) * 100)))

# ------------------------------------------------------------------ 6. cost stress
print('\n' + '=' * 124)
print('6. COST STRESS - and the venue asymmetry that decides this')
print('=' * 124)
print('  {:<12}{:>12}{:>12}{:>12}{:>12}'.format(
    'instrument', 'GROSS', '1x cost', '2x cost', '4x cost'))
for sym in INSTR:
    r = base_res[sym]
    if not r.n:
        continue
    c, g = COST[sym], r.gross_expectancy
    print('  {:<12}{:>12}{:>12}{:>12}{:>12}'.format(
        sym, '{:+.3f}%'.format(g * 100), '{:+.3f}%'.format((g - c) * 100),
        '{:+.3f}%'.format((g - 2 * c) * 100), '{:+.3f}%'.format((g - 4 * c) * 100)))
print("""
  This is the most important number in the file. The ETF round trip is ~5x cheaper
  than the crypto perp round trip, so an identical gross edge can be comfortably
  profitable on QQQ and dead on BTC for reasons that have nothing to do with
  whether the pattern is real.""")

# ------------------------------------------------------------------ 7. BTC anchor
print('\n' + '=' * 124)
print('7. BTC: DOES THE RESULT DEPEND ON WHICH ARBITRARY HOUR WE CALL "THE OPEN"?')
print('   A 24/7 market has no open. If the invented session matters, the numbers should')
print('   swing with the anchor - and that swing is itself the finding.')
print('=' * 124)
print(HDR)
btc_anchor = []
for anchor in (0, 4, 8, 12, 13, 16, 20):
    sess, _ = load('BTC', anchor=anchor)
    r = backtest(sess, BASE, BTC_COST, 'BTC')
    count()
    btc_anchor.append(r.expectancy)
    row('session anchored at {:02d}:00 UTC'.format(anchor), r, BTC_COST)
if btc_anchor:
    print('\n  spread across arbitrary anchors: {:+.3f}% to {:+.3f}%  (range {:.3f}pp)'.format(
        min(btc_anchor) * 100, max(btc_anchor) * 100,
        (max(btc_anchor) - min(btc_anchor)) * 100))

# ------------------------------------------------------------------ 8. literal 30m
print('\n' + '=' * 124)
print('8. THE LITERAL 30-MINUTE VERSION  (60 days only - INDICATIVE, not decisive)')
print('=' * 124)
print(HDR)
for sym in ('QQQ', 'GLD'):
    sess, _ = load(sym, '30m', '60d')
    r = backtest(sess, BASE, COST[sym], sym)
    count()
    row('{}  30m bars, {} sessions'.format(sym, len(sess)), r, COST[sym])
sess, _ = load('BTC', '15m', '60d', anchor=0)
r = backtest(sess, dict(BASE, or_bars=2), BTC_COST, 'BTC')
count()
row('BTC 15m bars, 30min OR, {} sessions'.format(len(sess)), r, BTC_COST)

print('\n' + '=' * 124)
print('TOTAL CONFIGURATIONS EVALUATED: {}'.format(VARIANTS))
print('  With this many cells some will look good by chance. That is exactly why the')
print('  decisive evidence is the dose-response and the ablation, never the best cell.')
print('=' * 124)

print("""
============================================================================================================================
VERDICT: REJECTED on all three instruments. Four independent reasons, any one sufficient.
============================================================================================================================

1. THE ENTIRE EDGE IS THE FILL ASSUMPTION.

                        conservative fill      fill AT VWAP        swing
       QQQ   net            -0.121%              +0.171%          +0.29pp
       GLD   net            +0.023%              +0.184%          +0.16pp
       BTC   net            -0.280%              +0.100%          +0.38pp
       QQQ   win rate          53%                  71%
       GLD   win rate          48%                  70%
       BTC   win rate          23%                  43%

   "The first touch of the line is your entry" quietly assumes you are filled AT
   VWAP. Change nothing else and simply require the fill at the next bar's open -
   this project's standard everywhere - and every instrument flips. The setup is a
   resting limit order at VWAP, and a limit order that always fills at its limit
   price is not a strategy, it is an accounting choice. Worse, the real version of
   that order suffers adverse selection: you are filled precisely when price keeps
   going through your level, which is the case this backtest treats as free.

2. THE DOSE-RESPONSE IS ABSENT, AND ON QQQ IT IS INVERTED.
   The stated mechanism is that a bigger leg means more algos missed it, so more
   waiting demand at VWAP. That predicts monotonic improvement with extension size.
       QQQ  -0.028, -0.044, -0.033, -0.081, -0.400, -0.920   monotonically WORSE
       GLD  +0.045, +0.039, +0.090, +0.063, +0.127, -0.007   noise, no trend
       BTC  -0.136, -0.093, -0.108, -0.090, -0.113, -0.057   flat, negative throughout
   Not one instrument pays more for a bigger dislocation. The mechanism, as stated,
   is contradicted by the data it is supposed to explain.

3. THE THREE CONDITIONS ONLY DESTROY SAMPLE SIZE.
       QQQ  all three  -0.121% on n=17   |  break only  -0.074% on n=263
       GLD  all three  +0.023% on n=27   |  break only  +0.008% on n=247
   On QQQ, deleting every filter makes the strategy BETTER and multiplies the
   sample by 15. On GLD the filters look marginally additive but move the t-stat
   from 0.43 to 0.45, which is no movement at all. Three conjunctive conditions
   firing on 2.4% and 3.7% of sessions is the signature of a rule fitted to a
   handful of remembered charts.

4. THE VWAP TOUCH ITSELF ADDS NOTHING against a random entry in the same sessions,
   same direction, same stop: QQQ -0.061pp WORSE than random, BTC -0.068pp worse,
   GLD +0.094pp better on n=27 at t=0.45.

THE CLEANEST REFUTATION IS WHERE IT FAILED. QQQ has the real 09:30 auction, and
opening-range behaviour in equities is a documented effect with genuine mechanism.
If this setup worked BECAUSE of auction dynamics, QQQ should be the strongest of
the three. It is the weakest equity result in the file. Holding the session
constant and changing only the asset (GLD, same NYSE Arca hours) does not rescue
it either. So the failure is not "wrong asset class" and not "no session" - the
setup fails even where its own premise is best satisfied.

BTC deserves its own line. Across seven arbitrary choices of which UTC hour to
call "the open", net expectancy ranges from -0.379% to +0.047% - a 0.427pp spread
produced entirely by a decision with no economic content. That spread is larger
than any effect claimed anywhere in this file. It is what a strategy looks like
when the structure it depends on does not exist: you can manufacture whichever
answer you want by choosing the hour, which means none of them mean anything.

WHAT IS WORTH KEEPING - the venue asymmetry, which is a real and reusable finding:
       GLD gross +0.063%  ->  +0.023% net at the ETF's 0.040% round trip
                          ->  -0.317% net at the crypto perp's 0.190% round trip
   The identical gross edge is marginally alive in one venue and comprehensively
   dead in the other. Nothing about the pattern changed - only the toll. This is
   the same wall that killed intraday basis on Hyperliquid (a REAL mechanism with
   a clean monotonic dose-response, +0.156% gross against a 0.190% toll), and it
   is the strongest argument yet that the maker-only execution path is where
   intraday work in this project should go, if it goes anywhere.

WHAT THIS SAYS ABOUT THE TAXONOMY. VWAP was worth testing because it had a better
claim than a moving average - it is where money actually changed hands, not an
arbitrary statistic. The answer is that this does not save it. Being an
economically meaningful average is not the same as being an anchor somebody is
FORCED to trade back toward, and only the second kind supports reversion. The rule
stands, and is now stated more precisely: reversion needs a counterparty under
obligation, not merely a number with a good story attached.
""")
