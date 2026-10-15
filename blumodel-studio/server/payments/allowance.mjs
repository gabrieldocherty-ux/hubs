// The Contractor plan's custom-model allowance (docs/PLANS_AND_CONTRACTORS.md §8): INCLUDED_MODELS
// custom 3D models a month, made by the BluModel studio.
//
// Rules (all enforced on the server; the request form only explains them):
// - The period is the subscription's current billing period; a plan without one (a complimentary
//   plan) uses the calendar month, UTC.
// - A model counts when its request is submitted (one model per product), and goes back to the
//   allowance if the studio cancels the request before work starts (a cancelled request doesn't
//   count). Unused models don't roll over.
// - An admin can grant extra models for the current period (model_grants, audit-logged by the
//   route).
// - Only an account on the Contractor plan (active, or in its renewal grace) can submit. If the
//   plan lapses, requests already submitted are still made and delivered.

import { addMonths } from '../billing/service.mjs';
import { INCLUDED_MODELS } from '../lib/plans.mjs';
import { randomId } from '../lib/ids.mjs';

/** The most models one grant may add. */
export const MAX_GRANT = 50;
export const MAX_GRANT_NOTE = 500;

/**
 * The allowance period around `t`: `{ start, end }` (ms, end exclusive). The subscription's current
 * billing period when it has one (`plan.periodEnd`), rolled forward if that end has passed (a
 * renewal still being retried); otherwise the calendar month, UTC.
 */
export function periodOf(plan, t) {
  if (plan && Number.isFinite(plan.periodEnd) && plan.periodEnd > 0) {
    let end = plan.periodEnd;
    for (let i = 0; i < 1200 && end <= t; i++) end = addMonths(end, 1);
    let start = addMonths(end, -1);
    for (let i = 0; i < 1200 && start > t; i++) {
      end = start;
      start = addMonths(end, -1);
    }
    if (start <= t && t < end) return { start, end };
  }
  const d = new Date(t);
  return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), end: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) };
}

/** @param {{ db: any, now: () => number, billing: { planOf: (id: string) => any }, config: any }} deps */
export function createAllowance({ db, now, billing, config }) {
  /** Models submitted by `userId` in [start, end), not counting requests the studio cancelled. */
  const usedIn = (userId, start, end) =>
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE o.user_id = ? AND o.tier = 'plan' AND o.status <> 'cancelled' AND o.created_at >= ? AND o.created_at < ?`,
      )
      .get(userId, start, end).n;

  /** Extra models granted for a period that includes `t`. */
  const grantedAt = (userId, t) => db.prepare('SELECT COALESCE(SUM(models), 0) AS n FROM model_grants WHERE user_id = ? AND period_start <= ? AND period_end > ?').get(userId, t, t).n;

  const svc = {
    INCLUDED_MODELS,

    /**
     * `{ active, plan, included, granted, used, total, left, periodStart, periodEnd, resetsAt,
     *    supportEmail }` for `userId` right now. `active` is false unless they are on the
     * Contractor plan; then `total` and `left` are 0 (nothing new can be submitted).
     */
    of(userId) {
      const t = now();
      const plan = billing.planOf(userId);
      const active = plan.id === 'contractor';
      const { start, end } = periodOf(plan, t);
      const included = active ? INCLUDED_MODELS : 0;
      const granted = active ? grantedAt(userId, t) : 0;
      const used = usedIn(userId, start, end);
      const total = included + granted;
      return {
        active,
        plan: plan.id,
        included,
        granted,
        used,
        total,
        left: Math.max(0, total - used),
        periodStart: start,
        periodEnd: end,
        resetsAt: end,
        supportEmail: config.SUPPORT_EMAIL || null,
      };
    },

    /** Gives `userId` `models` extra models for their current period. Returns the grant row. */
    grant(userId, { models, note = '', adminId }) {
      const t = now();
      const { start, end } = periodOf(billing.planOf(userId), t);
      const id = randomId('mg_');
      db.prepare('INSERT INTO model_grants (id, user_id, models, period_start, period_end, note, granted_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, userId, models, start, end, note, adminId, t);
      return svc.grantWire(db.prepare('SELECT * FROM model_grants WHERE id = ?').get(id));
    },

    /** The grants that apply now, newest first. */
    currentGrants(userId) {
      const t = now();
      return db
        .prepare('SELECT * FROM model_grants WHERE user_id = ? AND period_start <= ? AND period_end > ? ORDER BY created_at DESC')
        .all(userId, t, t)
        .map((r) => svc.grantWire(r));
    },

    grantWire(r) {
      return { id: r.id, userId: r.user_id, models: r.models, periodStart: r.period_start, periodEnd: r.period_end, note: r.note, grantedBy: r.granted_by ?? null, createdAt: r.created_at };
    },
  };
  return svc;
}
