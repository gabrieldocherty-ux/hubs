"""
What would a net-directional-exposure cap have cost?

The concentration measurement found the book reaching 12 simultaneous positions
(78% of capital gross) with 30.3% of active days holding 4+ positions at least
80% one-directional - and on 2025-11-15, ten positions all pointing the same
way. The existing rails do not see this: they cap each trade and each family,
so four aligned positions and four opposing ones are treated identically even
though the first is 4x one bet and the second is nearly flat.

The fix is a cap on NET directional exposure (longs minus shorts) rather than
gross. It lets the book hold many positions when they offset, and only bites
when they pile onto the same side.

But a risk control that costs a lot of return needs justifying, so this measures
the trade-off rather than picking a number and asserting it. Simulated by
replaying every trade in time order across all three daily strategies and
refusing any entry that would push net one-way exposure past the cap - which is
exactly what the risk manager would do live.
"""
import sys, datetime, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
POS = 16.25
CAPITAL = 250.0


def all_trades():
    _, s3 = pooled.pooled(volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5},
                          COINS, 60, name='S3')
    _, d1 = pooled.pooled(range_breakout, {'n': 20, 'atr_mult': 2.5, 'max_hold': 10,
                                           'atr_ratio': 2.0}, COINS, 60, name='D1')
    _, b1 = run_basis.run(run_basis.BASE)
    out = []
    for tag, r in (('S3', s3), ('D1', d1), ('B1', b1)):
        for t in r.trades:
            out.append((tag, t))
    out.sort(key=lambda x: x[1].entry_t)
    return out


TRADES = all_trades()


def simulate(cap_frac):
    """Replay in time order. `cap_frac` is the max NET one-way exposure as a
    fraction of capital; None means no cap (today's behaviour)."""
    open_pos = []          # (exit_t, direction, notional)
    pnl = 0.0
    taken = skipped = 0
    peak_net = 0.0
    for tag, t in TRADES:
        open_pos = [p for p in open_pos if p[0] > t.entry_t]
        net = sum(n if d == 'long' else -n for _, d, n in open_pos)
        if cap_frac is not None:
            delta = POS if t.direction == 'long' else -POS
            if abs(net + delta) > CAPITAL * cap_frac and abs(net + delta) > abs(net):
                skipped += 1
                continue
        open_pos.append((t.exit_t, t.direction, POS))
        net = sum(n if d == 'long' else -n for _, d, n in open_pos)
        peak_net = max(peak_net, abs(net))
        pnl += t.pnl_pct * POS
        taken += 1
    return {'pnl': pnl, 'taken': taken, 'skipped': skipped, 'peak_net': peak_net}


print('=' * 112)
print('COST OF A NET-DIRECTIONAL-EXPOSURE CAP')
print('  Replaying all {} trades across S3 + D1 + B1 in time order.'.format(len(TRADES)))
print('=' * 112)
print('  {:<18}{:>10}{:>10}{:>14}{:>16}{:>16}'.format(
    'cap (net one-way)', 'taken', 'skipped', 'total P&L', 'peak net expo', 'P&L per trade'))
base = simulate(None)
for cap in (None, 1.00, 0.80, 0.60, 0.50, 0.40, 0.30, 0.20):
    r = simulate(cap)
    label = 'none (today)' if cap is None else '{:.0%} of capital'.format(cap)
    print('  {:<18}{:>10}{:>10}{:>14}{:>16}{:>16}'.format(
        label, r['taken'], r['skipped'], '${:+.2f}'.format(r['pnl']),
        '${:.2f} ({:.0%})'.format(r['peak_net'], r['peak_net'] / CAPITAL),
        '${:+.3f}'.format(r['pnl'] / r['taken']) if r['taken'] else '-'))

print("""
  Read the last column, not the total. A cap that skips trades will always show
  a lower TOTAL - the question is whether the trades it skips were worse than
  average. If P&L per trade holds up or improves while peak exposure falls, the
  cap is removing risk without removing edge, which is the only kind of risk
  control worth having.""")

print('\n' + '=' * 112)
print('WHAT THE CAP PROTECTS AGAINST')
print('=' * 112)
worst = []
for c in COINS:
    bars, _ = pooled.load(c)
    rets = [(bars[i]['c'] - bars[i - 1]['c']) / bars[i - 1]['c'] for i in range(1, len(bars))]
    worst.append(min(rets))
avg_worst = st.mean(worst)
print('  Average worst single-day move across the four coins: {:.1%}'.format(avg_worst))
print('  {:<18}{:>18}{:>22}'.format('cap', 'peak net exposure', 'one-day loss if it gaps'))
for cap in (None, 0.60, 0.50, 0.40, 0.30):
    r = simulate(cap)
    loss = r['peak_net'] * avg_worst
    label = 'none (today)' if cap is None else '{:.0%}'.format(cap)
    print('  {:<18}{:>18}{:>22}'.format(
        label, '${:.2f}'.format(r['peak_net']),
        '${:.2f} ({:.1%} of capital)'.format(loss, loss / CAPITAL)))
print("""
  The daily loss breaker sits at 10% of capital. Any row whose gap loss exceeds
  that would trip the breaker and halt trading account-wide - recoverable, but
  it means the cap is doing its work only after the damage. A cap that keeps the
  worst plausible day inside the breaker is the sensible target.""")
