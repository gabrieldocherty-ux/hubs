"""
Forward collector for a Polymarket calibration study.

WHY THIS EXISTS. The one edge that plausibly survives on a prediction market is
CALIBRATION - whether contracts priced at 5% actually resolve YES 5% of the time.
Favourite-longshot bias says they do not: retail buyers systematically overpay for
lottery-shaped payoffs, so longshots are dear and favourites cheap. That is a real
behavioural mechanism with a real counterparty, which is the only kind this
project's taxonomy has ever found to work.

It cannot be backtested. Three separate probes established that Polymarket's
/prices-history returns nothing for resolved markets at any fidelity, with or
without explicit timestamps, and /batch-prices-history returns HTTP 400. Resolved
markets keep their settled outcome but their quotes have converged to 0 or 1, so
they say nothing about what the market believed beforehand. Measuring calibration
retrospectively is therefore impossible, and any claim to have done it would be
fabricated.

So this collects forward. Snapshot the live price of every open market now, wait
for resolution, then join price to outcome. It is exactly the pattern this project
already used for Hyperliquid open interest, which that venue also refused to serve
historically - and the lesson from that one is worth repeating: every day not
collecting is a row that can never be recovered later.

WHAT IS RECORDED AND WHY EACH FIELD EARNS ITS PLACE:
  price at several horizons  the bias is expected to be strongest far from
                             resolution, when the lottery framing dominates, and
                             to decay as the outcome becomes obvious
  days to resolution         lets calibration be measured per horizon bucket
  volume and liquidity       a bias concentrated in illiquid markets is untradeable
  spread                     the cost of acting on any mispricing found
  category/tag               politics, sport and crypto may be differently biased
  negRisk                    mutually-exclusive events behave differently

HOW IT WILL BE ANALYSED once resolutions accumulate: bucket every observation by
its price at the time, then compare the bucket's mean price to the realised
frequency of YES within it. A 45-degree line means the market is calibrated and
there is no edge. A line below the diagonal at the low end means longshots are
overpriced - and the trade is to sell them, subject to the capital-lockup
arithmetic that already killed the arbitrage idea.

MINIMUM BEFORE ANY CLAIM: several hundred RESOLVED observations per price bucket.
Below that the confidence interval on a frequency swamps any plausible bias.
"""
import datetime
import json
import sys
from pathlib import Path

sys.path.insert(0, 'research')
import polymarket_data as pm

DATA = Path(__file__).parent.parent / 'data'
DATA.mkdir(exist_ok=True)
SNAP = DATA / 'poly_snapshots.jsonl'
RESOLVED = DATA / 'poly_resolved.jsonl'


def snapshot(min_volume=1000, pages=12):
    """Record one observation per open market. Idempotent per day: re-running on
    the same day appends a second row, which is harmless - the analysis treats
    each row as one observation keyed by (market id, timestamp)."""
    now = datetime.datetime.now(datetime.timezone.utc)
    mk = pm.fetch_open_markets(pages=pages, min_volume=min_volume)
    rows = []
    for m in mk:
        bid, ask, last = pm.best_prices(m)
        if bid is None and ask is None and last is None:
            continue
        mid = None
        if bid is not None and ask is not None:
            mid = (bid + ask) / 2.0
        elif last is not None:
            mid = last
        d = pm.days_to_resolution(m, now)
        rows.append({
            'ts': now.isoformat(timespec='seconds'),
            'id': m.get('id'),
            'q': (m.get('question') or '')[:160],
            'bid': bid, 'ask': ask, 'last': last, 'mid': mid,
            'spread': (ask - bid) if (bid is not None and ask is not None) else None,
            'days': round(d, 2) if d is not None else None,
            'end': (m.get('endDate') or '')[:10],
            'vol': float(m.get('volumeNum') or 0),
            'liq': float(m.get('liquidityNum') or 0),
            'negRisk': bool(m.get('negRisk')),
            'slug': m.get('slug'),
        })
    with SNAP.open('a', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r) + '\n')
    return rows


