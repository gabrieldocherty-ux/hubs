// Pieces shared by scripts/deploy-local.mjs, scripts/host/build.mjs and scripts/host/update.mjs:
// the build's memory guard, putting a new app\ in place while keeping the old one for a rollback,
// DEPLOYED.txt, the health check, the Linux service and running a command as the service account.
// Tested in server/test/host.test.mjs. Nothing here reads a settings or credentials file.

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Exit codes of deploy-local (update.mjs reads them): REFUSED changed nothing; UNHEALTHY means the new app is in place but failed its health check. */
export const EXIT = Object.freeze({ OK: 0, REFUSED: 1, USAGE: 2, UNHEALTHY: 3 });

const MiB = 1024 * 1024;

// ── the build's memory guard ─────────────────────────────────────────────────

/** RAM plus swap below this and the build is refused with a way out (vite needs ~0.8 GB; the OS and npm the rest). */
export const BUILD_MIN_MB = 2048;

/** `{ ram, swap }` in bytes from the text of /proc/meminfo (kB values). */
export function parseMeminfo(text) {
  const kb = (key) => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm').exec(String(text ?? ''));
    return m ? Number(m[1]) * 1024 : 0;
  };
  return { ram: kb('MemTotal'), swap: kb('SwapTotal') };
}

/** This machine's RAM and swap in bytes (swap from /proc/meminfo on Linux; 0 elsewhere). */
export function machineMemory({ platform = process.platform, readFile = fs.readFileSync, totalmem = os.totalmem } = {}) {
  if (platform === 'linux') {
    try {
      const m = parseMeminfo(readFile('/proc/meminfo', 'utf8'));
      if (m.ram) return m;
    } catch {
      /* fall through */
    }
  }
  return { ram: totalmem(), swap: 0 };
}

/**
 * How big a heap the build gets (NODE_OPTIONS=--max-old-space-size), or why it can't run:
 * half the RAM, at least 1024 MB and at most 2048 MB (a 4 GB Wyse gets about 1900), refused when
 * RAM plus swap is under BUILD_MIN_MB.
 * @param {{ ram: number, swap?: number, platform?: string }} o bytes
 * @returns {{ ok: boolean, ramMb: number, swapMb: number, heapMb: number, message: string }}
 */
export function buildMemoryPlan({ ram, swap = 0, platform = process.platform }) {
  const ramMb = Math.floor(ram / MiB);
  const swapMb = Math.floor(swap / MiB);
  if (ramMb + swapMb < BUILD_MIN_MB) {
    const fix =
      platform === 'win32'
        ? '  Close other programs, or let Windows manage the paging file (System > About > Advanced system settings > Performance > Advanced > Virtual memory).'
        : [
            '  Add a 2 GB swap file, then run this again:',
            '    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile',
            "    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab",
          ].join('\n');
    return {
      ok: false,
      ramMb,
      swapMb,
      heapMb: 0,
      message:
        `This machine has ${ramMb} MB of RAM and ${swapMb} MB of swap. Building BluModel Studio needs about ${BUILD_MIN_MB} MB between them (the build itself uses about 1 GB).\n${fix}\n` +
        '  Or build on another computer and copy the dist folder over: node scripts/deploy-local.mjs --dist <folder> (docs/HOSTING.md).',
    };
  }
  const heapMb = Math.max(1024, Math.min(2048, Math.floor(ramMb / 2)));
  return { ok: true, ramMb, swapMb, heapMb, message: `Building with a ${heapMb} MB heap (RAM ${ramMb} MB, swap ${swapMb} MB).` };
}

// ── the deployed app ─────────────────────────────────────────────────────────

/** Files outside server/ that the server imports at runtime: every JSON file in src/data/, at the same relative path. */
export const runtimeFiles = (root) =>
  fs
    .readdirSync(path.join(root, 'src', 'data'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => `src/data/${f}`);

/** DEPLOYED.txt's text. `uncommitted` (deploy-local's clean-checkout check) is recorded when given. */
export const deployedText = ({ commit, root, now = new Date(), uncommitted = null }) =>
  `commit ${commit}\n${uncommitted ? `uncommitted changes: ${uncommitted}\n` : ''}deployed ${now.toISOString()}\nfrom ${root}\n`;

/** `{ commit, deployed, from }` from <app>/DEPLOYED.txt, or null when there is no deployed app. */
export function readDeployed(appDir) {
  let text = '';
  try {
    text = fs.readFileSync(path.join(appDir, 'DEPLOYED.txt'), 'utf8');
  } catch {
    return null;
  }
  const get = (k) => new RegExp(`^${k} (.+)$`, 'm').exec(text)?.[1]?.trim() ?? null;
  return { commit: get('commit'), deployed: get('deployed'), from: get('from') };
}

/** Linux: the code is root's and read-only to everyone else in the home (dirs 755, files 644). */
export function normalizeModes(dir) {
  const walk = (p) => {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      fs.chmodSync(p, 0o755);
      for (const e of fs.readdirSync(p)) walk(path.join(p, e));
    } else fs.chmodSync(p, 0o644);
  };
  walk(dir);
}

/**
 * Builds <home>/app.new from a build: dist/ (the vite output), server/ (not server/data or
 * server/test; server/generated, the export kit, goes with it), every src/data/*.json,
 * package.json and DEPLOYED.txt.
 * @param {{ root: string, dist: string, staging: string, commit: string, uncommitted?: string | null, now?: Date, platform?: string }} o
 */
