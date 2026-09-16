"""
Testing the ACTUAL hypothesis: does the price near expiry predict the outcome?

THE QUESTION AS PUT: when a contract trades around 0.80 a minute or so before it
ends, does it resolve YES more often than 0.80 implies?

WHAT WAS TESTED INSTEAD, AND WHY THAT WAS THE WRONG THING. The previous work
compared quoted prices to a fair value computed from Bitcoin's minute-by-minute
volatility. That answers "is the market internally consistent with my model",
which is a question about MY MODEL. The hypothesis is about the market against
REALITY - price on one side, settled outcome on the other, no model in between.
Substituting the answerable question for the asked one is a real methodological
failure and it is recorded here rather than quietly corrected.

This file does it properly. It takes prices recorded before expiry, fetches what
each market actually settled at, and compares the two directly. No volatility
estimate, no fair-value curve, no assumption about how Bitcoin moves.

THE READING:
  If contracts priced near 0.80 settle YES ABOUT 80% of the time, the market is
  calibrated and there is no edge in the price level itself.
  If they settle YES MORE than 80%, favourites are underpriced near expiry - the
  favourite-longshot bias - and buying them is the trade.
  If LESS, favourites are overpriced and the trade is the other way.

SAMPLE SIZE IS THE BINDING CONSTRAINT AND IT IS STATED LOUDLY. With a few dozen
observations the confidence interval on a proportion is enormous: 8 of 10 winners
is consistent with a true rate anywhere from about 44% to 97%. A Wilson interval
is reported on every bucket for exactly this reason, and no bucket whose interval
spans its own price should be treated as evidence of anything.
"""
import json
import math
import pathlib
import sys
from collections import defaultdict

sys.path.insert(0, 'research')
import polymarket_data as pm

TICKS = pathlib.Path('data/poly_expiry_ticks.jsonl')
CACHE = pathlib.Path('data/poly_outcomes.json')


def wilson(k, n, z=1.96):
    """Wilson score interval - correct for small samples and proportions near 0
    or 1, where the textbook normal interval produces impossible bounds."""
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = p + z * z / (2 * n)
    m = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - m) / d, (c + m) / d)


def load_outcomes(ids):
    known = {}
    if CACHE.exists():
        known = json.loads(CACHE.read_text())
    todo = [i for i in ids if str(i) not in known]
    print('  fetching resolutions for {} markets ({} already cached)...'.format(
        len(todo), len(known)))
    for i in todo:
        m = pm._get(pm.GAMMA + '/markets/' + str(i))
        if not isinstance(m, dict):
            continue
        if not m.get('closed'):
            known[str(i)] = None            # still open
            continue
        op = pm.parse_json_field(m.get('outcomePrices'))
        outs = pm.parse_json_field(m.get('outcomes'))
        if not op or not outs:
            known[str(i)] = None
            continue
        try:
            idx = next((k for k, o in enumerate(outs) if str(o).lower() in
                        ('yes', 'up')), 0)
            v = float(op[idx])
        except (ValueError, IndexError, TypeError):
            known[str(i)] = None
            continue
        known[str(i)] = v if v in (0.0, 1.0) else None
    CACHE.write_text(json.dumps(known))
    return known


rows = [json.loads(l) for l in TICKS.open(encoding='utf-8')]
print('=' * 104)
print('THE HYPOTHESIS, TESTED DIRECTLY: price before expiry vs settled outcome')
print('=' * 104)
print('  ticks recorded: {}   unique markets: {}'.format(
    len(rows), len({r['id'] for r in rows})))

outcomes = load_outcomes(sorted({r['id'] for r in rows}))
resolved = {k: v for k, v in outcomes.items() if v is not None}
print('  markets that have settled: {}'.format(len(resolved)))

