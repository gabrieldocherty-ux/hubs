# Mise: Plans, Exports and the Contractor Program

**Status:** approved by Gabe on 2026-10-04 ("build all of these … flesh out the ideas to flow better, just don't change them").
**Supersedes:** PRODUCT_SPEC §1's "homeowners use Mise free" business model, §5.1's pricing copy and §15 decision 2. Everything else in PRODUCT_SPEC stands.
**Packages:** G `billing` and H `contractors` (BUILD_PLAN §9b, §9c), plus small additions to F, A, C and E.

Gabe's decisions, verbatim in substance. These are fixed; the flows below only connect them:

1. Exports are not allowed unless paid.
2. **$5 one time** unlocks **one kitchen's** exports, forever, including re-exports after edits.
3. **$15 a month**: unlimited usage.
4. Free users: only exports are locked, and high-quality studio renders show a watermark until paid. Designing, saving, generating and sharing are unlimited.
5. **$40 a month Contractor program.** Contractors add to their own catalog, either by uploading their own models or by paying us to model their company's products. Contractor accounts add their own cost and a markup. The pitch: *"These are the cabinets you sell, and you can show your customers."*

---

## 1. Plans at a glance

| Plan | Price | Who it's for | What it unlocks |
|---|---|---|---|
| **Free** | $0 | Anyone designing a kitchen | Design, save, generate, share without limits. Exports locked. Studio renders preview with a watermark |
| **Kitchen unlock** | **$5 once, per kitchen** | A homeowner finishing one kitchen | Every export of *that* kitchen, forever, including re-exports after edits. Unwatermarked studio renders of that kitchen |
| **Unlimited** | **$15 / month** | Designers and frequent users | Unlimited usage: every export of every kitchen, no watermarks |
| **Contractor** | **$40 / month** | Kitchen contractors, cabinet shops, remodelers | Everything in Unlimited, **plus** the Contractor program (§4) |

The prices live in one file, `src/data/plans.json`. The server is the authority on what is charged and the client only displays it, like `tiers.mjs` for custom models.

**What counts as an export:** every item in the editor's Export menu: floor plan PNG, 3D view PNG, shopping list CSV, `.kitchen.json` design file, plus the studio render download (package A) and the contractor quote (§4.6).

## 2. The export paywall: flow

1. **A free user clicks any Export item.** The item shows a small lock and the menu footer reads "Exports are a paid feature".
2. **The Unlock dialog opens**, titled with the kitchen's name, and offers two cards side by side:
   - **Unlock this kitchen: $5, one time.** "Every export for this kitchen, forever, including after you change it."
   - **Go Unlimited: $15/month.** "Exports on all your kitchens, no watermarks. Cancel anytime."
   - A text link underneath: "Are you a contractor? See the Contractor plan ($40/month) →".
3. **Signed out, or in `#/local`:** the dialog first asks them to create a free account. The local draft is saved into the new account as a kitchen, and the dialog continues for that kitchen. Nothing is lost.
4. **Payment** goes through the provider abstraction (§5): Stripe Checkout when keys are configured, otherwise the clearly labelled **DEMO** checkout page. It never asks for card fields in Mise.
5. **On return**, the editor reopens the kitchen and **automatically finishes the export they clicked** (the "resume intent" is kept in the URL / sessionStorage), then shows a toast: "Unlocked: exports for *Kitchen name* are yours."
6. **Already entitled** (an unlocked kitchen or an active plan): Export works immediately with no dialog; the lock icons disappear.

**Rules that keep it fair and simple:**
- An unlock belongs to the kitchen. A **duplicate** of an unlocked kitchen is a new kitchen and is not unlocked. Renaming or editing it keeps the unlock.
- Plans cover every kitchen the subscriber **owns**. A share-link visitor (a client) never gets exports from the sharer's plan.
- Cancelling a plan keeps access **until the end of the paid period**. Kitchens unlocked with $5 stay unlocked forever, regardless of plan.
- **Enforcement is on the server.** The CSV and the `.kitchen.json` file are produced by the server only for entitled callers (`POST /api/projects/:id/exports`). Image exports are rendered in the browser after the server confirms entitlement and records the export. A determined user can always screenshot the screen; what the paywall protects is the clean, full-resolution, dimensioned files. Say this in the FAQ honestly.

