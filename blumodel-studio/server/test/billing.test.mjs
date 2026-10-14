// Package G (billing): the export paywall, unlocks, plans, renewals and Stripe plumbing.
// No real Stripe call is ever made: Stripe-mode tests inject a mock fetch.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer, sampleDoc } from './helpers.mjs';

const GOLDEN_CSV = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'golden', 'sample-shopping-list.csv');
const KINDS = ['plan_png', 'scene_png', 'csv', 'json', 'render', 'quote'];
const DAY = 86_400_000;

let t;
before(async () => {
  t = await startTestServer({ env: { PAYMENTS: 'demo' } });
});
after(async () => {
  await t?.close();
});

const kitchen = async (agent, over = {}) => (await agent.post('/api/projects', { name: 'Test Kitchen', doc: sampleDoc(over) })).body.project;

/** Sessions last 30 days and billing periods about as long, so time travel signs in again. */
async function relogin(agent) {
  const r = await agent.post('/api/auth/login', { email: agent.user.email, password: agent.user.password });
  assert.equal(r.status, 200, r.text);
}

/** Buys through the DEMO provider: checkout, then "Simulate successful payment". */
async function demoBuy(agent, body) {
  const c = await agent.post('/api/billing/checkout', body);
  assert.equal(c.status, 200, c.text);
  assert.match(c.body.url, /^#\/pay\/demo-plan\/bc_[a-z0-9]{24}$/);
  const done = await agent.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.body.checkout.status, 'completed');
  return c.body.ref;
}

test('a free user is refused every export kind (403, needs unlock); someone else’s kitchen is a 404', async () => {
  const ann = await t.user();
  const bob = await t.user();
  const k = await kitchen(ann);
  for (const kind of KINDS) {
    const r = await ann.post(`/api/projects/${k.id}/exports`, { kind });
    assert.equal(r.status, 403, kind);
    assert.deepEqual(r.body, { error: 'Exports are a paid feature.', needs: 'unlock' });
    assert.equal((await bob.post(`/api/projects/${k.id}/exports`, { kind })).status, 404);
  }
  assert.equal((await ann.post(`/api/projects/${k.id}/exports`, { kind: 'pdf' })).status, 400);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM export_events').get().n, 0, 'refused exports are not recorded');
  const ent = await ann.get('/api/billing/entitlements');
  assert.deepEqual(ent.body, { plan: 'free', unlockedProjectIds: [] });
});

test('a $5 unlock covers that kitchen forever, including after edits; not another kitchen, not its duplicate', async () => {
  const ann = await t.user();
  const k1 = await kitchen(ann);
  const k2 = await kitchen(ann);
  await demoBuy(ann, { kind: 'kitchen_unlock', projectId: k1.id, amountCents: 1 });
  const csv = await ann.post(`/api/projects/${k1.id}/exports`, { kind: 'csv' });
  assert.equal(csv.status, 200);
  assert.equal(csv.body.file.contentType, 'text/csv');
  assert.equal(csv.body.file.filename, 'test-kitchen-shopping-list.csv');
  assert.equal((await ann.post(`/api/projects/${k2.id}/exports`, { kind: 'csv' })).status, 403);

  // Edited and renamed: still unlocked.
  const saved = await ann.put(`/api/projects/${k1.id}`, { name: 'Renamed', revision: k1.revision, doc: sampleDoc({ items: [] }) });
  assert.equal(saved.status, 200);
  assert.equal((await ann.post(`/api/projects/${k1.id}/exports`, { kind: 'plan_png' })).status, 200);

  const dup = (await ann.post(`/api/projects/${k1.id}/duplicate`)).body.project;
  assert.equal((await ann.post(`/api/projects/${dup.id}/exports`, { kind: 'csv' })).status, 403, 'a duplicate is a new kitchen');

  const ent = (await ann.get('/api/billing/entitlements')).body;
  assert.deepEqual(ent, { plan: 'free', unlockedProjectIds: [k1.id] });
  const me = (await ann.get('/api/billing/me')).body;
  assert.equal(me.unlocks.length, 1);
  assert.equal(me.receipts[0].kind, 'kitchen_unlock');
  assert.equal(me.receipts[0].amountCents, 500, 'the server price, not the client’s');
  // Buying it again is refused.
  assert.equal((await ann.post('/api/billing/checkout', { kind: 'kitchen_unlock', projectId: k1.id })).status, 409);
});

