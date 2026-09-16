"""
NEW MECHANISM: forced deleveraging, read from VIX. Plus honest work on whether
big moves are predictable at all.

WHY THIS IS THE MOST PROMISING UNTESTED IDEA IN THE PROJECT. The taxonomy built
from seventeen crypto strategies produced one durable rule: an edge needs a
counterparty under OBLIGATION - somebody who must trade and cannot choose
otherwise. In crypto that was the liquidation engine. The equity analogue is
volatility-linked forced selling, and it is enormous:

  * Volatility-target funds and risk-parity books hold a fixed RISK budget, not a
    fixed dollar budget. When realised or implied volatility doubles, their
    mandate requires them to halve exposure. They are not choosing to sell.
  * CTA and managed-futures programmes de-risk mechanically on trend breaks.
  * Options dealers short gamma must sell into declines to stay hedged, which
    accelerates the move they are hedging against.
  * Margin calls force liquidation regardless of the holder's view.

All four fire on the same trigger, and VIX is a direct observable of that trigger.
That is a genuine forced-flow mechanism with a public daily time series attached,
and this project has never used it.

THE PREDICTION, stated before testing: a VIX spike marks forced selling that is
unrelated to fundamentals, so it should be followed by ABOVE-AVERAGE forward
returns - you are being paid to absorb supply from people who have no choice. The
dose-response should be monotonic: the bigger the spike, the better the forward
return.

ON "PREDICTING BIG MOVEMENTS" - the honest framing, which is not the intuitive one:
the SIZE of a move is highly forecastable and the DIRECTION is close to
unforecastable. Volatility clusters strongly; returns barely autocorrelate. So the
tradeable form of "predict a big move" is not "call the direction of the crash",
it is "know when the distribution is about to get wide and act on the asymmetry".
Section 3 measures exactly how forecastable magnitude is here, then asks whether
that forecast is worth anything directionally - which is the question that decides
if it can be traded at all.

DATA: ^VIX (30-day implied vol on the S&P 500) and ^VIX3M (3-month). Their RATIO
is the term structure - normally in contango (VIX3M > VIX, calm), and inverting
into backwardation under stress. VFV.TO tracks the S&P 500, so these are the
correct volatility series for it rather than a Canadian proxy.
"""
import datetime
import json
import statistics as st
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng

UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
CACHE = Path(__file__).parent / 'data'


def get_index(sym, rng='25y'):
    """Volatility indices carry no volume and need no dividend adjustment, so they
    are fetched raw rather than through tsx_data's total-return path."""
    path = CACHE / 'idx_{}_{}.json'.format(sym.replace('^', ''), rng)
    if path.exists():
        return json.loads(path.read_text())
    r = requests.get('https://query1.finance.yahoo.com/v8/finance/chart/{}'.format(sym),
                     params={'interval': '1d', 'range': rng}, headers=UA, timeout=30)
    r.raise_for_status()
    res = r.json()['chart']['result'][0]
    ts, q = res['timestamp'], res['indicators']['quote'][0]
    out = {}
    for i, t in enumerate(ts):
        c = q['close'][i]
        if c:
            out[datetime.date.fromtimestamp(t).isoformat()] = float(c)
    path.write_text(json.dumps(out))
    time.sleep(0.35)
    return out


VIX = get_index('^VIX')
VIX3M = get_index('^VIX3M')
print('VIX {} days {} -> {}   VIX3M {} days'.format(
    len(VIX), min(VIX), max(VIX), len(VIX3M)))

vfv = tsx_data.get('VFV.TO')
vfv_ret = eng.total_returns(vfv)
vfv_dates = eng.dates(vfv)
vfv_rt = tsx_data.cost_model('VFV.TO', vfv)[0]
on = [r - vfv_rt for r in eng.overnight_returns(vfv)]


def pctile_series(vals, window=252):
    """Trailing percentile rank - where today's value sits within its own past.
    Uses only prior data, so it is usable as a signal at the close of day i."""
    out = []
    for i in range(len(vals)):
        if i < window:
            out.append(None)
            continue
        w = vals[i - window:i]
        out.append(sum(1 for x in w if x < vals[i]) / len(w))
    return out


