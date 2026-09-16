"""
Rebuild the book from first principles: is this the right set of strategies at all?

Every strategy in the live book was validated on its own, in isolation, against a
per-trade gate. Nothing has ever asked the PORTFOLIO question: given four things
that each pass a solo gate, is running all four better than running two of them
bigger? That question cannot be answered with per-trade expectancy, because
per-trade expectancy is blind to the two things that actually decide it -

  * CAPITAL IS THE SCARCE RESOURCE, NOT SIGNALS. On $250 with $16.25 positions
    the daily sleeve holds 11 concurrent positions and the macro sleeve 3. A
    second strategy that fires on the same days as the first does not add a
    second bet; it doubles the first bet and consumes slots that could have
    held it at larger size. The honest metric is therefore RETURN PER DOLLAR-DAY
    OF NOTIONAL DEPLOYED, not return per trade.
  * CORRELATION IS A CALENDAR PROPERTY. Bootstrapping each strategy's trade list
    independently - which is how the current +10.2% median / +3.5% p5 figures in
    settings.json were produced - assumes the strategies fire on unrelated days.
    S3 and D1 overlap 0.85-1.00. Resampling them independently manufactures a
    diversification benefit that does not exist. So everything portfolio-level
    here is run in CALENDAR TIME: real trades on their real dates, marked to
    market daily, with the sleeve caps and the net-exposure rail actually
    enforced, and bootstrapped by resampling CONTIGUOUS BLOCKS OF DAYS so that
    whatever co-movement is really there survives the resampling.

The four questions, stated before any number is read:

  Q1  Does running S3 AND D1 beat running the better one at larger size, at
      MATCHED deployed capital? If not, D1 is not a strategy, it is a way of
      taking S3 in smaller pieces.
  Q2  Does M3 Donchian earn a 25% macro sleeve given that its edge decayed
      (train +49%, test +2.2%, n=49)? Priced three ways: full weight, half
      weight, retired - and re-priced with M3's TEST-HALF trades as the forward
      estimate, which is the honest one.
  Q3  Should adaptive_trend come out of scheduled_cycle.py, and what happens
      mechanically to the open SOL position if it does?
  Q4  What book would be built today, and what are its bootstrapped median and
      p5 bad-year floor against the current one - computed BOTH the old way
      (iid trade resampling, for comparability with the recorded +10.2%/+3.5%)
      and the calendar-block way (for honesty).

A conclusion that a live strategy should be cut is an acceptable outcome and is
the reason the exercise exists. Nothing below is tuned to spare anything.
"""
import os, sys, math, random, datetime, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout
from strategies_macro import tsmom, donchian_turtle

# BOOK_COINS exists only so the plumbing can be exercised on the two coins whose
# funding history is already cached when the venue is rate-limiting. Every
# reported result is the default four.
COINS = (os.environ.get('BOOK_COINS') or 'BTC,ETH,SOL,HYPE').split(',')
run_basis.COINS = [c for c in run_basis.COINS if c in COINS]
DAYMS = 86_400_000
CAPITAL = 250.0
BASE_USD = 16.25
SIZE = BASE_USD / CAPITAL              # 6.5% of capital per position
W_DAILY, W_MACRO = 0.75, 0.25
NET_CAP = 0.50
MIN_ORDER = 10.0 / CAPITAL             # Hyperliquid refuses under $10; bot skips, never shrinks below it
RT_COST = 2 * (engine.TAKER_FEE + engine.SLIPPAGE)
random.seed(1971)

P = {
    'S3': (volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}, 60, '1d'),
    'D1': (range_breakout, {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}, 60, '1d'),
    'M3': (donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0}, 85, '1d'),
    'M1': (tsmom, {'look': 120, 'atr_mult': 4.0}, 150, '1d'),
}


def sma_cross(params):
    """The live adaptive_trend default, SMA(20,60) on 4h bars, as a signal fn."""
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


print('loading the book...', file=sys.stderr)
_, S3 = pooled.pooled(*[P['S3'][0], P['S3'][1]], coins=COINS, warmup=60, name='S3')
_, D1 = pooled.pooled(P['D1'][0], P['D1'][1], COINS, 60, name='D1')
_, B1 = run_basis.run(run_basis.BASE)
_, M3 = pooled.pooled(P['M3'][0], P['M3'][1], COINS, 85, name='M3')
_, M1 = pooled.pooled(P['M1'][0], P['M1'][1], COINS, 150, name='M1')
_, AT = pooled.pooled(sma_cross, {'fast': 20, 'slow': 60, 'stop_pct': 0.03},
                      COINS[:3], 61, interval='4h', name='AT')

INTERVAL = {'S3': '1d', 'D1': '1d', 'B1': '1d', 'M3': '1d', 'M1': '1d', 'AT': '4h'}
SLEEVE = {'S3': 'daily', 'D1': 'daily', 'B1': 'daily', 'M3': 'macro',
          'M1': 'macro', 'AT': 'macro'}
RES = {'S3': S3, 'D1': D1, 'B1': B1, 'M3': M3, 'M1': M1, 'AT': AT}
LABEL = {'S3': 'ForcedFlowContinuation', 'D1': 'RangeBreakCascade',
         'B1': 'BasisDislocation', 'M3': 'DonchianBreakout',
         'M1': 'TSMOM 120d (bench)', 'AT': 'adaptive_trend SMA(20,60) 4h [LIVE]'}


