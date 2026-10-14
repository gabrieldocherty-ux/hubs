// Package C (orders): paid custom models end to end with the DEMO provider, the studio
// queue, delivery into private / brand / contractor products, revisions, refunds, expiry,
// revenue and the seed. Stripe-specific behaviour is in payments.test.mjs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { makeGlb } from './fixtures/glb.mjs';
import { makePng } from './fixtures/images.mjs';
import { seed } from '../seed/orders.mjs';

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

test('tiers are public and the quote is the server’s: client amounts are ignored', async () => {
  const anon = t.agent();
  const tiers = await anon.get('/api/orders/tiers');
  assert.equal(tiers.status, 200);
  assert.deepEqual(
    tiers.body.tiers.map((x) => [x.id, x.priceCents, x.businessDays, x.revisions]),
    [
      ['simple', 12900, 7, 2],
      ['standard', 27900, 10, 2],
      ['complex', 54900, 15, 2],
    ],
  );
  assert.equal(tiers.body.extraFinishCents, 3900);
  assert.equal(tiers.body.payments, 'demo');

  const q = await anon.post('/api/orders/quote', { tier: 'complex', extraFinishes: 3, rush: true, amountCents: 1 });
  assert.equal(q.status, 200);
  // 54900 + 3 × 3900 = 66600; rush +50% = 33300 → 99900; 15 days → 8.
  assert.equal(q.body.quote.amountCents, 99_900);
  assert.equal(q.body.quote.dueBusinessDays, 8);
  assert.equal((await anon.post('/api/orders/quote', { tier: 'gold' })).status, 400);

  const ann = await t.user();
  const refs = [await refPhoto(ann)];
  const r = await ann.post('/api/orders', { target: 'customer', brief: brief(refs), tier: 'simple', extraFinishes: 4, amountCents: 100, amount: 1, price: 1, quote: { amountCents: 1 } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.body.order.amountCents, 12_900 + 2 * 3_900 + 2 * 3_900);
  assert.equal(r.body.order.status, 'draft');
  assert.equal(r.body.quote.amountCents, r.body.order.amountCents);
  assert.equal(r.body.order.provider, 'demo');
  assert.match(r.body.order.id, /^o_[a-z0-9]{24}$/);
  // Anonymous users can't order.
  assert.equal((await anon.post('/api/orders', { brief: brief(refs), tier: 'simple' })).status, 401);
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
  for (const f of ['items[0].brief.kind', 'items[0].brief.name', 'items[0].brief.widthIn', 'items[0].brief.notes', 'items[0].tier', 'items[0].extraFinishes']) {
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
  assert.ok(ok1.body.order.dueAt > ok1.body.order.paidAt + 10 * DAY, '10 business days is at least 14 calendar days');
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
    const ann = await prod.user();
    const refs = [(await ann.putRaw('/api/files?kind=reference&name=a.png', makePng(), 'image/png')).body.file.id];
    const o = (await ann.post('/api/orders', { brief: brief(refs), tier: 'simple' })).body.order;
    const c = await ann.post(`/api/orders/${o.id}/checkout`);
    assert.equal(c.status, 403);
    assert.equal(c.body.error, 'Demo payments are turned off on this server.');
    assert.equal((await ann.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' })).status, 403);
    assert.equal(prod.db.prepare('SELECT status FROM orders WHERE id = ?').get(o.id).status, 'draft');
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

  const piece = (name, w) => ({ brief: brief(refs, { productTypeId: 'base-cabinet', kind: 'base', variant: 'door-drawer', name, widthIn: w, depthIn: 24, heightIn: 34.5 }), tier: 'standard', extraFinishes: 1 });
  const items = [piece('Smith Shaker Base 18', 18), piece('Smith Shaker Base 24', 24), piece('Smith Shaker Base 36', 36)];
  const tooMany = await pro.post('/api/orders', { target: 'contractor', line: 'Smith Shaker', items: Array.from({ length: 21 }, () => items[0]) });
  assert.equal(tooMany.status, 400);
  const r = await pro.post('/api/orders', { target: 'contractor', line: 'Smith Shaker', rush: false, items });
  assert.equal(r.status, 201, r.text);
  const o = r.body.order;
  assert.equal(o.items.length, 3);
  assert.equal(o.amountCents, 3 * (27_900 + 3_900), 'priced per item at the normal tier');
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
    const make = async (tier, extraFinishes = 0, rush = false) =>
      (await ann.post('/api/orders', { brief: brief([await ref()]), tier, extraFinishes, rush })).body.order;
    const a = await make('simple'); // 12900
    const b = await make('complex', 2); // 54900 + 7800 = 62700
    const c = await make('standard', 0, true); // 27900 × 1.5 = 41850
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
    await make('complex');

    const r = await admin.get('/api/admin/revenue?days=30');
    assert.equal(r.status, 200);
    assert.equal(r.body.provider, 'demo');
    assert.equal(r.body.gross, 12_900 + 62_700 + 41_850);
    assert.equal(r.body.refunds, 41_850);
    assert.equal(r.body.net, 12_900 + 62_700);
    assert.equal(r.body.count, 3);
    assert.equal(r.body.refundCount, 1);
    assert.deepEqual(r.body.byTier, [
      { tier: 'simple', items: 1, gross: 12_900 },
      { tier: 'standard', items: 1, gross: 41_850 },
      { tier: 'complex', items: 1, gross: 62_700 },
    ]);
    assert.equal(r.body.avgTurnaroundDays, 3);
    assert.equal(r.body.byDay.length, 31);
    const day0 = r.body.byDay.find((d) => d.day === '2026-09-01');
    assert.deepEqual(day0, { day: '2026-09-01', gross: 117_450, refunds: 0, count: 3 });
    assert.equal(r.body.byDay.find((d) => d.day === '2026-09-06').refunds, 41_850);
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
