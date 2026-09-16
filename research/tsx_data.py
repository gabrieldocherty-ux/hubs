"""
TSX-listed CAD instruments: data, and an honest estimate of what trading costs.

WHY THIS UNIVERSE AND NOT ANOTHER. The account is Wealthsimple with $1000 CAD,
and its fee schedule dictates the universe rather than preference:

  * $0 commission on Canadian AND US listed stocks and ETFs.
  * 1.5% FX conversion each way when a CAD account trades a US-listed security.
    That is a 3.0% ROUND TRIP. The best strategy this project has ever validated
    earns +1.68% per trade. US-listed securities are therefore not tradeable here
    at any frequency - the fee is nearly twice the entire edge.
  * A USD account removes the FX fee but costs $10/month. On $1000 that is $120 a
    year, 12% of capital, which is larger than any realistic annual return.
  * CAD-denominated, TSX-listed securities pay NEITHER. Zero commission, zero FX.

So the tradeable universe is TSX-listed CAD instruments, and the ONLY meaningful
cost is the bid-ask spread. This matters enormously: spread on liquid TSX ETFs
runs 1-5 basis points, against the 190 bp round trip modelled on Hyperliquid. That
is a 40-100x reduction in the cost of trading, and cost has been the binding
constraint on every fast strategy this project has tested.

Note that Canadian-listed ETFs give exposure to US and global markets without the
FX fee - VFV.TO holds the S&P 500, XQQ.TO the Nasdaq 100 - because the ETF unit
itself trades in CAD on the TSX. The FX conversion happens inside the fund at
institutional rates, not on your order.

THREE CONSTRAINTS THAT SHAPE EVERY STRATEGY BUILT ON THIS:
  1. NO SHORTING. Wealthsimple offers no conventional short selling. Every
     strategy must be long/flat, parking in cash (or CASH.TO) when out. This kills
     any market-neutral construction outright.
  2. T+1 SETTLEMENT. Sale proceeds settle one business day later. In a cash
     account that limits how often the same dollar can be recycled, which directly
     caps the frequency of a day-trading strategy. Verify against the account
     before relying on same-day reuse of proceeds.
  3. NO PATTERN DAY TRADER RULE. Canada has no equivalent of the US $25,000 PDT
     minimum, so frequent trading in a $1000 account is permitted here where it
     would be prohibited in a US margin account.

ADJUSTED PRICES. Everything is total-return adjusted using Yahoo's adjclose ratio
applied to the full OHLC. This is not cosmetic: TSX equity ETFs yield roughly 3%,
so over a 25-year sample dividends are a large fraction of total return, and an
unadjusted series would both understate returns and put a false gap at every
ex-dividend date - which would directly corrupt any overnight or gap strategy.
"""
import datetime
import json
import math
import time
from pathlib import Path

import requests

CACHE = Path(__file__).parent / 'data'
CACHE.mkdir(exist_ok=True)
UA = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
CHART = 'https://query1.finance.yahoo.com/v8/finance/chart/{}'

# The universe, with what each is for. Median dollar volume measured 2026-09-10.
UNIVERSE = {
    'XIU.TO': ('S&P/TSX 60', 'core CA equity', 192_632_144),
    'XIC.TO': ('TSX Capped Composite', 'broad CA equity', 24_197_104),
    'VFV.TO': ('S&P 500 CAD unhedged', 'core US equity', 47_522_989),
    'ZSP.TO': ('S&P 500 CAD unhedged', 'core US equity alt', 14_037_638),
    'XSP.TO': ('S&P 500 CAD-hedged', 'US equity, FX-hedged', 10_430_475),
    'XQQ.TO': ('Nasdaq 100 CAD-hedged', 'US growth', 10_952_662),
    'ZQQ.TO': ('Nasdaq 100 CAD', 'US growth unhedged', 9_027_040),
    'ZEB.TO': ('CA banks equal weight', 'CA financials', 121_906_278),
    'XFN.TO': ('TSX financials', 'CA financials broad', 8_623_314),
    'XEG.TO': ('TSX energy', 'CA energy', 51_678_955),
    'XGD.TO': ('gold miners', 'CA materials/gold', 22_115_904),
    'CGL.TO': ('gold bullion CAD-hedged', 'gold', 3_082_200),
    'ZAG.TO': ('aggregate bond', 'CA fixed income', 7_263_914),
    'XBB.TO': ('universe bond', 'CA fixed income alt', 3_488_434),
    'XRE.TO': ('REITs', 'CA real estate', 4_458_748),
    'XEF.TO': ('developed ex-NA', 'intl equity', 11_393_235),
    'XEC.TO': ('emerging markets', 'EM equity', 2_868_957),
    'HXT.TO': ('TSX 60 swap-based', 'CA equity, no distributions', 19_624_932),
    'XUT.TO': ('utilities', 'defensive', 9_778_464),
    'XMA.TO': ('materials', 'CA materials', 3_794_644),
    'XST.TO': ('consumer staples', 'defensive', 1_093_950),
    'CASH.TO': ('high-interest savings', 'the flat leg', 15_098_096),
}

