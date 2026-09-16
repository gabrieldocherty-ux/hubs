"""
TAIL CORRELATION AND THE REAL PORTFOLIO RISK.

HYPOTHESIS / WHY THIS MATTERS

The 75/25 daily/macro split was justified on an AVERAGE correlation between
sleeves (-0.19 to +0.02 monthly). Average correlation is the wrong statistic for
the risk that ruins accounts. The standard market-lore claim is that
"correlations go to 1 when it matters" - and this book is exactly the setup that
claim describes: four highly correlated majors, on one venue, held by strategies
that can all be positioned the same way at once. A diversification benefit
computed on ordinary days and spent on extraordinary ones is not a benefit.

But the lore is also the single most over-claimed result in risk management,
because conditioning on a bad market day MECHANICALLY raises measured
correlation even when nothing about the dependence structure has changed. If two
series both load linearly on a market factor, and you look only at days when
that factor is large, the factor's share of each series' variance rises and the
measured correlation rises with it - under a constant, perfectly linear,
perfectly Gaussian world. Any honest version of this test has to net that
artifact out before claiming tail contagion. That is what this script does.

WHAT IS BUILT HERE THAT DID NOT EXIST BEFORE

  research/concentration_risk.py  counted POSITIONS per day and asserted a
      stress loss from the average of each coin's independently-worst day.
      Those minima happen on DIFFERENT days, so that number is not a day that
      ever occurred.
  research/net_exposure_cap.py    replayed entries against a net cap and scored
      it on TOTAL and PER-TRADE P&L. Per-trade P&L is a strategy statistic, not
      a portfolio risk statistic: it cannot see drawdown, because it has no
      time axis and no mark-to-market.

  This script adds the missing piece: a genuine DAILY MARK-TO-MARKET portfolio
  P&L series, reconstructed by re-pricing every open position against its own
  coin's daily bars, for the whole book (S3 + D1 + B1 daily sleeve, M3 macro
  sleeve) with the real rails applied in replay - $16.25 per position, 75/25
  sleeve notional caps, and the net-exposure cap as a swept parameter. From that
  one series everything else follows honestly: portfolio drawdown, the joint
  loss distribution, conditional correlation on the worst market days measured
  against a factor-model null, and whether the 10% daily breaker sits in a
  sensible place in the distribution of days the book actually produces.

FOUR QUESTIONS, IN ORDER
  1. Does the diversification survive the worst decile of market days - after
     netting out the conditioning artifact?
  2. What is the real portfolio-level joint-loss distribution and drawdown?
  3. Is the 50% net-exposure cap at the right level, measured against days that
     actually happened rather than a synthetic worst-of-worsts?
  4. Would the 10% daily loss breaker fire on ordinary bad days (too tight) or
     only genuinely abnormal ones - and note the breaker counts REALIZED P&L
     only (core/circuit_breaker.py), which is a different series from the
     mark-to-market one.
"""
import sys, datetime, math, random
import statistics as st

sys.path.insert(0, 'research')
import engine, pooled, run_basis
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout
from strategies_macro import donchian_turtle

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
CAPITAL = 250.0
POS = 16.25
DAY = datetime.timedelta(days=1)

# Sleeve membership per CLAUDE.md: S3/D1/B1 -> daily, M3 -> macro.
SLEEVE = {'S3': 'daily', 'D1': 'daily', 'B1': 'daily', 'M3': 'macro'}
ALLOC = {'daily': 0.75, 'macro': 0.25}
BREAKER_PCT = 0.10
NET_CAP = 0.50


def d(ms):
    return datetime.datetime.utcfromtimestamp(ms / 1000).date()


def fmt_d(x):
    return x.strftime('%Y-%m-%d')


# ----------------------------------------------------------------------------
# 0. THE BOOK
# ----------------------------------------------------------------------------
def build_book():
    out = {}
    _, s3 = pooled.pooled(volume_spike, {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5},
                          COINS, 60, name='S3')
    _, d1 = pooled.pooled(range_breakout, {'n': 20, 'atr_mult': 2.5, 'max_hold': 10,
                                           'atr_ratio': 2.0}, COINS, 60, name='D1')
    _, b1 = run_basis.run(run_basis.BASE)
    _, m3 = pooled.pooled(donchian_turtle, {'entry_n': 55, 'exit_n': 20, 'atr_mult': 3.0},
                          COINS, 85, name='M3')
    out['S3'], out['D1'], out['B1'], out['M3'] = s3, d1, b1, m3
    return out


