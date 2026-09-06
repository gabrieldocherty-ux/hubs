"""
D1 at the chosen operating point, broken out per coin, on both windows.

Operating point atr_ratio=2.0 chosen as the best trade-off between effect size
and sample: at 2.5 the win rate is higher but only 38 trades exist in the
tradeable window (~9/yr across four coins), which is too thin to size positions
against. 2.0 keeps n=74 tradeable / 134 extended with train AND test positive in
both windows.

Stated plainly so it can be discounted appropriately: 2.0 was picked after
seeing the sweep. The defence is not "trust me" - it is that the entire curve is
positive from 1.0 upward and the effect replicates on an independent window, so
this is picking a point on a plateau rather than finding a spike. The honest
discount is that live results should be expected nearer the 1.0-1.5 numbers
(trim5 ~1.0-1.5%) than the 2.0-2.5 numbers.
"""
import sys
sys.path.insert(0, 'research')
import engine, pooled
from strategies_daily import range_breakout

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
P = {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}


def show(extended, label):
    per, m = pooled.pooled(range_breakout, P, COINS, 60, extended=extended, name='D1')
    tr, te = pooled.pooled_split(m)
    print('\n' + '=' * 112)
    print('D1 RangeBreakout(20d, range>=2.0xATR, 2.5xATR stop, 10d max hold) - {}'.format(label))
    print('=' * 112)
    print('  ' + pooled.describe(m, 'POOLED'))
    print('  ' + pooled.describe(tr, '  train(60%)'))
    print('  ' + pooled.describe(te, '  test(40%)'))
    yr = pooled.pooled_yearly(m)
    p = sum(1 for _, r in yr if r.expectancy > 0)
    print('  by year: {}/{} positive   '.format(p, len(yr)) +
          '  '.join('{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n) for y, r in yr))
    print()
    for c in COINS:
        if c in per and per[c].n:
            r = per[c]
            print('  ' + pooled.describe(r, c))
            longs = [t for t in r.trades if t.direction == 'long']
            shorts = [t for t in r.trades if t.direction == 'short']
            for side, ts in (('long', longs), ('short', shorts)):
                if ts:
                    e = sum(t.pnl_pct for t in ts) / len(ts)
                    w = sum(1 for t in ts if t.won) / len(ts)
                    print('        {:<6} n={:<3} wr={:>5.1%} exp={:>7.2%}'.format(side, len(ts), w, e))
    return per, m


per_t, m_t = show(False, 'TRADEABLE WINDOW 2023-06+ (real funding)')
per_e, m_e = show(True, 'EXTENDED WINDOW 2020+ (funding assumed pre-2023)')

print('\n' + '=' * 112)
print('EXIT REASON BREAKDOWN (tradeable window) - is the stop or the timeout doing the work?')
print('=' * 112)
by = {}
for t in m_t.trades:
    by.setdefault(t.exit_reason, []).append(t)
for reason, ts in sorted(by.items(), key=lambda kv: -len(kv[1])):
    e = sum(t.pnl_pct for t in ts) / len(ts)
    w = sum(1 for t in ts if t.won) / len(ts)
    print('  {:<16} n={:<4} ({:>5.1%} of trades)  win rate {:>5.1%}  avg pnl {:>7.2%}'.format(
        reason, len(ts), len(ts) / m_t.n, w, e))

print('\n' + '=' * 112)
print('COST + SLIPPAGE STRESS at the operating point')
print('=' * 112)
for mult in (1, 2, 3, 4):
    _, mm = pooled.pooled(range_breakout, P, COINS, 60, name='c',
                          slippage=engine.SLIPPAGE * mult, fee=engine.TAKER_FEE * mult)
    print('  {}x costs ({:.2f}% round trip): exp={:>7.2%} trim5={:>7.2%} wr={:>5.1%} CAGR={:>6.1%}'.format(
        mult, 2 * (engine.SLIPPAGE + engine.TAKER_FEE) * mult * 100, mm.expectancy,
        mm.trimmed_expectancy(0.05), mm.win_rate, mm.account_cagr(0.20)))
