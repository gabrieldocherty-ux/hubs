// The real-retailer routes: brand lists per category (the wizard's brand step), each store's link
// settings (Admin > Retailers, admin only and audited), and the anonymous link-out counter.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { loadRetail } from '../catalog/retail.mjs';

const retail = loadRetail();
const ronaProduct = retail.products.find((p) => p.retail.stores.some((l) => l.store === 'rona'));
const hdProduct = retail.products.find((p) => p.retail.stores.some((l) => l.store === 'home-depot') && !p.retail.stores.some((l) => l.store === 'rona'));

test('GET /api/catalog/brands is unchanged without a category; with one it adds the retail brands, their counts and stores', async () => {
  const t = await startTestServer();
  try {
    const anon = t.agent();
    const plain = await anon.get('/api/catalog/brands');
    assert.equal(plain.status, 200);
    assert.deepEqual(Object.keys(plain.body), ['brands']);

    const cab = await anon.get('/api/catalog/brands?category=cabinets');
    assert.equal(cab.status, 200);
    assert.equal(cab.body.category, 'cabinets');
    assert.match(cab.body.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    const list = cab.body.retailBrands;
    assert.equal(list.reduce((n, b) => n + b.products, 0), retail.products.filter((p) => p.category === 'cabinets').length);
    const landon = list.find((b) => b.brand === 'Landon & Co');
    assert.deepEqual([landon.stores, landon.storeSlugs], [['RONA'], ['rona']]);
    assert.ok(list.some((b) => b.brand === 'IKEA' && b.stores.includes('IKEA')));
    assert.ok(!list.some((b) => b.brand === 'BluModel Basics'), 'the client adds Basics itself');

    const all = await anon.get('/api/catalog/brands?category=all');
    assert.equal(all.body.retailBrands.reduce((n, b) => n + b.products, 0), retail.products.length);
    assert.equal((await anon.get('/api/catalog/brands?category=appliances')).body.retailBrands.find((b) => b.brand === 'Samsung').products > 0, true);
    assert.equal((await anon.get('/api/catalog/brands?category=faucets')).status, 400);
    assert.equal((await anon.get('/api/catalog/brands?category=openings')).body.retailBrands.length, 0);
  } finally {
    await t.close();
  }
});

test('store settings: anyone reads them; only an admin changes them, every change is audited, bad parameters are refused', async () => {
  const t = await startTestServer();
  try {
    const anon = t.agent();
    const r0 = await anon.get('/api/catalog/retailers');
    assert.equal(r0.status, 200);
    assert.deepEqual(
      r0.body.retailers.map((r) => r.slug),
      retail.stores.map((s) => s.slug),
    );
    assert.ok(r0.body.retailers.every((r) => r.sponsored === false && r.affiliate === ''));

    const customer = await t.user();
    const studio = await t.user({ role: 'studio' });
    const admin = await t.user({ role: 'admin' });
    assert.equal((await anon.patch('/api/admin/retailers/rona', { sponsored: true })).status, 401);
    assert.equal((await customer.patch('/api/admin/retailers/rona', { sponsored: true })).status, 403);
    assert.equal((await studio.patch('/api/admin/retailers/rona', { sponsored: true })).status, 403);
    assert.equal((await customer.get('/api/admin/retailers')).status, 403);

    for (const bad of ['javascript:alert(1)', 'a=<b>', 'https://evil.example/x', 'aff', 42]) {
      const r = await admin.patch('/api/admin/retailers/rona', { affiliate: bad });
      assert.equal(r.status, 400, String(bad));
    }
    assert.equal((await admin.patch('/api/admin/retailers/rona', { sponsored: 'yes' })).status, 400);
    assert.equal((await admin.patch('/api/admin/retailers/no-such-store', { sponsored: true })).status, 404);

    const ok = await admin.patch('/api/admin/retailers/rona', { affiliate: '?aff=blumodel', sponsored: true });
    assert.equal(ok.status, 200);
    assert.deepEqual([ok.body.retailer.affiliate, ok.body.retailer.sponsored], ['aff=blumodel', true]);
    // Saying the same thing again changes nothing and isn't audited twice.
    assert.equal((await admin.patch('/api/admin/retailers/rona', { sponsored: true })).status, 200);

    const pub = (await anon.get('/api/catalog/retailers')).body.retailers;
    assert.deepEqual(pub.find((r) => r.slug === 'rona'), { slug: 'rona', name: 'RONA', sponsored: true, affiliate: 'aff=blumodel' });
    assert.ok(pub.filter((r) => r.slug !== 'rona').every((r) => !r.sponsored));

    const log = t.db.prepare("SELECT * FROM admin_audit WHERE action = 'retailer_update'").all();
    assert.equal(log.length, 1);
    assert.equal(log[0].admin_user_id, admin.id);
    assert.deepEqual(JSON.parse(log[0].detail), { store: 'rona', before: { affiliate: '', sponsored: false }, after: { affiliate: 'aff=blumodel', sponsored: true } });

    // Clearing works and is audited too.
    const cleared = await admin.patch('/api/admin/retailers/rona', { affiliate: '', sponsored: false });
    assert.deepEqual([cleared.body.retailer.affiliate, cleared.body.retailer.sponsored], ['', false]);
    assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'retailer_update'").get().n, 2);
  } finally {
    await t.close();
  }
});

test('link-out clicks are counted per store, product and day, with nothing about the person, and shown to the admin', async () => {
  const t = await startTestServer();
  try {
    const anon = t.agent();
    const customer = await t.user();
    const admin = await t.user({ role: 'admin' });
    t.setNow(Date.UTC(2026, 9, 15, 12));
    for (let i = 0; i < 3; i++) assert.equal((await anon.post('/api/catalog/retail/clicks', { productId: ronaProduct.id, store: 'rona' })).status, 204);
    assert.equal((await customer.post('/api/catalog/retail/clicks', { productId: hdProduct.id, store: 'home-depot' })).status, 204);
    t.setNow(Date.UTC(2026, 9, 16, 12));
    assert.equal((await anon.post('/api/catalog/retail/clicks', { productId: ronaProduct.id, store: 'rona' })).status, 204);

    // A product at a store that doesn't list it, an unknown product, or junk: refused, not counted.
    assert.equal((await anon.post('/api/catalog/retail/clicks', { productId: hdProduct.id, store: 'rona' })).status, 400);
    assert.equal((await anon.post('/api/catalog/retail/clicks', { productId: 'r-nope', store: 'rona' })).status, 400);
    assert.equal((await anon.post('/api/catalog/retail/clicks', { productId: { $gt: '' }, store: ['rona'] })).status, 400);
    assert.equal((await anon.post('/api/catalog/retail/clicks', { productId: ronaProduct.id, store: 'rona' }, { csrf: false })).status, 403);

    const rows = t.db.prepare('SELECT * FROM retail_clicks ORDER BY day, store').all();
    assert.deepEqual(
      rows.map((r) => ({ ...r })),
      [
        { store: 'home-depot', product_id: hdProduct.id, day: '2026-10-15', clicks: 1 },
        { store: 'rona', product_id: ronaProduct.id, day: '2026-10-15', clicks: 3 },
        { store: 'rona', product_id: ronaProduct.id, day: '2026-10-16', clicks: 1 },
      ],
    );
    const cols = t.db.prepare('PRAGMA table_info(retail_clicks)').all().map((c) => c.name);
    assert.deepEqual(cols, ['store', 'product_id', 'day', 'clicks']);

    const view = await admin.get('/api/admin/retailers');
    assert.equal(view.status, 200);
    const rona = view.body.retailers.find((r) => r.slug === 'rona');
    assert.deepEqual(rona.clicks, { total: 4, last30: 4 });
    assert.deepEqual(rona.top, [{ productId: ronaProduct.id, name: ronaProduct.name, brand: ronaProduct.brand, clicks: 4 }]);
    assert.ok(rona.products > 0);
    assert.equal(view.body.retailers.find((r) => r.slug === 'home-depot').clicks.total, 1);
    assert.equal(view.body.products, retail.products.length);
    assert.ok(view.body.leftOut.count > 0);

    // A month later the old clicks drop out of the 30-day column but stay in the total.
    t.setNow(Date.UTC(2026, 10, 30, 12));
    const admin2 = await t.user({ role: 'admin' }); // (the first one's session has expired by then)
    const later = (await admin2.get('/api/admin/retailers')).body.retailers.find((r) => r.slug === 'rona');
    assert.deepEqual(later.clicks, { total: 4, last30: 0 });
    assert.deepEqual(later.top, []);
  } finally {
    await t.close();
  }
});

test('the click counter carries a per-IP rate limit', async () => {
  const t = await startTestServer();
  try {
    const r = t.ctx.routes.find((x) => x.method === 'POST' && x.path === '/api/catalog/retail/clicks');
    const ip = r.rateLimits.filter((l) => l.by === 'ip');
    assert.ok(ip.length && ip.every((l) => l.max <= 300 && l.windowMs >= 15 * 60_000));
  } finally {
    await t.close();
  }
});
