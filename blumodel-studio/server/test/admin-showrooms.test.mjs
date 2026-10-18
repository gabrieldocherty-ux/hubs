// Admin > Companies' extra numbers (server/routes/adminShowrooms.mjs): the Overview's showroom
// snapshot (companies by status, MRR from monthly plans, licenses booked this year, credits used),
// each company's usage (renders, products, leads, its studio queue) and the queue grouped by
// company. Admin-only, sales-site only, read-only. No payment provider is ever called.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, defaultSpec } from './helpers.mjs';

const DAY = 86_400_000;

function order(s, { userId, status = 'paid', dueAt = null, brief = 'Model our Lakeshore base cabinets' }) {
  const id = `o_${Math.random().toString(36).slice(2, 12)}`;
  const t = Date.now();
  s.db
    .prepare(
      `INSERT INTO orders (id, user_id, target, status, tier, amount_cents, currency, provider, brief, pending_since, created_at, updated_at, paid_at, due_at)
       VALUES (?, ?, 'contractor', ?, 'standard', 0, 'cad', 'plan', ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, userId, status, brief, t, t, t, t, dueAt);
  return id;
}

test('admin showrooms: admin-only, sales-site only', async () => {
  const s = await startTestServer();
  try {
    const tn = s.tenant({ slug: 'gate' });
    const customer = await s.user();
    const anon = s.agent();
    for (const p of ['/api/admin/showrooms/overview', '/api/admin/showrooms/queue', `/api/admin/tenants/${tn.id}/usage`]) {
      assert.equal((await anon.get(p)).status, 401, p);
      assert.equal((await customer.get(p)).status, 403, p);
      // On a showroom these routes don't exist at all, even for the showroom's owner.
      const owner = await s.showroomUser(tn, { role: 'owner' });
      assert.equal((await owner.get(p)).status, 404, p);
    }
    const admin = await s.user({ role: 'admin' });
    assert.equal((await admin.get('/api/admin/tenants/nope/usage')).status, 404);
    assert.equal((await admin.get('/api/admin/tenants/bad%20id/usage')).status, 404);
  } finally {
    await s.close();
  }
});

test('overview: companies by status, MRR from monthly plans, licenses booked this year, credits used', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const admin = await s.user({ role: 'admin' });
    const live = s.tenant({ slug: 'livecoa' }); // comp license + comp monthly
    s.tenant({ slug: 'setupco', status: 'setup' });
    s.tenant({ slug: 'lapsedco', status: 'lapsed' });
    s.tenant({ slug: 'pausedco', status: 'suspended' });
    // The demo showroom is ours, never a company.
    const demo = s.services.tenants.create({ name: 'Demo', slug: 'demoish', isDemo: true });

    // A real Stripe monthly plan on one company, one past due (in grace), one cancelling; and the
    // demo showroom's (not counted).
    const paying = s.tenant({ slug: 'payingco' });
    const graceCo = s.tenant({ slug: 'graceco' });
    const sub = (tenantId, status, cancel = 0) =>
      s.db
        .prepare(
          `INSERT OR REPLACE INTO tenant_subscriptions (tenant_id, provider, status, subscription_ref, current_period_end, grace_until, cancel_at_period_end, amount_cents, currency, created_at, updated_at)
           VALUES (?, 'stripe', ?, ?, ?, ?, ?, 5000, 'cad', ?, ?)`,
        )
        .run(tenantId, status, `sub_${tenantId}`, Date.now() + 20 * DAY, status === 'past_due' ? Date.now() + 10 * DAY : null, cancel, Date.now(), Date.now());
    sub(paying.id, 'active', 1);
    sub(graceCo.id, 'past_due');
    sub(demo.id, 'active');

    // Licenses: one sold at $1,500 this year, one voided, the harness's complimentary ones apart.
    let r = await admin.post(`/api/admin/tenants/${paying.id}/licenses`, { amountCents: 150000, paidHow: 'invoice' });
    assert.equal(r.status, 201, r.text);
    r = await admin.post(`/api/admin/tenants/${graceCo.id}/licenses`, { amountCents: 99900, paidHow: 'etransfer' });
    assert.equal((await admin.request('DELETE', `/api/admin/tenants/${graceCo.id}/licenses/${r.body.license.id}`)).status, 200);

    // Credits: one charged render, one released, one refunded.
    assert.equal((await admin.post(`/api/admin/tenants/${live.id}/credits`, { cents: 1000, note: 'Launch credits' })).status, 200);
    const credits = s.services.credits;
    credits.charge(credits.reserve(live.id, 25, { purpose: 'render', ref: 'r1' }).id);
    credits.release(credits.reserve(live.id, 25, { purpose: 'render', ref: 'r2' }).id);
    const h3 = credits.reserve(live.id, 25, { purpose: 'render', ref: 'r3' });
    credits.charge(h3.id);
    credits.refund(h3.id, { note: 'bad render' });

    // A sales lead and an open order for a company's owner.
    assert.equal((await s.agent().post('/api/sales-leads', { company: 'Acme Kitchens', name: 'Pat', email: 'pat@acme.test', website: '' })).status, 201);
    const owner = await s.showroomUser(live, { role: 'owner' });
    order(s, { userId: owner.user.id, dueAt: Date.now() - DAY });

    r = await admin.get('/api/admin/showrooms/overview');
    assert.equal(r.status, 200, r.text);
    const o = r.body;
    assert.deepEqual(o.companies, { setup: 1, trial: 0, live: 3, lapsed: 1, suspended: 1, total: 6, demo: 1 });
    assert.equal(o.monthly.stripe.count, 2);
    assert.deepEqual(o.monthly.stripe.byCurrency, { cad: 10000 });
    assert.equal(o.monthly.pastDue, 1);
    assert.equal(o.monthly.cancelling, 1);
    assert.equal(o.monthly.comp, 1, 'livecoa is complimentary (paying and graceco were overwritten with Stripe rows)');
    assert.equal(o.licenses.year, new Date().getUTCFullYear());
    assert.equal(o.licenses.count, 1);
    assert.deepEqual(o.licenses.byCurrency, { cad: 150000 });
    assert.ok(o.licenses.comp >= 3, 'the harness licenses are complimentary');
    assert.deepEqual(o.credits.used30d, { count: 1, cents: 25 });
    assert.deepEqual(o.credits.usedYear, { count: 1, cents: 25 });
    assert.equal(o.credits.outstandingCents, 975);
    assert.equal(o.salesLeads.new, 1);
    assert.deepEqual(o.queue, { companies: 1, open: 1, overdue: 1 });
  } finally {
    await s.close();
  }
});

test('usage and the studio queue: each company sees only its own orders; the list carries usage', async () => {
  const s = await startTestServer();
  try {
    const admin = await s.user({ role: 'admin' });
    const a = s.tenant({ slug: 'alpha' });
    const b = s.tenant({ slug: 'bravo' });
    const aOwner = await s.showroomUser(a, { role: 'owner' });
    const bOwner = await s.showroomUser(b, { role: 'owner' });
    const salesCustomer = await s.user();

    // A sales-site account on alpha's team (a converted contractor) and alpha's own owner.
    const contractor = await s.user({ role: 'customer' });
    s.services.tenants.addMember(a.id, contractor.user.id, 'staff');
    const o1 = order(s, { userId: aOwner.user.id, dueAt: Date.now() - DAY });
    const o2 = order(s, { userId: contractor.user.id, status: 'in_progress' });
    order(s, { userId: aOwner.user.id, status: 'delivered' }); // not open
    const o3 = order(s, { userId: bOwner.user.id });
    const o4 = order(s, { userId: salesCustomer.user.id });

    // Products and a render on alpha.
    assert.equal((await aOwner.post('/api/workspace/products', { spec: defaultSpec({ name: 'Alpha Base', line: 'Alpha' }) })).status, 201);
    const hidden = await aOwner.post('/api/workspace/products', { spec: defaultSpec({ name: 'Alpha Wall', line: 'Alpha' }) });
    assert.equal((await aOwner.post(`/api/workspace/products/${hidden.body.product.id}/hide`)).status, 200);
    await admin.post(`/api/admin/tenants/${a.id}/credits`, { cents: 100, note: 'test' });
    s.services.credits.charge(s.services.credits.reserve(a.id, 25, { purpose: 'render' }).id);

    let r = await admin.get(`/api/admin/tenants/${a.id}/usage`);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body.renders.total, { count: 1, cents: 25 });
    assert.deepEqual(r.body.renders.d30, { count: 1, cents: 25 });
    assert.equal(r.body.products.live, 1);
    assert.equal(r.body.products.hidden, 1);
    assert.equal(r.body.products.included, 50);
    assert.deepEqual(r.body.leads, { total: 0, new: 0, thisMonth: 0, sent: 0 });
    assert.deepEqual(r.body.queue.orders.map((o) => o.id).sort(), [o1, o2].sort());
    assert.equal(r.body.queue.overdue, 1);
    assert.ok(r.body.queue.orders.every((o) => typeof o.brief === 'string' && o.brief.length <= 160));

    r = await admin.get(`/api/admin/tenants/${b.id}/usage`);
    assert.deepEqual(r.body.queue.orders.map((o) => o.id), [o3]);
    assert.deepEqual(r.body.renders.total, { count: 0, cents: 0 });

    r = await admin.get('/api/admin/showrooms/queue');
    const groups = r.body.groups;
    assert.equal(groups.length, 3);
    assert.equal(groups[0].tenant.slug, 'alpha', 'the company with an overdue order first');
    assert.deepEqual(groups[0].orders.map((o) => o.id).sort(), [o1, o2].sort());
    assert.equal(groups[1].tenant.slug, 'bravo');
    assert.equal(groups[2].tenant, null, 'sales-site customers last');
    assert.deepEqual(groups[2].orders.map((o) => o.id), [o4]);

    r = await admin.get('/api/admin/tenants');
    const row = r.body.tenants.find((t) => t.id === a.id);
    assert.deepEqual(row.usage, { rendersUsed: 1, renderCents: 25, products: 1, includedProducts: 50, queueOpen: 2 });
    assert.equal(r.body.tenants.find((t) => t.id === b.id).usage.queueOpen, 1);
  } finally {
    await s.close();
  }
});

test('the queue follows orders.tenant_id once that column exists', async () => {
  const s = await startTestServer();
  try {
    const admin = await s.user({ role: 'admin' });
    const a = s.tenant({ slug: 'colone' });
    const b = s.tenant({ slug: 'coltwo' });
    const studioUser = await s.user();
    s.db.exec('ALTER TABLE orders ADD COLUMN tenant_id TEXT');
    const o = order(s, { userId: studioUser.user.id });
    s.db.prepare('UPDATE orders SET tenant_id = ? WHERE id = ?').run(b.id, o);
    assert.deepEqual((await admin.get(`/api/admin/tenants/${b.id}/usage`)).body.queue.orders.map((x) => x.id), [o]);
    assert.deepEqual((await admin.get(`/api/admin/tenants/${a.id}/usage`)).body.queue.orders, []);
    const groups = (await admin.get('/api/admin/showrooms/queue')).body.groups;
    assert.equal(groups.length, 1);
    assert.equal(groups[0].tenant.slug, 'coltwo');
  } finally {
    await s.close();
  }
});
