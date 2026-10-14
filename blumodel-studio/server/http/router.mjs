// The route table: compiles every module's routes, then for each request runs the
// gates (CSRF header, auth level, rate limit, body) and dispatches. See BUILD_PLAN §3.2.

import { HttpError, send } from './respond.mjs';
import { readJson, readRaw } from './body.mjs';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_LEVELS = new Set(['none', 'optional', 'user', 'studio', 'admin']);
const BODY_KINDS = new Set(['json', 'raw', 'none']);
const PARAM_RE = /^[A-Za-z0-9_-]{1,80}$/;
const BY = new Set(['ip', 'user', 'ip+user']);

/**
 * @typedef {{ method: string, path: string, auth?: string, csrf?: boolean, body?: string,
 *   maxBytes?: number, rateLimit?: { name: string, max: number, windowMs: number, by?: string },
 *   params?: Record<string, RegExp>, handler: (rc: any) => any }} RouteDef
 */

function compileRoute(def, moduleName) {
  const where = `route ${def?.method} ${def?.path} (${moduleName})`;
  if (!def || typeof def !== 'object') throw new Error(`${moduleName}: every route must be an object.`);
  const method = String(def.method || '').toUpperCase();
  if (!METHODS.has(method)) throw new Error(`${where}: method must be one of ${[...METHODS].join(', ')}.`);
  if (typeof def.path !== 'string' || !def.path.startsWith('/')) throw new Error(`${where}: path must start with "/".`);
  if (typeof def.handler !== 'function') throw new Error(`${where}: handler must be a function.`);
  const auth = def.auth ?? 'user';
  if (!AUTH_LEVELS.has(auth)) throw new Error(`${where}: auth must be one of ${[...AUTH_LEVELS].join(', ')}.`);
  const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  const body = def.body ?? (hasBody ? 'json' : 'none');
  if (!BODY_KINDS.has(body)) throw new Error(`${where}: body must be json, raw or none.`);
  const csrf = def.csrf ?? method !== 'GET';
  if (def.rateLimit) {
    const rl = def.rateLimit;
    if (!rl.name || !(rl.max > 0) || !(rl.windowMs > 0)) throw new Error(`${where}: rateLimit needs name, max and windowMs.`);
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
    csrf,
    body,
    maxBytes: def.maxBytes ?? 1_000_000,
    rateLimit: def.rateLimit ? { by: 'ip', ...def.rateLimit } : null,
    params: def.params || {},
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
  for (const { name, fn } of modules) {
    const defs = fn(ctx);
    if (!Array.isArray(defs)) throw new Error(`Route module "${name}" must return an array.`);
    for (const def of defs) {
      const r = compileRoute(def, name);
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
 * path exists for other methods, or null when nothing matches the path.
 */
export function findRoute(routes, method, pathname) {
  const parts = pathname.split('/').slice(1);
  const want = method === 'HEAD' ? 'GET' : method;
  let best = null;
  const allow = new Set();
  for (const route of routes) {
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

  // 1. CSRF: writes must carry a custom header. Browsers can't add one cross-site
  //    without a CORS preflight this server never approves.
  if (route.csrf && req.headers['x-mise'] !== '1') throw new HttpError(403, 'Missing request header.');

  // 2. Auth level.
  if (route.auth !== 'none') rc.user = deps.currentUser(req, res);
  if (route.auth === 'user' || route.auth === 'studio' || route.auth === 'admin') {
    if (!rc.user) throw new HttpError(401, 'Please sign in.');
    if (route.auth === 'studio' && rc.user.role !== 'studio' && rc.user.role !== 'admin') throw new HttpError(403, 'You don’t have access to that.');
    if (route.auth === 'admin' && rc.user.role !== 'admin') throw new HttpError(403, 'You don’t have access to that.');
  }

  // 3. Rate limit.
  if (route.rateLimit && deps.limiter) {
    const { name, max, windowMs, by } = route.rateLimit;
    const who = by === 'user' ? (rc.user ? `u:${rc.user.id}` : `ip:${rc.ip}`) : by === 'ip+user' ? `ip:${rc.ip}|u:${rc.user?.id ?? '-'}` : `ip:${rc.ip}`;
    const hit = deps.limiter.hit(`route:${name}:${who}`, max, windowMs);
    if (!hit.ok) {
      const err = new HttpError(429, 'Too many requests. Wait a little and try again.');
      err.retryAfter = Math.max(1, Math.ceil(hit.retryAfterMs / 1000));
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
