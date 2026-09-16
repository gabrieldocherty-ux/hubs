# Wealthsimple TSX book — $1,000

Updated 2026-09-12. Every number comes from code in `research/`, run on 14–25
years of adjusted daily data.

---

> # ⚠️ CORRECTION — HOW PBO WAS BEING READ (2026-09-16)
>
> **No strategy is withdrawn by this.** What changes is how strong the PBO
> evidence was claimed to be, in the direction of *less* strong.
>
> PBO numbers here were previously read against a "null" of ~0.60, computed by
> `pbo_null()` from **six** simulated draws. The per-draw spread of that statistic
> is sd ≈ 0.22, so six draws carry a standard error near 0.09 — far too coarse to
> locate the null at all. Pooled over 2,400 draws the null is **0.4991 ± 0.0041**,
> i.e. exactly 0.5, and the rank histogram behind it is flat. Two different
> explanations for the phantom 0.60 bias were written into `institutional.py`
> before it was measured properly; both are wrong and both are kept in that
> docstring so the mistake stays legible.
>
> The consequence is that "PBO 10.3% versus a null of 0.62" overstated the case.
> The honest statement is a p-value — how often pure noise beats the measured
> number — and `pbo_pvalue()` now produces it:
>
> | | PBO | p-value | reads as |
> |---|---|---|---|
> | vol-managed VFV | 10.3% | **0.030** | clears 5%, not 1% |
> | trend XIU | 13.1% | **0.057** | **does not clear 5%** |
> | vol-managed HQU | 37.3% | 0.33 | no evidence |
>
> The trend result's overfitting check is therefore **marginal, not passed**. Its
> alpha t-statistic of 3.22 is separate evidence and still stands; the PBO gate
> simply does not add the support it was credited with.
>
> The general lesson is the one the withdrawn strategy already taught, in a new
> place: a number computed from too few draws is not a weak measurement, it is an
> unknown quantity that happens to have printed.

---

> # ⚠️ CORRECTION — THE OVERNIGHT STRATEGY IS WITHDRAWN
>
> **Everything in the next section is wrong and should not be traded.** It is kept
> below only so the error is legible.
>
> A cross-source verification (`research/verify_data.py`, `research/fx_decomposition.py`)
> found that VFV.TO's overnight return is a **data artefact**, not a risk premium.
> Four funds on the same S&P 500 index:
>
> | | overnight | intraday |
> |---|---|---|
> | SPY (US-listed) | +8.92% | +2.28% |
> | XSP.TO (CAD, **hedged**) | +10.80% | +1.37% |
> | ZSP.TO (CAD, unhedged) | +16.81% | −1.94% |
> | **VFV.TO (CAD, unhedged)** | **+22.53%** | **−6.77%** |
>
> VFV and ZSP are the same index, same currency, same exchange, both unhedged —
> and differ by **5.7pp/year**. Two wrappers around one index cannot pay different
> premia. It is not currency either: USD/CAD overnight drift is +2.10%/yr and its
> correlation with VFV's overnight return is **−0.010**. **+9.57%/yr is
> unexplained.** The TSX opening prints on Canadian-listed US-equity ETFs appear
> to print high and revert intraday.
>
> **Re-run on instruments with trustworthy opens** (`research/overnight_clean.py`):
>
> | | at the open | **at a realistic fill** |
> |---|---|---|
> | SPY | +5.82%, alpha t=5.69 | **+0.30%, alpha t=−0.27** |
> | XSP.TO | +4.57%, alpha t=4.13 | **−0.89%, alpha t=−1.43** |
> | XIU.TO | +3.33%, alpha t=3.52 | **−1.59%, alpha t=−2.76** |
> | *VFV.TO (artefact)* | *+20.51%* | *+12.62%* |
>
> **On clean data, with realistic execution, there is no alpha.** The $207/yr
> figure was ~15pp/yr of bad opening prices.
>
> **Why the earlier artefact test missed it:** the overnight/intraday reversal
> correlation on VFV was −0.016, which looked clean. That test detects *day-level*
> mean reversion. A systematic few-basis-point bias in where the open prints
> produces almost no day-level correlation while still inflating the overnight leg
> enormously. **Only an independent measurement of the same underlying catches it** —
> and two ETFs on one index were available the whole time.
>
> **What survives:** the two slow strategies below both trade **close-to-close**
> and never touch an opening price, so the artefact cannot reach them. They stand.

