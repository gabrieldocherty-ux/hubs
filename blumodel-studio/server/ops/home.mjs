// The home server's folder: its layout, the supervisor scripts written into it, the private
// settings template, and what starts it when the machine does. Shared by scripts/deploy-local.mjs,
// scripts/migrate-home.mjs, scripts/register-tasks.mjs, scripts/tunnel/setup-tunnel.mjs and
// scripts/host/*; tested in server/test/home.test.mjs and server/test/host.test.mjs.
//
// Two platforms (docs/HOSTING.md):
//   Windows  %USERPROFILE%\Projects\BluModelStudio, run by .cmd/.vbs supervisors that Task Scheduler
//            starts at logon (the original PC) or at startup (register-tasks --at-startup, for a
//            machine nobody logs on to).
//   Linux    /srv/blumodel-studio, owned by the 'blumodel' system user and run by two systemd units
//            (blumodel-studio.service and blumodel-tunnel.service) that start at boot.
// BLUMODEL_HOME / --home moves it on either. Nothing here assumes a user name or a drive letter.
//
// Pure functions plus small file helpers. Nothing here starts, stops or registers anything, and
// nothing here ever opens blumodel.env or mise.env: only whether they exist, a rename, or a
// permission change (icacls and chmod/chown never read a file's contents).
//
// Layout of a home (Windows separators shown; the same names with / on Linux):
//   app\                 the deployed code (dist\, server\, src\data\*.json), replaced by each deploy
//   app.previous\        the code the last deploy replaced, for a rollback (deploy-local --rollback)
//   repo\                (a machine set up by scripts/host/install-*) the sparse git checkout that
//                        builds come from; on the original PC the repo lives elsewhere
//   data\blumodel.db     the database (+ -wal / -shm). A home from before the rename has mise.db.
//   data\uploads\        uploaded models and images
//   data\backups\        daily\ (the server's own VACUUM INTO copies, 14 kept), uploads-mirror\,
//                        and <timestamp>\ folders: the deploy's copy from before each deploy (5 kept)
//   logs\                server.log (the server's own, rotated by size), console.log (anything the
//                        server printed before its log was open; rotated at each start),
//                        tunnel.log (cloudflared; rotated at each tunnel start)
//   blumodel.env         private settings, KEY=VALUE (server/lib/envFile.mjs). Never read by any
//                        script; a deploy only creates a template when there is none (Windows: only
//                        your account may read it; Linux: mode 600, owned by 'blumodel').
//   cloudflared.yml      the Cloudflare tunnel's config (scripts/tunnel/setup-tunnel.mjs)
//   .cloudflared/        (Linux) the tunnel's credentials JSON, copied there by hand
//   Windows only:
//   run-server.cmd       supervisor: runs the server, restarts it when it exits
//   start-hidden.vbs     starts run-server.cmd with no window (the BluModelStudioServer task runs it)
//   start-server.cmd / stop-server.cmd
//   run-tunnel.cmd, start-tunnel.vbs, start-tunnel.cmd, stop-tunnel.cmd
//                        the tunnel's supervisor (BluModelTunnel task)
//   startup-tasks        the tasks register-tasks --at-startup registered for this home, one per
//                        line: start-server.cmd, start-tunnel.cmd and the deploy start those through
//                        Task Scheduler, so what they start keeps running after you sign out
//   stopped / tunnel.stopped / deploying / shutdown.request
//                        markers: stopped on purpose, a deploy in progress, "please shut down"

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ENV_FILE_KEYS } from '../lib/envFile.mjs';

const SYSTEM32 = path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32');
/**
 * A Windows tool by its full System32 path (whoami.exe, icacls.exe, netstat.exe, taskkill.exe,
 * schtasks.exe, where.exe), so a same-named program earlier on PATH (Git Bash ships a whoami) can't
 * stand in for it. Elsewhere, the bare name.
 */
export const sys32 = (exe) => (process.platform === 'win32' ? path.join(SYSTEM32, exe) : exe);
export const POWERSHELL = process.platform === 'win32' ? path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'pwsh';

/** DOMAIN\name of the current Windows account (whoami.exe). */
export const currentAccount = ({ exec = execFileSync } = {}) => String(exec(sys32('whoami.exe'), [], { encoding: 'utf8', windowsHide: true })).trim();

export const DEFAULT_PORT = 8790;
export const DEFAULT_HOST = '127.0.0.1';
export const SERVER_TASK = 'BluModelStudioServer';
export const TUNNEL_TASK = 'BluModelTunnel';
/** The scheduled task from before the rename (it starts C:\Users\<you>\Projects\Mise\start-hidden.vbs). */
export const LEGACY_TASK = 'MiseKitchenServer';
export const PUBLIC_URL = 'https://blumodel.studio';

/** Linux: the default home, the system account that owns it and runs the server, and the units. */
export const LINUX_HOME = '/srv/blumodel-studio';
export const SERVICE_USER = 'blumodel';
/** The tunnel's own account: it reads its config and credentials, never the database or the settings. */
export const TUNNEL_USER = 'blumodel-tunnel';
export const SERVER_UNIT = 'blumodel-studio.service';
export const TUNNEL_UNIT = 'blumodel-tunnel.service';
export const SYSTEMD_DIR = '/etc/systemd/system';
/** Automatic updates (scripts/host/autoupdate.mjs): the oneshot service, its daily timer and the Update now watcher. */
export const UPDATE_UNIT = 'blumodel-update.service';
export const UPDATE_TIMER = 'blumodel-update.timer';
export const UPDATE_PATH_UNIT = 'blumodel-update.path';
/** Windows: the daily update and the two-minute check for Update now (a no-op without its trigger file). */
export const UPDATE_TASK = 'BluModelStudioUpdate';
export const UPDATE_NOW_TASK = 'BluModelStudioUpdateNow';
/** When the daily update runs unless AUTO_UPDATE_TIME / --auto-update-time says otherwise (the quietest hour). */
export const DEFAULT_UPDATE_TIME = '04:00';
/**
 * The server's V8 heap cap on Linux (node --max-old-space-size), in MB. The server idles at about
 * 60-80 MB RSS and stays near 100-150 MB under the full QA run (docs/HOSTING.md, "Disk and memory"),
 * so 384 MB is generous; MemoryHigh / MemoryMax in the unit leave room above it for native memory
 * (SQLite's cache, buffers) and stop a leak from taking the whole 4 GB machine.
 */
export const DEFAULT_HEAP_MB = 384;
/**
 * Where a machine gets the code, and the branch it deploys. The repo is PRIVATE: the install scripts
 * clone it over SSH with a read-only deploy key (docs/HOSTING.md, "The deploy key"); --repo / -Repo
 * gives another address.
 */
