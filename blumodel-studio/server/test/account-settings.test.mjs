// Account settings (the 'account' package): preferences, the profile (name, phone), changing the
// sign-in email, signed-in devices, and the outgoing-email module. Every write is CSRF-gated by the
// router and rate-limited; every read is the signed-in person's own data only. Fake provider keys
// only, and fetch is always mocked: no test here talks to Resend or Postmark.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, silentLog } from './helpers.mjs';
import { normalizePhone } from '../account/phone.mjs';
import { readPrefsPatch, DEFAULT_PREFS } from '../account/prefs.mjs';
import { browserOf, osOf, deviceLabel } from '../auth/device.mjs';
import { createMailer, emailSettings, textToHtml } from '../email/index.mjs';

const RESEND_FAKE = 're_FAKE_FOR_TESTS';
const POSTMARK_FAKE = 'pm_FAKE_FOR_TESTS';
const EDGE_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** A fetch that records every call and answers 200 (or `status`). */
function mockFetch(status = 200) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ id: 'msg_1' }), { status, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

/** A log that keeps every line, to prove no secret is ever written. */
function captureLog() {
  const lines = [];
  const put = (...a) => lines.push(a.map(String).join(' '));
  return { lines, info: put, warn: put, error: put };
}

const settle = () => new Promise((r) => setTimeout(r, 30));

// ── pure helpers ─────────────────────────────────────────────────────────────

test('phone numbers: North American numbers need an area code and are written one way; international ones keep +', () => {
  assert.deepEqual(normalizePhone('905-555-0142'), { ok: true, value: '(905) 555-0142' });
  assert.deepEqual(normalizePhone('+1 (905) 555 0142'), { ok: true, value: '(905) 555-0142' });
  assert.deepEqual(normalizePhone('905.555.0142 x12'), { ok: true, value: '(905) 555-0142 ext. 12' });
  assert.deepEqual(normalizePhone('+44 20 7946 0958'), { ok: true, value: '+442079460958' });
  assert.deepEqual(normalizePhone(''), { ok: true, value: '' });
  for (const bad of ['555-0100', '123-555-0142', 'call me', '+44 12', '9'.repeat(41)]) assert.equal(normalizePhone(bad).ok, false, bad);
});

test('preferences: only known keys with valid values; the estimator defaults to off', () => {
  assert.equal(DEFAULT_PREFS.showEstimator, false);
  assert.equal(DEFAULT_PREFS.theme, 'system');
  assert.deepEqual(readPrefsPatch({ theme: 'dark', showEstimator: true }), { theme: 'dark', showEstimator: true });
  for (const bad of [null, [], {}, { theme: 'purple' }, { showEstimator: 'yes' }, { admin: true }, { __proto__: { theme: 'dark' } }]) {
    assert.throws(() => readPrefsPatch(bad), (e) => e.status === 400, JSON.stringify(bad));
  }
});

test('devices: browser and system names only', () => {
  assert.equal(browserOf(EDGE_WIN), 'Edge');
  assert.equal(osOf(EDGE_WIN), 'Windows');
  assert.equal(browserOf(SAFARI_IPHONE), 'Safari');
  assert.equal(osOf(SAFARI_IPHONE), 'iPhone');
  assert.equal(deviceLabel({ browser: '', os: '' }), 'an unknown device');
});

// ── routes ───────────────────────────────────────────────────────────────────

test('prefs: signed in only, CSRF-gated, per person, validated, and off by default', async () => {
  const t = await startTestServer();
  try {
    assert.equal((await t.agent().get('/api/account/prefs')).status, 401);
    const ann = await t.user();
    const bob = await t.user();
    const first = await ann.get('/api/account/prefs');
    assert.equal(first.status, 200, first.text);
    assert.deepEqual(first.body, { prefs: { theme: 'system', showEstimator: false, signInAlerts: true }, saved: false, emailEnabled: false });

    assert.equal((await ann.patch('/api/account/prefs', { showEstimator: true }, { csrf: false })).status, 403, 'no CSRF header, no write');
    assert.equal((await ann.patch('/api/account/prefs', { showEstimator: 'on' })).status, 400);
    assert.equal((await ann.patch('/api/account/prefs', { role: 'admin' })).status, 400);
    assert.equal((await ann.patch('/api/account/prefs', {})).status, 400);

    const set = await ann.patch('/api/account/prefs', { showEstimator: true, theme: 'dark' });
    assert.equal(set.status, 200, set.text);
    assert.deepEqual(set.body.prefs, { theme: 'dark', showEstimator: true, signInAlerts: true });
    assert.equal((await ann.get('/api/account/prefs')).body.saved, true);
    // A partial patch keeps the rest.
    assert.deepEqual((await ann.patch('/api/account/prefs', { theme: 'light' })).body.prefs, { theme: 'light', showEstimator: true, signInAlerts: true });
    // Bob's are his own.
    assert.deepEqual((await bob.get('/api/account/prefs')).body.prefs, DEFAULT_PREFS);
    // A stored object from an older version is cleaned on read.
    t.db.prepare('UPDATE user_prefs SET prefs = ? WHERE user_id = ?').run(JSON.stringify({ theme: 'neon', showEstimator: true, junk: 1 }), ann.id);
    assert.deepEqual((await ann.get('/api/account/prefs')).body.prefs, { theme: 'system', showEstimator: true, signInAlerts: true });
    // The export carries them; deleting the account removes them.
    const exp = JSON.parse((await ann.get('/api/account/export')).text);
    assert.equal(exp.preferences.showEstimator, true);
    assert.equal((await ann.post('/api/account/delete', { password: ann.user.password })).status, 204);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM user_prefs WHERE user_id = ?').get(ann.id).n, 0);
  } finally {
    await t.close();
  }
});

test('profile: the name and phone are saved, the phone normalised; a bad one is refused with its field', async () => {
  const t = await startTestServer();
  try {
    const ann = await t.user({ name: 'Ann Profile' });
    const p = await ann.get('/api/account/profile');
    assert.equal(p.status, 200);
    assert.deepEqual(Object.keys(p.body.profile).sort(), ['createdAt', 'email', 'name', 'phone']);
    assert.equal(p.body.profile.phone, '');

    const bad = await ann.patch('/api/account/profile', { phone: '555-0100' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.field, 'phone');
    assert.equal((await ann.patch('/api/account/profile', { name: '   ' })).body.field, 'name');
    assert.equal((await ann.patch('/api/account/profile', { phone: 42 })).status, 400);

    const ok = await ann.patch('/api/account/profile', { name: '  Ann Smith ', phone: '905 555 0142' });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.body.profile.name, 'Ann Smith');
    assert.equal(ok.body.profile.phone, '(905) 555-0142');
    assert.equal(ok.body.user.name, 'Ann Smith', 'the session user comes back for the client');
    // Clearing the phone is allowed (it is optional on a personal profile).
    assert.equal((await ann.patch('/api/account/profile', { phone: '' })).body.profile.phone, '');
    assert.equal((await ann.patch('/api/account/profile', { name: 'X' }, { csrf: false })).status, 403);
  } finally {
    await t.close();
  }
});

test('email change: the current password confirms it, other devices are signed out, the old address is told', async () => {
  const fetch = mockFetch();
  const log = captureLog();
  const t = await startTestServer({ env: { RESEND_API_KEY: RESEND_FAKE, EMAIL_FROM: 'BluModel Studio <hello@blumodel.test>', SUPPORT_EMAIL: 'help@blumodel.test' }, fetch, log });
  try {
    const ann = await t.user({ email: 'ann.old@test.blumodel' });
    const other = await t.user({ email: 'taken@test.blumodel' });
    // A second device for Ann.
    const phone = t.agent();
    assert.equal((await phone.post('/api/auth/login', { email: 'ann.old@test.blumodel', password: ann.user.password }, { headers: { 'User-Agent': SAFARI_IPHONE } })).status, 200);
    await settle();
    fetch.calls.length = 0;

    assert.equal((await ann.post('/api/account/email', { email: 'new@test.blumodel', password: 'wrong password' })).body.code, 'wrong_password');
    assert.equal((await ann.post('/api/account/email', { email: 'not an email', password: ann.user.password })).status, 400);
    assert.equal((await ann.post('/api/account/email', { email: 'TAKEN@test.blumodel', password: ann.user.password })).status, 409);
    assert.equal((await ann.post('/api/account/email', { email: 'ann.old@test.blumodel', password: ann.user.password })).status, 400);
    assert.equal(other.user.email, 'taken@test.blumodel');

    const r = await ann.post('/api/account/email', { email: 'Ann.New@Test.BluModel', password: ann.user.password });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.user.email, 'ann.new@test.blumodel');
    assert.equal(r.body.signedOut, 1);
    assert.equal((await phone.get('/api/auth/me')).body.user, null, 'the other device is signed out');
    assert.equal((await ann.get('/api/auth/me')).body.user.email, 'ann.new@test.blumodel', 'this device stays signed in');
    assert.equal((await t.agent().post('/api/auth/login', { email: 'ann.new@test.blumodel', password: ann.user.password })).status, 200);
    assert.equal((await t.agent().post('/api/auth/login', { email: 'ann.old@test.blumodel', password: ann.user.password })).status, 401);

    await settle();
    const sent = fetch.calls.filter((c) => c.body?.subject === 'Your BluModel Studio email address was changed');
    assert.equal(sent.length, 1, 'the old address is told');
    assert.deepEqual(sent[0].body.to, ['ann.old@test.blumodel']);
    assert.equal(sent[0].url, 'https://api.resend.com/emails');
    assert.equal(sent[0].init.headers.Authorization, `Bearer ${RESEND_FAKE}`);
    for (const l of log.lines) assert.ok(!l.includes(RESEND_FAKE) && !l.includes('ann.old@'), `log leaks: ${l}`);
  } finally {
    await t.close();
  }
});

