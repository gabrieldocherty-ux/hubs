// Package C (orders): custom models end to end. Since 2026-10-15 they are included in the
// Contractor plan (3 a month, server/payments/allowance.mjs; the allowance rules themselves are in
// pricing-models.test.mjs): a request goes straight to the studio queue, is delivered into private /
// brand / contractor products, with revisions. Orders paid for before then (a retired tier, in US
// dollars) keep their DEMO checkout, refunds, expiry and the revenue report; they are made here
// with priorOrder(), as the live database holds them. Stripe-specific behaviour is in
// payments.test.mjs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { makeGlb } from './fixtures/glb.mjs';
import { makePng } from './fixtures/images.mjs';
import { seed } from '../seed/orders.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { MIGRATION_MODULES, MIGRATION_KEYS } from '../db/migrations/index.mjs';
import { includedQuote, legacyQuote, MAX_ITEMS, MODEL_TERMS } from '../payments/tiers.mjs';
import { normalizeUpc, gs1CheckDigit } from '../payments/upc.mjs';
import { createBillingService } from '../billing/service.mjs';

const DAY = 86_400_000;
let t;
before(async () => {
  t = await startTestServer({ env: { PAYMENTS: 'demo' } });
});
after(async () => {
  await t?.close();
});

/** Uploads a private reference photo as `agent`. */
async function refPhoto(agent, rgba = [120, 90, 60, 255]) {
  const r = await agent.putRaw('/api/files?kind=reference&name=photo.png', makePng({ w: 6, h: 6, rgba }), 'image/png');
  assert.equal(r.status, 201, r.text);
  return r.body.file.id;
}

const brief = (refs, over = {}) => ({
  productTypeId: 'range-gas',
  kind: 'range',
  variant: 'gas-4',
  name: 'My Old Range',
  widthIn: 30,
  depthIn: 28,
  heightIn: 36,
  notes: 'Stainless, brass knobs.',
  referenceFileIds: refs,
  ...over,
});

/** A new user on a complimentary Contractor plan (calendar-month allowance), plus `extra` models. */
async function contractor(s = t, { extra = 0, ...opts } = {}) {
  const pro = await s.user(opts);
  createBillingService({ db: s.db, now: s.ctx.now }).grantComp(pro.id, { plan: 'contractor', note: 'test', adminId: null });
  if (extra) grantModels(s, pro, extra);
  return pro;
}

/** Extra models that apply in every period (straight into model_grants; the admin route is tested elsewhere). */
let grantN = 0;
function grantModels(s, agent, models) {
  s.db
    .prepare('INSERT INTO model_grants (id, user_id, models, period_start, period_end, note, granted_by, created_at) VALUES (?, ?, ?, 0, ?, ?, NULL, ?)')
    .run(`mg_test${String(++grantN).padStart(18, '0')}`, agent.id, models, 8_640_000_000_000_000, 'test', Date.now());
}

/** A request included in the plan (the agent must be a contractor with models left). */
async function newOrder(agent, body = {}) {
  const refs = body.refs ?? [await refPhoto(agent)];
  const r = await agent.post('/api/orders', { target: body.target ?? 'contractor', brief: brief(refs, body.brief), ...body.extra });
  assert.equal(r.status, 201, r.text);
  return r.body.order;
}

/**
 * An order placed and priced before 2026-10-15, as the live database holds them: a retired tier
 * at its stored price in US dollars, unpaid, on the DEMO provider.
 */
let priorN = 0;
function priorOrder(s, agent, { tier = 'standard', amountCents = 27_900, currency = 'usd', items = 1, extraFinishes = 0 } = {}) {
  const extras = JSON.stringify({ rush: false, extraFinishes });
  const id = `o_prior${String(++priorN).padStart(19, '0')}`;
  const now = s.ctx.now();
  const b = JSON.stringify(brief([]));
  s.db
    .prepare(
      `INSERT INTO orders (id, user_id, target, status, tier, extras, amount_cents, currency, provider, brief, pending_since, created_at, updated_at)
       VALUES (?, ?, 'customer', 'draft', ?, ?, ?, ?, 'demo', ?, ?, ?, ?)`,
    )
    .run(id, agent.id, tier, extras, amountCents * items, currency, b, now, now, now);
  for (let i = 0; i < items; i++) s.db.prepare('INSERT INTO order_items (order_id, idx, brief, tier, extra_finishes, amount_cents) VALUES (?, ?, ?, ?, ?, ?)').run(id, i, b, tier, extraFinishes, amountCents);
  s.db.prepare("INSERT INTO order_events (order_id, type, to_status, by_user_id, created_at) VALUES (?, 'created', 'draft', ?, ?)").run(id, agent.id, now);
  return { id, amountCents: amountCents * items };
}

/** Checkout + "Simulate successful payment" (an order from before 2026-10-15). */
async function demoPay(agent, id) {
  const c = await agent.post(`/api/orders/${id}/checkout`);
  assert.equal(c.status, 200, c.text);
  assert.equal(c.body.url, `#/pay/demo/${id}`);
  const p = await agent.post(`/api/payments/demo/${id}/complete`, { outcome: 'success' });
  assert.equal(p.status, 200, p.text);
  return p.body.order;
}

/** Uploads a GLB + thumbnail as the studio user and delivers item `item`. */
async function studioDeliver(studio, id, { item = 0, glb = makeGlb({ w: 0.762, h: 0.914, d: 0.711 }), ...rest } = {}) {
  const m = await studio.putRaw('/api/files?kind=model&name=model.glb', glb, 'model/gltf-binary');
  assert.equal(m.status, 201, m.text);
  const th = await studio.putRaw('/api/files?kind=image&name=thumb.png', makePng({ w: 16, h: 16, rgba: [40, 40, 40, 255] }), 'image/png');
  assert.equal(th.status, 201, th.text);
  const r = await studio.post(`/api/studio/orders/${id}/deliver`, { item, modelFileId: m.body.file.id, thumbFileId: th.body.file.id, ...rest });
  return r;
}

const events = (id) => t.db.prepare('SELECT type FROM order_events WHERE order_id = ? ORDER BY id').all(id).map((r) => r.type);

