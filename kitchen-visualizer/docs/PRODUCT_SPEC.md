# Mise: Product Spec

**Status:** draft for the overnight build, 2026-10-03. Owner: Gabe. Written by Claude, acting as product and tech lead.
**Companion:** [`BUILD_PLAN.md`](./BUILD_PLAN.md) breaks this spec into one foundation package and five parallel feature packages.

> Gabe's brief, verbatim: *"clone drafted for a kitchen design program with uploadable brands and paid custom models for potential customers, this is a realistic product viewer"*.
> Earlier asks, all already built: room dimensions, branded products, layout + rendering, use as a visualizer, accounts, saved projects, a setup wizard, autosave.

Each decision below carries a tag in square brackets, such as [D1] or [T9], naming the research finding or code-map item behind it. §14 lists every tag. Decisions Claude made on Gabe's behalf are marked **(decision)** and are collected again in §15 so he can overrule them.

---

## 1. What Mise is

Mise does for kitchens what Drafted does for houses. A homeowner describes a kitchen. Mise generates several layouts that pass the design checks. The homeowner picks one, edits it in 2D and 3D, sees the products realistically, gets an estimate and shares a link. Brands upload their own products, which then appear in kitchens and on their own product pages. Anyone can pay to have a custom 3D model made of a product that isn't in the catalog yet.

There are three audiences, and each has its own entry point:

| Audience | Gets | Pays |
|---|---|---|
| **Homeowners and designers** (role `customer`) | Describe-your-kitchen generation, the wizard and editor, realistic product pages, studio renders, estimates, share links | Nothing for design. Optional paid custom 3D models |
| **Brands** (any user with a brand membership) | Self-serve portal, product uploads (GLB + images + finishes + dimensions + price + SKU + buy link), moderation, brand page, analytics | Free during beta. Paid listing plans are planned but not built (§15 Q2) |
| **Mise staff** (roles `studio`, `admin`) | Moderation queue, custom-model studio queue, orders, revenue overview | n/a |

**Business model — superseded 2026-10-04 by [PLANS_AND_CONTRACTORS.md](./PLANS_AND_CONTRACTORS.md):** designing is free, but exports are paid ($5 per kitchen, once), with an Unlimited plan ($15/month) and a Contractor program ($40/month). The original decision read: homeowners use Mise free, brands are the customers, and custom models are a paid service. This is how the kitchen sector already works: IKEA's planner is free and drives product sales [K1]; Roomvo is paid for by manufacturers and gives them view and save analytics [K6]; Marxent and 2020 build or syndicate manufacturer catalogs [K4][K5]. Drafted plans to charge homeowners about $1–2k per plan set [D3], but no kitchen tool charges homeowners that way, so we don't copy that part [R-money].

**What "clone Drafted" means here (decision):** we copy Drafted's **UX patterns**: structured inputs, several generated options, regenerating with some choices locked, live 2D↔3D, and share links with permissions [D1][D2]. We do **not** copy its name, brand, copy, visuals or assets.

---

## 2. Everything that already works must keep working

These features exist today [MSRV][MDATA][M3D]. Each one gets a regression check in BUILD_PLAN.

- Accounts: sign up, sign in, sign out, rename, change password (which signs out other devices), 30-day sliding sessions, login throttle.
- Saved kitchens: list, create, open, rename, duplicate, delete, plus autosave (1.2 s debounce, Ctrl+S, flush on unload, retry).
- Device-only mode `#/local`, which works with no server at all.
- The 4-step setup wizard: basics, room, layout template (one-wall, galley, L, U, L + island) and style preset (8 presets).
- The editor: plan, split, 3D and walls views; drag, snap, rotate, flip, duplicate and nudge; undo and redo (120 steps); keyboard shortcuts; width and finish choices; room surfaces (cabinet finish, door style, hardware, countertop, backsplash, flooring, paint).
- The NKBA-style checks: collisions, out of room, aisles, island clearance, work triangle, ventilation, landing space, dishwasher-to-sink distance, door swing.
- The estimate panel and CSV, plan PNG, 3D PNG, `.kitchen.json` export and import.
- The 48 built-in products from 12 **fictional** brands (Nordwell, Corviq, Aurelle, Framewright, Grainhouse, Halbrook, Haldor, Halvard Pro, Hearth & Vine, Lumen & Lane, Nordlys, Oakhurst). They stay compiled into the app so that `#/local` and the templates work offline. They form the catalog's built-in seed.

---

## 3. Roles and access

| Role | How you get it | Can |
|---|---|---|
| Visitor (signed out) | n/a | See the landing, pricing, public product and brand pages, share links and `#/generate`; use `#/local` |
| `customer` (default) | Sign up | Everything above, plus saved kitchens, ordering custom models and creating share links |
| Brand member (`owner` or `editor` of a brand) | Create a brand (it starts `pending`) or be added by its owner | Manage that brand's profile and products, see its analytics. Only owners manage members |
| `studio` | Set by an admin | See and fulfil custom-model orders (studio queue) |
| `admin` | `ADMIN_EMAILS` env var, or `node server/scripts/make-admin.mjs <email>`. **Never through the API** | Everything: moderation, brands, users, orders, refunds, revenue |

The server enforces every rule in the route table [MSRV]. Client-side gating only hides UI.

---

## 4. Site map

Mise keeps hash routing. Query strings are now supported inside the hash, and `location.search` is read for Stripe's return.

