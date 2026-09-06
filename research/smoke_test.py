"""
Engine sanity checks. Before trusting this harness on new strategies it has to
(a) reproduce the known live default in the right ballpark, and (b) fail the
tests it should fail (a coin-flip strategy must lose exactly the cost).
"""
import sys
sys.path.insert(0, 'research')
import engine, hl_data
import random

bars, _ = hl_data.get_candles('BTC', '4h', 1250)
fund = engine.FundingCurve(hl_data.get_funding('BTC', 1250))
closes = [b['c'] for b in bars]


def sma_cross(fast, slow, stop_pct=0.03):
    f = engine.sma_series(closes, fast)
    s = engine.sma_series(closes, slow)

    def sig(bars, i, pos):
        if None in (f[i], s[i], f[i - 1], s[i - 1]):
            return None
        px = bars[i]['c']
        if f[i - 1] <= s[i - 1] and f[i] > s[i]:
            return {'dir': 'long', 'stop': px * (1 - stop_pct), 'target': None, 'reason': 'x-up'}
        if f[i - 1] >= s[i - 1] and f[i] < s[i]:
            return {'dir': 'short', 'stop': px * (1 + stop_pct), 'target': None, 'reason': 'x-dn'}
        return None
    return sig


print('=== 1. Reproduce the live default: SMA(20,60) on 4h BTC ===')
r = engine.backtest(bars, sma_cross(20, 60), 'BTC', fund,
                    name='SMA(20,60) 4h [live default]', warmup=61)
print(r.line())
print('  avg funding/trade {:+.4f}%   avg fee+slip/trade {:.4f}%   exposure {:.1%}'.format(
    sum(t.funding_pct for t in r.trades) / r.n * 100,
    sum(t.cost_pct for t in r.trades) / r.n * 100, r.exposure_pct()))

print('\n=== 2. Null test: random entries must lose ~the round-trip cost ===')
random.seed(7)


def coinflip(bars, i, pos):
    if pos is not None:
        return {'exit': True, 'reason': 'flat'} if random.random() < 0.10 else None
    if random.random() < 0.03:
        d = 'long' if random.random() < 0.5 else 'short'
        px = bars[i]['c']
        return {'dir': d, 'stop': px * (0.90 if d == 'long' else 1.10), 'target': None,
                'reason': 'random'}
    return None


rn = engine.backtest(bars, coinflip, 'BTC', fund, name='RANDOM (null test)', warmup=61)
print(rn.line())
print('  expectancy should sit near -0.19% (the modeled round trip); it is {:.3f}%'.format(
    rn.expectancy * 100))

print('\n=== 3. Lookahead check: a strategy that "knows" the next bar must be absurdly good ===')


def cheat(bars, i, pos):
    if pos is not None:
        return {'exit': True, 'reason': 'flat'}
    nxt = bars[i + 1] if i + 1 < len(bars) else None
    if nxt is None:
        return None
    d = 'long' if nxt['c'] > nxt['o'] else 'short'
    px = bars[i]['c']
    return {'dir': d, 'stop': px * (0.80 if d == 'long' else 1.20), 'target': None, 'reason': 'cheat'}


rc = engine.backtest(bars, cheat, 'BTC', fund, name='ORACLE (lookahead control)', warmup=61)
print(rc.line())
print('  If this is NOT hugely positive, the engine is not actually filling at next open.')

print('\n=== 4. Cost sensitivity of the live default (does the edge survive 2x costs?) ===')
for mult, label in ((1, '1x costs'), (2, '2x costs'), (3, '3x costs')):
    rr = engine.backtest(bars, sma_cross(20, 60), 'BTC', fund, name='SMA(20,60) ' + label,
                         warmup=61, slippage=engine.SLIPPAGE * mult, fee=engine.TAKER_FEE * mult)
    print(' ', rr.line())

print('\n=== 5. Funding sign check (long vs short over the same window) ===')
t0 = bars[len(bars) // 2]['t']
t1 = t0 + 30 * 24 * engine.HOUR_MS
print('  30d funding, long: {:+.4f}%   short: {:+.4f}%  (must be equal and opposite)'.format(
    fund.cost(t0, t1, 'long') * 100, fund.cost(t0, t1, 'short') * 100))