test('custom models are included in the Contractor plan: no price, no pack, no rush, no checkout; client amounts are ignored', async () => {
  const anon = t.agent();
  const tiers = await anon.get('/api/orders/tiers');
  assert.equal(tiers.status, 200);
  assert.equal(tiers.body.pricing, 'plan');
  assert.equal(tiers.body.plan, 'contractor');
  assert.deepEqual(tiers.body.models, { perMonth: 3, finishesPerModel: 3, revisions: 2, businessDays: 15 });
  assert.deepEqual(tiers.body.tiers, [], 'nothing is for sale');
  assert.equal(tiers.body.pack, undefined);
  assert.equal(tiers.body.rushPct, undefined);
  assert.equal(tiers.body.maxItems, 40);

  // A page from before still gets an answer: the included "quote" is 0, rush or not.
  const q = await anon.post('/api/orders/quote', { products: 9, rush: true, amountCents: 1 });
  assert.equal(q.status, 200);
  assert.equal(q.body.quote.amountCents, 0);
  assert.equal(q.body.quote.pricing, 'plan');
  assert.equal(q.body.quote.rush, false);
  assert.equal((await anon.post('/api/orders/quote', { products: 41 })).status, 400);

  // Not on the Contractor plan: 403, and nothing is stored.
  const ann = await t.user();
  const refs = [await refPhoto(ann)];
  const before = t.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  const denied = await ann.post('/api/orders', { target: 'customer', brief: brief(refs) });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.needs, 'contractor');
  assert.equal(denied.body.allowance.active, false);
  assert.match(denied.body.error, /Contractor plan/);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, before);
  assert.equal((await t.agent().post('/api/orders', { brief: brief(refs) })).status, 401, 'signed out');

  // A contractor submits: free, straight to the studio, in CAD, whatever a page from before sends.
  const pro = await contractor();
  const prefs = [await refPhoto(pro)];
  const r = await pro.post('/api/orders', { brief: brief(prefs), tier: 'complex', extraFinishes: 4, rush: true, amountCents: 100, quote: { amountCents: 1 } });
  assert.equal(r.status, 201, r.text);
  const o = r.body.order;
  assert.equal(o.target, 'contractor', 'My catalog is the default');
  assert.equal(o.amountCents, 0);
  assert.equal(o.currency, 'cad');
  assert.equal(o.tier, 'plan');
  assert.equal(o.provider, 'plan');
  assert.equal(o.pricing, 'plan');
  assert.equal(o.status, 'paid', 'in the studio queue');
  assert.equal(o.extras.rush, false);
  assert.equal(o.finishesPerModel, 3);
  assert.equal(o.revisionsAllowed, 2);
  assert.equal(o.cancellable, true);
  assert.ok(o.planPeriod && o.planPeriod.start <= o.createdAt && o.createdAt < o.planPeriod.end);
  assert.ok(o.dueAt >= o.paidAt + 19 * DAY, '15 business days are at least 19 calendar days (21 from a weekday, 19 from a Sunday)');
  assert.deepEqual(o.quote.lines, [{ label: '1 custom 3D model, included in the Contractor plan', amountCents: 0 }]);
  assert.equal(r.body.allowance.left, 2);
  assert.match(t.db.prepare("SELECT note FROM order_events WHERE order_id = ? AND type = 'created'").get(o.id).note, /2 of 3 left/);

  // Nothing to pay, so nothing to check out, simulate or refund.
  const c = await pro.post(`/api/orders/${o.id}/checkout`);
  assert.equal(c.status, 409);
  assert.match(c.body.error, /nothing to pay/);
  assert.equal((await pro.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' })).status, 400);
  const admin = await t.user({ role: 'admin' });
  assert.equal((await admin.post(`/api/admin/orders/${o.id}/refund`)).status, 409);
  assert.equal(t.db.prepare('SELECT status FROM orders WHERE id = ?').get(o.id).status, 'paid');
  // Plan requests are never revenue.
  assert.equal((await admin.get('/api/admin/revenue?days=30')).body.byProvider.demo.count, 0);
});

test('the included quote and a prior order’s quote (pure)', () => {
  assert.equal(MODEL_TERMS.perMonth, 3);
  const q = includedQuote(2);
  assert.deepEqual([q.pricing, q.amountCents, q.currency, q.dueBusinessDays, q.products, q.rush], ['plan', 0, 'cad', 15, 2, false]);
  assert.deepEqual(q.lines, [{ label: '2 custom 3D models, included in the Contractor plan', amountCents: 0 }]);
  assert.throws(() => includedQuote(0));
  assert.throws(() => includedQuote(MAX_ITEMS + 1));
  // An order from before is rebuilt from its stored amounts, in its own currency, never re-priced.
  const lq = legacyQuote({ items: [{ tier: 'standard', extraFinishes: 1, amountCents: 31_800, name: 'Range' }], amountCents: 31_800, currency: 'usd' });
  assert.equal(lq.pricing, 'tiers');
  assert.equal(lq.amountCents, 31_800);
  assert.equal(lq.currency, 'usd');
  assert.equal(lq.dueBusinessDays, 10);
  assert.deepEqual(lq.lines, [{ label: 'Standard model: Range, 1 extra finish', amountCents: 31_800, item: 0 }]);
});

test('migrating the live database: orders paid before keep their prices, currency, status and events; new columns and the plan tier exist', async () => {
  // The live database (b85ea81): no account, pricing or retail modules, and orders-001 only.
  const db = openDb(':memory:');
  const live = new Set(['core', 'platform', 'viewer', 'brands', 'orders', 'generate', 'share', 'billing', 'contractors', 'ops']);
  const modules = [];
  const keys = [];
  MIGRATION_MODULES.forEach((m, i) => {
    if (!live.has(MIGRATION_KEYS[i])) return;
    modules.push(MIGRATION_KEYS[i] === 'orders' ? { steps: m.steps.filter((s) => s.id === 'orders-001-orders') } : m);
    keys.push(MIGRATION_KEYS[i]);
  });
  migrate(db, { modules, keys });
  const ts = Date.UTC(2026, 9, 1);
  db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u_legacybuyer', 'old@example.test', 'Old buyer', 'x', ?)").run(ts);
  const insOrder = db.prepare(
    `INSERT INTO orders (id, user_id, target, status, tier, extras, amount_cents, currency, provider, brief, pending_since, created_at, updated_at, paid_at, refunded_at)
     VALUES (?, 'u_legacybuyer', 'customer', ?, ?, ?, ?, 'usd', ?, '{"name":"Old"}', ?, ?, ?, ?, ?)`,
  );
  insOrder.run('o_legacyorder0000000000001', 'paid', 'complex', '{"rush":true,"extraFinishes":0}', 82_350, 'stripe', ts, ts, ts, ts, null);
  insOrder.run('o_legacyorder0000000000002', 'draft', 'simple', '{"rush":false,"extraFinishes":0}', 12_900, 'demo', ts, ts, ts, null, null);
  insOrder.run('o_legacyorder0000000000004', 'refunded', 'standard', '{"rush":false,"extraFinishes":1}', 31_800, 'stripe', ts, ts, ts, ts, ts + DAY);
  db.prepare("INSERT INTO order_items (order_id, idx, brief, tier, extra_finishes, amount_cents) VALUES ('o_legacyorder0000000000001', 0, '{\"name\":\"Old\"}', 'complex', 0, 82350)").run();
  db.prepare("INSERT INTO order_events (order_id, type, to_status, created_at) VALUES ('o_legacyorder0000000000001', 'paid', 'paid', ?)").run(ts);

  const ran = migrate(db);
  assert.ok(ran.indexOf('orders-002-model-pack') >= 0 && ran.indexOf('orders-002-model-pack') < ran.indexOf('pricing-002-included-models'), ran.join(', '));
  const rows = db.prepare('SELECT id, status, tier, amount_cents, currency, provider, refunded_at FROM orders ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { id: 'o_legacyorder0000000000001', status: 'paid', tier: 'complex', amount_cents: 82_350, currency: 'usd', provider: 'stripe', refunded_at: null },
    { id: 'o_legacyorder0000000000002', status: 'draft', tier: 'simple', amount_cents: 12_900, currency: 'usd', provider: 'demo', refunded_at: null },
    { id: 'o_legacyorder0000000000004', status: 'refunded', tier: 'standard', amount_cents: 31_800, currency: 'usd', provider: 'stripe', refunded_at: ts + DAY },
  ]);
  assert.equal(db.prepare('SELECT amount_cents FROM order_items WHERE order_id = ?').get('o_legacyorder0000000000001').amount_cents, 82_350);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM order_events').get().n, 1, 'events survive both rebuilds');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const cols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
  assert.ok(cols.includes('plan_period_start') && cols.includes('plan_period_end'));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'orders_provider_paid'").get(), 'ops’ index is kept');
  // The rebuilt CHECKs take a plan request; model_grants exists.
  db.prepare("UPDATE orders SET tier = 'plan', provider = 'plan' WHERE id = 'o_legacyorder0000000000002'").run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM model_grants').get().n, 0);
  assert.deepEqual(migrate(db), [], 'nothing left to run');
  db.close();
});

