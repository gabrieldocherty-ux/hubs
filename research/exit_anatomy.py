"""
Where inside a trade does the edge actually accrue?

Every strategy here was built entry-first. The exits are crude and were never
examined: a fixed 10-day timeout and a flat 2.5x ATR stop, both chosen because
they were reasonable, not because anything said they were right. That is the
largest unexamined surface left.

This is DIAGNOSTIC before it is prescriptive. Rather than trying exit variants
and keeping whichever scores best - which with enough variants always produces a
winner - it measures the P&L accrual curve: average cumulative return as a
function of days held. That curve says where the edge is without fitting
anything, and only then does it make sense to ask whether the exit should move.

Three shapes and what each implies:
  * FRONT-LOADED (edge accrues in days 1-3, flat after): the hold is too long.
    Shortening it keeps the profit, cuts funding cost, reduces exposure, and
    frees capital for the next signal.
  * LINEAR (accrues evenly throughout): the hold is roughly right, and any
    change trades return against risk one-for-one.
  * BACK-LOADED (accrues late): the hold is too short and is cutting winners.
  * PEAK-THEN-DECAY: the edge is real but reverses - the clearest case for an
    earlier exit or a trailing stop.
"""
import sys, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, hl_data, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
MAXD = 14


def accrual(result, coin_bars):
    """For each trade, the unrealised return at each day held (entry price to
    that day's close), before costs. Uses only bars the trade actually spans -
    a trade that exited on day 4 contributes nothing to day 5."""
    by_day = {d: [] for d in range(1, MAXD + 1)}
    for t in result.trades:
        bars = coin_bars.get(t.coin)
        if not bars:
            continue
        idx = {b['t']: i for i, b in enumerate(bars)}
        i0 = idx.get(t.entry_t)
        if i0 is None:
            continue
        exit_i = idx.get(t.exit_t, i0 + MAXD)
        for d in range(1, MAXD + 1):
            j = i0 + d
            if j > exit_i or j >= len(bars):
                break
            px = bars[j]['c']
            r = ((px - t.entry_price) / t.entry_price if t.direction == 'long'
                 else (t.entry_price - px) / t.entry_price)
            by_day[d].append(r)
    return by_day


def show(label, result, coin_bars):
    by = accrual(result, coin_bars)
    print('\n' + '=' * 108)
    print('{}  (n={} trades)'.format(label, result.n))
    print('=' * 108)
    print('  {:<7}{:>9}{:>13}{:>13}{:>13}{:>15}'.format(
        'day', 'still in', 'avg cum ret', 'median', 'win rate', 'marginal day'))
    prev = 0.0
    for d in range(1, MAXD + 1):
        v = by[d]
        if len(v) < 8:
            break
        m = st.mean(v)
        bar = '#' * max(0, min(28, int(round(m * 400))))
        print('  {:<7}{:>9}{:>13}{:>13}{:>13}{:>15}  {}'.format(
            d, len(v), '{:+.2f}%'.format(m * 100),
            '{:+.2f}%'.format(st.median(v) * 100),
            '{:.0%}'.format(sum(1 for x in v if x > 0) / len(v)),
            '{:+.3f}%'.format((m - prev) * 100), bar))
        prev = m
    return by


bars_by_coin = {}
for c in COINS:
    b, _ = pooled.load(c)
    bars_by_coin[c] = b

_, s3 = pooled.pooled(volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5},
                      COINS, 60, name='S3')
_, d1 = pooled.pooled(range_breakout, {'n': 20, 'atr_mult': 2.5, 'max_hold': 10,
                                       'atr_ratio': 2.0}, COINS, 60, name='D1')
_, b1 = run_basis.run(run_basis.BASE)

show('S3 FORCED-FLOW - accrual by day held (gross, before costs)', s3, bars_by_coin)
show('D1 RANGE-BREAK - accrual by day held', d1, bars_by_coin)
show('B1 BASIS DISLOCATION - accrual by day held', b1, bars_by_coin)

print("""
=========================================================================================================
READING THIS
  'marginal day' is what each extra day of holding adds. Once it turns and stays
  near zero or negative, the remaining hold is carrying risk and paying funding
  for nothing. That is the case for an earlier exit - and unlike sweeping hold
  values and keeping the best, it is a reason rather than a result.
  Costs are excluded on purpose: this is about where the EDGE is, not where the
  net number peaks, because a shorter hold also pays the round trip more often
  across the year.""")
