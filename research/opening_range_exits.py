"""
Was the entry bad, or was MY exit bad?

Fair challenge, and it deserved a real answer rather than a defence. The source of
this setup specifies no stop, no target and no holding period, so every exit in
opening_range_report.py was chosen by me - a stop at 1x the opening range width,
flat at the session close - and I swept neither. One exit configuration is not a
test of a setup.

The way to separate the two claims is to stop trading it and just MEASURE it.

  SECTION 1 strips every exit rule away. From the entry, hold N bars, no stop, no
  target, no costs, and look at the raw forward return. If an entry carries
  information, the forward path has to be positive at SOME horizon. This cannot be
  rescued by exit design, because there is nothing here that an exit acts upon -
  you cannot exit your way into an edge that the entry never produced.

  SECTION 2 measures MFE and MAE - how far the trade goes in your favour before it
  goes against you. This is what tells you whether a better exit is even possible:
  a large MFE that the default exit failed to capture means my exit was leaving
  money on the table; an MAE that arrives before the MFE means you get stopped out
  before any target can pay, and the entry is simply badly timed.

  SECTION 3 is the decisive one. THE PERFECT EXIT. For each trade, exit at the
  single best bar in hindsight. This is blatant lookahead and is not a strategy -
  it is the mathematical CEILING on what any exit rule whatsoever could extract
  from these entries. If the perfect exit is not comfortably profitable after
  costs, then no stop, no target, no trailing rule and no holding period can make
  this work, and the question is closed for good rather than left open for the
  next plausible-sounding tweak.

  SECTION 4 only then sweeps real exits. It comes last on purpose: a grid of
  target x stop combinations will always contain a best cell, and reporting that
  cell without sections 1-3 would be exactly the overfitting this project rejects.
  Its variant count is reported and its best cell is to be read as the best of N,
  not as a discovery.
"""
import statistics as st
import sys

sys.path.insert(0, 'research')
from opening_range_vwap import BASE, BTC_COST, COST, find_entry, load

INSTR = ['QQQ', 'GLD', 'BTC']
VARIANTS = 0


def entries(sym, p=None):
    """Every entry the setup produces, with the bars that follow it."""
    p = p or BASE
    sess, _ = load(sym)
    out = []
    for d, bars in sess:
        e = find_entry(bars, p)
        if e is None:
            continue
        fwd = bars[e['i']:]
        if len(fwd) < 2:
            continue
        out.append({'date': d, 'entry': e, 'fwd': fwd, 'px': e['price'],
                    'dir': e['dir'], 'width_pct': e['width'] / e['price']})
    return out


def signed(px, ref, d):
    return (ref - px) / px if d == 'long' else (px - ref) / px


# ------------------------------------------------------------------ 1. raw forward path
print('=' * 122)
print('1. THE ENTRY WITH NO EXIT RULE AT ALL')
print('   Hold N bars from the fill. No stop, no target, no costs. If the entry')
print('   carries information the forward path must be positive SOMEWHERE.')
print('=' * 122)
ALL = {}
for sym in INSTR:
    E = entries(sym)
    ALL[sym] = E
    if not E:
        continue
    horizons = [1, 2, 3, 4, 5, 6] if sym != 'BTC' else [1, 2, 3, 4, 6, 8, 12, 18]
    print('\n  {}  n={} entries, median opening-range width {:.2f}% of price'.format(
        sym, len(E), st.median([e['width_pct'] for e in E]) * 100))
    print('  {:<14}{:>10}{:>10}{:>12}{:>10}'.format('hold', 'mean', 'median', 'win rate', 't-stat'))
    for h in horizons:
        rs = []
        for e in E:
            if len(e['fwd']) <= h:
                continue
            rs.append(signed(e['px'], e['fwd'][h]['c'], e['dir']))
        if len(rs) < 5:
            continue
        se = st.pstdev(rs) / (len(rs) ** 0.5) if len(rs) > 1 else 0
        print('  {:<14}{:>10}{:>10}{:>12}{:>10}'.format(
            '{} bars'.format(h), '{:+.3f}%'.format(st.mean(rs) * 100),
            '{:+.3f}%'.format(st.median(rs) * 100),
            '{:.0%}'.format(sum(1 for r in rs if r > 0) / len(rs)),
            '{:.2f}'.format(st.mean(rs) / se) if se else '-'))
    # to the close
    rs = [signed(e['px'], e['fwd'][-1]['c'], e['dir']) for e in E]
    se = st.pstdev(rs) / (len(rs) ** 0.5) if len(rs) > 1 else 0
    print('  {:<14}{:>10}{:>10}{:>12}{:>10}'.format(
        'to close', '{:+.3f}%'.format(st.mean(rs) * 100),
        '{:+.3f}%'.format(st.median(rs) * 100),
        '{:.0%}'.format(sum(1 for r in rs if r > 0) / len(rs)),
        '{:.2f}'.format(st.mean(rs) / se) if se else '-'))

# ------------------------------------------------------------------ 2. MFE / MAE
print('\n' + '=' * 122)
print('2. MAXIMUM FAVOURABLE vs MAXIMUM ADVERSE EXCURSION')
print('   MFE is the best the trade ever looked; MAE is the worst. Their ratio, and')
print('   crucially WHICH ARRIVES FIRST, decides whether a better exit is possible.')
print('=' * 122)
print('  {:<8}{:>8}{:>12}{:>12}{:>12}{:>12}{:>16}'.format(
    'sym', 'n', 'med MFE', 'med MAE', 'MFE/MAE', 'cost', 'MAE first'))
