// The application: services, the route table and the request handler. Does not listen,
// so tests can mount it on port 0. See BUILD_PLAN §3.1–3.2.

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { tx } from './db/index.mjs';
import { HttpError, securityHeaders, send, sendError } from './http/respond.mjs';
import { compileRoutes, findRoute, runRoute } from './http/router.mjs';
import { serveDist } from './http/static.mjs';
import { createRateLimiter } from './auth/rateLimit.mjs';
import { createSessionStore, isHttps, isLoopback } from './auth/sessions.mjs';
import { createAuthService } from './auth/guards.mjs';
import { createMfaStore } from './auth/mfa.mjs';
import { createFileService } from './files/store.mjs';
import { createBrandService } from './catalog/brands.mjs';
import { createProductService } from './catalog/products.mjs';
import { createEventService } from './catalog/events.mjs';
import { createBillingHooks, createContractorHooks, createPricingHooks, createWebhookService } from './lib/hooks.mjs';
import { ROUTE_MODULES, ROUTE_MODULE_NAMES, moduleHosts } from './routes/index.mjs';
import { createTenantService } from './tenancy/service.mjs';
import { createShowroomBilling } from './billing/showroom.mjs';
import { createCredits } from './billing/credits.mjs';
import { createLeadService } from './tenancy/leads.mjs';
import { createImageTickets } from './tenancy/images.mjs';
import { createSiteResolver } from './tenancy/hosts.mjs';
import { showroomIndexHtml, unavailablePage, unknownHostPage } from './tenancy/pages.mjs';
import { requestOrigin } from './tenancy/hosts.mjs';

/**
 * What a lapsed or suspended showroom still answers (everything else is a 503): the app's config,
 * so the client can say why, and the health check.
 */
const UNAVAILABLE_ALLOW = new Set(['GET /api/config', 'GET /api/health', 'HEAD /api/health']);

/** Sends one of the server's own HTML pages (tenancy/pages.mjs). */
function sendPage(res, status, html) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-store' });
  res.end(res.req?.method === 'HEAD' ? undefined : html);
}

const normalizeIp = (a = '') => (a.startsWith('::ffff:') ? a.slice(7) : a);
const asIp = (v) => {
  const s = normalizeIp(String(v ?? '').trim());
  return s && net.isIP(s) ? s : null;
};
/** Long opaque path segments (share tokens and the like) are not written to the log. */
const logPath = (p) => String(p).replace(/[A-Za-z0-9_-]{24,}/g, ':token').slice(0, 200);

/**
 * @param {{ config: any, db: import('node:sqlite').DatabaseSync, fetch?: typeof fetch,
 *   now?: () => number, log?: { info: Function, warn: Function, error: Function },
 *   routeModules?: { name: string, fn: (ctx: any) => any[] }[] }} opts
 */
