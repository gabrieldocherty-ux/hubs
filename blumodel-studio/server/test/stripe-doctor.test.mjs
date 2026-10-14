// The Stripe doctor (server/ops/stripeDoctor.mjs, `npm run stripe:check`). Stripe is only ever a
// mocked fetch: every key here is an obviously fake test value. The CLI is run only with fake
// settings files that hold no usable key (so it makes no network call) and with USERPROFILE/HOME
// pointed at a temp folder, so it can never find a real home's settings file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { formatReport, runStripeCheck } from '../ops/stripeDoctor.mjs';
import { STRIPE_WEBHOOK_EVENTS } from '../payments/webhookEvents.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', '..', 'scripts', 'stripe-check.mjs');
const LIVE_RK = 'rk_live_FAKE_FOR_TESTS';
const LIVE_SK = 'sk_live_FAKE_FOR_TESTS';
const WHSEC = 'whsec_FAKE_FOR_TESTS';
const leaks = (s) => /FAKE_FOR_TESTS|(sk|rk|pk)_(live|test)_[A-Za-z0-9]|whsec_[A-Za-z0-9]|Bearer/.test(String(s));

const READY = {
  STRIPE_SECRET_KEY: LIVE_RK,
  STRIPE_WEBHOOK_SECRET: WHSEC,
  PUBLIC_URL: 'https://blumodel.studio',
  ADMIN_EMAILS: 'owner@blumodel.example',
  LEGAL_NAME: 'BluModel Studio Example Ltd',
  SUPPORT_EMAIL: 'help@blumodel.example',
  LEGAL_JURISDICTION: 'Ontario, Canada',
  TRUST_PROXY: '1',
  DEMO_PAYMENTS: '0',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** A read-only Stripe stand-in. `over[path]` replaces the answer for that path. */
function stripe(over = {}) {
  const calls = [];
  const answers = {
    '/v1/account': () => json({ id: 'acct_1', object: 'account', charges_enabled: true, payouts_enabled: true, settings: { dashboard: { display_name: 'BluModel Studio' }, payments: { statement_descriptor: 'BLUMODEL STUDIO' } }, business_profile: { name: 'BluModel Studio' } }),
    '/v1/webhook_endpoints': (q) =>
      q.get('starting_after')
        ? json({ object: 'list', has_more: false, data: [{ id: 'we_2', url: 'https://blumodel.studio/api/webhooks/stripe', status: 'enabled', enabled_events: [...STRIPE_WEBHOOK_EVENTS, 'customer.created'] }] })
        : json({ object: 'list', has_more: true, data: [{ id: 'we_1', url: 'https://old.example/hook', status: 'enabled', enabled_events: ['*'] }] }),
    '/v1/billing_portal/configurations': () => json({ object: 'list', has_more: false, data: [{ id: 'bpc_1', active: true, is_default: true, features: { payment_method_update: { enabled: true }, invoice_history: { enabled: true }, subscription_cancel: { enabled: true }, subscription_update: { enabled: false } } }] }),
    ...over,
  };
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method, host: u.hostname, path: u.pathname, query: u.searchParams, headers: init.headers, body: init.body });
    const a = answers[u.pathname];
    return a ? a(u.searchParams) : json({ error: { type: 'invalid_request_error', code: 'resource_missing' } }, 404);
  };
  return { fetch, calls };
}
const text = (r) => formatReport(r.lines).join('\n');

