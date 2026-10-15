# BluModel Studio: Plans, Exports and the Contractor Program

**Status:** approved by Gabe on 2026-10-04 ("build all of these … flesh out the ideas to flow better, just don't change them").
**Supersedes:** PRODUCT_SPEC §1's "homeowners use BluModel Studio free" business model, §5.1's pricing copy and §15 decision 2. Everything else in PRODUCT_SPEC stands.
**Packages:** G `billing` and H `contractors` (BUILD_PLAN §9b, §9c), plus small additions to F, A, C and E.

> **Pricing change, 2026-10-15 (Gabe):** *"Raise the contractor price to 99 cad, remove the 129 modeling plan and then add 3 new models to the contractor plan a month that we model ourselves; let's not advertise the 5 dollar export fee, just throw it in their face once they try."*
> - Every price is in **Canadian dollars**: kitchen unlock **$5 CAD**, Unlimited **$15 CAD/month**, Contractor **$99 CAD/month**. Rows stored before keep their own currency (US dollars) and amounts.
> - The Contractor plan **includes 3 custom 3D models a month**, made by our studio (§8). Custom models are **not sold** any more: the $129 Model pack is gone (no checkout, no rush). *Make custom models* is a Contractor-plan feature.
> - The $5 CAD kitchen unlock is **not advertised** (landing, pricing page, FAQ, home, editor hints, onboarding, Billing). A free user meets it only in the export dialog, next to Unlimited (§2).
>
> Where the original decisions below still say $5, $15 or $40 (USD), read the decisions above.

Gabe's original decisions (2026-10-04), verbatim in substance. These are fixed; the flows below only connect them:

1. Exports are not allowed unless paid.
2. **$5 one time** unlocks **one kitchen's** exports, forever, including re-exports after edits.
3. **$15 a month**: unlimited usage.
4. Free users: only exports are locked, and high-quality studio renders show a watermark until paid. Designing, saving, generating and sharing are unlimited.
5. **$40 a month Contractor program.** Contractors add to their own catalog, either by uploading their own models or by paying us to model their company's products. Contractor accounts add their own cost and a markup. The pitch: *"These are the cabinets you sell, and you can show your customers."*

---

## 1. Plans at a glance

| Plan | Price (CAD) | Who it's for | What it unlocks |
|---|---|---|---|
| **Free** | $0 | Anyone designing a kitchen | Design, save, generate, share without limits. Exports locked. Studio renders preview with a watermark |
| **Kitchen unlock** | **$5 CAD once, per kitchen**, offered only in the export dialog (not advertised) | A homeowner finishing one kitchen | Every export of *that* kitchen, forever, including re-exports after edits. Unwatermarked studio renders of that kitchen |
| **Unlimited** | **$15 CAD / month** | Designers and frequent users | Unlimited usage: every export of every kitchen, no watermarks |
| **Contractor** | **$99 CAD / month** | Kitchen contractors, cabinet shops, remodelers | Everything in Unlimited, **plus** the Contractor program (§4) and **3 custom 3D models a month**, made by our studio (§8) |

