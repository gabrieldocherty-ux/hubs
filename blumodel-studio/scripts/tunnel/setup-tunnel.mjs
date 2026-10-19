// Writes the Cloudflare tunnel's files into the home server's folder: cloudflared.yml (the tunnel
// 'blumodel' -> http://127.0.0.1:8790 for blumodel.studio, www.blumodel.studio, every showroom at
// *.blumodel.studio and, unless --no-custom-domains, the companies' own domains: tunnelConfigYaml
// in tunnel.mjs says why) and, on Windows,
// run-tunnel.cmd, start-tunnel.vbs, start-tunnel.cmd, stop-tunnel.cmd (a supervisor that restarts
// cloudflared and rotates logs\tunnel.log). On Linux blumodel-tunnel.service runs cloudflared
// (scripts/register-tasks.mjs installs it), so only cloudflared.yml is written, plus an empty
// <home>/.cloudflared/ (mode 700) for the credentials you copy in. It never starts, stops or changes
// the tunnel, its DNS routes or its credentials (the credentials file is checked for existence
// only, never opened, copied or moved).
//
//   node scripts/tunnel/setup-tunnel.mjs --dry-run       # print what it would write
//   node scripts/tunnel/setup-tunnel.mjs --validate      # write, then check the config with
//                                                        # `cloudflared tunnel --config <file> ingress validate`
//                                                        # and `ingress rule` for blumodel.studio, www., a
//                                                        # showroom and a custom domain (all offline)
//   options: --home <dir> (default: Windows %USERPROFILE%\Projects\BluModelStudio, Linux /srv/blumodel-studio)
//            --port 8790  --hostname blumodel.studio (the base domain: www. and *. are added)  --tunnel-id <id>
//            --no-custom-domains    a host that isn't the base domain, www. or a showroom gets a 404
//                                   from cloudflared. Default: it goes to the server, which answers
//                                   404 for a host it has no showroom for; companies' own domains
//                                   (Cloudflare custom hostnames) need that (docs/ONBOARDING_A_COMPANY.md)
//            --credentials <file>   the tunnel's <id>.json (default: Windows %USERPROFILE%\.cloudflared\<id>.json,
//                                   Linux <home>/.cloudflared/<id>.json)
//            --cloudflared <path>   the program (needed on Windows, and for --validate)
//            --platform win32|linux with --dry-run only: show what it would write on the other platform
// On Linux run it with sudo (the home belongs to the 'blumodel' account).
//
// Then start it: Windows start-tunnel.cmd (or the BluModelTunnel task: node scripts/register-tasks.mjs);
// Linux sudo systemctl enable --now blumodel-tunnel, ONLY at the cutover (docs/HOSTING.md).
// Rewriting run-tunnel.cmd while it runs would make cmd.exe read a changed file mid-loop, so on
// Windows this refuses when this folder's tunnel supervisor is running and the script would change
// (stop-tunnel.cmd first).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TUNNEL_UNIT, defaultHome, giveToServiceUser, homeLayout, homeProcesses, pathFor } from '../../server/ops/home.mjs';
import { CLOUDFLARED_FALLBACK, CLOUDFLARED_LINUX, HOSTNAME, TUNNEL_ID, credentialsFor, findCloudflared, tunnelConfigYaml, tunnelScripts } from './tunnel.mjs';

const argv = process.argv.slice(2);
const opt = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const valued = ['--home', '--port', '--hostname', '--tunnel-id', '--cloudflared', '--credentials', '--platform'];
const bad = argv.filter((a, i) => a.startsWith('--') && !['--dry-run', '--validate', '--no-custom-domains', ...valued].includes(a) && !valued.includes(argv[i - 1]));
if (bad.length) {
  console.error(`Unknown option ${bad.join(' ')}. Usage: node scripts/tunnel/setup-tunnel.mjs [--dry-run] [--validate] [--no-custom-domains] [--home <dir>] [--port 8790] [--hostname ${HOSTNAME}] [--tunnel-id <id>] [--credentials <file>] [--cloudflared <path>]`);
  process.exit(2);
}