test('a ready live setup: every check passes, only GETs to api.stripe.com, and the key is never printed', async () => {
  const m = stripe();
  const r = await runStripeCheck({ env: READY, fetch: m.fetch });
  const out = text(r);
  assert.equal(r.fixes, 0, out);
  assert.equal(r.mode, 'live');
  assert.match(out, /^PASS {2}Stripe key: live \(restricted key\)$/m);
  assert.match(out, /PASS {2}Stripe account business name: BluModel Studio/);
  assert.match(out, /PASS {2}Charges are enabled/);
  assert.match(out, /PASS {2}Statement descriptor .*BLUMODEL STUDIO/);
  assert.match(out, /PASS {2}Webhook endpoint https:\/\/blumodel\.studio\/api\/webhooks\/stripe is enabled and sends all 10 events/);
  assert.match(out, /PASS {2}The Customer portal is set up/);
  assert.match(out, /PASS {2}The server will take payments through Stripe \(live mode\)/);
  assert.match(out, /NOTE {2}A restricted key also needs.*Checkout Sessions: Write.*Subscriptions: Write.*Refunds: Write/);
  assert.ok(!leaks(out), out);
  assert.ok(m.calls.length >= 4);
  for (const c of m.calls) {
    assert.equal(c.method, 'GET', `${c.path}: read-only`);
    assert.equal(c.host, 'api.stripe.com');
    assert.equal(c.body, undefined);
    assert.equal(c.headers.Authorization, `Bearer ${LIVE_RK}`, 'the key goes only in the Authorization header');
  }
  assert.ok(m.calls.some((c) => c.path === '/v1/webhook_endpoints' && c.query.get('starting_after') === 'we_1'), 'follows the pages');
});

test('the webhook endpoint: missing, disabled, or missing events are each a FIX that says what to do', async () => {
  const none = await runStripeCheck({ env: READY, fetch: stripe({ '/v1/webhook_endpoints': () => json({ data: [{ id: 'we_1', url: 'https://old.example/hook', status: 'enabled', enabled_events: ['*'] }], has_more: false }) }).fetch });
  assert.match(text(none), /FIX {3}No live webhook endpoint for https:\/\/blumodel\.studio\/api\/webhooks\/stripe\. Add it .*endpoints that exist: https:\/\/old\.example\/hook/);
  assert.match(text(none), new RegExp(`NOTE {2}Events to send: ${STRIPE_WEBHOOK_EVENTS.join(', ').replace(/\./g, '\\.')}`));

  const off = await runStripeCheck({ env: READY, fetch: stripe({ '/v1/webhook_endpoints': () => json({ data: [{ id: 'we_2', url: 'https://blumodel.studio/api/webhooks/stripe/', status: 'disabled', enabled_events: ['*'] }] }) }).fetch });
  assert.match(text(off), /FIX {3}The webhook endpoint for https:\/\/blumodel\.studio\/api\/webhooks\/stripe is disabled/);

  const partial = await runStripeCheck({
    env: READY,
    fetch: stripe({ '/v1/webhook_endpoints': () => json({ data: [{ id: 'we_2', url: 'https://blumodel.studio/api/webhooks/stripe', status: 'enabled', enabled_events: ['checkout.session.completed', 'invoice.paid'] }] }) }).fetch,
  });
  const p = text(partial);
  assert.match(p, /FIX {3}The webhook endpoint for .* doesn’t send: checkout\.session\.async_payment_succeeded, .*charge\.refunded\. Add them/);
  assert.ok(!/doesn’t send:[^\n]*invoice\.paid/.test(p), 'invoice.paid is sent');
  assert.equal(partial.fixes, 1);
});

test('the Customer portal: not saved is a FIX; card updates or invoices turned off are FIXes', async () => {
  const none = await runStripeCheck({ env: READY, fetch: stripe({ '/v1/billing_portal/configurations': () => json({ data: [] }) }).fetch });
  assert.match(text(none), /FIX {3}The Customer portal isn’t set up/);
  const limited = await runStripeCheck({
    env: READY,
    fetch: stripe({ '/v1/billing_portal/configurations': () => json({ data: [{ active: true, is_default: true, features: { payment_method_update: { enabled: false }, invoice_history: { enabled: false }, subscription_cancel: { enabled: false }, subscription_update: { enabled: true } } }] }) }).fetch,
  });
  const t = text(limited);
  assert.match(t, /FIX {3}.*update their card/);
  assert.match(t, /FIX {3}.*hides invoices/);
  assert.match(t, /NOTE {2}.*doesn’t offer cancelling/);
  assert.match(t, /NOTE {2}.*switch plans/);
});

