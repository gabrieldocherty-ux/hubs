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
    const req = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { ...headers, Host: host } },
      (res) => {
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
    req.on('error', reject);
    if (body !== undefined) req.write(body);
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
      if (status === 'live' || status === 'lapsed') {
        if (status === 'live') ctx.services.showroomBilling?.grantForTests?.(tn.id);
        ts.setStatus(tn.id, 'live');
      } else if (status !== 'setup') ts.setStatus(tn.id, status);
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
    async user({ role = 'customer', name, email, password } = {}) {
      const n = ++seq;
      const a = new Agent(url);
      const creds = { name: name ?? `Test User ${n}`, email: email ?? `user${n}-${randomId('', 6)}@test.blumodel`, password: password ?? `correct horse ${n}` };
      const r = await a.post('/api/auth/signup', creds);
      if (r.status !== 201) throw new Error(`t.user: signup failed (${r.status}): ${r.text}`);
      // The harness's own signups don't count against the signup limit a test may be measuring.
      ctx.internal.limiter.reset('route:signup:ip:127.0.0.1');
      if (role !== 'customer') db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, r.body.user.id);
      a.user = { ...r.body.user, role, password: creds.password };
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

    /** Freezes the server clock at `ms` (null to resume real time). */
    setNow(ms) {
      nowOverride = ms;
    },

    async close() {
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
  return t;
}
