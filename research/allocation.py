"""
Portfolio allocation: 75% daily-bar family / 25% macro-trend family.

Two questions this has to answer before any code changes:

 1. WHAT GOES IN EACH BUCKET? "Daily" and "macro" are not self-evident here.
    The daily-bar validated set is S3 (forced-flow), D1 (range-break) and B1
    (basis). But S3 and D1 overlap 0.85-1.00 - funding both is one bet at two
    frequencies, so the daily bucket is modelled as S3 + B1, which overlap only
    0.35-0.59. On the macro side the 1-2 month strategies (M1 TSMOM, M3
    Donchian) are the ones whose edge DECAYED after 2023; the currently-live
    SMA(20,60)/4h is the trend expression that has not decayed. Both are modelled.

 2. DOES THE SPLIT HELP OR HURT? A 25% allocation to a decayed strategy is a
    25% allocation to a decayed strategy. Diversification only pays if the
    bucket is genuinely uncorrelated AND has positive expectancy. Measured here
    rather than assumed, because the answer determines whether 75/25 is a good
    idea or an expensive one.

Sizing convention used throughout, and it matters for the $10 minimum:
position size is a % of TOTAL capital, and the bucket weight acts as a cap on
total NOTIONAL EXPOSURE in that bucket - not as a smaller pot to size against.
Sizing off bucket capital would put macro positions at 5% x 25% x $250 = $3.13,
below Hyperliquid's $10 minimum, where orders are refused outright.
"""
import sys, random, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout
from strategies_macro import tsmom, donchian_turtle

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
N_BOOT = 20000
random.seed(23)


def sma_cross(params):
    fast, slow, stop_pct = params['fast'], params['slow'], params['stop_pct']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'f' not in state:
                c = [b['c'] for b in bars]
                state['f'] = engine.sma_series(c, fast)
                state['s'] = engine.sma_series(c, slow)
            f, s = state['f'], state['s']
            if None in (f[i], s[i], f[i - 1], s[i - 1]):
                return None
            px = bars[i]['c']
            if f[i - 1] <= s[i - 1] and f[i] > s[i]:
                return {'dir': 'long', 'stop': px * (1 - stop_pct), 'target': None, 'reason': 'x'}
            if f[i - 1] >= s[i - 1] and f[i] < s[i]:
                return {'dir': 'short', 'stop': px * (1 + stop_pct), 'target': None, 'reason': 'x'}
            return None
        return sig
    return factory


print('loading strategies...', file=sys.stderr)
_, S3 = pooled.pooled(volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5},
                      COINS, 60, name='S3')
_, D1 = pooled.pooled(range_breakout, {'n': 20, 'atr_mult': 2.5, 'max_hold': 10,
                                       'atr_ratio': 2.0}, COINS, 60, name='D1')
_, B1 = run_basis.run(run_basis.BASE)
_, LIVE = pooled.pooled(sma_cross, {'fast': 20, 'slow': 60, 'stop_pct': 0.03},
                        COINS, 61, interval='4h', name='LIVE')
_, M1 = pooled.pooled(tsmom, {'look': 120, 'atr_mult': 4.0}, COINS, 150, name='M1')
_, M3 = pooled.pooled(donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0},
                      COINS, 85, name='M3')

BOOK = {'S3': S3, 'D1': D1, 'B1': B1, 'LIVE': LIVE, 'M1': M1, 'M3': M3}

print('=' * 112)
print('1. THE CANDIDATE BUCKET MEMBERS')
print('=' * 112)
print('{:<6}{:<30}{:>6}{:>11}{:>11}{:>12}{:>11}'.format(
    'id', 'what', 'n', 'exp/trade', 'trim5', 'trades/yr', 'hold'))
labels = {'S3': 'forced-flow (daily)', 'D1': 'range-break (daily)',
          'B1': 'basis dislocation (daily)', 'LIVE': 'SMA(20,60) 4h [live trend]',
          'M1': 'TSMOM 120d [macro]', 'M3': 'Donchian 55/20 [macro]'}
for k, m in BOOK.items():
    print('{:<6}{:<30}{:>6}{:>11}{:>11}{:>12}{:>11}'.format(
        k, labels[k], m.n, '{:+.2f}%'.format(m.expectancy * 100),
        '{:+.2f}%'.format(m.trimmed_expectancy(0.05) * 100),
        '{:.0f}'.format(m.trades_per_year()), '{:.1f}d'.format(m.avg_days_held)))


def monthly_returns(result, size):
    """Account return per calendar month at `size` notional per position."""
    import datetime
    buckets = {}
    for t in result.trades:
        d = datetime.datetime.utcfromtimestamp(t.exit_t / 1000)
        buckets.setdefault((d.year, d.month), []).append(t.pnl_pct * size)
    return {k: sum(v) for k, v in buckets.items()}


def corr(a, b):
    if len(a) < 4:
        return None
    ma, mb = st.mean(a), st.mean(b)
    va = sum((x - ma) ** 2 for x in a) ** .5
    vb = sum((x - mb) ** 2 for x in b) ** .5
    if va == 0 or vb == 0:
        return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (va * vb)


print('\n' + '=' * 112)
print('2. MONTHLY-RETURN CORRELATION - does a macro sleeve actually diversify the daily one?')
print('=' * 112)
mr = {k: monthly_returns(m, 0.05) for k, m in BOOK.items()}
keys = list(BOOK)
print('{:<7}'.format('') + ''.join('{:>9}'.format(k) for k in keys))
for a in keys:
    row = '{:<7}'.format(a)
    for b in keys:
        common = sorted(set(mr[a]) & set(mr[b]))
        c = corr([mr[a][k] for k in common], [mr[b][k] for k in common])
        row += '{:>9}'.format('-' if c is None else '{:+.2f}'.format(c))
    print(row)