export function createApp({ config, db, fetch = globalThis.fetch, now = Date.now, log = console, routeModules } = {}) {
  if (!config || !db) throw new Error('createApp needs { config, db }');
  const limiter = createRateLimiter({ now, enabled: config.RATE_LIMITS !== 'off' });
  const sessions = createSessionStore({ db, config, now });
  const auth = createAuthService({ db });
  const files = createFileService({ db, config, now, auth });
  // Two-factor sign-in: required for BluModel admins, optional for everyone else.
  const mfa = createMfaStore({ db, now });
  // In production the demo brands never show, even if a demo seed was forced in (seed --force-demo).
  const brands = createBrandService({ db, files, hideDemo: !config.SHOW_DEMO_BRANDS });
  // Seams the billing and contractor packages register into (BUILD_PLAN §13.2).
  const webhooks = createWebhookService();
  const billing = createBillingHooks();
  const pricing = createPricingHooks();
  const contractors = createContractorHooks();
  // `tenants` is made below; the label is only asked for at request time.
  const products = createProductService({ db, now, files, brands, ownerLabel: (userId) => contractors.labelFor(userId), tenantLabel: (tenantId) => tenants.get(tenantId)?.name ?? null });
  const events = createEventService({ db, now });
  // Tenants and which site a request is for (docs/SHOWROOM_PIVOT.md §4, docs/handoff/tenancy.md).
  const tenants = createTenantService({ db, config, now, files, log });
  const sites = createSiteResolver({ tenants, config });
  // A showroom is live while its license is current and its monthly plan is paid.
  const showroomBilling = createShowroomBilling({ db, now, log });
  tenants.registerStanding((tenantId) => showroomBilling.standing(tenantId));
  showroomBilling.onChange((tenantId) => tenants.refresh(tenantId));
  // Each paid month adds its render credits, once per invoice.
  const credits = createCredits({ db, now });
  showroomBilling.onMonthPaid((tenantId, { invoiceRef, at }) => credits.grantMonth(tenantId, invoiceRef, { at }));
  const leads = createLeadService({ db, now });
  // ...and a refunded or disputed month takes back what is left of them.
  showroomBilling.onReversal((tenantId, { lotId, cents, note }) => credits.revokeLot(tenantId, lotId, cents, { note }));

  /**
   * The client's real address. With TRUST_PROXY=1 AND a loopback peer (cloudflared on this
   * machine): CF-Connecting-IP, else the first X-Forwarded-For hop (the client as the first proxy
   * saw it). Otherwise, or when those headers are missing or not an address, the socket's own
   * address: a LAN or internet client can't pick its rate-limit bucket by sending a header.
   */
  const clientIp = (req) => {
    const peer = normalizeIp(req.socket?.remoteAddress || '');
    if (config.TRUST_PROXY > 0 && isLoopback(peer)) {
      const cf = asIp(req.headers['cf-connecting-ip']);
      if (cf) return cf;
      const first = asIp(String(req.headers['x-forwarded-for'] || '').split(',')[0]);
      if (first) return first;
    }
    return peer;
  };

  const ctx = {
    config,
    db,
    now,
    fetch,
    log,
    tx: (fn) => tx(db, fn),
    services: { auth, mfa, files, products, brands, events, webhooks, billing, pricing, contractors, tenants, showroomBilling, credits, leads, imageTickets: createImageTickets({ now }) },
    /** Foundation internals (sessions, limiter, clientIp, sites). Feature packages shouldn't need these. */
    internal: { sessions, limiter, clientIp, sites },
    /** When this app was made (GET /api/health's uptime) and what the startup checks found. */
    startedAt: now(),
    health: { integrity: /** @type {null | { ok: boolean, problems: string[] }} */ (null), shuttingDown: false },
    /** Periodic housekeeping; index.mjs runs it every 10 minutes. */
    maintenance() {
      sessions.purgeExpired();
      try {
        tenants.refreshAll();
        credits.expire();
      } catch (err) {
        log.warn?.(`tenants: status refresh or credit expiry failed: ${err?.message ?? err}`);
      mfa.purgeExpired();
      }
      limiter.prune();
      const tmp = path.join(config.UPLOAD_DIR, 'tmp');
      try {
        for (const f of fs.readdirSync(tmp)) {
          const p = path.join(tmp, f);
          if (now() - fs.statSync(p).mtimeMs > 3_600_000) fs.rmSync(p, { force: true });
        }
      } catch {
        /* no temp dir yet */
      }
    },
  };

  const modules = routeModules ?? ROUTE_MODULES.map((fn, i) => ({ name: ROUTE_MODULE_NAMES[i], fn, hosts: moduleHosts(ROUTE_MODULE_NAMES[i]) }));
  const routes = compileRoutes(ctx, modules);
  ctx.routes = routes.map((r) => ({
    method: r.method,
    path: r.path,
    auth: r.auth,
    hosts: r.hosts,
    module: r.module,
    maxBytes: r.maxBytes,
    rateLimits: r.rateLimits.map(({ name, max, windowMs, by }) => ({ name, max, windowMs, by })),
  }));
  /**
   * A BluModel admin's routes: 2FA must be on for the account (403 mfa_enrol_required: the client
   * then shows the enrolment page, the grace flow for an admin made before 2FA existed) and this
   * session must have passed it (401 mfa_required: sign in again).
   */
  const adminGate = (rc) => {
    if (!mfa.enabled(rc.user.id)) throw new HttpError(403, 'Turn on two-factor sign-in to use the admin pages.', { code: 'mfa_enrol_required' });
    if (!rc.user.session?.mfa) throw new HttpError(401, 'Sign in again with your authenticator code.', { code: 'mfa_required' });
  };
  /** Dangerous actions: the password (and the 2FA code) given within REAUTH_MINUTES. */
  const reauthGate = (rc) => {
    if (!rc.user) throw new HttpError(401, 'Please sign in.');
    if (now() - (rc.user.session?.authAt ?? 0) > config.REAUTH_MINUTES * 60_000) {
      throw new HttpError(401, 'Confirm it’s you: enter your password and authenticator code again.', { code: 'reauth_required', mfa: mfa.enabled(rc.user.id) });
    }
  };
  const deps = { currentUser: sessions.currentUser, limiter, clientIp, siteOf: (req) => req.blumodelSite, memberRole: tenants.roleOf, adminGate, reauthGate };

  /** Responses not yet finished, so shutdown can tell them to close their connection. */
  const inflight = new Set();
  /**
   * Shutdown has begun (index.mjs): /api/health answers 503, and every response from now on,
   * including those for requests already in progress, closes its connection instead of keeping
   * it alive, so the server's close() isn't held up by idle keep-alive sockets.
   */
  ctx.beginShutdown = () => {
    ctx.health.shuttingDown = true;
    for (const r of inflight) if (!r.headersSent) r.setHeader('Connection', 'close');
  };

  const handler = async (req, res) => {
    const requestId = crypto.randomBytes(6).toString('hex');
    securityHeaders(res, { https: isHttps(req, config), requestId });
    inflight.add(res);
    res.once('close', () => inflight.delete(res));
    // While shutting down, finish this response and close the connection.
    if (ctx.health.shuttingDown) res.setHeader('Connection', 'close');
    try {
      const raw = req.url || '/';
      let url;
      try {
        url = raw.startsWith('/') ? new URL('http://localhost' + raw) : new URL(raw);
      } catch {
        throw new HttpError(400, 'Bad request.');
      }
      // Which site this is: the sales site, a showroom, or nothing (tenancy/hosts.mjs). Kept on the
      // request so sessions (auth/sessions.mjs) bind to it.
      const site = sites.resolve(req);
      req.blumodelSite = site;
      const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');
      if (site.kind === 'unknown') {
        if (isApi || req.method !== 'GET') throw new HttpError(404, 'There’s no showroom at this address.', { code: 'unknown_host' });
        return sendPage(res, 404, unknownHostPage(site.hostname));
      }
      if (site.kind === 'showroom' && !site.available && !UNAVAILABLE_ALLOW.has(`${req.method} ${url.pathname}`)) {
        if (isApi || (req.method !== 'GET' && req.method !== 'HEAD')) {
          throw new HttpError(503, 'This showroom is temporarily unavailable.', { code: 'showroom_unavailable', status: site.tenant.status });
        }
        res.setHeader('Retry-After', '3600');
        return sendPage(res, 503, unavailablePage(site.tenant));
      }
      if (req.method === 'OPTIONS') {
        const err = new HttpError(405, 'Method not allowed.');
        err.allow = 'GET, HEAD, POST, PUT, PATCH, DELETE';
        throw err;
      }
      const found = findRoute(routes, req.method, url.pathname, site.kind);
      if (found?.route) {
        await runRoute({ req, res, url, route: found.route, params: found.params, ctx, deps });
        return;
      }
      if (found?.allow) {
        const err = new HttpError(405, 'Method not allowed.');
        err.allow = found.allow;
        throw err;
      }
      if (isApi) throw new HttpError(404, 'Not found.');
      if (req.method === 'GET' || req.method === 'HEAD') {
        // A showroom's document carries the company's title and link-preview tags, not ours.
        const t = site.kind === 'showroom' ? site.tenant : null;
        const indexHtml = t ? (html) => showroomIndexHtml(html, t, { origin: tenants.originOf(t, requestOrigin(req, config)), logoUrl: tenants.logoUrl(t), images: tenants.publicWire(t).images }) : null;
        await serveDist(req, res, url, config.DIST_DIR, { indexHtml });
        return;
      }
      throw new HttpError(405, 'Method not allowed.');
    } catch (err) {
      if (err?.code === 'ECONNRESET' && !res.headersSent) {
        res.destroy();
        return;
      }
      let p = '';
      try {
        p = new URL(req.url || '/', 'http://localhost').pathname;
      } catch {
        p = '?';
      }
      sendError(res, err, log, { requestId, method: req.method, path: logPath(p) });
    }
  };

  return { handler, ctx, send };
}
