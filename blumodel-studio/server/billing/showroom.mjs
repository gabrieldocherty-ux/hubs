// A showroom's money (docs/SHOWROOM_PIVOT.md §2, docs/handoff/tenancy.md "Plans & money"). Exposed
// as ctx.services.showroomBilling. Everything here is synchronous SQLite, so callers (the webhook
// route among them) can run it inside one ctx.tx.
//
//   license   yearly, sold by phone and invoiced: an admin records company, amount, start and end
//             dates and how it was paid (tenant_licenses). Current while start <= today <= end
//             (UTC calendar days). Voiding one keeps the row.
//   monthly   $50/month through Stripe Checkout (subscription mode) that an admin sends; the
//             webhook fulfils it (tenant_subscriptions). Paid while active, and for GRACE_DAYS
//             after a failed renewal (or a missed period end). 'comp' is a complimentary plan an
//             admin switches on (the demo showroom, special deals); 'demo' is the labelled demo
//             provider for dev and QA, which moves no money.
//   live      the license is current AND the monthly plan is paid: services.tenants recomputes the
//             status from standing() (registered in app.mjs).
//
// Credits for each paid month are granted by server/billing/credits.mjs from invoice.paid
// (onMonthPaid below), once per invoice.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { CURRENCY, SHOWROOM_LICENSE, SHOWROOM_MONTHLY } from '../lib/plans.mjs';
import { idOf, invoicePeriodEnd, invoiceSubscriptionId, periodEndOf } from './stripe.mjs';
import { addMonths } from './service.mjs';

export const GRACE_DAYS = 14;
export const GRACE_MS = GRACE_DAYS * 86_400_000;
export const PAID_HOW = ['invoice', 'etransfer', 'cheque', 'card', 'cash', 'comp', 'other'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const STRIPE_STATUS = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'canceled',
  incomplete_expired: 'canceled',
  incomplete: 'incomplete',
  paused: 'past_due',
};

/** 'YYYY-MM-DD' for `ms` (UTC). */
export const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/** A real calendar date 'YYYY-MM-DD', or null. */
export function cleanDate(v) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** The day before the same date a year later: a license from 2026-11-01 ends 2027-10-31. */
export function yearEnd(startsOn) {
  const d = new Date(`${startsOn}T00:00:00Z`);
  const end = new Date(addMonths(d.getTime(), 12) - 86_400_000);
  return utcDate(end.getTime());
}

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, now?: () => number, log?: any }} deps
 */
