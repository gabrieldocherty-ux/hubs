// The payment provider abstraction for custom-model orders (PRODUCT_SPEC §7.4):
//
//   createCheckout(order, { attempt, email }) → { url, ref }
//   retrieve(ref)                             → { paid, amountCents, currency, paymentIntent, orderId, status }
//   refund(order)                             → { ok, ref, status }
//
// Stripe when the server's payments are 'stripe', DEMO when they are 'demo'. With 'none' (no usable
// Stripe setup and demo not allowed, see config.mjs paymentsPosture) there is no provider: asking
// for one throws the payments_unavailable 503.

import { createDemoProvider } from './demo.mjs';
import { createStripeProvider } from './stripe.mjs';
import { paymentsUnavailable } from './stripeApi.mjs';

export { paymentsUnavailable };

export { PACK, quote, legacyQuote, tiersWire, addBusinessDays } from './tiers.mjs';

/**
 * @param {{ config: any, fetch?: typeof fetch, log?: any }} ctx
 * @param {'demo' | 'stripe' | 'none'} [which]  defaults to the server's configured provider
 */
export function selectProvider(ctx, which = ctx.config.paymentsProvider) {
  if (which === 'stripe') return createStripeProvider({ config: ctx.config, fetch: (...a) => ctx.fetch(...a), log: ctx.log });
  if (which === 'demo') return createDemoProvider();
  throw paymentsUnavailable();
}
