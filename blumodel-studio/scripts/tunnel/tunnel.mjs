// The Cloudflare tunnel for blumodel.studio, as files in the home server's folder: the cloudflared
// config and (Windows) the scripts that keep it running; on Linux blumodel-tunnel.service runs it
// (server/ops/home.mjs). Used by setup-tunnel.mjs; tested in server/test/home.test.mjs and
// server/test/host.test.mjs. Nothing here starts, stops or changes the tunnel, its DNS or its
// credentials; the credentials file is only checked for existence, never opened.
//
// The tunnel itself ('blumodel', id below) already exists in Cloudflare with DNS for blumodel.studio
// routed to it. Its credentials are <id>.json from `cloudflared tunnel create`: on Windows in
// %USERPROFILE%\.cloudflared\, on Linux in <home>/.cloudflared/ (owned by 'blumodel', mode 600).
// Moving them to another machine is done by hand (docs/HOSTING.md), never by a script.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TUNNEL_TASK, TUNNEL_UNIT, crlf, homeLayout, sys32 } from '../../server/ops/home.mjs';

export const TUNNEL_NAME = 'blumodel';
export const TUNNEL_ID = '064671cd-a658-4240-8626-c697b9f148ac';
export const HOSTNAME = 'blumodel.studio';
export const ORIGIN = 'http://127.0.0.1:8790';
export const CLOUDFLARED_FALLBACK = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
/** Where Cloudflare's apt package (and the usual manual installs) put cloudflared on Linux. */
export const CLOUDFLARED_LINUX = ['/usr/bin/cloudflared', '/usr/local/bin/cloudflared'];

/** %USERPROFILE%\.cloudflared\<id>.json */
export const credentialsFile = (id = TUNNEL_ID, homedir = os.homedir()) => path.join(homedir, '.cloudflared', `${id}.json`);

/**
 * Where the tunnel's credentials are expected on `platform`: Windows %USERPROFILE%\.cloudflared\<id>.json
 * (where `cloudflared tunnel create` and `login` put them); Linux <home>/.cloudflared/<id>.json, inside
 * the home so the 'blumodel' account that runs the tunnel can read them.
 * @param {{ platform?: string, home?: string, homedir?: string, id?: string }} o
 */
export function credentialsFor({ platform = process.platform, home, homedir = os.homedir(), id = TUNNEL_ID }) {
  if (platform === 'win32') return path.win32.join(homedir, '.cloudflared', `${id}.json`);
  return path.posix.join(homeLayout(home, 'linux').cloudflaredDir, `${id}.json`);
}

/**
 * The cloudflared program: on Linux the first of CLOUDFLARED_LINUX that exists, else one on PATH;
 * on Windows on PATH (where.exe), else the installer's default folder. Null when there is none.
 */
export function findCloudflared({ exec = execFileSync, platform = process.platform } = {}) {
  if (platform !== 'win32') {
    for (const p of CLOUDFLARED_LINUX) if (fs.existsSync(p)) return p;
    for (const dir of String(process.env.PATH || '').split(':')) {
      const p = dir && path.posix.join(dir, 'cloudflared');
      if (p && p.startsWith('/') && fs.existsSync(p)) return p;
    }
    return null;
  }
  try {
    const first = String(exec(sys32('where.exe'), ['cloudflared'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }))
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first && fs.existsSync(first)) return first;
  } catch {
    /* not on PATH */
  }
  return fs.existsSync(CLOUDFLARED_FALLBACK) ? CLOUDFLARED_FALLBACK : null;
}

/** A domain name: letters, digits and hyphens in dot-separated labels. */
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const yamlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

/**
 * <home>\cloudflared.yml: every site this server answers for goes to the local server.
 *
 *   <hostname>          (blumodel.studio) the sales site
 *   www.<hostname>      the sales site too
 *   '*.<hostname>'      every company's showroom, <slug>.<hostname>: one rule for all of them, so
 *                       adding a company never changes this file
 *   anything else       customDomains (the default): the local server as well. A company's own
 *                       domain (showroom.acmekitchens.ca) reaches the tunnel as a Cloudflare for
 *                       SaaS custom hostname with the visitor's Host unchanged, so the tunnel can't
 *                       list them; the server is the authority on hostnames and answers 404 for a
 *                       host it has no showroom for (server/tenancy/hosts.mjs).
 *                       customDomains false: cloudflared answers 404 itself.
 *
 * Only Cloudflare reaches the tunnel, and it only sends hostnames routed to it in this account (DNS
 * records on blumodel.studio, and custom hostnames once they are active).
 * originRequest (every rule): connectTimeout 10s (the server is on this machine; a slow connect
 * means it is down, so fail fast with a 502 rather than hold the visitor), noHappyEyeballs (the
 * origin is an IPv4 literal; don't race IPv6), keepAliveTimeout 90s / keepAliveConnections 100
 * (reuse connections to the origin), tcpKeepAlive 30s. The server's own limits are in
 * server/http/listen.mjs. `platform` only changes the comment saying what runs it.
 * @param {{ tunnelId?: string, credentials: string, hostname?: string, origin?: string, platform?: string, customDomains?: boolean }} o
 */
