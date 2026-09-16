"""
Are there any good DAY TRADING strategies here? Tested on 1h bars.

The cost arithmetic sets the bar before any strategy is written, and it is
brutal. At the modelled 0.190% round trip:

    2 trades a day  =  730 a year  =  139% of notional a year in execution cost
    1 trade a day   =  365 a year  =   69%
    1 every 2 days  =  180 a year  =   34%

Even at the real measured 0.100%, two trades a day costs 73% of notional
annually. So an intraday strategy needs a GROSS edge per trade far larger than
a daily one - roughly 0.3% minimum just to clear friction, and much more to be
worth running. A 1-hour price move on BTC is often smaller than that in total.

The mechanism taxonomy gives a strong prior too, and it is not encouraging:
  * RELATIONAL is 0 for 4 here, and session/time-of-day was one of the four -
    all six 4h UTC slots negative. So "trade the London open" is already dead.
  * REVERSION needs a REAL anchor, not a computed one. Intraday VWAP or
    moving-average reversion has no forced anchor, so the prior is against it.
  * CONTINUATION works via forced flow - but that mechanism's dose-response
    INVERTED at 4h, so the cascade does not appear to operate intraday.

That leaves one genuinely untested idea with a real structural anchor, plus two
honest re-tests at 1h resolution:

  A. FUNDING SETTLEMENT. Hyperliquid charges funding every hour, on the hour.
     Holders who do not want to pay it have a reason to close just before, and
     a reason to re-enter just after. That is a real, recurring, mechanical flow
     with a precise time anchor - the kind of thing that can leave a footprint.
  B. INTRADAY BASIS at 1h. The one reversion mechanism that works, at the
     fastest resolution available.
  C. INTRADAY CASCADE at 1h. Does forced-flow continuation appear at 1h even
     though it vanished at 4h?

Data limit stated up front: Hyperliquid serves only ~208 days of 1h candles.
That is 5,000 bars per coin, which is plenty of observations for a strategy
trading several times a day, but it covers ONE market period. Nothing here can
be regime-tested, and that alone caps how much any result can be trusted.
"""
import sys, datetime, statistics as st
sys.path.insert(0, 'research')
import engine, hl_data

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
RT = 2 * (engine.TAKER_FEE + engine.SLIPPAGE)
_c = {}


def load(coin):
    if coin in _c:
        return _c[coin]
    bars, rep = hl_data.get_candles(coin, '1h', 420)
    fund = engine.FundingCurve(hl_data.get_funding(coin, 1250))
    _c[coin] = (bars, fund, rep)
    return _c[coin]


def run(fn, params, warm=200, coins=COINS):
    merged = engine.Result(coin='POOL', name='x')
    per = {}
    for c in coins:
        bars, fund, _ = load(c)
        r = engine.backtest(bars, fn(params)(), c, fund, name='x', warmup=warm)
        per[c] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


def row(label, fn, params, warm=200, coins=COINS):
    per, m = run(fn, params, warm, coins)
    if m.n < 30:
        print('  {:<40}{:>7}  too few trades'.format(label, m.n))
        return None
    gross = m.expectancy + RT
    tr = engine.Result(coin='T', name='t')
    te = engine.Result(coin='E', name='e')
    cut = m.start_t + (m.end_t - m.start_t) * 0.6
    for t in m.trades:
        (tr if t.entry_t < cut else te).trades.append(t)
    print('  {:<40}{:>7}{:>9}{:>9}{:>10}{:>10}{:>10}{:>9}{:>9}'.format(
        label, m.n, '{:.0f}'.format(m.trades_per_year()),
        '{:.0%}'.format(m.win_rate), '{:+.3f}%'.format(gross * 100),
        '{:+.3f}%'.format(m.expectancy * 100),
        '{:+.3f}%'.format(m.trimmed_expectancy(0.05) * 100),
        '{:+.3f}%'.format(te.expectancy * 100) if te.n else '-',
        '{:.0f}%'.format(RT * m.trades_per_year() * 100)))
    return m


HDR = '  {:<40}{:>7}{:>9}{:>9}{:>10}{:>10}{:>10}{:>9}{:>9}'.format(
    'variant', 'n', 'tr/yr', 'win', 'GROSS', 'net', 'trim5', 'test', 'cost/yr')

