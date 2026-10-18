// Admin > Companies > Quick setup (server/tenancy/quickSetup.mjs, server/routes/quickSetup.mjs) and
// the prospect trial: one transaction makes the showroom, its branding and its own copy of the
// starter catalog; a trial is live at once and lapses by itself without deleting anything; it
// converts to a paying customer only once a license and the monthly plan are in place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleDoc, startTestServer } from './helpers.mjs';
import { makePng } from '../lib/synth.mjs';
import { DEMO_PRODUCTS } from '../tenancy/demo.mjs';
import { lineStem, starterCatalog } from '../tenancy/quickSetup.mjs';

const DAY = 86_400_000;
const logo = () => makePng({ w: 64, h: 64, rgba: (x, y) => (x + y < 64 ? [31, 79, 138, 255] : [232, 168, 56, 255]) }).toString('base64');
const DEMO_WORDS = /northline|demo|lakeshore|harbour|bayview|\bbay\b|\bNL-/i;

async function admin(t) {
  return t.user({ role: 'admin' });
}

const setup = (a, body) => a.post('/api/admin/quick-setup', { catalog: 'demo', purpose: 'trial', ...body });

test('quick setup: line names from the company name, and a starter catalog that never says Northline', () => {
  assert.equal(lineStem('Acme Kitchens & Bath Ltd.'), 'Acme');
  assert.equal(lineStem('Maple Lane Kitchens'), 'Maple Lane');
  assert.equal(lineStem('Birch Cabinetry Inc'), 'Birch');
  assert.equal(lineStem('Kitchens'), 'Kitchens', 'nothing left: the name itself');
  assert.equal(lineStem('Studio North (QA)'), 'Studio North');
  const cat = starterCatalog('Acme Kitchens', 'acme');
  assert.equal(cat.length, DEMO_PRODUCTS.length);
  for (const { spec } of cat) {
    assert.doesNotMatch(JSON.stringify({ name: spec.name, line: spec.line, sku: spec.sku, blurb: spec.blurb, finishes: spec.finishes.map((f) => f.name) }), DEMO_WORDS, spec.name);
    assert.match(spec.line, /^Acme (Shaker|Slab|Sinks|Appliances|Lighting|Seating|Bath)$/);
    assert.match(spec.sku, /^ACM-/);
  }
  assert.ok(cat.some((c) => c.spec.name === 'Shaker Base Cabinet'));
  assert.ok(cat.some((c) => c.spec.finishes.some((f) => f.name === 'Sage Green')));
});

