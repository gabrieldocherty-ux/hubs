# Mise: Build Plan for Parallel Agents

**Implements:** [`PRODUCT_SPEC.md`](./PRODUCT_SPEC.md). **Date:** 2026-10-03.
**Shape:** a **foundation** package (`F`) lands first. After that, five feature packages run **concurrently**. Their owned paths are strictly disjoint, so they merge without conflicts.

```
            ┌──────────── A  viewer    (realistic product viewer, GLB in room, studio render, 3D perf)
            ├──────────── B  brands    (brand portal, moderation, brand page, analytics, demo brands)
 F foundation ─┼──────────── C  orders    (paid custom models, payments demo/Stripe, studio queue, revenue)
            ├──────────── D  generate  (describe-your-kitchen, generator, checks fixes, wizard)
            └──────────── E  share     (share links, landing, pricing)
                                   └──▶ I  integration pass (merge, full test + QA, handoff notes)
```

---

## 1. Ground rules for every package

1. **Scope:** work only inside `kitchen-visualizer/`. Never touch the trading-bot code or anything else in the repo.
2. **Ports:** **never use, probe or kill port 8787**; an unrelated app owns it. Each package uses its own port for servers and QA:

   | Agent | Port | Build dir |
   |---|---|---|
   | F foundation | 8811 | `.build/foundation` |
   | A viewer | 8812 | `.build/viewer` |
   | B brands | 8813 | `.build/brands` |
   | C orders | 8814 | `.build/orders` |
   | D generate | 8815 | `.build/generate` |
   | E share | 8816 | `.build/share` |
   | I integration | 8817 (8818–8819 spare) | `dist/` |

3. **Processes:** every server or browser you start, you kill before you finish, by PID and with its process tree (`taskkill /PID <pid> /T /F` on Windows). `scripts/qa.mjs` already does this. Never kill by port or process name. Use temp dirs for `DB_PATH` and `UPLOAD_DIR`; never use `server/data/mise.db`, which is Gabe's real local data, except for the read-only upgrade test that F does on a **copy**.
4. **Ownership:** a package may create or edit **only** its `ownedPaths` (§4–§9). It may read anything. If it needs a change in a path it doesn't own, it **doesn't make it**. It writes the request into its own `docs/handoff/<key>.md` (what, where, why, and a suggested diff), and the integration pass applies it. Owned paths include each package's pre-created stubs: the foundation creates them, and the package then owns them.
5. **Contracts are frozen:** the exports, props, route names, table names, service functions and wire shapes in §3 are fixed. A package may **add** to its own public surface but must not rename or remove anything in it.
6. **Isolation:** each package runs on its own git worktree and branch, created from the foundation commit (`mise/<key>`). Run `npm ci --prefer-offline` there, or make a directory junction to the foundation worktree's `node_modules`. **If you are forced to share one working tree:**
   - never run `npm run build`, because it writes `dist/`. Use `npx vite build --outDir .build/<key> --emptyOutDir`;
   - use `npm run typecheck` rather than `tsc -b`;
   - errors in another package's paths are not yours: report them, don't fix them;
   - stage only your owned paths. Never `git add -A`.
7. **Dependencies:** no package installs dependencies. The foundation installs everything up front: `@react-three/postprocessing@2.19.1` and `postprocessing@6.39.5`. If you need anything else, put it in the handoff note.
8. **Offline:** no runtime requests to third-party hosts. That means no CDN decoders, no drei `Environment` presets, no `<Stage>` default environment, no `useKTX2`, no `useDetectGPU` and no web fonts. QA fails any page that makes such a request.
9. **Done means green:** `npm run typecheck`, `npm test`, your build dir, and `node scripts/qa.mjs --pkg <key> --port <port> --dist .build/<key>` all pass. Every acceptance item in your section is demonstrably true. Your handoff note lists anything left.
10. **Commits:** messages use the prefix `mise(<key>): …` and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
11. **Honesty:** report what failed or was skipped as plainly as what passed. Gabe's working style asks for negative results to be stated, not buried.

---

## 2. Ownership map (who may edit what after the foundation lands)

| Path | Owner |
|---|---|
| `src/components/three/**`, `src/lib/textures.ts`, `src/features/viewer/**`, `public/draco/**`, `public/env/**`, `scripts/copy-decoders.mjs`, `server/routes/viewer.mjs`, `server/db/migrations/viewer.mjs`, `server/seed/viewer.mjs`, `server/test/viewer.test.mjs`, `scripts/qa/routes/viewer.mjs`, `docs/handoff/viewer.md` | **A viewer** |
| `src/features/brands/**`, `server/routes/brands.mjs`, `server/brands/**`, `server/db/migrations/brands.mjs`, `server/seed/brands.mjs`, `server/test/brands.test.mjs`, `scripts/qa/routes/brands.mjs`, `docs/handoff/brands.md` | **B brands** |
| `src/features/orders/**`, `server/routes/orders.mjs`, `server/payments/**`, `server/db/migrations/orders.mjs`, `server/seed/orders.mjs`, `server/test/orders.test.mjs`, `server/test/payments.test.mjs`, `scripts/qa/routes/orders.mjs`, `docs/handoff/orders.md` | **C orders** |
| `src/features/generate/**`, `src/lib/generate/**`, `src/lib/checks.ts`, `src/data/templates.ts`, `src/data/compose.ts`, `src/data/styles.ts`, `src/screens/SetupWizard.tsx`, `server/routes/generate.mjs`, `server/llm/**`, `server/db/migrations/generate.mjs`, `server/test/generate.test.mjs`, `scripts/qa/routes/generate.mjs`, `docs/handoff/generate.md` | **D generate** |
| `src/features/share/**`, `src/features/marketing/**`, `public/marketing/**`, `server/routes/share.mjs`, `server/db/migrations/share.mjs`, `server/seed/share.mjs`, `server/test/share.test.mjs`, `scripts/qa/routes/share.mjs`, `docs/handoff/share.md` | **E share** |
| **Everything else in `kitchen-visualizer/`**, including `package.json`, the lockfile, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`, `README.md`, `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `src/types.ts`, `src/types/**`, `src/lib/{api,router,track,finish,geometry,estimate,csv,format,exporters,color,id,fronts}.ts`, `src/store/**`, `src/data/{catalog,finishes,defaults,productTypes}.ts`, `src/data/kinds.json`, `src/hooks/**`, `src/screens/**` (except `SetupWizard.tsx`), `src/components/**` (except `three/`), `src/features/README.md`, `server/index.mjs`, `server/app.mjs`, `server/config.mjs`, `server/http/**`, `server/auth/**`, `server/db/{index,migrate}.mjs`, `server/db/migrations/{index,core,platform}.mjs`, `server/files/**`, `server/catalog/**`, `server/lib/**`, `server/routes/{index,auth,projects,catalog,files,events,admin,config}.mjs`, `server/seed/{index,core}.mjs`, `server/scripts/**`, `server/test/{helpers.mjs,fixtures/**}` + foundation tests, `scripts/{qa,qa-shot,test-ts}.mjs`, `scripts/qa/routes/core.mjs`, `docs/PRODUCT_SPEC.md`, `docs/BUILD_PLAN.md` | **F foundation**, **frozen** after it lands. Changes go through handoff notes to the integration pass |

Notes:
- `src/features/<key>/index.ts` is created by F with the exact exports in §3.8, then owned by that package.
- **Package-local tests:** TS unit tests go in `src/features/<key>/__tests__/*.test.ts` (D may also use `src/lib/generate/__tests__/`). Server tests go only in the test files listed above.
- **CSS:** each package puts styles in `src/features/<key>/<key>.css`, imported by its own components. Nobody but F edits `src/styles.css`.

---

## 3. Contracts (defined by F; frozen for A–E)

### 3.1 Server layout

```
server/
  index.mjs            bootstrap (~30 lines): loadConfig → openDb → migrate → createApp → listen(HOST, PORT)
  app.mjs              export createApp({ config, db, fetch? }) → { handler, ctx }   (no listen; testable on port 0)
  config.mjs           export loadConfig(env = process.env, argv = process.argv) → frozen config (below)
  db/index.mjs         openDb(path) (WAL, foreign_keys ON); tx(db, fn) via BEGIN IMMEDIATE/COMMIT/ROLLBACK
  db/migrate.mjs       migrate(db) — runs MIGRATION_MODULES in order, records step ids in schema_migrations
  db/migrations/index.mjs   export const MIGRATION_MODULES = [core, platform, viewer, brands, orders, generate, share]
  db/migrations/{core,platform}.mjs   (F)   {viewer,brands,orders,generate,share}.mjs  (stubs: export const steps = [])
  http/router.mjs      compile route table, gates (auth, csrf, body, rate limit), dispatch, 404/405
  http/body.mjs        readJson (plain objects only → else 400), readRaw(max), streamToTemp(max) → {path, size, sha256}; real 413
  http/respond.mjs     HttpError, send, security headers
  http/static.mjs      safeJoin(path.relative), serveDist (SPA fallback only for extensionless paths), serveFile
  auth/{passwords,sessions,rateLimit,guards}.mjs   async scrypt, sessions, bounded limiter, requireUser/Role/BrandMember
  lib/validators.mjs   validateGlb, sniffImage, verifyStripeSignature   (copied verbatim from the tech research, see F-T5)
  files/{store,meta,policy}.mjs    uploads, GLB/image metadata, read policies
  catalog/{products,brands,events,kinds}.mjs   product service, brand helpers, event recorder, kinds from src/data/kinds.json
  routes/index.mjs     export const ROUTE_MODULES = [auth, projects, config, catalog, files, events, admin, viewer, brands, orders, generate, share]
  routes/*.mjs         one module per area (feature modules are stubs: export default () => [])
  seed/index.mjs       runs core, viewer, brands, orders, share seeds (stubs: export async function seed(){})
  scripts/make-admin.mjs
  test/helpers.mjs, test/fixtures/{glb,images}.mjs, test/*.test.mjs
```

**Config keys** (`loadConfig`; every package reads, only F adds):

```
PORT (8790) · HOST (127.0.0.1) · PROD (NODE_ENV=production or --prod) · DB_PATH (server/data/mise.db) · UPLOAD_DIR (<dirname DB_PATH>/uploads)
DIST_DIR (../dist) · PUBLIC_URL (http://127.0.0.1:<PORT>) · TRUST_PROXY (0) · ADMIN_EMAILS ('') · MAX_GLB_MB (25) · MAX_IMAGE_MB (8)
BRAND_PRODUCT_LIMIT (50) · PAYMENTS ('auto' → 'stripe' iff STRIPE_SECRET_KEY && STRIPE_WEBHOOK_SECRET else 'demo') · DEMO_PAYMENTS (0)
STRIPE_SECRET_KEY · STRIPE_WEBHOOK_SECRET · ANTHROPIC_API_KEY · MISE_LLM_MODEL · SEED_PASSWORD
RATE_LIMITS ('on'; the test harness sets 'off' unless a test opts in with startTestServer({ rateLimits: true }); 'off' is refused when PROD)
derived: config.paymentsProvider ('demo'|'stripe'), config.llmEnabled (both LLM vars set), config.demoPaymentsAllowed (!PROD || DEMO_PAYMENTS)
```

### 3.2 Route modules and the request context

```js
// server/routes/<module>.mjs
/** @param {Ctx} ctx */
export default function routes(ctx) {
  // optional one-time init, e.g. ctx.services.files.addReadPolicy(fn)
  return [
    {
      method: 'POST',                       // GET | POST | PUT | PATCH | DELETE   (HEAD is served by GET routes)
      path: '/api/brands/:brandId/products',// ':name' params match [A-Za-z0-9_-]{1,80}; static segments win over params
      auth: 'user',                         // 'none' | 'optional' | 'user' (default) | 'studio' (studio or admin) | 'admin'
      csrf: true,                           // default true for non-GET; X-Mise: 1 required. Only the Stripe webhook sets false
      body: 'json',                         // 'json' (default for POST/PUT/PATCH) | 'raw' | 'none'
      maxBytes: 1_000_000,                  // json default
      rateLimit: { name: 'brand-create', max: 10, windowMs: 3_600_000, by: 'user' },  // optional; by: 'ip'|'user'|'ip+user'
      handler: async (rc) => ({ brand }),   // return value → 200 JSON; or rc.send(status, body); throw rc.error(404, 'msg')
    },
  ];
}
```

- `rc = { req, res, url, method, params, query /* URLSearchParams */, user /* null | {id,email,name,role} */, body, ip, ctx, send(status, json, headers?), error(status, message, extra?) }`
- `ctx = { config, db, now: () => number, fetch /* injectable for tests */, log, tx(fn), services }`
- A duplicate `method + path` across modules **throws at startup**. Error bodies stay `{ error: string, ...extra }`. Non-`/api` routes are allowed (for example `GET /files/:name`). Paths are owned by module: a feature module may register paths under a foundation prefix (e.g. share registers `/api/projects/:id/shares`) because matching is exact.

**Services (F):**

