// A visitor who sends a design gets a receipt with the link back to it; the company gets its notice.
// Nothing the visitor typed (notes, budget) goes into either message.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, sampleDoc, startTestServer } from './helpers.mjs';

test('sending a design emails the company a notice and the visitor a receipt with their design link', async () => {
  const sent = [];
  const fetch = async (url, init = {}) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'email_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const t = await startTestServer({ env: { RESEND_API_KEY: 're_FAKE_FOR_TESTS', EMAIL_FROM: 'BluModel Studio <hello@blumodel.example>' }, fetch });
  try {
    const A = t.tenant({ name: 'Alpha Kitchens', slug: 'rcpt-a' });
    await t.showroomUser(A, { role: 'owner' });
    const v = new Agent(t.url, { host: A.host });
    await v.post('/api/visitor', { name: 'Riley Okafor', email: 'riley@example.com', phone: '', consent: true, website: '' });
    const k = await v.post('/api/projects', { name: 'Riley’s kitchen', doc: sampleDoc() });
    assert.equal(k.status, 201, k.text);
    const r = await v.post('/api/leads', { name: 'Riley Okafor', email: 'riley@example.com', phone: '', postalCode: 'n1h 3a1', budget: 'Not sure yet', notes: 'SECRET NOTE', consent: true, projectId: k.body.project.id, website: '' });
    assert.equal(r.status, 201, r.text);
    await new Promise((res) => setTimeout(res, 30));
    const receipt = sent.find((m) => m.body.to?.includes('riley@example.com'));
    assert.ok(receipt, `no receipt among ${sent.map((m) => m.body.to).join(', ')}`);
    assert.match(receipt.body.subject, /Alpha Kitchens has your design/);
    assert.match(receipt.body.text, /#\/s\/[A-Za-z0-9_-]+/);
    assert.doesNotMatch(receipt.body.text, /SECRET NOTE|Not sure yet/);
    const notice = sent.find((m) => /New design request/.test(m.body.subject));
    assert.ok(notice, 'the company notice');
    assert.doesNotMatch(notice.body.text, /SECRET NOTE/);
  } finally {
    await t.close();
  }
});
