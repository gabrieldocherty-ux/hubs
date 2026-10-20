// Test harness (BUILD_PLAN §3.7). Each test server gets its own ':memory:' database, a
// temp upload dir and an ephemeral port; nothing touches server/data.
//
//   const t = await startTestServer({ env: { PAYMENTS: 'demo' }, fetch: mockFetch });
//   const alice = await t.user();                       // an Agent with a cookie jar
//   const r = await alice.post('/api/projects', { … }); // → { status, body, headers, text, buffer }
//   await t.close();

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { createApp } from '../app.mjs';
import { randomId } from '../lib/ids.mjs';

// The live DNS check on email domains is for the real server; tests must not depend on the network.
process.env.BLUMODEL_EMAIL_DNS_CHECK ??= 'off';

export const silentLog = { info() {}, warn() {}, error() {} };

/** A valid ProductSpec (a 30″ range) with `over` merged on top. */
export function defaultSpec(over = {}) {
  return {
    kind: 'range',
    variant: 'gas-4',
    category: 'appliances',
    name: 'Test Range 30″',
    blurb: 'A product made by the test harness.',
    sku: 'TR30',
    widthIn: 30,
    depthIn: 28,
    heightIn: 36,
    elevationIn: 0,
    price: 1999,
    finishes: [{ id: 'stainless', name: 'Stainless', hex: '#c3c6ca', material: 'metal' }],
    imageFileIds: [],
    ...over,
  };
}

/** A minimal valid DesignDoc. */
export function sampleDoc(over = {}) {
  return {
    name: 'Test Kitchen',
    room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
    surfaces: {
      cabinetFinishId: 'white',
      doorStyle: 'shaker',
      hardwareId: 'brass',
      countertopId: 'marble',
      backsplashId: 'subway',
      flooringId: 'oak',
      paintId: 'white',
    },
    items: [{ id: 'it-1', productId: 'range-30', x: 60, y: 14, rotation: 0, finishIndex: 0 }],
    ...over,
  };
}

/**
 * One request over node:http with an explicit Host header (fetch can't set Host, and Node doesn't
 * resolve *.localhost), shaped like a fetch Response for Agent.request.
 */
function hostRequest(url, { method, headers, body, host }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const buf = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    let answered = false;
    const req = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { ...headers, Host: host, ...(buf ? { 'Content-Length': String(buf.length) } : {}) } },
      (res) => {
        answered = true;
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const h = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) for (const x of v) h.append(k, x);
            else if (v !== undefined) h.set(k, String(v));
          }
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: h, arrayBuffer: async () => buf });
        });
        res.on('error', reject);
      },
    );
    // The server may answer (and close) before reading a body it refuses: that's an answer, not an error.
    req.on('error', (err) => {
      if (!answered) reject(err);
    });
    if (buf) req.write(buf);
    req.end();
  });
}

/**
 * An HTTP client with a cookie jar. Non-GET requests carry `X-BluModel: 1` and JSON by default.
 * With `host` ('acme.localhost'), every request sends that Host header: the server then answers as
 * that site (a showroom, or the sales site). Cookies are kept per Agent, like one browser profile
 * on one host (the session cookie is host-only).
 */
export class Agent {
  constructor(base, { host } = {}) {
    this.base = base;
    /** The Host header to send, or null for the test server's own 127.0.0.1:<port>. */
    this.host = host ?? null;
    /** @type {Map<string, string>} */
    this.cookies = new Map();
    /** Set by t.user(): `{ id, email, name, role, brands, password }`. */
    this.user = null;
  }

  get id() {
    return this.user?.id;
  }