```js
services.auth   = { requireUser(rc), requireRole(rc, ...roles), isBrandMember(userId, brandId, roles = ['owner','editor']),
                    requireBrandMember(rc, brandId, roles?) /* 404 if not a member */, membershipsOf(userId) }
services.files  = { saveUpload(rc, { kind, visibility, brandId?, maxBytes? }) → FileRecord,   // streams, sniffs, validates, dedupes
                    get(id) → FileRecord | null,
                    assertUsable(fileId, { userId, brandId?, kinds }) → FileRecord,           // 400 unless caller/brand owns it
                    canRead(user, file, rc) → boolean, addReadPolicy((user, file, rc) => boolean),
                    grant(fileId, userId), setVisibility(fileId, 'public'|'private'),
                    url(file, { shareToken? }) → '/files/<sha>.<ext>' | '/api/files/<id>/content[?share=…]' }
services.products = { validateSpec(input, { partial? }) → { ok: true, spec } | { ok: false, errors: [{ field, message }] },
                      create({ source, brandId?, ownerUserId?, visibility, spec, status? }) → row,
                      get(id) → row | null, update(id, specPatch, { expectRevision }) → row /* 409 on mismatch */,
                      setStatus(id, status, { note? }), publish(id) /* spec → live_spec */, archive(id),
                      toWire(row, { which: 'live' | 'working', viewer?, shareToken? }) → Product,
                      listCatalog(user) → Product[], fileIdsOf(spec) → string[] }
services.brands = { get(id), bySlug(slug), toWire(row) → BrandSummary }
services.events = { record({ productId, type, userId }) }        // looks up brand_id, sets UTC day, no IP stored
```

`FileRecord = { id, sha256, ext, mime, sizeBytes, kind, visibility, ownerUserId, brandId, originalName, meta, createdAt }`. `meta` for an image is `{ width, height }`. For a GLB it is `{ bboxM:{x,y,z}, bboxIn:{w,h,d}, triangles, materials:[name], slots:[mise_*], images:[{mime,width,height}], extensions:[…], warnings:[…] }`.

**File read rule (F):** public files can be read by anyone. A private file can be read by its owner, members of its `brand_id`, users with a `file_grants` row, `studio` and `admin`, **or** anyone a registered read policy accepts.

### 3.3 Migrations and the foundation schema

```js
// server/db/migrations/<module>.mjs
export const steps = [
  { id: 'orders-001-orders', up(db) { db.exec(`CREATE TABLE orders (...)`); } },
];
```

- The runner keeps `schema_migrations(id TEXT PRIMARY KEY, applied_at INTEGER)`. Steps run in module order, then array order, each in its own transaction.
- **Never edit or reorder an applied step; append a new one.** Step ids are globally unique and prefixed with the module key.
- A step may reference only foundation tables and its own module's tables.
- An existing `mise.db` (`user_version 0`, created by the old `CREATE IF NOT EXISTS`) upgrades cleanly, because `core-001` is the old DDL, unchanged and idempotent.

`platform-001` (F) creates:

```sql
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','studio','admin'));
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE files (
  id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, ext TEXT NOT NULL CHECK (ext IN ('glb','png','jpg','webp')),
  mime TEXT NOT NULL, size_bytes INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('model','image','reference')),
  visibility TEXT NOT NULL CHECK (visibility IN ('public','private')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL, brand_id TEXT REFERENCES brands(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL DEFAULT '', meta TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
CREATE INDEX files_sha ON files(sha256);  CREATE INDEX files_owner ON files(owner_user_id);
CREATE TABLE file_grants (file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, PRIMARY KEY (file_id, user_id));

CREATE TABLE brands (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, tagline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', logo_file_id TEXT REFERENCES files(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','rejected','suspended')),
  status_note TEXT NOT NULL DEFAULT '', verified_at INTEGER, is_demo INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE brand_members (brand_id TEXT NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, member_role TEXT NOT NULL CHECK (member_role IN ('owner','editor')),
  created_at INTEGER NOT NULL, PRIMARY KEY (brand_id, user_id));
CREATE INDEX brand_members_user ON brand_members(user_id);

CREATE TABLE products (
  id TEXT PRIMARY KEY,                                  -- 'p_' + 24 [a-z0-9]
  source TEXT NOT NULL CHECK (source IN ('brand','custom')),
  brand_id TEXT REFERENCES brands(id) ON DELETE CASCADE, owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','published','rejected','archived')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  spec TEXT NOT NULL, live_spec TEXT,                   -- JSON ProductSpec: working copy / what the catalog serves
  kind TEXT NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL, price_cents INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1, review_note TEXT NOT NULL DEFAULT '',
  submitted_at INTEGER, published_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX products_brand ON products(brand_id); CREATE INDEX products_owner ON products(owner_user_id);
CREATE INDEX products_status ON products(status, visibility);

CREATE TABLE product_events (id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, brand_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('view','add','buy_click','render')), user_id TEXT, day TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX product_events_brand_day ON product_events(brand_id, day);
CREATE INDEX product_events_product_day ON product_events(product_id, day);
```

**The catalog serves** rows where `live_spec IS NOT NULL AND status <> 'archived' AND (brand_id IS NULL OR brand.status = 'active') AND (visibility = 'public' OR owner_user_id = :me)`.

### 3.4 ProductSpec (server JSON) and the wire Product (client)

```ts
// ProductSpec, validated by services.products.validateSpec. Limits are enforced on the server.
{ kind: Kind; variant?: string; category: CategoryId;               // from src/data/kinds.json; brands pick from src/data/productTypes.ts
  name: string /*≤80*/; blurb: string /*≤600*/; sku: string /*≤40, [A-Za-z0-9._\-/ ]*/; skuByWidth?: Record<string,string>;
  widthIn: number /*1–240*/; depthIn: number /*1–120*/; heightIn: number /*0.25–144*/; elevationIn: number /*0–120*/;
  widthOptions?: number[] /*≤16*/; price: number /*USD 0–1e6, 2dp*/; priceByWidth?: Record<string, number>;
  finishes: 'cabinet' | { id: string; name: string; hex: '#rrggbb'; material: MaterialKind; swatchFileId?: string }[] /*1–24*/;
  imageFileIds: string[] /*0–12; first = thumbnail*/; modelFileId?: string; buyUrl?: string /*https only, ≤500*/; specSheetUrl?: string;
  flags?: { trim?: 'brass' | 'steel'; backguard?: boolean } }
```

The wire `Product` is the existing client `Product` plus these optional fields (in `src/types.ts`):

```ts
source?: 'builtin' | 'brand' | 'custom' | 'snapshot' | 'missing'; brandId?: string; brandSlug?: string; isDemo?: boolean;
sku?: string; skuByWidth?: Record<string, string>; priceByWidth?: Record<string, number>;
images?: { url: string; alt?: string }[]; thumbnailUrl?: string; buyUrl?: string; specSheetUrl?: string;
model?: { url: string; fileId?: string; bboxIn?: { w: number; h: number; d: number }; triangles?: number; slots?: string[] };
flags?: { trim?: 'brass' | 'steel'; backguard?: boolean };
status?: 'draft' | 'submitted' | 'published' | 'rejected' | 'archived'; visibility?: 'public' | 'private'; revision?: number; updatedAt?: number;
```

On the wire, `code = sku`, `brand` = the brand's display name ("Your model" for custom products), and `Finish` gains `swatchUrl?`.
Built-in ids match `^[a-z0-9][a-z0-9-]{0,39}$`; server ids match `^p_[a-z0-9]{24}$`.

### 3.5 Files API (F)

| Endpoint | Notes |
|---|---|
| `PUT /api/files?kind=model\|image\|reference&name=<original>&brandId=<id>&visibility=public\|private` | Raw body; `Content-Type` is only a hint. The cap is checked from content-length first, then while streaming → 413. Content is sniffed: GLB via `validateGlb` + extension allowlist (draco, meshopt, mesh_quantization, texture_transform, EXT_texture_webp, KHR_materials_{clearcoat,transmission,ior,sheen,specular,emissive_strength,volume,unlit}; **not** `KHR_texture_basisu`); image via `sniffImage` (PNG / JPEG / WebP, ≤4096²; **SVG rejected**). `kind=reference` is always private. `brandId` requires membership. Rate limit: 120/h/user. Returns `201 { file: FileWire }` |
| `GET /api/files/:id` | Metadata (read rule applies) |
| `GET /api/files/:id/content[?share=…]` | Private bytes. `Cache-Control: private, no-store`, CSP sandbox, nosniff. 404 if not readable |
| `GET /files/<sha256>.<ext>` | Public bytes, served only if a **public** row with that sha exists. `immutable`, fixed MIME (`model/gltf-binary`, `image/png`, `image/jpeg`, `image/webp`), `CSP: default-src 'none'; sandbox`, `CORP: same-origin` |

Storage is `UPLOAD_DIR/<sha[0:2]>/<sha>.<ext>`: written to a temp file, validated, then renamed; duplicates are deleted.

### 3.6 Other foundation endpoints

