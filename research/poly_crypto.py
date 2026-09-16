"""
Polymarket crypto threshold markets: how far below spot, and how close to expiry,
does a strike have to be before the trade is genuinely safe - and is the market
paying enough for that safety?

WHY THIS ONE IS DIFFERENT FROM EVERY OTHER POLYMARKET IDEA HERE. The calibration
study was abandoned because Polymarket serves no price history, so there was no
way to check whether a contract priced at 5% resolves YES 5% of the time.

Crypto threshold markets escape that problem completely. A market asking "Will
Bitcoin be above $X on date D?" has a true probability that does not depend on
Polymarket's history at all - it depends on BITCOIN's history, which is freely
available going back a decade. So the fair value can be computed independently and
compared to what the market charges. That is the calibration test, done from the
other side.

THE QUESTION BEING ANSWERED, in the user's terms: for a strike sitting some
distance BELOW spot, with some number of days left, what is the real chance price
falls through it - and what is the market paying to take that risk?

THREE WAYS OF ESTIMATING THE TRUE PROBABILITY, because they fail differently:

  EMPIRICAL   count how often, historically, BTC actually fell more than X% over
              a window of N days. Uses overlapping windows across the whole
              sample. Makes no distributional assumption, so it captures fat
              tails and crashes as they really happened - but it can only report
              events that occurred, and the worst crash in the sample is a floor
              on badness, not a ceiling.
  LOGNORMAL   the Black-Scholes assumption. Analytic and smooth, and it
              UNDERSTATES tail risk badly for crypto, which is exactly the
              direction that would make a dangerous trade look safe. Shown for
              contrast, never relied on.
  STRESSED    the empirical distribution with the worst 1% of windows weighted as
              though they were 5x more likely. A deliberate pessimism, because the
              whole point of a "safe" trade is that it must survive the case the
              sample happens not to contain.

THE TRAP THIS IS BUILT TO EXPOSE. A contract at 0.99 that resolves YES 99.5% of
the time is a good trade. The SAME contract is a catastrophe if it resolves YES
98% of the time, because you collect 1 cent to risk 99. At these prices the
asymmetry is brutal: being wrong once costs what 99 wins earn. So the output
reports not just the edge but the RUIN ARITHMETIC - how many consecutive wins one
loss undoes - and the annualised return on capital that is locked until expiry.
"""
import datetime
import json
import math
import re
import statistics as st
import sys

import requests

sys.path.insert(0, 'research')
import polymarket_data as pm

UA = {'User-Agent': 'Mozilla/5.0'}
RISK_FREE = 0.03


# ------------------------------------------------------------------ underlying
def yahoo_daily(sym, rng='10y'):
    r = requests.get('https://query1.finance.yahoo.com/v8/finance/chart/{}'.format(sym),
                     params={'interval': '1d', 'range': rng}, headers=UA, timeout=30)
    r.raise_for_status()
    res = r.json()['chart']['result'][0]
    ts, q = res['timestamp'], res['indicators']['quote'][0]
    out = []
    for i, t in enumerate(ts):
        c = q['close'][i]
        if c:
            out.append({'d': datetime.date.fromtimestamp(t).isoformat(), 'c': float(c)})
    return out


def horizon_moves(closes, days):
    """Every overlapping N-day return in the sample. Overlapping windows overstate
    the effective sample size for significance testing, but they are the right
    choice for estimating a TAIL - you want every path the market actually took,
    not a thinned subset that might miss the crash."""
    return [(closes[i + days] / closes[i] - 1) for i in range(len(closes) - days)]


def empirical_p_above(moves, drop_needed):
    """P(price stays above the strike) = P(return > drop_needed).
    drop_needed is negative when the strike is below spot."""
    if not moves:
        return None
    return sum(1 for m in moves if m > drop_needed) / len(moves)


def stressed_p_above(moves, drop_needed, weight=5.0, tail=0.01):
    """Same, but the worst 1% of windows count 5x. A safe-looking trade that
    fails this is relying on the sample being lucky."""
    if not moves:
        return None
    s = sorted(moves)
    k = max(1, int(len(s) * tail))
    worst = set(id(x) for x in s[:k])
    num = den = 0.0
    for i, m in enumerate(s):
        w = weight if i < k else 1.0
        den += w
        if m > drop_needed:
            num += w
    return num / den if den else None


def lognormal_p_above(drop_needed, sigma_ann, days):
    """Black-Scholes style. Included to show how much it understates crypto tails."""
    if days <= 0 or sigma_ann <= 0:
        return 1.0 if drop_needed < 0 else 0.0
    t = days / 365.0
    s = sigma_ann * math.sqrt(t)
    x = math.log(1 + drop_needed)
    z = (-x) / s + 0.5 * s
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


# ------------------------------------------------------------------ markets
STRIKE_RE = re.compile(r'\$([0-9][0-9,\.]*)\s*([kKmM]?)')


def _num(txt):
    m = STRIKE_RE.search(txt or '')
    if not m:
        return None
    try:
        v = float(m.group(1).replace(',', ''))
    except ValueError:
        return None
    suf = (m.group(2) or '').lower()
    if suf == 'k':
        v *= 1_000
    elif suf == 'm':
        v *= 1_000_000
    return v


