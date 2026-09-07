---
name: risk-optimization
description: Use when changing position sizing, leverage, stop-losses, exposure caps, the loss breaker, or capital allocation on the Hyperliquid bot — or when asked whether the risk profile should change, how much to size, or why a drawdown happened. Encodes the project's rails, the failure modes already found the hard way, and the procedure for testing a risk change before shipping it.
---

# Risk optimization

Risk changes are the ones most likely to be judged by how the number looks rather
than by whether it is real. A strategy change that is wrong loses some money; a
risk change that is wrong loses the account. This skill exists so those decisions
follow a procedure instead of an instinct.

## The one rule that governs everything else

**Measure what a risk control COSTS, not just what it protects against.** A cap
always looks good if you only report the disaster it prevents, and always looks
bad if you only report the trades it skipped. Report both, per trade, and let the
ratio decide. If a control removes risk without removing edge, take it. If it
buys safety with return — which is the normal case — say so explicitly and price
it.

Worked example already in the repo: `research/net_exposure_cap.py` measured that
a 50% net-exposure cap skips 4 of 454 trades and costs ~5% of per-trade P&L,
while pulling the worst plausible correlated day from −9.4% to −7.3%. That is the
shape every risk proposal should arrive in.

## Current rails, and why each number is what it is

Read `config/settings.json` for live values; this is the reasoning behind them.

| rail | value | why |
|---|---|---|
| `require_stop_loss` | true | Non-negotiable. Never relax, regardless of signal confidence. |
| `max_position_pct_of_capital` | 20% | Backstop on top of Kelly, not a target. |
| `max_leverage` | 10x | A ceiling. Actual leverage is derived — see below. |
| `max_net_exposure_pct` | 50% | Correlation rail. The others cap each trade and each family; only this one notices four positions are the same bet. |
| `daily_loss_breaker_pct` | 10% | Halts account-wide. Only Gabe resets it. |
| `kelly_fraction` | 0.25 | Quarter-Kelly. See the estimation-error note below. |
| `base_size_usd` | 16.25 (6.5%) | Solved for a ~10%/yr median under the 75/25 split. |
| `allocation` | 75% daily / 25% macro | Caps open **notional** per family — NOT a smaller pot to size against. |

## Failure modes found the hard way in this project

Check every proposed change against these. Each was live in the code and each was
invisible until specifically looked for.

**1. The stop sat beyond the liquidation price.** Leverage used to be set as
`1 / stop_distance`, putting the stop exactly one unit of initial margin away.
But liquidation happens at *partial* margin loss (maintenance ≈ half of initial),
so liquidation always arrived first — measured on real ATR, the stop was beyond
liquidation on 96% of BTC bars and 100% of SOL and HYPE bars. The mandatory
stop-loss would not have fired on a live position. Now leverage is derived from
`MAINTENANCE_FRACTION / (LIQUIDATION_BUFFER * stop_distance)` so liquidation sits
at least 2x further away than the stop.
*Generalisation: whenever a control depends on another system's behaviour, verify
the ordering rather than assuming it.*

**2. Gross exposure hid a concentrated bet.** The book reached 12 simultaneous
positions, 58% net one-way, with 30.3% of active days holding 4+ positions ≥80%
aligned. Every rail treated four aligned positions identically to four offsetting
ones. *Generalisation: on correlated instruments, gross size is not risk. Measure
net directional exposure.*

**3. Below $10, a trade is skipped rather than shrunk.** Hyperliquid refuses
orders under $10. Any sizing scheme that can produce a sub-$10 order silently
becomes an entry filter — a "stepped" conviction-sizing scheme was found to skip
90 of 202 trades this way, which made it look excellent for entirely the wrong
reason. *Generalisation: a sizing rule that changes which trades happen is not a
sizing rule.*

**4. Sizing off sleeve capital breaks the allocation.** 5% of a 25% sleeve on
$250 is $3.13 — under the minimum, so the macro sleeve would silently become 0%.
Weights cap notional; position size is always a share of TOTAL capital.

**5. Bootstrap risk numbers are too optimistic.** Resampling trades independently
destroys the serial correlation of real losing streaks. Every "chance of a losing
year" figure in this project understates the true risk, and the understatement
grows with position size. Never quote one without this caveat.

## Standard practice, and where this project stands against it

From the literature ([fractional Kelly](https://medium.com/@tmapendembe_28659/the-dangers-of-full-kelly-criterion-why-most-traders-should-use-fractional-kelly-criterion-instead-0338e3bcc705),
[CTA volatility targeting](https://concretumgroup.com/position-sizing-in-trend-following-comparing-volatility-targeting-volatility-parity-and-pyramiding/),
[drawdown protocols](https://internationaltradinginstitute.com/blog/dynamic-position-sizing-and-risk-management-in-volatile-markets/)):

- **Fractional Kelly.** Full Kelly carries roughly a 1-in-3 chance of a 50%
  drawdown, and overestimating edge makes it catastrophic. Half-Kelly cuts
  volatility in half for only ~25% less growth. **This project uses quarter-Kelly
  — more conservative than standard, appropriate given zero live trades.** No
  change recommended until there is a real track record.

- **Volatility targeting.** CTAs scale exposure inversely to realised volatility,
  targeting 12–18% annual portfolio vol, so returns are not dominated by a few
  high-volatility episodes. **This project does NOT do this** — position size is a
  fixed $16.25 whatever the regime, so risk per trade roughly doubles when
  volatility doubles. This is the largest genuine gap against standard practice.
  Note the ATR-based stops give partial protection (a wider stop in volatile
  conditions), but size itself is unscaled.

- **Tiered drawdown response.** Standard is graduated: −5% from a high → cut risk
  25%; −10–15% → cut 50%. **This project has a binary breaker at −10%** that halts
  everything. Binary is safe but blunt: it does nothing at −9% and stops
  everything at −10%.

- **Daily VaR limits** of 1–3% of portfolio are typical. This project has no VaR
  concept; the net-exposure cap is a cruder proxy.

## Procedure for any proposed risk change

1. **State the failure it prevents, concretely.** Not "reduces risk" — which
   loss, on which day, of what size.
2. **Measure the cost.** Replay the real trade history with the control applied.
   Report trades skipped, P&L per trade before and after, and peak exposure
   before and after. `research/net_exposure_cap.py` is the template.
3. **Check it against the five failure modes above**, especially whether it can
   produce a sub-$10 order or silently filter entries.
4. **Check the interaction with existing rails.** They compose in ways that are
   not obvious — the sleeve cap, the position cap, the net-exposure cap and the
   minimum order all bind at different points.
5. **Write tests that assert the invariant**, not the current numbers. "The stop
   always sits inside liquidation" survives a parameter change; "leverage is 2x"
   does not. Tests live in `tests/test_risk_manager.py`.
6. **Prefer changes that cost nothing.** Lowering leverage on the same notional
   is strictly safer and gives up no return, because P&L is computed on notional
   — leverage only moves the liquidation price. Look for these first.
7. **Never relax a rail to make a strategy look better.** If a strategy only
   works with a wider rail, that is a finding about the strategy.

## Things that are NOT risk improvements, however they look

- Inverting a losing strategy. Tested: costs are paid in both directions, stops
  are asymmetric, and a losing strategy is usually no edge plus friction rather
  than an inverted winner. See `research/inversion_test.py`.
- Dropping a losing subgroup found after slicing the data. The worst of five
  slices looks bad partly because it is the worst of five.
- Any change validated only on the half of the data used to find it.