| Route | Screen | Access | Package |
|---|---|---|---|
| `#/` | Signed in: My kitchens. Signed out: **Landing** | public | foundation / share |
| `#/welcome`, `#/pricing` | Landing, Pricing | public | share |
| `#/signin`, `#/signup` | Auth | public | existing |
| `#/new` | Setup wizard, now with a "Describe it" path | account | generate |
| `#/generate?q=&from=` | **Describe your kitchen** → options grid | public; saving needs an account or uses the device draft | generate |
| `#/k/:id?add=<productId>` | Editor (`add` places a product once the kitchen loads) | account, owner | existing / foundation |
| `#/local` | Device-only editor | public | existing |
| `#/p/:productId?finish=` | **Realistic product page** | public for published public products; private ones only for entitled users | viewer |
| `#/b/:slug` | Public brand page | public | brands |
| `#/brand/...` | Brand portal (join, dashboard, products, product editor, analytics, members, profile) | account | brands |
| `#/orders/...` | Custom models: `new`, list, `:id` detail | account | orders |
| `#/pay/demo/:orderId` | Demo checkout, clearly labelled | account, owner | orders |
| `#/s/:token` | Read-only shared kitchen | public (token) | share |
| `#/admin/:tab` | Admin: overview, moderation, brands, studio, revenue, users | `admin`; `studio` sees only the studio tab | foundation shell + brands + orders |

---

## 5. Customer features

### 5.1 Landing and pricing (package: share)

- **Landing** (signed-out `#/` and `#/welcome`): a hero image that is a real Mise render made by the QA script, not stock art; "How it works" in five steps (Describe → Pick from 5 options → Edit in 2D/3D → See the real products → Share); a section for brands; a section for custom models; calls to action (*Describe your kitchen* → `#/generate`, *Start free* → signup, *Try without an account* → `#/local`). The footer carries the visualizer disclaimer (§12).
- **Pricing (superseded, see PLANS_AND_CONTRACTORS §1 and BUILD_PLAN §13.3):** the four plans from `src/data/plans.json` come first. The original copy read: homeowners are free. Brands are free during beta, up to `BRAND_PRODUCT_LIMIT` published products (default 50); the planned per-product-count tiers are labelled *Planned*, an idea taken from Zakeke's product-count tiers [K7]. Custom-model tiers are read live from `GET /api/orders/tiers`. An FAQ covers demo payments, file formats, turnaround and revisions.

### 5.2 Describe your kitchen: generated layout options (package: generate)

This is the Drafted-style core [D1]. It runs **offline and rule-based by default**. An LLM is only ever an optional parser in front of it.

**Inputs.** The primary input is a structured *brief*. Drafted deliberately avoids free-text prompts [D1]. We accept free text too, but only to *fill in* the brief, which is shown back as editable chips so the user can see what was understood.

| Brief field | Values | Default |
|---|---|---|
| Room | width × length × ceiling (ft-in or cm); 72–480 in, ceiling 90–144 in | 12′ × 14′ × 9′ |
| Layout types allowed | one-wall, galley, L, U, L + island; "auto" = all that fit | auto |
| Range | width 30 / 36 / 48; fuel gas / induction / dual-fuel | 30 gas |
| Fridge | 30 column / 36 French door / 24 retro | 36 |
| Dishwasher, wall-oven tower, microwave, wine column, pantry tower | on / off | DW on, others off |
| Sink | farmhouse / undermount / double; prep sink on / off | undermount |
| Island | yes / no / auto, with seats 0–6 | auto |
| Window wall | N / E / S / W / none | N |
| Style | one of the 8 presets, or keywords mapped to presets | from text, else "warm modern" |
| Budget | min–max USD | none |

**Free-text parser (offline).** It recognises:
- dimensions: `12x14`, `12' x 14'`, `12 by 14 feet`, `3.6 x 4.2 m`;
- layout words: galley, L-shaped, U-shaped, one wall, island. Peninsula is reported as "not supported yet";
- appliances and sizes: `36" range`, `48 inch range`, induction, gas, French door fridge, column fridge, double oven, wall oven, no dishwasher, wine fridge, pantry;
- seats: `seating for 4`, `3 stools`;
- sink types;
- style words matched against preset names and tags;
- budget: `$25k`, `under 40,000`.

Words it doesn't recognise appear as grey "not understood" chips, never silently dropped.

**Optional LLM parse (decision).** This only runs when both `ANTHROPIC_API_KEY` and `MISE_LLM_MODEL` are set on the server. `POST /api/generate/brief {text}` asks the model for brief JSON only. The server validates that JSON against the brief schema and clamps every value. The client merges it with the offline parse and shows which source filled each chip. The LLM never places items: it only picks constraints, and the deterministic solver places items, so the geometry and checks keep their guarantees [MDATA ext. "generation step 3"]. With no key the route returns 503, and the UI never shows an LLM option.

**Generator.**
1. Template building becomes declarative. `buildTemplate` turns into `LayoutSpec` runs (wall, start, end, role slots) plus an island spec, built by `buildFromSpec`. `layRun`, `fill` and `prune` are exported [MDATA ext.]. The five existing templates must produce **identical** items before and after the refactor (golden test).
2. It enumerates candidates: layout types that fit × which wall gets the sink / range / fridge, and their order × island on or off and its width × range width options. That is capped at about 60 candidates.
3. It scores each candidate with `runChecks` and `buildEstimate` [MDATA ext.; R-generate]:
   - **reject** any candidate with a `bad` check;
   - subtract for each `warn`;
   - subtract if the work triangle fails;
   - subtract for estimate overshoot against the budget;
   - add for landing counter length and requested seats met.
