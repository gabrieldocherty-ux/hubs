// Package E (share): share links, the anonymous read, duplication, the private-file read
// policy, and the promise that a share never carries the client, the owner's email or id,
// or a contractor's costs (BUILD_PLAN §9 E-T7, §13.3 E).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, sampleDoc } from './helpers.mjs';
import { makeGlb } from './fixtures/glb.mjs';
import { makePng } from './fixtures/images.mjs';

let t;
before(async () => {
  t = await startTestServer({ env: { PAYMENTS: 'demo' } });
});
after(async () => {
  await t?.close();
});

const DAY = 86_400_000;

async function kitchen(agent, over = {}) {
  const r = await agent.post('/api/projects', { name: over.name ?? 'Shared Kitchen', client: over.client ?? 'Pat Client', doc: sampleDoc(over.doc ?? {}) });
  assert.equal(r.status, 201, r.text);
  return r.body.project;
}

async function share(agent, projectId, body = {}) {
  const r = await agent.post(`/api/projects/${projectId}/shares`, body);
  assert.equal(r.status, 201, r.text);
  return r.body.share;
}

/** Every key and value in a JSON value. */
function walk(v, visit, path = '$') {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, visit, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (visit(k, x, `${path}.${k}`), walk(x, visit, `${path}.${k}`));
}

/**
 * Fails if the value has a `client` or cost key, or carries any secret: a string secret anywhere
 * inside a string value, a number secret as a number value (or as a whole string value).
 */
function assertClean(value, secrets, where) {
  walk(value, (k, x, p) => {
    assert.ok(k !== 'client', `${where}: ${p} is the client field`);
    assert.ok(!/^(cost|costCents|costByWidth|unitCost|costTotal|margin|marginPct|markupPct)$/.test(k), `${where}: ${p} is a cost field`);
    for (const s of secrets) {
      if (typeof s === 'string') assert.ok(!(typeof x === 'string' && x.includes(s)) && !k.includes(s), `${where}: ${p} mentions ${s}`);
      else assert.ok(x !== s && x !== String(s), `${where}: ${p} = ${x} is a secret number`);
    }
  });
}

