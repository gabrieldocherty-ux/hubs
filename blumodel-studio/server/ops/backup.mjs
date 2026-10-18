// Backups the server makes for itself (docs/OPERATIONS.md, "Backups and restore"):
//
//   <BACKUP_DIR>/daily/blumodel-YYYY-MM-DD.db   one consistent copy a day (VACUUM INTO), the newest
//                                               BACKUP_KEEP (14) kept
//   <BACKUP_DIR>/uploads-mirror/                a mirror of the uploads folder, refreshed after each
//                                               daily backup (blobs are content-addressed, so a
//                                               file is copied once; a file deleted from uploads
//                                               leaves the mirror too, so a deleted account's
//                                               photos don't linger here)
//
// BACKUP_DIR defaults to <folder of the database>/backups. The deploy's own pre-deploy copies sit
// beside these as <BACKUP_DIR>/<timestamp>/ (scripts/deploy-local.mjs). Days are UTC days, on any
// machine in any time zone.
//
// Every copy ages out on a schedule (the privacy policy promises deleted data leaves every backup
// within 35 days; docs/OPERATIONS.md, "How long each copy is kept"):
//
//   daily/                          the newest BACKUP_KEEP (14, at most 30)
//   uploads-mirror/                 a file deleted from uploads leaves the mirror the same day
//   <BACKUP_DIR>/<timestamp>/       pre-deploy copies: the last 5 deploys, none older than 30 days
//   <db>.before-restore-<time>      30 days after it was made (also -wal, -shm)
//   <db>.before-import-<time>,      30 days after it was made (import-data --replace keeps these)
//   <uploads>.before-import-<time>, and the .failed-import-<time> copies
//   exports/                        export bundles: 7 days
//   off-site copies                 the newest BACKUP_OFFSITE_KEEP (30), none older than 35 days
//                                   (server/ops/offsite.mjs)
//
// pruneAged() does the age rules; the daily job runs it every hour.
//
// On Linux the folders this makes are 0700 and the database copies 0600: they hold every account's
// data, and on a shared machine the default umask would let any local account read them. Windows
// keeps the ACLs the folder inherits from the home (your account's profile).
//
// restoreBackup() puts a backup back (the server must be stopped: server/scripts/restore.mjs
// refuses while something listens on the port, or, on Linux, while any process has the database
// open). The database being replaced is kept beside it as <name>.before-restore-<time>, for 30
// days.
//
// The data scripts (restore, export-data, import-data) share scriptConfig() and
// assertServerStopped() below, so all three find the same files the same way on either OS.

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SERVER_DIR, loadConfig } from '../config.mjs';
import { deployedHome, parseEnvFile, resolveEnvFile } from '../lib/envFile.mjs';
import { homePort } from './homePort.mjs';

const POSIX = process.platform !== 'win32';

/** mkdir -p, private to this account on Linux (0700; a folder that already exists is left as is). */
export function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** chmod 600 on Linux (a copy of the database, a data bundle). A no-op on Windows. Never throws. */
export function privateFile(file) {
  if (!POSIX) return;
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* not ours to change: left as is */
  }
}

const DAILY_RE = /^blumodel-(\d{4}-\d{2}-\d{2})\.db$/;
const DAY = 86_400_000;
/** Pre-deploy copies and the before-restore / before-import copies: deleted this long after they were made. */
export const AGED_KEEP_DAYS = 30;
/** Export bundles in <BACKUP_DIR>/exports. */
export const EXPORT_KEEP_DAYS = 7;
const DEPLOY_DIR_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-\d{3}Z$/;
const KEPT_COPY_RE = /\.(?:before-restore|before-import|failed-import)-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-\d{3})?Z(?:-wal|-shm)?$/;
const EXPORT_NAME_RE = /^\.?blumodel-data-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/;
const stampMs = (m) => Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);

