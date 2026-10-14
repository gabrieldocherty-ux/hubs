// Operations hardening (launch): the health check, route errors as a JSON 500 with a request id,
// security headers, the static app (brotli/gzip, ETag/304, immutable hashed assets, no-cache
// index.html), database pragmas and hot-query indexes, daily backups with a tested restore, log
// rotation, and the real server's graceful shutdown and crash exit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { startTestServer, silentLog } from './helpers.mjs';
import { loadConfig } from '../config.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { createApp } from '../app.mjs';
import { CSP, PERMISSIONS_POLICY } from '../http/respond.mjs';
import { backupNow, integrityCheck, listDaily, mirrorUploads, pruneDaily, restoreBackup, restoreUploads, runDailyBackup } from '../ops/backup.mjs';
import { installLogFile, rotateLog } from '../ops/logs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'index.mjs');
const VERSION = JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', 'package.json'), 'utf8')).version;
const DAY = 86_400_000;
const tempDir = (p = 'blumodel-ops-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** A raw request: no automatic decompression, so Content-Encoding can be checked. */
const raw = (port, p, headers = {}, method = 'GET', body = undefined) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });

const freePort = () =>
  new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {net.AddressInfo} */ (s.address());
      s.close(() => resolve(port));
    });
  });

/** The shell's settings must not leak into a spawned server. */
const cleanEnv = () => {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(STRIPE_|ANTHROPIC_|BLUMODEL_|MISE_|PAYMENTS$|DEMO_PAYMENTS$|PUBLIC_URL$|NODE_ENV$|TRUST_PROXY$|ADMIN_EMAILS$|LEGAL_|SUPPORT_EMAIL$|BACKUP|DB_PATH$|PORT$|HOST$|DIST_DIR$|UPLOAD_DIR$)/.test(k)) delete env[k];
  delete env.NODE_TEST_CONTEXT;
  return env;
};

// ── health ───────────────────────────────────────────────────────────────

test('GET /api/health: { ok, version, uptimeSec, db }; 503 when the database failed its check, while shutting down, or when it can’t answer', async () => {
  const s = await startTestServer();
  try {
    const r = await s.agent().get('/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body).sort(), ['db', 'ok', 'uptimeSec', 'version']);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.db, 'ok');
    assert.equal(r.body.version, VERSION);
    assert.ok(Number.isInteger(r.body.uptimeSec) && r.body.uptimeSec >= 0);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await s.agent().head('/api/health')).status, 200);

    s.ctx.health.integrity = { ok: false, problems: ['row 3 missing from index'] };
    const corrupt = await s.agent().get('/api/health');
    assert.equal(corrupt.status, 503);
    assert.deepEqual(corrupt.body, { ok: false, version: VERSION, uptimeSec: corrupt.body.uptimeSec, db: 'corrupt' });
    assert.ok(!corrupt.text.includes('row 3'), 'the problem itself stays in the log');
    s.ctx.health.integrity = { ok: true, problems: [] };

    s.ctx.health.shuttingDown = true;
    const stopping = await s.agent().get('/api/health');
    assert.equal(stopping.status, 503);
    assert.equal(stopping.body.shuttingDown, true);
    assert.equal(stopping.headers.get('connection'), 'close');
    s.ctx.health.shuttingDown = false;

    s.db.close();
    const down = await s.agent().get('/api/health');
    assert.equal(down.status, 503);
    assert.equal(down.body.db, 'error');
    assert.equal(down.body.ok, false);
  } finally {
    await s.close();
  }
});

// ── errors and headers ───────────────────────────────────────────────────

