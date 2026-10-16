// Review fix: an account's display name never goes into an official email. A name is whatever was
// typed at sign-up, and one like 'https://evil.example/verify-account' became a clickable link in
// the password-reset and sign-in-alert emails (mail clients auto-link plain-text URLs, and the HTML
// part linked it). Fake provider key, mocked fetch only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { emailChangedEmail, passwordChangedEmail, resetEmail, signInAlertEmail } from '../email/messages.mjs';

const EVIL = 'https://evil.example/verify-account';
const EDGE_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

function mockFetch() {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}
const settle = () => new Promise((r) => setTimeout(r, 30));

test('the message builders ignore a name, whatever it is', () => {
  const msgs = [
    resetEmail({ name: EVIL, url: 'https://blumodel.test/#/signin?reset=x', minutes: 60 }),
    emailChangedEmail({ name: EVIL, newEmail: 'new@b.test', supportEmail: 'help@b.test' }),
    passwordChangedEmail({ name: EVIL, supportEmail: 'help@b.test', viaReset: true }),
    signInAlertEmail({ name: EVIL, device: 'Edge on Windows', when: '2026-10-16 10:00 UTC', settingsUrl: 'https://blumodel.test/#/account' }),
  ];
  for (const m of msgs) {
    assert.ok(m.text.startsWith('Hello,'), m.subject);
    assert.ok(!m.text.includes('evil.example'), m.subject);
  }
});

test('a name that is a URL never reaches the reset or sign-in alert email, in text or HTML', async () => {
  const fetch = mockFetch();
  const t = await startTestServer({ env: { POSTMARK_TOKEN: 'pm_FAKE_FOR_TESTS', EMAIL_FROM: 'hello@blumodel.test' }, fetch });
  try {
    const ann = await t.user({ name: EVIL, email: 'ann.evil@test.blumodel' });
    assert.equal((await t.agent().post('/api/auth/login', { email: ann.user.email, password: ann.user.password }, { headers: { 'User-Agent': EDGE_WIN } })).status, 200);
    assert.equal((await t.agent().post('/api/auth/forgot', { email: ann.user.email })).status, 200);
    await settle();
    const subjects = fetch.calls.map((c) => c.body?.Subject);
    assert.ok(subjects.includes('New sign-in to BluModel Studio'), subjects.join());
    assert.ok(subjects.includes('Reset your BluModel Studio password'), subjects.join());
    for (const c of fetch.calls) {
      assert.ok(!c.body.TextBody.includes('evil.example'), `${c.body.Subject}: text`);
      assert.ok(!c.body.HtmlBody.includes('evil.example'), `${c.body.Subject}: html`);
    }
  } finally {
    await t.close();
  }
});