test('a refused key stops the Stripe checks; a restricted key missing a read permission is told which one to add', async () => {
  const m = stripe({ '/v1/account': () => json({ error: { type: 'invalid_request_error', code: 'api_key_expired', message: `Expired API Key provided: ${LIVE_SK.slice(0, 12)}****TESTS` } }, 401) });
  const refused = await runStripeCheck({ env: { ...READY, STRIPE_SECRET_KEY: LIVE_SK }, fetch: m.fetch });
  assert.match(text(refused), /FIX {3}Stripe refused the key \(HTTP 401, api_key_expired\): it was rolled, expired or mistyped/);
  assert.equal(m.calls.length, 1, 'nothing else is asked once the key is refused');
  assert.ok(!leaks(text(refused)) && !/Expired API Key/.test(text(refused)), text(refused));

  const perm = (name) => () => json({ error: { type: 'invalid_request_error', message: `The provided key '${LIVE_RK.slice(0, 10)}*****TESTS' does not have the required permissions for this endpoint on account 'acct_1'. Having the '${name}' permission would allow this request to continue.` } }, 403);
  const r = await runStripeCheck({ env: READY, fetch: stripe({ '/v1/webhook_endpoints': perm('rak_webhook_read'), '/v1/account': perm('rak_accounts_kyc_basic_read') }).fetch });
  const t = text(r);
  assert.match(t, /FIX {3}The restricted key can’t read the webhook endpoints\. Add Webhook Endpoints: Read to the key \(Stripe calls it rak_webhook_read\)/);
  assert.match(t, /FIX {3}The restricted key can’t read the account details\. .*\(Stripe calls it rak_accounts_kyc_basic_read\)/);
  assert.match(t, /PASS {2}The Customer portal is set up/, 'the other checks still run');
  assert.ok(!leaks(t) && !/does not have the required/.test(t), t);
});

test('a network failure is a FIX naming the reason only', async () => {
  const fetch = async (_url, init) => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', message: `getaddrinfo ${init.headers.Authorization}` } });
  };
  const r = await runStripeCheck({ env: READY, fetch });
  const t = text(r);
  assert.match(t, /FIX {3}Couldn’t reach Stripe for the account details \(enotfound\)/);
  assert.ok(!leaks(t), t);
});

test('the settings around Stripe: each missing or wrong one is a FIX, and the server’s own verdict is shown', async () => {
  let called = 0;
  const fetch = async () => ((called += 1), json({}));
  const bare = await runStripeCheck({ env: {}, fetch });
  const t = text(bare);
  for (const re of [/STRIPE_SECRET_KEY is not set/, /STRIPE_WEBHOOK_SECRET is not set/, /PUBLIC_URL is not set/, /ADMIN_EMAILS is empty/, /LEGAL_NAME is not set/, /SUPPORT_EMAIL is not set/, /LEGAL_JURISDICTION is not set/, /TRUST_PROXY is not 1/, /would NOT take payments through Stripe \(payments: none\)/]) {
    assert.match(t, new RegExp(`FIX {3}.*${re.source}`), re.source);
  }
  assert.match(t, /NOTE {2}Skipped the Stripe checks: there is no usable key/);
  assert.equal(called, 0, 'no key, no call');

  const wrong = await runStripeCheck({ env: { ...READY, STRIPE_SECRET_KEY: 'pk_live_FAKE_FOR_TESTS', STRIPE_WEBHOOK_SECRET: 'FAKE_FOR_TESTS', PUBLIC_URL: 'http://blumodel.studio', DEMO_PAYMENTS: '1' }, fetch });
  const w = text(wrong);
  assert.match(w, /FIX {3}STRIPE_SECRET_KEY holds a publishable key/);
  assert.match(w, /FIX {3}STRIPE_WEBHOOK_SECRET is not a webhook signing secret/);
  assert.match(w, /FIX {3}PUBLIC_URL is http:\/\/blumodel\.studio: it must be the https address/);
  assert.match(w, /FIX {3}DEMO_PAYMENTS=1/);
  assert.equal(called, 0);
  assert.ok(!leaks(w), w);

  // A live key with an http PUBLIC_URL: the server would refuse Stripe, and the doctor says why.
  const http = await runStripeCheck({ env: { ...READY, PUBLIC_URL: 'http://127.0.0.1:8790' }, fetch: stripe().fetch });
  assert.match(text(http), /would NOT take payments through Stripe .*needs PUBLIC_URL to be the https address/);
  assert.match(text(http), /FIX {3}Can’t look for the webhook endpoint until PUBLIC_URL is the https address/);

  const testKey = await runStripeCheck({ env: { ...READY, STRIPE_SECRET_KEY: 'sk_test_FAKE_FOR_TESTS' }, fetch: stripe().fetch });
  assert.match(text(testKey), /PASS {2}Stripe key: test\n/);
  assert.match(text(testKey), /NOTE {2}This is a TEST key/);
  assert.match(text(testKey), /No test webhook endpoint|Webhook endpoint .* is enabled/);
});

