// Backups the server makes for itself (docs/OPERATIONS.md, "Backups and restore"):
//
//   <BACKUP_DIR>\daily\blumodel-YYYY-MM-DD.db   one consistent copy a day (VACUUM INTO), the newest
//                                               BACKUP_KEEP (14) kept
//   <BACKUP_DIR>\uploads-mirror\                a mirror of the uploads folder, refreshed after each
//                                               daily backup (blobs are content-addressed, so a
//                                               file is copied once; a file deleted from uploads
//                                               leaves the mirror too, so a deleted account's
//                                               photos don't linger here)
//
// BACKUP_DIR defaults to <folder of the database>\backups. The deploy's own pre-deploy copies sit
// beside these as <BACKUP_DIR>\<timestamp>\ (scripts/deploy-local.mjs).
//
// restoreBackup() puts a backup back (the server must be stopped: server/scripts/restore.mjs
// refuses while something listens on the port). The database being replaced is kept beside it as
// <name>.before-restore-<time>, never deleted.

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DAILY_RE = /^blumodel-(\d{4}-\d{2}-\d{2})\.db$/;
const DAY = 86_400_000;

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

/**
 * Today's backup, unless it already exists: VACUUM INTO a temp name, check it, then rename into
 * place, so a half-written file never looks like a backup. Returns `{ file, made }`.
 */
export function backupNow({ db, backupDir, now = Date.now, keep = 14 }) {
  const dir = path.join(backupDir, 'daily');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `blumodel-${dayOf(now())}.db`);
  if (fs.existsSync(file)) return { file, made: false };
  const tmp = `${file}.part`;
  fs.rmSync(tmp, { force: true });
  db.prepare('VACUUM INTO ?').run(tmp);
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
 * Makes `mirrorDir` a copy of `uploadDir` (without its tmp\ folder): copies what is new or a
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
    fs.mkdirSync(path.dirname(to), { recursive: true });
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
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.copyFileSync(backupFile, dbPath);
  return { restored: dbPath, keptAs };
}

/**
 * The daily job: today's backup (when there isn't one yet) and the uploads mirror. Logs one line;
 * never throws (a failed backup must not take the server down). `paused()` skips it, e.g. while
 * the database failed its startup integrity check, so good backups aren't rotated out by bad ones.
 */
export function runDailyBackup({ db, config, now = Date.now, log = console, paused = () => false }) {
  if (config.BACKUPS === 'off') return null;
  if (paused()) {
    log.warn?.('Backup skipped: the database failed its integrity check at startup (see above).');
    return null;
  }
  try {
    const out = backupNow({ db, backupDir: config.BACKUP_DIR, now, keep: config.BACKUP_KEEP });
    const m = mirrorUploads({ uploadDir: config.UPLOAD_DIR, mirrorDir: path.join(config.BACKUP_DIR, 'uploads-mirror') });
    if (out.made || m.copied || m.removed) log.info?.(`Backup: ${out.made ? `wrote ${out.file}` : 'today’s database copy already exists'}; uploads mirror +${m.copied} -${m.removed}.`);
    return { ...out, mirror: m };
  } catch (err) {
    log.error?.(`Backup failed: ${err?.message ?? err}`);
    return null;
  }
}

/** Runs the daily job now and then every hour (it does nothing until the day changes). */
export function scheduleBackups(opts) {
  runDailyBackup(opts);
  const timer = setInterval(() => runDailyBackup(opts), Math.min(DAY, 3_600_000));
  timer.unref?.();
  return timer;
}