# Sector sleeve for cross-sectional work. Deliberately excludes the broad-index
# names, which would otherwise dominate any ranking by being averages of the rest.
SECTORS = ['XEG.TO', 'XFN.TO', 'XGD.TO', 'XUT.TO', 'XMA.TO', 'XST.TO', 'XRE.TO', 'XIT.TO']


def fetch(sym, rng='25y', interval='1d'):
    r = requests.get(CHART.format(sym), headers=UA, timeout=30,
                     params={'interval': interval, 'range': rng, 'events': 'div,split'})
    r.raise_for_status()
    res = r.json()['chart']['result'][0]
    ts = res['timestamp']
    q = res['indicators']['quote'][0]
    adj = None
    if 'adjclose' in res['indicators']:
        adj = res['indicators']['adjclose'][0]['adjclose']
    out = []
    for i, t in enumerate(ts):
        o, h, l, c = q['open'][i], q['high'][i], q['low'][i], q['close'][i]
        v = q['volume'][i]
        if None in (o, h, l, c) or c <= 0:
            continue
        # Apply the adjclose/close ratio to the WHOLE bar. Adjusting only the
        # close would leave open, high and low on the raw scale, so every
        # close-to-open calculation would silently absorb the dividend as a gap.
        ratio = (adj[i] / c) if (adj and adj[i]) else 1.0
        out.append({'t': t * 1000, 'd': datetime.date.fromtimestamp(t).isoformat(),
                    'o': o * ratio, 'h': h * ratio, 'l': l * ratio, 'c': c * ratio,
                    'raw_c': c, 'v': float(v or 0)})
    out.sort(key=lambda b: b['t'])
    return out


def get(sym, rng='25y', refresh=False):
    path = CACHE / 'tsx_{}_{}.json'.format(sym.replace('.', '_'), rng)
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    bars = fetch(sym, rng)
    path.write_text(json.dumps(bars))
    time.sleep(0.35)
    return bars


def verify(bars, sym='?'):
    """Say what is wrong with the data before inferring anything from it."""
    rep = {'sym': sym, 'n': len(bars), 'ohlc_bad': 0, 'zero_vol': 0,
           'dupes': 0, 'big_gaps': 0}
    seen = set()
    prev = None
    for b in bars:
        if b['d'] in seen:
            rep['dupes'] += 1
        seen.add(b['d'])
        if not (b['l'] <= b['o'] <= b['h'] and b['l'] <= b['c'] <= b['h']):
            rep['ohlc_bad'] += 1
        if b['v'] <= 0:
            rep['zero_vol'] += 1
        if prev and prev['c'] > 0 and abs(b['c'] / prev['c'] - 1) > 0.25:
            rep['big_gaps'] += 1          # >25% day: real crash, or a bad print
        prev = b
    if bars:
        rep['first'], rep['last'] = bars[0]['d'], bars[-1]['d']
        rep['years'] = len(bars) / 252.0
    return rep


