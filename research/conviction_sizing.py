"""
Size by signal strength, not uniformly.

Every trade currently gets the same $16.25 regardless of how strong its signal
was. But the forced-flow work established a MONOTONIC DOSE-RESPONSE that
replicated on an independent window: as the range filter tightens from 1.0x to
3.0x ATR, win rate rises 52% -> 65% -> 74% -> 79%. That is a validated statement
that trade quality is predictable BEFORE entry, from a number already computed
at signal time.

Uniform sizing throws that away. Scaling exposure with signal strength is the
direct implication, and it is a safer kind of change than most: it does not
alter WHICH trades are taken, only how much each one gets. So it cannot curve-fit
the entry rule, and if it fails it fails cleanly.

Three schemes, all using the same underlying signal strength (day range / ATR):
  UNIFORM    what ships today - every trade the same size.
  STEPPED    discrete tiers, which is what a desk would actually run because it
             is auditable and robust to a slightly mis-estimated strength.
  LINEAR     size proportional to strength, capped - the theoretical version.

The rails still bind: nothing may exceed the 20%-of-capital ceiling, and
nothing may size below Hyperliquid's $10 minimum, where an order is refused
outright and the trade is SKIPPED rather than taken smaller. A sizing scheme
that quietly drops its weakest trades is not a sizing scheme, it is an entry
filter in disguise - so the floor is enforced and reported.
"""
import sys, statistics as st
sys.path.insert(0, 'research')
import engine, pooled

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
CAPITAL = 250.0
BASE_POS = 16.25          # 6.5% of capital
MAX_POS = CAPITAL * 0.20  # the hard rail
MIN_ORDER = 10.0


def strength_tagged(params):
    """S3's entry, recording each signal's range/ATR strength in the reason
    string so sizing can be applied afterwards without re-deriving it."""
    vol_mult, atr_mult, hold = params['vol_mult'], params['atr_mult'], params['hold']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
                state['vma'] = engine.sma_series([b['v'] for b in bars], 20)
            atr = state['atr'][i]
            if atr is None or atr <= 0:
                return None
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            vma = state['vma'][i]
            b = bars[i]
            if not vma or vma <= 0 or b['v'] < vol_mult * vma:
                return None
            want = 'long' if b['c'] > b['o'] else ('short' if b['c'] < b['o'] else None)
            if want is None:
                return None
            # strength: how outsized the day's range is, and how outsized volume is
            rng_mult = (b['h'] - b['l']) / atr
            vol_ratio = b['v'] / vma
            px = b['c']
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': 'STR|{:.4f}|{:.4f}'.format(rng_mult, vol_ratio)}
        return sig
    return factory


def parse_strength(reason):
    try:
        _, rng, vol = reason.split('|')
        return float(rng), float(vol)
    except Exception:
        return None, None


def size_for(scheme, rng_mult):
    """Dollars for a trade of this signal strength."""
    if scheme == 'uniform':
        return BASE_POS
    if scheme == 'stepped':
        if rng_mult >= 2.5:
            s = BASE_POS * 2.0
        elif rng_mult >= 2.0:
            s = BASE_POS * 1.5
        elif rng_mult >= 1.5:
            s = BASE_POS * 1.0
        else:
            s = BASE_POS * 0.6
    else:  # linear in strength, centred on 1.5x
        s = BASE_POS * max(0.5, min(2.0, rng_mult / 1.5))
    return min(s, MAX_POS)


_, m = pooled.pooled(strength_tagged, {'vol_mult': 1.5, 'atr_mult': 2.5, 'hold': 10},
                     COINS, 60, name='S3')

print('=' * 112)
print('DOES SIGNAL STRENGTH PREDICT OUTCOME?  (the premise, re-checked on S3 as shipped)')
print('=' * 112)
buckets = {'<1.0': [], '1.0-1.5': [], '1.5-2.0': [], '2.0-2.5': [], '>=2.5': []}
for t in m.trades:
    rng, _ = parse_strength(t.exit_reason if 'STR|' in str(t.exit_reason) else '')
    rng = rng if rng is not None else None
    # exit_reason is overwritten on close, so recover strength from entry reason
for t in m.trades:
    pass
