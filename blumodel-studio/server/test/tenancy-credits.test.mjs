// The render credits ledger (docs/SHOWROOM_PIVOT.md §2, §7): +$25 a paid month once per invoice,
// 3-month rollover then expiry oldest first, reservations charged / released / refunded, audited
// admin adjustments, and a balance and history per showroom only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { startTestServer } from './helpers.mjs';
import { addMonths } from '../billing/service.mjs';

const WHSEC = 'whsec_FAKE_FOR_TESTS';
const STRIPE_ENV = { STRIPE_SECRET_KEY: 'sk_test_FAKE_FOR_TESTS', STRIPE_WEBHOOK_SECRET: WHSEC, PUBLIC_URL: 'https://blumodel.example' };

function signed(event) {
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(event);
  return { body, header: `t=${ts},v1=${crypto.createHmac('sha256', WHSEC).update(`${ts}.${body}`).digest('hex')}` };
}
const hook = (s, ev) => s.agent().request('POST', '/api/webhooks/stripe', { raw: ev.body, contentType: 'application/json', headers: { 'Stripe-Signature': ev.header }, csrf: false });

/** The ledger adds up: the entries' sum and the last balance_after both equal the balance. */
function consistent(s, tenantId) {
  const credits = s.ctx.services.credits;
  const balance = credits.balance(tenantId);
  const sum = s.db.prepare('SELECT COALESCE(SUM(cents), 0) AS n FROM tenant_credit_entries WHERE tenant_id = ?').get(tenantId).n;
  const last = s.db.prepare('SELECT balance_after FROM tenant_credit_entries WHERE tenant_id = ? ORDER BY id DESC LIMIT 1').get(tenantId)?.balance_after ?? 0;
  assert.equal(sum, balance, 'entries sum to the balance');
  assert.equal(last, balance, 'the last entry carries the balance');
  return balance;
}

test('invoice.paid grants $25 once per invoice; the comp and license paths grant nothing', async () => {
  const s = await startTestServer({ env: STRIPE_ENV, fetch: async () => new Response('{}') });
  try {
    const tn = s.tenant({ slug: 'cred-a' });
    const sb = s.ctx.services.showroomBilling;
    assert.equal(s.ctx.services.credits.balance(tn.id), 0, 'a complimentary plan and a license add no credits');
    // A Stripe subscription for the tenant, as a completed checkout leaves it.
    sb.setComplimentary(tn.id, false);
    sb.upsert(tn.id, { provider: 'stripe', status: 'active', subscriptionRef: 'sub_cred', customerRef: 'cus_cred', periodEnd: Date.now() + 30 * 86_400_000 });
    const inv = (id, eventId = `evt_${id}`) => ({ id: eventId, type: 'invoice.paid', data: { object: { id, amount_paid: 5000, currency: 'cad', subscription: 'sub_cred', lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] } } } });
    await hook(s, signed(inv('in_c1')));
    await hook(s, signed(inv('in_c1', 'evt_in_c1_resent')));
    assert.equal(consistent(s, tn.id), 2500);
    await hook(s, signed(inv('in_c2')));
    assert.equal(consistent(s, tn.id), 5000);
    const lots = s.db.prepare('SELECT ref, cents, remaining FROM tenant_credit_lots WHERE tenant_id = ? ORDER BY created_at').all(tn.id).map((r) => ({ ...r }));
    assert.deepEqual(lots, [
      { ref: 'in_c1', cents: 2500, remaining: 2500 },
      { ref: 'in_c2', cents: 2500, remaining: 2500 },
    ]);
  } finally {
    await s.close();
  }
});

test('credits roll over 3 months, then expire oldest first; spending takes the oldest first', async () => {
  const s = await startTestServer();
  try {
    const credits = s.ctx.services.credits;
    const tn = s.tenant({ slug: 'cred-roll' });
    const t0 = Date.UTC(2026, 9, 17, 12);
    s.setNow(t0);
    credits.grantMonth(tn.id, 'in_m1');
    s.setNow(addMonths(t0, 1));
    credits.grantMonth(tn.id, 'in_m2');
    assert.equal(credits.balance(tn.id), 5000);
    // A render of $30 takes $25 from month 1 and $5 from month 2.
    const hold = credits.reserve(tn.id, 3000, { ref: 'render-1' });
    assert.equal(hold.status, 'held');
    assert.deepEqual(
      s.db.prepare('SELECT ref, remaining FROM tenant_credit_lots WHERE tenant_id = ? ORDER BY expires_at').all(tn.id).map((r) => [r.ref, r.remaining]),
      [
        ['in_m1', 0],
        ['in_m2', 2000],
      ],
    );
    credits.charge(hold.id);
    assert.equal(consistent(s, tn.id), 2000);
    // Month 1's lot expires at t0 + 3 months with nothing left: no expiry entry. Month 2's lot
    // expires a month later with $20 left: an expiry entry of -$20.
    s.setNow(addMonths(t0, 3) + 1000);
    assert.equal(credits.balance(tn.id), 2000);
    s.setNow(addMonths(t0, 4) + 1000);
    assert.equal(credits.balance(tn.id), 0);
    const kinds = credits.history(tn.id).map((h) => [h.kind, h.cents]);
    assert.deepEqual(kinds, [
      ['expire', -2000],
      ['charge', 0],
      ['reserve', -3000],
      ['grant', 2500],
      ['grant', 2500],
    ]);
    consistent(s, tn.id);
    assert.equal(credits.summary(tn.id).nextExpiry, null);
  } finally {
    s.setNow(null);
    await s.close();
  }
});

