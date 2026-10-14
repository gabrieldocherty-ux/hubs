// The application: services, the route table and the request handler. Does not listen,
// so tests can mount it on port 0. See BUILD_PLAN §3.1–3.2.

import fs from 'node:fs';
import path from 'node:path';
import { tx } from './db/index.mjs';
import { HttpError, securityHeaders, send, sendError } from './http/respond.mjs';
import { compileRoutes, findRoute, runRoute } from './http/router.mjs';
import { serveDist } from './http/static.mjs';
import { createRateLimiter } from './auth/rateLimit.mjs';
import { createSessionStore } from './auth/sessions.mjs';
import { createAuthService } from './auth/guards.mjs';
import { createFileService } from './files/store.mjs';
import { createBrandService } from './catalog/brands.mjs';
import { createProductService } from './catalog/products.mjs';
import { createEventService } from './catalog/events.mjs';
import { createBillingHooks, createContractorHooks, createPricingHooks, createWebhookService } from './lib/hooks.mjs';
import { ROUTE_MODULES, ROUTE_MODULE_NAMES } from './routes/index.mjs';

const normalizeIp = (a = '') => (a.startsWith('::ffff:') ? a.slice(7) : a);

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
  const brands = createBrandService({ db, files });
  // Seams the billing and contractor packages register into (BUILD_PLAN §13.2).
  const webhooks = createWebhookService();
  const billing = createBillingHooks();
  const pricing = createPricingHooks();
  const contractors = createContractorHooks();
  const products = createProductService({ db, now, files, brands, ownerLabel: (userId) => contractors.labelFor(userId) });
  const events = createEventService({ db, now });

  /** The client address: the socket, or with TRUST_PROXY=N the Nth X-Forwarded-For hop from the right. */
  const clientIp = (req) => {
    if (config.TRUST_PROXY > 0) {
      const hops = String(req.headers['x-forwarded-for'] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (hops.length) return normalizeIp(hops[Math.max(0, hops.length - config.TRUST_PROXY)]);
    }
    return normalizeIp(req.socket?.remoteAddress || '');
  };

  const ctx = {
    config,
    db,
    now,
    fetch,
    log,
    tx: (fn) => tx(db, fn),
    services: { auth, files, products, brands, events, webhooks, billing, pricing, contractors },
    /** Foundation internals (sessions, limiter, clientIp). Feature packages shouldn't need these. */
    internal: { sessions, limiter, clientIp },
    /** Periodic housekeeping; index.mjs runs it every 10 minutes. */
    maintenance() {
      sessions.purgeExpired();
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

  const modules = routeModules ?? ROUTE_MODULES.map((fn, i) => ({ name: ROUTE_MODULE_NAMES[i], fn }));
  const routes = compileRoutes(ctx, modules);
  ctx.routes = routes.map((r) => ({ method: r.method, path: r.path, auth: r.auth, module: r.module }));
  const deps = { currentUser: sessions.currentUser, limiter, clientIp };

  const handler = async (req, res) => {
    securityHeaders(res);
    try {
      const raw = req.url || '/';
      let url;
      try {
        url = raw.startsWith('/') ? new URL('http://localhost' + raw) : new URL(raw);
      } catch {
        throw new HttpError(400, 'Bad request.');
      }
      if (req.method === 'OPTIONS') {
        const err = new HttpError(405, 'Method not allowed.');
        err.allow = 'GET, HEAD, POST, PUT, PATCH, DELETE';
        throw err;
      }
      const found = findRoute(routes, req.method, url.pathname);
      if (found?.route) {
        await runRoute({ req, res, url, route: found.route, params: found.params, ctx, deps });
        return;
      }
      if (found?.allow) {
        const err = new HttpError(405, 'Method not allowed.');
        err.allow = found.allow;
        throw err;
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found.');
      if (req.method === 'GET' || req.method === 'HEAD') {
        serveDist(req, res, url, config.DIST_DIR);
        return;
      }
      throw new HttpError(405, 'Method not allowed.');
    } catch (err) {
      if (err?.code === 'ECONNRESET' && !res.headersSent) {
        res.destroy();
        return;
      }
      sendError(res, err, log);
    }
  };

  return { handler, ctx, send };
}
