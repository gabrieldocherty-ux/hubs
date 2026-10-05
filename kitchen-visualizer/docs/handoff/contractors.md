# Handoff: package H (contractors)

Built 2026-10-04/05 alongside package G (see `billing.md` for the shared foundation hooks). Spec:
`docs/PLANS_AND_CONTRACTORS.md` §4; plan: `docs/BUILD_PLAN.md` §15.

## What shipped

- **Server:** `contractors-001` (`contractor_profiles`, `carried_brands`, `price_book`,
  `contractor_quotes`); `server/contractors/{service,csv}.mjs`; `server/routes/contractors.mjs`:
  profile, dashboard, own products (quick add / edit / archive / restore, live on save, private,
  ≤500), brands I carry (on/off, % off list, markups for brands, lines and the own catalog), price
  book (rows, data, per-product cost / per-width cost / markup), supplier CSV import (`?dryRun=1`
  preview; applying is all-or-nothing) and export, quotes list, quote data and quote settings.
  Every route needs the Contractor plan; a lapsed contractor keeps GET only.
- **Registered hooks:** `services.pricing` (sell prices for clients via the export kit, price book
  for server exports) and `services.contractors` (branding, session summary, product label).
- **Price math, once:** `src/features/contractors/priceMath.ts` is used by the editor and, bundled
  in the export kit, by the server. Cost: per-width → product (other widths scale like list) → brand
  % off list → none (sell at list, flagged). Markup: product → line → brand (or own catalog) →
  company default.
- **Client:** `#/pro` pitch for non-contractors (or switch from Unlimited); three-step setup;
  workspace tabs Dashboard, My catalog (by line), quick add / edit form with live preview and a GLB
  check (size, triangles, >5% off declared size), Price book (inline edits, per-width rows, CSV
  import preview, export), Brands I carry, Quotes, Modelling requests, Company; printable quote
  (`#/pro/quote/:projectId`, cents, plan + 3D captured from the editor, tax, valid-until, notes;
  printing goes through `requestExport(…, 'quote', print)`); in the editor: own catalog first in the
  catalog panel, sell prices everywhere, Client view / Contractor view (Client by default), extra
  labour lines with private costs, presentation mode, a Quote item in Export; Home grouped by client;
  lapsed banner.

## Decisions made while building (overrule freely)

1. **SKUs may contain `{w}`** ("SSB{w}" → SSB24), like the built-in codes. Server SKU validation
   accepts the placeholder.
2. **Products gained optional `line` and `doorStyle`** (shaker / slab / fluted). Door style is
   recorded and shown; the kitchen-wide door style still draws the doors (renderers are package A's).
   Glass fronts are the existing "Wall cabinet – glass front" type.
3. **Client view is the default** on the estimate, so costs never show by accident.
4. **Exports never include costs, even for the contractor** (CSV, project file, quote). Their own
   numbers are in the price book export.
5. **The working copy of a product now carries `imageFileIds`** (only editors get working copies),
   so photos can be edited.
6. Line markups are stored in `carried_brands` under `line:<name lower-case>`.

## Not done, or not verified

- **Branded share links** need package E: the hooks are registered and tested (`brandingFor`,
  `applyForViewer`, `sellPricesFor`, `stripDoc`), but there is no share page yet to show them.
- **"Have Mise model it"** links to `#/orders/new?target=contractor`, a placeholder until package C.
- Per-product door styles don't change how doors are drawn (see 2).
- The CSV import matches by SKU only; unmatched rows are reported, not created as products.
- Verified in Chromium with a Playwright script in the session scratchpad: pitch → demo plan → setup
  → quick add with per-width costs → brands → price book → CSV import → client kitchen → Client and
  Contractor views → extra line → quote (no cost text in the DOM) → print → presentation mode →
  Home by client → lapsed read-only, with no console errors. Not tested on Windows or Safari.
