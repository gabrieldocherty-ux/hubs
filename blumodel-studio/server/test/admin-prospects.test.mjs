// Admin > Prospects: the outreach spreadsheet imported, searched alongside the Book a call leads,
// re-imported without duplicates or losing what was set in the panel, edited, exported, deleted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { outreachStage, prospectKey, readProspectCsv } from '../routes/adminProspects.mjs';

const CSV = `﻿Name,City,Province,Type,Phone,Website,Address,Showroom,Size signals,Lines,Contact name,Contact role,Email,Fit,Pitch angle,Verified,Source,Status,Notes
Bjornson Designs,Airdrie,AB,custom cabinet maker,,https://bjornsondesigns.ca/,"124 - 292188 Wagon Wheel Blvd, Rocky View County",Yes,,,Rene Bjornson,Owner,,4,"Showroom, doors and finishes",TRUE,,,
Layne Kitchens,Airdrie,AB,custom cabinet maker,+1-403-945-9421,https://laynekitchens.com/,,Unknown,,,,,info@laynekitchens.com,3,Design team,TRUE,,Emailed 2026-10-19 01:51 (drip),
Gone Co,Guelph,ON,,519-555-0100,,,,,,,,bad@gone.test,2,,,,Bounced 2026-10-19 (address does not exist) - do not retry,
,Nowhere,ON,,,,,,,,,,,,,,,,
`;

test('the spreadsheet reader: headers by name, stages from the Status text, keys that survive a re-import', () => {
  const { rows, skipped } = readProspectCsv(CSV);
  assert.equal(rows.length, 3);
  assert.equal(skipped, 1, 'a row with no company name');
  assert.equal(rows[0].company, 'Bjornson Designs');
  assert.equal(rows[0].contact_name, 'Rene Bjornson');
  assert.equal(rows[0].fit, 4);
  assert.equal(rows[0].address, '124 - 292188 Wagon Wheel Blvd, Rocky View County');
  assert.deepEqual(outreachStage('Emailed 2026-10-19 01:51 (drip)'), { stage: 'emailed', at: new Date(2026, 9, 19, 1, 51).getTime() });
  assert.equal(outreachStage('Bounced 2026-10-19 (bad address) - do not retry').stage, 'bounced');
  assert.equal(outreachStage('').stage, 'new');
  assert.equal(prospectKey({ email: 'Info@Layne.com', website: 'x.ca' }), 'e:info@layne.com');
  assert.equal(prospectKey({ email: '', website: 'https://www.Layne.com/contact' }), 'w:layne.com');
  assert.equal(prospectKey({ company: 'A Co', city: 'Guelph' }), 'c:a co|guelph');
  assert.throws(() => readProspectCsv('City,Phone\nGuelph,1'), /Name \(or Company\) column/);
});

