// What the Stripe side of this server needs, in one place: the webhook events it handles and the
// permissions a restricted key needs for the calls it makes. docs/LAUNCH.md and the Stripe doctor
// (scripts/stripe-check.mjs) read these lists; server/test/launch-admin.test.mjs checks the event
// list against the handlers the route modules actually register, so the two can't drift apart.

/**
 * Every event the webhook endpoint (POST /api/webhooks/stripe) acts on. The Stripe endpoint must
 * send all of them. Checkout events reach billing and orders by metadata.kind; the rest by type.
 */
export const STRIPE_WEBHOOK_EVENTS = Object.freeze([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
]);

/** The path Stripe posts to, under PUBLIC_URL. */
export const STRIPE_WEBHOOK_PATH = '/api/webhooks/stripe';

/**
 * The permissions a restricted key (rk_live_...) needs, as the Stripe dashboard names them, with
 * what each is for. `server` is what the running server calls; `check` is what `npm run
 * stripe:check` reads (read-only). Write includes read.
 */
export const STRIPE_KEY_PERMISSIONS = Object.freeze([
  { resource: 'Checkout Sessions', access: 'Write', use: 'server', why: 'start a checkout, and read it back when the buyer returns (?session_id=)' },
  { resource: 'Customers', access: 'Write', use: 'server', why: 'Checkout creates the customer on a first purchase and reuses it after' },
  { resource: 'Products', access: 'Write', use: 'server', why: 'the plan product a plan change is billed against (made once per plan)' },
  { resource: 'Prices', access: 'Write', use: 'server', why: 'the inline monthly price a plan change sets' },
  { resource: 'Subscriptions', access: 'Write', use: 'server', why: 'cancel, resume and change a plan' },
  { resource: 'Customer portal', access: 'Write', use: 'server', why: 'the "Manage payment & invoices" button (and stripe:check reads its setup)' },
  { resource: 'Refunds', access: 'Write', use: 'server', why: 'refunding a custom-model order from Admin' },
  { resource: 'Webhook Endpoints', access: 'Read', use: 'check', why: 'stripe:check confirms the endpoint exists and sends every event' },
  { resource: 'Account (Connect > Accounts, or "All core resources" read)', access: 'Read', use: 'check', why: 'stripe:check reads the business name and whether charges are enabled' },
]);
