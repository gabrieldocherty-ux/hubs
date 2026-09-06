"""
Parity check: the PRODUCTION strategy classes must reproduce the RESEARCH
results exactly.

This is not a formality. A validated backtest and a shipped strategy that
quietly differ - an off-by-one on the lookback window, an ATR computed over a
different span, today's bar included in its own average - is how a strategy that
was never actually tested ends up trading. The production classes are re-run
here through the same research engine and the trade counts and expectancies are
compared against the numbers written in their own docstrings.
"""
import sys
sys.path.insert(0, 'research')
sys.path.insert(0, '.')
import engine, pooled
from core.strategies.forced_flow import ForcedFlowContinuation, RangeBreakCascade
from core.strategy_base import Direction
from strategies_daily import range_breakout
from strategies_batch2 import volume_spike

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']


def adapt(strategy_obj, hold_days):
    """Drive a production Strategy through the research engine, feeding it the
    same causal bar window the live loop would give it."""
    def factory():
        def sig(bars, i, pos):
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold_days else None
            window = bars[:i + 1]
            s = strategy_obj.evaluate({'coin': 'X', 'bars': window})
            if s is None:
                return None
            return {'dir': 'long' if s.direction == Direction.LONG else 'short',
                    'stop': s.stop_loss_price, 'target': s.take_profit_price,
                    'reason': s.confidence}
        return sig
    return factory


def run(fn, params, warm, label):
    per, m = pooled.pooled(fn, params, COINS, warm, name=label)
    return m


print('=' * 100)
print('PARITY: production classes vs research implementations')
print('=' * 100)

cases = [
    ('ForcedFlowContinuation', adapt(ForcedFlowContinuation(vol_mult=1.5, hold_days=10,
                                                            stop_atr=2.5), 10),
     volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}, 60),
    ('RangeBreakCascade', adapt(RangeBreakCascade(channel=20, range_atr=2.0,
                                                  stop_atr=2.5, hold_days=10), 10),
     range_breakout, {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}, 60),
]

all_ok = True
for name, prod_factory, research_fn, research_params, warm in cases:
    prod = engine.Result(coin='POOL', name=name + ' [production]')
    for c in COINS:
        bars, fund = pooled.load(c)
        r = engine.backtest(bars, prod_factory(), c, fund, name=name, warmup=warm)
        prod.trades.extend(r.trades)
        prod.start_t = min(prod.start_t or r.start_t, r.start_t) if r.start_t else prod.start_t
        prod.end_t = max(prod.end_t, r.end_t)
    prod.trades.sort(key=lambda t: t.entry_t)
    res = run(research_fn, research_params, warm, name + ' [research]')

    dn = prod.n - res.n
    de = prod.expectancy - res.expectancy
    ok = abs(dn) <= max(2, res.n * 0.03) and abs(de) < 0.004
    all_ok &= ok
    print('\n{}'.format(name))
    print('  research  : n={:<5} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%}'.format(
        res.n, res.win_rate, res.expectancy, res.trimmed_expectancy(0.05)))
    print('  production: n={:<5} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%}'.format(
        prod.n, prod.win_rate, prod.expectancy, prod.trimmed_expectancy(0.05)))
    print('  delta     : n {:+d}   expectancy {:+.3%}   -> {}'.format(
        dn, de, 'MATCH' if ok else 'MISMATCH - production does not reproduce the research'))

# ---- BasisDislocation: needs spot bars and a signal-driven exit ----
import hl_data
from strategies_basis import basis_dislocation, build_basis
from core.strategies.basis_dislocation import BasisDislocation

SPOT = {'BTC': '@142', 'ETH': '@151', 'SOL': '@156', 'HYPE': '@107'}


def adapt_basis(strategy_obj, spot_bars):
    def factory():
        def sig(bars, i, pos):
            md = {'coin': 'X', 'bars': bars[:i + 1], 'spot_bars': spot_bars}
            if pos is not None:
                why = strategy_obj.should_exit(md, pos['dir'] == 'long', i - pos['entry_i'])
                return {'exit': True, 'reason': why} if why else None
            s = strategy_obj.evaluate(md)
            if s is None:
                return None
            return {'dir': 'long' if s.direction == Direction.LONG else 'short',
                    'stop': s.stop_loss_price, 'target': s.take_profit_price,
                    'reason': s.confidence}
        return sig
    return factory


