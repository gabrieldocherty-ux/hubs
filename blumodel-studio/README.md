# BluModel Studio

**Virtual showrooms for kitchen and bath companies.** We build, host and run a 3D design website
for each company: its own name, logo, colours and web address (`acme.blumodel.studio`, or their own
domain), with **their actual products**, which we model for them. Homeowners design their kitchen or
bathroom on it for free, and every design they send arrives in the company's lead inbox with the
plan, the product list and their contact details. The company's staff use the same showroom in their
sales meetings and can turn a design into a photoreal AI rendering. The company never installs
anything. It's a fast, believable rough draft that sells the job, not a CAD tool: final drawings
still come from the company's designer.

- **https://blumodel.studio** is our sales site, aimed at owners and sales managers of cabinet
  showrooms, design-build firms, bath and plumbing showrooms and renovation companies with a
  showroom. **https://demo.blumodel.studio** is the live demo showroom (Northline Kitchen & Bath
  (Demo), fictional).
- **What a company pays** (CAD, `src/data/plans.json`, the server is the only price authority): a
  **setup and yearly license quoted per company** (there is no list price: the sign-up fee differs
  company to company; sold by phone, the amount agreed recorded by an admin), plus **$50/month** by Stripe: **$25** hosting and
  running the showroom *including its web address*, and **$25 of AI render credits** that roll over
  for 3 months. **Homeowners never pay.**
- The plan the whole product works from is [docs/SHOWROOM_PIVOT.md](docs/SHOWROOM_PIVOT.md) (it
  overrides the older PRODUCT_SPEC.md and PLANS_AND_CONTRACTORS.md). Setting a company up after a
  sale is [docs/ONBOARDING_A_COMPANY.md](docs/ONBOARDING_A_COMPANY.md). The server-side reference
  (sites, tenants, isolation, every API) is [docs/handoff/tenancy.md](docs/handoff/tenancy.md).

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
(`scripts/build-kit.mjs` → `server/generated/export-kit.mjs`, gitignored): the editor's estimate and
shopping-list math, so the server makes exports with the exact code the editor runs.

## One server, many sites

The request's `Host` picks the site (`server/tenancy/hosts.mjs`); one server and one database serve
them all:

| Host | Site |
| --- | --- |
| `blumodel.studio`, `www.blumodel.studio` | the sales site |
| `<slug>.blumodel.studio` | that company's showroom |
| a company's own domain, once verified in Admin | the same showroom |
| anything else | 404; a lapsed or suspended showroom answers "temporarily unavailable" (503) |

The domain is `BASE_DOMAIN` (`blumodel.studio` in production, `localhost` in dev and QA, where
Chromium and Edge resolve `*.localhost` to 127.0.0.1). So locally `http://localhost:8790` is the
sales site and `http://demo.localhost:8790` the demo showroom once `npm run seed` has made it.
`X-Forwarded-Host` is never believed. **Tenant isolation is the most important security property:**
accounts, sessions (host-only cookies), kitchens, share links, products, files, leads, team,
credits and plan are all scoped to the showroom the host names, and the tests prove company A can't
read or write anything of company B's through any route.

Payments: with `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` set, the companies' monthly plans go
through Stripe Checkout (webhook: `POST /api/webhooks/stripe`). Without them every payment screen is
a clearly labelled **DEMO** that moves no money and has no card fields; it is refused in production
unless `DEMO_PAYMENTS=1`.

## On a showroom

- **Visitors (homeowners)**, signed out or signed in on that showroom only: the company's landing
  page (brand, welcome, featured product lines, *Design your kitchen* and, if on, *Design your
  bathroom*), the new-kitchen wizard with the company's own lines, the editor with only that
  company's catalog (plus BluModel Basics if the company turns on "fill the gaps", never with store
  links), and **Send this design to <Company>**: name, email, phone, postal code, budget, timeline,
  notes and consent, delivered to the company's inbox with a view-only link to the design.
  Downloads (plan PNG, product list) are free.
- **The company workspace** (`#/studio` on their showroom, for their staff): Showroom (branding,
  contact details, web addresses, fill the gaps), Products (their catalog: products we modelled,
  quick-add, their own prices and markup, private costs, hide; *Request more products* goes to our
  studio queue and is quoted), Leads (new, contacted, quoted, won, lost; notes; CSV export), Renders
  (balance, history, expiry), Team (owner and staff) and Plan (license dates, monthly plan, receipts,
  the Stripe portal).
