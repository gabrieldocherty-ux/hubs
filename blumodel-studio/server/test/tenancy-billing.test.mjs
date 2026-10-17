// A showroom's money (docs/SHOWROOM_PIVOT.md §2): the admin-recorded yearly license, the $50 monthly
// plan through Stripe Checkout (webhook fulfils, 14-day grace on a failed renewal), and live =
// license current AND monthly paid. Stripe is only ever a mocked fetch with fake keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestServer, sampleDoc } from './helpers.mjs';
import { cleanDate, yearEnd } from '../billing/showroom.mjs';

const WHSEC = 'whsec_FAKE_FOR_TESTS';
const STRIPE_ENV = { STRIPE_SECRET_KEY: 'sk_test_FAKE_FOR_TESTS', STRIPE_WEBHOOK_SECRET: WHSEC, PUBLIC_URL: 'https://blumodel.example' };
const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);

function signed(event) {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(event);
  return { body, header: `t=${ts},v1=${crypto.createHmac('sha256', WHSEC).update(`${ts}.${body}`).digest('hex')}` };
}
const hook = (s, ev) => s.agent().request('POST', '/api/webhooks/stripe', { raw: ev.body, contentType: 'application/json', headers: { 'Stripe-Signature': ev.header }, csrf: false });

function stripeMock() {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const form = new URLSearchParams(init.body ?? '');
    calls.push({ method: init.method, path: u.pathname, form, headers: init.headers });
    if (u.hostname !== 'api.stripe.com') return json({ error: { type: 'invalid_request_error' } }, 400);
    if (u.pathname === '/v1/checkout/sessions' && init.method === 'POST') return json({ id: 'cs_test_show', url: 'https://checkout.stripe.com/c/pay/cs_test_show' });
    if (u.pathname === '/v1/checkout/sessions/cs_test_show') return json(stripeMock.session);
    if (u.pathname === '/v1/billing_portal/sessions') return json({ url: 'https://billing.stripe.com/p/session/show' });
    if (u.pathname.startsWith('/v1/subscriptions/') && init.method === 'DELETE') return json({ id: decodeURIComponent(u.pathname.slice(18)), object: 'subscription', status: 'canceled' });
    if (u.pathname.startsWith('/v1/subscriptions/') && init.method === 'POST') return json({ ...stripeMock.subscription, cancel_at_period_end: form.get('cancel_at_period_end') === 'true' });
    return json({ error: { type: 'invalid_request_error', code: 'resource_missing' } }, 404);
  };
  return { fetch, calls };
}

test('dates: real calendar days only; a year runs to the day before', () => {
  assert.equal(cleanDate('2026-02-30'), null);
  assert.equal(cleanDate('2026-11-01'), '2026-11-01');
  assert.equal(cleanDate('20261101'), null);
  assert.equal(yearEnd('2026-11-01'), '2027-10-31');
  assert.equal(yearEnd('2028-02-29'), '2029-02-27');
});