test('email change is rate-limited per account', async () => {
  const t = await startTestServer({ rateLimits: true });
  try {
    const ann = await t.user();
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await ann.post('/api/account/email', { email: `n${i}@test.blumodel`, password: 'wrong password' })).status);
    assert.deepEqual(codes, [400, 400, 400, 400, 400, 400, 429]);
  } finally {
    await t.close();
  }
});

test('signed-in devices: listed with browser, system and times, never a token; one or all others can be signed out', async () => {
  const t = await startTestServer();
  try {
    const ann = await t.user({ email: 'ann.devices@test.blumodel' });
    const bob = await t.user();
    const edge = t.agent();
    const iphone = t.agent();
    const login = (a, ua) => a.post('/api/auth/login', { email: 'ann.devices@test.blumodel', password: ann.user.password }, { headers: { 'User-Agent': ua } });
    assert.equal((await login(edge, EDGE_WIN)).status, 200);
    assert.equal((await login(iphone, SAFARI_IPHONE)).status, 200);

    const list = await edge.get('/api/account/sessions');
    assert.equal(list.status, 200, list.text);
    assert.equal(list.body.sessions.length, 3);
    const mine = list.body.sessions.find((s) => s.current);
    assert.deepEqual([mine.browser, mine.os], ['Edge', 'Windows']);
    assert.ok(list.body.sessions.some((s) => s.browser === 'Safari' && s.os === 'iPhone' && !s.current));
    for (const s of list.body.sessions) {
      assert.deepEqual(Object.keys(s).sort(), ['browser', 'createdAt', 'current', 'expiresAt', 'id', 'lastSeenAt', 'os']);
      assert.match(s.id, /^[a-f0-9]{24}$/);
      assert.equal(typeof s.createdAt, 'number');
    }
    const hashes = t.db.prepare('SELECT token_hash FROM sessions').all().map((r) => r.token_hash);
    for (const h of hashes) assert.ok(!list.text.includes(h), 'no token hash leaves the server');

    // Sign the iPhone out from Edge.
    const iphoneId = list.body.sessions.find((s) => s.os === 'iPhone').id;
    assert.equal((await edge.delete(`/api/account/sessions/${iphoneId}`, { csrf: false })).status, 403);
    assert.equal((await edge.delete(`/api/account/sessions/${iphoneId}`)).status, 204);
    assert.equal((await iphone.get('/api/auth/me')).body.user, null);
    assert.equal((await edge.delete(`/api/account/sessions/${iphoneId}`)).status, 404, 'already gone');
    // This device: use Sign out instead.
    assert.equal((await edge.delete(`/api/account/sessions/${mine.id}`)).body.code, 'current_session');
    // Someone else's device can't be touched.
    const bobId = (await bob.get('/api/account/sessions')).body.sessions[0].id;
    assert.equal((await edge.delete(`/api/account/sessions/${bobId}`)).status, 404);
    assert.ok((await bob.get('/api/auth/me')).body.user, 'Bob is still signed in');
    assert.equal((await edge.delete('/api/account/sessions/not-an-id')).status, 404);

    // Every other device.
    const others = await edge.post('/api/account/sessions/sign-out-others');
    assert.equal(others.status, 200, others.text);
    assert.equal(others.body.signedOut, 1);
    assert.equal((await ann.get('/api/auth/me')).body.user, null);
    assert.equal((await edge.get('/api/account/sessions')).body.sessions.length, 1);
  } finally {
    await t.close();
  }
});

