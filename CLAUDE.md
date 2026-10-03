# Hyperliquid Trading Bot — project context

Autonomous crypto perpetuals trading system for Gabe, built on Hyperliquid (a no-KYC perps exchange). Currently in **paper trading only** — no real money, no live orders. This file is always loaded when you start a session here; it stays short on purpose. Full project history, every backtest result, and every accepted/rejected idea live in the vault below — read that before doing new research so you don't repeat work already done.

## Read this first, every session

`../Claude-Brain/Projects/Crypto-Trading.md` — the running log of this entire project: every decision, every backtest, every strategy tried and why it was kept or rejected. This is the project's real memory, not this file. Also check `../Claude-Brain/Vision.md` for whether this is still the active project.

If you're starting a brand-new chat and want the fast version instead of reading the whole log, read `HANDOFF.md` in this same directory first.

## What's actually running right now

> **HALTED 2026-10-03 at Gabe's request: market testing is off. Nothing below is currently running.** Do not re-enable either job, or restart trading or strategy research, unless Gabe asks.
> - `HyperliquidPaperBot` (Windows task) is **disabled**, not deleted. Its last cycle ran 2026-10-03 00:24. Resume with `schtasks /change /tn HyperliquidPaperBot /enable`.
> - The Claude scheduled task `hyperliquid-hourly-brief` is **paused**. Re-enable it from the scheduled-tasks list.
> - Gabe chose a hard stop over winding down with `--exit-only`, so **3 open paper positions are frozen and nobody is checking their stops**: SOL long @ 111.74 (stop 108.39), BTC long @ 81,123 (stop 78,689), b1 ETH short @ 2,665.10 (stop 2,885.21). The book stood at 6 closed trades and $248.51 equity. On resume, the first cycle will check those stops against the current price, not the price at the moment they were crossed.
> - `research/poly_daemon.py` (Polymarket data recorder, places no trades) was **left running**. It is not part of the bot.

- Mode: **paper** (simulated fills, starting capital $250, no wallet, no real orders — see `core/paper_account.py`). Paper mode reads **mainnet** market data by default (`--market-data`), because testnet is a separate thin market — HYPE traded at $22.87 there vs $83.93 on mainnet on 2026-09-05. No orders are placed in paper mode regardless of which one it reads.
- Strategy: `AdaptiveTrendStrategy` (`core/adaptive_optimizer.py`), shadow-evaluating SMA(10,30)/(20,60)/(30,90) crossover on 4h bars, defaulting to the researched (20,60). Validated via walk-forward + funding-adjusted + quarterly backtests — see the vault log for the actual numbers, don't take "validated" on faith. **Its honest profile: 32% win rate, median trade −3.13% (the modal outcome is hitting the 3% stop), all profit in the tail.** That's a normal trend-following shape, not a bug, but expect ~2 losing trades in 3.
- Coins: BTC, ETH, SOL. HYPE is the validated 4th coin by sustained liquidity (median $365M/day over 90d, ahead of SOL) but is **not** in the live basket yet.
- **Execution: a Windows Task Scheduler entry, `HyperliquidPaperBot`, hourly.** Installed by `install_scheduler.bat` (remove with `install_scheduler.bat remove`). It runs `scheduled_cycle.py` via the real Python 3.12 install — *not* the default `python`, which is a Windows Store alias that is unreliable under Task Scheduler. Check it with `schtasks /query /tn HyperliquidPaperBot /v /fo LIST` (Last Result should be 0) and `data/paper_run.log`.
- **Zero closed paper trades so far.** `data/trade_log.jsonl` does not exist. Everything claimed about every strategy is backtest evidence, not a live track record — worth saying out loud before quoting any number to Gabe.

## Strategies available but not live

All validated 2026-09-05 to the same standard as the default (full details, and every rejected idea, in the vault log). Enable with `--strategy <name> --bar-interval 1d`; the default is unchanged unless the flag is passed.

**Cut on cost efficiency 2026-09-06** (`research/cost_efficiency.py` re-runs it): `adaptive_trend` SMA(20,60)/4h and M1 TSMOM. The SMA pays **30.9%/yr of notional in execution cost** (163 trades/yr) for a **negative trimmed expectancy (−0.78%)** — its +0.55% mean is all tail — and correlates +0.44 with the daily sleeve, so it wasn't diversifying either. No verdict changed at the measured 0.100% cost, so the cuts rest on edge, not on an execution assumption. **The hourly task still runs it** — swapping the live default is Gabe's call, see below.

**⚠️ THE GATE EVERY STRATEGY MUST PASS FIRST: does it beat just holding the coin?**
`research/vs_buyhold.py --common`. This exists because the Wealthsimple book carried
alpha t-statistics of 2.78, 3.22 and 4.45 and **not one of its 60 cells ever made more
money than owning the instrument** — the statistic was rewarding low beta in a rising
market. Ask this before quoting any alpha, DSR, PBO or expectancy number.

