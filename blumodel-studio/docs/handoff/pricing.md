# Handoff: the 2026-10-15 pricing change (key `pricing`)

Gabe, 2026-10-15: *"Raise the contractor price to 99 cad, remove the 129 modeling plan and then add 3 new
models to the contractor plan a month that we model ourselves; let's not advertise the 5 dollar export
fee, just throw it in their face once they try."* The spec is `docs/PLANS_AND_CONTRACTORS.md` (the
banner at the top, §1, §2, §5 and §8).

## What changed

1. **Canadian dollars** (code in 1b1b83d, labelled by a779343): `src/data/plans.json` is CAD (500 /
   1500 / 9900), checked at start by `server/lib/plans.mjs`. Every new checkout, unlock, subscription
   and receipt is CAD; stored rows keep their currency (`pricing-001-cad` marks old ones USD). A
   subscription is never silently repriced; `billing_customers` keeps a Stripe customer per currency;
   a USD Stripe subscription can't be switched in place (409 `currency_change`). Tests:
   `server/test/pricing-currency.test.mjs` (mocked fetch only).
2. **Custom models are included in the Contractor plan, 3 a month** (202eef2, c6005bb, 151050a):
   - `server/payments/allowance.mjs`: the period (subscription period, else calendar month UTC),
     what is used (requests not cancelled, by `created_at`), grants, `of()` / `grant()`.
   - `server/payments/orders.mjs`: `create()` checks the plan and the allowance and inserts in ONE
     transaction (403 `needs: 'contractor'`, 409 `needs: 'allowance'` with the reset date); a request
     is `tier = provider = 'plan'`, amount 0, CAD, status `paid` (the queue's "to start"),
     `plan_period_start/end`. `cancelPlanRequest()` (buyer or studio, before start) gives the models
     back. `createPriorOrder()` is for seeds and tests only (an order as sold before, USD).
   - `server/payments/tiers.mjs`: no prices; `includedQuote()`, `MODEL_TERMS`; `legacyQuote()` and
     `PACK` only label older orders.
   - `server/routes/orders.mjs`: `GET /api/orders/allowance`; `POST /api/orders` needs no payments;
     checkout/refund refuse plan requests; `POST /api/studio/orders/:id/cancel`;
     `GET /api/admin/model-allowance`, `POST /api/admin/model-grants` (admin, audit `model_grant`).
   - `server/db/migrations/pricing.mjs` `pricing-002-included-models`: rebuilds `orders` /
     `order_items` (tier `plan`, provider `plan`, the period columns), `model_grants`.
   - Client: the request form (`RequestWizard.tsx`) shows "N of 3 models left this month - resets
     <date>", sends with no payment, explains the reset and offers *Need more? Contact us*
     (`SUPPORT_EMAIL`); the order page says *Included* and offers *Withdraw request*; non-contractors
     get a note instead of the form, no menu entry, and their earlier orders read-only (linked from
     Billing); the studio drawer cancels and shows the contractor's standing; admins grant from the
     queue. `#/pro/modelling` and the setup copy follow.
3. **The $5 CAD unlock isn't advertised** (de99ebf): the Pricing page shows Free, Unlimited and
   Contractor only (no unlock card, FAQ or price), the render dialog's hint names no price, the Terms
   say paid features are priced at the point of purchase and describe the included models. The export
   dialog (`UnlockDialog.tsx`) is the one place it is offered: *Unlock this kitchen - $5 CAD once* and
   *Unlimited - $15 CAD/month*.

## Checks

- `server/test/pricing-models.test.mjs` (allowance rules, periods, race, grants, lapse),
  `orders.test.mjs` (plan requests end to end; orders from before through the live-database
  migration, DEMO checkout, refunds, expiry, revenue; the seed), `payments.test.mjs` (Stripe only for
  an older unpaid order; a plan request never reaches Stripe).
- QA: `scripts/qa/routes/pricing.mjs` (14 routes) and `orders.mjs` (24 routes), desktop 1440 and
  phone 390. The unlock wording in `core.mjs`, `integration.mjs`, `launch.mjs` and the pricing routes
  in `share.mjs` follow the new dialog and page.

## Open points for Gabe

- The seed's demo customer orders are now "orders paid before" (Standard, $279 USD) so the history,
  receipts and refund screens have something to show; the demo contractor has one included request.
- A contractor can also send models to "Just my kitchens" or a partner brand they belong to; each
  still counts against the allowance. Say if only My catalog should be allowed.
- Contractors can withdraw a request themselves before the studio starts (the brief said "if the
  studio cancels it"); it seemed kinder than an email. Easy to turn off (`POST /api/orders/:id/cancel`).
