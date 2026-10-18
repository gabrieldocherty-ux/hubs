// Launch contract, admin side and the Stripe chain end to end:
//   - an admin exports their own kitchens without paying (server-side), and each such export is
//     audit-logged; nobody else gets that;
//   - POST /api/admin/billing/grant and DELETE /api/admin/billing/grant/:id give and take back a
//     complimentary plan (provider 'comp'): admin-only, CSRF-gated, audit-logged;
//   - the webhook event list (server/payments/webhookEvents.mjs) is exactly what the handlers use;
//   - Stripe mode: signed webhooks within the 300 s tolerance only, a plan change through the
//     Stripe API, and a late Stripe event never overwriting a complimentary plan.
// Stripe is only ever a mocked fetch. Every key is an obviously fake test value.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { legacyCheckout, startTestServer, sampleDoc } from './helpers.mjs';
import { STRIPE_WEBHOOK_EVENTS } from '../payments/webhookEvents.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEST_KEY = 'sk_test_FAKE_FOR_TESTS';
const WHSEC = 'whsec_FAKE_FOR_TESTS';
const STRIPE_ENV = { STRIPE_SECRET_KEY: TEST_KEY, STRIPE_WEBHOOK_SECRET: WHSEC, PUBLIC_URL: 'https://blumodel.example' };

const kitchen = async (agent, name = 'Admin Kitchen') => (await agent.post('/api/projects', { name, doc: sampleDoc() })).body.project;
const auditRows = (s, action) => s.db.prepare('SELECT * FROM admin_audit WHERE action = ? ORDER BY id').all(action);

function signed(event, ts = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(event);
  const sig = crypto.createHmac('sha256', WHSEC).update(`${ts}.${body}`).digest('hex');
  return { body, header: `t=${ts},v1=${sig}` };
}
const hook = (s, ev) => s.agent().request('POST', '/api/webhooks/stripe', { raw: ev.body, contentType: 'application/json', headers: { 'Stripe-Signature': ev.header }, csrf: false });

// ── admin export without paying ──────────────────────────────────────────

test('exports are free for everyone since the showroom pivot: nothing to bypass, nothing audited; nobody exports another’s kitchen', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const admin = await s.user({ role: 'admin' });
    const ann = await s.user();
    const k = await kitchen(admin);
    const theirs = await kitchen(ann, 'Ann Kitchen');

    const ent = (await admin.get('/api/billing/entitlements')).body;
    assert.equal(ent.plan, 'free', 'the plan is what they pay for: nothing');
    assert.equal(ent.adminBypass, undefined);
    assert.deepEqual(ent.unlockedProjectIds, [k.id]);
    assert.equal(ent.exportsFree, true);

    for (const kind of ['csv', 'json', 'plan_png']) {
      const r = await admin.post(`/api/projects/${k.id}/exports`, { kind });
      assert.equal(r.status, 200, `${kind}: ${r.text}`);
    }
    assert.equal(auditRows(s, 'export_without_payment').length, 0);

    // Not someone else's kitchen, admin or not.
    assert.equal((await admin.post(`/api/projects/${theirs.id}/exports`, { kind: 'csv' })).status, 404);
    // A customer exports their own, free.
    assert.equal((await ann.post(`/api/projects/${theirs.id}/exports`, { kind: 'csv' })).status, 200);
    assert.deepEqual((await ann.get('/api/billing/entitlements')).body, { plan: 'free', unlockedProjectIds: [theirs.id], exportsFree: true });
  } finally {
    await s.close();
  }
});

// ── complimentary plans ──────────────────────────────────────────────────

