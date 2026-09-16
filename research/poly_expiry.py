"""
Near-expiry pricing: is a contract at 0.80 with one minute left really an 80% shot?

THE HYPOTHESIS, and it is a good one. Close to resolution a contract's true
probability is almost fully determined - for a crypto threshold market, "will BTC
be above $78,000 in 60 seconds" depends only on how far away the strike is and how
much BTC moves in a minute. Both are measurable. So near expiry is where market
prices can be checked against reality most cleanly, and where any systematic bias
should be most visible.

WHY IT IS THE BEST VERSION OF THE CALIBRATION QUESTION. Two problems wrecked the
previous scan and both vanish here:
  * DRIFT CONTAMINATION. Ten years of BTC history contains roughly a 150x rise, so
    an empirical distribution built on it makes "price goes up" look far too
    likely. Over sixty seconds there is no drift worth the name - the distribution
    is essentially symmetric and the contamination disappears.
  * HORIZON MISMATCH. Modelling "1 day" when a market actually resolves in two
    hours makes every probability far too wide. At expiry the horizon is known
    exactly, because it is what is being measured.

THE MECHANISM THAT WOULD MAKE IT PAY. Favourite-longshot bias is one of the most
replicated findings in wagering markets: longshots are systematically overpriced
and favourites underpriced, because buyers prefer lottery-shaped payoffs. The bias
is documented as STRONGEST close to the event, when the longshot is nearly dead but
still carries a nonzero price that somebody keeps paying. If that holds here, a
contract at 0.80 near expiry should resolve YES MORE than 80% of the time - and
the trade is to buy the favourite, not the lottery ticket.

WHAT THIS FILE CAN AND CANNOT DO. It cannot test the hypothesis retrospectively,
because Polymarket serves no price history for resolved markets - established
across three separate probes. What it CAN do is compute what a correctly-priced
near-expiry contract SHOULD cost, from the minute-by-minute distribution of BTC's
actual moves, and compare that to what live markets are charging right now. That
turns the question from "wait months for data" into "is the current quote
defensible", and it also produces the fair-value curve the collector will need to
judge the data once it accumulates.
"""
import datetime
import math
import statistics as st
import sys

sys.path.insert(0, 'research')
import hl_data
import polymarket_data as pm

RISK_FREE = 0.03


# ------------------------------------------------------------------ fine-grained moves
def minute_moves(coin='BTC', days=30):
    """Every overlapping N-minute return, from real 1-minute candles.

    Hyperliquid serves genuine 1-minute data, which is what makes this testable -
    a daily series could never say anything about a sixty-second horizon.
    """
    bars, rep = hl_data.get_candles(coin, '1m', days)
    closes = [b['c'] for b in bars if b['c'] > 0]
    return closes, rep


def moves_over(closes, n):
    return [closes[i + n] / closes[i] - 1 for i in range(0, len(closes) - n)]


def p_above(moves, needed):
    """P(return exceeds `needed`), i.e. P(price ends above the strike)."""
    if not moves:
        return None
    return sum(1 for m in moves if m > needed) / len(moves)


print('=' * 112)
print('1. HOW MUCH DOES BTC ACTUALLY MOVE IN THE LAST FEW MINUTES?')
print('=' * 112)
closes, rep = minute_moves('BTC', 30)
print('  {} one-minute candles, {} to {}'.format(
    len(closes),
    datetime.datetime.utcfromtimestamp(rep['first'] / 1000).strftime('%Y-%m-%d %H:%M'),
    datetime.datetime.utcfromtimestamp(rep['last'] / 1000).strftime('%Y-%m-%d %H:%M')))

HORIZONS = [1, 2, 5, 10, 15, 30, 60, 120]
DISTS = {}
print('\n  {:>8}{:>10}{:>12}{:>12}{:>12}{:>12}'.format(
    'minutes', 'n', 'sd of move', 'p1 (worst)', 'p99 (best)', 'max |move|'))
print('  ' + '-' * 66)
for h in HORIZONS:
    mv = moves_over(closes, h)
    DISTS[h] = mv
    s = sorted(mv)
    print('  {:>8}{:>10}{:>12}{:>12}{:>12}{:>12}'.format(
        h, len(mv), '{:.3%}'.format(st.pstdev(mv)),
        '{:.3%}'.format(s[int(len(s) * 0.01)]), '{:.3%}'.format(s[int(len(s) * 0.99)]),
        '{:.3%}'.format(max(abs(x) for x in mv))))

print("""
  This is the whole basis of near-expiry pricing. If BTC's one-minute standard
  deviation is a few basis points, then a strike even 0.5% away is effectively
  unreachable with sixty seconds left - and a contract priced at 0.90 for that
  outcome is badly wrong, not slightly wrong.""")

# ------------------------------------------------------------------ fair value curve
print('\n' + '=' * 112)
print('2. THE FAIR-VALUE CURVE: what SHOULD a contract cost, given gap and time left?')
print('   Rows are how far the strike sits BELOW spot (so YES needs price to stay up).')
print('=' * 112)
GAPS = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02]
print('  {:>10}'.format('gap') + ''.join('{:>10}'.format('{}m'.format(h)) for h in HORIZONS))
print('  ' + '-' * 90)
for g in GAPS:
    cells = []
    for h in HORIZONS:
        p = p_above(DISTS[h], -g)
        cells.append('{:>10}'.format('{:.3f}'.format(p) if p is not None else '-'))
    print('  {:>10}'.format('-{:.2%}'.format(g)) + ''.join(cells))
