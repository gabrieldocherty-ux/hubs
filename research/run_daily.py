"""
Daily-bar family, pooled across coins with per-coin detail.

Parameters are set from the hypothesis, not tuned: D1/D4 use a 20-day range
(the conventional short-swing lookback), D2 uses a 2-sigma move on 1.5x volume
(a 2-sigma day is the standard definition of "outsized" and nothing about the
cascade thesis privileges 1.9 or 2.1), D3 uses the top/bottom decile of funding
(the vault's own prior finding used deciles), D5 uses a 1-sigma BTC move.
The neighbourhood sweep afterwards is what tests whether those choices matter.
"""
import sys, datetime, json
sys.path.insert(0, 'research')
import engine, pooled, hl_data
from strategies_daily import (range_breakout, capitulation_reversion, funding_crowding,
                              vol_squeeze, btc_leadlag)

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
ALTS = ['ETH', 'SOL', 'HYPE']

BTC_BARS, _ = hl_data.get_candles('BTC', '1d', 2200)

CANDIDATES = [
    ('D1 RangeBreakout(20d,1.5xATR)', range_breakout,
     {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 1.5}, 60, COINS),
    ('D2 Capitulation(2sd,1.5xvol,5d)', capitulation_reversion,
     {'z': 2.0, 'vol_n': 60, 'hold': 5, 'atr_mult': 2.5, 'vol_mult': 1.5}, 90, COINS),
    ('D3 FundingCrowding(decile)', funding_crowding,
     {'fund_n': 3, 'pct': 0.90, 'pct_win': 180, 'atr_mult': 3.0, 'max_hold': 10,
      'funding': None}, 200, COINS),
    ('D4 VolSqueeze(20d floor)', vol_squeeze,
     {'vol_n': 20, 'pct': 0.30, 'n': 20, 'atr_mult': 2.5, 'max_hold': 10}, 280, COINS),
    ('D5 BTCLeadLag(3d,1sd)', btc_leadlag,
     {'look': 3, 'thresh': 1.0, 'hold': 3, 'atr_mult': 2.5, 'btc_bars': BTC_BARS}, 90, ALTS),
]


def run(extended=False):
    tag = 'EXTENDED 2020+ (funding assumed pre-2023)' if extended else 'TRADEABLE 2023-06+ (real funding)'
    print('\n' + '=' * 112)
    print('DAILY FAMILY - window: {}'.format(tag))
    print('=' * 112)
    out = {}
    for label, fn, params, warm, coins in CANDIDATES:
        if extended and 'funding' in params:
            continue
        per, merged = pooled.pooled(fn, params, coins, warm, extended=extended, name=label)
        if merged.n == 0:
            print('\n{}\n  NO TRADES'.format(label))
            continue
        tr, te = pooled.pooled_split(merged)
        print('\n' + '-' * 112)
        print(label + '   [coins: {}]'.format(','.join(coins)))
        print('  ' + pooled.describe(merged, 'POOLED'))
        print('  ' + pooled.describe(tr, '  train(60%)'))
        print('  ' + pooled.describe(te, '  test(40%)'))
        yr = pooled.pooled_yearly(merged)
        pos = sum(1 for _, r in yr if r.expectancy > 0)
        print('  by year: {}/{} positive   '.format(pos, len(yr)) +
              '  '.join('{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n) for y, r in yr))
        for c in coins:
            if c in per:
                print('  ' + pooled.describe(per[c], '  ' + c))
        out[label] = {'n': merged.n, 'exp': merged.expectancy,
                      'train': tr.expectancy if tr else None,
                      'test': te.expectancy if te else None}
    return out


if __name__ == '__main__':
    run(extended=False)
    run(extended=True)
