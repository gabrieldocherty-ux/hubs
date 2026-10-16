// Puts a database backup back, and optionally the uploads from the mirror. Stop the server first:
// this refuses while anything answers on the server's port or, on Linux, while any process still
// has the database open.
//
//   node server/scripts/restore.mjs --list                       the daily backups, newest first
//   node server/scripts/restore.mjs --from <backup.db>           restore that file
//   node server/scripts/restore.mjs --latest                     restore the newest daily backup
//   node server/scripts/restore.mjs ... --uploads                also copy missing uploads back from the mirror
//   node server/scripts/restore.mjs ... --home <dir>             the home folder to work on (any OS)
//
// Paths come from the same settings as the server (server/ops/backup.mjs scriptConfig): --home,
// --db <file>, --uploads <dir>, --port <n>, else DB_PATH, UPLOAD_DIR, BACKUP_DIR and PORT, else the
// home this script runs from (<home>/app/server/scripts/restore.mjs → <home>/data/blumodel.db). The
// database being replaced is kept as <db>.before-restore-<time>, never deleted. On Linux, run it as
// the server's account (sudo -u blumodel node ...) or with sudo: as root, what it restores is given
// to the account that owns the data folder, so the server can still write it.
//
// To move the data to another machine instead, see export-data.mjs / import-data.mjs
// (docs/MOVING_DATA.md).

import fs from 'node:fs';
import path from 'node:path';
import { assertServerStopped, listDaily, restoreBackup, restoreUploads, scriptConfig, SERVICE_HINTS } from '../ops/backup.mjs';

const argv = process.argv.slice(2);
const opt = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

let config;
try {
  ({ config } = scriptConfig({ argv, env: process.env }));
} catch (err) {
  console.error(`Not restored: ${err.message}`);
  process.exit(2);
}

const daily = listDaily(config.BACKUP_DIR);
if (argv.includes('--list') || !argv.some((a) => a === '--from' || a === '--latest')) {
  console.log(`Daily backups in ${path.join(config.BACKUP_DIR, 'daily')}:`);
  for (const b of daily) console.log(`  ${b.day}  ${b.file}`);
  if (!daily.length) console.log('  (none)');
  console.log(`Restore one with --from <file> or --latest (stop the server first: ${SERVICE_HINTS.stop}).`);
  process.exit(0);
}

const from = opt('--from') ? path.resolve(opt('--from')) : argv.includes('--latest') ? daily[0]?.file : undefined;
if (!from) {
  console.error('Name a backup with --from <file>, or use --latest (there are no daily backups to pick from).');
  process.exit(2);
}
try {
  await assertServerStopped(config);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
/** Run with sudo on Linux: what this wrote goes to the account that owns the data folder (the server's). */
function giveToDataOwner(paths) {
  if (process.platform === 'win32' || process.getuid?.() !== 0) return;
  const { uid, gid } = fs.statSync(path.dirname(config.DB_PATH));
  if (uid === 0) return;
  const walk = (p) => {
    try {
      fs.lchownSync(p, uid, gid);
      if (fs.lstatSync(p).isDirectory()) for (const n of fs.readdirSync(p)) walk(path.join(p, n));
    } catch {
      /* gone or not ours */
    }
  };
  for (const p of paths) if (fs.existsSync(p)) walk(p);
}

try {
  const r = restoreBackup({ backupFile: from, dbPath: config.DB_PATH });
  giveToDataOwner([config.DB_PATH]);
  console.log(`Restored ${from} to ${r.restored}.${r.keptAs ? ` The database it replaced is kept as ${r.keptAs}.` : ''}`);
  if (argv.includes('--uploads')) {
    const n = restoreUploads({ mirrorDir: path.join(config.BACKUP_DIR, 'uploads-mirror'), uploadDir: config.UPLOAD_DIR });
    giveToDataOwner([config.UPLOAD_DIR]);
    console.log(`Copied ${n} missing upload(s) back from the mirror.`);
  }
  console.log(`Start the server again (${SERVICE_HINTS.start}).`);
} catch (err) {
  console.error(`Not restored: ${err.message}`);
  process.exit(1);
}
