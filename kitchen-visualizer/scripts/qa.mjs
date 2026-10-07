// Headless QA for Mise (BUILD_PLAN §3.7, F-T12). Zero dependencies: the built app, Node's
// built-in WebSocket + node:sqlite, and the installed Edge driven over CDP (scripts/qa-shot.mjs).
//
//   npm run build
//   node scripts/qa.mjs --pkg core --port 8811
//   node scripts/qa.mjs --pkg all --port 8817 --dist .build/x --only home-signed-in,local-3d
//
// Options
//   --pkg <name|all>   scripts/qa/routes/<name>.mjs, or every routes file (core first)
//   --port <p>         port for the app (never 8787 or 8790; packages use 8811–8829)
//   --dist <dir>       built client to serve (default: dist/)
//   --only <a,b>       just these route names (or <pkg>/<name>)
//   --timeout <ms>     how long waitFor / expectText may take per route (default 20000)
//   --swiftshader      software WebGL instead of the GPU
//   --chrome           Chrome instead of Edge
//   --keep             keep the temp database, uploads and server log (the path is printed)
//   --strict-external  fail on the KNOWN_EXTERNAL requests too (they are always blocked)
//   --list             print the routes and exit
//
// What it does: makes a temp DB + upload dir, runs the seeds (server/seed/index.mjs), starts
// `server/index.mjs --prod` with PAYMENTS=demo DEMO_PAYMENTS=1 and ADMIN_EMAILS for the demo
// admin, logs in the users the routes ask for, and opens each route in its own clean browser
// context at http://127.0.0.1:<port>/?qa=1#<path>. A route fails on a console error, an
// uncaught exception, any request to a non-local host (blocked, never sent; the few the app is
// known to make are listed in KNOWN_EXTERNAL and reported without failing), a 5xx, a missing
// static asset, a waitFor/expectText that never appears, or a check that throws.
// Screenshots go to .qa/<pkg>/<name>.png and results to .qa/<pkg>/report.json. The browser and
// server process trees are always killed (by PID) and the temp dir removed, pass or fail.
//
// Route files export an array (see scripts/qa/routes/core.mjs for worked examples):
//   { name, path: '#/local', as: 'anon'|'customer'|'contractor'|'brand'|'studio'|'admin'|'fresh',
//     viewport: 'desktop'|'phone'|'tablet'|'phone-landscape'|{ w, h, dpr?, mobile? },
//     waitFor: '.plan-view canvas' | [...], waitMs, expectText: 'Text' | [...] (visible text, any case), timeoutMs, fullPage,
//     setup: async ({ api, as, me, user, base, sleep }) => ({ path?, ...data }),
//     check: async ({ evaluate, send, api, sleep, mouseDrag, touchDrag, pinch, tap, click, rectOf,
//                     key, type, waitFor, waitForText, reload, goto, shot, note, data, me, viewport }) => {},
//     ignoreConsole: [/known message/], knownIssue: 'why this route is expected to fail' }
// `as: 'fresh'` is a brand-new free customer made for that route alone. `knownIssue` reports a
// failure as known instead of failing the run, and fails the run if the route starts passing
// (so the marker gets removed once the bug is fixed).

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashPassword } from '../server/auth/passwords.mjs';
import { assertAllowedPort, isLocalUrl, killTree, launchBrowser, openPage, resolveViewport, sleep } from './qa-shot.mjs';

// node:sqlite prints an ExperimentalWarning on load; it is expected here, so keep it out of the output.
const { DatabaseSync } = await (async () => {
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => (/SQLite/.test(String(w?.message ?? w)) ? undefined : emit.call(process, w, ...rest));
  try {
    return await import('node:sqlite');
  } finally {
    process.emitWarning = emit;
  }
})();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROUTES_DIR = path.join(ROOT, 'scripts', 'qa', 'routes');
const QA_DIR = path.join(ROOT, '.qa');
const COOKIE = 'mise_session';

export const ROLES = Object.freeze(['anon', 'customer', 'contractor', 'brand', 'studio', 'admin', 'fresh']);
/** Seeded by server/seed/core.mjs. */
const DEMO_EMAIL = { customer: 'demo-customer@mise.test', brand: 'demo-brand@mise.test', studio: 'demo-studio@mise.test', admin: 'demo-admin@mise.test' };
const CONTRACTOR_EMAIL = 'qa-contractor@mise.test';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

/**
 * Non-local requests the app is known to make today, outside any package's control. They are
 * still blocked (never sent) and listed in every report, but they don't fail a route unless
 * --strict-external is passed. An entry that no route requests any more fails the run, so it
 * gets deleted the moment the app is fixed. Keep this list short and every `why` specific.
 */
export const KNOWN_EXTERNAL = Object.freeze([
  {
    id: 'google-fonts',
    match: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
    why: 'index.html loads Fraunces, Instrument Sans and JetBrains Mono from Google Fonts at runtime. Self-host them (docs/handoff/qa.md); until then QA screenshots use fallback fonts.',
  },
]);