## 3. Studio-render watermark

- Free users can open **Studio render** (package A) and see the high-quality render **with a watermark**: a repeated diagonal "Mise · Preview" at low opacity plus a corner badge.
- **Download** is an export, so it follows §2. Once the kitchen is unlocked or the user is on a plan, the same dialog renders and downloads **without** the watermark.
- The normal on-screen 2D plan and 3D view are **never** watermarked. Design freely is the free promise.

## 4. The Contractor program ($40/month)

**The promise on the pricing page:** *"Show your customers the exact cabinets you sell, in their kitchen, at your price."*

### 4.1 Becoming a contractor
1. From Pricing, the Unlock dialog link, or the account menu ("For contractors"), they choose **Contractor, $40/month** and check out.
2. A three-step **company setup**:
   - **Company:** name, logo, phone, email, website, service area.
   - **Pricing defaults:** default markup %, for example 30%. This can be changed any time.
   - **Start your catalog:** quick-add a first product, upload a model, request modelling, or skip.
3. They land in the **Contractor workspace** (`#/pro`). Its tabs are Dashboard, My catalog, Price book, Brands I carry, Quotes, Modelling requests and Company.

An Unlimited subscriber who upgrades is moved to Contractor; Stripe prorates the change, and demo mode simulates it.

### 4.2 My catalog: three ways to add what they sell
Everything in My catalog is **private to that contractor**. Other contractors, the public catalog and brand pages never see it.

1. **Quick add (no 3D model needed).** Pick a product type (base cabinet, wall cabinet, tall pantry, range, sink and so on), then enter:
   - name, SKU, line/collection (e.g. "Smith Shaker");
   - available widths;
   - door style (shaker, slab, fluted, glass), finishes (name + colour swatch), and photos (optional).

   Mise's parametric models draw it at true size in the plan and in 3D, so most cabinet lines look right **without modelling anything**. A contractor can set up a whole line in an afternoon. This is the fastest route to "these are the cabinets you sell".
2. **Upload your own model (GLB).** This is the same upload, validation report (size, triangles, bounding box vs declared dimensions, warnings) and 3D preview as the brand portal, saved to their private catalog.
3. **Have Mise model it (paid).** This opens the custom-model request (PRODUCT_SPEC §7) with target **Contractor**: reference photos, dimensions, spec sheet and notes, at the existing per-model tiers. To model a **line**, one request can hold **several products of the same line**; each is priced per item at its tier, and there is one checkout. The delivered models land **straight in My catalog**, already linked to their price-book rows.

Collections/lines group products in the catalog panel, for example "Smith Shaker: 14 pieces".

### 4.3 Brands I carry
- Toggle which public Mise brands, and the built-in generic catalog, show in **their** catalog panel while designing.
- Off means hidden from the contractor's catalog panel only. Existing kitchens that use those products are untouched.
- When designing, the catalog panel shows **My catalog first**, then the brands they carry.

### 4.4 Price book: cost and markup
One table of everything they sell: their own products plus the public products they carry. For each product it shows **list price** (public products only), **your cost**, **markup %**, **sell price** and **margin**.

**Your cost.** Contractor accounts add their own cost:
- type it per product, or per width where widths are priced differently;
- for a carried public brand, set a **default "% off list"** once, then override any product;
- or **import a CSV** from their supplier's price list (SKU, name, width, cost). Mise matches SKUs, then shows a preview of matched, new and unmatched rows before applying. The price book can also be exported as CSV.

**Markup.** The company default, overridable per brand/line and per product. Sell price = cost × (1 + markup). A product with no cost uses its list price as the sell price and is flagged "no cost entered".

**Costs are private.** The server never sends cost or margin to anyone but the contractor: not in share links, client views, exports or quotes. Tests prove it.

### 4.5 Designing with a customer
- Each kitchen has a **client** field (it already exists). The contractor's Home screen groups kitchens by client.
- **Easy on a tablet in the client's home:** drag items with a finger, pinch, and tap-to-place (the easy-move work).
- The estimate panel has a **Contractor view / Client view** toggle:
  - Contractor view shows cost, markup, margin and sell per line, plus totals and overall margin.
  - Client view shows sell prices only, and is what goes on screen when the client is looking.
- **Extra lines:** add labour or service lines such as installation, demolition or delivery (label, amount, optional cost) to a kitchen's estimate. They appear in the quote.

