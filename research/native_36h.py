"""
A short-horizon strategy built NATIVELY for a ~36 hour hold.

Fair criticism of the previous test: it truncated ten-day strategies to 36 hours
and reported the result. That measures what happens when you cut a strategy
short, not whether a 36-hour strategy works. Every parameter in those - the
20-day volume baseline, the 14-day ATR, the 20-day channel - was chosen for a
daily-bar, multi-day-hold system. Of course they degrade when the horizon is
changed underneath them.

This builds the thing properly. Everything is expressed in 4h bars and sized for
the horizon rather than inherited:

  bar size          4h (36h = 9 bars). 1h was checked first and Hyperliquid only
                    serves ~208 days of it - too short to validate against. 4h
                    goes back to 2024-05, giving 2.3 years.
  volume baseline   swept over 4h-native windows (18/30/42 bars = 3/5/7 days),
                    not a 20-DAY average
  ATR               computed on 4h bars
  hold              swept around the 9-bar target

The economics change at this horizon and that has to be respected rather than
discovered later. At a 9-bar hold there are roughly 2190 four-hour bars a year,
so a coin can turn over ~100+ times annually and the 0.190% round trip becomes
a ~20%/yr drag on notional. A 4h strategy therefore has to clear a much higher
bar per trade than a daily one - which is exactly why this is worth testing
natively rather than assuming either way.
"""
import sys, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, hl_data

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
RT = 2 * (engine.TAKER_FEE + engine.SLIPPAGE)
_cache = {}


def load4h(coin):
    if coin in _cache:
        return _cache[coin]
    bars, _ = hl_data.get_candles(coin, '4h', 1250)
    fund = engine.FundingCurve(hl_data.get_funding(coin, 1250))
    _cache[coin] = (bars, fund)
    return _cache[coin]


def native_flow(params):
    """Forced-flow continuation, every component native to 4h bars."""
    vol_n = params['vol_n']            # bars in the volume baseline
    vol_mult = params['vol_mult']
    hold = params['hold']              # bars
    atr_n = params.get('atr_n', 14)
    atr_mult = params['atr_mult']
    range_mult = params.get('range_mult', 0.0)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, atr_n)
                state['vma'] = engine.sma_series([b['v'] for b in bars], vol_n)
            atr = state['atr'][i]
            if atr is None or atr <= 0:
                return None
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            vma, b = state['vma'][i], bars[i]
            if not vma or vma <= 0 or b['v'] < vol_mult * vma:
                return None
            if range_mult and (b['h'] - b['l']) < range_mult * atr:
                return None
            want = 'long' if b['c'] > b['o'] else ('short' if b['c'] < b['o'] else None)
            if want is None:
                return None
            px = b['c']
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': '4h flow {:.1f}x vol'.format(b['v'] / vma)}
        return sig
    return factory


def run(params, warm=60):
    merged = engine.Result(coin='POOL', name='4h')
    per = {}
    for c in COINS:
        bars, fund = load4h(c)
        r = engine.backtest(bars, native_flow(params)(), c, fund, name='4h', warmup=warm)
        per[c] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


def row(label, params, warm=60):
    per, m = run(params, warm)
    if m.n < 10:
        print('  {:<38}{:>7}  too few trades'.format(label, m.n))
        return None
    tr, te = pooled.pooled_split(m)
    gross = m.expectancy + RT
    print('  {:<38}{:>7}{:>10}{:>10}{:>10}{:>10}{:>9}{:>10}{:>10}'.format(
        label, m.n, '{:.0f}'.format(m.trades_per_year()),
        '{:+.2f}%'.format(gross * 100), '{:+.2f}%'.format(m.expectancy * 100),
        '{:+.2f}%'.format(m.trimmed_expectancy(0.05) * 100),
        '{:.0%}'.format(m.win_rate),
        '{:+.2f}%'.format(tr.expectancy * 100) if tr else '-',
        '{:+.2f}%'.format(te.expectancy * 100) if te else '-'))
    return m


HDR = '  {:<38}{:>7}{:>10}{:>10}{:>10}{:>10}{:>9}{:>10}{:>10}'.format(
    'variant', 'n', 'tr/yr', 'GROSS', 'net', 'trim5', 'win', 'train', 'test')

print('=' * 124)
print('NATIVE 4h FORCED-FLOW, ~36h HOLD (9 bars)')
print('  Volume baseline swept over 4h-native windows, not inherited from daily.')
print('=' * 124)
print(HDR)
for vn in (18, 30, 42):
    for vm in (1.5, 2.0, 2.5, 3.0):
        row('vol {}bar baseline, {:.1f}x'.format(vn, vm),
            {'vol_n': vn, 'vol_mult': vm, 'hold': 9, 'atr_mult': 2.5})
    print()

print('=' * 124)
print('HOLD LENGTH around the 36h target (best baseline from above)')
print('=' * 124)
print(HDR)
for h in (3, 6, 9, 12, 18, 24, 36):
    row('hold {} bars = {}h'.format(h, h * 4),
        {'vol_n': 30, 'vol_mult': 2.0, 'hold': h, 'atr_mult': 2.5})

print('\n' + '=' * 124)
print('ADDING THE FORCED-FLOW RANGE FILTER, native to 4h')
print('  On daily bars this produced a monotonic dose-response (52%->79% win rate).')
print('  Whether it does at 4h is the real test of whether the mechanism is here.')
print('=' * 124)
print(HDR)
for rm in (0.0, 1.0, 1.5, 2.0, 2.5):
    row('range >= {:.1f}x ATR(4h)'.format(rm),
        {'vol_n': 30, 'vol_mult': 2.0, 'hold': 9, 'atr_mult': 2.5, 'range_mult': rm})

print('\n' + '=' * 124)
print('THE COST PROBLEM AT THIS HORIZON')
print('=' * 124)
per, m = run({'vol_n': 30, 'vol_mult': 2.0, 'hold': 9, 'atr_mult': 2.5})
if m.n:
    print('  at a 9-bar hold: {:.0f} trades/yr -> {:.1f}% of notional a year in execution cost'.format(
        m.trades_per_year(), RT * m.trades_per_year() * 100))
    print('  gross edge {:+.2f}%/trade, net {:+.2f}%/trade - cost eats {:.0f}% of it'.format(
        (m.expectancy + RT) * 100, m.expectancy * 100,
        RT / (m.expectancy + RT) * 100 if (m.expectancy + RT) > 0 else 100))
    print()
    for c in COINS:
        if c in per and per[c].n:
            print('    ' + pooled.describe(per[c], c))
