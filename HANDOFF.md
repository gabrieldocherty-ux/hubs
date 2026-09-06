# Handoff: Hyperliquid Trading Bot — start here in a new chat

Paste this whole file as your first message in a new Claude Code session started in this directory. It's a snapshot of everything decided and built so far, so a fresh session doesn't have to rediscover it. The vault (`../Claude-Brain/Projects/Crypto-Trading.md`) has the full blow-by-blow with every backtest number; this is the compressed version.

## What this is

An autonomous crypto perpetuals trading system for Gabe on Hyperliquid (no-KYC perps exchange). Currently **paper trading only, $250 simulated capital, no real money, no wallet set up yet**. Started as a Cowork (claude.ai) project — this handoff exists because the project is moving to being driven by Claude Code running locally on Gabe's PC instead, since local Claude Code gets real unsandboxed shell access here, where Cowork's remote-device bridge only gave short-lived, isolated shell sessions that couldn't host a persistent process.

## How we got here (short version)

Gabe wanted full autonomy within hard risk limits: Kelly-derived position sizing (not arbitrary numbers), mandatory stop-losses, hard leverage/position/loss-breaker ceilings that never get relaxed "regardless of how confident the signal looks." He explicitly framed this as running "a trading floor developing and testing strategies, trying to find holes" — negative results get reported as plainly as positive ones, and nothing goes live on a single promising backtest.

The live default strategy — SMA(20,60) crossover on 4h bars, adaptively shadow-evaluated against (10,30) and (30,90) variants — earned its spot through: an initial backtest screen against mean-reversion and Donchian-breakout alternatives, a 60/40 train/test split, a rejected attempt to trade at higher frequency (15m/1h decays the edge below cost), a "wider net via more coins" approach instead (BTC/ETH/SOL kept, HYPE rejected for a train/test sign-flip), a full year of real funding-rate cost included (drag was small, didn't change the verdict), and a 4-quarter walk-forward that surfaced a real weak BTC quarter (Dec 2025–Jan 2026, a sideways/chop period) that the coarser split had hidden.

Two attempted fixes for that weak quarter were tested and **rejected**: a raw %-price-move chop filter, and a proper ADX trend-strength filter — both either entered too late or didn't actually fix that specific quarter. Two newer leads are **promising but not yet live-validated**: a golden-cross (SMA 50/200) signal on decades of Nasdaq data (first real "beyond crypto" result, using FRED's free daily index data since Yahoo/Stooq are blocked from the Cowork cloud sandbox), and a funding-rate "crowding" short strategy (extreme positive funding → negative forward returns) that held up on ETH/SOL but not BTC. Neither should go live without the same quarterly-walk-forward rigor the current default passed. A Fear & Greed sentiment contrarian test was tried and found **no edge** — logged as a clean negative result, not a bug.

## What's actually running / set up right now

- **No wallet exists yet.** `wallet/` has no `data/agent_wallet.enc`. `config/settings.json`'s `master_account_address` is still the placeholder. Nothing can place a real order (testnet or live) until Gabe runs the wallet setup and does the one-time agent-wallet approval himself — that's a cryptographic signature only he can make; never accept his master private key as a workaround for this.
- **Paper trading has a real bug history worth knowing about.** The original design tried to run as a long-lived polling loop, but (a) nothing could reliably keep that process alive on Gabe's machine, and (b) both `HyperliquidClient` and `PaperTradingClient` were constructing the SDK's `Info` object with `skip_ws=False`, which opens a websocket on a non-daemon thread that never lets the process exit — even a `--once` run would hang forever after finishing its actual work. Both are now fixed (`skip_ws=True`; nothing in this codebase uses websocket subscriptions). `main.py` now supports `--once`: one check-and-act cycle, then a clean exit, with all needed state persisted to `data/*.json` (`core/state_store.py`) so nothing is lost between invocations. Verified this actually works by running it twice back-to-back and confirming state carried over.
- **Two Claude scheduled tasks exist** (created from Cowork, meant to run `device_bash` against this machine): "Paper Bot Hourly Cycle" (hourly, runs one `--once` pass) and "Crypto Trading Floor R&D" (daily at 15:07 UTC, picks one new research thread and logs honest results to the vault). **Status is uncertain** — they were created before device-binding approval was confirmed, and as of this handoff the hourly one shows a "succeeded" run in its history but `data/bot_cycle_state.json` and `data/paper_run.log` show no evidence of a real execution since the last manual test, which suggests it may still be running cloud-only without real access to this machine. Worth checking directly (`list_triggers`-equivalent, or just watch `data/paper_run.log` for an hour) rather than assuming either way.
- **Trade log is empty** (`data/trade_log.jsonl` has zero entries) — no paper trades have actually happened yet, only "no signal" cycles. That's expected (SMA(20,60)/4h only fires a handful of times a year per coin) but means there's no live track record to point to yet, only backtests.

## Why this is moving to Claude Code

Claude Code running locally on this machine gets real, unsandboxed shell access — no bridge, no short-lived isolated sessions. That means it can likely do what Cowork's bridge couldn't: actually launch the bot as a genuinely persistent background process, or create a real Windows Task Scheduler entry (`schtasks.exe`) that runs it on a timer without needing Claude's own cloud-scheduled-task workaround at all. If you're reading this from Claude Code: that's probably the first thing worth evaluating and fixing, since the `--once`-plus-external-scheduler design was a workaround for a limitation that may not apply here.

## Immediate next steps, in rough priority order

1. Figure out whether the paper bot has a reliable way to actually run continuously now (see above) — either confirm the Cowork-created scheduled tasks are truly working, or set up something better locally (a real background process, Task Scheduler, whatever fits) and consider disabling the cloud-side hourly task once local execution is confirmed working, so it isn't running twice.
2. Once it's actually cycling regularly, let it accumulate real paper trades before touching the strategy again — there's no live track record yet, only backtests.
3. Continue the research threads already logged as open: get the funding-crowding short strategy through a full quarterly walk-forward before considering it; same for the Nasdaq golden-cross idea (and note that's an equities signal — there's no equities broker integration at all yet, this was pure backtesting research).
4. Read `CLAUDE.md` in this directory for the safety rails and code map — they're not repeated here.

## What NOT to do

- Don't relax any risk rail (stop-loss, leverage/position ceilings, daily circuit breaker) to make a strategy look better.
- Don't accept Gabe's master wallet key, or try to automate the agent-wallet approval step, under any framing.
- Don't switch the live default strategy based on one good backtest — it needs the same walk-forward + quarterly scrutiny the current one passed.
- Don't assume the vault or scheduled tasks are in a good state without checking — this handoff describes the state as of when it was written, not a guarantee.
