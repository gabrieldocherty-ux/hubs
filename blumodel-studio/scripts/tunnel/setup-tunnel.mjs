// Writes the Cloudflare tunnel's files into the home server's folder: cloudflared.yml (the tunnel
// 'blumodel' -> http://127.0.0.1:8790 for blumodel.studio, everything else 404) and run-tunnel.cmd,
// start-tunnel.vbs, start-tunnel.cmd, stop-tunnel.cmd (a supervisor that restarts cloudflared and
// rotates logs\tunnel.log). It never starts, stops or changes the tunnel, its DNS routes or its
// credentials (the credentials file is checked for existence only, never opened).
//
//   node scripts/tunnel/setup-tunnel.mjs --dry-run       # print what it would write
//   node scripts/tunnel/setup-tunnel.mjs --validate      # write, then check the config with
//                                                        # `cloudflared tunnel --config <file> ingress validate`
//                                                        # and `ingress rule https://blumodel.studio/` (offline)
//   options: --home <dir> (default %USERPROFILE%\Projects\BluModelStudio)  --port 8790
//            --hostname blumodel.studio  --tunnel-id <id>  --cloudflared <path to cloudflared.exe>
//
// Then start it with start-tunnel.cmd (or the BluModelTunnel task: node scripts/register-tasks.mjs).
// Rewriting run-tunnel.cmd while it runs would make cmd.exe read a changed file mid-loop, so this
// refuses when this folder's tunnel supervisor is running and the script would change (stop-tunnel.cmd first).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { defaultHome, homeLayout, homeProcesses } from '../../server/ops/home.mjs';
import { CLOUDFLARED_FALLBACK, HOSTNAME, TUNNEL_ID, credentialsFile, findCloudflared, tunnelConfigYaml, tunnelScripts } from './tunnel.mjs';

const argv = process.argv.slice(2);
const opt = (flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const valued = ['--home', '--port', '--hostname', '--tunnel-id', '--cloudflared'];
const bad = argv.filter((a, i) => a.startsWith('--') && !['--dry-run', '--validate', ...valued].includes(a) && !valued.includes(argv[i - 1]));
if (bad.length) {
  console.error(`Unknown option ${bad.join(' ')}. Usage: node scripts/tunnel/setup-tunnel.mjs [--dry-run] [--validate] [--home <dir>] [--port 8790] [--hostname ${HOSTNAME}] [--tunnel-id <id>] [--cloudflared <exe>]`);
  process.exit(2);
}
if (process.platform !== 'win32') {
  console.error('setup-tunnel is written for the Windows home server.');
  process.exit(1);
}

const dryRun = argv.includes('--dry-run');
const L = homeLayout(opt('--home') || defaultHome());
const port = Number(opt('--port') || 8790);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('--port must be a port number.');
  process.exit(2);
}
const tunnelId = opt('--tunnel-id') || TUNNEL_ID;
const hostname = opt('--hostname') || HOSTNAME;
const cloudflared = opt('--cloudflared') || findCloudflared();
const credentials = credentialsFile(tunnelId);

if (!cloudflared || !fs.existsSync(cloudflared)) {
  console.error(`cloudflared.exe not found (looked on PATH and in ${CLOUDFLARED_FALLBACK}). Install it, or pass --cloudflared <path>.`);
  process.exit(1);
}
if (!fs.existsSync(credentials)) console.warn(`Warning: the tunnel's credentials file ${credentials} does not exist; cloudflared won't connect without it.`);

const files = {
  'cloudflared.yml': tunnelConfigYaml({ tunnelId, credentials, hostname, origin: `http://127.0.0.1:${port}` }),
  ...tunnelScripts({ cloudflared, node: process.execPath }),
};

if (dryRun) {
  for (const [name, body] of Object.entries(files)) {
    console.log(`── would write ${path.join(L.home, name)}`);
    console.log(body.replace(/\r\n/g, '\n'));
  }
  console.log('Dry run: nothing was written.');
  process.exit(0);
}

if (!fs.existsSync(L.home)) {
  console.error(`${L.home} does not exist. Deploy (or migrate) the home first, or pass --home.`);
  process.exit(1);
}
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
console.log(`Wrote cloudflared.yml (${hostname} -> http://127.0.0.1:${port}, tunnel ${tunnelId}) and the tunnel scripts to ${L.home}.`);
if (running.length) console.log('The running tunnel reads cloudflared.yml only when it starts: restart it (stop-tunnel.cmd, start-tunnel.cmd) to apply a change.');

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
  const r = run(['tunnel', '--config', L.tunnelConfig, 'ingress', 'rule', `https://${hostname}/`]);
  const matched = /http:\/\/127\.0\.0\.1:\d+/.exec(r.out)?.[0];
  console.log(`${matched === `http://127.0.0.1:${port}` ? 'PASS' : 'FIX '}  https://${hostname}/ goes to ${matched ?? '(no match)'}`);
  const other = run(['tunnel', '--config', L.tunnelConfig, 'ingress', 'rule', 'https://not-this-site.example/']);
  console.log(`${/http_status:404/.test(other.out) ? 'PASS' : 'FIX '}  any other hostname gets a 404`);
  if (!v.ok || matched !== `http://127.0.0.1:${port}` || !/http_status:404/.test(other.out)) process.exit(1);
}
