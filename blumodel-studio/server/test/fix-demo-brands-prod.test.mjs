// The seeded demo brands ("… (Demo)", is_demo = 1) never show in production: not in the catalog's
// brands or products, not in the new-kitchen wizard's brand list, and their pages answer 404,
// even if a demo seed was forced into the production database. Outside production they show.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { seed as seedBrands } from '../seed/brands.mjs';

async function seeded(env) {
  const s = await startTestServer({ env: { PAYMENTS: 'demo', DEMO_PAYMENTS: '1', SEED_PASSWORD: 'seed-password-123', ...env } });
  await seedBrands({ db: s.db, config: s.config, services: s.services, now: s.ctx.now });
  return s;
}

const demoSlug = (s) => s.db.prepare("SELECT slug FROM brands WHERE is_demo = 1 AND status = 'active' AND kind = 'contractor'").get()?.slug;

test('production: demo brands are left out of the catalog, the wizard brand list and their pages', async () => {
  const s = await seeded({ NODE_ENV: 'production' });
  try {
    assert.ok(s.db.prepare('SELECT COUNT(*) AS n FROM brands WHERE is_demo = 1').get().n >= 3, 'the demo brands are in the database');
    const anon = s.agent();
    const cat = await anon.get('/api/catalog');
    assert.equal(cat.status, 200, cat.text);
    assert.deepEqual(cat.body.brands.filter((b) => b.isDemo), []);
    assert.deepEqual(cat.body.products.filter((p) => p.isDemo || /\(Demo\)/.test(p.brand ?? '')).map((p) => p.id), []);
    const wiz = await anon.get('/api/catalog/brands?category=all');
    assert.equal(wiz.status, 200, wiz.text);
    assert.deepEqual(wiz.body.brands.filter((b) => b.isDemo || /\(Demo\)/.test(b.name)), []);
    assert.equal((await anon.get(`/api/brands/by-slug/${demoSlug(s)}`)).status, 404);
  } finally {
    await s.close();
  }
});

for (const [label, env] of [
  ['outside production', {}],
  ['in production with SHOW_DEMO_BRANDS=1 (QA, a demo server)', { NODE_ENV: 'production', SHOW_DEMO_BRANDS: '1' }],
])
test(`${label} the demo brands show`, async () => {
  const s = await seeded(env);
  try {
    const anon = s.agent();
    const cat = await anon.get('/api/catalog');
    assert.ok(cat.body.brands.some((b) => b.isDemo));
    assert.ok(cat.body.products.some((p) => p.isDemo));
    assert.equal((await anon.get(`/api/brands/by-slug/${demoSlug(s)}`)).status, 200);
  } finally {
    await s.close();
  }
});
