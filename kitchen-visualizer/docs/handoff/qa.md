# Handoff: QA runner and seeds (BUILD_PLAN §3.7, F-T9, F-T12)

Built 2026-10-07 on branch `mise/qa`, on top of `claude/gallant-ptolemy-lm7fux` at 4f0a7a6.
Owned: `scripts/qa.mjs`, `scripts/qa-shot.mjs`, `scripts/qa/routes/core.mjs`,
`server/seed/{index,core}.mjs`, the `qa` and `seed` scripts in `package.json`, and this note.

## What shipped

- **`scripts/qa-shot.mjs`**: the zero-dependency CDP driver (Node's built-in `WebSocket`, the
  installed Edge, or Chrome with `--chrome` / `MISE_QA_BROWSER`). Every page runs in its own
  browser context. Requests to any non-loopback host are **blocked before they leave the
  machine** (CDP `Fetch` interception, plus `--host-resolver-rules` so nothing but loopback
  resolves) and reported. Ports 8787 and 8790 are refused before anything is probed. As a command
  it takes one screenshot: `node scripts/qa-shot.mjs http://127.0.0.1:<p>/#/local out.png [--phone]`.
- **`scripts/qa.mjs`** (`npm run qa -- --pkg core --port 8811`):
  - makes a temp dir (DB, uploads, server log), runs `server/seed/index.mjs`, starts
    `server/index.mjs --prod` with `PAYMENTS=demo DEMO_PAYMENTS=1`, `ADMIN_EMAILS=demo-admin@mise.test`,
    a random `SEED_PASSWORD`, `DIST_DIR` with `--dist`, and strips Stripe/Anthropic keys,
    `PUBLIC_URL`, `NODE_ENV` and the like from the inherited environment;
  - builds `server/generated/export-kit.mjs` first if it is missing (the server imports it);
  - signs in one session per role (`anon`, `customer`, `brand`, `studio`, `admin` are the seeded
    demo users; `contractor` is `qa-contractor@mise.test`, made at run time and put on the
    Contractor plan through the real demo checkout, `POST /api/billing/checkout` then
    `POST /api/billing/demo/:ref/complete {outcome:'success'}`; `fresh` is a brand-new free
    customer for that one route) and hands the cookie to the browser with `Network.setCookie`;
  - per route: viewport (`desktop` 1440×900 by default; `phone` 390×844 @3x with touch emulation
    and a phone UA; `tablet`, `laptop`, `phone-landscape`, or `{ w, h, dpr?, mobile? }`), loads
    `http://127.0.0.1:<p>/?qa=1#<path>`, polls `waitFor` and `expectText` (visible text,
    case-insensitive because of `text-transform`), waits `waitMs`, runs `check`;
  - a route **fails** on a console error or assert, an uncaught exception, a browser-level error
    log, a request to a non-local host, an HTTP 5xx, a 4xx for a static asset, a failed local
    request, a missing `waitFor`/`expectText`, or a throwing `check`. API 4xx are recorded in the
    report (`apiErrors`), not failed, since many are expected (401 before sign-in, 403 paywall);
  - writes `.qa/<pkg>/<name>.png` (plus `<name>--<suffix>.png` from `shot()`) and
    `.qa/<pkg>/report.json`; exits 1 on any failure, 2 on a usage error;
  - always kills the browser and server **by PID with their process trees** and removes the temp
    dir in `finally` (and on Ctrl-C); `--keep` keeps the temp dir and prints where;
  - `--pkg all` runs every `scripts/qa/routes/*.mjs`, core first; `--only a,b` (or `pkg/name`);
    `--list`; `--timeout`; `--swiftshader`; `--chrome`; `--strict-external` (see below).
- **Route format** (§3.7, plus what the routes needed): `{ name, path, as, viewport, waitFor,
  waitMs, expectText, timeoutMs, fullPage, reducedMotion, setup, check, ignoreConsole, knownIssue }`.
  `setup({ api, as, me, user, base, sleep })` may return `{ path, ...data }`. `check` gets
  `evaluate, send, api, me, data, sleep, click, mouseDrag, touchDrag, pinch, tap, key, type,
  rectOf, waitFor, waitForText, waitUntil, reload, goto, shot, note, viewport, page`. `api` calls
  as anon; `api.as(role)` as that role; `api.sql(query, ...params)` reaches the temp DB directly
  for states the API can't make. `knownIssue: '<why>'` reports a failing route as KNOWN instead of
  failing the run, and **fails the run if the route starts passing**, so markers get removed.
