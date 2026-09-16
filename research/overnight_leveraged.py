"""
Combining the two things that actually worked, instead of running them separately.

Two findings are sitting in this repo unconnected:
  1. The equity risk premium is paid OVERNIGHT. VFV overnight-only returned
     +22.99% a year at Sharpe 2.06 with a 60.6% win rate.
  2. TSX-listed 2x funds are tradeable here with no FX and no commission, and a
     volatility overlay turns HQU from +7.4% (maxDD -95.8%) into +29.3%.

They have never been put together, and there is a specific reason the combination
should be better than either - not merely additive.

WHY OVERNIGHT LEVERAGE IS THE RIGHT USE OF A DAILY-RESET FUND. The fatal flaw of
a 2x ETF is volatility decay, and decay accrues from the daily REBALANCE - the
fund resets its leverage at the close every day. An overnight holder buys at the
close and sells at the next open, so the position spans the reset but holds for
only ~17 hours of the 24-hour cycle, and critically it is FLAT during the intraday
session, which is where the choppy up-down-up path that generates decay actually
happens. The strategy is structurally exposed to the leg that pays (the overnight
premium, doubled) and absent for the leg that decays (intraday churn, doubled).

That is a real mechanistic argument, and it makes a falsifiable prediction: the
overnight premium on a 2x fund should be close to 2x the premium on its unlevered
twin, WITHOUT the corresponding 2x decay penalty.

FOUR COMBINATIONS TESTED, all long/flat, all Wealthsimple-executable:
  A. overnight on the 2x funds
  B. VOL-MANAGED OVERNIGHT - hold overnight, sized by inverse realised volatility.
     Attacks the one genuine weakness of the overnight sleeve, which is that its
     drawdowns (-26.9% on VFV) arrive as gaps that cannot be stopped out of.
  C. TREND-FILTERED OVERNIGHT - hold overnight only when the index is above its
     trend. Skips the nights that occur inside bear markets.
  D. Both overlays at once.

And every one of them is put through the bad-fill test, because leverage amplifies
execution error exactly as it amplifies everything else. A 2x fund's opening print
being off by 10bp costs twice what it costs on the unlevered fund.
"""
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng

CAPITAL = 1000.0
BAD = 0.10
PAIRS = [('HQU.TO', 'ZQQ.TO', '2x Nasdaq 100'),
         ('HSU.TO', 'VFV.TO', '2x S&P 500'),
         ('HXU.TO', 'XIU.TO', '2x TSX 60')]


def prep(sym):
    bars = tsx_data.get(sym)
    dv = st.median([b['raw_c'] * b['v'] for b in bars[-60:] if b['v'] > 0] or [0])
    rt = tsx_data.cost_model(sym, bars, dollar_vol=dv)[0]
    on_g, on_b = [], []
    for i in range(1, len(bars)):
        c0, o = bars[i - 1]['c'], bars[i]['o']
        on_g.append((o - c0) / c0 - rt)
        fill = o - BAD * (o - bars[i]['l'])
        on_b.append((fill - c0) / c0 - rt)
    return {'bars': bars, 'rt': rt, 'on': on_g, 'on_bad': on_b,
            'ret': eng.total_returns(bars), 'dates': eng.dates(bars)}


D = {}
for lev, base, _ in PAIRS:
    for s in (lev, base):
        if s not in D:
            try:
                D[s] = prep(s)
            except Exception as e:
                print('skip {}: {}'.format(s, e))

# ------------------------------------------------------------------ A
print('=' * 116)
print('A. IS THE OVERNIGHT PREMIUM ROUGHLY DOUBLED ON THE 2x FUND?')
print('   Prediction: yes, and WITHOUT the matching 2x decay, because the position')
print('   is flat during the intraday session where decay is generated.')
print('=' * 116)
print('  {:24}{:>12}{:>12}{:>10}{:>10}{:>12}{:>12}'.format(
    'pair', 'unlevered ON', 'levered ON', 'ratio', 'Sharpe', 'maxDD', 'win rate'))
print('  ' + '-' * 92)
for lev, base, what in PAIRS:
    if lev not in D or base not in D:
        continue
    # align on common dates so different histories cannot explain the ratio
    lb = {d: r for d, r in zip(D[lev]['dates'], D[lev]['on'])}
    bb = {d: r for d, r in zip(D[base]['dates'], D[base]['on'])}
    common = sorted(set(lb) & set(bb))
    lr = [lb[d] for d in common]
    br = [bb[d] for d in common]
    cl, cb = inst.cagr(lr), inst.cagr(br)
    print('  {:24}{:>12}{:>12}{:>10}{:>10}{:>12}{:>12}'.format(
        what, '{:+.2%}'.format(cb), '{:+.2%}'.format(cl),
        '{:.2f}x'.format(cl / cb) if cb else '-',
        '{:.2f}'.format(inst.sharpe(lr)), '{:.1%}'.format(inst.max_drawdown(lr)),
        '{:.1%}'.format(sum(1 for x in lr if x > 0) / len(lr))))

