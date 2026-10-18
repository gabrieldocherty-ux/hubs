// The route table: compiles every module's routes, then for each request runs the
// gates (CSRF header, auth level, rate limit, body) and dispatches. See BUILD_PLAN §3.2.

import { HttpError, send } from './respond.mjs';
import { readJson, readRaw } from './body.mjs';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
// 'staff' / 'owner': a member (any role / role owner) of the showroom the request's host resolved
// to (server/tenancy). 'studio' and 'admin' are BluModel's own roles and exist only on the sales site.
const AUTH_LEVELS = new Set(['none', 'optional', 'user', 'studio', 'admin', 'staff', 'owner']);
/** Which sites a route answers on (server/tenancy/hosts.mjs): 'sales', 'showroom' or 'any'. */
const HOSTS = new Set(['sales', 'showroom', 'any']);
const BODY_KINDS = new Set(['json', 'raw', 'none']);
const PARAM_RE = /^[A-Za-z0-9_-]{1,80}$/;
const BY = new Set(['ip', 'user', 'ip+user']);

/**
 * @typedef {{ name: string, max: number, windowMs: number, by?: string }} RateLimitDef
 *   A route may carry several (e.g. per user AND per real IP); every one must pass.
 *   `hosts` says which sites the route answers on ('sales' | 'showroom' | 'any'); elsewhere it is a
 *   404, as if it didn't exist. Default: the module's (routes/index.mjs). 'studio' and 'admin'
 *   routes are always 'sales'; 'staff' and 'owner' routes always 'showroom'.
 * @typedef {{ method: string, path: string, auth?: string, csrf?: boolean, body?: string, hosts?: string,
 *   maxBytes?: number, rateLimit?: RateLimitDef | RateLimitDef[],
 *   params?: Record<string, RegExp>, reauth?: boolean, handler: (rc: any) => any }} RouteDef
 *   `reauth: true`: a dangerous action (reset links, deletes, grants): the password, and the 2FA code
 *   when the account has 2FA, must have been given within REAUTH_MINUTES (401 reauth_required).
 */

function compileRoute(def, moduleName, moduleHosts = 'any') {
  const where = `route ${def?.method} ${def?.path} (${moduleName})`;
  if (!def || typeof def !== 'object') throw new Error(`${moduleName}: every route must be an object.`);
  const method = String(def.method || '').toUpperCase();
  if (!METHODS.has(method)) throw new Error(`${where}: method must be one of ${[...METHODS].join(', ')}.`);
  if (typeof def.path !== 'string' || !def.path.startsWith('/')) throw new Error(`${where}: path must start with "/".`);
  if (typeof def.handler !== 'function') throw new Error(`${where}: handler must be a function.`);
  const auth = def.auth ?? 'user';
  if (!AUTH_LEVELS.has(auth)) throw new Error(`${where}: auth must be one of ${[...AUTH_LEVELS].join(', ')}.`);
  let hosts = def.hosts ?? moduleHosts;
  if (!HOSTS.has(hosts)) throw new Error(`${where}: hosts must be sales, showroom or any.`);
  if (auth === 'studio' || auth === 'admin') hosts = 'sales';
  if (auth === 'staff' || auth === 'owner') hosts = 'showroom';
  const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  const body = def.body ?? (hasBody ? 'json' : 'none');
  if (!BODY_KINDS.has(body)) throw new Error(`${where}: body must be json, raw or none.`);
  const csrf = def.csrf ?? method !== 'GET';
  const limits = def.rateLimit ? (Array.isArray(def.rateLimit) ? def.rateLimit : [def.rateLimit]) : [];
  for (const rl of limits) {
    if (!rl || !rl.name || !(rl.max > 0) || !(rl.windowMs > 0)) throw new Error(`${where}: rateLimit needs name, max and windowMs.`);
    if (rl.by && !BY.has(rl.by)) throw new Error(`${where}: rateLimit.by must be ip, user or ip+user.`);
  }
  const segments = def.path.split('/').slice(1).map((s) => (s.startsWith(':') ? { param: s.slice(1) } : { lit: s }));
  const names = segments.filter((s) => s.param).map((s) => s.param);
  if (new Set(names).size !== names.length) throw new Error(`${where}: duplicate parameter name.`);
  for (const n of names) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) throw new Error(`${where}: bad parameter name ":${n}".`);
  return {
    method,
    path: def.path,
    shape: segments.map((s) => (s.param ? ':' : s.lit)).join('/'),
    segments,
    auth,
    hosts,
    csrf,
    body,
    maxBytes: def.maxBytes ?? 1_000_000,
    rateLimits: limits.map((rl) => ({ by: 'ip', ...rl })),
    params: def.params || {},
    /** True: the session must have proved the password (and 2FA) within REAUTH_MINUTES (deps.reauthGate). */
    reauth: def.reauth === true,
    handler: def.handler,
    module: moduleName,
  };
}

