// A showroom's license and monthly plan (docs/SHOWROOM_PIVOT.md §2, §5 "Plan", §8; the service is
// server/billing/showroom.mjs). Prices come only from src/data/plans.json; a client never sends
// an amount for the monthly plan (an admin types the license amount a deal was signed at).
//
// Admin (sales site; audited):
//   POST   /api/admin/tenants/:id/licenses              { amountCents?, currency?, startsOn?, endsOn?, paidHow, note? }
//                                                       -> 201 { license, tenant }
//   DELETE /api/admin/tenants/:id/licenses/:licenseId   -> { license, tenant } (voided, kept)
//   POST   /api/admin/tenants/:id/monthly/checkout      -> 201 { checkout: { ref, url, status, ... }, tenant }
//                                                       a Stripe Checkout link (subscription, $50 CAD a
//                                                       month) to send the company; demo: #/pay/showroom/<ref>
//   POST   /api/admin/tenants/:id/monthly/comp          { on: boolean, note? } -> { tenant }
//   POST   /api/admin/tenants/:id/monthly/cancel        -> { tenant } (Stripe: at the period end)
//   POST   /api/admin/tenants/:id/monthly/demo          demo only: { event: renewal|renewal_failed|grace_end|cancel }
// Public (sales site), for the link the company opens:
//   GET    /api/showroom-checkouts/:ref                 { checkout: { …, payUrl }, showroom: { name, slug, live, url } }
//   POST   /api/showroom-checkouts/:ref/demo            demo only: { outcome: success|cancel } -> { checkout }
//   POST   /api/showroom-checkouts/:ref/sync            { sessionId } back from Stripe (?session_id=): don't
//                                                       wait for the webhook -> { checkout }
//   GET    /api/admin/tenants/:id/credits               { balanceCents, lots, nextExpiry, heldCents, history }
//   POST   /api/admin/tenants/:id/credits               { cents: +/- integer, note } -> the same (audited)
// Workspace (showroom, team):
//   GET    /api/workspace/plan                          { license, licenses, monthly, receipts, standing, prices, graceDays }
//   POST   /api/workspace/plan/portal                   owner -> { url } (Stripe's billing portal for the card)
//   GET    /api/workspace/credits                       { balanceCents, lots, nextExpiry, heldCents, renderCostCents,
//                                                         rolloverMonths, history } (?before=<entry id> pages history)

import { HttpError } from '../http/respond.mjs';
import { audit } from '../lib/audit.mjs';
import { CURRENCY, SHOWROOM_MONTHLY } from '../lib/plans.mjs';
import { createStripe, idOf, periodEndOf } from '../billing/stripe.mjs';
import { paymentsUnavailable } from '../payments/stripeApi.mjs';
import { GRACE_DAYS } from '../billing/showroom.mjs';
import { requestOrigin } from '../tenancy/hosts.mjs';

