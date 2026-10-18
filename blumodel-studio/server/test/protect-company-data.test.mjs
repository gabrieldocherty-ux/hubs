// A company that leaves (audit 2026-10: "there is no way to export or delete a company's data").
// Admin > Companies > Export all data (a zip, streamed, admin-only, re-authenticated, audited) and
// Delete company (typed confirmation; everything of the showroom goes, billing kept anonymised).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Agent, sampleDoc, startTestServer } from './helpers.mjs';
import { makePng } from '../lib/synth.mjs';
import { readZip } from '../lib/zip.mjs';
import { createZipWriter } from '../lib/zip.mjs';

/** A showroom with people, a lead with a sent design, a product with a picture, a logo, credits and a receipt. */
async function company(t, slug, who) {
  const tn = t.tenant({ name: `${slug} Kitchens`, slug });
  const owner = await t.showroomUser(tn, { role: 'owner', email: `owner@${slug}.test` });
  const pic = await owner.putRaw('/api/files?kind=image&visibility=public&name=door.png', makePng({ w: 8, h: 8, rgba: () => [slug.length * 20, 10, 10, 255] }), 'image/png');
  assert.equal(pic.status, 201, pic.text);
  const prod = await owner.post('/api/workspace/products', { spec: { kind: 'range', variant: 'gas-4', category: 'appliances', name: `${slug} Range`, sku: 'R1', widthIn: 30, depthIn: 28, heightIn: 36, elevationIn: 0, price: 999, finishes: [{ id: 's', name: 'Steel', hex: '#cccccc', material: 'metal' }], imageFileIds: [pic.body.file.id] } });
  assert.equal(prod.status, 201, prod.text);
  const v = new Agent(t.url, { host: tn.host });
  await v.post('/api/visitor', { name: who, email: `${who.toLowerCase()}@example.com`, phone: '416 555 0123', consent: true, website: '' });
  const k = (await v.post('/api/projects', { name: `${who}'s kitchen`, doc: sampleDoc() })).body.project;
  assert.equal((await v.post('/api/leads', { name: who, email: `${who.toLowerCase()}@example.com`, consent: true, projectId: k.id, website: '' })).status, 201);
  t.services.showroomBilling.monthPaid(tn.id, { invoiceRef: `in_${slug}`, amountCents: 5000, provider: 'stripe' });
  return { tn, owner, file: t.db.prepare('SELECT * FROM files WHERE id = ?').get(pic.body.file.id), visitor: v };
}

test('the zip writer: entries read back byte for byte, deflated or stored, with safe names', async () => {
  const chunks = [];
  const out = { write: (c) => (chunks.push(Buffer.from(c)), true), end() {} };
  const zip = createZipWriter(out, { now: Date.UTC(2026, 9, 18) });
  await zip.add('a.json', Buffer.from('{"x":1}'.repeat(100)));
  await zip.add('../../etc/b.bin', Buffer.from([1, 2, 3]), { store: true });
  await zip.add('a.json', Buffer.from('second'));
  const r = await zip.finish();
  assert.equal(r.entries, 3);
  const back = readZip(Buffer.concat(chunks));
  assert.deepEqual(back.map((e) => e.name), ['a.json', 'etc/b.bin', 'a-2.json']);
  assert.equal(back[0].data.toString(), '{"x":1}'.repeat(100));
  assert.deepEqual([...back[1].data], [1, 2, 3]);
});

test('Export all data: a re-authenticated, one-use, audited zip with everything of that showroom and nothing of another', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const A = await company(t, 'alder', 'Riley');
    await company(t, 'birch', 'Morgan');
    // Not for showroom owners or anyone else.
    assert.equal((await A.owner.post(`/api/admin/tenants/${A.tn.id}/export`)).status, 404);
    const link = await admin.post(`/api/admin/tenants/${A.tn.id}/export`);
    assert.equal(link.status, 200, link.text);
    assert.equal(link.body.counts.leads, 1);
    const res = await admin.get(link.body.url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/zip');
    assert.match(res.headers.get('content-disposition'), /attachment; filename="alder-data-\d{4}-\d{2}-\d{2}\.zip"/);
    const entries = readZip(res.buffer);
    const names = entries.map((e) => e.name);
    for (const n of ['README.txt', 'tenant.json', 'team.json', 'products.json', 'designs.json', 'leads.json', 'leads.csv', 'billing.json', 'credits.json', 'renders.json', 'files.json', `uploads/${A.file.id}.png`]) assert.ok(names.includes(n), n);
    const all = entries.map((e) => e.data.toString('latin1')).join('\n');
    assert.ok(all.includes('riley@example.com'));
    assert.ok(all.includes("Riley's kitchen"));
    assert.ok(all.includes('in_alder'));
    assert.ok(!all.includes('morgan@example.com') && !all.includes('birch'), 'nothing of the other showroom');
    const png = entries.find((e) => e.name === `uploads/${A.file.id}.png`).data;
    assert.deepEqual(png, fs.readFileSync(t.services.files.blobPath(A.file.sha256, A.file.ext)));
    // The link works once, for that admin.
    assert.equal((await admin.get(link.body.url)).status, 403);
    assert.equal((await admin.get(`/api/admin/tenants/${A.tn.id}/export`)).status, 403);
    const other = await t.user({ role: 'admin' });
    const l2 = await admin.post(`/api/admin/tenants/${A.tn.id}/export`);
    assert.equal((await other.get(l2.body.url)).status, 403);
    const audits = t.db.prepare("SELECT * FROM admin_audit WHERE action = 'tenant_export'").all();
    assert.equal(audits.length, 1);
    assert.equal(audits[0].admin_email, admin.user.email);
    // Re-authentication: after 10 minutes, the link isn't made.
    admin.keepFresh = false;
    t.db.prepare('UPDATE sessions SET auth_at = 0 WHERE user_id = ?').run(admin.id);
    assert.equal((await admin.post(`/api/admin/tenants/${A.tn.id}/export`)).body.code, 'reauth_required');
  } finally {
    await t.close();
  }
});