4. It returns the **top 5 diverse** options (at most 2 per layout type and distinct appliance-wall signatures), matching Drafted's 5 options [D1]. The same brief always gives the same options.
5. Each option card shows: a MiniPlan thumbnail, layout name, checks passed (e.g. "11/11 ✓"), triangle total, estimate total, and 2–4 "why" chips (e.g. "Island seats 3", "Sink under the window").
6. Actions on a card:
   - **Use this:** signed in → a new saved kitchen, then the editor. Signed out → the device draft, then `#/local`.
   - **Lock & regenerate:** keep the layout type and appliance walls, vary the rest. This is our version of Drafted's "regenerate one area" [D1][R-regen].
   - **Compare:** two options side by side.
7. `#/generate?from=<projectId>` seeds the brief from an existing kitchen's room and style ("show me alternatives").
8. Generation runs in a Web Worker if it takes longer than about 200 ms. Target: 1.5 s or less for a 14′×16′ room.

**Check fixes that come with this** (the generator relies on the checks, so they have to be right): the hood check wrongly passes on east and west walls; landing-space checks don't match the messages they show; appliances that aren't flush to a wall automatically pass; and the work triangle depends on item order. See BUILD_PLAN §7.

**Wizard.** Step 3 (Layout) gains a "Generate options for my room" tab next to the 5 templates, using the same generator with the room from step 2.

### 5.3 The editor: changes only

- **Catalog panel:**
  - brand facet chips next to the category chips;
  - image cards when a product has a `thumbnailUrl`, otherwise the existing procedural art;
  - an ⓘ button that opens `#/p/:id`;
  - a "3D model" badge on GLB products and a "Your model" badge on private custom models;
  - a footer link: *Can't find it? Request a custom model* → `#/orders/new`.
- **Brand products behave like built-ins.** A brand chooses a **product type** that maps to an existing `kind` and category, so snapping, checks, the plan symbol, elevations and the estimate all work unchanged. The GLB replaces only the 3D mesh. **(decision:** `Kind` and categories stay a closed list in this phase.)
- **Missing products never get deleted.** If a kitchen references a product that has been unpublished or hasn't loaded yet, the kitchen shows a snapshot or placeholder, keeps the item, and autosave never deletes it [MDATA bug; MSRV bug].
- **Edit conflicts** no longer overwrite silently. A 409 opens a choice: *Keep mine* or *Load the other version* [MSRV bug].
- The **TopBar** gains **Share** (§5.7) and **Studio render** (§5.5).
- Hard-coded brand names are removed. Brand-specific trim (brass knobs, backguard) becomes product data (`flags`) [M3D bug].

### 5.4 Realistic product viewer (package: viewer)

This is the "realistic product viewer" in the brief, and it is the product's visual promise.

**Product page `#/p/:id`.**
- A large interactive stage:
  - turntable auto-rotation that stops when you drag, then orbit and zoom within limits;
  - a studio environment;
  - soft contact shadows;
  - colour-true tone mapping (Khronos PBR Neutral, which is built for e-commerce and CAD colour fidelity [T3]).
- The side panel shows:
  - the brand (linked to `#/b/:slug`, with a *Demo* or *Verified* badge), name, SKU and "from" price;
  - **finish swatches** that switch the model live and are kept in `?finish=`;
  - width options;
  - **dimensions** as W × D × H in ft-in and cm, with a toggle that draws dimension lines in 3D;
  - the brand image gallery;
  - the description.
- Actions:
  - **Add to a kitchen:** pick one of your kitchens, which opens `#/k/:id?add=…`, or use the device planner.
  - **Buy from brand:** the brand's `buyUrl`, opened with `rel="noopener nofollow"`.
  - **Request a custom version** → `#/orders/new?ref=:id`.
  - **Download image:** a 2048 px studio still.
- Records a `view` event once per session and `buy_click` on the buy link.
- Works for **built-in procedural** products (they render through the existing procedural models) and for **GLB** products alike.

**Realism stack (all offline, no CDN fetches at runtime):**

| Concern | Choice | Why |
|---|---|---|
| Environment | `RoomEnvironment` through PMREM in the product viewer; the existing Lightformer environment in the room | Both are zero-byte and offline. drei presets and `<Stage>` defaults fetch from CDNs [T4] |
| Tone mapping | `NeutralToneMapping` in the viewer. In the room, Neutral vs AgX is decided from A/B screenshots | ACES shifts hue and desaturates brand colours [T3][M3D bug] |
| Shadows | `ContactShadows frames={1}` or `AccumulativeShadows` in the viewer; in the room, PCF soft shadows with `autoUpdate=false` + `needsUpdate` on change | Plane-only shadows suit a single product; avoid PCSS shader recompiles [T5] |
| Ambient occlusion | N8AO through `@react-three/postprocessing@2.19.1` + `postprocessing@6.39.5` (exact pins) with a `<ToneMapping>` effect last | The biggest realism gain for interiors; 3.x needs React 19 [T2] |
| GLB decoding | Draco decoders self-hosted at `/draco/`; Meshopt inline; KTX2 **not** enabled | drei's default Draco path is gstatic [T8] |
| Glass | Physical transmission in the viewer only; the room keeps transparent glass with a strong env map | Transmission adds a render pass [T7][M3D bug] |
| Wood grain | World-scale UVs with a grain axis for finish-textured cabinet parts | Today the whole 12×24 in tile is stretched onto every face [M3D bug] |