def harvest():
    """Find snapshots whose market has since resolved, and record the outcome.

    Only markets that are BOTH closed and carry a settled outcomePrices are
    recorded - a closed-but-unresolved market (under UMA dispute, say) would
    otherwise be joined against a meaningless price.
    """
    if not SNAP.exists():
        return 0, 0
    seen_ids = set()
    for line in SNAP.open(encoding='utf-8'):
        try:
            seen_ids.add(json.loads(line)['id'])
        except Exception:
            pass
    done = set()
    if RESOLVED.exists():
        for line in RESOLVED.open(encoding='utf-8'):
            try:
                done.add(json.loads(line)['id'])
            except Exception:
                pass
    pending = [i for i in seen_ids if i and i not in done]
    found = 0
    with RESOLVED.open('a', encoding='utf-8') as f:
        for mid in pending:
            m = pm._get(pm.GAMMA + '/markets/' + str(mid))
            if not isinstance(m, dict) or not m.get('closed'):
                continue
            op = pm.parse_json_field(m.get('outcomePrices'))
            outs = pm.parse_json_field(m.get('outcomes'))
            if not op or not outs:
                continue
            try:
                yes_idx = [i for i, o in enumerate(outs) if str(o).lower() == 'yes']
                idx = yes_idx[0] if yes_idx else 0
                settled = float(op[idx])
            except (ValueError, IndexError, TypeError):
                continue
            if settled not in (0.0, 1.0):
                continue          # not cleanly settled - skip rather than guess
            f.write(json.dumps({'id': mid, 'settled': settled,
                                'closedTime': m.get('closedTime'),
                                'q': (m.get('question') or '')[:160]}) + '\n')
            found += 1
    return len(pending), found


def status():
    snaps = sum(1 for _ in SNAP.open(encoding='utf-8')) if SNAP.exists() else 0
    res = sum(1 for _ in RESOLVED.open(encoding='utf-8')) if RESOLVED.exists() else 0
    ids = set()
    if SNAP.exists():
        for line in SNAP.open(encoding='utf-8'):
            try:
                ids.add(json.loads(line)['id'])
            except Exception:
                pass
    return {'snapshots': snaps, 'unique_markets': len(ids), 'resolved': res}


def calibration():
    """Join snapshots to outcomes and report calibration by price bucket.

    Prints nothing useful until resolutions accumulate. That is expected and is
    stated in the output rather than hidden behind an empty table.
    """
    if not (SNAP.exists() and RESOLVED.exists()):
        print('  nothing collected yet - run snapshot() daily, then harvest()')
        return
    out = {}
    for line in RESOLVED.open(encoding='utf-8'):
        try:
            r = json.loads(line)
            out[r['id']] = r['settled']
        except Exception:
            pass
    buckets = {}
    for line in SNAP.open(encoding='utf-8'):
        try:
            s = json.loads(line)
        except Exception:
            continue
        if s['id'] not in out or s.get('mid') is None:
            continue
        p = s['mid']
        b = min(int(p * 20), 19)          # 5-cent buckets
        buckets.setdefault(b, []).append((p, out[s['id']]))
    if not buckets:
        print('  snapshots exist but none have resolved yet')
        return
    print('  {:>14}{:>8}{:>14}{:>14}{:>14}'.format(
        'price bucket', 'n', 'mean price', 'actual YES%', 'bias'))
    print('  ' + '-' * 64)
    for b in sorted(buckets):
        rows = buckets[b]
        mp = sum(p for p, _ in rows) / len(rows)
        act = sum(o for _, o in rows) / len(rows)
        print('  {:>14}{:>8}{:>14}{:>14}{:>14}'.format(
            '{:.2f}-{:.2f}'.format(b / 20, (b + 1) / 20), len(rows),
            '{:.3f}'.format(mp), '{:.3f}'.format(act), '{:+.3f}'.format(act - mp)))
    print("""
  'bias' negative at the low end = longshots resolve YES LESS often than their
  price implies = they are overpriced = the favourite-longshot bias is present.
  Do not act on any bucket with fewer than a few hundred observations.""")


EXPIRY = DATA / 'poly_expiry_ticks.jsonl'


