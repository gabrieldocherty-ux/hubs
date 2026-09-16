"""
RUIN SCALING - what position size does to the real book, with compounding.

HYPOTHESIS / WHY THIS EXISTS. The first principle of any risk doctrine has to be
"survive", and survival is not a slogan - it is a number. This project has two
sizing figures in play that differ by 3x: the live `base_size_usd` of $16.25
(6.5% of a $250 account, solved for a ~10%/yr median) and the hard rail
`max_position_pct_of_capital` = 20%, which is what the code would actually allow.
Conviction sizing can push one position to 2x base, i.e. 13%. Nobody has measured
what the REAL book history does at those larger sizes.

That matters because the arithmetic is one-directional: expected return scales
linearly in position size and so does drawdown, but the cost of a drawdown does
not - a -50% needs +100% to repay, a -75% needs +300%. So the honest way to
choose a size is to ask what each candidate does to the worst path the book has
actually walked, not to its average.

WHAT IS MEASURED. tail_correlation.py reconstructs a true daily mark-to-market
series for the whole four-strategy book from the real trades - real entries, real
exits including gap-through-stop fills, real funding, real costs - and replays it
through the live sleeve and net-exposure caps. That module is imported here (its
report suppressed) so this is the same money, not a re-derivation. Each day's
book P&L at the fixed $16.25 notional is converted to a return per unit of
position fraction and compounded at each candidate size:

    equity_{t+1} = equity_t * (1 + f * daily_pnl_at_16.25 / 16.25)

f = 0.065 reproduces the live configuration. Everything else is the same history
sized differently.

CAVEATS, up front. This holds the SIGNAL SET fixed at whatever the 50% net cap
accepted: it does not re-run the $10 minimum or re-derive the caps at each size,
so it isolates size alone. And it is ONE historical path over ~3 years with no
2018-style bear market, on strategies selected using that sample - so every
drawdown here is a floor on the true risk, never a ceiling.
"""
import io
import sys
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "research"))

# tail_correlation prints its whole report at import; only its reconstruction is
# wanted here, so the report is swallowed rather than printed twice.
_buf = io.StringIO()
with redirect_stdout(_buf):
    import tail_correlation as tc
    tc.load_prices()
    BOOK = tc.build_book()

POS = tc.POS            # 16.25
CAP = tc.CAPITAL        # 250.0

RES = tc.replay(BOOK, net_cap=tc.NET_CAP, sleeve_caps=True)
BOOK_PNL = {}
for tag, series in RES['pnl'].items():
    for dt, v in series.items():
        BOOK_PNL[dt] = BOOK_PNL.get(dt, 0.0) + v
DAYS = sorted(BOOK_PNL)
# Per day: the summed percentage move across every position held. This is the
# quantity that scales linearly with position size.
UNIT = [BOOK_PNL[dt] / POS for dt in DAYS]
YEARS = (DAYS[-1] - DAYS[0]).days / 365.25


def walk(f):
    """Compound the real book at position fraction f."""
    eq = peak = CAP
    maxdd = 0.0
    worst_day = 0.0
    for u in UNIT:
        r = f * u
        worst_day = min(worst_day, r)
        eq *= (1.0 + r)
        if eq <= 0.01:
            return 0.0, -1.0, worst_day
        peak = max(peak, eq)
        maxdd = min(maxdd, eq / peak - 1.0)
    return eq, maxdd, worst_day


print("=" * 104)
print("RUIN SCALING - the real four-strategy book compounded at different position sizes")
print("=" * 104)
print("  window {} .. {}   {} active days   {:.2f} years   "
      "({} trades accepted, {} skipped by caps)".format(
          DAYS[0], DAYS[-1], len(DAYS), YEARS, len(RES['accepted']),
          sum(RES['skipped'].values())))
print("  f = position notional as a fraction of CURRENT equity. 6.5% is live.")
print()
print("  {:>7} {:>10} {:>10} {:>9} {:>10} {:>11} {:>11}".format(
    "f", "$/posn*", "final eq", "CAGR", "max DD", "worst day", "recovery**"))
CANDIDATES = [0.02, 0.04, 0.065, 0.10, 0.13, 0.16, 0.20, 0.25, 0.30, 0.40, 0.50, 0.75]
rows = {}
for f in CANDIDATES:
    eq, dd, wd = walk(f)
    cagr = (eq / CAP) ** (1 / YEARS) - 1 if eq > 0 else -1.0
    rows[f] = (eq, dd, wd, cagr)
    recov = (1.0 / (1.0 + dd) - 1.0) if dd > -0.999 else None
    flag = {0.065: "  <- live base_size_usd",
            0.13: "  <- live base x the 2.0 conviction cap",
            0.20: "  <- max_position_pct_of_capital RAIL"}.get(f, "")
    print("  {:>6.1%} {:>10} {:>10} {:>9.1%} {:>10.1%} {:>11.1%} {:>11} {}".format(
        f, "${:.2f}".format(f * CAP), "${:.0f}".format(eq), cagr, dd, wd,
        "+{:.0%}".format(recov) if recov is not None else "wiped out", flag))
print("  * at the starting $250; the simulation compounds, so the dollar size moves with equity.")
print("  ** gain needed from the trough to regain the prior peak.")

print()
print("  THE SHAPE OF THE TRADE-OFF (everything relative to the live 6.5%)")
b_eq, b_dd, _, b_cagr = rows[0.065]
for f in (0.13, 0.20, 0.30, 0.40):
    eq, dd, _, cagr = rows[f]
    print("    {:>5.1%}: CAGR x{:>5.2f}   drawdown x{:>5.2f}   "
          "recovery needed +{:>4.0%} (vs +{:.0%})".format(
              f, cagr / b_cagr if b_cagr else 0, dd / b_dd,
              1 / (1 + dd) - 1 if dd > -0.999 else 99, 1 / (1 + b_dd) - 1))
print("    Return and drawdown stop scaling together: losses are taken on a book")
print("    the previous losses already shrank, so the drawdown compounds while the")
print("    return does not.")

print()
print("  WHERE THE ABSORBING STATES START")
for label, thresh in (("-20% drawdown", -0.20), ("-33% drawdown", -1 / 3),
                      ("-50% drawdown (needs 2x to recover)", -0.50),
                      ("-75% drawdown (needs 4x to recover)", -0.75)):
    hit = None
    f = 0.01
    while f <= 2.0001:
        _, dd, _ = walk(f)
        if dd <= thresh:
            hit = f
            break
        f += 0.0025
    print("    first f at which THIS history reaches {:<36} f = {}".format(
        label, "{:.2%}".format(hit) if hit else "never in this sample"))

print()
print("  THE SAME QUESTION AS A DAILY-BREAKER QUESTION")
print("  The daily loss breaker is set at 10% of capital. At each size, how many")
print("  days in this history had a mark-to-market book loss past that line?")
for f in (0.065, 0.13, 0.20, 0.30):
    n10 = sum(1 for u in UNIT if f * u <= -0.10)
    n5 = sum(1 for u in UNIT if f * u <= -0.05)
    print("    f={:>5.1%}   days past -5%: {:>3}   days past -10%: {:>3}   "
          "worst day {:>7.2%}".format(f, n5, n10, rows[f][2]))

print()
print("  WHAT THIS CANNOT SEE: one path, ~3 years, no 2018-style bear market, and")
print("  the strategies were selected on this sample. Every drawdown above is a")
print("  floor. The bootstrap figures elsewhere in this repo resample trades")
print("  independently and so destroy real losing streaks - optimistic in the same")
print("  direction, for a different reason.")
