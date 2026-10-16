// Accounts: sign up, sign in, sign out, the current user, rename, password change, and password
// resets:
//
//   GET  /api/auth/forgot                    { emailEnabled, supportEmail }: how resets work here
//   POST /api/auth/forgot {email}            emails a single-use link when a provider is on. The
//                                            answer is the same whether or not the address has an
//                                            account; limited per IP and per address
//   POST /api/auth/reset/check {token}       { valid, email? } (the address masked) for the form
//   POST /api/auth/reset {token, password}   sets the password, signs out every device, signs
//                                            this browser in
//   POST /api/admin/users/:id/reset-link     admin only, audited: { url, expiresAt }, shown once
//                                            (how resets work with no email provider)
//
// Tokens are stored hashed and expire after an hour (server/auth/resets.mjs).

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { hashPassword, verifyPassword, dummyHash, MAX_PASSWORD } from '../auth/passwords.mjs';
import { EMAIL_RE, makeUserWire } from '../auth/userWire.mjs';
import { deviceLabel, deviceOf } from '../auth/device.mjs';
import { createPrefsStore } from '../account/prefs.mjs';
import { createMailer } from '../email/index.mjs';
import { passwordChangedEmail, resetEmail, signInAlertEmail } from '../email/messages.mjs';
import { createResetStore, maskEmail, RESET_MINUTES } from '../auth/resets.mjs';
import { audit } from '../lib/audit.mjs';
import { DISABLED_MESSAGE, isDisabled } from '../admin/status.mjs';

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const LOGIN_WINDOW = 15 * 60_000;
const LOGIN_MAX_PER_IP_EMAIL = 8;
/** Per email alone, so rotating addresses can't brute-force one account. */
const LOGIN_MAX_PER_EMAIL = 30;
const HOUR = 3_600_000;
/** Reset emails per address per hour, whoever asks: nobody can flood an inbox. */
const FORGOT_MAX_PER_EMAIL = 3;
/** One sign-in alert per device per account in this window (a day). */
export const ALERT_REPEAT_MS = 24 * HOUR;

