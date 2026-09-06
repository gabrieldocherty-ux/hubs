---
name: brain-workflow
description: Use when working on Gabe's crypto trading project or anything tracked in his Desktop/Claude-Brain vault — read it for context first, log new work back to it, and push trading results to his phone.
---

# Claude Brain Workflow

Gabe keeps a plain-markdown vault at `Desktop/Claude-Brain` on his PC, meant to work like an Obsidian vault: it's his knowledge base, not Claude's internal memory. He wants Claude to actually use it — read from it before acting, and write back to it as things happen — rather than relying only on conversational memory. When running locally via Claude Code, `Desktop/Claude-Brain` is just a normal path on disk (e.g. `../Claude-Brain` from this project) — no device bridge needed.

## At the start of any session touching an active project tracked in the vault

1. Read `Desktop/Claude-Brain/Vision.md` first — it says what's currently active and what's explicitly paused. Don't assume a project is active just because it exists in the vault.
2. Read the specific `Projects/<name>.md` file for whatever you're working on before proposing changes or continuing prior work. Treat it as more current than your own recollection of the conversation.

## While working

- If you make a decision, finish a build step, or learn something that changes the project's status, update the relevant `Projects/*.md` file directly (edit it in place) rather than only saying it in chat. The vault should reflect current reality, not just what got said once.
- Keep `Vision.md` current when priorities shift — it's the single place that says what Gabe is actually focused on right now.

## Trading-specific (not crypto-only — applies to whatever instrument/venue is live: crypto, equities, options, forex, futures, anything Gabe is trading through this vault)

- Every trade gets one entry in `Projects/Trade-Journal.md` (instrument, rationale, entry/exit, stop-loss/take-profit placed, outcome, one-line lesson) at the time it happens, not batched later.
- Periodically — not after every single trade — review recent journal entries and roll durable patterns into `Projects/Lessons-Learned.md`. Distinguish confirmed edges (survived multiple trades) from one-off outcomes. Patterns can be venue/instrument-specific — don't force a lesson learned trading crypto perps onto an equities strategy without checking it actually transfers.
- Before proposing a new strategy or a change to an existing one, read `Lessons-Learned.md` so the same mistakes aren't repeated.
- Send PnL updates and any decision that needs Gabe's attention via whatever notification mechanism is available in this environment (push notification tool in Cowork; from Claude Code locally, that tool won't exist — fall back to a clearly-flagged message in the terminal output, or ask Gabe how he wants to be notified when running locally). Keep it under 200 characters, lead with the number that matters.
- Never relax the account's hard safety rails (stop-loss required at entry, max leverage/position-size ceiling, loss circuit breaker) to chase a trade — these apply regardless of how confident the signal looks, and regardless of which market it's in. The specific numbers live in whichever `Projects/*.md` file (or, for this bot, `config/settings.json`) covers that account/strategy.
- Each asset class has its own regulatory reality (crypto perps on a non-custodial venue need no KYC; equities/options/forex through a real broker do) — don't assume one project's setup (venue, custody model, KYC status) carries over to another without checking that project's own file.

## General working style this reflects

Gabe has said Claude has mostly been "a tool to code" for him and he wants it to also convey ideas back, understand how he works, and feel personalized rather than generic. Concretely: don't just execute silently — explain the reasoning behind non-obvious choices, surface trade-offs before locking them in, and treat the vault files as a shared, evolving record of thinking rather than a one-time export.