// ── the CLI ──────────────────────────────────────────────────────────────

/** Runs the CLI with a temp home and none of the shell's settings names. */
function cli(args, tmp) {
  const env = { ...process.env, USERPROFILE: tmp, HOME: tmp, HOMEDRIVE: '', HOMEPATH: '' };
  for (const k of Object.keys(env)) if (/^(STRIPE_|BLUMODEL_|MISE_|PUBLIC_URL$|ADMIN_EMAILS$|LEGAL_|SUPPORT_EMAIL$|TRUST_PROXY$|DEMO_PAYMENTS$)/.test(k)) delete env[k];
  // Inherited from `node --test`, it makes the child a test-runner subprocess with its own exit codes.
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--no-warnings', CLI, ...args], { env, encoding: 'utf8', timeout: 30_000, windowsHide: true });
}

test('stripe:check CLI: reads the named settings file with the server’s loader, prints PASS/FIX, exits 1 with fixes; 2 with no file', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-stripecheck-'));
  try {
    assert.equal(os.homedir() === tmp, false);
    // No usable key (a publishable one), so the CLI makes no network call at all.
    const file = path.join(tmp, 'fake-settings.env');
    fs.writeFileSync(file, `# fake\r\nSTRIPE_SECRET_KEY=pk_live_FAKE_FOR_TESTS\r\nSTRIPE_WEBHOOK_SECRET=${WHSEC}\r\nPUBLIC_URL=https://blumodel.example\r\nADMIN_EMAILS=a@b.example\r\nnot a line\r\n`);
    const r = cli(['--settings', file], tmp);
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 1, out);
    assert.match(out, /Checking the Stripe setup in .*fake-settings\.env/);
    assert.match(out, /NOTE {2}Settings file: skipped line 6/);
    assert.match(out, /FIX {3}STRIPE_SECRET_KEY holds a publishable key/);
    assert.match(out, /PASS {2}STRIPE_WEBHOOK_SECRET is set/);
    assert.match(out, /PASS {2}PUBLIC_URL is https:\/\/blumodel\.example/);
    assert.match(out, /NOTE {2}Skipped the Stripe checks/);
    assert.match(out, /\d+ things to fix/);
    assert.ok(!leaks(out), out);

    // Nothing named and nothing in the (temp) home: exit 2 and say where it looked.
    const none = cli([], tmp);
    assert.equal(none.status, 2, none.stdout + none.stderr);
    assert.match(none.stderr, /No settings file found\. Looked for:/);
    assert.match(none.stderr, new RegExp(`${path.join(tmp, 'Projects', 'BluModelStudio', 'blumodel.env').replace(/\\/g, '\\\\')}`));

    const missing = cli(['--settings', path.join(tmp, 'nope.env')], tmp);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /Can't read the settings file .*nope\.env \(ENOENT\)/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
