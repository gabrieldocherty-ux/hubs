# Handoff: package B2 (the brand page inside the Contractor account)

Built 2026-10-07/08 on `mise/brands` (from `4f0a7a6`). Spec: `docs/BRAND_PAGE.md`; plan:
`docs/BUILD_PLAN.md` §16. It replaces the standalone §6 brand portal: there is no brand account
and no portal for outsiders. A contractor's company is the brand, and the Brand page is one tab of
the Contractor workspace.

## What shipped

- **Migration `brands-001-brand-pages-leads`** (`server/db/migrations/brands.mjs`). `brands` gains
  `kind` (contractor | partner, default partner, so F's existing rows are partner brands),
  `owner_user_id` (one contractor brand per owner, unique index), `cover_file_id`, `price_display`
  (from | show | on_request), `lead_form`, `show_phone`, `show_email`, `submitted_at`, `live_at` and
  `hidden_reason` ('lapsed'). New tables:
  - `brand_listings`: a My-catalog product → its public copy;
  - `leads`;
  - `brand_events` (brand_view, quote_click, lead; no IPs);
  - `brand_moderation_log`.
- **Server** (`server/brands/service.mjs`, `server/routes/brands.mjs`):
  - `/api/pro/brand…`, the tab (Contractor plan; lapsed = GET only; everyone else 403). It covers
    setup and settings, submit, preview, summary, products, publish / unpublish / publish a whole
    line, leads (list, status and notes, mark read) and analytics.
  - `/api/brands/by-slug/:slug…`, the public page, its contact card, beacons and the lead form.
  - `/api/admin/…`: moderation of pages and products (GLB report, field diff), and every brand
    (counts only for leads). Admins can create partner brands, suspend, reinstate, verify and
    unverify.
- **The public copy model.** Publishing never makes the contractor's private product public.
  - It creates a separate `source: 'brand'` product (the *copy*) holding only public fields:
    no cost, markup or buy link. The price follows the page's price display.
  - The copy goes `submitted → published`. On approval, its `live_spec` is written and its files
    become public.
  - Later edits to the My-catalog product re-project the copy:
    - content changes go back to review, and the live version stays public;
    - price changes (from the price book) go straight to the live copy.
  - Unpublish is instant. There is a cap of 50 live products (`BRAND_PRODUCT_LIMIT`).
- **Lapse and renew.** While the owner's plan isn't `contractor` (`services.billing.planOf`), the
  page shows "This page is unavailable" and its copies leave the catalog. Homeowners' kitchens keep
  them through snapshots. Renewal restores everything with no new review.
- **Leads.**
  - Only the owning contractor can read leads. Admins get counts only.
  - Status runs New → Contacted → Won / Lost, with private notes.
  - Leads have tel: and mailto: links (the subject names the product).
  - The new-lead badge shows on the workspace tab and on the Dashboard card.
  - Spam protection:
    - a honeypot field (`website_url`): the server answers 201 and stores nothing;
    - 5 leads an hour per IP (the route rate limit);
    - 3 a day per page per visitor, keyed on an in-memory hash of IP and brand. IPs are never
      stored.
- **Client** (`src/features/brands/**`):
  - the `#/pro/brand` tab: Overview (7/30/90 days, a by-day chart, top products), Products
    (readiness checklist, switches, Publish whole line), Leads, Settings (pre-filled from Company)
    and Preview;
  - the public `#/b/:slug` with the Verified contractor badge, products by line, Try in my kitchen,
    and Contact / Request a quote;
  - the lead form (consent, honeypot, attach one of my kitchens);
  - `QuoteButton` for product pages;
  - Admin Moderation and Brands;
  - `#/brand*` → `#/pro/brand*` (`BrandPortal`), with the Contractor plan pitch for everyone else.
- **Inside `src/features/contractors/**`** (the B2 override): the Brand page nav tab with its
  unread badge, the Dashboard card, and "Show on my brand page" switches in My catalog. Nothing the
  cloud session built was removed.
- **Attach one of my kitchens.** The form makes a view-only link through package E's
  `POST /api/projects/:id/shares` (label "Sent to <company>") and sends its token. The server keeps
  the token only if it is a live link that this user made for that kitchen, checked by a read-only
  query of E's `share_links`. If the lead fails, the link is revoked.
  - **Before E is merged:** the call 404s, and the lead carries the kitchen's name only. The inbox
    says so.
  - **After E is merged:** it works with no change.
- **Seed** (`server/seed/brands.mjs`, idempotent, fictional "(Demo)" names only):
  - two partner brands with fixture GLBs: Kestrel & Finch Appliances (Demo) and Marlow Lighting Co.
    (Demo);
  - the demo contractor `demo-brand@blumodel.test` with Alder & Pine Cabinetry (Demo). It is live and
    verified, has 7 published products (1 in review, 1 live with an edit in review), 1 product that
    isn't ready, 5 leads in every status and 30 days of demo analytics labelled "Demo data";
  - Birchwood Kitchen Studio (Demo), waiting in the page review queue.

  It runs cleanly after `mise/qa`'s `core.mjs`, twice. `demo-brand@blumodel.test` is then both Sam
  Sample of "BluModel Sample Co. (Demo)", which stays a partner brand, and the Alder & Pine contractor.

## Requests for files I don't own (integration pass)

1. **`src/components/AccountMenu.tsx`:** remove the brand-portal entry points
   (BRAND_PAGE §2 and BUILD_PLAN §16). Contractors reach the Brand page from the workspace, and
   everyone else has "For contractors" already. Delete:
   ```tsx
             {user.brands.length > 0 ? (
               <button role="menuitem" onClick={() => (setOpen(false), navigate({ name: 'brand', rest: '' }))}>
                 <b>Brand portal</b>
               </button>
             ) : (
               <button role="menuitem" onClick={() => (setOpen(false), navigate({ name: 'brand', rest: 'join' }))}>
                 <b>List your products</b>
               </button>
             )}
   ```
   Keep the `brand` route in `src/lib/router.ts`: old links still land on `BrandPortal`, which
   redirects.
2. **Viewer `src/features/viewer/ProductPage.tsx` (package A):** show the brand's Request a quote.
   `QuoteButton` renders nothing unless the product belongs to a live contractor brand that takes
   requests. In `.pp-actions`, after the "Buy from" link:
   ```tsx
   import { QuoteButton } from '../brands';
   …
             <Suspense fallback={null}>
               <QuoteButton product={product} className="btn big" />
             </Suspense>
   ```
   Then delete the `knownIssue` line from `product-page-request-a-quote` in
   `scripts/qa/routes/brands.mjs`. The runner fails a known issue that starts passing.
3. **Package H, `server/routes/contractors.mjs`:** push My-catalog and price-book edits to the live
   page at once. After the writes in `PATCH /api/pro/products/:id`, `…/archive`, `…/restore`,
   `PUT /api/pro/price-book/:productId`, `PUT /api/pro/price-book` and the CSV import (apply), add
   `await ctx.services.brandPages?.syncOwner(rc.user.id);`. Until then the same sync runs when the
   contractor opens the Brand page tab, when an admin opens Moderation, and every 10 minutes from
   `ctx.maintenance`. So a new cost can take up to 10 minutes to reach the public page.
4. **Foundation F (`server/app.mjs` / the products service):** add a catalog-visibility hook.
   - A plan lapses with time, not an event, so `routes/brands.mjs` wraps
     `services.products.catalogRows` and `services.products.inCatalog`. The wrapper re-checks
     lapsed contractors first. It is cheap: it re-runs only when 5 s have passed or a
     `subscriptions` row changed.
   - It also wraps `ctx.maintenance`.
   - It works and is tested, but wrapping a foundation service is fragile. A
     `products.addCatalogGuard(fn)` or a billing `onPlanChange(userId)` seam would let it go.
5. **Package E (share), optional:** register
   `services.share.createViewLink({ projectId, userId, label }) → { token }`. The lead route
   already prefers a token the client sent and falls back to this hook. Nothing else is needed:
   - the client calls E's public route;
   - the "Sent to <company>" links show up in the owner's Share dialog, where they can be turned
     off.
6. **`src/data/plans.json` (shared):** the Contractor card's bullets don't mention the brand page.
   Suggested 5th bullet: "Get found: a brand page with your products in 3D, and a leads inbox". E's
   Pricing band already has the line.
7. **Package C, `src/features/orders/OrderPage.tsx` (on `mise/orders`, line ~172):** a button links
   to `#/brand`. It still works, because it redirects to `#/pro/brand`, or to the pitch for
   non-contractors. Pointing it at `#/pro/brand/products` would skip the hop.
8. **Admin shell (F):** at 390 px the admin top bar's tabs run over the "BluModel Studio" wordmark (see
   `admin-moderation-phone.png`). This is not B2 code.