test('complimentary plans: admin-only and CSRF-gated; grant, use, list, revoke; every change audit-logged', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const admin = await s.user({ role: 'admin' });
    const bob = await s.user();
    const eve = await s.user();
    const studio = await s.user({ role: 'studio' });
    const body = { email: bob.user.email.toUpperCase(), plan: 'unlimited', note: 'Beta tester' };

    for (const who of [eve, studio]) {
      assert.equal((await who.post('/api/admin/billing/grant', body)).status, 403);
      assert.equal((await who.get('/api/admin/billing/grants')).status, 403);
    }
    assert.equal((await s.agent().post('/api/admin/billing/grant', body)).status, 401);
    assert.equal((await admin.request('POST', '/api/admin/billing/grant', { body, csrf: false })).status, 403, 'needs the X-BluModel header');
    assert.equal(auditRows(s, 'comp_grant').length, 0);

    // Bad input.
    assert.equal((await admin.post('/api/admin/billing/grant', { ...body, email: 'nope' })).status, 400);
    assert.equal((await admin.post('/api/admin/billing/grant', { ...body, plan: 'free' })).status, 400);
    assert.equal((await admin.post('/api/admin/billing/grant', { ...body, note: 'x'.repeat(501) })).status, 400);
    const ghost = await admin.post('/api/admin/billing/grant', { ...body, email: 'nobody@test.blumodel' });
    assert.equal(ghost.status, 404);
    assert.equal(ghost.body.code, 'no_such_user');

    const g = await admin.post('/api/admin/billing/grant', body);
    assert.equal(g.status, 201, g.text);
    assert.equal(g.body.grant.plan, 'unlimited');
    assert.equal(g.body.grant.email, bob.user.email);
    assert.equal(g.body.grant.active, true);
    assert.equal(g.body.grant.note, 'Beta tester');
    assert.equal(g.body.grant.grantedBy, admin.id);

    // Bob is on Unlimited for free: he exports, his billing says so, and he can't cancel or change it.
    const k = await kitchen(bob);
    assert.equal((await bob.post(`/api/projects/${k.id}/exports`, { kind: 'csv' })).status, 200);
    const me = (await bob.get('/api/billing/me')).body;
    assert.equal(me.plan.id, 'unlimited');
    assert.equal(me.subscription.provider, 'comp');
    assert.equal(me.receipts.length, 0, 'no charge, no receipt');
    for (const p of ['/api/billing/cancel', '/api/billing/resume']) assert.equal((await bob.post(p)).body.code, 'complimentary_plan', p);
    // A plan change isn't sold at all since the showroom pivot.
    assert.equal((await bob.post('/api/billing/change', { plan: 'contractor' })).body.code, 'not_for_sale');

    // Re-granting (another plan) replaces it, and the audit says what it replaced.
    const g2 = await admin.post('/api/admin/billing/grant', { ...body, plan: 'contractor', note: '' });
    assert.equal(g2.status, 201);
    assert.equal(g2.body.grant.id, g.body.grant.id, 'one subscription row per user');
    const grants = auditRows(s, 'comp_grant');
    assert.equal(grants.length, 2);
    assert.equal(grants[0].target_user_id, bob.id);
    assert.equal(grants[0].target_email, bob.user.email);
    assert.deepEqual(JSON.parse(grants[0].detail), { plan: 'unlimited', note: 'Beta tester', replaced: null });
    assert.deepEqual(JSON.parse(grants[1].detail).replaced, { provider: 'comp', plan: 'unlimited', status: 'active' });

    const list = (await admin.get('/api/admin/billing/grants')).body;
    assert.equal(list.grants.length, 1);
    assert.equal(list.grants[0].plan, 'contractor');
    assert.deepEqual(list.audit.map((a) => a.action), ['comp_grant', 'comp_grant']);
    const stats = (await admin.get('/api/admin/billing')).body;
    assert.deepEqual(stats.comp, { active: { unlimited: 0, contractor: 1 } });
    assert.equal(stats.demo.mrrCents, 0, 'a complimentary plan is not revenue');

    // Revoke: Free again, audited; a second revoke and an unknown id are 404s; non-admins can't.
    assert.equal((await eve.delete(`/api/admin/billing/grant/${g.body.grant.id}`)).status, 403);
    assert.equal((await admin.request('DELETE', `/api/admin/billing/grant/${g.body.grant.id}`, { csrf: false })).status, 403);
    const rv = await admin.delete(`/api/admin/billing/grant/${g.body.grant.id}`);
    assert.equal(rv.status, 200, rv.text);
    assert.equal(rv.body.grant.active, false);
    assert.ok(rv.body.grant.revokedAt);
    assert.equal((await bob.get('/api/billing/me')).body.plan.id, 'free');
    assert.equal((await bob.post(`/api/projects/${k.id}/exports`, { kind: 'csv' })).status, 200, 'exports are free whatever the plan');
    assert.equal((await admin.delete(`/api/admin/billing/grant/${g.body.grant.id}`)).status, 404);
    assert.equal((await admin.delete('/api/admin/billing/grant/sub_nothing')).status, 404);
    const revokes = auditRows(s, 'comp_revoke');
    assert.equal(revokes.length, 1);
    assert.equal(revokes[0].admin_user_id, admin.id);
    assert.equal(revokes[0].target_user_id, bob.id);
    assert.deepEqual(JSON.parse(revokes[0].detail), { plan: 'contractor', grantId: g.body.grant.id });

    // A user who pays through Stripe can't be given a second, free plan on top.
    const t0 = Date.now();
    s.db
      .prepare(
        `INSERT INTO subscriptions (id, user_id, plan, status, provider, customer_ref, subscription_ref, current_period_end, cancel_at_period_end, created_at, updated_at)
         VALUES ('sub_paying', ?, 'unlimited', 'active', 'stripe', 'cus_x', 'sub_stripe_x', ?, 0, ?, ?)`,
      )
      .run(eve.id, t0 + 20 * 86_400_000, t0, t0);
    const refused = await admin.post('/api/admin/billing/grant', { email: eve.user.email, plan: 'contractor', note: '' });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'paid_subscription');
    assert.equal(auditRows(s, 'comp_grant').length, 2, 'a refused grant is not recorded as given');
  } finally {
    await s.close();
  }
});