  storeCookies(list) {
    for (const c of list || []) {
      const [pair, ...attrs] = c.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age\s*=\s*0\s*$/i.test(a)) || value === '';
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  /**
   * @param {string} method
   * @param {string} p  path (and query) on the test server
   * @param {{ body?: unknown, raw?: Buffer | string, contentType?: string, headers?: Record<string, string>, csrf?: boolean }} [o]
   */
  async request(method, p, { body, raw, contentType, headers = {}, csrf = true } = {}) {
    this.beforeRequest?.();
    const h = { ...headers };
    const write = method !== 'GET' && method !== 'HEAD';
    if (write && csrf) h['X-BluModel'] = '1';
    let payload;
    if (!write) {
      // GET and HEAD never carry a body.
    } else if (raw !== undefined) {
      payload = raw;
      if (contentType) h['Content-Type'] = contentType;
    } else if (body !== undefined) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      h['Content-Type'] = contentType ?? 'application/json';
    } else if (write) {
      // Like the real client: writes without a body still send `{}` as JSON.
      payload = '{}';
      h['Content-Type'] = contentType ?? 'application/json';
    }
    if (this.cookies.size) h.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = this.host
      ? await hostRequest(this.base + p, { method, headers: h, body: payload, host: this.host })
      : await fetch(this.base + p, { method, headers: h, body: payload, redirect: 'manual' });
    this.storeCookies(res.headers.getSetCookie?.() ?? []);
    const buffer = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await res.arrayBuffer());
    const text = buffer.toString('utf8');
    let parsed = text;
    if ((res.headers.get('content-type') || '').includes('application/json') && text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* leave as text */
      }
    }
    return { status: res.status, body: parsed, headers: res.headers, text, buffer };
  }

  get(p, o) {
    return this.request('GET', p, o);
  }
  head(p, o) {
    return this.request('HEAD', p, o);
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
  /** Raw PUT (uploads). */
  putRaw(p, buf, contentType = 'application/octet-stream', o = {}) {
    return this.request('PUT', p, { ...o, raw: buf, contentType });
  }
}

let seq = 0;

/** Every running test server by its URL, so legacyCheckout can find an Agent's database. */
const SERVERS = new Map();

/**
 * A pending demo checkout for a legacy plan or kitchen unlock, as POST /api/billing/checkout made
 * one before the showroom pivot (the route now answers 410 not_for_sale). Tests of what still
 * works for existing customers (completing, renewing, cancelling, receipts, the Contractor
 * program) start from one. Returns the old route's answer: { status: 200, body: { url, ref, provider } }.
 * @param {Agent} agent  a signed-in Agent from t.user()
 * @param {{ kind: 'kitchen_unlock' | 'subscription', plan?: string, projectId?: string, returnTo?: string, provider?: 'demo' | 'stripe' }} body
 *   `provider` defaults to the server's (a Stripe-mode server makes a checkout Stripe will complete).
 */
export async function legacyCheckout(agent, body) {
  const t = SERVERS.get(agent.base);
  if (!t) throw new Error('legacyCheckout: that Agent is not on a running test server');
  const { randomId: rid } = await import('../lib/ids.mjs');
  const { planById } = await import('../lib/plans.mjs');
  const userId = agent.user?.id;
  let projectId = null;
  let projectName = '';
  let plan = null;
  let amount;
  if (body.kind === 'kitchen_unlock') {
    const p = t.db.prepare('SELECT id, name FROM projects WHERE id = ? AND user_id = ?').get(String(body.projectId ?? ''), userId);
    if (!p) return { status: 404, body: { error: 'That kitchen does not exist.' } };
    projectId = p.id;
    projectName = p.name;
    amount = planById('kitchen_unlock').priceCents;
  } else {
    plan = body.plan;
    amount = planById(plan).priceCents;
  }
  const ref = rid('bc_');
  const provider = body.provider ?? (t.config.paymentsProvider === 'stripe' ? 'stripe' : 'demo');
  const returnTo = body.returnTo ?? (projectId ? `#/k/${projectId}` : plan === 'contractor' ? '#/pro' : '#/account/billing');
  t.db
    .prepare(
      `INSERT INTO billing_checkouts (ref, user_id, kind, project_id, project_name, plan, amount_cents, currency, status, provider, return_to, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'cad', 'pending', ?, ?, ?)`,
    )
    .run(ref, userId, body.kind, projectId, projectName, plan, amount, provider, returnTo, Date.now());
  return { status: 200, body: { url: provider === 'demo' ? `#/pay/demo-plan/${ref}` : `https://checkout.stripe.com/c/pay/${ref}`, ref, provider }, text: '' };
}

/**
 * Starts the app on 127.0.0.1:0 with a fresh in-memory database.
 * @param {{ env?: Record<string, string>, fetch?: typeof fetch, rateLimits?: boolean, log?: any, dbPath?: string }} [opts]
 *   `rateLimits` defaults to false (RATE_LIMITS=off); pass true to test limits.
 *   `dbPath` lets a test use a real file (e.g. a migrated copy) instead of ':memory:'.
 */