- **`server/seed/index.mjs`** (`DB_PATH=<file> npm run seed [-- --only core,brands]`): migrates,
  builds the real services with `createApp` (so feature packages' service registrations apply),
  runs `core.mjs`, then imports every other `server/seed/*.mjs` in name order and calls
  `seed(ctx)` with `ctx = { db, config, services, now, log, demo }` (`now` is a function, as in
  `createApp`; `demo = { users: { customer, brand, studio, admin }, brandId, productIds }`).
  Refuses without `DB_PATH` (so it can never touch `server/data/mise.db` by accident) and in
  production (`--prod` or `NODE_ENV=production`) without `--force-demo`. `npm run seed` builds the
  export kit first.
- **`server/seed/core.mjs`**: `demo-customer@mise.test`, `demo-brand@mise.test` (owner of
  *Mise Sample Co. (Demo)*, active, `is_demo=1`), `demo-studio@mise.test` (studio),
  `demo-admin@mise.test` (admin); two published GLB products with PNG thumbnails, *Sample Gas
  Range 30″ (Demo)* and *Sample Dome Pendant (Demo)*. Password: `SEED_PASSWORD`, else the one saved
  in `<dirname DB_PATH>/seed-credentials.txt`, else a generated one written there (mode 0600). It
  is never printed. Idempotent: verified by seeding the same DB three times (4 users, 1 brand,
  1 membership, 2 products, 5 files every time; second run "0 of 4 users created").
- **`scripts/qa/routes/core.mjs`** (40 routes): `#/local` plan, 3D, the demo brand in the catalog,
  the top bar, phone, and the account step of the export dialog; `#/` signed out (desktop +
  phone); the sign-in redirect for `#/account/billing`; `#/` signed in (desktop + phone); `#/new`;
  an opened kitchen (desktop + phone) and its selection toolbar; the Unlock dialog for a free user
  (desktop + phone, plus the server's 403 on a free export); Billing (desktop + phone); `#/pro`
  setup and dashboard (desktop + phone); `#/admin/overview`; an end-to-end **Unlimited demo
  payment** in the browser (no card-like inputs on the page, success returns to Billing, the plan
  is `unlimited`, a CSV export then returns 200); and a text-agnostic render smoke of every other
  routed screen (`#/signup` phone, `#/welcome` and `#/pricing` desktop + phone, `#/generate`,
  `#/p/<demo product>`, `#/b/mise-sample-co-demo`, `#/brand`, `#/orders`, and the six other admin
  tabs). The smoke only asks for some text and no sideways scroll, so packages can replace their
  placeholders without editing core; their own checks belong in `scripts/qa/routes/<key>.mjs`.

## Last run

`node scripts/qa.mjs --pkg core --port 8811` on `dist/` built from this branch, Edge 154, GPU
(ANGLE D3D11): **PASS: 35 passed, 5 known issues, 0 failed** (about 55 s). Every screenshot was
looked at. The five known issues are real app bugs outside these owned paths, listed below.
Same commit: `npx tsc --noEmit -p tsconfig.json` clean; `npm test` 59/59 TS tests and 71/72 server
tests pass (1 skipped: the real-`mise.db` upgrade test, which needs `MISE_UPGRADE_DB`);
`npm run build` succeeds (Vite's usual >500 kB chunk warning for `index` and `SceneView`).

## Requests for the integration pass (files I don't own)

1. **Phone editor shell has no CSS** (routes `local-phone`, `kitchen-open-phone`). `MobileShell.tsx`
   and `Sheet.tsx` (from the `mise(move)` WIP commit c7b9e7a, "cut off by a usage limit before QA")
   render `.mbar`, `.mbar-views`, `.mbar-actions`, `.mbar-badge`, `.sheet`, `.sheet--half|full`,
   `.sheet.is-open`, `.sheet.is-dragging`, `.sheet--catalog`, `.sheet-head`, `.sheet-handle`,
   `.sheet-title`, `.sheet-close`, `.sheet-body`, `.place-banner`, `.place-banner-art|text|cancel`,
   and `src/styles.css` has **no rule for any of them**. On a 390px phone the three sheets
   (Add products, Room & finishes, Details) render inline under the plan with their close buttons,
   and the bottom bar is unstyled text at the very end of the page. What the CSS must do, from
   `Sheet.tsx`'s own comments and `onDown`: closed sheets off-screen, invisible and inert;
   open at half height (`min(full, 54vh)`), full = the sheet's computed `max-height` (85vh
   fallback); `.is-dragging` turns transitions off (the component sets inline `height`/`transform`);
   at `(max-height: 520px)` a sheet is a right-hand panel instead. `.mbar` is a bar fixed to the
   bottom (mind `env(safe-area-inset-bottom)`). Owner: whoever finishes the `move` package, or the
   integration pass. The QA check (`phoneShell` in core.mjs) wants: the bar's bottom at the
   viewport bottom, no closed sheet visible, and the plan/3D stage at least half the screen tall.
2. **Selection toolbar has no CSS** (route `kitchen-selection-toolbar`). `SelectionToolbar.tsx`
   renders `.sel-toolbar`, `.sel-toolbar--<side>` and `.sel-toolbar-sep` with no rules, so selecting
   anything **on desktop** adds a static 23px row of "Rotate Duplicate Delete Details" under the
   whole workspace (it shrinks the editor by that much). It needs `position: absolute|fixed` at the
   coordinates the component computes, and a compact pill style. Same owner as 1.
3. **Kitchen names hidden on phone/tablet home cards** (route `home-signed-in-phone`).
   `src/styles.css`, inside `@media (max-width: 980px)` (around line 1880):
   ```diff
   -  .divider,
   -  .project-name {
   +  .divider,
   +  .topbar .project-name {
        display: none;
      }
   ```
   `HomeScreen.tsx` uses `.project-name` for the card title, so cards show no name below 980px.
4. **"Sign in to save" wraps** in the editor top bar at 1440px (route `local-topbar-fits`): the
   button is 114×57px, the full height of the 58px bar. Seen with QA's fallback fonts (see 5), so
   it may not reproduce with Instrument Sans, but the fix is harmless either way:
   ```css
   .topbar .btn { white-space: nowrap; }
   ```
   If it starts passing after 5, the `knownIssue` marker will fail the run to say so; delete it.
5. **Google Fonts at runtime** (`index.html` lines 9-11). Every page requests
   `fonts.googleapis.com` (and `fonts.gstatic.com` behind it): a third-party request on every
   visit, which the package rules forbid, and it sends every visitor's IP to Google. QA blocks it,
   so QA screenshots use the fallback fonts (Georgia/Segoe UI). Fix: put woff2 files for Fraunces
   (variable, roman + italic), Instrument Sans (variable) and JetBrains Mono 400/500 (all SIL OFL)
   in `public/fonts/`, add `@font-face` rules with `font-display: swap` at the top of
   `src/styles.css`, and delete the three `<link>` lines. Then **delete the `google-fonts` entry
   from `KNOWN_EXTERNAL` in `scripts/qa.mjs`**: until then QA reports it as a known external
   (blocked, not failing; `--strict-external` fails it), and once no route requests it the run
   fails and tells you to delete the entry.
6. **`seed-credentials.txt` is not gitignored.** A generated demo password is written next to
   `DB_PATH`; if that is inside the repo (e.g. `DB_PATH=./tmp/mise.db`), git would offer to commit
   it. Add to `kitchen-visualizer/.gitignore`:
   ```diff
   +seed-credentials.txt
   ```
7. **Stub route files.** F-T12 asks for `scripts/qa/routes/<key>.mjs` stubs (`export default []`)
   for A–E (and G/H by §13); they are owned by those packages, so none were added here.
   `--pkg all` already works with only `core.mjs` present. Billing's handoff says it shipped no QA
   routes because the runner didn't exist; it does now, and `as: 'fresh'` plus the demo checkout
   pattern in `pay-demo-plan-unlimited` are a starting point.

## Decisions (overrule freely)

- **Known external hosts don't fail by default.** The rule is still "no request leaves the
  machine": every non-local request is blocked and listed in the report. Only entries in
  `KNOWN_EXTERNAL` (today just Google Fonts, an `index.html` problem no package owns) are
  downgraded to a warning, and a stale entry fails the run. Without this, every route of every
  package fails on the same foundation bug and hides its own.
- **`contractor` and `fresh` roles** were added to the §3.7 list (`anon|customer|brand|studio|admin`):
  the Contractor workspace needs a paying contractor, and paywall routes need a user with no
  unlocks. Both are made through the API or a direct DB insert, never by editing seeded users.
- **QA users are inserted into the DB directly** (with the real password hash) rather than through
  `/api/auth/signup`, so a long run never trips the signup rate limit.
- **The seed builds services with `createApp`** (not listening) instead of hand-wiring them, so a
  package seed sees exactly the services the server has, including the billing/contractor hooks.

## Not done, or not verified

- No automated test for the seeds or the runner itself: `server/test/**` is foundation-owned and
  outside these paths. Idempotence, the production refusal, the missing-`DB_PATH` refusal and
  "password never printed" were checked by hand (commands in the session report).
- `--chrome` and `--swiftshader` were not exercised in this run (Edge with the GPU was).
- Touch helpers (`touchDrag`, `pinch`, `tap`) are implemented but no core route uses them yet:
  the phone editor they would drive is the unstyled shell in request 1.
- The runner was not tried on macOS/Linux (process-group kill is implemented, untested).
