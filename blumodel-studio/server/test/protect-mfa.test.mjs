// Two-factor sign-in (audit 2026-10: "Gabe's admin account is protected by a password alone and can
// take over any account"). TOTP per RFC 6238 with node:crypto; required for admins before any admin
// route works, optional for everyone else; a 12-hour admin session; re-authentication within 10
// minutes for dangerous admin actions; reset and invite links need the code too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, startTestServer } from './helpers.mjs';
import { base32Encode, hotp, otpauthUrl, stepAt, totp, verifyTotp } from '../auth/totp.mjs';

const HOUR = 3_600_000;
const tokenOf = (url) => new URL(url.replace('/#/', '/')).searchParams.get('reset');
const secretOf = (otpauth) => new URL(otpauth).searchParams.get('secret');
/**
 * The next code from a real app: when the server already took this step's code, the server clock
 * moves on to the next 30-second step first (as a person would wait for the next code).
 */
const nextCode = (t, userId, secret) => {
  const last = t.db.prepare('SELECT last_step FROM user_mfa WHERE user_id = ?').get(userId)?.last_step ?? -1;
  if (stepAt(t.ctx.now()) <= last) t.setNow((last + 1) * 30_000 + 1_000);
  return hotp(secret, stepAt(t.ctx.now()));
};

test('TOTP: the RFC 6238 SHA-1 test vectors (6 digits), the window, replay, and the otpauth link', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  for (const [s, want] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037'], [20000000000, '353130']]) {
    assert.equal(totp(secret, s * 1000), want, `T=${s}`);
  }
  const ms = 1111111111 * 1000;
  const step = stepAt(ms);
  assert.equal(verifyTotp(secret, '050471', { ms }), step);
  assert.equal(verifyTotp(secret, hotp(secret, step - 1), { ms }), step - 1, 'one step of clock drift is fine');
  assert.equal(verifyTotp(secret, hotp(secret, step - 2), { ms }), null, 'two steps is not');
  assert.equal(verifyTotp(secret, '050471', { ms, lastStep: step }), null, 'a used code never works again');
  assert.equal(verifyTotp(secret, '12345', { ms }), null);
  const url = new URL(otpauthUrl({ account: 'gabe@x.test', secret }));
  assert.equal(url.protocol, 'otpauth:');
  assert.equal(url.host, 'totp');
  assert.equal(decodeURIComponent(url.pathname), '/BluModel Studio:gabe@x.test');
  assert.equal(url.searchParams.get('secret'), secret);
  assert.equal(url.searchParams.get('issuer'), 'BluModel Studio');
});

test('an admin with only a password gets no admin route: enrolment is forced, then the admin pages open', async () => {
  const t = await startTestServer();
  try {
    const victim = await t.user();
    const admin = await t.user({ role: 'admin', mfa: false });
    // The reproduced audit finding: a password session could mint a reset link for any account.
    const before = await admin.post(`/api/admin/users/${victim.id}/reset-link`);
    assert.equal(before.status, 403);
    assert.equal(before.body.code, 'mfa_enrol_required');
    assert.equal((await admin.get('/api/admin/tenants')).body.code, 'mfa_enrol_required');
    assert.equal((await admin.get('/api/studio/orders')).status, 403, 'studio routes too, for an admin');
    const me = (await admin.get('/api/auth/me')).body.user;
    assert.deepEqual(me.mfa, { enabled: false, required: true, verified: false });
    // An admin can't turn it off, even before having it.
    assert.equal((await admin.post('/api/account/mfa/disable', { password: admin.user.password })).body.code, 'mfa_required_for_admin');

    // The grace flow: set up with the password, confirm with a code, keep the recovery codes.
    const other = new Agent(t.url);
    assert.equal((await other.post('/api/auth/login', { email: admin.user.email, password: admin.user.password })).status, 200);
    assert.equal((await admin.post('/api/account/mfa/setup', { password: 'wrong password' })).status, 401);
    const setup = await admin.post('/api/account/mfa/setup', { password: admin.user.password });
    assert.equal(setup.status, 200);
    assert.equal(setup.headers.get('cache-control'), 'no-store');
    const secret = secretOf(setup.body.otpauthUrl);
    assert.equal(secret, setup.body.secret);
    assert.equal(setup.body.key.replace(/ /g, ''), secret);
    assert.equal((await admin.post('/api/account/mfa/enable', { code: '000000' })).status, 400);
    const on = await admin.post('/api/account/mfa/enable', { code: totp(secret, t.ctx.now()) });
    assert.equal(on.status, 200, on.text);
    assert.equal(on.body.recoveryCodes.length, 10);
    assert.equal(new Set(on.body.recoveryCodes).size, 10);
    assert.equal(on.body.enabled, true);
    // Stored as hashes only; the other device (password only) was signed out.
    const stored = t.db.prepare('SELECT code_hash FROM user_mfa_recovery WHERE user_id = ?').all(admin.id).map((r) => r.code_hash);
    for (const c of on.body.recoveryCodes) assert.ok(!stored.includes(c));
    assert.equal((await other.get('/api/auth/me')).body.user, null);
    // This session passed the code, so the admin pages open.
    assert.equal((await admin.get('/api/admin/tenants')).status, 200);
    assert.equal((await admin.get('/api/auth/me')).body.user.mfa.verified, true);
    assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'mfa_enabled'").get().n, 1);
    assert.equal((await admin.post('/api/account/mfa/setup', { password: admin.user.password })).body.code, 'mfa_enabled');
  } finally {
    await t.close();
  }
});