joined = []
for r in rows:
    o = outcomes.get(str(r['id']))
    if o is None:
        continue
    # price actually payable: the ASK is what a buyer pays. Using the midpoint
    # would flatter every result by half the spread.
    p = r.get('ask') if r.get('ask') is not None else r.get('last')
    if p is None:
        continue
    # An ask of 1.00 is NOT a price - it means nobody is offering, so the book is
    # pinned at its ceiling. Treating it as "the market says certain" put 60
    # contracts into a 0.9-1.0 bucket at a mean price of exactly 1.000, which then
    # "won" only 61.7% of the time and showed a -0.383 bias. That was entirely an
    # artefact of reading an absent offer as a quote. Nobody can buy at 1.00
    # anyway: you would stake a dollar to win a dollar.
    if p >= 0.99 or p <= 0.01:
        continue
    joined.append({'p': p, 'o': o, 'mins': r['mins_left'],
                   'updown': 'up or down' in r['q'].lower(), 'q': r['q']})

print('  joinable observations: {}'.format(len(joined)))
if not joined:
    print('\n  Nothing has settled yet. Run the collector repeatedly, then re-run this.')
    raise SystemExit(0)


def report(sel, label):
    if not sel:
        return
    print('\n  --- {} (n={}) ---'.format(label, len(sel)))
    print('  {:>14}{:>7}{:>12}{:>12}{:>22}{:>12}'.format(
        'price bucket', 'n', 'mean price', 'actual YES', '95% interval', 'bias'))
    print('  ' + '-' * 80)
    buckets = defaultdict(list)
    for r in sel:
        buckets[min(int(r['p'] * 10), 9)].append(r)
    for b in sorted(buckets):
        rs = buckets[b]
        n = len(rs)
        k = sum(1 for r in rs if r['o'] == 1.0)
        mp = sum(r['p'] for r in rs) / n
        act = k / n
        lo, hi = wilson(k, n)
        flag = '' if lo <= mp <= hi else '  <-- outside'
        print('  {:>14}{:>7}{:>12}{:>12}{:>22}{:>12}{}'.format(
            '{:.1f}-{:.1f}'.format(b / 10, (b + 1) / 10), n,
            '{:.3f}'.format(mp), '{:.3f}'.format(act),
            '{:.3f} - {:.3f}'.format(lo, hi), '{:+.3f}'.format(act - mp), flag))
    # the bottom line: buying every contract at the ask
    pnl = sum((1.0 - r['p']) if r['o'] == 1.0 else (-r['p']) for r in sel)
    stake = sum(r['p'] for r in sel)
    print('  buying ALL of them at the ask: P&L {:+.3f} on {:.2f} staked = {:+.2%}'.format(
        pnl, stake, pnl / stake if stake else 0))


print('  after excluding pinned books (ask >= 0.99 or <= 0.01): {}'.format(len(joined)))

# Independence check. Every tick here came from ONE snapshot, and crypto markets
# move together - if BTC fell in a five-minute window, ETH, SOL, XRP and DOGE very
# likely fell in the same window. So 57 observations are nowhere near 57
# independent trials, and any confidence interval that assumes they are will be
# far too narrow.
stamps = {r.get('ts') for r in rows}
print('  distinct snapshot times in the data: {}'.format(len(stamps)))
if len(stamps) <= 2:
    print('  WARNING: all observations share a timestamp. Crypto outcomes are highly')
    print('  correlated within a window, so the EFFECTIVE sample is closer to the')
    print('  number of distinct time windows than to the number of rows. Every')
    print('  interval below is therefore too narrow and must not be read as evidence.')

report(joined, 'ALL MARKETS')
report([r for r in joined if r['updown']], 'CRYPTO "UP OR DOWN" ONLY')
hi = [r for r in joined if r['p'] >= 0.70]
report(hi, 'FAVOURITES: price >= 0.70  <-- THE HYPOTHESIS')
lo = [r for r in joined if r['p'] <= 0.30]
report(lo, 'LONGSHOTS: price <= 0.30')

print("""
============================================================================================
HOW TO READ THIS - and how not to

  'bias' is actual YES rate minus mean price. POSITIVE means the contracts won more
  often than their price implied, which is the hypothesis holding. NEGATIVE means
  they won less often.

  The '95% interval' column is what decides whether any of it means anything. If
  the interval CONTAINS the mean price, the data is consistent with a perfectly
  calibrated market and the bias is noise. Only a bucket whose interval EXCLUDES
  its own price is evidence, and that is flagged.

  This is one snapshot of a few dozen markets. It is a first look, not an answer -
  the sample needed for a real verdict is a few hundred per bucket, which these
  five-minute markets can supply in about a week of collecting every minute.""")
