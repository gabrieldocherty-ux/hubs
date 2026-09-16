"""
The aggressive question, computed rather than lectured about.

The request: risk the whole $1,000 for a 1000% gain. That is a precise, testable
objective - maximise P(reaching $10,000) - and it is NOT the same objective as
maximising expected growth. They have different optimal solutions, and conflating
them is where most of the bad advice in both directions comes from.

WHAT IS ACTUALLY TRUE, and neither side of the usual argument says it:

  1. Trades with 1000% payoffs genuinely exist and are available in this account.
     Wealthsimple charges US$0 per contract on equity and ETF options. A far
     out-of-the-money call can return 10-50x. This is real.

  2. Their expected value is NEGATIVE. Options carry a volatility risk premium
     that accrues to the SELLER - implied volatility exceeds subsequent realised
     volatility roughly 80-90% of the time. Buying them is paying that premium.
     The payoff is right-skewed and the mean is below zero.

  3. THE RESULT MOST PEOPLE DO NOT KNOW, and the one that actually answers the
     question: for a fixed target, the optimal strategy DEPENDS ON WHETHER YOU
     HAVE AN EDGE. Dubins & Savage (1965) proved that in a NEGATIVE-edge game,
     BOLD play - the fewest, largest bets possible - maximises the probability of
     reaching a target. In a POSITIVE-edge game the opposite holds: timid,
     repeated betting near the Kelly fraction maximises it.
     So "go all in" is correct advice, but only if your edge is negative. If you
     have a real edge, going all in is strictly worse at the very goal it is
     supposed to serve.

  4. OVER-BETTING A REAL EDGE REDUCES GROWTH. Beyond the Kelly fraction, expected
     log-growth FALLS as leverage rises, and past ~2x Kelly it goes negative even
     though every individual bet still has positive expected value. This is
     arithmetic, not caution.

This file computes all of it on the real strategy series, and reports the actual
probability of turning $1,000 into $10,000 by each route.
"""
import math
import random
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng
from vix_signals import VIX, VIX3M

START, TARGET, HORIZON = 1000.0, 10000.0, 252 * 3      # 3 years
rng = random.Random(3)

# rebuild the validated gated overnight sleeve
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

# ---------------------------------------------------------------- Kelly
print('=' * 110)
print('1. WHERE IS THE GROWTH-OPTIMAL BET SIZE, AND WHAT HAPPENS PAST IT?')
print('=' * 110)
mu, sd = st.mean(gated), st.pstdev(gated)
kelly = mu / (sd ** 2) if sd else 0
print('  mean night {:+.4f}%   sd {:.4f}%   full-Kelly leverage = {:.1f}x'.format(
    mu * 100, sd * 100, kelly))
print('\n  {:>8}{:>16}{:>16}{:>16}'.format(
    'leverage', 'expected growth', 'vs Kelly', 'note'))
print('  ' + '-' * 58)
for lev in (1, 3, 5, kelly * 0.5, kelly, kelly * 1.5, kelly * 2, kelly * 2.5):
    g = lev * mu - 0.5 * (lev ** 2) * (sd ** 2)      # log-growth per period
    ann = (1 + g) ** 252 - 1
    tag = ''
    if abs(lev - kelly) < 0.01:
        tag = 'FULL KELLY - peak growth'
    elif lev > kelly * 2:
        tag = 'growth NEGATIVE despite +EV bets'
    elif lev > kelly:
        tag = 'past the peak, growth falling'
    print('  {:>8}{:>16}{:>16}{:>16}'.format(
        '{:.1f}x'.format(lev), '{:+.1%}/yr'.format(ann),
        '{:.2f}x K'.format(lev / kelly) if kelly else '-', tag))
print("""
  Read the right-hand column. Past full Kelly, MORE leverage produces LESS growth,
  and past about 2x Kelly the growth rate is negative even though every single bet
  still has positive expected value. Being aggressive beyond this point is not a
  trade-off between risk and return - it costs you BOTH.""")

# ---------------------------------------------------------------- P(target)
print('\n' + '=' * 110)
print('2. P($1,000 -> $10,000) IN 3 YEARS, BY ROUTE')
print('   Block bootstrap on the real series, losing streaks preserved.')
print('=' * 110)


