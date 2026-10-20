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
//   POST /api/auth/join/check {token}        showroom: { valid, email?, role?, showroom? } for a team
//                                            invite held for an existing account (emailed link)
//   POST /api/auth/join {token, password}    showroom: the account's own password accepts it; joins
//                                            the team and signs this browser in. Never sets a password
//
// Tokens are stored hashed and expire after an hour (server/auth/resets.mjs).
//
// Two-factor sign-in (server/auth/mfa.mjs; required for admins, optional for everyone else):
//   POST /api/auth/login                     with 2FA on: { mfa: 'required', ticket, expiresAt }, no session
//   POST /api/auth/login/mfa {ticket, code}  the 6-digit code or a recovery code -> { user } (session passed 2FA)
//   POST /api/auth/reauth {password, code?}  "confirm it's you" for routes marked reauth (10 minutes)
//   GET  /api/account/mfa                    { enabled, enabledAt, recoveryLeft, required, verified }
//   POST /api/account/mfa/setup {password}   { secret, key, otpauthUrl } (shown once; 15 minutes to confirm)
//   POST /api/account/mfa/enable {code}      { recoveryCodes (10, shown once), ... }; other devices signed out
//   POST /api/account/mfa/recovery-codes {password, code}   10 new codes, the old ones stop working
//   POST /api/account/mfa/disable {password, code}          not for admins (409 mfa_required_for_admin)
//   POST /api/admin/users/:id/mfa/reset      admin, reauth, audited: 2FA off and signed out everywhere
// A reset link or a team-invite link for an account with 2FA on needs the code as well.

