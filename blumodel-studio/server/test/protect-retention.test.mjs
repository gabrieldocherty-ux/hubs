// Retention (audit 2026-10: "leads that never send a design are kept forever, and the visitor cookie
// lasts 400 days"). docs/handoff/data-lifecycle.md is the policy these pin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, sampleDoc, startTestServer } from './helpers.mjs';

const DAY = 86_400_000;
const MONTH = 30 * DAY;
const me = (over = {}) => ({ name: 'Riley Okafor', email: 'riley@example.com', consent: true, website: '', ...over });

test('the daily sweep deletes leads that never sent a design and were never worked on, after 24 months; the company can choose less', async () => {
  const t = await startTestServer();
  try {
    const A = t.tenant({ name: 'Alpha', slug: 'ret-a' });
    const B = t.tenant({ name: 'Bravo', slug: 'ret-b' });
    const owner = await t.showroomUser(A, { role: 'owner' });
    const bOwner = await t.showroomUser(B, { role: 'owner' });
    const t0 = Date.now();
    t.setNow(t0);
    // Licensed for years, so the showrooms stay live while the clock moves.
    const today = new Date(t0).toISOString().slice(0, 10);
    for (const tn of [A, B]) t.services.showroomBilling.recordLicense(tn.id, { paidHow: 'comp', amountCents: 0, startsOn: today, endsOn: `${Number(today.slice(0, 4)) + 5}${today.slice(4)}` });
    /** Sessions last 30 days: the owners sign in again after a jump. */
    const jump = async (ms) => {
      t.setNow(ms);
      t.services.tenants.refreshAll();
      await t.signIn(owner);
      await t.signIn(bOwner);
    };
    const visit = async (tn, who) => {
      const v = new Agent(t.url, { host: tn.host });
      assert.equal((await v.post('/api/visitor', who)).status, 201);
      return v;
    };
    const idle = await visit(A, me({ name: 'Idle', email: 'idle@example.com' }));
    const k = (await idle.post('/api/projects', { name: 'Idle kitchen', doc: sampleDoc() })).body.project;
    const worked = await visit(A, me({ name: 'Worked', email: 'worked@example.com' }));
    const sender = await visit(A, me({ name: 'Sender', email: 'sender@example.com' }));
    const sk = (await sender.post('/api/projects', { name: 'Sent kitchen', doc: sampleDoc() })).body.project;
    assert.equal((await sender.post('/api/leads', { name: 'Sender', email: 'sender@example.com', consent: true, projectId: sk.id, website: '' })).status, 201);
    const leadsA = (await owner.get('/api/workspace/leads')).body.leads;
    const id = (n) => leadsA.find((l) => l.name === n).id;
    assert.equal((await owner.patch(`/api/workspace/leads/${id('Worked')}`, { status: 'contacted' })).status, 200);
    await visit(B, me({ name: 'Bravo idle', email: 'b-idle@example.com' }));

    // 23 months on: nothing is old enough.
    await jump(t0 + 23 * MONTH);
    const recent = await visit(A, me({ name: 'Recent', email: 'recent@example.com' }));
    assert.deepEqual(t.ctx.retentionSweep(), { leads: 0, designs: 0, tenants: 0, salesLeads: 0 });
    // 25 months on: the idle lead and its design go, in both showrooms; worked-on and sent leads stay.
    await jump(t0 + 25 * MONTH);
    const out = t.ctx.retentionSweep();
    assert.deepEqual(out, { leads: 2, designs: 1, tenants: 2, salesLeads: 0 });
    const names = (await owner.get('/api/workspace/leads')).body.leads.map((l) => l.name).sort();
    assert.deepEqual(names, ['Recent', 'Sender', 'Worked']);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM projects WHERE id = ?').get(k.id).n, 0);
    assert.equal((await idle.get('/api/visitor')).body.visitor, null, 'its browser is forgotten too');
    assert.equal((await bOwner.get('/api/workspace/leads')).body.leads.length, 0);
    // One audit row per sweep, counts only.
    const rows = t.db.prepare("SELECT * FROM admin_audit WHERE action = 'retention_sweep'").all();
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(rows[0].detail), { leads: 2, designs: 1, tenants: 2, salesLeads: 0 });
    assert.ok(!rows[0].detail.includes('@'));

    // A shorter choice in Workspace (owners only): 6 months.
    assert.equal((await owner.patch('/api/workspace/showroom', { settings: { leadRetentionMonths: 7 } })).status, 400);
    const staff = await t.showroomUser(A, { role: 'staff' });
    assert.notEqual((await staff.patch('/api/workspace/showroom', { settings: { leadRetentionMonths: 6 } })).status, 200);
    const set = await owner.patch('/api/workspace/showroom', { settings: { leadRetentionMonths: 6 } });
    assert.equal(set.status, 200, set.text);
    assert.equal(set.body.tenant.settings.leadRetentionMonths, 6);
    await visit(B, me({ name: 'Bravo new', email: 'b-new@example.com' }));
    await jump(t0 + 23 * MONTH + 7 * MONTH);
    const r2 = t.ctx.retentionSweep();
    assert.equal(r2.leads, 1, 'only Alpha’s Recent (7 months idle at 6); Bravo keeps its 7-month lead under the default');
    assert.deepEqual((await owner.get('/api/workspace/leads')).body.leads.map((l) => l.name).sort(), ['Sender', 'Worked']);
    assert.equal((await recent.get('/api/visitor')).body.visitor, null);
    assert.equal((await bOwner.get('/api/workspace/leads')).body.leads.length, 1);
  } finally {
    t.setNow(null);
    await t.close();
  }
});

