"""
Macro family, judged pooled-across-coins on the extended window, with
per-coin detail underneath. Parameters chosen by HOLDING HORIZON (the 1-2 month
design spec) from horizon_scan.py, not by expectancy.
"""
import sys, datetime
sys.path.insert(0, 'research')
import engine, pooled
from strategies_macro import tsmom, golden_cross, donchian_turtle, vol_target_trend, funding_regime

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']

# (fn, params, warmup, label). Params picked for a 30-60 day average hold.
CANDIDATES = [
    (tsmom, {'look': 120, 'atr_mult': 4.0}, 150,
     'M1 TSMOM(120d)  [horizon pick: 33-42d hold]'),
    (tsmom, {'look': 90, 'atr_mult': 4.0}, 120,
     'M1b TSMOM(90d)  [faster variant, robustness]'),
    (golden_cross, {'fast': 50, 'slow': 200, 'atr_mult': 4.0}, 210,
     'M2 GoldenCross(50/200) [published setting]'),
    (golden_cross, {'fast': 20, 'slow': 100, 'atr_mult': 4.0}, 110,
     'M2b MACross(20/100) [horizon pick: 37-60d hold]'),
    (donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0}, 85,
     'M3 Donchian(55/20) [Turtle standard AND horizon match]'),
    (donchian_turtle, {'entry_n': 80, 'exit_n': 30, 'atr_mult': 3.0}, 110,
     'M3b Donchian(80/30) [slower variant]'),
    (vol_target_trend, {'look': 90, 'atr_mult': 4.0, 'vol_n': 20, 'vol_pctile': 0.90}, 300,
     'M4 VolFilteredTrend(90d)'),
    (funding_regime, {'fund_n': 14, 'trend_n': 50, 'atr_mult': 4.0, 'funding': None}, 90,
     'M5 FundingRegime(14d/50d)'),
]


def run(extended):
    tag = 'EXTENDED 2020+ (funding assumed pre-2023)' if extended else 'TRADEABLE 2023-06+ (real funding)'
    print('\n' + '=' * 112)
    print('MACRO FAMILY - POOLED ACROSS {} - window: {}'.format('/'.join(COINS), tag))
    print('=' * 112)
    for fn, params, warmup, label in CANDIDATES:
        if extended and 'funding' in params:
            continue        # M5 needs real funding; assumed funding cannot signal itself
        per, merged = pooled.pooled(fn, params, COINS, warmup, extended=extended, name=label)
        if merged.n == 0:
            print('\n{}\n  no trades'.format(label))
            continue
        tr, te = pooled.pooled_split(merged)
        print('\n' + '-' * 112)
        print(label)
        print('  ' + pooled.describe(merged, 'POOLED'))
        print('  ' + pooled.describe(tr, '  train(60%)'))
        print('  ' + pooled.describe(te, '  test(40%)'))
        yr = pooled.pooled_yearly(merged)
        pos = sum(1 for _, r in yr if r.expectancy > 0)
        print('  by year: {}/{} positive   '.format(pos, len(yr)) +
              '  '.join('{}:{:+.1f}%(n{})'.format(y, r.expectancy * 100, r.n) for y, r in yr))
        for c in COINS:
            if c in per:
                print('  ' + pooled.describe(per[c], '  ' + c))


if __name__ == '__main__':
    run(extended=False)
    run(extended=True)