import crypto from 'node:crypto';
import { HttpError } from '../http/respond.mjs';
import { hashPassword, verifyPassword, dummyHash, MAX_PASSWORD } from '../auth/passwords.mjs';
import { EMAIL_RE, makeUserWire } from '../auth/userWire.mjs';
import { emailDomainProblem, emailProblem } from '../lib/emailCheck.mjs';
import { deviceLabel, deviceOf } from '../auth/device.mjs';
import { createPrefsStore } from '../account/prefs.mjs';
import { createMailer } from '../email/index.mjs';
import { passwordChangedEmail, resetEmail, signInAlertEmail } from '../email/messages.mjs';
import { createResetStore, maskEmail, RESET_MINUTES } from '../auth/resets.mjs';
import { SETUP_MINUTES } from '../auth/mfa.mjs';
import { groupKey, newRecoveryCodes } from '../auth/totp.mjs';
import { audit } from '../lib/audit.mjs';
import { DISABLED_MESSAGE, isDisabled } from '../admin/status.mjs';
import { addressTaken, findSiteUser, siteAllows } from '../tenancy/accounts.mjs';
import { requestOrigin } from '../tenancy/hosts.mjs';

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
  // Accounts belong to a site (docs/handoff/tenancy.md): a showroom's links use its own address
  // (from the database, never the request's Host); the sales site's use PUBLIC_URL.
  const siteOrigin = (rc, tenantId = rc.site.tenantId) => {
    if (!tenantId) return config.PUBLIC_URL;
    const t = services.tenants.get(tenantId);
    return services.tenants.originOf(t, requestOrigin(rc.req, config));
  };
  const resetUrl = (token, rc, tenantId) => `${siteOrigin(rc, tenantId)}/#/signin?reset=${token}`;
  for (const n of mailer.notes) log?.info?.(n);

  /**
   * `{ id, email, name, role, brands, plan, contractor }`: the shape every auth response
   * returns (server/auth/userWire.mjs).
   */
  const baseWire = makeUserWire(services);
  /**
   * On a showroom the user also carries `showroom: { tenantId, role: 'owner'|'staff'|null }` (role
   * null for a visitor); on the sales site `showroom` is null.
   */
  const userWire = (u, rc, { verified } = {}) => {
    const w = baseWire(u);
    const tid = rc?.site?.tenantId ?? null;
    return {
      ...w,
      ...(tid ? { role: 'customer' } : {}),
      showroom: tid ? { tenantId: tid, role: services.tenants.roleOf(tid, u.id) } : null,
      mfa: mfaWire(u.id, rc, verified ?? (rc?.user?.id === u.id ? !!rc.user.session?.mfa : false)),
    };
  };
  const { mfa } = services;
  /** Required for a BluModel admin's own (sales-site) account. */
  const mfaRequired = (userId, rc) => !rc?.site?.tenantId && db.prepare('SELECT role FROM users WHERE id = ?').get(userId)?.role === 'admin';
  /** `{ enabled, required, verified }`: 2FA on the account, whether it must be, and whether this session passed it. */
  const mfaWire = (userId, rc, verified) => ({ enabled: mfa.enabled(userId), required: mfaRequired(userId, rc), verified: !!verified });
  const codeOf = (b) => (typeof b?.code === 'string' ? b.code.trim().slice(0, 32) : '');
  /** For an account with 2FA on: the code in the body must be right (401 mfa_required / mfa_code_invalid). */
  const requireCode = (userId, body) => {
    if (!mfa.enabled(userId)) return null;
    const code = codeOf(body);
    if (!code) throw new HttpError(401, 'Enter the code from your authenticator app.', { code: 'mfa_required', field: 'code' });
    const how = mfa.verify(userId, code);
    if (!how) throw new HttpError(401, 'That code isn’t right. Use the newest code from your app, or a recovery code.', { code: 'mfa_code_invalid', field: 'code' });
    return how;
  };


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
  const alertNewDevice = (rc, user) => {
    const req = rc.req;
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
      settingsUrl: `${siteOrigin(rc)}/#/account`,
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
        const emailBad = emailProblem(email) || (await emailDomainProblem(email));
        if (emailBad) throw new HttpError(400, emailBad, { field: 'email' });
        if (password.length < 8) throw new HttpError(400, 'Use at least 8 characters for your password.');
        if (password.length > MAX_PASSWORD) throw new HttpError(400, 'That password is too long.');
        const taken = () => new HttpError(409, 'An account with that email already exists. Try signing in.');
        // An account is made on this site (a showroom's visitors are its own; the sales site's are ours).
        const tenantId = rc.site.tenantId;
        // A showroom still being set up isn't open to the public: its team is invited, nobody signs up.
        if (rc.site.tenant?.status === 'setup') throw new HttpError(403, 'This showroom isn’t open yet.', { code: 'showroom_not_open' });
        // On a showroom an address a sales-site team member signs in with is taken too.
        if (addressTaken(db, email, tenantId)) throw taken();
        const hash = await hashPassword(password);
        const id = crypto.randomUUID();
        try {
          db.prepare('INSERT INTO users (id, email, name, password_hash, created_at, tenant_id) VALUES (?, ?, ?, ?, ?, ?)').run(id, email, name, hash, ctx.now(), tenantId);
        } catch (err) {
          if (/UNIQUE/i.test(String(err?.message))) throw taken();
          throw err;
        }
        sessions.start(rc.req, rc.res, id);
        rc.send(201, { user: userWire({ id, email, name, role: 'customer' }, rc) });
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
        // Budgets are per site: a lockout on one showroom says nothing about an address elsewhere.
        const site = rc.site.tenantId ?? 'sales';
        const keyPair = `login:${site}|${rc.ip}|${email}`;
        const keyEmail = `login-email:${site}|${email}`;
        if (limiter.blocked(keyPair, LOGIN_MAX_PER_IP_EMAIL, LOGIN_WINDOW) || limiter.blocked(keyEmail, LOGIN_MAX_PER_EMAIL, LOGIN_WINDOW)) {
          const err = new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
          err.retryAfter = 60;
          throw err;
        }
        const user = findSiteUser(db, email, rc.site.tenantId, 'id, email, name, role, password_hash');
        const ok = (await verifyPassword(password.slice(0, MAX_PASSWORD), user ? user.password_hash : await dummyHash())) && !!user;
        if (!ok) {
          limiter.hit(keyPair, Infinity, LOGIN_WINDOW);
          limiter.hit(keyEmail, Infinity, LOGIN_WINDOW);
          throw new HttpError(401, 'That email and password do not match.');
        }
        limiter.reset(keyPair);
        // Only after the right password, so it says nothing about an address to anyone else.
        if (isDisabled(db, user.id)) throw new HttpError(403, DISABLED_MESSAGE, { code: 'account_disabled' });
        // Two-factor sign-in: no session yet, only a 5-minute ticket for POST /api/auth/login/mfa.
        if (mfa.enabled(user.id)) {
          const { ticket, expiresAt } = mfa.issueTicket(user.id, rc.site.tenantId);
          rc.res.setHeader('Cache-Control', 'no-store');
          return { mfa: 'required', ticket, expiresAt };
        }
        alertNewDevice(rc, user);
        sessions.start(rc.req, rc.res, user.id);
        return { user: userWire(user, rc, { verified: false }) };
      },
    },
    {
      method: 'POST',
      path: '/api/auth/login/mfa',
      auth: 'none',
      maxBytes: 1_024,
      rateLimit: { name: 'login-mfa', max: 30, windowMs: LOGIN_WINDOW, by: 'ip' },
      handler: (rc) => {
        // The ticket says the password was right moments ago on this site; it allows 5 tries.
        const userId = mfa.ticketUser(rc.body.ticket, rc.site.tenantId);
        if (!userId) throw new HttpError(401, 'That sign-in took too long or had too many tries. Sign in again.', { code: 'mfa_ticket_invalid' });
        const how = mfa.verify(userId, codeOf(rc.body));
        if (!how) throw new HttpError(401, 'That code isn’t right. Use the newest code from your app, or a recovery code.', { code: 'mfa_code_invalid', field: 'code' });
        mfa.endTicket(rc.body.ticket);
        if (isDisabled(db, userId)) throw new HttpError(403, DISABLED_MESSAGE, { code: 'account_disabled' });
        const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(userId);
        alertNewDevice(rc, user);
        sessions.start(rc.req, rc.res, userId, { mfa: true });
        return { user: userWire(user, rc, { verified: true }), ...(how === 'recovery' ? { recoveryLeft: mfa.status(userId).recoveryLeft } : {}) };
      },
    },
    {
      method: 'POST',
      path: '/api/auth/reauth',
      maxBytes: 2_048,
      rateLimit: { name: 'reauth', max: 10, windowMs: 15 * 60_000, by: 'user' },
      handler: async (rc) => {
        // "Confirm it's you" before a dangerous admin action (route reauth: true).
        const password = typeof rc.body.password === 'string' ? rc.body.password : '';
        const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(rc.user.id);
        if (!(await verifyPassword(password.slice(0, MAX_PASSWORD), row.password_hash))) throw new HttpError(401, 'That password isn’t right.', { code: 'password_invalid', field: 'password' });
        const how = requireCode(rc.user.id, rc.body);
        if (how) sessions.markMfa(rc.req);
        else sessions.markAuth(rc.req);
        return { ok: true, until: ctx.now() + config.REAUTH_MINUTES * 60_000 };
      },
    },

    // ── two-factor sign-in (Account settings > Security) ─────────────────────
    {
      method: 'GET',
      path: '/api/account/mfa',
      handler: (rc) => ({ ...mfa.status(rc.user.id), required: mfaRequired(rc.user.id, rc), verified: !!rc.user.session?.mfa }),
    },
    {
      method: 'POST',
      path: '/api/account/mfa/setup',
      maxBytes: 2_048,
      rateLimit: { name: 'mfa-setup', max: 10, windowMs: 15 * 60_000, by: 'user' },
      handler: async (rc) => {
        if (mfa.enabled(rc.user.id)) throw new HttpError(409, 'Two-factor sign-in is already on.', { code: 'mfa_enabled' });
        const password = typeof rc.body.password === 'string' ? rc.body.password : '';
        const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(rc.user.id);
        if (!(await verifyPassword(password.slice(0, MAX_PASSWORD), row.password_hash))) throw new HttpError(401, 'That password isn’t right.', { code: 'password_invalid', field: 'password' });
        const { secret, otpauthUrl: url } = mfa.begin(rc.user.id, rc.user.email);
        rc.res.setHeader('Cache-Control', 'no-store');
        // Shown once, to set up the app; never logged.
        return { secret, key: groupKey(secret), otpauthUrl: url, expiresInMinutes: SETUP_MINUTES };
      },
    },
    {
      method: 'POST',
      path: '/api/account/mfa/enable',
      maxBytes: 1_024,
      rateLimit: { name: 'mfa-enable', max: 20, windowMs: 15 * 60_000, by: 'user' },
      handler: (rc) => {
        const codes = mfa.confirm(rc.user.id, codeOf(rc.body));
        if (!codes) throw new HttpError(400, 'That code isn’t right, or the setup took more than 15 minutes. Check the time on your phone and try the newest code.', { code: 'mfa_code_invalid', field: 'code' });
        // This session just passed a code; every other device signed in with the password alone is signed out.
        sessions.markMfa(rc.req);
        const others = sessions.endOthers(rc.req, rc.user.id);
        if (mfaRequired(rc.user.id, rc)) audit(db, { admin: rc.user, action: 'mfa_enabled', targetUserId: rc.user.id, targetEmail: rc.user.email, detail: { signedOut: others }, at: ctx.now() });
        rc.res.setHeader('Cache-Control', 'no-store');
        return { recoveryCodes: codes, ...mfa.status(rc.user.id), required: mfaRequired(rc.user.id, rc), verified: true };
      },
    },
    {
      method: 'POST',
      path: '/api/account/mfa/recovery-codes',
      maxBytes: 2_048,
      rateLimit: { name: 'mfa-recovery', max: 10, windowMs: 15 * 60_000, by: 'user' },
      handler: async (rc) => {
        const password = typeof rc.body.password === 'string' ? rc.body.password : '';
        const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(rc.user.id);
        if (!(await verifyPassword(password.slice(0, MAX_PASSWORD), row.password_hash))) throw new HttpError(401, 'That password isn’t right.', { code: 'password_invalid', field: 'password' });
        if (!mfa.enabled(rc.user.id)) throw new HttpError(409, 'Two-factor sign-in is off.', { code: 'mfa_off' });
        requireCode(rc.user.id, rc.body);
        rc.res.setHeader('Cache-Control', 'no-store');
        return { recoveryCodes: mfa.setRecovery(rc.user.id, newRecoveryCodes()), ...mfa.status(rc.user.id) };
      },
    },
    {
      method: 'POST',
      path: '/api/account/mfa/disable',
      maxBytes: 2_048,
      rateLimit: { name: 'mfa-disable', max: 10, windowMs: 15 * 60_000, by: 'user' },
      handler: async (rc) => {
        if (mfaRequired(rc.user.id, rc)) throw new HttpError(409, 'Admins must keep two-factor sign-in on.', { code: 'mfa_required_for_admin' });
        const password = typeof rc.body.password === 'string' ? rc.body.password : '';
        const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(rc.user.id);
        if (!(await verifyPassword(password.slice(0, MAX_PASSWORD), row.password_hash))) throw new HttpError(401, 'That password isn’t right.', { code: 'password_invalid', field: 'password' });
        if (!mfa.enabled(rc.user.id)) return { ...mfa.status(rc.user.id), required: false, verified: false };
        requireCode(rc.user.id, rc.body);
        mfa.disable(rc.user.id);
        return { ...mfa.status(rc.user.id), required: false, verified: false };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/users/:id/mfa/reset',
      auth: 'admin',
      reauth: true,
      body: 'none',
      params: { id: /^[A-Za-z0-9_-]{1,64}$/ },
      handler: (rc) => {
        // Someone who lost both their phone and their recovery codes: 2FA off, every session ended.
        const target = db.prepare('SELECT id, email FROM users WHERE id = ?').get(rc.params.id);
        if (!target) throw new HttpError(404, 'That user does not exist.');
        if (target.id === rc.user.id) throw new HttpError(409, 'Use Account settings to change your own two-factor sign-in.');
        mfa.disable(target.id);
        const ended = sessions.endAll(target.id);
        audit(db, { admin: rc.user, action: 'mfa_reset', targetUserId: target.id, targetEmail: target.email, detail: { signedOut: ended }, at: ctx.now() });
        return { ok: true };
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
      handler: (rc) => ({ user: rc.user ? userWire(rc.user, rc) : null }),
    },
    {
      method: 'PATCH',
      path: '/api/auth/me',
      handler: (rc) => {
        const name = str(rc.body.name, 80);
        if (!name) throw new HttpError(400, 'Name cannot be empty.');
        db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, rc.user.id);
        return { user: userWire({ ...rc.user, name }, rc) };
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
        if (!limiter.hit(`forgot-email:${rc.site.tenantId ?? 'sales'}|${email}`, FORGOT_MAX_PER_EMAIL, HOUR).ok) return { ok: true, emailEnabled: true };
        const user = findSiteUser(db, email, rc.site.tenantId, 'id, email, name');
        if (user) {
          const { token } = resets.issue(user.id);
          void mailer.send({ to: user.email, ...resetEmail({ url: resetUrl(token, rc), minutes: RESET_MINUTES }) });
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
        // A link works only on the site its account belongs to.
        return found && siteAllows(db, found.userId, rc.site.tenantId) ? { valid: true, email: maskEmail(found.email), mfa: mfa.enabled(found.userId) } : { valid: false };
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
        const live = resets.find(token);
        if (!live || !siteAllows(db, live.userId, rc.site.tenantId)) throw gone();
        if (password.length < 8) throw new HttpError(400, 'Use at least 8 characters for your password.', { field: 'password' });
        if (password.length > MAX_PASSWORD) throw new HttpError(400, 'That password is too long.', { field: 'password' });
        // With 2FA on, the mailbox alone doesn't open the account: the code is needed as well.
        const how = requireCode(live.userId, rc.body);
        const hash = await hashPassword(password);
        // Used up here, atomically: two tabs racing with one link can't both set a password.
        const userId = resets.consume(token);
        if (!userId) throw gone();
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
        resets.revokeFor(userId);
        // The link reached the address, so a team invite held for this account (tenancy-007) is accepted.
        services.tenants.acceptInvites(userId);
        sessions.endAll(userId);
        limiter.reset(`login-email:${rc.site.tenantId ?? 'sales'}|${db.prepare('SELECT email FROM users WHERE id = ?').get(userId)?.email ?? ''}`);
        const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(userId);
        // A browser signed in as someone else (a reset link opened there) leaves that session too;
        // the new session's cookie replaces it.
        sessions.end(rc.req, rc.res);
        sessions.start(rc.req, rc.res, userId, { mfa: !!how });
        if (mailer.enabled) void mailer.send({ to: user.email, ...passwordChangedEmail({ supportEmail: config.legal?.supportEmail, viaReset: true }) });
        log?.info?.(`Account ${userId} reset its password with a link; every other session was signed out.`);
        return { user: userWire(user, rc, { verified: !!how }) };
      },
    },
    // ── accepting a team invite held for an existing account (protect-001) ──
    {
      method: 'POST',
      path: '/api/auth/join/check',
      auth: 'none',
      hosts: 'showroom',
      maxBytes: 1_024,
      rateLimit: { name: 'join-check', max: 60, windowMs: 15 * 60_000, by: 'ip' },
      handler: (rc) => {
        const inv = services.tenants.findInviteToken(rc.site.tenantId, rc.body.token);
        return inv ? { valid: true, email: maskEmail(inv.email), role: inv.role, showroom: rc.site.tenant?.name ?? '' } : { valid: false };
      },
    },
    {
      method: 'POST',
      path: '/api/auth/join',
      auth: 'none',
      hosts: 'showroom',
      maxBytes: 4_096,
      rateLimit: { name: 'join', max: 20, windowMs: 15 * 60_000, by: 'ip' },
      handler: async (rc) => {
        // The link was emailed to the address, and the password is the account's own: together
        // they prove both. Nothing about the account changes except that it joins the team.
        const inv = services.tenants.findInviteToken(rc.site.tenantId, rc.body.token);
        const password = typeof rc.body.password === 'string' ? rc.body.password : '';
        if (!inv) throw new HttpError(400, 'This invitation has expired or was withdrawn. Ask the showroom for a new one.', { code: 'invite_invalid' });
        const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(inv.userId);
        const keyEmail = `login-email:${rc.site.tenantId}|${inv.email}`;
        if (limiter.blocked(keyEmail, LOGIN_MAX_PER_EMAIL, LOGIN_WINDOW)) {
          const err = new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
          err.retryAfter = 60;
          throw err;
        }
        if (!row || !(await verifyPassword(password.slice(0, MAX_PASSWORD), row.password_hash))) {
          limiter.hit(keyEmail, Infinity, LOGIN_WINDOW);
          throw new HttpError(401, 'That password isn’t right for this account.', { field: 'password' });
        }
        if (isDisabled(db, inv.userId)) throw new HttpError(403, DISABLED_MESSAGE, { code: 'account_disabled' });
        const how = requireCode(inv.userId, rc.body);
        ctx.tx(() => services.tenants.acceptInvite(inv.tenantId, inv.userId));
        sessions.end(rc.req, rc.res);
        sessions.start(rc.req, rc.res, inv.userId, { mfa: !!how });
        const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(inv.userId);
        return { user: userWire(user, rc, { verified: !!how }) };
      },
    },
    {
      method: 'POST',
      path: '/api/admin/users/:id/reset-link',
      auth: 'admin',
      reauth: true,
      body: 'none',
      params: { id: /^[A-Za-z0-9_-]{1,64}$/ },
      rateLimit: { name: 'admin-reset-link', max: 30, windowMs: HOUR, by: 'user' },
      handler: (rc) => {
        const target = db.prepare('SELECT id, email, tenant_id FROM users WHERE id = ?').get(rc.params.id);
        if (!target) throw new HttpError(404, 'That user does not exist.');
        const { token, expiresAt } = resets.issue(target.id, { createdBy: rc.user.id });
        // The link itself is never logged or audited: only that one was made, by whom, for whom.
        audit(db, { admin: rc.user, action: 'reset_link', targetUserId: target.id, targetEmail: target.email, detail: { expiresAt }, at: ctx.now() });
        rc.res.setHeader('Cache-Control', 'no-store');
        // A showroom visitor's or staff member's link opens on their showroom.
        return { url: resetUrl(token, rc, target.tenant_id ?? null), expiresAt };
      },
    },
  ];
}
