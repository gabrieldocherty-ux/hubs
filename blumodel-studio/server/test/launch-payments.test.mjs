// Launch: the payments posture ('stripe' | 'demo' | 'none') and its live-key safeguards, the 503
// every payment endpoint answers with no payments, /api/config's launch fields, the startup report,
// and that a Stripe failure never echoes a key, header, body or Stripe's own message.
// Every key here is an obviously fake test value and Stripe is only ever a mocked fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, paymentsPosture, stripeKeyMode } from '../config.mjs';
import { startupReport } from '../ops/startup.mjs';
import { createStripeRequest } from '../payments/stripeApi.mjs';
import { startTestServer, sampleDoc } from './helpers.mjs';

const TEST_KEY = 'sk_test_FAKE_FOR_TESTS';
const LIVE_KEY = 'sk_live_FAKE_FOR_TESTS';
const LIVE_RK = 'rk_live_FAKE_FOR_TESTS';
const WHSEC = 'whsec_FAKE_FOR_TESTS';
// A key fragment is a prefix followed by key characters. Naming a prefix to explain what belongs
// in a setting ("they start whsec_", "sk_live_/sk_test_") is not a leak.
const noSecret = (s) => !/FAKE_FOR_TESTS|(sk|rk|pk)_(live|test)_[A-Za-z0-9]|whsec_[A-Za-z0-9]/.test(String(s));

test('stripeKeyMode reads the mode from the prefix only', () => {
  assert.equal(stripeKeyMode(''), 'none');
  assert.equal(stripeKeyMode(TEST_KEY), 'test');
  assert.equal(stripeKeyMode('rk_test_FAKE'), 'test');
  assert.equal(stripeKeyMode(LIVE_KEY), 'live');
  assert.equal(stripeKeyMode(LIVE_RK), 'live');
  assert.equal(stripeKeyMode('pk_live_FAKE'), 'invalid');
  assert.equal(stripeKeyMode('whsec_FAKE'), 'invalid');
});