test('maintenance runs the sweep at most once a day; the visitor cookie lasts 180 days', async () => {
  const t = await startTestServer();
  try {
    const A = t.tenant({ slug: 'ret-c' });
    const v = new Agent(t.url, { host: A.host });
    const r = await v.post('/api/visitor', me());
    assert.match(r.headers.get('set-cookie'), new RegExp(`blumodel_visitor=[^;]+;.*Max-Age=${180 * 86_400}`));
    let runs = 0;
    const real = t.ctx.retentionSweep;
    t.ctx.retentionSweep = () => (runs++, real());
    const t0 = Date.now();
    t.setNow(t0);
    t.ctx.maintenance();
    t.ctx.maintenance();
    t.setNow(t0 + 10 * 60_000);
    t.ctx.maintenance();
    assert.equal(runs, 1);
    t.setNow(t0 + DAY + 1);
    t.ctx.maintenance();
    assert.equal(runs, 2);
  } finally {
    t.setNow(null);
    await t.close();
  }
});

test('"Book a call" sales leads: an admin can delete one (re-authenticated, audited without the person), and they go 24 months after the last update', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const post = (company, email) => t.agent().post('/api/sales-leads', { company, name: 'Robin', email, phone: '519-555-0177', website: '' });
    assert.equal((await post('Gone Co', 'robin@gone.test')).status, 201);
    assert.equal((await post('Old Co', 'old@old.test')).status, 201);
    const leads = (await admin.get('/api/admin/sales-leads')).body.leads;
    const gone = leads.find((l) => l.company === 'Gone Co');
    // An earlier audit row that names the person (a status change carries the company only; this one is made up).
    t.db.prepare("INSERT INTO admin_audit (at, admin_user_id, admin_email, action, target_user_id, target_email, detail) VALUES (1, NULL, '', 'note', NULL, 'robin@gone.test', '{}')").run();
    // The reproduced finding: there was no delete. Now there is, behind re-authentication.
    admin.keepFresh = false;
    t.db.prepare('UPDATE sessions SET auth_at = 0 WHERE user_id = ?').run(admin.id);
    assert.equal((await admin.delete(`/api/admin/sales-leads/${gone.id}`)).body.code, 'reauth_required');
    admin.keepFresh = true;
    const del = await admin.delete(`/api/admin/sales-leads/${gone.id}`);
    assert.equal(del.status, 200, del.text);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM sales_leads WHERE id = ?').get(gone.id).n, 0);
    const a = t.db.prepare("SELECT detail FROM admin_audit WHERE action = 'sales_lead_delete'").get();
    assert.deepEqual(JSON.parse(a.detail), { leadId: gone.id, company: 'Gone Co' });
    assert.ok(!JSON.stringify(t.db.prepare('SELECT * FROM admin_audit').all()).includes('robin@gone.test'));
    assert.equal((await t.agent().delete(`/api/admin/sales-leads/${gone.id}`)).status, 401);
    // Retention: 23 months untouched stays, 25 months goes.
    const t0 = Date.now();
    t.setNow(t0 + 23 * MONTH);
    assert.equal(t.ctx.retentionSweep().salesLeads, 0);
    t.setNow(t0 + 25 * MONTH);
    assert.equal(t.ctx.retentionSweep().salesLeads, 1);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM sales_leads').get().n, 0);
  } finally {
    t.setNow(null);
    await t.close();
  }
});
