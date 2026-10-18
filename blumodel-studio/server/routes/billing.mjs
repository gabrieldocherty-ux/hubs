// Package G (billing): the kitchen unlock, the Unlimited and Contractor monthly plans, Account →
// Billing and Admin → Billing (PLANS_AND_CONTRACTORS §1–§3, §5).
//
// Since the showroom pivot (docs/SHOWROOM_PIVOT.md §2-3) all of that is LEGACY: no new checkout,
// unlock or plan change is sold (410 not_for_sale), and exports are free for everyone. What was
// paid keeps working until it ends: receipts, the Stripe portal, cancel/resume, renewals and the
// webhooks. The showroom's own money (license, monthly plan, credits) is server/billing/showroom.mjs
// and server/billing/credits.mjs.
//
// Payments go through Stripe Checkout when the server has both Stripe keys, otherwise
// through the clearly labelled DEMO provider, which moves no money and collects no card
// details. Prices come only from src/data/plans.json; a client never sends an amount.
// Every new checkout is in CAD; a Stripe customer that paid in another currency is never
// reused for it (Stripe refuses mixed currencies), so the checkout starts a fresh customer.

import { HttpError } from '../http/respond.mjs';
import { requestVisitor } from '../tenancy/leads.mjs';
import { randomId, PRODUCT_ID_RE } from '../lib/ids.mjs';
import { CURRENCY, planById, PLANS, SUBSCRIPTION_PLANS } from '../lib/plans.mjs';
import { loadKit } from '../lib/kit.mjs';
import { createBillingService, GRACE_MS } from '../billing/service.mjs';
import { createStripe, idOf, periodEndOf } from '../billing/stripe.mjs';
import { paymentsUnavailable, StripeApiError } from '../payments/stripeApi.mjs';
import { createAllowance } from '../payments/allowance.mjs';
import { audit, auditLog } from '../lib/audit.mjs';

export const EXPORT_KINDS = ['plan_png', 'scene_png', 'csv', 'json', 'render', 'quote'];

