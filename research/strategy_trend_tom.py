"""
STRATEGY 2 (trend, long/flat) and STRATEGY 3 (turn-of-month), with PBO.

Both are slow. That is deliberate and it is the point: the overnight strategy is
fast and therefore hostage to execution quality at the open, so the other two
sleeves are chosen to have the OPPOSITE failure mode - a handful of trades a year,
where a few basis points of slippage cannot decide anything.

STRATEGY 2 - TREND, LONG/FLAT
Mechanism: trends persist because information diffuses slowly through a large,
heterogeneous investor base, because institutional rebalancing is periodic rather
than continuous, and because risk-management flows (de-risking into weakness,
re-risking into strength) are themselves momentum. Long-only here is not a
compromise but a fit: the well-documented benefit of trend-following on equity
indices is mostly DEFENSIVE - it is not that it beats buy-and-hold in a bull
market, it is that it is in cash for the worst of the drawdowns. On an index that
fell 50% twice in this sample, avoiding part of that is worth a great deal.
Trials: 5 lookbacks x 2 confirmations = 10, and DSR is deflated by that count.

STRATEGY 3 - TURN OF MONTH
Mechanism: this is a FLOW effect, not a behavioural one, which is why it is worth
testing after the taxonomy work rejected so many statistical patterns. Payroll
contributions to pensions and retirement accounts arrive on a monthly calendar and
are invested mechanically. Index funds rebalance on month-end. Institutional
mandates report monthly, creating window-dressing demand into the close of the
month. These are real buyers who arrive on a schedule and are not choosing to
transact based on price - which is the "counterparty under obligation" that this
project's taxonomy says reversion and flow strategies require. Documented since
Ariel (1987) and Lakonishok & Smidt (1988), and still present in recent work.
Trials: the entry/exit window is a 2-parameter grid, counted below.

BOTH ARE SUBJECT TO THE SAME HONESTY TESTS: deflated Sharpe with the real trial
count, probability of backtest overfitting across the whole config grid, alpha
against simply owning the instrument, and cost charged on real turnover.
"""
import statistics as st
import sys

sys.path.insert(0, 'research')
import institutional as inst
import tsx_data
import tsx_engine as eng

CORE = ['VFV.TO', 'XIU.TO', 'ZQQ.TO', 'XIC.TO', 'ZEB.TO', 'HXT.TO']


def load(sym):
    bars = tsx_data.get(sym)
    return {'bars': bars, 'ret': eng.total_returns(bars),
            'dates': eng.dates(bars), 'rt': tsx_data.cost_model(sym, bars)[0]}


# ==================================================================== STRATEGY 2
def trend_weights(bars, n, confirm=1):
    """Long when the close has been above its n-day average for `confirm` days.

    The signal is computed through bar i and applied to bar i+1's return, so the
    weight series returned is already lagged - nothing here can see its own future.
    """
    closes = [b['c'] for b in bars]
    ma = eng.sma(closes, n)
    raw = []
    for i in range(len(bars)):
        if ma[i] is None:
            raw.append(0.0)
        else:
            raw.append(1.0 if closes[i] > ma[i] else 0.0)
    if confirm > 1:
        conf = []
        for i in range(len(raw)):
            w = raw[max(0, i - confirm + 1):i + 1]
            conf.append(1.0 if len(w) == confirm and all(x == 1.0 for x in w) else 0.0)
        raw = conf
    # align to the return series (which starts at bar 1) AND lag by one day
    return [raw[i] for i in range(len(bars) - 1)]


print('=' * 122)
print('STRATEGY 2: TREND, LONG/FLAT  -  long above the moving average, cash below')
print('=' * 122)

TREND_GRID = [(n, c) for n in (50, 100, 150, 200, 250) for c in (1, 3)]
print('  Configurations in the grid: {}  (this is the DSR trial count)'.format(len(TREND_GRID)))

