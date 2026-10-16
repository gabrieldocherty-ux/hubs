// The owner's admin panel (server/routes/adminPanel.mjs, server/admin/*): access, the dashboard's
// money rules, user actions, contractors, system status without secrets, and the audit log.
// Temp in-memory databases and FAKE keys only; nothing here calls Stripe or an email provider.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestServer } from './helpers.mjs';
import { redact } from '../admin/redact.mjs';
import { recentLogProblems } from '../admin/system.mjs';
import { dayStart } from '../routes/adminPanel.mjs';

const DAY = 86_400_000;
const FAKE_SK = 'sk_test_FAKEFAKEFAKEFAKEadminpanel000';
const FAKE_WH = 'whsec_FAKEFAKEFAKEadminpanel000';

const fill = (p) => p.replace(/:([A-Za-z_]+)/g, 'nobody_here');

test('every admin route: 401 signed out, 403 for customers, studio and brand members; writes need the CSRF header', async () => {
  const t = await startTestServer();
  try {
    const customer = await t.user();
    const studio = await t.user({ role: 'studio' });
    const admin = await t.user({ role: 'admin' });
    const routes = t.ctx.routes.filter((r) => r.path.startsWith('/api/admin') && r.auth === 'admin');
    // The panel's own routes are all there.
    for (const p of ['/api/admin/dashboard', '/api/admin/users/:id', '/api/admin/users/:id/disable', '/api/admin/users/:id/delete', '/api/admin/contractors', '/api/admin/system', '/api/admin/audit']) {
      assert.ok(routes.some((r) => r.path === p), `${p} is registered as admin-only`);
    }
    for (const r of routes) {
      const p = fill(r.path);
      const anon = t.agent();
      assert.equal((await anon.request(r.method, p, { body: r.method === 'GET' ? undefined : {} })).status, 401, `${r.method} ${r.path} signed out`);
      for (const who of [customer, studio]) {
        const res = await who.request(r.method, p, { body: r.method === 'GET' ? undefined : {} });
        assert.equal(res.status, 403, `${r.method} ${r.path} as ${who.user.role}`);
      }
      if (r.method !== 'GET') assert.equal((await admin.request(r.method, p, { body: {}, csrf: false })).status, 403, `${r.method} ${r.path} without X-BluModel`);
    }
    // And an admin gets through to the panel's reads.
    for (const p of ['/api/admin/dashboard', '/api/admin/contractors', '/api/admin/system', '/api/admin/audit']) assert.equal((await admin.get(p)).status, 200, p);
  } finally {
    await t.close();
  }
});

