// The one Stripe webhook endpoint (BUILD_PLAN §13.2). It verifies the signature over the
// raw body, records the event id so a resend is ignored, then hands the event to
// services.webhooks, where each package registers handlers by event type or by the
// `metadata.kind` it set at checkout (`order`, `kitchen_unlock`, `subscription`).
//
// The record and the handlers share one transaction: if a handler throws, the event is
// not marked as handled, Stripe gets a 500 and sends it again later.

import { verifyStripeSignature } from '../lib/validators.mjs';

/** Signed events older (or newer) than this are refused: Stripe's own default tolerance. */
export const WEBHOOK_TOLERANCE_SEC = 300;

/** @param {any} ctx */
export default function routes(ctx) {
  const { config, db, services } = ctx;

  return [
    {
      method: 'POST',
      path: '/api/webhooks/stripe',
      auth: 'none',
      csrf: false, // Stripe can't send our header; the signature is the check instead.
      body: 'raw',
      maxBytes: 1_000_000,
      handler: (rc) => {
        // 503 (not 400) so Stripe keeps retrying while the server's Stripe setup is being fixed.
        if (config.paymentsProvider !== 'stripe' || !config.STRIPE_WEBHOOK_SECRET) throw rc.error(503, 'Stripe payments are not enabled on this server.', { code: 'payments_unavailable' });
        const signature = rc.req.headers['stripe-signature'];
        if (!verifyStripeSignature(rc.body, signature, config.STRIPE_WEBHOOK_SECRET, WEBHOOK_TOLERANCE_SEC, ctx.now())) throw rc.error(400, 'Invalid signature.');
        let event;
        try {
          event = JSON.parse(rc.body.toString('utf8'));
        } catch {
          throw rc.error(400, 'Malformed event.');
        }
        if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') throw rc.error(400, 'Malformed event.');
        const duplicate = ctx.tx(() => {
          const res = db.prepare('INSERT OR IGNORE INTO webhook_events (provider, event_id, type, received_at) VALUES (?, ?, ?, ?)').run('stripe', event.id, event.type, ctx.now());
          if (!res.changes) return true;
          services.webhooks.dispatch(event);
          return false;
        });
        return { received: true, ...(duplicate ? { duplicate: true } : {}) };
      },
    },
  ];
}