test('licenses: recorded by an admin (default list price, a year), audited, voidable; live needs it AND a paid monthly plan', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const admin = await s.user({ role: 'admin' });
    const id = (await admin.post('/api/admin/tenants', { name: 'Maple Cabinets', slug: 'maple' })).body.tenant.id;
    const shop = s.agent({ host: s.hostFor('maple') });

    // Launched with nothing: lapsed at once, temporarily unavailable.
    let r = await admin.post(`/api/admin/tenants/${id}/status`, { status: 'live' });
    assert.equal(r.body.tenant.status, 'lapsed');
    assert.deepEqual(r.body.tenant.standing, { licenseCurrent: false, monthlyPaid: false, live: false });
    assert.equal((await shop.get('/api/showroom')).status, 503);

    // Bad input. There is no list price (the setup and license are quoted per company), so a license
    // without an amount is refused: the admin always types the amount agreed.
    for (const bad of [
      { paidHow: 'barter', amountCents: 120000 },
      { paidHow: 'invoice', amountCents: 120000, startsOn: '2026-13-01' },
      { paidHow: 'invoice', amountCents: -5 },
      { paidHow: 'invoice', amountCents: 12.5 },
      { paidHow: 'invoice', amountCents: '1200' },
      { paidHow: 'invoice', amountCents: 120000, startsOn: '2026-11-01', endsOn: '2026-10-01' },
    ]) {
      assert.equal((await admin.post(`/api/admin/tenants/${id}/licenses`, bad)).status, 400, JSON.stringify(bad));
    }
    for (const missing of [{ paidHow: 'etransfer' }, { paidHow: 'etransfer', amountCents: null }, { paidHow: 'comp' }]) {
      r = await admin.post(`/api/admin/tenants/${id}/licenses`, missing);
      assert.equal(r.status, 400, JSON.stringify(missing));
      assert.equal(r.body.errors?.[0]?.field, 'amountCents', r.text);
    }
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM tenant_licenses WHERE tenant_id = ?').get(id).n, 0, 'nothing recorded without an amount');
    // The amount agreed for this company, for a year from today.
    r = await admin.post(`/api/admin/tenants/${id}/licenses`, { paidHow: 'etransfer', amountCents: 120000, note: 'Signed on the call 2026-10-17' });
    assert.equal(r.status, 201, r.text);
    assert.equal(r.body.license.amountCents, 120000);
    assert.equal(r.body.license.currency, 'cad');
    assert.equal(r.body.license.startsOn, today());
    assert.equal(r.body.license.endsOn, yearEnd(today()));
    assert.equal(r.body.license.recordedBy, admin.user.email);
    assert.equal(r.body.tenant.status, 'lapsed', 'the monthly plan is not paid yet');
    assert.equal(r.body.tenant.standing.licenseCurrent, true);

    // A complimentary monthly plan: live.
    r = await admin.post(`/api/admin/tenants/${id}/monthly/comp`, { on: true, note: 'Launch partner' });
    assert.equal(r.body.tenant.status, 'live');
    assert.equal(r.body.tenant.monthly.provider, 'comp');
    assert.equal((await shop.get('/api/showroom')).status, 200);

    // Voiding the license lapses it again (the row is kept).
    const lic = r.body.tenant.license.id;
    r = await admin.delete(`/api/admin/tenants/${id}/licenses/${lic}`);
    assert.equal(r.body.license.voidedAt > 0, true);
    assert.equal(r.body.tenant.status, 'lapsed');
    assert.equal(r.body.tenant.licenses.length, 1);
    // A custom deal: $1,500 from a past date, ended: still lapsed; then a current one: live.
    r = await admin.post(`/api/admin/tenants/${id}/licenses`, { paidHow: 'cheque', amountCents: 150000, startsOn: '2024-01-01', endsOn: '2024-12-31' });
    assert.equal(r.body.tenant.status, 'lapsed');
    r = await admin.post(`/api/admin/tenants/${id}/licenses`, { paidHow: 'invoice', amountCents: 150000, startsOn: '2026-01-01', endsOn: '2099-12-31' });
    assert.equal(r.body.tenant.status, 'live');

    const actions = s.db.prepare("SELECT action FROM admin_audit WHERE action LIKE 'tenant_%' ORDER BY id").all().map((x) => x.action);
    assert.deepEqual(actions, ['tenant_create', 'tenant_status', 'tenant_license_record', 'tenant_monthly_comp_on', 'tenant_license_void', 'tenant_license_record', 'tenant_license_record']);

    // Suspended overrides everything; restoring makes it live again.
    assert.equal((await admin.post(`/api/admin/tenants/${id}/status`, { status: 'suspended' })).body.tenant.status, 'suspended');
    assert.equal((await admin.post(`/api/admin/tenants/${id}/status`, { status: 'live' })).body.tenant.status, 'live');

    // The workspace's plan page.
    const owner = await s.showroomUser({ id, host: s.hostFor('maple') }, { role: 'owner' });
    const plan = (await owner.get('/api/workspace/plan')).body;
    assert.equal(plan.standing.status, 'live');
    assert.equal(plan.license.amountCents, 150000);
    assert.deepEqual(plan.prices.monthly, { cents: 5000, hostingCents: 2500, creditCents: 2500 });
    assert.deepEqual(plan.prices.license, { quoted: true }, 'no list price: the license is quoted per company');
    assert.equal(plan.graceDays, 14);
    assert.deepEqual(plan.receipts.map((x) => [x.kind, x.amountCents]).sort(), [['license', 150000], ['license', 150000]]);
  } finally {
    await s.close();
  }
});