# ------------------------------------------------------------------ B,C,D
print('\n' + '=' * 116)
print('B/C/D. OVERLAYS ON THE OVERNIGHT SLEEVE')
print('=' * 116)


def overlay(sym, use_vol=False, use_trend=False, vol_lb=20, tgt=0.15,
            trend_n=100, bad=False):
    """Overnight returns, gated and/or sized by overlays computed from data
    strictly BEFORE the night in question."""
    d = D[sym]
    bars, ret = d['bars'], d['ret']
    on = d['on_bad'] if bad else d['on']
    vol = eng.rolling_vol(ret, vol_lb)
    closes = [b['c'] for b in bars]
    ma = eng.sma(closes, trend_n)
    out, ws = [], []
    for i in range(len(on)):
        w = 1.0
        if use_vol:
            v = vol[i - 1] if i > 0 else None
            w = 0.0 if (v is None or v <= 0) else min(1.0, (tgt / (252 ** 0.5)) / v)
        if use_trend:
            # index i of `on` corresponds to bars[i+1]; the trend must be read
            # from bars[i], which is the close BEFORE the night is entered
            m = ma[i] if i < len(ma) else None
            if m is None or closes[i] <= m:
                w = 0.0
        out.append(w * on[i])
        ws.append(w)
    return out, ws


for sym in ('VFV.TO', 'HQU.TO'):
    if sym not in D:
        continue
    print('\n  --- {} ---'.format(sym))
    print('  {:34}{:>10}{:>9}{:>9}{:>9}{:>9}{:>13}'.format(
        'variant', 'CAGR', 'Sharpe', 'maxDD', 'Calmar', 'win', '$/yr on 1k'))
    for label, kw in (
            ('plain overnight', {}),
            ('+ vol-managed (tgt15%)', {'use_vol': True}),
            ('+ trend filter (SMA100)', {'use_trend': True}),
            ('+ both overlays', {'use_vol': True, 'use_trend': True}),
            ('plain overnight, BAD FILL', {'bad': True}),
            ('+ both overlays, BAD FILL', {'use_vol': True, 'use_trend': True, 'bad': True}),
    ):
        r, w = overlay(sym, **kw)
        c = inst.cagr(r)
        mdd = inst.max_drawdown(r)
        print('  {:34}{:>10}{:>9}{:>9}{:>9}{:>9}{:>13}'.format(
            label, '{:+.2%}'.format(c), '{:.2f}'.format(inst.sharpe(r)),
            '{:.1%}'.format(mdd),
            '{:.2f}'.format(c / abs(mdd) if mdd else 0),
            '{:.1%}'.format(sum(1 for x in r if x > 0) / len(r)),
            '${:,.0f}'.format(CAPITAL * c)))

# ------------------------------------------------------------------ validation
print('\n' + '=' * 116)
print('VALIDATION OF THE BEST COMBINATION')
print('  Trials: 2 instruments x 4 overlay combinations = 8, and DSR is deflated')
print('  by that count. Alpha is measured against the UNLEVERED index, so leverage')
print('  itself cannot be mistaken for skill.')
print('=' * 116)
bench = {d: r for d, r in zip(D['ZQQ.TO']['dates'], D['ZQQ.TO']['ret'])}
for sym, label in (('HQU.TO', 'HQU overnight + both overlays'),
                   ('VFV.TO', 'VFV overnight + both overlays')):
    if sym not in D:
        continue
    for bad in (False, True):
        r, w = overlay(sym, use_vol=True, use_trend=True, bad=bad)
        b = [bench.get(d, 0.0) for d in D[sym]['dates'][:len(r)]]
        a = inst.attribution(r, b)
        dsr, sr, sr0 = inst.deflated_sharpe(r, 8)
        ci = inst.block_bootstrap_ci(r, block=21, draws=1500)
        print('\n  {} {}'.format(label, '[BAD FILL]' if bad else '[at open]'))
        print('    CAGR {:+.2%}   Sharpe {:.2f}   maxDD {:.1%}   DSR {:.3f}   exposure {:.0%}'.format(
            inst.cagr(r), inst.sharpe(r), inst.max_drawdown(r), dsr, st.mean(w)))
        if a:
            print('    alpha {:+.2%}/yr   t = {:.2f}   beta {:.2f}   IR {:.2f}'.format(
                a['alpha_ann'], a['t_alpha'], a['beta'], a['ir']))
        if ci:
            print('    on $1000:  median ${:,.0f}/yr   p5 ${:,.0f}   p95 ${:,.0f}'.format(
                CAPITAL * ci['median'], CAPITAL * ci['p5'], CAPITAL * ci['p95']))