/** "2026-10-14 20:15 UTC": an unambiguous time for an email. */
const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** @param {any} ctx */
export default function routes(ctx) {
  const { db, config, services, log } = ctx;
  const { sessions, limiter } = ctx.internal;
  const prefs = createPrefsStore(db, ctx.now);
  const mailer = createMailer({ config, fetch: ctx.fetch, log });
  const resets = createResetStore({ db, now: ctx.now });
  const resetUrl = (token) => `${config.PUBLIC_URL}/#/signin?reset=${token}`;
  for (const n of mailer.notes) log?.info?.(n);

  /**
   * `{ id, email, name, role, brands, plan, contractor }`: the shape every auth response
   * returns (server/auth/userWire.mjs).
   */
  const userWire = makeUserWire(services);

  // Roles are never granted by signing up or signing in. There is no email verification, so an
  // address proves nothing: an admin is made only on the server, with
  // `node server/scripts/make-admin.mjs <email>`. ADMIN_EMAILS grants and reserves nothing.

  /**
   * Email notifications > Sign-in alerts: when email is on and the person hasn't turned alerts
   * off, a sign-in from a device that isn't already signed in to the account is told about.
   * Decided before the new session exists; sent without waiting, so a sign-in never waits on the
   * provider and its timing says nothing about the account.
   *
   * A device is "known" only when its browser AND system are both recognised and a live session
   * of this account has the same pair. An unrecognised or missing User-Agent (empty names) is
   * always a new device: empty names would otherwise match every other unrecognised session and
   * every session created before account-001 recorded devices, so anyone could sign in silently
   * by sending no User-Agent. To keep that from mailing on every attempt, one device (by its
   * names, the unrecognisable one included) is alerted about at most once per account per
   * ALERT_REPEAT_MS (signin_alerts, account-002).
   */
  const alertNewDevice = (req, user) => {
    if (!mailer.enabled || !prefs.get(user.id).prefs.signInAlerts) return;
    const { browser, os } = deviceOf(req);
    const t = ctx.now();
    const known =
      !!browser &&
      !!os &&
      !!db.prepare("SELECT 1 FROM sessions WHERE user_id = ? AND browser = ? AND os = ? AND browser <> '' AND os <> '' AND expires_at >= ?").get(user.id, browser, os, t);
    if (known) return;
    const device = `${browser}|${os}`;
    if (db.prepare('SELECT 1 FROM signin_alerts WHERE user_id = ? AND device = ? AND sent_at > ?').get(user.id, device, t - ALERT_REPEAT_MS)) return;
    db.prepare('DELETE FROM signin_alerts WHERE user_id = ? AND sent_at <= ?').run(user.id, t - ALERT_REPEAT_MS);
    db.prepare('INSERT INTO signin_alerts (user_id, device, sent_at) VALUES (?, ?, ?)').run(user.id, device, t);
    const msg = signInAlertEmail({
      device: deviceLabel({ browser, os }),
      when: utc(t),
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
        // Only after the right password, so it says nothing about an address to anyone else.
        if (isDisabled(db, user.id)) throw new HttpError(403, DISABLED_MESSAGE, { code: 'account_disabled' });
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
        resets.revokeFor(rc.user.id);
        if (mailer.enabled) void mailer.send({ to: rc.user.email, ...passwordChangedEmail({ supportEmail: config.legal?.supportEmail, viaReset: false }) });
        return { ok: true };
      },
    },

    // ── password resets ─────────────────────────────────────────────────────
    {
      method: 'GET',
      path: '/api/auth/forgot',
      auth: 'none',
      handler: () => ({ emailEnabled: mailer.enabled, supportEmail: config.legal?.supportEmail ?? null }),
    },
    {
      method: 'POST',
      path: '/api/auth/forgot',
      auth: 'none',
      maxBytes: 2_048,
      rateLimit: { name: 'forgot-ip', max: 10, windowMs: HOUR, by: 'ip' },
      handler: (rc) => {
        const email = str(rc.body.email, 254).toLowerCase();
        if (!EMAIL_RE.test(email) || /[\r\n,;<>]/.test(email)) throw new HttpError(400, 'That email address does not look right.', { field: 'email' });
        // From here the answer is the same for every address: whether it has an account, whether
        // this address has had its 3 an hour, whether the provider accepts the message.
        if (!mailer.enabled) return { ok: true, emailEnabled: false };
        if (!limiter.hit(`forgot-email:${email}`, FORGOT_MAX_PER_EMAIL, HOUR).ok) return { ok: true, emailEnabled: true };
        const user = db.prepare('SELECT id, email, name FROM users WHERE email = ?').get(email);
        if (user) {
          const { token } = resets.issue(user.id);
          void mailer.send({ to: user.email, ...resetEmail({ url: resetUrl(token), minutes: RESET_MINUTES }) });
        }
        return { ok: true, emailEnabled: true };
      },
    },
    {
      method: 'POST',
      path: '/api/auth/reset/check',
      auth: 'none',
      maxBytes: 1_024,
      rateLimit: { name: 'reset-check', max: 60, windowMs: 15 * 60_000, by: 'ip' },
      handler: (rc) => {
        const found = resets.find(rc.body.token);
        return found ? { valid: true, email: maskEmail(found.email) } : { valid: false };
      },
    },
    {
      method: 'POST',
      path: '/api/auth/reset',
      auth: 'none',
      maxBytes: 4_096,
      rateLimit: { name: 'reset', max: 20, windowMs: 15 * 60_000, by: 'ip' },
      handler: async (rc) => {
        const token = rc.body.token;
        const password = typeof rc.body.password === 'string' ? rc.body.password : '';
        const gone = () => new HttpError(400, 'This reset link has expired or was already used. Ask for a new one.', { code: 'reset_invalid' });
        if (!resets.find(token)) throw gone();
        if (password.length < 8) throw new HttpError(400, 'Use at least 8 characters for your password.', { field: 'password' });
        if (password.length > MAX_PASSWORD) throw new HttpError(400, 'That password is too long.', { field: 'password' });
        const hash = await hashPassword(password);
        // Used up here, atomically: two tabs racing with one link can't both set a password.
        const userId = resets.consume(token);
        if (!userId) throw gone();
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
        resets.revokeFor(userId);
        sessions.endAll(userId);
        limiter.reset(`login-email:${db.prepare('SELECT email FROM users WHERE id = ?').get(userId)?.email ?? ''}`);
        const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(userId);
        // A browser signed in as someone else (a reset link opened there) leaves that session too;
        // the new session's cookie replaces it.
        sessions.end(rc.req, rc.res);
        sessions.start(rc.req, rc.res, userId);
        if (mailer.enabled) void mailer.send({ to: user.email, ...passwordChangedEmail({ supportEmail: config.legal?.supportEmail, viaReset: true }) });
        log?.info?.(`Account ${userId} reset its password with a link; every other session was signed out.`);
        return { user: userWire(user) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/users/:id/reset-link',
      auth: 'admin',
      body: 'none',
      params: { id: /^[A-Za-z0-9_-]{1,64}$/ },
      rateLimit: { name: 'admin-reset-link', max: 30, windowMs: HOUR, by: 'user' },
      handler: (rc) => {
        const target = db.prepare('SELECT id, email FROM users WHERE id = ?').get(rc.params.id);
        if (!target) throw new HttpError(404, 'That user does not exist.');
        const { token, expiresAt } = resets.issue(target.id, { createdBy: rc.user.id });
        // The link itself is never logged or audited: only that one was made, by whom, for whom.
        audit(db, { admin: rc.user, action: 'reset_link', targetUserId: target.id, targetEmail: target.email, detail: { expiresAt }, at: ctx.now() });
        rc.res.setHeader('Cache-Control', 'no-store');
        return { url: resetUrl(token), expiresAt };
      },
    },
  ];
}
