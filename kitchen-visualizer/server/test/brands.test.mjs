// Package B2: the brand page inside the Contractor account (BRAND_PAGE.md). Access, the
// readiness gate, the moderation round trip, lapse and renewal, leads (private to the
// contractor, spam-limited) and the promise that no cost or margin ever reaches a public wire.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { makePng } from './fixtures/images.mjs';
import { makeGlb } from './fixtures/glb.mjs';
import { seed as seedBrands } from '../seed/brands.mjs';

let t;
let admin;
before(async () => {
  t = await startTestServer({ env: { PAYMENTS: 'demo', BRAND_PRODUCT_LIMIT: '3' } });
  admin = await t.user({ role: 'admin' });
});
after(async () => {
  await t?.close();
});

const DAY = 86_400_000;
let shade = 10;

async function buy(agent, body) {
  const c = await agent.post('/api/billing/checkout', body);
  assert.equal(c.status, 200, c.text);
  assert.equal((await agent.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' })).status, 200);
}

/** A user on the Contractor plan with a company (default markup 30%). */
async function contractor(profile = {}, server = t) {
  const a = await server.user();
  await buy(a, { kind: 'subscription', plan: 'contractor' });
  const r = await a.put('/api/pro/profile', { company: 'Hollis Cabinet Co', phone: '555-0100', email: 'hello@hollis.test', website: 'hollis.test', serviceArea: 'Hamilton and Burlington', defaultMarkupPct: 30, ...profile });
  assert.equal(r.status, 200, r.text);
  return a;
}

async function image(agent) {
  shade = (shade + 37) % 250;
  const r = await agent.putRaw(`/api/files?kind=image&name=p${shade}.png`, makePng({ rgba: [shade, 120, 90, 255] }), 'image/png');
  assert.equal(r.status, 201, r.text);
  return r.body.file.id;
}

const cabinetSpec = (over = {}) => ({
  kind: 'base',
  variant: 'door-drawer',
  category: 'cabinets',
  name: 'Shaker Base',
  blurb: 'Solid maple face frame.',
  sku: 'HSB{w}',
  widthIn: 24,
  depthIn: 24,
  heightIn: 34.5,
  elevationIn: 0,
  widthOptions: [12, 18, 24, 30, 36],
  price: 0,
  finishes: [{ id: 'dove', name: 'Dove White', hex: '#efece4', material: 'paint' }],
  imageFileIds: [],
  line: 'Hollis Shaker',
  doorStyle: 'shaker',
  ...over,
});

/** A My-catalog product (with a photo unless `photo: false`) and, optionally, a cost. */
async function ownProduct(c, { photo = true, cost, ...over } = {}) {
  const spec = cabinetSpec({ ...over, imageFileIds: photo ? [await image(c)] : [] });
  const r = await c.post('/api/pro/products', { spec, ...(cost ? { cost } : {}) });
  assert.equal(r.status, 201, r.text);
  return r.body.product;
}

/** Sets the page up, submits it and has an admin approve it. */
async function livePage(c, over = {}) {
  const s = await c.put('/api/pro/brand', { tagline: 'Custom shaker cabinetry for the Hamilton area', about: 'Family shop since 1998.', ...over });
  assert.equal(s.status, 200, s.text);
  const sub = await c.post('/api/pro/brand/submit');
  assert.equal(sub.status, 200, sub.text);
  assert.equal(sub.body.brand.pageStatus, 'in_review');
  const ok = await admin.post(`/api/admin/brand-pages/${sub.body.brand.id}/approve`);
  assert.equal(ok.status, 200, ok.text);
  return ok.body.brand;
}

async function publish(c, id) {
  const r = await c.post(`/api/pro/brand/products/${id}/publish`);
  assert.equal(r.status, 200, r.text);
  return r.body;
}

/** Every key and string in a JSON value, for "costs never leave" scans. */
function walk(v, visit, path = '$') {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, visit, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (visit(k, x, `${path}.${k}`), walk(x, visit, `${path}.${k}`));
}
function assertNoCosts(value, secrets, where) {
  walk(value, (k, x, p) => {
    assert.ok(!/^(cost|costCents|costByWidth|unitCost|costTotal|margin|marginPct|markupPct|markup)$/i.test(k), `${where}: ${p} is a cost field`);
    if (typeof x === 'number') assert.ok(!secrets.includes(x), `${where}: ${p} = ${x} is a cost`);
    if (typeof x === 'string') for (const s of secrets) assert.ok(!x.includes(String(s)), `${where}: ${p} mentions ${s}`);
  });
}

const leadBody = (over = {}) => ({ name: 'Dana Homeowner', email: 'dana@example.test', phone: '555-0199', location: 'Hamilton L8P', message: 'Can you quote a 10 ft run?', consent: true, ...over });

test('every /api/pro/brand route is the Contractor plan’s: others get 403, anonymous 401', async () => {
  const free = await t.user();
  const unlimited = await t.user();
  await buy(unlimited, { kind: 'subscription', plan: 'unlimited' });
  const routes = [
    ['GET', '/api/pro/brand'],
    ['PUT', '/api/pro/brand', { tagline: 'x' }],
    ['POST', '/api/pro/brand/submit'],
    ['GET', '/api/pro/brand/preview'],
    ['GET', '/api/pro/brand/summary'],
    ['GET', '/api/pro/brand/products'],
    ['POST', '/api/pro/brand/products/p_aaaaaaaaaaaaaaaaaaaaaaaa/publish'],
    ['POST', '/api/pro/brand/products/p_aaaaaaaaaaaaaaaaaaaaaaaa/unpublish'],
    ['POST', '/api/pro/brand/lines/publish', { line: 'x' }],
    ['GET', '/api/pro/brand/leads'],
    ['PATCH', '/api/pro/brand/leads/ld_aaaaaaaaaaaaaaaaaaaaaaaa', { status: 'won' }],
    ['POST', '/api/pro/brand/leads/read', { ids: [] }],
    ['GET', '/api/pro/brand/analytics?days=30'],
  ];
  for (const who of [free, unlimited, admin]) {
    for (const [m, p, body] of routes) {
      const r = await who.request(m, p, body ? { body } : {});
      assert.equal(r.status, 403, `${m} ${p}`);
      assert.equal(r.body.needs, 'contractor', `${m} ${p}`);
    }
  }
  for (const [m, p, body] of routes) assert.equal((await t.agent().request(m, p, body ? { body } : {})).status, 401, `${m} ${p} anon`);
  // Admin-only routes refuse contractors.
  const c = await contractor();
  for (const p of ['/api/admin/moderation', '/api/admin/brands']) assert.equal((await c.get(p)).status, 403);
});

test('setup is pre-filled from Company; the address can change until the page first goes live', async () => {
  const c = await contractor({ company: 'Larkspur Joinery' });
  const s0 = await c.get('/api/pro/brand');
  assert.equal(s0.status, 200);
  assert.equal(s0.body.brand, null);
  assert.equal(s0.body.defaults.name, 'Larkspur Joinery');
  assert.equal(s0.body.defaults.slug, 'larkspur-joinery');
  assert.equal(s0.body.defaults.phone, '555-0100');

  const s1 = await c.put('/api/pro/brand', {});
  assert.equal(s1.status, 200, s1.text);
  assert.equal(s1.body.brand.name, 'Larkspur Joinery');
  assert.equal(s1.body.brand.slug, 'larkspur-joinery');
  assert.equal(s1.body.brand.pageStatus, 'draft');
  assert.equal(s1.body.brand.priceDisplay, 'from');
  assert.equal(s1.body.brand.leadForm, true);
  assert.equal(s1.body.brand.showPhone, false);
  // The contractor's company is the brand: it shows up as their membership.
  assert.ok((await c.get('/api/auth/me')).body.user.brands.some((b) => b.id === s1.body.brand.id));

  // Submit needs a tagline.
  const bad = await c.post('/api/pro/brand/submit');
  assert.equal(bad.status, 400);
  assert.ok(bad.body.checks.some((x) => x.id === 'tagline' && !x.ok));

  // Slugs are unique and well formed; another contractor can't take this one.
  const other = await contractor({ company: 'Other Co' });
  assert.equal((await other.put('/api/pro/brand', { slug: 'larkspur-joinery' })).status, 409);
  assert.equal((await c.put('/api/pro/brand', { slug: 'Bad Slug!' })).status, 400);
  assert.equal((await c.put('/api/pro/brand', { tagline: 'x'.repeat(81) })).status, 400);
  assert.equal((await c.put('/api/pro/brand', { priceDisplay: 'cheap' })).status, 400);
  const moved = await c.put('/api/pro/brand', { slug: 'larkspur', tagline: 'Hand-built kitchens' });
  assert.equal(moved.body.brand.slug, 'larkspur');

  // In review: not public yet, and the contractor can preview it.
  const sub = await c.post('/api/pro/brand/submit');
  assert.equal(sub.body.brand.pageStatus, 'in_review');
  assert.equal((await t.agent().get('/api/brands/by-slug/larkspur')).status, 404);
  const pv = await c.get('/api/pro/brand/preview');
  assert.equal(pv.status, 200);
  assert.equal(pv.body.brand.name, 'Larkspur Joinery');

  // Admin rejects with a note; the contractor fixes and resubmits; admin approves → Live + Verified.
  assert.equal((await admin.post(`/api/admin/brand-pages/${sub.body.brand.id}/reject`, {})).status, 400);
  const rej = await admin.post(`/api/admin/brand-pages/${sub.body.brand.id}/reject`, { note: 'Add your street address to About.' });
  assert.equal(rej.body.brand.pageStatus, 'rejected');
  const after = await c.get('/api/pro/brand');
  assert.equal(after.body.brand.statusNote, 'Add your street address to About.');
  await c.put('/api/pro/brand', { about: '12 King St, Hamilton.' });
  assert.equal((await c.post('/api/pro/brand/submit')).body.brand.pageStatus, 'in_review');
  const ok = await admin.post(`/api/admin/brand-pages/${sub.body.brand.id}/approve`);
  assert.equal(ok.body.brand.pageStatus, 'live');
  assert.equal(ok.body.brand.verified, true);
  const pub = await t.agent().get('/api/brands/by-slug/larkspur');
  assert.equal(pub.status, 200);
  assert.equal(pub.body.brand.verified, true);
  assert.equal(pub.body.brand.serviceArea, 'Hamilton and Burlington');
  assert.equal(pub.body.brand.phone, undefined, 'phone hidden by default');
  assert.equal(pub.body.brand.email, undefined, 'email hidden by default');

  // Once live the address is fixed.
  assert.equal((await c.put('/api/pro/brand', { slug: 'larkspur-2' })).status, 400);
  // Contact toggles show phone and email.
  await c.put('/api/pro/brand', { showPhone: true, showEmail: true });
  const pub2 = await t.agent().get('/api/brands/by-slug/larkspur');
  assert.equal(pub2.body.brand.phone, '555-0100');
  assert.equal(pub2.body.brand.email, 'hello@hollis.test');
});

test('the readiness gate: no photo or model, no finish, or no price → can’t publish', async () => {
  const c = await contractor();
  await livePage(c);
  const noPhoto = await ownProduct(c, { photo: false, name: 'Bare Base' });
  const r = await c.post(`/api/pro/brand/products/${noPhoto.id}/publish`);
  assert.equal(r.status, 400);
  const media = r.body.readiness.checks.find((x) => x.id === 'media');
  assert.equal(media.ok, false);

  // price: 0 and no cost → nothing to show, unless the page is Price on request.
  const unpriced = await ownProduct(c, { name: 'Unpriced Base' });
  const r2 = await c.post(`/api/pro/brand/products/${unpriced.id}/publish`);
  assert.equal(r2.status, 400);
  assert.equal(r2.body.readiness.checks.find((x) => x.id === 'price').ok, false);
  await c.put('/api/pro/brand', { priceDisplay: 'on_request' });
  assert.equal((await c.post(`/api/pro/brand/products/${unpriced.id}/publish`)).status, 200);

  // The list shows each product's checklist.
  const list = await c.get('/api/pro/brand/products');
  const entry = list.body.products.find((p) => p.id === noPhoto.id);
  assert.equal(entry.readiness.ready, false);
  assert.equal(list.body.products.find((p) => p.id === unpriced.id).listing.status, 'submitted');

  // Only your own My-catalog products: someone else's, a built-in or a bogus id → 404.
  const other = await contractor();
  const theirs = await ownProduct(other, { cost: { costCents: 10000 } });
  assert.equal((await c.post(`/api/pro/brand/products/${theirs.id}/publish`)).status, 404);
  assert.equal((await c.post('/api/pro/brand/products/range-30/publish')).status, 404);
});

test('moderation round trip: submitted → approved (public fields, public files) → edit stays live until re-approved', async () => {
  const c = await contractor();
  const page = await livePage(c);
  const p = await ownProduct(c, { name: 'Shaker Base', cost: { costCents: 31337 }, buyUrl: 'https://hollis.test/buy' });

  const pub = await publish(c, p.id);
  assert.equal(pub.status, 'submitted');
  const copyId = pub.product.listing.copyId;
  assert.notEqual(copyId, p.id, 'the public copy is a separate product');

  // Not public before approval.
  const anon = t.agent();
  assert.ok(!(await anon.get('/api/catalog')).body.products.some((x) => x.id === copyId));
  assert.equal((await anon.get(`/api/catalog/products/${copyId}`)).status, 404);

  // In the admin queue with the field diff (none: first version) and the brand.
  const q = await admin.get('/api/admin/moderation');
  const item = q.body.products.find((x) => x.id === copyId);
  assert.ok(item, 'queued');
  assert.equal(item.brand.id, page.id);
  assert.equal(item.live, null);

  // The image is private until approval.
  const imgId = p.imageFileIds?.[0] ?? (await c.get(`/api/catalog/products/${p.id}?working=1`)).body.product.imageFileIds[0];
  assert.equal((await anon.get(`/api/files/${imgId}/content`)).status, 404);

  // Reject needs a note; the note reaches the contractor.
  assert.equal((await admin.post(`/api/admin/products/${copyId}/reject`, {})).status, 400);
  await admin.post(`/api/admin/products/${copyId}/reject`, { note: 'The photo is blurry.' });
  const listed = (await c.get('/api/pro/brand/products')).body.products.find((x) => x.id === p.id);
  assert.equal(listed.listing.status, 'rejected');
  assert.equal(listed.listing.reviewNote, 'The photo is blurry.');

  // Resubmit, approve: live, public files, only public fields.
  assert.equal((await publish(c, p.id)).status, 'submitted');
  const ok = await admin.post(`/api/admin/products/${copyId}/approve`);
  assert.equal(ok.status, 200, ok.text);
  const cat = (await anon.get('/api/catalog')).body.products.find((x) => x.id === copyId);
  assert.ok(cat, 'in the public catalog');
  assert.equal(cat.brand, 'Hollis Cabinet Co');
  assert.equal(cat.brandSlug, page.slug);
  assert.match(cat.thumbnailUrl, /^\/files\/[0-9a-f]{64}\.png$/);
  assert.equal((await anon.get(cat.thumbnailUrl)).status, 200);
  assert.equal(cat.buyUrl, undefined, 'no buy link on a contractor’s public product');
  const copyRow = t.services.products.get(copyId);
  assert.deepEqual(Object.keys(copyRow.liveSpec).filter((k) => !['kind', 'variant', 'category', 'name', 'blurb', 'sku', 'skuByWidth', 'widthIn', 'depthIn', 'heightIn', 'elevationIn', 'widthOptions', 'price', 'priceByWidth', 'finishes', 'imageFileIds', 'modelFileId', 'specSheetUrl', 'flags', 'line', 'doorStyle'].includes(k)), []);
  // Sell price, From: the lowest width's sell price (cost 313.37 × 1.3 at 24″, scaled by list for other widths).
  assert.ok(cat.price > 0);
  assert.equal(cat.priceByWidth, undefined, 'From $X carries one price');

  // The contractor edits the product in My catalog: the live version stays until re-approved.
  const w = (await c.get(`/api/catalog/products/${p.id}?working=1`)).body.product;
  const edit = await c.patch(`/api/pro/products/${p.id}`, { spec: { name: 'Shaker Base (Maple)' }, revision: w.revision });
  assert.equal(edit.status, 200, edit.text);
  const after = (await c.get('/api/pro/brand/products')).body.products.find((x) => x.id === p.id);
  assert.equal(after.listing.status, 'submitted');
  assert.equal(after.listing.pendingEdit, true);
  assert.equal(after.listing.live, true);
  assert.equal((await anon.get(`/api/catalog/products/${copyId}`)).body.product.name, 'Shaker Base', 'old version still public');
  const q2 = (await admin.get('/api/admin/moderation')).body.products.find((x) => x.id === copyId);
  assert.deepEqual(
    q2.diff.map((d) => d.field),
    ['name'],
  );
  assert.equal(q2.live.name, 'Shaker Base');
  assert.equal(q2.working.name, 'Shaker Base (Maple)');
  await admin.post(`/api/admin/products/${copyId}/approve`);
  assert.equal((await anon.get(`/api/catalog/products/${copyId}`)).body.product.name, 'Shaker Base (Maple)');

  // A price change goes straight to the live copy (no review).
  const before = (await anon.get(`/api/catalog/products/${copyId}`)).body.product.price;
  await c.patch(`/api/pro/price-book/${p.id}`, { markupPct: 60 });
  await c.get('/api/pro/brand/products'); // any read of the tab syncs
  const afterPrice = (await anon.get(`/api/catalog/products/${copyId}`)).body.product.price;
  assert.ok(afterPrice > before, `${afterPrice} > ${before}`);
  assert.equal(t.services.products.get(copyId).status, 'published');

  // Unpublish is instant; publishing the unchanged approved version again needs no review.
  await c.post(`/api/pro/brand/products/${p.id}/unpublish`);
  assert.ok(!(await anon.get('/api/catalog')).body.products.some((x) => x.id === copyId));
  assert.equal((await publish(c, p.id)).status, 'published');
  assert.ok((await anon.get('/api/catalog')).body.products.some((x) => x.id === copyId));

  // Archiving it in My catalog takes it off the page too.
  await c.post(`/api/pro/products/${p.id}/archive`);
  await c.get('/api/pro/brand/products');
  assert.ok(!(await anon.get('/api/catalog')).body.products.some((x) => x.id === copyId));
});

test('services.brandPages.syncOwner: a new cost reaches the live page at once; a content edit goes back to review', async () => {
  const c = await contractor();
  const page = await livePage(c);
  const p = await ownProduct(c, { cost: { costCents: 10000 } });
  const { product } = await publish(c, p.id);
  await admin.post(`/api/admin/products/${product.listing.copyId}/approve`);
  const anon = t.agent();
  const priceOf = async () => (await anon.get(`/api/brands/by-slug/${page.slug}`)).body.products.find((x) => x.id === product.listing.copyId)?.price;
  const before = await priceOf();
  assert.ok(before > 0);
  const me = (await c.get('/api/auth/me')).body.user;
  // A cost change in the price book (package H's table), then H's hook call.
  t.db.prepare('UPDATE price_book SET cost_cents = cost_cents * 2 WHERE user_id = ? AND product_id = ?').run(me.id, p.id);
  await t.services.brandPages.syncOwner(me.id);
  assert.ok((await priceOf()) > before, 'the new sell price is live without review');
  assert.equal(t.services.products.get(product.listing.copyId).status, 'published');
  // A content edit: back to review, the live version stays public.
  const w = (await c.get(`/api/catalog/products/${p.id}?working=1`)).body.product;
  assert.equal((await c.patch(`/api/pro/products/${p.id}`, { spec: { name: 'Shaker Base II' }, revision: w.revision })).status, 200);
  await t.services.brandPages.syncOwner(me.id);
  assert.equal(t.services.products.get(product.listing.copyId).status, 'submitted');
  const pub = (await anon.get(`/api/brands/by-slug/${page.slug}`)).body.products.find((x) => x.id === product.listing.copyId);
  assert.equal(pub.name, 'Shaker Base', 'the approved name stays public until the edit is approved');
  await t.services.brandPages.syncOwner('nobody');
});

test('price display: From $X, Show prices (per width) or Price on request', async () => {
  const c = await contractor();
  const page = await livePage(c, { priceDisplay: 'show' });
  const p = await ownProduct(c, { cost: { costCents: 20000 } });
  const { product } = await publish(c, p.id);
  await admin.post(`/api/admin/products/${product.listing.copyId}/approve`);
  const get = async () => (await t.agent().get(`/api/brands/by-slug/${page.slug}`)).body.products.find((x) => x.id === product.listing.copyId);
  const shown = await get();
  assert.equal(shown.price, 260, '200 × 1.3 at the default width');
  assert.ok(shown.priceByWidth && Object.keys(shown.priceByWidth).length === 5);
  assert.equal(shown.priceDisplay, 'show');

  await c.put('/api/pro/brand', { priceDisplay: 'from' });
  await c.get('/api/pro/brand/products');
  const from = await get();
  assert.equal(from.priceByWidth, undefined);
  assert.equal(from.price, Math.min(...Object.values(shown.priceByWidth)));
  assert.equal(from.priceDisplay, 'from');

  await c.put('/api/pro/brand', { priceDisplay: 'on_request' });
  await c.get('/api/pro/brand/products');
  const onReq = await get();
  assert.equal(onReq.price, 0);
  assert.equal(onReq.priceDisplay, 'on_request');
});

test('publish whole line, and the 50-product cap (3 here)', async () => {
  const c = await contractor();
  await livePage(c);
  const a = await ownProduct(c, { name: 'Base A', cost: { costCents: 100 } });
  await ownProduct(c, { name: 'Base B', cost: { costCents: 100 } });
  await ownProduct(c, { name: 'Base C', photo: false, cost: { costCents: 100 } });
  const other = await ownProduct(c, { name: 'Pantry', line: 'Other Line', cost: { costCents: 100 } });
  const r = await c.post('/api/pro/brand/lines/publish', { line: 'Hollis Shaker' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.published.length, 2);
  assert.equal(r.body.skipped.length, 1);
  assert.equal(r.body.skipped[0].name, 'Base C');
  assert.equal(r.body.liveCount, 2);
  await publish(c, other.id);
  const extra = await ownProduct(c, { name: 'Base D', cost: { costCents: 100 } });
  const over = await c.post(`/api/pro/brand/products/${extra.id}/publish`);
  assert.equal(over.status, 400);
  assert.equal(over.body.limit, 3);
  // Unpublishing frees a slot; republishing something already counted doesn't need one.
  await c.post(`/api/pro/brand/products/${a.id}/unpublish`);
  assert.equal((await c.post(`/api/pro/brand/products/${extra.id}/publish`)).status, 200);
  assert.equal((await c.post(`/api/pro/brand/products/${other.id}/publish`)).status, 200);
});

test('leads: anyone can send one; only the owning contractor reads it; admins see counts only', async () => {
  const c = await contractor();
  const page = await livePage(c);
  const p = await ownProduct(c, { cost: { costCents: 5000 } });
  const { product } = await publish(c, p.id);
  await admin.post(`/api/admin/products/${product.listing.copyId}/approve`);

  const anon = t.agent();
  assert.equal((await anon.post(`/api/brands/by-slug/${page.slug}/leads`, leadBody({ consent: false }))).status, 400);
  assert.equal((await anon.post(`/api/brands/by-slug/${page.slug}/leads`, leadBody({ email: 'nope' }))).status, 400);
  assert.equal((await anon.post(`/api/brands/by-slug/${page.slug}/leads`, leadBody({ productId: p.id }))).status, 400, 'the private product id is not a public product');
  const r = await anon.post(`/api/brands/by-slug/${page.slug}/leads`, leadBody({ productId: product.listing.copyId }));
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.body, { ok: true, company: page.name }, 'the response carries nothing private');

  // A signed-in homeowner can attach one of their kitchens (the project id; the share link comes with package E).
  const home = await t.user();
  const proj = await home.post('/api/projects', { name: 'Our kitchen', client: '', doc: { name: 'Our kitchen', room: { widthIn: 150, lengthIn: 120, ceilingIn: 96 }, surfaces: { cabinetFinishId: 'white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'marble', backsplashId: 'subway', flooringId: 'oak', paintId: 'white' }, items: [] } });
  assert.equal(proj.status, 201, proj.text);
  const someoneElses = await (await t.user()).post('/api/projects', { name: 'Not yours', client: '', doc: proj.body.project.doc });
  assert.equal((await home.post(`/api/brands/by-slug/${page.slug}/leads`, leadBody({ projectId: someoneElses.body.project.id }))).status, 400);
  assert.equal((await anon.post(`/api/brands/by-slug/${page.slug}/leads`, leadBody({ projectId: proj.body.project.id }))).status, 401);
  assert.equal((await home.post(`/api/brands/by-slug/${page.slug}/leads`, leadBody({ name: 'Sam', projectId: proj.body.project.id }))).status, 201);

  const inbox = await c.get('/api/pro/brand/leads');
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.leads.length, 2);
  assert.equal(inbox.body.leads[0].name, 'Sam', 'newest first');
  assert.equal(inbox.body.leads[0].projectName, 'Our kitchen');
  assert.equal(inbox.body.leads[1].productName, 'Shaker Base');
  assert.equal(inbox.body.counts.unread, 2);
  const summary = await c.get('/api/pro/brand/summary');
  assert.equal(summary.body.summary.unread, 2);
  assert.equal(summary.body.summary.monthLeads, 2);

  // Status and notes; reading clears the badge.
  const id = inbox.body.leads[1].id;
  assert.equal((await c.patch(`/api/pro/brand/leads/${id}`, { status: 'sold' })).status, 400);
  const up = await c.patch(`/api/pro/brand/leads/${id}`, { status: 'contacted', notes: 'Called Tuesday.' });
  assert.equal(up.body.lead.status, 'contacted');
  assert.equal(up.body.lead.notes, 'Called Tuesday.');
  const read = await c.post('/api/pro/brand/leads/read', { ids: inbox.body.leads.map((l) => l.id) });
  assert.equal(read.body.counts.unread, 0);
  assert.equal((await c.get('/api/pro/brand/leads?status=contacted')).body.leads.length, 1);

  // Another contractor sees none of it and can't touch it.
  const rival = await contractor();
  await rival.put('/api/pro/brand', {});
  assert.equal((await rival.get('/api/pro/brand/leads')).body.leads.length, 0);
  assert.equal((await rival.patch(`/api/pro/brand/leads/${id}`, { status: 'lost' })).status, 404);
  // The homeowner and admins can't read leads either; admins get the count.
  assert.equal((await home.get('/api/pro/brand/leads')).status, 403);
  assert.equal((await admin.get('/api/pro/brand/leads')).status, 403);
  const ab = (await admin.get('/api/admin/brands?kind=contractor')).body.brands.find((b) => b.id === page.id);
  assert.equal(ab.leadCount, 2);
  const adminWire = JSON.stringify(await admin.get('/api/admin/brands'));
  assert.ok(!adminWire.includes('dana@example.test') && !adminWire.includes('Can you quote'), 'no lead contents in admin wires');
});

test('an attached kitchen keeps its view-only share link only when it is the sender’s live link to that kitchen', async () => {
  const c = await contractor();
  const page = await livePage(c);
  // Package E's table, exactly as its migration makes it (a no-op once package E has landed).
  t.db.exec(`CREATE TABLE IF NOT EXISTS share_links (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL, label TEXT NOT NULL DEFAULT '', show_prices INTEGER NOT NULL DEFAULT 1,
    expires_at INTEGER, revoked_at INTEGER, view_count INTEGER NOT NULL DEFAULT 0, last_viewed_at INTEGER, created_at INTEGER NOT NULL)`);
  const doc = { name: 'Our kitchen', room: { widthIn: 150, lengthIn: 120, ceilingIn: 96 }, surfaces: { cabinetFinishId: 'white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'marble', backsplashId: 'subway', flooringId: 'oak', paintId: 'white' }, items: [] };
  const home = await t.user();
  const other = await t.user();
  const mine = (await home.post('/api/projects', { name: 'Our kitchen', client: '', doc })).body.project;
  const theirs = (await other.post('/api/projects', { name: 'Theirs', client: '', doc })).body.project;
  const link = (projectId, userId, extra = {}) => {
    const token = `${Math.random().toString(36).slice(2)}${'x'.repeat(32)}`.slice(0, 32);
    t.db
      .prepare('INSERT INTO share_links (id, project_id, token, created_by, label, show_prices, expires_at, revoked_at, view_count, last_viewed_at, created_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 0, NULL, ?)')
      .run(`sh_${token.slice(0, 16)}`, projectId, token, userId, 'Sent to Hollis', extra.expiresAt ?? null, extra.revokedAt ?? null, Date.now());
    return token;
  };
  const homeId = (await home.get('/api/auth/me')).body.user.id;
  const otherId = (await other.get('/api/auth/me')).body.user.id;
  const good = link(mine.id, homeId);
  const send = (name, shareToken) => home.post(`/api/brands/by-slug/${page.slug}/leads`, leadBody({ name, projectId: mine.id, shareToken }));
  assert.equal((await send('Good link', good)).status, 201);
  assert.equal((await send('Someone else’s link', link(theirs.id, otherId))).status, 201);
  assert.equal((await send('Revoked link', link(mine.id, homeId, { revokedAt: Date.now() - 1000 }))).status, 201);
  assert.equal((await send('Not a token', 'nope')).status, 201);
  const leads = (await c.get('/api/pro/brand/leads')).body.leads;
  const tokenOf = (n) => leads.find((l) => l.name === n).shareToken;
  assert.equal(tokenOf('Good link'), good, 'the sender’s live link to that kitchen is kept');
  assert.equal(tokenOf('Someone else’s link'), null);
  assert.equal(tokenOf('Revoked link'), null);
  assert.equal(tokenOf('Not a token'), null);
  for (const l of leads) assert.equal(l.projectName, 'Our kitchen');
});

test('lead spam: honeypot, per-IP rate limit, per-page daily limit', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' }, rateLimits: true });
  try {
    const adm = await s.user({ role: 'admin' });
    const c = await contractor({}, s);
    await c.put('/api/pro/brand', { tagline: 'Kitchens' });
    const sub = await c.post('/api/pro/brand/submit');
    await adm.post(`/api/admin/brand-pages/${sub.body.brand.id}/approve`);
    const slug = sub.body.brand.slug;
    const anon = s.agent();
    // A filled trap field: thanks, and nothing stored.
    const bot = await anon.post(`/api/brands/by-slug/${slug}/leads`, leadBody({ website_url: 'http://spam.test' }));
    assert.equal(bot.status, 201);
    assert.equal((await c.get('/api/pro/brand/leads')).body.leads.length, 0);
    // Three a day to one page from one visitor.
    for (let i = 0; i < 3; i++) assert.equal((await anon.post(`/api/brands/by-slug/${slug}/leads`, leadBody({ name: `Person ${i}` }))).status, 201);
    const fourth = await anon.post(`/api/brands/by-slug/${slug}/leads`, leadBody());
    assert.equal(fourth.status, 429);
    assert.equal((await c.get('/api/pro/brand/leads')).body.leads.length, 3);
    // And five an hour across pages (the 6th request from this IP is refused before anything else).
    const c2 = await contractor({ company: 'Second Shop' }, s);
    await c2.put('/api/pro/brand', { tagline: 'Kitchens' });
    const sub2 = await c2.post('/api/pro/brand/submit');
    await adm.post(`/api/admin/brand-pages/${sub2.body.brand.id}/approve`);
    const sixth = await anon.post(`/api/brands/by-slug/${sub2.body.brand.slug}/leads`, leadBody());
    assert.equal(sixth.status, 429);
    // No IP is stored anywhere.
    const cols = s.db.prepare('PRAGMA table_info(leads)').all().map((r) => r.name);
    assert.ok(!cols.some((n) => /ip/i.test(n)));
    const ev = s.db.prepare('PRAGMA table_info(brand_events)').all().map((r) => r.name);
    assert.ok(!ev.some((n) => /ip/i.test(n)));
  } finally {
    await s.close();
  }
});

test('no cost or margin in any public wire: brand page, catalog, product page, lead and contact responses', async () => {
  const c = await contractor();
  const page = await livePage(c, { priceDisplay: 'show', showPhone: true });
  const costs = [12345, 123.45, 67891, 678.91];
  const p1 = await ownProduct(c, { name: 'Costed Base', cost: { costCents: 12345, markupPct: 37 } });
  const p2 = await ownProduct(c, { name: 'Per-width Base', cost: { costByWidth: { 12: 67891, 24: 50000 } } });
  for (const p of [p1, p2]) {
    const { product } = await publish(c, p.id);
    await admin.post(`/api/admin/products/${product.listing.copyId}/approve`);
  }
  const anon = t.agent();
  const home = await t.user();
  const wires = {
    brandPage: await anon.get(`/api/brands/by-slug/${page.slug}`),
    contact: await anon.get(`/api/brands/by-slug/${page.slug}/contact`),
    catalogAnon: await anon.get('/api/catalog'),
    catalogUser: await home.get('/api/catalog'),
    brands: await anon.get('/api/catalog/brands'),
  };
  for (const p of wires.brandPage.body.products) wires[`product:${p.id}`] = await anon.get(`/api/catalog/products/${p.id}`);
  wires.lead = await anon.post(`/api/brands/by-slug/${page.slug}/leads`, leadBody({ productId: wires.brandPage.body.products[0].id }));
  for (const [where, r] of Object.entries(wires)) {
    assert.ok(r.status < 300, `${where} ${r.status}`);
    assertNoCosts(r.body, costs, where);
    assert.ok(!/markup|margin/i.test(r.text), `${where} mentions markup or margin`);
  }
  assert.equal(wires.brandPage.body.products.length, 2);
  // Marked-up sell prices are what shows: 123.45 × 1.37 = 169.13.
  assert.ok(wires.brandPage.body.products.some((p) => p.price === 169.13));
});

test('plan lapse hides the page and its products; renewal restores them with no re-review', async () => {
  const t0 = Date.now();
  t.setNow(t0);
  try {
    const c = await contractor();
    const page = await livePage(c);
    const p = await ownProduct(c, { cost: { costCents: 9000 } });
    const { product } = await publish(c, p.id);
    await admin.post(`/api/admin/products/${product.listing.copyId}/approve`);
    const copyId = product.listing.copyId;
    const anon = t.agent();
    assert.ok((await anon.get('/api/catalog')).body.products.some((x) => x.id === copyId));
    await anon.post(`/api/brands/by-slug/${page.slug}/leads`, leadBody());

    // Failed renewal, then the grace period ends.
    await c.post('/api/billing/demo/simulate', { event: 'renewal_failed' });
    t.setNow(t0 + 8 * DAY);
    assert.equal((await anon.get(`/api/brands/by-slug/${page.slug}`)).status, 404);
    assert.equal((await anon.get(`/api/brands/by-slug/${page.slug}`)).body.error, 'This page is unavailable.');
    assert.ok(!(await anon.get('/api/catalog')).body.products.some((x) => x.id === copyId), 'gone from the catalog');
    assert.equal((await anon.get(`/api/catalog/products/${copyId}`)).status, 404);
    assert.ok(!(await anon.get('/api/catalog')).body.brands.some((b) => b.id === page.id));
    // The contractor sees why; leads stay readable but read-only.
    const st = await c.get('/api/pro/brand');
    assert.equal(st.status, 200);
    assert.equal(st.body.brand.pageStatus, 'hidden');
    assert.equal(st.body.readOnly, true);
    const leads = await c.get('/api/pro/brand/leads');
    assert.equal(leads.body.leads.length, 1);
    const w = await c.patch(`/api/pro/brand/leads/${leads.body.leads[0].id}`, { status: 'won' });
    assert.equal(w.status, 403);
    assert.equal(w.body.needs, 'renew');
    assert.equal((await c.post(`/api/pro/brand/products/${p.id}/unpublish`)).status, 403);
    assert.equal((await anon.post(`/api/brands/by-slug/${page.slug}/leads`, leadBody())).status, 404);
    // Admins see it as hidden, not suspended.
    assert.equal((await admin.get('/api/admin/brands')).body.brands.find((b) => b.id === page.id).pageStatus, 'hidden');

    // Renew: everything is back, nothing goes through review again.
    await buy(c, { kind: 'subscription', plan: 'contractor' });
    const back = await anon.get(`/api/brands/by-slug/${page.slug}`);
    assert.equal(back.status, 200);
    assert.ok(back.body.products.some((x) => x.id === copyId));
    assert.ok((await anon.get('/api/catalog')).body.products.some((x) => x.id === copyId));
    assert.equal((await c.get('/api/pro/brand')).body.brand.pageStatus, 'live');
    assert.ok(!(await admin.get('/api/admin/moderation')).body.brands.some((b) => b.id === page.id));
    assert.equal(t.services.products.get(copyId).status, 'published');
  } finally {
    t.setNow(null);
  }
});

test('admin: brands of both kinds, partner brands, suspend / reinstate / verify', async () => {
  const created = await admin.post('/api/admin/brands', { name: 'Fernhill Faucets (Demo)', tagline: 'Faucets', website: 'fernhill.test', isDemo: true });
  assert.equal(created.status, 201, created.text);
  const b = created.body.brand;
  assert.equal(b.kind, 'partner');
  assert.equal(b.pageStatus, 'live');
  assert.equal(b.owner, null);
  assert.equal((await admin.post('/api/admin/brands', { name: '' })).status, 400);

  const spec = { kind: 'range', variant: 'gas-4', category: 'appliances', name: 'Partner Range (Demo)', blurb: '', sku: 'FR30', widthIn: 30, depthIn: 28, heightIn: 36, elevationIn: 0, price: 2100, finishes: [{ id: 'ss', name: 'Steel', hex: '#c3c6ca', material: 'metal' }], imageFileIds: [] };
  const pr = await admin.post(`/api/admin/brands/${b.id}/products`, { spec });
  assert.equal(pr.status, 201, pr.text);
  const anon = t.agent();
  const page = await anon.get(`/api/brands/by-slug/${b.slug}`);
  assert.equal(page.status, 200);
  assert.equal(page.body.brand.leadForm, false, 'partner brands take no leads');
  assert.equal(page.body.products.length, 1);
  assert.equal((await anon.post(`/api/brands/by-slug/${b.slug}/leads`, leadBody())).status, 404);

  assert.equal((await admin.post(`/api/admin/brands/${b.id}/suspend`, {})).status, 400);
  await admin.post(`/api/admin/brands/${b.id}/suspend`, { note: 'Broken images.' });
  assert.equal((await anon.get(`/api/brands/by-slug/${b.slug}`)).status, 404);
  assert.ok(!(await anon.get('/api/catalog')).body.products.some((x) => x.id === pr.body.product.id));
  const re = await admin.post(`/api/admin/brands/${b.id}/reinstate`);
  assert.equal(re.body.brand.pageStatus, 'live');
  assert.equal((await admin.post(`/api/admin/brands/${b.id}/verify`)).body.brand.verified, true);
  assert.equal((await admin.post(`/api/admin/brands/${b.id}/unverify`)).body.brand.verified, false);

  // Suspending a contractor's page; reinstating it when their plan is still active → live.
  const c = await contractor();
  const cp = await livePage(c);
  await admin.post(`/api/admin/brands/${cp.id}/suspend`, { note: 'Reported.' });
  assert.equal((await c.get('/api/pro/brand')).body.brand.pageStatus, 'suspended');
  assert.equal((await c.get('/api/pro/brand')).body.brand.statusNote, 'Reported.');
  await admin.post(`/api/admin/brands/${cp.id}/reinstate`);
  assert.equal((await c.get('/api/pro/brand')).body.brand.pageStatus, 'live');
  // Contractor pages are the contractor's to edit.
  assert.equal((await admin.patch(`/api/admin/brands/${cp.id}`, { name: 'X' })).status, 400);
  const kinds = new Set((await admin.get('/api/admin/brands')).body.brands.map((x) => x.kind));
  assert.deepEqual([...kinds].sort(), ['contractor', 'partner']);
});

test('analytics: page views, product views, adds, quote clicks and leads over 7/30/90 days', async () => {
  const c = await contractor();
  const page = await livePage(c);
  const p = await ownProduct(c, { cost: { costCents: 1000 } });
  const { product } = await publish(c, p.id);
  await admin.post(`/api/admin/products/${product.listing.copyId}/approve`);
  const anon = t.agent();
  assert.equal((await anon.post(`/api/brands/by-slug/${page.slug}/events`, { type: 'brand_view' })).status, 204);
  assert.equal((await anon.post(`/api/brands/by-slug/${page.slug}/events`, { type: 'brand_view' })).status, 204); // same visitor: counted once
  await anon.post(`/api/brands/by-slug/${page.slug}/events`, { type: 'quote_click', productId: product.listing.copyId });
  assert.equal((await anon.post(`/api/brands/by-slug/${page.slug}/events`, { type: 'lead' })).status, 400, 'leads are counted by the lead form, not a beacon');
  await anon.post('/api/events', { productId: product.listing.copyId, type: 'view' });
  await anon.post('/api/events', { productId: product.listing.copyId, type: 'add' });
  await anon.post(`/api/brands/by-slug/${page.slug}/leads`, leadBody({ productId: product.listing.copyId }));
  const a = await c.get('/api/pro/brand/analytics?days=7');
  assert.equal(a.status, 200);
  assert.deepEqual(a.body.analytics.totals, { brandViews: 1, productViews: 1, adds: 1, quoteClicks: 1, leads: 1 });
  assert.equal(a.body.analytics.byDay.length, 7);
  assert.equal(a.body.analytics.topProducts[0].id, product.listing.copyId);
  assert.equal(a.body.analytics.topProducts[0].sourceId, p.id);
  assert.equal((await c.get('/api/pro/brand/analytics?days=14')).status, 400);
  assert.equal((await c.get('/api/pro/brand/analytics?days=90')).body.analytics.byDay.length, 90);
});

test('the seed: fictional (Demo) partner brands with models, and a demo contractor page with leads; idempotent', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo', SEED_PASSWORD: 'seed-password-123' } });
  try {
    const ctx = { db: s.db, config: s.config, services: s.services, now: s.ctx.now };
    await seedBrands(ctx);
    await seedBrands(ctx);
    const brands = s.db.prepare('SELECT * FROM brands ORDER BY name').all();
    assert.ok(brands.length >= 3);
    for (const b of brands) assert.match(b.name, /\(Demo\)$/, `${b.name} is marked as demo`);
    assert.equal(brands.filter((b) => b.kind === 'contractor').length, 2, 'two contractor pages, once each');
    assert.equal(brands.filter((b) => b.kind === 'contractor' && b.status === 'active').length, 1, 'one live, one in review');
    const anon = s.agent();
    const cat = await anon.get('/api/catalog');
    assert.ok(cat.body.products.some((p) => p.model), 'partner products have GLB models');
    const contractorBrand = brands.find((b) => b.kind === 'contractor' && b.status === 'active');
    const page = await anon.get(`/api/brands/by-slug/${contractorBrand.slug}`);
    assert.equal(page.status, 200);
    assert.ok(page.body.products.length >= 3);
    assert.ok(s.db.prepare('SELECT COUNT(*) AS n FROM leads WHERE brand_id = ?').get(contractorBrand.id).n >= 3);
    // The demo contractor can sign in and sees their leads.
    const me = s.agent();
    assert.equal((await me.post('/api/auth/login', { email: 'demo-brand@mise.test', password: 'seed-password-123' })).status, 200);
    assert.ok((await me.get('/api/pro/brand/leads')).body.leads.length >= 3);
    assert.equal((await me.get('/api/pro/brand/analytics?days=30')).body.analytics.isDemo, true);
    // One My-catalog product isn't ready, so the demo shows the readiness checklist.
    const mine = (await me.get('/api/pro/brand/products')).body.products;
    const shelf = mine.find((p) => p.name === 'Shaker Open Wall Shelf');
    assert.ok(shelf && !shelf.readiness.ready && !shelf.listing, 'the demo shelf is unpublished and not ready');
    assert.deepEqual(shelf.readiness.checks.filter((c) => !c.ok).map((c) => c.id).sort(), ['media', 'price']);
  } finally {
    await s.close();
  }
});

test('GLB report in moderation flags a model 10% off its declared size', async () => {
  const c = await contractor();
  await livePage(c);
  // A 24″ (0.6096 m) wide cabinet modelled 10% too wide.
  const glb = await c.putRaw('/api/files?kind=model&name=base.glb', makeGlb({ w: 0.6096 * 1.1, h: 0.876, d: 0.6096 }), 'model/gltf-binary');
  assert.equal(glb.status, 201, glb.text);
  const p = await ownProduct(c, { photo: false, cost: { costCents: 1000 } });
  const w = (await c.get(`/api/catalog/products/${p.id}?working=1`)).body.product;
  assert.equal((await c.patch(`/api/pro/products/${p.id}`, { spec: { modelFileId: glb.body.file.id }, revision: w.revision })).status, 200);
  const { product } = await publish(c, p.id);
  const item = (await admin.get('/api/admin/moderation')).body.products.find((x) => x.id === product.listing.copyId);
  assert.ok(item.glb, 'has a GLB report');
  assert.deepEqual(
    item.glb.mismatches.map((m) => m.axis),
    ['w'],
  );
});