test('a route that throws: JSON 500 with the request id (also in X-Request-Id), never the message or a stack; the log has both', async () => {
  const logs = [];
  const log = { info() {}, warn() {}, error: (m) => logs.push(String(m)) };
  const db = openDb(':memory:');
  migrate(db);
  const config = loadConfig({ DB_PATH: ':memory:', PORT: '0', RATE_LIMITS: 'off' }, []);
  const boom = () => [
    { method: 'GET', path: '/api/boom', auth: 'none', handler: () => { throw new Error('internal detail sk_test_FAKE_FOR_TESTS'); } },
    { method: 'POST', path: '/api/boom-async', auth: 'none', handler: async () => { await new Promise((r) => setTimeout(r, 5)); throw new TypeError('async detail'); } },
  ];
  const { handler } = createApp({ config, db, log, routeModules: [{ name: 'boom', fn: boom }] });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = /** @type {net.AddressInfo} */ (server.address());
  try {
    const r = await raw(port, '/api/boom');
    assert.equal(r.status, 500);
    const body = JSON.parse(r.body.toString());
    assert.deepEqual(Object.keys(body).sort(), ['error', 'requestId']);
    assert.equal(body.error, 'Something went wrong on our side.');
    assert.match(body.requestId, /^[0-9a-f]{12}$/);
    assert.equal(r.headers['x-request-id'], body.requestId);
    assert.ok(!/internal detail|FAKE|\bat /.test(r.body.toString()));
    const line = logs.find((l) => l.includes(body.requestId));
    assert.ok(line, logs.join('\n'));
    assert.match(line, /GET \/api\/boom failed: Error: internal detail/);
    assert.match(line, /\n\s+at /, 'the stack goes to the log');

    const a = await raw(port, '/api/boom-async', { 'X-BluModel': '1', 'Content-Type': 'application/json', 'Content-Length': '2' }, 'POST', '{}');
    assert.equal(a.status, 500);
    assert.ok(!a.body.toString().includes('async detail'));
    // Every response carries a request id, errors or not.
    assert.match((await raw(port, '/api/nothing-here')).headers['x-request-id'], /^[0-9a-f]{12}$/);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    db.close();
  }
});

test('security headers on every response: CSP, nosniff, Referrer-Policy, Permissions-Policy, frame denial; HSTS only over https', async () => {
  const s = await startTestServer({ env: { TRUST_PROXY: '1' } });
  try {
    fs.mkdirSync(s.config.DIST_DIR, { recursive: true });
    fs.writeFileSync(path.join(s.config.DIST_DIR, 'index.html'), '<!doctype html><title>BluModel Studio</title>');
    assert.equal(
      CSP,
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com; frame-ancestors 'none'",
    );
    assert.equal(PERMISSIONS_POLICY, 'camera=(self), microphone=(), geolocation=(), payment=(self)');
    for (const p of ['/', '/api/health', '/api/nope', '/robots.txt', '/assets/missing.js']) {
      const r = await raw(s.port, p);
      assert.equal(r.headers['content-security-policy'], CSP, p);
      assert.equal(r.headers['x-content-type-options'], 'nosniff', p);
      assert.equal(r.headers['referrer-policy'], 'same-origin', p);
      assert.equal(r.headers['permissions-policy'], PERMISSIONS_POLICY, p);
      assert.equal(r.headers['x-frame-options'], 'DENY', p);
      assert.equal(r.headers['strict-transport-security'], undefined, `${p}: no HSTS over plain http`);
    }
    // Through a proxy on this machine that says https (cloudflared): HSTS, one year, nothing wider.
    const viaTunnel = await raw(s.port, '/', { 'X-Forwarded-Proto': 'https' });
    assert.equal(viaTunnel.headers['strict-transport-security'], 'max-age=31536000');
  } finally {
    await s.close();
  }
});

// ── the static app ───────────────────────────────────────────────────────