/** Matches a %-encoded pathname against a route; returns params or null. */
function matchRoute(route, parts) {
  if (parts.length !== route.segments.length) return null;
  const params = {};
  for (let i = 0; i < parts.length; i++) {
    const seg = route.segments[i];
    if (seg.lit !== undefined) {
      if (seg.lit !== parts[i]) return null;
    } else {
      const re = route.params[seg.param] || PARAM_RE;
      if (!re.test(parts[i])) return null;
      params[seg.param] = parts[i];
    }
  }
  return params;
}

/** Static segments win over params, left to right. Negative when a is more specific. */
function compareSpecificity(a, b) {
  for (let i = 0; i < a.segments.length; i++) {
    const sa = a.segments[i].lit !== undefined;
    const sb = b.segments[i].lit !== undefined;
    if (sa !== sb) return sa ? -1 : 1;
  }
  return 0;
}

/**
 * Builds the route table from route modules (`(ctx) => RouteDef[]`). Throws at startup
 * on a malformed route or a duplicate method + path (params compared by position).
 */
export function compileRoutes(ctx, modules) {
  const routes = [];
  const seen = new Map();
  for (const { name, fn, hosts } of modules) {
    const defs = fn(ctx);
    if (!Array.isArray(defs)) throw new Error(`Route module "${name}" must return an array.`);
    for (const def of defs) {
      const r = compileRoute(def, name, hosts ?? 'any');
      const key = `${r.method} ${r.shape}`;
      if (seen.has(key)) throw new Error(`Duplicate route ${r.method} ${r.path} in "${name}" (already defined in "${seen.get(key)}").`);
      seen.set(key, name);
      routes.push(r);
    }
  }
  return routes;
}

/**
 * Finds the route for a request. Returns `{ route, params }`, or `{ allow }` when the
 * path exists for other methods, or null when nothing matches the path. With `site`
 * ('sales' | 'showroom'), routes that don't answer on that site are skipped entirely.
 */
export function findRoute(routes, method, pathname, site) {
  const parts = pathname.split('/').slice(1);
  const want = method === 'HEAD' ? 'GET' : method;
  let best = null;
  const allow = new Set();
  for (const route of routes) {
    if (site && route.hosts !== 'any' && route.hosts !== site) continue;
    const params = matchRoute(route, parts);
    if (!params) continue;
    allow.add(route.method);
    if (route.method !== want) continue;
    if (!best || compareSpecificity(route, best.route) < 0) best = { route, params };
  }
  if (best) return best;
  if (allow.size) {
    if (allow.has('GET')) allow.add('HEAD');
    return { allow: [...allow].sort().join(', ') };
  }
  return null;
}

/**
 * Runs one matched route. `deps` supplies the session lookup, the limiter and the
 * client address so this module stays free of auth and config details.
 */
