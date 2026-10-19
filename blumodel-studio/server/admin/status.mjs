// Disabled accounts (Admin > Users > Disable). A disabled account can't sign in (the login route
// and sessions.start both check) and has no live session (disabling ends them all), and a session
// cookie that somehow survived is not honoured (sessions.currentUser checks too). Enabling it
// again deletes the row; nothing else about the account changes either way.

/** True when `userId` is disabled. Cheap: one primary-key lookup. */
export function isDisabled(db, userId) {
  if (!userId) return false;
  return !!db.prepare('SELECT 1 FROM account_status WHERE user_id = ?').get(userId);
}

/** `{ disabledAt, disabledBy, reason }` or null. */
export function disabledInfo(db, userId) {
  const r = db.prepare('SELECT disabled_at, disabled_by, reason FROM account_status WHERE user_id = ?').get(userId);
  return r ? { disabledAt: r.disabled_at, disabledBy: r.disabled_by ?? null, reason: r.reason ?? '' } : null;
}

/** Disables `userId` (idempotent: the first time and reason are kept). */
export function disableAccount(db, userId, { by = null, reason = '', at }) {
  db.prepare('INSERT OR IGNORE INTO account_status (user_id, disabled_at, disabled_by, reason) VALUES (?, ?, ?, ?)').run(userId, at, by, reason);
}

/** Enables `userId` again. True when it was disabled. */
export function enableAccount(db, userId) {
  return Number(db.prepare('DELETE FROM account_status WHERE user_id = ?').run(userId).changes) > 0;
}

export const DISABLED_MESSAGE = 'This account has been disabled. Contact support if you think this is a mistake.';