/** `PRAGMA integrity_check` → `{ ok, problems }` (at most 5 problem lines). */
export function integrityCheck(db) {
  try {
    const rows = db.prepare('PRAGMA integrity_check').all();
    const lines = rows.map((r) => String(Object.values(r)[0]));
    const ok = lines.length === 1 && lines[0] === 'ok';
    return { ok, problems: ok ? [] : lines.slice(0, 5) };
  } catch (err) {
    return { ok: false, problems: [String(err?.message ?? err).slice(0, 200)] };
  }
}

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The daily backups in `dir`, newest first: `[{ file, day }]`. */
export function listDaily(backupDir) {
  const dir = path.join(backupDir, 'daily');
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((n) => ({ name: n, m: DAILY_RE.exec(n) }))
    .filter((x) => x.m)
    .sort((a, b) => (a.m[1] < b.m[1] ? 1 : -1))
    .map((x) => ({ file: path.join(dir, x.name), day: x.m[1] }));
}

/** Deletes all but the newest `keep` daily backups. Returns the files removed. */
export function pruneDaily(backupDir, keep) {
  const removed = [];
  for (const b of listDaily(backupDir).slice(keep)) {
    fs.rmSync(b.file, { force: true });
    removed.push(b.file);
  }
  return removed;
}

/** Deletes the entries of `dir` matching `re` whose time (from the name) is more than `days` ago. */
function pruneByName(dir, re, days, now, { only = () => true, keep = null } = {}) {
  const removed = [];
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  for (const n of names) {
    if (!only(n)) continue;
    const m = re.exec(n);
    if (!m) continue;
    const at = stampMs(m);
    const p = path.join(dir, n);
    if (!Number.isFinite(at) || now - at <= days * DAY || (keep && path.resolve(p) === path.resolve(keep))) continue;
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    removed.push(p);
  }
  return removed;
}

/**
 * Deletes the export bundles in `dir` (<BACKUP_DIR>/exports) made more than `days` ago, by the
 * time in their name (blumodel-data-<time>[.tar[.enc]], and the .part files and work folders an
 * export that crashed left behind). Never `keep`. Returns the paths removed.
 */
export function pruneExports(dir, { now = Date.now, days = EXPORT_KEEP_DAYS, keep = null } = {}) {
  return pruneByName(dir, EXPORT_NAME_RE, days, now(), { keep });
}

/**
 * The age rules (see the top of this file): pre-deploy copies, before-restore / before-import /
 * failed-import copies of the database and the uploads, export bundles, and leftovers of an
 * interrupted export. Returns the paths removed.
 * @param {{ config: { DB_PATH: string, UPLOAD_DIR: string, BACKUP_DIR: string }, now?: () => number }} o
 */
export function pruneAged({ config, now = Date.now }) {
  const t = now();
  const removed = [];
  removed.push(...pruneByName(config.BACKUP_DIR, DEPLOY_DIR_RE, AGED_KEEP_DAYS, t));
  if (config.DB_PATH && config.DB_PATH !== ':memory:') {
    const db = path.resolve(config.DB_PATH);
    const base = `${path.basename(db)}.`;
    removed.push(...pruneByName(path.dirname(db), KEPT_COPY_RE, AGED_KEEP_DAYS, t, { only: (n) => n.startsWith(base) }));
  }
  if (config.UPLOAD_DIR) {
    const up = path.resolve(config.UPLOAD_DIR);
    const base = `${path.basename(up)}.`;
    removed.push(...pruneByName(path.dirname(up), KEPT_COPY_RE, AGED_KEEP_DAYS, t, { only: (n) => n.startsWith(base) }));
  }
  removed.push(...pruneExports(path.join(config.BACKUP_DIR, 'exports'), { now: () => t }));
  removed.push(...pruneByName(path.join(config.BACKUP_DIR, '.work'), EXPORT_NAME_RE, 1, t));
  return removed;
}

/**
 * Today's backup, unless it already exists: VACUUM INTO a temp name, check it, then rename into
 * place, so a half-written file never looks like a backup. Returns `{ file, made }`.
 */
