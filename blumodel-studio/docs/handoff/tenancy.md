# Handoff: tenancy, the server backbone of the showroom pivot

For the packages that build on it. The plan is `docs/SHOWROOM_PIVOT.md`; this file is what the
server now does and how to use it. Everything below is covered by `server/test/tenancy-*.test.mjs`.

## 1. Sites and hosts

The request's `Host` header picks the site (`server/tenancy/hosts.mjs`):

| Host | Site |
|---|---|
| `BASE_DOMAIN`, `www.BASE_DOMAIN`, `localhost`, any IP address, no Host | the **sales site** (`site: 'sales'`) |
| `<slug>.BASE_DOMAIN` | that tenant's **showroom** (`site: 'showroom'`) |
| a hostname in `tenant_hostnames` (custom domain, once verified) | that showroom |
| anything else | **404**: JSON `{ error, code: 'unknown_host' }` for `/api`, an HTML page otherwise |

- `BASE_DOMAIN` (config): `blumodel.studio` in production, `localhost` otherwise. QA servers set
  `BASE_DOMAIN=localhost` (scripts/qa.mjs), so the demo showroom is `http://demo.localhost:<port>`
  (Chromium/Edge resolve `*.localhost` to 127.0.0.1; Node does not, see Tests).
- `X-Forwarded-Host` is **never** believed, not even with TRUST_PROXY (cloudflared passes the
  visitor's Host through; Cloudflare forwards a client's own X-Forwarded-Host untouched).
- Links never take a hostname from the request: `services.tenants.originOf(tenant, from)` uses the
  stored hostname (primary verified, else `<slug>.BASE_DOMAIN`) and only the scheme and port of
  `from` (`requestOrigin(rc.req, config)`). Custom domains are always `https://`.
