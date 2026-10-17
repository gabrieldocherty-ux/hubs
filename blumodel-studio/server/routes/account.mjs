// A person's own account (launch contract, then Account settings):
//
//   GET    /api/account/export                   everything that is theirs, as a JSON download
//   POST   /api/account/delete {password}        delete the account (password again)
//   GET    /api/account/prefs                    { prefs, saved, emailEnabled }
//   PATCH  /api/account/prefs {theme?, showEstimator?, signInAlerts?}
//   GET    /api/account/profile                  { profile: { name, email, phone, createdAt } }
//   PATCH  /api/account/profile {name?, phone?}  phone normalised (server/account/phone.mjs)
//   POST   /api/account/email {email, password}  change the sign-in email: the current password
//                                                confirms it, every other device is signed out and
//                                                the old address is told (when email is on)
//   GET    /api/account/sessions                 signed-in devices: { sessions: [{ id, current,
//                                                browser, os, createdAt, lastSeenAt, expiresAt }] }
//   DELETE /api/account/sessions/:id             sign one other device out
//   POST   /api/account/sessions/sign-out-others sign every other device out
//
// Every route needs a signed-in user; every write carries the X-BluModel CSRF header (the router)
// and is rate-limited. What the export includes and what deleting keeps: server/account/service.mjs.