// ─── arguments ────────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const o = { pkg: null, port: null, dist: null, only: null, timeout: 20_000, swiftshader: false, chrome: false, keep: false, list: false, strictExternal: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || (inline === undefined && v.startsWith('--'))) throw new Error(`${flag} needs a value.`);
      return v;
    };
    switch (flag) {
      case '--pkg':
        o.pkg = value();
        break;
      case '--port':
        o.port = value();
        break;
      case '--dist':
        o.dist = value();
        break;
      case '--only':
        o.only = value()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case '--timeout':
        o.timeout = Number(value());
        if (!(o.timeout > 0)) throw new Error('--timeout must be a number of milliseconds.');
        break;
      case '--swiftshader':
      case '--chrome':
      case '--keep':
      case '--list':
        o[flag.slice(2)] = true;
        break;
      case '--strict-external':
        o.strictExternal = true;
        break;
      case '--help':
      case '-h':
        o.help = true;
        break;
      default:
        throw new Error(`Unknown option ${a}. Run with --help.`);
    }
  }
  return o;
}

// ─── route files ──────────────────────────────────────────────────────────────

const asList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function validateRoute(r, file, seen) {
  const where = `${path.relative(ROOT, file)}: route ${JSON.stringify(r?.name ?? '?')}`;
  if (!r || typeof r !== 'object') throw new Error(`${path.relative(ROOT, file)}: every route must be an object.`);
  if (typeof r.name !== 'string' || !NAME_RE.test(r.name)) throw new Error(`${where}: name must match ${NAME_RE} (it names the screenshot).`);
  if (seen.has(r.name)) throw new Error(`${where}: duplicate name.`);
  seen.add(r.name);
  if (r.path !== undefined && (typeof r.path !== 'string' || !/^#?\//.test(r.path))) throw new Error(`${where}: path must look like '#/local'.`);
  if (r.path === undefined && typeof r.setup !== 'function') throw new Error(`${where}: needs a path, or a setup that returns one.`);
  if (!ROLES.includes(r.as ?? 'anon')) throw new Error(`${where}: as must be one of ${ROLES.join(', ')}.`);
  resolveViewport(r.viewport);
  for (const s of asList(r.waitFor)) if (typeof s !== 'string' || !s) throw new Error(`${where}: waitFor must be a selector or a list of selectors.`);
  for (const t of asList(r.expectText)) if (typeof t !== 'string' || !t) throw new Error(`${where}: expectText must be a string or a list of strings.`);
  for (const k of ['setup', 'check']) if (r[k] !== undefined && typeof r[k] !== 'function') throw new Error(`${where}: ${k} must be a function.`);
  for (const k of ['waitMs', 'timeoutMs']) if (r[k] !== undefined && !(Number(r[k]) >= 0)) throw new Error(`${where}: ${k} must be a number.`);
  if (r.knownIssue !== undefined && (typeof r.knownIssue !== 'string' || !r.knownIssue.trim())) throw new Error(`${where}: knownIssue must say what is wrong.`);
  for (const p of asList(r.ignoreConsole)) if (!(typeof p === 'string' || p instanceof RegExp)) throw new Error(`${where}: ignoreConsole takes strings or RegExps.`);
  return r;
}

/** `[{ pkg, file, routes }]` for one package or for all of them (core first). */
export async function loadRouteFiles(pkg) {
  if (!fs.existsSync(ROUTES_DIR)) throw new Error(`No ${path.relative(ROOT, ROUTES_DIR)} directory.`);
  let names;
  if (pkg === 'all') {
    names = fs
      .readdirSync(ROUTES_DIR)
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => f.slice(0, -4))
      .sort((a, b) => (a === 'core' ? -1 : b === 'core' ? 1 : a.localeCompare(b)));
  } else {
    if (!/^[a-z0-9-]+$/.test(pkg)) throw new Error(`Bad package name "${pkg}".`);
    names = [pkg];
  }
  const out = [];
  for (const name of names) {
    const file = path.join(ROUTES_DIR, `${name}.mjs`);
    if (!fs.existsSync(file)) throw new Error(`No QA routes for "${name}": ${path.relative(ROOT, file)} doesn't exist.`);
    const mod = await import(pathToFileURL(file).href);
    if (!Array.isArray(mod.default)) throw new Error(`${path.relative(ROOT, file)} must default-export an array of routes.`);
    const seen = new Set();
    out.push({ pkg: name, file, routes: mod.default.map((r) => validateRoute(r, file, seen)) });
  }
  return out;
}

// ─── HTTP agent (the routes' `api`) ───────────────────────────────────────────

class Agent {
  constructor(base, label) {
    this.base = base;
    this.label = label;
    /** @type {Map<string, string>} */
    this.cookies = new Map();
    /** `{ id, email, name, role, plan, … }` once signed in. */
    this.user = null;
  }

  get session() {
    return this.cookies.get(COOKIE) ?? null;
  }

  /** @returns {Promise<{ status: number, body: any, text: string, headers: Headers }>} */
  async request(method, p, { body, raw, contentType, headers = {} } = {}) {
    if (typeof p !== 'string' || !p.startsWith('/')) throw new Error(`api paths start with "/" (got ${JSON.stringify(p)}).`);
    const h = { ...headers };
    const write = method !== 'GET' && method !== 'HEAD';
    let payload;
    if (write) {
      h['X-Mise'] = '1';
      if (raw !== undefined) {
        payload = raw;
        h['Content-Type'] = contentType ?? 'application/octet-stream';
      } else {
        payload = typeof body === 'string' ? body : JSON.stringify(body ?? {});
        h['Content-Type'] = contentType ?? 'application/json';
      }
    }
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(this.base + p, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (!value || attrs.some((x) => /^\s*max-age\s*=\s*0\s*$/i.test(x))) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = method === 'HEAD' ? '' : await res.text();
    let parsed = text;
    if ((res.headers.get('content-type') || '').includes('application/json') && text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* leave as text */
      }
    }
    return { status: res.status, body: parsed, text, headers: res.headers };
  }

  get(p, o) {
    return this.request('GET', p, o);
  }
  post(p, body, o = {}) {
    return this.request('POST', p, { ...o, body });
  }
  put(p, body, o = {}) {
    return this.request('PUT', p, { ...o, body });
  }
  patch(p, body, o = {}) {
    return this.request('PATCH', p, { ...o, body });
  }
  delete(p, o) {
    return this.request('DELETE', p, o);
  }
  putRaw(p, buf, contentType, o = {}) {
    return this.request('PUT', p, { ...o, raw: buf, contentType });
  }
}

const must = async (promise, what) => {
  const r = await promise;
  if (r.status >= 300) throw new Error(`${what} failed (${r.status}): ${typeof r.body === 'object' ? r.body?.error ?? JSON.stringify(r.body) : r.text.slice(0, 200)}`);
  return r;
};

/** Signs users in on demand and keeps one session per role for the whole run. */
class Users {
  constructor({ base, dbPath, password }) {
    this.base = base;
    this.dbPath = dbPath;
    this.password = password;
    this.anon = new Agent(base, 'anon');
    /** @type {Map<string, Promise<Agent>>} */
    this.byRole = new Map();
    this.freshCount = 0;
  }

  /** Direct DB access for QA states the API can't reach (roles, lapsed plans…). */
  sql(query, ...params) {
    const db = new DatabaseSync(this.dbPath);
    try {
      db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
      const st = db.prepare(query);
      return /^\s*(select|with|pragma)\b/i.test(query) ? st.all(...params) : st.run(...params);
    } finally {
      db.close();
    }
  }

  /** Inserts a user straight into the DB (no signup rate limit), unless the email exists. */
  async createUser(email, name, role = 'customer') {
    const hash = await hashPassword(this.password);
    const existing = this.sql('SELECT id FROM users WHERE email = ?', email)[0];
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    this.sql('INSERT INTO users (id, email, name, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?, ?)', id, email, name, hash, Date.now(), role);
    return id;
  }

  async login(email, label) {
    const a = new Agent(this.base, label);
    const r = await a.post('/api/auth/login', { email, password: this.password });
    if (r.status !== 200) throw new Error(`Could not sign in as ${email} (${r.status}): ${r.body?.error ?? r.text.slice(0, 200)}`);
    a.user = r.body.user;
    return a;
  }

  async #make(role) {
    if (role === 'contractor') {
      await this.createUser(CONTRACTOR_EMAIL, 'Quinn Contractor');
      const a = await this.login(CONTRACTOR_EMAIL, role);
      if (a.user.plan?.id !== 'contractor') {
        // The real demo checkout, as the app does it: start, then complete with success.
        const c = await must(a.post('/api/billing/checkout', { kind: 'subscription', plan: 'contractor' }), 'Contractor demo checkout');
        await must(a.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' }), 'Completing the Contractor demo checkout');
        a.user = (await must(a.get('/api/auth/me'), 'Reading the contractor')).body.user;
        if (a.user.plan?.id !== 'contractor') throw new Error(`The QA contractor is on plan "${a.user.plan?.id}" after a successful demo checkout.`);
      }
      return a;
    }
    const email = DEMO_EMAIL[role];
    if (!email) throw new Error(`No user for role "${role}".`);
    const a = await this.login(email, role);
    if ((role === 'studio' || role === 'admin') && a.user.role !== role) throw new Error(`${email} has role "${a.user.role}", expected "${role}". Did the core seed run?`);
    return a;
  }

  /** A signed-in Agent for `role` (anon → no session). Re-signs in if the session ended. */
  async agentFor(role) {
    if (role === 'anon') return this.anon;
    if (!this.byRole.has(role)) {
      const p = this.#make(role);
      this.byRole.set(role, p);
      p.catch(() => this.byRole.delete(role));
    }
    const a = await this.byRole.get(role);
    const me = await a.get('/api/auth/me');
    if (me.status === 200 && me.body?.user) {
      a.user = me.body.user;
      return a;
    }
    // A route signed out (which ends the session server-side): sign in again.
    this.byRole.delete(role);
    return this.agentFor(role);
  }

  /** A brand-new free customer. */
  async fresh() {
    const n = ++this.freshCount;
    const email = `qa-fresh-${n}-${crypto.randomBytes(3).toString('hex')}@mise.test`;
    await this.createUser(email, `Fresh Customer ${n}`);
    return this.login(email, 'fresh');
  }
}

/** The `api` object routes get: anon calls, `api.as(role).get(…)`, `api.sql(…)`. */
function makeApi(users, getFresh) {
  const as = (role) => {
    if (!ROLES.includes(role)) throw new Error(`api.as: unknown role "${role}".`);
    const agent = () => (role === 'fresh' ? getFresh() : users.agentFor(role));
    const call =
      (m) =>
      async (...args) =>
        (await agent())[m](...args);
    return {
      role,
      get: call('get'),
      post: call('post'),
      put: call('put'),
      patch: call('patch'),
      delete: call('delete'),
      putRaw: call('putRaw'),
      /** The signed-in user (`/api/auth/me` shape), or null for anon. */
      user: async () => (await agent()).user,
    };
  };
  const anon = users.anon;
  return {
    base: users.base,
    as,
    get: (...a) => anon.get(...a),
    post: (...a) => anon.post(...a),
    put: (...a) => anon.put(...a),
    patch: (...a) => anon.patch(...a),
    delete: (...a) => anon.delete(...a),
    sql: (q, ...p) => users.sql(q, ...p),
  };
}

// ─── processes ────────────────────────────────────────────────────────────────

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

/** The server's environment: ours on top of the shell's, minus anything that could reach a real service. */
function serverEnv(extra) {
  const env = { ...process.env };
  for (const k of [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'ANTHROPIC_API_KEY',
    'MISE_LLM_MODEL',
    'PUBLIC_URL',
    'TRUST_PROXY',
    'RATE_LIMITS',
    'NODE_ENV',
    'DIST_DIR',
    'ADMIN_EMAILS',
    'SEED_PASSWORD',
    'PAYMENTS',
    'DEMO_PAYMENTS',
  ])
    delete env[k];
  return { ...env, ...extra };
}

function runNode(args, { env, logFile }) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['--no-warnings', ...args], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    const take = (d) => {
      out += d;
      fs.appendFileSync(logFile, d);
    };
    p.stdout.on('data', take);
    p.stderr.on('data', take);
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`node ${args.join(' ')} exited with ${code}:\n${out.slice(-2000)}`))));
  });
}

