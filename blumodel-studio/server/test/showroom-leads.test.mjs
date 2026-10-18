// Leads as people (docs/handoff/leads.md): "Before you start" on a showroom (capture, consent,
// dedupe by email or phone, the visitor cookie), visitors' designs saved under their lead, sending,
// the team's Leads tab (list, detail, timeline, view-only design, delete), isolation between
// showrooms, rate limits, the older account path, and the migration of sent designs into leads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.mjs';
import { migrate } from '../db/migrate.mjs';
import { MIGRATION_KEYS, MIGRATION_MODULES } from '../db/migrations/index.mjs';
import { Agent, sampleDoc, startTestServer } from './helpers.mjs';
import { startConsentText } from '../tenancy/leads.mjs';

const me = (over = {}) => ({ name: 'Riley Okafor', email: 'Riley@Example.com', phone: '519 555 0142', consent: true, website: '', ...over });

test('before you start: name plus email or phone, consent required; a host-only visitor cookie; returning visitors are known', async () => {
  const t = await startTestServer();
  try {
    const A = t.tenant({ name: 'Alpha Kitchens', slug: 'cap-a' });
    const v = new Agent(t.url, { host: A.host });
    assert.deepEqual((await v.get('/api/visitor')).body, { visitor: null, required: true });

    const bad = await v.post('/api/visitor', { name: '', email: 'nope', phone: '12', consent: false });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.errors.map((e) => e.field).sort(), ['consent', 'email', 'name', 'phone']);
    const neither = await v.post('/api/visitor', me({ email: '', phone: '' }));
    assert.equal(neither.status, 400);
    assert.deepEqual(neither.body.errors.map((e) => e.field), ['contact']);
    assert.match(neither.body.errors[0].message, /email or a phone number so Alpha Kitchens/);
    assert.deepEqual((await v.post('/api/visitor', me({ consent: 'yes' }))).body.errors.map((e) => e.field), ['consent']);
    // CSRF header required.
    assert.equal((await v.request('POST', '/api/visitor', { body: me(), csrf: false })).status, 403);
    // The honeypot: "accepted", nothing stored, no cookie.
    const bot = await v.post('/api/visitor', me({ website: 'http://spam.example' }));
    assert.equal(bot.status, 201);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM tenant_leads').get().n, 0);
    assert.equal(v.cookies.size, 0);
    // Not on the sales site.
    assert.equal((await t.agent().post('/api/visitor', me())).status, 404);

    const ok = await v.post('/api/visitor', me());
    assert.equal(ok.status, 201, ok.text);
    assert.deepEqual({ ...ok.body.visitor, since: 0 }, { name: 'Riley Okafor', email: 'riley@example.com', phone: '(519) 555-0142', consentText: 'Alpha Kitchens may contact me about my design.', since: 0 });
    const cookie = [ok.headers.get('set-cookie')].join(';');
    assert.match(cookie, /blumodel_visitor=[A-Za-z0-9_-]{40,}/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /Domain=/i);
    const row = t.db.prepare('SELECT * FROM tenant_leads').get();
    assert.equal(row.consent_text, startConsentText('Alpha Kitchens'));
    assert.ok(row.consent_at > 0);
    assert.equal(row.phone_key, '15195550142');
    // The token is stored hashed only.
    const token = v.cookies.get('blumodel_visitor');
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM tenant_lead_visitors WHERE token_hash = ?').get(token).n, 0);
    // Returning: known on the next visit, not asked again.
    assert.equal((await v.get('/api/visitor')).body.visitor.name, 'Riley Okafor');
    // "Not you?" forgets this browser; the lead stays.
    assert.equal((await v.delete('/api/visitor')).status, 200);
    assert.equal((await v.get('/api/visitor')).body.visitor, null);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM tenant_leads').get().n, 1);
    // A showroom that isn't open yet takes no visitors.
    const S = t.tenant({ slug: 'cap-setup', status: 'setup' });
    assert.equal((await new Agent(t.url, { host: S.host }).post('/api/visitor', me())).status, 403);
  } finally {
    await t.close();
  }
});

