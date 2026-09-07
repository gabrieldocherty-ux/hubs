---
name: perp-mechanics
description: Use when writing or reviewing code that touches leverage, margin, liquidation, funding, order types, or position accounting on Hyperliquid — or when a risk control depends on how the exchange actually behaves. Encodes the venue's real rules, verified against its docs and API, and the mistakes already made here from assuming instead of checking.
---

# Perpetual futures mechanics on Hyperliquid

This skill exists because a wrong mental model of margin produced a broken safety
rail that survived weeks of review. Leverage was set as `1 / stop_distance`,
which put the stop exactly one unit of initial margin away — but liquidation
happens at *partial* margin loss, so liquidation always came first. Measured on
real ATR, the stop sat beyond the liquidation price on **96% of BTC bars and 100%
of SOL and HYPE bars**. The mandatory stop-loss would never have fired on a live
position.

It never bit because paper mode does not simulate liquidation. It would have bitten
on the first real order.

**Rule that follows: when a control depends on the exchange's behaviour, verify
the behaviour against the venue, not against intuition.**

## Margin and liquidation — the rules that actually apply

Verified against the [Hyperliquid margining docs](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining),
the [liquidations docs](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/liquidations),
and the venue's own `meta` endpoint.

**Maintenance margin is a property of the ASSET, not of your chosen leverage.**
The docs say "half of the initial margin *at max leverage*" — the last three
words are the whole point:

    maintenance_rate = 0.5 / asset_max_leverage

On 2026-09-07 that gives 1.25% for BTC (40x), 2.00% for ETH (25x), 2.50% for SOL
(20x), 5.00% for HYPE (10x). Fetch `maxLeverage` per coin from `{"type":"meta"}`;
it also returns `marginTables`, which are **tiered by notional** (HYPE drops from
10x to 5x above $20M). At this account's size only the first tier ever applies,
but do not hardcode that assumption for a larger account.

**Liquidation distance:**

    equity = notional/L + PnL,  liquidated when equity < maintenance_rate * notional
    => liquidation_distance = 1/L - maintenance_rate

A second error was made here modelling this as `0.5 / L` — treating maintenance
as half of the *chosen* margin. That was wrong in the safe direction (it put
liquidation nearer than reality and used less leverage than needed), but it tied
up $146 of a $250 account in margin at full book instead of $75.

**Choosing leverage safely:** require liquidation to sit a multiple beyond the stop.

    L <= 1 / (LIQUIDATION_BUFFER * stop_distance + maintenance_rate)

With a 2x buffer and the real 2.5x ATR stops that gives BTC 5x, ETH 3x, SOL 2x,
HYPE 2x — buffers of 2.2x to 3.1x.

**Leverage is free to lower.** P&L is computed on NOTIONAL, so leverage never
changes what a move earns or loses — only how much margin is posted and where
liquidation sits. Lower leverage on the same notional is strictly safer and gives
up no return. The only thing it consumes is free collateral.

## The liquidation waterfall, and why low leverage helps twice

1. **HLP vault** absorbs the position at the mark-based liquidation price.
2. **Insurance fund** covers any shortfall.
3. **Auto-Deleveraging (ADL)** — if both are exhausted, the exchange force-closes
   *profitable counterparty* positions to cover a bankrupt one.

ADL ranks victims by **unrealised profit × effective leverage**. So a winning,
highly-levered position can be closed against you through no fault of its own.
Lower leverage reduces both liquidation risk *and* ADL ranking. Nothing in this
codebase models ADL; it is a tail risk to be aware of, not one that has been
quantified.

Positions below 2/3 maintenance margin are backstop-liquidated into the HLP
liquidator vault. **Liquidations use the MARK price** (external CEX prices
combined with HL's book), not the last trade — so a thin-book wick on HL alone
should not liquidate you, but a genuine cross-venue move will.

**Isolated vs cross:** isolated walls off risk to one position — a backstop
liquidation takes that position and its margin only, leaving cross positions
untouched. Cross shares collateral across all positions and is liquidated on
total account equity against total maintenance requirement. This bot has not
chosen explicitly, which is itself worth fixing before going live.

## Funding

- Charged **hourly** on Hyperliquid (it was 8-hourly for the venue's first ~27
  days in 2023 — the historical series changes convention, and treating the early
  8h rates as hourly implies a nonsensical −48%/yr).
- **Longs pay positive funding, shorts receive it.** A strategy that lost while
  long into positive funding does not automatically win by being short.
- Funding is a **holding** cost (per day); execution cost is a **trade** cost
  (per round trip). Shortening a hold trades one for the other, and the
  arithmetic is usually unfavourable — see the `exit-design` skill.
- Model it interval-weighted from the real published history, never as a constant.

## Order types and execution

- **Taker 0.045%, maker 0.015%** at base tier (no volume history on this account,
  so no discount applies). Everything here uses market orders on a bar-close
  signal, so taker is the honest assumption — claiming the maker rate means
  assuming a limit order that may never fill, which changes which trades happen.
- **Minimum order value is $10.** Below it the order is REFUSED, so the trade is
  **skipped, not shrunk**. Any sizing rule that can produce a sub-$10 order is
  secretly an entry filter.
- Measured real cost at this account's size is **0.091–0.100% round trip** (walk
  the L2 book with `{"type":"l2Book"}` rather than assuming). Backtests
  deliberately model 0.190% because the book snapshot was calm-market and these
  strategies trade on volatile days.
- Entry orders must always be grouped with their stop/target — `core/executor.py`
  is the only place allowed to call order placement.

## Data quirks that have already caused wrong conclusions

- **Testnet is a different market.** HYPE traded at $22.87 there versus $83.93 on
  mainnet. Paper mode reads mainnet by default for exactly this reason.
- **Candles predate the venue.** HL serves daily bars back to 2020 though it
  launched mid-2023; 913 of those early bars have zero volume. Prices are real
  (0.05% vs Binance) but it is backfilled reference data, not tradeable history.
- **1h candles only go back ~208 days**; 4h goes back to 2024-05. Check depth
  before designing around a timeframe.
- **Spot pairs are internal IDs** (`@142` = UBTC, `@151` = UETH, `@156` = USOL,
  `@107` = HYPE), and thin books produce wick prints — raw BTC basis has a 13.5%
  standard deviation around a −0.014% median. Filter beyond ±2% as bad data.
- **Open interest, premium and book depth are LIVE ONLY** — no historical
  endpoint, and no liquidation history at all. `core/oi_collector.py` records
  them hourly so a history exists later.

## Before any real order

Nothing here has ever placed one. The wallet does not exist, and `--mode live`
refuses unless `network` is `mainnet`. Before that changes: confirm margin mode
explicitly, confirm the leverage the risk manager derives matches what the venue
reports for the position, and place one minimum-size order first to verify fills,
fees and the stop actually land where the code believes.
