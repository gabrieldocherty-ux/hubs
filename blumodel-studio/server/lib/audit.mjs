// The admin audit log (ops-001 admin_audit): who did what to whom, when. Written for actions that
// change money or access (complimentary plans, exports an admin made without paying). Emails are
// copied in at the time, but when the account, lead or company they belong to is deleted, every
// email and phone of it in the log becomes a pseudonym ("deleted-<8 hex>", the same one each time
// for the same address, so entries about one person still read together); ids, actions and times
// stay (pseudonymiseAudit, audit 2026-10).

import crypto from 'node:crypto';

/** The stand-in for a deleted person's email or phone in the audit log. */
export const pseudonymOf = (value) => `deleted-${crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex').slice(0, 8)}`;

/**
 * Replaces every one of `emails` and `phones` in admin_audit (as admin or target email, and inside
 * detail) with its pseudonym. Returns how many rows changed.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ emails?: string[], phones?: string[] }} who
 */
export function pseudonymiseAudit(db, { emails = [], phones = [] } = {}) {
  let changed = 0;
  const values = [...new Set([...emails, ...phones].map((v) => String(v ?? '').trim()).filter((v) => v.length >= 5))];
  for (const v of values) {
    const p = pseudonymOf(v);
    const lower = v.toLowerCase();
    changed += Number(db.prepare('UPDATE admin_audit SET target_email = ? WHERE lower(target_email) = ?').run(p, lower).changes);
    changed += Number(db.prepare('UPDATE admin_audit SET admin_email = ? WHERE lower(admin_email) = ?').run(p, lower).changes);
    // In detail (JSON), in any letter case.
    const needle = JSON.stringify(v).slice(1, -1).toLowerCase();
    const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const upd = db.prepare('UPDATE admin_audit SET detail = ? WHERE id = ?');
    for (const r of db.prepare('SELECT id, detail FROM admin_audit WHERE instr(lower(detail), ?) > 0').all(needle)) {
      upd.run(String(r.detail).replace(re, p), r.id);
      changed++;
    }
  }
  return changed;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ admin: { id: string, email?: string } | null, action: string, targetUserId?: string | null,
 *   targetEmail?: string, detail?: Record<string, unknown>, at: number }} entry
 */
export function audit(db, { admin, action, targetUserId = null, targetEmail = '', detail = {}, at }) {
  db.prepare('INSERT INTO admin_audit (at, admin_user_id, admin_email, action, target_user_id, target_email, detail) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    at,
    admin?.id ?? null,
    admin?.email ?? '',
    action,
    targetUserId,
    targetEmail,
    JSON.stringify(detail ?? {}),
  );
}

/** The newest `limit` entries, as wire objects. */
export function auditLog(db, { limit = 100, targetUserId } = {}) {
  const rows = targetUserId
    ? db.prepare('SELECT * FROM admin_audit WHERE target_user_id = ? ORDER BY id DESC LIMIT ?').all(targetUserId, limit)
    : db.prepare('SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map((r) => {
    let detail = {};
    try {
      detail = JSON.parse(r.detail);
    } catch {
      detail = {};
    }
    return { id: r.id, at: r.at, adminUserId: r.admin_user_id, adminEmail: r.admin_email, action: r.action, targetUserId: r.target_user_id, targetEmail: r.target_email, detail };
  });
}
