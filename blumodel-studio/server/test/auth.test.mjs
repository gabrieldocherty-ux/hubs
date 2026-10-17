// Accounts and sessions: the existing flows, plus roles, rate limits, async scrypt,
// ADMIN_EMAILS (which grants nothing), make-admin and the Secure-cookie rule.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './helpers.mjs';
import { isHttps, secureAttr } from '../auth/sessions.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { hashPassword } from '../auth/passwords.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let t;
before(async () => {
  t = await startTestServer();
});
after(async () => {
  await t?.close();
});

test('signup → 201 with role, brands and plan, an httpOnly SameSite=Lax cookie, no Secure over http', async () => {
  const a = t.agent();
  const r = await a.post('/api/auth/signup', { name: '  Ada  ', email: 'ADA@Example.com', password: 'password123' });
  assert.equal(r.status, 201);
  // `showroom` (tenancy): null on the sales site, { tenantId, role } on a showroom.
  assert.deepEqual(Object.keys(r.body.user).sort(), ['brands', 'contractor', 'email', 'id', 'name', 'plan', 'role', 'showroom']);
  assert.equal(r.body.user.showroom, null);
  assert.equal(r.body.user.email, 'ada@example.com');
  assert.equal(r.body.user.name, 'Ada');
  assert.equal(r.body.user.role, 'customer');
  assert.deepEqual(r.body.user.brands, []);
  assert.equal(r.body.user.plan.id, 'free', 'a new account is on the Free plan');
  assert.equal(r.body.user.contractor, null);
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /^blumodel_session=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=(2591999|2592000)$/);
  const me = await a.get('/api/auth/me');
  assert.equal(me.body.user.id, r.body.user.id);
  const row = t.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(r.body.user.id);
  assert.match(row.password_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  const sessions = t.db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').all(r.body.user.id);
  assert.equal(sessions.length, 1);
  assert.notEqual(sessions[0].token_hash, a.cookies.get('blumodel_session'), 'only the hash is stored');
});

test('signup validation and duplicate email (messages unchanged)', async () => {
  const a = t.agent();
  const cases = [
    [{ name: '', email: 'x@y.co', password: 'password123' }, 400, 'Tell us your name.'],
    [{ name: 'X', email: 'nope', password: 'password123' }, 400, 'That email address does not look right.'],
    [{ name: 'X', email: 'x@y.co', password: 'short' }, 400, 'Use at least 8 characters for your password.'],
    [{ name: 'X', email: 'x@y.co', password: 'p'.repeat(201) }, 400, 'That password is too long.'],
  ];
  for (const [body, status, error] of cases) {
    const r = await a.post('/api/auth/signup', body);
    assert.equal(r.status, status);
    assert.deepEqual(r.body, { error });
  }
  const u = await t.user();
  const dup = await t.agent().post('/api/auth/signup', { name: 'Again', email: u.user.email.toUpperCase(), password: 'password123' });
  assert.equal(dup.status, 409);
  assert.deepEqual(dup.body, { error: 'An account with that email already exists. Try signing in.' });
});

test('login, me, patch me, logout', async () => {
  const u = await t.user();
  const a = t.agent();
  const wrong = await a.post('/api/auth/login', { email: u.user.email, password: 'wrong password' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(wrong.body, { error: 'That email and password do not match.' });
  const unknown = await a.post('/api/auth/login', { email: 'nobody@test.blumodel', password: 'whatever123' });
  assert.equal(unknown.status, 401);
  const ok = await a.post('/api/auth/login', { email: u.user.email, password: u.user.password });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.id, u.user.id);
  assert.equal(ok.body.user.role, 'customer');
  assert.deepEqual((await t.agent().get('/api/auth/me')).body, { user: null });
  const renamed = await a.patch('/api/auth/me', { name: '  New Name ' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.user.name, 'New Name');
  assert.equal(renamed.body.user.role, 'customer');
  assert.deepEqual((await a.patch('/api/auth/me', { name: '   ' })).body, { error: 'Name cannot be empty.' });
  const out = await a.post('/api/auth/logout');
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true });
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  assert.deepEqual((await a.get('/api/auth/me')).body, { user: null });
  assert.equal((await a.patch('/api/auth/me', { name: 'x' })).status, 401);
});

