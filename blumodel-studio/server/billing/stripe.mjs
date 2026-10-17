// The few Stripe REST calls billing needs, over ctx.fetch (no SDK, and tests mock fetch).
// BluModel Studio never sees card details: Checkout and the customer portal are Stripe's pages.
//
// Stripe has moved fields between API versions (a subscription's period end now lives on
// its items; an invoice's subscription moved under `parent`), and webhooks arrive in the
// account's version, so the readers below accept both shapes.

import { createStripeRequest, encodeForm, idOf } from '../payments/stripeApi.mjs';

export { encodeForm, idOf };

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
  // Failures never echo Stripe's message, a header, a body or the key (see stripeApi.mjs).
  const request = createStripeRequest({ config, fetch, log });

  return {
    request,
    createCheckoutSession: (params, idempotencyKey) => request('POST', '/checkout/sessions', params, { idempotencyKey }),
    retrieveCheckoutSession: (id) => request('GET', `/checkout/sessions/${encodeURIComponent(id)}`, { expand: ['subscription'] }),
    retrieveSubscription: (id) => request('GET', `/subscriptions/${encodeURIComponent(id)}`),
    updateSubscription: (id, params, idempotencyKey) => request('POST', `/subscriptions/${encodeURIComponent(id)}`, params, { idempotencyKey }),
    createProduct: (params, idempotencyKey) => request('POST', '/products', params, { idempotencyKey }),
    createPortalSession: (params) => request('POST', '/billing_portal/sessions', params),
    /** Cancels a subscription now (no more charges on it). */
    cancelSubscription: (id, idempotencyKey) => request('DELETE', `/subscriptions/${encodeURIComponent(id)}`, null, { idempotencyKey }),
  };
}
