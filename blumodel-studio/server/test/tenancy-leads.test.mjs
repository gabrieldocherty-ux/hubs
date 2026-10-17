// Leads (docs/SHOWROOM_PIVOT.md §5, §6): "Send this design to <Company>" on a showroom, the team's
// inbox (status, notes, CSV), isolation between showrooms, and the sales site's "Book a call".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, sampleDoc, startTestServer } from './helpers.mjs';

const lead = (over = {}) => ({ name: 'Riley Homeowner', email: 'Riley@Example.com', phone: '519-555-0142', postalCode: 'n1h 3a1', budget: '$25k-$40k', timeline: 'This spring', notes: 'Island with seating for 4', consent: true, ...over });

test('a visitor sends a design: a view-only link for the staff, the details, consent; the inbox, status, notes, CSV', async () => {
  const t = await startTestServer();
  try {
    const A = t.tenant({ name: 'Alpha Kitchens', slug: 'lead-a' });
    const owner = await t.showroomUser(A, { role: 'owner' });
    const visitor = await t.showroomUser(A);
    const k = (await visitor.post('/api/projects', { name: 'Our new kitchen', doc: sampleDoc() })).body.project;

    // Validation, consent required.
    const bad = await visitor.post('/api/leads', lead({ email: 'nope', consent: false }));
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.errors.map((e) => e.field).sort(), ['consent', 'email']);
    // Someone else's kitchen can't be sent.
    const other = await t.showroomUser(A);
    assert.equal((await other.post('/api/leads', lead({ projectId: k.id }))).status, 404);

    const sent = await visitor.post('/api/leads', lead({ projectId: k.id }));
    assert.equal(sent.status, 201, sent.text);
    assert.match(sent.body.id, /^ld_/);
    // Signed out, with a link they already have.
    const share = (await visitor.post(`/api/projects/${k.id}/shares`, {})).body.share.token;
    const anon = new Agent(t.url, { host: A.host });
    assert.equal((await anon.post('/api/leads', lead({ name: 'Sam', email: 'sam@example.com', shareToken: share, projectId: undefined }))).status, 201);
    assert.equal((await anon.post('/api/leads', lead({ shareToken: 'x'.repeat(32) }))).status, 404);
    // No CSRF header: refused.
    assert.equal((await anon.request('POST', '/api/leads', { body: lead(), csrf: false })).status, 403);

    // The inbox.
    assert.equal((await visitor.get('/api/workspace/leads')).status, 403);
    const inbox = (await owner.get('/api/workspace/leads')).body;
    assert.equal(inbox.leads.length, 2);
    assert.deepEqual(inbox.counts, { new: 2, contacted: 0, quoted: 0, won: 0, lost: 0, total: 2, unread: 2 });
    const l = inbox.leads.find((x) => x.name === 'Riley Homeowner');
    assert.equal(l.email, 'riley@example.com');
    assert.equal(l.postalCode, 'N1H 3A1');
    assert.equal(l.consent, true);
    assert.match(l.consentText, /^I agree that Alpha Kitchens may contact me/);
    assert.equal(l.signedIn, true);
    assert.equal(l.design.name, 'Our new kitchen');
    assert.match(l.design.url, new RegExp(`^http://lead-a\\.localhost:${t.port}/#/s/[A-Za-z0-9_-]{32}$`));
    // The staff can open the design through that link (on this showroom).
    assert.equal((await owner.get(`/api/share/${l.design.shareToken}`)).status, 200);

    const opened = await owner.get(`/api/workspace/leads/${l.id}`);
    assert.equal(opened.body.lead.read, true);
    const upd = await owner.patch(`/api/workspace/leads/${l.id}`, { status: 'quoted', staffNotes: 'Sent quote #1042' });
    assert.equal(upd.body.lead.status, 'quoted');
    assert.equal(upd.body.lead.staffNotes, 'Sent quote #1042');
    assert.equal((await owner.patch(`/api/workspace/leads/${l.id}`, { status: 'maybe' })).status, 400);
    assert.deepEqual((await owner.get('/api/workspace/leads?status=quoted')).body.leads.map((x) => x.id), [l.id]);
    assert.deepEqual((await owner.get('/api/workspace/leads?q=sam')).body.leads.map((x) => x.name), ['Sam']);
    assert.equal((await owner.get('/api/workspace/leads?status=bogus')).status, 400);

    const csv = (await owner.get('/api/workspace/leads/export')).body;
    assert.equal(csv.contentType, 'text/csv');
    assert.match(csv.filename, /^lead-a-leads-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = csv.content.split('\n');
    assert.equal(lines[0], 'Received,Status,Name,Email,Phone,Postal code,Budget,Timeline,Notes,Design,Design link,Staff notes');
    assert.equal(lines.length, 3);
    assert.ok(lines.some((x) => x.includes('quoted') && x.includes('Sent quote #1042')));

    // A formula in a field never becomes a formula in the CSV.
    await anon.post('/api/leads', lead({ name: '=HYPERLINK("http://evil")', email: 'x@example.com' }));
    assert.ok((await owner.get('/api/workspace/leads/export')).body.content.includes(`"'=HYPERLINK(""http://evil"")"`));
  } finally {
    await t.close();
  }
});

