// The site-wide on/off switch (server/ops/sitesSwitch.mjs), the server face (server/face/face.mjs)
// and `blumodel sites` (scripts/host/blumodel.mjs): maintenance on every kind of host, what stays
// reachable while off, persistence, the audit, loopback enforcement, the token and the PIN.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './helpers.mjs';
import { createSitesSwitch, maintenanceGate, readSwitch, switchFileFor } from '../ops/sitesSwitch.mjs';
import { createFace, facePort, startFace } from '../face/face.mjs';
import { statusLines, tokenOf } from '../../scripts/host/blumodel.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const silent = { info() {}, warn() {}, error() {} };

test('the gate: what an OFF switch lets through, by host kind', () => {
  const g = (method, pathname, siteKind, admin = false) => maintenanceGate({ method, pathname, siteKind, isAdmin: () => admin });
  for (const kind of ['sales', 'showroom', 'unknown']) {
    assert.equal(g('GET', '/api/health', kind), 'pass', `${kind}: health`);
    assert.equal(g('GET', '/api/config', kind), 'pass', `${kind}: config`);
    assert.equal(g('POST', '/api/webhooks/stripe', kind), 'pass', `${kind}: webhooks`);
    assert.equal(g('GET', '/', kind), 'page', `${kind}: the page`);
    assert.equal(g('GET', '/api/projects', kind), 'api');
    assert.equal(g('POST', '/', kind), 'api');
  }
  // The sales site: sign-in and the app at /admin for anyone; everything for an admin.
  assert.equal(g('POST', '/api/auth/signin', 'sales'), 'pass');
  assert.equal(g('GET', '/admin', 'sales'), 'pass');
  assert.equal(g('GET', '/assets/index-abc123.js', 'sales'), 'pass');
  assert.equal(g('GET', '/files/abc/photo.jpg', 'sales'), 'page', 'uploads are not static app files');
  assert.equal(g('GET', '/', 'sales', true), 'pass', 'an admin sees the site');
  assert.equal(g('POST', '/api/admin/system/sites', 'sales', true), 'pass');
  // Never on a showroom: an admin session is the sales site's; sign-in there is the showroom's.
  assert.equal(g('POST', '/api/auth/signin', 'showroom'), 'api');
  assert.equal(g('GET', '/admin', 'showroom'), 'page');
  assert.equal(g('GET', '/', 'showroom', true), 'page');
});

