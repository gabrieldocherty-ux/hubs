// The 2026-10-15 pricing change, part 1: Canadian dollars.
//   - every plan is priced in CAD ($5 unlock, $15 Unlimited, $99 Contractor) and every new
//     checkout, unlock, subscription and receipt is stored in CAD;
//   - rows stored before keep their own currency and amount (the pricing-001 backfill), and an
//     existing subscription is never silently repriced; a plan change uses the new CAD price;
//   - a Stripe customer that paid in USD is never reused for a CAD checkout (Stripe refuses mixed
//     currencies): the checkout starts a fresh customer, which is then remembered for CAD;
//   - a Stripe subscription billed in USD can't be switched in place (409 currency_change).
// Stripe is only ever a mocked fetch, with obviously fake keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestServer, sampleDoc } from './helpers.mjs';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { MIGRATION_MODULES, MIGRATION_KEYS } from '../db/migrations/index.mjs';
import { PLANS, CURRENCY } from '../lib/plans.mjs';

const WHSEC = 'whsec_FAKE_FOR_TESTS';
const STRIPE_ENV = { STRIPE_SECRET_KEY: 'sk_test_FAKE_FOR_TESTS', STRIPE_WEBHOOK_SECRET: WHSEC, PUBLIC_URL: 'https://blumodel.example' };

const kitchen = async (agent) => (await agent.post('/api/projects', { name: 'Maple Kitchen', doc: sampleDoc() })).body.project;
function signed(event) {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(event);
  return { body, header: `t=${ts},v1=${crypto.createHmac('sha256', WHSEC).update(`${ts}.${body}`).digest('hex')}` };
}
const hook = (s, ev) => s.agent().request('POST', '/api/webhooks/stripe', { raw: ev.body, contentType: 'application/json', headers: { 'Stripe-Signature': ev.header }, csrf: false });

async function demoBuy(agent, body) {
  const c = await agent.post('/api/billing/checkout', body);
  assert.equal(c.status, 200, c.text);
  const done = await agent.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' });
  assert.equal(done.status, 200, done.text);
  return c.body.ref;
}

test('every plan is priced in CAD: $5 unlock, $15 Unlimited, $99 Contractor', async () => {
  assert.equal(CURRENCY, 'cad');
  assert.deepEqual(
    PLANS.map((p) => [p.id, p.priceCents, p.currency]),
    [
      ['free', 0, 'cad'],
      ['kitchen_unlock', 500, 'cad'],
      ['unlimited', 1500, 'cad'],
      ['contractor', 9900, 'cad'],
    ],
  );
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const r = await s.agent().get('/api/billing/plans');
    assert.equal(r.status, 200);
    assert.equal(r.body.plans.find((p) => p.id === 'contractor').priceCents, 9900);
    assert.ok(r.body.plans.every((p) => p.currency === 'cad'));
  } finally {
    await s.close();
  }
});

