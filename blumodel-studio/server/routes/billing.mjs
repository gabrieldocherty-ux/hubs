// Package G (billing): the export paywall, the $5 kitchen unlock, the $15 and $40 monthly
// plans, Account → Billing and Admin → Billing (PLANS_AND_CONTRACTORS §1–§3, §5).
//
// Payments go through Stripe Checkout when the server has both Stripe keys, otherwise
// through the clearly labelled DEMO provider, which moves no money and collects no card
// details. Prices come only from src/data/plans.json; a client never sends an amount.

import { HttpError } from '../http/respond.mjs';
import { randomId, PRODUCT_ID_RE } from '../lib/ids.mjs';
import { planById, PLANS, SUBSCRIPTION_PLANS } from '../lib/plans.mjs';
import { loadKit } from '../lib/kit.mjs';
import { createBillingService, GRACE_MS } from '../billing/service.mjs';
import { createStripe, idOf, periodEndOf } from '../billing/stripe.mjs';

export const EXPORT_KINDS = ['plan_png', 'scene_png', 'csv', 'json', 'render', 'quote'];
const RETURN_RE = /^#\/[A-Za-z0-9/_\-?=&.%]{0,200}$/;
const slug = (name) =>
  String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'kitchen';

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config, services, log } = ctx;
  const billing = createBillingService({ db, now: ctx.now, log });
  const stripe = createStripe({ config, fetch: (...a) => ctx.fetch(...a), log });
  const demo = () => config.paymentsProvider === 'demo';

  services.billing.register({ planOf: billing.planOf, canExport: billing.canExport });

  // ── Stripe webhooks (the route itself is the foundation's) ──────────────
  const onCheckoutEvent = (event) => {
    const s = event.data?.object ?? {};
    if (!String(event.type).startsWith('checkout.session.')) return;
    const ref = s.metadata?.checkout_ref ?? s.client_reference_id;
    if (!ref || !billing.checkout(ref)) return;
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      if (s.payment_status !== 'paid') return; // async methods complete later
      billing.fulfil(ref, {
        providerRef: s.id,
        customerRef: idOf(s.customer),
        subscriptionRef: idOf(s.subscription),
        periodEnd: s.subscription && typeof s.subscription === 'object' ? periodEndOf(s.subscription) : null,
        amountCents: s.amount_total,
        currency: s.currency,
      });
    } else if (event.type === 'checkout.session.async_payment_failed') billing.endCheckout(ref, 'failed');
    else if (event.type === 'checkout.session.expired') billing.endCheckout(ref, 'expired');
  };
  services.webhooks.on('kitchen_unlock', onCheckoutEvent);
  services.webhooks.on('subscription', onCheckoutEvent);
  for (const type of ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']) {
    services.webhooks.on(type, (e) => billing.applyStripeSubscription(e.data?.object ?? {}));
  }
  services.webhooks.on('invoice.paid', (e) => billing.invoicePaid(e.data?.object ?? {}));
  services.webhooks.on('invoice.payment_failed', (e) => billing.invoiceFailed(e.data?.object ?? {}));

  // ── helpers ─────────────────────────────────────────────────────────────
  const ownedProject = (userId, id) => {
    const p = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(id, userId);
    if (!p) throw new HttpError(404, 'That kitchen does not exist.');
    return p;
  };

  const checkoutWire = (c) => ({
    ref: c.ref,
    kind: c.kind,
    plan: c.plan ?? null,
    projectId: c.project_id ?? null,
    projectName: c.project_name,
    amountCents: c.amount_cents,
    currency: c.currency,
    status: c.status,
    provider: c.provider,
    returnTo: c.return_to,
  });

  const ownCheckout = (userId, ref) => {
    const c = billing.checkout(ref);
    if (!c || c.user_id !== userId) throw new HttpError(404, 'That checkout does not exist.');
    return c;
  };

  const requireDemo = () => {
    if (!demo()) throw new HttpError(403, 'Demo payments are only available when Stripe isn’t configured.');
    if (!config.demoPaymentsAllowed) throw new HttpError(403, 'Demo payments are turned off on this server.');
  };

  const meWire = (userId) => ({
    plan: billing.planOf(userId),
    subscription: billing.subscriptionWire(userId),
    unlocks: billing.unlocksOf(userId),
    receipts: billing.receiptsOf(userId),
    payments: config.paymentsProvider,
    demo: demo(),
    graceDays: GRACE_MS / 86_400_000,
  });

  /**
   * The live wire product (at list price) for each server product a doc uses; its snapshots
   * cover the rest. The export kit applies the owner's price book itself, once.
   */
  const liveProducts = (doc, user) => {
    const out = [];
    for (const id of new Set((doc.items ?? []).map((i) => i.productId))) {
      if (!PRODUCT_ID_RE.test(id)) continue;
      const row = services.products.get(id);
      if (row && services.products.inCatalog(row, user)) {
        const w = services.products.toWire(row, { which: 'live', viewer: user });
        if (w) out.push(w);
      }
    }
    return out;
  };

  async function startStripeCheckout(c, user) {
    const sub = c.kind === 'subscription';
    const plan = sub ? planById(c.plan) : planById('kitchen_unlock');
    const existing = billing.subRow(user.id);
    const meta = { kind: c.kind, checkout_ref: c.ref, user_id: user.id, ...(c.project_id ? { project_id: c.project_id } : {}), ...(c.plan ? { plan: c.plan } : {}) };
    const session = await stripe.createCheckoutSession(
      {
        mode: sub ? 'subscription' : 'payment',
        client_reference_id: c.ref,
        success_url: `${config.PUBLIC_URL}/?session_id={CHECKOUT_SESSION_ID}${c.return_to}`,
        cancel_url: `${config.PUBLIC_URL}/${c.return_to}`,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: c.amount_cents,
              product_data: { name: sub ? `Mise ${plan.name}` : `Mise kitchen unlock: ${c.project_name || 'kitchen'}`.slice(0, 120) },
              ...(sub ? { recurring: { interval: 'month' } } : {}),
            },
          },
        ],
        metadata: meta,
        ...(existing?.customer_ref ? { customer: existing.customer_ref } : { customer_email: user.email }),
        ...(sub ? { subscription_data: { metadata: meta } } : { payment_intent_data: { metadata: meta } }),
      },
      `${c.ref}-checkout`,
    );
    db.prepare('UPDATE billing_checkouts SET provider_ref = ? WHERE ref = ?').run(session.id, c.ref);
    if (typeof session.url !== 'string' || !session.url.startsWith('https://')) throw new HttpError(502, 'The payment provider didn’t return a checkout page.');
    return session.url;
  }

  async function ensureStripeProduct(plan) {
    const row = db.prepare('SELECT product_id FROM billing_stripe_products WHERE plan = ?').get(plan);
    if (row) return row.product_id;
    const product = await stripe.createProduct({ name: `Mise ${planById(plan).name}`, metadata: { mise_plan: plan } }, `mise-product-${plan}`);
    db.prepare('INSERT OR REPLACE INTO billing_stripe_products (plan, product_id, created_at) VALUES (?, ?, ?)').run(plan, product.id, ctx.now());
    return product.id;
  }

  const activeSub = (userId) => {
    const plan = billing.planOf(userId);
    const r = billing.subRow(userId);
    if (plan.id === 'free' || !r) throw new HttpError(409, 'You don’t have a plan to change. Choose one from Pricing.');
    return r;
  };

  return [
    {
      method: 'GET',
      path: '/api/billing/plans',
      auth: 'none',
      handler: () => ({ plans: PLANS, payments: config.paymentsProvider, demo: demo() }),
    },
    {
      method: 'GET',
      path: '/api/billing/entitlements',
      handler: (rc) => billing.entitlements(rc.user.id),
    },
    {
      method: 'GET',
      path: '/api/billing/me',
      handler: (rc) => meWire(rc.user.id),
    },
    {
      method: 'POST',
      path: '/api/billing/checkout',
      rateLimit: { name: 'billing-checkout', max: 30, windowMs: 3_600_000, by: 'user' },
      handler: async (rc) => {
        const { kind } = rc.body;
        const user = rc.user;
        let projectId = null;
        let projectName = '';
        let plan = null;
        let amount;
        if (kind === 'kitchen_unlock') {
          const p = ownedProject(user.id, String(rc.body.projectId ?? ''));
          if (billing.canExport(user.id, p.id)) throw new HttpError(409, 'This kitchen’s exports are already unlocked.');
          projectId = p.id;
          projectName = p.name;
          amount = planById('kitchen_unlock').priceCents;
        } else if (kind === 'subscription') {
          plan = rc.body.plan;
          if (!SUBSCRIPTION_PLANS.includes(plan)) throw new HttpError(400, 'Choose Unlimited or Contractor.');
          const current = billing.planOf(user.id);
          if (current.id !== 'free') {
            throw new HttpError(409, current.id === plan ? `You’re already on ${planById(plan).name}.` : `You’re on ${planById(current.id).name}. Change plans from Billing.`, { plan: current.id });
          }
          amount = planById(plan).priceCents;
        } else throw new HttpError(400, 'Choose what to buy.');

        const fallback = kind === 'kitchen_unlock' ? `#/k/${projectId}` : plan === 'contractor' ? '#/pro' : '#/account/billing';
        const returnTo = typeof rc.body.returnTo === 'string' && RETURN_RE.test(rc.body.returnTo) ? rc.body.returnTo : fallback;
        const ref = randomId('bc_');
        const provider = config.paymentsProvider;
        db.prepare(
          `INSERT INTO billing_checkouts (ref, user_id, kind, project_id, project_name, plan, amount_cents, currency, status, provider, return_to, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'usd', 'pending', ?, ?, ?)`,
        ).run(ref, user.id, kind, projectId, projectName, plan, amount, provider, returnTo, ctx.now());
        const c = billing.checkout(ref);
        if (provider === 'demo') {
          requireDemo();
          return { url: `#/pay/demo-plan/${ref}`, ref, provider };
        }
        return { url: await startStripeCheckout(c, user), ref, provider };
      },
    },
    {
      method: 'GET',
      path: '/api/billing/checkouts/:ref',
      handler: (rc) => ({ checkout: checkoutWire(ownCheckout(rc.user.id, rc.params.ref)), demo: demo() }),
    },
    {
      method: 'POST',
      path: '/api/billing/demo/:ref/complete',
      handler: (rc) => {
        requireDemo();
        const c = ownCheckout(rc.user.id, rc.params.ref);
        if (c.provider !== 'demo') throw new HttpError(400, 'That checkout isn’t a demo checkout.');
        const outcome = rc.body.outcome;
        if (!['success', 'decline', 'cancel'].includes(outcome)) throw new HttpError(400, 'Choose success, decline or cancel.');
        if (c.status === 'completed') return { checkout: checkoutWire(c), entitlements: billing.entitlements(rc.user.id) };
        if (c.status !== 'pending' && c.status !== 'failed') throw new HttpError(409, 'That checkout has ended. Start again.');
        ctx.tx(() => {
          if (outcome === 'success') {
            // The plan may have changed since this checkout started (another tab).
            if (c.kind === 'subscription' && billing.planOf(rc.user.id).id !== 'free') throw new HttpError(409, 'You already have a plan. Change plans from Billing.');
            billing.fulfil(c.ref);
          } else billing.endCheckout(c.ref, outcome === 'decline' ? 'failed' : 'canceled');
        });
        return { checkout: checkoutWire(billing.checkout(c.ref)), entitlements: billing.entitlements(rc.user.id) };
      },
    },
    {
      // Demo only: what Stripe's renewals would do, so the flows can be tried without money.
      method: 'POST',
      path: '/api/billing/demo/simulate',
      handler: (rc) => {
        requireDemo();
        const r = billing.subRow(rc.user.id);
        if (!r || r.provider !== 'demo') throw new HttpError(409, 'Start a demo plan first.');
        const t = ctx.now();
        ctx.tx(() => {
          switch (rc.body.event) {
            case 'renewal':
              billing.demoRenew(r);
              break;
            case 'renewal_failed':
              billing.markPastDue(r);
              break;
            case 'period_end':
              db.prepare('UPDATE subscriptions SET current_period_end = ?, updated_at = ? WHERE id = ?').run(t, t, r.id);
              break;
            case 'grace_end':
              if (r.status !== 'past_due') throw new HttpError(409, 'The plan isn’t past due.');
              db.prepare('UPDATE subscriptions SET grace_until = ?, updated_at = ? WHERE id = ?').run(t, t, r.id);
              break;
            default:
              throw new HttpError(400, 'Choose renewal, renewal_failed, period_end or grace_end.');
          }
        });
        return meWire(rc.user.id);
      },
    },
    {
      // Back from Stripe Checkout (`?session_id=`): don't wait for the webhook.
      method: 'POST',
      path: '/api/billing/sync',
      handler: async (rc) => {
        const sessionId = String(rc.body.sessionId ?? '');
        if (demo() || !/^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) return { entitlements: billing.entitlements(rc.user.id), checkout: null };
        const s = await stripe.retrieveCheckoutSession(sessionId);
        const ref = s?.metadata?.checkout_ref ?? s?.client_reference_id;
        const c = ownCheckout(rc.user.id, ref);
        if (s.payment_status === 'paid') {
          ctx.tx(() => {
            billing.fulfil(c.ref, {
              providerRef: s.id,
              customerRef: idOf(s.customer),
              subscriptionRef: idOf(s.subscription),
              periodEnd: s.subscription && typeof s.subscription === 'object' ? periodEndOf(s.subscription) : null,
              amountCents: s.amount_total,
              currency: s.currency,
            });
            if (s.subscription && typeof s.subscription === 'object') billing.applyStripeSubscription(s.subscription);
          });
        }
        return { entitlements: billing.entitlements(rc.user.id), checkout: checkoutWire(billing.checkout(c.ref)) };
      },
    },
    {
      method: 'POST',
      path: '/api/billing/portal',
      handler: async (rc) => {
        if (demo()) return { url: '#/account/billing?portal=demo' };
        const r = billing.subRow(rc.user.id);
        if (!r?.customer_ref) throw new HttpError(409, 'There are no payment details on file yet.');
        const s = await stripe.createPortalSession({ customer: r.customer_ref, return_url: `${config.PUBLIC_URL}/#/account/billing` });
        return { url: s.url };
      },
    },
    {
      method: 'POST',
      path: '/api/billing/change',
      handler: async (rc) => {
        const plan = rc.body.plan;
        if (!SUBSCRIPTION_PLANS.includes(plan)) throw new HttpError(400, 'Choose Unlimited or Contractor.');
        const r = activeSub(rc.user.id);
        if (r.plan === plan && !r.cancel_at_period_end) throw new HttpError(409, `You’re already on ${planById(plan).name}.`);
        if (r.provider === 'demo') {
          db.prepare('UPDATE subscriptions SET plan = ?, cancel_at_period_end = 0, updated_at = ? WHERE id = ?').run(plan, ctx.now(), r.id);
          return meWire(rc.user.id);
        }
        const sub = await stripe.retrieveSubscription(r.subscription_ref);
        const itemId = sub?.items?.data?.[0]?.id;
        if (!itemId) throw new HttpError(502, 'Couldn’t read the subscription from the payment provider.');
        const productId = await ensureStripeProduct(plan);
        const meta = { kind: 'subscription', user_id: rc.user.id, plan };
        const updated = await stripe.updateSubscription(
          r.subscription_ref,
          {
            items: [{ id: itemId, price_data: { currency: 'usd', product: productId, unit_amount: planById(plan).priceCents, recurring: { interval: 'month' } } }],
            proration_behavior: 'create_prorations',
            cancel_at_period_end: false,
            metadata: meta,
          },
          `change-${r.subscription_ref}-${plan}-${ctx.now()}`,
        );
        ctx.tx(() => billing.applyStripeSubscription(updated));
        return meWire(rc.user.id);
      },
    },
    {
      method: 'POST',
      path: '/api/billing/cancel',
      handler: async (rc) => {
        const r = activeSub(rc.user.id);
        if (r.cancel_at_period_end) throw new HttpError(409, 'Your plan is already set to end.');
        if (r.provider === 'stripe') {
          const updated = await stripe.updateSubscription(r.subscription_ref, { cancel_at_period_end: true });
          ctx.tx(() => billing.applyStripeSubscription(updated));
        } else db.prepare('UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE id = ?').run(ctx.now(), r.id);
        return meWire(rc.user.id);
      },
    },
    {
      method: 'POST',
      path: '/api/billing/resume',
      handler: async (rc) => {
        const r = activeSub(rc.user.id);
        if (!r.cancel_at_period_end) throw new HttpError(409, 'Your plan isn’t set to cancel.');
        if (r.provider === 'stripe') {
          const updated = await stripe.updateSubscription(r.subscription_ref, { cancel_at_period_end: false });
          ctx.tx(() => billing.applyStripeSubscription(updated));
        } else db.prepare('UPDATE subscriptions SET cancel_at_period_end = 0, updated_at = ? WHERE id = ?').run(ctx.now(), r.id);
        return meWire(rc.user.id);
      },
    },
    {
      // Every export goes through here. Image exports are drawn in the browser once this says
      // yes; the CSV and the project file are made here, only for an entitled owner.
      method: 'POST',
      path: '/api/projects/:id/exports',
      rateLimit: { name: 'exports', max: 300, windowMs: 3_600_000, by: 'user' },
      handler: async (rc) => {
        const kind = rc.body.kind;
        if (!EXPORT_KINDS.includes(kind)) throw new HttpError(400, 'Choose what to export.');
        const project = ownedProject(rc.user.id, rc.params.id);
        if (!billing.canExport(rc.user.id, project.id)) throw new HttpError(403, 'Exports are a paid feature.', { needs: 'unlock' });
        const doc = { ...JSON.parse(project.doc), name: project.name };
        let file = null;
        if (kind === 'csv') {
          const kit = await loadKit();
          const out = kit.csvFor(doc, { products: liveProducts(doc, rc.user), priceBook: services.pricing.priceBookFor(rc.user.id) });
          file = { filename: out.filename, contentType: 'text/csv', content: out.content };
        } else if (kind === 'json') {
          const clean = services.pricing.stripDoc(doc, { viewer: null, ownerUserId: rc.user.id });
          file = { filename: `${slug(project.name)}.kitchen.json`, contentType: 'application/json', content: JSON.stringify({ app: 'mise-kitchen', version: 2, doc: clean }, null, 2) };
        }
        db.prepare('INSERT INTO export_events (project_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)').run(project.id, rc.user.id, kind, ctx.now());
        return { ok: true, ...(file ? { file } : {}) };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/billing',
      auth: 'admin',
      handler: () => ({ payments: config.paymentsProvider, ...billing.adminStats() }),
    },
  ];
}
