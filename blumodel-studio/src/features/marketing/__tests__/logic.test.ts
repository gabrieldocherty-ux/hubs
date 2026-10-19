import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSalesLead, demoShowroomUrl } from '../logic';

const loc = (href: string) => {
  const u = new URL(href);
  return { protocol: u.protocol, hostname: u.hostname, port: u.port };
};

test('the demo showroom link: demo.<base domain>, keeping scheme and port only on the same machine or domain', () => {
  assert.equal(demoShowroomUrl('blumodel.studio', loc('https://blumodel.studio/')), 'https://demo.blumodel.studio');
  assert.equal(demoShowroomUrl('blumodel.studio', loc('https://www.blumodel.studio/#/pricing')), 'https://demo.blumodel.studio');
  // QA and dev: the sales site at 127.0.0.1 or localhost, BASE_DOMAIN=localhost.
  assert.equal(demoShowroomUrl('localhost', loc('http://127.0.0.1:8925/?qa=1#/')), 'http://demo.localhost:8925');
  assert.equal(demoShowroomUrl('localhost', loc('http://localhost:5173/')), 'http://demo.localhost:5173');
  // The Wyse on the LAN, opened by IP: the public demo, never http:// or the LAN port.
  assert.equal(demoShowroomUrl('blumodel.studio', loc('http://192.168.1.40:8787/')), 'https://demo.blumodel.studio');
  // Before /api/config answers: from the page's own host.
  assert.equal(demoShowroomUrl(null, loc('https://www.blumodel.studio/')), 'https://demo.blumodel.studio');
  assert.equal(demoShowroomUrl(null, loc('http://localhost:8080/')), 'http://demo.localhost:8080');
  assert.equal(demoShowroomUrl(null, loc('http://10.0.0.5:8787/')), 'https://demo.blumodel.studio');
  // A base domain that isn't a host name is ignored.
  assert.equal(demoShowroomUrl('evil.example/x?', loc('https://blumodel.studio/')), 'https://demo.blumodel.studio');
});

test('Book a call checks company, name and email, and the phone only when given', () => {
  const ok = { company: 'Acme Kitchens', name: 'Robin', phone: '', email: 'robin@acme.ca', city: '', message: '' };
  assert.deepEqual(checkSalesLead(ok), {});
  assert.deepEqual(Object.keys(checkSalesLead({ ...ok, company: ' ', name: '', email: 'nope' })).sort(), ['company', 'email', 'name']);
  assert.ok(checkSalesLead({ ...ok, phone: 'call me' }).phone);
  assert.deepEqual(checkSalesLead({ ...ok, phone: '(519) 555-0199 x12' }), {});
});