test('a visitor designs and saves without an account; the team sees the lead, its timeline and a view-only design; sending prefills and marks it sent', async () => {
  const t = await startTestServer();
  try {
    const A = t.tenant({ name: 'Alpha Kitchens', slug: 'des-a' });
    const owner = await t.showroomUser(A, { role: 'owner' });
    const v = new Agent(t.url, { host: A.host });
    // No details yet: no designs on the server.
    assert.equal((await v.post('/api/projects', { name: 'K', doc: sampleDoc() })).status, 401);
    await v.post('/api/visitor', me({ phone: '' }));
    const k = await v.post('/api/projects', { name: 'Riley’s kitchen', doc: sampleDoc() });
    assert.equal(k.status, 201, k.text);
    const id = k.body.project.id;
    assert.equal((await v.get('/api/projects')).body.projects.length, 1);
    const saved = await v.request('PUT', `/api/projects/${id}`, { body: { doc: sampleDoc({ name: 'x' }), name: 'Riley’s kitchen', revision: 1 } });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.body.project.revision, 2);
    // Downloads are free for the visitor's own design.
    assert.equal((await v.post(`/api/projects/${id}/exports`, { kind: 'csv' })).status, 200);
    // Nobody else can read it: another browser, a signed-in visitor, the sales site.
    const stranger = new Agent(t.url, { host: A.host });
    assert.equal((await stranger.get(`/api/projects/${id}`)).status, 401);
    const other = await t.showroomUser(A);
    assert.equal((await other.get(`/api/projects/${id}`)).status, 404);
    assert.equal((await other.request('PUT', `/api/projects/${id}`, { body: { name: 'mine', force: true } })).status, 404);
    assert.equal((await other.post(`/api/projects/${id}/exports`, { kind: 'csv' })).status, 404);

    const list = (await owner.get('/api/workspace/leads')).body;
    assert.equal(list.leads.length, 1);
    const l = list.leads[0];
    assert.equal(l.email, 'riley@example.com');
    assert.equal(l.designs, 1);
    assert.equal(l.sent, false);
    assert.equal(l.read, false);
    assert.equal(list.counts.unread, 1);
    assert.deepEqual((await owner.get('/api/workspace/leads/summary')).body.counts.unread, 1);
    const detail = (await owner.get(`/api/workspace/leads/${l.id}`)).body.lead;
    assert.deepEqual(detail.timeline.map((e) => e.kind).reverse(), ['captured', 'started']);
    assert.equal(detail.designs[0].name, 'Riley’s kitchen');
    assert.equal(detail.designs[0].items, 1);
    assert.equal(detail.consentText, 'Alpha Kitchens may contact me about my design.');
    // Open in 3D: the whole design, read-only (a GET; there is no write route for the team).
    const d = (await owner.get(`/api/workspace/leads/${l.id}/designs/${id}`)).body.design;
    assert.equal(d.name, 'Riley’s kitchen');
    assert.equal(d.doc.items.length, 1);
    assert.equal((await owner.request('PUT', `/api/projects/${id}`, { body: { name: 'staff edit', force: true } })).status, 404);
    // Only the team.
    assert.equal((await v.get('/api/workspace/leads')).status, 401);
    assert.equal((await other.get(`/api/workspace/leads/${l.id}/designs/${id}`)).status, 403);

    // Send: the visitor's own design, joined to their lead (not a second lead), marked sent.
    const sent = await v.post('/api/leads', { name: 'Riley Okafor', email: 'riley@example.com', phone: '', postalCode: 'n1h 3a1', budget: 'Not sure yet', consent: true, projectId: id, website: '' });
    assert.equal(sent.status, 201, sent.text);
    assert.equal(sent.body.id, l.id);
    // A send is news again for the team.
    assert.equal((await owner.get('/api/workspace/leads')).body.leads[0].read, false);
    const after = (await owner.get(`/api/workspace/leads/${l.id}`)).body.lead;
    assert.equal(after.sent, true);
    assert.ok(after.designs[0].sentAt > 0);
    assert.match(after.designs[0].sentUrl, /#\/s\/[A-Za-z0-9_-]{32}$/);
    assert.equal(after.sendsList[0].postalCode, 'N1H 3A1');
    assert.equal(after.timeline[0].kind, 'sent');
    assert.equal((await owner.get('/api/workspace/leads?sent=yes')).body.leads.length, 1);
    assert.equal((await owner.get('/api/workspace/leads?sent=no')).body.leads.length, 0);
    assert.equal((await owner.get('/api/workspace/leads?sent=maybe')).status, 400);
    // Status changes are on the timeline, with who made them.
    const upd = (await owner.patch(`/api/workspace/leads/${l.id}`, { status: 'contacted', staffNotes: 'Called' })).body.lead;
    assert.deepEqual(upd.timeline[0], { kind: 'status', at: upd.timeline[0].at, projectId: null, design: '', from: 'new', to: 'contacted', by: owner.user.email });
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM tenant_leads').get().n, 1);
  } finally {
    await t.close();
  }
});