test('password change keeps this session and revokes the others', async () => {
  const u = await t.user();
  const other = t.agent();
  await other.post('/api/auth/login', { email: u.user.email, password: u.user.password });
  assert.ok((await other.get('/api/auth/me')).body.user);
  const bad = await u.post('/api/auth/password', { current: 'nope nope', next: 'brand new password' });
  assert.deepEqual(bad.body, { error: 'Your current password is not right.' });
  const short = await u.post('/api/auth/password', { current: u.user.password, next: 'short' });
  assert.deepEqual(short.body, { error: 'Use at least 8 characters for your new password.' });
  const ok = await u.post('/api/auth/password', { current: u.user.password, next: 'brand new password' });
  assert.deepEqual(ok.body, { ok: true });
  assert.ok((await u.get('/api/auth/me')).body.user, 'this device stays signed in');
  assert.equal((await other.get('/api/auth/me')).body.user, null, 'the other device is signed out');
  assert.equal((await t.agent().post('/api/auth/login', { email: u.user.email, password: 'brand new password' })).status, 200);
});

test('sessions slide after half their life and expire after 30 days', async () => {
  const u = await t.user();
  const day = 86_400_000;
  const start = Date.now();
  t.setNow(start + 10 * day);
  const early = await u.get('/api/auth/me');
  assert.equal(early.headers.get('set-cookie'), null, 'no refresh while more than half remains');
  t.setNow(start + 20 * day);
  const slid = await u.get('/api/auth/me');
  assert.ok(slid.body.user);
  assert.match(slid.headers.get('set-cookie'), /Max-Age=2592000/);
  t.setNow(start + 20 * day + 31 * day);
  assert.equal((await u.get('/api/auth/me')).body.user, null);
  t.setNow(null);
});

test('me returns the brands the user belongs to', async () => {
  const u = await t.user();
  const b = t.brand(u, { name: 'Membership Co', status: 'pending' });
  const me = await u.get('/api/auth/me');
  assert.deepEqual(me.body.user.brands, [{ id: b.id, slug: b.slug, name: 'Membership Co', status: 'pending', memberRole: 'owner', kind: 'partner' }]);
});

test('Secure cookie rule: encrypted socket, or TRUST_PROXY=1 + loopback + X-Forwarded-Proto https; never by mode', async () => {
  const req = (remoteAddress, xfp, encrypted = false) => ({ socket: { remoteAddress, encrypted }, headers: xfp ? { 'x-forwarded-proto': xfp } : {} });
  for (const lo of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    assert.equal(isHttps(req(lo, 'https'), { TRUST_PROXY: 1 }), true, lo);
    assert.equal(isHttps(req(lo, 'https'), { TRUST_PROXY: 0 }), false, `${lo}: TRUST_PROXY off believes no forwarding header`);
    assert.equal(isHttps(req(lo, 'https'), undefined), false, `${lo}: no config, no trust`);
    assert.equal(isHttps(req(lo, undefined), { TRUST_PROXY: 1 }), false, lo);
    assert.equal(isHttps(req(lo, 'http'), { TRUST_PROXY: 1 }), false, lo);
  }
  assert.equal(isHttps(req('192.168.1.20', 'https'), { TRUST_PROXY: 0 }), false, 'a LAN client cannot claim https');
  assert.equal(isHttps(req('192.168.1.20', 'https'), { TRUST_PROXY: 1 }), false, 'not even with TRUST_PROXY: only a loopback peer is believed');
  assert.equal(isHttps(req('127.0.0.1', 'https, http'), { TRUST_PROXY: 1 }), true, 'the first X-Forwarded-Proto value counts');
  assert.equal(isHttps(req('192.168.1.20', undefined, true), { TRUST_PROXY: 0 }), true, 'TLS socket');
  assert.equal(secureAttr(req('192.168.1.20', undefined), { TRUST_PROXY: 0, PROD: true }), '', 'production mode alone is not Secure');

  // End to end through a loopback "proxy": Secure only once TRUST_PROXY=1 says there is one.
  const noTrust = await t.agent().post('/api/auth/signup', { name: 'P', email: 'proxy0@test.blumodel', password: 'password123' }, { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.doesNotMatch(noTrust.headers.get('set-cookie'), /Secure/);
  const trusted = await startTestServer({ env: { TRUST_PROXY: '1' } });
  try {
    const viaProxy = await trusted.agent().post('/api/auth/signup', { name: 'P', email: 'proxy@test.blumodel', password: 'password123' }, { headers: { 'X-Forwarded-Proto': 'https' } });
    assert.match(viaProxy.headers.get('set-cookie'), /; Secure$/);
  } finally {
    await trusted.close();
  }

  // Production mode over plain http: still not Secure, so LAN sign-in works.
  const prod = await startTestServer({ env: { NODE_ENV: 'production' } });
  try {
    const r = await prod.agent().post('/api/auth/signup', { name: 'Prod', email: 'prod@test.blumodel', password: 'password123' });
    assert.equal(r.status, 201);
    assert.doesNotMatch(r.headers.get('set-cookie'), /Secure/);
  } finally {
    await prod.close();
  }
});

test('signup is limited to 5 per hour per IP', async () => {
  const t2 = await startTestServer({ rateLimits: true });
  try {
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await t2.agent().post('/api/auth/signup', { name: 'S', email: `s${i}@test.blumodel`, password: 'password123' })).status);
    assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
    const r = await t2.agent().post('/api/auth/signup', { name: 'S', email: 's9@test.blumodel', password: 'password123' });
    assert.ok(Number(r.headers.get('retry-after')) > 0);
  } finally {
    await t2.close();
  }
});

