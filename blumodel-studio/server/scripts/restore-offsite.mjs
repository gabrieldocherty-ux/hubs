// Puts an encrypted off-site backup (or an encrypted export bundle) back: decrypts it to a private
// temp file, checks every file in it against its manifest and the database with PRAGMA
// integrity_check, then restores the database the same way restore.mjs does (the one replaced is
// kept as <db>.before-restore-<time>). docs/OPERATIONS.md, "Off-site backups".
//
//   node server/scripts/restore-offsite.mjs --list <folder>            the copies in that folder, newest first
//   node server/scripts/restore-offsite.mjs <file.tar.enc> --check     decrypt and verify only, change nothing
//   node server/scripts/restore-offsite.mjs <file.tar.enc>             restore its database
//   node server/scripts/restore-offsite.mjs <file.tar.enc> --uploads   also copy back uploads that are missing
//   node server/scripts/restore-offsite.mjs <file.tar.enc> --decrypt-to <file.tar>
//                                                                      just decrypt (a plain data bundle;
//                                                                      import-data.mjs takes it; delete it after)
//   ... --home <dir> | --db <file> [--uploads-dir <dir>] [--port <n>] [--passphrase-file <file>]
//
// Stop the server first: like restore.mjs it refuses while anything answers on the server's port
// or, on Linux, while a process has the database open. The passphrase: --passphrase-file <file>,
// else BACKUP_PASSPHRASE, else the home's blumodel.env, else a prompt in a terminal. A wrong one
// changes nothing. To restore everything onto a new machine instead, use import-data.mjs (it takes
// the .tar.enc as it is).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertServerStopped, privateDir, restoreBackup, restoreUploads, scriptConfig, scriptPassphrase, SERVICE_HINTS } from '../ops/backup.mjs';
import { decryptToFile, readEncryptedHeader } from '../ops/crypt.mjs';
import { checkDatabase, DB_ENTRY, openBundle, verifyBundle } from '../ops/dataBundle.mjs';
import { listOffsite } from '../ops/offsite.mjs';

const argv = process.argv.slice(2);
const WITH_VALUE = new Set(['--home', '--db', '--uploads-dir', '--port', '--passphrase-file', '--decrypt-to', '--list']);
const opt = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
const file = argv.find((a, i) => !a.startsWith('--') && !WITH_VALUE.has(argv[i - 1]));
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

if (argv.includes('--help') || argv.includes('-h') || (!file && !argv.includes('--list'))) {
  console.log('Usage: node server/scripts/restore-offsite.mjs <file.tar.enc> [--check | --uploads | --decrypt-to <file.tar>] [--home <dir> | --db <file>] [--port <n>] [--passphrase-file <file>]');
  console.log('       node server/scripts/restore-offsite.mjs --list <folder>');
  process.exit(file || argv.includes('--help') || argv.includes('-h') ? 0 : 2);
}

if (argv.includes('--list')) {
  const dir = opt('--list');
  if (!dir) {
    console.error('Name the folder: --list <BACKUP_OFFSITE_DIR>.');
    process.exit(2);
  }
  const copies = listOffsite(path.resolve(dir));
  console.log(`Off-site copies in ${path.resolve(dir)}:`);
  for (const c of copies) console.log(`  ${new Date(c.at).toISOString()}  ${c.bytes === null ? '?' : mb(c.bytes).padStart(9)}  ${c.file}`);
  if (!copies.length) console.log('  (none)');
  process.exit(0);
}

// scriptConfig reads --uploads as the uploads folder; here --uploads is the "copy uploads back" switch.
const cfgArgv = argv.filter((a) => a !== '--uploads').map((a) => (a === '--uploads-dir' ? '--uploads' : a));
let config;
let home;
let passphrase;
try {
  ({ config, home } = scriptConfig({ argv: cfgArgv, env: process.env }));
  const got = await scriptPassphrase({ argv, env: process.env, home });
  if (!got) throw new Error('no BACKUP_PASSPHRASE: set it in the environment, or pass --passphrase-file <file> (it was in blumodel.env and your password manager).');
  passphrase = got.passphrase;
  const h = readEncryptedHeader(path.resolve(file), passphrase).header;
  console.log(`${path.resolve(file)}: ${h.kind ?? 'bundle'} made ${h.createdAt ?? '?'}; the passphrase is right.`);
} catch (err) {
  console.error(`Not restored: ${err.message}`);
  process.exit(err?.code === 'bad_passphrase' ? 1 : 2);
}

if (opt('--decrypt-to')) {
  const dest = path.resolve(opt('--decrypt-to'));
  try {
    const r = decryptToFile(path.resolve(file), dest, passphrase);
    console.log(`Decrypted to ${dest} (${mb(r.plainBytes)}). It is NOT encrypted: delete it as soon as you are done with it.`);
    process.exit(0);
  } catch (err) {
    console.error(`Not decrypted: ${err.message}`);
    process.exit(1);
  }
}

const checkOnly = argv.includes('--check');
const withUploads = argv.includes('--uploads');
let tmp = null;
let code = 0;
try {
  if (!checkOnly) await assertServerStopped(config);
  // The temp copy: beside the data for a restore (same disk, private), the system temp for a check.
  tmp = fs.mkdtempSync(path.join(checkOnly ? os.tmpdir() : privateDir(path.dirname(path.resolve(config.DB_PATH))), '.restore-offsite-'));
  const plain = path.join(tmp, 'bundle.tar');
  decryptToFile(path.resolve(file), plain, passphrase);
  const staged = path.join(tmp, 'staged');
  const opened = openBundle(plain);
  const keep = (rel) => rel === DB_ENTRY || (withUploads && !checkOnly && rel.startsWith('uploads/'));
  const { manifest, problems } = verifyBundle(opened, { dest: (rel) => (keep(rel) ? path.join(staged, ...rel.split('/')) : null) });
  if (problems.length) throw new Error(`the copy did not verify; nothing was changed:\n  ${problems.slice(0, 20).join('\n  ')}`);
  const stagedDb = path.join(staged, ...DB_ENTRY.split('/'));
  const db = checkDatabase(stagedDb, { tables: manifest.tables });
  if (db.problems.length) throw new Error(`its database did not check out; nothing was changed:\n  ${db.problems.join('\n  ')}`);
  const rows = Object.values(db.counts).reduce((s, n) => s + n, 0);
  console.log(`  every file matches its sha256 (${manifest.files.length} files); the database passed PRAGMA integrity_check (${Object.keys(db.counts).length} tables, ${rows} rows); ${manifest.uploads?.files ?? 0} uploads (${mb(manifest.uploads?.bytes ?? 0)}).`);
  if (checkOnly) {
    console.log('Nothing was changed (--check).');
  } else {
    const r = restoreBackup({ backupFile: stagedDb, dbPath: config.DB_PATH });
    giveToDataOwner([config.DB_PATH]);
    console.log(`Restored the database to ${r.restored}.${r.keptAs ? ` The database it replaced is kept as ${r.keptAs} (deleted after 30 days).` : ''}`);
    if (withUploads) {
      const n = restoreUploads({ mirrorDir: path.join(staged, 'uploads'), uploadDir: config.UPLOAD_DIR });
      giveToDataOwner([config.UPLOAD_DIR]);
      console.log(`Copied ${n} missing upload(s) back into ${config.UPLOAD_DIR} (files already there are never replaced).`);
    }
    console.log(`Start the server again (${SERVICE_HINTS.start}).`);
  }
} catch (err) {
  console.error(`Not restored: ${err.message}`);
  code = 1;
} finally {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
process.exit(code);

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