test('typing an email or phone another lead has makes a separate lead marked as a possible duplicate (audit: anyone who types a customer’s email joined their lead); staff merge or keep separate', async () => {
  const t = await startTestServer();
  try {
    const A = t.tenant({ slug: 'dup-a' });
    const owner = await t.showroomUser(A, { role: 'owner' });
    const one = new Agent(t.url, { host: A.host });
    const two = new Agent(t.url, { host: A.host });
    const three = new Agent(t.url, { host: A.host });
    await one.post('/api/visitor', me({ phone: '' }));
    const k = (await one.post('/api/projects', { name: 'First', doc: sampleDoc() })).body.project;
    const real = (await owner.get('/api/workspace/leads')).body.leads[0];
    // Same email, another browser, a different name: NOT joined. Its own lead, flagged for the team.
    const r2 = await two.post('/api/visitor', me({ name: 'Somebody Else', email: 'RILEY@example.com', phone: '(519) 555-0142' }));
    assert.equal(r2.status, 201);
    assert.equal(r2.body.visitor.name, 'Somebody Else', 'this browser sees what it typed');
    assert.equal((await two.get(`/api/projects/${k.id}`)).status, 404, 'never the first browser’s designs');
    assert.deepEqual((await two.get('/api/projects')).body.projects, []);
    const k2 = (await two.post('/api/projects', { name: 'Second', doc: sampleDoc() })).body.project;
    // Same phone only: the only lead with that phone is itself a possible duplicate, so this is a new person.
    await three.post('/api/visitor', me({ name: 'R', email: '', phone: '+1 519-555-0142' }));
    // And the same email once more, from yet another browser.
    const four = new Agent(t.url, { host: A.host });
    await four.post('/api/visitor', me({ name: 'Not Riley', phone: '' }));
    let leads = (await owner.get('/api/workspace/leads')).body.leads;
    assert.equal(leads.length, 4);
    const original = leads.find((x) => x.id === real.id);
    assert.equal(original.name, 'Riley Okafor');
    assert.equal(original.phone, '', 'the existing lead is untouched: no blank filled from an unproven form');
    assert.equal(original.designs, 1);
    assert.equal(original.duplicateOf, null);
    assert.equal(leads.find((x) => x.name === 'R').duplicateOf, null);
    const dups = leads.filter((x) => x.duplicateOf);
    assert.deepEqual(dups.map((x) => x.name).sort(), ['Not Riley', 'Somebody Else']);
    for (const d of dups) assert.deepEqual(d.duplicateOf, { id: real.id, name: 'Riley Okafor' });
    const dupTwo = dups.find((x) => x.name === 'Somebody Else');
    assert.equal(dupTwo.designs, 1);
    // The first browser still sees only itself.
    assert.equal((await one.get('/api/visitor')).body.visitor.name, 'Riley Okafor');
    assert.deepEqual((await one.get('/api/projects')).body.projects.map((p) => p.name), ['First']);

    // Staff: 'Not Riley' is someone else; 'Somebody Else' is the same person (merged).
    const dupThree = dups.find((x) => x.name === 'Not Riley');
    const kept = await owner.post(`/api/workspace/leads/${dupThree.id}/keep-separate`);
    assert.equal(kept.status, 200, kept.text);
    assert.equal(kept.body.lead.duplicateOf, null);
    const merged = await owner.post(`/api/workspace/leads/${dupTwo.id}/merge`);
    assert.equal(merged.status, 200, merged.text);
    assert.equal(merged.body.lead.id, real.id);
    assert.deepEqual(merged.body.lead.designs.map((d) => d.name).sort(), ['First', 'Second']);
    assert.ok(merged.body.lead.timeline.some((e) => e.kind === 'merged'));
    assert.equal((await owner.get(`/api/workspace/leads/${dupTwo.id}`)).status, 404);
    // Merged: still each browser sees only its own designs.
    assert.deepEqual((await two.get('/api/projects')).body.projects.map((p) => p.name), ['Second']);
    assert.equal((await two.get(`/api/projects/${k.id}`)).status, 404);
    assert.equal((await owner.post(`/api/workspace/leads/${real.id}/merge`)).body.code, 'not_duplicate');
    // Another showroom's staff can't merge anything here.
    const B = t.tenant({ slug: 'dup-b' });
    const bOwner = await t.showroomUser(B, { role: 'owner' });
    assert.equal((await bOwner.post(`/api/workspace/leads/${dupThree.id}/merge`)).status, 404);

    // A different phone and email is a different person, not flagged.
    await new Agent(t.url, { host: A.host }).post('/api/visitor', me({ name: 'Morgan', email: 'morgan@example.com', phone: '226-555-0107' }));
    leads = (await owner.get('/api/workspace/leads')).body.leads;
    assert.equal(leads.find((x) => x.name === 'Morgan').duplicateOf, null);
    assert.deepEqual((await owner.get('/api/workspace/leads?q=226555')).body.leads.map((x) => x.name), ['Morgan']);
    // Deleting the original makes its remaining duplicate the lead for the address.
    const dupFour = await new Agent(t.url, { host: A.host }).post('/api/visitor', me({ name: 'Riley again', email: 'riley@example.com', phone: '' }));
    assert.equal(dupFour.status, 201);
    await owner.delete(`/api/workspace/leads/${real.id}`);
    const after = (await owner.get('/api/workspace/leads')).body.leads;
    const promoted = after.find((x) => x.name === 'Not Riley');
    assert.equal(promoted.duplicateOf, null, 'the oldest duplicate is now the lead for the address');
    assert.deepEqual(after.find((x) => x.name === 'Riley again').duplicateOf, { id: promoted.id, name: 'Not Riley' });
  } finally {
    await t.close();
  }
});

