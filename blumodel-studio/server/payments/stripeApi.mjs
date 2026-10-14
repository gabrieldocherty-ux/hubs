// The one place that talks to Stripe's REST API (no SDK; tests inject a mock fetch, and no test
// or QA run ever reaches a real Stripe endpoint). Billing (server/billing/stripe.mjs), custom-model
// orders (server/payments/stripe.mjs) and the Stripe doctor (scripts/stripe-check.mjs) all use it.
//
// What a failure may say, anywhere: the method, the path, the HTTP status and Stripe's error
// `type` / `code` (fixed enum words like `authentication_error` / `api_key_expired`). Never a
// header, a request or response body, Stripe's free-text `message` (it can quote part of a key,
// "Invalid API Key provided: sk_live_****abcd"), or the key itself.

import { HttpError } from '../http/respond.mjs';

export const STRIPE_API = 'https://api.stripe.com/v1';

/** Stripe's form encoding: nested objects as a[b][c], arrays as a[0][b]. */
export function encodeForm(params, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x !== null && typeof x === 'object' ? encodeForm(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === 'object') encodeForm(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

/** An id whether Stripe sent the object or just its id. */
export const idOf = (v) => (typeof v === 'string' ? v : v && typeof v.id === 'string' ? v.id : null);

/** The 503 every payment endpoint answers when the server has no payments (launch contract). */
export function paymentsUnavailable() {
  return new HttpError(503, 'Payments are not available yet.', { code: 'payments_unavailable' });
}

const WORD = /^[a-z][a-z0-9_]{0,60}$/;
/** Only Stripe's enum words survive; anything else (free text, ids, keys) is dropped. */
const safeWord = (v) => (typeof v === 'string' && WORD.test(v) ? v : null);
/**
 * The permission a restricted key lacks, when Stripe's message names one ("Having the
 * 'rak_webhook_read' permission would allow this request"). Only the rak_ identifier is kept: a
 * key starts rk_/sk_ and has no word boundary inside it, so it can't match.
 */
const permissionIn = (message) => (typeof message === 'string' ? (/\b(rak_[a-z0-9_]{1,80})\b/.exec(message)?.[1] ?? null) : null);
/** A path for the log: Stripe object ids are fine, anything odd is replaced. */
const safePath = (p) => String(p).replace(/[^A-Za-z0-9_/.-]/g, '?').slice(0, 120);

/**
 * A Stripe API error, safe to log and to show: `status` (HTTP), `type`, `code`, `declineCode`,
 * `param` (all enum words or null). The message shown to people is generic.
 */
export class StripeApiError extends HttpError {
  constructor({ status, type = null, code = null, declineCode = null, param = null, permission = null, network = null, method, path }) {
    const msg =
      network !== null
        ? 'Couldn’t reach the payment provider. Try again in a moment.'
        : status === 401
          ? 'The payment provider refused this server’s key. Tell BluModel Studio support.'
          : 'The payment provider refused that request. Try again, or contact support if it keeps happening.';
    super(502, msg);
    this.stripeStatus = status ?? null;
    this.stripeType = type;
    this.stripeCode = code;
    this.declineCode = declineCode;
    this.param = param;
    /** A restricted key's missing permission (rak_...), when Stripe named it. */
    this.permission = permission;
    this.network = network;
    this.method = method;
    this.path = path;
  }

  /** One log line: never a key, body, header or Stripe's free text. */
  get logLine() {
    if (this.network !== null) return `stripe ${this.method} ${this.path}: network error (${this.network})`;
    const bits = [this.stripeType, this.stripeCode, this.declineCode && `decline ${this.declineCode}`, this.param && `param ${this.param}`, this.permission && `needs ${this.permission}`].filter(Boolean);
    return `stripe ${this.method} ${this.path}: HTTP ${this.stripeStatus}${bits.length ? ` (${bits.join(', ')})` : ''}`;
  }
}

/**
 * `request(method, path, params?, { idempotencyKey? })` → the parsed JSON body, or throws a
 * StripeApiError (a 502 HttpError) with nothing secret in it. Throws the payments_unavailable 503
 * when the server has no Stripe key.
 * @param {{ config: { STRIPE_SECRET_KEY?: string }, fetch: typeof fetch, log?: any, timeoutMs?: number }} deps
 */
export function createStripeRequest({ config, fetch, log = console, timeoutMs = 20_000 }) {
  return async function request(method, path, params, { idempotencyKey, quiet = false } = {}) {
    if (!config.STRIPE_SECRET_KEY) throw paymentsUnavailable();
    const form = params ? encodeForm(params).toString() : '';
    const url = method === 'GET' && form ? `${STRIPE_API}${path}?${form}` : `${STRIPE_API}${path}`;
    const where = { method, path: safePath(path) };
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${config.STRIPE_SECRET_KEY}`,
          ...(method === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: method === 'GET' ? undefined : form,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = safeWord(String(err?.cause?.code ?? '').toLowerCase()) ?? safeWord(String(err?.name ?? '').toLowerCase()) ?? 'unknown';
      const e = new StripeApiError({ network: reason, ...where });
      if (!quiet) log.warn?.(e.logLine);
      throw e;
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const er = data && typeof data === 'object' ? data.error : null;
      const e = new StripeApiError({
        status: res.status,
        type: safeWord(er?.type),
        code: safeWord(er?.code),
        declineCode: safeWord(er?.decline_code),
        param: typeof er?.param === 'string' && /^[a-z0-9_[\]]{1,80}$/.test(er.param) ? er.param : null,
        permission: permissionIn(er?.message),
        ...where,
      });
      if (!quiet) log.warn?.(e.logLine);
      throw e;
    }
    return data;
  };
}
