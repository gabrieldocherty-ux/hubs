// Forgot password (the 'account' package): single-use reset links, hashed at rest, an hour long,
// emailed when a provider is configured and made by an admin when not. The answer to "email me a
// link" never says whether an address has an account. Fake provider keys only and a mocked fetch:
// nothing here talks to Resend or Postmark.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestServer } from './helpers.mjs';
import { maskEmail, RESET_MINUTES } from '../auth/resets.mjs';

const RESEND_FAKE = 're_FAKE_FOR_TESTS';
const POSTMARK_FAKE = 'pm_FAKE_FOR_TESTS';
const EMAIL_ENV = { RESEND_API_KEY: RESEND_FAKE, EMAIL_FROM: 'BluModel Studio <hello@blumodel.test>', SUPPORT_EMAIL: 'help@blumodel.test' };
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const settle = () => new Promise((r) => setTimeout(r, 30));

function mockFetch(status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ id: 'msg_1' }), { status, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

function captureLog() {
  const lines = [];
  const put = (...a) => lines.push(a.map(String).join(' '));
  return { lines, info: put, warn: put, error: put };
}

/** The token in the last reset email sent to `to`. */
function tokenFrom(fetch, to) {
  const call = [...fetch.calls].reverse().find((c) => (c.body?.to?.[0] ?? c.body?.To) === to && /Reset your/.test(c.body?.subject ?? c.body?.Subject));
  assert.ok(call, `a reset email to ${to}`);
  const m = /#\/signin\?reset=([A-Za-z0-9_-]{43})/.exec(call.body.text ?? call.body.TextBody);
  assert.ok(m, 'the email carries a reset link');
  return m[1];
}

test('maskEmail shows enough to recognise the address, no more', () => {
  assert.equal(maskEmail('jane.doe@gmail.com'), 'j•••@gmail.com');
  assert.equal(RESET_MINUTES, 60);
});

test('no email provider: the page says to contact support, nothing is stored or sent', async () => {
  const fetch = mockFetch();
  const t = await startTestServer({ env: { SUPPORT_EMAIL: 'help@blumodel.test' }, fetch });
  try {
    const ann = await t.user();
    const opts = await t.agent().get('/api/auth/forgot');
    assert.equal(opts.status, 200);
    assert.deepEqual(opts.body, { emailEnabled: false, supportEmail: 'help@blumodel.test' });
    const r = await t.agent().post('/api/auth/forgot', { email: ann.user.email });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body, { ok: true, emailEnabled: false });
    await settle();
    assert.equal(fetch.calls.length, 0);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n, 0);
  } finally {
    await t.close();
  }
});

test('forgot: CSRF-gated, validated, and the same answer whether or not the address has an account', async () => {
  const fetch = mockFetch();
  const log = captureLog();
  const t = await startTestServer({ env: EMAIL_ENV, fetch, log });
  try {
    const ann = await t.user({ email: 'ann.reset@test.blumodel' });
    assert.deepEqual((await t.agent().get('/api/auth/forgot')).body, { emailEnabled: true, supportEmail: 'help@blumodel.test' });
    assert.equal((await t.agent().post('/api/auth/forgot', { email: ann.user.email }, { csrf: false })).status, 403);
    assert.equal((await t.agent().post('/api/auth/forgot', { email: 'not an address' })).status, 400);
    assert.equal((await t.agent().post('/api/auth/forgot', { email: 'a@b.test\r\nBcc: x@y.test' })).status, 400);

    const known = await t.agent().post('/api/auth/forgot', { email: '  ANN.reset@test.blumodel ' });
    const unknown = await t.agent().post('/api/auth/forgot', { email: 'nobody@test.blumodel' });
    assert.equal(known.status, 200);
    assert.equal(unknown.status, known.status);
    assert.deepEqual(unknown.body, known.body);
    assert.deepEqual(known.body, { ok: true, emailEnabled: true });
    await settle();

    // One message, to the account's address, from the provider's endpoint with the fake key.
    assert.equal(fetch.calls.length, 1);
    const [call] = fetch.calls;
    assert.equal(call.url, 'https://api.resend.com/emails');
    assert.equal(call.init.headers.Authorization, `Bearer ${RESEND_FAKE}`);
    assert.deepEqual(call.body.to, ['ann.reset@test.blumodel']);
    const token = tokenFrom(fetch, 'ann.reset@test.blumodel');
    assert.ok(call.body.text.startsWith('Hello,'), 'plain words, a neutral greeting');
    assert.ok(call.body.text.includes(`${t.config.PUBLIC_URL}/#/signin?reset=${token}`), 'the link is on PUBLIC_URL');

    // Hashed at rest: the database never holds the token itself.
    const rows = t.db.prepare('SELECT token_hash, expires_at, created_at, created_by, used_at FROM password_resets').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_hash, sha256(token));
    assert.notEqual(rows[0].token_hash, token);
    assert.equal(rows[0].expires_at - rows[0].created_at, 60 * 60_000);
    assert.equal(rows[0].created_by, null);

    // Nothing secret reached the log.
    const all = log.lines.join('\n');
    for (const secret of [RESEND_FAKE, token, 'ann.reset@test.blumodel']) assert.ok(!all.includes(secret), `log must not contain ${secret.slice(0, 6)}…`);
  } finally {
    await t.close();
  }
});