test('an order paid for before reads, pays and refunds at its own stored price and currency', async () => {
  const ann = await t.user();
  const admin = await t.user({ role: 'admin' });
  const o = priorOrder(t, ann, { tier: 'standard', amountCents: 31_800, extraFinishes: 1 });
  const g = await ann.get(`/api/orders/${o.id}`);
  assert.equal(g.status, 200, g.text);
  assert.equal(g.body.order.amountCents, 31_800);
  assert.equal(g.body.order.currency, 'usd');
  assert.equal(g.body.order.pricing, 'tiers');
  assert.equal(g.body.order.quote.currency, 'usd');
  assert.equal(g.body.order.cancellable, true, 'an unpaid order can still be cancelled');
  assert.deepEqual(g.body.order.quote.lines.map((l) => l.label), ['Standard model: My Old Range, 1 extra finish']);
  const paid = await demoPay(ann, o.id);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.amountCents, 31_800);
  assert.equal(paid.currency, 'usd');
  const row = t.db.prepare('SELECT * FROM orders WHERE id = ?').get(o.id);
  assert.deepEqual([row.amount_cents, row.currency, row.tier], [31_800, 'usd', 'standard']);
  assert.ok(row.due_at - row.paid_at > 0);
  // Refunds keep working, in the order's own provider and currency.
  const r = await admin.post(`/api/admin/orders/${o.id}/refund`, { note: 'Changed their mind.' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.order.status, 'refunded');
  assert.equal(r.body.order.currency, 'usd');
  // A non-contractor keeps reading their history (and is told custom models come with the plan).
  const list = await ann.get('/api/orders');
  assert.deepEqual(list.body.orders.map((x) => x.id), [o.id]);
  assert.equal(list.body.allowance.active, false);
});

test('UPCs: UPC-A, EAN-13 and EAN-8 with check digits, stored as digits only (pure)', () => {
  const ok = (raw, code, format) => assert.deepEqual(normalizeUpc(raw), { ok: true, code, format }, raw);
  ok('036000291452', '036000291452', 'upc_a');
  ok(' 0 36000-29145 2 ', '036000291452', 'upc_a');
  ok('0036000291452', '036000291452', 'upc_a'); // an EAN-13 with a leading 0 is that UPC-A
  ok('4006381333931', '4006381333931', 'ean_13');
  ok('400-638133393-1', '4006381333931', 'ean_13');
  ok('96385074', '96385074', 'ean_8');
  const bad = (raw, re) => {
    const r = normalizeUpc(raw);
    assert.equal(r.ok, false, raw);
    assert.match(r.message, re, raw);
  };
  bad('036000291453', /doesn’t check out/);
  bad('4006381333932', /doesn’t check out/);
  bad('96385075', /doesn’t check out/);
  bad('12345', /5 digits/);
  bad('03600029145', /11 digits.*12, an EAN 13 or 8/);
  bad('0360002914AB', /digits only/);
  bad('', /Enter the UPC/);
  bad(12345, /Enter the UPC/);
  for (const [body, check] of [['03600029145', 2], ['400638133393', 1], ['9638507', 4]]) assert.equal(gs1CheckDigit(body), check);
});

