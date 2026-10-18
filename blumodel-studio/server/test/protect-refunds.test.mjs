// A refunded or charged-back showroom payment (audit 2026-10: "keeps the showroom paid and keeps its
// credits"). charge.refunded and charge.dispute.created for a showroom_monthly payment take back the
// month's unspent credits, flag the company for admin review and start the grace period. Stripe is
// only ever signed fake events here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestServer } from './helpers.mjs';
import { STRIPE_WEBHOOK_EVENTS } from '../payments/webhookEvents.mjs';

const WHSEC = 'whsec_FAKE_FOR_TESTS';
const STRIPE_ENV = { STRIPE_SECRET_KEY: 'sk_test_FAKE_FOR_TESTS', STRIPE_WEBHOOK_SECRET: WHSEC, PUBLIC_URL: 'https://blumodel.example' };
const DAY = 86_400_000;

function signed(event) {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(event);
  return { body, header: `t=${ts},v1=${crypto.createHmac('sha256', WHSEC).update(`${ts}.${body}`).digest('hex')}` };
}
let seq = 0;
const hook = async (s, type, object) => {
  const ev = signed({ id: `evt_${++seq}_${crypto.randomBytes(4).toString('hex')}`, type, data: { object } });
  const r = await s.agent().request('POST', '/api/webhooks/stripe', { raw: ev.body, contentType: 'application/json', headers: { 'Stripe-Signature': ev.header }, csrf: false });
  assert.equal(r.status, 200, r.text);
  return r;
};
const invoice = (tenantId, n, { pi = `pi_${n}`, sub = 'sub_show_1' } = {}) => ({
  id: `in_${n}`,
  object: 'invoice',
  amount_paid: 5000,
  currency: 'cad',
  customer: 'cus_show',
  payment_intent: pi,
  parent: { subscription_details: { subscription: sub, metadata: { kind: 'showroom_monthly', tenant_id: tenantId } } },
  lines: { data: [{ period: { end: Math.floor((Date.now() + 30 * DAY) / 1000) } }] },
});
const balance = (s, id) => s.services.credits.balance(id);
const sub = (s, id) => s.db.prepare('SELECT status, grace_until FROM tenant_subscriptions WHERE tenant_id = ?').get(id);
const pay = (s, ref) => s.db.prepare('SELECT status, refunded_cents FROM tenant_payments WHERE ref = ?').get(ref);

test('a refunded monthly payment takes back that month’s unspent credits, flags the company and starts grace; resends change nothing', async () => {
  const s = await startTestServer({ env: STRIPE_ENV });
  try {
    const admin = await s.user({ role: 'admin' });
    const tn = s.services.tenants.create({ name: 'Refund Kitchens', slug: 'refundk' });
    s.services.showroomBilling.recordLicense(tn.id, { paidHow: 'comp', amountCents: 0 });
    // The reproduced finding: a paid invoice gives the month and $25 of credits.
    await hook(s, 'invoice.paid', invoice(tn.id, 1));
    assert.equal(balance(s, tn.id), 2500);
    assert.equal(sub(s, tn.id).status, 'active');
    // $5 of it is spent on renders before the refund.
    const hold = s.services.credits.reserve(tn.id, 500, { purpose: 'render' });
    s.services.credits.charge(hold.id);
    assert.equal(balance(s, tn.id), 2000);

    // Refunded in Stripe (the charge, by its payment intent).
    await hook(s, 'charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_1', amount: 5000, amount_refunded: 5000, refunded: true });
    assert.equal(balance(s, tn.id), 0, 'the unspent $20 went; the $5 spent stays spent');
    assert.deepEqual({ ...pay(s, 'in_1') }, { status: 'refunded', refunded_cents: 5000 });
    const st = sub(s, tn.id);
    assert.equal(st.status, 'past_due');
    assert.ok(st.grace_until > Date.now() + 13 * DAY && st.grace_until <= Date.now() + 14 * DAY + 60_000, '14-day grace');
    const wire = (await admin.get(`/api/admin/tenants/${tn.id}`)).body.tenant;
    assert.match(wire.review.reason, /refunded/);
    const history = s.services.credits.history(tn.id);
    assert.ok(history.some((e) => e.kind === 'adjust' && e.cents === -2000 && /refunded/.test(e.note)));
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'showroom_payment_refunded'").get().n, 1);

    // Stripe resends: nothing twice.
    await hook(s, 'charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_1', amount: 5000, amount_refunded: 5000, refunded: true });
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'showroom_payment_refunded'").get().n, 1);
    assert.equal(history.length, s.services.credits.history(tn.id).length);

    // The admin looked into it: the flag goes and, with restore, the plan is active again.
    const cleared = await admin.post(`/api/admin/tenants/${tn.id}/review/clear`, { restore: true });
    assert.equal(cleared.status, 200, cleared.text);
    assert.equal(cleared.body.tenant.review, null);
    assert.equal(sub(s, tn.id).status, 'active');
  } finally {
    await s.close();
  }
});

test('a partial refund takes back the same share of the month’s credits; a dispute takes the rest and starts grace', async () => {
  const s = await startTestServer({ env: STRIPE_ENV });
  try {
    const tn = s.services.tenants.create({ name: 'Dispute Baths', slug: 'disputeb' });
    await hook(s, 'invoice.paid', invoice(tn.id, 2));
    assert.equal(balance(s, tn.id), 2500);
    await hook(s, 'charge.refunded', { id: 'ch_2', object: 'charge', payment_intent: 'pi_2', amount: 5000, amount_refunded: 2500, refunded: false });
    assert.equal(balance(s, tn.id), 1250);
    assert.equal(pay(s, 'in_2').status, 'partially_refunded');
    assert.equal(sub(s, tn.id).status, 'active', 'half refunded: no grace, but flagged');
    assert.ok(s.services.showroomBilling.review(tn.id));

    await hook(s, 'charge.dispute.created', { id: 'dp_1', object: 'dispute', charge: 'ch_2', payment_intent: 'pi_2', amount: 2500, reason: 'fraudulent' });
    assert.equal(balance(s, tn.id), 0);
    assert.equal(pay(s, 'in_2').status, 'disputed');
    assert.equal(sub(s, tn.id).status, 'past_due');
    assert.match(s.services.showroomBilling.review(tn.id).reason, /disputed/);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'showroom_payment_disputed'").get().n, 1);
    // A charge that isn't a showroom payment is left to the other handlers.
    await hook(s, 'charge.dispute.created', { id: 'dp_2', object: 'dispute', charge: 'ch_other', payment_intent: 'pi_other', amount: 100 });
    await hook(s, 'charge.refunded', { id: 'ch_other', object: 'charge', payment_intent: 'pi_other', amount: 100, amount_refunded: 100, refunded: true });
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action LIKE 'showroom_payment_%'").get().n, 2);
  } finally {
    await s.close();
  }
});

test('the Stripe endpoint must send charge.dispute.created', () => {
  assert.ok(STRIPE_WEBHOOK_EVENTS.includes('charge.dispute.created'));
  assert.ok(STRIPE_WEBHOOK_EVENTS.includes('charge.refunded'));
});
