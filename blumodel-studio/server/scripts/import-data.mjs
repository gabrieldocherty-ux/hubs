// Puts a data bundle made by export-data.mjs in place on this machine (docs/MOVING_DATA.md), on
// Windows or Linux. An encrypted bundle (.tar.enc) is decrypted to a private temp file first
// (deleted afterwards); its passphrase comes from --passphrase-file <file>, BACKUP_PASSPHRASE, the
// home's blumodel.env, or a prompt in a terminal. An off-site backup (blumodel-offsite-*.tar.enc)
// is the same kind of bundle.
//
//   node server/scripts/import-data.mjs <bundle.tar.enc | .tar | folder> --check   verify only, change nothing
//   node server/scripts/import-data.mjs <bundle.tar | folder> --home <home>        import into an empty home
//   node server/scripts/import-data.mjs <bundle.tar | folder> --home <home> --replace
//                                                     keep the current data as *.before-import-<time>
//                                                     and import over it
//
// Which data folder: --home <dir> (its data/), or --db <file> [--uploads <dir>], or DB_PATH /
// UPLOAD_DIR, or the home this script runs from (<home>/app/server/scripts/import-data.mjs).
//
// Before changing anything it checks the manifest, every file's size and sha256, PRAGMA
// integrity_check, the row counts, and that this install knows every migration in the bundle; and
// that the server is stopped (nothing on its port, and on Linux no process with the database
// open). It refuses a data folder that already has data unless --replace. Afterwards it runs this
// app's migrations and prints the counts. It never installs the settings file or the tunnel
// credentials, even when the bundle carries them: those are copied by hand.
//
// On Linux run it as the server's account (sudo -u blumodel node ...); run with sudo, it gives what
// it puts in place to the account that owns the home.

import { importData } from '../ops/dataBundle.mjs';
import { assertServerStopped, scriptConfig, scriptPassphrase, SERVICE_HINTS } from '../ops/backup.mjs';
import { isEncryptedFile } from '../ops/crypt.mjs';

const argv = process.argv.slice(2);
const FLAGS_WITH_VALUE = new Set(['--home', '--db', '--uploads', '--port', '--passphrase-file']);
const bundle = argv.find((a, i) => !a.startsWith('--') && !FLAGS_WITH_VALUE.has(argv[i - 1]));
if (!bundle || argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node server/scripts/import-data.mjs <bundle.tar.enc|bundle.tar|folder> [--check] [--replace] [--home <dir> | --db <file> [--uploads <dir>]] [--port <n>] [--passphrase-file <file>]');
  process.exit(bundle ? 0 : 2);
}
const checkOnly = argv.includes('--check');

let config;
let passphrase = null;
try {
  let home;
  ({ config, home } = scriptConfig({ argv, env: process.env }));
  if (isEncryptedFile(bundle)) {
    const got = await scriptPassphrase({ argv, env: process.env, home });
    if (!got) throw new Error(`${bundle} is encrypted: set BACKUP_PASSPHRASE, or pass --passphrase-file <file>.`);
    passphrase = got.passphrase;
  }
} catch (err) {
  console.error(`Not imported: ${err.message}`);
  process.exit(2);
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
try {
  if (!checkOnly) await assertServerStopped(config);
  console.log(checkOnly ? `Checking ${bundle} …` : `Importing ${bundle} into ${config.DB_PATH} and ${config.UPLOAD_DIR} …`);
  const r = importData({ config, bundle, passphrase, replace: argv.includes('--replace'), checkOnly });
  const m = r.manifest;
  console.log(`Bundle ${r.top} (${r.encrypted ? 'encrypted ' : ''}${r.kind}): made ${m.createdAt} by ${m.app.name} ${m.app.version} (${m.app.commit}) on ${m.source?.os ?? '?'}.`);
  console.log(`  every file matches its sha256 (${m.files.length} files); the database passed PRAGMA integrity_check; the row counts match the manifest.`);
  if (r.kept.db) console.log(`  the database that was here is kept as ${r.kept.db}`);
  if (r.kept.uploads) console.log(`  the uploads that were here are kept as ${r.kept.uploads}`);
  if (r.applied.length) console.log(`  applied migrations: ${r.applied.join(', ')}`);
  const rows = Object.entries(r.counts);
  console.log(`  ${checkOnly ? 'in the bundle' : 'now in place'}: ${rows.length} tables, ${rows.reduce((s, [, n]) => s + n, 0)} rows; ${r.uploads} uploads (${mb(m.uploads?.bytes ?? 0)})`);
  for (const [t, n] of rows) console.log(`    ${t.padEnd(28)} ${n}`);
  if (r.missingBlobs) console.warn(`  Warning: ${r.missingBlobs} upload(s) the database refers to are not in ${config.UPLOAD_DIR} (they were already missing where the bundle was made).`);
  if (r.owner) console.log(`  gave the imported files to uid ${r.owner.uid} (the owner of the home).`);
  if (r.secrets.length) {
    console.warn(`  This bundle carries secrets (${r.secrets.join(', ')}). They were NOT installed: copy them by hand (docs/MOVING_DATA.md),`);
    if (r.encrypted) console.warn(`  e.g. node server/scripts/restore-offsite.mjs "${r.bundle}" --decrypt-to <private folder>/bundle.tar, then tar -xf that "${r.top}/secrets", then delete both.`);
    else console.warn(`  e.g. tar -xf "${r.bundle}" "${r.top}/secrets", then delete the bundle and that copy.`);
  }
  console.log(checkOnly ? 'Nothing was changed (--check).' : `Done. Start the server (${SERVICE_HINTS.start}) and sign in to check.`);
} catch (err) {
  console.error(`Not imported: ${err.message}`);
  process.exit(1);
}
