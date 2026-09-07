"""
Quicker trades, done the honest way: take the mechanism that is ALREADY fast.

Forcing the forced-flow strategies to a short horizon failed twice - truncated
and natively rebuilt - because a liquidation cascade unwinds over days. The
exit-design work put it plainly: the mechanism sets the hold, not preference.

But not every mechanism is slow. B1 trades the perp/spot BASIS, which is mean
reversion - a dislocation snaps back rather than developing. It is already the
quickest thing in the book at a 4.2 day average hold and 112 trades a year, and
its own hold sweep barely degraded when shortened (7 bars +1.39% trimmed, 2 bars
+1.14%, 1 bar +0.73%), which is what a front-loaded edge looks like.

So the question worth asking is not "can the slow strategies be made fast" but
"how fast can the fast one actually go". Built natively at 4h:

  * basis computed from 4h perp against 4h spot, both real series
  * percentile window in 4h bars (a "180 day" window becomes 1080 bars)
  * hold measured in 4h bars
  * ATR on 4h bars

Everything is re-derived for the timeframe rather than inherited, which is the
rule that came out of the last horizon test.

The cost arithmetic has to be respected: at a 6-bar hold there are ~2190 four
hour bars a year, so this could turn over 300+ times and the 0.190% round trip
becomes a 60%+ annual drag. A fast strategy must clear a much higher bar per
trade than a slow one.
"""
import sys, statistics as st
sys.path.insert(0, 'research')
import engine, hl_data, pooled

SPOT = {'BTC': '@142', 'ETH': '@151', 'SOL': '@156', 'HYPE': '@107'}
COINS = ['BTC', 'ETH', 'HYPE']         # B1 does not work on SOL
ALL = ['BTC', 'ETH', 'SOL', 'HYPE']
RT = 2 * (engine.TAKER_FEE + engine.SLIPPAGE)
SANITY = 0.02
_c = {}


def load(coin):
    if coin in _c:
        return _c[coin]
    perp, _ = hl_data.get_candles(coin, '4h', 700)
    spot, _ = hl_data.get_candles(SPOT[coin], '4h', 700)
    fund = engine.FundingCurve(hl_data.get_funding(coin, 1250))
    smap = {b['t']: b['c'] for b in spot if b['c'] > 0 and b['v'] > 0}
    basis = []
    for b in perp:
        s = smap.get(b['t'])
        if not s:
            basis.append(None)
            continue
        v = (b['c'] - s) / s
        basis.append(None if abs(v) > SANITY else v)
    _c[coin] = (perp, fund, basis)
    return _c[coin]


def fast_basis(params):
    pct, win, hold = params['pct'], params['win'], params['max_hold']
    atr_mult, min_hist = params['atr_mult'], params['min_hist']
    basis = params['basis']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
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
                    return {'exit': True, 'reason': 'basis normalised'}
                if pos['dir'] == 'long' and b >= med:
                    return {'exit': True, 'reason': 'basis normalised'}
                return None

            px = bars[i]['c']
            if b >= hi:
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'perp rich {:+.3f}%'.format(b * 100)}
            if b <= lo:
                return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                        'reason': 'perp cheap {:+.3f}%'.format(b * 100)}
            return None
        return sig
    return factory


def run(params, coins=COINS):
    merged = engine.Result(coin='POOL', name='fastB1')
    per = {}
    for c in coins:
        perp, fund, basis = load(c)
        p = dict(params)
        p['basis'] = basis
        first = next((k for k, v in enumerate(basis) if v is not None), 0)
        warm = first + p['min_hist']
        if len(perp) < warm + 100:
            continue
        r = engine.backtest(perp, fast_basis(p)(), c, fund, name='fb', warmup=warm)
        per[c] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


def row(label, params, coins=COINS):
    per, m = run(params, coins)
    if m.n < 15:
        print('  {:<34}{:>6}  too few trades'.format(label, m.n))
        return None
    tr, te = pooled.pooled_split(m)
    yr = pooled.pooled_yearly(m)
    pos = sum(1 for _, r in yr if r.expectancy > 0)
    print('  {:<34}{:>6}{:>9}{:>9}{:>10}{:>10}{:>9}{:>9}{:>7}{:>9}{:>9}'.format(
        label, m.n, '{:.0f}'.format(m.trades_per_year()), '{:.0%}'.format(m.win_rate),
        '{:+.2f}%'.format(m.expectancy + RT and (m.expectancy + RT) * 100),
        '{:+.2f}%'.format(m.expectancy * 100),
        '{:+.2f}%'.format(m.trimmed_expectancy(0.05) * 100),
        '{:.1f}d'.format(m.avg_days_held),
        '{}/{}'.format(pos, len(yr)),
        '{:+.2f}%'.format(te.expectancy * 100) if te else '-',
        '{:.0f}%'.format(RT * m.trades_per_year() * 100)))
    return m


HDR = '  {:<34}{:>6}{:>9}{:>9}{:>10}{:>10}{:>9}{:>9}{:>7}{:>9}{:>9}'.format(
    'variant', 'n', 'tr/yr', 'win', 'GROSS', 'net', 'trim5', 'hold', 'yrs', 'test', 'cost/yr')

BASE = {'pct': 0.90, 'win': 1080, 'atr_mult': 2.5, 'max_hold': 42, 'min_hist': 360}

print('=' * 132)
print('B1 BASIS, NATIVE 4h - how fast can the fast mechanism actually go?')
print('  (shipped daily version for reference: n=178, net +1.68%, trim5 +1.39%, 4.2d hold)')
print('=' * 132)
print(HDR)
for h, lab in ((3, '12h'), (6, '24h'), (9, '36h'), (12, '48h'), (18, '72h'),
               (24, '96h'), (42, '7d = shipped equivalent')):
    row('hold {} bars = {}'.format(h, lab), dict(BASE, max_hold=h))

print('\n' + '=' * 132)
print('PERCENTILE THRESHOLD at a fast 24h hold')
print('=' * 132)
print(HDR)
for p in (0.85, 0.90, 0.95, 0.975):
    row('pct {:.3f}, hold 24h'.format(p), dict(BASE, pct=p, max_hold=6))

print('\n' + '=' * 132)
print('LOOKBACK WINDOW (4h bars) at a fast 24h hold')
print('=' * 132)
print(HDR)
for w, lab in ((360, '60d'), (720, '120d'), (1080, '180d'), (1620, '270d')):
    row('window {} bars = {}'.format(w, lab),
        dict(BASE, win=w, min_hist=min(360, w // 3), max_hold=6))

print('\n' + '=' * 132)
print('PER COIN at the best fast setting, and does SOL still fail?')
print('=' * 132)
per, m = run(dict(BASE, max_hold=6), ALL)
for c in ALL:
    if c in per and per[c].n:
        print('  ' + pooled.describe(per[c], c))
print("""
  SOL was excluded from the daily version because it does not work there. If it
  still fails at 4h that is consistent evidence about the coin rather than the
  timeframe - and if it now works, the daily exclusion deserves re-examining.""")
