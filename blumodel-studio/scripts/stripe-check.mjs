// The Stripe doctor (`npm run stripe:check`): is the home server's Stripe setup ready to take real
// money? Gabe runs this himself after pasting keys into blumodel.env (docs/LAUNCH.md). It reads the
// settings file with the server's own loader, makes READ-ONLY calls to Stripe, and prints plain
// PASS / FIX / NOTE lines. It never prints a key, a secret or any part of one: the key's mode
// ('live' / 'test') comes from its prefix. Exit code: 0 when nothing needs fixing, 1 when
// something does, 2 when there is no settings file to check.
//
//   npm run stripe:check
//   npm run stripe:check -- --settings D:\somewhere\blumodel.env
//
// Which settings file, first that exists:
//   --settings <path>
//   BLUMODEL_ENV_FILE (or the deprecated MISE_ENV_FILE)
//   <BLUMODEL_HOME or %USERPROFILE%\Projects\BluModelStudio>\blumodel.env, then mise.env there
//   %USERPROFILE%\Projects\Mise\mise.env (the home from before the rename, until it is moved)
// As in the server, a value already in the environment wins over the file.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ENV_FILE_KEYS, describeEnvFile, loadEnvFile } from '../server/lib/envFile.mjs';
import { formatReport, runStripeCheck } from '../server/ops/stripeDoctor.mjs';

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: npm run stripe:check [-- --settings <path>]\nChecks the Stripe setup the home server would use. Read-only; never prints a key.');
  process.exit(0);
}
const i = argv.indexOf('--settings');
if (i >= 0 && !argv[i + 1]) {
  console.error('--settings needs a path.');
  process.exit(2);
}

/** The settings file to check, and where else it looked. Existence checks only; nothing is opened here. */
function chooseFile() {
  if (i >= 0) return { file: path.resolve(argv[i + 1]), looked: [] };
  const clean = (v) => String(v ?? '').trim().replace(/^"(.*)"$/, '$1');
  if (clean(process.env.BLUMODEL_ENV_FILE)) return { file: clean(process.env.BLUMODEL_ENV_FILE), looked: [] };
  if (clean(process.env.MISE_ENV_FILE)) return { file: clean(process.env.MISE_ENV_FILE), looked: [] };
  const home = clean(process.env.BLUMODEL_HOME) || path.join(os.homedir(), 'Projects', 'BluModelStudio');
  const candidates = [path.join(home, 'blumodel.env'), path.join(home, 'mise.env'), path.join(os.homedir(), 'Projects', 'Mise', 'mise.env')];
  return { file: candidates.find((f) => fs.existsSync(f)) ?? null, looked: candidates };
}

const { file, looked } = chooseFile();
if (!file) {
  console.error(`FIX   No settings file found. Looked for:\n${looked.map((f) => `        ${f}`).join('\n')}\n      Make one (docs/LAUNCH.md) or name it with --settings.`);
  process.exit(2);
}

// The server's settings: its environment, then the file's values where the environment has none.
const env = {};
for (const k of ENV_FILE_KEYS) if (process.env[k] !== undefined && process.env[k] !== '') env[k] = process.env[k];
let info;
try {
  info = loadEnvFile(env, { file });
} catch (err) {
  console.error(`FIX   ${err.message}`);
  process.exit(2);
}
const said = describeEnvFile(info);
console.log(`Checking the Stripe setup in ${file}`);
for (const l of said.warn) console.log(`NOTE  ${l}`);

const report = await runStripeCheck({ env, fetch: globalThis.fetch });
for (const l of formatReport(report.lines)) console.log(l);
console.log(report.fixes ? `\n${report.fixes} thing${report.fixes === 1 ? '' : 's'} to fix. Fix them, restart the server (stop-server.cmd, start-server.cmd), and run this again.` : '\nEverything checked is ready.');
process.exit(report.fixes ? 1 : 0);
