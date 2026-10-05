// Plans, unlocks and entitlements (PLANS_AND_CONTRACTORS §1–§2, §5). Everything here is
// synchronous SQLite, so callers can run it inside one ctx.tx (the webhook route does).
//
// Rules:
// - A $5 unlock belongs to one kitchen, forever. A duplicate is a new kitchen: not unlocked.
// - A plan covers every kitchen its subscriber owns; never someone else's (share visitors).
// - Cancelling keeps the plan to the end of the paid period.
// - A failed renewal gives 7 days of grace, then the account is Free until it pays.
// - Demo subscriptions renew themselves at the end of each period (nothing to charge).

import { randomId } from '../lib/ids.mjs';
import { planById, SUBSCRIPTION_PLANS } from '../lib/plans.mjs';
import { idOf, invoicePeriodEnd, invoiceSubscriptionId, periodEndOf } from './stripe.mjs';

export const GRACE_MS = 7 * 24 * 3600 * 1000;

const FREE = Object.freeze({ id: 'free', status: 'none', periodEnd: null, cancelAtPeriodEnd: false, graceUntil: null, provider: null });

/** `ms` plus `n` calendar months (UTC), keeping the day where the month allows. */
export function addMonths(ms, n = 1) {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime();
}

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

export function createBillingService({ db, now, log = console }) {
  const priceOf = (plan) => planById(plan)?.priceCents ?? 0;
  const planFromAmount = (cents) => SUBSCRIPTION_PLANS.find((p) => priceOf(p) === cents) ?? null;

  const subRow = (userId) => db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(userId) ?? null;
  const subByRef = (ref) => (ref ? db.prepare('SELECT * FROM subscriptions WHERE subscription_ref = ?').get(ref) ?? null : null);
  const checkout = (ref) => (ref ? db.prepare('SELECT * FROM billing_checkouts WHERE ref = ?').get(ref) ?? null : null);

  const stateOf = (r) => ({
    id: r.plan,
    status: r.status,
    periodEnd: r.current_period_end ?? null,
    cancelAtPeriodEnd: !!r.cancel_at_period_end,
    graceUntil: r.grace_until ?? null,
    provider: r.provider,
  });

  function receipt({ userId, kind, plan = null, projectId = null, projectName = '', amountCents, provider, ref }) {
    db.prepare(
      `INSERT OR IGNORE INTO billing_payments (id, user_id, kind, plan, project_id, project_name, amount_cents, currency, provider, ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'usd', ?, ?, ?)`,
    ).run(randomId('pay_'), userId, kind, plan, projectId, projectName, amountCents, provider, ref, now());
  }

  /** A demo subscription renews itself at each period end (there is nothing to charge). */
  function rollDemo(r) {
    let end = r.current_period_end;
    const t = now();
    for (let i = 0; i < 24 && end <= t; i++) {
      receipt({ userId: r.user_id, kind: 'renewal', plan: r.plan, amountCents: priceOf(r.plan), provider: 'demo', ref: `demo-renewal-${r.id}-${end}` });
      end = addMonths(end, 1);
    }
    if (end <= t) end = addMonths(t, 1);
    db.prepare('UPDATE subscriptions SET current_period_end = ?, updated_at = ? WHERE id = ?').run(end, t, r.id);
    return { ...r, current_period_end: end };
  }

  const svc = {
    GRACE_MS,
    priceOf,
    subRow,
    checkout,

    /** The plan in force for a user now (see the rules at the top). May tidy the row as it reads it. */
    planOf(userId) {
      let r = subRow(userId);
      if (!r) return FREE;
      const t = now();
      if (r.provider === 'demo' && r.status === 'active' && !r.cancel_at_period_end && r.current_period_end && t >= r.current_period_end) r = rollDemo(r);
      if (r.status === 'active' && r.cancel_at_period_end && r.current_period_end && t >= r.current_period_end) {
        db.prepare("UPDATE subscriptions SET status = 'canceled', canceled_at = COALESCE(canceled_at, ?), updated_at = ? WHERE id = ?").run(r.current_period_end, t, r.id);
        return { ...FREE, status: 'canceled' };
      }
      if (r.status === 'active') return stateOf(r);
      if (r.status === 'past_due' && r.grace_until && t < r.grace_until) return stateOf(r);
      return { ...FREE, status: r.status };
    },

    /** True when `userId` owns `projectId` and it is unlocked or they have a plan. */
    canExport(userId, projectId) {
      if (!db.prepare('SELECT 1 FROM projects WHERE id = ? AND user_id = ?').get(projectId, userId)) return false;
      if (svc.planOf(userId).id !== 'free') return true;
      return !!db.prepare('SELECT 1 FROM kitchen_unlocks WHERE project_id = ? AND user_id = ?').get(projectId, userId);
    },

    /** `{ plan, unlockedProjectIds }` for the editor. */
    entitlements(userId) {
      const ids = db
        .prepare('SELECT u.project_id FROM kitchen_unlocks u JOIN projects p ON p.id = u.project_id WHERE u.user_id = ? AND p.user_id = ? ORDER BY u.created_at DESC')
        .all(userId, userId)
        .map((r) => r.project_id);
      return { plan: svc.planOf(userId).id, unlockedProjectIds: ids };
    },

    /** Sets (or creates) the user's one subscription row. */
    upsertSubscription(userId, f) {
      const t = now();
      const r = subRow(userId);
      if (r) {
        db.prepare(
          `UPDATE subscriptions SET plan = ?, status = ?, provider = ?, customer_ref = COALESCE(?, customer_ref), subscription_ref = COALESCE(?, subscription_ref),
                  current_period_end = ?, cancel_at_period_end = ?, grace_until = ?,
                  canceled_at = CASE WHEN ? = 'canceled' THEN COALESCE(canceled_at, ?) ELSE NULL END, updated_at = ?
            WHERE id = ?`,
        ).run(f.plan, f.status, f.provider, f.customerRef ?? null, f.subscriptionRef ?? null, f.periodEnd ?? null, f.cancelAtPeriodEnd ? 1 : 0, f.graceUntil ?? null, f.status, t, t, r.id);
      } else {
        db.prepare(
          `INSERT INTO subscriptions (id, user_id, plan, status, provider, customer_ref, subscription_ref, current_period_end, cancel_at_period_end, grace_until, canceled_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(randomId('sub_'), userId, f.plan, f.status, f.provider, f.customerRef ?? null, f.subscriptionRef ?? null, f.periodEnd ?? null, f.cancelAtPeriodEnd ? 1 : 0, f.graceUntil ?? null, f.status === 'canceled' ? t : null, t, t);
      }
      return subRow(userId);
    },

    /**
     * Completes a checkout exactly once (demo success, Stripe webhook or return sync). With
     * `amountCents`, a payment that doesn't match the server's price is logged and not fulfilled.
     */
    fulfil(ref, { providerRef = null, customerRef = null, subscriptionRef = null, periodEnd = null, amountCents, currency = 'usd' } = {}) {
      const c = checkout(ref);
      if (!c) return { ok: false, reason: 'unknown' };
      if (c.status === 'completed') return { ok: true, already: true, checkout: c };
      if (amountCents !== undefined && (amountCents !== c.amount_cents || String(currency).toLowerCase() !== c.currency)) {
        log.warn?.(`billing: checkout ${ref} paid ${amountCents} ${currency}, expected ${c.amount_cents} ${c.currency}; not fulfilled`);
        return { ok: false, reason: 'amount' };
      }
      const t = now();
      const res = db
        .prepare("UPDATE billing_checkouts SET status = 'completed', completed_at = ?, provider_ref = COALESCE(?, provider_ref) WHERE ref = ? AND status <> 'completed'")
        .run(t, providerRef, ref);
      if (!res.changes) return { ok: true, already: true, checkout: checkout(ref) };

      if (c.kind === 'kitchen_unlock') {
        const project = c.project_id ? db.prepare('SELECT id, name FROM projects WHERE id = ? AND user_id = ?').get(c.project_id, c.user_id) : null;
        if (project) {
          db.prepare('INSERT OR IGNORE INTO kitchen_unlocks (project_id, user_id, provider, payment_ref, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(project.id, c.user_id, c.provider, ref, c.amount_cents, t);
        } else log.warn?.(`billing: checkout ${ref} paid for a kitchen that no longer exists`);
        receipt({ userId: c.user_id, kind: 'kitchen_unlock', projectId: c.project_id, projectName: project?.name ?? c.project_name, amountCents: c.amount_cents, provider: c.provider, ref });
      } else {
        const existing = subRow(c.user_id);
        const keepEnd = existing && subscriptionRef && existing.subscription_ref === subscriptionRef ? existing.current_period_end : null;
        svc.upsertSubscription(c.user_id, {
          plan: c.plan,
          status: 'active',
          provider: c.provider,
          customerRef,
          subscriptionRef: subscriptionRef ?? (c.provider === 'demo' ? `demo_${ref}` : null),
          periodEnd: periodEnd ?? keepEnd ?? addMonths(t, 1),
          cancelAtPeriodEnd: false,
          graceUntil: null,
        });
        receipt({ userId: c.user_id, kind: 'subscription', plan: c.plan, amountCents: c.amount_cents, provider: c.provider, ref });
      }
      return { ok: true, checkout: checkout(ref) };
    },

    /** A checkout that won't complete: failed (declined), canceled or expired. */
    endCheckout(ref, status) {
      db.prepare("UPDATE billing_checkouts SET status = ? WHERE ref = ? AND status IN ('pending','failed')").run(status, ref);
    },

    /** Applies a Stripe subscription object (webhook or retrieve) to the local row. */
    applyStripeSubscription(sub) {
      const ref = idOf(sub);
      if (!ref) return;
      const byRef = subByRef(ref);
      const userId = byRef?.user_id ?? (typeof sub.metadata?.user_id === 'string' ? sub.metadata.user_id : null);
      if (!userId || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) return;
      const current = subRow(userId);
      // A late event about an old subscription must not overwrite the one in use now.
      if (current && current.subscription_ref && current.subscription_ref !== ref && current.status === 'active') {
        log.warn?.(`billing: ignoring ${sub.status} for ${ref}; user is on ${current.subscription_ref}`);
        return;
      }
      const metaPlan = SUBSCRIPTION_PLANS.includes(sub.metadata?.plan) ? sub.metadata.plan : null;
      const plan = metaPlan ?? planFromAmount(sub.items?.data?.[0]?.price?.unit_amount) ?? current?.plan;
      if (!plan) return;
      const status = STRIPE_STATUS[sub.status] ?? 'incomplete';
      svc.upsertSubscription(userId, {
        plan,
        status,
        provider: 'stripe',
        customerRef: idOf(sub.customer),
        subscriptionRef: ref,
        periodEnd: periodEndOf(sub) ?? current?.current_period_end ?? null,
        cancelAtPeriodEnd: !!sub.cancel_at_period_end,
        graceUntil: status === 'past_due' ? (current?.grace_until ?? now() + GRACE_MS) : null,
      });
    },

    /** `invoice.paid`: the plan is paid up again; renewals get a receipt. */
    invoicePaid(inv) {
      const r = subByRef(invoiceSubscriptionId(inv));
      if (!r) return;
      const end = invoicePeriodEnd(inv);
      db.prepare(
        "UPDATE subscriptions SET status = 'active', grace_until = NULL, canceled_at = NULL, current_period_end = MAX(COALESCE(current_period_end, 0), ?), updated_at = ? WHERE id = ?",
      ).run(end ?? 0, now(), r.id);
      if (inv.billing_reason === 'subscription_cycle' && inv.amount_paid > 0) {
        receipt({ userId: r.user_id, kind: 'renewal', plan: r.plan, amountCents: inv.amount_paid, provider: 'stripe', ref: idOf(inv) });
      }
    },

    /** `invoice.payment_failed`: past due, with 7 days' grace from the first failure. */
    invoiceFailed(inv) {
      const r = subByRef(invoiceSubscriptionId(inv));
      if (r) svc.markPastDue(r);
    },

    markPastDue(r) {
      const t = now();
      db.prepare("UPDATE subscriptions SET status = 'past_due', grace_until = COALESCE(grace_until, ?), updated_at = ? WHERE id = ?").run(t + GRACE_MS, t, r.id);
    },

    /** Demo only: the renewal Stripe would have charged, succeeding. */
    demoRenew(r) {
      const t = now();
      const end = addMonths(Math.max(r.current_period_end ?? t, t), 1);
      db.prepare("UPDATE subscriptions SET status = 'active', grace_until = NULL, current_period_end = ?, updated_at = ? WHERE id = ?").run(end, t, r.id);
      receipt({ userId: r.user_id, kind: 'renewal', plan: r.plan, amountCents: priceOf(r.plan), provider: 'demo', ref: `demo-renewal-${r.id}-${t}` });
    },

    unlocksOf(userId) {
      return db
        .prepare(
          `SELECT u.project_id AS projectId, p.name AS name, u.amount_cents AS amountCents, u.created_at AS createdAt
             FROM kitchen_unlocks u JOIN projects p ON p.id = u.project_id
            WHERE u.user_id = ? ORDER BY u.created_at DESC`,
        )
        .all(userId)
        .map((r) => ({ ...r }));
    },

    receiptsOf(userId, limit = 50) {
      return db
        .prepare(
          `SELECT id, kind, plan, project_id AS projectId, project_name AS projectName, amount_cents AS amountCents, currency, provider, created_at AS createdAt
             FROM billing_payments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(userId, limit)
        .map((r) => ({ ...r }));
    },

    subscriptionWire(userId) {
      const r = subRow(userId);
      if (!r) return null;
      return {
        plan: r.plan,
        status: r.status,
        provider: r.provider,
        currentPeriodEnd: r.current_period_end ?? null,
        cancelAtPeriodEnd: !!r.cancel_at_period_end,
        graceUntil: r.grace_until ?? null,
        createdAt: r.created_at,
      };
    },

    /** Admin → Billing: per provider, so demo numbers never mix with real money. */
    adminStats() {
      const t = now();
      const since = t - 30 * 24 * 3600 * 1000;
      const stats = (provider) => {
        const subs = db.prepare('SELECT * FROM subscriptions WHERE provider = ?').all(provider);
        const live = subs.filter((r) => (r.status === 'active' && !(r.cancel_at_period_end && r.current_period_end && t >= r.current_period_end)) || (r.status === 'past_due' && r.grace_until && t < r.grace_until));
        const byPlan = { unlimited: 0, contractor: 0 };
        for (const r of live) byPlan[r.plan] = (byPlan[r.plan] ?? 0) + 1;
        const churned = subs.filter((r) => r.canceled_at && r.canceled_at >= since).length;
        const unlocks = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents FROM kitchen_unlocks WHERE provider = ?').get(provider);
        const paid30 = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM billing_payments WHERE provider = ? AND created_at >= ?').get(provider, since);
        return {
          active: byPlan,
          mrrCents: live.reduce((s, r) => s + priceOf(r.plan), 0),
          pastDue: live.filter((r) => r.status === 'past_due').length,
          cancelling: live.filter((r) => r.cancel_at_period_end).length,
          unlocks: unlocks.n,
          unlockCents: unlocks.cents,
          collected30dCents: paid30.cents,
          churn30d: live.length + churned ? churned / (live.length + churned) : 0,
        };
      };
      return { demo: stats('demo'), stripe: stats('stripe') };
    },
  };
  return svc;
}
