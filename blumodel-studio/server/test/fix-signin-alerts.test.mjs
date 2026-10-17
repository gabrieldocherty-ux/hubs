// Review fix: a sign-in alert can't be silenced by sending an unrecognised User-Agent. Before, the
// "known device" check compared browser and system names, and an unrecognised UA (both names
// empty) matched every other unrecognised session and every session made before account-001
// recorded devices, so a sign-in with no User-Agent was never alerted about. Now empty names are
// always a new device, and one device is alerted about at most once a day per account.
// Fake provider key, mocked fetch only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { ALERT_REPEAT_MS } from '../routes/auth.mjs';

const POSTMARK_FAKE = 'pm_FAKE_FOR_TESTS';
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

async function setup() {
  const fetch = mockFetch();
  const t = await startTestServer({ env: { POSTMARK_TOKEN: POSTMARK_FAKE, EMAIL_FROM: 'hello@blumodel.test' }, fetch });
  // Signed up from the test agent, whose User-Agent ("node") names no browser or system.
  const ann = await t.user({ email: 'ann.silent@test.blumodel' });
  const login = async (ua) => {
    const r = await t.agent().post('/api/auth/login', { email: 'ann.silent@test.blumodel', password: ann.user.password }, { headers: ua == null ? {} : { 'User-Agent': ua } });
    assert.equal(r.status, 200, r.text);
    await settle();
  };
  const alerts = () => fetch.calls.filter((c) => c.body?.Subject === 'New sign-in to BluModel Studio');
  return { t, ann, login, alerts };
}

test('an unrecognised User-Agent is a new device, even with other unrecognised sessions signed in', async () => {
  const { t, login, alerts } = await setup();
  try {
    const sessions = t.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE browser = '' AND os = ''").get().n;
    assert.equal(sessions, 1, 'the signup session has no device names');
    await login('curl/8.4.0');
    assert.equal(alerts().length, 1, 'an unrecognised device is alerted about');
    assert.match(alerts()[0].body.TextBody, /an unknown device/);
  } finally {
    await t.close();
  }
});

test('a session from before devices were recorded does not silence an alert', async () => {
  const { t, ann, login, alerts } = await setup();
  try {
    // A pre-account-001 session: the migration gave it empty names.
    t.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(ann.user.id);
    t.db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, id, browser, os) VALUES ('legacyhash', ?, ?, 'legacyid', '', '')").run(ann.user.id, Date.now() + 86_400_000);
    await login('');
    assert.equal(alerts().length, 1);
  } finally {
    await t.close();
  }
});

test('one alert per device per day, not one per attempt; a recognised known device still sends none', async () => {
  const { t, login, alerts } = await setup();
  try {
    const t0 = Date.now();
    t.setNow(t0);
    await login('curl/8.4.0');
    await login(null);
    await login('');
    assert.equal(alerts().length, 1, 'the same unrecognisable device again within a day: no second alert');
    await login(EDGE_WIN);
    assert.equal(alerts().length, 2, 'a different device is its own alert');
    await login(EDGE_WIN);
    assert.equal(alerts().length, 2, 'Edge on Windows is signed in now: known');
    t.setNow(t0 + ALERT_REPEAT_MS + 60_000);
    await login('curl/8.4.0');
    assert.equal(alerts().length, 3, 'a day later the unrecognisable device is alerted about again');
    assert.ok(t.db.prepare('SELECT COUNT(*) AS n FROM signin_alerts').get().n <= 2, 'old alert rows are pruned');
  } finally {
    t.setNow(null);
    await t.close();
  }
});
