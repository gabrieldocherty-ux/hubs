// A showroom's AI render credits (docs/SHOWROOM_PIVOT.md §2, §7; docs/handoff/tenancy.md "Credits").
// Exposed as ctx.services.credits. All amounts are cents of CAD; everything is synchronous SQLite,
// so a caller can run several steps in one ctx.tx.
//
//   lots      each paid month adds a lot of $25 (SHOWROOM_MONTHLY.creditCents), once per invoice,
//             that expires 3 months later (creditRolloverMonths); an admin can add a lot too
//   balance   what is left of the lots that haven't expired
//   spending  oldest expiry first. A render RESERVES its cost before calling the AI (reserve),
//             then is CHARGED when it worked (charge) or RELEASED when it failed (release); a
//             charged render can be REFUNDED (refund). An admin can remove credits (adjust < 0).
//   history   tenant_credit_entries: every change, signed, with the balance after it. Admin
//             changes are also audited (admin_audit) by the route.
//
// A lot that expires with something left gets an 'expire' entry for what was left. Expiry runs
// before every read and every spend, so nobody ever spends an expired credit.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { SHOWROOM_MONTHLY } from '../lib/plans.mjs';
import { addMonths } from './service.mjs';

const id = (p) => `${p}${crypto.randomBytes(9).toString('base64url')}`;

/**
 * @param {{ db: import('node:sqlite').DatabaseSync, now?: () => number }} deps
 */