BARS = {}
CLOSE = {}          # coin -> {date: close}
DATES = {}          # coin -> ordered list of dates


def load_prices():
    for c in COINS:
        bars, _ = pooled.load(c)
        BARS[c] = bars
        CLOSE[c] = {}
        DATES[c] = []
        for b in bars:
            dt = d(b['t'])
            CLOSE[c][dt] = b['c']
            DATES[c].append(dt)


def prev_close(coin, dt):
    """Close of the most recent bar strictly before dt. None if none exists."""
    ds = DATES[coin]
    lo, hi = 0, len(ds)
    while lo < hi:
        mid = (lo + hi) // 2
        if ds[mid] < dt:
            lo = mid + 1
        else:
            hi = mid
    return CLOSE[coin][ds[lo - 1]] if lo > 0 else None


def daily_marks(t):
    """Split one trade into per-DAY net P&L fractions of its own notional.

    Gross is re-priced against the coin's real daily closes (entry price -> close,
    close -> close, close -> exit price), so an open position loses money on the
    day the market falls, not on the day it eventually closes. Funding is spread
    evenly over the held days. The round-trip cost is booked entirely on the
    entry day, which is conservative for drawdown timing and irrelevant to totals.

    Returns {date: pnl_fraction}. Sums to t.pnl_pct up to additive-vs-compound
    rounding, which is asserted below.
    """
    sign = 1.0 if t.direction == 'long' else -1.0
    d0, d1 = d(t.entry_t), d(t.exit_t)
    days = []
    cur = d0
    while cur <= d1:
        if cur in CLOSE[t.coin]:
            days.append(cur)
        cur += DAY
    if not days:
        return {d0: t.pnl_pct}
    marks = {}
    ref = t.entry_price
    for i, dt in enumerate(days):
        px = t.exit_price if dt == d1 else CLOSE[t.coin][dt]
        marks[dt] = sign * (px / ref - 1.0)
        ref = px
    # exit day may be a date with no bar of its own (shouldn't happen, guard anyway)
    if d1 not in marks:
        marks[days[-1]] += sign * (t.exit_price / ref - 1.0)
    per_day_funding = t.funding_pct / len(days)
    for dt in marks:
        marks[dt] += per_day_funding
    marks[days[0]] += t.cost_pct          # cost_pct is stored negative
    return marks


# ----------------------------------------------------------------------------
# 1. REPLAY WITH THE REAL RAILS -> daily mark-to-market portfolio series
# ----------------------------------------------------------------------------
def replay(book, net_cap=NET_CAP, sleeve_caps=True, tags=('S3', 'D1', 'B1', 'M3')):
    """Replay every trade in entry-time order, refusing entries the live risk
    manager would refuse (sleeve notional cap, net one-way exposure cap), then
    mark the surviving book to market every day.

    Returns a dict of daily series keyed by date."""
    trades = []
    for tag in tags:
        for t in book[tag].trades:
            trades.append((tag, t))
    trades.sort(key=lambda x: x[1].entry_t)

    open_pos = []      # (exit_t, tag, sleeve, direction, notional)
    accepted = []      # (tag, trade)
    skipped = {'sleeve': 0, 'net': 0}
    for tag, t in trades:
        open_pos = [p for p in open_pos if p[0] > t.entry_t]
        sl = SLEEVE[tag]
        if sleeve_caps:
            sl_exp = sum(p[4] for p in open_pos if p[2] == sl)
            if sl_exp + POS > CAPITAL * ALLOC[sl] + 1e-9:
                skipped['sleeve'] += 1
                continue
        if net_cap is not None:
            net = sum(p[4] if p[3] == 'long' else -p[4] for p in open_pos)
            delta = POS if t.direction == 'long' else -POS
            if abs(net + delta) > CAPITAL * net_cap + 1e-9 and abs(net + delta) > abs(net):
                skipped['net'] += 1
                continue
        open_pos.append((t.exit_t, tag, sl, t.direction, POS))
        accepted.append((tag, t))

    # ---- daily mark-to-market ----
    pnl_by_tag = {tag: {} for tag in tags}
    realized = {}
    gross_exp = {}
    net_exp = {}
    npos = {}
    for tag, t in accepted:
        for dt, frac in daily_marks(t).items():
            pnl_by_tag[tag][dt] = pnl_by_tag[tag].get(dt, 0.0) + frac * POS
        realized[d(t.exit_t)] = realized.get(d(t.exit_t), 0.0) + t.pnl_pct * POS
        sign = 1 if t.direction == 'long' else -1
        cur, last = d(t.entry_t), d(t.exit_t)
        while cur <= last:
            gross_exp[cur] = gross_exp.get(cur, 0.0) + POS
            net_exp[cur] = net_exp.get(cur, 0.0) + sign * POS
            npos[cur] = npos.get(cur, 0) + 1
            cur += DAY
    return {'pnl': pnl_by_tag, 'realized': realized, 'gross': gross_exp,
            'net': net_exp, 'npos': npos, 'accepted': accepted, 'skipped': skipped}


