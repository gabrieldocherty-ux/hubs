# Hyperliquid Trading Bot — project context

Autonomous crypto perpetuals trading system for Gabe, built on Hyperliquid (a no-KYC perps exchange). Currently in **paper trading only** — no real money, no live orders. This file is always loaded when you start a session here; it stays short on purpose. Full project history, every backtest result, and every accepted/rejected idea live in the vault below — read that before doing new research so you don't repeat work already done.

## Read this first, every session

`../Claude-Brain/Projects/Crypto-Trading.md` — the running log of this entire project: every decision, every backtest, every strategy tried and why it was kept or rejected. This is the project's real memory, not this file. Also check `../Claude-Brain/Vision.md` for whether this is still the active project.

If you're starting a brand-new chat and want the fast version instead of reading the whole log, read `HANDOFF.md` in this same directory first.

## What's actually running right now

- Mode: **paper** (simulated fills, starting capital $250, no wallet, no real orders — see `core/paper_account.py`). Paper mode reads **mainnet** market data by default (`--market-data`), because testnet is a separate thin market — HYPE traded at $22.87 there vs $83.93 on mainnet on 2026-09-05. No orders are placed in paper mode regardless of which one it reads.
- Strategy: `AdaptiveTrendStrategy` (`core/adaptive_optimizer.py`), shadow-evaluating SMA(10,30)/(20,60)/(30,90) crossover on 4h bars, defaulting to the researched (20,60). Validated via walk-forward + funding-adjusted + quarterly backtests — see the vault log for the actual numbers, don't take "validated" on faith. **Its honest profile: 32% win rate, median trade −3.13% (the modal outcome is hitting the 3% stop), all profit in the tail.** That's a normal trend-following shape, not a bug, but expect ~2 losing trades in 3.
- Coins: BTC, ETH, SOL. HYPE is the validated 4th coin by sustained liquidity (median $365M/day over 90d, ahead of SOL) but is **not** in the live basket yet.
- **Execution: a Windows Task Scheduler entry, `HyperliquidPaperBot`, hourly.** Installed by `install_scheduler.bat` (remove with `install_scheduler.bat remove`). It runs `scheduled_cycle.py` via the real Python 3.12 install — *not* the default `python`, which is a Windows Store alias that is unreliable under Task Scheduler. Check it with `schtasks /query /tn HyperliquidPaperBot /v /fo LIST` (Last Result should be 0) and `data/paper_run.log`.
- **Zero closed paper trades so far.** `data/trade_log.jsonl` does not exist. Everything claimed about every strategy is backtest evidence, not a live track record — worth saying out loud before quoting any number to Gabe.

## Strategies available but not live

All validated 2026-09-05 to the same standard as the default (full details, and every rejected idea, in the vault log). Enable with `--strategy <name> --bar-interval 1d`; the default is unchanged unless the flag is passed.

**Cut on cost efficiency 2026-09-06** (`research/cost_efficiency.py` re-runs it): `adaptive_trend` SMA(20,60)/4h and M1 TSMOM. The SMA pays **30.9%/yr of notional in execution cost** (163 trades/yr) for a **negative trimmed expectancy (−0.78%)** — its +0.55% mean is all tail — and correlates +0.44 with the daily sleeve, so it wasn't diversifying either. No verdict changed at the measured 0.100% cost, so the cuts rest on edge, not on an execution assumption. **The hourly task still runs it** — swapping the live default is Gabe's call, see below.

**Two independent bets, three strategies** — this distinction matters more than the count:

- `ForcedFlowContinuation` (S3) — volume spike ≥1.5× its 20d average, follow the day's direction, 10d hold. n=202, 55% win rate, +1.80%/trade, all 4 coins and 4/4 years positive.
- `RangeBreakCascade` (D1) — 20d range break on a day whose range ≥2.0× ATR. n=74, 65% win rate, +3.51%/trade.
- **S3 and D1 are 0.85–1.00 correlated with each other — one bet at two frequencies, not diversification.** Both daily-bar only; the mechanism did **not** replicate at 4h.
- `DonchianBreakout` (M3, `--strategy donchian`, sleeve **macro**) — 55/20 channel break, ~44d holds. The macro replacement for the cut SMA: **3.1%/yr cost drag vs the SMA's 30.9%**, trimmed +1.82%, and −0.04 to −0.06 correlated with the daily sleeve (genuinely diversifying). Still **CONDITIONAL** on substance — edge decayed (train +49% vs test +2.2%), n=49, recent years are +2.2–2.8%, not the +12.85% headline.
- `BasisDislocation` (B1, `--strategy basis`) — fades the perp/spot premium. n=178, 54.5% win rate, +1.68%/trade, **15/15 parameter perturbations positive on both train and test**, survives 4× costs. **Overlap with the above is only 0.35–0.59, so this is the one strategy that genuinely diversifies.** Needs spot data (fetched automatically). **Does not work on SOL** — run it on BTC/ETH/HYPE. Caveats: shortest history here (spot starts 2025), and its most recent half-year is negative — watch that.

## Monitoring

