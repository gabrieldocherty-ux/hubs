"""
Calibrate the engine against a null hypothesis.

A random entry/exit strategy should, in expectation, lose exactly the modeled
frictions (round-trip cost + funding) and nothing more. If the engine instead
shows a systematic edge, every backtest downstream is inflated; if it shows a
systematic penalty beyond costs, results are merely conservative. Either way it
has to be measured, not assumed. One seed cannot distinguish bias from noise,
so this runs many.
"""
import sys, random, statistics as st
sys.path.insert(0, 'research')
import engine, hl_data

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
RT = 2 * (engine.TAKER_FEE + engine.SLIPPAGE)

print('modeled round-trip cost = {:.3f}%\n'.format(RT * 100))
for coin in COINS:
    bars, _ = hl_data.get_candles(coin, '4h', 1250)
    fund = engine.FundingCurve(hl_data.get_funding(coin, 1250))
    exps, fundings, ns = [], [], []
    for seed in range(40):
        rng = random.Random(seed)

        def sig(bars, i, pos, rng=rng):
            if pos is not None:
                return {'exit': True, 'reason': 'flat'} if rng.random() < 0.10 else None
            if rng.random() < 0.03:
                d = 'long' if rng.random() < 0.5 else 'short'
                px = bars[i]['c']
                return {'dir': d, 'stop': px * (0.80 if d == 'long' else 1.20),
                        'target': None, 'reason': 'rnd'}
            return None

        r = engine.backtest(bars, sig, coin, fund, name='null', warmup=61)
        if r.n:
            exps.append(r.expectancy)
            fundings.append(sum(t.funding_pct for t in r.trades) / r.n)
            ns.append(r.n)
    mean_exp = st.mean(exps)
    se = st.pstdev(exps) / len(exps) ** 0.5
    mean_fund = st.mean(fundings)
    predicted = -RT + mean_fund
    print('{:<5} {:>3} runs, avg n={:>5.0f} | mean expectancy {:+.4f}% (SE {:.4f}%) | '
          'avg funding {:+.4f}% | predicted {:+.4f}% | residual {:+.4f}%'.format(
              coin, len(exps), st.mean(ns), mean_exp * 100, se * 100,
              mean_fund * 100, predicted * 100, (mean_exp - predicted) * 100))

print('\nResidual is the engine bias: near zero (within ~2 SE) = engine is honest.')
print('Wide stops (20%) are used so results reflect drift+cost, not stop placement.')
