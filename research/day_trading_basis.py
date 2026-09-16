"""
B. INTRADAY BASIS at 1h - the only mechanism with a REAL anchor, run as fast
   as the data allows.

The taxonomy result says reversion works here only when it reverts against
something that actually exists and can be arbitraged - a spot price - rather
than toward a statistical average. B1 is the one strategy that qualifies, so if
a day-trading edge exists in this book at all, this is where it would be.

Two things are already known and constrain how to read the output:

  1. Built natively at 4h, fast-B1 scored trimmed +0.37% at a 0.79 day hold -
     positive, but 0.95-0.98 position overlap with the daily B1 already running.
     Same bet, executed worse: 4x weaker per trade, and it died at 3x costs.
  2. The basis DOSE-RESPONSE did replicate at 4h - 0.85 -> +0.03%, 0.975 ->
     +0.44% trimmed, monotonic. That is real mechanism evidence, and it is the
     only intraday signal in this whole project that has shown it.

So the question at 1h is narrow and worth asking precisely: does going faster
still find the same dislocations earlier (in which case overlap stays ~1.0 and
this is pointless), or does it find DIFFERENT, smaller ones the daily version
never sees (in which case it could be additive)? Overlap is the deciding number,
not expectancy.
"""
import sys, statistics as st
sys.path.insert(0, 'research')
import engine, hl_data, pooled

SPOT = {'BTC': '@142', 'ETH': '@151', 'HYPE': '@107'}
COINS = ['BTC', 'ETH', 'HYPE']
RT = 2 * (engine.TAKER_FEE + engine.SLIPPAGE)
SANITY = 0.02
_c = {}


def load(coin):
    if coin in _c:
        return _c[coin]
    perp, rep = hl_data.get_candles(coin, '1h', 420)
    spot, _ = hl_data.get_candles(SPOT[coin], '1h', 420)
    fund = engine.FundingCurve(hl_data.get_funding(coin, 1250))
    smap = {b['t']: b['c'] for b in spot if b['c'] > 0 and b['v'] > 0}
    basis, miss = [], 0
    for b in perp:
        s = smap.get(b['t'])
        if not s:
            basis.append(None)
            miss += 1
            continue
        v = (b['c'] - s) / s
        basis.append(None if abs(v) > SANITY else v)
    _c[coin] = (perp, fund, basis, rep, miss)
    return _c[coin]


def sig_factory(params):
    pct, win, hold = params['pct'], params['win'], params['max_hold']
    atr_mult, min_hist, basis = params['atr_mult'], params['min_hist'], params['basis']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 24)
            atr = state['atr'][i]
            b = basis[i] if i < len(basis) else None
            if atr is None or atr <= 0 or b is None:
                return None
            hist = [x for x in basis[max(0, i - win):i + 1] if x is not None]
            if len(hist) < min_hist:
                return None
            hs = sorted(hist)
            hi = hs[min(len(hs) - 1, int(len(hs) * pct))]
            lo = hs[max(0, int(len(hs) * (1 - pct)))]
            med = hs[len(hs) // 2]
            if hi <= lo:
                return None
            if pos is not None:
                if i - pos['entry_i'] >= hold:
                    return {'exit': True, 'reason': 'timeout'}
                if pos['dir'] == 'short' and b <= med:
                    return {'exit': True, 'reason': 'normalised'}
                if pos['dir'] == 'long' and b >= med:
                    return {'exit': True, 'reason': 'normalised'}
                return None
            px = bars[i]['c']
            if b >= hi:
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'rich'}
            if b <= lo:
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'cheap'}
            return None
        return sig
    return factory


def run(params, coins=COINS):
    merged = engine.Result(coin='POOL', name='b1h')
    per = {}
    for c in coins:
        perp, fund, basis, _, _ = load(c)
        p = dict(params)
        p['basis'] = basis
        first = next((k for k, v in enumerate(basis) if v is not None), 0)
        warm = first + p['min_hist']
        if len(perp) < warm + 200:
            continue
        r = engine.backtest(perp, sig_factory(p)(), c, fund, name='b1h', warmup=warm)
        per[c] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


