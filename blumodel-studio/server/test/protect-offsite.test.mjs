// Encrypted off-site backups and encrypted export bundles (server/ops/crypt.mjs, offsite.mjs,
// dataBundle.mjs, server/scripts/restore-offsite.mjs, export-data.mjs, import-data.mjs) and the
// age rules every backup location follows (backup.mjs pruneAged). Temp folders and fake
// passphrases only; no real home, port or drive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { makePng } from './fixtures/images.mjs';
import { startTestServer } from './helpers.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { decryptFile, decryptToFile, encryptFile, EncryptWriter, isEncryptedFile, MAGIC, passphraseProblem, readEncryptedHeader } from '../ops/crypt.mjs';
import { listOffsite, offsiteBackupNow, offsiteStatus, pruneOffsite, startOffsiteBackup } from '../ops/offsite.mjs';
import { exportData, importData, pruneExports } from '../ops/dataBundle.mjs';
import { pruneAged, runDailyBackup } from '../ops/backup.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(HERE, '..', 'scripts');
const PASS = 'FAKE correct horse battery staple';
const OTHER = 'FAKE some other passphrase';
const EMAIL = 'secret-customer@offsite.test';
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-18T03:00:00Z');

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-offsite-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const quiet = { info() {}, warn() {}, error() {} };

/** A home with a migrated database (one user with a recognisable email) and one upload. */
function home(dir) {
  const dbPath = path.join(dir, 'data', 'blumodel.db');
  const db = openDb(dbPath);
  migrate(db);
  db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES ('u_1', ?, 'A', 'x', 'customer', 1)").run(EMAIL);
  const png = makePng({ w: 5, h: 5, rgba: [10, 200, 30, 255] });
  const s = sha(png);
  db.prepare("INSERT INTO files (id, sha256, ext, mime, size_bytes, kind, visibility, owner_user_id, brand_id, original_name, meta, created_at) VALUES ('f_1', ?, 'png', 'image/png', ?, 'image', 'private', 'u_1', NULL, 'p.png', '{}', 1)").run(s, png.length);
  db.close();
  fs.mkdirSync(path.join(dir, 'data', 'uploads', s.slice(0, 2)), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'uploads', s.slice(0, 2), `${s}.png`), png);
  const offsite = path.join(dir, 'OneDrive', 'BluModel-backups');
  fs.mkdirSync(offsite, { recursive: true });
  return {
    png,
    config: {
      DB_PATH: dbPath,
      UPLOAD_DIR: path.join(dir, 'data', 'uploads'),
      BACKUP_DIR: path.join(dir, 'data', 'backups'),
      BACKUPS: 'on',
      BACKUP_KEEP: 14,
      BACKUP_OFFSITE_DIR: offsite,
      BACKUP_OFFSITE_KEEP: 30,
      BACKUP_PASSPHRASE: PASS,
    },
  };
}

const cleanEnv = (extra = {}) => {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'windir', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT'];
  const env = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, ...extra };
};
const run = (script, args, env = {}) => spawnSync(process.execPath, ['--no-warnings', path.join(SCRIPTS, script), ...args], { env: cleanEnv(env), encoding: 'utf8', windowsHide: true, timeout: 120_000, input: '' });

// ── the cipher ──────────────────────────────────────────────────────────────

