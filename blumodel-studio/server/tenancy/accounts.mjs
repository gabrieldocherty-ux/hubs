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
  // A sales-site account on this showroom's team comes first: an address a team member signs in
  // with can't be taken over by someone signing up on the showroom with it (signup refuses that
  // now; this also covers an account made before it did).
  const member = tenantId
    ? db
        .prepare(`SELECT ${cols.replace(/(^|,\s*)(\w+)/g, '$1u.$2')} FROM users u JOIN tenant_members m ON m.user_id = u.id AND m.tenant_id = ? WHERE u.email = ? AND u.tenant_id IS NULL`)
        .get(tenantId, email)
    : null;
  if (member) return member;
  return db.prepare(`SELECT ${cols} FROM users WHERE email = ? AND tenant_id IS ?`).get(email, tenantId ?? null) ?? null;
}

/**
 * True when `email` can't be used for another account on this site (sign-up, an email change):
 * an account made on the site has it, or, on a showroom, a sales-site account on its team does.
 * `exceptUserId` is the account changing its own address.
 * @param {import('node:sqlite').DatabaseSync} db
 */
export function addressTaken(db, email, tenantId, exceptUserId = null) {
  if (db.prepare('SELECT 1 FROM users WHERE email = ? AND tenant_id IS ? AND id IS NOT ?').get(email, tenantId ?? null, exceptUserId)) return true;
  return (
    !!tenantId &&
    !!db.prepare('SELECT 1 FROM users u JOIN tenant_members m ON m.user_id = u.id AND m.tenant_id = ? WHERE u.email = ? AND u.tenant_id IS NULL AND u.id IS NOT ?').get(tenantId, email, exceptUserId)
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

/**
 * Adds `email` to showroom `tenant`'s team as `role` (the workspace's Team tab and the admin's
 * Companies screen). There is no email verification, so an account that already has the address
 * proves nothing about who holds it: anyone could have signed up (or changed their email) with it
 * before the invite. So:
 *   - no account yet: one is made with an unusable password and joins the team; the invite link
 *     sets its password (only the person holding the address, or the owner who passes it on, has it);
 *   - already on the team (or a sales-site team member): their role is set, nothing else;
 *   - an existing account NOT on the team: nothing is granted yet. The invite is held
 *     (tenancy-007) and an invite link is made; using it (POST /api/auth/reset) proves the address,
 *     signs every other device out and only then makes the account a member.
 * Returns { member, invite: { url, expiresAt } | null, created, pending }.
 */
export async function inviteToTeam(db, tenants, { tenant, email, name, role, by = null, origin, now = Date.now }) {
  const user = await ensureSiteUser(db, { tenantId: tenant.id, email, name, now });
  const onTeam = !!tenants.roleOf(tenant.id, user.id);
  if (user.created || onTeam) {
    const member = tenants.addMember(tenant.id, user.id, role, { by });
    const invite = user.created ? inviteLink(db, { userId: user.id, origin, createdBy: by, now }) : null;
    return { member, invite, created: user.created, pending: false };
  }
  const member = tenants.addPendingInvite(tenant.id, user.id, role, { by });
  const invite = inviteLink(db, { userId: user.id, origin, createdBy: by, now });
  return { member, invite, created: false, pending: true };
}
