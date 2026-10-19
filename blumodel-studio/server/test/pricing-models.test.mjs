// The 2026-10-15 pricing change, part 2: custom models come with the Contractor plan.
//   - the Contractor plan is $99 CAD/month and includes 3 custom 3D models a month, made by the
//     studio; nothing is sold per model any more (the Model pack is gone: no checkout, no rush);
//   - the allowance period is the subscription's current billing period (a complimentary plan's
//     is the calendar month, UTC); unused models don't roll over;
//   - a model counts when its request is submitted (one per product) and goes back to the
//     allowance if the request is cancelled before work starts (by the buyer or the studio);
//   - past the allowance the server refuses with the reset date; two requests sent at once can't
//     both take the last model (the check and the insert are one transaction);
//   - admins can grant extra models for the current period only (audit-logged);
//   - if the plan lapses, requests already submitted are still delivered; no new ones can be made.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, legacyCheckout } from './helpers.mjs';
import { makeGlb } from './fixtures/glb.mjs';
import { makePng } from './fixtures/images.mjs';
import { periodOf } from '../payments/allowance.mjs';
import { addMonths } from '../billing/service.mjs';
import { PLANS, INCLUDED_MODELS } from '../lib/plans.mjs';

const DAY = 86_400_000;

const product = (refs, name = 'Harbor Base 30') => ({
  brief: { productTypeId: 'base-cabinet', kind: 'base', variant: 'door-drawer', name, widthIn: 30, depthIn: 24, heightIn: 34.5, notes: '', referenceFileIds: refs },
});

async function refPhoto(agent) {
  const r = await agent.putRaw('/api/files?kind=reference&name=photo.png', makePng({ w: 6, h: 6, rgba: [120, 90, 60, 255] }), 'image/png');
  assert.equal(r.status, 201, r.text);
  return r.body.file.id;
}

