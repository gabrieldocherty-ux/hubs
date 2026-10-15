// Accounts: sign up, sign in, sign out, the current user, rename, password change.
// Messages are unchanged from the single-file server.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { hashPassword, verifyPassword, dummyHash, MAX_PASSWORD } from '../auth/passwords.mjs';
import { EMAIL_RE, makeUserWire } from '../auth/userWire.mjs';
import { deviceLabel, deviceOf } from '../auth/device.mjs';
import { createPrefsStore } from '../account/prefs.mjs';
import { createMailer } from '../email/index.mjs';
import { passwordChangedEmail, signInAlertEmail } from '../email/messages.mjs';

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const LOGIN_WINDOW = 15 * 60_000;
const LOGIN_MAX_PER_IP_EMAIL = 8;
/** Per email alone, so rotating addresses can't brute-force one account. */
const LOGIN_MAX_PER_EMAIL = 30;

/** "2026-10-14 20:15 UTC": an unambiguous time for an email. */
const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config, services, log } = ctx;
  const { sessions, limiter } = ctx.internal;
  const prefs = createPrefsStore(db, ctx.now);
  const mailer = createMailer({ config, fetch: ctx.fetch, log });
  for (const n of mailer.notes) log?.info?.(n);

  /**
   * `{ id, email, name, role, brands, plan, contractor }`: the shape every auth response
   * returns (server/auth/userWire.mjs).
   */
  const userWire = makeUserWire(services);

  // Roles are never granted by signing up or signing in. There is no email verification, so an
  // address proves nothing: an admin is made only on the server, with
  // `node server/scripts/make-admin.mjs <email>`. ADMIN_EMAILS grants nothing; it only reserves its
  // addresses against being moved onto another account (/api/account/email).

  /**
   * Email notifications > Sign-in alerts: when email is on, the person hasn't turned alerts off,
   * and none of their signed-in sessions is the same browser on the same system, tell them.
   * Decided before the new session exists; sent without waiting, so a sign-in never waits on the
   * provider and its timing says nothing about the account.
   */
  const alertNewDevice = (req, user) => {
    if (!mailer.enabled || !prefs.get(user.id).prefs.signInAlerts) return;
    const { browser, os } = deviceOf(req);
    const known = db.prepare('SELECT 1 FROM sessions WHERE user_id = ? AND browser = ? AND os = ? AND expires_at >= ?').get(user.id, browser, os, ctx.now());
    if (known) return;
    const msg = signInAlertEmail({
      name: user.name,
      device: deviceLabel({ browser, os }),
      when: utc(ctx.now()),
      settingsUrl: `${config.PUBLIC_URL}/#/account`,
      supportEmail: config.legal?.supportEmail,
    });
    void mailer.send({ to: user.email, ...msg });
  };

  return [
    {
      method: 'POST',
      path: '/api/auth/signup',
      auth: 'none',
      rateLimit: { name: 'signup', max: 5, windowMs: 3_600_000, by: 'ip' },
      handler: async (rc) => {
        const body = rc.body;
        const name = str(body.name, 80);
        const email = str(body.email, 254).toLowerCase();
        const password = typeof body.password === 'string' ? body.password : '';
        if (!name) throw new HttpError(400, 'Tell us your name.');
        if (!EMAIL_RE.test(email)) throw new HttpError(400, 'That email address does not look right.');
        if (password.length < 8) throw new HttpError(400, 'Use at least 8 characters for your password.');
        if (password.length > MAX_PASSWORD) throw new HttpError(400, 'That password is too long.');
        const taken = () => new HttpError(409, 'An account with that email already exists. Try signing in.');
        if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw taken();
        const hash = await hashPassword(password);
        const id = crypto.randomUUID();
        try {
          db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, email, name, hash, ctx.now());
        } catch (err) {
          if (/UNIQUE/i.test(String(err?.message))) throw taken();
          throw err;
        }
        sessions.start(rc.req, rc.res, id);
        rc.send(201, { user: userWire({ id, email, name, role: 'customer' }) });
      },
    },
    {
      method: 'POST',
      path: '/api/auth/login',
      auth: 'none',
      // Every attempt from one real address, on top of the per IP+email and per-email budgets below.
      rateLimit: { name: 'login-ip', max: 100, windowMs: LOGIN_WINDOW, by: 'ip' },
      handler: async (rc) => {
        const email = str(rc.body.email, 254).toLowerCase();
        const password = typeof rc.body.password === 'string' ? rc.body.password : '';
        const keyPair = `login:${rc.ip}|${email}`;
        const keyEmail = `login-email:${email}`;
        if (limiter.blocked(keyPair, LOGIN_MAX_PER_IP_EMAIL, LOGIN_WINDOW) || limiter.blocked(keyEmail, LOGIN_MAX_PER_EMAIL, LOGIN_WINDOW)) {
          const err = new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
          err.retryAfter = 60;
          throw err;
        }
        const user = db.prepare('SELECT id, email, name, role, password_hash FROM users WHERE email = ?').get(email);
        const ok = (await verifyPassword(password.slice(0, MAX_PASSWORD), user ? user.password_hash : await dummyHash())) && !!user;
        if (!ok) {
          limiter.hit(keyPair, Infinity, LOGIN_WINDOW);
          limiter.hit(keyEmail, Infinity, LOGIN_WINDOW);
          throw new HttpError(401, 'That email and password do not match.');
        }
        limiter.reset(keyPair);
        alertNewDevice(rc.req, user);
        sessions.start(rc.req, rc.res, user.id);
        return { user: userWire(user) };
      },
    },
    {
      method: 'POST',
      path: '/api/auth/logout',
      auth: 'none',
      body: 'none',
      handler: (rc) => {
        sessions.end(rc.req, rc.res);
        return { ok: true };
      },
    },
    {
      method: 'GET',
      path: '/api/auth/me',
      auth: 'optional',
      handler: (rc) => ({ user: rc.user ? userWire(rc.user) : null }),
    },
    {
      method: 'PATCH',
      path: '/api/auth/me',
      handler: (rc) => {
        const name = str(rc.body.name, 80);
        if (!name) throw new HttpError(400, 'Name cannot be empty.');
        db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, rc.user.id);
        return { user: userWire({ ...rc.user, name }) };
      },
    },
    {
      method: 'POST',
      path: '/api/auth/password',
      rateLimit: { name: 'password-change', max: 10, windowMs: 15 * 60_000, by: 'user' },
      handler: async (rc) => {
        const current = typeof rc.body.current === 'string' ? rc.body.current : '';
        const next = typeof rc.body.next === 'string' ? rc.body.next : '';
        const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(rc.user.id);
        if (!(await verifyPassword(current.slice(0, MAX_PASSWORD), row.password_hash))) throw new HttpError(400, 'Your current password is not right.');
        if (next.length < 8 || next.length > MAX_PASSWORD) throw new HttpError(400, 'Use at least 8 characters for your new password.');
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), rc.user.id);
        // Sign out every other device; keep this one. Any reset link still outstanding stops working.
        sessions.endOthers(rc.req, rc.user.id);
        db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(rc.user.id);
        if (mailer.enabled) void mailer.send({ to: rc.user.email, ...passwordChangedEmail({ name: rc.user.name, supportEmail: config.legal?.supportEmail, viaReset: false }) });
        return { ok: true };
      },
    },
  ];
}
