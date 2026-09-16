"""
Audit the LIVE risk system against the written doctrine.

HYPOTHESIS being tested: the rails in core/risk_manager.py are stated as
account-wide guarantees, but the process model they run under changed on
2026-09-07 - scheduled_cycle.py now invokes main.main() five times per hour,
once per strategy, each in its own `--book` namespace. Every rail whose input is
computed per-invocation therefore measures a fraction of the book, and every
rail whose state lives in memory is reconstructed from nothing every hour.

If that is true, the controls that are documented as the account's protection
are not enforcing what the documentation says they enforce. This script does not
argue that from reading the code; it instantiates the real objects, drives them
the way scheduled_cycle.py drives them, and reports what the rails actually
return.

Nothing here writes to live state - it uses a temp positions file.
"""
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from core.circuit_breaker import CircuitBreaker
from core.kelly import KellySizer, TradeOutcome
from core.paper_account import PaperTradingClient

CAPITAL = 250.0
POS = 16.25

print("=" * 74)
print("A. DAILY-LOSS CIRCUIT BREAKER UNDER THE REAL PROCESS MODEL")
print("=" * 74)
# scheduled_cycle.py -> main.main() constructs CircuitBreaker fresh (main.py:127)
# and _save_cycle_state (main.py:255) persists only last_bar_time /
# cycles_since_report / position_bars_held. Nothing reads or writes breaker state.
b1 = CircuitBreaker(daily_loss_limit_pct=0.10)
b1.record_realized_pnl(pnl=-30.0, current_capital=CAPITAL)   # -12% of 250
print("hour 1: realized -$30.00 on $250 (-12%)  -> tripped={} can_trade={}".format(
    b1.tripped, b1.can_trade(CAPITAL - 30)))

b2 = CircuitBreaker(daily_loss_limit_pct=0.10)                # what hour 2 builds
print("hour 2: brand-new breaker object       -> tripped={} can_trade={}".format(
    b2.tripped, b2.can_trade(CAPITAL - 30)))

# and even in one process, each of the five strategy invocations gets its own
breakers = [CircuitBreaker(daily_loss_limit_pct=0.10) for _ in range(5)]
for br in breakers[:1]:
    br.record_realized_pnl(pnl=-30.0, current_capital=CAPITAL)
print("same hour, 5 strategy invocations      -> tripped flags = {}".format(
    [br.tripped for br in breakers]))

# UTC rollover auto-reset (circuit_breaker.py:23-30) even within one process
b3 = CircuitBreaker(daily_loss_limit_pct=0.10)
b3.record_realized_pnl(pnl=-30.0, current_capital=CAPITAL)
b3.day_start_date = "1999-01-01"        # force the rollover branch
print("after a UTC date rollover              -> can_trade={} (no manual reset called)".format(
    b3.can_trade(CAPITAL - 30)))

print()
print("=" * 74)
print("B. NET-EXPOSURE AND SLEEVE RAILS ACROSS THE FIVE-BOOK DEPLOYMENT")
print("=" * 74)
tmp = Path(tempfile.mkdtemp()) / "positions.json"


class _Client(PaperTradingClient):
    """PaperTradingClient without the network call in __init__."""

    def __init__(self, state_file):
        self.state_file = str(state_file)
        self.starting_capital = CAPITAL
        self._open = {}


c = _Client(tmp)
# The exact live book from scheduled_cycle.py:103-109, all long (a correlated
# cascade day - the scenario the net cap was measured for).
BOOK = [
    ("s3", "daily", ["BTC", "ETH", "SOL", "HYPE"]),
    ("d1", "daily", ["BTC", "ETH", "SOL", "HYPE"]),
    ("b1", "daily", ["BTC", "ETH", "HYPE"]),
    ("m3", "macro", ["BTC", "ETH", "SOL", "HYPE"]),
    ("",   "macro", ["BTC", "ETH", "SOL"]),        # adaptive_trend, no book
]
for book, sleeve, coins in BOOK:
    for coin in coins:
        c.open_paper_position(coin, True, POS / 100.0, 100.0, 95.0, None,
                              sleeve=sleeve, book=book)

import main as bot


class _FakeStrategy:
    def __init__(self, sleeve):
        self.sleeve = sleeve


true_gross = sum(p["size"] * p["entry_price"] for p in c._open.values())
true_net = sum(p["size"] * p["entry_price"] * (1 if p["is_long"] else -1)
               for p in c._open.values())
true_daily = sum(p["size"] * p["entry_price"] for p in c._open.values()
                 if p["sleeve"] == "daily")
