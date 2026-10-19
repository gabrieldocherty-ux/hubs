// Packs the site's data into one bundle to carry to another machine (docs/MOVING_DATA.md): a
// consistent copy of the database (safe while the server runs), every upload, and a manifest with
// the row counts and a sha256 for every file. Works the same on Windows and Linux.
//
// The bundle is ENCRYPTED (AES-256-GCM, key from BACKUP_PASSPHRASE: server/ops/crypt.mjs):
//
//   node server/scripts/export-data.mjs --home <home> --out <folder>     <folder>/blumodel-data-<time>.tar.enc
//   node server/scripts/export-data.mjs ... --out <file.tar.enc>          that file
//   node server/scripts/export-data.mjs ... --include-secrets             also the settings file and
//                                                                          the tunnel credentials
//        [--settings <blumodel.env>] [--tunnel-dir <folder with <tunnel id>.json>]
//   node server/scripts/export-data.mjs ... --plain [--folder]            unencrypted (.tar, or a plain
//                                                                          folder), only for a copy that
//                                                                          never leaves this machine;
//                                                                          never with --include-secrets
//
// The passphrase: --passphrase-file <file>, else BACKUP_PASSPHRASE in the environment, else the one
// in this home's blumodel.env, else a prompt in a terminal. Without one (and without --plain) it
// refuses. Keep the passphrase in your password manager: without it the bundle can never be opened.
//
// Which data: --home <dir> (its data/), or --db <file> [--uploads <dir>], or DB_PATH / UPLOAD_DIR,
// or the home this script runs from (<home>/app/server/scripts/export-data.mjs). Default --out:
// <data>/backups/exports, where bundles older than 7 days are deleted (by the next export there and
// by the server's daily backup job). A plain bundle is never written inside a git checkout: it
// holds every account's data and the repo is public.
//
// The private settings file (blumodel.env: live payment keys) and the tunnel credentials are left
// out unless --include-secrets; cloudflared's cert.pem is never taken (running the tunnel doesn't
// need it). Nothing here prints a secret.

import { exportData } from '../ops/dataBundle.mjs';
import { scriptConfig, scriptPassphrase } from '../ops/backup.mjs';
import { passphraseProblem } from '../ops/crypt.mjs';

const argv = process.argv.slice(2);
const opt = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
if (argv.includes('--help') || argv.includes('-h')) {
  console.log(
    'Usage: node server/scripts/export-data.mjs [--home <dir> | --db <file> [--uploads <dir>]] [--out <folder|file.tar.enc>] [--passphrase-file <file>] [--include-secrets [--settings <file>] [--tunnel-dir <dir>]] [--plain [--folder]]',
  );
  process.exit(0);
}

const includeSecrets = argv.includes('--include-secrets');
const plain = argv.includes('--plain');
if (plain && includeSecrets) {
  console.error('Not exported: a bundle with secrets in it (the live payment keys) must be encrypted. Leave out --plain.');
  process.exit(2);
}
if (argv.includes('--folder') && !plain) {
  console.error('Not exported: a folder bundle is unencrypted. Add --plain (only for a copy that stays on this machine), or leave out --folder for an encrypted .tar.enc.');
  process.exit(2);
}
const LOUD = [
  '',
  '  !!! THIS BUNDLE WILL HOLD SECRETS: the live payment keys in blumodel.env and the tunnel',
  '  !!! credentials, as well as every account’s data. It is encrypted; even so, carry it',
  '  !!! only over a private channel (your own USB stick, scp to your own machine), never email,',
  '  !!! chat, a shared drive or git.',
  '  !!! Delete it from every place it was copied to once the new machine runs.',
  '',
];
if (includeSecrets) for (const l of LOUD) console.warn(l);

let config;
let home;
let passphrase = null;
try {
  ({ config, home } = scriptConfig({ argv, env: process.env }));
  if (!plain) {
    const got = await scriptPassphrase({ argv, env: process.env, home });
    if (!got) throw new Error('no BACKUP_PASSPHRASE. Set it in blumodel.env (docs/OPERATIONS.md, "Off-site backups"), in the environment, or pass --passphrase-file <file>. Or pass --plain for an unencrypted copy that never leaves this machine.');
    const problem = passphraseProblem(got.passphrase);
    if (problem) throw new Error(`${problem}.`);
    passphrase = got.passphrase;
  }
} catch (err) {
  console.error(`Not exported: ${err.message}`);
  process.exit(2);
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
try {
  console.log(`Exporting ${config.DB_PATH} and ${config.UPLOAD_DIR}${passphrase ? ' (encrypted)' : ' (NOT encrypted: --plain)'} …`);
  const r = exportData({
    config,
    home,
    out: opt('--out'),
    folder: argv.includes('--folder'),
    passphrase,
    includeSecrets,
    settingsFile: opt('--settings'),
    tunnelDir: opt('--tunnel-dir'),
  });
  const m = r.manifest;
  const rows = Object.values(m.tables).reduce((s, n) => s + n, 0);
  console.log(`Wrote ${r.bundle}${r.encrypted ? ` (${mb(r.bytes)}, encrypted with AES-256-GCM)` : ''}`);
  console.log(`  database: ${Object.keys(m.tables).length} tables, ${rows} rows; schema ${m.schema.migrations} migrations (latest ${m.schema.latest})`);
  for (const t of ['users', 'projects', 'files', 'orders', 'brands', 'billing_subscriptions']) if (t in m.tables) console.log(`    ${t.padEnd(22)} ${m.tables[t]}`);
  console.log(`  uploads: ${m.uploads.files} files, ${mb(m.uploads.bytes)}`);
  console.log(`  app: ${m.app.version} (${m.app.commit})`);
  console.log(r.encrypted ? `  every file was hashed as it went in, and the whole bundle was decrypted back and matches (${m.files.length} files).` : `  every file was read back and matches its sha256 (${m.files.length} files).`);
  if (m.secrets.length) console.warn(`  secrets included: ${m.secrets.join(', ')}`);
  for (const w of r.warnings) console.warn(`  Warning: ${w}`);
  if (r.pruned?.length) console.log(`  removed ${r.pruned.length} bundle(s) older than 7 days from ${config.BACKUP_DIR}`);
  if (!r.encrypted) console.warn('  This bundle is NOT encrypted: keep it on this machine and delete it when done. Only an encrypted bundle leaves the machine.');
  console.log('Check it on the other machine with: node server/scripts/import-data.mjs <bundle> --check');
  if (includeSecrets) for (const l of LOUD) console.warn(l);
} catch (err) {
  console.error(`Not exported: ${err.message}`);
  process.exit(1);
}