test('encrypt, decrypt and the round trip: many chunks, the header, byte for byte', () => {
  const dir = tempDir();
  try {
    const src = path.join(dir, 'plain.bin');
    const data = crypto.randomBytes(300_000);
    fs.writeFileSync(src, data);
    const enc = path.join(dir, 'x.enc');
    const w = encryptFile(src, enc, { passphrase: PASS, header: { kind: 'test', n: 1 }, chunk: 64 * 1024 });
    assert.equal(w.plainBytes, data.length);
    assert.equal(w.plainSha256, sha(data));
    assert.ok(isEncryptedFile(enc));
    assert.ok(!isEncryptedFile(src));
    const bytes = fs.readFileSync(enc);
    assert.ok(bytes.subarray(0, 8).equals(MAGIC));
    assert.equal(bytes.includes(data.subarray(1000, 1064)), false, 'no plaintext in the file');
    assert.deepEqual(readEncryptedHeader(enc, PASS).header, { kind: 'test', n: 1 });
    const out = path.join(dir, 'back.bin');
    const r = decryptToFile(enc, out, PASS);
    assert.equal(r.plainSha256, sha(data));
    assert.ok(fs.readFileSync(out).equals(data));
    // Two encryptions of the same data differ (fresh salt and nonce).
    const enc2 = path.join(dir, 'y.enc');
    encryptFile(src, enc2, { passphrase: PASS, chunk: 64 * 1024 });
    assert.equal(sha(fs.readFileSync(enc2)) === sha(bytes), false);
    // An empty file and a file of exactly one chunk.
    for (const size of [0, 64 * 1024]) {
      const p = path.join(dir, `s${size}`);
      fs.writeFileSync(p, data.subarray(0, size));
      encryptFile(p, `${p}.enc`, { passphrase: PASS, chunk: 64 * 1024 });
      const chunks = [];
      decryptFile(`${p}.enc`, PASS, (b) => chunks.push(b));
      assert.ok(Buffer.concat(chunks).equals(data.subarray(0, size)), `size ${size}`);
    }
  } finally {
    rm(dir);
  }
});

test('a wrong passphrase, an edited byte, a cut-off file and extra bytes are all refused', () => {
  const dir = tempDir();
  try {
    const src = path.join(dir, 'plain.bin');
    fs.writeFileSync(src, crypto.randomBytes(200_000));
    const enc = path.join(dir, 'x.enc');
    encryptFile(src, enc, { passphrase: PASS, chunk: 50_000 });
    assert.throws(() => readEncryptedHeader(enc, OTHER), (e) => e.code === 'bad_passphrase' && /passphrase is wrong/.test(e.message));
    assert.throws(() => decryptFile(enc, OTHER), (e) => e.code === 'bad_passphrase');
    // decryptToFile leaves nothing behind when it fails.
    const out = path.join(dir, 'out.bin');
    assert.throws(() => decryptToFile(enc, out, OTHER));
    assert.equal(fs.existsSync(out), false);

    const bytes = fs.readFileSync(enc);
    const edited = Buffer.from(bytes);
    edited[Math.floor(bytes.length / 2)] ^= 0x01;
    fs.writeFileSync(path.join(dir, 'edited.enc'), edited);
    assert.throws(() => decryptFile(path.join(dir, 'edited.enc'), PASS), (e) => e.code === 'damaged');
    readEncryptedHeader(path.join(dir, 'edited.enc'), PASS); // the header itself is intact

    // Cut off at a record boundary: every record left is genuine, but the final one is missing.
    const recEnd = [];
    let pos = 8 + 4 + bytes.readUInt32BE(8);
    while (pos < bytes.length) {
      pos += 4 + bytes.readUInt32BE(pos) + 16;
      recEnd.push(pos);
    }
    fs.writeFileSync(path.join(dir, 'cut.enc'), bytes.subarray(0, recEnd[recEnd.length - 2]));
    assert.throws(() => decryptFile(path.join(dir, 'cut.enc'), PASS), /cut short|damaged/);
    fs.writeFileSync(path.join(dir, 'cut2.enc'), bytes.subarray(0, bytes.length - 7));
    assert.throws(() => decryptFile(path.join(dir, 'cut2.enc'), PASS), (e) => e.code === 'damaged');
    fs.writeFileSync(path.join(dir, 'more.enc'), Buffer.concat([bytes, Buffer.from('extra')]));
    assert.throws(() => decryptFile(path.join(dir, 'more.enc'), PASS), /after its last record|damaged/);
    assert.throws(() => readEncryptedHeader(src, PASS), (e) => e.code === 'not_encrypted');

    // A short or missing passphrase is refused before anything is written.
    assert.match(passphraseProblem(''), /not set/);
    assert.match(passphraseProblem('short'), /shorter than 12/);
    assert.equal(passphraseProblem(PASS), null);
    assert.throws(() => new EncryptWriter(path.join(dir, 'nope.enc'), { passphrase: 'short' }), /shorter than 12/);
    assert.equal(fs.existsSync(path.join(dir, 'nope.enc')), false);
  } finally {
    rm(dir);
  }
});

