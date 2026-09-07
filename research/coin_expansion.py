"""
OUT-OF-SAMPLE TEST: do the validated strategies work on coins that had no part
in creating them?

S3, D1 and B1 were developed on BTC/ETH/SOL/HYPE. Every parameter choice, every
robustness sweep and every judgement call was made looking at those four. So
their numbers on those four are, unavoidably, partly in-sample.

XRP, FARTCOIN, WLD, SUI, AAVE and kPEPE passed a liquidity/quality screen set
before any return was looked at, and were not consulted at any point during
development. Running the IDENTICAL parameters on them is therefore the cleanest
out-of-sample test this project can run - stronger than a train/test split,
because a split still shares the same instruments.

Two things ride on the result:
  * SCIENTIFIC - if the forced-flow mechanism is a real property of a leveraged
    venue, it should not care which ticker it trades. A pass here is the best
    evidence yet that it is real. A failure means the four-coin result was
    partly a fit to those four.
  * PRACTICAL - breadth is the only lever that improves return per unit of
    risk. But it is only available if the edge actually survives.

No parameter is changed for these coins. If a coin needs its own settings, that
is not breadth, it is overfitting with extra steps.
"""
import sys, statistics as st
sys.path.insert(0, 'research')
import engine, pooled
from strategies_batch2 import volume_spike
from strategies_daily import range_breakout

ORIGINAL = ['BTC', 'ETH', 'SOL', 'HYPE']
NEW = ['XRP', 'FARTCOIN', 'WLD', 'SUI', 'AAVE', 'kPEPE']

S3P = {'vol_mult': 1.5, 'hold': 10, 'atr_mult': 2.5}
D1P = {'n': 20, 'atr_mult': 2.5, 'max_hold': 10, 'atr_ratio': 2.0}


def block(label, fn, params, coins):
    per, m = pooled.pooled(fn, params, coins, 60, name=label)
    return per, m


def show(title, fn, params):
    print('\n' + '=' * 118)
    print(title)
    print('=' * 118)
    per_o, m_o = block('orig', fn, params, ORIGINAL)
    per_n, m_n = block('new', fn, params, NEW)

    for name, per, m in (('DEVELOPED ON (in-sample)', per_o, m_o),
                         ('NEVER SEEN (out-of-sample)', per_n, m_n)):
        print('\n  {}'.format(name))
        print('  ' + pooled.describe(m, 'pooled'))
        tr, te = pooled.pooled_split(m)
        if tr and te:
            print('  ' + pooled.describe(tr, '  train'))
            print('  ' + pooled.describe(te, '  test'))
        yr = pooled.pooled_yearly(m)
        if yr:
            print('  by year: {}/{} positive   '.format(
                sum(1 for _, r in yr if r.expectancy > 0), len(yr)) +
                '  '.join('{}:{:+.1f}%(n{})'.format(y, r.expectancy * 100, r.n)
                          for y, r in yr))
        for c in (ORIGINAL if per is per_o else NEW):
            if c in per and per[c].n:
                print('    ' + pooled.describe(per[c], c))

    if m_o.n and m_n.n:
        print('\n  {:<26}{:>12}{:>12}{:>12}{:>12}'.format(
            '', 'n', 'win rate', 'expectancy', 'trimmed'))
        print('  {:<26}{:>12}{:>12}{:>12}{:>12}'.format(
            'developed on', m_o.n, '{:.1%}'.format(m_o.win_rate),
            '{:+.2f}%'.format(m_o.expectancy * 100),
            '{:+.2f}%'.format(m_o.trimmed_expectancy(0.05) * 100)))
        print('  {:<26}{:>12}{:>12}{:>12}{:>12}'.format(
            'never seen', m_n.n, '{:.1%}'.format(m_n.win_rate),
            '{:+.2f}%'.format(m_n.expectancy * 100),
            '{:+.2f}%'.format(m_n.trimmed_expectancy(0.05) * 100)))
        drop = m_n.expectancy - m_o.expectancy
        sd = st.pstdev([t.pnl_pct for t in m_o.trades] + [t.pnl_pct for t in m_n.trades])
        se = sd * ((1 / m_o.n + 1 / m_n.n) ** 0.5)
        print('  {:<26}{:>12}{:>12}{:>12}'.format(
            'difference', '', '', '{:+.2f}%'.format(drop * 100)) +
            '   ({:.1f} SE from zero)'.format(abs(drop / se) if se else 0))
    return m_o, m_n


s3o, s3n = show('S3 FORCED-FLOW CONTINUATION - identical parameters, unseen coins',
                volume_spike, S3P)
d1o, d1n = show('D1 RANGE-BREAK CASCADE - identical parameters, unseen coins',
                range_breakout, D1P)

print('\n' + '=' * 118)
print('IF IT HOLDS: what does the wider universe do to the return distribution?')
print('=' * 118)
for label, m in (('S3 on 4 coins', s3o), ('S3 on all 10', None),
                 ('D1 on 4 coins', d1o), ('D1 on all 10', None)):
    if m is None:
        continue
print('  {:<20}{:>10}{:>12}{:>12}{:>12}{:>12}'.format(
    'strategy / universe', 'n', 'trades/yr', 'expectancy', 'trimmed', 'acct CAGR'))
for label, fn, params in (('S3', volume_spike, S3P), ('D1', range_breakout, D1P)):
    for uni_label, coins in (('4 coins (today)', ORIGINAL),
                             ('10 coins', ORIGINAL + NEW)):
        _, m = block('x', fn, params, coins)
        if not m.n:
            continue
        print('  {:<20}{:>10}{:>12.0f}{:>12}{:>12}{:>12}'.format(
            '{} {}'.format(label, uni_label), m.n, m.trades_per_year(),
            '{:+.2f}%'.format(m.expectancy * 100),
            '{:+.2f}%'.format(m.trimmed_expectancy(0.05) * 100),
            '{:+.1f}%'.format(m.account_cagr(0.20) * 100)))

print("""
  A drop in per-trade expectancy is expected and fine - the new coins are less
  liquid and noisier. What matters is whether it stays clearly POSITIVE after
  costs, because breadth is bought with trade count, not with edge size.""")