test('Unlimited exports every kitchen its subscriber owns, never someone else’s', async () => {
  const ann = await t.user();
  const bob = await t.user();
  const mine = [await kitchen(ann), await kitchen(ann)];
  const theirs = await kitchen(bob);
  await demoBuy(ann, { kind: 'subscription', plan: 'unlimited' });
  for (const k of mine) assert.equal((await ann.post(`/api/projects/${k.id}/exports`, { kind: 'json' })).status, 200);
  assert.equal((await ann.post(`/api/projects/${theirs.id}/exports`, { kind: 'json' })).status, 404);
  assert.equal((await bob.post(`/api/projects/${theirs.id}/exports`, { kind: 'json' })).status, 403, 'a plan never covers other people');
  const me = (await ann.get('/api/auth/me')).body.user;
  assert.equal(me.plan.id, 'unlimited');
  assert.equal(me.plan.status, 'active');
  // A second subscription is refused; plan changes go through Billing.
  const again = await ann.post('/api/billing/checkout', { kind: 'subscription', plan: 'contractor' });
  assert.equal(again.status, 409);
  assert.equal(again.body.plan, 'unlimited');
});

test('cancelling keeps the plan to the end of the paid period, then it is Free; resume undoes a cancel', async () => {
  const ann = await t.user();
  const k = await kitchen(ann);
  const t0 = Date.now();
  t.setNow(t0);
  try {
    await demoBuy(ann, { kind: 'subscription', plan: 'unlimited' });
    const cancel = await ann.post('/api/billing/cancel');
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.subscription.cancelAtPeriodEnd, true);
    const end = cancel.body.subscription.currentPeriodEnd;
    assert.ok(end > t0 + 27 * DAY && end < t0 + 32 * DAY, 'one month');
    t.setNow(end - 1000);
    await relogin(ann);
    assert.equal((await ann.post(`/api/projects/${k.id}/exports`, { kind: 'csv' })).status, 200, 'still paid for');
    const resumed = await ann.post('/api/billing/resume');
    assert.equal(resumed.body.subscription.cancelAtPeriodEnd, false);
    await ann.post('/api/billing/cancel');
    t.setNow(end + 1000);
    assert.equal((await ann.post(`/api/projects/${k.id}/exports`, { kind: 'csv' })).status, 403, 'ended');
    const me = (await ann.get('/api/billing/me')).body;
    assert.equal(me.plan.id, 'free');
    assert.equal(me.subscription.status, 'canceled');
    // They can subscribe again.
    await demoBuy(ann, { kind: 'subscription', plan: 'contractor' });
    assert.equal((await ann.get('/api/auth/me')).body.user.plan.id, 'contractor');
  } finally {
    t.setNow(null);
  }
});

test('a failed renewal keeps the plan for 7 days of grace, then exports stop until it is paid', async () => {
  const ann = await t.user();
  const k = await kitchen(ann);
  const t0 = Date.now();
  t.setNow(t0);
  try {
    await demoBuy(ann, { kind: 'subscription', plan: 'unlimited' });
    const failed = await ann.post('/api/billing/demo/simulate', { event: 'renewal_failed' });
    assert.equal(failed.body.subscription.status, 'past_due');
    assert.equal(failed.body.subscription.graceUntil, t0 + 7 * DAY);
    assert.equal(failed.body.plan.id, 'unlimited', 'still on the plan during grace');
    t.setNow(t0 + 7 * DAY - 1);
    assert.equal((await ann.post(`/api/projects/${k.id}/exports`, { kind: 'csv' })).status, 200);
    t.setNow(t0 + 7 * DAY + 1);
    assert.equal((await ann.post(`/api/projects/${k.id}/exports`, { kind: 'csv' })).status, 403);
    assert.equal((await ann.get('/api/auth/me')).body.user.plan.id, 'free');
    const renewed = await ann.post('/api/billing/demo/simulate', { event: 'renewal' });
    assert.equal(renewed.body.plan.id, 'unlimited', 'paying again restores the plan');
    assert.equal(renewed.body.subscription.graceUntil, null);
    assert.ok(renewed.body.receipts.some((r) => r.kind === 'renewal'));
  } finally {
    t.setNow(null);
  }
});