const dryRun = argv.includes('--dry-run');
const platform = opt('--platform') || process.platform;
if (platform !== process.platform && !dryRun) {
  console.error('--platform only works with --dry-run (it shows what would be written on another platform).');
  process.exit(2);
}
if (!['win32', 'linux'].includes(platform)) {
  console.error(`setup-tunnel knows Windows and Linux homes (this is ${platform}).`);
  process.exit(1);
}
const WIN = platform === 'win32';
const P = pathFor(platform);
const L = homeLayout(opt('--home') || defaultHome(undefined, platform), platform);
const port = Number(opt('--port') || 8790);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('--port must be a port number.');
  process.exit(2);
}
const tunnelId = opt('--tunnel-id') || TUNNEL_ID;
const hostname = String(opt('--hostname') || HOSTNAME).toLowerCase();
const customDomains = !argv.includes('--no-custom-domains');
const routesNote = `${hostname}, www.${hostname}, *.${hostname}${customDomains ? ' and custom domains' : ''} -> http://127.0.0.1:${port}, tunnel ${tunnelId}`;
const credentials = opt('--credentials') ? P.resolve(opt('--credentials')) : credentialsFor({ platform, home: L.home, id: tunnelId });
const cloudflared = opt('--cloudflared') || findCloudflared({ platform });
const needProgram = WIN || argv.includes('--validate');

if (needProgram && !dryRun && (!cloudflared || !fs.existsSync(cloudflared))) {
  console.error(
    WIN
      ? `cloudflared.exe not found (looked on PATH and in ${CLOUDFLARED_FALLBACK}). Install it (winget install --id Cloudflare.cloudflared), or pass --cloudflared <path>.`
      : `cloudflared not found (looked in ${CLOUDFLARED_LINUX.join(', ')} and on PATH). scripts/host/install-linux.sh installs it from Cloudflare's apt repository, or pass --cloudflared <path>.`,
  );
  process.exit(1);
}

