"""
The three surviving sleeves, whether they are actually three bets, and what they
are worth on $1000.

WHAT SURVIVED, and what did not:

  1. OVERNIGHT on VFV.TO          the day-trading sleeve. 252 round trips a year.
  2. VOLATILITY-MANAGED on VFV.TO alpha t=2.78, PBO 10.3%, ~2 trades a year.
  3. TREND long/flat on XIU.TO    defensive; turns a -47.9% drawdown into -14.4%.

  REJECTED: turn-of-month. Across 72 cells exactly one cleared DSR 0.95, alpha
  t-statistics sat near zero, ZEB was negative and HXT returned PBO 85.7%. Its
  return tracked its exposure, which means it was a smaller position rather than
  a strategy. It is recorded as a rejection rather than padded into a third slot.

THE QUESTION THIS FILE EXISTS TO ANSWER. This project's own taxonomy work found
that seventeen crypto strategies collapsed into two real bets, because nobody had
checked position overlap until late. Two of the three sleeves here are long/flat
equity rules that both go defensive in turbulence - they could easily be the same
bet wearing different parameters. Correlation between their RETURN STREAMS, and
between their EXPOSURES, decides whether this is a portfolio or a concentration.

A STRUCTURAL POINT ABOUT COMBINING THEM. Overnight holds from the close to the
next open; trend and vol-managed hold continuously, which INCLUDES that same
overnight window. Run on the same dollar they collide - a continuously-held
position already owns the overnight. So they are not additive by construction and
the combination has to be built as an allocation of capital, not as a stack of
signals. That is measured below rather than assumed away.
"""
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng
from strategy_trend_tom import trend_weights
from strategy_volmanaged import volmanaged_weights

CAPITAL = 1000.0


def corr(a, b):
    n = min(len(a), len(b))
    a, b = a[-n:], b[-n:]
    ma, mb = st.mean(a), st.mean(b)
    va = sum((x - ma) ** 2 for x in a) ** 0.5
    vb = sum((x - mb) ** 2 for x in b) ** 0.5
    return sum((a[i] - ma) * (b[i] - mb) for i in range(n)) / (va * vb) if va and vb else 0.0


def align(streams):
    """Trim every stream to the shortest, so correlations are computed on a
    common window rather than on different eras."""
    n = min(len(s) for s in streams.values())
    return {k: v[-n:] for k, v in streams.items()}, n


vfv = tsx_data.get('VFV.TO')
xiu = tsx_data.get('XIU.TO')
vfv_ret, xiu_ret = eng.total_returns(vfv), eng.total_returns(xiu)
vfv_rt = tsx_data.cost_model('VFV.TO', vfv)[0]
xiu_rt = tsx_data.cost_model('XIU.TO', xiu)[0]

# --- sleeve 1: overnight VFV, at the modelled cost AND at a realistic bad fill
on_raw = eng.overnight_returns(vfv)
S1 = [r - vfv_rt for r in on_raw]
S1_bad = []
for i in range(1, len(vfv)):
    o = vfv[i]['o']
    fill = o - 0.10 * (o - vfv[i]['l'])          # 10% of the way to the session low
    S1_bad.append((fill - vfv[i - 1]['c']) / vfv[i - 1]['c'] - vfv_rt)

# --- sleeve 2: vol-managed VFV, the middle of the robust region (not the best cell)
w2 = volmanaged_weights(vfv_ret, 20, 0.10)
S2 = eng.run(w2, vfv_ret, vfv_rt)

# --- sleeve 3: trend XIU, mid-grid
w3 = trend_weights(xiu, 100, 3)
S3 = eng.run(w3, xiu_ret, xiu_rt)

streams, n = align({'overnight_VFV': S1, 'volmanaged_VFV': S2, 'trend_XIU': S3})
print('=' * 116)
print('1. ARE THESE THREE BETS OR ONE?   (common window: {} days = {:.1f} years)'.format(
    n, n / 252))
print('=' * 116)
keys = list(streams)
print('  {:20}'.format('') + ''.join('{:>16}'.format(k) for k in keys))
for a in keys:
    print('  {:20}'.format(a) + ''.join(
        '{:>16}'.format('{:+.3f}'.format(corr(streams[a], streams[b]))) for b in keys))
print("""
  Above ~0.6 two sleeves are the same bet and the second adds nothing. Note the
  structural reason to expect correlation here: vol-managed and trend are both
  long/flat rules on equity indices that de-risk in turbulence, and VFV and XIU
  are both equity. Overnight is the one that should differ, because it is exposed
  during hours the other two are not.""")