# --------------------------------------------------------------------- cost model
def corwin_schultz(bars, window=None):
    """Estimate the effective bid-ask spread from daily high/low prices.

    Corwin & Schultz (2012), "A Simple Way to Estimate Bid-Ask Spreads from Daily
    High and Low Prices", Journal of Finance. The intuition is that the high-low
    range over ONE day reflects both true volatility and the spread, while the
    range over TWO days reflects twice the volatility but still only one spread -
    so the two can be separated.

    This is used instead of assuming a spread number because assuming one is
    exactly the sort of unexamined input that has decided verdicts wrongly in this
    project. It is an estimator with known bias (it runs somewhat high on very
    liquid names, which is the conservative direction for us), not a measurement,
    and it is labelled as such wherever it is reported.
    """
    k = 3 - 2 * math.sqrt(2)
    est = []
    for i in range(1, len(bars)):
        a, b = bars[i - 1], bars[i]
        if min(a['l'], b['l']) <= 0:
            continue
        b1 = math.log(a['h'] / a['l']) ** 2 + math.log(b['h'] / b['l']) ** 2
        h2 = max(a['h'], b['h'])
        l2 = min(a['l'], b['l'])
        g = math.log(h2 / l2) ** 2
        alpha = (math.sqrt(2 * b1) - math.sqrt(b1)) / k - math.sqrt(g / k)
        s = 2 * (math.exp(alpha) - 1) / (1 + math.exp(alpha))
        est.append(max(0.0, s))           # negative estimates are noise -> zero
    if not est:
        return 0.0
    if window:
        est = est[-window:]
    # Standard CS application: average WITHIN a month, then take the median across
    # months. Taking a plain median across days returns exactly 0.0 on liquid ETFs
    # because more than half the daily estimates come out negative and clamp to
    # zero - which silently hands the whole cost assumption to whatever floor is
    # applied afterwards. Averaging first keeps the positive signal.
    monthly = []
    for i in range(0, len(est), 21):
        chunk = est[i:i + 21]
        if chunk:
            monthly.append(sum(chunk) / len(chunk))
    if not monthly:
        return 0.0
    monthly.sort()
    return monthly[len(monthly) // 2]


TICK = 0.01          # TSX minimum price increment for securities above $0.50


SAFETY = 2.0         # model roughly twice realistic cost, as this project does
                     # everywhere else (Hyperliquid: 190bp modelled, 100bp measured)


def cost_model(sym, bars, dollar_vol=None, lookback=504):
    """Round-trip cost as a fraction of notional. Spread only - commission at
    Wealthsimple is genuinely $0 on TSX-listed securities. A marketable buy lifts
    the ask and a marketable sell hits the bid, so a round trip is one full spread.

    CORWIN-SCHULTZ IS NOT USED FOR THE COST NUMBER, AND THAT IS DELIBERATE. It was
    implemented first because estimating the spread beats assuming it, but on this
    universe it fails in a known and well-documented way: CS cannot separate
    overnight volatility from the spread, so on instruments whose spread is tiny
    relative to their volatility it attributes the volatility to the spread. It
    returns ~20bp for XIU.TO, an ETF trading $193M a day whose quote is one cent
    wide on a $53 unit - a true spread of 1.9bp. It is out by an order of
    magnitude, in the direction that would make every fast strategy look
    unprofitable. It is still computed and reported alongside, because an
    estimator that failed for a stateable reason is worth showing rather than
    quietly dropping.

    What is used instead is built from the TICK, which is a hard physical bound:
    the spread cannot be narrower than one cent. Width in ticks is then set by
    liquidity, and the whole thing is doubled for safety.

    The important consequence is that cost here is driven by PRICE, not by how
    good the ETF is. VFV.TO at $187 floors at 0.5bp while ZAG.TO at $13.44 floors
    at 7.4bp - so the identical strategy is 14x more expensive on the cheaper
    unit. When two ETFs track the same thing, the higher-priced one is materially
    cheaper to trade, and that is a real and often-missed selection criterion.
    """
    px = bars[-1]['raw_c'] if bars else 1.0        # ticks apply to the QUOTED price
    tick_floor = TICK / max(px, 0.01)
    dv = dollar_vol if dollar_vol is not None else UNIVERSE.get(sym, (None, None, 0))[2]
    if dv >= 20_000_000:
        ticks = 1.0
    elif dv >= 5_000_000:
        ticks = 1.5
    else:
        ticks = 2.5
    rt = tick_floor * ticks * SAFETY
    cs = corwin_schultz(bars[-lookback:] if lookback else bars)
    return rt, cs, tick_floor


if __name__ == '__main__':
    print('{:10} {:24} {:>5} {:>6} {:>8} {:>9} {:>9} {:>9} {:>7}'.format(
        'symbol', 'what', 'yrs', 'bars', 'price', 'CS est', 'tick fl', 'RT cost', 'data'))
    print('-' * 100)
    for sym, (what, _role, _dv) in UNIVERSE.items():
        try:
            bars = get(sym)
        except Exception as e:
            print('{:10} FETCH FAILED {}'.format(sym, e))
            continue
        rep = verify(bars, sym)
        rt, cs, tick = cost_model(sym, bars)
        issues = []
        if rep['ohlc_bad']:
            issues.append('ohlc{}'.format(rep['ohlc_bad']))
        if rep['dupes']:
            issues.append('dup{}'.format(rep['dupes']))
        if rep['big_gaps']:
            issues.append('gap{}'.format(rep['big_gaps']))
        print('{:10} {:24} {:>5.1f} {:>6} {:>8} {:>9} {:>9} {:>9} {:>7}'.format(
            sym, what[:24], rep.get('years', 0), rep['n'],
            '{:.2f}'.format(bars[-1]['raw_c']),
            '{:.1f}bp'.format(cs * 10_000), '{:.1f}bp'.format(tick * 10_000),
            '{:.1f}bp'.format(rt * 10_000), ','.join(issues) or 'ok'))

    print("""
  RT cost is a full round trip in basis points, spread only - commission is
  genuinely zero here. Compare to the 190bp modelled on Hyperliquid: this venue is
  roughly 20-60x cheaper to trade, which is precisely the constraint that killed
  every fast strategy tested against the perp venue.

  Corwin-Schultz is an ESTIMATOR, not a measurement, and it is known to run high
  on very liquid names. Running high is the conservative direction, so no result
  below is flattered by it - but any strategy whose verdict flips on a 1bp change
  in this number should be treated as undecided rather than validated.""")