test('the monthly plan through Stripe: admin link, signed webhook, invoices, 14-day grace, lapse, recovery, portal, cancel', async () => {
  const mock = stripeMock();
  const s = await startTestServer({ env: STRIPE_ENV, fetch: mock.fetch });
  try {
    const admin = await s.user({ role: 'admin' });
    const created = await admin.post('/api/admin/tenants', { name: 'Oak & Iron Kitchens', slug: 'oak-iron', contact: { email: 'office@oakiron.test' } });
    const id = created.body.tenant.id;
    await admin.post(`/api/admin/tenants/${id}/licenses`, { paidHow: 'invoice', amountCents: 150000 });
    await admin.post(`/api/admin/tenants/${id}/status`, { status: 'live' });

    const link = await admin.post(`/api/admin/tenants/${id}/monthly/checkout`);
    assert.equal(link.status, 201, link.text);
    const ref = link.body.checkout.ref;
    assert.equal(link.body.checkout.url, 'https://checkout.stripe.com/c/pay/cs_test_show');
    const c = mock.calls.find((x) => x.path === '/v1/checkout/sessions');
    assert.equal(c.form.get('mode'), 'subscription');
    assert.equal(c.form.get('line_items[0][price_data][unit_amount]'), '5000', 'the server price');
    assert.equal(c.form.get('line_items[0][price_data][currency]'), 'cad');
    assert.equal(c.form.get('line_items[0][price_data][recurring][interval]'), 'month');
    assert.equal(c.form.get('line_items[0][price_data][product_data][name]'), 'BluModel Studio showroom - Oak & Iron Kitchens');
    assert.equal(c.form.get('metadata[kind]'), 'showroom_monthly');
    assert.equal(c.form.get('metadata[tenant_id]'), id);
    assert.equal(c.form.get('subscription_data[metadata][tenant_id]'), id);
    assert.equal(c.form.get('customer_email'), 'office@oakiron.test');
    assert.equal(c.form.get('success_url'), `https://blumodel.example/?session_id={CHECKOUT_SESSION_ID}#/pay/showroom/${ref}`);
    assert.equal(c.headers['Idempotency-Key'], `${ref}-checkout`);
    // The company opens the link's status page (sales site, no sign-in).
    const pub = await s.agent().get(`/api/showroom-checkouts/${ref}`);
    assert.deepEqual(pub.body, {
      checkout: { ref, status: 'pending', amountCents: 5000, currency: 'cad', provider: 'stripe', demo: false, payUrl: 'https://checkout.stripe.com/c/pay/cs_test_show' },
      showroom: { name: 'Oak & Iron Kitchens', slug: 'oak-iron', live: false, url: `http://oak-iron.localhost:${s.port}` },
    });
    assert.equal((await s.agent({ host: s.hostFor('oak-iron') }).get(`/api/showroom-checkouts/${ref}`)).status, 503, 'not on the showroom (lapsed there, and sales-only anyway)');

    // Paid (webhook, delivered twice).
    const end = Math.floor(Date.now() / 1000) + 30 * 86400;
    const sub = { id: 'sub_show_1', object: 'subscription', status: 'active', customer: 'cus_show', cancel_at_period_end: false, metadata: { kind: 'showroom_monthly', tenant_id: id, checkout_ref: ref }, items: { data: [{ id: 'si_s', current_period_end: end, price: { unit_amount: 5000, currency: 'cad' } }] } };
    const completed = { id: 'evt_show_paid', type: 'checkout.session.completed', data: { object: { id: 'cs_test_show', payment_status: 'paid', status: 'complete', client_reference_id: ref, customer: 'cus_show', subscription: 'sub_show_1', metadata: { kind: 'showroom_monthly', checkout_ref: ref, tenant_id: id } } } };
    assert.equal((await hook(s, signed(completed))).status, 200);
    assert.equal((await hook(s, signed(completed))).body.duplicate, true);
    await hook(s, signed({ id: 'evt_show_sub', type: 'customer.subscription.created', data: { object: sub } }));
    let t = (await admin.get(`/api/admin/tenants/${id}`)).body.tenant;
    assert.equal(t.status, 'live');
    assert.equal(t.monthly.provider, 'stripe');
    assert.equal(t.monthly.periodEnd, end * 1000);
    assert.equal(t.checkouts[0].status, 'completed');
    // A legacy billing user isn't touched by any of it.
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n, 0);

    // First invoice: a receipt (once per invoice).
    const inv = (n, amount = 5000, reason = 'subscription_create') => ({ id: `evt_inv_${n}`, type: 'invoice.paid', data: { object: { id: `in_show_${n}`, billing_reason: reason, amount_paid: amount, currency: 'cad', parent: { subscription_details: { subscription: 'sub_show_1' } }, lines: { data: [{ period: { end: end + (n - 1) * 30 * 86400 } }] } } } });
    await hook(s, signed(inv(1)));
    await hook(s, signed({ ...inv(1), id: 'evt_inv_1_again' }));
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM tenant_payments WHERE kind = 'monthly'").get().n, 1);

    // A failed renewal: 14 days of grace, still live; then lapsed; paid: live again.
    await hook(s, signed({ id: 'evt_fail', type: 'invoice.payment_failed', data: { object: { id: 'in_show_f', subscription: 'sub_show_1' } } }));
    t = (await admin.get(`/api/admin/tenants/${id}`)).body.tenant;
    assert.equal(t.monthly.status, 'past_due');
    assert.ok(Math.abs(t.monthly.graceUntil - (Date.now() + 14 * DAY)) < 60_000);
    assert.equal(t.status, 'live', 'within grace');
    s.setNow(t.monthly.graceUntil + 1000);
    assert.equal((await s.agent({ host: s.hostFor('oak-iron') }).get('/api/config')).body.tenant.status, 'lapsed');
    assert.equal((await s.agent({ host: s.hostFor('oak-iron') }).get('/api/showroom')).body.code, 'showroom_unavailable');
    s.setNow(null);
    await hook(s, signed(inv(2, 5000, 'subscription_cycle')));
    assert.equal((await s.agent({ host: s.hostFor('oak-iron') }).get('/api/showroom')).status, 200);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM tenant_payments WHERE kind = 'monthly'").get().n, 2);
    assert.equal(s.ctx.services.credits.balance(id), 5000, 'two paid months: two lots of render credits');

    // The owner's portal; the admin cancels at the period end.
    const owner = await s.showroomUser({ id, host: s.hostFor('oak-iron') }, { role: 'owner' });
    const staff = await s.showroomUser({ id, host: s.hostFor('oak-iron') }, { role: 'staff' });
    assert.equal((await staff.post('/api/workspace/plan/portal')).status, 403);
    const portal = await owner.post('/api/workspace/plan/portal');
    assert.equal(portal.body.url, 'https://billing.stripe.com/p/session/show');
    assert.equal(mock.calls.find((x) => x.path === '/v1/billing_portal/sessions').form.get('customer'), 'cus_show');
    stripeMock.subscription = sub;
    const cancel = await admin.post(`/api/admin/tenants/${id}/monthly/cancel`);
    assert.equal(cancel.status, 200, cancel.text);
    assert.equal(cancel.body.tenant.monthly.cancelAtPeriodEnd, true);
    assert.equal(cancel.body.tenant.status, 'live', 'paid to the end of the period');
    // Deleted at the end: lapsed, data kept.
    await hook(s, signed({ id: 'evt_del', type: 'customer.subscription.deleted', data: { object: { ...sub, status: 'canceled' } } }));
    assert.equal((await admin.get(`/api/admin/tenants/${id}`)).body.tenant.status, 'lapsed');
    // A second link is allowed now (the plan isn't running).
    assert.equal((await admin.post(`/api/admin/tenants/${id}/monthly/checkout`)).status, 201);
  } finally {
    stripeMock.subscription = undefined;
    await s.close();
  }
});