export function createCredits({ db, now = Date.now }) {
  const balanceOf = (tenantId) => Number(db.prepare('SELECT COALESCE(SUM(remaining), 0) AS n FROM tenant_credit_lots WHERE tenant_id = ? AND expires_at > ?').get(tenantId, now()).n);

  const entry = (tenantId, { kind, cents, lotId = null, holdId = null, ref = null, note = '', by = null }) => {
    const email = by ? (db.prepare('SELECT email FROM users WHERE id = ?').get(by)?.email ?? '') : '';
    db.prepare(
      `INSERT INTO tenant_credit_entries (tenant_id, kind, cents, balance_after, lot_id, hold_id, ref, note, by_user_id, by_email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(tenantId, kind, cents, balanceOf(tenantId), lotId, holdId, ref, String(note ?? '').slice(0, 500), by, email, now());
  };

  /** Takes `cents` from the lots, oldest expiry first. Returns the allocations. The caller checked the balance. */
  const take = (tenantId, cents) => {
    const out = [];
    let left = cents;
    for (const lot of db.prepare('SELECT id, remaining FROM tenant_credit_lots WHERE tenant_id = ? AND remaining > 0 AND expires_at > ? ORDER BY expires_at, created_at, id').all(tenantId, now())) {
      if (left <= 0) break;
      const n = Math.min(left, lot.remaining);
      db.prepare('UPDATE tenant_credit_lots SET remaining = remaining - ? WHERE id = ?').run(n, lot.id);
      out.push({ lotId: lot.id, cents: n });
      left -= n;
    }
    if (left > 0) throw new Error('credits.take: the balance changed under a transaction');
    return out;
  };

  const holdWire = (h) =>
    h && { id: h.id, cents: h.cents, status: h.status, purpose: h.purpose, ref: h.ref ?? null, createdAt: h.created_at, settledAt: h.settled_at ?? null };
  const holdRow = (holdId) => (typeof holdId === 'string' ? (db.prepare('SELECT * FROM tenant_credit_holds WHERE id = ?').get(holdId) ?? null) : null);

  const insufficient = (tenantId, cents) =>
    new HttpError(402, 'There aren’t enough render credits left for that.', { code: 'insufficient_credits', balanceCents: balanceOf(tenantId), neededCents: cents });

  const checkCents = (cents) => {
    if (!Number.isInteger(cents) || cents <= 0 || cents > 10_000_000) throw new HttpError(400, 'An amount of credits is a whole number of cents above zero.', { field: 'cents' });
  };

  const svc = {
    /** Expires every lot past its date for `tenantId` (or every tenant), with an entry for what was left. */
    expire(tenantId) {
      const rows = tenantId
        ? db.prepare('SELECT * FROM tenant_credit_lots WHERE tenant_id = ? AND remaining > 0 AND expires_at <= ? ORDER BY expires_at, created_at').all(tenantId, now())
        : db.prepare('SELECT * FROM tenant_credit_lots WHERE remaining > 0 AND expires_at <= ? ORDER BY expires_at, created_at').all(now());
      for (const lot of rows) {
        db.prepare('UPDATE tenant_credit_lots SET remaining = 0 WHERE id = ?').run(lot.id);
        entry(lot.tenant_id, { kind: 'expire', cents: -lot.remaining, lotId: lot.id, note: `${lot.source === 'monthly' ? 'Monthly' : 'Added'} credits from ${new Date(lot.created_at).toISOString().slice(0, 10)} expired` });
      }
      return rows.length;
    },

    /** The balance now, in cents. */
    balance(tenantId) {
      svc.expire(tenantId);
      return balanceOf(tenantId);
    },

    /**
     * One paid month's credits, once per `invoiceRef` (Stripe resends; demo renewals call this too).
     * Returns the lot, or null when that invoice was already granted.
     */
    grantMonth(tenantId, invoiceRef, { at = now() } = {}) {
      const lotId = id('cl_');
      const cents = SHOWROOM_MONTHLY.creditCents;
      const res = db
        .prepare("INSERT OR IGNORE INTO tenant_credit_lots (id, tenant_id, source, cents, remaining, ref, expires_at, created_at) VALUES (?, ?, 'monthly', ?, ?, ?, ?, ?)")
        .run(lotId, tenantId, cents, cents, String(invoiceRef), addMonths(at, SHOWROOM_MONTHLY.creditRolloverMonths), at);
      if (!res.changes) return null;
      entry(tenantId, { kind: 'grant', cents, lotId, ref: String(invoiceRef), note: 'Monthly plan credits' });
      return svc.lot(lotId);
    },

    lot(lotId) {
      const r = db.prepare('SELECT * FROM tenant_credit_lots WHERE id = ?').get(lotId);
      return r ? { id: r.id, source: r.source, cents: r.cents, remaining: r.remaining, expiresAt: r.expires_at, createdAt: r.created_at } : null;
    },

    /**
     * Reserves `cents` for a render before the AI is called. Throws 402 insufficient_credits when
     * the balance is short. Returns the hold ({ id, cents, status: 'held', ... }); pass its id to
     * charge() when the render worked, release() when it didn't.
     */
    reserve(tenantId, cents, { purpose = 'render', ref = null, by = null } = {}) {
      checkCents(cents);
      svc.expire(tenantId);
      if (balanceOf(tenantId) < cents) throw insufficient(tenantId, cents);
      const allocations = take(tenantId, cents);
      const holdId = id('ch_');
      db.prepare("INSERT INTO tenant_credit_holds (id, tenant_id, cents, status, allocations, purpose, ref, by_user_id, created_at) VALUES (?, ?, ?, 'held', ?, ?, ?, ?, ?)").run(
        holdId,
        tenantId,
        cents,
        JSON.stringify(allocations),
        String(purpose).slice(0, 40),
        ref,
        by,
        now(),
      );
      entry(tenantId, { kind: 'reserve', cents: -cents, holdId, ref, note: `Reserved for a ${purpose}`, by });
      return holdWire(holdRow(holdId));
    },

    /** The render worked: the reservation is spent. Idempotent for a charged hold. */
    charge(holdId) {
      const h = holdRow(holdId);
      if (!h) throw new HttpError(404, 'There is no such reservation.');
      if (h.status === 'charged') return holdWire(h);
      if (h.status !== 'held') throw new HttpError(409, `That reservation was already ${h.status}.`, { code: 'hold_settled' });
      db.prepare("UPDATE tenant_credit_holds SET status = 'charged', settled_at = ? WHERE id = ?").run(now(), h.id);
      entry(h.tenant_id, { kind: 'charge', cents: 0, holdId: h.id, ref: h.ref, note: `${h.purpose} charged`, by: h.by_user_id });
      return holdWire(holdRow(h.id));
    },

    /** Puts a hold's credits back into the lots they came from (an expired lot then expires them). */
    _restore(h, kind, { note, by = null }) {
      for (const a of JSON.parse(h.allocations || '[]')) db.prepare('UPDATE tenant_credit_lots SET remaining = remaining + ? WHERE id = ?').run(a.cents, a.lotId);
      db.prepare('UPDATE tenant_credit_holds SET status = ?, settled_at = ? WHERE id = ?').run(kind === 'release' ? 'released' : 'refunded', now(), h.id);
      entry(h.tenant_id, { kind, cents: h.cents, holdId: h.id, ref: h.ref, note, by });
      svc.expire(h.tenant_id);
    },

    /** The render failed: the reservation goes back. Idempotent for a released hold. */
    release(holdId) {
      const h = holdRow(holdId);
      if (!h) throw new HttpError(404, 'There is no such reservation.');
      if (h.status === 'released') return holdWire(h);
      if (h.status !== 'held') throw new HttpError(409, `That reservation was already ${h.status}.`, { code: 'hold_settled' });
      svc._restore(h, 'release', { note: `${h.purpose} failed: credits returned` });
      return holdWire(holdRow(h.id));
    },

    /** A charged render given back (an admin, or a render the company rejected). */
    refund(holdId, { note = '', by = null } = {}) {
      const h = holdRow(holdId);
      if (!h) throw new HttpError(404, 'There is no such reservation.');
      if (h.status === 'refunded') return holdWire(h);
      if (h.status !== 'charged') throw new HttpError(409, 'Only a charged render can be refunded.', { code: 'hold_not_charged' });
      svc._restore(h, 'refund', { note: note || `${h.purpose} refunded`, by });
      return holdWire(holdRow(h.id));
    },

    hold(holdId) {
      return holdWire(holdRow(holdId));
    },

    /**
     * An admin's change: +cents adds a lot that expires in creditRolloverMonths; -cents takes from
     * the lots, oldest first (never below zero: 409). `note` says why and is required.
     */
    adjust(tenantId, cents, { note, by = null } = {}) {
      if (!Number.isInteger(cents) || cents === 0 || Math.abs(cents) > 10_000_000) throw new HttpError(400, 'Add or remove a whole number of cents (not zero).', { field: 'cents' });
      const why = typeof note === 'string' ? note.trim() : '';
      if (!why || why.length > 500) throw new HttpError(400, 'Say why (500 characters or fewer).', { field: 'note' });
      svc.expire(tenantId);
      if (cents > 0) {
        const lotId = id('cl_');
        const t = now();
        db.prepare("INSERT INTO tenant_credit_lots (id, tenant_id, source, cents, remaining, ref, expires_at, created_at) VALUES (?, ?, 'adjust', ?, ?, NULL, ?, ?)").run(
          lotId,
          tenantId,
          cents,
          cents,
          addMonths(t, SHOWROOM_MONTHLY.creditRolloverMonths),
          t,
        );
        entry(tenantId, { kind: 'adjust', cents, lotId, note: why, by });
      } else {
        if (balanceOf(tenantId) < -cents) throw new HttpError(409, 'That is more than the balance.', { code: 'insufficient_credits', balanceCents: balanceOf(tenantId) });
        take(tenantId, -cents);
        entry(tenantId, { kind: 'adjust', cents, note: why, by });
      }
      return svc.summary(tenantId);
    },

    /**
     * `{ balanceCents, lots: [{ id, source, cents, remaining, expiresAt, createdAt }], nextExpiry:
     * { at, cents } | null, held: cents reserved by renders in progress }` (lots with credits left).
     */
    summary(tenantId) {
      svc.expire(tenantId);
      const lots = db
        .prepare('SELECT * FROM tenant_credit_lots WHERE tenant_id = ? AND remaining > 0 AND expires_at > ? ORDER BY expires_at, created_at')
        .all(tenantId, now())
        .map((r) => ({ id: r.id, source: r.source, cents: r.cents, remaining: r.remaining, expiresAt: r.expires_at, createdAt: r.created_at }));
      const held = Number(db.prepare("SELECT COALESCE(SUM(cents), 0) AS n FROM tenant_credit_holds WHERE tenant_id = ? AND status = 'held'").get(tenantId).n);
      return { balanceCents: balanceOf(tenantId), lots, nextExpiry: lots.length ? { at: lots[0].expiresAt, cents: lots[0].remaining } : null, heldCents: held };
    },

    /** The ledger, newest first: [{ id, kind, cents, balanceAfter, ref, note, by, at }]. `before` pages by id. */
    history(tenantId, { limit = 50, before } = {}) {
      const n = Math.max(1, Math.min(200, Number(limit) || 50));
      const rows = Number.isInteger(before)
        ? db.prepare('SELECT * FROM tenant_credit_entries WHERE tenant_id = ? AND id < ? ORDER BY id DESC LIMIT ?').all(tenantId, before, n)
        : db.prepare('SELECT * FROM tenant_credit_entries WHERE tenant_id = ? ORDER BY id DESC LIMIT ?').all(tenantId, n);
      return rows.map((r) => ({ id: r.id, kind: r.kind, cents: r.cents, balanceAfter: r.balance_after, holdId: r.hold_id ?? null, ref: r.ref ?? null, note: r.note, by: r.by_email || null, at: r.created_at }));
    },
  };
  return svc;
}
