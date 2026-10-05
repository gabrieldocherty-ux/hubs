# Handoff: package G (billing) and the §13.2 foundation hooks

Built 2026-10-04/05 in a Claude Code cloud session, on top of `claude/mise-kitchen-handoff`
(foundation WIP + easy move + sink realism). Spec: `docs/PLANS_AND_CONTRACTORS.md` §1–§3, §5;
plan: `docs/BUILD_PLAN.md` §13.2 and §14.

## What shipped

- **Foundation hooks (§13.2), server:** `src/data/plans.json` (0 / 500 / 1500 / 4000¢, checked at
  startup by `server/lib/plans.mjs`); `services.webhooks`, `services.billing`, `services.pricing`,
  `services.contractors` with fail-closed defaults (`server/lib/hooks.mjs`); `platform-002` rebuilds
  `products` so `source` may be `'contractor'` (foreign keys off for the rebuild, so
  `product_events` survive; the runner now supports `foreignKeys: 'off'` steps); `platform-003`
  `webhook_events`; `extras` validated in saved kitchens; `/api/auth/me` returns `plan` and
  `contractor`; `billing` and `contractors` migration, route and test modules.
- **Foundation hooks, client:** router `billing` (`#/account/billing`), `pro` (`#/pro/<rest>`),
  `payDemoPlan` (`#/pay/demo-plan/:ref`), admin tab `billing`; App gating; AccountMenu (Billing,
  Contractor workspace / For contractors); every Export menu item and the estimate's CSV button go
  through `requestExport`; `buildEstimate(doc, { priceOf })` with cost fields and `doc.extras`;
  `flushAutosave()`; a shared `Dialog` (focus trap, Esc).
- **The export kit:** `scripts/build-kit.mjs` bundles `src/lib/exportKit.ts` (estimate, CSV,
  contractor price math, built-ins) into `server/generated/export-kit.mjs` (gitignored; built by
  `build`, `api`, `test:server`). The server's CSV is byte-for-byte the editor's: a golden file
  (`server/test/fixtures/golden/sample-shopping-list.csv`) is checked from both sides.
- **G server:** `billing-001`; `server/billing/{service,stripe}.mjs`; `server/routes/billing.mjs`:
  plans, entitlements, me, checkout (Stripe `mode=payment|subscription` or DEMO), checkout info,
  demo complete, demo simulate (renewal / failed renewal / period end / grace end), return sync,
  portal, change, cancel, resume, `POST /api/projects/:id/exports`, `GET /api/admin/billing`;
  webhook handlers for checkout, `customer.subscription.*` and `invoice.*` (both Stripe API shapes).
- **G client:** `useEntitlements`, `requestExport`, `useResumeExport` (the paid export finishes by
  itself after DEMO or Stripe), `BillingHost` + the lazy Unlock dialog (account step for device
  drafts), `BillingPage`, `DemoPlanPay`, `AdminBillingTab`.

## Deviations from the plan (decide whether to keep them)

1. **The Stripe webhook route is the foundation's** (`server/routes/webhooks.mjs`), not package C's.
   C hadn't started and G needed it. C now only registers `services.webhooks.on('order', …)`.
2. **`DemoPlanPay` takes `checkoutRef`, not `ref`.** React reserves `ref`; the planned prop could
   never reach the component.
3. **`services.pricing` gained `priceBookFor(ownerId)`** (server-internal) and **`sellPricesFor`**;
   `SharedKitchenWire` gained **`prices`** (sell prices for every product, built-ins included,
   because built-ins are priced in the browser). The client side is `setSharedPrices()` from
   `src/features/contractors`. See the E notes below.
4. **Webhook handlers are synchronous** and run in the same transaction as the dedupe insert, so a
   throwing handler leaves the event unrecorded and Stripe's retry is processed.
5. **Plan changes in Stripe mode** update the subscription item with `price_data` on a Stripe
   Product created on first use (`billing_stripe_products`). Cancel/resume use
   `cancel_at_period_end`. The customer portal needs a portal configuration in the Stripe dashboard.
6. **Demo renewals:** a demo plan renews itself at each period end (with a receipt). The Billing page
   has demo-only buttons for renewal, failed renewal, ending the period and ending grace.
7. `vite.config.ts` proxied `/api` to **8787** (bug #8, an F task not yet done); it now uses
   `MISE_API_PORT ?? 8790` and also proxies `/files`.
8. **The home server (`npm run deploy:local`) allows DEMO payments by default**: `run-server.cmd`
   sets `DEMO_PAYMENTS=1`. It runs `--prod`, so without Stripe keys every export would otherwise
   stay locked with no way to unlock it. Stripe still takes over once both keys are set. Set
   `MISE_DEMO_PAYMENTS=0` and redeploy before real customers use it. Each deploy also copies
   `data\mise.db` (with its WAL files) to `data\backups\<time>\` before the new migrations run, and
   keeps the last 5.

## For the other packages

- **A viewer:** `useEntitlements(projectId).watermark` is ready; the studio render must watermark
  its preview when true and download through `requestExport(projectId, 'render', …)`.
- **C orders:** register `services.webhooks.on('order', handler)` (synchronous, idempotent). Don't
  add another `/api/webhooks/stripe`. A contractor-target order should create `source:'contractor'`
  products (the products service accepts it: private, owner set, no brand).
- **E share:** in `GET /api/share/:token` call `services.pricing.applyForViewer(ownerId, products,
  { viewer: null })`, `services.pricing.stripDoc(doc, { viewer: null, ownerUserId })`,
  `services.pricing.sellPricesFor(ownerId, doc)` → `prices`, and
  `services.contractors.brandingFor(ownerId)` → `preparedBy` (set `hideDuplicate` when it isn't
  null). In `SharedKitchen`, call `setSharedPrices(wire.prices ?? null)` before opening the doc and
  `setSharedPrices(null)` on unmount. The pricing page can read `src/data/plans.json`. In view mode
  the TopBar's exports route a visitor through the Unlock dialog, which saves a copy to their account;
  decide whether contractor shares (hideDuplicate) should hide Export instead.

## Not done, or not verified

- No seeds and no `scripts/qa` routes: the foundation's seed and QA runner (F-T9, F-T12) don't exist
  yet on this branch. Verified instead with Playwright scripts in the session scratchpad (homeowner
  paywall → demo unlock → auto-export; device draft → account → unlock; Billing; Admin → Billing;
  phone width), all with no console errors.
- Stripe is exercised only with a mocked `fetch` (tests). No real Stripe account was used.
- The main chunk is 685 KB against the 675 KB budget (667 KB before this work): the paywall and the
  price book have to load with the editor. Lazy-loading the contractor estimate extras would claw a
  few KB back.
- `index.html` still loads Google Fonts (pre-existing), against the plan's offline rule.
