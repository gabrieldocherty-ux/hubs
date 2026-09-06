import sys
sys.path.insert(0, 'research')
import engine, pooled
from strategies_batch2 import st_reversal, session_effect, volume_spike, trend_aligned_breakout, rsi2

COINS = ['BTC','ETH','SOL','HYPE']

def line(label, fn, params, warm, interval='1d', **kw):
    per, m = pooled.pooled(fn, params, COINS, warm, interval=interval, name=label, **kw)
    if m.n == 0:
        print('  {:<44} NO TRADES'.format(label)); return
    tr, te = pooled.pooled_split(m)
    ok = 'PASS' if (m.trimmed_expectancy(0.05) > 0 and tr and te
                    and tr.expectancy > 0 and te.expectancy > 0) else 'fail'
    print('  {:<44} n={:<4} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%} train={:>7.2%} test={:>7.2%} CAGR={:>6.1%}  {}'.format(
        label, m.n, m.win_rate, m.expectancy, m.trimmed_expectancy(0.05),
        tr.expectancy if tr else 0, te.expectancy if te else 0, m.account_cagr(0.20), ok))

print('='*135); print('S1 SHORT-TERM REVERSAL (no volume gate) - isolating whether D2 failed on the gate or the premise'); print('='*135)
for look in (1,2,3,5):
    for z in (1.0,1.5,2.0):
        line('S1 reversal look={}d z={} hold=3'.format(look,z), st_reversal,
             {'look':look,'z':z,'hold':3,'atr_mult':2.5}, 90)

print('\n'+'='*135); print('S2 SESSION EFFECT (4h bars, one UTC slot, long-only) - screen only, expect data mining'); print('='*135)
for slot in (0,4,8,12,16,20):
    line('S2 long at {:02d}:00 UTC hold=1bar'.format(slot), session_effect,
         {'slot':slot,'hold':1,'atr_mult':4.0}, 60, interval='4h')

print('\n'+'='*135); print('S3 VOLUME SPIKE ALONE (decomposing D1)'); print('='*135)
for vm in (1.5,2.0,3.0):
    for hold in (3,10):
        line('S3 vol>={}x avg, hold={}d'.format(vm,hold), volume_spike,
             {'vol_mult':vm,'hold':hold,'atr_mult':2.5}, 60)

print('\n'+'='*135); print('S4 TREND-ALIGNED vs COUNTER-TREND BREAKOUT (does cascade direction matter?)'); print('='*135)
for inv in (False,True):
    for tn in (50,100):
        line('S4 breakout {} trend({}d)'.format('AGAINST' if inv else 'with', tn), trend_aligned_breakout,
             {'n':20,'atr_mult':2.5,'max_hold':10,'atr_ratio':2.0,'trend_n':tn,'invert':inv}, 130)

print('\n'+'='*135); print('S5 RSI(2) CLASSIC REVERSAL - expected to be arbitraged away'); print('='*135)
for lo,hi in ((5,95),(10,90),(20,80)):
    for hold in (2,5):
        line('S5 RSI2 <{}/>{} hold={}d'.format(lo,hi,hold), rsi2,
             {'lo':lo,'hi':hi,'hold':hold,'atr_mult':2.5}, 60)
