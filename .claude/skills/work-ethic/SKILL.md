---
name: work-ethic
description: Use whenever Claude has an extended unattended stretch on this project - overnight, a long /loop, a scheduled task, or any explicit "work on this while I'm away." Encodes what working hard means here: unattended time is for doing MORE, not less, by deploying agents in parallel across every open thread rather than grinding one thread serially - without lowering the rigor bar just because nobody's watching.
---

# Work ethic: what unattended time is for

The failure mode this guards against: an hourly or overnight run defaults to the
smallest defensible amount of work - one research thread, a fixed 15-minute
budget, whatever the last invocation did - because there's no one in the room to
ask for more. That's backwards. Unattended time is the *cheapest* time this
project has. The question every unattended session should ask isn't "did I hit
the budget," it's "what did I leave on the table that a second pair of hands
could have picked up."

## The default is wrong for anything longer than an hour

A single hourly cycle (see `.claude/scheduled-tasks/hyperliquid-hourly-brief`)
correctly does one thing well: report what changed, advance one thread, log it.
That's the right shape for 15 minutes between other work.

It is the wrong shape for overnight, a multi-hour `/loop`, or "grind on this
while I'm asleep." In that setting, doing one thread and stopping wastes
everything after the first fifteen minutes. The fix is not a longer single
thread - depth on one idea plateaus fast, and this project's own standards
(mechanism first, train/test split, 5% trimmed expectancy, overlap check, 2-4x
cost stress) apply per-idea, not per-hour. The fix is **breadth via parallel
agents**, each running the same rigor independently.

## How to actually deploy agents here

1. **Survey the backlog before spawning anything.** Pull every open thread: the
   "Strategies available but not live" caveats in `CLAUDE.md`, the open
   questions flagged in recent `Crypto-Trading.md` vault entries, and the
   scheduled task's own open-thread list. Don't invent new ideas until the
   known backlog is cleared - a graveyard of half-checked threads is worse than
   a short one that's actually closed out.
2. **One agent per thread, briefed to stand alone.** Each agent gets no memory
   of this conversation, so the brief must be self-contained: the mechanism
   being tested and why it should exist, which coins (BTC/ETH/SOL/HYPE) and
   which harness files (`research/engine.py`, `research/pooled.py`,
   `research/hl_data.py`), the cost model (0.190% modeled, real 0.091-0.100%),
   and the evidence bar (mechanism stated first; positive on both train and
   test; positive 5% trimmed expectancy, not just mean; overlap checked
   against S3/D1/B1/Donchian; survives 2x costs). Also hand it the rejected
   list so it doesn't re-spend the night on mean reversion, RSI(2), lead-lag,
   or the other names already killed - see `Crypto-Trading.md` and the
   `brain-workflow` skill for the full ledger.
3. **Run them in parallel, not queued.** The point of agents is concurrency;
   dispatching them one at a time with the main thread idle between defeats it.
4. **Adversarial review is not optional just because it's overnight.** Every
   agent's "positive" result gets the Head-of-Research treatment from
   `brain-workflow` before it's accepted: is the mean carried by the tail, how
   many variants were tried, is this a random subset, was the mechanism stated
   before or after the numbers. An unattended session that skips this doesn't
   produce more findings, it produces more false positives to unwind later.
5. **Consolidate into one report, not N.** Gabe reads one thing in the morning:
   a single vault entry covering every thread that was touched, positive and
   negative results stated with equal weight, real numbers throughout - not a
   pile of per-agent transcripts he has to reassemble himself.

## What doesn't change no matter how much gets done

- Still paper only. No `--mode live` or `--mode testnet`, no wallet, ever, from
  an unattended run.
- No touching the live strategy, `config/settings.json`, the risk rails, or the
  scheduled task definitions. Research and report; strategy changes are Gabe's
  call, made when he's present, regardless of how compelling an overnight
  result looks.
- No relaxing an evidence gate to manufacture more "wins" to report by morning.
  A quiet night with three ideas honestly rejected is a better outcome than a
  loud one with a gate loosened to get a fourth to pass.
- Every result still gets logged - especially the negative ones. An idea killed
  overnight and never written down gets re-tested by someone else next week.

## Scaling the effort to the time actually available

- Under an hour: one thread, matches the existing hourly task. Don't spawn
  agents for this - the overhead isn't worth it at that scale.
- A few hours (a long `/loop`, an evening session): 2-4 agents in parallel,
  one wave, consolidate and log.
- Overnight or longer: clear as much of the backlog as there are genuinely
  independent threads for, in waves if the backlog is large. Stop when the
  backlog is empty or every remaining item needs a decision only Gabe can make
  - not when a clock runs out.