test('create, list and revoke are the owner’s alone; everyone else gets a 404', async () => {
  const owner = await t.user();
  const other = await t.user();
  const anon = t.agent();
  const k = await kitchen(owner);

  const s = await share(owner, k.id, { label: 'For Sam', showPrices: false, expiresInDays: 30 });
  assert.match(s.id, /^sh_[a-z0-9]{16}$/);
  assert.equal(s.projectId, k.id);
  assert.equal(s.label, 'For Sam');
  assert.equal(s.showPrices, false);
  assert.ok(s.expiresAt > Date.now() + 29 * DAY && s.expiresAt <= Date.now() + 30 * DAY + 5000);
  assert.equal(s.revokedAt, null);
  assert.equal(s.viewCount, 0);

  // Defaults: prices on, no expiry, no label.
  const d = await share(owner, k.id);
  assert.equal(d.showPrices, true);
  assert.equal(d.expiresAt, null);
  assert.equal(d.label, '');

  const list = await owner.get(`/api/projects/${k.id}/shares`);
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.shares.map((x) => x.id),
    [d.id, s.id],
  );

  for (const [who, code] of [
    [other, 404],
    [anon, 401],
  ]) {
    assert.equal((await who.post(`/api/projects/${k.id}/shares`, {})).status, code);
    assert.equal((await who.get(`/api/projects/${k.id}/shares`)).status, code);
    assert.equal((await who.delete(`/api/projects/${k.id}/shares/${s.id}`)).status, code);
  }
  // A link can't be revoked through someone else's kitchen either.
  const theirs = await kitchen(other);
  assert.equal((await other.delete(`/api/projects/${theirs.id}/shares/${s.id}`)).status, 404);

  const r = await owner.delete(`/api/projects/${k.id}/shares/${s.id}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.share.revokedAt > 0);
  // Revoking twice is harmless and keeps the first time.
  const again = await owner.delete(`/api/projects/${k.id}/shares/${s.id}`);
  assert.equal(again.body.share.revokedAt, r.body.share.revokedAt);
  assert.equal((await owner.delete(`/api/projects/${k.id}/shares/sh_nosuchlink00000`)).status, 404);
});

test('bad input is refused; a kitchen has at most 20 active links', async () => {
  const owner = await t.user();
  const k = await kitchen(owner);
  assert.equal((await owner.post(`/api/projects/${k.id}/shares`, { expiresInDays: 5 })).status, 400);
  assert.equal((await owner.post(`/api/projects/${k.id}/shares`, { expiresInDays: '30' })).status, 400);
  assert.equal((await owner.post(`/api/projects/${k.id}/shares`, { showPrices: 'no' })).status, 400);
  const long = await share(owner, k.id, { label: 'x'.repeat(300) });
  assert.equal(long.label.length, 80);

  const made = [long];
  for (let i = 1; i < 20; i++) made.push(await share(owner, k.id, { expiresInDays: i % 2 ? 7 : null }));
  const full = await owner.post(`/api/projects/${k.id}/shares`, {});
  assert.equal(full.status, 409);
  assert.match(full.body.error, /20 active links/);
  // Revoked and expired links don't count.
  await owner.delete(`/api/projects/${k.id}/shares/${made[0].id}`);
  await share(owner, k.id);
  assert.equal((await owner.post(`/api/projects/${k.id}/shares`, {})).status, 409);
  t.setNow(Date.now() + 8 * DAY); // the ten 7-day links have expired
  try {
    await share(owner, k.id);
  } finally {
    t.setNow(null);
  }
});

test('tokens are 192 random bits, base64url, and different every time', async () => {
  const owner = await t.user();
  const k = await kitchen(owner);
  const seen = new Set();
  for (let i = 0; i < 10; i++) {
    const s = await share(owner, k.id);
    assert.match(s.token, /^[A-Za-z0-9_-]{32}$/);
    assert.ok(Buffer.from(s.token, 'base64url').length * 8 >= 128, 'at least 128 bits');
    assert.equal(Buffer.from(s.token, 'base64url').length, 24);
    seen.add(s.token);
  }
  assert.equal(seen.size, 10);
});

test('anyone with a live token reads the kitchen; views count once per visitor and never the owner', async () => {
  const owner = await t.user({ name: 'Alexandra Example' });
  const k = await kitchen(owner, { name: 'Lake House' });
  const s = await share(owner, k.id);
  const anon = t.agent();

  const r = await anon.get(`/api/share/${s.token}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.kitchen.name, 'Lake House');
  assert.equal(r.body.kitchen.sharedBy, 'Alexandra');
  assert.equal(r.body.kitchen.updatedAt, k.updatedAt);
  assert.equal(r.body.kitchen.doc.items.length, 1);
  assert.equal(r.body.kitchen.doc.items[0].productId, 'range-30');
  assert.equal(r.body.showPrices, true);
  assert.deepEqual(r.body.products, []);
  assert.equal(r.body.preparedBy, undefined);
  assert.equal(r.body.hideDuplicate, undefined);

  // Same visitor again: still one view. The owner looking at their own link: not a view.
  await anon.get(`/api/share/${s.token}`);
  await owner.get(`/api/share/${s.token}`);
  let mine = (await owner.get(`/api/projects/${k.id}/shares`)).body.shares[0];
  assert.equal(mine.viewCount, 1);
  assert.ok(mine.lastViewedAt > 0);
  // Half an hour later the same visitor counts again.
  t.setNow(Date.now() + 31 * 60_000);
  try {
    await anon.get(`/api/share/${s.token}`);
  } finally {
    t.setNow(null);
  }
  mine = (await owner.get(`/api/projects/${k.id}/shares`)).body.shares[0];
  assert.equal(mine.viewCount, 2);

  // The live kitchen: an edit after sharing shows through the same link.
  const doc = sampleDoc({ items: [...sampleDoc().items, { id: 'it-2', productId: 'dishwasher', x: 100, y: 12, rotation: 0, finishIndex: 0 }] });
  const put = await owner.put(`/api/projects/${k.id}`, { doc, revision: k.revision });
  assert.equal(put.status, 200, put.text);
  assert.equal((await anon.get(`/api/share/${s.token}`)).body.kitchen.doc.items.length, 2);
});

test('revoked, expired, unknown and malformed tokens are 404s with a reason', async () => {
  const owner = await t.user();
  const k = await kitchen(owner);
  const anon = t.agent();
  const week = await share(owner, k.id, { expiresInDays: 7 });
  const revoked = await share(owner, k.id);
  await owner.delete(`/api/projects/${k.id}/shares/${revoked.id}`);

  const r1 = await anon.get(`/api/share/${revoked.token}`);
  assert.equal(r1.status, 404);
  assert.equal(r1.body.reason, 'revoked');
  assert.match(r1.body.error, /no longer available/);

  assert.equal((await anon.get(`/api/share/${week.token}`)).status, 200);
  t.setNow(Date.now() + 7 * DAY + 1000);
  try {
    const r2 = await anon.get(`/api/share/${week.token}`);
    assert.equal(r2.status, 404);
    assert.equal(r2.body.reason, 'expired');
  } finally {
    t.setNow(null);
  }

  const r3 = await anon.get(`/api/share/${'A'.repeat(32)}`);
  assert.equal(r3.status, 404);
  assert.equal(r3.body.reason, 'missing');
  assert.equal((await anon.get('/api/share/short')).body.reason, 'missing');

  // Deleting the kitchen deletes its links.
  const gone = await share(owner, k.id);
  await owner.delete(`/api/projects/${k.id}`);
  assert.equal((await anon.get(`/api/share/${gone.token}`)).body.reason, 'missing');
});

