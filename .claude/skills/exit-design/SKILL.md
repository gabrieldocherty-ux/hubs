---
name: exit-design
description: Use when deciding when to leave a position on the Hyperliquid bot — holding periods, stop placement, profit targets, trailing stops, timeouts — or when a strategy seems to give back profit, cut winners short, or hold losers too long. Encodes the diagnostics that answer these without curve-fitting, and everything already tested and rejected here.
---

# Exit design

Entries get all the attention; exits get a number that seemed reasonable. On this
project every strategy was built entry-first and the exits (a 10-day timeout, a
2.5x ATR stop) went unexamined for weeks. When they were finally measured the stop
turned out to be well placed and every proposed improvement failed — but that was
worth establishing rather than assuming.

## The trap this skill exists to avoid

**Never tune an exit against historical P&L.** The exit determines the outcome it
would be fitted to, which makes it circular and one of the most reliable ways to
overfit a trading system. Sweeping hold lengths and keeping the best number is
exactly this error.

Instead, measure a property of the **market** and derive the exit from it. Three
diagnostics do that, and each answers a different question.

## The three diagnostics

Run each with the stop widened to ~12x ATR so trades run their course — a
stopped-out trade never reveals where it would have gone, so measuring excursion
on stopped trades only tells you about the stop.

**1. ACCRUAL CURVE — is the hold the right length?**
`research/exit_anatomy.py`. Average cumulative return by days held.
- *front-loaded* (flat after day 2-3) → hold is too long; shorten it, cut funding cost, free capital
- *linear* → hold is about right
- *back-loaded* (still climbing at exit) → possibly cutting winners, but see the survivorship warning
- *peak-then-decay* → the clearest case for an earlier exit

**2. MAE, Maximum Adverse Excursion — where does the stop belong?**
`research/mae_analysis.py`. For trades that eventually WORK, how far do they go
against you first? Put the stop just beyond the ~95th percentile of *winners'*
MAE. If winners and losers show similar MAE, no stop can separate them and the
stop is only a loss cap.

**3. MFE, Maximum Favourable Excursion — when should you leave a winner?**
`research/mfe_analysis.py`. How far does a trade run in your favour, and how much
of that peak is handed back? Also gives the MFE/MAE ratio — the reward-to-risk the
setup offers before any exit rule is applied. Below 1.0 and no exit rule saves it.

## Survivorship warning, which nearly caused a bad call here

A back-loaded accrual curve is confounded. Trades stopped out early leave the
sample, so later-day averages are computed on survivors — disproportionately
winners. S3's sample fell 202 → 166 by day 11. A win rate "rising with days held"
partly just means the losers already left. **The accrual curve is a reason to test
a longer hold, never evidence for one.** The clean test is the counterfactual: run
the whole backtest with the different exit through the normal gate.

## What has been tested here, and the results

| exit idea | result | why |
|---|---|---|
| Fixed 2.5x ATR stop | **KEPT** | 95% of winners never dip past 2.21x; 2.5x sits just beyond. The sweep is a clean unimodal peak. |
| Conditional stop by signal strength | rejected | 1 of 9 variants matched baseline, none beat it. ATR already conditions the stop on volatility. |
| Per-coin stop | rejected | MAE is 1.08-1.43x median across all four coins — ATR normalises across instruments. |
| Trailing stop from entry | rejected | Every variant below baseline, win rate 55% -> 38-45%. A cascade move is internally noisy; the trail is shaken out inside the move it is riding. |
| Longer holds (30d) | rejected | Looked dramatic (trimmed +1.49% -> +3.48%) but it was **beta, not edge**: shorts collapsed +1.38% -> -0.85% while longs exploded. Also pushed overlap with the trend family to 0.79-0.88, leaving the daily sleeve. |
| Shorter holds (36h) | rejected | Both truncated and natively rebuilt. Edge is smaller AND annual cost triples. |
| Profit targets | rejected | Tight ones are catastrophic (0.5x ATR: -234pp) because they sell the tail where the edge lives. |
| Armed trailing stop | rejected, but closest | 2 of 12 variants beat baseline, marginally (+1.60% vs +1.49%). Genuinely better than trailing from entry; not better than nothing. |

## Three principles this project earned the hard way

**1. The mechanism sets the hold, not preference.** A continuation edge needs time
to continue; a mean-reversion edge front-loads and wants a short hold. B1 (basis
reversion) holds 4.2 days because it should; S3/D1 (cascade continuation) hold 10
because cutting early exits before the thing being bet on has happened. When
someone proposes a horizon, ask what mechanism operates over it.

**2. Give-back is the price of positive skew, not a bug.** The MFE work found 66%
of trades hand back more than half their peak, and 26% of trades that reached
+1.0x ATR in profit still ended negative. That looks like a glaring inefficiency
and it is not fixable — every fix (target, trail) also sells the rare enormous
winner that carries the strategy. Measure it, understand it, do not "fix" it.

**3. A horizon must be tested with a strategy BUILT for it.** Truncating a ten-day
strategy to 36 hours measures truncation, not the horizon — every parameter in it
was scaled for the original. Rebuild natively: bar size, lookbacks, ATR period and
hold all re-derived. The native 36h build scored +0.28% trimmed where the truncated
one showed roughly zero, so the distinction is not academic.

## Procedure for any exit change

1. Run the three diagnostics first. Do not propose an exit before knowing the
   accrual shape, the MAE split and the give-back.
2. Derive the change from the diagnostic, not from a P&L sweep.
3. Run the full gate: train/test both positive, trimmed expectancy positive,
   survives 2x costs, positive in most calendar years.
4. **Check it is edge and not beta** — split long and short. If the improvement is
   long-only in a rising market, it is drift.
5. **Check the strategy has not changed identity** — measure position overlap with
   the others. A longer hold can quietly turn a daily strategy into a trend one,
   which breaks the sleeve allocation.
6. Count how many variants were tried. Two of twelve beating baseline marginally
   is noise, not a result.
7. Remember the cost asymmetry: execution cost is paid **per trade**, funding **per
   day**. Shortening the hold trades one for the other, and the arithmetic is
   rarely in favour.
