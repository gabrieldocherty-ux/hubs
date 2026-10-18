// Two-factor sign-in (protect-002): an authenticator app (TOTP, server/auth/totp.mjs) plus ten
// one-time recovery codes. REQUIRED for BluModel admins (role 'admin'): their admin routes answer
// 403 mfa_enrol_required until it is on, and 401 mfa_required on a session that didn't pass it.
// Optional for everyone else (Account settings > Security).
//
//   user_mfa            one row per account: the secret once confirmed (secret, enabled_at), a
//                       secret being set up (pending_secret, pending_at: 15 minutes to confirm it),
//                       and last_step, the newest code step used (a code works once).
//   user_mfa_recovery   the recovery codes, as SHA-256 only; each used once (used_at).
//   mfa_tickets         "password right, now the code": a sign-in that passed the password gets a
//                       5-minute ticket (SHA-256 stored) good for 5 code attempts, on that site only.
//
// The secret must be readable to check a code, so it is stored as is; anyone with the database
// already holds every account's data. It is never logged, never sent after setup, and goes when
// 2FA is turned off or the account is deleted (ON DELETE CASCADE).

import crypto from 'node:crypto';
import { newRecoveryCodes, newSecret, normalizeRecovery, looksLikeRecovery, otpauthUrl, stepAt, verifyTotp } from './totp.mjs';

