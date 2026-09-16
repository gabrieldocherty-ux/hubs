"""
OPEN-INTEREST DIVERGENCE - is the same price move two different events?

THE HYPOTHESIS

A price move carries no information about who made it. Open interest does. If
BTC rises 4% and open interest rises with it, new leveraged longs opened
positions into the move: the move is CROWDED, and every one of those longs is
now a forced seller if price turns, because a perp position with a liquidation
price is not a discretionary holding. If BTC rises 4% and open interest FALLS,
the buyers were shorts closing - the move consumed positioning rather than
building it, so there is no fuel left and no forced flow to come. Same candle,
opposite structural meaning. Symmetrically, price down with OI up is shorts
piling in (squeeze fuel), and price down with OI down is longs being
liquidated out (capitulation, the fuel already burnt).

This is the classic positioning read and it has a real mechanism behind it -
the same mechanism this project already found working in S3/D1, forced
liquidation flow. What OI would add is the ability to see the SIZE of the
forced-seller base BEFORE the move rather than inferring it from volume after.

THE HARD CONSTRAINT

Hyperliquid serves no historical open interest. None. The /info endpoint gives
a live snapshot only, so the only OI history that will ever exist for this
project is what it forward-collects itself. That collection started recently
(this script reports exactly how much it holds) and is nowhere near a
backtestable sample. Faking OI - reconstructing it from volume, or assuming
volume is a proxy for it - would produce a number that looks like evidence and
is not, which is the exact failure mode this project exists to avoid.

SO WHAT IS ACTUALLY TESTED HERE

Part 1 audits the collected OI file and says how short it is.

Part 2 tests the best PROXY that real data supports. From OHLCV alone the SIGN
of an OI change is unrecoverable - volume tells you how much traded, never
whether positions were opened or closed. The only sign-carrying positioning
series Hyperliquid actually publishes historically is the FUNDING RATE, which
on this venue is driven by the perp premium, which is driven by the long/short
aggression imbalance. Its LEVEL is a stock-like measure of who is crowded
(already tested and rejected here three times - funding crowding, funding
percentile, funding carry spread). Its TIME DERIVATIVE is the flow-like
measure, and that is the thing that stands in for dOI: funding rising means
long pressure is being ADDED, funding falling means it is being withdrawn.

That proxy is weak and this script measures HOW weak before trusting it -
because Hyperliquid clamps funding and pins it at a base interest rate
whenever the premium is small, which would leave the derivative flat and
informationless a large fraction of the time. If the proxy is dead the honest
answer is that the quadrant test is not available, not that the quadrants do
not work.

Part 3 runs the four price/positioning quadrants as a conditional forward-
return panel, then a dose-response on the magnitude of the positioning change,
then - on the one pre-committed reading, not the one that happens to look best
- a real backtest through the full gate.

Part 4 writes the specification for the real test once 6+ months of OI exist.

PRIOR AGAINST IT, STATED UP FRONT: the funding LEVEL has failed here three
times, and the four RELATIONAL strategies tested here have all failed. A
derivative of a failed signal starts behind, and needs to clear the bar
convincingly rather than narrowly.
"""
import sys, os, json, math, datetime, statistics as st

sys.path.insert(0, 'research')
import engine, pooled, hl_data
from strategies_daily import range_breakout
from strategies_batch2 import volume_spike
from strategies_macro import donchian_turtle
import run_basis

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
OI_PATH = os.path.join('data', 'oi_history.jsonl')

# Hyperliquid's funding = premium component + a fixed interest-rate component of
# 0.01% per 8h = 1.25e-5 per hour. When the premium is ~0 the published rate
# sits exactly on that floor. This constant is what "pinned" means below.
HL_BASE_RATE = 1.25e-5

VARIANTS = []          # every configuration evaluated, counted honestly


def bump(tag):
    VARIANTS.append(tag)


def hr(title):
    print()
    print('=' * 100)
    print(title)
    print('=' * 100)