export const REPO_URL = 'git@github.com:gabrieldocherty-ux/hubs.git';
/**
 * GitHub's published ed25519 SSH host key (docs.github.com, "GitHub's SSH key fingerprints":
 * SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU). The installers pin it in the home's
 * .ssh/known_hosts instead of trusting whatever answers the first time.
 */
export const GITHUB_HOST_KEY = 'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl';

/**
 * The checkout's core.sshCommand: the home's deploy key and pinned known_hosts, nothing else (no
 * agent keys, no prompt for an unknown host). Forward slashes, so Git for Windows' ssh reads it too.
 * @param {string} home
 */
export function deploySshCommand(home) {
  const h = String(home).replace(/\\/g, '/').replace(/\/$/, '');
  if (/[\s"']/.test(h)) throw new Error(`The home's path can't have spaces or quotes for ssh: ${home}`);
  return `ssh -i ${h}/.ssh/id_ed25519 -o IdentitiesOnly=yes -o UserKnownHostsFile=${h}/.ssh/known_hosts -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519`;
}
export const DEPLOY_BRANCH = 'blumodel-studio';

/** Path functions for `platform`'s paths, whatever this machine is (tests make Linux files on Windows). */
export const pathFor = (platform = process.platform) => (platform === 'win32' ? path.win32 : path.posix);

/**
 * Where a home is unless BLUMODEL_HOME / --home says otherwise: %USERPROFILE%\Projects\BluModelStudio
 * on Windows (how the original PC is set up), /srv/blumodel-studio everywhere else.
 */
export const defaultHome = (homedir = os.homedir(), platform = process.platform) =>
  platform === 'win32' ? path.win32.join(homedir, 'Projects', 'BluModelStudio') : LINUX_HOME;
/** %USERPROFILE%\Projects\Mise: the home from before the rename (Windows only). */
export const legacyHome = (homedir = os.homedir()) => path.join(homedir, 'Projects', 'Mise');

/** Every path in a home (see the top of this file), with `platform`'s separators. */
export function homeLayout(home, platform = process.platform) {
  const p = pathFor(platform);
  const h = p.resolve(home);
  const data = p.join(h, 'data');
  return {
    home: h,
    app: p.join(h, 'app'),
    appNew: p.join(h, 'app.new'),
    appPrevious: p.join(h, 'app.previous'),
    appFailed: p.join(h, 'app.failed'),
    deployedInfo: p.join(h, 'app', 'DEPLOYED.txt'),
    serverEntry: p.join(h, 'app', 'server', 'index.mjs'),
    repo: p.join(h, 'repo'),
    data,
    db: p.join(data, 'blumodel.db'),
    legacyDb: p.join(data, 'mise.db'),
    uploads: p.join(data, 'uploads'),
    backups: p.join(data, 'backups'),
    logs: p.join(h, 'logs'),
    serverLog: p.join(h, 'logs', 'server.log'),
    settings: p.join(h, 'blumodel.env'),
    legacySettings: p.join(h, 'mise.env'),
    runServer: p.join(h, 'run-server.cmd'),
    startHidden: p.join(h, 'start-hidden.vbs'),
    stopped: p.join(h, 'stopped'),
    deploying: p.join(h, 'deploying'),
    shutdownFile: p.join(h, 'shutdown.request'),
    startupTasks: p.join(h, 'startup-tasks'),
    tunnelConfig: p.join(h, 'cloudflared.yml'),
    cloudflaredDir: p.join(h, '.cloudflared'),
    runTunnel: p.join(h, 'run-tunnel.cmd'),
    startTunnel: p.join(h, 'start-tunnel.vbs'),
    tunnelStopped: p.join(h, 'tunnel.stopped'),
    // Automatic updates (scripts/host/autoupdate.mjs has the rest of its files, all in logs/).
    autoUpdateConf: p.join(h, 'auto-update.conf'),
    updateTrigger: p.join(h, 'logs', 'update-now.request'),
    updateStatus: p.join(h, 'logs', 'update-status.json'),
    updateLauncher: p.join(h, 'update-hidden.vbs'),
    updateScript: p.join(h, 'repo', 'blumodel-studio', 'scripts', 'host', 'update.mjs'),
  };
}

/** Windows line ends for .cmd / .vbs files. */
export const crlf = (s) => s.replace(/\r?\n/g, '\r\n');
/** The platform's line ends for a text file a person may open (the settings template). */
export const eol = (s, platform = process.platform) => (platform === 'win32' ? crlf(s) : s.replace(/\r\n/g, '\n'));

/**
 * The tasks `register-tasks --at-startup` registered for this home (the startup-tasks file, one
 * name a line). Empty when there is none: tasks run at logon, or this isn't a Windows home.
 * @param {string} home
 * @returns {Set<string>}
 */
export function readStartupTasks(home) {
  try {
    return new Set(fs.readFileSync(homeLayout(home).startupTasks, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/** Writes the startup-tasks file (CRLF, for findstr in the .cmd scripts); removes it when `names` is empty. */
export function writeStartupTasks(home, names) {
  const file = homeLayout(home).startupTasks;
  const list = [...new Set(names)].filter(Boolean).sort();
  if (!list.length) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, crlf(`${list.join('\n')}\n`));
}

/**
 * Variables run-server.cmd clears before it starts the server, so the private settings come from
 * blumodel.env alone: a stray user or system variable (an ANTHROPIC_API_KEY set for other work, an
 * old test Stripe key, DEMO_PAYMENTS=1) can't override the file on the public server. The loader's
 * rule "the environment wins over the file" still holds; the supervisor just starts clean.
 * NODE_OPTIONS and NODE_TLS_REJECT_UNAUTHORIZED go too: a NODE_OPTIONS=--inspect (or --require)
 * set for other work would open a debugger or load code into the public server, and
 * NODE_TLS_REJECT_UNAUTHORIZED=0 would stop it checking Stripe's certificate.
 */
export const CLEARED_ENV = Object.freeze([
  ...ENV_FILE_KEYS,
  'PAYMENTS',
  'RATE_LIMITS',
  'NODE_ENV',
  'NODE_OPTIONS',
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'MISE_ENV_FILE',
  'MISE_LLM_MODEL',
  'SEED_PASSWORD',
]);

/**
 * The server's supervisor scripts, keyed by file name (CRLF line ends).
 * run-server.cmd sets PORT, HOST, DB_PATH, BLUMODEL_ENV_FILE=%~dp0blumodel.env, BLUMODEL_LOG_FILE and
 * BLUMODEL_SHUTDOWN_FILE, and never sets DEMO_PAYMENTS: blumodel.env decides it (refused in production
 * unless the file says DEMO_PAYMENTS=1).
 * start-server.cmd starts the server through its scheduled task `task` when the home's startup-tasks
 * file lists it (a machine nobody logs on to), else with wscript directly.
 * The server runs with node --max-old-space-size=<heapMb> (DEFAULT_HEAP_MB, 384): a small machine's
 * memory cap, as the Linux unit has.
 * @param {{ node: string, port?: number | string, host?: string, task?: string, heapMb?: number | string }} o
 */
export function serverScripts({ node, port = DEFAULT_PORT, host = DEFAULT_HOST, task = SERVER_TASK, heapMb = DEFAULT_HEAP_MB }) {
  if (!node) throw new Error('serverScripts needs the node.exe path');
  const P = String(port);
  if (!/^\d{1,5}$/.test(P)) throw new Error(`Not a port: ${P}`);
  if (!/^[\w.:[\]-]+$/.test(host)) throw new Error(`Not a host: ${host}`);
  if (!/^[\w-]+$/.test(task)) throw new Error(`Not a task name: ${task}`);
  const heap = Number(heapMb);
  if (!Number.isInteger(heap) || heap < 128 || heap > 8192) throw new Error(`The heap must be 128-8192 MB (got ${heapMb})`);
  const listening = `netstat -ano -p tcp | findstr /R /C:":${P} .*LISTENING" >nul`;
  const run = `@echo off
rem BluModel Studio home server supervisor: runs the server and restarts it when it exits.
rem Started hidden by start-hidden.vbs (at logon by the ${SERVER_TASK} task, or by start-server.cmd).
rem Generated by blumodel-studio/scripts/deploy-local.mjs (server/ops/home.mjs): edits are overwritten.
setlocal
cd /d "%~dp0"
set PORT=${P}
set HOST=${host}
set "DB_PATH=%~dp0data\\blumodel.db"
rem Private settings (Stripe keys, PUBLIC_URL, ADMIN_EMAILS, DEMO_PAYMENTS...) come from blumodel.env
rem only. These are cleared so a variable inherited from Windows can't override the file.
${CLEARED_ENV.map((k) => `set "${k}="`).join('\n')}
set "BLUMODEL_ENV_FILE=%~dp0blumodel.env"
rem The server writes and rotates logs\\server.log itself; console.log catches anything printed
rem before that (a failed start). shutdown.request asks it to stop gracefully (stop-server.cmd).
set "BLUMODEL_LOG_FILE=%~dp0logs\\server.log"
set "BLUMODEL_SHUTDOWN_FILE=%~dp0shutdown.request"
if not exist logs mkdir logs
:loop
if exist stopped exit /b 0
if exist deploying (ping -n 3 127.0.0.1 >nul & goto loop)
rem Another process already holds the port: leave it alone rather than spin.
${listening} && goto busy
"${node}" --no-warnings "%~dp0app\\server\\scripts\\rotate-log.mjs" "%~dp0logs\\console.log" >nul 2>&1
echo [%date% %time%] starting on %HOST%:%PORT% >> logs\\console.log
rem Absolute script path, so deploy-local can tell this server from other node processes.
"${node}" --max-old-space-size=${heap} --no-warnings "%~dp0app\\server\\index.mjs" --prod >> logs\\console.log 2>&1
echo [%date% %time%] server exited with code %errorlevel% >> logs\\console.log
if exist stopped exit /b 0
ping -n 6 127.0.0.1 >nul
goto loop
:busy
echo [%date% %time%] port ${P} is already in use by another process: not starting >> logs\\console.log
exit /b 0
`;
  const hidden = `' Starts the BluModel Studio server supervisor (run-server.cmd) with no console window.
' The ${SERVER_TASK} scheduled task runs this at logon.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
sh.Run "cmd /c """ & dir & "\\run-server.cmd""", 0, False
`;
  const start = `@echo off
rem Starts the BluModel Studio server (hidden) after stop-server.cmd.
cd /d "%~dp0"
if exist stopped del stopped
rem When its task runs at startup (register-tasks --at-startup lists it in startup-tasks), start it
rem through Task Scheduler so the server keeps running after you sign out; otherwise directly.
findstr /X /C:${task} startup-tasks >nul 2>&1 && schtasks /Run /TN ${task} >nul 2>&1 && goto started
wscript.exe "%~dp0start-hidden.vbs"
:started
echo BluModel Studio is starting at http://127.0.0.1:${P} (log: logs\\server.log).
`;
  const stop = `@echo off
rem Stops the BluModel Studio server and its supervisor until start-server.cmd is run again.
rem The server is asked to stop gracefully (it finishes open requests for up to 10 s, checkpoints
rem the database and exits); if it still listens after 20 s it is ended forcibly.
setlocal
cd /d "%~dp0"
echo.> stopped
echo.> shutdown.request
set /a tries=0
:wait
${listening} || goto done
set /a tries+=1
if %tries% geq 20 goto force
ping -n 2 127.0.0.1 >nul
goto wait
:force
for /f "tokens=5" %%p in ('netstat -ano -p tcp ^| findstr /R /C:":${P} .*LISTENING"') do taskkill /PID %%p /F >nul 2>&1
echo The server did not stop within 20 s and was ended forcibly.
:done
if exist shutdown.request del shutdown.request
echo BluModel Studio server stopped. Run start-server.cmd to start it again.
`;
  return {
    'run-server.cmd': crlf(run),
    'start-hidden.vbs': crlf(hidden),
    'start-server.cmd': crlf(start),
    'stop-server.cmd': crlf(stop),
  };
}

/**
 * The blumodel.env a deploy writes when a home has none: every key the settings file can set, the
 * secrets empty, and the public server's defaults. With it, the server starts in production with
 * payments 'none' ("Payments open soon") until the Stripe values are pasted in (docs/LAUNCH.md).
 * Windows line ends on Windows, Linux ones elsewhere; the restart hint is the platform's.
 * @param {{ adminEmails?: string, publicUrl?: string, platform?: string }} [o]
 */
export function settingsTemplate({ adminEmails = '', publicUrl = PUBLIC_URL, platform = process.platform } = {}) {
  const restart = platform === 'win32' ? 'stop-server.cmd, then start-server.cmd' : `sudo systemctl restart ${SERVER_UNIT.replace(/\.service$/, '')}`;
  const t = `# BluModel Studio private settings. One KEY=VALUE per line; # starts a comment.
# Never commit, paste or share this file. The server reads it when it starts and never prints a
# value: restart it after editing (${restart}).
# docs/LAUNCH.md says where each value comes from; npm run stripe:check checks the Stripe ones.

# Stripe: a restricted key (rk_live_...) or secret key (sk_live_...), and the signing secret
# (whsec_...) of the webhook endpoint ${publicUrl}/api/webhooks/stripe. The companies' monthly
# plans are charged through it; yearly licenses are recorded by hand in Admin (no Stripe).
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# The https address customers use. Checkout return links and the webhook check use it.
PUBLIC_URL=${publicUrl}
# The domain the showrooms live under: <slug>.<BASE_DOMAIN> is a company's showroom, the domain
# itself and www. are the sales site. Empty: blumodel.studio. The tunnel must route *.<BASE_DOMAIN>
# as well (scripts/tunnel/setup-tunnel.mjs --hostname, docs/ONBOARDING_A_COMPANY.md).
BASE_DOMAIN=
# Grants nothing: no other account can change its email to one of these (comma separated). Make
# an admin with make-admin (docs/OPERATIONS.md, Admins) after signing up.
ADMIN_EMAILS=${adminEmails}
# 0: no labelled DEMO checkout on this server. Without Stripe values payments are simply off.
DEMO_PAYMENTS=0
# 1: requests arrive through cloudflared on this machine; the visitor's address is CF-Connecting-IP.
TRUST_PROXY=1

# Shown on the terms, privacy and refund pages and receipts.
LEGAL_NAME=
SUPPORT_EMAIL=
LEGAL_JURISDICTION=

# Optional, legacy: the retired Start from a photo read photos with Claude when both were set.
ANTHROPIC_API_KEY=
BLUMODEL_LLM_MODEL=

# Optional: email password-reset links and account notices. Set ONE provider key (Resend: re_...;
# Postmark: the server API token) and EMAIL_FROM, a sender that provider has verified, in quotes
# when it has a name: EMAIL_FROM="BluModel Studio <hello@blumodel.studio>". Without them, admins
# make reset links in Admin > Users.
RESEND_API_KEY=
POSTMARK_TOKEN=
EMAIL_FROM=

# Optional: photoreal AI renders on the showrooms ("Make it photoreal"). Both set: renders go to
# that service; without them the button says renders are being set up and nothing is charged.
# RENDER_CREDIT_CENTS is what one render costs a company in credits (25 = 25 cents when empty).
ARCHITECT_AI_URL=
ARCHITECT_AI_KEY=
RENDER_CREDIT_CENTS=

# Optional: a prospect trial made with Admin > Companies > Quick setup is live for TRIAL_DAYS
# (14 when empty), then shows "temporarily unavailable" until it is converted; nothing is deleted.
# TRIAL_CREDIT_CENTS is the render credits it gets once (0 when empty). A trial never charges.
TRIAL_DAYS=
TRIAL_CREDIT_CENTS=

# Encrypted off-site backups (docs/OPERATIONS.md, "Off-site backups"). Once a day the server
# writes an AES-256-GCM encrypted copy of the database and every upload into BACKUP_OFFSITE_DIR:
# point it at a folder your cloud drive syncs (OneDrive, Google Drive, Dropbox) or a mounted USB
# drive, e.g. BACKUP_OFFSITE_DIR="C:\\Users\\you\\OneDrive\\BluModel-backups" or
# /media/usb/blumodel-backups. Empty: no off-site copy. The folder must already exist.
# BACKUP_PASSPHRASE makes the key (12 characters or more; a long random one from your password
# manager). Keep it in the password manager and on paper too: without it the copies can NEVER
# be opened, by you or anyone. BACKUP_OFFSITE_KEEP: how many daily copies to keep (30, at most 30).
# Restore one: node app/server/scripts/restore-offsite.mjs <file>.
BACKUP_OFFSITE_DIR=
BACKUP_PASSPHRASE=
BACKUP_OFFSITE_KEEP=

# Optional: a PIN for the server face (http://127.0.0.1:8799 on this machine only: every site on or
# off, Update now) and 'blumodel sites on|off'. Empty: being on this machine is enough.
SERVER_FACE_PIN=
`;
  return eol(t, platform);
}

/**
 * Restricts `file` to the current Windows account (no inherited access, full control for the
 * account only). icacls changes the ACL; it never reads the file. Returns the account name.
 * @param {string} file
 * @param {{ exec?: typeof execFileSync }} [o]
 */
export function restrictToCurrentUser(file, { exec = execFileSync } = {}) {
  const who = currentAccount({ exec });
  if (!who) throw new Error('whoami returned nothing');
  exec(sys32('icacls.exe'), [file, '/inheritance:r', '/grant:r', `${who}:(F)`], { stdio: 'ignore', windowsHide: true });
  return who;
}

/** Is this process root (Linux / macOS)? Always false on Windows. */
export const isRoot = () => typeof process.getuid === 'function' && process.getuid() === 0;

/**
 * The numeric ids of a Linux account (`id -u`, `id -g`). Throws when there is no such account.
 * @param {string} name
 * @param {{ exec?: typeof execFileSync }} [o]
 */
export function userIds(name, { exec = execFileSync } = {}) {
  const run = (flag) => Number(String(exec('id', [flag, name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim());
  const uid = run('-u');
  const gid = run('-g');
  if (!Number.isInteger(uid) || !Number.isInteger(gid)) throw new Error(`No account named ${name}`);
  return { uid, gid };
}

/**
 * Makes a file or folder (recursively) belong to `owner` when this process is root; does nothing
 * otherwise or on Windows. Used on Linux for what a root deploy writes into the home (backups, a
 * new settings template), so the server's account can read it.
 * @param {string} target
 * @param {{ owner?: string, exec?: typeof execFileSync, chown?: typeof fs.chownSync }} [o]
 */
export function giveToServiceUser(target, { owner = SERVICE_USER, exec = execFileSync, chown = fs.chownSync } = {}) {
  if (process.platform === 'win32' || !isRoot()) return false;
  const { uid, gid } = userIds(owner, { exec });
  const walk = (p) => {
    chown(p, uid, gid);
    let st;
    try {
      st = fs.lstatSync(p);
    } catch {
      return;
    }
    if (st.isDirectory()) for (const e of fs.readdirSync(p)) walk(path.join(p, e));
  };
  walk(target);
  return true;
}

/**
 * Restricts the private settings file to the account that runs the server, without reading it.
 * Windows: icacls, the current account only. Linux: mode 600, and owned by `owner` ('blumodel')
 * when run as root (the deploy is), so only the server's account (and root) can read it.
 * Returns who may read it.
 * @param {string} file
 * @param {{ platform?: string, owner?: string, exec?: typeof execFileSync }} [o]
 */
export function restrictSettings(file, { platform = process.platform, owner = SERVICE_USER, exec = execFileSync } = {}) {
  if (platform === 'win32') return restrictToCurrentUser(file, { exec });
  fs.chmodSync(file, 0o600);
  if (isRoot() && owner) {
    const { uid, gid } = userIds(owner, { exec });
    fs.chownSync(file, uid, gid);
    return `${owner} (mode 600)`;
  }
  return `${os.userInfo().username} (mode 600)`;
}

/**
 * Writes the settings template to `file` only if no file is there (exclusive create, so an existing
 * one is never overwritten, even in a race), then restricts it (restrictSettings: the current
 * Windows account, or mode 600 for the server's account on Linux).
 * Returns `{ created: false }` when a file was already there.
 * @param {string} file
 * @param {{ text: string, restrict?: (file: string) => string }} o
 */
export function createSettingsTemplate(file, { text, restrict = (f) => restrictSettings(f) }) {
  let fd;
  try {
    fd = fs.openSync(file, 'wx', 0o600);
  } catch (err) {
    if (err?.code === 'EEXIST') return { created: false };
    throw err;
  }
  try {
    fs.writeSync(fd, text);
  } finally {
    fs.closeSync(fd);
  }
  let restrictedTo = null;
  let restrictError = null;
  try {
    restrictedTo = restrict(file);
  } catch (err) {
    restrictError = err?.message ?? String(err);
  }
  return { created: true, restrictedTo, restrictError };
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * A Task Scheduler definition (schtasks /Create /XML) that runs `wscript.exe "<launcher>" <args>`:
 * runs on battery, one instance at a time (a run still going makes the next one a no-op).
 *   trigger 'logon'   (default) at `user`'s logon with their interactive token, like
 *                     MiseKitchenServer did: the original PC, where someone signs in.
 *   trigger 'startup' when Windows starts (30 s after boot), as `user` whether or not anyone is
 *                     signed in: a machine nobody logs on to (a Dell Wyse). Windows has to store
 *                     the account's password for that, so schtasks asks for it when the task is
 *                     registered (register-tasks passes /RP *, never a password).
 *   trigger 'daily'   every day at `at` (HH:MM, local time); a missed run starts when the machine is
 *                     next on (StartWhenAvailable).
 *   trigger 'every'   every `every` (an ISO duration such as PT2M), for ever.
 * `password` (the startup trigger implies it) runs it whether or not anyone is signed in; otherwise
 * only while `user` is. No time limit unless `timeLimit` (an ISO duration) says one.
 * @param {{ name: string, description: string, launcher: string, workingDir: string, user: string,
 *   trigger?: 'logon' | 'startup' | 'daily' | 'every', at?: string, every?: string, args?: string,
 *   password?: boolean, timeLimit?: string, startWhenAvailable?: boolean }} o
 */
export function taskXml({ name, description, launcher, workingDir, user, trigger = 'logon', at = DEFAULT_UPDATE_TIME, every = 'PT2M', args = '', password, timeLimit = 'PT0S', startWhenAvailable = true }) {
  if (!['logon', 'startup', 'daily', 'every'].includes(trigger)) throw new Error(`Not a trigger: ${trigger}`);
  if (!/^P(T?\d+[HMS])+$|^PT0S$/.test(timeLimit)) throw new Error(`Not a duration: ${timeLimit}`);
  const stored = password ?? trigger === 'startup';
  let triggerXml;
  if (trigger === 'startup')
    triggerXml = `    <BootTrigger>
      <Delay>PT30S</Delay>
    </BootTrigger>`;
  else if (trigger === 'logon')
    triggerXml = `    <LogonTrigger>
      <UserId>${xml(user)}</UserId>
    </LogonTrigger>`;
  else if (trigger === 'daily') {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(at));
    if (!m) throw new Error(`Not a time of day (HH:MM): ${at}`);
    triggerXml = `    <CalendarTrigger>
      <StartBoundary>2026-01-01T${m[1]}:${m[2]}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>`;
  } else {
    if (!/^PT\d+[MH]$/.test(String(every))) throw new Error(`Not an interval: ${every}`);
    triggerXml = `    <TimeTrigger>
      <Repetition>
        <Interval>${every}</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>`;
  }
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xml(description)}</Description>
    <URI>\\${xml(name)}</URI>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>${xml(user)}</UserId>
      <LogonType>${stored ? 'Password' : 'InteractiveToken'}</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>${timeLimit}</ExecutionTimeLimit>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <StartWhenAvailable>${startWhenAvailable ? 'true' : 'false'}</StartWhenAvailable>
    <Enabled>true</Enabled>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
  </Settings>
  <Triggers>
${triggerXml}
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>"${xml(launcher)}"${args ? ` ${xml(args)}` : ''}</Arguments>
      <WorkingDirectory>${xml(workingDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/**
 * The two tasks a Windows home needs: the server and the tunnel, both started hidden, at logon or
 * (atStartup) when Windows starts.
 * @param {string} home
 * @param {string} user
 * @param {{ atStartup?: boolean, port?: number | string }} [o]  port: only named in the description
 */
export function homeTasks(home, user, { atStartup = false, port = DEFAULT_PORT } = {}) {
  const L = homeLayout(home, 'win32');
  const when = atStartup ? 'when Windows starts (whether or not anyone is signed in)' : 'at logon';
  const trigger = atStartup ? 'startup' : 'logon';
  return [
    {
      name: SERVER_TASK,
      launcher: L.startHidden,
      xml: taskXml({
        name: SERVER_TASK,
        user,
        trigger,
        launcher: L.startHidden,
        workingDir: L.home,
        description: `Starts the BluModel Studio server (http://127.0.0.1:${port}, public at ${PUBLIC_URL}) ${when}, hidden, under its restarting supervisor run-server.cmd. Files: ${L.home}`,
      }),
    },
    {
      name: TUNNEL_TASK,
      launcher: L.startTunnel,
      xml: taskXml({
        name: TUNNEL_TASK,
        user,
        trigger,
        launcher: L.startTunnel,
        workingDir: L.home,
        description: `Starts the Cloudflare tunnel for ${PUBLIC_URL} (cloudflared.yml) ${when}, hidden, under its restarting supervisor run-tunnel.cmd. Files: ${L.home}`,
      }),
    },
  ];
}

/**
 * <home>\update-hidden.vbs: runs `node <home>\repo\blumodel-studio\scripts\host\update.mjs --home
 * <home> <its own arguments>` with no window and waits for it, so the update tasks show nothing on
 * screen and Task Scheduler's "Last Run Result" is the update's exit code. register-tasks writes it.
 * @param {{ node: string }} o
 */
export function updateLauncherVbs({ node }) {
  if (!node || /"/.test(node)) throw new Error('updateLauncherVbs needs the node.exe path (no quotes)');
  return crlf(`' Runs the BluModel Studio update (repo\\blumodel-studio\\scripts\\host\\update.mjs) with no window
' and waits for it. The ${UPDATE_TASK} task runs it with --auto at AUTO_UPDATE_TIME, and the
' ${UPDATE_NOW_TASK} task every two minutes with --auto --trigger-only (nothing happens unless
' Admin > System > Update now left logs\\update-now.request). Its log: logs\\update.log.
' Generated by blumodel-studio/scripts/register-tasks.mjs (server/ops/home.mjs): edits are overwritten.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
args = ""
For Each a In WScript.Arguments
  args = args & " " & a
Next
code = sh.Run("""${node}"" --no-warnings """ & dir & "\\repo\\blumodel-studio\\scripts\\host\\update.mjs"" --home """ & dir & """" & args, 0, True)
WScript.Quit code
`);
}

/**
 * The two update tasks of a Windows home: BluModelStudioUpdate daily at `time`, and
 * BluModelStudioUpdateNow every two minutes, which does nothing unless Admin > System > Update now
 * left its trigger file (so there is never more than one scheduled update a day). Both run
 * update-hidden.vbs, with no window, one at a time, for at most two hours. With `password`
 * (register-tasks --at-startup) they run whether or not anyone is signed in.
 * @param {string} home
 * @param {string} user
 * @param {{ time?: string, password?: boolean }} [o]
 */
export function updateTasks(home, user, { time = DEFAULT_UPDATE_TIME, password = false } = {}) {
  const L = homeLayout(home, 'win32');
  const who = password ? 'whether or not anyone is signed in' : `while ${user} is signed in`;
  return [
    {
      name: UPDATE_TASK,
      launcher: L.updateLauncher,
      xml: taskXml({
        name: UPDATE_TASK,
        user,
        trigger: 'daily',
        at: time,
        password,
        args: '--auto',
        timeLimit: 'PT2H',
        launcher: L.updateLauncher,
        workingDir: L.home,
        description: `Checks GitHub daily at ${time} for a new BluModel Studio release on its branch and, when there is one, deploys it (database backed up first, rolled back if unhealthy), ${who}. Log: ${L.logs}\\update.log. docs/HOSTING.md, "Automatic updates".`,
      }),
    },
    {
      name: UPDATE_NOW_TASK,
      launcher: L.updateLauncher,
      xml: taskXml({
        name: UPDATE_NOW_TASK,
        user,
        trigger: 'every',
        every: 'PT2M',
        password,
        args: '--auto --trigger-only',
        timeLimit: 'PT2H',
        startWhenAvailable: false,
        launcher: L.updateLauncher,
        workingDir: L.home,
        description: `Applies Admin > System > Update now: every two minutes it looks for ${L.logs}\\update-now.request and does nothing at all without it, ${who}.`,
      }),
    },
  ];
}

// ── Linux: systemd units ─────────────────────────────────────────────────────

/** systemd unit values here are written unquoted, so they must be plain absolute paths. */
const unixPath = (s, what) => {
  if (typeof s !== 'string' || !/^\/[A-Za-z0-9._/@+-]*$/.test(s) || s.includes('..')) throw new Error(`${what} must be an absolute path of letters, digits and . _ - / @ + only (got ${JSON.stringify(s)})`);
  return s;
};
const unixName = (s, what) => {
  if (typeof s !== 'string' || !/^[a-z_][a-z0-9_-]{0,31}$/.test(s)) throw new Error(`Not a ${what}: ${JSON.stringify(s)}`);
  return s;
};

/** Sandboxing shared by both units. No MemoryDenyWriteExecute: Node's JIT needs writable code pages. */
const HARDENING = `NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictSUIDSGID=yes
RestrictRealtime=yes
RestrictNamespaces=yes
LockPersonality=yes
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native`;

/**
 * /etc/systemd/system/blumodel-studio.service: `node server/index.mjs --prod` from <home>/app as
 * the 'blumodel' account, started at boot and restarted 5 s after any exit. systemd gives a
 * service a clean environment, so only the variables below and blumodel.env reach the server (what
 * run-server.cmd's clearing does on Windows). It may write only <home>/data and <home>/logs (both
 * must exist before it starts: a deploy and install-linux.sh make them), and nothing it writes is
 * readable by other accounts (UMask 0027; the log, the backups and an imported database are 600).
 * Stopping sends SIGTERM:
 * the server finishes open requests for up to 10 s, checkpoints the database and exits 0.
 * Memory: node --max-old-space-size=<heapMb> (DEFAULT_HEAP_MB), MemoryHigh heap + 256 MB and
 * MemoryMax heap + 512 MB.
 * @param {{ home?: string, node?: string, user?: string, port?: number | string, host?: string, heapMb?: number }} [o]
 */
export function systemdServerUnit({ home = LINUX_HOME, node = '/usr/bin/node', user = SERVICE_USER, port = DEFAULT_PORT, host = DEFAULT_HOST, heapMb = DEFAULT_HEAP_MB } = {}) {
  const L = homeLayout(unixPath(home, 'The home'), 'linux');
  unixPath(node, 'The node path');
  unixName(user, 'user name');
  const P = String(port);
  if (!/^\d{1,5}$/.test(P) || Number(P) < 1 || Number(P) > 65535) throw new Error(`Not a port: ${P}`);
  if (!/^[\w.:[\]-]+$/.test(host)) throw new Error(`Not a host: ${host}`);
  const heap = Number(heapMb);
  if (!Number.isInteger(heap) || heap < 128 || heap > 8192) throw new Error(`The heap must be 128-8192 MB (got ${heapMb})`);
  return `# BluModel Studio: the web server on http://${host}:${P} (public at ${PUBLIC_URL} through ${TUNNEL_UNIT}).
# Generated by blumodel-studio/scripts/register-tasks.mjs (server/ops/home.mjs): edits are overwritten.
# docs/HOSTING.md. Its log: ${L.serverLog} (rotated by the server); starts, stops and crashes:
# journalctl -u ${SERVER_UNIT}
[Unit]
Description=BluModel Studio server (${host}:${P})
After=network.target
# Never give up: the restart delay below already spaces the attempts out.
StartLimitIntervalSec=0

[Service]
Type=simple
User=${user}
Group=${user}
WorkingDirectory=${L.app}
Environment=NODE_ENV=production
Environment=PORT=${P}
Environment=HOST=${host}
Environment=DB_PATH=${L.db}
Environment=BLUMODEL_ENV_FILE=${L.settings}
Environment=BLUMODEL_LOG_FILE=${L.serverLog}
# A small machine (a 4 GB Wyse): V8's heap is capped, and the whole service (heap, SQLite, buffers)
# is throttled above MemoryHigh and killed and restarted above MemoryMax rather than taking the box.
ExecStart=${node} --max-old-space-size=${heap} --no-warnings ${L.serverEntry} --prod
MemoryHigh=${heap + 256}M
MemoryMax=${heap + 512}M
KillSignal=SIGTERM
TimeoutStopSec=30
Restart=always
RestartSec=5
# Nothing the server writes is readable by other accounts (at most by the blumodel group, which has
# no other members); its log and backups are mode 600, and so is blumodel.env. Read them with sudo.
UMask=0027
LimitNOFILE=65536
# The server may write its data and logs and nothing else; its code and settings are read-only to it.
ReadWritePaths=${L.data} ${L.logs}
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
${HARDENING}

[Install]
WantedBy=multi-user.target
`;
}

/**
 * /etc/systemd/system/blumodel-tunnel.service: `cloudflared tunnel --config <home>/cloudflared.yml
 * run` as its own account, 'blumodel-tunnel', which may read only cloudflared.yml (root:blumodel-tunnel
 * 640) and .cloudflared/ (its own, 700): the database, uploads, logs and blumodel.env are
 * InaccessiblePaths besides being another account's. After (and pulling in) the server, restarted 10 s after any exit. It is
 * installed DISABLED: enable it only at the cutover (docs/HOSTING.md), because two machines must
 * never serve the tunnel at the same time with different databases.
 * @param {{ home?: string, cloudflared?: string, user?: string }} [o]
 */
export function systemdTunnelUnit({ home = LINUX_HOME, cloudflared = '/usr/bin/cloudflared', user = TUNNEL_USER } = {}) {
  const L = homeLayout(unixPath(home, 'The home'), 'linux');
  unixPath(cloudflared, 'The cloudflared path');
  unixName(user, 'user name');
  return `# BluModel Studio: the Cloudflare tunnel for ${PUBLIC_URL} (config: ${L.tunnelConfig}).
# Generated by blumodel-studio/scripts/register-tasks.mjs (server/ops/home.mjs): edits are overwritten.
# Enable it only at the cutover (docs/HOSTING.md): two machines must never serve the tunnel at the
# same time with different databases. Its log: journalctl -u ${TUNNEL_UNIT}
[Unit]
Description=BluModel Studio Cloudflare tunnel (${PUBLIC_URL.replace(/^https:\/\//, '')})
After=network-online.target ${SERVER_UNIT}
Wants=network-online.target ${SERVER_UNIT}
StartLimitIntervalSec=0

[Service]
Type=simple
User=${user}
Group=${user}
ExecStart=${cloudflared} tunnel --config ${L.tunnelConfig} --no-autoupdate run
Restart=always
RestartSec=10
TimeoutStopSec=30
UMask=0077
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
# Never the site's data or settings, whatever their permissions.
InaccessiblePaths=-${L.data} -${L.logs} -${L.settings} -${L.home}/.ssh
${HARDENING}

[Install]
WantedBy=multi-user.target
`;
}

/**
 * The automatic update on Linux, three units (docs/HOSTING.md, "Automatic updates"):
 *   blumodel-update.service  oneshot: node <home>/repo/blumodel-studio/scripts/host/update.mjs --auto,
 *                            as root (the deploy restarts blumodel-studio.service; update.mjs runs git
 *                            as the checkout's owner through runuser), at low CPU and I/O priority
 *   blumodel-update.timer    starts it daily at `time` (local) with up to 10 minutes of random delay;
 *                            Persistent, so a run missed while the machine was off happens at boot
 *   blumodel-update.path     starts it when <home>/logs/update-now.request appears (Admin > System >
 *                            Update now): inotify, so it costs nothing while idle. The run deletes
 *                            the file.
 * Never more than one scheduled run a day; the path unit only acts on the trigger file.
 * @param {{ home?: string, node?: string, time?: string }} [o]
 */
export function systemdUpdateUnits({ home = LINUX_HOME, node = '/usr/bin/node', time = DEFAULT_UPDATE_TIME } = {}) {
  const L = homeLayout(unixPath(home, 'The home'), 'linux');
  unixPath(node, 'The node path');
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time));
  if (!m) throw new Error(`Not a time of day (HH:MM, 24 hour): ${JSON.stringify(time)}`);
  const service = `# BluModel Studio: one automatic update (scripts/host/update.mjs --auto). Started by ${UPDATE_TIMER}
# (daily at ${time}) and by ${UPDATE_PATH_UNIT} (Admin > System > Update now); nothing else.
# Generated by blumodel-studio/scripts/register-tasks.mjs (server/ops/home.mjs): edits are overwritten.
# docs/HOSTING.md, "Automatic updates". Its log: journalctl -u ${UPDATE_UNIT}, and ${L.logs}/update.log
[Unit]
Description=BluModel Studio automatic update (fetch, and deploy a new release)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
# Root: the deploy stops and starts ${SERVER_UNIT}. update.mjs runs git as the checkout's owner.
ExecStart=${node} --no-warnings ${L.updateScript} --auto --home ${L.home}
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
SyslogIdentifier=blumodel-update
TimeoutStartSec=2h
Nice=10
IOSchedulingClass=idle
UMask=0022
`;
  const timer = `# BluModel Studio: check GitHub for a new release once a day, at ${time} local time (the quietest
# hour), up to 10 minutes late. A run missed while the machine was off happens when it is next on.
# Generated by blumodel-studio/scripts/register-tasks.mjs: run it again with --auto-update-time HH:MM
# to change the time, or --no-auto-update to turn this off.
[Unit]
Description=BluModel Studio daily update check (${time})

[Timer]
OnCalendar=*-*-* ${m[1]}:${m[2]}:00
Persistent=true
RandomizedDelaySec=10min
AccuracySec=1min
Unit=${UPDATE_UNIT}

[Install]
WantedBy=timers.target
`;
  const watcher = `# BluModel Studio: Admin > System > Update now. The server writes ${L.updateTrigger}; this
# starts ${UPDATE_UNIT} when it appears (inotify: no polling, nothing runs while idle) and the
# update deletes it. Generated by blumodel-studio/scripts/register-tasks.mjs.
[Unit]
Description=BluModel Studio Update now watcher

[Path]
PathExists=${L.updateTrigger}
Unit=${UPDATE_UNIT}

[Install]
WantedBy=paths.target
`;
  return { [UPDATE_UNIT]: service, [UPDATE_TIMER]: timer, [UPDATE_PATH_UNIT]: watcher };
}

/**
 * Every unit by file name: the server, the tunnel and the three update units.
 * @param {{ home?: string, node?: string, cloudflared?: string, user?: string, tunnelUser?: string, port?: number | string, host?: string, heapMb?: number, time?: string }} [o]
 */
export function systemdUnits(o = {}) {
  return { [SERVER_UNIT]: systemdServerUnit(o), [TUNNEL_UNIT]: systemdTunnelUnit({ ...o, user: o.tunnelUser ?? TUNNEL_USER }), ...systemdUpdateUnits(o) };
}

const UPDATE_UNITS = [UPDATE_UNIT, UPDATE_TIMER, UPDATE_PATH_UNIT];

/**
 * What register-tasks does on Linux: the unit files it writes (mode 644) and the systemctl
 * commands after. The server unit is enabled (it starts at boot; the next deploy starts it now).
 * The tunnel unit is enabled only with `enableTunnel` (the cutover); it is never started here.
 * The update's timer and path watcher are enabled and started (a schedule and an inotify watch:
 * neither starts the server or an update by itself), or with `autoUpdate: false` disabled and
 * stopped; the update service itself is never enabled (only they start it).
 * @param {{ units: Record<string, string>, only?: 'server' | 'tunnel' | 'update', enableTunnel?: boolean, autoUpdate?: boolean, dir?: string }} o
 * @returns {{ writes: { file: string, text: string }[], commands: string[][] }}
 */
export function systemdInstallPlan({ units, only, enableTunnel = false, autoUpdate = true, dir = SYSTEMD_DIR }) {
  const pick = { server: (n) => n === SERVER_UNIT, tunnel: (n) => n === TUNNEL_UNIT, update: (n) => UPDATE_UNITS.includes(n) };
  const names = Object.keys(units).filter((n) => !only || pick[only]?.(n));
  const writes = names.map((n) => ({ file: path.posix.join(dir, n), text: units[n] }));
  const commands = [['systemctl', 'daemon-reload']];
  if (names.includes(SERVER_UNIT)) commands.push(['systemctl', 'enable', SERVER_UNIT]);
  if (names.includes(TUNNEL_UNIT) && enableTunnel) commands.push(['systemctl', 'enable', TUNNEL_UNIT]);
  if (names.includes(UPDATE_TIMER)) commands.push(autoUpdate ? ['systemctl', 'enable', '--now', UPDATE_TIMER, UPDATE_PATH_UNIT] : ['systemctl', 'disable', '--now', UPDATE_TIMER, UPDATE_PATH_UNIT]);
  return { writes, commands };
}

/** Pre-deploy backup folders (data\backups\<ISO timestamp>\), oldest first. Not daily\ or uploads-mirror\. */
export function deployBackupDirs(backupsDir) {
  let names = [];
  try {
    names = fs.readdirSync(backupsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  return names.filter((n) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(n)).sort();
}

/**
 * What a deploy ships from the checkout (relative to blumodel-studio/): server\ and src\data\*.json
 * are copied as they are on disk, and dist\ is built from src\, index.html, public\ and the
 * package and Vite files. A deploy must ship a commit, not whatever is half-edited in the working
 * tree: a migration that is only on disk would be applied to the real database and recorded as
 * done, and never re-run once it is changed and committed.
 */
export const DEPLOY_SOURCE_PATHS = Object.freeze(['server', 'src', 'public', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json']);

/**
 * The changed or untracked files under DEPLOY_SOURCE_PATHS, from the output of
 * `git status --porcelain=v1 -z --untracked-files=all -- <paths>` (gitignored files, such as
 * server/generated/ and server/data/, never appear there). `[{ status, file }]`, file as git prints it.
 * @param {string} porcelainZ
 */
export function dirtyDeployFiles(porcelainZ) {
  const out = [];
  const parts = String(porcelainZ || '').split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const status = e.slice(0, 2);
    out.push({ status: status.trim() || status, file: e.slice(3) });
    // A rename or copy is followed by its source path as a separate entry.
    if (/[RC]/.test(status)) i++;
  }
  return out;
}

/**
 * The processes started from `home`, by their command lines (read-only: PowerShell's CIM query):
 * `{ servers, supervisors, tunnels, others }`, each `[{ pid, name }]`. Windows only. The caller
 * and its ancestors (whose command lines may name the folder: `npm run ... --from <folder>`)
 * are never listed.
 * @param {string} home
 * @param {{ exec?: typeof execFileSync, exclude?: number[] }} [o]
 */
export function homeProcesses(home, { exec = execFileSync, exclude = [process.pid] } = {}) {
  const L = homeLayout(home);
  const needle = L.home.toLowerCase().replace(/'/g, "''");
  const from = ['$PID', ...exclude.filter((n) => Number.isInteger(n)).map(String)].join(', ');
  const ps =
    `$h = '${needle}'; $all = @(Get-CimInstance Win32_Process); $byId = @{}; foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }; ` +
    `$skip = New-Object 'System.Collections.Generic.HashSet[int]'; ` +
    `foreach ($s in @(${from})) { $c = [int]$s; $n = 0; while ($c -gt 0 -and $n -lt 32 -and $skip.Add($c) -and $byId.ContainsKey($c)) { $c = [int]$byId[$c].ParentProcessId; $n++ } }; ` +
    `@($all | Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($h) -and -not $skip.Contains([int]$_.ProcessId) } | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; name = [string]$_.Name; cmd = [string]$_.CommandLine } }) | ConvertTo-Json -Compress -Depth 2`;
  let out = '';
  try {
    out = String(exec(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true })).trim();
  } catch {
    return { servers: [], supervisors: [], tunnels: [], others: [], error: true };
  }
  let list = [];
  try {
    list = out ? JSON.parse(out) : [];
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) list = [list];
  const has = (p, s) => p.cmd.toLowerCase().includes(s.toLowerCase());
  const res = { servers: [], supervisors: [], tunnels: [], others: [] };
  for (const p of list) {
    const item = { pid: p.pid, name: p.name };
    if (/^node(\.exe)?$/i.test(p.name) && has(p, L.serverEntry)) res.servers.push(item);
    else if (/^cmd(\.exe)?$/i.test(p.name) && has(p, L.runServer)) res.supervisors.push(item);
    else if (has(p, L.tunnelConfig) || has(p, L.runTunnel)) res.tunnels.push(item);
    else res.others.push(item);
  }
  return res;
}