export function backupNow({ db, backupDir, now = Date.now, keep = 14 }) {
  const dir = privateDir(path.join(backupDir, 'daily'));
  const file = path.join(dir, `blumodel-${dayOf(now())}.db`);
  if (fs.existsSync(file)) return { file, made: false };
  const tmp = `${file}.part`;
  fs.rmSync(tmp, { force: true });
  db.prepare('VACUUM INTO ?').run(tmp);
  privateFile(tmp);
  const check = new DatabaseSync(tmp);
  try {
    const r = integrityCheck(check);
    if (!r.ok) throw new Error(`the backup copy failed its integrity check (${r.problems.join('; ')})`);
  } finally {
    check.close();
  }
  fs.renameSync(tmp, file);
  pruneDaily(backupDir, keep);
  return { file, made: true };
}

/** Every file under `root` as relative paths (skipping `skip` top-level folders). */
function walk(root, skip = new Set()) {
  const out = [];
  const go = (rel) => {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? path.join(rel, e.name) : e.name;
      if (!rel && skip.has(e.name)) continue;
      if (e.isDirectory()) go(r);
      else if (e.isFile()) out.push(r);
    }
  };
  go('');
  return out;
}

/**
 * Makes `mirrorDir` a copy of `uploadDir` (without its tmp/ folder): copies what is new or a
 * different size, deletes what is gone. Returns `{ copied, removed }`.
 */
export function mirrorUploads({ uploadDir, mirrorDir }) {
  const src = new Set(walk(uploadDir, new Set(['tmp'])));
  let copied = 0;
  let removed = 0;
  for (const rel of src) {
    const from = path.join(uploadDir, rel);
    const to = path.join(mirrorDir, rel);
    let same = false;
    try {
      same = fs.statSync(to).size === fs.statSync(from).size;
    } catch {
      same = false;
    }
    if (same) continue;
    privateDir(path.dirname(to));
    fs.copyFileSync(from, to);
    copied++;
  }
  for (const rel of walk(mirrorDir)) {
    if (!src.has(rel)) {
      fs.rmSync(path.join(mirrorDir, rel), { force: true });
      removed++;
    }
  }
  return { copied, removed };
}

/**
 * Copies files back from the mirror into `uploadDir` where they are missing (never overwrites).
 * Returns how many were restored.
 */
export function restoreUploads({ mirrorDir, uploadDir }) {
  let restored = 0;
  for (const rel of walk(mirrorDir)) {
    const to = path.join(uploadDir, rel);
    if (fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(mirrorDir, rel), to);
    restored++;
  }
  return restored;
}

/**
 * Puts `backupFile` back as the database at `dbPath`. The server must not be running. The backup
 * is integrity-checked first; the current database (and its -wal/-shm) is renamed to
 * `<dbPath>.before-restore-<stamp>` rather than deleted. Returns `{ restored, keptAs }`.
 */
export function restoreBackup({ backupFile, dbPath, now = Date.now }) {
  if (!fs.existsSync(backupFile)) throw new Error(`No backup at ${backupFile}.`);
  const probe = new DatabaseSync(backupFile);
  try {
    const r = integrityCheck(probe);
    if (!r.ok) throw new Error(`That backup failed its integrity check (${r.problems.join('; ')}); not restoring it.`);
  } finally {
    probe.close();
  }
  const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
  const keptAs = fs.existsSync(dbPath) ? `${dbPath}.before-restore-${stamp}` : null;
  if (keptAs) {
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(dbPath + ext)) fs.renameSync(dbPath + ext, keptAs + ext);
  } else {
    for (const ext of ['-wal', '-shm']) fs.rmSync(dbPath + ext, { force: true });
  }
  privateDir(path.dirname(dbPath));
  fs.copyFileSync(backupFile, dbPath);
  privateFile(dbPath);
  return { restored: dbPath, keptAs };
}