async function startServer({ port, env, logFile, onStderr }) {
  const proc = spawn(process.execPath, ['--no-warnings', 'server/index.mjs', '--prod'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  });
  let exited = null;
  proc.on('exit', (code) => (exited = code ?? 'signal'));
  proc.stdout.on('data', (d) => fs.appendFileSync(logFile, d));
  proc.stderr.on('data', (d) => {
    fs.appendFileSync(logFile, d);
    onStderr?.(String(d));
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (exited !== null) throw new Error(`The server exited (${exited}) before it was ready:\n${tail(logFile)}`);
    try {
      const r = await fetch(`${base}/api/config`);
      if (r.ok) return { proc, base };
    } catch {
      /* not listening yet */
    }
    await sleep(200);
  }
  killTree(proc.pid);
  throw new Error(`The server did not answer on ${base} within 20 s:\n${tail(logFile)}`);
}

function tail(file, lines = 30) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-lines).join('\n');
  } catch {
    return '(no log)';
  }
}

// ─── one route ────────────────────────────────────────────────────────────────

const KEYS = {
  Escape: 27,
  Enter: 13,
  Tab: 9,
  Backspace: 8,
  Delete: 46,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
  ' ': 32,
};
const MODS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const matchesAny = (text, patterns) => patterns.some((p) => (p instanceof RegExp ? p.test(text) : text.includes(p)));