/** True: the legacy checkout and plan change are refused (docs/SHOWROOM_PIVOT.md §3). */
const LEGACY_CHECKOUT = true;
const notForSale = () =>
  new HttpError(410, 'BluModel Studio no longer sells plans or kitchen unlocks: designing, saving and downloading are free. Anything you already paid for keeps working until it ends.', {
    code: 'not_for_sale',
  });
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
  const allowance = createAllowance({ db, now: ctx.now, billing, config });

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
  const ownedProject = (userId, id, tenantId = null) => {
    const p = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ? AND tenant_id IS ?').get(id, userId, tenantId);
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

  /** No payments on this server (launch contract): checkout and billing changes answer 503. */
  const requirePayments = () => {
    if (config.paymentsProvider === 'none') throw paymentsUnavailable();
  };
  const requireDemo = () => {
    requirePayments();
    if (!demo()) throw new HttpError(403, 'Demo payments are only available when Stripe isn’t configured.');
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
  const liveProducts = (doc, user, site) => {
    const out = [];
    for (const id of new Set((doc.items ?? []).map((i) => i.productId))) {
      if (!PRODUCT_ID_RE.test(id)) continue;
      const row = services.products.get(id);
      if (row && services.products.inCatalog(row, user, site)) {
        const w = services.products.toWire(row, { which: 'live', viewer: user });
        if (w) out.push(w);
      }
    }
    return out;
  };

  async function startStripeCheckout(c, user) {
    const sub = c.kind === 'subscription';
    const plan = sub ? planById(c.plan) : planById('kitchen_unlock');
    // Only a customer that already pays in this checkout's currency; otherwise Stripe makes a new one.
    const customer = billing.customerFor(user.id, c.currency);
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
              currency: c.currency,
              unit_amount: c.amount_cents,
              product_data: { name: sub ? `BluModel Studio - ${plan.name}` : `BluModel Studio - Kitchen unlock: ${c.project_name || 'kitchen'}`.slice(0, 120) },
              ...(sub ? { recurring: { interval: 'month' } } : {}),
            },
          },
        ],
        metadata: meta,
        ...(customer ? { customer } : { customer_email: user.email }),
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
    const product = await stripe.createProduct({ name: `BluModel Studio - ${planById(plan).name}`, metadata: { blumodel_plan: plan } }, `blumodel-product-${plan}`);
    db.prepare('INSERT OR REPLACE INTO billing_stripe_products (plan, product_id, created_at) VALUES (?, ?, ?)').run(plan, product.id, ctx.now());
    return product.id;
  }

  const activeSub = (userId) => {
    const plan = billing.planOf(userId);
    const r = billing.subRow(userId);
    if (plan.id === 'free' || !r) throw new HttpError(409, 'You don’t have a plan to change. Choose one from Pricing.');
    if (r.provider === 'comp') throw new HttpError(409, 'Your plan was given to you by BluModel Studio. Contact support to change it.', { code: 'complimentary_plan' });
    return r;
  };

  const GRANT_NOTE_MAX = 500;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
        // Nothing new is sold to homeowners or contractors (docs/SHOWROOM_PIVOT.md §3).
        if (LEGACY_CHECKOUT) throw notForSale();
        requirePayments();
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
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        ).run(ref, user.id, kind, projectId, projectName, plan, amount, CURRENCY, provider, returnTo, ctx.now());
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
        requirePayments();
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
        requirePayments();
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
        // A plan change buys a different plan, so it is refused like a new checkout; cancel and
        // resume still work for a plan that is running.
        if (LEGACY_CHECKOUT) throw notForSale();
        requirePayments();
        const plan = rc.body.plan;
        if (!SUBSCRIPTION_PLANS.includes(plan)) throw new HttpError(400, 'Choose Unlimited or Contractor.');
        const r = activeSub(rc.user.id);
        if (r.plan === plan && !r.cancel_at_period_end) throw new HttpError(409, `You’re already on ${planById(plan).name}.`);
        // A change is billed at today's price, in CAD (the old price stays only while nothing changes).
        if (r.provider === 'demo') {
          db.prepare('UPDATE subscriptions SET plan = ?, cancel_at_period_end = 0, amount_cents = ?, currency = ?, updated_at = ? WHERE id = ?').run(plan, planById(plan).priceCents, CURRENCY, ctx.now(), r.id);
          return meWire(rc.user.id);
        }
        // A Stripe subscription can't change currency in place, so one started in US dollars is
        // switched by cancelling it and choosing the new plan in CAD once it ends.
        if (r.currency && r.currency !== CURRENCY) {
          throw new HttpError(409, `Your plan is billed in ${r.currency.toUpperCase()} from before prices moved to Canadian dollars, so it can’t be switched in place. Cancel it here; it runs to the end of the period you paid for, and then you can choose ${planById(plan).name} in CAD.`, {
            code: 'currency_change',
            currency: r.currency,
            periodEnd: r.current_period_end ?? null,
          });
        }
        const sub = await stripe.retrieveSubscription(r.subscription_ref);
        const itemId = sub?.items?.data?.[0]?.id;
        if (!itemId) throw new HttpError(502, 'Couldn’t read the subscription from the payment provider.');
        const productId = await ensureStripeProduct(plan);
        const meta = { kind: 'subscription', user_id: rc.user.id, plan };
        // The Contractor plan includes custom models made by the studio, so money has to match them:
        // - an upgrade to Contractor is invoiced and charged now (always_invoice) and Stripe refuses
        //   the change if that payment fails (error_if_incomplete), so the plan, and its models,
        //   only apply once the difference is paid;
        // - leaving Contractor after models were requested this period gives no credit back
        //   (proration 'none'); otherwise an unused period is credited as usual.
        const upgrade = plan === 'contractor' && r.plan !== 'contractor';
        const leavingAfterModels = r.plan === 'contractor' && plan !== 'contractor' && allowance.of(rc.user.id).used > 0;
        const proration = upgrade
          ? { proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' }
          : { proration_behavior: leavingAfterModels ? 'none' : 'create_prorations' };
        let updated;
        try {
          updated = await stripe.updateSubscription(
            r.subscription_ref,
            {
              items: [{ id: itemId, price_data: { currency: CURRENCY, product: productId, unit_amount: planById(plan).priceCents, recurring: { interval: 'month' } } }],
              ...proration,
              cancel_at_period_end: false,
              metadata: meta,
            },
            `change-${r.subscription_ref}-${plan}-${ctx.now()}`,
          );
        } catch (e) {
          if (upgrade && e instanceof StripeApiError && (e.stripeStatus === 402 || e.stripeType === 'card_error')) {
            throw new HttpError(402, 'The payment for the upgrade didn’t go through, so your plan hasn’t changed. Update your card from Billing and try again.', { code: 'upgrade_payment_failed' });
          }
          throw e;
        }
        ctx.tx(() => billing.applyStripeSubscription(updated));
        return meWire(rc.user.id);
      },
    },
    {
      method: 'POST',
      path: '/api/billing/cancel',
      handler: async (rc) => {
        requirePayments();
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
        requirePayments();
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
      // Free for everyone, on every site; a showroom visitor exports their own kitchen there.
      hosts: 'any',
      // A showroom visitor without an account (server/tenancy/leads.mjs) exports their own designs too.
      auth: 'optional',
      rateLimit: { name: 'exports', max: 300, windowMs: 3_600_000, by: 'user' },
      handler: async (rc) => {
        const kind = rc.body.kind;
        if (!EXPORT_KINDS.includes(kind)) throw new HttpError(400, 'Choose what to export.');
        const visitor = rc.user ? null : requestVisitor(rc);
        if (!rc.user && !visitor) throw new HttpError(401, 'Please sign in.');
        const project = rc.user
          ? ownedProject(rc.user.id, rc.params.id, rc.site.tenantId)
          : db.prepare('SELECT * FROM projects WHERE id = ? AND visitor_id = ? AND tenant_id IS ?').get(rc.params.id, visitor.id, rc.site.tenantId);
        if (!project) throw new HttpError(404, 'That kitchen does not exist.');
        const ownerId = rc.user?.id ?? null;
        const doc = { ...JSON.parse(project.doc), name: project.name };
        let file = null;
        if (kind === 'csv') {
          const kit = await loadKit();
          const out = kit.csvFor(doc, { products: liveProducts(doc, rc.user, rc.site), priceBook: services.pricing.priceBookFor(ownerId) });
          file = { filename: out.filename, contentType: 'text/csv', content: out.content };
        } else if (kind === 'json') {
          const clean = services.pricing.stripDoc(doc, { viewer: null, ownerUserId: ownerId });
          file = { filename: `${slug(project.name)}.kitchen.json`, contentType: 'application/json', content: JSON.stringify({ app: 'blumodel-studio', version: 2, doc: clean }, null, 2) };
        }
        db.prepare('INSERT INTO export_events (project_id, user_id, kind, created_at) VALUES (?, ?, ?, ?)').run(project.id, ownerId ?? `visitor:${visitor.id}`, kind, ctx.now());
        return { ok: true, ...(file ? { file } : {}) };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/billing',
      auth: 'admin',
      handler: () => ({ payments: config.paymentsProvider, ...billing.adminStats() }),
    },

    // -- complimentary plans (admin only, audit-logged) -------------------------------------
    {
      method: 'GET',
      path: '/api/admin/billing/grants',
      auth: 'admin',
      handler: () => ({ grants: billing.compGrants(), audit: auditLog(db, { limit: 200 }) }),
    },
    {
      method: 'POST',
      path: '/api/admin/billing/grant',
      auth: 'admin',
      // Money or access: the password and 2FA code again within REAUTH_MINUTES.
      reauth: true,
      maxBytes: 8_192,
      rateLimit: { name: 'admin-grant', max: 120, windowMs: 3_600_000, by: 'user' },
      handler: (rc) => {
        const email = typeof rc.body.email === 'string' ? rc.body.email.trim().toLowerCase().slice(0, 254) : '';
        const plan = rc.body.plan;
        const note = typeof rc.body.note === 'string' ? rc.body.note.trim() : '';
        if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter the account’s email address.', { errors: [{ field: 'email', message: 'Enter the account’s email address.' }] });
        if (!SUBSCRIPTION_PLANS.includes(plan)) throw new HttpError(400, 'Choose Unlimited or Contractor.', { errors: [{ field: 'plan', message: 'Choose Unlimited or Contractor.' }] });
        if (note.length > GRANT_NOTE_MAX) throw new HttpError(400, `Keep the note to ${GRANT_NOTE_MAX} characters or fewer.`, { errors: [{ field: 'note', message: `Keep the note to ${GRANT_NOTE_MAX} characters or fewer.` }] });
        const target = db.prepare('SELECT id, email FROM users WHERE email = ? AND tenant_id IS NULL').get(email);
        if (!target) throw new HttpError(404, 'No account has that email address.', { code: 'no_such_user' });
        const out = ctx.tx(() => {
          let res;
          try {
            res = billing.grantComp(target.id, { plan, note, adminId: rc.user.id });
          } catch (err) {
            if (err?.code === 'paid_subscription') throw new HttpError(409, err.message, { code: 'paid_subscription' });
            throw err;
          }
          audit(db, { admin: rc.user, action: 'comp_grant', targetUserId: target.id, targetEmail: target.email, detail: { plan, note, replaced: res.replaced }, at: ctx.now() });
          return res;
        });
        rc.send(201, { grant: billing.compWire(out.row) });
      },
    },
    {
      method: 'DELETE',
      path: '/api/admin/billing/grant/:id',
      auth: 'admin',
      handler: (rc) => {
        const row = ctx.tx(() => {
          const r = billing.revokeComp(rc.params.id);
          if (!r) throw new HttpError(404, 'There is no active complimentary plan with that id.');
          const u = db.prepare('SELECT email FROM users WHERE id = ?').get(r.user_id);
          audit(db, { admin: rc.user, action: 'comp_revoke', targetUserId: r.user_id, targetEmail: u?.email ?? '', detail: { plan: r.plan, grantId: r.id }, at: ctx.now() });
          return r;
        });
        return { grant: billing.compWire(row) };
      },
    },
  ];
}
