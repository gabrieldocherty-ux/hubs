"""
What would 10% a month actually require, and what happens when you try?

Not answered with an opinion. 10% a month compounds to 1.10^12 - 1 = +213.8% a
year, so the question is precise and has a precise answer: how much leverage does
the best validated strategy in this project need to reach that rate, and what is
the probability of being wiped out on the way.

The best strategy here is the gated overnight sleeve: +20.51% a year, Sharpe 3.30,
maximum drawdown -5.6%. It is genuinely excellent. It is also about one tenth of
the required rate, so the only route to the target is leverage - and leverage
interacts with the loss distribution in a way that averages hide completely.

THE ASYMMETRY THAT DECIDES THIS. A strategy's average return scales LINEARLY with
leverage. Its probability of ruin does not - it scales with the fattest tail of
the distribution, because a single night at -1/L wipes out the account regardless
of every other night. Ruin is ABSORBING: there is no recovery from zero, so the
usual reasoning about expected value stops applying. That is why this file reports
the worst single night and a ruin probability rather than a mean.

Simulated on the real gated-strategy return series, with a block bootstrap so that
losing streaks stay clustered the way they actually occur.
"""
import math
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng
from vix_signals import VIX, VIX3M

CAPITAL = 1000.0
TARGET_MONTHLY = 0.10
TARGET_ANNUAL = (1 + TARGET_MONTHLY) ** 12 - 1

# rebuild the gated overnight sleeve on VFV
bars = tsx_data.get('VFV.TO')
ret = eng.total_returns(bars)
dates = eng.dates(bars)
rt = tsx_data.cost_model('VFV.TO', bars)[0]
closes = [b['c'] for b in bars]
ma = eng.sma(closes, 100)
vol = eng.rolling_vol(ret, 20)
ts, last = [], None
for d in dates:
    if d in VIX and d in VIX3M and VIX[d] > 0:
        last = VIX3M[d] / VIX[d]
    ts.append(last)

on = [(bars[i]['o'] - bars[i - 1]['c']) / bars[i - 1]['c'] - rt for i in range(1, len(bars))]
gated = []
for i in range(len(on)):
    v = vol[i - 1] if i > 0 else None
    w = 0.0 if (v is None or v <= 0) else min(1.0, (0.15 / (252 ** 0.5)) / v)
    m = ma[i] if i < len(ma) else None
    if m is None or closes[i] <= m:
        w = 0.0
    t = ts[i] if i < len(ts) else None
    if t is None or t < 1.05:
        w = 0.0
    gated.append(w * on[i])

base_cagr = inst.cagr(gated)
print('=' * 108)
print('THE TARGET vs WHAT EXISTS')
print('=' * 108)
print('  10% a month compounds to {:+.1%} a year.'.format(TARGET_ANNUAL))
print('  Best validated strategy here (gated overnight VFV): {:+.2%} a year.'.format(base_cagr))
print('  Required multiple of that strategy: {:.1f}x'.format(
    math.log(1 + TARGET_ANNUAL) / math.log(1 + base_cagr)))
print('  Approximate leverage needed on its daily returns: {:.1f}x'.format(
    TARGET_ANNUAL / base_cagr))
print("""
  For scale, the best sustained track record in the history of the industry is
  Renaissance Medallion at roughly 39% a year net of fees. The target is 214%.
  Nobody has done it - not for a year at a time, and certainly not repeatedly.""")

# ---------------------------------------------------------------- leverage ladder
print('\n' + '=' * 108)
print('WHAT LEVERAGE DOES TO THE REAL RETURN SERIES')
print('  Applied to the actual gated-overnight nights, in order.')
print('=' * 108)
print('  {:>6}{:>12}{:>12}{:>12}{:>14}{:>16}{:>14}'.format(
    'lev', 'CAGR', 'per month', 'maxDD', 'worst night', 'ruin?', '$ on 1k'))