print("""
  Read a row across: as time left shrinks, the probability of surviving a given
  buffer rises toward 1. Read a column down: with time fixed, a wider buffer is
  safer. A market quoting a price materially below the cell it corresponds to is
  underpricing a favourite, which is exactly the bias the hypothesis predicts.""")

# ------------------------------------------------------------------ live check
print('\n' + '=' * 112)
print('3. LIVE MARKETS CLOSE TO EXPIRY - is anything quoting away from fair value?')
print('=' * 112)
import re

# Helpers duplicated rather than imported: poly_crypto.py executes its full report
# at module level, so importing it here ran that entire script in the middle of
# this one's output. Guarding it would be the tidier fix, but a few lines copied
# keeps this file independently runnable, which matters more for something that
# will end up on a schedule.
_STRIKE = re.compile(r'\$([0-9][0-9,\.]*)\s*([kKmM]?)')
_COINS = [('bitcoin', 'BTC'), ('btc', 'BTC'), ('ethereum', 'ETH'),
          ('eth', 'ETH'), ('solana', 'SOL'), ('sol', 'SOL')]


def which_coin(txt):
    t = (txt or '').lower()
    for name, tag in _COINS:
        if re.search(r'(?<![a-z])' + name + r'(?![a-z])', t):
            return tag
    return None


def parse_strike(m):
    for f in ('groupItemTitle', 'question'):
        g = _STRIKE.search(m.get(f) or '')
        if g:
            try:
                v = float(g.group(1).replace(',', ''))
            except ValueError:
                continue
            s = (g.group(2) or '').lower()
            return v * (1_000 if s == 'k' else 1_000_000 if s == 'm' else 1)
    return None


def direction(q):
    ql = ' {} '.format((q or '').lower())
    if any(w in ql for w in (' dip ', ' dips ', ' below ', ' under ', ' fall ',
                             ' drop ', ' drops ', '<=')):
        return 'below'
    if any(w in ql for w in (' above ', ' reach ', ' reaches ', ' hit ', ' hits ',
                             ' exceed ', '>=', ' over ')):
        return 'above'
    return None


try:
    mk = pm.fetch_open_markets(pages=10, min_volume=50)
    for e in pm.fetch_events(pages=8):
        t = e.get('title') or ''
        if which_coin(t):
            for c in (e.get('markets') or []):
                if not c.get('closed'):
                    c = dict(c)
                    c['_event'] = t
                    mk.append(c)
    spot = closes[-1]
    soon = []
    for m in mk:
        q = m.get('question') or ''
        coin = which_coin(' '.join([q, m.get('_event') or '']))
        if coin != "BTC":
            continue
        d = pm.days_to_resolution(m)
        if d is None or d > 0.5:          # within 12 hours
            continue
        strike = parse_strike(m)
        dirn = direction(q)
        bid, ask, last = pm.best_prices(m)
        if not strike or not dirn or ask is None:
            continue
        mins = max(1, int(d * 24 * 60))
        gap = strike / spot - 1.0
        h = min(HORIZONS, key=lambda x: abs(x - mins))
        p = p_above(DISTS[h], gap)
        if dirn == 'below':
            p = 1 - p
        soon.append({'q': q[:50], 'mins': mins, 'gap': gap, 'ask': ask,
                     'bid': bid, 'fair': p, 'edge': p - ask, 'h': h})
    soon.sort(key=lambda r: -r['edge'])
    if soon:
        print('  BTC spot ${:,.0f}   |   {} markets resolving within 12h'.format(
            spot, len(soon)))
        print('\n  {:50}{:>8}{:>9}{:>8}{:>8}{:>9}{:>9}'.format(
            'market', 'mins', 'gap', 'bid', 'ask', 'fair', 'edge'))
        print('  ' + '-' * 101)
        for r in soon[:15]:
            print('  {:50}{:>8}{:>9}{:>8}{:>8}{:>9}{:>9}'.format(
                r['q'], r['mins'], '{:+.2%}'.format(r['gap']),
                '{:.3f}'.format(r['bid']) if r['bid'] is not None else '-',
                '{:.3f}'.format(r['ask']), '{:.3f}'.format(r['fair']),
                '{:+.3f}'.format(r['edge'])))
    else:
        print('  no BTC markets resolving within 12 hours in the current pool')
except Exception as e:
    print('  live check failed: {}'.format(e))

# ------------------------------------------------------------------ honest limits
print("""
============================================================================================================
4. WHAT WOULD MAKE THIS WRONG - read before acting on any edge above

  ONE MONTH OF MINUTES IS NOT A TAIL. The distribution above covers 30 days. It
  contains no flash crash, no exchange halt, no liquidation cascade. Those are
  exactly the events that resolve a near-certain contract against you, and they are
  precisely what a thirty-day sample cannot see. Every probability above should be
  read as "in ordinary conditions".

  THE RUIN ASYMMETRY IS BRUTAL HERE. At 0.95 you collect 5.3% and risk 100%, so one
  loss undoes nineteen wins. At 0.99 it takes ninety-nine. A strategy of buying
  near-certain favourites has a return profile identical to selling insurance: it
  works, quietly, until the one event it is not priced for.

  SETTLEMENT IS NOT THE SAME AS PRICE. Polymarket resolves against its own stated
  source and rules, not against Hyperliquid's last trade. A market can settle
  differently from what the underlying did - disputes, oracle timing, the exact
  measurement instant. That risk is invisible in every number here.

  SO THE HONEST NEXT STEP IS MEASUREMENT, NOT A TRADE. poly_collector.py should
  sample these markets every minute through their final hour, so the hypothesis can
  be tested on what actually happens rather than on what a model says should. Until
  a few hundred resolutions have been observed, any edge above is a conjecture with
  arithmetic attached.""")
