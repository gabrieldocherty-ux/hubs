// Deploys the built app to the home server's folder outside the repo and (re)starts it there.
// The database, uploads, backups, logs and private settings are never overwritten.
//
//   npm run deploy:local                          # build, copy into the home, restart
//   node scripts/deploy-local.mjs --dist <dir>    # deploy an existing build from <dir> instead of dist/
//   node scripts/deploy-local.mjs --rollback      # put back the app the last deploy replaced
//   options: --commit <sha> (written to DEPLOYED.txt; default: git rev-parse --short HEAD)
//            --health-timeout <seconds> (60)
//
// Windows: the home is %USERPROFILE%\Projects\BluModelStudio and the server runs under the
// run-server.cmd supervisor written here. Linux: the home is /srv/blumodel-studio, the server is
// blumodel-studio.service (scripts/register-tasks.mjs installs it) and this must run with sudo,
// because it stops and starts that service. docs/HOSTING.md.
//
// Env: BLUMODEL_HOME (the folder), BLUMODEL_PORT (default: the port this home was installed with,
//      read from its run-server.cmd on Windows or blumodel-studio.service on Linux, else 8790; so an
//      update or a rollback checks the port the install used), BLUMODEL_HOST (127.0.0.1; Windows),
//      BLUMODEL_ADMIN_EMAILS (ADMIN_EMAILS in a new settings template; empty otherwise).
//      MISE_HOME / MISE_PORT / MISE_HOST are the deprecated names from before the rename; still read
//      when the BLUMODEL_ name isn't set. DEMO_PAYMENTS is no longer a deploy setting: it lives in
//      blumodel.env (0 in the template).
//
// The folder's layout is at the top of server/ops/home.mjs. In short: app/ is replaced and the app
// it replaces is kept as app.previous/ (one generation, for --rollback); data/ (blumodel.db,
// uploads/, backups/), logs/ and blumodel.env are kept; on Windows the supervisor scripts are
// rewritten. A home from before the rename has data\mise.db and mise.env: the deploy backs the
// database up and renames it (with its -wal and -shm) to blumodel.db, and renames mise.env to
// blumodel.env without opening it (scripts/migrate-home.mjs does both when moving the old folder).
// A home with no settings file at all gets a blumodel.env TEMPLATE (keys present, secrets empty,
// payments off), readable only by the current Windows account, or on Linux mode 600 for 'blumodel'.
//
// Stopping the running server. Windows: it is asked to shut down gracefully through
// shutdown.request (it finishes open requests, checkpoints the database and exits), then its
// supervisor is ended so the new run-server.cmd starts fresh. Only processes whose command line
// runs THIS home's server or supervisor are touched; the tunnel keeps running through a deploy.
// Linux: systemctl stop (SIGTERM, the same graceful shutdown).
//
// Starting it again. Windows: unless a "stopped" file says it was stopped on purpose; through the
// BluModelStudioServer task when register-tasks --at-startup registered it (so it outlives your
// sign-out), else with wscript. Linux: when blumodel-studio.service is enabled.
// Then it waits for http://127.0.0.1:<port>/api/health. Exit codes: 0 healthy; 1 refused or failed
// before anything changed (the old app runs as before); 3 the new app is in place but unhealthy
// (scripts/host/update.mjs then runs --rollback).
//
// This script never creates, changes or deletes a scheduled task or a systemd unit
// (scripts/register-tasks.mjs does).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  SERVER_TASK,
  SERVER_UNIT,
  SERVICE_USER,
  createSettingsTemplate,
  defaultHome,
  deployBackupDirs,
  giveToServiceUser,
  homeLayout,
  homeProcesses,
  isRoot,
  readStartupTasks,
  serverScripts,
  settingsTemplate,
  sys32,
  userIds,
} from '../server/ops/home.mjs';
import { homePort } from '../server/ops/homePort.mjs';
import { EXIT, listening, readDeployed, rollbackApp, stageApp, swapInApp, unitState, waitForHealth } from './host/lib.mjs';

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
const opt = (flag) => (argv.indexOf(flag) >= 0 ? argv[argv.indexOf(flag) + 1] : null);
const valued = ['--dist', '--commit', '--health-timeout'];
const unknown = argv.filter((a, i) => a.startsWith('--') && !['--rollback', ...valued].includes(a) && !valued.includes(argv[i - 1]));
if (unknown.length) {
  console.error(`Unknown option ${unknown.join(' ')}. Usage: node scripts/deploy-local.mjs [--dist <dir>] [--commit <sha>] [--health-timeout 60] | --rollback`);
  process.exit(EXIT.USAGE);
}
const ROLLBACK = argv.includes('--rollback');
const distArg = opt('--dist');