# align VIX onto the VFV calendar, carrying the LAST KNOWN value forward so a
# Canadian holiday cannot create a lookahead into a US print
vix_al, ts_al, last_v, last_t = [], [], None, None
for d in vfv_dates:
    if d in VIX:
        last_v = VIX[d]
    if d in VIX and d in VIX3M and VIX[d] > 0:
        last_t = VIX3M[d] / VIX[d]
    vix_al.append(last_v)
    ts_al.append(last_t)

vix_pct = pctile_series([v if v else 0 for v in vix_al])

# ---------------------------------------------------------------- 1. dose-response
print('\n' + '=' * 112)
print('1. FORCED-DELEVERAGING DOSE-RESPONSE')
print('   Sort every day by where VIX sits in its own trailing year, then measure')
print('   what the NEXT day paid. Monotonic = the mechanism is real.')
print('=' * 112)
print('  {:26}{:>8}{:>13}{:>13}{:>13}{:>11}'.format(
    'VIX percentile bucket', 'n', 'next-day tot', 'next-day ON', 'next 5d', 'win rate'))
print('  ' + '-' * 86)
BUCKETS = [(0.0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 0.9),
           (0.9, 0.97), (0.97, 1.01)]
for lo, hi in BUCKETS:
    nxt, nxt_on, nxt5 = [], [], []
    for i in range(len(vfv_dates) - 6):
        p = vix_pct[i] if i < len(vix_pct) else None
        if p is None or not (lo <= p < hi):
            continue
        nxt.append(vfv_ret[i + 1])
        if i + 1 < len(on):
            nxt_on.append(on[i + 1])
        nxt5.append(sum(vfv_ret[i + 1:i + 6]))
    if len(nxt) < 20:
        continue
    print('  {:26}{:>8}{:>13}{:>13}{:>13}{:>11}'.format(
        'VIX pct {:.0%}-{:.0%}'.format(lo, min(hi, 1.0)), len(nxt),
        '{:+.3f}%'.format(st.mean(nxt) * 100),
        '{:+.3f}%'.format(st.mean(nxt_on) * 100) if nxt_on else '-',
        '{:+.2f}%'.format(st.mean(nxt5) * 100),
        '{:.0%}'.format(sum(1 for x in nxt if x > 0) / len(nxt))))

# ---------------------------------------------------------------- 2. term structure
print('\n' + '=' * 112)
print('2. TERM STRUCTURE: VIX3M / VIX')
print('   Above 1 = contango = calm. Below 1 = backwardation = stress and forced')
print('   selling. This is the cleanest single read on whether the deleveraging')
print('   machine is currently running.')
print('=' * 112)
print('  {:26}{:>8}{:>13}{:>13}{:>13}{:>11}'.format(
    'term structure', 'n', 'next-day tot', 'next-day ON', 'next 5d', 'win rate'))
print('  ' + '-' * 86)
TS_B = [(0.0, 0.90), (0.90, 0.97), (0.97, 1.00), (1.00, 1.05),
        (1.05, 1.10), (1.10, 1.15), (1.15, 9.0)]
for lo, hi in TS_B:
    nxt, nxt_on, nxt5 = [], [], []
    for i in range(len(vfv_dates) - 6):
        t = ts_al[i]
        if t is None or not (lo <= t < hi):
            continue
        nxt.append(vfv_ret[i + 1])
        if i + 1 < len(on):
            nxt_on.append(on[i + 1])
        nxt5.append(sum(vfv_ret[i + 1:i + 6]))
    if len(nxt) < 20:
        continue
    print('  {:26}{:>8}{:>13}{:>13}{:>13}{:>11}'.format(
        'VIX3M/VIX {:.2f}-{:.2f}'.format(lo, hi if hi < 9 else 99), len(nxt),
        '{:+.3f}%'.format(st.mean(nxt) * 100),
        '{:+.3f}%'.format(st.mean(nxt_on) * 100) if nxt_on else '-',
        '{:+.2f}%'.format(st.mean(nxt5) * 100),
        '{:.0%}'.format(sum(1 for x in nxt if x > 0) / len(nxt))))

# ---------------------------------------------------------------- 3. big moves
print('\n' + '=' * 112)
print('3. ARE BIG MOVES PREDICTABLE? Magnitude vs direction, separated.')
print('=' * 112)
abs_ret = [abs(r) for r in vfv_ret]
lag_abs = abs_ret[:-1]
nxt_abs = abs_ret[1:]