test('the share wire never carries the client, the owner’s email or the owner’s id (deep scan)', async () => {
  const owner = await t.user({ name: 'Morgan Private' });
  const own = t.product({ source: 'custom', ownerUserId: owner.id, visibility: 'private', publish: true, spec: { name: 'My Range', price: 2500 } });
  const brandOwner = await t.user();
  const brand = t.brand(brandOwner, { name: 'Open Co (Demo)' });
  const pub = t.product({ source: 'brand', brandId: brand.id, publish: true, spec: { name: 'Open Range', buyUrl: 'https://open.example/range' } });
  const k = await kitchen(owner, {
    client: 'Jordan Secretclient',
    doc: {
      items: [
        { id: 'a', productId: own.id, x: 40, y: 14, rotation: 0, finishIndex: 0 },
        { id: 'b', productId: pub.id, x: 90, y: 14, rotation: 0, finishIndex: 0 },
      ],
    },
  });
  const s = await share(owner, k.id);
  const r = await t.agent().get(`/api/share/${s.token}`);
  assert.equal(r.status, 200, r.text);
  assertClean(r.body, ['Jordan Secretclient', owner.user.email, owner.id, brandOwner.id, brandOwner.user.email], 'share wire');
  assert.deepEqual(r.body.products.map((p) => p.id).sort(), [own.id, pub.id].sort());
  assert.equal(r.body.products.find((p) => p.id === pub.id).buyUrl, 'https://open.example/range');
});