const WIN = process.platform === 'win32';
const LINUX = process.platform === 'linux';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(ROOT, distArg || 'dist');
const L = homeLayout(setting('HOME', defaultHome()));
const HOME = L.home;
const PORT = String(setting('PORT', homePort(HOME) ?? '8790'));
const HOST = setting('HOST', '127.0.0.1');
const healthArg = Number(opt('--health-timeout') || 60);
const HEALTH_MS = (Number.isFinite(healthArg) ? Math.max(5, healthArg) : 60) * 1000;
const sep = path.sep;
const rel = (p) => path.relative(HOME, p) || '.';

if (!WIN && !LINUX) {
  console.error(`deploy-local knows the Windows and Linux home servers (this is ${process.platform}). Use \`npm start\` elsewhere.`);
  process.exit(EXIT.REFUSED);
}
if (argv.includes('--dist') && !distArg) {
  console.error('--dist needs a folder (a vite build output with index.html).');
  process.exit(EXIT.USAGE);
}
if (!/^\d{1,5}$/.test(PORT)) {
  console.error(`BLUMODEL_PORT must be a port number (got "${PORT}").`);
  process.exit(EXIT.USAGE);
}
if (!ROLLBACK && (!fs.existsSync(path.join(DIST, 'index.html')) || !fs.existsSync(path.join(ROOT, 'server', 'generated', 'export-kit.mjs')))) {
  console.error(`No build found in ${DIST}. Run \`npm run build\` (or node scripts/host/build.mjs) first, or use \`npm run deploy:local\`.`);
  process.exit(EXIT.REFUSED);
}
for (const old of ['BLUMODEL_DEMO_PAYMENTS', 'MISE_DEMO_PAYMENTS']) {
  if (process.env[old]) console.warn(`${old} is no longer used by the deploy: set DEMO_PAYMENTS in ${L.settings} instead.`);
}
if (LINUX) {
  if (!isRoot()) {
    console.error(`On Linux the deploy stops and starts ${SERVER_UNIT}: run it with sudo (sudo node scripts/deploy-local.mjs ...).`);
    process.exit(EXIT.REFUSED);
  }
  try {
    userIds(SERVICE_USER);
  } catch {
    console.error(`There is no '${SERVICE_USER}' account: run scripts/host/install-linux.sh first (it creates the account and the home).`);
    process.exit(EXIT.REFUSED);
  }
  if (!unitState(SERVER_UNIT).installed) {
    console.error(`${SERVER_UNIT} is not installed: sudo node scripts/register-tasks.mjs --home ${HOME} (docs/HOSTING.md).`);
    process.exit(EXIT.REFUSED);
  }
}
if (ROLLBACK && !fs.existsSync(L.appPrevious)) {
  console.error(`Nothing to roll back to: ${L.appPrevious} does not exist (a deploy keeps the app it replaces there).`);
  process.exit(EXIT.REFUSED);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Windows: PIDs listening on PORT. */
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
const portBusy = async () => (WIN ? listeners().length > 0 : await listening(Number(PORT)));

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
 * Stops this home's server (Windows: gracefully when its supervisor gave it a shutdown file, then
 * its supervisor; Linux: systemctl stop). Returns whether anything was stopped.
 */
async function stopServer() {
  if (LINUX) {
    if (!unitState(SERVER_UNIT).active) return false;
    execFileSync('systemctl', ['stop', SERVER_UNIT], { stdio: 'inherit' });
    console.log(`Stopped ${SERVER_UNIT}.`);
    return true;
  }
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
  return servers.length + supervisors.length > 0;
}