/** Starts the encrypted off-site copy (server/ops/offsite.mjs), loaded only when it is set up. */
function defaultOffsite({ config, log }) {
  if (!config.BACKUP_OFFSITE_DIR) return;
  import('./offsite.mjs')
    .then((m) => m.startOffsiteBackup({ config, log }))
    .catch((err) => log.warn?.(`Off-site backup not made: ${err?.message ?? err}`));
}

/**
 * The daily job: today's backup (when there isn't one yet), the uploads mirror, the age rules
 * (pruneAged), then the encrypted off-site copy when BACKUP_OFFSITE_DIR is set (in a worker; it
 * does nothing once today's is made). Logs one line; never throws (a failed backup must not take
 * the server down). `paused()` skips it, e.g. while the database failed its startup integrity
 * check, so good backups (local and off-site) aren't rotated out by bad ones.
 */
export function runDailyBackup({ db, config, now = Date.now, log = console, paused = () => false, offsite = defaultOffsite }) {
  if (config.BACKUPS === 'off') return null;
  if (paused()) {
    log.warn?.('Backup skipped: the database failed its integrity check at startup (see above).');
    return null;
  }
  let result;
  try {
    const out = backupNow({ db, backupDir: config.BACKUP_DIR, now, keep: config.BACKUP_KEEP });
    const m = mirrorUploads({ uploadDir: config.UPLOAD_DIR, mirrorDir: path.join(config.BACKUP_DIR, 'uploads-mirror') });
    if (out.made || m.copied || m.removed) log.info?.(`Backup: ${out.made ? `wrote ${out.file}` : 'today’s database copy already exists'}; uploads mirror +${m.copied} -${m.removed}.`);
    result = { ...out, mirror: m, aged: [] };
  } catch (err) {
    log.error?.(`Backup failed: ${err?.message ?? err}`);
    return null;
  }
  try {
    result.aged = pruneAged({ config, now });
    if (result.aged.length) log.info?.(`Backup: removed ${result.aged.length} copy(ies) past their keep period: ${result.aged.map((p) => path.basename(p)).join(', ')}.`);
  } catch (err) {
    log.warn?.(`Backup: removing old copies failed: ${err?.message ?? err}`);
  }
  try {
    offsite?.({ config, log });
  } catch (err) {
    log.warn?.(`Off-site backup not made: ${err?.message ?? err}`);
  }
  return result;
}

/** Runs the daily job now and then every hour (it does nothing until the day changes). */
export function scheduleBackups(opts) {
  runDailyBackup(opts);
  const timer = setInterval(() => runDailyBackup(opts), Math.min(DAY, 3_600_000));
  timer.unref?.();
  return timer;
}

// ── what the data scripts share ──────────────────────────────────────────────

/** The only settings the data scripts take from the environment: where the files are, and the port. */
const SCRIPT_KEYS = ['DB_PATH', 'UPLOAD_DIR', 'BACKUP_DIR', 'BACKUP_KEEP', 'PORT', 'HOST'];

/**
 * The paths a data script works on, found the way the server finds them (server/config.mjs), from
 *   --home <dir>      a home folder: <dir>/data/blumodel.db, <dir>/data/uploads, <dir>/data/backups
 *   --db <file>       the database (its uploads/ and backups/ beside it unless set)
 *   --uploads <dir>   the uploads folder
 *   --port <n>        the server's port, for "is it running?"
 * then DB_PATH, UPLOAD_DIR, BACKUP_DIR, PORT and HOST from the environment, then the defaults
 * (a deployed home's data/ when the script runs from <home>/app/server/scripts). With no --port and
 * no PORT, the port is the one the home (--home, or the one the script runs from) was installed
 * with (server/ops/homePort.mjs: its run-server.cmd, or the systemd unit), else 8790. Nothing else is
 * read from the environment, so an unrelated setting can't stop a backup, and no key is ever seen.
 * Returns `{ config, home }` (`home` is --home, resolved, or null).
 * @param {{ argv?: string[], env?: Record<string, string | undefined>, serverDir?: string, portOf?: (home: string) => number | null }} [o]
 */