test('the product list: brand, UPC, optional size, barcode photos, ownership, identification and request limits', async () => {
  const ann = await contractor(t, { extra: 50 });
  const bob = await t.user();
  const ref = await refPhoto(ann);
  const product = (over = {}) => ({ brief: { productTypeId: 'range-gas', kind: 'range', variant: 'gas-4', name: 'Range', notes: '', referenceFileIds: [], ...over } });

  // A UPC alone identifies a product: no photo, no size needed. Stored normalised.
  const r = await ann.post('/api/orders', { items: [product({ upc: '0 36000 29145 2', brand: '  Acme  ' })] });
  assert.equal(r.status, 201, r.text);
  const b0 = r.body.order.items[0].brief;
  assert.equal(b0.upc, '036000291452');
  assert.equal(b0.upcFormat, 'upc_a');
  assert.equal(b0.brand, 'Acme');
  assert.equal(b0.widthIn, undefined, 'no size was given');
  assert.equal(r.body.order.amountCents, 0);

  // A bad check digit is a clear field error; so is a long brand or half a bad size.
  const bad = await ann.post('/api/orders', { items: [product({ upc: '036000291453', brand: 'x'.repeat(61), widthIn: 999, referenceFileIds: [ref] })] });
  assert.equal(bad.status, 400);
  const byField = Object.fromEntries(bad.body.errors.map((e) => [e.field, e.message]));
  assert.match(byField['items[0].brief.upc'], /doesn’t check out/);
  assert.match(byField['items[0].brief.brand'], /60 characters/);
  assert.match(byField['items[0].brief.widthIn'], /between 1 and 240/);
  // Part of a size is fine.
  assert.equal((await ann.post('/api/orders', { items: [product({ widthIn: 30, referenceFileIds: [ref] })] })).status, 201);

  // Nothing to identify it by.
  const none = await ann.post('/api/orders', { items: [product()] });
  assert.equal(none.status, 400);
  assert.match(none.body.errors[0].message, /reference photo or the product’s UPC/);

  // A barcode photo identifies it too, but only the caller's own reference photo.
  const barcode = await refPhoto(ann, [250, 250, 250, 255]);
  const withPhoto = await ann.post('/api/orders', { items: [product({ barcodeFileId: barcode })] });
  assert.equal(withPhoto.status, 201, withPhoto.text);
  assert.equal(withPhoto.body.order.items[0].brief.barcodeFileId, barcode);
  const bobs = await refPhoto(bob);
  const stolen = await ann.post('/api/orders', { items: [product({ barcodeFileId: bobs })] });
  assert.equal(stolen.status, 400);
  assert.ok(stolen.body.errors.some((e) => e.field === 'items[0].brief.barcodeFileId'));
  assert.equal((await ann.post('/api/orders', { items: [product({ barcodeFileId: 'not-a-file' })] })).status, 400);
  const img = (await ann.putRaw('/api/files?kind=image&name=x.png', makePng(), 'image/png')).body.file.id;
  assert.equal((await ann.post('/api/orders', { items: [product({ barcodeFileId: img })] })).status, 400, 'an image upload is not a reference photo');
  // The barcode photo shows with the order's references, to the buyer and not to others.
  const det = await ann.get(`/api/orders/${withPhoto.body.order.id}`);
  assert.ok(det.body.references.some((f) => f.id === barcode));
  assert.equal((await ann.get(`/api/files/${barcode}`)).status, 200);
  assert.equal((await bob.get(`/api/files/${barcode}`)).status, 404);

  // Several products are one request; 40 is the most one request holds.
  const nine = Array.from({ length: 9 }, (_, i) => product({ name: `Cabinet ${i + 1}`, upc: '4006381333931' }));
  const o9 = await ann.post('/api/orders', { items: nine, line: 'Harbor Shaker' });
  assert.equal(o9.status, 201, o9.text);
  assert.equal(o9.body.order.items.length, 9);
  assert.equal(o9.body.order.packs, 0);
  assert.ok(o9.body.order.items.every((it) => it.pack === undefined && it.amountCents === 0));
  const big = await ann.post('/api/orders', { items: Array.from({ length: 41 }, () => product({ upc: '96385074' })) });
  assert.equal(big.status, 400);
  assert.match(big.body.errors[0].message, /up to 40 products/);
  assert.equal((await ann.post('/api/orders', { items: [] })).status, 400);

  // The studio queue shows each product's UPC; delivery without a size uses the model's size.
  const studio = await t.user({ role: 'studio' });
  const q = await studio.get('/api/studio/orders?status=all');
  const row = q.body.orders.find((o) => o.id === r.body.order.id);
  assert.equal(row.items[0].brief.upc, '036000291452');
  assert.equal((await studio.post(`/api/studio/orders/${r.body.order.id}/start`)).status, 200);
  const del = await studioDeliver(studio, r.body.order.id);
  assert.equal(del.status, 200, del.text);
  assert.deepEqual([del.body.product.widthIn, del.body.product.depthIn, del.body.product.heightIn].map(Math.round), [30, 28, 36]);
});

