// Contractor sign-up (the 'account' package): the business name and phone are required on every
// save of the company profile, and the phone is normalised and checked like every phone here.
// A company saved before this rule (no phone) still loads, so the workspace can ask for it.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { readCompanyContact } from '../contractors/service.mjs';

let t;
before(async () => {
  t = await startTestServer({ env: { PAYMENTS: 'demo' } });
});
after(async () => {
  await t?.close();
});

async function onContractorPlan() {
  const a = await t.user();
  const c = await a.post('/api/billing/checkout', { kind: 'subscription', plan: 'contractor' });
  assert.equal(c.status, 200, c.text);
  assert.equal((await a.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' })).status, 200);
  return a;
}

const COMPANY = { company: 'Hollis Cabinet Co', email: 'hello@hollis.test', website: 'hollis.test', serviceArea: 'Hamilton', defaultMarkupPct: 30 };

test('readCompanyContact: both required, the name trimmed, the phone normalised', () => {
  assert.deepEqual(readCompanyContact({ company: '  Hollis Co ', phone: '905 555 0142' }), { company: 'Hollis Co', phone: '(905) 555-0142' });
  assert.deepEqual(readCompanyContact({ company: 'Hollis', phone: '+1 905-555-0142 x7' }), { company: 'Hollis', phone: '(905) 555-0142 ext. 7' });
  assert.deepEqual(readCompanyContact({ company: 'Hollis', phone: '+44 20 7946 0958' }), { company: 'Hollis', phone: '+442079460958' });
  const fieldOf = (body) => {
    try {
      readCompanyContact(body);
      return null;
    } catch (e) {
      assert.equal(e.status, 400);
      return e.details?.field ?? e.field ?? e.body?.field ?? 'unknown';
    }
  };
  for (const body of [{}, { company: '   ', phone: '905-555-0142' }, { company: 42, phone: '905-555-0142' }, null]) assert.ok(fieldOf(body), JSON.stringify(body));
  for (const phone of [undefined, '', '   ', '555-0100', '123-555-0142', 'call me', 9055550142]) assert.ok(fieldOf({ company: 'Hollis', phone }), String(phone));
});

test('setup: no company without a business name and a valid phone; the phone is stored normalised', async () => {
  const a = await onContractorPlan();
  const noName = await a.put('/api/pro/profile', { ...COMPANY, company: '', phone: '905-555-0142' });
  assert.equal(noName.status, 400);
  assert.equal(noName.body.field, 'company');
  const noPhone = await a.put('/api/pro/profile', COMPANY);
  assert.equal(noPhone.status, 400);
  assert.equal(noPhone.body.field, 'phone');
  assert.match(noPhone.body.error, /phone/i);
  const badPhone = await a.put('/api/pro/profile', { ...COMPANY, phone: '555-0100' });
  assert.equal(badPhone.status, 400);
  assert.equal(badPhone.body.field, 'phone');
  assert.match(badPhone.body.error, /area code/i);
  assert.equal((await a.get('/api/pro/profile')).body.profile, null, 'nothing was saved');

  const ok = await a.put('/api/pro/profile', { ...COMPANY, phone: '1 (905) 555.0142' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.profile.company, 'Hollis Cabinet Co');
  assert.equal(ok.body.profile.phone, '(905) 555-0142');
  assert.equal(t.db.prepare('SELECT phone FROM contractor_profiles WHERE user_id = ?').get(a.id).phone, '(905) 555-0142');

  // Every later save needs them too: the phone can't be cleared.
  const cleared = await a.put('/api/pro/profile', { ...COMPANY, phone: '' });
  assert.equal(cleared.status, 400);
  assert.equal(cleared.body.field, 'phone');
  assert.equal((await a.get('/api/pro/profile')).body.profile.phone, '(905) 555-0142');
});

test('a company saved before the rule (no phone) still loads, so the workspace can ask for it; saving it with one completes it', async () => {
  const a = await onContractorPlan();
  const now = Date.now();
  t.db
    .prepare('INSERT INTO contractor_profiles (user_id, company, logo_file_id, phone, email, website, service_area, default_markup_pct, tax_pct, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(a.id, 'Old Co', '', 'old@co.test', '', '', 25, 5, now, now);
  const got = await a.get('/api/pro/profile');
  assert.equal(got.status, 200);
  assert.equal(got.body.profile.company, 'Old Co');
  assert.equal(got.body.profile.phone, '');
  const fixed = await a.put('/api/pro/profile', { company: 'Old Co', phone: '416-555-0199', email: 'old@co.test', defaultMarkupPct: 25, taxPct: 5 });
  assert.equal(fixed.status, 200, fixed.text);
  assert.equal(fixed.body.profile.phone, '(416) 555-0199');
  assert.equal(fixed.body.profile.defaultMarkupPct, 25, 'the rest of the company is kept');
});

test('a person not on the Contractor plan still cannot save a company, phone or not', async () => {
  const a = await t.user();
  assert.equal((await a.put('/api/pro/profile', { ...COMPANY, phone: '905-555-0142' })).status, 403);
});