export function tunnelConfigYaml({ tunnelId = TUNNEL_ID, credentials, hostname = HOSTNAME, origin = ORIGIN, platform = 'win32', customDomains = true }) {
  if (!/^[0-9a-f-]{36}$/.test(tunnelId)) throw new Error(`Not a tunnel id: ${tunnelId}`);
  const base = String(hostname).trim().toLowerCase();
  if (!DOMAIN.test(base)) throw new Error(`Not a hostname: ${hostname}`);
  if (base.startsWith('www.')) throw new Error(`Give the base domain (blumodel.studio), not ${hostname}: www. and *. are added for it.`);
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(origin)) throw new Error(`The origin must be http://127.0.0.1:<port> (got ${origin}).`);
  if (!credentials) throw new Error('tunnelConfigYaml needs the credentials file path');
  const runBy =
    platform === 'win32'
      ? `Run by run-tunnel.cmd (the ${TUNNEL_TASK} task starts it). cloudflared reads this at start.`
      : `Run by ${TUNNEL_UNIT} (systemd). cloudflared reads this at start: sudo systemctl restart ${TUNNEL_UNIT.replace(/\.service$/, '')}.`;
  const last = customDomains
    ? `  # Anything else: a company's own domain (a Cloudflare for SaaS custom hostname) keeps its own
  # Host. The server answers 404 for a host it has no showroom for.
  - service: ${origin}`
    : `  # Anything else: 404 (custom domains are off: setup-tunnel.mjs --no-custom-domains).
  - service: http_status:404`;
  return `# BluModel Studio: the Cloudflare tunnel '${TUNNEL_NAME}' for ${base} (the sales site), every
# showroom at <slug>.${base}${customDomains ? " and the companies' own domains" : ''}.
# Generated by blumodel-studio/scripts/tunnel/setup-tunnel.mjs: edits are overwritten.
# ${runBy}
tunnel: ${tunnelId}
credentials-file: ${yamlString(credentials)}
no-autoupdate: true
loglevel: info
originRequest:
  connectTimeout: 10s
  noHappyEyeballs: true
  keepAliveTimeout: 90s
  keepAliveConnections: 100
  tcpKeepAlive: 30s
ingress:
  # The sales site.
  - hostname: ${base}
    service: ${origin}
  - hostname: www.${base}
    service: ${origin}
  # Every company's showroom, <slug>.${base} (the wildcard DNS record *.${base} routes them here).
  - hostname: '*.${base}'
    service: ${origin}
${last}
`;
}

/**
 * Where a cloudflared.yml (its text: it holds no secret, only the credentials file's path) sends
 * each kind of host for the base domain `hostname`: `{ sales, www, showrooms, customDomains }`,
 * each true when that host reaches a http://127.0.0.1:<port> origin. A config written before
 * showrooms gives `{ sales: true, www: false, showrooms: false, customDomains: false }`. The deploy
 * reads it to say when the tunnel config needs rewriting. A line reader for the shape this module
 * writes (top-level keys, `- hostname:` / `service:` items), not a YAML parser.
 * @param {string} yaml
 * @param {string} [hostname]
 */
export function tunnelRoutes(yaml, hostname = HOSTNAME) {
  const base = String(hostname).trim().toLowerCase();
  const unquote = (v) => v.replace(/^'(.*)'$|^"(.*)"$/, (_, a, b) => a ?? b).toLowerCase();
  /** @type {{ hostname: string | null, service: string | null }[]} */
  const rules = [];
  let inIngress = false;
  let cur = null;
  for (const raw of String(yaml).split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(raw)) continue;
    const line = raw.replace(/\s+#.*$/, '');
    if (/^\S/.test(line)) {
      inIngress = /^ingress:\s*$/.test(line);
      continue;
    }
    if (!inIngress) continue;
    const item = /^\s*-\s+(hostname|service):\s*(.+?)\s*$/.exec(line);
    const field = /^\s+(hostname|service):\s*(.+?)\s*$/.exec(line);
    if (item) {
      cur = { hostname: null, service: null };
      rules.push(cur);
      cur[item[1]] = unquote(item[2]);
    } else if (field && cur) cur[field[1]] = unquote(field[2]);
  }
  const matches = (r, h) => !r.hostname || r.hostname === h || (r.hostname.startsWith('*.') && h.endsWith(r.hostname.slice(1)));
  const local = (h) => /^http:\/\/127\.0\.0\.1:\d+$/.test(rules.find((r) => matches(r, h))?.service ?? '');
  return {
    sales: local(base),
    www: local(`www.${base}`),
    showrooms: local(`some-company.${base}`),
    customDomains: local('showroom.some-company.example'),
  };
}