9. **Catalog panel (F), optional:** contractor-brand products show the company under the card
   (`p.brand`). BRAND_PAGE §5 says "by <company>". Prefixing "by " for contractor brands would need
   the brand kind on the wire product. Not done.

## Decisions made while building (overrule freely)

1. **A public copy, not the private row.** The spec says the contractor's product row gets
   `brand_id`. Making the private row public would expose its working spec and price-book
   linkage, and changing its source would break My catalog. The copy keeps the two worlds apart,
   and "Other contractors can use a contractor's published products" (§11.6) works because the
   copy is an ordinary brand product.
2. **Lapsed = `status 'suspended'` + `hidden_reason 'lapsed'`.** Admin sees "Hidden: plan lapsed",
   not "Suspended". An admin suspension is a different status note and is not undone by renewal.
3. **"From $X"** is the lowest sell price across a product's widths. "Show prices" shows the sell
   price per width. "Price on request" shows no price and passes the readiness price check.
4. **The page address can change until the page first goes live; the public name is fixed** once
   live ("ask BluModel Studio to change it").
5. **A page view counts once per visitor per half hour**, via an in-memory hashed key, so a reload
   loop doesn't inflate it.
6. **Admins can't read leads at all.** `/api/pro/brand/leads` returns 403 for them, and Admin →
   Brands shows counts.
