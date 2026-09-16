import sys, datetime
sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout
from strategies_macro import donchian_turtle

COINS = ['BTC','ETH','SOL','HYPE']
def d(ms): return datetime.datetime.utcfromtimestamp(ms/1000).strftime('%Y-%m-%d')

_, S3 = pooled.pooled(volume_spike, {'vol_mult':1.5,'hold':10,'atr_mult':2.5}, COINS, 60, name='S3')
_, D1 = pooled.pooled(range_breakout, {'n':20,'atr_mult':2.5,'max_hold':10,'atr_ratio':2.0}, COINS, 60, name='D1')
_, B1 = run_basis.run(run_basis.BASE)
_, M3 = pooled.pooled(donchian_turtle, {'entry_n':55,'exit_n':20,'atr_mult':3.0}, COINS, 85, name='M3')
for k, m in [('S3',S3),('D1',D1),('B1',B1),('M3',M3)]:
    print(k, 'n=',m.n, 'win=%.3f'%m.win_rate, 'exp=%.4f'%m.expectancy,
          'trim=%.4f'%m.trimmed_expectancy(0.05), 'tpy=%.1f'%m.trades_per_year(),
          'window', d(m.start_t), '->', d(m.end_t),
          'firsttrade', d(min(t.entry_t for t in m.trades)), 'lasttrade', d(max(t.exit_t for t in m.trades)))