def sim_strategy(lev, draws=6000, block=21):
    hit = bust = 0
    ends = []
    n = len(gated)
    for _ in range(draws):
        eq = START
        for _ in range(HORIZON // block):
            i = rng.randint(0, n - block)
            for x in gated[i:i + block]:
                eq *= (1 + x * lev)
                if eq <= START * 0.10:
                    break
            if eq >= TARGET or eq <= START * 0.10:
                break
        if eq >= TARGET:
            hit += 1
        if eq <= START * 0.10:
            bust += 1
        ends.append(eq)
    ends.sort()
    return {'hit': hit / draws, 'bust': bust / draws,
            'median': ends[len(ends) // 2], 'p5': ends[int(draws * 0.05)]}


print('  {:34}{:>14}{:>14}{:>14}{:>14}'.format(
    'route', 'P(hit $10k)', 'P(lose 90%)', 'median end', 'p5 end'))
print('  ' + '-' * 90)
for lev, label in ((1, 'gated overnight 1x'), (2, 'gated overnight 2x'),
                   (3, 'gated overnight 3x'), (5, 'gated overnight 5x'),
                   (kelly, 'gated overnight at Kelly ({:.0f}x)'.format(kelly)),
                   (10, 'gated overnight 10x')):
    r = sim_strategy(lev)
    print('  {:34}{:>14}{:>14}{:>14}{:>14}'.format(
        label, '{:.1%}'.format(r['hit']), '{:.1%}'.format(r['bust']),
        '${:,.0f}'.format(r['median']), '${:,.0f}'.format(r['p5'])))

# ---------------------------------------------------------------- options
print('\n' + '=' * 110)
print('3. THE LOTTERY ROUTE: BUYING OUT-OF-THE-MONEY CALLS')
print('   Priced with Black-Scholes at realistic implied vol, then settled against')
print("   the REAL historical distribution of the index's actual moves.")
print('=' * 110)


def norm_cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_call(S, K, T, r, sigma):
    if T <= 0 or sigma <= 0:
        return max(0.0, S - K)
    d1 = (math.log(S / K) + (r + sigma ** 2 / 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    return S * norm_cdf(d1) - K * math.exp(-r * T) * norm_cdf(d2)


# real 30-trading-day forward returns, the settlement distribution
H = 30
fwd = []
for i in range(len(ret) - H):
    p = 1.0
    for x in ret[i:i + H]:
        p *= (1 + x)
    fwd.append(p - 1)
realised_vol = st.pstdev(ret) * math.sqrt(252)
print('  index realised vol {:.1%}   |   implied vol assumed {:.1%} (the premium'
      ' the seller collects)'.format(realised_vol, realised_vol * 1.15))
print('\n  {:>10}{:>12}{:>12}{:>14}{:>14}{:>16}'.format(
    'strike', 'cost/$1k', 'P(expires OK)', 'avg payoff', 'EXPECTED', 'P(10x or more)'))
print('  ' + '-' * 80)
S0, T, rf = 100.0, H / 252.0, 0.03
iv = realised_vol * 1.15
for otm in (0.02, 0.05, 0.10, 0.15, 0.20):
    K = S0 * (1 + otm)
    prem = bs_call(S0, K, T, rf, iv)
    if prem <= 0:
        continue
    payoffs = []
    for f in fwd:
        ST = S0 * (1 + f)
        payoffs.append(max(0.0, ST - K) / prem)     # multiple of premium paid
    itm = sum(1 for p in payoffs if p > 0) / len(payoffs)
    ten = sum(1 for p in payoffs if p >= 10) / len(payoffs)
    print('  {:>10}{:>12}{:>12}{:>14}{:>14}{:>16}'.format(
        '{:.0%} OTM'.format(otm), '{:.2f}%'.format(prem / S0 * 100),
        '{:.1%}'.format(itm), '{:.2f}x'.format(st.mean(payoffs)),
        '{:+.1%}'.format(st.mean(payoffs) - 1), '{:.2%}'.format(ten)))
print("""
  'EXPECTED' is the average return on the premium. It is NEGATIVE at every strike,
  which is the volatility risk premium being paid to whoever sold you the option.
  'P(10x or more)' is the actual historical frequency of the payoff you are buying.

  Note the trade-off is not risk-versus-reward here - it is certainty-of-loss
  versus size-of-lottery. Further out of the money buys a bigger multiple and a
  worse expectancy.""")

# ---------------------------------------------------------------- bold play
print('\n' + '=' * 110)
print('4. THE DUBINS-SAVAGE RESULT: WHEN IS "GO ALL IN" ACTUALLY CORRECT?')
print('=' * 110)
print('  {:38}{:>16}{:>18}'.format('route', 'P(hit $10k)', 'P(lose it all)'))
print('  ' + '-' * 72)
# bold play on a negative-edge lottery: repeated all-in on 10% OTM calls
K = S0 * 1.10
prem = bs_call(S0, K, T, rf, iv)
mult = [max(0.0, S0 * (1 + f) - K) / prem for f in fwd]
hit = bust = 0
for _ in range(20000):
    eq = START
    for _ in range(36):          # 36 monthly all-in bets over 3 years
        eq *= mult[rng.randint(0, len(mult) - 1)]
        if eq >= TARGET or eq < 1.0:
            break
    if eq >= TARGET:
        hit += 1
    if eq < 1.0:
        bust += 1
print('  {:38}{:>16}{:>18}'.format(
    'all-in on 10% OTM calls, monthly', '{:.1%}'.format(hit / 20000),
    '{:.1%}'.format(bust / 20000)))
r1 = sim_strategy(1)
rk = sim_strategy(kelly)
print('  {:38}{:>16}{:>18}'.format(
    'gated overnight, 1x', '{:.1%}'.format(r1['hit']), '{:.1%}'.format(r1['bust'])))
print('  {:38}{:>16}{:>18}'.format(
    'gated overnight, Kelly', '{:.1%}'.format(rk['hit']), '{:.1%}'.format(rk['bust'])))
print("""
  This is the honest comparison, and it is the whole answer to the question. The
  lottery route reaches the target sometimes - it is not zero. It also destroys the
  account most of the time. The edge route reaches the target less spectacularly
  and far more often survives to try again.

  Dubins & Savage says bold play is optimal when the edge is NEGATIVE, because
  when every bet loses on average, the fewer bets you make the better. The moment
  you hold a positive edge, that logic inverts - and this project has spent weeks
  establishing a positive edge.""")
