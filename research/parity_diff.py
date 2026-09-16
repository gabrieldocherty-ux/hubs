"""
Diagnostic sibling of parity_test.py: instead of comparing AGGREGATES, it
compares the actual trade lists trade-for-trade and prints every one that
appears on only one side.

Aggregate parity is a weaker claim than it looks. Two differences that cancel -
one extra trade at +4% and one missing trade at +4% - leave n and expectancy
untouched while the production strategy is trading on days the research version
never touched. This script exists to expose that class of difference, and to
locate it precisely enough to fix.
"""
import sys
sys.path.insert(0, 'research')
sys.path.insert(0, '.')
import datetime
import engine, pooled, hl_data
from core.strategy_base import Direction
from core.strategies.forced_flow import ForcedFlowContinuation, RangeBreakCascade
from core.strategies.basis_dislocation import BasisDislocation
from core.strategies.donchian_breakout import DonchianBreakout
from strategies_daily import range_breakout
from strategies_batch2 import volume_spike
from strategies_basis import basis_dislocation, build_basis
from strategies_macro import donchian_turtle

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
SPOT = {'BTC': '@142', 'ETH': '@151', 'SOL': '@156', 'HYPE': '@107'}


def d(ms):
    return datetime.datetime.utcfromtimestamp(ms / 1000).strftime('%Y-%m-%d')


def prod_sig(obj, hold_days=None, spot=None, use_should_exit=False):
    def factory():
        def sig(bars, i, pos):
            md = {'coin': 'X', 'bars': bars[:i + 1]}
            if spot is not None:
                md['spot_bars'] = spot
            if pos is not None:
                if use_should_exit:
                    why = obj.should_exit(md, pos['dir'] == 'long', i - pos['entry_i'])
                    return {'exit': True, 'reason': why} if why else None
                return ({'exit': True, 'reason': 'timeout'}
                        if i - pos['entry_i'] >= hold_days else None)
            s = obj.evaluate(md)
            if s is None:
                return None
            return {'dir': 'long' if s.direction == Direction.LONG else 'short',
                    'stop': s.stop_loss_price, 'target': s.take_profit_price,
                    'reason': s.confidence}
        return sig
    return factory


def compare(label, prod_trades, res_trades):
    """Key on (coin, entry date, direction) - the identity of a trade."""
    pk = {(t.coin, t.entry_t, t.direction): t for t in prod_trades}
    rk = {(t.coin, t.entry_t, t.direction): t for t in res_trades}
    only_p = sorted(set(pk) - set(rk), key=lambda k: k[1])
    only_r = sorted(set(rk) - set(pk), key=lambda k: k[1])
    print('\n{}: prod n={} research n={}  common={}  prod-only={}  research-only={}'.format(
        label, len(prod_trades), len(res_trades), len(set(pk) & set(rk)),
        len(only_p), len(only_r)))
    for k in only_p:
        t = pk[k]
        print('   PROD ONLY     {} {} {}  exit {} {}  pnl {:+.2%}'.format(
            k[0], d(k[1]), k[2], d(t.exit_t), t.exit_reason, t.pnl_pct))
    for k in only_r:
        t = rk[k]
        print('   RESEARCH ONLY {} {} {}  exit {} {}  pnl {:+.2%}'.format(
            k[0], d(k[1]), k[2], d(t.exit_t), t.exit_reason, t.pnl_pct))
    # trades present on both sides but that ended differently
    diff_exit = 0
    for k in set(pk) & set(rk):
        a, b = pk[k], rk[k]
        if a.exit_t != b.exit_t or abs(a.pnl_pct - b.pnl_pct) > 1e-9:
            diff_exit += 1
            if diff_exit <= 10:
                print('   EXIT DIFFERS  {} {} {}  prod exit {} {} {:+.2%} | '
                      'research exit {} {} {:+.2%}'.format(
                          k[0], d(k[1]), k[2], d(a.exit_t), a.exit_reason, a.pnl_pct,
                          d(b.exit_t), b.exit_reason, b.pnl_pct))
    if diff_exit:
        print('   ({} trades share an entry but not an exit)'.format(diff_exit))
    return not (only_p or only_r or diff_exit)


def run_pair(label, prod_factory_for, research_fn, research_params, warm,
             research_params_for=None):
    p, r = [], []
    for c in COINS:
        bars, fund = pooled.load(c)
        p += engine.backtest(bars, prod_factory_for(c)(), c, fund, warmup=warm).trades
        params = research_params_for(c) if research_params_for else research_params
        r += engine.backtest(bars, research_fn(params)(), c, fund, warmup=warm).trades
    return compare(label, p, r)


ok = True
ok &= run_pair('ForcedFlowContinuation',
               lambda c: prod_sig(ForcedFlowContinuation(1.5, 10, 2.5), hold_days=10),
               volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}, 60)

ok &= run_pair('RangeBreakCascade',
               lambda c: prod_sig(RangeBreakCascade(20, 2.0, 2.5, 10), hold_days=10),
               range_breakout, {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}, 60)

ok &= run_pair('DonchianBreakout',
               lambda c: prod_sig(DonchianBreakout(), use_should_exit=True),
               donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0}, 85)

# Basis needs per-coin spot bars, so it gets its own loop.
p, r = [], []
for c in COINS:
    perp, fund = pooled.load(c)
    spot, _ = hl_data.get_candles(SPOT[c], '1d', 1200)
    basis = build_basis(perp, spot)
    warm = next((i for i, b in enumerate(basis) if b is not None), 0) + 60
    p += engine.backtest(perp, prod_sig(BasisDislocation(), spot=spot,
                                        use_should_exit=True)(), c, fund, warmup=warm).trades
    r += engine.backtest(perp, basis_dislocation(
        {'pct': 0.90, 'win': 180, 'atr_mult': 2.5, 'max_hold': 7,
         'min_hist': 60, 'basis': basis})(), c, fund, warmup=warm).trades
ok &= compare('BasisDislocation', p, r)

print('\n' + ('EXACT TRADE-FOR-TRADE PARITY' if ok else 'DIFFERENCES FOUND'))
