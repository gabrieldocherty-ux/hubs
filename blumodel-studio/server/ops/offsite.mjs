// Encrypted off-site backups (docs/OPERATIONS.md and docs/HOSTING.md, "Off-site backups").
//
// Once a day, after the local backup (server/ops/backup.mjs runDailyBackup), the server writes
//
//   <BACKUP_OFFSITE_DIR>/blumodel-offsite-<time>.tar.enc
//
// a data bundle (server/ops/dataBundle.mjs: a consistent copy of the database, every upload and a
// manifest with a sha256 for each) encrypted as it is written with AES-256-GCM under a key made by
// scrypt from BACKUP_PASSPHRASE (server/ops/crypt.mjs). No plain copy is ever written to
// BACKUP_OFFSITE_DIR: it is meant to be a folder a cloud drive syncs (OneDrive, Google Drive,
// Dropbox) or a mounted USB drive. Each copy is read back in full before it counts; then the
// newest BACKUP_OFFSITE_KEEP (30) are kept, any copy older than OFFSITE_MAX_DAYS (35) goes, and
// every copy kept has its sealed header decrypted to prove it still opens with the passphrase.
//
// The heavy part (tar, encrypt, read back) runs in a worker thread so the server keeps answering.
// The result goes to <BACKUP_DIR>/offsite-status.json, which Admin > System shows
// (GET /api/admin/system -> backups.offsite, offsiteStatus() below).
//
// Never fatal: a missing folder (a USB drive unplugged, the cloud client not signed in), a missing
// or short passphrase, a full disk: the job logs a warning, records the problem in the status and
// tries again the next hour. It never creates BACKUP_OFFSITE_DIR (an unplugged drive's mount point
// would fill the machine's own disk instead) and never writes anything unencrypted.
//
// Restore: node server/scripts/restore-offsite.mjs <file> (decrypts to a temp file, then the
// usual restore).

import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { exportData, stampOf } from './dataBundle.mjs';
import { passphraseProblem, readEncryptedHeader } from './crypt.mjs';
import { privateDir, privateFile } from './backup.mjs';

export const OFFSITE_RE = /^blumodel-offsite-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.tar\.enc$/;
const PART_RE = /^blumodel-offsite-.*\.part$/;
export const OFFSITE_MAX_DAYS = 35;
const DAY = 86_400_000;
/** No success for this long: Admin > System says the off-site backups are behind. */
export const OFFSITE_STALE_MS = 48 * 3_600_000;
export const STATUS_FILE = 'offsite-status.json';

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const timeOf = (m) => Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);

/** The off-site copies in `dir`, newest first: `[{ file, name, at, bytes }]`. */
export function listOffsite(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => ({ name, m: OFFSITE_RE.exec(name) }))
    .filter((x) => x.m)
    .map((x) => {
      const file = path.join(dir, x.name);
      let bytes = null;
      try {
        bytes = fs.statSync(file).size;
      } catch {
        bytes = null;
      }
      return { file, name: x.name, at: timeOf(x.m), bytes };
    })
    .sort((a, b) => b.at - a.at);
}

/**
 * Keeps the newest `keep` copies, none older than `maxDays` (but never `newest`, the one just
 * written), and removes .part files an interrupted run left more than a day ago. Returns the
 * paths removed.
 */
export function pruneOffsite(dir, { keep = 30, maxDays = OFFSITE_MAX_DAYS, now = Date.now, newest = null } = {}) {
  const removed = [];
  const t = now();
  listOffsite(dir).forEach((c, i) => {
    if (newest && path.resolve(c.file) === path.resolve(newest)) return;
    if (i >= keep || t - c.at > maxDays * DAY) {
      fs.rmSync(c.file, { force: true });
      removed.push(c.file);
    }
  });
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    names = [];
  }
  for (const n of names) {
    if (!PART_RE.test(n)) continue;
    const p = path.join(dir, n);
    try {
      if (t - fs.statSync(p).mtimeMs > DAY) {
        fs.rmSync(p, { force: true });
        removed.push(p);
      }
    } catch {
      /* gone */
    }
  }
  return removed;
}