test('reset: a live link sets the password, signs out every device, signs this browser in, and works once', async () => {
  const fetch = mockFetch();
  const t = await startTestServer({ env: EMAIL_ENV, fetch });
  try {
    const ann = await t.user({ email: 'ann.once@test.blumodel' });
    // A second signed-in device.
    const phone = t.agent();
    assert.equal((await phone.post('/api/auth/login', { email: ann.user.email, password: ann.user.password })).status, 200);

    await t.agent().post('/api/auth/forgot', { email: ann.user.email });
    await settle();
    const token = tokenFrom(fetch, ann.user.email);

    const browser = t.agent();
    const check = await browser.post('/api/auth/reset/check', { token });
    assert.equal(check.status, 200);
    assert.deepEqual(check.body, { valid: true, email: 'a•••@test.blumodel' });
    assert.equal((await browser.post('/api/auth/reset', { token, password: 'new pass word' }, { csrf: false })).status, 403);
    const short = await browser.post('/api/auth/reset', { token, password: 'short' });
    assert.equal(short.status, 400);
    assert.equal(short.body.field, 'password');

    const done = await browser.post('/api/auth/reset', { token, password: 'a brand new password' });
    assert.equal(done.status, 200, done.text);
    assert.equal(done.body.user.email, ann.user.email);
    assert.equal(done.body.user.role, 'customer');
    assert.equal((await browser.get('/api/auth/me')).body.user.id, ann.id, 'this browser is signed in');
    assert.equal((await ann.get('/api/auth/me')).body.user, null, 'the old session is gone');
    assert.equal((await phone.get('/api/auth/me')).body.user, null, 'every other device is signed out');

    assert.equal((await t.agent().post('/api/auth/login', { email: ann.user.email, password: ann.user.password })).status, 401, 'the old password is gone');
    assert.equal((await t.agent().post('/api/auth/login', { email: ann.user.email, password: 'a brand new password' })).status, 200);

    // Once only.
    const again = await t.agent().post('/api/auth/reset', { token, password: 'another password 2' });
    assert.equal(again.status, 400);
    assert.equal(again.body.code, 'reset_invalid');
    assert.deepEqual((await t.agent().post('/api/auth/reset/check', { token })).body, { valid: false });
    await settle();
    assert.ok(fetch.calls.some((c) => /password was changed/.test(c.body.subject) && c.body.to[0] === ann.user.email), 'the account is told');
  } finally {
    await t.close();
  }
});

test('reset: links expire after 60 minutes, only the newest works, and malformed tokens are refused', async () => {
  const fetch = mockFetch();
  const t = await startTestServer({ env: EMAIL_ENV, fetch });
  try {
    const ann = await t.user();
    const t0 = Date.now();
    t.setNow(t0);
    await t.agent().post('/api/auth/forgot', { email: ann.user.email });
    await settle();
    const first = tokenFrom(fetch, ann.user.email);
    await t.agent().post('/api/auth/forgot', { email: ann.user.email });
    await settle();
    const second = tokenFrom(fetch, ann.user.email);
    assert.notEqual(first, second);
    assert.equal((await t.agent().post('/api/auth/reset/check', { token: first })).body.valid, false, 'a newer link replaces the older one');
    assert.equal((await t.agent().post('/api/auth/reset/check', { token: second })).body.valid, true);

    t.setNow(t0 + 59 * 60_000);
    assert.equal((await t.agent().post('/api/auth/reset/check', { token: second })).body.valid, true);
    t.setNow(t0 + 61 * 60_000);
    assert.equal((await t.agent().post('/api/auth/reset/check', { token: second })).body.valid, false, 'expired');
    assert.equal((await t.agent().post('/api/auth/reset', { token: second, password: 'too late password' })).body.code, 'reset_invalid');
    t.setNow(null);

    for (const bad of ['', 'x', 'a'.repeat(44), `${second.slice(0, 42)}!`, 42, null, { $gt: '' }]) {
      assert.deepEqual((await t.agent().post('/api/auth/reset/check', { token: bad })).body, { valid: false }, JSON.stringify(bad));
      assert.equal((await t.agent().post('/api/auth/reset', { token: bad, password: 'whatever password' })).status, 400);
    }
  } finally {
    await t.close();
  }
});