test('import, search with the Book a call leads, re-import, edit, export, delete', async () => {
  const t = await startTestServer();
  try {
    const customer = await t.user();
    assert.equal((await customer.get('/api/admin/prospects')).status, 403);
    assert.equal((await t.agent().get('/api/admin/prospects')).status, 401);
    const admin = await t.user({ role: 'admin' });

    const imp = await admin.post('/api/admin/prospects/import', { csv: CSV });
    assert.equal(imp.status, 200, imp.text);
    assert.deepEqual(imp.body, { added: 3, updated: 0, unchanged: 0, skipped: 1, total: 3 });

    const all = (await admin.get('/api/admin/prospects')).body;
    assert.equal(all.total, 3);
    assert.equal(all.counts.total, 3);
    assert.equal(all.counts.emailed, 1);
    assert.equal(all.counts.bounced, 1);
    assert.equal(all.counts.new, 1);
    assert.deepEqual(all.prospects.map((p) => p.company), ['Gone Co', 'Layne Kitchens', 'Bjornson Designs'], 'most recently emailed first (a date alone counts as noon), never-emailed last');
    assert.deepEqual(all.provinces, [{ province: 'AB', n: 2 }, { province: 'ON', n: 1 }]);
    assert.ok(all.importedAt);

    // One search box: the list and the Book a call requests.
    assert.equal((await t.agent().post('/api/sales-leads', { company: 'Layne Kitchens', name: 'Sam', email: 'sam@laynekitchens.com', phone: '', website: '' })).status, 201);
    const s = (await admin.get('/api/admin/prospects?q=layne')).body;
    assert.deepEqual(s.prospects.map((p) => p.company), ['Layne Kitchens']);
    assert.deepEqual(s.salesLeads.map((l) => l.email), ['sam@laynekitchens.com']);
    assert.equal((await admin.get('/api/admin/prospects?q=100%25')).body.total, 0, '% is literal');
    assert.equal((await admin.get('/api/admin/prospects?province=AB&stage=new')).body.prospects[0].company, 'Bjornson Designs');
    assert.equal((await admin.get('/api/admin/prospects?stage=nope')).status, 400);
    assert.deepEqual((await admin.get('/api/admin/prospects?sort=fit')).body.prospects.map((p) => p.fit), [4, 3, 2]);

    // Set in the panel, then a re-import with the drip having emailed Bjornson: no duplicates, the
    // manual stage and notes stay, the automatic stage moves, a blank cell keeps the old value.
    const layne = s.prospects[0];
    const upd = await admin.patch(`/api/admin/prospects/${layne.id}`, { stage: 'demo', adminNotes: 'Demo Thursday' });
    assert.equal(upd.status, 200, upd.text);
    assert.equal(upd.body.prospect.stage, 'demo');
    const again = CSV.replace('Owner,,4', 'Owner,,4').replace('TRUE,,,\n', 'TRUE,,Emailed 2026-10-20 09:00 (drip),\n').replace('+1-403-945-9421', '');
    const re = (await admin.post('/api/admin/prospects/import', { csv: again })).body;
    assert.deepEqual([re.added, re.updated, re.unchanged, re.total], [0, 1, 2, 3], 'Layne: a blank phone keeps the old one, so nothing changed');
    const after = (await admin.get('/api/admin/prospects?sort=company')).body.prospects;
    const by = Object.fromEntries(after.map((p) => [p.company, p]));
    assert.equal(by['Bjornson Designs'].stage, 'emailed');
    assert.equal(by['Layne Kitchens'].stage, 'demo');
    assert.equal(by['Layne Kitchens'].adminNotes, 'Demo Thursday');
    assert.equal(by['Layne Kitchens'].phone, '+1-403-945-9421');

    // Added by hand; a duplicate is refused.
    const add = await admin.post('/api/admin/prospects', { company: 'Guelph Cabinet Works', city: 'Guelph', province: 'ON', email: 'pat@gcw.ca', fit: 5 });
    assert.equal(add.status, 201, add.text);
    assert.equal(add.body.prospect.stage, 'new');
    assert.equal((await admin.post('/api/admin/prospects', { company: 'GCW again', email: 'PAT@gcw.ca' })).status, 409);
    assert.equal((await admin.post('/api/admin/prospects', { company: '' })).status, 400);

    const exp = (await admin.get('/api/admin/prospects/export')).body;
    assert.match(exp.filename, /^blumodel-prospects-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.equal(exp.content.split('\n').length, 5);
    assert.match(exp.content, /Demo Thursday/);

    admin.keepFresh = false;
    t.db.prepare('UPDATE sessions SET auth_at = 0 WHERE user_id = ?').run(admin.id);
    assert.equal((await admin.delete(`/api/admin/prospects/${layne.id}`)).body.code, 'reauth_required');
    admin.keepFresh = true;
    assert.equal((await admin.delete(`/api/admin/prospects/${layne.id}`)).status, 200);
    assert.equal((await admin.get('/api/admin/prospects')).body.total, 3);
    const acts = t.db.prepare("SELECT action FROM admin_audit WHERE action LIKE 'prospect%' ORDER BY id").all().map((r) => r.action);
    assert.deepEqual(acts, ['prospects_import', 'prospect_update', 'prospects_import', 'prospect_add', 'prospects_export', 'prospect_delete']);
  } finally {
    await t.close();
  }
});
