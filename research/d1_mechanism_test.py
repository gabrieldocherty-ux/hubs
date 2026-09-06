"""
The strongest out-of-sample test available for D1.

D1's parameters were chosen on daily bars, and its neighbourhood sweep showed a
MONOTONIC dose-response: the harder the forced-flow filter (day range as a
multiple of ATR), the higher the win rate - 52% at 1.0x rising to 74% at 2.5x.
A fitted parameter does not usually produce a clean dose-response; a real
mechanism does.

So the mechanism makes a falsifiable prediction: if the edge really comes from
liquidation cascades at range extremes, the SAME dose-response should appear on
4h bars, which are a different sample of the same market with different noise.
If it appears, that is evidence for the mechanism that no amount of re-fitting
on daily bars could provide. If it does not, D1 is a daily-bar curve fit and
should be demoted regardless of how good its daily numbers look.

Also tests the daily version on the extended 2020+ window for more data.
"""
import sys
sys.path.insert(0, 'research')
import engine, pooled
from strategies_daily import range_breakout

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']


def sweep(interval, n, max_hold, warm, extended=False, label=''):
    print('\n' + '=' * 112)
    print('DOSE-RESPONSE on {} bars  (n={} range, max_hold={} bars){}'.format(
        interval, n, max_hold, label))
    print('=' * 112)
    print('{:<12}{:>7}{:>10}{:>10}{:>10}{:>11}{:>11}{:>10}'.format(
        'atr_ratio', 'n', 'winrate', 'exp', 'trim5', 'train', 'test', 'CAGR'))
    rows = []
    for ratio in (0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0):
        p = {'n': n, 'atr_mult': 2.5, 'max_hold': max_hold, 'atr_ratio': ratio}
        per, m = pooled.pooled(range_breakout, p, COINS, warm, extended=extended,
                               interval=interval, name='d1')
        if m.n == 0:
            print('{:<12}{:>7}'.format(ratio, 0))
            continue
        tr, te = pooled.pooled_split(m)
        print('{:<12}{:>7}{:>10.1%}{:>10.2%}{:>10.2%}{:>11.2%}{:>11.2%}{:>10.1%}'.format(
            ratio, m.n, m.win_rate, m.expectancy, m.trimmed_expectancy(0.05),
            tr.expectancy if tr else 0, te.expectancy if te else 0, m.account_cagr(0.20)))
        rows.append((ratio, m.win_rate, m.trimmed_expectancy(0.05), m.n))
    if len(rows) >= 4:
        wr = [r[1] for r in rows if r[3] >= 20]
        if len(wr) >= 3:
            mono = all(b >= a - 0.02 for a, b in zip(wr, wr[1:]))
            print('\n  win rate monotonically rising with filter strength: {}'.format(
                'YES - consistent with the cascade mechanism' if mono
                else 'NO - the dose-response does not replicate here'))
    return rows


# The out-of-sample test: same mechanism, different bar size.
sweep('1d', 20, 10, 60, label='  [daily - where the parameters were chosen]')
sweep('4h', 20, 30, 120, label='  [4h - OUT OF SAMPLE for the mechanism]')
sweep('4h', 40, 60, 140, label='  [4h, longer range - second OOS view]')
sweep('1d', 20, 10, 60, extended=True, label='  [daily, extended 2020+ window]')
