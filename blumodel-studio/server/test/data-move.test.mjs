// Moving the data to another machine (server/ops/dataBundle.mjs, server/scripts/export-data.mjs and
// import-data.mjs, docs/MOVING_DATA.md). The round trip runs the real scripts and the real server:
// a home laid out like this PC's (…/Users/owner/Projects/BluModelStudio) is seeded and served, a
// kitchen is saved and a photo uploaded, the bundle is made WHILE that server runs, then imported
// into a home laid out like the Wyse's (…/srv/blumodel-studio), where a second server signs the
// same person in, opens the kitchen and serves the same bytes. Fake secrets only; nothing here
// touches a real home, a real port (8787/8790/8795) or the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Agent, sampleDoc } from './helpers.mjs';
import { makePng } from './fixtures/images.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { exportData, importData, openBundle, safeRelPath, tarEntries, tarHeader, existingData, listFiles, BUNDLE_FORMAT } from '../ops/dataBundle.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..');
const ROOT = path.resolve(SERVER, '..');
const NODE = process.execPath;
const SEED_PASSWORD = 'FAKE-seed-password-for-tests-1';
const FAKE_SETTINGS = 'STRIPE_SECRET_KEY=sk_test_FAKE_FOR_TESTS\nSTRIPE_WEBHOOK_SECRET=whsec_FAKE_FOR_TESTS\nRESEND_API_KEY=re_FAKE_FOR_TESTS\n';
const TUNNEL_ID = '00000000-0000-4000-8000-000000000000';