test('Stripe events in any order: an early invoice.paid keeps its credits, a late one never revives a canceled plan, completed keeps the period end', async () => {
  const mock = stripeMock();
  const s = await startTestServer({ env: STRIPE_ENV, fetch: mock.fetch });
  try {
    const admin = await s.user({ role: 'admin' });
    const id = (await admin.post('/api/admin/tenants', { name: 'Order Co', slug: 'order-co' })).body.tenant.id;
    await admin.post(`/api/admin/tenants/${id}/licenses`, { paidHow: 'invoice', amountCents: 150000 });
    await admin.post(`/api/admin/tenants/${id}/status`, { status: 'live' });
    const ref = (await admin.post(`/api/admin/tenants/${id}/monthly/checkout`)).body.checkout.ref;
    const meta = { kind: 'showroom_monthly', checkout_ref: ref, tenant_id: id };
    const end = Math.floor(Date.now() / 1000) + 30 * 86400;
    const sub = { id: 'sub_ord', object: 'subscription', status: 'active', customer: 'cus_ord', cancel_at_period_end: false, metadata: meta, items: { data: [{ id: 'si_o', current_period_end: end, price: { unit_amount: 5000, currency: 'cad' } }] } };
    const invoice = (n, subId = 'sub_ord') => ({ id: `evt_oi_${n}_${subId}`, type: 'invoice.paid', data: { object: { id: `in_ord_${n}_${subId}`, amount_paid: 5000, currency: 'cad', customer: 'cus_ord', parent: { subscription_details: { subscription: subId, metadata: { ...meta } } }, lines: { data: [{ period: { end } }] } } } });

    // invoice.paid first, then the subscription, then the session.
    assert.equal((await hook(s, signed(invoice(1)))).status, 200);
    assert.equal(s.ctx.services.credits.balance(id), 2500, 'the first month’s credits');
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM tenant_payments WHERE kind = 'monthly' AND tenant_id = ?").get(id).n, 1);
    await hook(s, signed({ id: 'evt_o_sub', type: 'customer.subscription.created', data: { object: sub } }));
    await hook(s, signed({ id: 'evt_o_cs', type: 'checkout.session.completed', data: { object: { id: 'cs_o', payment_status: 'paid', status: 'complete', client_reference_id: ref, customer: 'cus_ord', subscription: 'sub_ord', metadata: meta } } }));
    let m = (await admin.get(`/api/admin/tenants/${id}`)).body.tenant;
    assert.equal(m.status, 'live');
    assert.equal(m.monthly.periodEnd, end * 1000, 'checkout.session.completed kept the stored period end');
    assert.equal(s.ctx.services.credits.balance(id), 2500, 'still once');

    // Canceled at Stripe, then a late invoice.paid for it: recorded, not live again.
    await hook(s, signed({ id: 'evt_o_del', type: 'customer.subscription.deleted', data: { object: { ...sub, status: 'canceled' } } }));
    assert.equal((await admin.get(`/api/admin/tenants/${id}`)).body.tenant.status, 'lapsed');
    await hook(s, signed(invoice(2)));
    m = (await admin.get(`/api/admin/tenants/${id}`)).body.tenant;
    assert.equal(m.status, 'lapsed');
    assert.equal(m.monthly.status, 'canceled');
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM tenant_payments WHERE kind = 'monthly' AND tenant_id = ?").get(id).n, 2, 'the money taken is on record');
  } finally {
    await s.close();
  }
});