test('quick setup: one transaction makes a live trial with its own branding, contact and catalog', async () => {
  const t = await startTestServer();
  try {
    const a = await admin(t);
    const r = await setup(a, {
      name: 'Acme Kitchens & Bath',
      slug: 'acme',
      logo: logo(),
      branding: { primaryColor: '#1F4F8A', accentColor: '#e8a838' },
      contact: { website: 'acmekitchens.ca', serviceArea: 'Guelph and area', phone: '(519) 555-0101', email: 'Hello@AcmeKitchens.ca' },
    });
    assert.equal(r.status, 201, r.text);
    const tn = r.body.tenant;
    assert.equal(tn.status, 'trial');
    assert.equal(tn.trial.active, true);
    assert.equal(tn.trial.daysLeft, 14);
    assert.equal(r.body.products, DEMO_PRODUCTS.length);
    assert.equal(tn.url, `http://acme.localhost:${t.port}`);
    assert.deepEqual(tn.hostnames.map((h) => h.hostname), ['acme.localhost']);
    assert.equal(tn.branding.primaryColor, '#1f4f8a');
    assert.ok(tn.branding.logoFileId);
    assert.deepEqual(tn.contact, { website: 'https://acmekitchens.ca/', serviceArea: 'Guelph and area', phone: '(519) 555-0101', email: 'hello@acmekitchens.ca', address: '', hours: '' });
    assert.deepEqual(tn.branding.featuredLines, ['Acme Shaker', 'Acme Slab', 'Acme Sinks', 'Acme Appliances', 'Acme Lighting', 'Acme Bath']);
    assert.equal(tn.settings.fillGaps, true);
    assert.equal(tn.monthly ?? null, null, 'a trial starts no plan and charges nothing');
    assert.equal(tn.credits.balanceCents, 0, 'no trial credits by default');

    // Visitors: live (not told it is a trial), the company's own products, the logo.
    const visitor = t.agent({ host: t.hostFor('acme') });
    const cfg = (await visitor.get('/api/config')).body;
    assert.equal(cfg.site, 'showroom');
    assert.equal(cfg.tenant.status, 'live');
    assert.equal(cfg.tenant.name, 'Acme Kitchens & Bath');
    assert.equal((await visitor.get(cfg.tenant.branding.logoUrl)).status, 200);
    const cat = (await visitor.get('/api/catalog')).body;
    assert.equal(cat.products.length, DEMO_PRODUCTS.length);
    for (const p of cat.products) {
      assert.doesNotMatch(`${p.name} ${p.brand} ${p.line ?? ''} ${p.sku ?? ''}`, DEMO_WORDS, p.name);
      assert.equal(p.buyUrl ?? null, null);
    }
    const brands = (await visitor.get('/api/catalog/brands?category=cabinets')).body;
    assert.deepEqual(brands.lines.map((l) => l.name).sort(), ['Acme Bath', 'Acme Shaker', 'Acme Slab']);
    // A trial is open: visitors can sign up there (a setup showroom refuses).
    assert.equal((await visitor.post('/api/auth/signup', { name: 'Pat', email: 'pat@example.test', password: 'correct horse 1' })).status, 201);

    const audit = t.db.prepare("SELECT detail FROM admin_audit WHERE action = 'tenant_quick_setup'").all();
    assert.equal(audit.length, 1);
    assert.equal(JSON.parse(audit[0].detail).products, DEMO_PRODUCTS.length);
    assert.equal(JSON.parse(audit[0].detail).purpose, 'trial');

    // A bad field: nothing at all is made (no tenant, no product, no address).
    const before = t.db.prepare('SELECT (SELECT COUNT(*) FROM tenants) AS t, (SELECT COUNT(*) FROM products) AS p, (SELECT COUNT(*) FROM tenant_hostnames) AS h').get();
    let bad = await setup(a, { name: 'Birch Bath', slug: 'birch', branding: { primaryColor: 'blue' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.errors[0].field, 'branding.primaryColor');
    bad = await setup(a, { name: 'Birch Bath', slug: 'acme' });
    assert.equal(bad.status, 409);
    assert.equal(bad.body.code, 'slug_taken');
    bad = await setup(a, { name: 'Birch Bath', slug: 'birch', logo: Buffer.from('<svg/>').toString('base64') });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.errors[0].field, 'logo');
    bad = await setup(a, { name: 'Birch Bath', catalog: 'everything' });
    assert.equal(bad.status, 400);
    const after = t.db.prepare('SELECT (SELECT COUNT(*) FROM tenants) AS t, (SELECT COUNT(*) FROM products) AS p, (SELECT COUNT(*) FROM tenant_hostnames) AS h').get();
    assert.deepEqual(after, before);

    // A paying customer with an empty catalog: setup, nothing copied, Basics fill the gaps.
    const c = await setup(a, { name: 'Cedar Renovations', catalog: 'empty', purpose: 'customer' });
    assert.equal(c.status, 201, c.text);
    assert.equal(c.body.tenant.status, 'setup');
    assert.equal(c.body.tenant.trial, null);
    assert.equal(c.body.products, 0);
    assert.equal(c.body.tenant.slug, 'cedar-renovations');
    assert.equal(c.body.tenant.settings.fillGaps, true);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM products WHERE tenant_id = ?').get(c.body.tenant.id).n, 0);

    // Admins only, on the sales site only.
    const customer = await t.user();
    assert.equal((await setup(customer, { name: 'Nope' })).status, 403);
    assert.equal((await visitor.post('/api/admin/quick-setup', { name: 'Nope' })).status, 404);
    assert.equal((await a.post('/api/admin/quick-setup', { name: 'Nope' }, { csrf: false })).status, 403, 'the CSRF header is required');
  } finally {
    await t.close();
  }
});

test('quick setup: the web address check (rules, reserved names, taken, a suggestion)', async () => {
  const t = await startTestServer();
  try {
    const a = await admin(t);
    t.tenant({ name: 'Acme', slug: 'acme' });
    const q = async (o) => (await a.get(`/api/admin/quick-setup/slug?${new URLSearchParams(o)}`)).body;
    assert.deepEqual(await q({ slug: 'acme' }), { slug: 'acme', available: false, problem: 'taken', suggestion: 'acme-2' });
    assert.equal((await q({ slug: 'admin' })).problem, 'reserved');
    assert.equal((await q({ slug: 'tunnel' })).problem, 'reserved');
    assert.equal((await q({ slug: 'Bad_Slug' })).problem, 'invalid');
    assert.equal((await q({ slug: '-acme' })).problem, 'invalid');
    assert.deepEqual(await q({ slug: 'birch-bath' }), { slug: 'birch-bath', available: true, problem: null, suggestion: 'birch-bath' });
    assert.deepEqual(await q({ name: 'Acme' }), { slug: 'acme-2', available: true, problem: null, suggestion: 'acme-2' }, 'from the name');
    assert.equal((await q({ name: 'Support' })).suggestion, 'support-showroom', 'a reserved name gets a suffix');
    const customer = await t.user();
    assert.equal((await customer.get('/api/admin/quick-setup/slug?slug=x')).status, 403);
  } finally {
    await t.close();
  }
});

test('trial: lapses by itself after TRIAL_DAYS with nothing deleted; extend, end, and its credits', async () => {
  const t = await startTestServer({ env: { TRIAL_DAYS: '10', TRIAL_CREDIT_CENTS: '500' } });
  try {
    const a = await admin(t);
    const start = Date.now();
    t.setNow(start);
    const r = await setup(a, { name: 'Dune Kitchens', slug: 'dune' });
    assert.equal(r.status, 201, r.text);
    const id = r.body.tenant.id;
    assert.equal(r.body.tenant.trial.daysLeft, 10);
    assert.equal(r.body.tenant.credits.balanceCents, 500, 'TRIAL_CREDIT_CENTS once');
    const visitor = t.agent({ host: t.hostFor('dune') });
    assert.equal((await visitor.get('/api/catalog')).status, 200);

    // Day 9: still live, a day left.
    t.setNow(start + 9 * DAY);
    assert.equal((await a.get(`/api/admin/tenants/${id}`)).body.tenant.trial.daysLeft, 1);
    assert.equal((await visitor.get('/api/catalog')).status, 200);

    // Day 10 and a minute: the showroom answers "temporarily unavailable"; everything is kept.
    t.setNow(start + 10 * DAY + 60_000);
    const gone = await visitor.get('/api/catalog');
    assert.equal(gone.status, 503);
    assert.equal(gone.body.code, 'showroom_unavailable');
    const page = await visitor.get('/');
    assert.equal(page.status, 503);
    assert.match(page.text, /temporarily unavailable/i);
    let tn = (await a.get(`/api/admin/tenants/${id}`)).body.tenant;
    assert.equal(tn.status, 'lapsed');
    assert.deepEqual(tn.trial, { endsAt: start + 10 * DAY, daysLeft: 0, active: false });
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM products WHERE tenant_id = ?').get(id).n, DEMO_PRODUCTS.length, 'nothing deleted');
    // The maintenance sweep lapses it too (no request needed).
    t.setNow(start);
    t.db.prepare("UPDATE tenants SET status = 'trial' WHERE id = ?").run(id);
    t.setNow(start + 11 * DAY);
    assert.ok(t.services.tenants.refreshAll() >= 1);
    assert.equal(t.services.tenants.get(id).status, 'lapsed');

    // Extend 7 days: live again, from now.
    let x = await a.post(`/api/admin/tenants/${id}/trial/extend`, { days: 7 });
    assert.equal(x.status, 200, x.text);
    assert.equal(x.body.tenant.status, 'trial');
    assert.equal(x.body.tenant.trial.endsAt, start + 18 * DAY);
    assert.equal((await visitor.get('/api/catalog')).status, 200);
    x = await a.post(`/api/admin/tenants/${id}/trial/extend`, { days: 7 });
    assert.equal(x.body.tenant.trial.endsAt, start + 25 * DAY, 'from the end while it runs');
    assert.equal((await a.post(`/api/admin/tenants/${id}/trial/extend`, { days: 90 })).status, 400);

    // End it now.
    x = await a.post(`/api/admin/tenants/${id}/trial/end`);
    assert.equal(x.status, 200, x.text);
    assert.equal(x.body.tenant.status, 'lapsed');
    assert.equal((await visitor.get('/api/catalog')).status, 503);
    assert.equal((await a.post(`/api/admin/tenants/${id}/trial/end`)).status, 409, 'not running any more');

    const actions = t.db.prepare("SELECT action FROM admin_audit WHERE action LIKE 'tenant_trial_%' ORDER BY id").all().map((r) => r.action);
    assert.deepEqual(actions, ['tenant_trial_extend', 'tenant_trial_extend', 'tenant_trial_end']);
    // A plain company can't be extended.
    const plain = t.tenant({ name: 'Plain', slug: 'plain' });
    assert.equal((await a.post(`/api/admin/tenants/${plain.id}/trial/extend`, { days: 7 })).body.code, 'not_trial');
  } finally {
    t.setNow(null);
    await t.close();
  }
});

test('trial: converts to a paying customer only with a license and a paid monthly plan, keeping everything', async () => {
  const t = await startTestServer();
  try {
    const a = await admin(t);
    const r = await setup(a, { name: 'Elm Kitchens', slug: 'elm' });
    const id = r.body.tenant.id;
    const owner = await t.showroomUser({ id, host: t.hostFor('elm') }, { role: 'owner' });
    const design = await owner.post('/api/projects', { name: 'Trial kitchen', doc: sampleDoc() });
    assert.ok([200, 201].includes(design.status), design.text);

    let c = await a.post(`/api/admin/tenants/${id}/trial/convert`);
    assert.equal(c.status, 409);
    assert.equal(c.body.code, 'not_paid_up');
    assert.deepEqual(c.body.missing, ['license', 'monthly']);
    assert.equal((await a.post(`/api/admin/tenants/${id}/licenses`, { amountCents: 150000, paidHow: 'invoice' })).status, 201);
    c = await a.post(`/api/admin/tenants/${id}/trial/convert`);
    assert.deepEqual(c.body.missing, ['monthly']);
    assert.equal((await a.get(`/api/admin/tenants/${id}`)).body.tenant.status, 'trial', 'paying during the trial keeps the trial until converted');
    assert.equal((await a.post(`/api/admin/tenants/${id}/monthly/comp`, { on: true, note: 'Pilot' })).status, 200);
    c = await a.post(`/api/admin/tenants/${id}/trial/convert`);
    assert.equal(c.status, 200, c.text);
    assert.equal(c.body.tenant.status, 'live');
    assert.equal(c.body.tenant.trial, null);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM products WHERE tenant_id = ?').get(id).n, DEMO_PRODUCTS.length, 'the catalog is kept');
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM projects WHERE tenant_id = ?').get(id).n, 1, 'the designs are kept');
    assert.equal(t.db.prepare('SELECT trial_ends_at FROM tenants WHERE id = ?').get(id).trial_ends_at, null);
    assert.equal((await a.post(`/api/admin/tenants/${id}/trial/convert`)).body.code, 'not_trial');
    assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'tenant_trial_convert'").get().n, 1);

    // A trial whose license and plan are in place when it ends just goes live.
    const r2 = await setup(a, { name: 'Fir Kitchens', slug: 'fir', catalog: 'empty' });
    const id2 = r2.body.tenant.id;
    await a.post(`/api/admin/tenants/${id2}/licenses`, { amountCents: 0, paidHow: 'comp' });
    await a.post(`/api/admin/tenants/${id2}/monthly/comp`, { on: true, note: 'Pilot' });
    t.setNow(Date.now() + 15 * DAY);
    const tn = (await a.get(`/api/admin/tenants/${id2}`)).body.tenant;
    assert.equal(tn.status, 'live');
    assert.equal(tn.trial, null);
  } finally {
    t.setNow(null);
    await t.close();
  }
});

test('quick setup: each showroom gets its own copy of the catalog and files; nothing crosses', async () => {
  const t = await startTestServer();
  try {
    const a = await admin(t);
    const g = (await setup(a, { name: 'Grove Kitchens', slug: 'grove', logo: logo() })).body.tenant;
    const h = (await setup(a, { name: 'Hazel Kitchens', slug: 'hazel' })).body.tenant;
    const grove = t.agent({ host: t.hostFor('grove') });
    const hazel = t.agent({ host: t.hostFor('hazel') });
    const gp = (await grove.get('/api/catalog')).body.products;
    const hp = (await hazel.get('/api/catalog')).body.products;
    assert.equal(gp.length, DEMO_PRODUCTS.length);
    assert.ok(gp.every((p) => /^Grove /.test(p.line ?? p.brand)), 'Grove’s lines');
    assert.ok(hp.every((p) => !/Grove/.test(JSON.stringify(p))), 'nothing of Grove’s on Hazel');
    const gIds = new Set(gp.map((p) => p.id));
    assert.ok(hp.every((p) => !gIds.has(p.id)), 'separate products');
    // Each product row and its picture belong to that showroom.
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM products WHERE tenant_id = ?').get(g.id).n, DEMO_PRODUCTS.length);
    assert.ok(gp.every((p) => p.thumbnailUrl), 'each product has its picture');
    // Every picture is a file of that showroom's own (the same drawing on Hazel is Hazel's own file).
    const owners = t.db
      .prepare("SELECT DISTINCT f.tenant_id AS tenant FROM products p, json_each(json_extract(p.live_spec, '$.imageFileIds')) j JOIN files f ON f.id = j.value WHERE p.tenant_id = ?")
      .all(g.id)
      .map((r) => r.tenant);
    assert.deepEqual(owners, [g.id]);
    const gLogo = (await grove.get('/api/config')).body.tenant.branding.logoUrl;
    assert.equal((await grove.get(gLogo)).status, 200);
    assert.equal((await hazel.get(gLogo)).status, 404, 'Grove’s logo never opens on Hazel');
    // Hazel's team can't change Grove's products.
    const hStaff = await t.showroomUser({ id: h.id, host: t.hostFor('hazel') }, { role: 'owner' });
    assert.equal((await hStaff.post(`/api/workspace/products/${gp[0].id}/hide`)).status, 404);
    const gStaff = await t.showroomUser({ id: g.id, host: t.hostFor('grove') }, { role: 'owner' });
    assert.equal((await gStaff.post(`/api/workspace/products/${gp[0].id}/hide`)).status, 200, 'its own team can');
    assert.equal((await hazel.get('/api/catalog')).body.products.length, DEMO_PRODUCTS.length, 'Hazel untouched');
  } finally {
    await t.close();
  }
});

test('quick setup: the picture generator run an admin can follow (auto start, uploads, done)', async () => {
  const t = await startTestServer();
  try {
    const a = await admin(t);
    const tn = (await setup(a, { name: 'Ivy Kitchens', slug: 'ivy' })).body.tenant;
    const tk = await a.post(`/api/admin/tenants/${tn.id}/showroom-images?auto=1`);
    assert.equal(tk.status, 200, tk.text);
    assert.match(tk.body.url, /#\/showroom-images\?ticket=[^&]+&auto=1$/);
    assert.match(tk.body.run, /^ir_/);
    const ticket = new URLSearchParams(tk.body.url.split('?')[1]).get('ticket');
    const status = async () => (await a.get(`/api/admin/tenants/${tn.id}/showroom-images/${tk.body.run}`)).body;
    assert.equal((await status()).state, 'waiting');
    const gen = t.agent({ host: t.hostFor('ivy') });
    const hdr = { headers: { 'X-Showroom-Ticket': ticket } };
    assert.equal((await gen.request('GET', '/api/showroom-images/access', hdr)).status, 200);
    assert.equal((await status()).state, 'running');
    const up = await gen.putRaw('/api/showroom-images?slot=hero&source=render', makePng({ w: 800, h: 450, rgba: () => [120, 130, 140, 255] }), 'image/png', hdr);
    assert.equal(up.status, 200, up.text);
    assert.equal((await status()).uploads, 1);
    assert.equal((await gen.request('POST', '/api/showroom-images/done', { ...hdr, body: { made: 1, failed: 0 } })).status, 200);
    const s = await status();
    assert.equal(s.state, 'done');
    assert.equal(s.made, 1);
    assert.ok(s.finishedAt);
    // Another showroom's run, or a made-up one, is a 404; no ticket, no "done".
    const other = (await setup(a, { name: 'Juniper Kitchens', slug: 'juniper', catalog: 'empty' })).body.tenant;
    assert.equal((await a.get(`/api/admin/tenants/${other.id}/showroom-images/${tk.body.run}`)).status, 404);
    assert.equal((await a.get(`/api/admin/tenants/${tn.id}/showroom-images/ir_madeupmadeupmadeup`)).status, 404);
    assert.equal((await t.agent({ host: t.hostFor('ivy') }).post('/api/showroom-images/done', { made: 1 })).status, 403);
    const plain = await a.post(`/api/admin/tenants/${tn.id}/showroom-images`);
    assert.doesNotMatch(plain.body.url, /auto=1/);
  } finally {
    await t.close();
  }
});