test('sign-in with 2FA: a ticket, then the code; wrong codes, replays, a used-up ticket and recovery codes', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin', mfa: false });
    const secret = secretOf((await admin.post('/api/account/mfa/setup', { password: admin.user.password })).body.otpauthUrl);
    const codes = (await admin.post('/api/account/mfa/enable', { code: totp(secret, t.ctx.now()) })).body.recoveryCodes;

    const b = new Agent(t.url);
    const step1 = await b.post('/api/auth/login', { email: admin.user.email, password: admin.user.password });
    assert.equal(step1.status, 200);
    assert.equal(step1.body.mfa, 'required');
    assert.equal(step1.body.user, undefined, 'no session from the password alone');
    assert.equal(b.cookies.has('blumodel_session'), false);
    assert.equal((await b.post('/api/auth/login/mfa', { ticket: step1.body.ticket, code: '123456' })).body.code, 'mfa_code_invalid');
    // The code just used to turn it on is spent.
    assert.equal((await b.post('/api/auth/login/mfa', { ticket: step1.body.ticket, code: totp(secret, t.ctx.now()) })).body.code, 'mfa_code_invalid', 'a code works once');
    const ok = await b.post('/api/auth/login/mfa', { ticket: step1.body.ticket, code: nextCode(t, admin.id, secret) });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.user.mfa.verified, true);
    assert.equal((await b.get('/api/admin/tenants')).status, 200);
    assert.equal((await b.post('/api/auth/login/mfa', { ticket: step1.body.ticket, code: nextCode(t, admin.id, secret) })).body.code, 'mfa_ticket_invalid', 'the ticket is gone');

    // Five wrong tries end a ticket.
    const c = new Agent(t.url);
    const s2 = await c.post('/api/auth/login', { email: admin.user.email, password: admin.user.password });
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login/mfa', { ticket: s2.body.ticket, code: '000000' })).status, 401);
    assert.equal((await c.post('/api/auth/login/mfa', { ticket: s2.body.ticket, code: nextCode(t, admin.id, secret) })).body.code, 'mfa_ticket_invalid');

    // A recovery code works once, and says how many are left.
    const d = new Agent(t.url);
    const s3 = await d.post('/api/auth/login', { email: admin.user.email, password: admin.user.password });
    const rec = await d.post('/api/auth/login/mfa', { ticket: s3.body.ticket, code: codes[0].toUpperCase() });
    assert.equal(rec.status, 200);
    assert.equal(rec.body.recoveryLeft, 9);
    const e = new Agent(t.url);
    const s4 = await e.post('/api/auth/login', { email: admin.user.email, password: admin.user.password });
    assert.equal((await e.post('/api/auth/login/mfa', { ticket: s4.body.ticket, code: codes[0] })).status, 401);
    // A ticket from the sales site is nothing on a showroom.
    const A = t.tenant({ name: 'Acme', slug: 'acme' });
    assert.equal((await new Agent(t.url, { host: A.host }).post('/api/auth/login/mfa', { ticket: s4.body.ticket, code: nextCode(t, admin.id, secret) })).body.code, 'mfa_ticket_invalid');
  } finally {
    await t.close();
  }
});

