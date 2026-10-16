// Registers what starts the home server and its tunnel with the machine. It never starts anything.
//
// WINDOWS: two scheduled tasks, both run with no window:
//   BluModelStudioServer  wscript.exe "<home>\start-hidden.vbs"  (the server's restarting supervisor)
//   BluModelTunnel        wscript.exe "<home>\start-tunnel.vbs"  (the Cloudflare tunnel's supervisor)
// By default at your logon with your interactive token (the original PC: someone signs in). With
// --at-startup they run when Windows starts, whether or not anyone signs in (a machine nobody logs
// on to, e.g. a Dell Wyse): Windows must store the account's password for that, so schtasks asks
// you for it (this passes /RP *, never a password), and registering a startup task needs an
// elevated (Run as administrator) PowerShell. It then lists the task in <home>\startup-tasks, so
// start-server.cmd, start-tunnel.cmd and the deploy start it through Task Scheduler and it keeps
// running after you sign out. No time limit, runs on battery, one instance at a time.
//
//   node scripts/register-tasks.mjs --dry-run                 # print the definitions and commands; change nothing
//   node scripts/register-tasks.mjs                           # register (replaces tasks of the same name)
//   options: --home <dir> (default %USERPROFILE%\Projects\BluModelStudio)
//            --only server|tunnel     one of the two
//            --at-startup             when Windows starts instead of at logon
//            --delete-old             also delete the MiseKitchenServer task from before the rename
//            --user <DOMAIN\name>     the account (default: whoami)
// Without --dry-run it refuses when a launcher it would point at doesn't exist yet (deploy first:
// npm run deploy:local; then node scripts/tunnel/setup-tunnel.mjs).
//
// LINUX (run with sudo): two systemd units in /etc/systemd/system (server/ops/home.mjs):
//   blumodel-studio.service   node <home>/app/server/index.mjs --prod as 'blumodel'; ENABLED, so it
//                             starts at boot (the next deploy starts it now)
//   blumodel-tunnel.service   cloudflared with <home>/cloudflared.yml as 'blumodel'; installed but
//                             left DISABLED unless --enable-tunnel: enable it only at the cutover
//                             (docs/HOSTING.md), so two machines never serve the tunnel at once.
//   sudo node scripts/register-tasks.mjs --dry-run            # print the units and the systemctl commands
//   sudo node scripts/register-tasks.mjs                      # write them, daemon-reload, enable the server
//   options: --home <dir> (default /srv/blumodel-studio)  --only server|tunnel  --enable-tunnel
//            --user blumodel  --port 8790  --node <path> (default: this node)  --cloudflared <path>
//
// Both: --platform win32|linux with --dry-run shows what it would do on the other platform.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  DEFAULT_PORT,
  LEGACY_TASK,
  POWERSHELL,
  SERVER_UNIT,
  SERVICE_USER,
  TUNNEL_UNIT,
  currentAccount,
  defaultHome,
  homeLayout,
  homeTasks,
  isRoot,
  readStartupTasks,
  sys32,
  systemdInstallPlan,
  systemdUnits,
  writeStartupTasks,
} from '../server/ops/home.mjs';
import { homePort } from '../server/ops/homePort.mjs';
import { CLOUDFLARED_LINUX, findCloudflared } from './tunnel/tunnel.mjs';

const argv = process.argv.slice(2);
const opt = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const valued = ['--home', '--only', '--user', '--platform', '--port', '--node', '--cloudflared'];
const known = new Set(['--dry-run', '--delete-old', '--at-startup', '--enable-tunnel', ...valued]);
const bad = argv.filter((a, i) => a.startsWith('--') && !known.has(a) && !valued.includes(argv[i - 1]));
const usage =
  'Usage: node scripts/register-tasks.mjs [--dry-run] [--home <dir>] [--only server|tunnel] [--user <account>]\n' +
  '         Windows: [--at-startup] [--delete-old]   Linux (sudo): [--enable-tunnel] [--port 8790] [--node <path>] [--cloudflared <path>]';
