// The admin audit log (ops-001 admin_audit): who did what to whom, when. Written for actions that
// change money or access (complimentary plans, exports an admin made without paying). Emails are
// copied in at the time so the record still reads after an account is deleted.

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
