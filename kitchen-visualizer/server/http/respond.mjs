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

/** Headers every response carries. */
export function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
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

/** Sends an HttpError (or a generic 500 for anything else) as JSON. */
export function sendError(res, err, log = console) {
  if (err instanceof HttpError) {
    const headers = {};
    if (err.closeConnection) headers.Connection = 'close';
    if (err.retryAfter) headers['Retry-After'] = String(err.retryAfter);
    if (err.allow) headers.Allow = err.allow;
    send(res, err.status, { error: err.message, ...(err.extra || {}) }, headers);
    return;
  }
  log.error?.(err);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  send(res, 500, { error: 'Something went wrong on our side.' });
}
