// Deploys the built app to the home server's folder outside the repo and (re)starts it there.
// The database, uploads, backups, logs and private settings are never overwritten.
//
//   npm run deploy:local                          # build, copy to %USERPROFILE%\Projects\BluModelStudio, restart
//   node scripts/deploy-local.mjs --dist <dir>    # deploy an existing build from <dir> instead of dist\
//
// Env: BLUMODEL_HOME (the folder; default %USERPROFILE%\Projects\BluModelStudio), BLUMODEL_PORT (8790),
//      BLUMODEL_HOST (127.0.0.1), BLUMODEL_ADMIN_EMAILS (ADMIN_EMAILS in a new settings template).
//      MISE_HOME / MISE_PORT / MISE_HOST are the deprecated names from before the rename; still read
//      when the BLUMODEL_ name isn't set. DEMO_PAYMENTS is no longer a deploy setting: it lives in
//      blumodel.env (0 in the template).
//
// The folder's layout is at the top of server/ops/home.mjs. In short: app\ is replaced; data\
// (blumodel.db, uploads\, backups\), logs\ and blumodel.env are kept; the supervisor scripts are
// rewritten. A home from before the rename has data\mise.db and mise.env: the deploy backs the
// database up and renames it (with its -wal and -shm) to blumodel.db, and renames mise.env to
// blumodel.env without opening it (scripts/migrate-home.mjs does both when moving the old folder).
// A home with no settings file at all gets a blumodel.env TEMPLATE (keys present, secrets empty,
// payments off), readable only by the current Windows account.
//
// Stopping the running server: it is asked to shut down gracefully through shutdown.request (it
// finishes open requests, checkpoints the database and exits), then its supervisor is ended so the
// new run-server.cmd starts fresh. Only processes whose command line runs THIS home's server or
// supervisor are touched; the tunnel keeps running through a deploy.
//
// Windows starts the supervisor at logon from the scheduled task BluModelStudioServer (it runs
// start-hidden.vbs); the Cloudflare tunnel runs from the task BluModelTunnel (scripts/tunnel/). This
// script never creates, changes or deletes a scheduled task (scripts/register-tasks.mjs does).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createSettingsTemplate,
  defaultHome,
  deployBackupDirs,
  homeLayout,
  homeProcesses,
  serverScripts,
  settingsTemplate,
  sys32,
} from '../server/ops/home.mjs';