# ------------------------------------------------------------------ 2. per sleeve
print('\n' + '=' * 116)
print('2. EACH SLEEVE ON ITS OWN')
print('=' * 116)
print(inst.report('1 overnight VFV (at open)', S1, bench=vfv_ret[-len(S1):], n_trials=1))
print(inst.report('1 overnight VFV (bad fill)', S1_bad, bench=vfv_ret[-len(S1_bad):], n_trials=1))
print(inst.report('2 vol-managed VFV', S2, bench=vfv_ret, n_trials=12))
print(inst.report('3 trend XIU SMA100x3', S3, bench=xiu_ret, n_trials=10))
print(inst.report('   benchmark: buy & hold VFV', vfv_ret, n_trials=1))
print(inst.report('   benchmark: buy & hold XIU', xiu_ret, n_trials=1))

# ------------------------------------------------------------------ 3. combined
print('\n' + '=' * 116)
print('3. THE COMBINED BOOK ON ${:,.0f}'.format(CAPITAL))
print('=' * 116)
S1a, S2a, S3a = streams['overnight_VFV'], streams['volmanaged_VFV'], streams['trend_XIU']
S1b = S1_bad[-n:]

MIXES = [
    ('equal thirds (good fill)', [(S1a, 1 / 3), (S2a, 1 / 3), (S3a, 1 / 3)]),
    ('equal thirds (bad fill)', [(S1b, 1 / 3), (S2a, 1 / 3), (S3a, 1 / 3)]),
    ('half slow, half overnight', [(S1a, 0.5), (S2a, 0.25), (S3a, 0.25)]),
    ('slow only (no day trading)', [(S2a, 0.5), (S3a, 0.5)]),
    ('vol-managed only', [(S2a, 1.0)]),
]
print('  {:<30}{:>10}{:>9}{:>9}{:>9}{:>13}{:>15}'.format(
    'allocation', 'CAGR', 'Sharpe', 'maxDD', 'Calmar', '$/yr on 1k', 'p5..p95 $/yr'))
print('  ' + '-' * 94)
for label, parts in MIXES:
    combo = [sum(w * s[i] for s, w in parts) for i in range(n)]
    c = inst.cagr(combo)
    ci = inst.block_bootstrap_ci(combo, block=21, draws=1500)
    print('  {:<30}{:>10}{:>9}{:>9}{:>9}{:>13}{:>15}'.format(
        label, '{:+.2%}'.format(c), '{:.2f}'.format(inst.sharpe(combo)),
        '{:.1%}'.format(inst.max_drawdown(combo)),
        '{:.2f}'.format(c / abs(inst.max_drawdown(combo)) if inst.max_drawdown(combo) else 0),
        '${:,.0f}'.format(CAPITAL * c),
        '${:,.0f}..${:,.0f}'.format(CAPITAL * ci['p5'], CAPITAL * ci['p95']) if ci else '-'))

print("""
  The p5..p95 band is a 21-day BLOCK bootstrap, which keeps losing streaks intact.
  Resampling single days would understate the downside - a failure mode already
  recorded in this project's risk skill.

  'bad fill' is the honest planning case for the overnight sleeve: it assumes every
  sale executes 10% of the way from the official open toward the session low. The
  gap between the two rows is the value of execution quality, and it is large. Any
  plan that quotes the 'good fill' number without a limit-order process behind it
  is quoting a number it has not earned.""")

# ------------------------------------------------------------------ 4. T+1
print('\n' + '=' * 116)
print('4. WHAT T+1 SETTLEMENT DOES TO THE DAY-TRADING SLEEVE')
print('=' * 116)
for label, s in (('overnight at full size', S1a), ('overnight at half size', [x * 0.5 for x in S1a])):
    print('  {:30} {:+.2%}/yr  = ${:,.0f}/yr on the sleeve'.format(
        label, inst.cagr(s), CAPITAL / 3 * inst.cagr(s)))
print("""
  Sale proceeds settle T+1, so in a CASH account the dollars from Tuesday's open
  are not buyable again until Wednesday. Either run the sleeve every other night,
  or run it at half size every night. CONFIRM against the live account before
  sizing - some brokers permit purchase against unsettled proceeds and some flag
  it as a good-faith violation. Until confirmed, plan on half.""")
