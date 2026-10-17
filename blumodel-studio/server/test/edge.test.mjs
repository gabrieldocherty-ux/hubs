// The public edge (launch): behind the Cloudflare tunnel every request arrives from 127.0.0.1, so
// with TRUST_PROXY=1 the real visitor is CF-Connecting-IP (else the first X-Forwarded-For hop),
// believed ONLY from a loopback peer; Secure cookies and HSTS follow https; robots.txt; per-real-IP
// rate limits on signup, login, uploads, leads and photo analysis; and request limits sensible for
// the public internet (slowloris header and request timeouts, header size, body caps).
// clientIp() and isHttps() themselves are unit-tested in auth.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { startTestServer } from './helpers.mjs';
import { HTTP_LIMITS, createHttpServer } from '../http/listen.mjs';
import { ROBOTS } from '../routes/ops.mjs';

test('robots.txt: crawl the app, not /api or /files', async () => {
  const s = await startTestServer();
  try {
    const r = await s.agent().get('/robots.txt');
    assert.equal(r.status, 200);
    assert.equal(r.text, 'User-agent: *\nAllow: /\nDisallow: /api\nDisallow: /files\n');
    assert.equal(r.text, ROBOTS);
    assert.equal(r.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(r.headers.get('cache-control'), 'public, max-age=86400');
    const h = await s.agent().head('/robots.txt');
    assert.equal(h.status, 200);
    assert.equal(h.text, '');
  } finally {
    await s.close();
  }
});

const signup = (s, i, headers = {}) => s.agent().post('/api/auth/signup', { name: 'Edge', email: `edge${i}-${Date.now()}@test.blumodel`, password: 'password123' }, { headers });

test('TRUST_PROXY=1: each visitor behind the tunnel has their own budget (CF-Connecting-IP, else the first X-Forwarded-For hop)', async () => {
  const s = await startTestServer({ rateLimits: true, env: { TRUST_PROXY: '1' } });
  try {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await signup(s, i, { 'CF-Connecting-IP': '203.0.113.10' })).status);
    assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
    assert.equal((await signup(s, 10, { 'CF-Connecting-IP': '203.0.113.11' })).status, 201, 'another visitor is not held up');
    assert.equal((await signup(s, 11, { 'X-Forwarded-For': '198.51.100.7, 10.0.0.1' })).status, 201, 'X-Forwarded-For when there is no CF header');
    // The CF header wins over X-Forwarded-For, so the spent budget can't be dodged by adding one.
    assert.equal((await signup(s, 12, { 'CF-Connecting-IP': '203.0.113.10', 'X-Forwarded-For': '198.51.100.99' })).status, 429);
  } finally {
    await s.close();
  }
});

test('TRUST_PROXY off: forwarding headers are ignored, so a client can’t pick a fresh budget by sending one', async () => {
  const s = await startTestServer({ rateLimits: true });
  try {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await signup(s, i, { 'CF-Connecting-IP': `203.0.113.${20 + i}`, 'X-Forwarded-For': `198.51.100.${i}` })).status);
    assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
  } finally {
    await s.close();
  }
});

test('signup, login, uploads and leads each carry a per-real-IP rate limit', async () => {
  const s = await startTestServer();
  try {
    const want = [
      ['POST', '/api/auth/signup'],
      ['POST', '/api/auth/login'],
      ['PUT', '/api/files'],
      ['POST', '/api/brands/by-slug/:slug/leads'],
      ['POST', '/api/account/delete'],
    ];
    for (const [method, p] of want) {
      const r = s.ctx.routes.find((x) => x.method === method && x.path === p);
      assert.ok(r, `${method} ${p} exists`);
      const ip = r.rateLimits.filter((l) => l.by === 'ip');
      assert.ok(ip.length, `${method} ${p} has a per-IP limit: ${JSON.stringify(r.rateLimits)}`);
      for (const l of ip) assert.ok(l.max > 0 && l.max <= 300 && l.windowMs >= 3_600_000 / 4, `${method} ${p}: ${JSON.stringify(l)}`);
    }
  } finally {
    await s.close();
  }
});

test('Secure cookie and HSTS follow https: through a loopback proxy saying https, both; over plain http, neither', async () => {
  const s = await startTestServer({ env: { NODE_ENV: 'production', DEMO_PAYMENTS: '1', TRUST_PROXY: '1' } });
  try {
    const tls = await signup(s, 1, { 'X-Forwarded-Proto': 'https' });
    assert.equal(tls.status, 201);
    assert.match(tls.headers.get('set-cookie'), /^blumodel_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=\d+; Secure$/);
    assert.equal(tls.headers.get('strict-transport-security'), 'max-age=31536000');
    const plain = await signup(s, 2);
    assert.doesNotMatch(plain.headers.get('set-cookie'), /Secure/);
    assert.equal(plain.headers.get('strict-transport-security'), null);
  } finally {
    await s.close();
  }
  // TRUST_PROXY off: a loopback peer saying https is not believed either.
  const off = await startTestServer({ env: { NODE_ENV: 'production', DEMO_PAYMENTS: '1' } });
  try {
    const r = await signup(off, 3, { 'X-Forwarded-Proto': 'https' });
    assert.equal(r.status, 201);
    assert.doesNotMatch(r.headers.get('set-cookie'), /Secure/);
    assert.equal(r.headers.get('strict-transport-security'), null);
  } finally {
    await off.close();
  }
});