test('a new link over a past-due Stripe subscription cancels it first, and a payment on the old one is still recorded', async () => {
  const mock = stripeMock();
  const s = await startTestServer({ env: STRIPE_ENV, fetch: mock.fetch });
  try {
    const admin = await s.user({ role: 'admin' });
    const id = (await admin.post('/api/admin/tenants', { name: 'Lapse Co', slug: 'lapse-co' })).body.tenant.id;
    await admin.post(`/api/admin/tenants/${id}/licenses`, { paidHow: 'invoice', amountCents: 150000 });
    await admin.post(`/api/admin/tenants/${id}/status`, { status: 'live' });
    const ref = (await admin.post(`/api/admin/tenants/${id}/monthly/checkout`)).body.checkout.ref;
    const meta = { kind: 'showroom_monthly', checkout_ref: ref, tenant_id: id };
    await hook(s, signed({ id: 'evt_l_cs', type: 'checkout.session.completed', data: { object: { id: 'cs_l', payment_status: 'paid', status: 'complete', client_reference_id: ref, customer: 'cus_l', subscription: 'sub_old', metadata: meta } } }));
    await hook(s, signed({ id: 'evt_l_fail', type: 'invoice.payment_failed', data: { object: { id: 'in_l_f', subscription: 'sub_old' } } }));
    s.setNow(Date.now() + 15 * DAY);
    assert.equal((await admin.get(`/api/admin/tenants/${id}`)).body.tenant.status, 'lapsed');
    const again = await admin.post(`/api/admin/tenants/${id}/monthly/checkout`);
    assert.equal(again.status, 201, again.text);
    const del = mock.calls.filter((c) => c.method === 'DELETE');
    assert.deepEqual(del.map((c) => c.path), ['/v1/subscriptions/sub_old']);
    assert.equal(s.ctx.services.showroomBilling.subRow(id).status, 'canceled');
    s.setNow(null); // webhooks are signed with the real clock
    // The new link is paid; a straggling invoice on the old subscription is recorded, nothing else.
    const ref2 = again.body.checkout.ref;
    assert.equal((await hook(s, signed({ id: 'evt_l_cs2', type: 'checkout.session.completed', data: { object: { id: 'cs_l2', payment_status: 'paid', status: 'complete', client_reference_id: ref2, customer: 'cus_l', subscription: 'sub_new', metadata: { ...meta, checkout_ref: ref2 } } } }))).status, 200);
    await hook(s, signed({ id: 'evt_l_old', type: 'invoice.paid', data: { object: { id: 'in_old', amount_paid: 5000, currency: 'cad', parent: { subscription_details: { subscription: 'sub_old', metadata: meta } }, lines: { data: [] } } } }));
    assert.equal(s.ctx.services.showroomBilling.subRow(id).subscription_ref, 'sub_new');
    assert.deepEqual(s.db.prepare("SELECT ref FROM tenant_payments WHERE kind = 'monthly' AND tenant_id = ? ORDER BY ref").all(id).map((r) => r.ref), ['in_old']);
  } finally {
    s.setNow(null);
    await s.close();
  }
});

