// Stripe Checkout for custom-model orders: REST over ctx.fetch, no SDK (PRODUCT_SPEC §7.4,
// BUILD_PLAN §7 C-T3). Tests inject a mock fetch; no real Stripe call is made anywhere in
// the test suite. BluModel Studio never sees card details: Checkout is Stripe's own page.
//
// Every amount sent here was computed by tiers.mjs when the order was created.

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

/**
 * @param {{ config: any, fetch: typeof fetch, log?: any }} deps
 */
export function createStripeProvider({ config, fetch, log = console }) {
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
    id: 'stripe',

    /**
     * A Checkout Session for the order's server-computed amount, one line per item.
     * `attempt` keys the idempotency so a retry after a decline gets a fresh session while a
     * double click on the same attempt can't create two.
     * @param {{ id: string, amountCents: number, currency: string, items: { label: string, amountCents: number }[] }} order
     * @param {{ attempt: number, email?: string }} opts
     * @returns {Promise<{ url: string, ref: string }>}
     */
    async createCheckout(order, { attempt, email }) {
      const meta = { kind: 'order', order_id: order.id };
      const session = await request(
        'POST',
        '/checkout/sessions',
        {
          mode: 'payment',
          client_reference_id: order.id,
          success_url: `${config.PUBLIC_URL}/?session_id={CHECKOUT_SESSION_ID}#/orders/${order.id}`,
          cancel_url: `${config.PUBLIC_URL}/#/orders/${order.id}`,
          line_items: order.items.map((it) => ({
            quantity: 1,
            price_data: { currency: order.currency, unit_amount: it.amountCents, product_data: { name: it.label.slice(0, 120) } },
          })),
          metadata: meta,
          payment_intent_data: { metadata: meta },
          ...(email ? { customer_email: email } : {}),
        },
        { idempotencyKey: `${order.id}-${attempt}` },
      );
      if (typeof session?.url !== 'string' || !session.url.startsWith('https://') || typeof session.id !== 'string') {
        throw new HttpError(502, 'The payment provider didn’t return a checkout page.');
      }
      return { url: session.url, ref: session.id };
    },

    /** The session's payment state: `{ paid, amountCents, currency, paymentIntent, orderId, status }`. */
    async retrieve(ref) {
      const s = await request('GET', `/checkout/sessions/${encodeURIComponent(ref)}`);
      return {
        paid: s?.payment_status === 'paid',
        amountCents: s?.amount_total,
        currency: s?.currency,
        paymentIntent: idOf(s?.payment_intent),
        orderId: s?.metadata?.order_id ?? s?.client_reference_id ?? null,
        status: s?.status ?? null,
      };
    },

    /** A full refund of the order's payment intent. */
    async refund(order) {
      if (!order.paymentIntent) throw new HttpError(409, 'This order has no recorded payment to refund.');
      const r = await request('POST', '/refunds', { payment_intent: order.paymentIntent, metadata: { kind: 'order', order_id: order.id } }, { idempotencyKey: `refund-${order.id}` });
      return { ok: r?.status !== 'failed' && r?.status !== 'canceled', ref: typeof r?.id === 'string' ? r.id : null, status: r?.status ?? null };
    },
  };
}
