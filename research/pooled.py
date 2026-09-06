"""
Two checks the per-coin reports cannot do on their own.

1. POOLED EVALUATION. A macro strategy takes 3-6 trades a year per coin. Judging
   a mechanism on 12 trades is judging noise. But the hypotheses here are claims
   about market STRUCTURE (under-reaction, liquidation clustering, funding as
   revealed preference), and a structural claim should hold on every liquid perp
   - so the statistically honest unit of evidence is the strategy applied across
   all coins with IDENTICAL parameters, pooling the trades. Per-coin numbers stay
   descriptive; the pooled number is what decides whether the mechanism is real.

2. OVERLAP / CORRELATION. Three "different" trend strategies that are long the
   same asset on the same days are one strategy wearing three hats. This measures
   how much of the time two strategies hold the same position, so a diversified
   set can be assembled honestly instead of assumed.
"""
import sys, datetime, statistics as st
sys.path.insert(0, 'research')
import engine, hl_data

FUNDING_START = int(datetime.datetime(2023, 6, 8).timestamp() * 1000)
_cache = {}


def load(coin, extended=False, interval='1d'):
    key = (coin, extended, interval)
    if key in _cache:
        return _cache[key]
    bars, _ = hl_data.get_candles(coin, interval, 2200 if interval == '1d' else 1250)
    ev = hl_data.get_funding(coin, 1250)
    if extended:
        fund = engine.FundingCurve(ev, backfill_to=bars[0]['t'])
    else:
        bars = [b for b in bars if b['t'] >= FUNDING_START]
        fund = engine.FundingCurve(ev)
    _cache[key] = (bars, fund)
    return bars, fund


def pooled(strategy_fn, params, coins, warmup, extended=False, interval='1d',
           name='pooled', per_coin_params=None, **kw):
    """Run identical params on every coin, return per-coin Results plus a merged one."""
    merged = engine.Result(coin='POOL', name=name)
    per = {}
    for c in coins:
        bars, fund = load(c, extended, interval)
        if len(bars) < warmup + 60:
            continue
        p = dict(params)
        if 'funding' in p:
            p['funding'] = fund
        r = engine.backtest(bars, strategy_fn(p)(), c, fund, name=name, warmup=warmup, **kw)
        per[c] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


def pooled_split(merged, frac=0.60):
    """Time-ordered train/test on the pooled trade list."""
    if merged.n < 4:
        return None, None
    cut_t = merged.start_t + (merged.end_t - merged.start_t) * frac
    tr = engine.Result(coin='POOL', name=merged.name + ' TRAIN',
                       start_t=merged.start_t, end_t=int(cut_t))
    te = engine.Result(coin='POOL', name=merged.name + ' TEST',
                       start_t=int(cut_t), end_t=merged.end_t)
    for t in merged.trades:
        (tr if t.entry_t < cut_t else te).trades.append(t)
    return tr, te


def pooled_yearly(merged):
    """Calendar-year buckets - the honest granularity when a strategy trades
    3-6 times a year per coin. Quarterly buckets of 1 trade say nothing."""
    buckets = {}
    for t in merged.trades:
        y = datetime.datetime.utcfromtimestamp(t.entry_t / 1000).year
        buckets.setdefault(y, []).append(t)
    out = []
    for y in sorted(buckets):
        r = engine.Result(coin='POOL', name=str(y))
        r.trades = buckets[y]
        r.start_t = min(t.entry_t for t in r.trades)
        r.end_t = max(t.exit_t for t in r.trades)
        out.append((y, r))
    return out


def position_series(bars, strategy_fn, params, coin, fund, warmup, **kw):
    """+1 / -1 / 0 per bar, reconstructed from the backtest's trades. Used for
    the overlap check - two strategies with the same series are one strategy."""
    p = dict(params)
    if 'funding' in p:
        p['funding'] = fund
    r = engine.backtest(bars, strategy_fn(p)(), coin, fund, name='x', warmup=warmup, **kw)
    series = [0] * len(bars)
    idx = {b['t']: i for i, b in enumerate(bars)}
    for t in r.trades:
        a, b = idx.get(t.entry_t), idx.get(t.exit_t)
        if a is None or b is None:
            continue
        for k in range(a, b):
            series[k] = 1 if t.direction == 'long' else -1
    return series, r


def overlap(s1, s2):
    """Fraction of bars where both are in the market AND on the same side."""
    both = [(a, b) for a, b in zip(s1, s2) if a != 0 and b != 0]
    if not both:
        return None, 0
    same = sum(1 for a, b in both if a == b)
    return same / len(both), len(both)


def describe(r, label=''):
    if r is None or r.n == 0:
        return '{:<22} NO TRADES'.format(label)
    return ('{:<22} n={:<4} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%} med={:>7.2%} '
            'acctCAGR={:>7.1%} acctDD={:>6.1%} hold={:>5.1f}d'.format(
                label, r.n, r.win_rate, r.expectancy, r.trimmed_expectancy(0.05),
                r.median_trade, r.account_cagr(0.20),
                r.account_equity(0.20)['max_dd'], r.avg_days_held))