test('a demo plan renews itself at the end of each period, with a receipt', async () => {
  const ann = await t.user();
  const t0 = Date.now();
  t.setNow(t0);
  try {
    await demoBuy(ann, { kind: 'subscription', plan: 'contractor' });
    const end = (await ann.get('/api/billing/me')).body.subscription.currentPeriodEnd;
    t.setNow(end + DAY);
    await relogin(ann);
    const me = (await ann.get('/api/billing/me')).body;
    assert.equal(me.plan.id, 'contractor');
    assert.ok(me.subscription.currentPeriodEnd > end + DAY);
    assert.equal(me.receipts.filter((r) => r.kind === 'renewal').length, 1);
  } finally {
    t.setNow(null);
  }
});

test('changing plan (demo) moves Unlimited ↔ Contractor; a declined demo payment can be retried', async () => {
  const ann = await t.user();
  const c = await ann.post('/api/billing/checkout', { kind: 'subscription', plan: 'unlimited' });
  const declined = await ann.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'decline' });
  assert.equal(declined.body.checkout.status, 'failed');
  assert.equal((await ann.get('/api/auth/me')).body.user.plan.id, 'free');
  const retry = await ann.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' });
  assert.equal(retry.body.checkout.status, 'completed');
  const twice = await ann.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' });
  assert.equal(twice.status, 200, 'completing twice is harmless');
  assert.equal((await ann.get('/api/billing/me')).body.receipts.length, 1, 'and charges once');
  const up = await ann.post('/api/billing/change', { plan: 'contractor' });
  assert.equal(up.body.plan.id, 'contractor');
  assert.equal((await ann.post('/api/billing/change', { plan: 'contractor' })).status, 409);
  const down = await ann.post('/api/billing/change', { plan: 'unlimited' });
  assert.equal(down.body.plan.id, 'unlimited');
  // Another user can't touch this checkout.
  const bob = await t.user();
  assert.equal((await bob.get(`/api/billing/checkouts/${c.body.ref}`)).status, 404);
  assert.equal((await bob.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' })).status, 404);
});

test('the server CSV is byte-for-byte the editor’s (golden), and the project file carries no costs', async () => {
  const ann = await t.user();
  const k = await kitchen(ann, { extras: [{ id: 'x1', label: 'Installation', amount: 1200, cost: 700 }] });
  await demoBuy(ann, { kind: 'kitchen_unlock', projectId: k.id });
  const plain = await kitchen(ann);
  await demoBuy(ann, { kind: 'kitchen_unlock', projectId: plain.id });
  const csv = await ann.post(`/api/projects/${plain.id}/exports`, { kind: 'csv' });
  assert.equal(csv.body.file.content, fs.readFileSync(GOLDEN_CSV, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, ''));

  const withExtras = await ann.post(`/api/projects/${k.id}/exports`, { kind: 'csv' });
  assert.match(withExtras.body.file.content, /Services,Installation,Labour & services,,1,job,1200,1200,/);
  assert.doesNotMatch(withExtras.body.file.content, /700/);

  const json = await ann.post(`/api/projects/${k.id}/exports`, { kind: 'json' });
  assert.equal(json.body.file.filename, 'test-kitchen.kitchen.json');
  const parsed = JSON.parse(json.body.file.content);
  assert.equal(parsed.app, 'mise-kitchen');
  assert.deepEqual(parsed.doc.extras, [{ id: 'x1', label: 'Installation', amount: 1200 }], 'the cost is stripped');
  // The owner's own saved kitchen keeps its cost.
  assert.equal((await ann.get(`/api/projects/${k.id}`)).body.project.doc.extras[0].cost, 700);
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM export_events WHERE project_id = ? AND kind IN ('csv','json')").get(k.id).n, 2);
});