test('Delete company: typed confirmation; the showroom, its people, leads, designs, products and uploads go; billing is kept without names; the other showroom is untouched', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const A = await company(t, 'cedar', 'Riley');
    const B = await company(t, 'douglas', 'Morgan');
    // A BluModel (sales-site) account on Cedar's team keeps its own account.
    const pro = await t.user({ email: 'pro@cedar.test' });
    t.services.tenants.addMember(A.tn.id, pro.id, 'staff');
    const blob = t.services.files.blobPath(A.file.sha256, A.file.ext);
    assert.ok(fs.existsSync(blob));
    t.db.prepare("INSERT INTO admin_audit (at, admin_user_id, admin_email, action, target_user_id, target_email, detail) VALUES (1, NULL, '', 'note', NULL, 'owner@cedar.test', '{}')").run();

    assert.equal((await admin.post(`/api/admin/tenants/${A.tn.id}/delete`, { confirm: 'douglas' })).status, 400);
    assert.equal((await admin.post(`/api/admin/tenants/t_nope/delete`, { confirm: 'x' })).status, 404);
    const del = await admin.post(`/api/admin/tenants/${A.tn.id}/delete`, { confirm: 'CEDAR' });
    assert.equal(del.status, 200, del.text);
    assert.equal(del.body.counts.leads, 1);
    assert.equal(del.body.counts.billingKept, 2, 'the receipt and the license');
    assert.equal(del.body.counts.blobsRemoved, 1);

    const n = (sql, ...a) => t.db.prepare(sql).get(...a).n;
    assert.equal(n('SELECT COUNT(*) AS n FROM tenants WHERE id = ?', A.tn.id), 0);
    for (const table of ['users', 'projects', 'products', 'files', 'tenant_leads', 'tenant_lead_visitors', 'showroom_leads', 'tenant_members', 'tenant_hostnames', 'tenant_payments', 'tenant_licenses', 'tenant_credit_lots', 'sessions']) {
      assert.equal(n(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?`, A.tn.id), 0, table);
    }
    assert.ok(!fs.existsSync(blob), 'the upload is gone from disk');
    assert.equal((await new Agent(t.url, { host: A.tn.host }).get('/api/showroom')).status, 404, 'the address answers nothing');
    assert.equal((await A.owner.get('/api/auth/me')).status, 404);
    assert.ok(t.db.prepare('SELECT 1 FROM users WHERE id = ?').get(pro.id), 'a sales-site account only loses the membership');
    // Billing kept for the tax records, anonymised.
    const kept = t.db.prepare('SELECT * FROM deleted_tenant_billing WHERE tenant_id = ?').all(A.tn.id);
    assert.ok(kept.some((r) => r.ref === 'in_cedar' && r.amount_cents === 5000));
    assert.ok(kept.some((r) => r.kind === 'license'));
    assert.ok(!JSON.stringify(kept).includes('@'));
    // Audited with counts; the company's people pseudonymised in the log.
    const a = t.db.prepare("SELECT * FROM admin_audit WHERE action = 'tenant_delete'").get();
    assert.equal(JSON.parse(a.detail).slug, 'cedar');
    const log = JSON.stringify(t.db.prepare('SELECT * FROM admin_audit').all());
    assert.ok(!log.includes('owner@cedar.test') && !log.includes('riley@example.com'));
    // Douglas is untouched.
    assert.equal((await B.owner.get('/api/workspace/leads')).body.leads.length, 1);
    assert.equal(n('SELECT COUNT(*) AS n FROM products WHERE tenant_id = ?', B.tn.id), 1);
    assert.ok(fs.existsSync(t.services.files.blobPath(B.file.sha256, B.file.ext)));
    // The demo showroom can't be deleted this way.
    t.db.prepare('UPDATE tenants SET is_demo = 1 WHERE id = ?').run(B.tn.id);
    assert.equal((await admin.post(`/api/admin/tenants/${B.tn.id}/delete`, { confirm: 'douglas' })).body.code, 'demo_tenant');
  } finally {
    await t.close();
  }
});
