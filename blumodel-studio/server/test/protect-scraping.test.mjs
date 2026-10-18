// Copy protection on the public reads (server/http/readLimits.mjs): per-address token buckets on the
// catalog, products, files and share links (the real visitor behind the tunnel, never a header a
// client sends), the catalog in capped pages, X-Robots-Tag on every model, image and file, robots.txt
// for the AI crawlers, and the retail research library for BluModel staff only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpec, startTestServer } from './helpers.mjs';
import { makePng } from './fixtures/images.mjs';
import { CATALOG_PAGE_MAX, READ_LIMITS } from '../http/readLimits.mjs';
import { createRateLimiter } from '../auth/rateLimit.mjs';
import { loadRetail } from '../catalog/retail.mjs';

const NOAI = 'noindex, noimageindex, noai, noimageai';
const fakeSha = (i) => i.toString(16).padStart(64, '0');

/** A showroom with a public picture, as its visitors see it. */
async function showroomWithPicture(t) {
  const tn = t.tenant({ name: 'Acme Kitchens', slug: 'acme' });
  const owner = await t.showroomUser(tn, { role: 'owner' });
  const up = await owner.putRaw('/api/files?kind=image&visibility=public&name=door.png', makePng({ w: 9, h: 9, rgba: [20, 120, 200, 255] }), 'image/png');
  assert.equal(up.status, 201, up.text);
  return { tn, owner, file: up.body.file };
}

test('token bucket: a burst is allowed, then the refill rate; the bucket fills again while idle', () => {
  let t = 0;
  const l = createRateLimiter({ now: () => t });
  for (let i = 0; i < 10; i++) assert.equal(l.take('k', 10, 5, 60_000).ok, true, `burst ${i}`);
  const over = l.take('k', 10, 5, 60_000);
  assert.equal(over.ok, false);
  assert.ok(over.retryAfterMs > 0 && over.retryAfterMs <= 12_000, String(over.retryAfterMs));
  t += 12_000; // one token (5 a minute)
  assert.equal(l.take('k', 10, 5, 60_000).ok, true);
  assert.equal(l.take('k', 10, 5, 60_000).ok, false);
  t += 10 * 60_000; // long idle: full again, never above the burst
  for (let i = 0; i < 10; i++) assert.equal(l.take('k', 10, 5, 60_000).ok, true);
  assert.equal(l.take('k', 10, 5, 60_000).ok, false);
  assert.equal(l.take('other', 10, 5, 60_000).ok, true, 'each key has its own bucket');
  assert.equal(createRateLimiter({ enabled: false }).take('k', 1, 1, 1).ok, true);
});

test('a real visit is never limited: the catalog, the showroom config and 40 pictures, twice over', async () => {
  const t = await startTestServer({ rateLimits: true, env: { TRUST_PROXY: '1' } });
  try {
    const { tn, file } = await showroomWithPicture(t);
    const visitor = t.agent({ host: t.hostFor(tn.slug) });
    const h = { headers: { 'CF-Connecting-IP': '198.51.100.20' } };
    for (let visit = 0; visit < 2; visit++) {
      assert.equal((await visitor.get('/api/showroom', h)).status, 200);
      assert.equal((await visitor.get('/api/catalog', h)).status, 200);
      assert.equal((await visitor.get('/api/catalog/brands?category=cabinets', h)).status, 200);
      for (let i = 0; i < 40; i++) assert.equal((await visitor.get(file.url, h)).status, 200);
    }
  } finally {
    await t.close();
  }
});