test('demo payments are refused in production unless DEMO_PAYMENTS=1', async () => {
  const prod = await startTestServer({ env: { PAYMENTS: 'demo', NODE_ENV: 'production' } });
  try {
    const u = await prod.user();
    const c = await u.post('/api/billing/checkout', { kind: 'subscription', plan: 'unlimited' });
    assert.equal(c.status, 403);
    assert.match(c.body.error, /turned off/);
  } finally {
    await prod.close();
  }
  const allowed = await startTestServer({ env: { PAYMENTS: 'demo', NODE_ENV: 'production', DEMO_PAYMENTS: '1' } });
  try {
    const u = await allowed.user();
    assert.equal((await u.post('/api/billing/checkout', { kind: 'subscription', plan: 'unlimited' })).status, 200);
  } finally {
    await allowed.close();
  }
});

test('admin billing keeps demo numbers apart and needs the admin role', async () => {
  const ann = await t.user();
  const admin = await t.user({ role: 'admin' });
  assert.equal((await ann.get('/api/admin/billing')).status, 403);
  const r = await admin.get('/api/admin/billing');
  assert.equal(r.status, 200);
  assert.equal(r.body.payments, 'demo');
  assert.ok(r.body.demo.mrrCents >= 1500);
  assert.equal(r.body.stripe.mrrCents, 0);
  assert.equal(typeof r.body.demo.churn30d, 'number');
});

// ── Stripe mode, with a mocked fetch ─────────────────────────────────────

const SECRET = 'whsec_test_secret';
function signed(event, secret = SECRET, ts = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
  return { body, header: `t=${ts},v1=${sig}` };
}

function stripeMock() {
  const calls = [];
  let n = 0;
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const form = new URLSearchParams(init.body ?? '');
    calls.push({ method: init.method, path: u.pathname, query: u.searchParams, form, headers: init.headers });
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.pathname === '/v1/checkout/sessions' && init.method === 'POST') return json({ id: `cs_test_${++n}`, url: `https://checkout.stripe.com/c/pay/cs_test_${n}` });
    if (u.pathname.startsWith('/v1/checkout/sessions/')) return json(stripeMock.session);
    if (u.pathname === '/v1/billing_portal/sessions') return json({ url: 'https://billing.stripe.com/p/session/x' });
    if (u.pathname.startsWith('/v1/subscriptions/') && init.method === 'POST') return json({ ...stripeMock.subscription, cancel_at_period_end: form.get('cancel_at_period_end') === 'true' });
    return json({ error: { message: 'not mocked' } }, 400);
  };
  return { fetch, calls };
}