**GLB products in the kitchen.**
- A GLB product renders inside a per-item error boundary + Suspense, with the procedural model as both the loading placeholder and the error fallback, so a broken upload never blanks the scene [T8].
- Normalisation: the bounding box is converted to inches (×39.3701). A **uniform** scale `min(w/bx, h/by, d/bz)` is applied, the model is centred on x and z, min.y is set to 0, and the product's elevation is added. glTF's +Y up and +Z front already match Mise's convention [T8].
- **Material slots:** meshes whose material is named `mise_finish`, `mise_cabinet`, `mise_hardware` or `mise_counter` take the chosen finish, the kitchen's cabinet finish, the hardware or the countertop respectively. Every other material keeps its baked PBR look. **(decision:** one GLB per product, with finishes applied through slots. Per-finish GLBs and `KHR_materials_variants` come later.)
- Each placed instance gets its own clone. A failed URL is cleared from the loader cache when the boundary resets [T8].

**Performance (it has to run on mid-range laptops, not just the RTX 3090 dev box [T7]):**
- `frameloop="demand"`, which today renders about 1,096 draw calls per frame continuously while idle [M3D bug];
- a fixed-size pendant light pool, because adding a pendant currently re-links 7 programs and causes a 1.6 s frame [M3D bug];
- shadow-map updates only on change;
- `dpr [1, 1.5]`;
- `PerformanceMonitor` steps down DPR and AO when frames drop;
- `preserveDrawingBuffer` dropped.

**Budgets:**
- per GLB product: warn above 150k triangles or 8 MB, hard cap 25 MB [T7][T9][K9];
- the 3D chunk stays lazy-loaded and is reported in QA.

### 5.5 Photoreal room renders: "Studio render" (package: viewer)

- From the editor's **Studio render** button:
  - camera: current view / overview / eye level / front elevation;
  - resolution: 1080p / 1440p / 4K, with the long side capped at `min(4096, maxTextureSize)` [T6];
  - quality: High (N8AO at full resolution, 8× MSAA, accumulated soft shadows) or Fast;
  - tone mapping: Neutral / AgX.
- Rendered offscreen at the target size and downloaded as a PNG. It doesn't depend on the on-screen canvas size, which fixes the half-width 3D export from split view [M3D bug].
- **(decision)** No path tracer in this phase (three-gpu-pathtracer is unverified against our three version). See §15 Q10.

### 5.6 Estimates (existing, extended; package: foundation)

- Brand products contribute their own `price`, `priceByWidth`, `sku` / `skuByWidth`.
- The CSV gains **SKU** and **Buy link** columns.
- The "placeholder prices" disclaimer appears only when built-in demo products are present.
- Products in an unexpected category go to an **Other** group instead of quietly dropping out of the total [MDATA bug].
- Estimates stay *illustrative*: no tax, labour or delivery.

### 5.7 Share links (package: share)

- **Share** in the editor creates **view-only** links (`#/s/:token`, 192-bit random token) with:
  - an optional label;
  - *show prices* on or off;
  - optional expiry (7 / 30 / 90 days / never);
  - revocation.
- A link shows the **live** kitchen, so the owner can keep editing after sending it.
- The read-only page shows:
  - the plan, 3D and walls views (the editor in `view` mode: no catalog, no editing);
  - the product list with brand buy links;
  - the estimate, only if prices are shown;
  - "Shared by *first name* · updated 3 h ago";
  - **Duplicate to my kitchens** (requires signing in).
- The client field and the owner's email are never exposed.
- Private custom models in a shared kitchen render for the link's viewers while the link is valid. The share package registers a file read policy for this.
- **(decision)** Drafted's *Review* and *Full Access* roles and comments [D1] are a later phase (§15 Q11).

---

## 6. Brand features (package: brands)

### 6.1 Onboarding
1. Any signed-in user can choose **List your products** (account menu → `#/brand/join`). They enter the brand name, website (https) and a short description. This creates a brand with status `pending`, with the caller as `owner`. Each user may create at most 3 brands.
2. An admin approves, rejects or suspends the brand. A **Verified** badge is a separate manual admin action, given only once the admin is satisfied the account really represents the brand, for example an email on the brand's domain [R-trust]. Unverified brands show no badge. Seeded demo brands show **Demo**.
3. The owner can add editors by the email of an existing Mise account.

### 6.2 Product editor
The fields follow what brand-onboarding platforms ask for [K6][K8][K9]:

| Section | Fields and rules |
|---|---|
| Basics | Name (≤80), **Product type** (curated list → `kind` + `category` + optional `variant`; e.g. "Range – gas" → `range/gas-4`), description (≤600) |
| Dimensions | Width, depth, height (in or cm), mounting height (elevation), optional width options (≤16) |
| Price & SKU | Price (USD), SKU (≤40), optional per-width price and SKU |
| Finishes | 1–24 finishes: name, colour (hex), material kind, optional swatch image. Or "uses the kitchen's cabinet finish" (for cabinets / panel-ready) |
| Media | 1–12 images (PNG / JPEG / WebP, ≤8 MB, ≤4096², **no SVG**). The first image is the thumbnail. Optional **GLB** (≤25 MB) |
| Links | Buy URL (https only), optional spec-sheet URL |
| Look | Optional flags: brass trim, pro backguard (these replace the old hard-coded brand names) |