export function stageApp({ root, dist, staging, commit, uncommitted = null, now = new Date(), platform = process.platform }) {
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(dist, path.join(staging, 'dist'), { recursive: true });
  const serverDir = path.join(root, 'server');
  fs.cpSync(serverDir, path.join(staging, 'server'), {
    recursive: true,
    filter: (src) => {
      const first = path.relative(serverDir, src).split(/[\\/]/)[0];
      return first !== 'data' && first !== 'test';
    },
  });
  for (const rel of runtimeFiles(root)) {
    fs.mkdirSync(path.dirname(path.join(staging, rel)), { recursive: true });
    fs.copyFileSync(path.join(root, rel), path.join(staging, rel));
  }
  fs.copyFileSync(path.join(root, 'package.json'), path.join(staging, 'package.json'));
  fs.writeFileSync(path.join(staging, 'DEPLOYED.txt'), deployedText({ commit, root, now, uncommitted }));
  if (platform !== 'win32') normalizeModes(staging);
}

/**
 * Puts app.new in place of app, keeping the app it replaces as app.previous (the one before that
 * is deleted). Renames only, so each step is all or nothing; if the second rename fails the old app
 * is put back before the error is thrown. Returns whether there was an app to keep.
 * @param {{ app: string, appNew: string, appPrevious: string }} L
 */
export function swapInApp(L) {
  const had = fs.existsSync(L.app);
  if (had) {
    fs.rmSync(L.appPrevious, { recursive: true, force: true });
    fs.renameSync(L.app, L.appPrevious);
  }
  try {
    fs.renameSync(L.appNew, L.app);
  } catch (err) {
    if (had && !fs.existsSync(L.app)) fs.renameSync(L.appPrevious, L.app);
    throw err;
  }
  return { kept: had };
}

/**
 * The rollback: app.previous becomes app again; the app it replaces is kept as app.failed (the
 * one before that is deleted). Throws when there is no app.previous.
 * @param {{ app: string, appPrevious: string, appFailed: string }} L
 */
export function rollbackApp(L) {
  if (!fs.existsSync(L.appPrevious)) throw new Error(`There is no ${path.basename(L.appPrevious)} to go back to (it exists after a deploy has replaced an app).`);
  fs.rmSync(L.appFailed, { recursive: true, force: true });
  const had = fs.existsSync(L.app);
  if (had) fs.renameSync(L.app, L.appFailed);
  try {
    fs.renameSync(L.appPrevious, L.app);
  } catch (err) {
    if (had && !fs.existsSync(L.app)) fs.renameSync(L.appFailed, L.app);
    throw err;
  }
  return { failedKept: had };
}

// ── the health check ─────────────────────────────────────────────────────────

/** Is something accepting connections on host:port? */
export const listening = (port, host = '127.0.0.1') =>
  new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(1500, () => done(false));
  });

/**
 * GET http://127.0.0.1:port<p> as `{ status, body }` on a connection that closes after the reply
 * (fetch's pooled keep-alive sockets can trip a libuv assertion when the process exits on Windows).
 */
export const getJson = (port, p, { timeoutMs = 5000 } = {}) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: Number(port), path: p, agent: false, headers: { Connection: 'close' }, timeout: timeoutMs }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (text += d));
      res.on('end', () => {
        let body = {};
        try {
          body = JSON.parse(text);
        } catch {
          body = {};
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });

/**
 * Polls /api/health on 127.0.0.1:port until it answers 200 (`ok`), 503 (a problem the server
 * reports, e.g. a database that failed its integrity check) or the time runs out.
 * @returns {Promise<{ ok: boolean, status: number, body: any, payments?: string }>}
 */
export async function waitForHealth({ port, timeoutMs = 60_000, intervalMs = 1000, get = getJson, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    try {
      const h = await get(port, '/api/health');
      if (h.status === 200) {
        const payments = (await get(port, '/api/config').catch(() => ({ body: {} }))).body?.payments ?? '?';
        return { ok: true, status: 200, body: h.body, payments };
      }
      if (h.status === 503) return { ok: false, status: 503, body: h.body };
    } catch {
      /* not up yet */
    }
  }
  return { ok: false, status: 0, body: null };
}

// ── Linux: the service and its account ──────────────────────────────────────

/**
 * A unit's state from `systemctl show`: `{ installed, enabled, active }`.
 * @param {string} unit
 * @param {{ exec?: typeof execFileSync }} [o]
 */
export function unitState(unit, { exec = execFileSync } = {}) {
  let out = '';
  try {
    out = String(exec('systemctl', ['show', '-p', 'LoadState', '-p', 'UnitFileState', '-p', 'ActiveState', unit], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return { installed: false, enabled: false, active: false };
  }
  const v = (k) => new RegExp(`^${k}=(.*)$`, 'm').exec(out)?.[1]?.trim() ?? '';
  return { installed: v('LoadState') === 'loaded', enabled: v('UnitFileState') === 'enabled', active: ['active', 'activating', 'reloading'].includes(v('ActiveState')) };
}

/**
 * The command that runs `cmd args` as `user` when this process is root on Linux (runuser, with
 * HOME set to the account's home so git and npm use its config and cache), else as is.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ user?: string | null, home?: string, root?: boolean, envPath?: string }} o
 * @returns {[string, string[]]}
 */
export function asServiceUser(cmd, args, { user, home, root, envPath = process.env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' }) {
  if (!root || !user) return [cmd, args];
  return ['runuser', ['-u', user, '--', 'env', `HOME=${home}`, `PATH=${envPath}`, cmd, ...args]];
}

/** A command as one line for printing (quotes what has spaces). */
export const showCommand = (cmd, args = []) => [cmd, ...args].map((a) => (/^[\w./:=@%+,-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '\\"')}"`)).join(' ');