export function createShowroomBilling({ db, now = Date.now, log = console }) {
  /** (tenantId, { invoiceRef, at }) => void: credits.mjs grants a month's credits. */
  const monthPaidHooks = [];
  /** (tenantId) => void: services.tenants.refresh, so status follows every change. */
  let onChange = () => {};

  const licenseWire = (r) =>
    r && {
      id: r.id,
      amountCents: r.amount_cents,
      currency: r.currency,
      startsOn: r.starts_on,
      endsOn: r.ends_on,
      paidHow: r.paid_how,
      note: r.note,
      recordedBy: r.created_by_email || null,
      createdAt: r.created_at,
      voidedAt: r.voided_at ?? null,
    };

  const subRow = (tenantId) => db.prepare('SELECT * FROM tenant_subscriptions WHERE tenant_id = ?').get(tenantId) ?? null;
  const subByRef = (ref) => (ref ? (db.prepare('SELECT * FROM tenant_subscriptions WHERE subscription_ref = ?').get(ref) ?? null) : null);

  const svc = {
    GRACE_MS,

    /** Registers `fn(tenantId)`, called after anything that can change a tenant's standing. */
    onChange(fn) {
      if (typeof fn === 'function') onChange = fn;
    },

    /** Registers `fn(tenantId, { invoiceRef, at })`, called once per paid month (credits.mjs). */
    onMonthPaid(fn) {
      if (typeof fn === 'function') monthPaidHooks.push(fn);
    },

    // ── licenses ──────────────────────────────────────────────────────────
    licenses(tenantId) {
      return db.prepare('SELECT * FROM tenant_licenses WHERE tenant_id = ? ORDER BY starts_on DESC, created_at DESC').all(tenantId).map(licenseWire);
    },

    /** The license in force today (not voided), or null. */
    currentLicense(tenantId, at = now()) {
      const d = utcDate(at);
      return licenseWire(
        db.prepare('SELECT * FROM tenant_licenses WHERE tenant_id = ? AND voided_at IS NULL AND starts_on <= ? AND ends_on >= ? ORDER BY ends_on DESC LIMIT 1').get(tenantId, d, d),
      );
    },

    /**
     * Records a license an admin sold. `amountCents` defaults to the list price, `endsOn` to a
     * year after `startsOn` (the day before). Returns the license.
     */
    recordLicense(tenantId, { amountCents, currency = CURRENCY, startsOn, endsOn, paidHow, note = '' }, { by = null } = {}) {
      const errors = [];
      const amount = amountCents === undefined || amountCents === null ? SHOWROOM_LICENSE.priceCents : amountCents;
      if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) errors.push({ field: 'amountCents', message: 'The amount is a whole number of cents.' });
      const cur = String(currency || '').toLowerCase();
      if (!/^[a-z]{3}$/.test(cur)) errors.push({ field: 'currency', message: 'Currency is a 3-letter code like cad.' });
      const start = cleanDate(startsOn ?? utcDate(now()));
      if (!start) errors.push({ field: 'startsOn', message: 'The start date looks like 2026-11-01.' });
      const end = endsOn === undefined || endsOn === null || endsOn === '' ? (start ? yearEnd(start) : null) : cleanDate(endsOn);
      if (!end) errors.push({ field: 'endsOn', message: 'The end date looks like 2027-10-31.' });
      else if (start && end < start) errors.push({ field: 'endsOn', message: 'The license ends before it starts.' });
      if (!PAID_HOW.includes(paidHow)) errors.push({ field: 'paidHow', message: `How it was paid: ${PAID_HOW.join(', ')}.` });
      if (typeof note !== 'string' || note.length > 500) errors.push({ field: 'note', message: 'Keep the note to 500 characters.' });
      if (errors.length) throw new HttpError(400, errors[0].message, { errors });
      const id = `lic_${crypto.randomBytes(9).toString('base64url')}`;
      const email = by ? (db.prepare('SELECT email FROM users WHERE id = ?').get(by)?.email ?? '') : '';
      db.prepare(
        `INSERT INTO tenant_licenses (id, tenant_id, amount_cents, currency, starts_on, ends_on, paid_how, note, created_by, created_by_email, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, tenantId, amount, cur, start, end, paidHow, note.trim(), by, email, now());
      if (amount > 0 && paidHow !== 'comp') {
        db.prepare("INSERT OR IGNORE INTO tenant_payments (id, tenant_id, kind, amount_cents, currency, provider, ref, period_end, created_at) VALUES (?, ?, 'license', ?, ?, ?, ?, NULL, ?)").run(
          `pay_${crypto.randomBytes(9).toString('base64url')}`,
          tenantId,
          amount,
          cur,
          paidHow,
          id,
          now(),
        );
      }
      onChange(tenantId);
      return licenseWire(db.prepare('SELECT * FROM tenant_licenses WHERE id = ?').get(id));
    },

    /** Voids a license recorded by mistake (the row stays, marked). */
    voidLicense(tenantId, licenseId, { by = null } = {}) {
      const r = db.prepare('UPDATE tenant_licenses SET voided_at = ?, voided_by = ? WHERE id = ? AND tenant_id = ? AND voided_at IS NULL').run(now(), by, licenseId, tenantId);
      if (!r.changes) throw new HttpError(404, 'There is no such license on this showroom.');
      db.prepare("DELETE FROM tenant_payments WHERE ref = ? AND kind = 'license'").run(licenseId);
      onChange(tenantId);
      return licenseWire(db.prepare('SELECT * FROM tenant_licenses WHERE id = ?').get(licenseId));
    },

    // ── the monthly plan ──────────────────────────────────────────────────
    subRow,
    subByRef,

    /** True when the monthly plan counts as paid now (active, or within grace). */
    monthlyPaid(tenantId, at = now()) {
      const r = subRow(tenantId);
      if (!r) return false;
      if (r.provider === 'comp') return r.status === 'active';
      if (r.status === 'active') return !r.current_period_end || at < r.current_period_end + GRACE_MS;
      if (r.status === 'past_due') return !!r.grace_until && at < r.grace_until;
      return false;
    },

    /** `{ licenseCurrent, monthlyPaid }`: what services.tenants computes live / lapsed from. */
    standing(tenantId) {
      return { licenseCurrent: !!svc.currentLicense(tenantId), monthlyPaid: svc.monthlyPaid(tenantId) };
    },

    /** The monthly plan as the workspace and the admin show it, or null. */
    monthlyWire(tenantId) {
      const r = subRow(tenantId);
      if (!r) return null;
      return {
        provider: r.provider,
        status: r.status,
        paid: svc.monthlyPaid(tenantId),
        amountCents: r.amount_cents,
        currency: r.currency,
        periodEnd: r.current_period_end ?? null,
        graceUntil: r.grace_until ?? null,
        cancelAtPeriodEnd: !!r.cancel_at_period_end,
        hasPaymentMethod: !!r.customer_ref,
        note: r.note,
        updatedAt: r.updated_at,
      };
    },

    /** Receipts: monthly payments and recorded licenses, newest first. */
    payments(tenantId) {
      return db
        .prepare('SELECT * FROM tenant_payments WHERE tenant_id = ? ORDER BY created_at DESC, id LIMIT 200')
        .all(tenantId)
        .map((r) => ({ id: r.id, kind: r.kind, amountCents: r.amount_cents, currency: r.currency, provider: r.provider, periodEnd: r.period_end ?? null, createdAt: r.created_at }));
    },

    /** Sets (or makes) the tenant's one subscription row from `f`. */
    upsert(tenantId, f) {
      const t = now();
      const r = subRow(tenantId);
      if (r) {
        db.prepare(
          `UPDATE tenant_subscriptions SET provider = ?, status = ?, customer_ref = COALESCE(?, customer_ref), subscription_ref = COALESCE(?, subscription_ref),
                  current_period_end = ?, grace_until = ?, cancel_at_period_end = ?, amount_cents = ?, currency = ?, note = COALESCE(?, note),
                  canceled_at = CASE WHEN ? = 'canceled' THEN COALESCE(canceled_at, ?) ELSE NULL END, updated_at = ?
            WHERE tenant_id = ?`,
        ).run(
          f.provider ?? r.provider,
          f.status ?? r.status,
          f.customerRef ?? null,
          f.subscriptionRef ?? null,
          f.periodEnd !== undefined ? f.periodEnd : r.current_period_end,
          f.graceUntil !== undefined ? f.graceUntil : r.grace_until,
          f.cancelAtPeriodEnd !== undefined ? (f.cancelAtPeriodEnd ? 1 : 0) : r.cancel_at_period_end,
          Number.isInteger(f.amountCents) ? f.amountCents : r.amount_cents,
          f.currency ?? r.currency,
          typeof f.note === 'string' ? f.note.slice(0, 500) : null,
          f.status ?? r.status,
          t,
          t,
          tenantId,
        );
      } else {
        db.prepare(
          `INSERT INTO tenant_subscriptions (tenant_id, provider, status, customer_ref, subscription_ref, current_period_end, grace_until, cancel_at_period_end, amount_cents, currency, note, canceled_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          tenantId,
          f.provider,
          f.status,
          f.customerRef ?? null,
          f.subscriptionRef ?? null,
          f.periodEnd ?? null,
          f.graceUntil ?? null,
          f.cancelAtPeriodEnd ? 1 : 0,
          Number.isInteger(f.amountCents) ? f.amountCents : SHOWROOM_MONTHLY.priceCents,
          f.currency ?? CURRENCY,
          typeof f.note === 'string' ? f.note.slice(0, 500) : '',
          f.status === 'canceled' ? t : null,
          t,
          t,
        );
      }
      onChange(tenantId);
      return subRow(tenantId);
    },

    /**
     * A complimentary monthly plan (on) or the end of one (off). Refused over a paid Stripe plan
     * that is still running: cancel that first.
     */
    setComplimentary(tenantId, on, { note = '' } = {}) {
      const r = subRow(tenantId);
      if (on) {
        if (r && r.provider === 'stripe' && r.status !== 'canceled') throw new HttpError(409, 'This showroom pays for its monthly plan by card. Cancel that first.', { code: 'paid_subscription' });
        return svc.upsert(tenantId, { provider: 'comp', status: 'active', periodEnd: null, graceUntil: null, cancelAtPeriodEnd: false, amountCents: 0, note: note || 'Complimentary' });
      }
      if (!r || r.provider !== 'comp') throw new HttpError(409, 'This showroom has no complimentary monthly plan.', { code: 'not_complimentary' });
      return svc.upsert(tenantId, { status: 'canceled', note });
    },

    // ── checkouts ─────────────────────────────────────────────────────────
    checkout(ref) {
      return ref ? (db.prepare('SELECT * FROM tenant_checkouts WHERE ref = ?').get(ref) ?? null) : null;
    },

    newCheckout(tenantId, { provider, by = null }) {
      const ref = `tc_${crypto.randomBytes(16).toString('base64url')}`;
      db.prepare("INSERT INTO tenant_checkouts (ref, tenant_id, provider, status, amount_cents, currency, created_by, created_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)").run(
        ref,
        tenantId,
        provider,
        SHOWROOM_MONTHLY.priceCents,
        CURRENCY,
        by,
        now(),
      );
      return svc.checkout(ref);
    },

    checkoutWire(c) {
      return c && { ref: c.ref, tenantId: c.tenant_id, provider: c.provider, url: c.url || null, status: c.status, amountCents: c.amount_cents, currency: c.currency, createdAt: c.created_at, completedAt: c.completed_at ?? null };
    },

    checkouts(tenantId) {
      return db.prepare('SELECT * FROM tenant_checkouts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20').all(tenantId).map(svc.checkoutWire);
    },

    /**
     * A checkout paid: the monthly plan is on. From Stripe's checkout.session.completed (with its
     * refs) or the demo page. Idempotent: a completed checkout is left alone.
     */
    fulfilCheckout(ref, { customerRef = null, subscriptionRef = null, periodEnd = null, providerRef = null } = {}) {
      const c = svc.checkout(ref);
      if (!c || c.status === 'completed') return c;
      const t = now();
      db.prepare("UPDATE tenant_checkouts SET status = 'completed', completed_at = ?, provider_ref = COALESCE(?, provider_ref) WHERE ref = ?").run(t, providerRef, ref);
      const demo = c.provider === 'demo';
      svc.upsert(c.tenant_id, {
        provider: c.provider,
        status: 'active',
        customerRef,
        subscriptionRef: demo ? `demo_${ref}` : subscriptionRef,
        periodEnd: periodEnd ?? (demo ? addMonths(t, 1) : null),
        graceUntil: null,
        cancelAtPeriodEnd: false,
        amountCents: c.amount_cents,
        currency: c.currency,
      });
      // Demo: the first month is "paid" now (Stripe's first invoice.paid does this for real).
      if (demo) svc.monthPaid(c.tenant_id, { invoiceRef: `demo-${ref}`, amountCents: c.amount_cents, currency: c.currency, provider: 'demo', periodEnd: addMonths(t, 1) });
      return svc.checkout(ref);
    },

    endCheckout(ref, status) {
      db.prepare("UPDATE tenant_checkouts SET status = ? WHERE ref = ? AND status = 'pending'").run(status, ref);
    },

    /**
     * One paid month: a receipt and the month's credits, once per `invoiceRef` (Stripe resends,
     * and the demo renewals call this too). Returns false when that invoice was already counted.
     */
    monthPaid(tenantId, { invoiceRef, amountCents, currency = CURRENCY, provider = 'stripe', periodEnd = null }) {
      const res = db
        .prepare("INSERT OR IGNORE INTO tenant_payments (id, tenant_id, kind, amount_cents, currency, provider, ref, period_end, created_at) VALUES (?, ?, 'monthly', ?, ?, ?, ?, ?, ?)")
        .run(`pay_${crypto.randomBytes(9).toString('base64url')}`, tenantId, amountCents, currency, provider, invoiceRef, periodEnd, now());
      if (!res.changes) return false;
      for (const fn of monthPaidHooks) fn(tenantId, { invoiceRef, at: now() });
      return true;
    },

    // ── Stripe events ─────────────────────────────────────────────────────
    /** The tenant a Stripe object is about: its metadata, or the subscription we know. */
    tenantOfStripe(obj) {
      const meta = obj?.metadata?.tenant_id;
      if (typeof meta === 'string' && db.prepare('SELECT 1 FROM tenants WHERE id = ?').get(meta)) return meta;
      return subByRef(idOf(obj?.subscription) ?? (String(obj?.object) === 'subscription' ? idOf(obj) : null))?.tenant_id ?? null;
    },

    /** checkout.session.* for a showroom's monthly plan (metadata.kind 'showroom_monthly'). */
    onCheckoutEvent(event) {
      const s = event.data?.object ?? {};
      if (!String(event.type).startsWith('checkout.session.')) return;
      const ref = s.metadata?.checkout_ref ?? s.client_reference_id;
      const c = svc.checkout(ref);
      if (!c) return;
      if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
        if (s.payment_status !== 'paid' && s.status !== 'complete') return;
        svc.fulfilCheckout(c.ref, {
          customerRef: idOf(s.customer),
          subscriptionRef: idOf(s.subscription),
          periodEnd: s.subscription && typeof s.subscription === 'object' ? periodEndOf(s.subscription) : null,
          providerRef: s.id ?? null,
        });
      } else if (event.type === 'checkout.session.expired') svc.endCheckout(c.ref, 'expired');
    },

    /** customer.subscription.* for a showroom's plan (by metadata or by the ref we stored). */
    applyStripeSubscription(sub) {
      const ref = idOf(sub);
      if (!ref) return false;
      const known = subByRef(ref);
      const tenantId = known?.tenant_id ?? (sub.metadata?.kind === 'showroom_monthly' ? svc.tenantOfStripe(sub) : null);
      if (!tenantId) return false;
      const current = subRow(tenantId);
      // A late event about an old subscription must not overwrite the one in use (or a comp plan).
      if (current && current.subscription_ref && current.subscription_ref !== ref && current.status === 'active') {
        log.warn?.(`showroom billing: ignoring ${sub.status} for ${ref}; tenant ${tenantId} is on ${current.subscription_ref}`);
        return false;
      }
      const status = STRIPE_STATUS[sub.status] ?? 'incomplete';
      const price = sub.items?.data?.[0]?.price ?? null;
      svc.upsert(tenantId, {
        provider: 'stripe',
        status,
        customerRef: idOf(sub.customer),
        subscriptionRef: ref,
        periodEnd: periodEndOf(sub) ?? current?.current_period_end ?? null,
        graceUntil: status === 'past_due' ? (current?.grace_until ?? now() + GRACE_MS) : null,
        cancelAtPeriodEnd: !!sub.cancel_at_period_end,
        amountCents: Number.isInteger(price?.unit_amount) ? price.unit_amount : undefined,
        currency: typeof price?.currency === 'string' ? price.currency : undefined,
      });
      return true;
    },

    /** invoice.paid: paid up again, a receipt, and the month's credits (once per invoice). */
    invoicePaid(inv) {
      const r = subByRef(invoiceSubscriptionId(inv));
      if (!r) return false;
      const end = invoicePeriodEnd(inv);
      db.prepare(
        "UPDATE tenant_subscriptions SET status = 'active', grace_until = NULL, canceled_at = NULL, current_period_end = MAX(COALESCE(current_period_end, 0), ?), updated_at = ? WHERE tenant_id = ?",
      ).run(end ?? 0, now(), r.tenant_id);
      if (Number(inv.amount_paid) > 0) svc.monthPaid(r.tenant_id, { invoiceRef: idOf(inv), amountCents: inv.amount_paid, currency: inv.currency || r.currency, provider: 'stripe', periodEnd: end });
      onChange(r.tenant_id);
      return true;
    },

    /** invoice.payment_failed: past due, with GRACE_DAYS from the first failure. */
    invoiceFailed(inv) {
      const r = subByRef(invoiceSubscriptionId(inv));
      if (!r) return false;
      svc.markPastDue(r.tenant_id);
      return true;
    },

    markPastDue(tenantId) {
      const t = now();
      db.prepare("UPDATE tenant_subscriptions SET status = 'past_due', grace_until = COALESCE(grace_until, ?), updated_at = ? WHERE tenant_id = ?").run(t + GRACE_MS, t, tenantId);
      onChange(tenantId);
    },

    /** Demo only: what Stripe's renewals would do. */
    demoEvent(tenantId, event) {
      const r = subRow(tenantId);
      if (!r || r.provider !== 'demo') throw new HttpError(409, 'Send a demo checkout link and complete it first.');
      const t = now();
      switch (event) {
        case 'renewal': {
          const end = addMonths(Math.max(r.current_period_end ?? t, t), 1);
          db.prepare("UPDATE tenant_subscriptions SET status = 'active', grace_until = NULL, current_period_end = ?, updated_at = ? WHERE tenant_id = ?").run(end, t, tenantId);
          svc.monthPaid(tenantId, { invoiceRef: `demo-renewal-${tenantId}-${t}`, amountCents: r.amount_cents, currency: r.currency, provider: 'demo', periodEnd: end });
          break;
        }
        case 'renewal_failed':
          svc.markPastDue(tenantId);
          break;
        case 'grace_end':
          if (r.status !== 'past_due') throw new HttpError(409, 'The monthly plan isn’t past due.');
          db.prepare('UPDATE tenant_subscriptions SET grace_until = ?, updated_at = ? WHERE tenant_id = ?').run(t, t, tenantId);
          break;
        case 'cancel':
          db.prepare("UPDATE tenant_subscriptions SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE tenant_id = ?").run(t, t, tenantId);
          break;
        default:
          throw new HttpError(400, 'Choose renewal, renewal_failed, grace_end or cancel.');
      }
      onChange(tenantId);
      return svc.monthlyWire(tenantId);
    },
  };
  return svc;
}