def dstr(day):
    return datetime.datetime.fromtimestamp(
        day * 86400, datetime.timezone.utc).strftime('%Y-%m-%d')


# ---------------------------------------------------------------------------
# CALENDAR-TIME MACHINERY
# Marks every trade to market daily off its own coin's bars, so a portfolio has
# a real daily equity curve. Without this there is no drawdown number that means
# anything - a trade-sequence drawdown ignores the fact that eight positions can
# be losing on the SAME Tuesday.
# ---------------------------------------------------------------------------
_bars = {}


def bars_for(coin, interval):
    k = (coin, interval)
    if k not in _bars:
        b, _f = pooled.load(coin, interval=interval)
        _bars[k] = (b, {x['t']: i for i, x in enumerate(b)})
    return _bars[k]


def path(t, interval):
    """Daily P&L decomposition of one trade. Returns [(day, ret)] whose sum is
    exactly t.pnl_pct, plus the list of days the position was deployed.
    Gross is marked bar-by-bar; funding+cost are spread evenly over the hold,
    which is where they are actually incurred to within a day."""
    bars, idx = bars_for(t.coin, interval)
    a, b = idx.get(t.entry_t), idx.get(t.exit_t)
    sign = 1.0 if t.direction == 'long' else -1.0
    if a is None or b is None or b <= a:
        d = t.exit_t // DAYMS
        return [(d, t.pnl_pct)], [d]
    agg, prev = {}, t.entry_price
    for k in range(a, b):
        c = bars[k]['c']
        d = bars[k]['t'] // DAYMS
        agg[d] = agg.get(d, 0.0) + sign * (c - prev) / t.entry_price
        prev = c
    d = bars[b]['t'] // DAYMS
    agg[d] = agg.get(d, 0.0) + sign * (t.exit_price - prev) / t.entry_price
    days = sorted(agg)
    extra = (t.funding_pct + t.cost_pct) / len(days)
    return [(d, agg[d] + extra) for d in days], days


_paths = {}


def paths_for(name):
    if name not in _paths:
        iv = INTERVAL[name]
        _paths[name] = [(t, ) + path(t, iv) for t in RES[name].trades]
    return _paths[name]