test('the state survives a restart (data/sites-switch.json), is audited, and an in-memory database keeps it in memory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-sw-'));
  try {
    const file = switchFileFor(path.join(dir, 'blumodel.db'));
    assert.equal(file, path.join(dir, 'sites-switch.json'));
    assert.equal(switchFileFor(':memory:'), null);
    const rows = [];
    const db = { prepare: () => ({ run: (...a) => rows.push(a) }) };
    const a = createSitesSwitch({ db, file, now: () => 1000, log: silent });
    assert.equal(a.isOn(), true);
    const r = a.set(false, { via: 'face' });
    assert.deepEqual([r.on, r.changed, r.via, r.since], [false, true, 'face', 1000]);
    assert.deepEqual(readSwitch(file), { on: false, since: 1000, by: 'face', via: 'face' });
    const b = createSitesSwitch({ db, file, log: silent });
    assert.equal(b.isOn(), false, 'still off after a restart');
    assert.equal(b.set(false, { via: 'cli' }).changed, false);
    b.set(true, { via: 'admin', admin: { id: 'u1', email: 'gabe@example.test' } });
    assert.equal(readSwitch(file).by, 'gabe@example.test');
    assert.equal(rows.length, 3, 'every press is audited, a no-op too');
    assert.ok(rows.some((x) => x.includes('sites_off')) && rows.some((x) => x.includes('sites_on')));
    assert.throws(() => b.set('off', { via: 'face' }), /true or false/);
    assert.throws(() => b.set(true, { via: 'web' }), /not a source/);
    fs.writeFileSync(file, 'garbage');
    assert.equal(readSwitch(file).on, true, 'an unreadable file means on');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('OFF on a live server: every host answers the maintenance page or 503 maintenance; health, config, webhooks and the sales site’s sign-in still answer; an admin turns it back on from Admin > System', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const tn = t.services.tenants.create({ name: 'Acme Kitchens', slug: 'acme', status: 'live' });
    t.services.tenants.addHostname(tn.id, 'showroom.acme.test', { kind: 'custom', verified: true });
    const sales = t.agent();
    const showroom = t.agent({ host: t.hostFor('acme') });
    const custom = t.agent({ host: `showroom.acme.test:${t.port}` });
    const unknown = t.agent({ host: t.hostFor('nobody') });
    assert.equal((await sales.get('/api/health')).body.maintenance, undefined);

    t.ctx.sitesSwitch.set(false, { via: 'face' });
    for (const [who, a] of [['sales', sales], ['showroom', showroom], ['custom domain', custom], ['unknown host', unknown]]) {
      const page = await a.get('/');
      assert.equal(page.status, 503, `${who}: the page`);
      assert.match(page.text, /We’ll be right back/);
      assert.equal(page.headers.get('retry-after'), '600');
      assert.match(page.headers.get('content-type'), /text\/html/);
      const api = await a.get('/api/catalog/products');
      assert.equal(api.status, 503, `${who}: the API`);
      assert.equal(api.body.code, 'maintenance');
      assert.equal(api.headers.get('retry-after'), '600');
      if (who === 'unknown host') continue; // no site there: its health and config are a 404 as always
      const health = await a.get('/api/health');
      assert.equal(health.status, 200, `${who}: health`);
      assert.equal(health.body.maintenance, true);
      assert.equal((await a.get('/api/config')).status, 200, `${who}: config`);
      assert.notEqual((await a.request('POST', '/api/webhooks/stripe', { body: {}, csrf: false })).body?.code, 'maintenance', `${who}: webhooks are not blocked (here Stripe is simply off)`);
    }
    assert.notEqual((await sales.get('/api/auth/me')).body?.code, 'maintenance', 'sign-in still works on the sales site');
    assert.equal((await showroom.get('/api/auth/me')).status, 503, 'but not on a showroom');
    assert.notEqual((await sales.get('/admin')).status, 503, 'the app at /admin');

    // The admin, signed in on the sales site: everything there answers, and the switch is on Admin > System.
    const sys = await admin.get('/api/admin/system');
    assert.equal(sys.status, 200);
    assert.equal(sys.body.sites.on, false);
    assert.equal(sys.body.sites.via, 'face');
    assert.equal((await admin.post('/api/admin/system/sites', { on: 'yes' })).status, 400);
    const on = await admin.post('/api/admin/system/sites', { on: true });
    assert.equal(on.status, 200, on.text);
    assert.deepEqual([on.body.sites.on, on.body.changed, on.body.sites.via, on.body.sites.by], [true, true, 'admin', admin.user.email]);
    assert.notEqual((await showroom.get('/api/catalog/products')).body?.code, 'maintenance');
    assert.notEqual((await sales.get('/api/catalog/products')).status, 503, 'back on');
    assert.equal((await sales.get('/api/health')).body.maintenance, undefined);
    const audit = t.db.prepare("SELECT action, admin_email, detail FROM admin_audit WHERE action IN ('sites_on', 'sites_off') ORDER BY id").all();
    assert.deepEqual(audit.map((r) => [r.action, r.admin_email, JSON.parse(r.detail).via]), [['sites_off', '', 'face'], ['sites_on', admin.user.email, 'admin']]);
    const customer = await t.user();
    assert.equal((await customer.post('/api/admin/system/sites', { on: false })).status, 403);
  } finally {
    await t.close();
  }
});

/** A face handler on its own listener (port 0, loopback), as index.mjs starts it. */
async function faceServer(ctx, opts = {}) {
  const { handler, token } = createFace({ ctx, ...opts });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const req = (method, p, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const data = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
      const r = http.request({ host: '127.0.0.1', port, method, path: p, agent: false, headers: { Connection: 'close', ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (text += d));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, body: json });
        });
      });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  return { server, port, token, req, close: () => new Promise((r) => server.close(r)) };
}

