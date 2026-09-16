"""Attribute the BasisDislocation production/research divergence to a cause.

Compares, bar by bar, the ENTRY decision each side would make and the exit
decision each side would make, so the difference can be pinned on a specific
line rather than guessed at from a trade count.
"""
import sys
sys.path.insert(0, 'research')
sys.path.insert(0, '.')
import datetime
import pooled, hl_data
from strategies_basis import build_basis

COINS = ['BTC', 'ETH', 'SOL', 'HYPE']
SPOT = {'BTC': '@142', 'ETH': '@151', 'SOL': '@156', 'HYPE': '@107'}
PCT, WIN, MINH = 0.90, 180, 60


def d(ms):
    return datetime.datetime.utcfromtimestamp(ms / 1000).strftime('%Y-%m-%d')


def thresholds(hist):
    hs = sorted(hist)
    hi = hs[min(len(hs) - 1, int(len(hs) * PCT))]
    lo = hs[max(0, int(len(hs) * (1 - PCT)))]
    med = hs[len(hs) // 2]
    return hi, lo, med


entry_diffs = degenerate = 0
for c in COINS:
    perp, _ = pooled.load(c)
    spot, _ = hl_data.get_candles(SPOT[c], '1d', 1200)
    basis = build_basis(perp, spot)
    start = next((i for i, b in enumerate(basis) if b is not None), 0) + 60
    for i in range(start, len(basis)):
        b = basis[i]
        if b is None:
            continue
        # research window: basis[i-WIN .. i]  -> WIN+1 observations
        hr = [x for x in basis[max(0, i - WIN):i + 1] if x is not None]
        # production window: bars[-WIN:] -> WIN observations, i-WIN+1 .. i
        hp = [x for x in basis[max(0, i - WIN + 1):i + 1] if x is not None]
        if len(hr) < MINH and len(hp) < MINH:
            continue
        rdec = pdec = None
        if len(hr) >= MINH:
            hi, lo, _ = thresholds(hr)
            rdec = 'short' if b >= hi else ('long' if b <= lo else None)
        if len(hp) >= MINH:
            hi, lo, _ = thresholds(hp)
            if hi <= lo:
                degenerate += 1
                pdec = 'DEGENERATE-BLOCKED'
            else:
                pdec = 'short' if b >= hi else ('long' if b <= lo else None)
        if rdec != pdec:
            entry_diffs += 1
            print('ENTRY DIFF {} {}  basis={:+.4%}  research={}  production={}  '
                  '(|window| r={} p={})'.format(c, d(perp[i]['t']), b, rdec, pdec,
                                                len(hr), len(hp)))

print('\nentry decisions that differ: {}'.format(entry_diffs))
print('bars where production hi<=lo guard fired: {}'.format(degenerate))