print('  (correlation of monthly account returns over overlapping months)')


def blend_proper(components, size, n_boot=N_BOOT):
    """Bootstrap one year of the blended portfolio. Each component is
    (result, weight); the weight scales that sleeve's per-trade exposure, so a
    25% sleeve risks a quarter as much per trade as a full-weight one."""
    out = []
    for _ in range(n_boot):
        eq = 1.0
        for result, w in components:
            n = max(0, int(round(result.trades_per_year())))
            r = [t.pnl_pct for t in result.trades]
            if not r or n == 0:
                continue
            for _ in range(n):
                eq *= (1 + random.choice(r) * size * w)
            if eq <= 0.01:
                eq = 0.01
        out.append(eq - 1)
    out.sort()
    return out


def pctile(v, p):
    return v[min(len(v) - 1, int(len(v) * p))]


def show(label, components, size):
    dist = blend_proper(components, size)
    lp = sum(1 for x in dist if x < 0) / len(dist)
    print('  {:<44}{:>11}{:>11}{:>11}{:>11}{:>10}'.format(
        label,
        '{:+.1f}%'.format(pctile(dist, .05) * 100),
        '{:+.1f}%'.format(pctile(dist, .25) * 100),
        '{:+.1f}%'.format(pctile(dist, .50) * 100),
        '{:+.1f}%'.format(pctile(dist, .95) * 100),
        '{:.0f}%'.format(lp * 100)))
    return pctile(dist, .50), pctile(dist, .05)


print('\n' + '=' * 112)
print('3. THE PROPOSED 75/25 SPLIT vs THE ALTERNATIVES')
print('   RISK-NORMALISED: every row deploys the same TOTAL risk budget (weights')
print('   sum to 1.0), so the rows differ only in how that budget is DIVIDED, not')
print('   in how much is bet. Comparing a 75/25 split against a daily sleeve left')
print('   at full weight would just be comparing less risk against more.')
print('=' * 112)
print('  {:<48}{:>10}{:>10}{:>10}{:>10}{:>9}'.format(
    'portfolio (weights sum to 1.0)', 'p5 (bad)', 'p25', 'MEDIAN', 'p95', 'P(loss)'))
show('100% daily: S3 .50 / B1 .50', [(S3, .50), (B1, .50)], 0.05)
show('75/25  S3 .375 B1 .375 / LIVE .25',
     [(S3, .375), (B1, .375), (LIVE, .25)], 0.05)
show('75/25  S3 .375 B1 .375 / M1 .25',
     [(S3, .375), (B1, .375), (M1, .25)], 0.05)
show('75/25  S3 .375 B1 .375 / M3 .25',
     [(S3, .375), (B1, .375), (M3, .25)], 0.05)
show('75/25  S3 .375 B1 .375 / M1 .125 M3 .125',
     [(S3, .375), (B1, .375), (M1, .125), (M3, .125)], 0.05)
show('75/25  S3 .25 D1 .25 B1 .25 / M1 .125 M3 .125',
     [(S3, .25), (D1, .25), (B1, .25), (M1, .125), (M3, .125)], 0.05)
show('100% macro: M1 .50 / M3 .50  (for contrast)', [(M1, .50), (M3, .50)], 0.05)

print()
print('  Same portfolios, per-position size solved to hit a ~10%/yr MEDIAN:')
print('  {:<48}{:>10}{:>10}{:>10}{:>10}{:>9}'.format(
    'portfolio', 'size', 'p5 (bad)', 'MEDIAN', 'p95', 'P(loss)'))
for label, comps in (
        ('100% daily', [(S3, .50), (B1, .50)]),
        ('75/25 with M1+M3 macro sleeve',
         [(S3, .375), (B1, .375), (M1, .125), (M3, .125)]),
        ('75/25 with LIVE trend as macro sleeve',
         [(S3, .375), (B1, .375), (LIVE, .25)])):
    for size in [x / 400 for x in range(1, 120)]:
        dist = blend_proper(comps, size, n_boot=4000)
        if pctile(dist, .50) >= 0.10:
            lp = sum(1 for x in dist if x < 0) / len(dist)
            print('  {:<48}{:>10}{:>10}{:>10}{:>10}{:>9}'.format(
                label, '{:.2f}%'.format(size * 100),
                '{:+.1f}%'.format(pctile(dist, .05) * 100),
                '{:+.1f}%'.format(pctile(dist, .50) * 100),
                '{:+.1f}%'.format(pctile(dist, .95) * 100),
                '{:.0f}%'.format(lp * 100)))
            break

print('\n' + '=' * 112)
print('4. THE $10 MINIMUM ORDER UNDER A 75/25 SPLIT ON $250')
print('=' * 112)
CAP = 250.0
for w, name in ((0.75, 'daily'), (0.25, 'macro')):
    sleeve = CAP * w
    print('  {:<8} sleeve capital ${:>7.2f}   max concurrent positions at $12.50 each: {:.0f}'.format(
        name, sleeve, sleeve / 12.5))
print("""
  Position size stays 5% of TOTAL capital ($12.50), and the sleeve weight caps
  total notional exposure in that sleeve. Sizing off sleeve capital instead
  would put a macro position at 5% x $62.50 = $3.13 - under Hyperliquid's $10
  minimum, where the order is refused and the trade is skipped rather than
  taken smaller. The 25% macro sleeve supports 5 concurrent positions, which is
  ample for strategies taking 3-6 trades per coin per year.""")
