// The `blumodel` command on the server machine, for SSH and for a Claude Code session there
// (docs/HOSTING.md, "Turning the sites off and on"):
//
//   blumodel sites status            ON or OFF, and every site with its status
//   blumodel sites off [--yes]       every site answers "We'll be right back" (asks first without --yes)
//   blumodel sites on
//   options: --port <n> (default SERVER_FACE_PORT, else 8799)  --pin <PIN> (default BLUMODEL_FACE_PIN;
//            asked for when the face has a PIN and none is given)  --json (status as JSON)
//
// Installed as <home>\blumodel.cmd on Windows and /usr/local/bin/blumodel on Linux. It talks to the
// running server's face on 127.0.0.1 (server/face/face.mjs): the same switch, audited the same way,
// no restart. It needs no admin rights; the face answers only on this machine. Exit codes: 0 done;
// 1 refused or the server didn't answer; 2 bad usage.

import http from 'node:http';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** One request to the face: `{ status, body, text }`. */
export function faceRequest(port, method, p, { body, token, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: p,
        agent: false,
        timeout: timeoutMs,
        headers: { Connection: 'close', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...(token ? { 'X-Face-Token': token, 'X-Face-Client': 'cli' } : {}) },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => (text += d));
        res.on('end', () => {
          let parsed = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = null;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, text });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/** The token the face's page carries (<meta name="face-token">). */
export const tokenOf = (html) => /<meta name="face-token" content="([A-Za-z0-9_-]+)">/.exec(String(html ?? ''))?.[1] ?? null;

/** Status as text lines. */
export function statusLines(s) {
  const out = [`All sites are ${s.sitesOn ? 'ON' : 'OFF (maintenance: visitors see "We\'ll be right back")'}${s.since ? ` since ${new Date(s.since).toLocaleString()}${s.by ? ` (${s.by})` : ''}` : ''}.`];
  for (const x of s.sites ?? []) out.push(`  ${x.up ? '[up]  ' : '[DOWN]'} ${x.address.padEnd(36)} ${x.name} (${s.sitesOn ? x.label : 'off'})`);
  out.push(`Memory ${s.memoryMb} MB; deployed ${s.commit ?? 'n/a'}; up ${Math.floor((s.uptimeSec ?? 0) / 60)} min.`);
  return out;
}

async function ask(q, { hidden = false } = {}) {
  if (!process.stdin.isTTY) return '';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => rl.output.write(/\r?\n/.test(s) ? '\n' : s === q ? s : '');
  const a = await new Promise((resolve) => rl.question(q, resolve));
  rl.close();
  return String(a).trim();
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const usage = 'Usage: blumodel sites status|on|off [--yes] [--port 8799] [--pin <PIN>] [--json]';
  const valued = ['--port', '--pin'];
  const opt = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const words = argv.filter((a, i) => !a.startsWith('--') && !valued.includes(argv[i - 1]));
  const bad = argv.filter((a, i) => a.startsWith('--') && !['--yes', '--json', ...valued].includes(a));
  if (bad.length || words[0] !== 'sites' || !['status', 'on', 'off'].includes(words[1]) || words.length > 2) {
    console.error(usage);
    process.exit(2);
  }
  const port = Number(opt('--port') ?? process.env.SERVER_FACE_PORT ?? 8799);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('--port takes a port number.');
    process.exit(2);
  }
  const cmd = words[1];
  try {
    const page = await faceRequest(port, 'GET', '/');
    if (page.status !== 200) throw new Error(`the server face answered HTTP ${page.status}`);
    const token = tokenOf(page.text);
    let s = (await faceRequest(port, 'GET', '/status')).body;
    if (cmd !== 'status' && s.sitesOn === (cmd === 'on')) {
      console.log(`All sites are already ${cmd.toUpperCase()}.`);
    } else if (cmd !== 'status') {
      if (cmd === 'off' && !argv.includes('--yes')) {
        const a = await ask('Turn EVERY site off (blumodel.studio, www, the demo and every showroom)? Visitors see "We\'ll be right back". [y/N] ');
        if (!/^y(es)?$/i.test(a)) {
          console.log('Nothing changed.');
          process.exit(1);
        }
      }
      let pin = opt('--pin') ?? process.env.BLUMODEL_FACE_PIN;
      if (s.pinRequired && !pin) pin = await ask('PIN: ', { hidden: true });
      const r = await faceRequest(port, 'POST', '/sites', { token, body: { on: cmd === 'on', ...(pin ? { pin } : {}) } });
      if (r.status !== 200) throw new Error(r.body?.error ?? `HTTP ${r.status}`);
      s = r.body;
      console.log(`Done: all sites are ${s.sitesOn ? 'ON' : 'OFF'}. (Recorded in the admin audit log.)`);
    }
    if (argv.includes('--json')) console.log(JSON.stringify(s, null, 2));
    else for (const l of statusLines(s)) console.log(l);
    process.exit(0);
  } catch (err) {
    console.error(`Could not reach the server face on 127.0.0.1:${port}: ${err?.message ?? err}. Is the server running (Linux: systemctl status blumodel-studio; Windows: http://127.0.0.1:8790/api/health)? Is SERVER_FACE_PORT another port (--port)?`);
    process.exit(1);
  }
}