// ── the off-site job ────────────────────────────────────────────────────────

test('off-site: one encrypted copy a day in BACKUP_OFFSITE_DIR, no plaintext anywhere in it, its status for Admin > System', () => {
  const dir = tempDir();
  try {
    const { config, png } = home(dir);
    const r = offsiteBackupNow({ config, now: () => NOW });
    assert.equal(r.ok, true, r.error);
    assert.match(path.basename(r.file), /^blumodel-offsite-2026-10-18T03-00-00Z\.tar\.enc$/);
    assert.deepEqual(fs.readdirSync(config.BACKUP_OFFSITE_DIR), [path.basename(r.file)], 'nothing else (no .part, no work files) in the synced folder');
    const bytes = fs.readFileSync(r.file);
    assert.equal(bytes.includes(Buffer.from(EMAIL)), false, 'the database is not readable in it');
    assert.equal(bytes.includes(png.subarray(0, 40)), false, 'the upload is not readable in it');
    assert.equal(bytes.includes(Buffer.from('manifest.json')), false);
    assert.equal(readEncryptedHeader(r.file, PASS).header.kind, 'offsite');
    // The same day again: nothing new. force: a second copy.
    assert.equal(offsiteBackupNow({ config, now: () => NOW + 3_600_000 }).skipped, true);
    assert.equal(listOffsite(config.BACKUP_OFFSITE_DIR).length, 1);

    const st = offsiteStatus(config, { now: () => NOW + 3_600_000 });
    assert.equal(st.configured, true);
    assert.equal(st.dir, config.BACKUP_OFFSITE_DIR);
    assert.equal(st.lastSuccessAt, NOW);
    assert.equal(st.lastBytes, bytes.length);
    assert.equal(st.lastFile, path.basename(r.file));
    assert.equal(st.copies, 1);
    assert.equal(st.passphraseSet, true);
    assert.equal(st.problem, null);
    assert.equal(st.lastError, null);
    assert.equal(st.stale, false);
    assert.equal(JSON.stringify(st).includes(PASS), false, 'never the passphrase');
    assert.equal(fs.readFileSync(path.join(config.BACKUP_DIR, 'offsite-status.json'), 'utf8').includes(PASS), false);
    assert.equal(offsiteStatus(config, { now: () => NOW + 3 * DAY }).stale, true, 'behind after 48 hours');
    assert.equal(offsiteStatus({ ...config, BACKUP_OFFSITE_DIR: '' }).configured, false);
  } finally {
    rm(dir);
  }
});

test('off-site: keeps the newest BACKUP_OFFSITE_KEEP, none older than 35 days, and verifies every copy kept by decrypting its header', () => {
  const dir = tempDir();
  try {
    const { config } = home(dir);
    const d = config.BACKUP_OFFSITE_DIR;
    // Fifteen days of earlier copies (made with the same passphrase), a 40-day-old one, and a stale .part.
    for (let i = 1; i <= 15; i++) {
      const at = new Date(NOW - i * DAY).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
      fs.writeFileSync(path.join(dir, 'x'), `copy ${i}`);
      encryptFile(path.join(dir, 'x'), path.join(d, `blumodel-offsite-${at}.tar.enc`), { passphrase: PASS });
    }
    encryptFile(path.join(dir, 'x'), path.join(d, 'blumodel-offsite-2026-09-08T03-00-00Z.tar.enc'), { passphrase: PASS });
    fs.writeFileSync(path.join(d, 'blumodel-offsite-2026-10-10T03-00-00Z.tar.enc.part'), 'half');
    fs.utimesSync(path.join(d, 'blumodel-offsite-2026-10-10T03-00-00Z.tar.enc.part'), new Date(NOW - 3 * DAY), new Date(NOW - 3 * DAY));
    fs.writeFileSync(path.join(d, 'my-notes.txt'), 'not ours: never touched');
    const r = offsiteBackupNow({ config: { ...config, BACKUP_OFFSITE_KEEP: 10 }, now: () => NOW });
    assert.equal(r.ok, true, r.error);
    const left = listOffsite(d);
    assert.equal(left.length, 10, left.map((c) => c.name).join(', '));
    assert.equal(left[0].file, r.file, 'the newest is the one just written');
    assert.ok(!left.some((c) => c.name.startsWith('blumodel-offsite-2026-09-08')), 'past 35 days');
    assert.equal(r.verified, 10);
    assert.ok(fs.existsSync(path.join(d, 'my-notes.txt')));
    assert.ok(!fs.readdirSync(d).some((n) => n.endsWith('.part')));
    // A copy that no longer opens with the passphrase is reported, not hidden.
    const odd = path.join(d, 'blumodel-offsite-2026-10-17T12-00-00Z.tar.enc');
    encryptFile(path.join(dir, 'x'), odd, { passphrase: OTHER });
    const again = offsiteBackupNow({ config, now: () => NOW + DAY, force: true });
    assert.equal(again.ok, true);
    assert.deepEqual(again.unreadable.length, 1);
    assert.match(offsiteStatus(config, { now: () => NOW + DAY }).lastError, /no longer open with BACKUP_PASSPHRASE/);
    // pruneOffsite on its own: by count, never the newest.
    assert.equal(pruneOffsite(d, { keep: 1, now: () => NOW + DAY, newest: again.file }).length >= 9, true);
    assert.deepEqual(listOffsite(d).map((c) => c.file), [again.file]);
  } finally {
    rm(dir);
  }
});

