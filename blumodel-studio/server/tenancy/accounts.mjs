// Accounts belong to a site (tenancy-002): users.tenant_id is the showroom an account was made on,
// NULL for the sales site. The same address can have an account on several showrooms; each is a
// separate account with its own password, kitchens and sessions.
//
// Who may sign in where (siteAllows): an account made on showroom T, or a sales-site account that
// is a member of T's team (a contractor whose company became a tenant), on T; a sales-site
// account on the sales site. Nobody else, by any route: auth/sessions.mjs checks this when a
// session starts and on every request.

import crypto from 'node:crypto';
import { hashPassword } from '../auth/passwords.mjs';
import { createResetStore, INVITE_MINUTES } from '../auth/resets.mjs';

/**
 * True when `userId` may hold a session on the site whose tenant id is `tenantId` (null = sales).
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function siteAllows(db, userId, tenantId) {
  const u = db.prepare('SELECT tenant_id FROM users WHERE id = ?').get(userId);
  if (!u) return false;
  if ((u.tenant_id ?? null) === (tenantId ?? null)) return true;
  return !!tenantId && u.tenant_id == null && !!db.prepare('SELECT 1 FROM tenant_members WHERE tenant_id = ? AND user_id = ?').get(tenantId, userId);
}

/**
 * The account a sign-in on this site means by `email`: the one made on this site, else (on a
 * showroom) a sales-site account on its team. Returns the users row (with password_hash) or null.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} email  already lowercased
 * @param {string | null} tenantId
 * @param {string} [cols]
 */
export function findSiteUser(db, email, tenantId, cols = 'id, email, name, role, password_hash, tenant_id') {
  const own = db.prepare(`SELECT ${cols} FROM users WHERE email = ? AND tenant_id IS ?`).get(email, tenantId ?? null);
  if (own || !tenantId) return own ?? null;
  return (
    db
      .prepare(`SELECT ${cols.replace(/(^|,\s*)(\w+)/g, '$1u.$2')} FROM users u JOIN tenant_members m ON m.user_id = u.id AND m.tenant_id = ? WHERE u.email = ? AND u.tenant_id IS NULL`)
      .get(tenantId, email) ?? null
  );
}

/**
 * The account on showroom `tenantId` with this address, made (with an unusable random password)
 * when there is none. A team invite uses this, then sends a set-your-password link.
 * @returns {Promise<{ id: string, email: string, name: string, created: boolean }>}
 */
export async function ensureSiteUser(db, { tenantId, email, name, now = Date.now }) {
  const e = String(email).trim().toLowerCase();
  const found = findSiteUser(db, e, tenantId, 'id, email, name');
  if (found) return { id: found.id, email: found.email, name: found.name, created: false };
  const id = crypto.randomUUID();
  const hash = await hashPassword(crypto.randomBytes(24).toString('base64url'));
  const n = String(name ?? '').trim().slice(0, 80) || e.split('@')[0].slice(0, 80);
  db.prepare('INSERT INTO users (id, email, name, password_hash, created_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, e, n, hash, now(), tenantId);
  return { id, email: e, name: n, created: true };
}

/**
 * A set-your-password link for a new team member, on their showroom's address. It is the reset
 * flow (#/signin?reset=...), lasting INVITE_MINUTES. Returns { url, expiresAt }; the token is never
 * stored or logged.
 */
export function inviteLink(db, { userId, origin, createdBy = null, now = Date.now }) {
  const { token, expiresAt } = createResetStore({ db, now }).issue(userId, { createdBy, minutes: INVITE_MINUTES });
  return { url: `${origin}/#/signin?reset=${token}`, expiresAt };
}