`python dashboard.py` regenerates `dashboard.html`, a status board reading the real state files (trade log, open positions, adaptive state, settings, strategy library). It's a view, not a second source of truth — if a file is missing it says so rather than showing a plausible zero.
- Execution model: **`--once` cycles, not a long-running loop.** `python main.py --mode paper --coins BTC,ETH,SOL --bar-interval 4h --once` runs exactly one check-and-act pass and exits — state (open positions, adaptive strategy history, last bar seen) persists to `data/*.json` between runs via `core/state_store.py`. This exists because nothing was reliably able to keep a background process alive on this machine before. If you're running this from Claude Code directly (unsandboxed, real shell access), you may be able to just run the loop mode (`main.py` without `--once`) in a real background process or a Windows Task Scheduler entry instead — that would be a genuine improvement, see `HANDOFF.md`.
- Currently invoked hourly by a Claude scheduled task (created from Cowork, bound to this device) — check `HANDOFF.md` for whether that's actually working.

## Costs and return target

- **Real execution cost is 0.091–0.100% round trip**, measured against the live L2 book at this account's order size (taker 0.045% + ~0.006–0.048% slippage per side). Backtests deliberately model **0.190%** — roughly 2x worse — because that snapshot was calm-market and the forced-flow strategies trade on days when books thin. Don't restate the constant; every validated number in the vault was produced at 0.190%. Execution cost is not the binding constraint on any strategy here — they all survive 3–4x it.
- **Hyperliquid rejects orders under $10.** With $250 capital and the 20% ceiling the whole tradable band is $10–$50. If Kelly scales below $10 the trade is **skipped, not shrunk** — which is a different strategy from the validated one. Watch for this once trades start.
- **Target is ~10%/year**, set via `base_size_usd: 16.25` (6.5% of capital) in `config/settings.json`. Under the 75/25 split, bootstrapped over 20k resampled years: median +10.2%, p5 +3.5%, ~0% chance of a losing year. 10%/*month* would need ~93% of capital per position — 4.6x over the rail — and is not on the table.

## Capital allocation — 75% daily / 25% macro

`config/settings.json` → `allocation`, enforced in `core/risk_manager.py` (not the strategy layer, so a family can't exceed its share by adding another strategy to itself).

- **Weight caps open *notional* per family; it is NOT a smaller pot to size against.** Every position is $16.25 regardless of sleeve. Sizing off sleeve capital would put a macro position at 5% × $62.50 = $3.13 — under the $10 minimum, where the trade is **skipped, not shrunk**, silently turning a 25% allocation into 0%.
- On $250: daily $187.50 (11 slots), macro $62.50 (3 slots).
- Sleeve membership: `forced_flow` / `range_break` / `basis` → **daily**; `AdaptiveTrendStrategy` → **macro**.
- **Why the split is worth it:** macro-trend monthly returns are near-zero-correlated with the daily sleeve (−0.19 to +0.02). Risk-normalised, 75/25 costs ~0.2pp of median and improves the bad-year floor (p5 +2.7% vs +2.3%), taking P(losing year) to ~0%. Macro *alone* is much worse — median +5.4%, 14% chance of a losing year. It earns its place as a diversifier, not a return source; sizing it above 25% starts costing real money.
- Note the live 4h SMA correlates **+0.44 to +0.45** with the daily strategies — it's a faster trend bet sharing their exposure, so it's a poor macro sleeve despite sitting in that bucket. M1 TSMOM / M3 Donchian are the genuine macro diversifiers.

## Non-negotiable safety rails — do not relax these, ever, regardless of how good a signal looks

- Every trade requires a stop-loss at entry (`config/settings.json` → `risk.require_stop_loss`).
- Hard ceilings on leverage and position size as % of capital (`risk.max_leverage`, `risk.max_position_pct_of_capital`) — position sizing itself is Kelly-derived (`core/kelly.py`), but these are backstops on top of Kelly, not replaced by it.
- Daily-loss circuit breaker (`risk.daily_loss_breaker_pct`) halts all new trades account-wide once tripped; only Gabe manually resets it (`core/circuit_breaker.py`).
- Never place a real order (`--mode testnet` or `--mode live`) without an approved agent wallet — and never accept or ask for Gabe's master private key. Agent-wallet approval is a cryptographic signature only Gabe can perform; it cannot be automated or delegated. See `wallet/agent_wallet.py`.
- `--mode live` refuses to run unless `config/settings.json` network is `"mainnet"`, and vice versa for paper/testnet — don't work around that check.

## Code map

- `main.py` — entry point / the cycle loop.
- `core/adaptive_optimizer.py`, `core/strategies/trend_following.py` — the live strategy.
- `core/risk_manager.py`, `core/kelly.py`, `core/circuit_breaker.py` — everything between a signal and an order.
- `core/executor.py` — the only place allowed to call order-placement methods.
- `core/backtester.py` — in-repo backtester; most actual research happens in throwaway scripts (not committed here) against real pulled data, then gets summarized into the vault log once something's proven or ruled out.
- `core/paper_account.py`, `core/state_store.py` — paper simulation + the JSON persistence that makes `--once` mode work.
- `api/hyperliquid_client.py` — real order placement (testnet/live only).
- `wallet/` — agent wallet encryption/storage. No wallet exists yet (see `HANDOFF.md`).
- `tests/test_risk_manager.py` — run `python -m pytest tests/` after touching risk/circuit-breaker logic. Keep it green.

## Working style Gabe has asked for

Explain the reasoning behind non-obvious choices rather than just executing silently. Report negative/rejected results as plainly as positive ones — this is explicitly framed as "a trading floor testing strategies and finding holes," not a project that only reports wins. Update the vault log when something real changes; don't let it go stale.
