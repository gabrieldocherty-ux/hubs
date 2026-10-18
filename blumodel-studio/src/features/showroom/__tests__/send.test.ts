import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkLead, consentText, EMPTY_LEAD, isDownloadToast, leadBody, rememberSent, sentAt, serverErrors } from '../send';

const ok = { ...EMPTY_LEAD, name: 'Riley Chen', email: 'Riley@Example.test', consent: true };

test('the consent sentence is the one the server stores with the lead', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server/tenancy/leads.mjs'), 'utf8');
  const m = src.match(/export const consentText = \(company\) => `([^`]+)`/);
  assert.ok(m, 'server consentText not found');
  assert.equal(consentText('Northline'), m[1].replace('${company}', 'Northline'));
});

test('checkLead: the server’s rules, on the field, before anything is sent', () => {
  assert.deepEqual(checkLead(ok, 'Northline'), {});
  const e = checkLead({ ...EMPTY_LEAD, email: 'not-an-email', phone: '12', postalCode: '!!' }, 'Northline');
  assert.deepEqual(Object.keys(e).sort(), ['consent', 'email', 'name', 'phone', 'postalCode']);
  assert.equal(e.consent, 'Tick the box so Northline can contact you.');
  assert.ok(checkLead({ ...ok, email: 'a@b.co,c@d.co' }, 'N').email, 'a list of addresses is refused');
  assert.deepEqual(checkLead({ ...ok, phone: '(519) 555-0142 x 12', postalCode: 'n2l 3g1' }, 'N'), {});
});

test('leadBody trims like the server, sends the design and an empty honeypot', () => {
  const b = leadBody({ ...ok, name: '  Riley   Chen ', postalCode: 'n2l 3g1', notes: ' Hi\r\nthere ' }, { projectId: 'k1' });
  assert.equal(b.name, 'Riley Chen');
  assert.equal(b.email, 'riley@example.test');
  assert.equal(b.postalCode, 'N2L 3G1');
  assert.equal(b.notes, 'Hi\nthere');
  assert.equal(b.consent, true);
  assert.equal((b as { projectId?: string }).projectId, 'k1');
  assert.equal(b.website, '');
  const s = leadBody(ok, { shareToken: 't'.repeat(32) });
  assert.equal((s as { shareToken?: string }).shareToken, 't'.repeat(32));
  assert.equal('projectId' in s, false);
});

test('serverErrors keeps the server’s messages for this form’s fields only', () => {
  assert.deepEqual(serverErrors({ errors: [{ field: 'email', message: 'Bad' }, { field: 'shareToken', message: 'x' }, { nope: 1 }] }), { email: 'Bad' });
  assert.deepEqual(serverErrors(null), {});
});

test('a download toast brings the Send card; other toasts do not', () => {
  assert.equal(isDownloadToast('Floor plan saved as PNG.', 'ok'), true);
  assert.equal(isDownloadToast('Shopping list saved as CSV.', 'ok'), true);
  assert.equal(isDownloadToast('Product list saved. Open it to print or save as PDF.', 'ok'), true);
  assert.equal(isDownloadToast('Studio render saved: 1920 × 1080 PNG.', 'ok'), true);
  assert.equal(isDownloadToast('Floor plan saved as PNG.', 'warn'), false);
  assert.equal(isDownloadToast('Opened “Kitchen”.', 'ok'), false);
});

test('sent designs are remembered on this device', () => {
  assert.equal(sentAt('k:x'), null);
  rememberSent('k:x', 1000);
  assert.equal(sentAt('k:x'), 1000);
});