test('Stripe return sync: only a paid session made for that very link fulfils it', async () => {
  const mock = stripeMock();
  const s = await startTestServer({ env: STRIPE_ENV, fetch: mock.fetch });
  try {
    const admin = await s.user({ role: 'admin' });
    const a = (await admin.post('/api/admin/tenants', { name: 'Sync A', slug: 'sync-a' })).body.tenant.id;
    const b = (await admin.post('/api/admin/tenants', { name: 'Sync B', slug: 'sync-b' })).body.tenant.id;
    const refA = (await admin.post(`/api/admin/tenants/${a}/monthly/checkout`)).body.checkout.ref;
    const refB = (await admin.post(`/api/admin/tenants/${b}/monthly/checkout`)).body.checkout.ref;
    stripeMock.session = { id: 'cs_test_show', payment_status: 'paid', status: 'complete', client_reference_id: refA, customer: 'cus_a', subscription: 'sub_a', metadata: { kind: 'showroom_monthly', checkout_ref: refA, tenant_id: a } };
    // B's link with A's session: nothing happens.
    const wrong = await s.agent().post(`/api/showroom-checkouts/${refB}/sync`, { sessionId: 'cs_test_show' });
    assert.equal(wrong.body.checkout.status, 'pending');
    const right = await s.agent().post(`/api/showroom-checkouts/${refA}/sync`, { sessionId: 'cs_test_show' });
    assert.equal(right.body.checkout.status, 'completed');
    assert.equal(s.ctx.services.showroomBilling.subRow(a).subscription_ref, 'sub_a');
    assert.equal(s.ctx.services.showroomBilling.subRow(b), null);
  } finally {
    stripeMock.session = undefined;
    await s.close();
  }
});

