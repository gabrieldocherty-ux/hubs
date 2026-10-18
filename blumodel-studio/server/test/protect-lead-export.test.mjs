// The lead list export (audit 2026-10: "any staff member can download the whole lead list silently"):
// owners only unless an owner allows staff, every export audited (who, when, how many rows), and the
// owner sees the recent exports.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, startTestServer } from './helpers.mjs';

test('staff cannot export the lead list until an owner allows it; every export is recorded and shown to owners', async () => {
  const t = await startTestServer({ rateLimits: true });
  try {
    const A = t.tenant({ name: 'Alpha', slug: 'exp-a' });
    const owner = await t.showroomUser(A, { role: 'owner' });
    const staff = await t.showroomUser(A, { role: 'staff' });
    for (const [i, email] of ['a@example.com', 'b@example.com', 'c@example.com'].entries()) {
      assert.equal((await new Agent(t.url, { host: A.host }).post('/api/visitor', { name: `P${i}`, email, consent: true, website: '' }, { headers: { 'X-Forwarded-For': `10.0.0.${i}` } })).status, 201);
    }
    // The reproduced finding: staff got the whole list. Now: refused, and nothing recorded.
    const refused = await staff.get('/api/workspace/leads/export');
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'export_owner_only');
    assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'showroom_leads_export'").get().n, 0);
    // The owner can, and it is recorded with who and how many rows (no personal details).
    const mine = await owner.get('/api/workspace/leads/export');
    assert.equal(mine.status, 200);
    assert.equal(mine.body.rows, 3);
    assert.ok(mine.body.content.includes('b@example.com'));
    // The owner allows staff (owner-only setting); staff can't allow themselves.
    assert.notEqual((await staff.patch('/api/workspace/showroom', { settings: { staffLeadExport: true } })).status, 200);
    assert.equal((await owner.patch('/api/workspace/showroom', { settings: { staffLeadExport: true } })).body.tenant.settings.staffLeadExport, true);
    const theirs = await staff.get('/api/workspace/leads/export');
    assert.equal(theirs.status, 200);
    // Recent exports, newest first, for owners only.
    const list = await owner.get('/api/workspace/leads/exports');
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body.exports.map((e) => ({ by: e.by, role: e.role, rows: e.rows })),
      [
        { by: staff.user.email, role: 'staff', rows: 3 },
        { by: owner.user.email, role: 'owner', rows: 3 },
      ],
    );
    assert.equal((await staff.get('/api/workspace/leads/exports')).status, 403);
    const audits = t.db.prepare("SELECT detail FROM admin_audit WHERE action = 'showroom_leads_export'").all();
    for (const a of audits) assert.ok(!a.detail.includes('@'), 'counts, never the people');
    // Another showroom's exports are not listed here.
    const B = t.tenant({ name: 'Bravo', slug: 'exp-b' });
    const bOwner = await t.showroomUser(B, { role: 'owner' });
    await bOwner.get('/api/workspace/leads/export');
    assert.equal((await owner.get('/api/workspace/leads/exports')).body.exports.length, 2);
    // A daily limit per person.
    for (let i = 0; i < 8; i++) assert.equal((await staff.get('/api/workspace/leads/export')).status, 200);
    assert.equal((await staff.get('/api/workspace/leads/export')).status, 429);
  } finally {
    await t.close();
  }
});