test('payments posture: stripe, demo or none, and why, with the live-key safeguards', () => {
  const p = (o) => paymentsPosture({ PAYMENTS: 'auto', PROD: false, PUBLIC_URL: 'http://127.0.0.1:8790', DEMO_PAYMENTS: false, STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', ...o });
  const cases = [
    // [settings, provider, a note that must be there]
    [{}, 'demo', /not configured/],
    [{ PROD: true }, 'none', /Demo payments are off in production/],
    [{ PROD: true, DEMO_PAYMENTS: true }, 'demo', /not configured/],
    [{ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: WHSEC }, 'stripe', null],
    [{ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: WHSEC, PROD: true }, 'stripe', null],
    [{ STRIPE_SECRET_KEY: TEST_KEY }, 'demo', /STRIPE_WEBHOOK_SECRET is not set/],
    [{ STRIPE_WEBHOOK_SECRET: WHSEC, PROD: true }, 'none', /STRIPE_SECRET_KEY is not set/],
    [{ STRIPE_SECRET_KEY: 'pk_test_FAKE_FOR_TESTS', STRIPE_WEBHOOK_SECRET: WHSEC }, 'demo', /publishable key does not work/],
    [{ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: 'FAKE_FOR_TESTS' }, 'demo', /not a webhook signing secret/],
    // Live keys: production mode AND an https PUBLIC_URL, or no payments at all (never demo).
    [{ STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: WHSEC }, 'none', /needs production mode/],
    [{ STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: WHSEC, PROD: true }, 'none', /needs PUBLIC_URL to be the https address/],
    [{ STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: WHSEC, PROD: true, DEMO_PAYMENTS: true }, 'none', /never used with a live Stripe key/],
    [{ STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: WHSEC, PROD: true, PUBLIC_URL: 'https://blumodel.studio' }, 'stripe', null],
    [{ STRIPE_SECRET_KEY: LIVE_RK, STRIPE_WEBHOOK_SECRET: WHSEC, PROD: true, PUBLIC_URL: 'https://blumodel.studio' }, 'stripe', null],
    [{ STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: WHSEC, PAYMENTS: 'demo' }, 'none', /PAYMENTS=demo/],
    [{ PAYMENTS: 'demo' }, 'demo', /PAYMENTS=demo/],
  ];
  for (const [o, want, note] of cases) {
    const r = p(o);
    assert.equal(r.provider, want, JSON.stringify({ ...o, STRIPE_SECRET_KEY: stripeKeyMode(o.STRIPE_SECRET_KEY) }));
    if (note) assert.match(r.notes.join(' '), note);
    for (const n of r.notes) assert.ok(noSecret(n), `a note leaks a key: ${n}`);
  }
});

test('config: live mode only with production and https; legal and publicUrl come through; PUBLIC_URL must be an origin', () => {
  const live = loadConfig({ STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: WHSEC, PUBLIC_URL: 'https://blumodel.studio/', NODE_ENV: 'production' }, []);
  assert.equal(live.paymentsProvider, 'stripe');
  assert.equal(live.stripeMode, 'live');
  assert.equal(live.PUBLIC_URL, 'https://blumodel.studio');
  const notLive = loadConfig({ STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: WHSEC, PUBLIC_URL: 'http://blumodel.studio' }, ['--prod']);
  assert.equal(notLive.paymentsProvider, 'none');
  assert.equal(notLive.stripeMode, null);
  assert.equal(notLive.demoPaymentsAllowed, false);
  const legal = loadConfig({ LEGAL_NAME: 'BluModel Studio LLC', SUPPORT_EMAIL: 'help@blumodel.studio' }, []).legal;
  assert.deepEqual(legal, { ready: false, businessName: 'BluModel Studio LLC', supportEmail: 'help@blumodel.studio', jurisdiction: null });
  assert.equal(loadConfig({ LEGAL_NAME: 'A', SUPPORT_EMAIL: 'b@c.d', LEGAL_JURISDICTION: 'Ontario, Canada' }, []).legal.ready, true);
  assert.throws(() => loadConfig({ PUBLIC_URL: 'https://blumodel.studio/app' }, []), /PUBLIC_URL must be an http\(s\) origin/);
  assert.throws(() => loadConfig({ PUBLIC_URL: 'blumodel.studio' }, []), /PUBLIC_URL/);
  assert.equal(loadConfig({ TRUST_PROXY: '2' }, []).TRUST_PROXY, 1, 'TRUST_PROXY is on or off');
});

test('startup report: LIVE / TEST from the prefix only, and the warnings worth fixing before launch', () => {
  const live = startupReport(loadConfig({ STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: WHSEC, PUBLIC_URL: 'https://blumodel.studio', TRUST_PROXY: '1', ADMIN_EMAILS: 'a@b.co', LEGAL_NAME: 'X', SUPPORT_EMAIL: 'y@z.co', LEGAL_JURISDICTION: 'Q' }, ['--prod']));
  assert.ok(live.info.includes('Stripe: LIVE mode'), live.info.join('\n'));
  assert.deepEqual(live.warn, [], 'a fully set-up live server has nothing to warn about');
  const test = startupReport(loadConfig({ STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: WHSEC }, []));
  assert.ok(test.info.includes('Stripe: TEST mode'));
  const bare = startupReport(loadConfig({ DEMO_PAYMENTS: '1' }, ['--prod']), { adminCount: 0 });
  const w = bare.warn.join('\n');
  assert.match(w, /No Stripe/);
  assert.match(w, /DEMO payments are ON in production/);
  assert.match(w, /No admin account exists: run node server\/scripts\/make-admin\.mjs/);
  assert.doesNotMatch(w, /ADMIN_EMAILS/, 'ADMIN_EMAILS grants nothing, so the report never asks for it');
  assert.match(w, /Legal details missing \(LEGAL_NAME, SUPPORT_EMAIL, LEGAL_JURISDICTION\)/);
  const none = startupReport(loadConfig({ STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_WEBHOOK_SECRET: WHSEC }, []));
  assert.match(none.info.join(' '), /Payments: none/);
  assert.match(none.warn.join(' '), /needs production mode/);
  for (const r of [live, test, bare, none]) for (const l of [...r.info, ...r.warn]) assert.ok(noSecret(l), `leaks: ${l}`);
});

test('GET /api/config: payments, publicUrl and legal (and nothing secret)', async () => {
  const s = await startTestServer({ env: { STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: WHSEC, PUBLIC_URL: 'https://blumodel.example', LEGAL_NAME: 'BluModel Studio LLC', SUPPORT_EMAIL: 'help@blumodel.example', LEGAL_JURISDICTION: 'Ontario, Canada' } });
  try {
    const r = await s.agent().get('/api/config');
    assert.equal(r.status, 200);
    assert.equal(r.body.payments, 'stripe');
    assert.equal(r.body.demoPayments, false);
    assert.equal(r.body.publicUrl, 'https://blumodel.example');
    assert.deepEqual(r.body.legal, { ready: true, businessName: 'BluModel Studio LLC', supportEmail: 'help@blumodel.example', jurisdiction: 'Ontario, Canada' });
    assert.ok(noSecret(r.text), r.text);
  } finally {
    await s.close();
  }
  const demo = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const r = await demo.agent().get('/api/config');
    assert.equal(r.body.payments, 'demo');
    assert.equal(r.body.demoPayments, true);
    assert.deepEqual(r.body.legal, { ready: false, businessName: null, supportEmail: null, jurisdiction: null });
  } finally {
    await demo.close();
  }
});

test('payments none: billing, checkout and order-payment endpoints answer 503 payments_unavailable; reading still works', async () => {
  const s = await startTestServer({ env: { NODE_ENV: 'production' } });
  try {
    const u = await s.user();
    assert.equal((await u.get('/api/config')).body.payments, 'none');
    const k = (await u.post('/api/projects', { name: 'K', doc: sampleDoc() })).body.project;
    const writes = [
      ['/api/billing/checkout', { kind: 'kitchen_unlock', projectId: k.id }],
      ['/api/billing/checkout', { kind: 'subscription', plan: 'unlimited' }],
      ['/api/billing/demo/bc_nothing/complete', { outcome: 'success' }],
      ['/api/billing/demo/simulate', { event: 'renewal' }],
      ['/api/billing/sync', { sessionId: 'cs_test_1' }],
      ['/api/billing/portal', {}],
      ['/api/billing/change', { plan: 'contractor' }],
      ['/api/billing/cancel', {}],
      ['/api/billing/resume', {}],
      ['/api/orders', { tier: 'simple' }],
      ['/api/orders/ord_nothing/checkout', {}],
      ['/api/payments/demo/ord_nothing/complete', { outcome: 'success' }],
    ];
    for (const [p, body] of writes) {
      const r = await u.post(p, body);
      assert.equal(r.status, 503, `${p}: ${r.text}`);
      assert.deepEqual(r.body, { error: 'Payments are not available yet.', code: 'payments_unavailable' }, p);
    }
    const hook = await s.agent().request('POST', '/api/webhooks/stripe', { raw: '{}', contentType: 'application/json', headers: { 'Stripe-Signature': 't=1,v1=00' }, csrf: false });
    assert.equal(hook.status, 503);
    assert.equal(hook.body.code, 'payments_unavailable');
    for (const p of ['/api/billing/plans', '/api/billing/entitlements', '/api/billing/me', '/api/orders/tiers', '/api/orders']) assert.equal((await u.get(p)).status, 200, p);
    assert.equal((await u.post(`/api/projects/${k.id}/exports`, { kind: 'csv' })).status, 403, 'exports still answer the paywall');
  } finally {
    await s.close();
  }
});

test('a Stripe failure never echoes the key, a header, a body or Stripe’s message (response or log)', async () => {
  const logs = [];
  const log = { info: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) };
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  let mode = 'auth';
  const fetch = async (url, init) => {
    if (mode === 'network') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET', message: `socket hang up ${init.headers.Authorization}` } });
    if (mode === 'auth') return json({ error: { type: 'invalid_request_error', code: 'api_key_expired', message: `Expired API Key provided: ${TEST_KEY.slice(0, 12)}****TESTS` } }, 401);
    if (mode === 'weird') return json({ error: { type: 'card_error', code: `${TEST_KEY}`, message: 'x', param: `line_items[0]${TEST_KEY}` } }, 402);
    return new Response('<html>oops ' + TEST_KEY + '</html>', { status: 500 });
  };
  const s = await startTestServer({ env: { STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: WHSEC, PUBLIC_URL: 'https://blumodel.example' }, fetch, log });
  try {
    const u = await s.user();
    for (const m of ['auth', 'network', 'weird', 'html']) {
      mode = m;
      const r = await u.post('/api/billing/checkout', { kind: 'subscription', plan: 'unlimited' });
      assert.equal(r.status, 502, `${m}: ${r.text}`);
      assert.ok(noSecret(r.text), `${m} response leaks: ${r.text}`);
      assert.ok(!/Expired API Key|socket hang up|oops/.test(r.text), r.text);
      assert.ok(noSecret(JSON.stringify([...r.headers])), 'headers');
    }
    assert.ok(logs.length >= 4, logs.join('\n'));
    for (const l of logs) {
      assert.ok(noSecret(l), `log leaks: ${l}`);
      assert.ok(!/Expired API Key|socket hang up|oops|Bearer/.test(l), l);
    }
    assert.ok(logs.some((l) => /stripe POST \/checkout\/sessions: HTTP 401 \(invalid_request_error, api_key_expired\)/.test(l)), logs.join('\n'));
    assert.ok(logs.some((l) => /network error \(econnreset\)/.test(l)), logs.join('\n'));
  } finally {
    await s.close();
  }
  // The request helper refuses to run without a key (no call is made).
  let called = false;
  const req = createStripeRequest({ config: { STRIPE_SECRET_KEY: '' }, fetch: async () => ((called = true), new Response('{}')) });
  await assert.rejects(req('GET', '/account'), (e) => e.status === 503 && e.extra?.code === 'payments_unavailable');
  assert.equal(called, false);
});

test('checkout return URLs come from PUBLIC_URL only, never from the request’s Host or X-Forwarded-Host', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(new URLSearchParams(init.body ?? ''));
    return new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const s = await startTestServer({ env: { STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: WHSEC, PUBLIC_URL: 'https://blumodel.example' }, fetch });
  try {
    const u = await s.user();
    const r = await u.post('/api/billing/checkout', { kind: 'subscription', plan: 'unlimited', returnTo: '#/account/billing' }, { headers: { Host: 'evil.example', 'X-Forwarded-Host': 'evil.example', Origin: 'https://evil.example' } });
    assert.equal(r.status, 200, r.text);
    for (const k of ['success_url', 'cancel_url']) assert.ok(calls[0].get(k).startsWith('https://blumodel.example/'), calls[0].get(k));
  } finally {
    await s.close();
  }
});
