// Package H (contractors): access, the private catalog, price math, CSV import, quotes, and
// the promise that a contractor's costs never reach anyone else.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, sampleDoc } from './helpers.mjs';
import { makePng } from './fixtures/images.mjs';

let t;
before(async () => {
  t = await startTestServer({ env: { PAYMENTS: 'demo' } });
});
after(async () => {
  await t?.close();
});

const DAY = 86_400_000;

async function buy(agent, body) {
  const c = await agent.post('/api/billing/checkout', body);
  assert.equal(c.status, 200, c.text);
  assert.equal((await agent.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' })).status, 200);
}

/** A user on the Contractor plan with a company set up (default markup 30%). */
async function contractor(profile = {}) {
  const a = await t.user();
  await buy(a, { kind: 'subscription', plan: 'contractor' });
  const r = await a.put('/api/pro/profile', { company: 'Smith Kitchens', phone: '555-0100', email: 'hello@smith.test', website: 'smith.test', defaultMarkupPct: 30, ...profile });
  assert.equal(r.status, 200, r.text);
  return a;
}

const cabinetSpec = (over = {}) => ({
  kind: 'base',
  variant: 'door-drawer',
  category: 'cabinets',
  name: 'Shaker Base',
  blurb: '',
  sku: 'SSB{w}',
  widthIn: 24,
  depthIn: 24,
  heightIn: 34.5,
  elevationIn: 0,
  widthOptions: [12, 18, 24, 30, 36],
  price: 0,
  finishes: [{ id: 'dove', name: 'Dove White', hex: '#efece4', material: 'paint' }],
  imageFileIds: [],
  line: 'Smith Shaker',
  doorStyle: 'shaker',
  ...over,
});

/** Every key and string in a JSON value, for "costs never leave" scans. */
function walk(v, visit, path = '$') {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, visit, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (visit(k, x, `${path}.${k}`), walk(x, visit, `${path}.${k}`));
}
function assertNoCosts(value, secrets, where) {
  walk(value, (k, x, p) => {
    assert.ok(!/^(cost|costCents|costByWidth|unitCost|costTotal|margin|marginPct|markupPct)$/.test(k), `${where}: ${p} is a cost field`);
    if (typeof x === 'number') assert.ok(!secrets.includes(x), `${where}: ${p} = ${x} is a cost`);
    if (typeof x === 'string') for (const s of secrets) assert.ok(!x.includes(String(s)), `${where}: ${p} mentions ${s}`);
  });
}

test('every /api/pro route is the Contractor plan’s; lapsed contractors keep read-only access', async () => {
  const free = await t.user();
  const unlimited = await t.user();
  await buy(unlimited, { kind: 'subscription', plan: 'unlimited' });
  const routes = [
    ['GET', '/api/pro/profile'],
    ['PUT', '/api/pro/profile', { company: 'X' }],
    ['GET', '/api/pro/dashboard'],
    ['GET', '/api/pro/products'],
    ['POST', '/api/pro/products', { spec: cabinetSpec() }],
    ['GET', '/api/pro/brands'],
    ['PATCH', '/api/pro/brand-settings', { key: 'builtin', enabled: false }],
    ['GET', '/api/pro/price-book'],
    ['GET', '/api/pro/price-book/data'],
    ['PATCH', '/api/pro/price-book/range-30', { costCents: 100 }],
    ['GET', '/api/pro/price-book/export'],
    ['GET', '/api/pro/quotes'],
  ];
  for (const who of [free, unlimited]) {
    for (const [m, p, body] of routes) {
      const r = await who.request(m, p, body ? { body } : {});
      assert.equal(r.status, 403, `${m} ${p}`);
      assert.equal(r.body.needs, 'contractor');
    }
  }
  assert.equal((await t.agent().get('/api/pro/profile')).status, 401);

  // A contractor whose plan lapses: reads work, writes say renew.
  const t0 = Date.now();
  t.setNow(t0);
  try {
    const c = await contractor();
    await c.post('/api/billing/demo/simulate', { event: 'renewal_failed' });
    t.setNow(t0 + 8 * DAY);
    assert.equal((await c.get('/api/pro/profile')).body.readOnly, true);
    assert.equal((await c.get('/api/pro/price-book')).status, 200);
    const w = await c.post('/api/pro/products', { spec: cabinetSpec() });
    assert.equal(w.status, 403);
    assert.equal(w.body.needs, 'renew');
    assert.equal((await c.patch('/api/pro/price-book/range-30', { costCents: 100 })).status, 403);
    const me = (await c.get('/api/auth/me')).body.user;
    assert.deepEqual(me.contractor, { company: 'Smith Kitchens', active: false });
    assert.equal(me.plan.id, 'free');
  } finally {
    t.setNow(null);
  }
});

test('the setup creates a profile; a contractor needs one before the catalog', async () => {
  const a = await t.user();
  await buy(a, { kind: 'subscription', plan: 'contractor' });
  const before = await a.get('/api/pro/profile');
  assert.equal(before.status, 200);
  assert.equal(before.body.profile, null);
  assert.equal((await a.get('/api/pro/products')).status, 409);
  assert.equal((await a.put('/api/pro/profile', { company: '' })).status, 400);
  assert.equal((await a.put('/api/pro/profile', { company: 'A', email: 'nope' })).status, 400);
  assert.equal((await a.put('/api/pro/profile', { company: 'A', defaultMarkupPct: -5 })).status, 400);
  const r = await a.put('/api/pro/profile', { company: '  Acme Remodel ', website: 'acme.test', taxPct: 8.25 });
  assert.equal(r.status, 200);
  assert.equal(r.body.profile.company, 'Acme Remodel');
  assert.equal(r.body.profile.website, 'https://acme.test/');
  assert.equal(r.body.profile.defaultMarkupPct, 30);
  assert.equal(r.body.profile.taxPct, 8.25);
  const me = (await a.get('/api/auth/me')).body.user;
  assert.deepEqual(me.contractor, { company: 'Acme Remodel', active: true });
});

test('quick-add products are live at once, private, grouped by line, and labelled with the company', async () => {
  const c = await contractor();
  const other = await t.user();
  const r = await c.post('/api/pro/products', { spec: cabinetSpec(), cost: { costByWidth: { 24: 25000, 36: 32000 }, markupPct: 40 } });
  assert.equal(r.status, 201, r.text);
  const p = r.body.product;
  assert.equal(p.source, 'contractor');
  assert.equal(p.brand, 'Smith Kitchens');
  assert.equal(p.line, 'Smith Shaker');
  assert.equal(p.status, 'published');
  assert.deepEqual(r.body.price, { costCents: null, costByWidth: { 24: 25000, 36: 32000 }, markupPct: 40 });
  assert.ok((await c.get('/api/catalog')).body.products.some((x) => x.id === p.id), 'in the editor catalog at once');
  assert.ok(!(await other.get('/api/catalog')).body.products.some((x) => x.id === p.id));
  assert.equal((await other.patch(`/api/pro/products/${p.id}`, { spec: { name: 'x' } })).status, 403);

  // Bad specs come back with field errors; another user's upload can't be used.
  const bad = await c.post('/api/pro/products', { spec: cabinetSpec({ widthIn: -1, kind: 'spaceship' }) });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.errors.some((e) => e.field === 'kind'));
  const img = t.file(other, makePng(), { kind: 'image' }).id;
  const stolen = await c.post('/api/pro/products', { spec: cabinetSpec({ imageFileIds: [img] }) });
  assert.equal(stolen.status, 400);

  // Edit (revision-checked), archive, restore.
  const e = await c.patch(`/api/pro/products/${p.id}`, { spec: { name: 'Shaker Base Cabinet' }, revision: p.revision });
  assert.equal(e.status, 200, e.text);
  assert.equal(e.body.product.name, 'Shaker Base Cabinet');
  assert.equal((await c.patch(`/api/pro/products/${p.id}`, { spec: { name: 'Stale' }, revision: p.revision })).status, 409);
  await c.post(`/api/pro/products/${p.id}/archive`);
  assert.ok(!(await c.get('/api/catalog')).body.products.some((x) => x.id === p.id));
  await c.post(`/api/pro/products/${p.id}/restore`);
  assert.ok((await c.get('/api/catalog')).body.products.some((x) => x.id === p.id));
  const brands = (await c.get('/api/pro/brands')).body;
  assert.deepEqual(brands.lines.map((l) => [l.name, l.count]), [['Smith Shaker', 1]]);
});

test('price math: per-width cost, product markup, line markup, brand discount, company default, no-cost fallback', async () => {
  const c = await contractor({ defaultMarkupPct: 25 });
  const brandOwner = await t.user();
  const brand = t.brand(brandOwner, { name: 'Kestrel (Demo)' });
  const rangeP = t.product({ source: 'brand', brandId: brand.id, publish: true, spec: { price: 2000, sku: 'KR30' } });
  const own = (await c.post('/api/pro/products', { spec: cabinetSpec(), cost: { costCents: 20000 } })).body.product;

  await c.patch('/api/pro/brand-settings', { key: brand.id, pctOffList: 40 }); // cost = 60% of list
  await c.patch('/api/pro/brand-settings', { key: 'line:Smith Shaker', markupPct: 50 });
  await c.patch('/api/pro/price-book/range-30', { costCents: 100000, markupPct: 10 }); // built-in, product markup

  const items = [
    { id: 'a', productId: own.id, x: 20, y: 12, rotation: 0, finishIndex: 0, widthIn: 24 },
    { id: 'b', productId: own.id, x: 60, y: 12, rotation: 0, finishIndex: 0, widthIn: 36 },
    { id: 'c', productId: rangeP.id, x: 100, y: 14, rotation: 0, finishIndex: 0 },
    { id: 'd', productId: 'range-30', x: 140, y: 14, rotation: 0, finishIndex: 0 },
    { id: 'e', productId: 'fridge-36', x: 180, y: 15, rotation: 0, finishIndex: 0 },
  ];
  const k = (await c.post('/api/projects', { name: 'Math', client: 'Pat', doc: sampleDoc({ items, room: { widthIn: 240, lengthIn: 156, ceilingIn: 108 } }) })).body.project;
  const q = (await c.get(`/api/pro/quotes/${k.id}`)).body;
  const line = (label) => q.groups.flatMap((g) => g.lines).find((l) => l.label.includes(label));
  // Own cabinet: one cost (200) for the 24″; the 36″ scales by list price, which is 0 here, so flat. Line markup 50%.
  assert.equal(line('Shaker Base').unitPrice, 300);
  assert.equal(q.groups.find((g) => g.name === 'Cabinetry').lines.reduce((s, l) => s + l.total, 0), 600);
  // Brand product: 40% off a $2,000 list → $1,200 cost, company default 25% → $1,500.
  assert.equal(line('Test Range').unitPrice, 1500);
  // Built-in with its own cost and markup: $1,000 × 1.10.
  assert.equal(line('Gas Range 30').unitPrice, 1100);
  // No cost entered: the list price, flagged in the contractor's own view only.
  const fridge = line('Refrigerator') ?? line('Fridge');
  assert.ok(fridge && fridge.unitPrice > 0);
  assert.equal(q.kitchen.client, 'Pat');
  assert.equal(q.preparedBy.company, 'Smith Kitchens');

  const data = (await c.get('/api/pro/price-book/data')).body;
  assert.equal(data.defaultMarkupPct, 25);
  assert.equal(data.brands[brand.id].pctOffList, 40);
  assert.equal(data.brands['line:smith shaker'].markupPct, 50);
  assert.equal(data.rows['range-30'].costCents, 100000);
});

test('CSV import previews updated / new / unchanged / unmatched rows and applies all-or-nothing', async () => {
  const c = await contractor();
  const own = (await c.post('/api/pro/products', { spec: cabinetSpec(), cost: { costByWidth: { 24: 20000 } } })).body.product;
  const send = (csv, dry) => c.request('POST', `/api/pro/price-book/import${dry ? '?dryRun=1' : ''}`, { raw: csv, contentType: 'text/csv' });
  const good = ['SKU,Description,Width,Cost', 'SSB24,Shaker base 24,,$200.00', 'SSB30,Shaker base 30,,"$1,250.50"', 'R30,Gas range,,900', 'NOPE-1,Not ours,,10', 'SSB36,,36,330'].join('\r\n');
  const dry = await send(good, true);
  assert.equal(dry.status, 200, dry.text);
  const pv = dry.body.preview;
  assert.deepEqual(pv.unchanged.map((r) => r.sku), ['SSB24']);
  assert.deepEqual(pv.added.map((r) => [r.sku, r.width, r.costCents]).sort(), [['R30', null, 90000], ['SSB30', 30, 125050], ['SSB36', 36, 33000]].sort());
  assert.deepEqual(pv.unmatched.map((r) => r.sku), ['NOPE-1']);
  assert.equal(pv.errors.length, 0);
  assert.equal(dry.body.applied, 0);
  assert.equal((await c.get('/api/pro/price-book/data')).body.rows['range-30'], undefined, 'a dry run changes nothing');

  // A bad row anywhere means nothing is applied.
  const broken = good + '\r\nSSB12,,12,twelve dollars';
  const refused = await send(broken, false);
  assert.equal(refused.status, 400);
  assert.equal(refused.body.preview.errors[0].line, 7);
  assert.equal((await c.get('/api/pro/price-book/data')).body.rows['range-30'], undefined);

  const applied = await send(good, false);
  assert.equal(applied.body.applied, 3);
  const rows = (await c.get('/api/pro/price-book/data')).body.rows;
  assert.equal(rows['range-30'].costCents, 90000);
  assert.deepEqual(rows[own.id].costByWidth, { 24: 20000, 30: 125050, 36: 33000 });

  // Duplicates and ambiguous rows are errors; a file without a cost column is refused.
  const dup = await send('SKU,Cost\nR30,1\nR30,2', true);
  assert.match(dup.body.preview.errors[0].error, /Same product as line 2/);
  assert.equal((await send('Foo,Bar\n1,2', true)).status, 200, 'no header: assumed SKU, name, width, cost');
  assert.equal((await send('SKU,Name\nR30,x', true)).status, 400);

  const exp = await c.get('/api/pro/price-book/export');
  assert.equal(exp.body.filename, 'smith-kitchens-price-book.csv');
  assert.match(exp.body.content.split('\n')[0], /^SKU,Name,Brand,Line,Width \(in\),List price,Your cost,Markup %,Sell price$/);
  assert.match(exp.body.content, /\nR30,Gas Range 30″,Corviq,,30,1899,900,30,1170\n/);
});

test('costs never leave: other users’ catalog, exports, quotes and the share pricing carry none', async () => {
  const c = await contractor();
  const own = (await c.post('/api/pro/products', { spec: cabinetSpec({ widthOptions: undefined, sku: 'SSB24', price: 499 }), cost: { costCents: 12345, markupPct: 31 } })).body.product;
  await c.patch('/api/pro/price-book/range-30', { costCents: 67891 });
  const doc = sampleDoc({
    items: [
      { id: 'a', productId: own.id, x: 20, y: 12, rotation: 0, finishIndex: 0 },
      { id: 'b', productId: 'range-30', x: 80, y: 14, rotation: 0, finishIndex: 0 },
    ],
    extras: [{ id: 'x1', label: 'Installation', amount: 2000, cost: 1357.9 }],
  });
  const k = (await c.post('/api/projects', { name: 'Client kitchen', client: 'Pat', doc })).body.project;
  const secrets = [123.45, 12345, 678.91, 67891, 1357.9, 135790, 31];

  // Exports (the contractor is entitled by plan).
  const csv = await c.post(`/api/projects/${k.id}/exports`, { kind: 'csv' });
  const json = await c.post(`/api/projects/${k.id}/exports`, { kind: 'json' });
  assert.equal(csv.status, 200);
  for (const s of ['123.45', '12345', '678.91', '67891', '1357.9']) assert.ok(!csv.body.file.content.includes(s), `csv mentions ${s}`);
  assertNoCosts(JSON.parse(json.body.file.content), secrets.filter((s) => s !== 31), 'json export');
  // Sell prices are in the CSV: 123.45 × 1.31 = 161.72, 678.91 × 1.30 = 882.58.
  assert.match(csv.body.file.content, /,161\.72,161\.72,/);
  assert.match(csv.body.file.content, /,882\.58,882\.58,/);

  // The quote shows sell prices only.
  const q = (await c.get(`/api/pro/quotes/${k.id}`)).body;
  const { doc: quoteDoc, ...quoteRest } = q;
  assertNoCosts(quoteRest, secrets.filter((s) => s !== 31), 'quote');
  assert.equal(quoteDoc.extras[0].cost, 1357.9, 'the contractor’s own doc keeps it, for their editor');

  // What a share page gets (package E will call exactly these).
  const row = t.services.products.get(own.id);
  const wire = t.services.products.toWire(row, { which: 'live' });
  const shared = {
    products: t.services.pricing.applyForViewer(c.id, [wire], { viewer: null }),
    prices: t.services.pricing.sellPricesFor(c.id, JSON.parse(t.db.prepare('SELECT doc FROM projects WHERE id = ?').get(k.id).doc)),
    doc: t.services.pricing.stripDoc(JSON.parse(t.db.prepare('SELECT doc FROM projects WHERE id = ?').get(k.id).doc), { viewer: null, ownerUserId: c.id }),
    preparedBy: t.services.contractors.brandingFor(c.id),
  };
  assertNoCosts(shared, secrets.filter((s) => s !== 31), 'share wire');
  assert.equal(shared.products[0].price, 161.72);
  assert.equal(shared.prices[own.id].price, 161.72);
  assert.equal(shared.prices['range-30'].price, 882.58);
  assert.deepEqual(shared.preparedBy, { company: 'Smith Kitchens', phone: '555-0100', email: 'hello@smith.test', website: 'https://smith.test/' });

  // Another user's catalog never lists the product, let alone a cost.
  const other = await t.user();
  const cat = (await other.get('/api/catalog')).body;
  assert.ok(!cat.products.some((p) => p.id === own.id));
  assertNoCosts(cat, secrets.filter((s) => s !== 31), 'catalog');
  // And the owner's own catalog wire carries no cost either (costs come only from /api/pro).
  assertNoCosts((await c.get('/api/catalog')).body, secrets.filter((s) => s !== 31), 'owner catalog');
});

test('quotes need ownership; quote settings save; the list shows sell totals', async () => {
  const c = await contractor({ taxPct: 10 });
  const other = await contractor();
  const k = (await c.post('/api/projects', { name: 'Q', client: 'Lee', doc: sampleDoc() })).body.project;
  assert.equal((await other.get(`/api/pro/quotes/${k.id}`)).status, 404);
  assert.equal((await other.put(`/api/pro/quotes/${k.id}`, { notes: 'x' })).status, 404);
  const until = Date.now() + 14 * DAY;
  const saved = await c.put(`/api/pro/quotes/${k.id}`, { validUntil: until, notes: 'Includes haul-away.' });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.body.validUntil, until);
  assert.equal(saved.body.notes, 'Includes haul-away.');
  assert.equal(saved.body.tax, Math.round(saved.body.subtotal * 10) / 100);
  assert.equal(saved.body.total, Math.round((saved.body.subtotal + saved.body.tax) * 100) / 100);
  const list = (await c.get('/api/pro/quotes')).body.quotes;
  const mine = list.find((x) => x.projectId === k.id);
  assert.equal(mine.client, 'Lee');
  assert.equal(mine.total, saved.body.subtotal);
  assert.equal(mine.validUntil, until);
});

