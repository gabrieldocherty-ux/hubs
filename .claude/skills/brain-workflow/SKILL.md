---
name: brain-workflow
description: Use when working on Gabe's trading project or anything tracked in his Desktop/Claude-Brain vault — read the vault for context first, log work back to it, and reason about the work the way a trading desk would rather than as a single analyst. Encodes the seven roles a systematic trading operation actually needs, what each one is responsible for catching, and the failure this project suffered when each was missing.
---

# Brain workflow: the desk, not the analyst

Two things live here. The **vault protocol** (bottom) is the mechanics — where the
project's memory is and how to keep it true. The **desk** (most of this file) is
how to think about the work.

The reason the desk exists: nearly every expensive mistake in this project was
invisible from the seat that made it. The research that found a +2.34% refinement
to B1 could not see that it was a p=0.444 random subset. The sizing scheme that
looked excellent could not see it was silently skipping 90 of 202 trades. The
backtest that validated a strategy could not see that production computed it
differently. None of these were errors of intelligence. They were errors of
**vantage** — the right question existed, and nobody in the room was assigned to
ask it.

So assign it.

## The seven roles

Each role owns one question. The point is not to write dialogue in character —
that produces theatre and wastes the user's time. The point is that before
concluding anything, the questions below have each been *asked*, and any that
turn up nothing are silently dropped rather than performed.

| role | the question it owns | what it caught here |
|---|---|---|
| **Quant Researcher** | Is the effect real? | Built the taxonomy; found forced flow and basis |
| **Head of Research** (adversary) | What would make this false? | Killed basis-momentum at p=0.444 after it beat B1 on both headline metrics |
| **Risk Manager** | What does this lose when it's wrong? | Found the stop sitting beyond liquidation on 96–100% of bars |
| **Execution Trader** | Can this actually be traded at these prices? | The whole opening-range/VWAP edge was the fill assumption; the intraday cost wall |
| **Portfolio Manager** | Is this a new bet or one we already have? | S3 and D1 are 0.85–1.00 overlapped — one bet at two frequencies |
| **Production Engineer** | Does the live code do what was tested? | 211 trades vs the validated 202; the SDK that was never installed |
| **Data Steward** | Can this data answer this question at all? | 0.9 days of OI; testnet HYPE at $22.87 vs mainnet $83.93 |

### Quant Researcher — is the effect real?

Owns hypothesis, test design, and statistical honesty. **States the mechanism
before running anything**: who is forced to trade against you, and why they can't
stop. A parameter that backtested well is not a mechanism.

Evidence standard: 5% trimmed expectancy (not mean), train/test 60/40, per-year
breakdown, parameter neighbourhood, and an honest variant count. The strongest
evidence available is a **monotonic dose-response** — a stronger signal paying
more. Its absence is usually fatal and its inversion always is.

### Head of Research — what would make this false?

The adversary. Defaults to *refuted* when uncertain, because a false positive
reaching live trading costs money while a false negative costs one idea.

Standard attacks, in order of how often they land here:
1. **Is the mean carried by the tail?** Check trimmed and ex-best-3.
2. **How many variants were tried?** One winner in twenty is one winner.
3. **Is this a random subset?** If a filter discards most trades, randomisation-test
   the survivors against random subsets of the same size. This is what killed
   basis-momentum.
4. **Is the story post-hoc?** Was the mechanism stated before or after the numbers?
5. **Does the neighbourhood hold, or is it one lucky cell?**

**Speaks last during discovery, first during review.** Letting the adversary open
a discovery session kills ideas before they're specified; letting it close a
review lets a bad idea bank momentum first.

### Risk Manager — what does this lose when it's wrong?

**Has a veto and does not have to win an argument about expectancy to use it.**
This is the one asymmetry in the desk and it is deliberate: research being wrong
loses some money, risk being wrong loses the account.

Reasons from the *shape of the loss distribution*, never the mean. A 32% win rate
with all profit in the tail behaves nothing like its average. Measures what a
control **costs** as well as what it prevents — see `risk-optimization` skill for
the procedure and the five failure modes. Never relaxes a rail to make a strategy
look better; if a strategy needs a wider rail, that is a finding about the
strategy.

### Execution Trader — can this be traded at these prices?

Owns fills, spread, slippage, venue minimums, and market microstructure. The most
under-weighted seat, and the one that has decided the most verdicts here.

Its rule: **cost is certain, edge is an estimate — weight them asymmetrically.**
Concretely, what it catches:
- **Cost is per-trade, so frequency multiplies it.** 2 trades/day = 139%/yr of
  notional at the modelled 0.190%. This killed every intraday variant tested.
- **Fill assumptions smuggle in the entire edge.** The opening-range/VWAP setup
  scored +0.171% filled at VWAP and −0.121% filled at the next bar's open on the
  same trades. Always model the conservative fill; report the gap.
- **Adverse selection on resting orders.** A limit order fills precisely when
  you're wrong. A backtest that fills every limit at its limit price is fiction.
- **The $10 minimum.** Below it a trade is *skipped, not shrunk* — so any sizing
  rule that can go under it has quietly become an entry filter.
- **Venue cost asymmetry is decisive.** The same gross edge is alive on a 0.040%
  ETF round trip and dead on a 0.190% perp round trip. When an intraday idea
  fails, check whether it failed on the pattern or on the toll — they need
  different responses.

### Portfolio Manager — is this a new bet or one we already have?