test('dashboard: sign-ups, plans, MRR per currency (CAD apart from legacy USD), real apart from demo, unlocks, refunds, queue, leads, link-outs', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const a = await t.user();
    const b = await t.user();
    const c = await t.user();
    const now = Date.now();
    const db = t.db;
    // b signed up 40 days ago: not in the 7 or 30 day counts.
    db.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(now - 40 * DAY, b.id);
    const sub = (u, plan, provider, amount, currency, extra = {}) =>
      db
        .prepare(
          `INSERT INTO subscriptions (id, user_id, plan, status, provider, current_period_end, cancel_at_period_end, created_at, updated_at, amount_cents, currency)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(`sub_${u.id}`, u.id, plan, extra.status ?? 'active', provider, now + 20 * DAY, 0, now, now, amount, currency);
    sub(a, 'unlimited', 'stripe', 1900, 'cad');
    sub(b, 'contractor', 'stripe', 4000, 'usd'); // a legacy USD subscription
    sub(c, 'unlimited', 'demo', 1900, 'cad');
    // Unlocks: one CAD real, one USD real (old), one demo.
    const project = (u) => {
      const id = `p_${Math.random().toString(36).slice(2, 10)}`;
      db.prepare("INSERT INTO projects (id, user_id, name, doc, created_at, updated_at) VALUES (?, ?, 'K', '{}', ?, ?)").run(id, u.id, now, now);
      return id;
    };
    const unlock = (u, provider, cents, currency, at = now) =>
      db.prepare('INSERT INTO kitchen_unlocks (project_id, user_id, provider, payment_ref, amount_cents, created_at, currency) VALUES (?, ?, ?, ?, ?, ?, ?)').run(project(u), u.id, provider, `ref_${Math.random()}`, cents, at, currency);
    unlock(a, 'stripe', 700, 'cad');
    unlock(a, 'stripe', 500, 'usd', now - 60 * DAY);
    unlock(c, 'demo', 700, 'cad');
    // A refunded real order and an open studio queue.
    const order = (u, status, provider, cents, extra = {}) =>
      db
        .prepare(
          `INSERT INTO orders (id, user_id, target, status, tier, amount_cents, currency, provider, brief, pending_since, created_at, updated_at, paid_at, refunded_at, due_at)
           VALUES (?, ?, 'customer', ?, 'simple', ?, 'cad', ?, '{}', ?, ?, ?, ?, ?, ?)`,
        )
        .run(`o_${Math.random().toString(36).slice(2, 10)}`, u.id, status, cents, provider, now, now, now, extra.paidAt ?? now, extra.refundedAt ?? null, extra.dueAt ?? null);
    order(a, 'refunded', 'stripe', 4900, { refundedAt: now - DAY });
    order(a, 'paid', 'stripe', 4900);
    order(a, 'in_progress', 'stripe', 4900, { dueAt: now - DAY });
    // A lead and link-outs.
    const brand = t.brand(a, { name: 'Lead Co' });
    db.prepare("INSERT INTO leads (id, brand_id, name, email, created_at, updated_at) VALUES ('l1', ?, 'N', 'n@test.blumodel', ?, ?)").run(brand.id, now, now);
    const today = new Date(now).toISOString().slice(0, 10);
    db.prepare("INSERT INTO retail_clicks (store, product_id, day, clicks) VALUES ('ikea', 'x', ?, 5)").run(today);
    db.prepare("INSERT INTO retail_clicks (store, product_id, day, clicks) VALUES ('ikea', 'x', '2000-01-01', 99)").run();

    const r = await admin.get('/api/admin/dashboard');
    assert.equal(r.status, 200);
    const d = r.body;
    assert.equal(d.signups.total, 4);
    assert.equal(d.signups.d30, 3);
    assert.equal(d.subscriptions.stripe.unlimited, 1);
    assert.equal(d.subscriptions.stripe.contractor, 1);
    assert.equal(d.subscriptions.demo.unlimited, 1);
    // Never mixed: CAD and USD apart, demo apart.
    assert.deepEqual(d.subscriptions.stripe.mrrByCurrency, { cad: 1900, usd: 4000 });
    assert.deepEqual(d.subscriptions.demo.mrrByCurrency, { cad: 1900 });
    assert.deepEqual(d.money.stripe.unlocksAll.byCurrency, { cad: 700, usd: 500 });
    assert.deepEqual(d.money.stripe.unlocks30d.byCurrency, { cad: 700 });
    assert.deepEqual(d.money.demo.unlocksAll.byCurrency, { cad: 700 });
    assert.equal(d.money.stripe.refunds30d.count, 1);
    assert.deepEqual(d.money.stripe.refunds30d.byCurrency, { cad: 4900 });
    assert.equal(d.studioQueue.open, 2);
    assert.equal(d.studioQueue.toStart, 1);
    assert.equal(d.studioQueue.overdue, 1);
    assert.equal(d.leads.d30, 1);
    assert.equal(d.leads.unread, 1);
    assert.equal(d.retail.d30, 5);
    assert.equal(d.models.contractors, 1);
    assert.equal(d.recentSignups.length, 4);
    assert.ok(d.recentPayments.length >= 1);
  } finally {
    await t.close();
  }
});

test('user detail has what the owner needs and no secret: no password hash, session token or hash, reset token or provider reference', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const ann = await t.user({ name: 'Ann Detail' });
    await admin.post(`/api/admin/users/${ann.id}/reset-link`);
    t.db.prepare("INSERT INTO subscriptions (id, user_id, plan, status, provider, customer_ref, subscription_ref, current_period_end, created_at, updated_at, amount_cents, currency) VALUES ('s1', ?, 'unlimited', 'active', 'stripe', 'cus_SECRETREF', 'sub_SECRETREF', ?, ?, ?, 1900, 'cad')").run(ann.id, Date.now() + DAY, Date.now(), Date.now());
    const r = await admin.get(`/api/admin/users/${ann.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.user.email, ann.user.email);
    assert.equal(r.body.plan.id, 'unlimited');
    assert.equal(r.body.sessions.length, 1);
    assert.ok(r.body.user.lastSeenAt > 0);
    const hashes = t.db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').all(ann.id).map((s) => s.token_hash);
    const pw = t.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(ann.id).password_hash;
    const resetHash = t.db.prepare('SELECT token_hash FROM password_resets WHERE user_id = ?').get(ann.id).token_hash;
    for (const s of [...hashes, pw, resetHash, ann.cookies.get('blumodel_session'), 'cus_SECRETREF', 'sub_SECRETREF']) assert.ok(!r.text.includes(s), 'no secret in the detail');
    assert.equal((await admin.get('/api/admin/users/nobody_here')).status, 404);
  } finally {
    await t.close();
  }
});

