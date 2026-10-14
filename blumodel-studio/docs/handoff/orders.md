# Handoff: package C (orders: paid custom models, payments, studio queue, revenue)

Built 2026-10-06 → 10-08 on `mise/orders`, branched from `claude/gallant-ptolemy-lm7fux` at `4f0a7a6`
(port 8814). Plan: `docs/BUILD_PLAN.md` §7 and §13.3 C. Spec: `docs/PRODUCT_SPEC.md` §7.
Everything stays inside the package's owned paths; changes needed elsewhere are listed under
**Requests** at the end, each with a file, a reason and a suggested diff.

## What shipped

**Server**
- `server/db/migrations/orders.mjs` — `orders-001-orders`: `orders` (§7 C-T1 columns, plus `line`,
  `checkout_attempts`, `pending_since`; `target` is `customer | brand | contractor`; `user_id` is
  `SET NULL` on account deletion so revenue history survives), `order_items` (1–20 per order: brief,
  tier, extra finishes, price, deliverable, delivered_at), `order_events` (the timeline) and
  `payment_events` (an audit of every payment event that touched an order, demo and Stripe).
- `server/payments/tiers.mjs` — **the only price source**. Simple $129 / 7 business days, Standard
  $279 / 10, Complex $549 / 15; +$39 per extra finish beyond 2; rush +50% for half the days (rounded
  up); 2 revision rounds; ≤ 20 items. `quote({ items, rush })` →
  `{ amountCents, currency, dueBusinessDays, rush, items[], lines[] }`. Client amounts are never read.
- `server/payments/{index,demo,stripe}.mjs` — `selectProvider(ctx)`; the DEMO provider returns
  `/#/pay/demo/<id>`; the Stripe provider is REST through `ctx.fetch` (form-encoded Checkout Session
  with `price_data` per item from the server quote, `client_reference_id`, `metadata[order_id]` and
  `metadata[kind]=order` on the session and the payment intent, `customer_email`,
  `success_url=${PUBLIC_URL}/?session_id={CHECKOUT_SESSION_ID}#/orders/<id>`,
  `cancel_url=${PUBLIC_URL}/#/orders/<id>`, `Idempotency-Key: <orderId>-<attempt>`), `retrieve`, and
  `refund` (`POST /v1/refunds {payment_intent}`, idempotency key `refund-<orderId>`).
- `server/payments/orders.mjs` — the order service: validation, create, the one idempotent
  `markOrderPaid` (`UPDATE … WHERE status IN (draft, pending_payment, payment_failed, expired,
  cancelled)`: a payment that lands after an expiry or cancel is honoured, never lost), transitions
  with an event row only when something changed, 24 h expiry sweep, deliver, GLB report, refunds,
  revenue.
- `server/routes/orders.mjs`:
  - public: `GET /api/orders/tiers`, `POST /api/orders/quote` (live quote for the wizard);
  - buyer: `POST /api/orders`, `GET /api/orders`, `GET /api/orders/:id` (`?sync=1&session_id=` fulfils
    a Stripe return without waiting for the webhook), `POST /api/orders/:id/checkout`, `…/cancel`,
    `…/revision` (≤ 2), `…/accept`, `POST /api/payments/demo/:id/complete {outcome}` (owner only,
    demo provider only, refused in production unless `DEMO_PAYMENTS=1`);
  - studio (`auth:'studio'`): `GET /api/studio/orders?status=`, `POST …/:id/start`, `…/note`,
    `…/deliver {item, modelFileId, thumbFileId, name?, dims?, finishes?}`, `GET …/:id/report` (the
    GLB report before delivering);
  - admin: `POST /api/admin/orders/:id/refund`, `GET /api/admin/revenue?days=` (orders only; demo and
    Stripe kept apart);
  - webhooks: registers `services.webhooks.on('order', …)` (`checkout.session.completed`,
    `async_payment_succeeded`, `async_payment_failed`, `expired`; amount and currency are checked
    against the order and a mismatch is logged, not fulfilled) and `on('charge.refunded', …)` (a
    refund made in the Stripe dashboard refunds the order; a charge with no matching order — e.g. a
    kitchen unlock — is ignored). No route of its own: the foundation's webhook route verifies and
    dedupes.
- Delivery creates the product through `services.products`:
  customer → `source:'custom'`, private, owned by the buyer, live; contractor → `source:'contractor'`,
  private, owned by the buyer, live (their My catalog); brand → `source:'brand'`, a draft in that
  brand. Files are granted to the buyer (custom/contractor) or owned by the brand. A redelivery after
  a revision updates the same product. The order is `delivered` when every item is delivered.