# ===================================================================== PART 1
def part1_oi_inventory():
    """What the forward-collector actually holds. No estimates, no rounding up."""
    hr('PART 1  -  COLLECTED OPEN-INTEREST INVENTORY')
    if not os.path.exists(OI_PATH):
        print('  {} does not exist. Nothing has been collected.'.format(OI_PATH))
        return None
    rows = []
    bad = 0
    with open(OI_PATH) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except Exception:
                bad += 1
    print('  file                {}'.format(OI_PATH))
    print('  rows                {}   (unparseable lines: {})'.format(len(rows), bad))
    if not rows:
        return None
    ts = sorted(set(r['t'] for r in rows))
    span_ms = ts[-1] - ts[0]
    span_h = span_ms / 3_600_000.0
    print('  distinct snapshots  {}'.format(len(ts)))
    print('  first               {}'.format(datetime.datetime.utcfromtimestamp(ts[0] / 1000)))
    print('  last                {}'.format(datetime.datetime.utcfromtimestamp(ts[-1] / 1000)))
    print('  span                {:.1f} hours  =  {:.2f} days'.format(span_h, span_h / 24))
    gaps = [(ts[i + 1] - ts[i]) / 60000.0 for i in range(len(ts) - 1)]
    if gaps:
        print('  snapshot cadence    median {:.0f} min, max gap {:.0f} min'.format(
            st.median(gaps), max(gaps)))
    per = {}
    for r in rows:
        per.setdefault(r['coin'], []).append(r)
    print('  coins               ' + ', '.join(
        '{}(n={})'.format(c, len(v)) for c, v in sorted(per.items())))
    fields = sorted(rows[0].keys())
    print('  fields per row      ' + ', '.join(fields))

    need_days = 183.0
    have_days = span_h / 24
    print()
    print('  VERDICT: a backtest of an OI-conditioned daily strategy needs at minimum')
    print('  ~6 months (183 days) to produce even an indicative pooled n, and this file holds')
    print('  {:.2f} days - {:.2f}% of that. It contains {:.0f} complete DAILY bars.'.format(
        have_days, 100 * have_days / need_days, math.floor(have_days)))
    print('  The real test is NOT RUNNABLE. Part 4 specifies it for when it is.')
    return per


def part1b_proxy_vs_real_oi(per):
    """The one direct measurement of proxy validity that exists today.

    n is tiny and this is reported as indicative-only. It is still worth doing:
    if d(funding) does not move with d(OI) even in-sample on the data we have,
    the proxy is dead on arrival and Part 3 is measuring something else."""
    hr('PART 1b  -  DOES THE FUNDING DERIVATIVE ACTUALLY TRACK REAL dOI?  (indicative only)')
    if not per:
        print('  no OI rows - skipped')
        return
    print('  Pearson r between consecutive-snapshot d(log OI) and d(funding), per coin.')
    print('  Also vs d(premium), since HL funding is a clamped function of premium.\n')
    print('  {:<6} {:>5}  {:>14} {:>14} {:>14}'.format(
        'coin', 'n', 'r(dOI,dFund)', 'r(dOI,dPrem)', 'r(dOI,ret)'))
    for coin in sorted(per):
        rows = sorted(per[coin], key=lambda r: r['t'])
        doi, dfu, dpr, ret = [], [], [], []
        for a, b in zip(rows, rows[1:]):
            # oi_BASE, deliberately. oi_usd = oi_base * mark, so d(log oi_usd)
            # contains d(log price) by construction and would manufacture the
            # very correlation being tested. This is the trap the Part 4 spec
            # warns about and it is easy to fall into.
            if a.get('oi_base', 0) <= 0 or b.get('oi_base', 0) <= 0:
                continue
            doi.append(math.log(b['oi_base'] / a['oi_base']))
            dfu.append(b.get('funding', 0) - a.get('funding', 0))
            dpr.append(b.get('premium', 0) - a.get('premium', 0))
            ret.append((b['mark'] - a['mark']) / a['mark'])

        def corr(x, y):
            if len(x) < 3:
                return None
            mx, my = sum(x) / len(x), sum(y) / len(y)
            num = sum((a - mx) * (b - my) for a, b in zip(x, y))
            dx = math.sqrt(sum((a - mx) ** 2 for a in x))
            dy = math.sqrt(sum((b - my) ** 2 for b in y))
            return None if dx == 0 or dy == 0 else num / (dx * dy)

        def f(v):
            return '  n/a' if v is None else '{:+.2f}'.format(v)
        print('  {:<6} {:>5}  {:>14} {:>14} {:>14}'.format(
            coin, len(doi), f(corr(doi, dfu)), f(corr(doi, dpr)), f(corr(doi, ret))))
    print()
    print('  Read this with suspicion: n per coin is ~2 dozen intra-day observations inside')
    print('  ONE day of tape. It cannot establish the proxy and is not being used to.')