/**
 * The tunnel's supervisor scripts, keyed by file name (CRLF line ends). run-tunnel.cmd restarts
 * cloudflared whenever it exits (10 s later) and rotates logs\tunnel.log (10 MB, 5 kept) before
 * each start; tunnel.stopped (stop-tunnel.cmd) ends the loop.
 * `processName` is what stop-tunnel.cmd looks for (tests point it at a stand-in). start-tunnel.cmd
 * starts it through the scheduled task `task` when the home's startup-tasks file lists it.
 * @param {{ cloudflared: string, node: string, processName?: string, task?: string }} o
 */
export function tunnelScripts({ cloudflared, node, processName = 'cloudflared.exe', task = TUNNEL_TASK }) {
  if (!cloudflared || !node) throw new Error('tunnelScripts needs the cloudflared.exe and node.exe paths');
  if (!/^[\w.-]+\.exe$/i.test(processName)) throw new Error(`Not a process name: ${processName}`);
  if (!/^[\w-]+$/.test(task)) throw new Error(`Not a task name: ${task}`);
  const run = `@echo off
rem BluModel Studio: Cloudflare tunnel supervisor. Runs cloudflared with cloudflared.yml and restarts
rem it whenever it exits. Started hidden by start-tunnel.vbs (at logon by the ${TUNNEL_TASK} task).
rem Generated by blumodel-studio/scripts/tunnel/setup-tunnel.mjs: edits are overwritten.
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
:loop
if exist tunnel.stopped exit /b 0
"${node}" --no-warnings "%~dp0app\\server\\scripts\\rotate-log.mjs" "%~dp0logs\\tunnel.log" >nul 2>&1
echo [%date% %time%] starting the tunnel >> logs\\tunnel.log
"${cloudflared}" tunnel --config "%~dp0cloudflared.yml" --no-autoupdate run >> logs\\tunnel.log 2>&1
echo [%date% %time%] the tunnel exited with code %errorlevel% >> logs\\tunnel.log
if exist tunnel.stopped exit /b 0
ping -n 11 127.0.0.1 >nul
goto loop
`;
  const vbs = `' Starts the BluModel Studio tunnel supervisor (run-tunnel.cmd) with no console window.
' The ${TUNNEL_TASK} scheduled task runs this at logon.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = dir
sh.Run "cmd /c """ & dir & "\\run-tunnel.cmd""", 0, False
`;
  const start = `@echo off
rem Starts the BluModel Studio tunnel (hidden) after stop-tunnel.cmd.
cd /d "%~dp0"
if exist tunnel.stopped del tunnel.stopped
rem When its task runs at startup (register-tasks --at-startup lists it in startup-tasks), start it
rem through Task Scheduler so the tunnel keeps running after you sign out; otherwise directly.
findstr /X /C:${task} startup-tasks >nul 2>&1 && schtasks /Run /TN ${task} >nul 2>&1 && goto started
wscript.exe "%~dp0start-tunnel.vbs"
:started
echo The tunnel is starting (log: logs\\tunnel.log).
`;
  // Only the cloudflared started with THIS folder's cloudflared.yml (its full path) is stopped; any
  // other cloudflared on the machine (another tunnel, a holding page) is left alone. The path must
  // be absolute, so an empty %~dp0 can never widen the match to every "cloudflared.yml".
  const stop = `@echo off
rem Stops this folder's Cloudflare tunnel and its supervisor until start-tunnel.cmd is run again.
cd /d "%~dp0"
echo.> tunnel.stopped
powershell.exe -NoProfile -NonInteractive -Command "$c = ('%~dp0' + 'cloudflared.yml').ToLower(); if (-not ($c -match '^[a-z]:\\\\.+\\\\cloudflared\\.yml$')) { 'Not stopping anything: could not tell which folder this is.'; exit 1 }; $n = 0; Get-CimInstance Win32_Process | Where-Object { $_.Name -eq '${processName}' -and $_.CommandLine -and $_.CommandLine.ToLower().Contains($c) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $n++; 'Stopped ${processName} (pid ' + $_.ProcessId + ').' }; if ($n -eq 0) { 'No ${processName} was running with ' + $c + '.' }"
echo The tunnel is stopped. Run start-tunnel.cmd to start it again.
`;
  return {
    'run-tunnel.cmd': crlf(run),
    'start-tunnel.vbs': crlf(vbs),
    'start-tunnel.cmd': crlf(start),
    'stop-tunnel.cmd': crlf(stop),
  };
}
