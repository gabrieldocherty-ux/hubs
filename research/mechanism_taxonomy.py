"""
Every strategy tested, classified by MECHANISM rather than by outcome.

Sorting by "what worked" tells you what happened; sorting by what each strategy
BELIEVES about the market tells you why. Three types cover all seventeen:

  CONTINUATION   bets a move persists. Something has started - a cascade, a
                 breakout, a trend - and the claim is that it carries on.
                 Requires an amplifying force: forced liquidation flow, slow
                 information diffusion, trend-follower buying.

  REVERSION      bets a move reverses. Price has been pushed away from a fair
                 value by flow rather than information, and the claim is that
                 it comes back. Requires a restoring force: arbitrage against
                 spot, liquidity providers being paid to absorb, positioning
                 unwinding.

  RELATIONAL     bets on a relationship BETWEEN things rather than the
                 direction of any one. Coin against coin, time against time,
                 funding against funding. Requires the relationship to be
                 stable and not already arbitraged.

Classification is by what the strategy claims, decided before the results are
read - so the hit rate per type is a finding rather than a construction.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
LIB = json.loads((ROOT / 'research' / 'strategy_results.json').read_text())

TYPE = {
    # CONTINUATION - something started, bet it carries on
    'S3': ('CONTINUATION', 'liquidation cascade keeps running'),
    'D1': ('CONTINUATION', 'range break + forced-flow evidence'),
    'M3': ('CONTINUATION', 'multi-month range break, Turtle'),
    'M1': ('CONTINUATION', 'time-series momentum'),
    'LIVE': ('CONTINUATION', 'SMA trend crossover'),
    'M2': ('CONTINUATION', 'golden cross regime'),
    'M5': ('CONTINUATION', 'funding-confirmed trend'),
    'D4': ('CONTINUATION', 'expansion out of a vol squeeze'),
    # REVERSION - flow pushed price away, bet it comes back
    'B1': ('REVERSION', 'perp/spot basis snaps back'),
    'D2': ('REVERSION', 'capitulation overshoot'),
    'D3': ('REVERSION', 'crowded funding unwinds'),
    'S1': ('REVERSION', 'short-term price reversal'),
    'S5': ('REVERSION', 'RSI(2) oversold bounce'),
    # RELATIONAL - a relationship between things
    'D5': ('RELATIONAL', 'BTC leads the alts'),
    'M6': ('RELATIONAL', 'cross-sectional relative strength'),
    'M7': ('RELATIONAL', 'funding carry spread between coins'),
    'S2': ('RELATIONAL', 'time-of-day / session effect'),
}

WORKS = {'VALIDATED', 'LIVE'}
rows = []
for s in LIB['strategies']:
    t, claim = TYPE.get(s['id'], ('?', ''))
    rows.append({**s, 'type': t, 'claim': claim})

print('=' * 122)
print('ALL {} STRATEGIES BY MECHANISM'.format(len(rows)))
print('=' * 122)

for t in ('CONTINUATION', 'REVERSION', 'RELATIONAL'):
    grp = [r for r in rows if r['type'] == t]
    ok = [r for r in grp if r['status'] in WORKS]
    print('\n{}  -  {} of {} survived'.format(t, len(ok), len(grp)))
    print('  {:<6}{:<32}{:<13}{:>7}{:>10}{:>10}  {}'.format(
        'id', 'strategy', 'status', 'n', 'exp', 'trimmed', 'what it claims'))
    print('  ' + '-' * 118)
    for r in sorted(grp, key=lambda x: -(x.get('trimmed') if x.get('trimmed') is not None else -9)):
        e, tr, n = r.get('expectancy'), r.get('trimmed'), r.get('n')
        mark = '*' if r['status'] in WORKS else ' '
        print('  {}{:<5}{:<32}{:<13}{:>7}{:>10}{:>10}  {}'.format(
            mark, r['id'], r['label'][:31], r['status'], n if n else '-',
            '{:+.2f}%'.format(e * 100) if e is not None else '-',
            '{:+.2f}%'.format(tr * 100) if tr is not None else '-', r['claim']))

print('\n' + '=' * 122)
print('THE HIT RATE BY TYPE  -  this is the market-structure finding')
print('=' * 122)
print('  {:<16}{:>10}{:>12}{:>12}{:>16}'.format(
    'type', 'tested', 'survived', 'hit rate', 'median trimmed'))
import statistics as st
for t in ('CONTINUATION', 'REVERSION', 'RELATIONAL'):
    grp = [r for r in rows if r['type'] == t]
    ok = [r for r in grp if r['status'] in WORKS]
    trs = [r['trimmed'] for r in grp if r.get('trimmed') is not None]
    print('  {:<16}{:>10}{:>12}{:>12}{:>16}'.format(
        t, len(grp), len(ok), '{:.0%}'.format(len(ok) / len(grp)),
        '{:+.2f}%'.format(st.median(trs) * 100) if trs else '-'))

print("""
=========================================================================================================
WHAT THIS SAYS ABOUT THE MARKET

RELATIONAL is 0 for 4, and not narrowly - lead-lag -1.27%, cross-sectional
momentum and carry both negative, session effects negative on all six slots.
Every one of them needs a relationship BETWEEN instruments to be both stable and
un-arbitraged, and on four highly-correlated majors trading on one venue it is
neither. Four coins is not enough breadth for relative value, and the obvious
relationships are exactly what a competitor removes first.

CONTINUATION has the most survivors but also the most attempts, and its hit rate
flatters it: three of the eight are the SAME BET (S3 and D1 overlap 0.85-1.00,
and the cut SMA correlates +0.44 with them). The honest reading is one working
continuation mechanism - forced flow - expressed several ways, plus a slow trend
bet that has decayed since 2023.

REVERSION is 1 of 5, and the one that survived is the odd one out: B1 works
because it reverts against a SPOT PRICE that exists and can be arbitraged
against. The four failures all bet on reversion toward a statistical average -
a moving average, an RSI level, a funding percentile - which is not a thing
anybody is forced to trade back toward. That is the distinction that matters,
and it is a rule for future work: reversion needs a REAL anchor, not a computed
one.

Practical consequence for the book: the two genuinely independent bets are
FORCED FLOW (continuation, microstructure) and BASIS (reversion, anchored to
spot). Everything else is a variant of one of them or a rejected idea.""")