test('Stripe mode: checkout is built on the server’s price with metadata, return URLs and an idempotency key', async () => {
  const mock = stripeMock();
  const s = await startTestServer({ env: { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET, PUBLIC_URL: 'https://mise.example' }, fetch: mock.fetch });
  try {
    assert.equal((await s.agent().get('/api/config')).body.payments, 'stripe');
    const ann = await s.user();
    const k = await kitchen(ann);
    const unlock = await ann.post('/api/billing/checkout', { kind: 'kitchen_unlock', projectId: k.id, amountCents: 1, priceCents: 1 });
    assert.equal(unlock.status, 200, unlock.text);
    assert.match(unlock.body.url, /^https:\/\/checkout\.stripe\.com\//);
    const c1 = mock.calls[0];
    assert.equal(c1.path, '/v1/checkout/sessions');
    assert.equal(c1.headers.Authorization, 'Bearer sk_test_x');
    assert.equal(c1.headers['Idempotency-Key'], `${unlock.body.ref}-checkout`);
    assert.equal(c1.form.get('mode'), 'payment');
    assert.equal(c1.form.get('line_items[0][price_data][unit_amount]'), '500', 'server price; client amounts ignored');
    assert.equal(c1.form.get('line_items[0][price_data][currency]'), 'usd');
    assert.equal(c1.form.get('metadata[kind]'), 'kitchen_unlock');
    assert.equal(c1.form.get('metadata[checkout_ref]'), unlock.body.ref);
    assert.equal(c1.form.get('metadata[project_id]'), k.id);
    assert.equal(c1.form.get('client_reference_id'), unlock.body.ref);
    assert.equal(c1.form.get('success_url'), `https://mise.example/?session_id={CHECKOUT_SESSION_ID}#/k/${k.id}`);
    assert.equal(c1.form.get('cancel_url'), `https://mise.example/#/k/${k.id}`);

    const sub = await ann.post('/api/billing/checkout', { kind: 'subscription', plan: 'contractor' });
    const c2 = mock.calls[1];
    assert.equal(c2.form.get('mode'), 'subscription');
    assert.equal(c2.form.get('line_items[0][price_data][unit_amount]'), '4000');
    assert.equal(c2.form.get('line_items[0][price_data][recurring][interval]'), 'month');
    assert.equal(c2.form.get('subscription_data[metadata][plan]'), 'contractor');
    assert.equal(c2.form.get('subscription_data[metadata][user_id]'), ann.id);
    assert.equal(c2.form.get('success_url'), 'https://mise.example/?session_id={CHECKOUT_SESSION_ID}#/pro');
    assert.ok(sub.body.ref);

    // Demo completion is refused when Stripe is the provider.
    assert.equal((await ann.post(`/api/billing/demo/${unlock.body.ref}/complete`, { outcome: 'success' })).status, 403);
  } finally {
    await s.close();
  }
});

test('Stripe webhooks: verified, deduplicated, amount-checked; subscription events and invoices update the plan', async () => {
  const mock = stripeMock();
  const s = await startTestServer({ env: { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET }, fetch: mock.fetch });
  const post = (ev, header) => s.agent().request('POST', '/api/webhooks/stripe', { raw: ev.body, contentType: 'application/json', headers: { 'Stripe-Signature': header ?? ev.header }, csrf: false });
  try {
    const ann = await s.user();
    const k = await kitchen(ann);
    const ref = (await ann.post('/api/billing/checkout', { kind: 'kitchen_unlock', projectId: k.id })).body.ref;
    const session = (over = {}) => ({
      id: `evt_${crypto.randomBytes(6).toString('hex')}`,
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 500, currency: 'usd', client_reference_id: ref, metadata: { kind: 'kitchen_unlock', checkout_ref: ref }, ...over } },
    });

    // Unverified → 400 and nothing changes.
    const forged = signed(session(), 'whsec_wrong');
    assert.equal((await post(forged)).status, 400);
    const stale = signed(session(), SECRET, Math.floor(Date.now() / 1000) - 600);
    assert.equal((await post(stale)).status, 400, 'older than the 5-minute tolerance');

    // Wrong amount → recorded but not fulfilled.
    const cheap = signed(session({ amount_total: 100 }));
    assert.equal((await post(cheap)).status, 200);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM kitchen_unlocks').get().n, 0);

    // The real one, delivered twice → one unlock, one receipt.
    const ev = session();
    const signedEv = signed(ev);
    assert.equal((await post(signedEv)).status, 200);
    const again = await post(signed(ev));
    assert.equal(again.body.duplicate, true);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM kitchen_unlocks WHERE project_id = ?').get(k.id).n, 1);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM billing_payments').get().n, 1);
    assert.equal((await ann.post(`/api/projects/${k.id}/exports`, { kind: 'csv' })).status, 200);

    // A subscription created and updated by Stripe events (newer API shape: period on items).
    const end = Math.floor(Date.now() / 1000) + 30 * 86400;
    const subObj = { id: 'sub_1', object: 'subscription', status: 'active', customer: 'cus_1', cancel_at_period_end: false, metadata: { kind: 'subscription', user_id: ann.id, plan: 'unlimited' }, items: { data: [{ id: 'si_1', current_period_end: end, price: { unit_amount: 1500 } }] } };
    await post(signed({ id: 'evt_sub_created', type: 'customer.subscription.created', data: { object: subObj } }));
    let me = (await ann.get('/api/billing/me')).body;
    assert.equal(me.plan.id, 'unlimited');
    assert.equal(me.subscription.currentPeriodEnd, end * 1000);

    // Payment fails: past due with grace; paid again (older API shape: invoice.subscription).
    await post(signed({ id: 'evt_inv_fail', type: 'invoice.payment_failed', data: { object: { id: 'in_1', subscription: 'sub_1' } } }));
    me = (await ann.get('/api/billing/me')).body;
    assert.equal(me.subscription.status, 'past_due');
    assert.ok(me.subscription.graceUntil > Date.now());
    await post(signed({ id: 'evt_inv_paid', type: 'invoice.paid', data: { object: { id: 'in_2', billing_reason: 'subscription_cycle', amount_paid: 1500, parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [{ period: { end: end + 30 * 86400 } }] } } } }));
    me = (await ann.get('/api/billing/me')).body;
    assert.equal(me.subscription.status, 'active');
    assert.equal(me.subscription.graceUntil, null);
    assert.equal(me.subscription.currentPeriodEnd, (end + 30 * 86400) * 1000);
    assert.ok(me.receipts.some((r) => r.kind === 'renewal' && r.amountCents === 1500));

    // Deleted → Free.
    await post(signed({ id: 'evt_sub_deleted', type: 'customer.subscription.deleted', data: { object: { ...subObj, status: 'canceled' } } }));
    assert.equal((await ann.get('/api/auth/me')).body.user.plan.id, 'free');

    // The webhook needs no X-Mise header, but every other POST still does.
    assert.equal((await ann.request('POST', '/api/billing/cancel', { body: {}, csrf: false })).status, 403);
  } finally {
    await s.close();
  }
});