export async function startTestServer({ env = {}, fetch: fetchImpl, rateLimits = false, log = silentLog, dbPath = ':memory:' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-test-'));
  const prod = env.NODE_ENV === 'production' || env.PROD === '1';
  const config = loadConfig(
    {
      DB_PATH: dbPath,
      UPLOAD_DIR: path.join(tmp, 'uploads'),
      DIST_DIR: path.join(tmp, 'dist'),
      PORT: '0',
      HOST: '127.0.0.1',
      RATE_LIMITS: rateLimits || prod ? 'on' : 'off',
      ...env,
    },
    prod ? ['--prod'] : [],
  );
  let nowOverride = null;
  const now = () => nowOverride ?? Date.now();
  const db = openDb(dbPath);
  migrate(db, { now });
  const { handler, ctx } = createApp({ config, db, fetch: fetchImpl ?? globalThis.fetch, now, log });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  const url = `http://127.0.0.1:${port}`;
  const { products, brands, files } = ctx.services;

  const t = {
    url,
    port,
    config,
    db,
    ctx,
    server,
    services: ctx.services,
    tmp,
    /** `t.agent()`: a client on the sales site; `t.agent({ host: t.hostFor('acme') })`: on that showroom. */
    agent: (o) => new Agent(url, o),

    /** The Host a showroom answers on in tests: '<slug>.localhost:<port>' (BASE_DOMAIN localhost). */
    hostFor(slug) {
      return `${slug}.${config.BASE_DOMAIN}:${port}`;
    },

    /**
     * Makes a tenant (services.tenants.create) that is live unless `status` says otherwise: a
     * current admin-recorded license and a complimentary monthly plan, so it is fully usable.
     * @returns {{ id: string, slug: string, name: string, host: string, tenant: any }}
     */
    tenant({ name = `Test Showroom ${++seq}`, slug, status = 'live', settings, branding, contact } = {}) {
      const ts = ctx.services.tenants;
      const tn = ts.create({ name, slug, settings, branding, contact });
      if (status === 'live') {
        // What an admin does for a signed deal: a license from today, and (here) a complimentary
        // monthly plan, so no payment provider is involved.
        const sb = ctx.services.showroomBilling;
        sb.recordLicense(tn.id, { paidHow: 'comp', amountCents: 0, startsOn: new Date(now()).toISOString().slice(0, 10) });
        sb.setComplimentary(tn.id, true, { note: 'test harness' });
        ts.setStatus(tn.id, 'live');
      } else if (status === 'lapsed') ts.setStatus(tn.id, 'live'); // launched with nothing paid: lapses at once
      else if (status !== 'setup') ts.setStatus(tn.id, status);
      const fresh = ts.get(tn.id);
      return { id: fresh.id, slug: fresh.slug, name: fresh.name, host: `${fresh.slug}.${config.BASE_DOMAIN}:${port}`, tenant: fresh };
    },

    /**
     * Signs a user up on a showroom (through the API on its host) and, with `role`, adds them to its
     * team. Returns an Agent bound to that host.
     * @param {{ id: string, host: string }} tn  from t.tenant()
     */
    async showroomUser(tn, { role = null, name, email, password } = {}) {
      const n = ++seq;
      const a = new Agent(url, { host: tn.host });
      const creds = { name: name ?? `Showroom User ${n}`, email: email ?? `visitor${n}-${randomId('', 6)}@test.blumodel`, password: password ?? `correct horse ${n}` };
      const r = await a.post('/api/auth/signup', creds);
      if (r.status !== 201) throw new Error(`t.showroomUser: signup failed (${r.status}): ${r.text}`);
      ctx.internal.limiter.reset('route:signup:ip:127.0.0.1');
      if (role) ctx.services.tenants.addMember(tn.id, r.body.user.id, role);
      a.user = { ...r.body.user, password: creds.password, tenantId: tn.id };
      return a;
    },

    /**
     * Signs a new user up through the API, then sets the role in the DB.
     * @returns {Promise<Agent>} with `.user = { id, email, name, role, brands, password }`
     */
    async user({ role = 'customer', name, email, password, mfa = true } = {}) {
      const n = ++seq;
      const a = new Agent(url);
      const creds = { name: name ?? `Test User ${n}`, email: email ?? `user${n}-${randomId('', 6)}@test.blumodel`, password: password ?? `correct horse ${n}` };
      const r = await a.post('/api/auth/signup', creds);
      if (r.status !== 201) throw new Error(`t.user: signup failed (${r.status}): ${r.text}`);
      // The harness's own signups don't count against the signup limit a test may be measuring.
      ctx.internal.limiter.reset('route:signup:ip:127.0.0.1');
      if (role !== 'customer') db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, r.body.user.id);
      a.user = { ...r.body.user, role, password: creds.password };
      // An admin must have two-factor sign-in on, and its session must have passed it (server/auth/mfa.mjs):
      // the harness enrols one with a known secret (a.user.totpSecret) and marks the session, as a
      // real sign-in with the code would. Pass mfa: false to get an admin who hasn't enrolled yet.
      if (role === 'admin' && mfa) t.enrolMfa(a);
      // Tests move the clock (t.setNow) for reasons of their own: an admin Agent's session counts as
      // just signed in (and just re-authenticated) before each request, so the 12-hour admin session
      // and the 10-minute re-authentication don't get in their way. Tests OF those set
      // a.keepFresh = false.
      if (role === 'admin') {
        a.keepFresh = true;
        a.beforeRequest = () => {
          if (!a.keepFresh) return;
          const t0 = now();
          db.prepare('UPDATE sessions SET created_at = ?, auth_at = ?, mfa_at = CASE WHEN mfa_at IS NULL THEN NULL ELSE ? END WHERE user_id = ? AND tenant_id IS NULL').run(t0, t0, t0, a.user.id);
        };
      }
      return a;
    },

    /**
     * Inserts a brand directly (no dependency on package B) with `owner` as its owner.
     * @param {Agent | string | null} owner  an Agent from t.user(), a user id, or null
     */
    brand(owner, { name = 'Test Co', status = 'active', slug, tagline = '', description = '', website = '', isDemo = false, verified = false, memberRole = 'owner' } = {}) {
      const id = randomId('b_');
      const t0 = now();
      const ownerId = typeof owner === 'string' ? owner : owner?.user?.id ?? null;
      db.prepare(
        `INSERT INTO brands (id, slug, name, tagline, description, website, status, verified_at, is_demo, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, slug ?? brands.uniqueSlug(name), name, tagline, description, website, status, verified ? t0 : null, isDemo ? 1 : 0, ownerId, t0, t0);
      if (ownerId) db.prepare('INSERT INTO brand_members (brand_id, user_id, member_role, created_at) VALUES (?, ?, ?, ?)').run(id, ownerId, memberRole, t0);
      return brands.get(id);
    },

    /** Creates a product through services.products (and publishes it when `publish`). */
    product({ source = 'brand', brandId = null, ownerUserId = null, visibility, status = 'draft', publish = false, spec = {} } = {}) {
      const row = products.create({
        source,
        brandId,
        ownerUserId,
        visibility: visibility ?? (source === 'custom' ? 'private' : 'public'),
        status,
        spec: defaultSpec(spec),
      });
      return publish ? products.publish(row.id) : row;
    },

    /** Stores bytes as a file owned by `owner` (Agent, user id or null). */
    file(owner, buf, { kind = 'image', visibility = 'private', brandId = null, originalName = 'fixture' } = {}) {
      const ownerUserId = typeof owner === 'string' ? owner : owner?.user?.id ?? null;
      return files.saveBuffer(buf, { kind, visibility, ownerUserId, brandId, originalName });
    },

    /**
     * Turns two-factor sign-in on for an Agent's account with a fixed test secret and marks its
     * current sessions as having passed it just now. Returns the secret (also a.user.totpSecret).
     */
    enrolMfa(a, secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP') {
      const t0 = now();
      db.prepare('INSERT INTO user_mfa (user_id, secret, enabled_at, last_step, created_at) VALUES (?, ?, ?, -1, ?) ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled_at = excluded.enabled_at').run(a.user.id, secret, t0, t0);
      db.prepare('UPDATE sessions SET mfa_at = ?, auth_at = ? WHERE user_id = ?').run(t0, t0, a.user.id);
      a.user.totpSecret = secret;
      return secret;
    },

    /**
     * Signs an Agent in again with its password, and with a code from its test secret when the
     * account has two-factor sign-in on (a fresh step each time, as a real app would give).
     * Returns the final answer ({ status, body }).
     */
    async signIn(a) {
      const r = await a.post('/api/auth/login', { email: a.user.email, password: a.user.password });
      if (r.body?.mfa !== 'required') return r;
      const { hotp, stepAt } = await import('../auth/totp.mjs');
      const last = db.prepare('SELECT last_step FROM user_mfa WHERE user_id = ?').get(a.user.id)?.last_step ?? -1;
      const step = Math.max(stepAt(now()) - 1, last + 1);
      return a.post('/api/auth/login/mfa', { ticket: r.body.ticket, code: hotp(a.user.totpSecret, step) });
    },

    /** Freezes the server clock at `ms` (null to resume real time). */
    setNow(ms) {
      nowOverride = ms;
    },

    async close() {
      SERVERS.delete(url);
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
      try {
        db.close();
      } catch {
        /* already closed */
      }
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
  SERVERS.set(url, t);
  return t;
}
