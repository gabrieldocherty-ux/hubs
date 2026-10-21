// Tenancy QA routes (docs/handoff/tenancy.md): the request's host picks the site. The sales site at
// 127.0.0.1, the seeded demo showroom at demo.localhost (its catalog is Northline's own products,
// with no store links), a showroom session in the browser, and the server's own pages for an
// unknown host (404) and a suspended showroom (503), at 1440 and 390, light and dark.
// Run: node scripts/qa.mjs --pkg tenancy --port 8900
//
// The client doesn't know about showrooms yet (other packages build the sales site and the
// showroom screens), so these routes check the server's side through the page: which site
// /api/config says, what the catalog holds, that the session works on its own host only.

/** No horizontal page scroll. */
async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

/** GET from the page itself (same origin, its cookies): { status, body }. */
const pageGet = (h, p) =>
  h.evaluate(async (url) => {
    const r = await fetch(url, { credentials: 'same-origin' });
    let body = null;
    try {
      body = await r.json();
    } catch {
      body = null;
    }
    return { status: r.status, body };
  }, p);

async function siteIs(h, site, name) {
  const r = await pageGet(h, '/api/config');
  if (r.status !== 200) throw new Error(`/api/config answered ${r.status}`);
  if (r.body?.site !== site) throw new Error(`/api/config says site "${r.body?.site}", expected "${site}"`);
  if (name && r.body?.tenant?.name !== name) throw new Error(`the showroom is "${r.body?.tenant?.name}", expected "${name}"`);
  return r.body;
}

const DEMO = 'Northline Kitchen & Bath (Demo)';

/** The demo catalog, from the page: Northline's products only, none with a store link. */
async function demoCatalog(h) {
  const r = await pageGet(h, '/api/catalog');
  const products = r.body?.products ?? [];
  if (products.length < 15) throw new Error(`the demo catalog has ${products.length} products`);
  const foreign = products.filter((p) => p.brand !== DEMO);
  if (foreign.length) throw new Error(`products from elsewhere on the demo showroom: ${foreign.map((p) => p.name).join(', ')}`);
  const linked = products.filter((p) => p.buyUrl);
  if (linked.length) throw new Error(`store links on the demo showroom: ${linked.map((p) => p.name).join(', ')}`);
  if ((r.body?.brands ?? []).length) throw new Error('partner brands are listed on the demo showroom');
}

/** A suspended showroom for the 503 page, made through the admin API once per run. */
async function pausedShowroom({ api }) {
  const admin = api.as('admin');
  const made = await admin.post('/api/admin/tenants', { name: 'Paused Kitchens (QA)', slug: 'paused-qa', contact: { phone: '(519) 555-0100' } });
  if (made.status !== 201 && made.status !== 409) throw new Error(`making the QA showroom failed (${made.status}): ${made.body?.error ?? made.text}`);
  const id = made.status === 201 ? made.body.tenant.id : api.sql("SELECT id FROM tenants WHERE slug = 'paused-qa'")[0].id;
  const s = await admin.post(`/api/admin/tenants/${id}/status`, { status: 'suspended' });
  if (s.status !== 200) throw new Error(`suspending it failed (${s.status})`);
  return {};
}

const views = [
  { suffix: '', viewport: 'desktop' },
  { suffix: '-dark', viewport: 'desktop', colorScheme: 'dark' },
  { suffix: '-phone', viewport: 'phone' },
  { suffix: '-phone-dark', viewport: 'phone', colorScheme: 'dark' },
];