test('the demo provider: the link page pays without money; renewals, failure, grace end; demo-only', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const admin = await s.user({ role: 'admin' });
    const id = (await admin.post('/api/admin/tenants', { name: 'Demo Pay Co', slug: 'demo-pay' })).body.tenant.id;
    await admin.post(`/api/admin/tenants/${id}/licenses`, { paidHow: 'comp', amountCents: 0 });
    await admin.post(`/api/admin/tenants/${id}/status`, { status: 'live' });
    const link = await admin.post(`/api/admin/tenants/${id}/monthly/checkout`);
    assert.match(link.body.checkout.url, /\/#\/pay\/showroom\/tc_[A-Za-z0-9_-]+$/);
    const ref = link.body.checkout.ref;
    assert.equal((await s.agent().post(`/api/showroom-checkouts/${ref}/demo`, { outcome: 'nope' })).status, 400);
    const paid = await s.agent().post(`/api/showroom-checkouts/${ref}/demo`, { outcome: 'success' });
    assert.equal(paid.body.checkout.status, 'completed');
    let t = (await admin.get(`/api/admin/tenants/${id}`)).body.tenant;
    assert.equal(t.status, 'live');
    assert.equal(t.monthly.provider, 'demo');
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM tenant_payments WHERE kind = 'monthly' AND tenant_id = ?").get(id).n, 1);
    t = (await admin.post(`/api/admin/tenants/${id}/monthly/demo`, { event: 'renewal_failed' })).body.tenant;
    assert.equal(t.monthly.status, 'past_due');
    assert.equal(t.status, 'live');
    t = (await admin.post(`/api/admin/tenants/${id}/monthly/demo`, { event: 'grace_end' })).body.tenant;
    assert.equal(t.status, 'lapsed');
    t = (await admin.post(`/api/admin/tenants/${id}/monthly/demo`, { event: 'renewal' })).body.tenant;
    assert.equal(t.status, 'live');
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM tenant_payments WHERE kind = 'monthly' AND tenant_id = ?").get(id).n, 2);
    assert.equal((await admin.post(`/api/admin/tenants/${id}/monthly/demo`, { event: 'bogus' })).status, 400);
  } finally {
    await s.close();
  }
  const stripe = await startTestServer({ env: STRIPE_ENV, fetch: stripeMock().fetch });
  try {
    const admin = await stripe.user({ role: 'admin' });
    const id = stripe.ctx.services.tenants.create({ name: 'X', slug: 'x-co' }).id;
    assert.equal((await admin.post(`/api/admin/tenants/${id}/monthly/demo`, { event: 'renewal' })).status, 403);
    const ref = stripe.ctx.services.showroomBilling.newCheckout(id, { provider: 'stripe' }).ref;
    assert.equal((await stripe.agent().post(`/api/showroom-checkouts/${ref}/demo`, { outcome: 'success' })).status, 403);
  } finally {
    await stripe.close();
  }
});

test('downloads are free on a showroom too, for the kitchen’s owner only', async () => {
  const s = await startTestServer();
  try {
    const A = s.tenant({ slug: 'free-a' });
    const B = s.tenant({ slug: 'free-b' });
    const ann = await s.showroomUser(A);
    const bob = await s.showroomUser(B);
    const k = (await ann.post('/api/projects', { name: 'Free Kitchen', doc: sampleDoc() })).body.project;
    for (const kind of ['csv', 'json', 'plan_png']) assert.equal((await ann.post(`/api/projects/${k.id}/exports`, { kind })).status, 200, kind);
    assert.equal((await bob.post(`/api/projects/${k.id}/exports`, { kind: 'csv' })).status, 404);
    assert.equal((await ann.get('/api/billing/me')).status, 404, 'legacy billing is the sales site’s');
  } finally {
    await s.close();
  }
});