/** A contractor through billing's DEMO checkout: a real subscription with a current period. */
async function demoContractor(s) {
  const pro = await s.user();
  const c = await legacyCheckout(pro, { kind: 'subscription', plan: 'contractor' });
  assert.equal(c.status, 200, c.text);
  assert.equal((await pro.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' })).status, 200);
  return pro;
}

const submit = (agent, refs, n) => agent.post('/api/orders', { target: 'contractor', items: Array.from({ length: n }, (_, i) => product(refs, `Harbor Base ${i + 1}`)) });

test('the Contractor plan includes 3 custom models a month, and the pricing data says so', () => {
  const pro = PLANS.find((p) => p.id === 'contractor');
  assert.equal(pro.priceCents, 9900);
  assert.equal(pro.currency, 'cad');
  assert.equal(pro.includedModels, 3);
  assert.equal(INCLUDED_MODELS, 3);
  assert.ok(pro.bullets.includes('3 custom 3D models a month, made by our studio'));
  // No paid custom-model offer anywhere in the plans: no pack, no $129, no per-model price.
  const text = JSON.stringify(PLANS);
  assert.doesNotMatch(text, /pack|129|rush/i);
  // The $5 unlock exists (the export dialog offers it) but no other plan quotes export prices.
  assert.equal(PLANS.find((p) => p.id === 'kitchen_unlock').priceCents, 500);
  for (const p of PLANS.filter((x) => x.id !== 'kitchen_unlock')) assert.doesNotMatch(p.bullets.join(' '), /\$5\b/, p.id);
});

test('the allowance period: the subscription’s billing period, rolled forward; the calendar month (UTC) without one (pure)', () => {
  const t = Date.UTC(2026, 9, 20, 9); // Oct 20
  // A complimentary plan has no period: the calendar month.
  assert.deepEqual(periodOf({ id: 'contractor', periodEnd: null }, t), { start: Date.UTC(2026, 9, 1), end: Date.UTC(2026, 10, 1) });
  assert.deepEqual(periodOf(null, Date.UTC(2026, 11, 31, 23)), { start: Date.UTC(2026, 11, 1), end: Date.UTC(2027, 0, 1) });
  // A subscription renewing on the 3rd: Oct 3 → Nov 3.
  const end = Date.UTC(2026, 10, 3, 15);
  assert.deepEqual(periodOf({ id: 'contractor', periodEnd: end }, t), { start: addMonths(end, -1), end });
  // A renewal not yet recorded (the end has passed): the next period.
  const later = Date.UTC(2026, 10, 10);
  const p = periodOf({ id: 'contractor', periodEnd: end }, later);
  assert.deepEqual(p, { start: end, end: addMonths(end, 1) });
  // A period end far ahead (a long-dated end): the month that contains now.
  const far = periodOf({ id: 'contractor', periodEnd: Date.UTC(2027, 2, 3) }, t);
  assert.ok(far.start <= t && t < far.end);
  assert.ok(far.end - far.start <= 31 * DAY);
});

test('3 models a period: counted on submit, refused past it with the reset date, back when cancelled before work starts, no rollover', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo', SUPPORT_EMAIL: 'help@blumodel.example' } });
  try {
    const t0 = Date.UTC(2026, 9, 15, 12);
    s.setNow(t0);
    const ann = await s.user();
    const studio = await s.user({ role: 'studio' });
    // Not a contractor: nothing is included, and the form is told so.
    const free = await ann.get('/api/orders/allowance');
    assert.equal(free.status, 200);
    assert.deepEqual([free.body.allowance.active, free.body.allowance.total, free.body.allowance.left], [false, 0, 0]);
    assert.equal(free.body.terms.perMonth, 3);
    assert.equal((await s.agent().get('/api/orders/allowance')).status, 401);

    const pro = await demoContractor(s);
    const refs = [await refPhoto(pro)];
    const a0 = (await pro.get('/api/orders/allowance')).body.allowance;
    assert.equal(a0.active, true);
    assert.deepEqual([a0.included, a0.granted, a0.used, a0.total, a0.left], [3, 0, 0, 3, 3]);
    assert.equal(a0.supportEmail, 'help@blumodel.example');
    const periodEnd = a0.periodEnd;
    assert.equal(a0.resetsAt, periodEnd);
    assert.ok(a0.periodStart <= t0 && t0 < periodEnd);
    assert.equal(periodEnd, addMonths(a0.periodStart, 1));

    // Two products are two models.
    const two = await submit(pro, refs, 2);
    assert.equal(two.status, 201, two.text);
    assert.equal(two.body.allowance.left, 1);
    assert.deepEqual(two.body.order.planPeriod, { start: a0.periodStart, end: periodEnd });
    // Two more don't fit: refused with what is left and the reset date; nothing stored.
    const before = s.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
    const over = await submit(pro, refs, 2);
    assert.equal(over.status, 409);
    assert.equal(over.body.needs, 'allowance');
    assert.equal(over.body.allowance.left, 1);
    assert.match(over.body.error, /You have 1 model left this month and this request has 2 products/);
    assert.match(over.body.error, /November 15, 2026/);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, before);

    // Two requests sent at once for the last model: exactly one gets it.
    const race = await Promise.all([submit(pro, refs, 1), submit(pro, refs, 1)]);
    assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
    const last = race.find((r) => r.status === 201).body.order;
    const used = await submit(pro, refs, 1);
    assert.equal(used.status, 409);
    assert.match(used.body.error, /You’ve used this month’s 3 models\. Your allowance resets on November 15, 2026\./);

    // The buyer withdraws a request before work starts: its models come back.
    const w = await pro.post(`/api/orders/${two.body.order.id}/cancel`);
    assert.equal(w.status, 200, w.text);
    assert.equal(w.body.order.status, 'cancelled');
    assert.match(w.body.events.at(-1).note, /went back to this month’s allowance/);
    assert.equal((await pro.get('/api/orders/allowance')).body.allowance.left, 2);
    assert.equal((await pro.post(`/api/orders/${two.body.order.id}/cancel`)).status, 409, 'already cancelled');

    // Once the studio starts, it can't be withdrawn or cancelled, and it keeps counting.
    assert.equal((await studio.post(`/api/studio/orders/${last.id}/start`)).status, 200);
    const late = await pro.post(`/api/orders/${last.id}/cancel`);
    assert.equal(late.status, 409);
    assert.match(late.body.error, /started/);
    assert.equal((await studio.post(`/api/studio/orders/${last.id}/cancel`, { note: 'x' })).status, 409);

    // The studio cancels one it won't make: back to the allowance, with its reason on the timeline.
    const one = await submit(pro, refs, 1);
    assert.equal(one.status, 201);
    assert.equal((await pro.get('/api/orders/allowance')).body.allowance.left, 1);
    const sc = await studio.post(`/api/studio/orders/${one.body.order.id}/cancel`, { note: 'We can’t source this one.' });
    assert.equal(sc.status, 200, sc.text);
    assert.equal(sc.body.order.status, 'cancelled');
    assert.match(sc.body.events.at(-1).note, /Cancelled by the studio: We can’t source this one\./);
    assert.equal((await pro.get('/api/orders/allowance')).body.allowance.left, 2);
    // A paid order from before is refunded, never "cancelled" by the studio.
    const studioRow = s.db.prepare("SELECT id FROM orders WHERE tier = 'plan' AND status = 'in_progress'").get();
    assert.ok(studioRow);

    // Next period: back to 3, not 3 + the 2 unused.
    s.setNow(periodEnd + DAY);
    assert.equal((await pro.post('/api/auth/login', { email: pro.user.email, password: pro.user.password })).status, 200);
    const next = (await pro.get('/api/orders/allowance')).body.allowance;
    assert.deepEqual([next.used, next.total, next.left], [0, 3, 3]);
    assert.equal(next.periodStart, periodEnd);
    // The request still in progress from last period is unaffected.
    assert.equal(s.db.prepare('SELECT status FROM orders WHERE id = ?').get(last.id).status, 'in_progress');
  } finally {
    await s.close();
  }
});