test('the face: the page (token, CSP, every site listed), status, the switch with its token; a non-loopback Host or peer is refused', async () => {
  const t = await startTestServer();
  const f = await faceServer(t.ctx);
  try {
    t.services.tenants.create({ name: 'Acme Kitchens', slug: 'acme', status: 'live' });
    const page = await f.req('GET', '/');
    assert.equal(page.status, 200);
    assert.equal(tokenOf(page.text), f.token);
    assert.match(page.headers['content-security-policy'], /default-src 'none'; script-src 'nonce-[^']+'/);
    assert.equal(page.headers['x-frame-options'], 'DENY');
    assert.match(page.text, /Turn all sites OFF/);
    assert.match(page.text, /Acme Kitchens/);
    assert.match(page.text, /acme\.localhost/);
    const s = (await f.req('GET', '/status')).body;
    assert.equal(s.sitesOn, true);
    assert.equal(s.pinRequired, false);
    assert.ok(s.sites.some((x) => x.kind === 'sales') && s.sites.some((x) => x.address === 'acme.localhost' && x.status === 'live'));
    assert.ok(Number.isInteger(s.memoryMb) && s.memoryMb > 0);
    for (const k of ['uptimeSec', 'commit', 'lastBackupAt', 'update']) assert.ok(k in s, k);

    // DNS rebinding: a page on evil.example resolving to 127.0.0.1 still sends its own Host.
    assert.equal((await f.req('GET', '/', { headers: { Host: 'evil.example:8799' } })).status, 421);
    assert.equal((await f.req('GET', '/status', { headers: { Host: `localhost:${f.port}` } })).status, 200);
    // No token, a wrong one, another origin, not JSON: refused, nothing changed.
    assert.equal((await f.req('POST', '/sites', { body: { on: false } })).status, 403);
    assert.equal((await f.req('POST', '/sites', { body: { on: false }, headers: { 'X-Face-Token': 'nope' } })).status, 403);
    assert.equal((await f.req('POST', '/sites', { body: { on: false }, headers: { 'X-Face-Token': f.token, Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await f.req('POST', '/sites', { body: 'on=false', headers: { 'X-Face-Token': f.token, 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal(t.ctx.sitesSwitch.isOn(), true);
    const off = await f.req('POST', '/sites', { body: { on: false }, headers: { 'X-Face-Token': f.token, Origin: `http://127.0.0.1:${f.port}` } });
    assert.equal(off.status, 200, off.text);
    assert.equal(off.body.sitesOn, false);
    assert.ok(off.body.sites.every((x) => !x.up));
    assert.equal(t.ctx.sitesSwitch.state().via, 'face');

    // A peer that isn't loopback (the listener bound wider by mistake): refused before anything.
    let code = 0;
    const fake = { headers: { host: '127.0.0.1:8799' }, url: '/status', method: 'GET', socket: { remoteAddress: '192.168.1.20' } };
    const res = { writeHead: (c) => (code = c), end: () => {} };
    createFace({ ctx: t.ctx }).handler(fake, res);
    assert.equal(code, 403);
  } finally {
    await f.close();
    await t.close();
  }
});

test('the face’s PIN (SERVER_FACE_PIN): required when set, five wrong tries lock it for five minutes', async () => {
  const t = await startTestServer();
  let clock = 1_000_000;
  const f = await faceServer(t.ctx, { pin: '4821', now: () => clock });
  try {
    const post = (body) => f.req('POST', '/sites', { body, headers: { 'X-Face-Token': f.token } });
    assert.equal((await f.req('GET', '/status')).body.pinRequired, true);
    assert.equal((await post({ on: false })).body.code, 'bad_pin');
    assert.equal((await post({ on: false, pin: '4821' })).status, 200);
    assert.equal(t.ctx.sitesSwitch.isOn(), false);
    for (let i = 0; i < 5; i++) assert.equal((await post({ on: true, pin: '0000' })).status, 403);
    const locked = await post({ on: true, pin: '4821' });
    assert.equal(locked.status, 429, 'locked even with the right PIN');
    clock += 5 * 60_000 + 1;
    assert.equal((await post({ on: true, pin: '4821' })).status, 200);
    assert.equal(t.ctx.sitesSwitch.isOn(), true);
  } finally {
    await f.close();
    await t.close();
  }
});

test('the face listens on 127.0.0.1 only; SERVER_FACE_PORT: 8799 in production, off in development, 0 turns it off', async () => {
  assert.equal(facePort({}, { prod: true }), 8799);
  assert.equal(facePort({}, { prod: false }), 0);
  assert.equal(facePort({ SERVER_FACE_PORT: '0' }, { prod: true }), 0);
  assert.equal(facePort({ SERVER_FACE_PORT: '8936' }), 8936);
  assert.equal(facePort({ SERVER_FACE_PORT: 'eighty' }), null);
  const t = await startTestServer();
  const s = startFace({ ctx: t.ctx, port: 8936, log: silent });
  try {
    await new Promise((r) => (s.listening ? r() : s.once('listening', r)));
    assert.equal(s.address().address, '127.0.0.1');
    assert.equal(startFace({ ctx: t.ctx, port: 0, log: silent }), null);
  } finally {
    await new Promise((r) => s.close(r));
    await t.close();
  }
});

test('`blumodel sites status|off|on` drives the face from the command line (audited as the command line)', async () => {
  const t = await startTestServer();
  const f = await faceServer(t.ctx);
  const cli = (...a) =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'host', 'blumodel.mjs'), ...a, '--port', String(f.port)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let out = '';
      let err = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err += d));
      p.on('close', (code) => resolve({ code, out, err }));
    });
  try {
    let r = await cli('sites', 'status');
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /All sites are ON/);
    r = await cli('sites', 'off', '--yes');
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Done: all sites are OFF/);
    assert.equal(t.ctx.sitesSwitch.state().via, 'cli');
    r = await cli('sites', 'on');
    assert.match(r.out, /all sites are ON/);
    assert.equal((await cli('sites', 'reboot')).code, 2);
    assert.equal((await cli('nonsense')).code, 2);
    assert.match(statusLines({ sitesOn: false, sites: [{ up: false, address: 'blumodel.studio', name: 'Sales site', label: 'Live' }], memoryMb: 80, uptimeSec: 60 }).join('\n'), /OFF \(maintenance/);
  } finally {
    await f.close();
    await t.close();
  }
  const dead = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'scripts', 'host', 'blumodel.mjs'), 'sites', 'status', '--port', '8937'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, err }));
  });
  assert.equal(dead.code, 1);
  assert.match(dead.err, /Could not reach the server face/);
});