/** Why the off-site backup can't run as configured, or null. Never names the passphrase. */
export function offsiteProblem(config) {
  if (!config.BACKUP_OFFSITE_DIR) return null;
  const p = passphraseProblem(config.BACKUP_PASSPHRASE);
  if (p) return `${p}, so nothing is copied off this machine (an off-site copy is never written unencrypted)`;
  let st;
  try {
    st = fs.statSync(config.BACKUP_OFFSITE_DIR);
  } catch {
    return `the folder ${config.BACKUP_OFFSITE_DIR} doesn't exist (is the drive plugged in, or the cloud drive signed in?)`;
  }
  if (!st.isDirectory()) return `${config.BACKUP_OFFSITE_DIR} is not a folder`;
  return null;
}

function readStatus(backupDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(backupDir, STATUS_FILE), 'utf8'));
  } catch {
    return {};
  }
}

function writeStatus(backupDir, status) {
  privateDir(backupDir);
  const file = path.join(backupDir, STATUS_FILE);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(status, null, 1)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  privateFile(file);
}

/**
 * One off-site backup, now, synchronously (the worker and the tests call this). Skipped when
 * today's copy is already there, unless `force`. Never throws: returns
 * `{ ok, skipped?, file?, bytes?, removed?, verified?, error? }` and records it in the status file.
 * @param {{ config: any, now?: () => number, force?: boolean }} o
 */
export function offsiteBackupNow({ config, now = Date.now, force = false }) {
  const t = now();
  const prev = readStatus(config.BACKUP_DIR);
  const status = { ...prev, dir: config.BACKUP_OFFSITE_DIR, keep: config.BACKUP_OFFSITE_KEEP, lastAttemptAt: t };
  const fail = (error) => {
    status.lastError = error;
    status.lastErrorAt = t;
    try {
      writeStatus(config.BACKUP_DIR, status);
    } catch {
      /* the status is a convenience; the warning is logged by the caller */
    }
    return { ok: false, error };
  };
  if (!config.BACKUP_OFFSITE_DIR) return { ok: false, skipped: true, error: null };
  const problem = offsiteProblem(config);
  if (problem) return fail(problem);
  if (!force && prev.lastSuccessAt && dayOf(prev.lastSuccessAt) === dayOf(t) && prev.dir === config.BACKUP_OFFSITE_DIR) {
    const there = listOffsite(config.BACKUP_OFFSITE_DIR).some((c) => dayOf(c.at) === dayOf(t));
    if (there) return { ok: true, skipped: true };
  }
  try {
    const target = path.join(config.BACKUP_OFFSITE_DIR, `blumodel-offsite-${stampOf(t)}.tar.enc`);
    const r = exportData({
      config: { DB_PATH: config.DB_PATH, UPLOAD_DIR: config.UPLOAD_DIR, BACKUP_DIR: config.BACKUP_DIR },
      out: target,
      passphrase: config.BACKUP_PASSPHRASE,
      kind: 'offsite',
      now: () => t,
    });
    const removed = pruneOffsite(config.BACKUP_OFFSITE_DIR, { keep: config.BACKUP_OFFSITE_KEEP, now: () => t, newest: r.bundle });
    // Every copy kept must still open with today's passphrase (its sealed header decrypts).
    const kept = listOffsite(config.BACKUP_OFFSITE_DIR);
    const unreadable = [];
    for (const c of kept) {
      try {
        readEncryptedHeader(c.file, config.BACKUP_PASSPHRASE);
      } catch (err) {
        unreadable.push(`${c.name} (${err.code === 'bad_passphrase' ? 'made with another passphrase, or damaged' : 'damaged'})`);
      }
    }
    Object.assign(status, {
      lastSuccessAt: t,
      lastFile: path.basename(r.bundle),
      lastBytes: r.bytes,
      copies: kept.length,
      oldestAt: kept.at(-1)?.at ?? null,
      verifiedAt: t,
      unreadable,
      lastError: unreadable.length ? `${unreadable.length} older copy(ies) no longer open with BACKUP_PASSPHRASE: ${unreadable.slice(0, 3).join(', ')}` : null,
    });
    if (!unreadable.length) delete status.lastErrorAt;
    writeStatus(config.BACKUP_DIR, status);
    return { ok: true, file: r.bundle, bytes: r.bytes, removed, verified: kept.length - unreadable.length, unreadable };
  } catch (err) {
    return fail(String(err?.message ?? err).slice(0, 300));
  }
}

