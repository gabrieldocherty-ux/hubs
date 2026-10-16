// Stripe webhook deliveries the server refused or failed (server/routes/webhooks.mjs calls this),
// for Admin > System. Only when, why, the HTTP status and the event type (if the body could be
// read): never the body, the Stripe-Signature header or any secret. The newest KEEP are kept.

const KEEP = 200;
const REASONS = new Set(['not_enabled', 'signature', 'malformed', 'handler_error']);

/** Never throws: a failure to record a failure must not change the webhook's answer. */
export function recordWebhookFailure(db, { reason, status = 0, eventType = '', at, provider = 'stripe' }) {
  try {
    const r = REASONS.has(reason) ? reason : 'handler_error';
    const type = /^[a-z0-9_.]{1,80}$/i.test(String(eventType || '')) ? String(eventType) : '';
    db.prepare('INSERT INTO webhook_failures (at, provider, reason, event_type, status) VALUES (?, ?, ?, ?, ?)').run(at, provider, r, type, Number(status) || 0);
    db.prepare('DELETE FROM webhook_failures WHERE id <= (SELECT id FROM webhook_failures ORDER BY id DESC LIMIT 1 OFFSET ?)').run(KEEP);
  } catch {
    /* the table may not exist in an old test database; never fail the webhook over it */
  }
}

/** The newest `limit` failures, `[{ at, reason, status, eventType }]`. */
export function recentWebhookFailures(db, limit = 20) {
  return db
    .prepare('SELECT at, reason, status, event_type FROM webhook_failures ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((r) => ({ at: r.at, reason: r.reason, status: r.status, eventType: r.event_type || null }));
}