test('Stripe mode: a handler that throws leaves the event unrecorded, so Stripe’s retry is processed', async () => {
  const s = await startTestServer({ env: { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET } });
  try {
    let calls = 0;
    s.services.webhooks.on('test.boom', () => {
      calls++;
      if (calls === 1) throw new Error('boom');
    });
    const ev = { id: 'evt_boom', type: 'test.boom', data: { object: {} } };
    const post = () => {
      const x = signed(ev);
      return s.agent().request('POST', '/api/webhooks/stripe', { raw: x.body, contentType: 'application/json', headers: { 'Stripe-Signature': x.header }, csrf: false });
    };
    assert.equal((await post()).status, 500);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM webhook_events WHERE event_id = 'evt_boom'").get().n, 0);
    assert.equal((await post()).status, 200);
    assert.equal(calls, 2);
    assert.equal((await post()).body.duplicate, true);
    assert.equal(calls, 2);
  } finally {
    await s.close();
  }
});

test('Stripe mode: return sync, cancel and the customer portal call Stripe with the stored refs', async () => {
  const mock = stripeMock();
  const s = await startTestServer({ env: { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: SECRET }, fetch: mock.fetch });
  try {
    const ann = await s.user();
    const ref = (await ann.post('/api/billing/checkout', { kind: 'subscription', plan: 'unlimited' })).body.ref;
    const end = Math.floor(Date.now() / 1000) + 31 * 86400;
    stripeMock.subscription = { id: 'sub_9', status: 'active', customer: 'cus_9', cancel_at_period_end: false, current_period_end: end, metadata: { kind: 'subscription', user_id: ann.id, plan: 'unlimited' } };
    stripeMock.session = { id: 'cs_test_9', payment_status: 'paid', amount_total: 1500, currency: 'usd', client_reference_id: ref, customer: 'cus_9', subscription: stripeMock.subscription, metadata: { kind: 'subscription', checkout_ref: ref } };
    const sync = await ann.post('/api/billing/sync', { sessionId: 'cs_test_9' });
    assert.equal(sync.status, 200, sync.text);
    assert.equal(sync.body.entitlements.plan, 'unlimited');
    assert.equal(sync.body.checkout.status, 'completed');
    const retrieve = mock.calls.find((c) => c.path === '/v1/checkout/sessions/cs_test_9');
    assert.equal(retrieve.query.get('expand[0]'), 'subscription');

    const cancel = await ann.post('/api/billing/cancel');
    assert.equal(cancel.status, 200, cancel.text);
    const upd = mock.calls.find((c) => c.path === '/v1/subscriptions/sub_9');
    assert.equal(upd.form.get('cancel_at_period_end'), 'true');
    assert.equal(cancel.body.subscription.cancelAtPeriodEnd, true);

    const portal = await ann.post('/api/billing/portal');
    assert.equal(portal.body.url, 'https://billing.stripe.com/p/session/x');
    assert.equal(mock.calls.find((c) => c.path === '/v1/billing_portal/sessions').form.get('customer'), 'cus_9');

    // Another user can't sync someone else's session.
    const bob = await s.user();
    assert.equal((await bob.post('/api/billing/sync', { sessionId: 'cs_test_9' })).status, 404);
  } finally {
    await s.close();
  }
});
