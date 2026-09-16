"""
Is the data real? Cross-verifying every source this project's conclusions rest on.

This check should have been run before the strategies were built, not after. The
entire Wealthsimple book is an OVERNIGHT strategy - it buys at the close and sells
at the next open - so its results depend completely on Yahoo Finance's `open`
prices being real, tradeable auction prints rather than an artefact of how a free,
undocumented API happens to assemble a bar. That assumption has never been tested.

Three things are checked, in order of how badly a failure would hurt:

  1. INDEPENDENT SOURCE AGREEMENT. Pull the same TSX ETFs from Stooq, a data
     provider with no relationship to Yahoo, and compare bar by bar. Closes
     agreeing but OPENS disagreeing would be the specific, fatal signature: it
     would mean the overnight/intraday split is a property of the data feed rather
     than of the market.

  2. CROSS-INSTRUMENT COHERENCE. VFV.TO holds the S&P 500. Its daily returns must
     track SPY's very closely once currency is accounted for. If VFV's overnight
     return pattern has no counterpart in SPY, the pattern belongs to the ETF's
     quoting, not to the market.

  3. INTERNAL CONSISTENCY. Does open sit inside [low, high]? Are there duplicate
     or missing sessions? Do adjusted prices reconstruct the raw ones?

WHAT A FAILURE WOULD MEAN. If Yahoo's opens turn out to be unreliable, the gated
overnight strategy - Sharpe 3.30, alpha t=11.55 - is not a strategy. It is a
measurement of a data artefact, and it would have to be withdrawn. That is the
honest stake of this file, and it is why it is worth running before any money
moves.
"""
import csv
import datetime
import io
import statistics as st
import sys

import requests

sys.path.insert(0, 'research')
import tsx_data
import tsx_engine as eng

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}


def stooq(sym):
    """Stooq daily OHLCV. Independent of Yahoo - different vendor, different
    upstream feed. Returns {date: {o,h,l,c,v}} using RAW (unadjusted) prices."""
    url = 'https://stooq.com/q/d/l/'
    r = requests.get(url, params={'s': sym, 'i': 'd'}, headers=UA, timeout=30)
    if r.status_code != 200 or len(r.text) < 100:
        return {}
    out = {}
    rdr = csv.DictReader(io.StringIO(r.text))
    for row in rdr:
        try:
            out[row['Date']] = {'o': float(row['Open']), 'h': float(row['High']),
                                'l': float(row['Low']), 'c': float(row['Close']),
                                'v': float(row.get('Volume') or 0)}
        except (ValueError, KeyError, TypeError):
            continue
    return out


print('=' * 108)
print('1. INDEPENDENT SOURCE CHECK: Yahoo vs Stooq on the same instruments')
print('   Yahoo bars are total-return adjusted; Stooq are raw. So the RATIO of')
print('   consecutive prices is compared, not the level - a dividend adjustment')
print('   shifts levels but leaves intraday relationships intact.')
print('=' * 108)

PAIRS = [('VFV.TO', 'vfv.to'), ('XIU.TO', 'xiu.to'), ('ZQQ.TO', 'zqq.to'),
         ('XIC.TO', 'xic.to')]

print('  {:10}{:>10}{:>10}{:>14}{:>14}{:>14}{:>12}'.format(
    'symbol', 'yahoo n', 'stooq n', 'common days', 'OPEN match', 'CLOSE match', 'verdict'))
print('  ' + '-' * 88)

for ysym, ssym in PAIRS:
    try:
        ybars = tsx_data.get(ysym)
    except Exception as e:
        print('  {:10} yahoo fetch failed: {}'.format(ysym, e))
        continue
    sb = stooq(ssym)
    if not sb:
        print('  {:10}{:>10}{:>10}   stooq returned nothing'.format(
            ysym, len(ybars), 0))
        continue
    # Yahoo carries raw_c alongside the adjusted close, so the raw close can be
    # compared directly. For the open, compare the OPEN/CLOSE RATIO within a bar -
    # that is adjustment-invariant because both legs carry the same factor.
    o_diffs, c_diffs, common = [], [], 0
    for b in ybars:
        d = b['d']
        if d not in sb:
            continue
        s = sb[d]
        common += 1
        if s['c'] > 0 and b.get('raw_c'):
            c_diffs.append(abs(b['raw_c'] / s['c'] - 1))
        if s['o'] > 0 and s['c'] > 0 and b['c'] > 0:
            y_ratio = b['o'] / b['c']          # adjustment cancels
            s_ratio = s['o'] / s['c']
            o_diffs.append(abs(y_ratio - s_ratio))
    if common < 50:
        print('  {:10}{:>10}{:>10}{:>14}   too little overlap'.format(
            ysym, len(ybars), len(sb), common))
        continue
    o_med = st.median(o_diffs) if o_diffs else 1
    c_med = st.median(c_diffs) if c_diffs else 1
    verdict = 'MATCH' if (o_med < 0.001 and c_med < 0.001) else (
        'OPEN MISMATCH' if o_med >= 0.001 else 'CLOSE MISMATCH')
    print('  {:10}{:>10}{:>10}{:>14}{:>14}{:>14}{:>12}'.format(
        ysym, len(ybars), len(sb), common,
        '{:.5f}'.format(o_med), '{:.5f}'.format(c_med), verdict))

