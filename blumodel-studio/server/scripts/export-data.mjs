// Packs the site's data into one bundle to carry to another machine (docs/MOVING_DATA.md): a
// consistent copy of the database (safe while the server runs), every upload, and a manifest with
// the row counts and a sha256 for every file. Works the same on Windows and Linux.
//
//   node server/scripts/export-data.mjs --home <home> --out <folder>     a .tar in that folder
//   node server/scripts/export-data.mjs ... --out <file.tar>              that file
//   node server/scripts/export-data.mjs ... --folder                      a plain folder instead
//   node server/scripts/export-data.mjs ... --include-secrets             also the settings file and
//                                                                          the tunnel credentials
//        [--settings <blumodel.env>] [--tunnel-dir <folder with <tunnel id>.json>]
//
// Which data: --home <dir> (its data/), or --db <file> [--uploads <dir>], or DB_PATH / UPLOAD_DIR,
// or the home this script runs from (<home>/app/server/scripts/export-data.mjs). Default --out:
// <data>/backups/exports. It refuses to write inside a git checkout: the bundle holds every
// account's data and the repo is public.
//
// The private settings file (blumodel.env: live payment keys) and the tunnel credentials are left
// out unless --include-secrets; cloudflared's cert.pem is never taken (running the tunnel doesn't
// need it). Nothing here prints a secret.

import { exportData } from '../ops/dataBundle.mjs';
import { scriptConfig } from '../ops/backup.mjs';

const argv = process.argv.slice(2);
const opt = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node server/scripts/export-data.mjs [--home <dir> | --db <file> [--uploads <dir>]] [--out <folder|file.tar>] [--folder] [--include-secrets [--settings <file>] [--tunnel-dir <dir>]]');
  process.exit(0);
}

const includeSecrets = argv.includes('--include-secrets');
const LOUD = [
  '',
  '  !!! THIS BUNDLE WILL HOLD SECRETS: the live payment keys in blumodel.env and the tunnel',
  '  !!! credentials, as well as every account’s data. Carry it only over a private channel',
  '  !!! (your own USB stick, scp to your own machine), never email, chat, a shared drive or git.',
  '  !!! Delete it from every place it was copied to once the new machine runs.',
  '',
];
if (includeSecrets) for (const l of LOUD) console.warn(l);

let config;
let home;
try {
  ({ config, home } = scriptConfig({ argv, env: process.env }));
} catch (err) {
  console.error(`Not exported: ${err.message}`);
  process.exit(2);
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
try {
  console.log(`Exporting ${config.DB_PATH} and ${config.UPLOAD_DIR} …`);
  const r = exportData({
    config,
    home,
    out: opt('--out'),
    folder: argv.includes('--folder'),
    includeSecrets,
    settingsFile: opt('--settings'),
    tunnelDir: opt('--tunnel-dir'),
  });
  const m = r.manifest;
  const rows = Object.values(m.tables).reduce((s, n) => s + n, 0);
  console.log(`Wrote ${r.bundle}`);
  console.log(`  database: ${Object.keys(m.tables).length} tables, ${rows} rows; schema ${m.schema.migrations} migrations (latest ${m.schema.latest})`);
  for (const t of ['users', 'projects', 'files', 'orders', 'brands', 'billing_subscriptions']) if (t in m.tables) console.log(`    ${t.padEnd(22)} ${m.tables[t]}`);
  console.log(`  uploads: ${m.uploads.files} files, ${mb(m.uploads.bytes)}`);
  console.log(`  app: ${m.app.version} (${m.app.commit})`);
  console.log(`  every file was read back and matches its sha256 (${m.files.length} files).`);
  if (m.secrets.length) console.warn(`  secrets included: ${m.secrets.join(', ')}`);
  for (const w of r.warnings) console.warn(`  Warning: ${w}`);
  console.log('Check it on the other machine with: node server/scripts/import-data.mjs <bundle> --check');
  if (includeSecrets) for (const l of LOUD) console.warn(l);
} catch (err) {
  console.error(`Not exported: ${err.message}`);
  process.exit(1);
}