test('bulk downloading hits 429 with Retry-After, per real visitor (CF-Connecting-IP behind the tunnel), and a spoofed header buys nothing without TRUST_PROXY', async () => {
  const t = await startTestServer({ rateLimits: true, env: { TRUST_PROXY: '1' } });
  try {
    t.setNow(Date.now()); // the clock stands still: no token comes back while the script runs
    const a = t.agent();
    const ip = (x) => ({ headers: { 'CF-Connecting-IP': x } });
    const burst = READ_LIMITS.catalog[0].burst;
    for (let i = 0; i < burst; i++) assert.equal((await a.get('/api/catalog', ip('203.0.113.5'))).status, 200, `request ${i}`);
    const over = await a.get('/api/catalog', ip('203.0.113.5'));
    assert.equal(over.status, 429);
    assert.ok(Number(over.headers.get('retry-after')) >= 1);
    // The catalog's group shares the budget: the brand list is refused too; another visitor isn't.
    assert.equal((await a.get('/api/catalog/brands', ip('203.0.113.5'))).status, 429);
    assert.equal((await a.get('/api/catalog', ip('203.0.113.6'))).status, 200);

    // Files: a script fetching blob after blob (404s count too: the limit runs before the lookup).
    const fb = READ_LIMITS.files[0].burst;
    let refused = 0;
    for (let i = 0; i < fb + 5; i++) if ((await a.get(`/files/${fakeSha(i)}.glb`, ip('203.0.113.7'))).status === 429) refused++;
    assert.equal(refused, 5);
    // Product pages, one by one.
    const pb = READ_LIMITS.product[0].burst;
    let pr = 0;
    for (let i = 0; i < pb + 3; i++) if ((await a.get(`/api/catalog/products/p_${String(i).padStart(24, '0')}`, ip('203.0.113.8'))).status === 429) pr++;
    assert.equal(pr, 3);
  } finally {
    await t.close();
  }
  // Without TRUST_PROXY the header is ignored: one budget for the socket's address.
  const u = await startTestServer({ rateLimits: true });
  try {
    u.setNow(Date.now());
    const a = u.agent();
    const burst = READ_LIMITS.catalog[0].burst;
    for (let i = 0; i < burst; i++) await a.get('/api/catalog', { headers: { 'CF-Connecting-IP': `203.0.113.${i % 250}` } });
    assert.equal((await a.get('/api/catalog', { headers: { 'CF-Connecting-IP': '192.0.2.99' } })).status, 429);
  } finally {
    await u.close();
  }
});

test('every public read a copier would script is limited, and share links and brand pages too', async () => {
  const t = await startTestServer();
  try {
    const want = {
      'GET /api/catalog': 'catalog-read-min',
      'GET /api/catalog/brands': 'catalog-read-min',
      'GET /api/catalog/retailers': 'catalog-read-min',
      'GET /api/catalog/products/:id': 'product-read-min',
      'GET /api/files/:id': 'product-read-min',
      'GET /api/files/:id/content': 'files-read-min',
      'GET /files/:name': 'files-read-min',
      'GET /api/brands/by-slug/:slug': 'brand-read-min',
      'GET /api/share/:token': 'share-read-bucket-min',
      'GET /api/showroom': 'showroom-read-min',
      'GET /api/catalog/retail': 'retail-data',
    };
    for (const [key, name] of Object.entries(want)) {
      const [method, p] = key.split(' ');
      const r = t.ctx.routes.find((x) => x.method === method && x.path === p);
      assert.ok(r, key);
      assert.ok(r.rateLimits.some((l) => l.name === name), `${key} has ${name}: ${r.rateLimits.map((l) => l.name).join(', ')}`);
      if (name.endsWith('-min')) assert.ok(r.rateLimits.some((l) => l.name === name.replace(/-min$/, '-day')), `${key} has a daily bucket`);
    }
  } finally {
    await t.close();
  }
});

test('the catalog comes in pages of at most 100; next walks them; the version covers the whole catalog', async () => {
  const t = await startTestServer();
  try {
    const tn = t.tenant({ name: 'Big Range', slug: 'big' });
    const owner = await t.showroomUser(tn, { role: 'owner' });
    // Products straight into the table (the workspace API would make one at a time).
    const one = await owner.post('/api/workspace/products', { spec: defaultSpec({ name: 'Base 0' }) });
    let made = one.status === 201 ? 1 : 0;
    if (made) {
      const row = t.db.prepare('SELECT * FROM products WHERE id = ?').get(one.body.product.id);
      const cols = Object.keys(row);
      const ins = t.db.prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      for (let i = 1; i < 230; i++) ins.run(...cols.map((c) => (c === 'id' ? `p_${String(i).padStart(24, '0')}` : c === 'name' ? `Base ${i}` : row[c])));
      made = 230;
    }
    assert.equal(made, 230, one.text);
    const v = t.agent({ host: t.hostFor('big') });
    const p1 = await v.get('/api/catalog');
    assert.equal(p1.status, 200);
    assert.equal(p1.body.products.length, CATALOG_PAGE_MAX);
    assert.equal(p1.body.total, 230);
    assert.equal(p1.body.next, 100);
    const p2 = await v.get('/api/catalog?offset=100');
    assert.equal(p2.body.products.length, 100);
    assert.equal(p2.body.version, p1.body.version);
    const p3 = await v.get(`/api/catalog?offset=${p2.body.next}`);
    assert.equal(p3.body.products.length, 30);
    assert.equal(p3.body.next, null);
    const ids = new Set([...p1.body.products, ...p2.body.products, ...p3.body.products].map((p) => p.id));
    assert.equal(ids.size, 230, 'every product exactly once');
    assert.equal((await v.get('/api/catalog?limit=5000')).body.products.length, CATALOG_PAGE_MAX, 'a bigger page is capped');
    assert.equal((await v.get('/api/catalog?limit=10')).body.products.length, 10);
    assert.equal((await v.get('/api/catalog?offset=-1')).status, 400);
    assert.equal((await v.get('/api/catalog?offset=abc')).status, 400);
  } finally {
    await t.close();
  }
});

