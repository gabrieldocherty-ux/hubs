import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkStart, EMPTY_START, startBody, startConsentText, startServerErrors } from '../visitor';
import { checkLead, EMPTY_LEAD } from '../send';

test('the "Before you start" consent sentence is the one the server stores with the lead', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'server/tenancy/leads.mjs'), 'utf8');
  const m = src.match(/export const startConsentText = \(company\) => `([^`]+)`/);
  assert.ok(m, 'server startConsentText not found');
  assert.equal(startConsentText('Northline'), m[1].replace('${company}', 'Northline'));
  assert.equal(startConsentText('Northline'), 'Northline may contact me about my design.');
});

test('checkStart: a name, an email or a phone (one is enough), and the box', () => {
  const ok = { ...EMPTY_START, name: 'Riley', consent: true };
  assert.deepEqual(checkStart({ ...ok, email: 'riley@example.test' }, 'N'), {});
  assert.deepEqual(checkStart({ ...ok, phone: '905 555 0142' }, 'N'), {});
  assert.deepEqual(Object.keys(checkStart(ok, 'Northline')), ['contact']);
  assert.match(checkStart(ok, 'Northline').contact!, /email or a phone number so Northline/);
  assert.deepEqual(Object.keys(checkStart({ ...EMPTY_START, email: 'nope', phone: '12' }, 'N')).sort(), ['consent', 'email', 'name', 'phone']);
  assert.equal(checkStart({ ...ok, email: 'a@b.co' }, 'Northline').consent, undefined);
  assert.equal(checkStart({ ...ok, email: 'a@b.co', consent: false }, 'Northline').consent, 'Tick the box so Northline can contact you.');
});

test('startBody trims like the server and carries the honeypot', () => {
  const b = startBody({ name: '  Riley   O ', email: ' Riley@Example.TEST ', phone: ' 905-555-0142 ', consent: true }, '');
  assert.deepEqual(b, { name: 'Riley O', email: 'riley@example.test', phone: '905-555-0142', consent: true, website: '' });
  assert.deepEqual(startServerErrors({ errors: [{ field: 'contact', message: 'x' }, { field: 'shareToken', message: 'y' }] }), { contact: 'x' });
});

test('Send this design takes a phone instead of an email too', () => {
  const ok = { ...EMPTY_LEAD, name: 'Riley', consent: true };
  assert.deepEqual(checkLead({ ...ok, phone: '(905) 555-0142' }, 'N'), {});
  assert.match(checkLead(ok, 'N').email!, /email or a phone number/);
});
