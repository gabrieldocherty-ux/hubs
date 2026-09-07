"""
Position sizing: four schemes, measured against each other on the real trades.

Current behaviour is FIXED NOTIONAL - every position is $16.25 regardless of the
coin, the volatility, or the signal. That has a flaw nobody has checked: the stop
is 2.5x ATR, which is a different percentage on every coin, so a stop-out costs a
different amount each time.

    BTC  8.38% stop x $16.25 = $1.36 lost on a stop
    HYPE 20.26% stop x $16.25 = $3.29 lost on a stop

Risk per trade varies by 2.4x across the basket, entirely by accident. Nothing
chose that.

Four schemes, each with a stated rationale:

  FIXED       what ships today. Simple, and the $10 minimum never binds.
  RISK-PARITY size = risk_budget / stop_distance, so every stop-out costs the
              same dollar amount. The classic constant-risk-per-trade rule.
  VOL-TARGET  size = base x (target_vol / realised_vol), the CTA standard -
              bigger in calm regimes, smaller in violent ones, so portfolio risk
              is steady across regimes rather than dominated by a few episodes.
  CONVICTION  size proportional to signal strength. Already validated separately
              (+1.17pp return per dollar risked, benefit LARGER out of sample).

Plus the combinations that matter.

EVALUATION - and this is where sizing comparisons usually go wrong. A scheme that
deploys more capital will show a bigger total P&L and prove nothing. Everything
below is judged on RETURN PER DOLLAR DEPLOYED and on risk-adjusted terms, with
total P&L shown only for context.

Both hard rails are enforced throughout: nothing exceeds 20% of capital, and
anything under Hyperliquid's $10 minimum is SKIPPED, not shrunk - so a scheme
that quietly drops trades is caught rather than credited.
"""
import sys, math, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
CAPITAL = 250.0
BASE_POS = 16.25
MAX_POS = CAPITAL * 0.20
MIN_ORDER = 10.0
TARGET_VOL = 0.60          # annualised; crypto runs hot, see the calibration note


def gather():
    """Every trade with the context sizing would have had at entry."""
    rows = []
    specs = [('S3', volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}, 60),
             ('D1', range_breakout,
              {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}, 60)]
    for tag, fn, params, warm in specs:
        for c in COINS:
            bars, fund = pooled.load(c)
            atr = engine.atr_series(bars, 14)
            closes = [b['c'] for b in bars]
            vol = engine.logret_vol_series(closes, 20)
            idx = {b['t']: i for i, b in enumerate(bars)}
            r = engine.backtest(bars, fn(params)(), c, fund, name=tag, warmup=warm)
            for t in r.trades:
                i = idx.get(t.entry_t)
                if i is None or i == 0 or not atr[i] or not vol[i]:
                    continue
                sb = bars[i - 1]
                rows.append({
                    'tag': tag, 'coin': c, 'pnl': t.pnl_pct, 'entry_t': t.entry_t,
                    'stop_pct': 2.5 * atr[i] / t.entry_price,
                    'ann_vol': vol[i] * math.sqrt(365),
                    'strength': (sb['h'] - sb['l']) / atr[i - 1] if atr[i - 1] else 1.5,
                })
    # B1 uses its own runner
    per, _ = run_basis.run(run_basis.BASE)
    for c, r in per.items():
        bars, _ = pooled.load(c)
        atr = engine.atr_series(bars, 14)
        vol = engine.logret_vol_series([b['c'] for b in bars], 20)
        idx = {b['t']: i for i, b in enumerate(bars)}
        for t in r.trades:
            i = idx.get(t.entry_t)
            if i is None or i == 0 or not atr[i] or not vol[i]:
                continue
            rows.append({'tag': 'B1', 'coin': c, 'pnl': t.pnl_pct, 'entry_t': t.entry_t,
                         'stop_pct': 2.5 * atr[i] / t.entry_price,
                         'ann_vol': vol[i] * math.sqrt(365), 'strength': 1.5})
    rows.sort(key=lambda r: r['entry_t'])
    return rows


ROWS = gather()
print('=' * 118)
print('0. THE PROBLEM WITH FIXED NOTIONAL: risk per trade is accidental')
print('=' * 118)
print('  {:<8}{:>14}{:>18}{:>20}{:>16}'.format(
    'coin', 'median stop', 'loss if stopped', 'as % of capital', 'ann. vol'))
for c in COINS:
    sel = [r for r in ROWS if r['coin'] == c]
    if not sel:
        continue
    s = st.median([r['stop_pct'] for r in sel])
    v = st.median([r['ann_vol'] for r in sel])
    print('  {:<8}{:>14}{:>18}{:>20}{:>16}'.format(
        c, '{:.2%}'.format(s), '${:.2f}'.format(s * BASE_POS),
        '{:.2%}'.format(s * BASE_POS / CAPITAL), '{:.0%}'.format(v)))
allstops = [r['stop_pct'] for r in ROWS]
print('\n  spread across the basket: ${:.2f} to ${:.2f} per stop-out - a {:.1f}x range'.format(
    min(allstops) * BASE_POS, max(allstops) * BASE_POS, max(allstops) / min(allstops)))
print('  median annualised vol across all trades: {:.0%}  (TARGET_VOL set to {:.0%})'.format(
    st.median([r['ann_vol'] for r in ROWS]), TARGET_VOL))