test('leads, visitors and designs never cross showrooms', async () => {
  const t = await startTestServer();
  try {
    const A = t.tenant({ slug: 'iso-a' });
    const B = t.tenant({ slug: 'iso-b' });
    const aOwner = await t.showroomUser(A, { role: 'owner' });
    const bOwner = await t.showroomUser(B, { role: 'owner' });
    const v = new Agent(t.url, { host: A.host });
    await v.post('/api/visitor', me());
    const k = (await v.post('/api/projects', { name: 'A only', doc: sampleDoc() })).body.project;
    const lead = (await aOwner.get('/api/workspace/leads')).body.leads[0];
    // B's team sees none of it.
    assert.deepEqual((await bOwner.get('/api/workspace/leads')).body.leads, []);
    assert.equal((await bOwner.get('/api/workspace/leads/summary')).body.counts.total, 0);
    assert.equal((await bOwner.get(`/api/workspace/leads/${lead.id}`)).status, 404);
    assert.equal((await bOwner.patch(`/api/workspace/leads/${lead.id}`, { status: 'won' })).status, 404);
    assert.equal((await bOwner.delete(`/api/workspace/leads/${lead.id}`)).status, 404);
    assert.equal((await bOwner.get(`/api/workspace/leads/${lead.id}/designs/${k.id}`)).status, 404);
    assert.ok(!(await bOwner.get('/api/workspace/leads/export')).body.content.includes('riley@example.com'));
    // A's visitor token is nothing on B, even if a browser sent it there.
    const onB = new Agent(t.url, { host: B.host });
    onB.cookies.set('blumodel_visitor', v.cookies.get('blumodel_visitor'));
    assert.equal((await onB.get('/api/visitor')).body.visitor, null);
    assert.equal((await onB.get(`/api/projects/${k.id}`)).status, 401);
    assert.equal((await onB.post('/api/projects', { name: 'x', doc: sampleDoc() })).status, 401);
    // Nor on the sales site.
    const sales = t.agent();
    sales.cookies.set('blumodel_visitor', v.cookies.get('blumodel_visitor'));
    assert.equal((await sales.get('/api/projects')).status, 401);
    // The same email on B is B's own lead, separate from A's.
    await new Agent(t.url, { host: B.host }).post('/api/visitor', me());
    assert.equal((await bOwner.get('/api/workspace/leads')).body.leads.length, 1);
    assert.notEqual((await bOwner.get('/api/workspace/leads')).body.leads[0].id, lead.id);
    // Admin > Companies: counts only.
    const admin = await t.user({ role: 'admin' });
    const row = (await admin.get('/api/admin/tenants')).body.tenants.find((x) => x.id === A.id);
    assert.deepEqual(row.leads, { total: 1, new: 1, thisMonth: 1, sent: 0 });
  } finally {
    await t.close();
  }
});