test('admins grant extra models for the current period only, audit-logged; non-admins and non-contractors can’t', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const t0 = Date.UTC(2026, 9, 15, 12);
    s.setNow(t0);
    const admin = await s.user({ role: 'admin' });
    const pro = await demoContractor(s);
    const homeowner = await s.user();
    const refs = [await refPhoto(pro)];
    assert.equal((await submit(pro, refs, 3)).status, 201);
    assert.equal((await submit(pro, refs, 1)).status, 409);

    // Look the contractor up by email, then grant 2 more.
    const look = await admin.get(`/api/admin/model-allowance?email=${encodeURIComponent(pro.user.email.toUpperCase())}`);
    assert.equal(look.status, 200, look.text);
    assert.equal(look.body.user.id, pro.id);
    assert.deepEqual([look.body.allowance.used, look.body.allowance.left], [3, 0]);
    for (const bad of [{ models: 0 }, { models: 51 }, { models: 1.5 }, { models: '2' }, { models: 2, note: 'x'.repeat(501) }]) {
      assert.equal((await admin.post('/api/admin/model-grants', { userId: pro.id, ...bad })).status, 400, JSON.stringify(bad).slice(0, 40));
    }
    assert.equal((await admin.post('/api/admin/model-grants', { email: 'nobody@example.test', models: 1 })).status, 404);
    assert.equal((await admin.post('/api/admin/model-grants', { models: 1 })).status, 400);
    const notPro = await admin.post('/api/admin/model-grants', { userId: homeowner.id, models: 2 });
    assert.equal(notPro.status, 409);
    assert.equal(notPro.body.code, 'not_contractor');
    assert.equal((await pro.post('/api/admin/model-grants', { userId: pro.id, models: 5 })).status, 403);

    const g = await admin.post('/api/admin/model-grants', { userId: pro.id, models: 2, note: 'Launch week: their first cabinet line.' });
    assert.equal(g.status, 201, g.text);
    assert.deepEqual([g.body.allowance.granted, g.body.allowance.total, g.body.allowance.left], [2, 5, 2]);
    assert.equal(g.body.grants.length, 1);
    assert.equal(g.body.grant.periodEnd, g.body.allowance.periodEnd, 'for the current period');
    const audit = s.db.prepare("SELECT * FROM admin_audit WHERE action = 'model_grant'").all();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].target_user_id, pro.id);
    assert.equal(audit[0].admin_user_id, admin.id);
    assert.deepEqual(JSON.parse(audit[0].detail).models, 2);

    assert.equal((await submit(pro, refs, 2)).status, 201, 'the granted models can be used');
    assert.equal((await submit(pro, refs, 1)).status, 409);
    // The studio's drawer shows where the contractor stands, grants included.
    const any = s.db.prepare("SELECT id FROM orders WHERE user_id = ? AND tier = 'plan' LIMIT 1").get(pro.id).id;
    const view = await admin.get(`/api/orders/${any}`);
    assert.deepEqual([view.body.buyerAllowance.total, view.body.buyerAllowance.left, view.body.buyerAllowance.grants.length], [5, 0, 1]);

    // Next period the grant no longer applies: 3 again.
    s.setNow(t0 + 32 * DAY);
    assert.equal((await pro.post('/api/auth/login', { email: pro.user.email, password: pro.user.password })).status, 200);
    const next = (await pro.get('/api/orders/allowance')).body.allowance;
    assert.deepEqual([next.granted, next.total, next.left], [0, 3, 3]);
  } finally {
    await s.close();
  }
});

