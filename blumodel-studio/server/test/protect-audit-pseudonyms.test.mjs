// The audit log keeps what happened, not to whom (audit 2026-10: "the audit log keeps deleted users'
// emails forever"): deleting an account or a lead turns its emails and phones in admin_audit into a
// pseudonym; ids, actions and times stay.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, startTestServer } from './helpers.mjs';
import { pseudonymOf, pseudonymiseAudit } from '../lib/audit.mjs';

const rows = (t) => t.db.prepare('SELECT * FROM admin_audit ORDER BY id').all();

test('deleting an account pseudonymises its email and phone everywhere in the audit log', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const ann = await t.user({ email: 'ann.gone@test.blumodel', password: 'ann password 123' });
    t.db.prepare("UPDATE users SET phone = '(905) 555-0142' WHERE id = ?").run(ann.id);
    // Entries that name her: a reset link (target), a comp plan, and one that mentions her in detail.
    assert.equal((await admin.post(`/api/admin/users/${ann.id}/reset-link`)).status, 200);
    t.db.prepare("INSERT INTO admin_audit (at, admin_user_id, admin_email, action, target_user_id, target_email, detail) VALUES (1, NULL, '', 'note', NULL, '', ?)").run(JSON.stringify({ email: 'Ann.Gone@test.blumodel', phone: '(905) 555-0142', other: 'bob@test.blumodel' }));
    const before = rows(t).length;
    // The reproduced finding: her email stays in the log after she is gone. Now it doesn't.
    assert.equal((await ann.post('/api/account/delete', { password: 'ann password 123' })).status, 204);
    const all = rows(t);
    assert.equal(all.length, before, 'nothing is removed from the log');
    const text = JSON.stringify(all);
    assert.ok(!text.toLowerCase().includes('ann.gone@test.blumodel'));
    assert.ok(!text.includes('555-0142'));
    assert.ok(text.includes('bob@test.blumodel'), 'other people are untouched');
    const p = pseudonymOf('ann.gone@test.blumodel');
    const reset = all.find((r) => r.action === 'reset_link');
    assert.equal(reset.target_email, p);
    assert.equal(reset.target_user_id, ann.id, 'ids and actions stay');
    assert.ok(all.find((r) => r.action === 'note').detail.includes(p));
    assert.equal(pseudonymOf('ANN.GONE@test.blumodel '), p, 'the same pseudonym for the same address');
  } finally {
    await t.close();
  }
});

test('an admin deleting an account records it about a pseudonym; deleting a lead pseudonymises what that person typed', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const eve = await t.user({ email: 'eve.gone@test.blumodel' });
    assert.equal((await admin.post(`/api/admin/users/${eve.id}/delete`, { confirm: 'eve.gone@test.blumodel' })).status, 200);
    const del = rows(t).find((r) => r.action === 'account_delete');
    assert.equal(del.target_email, pseudonymOf('eve.gone@test.blumodel'));
    assert.ok(!del.detail.includes('eve'));

    const A = t.tenant({ slug: 'pseudo-a' });
    const owner = await t.showroomUser(A, { role: 'owner' });
    await new Agent(t.url, { host: A.host }).post('/api/visitor', { name: 'Lee', email: 'lee@example.com', phone: '416 555 0199', consent: true, website: '' });
    t.db.prepare("INSERT INTO admin_audit (at, admin_user_id, admin_email, action, target_user_id, target_email, detail) VALUES (1, NULL, '', 'note', NULL, 'lee@example.com', ?)").run(JSON.stringify({ phone: '(416) 555-0199' }));
    const lead = (await owner.get('/api/workspace/leads')).body.leads[0];
    assert.equal((await owner.delete(`/api/workspace/leads/${lead.id}`)).status, 200);
    const text = JSON.stringify(rows(t));
    assert.ok(!text.includes('lee@example.com') && !text.includes('555-0199'));
    assert.equal(pseudonymiseAudit(t.db, { emails: ['x'] }), 0, 'too short to be an address: nothing replaced');
  } finally {
    await t.close();
  }
});