true_macro = sum(p["size"] * p["entry_price"] for p in c._open.values()
                 if p["sleeve"] == "macro")

print("book on disk: {} positions, ALL LONG".format(len(c._open)))
print("  TRUE gross notional        ${:7.2f}  ({:.0%} of capital)".format(
    true_gross, true_gross / CAPITAL))
print("  TRUE net directional       ${:7.2f}  ({:.0%} of capital, cap is 50%)".format(
    true_net, true_net / CAPITAL))
print("  TRUE daily-sleeve notional ${:7.2f}  ({:.0%}, cap is 75%)".format(
    true_daily, true_daily / CAPITAL))
print("  TRUE macro-sleeve notional ${:7.2f}  ({:.0%}, cap is 25%)".format(
    true_macro, true_macro / CAPITAL))
print()
print("what each invocation's rails actually SEE:")
for book, sleeve, coins in BOOK:
    state = {coin: {"strategy": _FakeStrategy(sleeve)} for coin in coins}
    seen_net = bot._net_exposure(c, coins)
    seen_sleeve = bot._sleeve_exposure(c, state, sleeve)
    seen_gross = c.total_position_notional()
    print("  book={:<4} sleeve={:<6} net seen ${:6.2f} | sleeve seen ${:6.2f} "
          "| gross seen ${:7.2f}".format(
              book or "(none)", sleeve, seen_net, seen_sleeve, seen_gross))

print()
print("=" * 74)
print("C. KELLY: DOES ANY UNCERTAINTY ADJUSTMENT ACTUALLY REACH A SIZE?")
print("=" * 74)
k = KellySizer(kelly_fraction=0.25, min_edge=0.02, max_size_multiplier=2.0)
print("fresh sizer (what every hourly run builds): has_enough_data={} size=${:.2f}".format(
    k.has_enough_data(), k.size_trade(CAPITAL, POS)))
# feed a realistic S3 record: 55% win rate, +1.80%/trade mean on $16.25
for i in range(30):
    win = (i % 20) < 11
    k.record_outcome(TradeOutcome(win, POS * (0.045 if win else -0.030)))
p, aw, al = k._stats()
edge_dollars = p * aw - (1 - p) * al
print("after 30 trades at S3's real shape: p={:.2f} avg_win=${:.3f} avg_loss=${:.3f}".format(
    p, aw, al))
print("  edge computed by kelly.py           = ${:.4f}   (DOLLARS)".format(edge_dollars))
print("  min_edge it is compared against     = {:.4f}    (read as a FRACTION elsewhere)".format(0.02))
print("  gate passes? {}".format(edge_dollars >= 0.02))
print("  kelly fraction of capital = {:.4f}  -> size ${:.2f}".format(
    k.kelly_fraction_of_capital(), k.size_trade(CAPITAL, POS)))
# same edge shape, position size 10x smaller -> same statistical edge, different gate
k2 = KellySizer(kelly_fraction=0.25, min_edge=0.02, max_size_multiplier=2.0)
for i in range(30):
    win = (i % 20) < 11
    k2.record_outcome(TradeOutcome(win, 1.625 * (0.045 if win else -0.030)))
p2, aw2, al2 = k2._stats()
print("  IDENTICAL edge at 1/10th notional   -> edge ${:.4f}, gate passes? {}".format(
    p2 * aw2 - (1 - p2) * al2, (p2 * aw2 - (1 - p2) * al2) >= 0.02))

print()
print("=" * 74)
print("D. WHAT CAPITAL DO THE %-OF-CAPITAL RAILS MEASURE AGAINST?")
print("=" * 74)
print("PaperTradingClient.account_value() = starting + REALIZED only "
      "(paper_account.py:75-77)")
print("  -> {} open positions at ${:.2f}, book down 20% unrealized:".format(
    len(c._open), POS))
print("     reported capital ${:.2f}; true equity ${:.2f}".format(
    CAPITAL, CAPITAL - 0.20 * true_gross))
print("     every %-of-capital rail is computed off the first number.")

print()
print("=" * 74)
print("E. SHAPE OF THE LOSS DISTRIBUTION vs WHAT SIZING USES")
print("=" * 74)
lib = json.loads((ROOT / "research" / "strategy_results.json").read_text())
rows = lib if isinstance(lib, list) else lib.get("strategies", lib)
print("(strategy_results.json keys: {})".format(
    list(rows[0].keys())[:12] if isinstance(rows, list) and rows else list(rows)[:12]))