test('the team skips the form; the form is rate-limited per address', async () => {
  const t = await startTestServer({ rateLimits: true });
  try {
    const A = t.tenant({ slug: 'rl-a' });
    const staff = await t.showroomUser(A, { role: 'staff' });
    assert.deepEqual((await staff.get('/api/visitor')).body, { visitor: null, required: false });
    assert.equal((await staff.post('/api/visitor', me())).status, 409);
    const v = new Agent(t.url, { host: A.host });
    let last;
    for (let i = 0; i < 11; i++) last = await v.post('/api/visitor', me({ email: `r${i}@example.com`, phone: '' }));
    assert.equal(last.status, 429);
  } finally {
    await t.close();
  }
});

test('staff delete a lead with its designs (audited without the person’s details); an account’s own designs are kept', async () => {
  const t = await startTestServer();
  try {
    const A = t.tenant({ slug: 'del-a' });
    const owner = await t.showroomUser(A, { role: 'owner' });
    const v = new Agent(t.url, { host: A.host });
    await v.post('/api/visitor', me());
    const k = (await v.post('/api/projects', { name: 'Gone soon', doc: sampleDoc() })).body.project;
    await v.post('/api/leads', { name: 'Riley', email: 'riley@example.com', consent: true, projectId: k.id, website: '' });
    // An account that also answered the form: its design is the account's.
    const acct = await t.showroomUser(A, { email: 'acct@example.com' });
    const ak = (await acct.post('/api/projects', { name: 'Account design', doc: sampleDoc() })).body.project;
    await acct.post('/api/visitor', me({ email: 'riley@example.com' }));
    // The same address from an account: a possible duplicate until the team merges it.
    const dup = (await owner.get('/api/workspace/leads')).body.leads.find((x) => x.duplicateOf);
    assert.ok(dup);
    assert.equal((await owner.post(`/api/workspace/leads/${dup.id}/merge`)).status, 200);
    const lead = (await owner.get('/api/workspace/leads')).body.leads[0];
    assert.equal(lead.designs, 2);
    const del = await owner.delete(`/api/workspace/leads/${lead.id}`);
    assert.equal(del.status, 200, del.text);
    assert.deepEqual(del.body.removed, { designs: 1, unlinked: 1, sends: 1 });
    assert.equal((await owner.get(`/api/workspace/leads/${lead.id}`)).status, 404);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM projects WHERE id = ?').get(k.id).n, 0);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM share_links WHERE project_id = ?').get(k.id).n, 0);
    assert.equal((await acct.get(`/api/projects/${ak.id}`)).status, 200, 'the account keeps its own design');
    assert.equal((await v.get('/api/visitor')).body.visitor, null, 'the visitor cookie stops working');
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM tenant_lead_events').get().n, 0);
    const a = t.db.prepare("SELECT * FROM admin_audit WHERE action = 'showroom_lead_delete'").get();
    assert.equal(a.admin_email, owner.user.email);
    assert.ok(!a.detail.includes('riley'), 'no personal details in the audit');
    assert.equal(JSON.parse(a.detail).leadId, lead.id);
  } finally {
    await t.close();
  }
});