- Refund (admin): demo marks refunded; Stripe calls `/v1/refunds`. A delivered custom/contractor
  product's live catalog entry is archived; kitchens keep their snapshots. Refunding twice is a 409.
- `server/seed/orders.mjs` — four DEMO orders for `demo-customer@blumodel.test` with fixed ids
  (`o_demoseedorder0000000000{1..4}`) in `paid`, `in_progress` (assigned to demo-studio),
  `delivered` (with a fixture GLB product and a reference photo) and `completed`. Idempotent;
  fictional product names only; skips production unless `ctx.forceDemo`.

**Client** (`src/features/orders/**`, own CSS in `orders.css`)
- `OrdersRoot`: `#/orders` (list with status chips: All / In the studio / Not paid / Delivered /
  Closed), `#/orders/new?ref=&brand=&target=` (the wizard), `#/orders/<id>` (the order page).
- `RequestWizard`: What → Size → Photos → Notes → Tier → Review & pay; drag-and-drop reference upload
  through `upload()` with `kind=reference` (≤ 8, PNG/JPEG/WebP); tier cards with a suggested tier per
  product type; the live server quote; "+ Add another product" (≤ 20 items, one checkout); a
  "Demo payments – no real money" banner whenever `payments === 'demo'`. The draft survives a reload
  (sessionStorage). Photos are optional when starting from a catalog product (`?ref=`).
- `OrderPage`: status, next-step card, deliverables on `ProductStage` with *Add to a kitchen* (picks
  a saved kitchen and opens it with `?add=`), *Request revision* and *Accept*; the brief, private
  reference thumbnails, the receipt and the timeline. Back from Stripe it reads
  `pageQuery().get('session_id')` and calls `?sync=1`.
- `DemoPay` (`#/pay/demo/:orderId`): full-width DEMO banner, order summary, *Simulate successful
  payment* / *Simulate declined payment* / *Cancel*. **No inputs of any kind** (QA asserts zero
  `<input>` elements and no card-like field or iframe on the page).
- `AdminStudioTab`: queue sorted by due date with status filters and counts (a card list on phones);
  a drawer (focus-trapped, Esc) with brief, private reference photos, timeline + notes, Start,
  Deliver per item (GLB + thumbnail upload, validation report, size/finishes, preview), and for
  admins Refund.
- `AdminRevenueTab`: KPI tiles (gross, refunds, net, average order, average turnaround), by-tier
  table, by-day bars with a table view, a DEMO label and banner when the provider is demo, Stripe
  totals shown separately.

## Checks (2026-10-08, this worktree)

| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | pass |
| `npm test` | pass: TS 66/66; server 93 pass, 0 fail, 1 skipped (the foundation's "real blumodel.db upgrade" test, skipped because no `BLUMODEL_UPGRADE_DB` is set — not this package) |
| `npm run build` | pass (Vite warns the main chunk is 685 KB and SceneView 954 KB; neither is this package's — orders code is all lazy) |
| QA, 16 routes in `scripts/qa/routes/orders.mjs`, headless Edge on 8814 | 16/16 pass, zero console errors, no non-local requests from this package |

`scripts/qa.mjs` does not exist on this branch yet (it's being built in parallel), so the routes were
run with a scratch runner that follows §3.7 (per-route role cookie, viewport + touch emulation at
DPR 3 for phones, `waitFor`, `expectText`, `setup`, `check`, failing on console errors and
non-local requests). Screenshots were checked by eye at 1440×900 and 390×844.

C-T7 tests: `server/test/payments.test.mjs` (8 tests: the six signature cases; demo vs Stripe
selection from env; the Stripe checkout request built on the server's amount with the idempotency
key and `{CHECKOUT_SESSION_ID}` in the query; webhook verified + deduplicated with one fulfilment and
no `X-BluModel` needed while other POSTs still need it; unverified → 400 with no change; amount mismatch
not fulfilled; expired/failed sessions; `?sync=1`; Stripe refunds both ways) and
`server/test/orders.test.mjs` (14 tests: quote ignores client amounts; brief validation and
other-user reference files → 400; demo draft → pending → paid, double complete idempotent, decline →
retry; demo refused in production without `DEMO_PAYMENTS`; studio/admin role gates; private
deliverable visible only to the buyer, GLB 404 to others / 200 to the buyer; brand-target draft;
contractor target + multi-item; revision limit; cancel only before payment; 24 h expiry with
`t.setNow`; refund archives; revenue math; the seed is idempotent). Stripe is only ever a mocked
`fetch`; no real Stripe call is made anywhere.

## Deviations from the plan (decide whether to keep them)

1. **Multi-item orders for every target**, not only contractors: `order_items` holds 1–20 items with
   one checkout; the `orders` row mirrors item 0 (`tier`, `brief`, `deliverable_product_id`) so the
   single-item `Order` wire still reads naturally. The wire adds `items[]`, `title`, `line`,
   `quote`, `dueAt`.
2. **Two webhook registrations:** `'order'` (by `metadata.kind`) and `'charge.refunded'` (by type),
   because a refund issued from the Stripe dashboard arrives as a charge event without our
   `metadata.kind`. The handler matches by payment intent and ignores anything that isn't an order.
3. **`markOrderPaid` also accepts `expired` and `cancelled`** orders: if the money arrived, the order
   is paid (logged on the timeline) rather than silently dropped.
4. **Extra routes:** `POST /api/orders/quote` (public live quote) and
   `GET /api/studio/orders/:id/report` (GLB report before delivery).
5. **Contractor target needs the Contractor plan** (`services.billing.planOf`) → 403
   `{ needs: 'contractor' }` otherwise.
6. **Drafts also expire** 24 h after creation if never paid (same sweep as pending checkouts).

## Not done / known gaps (plainly)

- **The full lifecycle was verified only through my scratch QA runner**, not `scripts/qa.mjs` (which
  doesn't exist yet). The two lifecycle routes (`orders-lifecycle-deliver` → `orders-lifecycle-accept`)
  share module state and must run in file order; they need `api.as(role).get/post` returning
  `{ status, body }` and an Edge build where `DataTransfer` can set `input.files` (true for Chromium).
- **The delivered model renders on package A's placeholder `ProductStage`** ("3D preview coming
  soon": the thumbnail, not the GLB). `orders.css` pins the placeholder's thumbnail inside the frame
  (`.ord-stage .product-stage--placeholder …`); those rules stop matching once A's real stage lands.
- **Share links showing a custom model** (PRODUCT_SPEC §7.1, BUILD_PLAN §10 smoke test) depend on
  package E's share route and the files API letting a share viewer read the buyer's private GLB. Not
  tested here.
- The seed needs the demo users (`demo-customer@`, `demo-studio@`) that the core seed is meant to
  create; neither `server/seed/index.mjs` nor `server/seed/core.mjs` exists on this branch, so I ran
  the orders seed from a scratch script after signing the users up.
- With B2 (brand page inside the Contractor account), the wizard's "for my brand" target still
  means "a draft in a brand I'm a member of". Whether a contractor with a brand page should get the
  choice between *My catalog* (contractor target) and *Brand page draft* (brand target) is a product
  call for Gabe; today both exist when the user has both.

## Requests (files this package doesn't own)

1. **`index.html` (F): Google Fonts break the offline rule (§1.8).** Every page requests
   `fonts.googleapis.com` / `fonts.gstatic.com`; the planned QA runner fails any non-local request,
   so every package's routes will fail on it. Suggested: self-host the three families under
   `public/fonts/` with `@font-face` in `src/styles.css`, and drop the three `<link>` tags:
   ```diff
   -    <link rel="preconnect" href="https://fonts.googleapis.com" />
   -    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
   -    <link href="https://fonts.googleapis.com/css2?family=Fraunces…&display=swap" rel="stylesheet" />
   ```
   (My scratch runner reported these as pre-existing rather than failing package C on them.)
2. **`server/seed/index.mjs` (F): run the orders seed after the core seed**, passing `forceDemo`
   through:
   ```js
   import { seed as seedOrders } from './orders.mjs';
   // after core (which creates demo-customer@ / demo-studio@ / demo-admin@):
   log(`orders: ${JSON.stringify(await seedOrders({ db, config, services, now, forceDemo }))}`);
   ```
3. **Product page (A, `src/features/viewer/ProductPage.tsx`): a "Request this as a custom model"
   link** to `#/orders/new?ref=<product id>` (the wizard prefills type, name and size from it).
4. **Pricing page (E):** read tiers from `GET /api/orders/tiers` (`{ tiers: [{ id, name, for, priceCents,
   businessDays, revisions }], includedFinishes, extraFinishCents, maxExtraFinishes, rushPct, maxItems,
   currency, payments, demo }`) rather than
   hard-coding $129 / $279 / $549.
5. **`scripts/qa.mjs` (runner being built):** run routes in file order within a package, and give
   `setup`/`check` an `api.as(role)` with at least `get(path)` and `post(path, body)` →
   `{ status, body }`. The orders routes use nothing else.
6. **Share (E) / files (F):** a shared kitchen that uses a buyer's private custom or contractor
   product must let anonymous share viewers fetch that product's GLB and thumbnail (scoped to
   products in the shared doc). Suggested test: deliver → buyer places it → share → anonymous GET of
   the model file via the share is 200, while the plain file URL stays 404 to strangers.
