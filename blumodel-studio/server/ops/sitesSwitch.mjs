// The site-wide on/off switch (docs/HOSTING.md, "Turning the sites off and on"): one switch for every
// site this server answers - blumodel.studio, www., the demo showroom, every company's showroom and
// their own domains. It is flipped from the server face (server/face/face.mjs, 127.0.0.1:8799 on the
// machine), Admin > System, or `blumodel sites on|off` (scripts/host/blumodel.mjs); no process is
// restarted and the tunnel keeps running.
//
// OFF means every host answers a calm "We'll be right back" page (HTML 503, Retry-After) and /api
// answers 503 { code: 'maintenance' }, EXCEPT what Gabe needs to turn it back on from anywhere and
// what must not be lost:
//   - GET /api/health (it says maintenance: true, and stays 200: the server is healthy, so an update's
//     health check still passes)
//   - GET /api/config on any host (the app's own boot call, and the deploy's site checks)
//   - POST /api/webhooks/* (Stripe's events keep billing right; refused ones would be retried for days)
//   - on the sales site: sign-in (/api/auth/*), the app itself at /admin (its page and static files),
//     and everything for a signed-in BluModel admin, so https://blumodel.studio/admin#/signin then
//     Admin > System turns it back on
// The state is a small file next to the database (data/sites-switch.json: on, since, by, via), so it
// survives restarts; it holds no secret. Every change is written to the admin audit log
// (sites_off / sites_on, with where it came from).

import fs from 'node:fs';
import path from 'node:path';
import { audit } from '../lib/audit.mjs';

export const STATE_FILE = 'sites-switch.json';
const VIA = new Set(['face', 'admin', 'cli']);

/** The state file for a database path, or null for an in-memory database (tests: memory only). */
export const switchFileFor = (dbPath) => (!dbPath || dbPath === ':memory:' ? null : path.join(path.dirname(path.resolve(dbPath)), STATE_FILE));

/** `{ on, since, by, via }` from the file; on (the default) when there is none or it can't be read. */
export function readSwitch(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { on: s.on !== false, since: Number.isFinite(s.since) ? s.since : null, by: typeof s.by === 'string' ? s.by.slice(0, 254) : null, via: VIA.has(s.via) ? s.via : null };
  } catch {
    return { on: true, since: null, by: null, via: null };
  }
}

/** Writes the state whole (a temp file renamed over), so a crash never leaves half of it. */
export function writeSwitch(file, state) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * The switch. `set` changes it (persisted, audited, logged) and returns the new state.
 * @param {{ db: any, file: string | null, now?: () => number, log?: any }} o
 */
export function createSitesSwitch({ db, file, now = Date.now, log = console }) {
  let state = file ? readSwitch(file) : { on: true, since: null, by: null, via: null };
  if (!state.on) log.warn?.(`All sites are OFF (maintenance) since ${state.since ? new Date(state.since).toISOString() : '?'}${state.by ? ` by ${state.by}` : ''}: turn them on from the server face, Admin > System, or \`blumodel sites on\`.`);
  return {
    isOn: () => state.on,
    state: () => ({ ...state }),
    /**
     * @param {boolean} on
     * @param {{ via: 'face' | 'admin' | 'cli', admin?: { id: string, email?: string } | null, by?: string }} o
     */
    set(on, { via, admin = null, by } = {}) {
      if (typeof on !== 'boolean') throw new Error('sites.set(on): on must be true or false');
      if (!VIA.has(via)) throw new Error(`sites.set: not a source: ${via}`);
      const changed = on !== state.on;
      const next = changed ? { on, since: now(), by: (by ?? admin?.email ?? via).slice(0, 254), via } : state;
      if (changed && file) writeSwitch(file, next);
      state = next;
      audit(db, { admin, action: on ? 'sites_on' : 'sites_off', detail: { via, changed }, at: now() });
      if (changed) log.warn?.(`All sites turned ${on ? 'ON' : 'OFF (maintenance)'} from ${via === 'face' ? 'the server face' : via === 'cli' ? 'the command line' : 'Admin > System'}${admin?.email ? ` by ${admin.email}` : ''}.`);
      return { ...state, changed };
    },
  };
}

/** Paths of the app's static files (a file name with an extension), not uploads or HTML documents. */
const STATIC = /^\/(?!files\/|api\/)[\w./-]*\.(?:js|mjs|css|svg|png|jpe?g|webp|ico|woff2?|ttf|json|webmanifest|txt|wasm|map|glb|ktx2|bin|hdr)$/i;

/**
 * What an OFF switch does with a request: 'pass', 'page' (the HTML 503) or 'api' (the JSON 503).
 * `isAdmin()` is asked only when it matters (a sales-site request that would otherwise be blocked).
 * @param {{ method: string, pathname: string, siteKind: string, isAdmin: () => boolean }} r
 */
export function maintenanceGate({ method, pathname, siteKind, isAdmin }) {
  const read = method === 'GET' || method === 'HEAD';
  const api = pathname === '/api' || pathname.startsWith('/api/');
  if (read && pathname === '/api/health') return 'pass';
  if (read && pathname === '/api/config') return 'pass';
  if (method === 'POST' && pathname.startsWith('/api/webhooks/')) return 'pass';
  if (siteKind === 'sales') {
    if (api && pathname.startsWith('/api/auth/')) return 'pass';
    if (read && (pathname === '/admin' || pathname === '/admin/' || STATIC.test(pathname))) return 'pass';
    if (isAdmin()) return 'pass';
  }
  return api || !read ? 'api' : 'page';
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The page every site shows while the switch is off. Self-contained: no script, no external file. */
export function maintenancePage({ hostname = '' } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<link rel="icon" href="data:,">
<title>We’ll be right back</title>
<style>
:root { --bg: #f6f5f2; --card: #ffffff; --ink: #1d2328; --muted: #5b6670; --line: #e2e0da; --accent: #1f4f8a; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #14181c; --card: #1c2228; --ink: #eef1f4; --muted: #a7b0b8; --line: #2c343c; --accent: #7fb0ec; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px; background: var(--bg); color: var(--ink);
  font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 34rem; width: 100%; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 32px 28px; }
h1 { margin: 0 0 12px; font-size: 1.5rem; line-height: 1.25; }
p { margin: 0 0 12px; color: var(--muted); }
.bar { width: 48px; height: 4px; border-radius: 2px; background: var(--accent); margin-bottom: 20px; }
</style>
</head>
<body><main><div class="bar"></div><h1>We’ll be right back</h1><p>${esc(hostname || 'This site')} is offline for a short while for maintenance. Nothing is lost: your account and your saved designs are safe.</p><p>Please try again in a few minutes.</p></main></body>
</html>`;
}