**The crypto book passes, conditionally — and the condition is the finding.** Terminal
wealth as a share of buy-and-hold, all four strategies on matched dates:

| coin (buy & hold) | S3 | D1 | M3 | B1 |
|---|---|---|---|---|
| BTC (**−19.0%**) | 136% | 153% | 113% | **228%** |
| ETH (+22.8%) | 201% | 121% | **72%** | 161% |
| SOL (**−41.3%**) | 205% | 275% | **93%** | 215% |
| HYPE (**+532.6%**) | **38%** | **26%** | **16%** | **79%** |

**Where holding lost money these beat it decisively; where holding returned +532% none
come close.** That is what a near-market-neutral timing book should do, and it is a
different animal from the equity book, which lost to buy-and-hold in *every* regime
because it was pure exposure drag. Decomposed as `alpha = (exposure − beta)·E[market] +
Cov(weight, market)`, the exposure-gap term was **64% of alpha on ZEB** and is **0–12%
here** — essentially all timing. Drawdowns are uniformly better: −18% to −64% against
−53% to −76% for holding.
**The honest expectation to set: this book is insurance against flat and falling
markets, not a way to outperform a crypto bull run.**

**Two independent bets, three strategies** — this distinction matters more than the count:

- `ForcedFlowContinuation` (S3) — volume spike ≥1.5× its 20d average, follow the day's direction, 10d hold. n=202, 55% win rate, +1.80%/trade, all 4 coins and 4/4 years positive. **⚠️ ITS MECHANISM DOES NOT SURVIVE TESTING — the backtest number is not challenged, the LABEL is.** "Forced flow" predicts the edge arrives at the signal and decays. It does not: days 1–2 average +0.150%/day (t=0.69) against days 3–10 at +0.214%/day, and a cluster bootstrap on entries puts the contrast at +0.066pp, CI straddling zero — **shapeless, not front-loaded**. Three independent cuts: (a) unconditionally, across all 3,943 bars, the next-bar signed return after a ≥1.5×-volume day is **−0.125%** (n=649) and **−0.279%** once bars that also meet D1's condition are removed — volume alone carries *none* of it; (b) inside S3's own 202 entries, the 34 that are secretly D1 signals return **+2.644%** on day 1 (t=3.79) while the 107 bare volume spikes return **−0.484%**; (c) no decay structure at all. **S3's entire positive first day is the 17% of its entries that are D1 signals in disguise.** Whatever it earns, it earns flat across the hold, which is a slow-continuation shape — and since mechanism is this project's primary reason for believing an edge persists, S3 currently has none.
- `RangeBreakCascade` (D1) — 20d range break on a day whose range ≥2.0× ATR. n=74, 65% win rate, +3.51%/trade. **Its mechanism is CONFIRMED against a control group — the best-identified edge in this project.** The effect is an INTERACTION, not either condition alone (every bar in the tradeable window, signed by the signal bar's direction, next bar open-to-open):

  | condition | n | next bar | t |
  |---|---|---|---|
  | ≥2×ATR **and** 20d break | 103 | **+0.931%** | +2.12 |
  | ≥2×ATR, **no** break | 74 | **−0.763%** | −1.67 |
  | break, ordinary range | 313 | +0.237% | +0.95 |
  | all bars | 3,943 | −0.035% | −0.55 |

  Both-minus-range-only = **+1.69pp**, 90% CI [+0.65, +2.75], P(≤0)=0.0035. An outsized bar that stops *inside* the recent range REVERSES; the same bar closing *beyond* a 20-day extreme CONTINUES. That is what a stop/liquidation-cluster story predicts and nothing else does, and neither component works alone. The payoff is front-loaded as the mechanism requires: days 1–2 **+1.023%/day (t=+2.86)** vs days 3–10 +0.216%, contrast P(back-loaded)=0.009.
  **TIMING, NOT COST, IS THE BINDING CONSTRAINT.** Break-even round trip is **3.698% — 19.5× the modelled 0.190%** and ~38× measured. But entering ONE BAR LATE cuts expectancy +3.51% → **+2.09%**, win rate 64.9% → **50.0%**, and the median trade from +1.47% to +0.16%; **93% of that loss is literally the entry bar**, which alone is 39% of the eleven-day gross. A worse fill inside the right bar is survivable; the wrong bar is not.
  **CAVEAT, stated because it is load-bearing:** day-1 magnitude is concentrated — SOL supplies 52% and HYPE 32%, and **BTC+ETH day-1 alone is +0.380%, t=1.01, not significant**. The front-loading *shape* does replicate on BTC+ETH (contrast −0.869pp); the *size* rests on SOL. HYPE has 6 trades — quote no HYPE number.
- **S3 and D1 overlap heavily, but NOT for the reason recorded.** The 0.85–1.00 figure is `pooled.overlap`, which is the fraction of CO-INVESTED bars on the same side and is not a correlation (it scores 0.94 on just 14% of bars; their actual P&L correlation is +0.50 — see the vault). And the direction of the dependence runs one way: **S3's only working component is the subset of its entries that are D1 signals**, so D1 is the strategy and S3 is a noisier wrapper around it, not two expressions of one bet. Both daily-bar only; the mechanism did **not** replicate at 4h.
- `DonchianBreakout` (M3, `--strategy donchian`, sleeve **macro**) — 55/20 channel break, ~44d holds. The macro replacement for the cut SMA: **3.1%/yr cost drag vs the SMA's 30.9%**, trimmed +1.82%. **It is NOT the diversifier it was recorded as** — see the allocation section below; on a daily mark-to-market series it runs **+0.44** with the daily sleeve, not −0.04 to −0.06. Still **CONDITIONAL** on substance — edge decayed (train +49% vs test +2.2%), n=49, recent years are +2.2–2.8%, not the +12.85% headline. **M3 now has FOUR independent strikes and is the weakest thing in the book:** (1) the diversification claim does not reproduce (+0.44, not −0.04 to −0.06); (2) the "still positive recently" defence is per-trade MEANS — the same 2025 trades have a −5.40% median and 6 wins in 18; (3) a one-day delay costs 50–63% of CAGR, impossible for a 44-day hold and evidence its P&L sits in the entry bar; (4) **its SHORT side loses money on three of four coins** (−27.8%, −27.0%, −38.4%), so its longs are carrying a losing short book, and it is the only strategy here that fails the buy-and-hold gate on ETH and SOL as well as HYPE. Retiring it is Gabe's call, but nothing currently argues for keeping it.
- `BasisDislocation` (B1, `--strategy basis`) — **a DIRECTIONAL perp trade whose entry is triggered by the perp/spot basis. It is not a convergence trade, and describing it as "fades the premium" was wrong.** `core/strategies/basis_dislocation.py` emits a single `Signal(coin, Direction.SHORT|LONG, …)`: one perp leg, no spot leg, no hedge. The basis is only the trigger, so the P&L is the perp price move — regressing trade P&L on the signed spot move over the hold gives **R² = 0.982, beta 1.03**. The convergence component it is named after is worth **+0.07–0.10%/trade against a 0.190% modelled round trip**, so there is no version of this that pays as relative value (a genuine paired trade would pay 0.380%). Its 0.35–0.59 overlap with the rest is real, but it comes from **when it flips side**, not from being market-neutral — and exposure swings 0–100% short with no cap, which is the risk worth watching. n=178, 54.5% win rate, +1.68%/trade, **15/15 parameter perturbations positive on both train and test**, survives 4× costs. Needs spot data (fetched automatically). **Does not work on SOL** — run it on BTC/ETH/HYPE. Caveats: shortest history here (spot starts 2025), and see the vault for why its negative 2026H2 is a directional regime rather than decay.

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
- **⚠️ THE STATED REASON FOR THE SPLIT DOES NOT HOLD UP.** It was justified on macro being near-zero-correlated with the daily sleeve (−0.19 to +0.02 monthly, −0.04 to −0.06). That number comes from `research/book_rebuild.py`, which builds monthly returns by summing trade P&L **keyed on the trade's EXIT month**. That decorrelates a 44-day macro trade from 10-day daily trades *by construction*: the macro trade dumps its whole P&L into one month while the daily sleeve spreads across several, and months with no exit are absent entirely rather than zero.
  `research/tail_correlation.py` already builds the right thing — a daily mark-to-market P&L series for the whole book with the live rails applied — and it says **DAILY/MACRO = +0.44 daily, +0.19 monthly**. That file has existed since commit 7f7d137 and its result was never propagated here. An independent reconstruction agrees in sign and magnitude (+0.53 daily, +0.47 monthly).
- **The real correlation structure**: S3/D1 **+0.60**, S3/M3 +0.47, D1/M3 +0.44 — one cluster. **B1 is the only genuine diversifier**: −0.12 vs S3, −0.09 vs D1, −0.08 vs M3. Lower-tail dependence at q=0.10 (independence would be 0.10) makes it starker: **S3/D1 = 0.74**, D1/M3 = 0.43, while every B1 pair is 0.06–0.18. The cluster fails together in the tail; B1 does not.
- **What that means for the split:** the 75/25 allocation may still be right, but not for the recorded reason — it is not buying macro diversification, because macro sits inside the cluster. **Changing the allocation is Gabe's call and nothing here has been changed.** The remaining quantitative claims below (median +10.2%, p5 +3.5%) were derived from the same near-zero correlation assumption and should be treated as unverified until re-run.
- Risk-normalised, 75/25 was reported to cost ~0.2pp of median and improve the bad-year floor (p5 +2.7% vs +2.3%). Macro *alone* is much worse — median +5.4%, 14% chance of a losing year.
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