// ── the webhook event list ───────────────────────────────────────────────

test('the webhook event list is exactly the events the server handles (from the handlers and the route code)', async () => {
  const s = await startTestServer({ env: STRIPE_ENV, fetch: async () => new Response('{}') });
  try {
    const registered = s.services.webhooks.registered();
    const byType = registered.filter((k) => k.includes('.'));
    for (const type of byType) assert.ok(STRIPE_WEBHOOK_EVENTS.includes(type), `a handler listens for ${type}, but the event list doesn't name it`);
    assert.deepEqual(registered.filter((k) => !k.includes('.')).sort(), ['kitchen_unlock', 'order', 'showroom_monthly', 'subscription']);

    // The checkout events the kind handlers switch on, straight from the route source.
    const src = ['billing.mjs', 'orders.mjs', 'tenantsBilling.mjs'].map((f) => fs.readFileSync(path.join(HERE, '..', 'routes', f), 'utf8')).join('\n');
    const named = new Set([...src.matchAll(/'((?:checkout\.session|customer\.subscription|invoice|charge)\.[a-z_.]+)'/g)].map((m) => m[1]));
    assert.deepEqual([...named].sort(), [...STRIPE_WEBHOOK_EVENTS].sort());
    assert.equal(new Set(STRIPE_WEBHOOK_EVENTS).size, STRIPE_WEBHOOK_EVENTS.length);
  } finally {
    await s.close();
  }
});

// ── Stripe mode, end to end ──────────────────────────────────────────────

/** A Stripe stand-in for subscriptions: checkout, retrieve, products, updates. */
function stripeMock(userIdRef) {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const end = Math.floor(Date.now() / 1000) + 30 * 86400;
  const state = { plan: 'unlimited', cancel: false, products: 0 };
  const subscription = () => ({
    id: 'sub_live_1',
    object: 'subscription',
    status: 'active',
    customer: 'cus_1',
    cancel_at_period_end: state.cancel,
    metadata: { kind: 'subscription', user_id: userIdRef.id, plan: state.plan },
    currency: 'cad',
    items: { data: [{ id: 'si_1', current_period_end: end, price: { unit_amount: state.plan === 'contractor' ? 9900 : 1500, currency: 'cad' } }] },
  });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const form = new URLSearchParams(init.body ?? '');
    calls.push({ method: init.method, path: u.pathname, form, headers: init.headers });
    if (u.hostname !== 'api.stripe.com') return json({ error: { type: 'invalid_request_error' } }, 400);
    if (u.pathname === '/v1/checkout/sessions' && init.method === 'POST') return json({ id: 'cs_test_sub', url: 'https://checkout.stripe.com/c/pay/cs_test_sub' });
    if (u.pathname === '/v1/subscriptions/sub_live_1' && init.method === 'GET') return json(subscription());
    if (u.pathname === '/v1/subscriptions/sub_live_1' && init.method === 'POST') {
      if (form.get('metadata[plan]')) state.plan = form.get('metadata[plan]');
      if (form.has('cancel_at_period_end')) state.cancel = form.get('cancel_at_period_end') === 'true';
      return json(subscription());
    }
    if (u.pathname === '/v1/products' && init.method === 'POST') return json({ id: `prod_${++state.products}` });
    if (u.pathname === '/v1/billing_portal/sessions') return json({ url: 'https://billing.stripe.com/p/session/x' });
    return json({ error: { type: 'invalid_request_error', code: 'resource_missing' } }, 404);
  };
  return { fetch, calls, subscription, end };
}