export function scriptConfig({ argv = [], env = process.env, serverDir = SERVER_DIR, portOf = homePort } = {}) {
  const opt = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
  };
  /** @type {Record<string, string>} */
  const e = {};
  for (const k of SCRIPT_KEYS) if (env[k]) e[k] = String(env[k]);
  const home = opt('--home') ? path.resolve(opt('--home')) : null;
  if (home) {
    e.DB_PATH = path.join(home, 'data', 'blumodel.db');
    e.UPLOAD_DIR = path.join(home, 'data', 'uploads');
    e.BACKUP_DIR = path.join(home, 'data', 'backups');
  }
  if (opt('--db')) {
    e.DB_PATH = path.resolve(opt('--db'));
    if (!home && !env.UPLOAD_DIR) delete e.UPLOAD_DIR;
    if (!home && !env.BACKUP_DIR) delete e.BACKUP_DIR;
  }
  if (opt('--uploads')) e.UPLOAD_DIR = path.resolve(opt('--uploads'));
  if (opt('--port')) e.PORT = opt('--port');
  if (!e.PORT) {
    const portHome = home ?? (e.DB_PATH ? null : deployedHome(serverDir));
    const p = portHome ? portOf(portHome) : null;
    if (p) e.PORT = String(p);
  }
  return { config: loadConfig(e, []), home };
}

/** Reads a line from the terminal without echoing it (the passphrase prompt). */
function askHidden(question, { input = process.stdin, output = process.stderr } = {}) {
  return new Promise((resolve) => {
    output.write(question);
    let s = '';
    const done = (v) => {
      input.removeListener('data', onData);
      try {
        input.setRawMode?.(false);
      } catch {
        /* not a terminal */
      }
      input.pause();
      output.write('\n');
      resolve(v);
    };
    const onData = (buf) => {
      for (const ch of buf.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return done(s);
        if (ch === '\u0003' || ch === '\u0004') return done(null);
        if (ch === '\u007f' || ch === '\b') s = s.slice(0, -1);
        else s += ch;
      }
    };
    input.setRawMode?.(true);
    input.resume();
    input.on('data', onData);
  });
}

/**
 * BACKUP_PASSPHRASE for a data script (export-data, import-data, restore-offsite), from the first
 * of: --passphrase-file <file> (its first line), BACKUP_PASSPHRASE in the environment, the
 * settings file this home uses (blumodel.env: only that one key is read), or a prompt when run in
 * a terminal. Returns `{ passphrase, source }` or null. The value is never printed.
 * @param {{ argv?: string[], env?: Record<string, string | undefined>, home?: string | null, serverDir?: string, prompt?: boolean }} [o]
 */
export async function scriptPassphrase({ argv = [], env = process.env, home = null, serverDir = SERVER_DIR, prompt = true } = {}) {
  const i = argv.indexOf('--passphrase-file');
  if (i >= 0) {
    const file = argv[i + 1];
    if (!file || file.startsWith('--')) throw new Error('--passphrase-file needs a file name.');
    let text;
    try {
      text = fs.readFileSync(path.resolve(file), 'utf8');
    } catch (err) {
      throw new Error(`Can't read the passphrase file ${path.resolve(file)} (${err?.code || 'error'}).`);
    }
    return { passphrase: text.replace(/^﻿/, '').split(/\r?\n/)[0], source: '--passphrase-file' };
  }
  if (env.BACKUP_PASSPHRASE) return { passphrase: String(env.BACKUP_PASSPHRASE), source: 'BACKUP_PASSPHRASE' };
  const settings = resolveEnvFile(env, { serverDir })?.file ?? (home && fs.existsSync(path.join(home, 'blumodel.env')) ? path.join(home, 'blumodel.env') : null);
  if (settings) {
    try {
      const v = parseEnvFile(fs.readFileSync(settings, 'utf8')).values.BACKUP_PASSPHRASE;
      if (v) return { passphrase: v, source: settings };
    } catch {
      /* unreadable (run as another account): fall through to the prompt */
    }
  }
  if (prompt && process.stdin.isTTY) {
    const v = await askHidden('BACKUP_PASSPHRASE (not shown): ');
    if (v) return { passphrase: v, source: 'prompt' };
  }
  return null;
}