test('reservations: refused when short, released on failure, refunded after a charge, settled once', async () => {
  const s = await startTestServer();
  try {
    const credits = s.ctx.services.credits;
    const tn = s.tenant({ slug: 'cred-hold' });
    credits.grantMonth(tn.id, 'in_h1');
    assert.throws(() => credits.reserve(tn.id, 2501), (e) => e.status === 402 && e.extra.code === 'insufficient_credits' && e.extra.balanceCents === 2500);
    assert.throws(() => credits.reserve(tn.id, 0), (e) => e.status === 400);
    const a = credits.reserve(tn.id, 25);
    const b = credits.reserve(tn.id, 25);
    assert.equal(credits.summary(tn.id).heldCents, 50);
    assert.equal(credits.balance(tn.id), 2450);
    assert.equal(credits.release(a.id).status, 'released');
    assert.equal(credits.release(a.id).status, 'released', 'idempotent');
    assert.throws(() => credits.charge(a.id), (e) => e.status === 409);
    assert.equal(credits.balance(tn.id), 2475);
    assert.equal(credits.charge(b.id).status, 'charged');
    assert.throws(() => credits.release(b.id), (e) => e.status === 409);
    assert.equal(credits.refund(b.id, { note: 'Blurry render' }).status, 'refunded');
    assert.equal(consistent(s, tn.id), 2500);
    assert.throws(() => credits.refund(a.id), (e) => e.status === 409, 'only a charged hold');
    // A hold released after its lot expired: the credits come back and expire at once.
    const t0 = Date.now();
    const late = credits.reserve(tn.id, 100);
    s.setNow(addMonths(t0, 4));
    credits.release(late.id);
    assert.equal(consistent(s, tn.id), 0);
    assert.deepEqual(credits.history(tn.id, { limit: 2 }).map((h) => h.kind), ['expire', 'release']);
  } finally {
    s.setNow(null);
    await s.close();
  }
});

test('admin adjustments are audited and never go below zero; staff see the balance and history of their showroom only', async () => {
  const s = await startTestServer();
  try {
    const admin = await s.user({ role: 'admin' });
    const A = s.tenant({ slug: 'cred-adm-a' });
    const B = s.tenant({ slug: 'cred-adm-b' });
    assert.equal((await admin.post(`/api/admin/tenants/${A.id}/credits`, { cents: 1000 })).status, 400, 'a reason is required');
    assert.equal((await admin.post(`/api/admin/tenants/${A.id}/credits`, { cents: 0, note: 'x' })).status, 400);
    assert.equal((await admin.post(`/api/admin/tenants/${A.id}/credits`, { cents: 10.5, note: 'x' })).status, 400);
    const add = await admin.post(`/api/admin/tenants/${A.id}/credits`, { cents: 1000, note: 'Welcome credits' });
    assert.equal(add.status, 200, add.text);
    assert.equal(add.body.balanceCents, 1000);
    assert.equal(add.body.history[0].by, admin.user.email);
    assert.equal(add.body.history[0].note, 'Welcome credits');
    const over = await admin.post(`/api/admin/tenants/${A.id}/credits`, { cents: -1500, note: 'Too much' });
    assert.equal(over.status, 409);
    assert.equal((await admin.post(`/api/admin/tenants/${A.id}/credits`, { cents: -400, note: 'Correction' })).body.balanceCents, 600);
    const audit = s.db.prepare("SELECT detail FROM admin_audit WHERE action = 'tenant_credit_adjust' ORDER BY id").all().map((r) => JSON.parse(r.detail));
    assert.deepEqual(audit.map((d) => [d.tenantId, d.cents, d.note]), [
      [A.id, 1000, 'Welcome credits'],
      [A.id, -400, 'Correction'],
    ]);
    assert.equal((await admin.get(`/api/admin/tenants/${A.id}`)).body.tenant.credits.balanceCents, 600);

    const staffA = await s.showroomUser(A, { role: 'staff' });
    const staffB = await s.showroomUser(B, { role: 'staff' });
    const visitorA = await s.showroomUser(A);
    const mine = (await staffA.get('/api/workspace/credits')).body;
    assert.equal(mine.balanceCents, 600);
    assert.equal(mine.renderCostCents, 25);
    assert.equal(mine.rolloverMonths, 3);
    assert.deepEqual(mine.history.map((h) => h.cents), [-400, 1000]);
    assert.equal((await staffB.get('/api/workspace/credits')).body.balanceCents, 0);
    assert.deepEqual((await staffB.get('/api/workspace/credits')).body.history, []);
    assert.equal((await visitorA.get('/api/workspace/credits')).status, 403);
    // Paging the history.
    const page = (await staffA.get(`/api/workspace/credits?before=${mine.history[0].id}`)).body.history;
    assert.deepEqual(page.map((h) => h.cents), [1000]);
    // The admin routes don't exist on a showroom.
    assert.equal((await staffA.post(`/api/admin/tenants/${A.id}/credits`, { cents: 100000, note: 'free money' })).status, 404);
  } finally {
    await s.close();
  }
});