trend_best = {}
for sym in CORE:
    d = load(sym)
    print('\n  {}   buy & hold: {:+.2%} CAGR, Sharpe {:.2f}, maxDD {:.1%}'.format(
        sym, inst.cagr(d['ret']), inst.sharpe(d['ret']), inst.max_drawdown(d['ret'])))
    print('  {:<16}{:>10}{:>9}{:>9}{:>9}{:>9}{:>10}{:>9}'.format(
        'config', 'CAGR', 'Sharpe', 'maxDD', 'Calmar', 'expo', 'trades/yr', 'DSR'))
    cfgs = {}
    for n, c in TREND_GRID:
        w = trend_weights(d['bars'], n, c)
        r = eng.run(w, d['ret'], d['rt'])
        cfgs['{}_{}'.format(n, c)] = r
        dsr, _, _ = inst.deflated_sharpe(r, len(TREND_GRID))
        print('  {:<16}{:>10}{:>9}{:>9}{:>9}{:>9}{:>10}{:>9}'.format(
            'SMA{} x{}'.format(n, c), '{:+.2%}'.format(inst.cagr(r)),
            '{:.2f}'.format(inst.sharpe(r)), '{:.1%}'.format(inst.max_drawdown(r)),
            '{:.2f}'.format(inst.cagr(r) / abs(inst.max_drawdown(r)) if inst.max_drawdown(r) else 0),
            '{:.0%}'.format(sum(w) / len(w)),
            '{:.1f}'.format(eng.turnover_per_year(w) / 2),
            '{:.3f}'.format(dsr)))
    p = inst.pbo(cfgs)
    print('  PBO across the {} configs: {}'.format(
        len(cfgs), '{:.1%}'.format(p) if p is not None else 'n/a'))
    trend_best[sym] = (d, cfgs)

# ==================================================================== STRATEGY 3
def tom_weights(dates_list, days_before=1, days_after=3):
    """Hold from `days_before` sessions before month end through `days_after`
    sessions into the new month.

    Built from the actual trading calendar in the data rather than from calendar
    arithmetic, so holidays and short months are handled by construction. The
    weight for period i is decided from the position of day i in its month, which
    is known in advance - a calendar is the one signal that genuinely involves no
    lookahead.
    """
    months = {}
    for i, d in enumerate(dates_list):
        months.setdefault(d[:7], []).append(i)
    keys = sorted(months)
    hold = set()
    for k in range(len(keys)):
        idx = months[keys[k]]
        for j in range(days_before):
            if len(idx) > j:
                hold.add(idx[-1 - j])
        if k + 1 < len(keys):
            nxt = months[keys[k + 1]]
            for j in range(days_after):
                if len(nxt) > j:
                    hold.add(nxt[j])
    return [1.0 if i in hold else 0.0 for i in range(len(dates_list))]


print('\n' + '=' * 122)
print('STRATEGY 3: TURN OF MONTH  -  hold only around the month boundary')
print('=' * 122)
TOM_GRID = [(b, a) for b in (1, 2, 3) for a in (2, 3, 4, 5)]
print('  Configurations in the grid: {}  (this is the DSR trial count)'.format(len(TOM_GRID)))

tom_best = {}
for sym in CORE:
    d = load(sym)
    print('\n  {}   buy & hold: {:+.2%} CAGR, Sharpe {:.2f}'.format(
        sym, inst.cagr(d['ret']), inst.sharpe(d['ret'])))
    print('  {:<16}{:>10}{:>9}{:>9}{:>9}{:>10}{:>9}{:>10}'.format(
        'config', 'CAGR', 'Sharpe', 'maxDD', 'expo', 'trades/yr', 'DSR', 'alpha t'))
    cfgs = {}
    for b, a in TOM_GRID:
        w = tom_weights(d['dates'], b, a)
        r = eng.run(w, d['ret'], d['rt'])
        cfgs['{}_{}'.format(b, a)] = r
        dsr, _, _ = inst.deflated_sharpe(r, len(TOM_GRID))
        at = inst.attribution(r, d['ret'])
        print('  {:<16}{:>10}{:>9}{:>9}{:>9}{:>10}{:>9}{:>10}'.format(
            '-{}d / +{}d'.format(b, a), '{:+.2%}'.format(inst.cagr(r)),
            '{:.2f}'.format(inst.sharpe(r)), '{:.1%}'.format(inst.max_drawdown(r)),
            '{:.0%}'.format(sum(w) / len(w)),
            '{:.1f}'.format(eng.turnover_per_year(w) / 2),
            '{:.3f}'.format(dsr), '{:.2f}'.format(at['t_alpha']) if at else '-'))
    p = inst.pbo(cfgs)
    print('  PBO across the {} configs: {}'.format(
        len(cfgs), '{:.1%}'.format(p) if p is not None else 'n/a'))
    tom_best[sym] = (d, cfgs)

print("""
=======================================================================================================================
READING PBO
  Probability of Backtest Overfitting is how often the configuration that wins
  IN-SAMPLE lands below the median OUT-OF-SAMPLE, across every symmetric split of
  the history. Below ~25% the parameter choice is carrying real information.
  Around 50% the selection is no better than picking at random, which means the
  'best' parameters are noise and only the AVERAGE behaviour of the grid is
  meaningful. Above 50% the search is actively anti-predictive.

  Note what PBO does NOT say: a high PBO does not mean the strategy is worthless,
  only that choosing between its parameter settings is worthless. A grid whose
  every cell is profitable with a high PBO is a robust strategy with an unpickable
  parameter - which is a perfectly good thing to trade at the middle of the range.
=======================================================================================================================""")
