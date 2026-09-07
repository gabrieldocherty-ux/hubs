"""
GAP AUDIT + the risk nobody has measured: how often does the whole book take
the same bet at once?

Honest list of what has and has not been examined:

  EXAMINED   entries (16+ hypotheses, most rejected), exits (this session -
             10d hold validated, trailing stops and longer holds rejected),
             per-trade sizing (conviction sizing found), the coin universe
             (expansion tested and failed), execution cost (measured on the
             live book), capital allocation (75/25 daily/macro), timeframe
             (daily works, 4h did not replicate).

  NOT EXAMINED
    1. CONCENTRATION - crypto majors are highly correlated. When BTC, ETH, SOL
       and HYPE all cascade on the same day, every strategy signals the same
       direction and the book holds 4x one bet. Nothing in the risk manager
       looks at this: the sleeve caps limit total notional per FAMILY, and the
       position cap limits each trade, but neither notices that four positions
       are the same trade. Measured below.
    2. INTRADAY ENTRY TIMING - the cascade is an intraday event, yet every
       strategy fills at the NEXT DAILY OPEN, up to 24h later. Never tested.
    3. MAKER vs TAKER - everything assumes market orders (0.045%). Maker is
       0.015%. On a daily-bar signal there is time to work a limit order.
    4. STOP DISTANCE - 2.5x ATR was picked as reasonable and only ever swept,
       never reasoned about.
    5. CROSS-STRATEGY CONFIRMATION - e.g. size up when S3 and B1 agree.
    6. REGIME DETECTION - trend decayed after 2023; nothing detects that live.

This script measures (1), because it is a live risk rather than a missed
opportunity, and an unmeasured risk is the worse of the two.
"""
import sys, datetime, statistics as st
sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
POS = 16.25
CAPITAL = 250.0


def day(ms):
    return datetime.datetime.utcfromtimestamp(ms / 1000).date()


def positions_by_day(result):
    """coin -> set of days held, and the direction on each."""
    held = {}
    for t in result.trades:
        d0 = day(t.entry_t)
        d1 = day(t.exit_t)
        cur = d0
        while cur <= d1:
            held.setdefault(cur, []).append((t.coin, t.direction))
            cur += datetime.timedelta(days=1)
    return held


_, s3 = pooled.pooled(volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5},
                      COINS, 60, name='S3')
_, d1 = pooled.pooled(range_breakout, {'n': 20, 'atr_mult': 2.5, 'max_hold': 10,
                                       'atr_ratio': 2.0}, COINS, 60, name='D1')
_, b1 = run_basis.run(run_basis.BASE)

print('=' * 112)
print('1. HOW CONCENTRATED DOES THE BOOK GET?')
print('=' * 112)
for label, res in (('S3 forced-flow', s3), ('D1 range-break', d1), ('B1 basis', b1)):
    held = positions_by_day(res)
    if not held:
        continue
    counts = [len(v) for v in held.values()]
    # same-direction concentration: how many days have 3+ positions all one way
    aligned = 0
    for v in held.values():
        if len(v) >= 3:
            dirs = [d for _, d in v]
            if len(set(dirs)) == 1:
                aligned += 1
    dist = {}
    for c in counts:
        dist[c] = dist.get(c, 0) + 1
    print('\n  {}   ({} days with any position)'.format(label, len(held)))
    print('    positions open: ' + '  '.join(
        '{}:{} days ({:.0%})'.format(k, dist[k], dist[k] / len(held))
        for k in sorted(dist)))
    print('    days with 3+ positions ALL the same direction: {} ({:.1%} of active days)'.format(
        aligned, aligned / len(held)))
    print('    peak notional at ${:.2f}/position: ${:.2f} = {:.0%} of a ${:.0f} account'.format(
        POS, max(counts) * POS, max(counts) * POS / CAPITAL, CAPITAL))

print('\n' + '=' * 112)
print('2. THE WHOLE BOOK AT ONCE  (S3 + B1 + D1 running together)')
print('=' * 112)
allheld = {}
for res in (s3, b1, d1):
    for d, v in positions_by_day(res).items():
        allheld.setdefault(d, []).extend(v)
counts = [len(v) for v in allheld.values()]
aligned_days = []
for d, v in allheld.items():
    if len(v) >= 4:
        dirs = [x for _, x in v]
        frac = max(dirs.count('long'), dirs.count('short')) / len(dirs)
        if frac >= 0.8:
            aligned_days.append((d, len(v), frac))
print('  active days: {}   mean positions open: {:.1f}   peak: {}'.format(
    len(allheld), st.mean(counts), max(counts)))
print('  peak gross notional: ${:.2f} = {:.0%} of a ${:.0f} account'.format(
    max(counts) * POS, max(counts) * POS / CAPITAL, CAPITAL))
print('  days with 4+ positions at least 80% one-directional: {} ({:.1%} of active days)'.format(
    len(aligned_days), len(aligned_days) / len(allheld)))
if aligned_days:
    worst = sorted(aligned_days, key=lambda x: -x[1])[:5]
    print('  worst clustering: ' + ', '.join(
        '{} ({} positions, {:.0%} aligned)'.format(d, n, f) for d, n, f in worst))

print('\n' + '=' * 112)
print('3. DOES THE EXISTING RISK MANAGER CATCH THIS?')
print('=' * 112)
print("""  No, and it is worth being precise about why. The rails are:
    - max_position_pct_of_capital 20%  - caps EACH trade, not the sum of
      correlated ones
    - sleeve caps 75%/25%              - caps a FAMILY's notional, and S3, D1
      and B1 are all in the same 'daily' sleeve anyway
    - total exposure <= 1x capital     - caps gross size, but is blind to
      whether the positions are the same bet or opposing ones
    - daily loss breaker 10%           - fires AFTER the loss, by design

  So four aligned positions and four opposing ones are treated identically,
  even though the first is 4x one bet and the second is close to flat. On a
  ${:.0f} account at ${:.2f} a position the arithmetic ceiling is {:.0f}
  positions before gross notional reaches 1x capital - and the measurement
  above shows how close the book actually gets.""".format(CAPITAL, POS, CAPITAL / POS))

print('\n' + '=' * 112)
print('4. WHAT A CORRELATED DRAWDOWN WOULD COST')
print('=' * 112)
print('  Worst single DAY for the book, if every open position moved against it')
print('  by its own coin\'s worst historical daily move:')
for n in (2, 4, 6, 8):
    # crude: 4 coins, worst daily moves observed
    worst = []
    for c in COINS:
        bars, _ = pooled.load(c)
        rets = [(bars[i]['c'] - bars[i - 1]['c']) / bars[i - 1]['c']
                for i in range(1, len(bars))]
        worst.append(min(rets))
    avg_worst = st.mean(worst)
    loss = n * POS * avg_worst
    print('    {} aligned positions: ${:.2f} = {:.1%} of capital  '
          '(avg worst daily move {:.1%})'.format(n, loss, loss / CAPITAL, avg_worst))
print("""
  The stop-loss caps this in practice - it is 2.5x ATR, well inside these
  moves - but a gap through the stop fills at the open, which is exactly what
  happens on the days when every coin moves together. That is the scenario
  worth sizing for, and nothing currently accounts for it.""")