print("""
  'OPEN match' is the median absolute difference in the open/close ratio between
  the two vendors. Under 0.001 means they agree on where the open sat inside the
  day to within a tenth of a percent, which is agreement. A large number here
  would mean the two feeds disagree about the opening price - and the overnight
  strategy would be dead.""")

# ------------------------------------------------------------------ 2
print('\n' + '=' * 108)
print('2. CROSS-INSTRUMENT COHERENCE: does VFV behave like the S&P 500 it holds?')
print('=' * 108)
try:
    import market_data
    spy, _ = market_data.get_bars('SPY', '1d', '10y')
    spy_by_date = {}
    for i in range(1, len(spy)):
        d = datetime.datetime.fromtimestamp(
            spy[i]['t'] / 1000, datetime.timezone.utc).date().isoformat()
        spy_by_date[d] = {
            'on': (spy[i]['o'] - spy[i - 1]['c']) / spy[i - 1]['c'],
            'id': (spy[i]['c'] - spy[i]['o']) / spy[i]['o'],
            'tot': (spy[i]['c'] - spy[i - 1]['c']) / spy[i - 1]['c']}
    vfv = tsx_data.get('VFV.TO')
    v_on = eng.overnight_returns(vfv)
    v_id = eng.intraday_returns(vfv)
    v_tot = eng.total_returns(vfv)
    v_dates = eng.dates(vfv)
    pairs_on, pairs_id, pairs_tot = [], [], []
    for i, d in enumerate(v_dates):
        if d in spy_by_date:
            pairs_on.append((v_on[i], spy_by_date[d]['on']))
            pairs_id.append((v_id[i], spy_by_date[d]['id']))
            pairs_tot.append((v_tot[i], spy_by_date[d]['tot']))

    def corr(ps):
        a = [x for x, _ in ps]
        b = [y for _, y in ps]
        ma, mb = st.mean(a), st.mean(b)
        va = sum((x - ma) ** 2 for x in a) ** 0.5
        vb = sum((y - mb) ** 2 for y in b) ** 0.5
        return sum((a[i] - ma) * (b[i] - mb) for i in range(len(a))) / (va * vb) if va and vb else 0

    print('  overlapping days: {}'.format(len(pairs_tot)))
    print('  corr( VFV total return , SPY total return )        = {:+.3f}'.format(corr(pairs_tot)))
    print('  corr( VFV OVERNIGHT    , SPY OVERNIGHT    )        = {:+.3f}'.format(corr(pairs_on)))
    print('  corr( VFV intraday     , SPY intraday     )        = {:+.3f}'.format(corr(pairs_id)))
    import institutional as inst
    print('\n  annualised, gross:')
    print('    VFV overnight {:+.2%}   intraday {:+.2%}'.format(
        inst.cagr([x for x, _ in pairs_on]), inst.cagr([x for x, _ in pairs_id])))
    print('    SPY overnight {:+.2%}   intraday {:+.2%}'.format(
        inst.cagr([y for _, y in pairs_on]), inst.cagr([y for _, y in pairs_id])))
    print("""
  THE KEY TEST. VFV is a Canadian wrapper around the S&P 500, quoted on a
  different exchange by different market makers in a different currency. If the
  overnight effect were an artefact of how one venue prints its opens, the two
  would NOT show it independently. If SPY shows the same overnight/intraday split
  on its own feed, the effect belongs to the market.""")
except Exception as e:
    print('  coherence check failed: {}'.format(e))

# ------------------------------------------------------------------ 3
print('\n' + '=' * 108)
print('3. INTERNAL CONSISTENCY of every series this project uses')
print('=' * 108)
print('  {:10}{:>8}{:>10}{:>10}{:>10}{:>12}{:>12}'.format(
    'symbol', 'bars', 'ohlc bad', 'dupes', 'zero vol', 'open==close', '>25% days'))
print('  ' + '-' * 74)
for sym in ('VFV.TO', 'XIU.TO', 'ZQQ.TO', 'XIC.TO', 'HQU.TO', 'CASH.TO'):
    try:
        bars = tsx_data.get(sym)
    except Exception:
        continue
    rep = tsx_data.verify(bars, sym)
    # open == close exactly is a signature of a synthesised or stale bar
    same = sum(1 for b in bars if b['o'] == b['c'])
    print('  {:10}{:>8}{:>10}{:>10}{:>10}{:>12}{:>12}'.format(
        sym, rep['n'], rep['ohlc_violations'], rep['dupes'], rep['zero_volume'],
        same, rep['big_gaps']))
print("""
  'open==close' matters specifically for this project: a bar where the open equals
  the close exactly contributes a zero intraday return and pushes the entire day's
  move into the overnight bucket. A handful is normal on a quiet day; a large
  count would mean the feed is synthesising opens, and would invalidate the
  overnight decomposition.""")