test('leads never cross showrooms; the honeypot stores nothing; posting is rate-limited per address', async () => {
  const t = await startTestServer({ rateLimits: true });
  try {
    const A = t.tenant({ slug: 'lead-iso-a' });
    const B = t.tenant({ slug: 'lead-iso-b' });
    const aOwner = await t.showroomUser(A, { role: 'owner' });
    const bOwner = await t.showroomUser(B, { role: 'owner' });
    const aVisitor = await t.showroomUser(A);
    const k = (await aVisitor.post('/api/projects', { name: 'A design', doc: sampleDoc() })).body.project;
    const share = (await aVisitor.post(`/api/projects/${k.id}/shares`, {})).body.share.token;
    // A's link can't be sent to B, nor A's kitchen.
    const onB = new Agent(t.url, { host: B.host });
    assert.equal((await onB.post('/api/leads', lead({ shareToken: share }))).status, 404);
    assert.equal((await aVisitor.post('/api/leads', lead({ projectId: k.id }))).status, 201);
    const aLead = (await aOwner.get('/api/workspace/leads')).body.leads[0];
    assert.deepEqual((await bOwner.get('/api/workspace/leads')).body.leads, []);
    assert.equal((await bOwner.get(`/api/workspace/leads/${aLead.id}`)).status, 404);
    assert.equal((await bOwner.patch(`/api/workspace/leads/${aLead.id}`, { status: 'won' })).status, 404);
    assert.ok(!(await bOwner.get('/api/workspace/leads/export')).body.content.includes(aLead.email));
    // No showroom lead form on the sales site.
    assert.equal((await t.agent().post('/api/leads', lead())).status, 404);

    // The honeypot: "accepted", nothing stored.
    const before = t.db.prepare('SELECT COUNT(*) AS n FROM showroom_leads').get().n;
    const bot = await onB.post('/api/leads', lead({ website: 'http://spam.example' }));
    assert.equal(bot.status, 201);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM showroom_leads').get().n, before);
    // 5 per 10 minutes per address (the honeypot one counted too).
    let last;
    for (let i = 0; i < 6; i++) last = await onB.post('/api/leads', lead());
    assert.equal(last.status, 429);
  } finally {
    await t.close();
  }
});

test('Book a call on the sales site: stored for admins (status, notes, audited), emailed to SUPPORT_EMAIL when email is on', async () => {
  const sent = [];
  const fetch = async (url, init = {}) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'email_1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const t = await startTestServer({ env: { RESEND_API_KEY: 're_FAKE_FOR_TESTS', EMAIL_FROM: 'BluModel Studio <hello@blumodel.example>', SUPPORT_EMAIL: 'sales@blumodel.example' }, fetch });
  try {
    const call = { company: 'Guelph Cabinet Works', name: 'Pat Owner', phone: '519-555-0199', email: 'Pat@GuelphCabinet.ca', city: 'Guelph, ON', message: 'Saw the demo. Call me Tuesday.' };
    const bad = await t.agent().post('/api/sales-leads', { ...call, company: '', email: 'x' });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.errors.map((e) => e.field).sort(), ['company', 'email']);
    assert.equal((await t.agent().request('POST', '/api/sales-leads', { body: call, csrf: false })).status, 403);
    const r = await t.agent().post('/api/sales-leads', call);
    assert.equal(r.status, 201, r.text);
    assert.deepEqual(r.body, { ok: true });
    await new Promise((res) => setTimeout(res, 20));
    const mail = sent.find((x) => x.url.includes('resend'));
    assert.ok(mail, 'emailed');
    assert.deepEqual(mail.body.to, ['sales@blumodel.example']);
    assert.match(mail.body.subject, /^Book a call: Guelph Cabinet Works$/);
    assert.match(mail.body.text, /Phone: 519-555-0199/);
    // The honeypot: nothing stored, nothing sent.
    const n = sent.length;
    assert.equal((await t.agent().post('/api/sales-leads', { ...call, website: 'x' })).status, 201);
    assert.equal(sent.length, n);
    // Not on a showroom.
    const S = t.tenant({ slug: 'no-sales' });
    assert.equal((await new Agent(t.url, { host: S.host }).post('/api/sales-leads', call)).status, 404);

    const customer = await t.user();
    assert.equal((await customer.get('/api/admin/sales-leads')).status, 403);
    const admin = await t.user({ role: 'admin' });
    const list = (await admin.get('/api/admin/sales-leads')).body;
    assert.equal(list.leads.length, 1);
    assert.equal(list.leads[0].email, 'pat@guelphcabinet.ca');
    assert.equal(list.leads[0].emailed, true);
    assert.equal(list.counts.total, 1);
    const upd = await admin.patch(`/api/admin/sales-leads/${list.leads[0].id}`, { status: 'demo', adminNotes: 'Demo booked Oct 21' });
    assert.equal(upd.body.lead.status, 'demo');
    assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'sales_lead_update'").get().n, 1);
  } finally {
    await t.close();
  }
});