# ===================================================================== PART 2
def part2_proxy_health():
    """Is the funding derivative even a live signal, or is it pinned flat?"""
    hr('PART 2  -  PROXY HEALTH: IS d(FUNDING) INFORMATIVE AT ALL?')
    print('  HL funding = clamped premium term + fixed 1.25e-5/hr interest term.')
    print('  Whenever the premium is small the published rate sits exactly on that base,')
    print('  so the derivative is exactly zero and carries no positioning information.')
    print('  Measuring how often that happens bounds how much the whole idea can work.\n')
    print('  {:<6} {:>8} {:>12} {:>12} {:>14} {:>12}'.format(
        'coin', 'events', 'pinned@base', 'exact zero', 'median |rate|', 'days'))
    for coin in COINS:
        ev = hl_data.get_funding(coin, 1250)
        if not ev:
            print('  {:<6} no funding history'.format(coin))
            continue
        rates = [e['rate'] for e in ev]
        pinned = sum(1 for r in rates if abs(r - HL_BASE_RATE) < 1e-9)
        zeros = sum(1 for r in rates if r == 0.0)
        days = (ev[-1]['t'] - ev[0]['t']) / 86_400_000
        print('  {:<6} {:>8} {:>11.1f}% {:>11.1f}% {:>14.2e} {:>12.0f}'.format(
            coin, len(rates), 100 * pinned / len(rates), 100 * zeros / len(rates),
            st.median(abs(r) for r in rates), days))
    print()
    print('  A high pinned% means the proxy is flat much of the time. It does not kill the')
    print('  test outright - a daily-aggregated derivative still moves when the premium moves -')
    print('  but it caps the signal-to-noise, and the quadrant frequency table below shows')
    print('  whether the two divergence quadrants are populated enough to mean anything.')


# ============================================================ shared series
_series = {}


def load_series(coin):
    """Per-bar price return and the causal funding-derivative proxy.

    fund_ann[i] is the trailing-24h average funding at bar i's CLOSE, so
    df[i] = fund_ann[i] - fund_ann[i-1] uses nothing after bar i. The engine
    fills at bar i+1's open, so there is no lookahead anywhere."""
    if coin in _series:
        return _series[coin]
    bars, fund = pooled.load(coin)                       # trimmed to real-funding era
    fa = engine.funding_annualized_series(bars, fund, lookback_hours=24)
    n = len(bars)
    ret = [None] * n
    for i in range(1, n):
        ret[i] = (bars[i]['c'] - bars[i - 1]['c']) / bars[i - 1]['c']
    df = [None] * n
    for i in range(1, n):
        if fa[i] is not None and fa[i - 1] is not None:
            df[i] = fa[i] - fa[i - 1]
    # trailing realised vol, used only to define "a material move" - not tuned
    vol = engine.logret_vol_series([b['c'] for b in bars], 20)
    _series[coin] = (bars, fund, ret, df, fa, vol)
    return _series[coin]


# ===================================================================== PART 3
def part3_quadrant_panel(move_mult, hold):
    """Conditional forward-return panel. Descriptive, not a strategy hunt:
    every quadrant is reported whether it helps or not."""
    q = {'UU': [], 'UD': [], 'DD': [], 'DU': []}
    for coin in COINS:
        bars, fund, ret, df, fa, vol = load_series(coin)
        for i in range(25, len(bars) - hold - 1):
            if ret[i] is None or df[i] is None or vol[i] is None or vol[i] <= 0:
                continue
            if df[i] == 0:                       # pinned funding: no positioning read
                continue
            if abs(ret[i]) < move_mult * vol[i]:
                continue
            fwd = (bars[i + hold]['c'] - bars[i]['c']) / bars[i]['c']
            key = ('U' if ret[i] > 0 else 'D') + ('U' if df[i] > 0 else 'D')
            q[key].append(fwd)
    return q


def show_panel(q, label):
    names = {'UU': 'price UP  + long-pressure UP    (crowded long / new longs)',
             'UD': 'price UP  + long-pressure DOWN  (short covering / exhaustion)',
             'DD': 'price DOWN+ long-pressure DOWN  (crowded short / new shorts)',
             'DU': 'price DOWN+ long-pressure UP    (longs adding into weakness)'}
    total = sum(len(v) for v in q.values())
    print('  {}   (n={} signal days)'.format(label, total))
    print('  {:<52} {:>6} {:>7} {:>10} {:>10} {:>8}'.format(
        'quadrant', 'n', 'share', 'mean fwd', 'trimmed', 'win%'))
    for k in ('UU', 'UD', 'DD', 'DU'):
        v = q[k]
        if not v:
            print('  {:<52} {:>6}'.format(names[k], 0))
            continue
        s = sorted(v)
        cut = max(1, int(len(s) * 0.05))
        trim = s[cut:-cut] if len(s) > 2 * cut else s
        print('  {:<52} {:>6} {:>6.1f}% {:>+9.2f}% {:>+9.2f}% {:>7.1f}%'.format(
            names[k], len(v), 100 * len(v) / max(1, total),
            100 * sum(v) / len(v), 100 * sum(trim) / len(trim),
            100 * sum(1 for x in v if x > 0) / len(v)))
    print('  (mean fwd is the return to a LONG held {} days. A tradable fade of a quadrant'.format(
        HOLD))
    print('   earns MINUS that number, minus 0.190% round-trip cost.)')