test('roles: customer <-> studio only; admin is CLI-only (never granted, never taken away); never your own; audited', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const other = await t.user({ role: 'admin' });
    const bob = await t.user();
    let r = await admin.post(`/api/admin/users/${bob.id}/role`, { role: 'studio' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.role, 'studio');
    assert.equal((await admin.post(`/api/admin/users/${bob.id}/role`, { role: 'admin' })).status, 400);
    assert.equal((await admin.patch(`/api/admin/users/${bob.id}`, { role: 'admin' })).status, 400, 'the old PATCH can’t grant admin either');
    assert.equal((await admin.post(`/api/admin/users/${other.id}/role`, { role: 'customer' })).status, 409, 'an admin is not demoted here');
    assert.equal((await admin.patch(`/api/admin/users/${other.id}`, { role: 'customer' })).status, 409);
    assert.equal((await admin.post(`/api/admin/users/${admin.id}/role`, { role: 'customer' })).status, 400);
    r = await admin.patch(`/api/admin/users/${bob.id}`, { role: 'customer' });
    assert.equal(r.status, 200);
    assert.equal(t.db.prepare('SELECT role FROM users WHERE id = ?').get(bob.id).role, 'customer');
    assert.equal(t.db.prepare('SELECT role FROM users WHERE id = ?').get(other.id).role, 'admin');
    const log = (await admin.get('/api/admin/audit?action=role_change')).body;
    assert.equal(log.total, 2);
    assert.deepEqual(log.entries.map((e) => e.detail.to), ['customer', 'studio']);
    assert.ok(log.entries.every((e) => e.targetEmail === bob.user.email && e.adminEmail === admin.user.email));
  } finally {
    await t.close();
  }
});

test('complimentary plan with an end date: on until the end of that day (UTC), then Free; revoke ends it now; both audited', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const cara = await t.user();
    const base = Date.UTC(2026, 9, 16, 12);
    t.setNow(base);
    assert.equal((await admin.post(`/api/admin/users/${cara.id}/comp`, { plan: 'gold' })).status, 400);
    assert.equal((await admin.post(`/api/admin/users/${cara.id}/comp`, { plan: 'contractor', endsOn: '2026-02-30' })).status, 400);
    assert.equal((await admin.post(`/api/admin/users/${cara.id}/comp`, { plan: 'contractor', endsOn: '2026-10-01' })).status, 400, 'in the past');
    let r = await admin.post(`/api/admin/users/${cara.id}/comp`, { plan: 'contractor', endsOn: '2026-10-20', note: 'Pilot' });
    assert.equal(r.status, 201);
    assert.equal(r.body.plan.id, 'contractor');
    assert.equal(r.body.subscription.compEndsAt, Date.UTC(2026, 9, 21));
    t.setNow(Date.UTC(2026, 9, 20, 23, 59));
    assert.equal((await admin.get(`/api/admin/users/${cara.id}`)).body.plan.id, 'contractor');
    // The account itself can't make it permanent: "resume" has nothing to resume.
    assert.notEqual((await cara.post('/api/billing/resume')).status, 200);
    t.setNow(Date.UTC(2026, 9, 21, 0, 1));
    assert.equal((await admin.get(`/api/admin/users/${cara.id}`)).body.plan.id, 'free');
    // Again with no end, then revoke.
    r = await admin.post(`/api/admin/users/${cara.id}/comp`, { plan: 'unlimited' });
    assert.equal(r.body.plan.id, 'unlimited');
    assert.equal(r.body.subscription.compEndsAt, null);
    r = await admin.post(`/api/admin/users/${cara.id}/comp/revoke`);
    assert.equal(r.status, 200);
    assert.equal(r.body.plan.id, 'free');
    assert.equal((await admin.post(`/api/admin/users/${cara.id}/comp/revoke`)).status, 404);
    const actions = (await admin.get('/api/admin/audit')).body.entries.map((e) => e.action);
    assert.deepEqual(actions.slice(0, 3), ['comp_revoke', 'comp_grant', 'comp_grant']);
  } finally {
    await t.close();
  }
});