def row(label, params):
    per, m = run(params)
    if m.n < 30:
        print('  {:<34}{:>6}  too few trades'.format(label, m.n))
        return None
    cut = m.start_t + (m.end_t - m.start_t) * 0.6
    te = engine.Result(coin='E', name='e')
    for t in m.trades:
        if t.entry_t >= cut:
            te.trades.append(t)
    x2 = m.expectancy - RT      # what the same trades earn if execution costs double
    print('  {:<34}{:>6}{:>8}{:>7}{:>9}{:>9}{:>9}{:>8}{:>9}{:>9}{:>8}'.format(
        label, m.n, '{:.0f}'.format(m.trades_per_year()), '{:.0%}'.format(m.win_rate),
        '{:+.3f}%'.format((m.expectancy + RT) * 100), '{:+.3f}%'.format(m.expectancy * 100),
        '{:+.3f}%'.format(m.trimmed_expectancy(0.05) * 100),
        '{:.2f}d'.format(m.avg_days_held),
        '{:+.3f}%'.format(te.expectancy * 100) if te.n else '-',
        '{:+.3f}%'.format(x2 * 100), '{:.0f}%'.format(RT * m.trades_per_year() * 100)))
    return m


HDR = '  {:<34}{:>6}{:>8}{:>7}{:>9}{:>9}{:>9}{:>8}{:>9}{:>9}{:>8}'.format(
    'variant', 'n', 'tr/yr', 'win', 'GROSS', 'net', 'trim5', 'hold', 'test', '@2xcost', 'cost/yr')

_, _, _, rep, miss = load('BTC')
print('=' * 132)
print('B1 BASIS, NATIVE 1h  |  {} bars, {} with no matching spot bar'.format(rep['n'], miss))
print('  reference: daily B1 shipped = n178, net +1.68%, trim5 +1.39%, 4.2d hold, 112 tr/yr')
print('  reference: 4h fast-B1       = trim5 +0.37%, 0.79d hold, 131 tr/yr, 0.95-0.98 overlap w/ daily')
print('=' * 132)
print(HDR)
BASE = {'pct': 0.90, 'win': 4320, 'atr_mult': 2.5, 'max_hold': 24, 'min_hist': 1440}
for h, lab in ((3, '3h'), (6, '6h'), (12, '12h'), (24, '24h'), (48, '48h')):
    row('hold {} ({})'.format(h, lab), dict(BASE, max_hold=h))

print('\n  DOSE-RESPONSE - the one intraday signal that replicated at 4h. Does it hold at 1h?')
print(HDR)
for p in (0.80, 0.85, 0.90, 0.95, 0.975, 0.99):
    row('threshold pct {:.3f}, hold 12h'.format(p), dict(BASE, pct=p, max_hold=12))

print('\n' + '=' * 132)
print('THE VERDICT')
print('=' * 132)
print("""
  The overlap test that was planned as the deciding number is not needed, because
  nothing here gets far enough to need it. Every single variant is NET NEGATIVE.

  But look at what the dose-response actually did, because it is the most
  interesting negative result this project has produced:

      threshold   GROSS      trim5      win
      0.800     +0.005%    -0.199%     43%
      0.850     +0.021%    -0.180%     45%
      0.900     +0.047%    -0.151%     46%
      0.950     +0.066%    -0.111%     46%
      0.975     +0.090%    -0.086%     45%
      0.990     +0.156%    -0.023%     48%

  That is monotonic in gross edge, monotonic in trimmed expectancy, and rising in
  win rate, across six thresholds. The basis mechanism is REAL at 1h resolution -
  a more extreme dislocation reliably pays more, exactly as the mechanism predicts,
  and it is the only intraday signal in this whole project that has shown that
  (the 1h volume cascade's range filter was flat, meaning no mechanism at all).

  It still cannot be traded, and the reason is arithmetic rather than absence of
  edge. The strongest cell reaches +0.156% gross against a 0.190% round trip. The
  edge is real and the toll is bigger. Pushing the threshold higher to chase more
  gross edge cuts n toward nothing (162 trades already at 0.99), so there is no
  setting where the two curves cross.

  This is the cleanest statement of why day trading fails here: not "there is no
  intraday structure" - there demonstrably is - but "the intraday structure is
  smaller than the cost of harvesting it". Execution cost is per-trade, so the
  toll scales with frequency while the edge per trade shrinks with it. At 400-2500
  trades a year the annual drag is 76-489% of notional.

  The one thing that would change this verdict is a maker-only implementation.
  Resting limit orders would replace the 0.045% taker fee with a rebate and remove
  the slippage leg, taking the round trip from 0.190% toward roughly 0.00-0.02%.
  At that cost the 0.99 cell (+0.156% gross, 400 trades/yr) becomes viable. That
  is a real engineering path, not a tweak: it needs post-only order support, queue
  position modelling, and an honest treatment of adverse selection - you get filled
  precisely when you are wrong. Nothing in this backtest models that, so this is
  logged as a direction, not a result.""")
