// The few Stripe REST calls billing needs, over ctx.fetch (no SDK, and tests mock fetch).
// Mise never sees card details: Checkout and the customer portal are Stripe's pages.
//
// Stripe has moved fields between API versions (a subscription's period end now lives on
// its items; an invoice's subscription moved under `parent`), and webhooks arrive in the
// account's version, so the readers below accept both shapes.

import { HttpError } from '../http/respond.mjs';

const API = 'https://api.stripe.com/v1';

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

/** A subscription's current period end in ms (top level on older API versions, per item on newer ones). */
export function periodEndOf(sub) {
  const s = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end;
  return typeof s === 'number' && s > 0 ? s * 1000 : null;
}

/** The subscription an invoice belongs to, on either API shape. */
export function invoiceSubscriptionId(inv) {
  return idOf(inv?.subscription) ?? idOf(inv?.parent?.subscription_details?.subscription) ?? null;
}

/** The end of the period an invoice pays for, in ms. */
export function invoicePeriodEnd(inv) {
  const s = inv?.lines?.data?.[0]?.period?.end;
  return typeof s === 'number' && s > 0 ? s * 1000 : null;
}

export function createStripe({ config, fetch, log = console }) {
  async function request(method, path, params, { idempotencyKey } = {}) {
    const form = params ? encodeForm(params).toString() : '';
    const url = method === 'GET' && form ? `${API}${path}?${form}` : `${API}${path}`;
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
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      log.warn?.(`stripe ${method} ${path}: ${err?.message ?? err}`);
      throw new HttpError(502, 'Couldn’t reach the payment provider. Try again in a moment.');
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const message = data?.error?.message;
      log.warn?.(`stripe ${method} ${path}: ${res.status} ${message ?? ''}`);
      throw new HttpError(502, message ? `The payment provider said: ${message}` : 'The payment provider refused that request.');
    }
    return data;
  }

  return {
    request,
    createCheckoutSession: (params, idempotencyKey) => request('POST', '/checkout/sessions', params, { idempotencyKey }),
    retrieveCheckoutSession: (id) => request('GET', `/checkout/sessions/${encodeURIComponent(id)}`, { expand: ['subscription'] }),
    retrieveSubscription: (id) => request('GET', `/subscriptions/${encodeURIComponent(id)}`),
    updateSubscription: (id, params, idempotencyKey) => request('POST', `/subscriptions/${encodeURIComponent(id)}`, params, { idempotencyKey }),
    createProduct: (params, idempotencyKey) => request('POST', '/products', params, { idempotencyKey }),
    createPortalSession: (params) => request('POST', '/billing_portal/sessions', params),
  };
}