def parse_strike(mk):
    """The strike lives in one of two places and the second is easy to miss.

    Standalone markets carry it in the question: "Will Bitcoin hit $120,000 by...".
    But Polymarket's threshold LADDERS - the interesting ones, where one event
    holds a market per price level - render the question with a blank
    ("Ethereum above ___ on September 11?") and put the level in `groupItemTitle`.
    Reading only the question silently skips every laddered market, which is most
    of the crypto ones. That is why the first scan returned nothing.
    """
    if isinstance(mk, str):
        return _num(mk)
    for field in ('groupItemTitle', 'question'):
        v = _num(mk.get(field))
        if v:
            return v
    return None


def direction(q):
    """Direction MUST be read from the market's own question and nothing else.

    An earlier version passed a concatenation of question + event title + slug,
    which inverted the answer on every laddered market: "Will Solana dip to $10?"
    sits inside an event called "What price will Solana hit in September?", and the
    word "hit" in the PARENT flipped a downside market to upside. Every 'dip'
    market was then scored as though it needed price to RISE, which turned
    correctly-priced 0.002 contracts into apparent +0.998 edges. Nothing is more
    dangerous than a bug that manufactures enormous free money.
    """
    ql = ' {} '.format((q or '').lower())
    if any(w in ql for w in (' dip ', ' dips ', ' below ', ' under ', ' fall ',
                             ' falls ', ' drop ', ' drops ', '<=', ' down to ')):
        return 'below'
    if any(w in ql for w in (' above ', ' reach ', ' reaches ', ' hit ', ' hits ',
                             ' exceed ', ' exceeds ', '>=', ' over ')):
        return 'above'
    return None


COINS = [('bitcoin', 'BTC-USD', 'BTC'), ('btc', 'BTC-USD', 'BTC'),
         ('ethereum', 'ETH-USD', 'ETH'), ('eth', 'ETH-USD', 'ETH'),
         ('solana', 'SOL-USD', 'SOL'), ('sol', 'SOL-USD', 'SOL')]
_WORD = {}
for _name, _y, _t in COINS:
    _WORD[_name] = re.compile(r'(?<![a-z])' + _name + r'(?![a-z])')


def which_coin(q):
    """Word-boundary matching, because plain substring search is wrong here:
    'eth' is inside 'Ethena', so "Will Ethena reach $1.20?" was being priced
    against Ethereum's price history - comparing a $1 token to a $2,500 one and
    producing a -100% 'buffer' that looked like a certainty."""
    ql = (q or '').lower()
    for name, ysym, tag in COINS:
        if _WORD[name].search(ql):
            return (ysym, tag)
    return None


print('=' * 116)
print('POLYMARKET CRYPTO THRESHOLDS: how safe is "safe", and what does it pay?')
print('=' * 116)

hist, spot, vol = {}, {}, {}
for ysym, tag in sorted({(y, t) for _n, y, t in COINS}):
    try:
        bars = yahoo_daily(ysym)
        closes = [b['c'] for b in bars]
        hist[tag] = closes
        spot[tag] = closes[-1]
        rets = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes))]
        vol[tag] = st.pstdev(rets[-365:]) * math.sqrt(365)
        print('  {} history {} days, spot ${:,.0f}, trailing 1y vol {:.0%}'.format(
            tag, len(closes), spot[tag], vol[tag]))
    except Exception as e:
        print('  {} failed: {}'.format(tag, e))

print('\n--- the shape of the risk, before looking at any market ---')
print('  How often did BTC fall MORE than X% over N days, historically?')
print('  {:>10}'.format('drop') + ''.join('{:>10}'.format('{}d'.format(d))
                                          for d in (1, 3, 7, 14, 30, 60)))
print('  ' + '-' * 70)
if 'BTC' in hist:
    for drop in (0.02, 0.05, 0.10, 0.15, 0.20, 0.30):
        cells = []
        for d in (1, 3, 7, 14, 30, 60):
            mv = horizon_moves(hist['BTC'], d)
            p = 1 - empirical_p_above(mv, -drop)
            cells.append('{:>10}'.format('{:.2%}'.format(p)))
        print('  {:>10}'.format('-{:.0%}'.format(drop)) + ''.join(cells))
print("""
  This table IS the answer to "how far below spot is safe". A 20% buffer over 7
  days has essentially never breached; a 5% buffer over 30 days breaches often
  enough to matter. Everything below prices those probabilities against what the
  market charges.""")

# ------------------------------------------------------------------ live scan
print('\n' + '=' * 116)
print('LIVE CRYPTO MARKETS - fair value vs what is being charged')
print('=' * 116)
# Pull from EVENTS as well as markets: laddered threshold markets sit inside an
# event whose title names the coin, while each child market's question may not.
mk = pm.fetch_open_markets(pages=10, min_volume=50)
seen = set(m.get('id') for m in mk)
for e in pm.fetch_events(pages=8):
    title = e.get('title') or ''
    if not which_coin(title):
        continue
    for child in (e.get('markets') or []):
        if child.get('id') in seen or child.get('closed'):
            continue
        child = dict(child)
        child['_event'] = title
        mk.append(child)
        seen.add(child.get('id'))