def market_series():
    """Equal-weight daily return across the coins that traded that day. This is
    the 'market day' variable everything is conditioned on."""
    alld = sorted(set().union(*[set(DATES[c]) for c in COINS]))
    out = {}
    for dt in alld:
        rs = []
        for c in COINS:
            if dt in CLOSE[c]:
                p = prev_close(c, dt)
                if p:
                    rs.append(CLOSE[c][dt] / p - 1.0)
        if rs:
            out[dt] = sum(rs) / len(rs)
    return out


# ----------------------------------------------------------------------------
# small stats helpers (pure python, no numpy dependency in this repo)
# ----------------------------------------------------------------------------
def corr(a, b):
    n = len(a)
    if n < 3:
        return None
    ma, mb = st.mean(a), st.mean(b)
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((x - mb) ** 2 for x in b)
    if va <= 0 or vb <= 0:
        return None
    cv = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    return cv / math.sqrt(va * vb)


def ols(y, x):
    """Simple regression y = a + b x. Returns (a, b, residuals)."""
    mx, my = st.mean(x), st.mean(y)
    vx = sum((v - mx) ** 2 for v in x)
    if vx <= 0:
        return my, 0.0, [v - my for v in y]
    b = sum((xi - mx) * (yi - my) for xi, yi in zip(x, y)) / vx
    a = my - b * mx
    res = [yi - (a + b * xi) for xi, yi in zip(x, y)]
    return a, b, res


def pct(vals, q):
    s = sorted(vals)
    if not s:
        return 0.0
    k = (len(s) - 1) * q
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return s[lo] if lo == hi else s[lo] + (s[hi] - s[lo]) * (k - lo)


def max_dd(series_by_date):
    """Additive equity drawdown in dollars on a fixed-notional book."""
    eq = 0.0
    peak = 0.0
    worst = 0.0
    worst_date = None
    for dt in sorted(series_by_date):
        eq += series_by_date[dt]
        peak = max(peak, eq)
        if eq - peak < worst:
            worst = eq - peak
            worst_date = dt
    return worst, worst_date