# recompute cleanly: re-run capturing the entry reason
res = engine.Result(coin='POOL', name='S3')
for c in COINS:
    bars, fund = pooled.load(c)
    r = engine.backtest(bars, strength_tagged(
        {'vol_mult': 1.5, 'atr_mult': 2.5, 'hold': 10})(), c, fund, name='S3', warmup=60)
    res.trades.extend(r.trades)
    res.start_t = min(res.start_t or r.start_t, r.start_t) if r.start_t else res.start_t
    res.end_t = max(res.end_t, r.end_t)

print('  NOTE: the engine records the EXIT reason on a closed trade, so signal')
print('  strength is recovered by re-deriving it from the entry bar below.')

# derive strength per trade from the bars directly
tagged = []
for c in COINS:
    bars, fund = pooled.load(c)
    atr = engine.atr_series(bars, 14)
    vma = engine.sma_series([b['v'] for b in bars], 20)
    idx = {b['t']: i for i, b in enumerate(bars)}
    r = engine.backtest(bars, strength_tagged(
        {'vol_mult': 1.5, 'atr_mult': 2.5, 'hold': 10})(), c, fund, name='S3', warmup=60)
    for t in r.trades:
        i = idx.get(t.entry_t)
        if i is None or i == 0 or atr[i - 1] is None or not atr[i - 1]:
            continue
        sb = bars[i - 1]              # the SIGNAL bar is the one before the fill
        tagged.append((t, (sb['h'] - sb['l']) / atr[i - 1]))

print('\n  {:<12}{:>8}{:>12}{:>12}{:>12}'.format('range/ATR', 'n', 'win rate', 'expectancy', 'trimmed'))
edges = [(0, 1.0), (1.0, 1.5), (1.5, 2.0), (2.0, 2.5), (2.5, 99)]
for lo, hi in edges:
    sel = [t for t, s in tagged if lo <= s < hi]
    if len(sel) < 8:
        continue
    rr = engine.Result(coin='B', name='b')
    rr.trades = sel
    print('  {:<12}{:>8}{:>12}{:>12}{:>12}'.format(
        '{}-{}'.format(lo, hi if hi < 99 else '+'), len(sel),
        '{:.1%}'.format(rr.win_rate), '{:+.2f}%'.format(rr.expectancy * 100),
        '{:+.2f}%'.format(rr.trimmed_expectancy(0.05) * 100)))

print('\n' + '=' * 112)
print('DOES SIZING BY IT HELP?  (account P&L, $250, rails enforced)')
print('=' * 112)
print('  {:<14}{:>12}{:>14}{:>14}{:>14}{:>12}'.format(
    'scheme', 'trades', 'total P&L', 'avg size', 'max size', 'skipped <$10'))
for scheme in ('uniform', 'stepped', 'linear'):
    eq, sizes, skipped = CAPITAL, [], 0
    for t, s in sorted(tagged, key=lambda x: x[0].entry_t):
        pos = size_for(scheme, s)
        if pos < MIN_ORDER:
            skipped += 1
            continue
        sizes.append(pos)
        eq += t.pnl_pct * pos
    print('  {:<14}{:>12}{:>14}{:>14}{:>14}{:>12}'.format(
        scheme, len(sizes), '${:+.2f}'.format(eq - CAPITAL),
        '${:.2f}'.format(st.mean(sizes)) if sizes else '-',
        '${:.2f}'.format(max(sizes)) if sizes else '-', skipped))

print("""
  Compare like with like: 'stepped' and 'linear' deploy MORE average capital
  than uniform, so a bigger total is expected and proves nothing on its own.
  The question is whether P&L rises FASTER than the capital deployed - i.e.
  whether return per dollar risked improves. That ratio is below.""")

print('\n  {:<14}{:>16}{:>18}{:>16}'.format(
    'scheme', 'avg $ deployed', 'P&L per $ risked', 'vs uniform'))
ratios = {}
for scheme in ('uniform', 'stepped', 'linear'):
    tot, dep = 0.0, 0.0
    for t, s in tagged:
        pos = size_for(scheme, s)
        if pos < MIN_ORDER:
            continue
        tot += t.pnl_pct * pos
        dep += pos
    ratios[scheme] = tot / dep if dep else 0
    print('  {:<14}{:>16}{:>18}{:>16}'.format(
        scheme, '${:,.0f}'.format(dep), '{:+.3f}%'.format(ratios[scheme] * 100),
        '' if scheme == 'uniform' else '{:+.3f}pp'.format(
            (ratios[scheme] - ratios['uniform']) * 100)))