const ID_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const REF_PARAM = /^tc_[A-Za-z0-9_-]{16,40}$/;

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config, services } = ctx;
  const { tenants, showroomBilling: sb, webhooks, credits } = services;
  const stripe = createStripe({ config, fetch: (...a) => ctx.fetch(...a), log: ctx.log });
  const demo = () => config.paymentsProvider === 'demo';
  const requirePayments = () => {
    if (config.paymentsProvider === 'none') throw paymentsUnavailable();
  };

  // ── Stripe events (the webhook route is the foundation's) ───────────────
  webhooks.on('showroom_monthly', (e) => sb.onCheckoutEvent(e));
  for (const type of ['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']) webhooks.on(type, (e) => sb.applyStripeSubscription(e.data?.object ?? {}));
  webhooks.on('invoice.paid', (e) => sb.invoicePaid(e.data?.object ?? {}));
  webhooks.on('invoice.payment_failed', (e) => sb.invoiceFailed(e.data?.object ?? {}));
  // A monthly payment refunded or charged back: its unspent credits go, the company is flagged for
  // review, and the plan goes past due (grace). orders.mjs handles the same events for orders.
  const reversal = (kind, e) => {
    const o = e.data?.object ?? {};
    const out = sb.paymentReversed({
      kind,
      invoiceRef: idOf(o.invoice),
      paymentIntent: idOf(o.payment_intent),
      chargeRef: kind === 'dispute' ? idOf(o.charge) : (idOf(o.id) ?? null),
      amountRefunded: kind === 'refund' ? o.amount_refunded : null,
    });
    if (out?.changed) {
      audit(db, { admin: null, action: kind === 'dispute' ? 'showroom_payment_disputed' : 'showroom_payment_refunded', detail: { tenantId: out.tenantId, status: out.status, creditsRevoked: out.creditsRevoked, event: String(e.id ?? '') }, at: ctx.now() });
    }
  };
  webhooks.on('charge.refunded', (e) => reversal('refund', e));
  webhooks.on('charge.dispute.created', (e) => reversal('dispute', e));

  // The admin's tenant view carries the money.
  tenants.addAdminExtra((t) => ({
    standing: { ...sb.standing(t.id), live: t.status === 'live' },
    license: sb.currentLicense(t.id),
    licenses: sb.licenses(t.id),
    monthly: sb.monthlyWire(t.id),
    review: sb.review(t.id),
    checkouts: sb.checkouts(t.id),
    credits: { balanceCents: credits.balance(t.id) },
  }));
  const creditsWire = (tenantId, rc, limit) => {
    const before = Number(rc.query.get('before'));
    return { ...credits.summary(tenantId), history: credits.history(tenantId, { limit, before: Number.isInteger(before) && before > 0 ? before : undefined }) };
  };

  const mustGet = (id) => {
    const t = tenants.get(id);
    if (!t) throw new HttpError(404, 'That showroom does not exist.');
    return t;
  };
  const from = (rc) => requestOrigin(rc.req, config);
  const adminView = (rc, id) => tenants.adminWire(tenants.refresh(id), from(rc));
  const log = (rc, action, t, detail = {}) => audit(db, { admin: rc.user, action, detail: { tenantId: t.id, slug: t.slug, ...detail }, at: ctx.now() });

  const planWire = (t) => ({
    license: sb.currentLicense(t.id),
    licenses: sb.licenses(t.id).filter((l) => !l.voidedAt),
    monthly: sb.monthlyWire(t.id),
    receipts: sb.payments(t.id),
    standing: { ...sb.standing(t.id), status: t.status },
    prices: {
      // No list price: the setup and license are quoted per company (the amount is on the license).
      license: { quoted: true },
      monthly: { cents: SHOWROOM_MONTHLY.priceCents, hostingCents: SHOWROOM_MONTHLY.hostingCents, creditCents: SHOWROOM_MONTHLY.creditCents },
      currency: CURRENCY,
    },
    graceDays: GRACE_DAYS,
  });

  /** The address billing emails go to: the showroom's contact email, else its first owner's. */
  const billingEmail = (t) =>
    t.contact?.email || db.prepare("SELECT u.email FROM tenant_members m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? AND m.role = 'owner' ORDER BY m.created_at LIMIT 1").get(t.id)?.email || null;

  return [
    // ── admin: licenses ─────────────────────────────────────────────────────
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/licenses',
      auth: 'admin',
      // Money or access: the password and 2FA code again within REAUTH_MINUTES.
      reauth: true,
      params: { id: ID_PARAM },
      maxBytes: 4_096,
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        const b = rc.body ?? {};
        const license = ctx.tx(() => {
          const l = sb.recordLicense(t.id, { amountCents: b.amountCents, currency: b.currency, startsOn: b.startsOn, endsOn: b.endsOn, paidHow: b.paidHow, note: b.note ?? '' }, { by: rc.user.id });
          log(rc, 'tenant_license_record', t, { licenseId: l.id, amountCents: l.amountCents, currency: l.currency, startsOn: l.startsOn, endsOn: l.endsOn, paidHow: l.paidHow });
          return l;
        });
        rc.send(201, { license, tenant: adminView(rc, t.id) });
      },
    },
    {
      method: 'DELETE',
      path: '/api/admin/tenants/:id/licenses/:licenseId',
      auth: 'admin',
      // Money or access: the password and 2FA code again within REAUTH_MINUTES.
      reauth: true,
      params: { id: ID_PARAM, licenseId: ID_PARAM },
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        const license = ctx.tx(() => {
          const l = sb.voidLicense(t.id, rc.params.licenseId, { by: rc.user.id });
          log(rc, 'tenant_license_void', t, { licenseId: l.id });
          return l;
        });
        return { license, tenant: adminView(rc, t.id) };
      },
    },

    // ── admin: the monthly plan ─────────────────────────────────────────────
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/monthly/checkout',
      auth: 'admin',
      params: { id: ID_PARAM },
      rateLimit: { name: 'admin-showroom-checkout', max: 60, windowMs: 3_600_000, by: 'user' },
      handler: async (rc) => {
        requirePayments();
        const t = mustGet(rc.params.id);
        const cur = sb.subRow(t.id);
        if (cur && cur.provider === 'stripe' && cur.status !== 'canceled' && sb.monthlyPaid(t.id)) {
          throw new HttpError(409, 'This showroom’s monthly plan is already paid.', { code: 'already_paid' });
        }
        const provider = demo() ? 'demo' : 'stripe';
        // A new link over a Stripe subscription that stopped paying: cancel that one first, or the
        // company could end up with two subscriptions and be charged on both.
        if (cur && cur.provider === 'stripe' && cur.subscription_ref && ['past_due', 'incomplete'].includes(cur.status) && provider === 'stripe') {
          await stripe.cancelSubscription(cur.subscription_ref, `${cur.subscription_ref}-cancel-for-new-link`);
          sb.upsert(t.id, { status: 'canceled', graceUntil: null });
          log(rc, 'tenant_monthly_cancel', t, { subscriptionRef: cur.subscription_ref, reason: 'replaced by a new checkout link' });
        }
        const c = sb.newCheckout(t.id, { provider, by: rc.user.id });
        let url;
        if (provider === 'demo') url = `${config.PUBLIC_URL}/#/pay/showroom/${c.ref}`;
        else {
          // Back to the sales site's payment page, not the showroom: a lapsed showroom answers 503
          // until the payment lands, and the page doesn't need a sign-in.
          const meta = { kind: 'showroom_monthly', checkout_ref: c.ref, tenant_id: t.id };
          const email = billingEmail(t);
          const session = await stripe.createCheckoutSession(
            {
              mode: 'subscription',
              client_reference_id: c.ref,
              success_url: `${config.PUBLIC_URL}/?session_id={CHECKOUT_SESSION_ID}#/pay/showroom/${c.ref}`,
              cancel_url: `${config.PUBLIC_URL}/#/pay/showroom/${c.ref}`,
              line_items: [
                {
                  quantity: 1,
                  price_data: {
                    currency: CURRENCY,
                    unit_amount: SHOWROOM_MONTHLY.priceCents,
                    recurring: { interval: 'month' },
                    product_data: { name: `BluModel Studio showroom - ${t.name}`.slice(0, 120) },
                  },
                },
              ],
              metadata: meta,
              subscription_data: { metadata: meta },
              ...(cur?.customer_ref ? { customer: cur.customer_ref } : email ? { customer_email: email } : {}),
            },
            `${c.ref}-checkout`,
          );
          if (typeof session.url !== 'string' || !session.url.startsWith('https://')) throw new HttpError(502, 'The payment provider didn’t return a checkout page.');
          url = session.url;
          db.prepare('UPDATE tenant_checkouts SET provider_ref = ? WHERE ref = ?').run(session.id ?? null, c.ref);
        }
        db.prepare('UPDATE tenant_checkouts SET url = ? WHERE ref = ?').run(url, c.ref);
        log(rc, 'tenant_monthly_checkout', t, { ref: c.ref, provider });
        rc.send(201, { checkout: sb.checkoutWire(sb.checkout(c.ref)), tenant: adminView(rc, t.id) });
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/monthly/comp',
      auth: 'admin',
      // Money or access: the password and 2FA code again within REAUTH_MINUTES.
      reauth: true,
      params: { id: ID_PARAM },
      maxBytes: 2_048,
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        if (typeof rc.body?.on !== 'boolean') throw new HttpError(400, 'Say on: true or on: false.');
        const note = typeof rc.body.note === 'string' ? rc.body.note.trim().slice(0, 500) : '';
        ctx.tx(() => {
          sb.setComplimentary(t.id, rc.body.on, { note });
          log(rc, rc.body.on ? 'tenant_monthly_comp_on' : 'tenant_monthly_comp_off', t, { note });
        });
        return { tenant: adminView(rc, t.id) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/monthly/cancel',
      auth: 'admin',
      params: { id: ID_PARAM },
      handler: async (rc) => {
        const t = mustGet(rc.params.id);
        const r = sb.subRow(t.id);
        if (!r || r.status === 'canceled') throw new HttpError(409, 'This showroom has no monthly plan running.');
        if (r.provider === 'stripe') {
          requirePayments();
          const updated = await stripe.updateSubscription(r.subscription_ref, { cancel_at_period_end: true });
          ctx.tx(() => sb.applyStripeSubscription(updated));
        } else ctx.tx(() => sb.upsert(t.id, r.provider === 'comp' ? { status: 'canceled' } : { cancelAtPeriodEnd: true }));
        log(rc, 'tenant_monthly_cancel', t, { provider: r.provider });
        return { tenant: adminView(rc, t.id) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/monthly/demo',
      auth: 'admin',
      params: { id: ID_PARAM },
      maxBytes: 1_024,
      handler: (rc) => {
        if (!demo()) throw new HttpError(403, 'Demo payments are only available when Stripe isn’t configured.');
        const t = mustGet(rc.params.id);
        ctx.tx(() => sb.demoEvent(t.id, rc.body?.event));
        return { tenant: adminView(rc, t.id) };
      },
    },

    // ── admin: credits ──────────────────────────────────────────────────────
    {
      // A refunded or disputed monthly payment flagged the company (sb.paymentReversed): an admin
      // looked at it. restore: the plan the reversal put past due is active again.
      method: 'POST',
      path: '/api/admin/tenants/:id/review/clear',
      auth: 'admin',
      reauth: true,
      params: { id: ID_PARAM },
      maxBytes: 512,
      handler: (rc) => {
        const t = tenants.get(rc.params.id);
        if (!t) throw new HttpError(404, 'That showroom does not exist.');
        const was = sb.review(t.id);
        ctx.tx(() => {
          sb.clearReview(t.id, { restore: rc.body?.restore === true });
          audit(db, { admin: rc.user, action: 'tenant_review_clear', detail: { tenantId: t.id, slug: t.slug, reason: was?.reason ?? null, restore: rc.body?.restore === true }, at: ctx.now() });
        });
        return { tenant: tenants.adminWire(tenants.get(t.id), requestOrigin(rc.req, config)) };
      },
    },
    {
      method: 'GET',
      path: '/api/admin/tenants/:id/credits',
      auth: 'admin',
      params: { id: ID_PARAM },
      handler: (rc) => creditsWire(mustGet(rc.params.id).id, rc, 200),
    },
    {
      method: 'POST',
      path: '/api/admin/tenants/:id/credits',
      auth: 'admin',
      // Money or access: the password and 2FA code again within REAUTH_MINUTES.
      reauth: true,
      params: { id: ID_PARAM },
      maxBytes: 2_048,
      handler: (rc) => {
        const t = mustGet(rc.params.id);
        const cents = rc.body?.cents;
        const note = rc.body?.note;
        ctx.tx(() => {
          credits.adjust(t.id, cents, { note, by: rc.user.id });
          log(rc, 'tenant_credit_adjust', t, { cents, note: String(note).slice(0, 500) });
        });
        return creditsWire(t.id, rc, 200);
      },
    },

    // ── the checkout link the company opens ─────────────────────────────────
    {
      method: 'GET',
      path: '/api/showroom-checkouts/:ref',
      auth: 'none',
      hosts: 'sales',
      params: { ref: REF_PARAM },
      rateLimit: { name: 'showroom-checkout-read', max: 120, windowMs: 3_600_000, by: 'ip' },
      handler: (rc) => {
        const c = sb.checkout(rc.params.ref);
        if (!c) throw new HttpError(404, 'That payment link doesn’t exist.');
        const t = tenants.refresh(c.tenant_id);
        const { status, amountCents, currency, provider, ref, url } = sb.checkoutWire(c);
        // payUrl: Stripe's own checkout page while the link is unpaid, so this page can send the
        // company there (it's the page the admin's link and Stripe's cancel_url land on).
        const payUrl = provider === 'stripe' && status === 'pending' && typeof url === 'string' && url.startsWith('https://checkout.stripe.com/') ? url : null;
        return {
          checkout: { ref, status, amountCents, currency, provider, demo: provider === 'demo', payUrl },
          showroom: { name: t?.name ?? '', slug: t?.slug ?? '', live: t?.status === 'live', url: t ? tenants.originOf(t, requestOrigin(rc.req, config)) : null },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/showroom-checkouts/:ref/demo',
      auth: 'none',
      hosts: 'sales',
      params: { ref: REF_PARAM },
      maxBytes: 1_024,
      rateLimit: { name: 'showroom-checkout-demo', max: 30, windowMs: 3_600_000, by: 'ip' },
      handler: (rc) => {
        // The demo provider moves no money and collects no card: anyone holding the link may "pay".
        if (!demo()) throw new HttpError(403, 'Demo payments are only available when Stripe isn’t configured.');
        const c = sb.checkout(rc.params.ref);
        if (!c || c.provider !== 'demo') throw new HttpError(404, 'That payment link doesn’t exist.');
        const outcome = rc.body?.outcome;
        if (!['success', 'cancel'].includes(outcome)) throw new HttpError(400, 'Choose success or cancel.');
        if (c.status !== 'pending' && c.status !== 'completed') throw new HttpError(409, 'That payment link has ended. Ask for a new one.');
        ctx.tx(() => (outcome === 'success' ? sb.fulfilCheckout(c.ref) : sb.endCheckout(c.ref, 'canceled')));
        return { checkout: sb.checkoutWire(sb.checkout(c.ref)) };
      },
    },

    {
      method: 'POST',
      path: '/api/showroom-checkouts/:ref/sync',
      auth: 'none',
      hosts: 'sales',
      params: { ref: REF_PARAM },
      maxBytes: 1_024,
      rateLimit: { name: 'showroom-checkout-sync', max: 30, windowMs: 3_600_000, by: 'ip' },
      handler: async (rc) => {
        requirePayments();
        const c = sb.checkout(rc.params.ref);
        if (!c) throw new HttpError(404, 'That payment link doesn’t exist.');
        const sessionId = String(rc.body?.sessionId ?? '');
        if (c.provider === 'stripe' && c.status === 'pending' && /^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) {
          // Stripe's own answer is the record: only a paid session made for this very link counts.
          const s = await stripe.retrieveCheckoutSession(sessionId);
          const ref = s?.metadata?.checkout_ref ?? s?.client_reference_id;
          if (ref === c.ref && s?.metadata?.tenant_id === c.tenant_id && (s.payment_status === 'paid' || s.status === 'complete')) {
            ctx.tx(() => {
              sb.fulfilCheckout(c.ref, { customerRef: idOf(s.customer), subscriptionRef: idOf(s.subscription), periodEnd: s.subscription && typeof s.subscription === 'object' ? periodEndOf(s.subscription) : null, providerRef: s.id });
              if (s.subscription && typeof s.subscription === 'object') sb.applyStripeSubscription(s.subscription);
            });
          }
        }
        const t = tenants.refresh(c.tenant_id);
        const w = sb.checkoutWire(sb.checkout(c.ref));
        return { checkout: { ref: w.ref, status: w.status, amountCents: w.amountCents, currency: w.currency, provider: w.provider }, showroom: { name: t?.name ?? '', slug: t?.slug ?? '', live: t?.status === 'live' } };
      },
    },

    // ── workspace: the plan ─────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/workspace/plan',
      auth: 'staff',
      handler: (rc) => planWire(tenants.refresh(rc.tenant.id)),
    },
    {
      method: 'GET',
      path: '/api/workspace/credits',
      auth: 'staff',
      handler: (rc) => ({
        ...creditsWire(rc.tenant.id, rc, 50),
        renderCostCents: config.RENDER_CREDIT_CENTS,
        rolloverMonths: SHOWROOM_MONTHLY.creditRolloverMonths,
      }),
    },
    {
      method: 'POST',
      path: '/api/workspace/plan/portal',
      auth: 'owner',
      body: 'none',
      handler: async (rc) => {
        requirePayments();
        const r = sb.subRow(rc.tenant.id);
        if (!r || r.provider !== 'stripe' || !r.customer_ref) throw new HttpError(409, 'There are no card details on file for this showroom.', { code: 'no_customer' });
        const s = await stripe.createPortalSession({ customer: r.customer_ref, return_url: `${tenants.originOf(rc.tenant, from(rc))}/#/studio/plan` });
        return { url: s.url };
      },
    },
  ];
}