test('sign-in alerts: a new browser is told about by email when a provider is on; a known one is not', async () => {
  const fetch = mockFetch();
  const t = await startTestServer({ env: { POSTMARK_TOKEN: POSTMARK_FAKE, EMAIL_FROM: 'hello@blumodel.test' }, fetch });
  try {
    const ann = await t.user({ email: 'ann.alerts@test.blumodel' });
    assert.equal((await ann.get('/api/account/prefs')).body.emailEnabled, true);
    const login = (ua) => t.agent().post('/api/auth/login', { email: 'ann.alerts@test.blumodel', password: ann.user.password }, { headers: { 'User-Agent': ua } });
    await login(SAFARI_IPHONE);
    await settle();
    const alerts = () => fetch.calls.filter((c) => c.body?.Subject === 'New sign-in to BluModel Studio');
    assert.equal(alerts().length, 1);
    assert.equal(alerts()[0].url, 'https://api.postmarkapp.com/email');
    assert.equal(alerts()[0].init.headers['X-Postmark-Server-Token'], POSTMARK_FAKE);
    assert.match(alerts()[0].body.TextBody, /Safari on iPhone/);
    await login(SAFARI_IPHONE);
    await settle();
    assert.equal(alerts().length, 1, 'the same browser again: no alert');
    // Turned off.
    assert.equal((await ann.patch('/api/account/prefs', { signInAlerts: false })).status, 200);
    await login(EDGE_WIN);
    await settle();
    assert.equal(alerts().length, 1);
  } finally {
    await t.close();
  }
});