import { HttpError } from '../http/respond.mjs';
import { MAX_PASSWORD, verifyPassword } from '../auth/passwords.mjs';
import { createAccountService } from '../account/service.mjs';
import { createBillingService } from '../billing/service.mjs';
import { createPrefsStore, readPrefsPatch } from '../account/prefs.mjs';
import { normalizePhone } from '../account/phone.mjs';
import { EMAIL_RE, makeUserWire } from '../auth/userWire.mjs';
import { createMailer } from '../email/index.mjs';
import { addressTaken } from '../tenancy/accounts.mjs';
import { emailChangedEmail } from '../email/messages.mjs';

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const HOUR = 3_600_000;

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config, services, log } = ctx;
  const { sessions } = ctx.internal;
  const account = createAccountService({ db, config, now: ctx.now, tx: ctx.tx, files: services.files });
  const billing = createBillingService({ db, now: ctx.now, log });
  const prefs = createPrefsStore(db, ctx.now);
  const userWire = makeUserWire(services);
  const mailer = createMailer({ config, fetch: ctx.fetch, log });

  const profileOf = (userId) => {
    const u = db.prepare('SELECT name, email, phone, created_at FROM users WHERE id = ?').get(userId);
    if (!u) throw new HttpError(401, 'Please sign in.');
    return { name: u.name, email: u.email, phone: u.phone ?? '', createdAt: u.created_at };
  };

  const checkPassword = async (userId, password) => {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId);
    const pw = typeof password === 'string' ? password.slice(0, MAX_PASSWORD) : '';
    return !!row && !!pw && (await verifyPassword(pw, row.password_hash));
  };

  return [
    {
      method: 'GET',
      path: '/api/account/export',
      rateLimit: { name: 'account-export', max: 20, windowMs: HOUR, by: 'user' },
      handler: (rc) => {
        const data = account.exportFor(rc.user.id, { billing });
        if (!data) throw new HttpError(401, 'Please sign in.');
        const body = JSON.stringify(data, null, 2);
        const day = new Date(ctx.now()).toISOString().slice(0, 10);
        rc.sent = true;
        rc.res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="blumodel-account-${day}.json"`,
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
        });
        rc.res.end(body);
      },
    },
    {
      method: 'POST',
      path: '/api/account/delete',
      maxBytes: 4_096,
      rateLimit: [
        { name: 'account-delete', max: 10, windowMs: HOUR, by: 'user' },
        { name: 'account-delete-ip', max: 30, windowMs: HOUR, by: 'ip' },
      ],
      handler: async (rc) => {
        if (!(await checkPassword(rc.user.id, rc.body.password))) {
          throw new HttpError(400, 'Your password is not right.', { code: 'wrong_password' });
        }
        // A sales-site account on a showroom's team (a contractor whose company became a showroom)
        // is the whole blumodel.studio account: it is deleted there, never from a showroom.
        if (rc.site.tenantId && db.prepare('SELECT tenant_id FROM users WHERE id = ?').get(rc.user.id)?.tenant_id == null) {
          throw new HttpError(409, 'This account is your BluModel Studio account. Delete it on blumodel.studio, or ask an owner to remove you from this showroom’s team.', { code: 'sales_account' });
        }
        if (account.activePaidPlan(rc.user.id)) {
          throw new HttpError(409, 'Cancel your plan first (Account > Billing). You can delete your account once it is set to end.', { code: 'active_subscription' });
        }
        const counts = account.deleteAccount(rc.user.id);
        log.info?.(`Account ${rc.user.id} deleted (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}).`);
        rc.res.setHeader('Set-Cookie', sessions.clearedCookie(rc.req));
        rc.send(204);
      },
    },

    // ── preferences ─────────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/account/prefs',
      handler: (rc) => ({ ...prefs.get(rc.user.id), emailEnabled: mailer.enabled }),
    },
    {
      method: 'PATCH',
      path: '/api/account/prefs',
      maxBytes: 2_048,
      rateLimit: { name: 'account-prefs', max: 120, windowMs: 15 * 60_000, by: 'user' },
      handler: (rc) => {
        const patch = readPrefsPatch(rc.body);
        return { prefs: prefs.update(rc.user.id, patch), saved: true, emailEnabled: mailer.enabled };
      },
    },

    // ── profile ─────────────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/account/profile',
      handler: (rc) => ({ profile: profileOf(rc.user.id) }),
    },
    {
      method: 'PATCH',
      path: '/api/account/profile',
      maxBytes: 4_096,
      rateLimit: { name: 'account-profile', max: 30, windowMs: 15 * 60_000, by: 'user' },
      handler: (rc) => {
        const b = rc.body ?? {};
        const cur = profileOf(rc.user.id);
        let name = cur.name;
        let phone = cur.phone;
        if (b.name !== undefined) {
          name = str(b.name, 80);
          if (!name) throw new HttpError(400, 'Name cannot be empty.', { field: 'name' });
        }
        if (b.phone !== undefined) {
          if (b.phone !== null && typeof b.phone !== 'string') throw new HttpError(400, 'That phone number doesn’t look right.', { field: 'phone' });
          const p = normalizePhone(b.phone ?? '');
          if (!p.ok) throw new HttpError(400, p.reason, { field: 'phone' });
          phone = p.value;
        }
        db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, rc.user.id);
        return { profile: profileOf(rc.user.id), user: userWire({ ...rc.user, name }) };
      },
    },
    {
      method: 'POST',
      path: '/api/account/email',
      maxBytes: 4_096,
      rateLimit: [
        { name: 'account-email', max: 6, windowMs: HOUR, by: 'user' },
        { name: 'account-email-ip', max: 30, windowMs: HOUR, by: 'ip' },
      ],
      handler: async (rc) => {
        const email = str(rc.body.email, 254).toLowerCase();
        if (!EMAIL_RE.test(email) || /[\r\n,;<>]/.test(email)) throw new HttpError(400, 'That email address does not look right.', { field: 'email' });
        if (!(await checkPassword(rc.user.id, rc.body.password))) throw new HttpError(400, 'Your current password is not right.', { field: 'password', code: 'wrong_password' });
        const old = db.prepare('SELECT email, name FROM users WHERE id = ?').get(rc.user.id);
        if (email === old.email) throw new HttpError(400, 'That is already your email address.', { field: 'email' });
        const taken = () => new HttpError(409, 'An account with that email already exists.', { field: 'email' });
        // An address is unique per site (tenancy-002): another showroom's account with it is no clash.
        if (addressTaken(db, email, db.prepare('SELECT tenant_id FROM users WHERE id = ?').get(rc.user.id)?.tenant_id ?? null, rc.user.id)) throw taken();
        // ADMIN_EMAILS plays no part here: it grants nothing and reserves nothing (signing up with a
        // listed address never could be stopped either). Admins come only from
        // server/scripts/make-admin.mjs, run on the server against an account that already exists.
        try {
          db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, rc.user.id);
        } catch (err) {
          if (/UNIQUE/i.test(String(err?.message))) throw taken();
          throw err;
        }
        const signedOut = sessions.endOthers(rc.req, rc.user.id);
        // A reset link mailed to the old address stops working with it.
        db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(rc.user.id);
        if (mailer.enabled) {
          const msg = emailChangedEmail({ newEmail: email, supportEmail: config.legal?.supportEmail });
          void mailer.send({ to: old.email, ...msg });
        }
        log.info?.(`Account ${rc.user.id} changed its email address (${signedOut} other session(s) signed out).`);
        return { user: userWire({ ...rc.user, email }), signedOut };
      },
    },

    // ── signed-in devices ───────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/account/sessions',
      handler: (rc) => ({ sessions: sessions.listFor(rc.req, rc.user.id).filter((s) => s.id) }),
    },
    {
      method: 'DELETE',
      path: '/api/account/sessions/:id',
      params: { id: /^[a-f0-9]{24}$/ },
      rateLimit: { name: 'account-sessions', max: 60, windowMs: 15 * 60_000, by: 'user' },
      handler: (rc) => {
        if (rc.params.id === sessions.currentId(rc.req)) throw new HttpError(400, 'That’s this device. Use Sign out instead.', { code: 'current_session' });
        if (!sessions.endById(rc.user.id, rc.params.id)) throw new HttpError(404, 'That device is already signed out.');
        rc.send(204);
      },
    },
    {
      method: 'POST',
      path: '/api/account/sessions/sign-out-others',
      body: 'none',
      rateLimit: { name: 'account-sessions', max: 60, windowMs: 15 * 60_000, by: 'user' },
      handler: (rc) => ({ signedOut: sessions.endOthers(rc.req, rc.user.id) }),
    },
  ];
}