export const SETUP_MINUTES = 15;
export const TICKET_MINUTES = 5;
export const TICKET_ATTEMPTS = 5;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** @param {{ db: import('node:sqlite').DatabaseSync, now?: () => number }} deps */
export function createMfaStore({ db, now = Date.now }) {
  const row = (userId) => db.prepare('SELECT * FROM user_mfa WHERE user_id = ?').get(userId) ?? null;

  const store = {
    /** True when the account has 2FA on. */
    enabled(userId) {
      return !!userId && !!db.prepare('SELECT 1 FROM user_mfa WHERE user_id = ? AND enabled_at IS NOT NULL').get(userId);
    },

    /** `{ enabled, enabledAt, recoveryLeft }`. */
    status(userId) {
      const r = row(userId);
      const left = r?.enabled_at ? db.prepare('SELECT COUNT(*) AS n FROM user_mfa_recovery WHERE user_id = ? AND used_at IS NULL').get(userId).n : 0;
      return { enabled: !!r?.enabled_at, enabledAt: r?.enabled_at ?? null, recoveryLeft: Number(left) };
    },

    /**
     * Starts setting up (or replacing nothing: 2FA must be off): a new secret, held for
     * SETUP_MINUTES until a code from it is entered. Returns `{ secret, otpauthUrl }`, shown once.
     */
    begin(userId, account) {
      const secret = newSecret();
      const t = now();
      db.prepare(
        `INSERT INTO user_mfa (user_id, secret, enabled_at, pending_secret, pending_at, last_step, created_at) VALUES (?, NULL, NULL, ?, ?, -1, ?)
         ON CONFLICT(user_id) DO UPDATE SET pending_secret = excluded.pending_secret, pending_at = excluded.pending_at`,
      ).run(userId, secret, t, t);
      return { secret, otpauthUrl: otpauthUrl({ account, secret }) };
    },

    /**
     * Confirms the secret being set up with a code from it: 2FA is on, and the ten recovery codes
     * are returned (shown once; only their hashes are kept). Null when the code is wrong or the
     * setup expired.
     */
    confirm(userId, code) {
      const r = row(userId);
      if (!r?.pending_secret || r.enabled_at || now() - r.pending_at > SETUP_MINUTES * 60_000) return null;
      const step = verifyTotp(r.pending_secret, code, { ms: now() });
      if (step === null) return null;
      const codes = newRecoveryCodes();
      db.prepare('UPDATE user_mfa SET secret = pending_secret, pending_secret = NULL, pending_at = NULL, enabled_at = ?, last_step = ? WHERE user_id = ?').run(now(), step, userId);
      store.setRecovery(userId, codes);
      return codes;
    },

    /** Replaces the recovery codes (the old ones stop working). */
    setRecovery(userId, codes) {
      db.prepare('DELETE FROM user_mfa_recovery WHERE user_id = ?').run(userId);
      const ins = db.prepare('INSERT INTO user_mfa_recovery (user_id, code_hash, used_at) VALUES (?, ?, NULL)');
      for (const c of codes) ins.run(userId, sha(normalizeRecovery(c)));
      return codes;
    },

    /**
     * Checks a code for an account with 2FA on: a 6-digit code from the app (not one already
     * used), or an unused recovery code (used up here). Returns 'totp' | 'recovery' | null.
     */
    verify(userId, code) {
      const r = row(userId);
      if (!r?.enabled_at || !r.secret) return null;
      const c = String(code ?? '').trim();
      if (/^\d[\d\s]{4,8}\d$/.test(c)) {
        const step = verifyTotp(r.secret, c, { ms: now(), lastStep: r.last_step ?? -1 });
        if (step === null) return null;
        // Atomic, so two requests racing with one code can't both pass.
        const ok = db.prepare('UPDATE user_mfa SET last_step = ? WHERE user_id = ? AND last_step < ?').run(step, userId, step).changes;
        return ok ? 'totp' : null;
      }
      if (!looksLikeRecovery(c)) return null;
      const used = db.prepare('UPDATE user_mfa_recovery SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL').run(now(), userId, sha(normalizeRecovery(c))).changes;
      return used ? 'recovery' : null;
    },

    /** Turns 2FA off: the secret and recovery codes are deleted. */
    disable(userId) {
      db.prepare('DELETE FROM user_mfa_recovery WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM user_mfa WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM mfa_tickets WHERE user_id = ?').run(userId);
    },

    /** A sign-in ticket after the right password: `{ ticket, expiresAt }` (the token is never stored). */
    issueTicket(userId, tenantId) {
      const ticket = crypto.randomBytes(32).toString('base64url');
      const t = now();
      db.prepare('DELETE FROM mfa_tickets WHERE expires_at < ? OR user_id = ?').run(t, userId);
      db.prepare('INSERT INTO mfa_tickets (token_hash, user_id, tenant_id, created_at, expires_at, attempts) VALUES (?, ?, ?, ?, ?, 0)').run(sha(ticket), userId, tenantId ?? null, t, t + TICKET_MINUTES * 60_000);
      return { ticket, expiresAt: t + TICKET_MINUTES * 60_000 };
    },

    /**
     * The account a live ticket is for on this site, counting one attempt. Null when it is unknown,
     * expired, used up, or for another site.
     */
    ticketUser(ticket, tenantId) {
      if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null;
      const h = sha(ticket);
      const r = db.prepare('UPDATE mfa_tickets SET attempts = attempts + 1 WHERE token_hash = ? AND expires_at > ? AND attempts < ? AND tenant_id IS ? RETURNING user_id').get(h, now(), TICKET_ATTEMPTS, tenantId ?? null);
      return r?.user_id ?? null;
    },

    /** The ticket worked: it is gone. */
    endTicket(ticket) {
      db.prepare('DELETE FROM mfa_tickets WHERE token_hash = ?').run(sha(String(ticket)));
    },

    purgeExpired() {
      db.prepare('DELETE FROM mfa_tickets WHERE expires_at < ?').run(now());
      db.prepare('UPDATE user_mfa SET pending_secret = NULL, pending_at = NULL WHERE pending_at IS NOT NULL AND pending_at < ?').run(now() - SETUP_MINUTES * 60_000);
      db.prepare('DELETE FROM user_mfa WHERE enabled_at IS NULL AND pending_secret IS NULL').run();
    },
  };
  return store;
}

export { stepAt };
