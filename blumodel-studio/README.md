# BluModel Studio

Plan a kitchen to scale with branded cabinets, appliances and finishes, check it
against real kitchen-planning guidelines, price it, and walk through it in 3D. Public at
https://blumodel.studio.

Renamed from **Mise** on 2026-10-13 (this folder was `kitchen-visualizer/`). What changed for a
running install is under *Renamed from Mise* below.

```bash
cd blumodel-studio
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
cookies (Secure in production). Writes require a custom `X-BluModel` header, which
blocks cross-site request forgery; failed logins are throttled per IP and
email; every project query is scoped to its owner. Data lives in
`server/data/blumodel.db` (set `DB_PATH` and `PORT` to change). Behind HTTPS in
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
  paint gallons and cabinet pulls. It is the **cost estimator**, a switch in Account settings >
  Preferences that is **off by default** (and always off when designing on this device): off hides
  the Est. chip, the Estimate tab and the totals on the kitchen cards. A share link with prices
  shows them either way, and a contractor's quotes and price book work either way.
- **Export.** Floor plan PNG, 3D render PNG, shopping list CSV, and a
  `.kitchen.json` project file you can re-import. Exports are paid (below).

## Plans and the Contractor program

`docs/PLANS_AND_CONTRACTORS.md` is the spec. Designing, saving and sharing are free; exports are not.

- Prices are in **Canadian dollars** since 2026-10-15 (older receipts and subscriptions keep their
  US dollars). **Kitchen unlock, $5 CAD once:** every export of that kitchen, forever, including after
  edits; a duplicate is a new kitchen. It is **not advertised**: a free user is offered it in the
  export dialog, next to Unlimited, and nowhere else. **Unlimited, $15 CAD/month:** every kitchen you
  own. Cancelling keeps the plan to the end of the paid month; a failed renewal gets 7 days' grace.
- Every export goes through the paywall. A free user gets the Unlock dialog; someone designing on
  this device first makes a free account and their draft is saved into it. After paying, the export
  they clicked finishes by itself. The server checks every export again and makes the CSV and the
  project file itself.
- **Account → Billing** (`#/account/billing`): plan, change, cancel or resume, unlocked kitchens and
  receipts, plus demo controls for renewals. **Admin → Billing**: MRR, plans, unlocks and churn, with
  demo kept apart from real money.
- **Contractor, $99 CAD/month** (`#/pro`): 3 custom 3D models a month made by our studio (below); company setup; *My catalog* (quick-add a line by type, widths,
  door style and finishes, no 3D model needed; or upload a .glb, checked against the declared size);
  *Brands I carry*; a *price book* with cost per product or per width, % off list per brand, markup
  by product, line, brand or company, and supplier CSV import (preview, then all-or-nothing) and
  export; a Client view / Contractor view switch on the estimate, extra labour and service lines,
  presentation mode, and branded printable quotes. Costs never leave the contractor's account: the
  server tests scan every client-facing response for them. If the plan lapses, everything stays,
  read-only, and kitchens keep their prices.
## Start from a photo, sharing, brand pages and custom models

- **Start from a photo** (`#/generate`): add 1-6 photos of the kitchen as it is now, check the space
  (one tape-measured wall rescales everything; every field is editable), and *Build my kitchen* makes
  that room in the editor, with the photos kept in a floating *Your photos* panel to compare against.
  There is no text box to describe a kitchen. Reading the photos for you needs
  `ANTHROPIC_API_KEY` and `BLUMODEL_LLM_MODEL` (a vision model that supports structured outputs, for
  example `claude-opus-5-5`) in the server's environment; without both, `POST /api/generate/photo`
  answers 503 and the form starts from a typical L-shape. `/api/config` reports `llm: true` once it
  is on. No call to Anthropic has been made from this repo's tests or QA.
- **Share links** (`#/s/:token`, from the Share button): view-only, turn off or expire anytime.
  A contractor's link shows *Prepared by <company>*, their sell prices and a Contact menu, never a
  cost, and offers no Export or Duplicate.
- **Brand page** (a tab of the Contractor workspace, `#/pro/brand`): a contractor's company is the
  brand. Publish My-catalog products to a public page (`#/b/:slug`) and the public catalog after an
  admin approves the page and each product; homeowners can try a product in their kitchen or send
  a lead, which only that contractor can read. `docs/BRAND_PAGE.md` is the spec.