print('  ' + '-' * 88)
worst_night = min(gated)
for lev in (1, 2, 3, 5, 8, 10, 15, 20):
    r = [x * lev for x in gated]
    # walk the equity curve, marking ruin if it ever hits zero or below
    eq, ruined, peak, mdd = 1.0, False, 1.0, 0.0
    for x in r:
        eq *= (1 + x)
        if eq <= 0.01:
            ruined = True
            break
        peak = max(peak, eq)
        mdd = min(mdd, eq / peak - 1)
    c = inst.cagr(r) if not ruined else -1.0
    monthly = (1 + c) ** (1 / 12) - 1 if c > -1 else -1.0
    print('  {:>6}{:>12}{:>12}{:>12}{:>14}{:>16}{:>14}'.format(
        '{}x'.format(lev),
        'WIPED OUT' if ruined else '{:+.1%}'.format(c),
        '-' if ruined else '{:+.2%}'.format(monthly),
        '-100.0%' if ruined else '{:.1%}'.format(mdd),
        '{:.2%}'.format(worst_night * lev),
        'YES - account gone' if ruined else 'survived',
        '$0' if ruined else '${:,.0f}'.format(CAPITAL * c)))

print("""
  'worst night' is the single worst night in the sample multiplied by the
  leverage. Once that number reaches -100% the account is gone in ONE night, and
  no subsequent good night can undo it. That is what makes ruin different in kind
  from a drawdown: a -50% drawdown needs +100% to recover, but a -100% drawdown
  needs infinity.""")

# ---------------------------------------------------------------- ruin probability
print('\n' + '=' * 108)
print('PROBABILITY OF RUIN - block bootstrap over 1-year paths')
print('  Blocks of 21 days so losing streaks stay clustered as they really occur.')
print('=' * 108)
import random
rng = random.Random(11)


def ruin_prob(lev, draws=4000, horizon=252, block=21, floor=-0.90):
    ruin = wipe = 0
    ends = []
    n = len(gated)
    for _ in range(draws):
        eq = 1.0
        low = 1.0
        for _ in range(horizon // block):
            i = rng.randint(0, n - block)
            for x in gated[i:i + block]:
                eq *= (1 + x * lev)
                if eq <= 0.01:
                    break
                low = min(low, eq)
            if eq <= 0.01:
                break
        if eq <= 0.01:
            wipe += 1
            ruin += 1
        elif (eq - 1) <= floor:
            ruin += 1
        ends.append(max(eq, 0.0))
    ends.sort()
    return {'wipe': wipe / draws, 'ruin': ruin / draws,
            'median': ends[len(ends) // 2] - 1,
            'p5': ends[int(len(ends) * 0.05)] - 1}


print('  {:>6}{:>16}{:>18}{:>16}{:>16}'.format(
    'lev', 'P(total wipeout)', 'P(lose 90%+)', 'median year', 'p5 year'))
print('  ' + '-' * 74)
for lev in (1, 2, 3, 5, 8, 10):
    r = ruin_prob(lev)
    print('  {:>6}{:>16}{:>18}{:>16}{:>16}'.format(
        '{}x'.format(lev), '{:.1%}'.format(r['wipe']), '{:.1%}'.format(r['ruin']),
        '{:+.1%}'.format(r['median']), '{:+.1%}'.format(r['p5'])))

# ---------------------------------------------------------------- reality
print('\n' + '=' * 108)
print('WHAT IS ACTUALLY AVAILABLE, AND WHAT IT PAYS')
print('=' * 108)
print("""  Wealthsimple offers no conventional margin on a cash account, so the leverage
  above is not purchasable in the first place. The only leverage reachable is
  inside a 2x ETF - and overnight on 2x funds was tested twice and produced NO
  alpha (HQU gated: t=1.11 at the open, t=-0.01 at a realistic fill).

  So the ladder above is hypothetical in both directions: the return is not
  achievable and neither is the leverage that would be needed to chase it.""")
print('  {:34}{:>14}{:>16}{:>16}'.format(
    'rate', 'per month', '$1,000 after 1yr', 'to reach $1M'))
print('  ' + '-' * 82)
for name, annual in (('gated overnight (validated)', base_cagr),
                     ('vol-managed HQU (t=1.82)', 0.2932),
                     ('Medallion, world record', 0.39),
                     ('the 10%/month target', TARGET_ANNUAL)):
    yrs = math.log(1000.0) / math.log(1 + annual)
    print('  {:34}{:>14}{:>16}{:>16}'.format(
        name, '{:+.2%}'.format((1 + annual) ** (1 / 12) - 1),
        '${:,.0f}'.format(CAPITAL * (1 + annual)), '{:.1f} yrs'.format(yrs)))