/** Is something accepting connections on host:port? Resolves true / false, never rejects. */
export function portOpen(port, host = '127.0.0.1', timeoutMs = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(timeoutMs, () => done(false));
  });
}

/**
 * The address the server's port answers on, if it does ('127.0.0.1', or HOST), else null. Checks
 * 127.0.0.1 and, when HOST is a specific address (a LAN address on the Wyse, say), that one too.
 * @param {{ PORT: number, HOST: string }} config
 */
export async function serverListening(config) {
  const hosts = new Set(['127.0.0.1']);
  const h = String(config.HOST || '').replace(/^\[|\]$/g, '');
  if (h === '::') hosts.add('::1');
  else if (h && h !== '0.0.0.0' && h !== 'localhost') hosts.add(h);
  for (const host of hosts) if (await portOpen(config.PORT, host)) return host;
  return null;
}

/**
 * The processes (pids) that have any of `files` open, from /proc: Linux only, where nothing stops
 * a script from replacing a database a running server still has open (Windows refuses the rename,
 * so it needs no such check). Returns null where it can't tell (not Linux, no /proc). A process
 * of another account is only visible to that account or root, so run the scripts as the server's
 * account (sudo -u blumodel ...) or with sudo.
 * @param {string[]} files
 * @param {{ procDir?: string, platform?: string, self?: number, readlink?: (p: string) => string }} [o]
 */
export function processesUsing(files, { procDir = '/proc', platform = process.platform, self = process.pid, readlink = fs.readlinkSync } = {}) {
  if (platform !== 'linux') return null;
  const wanted = new Set(files.map((f) => path.resolve(f)));
  let pids;
  try {
    pids = fs.readdirSync(procDir).filter((n) => /^\d+$/.test(n));
  } catch {
    return null;
  }
  const out = [];
  for (const pid of pids) {
    if (Number(pid) === self) continue;
    let fds = [];
    try {
      fds = fs.readdirSync(path.join(procDir, pid, 'fd'));
    } catch {
      continue; // gone, or another account's process
    }
    for (const fd of fds) {
      let target = '';
      try {
        target = readlink(path.join(procDir, pid, 'fd', fd));
      } catch {
        continue;
      }
      if (wanted.has(target.replace(/ \(deleted\)$/, ''))) {
        out.push(Number(pid));
        break;
      }
    }
  }
  return out;
}

/** How to stop and start the server on this OS, for the scripts' messages (docs/HOSTING.md). */
export const SERVICE_HINTS =
  process.platform === 'win32'
    ? { stop: 'stop-server.cmd in the home folder', start: 'start-server.cmd in the home folder' }
    : { stop: 'sudo systemctl stop blumodel-studio', start: 'sudo systemctl start blumodel-studio' };

/**
 * Throws (with what to do) unless the server is stopped: nothing answers on its port and, on
 * Linux, no process has the database or its -wal/-shm open.
 * @param {{ PORT: number, HOST: string, DB_PATH: string }} config
 * @param {{ using?: typeof processesUsing }} [o]
 */
export async function assertServerStopped(config, { using = processesUsing } = {}) {
  const at = await serverListening(config);
  if (at) throw new Error(`Something is listening on port ${config.PORT}${at === '127.0.0.1' ? '' : ` (${at})`}. Stop the server first (${SERVICE_HINTS.stop}), then run this again.`);
  const pids = using([config.DB_PATH, `${config.DB_PATH}-wal`, `${config.DB_PATH}-shm`]);
  if (pids?.length) throw new Error(`The database ${config.DB_PATH} is open in process ${pids.join(', ')}. Stop the server first (${SERVICE_HINTS.stop}), then run this again.`);
}