export default [
  // ── the sales site (127.0.0.1) ───────────────────────────────────────────
  ...views.map((v) => ({
    name: `sales-site${v.suffix}`,
    path: '#/',
    as: 'anon',
    viewport: v.viewport,
    ...(v.colorScheme ? { colorScheme: v.colorScheme } : {}),
    waitFor: ['#root *'],
    check: async (h) => {
      const cfg = await siteIs(h, 'sales');
      if (cfg.tenant !== null) throw new Error('the sales site has a tenant');
      await noSideScroll(h);
    },
  })),

  // ── the demo showroom (demo.localhost) ───────────────────────────────────
  ...views.map((v) => ({
    name: `demo-showroom${v.suffix}`,
    host: 'demo',
    path: '#/',
    as: 'anon',
    viewport: v.viewport,
    ...(v.colorScheme ? { colorScheme: v.colorScheme } : {}),
    waitFor: ['#root *'],
    check: async (h) => {
      const cfg = await siteIs(h, 'showroom', DEMO);
      if (cfg.tenant.status !== 'live') throw new Error(`the demo showroom is ${cfg.tenant.status}`);
      if (cfg.tenant.branding.primaryColor !== '#2e3d55') throw new Error('the demo branding is missing');
      await demoCatalog(h);
      await noSideScroll(h);
    },
  })),
  ...views.map((v) => ({
    name: `demo-showroom-editor${v.suffix}`,
    host: 'demo',
    // A showroom has no device-only mode (a design there must reach the company): the visitor's own kitchen.
    as: 'showroom-visitor',
    setup: async ({ api }) => ({ path: `#/k/${api.sql("SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id WHERE p.tenant_id = 't_demo' AND u.email = 'demo-visitor@blumodel.test' ORDER BY p.name LIMIT 1")[0].id}` }),
    viewport: v.viewport,
    ...(v.colorScheme ? { colorScheme: v.colorScheme } : {}),
    waitFor: ['.topbar', '.plan-view canvas, .scene-view canvas'],
    check: async (h) => {
      await demoCatalog(h);
      await noSideScroll(h);
    },
  })),
  {
    name: 'demo-owner-session',
    host: 'demo',
    path: '#/',
    as: 'showroom-owner',
    waitFor: ['#root *'],
    check: async (h) => {
      const me = await pageGet(h, '/api/auth/me');
      if (me.body?.user?.showroom?.role !== 'owner') throw new Error(`signed in as ${JSON.stringify(me.body?.user?.showroom)}, expected the owner`);
      const ws = await pageGet(h, '/api/workspace/showroom');
      if (ws.status !== 200 || ws.body?.tenant?.slug !== 'demo') throw new Error(`the workspace answered ${ws.status}`);
      const leads = await pageGet(h, '/api/workspace/leads');
      if (leads.body?.counts?.total !== 3) throw new Error(`the demo inbox has ${leads.body?.counts?.total} leads, expected 3`);
      const credits = await pageGet(h, '/api/workspace/credits');
      if (!(credits.body?.balanceCents > 0)) throw new Error('the demo showroom has no render credits');
      // Admin APIs don't exist on a showroom.
      const admin = await pageGet(h, '/api/admin/tenants');
      if (admin.status !== 404) throw new Error(`/api/admin/tenants answered ${admin.status} on the showroom`);
    },
  },
  {
    name: 'demo-visitor-session',
    host: 'demo',
    path: '#/',
    as: 'showroom-visitor',
    waitFor: ['#root *'],
    check: async (h) => {
      const me = await pageGet(h, '/api/auth/me');
      if (!me.body?.user || me.body.user.showroom?.role !== null) throw new Error(`signed in as ${JSON.stringify(me.body?.user?.showroom)}, expected a visitor`);
      const projects = await pageGet(h, '/api/projects');
      if ((projects.body?.projects ?? []).length !== 2) throw new Error(`the demo visitor has ${(projects.body?.projects ?? []).length} designs, expected 2`);
      const ws = await pageGet(h, '/api/workspace/showroom');
      if (ws.status !== 403) throw new Error(`a visitor's workspace answered ${ws.status}`);
    },
    // The visitor isn't staff: the workspace call above is meant to be refused.
    ignoreConsole: [/403/],
  },

  // ── the server's own pages ───────────────────────────────────────────────
  ...views.map((v) => ({
    name: `unknown-host${v.suffix}`,
    host: 'nobody-here',
    path: '#/',
    as: 'anon',
    viewport: v.viewport,
    ...(v.colorScheme ? { colorScheme: v.colorScheme } : {}),
    allowStatus: [404],
    expectText: ['There’s no showroom at this address'],
    check: noSideScroll,
  })),
  ...views.map((v) => ({
    name: `suspended-showroom${v.suffix}`,
    host: 'paused-qa',
    path: '#/',
    as: 'anon',
    viewport: v.viewport,
    ...(v.colorScheme ? { colorScheme: v.colorScheme } : {}),
    setup: async (ctx) => ({ ...(await pausedShowroom(ctx)), path: '#/' }),
    allowStatus: [503],
    expectText: ['temporarily unavailable', '(519) 555-0100'],
    check: noSideScroll,
  })),
];