def divergence_spread(q, label, iters=20000, seed=7):
    """THE ACTUAL HYPOTHESIS, isolated.

    Every quadrant mean above is contaminated by the same thing: crypto drifted
    up over this sample, so all four are positive and reading their LEVELS says
    nothing. The hypothesis is not "crowded moves are bad", it is "crowded and
    exhausting moves mean DIFFERENT things" - which is a DIFFERENCE between two
    quadrants that share the same price direction and therefore share the drift.

      up-day spread   = UU - UD   (new longs minus short-covering)
      down-day spread = DD - DU   (new shorts minus long-liquidation)

    Hypothesis predicts up-spread < 0 (crowded up-moves underperform exhausting
    ones) and down-spread > 0 (crowded down-moves outperform, i.e. fall less,
    than capitulation ones... and note that even stating the sign convention
    takes care, which is a warning sign about how easy it is to read whatever
    you want into a positioning table).

    p is a two-sided label-permutation test: shuffle which quadrant each
    observation belongs to within the same price direction and count how often
    a spread this large appears by chance. Overlapping holds make observations
    non-independent, so the true p is WORSE than the printed one - the printed
    number is a floor, not an estimate."""
    import random
    rnd = random.Random(seed)
    print('  DIVERGENCE SPREAD ({}) - the drift-controlled version of the table above'.format(label))
    print('  {:<34} {:>8} {:>8} {:>11} {:>9} {:>9}'.format(
        'contrast', 'n_a', 'n_b', 'spread', 'perm p', 'predicted'))
    for a, b, pred in (('UU', 'UD', 'negative'), ('DD', 'DU', 'positive')):
        va, vb = q[a], q[b]
        if len(va) < 10 or len(vb) < 10:
            print('  {:<34} too few'.format(a + ' - ' + b))
            continue
        obs = sum(va) / len(va) - sum(vb) / len(vb)
        pool = va + vb
        na = len(va)
        hits = 0
        for _ in range(iters):
            rnd.shuffle(pool)
            d = sum(pool[:na]) / na - sum(pool[na:]) / (len(pool) - na)
            if abs(d) >= abs(obs):
                hits += 1
        print('  {:<34} {:>8} {:>8} {:>+10.2f}% {:>9.3f} {:>9}'.format(
            a + ' - ' + b, len(va), len(vb), 100 * obs, hits / iters, pred))


def part3_dose_response(hold, move_mult):
    """The single best mechanism evidence available: if crowding is what makes a
    move fragile, then MORE crowding must make it MORE fragile. Bucket the
    same-sign quadrants by how hard the positioning moved and look for
    monotonicity. A flat or inverted ladder means the mechanism is absent."""
    rows = []
    for coin in COINS:
        bars, fund, ret, df, fa, vol = load_series(coin)
        for i in range(25, len(bars) - hold - 1):
            if None in (ret[i], df[i], vol[i]) or vol[i] <= 0 or df[i] == 0:
                continue
            if abs(ret[i]) < move_mult * vol[i]:
                continue
            same = (ret[i] > 0) == (df[i] > 0)
            if not same:
                continue
            fwd = (bars[i + hold]['c'] - bars[i]['c']) / bars[i]['c']
            # signed so that POSITIVE = the crowded-fade worked
            rows.append((abs(df[i]), -fwd if ret[i] > 0 else fwd))
    rows.sort()
    if len(rows) < 40:
        return None
    out = []
    k = 4
    step = len(rows) // k
    for b in range(k):
        lo = b * step
        hi = (b + 1) * step if b < k - 1 else len(rows)
        chunk = [r[1] for r in rows[lo:hi]]
        out.append((b + 1, len(chunk), sum(chunk) / len(chunk),
                    rows[lo][0], rows[hi - 1][0]))
    return out