7. **Opening Leads marks them read** (clears the badge). Status stays New until the contractor
   changes it.

## Checks (2026-10-08, this worktree)

- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npm test`: TS unit tests and server tests all pass. One test is skipped by design ("temp copies
  of real blumodel.db", which needs `BLUMODEL_UPGRADE_DB`). `server/test/brands.test.mjs` has 16 tests:
  - access (403/401 on every `/api/pro/brand` route);
  - setup pre-filled from Company;
  - the readiness gate;
  - the moderation round trip;
  - price display;
  - publish whole line and the cap;
  - leads private to the owner, with admins seeing counts only;
  - share-token checks;
  - spam limits;
  - a deep scan for cost and margin fields across the brand page, catalog, product page, lead and
    contact wires;
  - lapse and renew;
  - admin brands;
  - analytics;
  - `syncOwner`;
  - the seed;
  - the GLB report.
- `npm run build`: passes. Only the usual >500 kB chunk warning for `index` and `SceneView`, which
  aren't B2's.
- **QA:** `scripts/qa/routes/brands.mjs` has 25 routes at desktop and phone sizes. They ran under
  the real runner from `mise/qa` (copied into a scratch copy of this worktree, with its `core`
  seed): 24 pass, and 1 is a known issue (request 2 above). Every route only warns about the
  known Google Fonts request in `index.html`, which is not B2's.

## Not done, or not verified

- **No email for new leads.** This is by design (§6, §11.2): there is no email infrastructure yet.
- **The share-link attach path is verified only against a hand-made `share_links` table** (same
  schema as E's migration). It was not tested against E's running routes.
- **Request a quote on product pages** waits on request 2.
- **Business verification is a manual admin check** (§11.1). Nothing looks the business up.
- **The cover image upload is covered by the API tests and by the Settings screen in QA**, but QA
  doesn't upload a file.
- **Not tested in Safari or Firefox.** QA ran in headless Edge 154 on Windows.