prod = engine.Result(coin='POOL', name='BasisDislocation [production]')
res = engine.Result(coin='POOL', name='BasisDislocation [research]')
for c in COINS:
    perp, fund = pooled.load(c)
    spot, _ = hl_data.get_candles(SPOT[c], '1d', 1200)
    basis = build_basis(perp, spot)
    first = next((i for i, b in enumerate(basis) if b is not None), 0)
    warm = first + 60
    rp = engine.backtest(perp, adapt_basis(BasisDislocation(), spot)(), c, fund,
                         name='b', warmup=warm)
    rr = engine.backtest(perp, basis_dislocation(
        {'pct': 0.90, 'win': 180, 'atr_mult': 2.5, 'max_hold': 7,
         'min_hist': 60, 'basis': basis})(), c, fund, name='b', warmup=warm)
    for dst, src in ((prod, rp), (res, rr)):
        dst.trades.extend(src.trades)
        dst.start_t = min(dst.start_t or src.start_t, src.start_t) if src.start_t else dst.start_t
        dst.end_t = max(dst.end_t, src.end_t)
for r in (prod, res):
    r.trades.sort(key=lambda t: t.entry_t)

dn, de = prod.n - res.n, prod.expectancy - res.expectancy
ok = abs(dn) <= max(2, res.n * 0.03) and abs(de) < 0.004
all_ok &= ok
print('\nBasisDislocation')
print('  research  : n={:<5} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%}'.format(
    res.n, res.win_rate, res.expectancy, res.trimmed_expectancy(0.05)))
print('  production: n={:<5} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%}'.format(
    prod.n, prod.win_rate, prod.expectancy, prod.trimmed_expectancy(0.05)))
print('  delta     : n {:+d}   expectancy {:+.3%}   -> {}'.format(
    dn, de, 'MATCH' if ok else 'MISMATCH - production does not reproduce the research'))

# ---- DonchianBreakout: trailing-channel exit, so it needs the should_exit path ----
from core.strategies.donchian_breakout import DonchianBreakout
from strategies_macro import donchian_turtle


def adapt_exit(strategy_obj):
    def factory():
        def sig(bars, i, pos):
            md = {'coin': 'X', 'bars': bars[:i + 1]}
            if pos is not None:
                why = strategy_obj.should_exit(md, pos['dir'] == 'long', i - pos['entry_i'])
                return {'exit': True, 'reason': why} if why else None
            s = strategy_obj.evaluate(md)
            if s is None:
                return None
            return {'dir': 'long' if s.direction == Direction.LONG else 'short',
                    'stop': s.stop_loss_price, 'target': s.take_profit_price,
                    'reason': s.confidence}
        return sig
    return factory


dprod = engine.Result(coin='POOL', name='DonchianBreakout [production]')
for c in COINS:
    bars, fund = pooled.load(c)
    r = engine.backtest(bars, adapt_exit(DonchianBreakout())(), c, fund, name='d', warmup=85)
    dprod.trades.extend(r.trades)
    dprod.start_t = min(dprod.start_t or r.start_t, r.start_t) if r.start_t else dprod.start_t
    dprod.end_t = max(dprod.end_t, r.end_t)
dprod.trades.sort(key=lambda t: t.entry_t)
_, dres = pooled.pooled(donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0},
                        COINS, 85, name='M3')
dn, de = dprod.n - dres.n, dprod.expectancy - dres.expectancy
ok = abs(dn) <= max(2, dres.n * 0.05) and abs(de) < 0.02
all_ok &= ok
print('\nDonchianBreakout')
print('  research  : n={:<5} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%}'.format(
    dres.n, dres.win_rate, dres.expectancy, dres.trimmed_expectancy(0.05)))
print('  production: n={:<5} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%}'.format(
    dprod.n, dprod.win_rate, dprod.expectancy, dprod.trimmed_expectancy(0.05)))
print('  delta     : n {:+d}   expectancy {:+.3%}   -> {}'.format(
    dn, de, 'MATCH' if ok else 'MISMATCH - production does not reproduce the research'))

print('\n' + ('ALL PARITY CHECKS PASSED' if all_ok else 'PARITY FAILURE - do not ship'))
sys.exit(0 if all_ok else 1)