test('Stripe chain for a legacy subscription: checkout → signed webhook (300 s tolerance) → no plan change → cancel → failed renewal grace → portal', async () => {
  const who = { id: null };
  const mock = stripeMock(who);
  const s = await startTestServer({ env: STRIPE_ENV, fetch: mock.fetch });
  try {
    const ann = await s.user();
    who.id = ann.id;
    // A checkout made before the showroom pivot; Stripe completes it now.
    const c = await legacyCheckout(ann, { kind: 'subscription', plan: 'unlimited', provider: 'stripe' });
    const completed = (id) => ({
      id,
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_sub', payment_status: 'paid', amount_total: 1500, currency: 'cad', client_reference_id: c.body.ref, customer: 'cus_1', subscription: 'sub_live_1', metadata: { kind: 'subscription', checkout_ref: c.body.ref } } },
    });
    const now = Math.floor(Date.now() / 1000);

    // Outside the 300 s tolerance either way: refused, nothing recorded.
    for (const ts of [now - 301, now + 301]) {
      const r = await hook(s, signed(completed(`evt_old_${ts}`), ts));
      assert.equal(r.status, 400, `ts ${ts - now}`);
    }
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM webhook_events').get().n, 0);
    assert.equal((await ann.get('/api/billing/me')).body.plan.id, 'free');

    // Inside it: fulfilled once, however often Stripe delivers it.
    const ok = signed(completed('evt_ok'), now - 299);
    assert.equal((await hook(s, ok)).status, 200);
    assert.equal((await hook(s, signed(completed('evt_ok')))).body.duplicate, true);
    await hook(s, signed({ id: 'evt_sub_created', type: 'customer.subscription.created', data: { object: mock.subscription() } }));
    let me = (await ann.get('/api/billing/me')).body;
    assert.equal(me.plan.id, 'unlimited');
    assert.equal(me.subscription.provider, 'stripe');
    assert.equal(me.subscription.currentPeriodEnd, mock.end * 1000);
    assert.equal(me.receipts.filter((r) => r.kind === 'subscription').length, 1);

    // A plan change isn't sold since the showroom pivot: refused before Stripe is called.
    const before = mock.calls.length;
    const up = await ann.post('/api/billing/change', { plan: 'contractor' });
    assert.equal(up.status, 410, up.text);
    assert.equal(up.body.code, 'not_for_sale');
    assert.equal(mock.calls.length, before);

    // Cancel at period end, then resume.
    const cancel = await ann.post('/api/billing/cancel');
    assert.equal(cancel.body.subscription.cancelAtPeriodEnd, true);
    assert.equal(cancel.body.plan.id, 'unlimited', 'kept to the end of the paid month');
    assert.equal((await ann.post('/api/billing/resume')).body.subscription.cancelAtPeriodEnd, false);

    // A failed renewal: past due with 7 days of grace, still on the plan; paid → active again.
    await hook(s, signed({ id: 'evt_fail', type: 'invoice.payment_failed', data: { object: { id: 'in_1', parent: { subscription_details: { subscription: 'sub_live_1' } } } } }));
    me = (await ann.get('/api/billing/me')).body;
    assert.equal(me.subscription.status, 'past_due');
    assert.equal(me.plan.id, 'unlimited');
    const grace = me.subscription.graceUntil;
    assert.ok(Math.abs(grace - (Date.now() + 7 * 86_400_000)) < 60_000);
    s.setNow(grace + 1);
    assert.equal((await ann.get('/api/billing/me')).body.plan.id, 'free', 'after the grace, Free until it pays');
    s.setNow(null);
    await hook(s, signed({ id: 'evt_paid', type: 'invoice.paid', data: { object: { id: 'in_2', billing_reason: 'subscription_cycle', amount_paid: 1500, currency: 'cad', subscription: 'sub_live_1', lines: { data: [{ period: { end: mock.end + 30 * 86400 } }] } } } }));
    me = (await ann.get('/api/billing/me')).body;
    assert.equal(me.subscription.status, 'active');
    assert.equal(me.plan.id, 'unlimited');
    assert.ok(me.receipts.some((r) => r.kind === 'renewal' && r.amountCents === 1500 && r.currency === 'cad'));

    // The customer portal comes back to PUBLIC_URL.
    const portal = await ann.post('/api/billing/portal');
    assert.equal(portal.body.url, 'https://billing.stripe.com/p/session/x');
    assert.equal(mock.calls.find((x) => x.path === '/v1/billing_portal/sessions').form.get('return_url'), 'https://blumodel.example/#/account/billing');

    // Every call carried the key only in the Authorization header, and only to api.stripe.com.
    for (const x of mock.calls) assert.ok(!x.form.toString().includes('FAKE_FOR_TESTS'));
  } finally {
    await s.close();
  }
});

test('a late Stripe event about an old subscription never overwrites a complimentary plan', async () => {
  const s = await startTestServer({ env: STRIPE_ENV, fetch: async () => new Response('{}', { status: 500 }) });
  try {
    const admin = await s.user({ role: 'admin' });
    const bob = await s.user();
    assert.equal((await admin.post('/api/admin/billing/grant', { email: bob.user.email, plan: 'contractor', note: 'Partner' })).status, 201);
    const old = { id: 'sub_old', object: 'subscription', status: 'canceled', customer: 'cus_old', cancel_at_period_end: false, metadata: { kind: 'subscription', user_id: bob.id, plan: 'unlimited' }, items: { data: [{ id: 'si_old', current_period_end: 1, price: { unit_amount: 1500 } }] } };
    assert.equal((await hook(s, signed({ id: 'evt_late', type: 'customer.subscription.deleted', data: { object: old } }))).status, 200);
    const me = (await bob.get('/api/billing/me')).body;
    assert.equal(me.plan.id, 'contractor');
    assert.equal(me.subscription.provider, 'comp');
  } finally {
    await s.close();
  }
});
