// Registers the home server's two scheduled tasks, both run at your logon with no window:
//   BluModelStudioServer  wscript.exe "<home>\start-hidden.vbs"  (the server's restarting supervisor)
//   BluModelTunnel        wscript.exe "<home>\start-tunnel.vbs"  (the Cloudflare tunnel's supervisor)
// Same settings as the old MiseKitchenServer task: your interactive token, no time limit, runs on
// battery, starts late if the logon was missed, one instance at a time.
//
//   node scripts/register-tasks.mjs --dry-run                 # print the definitions and commands; change nothing
//   node scripts/register-tasks.mjs                           # register (replaces tasks of the same name)
//   options: --home <dir> (default %USERPROFILE%\Projects\BluModelStudio)
//            --only server|tunnel     one of the two
//            --delete-old             also delete the MiseKitchenServer task from before the rename
//            --user <DOMAIN\name>     the account (default: whoami)
//
// It never starts a task. Without --dry-run it refuses when a launcher it would point at doesn't
// exist yet (deploy first: npm run deploy:local; then node scripts/tunnel/setup-tunnel.mjs).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { LEGACY_TASK, POWERSHELL, currentAccount, defaultHome, homeTasks, sys32 } from '../server/ops/home.mjs';

const argv = process.argv.slice(2);
const opt = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const known = new Set(['--dry-run', '--home', '--only', '--delete-old', '--user']);
const bad = argv.filter((a, i) => a.startsWith('--') && !known.has(a) && !['--home', '--only', '--user'].includes(argv[i - 1]));
if (bad.length) {
  console.error(`Unknown option ${bad.join(' ')}. Usage: node scripts/register-tasks.mjs [--dry-run] [--home <dir>] [--only server|tunnel] [--delete-old] [--user <DOMAIN\\name>]`);
  process.exit(2);
}
if (process.platform !== 'win32') {
  console.error('register-tasks is written for the Windows home server.');
  process.exit(1);
}
const dryRun = argv.includes('--dry-run');
const home = path.resolve(opt('--home') || defaultHome());
const only = opt('--only');
if (only && !['server', 'tunnel'].includes(only)) {
  console.error('--only takes server or tunnel.');
  process.exit(2);
}
const user = opt('--user') || currentAccount();

const tasks = homeTasks(home, user).filter((t) => !only || (only === 'server' ? /Server$/.test(t.name) : /Tunnel$/.test(t.name)));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-tasks-'));
let failed = false;
try {
  for (const t of tasks) {
    // schtasks reads the definition as UTF-16 with a byte-order mark.
    const file = path.join(dir, `${t.name}.xml`);
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t.xml.replace(/\r?\n/g, '\r\n'), 'utf16le')]));
    // Parse it (read-only) so a malformed definition is caught before Task Scheduler sees it.
    execFileSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', `[void][xml](Get-Content -Raw -Encoding Unicode -LiteralPath '${file.replace(/'/g, "''")}')`], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const launcherOk = fs.existsSync(t.launcher);
    console.log(`${t.name}: at logon of ${user}, runs wscript.exe "${t.launcher}"${launcherOk ? '' : '  (that file does not exist yet)'}`);
    if (dryRun) {
      console.log(`  would run: schtasks /Create /TN ${t.name} /XML "<the definition below>" /F`);
      console.log(t.xml.replace(/^/gm, '    '));
      continue;
    }
    if (!launcherOk) {
      console.error(`  Not registered: ${t.launcher} is missing. ${/Tunnel$/.test(t.name) ? 'Run node scripts/tunnel/setup-tunnel.mjs first.' : 'Deploy first (npm run deploy:local).'}`);
      failed = true;
      continue;
    }
    execFileSync(sys32('schtasks.exe'), ['/Create', '/TN', t.name, '/XML', file, '/F'], { stdio: 'inherit', windowsHide: true });
    console.log(`  Registered ${t.name}. It runs at your next logon; start it now with: schtasks /Run /TN ${t.name}`);
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