test('login throttle: per IP+email, and per email across rotating IPs (TRUST_PROXY)', async () => {
  const t2 = await startTestServer({ rateLimits: true, env: { TRUST_PROXY: '1' } });
  try {
    const u = await t2.user();
    const a = t2.agent();
    const codes = [];
    for (let i = 0; i < 9; i++) codes.push((await a.post('/api/auth/login', { email: u.user.email, password: 'wrong guess' }, { headers: { 'X-Forwarded-For': '10.0.0.1' } })).status);
    assert.deepEqual(codes, [401, 401, 401, 401, 401, 401, 401, 401, 429]);
    // A different IP may still try (the per-email budget isn't spent yet), and the right password works.
    assert.equal((await a.post('/api/auth/login', { email: u.user.email, password: u.user.password }, { headers: { 'X-Forwarded-For': '10.0.0.2' } })).status, 200);
    // Rotating addresses doesn't escape the per-email limit.
    let blocked = false;
    for (let i = 0; i < 40 && !blocked; i++) {
      const r = await a.post('/api/auth/login', { email: u.user.email, password: 'wrong guess' }, { headers: { 'X-Forwarded-For': `10.1.0.${i}` } });
      blocked = r.status === 429;
    }
    assert.ok(blocked, 'per-email limit kicks in');
    // From a loopback peer (cloudflared on this machine): CF-Connecting-IP, else the first
    // X-Forwarded-For hop. From anyone else the headers are ignored.
    const ipOf = (headers, remoteAddress = '127.0.0.1') => t2.ctx.internal.clientIp({ headers, socket: { remoteAddress } });
    assert.equal(ipOf({ 'x-forwarded-for': '6.6.6.6, 10.9.9.9' }), '6.6.6.6');
    assert.equal(ipOf({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '6.6.6.6' }), '203.0.113.7');
    assert.equal(ipOf({ 'cf-connecting-ip': 'not an ip', 'x-forwarded-for': '6.6.6.6' }), '6.6.6.6');
    assert.equal(ipOf({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '6.6.6.6' }, '192.168.1.20'), '192.168.1.20', 'a LAN peer cannot pick its address');
    assert.equal(ipOf({ 'x-forwarded-for': 'garbage' }), '127.0.0.1');
    assert.equal(ipOf({ 'cf-connecting-ip': '2001:db8::1' }, '::1'), '2001:db8::1');
    assert.equal(t.ctx.internal.clientIp({ headers: { 'cf-connecting-ip': '203.0.113.7' }, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1', 'TRUST_PROXY off: the socket');
  } finally {
    await t2.close();
  }
});

test('login does not block the event loop (async scrypt)', async () => {
  const u = await t.user();
  await u.get('/api/auth/me'); // warm the connection
  const started = performance.now();
  const logins = Array.from({ length: 5 }, () =>
    t
      .agent()
      .post('/api/auth/login', { email: u.user.email, password: u.user.password })
      .then((r) => ({ status: r.status, at: performance.now() - started })),
  );
  await new Promise((r) => setTimeout(r, 5));
  const timings = [];
  for (let i = 0; i < 3; i++) {
    const s = performance.now();
    const r = await u.get('/api/auth/me');
    timings.push({ ms: performance.now() - s, at: performance.now() - started, ok: !!r.body.user });
  }
  const done = await Promise.all(logins);
  assert.ok(done.every((d) => d.status === 200));
  const lastLogin = Math.max(...done.map((d) => d.at));
  const during = timings.filter((x) => x.at < lastLogin);
  assert.ok(during.length > 0, `me calls overlapped the logins (logins took ${lastLogin.toFixed(1)} ms)`);
  const fastest = Math.min(...during.map((x) => x.ms));
  assert.ok(fastest < 20, `me answered in ${fastest.toFixed(1)} ms during logins (${JSON.stringify(timings)})`);
});

test('ADMIN_EMAILS grants nothing: signing up or signing in with a listed address never makes an admin', async () => {
  // There is no email verification, so anyone could register the owner's address first. Admins are
  // made only with server/scripts/make-admin.mjs, on the server.
  const t2 = await startTestServer({ env: { ADMIN_EMAILS: 'boss@test.blumodel, Later@Test.BluModel' } });
  try {
    const r = await t2.agent().post('/api/auth/signup', { name: 'Boss', email: 'boss@test.blumodel', password: 'password123' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.user.role, 'customer');
    assert.equal(t2.db.prepare('SELECT role FROM users WHERE email = ?').get('boss@test.blumodel').role, 'customer');
    const again = await t2.agent().post('/api/auth/login', { email: 'boss@test.blumodel', password: 'password123' });
    assert.equal(again.body.user.role, 'customer');
    // An existing account named in ADMIN_EMAILS is not promoted at its next login either.
    const id = 'u-later';
    t2.db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, 'later@test.blumodel', 'Later', await hashPassword('password123'), Date.now());
    const l = await t2.agent().post('/api/auth/login', { email: 'later@test.blumodel', password: 'password123' });
    assert.equal(l.body.user.role, 'customer');
    assert.equal(t2.db.prepare('SELECT role FROM users WHERE id = ?').get(id).role, 'customer');
    // A real admin (made on the server) keeps the role through sign-in.
    t2.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(id);
    const l2 = await t2.agent().post('/api/auth/login', { email: 'later@test.blumodel', password: 'password123' });
    assert.equal(l2.body.user.role, 'admin');
    // A listed address is treated like any other in an email change: taken while an account has it,
    // free once none does (ADMIN_EMAILS reserves nothing, as it never could at signup), and moving
    // onto it grants nothing.
    const other = await t2.user();
    const moved = await other.post('/api/account/email', { email: 'later@test.blumodel', password: other.user.password });
    assert.equal(moved.status, 409, 'that address belongs to an account');
    t2.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    const freed = await other.post('/api/account/email', { email: 'later@test.blumodel', password: other.user.password });
    assert.equal(freed.status, 200, freed.text);
    assert.equal(t2.db.prepare('SELECT role FROM users WHERE id = ?').get(other.user.id).role, 'customer');
    assert.equal((await other.get('/api/auth/me')).body.user.role, 'customer');
  } finally {
    await t2.close();
  }
});

test('there is no API route that grants a role to yourself', async () => {
  const u = await t.user();
  assert.equal((await u.patch('/api/auth/me', { name: 'X', role: 'admin' })).body.user.role, 'customer');
  assert.equal((await u.patch(`/api/admin/users/${u.user.id}`, { role: 'admin' })).status, 403);
});

test('server/scripts/make-admin.mjs promotes an existing user', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-make-admin-'));
  const dbPath = path.join(dir, 'blumodel.db');
  try {
    const db = openDb(dbPath);
    migrate(db);
    db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run('u1', 'gabe@test.blumodel', 'Gabe', 'scrypt$00$00', Date.now());
    db.close();
    const script = path.join(HERE, '..', 'scripts', 'make-admin.mjs');
    const out = execFileSync(process.execPath, ['--no-warnings', script, 'GABE@test.blumodel'], { env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8' });
    assert.match(out, /is now an admin/);
    const db2 = openDb(dbPath);
    assert.equal(db2.prepare('SELECT role FROM users WHERE id = ?').get('u1').role, 'admin');
    db2.close();
    assert.throws(() => execFileSync(process.execPath, ['--no-warnings', script, 'nobody@test.blumodel'], { env: { ...process.env, DB_PATH: dbPath }, stdio: 'pipe' }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