export async function runRoute({ req, res, url, route, params, ctx, deps }) {
  const rc = {
    req,
    res,
    url,
    method: req.method,
    params,
    query: url.searchParams,
    user: null,
    /** The site this request is for (server/tenancy/hosts.mjs Site): { kind, hostname, tenant, tenantId }. */
    site: deps.siteOf?.(req) ?? { kind: 'sales', hostname: '', tenant: null, tenantId: null, available: true },
    /** The showroom's TenantRecord, or null on the sales site. */
    tenant: null,
    /** The signed-in user's role on this showroom ('owner' | 'staff'), or null. */
    memberRole: null,
    body: undefined,
    ip: deps.clientIp(req),
    ctx,
    sent: false,
    send(status, json, headers) {
      rc.sent = true;
      send(res, status, json, headers);
    },
    error(status, message, extra) {
      return new HttpError(status, message, extra);
    },
  };

  rc.tenant = rc.site.tenant ?? null;

  // 1. CSRF: writes must carry a custom header. Browsers can't add one cross-site
  //    without a CORS preflight this server never approves.
  if (route.csrf && req.headers['x-blumodel'] !== '1') throw new HttpError(403, 'Missing request header.');

  // 2. Auth level.
  if (route.auth !== 'none') rc.user = deps.currentUser(req, res);
  if (rc.user && rc.tenant && deps.memberRole) rc.memberRole = deps.memberRole(rc.tenant.id, rc.user.id);
  if (route.auth === 'user' || route.auth === 'studio' || route.auth === 'admin' || route.auth === 'staff' || route.auth === 'owner') {
    if (!rc.user) throw new HttpError(401, 'Please sign in.');
    // A showroom's own team only; to anyone else the workspace doesn't exist.
    if ((route.auth === 'staff' || route.auth === 'owner') && !rc.memberRole) throw new HttpError(403, 'This is for the showroom’s team.', { code: 'not_staff' });
    if (route.auth === 'owner' && rc.memberRole !== 'owner') throw new HttpError(403, 'Only an owner of this showroom can do that.', { code: 'owner_only' });
    if (route.auth === 'studio' && rc.user.role !== 'studio' && rc.user.role !== 'admin') throw new HttpError(403, 'You don’t have access to that.');
    if (route.auth === 'admin' && rc.user.role !== 'admin') throw new HttpError(403, 'You don’t have access to that.');
    // A BluModel admin's own routes need 2FA on the account AND on this session (server/auth/mfa.mjs).
    if ((route.auth === 'admin' || route.auth === 'studio') && rc.user.role === 'admin' && deps.adminGate) deps.adminGate(rc);
  }
  if (route.reauth && deps.reauthGate) deps.reauthGate(rc);

  // 3. Rate limits (every one counts the request; the first one over its budget refuses it).
  if (route.rateLimits.length && deps.limiter) {
    let refused = null;
    for (const { name, max, windowMs, by } of route.rateLimits) {
      const who = by === 'user' ? (rc.user ? `u:${rc.user.id}` : `ip:${rc.ip}`) : by === 'ip+user' ? `ip:${rc.ip}|u:${rc.user?.id ?? '-'}` : `ip:${rc.ip}`;
      const hit = deps.limiter.hit(`route:${name}:${who}`, max, windowMs);
      if (!hit.ok && !refused) refused = hit;
    }
    if (refused) {
      const err = new HttpError(429, 'Too many requests. Wait a little and try again.');
      err.retryAfter = Math.max(1, Math.ceil(refused.retryAfterMs / 1000));
      throw err;
    }
  }

  // 4. Body.
  if (route.body === 'json' && req.method !== 'GET' && req.method !== 'HEAD') rc.body = await readJson(req, { maxBytes: route.maxBytes });
  else if (route.body === 'raw') rc.body = await readRaw(req, route.maxBytes);

  // 5. Handler: a returned value is a 200 JSON; undefined without rc.send is a 204.
  const out = await route.handler(rc);
  if (rc.sent || res.headersSent || res.writableEnded) return;
  if (out === undefined) send(res, 204);
  else send(res, 200, out);
}