The prices live in one file, `src/data/plans.json` (with `currency: "cad"` and the Contractor plan's `includedModels: 3`); `server/lib/plans.mjs` refuses to start if they change without it. The server is the authority on what is charged and the client only displays it. The Pricing page shows **Free, Unlimited and Contractor** only; the Free card says exports are locked and quotes no export price.

**What counts as an export:** every item in the editor's Export menu: floor plan PNG, 3D view PNG, shopping list CSV, `.kitchen.json` design file, plus the studio render download (package A) and the contractor quote (§4.6).

## 2. The export paywall: flow

1. **A free user clicks any Export item.** The item shows a small lock and the menu footer reads "Exports are a paid feature".
2. **The Unlock dialog opens**, titled with the kitchen's name, and offers two cards side by side. This is the **only** place the one-kitchen unlock and its price appear:
   - **Unlock this kitchen - $5 CAD once.** "Every export for this kitchen, forever, including after you change it."
   - **Unlimited - $15 CAD/month.** "Exports on all your kitchens, no watermarks. Cancel anytime."
   - A text link underneath: "Are you a contractor? See the Contractor plan ($99 CAD/month) →".
3. **Signed out, or in `#/local`:** the dialog first asks them to create a free account. The local draft is saved into the new account as a kitchen, and the dialog continues for that kitchen. Nothing is lost.
4. **Payment** goes through the provider abstraction (§5): Stripe Checkout when keys are configured, otherwise the clearly labelled **DEMO** checkout page. It never asks for card fields in BluModel Studio.
5. **On return**, the editor reopens the kitchen and **automatically finishes the export they clicked** (the "resume intent" is kept in the URL / sessionStorage), then shows a toast: "Unlocked: exports for *Kitchen name* are yours."
6. **Already entitled** (an unlocked kitchen or an active plan): Export works immediately with no dialog; the lock icons disappear.

**Rules that keep it fair and simple:**
- An unlock belongs to the kitchen. A **duplicate** of an unlocked kitchen is a new kitchen and is not unlocked. Renaming or editing it keeps the unlock.
- Plans cover every kitchen the subscriber **owns**. A share-link visitor (a client) never gets exports from the sharer's plan.
- Cancelling a plan keeps access **until the end of the paid period**. Kitchens unlocked with $5 stay unlocked forever, regardless of plan.
- **Enforcement is on the server.** The CSV and the `.kitchen.json` file are produced by the server only for entitled callers (`POST /api/projects/:id/exports`). Image exports are rendered in the browser after the server confirms entitlement and records the export. A determined user can always screenshot the screen; what the paywall protects is the clean, full-resolution, dimensioned files. Say this in the FAQ honestly.

## 3. Studio-render watermark

- Free users can open **Studio render** (package A) and see the high-quality render **with a watermark**: a repeated diagonal "BluModel Studio · Preview" at low opacity plus a corner badge.
- **Download** is an export, so it follows §2. Once the kitchen is unlocked or the user is on a plan, the same dialog renders and downloads **without** the watermark.
- The normal on-screen 2D plan and 3D view are **never** watermarked. Design freely is the free promise.

## 4. The Contractor program ($99 CAD/month)

**The promise on the pricing page:** *"Show your customers the exact cabinets you sell, in their kitchen, at your price."*

### 4.1 Becoming a contractor
1. From Pricing or the Unlock dialog link, they choose **Contractor, $99 CAD/month** and check out. (The account menu shows *Contractor workspace* only to contractors; there is no "For contractors" entry for everyone else.)
2. A three-step **company setup**:
   - **Company:** business name and business phone (**both required**, checked in the browser and again by the server; the phone is normalised the same way as everywhere else, "(905) 555-0142" or "+<country code><digits>"), then logo, email, website and service area (optional). Every later save of the company needs both too. A contractor whose company was saved before this rule, with either missing, sees a *Finish your company details* card instead of the workspace until they add them (a lapsed, read-only contractor is not asked, since they can't save).
   - **Pricing defaults:** default markup %, for example 30%. This can be changed any time.
   - **Start your catalog:** quick-add a first product, upload a model, have our studio model it (one of the plan's 3 included models a month), or skip.
3. They land in the **Contractor workspace** (`#/pro`). Its tabs are Dashboard, My catalog, Price book, Brands I carry, Quotes, Make custom models and Company.

An Unlimited subscriber who upgrades is moved to Contractor; Stripe prorates the change, and demo mode simulates it.

### 4.2 My catalog: three ways to add what they sell
Everything in My catalog is **private to that contractor**. Other contractors, the public catalog and brand pages never see it.

1. **Quick add (no 3D model needed).** Pick a product type (base cabinet, wall cabinet, tall pantry, range, sink and so on), then enter:
   - name, SKU, line/collection (e.g. "Smith Shaker");
   - available widths;
   - door style (shaker, slab, fluted, glass), finishes (name + colour swatch), and photos (optional).

   BluModel Studio's parametric models draw it at true size in the plan and in 3D, so most cabinet lines look right **without modelling anything**. A contractor can set up a whole line in an afternoon. This is the fastest route to "these are the cabinets you sell".
2. **Upload your own model (GLB).** This is the same upload, validation report (size, triangles, bounding box vs declared dimensions, warnings) and 3D preview as the brand portal, saved to their private catalog.
3. **Have BluModel Studio model it (included: 3 a month).** This opens **Make custom models** (`#/orders/new?target=contractor`) with target **My catalog**: a product list where each product has a name, an optional brand, its UPC/EAN, an optional size, reference photos and notes. Each product is one model from the month's allowance (§8); nothing is paid. To model a **line**, list its pieces and name the line (over several months, or with extra models from us). The delivered models land **straight in My catalog**, ready to price.

Collections/lines group products in the catalog panel, for example "Smith Shaker: 14 pieces".

### 4.3 Brands I carry
- Toggle which public BluModel Studio brands, and the built-in generic catalog, show in **their** catalog panel while designing.
- Off means hidden from the contractor's catalog panel only. Existing kitchens that use those products are untouched.
- When designing, the catalog panel shows **My catalog first**, then the brands they carry.

### 4.4 Price book: cost and markup
One table of everything they sell: their own products plus the public products they carry. For each product it shows **list price** (public products only), **your cost**, **markup %**, **sell price** and **margin**.

**Your cost.** Contractor accounts add their own cost:
- type it per product, or per width where widths are priced differently;
- for a carried public brand, set a **default "% off list"** once, then override any product;
- or **import a CSV** from their supplier's price list (SKU, name, width, cost). BluModel Studio matches SKUs, then shows a preview of matched, new and unmatched rows before applying. The price book can also be exported as CSV.

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
1. **Branded share link.** A share link from a contractor reads "Prepared by **Smith Kitchens**" with logo, phone, email and website, and shows the kitchen in 2D/3D with **their products at their sell prices**, with no costs. The client gets a clear "Contact Smith Kitchens" button (tel / mailto) and "Duplicate to my kitchens" is hidden. The client sees the contractor, not BluModel Studio, as the seller.
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
  - **Stripe**: Checkout `mode=payment` for the $5 CAD unlock, `mode=subscription` for $15 CAD and $99 CAD (inline `price_data`, currency `cad`), a **customer portal** session for cards, invoices and cancellation, and webhooks for `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.paid` and `invoice.payment_failed`;
  - **DEMO** when keys are absent: a full-width DEMO banner, simulated success, decline, renewal and cancel, and no card fields anywhere.
- **One Stripe webhook endpoint** (owned by package C). It verifies and dedupes each event, then dispatches by `metadata.kind` (`order` | `kitchen_unlock` | `subscription`) to handlers that each package registers.
- **Account → Billing** (`#/account/billing`) shows:
  - the current plan, status and renewal or end date;
  - Change plan (Unlimited ↔ Contractor) and Cancel (takes effect at period end);
  - a "Manage payment & invoices" button (the Stripe portal; simulated in demo);
  - the list of unlocked kitchens and receipts.
- **Failed renewal:** a 7-day grace period with a banner, then the plan drops to Free (the §4.7 rules apply to contractors).
- **Admin → Billing** shows active subscriptions by plan, MRR, unlock count, churn, and demo kept separate from Stripe, as in Revenue; money is summed per currency.
- **Currency (2026-10-15):** every new checkout, subscription, unlock and receipt is CAD. A row stored before keeps its currency and amount (refunds and history in their own currency). An existing subscription is never silently repriced: it renews at what it was billed at, and a plan change or a new subscription takes the CAD price. A Stripe customer that paid in USD can't be charged in CAD, so `billing_customers` keeps one Stripe customer per user **and currency** and a CAD checkout starts a fresh one; a Stripe subscription still billed in USD can't be switched in place (`409 currency_change`: cancel, then subscribe).

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
3. ~~Multi-product modelling requests are priced per item at the normal tiers.~~ Superseded 2026-10-14 by the Model pack, which was itself superseded 2026-10-15: custom models are included in the Contractor plan (§8), 3 a month.
4. A contractor account is **one login** (no team seats yet).
5. Quotes support an optional tax % and a "valid until" date. There are no e-signature or deposit payments yet.
6. Contractor share links hide "Duplicate to my kitchens", so clients stay with the contractor.

## 8. Make custom models: included in the Contractor plan (decided 2026-10-15)

Supersedes the Model pack ($129 for up to 8 products, 2026-10-14, never on the live site) and PRODUCT_SPEC §7.2's per-product tiers (Simple $129 / Standard $279 / Complex $549, +$39 per extra finish, rush +50%). **Custom models are not sold.** There is no checkout, no rush and no per-model price for anything new.

| | |
|---|---|
| **Included** | **3 custom 3D models a month** with the Contractor plan ($99 CAD/month), made by our studio |
| Per product | one true-to-size 3D model (GLB + thumbnail): **one model per product** |
| Finishes | up to **3 per model** |
| Revisions | **2 rounds per model** |
| Turnaround | about 15 business days after the request is sent |
| More | *Need more? Contact us* (`SUPPORT_EMAIL`); an admin can grant extra models for the current month |

**The allowance** (`server/payments/allowance.mjs`; the server enforces all of it, the form only explains it):
- The month is the subscription's **current billing period**; a complimentary plan (no period) uses the calendar month, UTC.
- A model counts **when its request is sent**. It goes **back to the allowance** if the request is cancelled **before work starts**, by the contractor (*Withdraw request* on its page) or by the studio (*Cancel request…* in the queue drawer, with a reason the contractor sees). Once the studio starts, it counts.
- **Unused models don't roll over.** Grants apply to the period they were given in only.
- Past the allowance the form says how many are left and when it resets (*"N of 3 models left this month - resets November 15"*), lets the request be prepared but not sent, and offers *Need more? Contact us*. The server answers `409 { needs: 'allowance', allowance }` with the reset date.
- `POST /api/orders` checks the plan, counts the period's models and inserts the order **in one transaction**, so two requests sent at once can't both take the last model. Without the plan it answers `403 { needs: 'contractor' }`.
- **If the plan lapses**, requests already sent are still made and delivered; no new ones can be sent (the request page says so and points to Billing).
- **Admin → Studio → Extra models for a contractor** (or the drawer of one of their requests): an admin grants 1-50 extra models for the contractor's **current** period, with a note. Every grant is in the admin audit log (`model_grant`). `GET /api/admin/model-allowance?email=`, `POST /api/admin/model-grants`.

**What each product needs** (unchanged from the pack): a **name** and a **product type**; optionally its **brand**; its **UPC** typed, pasted, scanned (BarcodeDetector) or as a **photo of the barcode** (UPC-A, EAN-13, EAN-8, check digit verified, stored as digits only); optionally its **size**; up to 8 **reference photos** and **notes**. A product needs at least one way to identify it: a photo, a UPC, a barcode photo, or the catalog product it started from.

**Where it shows:**
- Contractors: *Make custom models* in the account menu (`#/orders`: what is left this month, their requests) and the workspace tab (`#/pro/modelling`). Deliveries land privately in My catalog (§4.2), or, if they choose, privately in their own kitchens or as a draft in a partner brand they belong to.
- Everyone else: **no menu entry**. `#/orders` (linked from Billing when they have orders) lists their earlier orders read-only, with receipts and refunds working, and a note that custom models come with the Contractor plan. `#/orders/new` shows that note instead of the form.
- The Pricing page's Contractor card lists *"3 custom 3D models a month, made by our studio"*; its *Make custom models* section has no price.

**Orders paid for before 2026-10-15** keep their stored prices, currency (USD), statuses, turnaround and refund paths: checkout of one still unpaid, the Stripe webhook and return sync, refunds and the revenue report all work as before. The retired tier names (and *Model pack* for the few development-database pack orders) only label them.

**Data:** a request is an order with `tier = provider = 'plan'`, `amount_cents = 0`, `currency = 'cad'`, status `paid` (the studio queue's "to start"), and `plan_period_start/end` (the period it counted against). `model_grants` holds the extra models (`pricing-002-included-models` rebuilt `orders`/`order_items` to allow tier `plan`, copying every existing row as is).

**The studio** sees each product's brand, UPC (grouped as printed, with its format) and barcode photo in the queue and the drawer, and, on a plan request, where the contractor stands this month. A delivered model's description names the brand and UPC the buyer gave, so a contractor can match it to the stock it stands for.