test('an admin session lasts 12 hours from sign-in however busy, and dangerous actions need the password and code again after 10 minutes', async () => {
  const t = await startTestServer();
  try {
    const victim = await t.user();
    const admin = await t.user({ role: 'admin' });
    admin.keepFresh = false;
    const t0 = Date.now();
    t.setNow(t0);
    assert.equal((await admin.post(`/api/admin/users/${victim.id}/reset-link`)).status, 200, 'just signed in: fine');
    t.setNow(t0 + 11 * 60_000);
    const stale = await admin.post(`/api/admin/users/${victim.id}/reset-link`);
    assert.equal(stale.status, 401);
    assert.equal(stale.body.code, 'reauth_required');
    assert.equal(stale.body.mfa, true);
    // Ordinary admin pages still open; the dangerous ones wait for "confirm it's you".
    assert.equal((await admin.get('/api/admin/tenants')).status, 200);
    for (const [m, p, b] of [
      ['post', `/api/admin/users/${victim.id}/delete`, {}],
      ['post', `/api/admin/users/${victim.id}/disable`, {}],
      ['post', `/api/admin/users/${victim.id}/comp`, { plan: 'contractor' }],
      ['post', `/api/admin/users/${victim.id}/mfa/reset`, undefined],
    ]) {
      assert.equal((await admin[m](p, b)).body.code, 'reauth_required', p);
    }
    assert.equal((await admin.post('/api/auth/reauth', { password: admin.user.password })).body.code, 'mfa_required', 'the code is needed too');
    assert.equal((await admin.post('/api/auth/reauth', { password: 'nope', code: nextCode(t, admin.id, admin.user.totpSecret) })).status, 401);
    const re = await admin.post('/api/auth/reauth', { password: admin.user.password, code: nextCode(t, admin.id, admin.user.totpSecret) });
    assert.equal(re.status, 200, re.text);
    assert.equal((await admin.post(`/api/admin/users/${victim.id}/reset-link`)).status, 200);

    // 12 hours after sign-in the session is over, even though it was used a minute ago.
    t.setNow(t0 + 12 * HOUR - 60_000);
    assert.equal((await admin.get('/api/admin/tenants')).status, 200);
    t.setNow(t0 + 12 * HOUR + 1_000);
    assert.equal((await admin.get('/api/admin/tenants')).status, 401);
    assert.equal((await admin.get('/api/auth/me')).body.user, null);
    // A customer's session is the ordinary 30 sliding days.
    assert.equal((await victim.get('/api/auth/me')).body.user?.id, victim.id);
  } finally {
    t.setNow(null);
    await t.close();
  }
});

