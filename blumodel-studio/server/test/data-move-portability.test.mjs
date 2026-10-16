// Nothing in the running site may depend on this PC or on Windows (docs/MOVING_DATA.md): the
// server must behave the same on the Wyse under Linux, in another time zone and another locale,
// from another folder. These tests pin the fixes and the checks that found nothing to fix.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { defaultDbPath, loadConfig } from '../config.mjs';
import { deployedHome } from '../lib/envFile.mjs';
import { assertServerStopped, backupNow, processesUsing, restoreBackup, scriptConfig, SERVICE_HINTS } from '../ops/backup.mjs';
import { installLogFile, rotateLog } from '../ops/logs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(HERE, '..');
const POSIX = process.platform !== 'win32';
const tempDir = (p = 'blumodel-port-') => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });

/** Every runtime .mjs file of the server: not tests, not generated code, not local data. */
function runtimeFiles(dir = SERVER, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['test', 'data', 'generated', 'node_modules'].includes(e.name)) runtimeFiles(p, out);
    } else if (e.name.endsWith('.mjs')) out.push(p);
  }
  return out;
}
/** The source with comments blanked out, so a comment can't trip a check. */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

// ── locale and time zone ─────────────────────────────────────────────────────

test('server code never sorts or formats in the machine’s default locale (a Linux service often runs with LANG=C)', () => {
  // Under LANG=C, ICU's default collation is en-US-POSIX: upper case before lower case, '_' last.
  // That reordered the brand lists (/api/catalog/retail brands) and made src/data/retail.json differ
  // from what the research builds, until the locale was pinned to 'en'.
  const words = ['abc', 'ABD', '_x', 'Zeta'];
  assert.notDeepEqual([...words].sort((a, b) => a.localeCompare(b, 'en-US-u-va-posix')), [...words].sort((a, b) => a.localeCompare(b, 'en')));

  const bad = [];
  for (const file of runtimeFiles()) {
    const text = code(fs.readFileSync(file, 'utf8'));
    const rel = path.relative(SERVER, file).split(path.sep).join('/');
    const checks = [
      [/\.localeCompare\(\s*[^,()]+\)/g, 'localeCompare without a locale'],
      [/\.toLocale(?:Date|Time)?String\(\s*\)/g, 'toLocale*String() without a locale'],
      [/\bnew\s+Intl\.\w+\(\s*\)|\bIntl\.\w+\(\s*\)/g, 'Intl.* without a locale'],
    ];
    for (const [re, what] of checks) for (const m of text.matchAll(re)) bad.push(`${rel}: ${what}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

test('server code reads dates in UTC only (no local-time getters, setters or constructors)', () => {
  const bad = [];
  const re = /\.(?:get|set)(?:Hours|Minutes|Seconds|Milliseconds|Date|Day|Month|FullYear|Year)\(|\.getTimezoneOffset\(|\.to(?:Date|Time)String\(|\bnew\s+Date\(\s*\d+\s*,/g;
  for (const file of runtimeFiles()) {
    const text = code(fs.readFileSync(file, 'utf8'));
    for (const m of text.matchAll(re)) bad.push(`${path.relative(SERVER, file)}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

test('billing months, allowance periods, business days and backup days come out the same in any time zone', () => {
  // Instants just either side of a UTC month end and a UTC day end, where a local-time slip shows.
  const script = `
    const { addMonths } = await import(${JSON.stringify(pathToFileURL(path.join(SERVER, 'billing', 'service.mjs')).href)});
    const { periodOf } = await import(${JSON.stringify(pathToFileURL(path.join(SERVER, 'payments', 'allowance.mjs')).href)});
    const { addBusinessDays } = await import(${JSON.stringify(pathToFileURL(path.join(SERVER, 'payments', 'tiers.mjs')).href)});
    const { utcDay } = await import(${JSON.stringify(pathToFileURL(path.join(SERVER, 'catalog', 'events.mjs')).href)});
    const at = [Date.UTC(2026, 0, 31, 23, 30), Date.UTC(2026, 1, 28, 0, 15), Date.UTC(2026, 11, 31, 23, 59, 59), Date.UTC(2026, 9, 16, 4)];
    const out = at.map((t) => [addMonths(t, 1), addMonths(t, -1), periodOf(null, t), periodOf({ periodEnd: Date.UTC(2026, 0, 31, 12) }, t), addBusinessDays(t, 3), utcDay(t)]);
    console.log(JSON.stringify({ tz: Intl.DateTimeFormat().resolvedOptions().timeZone, out }));
  `;
  const runs = ['UTC', 'Pacific/Kiritimati', 'America/St_Johns', 'America/Vancouver'].map((TZ) => {
    const r = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  });
  assert.deepEqual(
    runs.map((r) => r.tz),
    ['UTC', 'Pacific/Kiritimati', 'America/St_Johns', 'America/Vancouver'],
    'each child really ran in its time zone',
  );
  for (const r of runs.slice(1)) assert.deepEqual(r.out, runs[0].out, r.tz);
});

// ── paths ────────────────────────────────────────────────────────────────────

test('a deployed home finds its database in <home>/data on any OS, never inside app/ (which a deploy replaces)', () => {
  const home = tempDir('blumodel-home-');
  try {
    const serverDir = path.join(home, 'app', 'server');
    fs.mkdirSync(serverDir, { recursive: true });
    assert.equal(deployedHome(serverDir), home);
    assert.equal(defaultDbPath(serverDir), path.join(home, 'data', 'blumodel.db'));
    // A home from before the rename keeps its mise.db until the deploy renames it.
    fs.mkdirSync(path.join(home, 'data'));
    fs.writeFileSync(path.join(home, 'data', 'mise.db'), '');
    assert.equal(defaultDbPath(serverDir), path.join(home, 'data', 'mise.db'));
    // A checkout (or anything not under app/) keeps server/data.
    const checkout = path.join(home, 'blumodel-studio', 'server');
    assert.equal(deployedHome(checkout), null);
    assert.equal(defaultDbPath(checkout), path.join(checkout, 'data', 'blumodel.db'));
    // Linux names are case-sensitive: App/ is not app/ there. Windows ignores case, like its disk.
    assert.equal(deployedHome(path.join(home, 'App', 'server')), POSIX ? null : home);
  } finally {
    rm(home);
  }
});

test('config paths are absolute whatever directory the server starts in', () => {
  const c = loadConfig({ DB_PATH: path.join('relative', 'blumodel.db') }, []);
  assert.ok(path.isAbsolute(c.DB_PATH));
  assert.equal(c.DB_PATH, path.resolve('relative', 'blumodel.db'));
  assert.equal(c.UPLOAD_DIR, path.resolve('relative', 'uploads'));
  assert.equal(c.BACKUP_DIR, path.resolve('relative', 'backups'));
  assert.equal(loadConfig({ DB_PATH: ':memory:' }, []).DB_PATH, ':memory:');
});

test('the data scripts find the same files as the server: --home, --db, --uploads, and only path settings from the environment', () => {
  const home = path.resolve(tempDir('blumodel-sc-'));
  try {
    const a = scriptConfig({ argv: ['--home', home], env: {} });
    assert.equal(a.home, home);
    assert.equal(a.config.DB_PATH, path.join(home, 'data', 'blumodel.db'));
    assert.equal(a.config.UPLOAD_DIR, path.join(home, 'data', 'uploads'));
    assert.equal(a.config.BACKUP_DIR, path.join(home, 'data', 'backups'));
    const b = scriptConfig({ argv: ['--db', path.join(home, 'x', 'site.db'), '--port', '8913'], env: { UPLOAD_DIR: path.join(home, 'up') } });
    assert.equal(b.config.DB_PATH, path.join(home, 'x', 'site.db'));
    assert.equal(b.config.UPLOAD_DIR, path.join(home, 'up'), 'an explicit UPLOAD_DIR is kept');
    assert.equal(b.config.BACKUP_DIR, path.join(home, 'x', 'backups'));
    assert.equal(b.config.PORT, 8913);
    // Settings that have nothing to do with files can't stop a backup or a restore.
    const c = scriptConfig({ argv: ['--home', home], env: { PAYMENTS: 'stripe', PUBLIC_URL: 'not a url', RATE_LIMITS: 'off', NODE_ENV: 'production' } });
    assert.equal(c.config.paymentsProvider, 'demo');
  } finally {
    rm(home);
  }
});

test('the server never runs a child process or a Windows-only module: its whole import graph is checked', () => {
  const seen = new Set();
  const builtins = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = code(fs.readFileSync(file, 'utf8'));
    for (const m of text.matchAll(/\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith('node:')) builtins.add(spec);
      else if (spec.startsWith('.')) {
        const target = path.resolve(path.dirname(file), spec);
        if (fs.existsSync(target) && target.endsWith('.mjs')) visit(target);
      }
    }
  };
  visit(path.join(SERVER, 'index.mjs'));
  // Seeds are imported by file name at run time (server/seed/index.mjs): they're runtime code too.
  for (const f of fs.readdirSync(path.join(SERVER, 'seed'))) if (f.endsWith('.mjs')) visit(path.join(SERVER, 'seed', f));
  const files = [...seen].map((f) => path.relative(SERVER, f).split(path.sep).join('/'));
  assert.ok(files.length > 50, `${files.length} modules`);
  assert.ok(!builtins.has('node:child_process'), 'no child_process anywhere the server loads');
  assert.ok(!files.includes('ops/home.mjs'), 'the Windows home tooling (schtasks, icacls, PowerShell) is not loaded by the server');
});

// ── the server stopped? ─────────────────────────────────────────────────────

test('assertServerStopped: refuses while the port answers, or (Linux) while a process holds the database; the hint is this OS’s', async () => {
  const dir = tempDir();
  const blocker = net.createServer();
  try {
    const port = await new Promise((resolve) => blocker.listen(0, '127.0.0.1', () => resolve(/** @type {net.AddressInfo} */ (blocker.address()).port)));
    const config = { PORT: port, HOST: '127.0.0.1', DB_PATH: path.join(dir, 'blumodel.db') };
    await assert.rejects(assertServerStopped(config, { using: () => [] }), new RegExp(`Something is listening on port ${port}\\. Stop the server first \\(${SERVICE_HINTS.stop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`));
    assert.match(SERVICE_HINTS.stop, POSIX ? /systemctl stop blumodel-studio/ : /stop-server\.cmd/);
    await new Promise((r) => blocker.close(r));
    await assert.rejects(assertServerStopped(config, { using: () => [4242] }), /open in process 4242\. Stop the server first/);
    await assertServerStopped(config, { using: () => null });
  } finally {
    if (blocker.listening) blocker.close();
    rm(dir);
  }
});

test('processesUsing reads /proc on Linux (a fake /proc here) and says "can’t tell" elsewhere', () => {
  assert.equal(processesUsing(['/x'], { platform: 'win32' }), null);
  assert.equal(processesUsing(['/x'], { platform: 'darwin' }), null);
  const proc = tempDir('blumodel-proc-');
  try {
    const db = path.join(proc, 'blumodel.db');
    // /proc/<pid>/fd/<n> are symlinks to the open files; making symlinks needs privileges on
    // Windows, so the fake fd entries are plain files and readlink is answered from a table.
    const links = new Map();
    const fd = (pid, n, target) => {
      fs.mkdirSync(path.join(proc, pid, 'fd'), { recursive: true });
      fs.writeFileSync(path.join(proc, pid, 'fd', n), '');
      links.set(path.join(proc, pid, 'fd', n), target);
    };
    fd('101', '3', db);
    fd('101', '4', `${db}-wal`);
    fd('202', '3', path.join(proc, 'other.txt'));
    fd('303', '7', `${db} (deleted)`); // still open after a rename or delete: it counts
    fs.mkdirSync(path.join(proc, 'self'));
    fs.mkdirSync(path.join(proc, '404')); // another account's process: fd/ can't be listed
    const readlink = (p) => {
      if (!links.has(p)) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
      return links.get(p);
    };
    assert.deepEqual(processesUsing([db], { procDir: proc, platform: 'linux', self: 1, readlink }).sort(), [101, 303]);
    assert.deepEqual(processesUsing([db], { procDir: proc, platform: 'linux', self: 101, readlink }), [303], 'never itself');
    assert.deepEqual(processesUsing([path.join(proc, 'unrelated.db')], { procDir: proc, platform: 'linux', self: 1, readlink }), []);
    assert.equal(processesUsing([db], { procDir: path.join(proc, 'nope'), platform: 'linux' }), null);
  } finally {
    rm(proc);
  }
});

// ── backups, restore and logs on Linux ──────────────────────────────────────

test('backups and restored databases are private on Linux (folders 0700, copies 0600)', { skip: POSIX ? false : 'POSIX permissions (Windows keeps the home folder’s ACLs)' }, () => {
  const dir = tempDir();
  const old = process.umask(0o022);
  try {
    const db = new DatabaseSync(path.join(dir, 'live.db'));
    db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1);');
    const { file } = backupNow({ db, backupDir: path.join(dir, 'backups'), now: () => Date.UTC(2026, 9, 16) });
    db.close();
    assert.equal(fs.statSync(path.join(dir, 'backups')).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(dir, 'backups', 'daily')).mode & 0o777, 0o700);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const target = path.join(dir, 'restored', 'blumodel.db');
    restoreBackup({ backupFile: file, dbPath: target });
    assert.equal(fs.statSync(target).mode & 0o777, 0o600);
    const log = path.join(dir, 'logs', 'server.log');
    const target2 = { log() {}, info() {}, warn() {}, error() {} };
    const undo = installLogFile(log, { target: target2 });
    target2.info('hello');
    undo();
    assert.equal(fs.statSync(path.dirname(log)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(log).mode & 0o777, 0o600);
  } finally {
    process.umask(old);
    rm(dir);
  }
});

test('backup days are UTC days and a log rotates by plain renames, with nothing Windows-only', () => {
  const dir = tempDir();
  try {
    const db = new DatabaseSync(path.join(dir, 'live.db'));
    db.exec('CREATE TABLE t (x)');
    // 23:30 UTC on Oct 15 is already Oct 16 in Kiritimati and still Oct 15 in Vancouver: the name is the UTC day.
    const { file } = backupNow({ db, backupDir: path.join(dir, 'b'), now: () => Date.UTC(2026, 9, 15, 23, 30) });
    db.close();
    assert.equal(path.basename(file), 'blumodel-2026-10-15.db');
    const log = path.join(dir, 'x.log');
    fs.writeFileSync(log, 'x'.repeat(20));
    assert.equal(rotateLog(log, { maxBytes: 10, keep: 2 }), true);
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith('x.log')).sort(), ['x.log.1']);
  } finally {
    rm(dir);
  }
});

test('restore CLI: --home works with any folder, and its messages name this OS’s stop and start commands', () => {
  const home = tempDir('blumodel-rh-');
  try {
    const run = (args) => spawnSync(process.execPath, ['--no-warnings', path.join(SERVER, 'scripts', 'restore.mjs'), ...args], { env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot ?? '' }, encoding: 'utf8', windowsHide: true });
    const list = run(['--home', home, '--list']);
    assert.equal(list.status, 0, list.stderr);
    assert.ok(list.stdout.includes(path.join(home, 'data', 'backups', 'daily')), list.stdout);
    assert.ok(list.stdout.includes(SERVICE_HINTS.stop), list.stdout);
    const none = run(['--home', home, '--latest']);
    assert.equal(none.status, 2);
    assert.match(none.stderr, /no daily backups/);
  } finally {
    rm(home);
  }
});