- A **lapsed** or **suspended** showroom answers everything with **503** (`{ error, code:
  'showroom_unavailable', status }` for `/api`, a "temporarily unavailable" HTML page for documents,
  with the company's phone/email if set), except `GET /api/config` and `/api/health`. Data is kept.
- A **setup** showroom is reachable (the team builds it there); show visitors a "coming soon" if you
  like, from `tenant.status`.
- A **trial** showroom (Admin > Companies > Quick setup) is live until `trial_ends_at`, then lapses
  like any unpaid one (503, data kept). Visitors' `tenant.status` says `live` for it; the workspace and
  admin wires say `trial`.

### Routes and hosts

Every route has `hosts: 'sales' | 'showroom' | 'any'`; elsewhere it is a 404 as if it didn't exist.
A module's routes default to `'any'` only when the module is in `SHOWROOM_MODULES`
(`server/routes/index.mjs`): `auth, projects, config, catalog, files, events, share, account, ops,
tenants*`. **Every other module is sales-only** (brands, finder, contractors, orders, generate,
viewer, billing except its export route, admin, admin-panel, webhooks). To open a module on
showrooms: scope every query to `rc.site.tenantId`, add tests in the style of
`tenancy-isolation.test.mjs`, then add it to `SHOWROOM_MODULES` (that test pins the list). A single
route can also say `hosts` itself. `auth: 'admin'` and `'studio'` routes are always sales-only;
`auth: 'staff'` / `'owner'` always showroom-only.

## 2. The current site and tenant

**Server**, in any route handler (`rc` from `server/http/router.mjs`):

```js
rc.site      // { kind: 'sales' | 'showroom', hostname, tenant, tenantId, available }
rc.tenant    // the TenantRecord on a showroom (status freshly computed), else null
rc.memberRole// 'owner' | 'staff' | null: the signed-in user's role on THIS showroom
rc.user      // as before; on a showroom role is always 'customer' and user.tenantId says whose account
```

New auth levels: `auth: 'staff'` (signed in AND a member of this showroom: 401/403 `not_staff`) and
`auth: 'owner'` (403 `owner_only`). Services on `ctx.services`: `tenants`, `showroomBilling`,
`credits`, `leads` (below).

**Client**: `GET /api/config` now carries

```js
{ site: 'sales' | 'showroom', tenant: PublicTenant | null, baseDomain, renderCreditCents, ...as before }
```

`GET /api/showroom` returns `{ site, tenant }` alone. `GET /api/auth/me` (and every auth response)
user gains `showroom: null` on the sales site, `{ tenantId, role: 'owner' | 'staff' | null }` on a
showroom.

```ts
PublicTenant = {
  id, slug, name, status: 'setup'|'live'|'lapsed'|'suspended', isDemo, url,       // url: the showroom's origin; a trial says 'live'
  branding: { logoUrl, primaryColor, accentColor, welcomeTitle, welcomeText, featuredLines: string[] },
  contact:  { phone, email, website, address, serviceArea, hours },
  features: { fillGaps, bathrooms, visitorRenders },
}
StaffTenant = PublicTenant & { status: ...|'trial', trialEndsAt (a running trial's end, else null), statusNote, branding: {...,logoFileId}, settings: { fillGaps, bathrooms,
  visitorRenders, dailyRenderCap }, hostnames: [{ hostname, kind: 'subdomain'|'custom', verified, primary, createdAt }],
  createdAt, updatedAt }
AdminTenant = StaffTenant & { trial: { endsAt, daysLeft, active } | null, members: Member[], standing: { licenseCurrent, monthlyPaid, live },
  license, licenses, monthly, checkouts, credits: { balanceCents }, leads: { total, new } }
Member = { userId, email, name, role: 'owner'|'staff', addedAt, lastSeenAt }
```

## 3. Data model (migrations `server/db/migrations/tenancy.mjs`)

| Step | Tables |
|---|---|
| tenancy-001 | `tenants` (id, slug, name, status, status_note, branding/contact/settings JSON, is_demo, source_user_id), `tenant_hostnames` (hostname PK, tenant, kind, verified, is_primary), `tenant_members` (tenant, user, role owner\|staff) |
| tenancy-002 | `users.tenant_id` (NULL = sales site; **email unique per site**, index `users_site_email`), `sessions.tenant_id` |
| tenancy-003 | `products.tenant_id` (+ source `'tenant'`), `projects.tenant_id`, `files.tenant_id`; every contractor company became a tenant in `setup` (owner on the team, its private catalog and those files moved in, still the contractor's on the sales site) |
| tenancy-004 | `tenant_licenses`, `tenant_subscriptions` (stripe\|demo\|comp), `tenant_checkouts`, `tenant_payments` |
| tenancy-005 | `tenant_credit_lots`, `tenant_credit_holds`, `tenant_credit_entries` |
| tenancy-006 | `showroom_leads`, `sales_leads` |
| tenancy-007 | `tenant_invites` |
| tenancy-008 | `tenants` rebuilt: `status` may be `'trial'`, and `trial_ends_at` (NULL: not a trial) |

## 4. Isolation (the most important property)

- **Accounts belong to a site.** A visitor or staff member who signs up or is invited on showroom T
  gets an account with `users.tenant_id = T`. The same address may have accounts on several
  showrooms and on the sales site: separate accounts, passwords, kitchens. A sales-site account can
  also be on a showroom's team (`tenant_members`), e.g. a converted contractor: it signs in there.
- **Sessions belong to the site they were started on** (`sessions.tenant_id`), checked on every
  request with the account still allowed there (`server/tenancy/accounts.mjs siteAllows`): a
  cookie from host A is nothing on host B, and a member removed from a team loses that showroom's
  session at once. Cookies stay host-only (no `Domain=`).
- Sign-in, sign-up, forgot and reset are per site; a reset link only works on its account's site.
- Scoped to the tenant: kitchens (`projects.tenant_id`), share links (a link opens only on the
  kitchen's site), the catalog and product reads, files (only the team uploads on a showroom; a
  showroom's file is readable there when public, by its team, or when it is a picture/model of one
  of its live products or its logo; another showroom's file never), product events, leads, team,
  credits, plan. On the sales site a tenant's products and files are invisible except to our
  admins/studio (and a contractor's own catalog to that contractor).

## 5. APIs

All request bodies are JSON with the `X-BluModel: 1` header on writes. Errors are
`{ error, ...extra }`; field errors carry `errors: [{ field, message }]`.

### Showroom (public)

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/api/config` | | see §2 |
| GET | `/api/showroom` | | `{ site, tenant: PublicTenant \| null }` |
| GET | `/api/catalog` | | `{ products, brands: [], version }`: the showroom's own products only (source `'tenant'`). BluModel Basics are the client's built-ins: show them only when `tenant.features.fillGaps`. No partner brands. |
| GET | `/api/catalog/brands?category=` | | on a showroom: `{ brands: [], lines: [{ name, categories, products }], category, checkedAt: null, retailBrands: [] }` (the wizard's brand step = the company's lines) |
| GET | `/api/catalog/retailers`, POST `/api/catalog/retail/clicks` | | **404 on showrooms** (no store links, ever) |
| POST | `/api/leads` | `{ name, email, phone?, postalCode?, budget?, timeline?, notes?, consent: true, projectId? \| shareToken?, website: '' }` | `201 { ok: true, id }`. `projectId`: the signed-in visitor's own kitchen here (a view-only link is made for the staff); `shareToken`: a live link to a kitchen on this showroom. `website` is the honeypot (any value: "accepted", nothing stored). 5 per 10 min and 30 a day per address. The company's contact email (else its owners) gets a notice without the lead's text when email is on. |
| POST | `/api/projects/:id/exports` | `{ kind }` | free for the kitchen's owner on every site |

Auth, projects, share, files, account and events work on a showroom exactly as before, scoped.

### Workspace (showroom, `auth: 'staff'`; *owner* = owner only)

| Method | Path | Body / query | Answer |
|---|---|---|---|
| GET | `/api/workspace/showroom` | | `{ tenant: StaffTenant, role }` |
| PATCH | `/api/workspace/showroom` | `{ name?, branding?, contact?, settings? }` (settings: owner) | `{ tenant }`. `branding.logoFileId`: an image uploaded on the showroom (PUT `/api/files?kind=image&visibility=public`). |
| GET | `/api/workspace/team` | | `{ members, role }` |
| POST | `/api/workspace/team` *owner* | `{ email, name?, role: 'owner'\|'staff' }` | `201 { member, invite?: { url, expiresAt, emailed } }` (a 7-day set-your-password link on the showroom; emailed when email is on, else show it once) / `200 { member, pending }` when the account existed. **`pending: true`** (no `invite`, ever): the address already had a showroom account that isn't on the team, so nothing is granted and no link comes back to the owner. A 7-day accept link (`#/signin?join=<token>`, protect-001) is **emailed to the address only**; `POST /api/auth/join { token, password }` accepts it with that account's own password and never changes it. Without an email provider this is **409 `email_required`**. There is no email verification, so an existing account proves nothing about the address, and the person inviting must never get a way into it (audit 2026-10) |
| PATCH | `/api/workspace/team/:userId` *owner* | `{ role }` | `{ member }` (never the last owner: 409 `last_owner`) |
| DELETE | `/api/workspace/team/:userId` *owner* | | `{ members }` |
| GET | `/api/workspace/products` | | `{ products }`: every product of the showroom, working copy, any status |
| POST | `/api/workspace/products` | `{ spec: ProductSpec, publish?: true }` | `201 { product }` (published unless `publish: false`). Files in the spec must be the showroom's uploads. |
| PATCH | `/api/workspace/products/:id` | `{ spec?: partial, revision, publish? }` | `{ product }` (409 on a stale revision) |
| POST | `/api/workspace/products/:id/hide` · `/show` | | `{ product }` (archived / published) |
| GET | `/api/workspace/leads` | `?status=&q=&before=<createdAt>&limit=` | `{ leads: Lead[], counts: { new, contacted, quoted, won, lost, total, unread } }` |
| GET | `/api/workspace/leads/export` | | `{ filename, contentType: 'text/csv', content }` (spreadsheet-safe cells) |
| GET | `/api/workspace/leads/:id` | | `{ lead }` (marks read) |
| PATCH | `/api/workspace/leads/:id` | `{ status?, staffNotes? }` | `{ lead }` |
| GET | `/api/workspace/plan` | | `{ license, licenses, monthly, receipts, standing: { licenseCurrent, monthlyPaid, status }, prices: { license: { quoted: true } (no list price), monthly: { cents, hostingCents, creditCents }, currency }, graceDays }` |
| POST | `/api/workspace/plan/portal` *owner* | | `{ url }` (Stripe's billing portal; 409 `no_customer` without a card) |
| GET | `/api/workspace/credits` | `?before=<entry id>` | `{ balanceCents, lots: [{ id, source, cents, remaining, expiresAt, createdAt }], nextExpiry: { at, cents } \| null, heldCents, renderCostCents, rolloverMonths, history: CreditEntry[] }` |

```ts
Lead = { id, status: 'new'|'contacted'|'quoted'|'won'|'lost', name, email, phone, postalCode, budget, timeline,
  notes, consent, consentText, staffNotes, design: { name, shareToken, url } | null, signedIn, read, createdAt, updatedAt }
CreditEntry = { id, kind: 'grant'|'expire'|'reserve'|'charge'|'release'|'refund'|'adjust', cents /* signed */,
  balanceAfter, holdId, ref, note, by /* admin email */, at }
```

The staff open a lead's design at `lead.design.url` (`#/s/<token>` on the showroom).

### Sales site (public)

| Method | Path | Body | Answer |
|---|---|---|---|
| POST | `/api/sales-leads` | `{ company, name, phone?, email, city?, message?, website: '' }` | `201 { ok: true }` ("Book a call"; honeypot `website`; 5 per 10 min, 20 a day per address; emailed to SUPPORT_EMAIL when email is on) |
| GET | `/api/showroom-checkouts/:ref` | | `{ checkout: { ref, status, amountCents, currency, provider, demo }, showroom: { name, slug } }`: the page a company lands on from the monthly-plan link (`#/pay/showroom/<ref>`) |
| POST | `/api/showroom-checkouts/:ref/demo` | `{ outcome: 'success'\|'cancel' }` | demo payments only: `{ checkout }` |
| POST | `/api/showroom-checkouts/:ref/sync` | `{ sessionId }` | back from Stripe (`/?session_id=cs_...#/pay/showroom/<ref>`): fulfils without waiting for the webhook when Stripe says that session paid that link. `{ checkout, showroom: { name, slug, live } }` |

### Admin (sales site, `auth: 'admin'`, every change audited in `admin_audit`)

| Method | Path | Body | Answer |
|---|---|---|---|
| GET | `/api/admin/tenants` | | `{ tenants: AdminTenant[] }` |
| POST | `/api/admin/tenants` | `{ name, slug?, ownerEmail?, ownerName?, branding?, contact?, settings? }` | `201 { tenant, invite?: { url, expiresAt } }` (slug made from the name when absent; 400 reserved/bad, 409 `slug_taken`; the owner's account is made on the showroom with a 7-day sign-in link) |
| GET / PATCH | `/api/admin/tenants/:id` | `{ name?, branding?, contact?, settings? }` | `{ tenant }` |
| POST | `/api/admin/tenants/:id/status` | `{ status: 'setup'\|'live'\|'suspended', note? }` | `{ tenant }` (`live` = launch/restore: comes out `lapsed` when unpaid) |
| POST | `/api/admin/tenants/:id/hostnames` | `{ hostname, kind?: 'custom'\|'subdomain', verified?, primary? }` | `201 { hostname, tenant }` (409 `hostname_taken`) |
| PATCH / DELETE | `/api/admin/tenants/:id/hostnames/:hostname` | `{ verified?, primary? }` | `{ tenant }` (the own subdomain can't be removed) |
| POST | `/api/admin/tenants/:id/members` | `{ email, name?, role }` | `201 { member, invite? }` / `200 { member, pending }` (pending as for the workspace route: emailed, no link back) |
| DELETE | `/api/admin/tenants/:id/members/:userId` | | `{ members }` |
| POST | `/api/admin/tenants/:id/licenses` | `{ amountCents (required: the amount agreed, whole cents; there is no default or list price), currency? ('cad'), startsOn? (today), endsOn? (a year, the day before), paidHow: invoice\|etransfer\|cheque\|card\|cash\|comp\|other, note? }` | `201 { license, tenant }` (400 `amountCents` when it's missing or not a whole number of cents; a complimentary license is `amountCents: 0, paidHow: 'comp'`) |
| DELETE | `/api/admin/tenants/:id/licenses/:licenseId` | | `{ license, tenant }` (voided, kept) |
| POST | `/api/admin/tenants/:id/monthly/checkout` | | `201 { checkout: { ref, url, status, ... }, tenant }`: the Stripe Checkout link to send (demo: `${PUBLIC_URL}/#/pay/showroom/<ref>`); 409 `already_paid` |
| POST | `/api/admin/tenants/:id/monthly/comp` | `{ on: boolean, note? }` | `{ tenant }` (complimentary monthly plan) |
| POST | `/api/admin/tenants/:id/monthly/cancel` | | `{ tenant }` (Stripe: at the period end) |
| POST | `/api/admin/tenants/:id/monthly/demo` | `{ event: renewal\|renewal_failed\|grace_end\|cancel }` | demo payments only |
| GET / POST | `/api/admin/tenants/:id/credits` | POST `{ cents: ±int, note }` | `{ balanceCents, lots, nextExpiry, heldCents, history }` |
| GET | `/api/admin/quick-setup/slug` | `?slug=&name=` | `{ slug, available, problem: 'invalid'\|'reserved'\|'taken'\|null, suggestion }` |
| POST | `/api/admin/quick-setup` | `{ name, slug?, logo?: base64 or data URL (PNG/JPEG/WebP, 2 MB), branding?: { primaryColor?, accentColor? }, contact?: { website?, serviceArea?, phone?, email? }, catalog: 'demo'\|'empty', purpose: 'trial'\|'customer' }` | `201 { tenant, products, trialEndsAt }`. One transaction (server/tenancy/quickSetup.mjs): the tenant and subdomain, branding (welcome, featured lines), contact, `fillGaps` on, and with `demo` the demo's products copied as the tenant's own products and files, renamed `<stem> Shaker` etc. (`lineStem`: the name without legal and trade words). `trial`: status `trial` for TRIAL_DAYS (14), TRIAL_CREDIT_CENTS (0) once; `customer`: `setup`. Audited `tenant_quick_setup` |
| POST | `/api/admin/tenants/:id/trial/extend` | `{ days?: 1..30 (7) }` | `{ tenant }`: from the end (or now once ended), live again, at most 90 days ahead (409 `not_trial`) |
| POST | `/api/admin/tenants/:id/trial/end` | | `{ tenant }`: lapses now (409 `not_trial` unless running) |
| POST | `/api/admin/tenants/:id/trial/convert` | | `{ tenant }`: live, trial cleared, everything kept; 409 `not_paid_up` with `missing: ['license'\|'monthly']` |
| POST | `/api/admin/tenants/:id/showroom-images` | `?auto=1` | `{ url, expiresAt, run }`: the generator link (auto: starts at once) |
| GET | `/api/admin/tenants/:id/showroom-images/:run` | | `{ state: 'waiting'\|'running'\|'done', uploads, made, failed, finishedAt, expiresAt }` (the generator posts `/api/showroom-images/done` with its ticket when it finishes) |
| GET | `/api/admin/sales-leads` | `?status=` | `{ leads: [{ id, company, name, phone, email, city, message, status: new\|contacted\|demo\|won\|lost, adminNotes, emailed, createdAt }], counts }` |
| PATCH | `/api/admin/sales-leads/:id` | `{ status?, adminNotes? }` | `{ lead }` |

## 6. Money

Prices: `src/data/plans.json` (`showroom_license` has **no price**: `priceCents: null, quoted: true`,
since 2026-10-17 the setup and yearly license are quoted per company and an admin records the amount
agreed for each deal; `showroom_monthly`
5000/month = 2500 hosting incl. the web address + 2500 render credits, 3-month rollover; the four
homeowner/contractor plans are `forSale: false`). Server constants: `server/lib/plans.mjs`
`SHOWROOM_LICENSE`, `SHOWROOM_MONTHLY`, `LEGACY_PLAN_IDS`.

- **Legacy billing**: `POST /api/billing/checkout` and `/api/billing/change` answer **410
  `not_for_sale`** before Stripe is called. Receipts, cancel/resume, the portal, renewals, refunds
  and webhooks keep working for what was already paid. **Exports are free**: the export route only
  checks ownership; `GET /api/billing/entitlements` lists every own kitchen and `exportsFree: true`.
- **Live** = a current license (start ≤ today ≤ end, UTC days, not voided) AND a paid monthly plan
  (active; or within 14 days of a failed renewal or a missed period end; or complimentary). The
  status is recomputed on every change, on each request to the showroom and every 10 minutes.
- **Trial** (`server/tenancy/service.mjs computeStatus`): `trial` while now < `trial_ends_at`, whatever
  the standing; after that it is computed like a launched showroom: live when the license and monthly
  plan are in place (then `trial_ends_at` is cleared), else lapsed. A trial never charges anything
  and grants only TRIAL_CREDIT_CENTS (default 0) once. Converting needs the same two things.
- Monthly through Stripe: the admin's Checkout is `mode: subscription`, CAD 5000/month, metadata
  `{ kind: 'showroom_monthly', checkout_ref, tenant_id }` on the session and the subscription. The
  webhook handles `checkout.session.completed` (by `metadata.kind`), `customer.subscription.*`,
  `invoice.paid` (a receipt and the month's credits, once per invoice) and
  `invoice.payment_failed` (past due, 14-day grace). No new webhook event types are needed.

### Credits (`services.credits`, `server/billing/credits.mjs`), for the renders package

```js
const hold = credits.reserve(tenantId, config.RENDER_CREDIT_CENTS, { purpose: 'render', ref, by: userId }); // 402 insufficient_credits
try { /* call the AI */ credits.charge(hold.id); } catch (e) { credits.release(hold.id); throw e; }
credits.refund(holdId, { note, by })     // a charged render given back
credits.balance(tenantId) · credits.summary(tenantId) · credits.history(tenantId, { limit, before })
```

Lots are spent oldest expiry first; an expired lot's remainder gets an `expire` entry. Each step is
synchronous: wrap reserve in `ctx.tx` with any row of your own. `settings.visitorRenders` and
`settings.dailyRenderCap` are stored for you to enforce.

## 7. The demo showroom

`server/tenancy/demo.mjs` seeds `demo` = "Northline Kitchen & Bath (Demo)" (id `t_demo`): live on a
complimentary license and monthly plan, 2500 cents of credits, branding (navy `#2e3d55`, sage
`#9aa892`, logo, welcome, featured lines), fictional contact (555 numbers), `fillGaps` and
`bathrooms` on, and 19 products (Lakeshore Shaker and Harbourfront Slab cabinet lines with
finishes, two sinks, a range, a hood, a fridge, a dishwasher, two pendants, two stools; generated
thumbnails, parametric 3D, no store links). Dev and QA seeds (`server/seed/tenants.mjs`) add
`demo-owner@`, `demo-staff@`, `demo-visitor@blumodel.test` on the showroom (password
SEED_PASSWORD), two designs and three leads. Production: `node server/scripts/seed-demo-tenant.mjs`
(no accounts; add yourself in Admin > Tenants).

**Not covered**: faucets are surface fixtures (`surfaces.faucetId`, from the retail fixtures), not
catalog products, so the demo catalog has none; deciding how a showroom offers faucets is open.

## 8. Tests and QA

- Server tests: `t.tenant({ name, slug, status = 'live' })` makes a tenant (live = a license and a
  complimentary monthly plan); `await t.showroomUser(tn, { role: 'owner'|'staff'|null })` signs a user
  up on it and returns an Agent bound to its host; `t.agent({ host: t.hostFor('acme') })` is an
  anonymous client there. Agents with a `host` send that Host header over node:http.
  `legacyCheckout(agent, body)` (helpers) makes a pre-pivot pending checkout for legacy tests.
- `server/test/quick-setup.test.mjs`: the creation transaction (nothing made on a bad field), the
  address check, a trial lapsing and extended / ended, conversion, each showroom's own copy of the
  catalog and files, and the picture run.
- QA `admin`: `admin-quick-setup*` (the whole flow at 1440 and 390, light and dark, ending on the new
  showroom at `<slug>.localhost`), `admin-quick-setup-customer`, `admin-trial-actions`.
- QA (`scripts/qa.mjs`): a route may say `host: 'demo'` to open on `http://demo.localhost:<port>`;
  `as` is then `'anon'` or `'showroom-owner' | 'showroom-staff' | 'showroom-visitor'` (the seeded
  demo people; the session is made in the database, bound to the showroom). `allowStatus: [404]`
  lets the page itself answer an error status. `api.legacyCheckout(userId, body)` makes a legacy
  checkout. To test another tenant in QA, make it in `setup` through `api.as('admin')` and
  `/api/admin/tenants` (see `scripts/qa/routes/tenancy.mjs`). Package `tenancy`: `node
  scripts/qa.mjs --pkg tenancy --port <p>`.

## 9. Known gaps for the build packages

- The client doesn't read `site`/`tenant` yet: on a showroom it still shows the homeowner app
  (with the showroom's catalog), and calls to sales-only APIs there answer 404.
- The Stripe return page `#/pay/showroom/<ref>` (with `?session_id=`) is the sales site's to build;
  it must call `/api/showroom-checkouts/:ref/sync`, not `/api/billing/sync`.
- Other QA packages still start legacy checkouts with `POST /api/billing/checkout` (account,
  dark, finder, launch); they need `api.legacyCheckout` like core.
- `orders` (model requests, the studio queue) is sales-only; scoping it to tenants is the
  workspace package's (the queue should group by `tenant_id`).
- Deleting an account on a showroom deletes that showroom account. A sales-site account on a team
  can't be deleted from a showroom (409 `sales_account`, since pivot-fix); it is deleted on the sales site.
- Hosting: the wildcard DNS record and tunnel ingress for `*.blumodel.studio` are Gabe's, per
  SHOWROOM_PIVOT §4; nothing here changes `cloudflared.yml`.