print('  markets in scan pool: {}'.format(len(mk)))

rows = []
for m in mk:
    q = m.get('question') or ''
    ctx = ' '.join([q, m.get('_event') or '', m.get('slug') or ''])
    coin = which_coin(ctx)
    if not coin:
        continue
    tag = coin[1]
    if tag not in hist:
        continue
    strike = parse_strike(m)
    d = direction(q)          # question ONLY - see the note in direction()
    days = pm.days_to_resolution(m)
    bid, ask, last = pm.best_prices(m)
    if not strike or not d or days is None or days <= 0 or ask is None:
        continue
    s = spot[tag]
    move_needed = strike / s - 1.0        # signed move required to reach strike
    n = max(1, int(round(days)))
    mv = horizon_moves(hist[tag], min(n, 90))
    if d == 'above':
        p_emp = empirical_p_above(mv, move_needed)
        p_str = stressed_p_above(mv, move_needed)
        p_ln = lognormal_p_above(move_needed, vol[tag], n)
    else:
        p_emp = 1 - empirical_p_above(mv, move_needed)
        p_str = 1 - stressed_p_above(mv, move_needed)
        p_ln = 1 - lognormal_p_above(move_needed, vol[tag], n)
    if p_emp is None:
        continue
    rows.append({'q': q[:52], 'coin': tag, 'strike': strike, 'spot': s,
                 'buf': move_needed, 'days': days, 'bid': bid, 'ask': ask,
                 'p_emp': p_emp, 'p_str': p_str, 'p_ln': p_ln,
                 'edge_buy': p_str - ask,          # buy YES: pay ask, worth p
                 'vol': float(m.get('volumeNum') or 0)})

rows.sort(key=lambda r: -r['edge_buy'])
print('  {:50}{:>8}{:>7}{:>8}{:>8}{:>8}{:>8}{:>9}'.format(
    'market', 'buffer', 'days', 'ask', 'P emp', 'P str', 'P ln', 'edge'))
print('  ' + '-' * 106)
for r in rows[:22]:
    print('  {:50}{:>8}{:>7}{:>8}{:>8}{:>8}{:>8}{:>9}'.format(
        r['q'], '{:+.1%}'.format(r['buf']), '{:.0f}'.format(r['days']),
        '{:.3f}'.format(r['ask']), '{:.3f}'.format(r['p_emp']),
        '{:.3f}'.format(r['p_str']), '{:.3f}'.format(r['p_ln']),
        '{:+.3f}'.format(r['edge_buy'])))

# ------------------------------------------------------------------ ruin math
print('\n' + '=' * 116)
print('THE RUIN ARITHMETIC - why a 0.98 contract is not "nearly free money"')
print('=' * 116)
print('  {:>8}{:>14}{:>16}{:>18}{:>20}'.format(
    'price', 'profit if win', 'loss if wrong', 'wins to undo 1 loss', 'breakeven win rate'))
print('  ' + '-' * 78)
for p in (0.90, 0.95, 0.97, 0.98, 0.99, 0.995):
    win = (1.0 - p) / p
    lose = 1.0
    print('  {:>8}{:>14}{:>16}{:>18}{:>20}'.format(
        '{:.3f}'.format(p), '{:+.2%}'.format(win), '{:.0%}'.format(-lose),
        '{:.0f}'.format(lose / win), '{:.3%}'.format(p)))
print("""
  Read the last two columns together. At 0.99 you need 99 consecutive wins to pay
  for one loss, and you need to be right 99.0% of the time just to break even. The
  question is never "is this likely" - it is "is it MORE likely than the price",
  and at these levels the market has to be wrong by a very small amount in the
  right direction for the trade to work at all.""")

# ------------------------------------------------------------------ the answer
print('\n' + '=' * 116)
print('SAFEST STRUCTURE: what the history says about buffer and time')
print('=' * 116)
if 'BTC' in hist:
    print('  {:>8}{:>12}{:>14}{:>16}{:>18}'.format(
        'days', 'buffer', 'P(survive)', 'worst in sample', 'fair price'))
    print('  ' + '-' * 68)
    for dd in (1, 3, 7, 14, 30):
        mv = horizon_moves(hist['BTC'], dd)
        worst = min(mv)
        for buf in (0.10, 0.20, 0.30):
            p = empirical_p_above(mv, -buf)
            ps = stressed_p_above(mv, -buf)
            print('  {:>8}{:>12}{:>14}{:>16}{:>18}'.format(
                dd, '-{:.0%}'.format(buf), '{:.4f}'.format(p),
                '{:.1%}'.format(worst), '{:.4f} (stressed)'.format(ps)))
    print("""
  'worst in sample' is the deepest fall BTC actually made over that window in ten
  years. A buffer smaller than that number has been breached in living memory, and
  a buffer larger than it has not - which is the only honest definition of "safe"
  available from data, and still not a guarantee, because the worst thing that has
  happened is not the worst thing that can.""")
