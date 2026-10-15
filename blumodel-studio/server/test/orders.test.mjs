// Package C (orders): paid custom models end to end with the DEMO provider, the studio
// queue, delivery into private / brand / contractor products, revisions, refunds, expiry,
// revenue and the seed. Stripe-specific behaviour is in payments.test.mjs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { makeGlb } from './fixtures/glb.mjs';
import { makePng } from './fixtures/images.mjs';
import { seed } from '../seed/orders.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { MIGRATION_MODULES, MIGRATION_KEYS } from '../db/migrations/index.mjs';
import { quote, packsFor, packBusinessDays, legacyQuote, MAX_ITEMS, PACK } from '../payments/tiers.mjs';
import { normalizeUpc, gs1CheckDigit } from '../payments/upc.mjs';

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

async function newOrder(agent, body = {}) {
  const refs = body.refs ?? [await refPhoto(agent)];
  const r = await agent.post('/api/orders', { target: 'customer', brief: brief(refs, body.brief), tier: 'standard', extraFinishes: 0, ...body.extra });
  assert.equal(r.status, 201, r.text);
  return r.body.order;
}

/** Checkout + "Simulate successful payment". */
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

test('the Model pack is public and the quote is the server’s: client amounts and old tiers are ignored', async () => {
  const anon = t.agent();
  const tiers = await anon.get('/api/orders/tiers');
  assert.equal(tiers.status, 200);
  assert.equal(tiers.body.pricing, 'pack');
  const p = tiers.body.pack;
  assert.deepEqual([p.id, p.priceCents, p.productsPerPack, p.finishesPerModel, p.revisions], ['pack', 12_900, 8, 3, 2]);
  assert.equal(tiers.body.rushPct, 50);
  assert.equal(tiers.body.maxItems, 40);
  assert.equal(tiers.body.payments, 'demo');
  // The retired tiers are gone from what new requests are offered.
  assert.deepEqual(tiers.body.tiers.map((x) => x.id), ['pack']);

  const q = await anon.post('/api/orders/quote', { products: 9, rush: true, amountCents: 1 });
  assert.equal(q.status, 200);
  // 9 products are 2 packs: 2 × $129, rush +50% each → $387; 15 + 5 business days, halved → 10.
  assert.equal(q.body.quote.amountCents, 38_700);
  assert.equal(q.body.quote.packs, 2);
  assert.equal(q.body.quote.dueBusinessDays, 10);
  // A page from before packs still gets a price: its tier and extra finishes don't change it.
  assert.equal((await anon.post('/api/orders/quote', { tier: 'complex', extraFinishes: 3 })).body.quote.amountCents, 12_900);
  assert.equal((await anon.post('/api/orders/quote', { products: 41 })).status, 400);
  assert.equal((await anon.post('/api/orders/quote', { products: 0 })).status, 400);

  const ann = await t.user();
  const refs = [await refPhoto(ann)];
  const r = await ann.post('/api/orders', { target: 'customer', brief: brief(refs), tier: 'complex', extraFinishes: 4, amountCents: 100, amount: 1, price: 1, quote: { amountCents: 1 } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.order.amountCents, 12_900, 'one product is one pack, whatever tier the client names');
  assert.equal(r.body.order.tier, 'pack');
  assert.equal(r.body.order.pricing, 'pack');
  assert.equal(r.body.order.status, 'draft');
  assert.equal(r.body.quote.amountCents, r.body.order.amountCents);
  assert.equal(r.body.order.provider, 'demo');
  assert.match(r.body.order.id, /^o_[a-z0-9]{24}$/);
  // Anonymous users can't order.
  assert.equal((await anon.post('/api/orders', { brief: brief(refs), tier: 'simple' })).status, 401);
});

test('Model pack quote math: 1–8 products one pack, 9–16 two, rush +50% for half the days, shares add up', () => {
  assert.equal(PACK.priceCents, 12_900);
  for (const [n, packs] of [[1, 1], [8, 1], [9, 2], [16, 2], [17, 3], [40, 5]]) {
    assert.equal(packsFor(n), packs, `${n} products`);
    const q = quote({ products: n });
    assert.equal(q.packs, packs);
    assert.equal(q.amountCents, packs * 12_900, `${n} products cost ${packs} packs`);
    assert.equal(q.items.length, n);
    assert.equal(q.items.reduce((s, it) => s + it.amountCents, 0), q.amountCents, 'item shares add up to the total');
    assert.equal(q.lines.reduce((s, l) => s + l.amountCents, 0), q.amountCents, 'receipt lines add up to the total');
    assert.equal(q.dueBusinessDays, 15 + (packs - 1) * 5);
  }
  // A pack costs the same with 1 product or 8.
  assert.equal(quote({ products: 1 }).amountCents, quote({ products: 8 }).amountCents);
  // Rush: +50% on each pack, half the turnaround rounded up.
  const r = quote({ products: 9, rush: true });
  assert.equal(r.amountCents, 2 * 19_350);
  assert.equal(r.rushCents, 2 * 6_450);
  assert.equal(r.dueBusinessDays, 10);
  assert.equal(packBusinessDays(1, true), 8, '15 halved, rounded up');
  assert.deepEqual(r.lines.map((l) => l.label), ['Model pack 1 of 2: 8 products', 'Model pack 2 of 2: 1 product', 'Rush (+50%, half the turnaround)']);
  // Counts outside 1..40 are refused; only the number of items matters, never a tier.
  assert.throws(() => quote({ products: 0 }));
  assert.throws(() => quote({ products: MAX_ITEMS + 1 }));
  assert.throws(() => quote({ products: 2.5 }));
  assert.equal(quote({ items: [{ tier: 'complex', extraFinishes: 3 }] }).amountCents, 12_900);
  // A pre-pack order's quote is rebuilt from its stored amounts, never re-priced.
  const lq = legacyQuote({ items: [{ tier: 'standard', extraFinishes: 1, amountCents: 31_800, name: 'Range' }], amountCents: 31_800 });
  assert.equal(lq.pricing, 'tiers');
  assert.equal(lq.amountCents, 31_800);
  assert.equal(lq.dueBusinessDays, 10);
  assert.deepEqual(lq.lines, [{ label: 'Standard model: Range, 1 extra finish', amountCents: 31_800, item: 0 }]);
});

test('orders placed before Model packs keep their stored prices: the migration copies them and checkout charges them', async () => {
  // 1. The migration (orders-002) keeps every row, price, status and event of an older database.
  const db = openDb(':memory:');
  const upToOrders001 = MIGRATION_MODULES.map((m, i) => (MIGRATION_KEYS[i] === 'orders' ? { steps: m.steps.filter((s) => s.id === 'orders-001-orders') } : m));
  migrate(db, { modules: upToOrders001 });
  const ts = Date.UTC(2026, 9, 1);
  db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u_legacybuyer', 'old@example.test', 'Old buyer', 'x', ?)").run(ts);
  const insOrder = db.prepare(
    `INSERT INTO orders (id, user_id, target, status, tier, extras, amount_cents, currency, provider, brief, pending_since, created_at, updated_at, paid_at)
     VALUES (?, 'u_legacybuyer', 'customer', ?, ?, ?, ?, 'usd', 'demo', '{"name":"Old"}', ?, ?, ?, ?)`,
  );
  insOrder.run('o_legacyorder0000000000001', 'paid', 'complex', '{"rush":true,"extraFinishes":0}', 82_350, ts, ts, ts, ts);
  insOrder.run('o_legacyorder0000000000002', 'draft', 'simple', '{"rush":false,"extraFinishes":0}', 12_900, ts, ts, ts, null);
  db.prepare("INSERT INTO order_items (order_id, idx, brief, tier, extra_finishes, amount_cents) VALUES ('o_legacyorder0000000000001', 0, '{\"name\":\"Old\"}', 'complex', 0, 82350)").run();
  db.prepare("INSERT INTO order_events (order_id, type, to_status, created_at) VALUES ('o_legacyorder0000000000001', 'paid', 'paid', ?)").run(ts);
  assert.deepEqual(migrate(db), ['orders-002-model-pack']);
  const rows = db.prepare('SELECT id, status, tier, amount_cents FROM orders ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { id: 'o_legacyorder0000000000001', status: 'paid', tier: 'complex', amount_cents: 82_350 },
    { id: 'o_legacyorder0000000000002', status: 'draft', tier: 'simple', amount_cents: 12_900 },
  ]);
  assert.equal(db.prepare('SELECT amount_cents FROM order_items WHERE order_id = ?').get('o_legacyorder0000000000001').amount_cents, 82_350);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM order_events').get().n, 1, 'events survive the rebuild');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  // New rows can be packs now; the old CHECK would have refused 'pack'.
  db.prepare("UPDATE orders SET tier = 'pack' WHERE id = 'o_legacyorder0000000000002'").run();
  db.close();

  // 2. Through the API: an old order reads, pays and dates at its own price and tier.
  const ann = await t.user();
  const now = Date.now();
  const id = 'o_legacyorder0000000000003';
  t.db
    .prepare(
      `INSERT INTO orders (id, user_id, target, status, tier, extras, amount_cents, currency, provider, brief, pending_since, created_at, updated_at)
       VALUES (?, ?, 'customer', 'draft', 'standard', '{"rush":false,"extraFinishes":1}', 31800, 'usd', 'demo', ?, ?, ?, ?)`,
    )
    .run(id, ann.user.id, JSON.stringify(brief([])), now, now, now);
  t.db.prepare("INSERT INTO order_items (order_id, idx, brief, tier, extra_finishes, amount_cents) VALUES (?, 0, ?, 'standard', 1, 31800)").run(id, JSON.stringify(brief([])));
  const g = await ann.get(`/api/orders/${id}`);
  assert.equal(g.status, 200, g.text);
  assert.equal(g.body.order.amountCents, 31_800);
  assert.equal(g.body.order.pricing, 'tiers');
  assert.equal(g.body.order.quote.amountCents, 31_800);
  assert.deepEqual(g.body.order.quote.lines.map((l) => l.label), ['Standard model: My Old Range, 1 extra finish']);
  const paid = await demoPay(ann, id);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.amountCents, 31_800);
  const row = t.db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  assert.equal(row.amount_cents, 31_800);
  assert.equal(row.tier, 'standard', 'still an old-tier order');
  assert.equal(row.due_at - row.paid_at > 0, true);

  // 3. A pack order keeps the price stored when it was made, even if the pack price changes later
  //    (simulated by storing a different price on it, as an older price would have been).
  const o = await newOrder(ann);
  assert.equal(o.amountCents, 12_900);
  const ex = JSON.parse(t.db.prepare('SELECT extras FROM orders WHERE id = ?').get(o.id).extras);
  assert.equal(ex.quote.lines[0].amountCents, 12_900, 'the quote lines are stored with the order');
  ex.quote.lines[0].amountCents = 9_900;
  t.db.prepare('UPDATE orders SET amount_cents = 9900, extras = ? WHERE id = ?').run(JSON.stringify(ex), o.id);
  t.db.prepare('UPDATE order_items SET amount_cents = 9900 WHERE order_id = ?').run(o.id);
  const again = (await ann.get(`/api/orders/${o.id}`)).body.order;
  assert.equal(again.amountCents, 9_900);
  assert.equal(again.quote.lines[0].amountCents, 9_900);
  const p2 = await demoPay(ann, o.id);
  assert.equal(p2.status, 'paid', 'paid at its stored price, not re-quoted at today’s');
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

test('the product list: brand, UPC, optional size, barcode photos, ownership, identification and pack limits', async () => {
  const ann = await t.user();
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
  assert.equal(r.body.order.amountCents, 12_900);

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

  // Pack limits: 9 products are 2 packs (one checkout); 40 is the most one request holds.
  const nine = Array.from({ length: 9 }, (_, i) => product({ name: `Cabinet ${i + 1}`, upc: '4006381333931' }));
  const o9 = await ann.post('/api/orders', { items: nine, line: 'Harbor Shaker' });
  assert.equal(o9.status, 201, o9.text);
  assert.equal(o9.body.order.amountCents, 25_800);
  assert.equal(o9.body.order.packs, 2);
  assert.deepEqual(o9.body.order.items.map((it) => it.pack), [1, 1, 1, 1, 1, 1, 1, 1, 2]);
  assert.equal((await ann.post('/api/orders', { items: Array.from({ length: 40 }, () => product({ upc: '96385074' })) })).status, 201);
  const big = await ann.post('/api/orders', { items: Array.from({ length: 41 }, () => product({ upc: '96385074' })) });
  assert.equal(big.status, 400);
  assert.match(big.body.errors[0].message, /up to 40 products/);
  assert.equal((await ann.post('/api/orders', { items: [] })).status, 400);

  // The studio queue shows each product's UPC; delivery without a size uses the model's size.
  await demoPay(ann, r.body.order.id);
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
  const ann = await t.user();
  const bob = await t.user();
  const bobs = await refPhoto(bob);
  const r1 = await ann.post('/api/orders', { brief: brief([bobs]), tier: 'standard' });
  assert.equal(r1.status, 400);
  assert.ok(r1.body.errors.some((e) => e.field === 'items[0].brief.referenceFileIds'));

  // An image upload (kind image) is not a reference.
  const img = await ann.putRaw('/api/files?kind=image&name=x.png', makePng(), 'image/png');
  assert.equal((await ann.post('/api/orders', { brief: brief([img.body.file.id]), tier: 'standard' })).status, 400);
  // No reference at all, and no reference product.
  const none = await ann.post('/api/orders', { brief: brief([]), tier: 'standard' });
  assert.equal(none.status, 400);
  assert.ok(none.body.errors.some((e) => /at least one reference/.test(e.message)));
  // A catalog product is enough of a reference.
  assert.equal((await ann.post('/api/orders', { brief: brief([], { refProductId: 'range-30' }), tier: 'standard' })).status, 201);
  // Nine photos is one too many.
  const nine = [];
  for (let i = 0; i < 9; i++) nine.push(await refPhoto(ann, [i * 20, 10, 10, 255]));
  assert.equal((await ann.post('/api/orders', { brief: brief(nine), tier: 'standard' })).status, 400);

  const mine = [await refPhoto(ann)];
  const bad = await ann.post('/api/orders', {
    brief: brief(mine, { kind: 'spaceship', name: '', widthIn: 0, notes: 'x'.repeat(4001) }),
    tier: 'platinum',
    extraFinishes: -1,
  });
  assert.equal(bad.status, 400);
  const fields = bad.body.errors.map((e) => e.field);
  for (const f of ['items[0].brief.kind', 'items[0].brief.name', 'items[0].brief.widthIn', 'items[0].brief.notes']) {
    assert.ok(fields.includes(f), `${f} in ${fields.join(', ')}`);
  }
  assert.equal((await ann.post('/api/orders', { target: 'nobody', brief: brief(mine), tier: 'simple' })).status, 400);
  // Someone else's order is a 404, for reading and for acting.
  const o = await newOrder(ann);
  assert.equal((await bob.get(`/api/orders/${o.id}`)).status, 404);
  assert.equal((await bob.post(`/api/orders/${o.id}/checkout`)).status, 404);
  assert.equal((await bob.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' })).status, 404);
});

test('demo flow: draft → pending_payment → paid; a double complete is idempotent; decline → payment_failed → retry', async () => {
  const ann = await t.user();
  const o = await newOrder(ann);
  // Paying a draft directly is refused: checkout comes first.
  assert.equal((await ann.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' })).status, 409);
  const c = await ann.post(`/api/orders/${o.id}/checkout`);
  assert.equal(c.status, 200);
  assert.equal((await ann.get(`/api/orders/${o.id}`)).body.order.status, 'pending_payment');

  const ok1 = await ann.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' });
  assert.equal(ok1.status, 200);
  assert.equal(ok1.body.order.status, 'paid');
  assert.ok(ok1.body.order.paidAt);
  assert.ok(ok1.body.order.dueAt >= ok1.body.order.paidAt + 21 * DAY, 'a pack’s 15 business days are at least 21 calendar days');
  const ok2 = await ann.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' });
  assert.equal(ok2.status, 200);
  assert.equal(ok2.body.order.paidAt, ok1.body.order.paidAt);
  assert.equal(events(o.id).filter((e) => e === 'paid').length, 1, 'one fulfilment');
  // Paid orders can't be checked out or cancelled again.
  assert.equal((await ann.post(`/api/orders/${o.id}/checkout`)).status, 409);
  assert.equal((await ann.post(`/api/orders/${o.id}/cancel`)).status, 409);

  const o2 = await newOrder(ann);
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

test('the demo route is refused in production without DEMO_PAYMENTS, and allowed with it', async () => {
  const prod = await startTestServer({ env: { PAYMENTS: 'demo', NODE_ENV: 'production' } });
  try {
    // No Stripe and no demo: payments are 'none', and every order-payment endpoint is a 503.
    const ann = await prod.user();
    const refs = [(await ann.putRaw('/api/files?kind=reference&name=a.png', makePng(), 'image/png')).body.file.id];
    const created = await ann.post('/api/orders', { brief: brief(refs), tier: 'simple' });
    assert.equal(created.status, 503);
    assert.equal(created.body.code, 'payments_unavailable');
    const c = await ann.post('/api/orders/ord_nothing/checkout');
    assert.deepEqual([c.status, c.body.code], [503, 'payments_unavailable']);
    assert.equal((await ann.post('/api/payments/demo/ord_nothing/complete', { outcome: 'success' })).status, 503);
    assert.equal(prod.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
  } finally {
    await prod.close();
  }
  const allowed = await startTestServer({ env: { PAYMENTS: 'demo', NODE_ENV: 'production', DEMO_PAYMENTS: '1' } });
  try {
    const ann = await allowed.user();
    const refs = [(await ann.putRaw('/api/files?kind=reference&name=a.png', makePng(), 'image/png')).body.file.id];
    const o = (await ann.post('/api/orders', { brief: brief(refs), tier: 'simple' })).body.order;
    assert.equal((await ann.post(`/api/orders/${o.id}/checkout`)).status, 200);
    assert.equal((await ann.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' })).body.order.status, 'paid');
  } finally {
    await allowed.close();
  }
});

test('studio routes need the studio role; refunds and revenue need admin', async () => {
  const ann = await t.user();
  const studio = await t.user({ role: 'studio' });
  const o = await newOrder(ann);
  await demoPay(ann, o.id);
  for (const [m, p] of [
    ['GET', '/api/studio/orders'],
    ['POST', `/api/studio/orders/${o.id}/start`],
    ['POST', `/api/studio/orders/${o.id}/note`],
    ['POST', `/api/studio/orders/${o.id}/deliver`],
  ]) {
    const r = await ann.request(m, p, m === 'POST' ? { body: { note: 'x' } } : {});
    assert.equal(r.status, 403, `${m} ${p}`);
  }
  assert.equal((await t.agent().get('/api/studio/orders')).status, 401);
  assert.equal((await studio.post(`/api/admin/orders/${o.id}/refund`)).status, 403);
  assert.equal((await studio.get('/api/admin/revenue')).status, 403);
  assert.equal((await ann.get('/api/admin/revenue')).status, 403);
  // The studio can read any order (to fulfil it) and sees it in the queue.
  assert.equal((await studio.get(`/api/orders/${o.id}`)).status, 200);
  const q = await studio.get('/api/studio/orders');
  assert.ok(q.body.orders.some((x) => x.id === o.id));
  assert.equal(q.body.orders.find((x) => x.id === o.id).buyer.email, ann.user.email);
  assert.equal((await studio.get('/api/studio/orders?status=nonsense')).status, 400);
});

test('deliver creates a private product only the buyer sees; its GLB is 404 to others and 200 to the buyer', async () => {
  const ann = await t.user();
  const bob = await t.user();
  const studio = await t.user({ role: 'studio' });
  const o = await newOrder(ann);
  await demoPay(ann, o.id);

  // Deliver before start → 409; start → in_progress assigned to the studio user.
  assert.equal((await studioDeliver(studio, o.id)).status, 409);
  const s = await studio.post(`/api/studio/orders/${o.id}/start`);
  assert.equal(s.body.order.status, 'in_progress');
  assert.equal(s.body.order.assignedTo, studio.id);
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

  // The customer sees the deliverable and the studio's note, but not payment plumbing.
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

test('a brand-target order needs membership and delivers a brand draft', async () => {
  const owner = await t.user();
  const outsider = await t.user();
  const studio = await t.user({ role: 'studio' });
  const brand = t.brand(owner, { name: 'Fictional Ovens Co', status: 'active' });
  const refsO = [await refPhoto(outsider)];
  assert.equal((await outsider.post('/api/orders', { target: 'brand', brandId: brand.id, brief: brief(refsO), tier: 'standard' })).status, 404);
  const refs = [await refPhoto(owner)];
  const r = await owner.post('/api/orders', { target: 'brand', brandId: brand.id, brief: brief(refs), tier: 'standard' });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.order.brandName, 'Fictional Ovens Co');
  await demoPay(owner, r.body.order.id);
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

test('contractor target: plan required; one checkout for a multi-item line, delivered when every item is', async () => {
  const pro = await t.user();
  const refs = [await refPhoto(pro)];
  const denied = await pro.post('/api/orders', { target: 'contractor', brief: brief(refs), tier: 'simple' });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.needs, 'contractor');

  // Become a contractor through billing's DEMO checkout.
  const c = await pro.post('/api/billing/checkout', { kind: 'subscription', plan: 'contractor' });
  assert.equal(c.status, 200, c.text);
  assert.equal((await pro.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' })).status, 200);

  const piece = (name, w) => ({ brief: brief(refs, { productTypeId: 'base-cabinet', kind: 'base', variant: 'door-drawer', name, widthIn: w, depthIn: 24, heightIn: 34.5 }) });
  const items = [piece('Smith Shaker Base 18', 18), piece('Smith Shaker Base 24', 24), piece('Smith Shaker Base 36', 36)];
  const tooMany = await pro.post('/api/orders', { target: 'contractor', line: 'Smith Shaker', items: Array.from({ length: 41 }, () => items[0]) });
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.errors[0].message, /up to 40 products/);
  const r = await pro.post('/api/orders', { target: 'contractor', line: 'Smith Shaker', rush: false, items });
  assert.equal(r.status, 201, r.text);
  const o = r.body.order;
  assert.equal(o.items.length, 3);
  assert.equal(o.amountCents, 12_900, 'three products fit in one Model pack');
  assert.equal(o.packs, 1);
  assert.deepEqual(o.items.map((it) => it.pack), [1, 1, 1]);
  assert.equal(o.items.reduce((s, it) => s + it.amountCents, 0), o.amountCents, 'the items’ shares add up to the price');
  assert.equal(o.title, 'Smith Shaker · 3 products');

  const studio = await t.user({ role: 'studio' });
  await demoPay(pro, o.id);
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
  const cat = (await pro.get('/api/catalog')).body.products.filter((p) => pids.includes(p.id));
  assert.equal(cat.length, 3, 'all three in the contractor’s catalog');
  const other = await t.user();
  assert.ok(!(await other.get('/api/catalog')).body.products.some((p) => pids.includes(p.id)));
  // My catalog lists them, and their files are the contractor's own, so they can edit them.
  assert.equal((await pro.put('/api/pro/profile', { company: 'Smith Kitchens (Test)' })).status, 200);
  const mine = await pro.get('/api/pro/products');
  assert.equal(mine.status, 200, mine.text);
  for (const pid of pids) assert.ok(mine.body.products.some((p) => p.id === pid), `${pid} in My catalog`);
  assert.equal(t.services.files.get(t.services.products.get(pids[0]).spec.modelFileId).ownerUserId, pro.id);
  const edit = await pro.patch(`/api/pro/products/${pids[0]}`,{ spec: { price: 365 }, revision: t.services.products.get(pids[0]).revision });
  assert.equal(edit.status, 200, `the contractor can edit a delivered model like any of their products: ${edit.text}`);
});

test('two revision rounds, then no more; a redelivery updates the same product', async () => {
  const ann = await t.user();
  const studio = await t.user({ role: 'studio' });
  const o = await newOrder(ann);
  await demoPay(ann, o.id);
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
  // The first delivery date is kept for turnaround.
  assert.equal(t.db.prepare('SELECT delivered_at FROM orders WHERE id = ?').get(o.id).delivered_at, first.body.order.deliveredAt);
});

test('cancel only before payment', async () => {
  const ann = await t.user();
  const o = await newOrder(ann);
  const c = await ann.post(`/api/orders/${o.id}/cancel`);
  assert.equal(c.body.order.status, 'cancelled');
  assert.equal((await ann.post(`/api/orders/${o.id}/checkout`)).status, 409);
  assert.equal((await ann.post(`/api/orders/${o.id}/cancel`)).status, 409);
  const o2 = await newOrder(ann);
  await ann.post(`/api/orders/${o2.id}/checkout`);
  assert.equal((await ann.post(`/api/orders/${o2.id}/cancel`)).body.order.status, 'cancelled', 'pending payment can be cancelled');
  const o3 = await newOrder(ann);
  await demoPay(ann, o3.id);
  assert.equal((await ann.post(`/api/orders/${o3.id}/cancel`)).status, 409);
});

test('unpaid orders expire 24 hours after checkout started (on read)', async () => {
  const t0 = Date.now();
  t.setNow(t0);
  try {
    const ann = await t.user();
    const draft = await newOrder(ann);
    const pending = await newOrder(ann);
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

test('refund marks the order refunded and archives the custom product; refunded twice is a 409', async () => {
  const ann = await t.user();
  const studio = await t.user({ role: 'studio' });
  const admin = await t.user({ role: 'admin' });
  const o = await newOrder(ann);
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
  const o2 = await newOrder(ann);
  assert.equal((await admin.post(`/api/admin/orders/${o2.id}/refund`)).status, 409);
});

test('revenue: gross, refunds, net, by tier, by day and turnaround, demo kept apart from Stripe', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const t0 = Date.UTC(2026, 8, 1, 15); // a Tuesday
    s.setNow(t0);
    const ann = await s.user();
    const studio = await s.user({ role: 'studio' });
    const admin = await s.user({ role: 'admin' });
    const ref = async () => (await ann.putRaw('/api/files?kind=reference&name=a.png', makePng(), 'image/png')).body.file.id;
    const make = async (products, rush = false) => {
      const r = await ref();
      return (await ann.post('/api/orders', { items: Array.from({ length: products }, (_, i) => ({ brief: brief([r], { name: `Product ${i + 1}` }) })), rush })).body.order;
    };
    const a = await make(1); // one pack: 12900
    const b = await make(9); // two packs: 25800
    const c = await make(1, true); // one pack, rush: 12900 × 1.5 = 19350
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
    // An unpaid draft never counts.
    await make(3);

    const r = await admin.get('/api/admin/revenue?days=30');
    assert.equal(r.status, 200);
    assert.equal(r.body.provider, 'demo');
    assert.equal(r.body.gross, 12_900 + 25_800 + 19_350);
    assert.equal(r.body.refunds, 19_350);
    assert.equal(r.body.net, 12_900 + 25_800);
    assert.equal(r.body.count, 3);
    assert.equal(r.body.refundCount, 1);
    assert.deepEqual(r.body.byTier, [
      { tier: 'pack', items: 11, gross: 12_900 + 25_800 + 19_350 },
      { tier: 'simple', items: 0, gross: 0 },
      { tier: 'standard', items: 0, gross: 0 },
      { tier: 'complex', items: 0, gross: 0 },
    ]);
    assert.equal(r.body.avgTurnaroundDays, 3);
    assert.equal(r.body.byDay.length, 31);
    const day0 = r.body.byDay.find((d) => d.day === '2026-09-01');
    assert.deepEqual(day0, { day: '2026-09-01', gross: 58_050, refunds: 0, count: 3 });
    assert.equal(r.body.byDay.find((d) => d.day === '2026-09-06').refunds, 19_350);
    assert.equal(r.body.byProvider.stripe.gross, 0);
    assert.equal(r.body.byProvider.demo.gross, r.body.gross);
    // Outside the window: nothing.
    s.setNow(t0 + 100 * DAY);
    // Sessions last 30 days: sign in again after the time jump.
    assert.equal((await admin.post('/api/auth/login', { email: admin.user.email, password: admin.user.password })).status, 200);
    const later = await admin.get('/api/admin/revenue?days=30');
    assert.equal(later.status, 200);
    assert.equal(later.body.gross, 0);
    assert.equal(later.body.avgTurnaroundDays, null);
  } finally {
    await s.close();
  }
});

test('the seed creates paid, in-progress, delivered and completed demo orders, idempotently', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const customer = await s.user({ email: 'demo-customer@blumodel.test' });
    await s.user({ email: 'demo-studio@blumodel.test', role: 'studio' });
    const ctx = { db: s.db, config: s.config, services: s.services, now: s.ctx.now };
    const first = await seed(ctx);
    const second = await seed(ctx);
    assert.ok(first.created >= 4, JSON.stringify(first));
    assert.equal(second.created, 0, 'idempotent');
    const statuses = s.db.prepare('SELECT status FROM orders ORDER BY id').all().map((r) => r.status).sort();
    for (const st of ['paid', 'in_progress', 'delivered', 'completed']) assert.ok(statuses.includes(st), st);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM orders WHERE provider <> 'demo'").get().n, 0);
    const list = (await customer.get('/api/orders')).body.orders;
    assert.equal(list.length, statuses.length);
    const delivered = list.find((o) => o.status === 'delivered');
    assert.ok(delivered.deliverableProductId);
    assert.ok((await customer.get('/api/catalog')).body.products.some((p) => p.id === delivered.deliverableProductId), 'the fixture deliverable is the customer’s private product');
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
