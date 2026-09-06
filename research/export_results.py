"""
Export every strategy result - accepted AND rejected - to a single JSON the
dashboard reads. The rejected ones are deliberately included: a strategy board
that only shows what worked hides the base rate, and the base rate here is that
most ideas fail.
"""
import sys, json, datetime
sys.path.insert(0, 'research')
import engine, pooled, hl_data
from strategies_daily import range_breakout, capitulation_reversion, funding_crowding, vol_squeeze, btc_leadlag
from strategies_batch2 import st_reversal, volume_spike, trend_aligned_breakout, rsi2, session_effect
from strategies_macro import tsmom, golden_cross, donchian_turtle, vol_target_trend, funding_regime
from strategies_cross import xs_momentum, carry_spread

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
BTC_BARS, _ = hl_data.get_candles('BTC', '1d', 2200)


def sma_cross(params):
    fast, slow, stop_pct = params['fast'], params['slow'], params['stop_pct']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'f' not in state:
                c = [b['c'] for b in bars]
                state['f'] = engine.sma_series(c, fast)
                state['s'] = engine.sma_series(c, slow)
            f, s = state['f'], state['s']
            if None in (f[i], s[i], f[i - 1], s[i - 1]):
                return None
            px = bars[i]['c']
            if f[i - 1] <= s[i - 1] and f[i] > s[i]:
                return {'dir': 'long', 'stop': px * (1 - stop_pct), 'target': None, 'reason': 'x'}
            if f[i - 1] >= s[i - 1] and f[i] < s[i]:
                return {'dir': 'short', 'stop': px * (1 + stop_pct), 'target': None, 'reason': 'x'}
            return None
        return sig
    return factory