let files;
try {
  files = {
    'cloudflared.yml': tunnelConfigYaml({ tunnelId, credentials, hostname, origin: `http://127.0.0.1:${port}`, platform, customDomains }),
    ...(WIN ? tunnelScripts({ cloudflared: cloudflared || CLOUDFLARED_FALLBACK, node: process.execPath }) : {}),
  };
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

const credentialsNote = () =>
  WIN
    ? `the tunnel's credentials file ${credentials} does not exist; cloudflared won't connect without it (docs/HOSTING.md, "Move the tunnel").`
    : `the tunnel's credentials file ${credentials} does not exist; cloudflared won't connect without it. Copy ${tunnelId}.json there yourself, then: sudo chown blumodel-tunnel:blumodel-tunnel ${credentials} && sudo chmod 600 ${credentials} (docs/HOSTING.md, "Move the tunnel").`;

if (dryRun) {
  for (const [name, body] of Object.entries(files)) {
    console.log(`── would write ${P.join(L.home, name)}`);
    console.log(body.replace(/\r\n/g, '\n'));
  }
  if (!WIN) console.log(`── would create ${L.cloudflaredDir} (mode 700, owned by blumodel) if missing, for the credentials`);
  if (!fs.existsSync(credentials)) console.log(`Note: ${credentialsNote()}`);
  console.log('Dry run: nothing was written.');
  process.exit(0);
}

if (!fs.existsSync(L.home)) {
  console.error(`${L.home} does not exist. Deploy (or install) the home first, or pass --home.`);
  process.exit(1);
}

if (WIN) {
  const running = homeProcesses(L.home).tunnels;
  let current = '';
  try {
    current = fs.readFileSync(L.runTunnel, 'utf8');
  } catch {
    current = '';
  }
  if (running.length && current !== files['run-tunnel.cmd']) {
    console.error(`This folder's tunnel is running (${running.map((p) => `${p.name} pid ${p.pid}`).join(', ')}) and run-tunnel.cmd would change. Run stop-tunnel.cmd first, then this, then start-tunnel.cmd.`);
    process.exit(1);
  }
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(L.home, name), body);
  console.log(`Wrote cloudflared.yml (${routesNote}) and the tunnel scripts to ${L.home}.`);
  if (running.length) console.log('The running tunnel reads cloudflared.yml only when it starts: restart it (stop-tunnel.cmd, start-tunnel.cmd) to apply a change.');
} else {
  // Nothing secret is in cloudflared.yml: readable by the 'blumodel' account that runs the tunnel.
  fs.writeFileSync(L.tunnelConfig, files['cloudflared.yml'], { mode: 0o644 });
  fs.chmodSync(L.tunnelConfig, 0o644);
  if (!fs.existsSync(L.cloudflaredDir)) {
    fs.mkdirSync(L.cloudflaredDir, { mode: 0o700 });
    try {
      giveToServiceUser(L.cloudflaredDir);
    } catch (err) {
      console.warn(`Could not give ${L.cloudflaredDir} to the blumodel account (${err?.message ?? err}).`);
    }
    console.log(`Made ${L.cloudflaredDir} (mode 700) for the tunnel's credentials.`);
  }
  console.log(`Wrote ${L.tunnelConfig} (${routesNote}).`);
  let active = false;
  try {
    active = String(execFileSync('systemctl', ['is-active', TUNNEL_UNIT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).trim() === 'active';
  } catch {
    active = false;
  }
  if (active) console.log(`${TUNNEL_UNIT} is running and reads cloudflared.yml only when it starts: sudo systemctl restart ${TUNNEL_UNIT.replace(/\.service$/, '')} to apply a change.`);
}
if (!fs.existsSync(credentials)) console.warn(`Warning: ${credentialsNote()}`);

if (argv.includes('--validate')) {
  // Both are offline checks of the file: they don't connect, route or change anything.
  const run = (args) => {
    try {
      return { ok: true, out: execFileSync(cloudflared, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) };
    } catch (err) {
      return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };
  const v = run(['tunnel', '--config', L.tunnelConfig, 'ingress', 'validate']);
  console.log(`${v.ok ? 'PASS' : 'FIX '}  cloudflared ingress validate: ${v.out.trim().split(/\r?\n/).pop()}`);
  let ok = v.ok;
  // Each address: the rule cloudflared picks for it (its hostname line; none for the last,
  // catch-all rule) and where that rule sends it.
  const origin = `http://127.0.0.1:${port}`;
  const checks = [
    { url: `https://${hostname}/`, label: 'the sales site', rule: hostname, to: origin },
    { url: `https://www.${hostname}/`, label: 'the sales site, www', rule: `www.${hostname}`, to: origin },
    { url: `https://acme.${hostname}/`, label: 'a showroom', rule: `*.${hostname}`, to: origin },
    customDomains
      ? { url: 'https://showroom.acmekitchens.example/', label: "a company's own domain; the server decides", rule: null, to: origin }
      : { url: 'https://showroom.acmekitchens.example/', label: 'any other hostname, --no-custom-domains', rule: null, to: 'http_status:404' },
  ];
  for (const c of checks) {
    const r = run(['tunnel', '--config', L.tunnelConfig, 'ingress', 'rule', c.url]);
    const service = /service: (\S+)/.exec(r.out)?.[1] ?? null;
    const rule = /hostname: (\S+)/.exec(r.out)?.[1] ?? null;
    const pass = r.ok && service === c.to && rule === c.rule;
    ok &&= pass;
    console.log(`${pass ? 'PASS' : 'FIX '}  ${c.url} (${c.label}) goes to ${service ?? '(no match)'} by ${rule ? `the rule for ${rule}` : 'the last rule'}`);
  }
  if (!ok) process.exit(1);
}
