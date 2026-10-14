// Puts a database backup back, and optionally the uploads from the mirror. Stop the server first:
// this refuses while anything listens on the server's port.
//
//   node server\scripts\restore.mjs --list                       the daily backups, newest first
//   node server\scripts\restore.mjs --from <backup.db>           restore that file
//   node server\scripts\restore.mjs --latest                     restore the newest daily backup
//   node server\scripts\restore.mjs ... --uploads                also copy missing uploads back from the mirror
//
// Paths come from the same settings as the server: DB_PATH (on the home server, run-server.cmd's
// data\blumodel.db; pass --db to name it), UPLOAD_DIR, BACKUP_DIR, PORT (default 8790). The
// database being replaced is kept as <db>.before-restore-<time>, never deleted.

import net from 'node:net';
import path from 'node:path';
import { loadConfig } from '../config.mjs';
import { listDaily, restoreBackup, restoreUploads } from '../ops/backup.mjs';
import { deployedHome } from '../lib/envFile.mjs';

const argv = process.argv.slice(2);
const opt = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};

const env = { ...process.env };
// On the home server (<home>\app\server\scripts\restore.mjs) the database is <home>\data\blumodel.db.
const home = deployedHome();
if (opt('--db')) env.DB_PATH = path.resolve(opt('--db'));
else if (!env.DB_PATH && home) env.DB_PATH = path.join(home, 'data', 'blumodel.db');
const config = loadConfig(env, []);

const listening = (port) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
    s.setTimeout(1500, () => {
      s.destroy();
      resolve(false);
    });
  });

const daily = listDaily(config.BACKUP_DIR);
if (argv.includes('--list') || argv.length === 0) {
  console.log(`Daily backups in ${path.join(config.BACKUP_DIR, 'daily')}:`);
  for (const b of daily) console.log(`  ${b.day}  ${b.file}`);
  if (!daily.length) console.log('  (none)');
  console.log('Restore one with --from <file> or --latest (stop the server first).');
  process.exit(0);
}

const from = opt('--from') ? path.resolve(opt('--from')) : argv.includes('--latest') ? daily[0]?.file : undefined;
if (!from) {
  console.error('Name a backup with --from <file>, or use --latest.');
  process.exit(2);
}
if (await listening(config.PORT)) {
  console.error(`Something is listening on port ${config.PORT}. Stop the server first (stop-server.cmd), then run this again.`);
  process.exit(1);
}
try {
  const r = restoreBackup({ backupFile: from, dbPath: config.DB_PATH });
  console.log(`Restored ${from} to ${r.restored}.${r.keptAs ? ` The database it replaced is kept as ${r.keptAs}.` : ''}`);
  if (argv.includes('--uploads')) {
    const n = restoreUploads({ mirrorDir: path.join(config.BACKUP_DIR, 'uploads-mirror'), uploadDir: config.UPLOAD_DIR });
    console.log(`Copied ${n} missing upload(s) back from the mirror.`);
  }
  console.log('Start the server again (start-server.cmd).');
} catch (err) {
  console.error(`Not restored: ${err.message}`);
  process.exit(1);
}