# ============================================================================
def main():
    load_prices()
    book = build_book()
    mkt = market_series()

    print('=' * 118)
    print('0. THE BOOK AS RECONSTRUCTED')
    print('=' * 118)
    for tag in ('S3', 'D1', 'B1', 'M3'):
        r = book[tag]
        print('  {:<4} {:<8} n={:<4} exp={:>7.2%} trim5={:>7.2%}  window {} -> {}'.format(
            tag, SLEEVE[tag], r.n, r.expectancy, r.trimmed_expectancy(0.05),
            fmt_d(d(r.start_t)), fmt_d(d(r.end_t))))

    # sanity: daily marks must reconstruct each trade's P&L
    err = 0.0
    for tag in ('S3', 'D1', 'B1', 'M3'):
        for t in book[tag].trades:
            err = max(err, abs(sum(daily_marks(t).values()) - t.pnl_pct))
    print('  daily mark-to-market reconstruction: max |sum(daily) - trade P&L| = '
          '{:.4%} (additive vs compound rounding only)'.format(err))

    R = replay(book, net_cap=NET_CAP)
    tot = {}
    for tag, series in R['pnl'].items():
        for dt, v in series.items():
            tot[dt] = tot.get(dt, 0.0) + v
    daily_sleeve = {}
    for tag in ('S3', 'D1', 'B1'):
        for dt, v in R['pnl'][tag].items():
            daily_sleeve[dt] = daily_sleeve.get(dt, 0.0) + v
    macro_sleeve = dict(R['pnl']['M3'])

    active = sorted(tot)
    print('  replay at the live rails (75/25 sleeve caps + {:.0%} net cap): {} entries taken, '
          '{} refused by sleeve cap, {} by net cap'.format(
              NET_CAP, len(R['accepted']), R['skipped']['sleeve'], R['skipped']['net']))
    print('  portfolio has a mark-to-market P&L on {} calendar days, {} -> {}'.format(
        len(active), fmt_d(active[0]), fmt_d(active[-1])))

    # ------------------------------------------------------------------
    print('\n' + '=' * 118)
    print('1. CONDITIONAL CORRELATION - does the diversification survive the days it is for?')
    print('=' * 118)
    # Common grid: every day inside the overlapping live window, zero-filled.
    lo = max(d(book[t].start_t) for t in ('S3', 'D1', 'B1', 'M3'))
    hi = min(d(book[t].end_t) for t in ('S3', 'D1', 'B1', 'M3'))
    grid = [dt for dt in sorted(mkt) if lo <= dt <= hi]
    print('  common window across all four strategies: {} -> {}  ({} days)'.format(
        fmt_d(lo), fmt_d(hi), len(grid)))
    print('  NOTE B1 has the shortest history (spot data starts 2025) and M3 has n=49 -')
    print('       the common window is short and that limits every number in this section.')

    S = {tag: [R['pnl'][tag].get(dt, 0.0) for dt in grid] for tag in ('S3', 'D1', 'B1', 'M3')}
    S['DAILY'] = [daily_sleeve.get(dt, 0.0) for dt in grid]
    S['MACRO'] = [macro_sleeve.get(dt, 0.0) for dt in grid]
    S['BOOK'] = [tot.get(dt, 0.0) for dt in grid]
    M = [mkt[dt] for dt in grid]

    # worst decile of market days
    thresh = pct(M, 0.10)
    worst_idx = [i for i, m in enumerate(M) if m <= thresh]
    calm_idx = [i for i in range(len(M)) if i not in set(worst_idx)]
    print('  worst-decile market day threshold: {:+.2%} equal-weight daily move  '
          '({} of {} days)'.format(thresh, len(worst_idx), len(grid)))
    print('  market variance in that decile is {:.1f}x the full-sample variance - this is the '
          'whole reason\n  conditional correlations rise, and it has to be netted out.'.format(
              st.pvariance([M[i] for i in worst_idx]) / st.pvariance(M)))

    pairs = [('DAILY', 'MACRO'), ('S3', 'M3'), ('D1', 'M3'), ('B1', 'M3'),
             ('S3', 'D1'), ('S3', 'B1'), ('D1', 'B1')]
    print('\n  {:<14}{:>12}{:>14}{:>16}{:>14}'.format(
        'pair', 'all days', 'worst decile', 'factor-null pred', 'excess'))
    print('  ' + '-' * 70)
    for a, b in pairs:
        ca = corr(S[a], S[b])
        wa = [S[a][i] for i in worst_idx]
        wb = [S[b][i] for i in worst_idx]
        cw = corr(wa, wb)
        # Factor null: each series is a + beta*market + residual, residual
        # variance and residual covariance CONSTANT. Predicted conditional
        # correlation on a subsample where the market variance is vm.
        _, ba, ra = ols(S[a], M)
        _, bb, rb = ols(S[b], M)
        vm = st.pvariance([M[i] for i in worst_idx])
        cov_r = sum((x - st.mean(ra)) * (y - st.mean(rb)) for x, y in zip(ra, rb)) / len(ra)
        va_r, vb_r = st.pvariance(ra), st.pvariance(rb)
        num = ba * bb * vm + cov_r
        den = math.sqrt((ba * ba * vm + va_r) * (bb * bb * vm + vb_r))
        pred = num / den if den > 0 else float('nan')
        exc = (cw - pred) if (cw is not None) else float('nan')
        print('  {:<14}{:>12}{:>14}{:>16}{:>14}'.format(
            a + '/' + b,
            '-' if ca is None else '{:+.2f}'.format(ca),
            '-' if cw is None else '{:+.2f}'.format(cw),
            '{:+.2f}'.format(pred),
            '{:+.2f}'.format(exc)))
    print("""
  HOW TO READ THIS. 'worst decile' is the raw conditional correlation - the
  number the market-lore claim points at. 'factor-null pred' is what that same
  correlation WOULD be if nothing changed in the tail except the market being
  more volatile: same betas, same residual variances, same residual covariance,
  no nonlinear contagion. 'excess' is the only part that is evidence of the
  diversification actually breaking. A small excess means the raw rise is an
  artifact of conditioning, not a change in the dependence structure.""")

    # nonparametric lower-tail dependence, on co-active days only
    print('\n  LOWER TAIL DEPENDENCE (nonparametric, co-active days only)')
    print('  P(B in its worst q | A in its worst q). Independence = q. Both-lose-together = 1.')
    print('  {:<14}{:>10}{:>14}{:>14}'.format('pair', 'co-active', 'q=0.20', 'q=0.10'))
    for a, b in pairs:
        co = [i for i in range(len(grid)) if S[a][i] != 0 and S[b][i] != 0]
        if len(co) < 30:
            print('  {:<14}{:>10}{:>14}{:>14}'.format(a + '/' + b, len(co), 'n too small', ''))
            continue
        va = [S[a][i] for i in co]
        vb = [S[b][i] for i in co]
        row = []
        for q in (0.20, 0.10):
            ta, tb = pct(va, q), pct(vb, q)
            both = sum(1 for x, y in zip(va, vb) if x <= ta and y <= tb)
            na = sum(1 for x in va if x <= ta)
            row.append(both / na if na else float('nan'))
        print('  {:<14}{:>10}{:>14}{:>14}'.format(
            a + '/' + b, len(co), '{:.2f}'.format(row[0]), '{:.2f}'.format(row[1])))

    # monthly, to reproduce the number the allocation was justified on
    print('\n  MONTHLY sleeve correlation (the statistic the 75/25 split was justified on)')
    mo_d, mo_m = {}, {}
    for i, dt in enumerate(grid):
        k = (dt.year, dt.month)
        mo_d[k] = mo_d.get(k, 0.0) + S['DAILY'][i]
        mo_m[k] = mo_m.get(k, 0.0) + S['MACRO'][i]
    ks = sorted(set(mo_d) & set(mo_m))
    cm = corr([mo_d[k] for k in ks], [mo_m[k] for k in ks])
    print('    n={} months, corr = {}'.format(
        len(ks), '-' if cm is None else '{:+.2f}'.format(cm)))
    both_neg = sum(1 for k in ks if mo_d[k] < 0 and mo_m[k] < 0)
    d_neg = sum(1 for k in ks if mo_d[k] < 0)
    print('    months where BOTH sleeves lost: {} of {} ({:.0%} of all months; '
          '{:.0%} of the daily sleeve\'s losing months)'.format(
              both_neg, len(ks), both_neg / len(ks), both_neg / d_neg if d_neg else 0))

    # ------------------------------------------------------------------
    print('\n' + '=' * 118)
    print('2. THE REAL JOINT-LOSS DISTRIBUTION AND PORTFOLIO DRAWDOWN')
    print('=' * 118)
    full = sorted(set(list(tot) + list(mkt)))
    full = [dt for dt in full if dt >= min(tot)]
    book_daily = [tot.get(dt, 0.0) for dt in full]
    dd, dd_date = max_dd(tot)
    print('  Marked daily on {} calendar days from {} to {}.'.format(
        len(full), fmt_d(full[0]), fmt_d(full[-1])))
    print('  total P&L ${:+.2f} on ${:.0f} of capital   worst day ${:+.2f} ({:+.2%} of capital)'
          '   best day ${:+.2f}'.format(
              sum(book_daily), CAPITAL, min(book_daily), min(book_daily) / CAPITAL,
              max(book_daily)))
    print('  PORTFOLIO max drawdown ${:.2f} = {:.2%} of capital, trough {}'.format(
        -dd, -dd / CAPITAL, fmt_d(dd_date) if dd_date else 'n/a'))
    print('  daily P&L percentiles (% of capital):  ' + '   '.join(
        'p{:g}={:+.2%}'.format(q * 100, pct(book_daily, q) / CAPITAL)
        for q in (0.001, 0.01, 0.05, 0.25, 0.50, 0.95, 0.99)))

    print('\n  SUM-OF-PARTS vs PORTFOLIO - is the drawdown additive, or does it net?')
    print('  {:<12}{:>14}{:>16}{:>14}'.format('series', 'max DD $', 'max DD %cap', 'worst day $'))
    for tag in ('S3', 'D1', 'B1', 'M3'):
        s = R['pnl'][tag]
        w, _ = max_dd(s)
        wd = min(s.values()) if s else 0.0
        print('  {:<12}{:>14}{:>16}{:>14}'.format(
            tag, '{:.2f}'.format(-w), '{:.2%}'.format(-w / CAPITAL), '{:+.2f}'.format(wd)))
    wsum = sum(-max_dd(R['pnl'][tag])[0] for tag in ('S3', 'D1', 'B1', 'M3'))
    print('  {:<12}{:>14}{:>16}'.format('SUM', '{:.2f}'.format(wsum),
                                        '{:.2%}'.format(wsum / CAPITAL)))
    print('  {:<12}{:>14}{:>16}{:>14}'.format(
        'PORTFOLIO', '{:.2f}'.format(-dd), '{:.2%}'.format(-dd / CAPITAL),
        '{:+.2f}'.format(min(book_daily))))
    print('  diversification ratio (portfolio DD / sum of DDs): {:.2f}  '
          '- 1.00 means no netting at all'.format(-dd / wsum if wsum else 0))

    # circular-shift null: destroys cross-strategy alignment, preserves each
    # strategy's own marginal distribution and autocorrelation.
    print('\n  IS THE TAIL WORSE THAN CHANCE ALIGNMENT? (circular-shift null, 2000 draws)')
    print('  Each strategy\'s daily series is rotated by an independent random offset, which')
    print('  keeps its own shape and clustering but destroys any real co-timing between them.')
    random.seed(11)
    idx = {tag: [R['pnl'][tag].get(dt, 0.0) for dt in full] for tag in ('S3', 'D1', 'B1', 'M3')}
    N = len(full)
    worse_day = worse_dd = 0
    sim_days, sim_dds = [], []
    for _ in range(2000):
        off = {tag: random.randrange(N) for tag in idx}
        agg = [0.0] * N
        for tag, s in idx.items():
            o = off[tag]
            for i in range(N):
                agg[i] += s[(i + o) % N]
        wd = min(agg)
        eq = peak = 0.0
        mdd = 0.0
        for v in agg:
            eq += v
            peak = max(peak, eq)
            mdd = min(mdd, eq - peak)
        sim_days.append(wd)
        sim_dds.append(mdd)
        if wd <= min(book_daily):
            worse_day += 1
        if mdd <= dd:
            worse_dd += 1
    print('    actual worst day ${:+.2f}  vs shuffled median ${:+.2f} (p5 ${:+.2f})  -> '
          'p = {:.3f}'.format(min(book_daily), st.median(sim_days), pct(sim_days, 0.05),
                              worse_day / 2000))
    print('    actual max DD   ${:.2f}  vs shuffled median ${:.2f} (p5 ${:.2f})  -> '
          'p = {:.3f}'.format(-dd, -st.median(sim_dds), -pct(sim_dds, 0.05),
                              worse_dd / 2000))
    print('    p is the fraction of RANDOMLY ALIGNED books that were at least as bad. A high p')
    print('    means the real book\'s tail is ordinary given its parts - no extra co-timing risk.')

    # ------------------------------------------------------------------
    print('\n' + '=' * 118)
    print('3. THE NET-EXPOSURE CAP, MEASURED ON DAYS THAT ACTUALLY HAPPENED')
    print('=' * 118)
    print('  First, correcting the stress number in concentration_risk.py. That script averaged')
    print('  each coin\'s independently-worst day. Those minima fall on DIFFERENT dates, so the')
    print('  result is a day that never occurred. The right number is the worst SIMULTANEOUS move.')
    per_coin_worst = []
    for c in COINS:
        rs = [CLOSE[c][DATES[c][i]] / CLOSE[c][DATES[c][i - 1]] - 1 for i in range(1, len(DATES[c]))]
        per_coin_worst.append(min(rs))
    mv = sorted(mkt.items(), key=lambda kv: kv[1])
    print('    avg of independent per-coin worst days (the old number): {:.2%}'.format(
        st.mean(per_coin_worst)))
    print('    worst ACTUAL equal-weight day in the sample:             {:.2%}  on {}'.format(
        mv[0][1], fmt_d(mv[0][0])))
    print('    5 worst actual days: ' + ',  '.join(
        '{} {:.1%}'.format(fmt_d(k), v) for k, v in mv[:5]))
    print('    1-in-1000-day equal-weight move (empirical p0.1):        {:.2%}'.format(
        pct(list(mkt.values()), 0.001)))

    # stop truncation: 2.5x ATR is the real per-position floor unless it gaps
    stops = []
    for c in COINS:
        atr = engine.atr_series(BARS[c], 14)
        for i, b in enumerate(BARS[c]):
            if atr[i]:
                stops.append(2.5 * atr[i] / b['c'])
    print('    median 2.5xATR stop distance across the book: {:.1%} of price  '
          '(p90 {:.1%})'.format(st.median(stops), pct(stops, 0.90)))
    print('    -> a single position\'s one-day loss is bounded near the stop unless price gaps')
    print('       THROUGH it, and on a 24/7 perp venue overnight gaps are small; the binding')
    print('       case is an intraday cascade, which the stop does catch, at the stop.')

    print('\n  Observed exposure at the live rails ({:.0%} net cap):'.format(NET_CAP))
    nets = [abs(v) for v in R['net'].values()]
    gs = list(R['gross'].values())
    nps = list(R['npos'].values())
    print('    days holding a position: {}   peak positions: {}   peak gross ${:.2f} ({:.0%})'
          '   peak |net| ${:.2f} ({:.0%})'.format(
              len(nps), max(nps), max(gs), max(gs) / CAPITAL, max(nets), max(nets) / CAPITAL))
    print('    |net| percentiles: ' + '  '.join(
        'p{:g}={:.0%}'.format(q * 100, pct(nets, q) / CAPITAL)
        for q in (0.50, 0.75, 0.90, 0.99, 1.0)))

    print('\n  SWEEP - each cap replayed end to end, then marked daily. Total P&L is not the')
    print('  test (a cap that skips trades always shows less); worst day and drawdown are.')
    print('  {:<10}{:>8}{:>9}{:>12}{:>12}{:>12}{:>13}{:>12}'.format(
        'net cap', 'taken', 'skipped', 'peak |net|', 'total P&L', 'worst day', 'max DD',
        'P&L/trade'))
    sweep = {}
    for cap in (None, 1.00, 0.80, 0.60, 0.50, 0.40, 0.30, 0.20):
        r = replay(book, net_cap=cap)
        tt = {}
        for tag, series in r['pnl'].items():
            for dt, v in series.items():
                tt[dt] = tt.get(dt, 0.0) + v
        vals = list(tt.values())
        w, _ = max_dd(tt)
        pk = max(abs(v) for v in r['net'].values())
        sweep[cap] = (r, tt)
        print('  {:<10}{:>8}{:>9}{:>12}{:>12}{:>12}{:>13}{:>12}'.format(
            'none' if cap is None else '{:.0%}'.format(cap),
            len(r['accepted']), r['skipped']['net'],
            '{:.0%}'.format(pk / CAPITAL),
            '${:+.2f}'.format(sum(vals)),
            '${:+.2f}'.format(min(vals)),
            '${:.2f} ({:.1%})'.format(-w, -w / CAPITAL),
            '${:+.3f}'.format(sum(vals) / len(r['accepted']))))

    print('\n  STRESS - what the cap is actually buying. A fully-aligned book at cap C, hit by')
    print('  the worst equal-weight day in the sample, with per-position loss floored at the')
    print('  median stop:')
    worst_mkt = mv[0][1]
    stop_floor = -st.median(stops)
    eff = max(worst_mkt, stop_floor)
    print('    worst actual day {:.2%}, median stop {:.2%} -> effective per-position loss {:.2%}'
          .format(worst_mkt, stop_floor, eff))
    print('    {:<12}{:>18}{:>22}{:>22}'.format(
        'cap', 'net notional', 'loss (no stop)', 'loss (stop holds)'))
    for cap in (1.00, 0.80, 0.60, 0.50, 0.40, 0.30):
        notional = CAPITAL * cap
        print('    {:<12}{:>18}{:>22}{:>22}'.format(
            '{:.0%}'.format(cap), '${:.2f}'.format(notional),
            '${:.2f} ({:.1%} cap)'.format(notional * worst_mkt, notional * worst_mkt / CAPITAL),
            '${:.2f} ({:.1%} cap)'.format(notional * eff, notional * eff / CAPITAL)))

    # ------------------------------------------------------------------
    print('\n' + '=' * 118)
    print('4. IS THE 10% DAILY LOSS BREAKER IN THE RIGHT PLACE?')
    print('=' * 118)
    print('  core/circuit_breaker.py counts REALIZED P&L only - it trips on closed trades, not')
    print('  on mark-to-market. Both series matter and they are not the same, so both are here.')
    real_vals = [R['realized'].get(dt, 0.0) for dt in full]
    print('\n  {:<24}{:>14}{:>14}{:>14}{:>14}'.format(
        'series', 'worst day', 'p1', 'p5', 'days < -10%'))
    for label, vals in (('mark-to-market', book_daily), ('realized (what it sees)', real_vals)):
        n10 = sum(1 for v in vals if v <= -BREAKER_PCT * CAPITAL)
        print('  {:<24}{:>14}{:>14}{:>14}{:>14}'.format(
            label,
            '{:+.2%}'.format(min(vals) / CAPITAL),
            '{:+.2%}'.format(pct(vals, 0.01) / CAPITAL),
            '{:+.2%}'.format(pct(vals, 0.05) / CAPITAL),
            str(n10)))

    print('\n  How often would each threshold fire, on the realized series the breaker reads?')
    years = (full[-1] - full[0]).days / 365.25
    print('  {:<12}{:>14}{:>18}{:>22}'.format(
        'threshold', 'days tripped', 'per year', 'return period'))
    for thr in (0.03, 0.04, 0.05, 0.06, 0.075, 0.10, 0.125):
        n = sum(1 for v in real_vals if v <= -thr * CAPITAL)
        n_mtm = sum(1 for v in book_daily if v <= -thr * CAPITAL)
        rate = n / years
        print('  {:<12}{:>14}{:>18}{:>22}   (mtm: {} days)'.format(
            '{:.1%}'.format(thr), n, '{:.2f}'.format(rate),
            'never in {:.1f}y'.format(years) if n == 0 else '1 per {:.1f} years'.format(1 / rate),
            n_mtm))

    print('\n  The size of the biggest loss the book can realize IN ONE DAY is structural, not')
    print('  statistical: it is bounded by how many positions can be stopped out at once.')
    coexit = {}
    for tag, t in R['accepted']:
        coexit[d(t.exit_t)] = coexit.get(d(t.exit_t), 0) + 1
    print('    most positions ever closing on the same day: {}'.format(max(coexit.values())))
    print('    at ${:.2f} each and the median {:.1%} stop, that is ${:.2f} = {:.1%} of capital'
          .format(POS, -stop_floor, max(coexit.values()) * POS * -stop_floor,
                  max(coexit.values()) * POS * -stop_floor / CAPITAL))
    print('    the {:.0%} net cap allows at most {:.1f} aligned positions; all stopped on one'
          ' day = ${:.2f} = {:.1%} of capital'.format(
              NET_CAP, NET_CAP * CAPITAL / POS,
              NET_CAP * CAPITAL * -stop_floor, NET_CAP * -stop_floor))

    print('\n' + '=' * 118)
    print('DONE - read the recommendation section of the report, not just the tables.')
    print('=' * 118)


if __name__ == '__main__':
    main()
