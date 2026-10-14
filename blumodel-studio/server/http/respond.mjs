// Response helpers. Error bodies are always `{ error: string, ...extra }`.

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message  shown to the user, so keep it plain
   * @param {Record<string, unknown>} [extra]  merged into the JSON body
   */
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
    /** Set when the request body was not fully read, so the connection must not be reused. */
    this.closeConnection = false;
  }
}

/**
 * The Content-Security-Policy for every response (the launch contract). The app is one bundle
 * from this origin: WebAssembly (the Draco decoder) needs 'wasm-unsafe-eval', three.js workers
 * start from blob: URLs, textures and thumbnails are data:/blob: images, and the only places a
 * form may go are this origin and Stripe's checkout and billing pages.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
  "frame-ancestors 'none'",
].join('; ');

export const PERMISSIONS_POLICY = 'camera=(self), microphone=(), geolocation=(), payment=(self)';

/** One year, no includeSubDomains or preload: those are hard to undo and cover other hosts. */
export const HSTS = 'max-age=31536000';

/**
 * Headers every response carries. HSTS only when the request came over https (directly, or
 * through a loopback proxy that said so): over plain http it would be ignored at best.
 * @param {import('node:http').ServerResponse} res
 * @param {{ https?: boolean, requestId?: string }} [o]
 */
export function securityHeaders(res, { https = false, requestId } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  if (https) res.setHeader('Strict-Transport-Security', HSTS);
  if (requestId) res.setHeader('X-Request-Id', requestId);
}

/** Sends JSON (or nothing for 204/304/HEAD). Safe to call once per response. */
export function send(res, status, body, headers = {}) {
  if (res.headersSent) {
    res.end();
    return;
  }
  const noBody = status === 204 || status === 304 || body === undefined;
  const json = noBody ? '' : JSON.stringify(body);
  res.writeHead(status, {
    ...(noBody ? {} : { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json) }),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(noBody || res.req?.method === 'HEAD' ? undefined : json);
}

/**
 * Sends an HttpError as JSON, or for anything else logs it (with the request id, method and path)
 * and sends a plain JSON 500 carrying only the request id: never a stack or an internal message.
 * @param {{ requestId?: string, method?: string, path?: string }} [where]
 */
export function sendError(res, err, log = console, where = {}) {
  if (err instanceof HttpError) {
    const headers = {};
    if (err.closeConnection) headers.Connection = 'close';
    if (err.retryAfter) headers['Retry-After'] = String(err.retryAfter);
    if (err.allow) headers.Allow = err.allow;
    send(res, err.status, { error: err.message, ...(err.extra || {}) }, headers);
    return;
  }
  const id = where.requestId ?? null;
  log.error?.(`[req ${id ?? '-'}] ${where.method ?? ''} ${where.path ?? ''} failed: ${err?.stack ?? err}`);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  send(res, 500, { error: 'Something went wrong on our side.', ...(id ? { requestId: id } : {}) });
}