test('the brief is validated; reference files must be the caller’s own reference photos', async () => {
  const ann = await contractor(t, { extra: 10 });
  const bob = await contractor();
  const bobs = await refPhoto(bob);
  const r1 = await ann.post('/api/orders', { brief: brief([bobs]) });
  assert.equal(r1.status, 400);
  assert.ok(r1.body.errors.some((e) => e.field === 'items[0].brief.referenceFileIds'));

  // An image upload (kind image) is not a reference.
  const img = await ann.putRaw('/api/files?kind=image&name=x.png', makePng(), 'image/png');
  assert.equal((await ann.post('/api/orders', { brief: brief([img.body.file.id]) })).status, 400);
  // No reference at all, and no reference product.
  const none = await ann.post('/api/orders', { brief: brief([]) });
  assert.equal(none.status, 400);
  assert.ok(none.body.errors.some((e) => /at least one reference/.test(e.message)));
  // A catalog product is enough of a reference.
  assert.equal((await ann.post('/api/orders', { brief: brief([], { refProductId: 'range-30' }) })).status, 201);
  // Nine photos is one too many.
  const nine = [];
  for (let i = 0; i < 9; i++) nine.push(await refPhoto(ann, [i * 20, 10, 10, 255]));
  assert.equal((await ann.post('/api/orders', { brief: brief(nine) })).status, 400);

  const mine = [await refPhoto(ann)];
  const bad = await ann.post('/api/orders', { brief: brief(mine, { kind: 'spaceship', name: '', widthIn: 0, notes: 'x'.repeat(4001) }), tier: 'platinum', extraFinishes: -1 });
  assert.equal(bad.status, 400);
  const fields = bad.body.errors.map((e) => e.field);
  for (const f of ['items[0].brief.kind', 'items[0].brief.name', 'items[0].brief.widthIn', 'items[0].brief.notes']) {
    assert.ok(fields.includes(f), `${f} in ${fields.join(', ')}`);
  }
  assert.equal((await ann.post('/api/orders', { target: 'nobody', brief: brief(mine) })).status, 400);
  // A bad request never takes a model from the allowance.
  const used = (await ann.get('/api/orders/allowance')).body.allowance.used;
  assert.equal(used, 1);
  // Someone else's order is a 404, for reading and for acting.
  const o = await newOrder(ann);
  assert.equal((await bob.get(`/api/orders/${o.id}`)).status, 404);
  assert.equal((await bob.post(`/api/orders/${o.id}/cancel`)).status, 404);
  assert.equal((await bob.post(`/api/orders/${o.id}/checkout`)).status, 404);
  assert.equal((await bob.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' })).status, 404);
});

test('demo flow for an order from before: draft → pending_payment → paid; a double complete is idempotent; decline → payment_failed → retry', async () => {
  const ann = await t.user();
  const o = priorOrder(t, ann);
  // Paying a draft directly is refused: checkout comes first.
  assert.equal((await ann.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' })).status, 409);
  const c = await ann.post(`/api/orders/${o.id}/checkout`);
  assert.equal(c.status, 200);
  assert.equal((await ann.get(`/api/orders/${o.id}`)).body.order.status, 'pending_payment');

  const ok1 = await ann.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' });
  assert.equal(ok1.status, 200);
  assert.equal(ok1.body.order.status, 'paid');
  assert.ok(ok1.body.order.paidAt);
  assert.ok(ok1.body.order.dueAt >= ok1.body.order.paidAt + 12 * DAY, 'Standard’s 10 business days are at least 12 calendar days (14 from a weekday, 12 from a Sunday)');
  const ok2 = await ann.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' });
  assert.equal(ok2.status, 200);
  assert.equal(ok2.body.order.paidAt, ok1.body.order.paidAt);
  assert.equal(events(o.id).filter((e) => e === 'paid').length, 1, 'one fulfilment');
  // Paid orders can't be checked out or cancelled again.
  assert.equal((await ann.post(`/api/orders/${o.id}/checkout`)).status, 409);
  assert.equal((await ann.post(`/api/orders/${o.id}/cancel`)).status, 409);

  const o2 = priorOrder(t, ann);
  await ann.post(`/api/orders/${o2.id}/checkout`);
  const dec = await ann.post(`/api/payments/demo/${o2.id}/complete`, { outcome: 'decline' });
  assert.equal(dec.body.order.status, 'payment_failed');
  const retry = await ann.post(`/api/orders/${o2.id}/checkout`);
  assert.equal(retry.status, 200);
  const paid = await ann.post(`/api/payments/demo/${o2.id}/complete`, { outcome: 'success' });
  assert.equal(paid.body.order.status, 'paid');
  assert.deepEqual(events(o2.id), ['created', 'checkout', 'payment_failed', 'checkout', 'paid']);
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM payment_events WHERE provider = 'demo' AND order_id = ?").get(o2.id).n, 2);
  assert.equal((await ann.post(`/api/payments/demo/${o2.id}/complete`, { outcome: 'maybe' })).status, 400);

  const list = await ann.get('/api/orders');
  assert.deepEqual(new Set(list.body.orders.map((x) => x.id)), new Set([o.id, o2.id]));
});

test('without payments a contractor still submits requests; the demo route is refused in production without DEMO_PAYMENTS', async () => {
  const prod = await startTestServer({ env: { PAYMENTS: 'demo', NODE_ENV: 'production' } });
  try {
    // No Stripe and no demo: payments are 'none'. A plan request needs no payment, so it works…
    const pro = await contractor(prod);
    const refs = [(await pro.putRaw('/api/files?kind=reference&name=a.png', makePng(), 'image/png')).body.file.id];
    const created = await pro.post('/api/orders', { brief: brief(refs) });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.body.order.status, 'paid');
    // …while every order-payment endpoint is a 503.
    const c = await pro.post('/api/orders/ord_nothing/checkout');
    assert.deepEqual([c.status, c.body.code], [503, 'payments_unavailable']);
    assert.equal((await pro.post('/api/payments/demo/ord_nothing/complete', { outcome: 'success' })).status, 503);
  } finally {
    await prod.close();
  }
  const allowed = await startTestServer({ env: { PAYMENTS: 'demo', NODE_ENV: 'production', DEMO_PAYMENTS: '1' } });
  try {
    const ann = await allowed.user();
    const o = priorOrder(allowed, ann);
    assert.equal((await ann.post(`/api/orders/${o.id}/checkout`)).status, 200);
    assert.equal((await ann.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' })).body.order.status, 'paid');
  } finally {
    await allowed.close();
  }
});

test('studio routes need the studio role; refunds, revenue and model grants need admin', async () => {
  const ann = await contractor();
  const studio = await t.user({ role: 'studio' });
  const o = await newOrder(ann);
  for (const [m, p] of [
    ['GET', '/api/studio/orders'],
    ['POST', `/api/studio/orders/${o.id}/start`],
    ['POST', `/api/studio/orders/${o.id}/note`],
    ['POST', `/api/studio/orders/${o.id}/deliver`],
    ['POST', `/api/studio/orders/${o.id}/cancel`],
  ]) {
    const r = await ann.request(m, p, m === 'POST' ? { body: { note: 'x' } } : {});
    assert.equal(r.status, 403, `${m} ${p}`);
  }
  assert.equal((await t.agent().get('/api/studio/orders')).status, 401);
  assert.equal((await studio.post(`/api/admin/orders/${o.id}/refund`)).status, 403);
  assert.equal((await studio.get('/api/admin/revenue')).status, 403);
  assert.equal((await ann.get('/api/admin/revenue')).status, 403);
  assert.equal((await studio.post('/api/admin/model-grants', { userId: ann.id, models: 1 })).status, 403);
  assert.equal((await ann.get(`/api/admin/model-allowance?userId=${ann.id}`)).status, 403);
  // The studio can read any order (to fulfil it), sees it in the queue, and where the contractor stands.
  const view = await studio.get(`/api/orders/${o.id}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.buyerAllowance.left, 2);
  assert.equal((await ann.get(`/api/orders/${o.id}`)).body.buyerAllowance, undefined, 'staff only');
  const q = await studio.get('/api/studio/orders');
  assert.ok(q.body.orders.some((x) => x.id === o.id), 'a submitted request is in the active queue');
  assert.equal(q.body.orders.find((x) => x.id === o.id).buyer.email, ann.user.email);
  assert.equal((await studio.get('/api/studio/orders?status=nonsense')).status, 400);
});

test('deliver creates a private product only the buyer sees; its GLB is 404 to others and 200 to the buyer', async () => {
  const ann = await contractor();
  const bob = await t.user();
  const studio = await t.user({ role: 'studio' });
  const o = await newOrder(ann, { target: 'customer' });

  // Deliver before start → 409; start → in_progress assigned to the studio user.
  assert.equal((await studioDeliver(studio, o.id)).status, 409);
  const s = await studio.post(`/api/studio/orders/${o.id}/start`);
  assert.equal(s.body.order.status, 'in_progress');
  assert.equal(s.body.order.assignedTo, studio.id);
  assert.equal(s.body.order.cancellable, false, 'work has started');
  assert.equal((await studio.post(`/api/studio/orders/${o.id}/start`)).status, 409);
  const n = await studio.post(`/api/studio/orders/${o.id}/note`, { note: 'Modelling the knobs now.' });
  assert.equal(n.status, 200);
  assert.equal((await studio.post(`/api/studio/orders/${o.id}/note`, { note: ' ' })).status, 400);

  // A model the studio user didn't upload can't be delivered.
  const annGlb = await ann.putRaw('/api/files?kind=model&name=a.glb', makeGlb(), 'model/gltf-binary');
  const th = await studio.putRaw('/api/files?kind=image&name=t.png', makePng(), 'image/png');
  assert.equal((await studio.post(`/api/studio/orders/${o.id}/deliver`, { modelFileId: annGlb.body.file.id, thumbFileId: th.body.file.id })).status, 400);

  const d = await studioDeliver(studio, o.id, { glb: makeGlb({ w: 0.9, h: 0.914, d: 0.711 }) });
  assert.equal(d.status, 200, d.text);
  assert.equal(d.body.order.status, 'delivered');
  assert.equal(d.body.complete, true);
  assert.ok(d.body.report.warnings.some((w) => /width/.test(w)), 'a model 18% wider than the brief is flagged');
  const pid = d.body.order.deliverableProductId;
  assert.match(pid, /^p_/);
  const row = t.services.products.get(pid);
  assert.equal(row.source, 'custom');
  assert.equal(row.visibility, 'private');
  assert.equal(row.ownerUserId, ann.id);
  assert.equal(row.status, 'published');

  const annCat = await ann.get('/api/catalog');
  const mine = annCat.body.products.find((p) => p.id === pid);
  assert.ok(mine, 'in the buyer’s catalog');
  assert.equal(mine.brand, 'Your model');
  assert.ok(mine.model?.url, 'with its model');
  assert.ok(!(await bob.get('/api/catalog')).body.products.some((p) => p.id === pid), 'not in anyone else’s');
  assert.ok(!(await t.agent().get('/api/catalog')).body.products.some((p) => p.id === pid));

  const glbUrl = mine.model.url;
  assert.match(glbUrl, /^\/api\/files\/f_[a-z0-9]{24}\/content$/);
  const own = await ann.get(glbUrl);
  assert.equal(own.status, 200);
  assert.equal(own.headers.get('cache-control'), 'private, no-store');
  assert.equal((await bob.get(glbUrl)).status, 404);
  assert.equal((await t.agent().get(glbUrl)).status, 404);
  // The delivered files belong to the buyer.
  assert.equal(t.services.files.get(row.spec.modelFileId).ownerUserId, ann.id);

  // The buyer sees the deliverable and the studio's note, but not the plumbing.
  const view = await ann.get(`/api/orders/${o.id}`);
  assert.equal(view.body.deliverables[0].id, pid);
  assert.ok(view.body.events.some((e) => e.type === 'note' && e.note === 'Modelling the knobs now.' && e.by === 'studio'));
  assert.equal(view.body.buyer, undefined);
  assert.equal(view.body.assignee, 'BluModel 3D studio');
  assert.ok(view.body.events.every((e) => !e.data || !('ref' in e.data)));

  const acc = await ann.post(`/api/orders/${o.id}/accept`);
  assert.equal(acc.body.order.status, 'completed');
  assert.equal((await ann.post(`/api/orders/${o.id}/accept`)).status, 409);
});

test('a brand-target request needs membership and delivers a brand draft', async () => {
  const owner = await contractor();
  const outsider = await contractor();
  const studio = await t.user({ role: 'studio' });
  const brand = t.brand(owner, { name: 'Fictional Ovens Co', status: 'active' });
  const refsO = [await refPhoto(outsider)];
  assert.equal((await outsider.post('/api/orders', { target: 'brand', brandId: brand.id, brief: brief(refsO) })).status, 404);
  const refs = [await refPhoto(owner)];
  const r = await owner.post('/api/orders', { target: 'brand', brandId: brand.id, brief: brief(refs) });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.order.brandName, 'Fictional Ovens Co');
  await studio.post(`/api/studio/orders/${r.body.order.id}/start`);
  const d = await studioDeliver(studio, r.body.order.id);
  assert.equal(d.status, 200, d.text);
  const row = t.services.products.get(d.body.order.deliverableProductId);
  assert.equal(row.source, 'brand');
  assert.equal(row.brandId, brand.id);
  assert.equal(row.status, 'draft');
  assert.equal(row.liveSpec, null);
  assert.equal(t.services.files.get(row.spec.modelFileId).brandId, brand.id, 'files belong to the brand');
  assert.ok(!(await owner.get('/api/catalog')).body.products.some((p) => p.id === row.id), 'drafts are not in the catalog');
});

test('a line of products into My catalog: one request, delivered when every product is; UPC-only products; brand and UPC in the description', async () => {
  const pro = await contractor(t, { extra: 6 });
  const refs = [await refPhoto(pro)];
  const piece = (name, w) => ({ brief: brief(refs, { productTypeId: 'base-cabinet', kind: 'base', variant: 'door-drawer', name, widthIn: w, depthIn: 24, heightIn: 34.5 }) });
  const items = [piece('Smith Shaker Base 18', 18), piece('Smith Shaker Base 24', 24), piece('Smith Shaker Base 36', 36)];
  const r = await pro.post('/api/orders', { target: 'contractor', line: 'Smith Shaker', items });
  assert.equal(r.status, 201, r.text);
  const o = r.body.order;
  assert.equal(o.items.length, 3);
  assert.equal(o.amountCents, 0);
  assert.equal(o.title, 'Smith Shaker · 3 products');
  assert.equal(r.body.allowance.used, 3);

  const studio = await t.user({ role: 'studio' });
  await studio.post(`/api/studio/orders/${o.id}/start`);
  for (const i of [2, 0]) {
    const d = await studioDeliver(studio, o.id, { item: i, glb: makeGlb({ w: items[i].brief.widthIn * 0.0254, h: 0.876, d: 0.61 }) });
    assert.equal(d.status, 200, d.text);
    assert.equal(d.body.order.status, 'in_progress', 'not delivered until every item is');
    assert.equal(d.body.complete, false);
  }
  assert.equal((await studioDeliver(studio, o.id, { item: 7 })).status, 400);
  const last = await studioDeliver(studio, o.id, { item: 1, price: 410 });
  assert.equal(last.body.order.status, 'delivered');
  assert.equal(events(o.id).filter((e) => e === 'item_delivered').length, 2);

  const pids = last.body.order.items.map((it) => it.deliverableProductId);
  assert.equal(new Set(pids).size, 3);
  for (const pid of pids) {
    const row = t.services.products.get(pid);
    assert.equal(row.source, 'contractor');
    assert.equal(row.visibility, 'private');
    assert.equal(row.ownerUserId, pro.id);
    assert.equal(row.spec.line, 'Smith Shaker');
    assert.equal(row.status, 'published', 'live in My catalog');
  }
  assert.equal(t.services.products.get(pids[1]).spec.price, 410);
  const other = await t.user();
  assert.ok(!(await other.get('/api/catalog')).body.products.some((p) => pids.includes(p.id)));
  assert.equal((await pro.put('/api/pro/profile', { company: 'Smith Kitchens (Test)', phone: '905-555-0100' })).status, 200);
  const mine = await pro.get('/api/pro/products');
  assert.equal(mine.status, 200, mine.text);
  for (const pid of pids) assert.ok(mine.body.products.some((p) => p.id === pid), `${pid} in My catalog`);
  const edit = await pro.patch(`/api/pro/products/${pids[0]}`, { spec: { price: 365 }, revision: t.services.products.get(pids[0]).revision });
  assert.equal(edit.status, 200, `the contractor can edit a delivered model like any of their products: ${edit.text}`);

  // Products identified by UPC alone, no photos or sizes; delivered with the model's size and the
  // brand and UPC in the description.
  const upcs = ['036000291452', '4006381333931', '96385074'];
  const line = upcs.map((upc, i) => ({ brief: { productTypeId: 'base-cabinet', kind: 'base', variant: 'door-drawer', name: `Harbor Base ${12 + 3 * i}`, brand: 'Harbor Cabinets (Test)', upc, notes: '', referenceFileIds: [] } }));
  const h = await pro.post('/api/orders', { target: 'contractor', line: 'Harbor Shaker', items: line });
  assert.equal(h.status, 201, h.text);
  assert.deepEqual(h.body.order.items.map((it) => it.brief.upc), upcs);
  const row = (await studio.get('/api/studio/orders?status=all')).body.orders.find((x) => x.id === h.body.order.id);
  assert.deepEqual(row.items.map((it) => it.brief.upc), upcs);
  assert.equal((await studio.post(`/api/studio/orders/${h.body.order.id}/start`)).status, 200);
  const d = await studioDeliver(studio, h.body.order.id, { item: 2, glb: makeGlb({ w: 36 * 0.0254, h: 34.5 * 0.0254, d: 24 * 0.0254 }) });
  assert.equal(d.status, 200, d.text);
  const p = t.services.products.get(d.body.product.id);
  assert.equal(p.source, 'contractor');
  assert.deepEqual([p.spec.widthIn, p.spec.heightIn, p.spec.depthIn].map(Math.round), [36, 35, 24]);
  assert.match(p.spec.blurb, /Brand: Harbor Cabinets \(Test\) · UPC 96385074\./);
  // And as structured fields, which link the model to a retail listing with the same UPC.
  assert.deepEqual([p.spec.brand, p.spec.upc], ['Harbor Cabinets (Test)', '96385074']);
  const wire = t.services.products.toWire(p);
  assert.deepEqual([wire.productBrand, wire.upc], ['Harbor Cabinets (Test)', '96385074']);
});

test('two revision rounds, then no more; a redelivery updates the same product', async () => {
  const ann = await contractor();
  const studio = await t.user({ role: 'studio' });
  const o = await newOrder(ann);
  await studio.post(`/api/studio/orders/${o.id}/start`);
  const first = await studioDeliver(studio, o.id);
  const pid = first.body.order.deliverableProductId;
  const firstModel = t.services.products.get(pid).spec.modelFileId;
  assert.equal((await ann.post(`/api/orders/${o.id}/revision`, { note: '' })).status, 400, 'a revision needs a note');
  for (let round = 1; round <= 2; round++) {
    const rev = await ann.post(`/api/orders/${o.id}/revision`, { note: `Round ${round}: knobs should be brass.` });
    assert.equal(rev.status, 200, rev.text);
    assert.equal(rev.body.order.status, 'revision_requested');
    assert.equal(rev.body.order.revisionsUsed, round);
    assert.equal((await studioDeliver(studio, o.id)).status, 409, 'start the revision first');
    await studio.post(`/api/studio/orders/${o.id}/start`);
    const again = await studioDeliver(studio, o.id, { glb: makeGlb({ w: 0.762, h: 0.914, d: 0.711, materials: ['blumodel_finish', `rev${round}`] }) });
    assert.equal(again.body.order.status, 'delivered');
    assert.equal(again.body.order.deliverableProductId, pid, 'same product');
  }
  assert.notEqual(t.services.products.get(pid).spec.modelFileId, firstModel, 'the model was replaced');
  assert.equal(t.services.products.get(pid).status, 'published');
  const third = await ann.post(`/api/orders/${o.id}/revision`, { note: 'One more?' });
  assert.equal(third.status, 409);
  assert.equal(third.body.error, 'Both revision rounds have been used.');
  // The first delivery date is kept for turnaround, and revisions never take another model.
  assert.equal(t.db.prepare('SELECT delivered_at FROM orders WHERE id = ?').get(o.id).delivered_at, first.body.order.deliveredAt);
  assert.equal((await ann.get('/api/orders/allowance')).body.allowance.used, 1);
});

test('an order from before can be cancelled only before payment', async () => {
  const ann = await t.user();
  const o = priorOrder(t, ann);
  const c = await ann.post(`/api/orders/${o.id}/cancel`);
  assert.equal(c.body.order.status, 'cancelled');
  assert.equal((await ann.post(`/api/orders/${o.id}/checkout`)).status, 409);
  assert.equal((await ann.post(`/api/orders/${o.id}/cancel`)).status, 409);
  const o2 = priorOrder(t, ann);
  await ann.post(`/api/orders/${o2.id}/checkout`);
  assert.equal((await ann.post(`/api/orders/${o2.id}/cancel`)).body.order.status, 'cancelled', 'pending payment can be cancelled');
  const o3 = priorOrder(t, ann);
  await demoPay(ann, o3.id);
  assert.equal((await ann.post(`/api/orders/${o3.id}/cancel`)).status, 409);
});

test('unpaid orders from before expire 24 hours after checkout started (on read)', async () => {
  const t0 = Date.now();
  t.setNow(t0);
  try {
    const ann = await t.user();
    const draft = priorOrder(t, ann);
    const pending = priorOrder(t, ann);
    t.setNow(t0 + 20 * 3_600_000);
    await ann.post(`/api/orders/${pending.id}/checkout`); // restarts its 24 h window
    t.setNow(t0 + 25 * 3_600_000);
    const list = (await ann.get('/api/orders')).body.orders;
    assert.equal(list.find((x) => x.id === draft.id).status, 'expired');
    assert.equal(list.find((x) => x.id === pending.id).status, 'pending_payment');
    assert.equal(list.find((x) => x.id === pending.id).expiresAt, t0 + 44 * 3_600_000);
    t.setNow(t0 + 45 * 3_600_000);
    assert.equal((await ann.get(`/api/orders/${pending.id}`)).body.order.status, 'expired');
    assert.equal((await ann.post(`/api/payments/demo/${pending.id}/complete`, { outcome: 'success' })).status, 409);
    assert.equal((await ann.post(`/api/orders/${pending.id}/checkout`)).status, 409);
    assert.ok(events(draft.id).includes('expired'));
  } finally {
    t.setNow(null);
  }
});

test('refund marks a paid order refunded and archives the custom product; refunded twice is a 409', async () => {
  const ann = await t.user();
  const studio = await t.user({ role: 'studio' });
  const admin = await t.user({ role: 'admin' });
  const o = priorOrder(t, ann);
  await demoPay(ann, o.id);
  await studio.post(`/api/studio/orders/${o.id}/start`);
  const d = await studioDeliver(studio, o.id);
  const pid = d.body.order.deliverableProductId;
  assert.ok((await ann.get('/api/catalog')).body.products.some((p) => p.id === pid));

  const r = await admin.post(`/api/admin/orders/${o.id}/refund`, { note: 'Customer changed their mind.' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.order.status, 'refunded');
  assert.ok(r.body.order.refundedAt);
  assert.equal(t.services.products.get(pid).status, 'archived');
  assert.ok(!(await ann.get('/api/catalog')).body.products.some((p) => p.id === pid), 'its live catalog entry is gone');
  assert.equal((await admin.post(`/api/admin/orders/${o.id}/refund`)).status, 409);
  // Unpaid orders can't be refunded.
  const o2 = priorOrder(t, ann);
  assert.equal((await admin.post(`/api/admin/orders/${o2.id}/refund`)).status, 409);
});

test('revenue: orders paid before (gross, refunds, net, by tier, by day, turnaround), demo apart from Stripe; plan requests never count', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const t0 = Date.UTC(2026, 8, 1, 15); // a Tuesday
    s.setNow(t0);
    const ann = await s.user();
    const studio = await s.user({ role: 'studio' });
    const admin = await s.user({ role: 'admin' });
    const a = priorOrder(s, ann, { tier: 'simple', amountCents: 12_900 });
    const b = priorOrder(s, ann, { tier: 'standard', amountCents: 27_900, items: 2 });
    const c = priorOrder(s, ann, { tier: 'complex', amountCents: 54_900 });
    for (const o of [a, b, c]) {
      await ann.post(`/api/orders/${o.id}/checkout`);
      await ann.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' });
    }
    s.setNow(t0 + 3 * DAY);
    await studio.post(`/api/studio/orders/${a.id}/start`);
    const m = await studio.putRaw('/api/files?kind=model&name=m.glb', makeGlb(), 'model/gltf-binary');
    const th = await studio.putRaw('/api/files?kind=image&name=t.png', makePng(), 'image/png');
    assert.equal((await studio.post(`/api/studio/orders/${a.id}/deliver`, { modelFileId: m.body.file.id, thumbFileId: th.body.file.id })).status, 200);
    s.setNow(t0 + 5 * DAY);
    assert.equal((await admin.post(`/api/admin/orders/${c.id}/refund`)).status, 200);
    // An unpaid draft and a plan request never count.
    priorOrder(s, ann);
    const pro = await contractor(s);
    const ref = (await pro.putRaw('/api/files?kind=reference&name=a.png', makePng(), 'image/png')).body.file.id;
    assert.equal((await pro.post('/api/orders', { brief: brief([ref]) })).status, 201);

    const r = await admin.get('/api/admin/revenue?days=30');
    assert.equal(r.status, 200);
    assert.equal(r.body.provider, 'demo');
    assert.equal(r.body.gross, 12_900 + 55_800 + 54_900);
    assert.equal(r.body.refunds, 54_900);
    assert.equal(r.body.net, 12_900 + 55_800);
    assert.equal(r.body.count, 3);
    assert.equal(r.body.refundCount, 1);
    assert.deepEqual(r.body.byTier, [
      { tier: 'pack', items: 0, gross: 0 },
      { tier: 'simple', items: 1, gross: 12_900 },
      { tier: 'standard', items: 2, gross: 55_800 },
      { tier: 'complex', items: 1, gross: 54_900 },
    ]);
    assert.equal(r.body.avgTurnaroundDays, 3);
    assert.equal(r.body.byDay.length, 31);
    assert.deepEqual(r.body.byDay.find((d) => d.day === '2026-09-01'), { day: '2026-09-01', gross: 123_600, refunds: 0, count: 3 });
    assert.equal(r.body.byDay.find((d) => d.day === '2026-09-06').refunds, 54_900);
    assert.equal(r.body.byProvider.stripe.gross, 0);
    assert.equal(r.body.byProvider.demo.gross, r.body.gross);
    // Outside the window: nothing.
    s.setNow(t0 + 100 * DAY);
    // Sessions last 30 days: sign in again after the time jump.
    assert.equal((await s.signIn(admin)).status, 200);
    const later = await admin.get('/api/admin/revenue?days=30');
    assert.equal(later.status, 200);
    assert.equal(later.body.gross, 0);
    assert.equal(later.body.avgTurnaroundDays, null);
  } finally {
    await s.close();
  }
});

test('the seed creates paid, in-progress, delivered and completed demo orders from before, and the demo contractor’s included request, idempotently', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const customer = await s.user({ email: 'demo-customer@blumodel.test' });
    await s.user({ email: 'demo-studio@blumodel.test', role: 'studio' });
    const pro = await contractor(s, { email: 'demo-brand@blumodel.test' });
    const ctx = { db: s.db, config: s.config, services: s.services, now: s.ctx.now };
    const first = await seed(ctx);
    const second = await seed(ctx);
    assert.equal(first.created, 5, JSON.stringify(first));
    assert.equal(second.created, 0, 'idempotent');
    const statuses = s.db.prepare("SELECT status FROM orders WHERE provider = 'demo' ORDER BY id").all().map((r) => r.status).sort();
    for (const st of ['paid', 'in_progress', 'delivered', 'completed']) assert.ok(statuses.includes(st), st);
    assert.deepEqual(s.db.prepare("SELECT DISTINCT tier, currency FROM orders WHERE provider = 'demo'").all().map((r) => ({ ...r })), [{ tier: 'standard', currency: 'usd' }]);
    const list = (await customer.get('/api/orders')).body.orders;
    assert.equal(list.length, statuses.length);
    const delivered = list.find((o) => o.status === 'delivered');
    assert.ok(delivered.deliverableProductId);
    assert.ok((await customer.get('/api/catalog')).body.products.some((p) => p.id === delivered.deliverableProductId), 'the fixture deliverable is the customer’s private product');
    // The contractor's request is included in the plan and leaves 2 of 3.
    const mine = await pro.get('/api/orders');
    assert.deepEqual(mine.body.orders.map((o) => [o.pricing, o.status, o.amountCents]), [['plan', 'paid', 0]]);
    assert.equal(mine.body.allowance.left, 2);
    // Without the demo users there is nothing to seed, and it says so.
    const empty = await startTestServer({ env: { PAYMENTS: 'demo' } });
    try {
      const r = await seed({ db: empty.db, config: empty.config, services: empty.services, now: empty.ctx.now });
      assert.equal(r.created, 0);
      assert.ok(r.skipped);
    } finally {
      await empty.close();
    }
  } finally {
    await s.close();
  }
});