test('the built app: brotli or gzip by Accept-Encoding, ETag and 304, immutable hashed assets, no-cache index.html, SPA fallback', async () => {
  const s = await startTestServer();
  try {
    const dist = s.config.DIST_DIR;
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    const js = `export const x = ${JSON.stringify('kitchen '.repeat(800))};\n`;
    const html = `<!doctype html><html><head><title>BluModel Studio</title></head><body>${'<div></div>'.repeat(200)}</body></html>`;
    fs.writeFileSync(path.join(dist, 'index.html'), html);
    fs.writeFileSync(path.join(dist, 'assets', 'index-Ab12Cd34.js'), js);
    fs.writeFileSync(path.join(dist, 'assets', 'tiny-Zz99.css'), 'a{b:c}');
    fs.writeFileSync(path.join(dist, 'assets', 'pic-Qq11.png'), Buffer.alloc(4096, 7));

    const br = await raw(s.port, '/assets/index-Ab12Cd34.js', { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(br.status, 200);
    assert.equal(br.headers['content-encoding'], 'br');
    assert.equal(zlib.brotliDecompressSync(br.body).toString(), js);
    assert.ok(br.body.length < js.length / 4);
    assert.equal(br.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(br.headers.vary, 'Accept-Encoding');
    assert.match(br.headers['content-type'], /^text\/javascript/);
    assert.ok(br.headers.etag);

    const gz = await raw(s.port, '/assets/index-Ab12Cd34.js', { 'Accept-Encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(gz.body).toString(), js);
    assert.notEqual(gz.headers.etag, br.headers.etag, 'each encoding has its own ETag');

    const plain = await raw(s.port, '/assets/index-Ab12Cd34.js', { 'Accept-Encoding': 'br;q=0, gzip;q=0' });
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.body.toString(), js);

    const again = await raw(s.port, '/assets/index-Ab12Cd34.js', { 'Accept-Encoding': 'br', 'If-None-Match': br.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    assert.equal(again.headers.etag, br.headers.etag);

    const index = await raw(s.port, '/', { 'Accept-Encoding': 'br' });
    assert.equal(index.headers['cache-control'], 'no-cache');
    assert.equal(zlib.brotliDecompressSync(index.body).toString(), html);
    const route = await raw(s.port, '/k/some-kitchen', { 'Accept-Encoding': 'identity' });
    assert.equal(route.status, 200);
    assert.equal(route.headers['cache-control'], 'no-cache');
    assert.equal(route.body.toString(), html, 'an app route gets index.html');
    assert.equal((await raw(s.port, '/', { 'If-None-Match': route.headers.etag })).status, 304);

    const small = await raw(s.port, '/assets/tiny-Zz99.css', { 'Accept-Encoding': 'br' });
    assert.equal(small.headers['content-encoding'], undefined, 'under 1 KB is not worth compressing');
    const png = await raw(s.port, '/assets/pic-Qq11.png', { 'Accept-Encoding': 'br' });
    assert.equal(png.headers['content-encoding'], undefined, 'images are already compressed');
    assert.equal(png.headers['cache-control'], 'public, max-age=31536000, immutable');

    const missing = await raw(s.port, '/assets/gone-Xx00.js');
    assert.equal(missing.status, 404, 'a missing asset is a real 404, not index.html');
    // (A %2e%2e segment is already resolved by the URL parser, so it can't climb out either.)
    assert.equal((await raw(s.port, '/assets/..%5c..%5c..%5cpackage.json')).status, 400);
    assert.equal((await raw(s.port, '/assets/%2e%2e/%2e%2e/package.json')).status, 404);
    const head = await raw(s.port, '/assets/index-Ab12Cd34.js', { 'Accept-Encoding': 'br' }, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(head.headers['content-encoding'], 'br');
  } finally {
    await s.close();
  }
});

// ── the database ─────────────────────────────────────────────────────────

test('the database opens with WAL, foreign keys, busy_timeout, synchronous NORMAL and a journal size limit; the hot-query indexes exist', () => {
  const dir = tempDir();
  try {
    const db = openDb(path.join(dir, 'blumodel.db'));
    const pragma = (p) => Object.values(db.prepare(`PRAGMA ${p}`).get())[0];
    assert.equal(pragma('journal_mode'), 'wal');
    assert.equal(pragma('foreign_keys'), 1);
    assert.equal(pragma('busy_timeout'), 5000);
    assert.equal(pragma('synchronous'), 1, 'NORMAL');
    assert.equal(pragma('journal_size_limit'), 67108864);
    const applied = migrate(db);
    assert.ok(applied.includes('ops-001-admin-audit-hot-indexes'));
    assert.ok(applied.includes('billing-002-comp-plans-keep-receipts'));
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((r) => r.name));
    for (const ix of ['sessions_expires', 'share_links_created_by', 'subscriptions_provider', 'billing_payments_provider', 'kitchen_unlocks_provider', 'export_events_user', 'files_blob', 'brands_owner', 'orders_provider_paid', 'admin_audit_at', 'billing_payments_user']) {
      assert.ok(names.has(ix), ix);
    }
    // The hot queries use them.
    const plan = (sql) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ');
    assert.match(plan("SELECT * FROM sessions WHERE expires_at < 5"), /sessions_expires/);
    assert.match(plan("SELECT * FROM files WHERE sha256 = 'a' AND ext = 'png' AND visibility = 'public'"), /files_blob|files_sha/);
    assert.equal(migrate(db).length, 0, 'idempotent');
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── backups and restore ──────────────────────────────────────────────────

/** A real database file with one user. */
function makeDb(file, email = 'kept@test.blumodel') {
  const db = openDb(file);
  migrate(db);
  db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, 'Kept', 'x', 1)").run(`u_${email}`, email);
  return db;
}

test('daily backups: one consistent VACUUM INTO copy a day, checked before it counts, the newest 14 kept', () => {
  const dir = tempDir();
  try {
    const db = makeDb(path.join(dir, 'blumodel.db'));
    const backupDir = path.join(dir, 'backups');
    let t = Date.UTC(2026, 9, 1, 12);
    const first = backupNow({ db, backupDir, now: () => t, keep: 14 });
    assert.equal(first.made, true);
    assert.equal(path.basename(first.file), 'blumodel-2026-10-01.db');
    assert.equal(backupNow({ db, backupDir, now: () => t + 3_600_000, keep: 14 }).made, false, 'once a day');
    const copy = new DatabaseSync(first.file);
    assert.equal(copy.prepare('SELECT email FROM users').get().email, 'kept@test.blumodel');
    assert.equal(integrityCheck(copy).ok, true);
    copy.close();
    assert.ok(!fs.existsSync(`${first.file}.part`));

    for (let i = 1; i < 20; i++) backupNow({ db, backupDir, now: () => t + i * DAY, keep: 14 });
    const kept = listDaily(backupDir);
    assert.equal(kept.length, 14);
    assert.equal(kept[0].day, '2026-10-20', 'newest first');
    assert.equal(kept.at(-1).day, '2026-10-07');
    assert.deepEqual(pruneDaily(backupDir, 3).length, 11);
    assert.equal(listDaily(backupDir).length, 3);
    fs.writeFileSync(path.join(backupDir, 'daily', 'notes.txt'), 'not a backup');
    assert.equal(listDaily(backupDir).length, 3, 'only blumodel-YYYY-MM-DD.db files count');
    db.close();
    t = 0;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the uploads mirror: new files copied, deleted files removed, tmp skipped; missing uploads restored from it without overwriting', () => {
  const dir = tempDir();
  try {
    const uploads = path.join(dir, 'uploads');
    const mirror = path.join(dir, 'backups', 'uploads-mirror');
    fs.mkdirSync(path.join(uploads, 'ab'), { recursive: true });
    fs.mkdirSync(path.join(uploads, 'tmp'), { recursive: true });
    fs.writeFileSync(path.join(uploads, 'ab', 'ab12.png'), 'one');
    fs.writeFileSync(path.join(uploads, 'ab', 'ab34.glb'), 'two');
    fs.writeFileSync(path.join(uploads, 'tmp', 'half-upload'), 'x');
    assert.deepEqual(mirrorUploads({ uploadDir: uploads, mirrorDir: mirror }), { copied: 2, removed: 0 });
    assert.ok(!fs.existsSync(path.join(mirror, 'tmp')));
    assert.deepEqual(mirrorUploads({ uploadDir: uploads, mirrorDir: mirror }), { copied: 0, removed: 0 }, 'nothing new');
    fs.rmSync(path.join(uploads, 'ab', 'ab34.glb'));
    assert.deepEqual(mirrorUploads({ uploadDir: uploads, mirrorDir: mirror }), { copied: 0, removed: 1 }, 'a deleted upload leaves the mirror');

    fs.rmSync(path.join(uploads, 'ab'), { recursive: true });
    fs.mkdirSync(path.join(uploads, 'ab'));
    fs.writeFileSync(path.join(mirror, 'ab', 'ab56.png'), 'mirror copy');
    fs.writeFileSync(path.join(uploads, 'ab', 'ab56.png'), 'current');
    assert.equal(restoreUploads({ mirrorDir: mirror, uploadDir: uploads }), 1);
    assert.equal(fs.readFileSync(path.join(uploads, 'ab', 'ab12.png'), 'utf8'), 'one');
    assert.equal(fs.readFileSync(path.join(uploads, 'ab', 'ab56.png'), 'utf8'), 'current', 'never overwrites');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restore: a checked backup replaces the database, which is kept beside it; a damaged backup is refused and nothing changes', () => {
  const dir = tempDir();
  try {
    const dbPath = path.join(dir, 'data', 'blumodel.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const live = makeDb(dbPath, 'before-backup@test.blumodel');
    const { file } = backupNow({ db: live, backupDir: path.join(dir, 'backups'), now: () => Date.UTC(2026, 9, 2) });
    live.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u_late', 'after-backup@test.blumodel', 'L', 'x', 2)").run();
    live.close();

    // A damaged "backup": a real database with garbage over its middle pages.
    const bad = path.join(dir, 'bad.db');
    const b = makeDb(bad);
    for (let i = 0; i < 400; i++) b.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, 1)').run(`u${i}`, `u${i}@x.test`, 'N'.repeat(200), 'h');
    b.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    b.close();
    const buf = fs.readFileSync(bad);
    buf.fill(0xab, 4096 * 3, 4096 * 6);
    fs.writeFileSync(bad, buf);
    assert.throws(() => restoreBackup({ backupFile: bad, dbPath }), /integrity|malformed|not a database/i);
    assert.throws(() => restoreBackup({ backupFile: path.join(dir, 'nope.db'), dbPath }), /No backup at/);
    const still = new DatabaseSync(dbPath);
    assert.equal(still.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2, 'a refused restore changes nothing');
    still.close();

    const r = restoreBackup({ backupFile: file, dbPath, now: () => Date.UTC(2026, 9, 3) });
    assert.equal(r.restored, dbPath);
    assert.match(path.basename(r.keptAs), /^blumodel\.db\.before-restore-2026-10-03T/);
    const back = new DatabaseSync(dbPath);
    assert.deepEqual(back.prepare('SELECT email FROM users').all().map((u) => u.email), ['before-backup@test.blumodel']);
    back.close();
    const old = new DatabaseSync(r.keptAs);
    assert.equal(old.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2, 'the replaced database is kept, not deleted');
    old.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restore CLI: lists, refuses while something listens on the port, restores (with uploads) once it is free', async () => {
  const dir = tempDir();
  const blocker = net.createServer();
  try {
    const dbPath = path.join(dir, 'data', 'blumodel.db');
    fs.mkdirSync(path.join(dir, 'data', 'uploads', 'cd'), { recursive: true });
    const live = makeDb(dbPath, 'backed-up@test.blumodel');
    const backupDir = path.join(dir, 'data', 'backups');
    runDailyBackup({ db: live, config: { BACKUPS: 'on', BACKUP_DIR: backupDir, BACKUP_KEEP: 14, UPLOAD_DIR: path.join(dir, 'data', 'uploads') }, log: silentLog });
    live.prepare("DELETE FROM users").run();
    live.close();
    fs.mkdirSync(path.join(backupDir, 'uploads-mirror', 'cd'), { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'uploads-mirror', 'cd', 'cd12.png'), 'img');

    const port = await new Promise((resolve) => blocker.listen(0, '127.0.0.1', () => resolve(/** @type {net.AddressInfo} */ (blocker.address()).port)));
    const run = (args, p = port) => spawnSync(process.execPath, ['--no-warnings', path.join(HERE, '..', 'scripts', 'restore.mjs'), '--db', dbPath, ...args], { env: { ...cleanEnv(), PORT: String(p) }, encoding: 'utf8', windowsHide: true });

    const list = run(['--list']);
    assert.equal(list.status, 0, list.stderr);
    assert.match(list.stdout, /\d{4}-\d{2}-\d{2} {2}.*blumodel-\d{4}-\d{2}-\d{2}\.db/);
    const refused = run(['--latest']);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /Something is listening on port \d+\. Stop the server first/);
    await new Promise((r) => blocker.close(r));

    const ok = run(['--latest', '--uploads'], await freePort());
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /Restored .* The database it replaced is kept as .*before-restore-/);
    assert.match(ok.stdout, /Copied 1 missing upload/);
    const back = new DatabaseSync(dbPath);
    assert.equal(back.prepare('SELECT email FROM users').get().email, 'backed-up@test.blumodel');
    back.close();
    assert.ok(fs.existsSync(path.join(dir, 'data', 'uploads', 'cd', 'cd12.png')));
  } finally {
    if (blocker.listening) blocker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('runDailyBackup never throws, logs one line, and is skipped (keeping the good backups) while the database failed its check', () => {
  const dir = tempDir();
  try {
    const db = makeDb(path.join(dir, 'blumodel.db'));
    const lines = [];
    const log = { info: (m) => lines.push(`I ${m}`), warn: (m) => lines.push(`W ${m}`), error: (m) => lines.push(`E ${m}`) };
    const config = { BACKUPS: 'on', BACKUP_DIR: path.join(dir, 'backups'), BACKUP_KEEP: 14, UPLOAD_DIR: path.join(dir, 'uploads') };
    assert.equal(runDailyBackup({ db, config, log, paused: () => true }), null);
    assert.match(lines.pop(), /^W Backup skipped: the database failed its integrity check/);
    assert.equal(listDaily(config.BACKUP_DIR).length, 0);
    assert.ok(runDailyBackup({ db, config, log }).made);
    assert.match(lines.pop(), /^I Backup: wrote .*blumodel-\d{4}-\d{2}-\d{2}\.db; uploads mirror \+0 -0\./);
    db.close();
    assert.equal(runDailyBackup({ db, config: { ...config, BACKUP_DIR: path.join(dir, 'other') }, log }), null, 'a closed database: logged, not thrown');
    assert.match(lines.pop(), /^E Backup failed:/);
    assert.equal(runDailyBackup({ db, config: { ...config, BACKUPS: 'off' }, log }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── logs ─────────────────────────────────────────────────────────────────

test('log rotation: file → file.1 → … → file.<keep> past the size; the server’s log file stamps every console line', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'logs', 'server.log');
    fs.mkdirSync(path.dirname(file));
    assert.equal(rotateLog(file, { maxBytes: 10 }), false, 'no file yet');
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(file, `generation ${i} `.repeat(3));
      assert.equal(rotateLog(file, { maxBytes: 10, keep: 3 }), true);
    }
    assert.ok(!fs.existsSync(file));
    assert.equal(fs.readFileSync(`${file}.1`, 'utf8').trim().split(' ')[1], '5');
    assert.equal(fs.readFileSync(`${file}.3`, 'utf8').trim().split(' ')[1], '3');
    assert.ok(!fs.existsSync(`${file}.4`), 'only `keep` old files');
    fs.writeFileSync(file, 'small');
    assert.equal(rotateLog(file, { maxBytes: 1024 }), false);

    const target = { log() {}, info() {}, warn() {}, error() {} };
    const restore = installLogFile(file, { now: () => Date.UTC(2026, 9, 14, 8), target, maxBytes: 1024 * 1024 });
    target.log('listening on %s', 'http://127.0.0.1:8790');
    target.warn('Warning: something');
    target.error(new Error('kaput'));
    restore();
    const text = fs.readFileSync(file, 'utf8');
    assert.match(text, /^small2026-10-14T08:00:00\.000Z INFO  listening on http:\/\/127\.0\.0\.1:8790\n/);
    assert.match(text, /2026-10-14T08:00:00\.000Z WARN  Warning: something\n/);
    assert.match(text, /ERROR Error: kaput/);

    // The supervisor's helper.
    fs.writeFileSync(file, 'x'.repeat(2048));
    const cli = spawnSync(process.execPath, [path.join(HERE, '..', 'scripts', 'rotate-log.mjs'), file, '--max-mb', '0.001', '--keep', '2'], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.ok(!fs.existsSync(file) && fs.statSync(`${file}.1`).size === 2048);
    assert.equal(spawnSync(process.execPath, [path.join(HERE, '..', 'scripts', 'rotate-log.mjs')], { encoding: 'utf8' }).status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── the real server: graceful shutdown, crash exit ───────────────────────

/** Starts server/index.mjs; resolves once it answers HTTP (or has exited). */
async function startReal({ env = {}, args = ['--prod'], node = [] } = {}) {
  const dir = tempDir('blumodel-real-');
  const dist = path.join(dir, 'dist');
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>BluModel Studio</title>');
  const port = await freePort();
  const fullEnv = { ...cleanEnv(), PORT: String(port), HOST: '127.0.0.1', DB_PATH: path.join(dir, 'data', 'blumodel.db'), DIST_DIR: dist, ...env };
  const child = spawn(process.execPath, ['--no-warnings', ...node, SERVER, ...args], { env: fullEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) break;
    if (Date.now() > deadline) {
      child.kill();
      await exited;
      throw new Error(`the server did not start: ${out}`);
    }
    try {
      await fetch(`http://127.0.0.1:${port}/api/health`); // any answer (a 503 too) means it listens
      break;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  /** Kills it if it still runs, and waits until it has exited (so its files can be removed). */
  const stop = async () => {
    if (child.exitCode === null) child.kill();
    await exited;
  };
  return { dir, port, child, exited, output: () => out, stop };
}

test('graceful shutdown (the shutdown file the supervisor uses; SIGTERM/SIGINT/SIGBREAK take the same path): open requests finish, the WAL is checkpointed, exit 0', async () => {
  const shutdownFile = path.join(os.tmpdir(), `blumodel-shutdown-${process.pid}-${Date.now()}`);
  const r = await startReal({ env: { BLUMODEL_SHUTDOWN_FILE: shutdownFile, BLUMODEL_LOG_FILE: '' } });
  const logFile = path.join(r.dir, 'logs', 'server.log');
  try {
    assert.equal(r.child.exitCode, null, r.output());
    // A daily backup was made at start.
    assert.equal(listDaily(path.join(r.dir, 'data', 'backups')).length, 1);
    // A request in flight: headers and half the body now, the rest after shutdown starts.
    const body = JSON.stringify({ email: 'nobody@test.blumodel', password: 'wrong password' });
    const sock = net.connect(r.port, '127.0.0.1');
    await new Promise((res) => sock.once('connect', res));
    let reply = '';
    sock.on('data', (d) => (reply += d));
    const closed = new Promise((res) => sock.once('close', res));
    sock.write(`POST /api/auth/login HTTP/1.1\r\nHost: 127.0.0.1\r\nX-BluModel: 1\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body.slice(0, 10)}`);
    await new Promise((res) => setTimeout(res, 200));
    fs.writeFileSync(shutdownFile, '');
    await new Promise((res) => setTimeout(res, 1600));
    assert.equal(r.child.exitCode, null, 'still draining the open request');
    sock.write(body.slice(10));
    await closed;
    assert.match(reply, /^HTTP\/1\.1 401 /, reply);
    assert.match(reply, /\r\nConnection: close\r\n/i);
    const code = await r.exited;
    assert.equal(code, 0, r.output());
    assert.match(r.output(), /Shutting down \(shutdown file\): finishing open requests \(up to 10 s\)\./);
    assert.match(r.output(), /Stopped \(all requests finished, database checkpointed\)\./);
    const wal = path.join(r.dir, 'data', 'blumodel.db-wal');
    assert.ok(!fs.existsSync(wal) || fs.statSync(wal).size === 0, 'the WAL was folded back in');
    assert.ok(!fs.existsSync(shutdownFile));
    assert.ok(!fs.existsSync(logFile));
  } finally {
    await r.stop();
    fs.rmSync(shutdownFile, { force: true });
    fs.rmSync(r.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('with BLUMODEL_LOG_FILE the server writes its own stamped log; an uncaught error is logged and exits non-zero', async () => {
  const dir = tempDir();
  const preload = path.join(dir, 'boom.mjs');
  fs.writeFileSync(preload, "setTimeout(() => { throw new Error('boom from the test'); }, 1500);\n");
  const logFile = path.join(dir, 'logs', 'server.log');
  const r = await startReal({ env: { BLUMODEL_LOG_FILE: logFile }, node: ['--import', pathToFileURL(preload).href] });
  try {
    const code = await r.exited;
    assert.equal(code, 1);
    const text = fs.readFileSync(logFile, 'utf8');
    assert.match(text, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z INFO {2}BluModel Studio listening on http:\/\/127\.0\.0\.1:\d+ \(payments: none, production\)/m);
    assert.match(text, /WARN {2}Warning: No Stripe: nobody can pay on this server\./);
    assert.match(text, /ERROR Uncaught exception: Error: boom from the test/);
    assert.equal(r.output().trim(), '', 'console output went to the log file');
  } finally {
    await r.stop();
    fs.rmSync(r.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('a database that fails its integrity check at startup: the server still starts, says so in the log, answers 503 db corrupt, and makes no backup', async () => {
  const dir = tempDir();
  const dbPath = path.join(dir, 'data', 'blumodel.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = makeDb(dbPath);
  for (let i = 0; i < 400; i++) db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, 1)').run(`u${i}`, `u${i}@x.test`, 'N'.repeat(200), 'h');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  // Garbage over the last pages, where the users rows are (the schema stays readable).
  const buf = fs.readFileSync(dbPath);
  buf.fill(0xab, buf.length - 4096 * 4, buf.length - 4096);
  fs.writeFileSync(dbPath, buf);
  const r = await startReal({ env: { DB_PATH: dbPath, BACKUP_DIR: path.join(dir, 'backups') } });
  try {
    assert.equal(r.child.exitCode, null, r.output());
    const h = await fetch(`http://127.0.0.1:${r.port}/api/health`);
    assert.equal(h.status, 503);
    assert.equal((await h.json()).db, 'corrupt');
    assert.match(r.output(), /DATABASE INTEGRITY CHECK FAILED for .*blumodel\.db: .*Restore a backup/);
    assert.match(r.output(), /Backup skipped: the database failed its integrity check/);
    assert.equal(listDaily(path.join(dir, 'backups')).length, 0, 'the good backups are not rotated out by a bad one');
  } finally {
    await r.stop();
    fs.rmSync(r.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
