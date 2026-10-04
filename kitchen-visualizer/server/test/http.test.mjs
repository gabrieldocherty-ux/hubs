// HTTP hardening: JSON bodies, 413s, HEAD, static serving and security headers.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { startTestServer } from './helpers.mjs';

let t;
before(async () => {
  t = await startTestServer();
  const dist = t.config.DIST_DIR;
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(dist, 'draco'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Mise</title><div id="root"></div>');
  fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
  fs.writeFileSync(path.join(dist, 'draco', 'x.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
  fs.writeFileSync(path.join(dist, 'model.glb'), Buffer.from('glTF'));
  fs.writeFileSync(path.join(dist, 'env.hdr'), Buffer.from('#?RADIANCE'));
  // A sibling folder whose name shares the dist prefix: the old startsWith() check leaked it.
  fs.mkdirSync(path.join(path.dirname(dist), 'dist-x'), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(dist), 'dist-x', 'y'), 'SECRET-OUTSIDE-DIST');
});
after(async () => {
  await t?.close();
});

/** Raw request without fetch's URL normalisation. */
function raw(method, rawPath, { headers = {}, body, chunks } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: t.port, method, path: rawPath, headers }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (chunks) {
      (async () => {
        for (const c of chunks) {
          if (!req.write(c)) await new Promise((r) => req.once('drain', r));
        }
        req.end();
      })().catch(reject);
    } else req.end(body);
  });
}

test('a JSON null body is a 400, not a 500', async () => {
  const a = await t.user();
  for (const body of ['null', '[]', '42', '"text"', 'true']) {
    const r = await a.request('PATCH', '/api/auth/me', { raw: body, contentType: 'application/json' });
    assert.equal(r.status, 400, body);
    assert.deepEqual(r.body, { error: 'Expected a JSON object.' });
  }
  const bad = await a.request('PATCH', '/api/auth/me', { raw: '{nope', contentType: 'application/json' });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body, { error: 'Malformed JSON.' });
  const wrongType = await a.request('PATCH', '/api/auth/me', { raw: '{"name":"x"}', contentType: 'text/plain' });
  assert.equal(wrongType.status, 415);
  const signupNull = await t.agent().request('POST', '/api/auth/signup', { raw: 'null', contentType: 'application/json' });
  assert.equal(signupNull.status, 400);
});

