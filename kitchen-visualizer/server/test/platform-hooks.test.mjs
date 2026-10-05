// Foundation additions for billing and contractors (BUILD_PLAN §13.2): the contractor
// product source (a table rebuild that must not lose analytics rows), extra estimate lines
// in saved kitchens, and the safe defaults of the billing / pricing / contractor hooks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { MIGRATION_KEYS, MIGRATION_MODULES } from '../db/migrations/index.mjs';
import { createBillingHooks, createContractorHooks, createPricingHooks, createWebhookService, stripDocCosts } from '../lib/hooks.mjs';
import { startTestServer, sampleDoc } from './helpers.mjs';

test('platform-002 rebuilds products for the contractor source without losing a row or an event', () => {
  const db = openDb(':memory:');
  // Bring the DB to the state before platform-002: core + platform-001 only.
  const platform001 = { steps: MIGRATION_MODULES[1].steps.filter((s) => s.id === 'platform-001-roles-files-brands-products') };
  migrate(db, { modules: [MIGRATION_MODULES[0], platform001], keys: ['core', 'platform'] });
  const t = Date.now();
  db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'a@b.co', 'A', 'x', ?)").run(t);
  db.prepare("INSERT INTO brands (id, slug, name, status, created_at, updated_at) VALUES ('b1', 'b', 'B', 'active', ?, ?)").run(t, t);
  db.prepare(
    `INSERT INTO products (id, source, brand_id, status, visibility, spec, live_spec, kind, category, name, price_cents, created_at, updated_at)
     VALUES ('p_aaaaaaaaaaaaaaaaaaaaaaaa', 'brand', 'b1', 'published', 'public', '{}', '{}', 'range', 'appliances', 'R', 100, ?, ?)`,
  ).run(t, t);
  for (let i = 0; i < 3; i++) db.prepare("INSERT INTO product_events (product_id, brand_id, type, day, created_at) VALUES ('p_aaaaaaaaaaaaaaaaaaaaaaaa', 'b1', 'view', '2026-10-04', ?)").run(t);
  assert.throws(() => db.prepare("UPDATE products SET source = 'contractor'").run(), /CHECK/);

  const ran = migrate(db);
  assert.ok(ran.includes('platform-002-contractor-products'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM product_events').get().n, 3, 'dropping the old table did not cascade');
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1, 'foreign keys are back on');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.prepare("UPDATE products SET source = 'contractor', brand_id = NULL, owner_user_id = 'u1' WHERE id = 'p_aaaaaaaaaaaaaaaaaaaaaaaa'").run();
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'products'").all().map((r) => r.name).sort();
  assert.deepEqual(idx.filter((n) => !n.startsWith('sqlite_')), ['products_brand', 'products_owner', 'products_status']);
  // Cascades still work after the rebuild.
  db.prepare("DELETE FROM products WHERE id = 'p_aaaaaaaaaaaaaaaaaaaaaaaa'").run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM product_events').get().n, 0);
  assert.deepEqual(migrate(db), [], 'a second run is a no-op');
  assert.deepEqual(MIGRATION_KEYS.slice(-2), ['billing', 'contractors']);
});