test('off-site: a missing folder or passphrase warns and records it, never throws, never creates the folder or writes anything plain', async () => {
  const dir = tempDir();
  try {
    const { config } = home(dir);
    const gone = path.join(dir, 'E-drive-unplugged', 'backups');
    const r = offsiteBackupNow({ config: { ...config, BACKUP_OFFSITE_DIR: gone }, now: () => NOW });
    assert.equal(r.ok, false);
    assert.match(r.error, /doesn't exist .*plugged in/);
    assert.equal(fs.existsSync(gone), false, 'the folder is not created');
    const st = offsiteStatus({ ...config, BACKUP_OFFSITE_DIR: gone }, { now: () => NOW });
    assert.match(st.problem, /doesn't exist/);
    assert.match(st.lastError, /doesn't exist/);
    assert.equal(st.stale, true);

    for (const BACKUP_PASSPHRASE of ['', 'too-short']) {
      const x = offsiteBackupNow({ config: { ...config, BACKUP_PASSPHRASE }, now: () => NOW });
      assert.equal(x.ok, false);
      assert.match(x.error, /BACKUP_PASSPHRASE .*never written unencrypted/);
    }
    assert.deepEqual(fs.readdirSync(config.BACKUP_OFFSITE_DIR), [], 'nothing written without a usable passphrase');

    // From the daily job: a warning in the log, the local backup still made, no throw.
    const warns = [];
    const log = { info() {}, error: (m) => warns.push(m), warn: (m) => warns.push(m) };
    const live = new DatabaseSync(config.DB_PATH);
    try {
      const out = runDailyBackup({ db: live, config: { ...config, BACKUP_OFFSITE_DIR: gone }, now: () => NOW, log });
      assert.ok(out?.made, 'the local backup is made');
      await new Promise((r2) => setTimeout(r2, 300));
      assert.ok(warns.some((w) => /Off-site backup not made: .*doesn't exist/.test(w)), warns.join(' | '));
    } finally {
      live.close();
    }
  } finally {
    rm(dir);
  }
});

test('off-site: the daily job starts it in a worker thread after the local backup, and the copy restores with restore-offsite.mjs', { timeout: 120_000 }, async () => {
  const dir = tempDir();
  try {
    const { config, png } = home(dir);
    const live = new DatabaseSync(config.DB_PATH);
    let started = null;
    try {
      runDailyBackup({ db: live, config, log: quiet, offsite: (o) => (started = startOffsiteBackup(o)) });
    } finally {
      live.close();
    }
    assert.ok(started, 'the off-site job was started');
    const r = await started;
    assert.equal(r.ok, true, r.error);
    const [copy] = listOffsite(config.BACKUP_OFFSITE_DIR);
    assert.ok(copy);

    // Change the live data, then check and restore from the off-site copy.
    const db = new DatabaseSync(config.DB_PATH);
    db.prepare("UPDATE users SET name = 'changed after the backup'").run();
    db.close();
    const s = sha(png);
    fs.rmSync(path.join(config.UPLOAD_DIR, s.slice(0, 2), `${s}.png`));
    const where = ['--db', config.DB_PATH, '--uploads-dir', config.UPLOAD_DIR, '--port', '9049'];

    const wrong = run('restore-offsite.mjs', [copy.file, ...where], { BACKUP_PASSPHRASE: OTHER });
    assert.equal(wrong.status, 1, wrong.stdout + wrong.stderr);
    assert.match(wrong.stderr, /passphrase is wrong/);
    assert.doesNotMatch(wrong.stdout + wrong.stderr, new RegExp(OTHER));
    const none = run('restore-offsite.mjs', [copy.file, ...where]);
    assert.equal(none.status, 2);
    assert.match(none.stderr, /no BACKUP_PASSPHRASE/);

    const check = run('restore-offsite.mjs', [copy.file, '--check', ...where], { BACKUP_PASSPHRASE: PASS });
    assert.equal(check.status, 0, check.stdout + check.stderr);
    assert.match(check.stdout, /every file matches its sha256/);
    assert.match(check.stdout, /Nothing was changed/);
    const pf = path.join(dir, 'pass.txt');
    fs.writeFileSync(pf, `${PASS}\n`);
    const res = run('restore-offsite.mjs', [copy.file, '--uploads', '--passphrase-file', pf, ...where]);
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /Restored the database .*kept as .*before-restore-.*deleted after 30 days/);
    assert.match(res.stdout, /Copied 1 missing upload/);
    const back = new DatabaseSync(config.DB_PATH, { readOnly: true });
    assert.equal(back.prepare('SELECT name FROM users').get().name, 'A');
    back.close();
    assert.ok(fs.readFileSync(path.join(config.UPLOAD_DIR, s.slice(0, 2), `${s}.png`)).equals(png));
    assert.ok(!fs.readdirSync(path.dirname(config.DB_PATH)).some((n) => n.startsWith('.restore-offsite-')), 'no temp copy left');
    // import-data takes the same file as it is (a new machine).
    const fresh = path.join(dir, 'newbox');
    const imp = run('import-data.mjs', [copy.file, '--home', fresh, '--port', '9048'], { BACKUP_PASSPHRASE: PASS });
    assert.equal(imp.status, 0, imp.stdout + imp.stderr);
    assert.match(imp.stdout, /encrypted tar/);
    assert.ok(!fs.readdirSync(path.join(fresh, 'data')).some((n) => n.startsWith('.decrypt-')));
  } finally {
    rm(dir);
  }
});

test('Admin > System shows the off-site backups (GET /api/admin/system -> backups.offsite), never the passphrase', async () => {
  const dir = tempDir();
  const offsite = path.join(dir, 'Dropbox');
  fs.mkdirSync(offsite);
  const t = await startTestServer({ env: { BACKUP_DIR: path.join(dir, 'backups'), BACKUP_OFFSITE_DIR: offsite, BACKUP_PASSPHRASE: PASS } });
  try {
    const admin = await t.user({ role: 'admin' });
    const before = (await admin.get('/api/admin/system')).body.backups.offsite;
    assert.equal(before.configured, true);
    assert.equal(before.dir, offsite);
    assert.equal(before.passphraseSet, true);
    assert.equal(before.lastSuccessAt, null);
    assert.equal(before.stale, true);
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'backups', 'offsite-status.json'), JSON.stringify({ dir: offsite, lastSuccessAt: Date.now() - 1000, lastBytes: 12345, lastFile: 'blumodel-offsite-x.tar.enc', copies: 3 }));
    const r = await admin.get('/api/admin/system');
    assert.equal(r.body.backups.offsite.lastBytes, 12345);
    assert.equal(r.body.backups.offsite.copies, 3);
    assert.equal(r.body.backups.offsite.stale, false);
    assert.equal(r.text.includes(PASS), false);
    const customer = await t.user();
    assert.equal((await customer.get('/api/admin/system')).status, 403);
    assert.equal((await t.agent().get('/api/health')).text.includes(offsite), false, 'the public health check names no folder');
  } finally {
    await t.close();
    rm(dir);
  }
});

// ── export bundles ──────────────────────────────────────────────────────────

test('export bundles: encrypted with the same scheme, round trip through import, secrets only encrypted, the CLI refuses a plain bundle unless --plain', () => {
  const dir = tempDir();
  try {
    const { config } = home(dir);
    const out = path.join(dir, 'usb');
    const r = exportData({ config, out, passphrase: PASS });
    assert.match(path.basename(r.bundle), /^blumodel-data-.*\.tar\.enc$/);
    assert.equal(r.encrypted, true);
    assert.equal(fs.readFileSync(r.bundle).includes(Buffer.from(EMAIL)), false);
    assert.equal(fs.existsSync(path.join(config.BACKUP_DIR, '.work')) ? fs.readdirSync(path.join(config.BACKUP_DIR, '.work')).length : 0, 0, 'the plain work copy is gone');
    assert.deepEqual(fs.readdirSync(out), [path.basename(r.bundle)]);
    const target = { DB_PATH: path.join(dir, 'b', 'data', 'blumodel.db'), UPLOAD_DIR: path.join(dir, 'b', 'data', 'uploads') };
    assert.throws(() => importData({ config: target, bundle: r.bundle }), /is encrypted: set BACKUP_PASSPHRASE/);
    assert.throws(() => importData({ config: target, bundle: r.bundle, passphrase: OTHER }), /passphrase is wrong/);
    const imp = importData({ config: target, bundle: r.bundle, passphrase: PASS });
    assert.equal(imp.encrypted, true);
    assert.equal(imp.counts.users, 1);
    assert.ok(!fs.readdirSync(path.join(dir, 'b', 'data')).some((n) => n.startsWith('.decrypt-')));

    assert.throws(() => exportData({ config, out: path.join(dir, 'p'), includeSecrets: true }), /must be encrypted/);
    assert.throws(() => exportData({ config, out: path.join(dir, 'p'), folder: true, passphrase: PASS }), /one file/);

    const refused = run('export-data.mjs', ['--db', config.DB_PATH, '--out', path.join(dir, 'c')]);
    assert.equal(refused.status, 2, refused.stdout + refused.stderr);
    assert.match(refused.stderr, /no BACKUP_PASSPHRASE/);
    assert.equal(fs.existsSync(path.join(dir, 'c')), false);
    const plainSecrets = run('export-data.mjs', ['--db', config.DB_PATH, '--out', path.join(dir, 'c'), '--plain', '--include-secrets']);
    assert.equal(plainSecrets.status, 2);
    assert.match(plainSecrets.stderr, /must be encrypted/);
    const enc = run('export-data.mjs', ['--db', config.DB_PATH, '--out', path.join(dir, 'c')], { BACKUP_PASSPHRASE: PASS });
    assert.equal(enc.status, 0, enc.stdout + enc.stderr);
    assert.match(enc.stdout, /encrypted with AES-256-GCM/);
    assert.doesNotMatch(enc.stdout + enc.stderr, new RegExp(PASS));
    const plain = run('export-data.mjs', ['--db', config.DB_PATH, '--out', path.join(dir, 'd'), '--plain']);
    assert.equal(plain.status, 0, plain.stdout + plain.stderr);
    assert.match(plain.stderr, /NOT encrypted/);
  } finally {
    rm(dir);
  }
});

test('export bundles in backups/exports are deleted after 7 days; the bundle just made is kept', () => {
  const dir = tempDir();
  try {
    const { config } = home(dir);
    const exp = path.join(config.BACKUP_DIR, 'exports');
    fs.mkdirSync(exp, { recursive: true });
    for (const n of ['blumodel-data-2026-10-01T00-00-00Z.tar', 'blumodel-data-2026-10-02T00-00-00Z.tar.enc', 'blumodel-data-2026-10-16T00-00-00Z.tar.enc', 'blumodel-data-2026-10-01T00-00-00Z.tar.part', 'notes.txt']) fs.writeFileSync(path.join(exp, n), 'x');
    fs.mkdirSync(path.join(exp, 'blumodel-data-2026-10-03T00-00-00Z'));
    const removed = pruneExports(exp, { now: () => NOW }).map((p) => path.basename(p)).sort();
    assert.deepEqual(removed, ['blumodel-data-2026-10-01T00-00-00Z.tar', 'blumodel-data-2026-10-01T00-00-00Z.tar.part', 'blumodel-data-2026-10-02T00-00-00Z.tar.enc', 'blumodel-data-2026-10-03T00-00-00Z']);
    assert.deepEqual(fs.readdirSync(exp).sort(), ['blumodel-data-2026-10-16T00-00-00Z.tar.enc', 'notes.txt']);
    // An export into the default folder prunes it as well (and keeps itself, whatever the clock says).
    fs.writeFileSync(path.join(exp, 'blumodel-data-2026-09-01T00-00-00Z.tar.enc'), 'x');
    const r = exportData({ config, passphrase: PASS });
    assert.ok(r.pruned.some((p) => p.endsWith('blumodel-data-2026-09-01T00-00-00Z.tar.enc')));
    assert.ok(fs.existsSync(r.bundle));
  } finally {
    rm(dir);
  }
});

// ── the age rules ───────────────────────────────────────────────────────────

test('pruneAged: pre-deploy copies, before-restore / before-import / failed-import copies age out after 30 days; daily copies and other files are left alone', () => {
  const dir = tempDir();
  try {
    const { config } = home(dir);
    const b = config.BACKUP_DIR;
    const data = path.dirname(config.DB_PATH);
    fs.mkdirSync(path.join(b, 'daily'), { recursive: true });
    fs.writeFileSync(path.join(b, 'daily', 'blumodel-2026-08-01.db'), 'x');
    for (const n of ['2026-09-01T10-00-00-000Z', '2026-10-10T10-00-00-000Z']) fs.mkdirSync(path.join(b, n));
    fs.mkdirSync(path.join(b, 'uploads-mirror'), { recursive: true });
    const files = [
      'blumodel.db.before-restore-2026-09-01T10-00-00-000Z',
      'blumodel.db.before-restore-2026-09-01T10-00-00-000Z-wal',
      'blumodel.db.before-restore-2026-10-15T10-00-00-000Z',
      'blumodel.db.before-import-2026-09-10T05-00-00Z',
      'blumodel.db.failed-import-2026-09-10T05-00-00Z',
      'other.db.before-restore-2026-01-01T10-00-00-000Z',
    ];
    for (const n of files) fs.writeFileSync(path.join(data, n), 'x');
    fs.mkdirSync(path.join(data, 'uploads.before-import-2026-09-10T05-00-00Z'));
    fs.mkdirSync(path.join(data, 'uploads.before-import-2026-10-17T05-00-00Z'));
    const removed = pruneAged({ config, now: () => NOW }).map((p) => path.basename(p)).sort();
    assert.deepEqual(removed, [
      '2026-09-01T10-00-00-000Z',
      'blumodel.db.before-import-2026-09-10T05-00-00Z',
      'blumodel.db.before-restore-2026-09-01T10-00-00-000Z',
      'blumodel.db.before-restore-2026-09-01T10-00-00-000Z-wal',
      'blumodel.db.failed-import-2026-09-10T05-00-00Z',
      'uploads.before-import-2026-09-10T05-00-00Z',
    ]);
    assert.ok(fs.existsSync(path.join(b, '2026-10-10T10-00-00-000Z')));
    assert.ok(fs.existsSync(path.join(b, 'daily', 'blumodel-2026-08-01.db')), 'daily/ is kept by count (pruneDaily), not here');
    assert.ok(fs.existsSync(path.join(data, 'other.db.before-restore-2026-01-01T10-00-00-000Z')), 'another database’s copies are not ours');
    assert.ok(fs.existsSync(path.join(data, 'uploads.before-import-2026-10-17T05-00-00Z')));
    assert.ok(fs.existsSync(config.DB_PATH) && fs.existsSync(config.UPLOAD_DIR));
  } finally {
    rm(dir);
  }
});