- **Admin** (on blumodel.studio, for us): Companies (create, license, monthly checkout link, status,
  web addresses, settings, credits, team, usage), Sales leads (the sales site's *Book a call*), the
  studio modelling queue, users and the audit log.

## Accounts and day-to-day use

- **Sign up / sign in / sign out** per site (an address can have one account on the sales site and
  another on a showroom), with sessions that last 30 days and renew while in use. Account settings
  change your name or password (changing the password signs out your other devices).
- **My kitchens:** every saved kitchen as a card with a live mini plan, room size, piece count and
  when it was last edited. Rename, duplicate or delete (with confirmation); search appears once you
  have a few.
- **New kitchen setup:** room size (with common sizes), starting layout previewed for your exact
  room, and the product line, then straight into the editor.
- **Autosave:** changes save about a second after you stop (never mid-drag),
  with a status chip in the top bar. `Ctrl/⌘+S` saves immediately; failed saves
  retry when you're back online, and leaving the page flushes pending work. If
  the same kitchen was saved from another window first, your version is kept
  and you're told.

The server (`server/index.mjs`) has no dependencies: Node's `http`, `crypto`
and built-in `node:sqlite`. Passwords are salted scrypt hashes; sessions are
random tokens stored only as SHA-256 hashes and sent as host-only httpOnly, SameSite=Lax
cookies (Secure in production). Writes require a custom `X-BluModel` header, which
blocks cross-site request forgery; failed logins are throttled per IP and
email; every query is scoped to its owner and its showroom. Data lives in
`server/data/blumodel.db` (set `DB_PATH` and `PORT` to change). Behind HTTPS in
production — put it behind a TLS-terminating proxy (in production, the Cloudflare tunnel).

## The design tool

What every showroom runs. On a showroom the catalog is that company's; on the sales site it is our
own library.

- **Catalog.** Cabinets with industry codes and width
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
  shows them either way.
- **Export.** Floor plan PNG, 3D render PNG, shopping list CSV, and a
  `.kitchen.json` project file you can re-import. Free for the kitchen's owner on every site.
- **Share links** (`#/s/:token`, from the Share button): view-only, turn off or expire anytime. On a
  showroom they stay on that showroom.
- **Photoreal renders** ("Make it photoreal", for a showroom's staff): the current 3D view and a short
  description of the room go to the render service (`ARCHITECT_AI_URL`, `ARCHITECT_AI_KEY`); each
  render reserves credits first (`RENDER_CREDIT_CENTS`, 25 cents until set) and gives them back if it
  fails. Without the service configured the button says renders are being set up and nothing is
  charged. Tests and QA use a `demo` provider and never call a real one.

## Legacy: the homeowner and contractor plans

Before the showroom pivot (2026-10-17) BluModel sold to homeowners and contractors: the $5 CAD
kitchen unlock, Unlimited ($15 CAD/month), the Contractor plan ($99 CAD/month with custom models, a
price book, brand pages and the contractor finder) and *Start from a photo*. **None of it can be bought
any more** (checkout and plan changes answer 410 `not_for_sale`), and the finder, the photo flow and
store links on showrooms are retired (SHOWROOM_PIVOT.md §3). What was already paid keeps working until it ends: receipts,
cancel and resume, the Stripe portal, renewals, refunds and orders. Every contractor company became a
company in setup, its catalog and files moved with it. The old specs, kept as history, are
`docs/PRODUCT_SPEC.md`, `docs/PLANS_AND_CONTRACTORS.md` and `docs/BRAND_PAGE.md`; OPERATIONS.md has
what an admin still does for those customers.

## The home server (deploy-local)

**Another computer** (the Dell Wyse 5070, Ubuntu Server 24.04 recommended, or Windows):
[docs/HOSTING.md](docs/HOSTING.md). One script installs everything from this repo
(`scripts/host/install-linux.sh` or `install-windows.ps1`), the site starts at boot with nobody
logged in, and it updates itself from GitHub once a day at 04:00 (or at once with Admin > System >
Update now), rolling back by itself if the new version doesn't come up (`scripts/host/update.mjs
--auto`; docs/HOSTING.md, "Automatic updates"). Moving the data: [docs/MOVING_DATA.md](docs/MOVING_DATA.md).

**Publishing a version** to it: `npm run release` (`scripts/release.mjs`). It refuses with uncommitted
changes, runs `tsc`, `npm test` and the production build in a clean temporary worktree of HEAD
(`--qa` adds the full QA suite), shows what goes live and asks (`--yes` doesn't), then fast-forward
pushes a **prebuilt** release commit to the `blumodel-studio` branch: the app folder plus its `dist/`
and `server/generated/`, which are committed there and never on a work branch, so the Wyse never
builds anything. `--dry-run` does everything but the push. The release branch also carries
`WYSE_SETUP.md` and `CLAUDE.md` at its top (from `release/`), the setup guide a Claude Code session on
the Wyse follows.

`npm run deploy:local` builds and copies the app to the home (`%USERPROFILE%\Projects\BluModelStudio`
on Windows, `/srv/blumodel-studio` on Linux; set `BLUMODEL_HOME`), keeping `data/blumodel.db` (backed
up before every deploy, last 5 kept), `data/uploads/` and `logs/`, keeping the app it replaces as
`app.previous` (`node scripts/deploy-local.mjs --rollback` puts it back), and restarts it on port 8790
(`BLUMODEL_PORT`): on Windows under `run-server.cmd`, a supervisor that restarts the server if it
exits; on Linux as `blumodel-studio.service` (run with sudo). `node scripts/deploy-local.mjs --dist <dir>`
deploys an existing build. The header of `server/ops/home.mjs` has the folder's layout. After a
healthy start it asks the server, by `Host`, which site `blumodel.studio`, `www.` and `demo.` are,
and warns when the tunnel config doesn't route the showrooms.

- **Private settings** (Stripe keys, `PUBLIC_URL=https://blumodel.studio`, `TRUST_PROXY`,
  `ADMIN_EMAILS`, which grants nothing: admins are made with `node server/scripts/make-admin.mjs <email>`…) live in `blumodel.env` in that folder, one `KEY=VALUE` per line, written by hand
  and never touched by a deploy. If it exists at deploy time, `run-server.cmd` names it in
  `BLUMODEL_ENV_FILE`; the server reads it at start (`server/lib/envFile.mjs`), never prints a
  value, and refuses to start if the named file has gone. A value already in the environment wins
  over the file. With a settings file, the file also decides `DEMO_PAYMENTS` (refused in production
  unless it says `DEMO_PAYMENTS=1`); a home without one allows the labelled demo.
- **Starting with the machine:** on Windows the scheduled task `BluModelStudioServer` runs
  `start-hidden.vbs` (the supervisor) at logon, or at startup with `register-tasks --at-startup`;
  `BluModelTunnel` runs the Cloudflare tunnel `blumodel` to `http://127.0.0.1:8790` for
  `blumodel.studio`, `www.`, every `*.blumodel.studio` showroom and companies' own domains
  (`node scripts/tunnel/setup-tunnel.mjs --validate` writes and checks its config; the wildcard DNS
  record and Cloudflare for SaaS are set up once by hand, docs/ONBOARDING_A_COMPANY.md). On Linux the
  systemd units `blumodel-studio.service` and `blumodel-tunnel.service` do the same at boot
  (`scripts/register-tasks.mjs` installs them). The deploy never creates or changes a task or a unit.

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

Brand names and prices in the built-in library and the demo showroom are invented placeholders. A
real company's products are its own, modelled by us into its showroom's catalog.

## Code map

- `server/tenancy/` — sites, hosts, tenants, isolation, leads, the demo showroom; `server/billing/` — licenses, the monthly plan, credits
- `src/features/showroom/`, `src/features/workspace/`, `src/features/marketing/` — a showroom, the company workspace, the sales site
- `src/data/` — catalog, finishes/surfaces, layout templates, `plans.json` (prices)
- `src/lib/geometry.ts` — footprints, wall/edge snapping, overlaps, backsplash runs
- `src/lib/checks.ts` — design checks; `estimate.ts` — pricing; `textures.ts` — procedural materials
- `src/store/` — zustand store with undo/redo and persistence
- `src/components/plan/` — Konva plan; `src/components/three/` — react-three-fiber scene

Stack: Vite, React 18, TypeScript, react-konva, @react-three/fiber + drei, zustand.