/** Input helpers bound to a page. Targets are a selector, `{ x, y }`, or a rect from rectOf. */
function inputHelpers(page) {
  const rectOf = async (selector, { scroll = false } = {}) => {
    const r = await page.evaluate(
      (sel, sc) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        if (sc) el.scrollIntoView({ block: 'center', inline: 'center' });
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
      },
      selector,
      scroll,
    );
    if (!r) throw new Error(`rectOf: nothing matches ${selector}`);
    return r;
  };
  const pointOf = async (t, scroll = false) => {
    if (typeof t === 'string') {
      const r = await rectOf(t, { scroll });
      if (!(r.w > 0 && r.h > 0)) throw new Error(`${t} has no size (hidden?)`);
      return { x: r.cx, y: r.cy };
    }
    if (t && typeof t.cx === 'number') return { x: t.cx, y: t.cy };
    if (t && typeof t.x === 'number' && typeof t.y === 'number') return { x: t.x, y: t.y };
    throw new Error(`Not a point or selector: ${JSON.stringify(t)}`);
  };
  const mouse = (type, p, extra = {}) => page.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, ...extra });
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  return {
    rectOf,
    async click(target, { button = 'left', clickCount = 1, modifiers = 0 } = {}) {
      const p = await pointOf(target, true);
      await mouse('mouseMoved', p, { modifiers });
      await mouse('mousePressed', p, { button, buttons: 1, clickCount, modifiers });
      await mouse('mouseReleased', p, { button, buttons: 0, clickCount, modifiers });
    },
    async mouseDrag(from, to, { steps = 12, button = 'left', modifiers = 0, stepMs = 16 } = {}) {
      const a = await pointOf(from);
      const b = await pointOf(to);
      await mouse('mouseMoved', a, { modifiers });
      await mouse('mousePressed', a, { button, buttons: 1, clickCount: 1, modifiers });
      for (let i = 1; i <= steps; i++) {
        await mouse('mouseMoved', lerp(a, b, i / steps), { button, buttons: 1, modifiers });
        await sleep(stepMs);
      }
      await mouse('mouseReleased', b, { button, buttons: 0, clickCount: 1, modifiers });
    },
    async touchDrag(from, to, { steps = 12, stepMs = 16, holdMs = 0 } = {}) {
      const a = await pointOf(from);
      const b = await pointOf(to);
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
      if (holdMs) await sleep(holdMs);
      for (let i = 1; i <= steps; i++) {
        const p = lerp(a, b, i / steps);
        await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y, id: 1 }] });
        await sleep(stepMs);
      }
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    /** Two fingers moving apart (`to` > `from`) or together around `center`. */
    async pinch(center, { from = 60, to = 180, steps = 12, stepMs = 16, angle = 0 } = {}) {
      const c = await pointOf(center);
      const dx = Math.cos(angle) / 2;
      const dy = Math.sin(angle) / 2;
      const pts = (d) => [
        { x: c.x - dx * d, y: c.y - dy * d, id: 1 },
        { x: c.x + dx * d, y: c.y + dy * d, id: 2 },
      ];
      await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
      for (let i = 1; i <= steps; i++) {
        await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / steps) });
        await sleep(stepMs);
      }
      await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    /** A real tap gesture (touch start/end → click), as a finger would. */
    async tap(target) {
      const p = await pointOf(target, true);
      await page.send('Input.synthesizeTapGesture', { x: p.x, y: p.y, gestureSourceType: 'touch' });
    },
    async key(key, { modifiers = [] } = {}) {
      const mods = asList(modifiers).reduce((m, k) => m | (MODS[k] ?? 0), 0);
      const printable = key.length === 1;
      const code = KEYS[key] ?? (printable ? key.toUpperCase().charCodeAt(0) : 0);
      const base = { key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: mods };
      await page.send('Input.dispatchKeyEvent', { type: printable && !mods ? 'keyDown' : 'rawKeyDown', ...base, ...(printable && !mods ? { text: key } : {}) });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    type: (text) => page.send('Input.insertText', { text }),
  };
}