# ==================================================== the pre-committed strategy
def crowded_fade(params):
    """
    PRE-COMMITTED READING, chosen from the hypothesis and NOT from the panel.

    The mechanism that has actually worked in this project is forced flow: find
    people who must trade and stand where they have to trade to. The positioning
    read names them directly - a move that BUILT positioning has created a
    cohort of leveraged holders with liquidation prices just behind the move.
    So: on a material move whose funding derivative points the SAME way (new
    money pressing in), take the other side, because that cohort is the forced
    flow when it turns.

    `invert` runs the exact opposite (continue the crowded move) as the honest
    symmetric check - if both signs "work" on different slices, neither does.
    """
    df, vol = params['df'], params['vol']
    move_mult, hold, atr_mult = params['move_mult'], params['hold'], params['atr_mult']
    invert = params.get('invert', False)
    min_df = params.get('min_df', 0.0)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
            atr = state['atr'][i]
            if pos is not None:
                if i - pos['entry_i'] >= hold:
                    return {'exit': True, 'reason': 'timeout'}
                return None
            if atr is None or atr <= 0 or i < 1 or i >= len(df):
                return None
            d, v = df[i], vol[i]
            if d is None or v is None or v <= 0 or d == 0:
                return None
            if abs(d) < min_df:
                return None
            r = (bars[i]['c'] - bars[i - 1]['c']) / bars[i - 1]['c']
            if abs(r) < move_mult * v:
                return None
            if (r > 0) != (d > 0):          # divergent quadrant - not this trade
                return None
            px = bars[i]['c']
            fade_short = (r > 0) != invert
            if fade_short:
                return {'dir': 'short', 'stop': px + atr_mult * atr, 'target': None,
                        'reason': 'crowded up-move, funding accel {:+.2f}'.format(d)}
            return {'dir': 'long', 'stop': px - atr_mult * atr, 'target': None,
                    'reason': 'crowded down-move, funding accel {:+.2f}'.format(d)}
        return sig
    return factory


def run_pooled(params, name, **kw):
    merged = engine.Result(coin='POOL', name=name)
    per = {}
    for coin in COINS:
        bars, fund, ret, df, fa, vol = load_series(coin)
        p = dict(params)
        p['df'], p['vol'] = df, vol
        warm = 40
        if len(bars) < warm + 60:
            continue
        r = engine.backtest(bars, crowded_fade(p)(), coin, fund, name=name,
                            warmup=warm, **kw)
        per[coin] = r
        merged.trades.extend(r.trades)
        merged.start_t = min(merged.start_t or r.start_t, r.start_t) if r.start_t else merged.start_t
        merged.end_t = max(merged.end_t, r.end_t)
    merged.trades.sort(key=lambda t: t.entry_t)
    return per, merged


def series_from_result(bars, r):
    series = [0] * len(bars)
    idx = {b['t']: i for i, b in enumerate(bars)}
    for t in r.trades:
        a, b = idx.get(t.entry_t), idx.get(t.exit_t)
        if a is None or b is None:
            continue
        for k in range(a, b):
            series[k] = 1 if t.direction == 'long' else -1
    return series


# ===================================================================== main
MOVE_MULT = 1.0        # "material move" = 1 trailing sigma. Not swept for profit.
HOLD = 10              # matches S3's validated 10-day forced-flow horizon
ATR_MULT = 2.5         # the stop this project already uses everywhere