/** Starts the server unless it was stopped on purpose. Returns false (with the reason printed) when it was left stopped. */
function startServer() {
  if (LINUX) {
    if (!unitState(SERVER_UNIT).enabled) {
      console.log(`${SERVER_UNIT} is disabled, so it was left stopped. Start it with: sudo systemctl enable --now ${SERVER_UNIT}`);
      return false;
    }
    execFileSync('systemctl', ['start', SERVER_UNIT], { stdio: 'inherit' });
    return true;
  }
  if (fs.existsSync(L.stopped)) {
    console.log('The server is stopped on purpose (a "stopped" file is in the folder). Run start-server.cmd to start it.');
    return false;
  }
  if (readStartupTasks(HOME).has(SERVER_TASK)) {
    // Registered to run at startup: start it through Task Scheduler so it doesn't end with this sign-in session.
    try {
      execFileSync(sys32('schtasks.exe'), ['/Run', '/TN', SERVER_TASK], { stdio: 'ignore', windowsHide: true });
      return true;
    } catch {
      console.warn(`schtasks /Run /TN ${SERVER_TASK} failed; starting the supervisor directly (it ends when you sign out).`);
    }
  }
  spawn(sys32('wscript.exe'), [L.startHidden], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  return true;
}

/** Waits for /api/health and prints the outcome. */
async function healthy() {
  const h = await waitForHealth({ port: Number(PORT), timeoutMs: HEALTH_MS });
  const logs = LINUX ? `${L.serverLog} and journalctl -u ${SERVER_UNIT}` : `${L.serverLog} and ${path.join(L.logs, 'console.log')}`;
  if (h.ok) console.log(`BluModel Studio ${h.body?.version ?? ''} is up at http://127.0.0.1:${PORT} (payments: ${h.payments}). Its log: ${L.serverLog}`);
  else if (h.status === 503) console.error(`The server started but reports a problem: ${JSON.stringify(h.body)}. Check ${logs}.`);
  else console.error(`The server did not answer on port ${PORT} within ${HEALTH_MS / 1000} s. Check ${logs}.`);
  return h.ok;
}

/** Linux: data/ and logs/ must exist (the unit's ReadWritePaths) and belong to the server's account. */
function ensureDir(dir) {
  if (fs.existsSync(dir)) return;
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  if (LINUX) giveToServiceUser(dir);
}

function commitOf() {
  if (opt('--commit')) return String(opt('--commit')).trim();
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown'; // not a git checkout, or (as root) one owned by another account: pass --commit
  }
}

// ─── Rollback ──────────────────────────────────────────────────────────────

if (ROLLBACK) {
  const failed = readDeployed(L.app);
  const back = readDeployed(L.appPrevious);
  if (WIN) fs.writeFileSync(L.deploying, new Date().toISOString());
  let stopped = false;
  try {
    stopped = await stopServer();
    rollbackApp(L);
  } catch (err) {
    console.error(`Could not roll back (${err?.code ?? err?.message}): something may have a file in ${L.app} or ${L.appPrevious} open. Nothing was swapped.`);
    if (WIN) fs.rmSync(L.deploying, { force: true });
    if (stopped) startServer();
    process.exit(EXIT.REFUSED);
  } finally {
    if (WIN) fs.rmSync(L.deploying, { force: true });
  }
  console.log(`Rolled back: ${rel(L.app)}${sep} is commit ${back?.commit ?? '?'} again; commit ${failed?.commit ?? '?'} is kept in ${rel(L.appFailed)}${sep}.`);
  const last = deployBackupDirs(L.backups).at(-1);
  if (last) {
    const from = path.join(L.backups, last, 'blumodel.db');
    console.log('The database was not touched. If the version you left ran a migration this one cannot read, restore the copy made before that deploy:');
    if (WIN) for (const line of [`cd "${HOME}"`, 'stop-server.cmd', `node app\\server\\scripts\\restore.mjs --from "${from}"`, 'start-server.cmd']) console.log(`  ${line}`);
    else for (const line of [`sudo systemctl stop ${SERVER_UNIT}`, `sudo -u ${SERVICE_USER} node ${path.join(L.app, 'server', 'scripts', 'restore.mjs')} --from ${from}`, `sudo systemctl start ${SERVER_UNIT}`]) console.log(`  ${line}`);
    console.log('  Anything written since that copy is lost, so do that only if this version will not start.');
  }
  if (!startServer()) process.exit(EXIT.OK);
  process.exit((await healthy()) ? EXIT.OK : EXIT.UNHEALTHY);
}

// ─── Deploy ────────────────────────────────────────────────────────────────