**GLB upload report**, shown right after upload and again to the moderator:
- file size, triangles, materials, which `mise_*` slots were detected;
- bounding box vs the declared W/D/H, with any axis off by more than 5% flagged ("your model is 31.2″ wide but you declared 30″"). We flag rather than stretch [T8];
- a live preview in the product viewer stage;
- warnings for over 8 MB, over 150k triangles, or embedded textures larger than 2048 px [K9].

Products without a GLB are allowed. They render with Mise's procedural model for their type, tinted by their finishes. The research suggests GLBs matter most for appliances, sinks, faucets and lighting, while cabinets stay procedural [R-cabinets]. Products with a GLB show a "3D model" badge.

### 6.3 Moderation states

```
draft ──submit──▶ submitted ──approve──▶ published
  ▲                  │ reject (note)          │ edit
  └──── rejected ◀───┘                        ▼
                                   submitted (while the last approved version stays live)
any ──archive──▶ archived (hidden from the catalog; kitchens keep their snapshot)
```

- Brands edit a **working copy** (`spec`). Approval copies it to the **live** copy (`live_spec`). Editing a published product therefore never takes it offline: it stays live at its last approved version until the edit is approved [R-upload: moderation queue].
- **Submit** checks that everything required is present (name, type, dimensions, price, SKU, ≥1 image, ≥1 finish) and that every referenced file belongs to the brand.
- Suspending a brand hides all its products from the catalog immediately.
- Per-brand cap: `BRAND_PRODUCT_LIMIT` (default 50) non-archived products.

### 6.4 Brand page `#/b/:slug`
Logo, name, badge, tagline, website, and a grid of published products (thumbnail cards → product page). It also has a *Try these in a kitchen* call to action.

### 6.5 Analytics
These are first-party events only: no third-party trackers, and no IP addresses stored [R-money (b)].

| Event | Fired when |
|---|---|
| `view` | Product page opened (once per session per product) |
| `add` | The product is placed into a kitchen |
| `buy_click` | The buy link is clicked |
| `render` | Included in a studio render (later) |

The dashboard shows the last 7 / 30 / 90 days: totals per event, a daily bar chart, top products, and an add-to-view ratio. These are the numbers that justify brand-paid plans later, as they do for Roomvo [K6].

### 6.6 Demo brands
**All seed data uses fictional demo brands.** The 12 built-in brand names are invented. The database seed adds a few more fictional brands flagged `is_demo` (for example *Kestrel & Finch Appliances (Demo)* and *Marlow Lighting Co. (Demo)*), with generated GLB fixtures, a pending submission and 30 days of clearly-demo analytics. **Real brands onboard themselves through the portal.** Mise never creates a page or listing under a real company's name. An admin rejects any brand application that impersonates a company without verification.

---

## 7. Paid custom models (package: orders)

### 7.1 Who and why
- A **customer** wants their actual range, sink or light in their kitchen and it isn't in the catalog. The delivered model becomes a **private** product that only they can see and place, and it renders for viewers of their share links.
- A **brand** wants a model built for them, as Marxent, Cylindo and 2020 offer [K5][K7][K4]. The delivered model becomes a **draft product** in that brand's portal, and it goes through normal moderation before going live.

### 7.2 Tiers (decision: placeholder prices, §15 Q3)
These are anchored on the research: Modelry from $60, Fiverr $40–400, studios $150–600 per AR-ready product, and the suggested ladder [K10][R-custom].

| Tier | For | Price | Standard turnaround |
|---|---|---|---|
| Simple | Hardware, faucets, decor, simple lights | **$129** | 7 business days |
| Standard | Appliances, sinks, single cabinets, stools | **$279** | 10 business days |
| Complex | Modular or multi-part products, pro ranges, chandeliers | **$549** | 15 business days |
| Extras | +$39 per extra finish beyond 2; **Rush** +50% for half the turnaround | | |

Every tier includes: a GLB to the Mise spec (real scale, origin at the base centre, +Z front, `mise_*` slots, textures ≤2048, ≤8 MB target), a thumbnail, and **2 revision rounds**. Prices are computed **on the server** from the brief. Any amount the client sends is ignored [T12].

### 7.3 Request flow (`#/orders/new?ref=&brand=`)
1. **What:** product type, name, and optionally a reference product (prefilled from `?ref`) or "for my brand X".
2. **Size:** W × D × H (required).
3. **References:** 1–8 photos (PNG / JPEG / WebP, ≤8 MB each). They are stored privately and visible only to the buyer and to studio/admin.
4. **Notes:** up to 4,000 characters (materials, finishes, links to the manufacturer page).
5. **Tier and extras**, with the live server quote.
6. **Review & pay:** a summary, then **Pay**, which creates a checkout and redirects.

### 7.4 Payments: a provider abstraction
- **Stripe Checkout** is active only when **both** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are set [T12][T13]:
  - REST over `fetch` with no SDK, `mode=payment`, `price_data` from the server quote, `client_reference_id=orderId`, `Idempotency-Key=orderId`;
  - `success_url = ${PUBLIC_URL}/?session_id={CHECKOUT_SESSION_ID}#/orders/:id` (in the query string, not the hash);
  - the webhook `POST /api/webhooks/stripe` sits outside the CSRF header gate, reads the raw body, verifies `v1` HMAC-SHA256 with a 300 s tolerance and a constant-time compare, de-duplicates by event id, checks amount and currency, and fulfils idempotently;
  - the success page also syncs by retrieving the session.
  Mise never sees card data.