### 4.6 Showing and selling to the customer
1. **Branded share link.** A share link from a contractor reads "Prepared by **Smith Kitchens**" with logo, phone, email and website, and shows the kitchen in 2D/3D with **their products at their sell prices**, with no costs. The client gets a clear "Contact Smith Kitchens" button (tel / mailto) and "Duplicate to my kitchens" is hidden. The client sees the contractor, not Mise, as the seller.
2. **Quote.** A branded, printable quote page (`#/pro/quote/:projectId`) with:
   - company header and client name;
   - the kitchen's plan and 3D images;
   - line items at sell price, grouped by category, plus the extra lines;
   - subtotal, an optional tax % (set in Company defaults) and total;
   - a "valid until" date and notes;
   - a footer with the visualizer disclaimer.

   It is printable or saveable as PDF from the browser. It's an export, and contractors are always entitled.
3. **Presentation mode:** full screen, Client view forced and costs hidden, for showing a customer on a laptop or TV.

### 4.6b Brand page (added 2026-10-06)
A small tab of the workspace that publishes chosen My-catalog products as the contractor's public brand page, with a Verified contractor badge, a lead form and a leads inbox. Full design in [BRAND_PAGE.md](./BRAND_PAGE.md).

### 4.7 If the contractor plan lapses
- **Shares keep working** at the last sell prices, so clients are never broken.
- Kitchens and catalog data are **kept**, but My catalog, the price book, quotes and the workspace become **read-only** with a "Renew to keep selling" banner, until they resubscribe.
- Products they put in kitchens remain visible in those kitchens (snapshots).

## 5. Billing mechanics

- **Payments** reuse the provider abstraction from PRODUCT_SPEC §7.4:
  - **Stripe**: Checkout `mode=payment` for the $5 unlock, `mode=subscription` for $15 and $40, a **customer portal** session for cards, invoices and cancellation, and webhooks for `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid` and `invoice.payment_failed`;
  - **DEMO** when keys are absent: a full-width DEMO banner, simulated success, decline, renewal and cancel, and no card fields anywhere.
- **One Stripe webhook endpoint** (owned by package C). It verifies and dedupes each event, then dispatches by `metadata.kind` (`order` | `kitchen_unlock` | `subscription`) to handlers that each package registers.
- **Account → Billing** (`#/account/billing`) shows:
  - the current plan, status and renewal or end date;
  - Change plan (Unlimited ↔ Contractor) and Cancel (takes effect at period end);
  - a "Manage payment & invoices" button (the Stripe portal; simulated in demo);
  - the list of unlocked kitchens and receipts.
- **Failed renewal:** a 7-day grace period with a banner, then the plan drops to Free (the §4.7 rules apply to contractors).
- **Admin → Billing** shows active subscriptions by plan, MRR, unlock count, churn, and demo kept separate from Stripe, as in Revenue.

## 6. Data (summary; exact DDL in BUILD_PLAN §9b/§9c)
- `subscriptions`: user, plan (`unlimited` | `contractor`), status, provider + refs, current period end, cancel-at-period-end.
- `kitchen_unlocks`: project, user, payment ref.
- `export_events`: project, user, kind, time (no file contents).
- `contractor_profiles`: user, company name, logo file, phone, email, website, service area, default markup %, tax %.
- `carried_brands`: user, brand or `builtin`, on/off, default % off list, markup override.
- `price_book`: user, product, cost (per width), markup override.
- `estimate_extras` live in the kitchen doc: `{ label, amount, cost? }[]`. Costs inside the doc are stripped before any share or export wire.
- Contractor products are `products` rows with `source = 'contractor'`, `visibility = 'private'` and `owner_user_id` set to the contractor.

## 7. Open questions for Gabe (decisions made while fleshing out; overrule freely)
1. A duplicate of an unlocked kitchen is **not** unlocked, so $5 can't unlock a whole account.
2. The renewal grace period is **7 days**.
3. Multi-product modelling requests are priced **per item at the normal tiers**, with no volume discount yet.
4. A contractor account is **one login** (no team seats yet).
5. Quotes support an optional tax % and a "valid until" date. There are no e-signature or deposit payments yet.
6. Contractor share links hide "Duplicate to my kitchens", so clients stay with the contractor.
