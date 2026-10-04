// Sessions: random tokens stored only as SHA-256 hashes, sent as httpOnly SameSite=Lax
// cookies that slide forward once half used.

import crypto from 'node:crypto';

export const COOKIE = 'mise_session';
export const SESSION_DAYS = 30;
const DAY = 86_400_000;

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export function isLoopback(addr = '') {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * Secure follows the request, not the mode: a Secure cookie sent over plain http to
 * anything but localhost is silently dropped, which would break sign-in on a home
 * server reached over the LAN. X-Forwarded-Proto is trusted from a loopback proxy
 * (e.g. `tailscale serve`), or from any address when TRUST_PROXY is set; never Secure
 * just because the server runs in production mode.
 */
export function isHttps(req, config) {
  if (req.socket?.encrypted) return true;
  if (req.headers['x-forwarded-proto'] !== 'https') return false;
  return isLoopback(req.socket?.remoteAddress) || (config?.TRUST_PROXY ?? 0) > 0;
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

  const store = {
    cookieFor,
    clearedCookie: (req) => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureAttr(req, config)}`,

    /** Starts a session and sets its cookie on `res`. */
    start(req, res, userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      const expires = now() + SESSION_DAYS * DAY;
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), userId, expires);
      res.setHeader('Set-Cookie', cookieFor(req, token, expires));
      return { token, expires };
    },

    /** The signed-in user (`{ id, email, name, role }`) or null; slides the session once half used. */
    currentUser(req, res) {
      const token = readCookie(req, COOKIE);
      if (!token) return null;
      const hash = sha256(token);
      const row = db
        .prepare('SELECT s.expires_at, u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
        .get(hash);
      if (!row) return null;
      const t = now();
      if (row.expires_at < t) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
        return null;
      }
      if (row.expires_at - t < (SESSION_DAYS / 2) * DAY) {
        const expires = t + SESSION_DAYS * DAY;
        db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(expires, hash);
        if (res && !res.headersSent) res.setHeader('Set-Cookie', cookieFor(req, token, expires));
      }
      return { id: row.id, email: row.email, name: row.name, role: row.role || 'customer' };
    },

    /** Ends the request's session (if any) and clears the cookie. */
    end(req, res) {
      const token = readCookie(req, COOKIE);
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
      res.setHeader('Set-Cookie', store.clearedCookie(req));
    },

    /** Signs out every other device for `userId`, keeping the request's own session. */
    endOthers(req, userId) {
      const keep = sha256(readCookie(req, COOKIE) || '');
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(userId, keep);
    },

    purgeExpired() {
      db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
    },
  };
  return store;
}