// ── the email module ─────────────────────────────────────────────────────────

test('email settings: none without a key or a sender; Resend wins over Postmark; notes never carry a key', () => {
  assert.equal(emailSettings({}).provider, 'none');
  assert.equal(emailSettings({ RESEND_API_KEY: RESEND_FAKE }).provider, 'none', 'no EMAIL_FROM');
  assert.equal(emailSettings({ RESEND_API_KEY: RESEND_FAKE, EMAIL_FROM: 'not an address' }).provider, 'none');
  assert.equal(emailSettings({ POSTMARK_TOKEN: POSTMARK_FAKE, EMAIL_FROM: 'a@b.test' }).provider, 'postmark');
  const both = emailSettings({ RESEND_API_KEY: RESEND_FAKE, POSTMARK_TOKEN: POSTMARK_FAKE, EMAIL_FROM: 'BluModel <a@b.test>' });
  assert.equal(both.provider, 'resend');
  for (const n of both.notes) assert.ok(!n.includes(RESEND_FAKE) && !n.includes(POSTMARK_FAKE), n);
  assert.match(textToHtml('Hi <b>\n\nhttps://x.test/#/a?b=1'), /&lt;b&gt;.*<a href="https:\/\/x.test\/#\/a\?b=1">/s);
});

test('mailer: a failed send logs the provider and status only, never throws, and refuses odd recipients', async () => {
  const log = captureLog();
  const failing = mockFetch(500);
  const m = createMailer({ config: { RESEND_API_KEY: RESEND_FAKE, EMAIL_FROM: 'a@b.test' }, fetch: failing, log });
  assert.deepEqual(await m.send({ to: 'x@y.test', subject: 'S', text: 'T' }), { ok: false, status: 500 });
  assert.deepEqual(log.lines, ['Email (resend) not sent: HTTP 500.']);
  assert.equal((await m.send({ to: 'x@y.test\r\nBcc: z@q.test', subject: 'S', text: 'T' })).reason, 'bad_recipient');
  const thrown = createMailer({
    config: { RESEND_API_KEY: RESEND_FAKE, EMAIL_FROM: 'a@b.test' },
    fetch: async () => {
      throw new TypeError(`connect failed ${RESEND_FAKE}`);
    },
    log,
  });
  assert.equal((await thrown.send({ to: 'x@y.test', subject: 'S', text: 'T' })).reason, 'network');
  for (const l of log.lines) assert.ok(!l.includes(RESEND_FAKE), l);
  const none = createMailer({ config: {}, fetch: failing, log: silentLog });
  assert.equal(none.enabled, false);
  assert.equal((await none.send({ to: 'x@y.test', subject: 'S', text: 'T' })).reason, 'none');
});