# (id, family, label, hypothesis, fn, params, warmup, interval, coins, status, note)
SPECS = [
    ('S3', 'daily', 'Forced-Flow Continuation',
     'Liquidation engines on a leveraged venue are forced, price-insensitive sellers; '
     'flow that is forced rather than informed overshoots and continues.',
     volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}, 60, '1d', COINS,
     'VALIDATED', 'Best sample of anything tested (n=202). All 4 coins and 4/4 years positive.'),
    ('D1', 'daily', 'Range-Break Cascade',
     'Same cascade mechanism, but requiring BOTH a range break and an outsized daily '
     'range as evidence of forced flow. Higher conviction, lower frequency.',
     range_breakout, {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}, 60, '1d',
     COINS, 'VALIDATED',
     'Win rate rises monotonically with filter strength (52->74%); replicates on 2020-23 data.'),
    ('LIVE', 'macro', 'SMA(20,60) 4h [currently live]',
     'Trend following: under-reaction to slowly-diffusing information plus trend-follower flows.',
     sma_cross, {'fast': 20, 'slow': 60, 'stop_pct': 0.03}, 61, '4h', COINS, 'CUT',
     'CUT 2026-09-05 on cost efficiency. Pays 30.9%/yr in execution cost (163 trades/yr) for a '
     'NEGATIVE trimmed expectancy of -0.78% - the +0.55% mean is entirely tail. Also correlates '
     '+0.44 to +0.45 with the daily sleeve, so it was not diversifying while it paid that.'),
    ('M3', 'macro', 'Donchian 55/20 daily',
     'Turtle-style long-range breakout; range breaks force slower participants to reprice.',
     donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0}, 85, '1d', COINS,
     'VALIDATED', 'Promoted to the MACRO sleeve, replacing the cut SMA. Cheapest to run of '
     'anything here (3.1%/yr cost drag vs the SMA 30.9%) and uncorrelated with the daily sleeve. '
     'Still CONDITIONAL on substance: edge decayed (train +49% vs test +2.2%), n=49, and recent '
     'years are +2.2-2.8%, not the headline +12.85%.'),
    ('M1', 'macro', 'TSMOM 120d',
     'Time-series momentum, the most documented futures anomaly (Moskowitz/Ooi/Pedersen).',
     tsmom, {'look': 120, 'atr_mult': 4.0}, 150, '1d', COINS, 'CUT',
     'CUT 2026-09-05: trimmed expectancy -0.26%, i.e. no edge outside the tail. Also 0.73-1.00 '
     'correlated with every other trend variant. M3 Donchian is the same bet with a positive '
     'trimmed edge and a tenth of the turnover.'),
    ('M5', 'macro', 'Funding-Regime Trend',
     'Funding is the revealed-preference price of leveraged exposure; its multi-week sign '
     'identifies the macro regime.',
     funding_regime, {'fund_n': 14, 'trend_n': 50, 'atr_mult': 4.0, 'funding': None}, 90, '1d',
     COINS, 'CONDITIONAL', 'Survives the cost cut (trimmed +0.60%, 6% cost share) but the '
     'margin is thin and it overlaps the trend family. Not promoted; kept as a candidate.'),
    ('M2', 'macro', 'Golden Cross 50/200',
     'Classic long-horizon regime filter; validated on 55 years of Nasdaq in prior work.',
     golden_cross, {'fast': 50, 'slow': 200, 'atr_mult': 4.0}, 210, '1d', COINS, 'REJECTED',
     'Fails on crypto: -4.29%/trade pooled, negative on BTC/ETH/SOL. Crypto cycles are far '
     'faster than equities, so a 200d filter enters near tops.'),
    ('D3', 'daily', 'Funding-Crowding Fade',
     'Extreme funding marks crowded positioning by holders who bleed hourly; the unwind is '
     'directional.',
     funding_crowding, {'fund_n': 3, 'pct': 0.90, 'pct_win': 180, 'atr_mult': 3.0,
                        'max_hold': 10, 'funding': None}, 200, '1d', COINS, 'REJECTED',
     "Kills the vault's prior 'most promising' lead. Negative in its ORIGINAL 4h short-only "
     'form too, including on the ETH/SOL it supposedly held on.'),
    ('D2', 'daily', 'Capitulation Reversion',
     'Cascades overshoot; liquidity providers absorbing forced flow get paid for it.',
     capitulation_reversion, {'z': 2.0, 'vol_n': 60, 'hold': 5, 'atr_mult': 2.5,
                              'vol_mult': 1.5}, 90, '1d', COINS, 'REJECTED',
     'train +1.17% / test -1.27% - the sign-flip signature of noise.'),
    ('D4', 'daily', 'Volatility Squeeze',
     'Vol clusters; a compression is a coiled spring and the expansion is mechanically amplified.',
     vol_squeeze, {'vol_n': 20, 'pct': 0.30, 'n': 20, 'atr_mult': 2.5, 'max_hold': 10}, 280,
     '1d', COINS, 'REJECTED', 'Inconclusive: n=53, train +0.05% - not enough evidence either way.'),
    ('D5', 'daily', 'BTC Lead-Lag',
     'Information enters crypto through BTC first; alts are slower, higher-beta claims on it.',
     btc_leadlag, {'look': 3, 'thresh': 1.0, 'hold': 3, 'atr_mult': 2.5, 'btc_bars': BTC_BARS},
     90, '1d', ['ETH', 'SOL', 'HYPE'], 'REJECTED',
     'Negative on every alt (-1.18% pooled, n=311). Predicted to be arbitraged away; it is.'),
    ('S5', 'daily', 'RSI(2) Reversal',
     'The most widely published short-horizon reversal system.',
     rsi2, {'lo': 10, 'hi': 90, 'hold': 2, 'atr_mult': 2.5}, 60, '1d', COINS, 'REJECTED',
     '-0.94%/trade on n=899. Large sample, unambiguous. Fame implies arbitrage.'),
    ('M6', 'macro', 'Cross-Sectional Momentum',
     'Capital rotates within crypto; long the strongest and short the weakest is market-neutral.',
     xs_momentum, None, 150, '1d', COINS, 'REJECTED',
     'Negative trimmed expectancy at every lookback. Four coins is too little breadth.'),
    ('M7', 'macro', 'Cross-Sectional Funding Carry',
     'Short the highest-funding perp and long the lowest to collect the spread as real cash flow.',
     carry_spread, None, 60, '1d', COINS, 'REJECTED',
     'Failed exactly as its own hypothesis predicted: median trade +0.03% (the carry IS '
     'collected) but -1.80% mean. Up by the stairs, down by the elevator.'),
    ('S2', 'daily', 'Session / Time-of-Day',
     'Institutional flow concentrates in US hours, retail in Asia hours.',
     session_effect, {'slot': 16, 'hold': 1, 'atr_mult': 4.0}, 60, '4h', COINS, 'REJECTED',
     'All six UTC slots negative by roughly the cost of trading. No session effect exists.'),
    ('S1', 'daily', 'Short-Term Reversal',
     'Pure mean reversion without a volume gate, to isolate whether D2 failed on the gate '
     'or the premise.',
     st_reversal, {'look': 2, 'z': 1.5, 'hold': 3, 'atr_mult': 2.5}, 90, '1d', COINS, 'REJECTED',
     '1 of 12 configurations positive. Third independent rejection of mean reversion here.'),
]