def main():
    per_oi = part1_oi_inventory()
    part1b_proxy_vs_real_oi(per_oi)
    part2_proxy_health()

    hr('PART 3a  -  QUADRANT FREQUENCY AND CONDITIONAL FORWARD RETURN')
    print('  Pooled BTC/ETH/SOL/HYPE, daily bars, real-funding era only.')
    print('  Signal day = |return| >= {:.1f}x trailing 20d sigma AND funding derivative non-zero.'.format(
        MOVE_MULT))
    print()
    for hold in (5, HOLD):
        bump('panel hold={}'.format(hold))
        q = part3_quadrant_panel(MOVE_MULT, hold)
        globals()['HOLD'] = hold
        show_panel(q, 'forward hold = {} days'.format(hold))
        print()
        bump('divergence spread + permutation, hold={}'.format(hold))
        divergence_spread(q, 'hold {}d'.format(hold))
        print()
    globals()['HOLD'] = 10

    hr('PART 3b  -  DOSE-RESPONSE ON POSITIONING MAGNITUDE')
    print('  Within the CROWDED quadrants only (price and funding moving together),')
    print('  bucketed by |d funding| quartile. Value shown is the return to FADING the move.')
    print('  If crowding causes fragility this ladder rises. Flat = no mechanism.\n')
    for hold in (5, 10):
        bump('dose hold={}'.format(hold))
        dr = part3_dose_response(hold, MOVE_MULT)
        if dr is None:
            print('  hold={}: too few observations'.format(hold))
            continue
        print('  hold={} days'.format(hold))
        print('    {:>8} {:>6} {:>14} {:>26}'.format('quartile', 'n', 'fade return', '|d funding| range'))
        for b, n, m, lo, hi in dr:
            print('    {:>8} {:>6} {:>13.2f}% {:>26}'.format(
                b, n, 100 * m, '{:.3f} .. {:.3f}'.format(lo, hi)))
        print()

    hr('PART 3c  -  THE PRE-COMMITTED STRATEGY THROUGH THE FULL GATE')
    base = {'move_mult': MOVE_MULT, 'hold': 10, 'atr_mult': ATR_MULT, 'invert': False}
    bump('crowded_fade base')
    per, m = run_pooled(base, 'OI-DIV fade')
    print('  ' + pooled.describe(m, 'POOLED fade'))
    if m.n:
        print('    trimmed(5%) {:+.2f}%   ex-best-3 {:+.2f}%   trades/yr {:.1f}   avg hold {:.1f}d'.format(
            100 * m.trimmed_expectancy(0.05), 100 * m.expectancy_ex_best(3),
            m.trades_per_year(), m.avg_days_held))
        tr, te = pooled.pooled_split(m)
        print('  ' + pooled.describe(tr, '  train(60%)'))
        print('  ' + pooled.describe(te, '  test(40%)'))
        yr = pooled.pooled_yearly(m)
        print('  by year: {}/{} positive   '.format(
            sum(1 for _, r in yr if r.expectancy > 0), len(yr)) +
            '  '.join('{}:{:+.2f}%(n{})'.format(y, r.expectancy * 100, r.n) for y, r in yr))
        for c in COINS:
            if c in per and per[c].n:
                print('  ' + pooled.describe(per[c], c))

    print()
    bump('crowded_fade inverted')
    peri, mi = run_pooled(dict(base, invert=True), 'OI-DIV continue')
    print('  ' + pooled.describe(mi, 'POOLED continue (inverted)'))
    if mi.n:
        print('    trimmed(5%) {:+.2f}%'.format(100 * mi.trimmed_expectancy(0.05)))
    print('  Note: fade and continue are mirror trades on the same days, so their')
    print('  expectancies differ by 2x the cost. Whichever is positive, the question is')
    print('  whether it clears the bar - and whether the dose-response above backs it.')

    hr('PART 3d  -  PARAMETER NEIGHBOURHOOD, COST STRESS, OVERLAP')
    print('  Neighbourhood (a single-cell edge is a curve fit, not a strategy):')
    print('    {:<28} {:>5} {:>9} {:>9} {:>8}'.format('variant', 'n', 'exp', 'trimmed', 'win%'))
    for key, vals in (('move_mult', [0.5, 1.5, 2.0]),
                      ('hold', [3, 5, 20]),
                      ('atr_mult', [1.5, 4.0])):
        for v in vals:
            p = dict(base)
            p[key] = v
            bump('nbhd {}={}'.format(key, v))
            _, r = run_pooled(p, 'x')
            if r.n == 0:
                print('    {:<28} {:>5}'.format('{}={}'.format(key, v), 0))
                continue
            print('    {:<28} {:>5} {:>+8.2f}% {:>+8.2f}% {:>7.1f}%'.format(
                '{}={}'.format(key, v), r.n, 100 * r.expectancy,
                100 * r.trimmed_expectancy(0.05), 100 * r.win_rate))

    print()
    print('  Cost stress (modelled cost is already ~2x the measured 0.100% round trip):')
    for mult, lab in ((1, '1x  (0.190%)'), (2, '2x  (0.380%)'), (4, '4x  (0.760%)')):
        bump('cost {}x'.format(mult))
        _, r = run_pooled(base, 'x', slippage=engine.SLIPPAGE * mult,
                          fee=engine.TAKER_FEE * mult)
        if r.n:
            print('    {:<14} n={:<5} exp {:+.2f}%   trimmed {:+.2f}%'.format(
                lab, r.n, 100 * r.expectancy, 100 * r.trimmed_expectancy(0.05)))
    if m.n:
        drag = m.trades_per_year() * 0.190
        print('    annual cost drag = {:.1f} trades/yr x 0.190% = {:.1f}% of notional per year'.format(
            m.trades_per_year(), drag))

    print()
    print('  Overlap with what is already running (>0.60 = the same bet).')
    print('  B1 is measured here, not assumed: run_basis.run() is imported and its actual')
    print('  trade series compared, because "near-mechanical transform" is a hypothesis too.')
    bump('B1 overlap measurement (run_basis BASE)')
    per_b1, _ = run_basis.run(run_basis.BASE)
    print('    {:<8} {:>8} {:>8} {:>8} {:>8}   {:>8} {:>8} {:>8} {:>8}'.format(
        'coin', 'S3', 'D1', 'M3', 'B1', 'S3(inv)', 'D1(inv)', 'M3(inv)', 'B1(inv)'))
    for coin in COINS:
        bars, fund, ret, df, fa, vol = load_series(coin)
        if coin not in per or per[coin].n == 0:
            continue
        mine = series_from_result(bars, per[coin])
        # the CONTINUE variant's own positions, not a sign flip of them: the two
        # variants do not trade identical days (stops fire differently), so the
        # honest comparison is against what each one actually held.
        mine_inv = series_from_result(bars, peri[coin]) if (
            coin in peri and peri[coin].n) else None
        cells, cells_inv = [], []
        for fn, prm, warm in ((volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}, 60),
                              (range_breakout, {'n': 20, 'atr_mult': 2.5, 'max_hold': 10,
                                                'atr_ratio': 2.0}, 60),
                              (donchian_turtle, {'entry_n': 55, 'exit_n': 20,
                                                 'atr_mult': 3.0}, 85)):
            s, _ = pooled.position_series(bars, fn, prm, coin, fund, warm)
            for src, dst in ((mine, cells), (mine_inv, cells_inv)):
                if src is None:
                    dst.append('-')
                    continue
                ov, _n = pooled.overlap(src, s)
                dst.append('-' if ov is None else '{:.2f}'.format(ov))
        # B1: same bars object (run_basis.load goes through pooled.load, cached)
        if coin in per_b1 and per_b1[coin].n:
            sb = series_from_result(bars, per_b1[coin])
            for src, dst in ((mine, cells), (mine_inv, cells_inv)):
                if src is None:
                    dst.append('-')
                    continue
                ov, _n = pooled.overlap(src, sb)
                dst.append('-' if ov is None else '{:.2f}'.format(ov))
        else:
            cells.append('-')
            cells_inv.append('-')
        print('    {:<8} {:>8} {:>8} {:>8} {:>8}   {:>8} {:>8} {:>8} {:>8}'.format(
            coin, *(cells + cells_inv)))
    print('    (inv) = the CONTINUE variant, which is the only signed direction with a')
    print('    positive mean. Read its row first: if it is the same bet as S3/D1 then the')
    print('    positioning read has discovered forced-flow continuation a second time,')
    print('    worse executed, and adds nothing.')

    hr('PART 4  -  SPECIFICATION FOR THE REAL TEST, ONCE 6+ MONTHS OF OI EXIST')
    print("""
  WHEN TO RUN IT
    When data/oi_history.jsonl covers >= 183 continuous days with <5% missing
    hours. At the current 4-coin hourly cadence that is ~17,500 rows. Re-run
    Part 1 of this file; it prints the exact day count.

  FIELDS REQUIRED PER SNAPSHOT (all already being written - do not drop any)
    t          ms epoch, the snapshot instant
    coin
    oi_base    open interest in COIN units. This is the primary series. Use
               base units, not USD - oi_usd moves when price moves even if not
               one contract changed hands, which would manufacture correlation
               between price and "OI" and produce a fake result.
    mark       needed to reconstruct oi_usd and to sanity-check against candles
    funding    to measure how much of dOI the proxy in this file recovered
    premium    same
    day_ntl_vlm  to separate churn from position building

    MISSING AND WORTH ADDING NOW so the history exists later:
      - a monotonic collector sequence number, to distinguish "no change" from
        "collector was down"; gaps are currently only inferable from t
      - the venue-wide total OI, so a coin's OI change can be read relative to
        the whole book rather than absolutely

  CONSTRUCTION
    1. Resample to daily by taking the LAST snapshot at or before 00:00 UTC, to
       align exactly with the 1d candle close the engine uses. Do not average.
    2. doi[i] = log(oi_base[i] / oi_base[i-1]).  Log, because OI grows.
    3. Normalise: z = doi[i] / stdev(doi[i-60 : i]). Raw dOI is not comparable
       across coins or across a year of OI growth.
    4. Quadrant at bar i = sign(return[i]) x sign(z[i]), with a materiality
       filter of |return| >= 1 trailing sigma on BOTH, so the divergence
       quadrants are real divergences and not rounding.
    5. Causality: z[i] uses only snapshots at or before bar i's close; the
       engine fills at bar i+1 open. No exception for any reason.

  THE TESTS, IN ORDER, ALL PRE-COMMITTED
    A. Frequency table of the four quadrants. If either divergence quadrant is
       under ~10% of days it is untestable and stop there.
    B. Conditional forward return per quadrant at 5 and 10 day holds, mean AND
       5% trimmed. This is the whole hypothesis in one table.
    C. DOSE-RESPONSE on |z|, quartiles, within each quadrant. This is decisive.
       No monotone ladder, no mechanism, reject regardless of the mean.
    D. Only if A-C hold: a backtest with an ATR(14) x 2.5 stop, 60/40 train/test,
       per-calendar-year, cost at 1x/2x/4x, n >= 50 pooled.
    E. OVERLAP against S3, D1, B1, M3. The prior worry is specifically B1: OI up
       with price up drives the premium, which drives funding, which is what B1
       already fades. If overlap with B1 > 0.6 this adds nothing even if it works.
    F. THE ONE TEST THIS PROXY CANNOT DO, and the reason the real data matters:
       split price-up days into OI-up vs OI-DOWN and show the forward returns
       have OPPOSITE SIGNS. Funding cannot show that because funding is pinned
       flat much of the time (see Part 2). Real OI always moves. If the signs do
       not separate, the whole positioning read is dead for this venue and that
       is a finished, publishable negative.

  SAMPLE-SIZE REALITY CHECK BEFORE ANYONE GETS EXCITED
    183 days x 4 coins = 732 coin-days. With a 1-sigma materiality filter that is
    ~200 signal days spread over 4 quadrants, so ~50 per quadrant, one-sided,
    with 10-day overlapping holds. That is indicative at best and MUST be
    labelled so. A real verdict wants 12-18 months. Start the clock, do not
    grade early.
""")

    hr('CONCLUSION')
    print("""
  REJECTED, on three independent grounds, none of which is a close call.

  1. THE REAL TEST IS NOT RUNNABLE. The collector holds 0.90 days and 0 complete
     daily bars. Nothing in this file is evidence about open interest, and it
     must not be logged as if it were. Part 4 is the actual deliverable.

  2. THE PROXY SHOWS NO DIVERGENCE EFFECT. The whole hypothesis reduces to one
     number - the gap between two quadrants that share a price direction - and
     that gap is +0.18% (p 0.81) and -0.90% (p 0.38) on up-days at 5 and 10 day
     holds, +0.10% (p 0.88) and -0.68% (p 0.51) on down-days. Two of four have
     the predicted sign, none is significant, and the sign FLIPS with holding
     period, which is what noise looks like. The permutation p is a floor
     because overlapping holds make the observations dependent, so the true
     numbers are worse than printed.

  3. THE TRADABLE VERSION LOSES MONEY AND THE PROFITABLE MIRROR IS ALREADY OWNED.
     The pre-committed crowded-fade is -0.45% mean, -1.10% trimmed, 43.8% win,
     1 of 4 years positive, negative in train AND test, at 88 trades/yr = 16.7%
     of notional per year in cost. Every one of the 8 neighbourhood cells is
     negative on trimmed expectancy, so there is not even an overfit cell to be
     tempted by. Its mirror (continue instead of fade) is the only positive mean
     at +0.06%, and it is trimmed-NEGATIVE at -0.29% - and it overlaps D1 at
     0.92-1.00 and S3 at 0.70-0.88. It is not a new bet, it is forced-flow
     continuation rediscovered and executed worse.

  ONE THING WORTH KEEPING. The measured B1 overlap of the fade is 0.51-0.64
  (ETH 0.64, HYPE 0.62). The funding derivative and the perp basis are largely
  the same trades, as suspected - so when the real OI test runs, an OI signal
  that works only through the funding/premium channel will be B1 again. The
  version of this idea that could add something is the one Part 4 test F
  isolates: price-up-with-OI-UP versus price-up-with-OI-DOWN, where OI moves and
  funding does not. Funding is pinned at its base rate 41-66% of the time
  (Part 2), which is exactly why the proxy cannot see that split and real OI can.
""")

    hr('VARIANT COUNT - the multiple-testing number')
    print('  {} configurations evaluated in this file:'.format(len(VARIANTS)))
    for v in VARIANTS:
        print('    - ' + v)


if __name__ == '__main__':
    main()
