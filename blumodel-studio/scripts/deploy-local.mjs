// Deploys the built app to a stable folder outside the repo and (re)starts the
// home server there. The database, uploads, logs and private settings are never overwritten.
//
//   npm run deploy:local                          # build, copy to %USERPROFILE%\Projects\BluModelStudio, restart
//   node scripts/deploy-local.mjs --dist <dir>    # deploy an existing build from <dir> instead of dist\
//
// Env: BLUMODEL_HOME (target folder), BLUMODEL_PORT (8790), BLUMODEL_HOST (127.0.0.1),
//      BLUMODEL_DEMO_PAYMENTS (1; set 0 to refuse the DEMO checkout on this server).
//      MISE_HOME / MISE_PORT / MISE_HOST / MISE_DEMO_PAYMENTS are the deprecated names from before
//      the rename to BluModel Studio; still read when the BLUMODEL_ name isn't set.
//
// Layout of BLUMODEL_HOME:
//   app\                 replaced on every deploy (dist\, server\ code, src\data\*.json)
//   data\blumodel.db     the database: kept across deploys. A home copied from before the rename
//                        has data\mise.db: the deploy backs it up, then renames it (and its -wal and
//                        -shm files) to blumodel.db while the server is stopped.
//   data\backups\        a copy of the database from before each deploy (the last 5)
//   data\uploads\        uploaded models and images: kept across deploys
//   logs\                server.log
//   blumodel.env         private settings (Stripe keys, PUBLIC_URL, ADMIN_EMAILS…), KEY=VALUE, made by
//                        hand and never touched by a deploy. The server reads it at start
//                        (server/lib/envFile.mjs) and never prints a value. A home that only has the
//                        old mise.env uses that until it is renamed.
//   run-server.cmd       supervisor loop: restarts the server if it exits
//   start-server.cmd / stop-server.cmd / start-hidden.vbs
//
// Windows starts the supervisor at logon from the scheduled task BluModelStudioServer (it runs
// start-hidden.vbs); the Cloudflare tunnel to it runs from the task BluModelTunnel. This script
// never creates, changes or deletes a scheduled task.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** BLUMODEL_<name>, else the deprecated MISE_<name>, else `def`. */
function setting(name, def) {
  const now = process.env[`BLUMODEL_${name}`];
  if (now !== undefined && now !== '') return now;
  const old = process.env[`MISE_${name}`];
  if (old !== undefined && old !== '') {
    console.warn(`MISE_${name} is deprecated: set BLUMODEL_${name} instead.`);
    return old;
  }
  return def;
}

const argv = process.argv.slice(2);
const distArg = argv.indexOf('--dist') >= 0 ? argv[argv.indexOf('--dist') + 1] : null;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(ROOT, distArg || 'dist');
const HOME = path.resolve(setting('HOME', path.join(os.homedir(), 'Projects', 'BluModelStudio')));
const PORT = String(setting('PORT', '8790'));
const HOST = setting('HOST', '127.0.0.1');
const APP = path.join(HOME, 'app');
const DEPLOYING = path.join(HOME, 'deploying');
const DB = path.join(HOME, 'data', 'blumodel.db');
const LEGACY_DB = path.join(HOME, 'data', 'mise.db');
const SETTINGS = path.join(HOME, 'blumodel.env');
const LEGACY_SETTINGS = path.join(HOME, 'mise.env');
/**
 * Files outside server/ that the server imports at runtime (kept at the same relative path):
 * every JSON file in src/data/ (kinds.json, plans.json…), so a new shared data file ships
 * without editing this list. server/generated/ (the export kit) travels with server/.
 */
