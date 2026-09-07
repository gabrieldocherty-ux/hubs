"""
The weekend hypothesis failed backwards - and the failure has a mechanism.

What the three-level test actually found:
  1. Weekends are thinner (volume 0.38-0.66x weekday) AND calmer (range
     0.54-0.78x). Thin books do not amplify moves here; both drop together.
  2. Cascade events are UNDER-represented at weekends on all four coins
     (6.2%, 10.5%, 22.4%, 20.0% against the 28.6% two-in-seven baseline).
  3. Weekend cascade trades LOSE: S3 +2.50% weekday vs -2.23% weekend.

So the prediction was wrong in direction. But there is a coherent reason, and it
is a flaw in the signal rather than a fact about weekends:

  S3 fires when volume exceeds 1.5x its trailing 20-DAY average. That window
  mixes weekdays and weekends. Since weekend volume is roughly half weekday
  volume, a Saturday needs far less absolute activity to look like a "1.5x
  spike" - so weekend signals are disproportionately FALSE cascades, spikes
  relative to a contaminated baseline rather than evidence of forced flow.

That predicts two fixes, and they are not equally good:
  A. Drop weekend entries. Crude - throws away real weekend cascades too, and
     is indistinguishable from curve-fitting a subgroup.
  B. Compare each day against a DAY-OF-WEEK-MATCHED baseline (Saturdays against
     prior Saturdays). This fixes the actual defect and should, if the diagnosis
     is right, RECOVER the good weekend trades rather than discard them.

If B works and A works, prefer B - it is a correction, not a filter. If only A
works, be suspicious: dropping a losing subgroup always "works" in-sample.
"""
import sys, datetime, statistics as st
sys.path.insert(0, 'research')
import engine, pooled

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']


def dow(ms):
    return datetime.datetime.utcfromtimestamp(ms / 1000).weekday()


def volume_spike_variant(params):
    """S3 with a selectable baseline: 'flat' (the shipped 20-bar mean) or
    'dow' (mean of the last N same-weekday bars)."""
    vol_mult, hold, atr_mult = params['vol_mult'], params['hold'], params['atr_mult']
    mode = params.get('baseline', 'flat')
    skip_weekend = params.get('skip_weekend', False)
    dow_n = params.get('dow_n', 8)

    def factory():
        state = {}

        def sig(bars, i, pos):
            if 'atr' not in state:
                state['atr'] = engine.atr_series(bars, 14)
                state['vma'] = engine.sma_series([b['v'] for b in bars], 20)
                state['dw'] = [dow(b['t']) for b in bars]
            if pos is not None:
                return {'exit': True, 'reason': 'timeout'} if i - pos['entry_i'] >= hold else None
            atr = state['atr'][i]
            if atr is None:
                return None
            today = bars[i]
            # OFF-BY-ONE, found the hard way: the engine fills at bar i+1's open,
            # so a signal generated on bar i becomes a position dated i+1. The
            # level-3 analysis bucketed trades by FILL day while the first
            # version of this filter tested the SIGNAL day - meaning "drop
            # weekend entries" silently dropped almost nothing (n fell 202->201).
            # To avoid a weekend FILL, the signal to suppress is the day before.
            if skip_weekend and i + 1 < len(bars) and dow(bars[i + 1]['t']) >= 5:
                return None

            if mode == 'flat':
                base = state['vma'][i]
            else:
                d = state['dw'][i]
                prev = [bars[k]['v'] for k in range(i - 1, max(-1, i - 8 * dow_n), -1)
                        if state['dw'][k] == d]
                if len(prev) < max(4, dow_n // 2):
                    return None
                base = sum(prev[:dow_n]) / len(prev[:dow_n])
            if not base or base <= 0 or today['v'] < vol_mult * base:
                return None

            px = today['c']
            want = 'long' if today['c'] > today['o'] else ('short' if today['c'] < today['o'] else None)
            if want is None:
                return None
            stop = px - atr_mult * atr if want == 'long' else px + atr_mult * atr
            return {'dir': want, 'stop': stop, 'target': None,
                    'reason': '{} baseline {:.1f}x'.format(mode, today['v'] / base)}
        return sig
    return factory


def report(label, params, warm=60):
    _, m = pooled.pooled(volume_spike_variant, params, COINS, warm, name=label)
    if m.n == 0:
        print('  {:<40} NO TRADES'.format(label))
        return None
    tr, te = pooled.pooled_split(m)
    yr = pooled.pooled_yearly(m)
    pos_yr = sum(1 for _, r in yr if r.expectancy > 0)
    print('  {:<40} n={:<4} wr={:>5.1%} exp={:>7.2%} trim5={:>7.2%} '
          'train={:>7.2%} test={:>7.2%} yrs={}/{} CAGR={:>6.1%}'.format(
              label, m.n, m.win_rate, m.expectancy, m.trimmed_expectancy(0.05),
              tr.expectancy if tr else 0, te.expectancy if te else 0,
              pos_yr, len(yr), m.account_cagr(0.20)))
    return m


BASE = {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}

print('=' * 124)
print('THE SHIPPED VERSION vs THE TWO CANDIDATE FIXES')
print('=' * 124)
shipped = report('S3 as shipped (flat 20d baseline)', dict(BASE))
skip = report('A: drop weekend entries', dict(BASE, skip_weekend=True))
dowb = report('B: day-of-week matched baseline', dict(BASE, baseline='dow'))
both = report('A+B: dow baseline AND skip weekends', dict(BASE, baseline='dow', skip_weekend=True))

print('\n' + '=' * 124)
print('DOES FIX B RECOVER WEEKEND TRADES, OR JUST AVOID THEM?')
print('   The diagnosis says weekend signals were FALSE cascades from a contaminated')
print('   baseline. If so, a matched baseline should make the surviving weekend')
print('   trades PROFITABLE - not merely fewer.')
print('=' * 124)
for label, m in (('shipped', shipped), ('B: dow baseline', dowb)):
    if not m:
        continue
    we = [t for t in m.trades if dow(t.entry_t) >= 5]
    wd = [t for t in m.trades if dow(t.entry_t) < 5]
    print('  {:<18} weekend n={:<4} exp={:>7.2%}   |   weekday n={:<4} exp={:>7.2%}'.format(
        label, len(we), st.mean([t.pnl_pct for t in we]) if we else 0,
        len(wd), st.mean([t.pnl_pct for t in wd]) if wd else 0))

print('\n' + '=' * 124)
print('ROBUSTNESS of whichever fix looks best (does it survive its own neighbourhood?)')
print('=' * 124)
for dn in (4, 6, 8, 12):
    report('B with dow_n={}'.format(dn), dict(BASE, baseline='dow', dow_n=dn))
for vm in (1.3, 1.75, 2.0):
    report('B with vol_mult={}'.format(vm), dict(BASE, baseline='dow', vol_mult=vm))

print('\n' + '=' * 124)
print('COST STRESS on fix B')
print('=' * 124)
for mult in (1, 2, 3):
    _, mm = pooled.pooled(volume_spike_variant, dict(BASE, baseline='dow'), COINS, 60,
                          name='b', fee=engine.TAKER_FEE * mult,
                          slippage=engine.SLIPPAGE * mult)
    if mm.n:
        print('  {}x costs: n={:<4} exp={:>7.2%} trim5={:>7.2%} CAGR={:>6.1%}'.format(
            mult, mm.n, mm.expectancy, mm.trimmed_expectancy(0.05), mm.account_cagr(0.20)))