- **Make custom models** (`#/orders`, Contractor plan): 3 custom 3D models a month are included,
  made by our studio. List the products (name, UPC typed, scanned or photographed, photos, size);
  each is one model from the month's allowance, nothing is paid, and the server checks the plan and
  the allowance. The studio delivers a GLB through Admin > Studio into the contractor's private My
  catalog. Withdrawing (or the studio cancelling) before work starts gives the model back; admins can
  grant extra models for the month. Orders paid for before 2026-10-15 keep their prices, receipts and
  refunds. See `docs/PLANS_AND_CONTRACTORS.md` §8.

## The home server (deploy-local)

`npm run deploy:local` builds and copies the app to `%USERPROFILE%\Projects\BluModelStudio` (set
`BLUMODEL_HOME`), keeping `data\blumodel.db` (backed up before every deploy, last 5 kept),
`data\uploads\` and `logs\`, and restarts it on port 8790 (`BLUMODEL_PORT`) under `run-server.cmd`,
a supervisor that restarts the server if it exits. `node scripts/deploy-local.mjs --dist <dir>`
deploys an existing build. The header of `scripts/deploy-local.mjs` has the folder's layout.

- **Private settings** (Stripe keys, `PUBLIC_URL=https://blumodel.studio`, `TRUST_PROXY`,
  `ADMIN_EMAILS`, which grants nothing: admins are made with `node server/scripts/make-admin.mjs <email>`…) live in `blumodel.env` in that folder, one `KEY=VALUE` per line, written by hand
  and never touched by a deploy. If it exists at deploy time, `run-server.cmd` names it in
  `BLUMODEL_ENV_FILE`; the server reads it at start (`server/lib/envFile.mjs`), never prints a
  value, and refuses to start if the named file has gone. A value already in the environment wins
  over the file. With a settings file, the file also decides `DEMO_PAYMENTS` (refused in production
  unless it says `DEMO_PAYMENTS=1`); a home without one allows the labelled demo.
- **Scheduled tasks:** `BluModelStudioServer` runs `start-hidden.vbs` (the supervisor) at logon;
  `BluModelTunnel` runs the Cloudflare tunnel `blumodel` to `http://127.0.0.1:8790`. The deploy
  never creates or changes a task.

## Renamed from Mise

- Session cookie `blumodel_session` (was `mise_session`): everyone signs in once more.
- CSRF header `X-BluModel: 1` (was `X-Mise`).
- Default database `server/data/blumodel.db`. A checkout that only has `server/data/mise.db` keeps
  using it; the home server's deploy renames `data\mise.db` (with its `-wal`/`-shm`) to
  `blumodel.db` after the backup.
- Environment: `BLUMODEL_HOME`, `BLUMODEL_PORT`, `BLUMODEL_HOST`, `BLUMODEL_DEMO_PAYMENTS` (deploy),
  `BLUMODEL_LLM_MODEL` and `BLUMODEL_ENV_FILE` (server). **Deprecated:** `MISE_HOME`, `MISE_PORT`,
  `MISE_HOST`, `MISE_DEMO_PAYMENTS`, `MISE_LLM_MODEL` and `MISE_ENV_FILE` are still read when the
  new name isn't set. Dev-only names were renamed outright: `BLUMODEL_API_PORT` (Vite proxy),
  `BLUMODEL_QA_BROWSER`, `BLUMODEL_UPGRADE_DB`, `BLUMODEL_UPDATE_GOLDEN`.
- Browser storage is `blumodel.*` / `blumodel-*`. On the first visit after the rename every old
  `mise.*` / `mise-*` key moves to its new name (`src/lib/legacyStorage.ts`, run first by
  `src/boot.ts`), and the device-only kitchen's photos move from the `mise-generate` IndexedDB to
  `blumodel-generate`, so a kitchen kept on a device survives.
- GLB finish slots are `blumodel_finish`, `blumodel_cabinet`, `blumodel_hardware` and
  `blumodel_counter`; models made with `mise_*` slots still re-tint.
- The project file's app id is `blumodel-studio` (import never checked it, so old files still open).
- QA hooks are `window.__blumodel`, `__blumodelQA` and `__blumodelQa`; demo users are
  `@blumodel.test`; the demo brand is *BluModel Sample Co. (Demo)* at `#/b/blumodel-sample-co-demo`.
- `node scripts/qa.mjs --pkg rename` checks the name at every width and that a browser used before
  the rename keeps its device kitchen, drafts and photos.

## QA

`node scripts/qa.mjs --pkg all --port 8818` builds nothing: run `npm run build` first. It makes a temp
database, seeds fictional demo data (`npm run seed` does the same for a `DB_PATH` you name), starts
the server on that port and drives the built app in the installed Edge over CDP at desktop and phone
sizes, failing any route on a console error, an uncaught exception, a non-local request or a 5xx.
`--pkg integration` runs the chains that cross packages. Screenshots land in `.qa/<pkg>/`.

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