test('the face’s Update now: the same trigger as Admin > System, with the token, the PIN when set, an audit row, and the live progress in /status', async () => {
  const t = await startTestServer();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-faceup-'));
  fs.mkdirSync(path.join(home, 'logs'));
  t.ctx.home = home;
  const f = await faceServer(t.ctx, { pin: '4821' });
  try {
    const post = (body, headers = { 'X-Face-Token': f.token }) => f.req('POST', '/update', { body, headers });
    assert.equal((await post({ pin: '4821' }, {})).status, 403, 'no token');
    assert.equal((await post({ pin: '4821' }, { 'X-Face-Token': f.token, Origin: 'https://evil.example' })).status, 403, 'another origin');
    assert.equal((await post({})).body.code, 'bad_pin');
    let r = await post({ pin: '4821' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'not_installed');
    fs.writeFileSync(path.join(home, 'auto-update.conf'), 'AUTO_UPDATE=on\nAUTO_UPDATE_TIME=04:00\n');
    r = await post({ pin: '4821' });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.requested, true);
    assert.equal(r.body.update.pending, true);
    assert.ok(fs.existsSync(path.join(home, 'logs', 'update-now.request')));
    const row = t.db.prepare("SELECT detail FROM admin_audit WHERE action = 'update_now'").get();
    assert.deepEqual(JSON.parse(row.detail), { via: 'face', alreadyPending: false });
    // The updater's progress, as the page follows it.
    const at = new Date().toISOString();
    fs.writeFileSync(path.join(home, 'logs', 'update-progress.json'), JSON.stringify({ stage: 'deploying', at, startedAt: at, to: 'b'.repeat(40) }));
    let p = (await f.req('GET', '/status')).body.update.progress;
    assert.deepEqual([p.stage, p.to], ['deploying', 'b'.repeat(40)]);
    fs.writeFileSync(path.join(home, 'logs', 'update-progress.json'), JSON.stringify({ stage: 'finished', at, startedAt: at, outcome: 'current' }));
    p = (await f.req('GET', '/status')).body.update.progress;
    assert.deepEqual([p.stage, p.outcome], ['finished', 'current']);
    // Loopback only, like everything on the face.
    let code = 0;
    createFace({ ctx: t.ctx }).handler({ headers: { host: '127.0.0.1' }, url: '/update', method: 'POST', socket: { remoteAddress: '10.0.0.7' } }, { writeHead: (c) => (code = c), end() {} });
    assert.equal(code, 403);
  } finally {
    await f.close();
    await t.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
