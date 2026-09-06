"""
Run the macro/trend family through the full validation gate on all four coins.

Window choice, stated explicitly because it changes what the numbers mean:
Hyperliquid serves daily candles back to 2020, but the venue only launched in
mid-2023 - 913 of those early bars have ZERO volume and there is no funding
history before 2023-05-12. Those bars ARE real prices (verified against Binance
to ~0.05% in check_prelaunch.py) but they are backfilled reference pricing, not
tradeable Hyperliquid history.

So the PRIMARY window is the funding-covered, actually-traded era. The extended
window is run separately as a secondary robustness check and labelled as such -
it is evidence the mechanism is not a 2023-2026 artifact, not evidence anyone
could have traded it.
"""
import sys, json, datetime
sys.path.insert(0, 'research')
import engine, hl_data, validate
from strategies_macro import MACRO

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
FUNDING_START = int(datetime.datetime(2023, 6, 8).timestamp() * 1000)   # hourly-funding era


def load(coin):
    bars, rep = hl_data.get_candles(coin, '1d', 2200)
    fund = engine.FundingCurve(hl_data.get_funding(coin, 1250))
    tradeable = [b for b in bars if b['t'] >= FUNDING_START]
    return bars, tradeable, fund, rep


def main(only=None):
    results = {}
    for coin in COINS:
        allbars, bars, fund, rep = load(coin)
        print('\n' + '#' * 108)
        print('# {}  tradeable window: {} bars  {} -> {}   (extended history: {} bars)'.format(
            coin, len(bars),
            datetime.datetime.utcfromtimestamp(bars[0]['t'] / 1000).date(),
            datetime.datetime.utcfromtimestamp(bars[-1]['t'] / 1000).date(), len(allbars)))
        print('#' * 108)
        for name, (fn, base, perts) in MACRO.items():
            if only and name not in only:
                continue
            params = dict(base)
            if 'funding' in fn.__code__.co_consts or name.startswith('M5'):
                params['funding'] = fund
            warmup = 210 if name == 'M2_golden_cross' else 130
            if name == 'M4_vol_trend':
                warmup = 280
            if len(bars) < warmup + 60:
                print('\n{} {}: SKIPPED - only {} bars, needs {}+'.format(
                    name, coin, len(bars), warmup + 60))
                continue
            rp = validate.full_report(
                bars, coin, fund, name, warmup, params,
                lambda p: fn(p), perts, verbose=True)
            results['{}|{}'.format(name, coin)] = summarize(rp)
    with open('research/results_macro.json', 'w') as f:
        json.dump(results, f, indent=1)
    print('\n\nwrote research/results_macro.json')
    return results


def summarize(rp):
    f, tr, te = rp['full'], rp['train'], rp['test']
    return {
        'coin': rp['coin'], 'name': rp['name'],
        'params': {k: v for k, v in rp['params'].items() if k != 'funding'},
        'verdict': rp['verdict'], 'reasons': rp['reasons'],
        'n': f.n, 'win_rate': round(f.win_rate, 4), 'expectancy': round(f.expectancy, 5),
        'total_return': round(f.total_return, 4), 'ann_return': round(f.annualized_return(), 4),
        'profit_factor': round(f.profit_factor, 3) if f.profit_factor != float('inf') else None,
        'max_dd': round(f.max_drawdown, 4), 'avg_days_held': round(f.avg_days_held, 2),
        'trades_per_year': round(f.trades_per_year(), 2),
        'sharpe_per_trade': round(f.sharpe_per_trade, 3),
        'train_exp': round(tr.expectancy, 5), 'train_n': tr.n,
        'test_exp': round(te.expectancy, 5), 'test_n': te.n,
        'q_positive': rp['q_positive'], 'q_total': rp['q_total'],
        'worst_q_exp': round(rp['worst_quarter'].expectancy, 5) if rp['worst_quarter'] else None,
        'nb_positive': rp['nb_positive'], 'nb_total': rp['nb_total'],
        'nb_median_exp': round(rp['nb_median_exp'], 5) if rp['nb_median_exp'] is not None else None,
        'cost2x_exp': round(rp['cost2x'].expectancy, 5) if rp['cost2x'].n else None,
        'avg_funding_per_trade': round(sum(t.funding_pct for t in f.trades) / f.n, 6) if f.n else None,
        'exposure': round(f.exposure_pct(), 3),
    }


if __name__ == '__main__':
    main(only=sys.argv[1:] or None)