def corr(a, b):
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    ma, mb = st.mean(a), st.mean(b)
    va = sum((x - ma) ** 2 for x in a) ** 0.5
    vb = sum((x - mb) ** 2 for x in b) ** 0.5
    return sum((a[i] - ma) * (b[i] - mb) for i in range(n)) / (va * vb) if va and vb else 0


print('  corr( |return| today , |return| tomorrow )      = {:+.3f}   <- MAGNITUDE'.format(
    corr(lag_abs, nxt_abs)))
print('  corr(  return  today ,  return  tomorrow )      = {:+.3f}   <- DIRECTION'.format(
    corr(vfv_ret[:-1], vfv_ret[1:])))
vp = [p for p in vix_pct if p is not None]
va = [abs_ret[i] for i, p in enumerate(vix_pct) if p is not None and i < len(abs_ret)]
print('  corr( VIX percentile , |return| tomorrow )      = {:+.3f}'.format(corr(vp, va)))
print("""
  This is the central fact about forecasting big moves, and it is not the
  intuitive one: magnitude is strongly predictable and direction is barely
  predictable at all. Knowing a big move is coming tells you the distribution is
  about to get wide - it does not tell you which side. That is why the profitable
  use of a volatility forecast is SIZING (be smaller when the range widens) rather
  than direction-picking, and it is why the vol-managed overlay works while
  'predict the crash' does not.""")

# ---------------------------------------------------------------- 4. tradeable
print('\n' + '=' * 112)
print('4. IS IT TRADEABLE? VIX-gated overlays on the overnight sleeve')
print('   Baseline to beat: VFV overnight + vol + trend = +18.57% CAGR, Sharpe')
print('   2.56, maxDD -8.5%, alpha t 8.88 (at open) / 3.72 (bad fill).')
print('=' * 112)
closes = [b['c'] for b in vfv]
ma100 = eng.sma(closes, 100)
vol20 = eng.rolling_vol(vfv_ret, 20)


def build(use_vix_pct=None, use_ts=None, use_trend=True, use_vol=True, bad=False):
    out, ws = [], []
    for i in range(len(on)):
        w = 1.0
        if use_vol:
            v = vol20[i - 1] if i > 0 else None
            w = 0.0 if (v is None or v <= 0) else min(1.0, (0.15 / (252 ** 0.5)) / v)
        if use_trend:
            m = ma100[i] if i < len(ma100) else None
            if m is None or closes[i] <= m:
                w = 0.0
        if use_vix_pct is not None:
            p = vix_pct[i] if i < len(vix_pct) else None
            if p is None or p > use_vix_pct:
                w = 0.0
        if use_ts is not None:
            t = ts_al[i] if i < len(ts_al) else None
            if t is None or t < use_ts:
                w = 0.0
        r = on[i]
        if bad:
            o = vfv[i + 1]['o']
            r = (o - 0.10 * (o - vfv[i + 1]['l']) - vfv[i]['c']) / vfv[i]['c'] - vfv_rt
        out.append(w * r)
        ws.append(w)
    return out, ws


print('  {:36}{:>10}{:>9}{:>9}{:>9}{:>9}{:>10}'.format(
    'variant', 'CAGR', 'Sharpe', 'maxDD', 'Calmar', 'expo', 'alpha t'))
VARIANTS = [
    ('baseline: vol + trend', {}),
    ('  + skip VIX top 10%', {'use_vix_pct': 0.90}),
    ('  + skip VIX top 20%', {'use_vix_pct': 0.80}),
    ('  + require contango >1.00', {'use_ts': 1.00}),
    ('  + require contango >1.05', {'use_ts': 1.05}),
    ('  + contango >1.00 & VIX<90%', {'use_ts': 1.00, 'use_vix_pct': 0.90}),
]
for label, kw in VARIANTS:
    for bad in (False, True):
        r, w = build(bad=bad, **kw)
        a = inst.attribution(r, vfv_ret[:len(r)])
        mdd = inst.max_drawdown(r)
        print('  {:36}{:>10}{:>9}{:>9}{:>9}{:>9}{:>10}{}'.format(
            label if not bad else '', '{:+.2%}'.format(inst.cagr(r)),
            '{:.2f}'.format(inst.sharpe(r)), '{:.1%}'.format(mdd),
            '{:.2f}'.format(inst.cagr(r) / abs(mdd) if mdd else 0),
            '{:.0%}'.format(st.mean(w)),
            '{:.2f}'.format(a['t_alpha']) if a else '-',
            '   BAD FILL' if bad else ''))