- `GET /api/config` → `{ payments: 'demo'|'stripe', demoPayments: boolean, llm: boolean, limits: { glbMb, imageMb, brandProducts }, version }`
- `GET /api/auth/me` (and signup/login responses) → `{ user: { id, email, name, role, brands: [{ id, slug, name, status, memberRole }] } | null }`
- `GET /api/catalog` → `{ products: Product[], brands: BrandSummary[], version: string }` (public; adds the caller's private products)
- `GET /api/catalog/products/:id` → `{ product }` (live, or the working copy for members, studio and admin with `?working=1`)
- `GET /api/catalog/brands` → `{ brands: BrandSummary[] }` (active only). `BrandSummary = { id, slug, name, tagline, logoUrl, website, verified, isDemo }`
- `POST /api/events { productId, type: 'view'|'add'|'buy_click'|'render' }` → `204`; `auth: 'optional'`; rate limit 600/h/ip; unknown or built-in ids → 204 no-op
- `GET /api/admin/overview`, `GET /api/admin/users?q=`, `PATCH /api/admin/users/:id { role }` (admin; you can't demote yourself)

### 3.7 Test harness and QA runner

```js
import { startTestServer } from './helpers.mjs';           // node --test server/test/<file>.test.mjs
import { makeGlb } from './fixtures/glb.mjs';              // makeGlb({ w:0.762, h:0.914, d:0.66, materials:['mise_finish','body'], json? }) → Buffer
import { makePng, makeJpeg, makeWebp, svgBytes } from './fixtures/images.mjs';

const t = await startTestServer({ env: { PAYMENTS: 'demo' }, fetch: mockFetch /* optional */ });  // ':memory:' DB, temp UPLOAD_DIR, port 0
const alice = await t.user({ role: 'customer' });     // signs up through the API, then sets the role in the DB; returns an Agent with a cookie jar
const admin = await t.user({ role: 'admin' }); const anon = t.agent();
const r = await alice.post('/api/orders', { ... });   // → { status, body, headers }; X-Mise and JSON headers are added automatically
await alice.putRaw('/api/files?kind=model&name=a.glb', makeGlb({}), 'model/gltf-binary');
const brand = t.brand(alice, { name: 'Test Co', status: 'active' });   // direct DB insert + owner membership (no dependency on package B)
const prod = t.product({ source: 'brand', brandId: brand.id, publish: true, spec: { ... } });  // through services.products
t.setNow(ms);  await t.close();
```

**TS unit tests:** `src/**/__tests__/*.test.ts`. `node scripts/test-ts.mjs [filter]` bundles each with esbuild (already installed with Vite, version 0.21.5) into `.tmp-tests/` and runs `node --test`. Test only pure modules: no DOM, no zustand persistence.

**Headless QA:** `node scripts/qa.mjs --pkg <key> --port <p> --dist <dir> [--swiftshader] [--only <name>]`.
- It starts the built app with a temp DB and upload dir, `PAYMENTS=demo DEMO_PAYMENTS=1`, and `SEED_PASSWORD` set; runs `server/seed/index.mjs`; and logs in as the seeded demo users.
- It drives the installed Edge (`C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`; `--chrome` uses Chrome) over CDP.
- It loads `http://127.0.0.1:<p>/?qa=1#<path>` for each entry in `scripts/qa/routes/<key>.mjs`:

```js
export default [
  { name: 'product-builtin', path: '#/p/range-30', as: 'anon' /* anon|customer|brand|studio|admin */,
    viewport: { w: 1440, h: 900 }, waitFor: '.product-page canvas', waitMs: 1500, expectText: ['Gas Range'],
    setup: async ({ api, as }) => ({ path: '#/p/' + (await api.as('brand').get('/api/catalog')).body.products[0].id }),
    check: async ({ evaluate }) => { if ((await evaluate('window.__miseQa?.frames ?? 0')) > 2) throw new Error('idle render'); } },
];
```

- It writes `.qa/<key>/<name>.png` and `.qa/<key>/report.json`.
- A route **fails** on any console error, uncaught exception, request to a non-local host, missing `waitFor` or `expectText`, or a throwing `check`.
- Debug hooks (`window.__miseQa`) may be exposed **only** when `location.search` contains `qa`.
- The seeded demo users are `demo-customer@mise.test`, `demo-brand@mise.test` (owner of the active demo brand *Mise Sample Co. (Demo)*), `demo-studio@mise.test` and `demo-admin@mise.test`. Their password is `SEED_PASSWORD`, or a generated one written to `<dirname DB_PATH>/seed-credentials.txt`, which is gitignored. Never print it.

### 3.8 Client contracts

**Router** (`src/lib/router.ts`, F):

```ts
export type AdminTab = 'overview' | 'moderation' | 'brands' | 'studio' | 'revenue' | 'users';
export type Route =
  | { name: 'signin' } | { name: 'signup' } | { name: 'home' } | { name: 'new' } | { name: 'local' }
  | { name: 'kitchen'; id: string; add?: string }          // #/k/:uuid?add=
  | { name: 'welcome' } | { name: 'pricing' }              // #/welcome, #/pricing
  | { name: 'generate'; q?: string; from?: string }        // #/generate?q=&from=
  | { name: 'product'; id: string; finish?: string }       // #/p/:id?finish=
  | { name: 'brandPage'; slug: string }                    // #/b/:slug
  | { name: 'brand'; rest: string }                        // #/brand, #/brand/<rest…>
  | { name: 'orders'; rest: string }                       // #/orders, #/orders/<rest…>
  | { name: 'payDemo'; orderId: string }                   // #/pay/demo/:orderId
  | { name: 'share'; token: string }                       // #/s/:token
  | { name: 'admin'; tab: AdminTab };                      // #/admin/:tab
export function parseRoute(hash: string): Route; export function hrefFor(r: Route): string;
export function navigate(r: Route, replace?: boolean): void; export function useRoute(): Route;
export function useHashQuery(): URLSearchParams;  export function pageQuery(): URLSearchParams;  // location.search (Stripe's session_id)
```

`brand` and `orders` take a free `rest` string so their packages can sub-route internally without touching the router.

**Feature surfaces.** F creates each `src/features/<key>/index.ts` and placeholder default-export screens. Every lazy module **default-exports** its component.

```ts
// viewer
export interface ProductStageProps { product: Product; finishId?: string; autoRotate?: boolean; showDims?: boolean; height?: number | string; onReady?: () => void }
export const ProductPage: LazyExoticComponent<ComponentType<{ id: string; finish?: string }>>;
export const ProductStage: LazyExoticComponent<ComponentType<ProductStageProps>>;
export function RenderButton(): JSX.Element | null;               // TopBar slot; must not statically import three/drei
// brands
export const BrandPortal: Lazy<{ rest: string }>; export const BrandPage: Lazy<{ slug: string }>;
export const AdminModerationTab: Lazy<{}>; export const AdminBrandsTab: Lazy<{}>;
// orders
export const OrdersRoot: Lazy<{ rest: string }>; export const DemoPay: Lazy<{ orderId: string }>;
export const AdminStudioTab: Lazy<{}>; export const AdminRevenueTab: Lazy<{}>;
// generate
export const GenerateScreen: Lazy<{ q?: string; from?: string }>;
// share
export const LandingScreen: Lazy<{}>; export const PricingScreen: Lazy<{}>; export const SharedKitchen: Lazy<{ token: string }>;
export function ShareButton(p: { projectId: string | null }): JSX.Element | null;   // TopBar slot; null in local mode
```

`LandingScreen` and `PricingScreen` live in `src/features/marketing/` (owned by E) and are re-exported from `src/features/share/index.ts`. F creates placeholders in both directories.

**App shell** (`src/App.tsx`, F):
- **Public routes:** welcome, pricing, product, brandPage, share, local, generate, plus `home` when signed out, which renders `LandingScreen`.
- **Account routes:** home, new, kitchen, brand, orders, payDemo.
- **admin:** role `admin`, or `studio` (studio sees only the studio tab).
- Lazy screens render inside one `<Suspense>` with the existing `.screen-msg` loader.

**API client** (`src/lib/api.ts`, F):
- exports `call<T>(method, path, body?, opts?)`, `upload<T>(path, file: Blob, query?: Record<string,string>)` (raw PUT with `X-Mise`), `ApiError`, `isUnreachable`, and `api` (auth, projects, config, catalog, events);
- `User` gains `role` and `brands`;
- each package keeps its own calls in `src/features/<key>/api.ts`.

**Catalog registry** (`src/store/useCatalog.ts`, F):

```ts
useCatalog: { version: number; status: 'idle'|'loading'|'ready'|'error'; products: Product[]; byId: Map<string, Product>; brands: BrandSummary[];
              load(force?: boolean): Promise<void>; register(list: Product[]): void; registerSnapshots(rec: Record<string, Product>): void }
useCatalogVersion(): number
// src/data/catalog.ts keeps getProduct(id) (now reads the registry), CATALOG (built-ins), CATEGORIES, itemWidth,
// productCode (uses skuByWidth/sku), priceFor (uses priceByWidth), isOpening, hasCountertop, snapsToWall, isBuiltin(id), missingProduct(id)
```

**Other client helpers (F):**
- `src/lib/track.ts`: `track(productId, type)`, a no-op for built-ins and offline, with `view` de-duplicated per session.
- `src/data/productTypes.ts`: `PRODUCT_TYPES: { id, label, kind, category, variant?, defaults: { widthIn, depthIn, heightIn, elevationIn } }[]`, used by the brand editor and the order form.
- `src/data/defaults.ts`: `DEFAULT_ROOM`, `DEFAULT_SURFACES`.
- `src/store/useDesignStore.ts` gains `readOnly` and `openReadOnly(doc, products)`.
- `src/screens/Editor.tsx` exports `Workspace({ projectId, mode: 'edit' | 'view' })`.

**Types** (F): `src/types.ts` (the Product, Finish, PlacedItem `finishId?` and DesignDoc `version?: 2; products?: Record<string, Product>` additions) and `src/types/platform.ts`:
- `Role`, `SessionUser`, `BrandMembership`, `BrandSummary`, `Brand`, `BrandStatus`, `FileWire`, `GlbMeta`, `ProductSpecInput`, `ProductStatus`, `ProductEventType`, `AppConfig`;
- the order types `OrderStatus`, `ModelTierId`, `ModelTier`, `OrderBrief`, `Order`, `OrderEvent`;
- `ShareLink`, `SharedKitchenWire`, `GenerateBrief`, `LayoutOption`, `AdminOverview`.

Packages may add **package-local** types in their own directory but must not redefine these.

**UI conventions** (written down by F in `src/features/README.md`): reuse the existing `styles.css` tokens and classes (`btn`, `menu`, `screen-msg`, panel classes). Use one CSS file per package. Lazy-load anything that touches three. Use `FeetInchesInput`, `MiniPlan`, `PresetStrip` and `Icons` read-only. Use `money()`, `feetInches()` and `inches()` from `lib/format`.

---

## 4. Package F: foundation (lands first, alone)

**Goal:** turn the single-file server and the static catalog into a platform the five feature packages can build on in parallel: modular server, migrations, roles, uploads, a dynamic catalog, shared types, a test harness and headless QA. It also fixes every high- and medium-severity data and server bug, without changing anything users see except new navigation and placeholders.

**Owned paths:** everything not listed for A–E in §2, including all of A–E's pre-created stub files. It hands those to the packages when it lands.

**May read:** the whole of `kitchen-visualizer/`, and the research scratch files at
`C:/Users/gdoch/AppData/Local/Temp/claude/C--Users-gdoch-Desktop-Hyperliquid-Bot--claude-worktrees-hyperliquid-bot-setup-aad430/0ec14d08-ef48-4006-a159-55057b47a169/scratchpad/qa/{validators.mjs,validators-test.mjs,cdp-shot.mjs}`.

### Tasks

**Server**
- **F-T1 Split the server** into the §3.1 layout. `createApp` must not listen. The old behaviour is preserved route for route, error messages included. `index.mjs` becomes the bootstrap. The default `PORT` is **8790** and the default `HOST` is **127.0.0.1**.
- **F-T2 HTTP hardening:**
  - `readJson` rejects non-objects (400);
  - an oversized body returns a JSON **413** (`Connection: close`, then drain or destroy);
  - `HEAD` on `/api` GET routes works; `OPTIONS` → 405;
  - static serving: `path.relative` containment; a malformed `%` → 400; SPA fallback **only** for extensionless paths, otherwise a real 404; MIME types for `.wasm .glb .webp .jpg .jpeg .hdr .json .png .svg .ico .woff2`; `DIST_DIR` env;
  - security headers kept.
- **F-T3 Auth hardening:**
  - async `crypto.scrypt`;
  - a bounded generic rate limiter (LRU-capped map). Login is limited by `ip+email` and by `email` alone (rotation-resistant); signup by 5/h/ip;
  - `TRUST_PROXY` → first `X-Forwarded-For` hop;
  - `ADMIN_EMAILS` promotes on signup and login;
  - `server/scripts/make-admin.mjs <email>`;
  - `/api/auth/me` returns `role` and `brands`.
- **F-T4 Migrations:** add `db/migrate.mjs` and `migrations/{index,core,platform}.mjs` (§3.3), plus stub modules for A–E. Test that a DB made with the *old* DDL, and a copy of `server/data/mise.db`, both upgrade with users and projects intact (on a temp copy only).
- **F-T5 Validators:** copy `validators.mjs` verbatim into `server/lib/validators.mjs`, and its cases into `server/test/validators.test.mjs`. **If the scratch files are gone**, re-implement them to the behaviour in PRODUCT_SPEC §11 and research T9, T10 and T12: GLB header, chunks, JSON, no URIs, allowlist and count caps; PNG / JPEG / WebP dimensions; Stripe `v1` HMAC with tolerance, multiple `v1` values, and short signatures rejected without throwing.
- **F-T6 Files:** `files/{store,meta,policy}.mjs` and `routes/files.mjs` (§3.5).
  - GLB meta: the bbox comes from POSITION accessor min/max through the node TRS/matrix hierarchy (8 corners per primitive), plus triangles, materials, `mise_*` slots and embedded image dimensions (via `sniffImage` on bufferView bytes).
  - Warnings for >8 MB, >150k triangles, and textures >2048.
  - Hard-reject >25 MB, >1M triangles, and disallowed extensions.
- **F-T7 Catalog:**
  - `catalog/{kinds,products,brands,events}.mjs`;
  - `src/data/kinds.json` (kinds, categories, material kinds), read by the server with a JSON import attribute and by TS through `resolveJsonModule`;
  - `routes/catalog.mjs`, `routes/events.mjs`, `routes/config.mjs`, and `routes/admin.mjs` (overview and users);
  - `products.toWire` maps file ids to URLs through `files.url`.
- **F-T8 Projects:**
  - the route is ported;
  - **strict `validDoc`**: normalise and strip unknown keys; room within the clamp ranges; ≤400 items; `productId` must match the built-in or `p_` regex; rotation enum; finite x/y within ±2000 in; optional `finishId` ≤64; `version` 1|2; `products` ≤100 entries, each ≤8 KB of JSON;
  - **revision is required** (a number) unless `force:true` (otherwise 400 "Reload this kitchen…"), using a conditional `UPDATE … WHERE revision = ?`.
- **F-T9 Seeds:**
  - `seed/index.mjs`, `seed/core.mjs`, and stubs for viewer, brands, orders and share;
  - core creates the 4 demo users and one active, `is_demo` brand, *Mise Sample Co. (Demo)*, owned by `demo-brand`, with **2 published GLB products** built from `fixtures/glb.mjs` with PNG thumbnails: a 30″ range-type product and a pendant-type product, both named "(Demo)";
  - every seed is idempotent and refuses to run in production without `--force-demo`;
  - `npm run seed`.
- **F-T10 Test harness:**
  - `test/helpers.mjs` and `test/fixtures/{glb,images}.mjs` (§3.7). `makeGlb` must produce files that three's `GLTFLoader.parse` accepts and that pass `validateGlb`; `makePng` must produce real deflate PNGs;
  - foundation tests: `http.test.mjs`, `auth.test.mjs`, `projects.test.mjs`, `migrate.test.mjs`, `files.test.mjs`, `catalog.test.mjs`, `validators.test.mjs`, `router.test.mjs` (duplicate routes throw, CSRF gate, auth levels, 404/405);
  - stub `server/test/{viewer,brands,orders,payments,generate,share}.test.mjs`, each holding one `test.todo`.

**Tooling**
- **F-T11 TS test runner:** `scripts/test-ts.mjs` (§3.7), plus TS tests for registry merging, `sanitizeDoc`, `finishId` migration and snapshotting (`src/store/__tests__/`, `src/lib/__tests__/`).
- **F-T12 QA:** `scripts/qa-shot.mjs` (from the scratch `cdp-shot.mjs`) and `scripts/qa.mjs` (§3.7):
  - cookies through CDP `Network.setCookie`;
  - console, exception and network capture;
  - process-tree cleanup in `finally`;
  - `scripts/qa/routes/core.mjs` covers: `#/local` (plan, 3D), `#/` signed out (landing placeholder), `#/` signed in (My kitchens), `#/new`, an opened kitchen, `#/admin/overview`, and the placeholder screens for every new route;
  - stub `scripts/qa/routes/<key>.mjs` (`export default []`) for A–E.
- **F-T13 Package and config:**
  - pin `@react-three/postprocessing@2.19.1` and `postprocessing@6.39.5` exactly;
  - scripts `test`, `test:server` (`node --test "server/test/**/*.test.mjs"`), `test:ts`, `typecheck` (`tsc --noEmit -p tsconfig.json`), `qa`, `seed`, `api`;
  - the `vite.config.ts` proxy target is `http://127.0.0.1:${process.env.MISE_API_PORT ?? 8790}`;
  - `.gitignore` gains `.qa/`, `.build/`, `.tmp-tests/`;
  - the README covers the new ports, env vars, test and QA commands, and drops the "only in production" static claim.

**Client**
- **F-T14 Types:** `src/types.ts` additions and `src/types/platform.ts` (§3.8, §3.4). `src/data/productTypes.ts`.
- **F-T15 Catalog registry:**
  - `useCatalog` (§3.8); `getProduct` reads it;
  - load on app start (non-blocking) and **await it, with a 4 s timeout, before `KitchenEditor` calls `loadDoc`**;
  - the catalog version joins the memo dependencies in `store/derived.ts`, `useSelected`, `PlanItem`, and `SceneView`'s `Item3D`;
  - `CatalogPanel`: registry products, brand facet chips, an image card when `thumbnailUrl` is set, an ⓘ link to `#/p/:id`, "3D model" and "Your model" badges, and the footer link to `#/orders/new`;
  - the `LeftPanel` badge counts the registry;
  - `track(id, 'add')` on placing a server product.
- **F-T16 Doc robustness:**
  - `sanitizeDoc` keeps unknown items and registers `missingProduct` placeholders. It no longer calls `initialDoc()`; it uses `src/data/defaults.ts`. `compose.ts` is updated to import from `defaults.ts`;
  - `PlacedItem.finishId` is filled from `finishIndex` on load; `resolveFinish`, `setFinish`, `applyCabinetFinishToAll`, `setSurfaces` and `applyStyle` resolve by id first;
  - `prepareDocForSave(doc)` sets `version: 2` and embeds snapshots of every non-built-in product in use. It is used by autosave, create, local draft and JSON export;
  - `TopBar` import and `PlanView` drop accept any registry id.
- **F-T17 Brand-name flags:**
  - replace `product.brand === 'Aurelle' | 'Halvard Pro'` in `models.tsx`, `ProductArt.tsx` and `PlanItem.tsx` with `product.flags`, and set those flags on the built-in Aurelle and Halvard Pro products. The renders must be **pixel-identical** in QA;
  - `RoomPanel`'s hard-coded "Nordwell" reads from a `CABINET_BRAND` constant in `finishes.ts`;
  - `ProductArt` and the `RightPanel` inspector show `thumbnailUrl` when present.
- **F-T18 Estimate and CSV:**
  - an `Other` group for unmapped categories;
  - per-width price and SKU;
  - `SKU` and `Buy link` columns in the CSV;
  - the "placeholder prices" disclaimer appears only when a built-in product is present.
- **F-T19 Shell:**
  - router (§3.8) with hash-query parsing; App gating; lazy feature screens; `src/screens/AdminScreen.tsx` with tabs (overview and users implemented, others from feature surfaces);
  - `AccountMenu` links: *Brand portal* (if a member) or *List your products*, *My orders*, *Admin* (studio/admin);
  - `HomeScreen` call to action: *Describe your kitchen* → `#/generate`;
  - `TopBar` slots `<ShareButton projectId/>` and `<RenderButton/>`;
  - `KitchenEditor` handles `?add=` (place it with `findFreeSpot`, then a toast, then clear the query);
  - `Workspace` `mode='view'` (store `readOnly` guards every mutating action; no autosave; `LeftPanel` hidden; `RightPanel` shows summary and estimate only; plan not draggable or droppable; view shortcuts 1–4 still work).
- **F-T20 Autosave conflict:** on a 409, a dialog with *Keep mine* (re-PUT with `force`) or *Load the other version*. There is no automatic force.
- **F-T21 Feature stubs:**
  - every `src/features/<key>/index.ts` with the exact §3.8 exports;
  - placeholder default-export screens showing the screen name and "Coming soon";
  - `ShareButton` and `RenderButton` return null;
  - empty `<key>.css` files;
  - `docs/handoff/<key>.md` templates;
  - `src/features/README.md`.

### Acceptance (F)
1. `npm run typecheck`, `npm test` (all foundation tests green, feature stubs as todo) and `npm run build` all pass. The main chunk is ≤ 675 KB (613 KB today + 10%). All new screens are in separate chunks.
2. Every flow the server map verified still passes as an API test: signup, login, me, patch me, password change (revokes other sessions), logout, project create, list, get, duplicate, delete, cross-user 404, stale-revision 409, forced overwrite, doc-size 413.
3. Regression tests prove these bug fixes:
   - JSON `null` body → 400;
   - `GET /%E0%A4%A` → 400;
   - a 1.2 MB JSON body → 413 JSON (not a reset);
   - PUT without `revision` → 400; two concurrent PUTs with the same revision → exactly one 409;
   - `HEAD /api/auth/me` → 200;
   - `/..%2fdist-x%2fy` → 400 or 404 (never outside `DIST_DIR`);
   - `GET /missing.glb` → 404 (not HTML);
   - `/draco/x.wasm` would be served as `application/wasm` (fixture);
   - 6 signups/h from one IP → the 6th gets 429;
   - login does not block the event loop (a concurrent `/api/auth/me` answers in under 20 ms during 5 logins).
4. Migration tests: a fresh DB, an old-DDL DB, and **a temp copy of `server/data/mise.db`** all reach the latest steps. A second run is a no-op. Old users can still log in (old-DDL fixture).
5. Upload tests:
   - fixture GLB → 201 with `meta.bboxIn` within 0.1 in of the expected size;
   - bad magic, truncated, external buffer URI, `file:` image URI, glTF 1.0, `KHR_texture_basisu`, and an unknown required extension → 400;
   - 26 MB → 413;
   - PNG / JPEG / WebP → 201 with dimensions; SVG → 400;
   - the same bytes twice → one blob on disk;
   - a private file read by another user → 404, by its owner → 200 `no-store`;
   - `/files/<sha>` for a private-only blob → 404;
   - public file headers include `immutable`, `nosniff`, the CSP sandbox and CORP.
6. Catalog tests:
   - draft, submitted-without-live, archived and suspended-brand products are absent from `/api/catalog`;
   - a published public product is present;
   - a private custom product is present only for its owner;
   - `toWire` URLs resolve;
   - the events endpoint records `day` and no IP, and is a no-op for built-ins.
7. TS tests:
   - `sanitizeDoc` keeps an unknown `p_…` item;
   - a v1 doc with `finishIndex` gains a matching `finishId`;
   - reordering a product's finishes no longer changes a placed item's finish;
   - `prepareDocForSave` embeds snapshots of server products only;
   - an estimate with an unknown category still includes its line in the total.
8. QA `--pkg core` on 8811: every core route renders with no console errors and no external requests. The `#/local` 3D screenshot is visually unchanged from the pre-foundation baseline: F takes the baseline first from the unmodified build, and the comparison covers the Aurelle/Halvard flags refactor. Placeholders render for `#/p/x`, `#/b/x`, `#/brand`, `#/orders`, `#/pay/demo/x`, `#/s/x`, `#/generate`, `#/welcome`, `#/pricing` and `#/admin/overview`.
9. A seeded demo GLB product can be placed into `#/local` from the catalog panel (it renders procedurally until package A lands), saved, reloaded, and still present. A product deleted from the DB still shows as a snapshot after reload.
10. `npm run dev` proxies to 8790. Nothing references 8787.

**Contracts delivered:** everything in §3.

---

## 5. Package A: viewer (realistic product viewer, GLB in the room, studio render, 3D performance)

**Goal:** the visual promise. A standalone, colour-true product page with turntable, finishes and dimensions; GLB products in kitchens with procedural fallback; studio-quality high-res room renders; and a 3D view that idles at zero cost.

**Owned paths:** `src/components/three/**`, `src/lib/textures.ts`, `src/features/viewer/**`, `public/draco/**`, `public/env/**`, `scripts/copy-decoders.mjs`, `server/routes/viewer.mjs`, `server/db/migrations/viewer.mjs`, `server/seed/viewer.mjs`, `server/test/viewer.test.mjs`, `scripts/qa/routes/viewer.mjs`, `docs/handoff/viewer.md`.
**May read:** everything. It imports `useCatalog`, `getProduct`, `track`, `api`, `router`, `lib/finish`, `lib/geometry`, `data/finishes`, `format`, and `types`.

### Tasks
- **A-T1 Local decoders:**
  - `scripts/copy-decoders.mjs` copies `node_modules/three/examples/jsm/libs/draco/gltf/{draco_decoder.wasm,draco_wasm_wrapper.js,draco_decoder.js}` to `public/draco/`. Commit the copies;
  - call `useGLTF.setDecoderPath('/draco/')` once; Meshopt works inline;
  - KTX2 is **not** wired.
- **A-T2 `GltfProduct`** in `three/`:
  - per item, `<ModelBoundary fallback={procedural} onReset={() => useGLTF.clear(url)}><Suspense fallback={procedural}>…`;
  - `scene.clone(true)` per instance;
  - Box3 → inches (×39.3701) → **uniform** scale `min(w/bx, h/by, d/bz)` → centre x and z, min.y = 0, then the elevation is applied by the item group;
  - slot remap for `mise_finish` → `finishMaterial(finish)`, `mise_cabinet` → the cabinet finish, `mise_hardware` → `ctx.hwMat`, `mise_counter` → `ctx.counterMat`;
  - shadows on meshes over a size threshold;
  - dispose on unmount;
  - `renderModel()` checks `product.model` first.
- **A-T3 3D performance:**
  - `frameloop="demand"` with `invalidate()` from the `CameraRig` tween, controls, the Room3D cut-away, and doc, surface and catalog changes;
  - a **fixed pendant light pool** of `MAX_LIGHTS` lights mounted once (intensity 0 when unused) and assigned deterministically (no `lights++` during render);
  - `gl.shadowMap.autoUpdate=false` with `needsUpdate` on changes;
  - `dpr [1, 1.5]`;
  - `PerformanceMonitor` steps down DPR and AO;
  - drop `preserveDrawingBuffer`;
  - `castShadow` only on large parts;
  - when `?qa`, expose `window.__miseQa = { frames, calls, programs, triangles }`.
- **A-T4 Room rendering quality:**
  - an `EffectComposer` (multisampling 4, Canvas `antialias:false`) with `N8AO` (halfRes, quality `medium`, aoRadius ≈1.5, intensity ≈2) and `<ToneMapping>` last;
  - a Fast/High quality toggle, stored in localStorage;
  - **tone-mapping A/B:** QA screenshots of the same kitchen with ACES, Neutral and AgX in `.qa/viewer/tonemap-*.png`. Pick the room default (Neutral unless AgX is clearly better) and record the reasoning in `docs/handoff/viewer.md`;
  - wood grain: world-scale UVs with a grain axis for finish-textured Box and Front parts (stiles vertical, rails horizontal);
  - optional, if time allows: companion roughness and normal canvases from `textures.ts` for wood, stone and tile.
- **A-T5 Scene context refactor:** factor `useSceneCtx` out of `SceneView` into `three/sceneCtx.ts` (pure given `Surfaces`, room and paint), so models can render outside a kitchen.
- **A-T6 `ProductStage`** (`src/features/viewer/ProductStage.tsx`, its own lazy demand-driven Canvas):
  - `RoomEnvironment` through PMREM (disposed on unmount), `NeutralToneMapping`;
  - `ContactShadows frames={1}` (or `AccumulativeShadows`);
  - `OrbitControls` with autoRotate (stops on interaction), zoom limits, and `<Bounds fit clip observe>` / `<Center>`;
  - a dimensions overlay (lines + labels for W, D and H in ft-in and cm);
  - works for built-in procedural products (synthetic `Resolved` from `resolve({ id, productId, x:0, y:0, rotation:0, finishIndex })` + the default `SceneCtx`) and for GLB products;
  - physical glass transmission allowed here only;
  - no drei `<Stage>` and no presets.
- **A-T7 `ProductPage`** (`#/p/:id?finish=`):
  - layout per PRODUCT_SPEC §5.4; mobile-friendly (stacked below 900 px);
  - finish swatches and width chips in the URL;
  - a specs table;
  - brand link and badge;
  - gallery;
  - **Add to a kitchen** (a modal listing `api.listProjects()`, then `navigate({name:'kitchen', id, add})`, or "Use the device planner": save the local draft with the item added, then `#/local`);
  - **Buy** (`track('buy_click')`, `noopener nofollow`);
  - **Request a custom version** (`#/orders/new?ref=`);
  - **Download image** (2048 px PNG);
  - `track('view')`;
  - loading, 404 and private states.
- **A-T8 Studio render** (`RenderButton`, a lazy dialog):
  - camera preset (current / overview / eye / front), resolution (1920×1080, 2560×1440, 3840×2160 capped at `min(4096, maxTextureSize)` on the long side), quality (High: full-res N8AO, 8× MSAA; Fast), and tone mapping (Neutral / AgX);
  - offscreen render at the target size via `setPixelRatio`/`setSize`, then `composer.render()`, then `toBlob` in the same task, then restore and `invalidate()`;
  - download `<kitchen>-render-<w>x<h>.png`;
  - the existing `scene` exporter uses the same path, so the TopBar 3D PNG is no longer half-width.
- **A-T9 Server:** nothing is required. If `routes/viewer.mjs` stays empty, say so in the handoff.
- **A-T10 Tests and QA:**
  - TS tests for the fit-transform math (`fitTransform(bboxIn, target)`: uniform scale, centring, min.y) and the light-pool assignment;
  - `viewer.test.mjs`: a built `/draco/draco_decoder.wasm` is served `200 application/wasm` (use a `DIST_DIR` fixture containing your copied files);
  - QA routes:
    - `#/p/range-30` (built-in);
    - `#/p/<seeded GLB product>` (via `setup`);
    - the same with `?finish=` changed;
    - an editor kitchen with the seeded GLB placed (`#/k/:id?add=` as customer);
    - an idle check: 0 frames over 2 s after settle;
    - a pendant check: `programs` count unchanged after adding a pendant;
    - studio render at 3840×2160, checking the returned image dimensions via `evaluate`;
    - the tone-mapping A/B shots;
    - SwiftShader pass for `#/p/range-30`.

### Acceptance (A)
1. Typecheck, `npm test`, build to `.build/viewer`, and `qa --pkg viewer --port 8812` all pass, with zero console errors and **zero non-local requests** (proves there are no CDN decoders or environments).
2. A GLB product renders at its declared footprint in the room: the placed bbox is within 1% of `min`-ratio scaling. A deliberately broken GLB URL shows the procedural fallback, with no blank canvas and no uncaught error.
3. On the default L + island kitchen, idle → **0** renders over 2 s. Adding a pendant → **no** new shader programs and no frame over 100 ms (the baseline was 1,607 ms). Draw calls are reported in the handoff, before and after.
4. The product page shows correct W×D×H for a built-in and a GLB product. Finish swatches change the model; `?finish=` round-trips; `view` and `buy_click` events are recorded (check through `/api/catalog`-side test or a DB query in `viewer.test.mjs`).
5. The studio render produces a 3840×2160 PNG (or the capped size) from split view as well as from 3D view.
6. The 3D chunk gzip size, before and after, is in the handoff (budget: ≤ 400 KB gzip including postprocessing). The main chunk does not grow because of A.
7. The tone-mapping decision and its screenshots are recorded.

---

## 6. Package B: brands (brand portal, moderation, brand page, analytics, demo brands)

**Goal:** a brand can sign up, create its profile, upload products (GLB + images + finishes + dimensions + price + SKU + buy link), submit them for review and see analytics. Admins moderate. Shoppers browse brand pages.

**Owned paths:** `src/features/brands/**`, `server/routes/brands.mjs`, `server/brands/**`, `server/db/migrations/brands.mjs`, `server/seed/brands.mjs`, `server/test/brands.test.mjs`, `scripts/qa/routes/brands.mjs`, `docs/handoff/brands.md`.
**May read:** everything. It imports `ProductStage` from `src/features/viewer` (a placeholder until A lands; it must still look acceptable with the placeholder), and `productTypes`, `api`, `upload`, `useCatalog`, `router`, `format`, `types`.

### Tasks
- **B-T1 Migration** `brands-001`: `product_reviews(id INTEGER PK, product_id → products CASCADE, action 'submit'|'approve'|'reject'|'archive'|'restore', by_user_id, note, created_at)`. Add an invites table only if you build email invites. Adding existing users by email is enough.
- **B-T2 Routes** (`routes/brands.mjs` + `server/brands/*.mjs` helpers):
  - `POST /api/brands {name, website, description}` → pending brand, caller as owner. Slug derived and uniqued; ≤3 brands per user; rate limit 10/h.
  - `GET /api/brands/mine`, `GET/PATCH /api/brands/:brandId` (member; PATCH only `name`, `tagline`, `description`, `website` (https), `logoFileId` (an image owned by the brand)). Editing `name` on an active brand is admin-only.
  - Members: `GET /api/brands/:brandId/members`, `POST {email, role:'editor'}`, `DELETE /:userId` (owner only; the last owner can't be removed).
  - Products:
    - `GET /api/brands/:brandId/products`;
    - `POST` (draft from `ProductSpecInput`; `validateSpec`; files via `assertUsable` with the brand; `BRAND_PRODUCT_LIMIT`);
    - `GET/PATCH /:productId` (PATCH with `revision` → `services.products.update`; editing `published` sets `submitted` while `live_spec` stays served);
    - `POST /:productId/submit` (completeness check + rights checkbox `rightsConfirmed:true`) → `submitted`;
    - `POST /:productId/archive`, `/restore`;
    - `DELETE` (draft only, never published).
    - Product files become public on publish (`files.setVisibility`).
  - Public: `GET /api/brands/by-slug/:slug` → `{brand, products}` (active brands only, live products).
  - Analytics: `GET /api/brands/:brandId/analytics?days=7|30|90` → `{ totals:{view,add,buy_click,render}, byDay:[{day, view, add, buy_click}], topProducts:[{id,name,view,add,buy_click}] }`.
  - Admin:
    - `GET /api/admin/moderation` → `{ products: submitted[], brands: pending[] }`;
    - `POST /api/admin/products/:id/approve` (→ `services.products.publish`, make files public, log a review);
    - `POST /api/admin/products/:id/reject {note}` (note required);
    - `GET /api/admin/brands?status=`;
    - `POST /api/admin/brands/:id/{approve,reject,suspend,reinstate,verify,unverify}` (reject and suspend need a note).
- **B-T3 Portal UI** (`#/brand/<rest>`, inside `BrandPortal`):
  - `join` (form → pending screen explaining the review);
  - dashboard (status banner for pending, rejected or suspended; counts; 30-day analytics bars; latest review notes);
  - `products` (table: thumbnail, name, type, status chip, price, updated);
  - `products/new` and `products/:id`, the editor per PRODUCT_SPEC §6.2:
    - sections with inline validation from server `errors[]`;
    - a product-type picker from `PRODUCT_TYPES` that prefills dimensions;
    - inches or cm entry;
    - a finishes list editor;
    - image upload with reorder (drag or arrow buttons) and delete;
    - GLB upload showing the **validation report** (size, triangles, slots, bbox vs declared dimensions with >5% axis mismatches flagged, warnings) and a `ProductStage` preview;
    - a submit checklist;
    - the reviewer's note shown when the product was rejected;
  - `analytics`;
  - `members`;
  - `profile` (logo upload, tagline, website).
- **B-T4 `BrandPage`** (`#/b/:slug`): header (logo, name, Demo or Verified badge, tagline, website `rel=noopener nofollow`), a grid of live product cards → `#/p/:id`, and a "Try these in a kitchen" link (→ `#/generate`, or `#/local`). A 404 for non-active brands.
- **B-T5 Admin tabs:**
  - `AdminModerationTab`: a submitted list, a detail view with spec diff against `live_spec` (field-level), the GLB report, `ProductStage`, and approve or reject with a note; pending brands with approve or reject;
  - `AdminBrandsTab`: list, filter, actions, and member counts.
- **B-T6 Seed** (`seed/brands.mjs`, idempotent): **fictional** demo brands, `is_demo=1`, active:
  - *Kestrel & Finch Appliances (Demo)* and *Marlow Lighting Co. (Demo)*, owned by `demo-brand@mise.test`;
  - 3–4 published products each, with fixture GLBs (`makeGlb` at realistic dimensions, `mise_finish` slot) and generated PNG thumbnails;
  - one `submitted` product awaiting moderation;
  - one `pending` brand application from `demo-customer`;
  - 30 days of synthetic events so the dashboard isn't empty (they appear in the totals only for `is_demo` brands; label them "demo data" in the UI).
  - **No real company names.**
- **B-T7 Tests** (`brands.test.mjs`):
  - create brand → pending; slug uniqueness; 4th brand → 400;
  - non-member → 404 on every brand route; editor can't manage members; the last owner can't leave;
  - product create validation (bad kind, dimensions out of range, `http:` buy URL, `javascript:` URL, too many finishes) → 400 with field errors;
  - files from another brand → 400;
  - submit without image → 400; submit → admin approve → appears in `GET /api/catalog` with public file URLs;
  - reject requires a note, and the note is visible to the brand;
  - edit published → still served at the old live spec until re-approved;
  - suspend → disappears from the catalog and the brand page 404s; reinstate → back;
  - `BRAND_PRODUCT_LIMIT`;
  - analytics aggregates match inserted events; draft products are not visible publicly via `GET /api/catalog/products/:id`.
- **B-T8 QA routes:** `#/brand` (brand: dashboard), `#/brand/products`, `#/brand/products/<id>` (editor with GLB report), `#/brand/join` (customer), `#/b/<demo slug>` (anon), `#/admin/moderation` and `#/admin/brands` (admin).

### Acceptance (B)
1. Typecheck, `npm test` (all B tests), build to `.build/brands`, and `qa --pkg brands --port 8813` all pass with zero console errors and no external requests.
2. End to end in QA and the API tests: brand user creates a draft → uploads a GLB and an image → submits → admin approves → the product appears in the editor catalog (registry), on `#/b/:slug`, and on `#/p/:id`.
3. The GLB report flags a fixture whose bbox is 10% off the declared width, and passes one within 2%.
4. Every brand and admin route enforces membership and role server-side (tests exist for each).
5. Seeds use only fictional `(Demo)` brands. A grep of `server/seed/brands.mjs` finds no real brand names.

---

## 7. Package C: orders (paid custom models, payments, studio queue, revenue)

**Goal:** a customer or brand requests a custom 3D model, pays (Stripe Checkout when configured, otherwise a clearly-labelled DEMO provider that never touches money), tracks the order, and receives a model that becomes a private or brand product. Staff run the studio queue, and admins see revenue.

**Owned paths:** `src/features/orders/**`, `server/routes/orders.mjs`, `server/payments/**`, `server/db/migrations/orders.mjs`, `server/seed/orders.mjs`, `server/test/orders.test.mjs`, `server/test/payments.test.mjs`, `scripts/qa/routes/orders.mjs`, `docs/handoff/orders.md`.
**May read:** everything. It imports `ProductStage` from the viewer surface, `verifyStripeSignature` from `server/lib/validators.mjs`, services, `productTypes`, `upload`, `FeetInchesInput`, and `format`.

### Tasks
- **C-T1 Migration** `orders-001`:
  - `orders(id 'o_'+24 PK, user_id → users, target 'customer'|'brand', brand_id NULL, status, tier, extras JSON, amount_cents INT, currency 'usd', provider 'demo'|'stripe', provider_ref UNIQUE NULL, payment_intent NULL, brief JSON, ref_product_id NULL, deliverable_product_id NULL, assigned_to NULL, revisions_used INT DEFAULT 0, due_at, paid_at, delivered_at, created_at, updated_at)`, with indexes `(user_id, created_at)` and `(status, paid_at)`;
  - `order_events(id INTEGER PK, order_id → orders CASCADE, type, from_status, to_status, by_user_id, note, data JSON, created_at)`;
  - `payment_events(provider, event_id, type, order_id, received_at, payload JSON, PRIMARY KEY(provider, event_id))`.
  - Statuses: `draft | pending_payment | payment_failed | paid | in_progress | delivered | revision_requested | completed | cancelled | refunded | expired`.
- **C-T2 Tiers and quoting** (`server/payments/tiers.mjs`): Simple $129 / 7 business days, Standard $279 / 10, Complex $549 / 15, +$39 per extra finish beyond 2, rush +50% for half the days, 2 revisions. `quote(brief)` → `{ amountCents, currency, dueBusinessDays, lines[] }`. This is the only source of prices; client amounts are ignored.
- **C-T3 Providers** (`server/payments/{index,demo,stripe}.mjs`):
  - `selectProvider(config)`;
  - interface `createCheckout(order) → { url, ref }`, `retrieve(ref) → { paid, amountCents, currency, paymentIntent }`, `refund(order) → { ok, ref }`;
  - **Stripe** (REST through `ctx.fetch`, so tests can mock it):
    - `POST https://api.stripe.com/v1/checkout/sessions`, form-encoded: `mode=payment`, `line_items[0][price_data][currency|unit_amount|product_data][name]`, `quantity=1`, `client_reference_id`, `metadata[order_id]`, `customer_email`;
    - `success_url=${PUBLIC_URL}/?session_id={CHECKOUT_SESSION_ID}#/orders/<id>`, `cancel_url=${PUBLIC_URL}/#/orders/<id>`;
    - header `Idempotency-Key: <orderId>-<attempt>`;
  - **Demo:** returns `/#/pay/demo/<id>`.
- **C-T4 Routes** (`routes/orders.mjs`):
  - `GET /api/orders/tiers` (public).
  - `POST /api/orders {target, brandId?, brief:{productTypeId, name, widthIn, depthIn, heightIn, notes, referenceFileIds[≤8], refProductId?}, tier, extraFinishes, rush}`. It validates that the reference files are owned by the caller with kind `reference`, and requires brand membership for a brand target. It returns `{order, quote}` in status `draft`.
  - `GET /api/orders` (mine), `GET /api/orders/:id` (owner, studio or admin; `?sync=1` retrieves the Stripe session and fulfils if paid).
  - `POST /api/orders/:id/checkout` → `{url}` (`draft`/`payment_failed` → `pending_payment`).
  - `POST /api/orders/:id/cancel` (before paid).
  - `POST /api/payments/demo/:id/complete {outcome:'success'|'decline'}`: owner only, demo provider only, refused unless `config.demoPaymentsAllowed`.
  - `POST /api/webhooks/stripe` (`csrf:false`, `auth:'none'`, `body:'raw'`, 1 MB): verify with a 300 s tolerance, `INSERT OR IGNORE` into `payment_events`, handle `checkout.session.completed` / `async_payment_succeeded` (paid; check amount and currency against the order; on a mismatch log and don't fulfil), `…expired`, `…async_payment_failed`, `charge.refunded`. Always respond 2xx once verified; 400 if unverified.
  - `markOrderPaid(orderId, {ref, amountCents, currency})` is **one** idempotent function: `UPDATE … WHERE id=? AND status IN ('pending_payment','payment_failed','draft')` → `paid` (+ `due_at`), an event row only if a change occurred.
  - `POST /api/orders/:id/revision {note}` (delivered → `revision_requested`, ≤2) and `POST /api/orders/:id/accept` (→ `completed`).
  - Studio (`auth:'studio'`): `GET /api/studio/orders?status=`, `POST /api/studio/orders/:id/start` (→ `in_progress`, assign), `POST /api/studio/orders/:id/note`, and `POST /api/studio/orders/:id/deliver {modelFileId, thumbFileId, name?, finishes?, dims?}`. Deliver validates the GLB (meta warnings returned), then creates the product through `services.products`:
    - customer target → `source:'custom'`, `visibility:'private'`, `owner_user_id=buyer`, published live; files granted to the buyer;
    - brand target → `source:'brand'`, `brand_id`, draft; files owned by the brand.
    It sets `deliverable_product_id` and moves the order to `delivered`.
  - Admin: `POST /api/admin/orders/:id/refund` (demo: mark refunded; Stripe: `POST /v1/refunds {payment_intent}`; archive a custom product's live entry) and `GET /api/admin/revenue?days=90` → `{ provider, gross, refunds, net, count, byTier[], byDay[], avgTurnaroundDays }` (cents; demo and Stripe kept separate).
  - Pending orders older than 24 h → `expired` (on read and on the list sweep).
- **C-T5 UI:**
  - `OrdersRoot`:
    - `#/orders` (list, status chips);
    - `#/orders/new?ref=&brand=`, a wizard per PRODUCT_SPEC §7.3: drag-and-drop reference upload through `upload()` with `kind=reference`; tier cards; a live server quote; a **"Demo payments – no real money"** banner when `config.payments==='demo'`;
    - `#/orders/:id`: timeline; brief; reference thumbnails; deliverable `ProductStage` with *Add to a kitchen*, *Request revision* and *Accept*; it reads `pageQuery().get('session_id')` and calls `?sync=1`.
  - `DemoPay` (`#/pay/demo/:orderId`): a full-width DEMO banner, the order summary, and buttons *Simulate successful payment* / *Simulate declined payment* / *Cancel*. **There are no card or personal-data fields.**
  - `AdminStudioTab`: the queue sorted by `due_at`; a detail drawer with private reference images, the brief, notes, and deliver (GLB + thumbnail upload, validation report, `ProductStage` preview).
  - `AdminRevenueTab`: KPI tiles, by-tier table, by-day bars, refunds; a "Demo" label when the provider is demo.
- **C-T6 Seed** (`seed/orders.mjs`): orders for `demo-customer` (provider demo) in `paid`, `in_progress`, `delivered` (with a fixture deliverable product) and `completed`, so the queue and revenue aren't empty.
- **C-T7 Tests:**
  - `payments.test.mjs`: all six signature cases (valid, two `v1`, tampered, 10-min old, `v0` only, short signature); webhook dedupe (same event twice → one fulfilment); amount mismatch → not paid; unverified → 400 and no DB change; the webhook works without the `X-Mise` header while every other POST still needs it; Stripe checkout request built with a mocked `fetch` (form fields, idempotency key, `{CHECKOUT_SESSION_ID}` in the query string, server amount);
  - `orders.test.mjs`:
    - quote ignores a client-sent amount;
    - reference files owned by another user → 400;
    - demo flow `draft → pending_payment → paid`; a double `complete` is idempotent; decline → `payment_failed` → retry;
    - the demo route is refused when the provider is Stripe or in production without `DEMO_PAYMENTS`;
    - studio role required for the studio routes (customer → 403);
    - deliver creates a private product visible in `/api/catalog` **only** to the buyer, whose GLB content another user gets as 404 and the buyer as 200;
    - brand-target deliver creates a brand draft;
    - revision limit 2;
    - cancel only before paid;
    - expiry after 24 h (`t.setNow`);
    - refund marks the order refunded and archives the custom product;
    - revenue math.
- **C-T8 QA routes:** `#/orders/new` (customer, each step), `#/orders` (list), `#/orders/<delivered id>`, `#/pay/demo/<id>` (banner visible: `expectText: ['DEMO']`), `#/admin/studio` and `#/admin/revenue` (admin), and a full demo purchase via `check` (click pay → status paid).

### Acceptance (C)
1. Typecheck, `npm test`, build to `.build/orders`, and `qa --pkg orders --port 8814` all pass with zero console errors and no external requests. (The Stripe code path is exercised only with a mocked `fetch`; no real Stripe call is made anywhere.)
2. Full demo lifecycle in QA: request → pay (demo) → studio start → deliver GLB → customer sees the model, adds it to a kitchen → accept. The private product is visible only to the buyer.
3. No screen ever renders a card-number or CVC input. The DEMO banner appears on every payment screen when the provider is demo.
4. Webhook security tests all pass. Prices come only from `tiers.mjs`.
5. With no Stripe env vars, `/api/config` reports `payments:'demo'`. With both set (test values), checkout attempts Stripe (mocked).

---

## 8. Package D: generate (describe your kitchen)

**Goal:** a Drafted-style "describe it → pick from 5 options" flow, built on a declarative layout generator scored by the (fixed) checks and the estimate. Fully offline; the LLM is an optional parser.

**Owned paths:** `src/features/generate/**`, `src/lib/generate/**`, `src/lib/checks.ts`, `src/data/templates.ts`, `src/data/compose.ts`, `src/data/styles.ts`, `src/screens/SetupWizard.tsx`, `server/routes/generate.mjs`, `server/llm/**`, `server/db/migrations/generate.mjs`, `server/test/generate.test.mjs`, `scripts/qa/routes/generate.mjs`, `docs/handoff/generate.md`.
**May read:** everything. It imports `geometry`, `estimate`, `catalog`, `defaults`, `MiniPlan`, `FeetInchesInput`, `PresetStrip`, `api`, `router`, and the store (`saveLocalDraft`).

### Tasks
- **D-T0 Golden capture (do this first):** before touching `templates.ts`, write `src/lib/generate/__tests__/templates.golden.test.ts` with the exact `buildTemplate` output for all 5 templates × 3 room sizes (`DEFAULT_SURFACES`) as recorded from the foundation commit.
- **D-T1 Checks fixes** (`checks.ts`):
  - **hood coverage uses the along-wall axis** for rotations 90/270 (fixes the false pass on east/west walls);
  - landing checks measure real landing width (≥12 in one side and ≥15 in the other for a range; ≥15 in for a fridge, or an island within 48 in) to match their messages;
  - appliances not flush to a wall report `info` instead of auto-passing;
  - the work triangle chooses the sink/range/fridge combination with the best total, not the first found;
  - export the pure helpers the scorer needs.
  - Add a regression test per fix, including the map's west-wall example: range Y 100..130, hood Y 125..155 → must **not** report "covers".
- **D-T2 Declarative templates:**
  - `LayoutSpec { runs: { wall, start, end, slots: Slot[], opts }[]; island?: { widthIn, seats, pendants }; openings; decor }`;
  - role slots `{ role: 'sink'|'range'|'fridge'|'dishwasher'|'base'|'drawer'|'trash'|'tall'|'pantry'|'oven-tower'|'wine'|…, widthIn?, variant? }`, resolved by `pickProduct(role, prefs)` against **built-in** products (brand-preference hook left for later);
  - `buildFromSpec(spec, room, surfaces)`; export `fill`, `layRun` and `prune`;
  - `buildTemplate(id, …)` becomes 5 specs and **must still pass the golden test**;
  - no `getProduct(id)!`: a missing role resolves to null and is skipped with a note.
- **D-T3 `compose.ts`:** `composeDoc(name, room, layout: TemplateId | LayoutSpec | PlacedItem[] | null, preset)`.
- **D-T4 `src/lib/generate/`:**
  - `brief.ts`: `GenerateBrief` type (from `src/types/platform.ts`), defaults, `validateBrief`, clamps;
  - `parse.ts`: offline text → `{ brief: Partial<GenerateBrief>, recognized: Chip[], unrecognized: string[] }` (PRODUCT_SPEC §5.2);
  - `enumerate.ts` (≤60 candidates);
  - `score.ts`: reject on `bad`; penalties for warnings, triangle failure and budget overshoot; bonuses for landing length and seats met; `reasons[]`;
  - `generate.ts`: `generateLayouts(brief, { k: 5, lock? }) → LayoutOption[]`, deterministic, diverse (≤2 per layout type, distinct appliance-wall signatures);
  - `worker.ts` (a Vite module worker) used when there are more than 20 candidates.
- **D-T5 `GenerateScreen`** (`#/generate?q=&from=`):
  - a "Describe your kitchen" textarea (prefilled from `q`) → *Understand* → chips (recognised or not understood; click to edit);
  - the structured brief form (room in ft-in/cm, layout types, appliances, island and seats, pantry, sink, window wall, style presets via `PresetStrip`, budget);
  - *Generate* → 5 cards per PRODUCT_SPEC §5.2, with *Use this* (signed in → `api.createProject(name, '', doc)` → `#/k/:id`; signed out → `saveLocalDraft` → `#/local`), *Lock & regenerate*, and *Compare* (2 side by side);
  - `from=<projectId>` (signed in) seeds the room and style from that kitchen;
  - if `/api/config.llm`, an "Improve with AI" toggle calls `POST /api/generate/brief` and marks LLM-sourced chips;
  - an empty state when nothing fits ("room too small for an island — try …").
- **D-T6 Wizard:** step 3 gets a *Generate options* tab beside the templates, using the step 2 room. Picking an option flows into step 4 (style) unchanged. The 4 existing steps and their behaviour stay intact.
- **D-T7 Server** (`routes/generate.mjs`, `server/llm/anthropic.mjs`):
  - `POST /api/generate/brief {text ≤ 2000}`, `auth:'optional'`, rate limit 20/h by `ip+user`;
  - 503 `{error:'AI parsing is not configured.'}` unless `config.llmEnabled`;
  - otherwise call the Anthropic Messages API through `ctx.fetch` (model `MISE_LLM_MODEL`; key header from `ANTHROPIC_API_KEY`; 15 s timeout) with a system prompt asking for **brief JSON only**;
  - validate against the brief schema and clamp; reject non-conforming output with 502;
  - never log the key or the user's text.
  - (The implementing agent should consult the `claude-api` skill for the current request format.)
- **D-T8 Tests:**
  - TS: ≥20 parser phrases (`12x14 L-shaped kitchen with an island seating 3, 36" gas range, white oak, under $40k`, metric, "no dishwasher", junk text);
  - TS: `generateLayouts` is deterministic, every option has zero `bad` checks and stays inside the room, requested appliances and seat counts are honoured, ≤2 per type, and it runs in ≤1.5 s for 168×192 in (measure and assert generously, 3 s);
  - TS: the golden templates test and the checks regression tests;
  - server: 503 when disabled; with a mocked `fetch`, a valid LLM JSON → clamped brief, while junk, extra prose or out-of-range values → 502 or clamped; no key in the logs.
- **D-T9 QA routes:** `#/generate?q=12x14%20L-shaped%20with%20island%20seating%203` (anon → 5 cards, `expectText` "Use this"), the compare view, the lock-and-regenerate result, `#/new` step 3 with the *Generate options* tab (customer), and *Use this* → editor loads.

### Acceptance (D)
1. Typecheck, `npm test`, build to `.build/generate`, and `qa --pkg generate --port 8815` all pass with zero console errors and no external requests (with no LLM keys set).
2. The golden test proves the 5 templates are unchanged. All checks fixes have regression tests.
3. For each of the 5 template room sizes and 3 sample briefs, the generator returns 3–5 options with no `bad` checks, and the options are visibly different in QA screenshots.
4. Generated kitchens open in the editor and autosave like any other (QA: *Use this* → `#/k/:id` loads; reload persists).
5. The wizard's existing 4-step path still creates the same kitchen as before for template choices (QA screenshot comparison with the foundation baseline).

---

## 9. Package E: share (share links, landing, pricing)

**Goal:** a kitchen can be shown to clients through view-only links, and visitors get a landing page and a pricing page that explain the product honestly.

**Owned paths:** `src/features/share/**`, `src/features/marketing/**`, `public/marketing/**`, `server/routes/share.mjs`, `server/db/migrations/share.mjs`, `server/seed/share.mjs`, `server/test/share.test.mjs`, `scripts/qa/routes/share.mjs`, `docs/handoff/share.md`.
**May read:** everything. It uses `Workspace mode='view'`, `openReadOnly`, `useCatalog.register`, `api`, `call`, `router`, `format`, and `MiniPlan`. The pricing page calls `GET /api/orders/tiers` (package C), with a graceful fallback while that returns 404.

### Tasks
- **E-T1 Migration** `share-001`: `share_links(id 'sh_'+16 PK, project_id → projects CASCADE, token TEXT UNIQUE NOT NULL /* 24 random bytes base64url */, created_by → users, label, show_prices INT DEFAULT 1, expires_at NULL, revoked_at NULL, view_count INT DEFAULT 0, last_viewed_at NULL, created_at)`.
- **E-T2 Routes** (`routes/share.mjs`):
  - `POST /api/projects/:id/shares {label?, showPrices?, expiresInDays?: 7|30|90|null}` (owner; ≤20 active links per project), `GET /api/projects/:id/shares`, `DELETE /api/projects/:id/shares/:shareId` (revoke);
  - `GET /api/share/:token` (`auth:'none'`; 404 if revoked or expired) → `{ kitchen: { name, doc, updatedAt, sharedBy: <first name> }, products: Product[] /* every non-builtin product in the doc, via services.products.toWire with shareToken */, showPrices }`. Never returns `client`, emails or user ids. Increments the view count (rate limited per IP);
  - `POST /api/share/:token/duplicate` (auth user) → creates a project for the caller → `{project}`;
  - in the module init, `ctx.services.files.addReadPolicy` allows a private file when `rc.query.share` is a valid, unexpired, unrevoked token **and** the file belongs to a product used in that project's doc **and** the product is owned by the project owner.
- **E-T3 `ShareButton` + dialog** (TopBar slot; null when `projectId` is null): create a link (label, show prices, expiry), copy to clipboard, the list of links with view counts, revoke. Uses `location.origin + '/#/s/' + token`.
- **E-T4 `SharedKitchen`** (`#/s/:token`):
  - fetch, then `useCatalog.register(products)`, then `openReadOnly(doc, products)`, then render `Workspace mode='view'`, with a header (name, "Shared by …", updated time-ago, *Duplicate to my kitchens*);
  - a product list panel with brand buy links (`track('buy_click')`);
  - prices hidden when `showPrices` is false;
  - the disclaimer;
  - friendly 404 and expired states.
- **E-T5 `LandingScreen`** (`src/features/marketing/`): per PRODUCT_SPEC §5.1.
  - The hero image is a real Mise render saved to `public/marketing/hero.png` (≤400 KB, made with `scripts/qa-shot.mjs` from the `#/local` 3D view or package A's studio render once available; until then a live `MiniPlan` hero is acceptable).
  - How it works, For brands (→ `#/brand/join`), Custom models (→ `#/orders/new`), CTAs, disclaimer footer.
  - No web fonts or third-party images. Responsive down to 375 px.
- **E-T6 `PricingScreen`:** homeowners free; brands "Free during beta, up to 50 products" plus *Planned* tiers (clearly marked, not purchasable); custom-model tiers from `/api/orders/tiers` (fallback copy if unavailable); FAQ (demo payments, file formats, revisions, turnaround, who owns the model).
- **E-T7 Tests** (`share.test.mjs`):
  - owner-only create, list and revoke (others → 404);
  - an anonymous token read works; a revoked or expired token → 404 (`t.setNow`);
  - the response never contains `client`, an email or a user id (deep scan);
  - `showPrices:false` is reflected;
  - duplicate requires auth and creates an owned copy;
  - token ≥ 128 bits of entropy (length check);
  - a private custom-model file: readable with `?share=<valid token>` when used in the doc, 404 for an unused product or a revoked token, and 404 without a token (create the product with `t.product({source:'custom', visibility:'private', ownerUserId})`; no package C dependency).
- **E-T8 QA routes:** `#/welcome` and `#/` (anon), `#/pricing`, `#/s/<token>` (setup: a customer creates a project and share via the API; screenshot the plan and 3D), the share dialog open in the editor (customer), the expired-link state, and mobile 375 px shots of the landing and pricing pages.

### Acceptance (E)
1. Typecheck, `npm test`, build to `.build/share`, and `qa --pkg share --port 8816` all pass with zero console errors and no external requests.
2. In QA, a share link opened anonymously shows the kitchen read-only: dragging an item doesn't move it, there is no catalog panel, no autosave request is sent (check the network log), and the estimate is hidden when prices are off.
3. Revoking a link makes the shared page show the "no longer available" state.
4. The landing and pricing pages render at 1440 px and 375 px with no horizontal scroll, and show the visualizer disclaimer.

---

## 10. Integration pass (I, after A–E land)

1. Merge F, then A–E in any order. They are path-disjoint, so expect no conflicts; any conflict is a plan violation to report.
2. Apply the `docs/handoff/*.md` requests to frozen files, one commit per request.
3. Run on 8817: `npm ci && npm run typecheck && npm test && npm run build && npm run seed` (temp DB), then `node scripts/qa.mjs --pkg all --port 8817` (`--pkg all` runs every routes file).
4. Cross-package smoke in QA:
   - brand uploads → admin approves → customer generates a kitchen → adds the brand product from `#/p/:id` → studio render → shares → the anonymous share shows the GLB;
   - customer orders a custom model (demo) → studio delivers → the model appears only for the customer → the share link shows it.
5. Swap `LandingScreen`'s hero for a studio render if E used the fallback.
6. Re-check that nothing references 8787, no non-local requests occur, the main chunk is ≤ 675 KB, and every started process has been stopped.
7. Write the morning summary for Gabe: what shipped, what failed, screenshots, and §12's open questions.

---

## 11. Known bugs and who fixes them

| # | Bug (source map) | Sev | Owner |
|---|---|---|---|
| 1 | `sanitizeDoc`, TopBar import and PlanView drop silently remove unknown productIds; autosave then makes the loss permanent | high | F |
| 2 | `PlacedItem.finishIndex` is a list position; reordering finishes changes saved designs | high | F |
| 3 | Pendant point lights change the light count → shader re-link, 1.6 s frame; `lights++` mutates during render | high | A |
| 4 | Memo dependencies ignore catalog changes (`derived.ts`, `useSelected`, `PlanItem`, `Item3D`) | med | F |
| 5 | Estimate drops lines from unknown categories out of the total | med | F |
| 6 | Range-hood check falsely passes on east/west walls | med | D |
| 7 | Templates use ~20 hard-coded ids with `getProduct(id)!`; a renamed id crashes boot | med | D |
| 8 | Vite proxy and server default to 8787, which another app owns on this PC; logins would go to it | med | F |
| 9 | Autosave turns every 409 into `force:true` (last writer wins silently) | med | F |
| 10 | Revision check is opt-in and not a conditional UPDATE | med | F |
| 11 | `scryptSync` blocks the event loop; signup has no rate limit | med | F |
| 12 | Login throttle keyed on the socket IP (proxy-unsafe, email rotation, unbounded map) | med | F |
| 13 | Static serving: index.html with 200 for missing assets; no `.wasm`/`.glb`/`.webp`/`.jpg`/`.hdr` MIME; prefix containment; malformed `%` → 500 | med | F |
| 14 | Canvas `frameloop` is `always`: ~1,096 draw calls per frame at idle; `preserveDrawingBuffer` always on | med | A |
| 15 | Every Box/Cyl is its own mesh with shadows on; no instancing | med | A (partial: shadows on large parts only; instancing is a stretch goal) |
| 16 | 3D export at on-screen canvas size; half width from split view | med | A |
| 17 | Wood texture stretched per face (wrong grain scale and direction) | med | A |
| 18 | ACES tone mapping shifts brand colours | med | A |
| 19 | 256 px Lightformer-only environment; generic reflections | med | A (product viewer: RoomEnvironment; room: unchanged, plus AO) |
| 20 | Brand behaviour hard-coded by name (`Aurelle`, `Halvard Pro`, `Nordwell`) | low/med | F |
| 21 | JSON `null` body → 500 | low | F |
| 22 | Oversized body resets the socket instead of a 413; autosave retries forever | low | F |
| 23 | Shallow `validDoc` (negative widths, junk items stored) | low | F |
| 24 | Server binds all interfaces | low | F |
| 25 | No migrations; no `sessions(user_id)` index; HEAD on /api → 403 | low | F |
| 26 | `compose.ts` imports the store; `sanitizeDoc` runs `initialDoc()` on every load | low | F |
| 27 | Server module listens on import (untestable) | low | F |
| 28 | Landing-check messages don't match the logic; non-flush appliances auto-pass; triangle depends on item order | low | D |
| 29 | Faked glass (emissive, opacity) | low | A (viewer: transmission; room: env-mapped transparent) |
| 30 | Module-global caches never disposed (rug material per item) | low | A |
| 31 | README says static serving is prod-only | low | F |
| — | **Deferred, documented only:** keepalive flush capped at 64 KB; `GET /api/projects` returns full docs; Vite/esbuild dev-server advisories; drei 9.122 bump | low | handoff note to Gabe |

## 12. Open questions for Gabe

See PRODUCT_SPEC §15. Every item there is a decision made on his behalf tonight. The billing and contractor decisions are in PLANS_AND_CONTRACTORS §7.

---

## 13. Addendum (2026-10-04): billing (G) and contractors (H)

Gabe added paid exports, plans and a Contractor program: [`PLANS_AND_CONTRACTORS.md`](./PLANS_AND_CONTRACTORS.md). **This addendum extends §2–§10.** Where it conflicts with them, the addendum wins. The shape becomes:

```
F foundation ──┬── A viewer · B brands · C orders · D generate · E share · G billing · H contractors
               └──▶ I integration
```

### 13.1 Ownership additions (extends §2)

| Path | Owner |
|---|---|
| `src/features/billing/**`, `server/routes/billing.mjs`, `server/billing/**`, `server/db/migrations/billing.mjs`, `server/seed/billing.mjs`, `server/test/billing.test.mjs`, `scripts/qa/routes/billing.mjs`, `docs/handoff/billing.md` | **G billing** |
| `src/features/contractors/**`, `server/routes/contractors.mjs`, `server/contractors/**`, `server/db/migrations/contractors.mjs`, `server/seed/contractors.mjs`, `server/test/contractors.test.mjs`, `scripts/qa/routes/contractors.mjs`, `docs/handoff/contractors.md` | **H contractors** |
| `src/data/plans.json` | **F** (frozen; prices and feature bullets, read by server and client) |

### 13.2 Foundation additions (F must deliver these before A–H start)
- **Schema:** add `'contractor'` to the `products.source` CHECK. Use a new appended step that rebuilds the CHECK safely; never edit an applied step. Add stub migration modules `billing` and `contractors` to `MIGRATION_MODULES` (after `share`), stub route modules to `ROUTE_MODULES`, stub seeds, stub tests (`test.todo`) and stub QA route files.
- **`src/data/plans.json`:** `[{ id: 'free'|'kitchen_unlock'|'unlimited'|'contractor', name, priceCents, interval: null|'month', bullets: string[] }]` with prices 0 / 500 / 1500 / 4000. The server imports it with a JSON import attribute. `scripts/deploy-local.mjs` must copy it (generalise to every `src/data/*.json` the server imports).
- **Services (extends §3.2):**
  - `services.webhooks = { on(kind, handler), dispatch(event) }`, where `kind` is the Stripe `metadata.kind` (`order` | `kitchen_unlock` | `subscription`) or the event type for subscription and invoice events. The Stripe webhook route (package C) verifies and dedupes, then calls `dispatch`. C registers `order`; G registers the rest.
  - `services.billing = { planOf(userId) → { id, status, periodEnd, cancelAtPeriodEnd }, canExport(userId, projectId) → boolean, register(impl) }`. The default implementation means **free, no exports**, so the paywall is safe by default; G registers the real one.
  - `services.pricing = { applyForViewer(ownerUserId, products, { viewer }) → Product[], stripDoc(doc, { viewer, ownerUserId }) → doc, register(impl) }`. The default is passthrough for prices, but even the default **strips any `cost`/`margin` fields and `doc.extras[].cost`** for non-owners. H registers the contractor sell-price implementation. E's share route and every server-produced export must call it.
  - `services.contractors = { brandingFor(userId) → PreparedBy | null, register(impl) }`. The default is null. H registers.
- **Wire and types (extends §3.4, §3.8):**
  - `SessionUser.plan: { id: 'free'|'unlimited'|'contractor', status, periodEnd?, cancelAtPeriodEnd? }`, filled from `services.billing.planOf`;
  - `SharedKitchenWire.preparedBy?: { company, logoUrl?, phone?, email?, website? }` and `SharedKitchenWire.hideDuplicate?: boolean`;
  - `DesignDoc.extras?: { id, label, amount, cost? }[]` (validated by `validDoc`);
  - `src/types/platform.ts` gains `PlanId`, `Plan`, `Subscription`, `Entitlements`, `ExportKind`, `PreparedBy`, `PriceBookRow`, `ContractorProfile`.
- **Router (extends §3.8):** add `{ name: 'billing' }` (`#/account/billing`), `{ name: 'pro'; rest: string }` (`#/pro`, `#/pro/<rest…>`), and `{ name: 'payDemoPlan'; ref: string }` (`#/pay/demo-plan/:ref`). Add `AdminTab` `'billing'`.
- **Feature surfaces (extends §3.8):**
  ```ts
  // billing
  export const BillingPage: Lazy<{}>; export const DemoPlanPay: Lazy<{ ref: string }>; export const AdminBillingTab: Lazy<{}>;
  export function useEntitlements(projectId: string | null): { loading: boolean; canExport: boolean; watermark: boolean; plan: PlanId };
  export function requestExport(projectId: string | null, kind: ExportKind, run: () => Promise<void> | void): Promise<void>; // opens the Unlock dialog when not entitled
  // ExportKind = 'plan_png' | 'scene_png' | 'csv' | 'json' | 'render' | 'quote'
  // contractors
  export const ContractorRoot: Lazy<{ rest: string }>;
  export function usePriceBook(): { ready: boolean; isContractor: boolean; priceOf(product: Product, widthIn: number): { sell: number; cost?: number } };
  export function ClientViewToggle(): JSX.Element | null;  // RightPanel estimate slot; null for non-contractors
  ```
  The F stubs are: `useEntitlements` → `{ loading:false, canExport:true, watermark:false, plan:'free' }` (so F/A QA can export before G lands; G makes it real); `requestExport` → just calls `run()`; `usePriceBook` → list prices, `isContractor:false`; `ClientViewToggle` → null.
- **Client wiring (F):**
  - every Export menu item, and the JSON export, goes through `requestExport(projectId, kind, run)`;
  - `estimate(doc, { priceOf })` accepts an optional price resolver, and the RightPanel estimate shows cost, markup and margin columns only when `priceOf` returns `cost` **and** the `ClientViewToggle` is on Contractor view;
  - `doc.extras` lines are listed and totalled;
  - `AccountMenu` gains *Billing* and *Contractor workspace* (plan `contractor`) or *For contractors*;
  - `App` gating adds `billing`, `pro`, `payDemoPlan` (account routes) and `admin/billing`.

### 13.3 Changes to existing packages
- **A viewer:** the studio render reads `useEntitlements(projectId)`. When `watermark` is true, the on-screen preview is watermarked (a repeated diagonal "Mise · Preview" at low opacity plus a corner badge), and *Download* goes through `requestExport(projectId, 'render', …)`. QA: a free user sees the watermark; an entitled user's download has none.
- **C orders:**
  - the brief accepts `target: 'contractor'`; deliverables become `source:'contractor'`, `visibility:'private'`, owned by the buyer, landing in their My catalog;
  - **multi-item requests:** `items[]` (≤ 20) of the same line, each priced per item from `tiers.mjs`, with one checkout, studio delivery per item, and order status `delivered` when all items are delivered;
  - the Stripe webhook route verifies, dedupes and calls `services.webhooks.dispatch`; C handles only `metadata.kind === 'order'`;
  - `AdminRevenueTab` stays orders-only; G owns subscription revenue.
- **E share:**
  - the pricing page renders the 4 plans from `src/data/plans.json`, with the Contractor pitch line ("Show your customers the exact cabinets you sell, in their kitchen, at your price."), plus custom-model tiers and an FAQ (add "Why are exports paid?", "What does the $5 unlock cover?" and "Can I cancel?");
  - `GET /api/share/:token` passes products and the doc through `services.pricing` (viewer `null`) and includes `preparedBy` / `hideDuplicate` from `services.contractors`;
  - `SharedKitchen` renders the "Prepared by" header and a Contact button when present, and hides Duplicate when `hideDuplicate`;
  - a test proves no `cost`/`margin`/`extras[].cost` appears in the share wire for a contractor-owned kitchen (deep scan, using a registered fake pricing impl).

## 14. Package G: billing

**Goal:** PLANS_AND_CONTRACTORS §1–§3 and §5: the export paywall, the $5 kitchen unlock, the $15 and $40 subscriptions, the studio-render watermark entitlement, Account → Billing, and Admin → Billing.

**Owned paths:** §13.1. **Port:** 8818.

**Tasks**
- **G-T1 Migration `billing-001`:**
  - `subscriptions(id, user_id UNIQUE → users, plan CHECK('unlimited','contractor'), status CHECK('active','past_due','canceled','incomplete'), provider, customer_ref, subscription_ref UNIQUE, current_period_end, cancel_at_period_end INT, grace_until, created_at, updated_at)`;
  - `kitchen_unlocks(project_id PK → projects CASCADE, user_id, provider, payment_ref UNIQUE, amount_cents, created_at)`;
  - `billing_checkouts(ref PK, user_id, kind CHECK('kitchen_unlock','subscription'), project_id NULL, plan NULL, status, provider, provider_ref NULL, created_at, completed_at NULL)`;
  - `export_events(id, project_id, user_id, kind, created_at)`.
- **G-T2 Server (`server/billing/**`, `routes/billing.mjs`):**
  - `GET /api/billing/plans`;
  - `GET /api/billing/me` (plan, unlocks, receipts);
  - `POST /api/billing/checkout {kind:'kitchen_unlock', projectId} | {kind:'subscription', plan}` → `{url}` (Stripe `mode=payment` or `mode=subscription` via `ctx.fetch`, with `metadata.kind` and refs; demo → `#/pay/demo-plan/:ref`);
  - `POST /api/billing/demo/:ref/complete {outcome}` (refused unless `demoPaymentsAllowed`);
  - `POST /api/billing/portal` (Stripe billing portal session; demo → `#/account/billing?demo=1`);
  - `POST /api/billing/change {plan}`, `POST /api/billing/cancel`, `POST /api/billing/resume`;
  - `POST /api/projects/:id/exports {kind}` → 403 `{error, needs:'unlock'}` unless entitled; otherwise it records the event, returns `{ok:true}` for image kinds, and **returns the file content for `csv` and `json`** (generated on the server from the saved doc, the catalog and `services.pricing`);
  - `GET /api/admin/billing` (admin: active by plan, MRR, unlocks, churn; demo vs Stripe);
  - register `services.billing` (`planOf` with grace handling, `canExport`) and the webhook handlers (`kitchen_unlock` checkout completed → unlock; subscription created/updated/deleted; invoice paid → extend; invoice failed → `past_due` + `grace_until` = +7 days; after grace → free). Every handler is idempotent.
- **G-T3 Client (`src/features/billing/**`):**
  - the real `useEntitlements` and `requestExport` (the Unlock dialog per PLANS §2, the account-creation step for `#/local` drafts, resume intent through sessionStorage plus the return URL, auto-run of the pending export on return, the toast);
  - the CSV/JSON exports download the server-produced content;
  - `BillingPage`, `DemoPlanPay` (DEMO banner, Simulate success / decline / renewal / cancel, no card fields) and `AdminBillingTab`.
- **G-T4 Tests:**
  - free user → 403 on every export kind;
  - a $5 unlock (demo) → that kitchen exports, another kitchen doesn't, and its duplicate doesn't;
  - unlimited → all of their own kitchens export, but not someone else's;
  - cancel → still entitled until period end, then not;
  - `past_due` → entitled through grace, then not;
  - webhook idempotency (same event twice → one unlock);
  - Stripe requests built correctly with a mocked fetch (mode, metadata, success/cancel URLs, idempotency key, server-side prices only);
  - a client-sent price is ignored;
  - the demo route is refused in production without `DEMO_PAYMENTS`;
  - the server-generated CSV/JSON match what the client used to produce (golden).
- **G-T5 QA routes:** a free user clicks Export → Unlock dialog; demo-unlock → the export auto-runs; `#/account/billing` for free, unlimited and contractor; the watermark visible for free and absent after unlock; `#/pay/demo-plan/:ref` (DEMO banner); `#/admin/billing`.

**Acceptance (G):** typecheck, `npm test`, build to `.build/billing`, and `qa --pkg billing --port 8818` all pass with zero console errors and no external requests. No screen renders card fields. Every export path is refused server-side for non-entitled users.

## 15. Package H: contractors

**Goal:** PLANS_AND_CONTRACTORS §4: the Contractor workspace, private catalog (quick add, GLB upload, request modelling), brands carried, price book with cost and markup and CSV import/export, contractor/client estimate views, extra lines, branded shares, quotes and presentation mode, and the lapsed read-only state.

**Owned paths:** §13.1. **Port:** 8819.

**Tasks**
- **H-T1 Migration `contractors-001`:** `contractor_profiles(user_id PK, company, logo_file_id, phone, email, website, service_area, default_markup_pct, tax_pct, created_at, updated_at)`, `carried_brands(user_id, brand_key /* brand id or 'builtin' */, enabled, pct_off_list NULL, markup_pct NULL, PK(user_id, brand_key))`, `price_book(user_id, product_id, cost_cents NULL, cost_by_width JSON NULL, markup_pct NULL, PK(user_id, product_id))`.
- **H-T2 Server (`server/contractors/**`, `routes/contractors.mjs`).** Every route requires plan `contractor` via `services.billing.planOf`; lapsed means GET only.
  - Profile CRUD (logo through the files API).
  - Contractor products: create (quick add without a model, or with a `modelFileId` from the files API; validated by `services.products.validateSpec`; `source:'contractor'`, private, live on save since it needs no moderation), list, update, archive.
  - Carried brands.
  - Price book: get the merged rows (own + carried public + built-ins); PATCH a row; per-brand defaults.
  - CSV import with preview (`POST …/price-book/import?dryRun=1`, then apply) and CSV export.
  - Quote data: `GET /api/pro/quotes/:projectId` (owner only).
  - Register `services.pricing` (sell = cost × (1+markup), with defaults, overrides and per-width; no cost → list price, flagged; strip cost/margin for non-owners) and `services.contractors.brandingFor` (`hideDuplicate: true` for contractor-owned shares).
- **H-T3 Client (`src/features/contractors/**`, `#/pro/<rest>`):**
  - setup wizard (PLANS §4.1);
  - Dashboard;
  - My catalog: quick-add form with the product type picker from `PRODUCT_TYPES`, widths, door style, finishes and photos; GLB upload with the validation report and a `ProductStage` preview; "Have Mise model it" → `#/orders/new?target=contractor`;
  - Brands I carry;
  - Price book: an editable table with CSV import preview and export;
  - Quotes list plus the printable quote page `#/pro/quote/:projectId` (print CSS; printing goes through `requestExport(projectId, 'quote', () => window.print())`);
  - Company;
  - Presentation mode;
  - the real `usePriceBook` and `ClientViewToggle`;
  - the read-only lapsed banner.

  The catalog panel ordering ("My catalog first, then brands carried") is applied through a `usePriceBook`-adjacent `useContractorCatalog()` hook exported from the feature index. Request the CatalogPanel hook-up through the handoff note if F's panel doesn't call it.
- **H-T4 Tests:**
  - non-contractor → 403 on every `/api/pro` route; lapsed → GET only;
  - contractor products are invisible to other users and in `/api/catalog` for others;
  - price math (defaults, per-brand, per-product, per-width, no-cost fallback);
  - CSV import (matched / new / unmatched; bad rows reported; no partial apply on error);
  - **costs never leave:** a deep scan of the share wire, the catalog for other users, and server-generated exports for a contractor-owned kitchen;
  - a quote requires ownership.
- **H-T5 QA routes:** `#/pro` setup wizard; My catalog quick-add → the product appears in the editor's catalog panel first and renders in plan and 3D; the price book with a CSV import preview; the estimate Contractor/Client toggle; the quote page (screenshot, print layout); a contractor share link (anon) showing "Prepared by …", sell prices and no cost text anywhere in the DOM; lapsed read-only.

**Acceptance (H):** typecheck, `npm test`, build to `.build/contractors`, and `qa --pkg contractors --port 8819` all pass with zero console errors and no external requests. Cost data never appears in any non-owner response or DOM (tests and QA prove it).

**Ports:** G uses 8818 and H uses 8819, and the integration pass moves to 8827 (8828–8829 spare). The `.qa/` output for G and H goes in `.qa/billing` and `.qa/contractors`.