test('links are built from PUBLIC_URL, never from the request: no Host or X-Forwarded-Host reaches a response', async () => {
  const s = await startTestServer({ env: { PUBLIC_URL: 'https://blumodel.example', TRUST_PROXY: '1' } });
  try {
    const hdrs = { Host: 'evil.example', 'X-Forwarded-Host': 'evil.example' };
    const cfg = await s.agent().get('/api/config', { headers: hdrs });
    assert.equal(cfg.body.publicUrl, 'https://blumodel.example');
    assert.ok(!cfg.text.includes('evil.example'));
    const robots = await s.agent().get('/robots.txt', { headers: hdrs });
    assert.ok(!robots.text.includes('evil.example'));
  } finally {
    await s.close();
  }
});

test('bodies are capped per route: a 1 MB+ signup is a 413 (and the connection is closed, not reused)', async () => {
  const s = await startTestServer();
  try {
    const r = await s.agent().post('/api/auth/signup', { name: 'x'.repeat(1_100_000), email: 'big@test.blumodel', password: 'password123' });
    assert.equal(r.status, 413);
    assert.equal(r.headers.get('connection'), 'close');
    const del = s.ctx.routes.find((x) => x.path === '/api/account/delete');
    assert.equal(del.maxBytes, 4096);
  } finally {
    await s.close();
  }
});

// ── the HTTP server's own limits ─────────────────────────────────────────

/** Opens a raw socket, writes `text`, and resolves with what came back once the server closes it. */
function rawSocket(port, text, { endAfterMs = 6000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const sock = net.connect(port, '127.0.0.1');
    let got = '';
    const timer = setTimeout(() => {
      sock.destroy();
      resolve({ got, closed: false, ms: Date.now() - started });
    }, endAfterMs);
    sock.on('data', (d) => (got += d));
    sock.on('error', () => {});
    sock.on('close', () => {
      clearTimeout(timer);
      resolve({ got, closed: true, ms: Date.now() - started });
    });
    sock.write(text);
  });
}

test('the HTTP limits: 20 s for headers, 5 min per request, 5 s keep-alive, 16 KB of headers, 1000 sockets', () => {
  assert.deepEqual({ ...HTTP_LIMITS }, { headersTimeout: 20_000, requestTimeout: 300_000, keepAliveTimeout: 5_000, maxHeaderSize: 16_384, maxHeadersCount: 100, maxRequestsPerSocket: 1_000, maxConnections: 1_000, connectionsCheckingInterval: 5_000 });
  const server = createHttpServer(() => {});
  assert.equal(server.headersTimeout, 20_000);
  assert.equal(server.requestTimeout, 300_000);
  assert.equal(server.keepAliveTimeout, 5_000);
  assert.equal(server.maxHeadersCount, 100);
  assert.equal(server.maxRequestsPerSocket, 1_000);
  assert.equal(server.maxConnections, 1_000);
});

test('slowloris: a client that never finishes its headers, or stalls mid-body, is answered 408 and cut off; oversized headers get 431', async () => {
  const s = await startTestServer();
  // The real app's handler on a server with the real limit logic but short timeouts.
  const server = createHttpServer(s.server.listeners('request')[0], { headersTimeout: 600, requestTimeout: 1500, connectionsCheckingInterval: 100 });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = /** @type {net.AddressInfo} */ (server.address());
  try {
    const slowHeaders = await rawSocket(port, 'GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Slow: 1\r\n');
    assert.equal(slowHeaders.closed, true, 'the server hung up');
    assert.match(slowHeaders.got, /^HTTP\/1\.1 408 /);
    assert.ok(slowHeaders.ms < 4000, `${slowHeaders.ms} ms`);

    const slowBody = await rawSocket(port, 'POST /api/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\nX-BluModel: 1\r\nContent-Type: application/json\r\nContent-Length: 200\r\n\r\n{"email":');
    assert.equal(slowBody.closed, true);
    assert.ok(slowBody.ms < 5000, `${slowBody.ms} ms`);

    const huge = await rawSocket(port, `GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Big: ${'a'.repeat(20_000)}\r\n\r\n`);
    assert.match(huge.got, /^HTTP\/1\.1 431 /);

    // A normal request on the same server is fine.
    const ok = await rawSocket(port, 'GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
    assert.match(ok.got, /^HTTP\/1\.1 200 /);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await s.close();
  }
});
