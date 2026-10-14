// The home server's folder (%USERPROFILE%\Projects\BluModelStudio): its layout, the supervisor
// scripts written into it, the private settings template, and the scheduled tasks that start it
// at logon. Shared by scripts/deploy-local.mjs, scripts/migrate-home.mjs, scripts/register-tasks.mjs
// and scripts/tunnel/setup-tunnel.mjs; tested in server/test/home.test.mjs.
//
// Pure functions plus small file helpers. Nothing here starts, stops or registers anything, and
// nothing here ever opens blumodel.env or mise.env: only whether they exist, a rename, or an ACL
// change (icacls never reads a file's contents).
//
// Layout of a home:
//   app\                 the deployed code (dist\, server\, src\data\*.json), replaced by each deploy
//   data\blumodel.db     the database (+ -wal / -shm). A home from before the rename has mise.db.
//   data\uploads\        uploaded models and images
//   data\backups\        daily\ (the server's own VACUUM INTO copies, 14 kept), uploads-mirror\,
//                        and <timestamp>\ folders: the deploy's copy from before each deploy (5 kept)
//   logs\                server.log (the server's own, rotated by size), console.log (anything the
//                        server printed before its log was open; rotated at each start),
//                        tunnel.log (cloudflared; rotated at each tunnel start)
//   blumodel.env         private settings, KEY=VALUE (server/lib/envFile.mjs). Never read by any
//                        script; a deploy only creates a template when there is none.
//   run-server.cmd       supervisor: runs the server, restarts it when it exits
//   start-hidden.vbs     starts run-server.cmd with no window (the BluModelStudioServer task runs it)
//   start-server.cmd / stop-server.cmd
//   cloudflared.yml, run-tunnel.cmd, start-tunnel.vbs, start-tunnel.cmd, stop-tunnel.cmd
//                        the Cloudflare tunnel (scripts/tunnel/setup-tunnel.mjs; BluModelTunnel task)
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

/** %USERPROFILE%\Projects\BluModelStudio */
export const defaultHome = (homedir = os.homedir()) => path.join(homedir, 'Projects', 'BluModelStudio');
/** %USERPROFILE%\Projects\Mise: the home from before the rename. */
export const legacyHome = (homedir = os.homedir()) => path.join(homedir, 'Projects', 'Mise');

/** Every path in a home (see the top of this file). */
export function homeLayout(home) {
  const h = path.resolve(home);
  const data = path.join(h, 'data');
  return {
    home: h,
    app: path.join(h, 'app'),
    serverEntry: path.join(h, 'app', 'server', 'index.mjs'),
    data,
    db: path.join(data, 'blumodel.db'),
    legacyDb: path.join(data, 'mise.db'),
    uploads: path.join(data, 'uploads'),
    backups: path.join(data, 'backups'),
    logs: path.join(h, 'logs'),
    settings: path.join(h, 'blumodel.env'),
    legacySettings: path.join(h, 'mise.env'),
    runServer: path.join(h, 'run-server.cmd'),
    startHidden: path.join(h, 'start-hidden.vbs'),
    stopped: path.join(h, 'stopped'),
    deploying: path.join(h, 'deploying'),
    shutdownFile: path.join(h, 'shutdown.request'),
    tunnelConfig: path.join(h, 'cloudflared.yml'),
    runTunnel: path.join(h, 'run-tunnel.cmd'),
    startTunnel: path.join(h, 'start-tunnel.vbs'),
    tunnelStopped: path.join(h, 'tunnel.stopped'),
  };
}

/** Windows line ends for .cmd / .vbs files. */
export const crlf = (s) => s.replace(/\r?\n/g, '\r\n');

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
 * @param {{ node: string, port?: number | string, host?: string }} o
 */