test('optional 2FA for a showroom owner; a reset link (the mailbox alone) no longer opens an account with 2FA; an admin can clear a lost 2FA', async () => {
  const t = await startTestServer();
  try {
    const A = t.tenant({ name: 'Acme', slug: 'acme' });
    const owner = await t.showroomUser(A, { role: 'owner', password: 'owner password 1' });
    assert.deepEqual((await owner.get('/api/account/mfa')).body, { enabled: false, enabledAt: null, recoveryLeft: 0, required: false, verified: false });
    const secret = secretOf((await owner.post('/api/account/mfa/setup', { password: 'owner password 1' })).body.otpauthUrl);
    assert.equal((await owner.post('/api/account/mfa/enable', { code: totp(secret, t.ctx.now()) })).status, 200);
    assert.equal((await owner.get('/api/workspace/team')).status, 200);
    // Signing in on the showroom now takes the code.
    const b = new Agent(t.url, { host: A.host });
    const s1 = await b.post('/api/auth/login', { email: owner.user.email, password: 'owner password 1' });
    assert.equal(s1.body.mfa, 'required');
    assert.equal((await b.post('/api/auth/login/mfa', { ticket: s1.body.ticket, code: nextCode(t, owner.id, secret) })).status, 200);
    assert.equal((await b.get('/api/workspace/team')).status, 200);

    // A reset link (emailed, or made by an admin) needs the code as well.
    const admin = await t.user({ role: 'admin' });
    const link = await admin.post(`/api/admin/users/${owner.id}/reset-link`);
    const token = tokenOf(link.body.url);
    const c = new Agent(t.url, { host: A.host });
    assert.equal((await c.post('/api/auth/reset/check', { token })).body.mfa, true);
    const noCode = await c.post('/api/auth/reset', { token, password: 'taken over 123' });
    assert.equal(noCode.status, 401);
    assert.equal(noCode.body.code, 'mfa_required');
    assert.equal((await new Agent(t.url, { host: A.host }).post('/api/auth/login', { email: owner.user.email, password: 'owner password 1' })).body.mfa, 'required', 'the password did not change');
    const withCode = await c.post('/api/auth/reset', { token, password: 'a new password 1', code: nextCode(t, owner.id, secret) });
    assert.equal(withCode.status, 200, withCode.text);
    assert.equal(withCode.body.user.mfa.verified, true);

    // Turning it off takes the password and a code.
    assert.equal((await c.post('/api/account/mfa/disable', { password: 'a new password 1' })).body.code, 'mfa_required');
    const off = await c.post('/api/account/mfa/disable', { password: 'a new password 1', code: nextCode(t, owner.id, secret) });
    assert.equal(off.status, 200);
    assert.equal(off.body.enabled, false);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM user_mfa_recovery WHERE user_id = ?').get(owner.id).n, 0);

    // A lost phone and lost codes: an admin turns it off (re-authenticated, audited) and signs them out.
    const secret2 = secretOf((await c.post('/api/account/mfa/setup', { password: 'a new password 1' })).body.otpauthUrl);
    await c.post('/api/account/mfa/enable', { code: nextCode(t, owner.id, secret2) });
    const cleared = await admin.post(`/api/admin/users/${owner.id}/mfa/reset`);
    assert.equal(cleared.status, 200, cleared.text);
    assert.equal((await c.get('/api/auth/me')).body.user, null);
    assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'mfa_reset' AND target_user_id = ?").get(owner.id).n, 1);
    assert.ok((await new Agent(t.url, { host: A.host }).post('/api/auth/login', { email: owner.user.email, password: 'a new password 1' })).body.user);
  } finally {
    await t.close();
  }
});

test('make-admin.mjs says 2FA enrolment is required at the first sign-in, and --reset-2fa clears it', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { openDb } = await import('../db/index.mjs');
  const { migrate } = await import('../db/migrate.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-mfa-'));
  try {
    const file = path.join(dir, 'blumodel.db');
    const db = openDb(file);
    migrate(db);
    db.prepare("INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'gabe@x.test', 'G', 'x', 1)").run();
    db.prepare("INSERT INTO user_mfa (user_id, secret, enabled_at, last_step, created_at) VALUES ('u1', 'JBSWY3DPEHPK3PXP', 1, -1, 1)").run();
    db.close();
    const script = path.resolve(import.meta.dirname, '../scripts/make-admin.mjs');
    const out1 = execFileSync(process.execPath, ['--no-warnings', script, 'gabe@x.test', '--db', file], { encoding: 'utf8' });
    assert.match(out1, /is now an admin/);
    assert.doesNotMatch(out1, /REQUIRED/, 'already enrolled');
    const out2 = execFileSync(process.execPath, ['--no-warnings', script, 'gabe@x.test', '--db', file, '--reset-2fa'], { encoding: 'utf8' });
    assert.match(out2, /turned off/);
    assert.match(out2, /Two-factor sign-in is REQUIRED for admins/);
    const db2 = openDb(file);
    assert.equal(db2.prepare('SELECT COUNT(*) AS n FROM user_mfa').get().n, 0);
    db2.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