test('reset links stop working when the password or the sign-in email changes', async () => {
  const fetch = mockFetch();
  const t = await startTestServer({ env: EMAIL_ENV, fetch });
  try {
    const ann = await t.user();
    await t.agent().post('/api/auth/forgot', { email: ann.user.email });
    await settle();
    const a = tokenFrom(fetch, ann.user.email);
    assert.equal((await ann.post('/api/auth/password', { current: ann.user.password, next: 'changed password 1' })).status, 200);
    assert.equal((await t.agent().post('/api/auth/reset/check', { token: a })).body.valid, false, 'a password change revokes links');

    await t.agent().post('/api/auth/forgot', { email: ann.user.email });
    await settle();
    const b = tokenFrom(fetch, ann.user.email);
    const moved = await ann.post('/api/account/email', { email: 'ann.moved@test.blumodel', password: 'changed password 1' });
    assert.equal(moved.status, 200, moved.text);
    assert.equal((await t.agent().post('/api/auth/reset/check', { token: b })).body.valid, false, 'a link mailed to the old address dies with it');
  } finally {
    await t.close();
  }
});

test('forgot is rate-limited per address (silently) and per IP (429)', async () => {
  const fetch = mockFetch();
  const t = await startTestServer({ env: EMAIL_ENV, fetch, rateLimits: true });
  try {
    const ann = await t.user();
    for (let i = 0; i < 5; i++) {
      const r = await t.agent().post('/api/auth/forgot', { email: ann.user.email });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body, { ok: true, emailEnabled: true }, 'the answer never changes');
    }
    await settle();
    assert.equal(fetch.calls.length, 3, 'three emails an hour per address, however often it is asked');
    for (let i = 0; i < 5; i++) await t.agent().post('/api/auth/forgot', { email: `other${i}@test.blumodel` });
    const limited = await t.agent().post('/api/auth/forgot', { email: 'one.more@test.blumodel' });
    assert.equal(limited.status, 429, 'ten an hour per IP');
  } finally {
    await t.close();
  }
});

test('Postmark: the same reset email goes through its endpoint with its token header', async () => {
  const fetch = mockFetch();
  const t = await startTestServer({ env: { POSTMARK_TOKEN: POSTMARK_FAKE, EMAIL_FROM: 'hello@blumodel.test' }, fetch });
  try {
    const ann = await t.user();
    await t.agent().post('/api/auth/forgot', { email: ann.user.email });
    await settle();
    assert.equal(fetch.calls.length, 1);
    assert.equal(fetch.calls[0].url, 'https://api.postmarkapp.com/email');
    assert.equal(fetch.calls[0].init.headers['X-Postmark-Server-Token'], POSTMARK_FAKE);
    assert.equal(fetch.calls[0].body.To, ann.user.email);
    assert.ok(tokenFrom(fetch, ann.user.email));
  } finally {
    await t.close();
  }
});

test('admin reset link: admins only, CSRF-gated, audited without the link, shown once, and it works', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const studio = await t.user({ role: 'studio' });
    const ann = await t.user({ email: 'ann.admin.reset@test.blumodel' });
    const path = `/api/admin/users/${ann.id}/reset-link`;
    assert.equal((await t.agent().post(path)).status, 401);
    assert.equal((await ann.post(path)).status, 403);
    assert.equal((await studio.post(path)).status, 403);
    assert.equal((await admin.post(path, undefined, { csrf: false })).status, 403);
    assert.equal((await admin.post('/api/admin/users/nobody_here/reset-link')).status, 404);

    const r = await admin.post(path);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const m = new RegExp(`^${t.config.PUBLIC_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/#/signin\\?reset=([A-Za-z0-9_-]{43})$`).exec(r.body.url);
    assert.ok(m, r.body.url);
    const token = m[1];
    assert.ok(r.body.expiresAt > Date.now() + 59 * 60_000);

    const row = t.db.prepare('SELECT token_hash, created_by FROM password_resets WHERE user_id = ?').get(ann.id);
    assert.equal(row.token_hash, sha256(token));
    assert.equal(row.created_by, admin.id);
    const audit = t.db.prepare("SELECT * FROM admin_audit WHERE action = 'reset_link'").all();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].admin_user_id, admin.id);
    assert.equal(audit[0].target_user_id, ann.id);
    assert.equal(audit[0].target_email, ann.user.email);
    assert.ok(!audit[0].detail.includes(token) && !audit[0].detail.includes(sha256(token)), 'the audit never holds the link');

    // A second link replaces the first.
    const r2 = await admin.post(path);
    assert.equal((await t.agent().post('/api/auth/reset/check', { token })).body.valid, false);
    const token2 = /reset=([A-Za-z0-9_-]{43})$/.exec(r2.body.url)[1];
    const used = await t.agent().post('/api/auth/reset', { token: token2, password: 'set by a link 1' });
    assert.equal(used.status, 200, used.text);
    assert.equal((await ann.get('/api/auth/me')).body.user, null);
    assert.equal((await t.agent().post('/api/auth/login', { email: ann.user.email, password: 'set by a link 1' })).status, 200);
  } finally {
    await t.close();
  }
});

test('deleting an account removes its reset links', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const ann = await t.user();
    await admin.post(`/api/admin/users/${ann.id}/reset-link`);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ?').get(ann.id).n, 1);
    assert.equal((await ann.post('/api/account/delete', { password: ann.user.password })).status, 204);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n, 0);
  } finally {
    await t.close();
  }
});