test('sign out everywhere, disable (no sign-in, sessions ended, reset links void) and enable again', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const dan = await t.user();
    const second = t.agent();
    assert.equal((await second.post('/api/auth/login', { email: dan.user.email, password: dan.user.password })).status, 200);
    let r = await admin.post(`/api/admin/users/${dan.id}/sign-out`);
    assert.equal(r.status, 200);
    assert.equal(r.body.ended, 2);
    assert.equal((await dan.get('/api/auth/me')).body.user, null);
    assert.equal((await second.get('/api/auth/me')).body.user, null);

    assert.equal((await dan.post('/api/auth/login', { email: dan.user.email, password: dan.user.password })).status, 200);
    await admin.post(`/api/admin/users/${dan.id}/reset-link`);
    r = await admin.post(`/api/admin/users/${dan.id}/disable`, { reason: 'Chargeback' });
    assert.equal(r.status, 200);
    assert.equal(r.body.user.disabled.reason, 'Chargeback');
    assert.equal((await dan.get('/api/auth/me')).body.user, null, 'the live session is gone');
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ?').get(dan.id).n, 0);
    const login = await t.agent().post('/api/auth/login', { email: dan.user.email, password: dan.user.password });
    assert.equal(login.status, 403);
    assert.equal(login.body.code, 'account_disabled');
    // A wrong password still says only that it is wrong.
    assert.equal((await t.agent().post('/api/auth/login', { email: dan.user.email, password: 'not it at all' })).status, 401);
    // A session row that somehow survived is not honoured.
    t.ctx.internal.sessions.endAll(dan.id);
    assert.throws(() => t.ctx.internal.sessions.start({ headers: {} }, { setHeader() {} }, dan.id), /disabled/);
    assert.equal((await admin.post(`/api/admin/users/${dan.id}/disable`)).status, 409);
    assert.equal((await admin.post(`/api/admin/users/${admin.id}/disable`)).status, 400, 'not yourself');
    const boss = await t.user({ role: 'admin' });
    assert.equal((await admin.post(`/api/admin/users/${boss.id}/disable`)).status, 409, 'not an admin');

    r = await admin.post(`/api/admin/users/${dan.id}/enable`);
    assert.equal(r.status, 200);
    assert.equal(r.body.user.disabled, null);
    assert.equal((await t.agent().post('/api/auth/login', { email: dan.user.email, password: dan.user.password })).status, 200);
    assert.equal((await admin.post(`/api/admin/users/${dan.id}/enable`)).status, 409);
    const actions = (await admin.get('/api/admin/audit')).body.entries.map((e) => e.action);
    for (const a of ['sign_out_all', 'account_disable', 'account_enable']) assert.ok(actions.includes(a), a);
  } finally {
    await t.close();
  }
});

test('delete: typed email confirmation, not yourself, not an admin, not while a paid plan renews; the audit record stays', async () => {
  const t = await startTestServer({ rateLimits: true });
  try {
    const admin = await t.user({ role: 'admin' });
    const eve = await t.user({ email: 'eve-delete@test.blumodel' });
    await eve.post('/api/projects', { name: 'Eve kitchen', doc: { name: 'Eve kitchen', room: { widthIn: 120, lengthIn: 120, ceilingIn: 96 }, surfaces: {}, items: [] } });
    assert.equal((await admin.post(`/api/admin/users/${eve.id}/delete`, { confirm: 'eve@wrong' })).status, 400);
    assert.equal((await admin.post(`/api/admin/users/${admin.id}/delete`, { confirm: admin.user.email })).status, 400);
    t.db.prepare("INSERT INTO subscriptions (id, user_id, plan, status, provider, subscription_ref, current_period_end, created_at, updated_at, amount_cents, currency) VALUES ('s2', ?, 'unlimited', 'active', 'stripe', 'sub_x', ?, ?, ?, 1900, 'cad')").run(eve.id, Date.now() + DAY, Date.now(), Date.now());
    assert.equal((await admin.post(`/api/admin/users/${eve.id}/delete`, { confirm: 'EVE-DELETE@test.blumodel' })).status, 409);
    t.db.prepare('DELETE FROM subscriptions WHERE id = ?').run('s2');
    const r = await admin.post(`/api/admin/users/${eve.id}/delete`, { confirm: ' EVE-DELETE@test.blumodel ' });
    assert.equal(r.status, 200);
    assert.equal(r.body.deleted, true);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').get(eve.id).n, 0);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM projects WHERE user_id = ?').get(eve.id).n, 0);
    const log = (await admin.get('/api/admin/audit?action=account_delete')).body;
    assert.equal(log.total, 1);
    assert.equal(log.entries[0].targetEmail, 'eve-delete@test.blumodel');
    // Rate-limited: 20 an hour per admin.
    let last = 0;
    for (let i = 0; i < 20; i++) last = (await admin.post(`/api/admin/users/nobody_here/delete`, { confirm: 'x' })).status;
    assert.equal(last, 429);
  } finally {
    await t.close();
  }
});