const tempDir = (p = 'blumodel-move-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** An environment with nothing of this machine's settings in it (no key can leak into a child). */
function cleanEnv(extra = {}) {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT'];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...extra };
}

/** A free port, from this package's range (8910-8919) when one is free there. */
async function freePort() {
  const tryPort = (p) =>
    new Promise((resolve) => {
      const s = net.createServer();
      s.once('error', () => resolve(null));
      s.listen(p, '127.0.0.1', () => {
        const got = /** @type {net.AddressInfo} */ (s.address()).port;
        s.close(() => resolve(got));
      });
    });
  for (let p = 8910; p <= 8919; p++) {
    const got = await tryPort(p);
    if (got) return got;
  }
  return tryPort(0);
}

const runScript = (name, args, env = {}) =>
  spawnSync(NODE, ['--no-warnings', path.join(SERVER, 'scripts', name), ...args], { env: cleanEnv(env), encoding: 'utf8', windowsHide: true, timeout: 120_000 });

/** Starts the real server (server/index.mjs) on `port` for `home`; resolves once /api/health answers. */
async function startServer(home, port) {
  const dist = path.join(home, 'app', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>BluModel Studio</title>');
  const shutdownFile = path.join(home, 'shutdown.request');
  const env = cleanEnv({
    PORT: String(port),
    HOST: '127.0.0.1',
    DB_PATH: path.join(home, 'data', 'blumodel.db'),
    DIST_DIR: dist,
    RATE_LIMITS: 'off',
    BLUMODEL_SHUTDOWN_FILE: shutdownFile,
  });
  const child = spawn(NODE, ['--no-warnings', path.join(SERVER, 'index.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`the server exited: ${out}`);
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    base,
    output: () => out,
    async stop() {
      if (child.exitCode !== null) return exited;
      fs.writeFileSync(shutdownFile, '');
      const t = setTimeout(() => child.kill(), 15_000);
      const code = await exited;
      clearTimeout(t);
      return code;
    },
  };
}

/** Every string a bundle must never contain: the source machine's folders, either separator. */
function machineStrings(...dirs) {
  const out = new Set();
  for (const d of dirs) {
    const abs = path.resolve(d);
    out.add(abs);
    out.add(abs.split(path.sep).join('/'));
    out.add(abs.split(path.sep).join('\\'));
  }
  return [...out].filter((s) => s.length > 8);
}

test('round trip: export from a running Windows-style home, import into a Linux-style home, the same person opens the same kitchen and photo there', { timeout: 180_000 }, async () => {
  const src = tempDir('blumodel-move-src-');
  const dst = tempDir('blumodel-move-dst-');
  const carry = tempDir('blumodel-move-usb-');
  const srcHome = path.join(src, 'Users', 'owner', 'Projects', 'BluModelStudio');
  const dstHome = path.join(dst, 'srv', 'blumodel-studio');
  let a = null;
  let b = null;
  try {
    // The source: seeded like the QA server, then used through the API like a person would.
    const seed = spawnSync(NODE, ['--no-warnings', path.join(SERVER, 'seed', 'index.mjs')], {
      env: cleanEnv({ DB_PATH: path.join(srcHome, 'data', 'blumodel.db'), SEED_PASSWORD }),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 120_000,
    });
    assert.equal(seed.status, 0, seed.stdout + seed.stderr);
    a = await startServer(srcHome, await freePort());
    const dana = new Agent(a.base);
    assert.equal((await dana.post('/api/auth/login', { email: 'demo-customer@blumodel.test', password: SEED_PASSWORD })).status, 200);
    const kitchen = (await dana.post('/api/projects', { name: 'Moved Kitchen', client: 'Wyse', doc: sampleDoc({ name: 'Moved Kitchen' }) })).body.project;
    assert.ok(kitchen?.id);
    const photo = makePng({ w: 24, h: 16, rgba: [12, 99, 201, 255] });
    const up = await dana.putRaw('/api/files?kind=image&name=moved.png', photo, 'image/png');
    assert.equal(up.status, 201, up.text);
    const fileId = up.body.file.id;
    assert.equal(up.body.file.sha256, sha(photo));

    // The bundle, made while the server runs. Then a change after it: not in the bundle.
    const ex = runScript('export-data.mjs', ['--home', srcHome, '--out', carry]);
    assert.equal(ex.status, 0, ex.stdout + ex.stderr);
    assert.match(ex.stdout, /every file was read back and matches its sha256/);
    assert.doesNotMatch(ex.stdout + ex.stderr, /THIS BUNDLE WILL HOLD SECRETS/);
    const later = await dana.post('/api/projects', { name: 'After the export', doc: sampleDoc() });
    assert.equal(later.status, 201);
    assert.equal(await a.stop(), 0, a.output());
    a = null;

    const [bundleName] = fs.readdirSync(carry).filter((n) => n.endsWith('.tar'));
    assert.match(bundleName, /^blumodel-data-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.tar$/);
    const bundle = path.join(carry, bundleName);
    assert.deepEqual(fs.readdirSync(carry), [bundleName], 'no work files or .part left behind');

    // Nothing in the bundle names the machine it came from, and every path is relative with '/'.
    const bytes = fs.readFileSync(bundle);
    for (const s of machineStrings(src, srcHome, os.tmpdir())) assert.equal(bytes.includes(Buffer.from(s)), false, `the bundle contains ${s}`);
    const entries = tarEntries(bundle);
    for (const e of entries) {
      assert.ok(!e.name.includes('\\') && !path.isAbsolute(e.name) && !/^[A-Za-z]:/.test(e.name), e.name);
      assert.ok(e.name.startsWith(bundleName.replace(/\.tar$/, '/')), e.name);
    }
    const names = entries.map((e) => e.name.split('/').slice(1).join('/')).filter(Boolean);
    assert.ok(names.includes('manifest.json') && names.includes('db/blumodel.db'));
    assert.ok(!names.some((n) => n.startsWith('secrets')), 'no secrets without --include-secrets');
    assert.ok(!names.some((n) => /backups|logs|seed-credentials|\.env/.test(n)), names.join(', '));
    const manifest = JSON.parse(openBundle(bundle).manifestText);
    assert.equal(manifest.format, BUNDLE_FORMAT);
    assert.equal(manifest.formatVersion, 1);
    assert.ok(manifest.tables.users >= 4 && manifest.tables.projects >= 1 && manifest.tables.files >= 2, JSON.stringify(manifest.tables));
    assert.ok(manifest.schema.migrations >= 17 && manifest.schema.latest);
    assert.match(manifest.app.commit, /^([0-9a-f]{7,40}|unknown)$/);
    assert.equal(manifest.uploads.files, manifest.files.filter((f) => f.path.startsWith('uploads/')).length);
    assert.ok(manifest.files.every((f) => safeRelPath(f.path) && /^[0-9a-f]{64}$/.test(f.sha256)));
    assert.ok(manifest.files.some((f) => f.path === `uploads/${sha(photo).slice(0, 2)}/${sha(photo)}.png` && f.sha256 === sha(photo)));

    // The other machine: check, import, and refuse a second import without --replace.
    const check = runScript('import-data.mjs', [bundle, '--check', '--home', dstHome]);
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stdout, /every file matches its sha256/);
    assert.match(check.stdout, /Nothing was changed \(--check\)/);
    assert.equal(fs.existsSync(path.join(dstHome, 'data', 'blumodel.db')), false, '--check writes nothing into the home');

    const port = await freePort();
    const imp = runScript('import-data.mjs', [bundle, '--home', dstHome, '--port', String(port)]);
    assert.equal(imp.status, 0, imp.stdout + imp.stderr);
    assert.match(imp.stdout, /now in place: \d+ tables/);
    assert.ok(fs.existsSync(path.join(dstHome, 'data', 'uploads', sha(photo).slice(0, 2), `${sha(photo)}.png`)));
    assert.deepEqual(fs.readdirSync(path.join(dstHome, 'data')).filter((n) => n.startsWith('.import-')), [], 'no staging left');
    const again = runScript('import-data.mjs', [bundle, '--home', dstHome, '--port', String(port)]);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already has data .*Nothing was changed/s);

    // The site on the new machine: same person, same kitchen, same photo, same public model.
    b = await startServer(dstHome, port);
    const there = new Agent(b.base);
    assert.equal((await there.post('/api/auth/login', { email: 'demo-customer@blumodel.test', password: SEED_PASSWORD })).status, 200);
    const list = (await there.get('/api/projects')).body.projects.map((p) => p.name);
    assert.ok(list.includes('Moved Kitchen'), list.join(', '));
    assert.ok(!list.includes('After the export'), 'the bundle is a snapshot of the moment it was made');
    const opened = await there.get(`/api/projects/${kitchen.id}`);
    assert.equal(opened.status, 200);
    assert.equal(opened.body.project.name, 'Moved Kitchen');
    assert.equal(opened.body.project.client, 'Wyse');
    const content = await there.get(`/api/files/${fileId}/content`);
    assert.equal(content.status, 200);
    assert.equal(sha(content.buffer), sha(photo), 'the uploaded photo comes back byte for byte');
    const dbB = new DatabaseSync(path.join(dstHome, 'data', 'blumodel.db'), { readOnly: true });
    const pub = dbB.prepare("SELECT sha256, ext FROM files WHERE visibility = 'public' AND ext = 'glb' LIMIT 1").get();
    dbB.close();
    assert.ok(pub, 'the seed has a public model');
    const glb = await fetch(`${b.base}/files/${pub.sha256}.${pub.ext}`);
    assert.equal(glb.status, 200);
    assert.equal(sha(Buffer.from(await glb.arrayBuffer())), pub.sha256);
    assert.equal(await b.stop(), 0, b.output());
    b = null;

    // --replace keeps what was there, beside it.
    const rep = runScript('import-data.mjs', [bundle, '--home', dstHome, '--replace', '--port', String(port)]);
    assert.equal(rep.status, 0, rep.stdout + rep.stderr);
    assert.match(rep.stdout, /the database that was here is kept as .*blumodel\.db\.before-import-/);
    const kept = fs.readdirSync(path.join(dstHome, 'data'));
    assert.ok(kept.some((n) => /^blumodel\.db\.before-import-/.test(n)), kept.join(', '));
    assert.ok(kept.some((n) => /^uploads\.before-import-/.test(n)), kept.join(', '));
  } finally {
    await a?.stop();
    await b?.stop();
    rm(src);
    rm(dst);
    rm(carry);
  }
});

// ── the smaller rules, in process ───────────────────────────────────────────

/** A small home with a migrated database, one user and one upload. */
function smallHome(dir) {
  const dbPath = path.join(dir, 'data', 'blumodel.db');
  const db = openDb(dbPath);
  migrate(db);
  db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('u_1', 'a@test.blumodel', 'A', 'x', 'customer', 1)").run();
  const png = makePng({ w: 3, h: 3 });
  const s = sha(png);
  db.prepare(
    "INSERT INTO files (id, sha256, ext, mime, size_bytes, kind, visibility, owner_user_id, brand_id, original_name, meta, created_at) VALUES ('f_1', ?, 'png', 'image/png', ?, 'image', 'private', 'u_1', NULL, 'p.png', '{}', 1)",
  ).run(s, png.length);
  db.close();
  fs.mkdirSync(path.join(dir, 'data', 'uploads', s.slice(0, 2)), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'uploads', s.slice(0, 2), `${s}.png`), png);
  fs.mkdirSync(path.join(dir, 'data', 'uploads', 'tmp'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'uploads', 'tmp', 'upload-1.part'), 'half an upload');
  return { DB_PATH: dbPath, UPLOAD_DIR: path.join(dir, 'data', 'uploads'), BACKUP_DIR: path.join(dir, 'data', 'backups') };
}

test('export refuses to write inside a git checkout (the repo is public) or inside the uploads folder, and makes nothing there', () => {
  const dir = tempDir();
  try {
    const config = smallHome(dir);
    const inRepo = path.join(ROOT, '.tmp-tests', 'export-should-not-exist');
    assert.throws(() => exportData({ config, out: inRepo }), /inside the git checkout .*the repo is public/s);
    assert.equal(fs.existsSync(inRepo), false);
    assert.throws(() => exportData({ config, out: path.join(config.UPLOAD_DIR, 'x') }), /inside the uploads folder/);
    // A temp folder outside any checkout is fine; tmp/ (half-finished uploads) is never exported.
    const out = path.join(dir, 'usb');
    const r = exportData({ config, out });
    const names = r.manifest.files.map((f) => f.path);
    assert.ok(names.some((n) => /^uploads\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/.test(n)));
    assert.ok(!names.some((n) => n.includes('tmp')), names.join(', '));
    assert.equal(r.manifest.tables.users, 1);
    assert.equal(r.manifest.uploads.referenced, 1);
  } finally {
    rm(dir);
  }
});

test('secrets: left out unless asked for; with --include-secrets the settings file and the tunnel JSON go in (never cert.pem) and the warning is loud', () => {
  const dir = tempDir();
  try {
    const config = smallHome(dir);
    const settings = path.join(dir, 'blumodel.env');
    fs.writeFileSync(settings, FAKE_SETTINGS);
    const tunnel = path.join(dir, 'cloudflared');
    fs.mkdirSync(tunnel);
    fs.writeFileSync(path.join(tunnel, `${TUNNEL_ID}.json`), '{"AccountTag":"FAKE","TunnelSecret":"FAKE_FOR_TESTS"}');
    fs.writeFileSync(path.join(tunnel, 'cert.pem'), 'FAKE CERT FOR TESTS');
    fs.writeFileSync(path.join(tunnel, 'config.yml'), 'tunnel: x');

    const plain = exportData({ config, out: path.join(dir, 'a'), settingsFile: settings, tunnelDir: tunnel });
    assert.deepEqual(plain.manifest.secrets, []);
    assert.equal(fs.readFileSync(plain.bundle).includes(Buffer.from('sk_test_FAKE_FOR_TESTS')), false, 'no key without --include-secrets');

    const cli = runScript('export-data.mjs', ['--db', config.DB_PATH, '--out', path.join(dir, 'b'), '--include-secrets', '--settings', settings, '--tunnel-dir', tunnel]);
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
    assert.match(cli.stderr, /THIS BUNDLE WILL HOLD SECRETS/);
    assert.match(cli.stderr, /only over a private channel/);
    assert.match(cli.stderr, /Delete it from every place it was copied to/);
    assert.doesNotMatch(cli.stdout + cli.stderr, /FAKE_FOR_TESTS/, 'no secret is printed');
    const [tar] = fs.readdirSync(path.join(dir, 'b'));
    const m = JSON.parse(openBundle(path.join(dir, 'b', tar)).manifestText);
    assert.deepEqual(m.secrets, ['secrets/blumodel.env', `secrets/cloudflared/${TUNNEL_ID}.json`]);
    assert.ok(!m.files.some((f) => /cert\.pem|config\.yml/.test(f.path)));

    // Importing such a bundle never installs them: it says how to copy them by hand.
    const home = path.join(dir, 'wyse');
    const imp = runScript('import-data.mjs', [path.join(dir, 'b', tar), '--home', home, '--port', '1']);
    assert.equal(imp.status, 0, imp.stdout + imp.stderr);
    assert.match(imp.stderr, /carries secrets .*NOT installed/s);
    assert.equal(fs.existsSync(path.join(home, 'blumodel.env')), false);
    assert.deepEqual(fs.readdirSync(home).sort(), ['data']);
  } finally {
    rm(dir);
  }
});

test('a damaged, edited or incomplete bundle is refused before anything changes', () => {
  const dir = tempDir();
  try {
    const config = smallHome(dir);
    const r = exportData({ config, out: path.join(dir, 'out'), folder: true });
    const root = r.bundle;
    assert.ok(fs.statSync(root).isDirectory());
    const target = { DB_PATH: path.join(dir, 'wyse', 'data', 'blumodel.db'), UPLOAD_DIR: path.join(dir, 'wyse', 'data', 'uploads') };
    assert.equal(importData({ config: target, bundle: root, checkOnly: true }).counts.users, 1, 'the folder form checks out');

    const upload = r.manifest.files.find((f) => f.path.startsWith('uploads/')).path;
    const file = path.join(root, ...upload.split('/'));
    const good = fs.readFileSync(file);
    fs.writeFileSync(file, Buffer.concat([good.subarray(0, -1), Buffer.from([good[good.length - 1] ^ 1])]));
    assert.throws(() => importData({ config: target, bundle: root }), /did not verify; nothing was changed:\n {2}uploads\/.* does not match its checksum/);
    assert.equal(fs.existsSync(target.DB_PATH), false);
    fs.writeFileSync(file, good);

    fs.writeFileSync(path.join(root, 'uploads', 'extra.txt'), 'not from the export');
    assert.throws(() => importData({ config: target, bundle: root, checkOnly: true }), /uploads\/extra\.txt is in the bundle but not in its manifest/);
    fs.rmSync(path.join(root, 'uploads', 'extra.txt'));

    fs.renameSync(file, `${file}.away`);
    assert.throws(() => importData({ config: target, bundle: root, checkOnly: true }), /is missing from the bundle/);
    fs.renameSync(`${file}.away`, file);

    // A tar cut short (a copy that didn't finish).
    const tarred = exportData({ config, out: path.join(dir, 'out2') }).bundle;
    const cut = path.join(dir, 'cut.tar');
    fs.writeFileSync(cut, fs.readFileSync(tarred).subarray(0, 2048));
    assert.throws(() => importData({ config: target, bundle: cut, checkOnly: true }), /copied only partly/);
    assert.throws(() => importData({ config: target, bundle: path.join(dir, 'nope.tar') }), /No bundle at/);
  } finally {
    rm(dir);
  }
});

test('a database that fails its integrity check, or comes from a newer app, is refused', () => {
  const dir = tempDir();
  try {
    const config = smallHome(dir);
    const target = { DB_PATH: path.join(dir, 'wyse', 'data', 'blumodel.db'), UPLOAD_DIR: path.join(dir, 'wyse', 'data', 'uploads') };
    // Newer app: a migration this install has never heard of.
    const db = new DatabaseSync(config.DB_PATH);
    db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES ('zeta-001-from-the-future', 1)").run();
    db.close();
    const newer = exportData({ config, out: path.join(dir, 'n') }).bundle;
    assert.throws(() => importData({ config: target, bundle: newer }), /newer version of the app .*zeta-001-from-the-future.*Update this install first/s);
    assert.equal(fs.existsSync(target.DB_PATH), false);

    // A bundle whose database bytes are damaged but whose manifest was rewritten to match them.
    const folder = exportData({ config, out: path.join(dir, 'c'), folder: true }).bundle;
    const dbFile = path.join(folder, 'db', 'blumodel.db');
    const bytes = fs.readFileSync(dbFile);
    const pageSize = bytes.readUInt16BE(16) || 65536;
    for (let i = pageSize + 8; i < Math.min(bytes.length, pageSize * 3); i++) bytes[i] = 0xa5; // scribble over b-tree pages
    fs.writeFileSync(dbFile, bytes);
    const mPath = path.join(folder, 'manifest.json');
    const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    m.files.find((f) => f.path === 'db/blumodel.db').sha256 = sha(bytes);
    fs.writeFileSync(mPath, JSON.stringify(m));
    assert.throws(() => importData({ config: target, bundle: folder, checkOnly: true }), /integrity_check|malformed|not a database/i);
  } finally {
    rm(dir);
  }
});

test('tar entries with unsafe paths (.., absolute, drive letters, backslashes) or links are refused', () => {
  const dir = tempDir();
  try {
    const make = (name, type = '0') => {
      const body = Buffer.from('x');
      const file = path.join(dir, `t-${crypto.randomBytes(4).toString('hex')}.tar`);
      const pad = Buffer.alloc(511, 0);
      fs.writeFileSync(file, Buffer.concat([tarHeader({ name: 'blumodel-data-x/manifest.json', size: 2 }), Buffer.from('{}'), Buffer.alloc(510, 0), tarHeader({ name, size: type === '0' ? 1 : 0, type }), ...(type === '0' ? [body, pad] : []), Buffer.alloc(1024, 0)]));
      return file;
    };
    for (const bad of ['blumodel-data-x/../evil.txt', '/etc/passwd', 'blumodel-data-x/C:/x', 'blumodel-data-x/a\\..\\b', 'other-top/x']) {
      assert.throws(() => openBundle(make(bad)), /unsafe path|more than one top folder/, bad);
    }
    assert.throws(() => openBundle(make('blumodel-data-x/link', '2')), /not a plain file or folder/);
    for (const ok of ['uploads/ab/abc.png', 'db/blumodel.db', 'secrets/cloudflared/x.json']) assert.equal(safeRelPath(ok), true, ok);
    for (const no of ['', '../x', 'a/../b', '/a', 'a\\b', 'C:x', 'a//b', 'a/./b', 'a.', 'con:']) assert.equal(safeRelPath(no), false, no);
  } finally {
    rm(dir);
  }
});

test('the .tar opens with the tar both OSes ship, and a bundle re-packed by that tar still imports', (t) => {
  const tarExe = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  if (spawnSync(tarExe, ['--version'], { encoding: 'utf8', windowsHide: true }).status !== 0) {
    t.skip(`no ${tarExe} here`);
    return;
  }
  const dir = tempDir();
  try {
    const config = smallHome(dir);
    const r = exportData({ config, out: path.join(dir, 'out') });
    const listed = spawnSync(tarExe, ['-tf', path.basename(r.bundle)], { cwd: path.dirname(r.bundle), encoding: 'utf8', windowsHide: true });
    assert.equal(listed.status, 0, listed.stderr);
    const top = path.basename(r.bundle, '.tar');
    assert.ok(listed.stdout.split(/\r?\n/).includes(`${top}/manifest.json`), listed.stdout);
    const x = path.join(dir, 'x');
    fs.mkdirSync(x);
    const extracted = spawnSync(tarExe, ['-xf', r.bundle], { cwd: x, encoding: 'utf8', windowsHide: true });
    assert.equal(extracted.status, 0, extracted.stderr);
    for (const f of r.manifest.files) assert.equal(sha(fs.readFileSync(path.join(x, top, ...f.path.split('/')))), f.sha256, f.path);
    // The extracted folder is a bundle too, and so is a tar that tool makes of it.
    const target = { DB_PATH: path.join(dir, 'w', 'data', 'blumodel.db'), UPLOAD_DIR: path.join(dir, 'w', 'data', 'uploads') };
    assert.equal(importData({ config: target, bundle: path.join(x, top), checkOnly: true }).counts.users, 1);
    const repacked = path.join(dir, 'repacked.tar');
    const pack = spawnSync(tarExe, ['-cf', repacked, top], { cwd: x, encoding: 'utf8', windowsHide: true });
    assert.equal(pack.status, 0, pack.stderr);
    assert.equal(importData({ config: target, bundle: repacked }).counts.users, 1);
  } finally {
    rm(dir);
  }
});

test('import: an empty migrated database (a server that started once) is not "data"; a failed migration puts the old data back', () => {
  const dir = tempDir();
  try {
    const config = smallHome(dir);
    // Bundle whose database will fail this app's migrations: retail-001 is marked not applied but
    // its tables exist, so running it again fails ("table retailers already exists").
    const db = new DatabaseSync(config.DB_PATH);
    db.prepare("DELETE FROM schema_migrations WHERE id = 'retail-001-retailers-clicks'").run();
    db.close();
    const broken = exportData({ config, out: path.join(dir, 'b') }).bundle;

    const wyse = { DB_PATH: path.join(dir, 'wyse', 'data', 'blumodel.db'), UPLOAD_DIR: path.join(dir, 'wyse', 'data', 'uploads') };
    const fresh = openDb(wyse.DB_PATH);
    migrate(fresh);
    fresh.close();
    assert.deepEqual(existingData(wyse), { db: true, rows: 0, uploads: 0 });

    assert.throws(() => importData({ config: wyse, bundle: broken }), /already exists[\s\S]*What was there before is back in place/);
    const back = new DatabaseSync(wyse.DB_PATH, { readOnly: true });
    assert.equal(back.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0, 'the empty database is back');
    back.close();
    const names = fs.readdirSync(path.dirname(wyse.DB_PATH));
    assert.ok(names.some((n) => /^blumodel\.db\.failed-import-/.test(n)), names.join(', '));
    assert.ok(!names.some((n) => n.startsWith('.import-')), 'staging removed');
  } finally {
    rm(dir);
  }
});

test('import: a failure part way through setting the old data aside (a folder that can’t be renamed) undoes exactly what was done', () => {
  const dir = tempDir();
  try {
    const bundle = exportData({ config: smallHome(path.join(dir, 'a')), out: path.join(dir, 'out') }).bundle;
    // The machine being imported into has real data: a user, and an upload.
    const wyse = smallHome(path.join(dir, 'wyse'));
    const db = new DatabaseSync(wyse.DB_PATH);
    db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('u_2', 'b@test.blumodel', 'B', 'x', 'customer', 2)").run();
    db.close();
    // Where the uploads would be set aside is already taken by a non-empty folder: the rename fails
    // on every OS, after the database has been moved aside.
    const at = Date.UTC(2026, 9, 16, 5);
    const blocked = `${wyse.UPLOAD_DIR}.before-import-2026-10-16T05-00-00Z`;
    fs.mkdirSync(blocked, { recursive: true });
    fs.writeFileSync(path.join(blocked, 'in-the-way.txt'), 'x');
    assert.throws(() => importData({ config: wyse, bundle, replace: true, now: () => at }), /What was there before is back in place\.$/);
    const back = new DatabaseSync(wyse.DB_PATH, { readOnly: true });
    assert.equal(back.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2, 'the database is back where it was');
    back.close();
    assert.equal(listFiles(wyse.UPLOAD_DIR, { skipTop: ['tmp'] }).length, 1, 'the uploads never moved');
    const names = fs.readdirSync(path.dirname(wyse.DB_PATH));
    assert.ok(!names.some((n) => /before-import|failed-import|^\.import-/.test(n) && !n.startsWith('uploads.before-import')), names.join(', '));
  } finally {
    rm(dir);
  }
});