/**
 * The off-site backups for Admin > System (GET /api/admin/system, backups.offsite). Never the
 * passphrase, only whether one is set and usable.
 *   { configured, dir, keep, passphraseSet, problem, lastSuccessAt, lastAttemptAt, lastFile,
 *     lastBytes, copies, oldestAt, verifiedAt, lastError, stale }
 */
export function offsiteStatus(config, { now = Date.now } = {}) {
  const configured = !!config.BACKUP_OFFSITE_DIR;
  const s = configured ? readStatus(config.BACKUP_DIR) : {};
  const sameDir = s.dir === config.BACKUP_OFFSITE_DIR;
  const lastSuccessAt = sameDir ? (s.lastSuccessAt ?? null) : null;
  return {
    configured,
    dir: configured ? config.BACKUP_OFFSITE_DIR : null,
    keep: config.BACKUP_OFFSITE_KEEP ?? 30,
    passphraseSet: !!config.BACKUP_PASSPHRASE,
    problem: configured ? offsiteProblem(config) : null,
    lastSuccessAt,
    lastAttemptAt: sameDir ? (s.lastAttemptAt ?? null) : null,
    lastFile: sameDir ? (s.lastFile ?? null) : null,
    lastBytes: sameDir ? (s.lastBytes ?? null) : null,
    copies: sameDir ? (s.copies ?? null) : null,
    oldestAt: sameDir ? (s.oldestAt ?? null) : null,
    verifiedAt: sameDir ? (s.verifiedAt ?? null) : null,
    lastError: sameDir ? (s.lastError ?? null) : null,
    stale: configured && (!lastSuccessAt || now() - lastSuccessAt > OFFSITE_STALE_MS),
  };
}

let running = null;

/**
 * Starts today's off-site backup in a worker thread unless one is running or it's done for
 * today. Logs one line when it finishes (a warning when it failed). Returns the promise of the
 * worker's result, or null when nothing was started.
 */
export function startOffsiteBackup({ config, log = console }) {
  if (!config.BACKUP_OFFSITE_DIR || running) return null;
  const problem = offsiteProblem(config);
  if (problem) {
    const prev = readStatus(config.BACKUP_DIR);
    // Warn once an hour at most (the job is tried hourly) and record it for Admin > System.
    offsiteBackupNow({ config });
    if (!prev.lastErrorAt || Date.now() - prev.lastErrorAt > 3_000_000) log.warn?.(`Off-site backup not made: ${problem}.`);
    return null;
  }
  const prev = readStatus(config.BACKUP_DIR);
  if (prev.lastSuccessAt && dayOf(prev.lastSuccessAt) === dayOf(Date.now()) && prev.dir === config.BACKUP_OFFSITE_DIR) return null;
  const workerData = {
    config: {
      DB_PATH: config.DB_PATH,
      UPLOAD_DIR: config.UPLOAD_DIR,
      BACKUP_DIR: config.BACKUP_DIR,
      BACKUP_OFFSITE_DIR: config.BACKUP_OFFSITE_DIR,
      BACKUP_OFFSITE_KEEP: config.BACKUP_OFFSITE_KEEP,
      BACKUP_PASSPHRASE: config.BACKUP_PASSPHRASE,
    },
  };
  running = new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL('./offsiteWorker.mjs', import.meta.url), { workerData });
    } catch (err) {
      log.warn?.(`Off-site backup not made: the worker didn't start (${err?.message ?? err}).`);
      resolve({ ok: false, error: 'worker' });
      return;
    }
    worker.unref();
    let result = null;
    worker.once('message', (m) => (result = m));
    worker.once('error', (err) => (result = { ok: false, error: String(err?.message ?? err).slice(0, 300) }));
    worker.once('exit', () => {
      const r = result ?? { ok: false, error: 'the worker stopped before it finished' };
      if (r.ok && !r.skipped) log.info?.(`Off-site backup: wrote ${r.file} (${(r.bytes / 1024 / 1024).toFixed(1)} MB, encrypted); ${r.verified} cop${r.verified === 1 ? 'y' : 'ies'} verified, ${r.removed?.length ?? 0} removed.`);
      else if (!r.ok) log.warn?.(`Off-site backup failed: ${r.error}`);
      resolve(r);
    });
  }).finally(() => {
    running = null;
  });
  return running;
}
