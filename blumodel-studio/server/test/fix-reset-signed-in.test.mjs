// A password-reset link opened in a browser that is signed in as someone else: setting the new
// password signs that browser in as the account the link belongs to, and the other account's
// session in that browser ends (it isn't left valid behind the replaced cookie). Email is a
// mocked fetch with a fake key.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';

const EMAIL_ENV = { RESEND_API_KEY: 're_FAKE_FOR_TESTS', EMAIL_FROM: 'BluModel Studio <hello@blumodel.test>', SUPPORT_EMAIL: 'help@blumodel.test' };

function mockFetch() {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

test('reset in a browser signed in as another account: it becomes the reset account, the other session ends', async () => {
  const fetch = mockFetch();
  const t = await startTestServer({ env: EMAIL_ENV, fetch });
  try {
    const ann = await t.user({ email: 'ann.shared@test.blumodel' });
    const bob = await t.user({ email: 'bob.shared@test.blumodel' });
    await t.agent().post('/api/auth/forgot', { email: ann.user.email });
    await new Promise((r) => setTimeout(r, 30));
    const mail = [...fetch.calls].reverse().find((c) => c.body?.to?.[0] === ann.user.email);
    const token = /#\/signin\?reset=([A-Za-z0-9_-]{43})/.exec(mail.body.text)[1];

    // Bob's browser opens Ann's link.
    const bobSessions = () => t.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(bob.id).n;
    assert.equal(bobSessions(), 1);
    const done = await bob.post('/api/auth/reset', { token, password: 'a brand new password' });
    assert.equal(done.status, 200, done.text);
    assert.equal(done.body.user.email, ann.user.email);
    assert.equal((await bob.get('/api/auth/me')).body.user.id, ann.id, 'the browser is now signed in as Ann');
    assert.equal(bobSessions(), 0, 'Bob’s session in that browser ended');
  } finally {
    await t.close();
  }
});
