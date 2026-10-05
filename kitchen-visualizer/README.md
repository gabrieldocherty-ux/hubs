# Mise — Kitchen Visualizer

Plan a kitchen to scale with branded cabinets, appliances and finishes, check it
against real kitchen-planning guidelines, price it, and walk through it in 3D.

```bash
cd kitchen-visualizer
npm install
npm run api        # terminal 1: the API on 127.0.0.1:8790 (Node 22.13+)
npm run dev        # terminal 2: the app, proxies /api to the server

npm run build && npm start   # production: one process serves the app and the API

npm test           # TS unit tests, then the server tests
npm run typecheck
```

`npm run build`, `npm run api` and `npm run test:server` first bundle the export kit
(`scripts/build-kit.mjs` → `server/generated/export-kit.mjs`, gitignored): the editor's estimate,
shopping-list CSV and contractor price math, so the server makes paid exports and quotes with the
exact code the editor runs.

Payments: with `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` set, plans and unlocks go through
Stripe Checkout (webhook: `POST /api/webhooks/stripe`). Without them every payment screen is a
clearly labelled **DEMO** that moves no money and has no card fields; it is refused in production
unless `DEMO_PAYMENTS=1`.

Without the API running, the sign-in page offers **Design on this device**,
which keeps the kitchen in that browser only.

## Accounts and day-to-day use

- **Sign up / sign in / sign out**, with sessions that last 30 days and renew
  while in use. Account settings change your name or password (changing the
  password signs out your other devices).
- **My kitchens:** every saved kitchen as a card with a live mini plan, client,
  room size, piece count, estimate and when it was last edited. Rename,
  duplicate or delete (with confirmation); search appears once you have a few.
- **New kitchen setup:** four steps — name and client, room size (with common
  sizes), starting layout previewed for your exact room, and a style preset —
  then straight into the editor.
- **Autosave:** changes save about a second after you stop (never mid-drag),
  with a status chip in the top bar. `Ctrl/⌘+S` saves immediately; failed saves
  retry when you're back online, and leaving the page flushes pending work. If
  the same kitchen was saved from another window first, your version is kept
  and you're told.

The server (`server/index.mjs`) has no dependencies: Node's `http`, `crypto`
and built-in `node:sqlite`. Passwords are salted scrypt hashes; sessions are
random tokens stored only as SHA-256 hashes and sent as httpOnly, SameSite=Lax
cookies (Secure in production). Writes require a custom `X-Mise` header, which
blocks cross-site request forgery; failed logins are throttled per IP and
email; every project query is scoped to its owner. Data lives in
`server/data/mise.db` (set `DB_PATH` and `PORT` to change). Behind HTTPS in
production — put it behind a TLS-terminating proxy.

## What it does

- **Branded catalog (~45 products).** Cabinets with industry codes and width
  options (`B24`, `W3030`, `SB36`…), ranges from 30″ induction to a 48″ pro
  with griddle, fridges, hoods, sinks, wine columns, pendants, stools, tables,
  windows, doors and decor. Each card is a front-elevation drawing tinted with
  your current cabinet finish, door style and hardware. Search with `/`.
- **Room & finishes.** Room width/length/ceiling, plus kitchen-wide choices:
  cabinet finish, door style (shaker / slab / fluted), hardware, countertop,
  backsplash, flooring and wall paint, all with procedurally generated textures
  (marble, terrazzo, herringbone, zellige, subway…). No image assets.
- **Style presets.** Eight curated looks (Modern Farmhouse, Moody Green, Japandi,
  Mid-Century, Parisian…) that set every finish plus an island accent in one
  undoable click.
- **One-click layouts.** One-wall, galley, L-shape, U-shape and L + island,
  filled with real cabinet widths for your room size.
- **Architectural plan (2D).** Drag products in; backs snap to walls
  (auto-rotating to face the room) and sides click against neighbours and the
  uppers/lowers above or below. Chained wall dimensions, live distances from the
  selected piece to each wall, door swings, a scale bar, and a rendered or
  pen-and-ink drafting style. Zoom with the wheel, pan by dragging empty floor.
- **3D view.** Dollhouse cutaway that hides walls facing the camera, real window
  and door openings, countertops and tile with continuous world-space texture
  mapping, lit pendants, and camera presets (overview, eye level, elevation, top).
  Plan, 3D, or both side by side.
- **Wall elevations.** Each wall drawn head-on, like a drawing set: cabinets,
  appliances, windows and doors at true height, backsplash tile to scale, and
  dimension strings. Export as SVG or PNG for a contractor.
- **Design checks**, live, based on NKBA planning guidelines: collisions, work
  aisles (36″ minimum, 42″ recommended), the sink–cooktop–fridge work triangle,
  hood coverage, landing counter beside the range and fridge, dishwasher-to-sink
  distance, and door swings.
- **Estimate.** Itemized by product, plus countertop/backsplash/flooring areas,
  paint gallons and cabinet pulls.
- **Export.** Floor plan PNG, 3D render PNG, shopping list CSV, and a
  `.kitchen.json` project file you can re-import. Exports are paid (below).

## Plans and the Contractor program

`docs/PLANS_AND_CONTRACTORS.md` is the spec. Designing, saving and sharing are free; exports are not.

- **Kitchen unlock, $5 once:** every export of that kitchen, forever, including after edits. A
  duplicate is a new kitchen. **Unlimited, $15/month:** every kitchen you own. Cancelling keeps the
  plan to the end of the paid month; a failed renewal gets 7 days' grace.
- Every export goes through the paywall. A free user gets the Unlock dialog; someone designing on
  this device first makes a free account and their draft is saved into it. After paying, the export
  they clicked finishes by itself. The server checks every export again and makes the CSV and the
  project file itself.
- **Account → Billing** (`#/account/billing`): plan, change, cancel or resume, unlocked kitchens and
  receipts, plus demo controls for renewals. **Admin → Billing**: MRR, plans, unlocks and churn, with
  demo kept apart from real money.
- **Contractor, $40/month** (`#/pro`): company setup; *My catalog* (quick-add a line by type, widths,
  door style and finishes, no 3D model needed; or upload a .glb, checked against the declared size);
  *Brands I carry*; a *price book* with cost per product or per width, % off list per brand, markup
  by product, line, brand or company, and supplier CSV import (preview, then all-or-nothing) and
  export; a Client view / Contractor view switch on the estimate, extra labour and service lines,
  presentation mode, and branded printable quotes. Costs never leave the contractor's account: the
  server tests scan every client-facing response for them. If the plan lapses, everything stays,
  read-only, and kitchens keep their prices.
- **Keyboard.** `R` rotate · `Del` remove · arrows nudge 1″ (Shift 6″) ·
  `Ctrl/⌘+D` duplicate · `Ctrl/⌘+Z` undo · `1–4` plan/split/3D/walls · `F` flip hinge.

Brand names and prices are invented placeholders. Swap `src/data/catalog.ts`
and `src/data/finishes.ts` for a real, licensed product feed.

## Code map

- `src/data/` — catalog, finishes/surfaces, layout templates
- `src/lib/geometry.ts` — footprints, wall/edge snapping, overlaps, backsplash runs
- `src/lib/checks.ts` — design checks; `estimate.ts` — pricing; `textures.ts` — procedural materials
- `src/store/` — zustand store with undo/redo and persistence
- `src/components/plan/` — Konva plan; `src/components/three/` — react-three-fiber scene

Stack: Vite, React 18, TypeScript, react-konva, @react-three/fiber + drei, zustand.