def simulate(book, size=SIZE, caps=True, window=None, trade_filter=None):
    """Run a portfolio in calendar time.

    book:  list of strategy ids. size: per-position notional as a fraction of
    capital. caps: enforce the sleeve notional caps and the 50% net-exposure
    rail, skipping (never shrinking) a trade that would breach one - which is
    what core/risk_manager.py actually does.
    Returns the daily return series, the daily deployed-notional series, and
    how many trades each strategy got to take.
    """
    ev = []
    for name in book:
        for t, marks, days in paths_for(name):
            if trade_filter and not trade_filter(name, t):
                continue
            ev.append((t.entry_t, name, t, marks, days))
    ev.sort(key=lambda e: e[0])
    if not ev:
        return {}, {}, {}

    pnl, dep, taken, skipped = {}, {}, {}, {}
    live = []                                  # (exit_t, sleeve, signed_notional)
    sl = {'daily': 0.0, 'macro': 0.0}
    net = 0.0
    for entry_t, name, t, marks, days in ev:
        if window and not (window[0] <= entry_t // DAYMS <= window[1]):
            continue
        live = [p for p in live if p[0] > entry_t]
        sl = {'daily': 0.0, 'macro': 0.0}
        net = 0.0
        for _x, s, sn in live:
            sl[s] += abs(sn)
            net += sn
        sv = SLEEVE[name]
        sz = size
        if caps:
            # core/risk_manager.py SHRINKS to the remaining room and only then
            # refuses if what is left is under Hyperliquid's $10 minimum. Copied
            # exactly, because "shrink to $13.75" and "skip" are different books.
            cap = W_DAILY if sv == 'daily' else W_MACRO
            sz = min(sz, max(0.0, cap - sl[sv]))
            signed = sz if t.direction == 'long' else -sz
            projected = net + signed
            if abs(projected) > NET_CAP and abs(projected) > abs(net):
                sz = min(sz, max(0.0, NET_CAP - abs(net)))
            if sz < MIN_ORDER:
                skipped[name] = skipped.get(name, 0) + 1
                continue
        signed = sz if t.direction == 'long' else -sz
        live.append((t.exit_t, sv, signed))
        taken[name] = taken.get(name, 0) + 1
        for d, r in marks:
            pnl[d] = pnl.get(d, 0.0) + r * sz
        for d in days:
            dep[d] = dep.get(d, 0.0) + sz
    return pnl, dep, {'taken': taken, 'skipped': skipped}


def curve(pnl, dep, lo=None, hi=None):
    if not pnl and lo is None:
        return None
    lo = lo if lo is not None else min(pnl)
    hi = hi if hi is not None else max(pnl)
    rets, deps = [], []
    for d in range(lo, hi + 1):
        rets.append(pnl.get(d, 0.0))
        deps.append(dep.get(d, 0.0))
    eq = peak = 1.0
    mdd = 0.0
    for r in rets:
        eq *= (1 + r)
        peak = max(peak, eq)
        mdd = min(mdd, (eq - peak) / peak)
    yrs = len(rets) / 365.25
    cagr = eq ** (1 / yrs) - 1 if eq > 0 and yrs > 0 else -1.0
    tot_dep = sum(deps)
    tot_pnl = sum(rets)
    return {
        'rets': rets, 'days': len(rets), 'yrs': yrs, 'final': eq, 'cagr': cagr,
        'mdd': mdd, 'mean_dep': sum(deps) / len(deps),
        'peak_dep': max(deps) if deps else 0.0,
        # annualised return on capital actually at work, the efficiency metric
        'ropd': (tot_pnl / tot_dep * 365.25) if tot_dep > 0 else 0.0,
        'dvol': st.pstdev(rets) * math.sqrt(365.25) if len(rets) > 2 else 0.0,
        'exposure': sum(1 for x in deps if x > 0) / len(deps),
    }


def block_boot(rets, n=8000, block=21, ydays=357):
    """Bootstrap one year by resampling CONTIGUOUS 21-day blocks of the real
    portfolio's daily returns. Blocks keep the co-movement between strategies
    and the clustering of bad days, both of which iid trade resampling destroys."""
    r = [max(-0.95, x) for x in rets]
    cum = [0.0]
    for x in r:
        cum.append(cum[-1] + math.log(1 + x))
    nb = len(r) - block
    if nb < 10:
        return None
    k = ydays // block
    out = []
    for _ in range(n):
        s = 0.0
        for _ in range(k):
            j = random.randrange(nb)
            s += cum[j + block] - cum[j]
        out.append(math.exp(s) - 1)
    out.sort()
    return out


def iid_boot(components, size, n=20000):
    """The OLD method, reproduced exactly: resample each sleeve's trade list
    independently at its own trades/year. Kept so the rebuilt book can be quoted
    on the same basis as the recorded +10.2% median / +3.5% p5."""
    out = []
    pool = [(([t.pnl_pct for t in res.trades]),
             max(0, int(round(res.trades_per_year()))), w) for res, w in components]
    for _ in range(n):
        eq = 1.0
        for r, cnt, w in pool:
            if not r or cnt == 0:
                continue
            for _ in range(cnt):
                eq *= (1 + random.choice(r) * size * w)
            if eq <= 0.01:
                eq = 0.01
        out.append(eq - 1)
    out.sort()
    return out


def pct(v, p):
    return v[min(len(v) - 1, int(len(v) * p))]


def dist_line(label, d, extra=''):
    if d is None:
        print('  {:<52}  insufficient history'.format(label))
        return
    lp = sum(1 for x in d if x < 0) / len(d)
    print('  {:<52}{:>10}{:>10}{:>10}{:>10}{:>10}  {}'.format(
        label, '{:+.1f}%'.format(pct(d, .05) * 100), '{:+.1f}%'.format(pct(d, .25) * 100),
        '{:+.1f}%'.format(pct(d, .50) * 100), '{:+.1f}%'.format(pct(d, .95) * 100),
        '{:.0f}%'.format(lp * 100), extra))


BAR = '=' * 118

# ---------------------------------------------------------------------------
print(BAR)
print('0.  THE BOOK AS IT STANDS - solo numbers, for reference only')
print(BAR)
print('{:<5}{:<34}{:<7}{:>5}{:>9}{:>9}{:>9}{:>8}{:>8}{:>9}'.format(
    'id', 'strategy', 'sleeve', 'n', 'exp', 'trim5', 'exBest3', 'tr/yr', 'hold', 'drag/yr'))
for k in ('S3', 'D1', 'B1', 'M3', 'M1', 'AT'):
    m = RES[k]
    print('{:<5}{:<34}{:<7}{:>5}{:>9}{:>9}{:>9}{:>8.0f}{:>8}{:>9}'.format(
        k, LABEL[k][:33], SLEEVE[k], m.n, '{:+.2f}%'.format(m.expectancy * 100),
        '{:+.2f}%'.format(m.trimmed_expectancy(0.05) * 100),
        '{:+.2f}%'.format(m.expectancy_ex_best(3) * 100), m.trades_per_year(),
        '{:.1f}d'.format(m.avg_days_held), '{:.1f}%'.format(RT_COST * m.trades_per_year() * 100)))
print('  window: ' + '  '.join('{} {}..{}'.format(
    k, dstr(RES[k].start_t // DAYMS), dstr(RES[k].end_t // DAYMS)) for k in ('S3', 'B1', 'M3')))

# ---------------------------------------------------------------------------
print('\n' + BAR)
print('Q1.  S3 + D1  vs  THE BETTER ONE ALONE AT LARGER SIZE')
print(BAR)
print("""  The claim to test: D1 is a second bet. The counter-claim: D1 fires on the
  same forced-flow days S3 does, so holding both is holding S3 at 2x on a
  subset of its days - which you could get more cheaply by simply sizing S3 up.
  Settled by matching DEPLOYED CAPITAL and comparing what comes back.""")

print('\n  a) position-series overlap, recomputed rather than quoted:')
ovs = []
for c in COINS:
    bars, fund = pooled.load(c)
    s1, _ = pooled.position_series(bars, volume_spike, P['S3'][1], c, fund, 60)
    s2, _ = pooled.position_series(bars, range_breakout, P['D1'][1], c, fund, 60)
    ov, nn = pooled.overlap(s1, s2)
    ovs.append(ov)
    print('     {:<6} same-side on {:>4} co-invested bars: {}'.format(
        c, nn, 'n/a' if ov is None else '{:.2f}'.format(ov)))
print('     -> S3/D1 agree on direction {:.0%}-{:.0%} of the bars they are both in.'.format(
    min(x for x in ovs if x is not None), max(x for x in ovs if x is not None)))

print("""
  a2) The sharper version of the same question, which the overlap number alone
      cannot answer: split D1's trades by what S3 was doing at the moment D1
      entered. A D1 trade taken while S3 was already long the same coin is not a
      new position, it is a second helping of one. If the REMAINDER - the trades
      S3 was not in - has no edge, D1 contributes nothing that sizing S3 up
      would not contribute more cheaply.""")
buckets = {'S3 already same side': [], 'S3 flat': [], 'S3 opposite side': []}
for c in COINS:
    bars, fund = pooled.load(c)
    idx = {b['t']: i for i, b in enumerate(bars)}
    s3s, _ = pooled.position_series(bars, volume_spike, P['S3'][1], c, fund, 60)
    for t in D1.trades:
        if t.coin != c:
            continue
        i = idx.get(t.entry_t)
        if i is None:
            continue
        want = 1 if t.direction == 'long' else -1
        s = s3s[i]
        key = ('S3 flat' if s == 0 else
               'S3 already same side' if s == want else 'S3 opposite side')
        buckets[key].append(t)
print('  {:<26}{:>6}{:>9}{:>10}{:>10}{:>10}'.format(
    'D1 trades where...', 'n', 'win rate', 'exp', 'trim5', 'median'))
for k in ('S3 already same side', 'S3 flat', 'S3 opposite side'):
    ts = buckets[k]
    if not ts:
        print('  {:<26}{:>6}'.format(k, 0))
        continue
    r = engine.Result(coin='POOL', name=k)
    r.trades = ts
    r.start_t = min(t.entry_t for t in ts)
    r.end_t = max(t.exit_t for t in ts)
    print('  {:<26}{:>6}{:>9}{:>10}{:>10}{:>10}'.format(
        k, r.n, '{:.0%}'.format(r.win_rate), '{:+.2f}%'.format(r.expectancy * 100),
        '{:+.2f}%'.format(r.trimmed_expectancy(0.05) * 100),
        '{:+.2f}%'.format(r.median_trade * 100)))

# matched deployed capital: solve each portfolio's per-position size so mean
# deployed notional is identical. Caps off here - this is a comparison of two
# mechanisms, not of two ways of hitting a cap.
TARGET_DEP = 0.30      # 30% of capital deployed on average
q1 = {}
for label, book in (('S3 alone', ['S3']), ('D1 alone', ['D1']), ('S3 + D1', ['S3', 'D1'])):
    p0, d0, _ = simulate(book, size=1.0, caps=False)
    lo, hi = min(p0), max(p0)
    c0 = curve(p0, d0, lo, hi)
    sz = TARGET_DEP / c0['mean_dep']
    p1, d1, _ = simulate(book, size=sz, caps=False)
    q1[label] = (curve(p1, d1, lo, hi), sz)

print('\n  b) MATCHED DEPLOYED CAPITAL ({:.0f}% of capital at work on average).'.format(TARGET_DEP * 100))
print('     Per-position size is solved per row, so every row has the same money working.')
print('  {:<14}{:>9}{:>10}{:>10}{:>10}{:>10}{:>10}{:>11}'.format(
    'portfolio', 'pos size', 'mean dep', 'CAGR', 'maxDD', 'CAGR/DD', 'ann vol', 'ret/$-day'))
for label in ('S3 alone', 'D1 alone', 'S3 + D1'):
    c0, sz = q1[label]
    print('  {:<14}{:>9}{:>10}{:>10}{:>10}{:>10}{:>10}{:>11}  {}'.format(
        label, '{:.1f}%'.format(sz * 100), '{:.0f}%'.format(c0['mean_dep'] * 100),
        '{:+.1f}%'.format(c0['cagr'] * 100), '{:.1f}%'.format(c0['mdd'] * 100),
        '{:.2f}'.format(abs(c0['cagr'] / c0['mdd'])) if c0['mdd'] else '-',
        '{:.1f}%'.format(c0['dvol'] * 100), '{:+.1f}%'.format(c0['ropd'] * 100),
        '<< breaches the 20% position rail' if sz > 0.20 else ''))
print('     A strategy that is only in the market a small fraction of the time')
print('     needs a huge position to deploy the same average capital, which is')
print('     why the size column matters as much as the return column: any row')
print('     over 20% is not a portfolio this bot is permitted to run.')

print('\n  c) the same comparison, split 60/40 by time - does the answer survive out of sample?')
p0, d0, _ = simulate(['S3'], size=1.0, caps=False)
LO, HI = min(p0), max(p0)
CUT = LO + int((HI - LO) * 0.60)
print('     train {}..{}   test {}..{}'.format(dstr(LO), dstr(CUT), dstr(CUT + 1), dstr(HI)))
print('  {:<14}{:>12}{:>10}{:>12}{:>10}'.format('portfolio', 'train CAGR', 'trainDD', 'test CAGR', 'testDD'))
for label, book in (('S3 alone', ['S3']), ('D1 alone', ['D1']), ('S3 + D1', ['S3', 'D1'])):
    sz = q1[label][1]
    row = [label]
    for w, a, b in (('train', LO, CUT), ('test', CUT + 1, HI)):
        pp, dd, _ = simulate(book, size=sz, caps=False, window=(a, b))
        cc = curve(pp, dd, a, b)
        row += ['{:+.1f}%'.format(cc['cagr'] * 100), '{:.1f}%'.format(cc['mdd'] * 100)]
    print('  {:<14}{:>12}{:>10}{:>12}{:>10}'.format(*row))

print('\n  d) bootstrapped year distributions at matched deployed capital')
print('     (contiguous 21-day blocks, so the days S3 and D1 both fire stay together)')
print('  {:<52}{:>10}{:>10}{:>10}{:>10}{:>10}'.format(
    'portfolio', 'p5', 'p25', 'MEDIAN', 'p95', 'P(loss)'))
for label in ('S3 alone', 'D1 alone', 'S3 + D1'):
    dist_line(label, block_boot(q1[label][0]['rets']))

print('\n  e) and at the REAL rails ($16.25/position, 11 daily slots, 50% net cap):')
print('  {:<20}{:>10}{:>10}{:>10}{:>10}{:>12}{:>11}'.format(
    'portfolio', 'mean dep', 'CAGR', 'maxDD', 'ret/$-day', 'trades kept', 'skipped'))
for label, book in (('S3 alone', ['S3']), ('D1 alone', ['D1']), ('S3 + D1', ['S3', 'D1'])):
    pp, dd, info = simulate(book, size=SIZE, caps=True)
    cc = curve(pp, dd, LO, HI)
    print('  {:<20}{:>10}{:>10}{:>10}{:>12}{:>12}{:>11}'.format(
        label, '{:.1f}%'.format(cc['mean_dep'] * 100), '{:+.1f}%'.format(cc['cagr'] * 100),
        '{:.1f}%'.format(cc['mdd'] * 100), '{:+.1f}%'.format(cc['ropd'] * 100),
        sum(info['taken'].values()), sum(info['skipped'].values())))

# ---------------------------------------------------------------------------
print('\n' + BAR)
print('Q2.  DOES M3 DONCHIAN EARN THE 25% MACRO SLEEVE?')
print(BAR)
tr3, te3 = pooled.pooled_split(M3)
print('  M3 as validated:')
print('    ' + pooled.describe(M3, 'pooled'))
print('    ' + pooled.describe(tr3, '  train(60%)'))
print('    ' + pooled.describe(te3, '  test(40%)'))
yr = pooled.pooled_yearly(M3)
print('    by year: ' + '  '.join('{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n)
                                  for y, r in yr))
print('    -> the forward-honest estimate is the TEST half: {:+.2f}%/trade on n={},'.format(
    te3.expectancy * 100, te3.n))
print('       trimmed {:+.2f}%. The pooled {:+.2f}% is dominated by a train half that'.format(
    te3.trimmed_expectancy(0.05) * 100, M3.expectancy * 100))
print('       is not coming back. Every M3 row below is priced BOTH ways.')

print('\n  a) monthly-return correlation of each macro candidate with the daily sleeve')


def monthly(res, size=0.05):
    out = {}
    for t in res.trades:
        d = datetime.datetime.fromtimestamp(t.exit_t / 1000, datetime.timezone.utc)
        out.setdefault((d.year, d.month), []).append(t.pnl_pct * size)
    return {k: sum(v) for k, v in out.items()}


def corr(a, b):
    if len(a) < 4:
        return None
    ma, mb = st.mean(a), st.mean(b)
    va = sum((x - ma) ** 2 for x in a) ** .5
    vb = sum((x - mb) ** 2 for x in b) ** .5
    if va == 0 or vb == 0:
        return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (va * vb)


mr = {k: monthly(RES[k]) for k in RES}
for mac in ('M3', 'M1', 'AT'):
    cells = []
    for dly in ('S3', 'D1', 'B1'):
        com = sorted(set(mr[mac]) & set(mr[dly]))
        c = corr([mr[mac][k] for k in com], [mr[dly][k] for k in com])
        cells.append('{} {}'.format(dly, 'n/a' if c is None else '{:+.2f}'.format(c)))
    print('     {:<4} vs   '.format(mac) + '   '.join(cells))

print('\n  b) macro sleeve priced at every weight, in calendar time, real rails.')
print('     Daily sleeve held fixed at the rebuilt daily book (S3 + B1) so the')
print('     rows differ only in what the macro sleeve does.')


def show_book(label, book, size=SIZE, tf=None, win=None):
    pp, dd, info = simulate(book, size=size, caps=True, trade_filter=tf, window=win)
    a = win[0] if win else min(pp)
    b = win[1] if win else max(pp)
    cc = curve(pp, dd, a, b)
    print('  {:<40}{:>10}{:>10}{:>10}{:>12}{:>10}'.format(
        label, '{:.1f}%'.format(cc['mean_dep'] * 100), '{:+.1f}%'.format(cc['cagr'] * 100),
        '{:.1f}%'.format(cc['mdd'] * 100), '{:+.1f}%'.format(cc['ropd'] * 100),
        '{:.2f}'.format(abs(cc['cagr'] / cc['mdd'])) if cc['mdd'] else '-'))
    return cc, info


CUT3 = tr3.end_t
only_test_m3 = lambda name, t: (name != 'M3') or (t.entry_t >= CUT3)

# COMMON WINDOW. B1 needs Hyperliquid spot, which starts in 2025, so a book
# containing B1 measured over 2023-2026 is measured over a period where a third
# of it did not exist. Every multi-strategy comparison below is run over the
# window where ALL members are actually live, and the full window is shown
# alongside it so the shortness of the common window stays visible.
B1_LO = min(t.entry_t for t in B1.trades) // DAYMS
B1_HI = max(t.exit_t for t in B1.trades) // DAYMS
_p, _d, _ = simulate(['S3'], size=1.0, caps=False)
ALL_LO, ALL_HI = min(_p), max(_p)
WIN_COMMON = (B1_LO, B1_HI)
WIN_ALL = (ALL_LO, ALL_HI)
print('     common window (all strategies live): {} .. {}  ({:.2f} yr)'.format(
    dstr(B1_LO), dstr(B1_HI), (B1_HI - B1_LO) / 365.25))
print('     full window:                         {} .. {}  ({:.2f} yr)'.format(
    dstr(ALL_LO), dstr(ALL_HI), (ALL_HI - ALL_LO) / 365.25))

print('  {:<40}{:>10}{:>10}{:>10}{:>12}{:>10}'.format(
    'book', 'mean dep', 'CAGR', 'maxDD', 'ret/$-day', 'CAGR/DD'))
macro_rows = {}
cc_nom, _ = show_book('S3+B1 daily, no macro at all', ['S3', 'B1'], win=WIN_COMMON)
macro_rows['no macro'] = cc_nom
for lbl, bk, tf in (('M3 macro (full-history M3)', ['S3', 'B1', 'M3'], None),
                    ('M3 macro (test-half M3 only)', ['S3', 'B1', 'M3'], only_test_m3),
                    ('M1 macro (TSMOM bench)', ['S3', 'B1', 'M1'], None),
                    ('M3 + M1 macro', ['S3', 'B1', 'M3', 'M1'], None)):
    macro_rows[lbl], _ = show_book('S3+B1 + ' + lbl, bk, tf=tf, win=WIN_COMMON)

print("""
     The row that decides it is the RETURN ON THE MARGINAL DOLLAR. Adding a
     macro sleeve puts more capital to work, so it should raise total CAGR
     whether or not it is any good; the question is what the EXTRA capital
     earned. Below: the change in CAGR divided by the change in mean deployed
     notional, against the no-macro baseline. If that number is under what the
     daily sleeve already earns per dollar deployed, the macro sleeve is being
     paid for out of the daily sleeve's own capacity.""")
print('  {:<40}{:>12}{:>12}{:>16}{:>14}'.format(
    'macro option', 'extra dep', 'extra CAGR', 'ret/marginal $', 'extra maxDD'))
print('  {:<40}{:>12}{:>12}{:>16}{:>14}'.format(
    'daily sleeve alone, for comparison', '{:.1f}%'.format(cc_nom['mean_dep'] * 100),
    '{:+.1f}%'.format(cc_nom['cagr'] * 100), '{:+.0f}%'.format(cc_nom['ropd'] * 100),
    '{:.1f}%'.format(cc_nom['mdd'] * 100)))
for lbl in ('M3 macro (full-history M3)', 'M3 macro (test-half M3 only)',
            'M1 macro (TSMOM bench)', 'M3 + M1 macro'):
    cc = macro_rows[lbl]
    dd_dep = cc['mean_dep'] - cc_nom['mean_dep']
    dd_cagr = cc['cagr'] - cc_nom['cagr']
    print('  {:<40}{:>12}{:>12}{:>16}{:>14}'.format(
        lbl, '{:+.1f}%'.format(dd_dep * 100), '{:+.2f}pp'.format(dd_cagr * 100),
        '{:+.0f}%'.format(dd_cagr / dd_dep * 100) if abs(dd_dep) > 1e-6 else '-',
        '{:+.1f}pp'.format((cc['mdd'] - cc_nom['mdd']) * 100)))

print('\n     M3 at HALF size ($8.13) is not a legal option: Hyperliquid refuses')
print('     orders under $10, and this bot SKIPS rather than shrinks. The only')
print('     available weights for the macro sleeve are 0, 1, 2 or 3 positions of')
print('     $16.25 - i.e. 0%, 6.5%, 13% or 19.5% of capital of open notional.')
print('     "Run M3 smaller" therefore means "cap the macro sleeve at fewer')
print('     concurrent positions", which is what the rows below price.')
print('  {:<40}{:>10}{:>10}{:>10}{:>12}{:>10}'.format(
    'macro sleeve cap', 'mean dep', 'CAGR', 'maxDD', 'ret/$-day', 'CAGR/DD'))
_saveW = W_MACRO
for slots in (0, 1, 2, 3):
    W_MACRO = slots * SIZE + 1e-9
    show_book('  {} macro slot(s) ({:.1f}% of capital)'.format(slots, slots * SIZE * 100),
              ['S3', 'B1', 'M3'], win=WIN_COMMON)
W_MACRO = _saveW

print('\n  c) bootstrapped years for the macro question')
print('  {:<52}{:>10}{:>10}{:>10}{:>10}{:>10}'.format(
    'book', 'p5', 'p25', 'MEDIAN', 'p95', 'P(loss)'))
for label, book, tf in (
        ('S3+B1, no macro', ['S3', 'B1'], None),
        ('S3+B1 + M3 macro (full history M3)', ['S3', 'B1', 'M3'], None),
        ('S3+B1 + M3 macro (test-half M3 only)', ['S3', 'B1', 'M3'], only_test_m3),
        ('S3+B1 + M1 macro', ['S3', 'B1', 'M1'], None)):
    pp, dd, _ = simulate(book, size=SIZE, caps=True, trade_filter=tf, window=WIN_COMMON)
    cc = curve(pp, dd, *WIN_COMMON)
    dist_line(label, block_boot(cc['rets']))

# ---------------------------------------------------------------------------
print('\n' + BAR)
print('Q3.  adaptive_trend: the cost case, and the orphaned SOL position')
print(BAR)
m = AT
gross = m.expectancy + RT_COST
print('  Cost-efficiency re-run (this is the cut that was already made, re-verified):')
print('    n={}  {:.0f} trades/yr  GROSS {:+.2f}%  net {:+.2f}%  trimmed5 {:+.2f}%  '
      'median {:+.2f}%'.format(m.n, m.trades_per_year(), gross * 100,
                               m.expectancy * 100, m.trimmed_expectancy(0.05) * 100,
                               m.median_trade * 100))
print('    execution eats {:.0f}% of the gross edge; annual drag {:.1f}% of notional.'.format(
    RT_COST / gross * 100 if gross > 0 else float('inf'), RT_COST * m.trades_per_year() * 100))
tra, tea = pooled.pooled_split(AT)
print('    train {:+.2f}%/trade (n{})   test {:+.2f}%/trade (n{})'.format(
    tra.expectancy * 100, tra.n, tea.expectancy * 100, tea.n))
for dly in ('S3', 'D1', 'B1'):
    com = sorted(set(mr['AT']) & set(mr[dly]))
    c = corr([mr['AT'][k] for k in com], [mr[dly][k] for k in com])
    print('    monthly correlation with {}: {}'.format(dly, 'n/a' if c is None else '{:+.2f}'.format(c)))

print('\n  What it costs the book to keep running it, in calendar time:')
print('  {:<40}{:>10}{:>10}{:>10}{:>12}{:>10}'.format(
    'book', 'mean dep', 'CAGR', 'maxDD', 'ret/$-day', 'CAGR/DD'))
show_book('full live book WITHOUT adaptive_trend', ['S3', 'D1', 'B1', 'M3'])
show_book('full live book WITH adaptive_trend', ['S3', 'D1', 'B1', 'M3', 'AT'])

print("""
  The mechanical question - what happens to the open SOL position.
  Positions in core/paper_account.py are keyed "<book>|<coin>". Every strategy
  in scheduled_cycle.py passes --book (s3/d1/b1/m3) EXCEPT adaptive_trend, which
  passes "", so its SOL position is stored under the bare key "SOL". Deleting
  the adaptive_trend row from BOOK removes the only cycle that ever calls
  check_paper_exit(coin, price, book="") - so the position would not be
  orphaned in the harmless sense of "left alone", it would be orphaned in the
  sense of HAVING NO STOP-LOSS ENFORCEMENT AT ALL while still counting toward
  total_position_notional(). That is a rail failure, not an accounting one.""")

import json as _json
from pathlib import Path as _Path
pos = _json.loads(_Path('data/paper_positions.json').read_text()).get('SOL')
if pos:
    import urllib.request as _u
    try:
        req = _u.Request('https://api.hyperliquid.xyz/info',
                         data=_json.dumps({'type': 'allMids'}).encode(),
                         headers={'Content-Type': 'application/json'})
        mid = float(_json.loads(_u.urlopen(req, timeout=30).read())['SOL'])
    except Exception:
        mid = float('nan')
    notional = pos['size'] * pos['entry_price']
    unreal = (mid - pos['entry_price']) / pos['entry_price']
    print('\n  The position, right now:')
    print('    SOL long {:.6f} @ ${:.2f}  = ${:.2f} notional, sleeve "{}"'.format(
        pos['size'], pos['entry_price'], notional, pos.get('sleeve')))
    print('    stop ${:.4f}   market ${:.3f}   unrealised {:+.2f}%  (${:+.2f})'.format(
        pos['stop_loss_price'], mid, unreal * 100, unreal * notional))
    if mid <= pos['stop_loss_price']:
        gap = (pos['stop_loss_price'] - mid) / pos['stop_loss_price']
        print('    *** MARKET IS {:.2f}% BELOW THE STOP AND THE POSITION IS STILL OPEN.'.format(gap * 100))
        print('        The stop only fires when a cycle runs. schtasks reports the last')
        print('        run at 2026-09-07 23:24 local and the next at 2026-09-09 21:24 -')
        print('        the "hourly" task is not firing hourly.')
        print('    *** AND when it does fire, main.py books the exit at the STOP PRICE')
        print('        (exit_price = pos["stop_loss_price"]), not at the market. The')
        print('        research engine models gap-through fills honestly; the paper')
        print('        account does not. This trade will be logged {:.2f}% better than'.format(gap * 100))
        print('        it really was - on trade #1 of a zero-trade track record.')
    print('    It occupies ${:.2f} of the ${:.2f} macro sleeve ({:.0f}% of it), which is'.format(
        notional, CAPITAL * W_MACRO, notional / (CAPITAL * W_MACRO) * 100))
    print('    capacity M3 cannot use while it sits there.')

# ---------------------------------------------------------------------------
print('\n' + BAR)
print('Q4.  THE BOOK REBUILT FROM THE EVIDENCE')
print(BAR)
BOOKS = [
    ('CURRENT as scheduled (S3+D1+B1+M3+AT)', ['S3', 'D1', 'B1', 'M3', 'AT'], None),
    ('CURRENT as documented (S3+D1+B1+M3)', ['S3', 'D1', 'B1', 'M3'], None),
    ('drop D1            (S3+B1+M3)', ['S3', 'B1', 'M3'], None),
    ('drop D1, M3 honest (S3+B1+M3test)', ['S3', 'B1', 'M3'], only_test_m3),
    ('drop D1 and M3     (S3+B1)', ['S3', 'B1'], None),
    ('drop S3 instead    (D1+B1+M3)', ['D1', 'B1', 'M3'], None),
    ('B1 alone', ['B1'], None),
    ('S3 alone', ['S3'], None),
]
print('  A. COMMON WINDOW {} .. {} - every strategy actually live. {:.2f} years,'.format(
    dstr(B1_LO), dstr(B1_HI), (B1_HI - B1_LO) / 365.25))
print('     which is thin; treat the ranking as more reliable than the levels.')
print('  {:<40}{:>10}{:>10}{:>10}{:>12}{:>10}'.format(
    'book', 'mean dep', 'CAGR', 'maxDD', 'ret/$-day', 'CAGR/DD'))
sims = {}
for label, book, tf in BOOKS:
    cc, info = show_book(label, book, tf=tf, win=WIN_COMMON)
    sims[label] = (cc, book, tf)

print('\n  B. FULL WINDOW {} .. {} - more history, but B1 only exists for the'.format(
    dstr(ALL_LO), dstr(ALL_HI)))
print('     last third of it, so anything containing B1 is understated here.')
print('  {:<40}{:>10}{:>10}{:>10}{:>12}{:>10}'.format(
    'book', 'mean dep', 'CAGR', 'maxDD', 'ret/$-day', 'CAGR/DD'))
sims_all = {}
for label, book, tf in BOOKS:
    cc, info = show_book(label, book, tf=tf, win=WIN_ALL)
    sims_all[label] = cc

print('\n  Bootstrapped annual outcomes - CALENDAR-BLOCK on the COMMON window')
print('  (honest about correlation; 21-day blocks preserve co-firing days):')
print('  {:<52}{:>10}{:>10}{:>10}{:>10}{:>10}'.format(
    'book', 'p5', 'p25', 'MEDIAN', 'p95', 'P(loss)'))
for label, book, tf in BOOKS:
    dist_line(label, block_boot(sims[label][0]['rets']))

print('\n  Same, on the FULL window:')
print('  {:<52}{:>10}{:>10}{:>10}{:>10}{:>10}'.format(
    'book', 'p5', 'p25', 'MEDIAN', 'p95', 'P(loss)'))
for label, book, tf in BOOKS:
    dist_line(label, block_boot(sims_all[label]['rets']))

print("""
  Bootstrapped annual outcomes - IID TRADE RESAMPLING, the method that produced
  the +10.2% median / +3.5% p5 recorded in settings.json. Weights sum to 1.0 and
  scale per-trade exposure, exactly as research/allocation.py does it. Shown so
  the rebuilt book is quotable on the same basis - and so the gap between the
  two methods is visible.""")
print('  {:<52}{:>10}{:>10}{:>10}{:>10}{:>10}'.format(
    'book (iid, weights sum to 1)', 'p5', 'p25', 'MEDIAN', 'p95', 'P(loss)'))
M3T = engine.Result(coin='POOL', name='M3test')
M3T.trades = te3.trades
M3T.start_t, M3T.end_t = te3.start_t, te3.end_t
for label, comps in (
        ('RECORDED basis: S3 .375 B1 .375 / M1 .125 M3 .125',
         [(S3, .375), (B1, .375), (M1, .125), (M3, .125)]),
        ('as documented: S3 .25 D1 .25 B1 .25 / M3 .25',
         [(S3, .25), (D1, .25), (B1, .25), (M3, .25)]),
        ('drop D1:       S3 .375 B1 .375 / M3 .25',
         [(S3, .375), (B1, .375), (M3, .25)]),
        ('drop D1, M3 honest: S3 .375 B1 .375 / M3test .25',
         [(S3, .375), (B1, .375), (M3T, .25)]),
        ('drop D1 and M3: S3 .50 B1 .50', [(S3, .50), (B1, .50)])):
    dist_line(label, iid_boot(comps, SIZE))

print("""
  Read the two tables together. The iid table is systematically kinder, and by
  a large margin on any book containing both S3 and D1, because it resamples
  their trades as though they landed on unrelated days. They do not. Where the
  two disagree, the calendar-block number is the one to plan against.""")

print('\n' + BAR)
print('SLOT ARITHMETIC AT $250 - what any of this is allowed to look like')
print(BAR)
for w, nm in ((W_DAILY, 'daily'), (W_MACRO, 'macro')):
    slots = int(CAPITAL * w // BASE_USD)
    print('  {:<6} sleeve: ${:>7.2f} of notional -> {} concurrent $16.25 positions '
          '(${:.2f} unusable remainder)'.format(nm, CAPITAL * w, slots,
                                                CAPITAL * w - slots * BASE_USD))
print('  net-exposure rail: 50% of $250 = $125 = {:.1f} aligned positions before'.format(
    CAPITAL * NET_CAP / BASE_USD))
print('  a trade is SKIPPED. With 11 daily slots this rail, not the sleeve cap,')
print('  is what actually binds in a trending week.')