ensureDir(L.data);
ensureDir(L.logs);
if (WIN) fs.writeFileSync(L.deploying, new Date().toISOString());
let settingsNote = '';
let swapped = false;
let stoppedSomething = false;
try {
  stoppedSomething = await stopServer();
  // A process just ended can take a moment to release its socket.
  for (let i = 0; i < 20 && stoppedSomething && (await portBusy()); i++) await sleep(250);
  if (await portBusy()) {
    console.error(`Port ${PORT} is in use by something other than this BluModel Studio install. Set BLUMODEL_PORT to a free port.`);
    throw Object.assign(new Error('port in use'), { refused: true });
  }

  // Back up the database before new code (and its migrations) opens it. The server is stopped, so
  // the copy (with its WAL files) is consistent.
  const legacyOnly = !fs.existsSync(L.db) && fs.existsSync(L.legacyDb);
  const db = legacyOnly ? L.legacyDb : L.db;
  if (fs.existsSync(db)) {
    const dir = path.join(L.backups, new Date().toISOString().replace(/[:.]/g, '-'));
    const newBackups = !fs.existsSync(L.backups);
    fs.mkdirSync(dir, { recursive: true });
    const name = path.basename(db);
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(db + ext)) fs.copyFileSync(db + ext, path.join(dir, `${name}${ext}`));
    // Copied by root: the server's account (and restore.mjs, run as it) must be able to read them.
    if (LINUX) giveToServiceUser(newBackups ? L.backups : dir);
    // Keep the last 5 pre-deploy copies; the server's daily/ backups and uploads-mirror/ are not touched.
    for (const old of deployBackupDirs(L.backups).slice(0, -5)) fs.rmSync(path.join(L.backups, old), { recursive: true, force: true });
    console.log(`Backed up the database to ${dir}`);
  }
  if (legacyOnly) {
    // A home from before the rename: the database keeps its data under the new name. The WAL and
    // shared-memory files move with it, so nothing committed is left behind.
    for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(L.legacyDb + ext)) fs.renameSync(L.legacyDb + ext, L.db + ext);
    console.log(`Renamed ${rel(L.legacyDb)} to ${rel(L.db)} (the backup above has the original).`);
  } else if (fs.existsSync(L.db) && fs.existsSync(L.legacyDb)) {
    console.warn(`Both ${rel(L.db)} and ${rel(L.legacyDb)} exist. The server uses blumodel.db; mise.db is left alone.`);
  }

  // Private settings: existence checks and a rename only. Their contents are never read here.
  if (fs.existsSync(L.settings)) {
    settingsNote = `The server reads its private settings from ${L.settings}.`;
    if (fs.existsSync(L.legacySettings)) console.warn(`Both blumodel.env and mise.env are in ${HOME}. The server reads blumodel.env only; delete mise.env once you are sure it holds nothing you need.`);
  } else if (fs.existsSync(L.legacySettings)) {
    fs.renameSync(L.legacySettings, L.settings);
    settingsNote = `Renamed mise.env to blumodel.env (not opened). The server reads its private settings from ${L.settings}.`;
  } else {
    const adminEmails = String(process.env.BLUMODEL_ADMIN_EMAILS || '').trim();
    const r = createSettingsTemplate(L.settings, { text: settingsTemplate({ adminEmails }) });
    if (r.created) {
      settingsNote =
        `Created a settings TEMPLATE at ${L.settings} (keys present, Stripe values empty, payments off)` +
        (r.restrictedTo ? `, readable only by ${r.restrictedTo}.` : `. Could not restrict who can read it (${r.restrictError}).`) +
        ' Fill it in per docs/LAUNCH.md (docs/HOSTING.md on a new machine), then restart the server.';
    } else {
      settingsNote = `The server reads its private settings from ${L.settings}.`;
    }
  }

  const commit = commitOf();
  stageApp({ root: ROOT, dist: DIST, staging: L.appNew, commit });
  try {
    const { kept } = swapInApp(L);
    swapped = true;
    if (kept) console.log(`Kept the app it replaced in ${rel(L.appPrevious)}${sep} (node scripts/deploy-local.mjs --rollback puts it back).`);
  } catch (err) {
    console.error(`Could not put the new app in place (${err?.code ?? err?.message}): something has a file in ${L.app} open. The old app is unchanged.`);
    throw Object.assign(err, { refused: true });
  }
  if (WIN) for (const [name, body] of Object.entries(serverScripts({ node: process.execPath, port: PORT, host: HOST }))) fs.writeFileSync(path.join(HOME, name), body);
  console.log(`Deployed commit ${commit} to ${L.app}`);
  console.log(settingsNote);
  if (!fs.existsSync(L.tunnelConfig)) console.log(`No tunnel set up in ${HOME} yet: node scripts/tunnel/setup-tunnel.mjs (docs/HOSTING.md).`);
} catch (err) {
  if (!err?.refused) throw err;
  process.exitCode = EXIT.REFUSED;
} finally {
  if (WIN) fs.rmSync(L.deploying, { force: true });
}
if (process.exitCode === EXIT.REFUSED) {
  // Nothing changed: start the old app again if this run stopped it.
  if (stoppedSomething && !swapped) {
    console.log('Starting the app that was running before.');
    startServer();
  }
  process.exit(EXIT.REFUSED);
}

if (!startServer()) process.exit(EXIT.OK);
process.exitCode = (await healthy()) ? EXIT.OK : EXIT.UNHEALTHY;
if (process.exitCode === EXIT.UNHEALTHY) console.error('The new app is in place but unhealthy. To go back to the previous one: node scripts/deploy-local.mjs --rollback (scripts/host/update.mjs does that by itself).');