test('contractors: listed with company, plan, page and models; verify needs a brand page; extra models through the existing grant', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const kim = await t.user({ name: 'Kim Builder' });
    const now = Date.now();
    t.db.prepare("INSERT INTO contractor_profiles (user_id, company, phone, created_at, updated_at) VALUES (?, 'Kim Kitchens', '905-555-0100', ?, ?)").run(kim.id, now, now);
    await admin.post(`/api/admin/users/${kim.id}/comp`, { plan: 'contractor' });
    let r = await admin.get('/api/admin/contractors?q=kim kitch');
    assert.equal(r.status, 200);
    assert.equal(r.body.contractors.length, 1);
    const c = r.body.contractors[0];
    assert.equal(c.company, 'Kim Kitchens');
    assert.equal(c.plan.id, 'contractor');
    assert.equal(c.models.active, true);
    assert.equal(c.models.total, 3);
    assert.equal(c.brandPage, null);
    assert.equal((await admin.post(`/api/admin/contractors/${kim.id}/verify`, { verified: true })).status, 409);
    assert.equal((await admin.post(`/api/admin/contractors/${kim.id}/verify`, { verified: 'yes' })).status, 400);
    const brand = t.brand(kim, { name: 'Kim Kitchens' });
    t.db.prepare("UPDATE brands SET kind = 'contractor', owner_user_id = ? WHERE id = ?").run(kim.id, brand.id);
    r = await admin.post(`/api/admin/contractors/${kim.id}/verify`, { verified: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.contractor.brandPage.verified, true);
    r = await admin.post(`/api/admin/contractors/${kim.id}/verify`, { verified: false });
    assert.equal(r.body.contractor.brandPage.verified, false);
    r = await admin.post('/api/admin/model-grants', { userId: kim.id, models: 2, note: 'Launch' });
    assert.equal(r.status, 201);
    assert.equal((await admin.get('/api/admin/contractors')).body.contractors[0].models.total, 5);
    const actions = (await admin.get('/api/admin/audit')).body.entries.map((e) => e.action);
    for (const a of ['contractor_verify', 'contractor_unverify', 'model_grant']) assert.ok(actions.includes(a), a);
  } finally {
    await t.close();
  }
});

