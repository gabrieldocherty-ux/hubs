// Package A (viewer): the self-hosted Draco decoders, the demo GLB seed, and the product page's
// analytics events. The viewer adds no routes or tables of its own (see docs/handoff/viewer.md).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './helpers.mjs';
import { validateGlb } from '../lib/validators.mjs';
import { seed, rangeGlb, pendantGlb, VIEWER_DEMO_BRAND } from '../seed/viewer.mjs';
import { steps } from '../db/migrations/viewer.mjs';
import viewerRoutes from '../routes/viewer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRACO = ['draco_decoder.wasm', 'draco_wasm_wrapper.js', 'draco_decoder.js'];

let t;
let dist;
before(async () => {
  // A DIST_DIR fixture holding the committed decoders, as `vite build` copies them from public/.
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mise-viewer-dist-'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Mise</title>');
  fs.mkdirSync(path.join(dist, 'draco'));
  for (const f of DRACO) fs.copyFileSync(path.join(root, 'public', 'draco', f), path.join(dist, 'draco', f));
  t = await startTestServer({ env: { DIST_DIR: dist } });
});
after(async () => {
  await t?.close();
  fs.rmSync(dist, { recursive: true, force: true });
});

const seedCtx = () => ({ db: t.db, config: t.config, services: t.services, now: () => Date.now() });

test('the committed Draco decoders are byte-identical to three’s (node scripts/copy-decoders.mjs --check)', () => {
  const from = path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'gltf');
  for (const f of DRACO) {
    const ours = fs.readFileSync(path.join(root, 'public', 'draco', f));
    assert.ok(ours.equals(fs.readFileSync(path.join(from, f))), `public/draco/${f} differs from three's copy`);
  }
});

test('a built /draco/draco_decoder.wasm is served 200 application/wasm (no CDN needed)', async () => {
  const anon = t.agent();
  const wasm = await anon.get('/draco/draco_decoder.wasm');
  assert.equal(wasm.status, 200);
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.ok(wasm.buffer.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])), 'starts with the wasm magic');
  assert.equal(wasm.buffer.length, fs.statSync(path.join(root, 'public', 'draco', 'draco_decoder.wasm')).size);

  const wrapper = await anon.get('/draco/draco_wasm_wrapper.js');
  assert.equal(wrapper.status, 200);
  assert.match(wrapper.headers.get('content-type') ?? '', /^text\/javascript/);

  // A missing decoder is a real 404, not the SPA's index.html.
  const missing = await anon.get('/draco/draco_encoder.wasm');
  assert.equal(missing.status, 404);
});

test('the viewer adds no routes and no migrations', () => {
  assert.deepEqual(viewerRoutes(t.ctx), []);
  assert.deepEqual(steps, []);
});

test('the demo GLBs are valid, carry mise_* slots and match their declared size', () => {
  for (const [glb, dims] of [
    [rangeGlb(), { w: 30, h: 37, d: 29 }],
    [pendantGlb(), { w: 14, h: 50, d: 14 }],
  ]) {
    const v = validateGlb(glb);
    assert.equal(v.ok, true, v.error);
    const file = t.file(null, glb, { kind: 'model', visibility: 'public' });
    assert.ok(file.meta.slots.includes('mise_finish') && file.meta.slots.includes('mise_hardware'), JSON.stringify(file.meta.slots));
    // Uniform fit-to-declared scaling is then within 1% of 1 on every axis.
    for (const k of ['w', 'h', 'd']) {
      assert.ok(Math.abs(file.meta.bboxIn[k] / dims[k] - 1) < 0.01, `${k}: ${file.meta.bboxIn[k]} vs ${dims[k]}`);
    }
  }
});

test('the viewer seed makes one fictional demo brand with two published GLB products, idempotently', async () => {
  const first = await seed(seedCtx());
  assert.equal(first.created.length, 3, JSON.stringify(first));
  const again = await seed(seedCtx());
  assert.deepEqual(again.created, []);

  const brand = t.services.brands.bySlug(VIEWER_DEMO_BRAND.slug);
  assert.equal(brand.status, 'active');
  assert.match(brand.name, /\(Demo\)$/);

  const cat = await t.agent().get('/api/catalog');
  assert.equal(cat.status, 200);
  const mine = cat.body.products.filter((p) => p.brandSlug === VIEWER_DEMO_BRAND.slug);
  assert.equal(mine.length, 2);
  for (const p of mine) {
    assert.match(p.id, /^p_[a-z0-9]{24}$/);
    assert.equal(p.isDemo, true);
    assert.match(p.name, /\(Demo\)$/);
    assert.ok(p.model?.url, 'has a model');
    assert.ok(p.model.slots.includes('mise_finish'));
    // The public model URL serves the GLB itself.
    const glb = await t.agent().get(p.model.url);
    assert.equal(glb.status, 200);
    assert.equal(glb.headers.get('content-type'), 'model/gltf-binary');
    assert.equal(validateGlb(glb.buffer).ok, true);
  }
  // The product page reads the same wire product, dimensions included.
  const range = mine.find((p) => p.kind === 'range');
  const one = await t.agent().get(`/api/catalog/products/${range.id}`);
  assert.equal(one.status, 200);
  assert.deepEqual([one.body.product.widthIn, one.body.product.depthIn, one.body.product.heightIn], [30, 29, 37]);
});

test('the seed skips production unless forced', async () => {
  const r = await seed({ ...seedCtx(), config: { ...t.config, PROD: true } });
  assert.match(r.skipped, /production/);
  // Through the seed runner with --force-demo: it guards production itself and passes `demo`.
  const viaRunner = await seed({ ...seedCtx(), config: { ...t.config, PROD: true }, demo: { users: {} } });
  assert.equal(viaRunner.skipped, undefined);
});

test('the product page’s view and buy_click events are recorded with the brand; built-ins are a no-op', async () => {
  await seed(seedCtx());
  const cat = await t.agent().get('/api/catalog');
  const range = cat.body.products.find((p) => p.brandSlug === VIEWER_DEMO_BRAND.slug && p.kind === 'range');
  const brand = t.services.brands.bySlug(VIEWER_DEMO_BRAND.slug);
  const count = (type) => t.db.prepare('SELECT COUNT(*) AS n FROM product_events WHERE product_id = ? AND type = ?').get(range.id, type).n;
  const before = { view: count('view'), buy: count('buy_click') };

  const anon = t.agent();
  assert.equal((await anon.post('/api/events', { productId: range.id, type: 'view' })).status, 204);
  const customer = await t.user();
  assert.equal((await customer.post('/api/events', { productId: range.id, type: 'buy_click' })).status, 204);

  assert.equal(count('view'), before.view + 1);
  assert.equal(count('buy_click'), before.buy + 1);
  const row = t.db.prepare("SELECT * FROM product_events WHERE product_id = ? AND type = 'buy_click' ORDER BY id DESC LIMIT 1").get(range.id);
  assert.equal(row.brand_id, brand.id);
  assert.equal(row.user_id, customer.id);
  assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);

  const builtins = t.db.prepare("SELECT COUNT(*) AS n FROM product_events WHERE product_id = 'range-30'").get().n;
  assert.equal((await anon.post('/api/events', { productId: 'range-30', type: 'view' })).status, 204);
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM product_events WHERE product_id = 'range-30'").get().n, builtins);
});