test('models, images and files say X-Robots-Tag: noindex, noimageindex, noai, noimageai', async () => {
  const t = await startTestServer();
  try {
    const { tn, owner, file } = await showroomWithPicture(t);
    const visitor = t.agent({ host: t.hostFor(tn.slug) });
    const blob = await visitor.get(file.url);
    assert.equal(blob.status, 200);
    assert.equal(blob.headers.get('x-robots-tag'), NOAI);
    const content = await owner.get(`/api/files/${file.id}/content`);
    assert.equal(content.status, 200);
    assert.equal(content.headers.get('x-robots-tag'), NOAI);
  } finally {
    await t.close();
  }
});

test('the retail research library: BluModel staff only, on the sales site, never cached, rate-limited', async () => {
  const t = await startTestServer({ rateLimits: true });
  try {
    assert.equal((await t.agent().get('/api/catalog/retail')).status, 401);
    const customer = await t.user();
    assert.equal((await customer.get('/api/catalog/retail')).status, 403);
    const studio = await t.user({ role: 'studio' });
    const r = await studio.get('/api/catalog/retail');
    assert.equal(r.status, 200, r.text);
    assert.ok(r.body.products.length > 100, 'the whole library');
    assert.ok(Array.isArray(r.body.stores) && r.body.stores.length);
    assert.match(r.headers.get('cache-control'), /no-store/);
    const admin = await t.user({ role: 'admin' });
    assert.equal((await admin.get('/api/catalog/retail')).status, 200);
    // A showroom has no such route at all.
    const tn = t.tenant({ name: 'Acme Kitchens', slug: 'acme' });
    assert.equal((await t.agent({ host: t.hostFor(tn.slug) }).get('/api/catalog/retail')).status, 404);
    // Limited even for staff.
    let refused = 0;
    for (let i = 0; i < READ_LIMITS.retail[0].burst + 2; i++) if ((await studio.get('/api/catalog/retail')).status === 429) refused++;
    assert.ok(refused >= 2, String(refused));
  } finally {
    await t.close();
  }
});

test('one listing by UPC for a signed-in account (a custom model standing for a store product): that product only, no research notes', async () => {
  const t = await startTestServer();
  try {
    const withUpc = loadRetail().products.find((p) => p.retail.upc);
    assert.ok(withUpc, 'the library has a product with a UPC');
    assert.equal((await t.agent().get(`/api/catalog/retail/upc/${withUpc.retail.upc}`)).status, 401);
    const customer = await t.user();
    const r = await customer.get(`/api/catalog/retail/upc/${withUpc.retail.upc}`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.id, withUpc.id);
    assert.deepEqual(r.body.retail.stores, withUpc.retail.stores);
    assert.equal(r.body.retail.confidence, undefined, 'no research confidence');
    assert.equal(r.body.products, undefined, 'not the library');
    assert.ok(r.body.stores.every((s) => withUpc.retail.stores.some((l) => l.store === s.slug)), 'only the stores that list it');
    assert.equal((await customer.get('/api/catalog/retail/upc/123456789013')).status, 400, 'a code that does not check out');
    assert.equal((await customer.get('/api/catalog/retail/upc/036000291452')).status, 404, 'a valid UPC no store lists');
    const tn = t.tenant({ name: 'Acme Kitchens', slug: 'acme' });
    const visitor = await t.showroomUser(tn);
    assert.equal((await visitor.get(`/api/catalog/retail/upc/${withUpc.retail.upc}`)).status, 404, 'never on a showroom');
  } finally {
    await t.close();
  }
});