test('the older account path: an account that answers the form joins its lead, and a visitor who signs up takes their designs along', async () => {
  const t = await startTestServer();
  try {
    const A = t.tenant({ slug: 'acct-a' });
    const owner = await t.showroomUser(A, { role: 'owner' });
    const acct = await t.showroomUser(A, { email: 'pat@example.com', name: 'Pat' });
    const before = (await acct.post('/api/projects', { name: 'Before the form', doc: sampleDoc() })).body.project;
    assert.equal((await acct.get('/api/visitor')).body.visitor, null);
    await acct.post('/api/visitor', { name: 'Pat', email: 'pat@example.com', consent: true });
    const lead = (await owner.get('/api/workspace/leads')).body.leads[0];
    assert.equal(lead.signedIn, true);
    assert.equal(lead.designs, 1);
    // Signed in on another browser: still known.
    const elsewhere = new Agent(t.url, { host: A.host });
    await elsewhere.post('/api/auth/login', { email: 'pat@example.com', password: acct.user.password });
    assert.equal((await elsewhere.get('/api/visitor')).body.visitor.email, 'pat@example.com');
    await elsewhere.post('/api/projects', { name: 'After', doc: sampleDoc() });
    assert.equal((await owner.get(`/api/workspace/leads/${lead.id}`)).body.lead.designs.length, 2);
    assert.equal((await acct.get(`/api/projects/${before.id}`)).status, 200);

    // A visitor with designs who then makes an account on the same browser.
    const v = new Agent(t.url, { host: A.host });
    await v.post('/api/visitor', me({ email: 'sam@example.com', phone: '' }));
    const k = (await v.post('/api/projects', { name: 'Sam’s', doc: sampleDoc() })).body.project;
    const signup = await v.post('/api/auth/signup', { name: 'Sam', email: 'sam@example.com', password: 'a long enough password 1' });
    assert.equal(signup.status, 201, signup.text);
    assert.ok((await v.get('/api/visitor')).body.visitor);
    const other = new Agent(t.url, { host: A.host });
    await other.post('/api/auth/login', { email: 'sam@example.com', password: 'a long enough password 1' });
    assert.equal((await other.get(`/api/projects/${k.id}`)).status, 200, 'the account has the design on any browser');
    const sam = (await owner.get('/api/workspace/leads?q=sam')).body.leads[0];
    assert.equal(sam.signedIn, true);
  } finally {
    await t.close();
  }
});