async function waitForPage(page, { selectors, texts, timeoutMs, fn }) {
  const until = Date.now() + timeoutMs;
  let last = { missSel: selectors, missText: texts, fnOk: !fn };
  for (;;) {
    try {
      last = await page.evaluate(
        (sels, txts, fnSrc) => {
          // Case-insensitive: CSS text-transform changes innerText (an "eyebrow" reads CURRENT PLAN).
          const n = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
          const body = n(document.body ? document.body.innerText : '');
          let fnOk = true;
          // eslint-disable-next-line no-new-func
          if (fnSrc) fnOk = !!new Function(`return (${fnSrc})()`)();
          return { missSel: sels.filter((s) => !document.querySelector(s)), missText: txts.filter((t) => !body.includes(n(t))), fnOk };
        },
        selectors,
        texts,
        fn ? String(fn) : null,
      );
    } catch {
      /* mid-navigation; try again */
    }
    if (!last.missSel.length && !last.missText.length && last.fnOk) return last;
    if (Date.now() > until) return last;
    await sleep(100);
  }
}

async function runRoute(env, pkg, route, outDir) {
  const { cdp, users, base, timeout } = env;
  const as = route.as ?? 'anon';
  const viewport = resolveViewport(route.viewport);
  const res = {
    name: route.name,
    path: route.path ?? null,
    as,
    viewport,
    status: 'fail',
    ms: 0,
    failures: [],
    warnings: [],
    external: [],
    apiErrors: [],
    notes: [],
    screenshots: [],
    ...(route.knownIssue ? { knownIssue: route.knownIssue } : {}),
  };
  const t0 = Date.now();
  const ignore = asList(route.ignoreConsole);
  const routeTimeout = Number(route.timeoutMs ?? timeout);
  const serverErrStart = env.serverErr.length;
  let page = null;
  let fresh = null;
  const getFresh = () => (fresh ??= users.fresh());
  const api = makeApi(users, getFresh);
  const shoot = async (suffix) => {
    const file = `${route.name}${suffix ? `--${suffix}` : ''}.png`;
    fs.writeFileSync(path.join(outDir, file), await page.screenshot({ fullPage: !!route.fullPage }));
    res.screenshots.push(`.qa/${pkg}/${file}`);
  };

  try {
    const agent = as === 'anon' ? null : as === 'fresh' ? await getFresh() : await users.agentFor(as);
    const me = as === 'anon' ? null : api.as(as);
    let data = {};
    if (route.setup) {
      const out = await route.setup({ api, as, me, user: agent?.user ?? null, base, sleep });
      if (out && typeof out === 'object') data = out;
    }
    const hashPath = String(data.path ?? route.path ?? '').replace(/^#/, '');
    if (!hashPath.startsWith('/')) throw new Error(`setup returned a bad path ${JSON.stringify(data.path)}`);
    res.path = `#${hashPath}`;

    page = await openPage(cdp, { viewport });
    if (agent?.session) {
      const ok = await page.send('Network.setCookie', { name: COOKIE, value: agent.session, url: base, httpOnly: true, sameSite: 'Lax' });
      if (ok && ok.success === false) throw new Error('The browser refused the session cookie.');
    }
    if (route.reducedMotion) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.goto(`${base}/?qa=1#${hashPath}`, routeTimeout);
    if (!env.renderer) {
      env.renderer = await page
        .evaluate(() => {
          const g = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
          const e = g && g.getExtension('WEBGL_debug_renderer_info');
          return g ? (e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'webgl (renderer hidden)') : 'no webgl';
        })
        .catch(() => null);
    }

    const selectors = asList(route.waitFor);
    const texts = asList(route.expectText);
    const w = await waitForPage(page, { selectors, texts, timeoutMs: routeTimeout });
    for (const s of w.missSel) res.failures.push(`waitFor: ${s} never appeared (${routeTimeout} ms)`);
    for (const t of w.missText) res.failures.push(`expectText: "${t}" never appeared (${routeTimeout} ms)`);

    if (!res.failures.length) {
      if (route.waitMs) await sleep(Number(route.waitMs));
      if (route.check) {
        const helpers = {
          ...inputHelpers(page),
          page,
          send: page.send,
          evaluate: page.evaluate,
          sleep,
          api,
          as,
          me,
          data,
          base,
          viewport,
          note: (msg) => res.notes.push(String(msg)),
          shot: (suffix) => shoot(suffix),
          async waitFor(selector, ms = routeTimeout) {
            const r = await waitForPage(page, { selectors: asList(selector), texts: [], timeoutMs: ms });
            if (r.missSel.length) throw new Error(`${r.missSel.join(', ')} never appeared (${ms} ms)`);
          },
          async waitForText(text, ms = routeTimeout) {
            const r = await waitForPage(page, { selectors: [], texts: asList(text), timeoutMs: ms });
            if (r.missText.length) throw new Error(`text "${r.missText.join('", "')}" never appeared (${ms} ms)`);
          },
          async waitUntil(fn, ms = routeTimeout, what = 'condition') {
            const r = await waitForPage(page, { selectors: [], texts: [], timeoutMs: ms, fn });
            if (!r.fnOk) throw new Error(`${what} never became true (${ms} ms)`);
          },
          async reload() {
            const loaded = page.waitEvent('Page.loadEventFired', routeTimeout);
            await page.send('Page.reload', {});
            await loaded;
          },
          async goto(hash) {
            await page.evaluate((h) => {
              location.hash = h;
            }, String(hash).replace(/^#?/, '#'));
            await sleep(50);
          },
        };
        try {
          await route.check(helpers);
        } catch (err) {
          res.failures.push(`check: ${err?.message ?? err}`);
        }
      }
    }
    await sleep(300); // late errors (a failed lazy chunk, a deferred effect) still count
    await shoot();
  } catch (err) {
    res.failures.push(String(err?.message ?? err));
    if (page) await shoot().catch(() => {});
  } finally {
    if (page) {
      const ev = page.events;
      for (const c of ev.console) {
        if (c.type === 'error' || c.type === 'assert') {
          if (!matchesAny(c.text, ignore)) res.failures.push(`console.${c.type}: ${c.text}`);
        } else if (c.type === 'warning') res.warnings.push(`console.warn: ${c.text}`);
      }
      for (const e of ev.exceptions) if (!matchesAny(e, ignore)) res.failures.push(`uncaught: ${e}`);
      for (const l of ev.log) {
        // Network log lines duplicate what the response checks below already classify.
        if (l.source === 'network') continue;
        if (l.level === 'error' && !matchesAny(l.text, ignore)) res.failures.push(`browser ${l.source} error: ${l.text}`);
        else if (l.level === 'warning') res.warnings.push(`browser ${l.source}: ${l.text}`);
      }
      for (const url of ev.external) {
        res.external.push(url);
        const known = env.strictExternal ? null : KNOWN_EXTERNAL.find((k) => k.match.test(url));
        if (known) {
          env.knownExternalSeen.set(known.id, (env.knownExternalSeen.get(known.id) ?? new Set()).add(`${pkg}/${route.name}`));
          res.warnings.push(`known external request (blocked, ${known.id}): ${url.slice(0, 200)}`);
        } else res.failures.push(`request to a non-local host (blocked): ${url.slice(0, 200)}`);
      }
      for (const r of ev.responses) {
        if (!isLocalUrl(r.url)) continue;
        const u = new URL(r.url);
        const isApi = u.pathname.startsWith('/api/');
        if (r.status >= 500) res.failures.push(`HTTP ${r.status} from ${r.method ?? 'GET'} ${u.pathname}`);
        else if (r.status >= 400 && !isApi) res.failures.push(`HTTP ${r.status} for ${u.pathname} (missing asset?)`);
        else if (r.status >= 400) res.apiErrors.push(`${r.status} ${r.method ?? 'GET'} ${u.pathname}${u.search}`);
      }
      for (const f of ev.failed) {
        if (!isLocalUrl(f.url) || f.canceled || /ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(f.error)) continue;
        res.failures.push(`request failed: ${f.url} (${f.error})`);
      }
      await page.close().catch(() => {});
    }
    const serverErr = env.serverErr.slice(serverErrStart).join('').trim();
    if (serverErr) res.warnings.push(`server stderr: ${serverErr.slice(0, 1500)}`);
    res.failures = [...new Set(res.failures)];
    res.warnings = [...new Set(res.warnings)].slice(0, 40);
    res.ms = Date.now() - t0;
    if (route.knownIssue) {
      res.status = res.failures.length ? 'known' : 'fail';
      if (!res.failures.length) res.failures.push(`knownIssue is set ("${route.knownIssue}") but the route passed: remove the marker.`);
    } else res.status = res.failures.length ? 'fail' : 'pass';
  }
  return res;
}

// ─── main ─────────────────────────────────────────────────────────────────────

const HELP = fs
  .readFileSync(fileURLToPath(import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.startsWith('//'))
  .slice(0, 20)
  .map((l) => l.replace(/^\/\/ ?/, ''))
  .join('\n');

export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log(HELP);
    return 0;
  }
  if (!opts.pkg) throw new Error('Pass --pkg <name|all>.');
  const files = await loadRouteFiles(opts.pkg);
  const pick = (pkg, r) => !opts.only || opts.only.includes(r.name) || opts.only.includes(`${pkg}/${r.name}`);
  const plan = files.map((f) => ({ ...f, routes: f.routes.filter((r) => pick(f.pkg, r)) })).filter((f) => f.routes.length);
  if (opts.list) {
    for (const f of files) for (const r of f.routes) console.log(`${f.pkg}/${r.name}  ${r.as ?? 'anon'}  ${r.path ?? '(setup)'}  ${typeof r.viewport === 'string' ? r.viewport : r.viewport ? `${r.viewport.w}x${r.viewport.h}` : 'desktop'}`);
    return 0;
  }
  if (!plan.length) throw new Error(opts.only ? `No route matches --only ${opts.only.join(',')}.` : `No routes in ${opts.pkg}.`);
  if (!opts.port) throw new Error('Pass --port <p> (each package has its own; see BUILD_PLAN §1).');
  const port = assertAllowedPort(opts.port);
  const dist = path.resolve(ROOT, opts.dist ?? 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`No built app at ${dist} (index.html missing). Run npm run build${opts.dist ? ` or vite build --outDir ${opts.dist}` : ''} first.`);
  if (!(await portFree(port))) throw new Error(`Port ${port} is already in use. QA starts its own server; stop whatever you started there (by PID), or pick another port.`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `mise-qa-${opts.pkg}-`));
  const logFile = path.join(tmp, 'server.log');
  const password = crypto.randomBytes(18).toString('base64url');
  const env = serverEnv({
    PORT: String(port),
    HOST: '127.0.0.1',
    DB_PATH: path.join(tmp, 'mise.db'),
    UPLOAD_DIR: path.join(tmp, 'uploads'),
    PAYMENTS: 'demo',
    DEMO_PAYMENTS: '1',
    ADMIN_EMAILS: DEMO_EMAIL.admin,
    SEED_PASSWORD: password,
    ...(opts.dist ? { DIST_DIR: dist } : {}),
  });

  let server = null;
  let browser = null;
  let interrupted = false;
  const killAll = () => {
    if (browser) killTree(browser.pid);
    if (server) killTree(server.proc.pid);
  };
  const onSignal = () => {
    interrupted = true;
    console.error('\nInterrupted: stopping the browser and server.');
    killAll();
  };
  process.once('SIGINT', onSignal);
  process.once('exit', killAll); // last resort if something throws past the finally

  const started = new Date();
  const results = [];
  let ok = false;
  try {
    console.log(`QA ${opts.pkg} on http://127.0.0.1:${port}, serving ${path.relative(ROOT, dist) || '.'}${opts.keep ? `, temp ${tmp}` : ''}`);
    const seedOut = await runNode(['server/seed/index.mjs'], { env, logFile });
    for (const line of seedOut.split(/\r?\n/)) if (/^seed /.test(line)) console.log(`  ${line}`);
    const serverErr = [];
    server = await startServer({ port, env, logFile, onStderr: (s) => serverErr.push(s) });
    browser = await launchBrowser({ chrome: opts.chrome, swiftshader: opts.swiftshader });
    console.log(`  ${browser.version}${opts.swiftshader ? ' (SwiftShader)' : ''}`);
    const users = new Users({ base: server.base, dbPath: env.DB_PATH, password });
    const runEnv = {
      cdp: browser.cdp,
      users,
      base: server.base,
      timeout: opts.timeout,
      serverErr,
      renderer: null,
      strictExternal: opts.strictExternal,
      /** KNOWN_EXTERNAL id → the routes that requested it. */
      knownExternalSeen: new Map(),
    };
    const knownExternalReport = (pkg) =>
      KNOWN_EXTERNAL.filter((k) => runEnv.knownExternalSeen.has(k.id))
        .map((k) => ({ id: k.id, why: k.why, routes: [...runEnv.knownExternalSeen.get(k.id)].filter((r) => !pkg || r.startsWith(`${pkg}/`)).map((r) => r.slice(r.indexOf('/') + 1)) }))
        .filter((k) => k.routes.length);

    for (const f of plan) {
      const outDir = path.join(QA_DIR, f.pkg);
      fs.mkdirSync(outDir, { recursive: true });
      const pkgResults = [];
      console.log(`\n${f.pkg} (${f.routes.length} route${f.routes.length === 1 ? '' : 's'})`);
      for (const route of f.routes) {
        if (interrupted) break;
        const r = await runRoute(runEnv, f.pkg, route, outDir);
        pkgResults.push(r);
        const mark = r.status === 'pass' ? 'ok  ' : r.status === 'known' ? 'KNOWN' : 'FAIL';
        console.log(`  ${mark} ${r.name}  ${r.as} ${r.path} ${r.viewport.w}x${r.viewport.h}  ${r.ms} ms`);
        for (const x of r.failures.slice(0, 8)) console.log(`         ${x.length > 300 ? `${x.slice(0, 300)}…` : x}`);
        if (r.failures.length > 8) console.log(`         … ${r.failures.length - 8} more in the report`);
        if (r.status === 'known') console.log(`         known issue: ${r.knownIssue}`);
      }
      const report = {
        pkg: f.pkg,
        ok: pkgResults.every((r) => r.status !== 'fail') && pkgResults.length === f.routes.length,
        startedAt: started.toISOString(),
        finishedAt: new Date().toISOString(),
        port,
        dist: path.relative(ROOT, dist) || '.',
        browser: browser.version,
        renderer: runEnv.renderer,
        swiftshader: opts.swiftshader,
        ...(opts.only ? { only: opts.only } : {}),
        counts: {
          pass: pkgResults.filter((r) => r.status === 'pass').length,
          known: pkgResults.filter((r) => r.status === 'known').length,
          fail: pkgResults.filter((r) => r.status === 'fail').length,
        },
        strictExternal: opts.strictExternal,
        knownExternal: knownExternalReport(f.pkg),
        routes: pkgResults,
      };
      fs.writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      results.push(report);
    }
    const all = results.flatMap((r) => r.routes);
    const n = (s) => all.filter((r) => r.status === s).length;
    // Every page loads index.html, so a KNOWN_EXTERNAL entry nothing requested is stale.
    const loadedAny = all.some((r) => r.screenshots.length);
    const stale = opts.strictExternal || interrupted || !loadedAny ? [] : KNOWN_EXTERNAL.filter((k) => !runEnv.knownExternalSeen.has(k.id));
    for (const k of knownExternalReport(null)) console.log(`\nKnown external request "${k.id}" (blocked, not failing; --strict-external fails it) on ${k.routes.length} route${k.routes.length === 1 ? '' : 's'}: ${k.why}`);
    for (const k of stale) console.log(`\nFAIL: no route requested the KNOWN_EXTERNAL entry "${k.id}" any more. The app is fixed: delete that entry from scripts/qa.mjs.`);
    ok = !interrupted && !stale.length && results.every((r) => r.ok);
    console.log(`\n${ok ? 'PASS' : 'FAIL'}: ${n('pass')} passed, ${n('known')} known issue${n('known') === 1 ? '' : 's'}, ${n('fail')} failed. Reports: ${results.map((r) => `.qa/${r.pkg}/report.json`).join(', ')}`);
    if (!ok && all.some((r) => r.failures.some((x) => /^HTTP 5/.test(x)))) console.log(`\nServer log (last lines):\n${tail(logFile)}`);
  } finally {
    process.off('SIGINT', onSignal);
    if (browser) await browser.close().catch(() => killTree(browser.pid));
    if (server) {
      killTree(server.proc.pid);
      for (let i = 0; i < 20 && server.proc.exitCode === null && server.proc.signalCode === null; i++) await sleep(100);
    }
    process.off('exit', killAll);
    if (opts.keep) console.log(`Kept ${tmp} (database, uploads, server.log).`);
    else {
      for (let i = 0; i < 10; i++) {
        try {
          fs.rmSync(tmp, { recursive: true, force: true });
          break;
        } catch {
          await sleep(200); // Windows may hold the DB file for a moment after the server dies
        }
      }
    }
  }
  return ok ? 0 : 1;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`qa: ${err?.message ?? err}`);
      process.exit(2);
    },
  );
}