test('if the plan lapses, submitted requests are still delivered, and no new ones can be made', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const t0 = Date.UTC(2026, 9, 15, 12);
    s.setNow(t0);
    const pro = await demoContractor(s);
    const studio = await s.user({ role: 'studio' });
    const refs = [await refPhoto(pro)];
    const r = await submit(pro, refs, 1);
    assert.equal(r.status, 201);
    const id = r.body.order.id;

    // Cancel the plan; it lapses at the period's end.
    const c = await pro.post('/api/billing/cancel');
    assert.equal(c.status, 200, c.text);
    s.setNow(r.body.allowance.periodEnd + DAY);
    for (const a of [pro, studio]) assert.equal((await a.post('/api/auth/login', { email: a.user.email, password: a.user.password })).status, 200);
    const a = (await pro.get('/api/orders/allowance')).body.allowance;
    assert.deepEqual([a.active, a.left], [false, 0]);
    const denied = await submit(pro, refs, 1);
    assert.equal(denied.status, 403);
    assert.equal(denied.body.needs, 'contractor');

    // The request made while on the plan is still made and delivered, into their catalog.
    assert.equal((await studio.post(`/api/studio/orders/${id}/start`)).status, 200);
    const m = await studio.putRaw('/api/files?kind=model&name=m.glb', makeGlb({ w: 0.762, h: 0.876, d: 0.61 }), 'model/gltf-binary');
    const th = await studio.putRaw('/api/files?kind=image&name=t.png', makePng(), 'image/png');
    const d = await studio.post(`/api/studio/orders/${id}/deliver`, { modelFileId: m.body.file.id, thumbFileId: th.body.file.id });
    assert.equal(d.status, 200, d.text);
    assert.equal(d.body.order.status, 'delivered');
    const p = s.services.products.get(d.body.order.deliverableProductId);
    assert.deepEqual([p.source, p.ownerUserId], ['contractor', pro.id]);
    // Their history still lists it.
    assert.deepEqual((await pro.get('/api/orders')).body.orders.map((o) => [o.id, o.status]), [[id, 'delivered']]);
  } finally {
    await s.close();
  }
});