---

## ~~THE HEADLINE STRATEGY~~ *(WITHDRAWN — see correction above)*

**Gated overnight VFV.** Buy VFV.TO at the close, sell at the next open — but only
when all three gates are open:

1. VFV close is **above its 100-day moving average**
2. Position sized at **15% annualised vol target** ÷ trailing 20-day realised vol
3. **VIX3M / VIX > 1.05** (term structure in comfortable contango)

Holds ~68% of nights. ~170 round trips a year.

| | at the open | at a bad fill* |
|---|---|---|
| CAGR | **+20.51%** | +12.62% |
| **Sharpe** | **3.30** | **2.13** |
| **max drawdown** | **−5.6%** | −10.2% |
| **Calmar** | **3.69** | 1.23 |
| alpha vs S&P 500 | +16.57%/yr | +9.65%/yr |
| **alpha t-stat** | **11.55** | **6.84** |
| Information Ratio | 3.11 | 1.84 |
| **$/yr on $1,000** | **$207** (p5 $174) | **$128** (p5 $100) |

\* *"bad fill" = every sale executes 10% of the way from the official open toward
the session low. A deliberately punishing assumption.*

**The 5th-percentile year is positive in both cases.** A 1-in-20 bad year still
makes $100–$174.

### It replicates on a second, independent index

ZQQ.TO (Nasdaq 100), same rules, different underlying market, different fund,
different history: **+17.03% CAGR, Sharpe 2.39, maxDD −6.3%, alpha t = 9.05** (at
open); **+8.26%, Sharpe 1.24, alpha t = 4.01** (bad fill). Replication on an
instrument the rules weren't developed on is the strongest evidence available
short of live trading.

### Why each gate is there — mechanism, not curve-fitting

| gate | mechanism |
|---|---|
| **Overnight only** | Equity risk premium pays for risk you *cannot escape*. Overnight the market is shut — news arrives, you can't hedge, trim or stop out. Intraday you can do all three. Measured: **11 of 12 instruments have negative intraday returns.** |
| **Trend filter** | Skips nights inside bear markets, when overnight gaps are down. |
| **Vol target** | Volatility is forecastable (corr 0.365 day-to-day); returns are not (−0.156). Size down when the distribution widens. |
| **VIX contango** | When VIX3M/VIX inverts, vol-target funds and risk-parity books are *mandate-bound* to sell. That's forced flow — but during it, overnight gaps are the bad leg. At VIX ≥97th percentile the overnight return is **−0.099%** while the full day is +0.131%. |

**The gates don't just cut risk — they skip the nights where execution is worst.**
That's why the strategy survives bad fills: plain overnight collapses to alpha
t=0.26 under a bad fill; gated it holds at **t=6.84**.

---

## Supporting sleeve — vol-managed VFV (daily)

Weight = 10% vol target ÷ trailing 20-day vol. **~2 trades/year**, so execution
quality is irrelevant.

| | strategy | buy & hold |
|---|---|---|
| CAGR | +14.05% | +17.50% |
| Sharpe | **1.33** | 1.11 |
| max drawdown | **−13.0%** | −27.4% |
| alpha | **+3.52%/yr, t = 2.78** | — |
| PBO | **10.3%** (p = 0.030) | — |

The PBO line means: a grid of this shape with **no edge at all** produces a
number this low about 3 times in 100. That is a real but not overwhelming
result, and it is weaker than the bare "10.3%" makes it sound — see the PBO
correction at the top of this file.

---

## The highest-CAGR option, honestly labelled

**Vol-managed HQU (2× Nasdaq 100), 15% target: +29.32%/yr, maxDD −46.7%.**

But **alpha t = 1.82 — below the 2.0 bar.** It does not demonstrably beat holding
HQU. It's leveraged beta harvested safely, not proven alpha. **PBO 37.3%,
p = 0.33** — that is not weak evidence, it is no evidence: a grid with no
edge scores at least that well a third of the time. The PBO agrees with the
alpha t-stat here rather than rescuing it.