# --------------------------------------------------------------- A. funding settlement
def funding_clock(params):
    """Enter at a fixed hour-of-day, hold N hours. Funding settles hourly, but
    the largest positioning flows cluster at the day boundary, so this looks for
    a footprint around specific hours."""
    hour, hold, atr_mult = params['hour'], params['hold'], params['atr_mult']
    direction = params['dir']

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 24)
            atr = state['atr'][i]
            if atr is None or atr <= 0:
                return None
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            h = datetime.datetime.utcfromtimestamp(bars[i]['t'] / 1000).hour
            if h != hour:
                return None
            px = bars[i]['c']
            stop = px - atr_mult * atr if direction == 'long' else px + atr_mult * atr
            return {'dir': direction, 'stop': stop, 'target': None, 'reason': 'clock'}
        return sig
    return factory


# --------------------------------------------------------------- C. intraday cascade
def hourly_cascade(params):
    """Forced-flow continuation, native to 1h bars."""
    vol_n, vol_mult, hold = params['vol_n'], params['vol_mult'], params['hold']
    atr_mult, range_mult = params['atr_mult'], params.get('range_mult', 0.0)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 24)
                state['vma'] = engine.sma_series([b['v'] for b in bars], vol_n)
            atr = state['atr'][i]
            if atr is None or atr <= 0:
                return None
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            vma, b = state['vma'][i], bars[i]
            if not vma or vma <= 0 or b['v'] < vol_mult * vma:
                return None
            if range_mult and (b['h'] - b['l']) < range_mult * atr:
                return None
            want = 'long' if b['c'] > b['o'] else ('short' if b['c'] < b['o'] else None)
            if want is None:
                return None
            px = b['c']
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None, 'reason': '1h flow'}
        return sig
    return factory


b, _, rep = load('BTC')
print('=' * 128)
print('DATA: {} 1h bars per coin, {} to {} - ONE market period, no regime testing possible'.format(
    rep['n'],
    datetime.datetime.utcfromtimestamp(rep['first'] / 1000).strftime('%Y-%m-%d'),
    datetime.datetime.utcfromtimestamp(rep['last'] / 1000).strftime('%Y-%m-%d')))
print('=' * 128)

print('\nA. FUNDING-CLOCK / HOUR-OF-DAY  (does any hour leave a footprint?)')
print(HDR)
for h in (0, 4, 8, 12, 16, 20):
    row('long at {:02d}:00 UTC, hold 4h'.format(h), funding_clock,
        {'hour': h, 'hold': 4, 'atr_mult': 3.0, 'dir': 'long'})
for h in (0, 8, 16):
    row('SHORT at {:02d}:00 UTC, hold 4h'.format(h), funding_clock,
        {'hour': h, 'hold': 4, 'atr_mult': 3.0, 'dir': 'short'})

print('\nC. INTRADAY CASCADE at 1h  (does forced flow appear where it vanished at 4h?)')
print(HDR)
for vm in (2.0, 3.0, 4.0):
    for hold in (4, 8, 12):
        row('vol>={:.0f}x 48h avg, hold {}h'.format(vm, hold), hourly_cascade,
            {'vol_n': 48, 'vol_mult': vm, 'hold': hold, 'atr_mult': 3.0})

print('\n   dose-response check - does a range filter help, as it does on daily bars?')
print(HDR)
for rm in (0.0, 1.5, 2.5, 3.5):
    row('range >= {:.1f}x ATR(1h), hold 8h'.format(rm), hourly_cascade,
        {'vol_n': 48, 'vol_mult': 3.0, 'hold': 8, 'atr_mult': 3.0, 'range_mult': rm})

print("""
============================================================================================================
HOW TO READ THIS
  GROSS is the edge before execution cost. If GROSS itself is under about
  0.2%, no improvement in execution saves the strategy - there is nothing
  there to keep. 'cost/yr' is what the turnover costs annually at full
  notional, and for anything trading several times a day it dwarfs the edge.
  On daily bars the range filter produced a monotonic win-rate climb from 52%
  to 79%. If it does nothing at 1h, the cascade mechanism is not operating at
  this resolution - which would match the 4h result.""")