test('brands I carry: switching a brand off hides it from the price book; lines and own markups are settable', async () => {
  const c = await contractor();
  const brandOwner = await t.user();
  const brand = t.brand(brandOwner, { name: 'Marlow (Demo)' });
  const p = t.product({ source: 'brand', brandId: brand.id, publish: true, spec: { sku: 'ML-1' } });
  let book = (await c.get('/api/pro/price-book')).body;
  assert.ok(book.rows.some((r) => r.productId === p.id));
  assert.ok(book.rows.some((r) => r.productId === 'range-30'));
  await c.patch('/api/pro/brand-settings', { key: brand.id, enabled: false });
  await c.patch('/api/pro/brand-settings', { key: 'builtin', enabled: false });
  book = (await c.get('/api/pro/price-book')).body;
  assert.ok(!book.rows.some((r) => r.productId === p.id));
  assert.ok(!book.rows.some((r) => r.productId === 'range-30'));
  const brands = (await c.get('/api/pro/brands')).body.brands;
  assert.equal(brands.find((b) => b.key === brand.id).enabled, false);
  assert.equal((await c.patch('/api/pro/brand-settings', { key: 'own', enabled: false })).status, 400);
  assert.equal((await c.patch('/api/pro/brand-settings', { key: 'own', markupPct: 45 })).status, 200);
  assert.equal((await c.patch('/api/pro/brand-settings', { key: 'nonsense' })).status, 400);
  assert.equal((await c.patch('/api/pro/brand-settings', { key: brand.id, pctOffList: 120 })).status, 400);
  // Pricing a product they can't see is refused.
  const hidden = t.product({ source: 'custom', ownerUserId: brandOwner.id, visibility: 'private', publish: true });
  assert.equal((await c.patch(`/api/pro/price-book/${hidden.id}`, { costCents: 1 })).status, 404);
});