Note what the overlay does to the *instrument*: buy-and-hold HQU returned +7.42%
with a **−95.8%** drawdown. The vol overlay turns the same fund into +29.3% at
−46.7%, because decay scales with the *square* of volatility and the overlay cuts
exposure exactly when volatility spikes.

---

## What leverage does and doesn't do — tested twice, rejected twice

| | plain overnight | fully gated |
|---|---|---|
| VFV (unlevered) | +23.01%, t 6.54 | **+20.51%, t 11.55** |
| HSU (2× S&P) | −17.58%, t −3.82 | −2.38%, **t −0.68** |
| HQU (2× Nasdaq) | −11.17%, t −2.58 | +15.12%, **t 1.11** |
| HQU bad fill | −36.57% | +5.95%, **t −0.01** |

I predicted overnight-on-2× would give ~2× the premium. It gave **0.50×** on
Nasdaq and *negative* on S&P and TSX. Leveraged ETFs are swap-based; their opening
prints are noisier, and 2× amplifies execution error more than premium.

The gates rescue them from catastrophic to mediocre — but **never produce alpha**.
Leverage on the overnight sleeve is rejected on evidence, twice, under two
different rule sets.

**Where leverage does work:** vol-managed HQU on daily bars, at t=1.82. That's the
strategic use — applied where the mechanism supports it, rejected where it doesn't.

---

## Predicting big moves — the honest finding

```
corr( |return| today , |return| tomorrow )  = +0.365   MAGNITUDE
corr(  return  today ,  return  tomorrow )  = -0.156   DIRECTION
corr( VIX percentile , |return| tomorrow )  = +0.358
```

**Magnitude is strongly predictable. Direction is barely predictable at all.**

Knowing a big move is coming tells you the distribution is about to get wide — not
which side. That's why the profitable use of a volatility forecast is **sizing**,
not direction-picking, and it's why the vol overlay works while "predict the crash"
doesn't. The VIX dose-response confirms it: 5-day forward returns rise monotonically
from +0.17% to **+0.89%** across VIX percentile buckets.

---

## Venue economics — why any of this is possible

| | cost | consequence |
|---|---|---|
| Commission, TSX-listed | **$0** | — |
| FX on US-*listed* from CAD account | 1.5% each way | **3% round trip — kills everything** |
| USD account | $10/mo | 12% of $1,000 — kills everything |
| **CAD-denominated, TSX-listed** | **spread only** | **the universe** |

VFV round trip: **1.1bp**. Hyperliquid perp: **190bp**. 170× cheaper.

Canadian-listed ETFs give US exposure with no FX leg — conversion happens inside
the fund at institutional rates. **Canada has no Pattern Day Trader rule**, so
frequent trading in a $1,000 account is legal here (it is not in the US).

---

## Recommended allocation

**60% gated overnight VFV / 40% vol-managed VFV.**

Expected **$150–$200/year on $1,000** with a max drawdown under 10%. If you want
maximum CAGR and can accept a −47% drawdown, substitute vol-managed HQU for the
daily sleeve.

## What was rejected

- **Turn-of-month** — 72 cells, one cleared DSR 0.95, alpha t ≈ 0.
- **Overnight on leveraged funds** — twice, two rule sets, no alpha.
- **Diversified overnight basket** — VFV/ZSP correlate **+0.95** overnight; adding
  names made it worse (−4.39% at bad fill).
- **Daily VWAP** — 96–99% signal agreement with a plain SMA. Volume adds nothing.
- **XIC / XFN / XRE overnight** — stale-print artefacts (ON/ID corr −0.20 to −0.26).
- **Corwin-Schultz spread estimation** — returns 20bp for an ETF with a 1¢ quote.

## Before any real money

1. **Confirm ECN/pass-through fees** on TSX ETF orders. At ~170 round trips/year on
   a $600 sleeve, even $0.10/side would materially damage this.
2. **Confirm T+1 handling** — can you buy against unsettled proceeds?
3. **Prove limit-order fills** — measure actual fills vs the official open.
4. **TFSA tax** — frequent trading in a registered account can be reassessed as
   business income.