test('system: health and setup as yes/no; no key, secret or token ever in the answer; webhook failures are recorded', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blumodel-admin-log-'));
  const logFile = path.join(tmp, 'server.log');
  fs.writeFileSync(
    logFile,
    [
      '2026-10-16T10:00:00.000Z INFO  started',
      `2026-10-16T10:01:00.000Z ERROR [req abc] POST /api/x failed: Error: boom with ${FAKE_SK} and token=abcdef123 and Bearer eyJhbGciOiJIUzI1NiJ9.payload`,
      '    at stack line (that is not shown)',
      `2026-10-16T10:02:00.000Z WARN  webhook secret ${FAKE_WH} rejected`,
    ].join('\n'),
  );
  const prevLog = process.env.BLUMODEL_LOG_FILE;
  process.env.BLUMODEL_LOG_FILE = logFile;
  const t = await startTestServer({ env: { STRIPE_SECRET_KEY: FAKE_SK, STRIPE_WEBHOOK_SECRET: FAKE_WH, RESEND_API_KEY: 're_FAKEFAKEFAKE1234', EMAIL_FROM: 'BluModel <hello@test.blumodel>', SUPPORT_EMAIL: 'help@test.blumodel' } });
  try {
    const admin = await t.user({ role: 'admin' });
    // A webhook with a bad signature: refused and recorded (reason only).
    const hook = await t.agent().request('POST', '/api/webhooks/stripe', { raw: '{"id":"evt_1","type":"invoice.paid"}', contentType: 'application/json', headers: { 'Stripe-Signature': 't=1,v1=bad' }, csrf: false });
    assert.equal(hook.status, 400);
    const r = await admin.get('/api/admin/system');
    assert.equal(r.status, 200);
    const s = r.body;
    assert.equal(s.payments.provider, 'stripe');
    assert.equal(s.payments.stripeMode, 'test');
    assert.equal(s.payments.secretKeySet, true);
    assert.equal(s.payments.webhookSecretSet, true);
    assert.equal(s.payments.failures[0].reason, 'signature');
    assert.equal(s.payments.failures24h, 1);
    assert.equal(s.email.configured, true);
    assert.equal(s.email.provider, 'resend');
    assert.equal(s.legal.supportEmailSet, true);
    assert.equal(s.legal.legalNameSet, false);
    assert.ok(s.server.uptimeSec >= 0);
    assert.equal(s.database.inMemory, true);
    assert.equal(s.log.available, true);
    assert.equal(s.log.entries.length, 2);
    assert.equal(s.log.entries[0].level, 'warn');
    for (const secret of [FAKE_SK, FAKE_WH, 're_FAKEFAKEFAKE1234', 'abcdef123', 'eyJhbGciOiJIUzI1NiJ9', 'FAKEFAKE']) assert.ok(!r.text.includes(secret), `no ${secret.slice(0, 8)}… in the answer`);
    assert.ok(!r.text.includes('stack line'), 'only the first line of an entry');
  } finally {
    await t.close();
    if (prevLog === undefined) delete process.env.BLUMODEL_LOG_FILE;
    else process.env.BLUMODEL_LOG_FILE = prevLog;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('audit log: filter by actor, action and date; paginated 50 a page, newest first', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin', email: 'boss-audit@test.blumodel' });
    const ins = t.db.prepare("INSERT INTO admin_audit (at, admin_user_id, admin_email, action, target_user_id, target_email, detail) VALUES (?, ?, ?, ?, NULL, 't@test.blumodel', '{}')");
    const d1 = Date.UTC(2026, 8, 1, 12);
    for (let i = 0; i < 60; i++) ins.run(d1 + i * 1000, admin.id, 'boss-audit@test.blumodel', 'comp_grant');
    for (let i = 0; i < 5; i++) ins.run(Date.UTC(2026, 9, 1, 12) + i, 'x', 'other@test.blumodel', 'reset_link');
    let r = await admin.get('/api/admin/audit');
    assert.equal(r.body.total, 65);
    assert.equal(r.body.pages, 2);
    assert.equal(r.body.entries.length, 50);
    assert.equal(r.body.entries[0].action, 'reset_link');
    r = await admin.get('/api/admin/audit?page=2');
    assert.equal(r.body.entries.length, 15);
    r = await admin.get('/api/admin/audit?actor=OTHER@');
    assert.equal(r.body.total, 5);
    r = await admin.get('/api/admin/audit?action=comp_grant&from=2026-09-01&to=2026-09-01');
    assert.equal(r.body.total, 60);
    r = await admin.get('/api/admin/audit?from=2026-09-02');
    assert.equal(r.body.total, 5);
    assert.deepEqual(r.body.actions, ['comp_grant', 'reset_link']);
    assert.ok(r.body.actors.includes('other@test.blumodel'));
    assert.equal((await admin.get('/api/admin/audit?from=yesterday')).status, 400);
    assert.equal((await admin.get('/api/admin/audit?action=DROP%20TABLE')).status, 400);
  } finally {
    await t.close();
  }
});

test('redaction and helpers', () => {
  const s = redact(`key ${FAKE_SK} rk_live_abc whsec_abc123 Bearer abc.def password=hunter2 "token": "zzz" ?reset=abc&x=1 ${'a'.repeat(40)} re_abcdefghijk sk-ant-api03-xyz`);
  for (const bad of ['FAKEFAKE', 'rk_live_abc', 'whsec_abc123', 'abc.def', 'hunter2', 'zzz', 'reset=abc', 'a'.repeat(40), 're_abcdefghijk', 'api03']) assert.ok(!s.includes(bad), bad);
  assert.equal(recentLogProblems(null).available, false);
  assert.equal(recentLogProblems(path.join(os.tmpdir(), 'nope-blumodel-admin.log')).available, false);
  assert.equal(dayStart('2026-10-16'), Date.UTC(2026, 9, 16));
  assert.equal(dayStart('2026-13-01'), null);
  assert.equal(dayStart('16/10/2026'), null);
});