if (bad.length) {
  console.error(`Unknown option ${bad.join(' ')}.\n${usage}`);
  process.exit(2);
}
const dryRun = argv.includes('--dry-run');
const platform = opt('--platform') || process.platform;
if (platform !== process.platform && !dryRun) {
  console.error('--platform only works with --dry-run (it shows what would be done on another platform).');
  process.exit(2);
}
const only = opt('--only');
if (only && !['server', 'tunnel'].includes(only)) {
  console.error('--only takes server or tunnel.');
  process.exit(2);
}

if (platform === 'linux') {
  // ── Linux: systemd units ────────────────────────────────────────────────
  for (const f of ['--at-startup', '--delete-old']) if (argv.includes(f)) console.warn(`${f} is for Windows; systemd units always start at boot.`);
  const home = path.posix.resolve(opt('--home') || defaultHome(undefined, 'linux'));
  const user = opt('--user') || SERVICE_USER;
  const port = opt('--port') || DEFAULT_PORT;
  const node = opt('--node') || (process.platform === 'linux' ? process.execPath : '/usr/bin/node');
  const cloudflared = opt('--cloudflared') || (process.platform === 'linux' ? findCloudflared({ platform: 'linux' }) : null) || CLOUDFLARED_LINUX[0];
  let units;
  try {
    units = systemdUnits({ home, node, cloudflared, user, port });
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const plan = systemdInstallPlan({ units, only, enableTunnel: argv.includes('--enable-tunnel') });
  if (!dryRun && !isRoot()) {
    console.error('Writing systemd units needs root: sudo node scripts/register-tasks.mjs ...');
    process.exit(1);
  }
  const L = homeLayout(home, 'linux');
  for (const w of plan.writes) {
    console.log(`${dryRun ? 'would write' : 'writing'} ${w.file}`);
    if (dryRun) console.log(w.text.replace(/^/gm, '    '));
    else fs.writeFileSync(w.file, w.text, { mode: 0o644 });
  }
  for (const c of plan.commands) {
    console.log(`${dryRun ? 'would run' : 'running'}: ${c.join(' ')}`);
    if (!dryRun) execFileSync(c[0], c.slice(1), { stdio: 'inherit' });
  }
  const names = plan.writes.map((w) => path.posix.basename(w.file));
  if (names.includes(SERVER_UNIT)) {
    console.log(`${SERVER_UNIT} starts at boot. ${fs.existsSync(L.serverEntry) ? `Start it now: sudo systemctl start ${SERVER_UNIT}` : `There is no app in ${L.app} yet: the deploy (sudo node scripts/deploy-local.mjs) puts it there and starts it.`}`);
  }
  if (names.includes(TUNNEL_UNIT)) {
    if (argv.includes('--enable-tunnel')) console.log(`${TUNNEL_UNIT} is enabled (starts at boot). Start it now: sudo systemctl start ${TUNNEL_UNIT}`);
    else console.log(`${TUNNEL_UNIT} is installed but NOT enabled. At the cutover (docs/HOSTING.md), once the other machine's tunnel is stopped: sudo systemctl enable --now ${TUNNEL_UNIT}`);
  }
  if (dryRun) console.log('Dry run: no unit was written, enabled or started.');
  process.exit(0);
}

if (platform !== 'win32') {
  console.error(`register-tasks knows Windows (scheduled tasks) and Linux (systemd); this is ${platform}.`);
  process.exit(1);
}

// ── Windows: scheduled tasks ──────────────────────────────────────────────
const atStartup = argv.includes('--at-startup');
for (const f of ['--enable-tunnel', '--port', '--node', '--cloudflared']) if (argv.includes(f)) console.warn(`${f} is for Linux; ignored.`);
const home = path.win32.resolve(opt('--home') || defaultHome(undefined, 'win32'));
const user = opt('--user') || (process.platform === 'win32' ? currentAccount() : `${os.hostname().toUpperCase()}\\you`);

const tasks = homeTasks(home, user, { atStartup, port: homePort(home, { platform: 'win32' }) ?? DEFAULT_PORT }).filter((t) => !only || (only === 'server' ? /Server$/.test(t.name) : /Tunnel$/.test(t.name)));
const canCheck = process.platform === 'win32';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-tasks-'));
let failed = false;
const registered = [];
try {
  for (const t of tasks) {
    // schtasks reads the definition as UTF-16 with a byte-order mark.
    const file = path.join(dir, `${t.name}.xml`);
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t.xml.replace(/\r?\n/g, '\r\n'), 'utf16le')]));
    // Parse it (read-only) so a malformed definition is caught before Task Scheduler sees it.
    if (canCheck) execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', `[void][xml](Get-Content -Raw -Encoding Unicode -LiteralPath '${file.replace(/'/g, "''")}')`], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const launcherOk = canCheck && fs.existsSync(t.launcher);
    const when = atStartup ? `when Windows starts, as ${user} (signed in or not)` : `at logon of ${user}`;
    console.log(`${t.name}: ${when}, runs wscript.exe "${t.launcher}"${launcherOk ? '' : '  (that file does not exist yet)'}`);
    // With --at-startup schtasks stores the account's password: /RP * makes it ask for it.
    const args = ['/Create', '/TN', t.name, '/XML', file, ...(atStartup ? ['/RU', user, '/RP', '*'] : []), '/F'];
    if (dryRun) {
      console.log(`  would run: schtasks ${args.map((a) => (a === file ? '"<the definition below>"' : a)).join(' ')}`);
      console.log(t.xml.replace(/^/gm, '    '));
      continue;
    }
    if (!launcherOk) {
      console.error(`  Not registered: ${t.launcher} is missing. ${/Tunnel$/.test(t.name) ? 'Run node scripts/tunnel/setup-tunnel.mjs first.' : 'Deploy first (npm run deploy:local).'}`);
      failed = true;
      continue;
    }
    if (atStartup) console.log(`  schtasks asks for the password of ${user} next: Windows needs it to start the task when nobody is signed in.`);
    try {
      execFileSync(sys32('schtasks.exe'), args, { stdio: 'inherit', windowsHide: true });
    } catch {
      console.error(`  ${t.name} was not registered.${atStartup ? ' A startup task needs an elevated PowerShell (Run as administrator) and the account password.' : ''}`);
      failed = true;
      continue;
    }
    registered.push(t.name);
    console.log(atStartup ? `  Registered ${t.name}. It runs when Windows starts; start it now with: schtasks /Run /TN ${t.name}` : `  Registered ${t.name}. It runs at your next logon; start it now with: schtasks /Run /TN ${t.name}`);
  }
  // Which of this home's tasks run at startup (start-server.cmd, start-tunnel.cmd and the deploy read it).
  if (!dryRun && registered.length) {
    const now = readStartupTasks(home);
    for (const n of registered) (atStartup ? now.add(n) : now.delete(n));
    writeStartupTasks(home, [...now]);
  } else if (dryRun && atStartup) {
    console.log(`  would list ${tasks.map((t) => t.name).join(', ')} in ${homeLayout(home, 'win32').startupTasks}`);
  }
  if (argv.includes('--delete-old')) {
    if (dryRun) console.log(`would run: schtasks /Delete /TN ${LEGACY_TASK} /F`);
    else {
      try {
        execFileSync(sys32('schtasks.exe'), ['/Delete', '/TN', LEGACY_TASK, '/F'], { stdio: 'inherit', windowsHide: true });
      } catch {
        console.warn(`${LEGACY_TASK} was not deleted (it may not exist).`);
      }
    }
  }
  if (dryRun) console.log('Dry run: no task was created, changed or deleted.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