test('pricing-001 marks every older row as USD and keeps its amount; old Stripe customers are remembered as USD', () => {
  const db = openDb(':memory:');
  const before = MIGRATION_MODULES.map((m, i) => (MIGRATION_KEYS[i] === 'pricing' ? { steps: [] } : m));
  migrate(db, { modules: before });
  const ts = Date.UTC(2026, 9, 1);
  const user = db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)');
  user.run('u_oldcontractor', 'old-pro@example.test', 'Old pro', 'x', ts);
  user.run('u_oldunlimited', 'old-unl@example.test', 'Old unlimited', 'x', ts);
  user.run('u_oldcomp', 'old-comp@example.test', 'Old comp', 'x', ts);
  const sub = db.prepare(
    `INSERT INTO subscriptions (id, user_id, plan, status, provider, customer_ref, subscription_ref, current_period_end, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
  );
  sub.run('sub_a', 'u_oldcontractor', 'contractor', 'stripe', 'cus_usd_a', 'sub_usd_a', ts + 20 * 86_400_000, ts, ts);
  sub.run('sub_b', 'u_oldunlimited', 'unlimited', 'demo', null, 'demo_b', ts + 20 * 86_400_000, ts, ts);
  sub.run('sub_c', 'u_oldcomp', 'contractor', 'comp', null, null, null, ts, ts);
  db.prepare("INSERT INTO projects (id, user_id, name, doc, revision, created_at, updated_at) VALUES ('k_old1', 'u_oldunlimited', 'Old', '{}', 1, ?, ?)").run(ts, ts);
  db.prepare("INSERT INTO kitchen_unlocks (project_id, user_id, provider, payment_ref, amount_cents, created_at) VALUES ('k_old1', 'u_oldunlimited', 'demo', 'bc_old', 500, ?)").run(ts);
  db.prepare("INSERT INTO billing_payments (id, user_id, kind, plan, amount_cents, provider, ref, created_at) VALUES ('pay_old', 'u_oldcontractor', 'subscription', 'contractor', 4000, 'stripe', 'cs_old', ?)").run(ts);

  assert.deepEqual(migrate(db), ['pricing-001-cad']);
  const subs = db.prepare('SELECT id, amount_cents, currency FROM subscriptions ORDER BY id').all().map((r) => ({ ...r }));
  assert.deepEqual(subs, [
    { id: 'sub_a', amount_cents: 4000, currency: 'usd' },
    { id: 'sub_b', amount_cents: 1500, currency: 'usd' },
    { id: 'sub_c', amount_cents: null, currency: null },
  ]);
  assert.equal(db.prepare('SELECT currency FROM kitchen_unlocks').get().currency, 'usd');
  assert.deepEqual({ ...db.prepare('SELECT amount_cents, currency FROM billing_payments').get() }, { amount_cents: 4000, currency: 'usd' });
  assert.deepEqual(db.prepare('SELECT user_id, currency, customer_ref FROM billing_customers').all().map((r) => ({ ...r })), [{ user_id: 'u_oldcontractor', currency: 'usd', customer_ref: 'cus_usd_a' }]);
  assert.deepEqual(migrate(db), [], 'a second run is a no-op');
  db.close();
});

test('demo: new unlocks, plans and receipts are CAD; an older USD plan renews at its own price; a plan change takes the CAD price', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const ann = await s.user();
    const k = await kitchen(ann);
    const ref = await demoBuy(ann, { kind: 'kitchen_unlock', projectId: k.id });
    assert.equal(s.db.prepare('SELECT currency FROM billing_checkouts WHERE ref = ?').get(ref).currency, 'cad');
    assert.equal(s.db.prepare('SELECT currency FROM kitchen_unlocks WHERE project_id = ?').get(k.id).currency, 'cad');
    let me = (await ann.get('/api/billing/me')).body;
    assert.deepEqual(me.unlocks.map((u) => [u.amountCents, u.currency]), [[500, 'cad']]);
    assert.deepEqual(me.receipts.map((r) => [r.kind, r.amountCents, r.currency]), [['kitchen_unlock', 500, 'cad']]);

    await demoBuy(ann, { kind: 'subscription', plan: 'contractor' });
    me = (await ann.get('/api/billing/me')).body;
    assert.equal(me.subscription.amountCents, 9900);
    assert.equal(me.subscription.currency, 'cad');

    // An older subscription billed $40 USD: renewals stay $40 USD (never silently repriced)…
    const bob = await s.user();
    await demoBuy(bob, { kind: 'subscription', plan: 'contractor' });
    s.db.prepare("UPDATE subscriptions SET amount_cents = 4000, currency = 'usd' WHERE user_id = ?").run(bob.id);
    const renewed = await bob.post('/api/billing/demo/simulate', { event: 'renewal' });
    assert.equal(renewed.status, 200, renewed.text);
    assert.deepEqual(renewed.body.receipts.filter((r) => r.kind === 'renewal').map((r) => [r.amountCents, r.currency]), [[4000, 'usd']]);
    assert.equal(renewed.body.subscription.amountCents, 4000);
    assert.equal(renewed.body.subscription.currency, 'usd');
    // …MRR counts it in its own currency…
    const admin = await s.user({ role: 'admin' });
    const stats = (await admin.get('/api/admin/billing')).body.demo;
    assert.equal(stats.mrrByCurrency.usd, 4000);
    assert.equal(stats.mrrByCurrency.cad, 9900);
    assert.equal(stats.mrrCents, 9900, 'the headline MRR is CAD only');
    // …and a plan change is billed at today's CAD price.
    const changed = await bob.post('/api/billing/change', { plan: 'unlimited' });
    assert.equal(changed.status, 200, changed.text);
    assert.equal(changed.body.subscription.amountCents, 1500);
    assert.equal(changed.body.subscription.currency, 'cad');
  } finally {
    await s.close();
  }
});

/** A Stripe stand-in that records checkout sessions and serves one subscription. */
function stripeMock() {
  const calls = [];
  let n = 0;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const form = new URLSearchParams(init.body ?? '');
    calls.push({ method: init.method, path: u.pathname, form });
    if (u.hostname !== 'api.stripe.com') return json({ error: { type: 'invalid_request_error' } }, 400);
    if (u.pathname === '/v1/checkout/sessions' && init.method === 'POST') return json({ id: `cs_test_${++n}`, url: `https://checkout.stripe.com/c/pay/cs_test_${n}` });
    return json({ error: { type: 'invalid_request_error', code: 'resource_missing' } }, 404);
  };
  return { fetch, calls };
}