def basis_row():
    """B1 needs each coin's spot series, so it cannot go through pooled.pooled()."""
    import run_basis
    per, m = run_basis.run(run_basis.BASE)
    tr, te = pooled.pooled_split(m)
    yr = pooled.pooled_yearly(m)
    return {
        'id': 'B1', 'family': 'daily', 'label': 'Perp-Spot Basis Dislocation',
        'status': 'VALIDATED', 'interval': '1d', 'coins': run_basis.COINS,
        'params': {k: v for k, v in run_basis.BASE.items() if k != 'basis'},
        'hypothesis': 'The perp is where leverage lives and spot is where unlevered '
                      'ownership lives. A perp trading rich to spot means leveraged buyers '
                      'are bidding for exposure faster than anyone will buy the underlying; '
                      'that premium is the price of impatience, paid by the weakest holders '
                      'in the market, and it unwinds.',
        'note': 'The ONLY strategy here that is independent of the others - same-side overlap '
                'with forced-flow is 0.35-0.59, at or below the ~0.50 of unrelated strategies. '
                'All 15 of 15 perturbations positive on both train and test. But it has the '
                'shortest history of anything shipped (spot data starts 2025), does NOT work '
                'on SOL, and its most recent half-year is negative.',
        'n': m.n, 'win_rate': m.win_rate, 'expectancy': m.expectancy,
        'trimmed': m.trimmed_expectancy(0.05), 'median': m.median_trade,
        'train': tr.expectancy if tr else None, 'test': te.expectancy if te else None,
        'train_n': tr.n if tr else 0, 'test_n': te.n if te else 0,
        'acct_cagr': m.account_cagr(0.20), 'acct_dd': m.account_equity(0.20)['max_dd'],
        'avg_days_held': m.avg_days_held, 'trades_per_year': m.trades_per_year(),
        'profit_factor': (m.profit_factor if m.profit_factor != float('inf') else None),
        'avg_funding': sum(t.funding_pct for t in m.trades) / m.n if m.n else 0,
        'years': [{'year': y, 'exp': r.expectancy, 'n': r.n} for y, r in yr],
        'per_coin': {c: {'n': per[c].n, 'win_rate': per[c].win_rate,
                         'expectancy': per[c].expectancy,
                         'trimmed': per[c].trimmed_expectancy(0.05),
                         'acct_cagr': per[c].account_cagr(0.20)}
                     for c in run_basis.COINS if c in per and per[c].n},
    }


def summarise(spec):
    sid, family, label, hypo, fn, params, warm, interval, coins, status, note = spec
    row = {'id': sid, 'family': family, 'label': label, 'hypothesis': hypo,
           'status': status, 'note': note, 'interval': interval, 'coins': coins,
           'params': {k: v for k, v in (params or {}).items()
                      if k not in ('funding', 'btc_bars', 'peers', 'peer_funding')}}
    if params is None:                       # cross-sectional ones need a special runner
        row['skip_metrics'] = True
        return row
    try:
        per, m = pooled.pooled(fn, params, coins, warm, interval=interval, name=label)
    except Exception as e:                   # noqa: BLE001 - a broken spec must not kill the export
        row['error'] = str(e)[:160]
        return row
    if m.n == 0:
        row['n'] = 0
        return row
    tr, te = pooled.pooled_split(m)
    yr = pooled.pooled_yearly(m)
    row.update({
        'n': m.n, 'win_rate': m.win_rate, 'expectancy': m.expectancy,
        'trimmed': m.trimmed_expectancy(0.05), 'median': m.median_trade,
        'train': tr.expectancy if tr else None, 'test': te.expectancy if te else None,
        'train_n': tr.n if tr else 0, 'test_n': te.n if te else 0,
        'acct_cagr': m.account_cagr(0.20), 'acct_dd': m.account_equity(0.20)['max_dd'],
        'avg_days_held': m.avg_days_held, 'trades_per_year': m.trades_per_year(),
        'profit_factor': (m.profit_factor if m.profit_factor != float('inf') else None),
        'avg_funding': sum(t.funding_pct for t in m.trades) / m.n,
        'years': [{'year': y, 'exp': r.expectancy, 'n': r.n} for y, r in yr],
        'per_coin': {c: {'n': per[c].n, 'win_rate': per[c].win_rate,
                         'expectancy': per[c].expectancy,
                         'trimmed': per[c].trimmed_expectancy(0.05),
                         'acct_cagr': per[c].account_cagr(0.20)}
                     for c in coins if c in per and per[c].n},
    })
    return row


out = {'generated': datetime.datetime.utcnow().isoformat() + 'Z',
       'cost_model': {'taker_fee': engine.TAKER_FEE, 'slippage': engine.SLIPPAGE,
                      'round_trip': 2 * (engine.TAKER_FEE + engine.SLIPPAGE)},
       'window': 'tradeable 2023-06-08 onward, real Hyperliquid funding',
       'strategies': []}
try:
    b = basis_row()
    out['strategies'].append(b)
    print('{:<6} {:<34} {:<12} n={}'.format(b['id'], b['label'][:33], b['status'], b['n']))
except Exception as e:                       # noqa: BLE001
    print('B1 basis export failed: {}'.format(str(e)[:200]))

for spec in SPECS:
    r = summarise(spec)
    out['strategies'].append(r)
    print('{:<6} {:<34} {:<12} n={}'.format(r['id'], r['label'][:33], r['status'],
                                            r.get('n', '-')))

json.dump(out, open('research/strategy_results.json', 'w'), indent=1)
print('\nwrote research/strategy_results.json')
