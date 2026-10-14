// The payment provider abstraction for custom-model orders (PRODUCT_SPEC §7.4):
//
//   createCheckout(order, { attempt, email }) → { url, ref }
//   retrieve(ref)                             → { paid, amountCents, currency, paymentIntent, orderId, status }
//   refund(order)                             → { ok, ref, status }
//
// Stripe when both keys are set (config.paymentsProvider === 'stripe'), otherwise DEMO.

import { createDemoProvider } from './demo.mjs';
import { createStripeProvider } from './stripe.mjs';

export { TIERS, quote, quoteItem, tiersWire, addBusinessDays } from './tiers.mjs';

/**
 * @param {{ config: any, fetch?: typeof fetch, log?: any }} ctx
 * @param {'demo' | 'stripe'} [which]  defaults to the server's configured provider
 */
export function selectProvider(ctx, which = ctx.config.paymentsProvider) {
  if (which === 'stripe') return createStripeProvider({ config: ctx.config, fetch: (...a) => ctx.fetch(...a), log: ctx.log });
  return createDemoProvider();
}