test('Stripe: a customer that paid in USD is never reused for a CAD checkout; the new CAD customer is remembered', async () => {
  const mock = stripeMock();
  const s = await startTestServer({ env: STRIPE_ENV, fetch: mock.fetch });
  try {
    const ann = await s.user();
    // Ann had a USD plan before 2026-10-15 (as pricing-001 leaves it): ended, customer on file.
    const t0 = Date.now();
    s.db
      .prepare(
        `INSERT INTO subscriptions (id, user_id, plan, status, provider, customer_ref, subscription_ref, current_period_end, canceled_at, created_at, updated_at, amount_cents, currency)
         VALUES ('sub_oldann', ?, 'unlimited', 'canceled', 'stripe', 'cus_usd_ann', 'sub_usd_ann', ?, ?, ?, ?, 1500, 'usd')`,
      )
      .run(ann.id, t0 - 86_400_000, t0 - 86_400_000, t0 - 60 * 86_400_000, t0);
    s.db.prepare("INSERT INTO billing_customers (user_id, currency, customer_ref, created_at) VALUES (?, 'usd', 'cus_usd_ann', ?)").run(ann.id, t0);

    const c = await ann.post('/api/billing/checkout', { kind: 'subscription', plan: 'contractor' });
    assert.equal(c.status, 200, c.text);
    const first = mock.calls.find((x) => x.path === '/v1/checkout/sessions');
    assert.equal(first.form.get('line_items[0][price_data][currency]'), 'cad');
    assert.equal(first.form.get('line_items[0][price_data][unit_amount]'), '9900');
    assert.equal(first.form.get('customer'), null, 'the USD customer is not passed to a CAD checkout');
    assert.equal(first.form.get('customer_email'), ann.user.email);

    // Paid: Stripe made a new customer; it is recorded for CAD, and the USD one stays as it was.
    const done = await hook(s, signed({ id: 'evt_cad_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 9900, currency: 'cad', client_reference_id: c.body.ref, customer: 'cus_cad_ann', subscription: 'sub_cad_ann', metadata: { kind: 'subscription', checkout_ref: c.body.ref } } } }));
    assert.equal(done.status, 200, done.text);
    const customers = s.db.prepare('SELECT currency, customer_ref FROM billing_customers WHERE user_id = ? ORDER BY currency').all(ann.id).map((r) => ({ ...r }));
    assert.deepEqual(customers, [
      { currency: 'cad', customer_ref: 'cus_cad_ann' },
      { currency: 'usd', customer_ref: 'cus_usd_ann' },
    ]);
    const me = (await ann.get('/api/billing/me')).body;
    assert.equal(me.plan.id, 'contractor');
    assert.equal(me.subscription.currency, 'cad');
    assert.equal(me.subscription.amountCents, 9900);

    // The next CAD checkout reuses the CAD customer.
    const k = await kitchen(ann);
    s.db.prepare("UPDATE subscriptions SET status = 'canceled' WHERE user_id = ?").run(ann.id); // free again, so the unlock is offered
    const u = await ann.post('/api/billing/checkout', { kind: 'kitchen_unlock', projectId: k.id });
    assert.equal(u.status, 200, u.text);
    const second = mock.calls.filter((x) => x.path === '/v1/checkout/sessions')[1];
    assert.equal(second.form.get('customer'), 'cus_cad_ann');
    assert.equal(second.form.get('line_items[0][price_data][currency]'), 'cad');
    assert.equal(second.form.get('line_items[0][price_data][unit_amount]'), '500');

    // A webhook paying the CAD checkout in USD (or another amount) is not fulfilled.
    const bob = await s.user();
    const k2 = await kitchen(bob);
    const c2 = await bob.post('/api/billing/checkout', { kind: 'kitchen_unlock', projectId: k2.id });
    await hook(s, signed({ id: 'evt_usd_wrong', type: 'checkout.session.completed', data: { object: { id: 'cs_test_x', payment_status: 'paid', amount_total: 500, currency: 'usd', client_reference_id: c2.body.ref, metadata: { kind: 'kitchen_unlock', checkout_ref: c2.body.ref } } } }));
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM kitchen_unlocks WHERE project_id = ?').get(k2.id).n, 0);
  } finally {
    await s.close();
  }
});

test('Stripe: a subscription still billed in USD keeps its price on updates and can’t be switched in place', async () => {
  const mock = stripeMock();
  const s = await startTestServer({ env: STRIPE_ENV, fetch: mock.fetch });
  try {
    const ann = await s.user();
    const end = Math.floor(Date.now() / 1000) + 20 * 86400;
    // An update event for a subscription Stripe bills at the old $40 USD (no plan in its metadata).
    const legacy = { id: 'sub_usd_1', object: 'subscription', status: 'active', currency: 'usd', customer: 'cus_usd_1', cancel_at_period_end: false, metadata: { user_id: ann.id }, items: { data: [{ id: 'si_usd', current_period_end: end, price: { unit_amount: 4000, currency: 'usd' } }] } };
    assert.equal((await hook(s, signed({ id: 'evt_legacy', type: 'customer.subscription.updated', data: { object: legacy } }))).status, 200);
    const me = (await ann.get('/api/billing/me')).body;
    assert.equal(me.plan.id, 'contractor', 'the old $40 USD price is still recognised as Contractor');
    assert.equal(me.subscription.amountCents, 4000);
    assert.equal(me.subscription.currency, 'usd');
    assert.equal(s.db.prepare("SELECT customer_ref FROM billing_customers WHERE user_id = ? AND currency = 'usd'").get(ann.id).customer_ref, 'cus_usd_1');

    const before = mock.calls.length;
    const change = await ann.post('/api/billing/change', { plan: 'unlimited' });
    assert.equal(change.status, 409, change.text);
    assert.equal(change.body.code, 'currency_change');
    assert.equal(change.body.currency, 'usd');
    assert.equal(change.body.periodEnd, end * 1000);
    assert.equal(mock.calls.length, before, 'nothing was sent to Stripe');
  } finally {
    await s.close();
  }
});