Owns allocation, correlation, and capacity. **Diversifies across mechanism, not
across strategy count.** Seventeen strategies here collapse to two real bets.

Always computes position overlap against what's already running. Above ~0.6 it is
the same bet wearing a new name and adds nothing however good it looks — this is
what rejected fast-B1 (0.95–0.98) and the microstructure candidate (0.87–1.00).

Cares about **tail correlation over average correlation**. Correlations go to 1 on
exactly the days that matter, so an average is the wrong statistic for the risk
that actually ruins an account.

### Production Engineer — does the live code do what was tested?

Owns the gap between research and production, which is where silent failures live.

**A strategy that is validated in research and subtly different in production is
not a validated strategy.** Parity tests are the mechanism; when they disagree,
fix production to match the validated version — never the reverse — and comment
why, especially if the untested variant happens to score better.

Also owns: does it run at all, does it fail loudly, and does a failure leave a
trace. This project lost a week to a bot that could never have executed because
its SDK was never installed, and had a scheduled task reporting success while
exiting 120.

### Data Steward — can this data answer this question?

Asked **first**, before any analysis is designed, because it is the cheapest place
to stop. Owns provenance, coverage, alignment, and units.

Its checklist: How much history, and does it cover more than one regime? Is the
series aligned by *timestamp*, not index? Are units consistent (spot volume in
coin, perp in USD)? Is the venue the one actually traded? Are there gaps, dupes,
OHLC violations, zero-volume bars? Does a timezone or session boundary need real
rules rather than a fixed offset?

When the answer is that the data can't support the question, **say so and stop** —
"not testable yet, here is the proxy and here is what the real test needs" is a
complete and successful outcome, not a failure.

## Running the desk

**Convene by question type.** Most work needs three or four seats, not seven.

| the work | seats that must be heard |
|---|---|
| New strategy idea | Data → Researcher → Adversary → Execution → Portfolio |
| Sizing or risk change | Risk (owns it) → Execution ($10 floor) → Adversary |
| "Why did this lose money?" | Production (did it run right?) → Execution (fills) → Risk |
| Shipping to live | Production → Risk → Execution |
| Allocation change | Portfolio → Risk → Adversary |

**Resolving disagreement.** Roles have standing over their own domain: an
Execution objection about fills is not answered by a Research argument about
expectancy. When two seats genuinely conflict, **name the conflict and present
both to Gabe** rather than averaging them into a mush — the trade-off is the
information. The exception is Risk, which vetoes rather than argues.

**The failure mode to avoid.** Don't narrate a committee. Don't write "the Risk
Manager notes that…" in the response. Use the lenses to *find* things, then report
the findings plainly in one voice. If a seat has nothing to say, it says nothing.
The seven roles are a checklist against blind spots, not a cast.

## What the desk has concluded so far

Carry these forward; they're expensive and each was earned:

- **Two real bets exist here**: forced flow (continuation, microstructure) and
  basis (reversion, anchored to spot). Everything else is a variant or a rejection.
- **Reversion needs a counterparty under obligation**, not merely a number with a
  good story. Spot price works; moving averages, RSI levels, funding percentiles
  and VWAP do not.
- **Relational strategies are 0-for-4.** Four correlated majors on one venue is
  not enough breadth, and obvious relationships are what a competitor arbitrages
  first.
- **Intraday fails on cost, not on absence of structure.** Basis at 1h shows a
  clean monotonic dose-response and still loses, at +0.156% gross against a
  0.190% toll. If intraday work continues, it goes through maker-only execution.
- **A horizon must be tested with a strategy built for it.** Truncating a 10-day
  strategy to 36h tests nothing.

## Vault protocol

The vault at `Desktop/Claude-Brain` (`../Claude-Brain` from this project) is
Gabe's knowledge base, not Claude's memory. It is plain markdown on disk — no
bridge needed when running locally.

**At session start**, read `Vision.md` first (it says what is active and what is
paused — don't assume a project is live just because it exists), then the specific
`Projects/<name>.md`. Treat those as more current than your own recollection.

**While working**, edit `Projects/*.md` in place when a decision is made, a build
step lands, or something changes the project's status — the vault should reflect
current reality, not what was said once in chat. Keep `Vision.md` current when
priorities shift. Log rejected ideas as fully as accepted ones; the rejections are
most of the value and prevent re-running dead ends.

**Trading records** — applies to whatever is live, not crypto only:
- Every trade gets one `Projects/Trade-Journal.md` entry at the time it happens:
  instrument, rationale, entry/exit, stop and target placed, outcome, one-line
  lesson.
- Periodically roll durable patterns into `Projects/Lessons-Learned.md`,
  distinguishing confirmed edges from one-off outcomes. Don't assume a crypto-perp
  lesson transfers to equities without checking.
- Read `Lessons-Learned.md` before proposing any new or changed strategy.
- Notifications: under 200 characters, lead with the number that matters. Use the
  push tool where it exists; from Claude Code locally it won't, so flag it clearly
  in terminal output instead.
- Each asset class has its own regulatory and custody reality. Don't carry one
  project's venue, custody model or KYC status over to another without checking
  that project's own file.

## Working style Gabe has asked for

Don't just execute silently — convey the reasoning behind non-obvious choices and
surface trade-offs before locking them in. Report negative results as plainly as
positive ones; this is explicitly framed as a trading floor testing strategies and
finding holes, not a project that reports only wins. **Push back directly** when a
request pushes toward overfitting, excessive risk, or a shortcut — that is the
job, not an obstruction of it.
