// Sessions: random tokens stored only as SHA-256 hashes, sent as httpOnly SameSite=Lax
// cookies that slide forward once half used.
//
// Each session also has a public id (account-001), its creation and last-seen times and the
// browser and system names, for Account settings > Security ("signed-in devices"). The public id
// is what the account page names a device by; the token and its hash never leave the server.

import crypto from 'node:crypto';
import { deviceOf } from './device.mjs';
import { HttpError } from '../http/respond.mjs';
import { DISABLED_MESSAGE, isDisabled } from '../admin/status.mjs';
import { siteAllows } from '../tenancy/accounts.mjs';

/**
 * The tenant id of the site a request is for (app.mjs sets req.blumodelSite from its Host), null for
 * the sales site. A session belongs to the site it was started on and works nowhere else; the
 * cookie is host-only (no Domain=) as well, so a browser never even sends it to another showroom.
 */
export const siteTenantOf = (req) => req?.blumodelSite?.tenantId ?? null;

export const COOKIE = 'blumodel_session';
export const SESSION_DAYS = 30;
const DAY = 86_400_000;
/** last_seen_at is written at most this often per session, so reads stay reads. */
export const LAST_SEEN_EVERY = 5 * 60_000;

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function isLoopback(addr = '') {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * Secure follows the request, not the mode: a Secure cookie sent over plain http to
 * anything but localhost is silently dropped, which would break sign-in on a home
 * server reached over the LAN. X-Forwarded-Proto is trusted ONLY with TRUST_PROXY=1 AND from a
 * loopback peer (cloudflared or `tailscale serve` on this machine), the same rule as the client
 * address (app.mjs clientIp): a LAN or internet client can't claim https by sending the header,
 * and with TRUST_PROXY off no forwarding header is believed at all. Never Secure just because
 * the server runs in production mode. HSTS follows the same rule (http/respond.mjs).
 * @param {{ TRUST_PROXY?: number } | undefined} config
 */
export function isHttps(req, config) {
  if (req.socket?.encrypted) return true;
  if (!(Number(config?.TRUST_PROXY) > 0)) return false;
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  if (proto !== 'https') return false;
  return isLoopback(req.socket?.remoteAddress);
}

export const secureAttr = (req, config) => (isHttps(req, config) ? '; Secure' : '');

export function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function createSessionStore({ db, config, now = Date.now }) {
  const adminSessionMs = (Number(config?.ADMIN_SESSION_HOURS) || 12) * 3_600_000;
  const cookieFor = (req, token, expires) => {
    const maxAge = Math.max(0, Math.floor((expires - now()) / 1000));
    return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secureAttr(req, config)}`;
  };
  /** The hash of the request's own session token, or null when it carries none. */
  const ownHash = (req) => {
    const token = readCookie(req, COOKIE);
    return token ? sha256(token) : null;
  };

  const store = {
    cookieFor,
    clearedCookie: (req) => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureAttr(req, config)}`,

    /**
     * Starts a session on the request's site and sets its cookie on `res`. An account that doesn't
     * belong to this site (tenancy/accounts.mjs siteAllows) never gets one, whichever route asks.
     */
    start(req, res, userId, { mfa = false } = {}) {
      // A disabled account (Admin > Users) never gets a session, whichever route signs it in.
      if (isDisabled(db, userId)) throw new HttpError(403, DISABLED_MESSAGE, { code: 'account_disabled' });
      const tenantId = siteTenantOf(req);
      if (!siteAllows(db, userId, tenantId)) throw new HttpError(403, 'That account isn’t on this site.', { code: 'wrong_site' });
      const token = crypto.randomBytes(32).toString('base64url');
      const t = now();
      const expires = t + SESSION_DAYS * DAY;
      const { browser, os } = deviceOf(req);
      const id = crypto.randomBytes(12).toString('hex');
      // auth_at: the password was just proved; mfa_at: and a second factor, when the sign-in passed one.
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, id, created_at, last_seen_at, browser, os, tenant_id, auth_at, mfa_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        sha256(token),
        userId,
        expires,
        id,
        t,
        t,
        browser,
        os,
        tenantId,
        t,
        mfa ? t : null,
      );
      res.setHeader('Set-Cookie', cookieFor(req, token, expires));
      return { token, expires, id };
    },

    /**
     * The signed-in user (`{ id, email, name, role, tenantId }`) or null; slides the session once
     * half used. Only a session started on this request's site counts, and only while the account
     * still belongs there (a removed team member's showroom session stops at once).
     */
    currentUser(req, res) {
      const token = readCookie(req, COOKIE);
      if (!token) return null;
      const hash = sha256(token);
      const tenantId = siteTenantOf(req);
      const row = db
        .prepare(
          `SELECT s.expires_at, s.last_seen_at, s.created_at, s.auth_at, s.mfa_at, u.id, u.email, u.name, u.role, u.tenant_id FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = ? AND s.tenant_id IS ? AND NOT EXISTS (SELECT 1 FROM account_status d WHERE d.user_id = u.id)
              AND (u.tenant_id IS ? OR (? IS NOT NULL AND u.tenant_id IS NULL AND EXISTS (SELECT 1 FROM tenant_members m WHERE m.tenant_id = ? AND m.user_id = u.id)))`,
        )
        .get(hash, tenantId, tenantId, tenantId, tenantId);
      if (!row) return null;
      const t = now();
      // An admin's session on the sales site ends ADMIN_SESSION_HOURS after it started, however busy:
      // a stolen admin cookie is worth hours, not the 30 sliding days of an ordinary account.
      const adminEnds = !tenantId && row.role === 'admin' ? (row.created_at ?? 0) + adminSessionMs : Infinity;
      if (row.expires_at < t || adminEnds < t) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
        return null;
      }
      if (row.expires_at - t < (SESSION_DAYS / 2) * DAY) {
        const expires = t + SESSION_DAYS * DAY;
        db.prepare('UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE token_hash = ?').run(expires, t, hash);
        if (res && !res.headersSent) res.setHeader('Set-Cookie', cookieFor(req, token, expires));
      } else if (!(row.last_seen_at > t - LAST_SEEN_EVERY)) {
        db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(t, hash);
      }
      // BluModel's own roles (studio, admin) mean nothing on a showroom.
      const role = tenantId ? 'customer' : row.role || 'customer';
      return {
        id: row.id,
        email: row.email,
        name: row.name,
        role,
        tenantId: row.tenant_id ?? null,
        /** This session's proofs: mfa (it passed a second factor) and when it last proved the password. */
        session: { mfa: row.mfa_at != null, authAt: row.auth_at ?? row.created_at ?? 0, createdAt: row.created_at ?? 0 },
      };
    },

    /** The request's session just passed a second factor (2FA turned on, or re-authenticated with a code). */
    markMfa(req) {
      const hash = ownHash(req);
      if (hash) db.prepare('UPDATE sessions SET mfa_at = ?, auth_at = ? WHERE token_hash = ?').run(now(), now(), hash);
    },

    /** The request's session just proved the password again (re-authentication). */
    markAuth(req) {
      const hash = ownHash(req);
      if (hash) db.prepare('UPDATE sessions SET auth_at = ? WHERE token_hash = ?').run(now(), hash);
    },

    /** Ends the request's session (if any) and clears the cookie. */
    end(req, res) {
      const hash = ownHash(req);
      if (hash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      res.setHeader('Set-Cookie', store.clearedCookie(req));
    },

    /** Signs out every other device for `userId`, keeping the request's own session. Returns how many. */
    endOthers(req, userId) {
      const keep = ownHash(req) ?? sha256('');
      return Number(db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, keep).changes);
    },

    /** Signs out every device for `userId` (a password reset). Returns how many. */
    endAll(userId) {
      return Number(db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes);
    },

    /**
     * The user's live sessions, newest activity first, as `{ id, current, browser, os, createdAt,
     * lastSeenAt, expiresAt }`. Never the token or its hash.
     */
    listFor(req, userId) {
      const mine = ownHash(req);
      return db
        .prepare('SELECT token_hash, id, created_at, last_seen_at, expires_at, browser, os FROM sessions WHERE user_id = ? AND expires_at >= ? ORDER BY COALESCE(last_seen_at, 0) DESC, COALESCE(created_at, 0) DESC')
        .all(userId, now())
        .map((r) => ({
          id: r.id,
          current: r.token_hash === mine,
          browser: r.browser || '',
          os: r.os || '',
          createdAt: r.created_at ?? null,
          lastSeenAt: r.last_seen_at ?? null,
          expiresAt: r.expires_at,
        }));
    },

    /** The public id of the request's own session, or null. */
    currentId(req) {
      const hash = ownHash(req);
      return hash ? (db.prepare('SELECT id FROM sessions WHERE token_hash = ?').get(hash)?.id ?? null) : null;
    },

    /** Ends one of `userId`'s sessions by its public id. True when one was ended. */
    endById(userId, id) {
      return Number(db.prepare('DELETE FROM sessions WHERE user_id = ? AND id = ?').run(userId, id).changes) > 0;
    },

    purgeExpired() {
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
    },
  };
  return store;
}
