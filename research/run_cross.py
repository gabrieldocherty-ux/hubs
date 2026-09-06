"""Run the cross-sectional family. These need every coin's data simultaneously,
so the runner assembles the peer view rather than pooled.pooled()."""
import sys
sys.path.insert(0, 'research')
import engine, pooled, hl_data
from strategies_cross import xs_momentum, carry_spread

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']


def build(extended=False):
    bars, funds = {}, {}
    for c in COINS:
        b, f = pooled.load(c, extended=extended)
        bars[c] = b
        funds[c] = f
    return bars, funds


def run_xs(look, atr_mult, extended=False):
    bars, funds = build(extended)
    merged = engine.Result(coin='POOL', name='xs-mom({}d)'.format(look))
    per = {}
    for c in COINS:
        p = {'look': look, 'atr_mult': atr_mult, 'peers': bars, 'self_coin': c}
        r = engine.backtest(bars[c], xs_momentum(p)(), c, funds[c],
                            name='xs-mom', warmup=look + 30)
        per[c] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


def run_carry(fund_n, atr_mult, min_spread, extended=False):
    bars, funds = build(extended)
    merged = engine.Result(coin='POOL', name='carry({}d,{:.0f}%)'.format(fund_n, min_spread * 100))
    per = {}
    for c in COINS:
        p = {'fund_n': fund_n, 'atr_mult': atr_mult, 'min_spread': min_spread,
             'peer_funding': funds, 'self_coin': c}
        r = engine.backtest(bars[c], carry_spread(p)(), c, funds[c],
                            name='carry', warmup=60)
        per[c] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


def report(label, per, merged):
    if merged.n == 0:
        print('\n{}: NO TRADES'.format(label))
        return
    tr, te = pooled.pooled_split(merged)
    print('\n' + '-' * 112)
    print(label)
    print('  ' + pooled.describe(merged, 'POOLED'))
    print('  ' + pooled.describe(tr, '  train'))
    print('  ' + pooled.describe(te, '  test'))
    yr = pooled.pooled_yearly(merged)
    p = sum(1 for _, r in yr if r.expectancy > 0)
    print('  by year: {}/{} positive   '.format(p, len(yr)) +
          '  '.join('{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n) for y, r in yr))
    for c in COINS:
        if c in per and per[c].n:
            print('  ' + pooled.describe(per[c], '  ' + c))


print('=' * 112)
print('M6 CROSS-SECTIONAL MOMENTUM  (long strongest / short weakest of the four)')
print('=' * 112)
for look in (30, 60, 90, 120):
    per, m = run_xs(look, 4.0)
    report('M6 xs-momentum look={}d'.format(look), per, m)

print('\n\n' + '=' * 112)
print('M7 CROSS-SECTIONAL FUNDING CARRY  (short highest-funding / long lowest)')
print('=' * 112)
for fund_n, spread in ((7, 0.10), (14, 0.10), (14, 0.20), (30, 0.10)):
    per, m = run_carry(fund_n, 4.0, spread)
    report('M7 carry fund_n={}d min_spread={:.0f}%/yr'.format(fund_n, spread * 100), per, m)