/** The admin a new settings template names (the owner of blumodel.studio). */
const DEFAULT_ADMIN_EMAILS = 'gabrieldocherty@gmail.com';

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
const L = homeLayout(setting('HOME', defaultHome()));
const HOME = L.home;
const PORT = String(setting('PORT', '8790'));
const HOST = setting('HOST', '127.0.0.1');
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
if (!/^\d{1,5}$/.test(PORT)) {
  console.error(`BLUMODEL_PORT must be a port number (got "${PORT}").`);
  process.exit(1);
}
if (!fs.existsSync(path.join(DIST, 'index.html')) || !fs.existsSync(path.join(ROOT, 'server', 'generated', 'export-kit.mjs'))) {
  console.error(`No build found in ${DIST}. Run \`npm run build\` first (or use \`npm run deploy:local\`).`);
  process.exit(1);
}
for (const old of ['BLUMODEL_DEMO_PAYMENTS', 'MISE_DEMO_PAYMENTS']) {
  if (process.env[old]) console.warn(`${old} is no longer used by the deploy: set DEMO_PAYMENTS in ${L.settings} instead.`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PIDs listening on PORT. */
function listeners() {
  let out = '';
  try {
    out = execFileSync(sys32('netstat.exe'), ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
  } catch {
    return [];
  }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    const c = line.trim().split(/\s+/);
    if (c[0] === 'TCP' && c[1]?.endsWith(':' + PORT) && c[3] === 'LISTENING') pids.add(Number(c[4]));
  }
  return [...pids];
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
};
const kill = (pid) => {
  try {
    execFileSync(sys32('taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } catch {
    /* already gone */
  }
};

/**
 * Stops this home's server (gracefully when its supervisor gave it a shutdown file) and its
 * supervisor. Returns the PIDs stopped.
 */
async function stopServer() {
  const procs = homeProcesses(HOME);
  const servers = procs.servers.map((p) => p.pid);
  const supervisors = procs.supervisors.map((p) => p.pid);
  if (servers.length) {
    // Only a supervisor generated since the launch hardening names a shutdown file for its server.
    let graceful = false;
    try {
      graceful = fs.readFileSync(L.runServer, 'utf8').includes('BLUMODEL_SHUTDOWN_FILE');
    } catch {
      graceful = false;
    }
    if (graceful) {
      fs.writeFileSync(L.shutdownFile, new Date().toISOString());
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && servers.some(alive)) await sleep(250);
      const left = servers.filter(alive);
      if (left.length) console.warn(`The server did not stop within 15 s; ending it (pid ${left.join(', ')}).`);
      else console.log(`Stopped the server gracefully (pid ${servers.join(', ')}).`);
      for (const pid of left) kill(pid);
    } else {
      for (const pid of servers) kill(pid);
      console.log(`Stopped the server (pid ${servers.join(', ')}; its supervisor predates graceful shutdown).`);
    }
  }
  // The supervisor waits while `deploying` exists; end it so the new run-server.cmd starts fresh
  // instead of a running cmd.exe reading a batch file that changed under it.
  for (const pid of supervisors) kill(pid);
  if (supervisors.length) console.log(`Stopped the supervisor (pid ${supervisors.join(', ')}).`);
  fs.rmSync(L.shutdownFile, { force: true });
  return [...servers, ...supervisors];
}

const copyTree = (from, to, skip = () => false) => fs.cpSync(from, to, { recursive: true, filter: (src) => !skip(src) });

// ─── Deploy ────────────────────────────────────────────────────────────────

fs.mkdirSync(L.data, { recursive: true });
fs.mkdirSync(L.logs, { recursive: true });
fs.writeFileSync(L.deploying, new Date().toISOString());
let settingsNote = '';
try {
  const stoppedPids = await stopServer();
  // A process just ended can take a moment to release its socket.
  for (let i = 0; i < 20 && stoppedPids.length && listeners().length; i++) await sleep(250);
  if (listeners().length) {
    console.error(`Port ${PORT} is in use by something other than this BluModel Studio install. Set BLUMODEL_PORT to a free port.`);
    process.exitCode = 1;
    throw new Error('port in use');
  }

  // Back up the database before new code (and its migrations) opens it. The server is stopped and
  // the supervisor is gone, so the copy (with its WAL files) is consistent.
  const legacyOnly = !fs.existsSync(L.db) && fs.existsSync(L.legacyDb);
  const db = legacyOnly ? L.legacyDb : L.db;
  if (fs.existsSync(db)) {
    const dir = path.join(L.backups, new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    const name = path.basename(db);
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(db + ext)) fs.copyFileSync(db + ext, path.join(dir, `${name}${ext}`));
    // Keep the last 5 pre-deploy copies; the server's daily\ backups and uploads-mirror\ are not touched.
    for (const old of deployBackupDirs(L.backups).slice(0, -5)) fs.rmSync(path.join(L.backups, old), { recursive: true, force: true });
    console.log(`Backed up the database to ${dir}`);
  }
  if (legacyOnly) {
    // A home from before the rename: the database keeps its data under the new name. The WAL and
    // shared-memory files move with it, so nothing committed is left behind.
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(L.legacyDb + ext)) fs.renameSync(L.legacyDb + ext, L.db + ext);
    console.log('Renamed data\\mise.db to data\\blumodel.db (the backup above has the original).');
  } else if (fs.existsSync(L.db) && fs.existsSync(L.legacyDb)) {
    console.warn('Both data\\blumodel.db and data\\mise.db exist. The server uses blumodel.db; mise.db is left alone.');
  }

  // Private settings: existence checks and a rename only. Their contents are never read here.
  if (fs.existsSync(L.settings)) {
    settingsNote = `The server reads its private settings from ${L.settings}.`;
    if (fs.existsSync(L.legacySettings)) console.warn(`Both blumodel.env and mise.env are in ${HOME}. The server reads blumodel.env only; delete mise.env once you are sure it holds nothing you need.`);
  } else if (fs.existsSync(L.legacySettings)) {
    fs.renameSync(L.legacySettings, L.settings);
    settingsNote = `Renamed mise.env to blumodel.env (not opened). The server reads its private settings from ${L.settings}.`;
  } else {
    const adminEmails = String(process.env.BLUMODEL_ADMIN_EMAILS || DEFAULT_ADMIN_EMAILS).trim();
    const r = createSettingsTemplate(L.settings, { text: settingsTemplate({ adminEmails }) });
    if (r.created) {
      settingsNote =
        `Created a settings TEMPLATE at ${L.settings} (keys present, Stripe values empty, payments off)` +
        (r.restrictedTo ? `, readable only by ${r.restrictedTo}.` : `. Could not restrict who can read it (${r.restrictError}).`) +
        ' Fill it in per docs/LAUNCH.md, then restart the server.';
    } else {
      settingsNote = `The server reads its private settings from ${L.settings}.`;
    }
  }

  const staging = L.app + '.new';
  fs.rmSync(staging, { recursive: true, force: true });
  copyTree(DIST, path.join(staging, 'dist'));
  copyTree(path.join(ROOT, 'server'), path.join(staging, 'server'), (src) => /[\\/]server[\\/](data|test)([\\/]|$)/.test(src));
  // Files outside server/ that the server imports at runtime, at the same relative paths.
  for (const rel of RUNTIME_FILES) {
    fs.mkdirSync(path.dirname(path.join(staging, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(staging, rel));
  }
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(staging, 'package.json'));
  let head = 'unknown';
  try {
    head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
  } catch {
    /* not a git checkout */
  }
  fs.writeFileSync(path.join(staging, 'DEPLOYED.txt'), `commit ${head}\ndeployed ${new Date().toISOString()}\nfrom ${ROOT}\n`);

  fs.rmSync(L.app, { recursive: true, force: true });
  fs.renameSync(staging, L.app);
  for (const [name, body] of Object.entries(serverScripts({ node: process.execPath, port: PORT, host: HOST }))) fs.writeFileSync(path.join(HOME, name), body);
  console.log(`Deployed commit ${head} to ${L.app}`);
  console.log(settingsNote);
  if (!fs.existsSync(L.tunnelConfig)) console.log(`No tunnel set up in ${HOME} yet: node scripts/tunnel/setup-tunnel.mjs (docs/OPERATIONS.md).`);
} catch (err) {
  if (err?.message !== 'port in use') throw err;
} finally {
  fs.rmSync(L.deploying, { force: true });
}
if (process.exitCode) process.exit(process.exitCode);

// Start it unless someone stopped it on purpose.
if (fs.existsSync(L.stopped)) {
  console.log('The server is stopped on purpose (a "stopped" file is in the folder). Run start-server.cmd to start it.');
  process.exit(0);
}
spawn(sys32('wscript.exe'), [L.startHidden], { detached: true, stdio: 'ignore', windowsHide: true }).unref();

for (let i = 0; i < 40; i++) {
  await sleep(1000);
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
    const h = await res.json().catch(() => ({}));
    if (res.ok) {
      let payments = '?';
      try {
        payments = (await (await fetch(`http://127.0.0.1:${PORT}/api/config`)).json()).payments ?? '?';
      } catch {
        /* older server */
      }
      console.log(`BluModel Studio ${h.version ?? ''} is up at http://127.0.0.1:${PORT} (payments: ${payments}). Its log: ${path.join(L.logs, 'server.log')}`);
      process.exit(0);
    }
    if (res.status === 503) {
      console.error(`The server started but reports a problem: ${JSON.stringify(h)}. Check ${path.join(L.logs, 'server.log')}.`);
      process.exit(1);
    }
  } catch {
    /* not up yet */
  }
}
console.error(`The server did not answer on port ${PORT} within 40 s. Check ${path.join(L.logs, 'server.log')} and ${path.join(L.logs, 'console.log')}.`);
process.exit(1);