- **DEMO provider** (the default whenever Stripe isn't fully configured):
  - Checkout opens `#/pay/demo/:orderId`. The page carries a full-width **"DEMO PAYMENT – no real money moves, no card details are collected"** banner and only *Simulate successful payment*, *Simulate declined payment* and *Cancel* buttons. It has **no card fields at all**.
  - It is refused in production unless `DEMO_PAYMENTS=1`.
  - The UI shows "Demo payments" everywhere a price appears.
- Both providers go through **one** idempotent `markOrderPaid()`.

### 7.5 Order lifecycle

```
draft ─checkout─▶ pending_payment ─paid─▶ paid ─studio starts─▶ in_progress ─deliver─▶ delivered ─accept─▶ completed
   │                 │ decline/expire(24h)                            ▲                    │
   └─cancel─▶ cancelled   ▼ payment_failed / expired                   └── revision (≤2) ◀──┘
paid / in_progress / delivered ─admin refund─▶ refunded
```

Every transition writes an `order_events` row. The customer sees a timeline, the studio's notes, and (once delivered) the model in the product viewer stage, with **Add to a kitchen**, **Request revision** and **Accept**.

### 7.6 Studio queue (roles `studio` / `admin`)
- The queue is filterable by status, oldest paid first, and shows the due date from the tier and rush option.
- The detail view shows the brief, the private reference photos and the timeline.
- Actions:
  - **Start** (paid → in_progress, assigned to me);
  - **Add note**;
  - **Deliver**: upload the GLB + thumbnail, confirm dimensions and finishes, see the same validation report brands see.
- Delivering creates the product:
  - for a customer order: source `custom`, private, owned by the buyer, live, with read grants on its files;
  - for a brand order: source `brand`, a draft in that brand.
- **(decision)** For now Mise staff fulfil orders. Research recommends a marketplace of vetted modellers with escrow, because Atmos failed as a human-heavy operation [D3][R-custom]. That needs Stripe Connect payouts and is out of scope (§15 Q4).

### 7.7 Refunds
An admin can refund paid, in-progress or delivered orders. With the demo provider this marks the order refunded. With Stripe it calls `POST /v1/refunds` on the payment intent and records the result. A delivered custom product stays in the buyer's kitchens (snapshot), but its live catalog entry is archived.

---

## 8. Admin (`#/admin/:tab`)

| Tab | Content | Package |
|---|---|---|
| Overview | Counts of users, kitchens, brands by status, products by status; latest signups | foundation |
| Moderation | Submitted products (preview, GLB report, approve, or reject with a note) and pending brands | brands |
| Brands | All brands: approve, reject, suspend, verify, view as brand | brands |
| Studio | The custom-model queue (§7.6) | orders |
| Revenue | Gross paid, refunds, net; by tier; by day (90 d); average turnaround; demo vs Stripe kept separate | orders |
| Users | Search users, set role (`customer` / `studio` / `admin`; you can't demote yourself) | foundation |

---

## 9. Data model

These are new SQLite tables, created through a real migration runner. Today there is no migration mechanism [MSRV bug]. Money is in **integer cents**. Every id is server-generated. The full DDL lives in BUILD_PLAN §3.3.

| Table | Purpose | Owner |
|---|---|---|
| `users` (+`role`) | `customer` / `studio` / `admin` | foundation |
| `brands`, `brand_members` | A brand profile and status (`pending` / `active` / `rejected` / `suspended`), `verified_at`, `is_demo`; membership with the `owner` / `editor` roles | foundation (schema), brands (routes) |
| `files`, `file_grants` | Content-addressed uploads (`model` / `image` / `reference`), public or private, with validation metadata; explicit read grants | foundation |
| `products` | Brand and custom products: working `spec` and `live_spec` JSON, status, visibility, owner | foundation (schema and service), brands and orders (workflows) |
| `product_events` | Analytics events (no IP addresses) | foundation |
| `product_reviews` | Moderation log | brands |
| `orders`, `order_events`, `payment_events` | Custom-model orders, their timeline, and idempotent webhook records | orders |
| `share_links` | View-only tokens | share |

**Client-side model changes:**
- `Product` gains `source` (`builtin` / `brand` / `custom` / `snapshot` / `missing`), `brandId`, `brandSlug`, `sku`, `skuByWidth`, `priceByWidth`, `images`, `thumbnailUrl`, `buyUrl`, `model {url, bboxIn, triangles, slots}`, `flags`, `status`, `visibility`, `isDemo`.
- `PlacedItem` gains `finishId`. Today finishes are stored by list position, which breaks when a brand reorders its finishes [MDATA bug]. `finishIndex` is kept for old files.
- `DesignDoc` gains `version: 2` and `products` (snapshots of every non-built-in product used), so a kitchen still renders after a brand unpublishes a product [MDATA ext. step 5].

---

## 10. API surface (summary; contracts in BUILD_PLAN §3)

| Module | Endpoints |
|---|---|
| auth (existing + role) | `POST /api/auth/signup`, `login`, `logout`; `GET/PATCH /api/auth/me` (now `{user:{…, role, brands:[…]}}`); `POST /api/auth/password` |
| projects (existing, hardened) | `GET/POST /api/projects`; `GET/PUT/DELETE /api/projects/:id`; `POST /api/projects/:id/duplicate` |
| config | `GET /api/config` → `{payments:'demo'\|'stripe', llm:boolean, limits, demo:boolean}` |
| catalog | `GET /api/catalog`, `GET /api/catalog/products/:id`, `GET /api/catalog/brands` |
| files | `PUT /api/files?kind=&name=&brandId=` (raw body), `GET /api/files/:id`, `GET /api/files/:id/content`, `GET /files/:sha.:ext` (public, immutable) |
| events | `POST /api/events {productId, type}` |
| brands | `/api/brands…`, `/api/brands/by-slug/:slug`, `/api/admin/moderation`, `/api/admin/products/:id/{approve,reject}`, `/api/admin/brands/:id/{approve,reject,suspend,verify}` |
| orders | `/api/orders/tiers`, `/api/orders…`, `/api/payments/demo/:id/complete`, `/api/webhooks/stripe`, `/api/studio/orders…`, `/api/admin/orders/:id/refund`, `/api/admin/revenue` |
| generate | `POST /api/generate/brief` (503 unless an LLM is configured) |
| share | `/api/projects/:id/shares…`, `GET /api/share/:token`, `POST /api/share/:token/duplicate` |
| admin core | `GET /api/admin/overview`, `GET /api/admin/users`, `PATCH /api/admin/users/:id` |

---

## 11. Non-functional requirements

**Security.**
- Keep the `X-Mise: 1` CSRF header gate; only the Stripe webhook is exempt.
- Fix the known server defects [MSRV][T10]: JSON `null` → 400; malformed `%` → 400; oversized body → a real 413; revision check required plus a conditional `UPDATE`; async scrypt; signup rate limit; bounded rate limiter; `TRUST_PROXY`; `path.relative` containment; SPA fallback only for extensionless paths; MIME types for `.wasm` / `.glb` / `.webp` / `.jpg` / `.hdr`; `HOST` defaults to 127.0.0.1; strict document validation.
- **Uploads:**
  - raw `PUT` bodies, not multipart, because multipart passes `../../evil.png` through unchanged [T11];
  - streamed with a byte cap;
  - magic-byte sniffing [T9][T10]: GLB is parsed (header, chunk order, no external URIs, an extension allowlist, count caps), images are parsed (PNG / JPEG / WebP, dimensions) and **SVG is rejected**;
  - stored content-addressed under `UPLOAD_DIR/<sha256>.<ext>`;
  - served with fixed MIME types, `nosniff`, `CSP: default-src 'none'; sandbox` and `CORP same-origin`;
  - private files only through an authenticated route with `Cache-Control: private, no-store`.

**Offline guarantees.** The app makes no runtime requests to third-party hosts. The QA runner fails any page that does [T4][T8]. `#/local` works with the server down.

**Performance.**
- The main chunk grows by at most 10% (613 KB today); every new screen is lazy-loaded.
- Idle 3D renders 0 frames.
- Adding a pendant compiles no new shader programs.
- The 3D chunk size is reported in QA [M3D].

**Ports.** The API default moves from 8787, which an unrelated app owns on this PC, to **8790**. The Vite proxy reads `MISE_API_PORT` [MSRV bug].

**Accessibility.** Every new control has a label. Modals trap focus and close on Esc. Status is never shown by colour alone.

**Browsers.** Current Chrome and Edge, Safari 17+ and Firefox; WebGL2 required for 3D. The existing message is shown when 3D is unavailable.

---

## 12. Trust, legal and labelling

- **Disclaimer** in the footer of the landing page, editor, share page and CSV: *"Mise is a visualizer. Layouts, dimensions and estimates are for planning conversations, not construction or installation drawings. Verify everything with a professional."* Drafted ships the same kind of disclaimer [D1].
- **Fictional brands:** all seed brands are invented and marked Demo (§6.6). Real brands appear only through self-onboarding plus admin approval.
- **Payments:** a hosted processor only (Stripe Checkout). Demo payments are labelled on every screen that shows money and can't be enabled in production by accident [R-trust][T13].
- **Uploaded content:** brands confirm they have the rights to the files they upload (a checkbox on submit). Admins can archive any product.
- No third-party analytics or trackers.

---

## 13. Out of scope for this build (later)

- Real-brand paid plans and billing (Stripe subscriptions).
- Stripe Connect payouts to modellers or brands.
- An embeddable viewer for brand websites (needs a separate HTML entry without `X-Frame-Options: DENY`) [M3D].
- AR (USDZ / Quick Look).
- KTX2 textures.
- A path-traced render mode.
- Per-finish GLBs and `KHR_materials_variants`.
- A public gallery with remix and SEO pages [D2][R-gallery].
- Review and comment share roles.
- Version history in the editor [D1].
- Polygon rooms and utility points.
- CSV/feed import for brands.
- Email (verification, receipts, password reset).
- A mid-range-laptop performance pass on real hardware [T7].

---

## 14. Research and code-map key

| Tag | Finding (source) |
|---|---|
| D1 | Drafted flow: structured inputs (no free-text prompts), 5 options, edit and regenerate an area, live 3D, export, share as Full / Review / View-only, "concept, needs professional review" (drafted.ai, /learn/faq, /learn/news/drafted-v2) |
| D2 | Drafted UX: options side by side, design history, public gallery with remix, SEO pages (drafted.ai/house-plans) |
| D3 | Drafted money: free today; plan sets ~$1–2k; Atmos failed as an operations-heavy designer business (TechCrunch 2025-12-23, thesaasnews) |
| K1 | IKEA 3D kitchen planner (Oct 2025): starts from ready-made kitchens with live prices; the tool is free and IKEA earns from products (ingka.com) |
| K2 | Homestyler: free tier has 3 GLB/GLTF uploads; brand collections; modelling services (homestyler.com/pricing) |
| K3 | Planner 5D: custom upload in Pro; enterprise white-label with a catalog (planner5d.com/pricing) |
| K4 | 2020/Cyncly: manufacturer catalogs built for manufacturers, with certified content |
| K5 | Marxent 3D Cloud: NKBA-validated AI layouts, BOM to cart; manufacturers provide or order 3D content |
| K6 | Roomvo: manufacturer pays; analytics on views and saves; onboarding needs images + dimensions + SKUs |
| K7 | Threekit / Cylindo / Vectary / Zakeke: Zakeke prices by product-count tiers; Cylindo builds assets from brand photos and dimensions |
| K8 | Three onboarding patterns: self-serve upload, vendor builds, PIM/ERP integration |
| K9 | Formats: GLB (+USDZ); Shopify checklist ~4 MB, textures ≤2048, real scale, origin at base, PBR; Khronos guidelines |
| K10 | Custom modelling prices: Modelry from $60; Fiverr $20–400; studios $150–600; CGTrader 10% capped at $20; Fiverr ~25% effective |
| R-money / R-regen / R-generate / R-upload / R-cabinets / R-custom / R-trust / R-gallery | The Drafted report's recommendations (free for homeowners and brands pay; targeted regeneration; scoring with checks + estimate; upload validation + moderation; keep cabinets procedural; marketplace pricing ladder; fictional brands, verification and hosted payments; gallery later) |
| T2 | `@react-three/postprocessing@2.19.1` + `postprocessing@6.39.5` + n8ao install cleanly on fiber 8 / three 0.169; the composer forces `NoToneMapping`, so add a ToneMapping effect |
| T3 | Neutral (r162) and AgX (r160) are in three r169; Khronos PBR Neutral is meant for colour-true products |
| T4 | Offline environments: Lightformers, RoomEnvironment through PMREM, or a CC0 Poly Haven HDRI. drei presets, `<Stage>`, `useKTX2` and detect-gpu all hit CDNs |
| T5 | AccumulativeShadows and ContactShadows are plane-only; SoftShadows recompiles every material; turn off shadow `autoUpdate` |
| T6 | High-res export: render, then `toBlob` in the same task; cap the long side at 4096; with a composer, call `composer.render()` |
| T7 | Performance: demand frameloop, `dpr [1, 1.5]`, PerformanceMonitor, a ~150k triangle budget; the RTX 3090 is not representative |
| T8 | Client GLB loading: `useGLTF` decoder path, local Draco files, clones, error caching (`useGLTF.clear`), normalisation by uniform scale |
| T9 | Server GLB validation: header, chunks, no URIs, extension allowlist, count caps; tested |
| T10 | Image sniffing; safe serving headers; static-handler defects (index.html fallback with 200, MIME types, prefix containment, decode errors) |
| T11 | Raw PUT is safer than Node's `formData()` (filename passthrough, buffering) |
| T12 | Stripe Checkout through REST, idempotency, webhook v1 HMAC with 300 s tolerance, raw body, dedupe, fulfil idempotently |
| T13 | Demo provider design: same fulfilment path, labelled, refused in production |
| T14 | Headless QA: installed Edge 154 / Chrome 154 driven over CDP with Node's WebSocket; GPU and SwiftShader modes |
| T15 | npm audit: Vite / esbuild dev-server advisories; drei 9.122 clears the uuid advisory on fiber 8 |
| M3D / MDATA / MSRV | The three code maps (3D render, data and editor, server and app) of the current code |

---

## 15. Decisions made for Gabe (please overrule in the morning)

1. **Name:** kept "Mise". Drafted is the UX reference only.
2. **Money (superseded by Gabe, 2026-10-04 — see PLANS_AND_CONTRACTORS.md):** free for homeowners; brands free during beta (cap of 50 products); brand plans not built.
3. **Custom-model prices:** $129 / $279 / $549, +$39 per extra finish, rush +50%, 2 revisions. These are placeholders.
4. **Fulfilment:** Mise staff (role `studio`) for now, not a modeller marketplace (that would need Stripe Connect).
5. **Payments:** Stripe test mode only once keys are set; DEMO otherwise. Going live needs your business entity, tax set-up and terms.
6. **Custom models are private to the buyer** by default; brand-requested models become brand drafts.
7. **Brand verification** is a manual admin action; there is no automatic domain-email check yet.
8. **LLM:** off by default; Anthropic Messages API only when `ANTHROPIC_API_KEY` and `MISE_LLM_MODEL` are set; it parses only.
9. **Tone mapping:** Neutral in the product viewer; the room view is chosen from A/B screenshots (Neutral vs AgX).
10. **No path tracer** this round.
11. **Share links:** view-only and live; tokens stored in the database so they can be copied again (revocable); review and comment roles later.
12. **No embeddable viewer** for brand sites yet (X-Frame-Options stays DENY).
13. **Built-in catalog stays bundled** in the app (it works offline); the database holds only brand and custom products.
14. **Kinds and categories stay a closed list:** brands map their products to an existing product type.
15. **Finishes on GLBs through named material slots;** no per-finish GLB files.
16. **Default API port 8790** instead of 8787.
17. **Product and brand pages are public** without login (shareable by brands).
18. **New dependencies:** `@react-three/postprocessing@2.19.1` and `postprocessing@6.39.5` only. The drei bump to 9.122 (which clears an advisory) and the Vite major upgrade are deferred.