const RUNTIME_FILES = fs
  .readdirSync(path.join(ROOT, 'src', 'data'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => `src/data/${f}`);

if (process.platform !== 'win32') {
  console.error('deploy-local is written for the Windows home server. Use `npm start` elsewhere.');
  process.exit(1);
}
if (argv.includes('--dist') && !distArg) {
  console.error('--dist needs a folder (a vite build output with index.html).');
  process.exit(1);
}
if (!fs.existsSync(path.join(DIST, 'index.html')) || !fs.existsSync(path.join(ROOT, 'server', 'generated', 'export-kit.mjs'))) {
  console.error(`No build found in ${DIST}. Run \`npm run build\` first (or use \`npm run deploy:local\`).`);
  process.exit(1);
}

/** PIDs listening on PORT whose command line runs this home's server. */
function serverPids() {
  let out = '';
  try { out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' }); } catch { return []; }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] === 'TCP' && cols[1]?.endsWith(':' + PORT) && cols[3] === 'LISTENING') pids.add(cols[4]);
  }
  return [...pids].filter((pid) => {
    try {
      const cmd = execFileSync('powershell.exe', ['-NoProfile', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: 'utf8' });
      return cmd.toLowerCase().includes(APP.toLowerCase());
    } catch { return false; }
  });
}

function portTaken() {
  try {
    const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
    return out.split(/\r?\n/).some((l) => { const c = l.trim().split(/\s+/); return c[0] === 'TCP' && c[1]?.endsWith(':' + PORT) && c[3] === 'LISTENING'; });
  } catch { return false; }
}

const copyTree = (from, to, skip = () => false) =>
  fs.cpSync(from, to, { recursive: true, filter: (src) => !skip(src) });

// ─── Private settings (only whether the file exists: its contents are never read here) ──

const settingsFile = fs.existsSync(SETTINGS) ? SETTINGS : fs.existsSync(LEGACY_SETTINGS) ? LEGACY_SETTINGS : null;

// ─── Supervisor scripts (regenerated each deploy so they track this file) ──

const NODE = process.execPath;
// The home server runs --prod, which refuses the DEMO checkout unless DEMO_PAYMENTS=1. A home with
// no private settings has no Stripe keys, and refusing the demo would leave every export locked
// with no way to pay, so such a home allows the (clearly labelled, moneyless) demo by default.
// A home WITH a settings file is the public one: the file decides (production default: demo
// refused), unless BLUMODEL_DEMO_PAYMENTS is given to this deploy. Demo never replaces real
// payments: once both Stripe keys are set the server uses Stripe and refuses demo payments.
const demoSetting = setting('DEMO_PAYMENTS', null);
const DEMO_PAYMENTS = demoSetting !== null ? (demoSetting === '0' ? '0' : '1') : settingsFile ? null : '1';
const DEMO_LINE = DEMO_PAYMENTS === null
  ? 'rem DEMO_PAYMENTS comes from the private settings file (refused in production unless it says DEMO_PAYMENTS=1).'
  : `set DEMO_PAYMENTS=${DEMO_PAYMENTS}`;
// A settings file present at deploy time is named outright, so if it later goes missing the
// server refuses to start rather than coming up without its payment keys.
const SETTINGS_LINES = settingsFile
  ? `set "BLUMODEL_ENV_FILE=%~dp0${path.basename(settingsFile)}"`
  : 'rem No blumodel.env was here at deploy time: the server runs without private settings.';
const SCRIPTS = {
  'run-server.cmd': `@echo off
rem BluModel Studio home server supervisor. Runs the server and restarts it if it exits.
rem Started hidden by start-hidden.vbs (at logon from the BluModelStudioServer task, or via start-server.cmd).
rem Generated by blumodel-studio/scripts/deploy-local.mjs - edits are overwritten.
setlocal
cd /d "%~dp0"
set PORT=${PORT}
set HOST=${HOST}
set DB_PATH=%~dp0data\\blumodel.db
set "DEMO_PAYMENTS="
${DEMO_LINE}
set "BLUMODEL_ENV_FILE="
set "MISE_ENV_FILE="
${SETTINGS_LINES}
if not exist logs mkdir logs
:loop
if exist stopped exit /b 0
if exist deploying (ping -n 3 127.0.0.1 >nul & goto loop)
rem Another instance already holds the port: leave it alone rather than spin.
netstat -ano -p tcp | findstr /R /C:":${PORT} .*LISTENING" >nul && exit /b 0
echo [%date% %time%] starting on %HOST%:%PORT% >> logs\\server.log
rem Absolute script path, so deploy-local can tell this server from other node processes.
"${NODE}" --no-warnings "%~dp0app\\server\\index.mjs" --prod >> logs\\server.log 2>&1
echo [%date% %time%] server exited with code %errorlevel%, restarting in 5s >> logs\\server.log
ping -n 6 127.0.0.1 >nul
goto loop
`,
  'start-hidden.vbs': `' Starts the BluModel Studio server supervisor with no console window.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
sh.Run "cmd /c """ & dir & "\\run-server.cmd""", 0, False
`,
  'start-server.cmd': `@echo off
cd /d "%~dp0"
if exist stopped del stopped
wscript.exe "%~dp0start-hidden.vbs"
echo BluModel Studio is starting at http://localhost:${PORT}
`,
  'stop-server.cmd': `@echo off
rem Stops the server and its supervisor until start-server.cmd is run again.
cd /d "%~dp0"
echo.> stopped
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /R /C:":${PORT} .*LISTENING"') do taskkill /PID %%p /F >nul 2>&1
echo BluModel Studio server stopped. Run start-server.cmd to start it again.
`,
};

// ─── Deploy ────────────────────────────────────────────────────────────────

fs.mkdirSync(path.join(HOME, 'data'), { recursive: true });
fs.mkdirSync(path.join(HOME, 'logs'), { recursive: true });
fs.writeFileSync(DEPLOYING, new Date().toISOString());
try {
  const running = serverPids();
  for (const pid of running) execFileSync('taskkill', ['/PID', pid, '/F'], { stdio: 'ignore' });
  if (running.length) console.log(`Stopped running server (pid ${running.join(', ')}).`);
  else if (portTaken()) {
    console.error(`Port ${PORT} is in use by something other than this BluModel Studio install. Set BLUMODEL_PORT to a free port.`);
    process.exit(1);
  }

  // Back up the database before new code (and its migrations) opens it. The server is stopped and
  // the supervisor waits while DEPLOYING exists, so the copy (with its WAL files) is consistent.
  const legacyOnly = !fs.existsSync(DB) && fs.existsSync(LEGACY_DB);
  const db = legacyOnly ? LEGACY_DB : DB;
  if (fs.existsSync(db)) {
    const backups = path.join(HOME, 'data', 'backups');
    const dir = path.join(backups, new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    const name = path.basename(db);
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(db + ext)) fs.copyFileSync(db + ext, path.join(dir, `${name}${ext}`));
    for (const old of fs.readdirSync(backups).sort().slice(0, -5)) fs.rmSync(path.join(backups, old), { recursive: true, force: true });
    console.log(`Backed up the database to ${dir}`);
  }
  if (legacyOnly) {
    // A home from before the rename: the database keeps its data under the new name. The WAL and
    // shared-memory files move with it, so nothing committed is left behind.
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(LEGACY_DB + ext)) fs.renameSync(LEGACY_DB + ext, DB + ext);
    console.log(`Renamed data\\mise.db to data\\blumodel.db (the backup above has the original).`);
  } else if (fs.existsSync(DB) && fs.existsSync(LEGACY_DB)) {
    console.warn('Both data\\blumodel.db and data\\mise.db exist. The server uses blumodel.db; mise.db is left alone.');
  }

  const staging = APP + '.new';
  fs.rmSync(staging, { recursive: true, force: true });
  copyTree(DIST, path.join(staging, 'dist'));
  copyTree(path.join(ROOT, 'server'), path.join(staging, 'server'),
    (src) => /[\\/]server[\\/](data|test)([\\/]|$)/.test(src));
  // Files outside server/ that the server imports at runtime, at the same relative paths.
  for (const rel of RUNTIME_FILES) {
    fs.mkdirSync(path.dirname(path.join(staging, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(staging, rel));
  }
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(staging, 'package.json'));
  let head = 'unknown';
  try { head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch {}
  fs.writeFileSync(path.join(staging, 'DEPLOYED.txt'), `commit ${head}\ndeployed ${new Date().toISOString()}\nfrom ${ROOT}\n`);

  fs.rmSync(APP, { recursive: true, force: true });
  fs.renameSync(staging, APP);
  for (const [name, body] of Object.entries(SCRIPTS)) fs.writeFileSync(path.join(HOME, name), body.replace(/\r?\n/g, '\r\n'));
  console.log(`Deployed commit ${head} to ${APP}`);
  if (settingsFile === LEGACY_SETTINGS) console.warn(`Using the private settings in mise.env (the name from before the rename). Rename it to blumodel.env and redeploy.`);
  else if (!settingsFile) console.warn(`No blumodel.env in ${HOME}: the server runs without private settings (no Stripe keys, so payments are DEMO${DEMO_PAYMENTS === '1' ? ', allowed' : ', refused'}).`);
  else console.log(`The server reads its private settings from ${SETTINGS}.`);
} finally {
  fs.rmSync(DEPLOYING, { force: true });
}

// Start it unless the supervisor is already looping (it restarts on its own) or
// someone stopped it on purpose.
await new Promise((r) => setTimeout(r, 3000));
if (fs.existsSync(path.join(HOME, 'stopped'))) {
  console.log('Server is stopped on purpose (stopped file present). Run start-server.cmd to start it.');
  process.exit(0);
}
if (!serverPids().length) {
  spawn('wscript.exe', [path.join(HOME, 'start-hidden.vbs')], { detached: true, stdio: 'ignore' }).unref();
}

for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/`);
    if (res.ok) { console.log(`BluModel Studio is up at http://localhost:${PORT}`); process.exit(0); }
  } catch {}
}
console.error(`Server did not answer on port ${PORT} within 30s. Check ${path.join(HOME, 'logs', 'server.log')}.`);
process.exit(1);
