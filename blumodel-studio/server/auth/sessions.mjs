// Sessions: random tokens stored only as SHA-256 hashes, sent as httpOnly SameSite=Lax
// cookies that slide forward once half used.
//
// Each session also has a public id (account-001), its creation and last-seen times and the
// browser and system names, for Account settings > Security ("signed-in devices"). The public id
// is what the account page names a device by; the token and its hash never leave the server.

import crypto from 'node:crypto';
import { deviceOf } from './device.mjs';

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

    /** Starts a session and sets its cookie on `res`. */
    start(req, res, userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      const t = now();
      const expires = t + SESSION_DAYS * DAY;
      const { browser, os } = deviceOf(req);
      const id = crypto.randomBytes(12).toString('hex');
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, id, created_at, last_seen_at, browser, os) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        sha256(token),
        userId,
        expires,
        id,
        t,
        t,
        browser,
        os,
      );
      res.setHeader('Set-Cookie', cookieFor(req, token, expires));
      return { token, expires, id };
    },

    /** The signed-in user (`{ id, email, name, role }`) or null; slides the session once half used. */
    currentUser(req, res) {
      const token = readCookie(req, COOKIE);
      if (!token) return null;
      const hash = sha256(token);
      const row = db
        .prepare('SELECT s.expires_at, s.last_seen_at, u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
        .get(hash);
      if (!row) return null;
      const t = now();
      if (row.expires_at < t) {
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
      return { id: row.id, email: row.email, name: row.name, role: row.role || 'customer' };
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