test('leads-001: every sent design becomes a lead (same email or phone in a showroom = one person); nothing is lost', () => {
  const db = openDb(':memory:');
  const i = MIGRATION_KEYS.indexOf('leads');
  migrate(db, { modules: MIGRATION_MODULES.slice(0, i), keys: MIGRATION_KEYS.slice(0, i) });
  const t = 1_760_000_000_000;
  db.prepare("INSERT INTO tenants (id, slug, name, status, created_at, updated_at) VALUES ('t1', 'one', 'One', 'live', ?, ?), ('t2', 'two', 'Two', 'live', ?, ?)").run(t, t, t, t);
  db.prepare("INSERT INTO users (id, email, name, password_hash, created_at, tenant_id) VALUES ('u1', 'r@x.test', 'R', 'h', ?, 't1')").run(t);
  db.prepare("INSERT INTO projects (id, user_id, name, doc, created_at, updated_at, tenant_id) VALUES ('k1', 'u1', 'K1', '{}', ?, ?, 't1'), ('k2', 'u1', 'K2', '{}', ?, ?, 't1')").run(t, t, t, t);
  db.prepare("INSERT INTO share_links (id, project_id, token, created_by, created_at) VALUES ('s1', 'k1', 'tok1', 'u1', ?)").run(t);
  const send = db.prepare(
    `INSERT INTO showroom_leads (id, tenant_id, user_id, project_id, design_name, share_token, name, email, phone, consent, consent_text, status, staff_notes, read_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'I agree', ?, ?, ?, ?, ?)`,
  );
  send.run('ld_aaaaaaaaaaaa', 't1', 'u1', 'k1', 'K1', 'tok1', 'Riley', 'r@x.test', '519-555-0142', 'contacted', 'Called', t, t, t);
  send.run('ld_bbbbbbbbbbbb', 't1', null, null, '', null, 'Riley O', 'riley@other.test', '(519) 555-0142', 'quoted', 'Quote sent', null, t + 10, t + 10);
  send.run('ld_cccccccccccc', 't1', null, null, '', null, 'Sam', 'sam@x.test', '', 'new', '', null, t + 20, t + 20);
  send.run('ld_dddddddddddd', 't2', null, null, '', null, 'Riley', 'r@x.test', '', 'new', '', null, t + 30, t + 30);

  const ran = migrate(db);
  assert.deepEqual(ran.filter((id) => id.startsWith('leads-')), ['leads-001-people-visitors-events']);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const leads = db.prepare('SELECT * FROM tenant_leads ORDER BY tenant_id, created_at').all();
  assert.deepEqual(
    leads.map((l) => [l.tenant_id, l.id, l.email, l.phone, l.status]),
    [
      ['t1', 'ld_aaaaaaaaaaaa', 'r@x.test', '(519) 555-0142', 'quoted'],
      ['t1', 'ld_cccccccccccc', 'sam@x.test', '', 'new'],
      ['t2', 'ld_dddddddddddd', 'r@x.test', '', 'new'],
    ],
  );
  assert.equal(leads[0].staff_notes, 'Called\n\nQuote sent');
  assert.equal(leads[0].read_at, null, 'unread when any send was');
  assert.equal(leads[0].user_id, 'u1');
  assert.deepEqual(db.prepare('SELECT id, lead_id FROM showroom_leads ORDER BY id').all().map((r) => r.lead_id), ['ld_aaaaaaaaaaaa', 'ld_aaaaaaaaaaaa', 'ld_cccccccccccc', 'ld_dddddddddddd']);
  assert.deepEqual(db.prepare('SELECT id, lead_id FROM projects ORDER BY id').all().map((r) => r.lead_id), ['ld_aaaaaaaaaaaa', 'ld_aaaaaaaaaaaa']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tenant_lead_events WHERE kind = 'sent'").get().n, 4);
  // The projects rebuild kept everything that points at a design.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM share_links').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 2);
  // A design needs an owner.
  assert.throws(() => db.prepare("INSERT INTO projects (id, name, doc, created_at, updated_at) VALUES ('k3', 'x', '{}', 1, 1)").run());
});