test('a 1.2 MB JSON body is a JSON 413, not a connection reset', async () => {
  const a = await t.user();
  const big = JSON.stringify({ name: 'x'.repeat(1_200_000) });
  const r = await a.post('/api/projects', big);
  assert.equal(r.status, 413);
  assert.deepEqual(r.body, { error: 'That request is too large.' });
  assert.equal(r.headers.get('connection'), 'close');
  // Chunked (no Content-Length): detected while streaming, still a clean 413.
  const chunk = Buffer.alloc(64 * 1024, 0x61);
  const chunks = [Buffer.from('{"name":"'), ...Array.from({ length: 20 }, () => chunk), Buffer.from('"}')];
  const cookie = [...a.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  const c = await raw('POST', '/api/projects', { headers: { 'content-type': 'application/json', 'x-mise': '1', cookie, 'transfer-encoding': 'chunked' }, chunks });
  assert.equal(c.status, 413);
  assert.deepEqual(JSON.parse(c.text), { error: 'That request is too large.' });
  // The server is still fine afterwards.
  assert.equal((await a.get('/api/auth/me')).status, 200);
});

test('HEAD on /api GET routes works (it used to be a 403)', async () => {
  const r = await t.agent().head('/api/auth/me');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.equal((await t.agent().head('/api/config')).status, 200);
  assert.equal((await t.agent().head('/api/projects')).status, 401);
});

test('a malformed %-escape is a 400, not a 500', async () => {
  const r = await raw('GET', '/%E0%A4%A');
  assert.equal(r.status, 400);
  assert.deepEqual(JSON.parse(r.text), { error: 'Bad path.' });
});

test('path traversal never leaves DIST_DIR', async () => {
  for (const p of ['/..%2fdist-x%2fy', '/..%5cdist-x%5cy', '/assets/..%2f..%2fdist-x%2fy', '/C:%2fWindows%2fwin.ini', '/x%00.js']) {
    const r = await raw('GET', p);
    assert.ok(r.status === 400 || r.status === 404, `${p} → ${r.status}`);
    assert.ok(!r.text.includes('SECRET-OUTSIDE-DIST'), `${p} leaked a file outside dist`);
  }
  // The URL parser folds %2e%2e into "..", so this is just the app route /dist-x/y.
  const dots = await raw('GET', '/%2e%2e/dist-x/y');
  assert.ok(!dots.text.includes('SECRET-OUTSIDE-DIST'));
  assert.match(dots.text, /<div id="root">/);
});

test('static: SPA fallback only for extensionless paths; real MIME types', async () => {
  const anon = t.agent();
  const home = await anon.get('/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  const route = await anon.get('/some/app/route');
  assert.equal(route.status, 200);
  assert.match(route.text, /<div id="root">/);
  const missing = await anon.get('/missing.glb');
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /application\/json/);
  assert.deepEqual(missing.body, { error: 'Not found.' });
  const missingAsset = await anon.get('/assets/nope.js');
  assert.equal(missingAsset.status, 404);
  const wasm = await anon.get('/draco/x.wasm');
  assert.equal(wasm.status, 200);
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal((await anon.get('/model.glb')).headers.get('content-type'), 'model/gltf-binary');
  assert.equal((await anon.get('/env.hdr')).headers.get('content-type'), 'image/vnd.radiance');
  const js = await anon.get('/assets/app-abc123.js');
  assert.match(js.headers.get('content-type'), /text\/javascript/);
  assert.match(js.headers.get('cache-control'), /immutable/);
  assert.equal(home.headers.get('cache-control'), 'no-cache');
  const head = await anon.head('/assets/app-abc123.js');
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '14');
  assert.equal((await anon.post('/', {})).status, 405);
});

test('security headers on every response', async () => {
  for (const p of ['/', '/api/auth/me', '/api/nope', '/missing.png']) {
    const r = await t.agent().get(p);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', p);
    assert.equal(r.headers.get('x-frame-options'), 'DENY', p);
    assert.equal(r.headers.get('referrer-policy'), 'same-origin', p);
  }
});

test('no build yet: a clear JSON 404 instead of a crash', async () => {
  const t2 = await startTestServer();
  try {
    const r = await t2.agent().get('/');
    assert.equal(r.status, 404);
    assert.match(r.body.error, /npm run build/);
  } finally {
    await t2.close();
  }
});

test('config defaults: port 8790, host 127.0.0.1; nothing defaults to 8787', async () => {
  const { loadConfig } = await import('../config.mjs');
  const c = loadConfig({}, []);
  assert.equal(c.PORT, 8790);
  assert.equal(c.HOST, '127.0.0.1');
  assert.equal(c.PUBLIC_URL, 'http://127.0.0.1:8790');
  assert.equal(c.paymentsProvider, 'demo');
  assert.equal(c.llmEnabled, false);
  assert.equal(c.demoPaymentsAllowed, true);
  assert.equal(loadConfig({ NODE_ENV: 'production' }, []).demoPaymentsAllowed, false);
  assert.equal(loadConfig({}, ['--prod']).PROD, true);
  assert.equal(loadConfig({ STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }, []).paymentsProvider, 'stripe');
  assert.equal(loadConfig({ STRIPE_SECRET_KEY: 'sk_test_x' }, []).paymentsProvider, 'demo');
  assert.throws(() => loadConfig({ RATE_LIMITS: 'off' }, ['--prod']), /refused in production/);
  assert.throws(() => loadConfig({ PAYMENTS: 'stripe' }, []), /STRIPE_SECRET_KEY/);
  assert.equal(loadConfig({ TRUST_PROXY: 'true' }, []).TRUST_PROXY, 1);
  assert.equal(loadConfig({ TRUST_PROXY: '0' }, []).TRUST_PROXY, 0);
  assert.equal(loadConfig({ ANTHROPIC_API_KEY: 'k', MISE_LLM_MODEL: 'm' }, []).llmEnabled, true);
  assert.ok(Object.isFrozen(c));
});
