// The route table: duplicate routes, the CSRF gate, auth levels, precedence, 404/405.

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { createApp } from '../app.mjs';
import { ROUTE_MODULES, ROUTE_MODULE_NAMES } from '../routes/index.mjs';
import { startTestServer, silentLog } from './helpers.mjs';

const baseConfig = () => loadConfig({ DB_PATH: ':memory:', UPLOAD_DIR: path.join(os.tmpdir(), 'mise-router-test-uploads'), RATE_LIMITS: 'off' }, []);

function appWith(extra) {
  const db = openDb(':memory:');
  migrate(db);
  const modules = [...ROUTE_MODULES.map((fn, i) => ({ name: ROUTE_MODULE_NAMES[i], fn })), ...extra];
  return createApp({ config: baseConfig(), db, routeModules: modules, log: silentLog });
}

test('a duplicate method + path across modules throws at startup', () => {
  assert.throws(() => appWith([{ name: 'dupe', fn: () => [{ method: 'GET', path: '/api/auth/me', auth: 'none', handler: () => ({}) }] }]), /Duplicate route GET \/api\/auth\/me/);
  // Same shape with a different parameter name is still a duplicate.
  assert.throws(
    () =>
      appWith([
        { name: 'a', fn: () => [{ method: 'GET', path: '/api/x/:id', handler: () => ({}) }] },
        { name: 'b', fn: () => [{ method: 'GET', path: '/api/x/:other', handler: () => ({}) }] },
      ]),
    /Duplicate route/,
  );
  // Different methods on one path are fine.
  assert.doesNotThrow(() => appWith([{ name: 'ok', fn: () => [{ method: 'DELETE', path: '/api/config', auth: 'admin', handler: () => ({}) }] }]));
});

test('malformed routes throw at startup', () => {
  assert.throws(() => appWith([{ name: 'm', fn: () => [{ method: 'FETCH', path: '/api/x', handler: () => ({}) }] }]), /method/);
  assert.throws(() => appWith([{ name: 'm', fn: () => [{ method: 'GET', path: 'api/x', handler: () => ({}) }] }]), /path/);
  assert.throws(() => appWith([{ name: 'm', fn: () => [{ method: 'GET', path: '/api/x', auth: 'root', handler: () => ({}) }] }]), /auth/);
  assert.throws(() => appWith([{ name: 'm', fn: () => ({}) }]), /must return an array/);
});

let t;
before(async () => {
  t = await startTestServer();
});
after(async () => {
  await t?.close();
});

/** A server with probe routes for each auth level and for precedence. */
async function probeServer() {
  const db = openDb(':memory:');
  migrate(db);
  const probe = {
    name: 'probe',
    fn: () => [
      { method: 'GET', path: '/api/probe/none', auth: 'none', handler: () => ({ level: 'none' }) },
      { method: 'GET', path: '/api/probe/optional', auth: 'optional', handler: (rc) => ({ user: rc.user?.id ?? null }) },
      { method: 'GET', path: '/api/probe/user', handler: (rc) => ({ user: rc.user.id }) },
      { method: 'GET', path: '/api/probe/studio', auth: 'studio', handler: () => ({ ok: true }) },
      { method: 'GET', path: '/api/probe/admin', auth: 'admin', handler: () => ({ ok: true }) },
      { method: 'GET', path: '/api/probe/item/:id', auth: 'none', handler: (rc) => ({ param: rc.params.id }) },
      { method: 'GET', path: '/api/probe/item/special', auth: 'none', handler: () => ({ static: true }) },
      { method: 'POST', path: '/api/probe/write', auth: 'none', handler: (rc) => ({ got: rc.body }) },
      { method: 'POST', path: '/api/probe/nocsrf', auth: 'none', csrf: false, body: 'raw', handler: (rc) => ({ bytes: rc.body.length }) },
      { method: 'POST', path: '/api/probe/empty', auth: 'none', body: 'none', handler: () => undefined },
    ],
  };
  const modules = [...ROUTE_MODULES.map((fn, i) => ({ name: ROUTE_MODULE_NAMES[i], fn })), probe];
  const { handler } = createApp({ config: baseConfig(), db, routeModules: modules, log: silentLog });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, db, close: () => new Promise((r) => (server.closeAllConnections(), server.close(r))) };
}