export function serverScripts({ node, port = DEFAULT_PORT, host = DEFAULT_HOST }) {
  if (!node) throw new Error('serverScripts needs the node.exe path');
  const P = String(port);
  if (!/^\d{1,5}$/.test(P)) throw new Error(`Not a port: ${P}`);
  if (!/^[\w.:[\]-]+$/.test(host)) throw new Error(`Not a host: ${host}`);
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
"${node}" --no-warnings "%~dp0app\\server\\index.mjs" --prod >> logs\\console.log 2>&1
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
wscript.exe "%~dp0start-hidden.vbs"
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
 * @param {{ adminEmails?: string, publicUrl?: string }} [o]
 */
export function settingsTemplate({ adminEmails = '', publicUrl = PUBLIC_URL } = {}) {
  const t = `# BluModel Studio private settings. One KEY=VALUE per line; # starts a comment.
# Never commit, paste or share this file. The server reads it when it starts and never prints a
# value: restart it after editing (stop-server.cmd, then start-server.cmd).
# docs/LAUNCH.md says where each value comes from; npm run stripe:check checks the Stripe ones.

# Stripe: a restricted key (rk_live_...) or secret key (sk_live_...), and the signing secret
# (whsec_...) of the webhook endpoint ${publicUrl}/api/webhooks/stripe.
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# The https address customers use. Checkout return links and the webhook check use it.
PUBLIC_URL=${publicUrl}
# Who becomes an admin by signing in (comma separated).
ADMIN_EMAILS=${adminEmails}
# 0: no labelled DEMO checkout on this server. Without Stripe values payments are simply off.
DEMO_PAYMENTS=0
# 1: requests arrive through cloudflared on this machine; the visitor's address is CF-Connecting-IP.
TRUST_PROXY=1

# Shown on the terms, privacy and refund pages and receipts.
LEGAL_NAME=
SUPPORT_EMAIL=
LEGAL_JURISDICTION=

# Optional: Start from a photo reads the photos with Claude when both are set.
ANTHROPIC_API_KEY=
BLUMODEL_LLM_MODEL=
`;
  return crlf(t);
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

/**
 * Writes the settings template to `file` only if no file is there (exclusive create, so an existing
 * one is never overwritten, even in a race), then restricts it to the current user.
 * Returns `{ created: false }` when a file was already there.
 * @param {string} file
 * @param {{ text: string, restrict?: (file: string) => string }} o
 */
export function createSettingsTemplate(file, { text, restrict = restrictToCurrentUser }) {
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
 * A Task Scheduler definition (schtasks /Create /XML) that runs `wscript.exe "<launcher>"` at
 * `user`'s logon with their interactive token, like MiseKitchenServer did: no time limit, runs on
 * battery, starts late if the logon was missed, one instance. The launcher (a .vbs) starts a
 * supervisor that restarts what it runs, so the task itself never needs to restart anything.
 * @param {{ name: string, description: string, launcher: string, workingDir: string, user: string }} o
 */
export function taskXml({ name, description, launcher, workingDir, user }) {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>${xml(description)}</Description>
    <URI>\\${xml(name)}</URI>
  </RegistrationInfo>
  <Principals>
    <Principal id="Author">
      <UserId>${xml(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Enabled>true</Enabled>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <UseUnifiedSchedulingEngine>true</UseUnifiedSchedulingEngine>
  </Settings>
  <Triggers>
    <LogonTrigger>
      <UserId>${xml(user)}</UserId>
    </LogonTrigger>
  </Triggers>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>"${xml(launcher)}"</Arguments>
      <WorkingDirectory>${xml(workingDir)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}

/** The two tasks a home needs: the server and the tunnel, both started hidden at logon. */
export function homeTasks(home, user) {
  const L = homeLayout(home);
  return [
    {
      name: SERVER_TASK,
      launcher: L.startHidden,
      xml: taskXml({
        name: SERVER_TASK,
        user,
        launcher: L.startHidden,
        workingDir: L.home,
        description: `Starts the BluModel Studio server (http://127.0.0.1:${DEFAULT_PORT}, public at ${PUBLIC_URL}) at logon, hidden, under its restarting supervisor run-server.cmd. Files: ${L.home}`,
      }),
    },
    {
      name: TUNNEL_TASK,
      launcher: L.startTunnel,
      xml: taskXml({
        name: TUNNEL_TASK,
        user,
        launcher: L.startTunnel,
        workingDir: L.home,
        description: `Starts the Cloudflare tunnel for ${PUBLIC_URL} (cloudflared.yml) at logon, hidden, under its restarting supervisor run-tunnel.cmd. Files: ${L.home}`,
      }),
    },
  ];
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
