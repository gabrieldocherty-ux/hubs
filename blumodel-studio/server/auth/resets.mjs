// Password-reset links (account-001 password_resets). A link carries a random 256-bit token; only
// its SHA-256 is stored, so a copy of the database can't be used to reset anyone's password. A link
// works once, for RESET_MINUTES, and only the newest one per account works: making a new link (by
// email or by an admin) deletes the older ones. Using it changes the password and signs the account
// out everywhere (routes/auth.mjs).

import crypto from 'node:crypto';
import { sha256 } from './sessions.mjs';

export const RESET_MINUTES = 60;
const DAY = 86_400_000;
/** 32 random bytes as base64url, and nothing else. */
export const RESET_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** @param {{ db: import('node:sqlite').DatabaseSync, now?: () => number }} deps */
export function createResetStore({ db, now = Date.now }) {
  return {
    /**
     * A new single-use link token for `userId`. `createdBy` is the admin who made it, or null when
     * the person asked by email. Returns the token (shown or sent once, never stored) and its expiry.
     */
    issue(userId, { createdBy = null } = {}) {
      const t = now();
      db.prepare('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?').run(userId, t - DAY);
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = t + RESET_MINUTES * 60_000;
      db.prepare('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at, used_at, created_by) VALUES (?, ?, ?, ?, NULL, ?)').run(sha256(token), userId, t, expiresAt, createdBy);
      return { token, expiresAt };
    },

    /** The account a live (unused, unexpired) token belongs to, as `{ userId, email }`, or null. */
    find(token) {
      if (typeof token !== 'string' || !RESET_TOKEN_RE.test(token)) return null;
      const row = db
        .prepare('SELECT r.user_id, u.email FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?')
        .get(sha256(token), now());
      return row ? { userId: row.user_id, email: row.email } : null;
    },

    /** Marks a live token used, atomically. Returns its user id, or null if it was not live. */
    consume(token) {
      if (typeof token !== 'string' || !RESET_TOKEN_RE.test(token)) return null;
      const t = now();
      const row = db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? RETURNING user_id').get(t, sha256(token), t);
      return row ? row.user_id : null;
    },

    /** Every link for `userId` stops working (a password change, a deleted account). */
    revokeFor(userId) {
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(userId);
    },
  };
}

/** "j•••@gmail.com": enough for a person to recognise their own address on the reset page. */
export function maskEmail(email) {
  const [local = '', domain = ''] = String(email).split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}