for sym in INSTR:
    E = ALL.get(sym) or []
    if not E:
        continue
    mfes, maes, mae_first = [], [], 0
    for e in E:
        best, worst, bi, wi = 0.0, 0.0, 99, 99
        for k, b in enumerate(e['fwd']):
            up = signed(e['px'], b['h'] if e['dir'] == 'long' else b['l'], e['dir'])
            dn = signed(e['px'], b['l'] if e['dir'] == 'long' else b['h'], e['dir'])
            if up > best:
                best, bi = up, k
            if dn < worst:
                worst, wi = dn, k
        mfes.append(best)
        maes.append(worst)
        if wi < bi:
            mae_first += 1
    mMFE, mMAE = st.median(mfes), st.median(maes)
    print('  {:<8}{:>8}{:>12}{:>12}{:>12}{:>12}{:>16}'.format(
        sym, len(E), '{:+.3f}%'.format(mMFE * 100), '{:+.3f}%'.format(mMAE * 100),
        '{:.2f}'.format(abs(mMFE / mMAE)) if mMAE else '-',
        '{:.3f}%'.format(COST[sym] * 100),
        '{:.0%} of trades'.format(mae_first / len(E))))
print("""
  Read MFE against the cost column. If the median MFE is not several times the
  round trip, there is no room for a target to work - the trade never gets far
  enough in your favour to pay the toll, whatever rule you use to leave.""")

# ------------------------------------------------------------------ 3. perfect exit
print('\n' + '=' * 122)
print('3. THE PERFECT EXIT - the mathematical ceiling on any exit rule')
print('   Exit at the single best bar, chosen with hindsight. Not a strategy: an')
print('   upper bound. Nothing implementable can beat this, so if THIS is marginal')
print('   after costs then no exit design saves the setup.')
print('=' * 122)
print('  {:<8}{:>8}{:>14}{:>14}{:>14}{:>16}'.format(
    'sym', 'n', 'perfect', 'less cost', 'my exit', 'headroom'))
from opening_range_vwap import backtest
for sym in INSTR:
    E = ALL.get(sym) or []
    if not E:
        continue
    perf = []
    for e in E:
        best = 0.0
        for b in e['fwd']:
            best = max(best, signed(e['px'], b['h'] if e['dir'] == 'long' else b['l'], e['dir']))
        perf.append(best)
    sess, _ = load(sym)
    mine = backtest(sess, BASE, COST[sym], sym)
    p_net = st.mean(perf) - COST[sym]
    print('  {:<8}{:>8}{:>14}{:>14}{:>14}{:>16}'.format(
        sym, len(E), '{:+.3f}%'.format(st.mean(perf) * 100),
        '{:+.3f}%'.format(p_net * 100), '{:+.3f}%'.format(mine.expectancy * 100),
        '{:+.3f}pp'.format((p_net - mine.expectancy) * 100)))

# ------------------------------------------------------------------ 4. real exit sweep
print('\n' + '=' * 122)
print('4. REAL EXIT SWEEP - target x stop, in units of the opening range width')
print('   Read every cell as the best of N, not as a discovery. Sections 1-3 decide.')
print('=' * 122)


def with_exit(E, tgt, stop_mult, cost):
    """Standard intrabar convention: if a bar's range spans both the stop and the
    target, assume the STOP filled first. The optimistic alternative would quietly
    manufacture an edge out of an accounting choice."""
    out = []
    for e in E:
        px, d = e['px'], e['dir']
        w = e['width_pct']
        tp = px * (1 + tgt * w) if d == 'long' else px * (1 - tgt * w)
        sl = px * (1 - stop_mult * w) if d == 'long' else px * (1 + stop_mult * w)
        r = None
        for b in e['fwd']:
            hit_s = (b['l'] <= sl) if d == 'long' else (b['h'] >= sl)
            hit_t = (b['h'] >= tp) if d == 'long' else (b['l'] <= tp)
            if hit_s:
                r = signed(px, sl, d)
                break
            if hit_t:
                r = signed(px, tp, d)
                break
        if r is None:
            r = signed(px, e['fwd'][-1]['c'], d)
        out.append(r - cost)
    return out


for sym in INSTR:
    E = ALL.get(sym) or []
    if not E:
        continue
    print('\n  {}   (net %/trade after {:.3f}% round trip, n={})'.format(
        sym, COST[sym] * 100, len(E)))
    print('  {:<12}'.format('stop \\ tgt') + ''.join(
        '{:>11}'.format('{:.2f}x'.format(t)) for t in (0.5, 1.0, 1.5, 2.0, 3.0)))
    for smult in (0.5, 1.0, 1.5, 2.0):
        cells = []
        for tgt in (0.5, 1.0, 1.5, 2.0, 3.0):
            rs = with_exit(E, tgt, smult, COST[sym])
            VARIANTS += 1
            cells.append('{:>11}'.format('{:+.3f}%'.format(st.mean(rs) * 100)))
        print('  {:<12}'.format('{:.2f}x'.format(smult)) + ''.join(cells))

print('\n  exit configurations evaluated in section 4: {}'.format(VARIANTS))
print('=' * 122)
