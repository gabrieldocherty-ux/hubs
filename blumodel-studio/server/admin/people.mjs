// Admin > Users and Admin > Contractors: what the owner sees about one account, and the contractor
// list. Read-only; the actions are in server/routes/adminPanel.mjs. Never returns a password hash,
// a session token or hash, a reset token, a payment-provider reference or a file path.

import { auditLog } from '../lib/audit.mjs';
import { disabledInfo } from './status.mjs';

const like = (q) => `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;

/** A contractor brand page's state in a word: none | draft | in_review | live | hidden | rejected | suspended. */
export function brandPageState(b) {
  if (!b) return 'none';
  if (b.status === 'suspended') return 'suspended';
  if (b.status === 'rejected') return 'rejected';
  if (b.status === 'pending') return b.submitted_at ? 'in_review' : 'draft';
  if (b.status === 'active') return b.hidden_reason ? 'hidden' : 'live';
  return String(b.status);
}

const brandWire = (b) =>
  b ? { id: b.id, slug: b.slug, name: b.name, state: brandPageState(b), verified: !!b.verified_at, verifiedAt: b.verified_at ?? null, liveAt: b.live_at ?? null } : null;

/** @param {{ db: any, now: () => number, billing: any, allowance: any }} deps */
export function createPeople({ db, now, billing, allowance }) {
  const contractorBrand = (userId) =>
    db.prepare("SELECT * FROM brands WHERE kind = 'contractor' AND owner_user_id = ? ORDER BY created_at LIMIT 1").get(userId) ?? null;

  const lastSeen = (userId) => db.prepare('SELECT MAX(COALESCE(last_seen_at, created_at)) AS t FROM sessions WHERE user_id = ?').get(userId)?.t ?? null;

  return {
    contractorBrand,

    /** Everything Admin > Users shows for one account, or null. */
    detail(userId) {
      const u = db.prepare('SELECT id, email, name, role, phone, created_at FROM users WHERE id = ?').get(userId);
      if (!u) return null;
      const t = now();
      const plan = billing.planOf(u.id);
      const sub = billing.subscriptionWire(u.id);
      const subRow = db.prepare('SELECT id, provider, comp_note, current_period_end FROM subscriptions WHERE user_id = ?').get(u.id);
      const ent = billing.entitlements(u.id);
      const kitchens = db.prepare('SELECT id, name, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT 10').all(u.id);
      const profile = db.prepare('SELECT company, phone, email, website, service_area, created_at FROM contractor_profiles WHERE user_id = ?').get(u.id);
      const isContractor = !!profile || plan.id === 'contractor';
      return {
        user: {
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          phone: u.phone ?? '',
          createdAt: u.created_at,
          lastSeenAt: lastSeen(u.id),
          disabled: disabledInfo(db, u.id),
        },
        plan,
        subscription: sub
          ? {
              ...sub,
              id: subRow?.id ?? null,
              compNote: subRow?.provider === 'comp' ? (subRow.comp_note ?? '') : null,
              compEndsAt: subRow?.provider === 'comp' ? (subRow.current_period_end ?? null) : null,
            }
          : null,
        entitlements: {
          plan: ent.plan,
          adminBypass: !!ent.adminBypass,
          unlockedKitchens: db.prepare('SELECT COUNT(*) AS n FROM kitchen_unlocks WHERE user_id = ?').get(u.id).n,
        },
        kitchens: {
          count: db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').get(u.id).n,
          recent: kitchens.map((k) => ({ id: k.id, name: k.name, updatedAt: k.updated_at })),
        },
        orders: db
          .prepare('SELECT id, status, tier, amount_cents, currency, provider, created_at, paid_at FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
          .all(u.id)
          .map((o) => ({ id: o.id, status: o.status, tier: o.tier, amountCents: o.amount_cents, currency: String(o.currency).toLowerCase(), provider: o.provider, createdAt: o.created_at, paidAt: o.paid_at ?? null })),
        payments: db
          .prepare('SELECT kind, plan, amount_cents, currency, provider, created_at FROM billing_payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 20')
          .all(u.id)
          .map((p) => ({ kind: p.kind, plan: p.plan ?? null, amountCents: p.amount_cents, currency: String(p.currency).toLowerCase(), provider: p.provider, at: p.created_at })),
        contractor: isContractor
          ? {
              company: profile?.company ?? '',
              phone: profile?.phone ?? '',
              email: profile?.email ?? '',
              website: profile?.website ?? '',
              serviceArea: profile?.service_area ?? '',
              brandPage: brandWire(contractorBrand(u.id)),
              allowance: allowance.of(u.id),
            }
          : null,
        sessions: db
          .prepare('SELECT id, browser, os, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND expires_at >= ? ORDER BY COALESCE(last_seen_at, 0) DESC LIMIT 20')
          .all(u.id, t)
          .map((s) => ({ id: s.id ?? null, browser: s.browser || '', os: s.os || '', createdAt: s.created_at ?? null, lastSeenAt: s.last_seen_at ?? null, expiresAt: s.expires_at })),
        audit: auditLog(db, { limit: 30, targetUserId: u.id }),
      };
    },

    /** Contractors: accounts with a contractor profile or a Contractor subscription, newest first. */
    contractors(q = '') {
      const needle = q.trim().toLowerCase().slice(0, 100);
      const rows = db
        .prepare(
          `SELECT u.id, u.email, u.name, u.created_at, p.company, p.phone
             FROM users u LEFT JOIN contractor_profiles p ON p.user_id = u.id
            WHERE (p.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.plan = 'contractor'))
              AND (? = '' OR lower(u.email) LIKE ? ESCAPE '\\' OR lower(u.name) LIKE ? ESCAPE '\\' OR lower(COALESCE(p.company, '')) LIKE ? ESCAPE '\\')
            ORDER BY u.created_at DESC LIMIT 300`,
        )
        .all(needle, like(needle), like(needle), like(needle));
      return rows.map((r) => {
        const plan = billing.planOf(r.id);
        const a = allowance.of(r.id);
        return {
          userId: r.id,
          email: r.email,
          name: r.name,
          company: r.company ?? '',
          phone: r.phone ?? '',
          createdAt: r.created_at,
          plan: { id: plan.id, status: plan.status, provider: plan.provider ?? null, cancelAtPeriodEnd: !!plan.cancelAtPeriodEnd, graceUntil: plan.graceUntil ?? null },
          brandPage: brandWire(contractorBrand(r.id)),
          models: { active: a.active, used: a.used, total: a.total, left: a.left, granted: a.granted, resetsAt: a.resetsAt },
          disabled: !!disabledInfo(db, r.id),
        };
      });
    },
  };
}

/**
 * The audit log, filtered and paginated: `{ entries, page, pages, total, perPage, actions, actors }`.
 * `actor` matches the admin's email (substring, case-insensitive); `action` is exact; `from` / `to`
 * are ms bounds (to exclusive).
 */
export function auditPage(db, { actor = '', action = '', from = null, to = null, page = 1, perPage = 50 } = {}) {
  const where = [];
  const args = [];
  if (actor) {
    where.push("lower(admin_email) LIKE ? ESCAPE '\\'");
    args.push(like(actor.toLowerCase()));
  }
  if (action) {
    where.push('action = ?');
    args.push(action);
  }
  if (Number.isFinite(from)) {
    where.push('at >= ?');
    args.push(from);
  }
  if (Number.isFinite(to)) {
    where.push('at < ?');
    args.push(to);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM admin_audit ${clause}`).get(...args).n;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page), pages);
  const rows = db.prepare(`SELECT * FROM admin_audit ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, perPage, (p - 1) * perPage);
  return {
    entries: rows.map((r) => {
      let detail = {};
      try {
        detail = JSON.parse(r.detail);
      } catch {
        detail = {};
      }
      return { id: r.id, at: r.at, adminUserId: r.admin_user_id, adminEmail: r.admin_email, action: r.action, targetUserId: r.target_user_id, targetEmail: r.target_email, detail };
    }),
    page: p,
    pages,
    total,
    perPage,
    actions: db.prepare('SELECT DISTINCT action FROM admin_audit ORDER BY action').all().map((r) => r.action),
    actors: db.prepare("SELECT DISTINCT admin_email FROM admin_audit WHERE admin_email <> '' ORDER BY admin_email").all().map((r) => r.admin_email),
  };
}