def size_for(scheme, r):
    if scheme == 'fixed':
        s = BASE_POS
    elif scheme == 'risk_parity':
        # every stop-out costs the same: 0.55% of capital, chosen so the AVERAGE
        # position lands near the current $16.25 and the comparison is fair
        s = (CAPITAL * 0.0055) / max(r['stop_pct'], 0.005)
    elif scheme == 'vol_target':
        s = BASE_POS * (TARGET_VOL / max(r['ann_vol'], 0.05))
    elif scheme == 'conviction':
        s = BASE_POS * max(0.5, min(2.0, r['strength'] / 1.5))
    elif scheme == 'risk_parity+conviction':
        s = ((CAPITAL * 0.0055) / max(r['stop_pct'], 0.005)) * \
            max(0.5, min(2.0, r['strength'] / 1.5))
    elif scheme == 'vol_target+conviction':
        s = BASE_POS * (TARGET_VOL / max(r['ann_vol'], 0.05)) * \
            max(0.5, min(2.0, r['strength'] / 1.5))
    else:
        s = BASE_POS
    return min(s, MAX_POS)


def evaluate(scheme, rows=None):
    rows = rows if rows is not None else ROWS
    pnl = dep = 0.0
    sizes, rets, skipped = [], [], 0
    eq = peak = CAPITAL
    mdd = 0.0
    for r in rows:
        s = size_for(scheme, r)
        if s < MIN_ORDER:
            skipped += 1
            continue
        d = r['pnl'] * s
        pnl += d
        dep += s
        sizes.append(s)
        rets.append(r['pnl'] * s / CAPITAL)
        eq += d
        peak = max(peak, eq)
        mdd = min(mdd, (eq - peak) / peak)
    if not sizes:
        return None
    sd = st.pstdev(rets) if len(rets) > 1 else 0
    return {'pnl': pnl, 'dep': dep, 'per_dollar': pnl / dep, 'n': len(sizes),
            'skipped': skipped, 'avg': st.mean(sizes), 'max': max(sizes),
            'mdd': mdd, 'sharpe': (st.mean(rets) / sd) if sd else 0}


print('\n' + '=' * 118)
print('1. THE SCHEMES, JUDGED ON RETURN PER DOLLAR DEPLOYED')
print('=' * 118)
print('  {:<24}{:>7}{:>9}{:>11}{:>12}{:>16}{:>10}{:>10}'.format(
    'scheme', 'n', 'skipped', 'avg size', 'total P&L', 'per $ deployed', 'maxDD', 'sharpe'))
base = evaluate('fixed')
for scheme in ('fixed', 'risk_parity', 'vol_target', 'conviction',
               'risk_parity+conviction', 'vol_target+conviction'):
    e = evaluate(scheme)
    if not e:
        continue
    mark = '' if scheme == 'fixed' else '  {:+.3f}pp'.format(
        (e['per_dollar'] - base['per_dollar']) * 100)
    print('  {:<24}{:>7}{:>9}{:>11}{:>12}{:>16}{:>10}{:>10}{}'.format(
        scheme, e['n'], e['skipped'], '${:.2f}'.format(e['avg']),
        '${:+.2f}'.format(e['pnl']), '{:+.3f}%'.format(e['per_dollar'] * 100),
        '{:.1%}'.format(e['mdd']), '{:.3f}'.format(e['sharpe']), mark))

print('\n' + '=' * 118)
print('2. OUT-OF-SAMPLE CHECK - does the benefit hold on the second half?')
print('=' * 118)
cut = int(len(ROWS) * 0.6)
for name, sel in (('TRAIN (first 60%)', ROWS[:cut]), ('TEST (last 40%)', ROWS[cut:])):
    b = evaluate('fixed', sel)
    print('\n  {}'.format(name))
    for scheme in ('fixed', 'risk_parity', 'vol_target', 'conviction',
                   'risk_parity+conviction', 'vol_target+conviction'):
        e = evaluate(scheme, sel)
        if not e or not b:
            continue
        print('    {:<24}{:>8}{:>16}{:>12}'.format(
            scheme, e['n'], '{:+.3f}%'.format(e['per_dollar'] * 100),
            '' if scheme == 'fixed' else '{:+.3f}pp'.format(
                (e['per_dollar'] - b['per_dollar']) * 100)))

print('\n' + '=' * 118)
print('3. DOES RISK PER TRADE ACTUALLY BECOME CONSTANT?')
print('=' * 118)
print('  {:<24}{:>18}{:>18}{:>14}'.format(
    'scheme', 'stop-loss cost min', 'stop-loss cost max', 'spread'))
for scheme in ('fixed', 'risk_parity', 'vol_target'):
    costs = []
    for r in ROWS:
        s = size_for(scheme, r)
        if s < MIN_ORDER:
            continue
        costs.append(r['stop_pct'] * s)
    if costs:
        print('  {:<24}{:>18}{:>18}{:>14}'.format(
            scheme, '${:.2f}'.format(min(costs)), '${:.2f}'.format(max(costs)),
            '{:.1f}x'.format(max(costs) / min(costs))))

print('\n' + '=' * 118)
print('4. THE $10 MINIMUM - which schemes hit the floor, and on what?')
print('=' * 118)
for scheme in ('risk_parity', 'vol_target', 'risk_parity+conviction'):
    hits = {}
    for r in ROWS:
        if size_for(scheme, r) < MIN_ORDER:
            hits[r['coin']] = hits.get(r['coin'], 0) + 1
    tot = sum(hits.values())
    print('  {:<24} {} skipped{}'.format(
        scheme, tot, '  ({})'.format(', '.join(
            '{} {}'.format(k, v) for k, v in sorted(hits.items()))) if hits else ''))
print("""
  A scheme skipping trades is not merely sizing - it has become an entry filter,
  and its numbers have to be read as such. This is the failure mode that made a
  'stepped' conviction scheme look excellent earlier when it was quietly
  dropping the weakest 45% of signals.""")