test('auth levels: none, optional, user, studio, admin', async () => {
  const p = await probeServer();
  try {
    const get = (path, cookie) => fetch(p.url + path, { headers: cookie ? { cookie } : {} });
    // Create users in the probe server's own DB by signing up there.
    const signup = async (email) => {
      const r = await fetch(p.url + '/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-mise': '1' }, body: JSON.stringify({ name: 'P', email, password: 'password123' }) });
      assert.equal(r.status, 201);
      return { cookie: r.headers.getSetCookie()[0].split(';')[0], id: (await r.json()).user.id };
    };
    const cust = await signup('cust@probe.test');
    const studio = await signup('studio@probe.test');
    const admin = await signup('admin@probe.test');
    p.db.prepare("UPDATE users SET role = 'studio' WHERE id = ?").run(studio.id);
    p.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);

    assert.equal((await get('/api/probe/none')).status, 200);
    assert.deepEqual(await (await get('/api/probe/optional')).json(), { user: null });
    assert.deepEqual(await (await get('/api/probe/optional', cust.cookie)).json(), { user: cust.id });
    const anonUser = await get('/api/probe/user');
    assert.equal(anonUser.status, 401);
    assert.deepEqual(await anonUser.json(), { error: 'Please sign in.' });
    assert.equal((await get('/api/probe/user', cust.cookie)).status, 200);
    assert.equal((await get('/api/probe/studio', cust.cookie)).status, 403);
    assert.equal((await get('/api/probe/studio', studio.cookie)).status, 200);
    assert.equal((await get('/api/probe/studio', admin.cookie)).status, 200, 'admin passes studio routes');
    assert.equal((await get('/api/probe/admin', studio.cookie)).status, 403);
    assert.equal((await get('/api/probe/admin', admin.cookie)).status, 200);
    assert.equal((await get('/api/probe/admin')).status, 401);
  } finally {
    await p.close();
  }
});

test('static segments win over params; params reject odd characters', async () => {
  const p = await probeServer();
  try {
    assert.deepEqual(await (await fetch(p.url + '/api/probe/item/special')).json(), { static: true });
    assert.deepEqual(await (await fetch(p.url + '/api/probe/item/abc-123_X')).json(), { param: 'abc-123_X' });
    assert.equal((await fetch(p.url + '/api/probe/item/a.b')).status, 404);
    assert.equal((await fetch(p.url + '/api/probe/item/' + 'x'.repeat(81))).status, 404);
  } finally {
    await p.close();
  }
});

test('CSRF gate: writes need X-Mise: 1 unless the route opts out', async () => {
  const p = await probeServer();
  try {
    const post = (path, headers, body = '{"a":1}') => fetch(p.url + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    const missing = await post('/api/probe/write', {});
    assert.equal(missing.status, 403);
    assert.deepEqual(await missing.json(), { error: 'Missing request header.' });
    assert.equal((await post('/api/probe/write', { 'x-mise': '0' })).status, 403);
    const ok = await post('/api/probe/write', { 'x-mise': '1' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { got: { a: 1 } });
    const nocsrf = await post('/api/probe/nocsrf', {}, 'raw bytes');
    assert.equal(nocsrf.status, 200, 'csrf:false route works without the header');
    assert.deepEqual(await nocsrf.json(), { bytes: 9 });
    // Every real foundation write still needs the header.
    for (const [m, path] of [['POST', '/api/auth/login'], ['POST', '/api/auth/signup'], ['POST', '/api/auth/logout'], ['POST', '/api/projects'], ['PUT', '/api/files'], ['POST', '/api/events']]) {
      const r = await fetch(p.url + path, { method: m, headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(r.status, 403, `${m} ${path}`);
    }
  } finally {
    await p.close();
  }
});

test('a handler returning undefined is a 204 with no body', async () => {
  const p = await probeServer();
  try {
    const r = await fetch(p.url + '/api/probe/empty', { method: 'POST', headers: { 'x-mise': '1' } });
    assert.equal(r.status, 204);
    assert.equal(await r.text(), '');
  } finally {
    await p.close();
  }
});

test('404 for unknown /api paths, 405 (with Allow) for the wrong method, OPTIONS → 405', async () => {
  const anon = t.agent();
  const nf = await anon.get('/api/nope');
  assert.equal(nf.status, 404);
  assert.deepEqual(nf.body, { error: 'Not found.' });
  assert.equal((await anon.post('/api/nope', {})).status, 404);
  const wrong = await anon.delete('/api/auth/me');
  assert.equal(wrong.status, 405);
  assert.match(wrong.headers.get('allow'), /GET/);
  assert.match(wrong.headers.get('allow'), /PATCH/);
  const dup = await anon.get('/api/projects/00000000-0000-0000-0000-000000000000/duplicate');
  assert.equal(dup.status, 405);
  const opt = await anon.request('OPTIONS', '/api/auth/me');
  assert.equal(opt.status, 405);
  const opt2 = await anon.request('OPTIONS', '/');
  assert.equal(opt2.status, 405);
});