def expiry_watch(max_hours=2.0, coins_only=True):
    """High-frequency sampling of markets about to resolve.

    This exists to test one specific hypothesis: that a contract trading around
    0.80 shortly before expiry resolves YES more often than 0.80 implies. That is
    the favourite-longshot bias, which the wagering literature reports as
    STRONGEST close to the event - and near expiry is also where a contract's true
    probability is most precisely computable, because the remaining uncertainty is
    just a few minutes of price movement.

    Sampling has to be frequent here. The daily snapshot is useless for this: the
    whole question concerns the final minutes, and a once-a-day observation will
    essentially never land in them. Run this every minute or two while short-dated
    markets are open.

    What makes the test possible at all is that CRYPTO markets carry their own
    ground truth. The fair value of "BTC above $X in N minutes" follows from BTC's
    minute-by-minute move distribution (see poly_expiry.py), so each observation
    can be scored against a computed fair value rather than only against the
    eventual outcome - which means the data starts being informative far sooner.
    """
    now = datetime.datetime.now(datetime.timezone.utc)
    mk = pm.fetch_expiring_soon(max_hours=max_hours)
    rows = []
    for m in mk:
        d = pm.days_to_resolution(m, now)
        if d is None or d <= 0 or d * 24 > max_hours:
            continue
        q = (m.get('question') or '')
        if coins_only and not any(c in q.lower() for c in
                                  ('bitcoin', 'btc', 'ethereum', 'solana')):
            continue
        bid, ask, last = pm.best_prices(m)
        if bid is None and ask is None:
            continue
        rows.append({
            'ts': now.isoformat(timespec='seconds'),
            'id': m.get('id'), 'q': q[:160],
            'bid': bid, 'ask': ask, 'last': last,
            'mins_left': round(d * 24 * 60, 2),
            'group': m.get('groupItemTitle'),
            'vol': float(m.get('volumeNum') or 0),
            'end': m.get('endDate'),
        })
    if rows:
        with EXPIRY.open('a', encoding='utf-8') as f:
            for r in rows:
                f.write(json.dumps(r) + '\n')
    return rows


def expiry_report():
    """Calibration by price bucket, restricted to observations near expiry.

    THE table for the hypothesis. If the 0.75-0.85 bucket resolves YES materially
    more often than its mean price, favourites are underpriced near expiry and the
    trade is to buy them.
    """
    if not EXPIRY.exists():
        print('  no expiry ticks collected yet - run: poly_collector.py expiry')
        return
    out = {}
    if RESOLVED.exists():
        for line in RESOLVED.open(encoding='utf-8'):
            try:
                r = json.loads(line)
                out[r['id']] = r['settled']
            except Exception:
                pass
    buckets = {}
    ticks = 0
    for line in EXPIRY.open(encoding='utf-8'):
        try:
            s = json.loads(line)
        except Exception:
            continue
        ticks += 1
        if s['id'] not in out:
            continue
        p = s.get('last') or s.get('bid')
        if p is None:
            continue
        b = min(int(p * 10), 9)
        buckets.setdefault(b, []).append((p, out[s['id']], s['mins_left']))
    print('  expiry ticks recorded: {}   resolved and joinable: {}'.format(
        ticks, sum(len(v) for v in buckets.values())))
    if not buckets:
        print('  nothing resolved yet - the hypothesis cannot be judged until it has')
        return
    print('\n  {:>14}{:>8}{:>13}{:>13}{:>12}{:>12}'.format(
        'price bucket', 'n', 'mean price', 'actual YES%', 'bias', 'avg mins'))
    print('  ' + '-' * 72)
    for b in sorted(buckets):
        rows = buckets[b]
        mp = sum(p for p, _, _ in rows) / len(rows)
        act = sum(o for _, o, _ in rows) / len(rows)
        mins = sum(m for _, _, m in rows) / len(rows)
        print('  {:>14}{:>8}{:>13}{:>13}{:>12}{:>12}'.format(
            '{:.1f}-{:.1f}'.format(b / 10, (b + 1) / 10), len(rows),
            '{:.3f}'.format(mp), '{:.3f}'.format(act),
            '{:+.3f}'.format(act - mp), '{:.1f}'.format(mins)))
    print("""
  POSITIVE bias in the high buckets = favourites underpriced near expiry = the
  hypothesis holds and buying them is the trade. NEGATIVE bias in the low buckets
  = longshots overpriced, the same effect seen from the other end.
  Do not act on any bucket with fewer than a few hundred observations: at these
  prices the confidence interval on a frequency is wider than any plausible edge.""")


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'snapshot'
    if cmd == 'expiry':
        rows = expiry_watch()
        print('recorded {} near-expiry ticks'.format(len(rows)))
        for r in rows[:8]:
            print('  {:54} {:>7} min  bid={} ask={}'.format(
                r['q'][:54], r['mins_left'], r['bid'], r['ask']))
        raise SystemExit(0)
    if cmd == 'expiry-report':
        expiry_report()
        raise SystemExit(0)
    if cmd == 'snapshot':
        rows = snapshot()
        print('recorded {} observations'.format(len(rows)))
        print('status: {}'.format(status()))
    elif cmd == 'harvest':
        pending, found = harvest()
        print('checked {} markets, {} newly resolved'.format(pending, found))
        print('status: {}'.format(status()))
    elif cmd == 'status':
        print(status())
    elif cmd == 'calibration':
        calibration()
    else:
        print('usage: poly_collector.py [snapshot|harvest|status|calibration]')