test('a step that breaks a foreign key is rolled back and not recorded', () => {
  const db = openDb(':memory:');
  migrate(db);
  const bad = {
    steps: [
      {
        id: 'zz-001-break-fk',
        foreignKeys: 'off',
        up(d) {
          d.exec("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('h', 'nobody', 0)");
        },
      },
    ],
  };
  assert.throws(() => migrate(db, { modules: [bad], keys: ['zz'] }), /broken foreign key/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'h'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations WHERE id = 'zz-001-break-fk'").get().n, 0);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
});

test('contractor products are private to their owner, labelled with their company, and carry line and door style', async () => {
  const t = await startTestServer();
  try {
    const ann = await t.user();
    const bob = await t.user();
    assert.throws(() => t.services.products.create({ source: 'contractor', visibility: 'public', ownerUserId: ann.id, spec: {} }), /private/);
    assert.throws(() => t.services.products.create({ source: 'contractor', visibility: 'private', spec: {} }), /private/);
    const row = t.product({ source: 'contractor', ownerUserId: ann.id, visibility: 'private', publish: true, spec: { line: 'Smith Shaker', doorStyle: 'shaker', kind: 'base', variant: 'door-drawer', category: 'cabinets', finishes: 'cabinet' } });
    const mine = (await ann.get('/api/catalog')).body.products;
    const p = mine.find((x) => x.id === row.id);
    assert.ok(p, 'the owner sees it');
    assert.equal(p.source, 'contractor');
    assert.equal(p.line, 'Smith Shaker');
    assert.equal(p.doorStyle, 'shaker');
    assert.equal(p.brand, 'My catalog', 'no company yet');
    assert.ok(!(await bob.get('/api/catalog')).body.products.some((x) => x.id === row.id), 'nobody else does');
    assert.equal((await bob.get(`/api/catalog/products/${row.id}`)).status, 404);
    assert.equal((await t.agent().get(`/api/catalog/products/${row.id}`)).status, 404);
    const v = t.services.products.validateSpec({ line: 'x'.repeat(61), doorStyle: 'glass' }, { partial: true });
    assert.deepEqual(v.errors.map((e) => e.field).sort(), ['doorStyle', 'line']);
  } finally {
    await t.close();
  }
});

test('saved kitchens keep valid extra estimate lines and refuse bad ones', async () => {
  const t = await startTestServer();
  try {
    const ann = await t.user();
    const extras = [{ id: 'x1', label: '  Installation ', amount: 1200.456, cost: 700, junk: 1 }, { id: 'x2', label: 'Delivery', amount: 150 }];
    const r = await ann.post('/api/projects', { name: 'K', doc: sampleDoc({ extras }) });
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.body.project.doc.extras, [
      { id: 'x1', label: 'Installation', amount: 1200.46, cost: 700 },
      { id: 'x2', label: 'Delivery', amount: 150 },
    ]);
    const bad = [
      [{ id: 'x', label: '', amount: 1 }], // no label
      [{ id: 'x', label: 'A', amount: -1 }],
      [{ id: 'x', label: 'A', amount: 1, cost: 'cheap' }],
      Array.from({ length: 51 }, (_, i) => ({ id: `x${i}`, label: 'A', amount: 1 })),
    ];
    for (const extrasBad of bad) assert.equal((await ann.post('/api/projects', { name: 'K', doc: sampleDoc({ extras: extrasBad }) })).status, 400);
  } finally {
    await t.close();
  }
});

test('hook defaults fail closed: Free, no exports, list prices with costs stripped, no branding', () => {
  const billing = createBillingHooks();
  assert.equal(billing.planOf('u1').id, 'free');
  assert.equal(billing.canExport('u1', 'p1'), false);
  const pricing = createPricingHooks();
  const products = [{ id: 'a', price: 10, cost: 5, costCents: 500, margin: 5, markupPct: 30 }];
  assert.deepEqual(pricing.applyForViewer('owner', products, { viewer: null }), [{ id: 'a', price: 10 }]);
  const doc = { extras: [{ id: 'x', label: 'L', amount: 10, cost: 4 }], products: { a: { id: 'a', cost: 1 } } };
  assert.deepEqual(pricing.stripDoc(doc, { viewer: { id: 'someone' }, ownerUserId: 'owner' }), { extras: [{ id: 'x', label: 'L', amount: 10 }], products: { a: { id: 'a' } } });
  assert.equal(pricing.stripDoc(doc, { viewer: { id: 'owner' }, ownerUserId: 'owner' }), doc, 'the owner keeps their own numbers');
  assert.equal(pricing.priceBookFor('owner'), null);
  assert.equal(pricing.sellPricesFor('owner', doc), null);
  assert.deepEqual(stripDocCosts({ name: 'n' }), { name: 'n' });
  const contractors = createContractorHooks();
  assert.equal(contractors.brandingFor('u1'), null);
  assert.equal(contractors.summaryFor('u1'), null);
  // A registered pricing implementation can't leak a cost either.
  pricing.register({ applyForViewer: (_o, list) => list.map((p) => ({ ...p, price: 99, cost: 1 })) });
  assert.deepEqual(pricing.applyForViewer('owner', [{ id: 'a', price: 10 }]), [{ id: 'a', price: 99 }]);
});

test('webhook dispatch routes by event type and by metadata.kind, and refuses async handlers', () => {
  const hooks = createWebhookService();
  const seen = [];
  hooks.on('invoice.paid', (e) => seen.push(['type', e.id]));
  hooks.on('order', (e) => seen.push(['kind', e.id]));
  assert.equal(hooks.dispatch({ id: 'e1', type: 'invoice.paid', data: { object: {} } }), 1);
  assert.equal(hooks.dispatch({ id: 'e2', type: 'checkout.session.completed', data: { object: { metadata: { kind: 'order' } } } }), 1);
  assert.equal(hooks.dispatch({ id: 'e3', type: 'charge.refunded', data: { object: {} } }), 0);
  assert.deepEqual(seen, [
    ['type', 'e1'],
    ['kind', 'e2'],
  ]);
  hooks.on('async.thing', async () => {});
  assert.throws(() => hooks.dispatch({ id: 'e4', type: 'async.thing', data: { object: {} } }), /synchronous/);
});