test('showPrices: false is reflected and the prices themselves stay home', async () => {
  const owner = await t.user();
  const own = t.product({ source: 'custom', ownerUserId: owner.id, visibility: 'private', publish: true, spec: { price: 4321.5, priceByWidth: { 30: 4321.5, 36: 5432.5 } } });
  const k = await kitchen(owner, { doc: { items: [{ id: 'a', productId: own.id, x: 40, y: 14, rotation: 0, finishIndex: 0 }] } });
  const s = await share(owner, k.id, { showPrices: false });
  const r = await t.agent().get(`/api/share/${s.token}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.showPrices, false);
  assert.equal(r.body.prices, undefined);
  assert.equal(r.body.products[0].price, 0);
  assert.equal(r.body.products[0].priceByWidth, undefined);
  assert.ok(!JSON.stringify(r.body).includes('4321.5'));

  const on = await share(owner, k.id, { showPrices: true });
  const r2 = await t.agent().get(`/api/share/${on.token}`);
  assert.equal(r2.body.showPrices, true);
  assert.equal(r2.body.products[0].price, 4321.5);
});

test('duplicate needs an account and makes a copy the caller owns', async () => {
  const owner = await t.user();
  const k = await kitchen(owner, { name: 'Original' });
  const s = await share(owner, k.id);
  const anon = t.agent();
  assert.equal((await anon.post(`/api/share/${s.token}/duplicate`)).status, 401);

  const friend = await t.user();
  const r = await friend.post(`/api/share/${s.token}/duplicate`);
  assert.equal(r.status, 201, r.text);
  const copy = r.body.project;
  assert.equal(copy.name, 'Original (copy)');
  assert.equal(copy.client, '', 'the owner’s client never travels with a copy');
  assert.deepEqual(copy.doc.items, k.doc.items);
  assert.equal((await friend.get(`/api/projects/${copy.id}`)).status, 200);
  assert.equal((await owner.get(`/api/projects/${copy.id}`)).status, 404);
  // The original is untouched and still the owner's.
  assert.equal((await owner.get(`/api/projects/${k.id}`)).body.project.name, 'Original');

  await owner.delete(`/api/projects/${k.id}/shares/${s.id}`);
  assert.equal((await friend.post(`/api/share/${s.token}/duplicate`)).status, 404);
});

test('a private custom model is readable through a live share of a kitchen that uses it, and nowhere else', async () => {
  const owner = await t.user();
  const glb = t.file(owner, makeGlb({}), { kind: 'model', visibility: 'private' });
  const img = t.file(owner, makePng({ w: 6, h: 6 }), { kind: 'image', visibility: 'private' });
  const used = t.product({ source: 'custom', ownerUserId: owner.id, visibility: 'private', publish: true, spec: { name: 'Used Model', modelFileId: glb.id, imageFileIds: [img.id] } });
  const glb2 = t.file(owner, makeGlb({ w: 0.5 }), { kind: 'model', visibility: 'private' });
  const unused = t.product({ source: 'custom', ownerUserId: owner.id, visibility: 'private', publish: true, spec: { name: 'Unused Model', modelFileId: glb2.id } });
  // Someone else's private model, dropped into the owner's kitchen by id.
  const stranger = await t.user();
  const glb3 = t.file(stranger, makeGlb({ w: 0.4 }), { kind: 'model', visibility: 'private' });
  const theirs = t.product({ source: 'custom', ownerUserId: stranger.id, visibility: 'private', publish: true, spec: { name: 'Not Yours', modelFileId: glb3.id } });

  const k = await kitchen(owner, {
    doc: {
      items: [
        { id: 'a', productId: used.id, x: 40, y: 14, rotation: 0, finishIndex: 0 },
        { id: 'b', productId: theirs.id, x: 90, y: 14, rotation: 0, finishIndex: 0 },
      ],
    },
  });
  const s = await share(owner, k.id);
  const anon = t.agent();
  const wire = (await anon.get(`/api/share/${s.token}`)).body;
  assert.deepEqual(
    wire.products.map((p) => p.id),
    [used.id],
    'another user’s private product never appears',
  );
  const p = wire.products[0];
  assert.equal(p.model.url, `/api/files/${glb.id}/content?share=${encodeURIComponent(s.token)}`);
  assert.equal(p.thumbnailUrl, `/api/files/${img.id}/content?share=${encodeURIComponent(s.token)}`);

  const got = await anon.get(p.model.url);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('cache-control'), 'private, no-store');
  assert.equal(got.buffer.subarray(0, 4).toString('latin1'), 'glTF');
  assert.equal((await anon.get(p.thumbnailUrl)).status, 200);
  assert.equal((await anon.get(`/api/files/${glb.id}`)).status, 404, 'no token, no file');
  assert.equal((await anon.get(`/api/files/${glb.id}/content`)).status, 404, 'no token, no bytes');
  assert.equal((await anon.get(`/api/files/${glb2.id}/content?share=${s.token}`)).status, 404, 'a product not in the kitchen');
  assert.equal((await anon.get(`/api/files/${glb3.id}/content?share=${s.token}`)).status, 404, 'a product the owner doesn’t own');
  assert.equal((await anon.get(`/api/files/${glb.id}/content?share=${'B'.repeat(32)}`)).status, 404, 'a made-up token');

  // Another kitchen's live token doesn't open this file either.
  const k2 = await kitchen(owner);
  const s2 = await share(owner, k2.id);
  assert.equal((await anon.get(`/api/files/${glb.id}/content?share=${s2.token}`)).status, 404);

  await owner.delete(`/api/projects/${k.id}/shares/${s.id}`);
  assert.equal((await anon.get(p.model.url)).status, 404, 'revoked');
  void unused;
});

test('a contractor’s share: sell prices, “Prepared by”, no duplicate, and no cost anywhere (real pricing)', async () => {
  const c = await t.user();
  const ck = await c.post('/api/billing/checkout', { kind: 'subscription', plan: 'contractor' });
  assert.equal(ck.status, 200, ck.text);
  assert.equal((await c.post(`/api/billing/demo/${ck.body.ref}/complete`, { outcome: 'success' })).status, 200);
  const prof = await c.put('/api/pro/profile', { company: 'Birch & Bevel', phone: '555-0199', email: 'studio@birch.test', website: 'birch.test', defaultMarkupPct: 25 });
  assert.equal(prof.status, 200, prof.text);
  const made = await c.post('/api/pro/products', {
    spec: {
      kind: 'base',
      variant: 'door-drawer',
      category: 'cabinets',
      name: 'Bevel Base',
      blurb: '',
      sku: 'BB24',
      widthIn: 24,
      depthIn: 24,
      heightIn: 34.5,
      elevationIn: 0,
      price: 0,
      finishes: [{ id: 'oat', name: 'Oat', hex: '#e8dcc4', material: 'paint' }],
      imageFileIds: [],
    },
    cost: { costCents: 24680, markupPct: 25 },
  });
  assert.ok(made.status === 200 || made.status === 201, made.text);
  const own = made.body.product;
  assert.equal((await c.patch('/api/pro/price-book/range-30', { costCents: 97531 })).status, 200);
  const k = await kitchen(c, {
    client: 'Riley Homeowner',
    doc: {
      items: [
        { id: 'a', productId: own.id, x: 20, y: 12, rotation: 0, finishIndex: 0 },
        { id: 'b', productId: 'range-30', x: 80, y: 14, rotation: 0, finishIndex: 0 },
      ],
      extras: [{ id: 'x1', label: 'Installation', amount: 1800, cost: 1111.25 }],
    },
  });
  const s = await share(c, k.id);
  const anon = t.agent();
  let r = await anon.get(`/api/share/${s.token}`);
  // The export kit loads in the background at startup; give it a moment on a cold start.
  for (let i = 0; i < 20 && !r.body.prices; i++) {
    await new Promise((res) => setTimeout(res, 100));
    r = await anon.get(`/api/share/${s.token}`);
  }
  assert.equal(r.status, 200, r.text);
  assertClean(r.body, ['Riley Homeowner', c.user.email, c.id, 246.8, 24680, 975.31, 97531, 1111.25], 'contractor share wire');
  assert.deepEqual(r.body.preparedBy, { company: 'Birch & Bevel', phone: '555-0199', email: 'studio@birch.test', website: 'https://birch.test/' });
  assert.equal(r.body.hideDuplicate, true);
  // Sell = cost × (1 + markup): 246.80 × 1.25 = 308.50; 975.31 × 1.25 = 1219.14.
  assert.equal(r.body.products.find((p) => p.id === own.id).price, 308.5);
  assert.equal(r.body.prices[own.id].price, 308.5);
  assert.equal(r.body.prices['range-30'].price, 1219.14);
  assert.deepEqual(r.body.kitchen.doc.extras, [{ id: 'x1', label: 'Installation', amount: 1800 }]);

  // Clients stay with the contractor: no copies, except for the contractor themself.
  const client = await t.user();
  assert.equal((await client.post(`/api/share/${s.token}/duplicate`)).status, 403);
  assert.equal((await c.post(`/api/share/${s.token}/duplicate`)).status, 201);

  // Prices off: no sell prices either.
  const quiet = await share(c, k.id, { showPrices: false });
  const q = (await anon.get(`/api/share/${quiet.token}`)).body;
  assert.equal(q.prices, undefined);
  assertClean(q, [308.5, 1219.14, 246.8, 975.31, 1111.25], 'prices-off contractor share');
});

test('whatever a pricing implementation returns, cost and margin never reach the share wire (fake impl)', async () => {
  const t2 = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    // A deliberately leaky implementation: every field a contractor's numbers could hide in.
    t2.services.pricing.register({
      applyForViewer: (_owner, list) => list.map((p) => ({ ...p, price: 777, cost: 111, costCents: 11100, costByWidth: { 30: 111 }, margin: 666, marginPct: 85.7, markupPct: 600, unitCost: 111, costTotal: 111 })),
      stripDoc: (doc) => doc,
      sellPricesFor: (_owner, doc) => Object.fromEntries((doc.items ?? []).map((i) => [i.productId, { price: 777 }])),
    });
    t2.services.contractors.register({ brandingFor: () => ({ company: 'Fake Fit-outs', phone: '555-0123' }) });
    const owner = await t2.user();
    const own = t2.product({ source: 'custom', ownerUserId: owner.id, visibility: 'private', publish: true });
    const doc = sampleDoc({
      items: [{ id: 'a', productId: own.id, x: 40, y: 14, rotation: 0, finishIndex: 0 }],
      extras: [{ id: 'x1', label: 'Demolition', amount: 900, cost: 333 }],
      products: { [own.id]: { id: own.id, name: 'Snapshot', price: 1, cost: 222, margin: 5 } },
    });
    const k = await owner.post('/api/projects', { name: 'Fake', client: 'Casey Client', doc });
    assert.equal(k.status, 201, k.text);
    const s = (await owner.post(`/api/projects/${k.body.project.id}/shares`, {})).body.share;
    const r = await t2.agent().get(`/api/share/${s.token}`);
    assert.equal(r.status, 200, r.text);
    assertClean(r.body, ['Casey Client', owner.user.email, owner.id, 111, 11100, 666, 85.7, 600, 333, 222], 'fake-impl share wire');
    assert.equal(r.body.products[0].price, 777);
    assert.equal(r.body.prices[own.id].price, 777);
    assert.deepEqual(r.body.preparedBy, { company: 'Fake Fit-outs', phone: '555-0123' });
    assert.equal(r.body.hideDuplicate, true);
  } finally {
    await t2.close();
  }
});
