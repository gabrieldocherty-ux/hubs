// A person's own account (launch contract):
//   GET  /api/account/export            everything that is theirs, as a JSON download
//   POST /api/account/delete {password} delete it (signed in, CSRF, password again)
// The promise tested throughout: another person's data is never included and never deleted, and
// the export carries no secret (no password hash, session, share token or provider reference).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startTestServer, sampleDoc } from './helpers.mjs';
import { makePng } from './fixtures/images.mjs';
import { randomId } from '../lib/ids.mjs';
import { audit } from '../lib/audit.mjs';

const kitchen = async (agent, name) => {
  const r = await agent.post('/api/projects', { name, doc: sampleDoc({ name }) });
  assert.equal(r.status, 201, r.text);
  return r.body.project;
};
const share = async (agent, projectId) => {
  const r = await agent.post(`/api/projects/${projectId}/shares`, {});
  assert.equal(r.status, 201, r.text);
  return r.body.share;
};
const upload = async (agent, png, kind = 'image') => {
  const r = await agent.putRaw(`/api/files?kind=${kind}&name=photo.png`, png, 'image/png');
  assert.equal(r.status, 201, r.text);
  return r.body.file;
};
async function demoBuy(agent, body) {
  const c = await agent.post('/api/billing/checkout', body);
  assert.equal(c.status, 200, c.text);
  assert.equal((await agent.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' })).status, 200);
}
async function paidOrder(agent) {
  const ref = await upload(agent, makePng({ rgba: [9, 9, 9, 255] }), 'reference');
  const r = await agent.post('/api/orders', {
    target: 'customer',
    brief: { productTypeId: 'sink-farmhouse', kind: 'sink', variant: 'farmhouse', name: 'Old farmhouse sink', widthIn: 33, depthIn: 22, heightIn: 36, notes: '', referenceFileIds: [ref.id] },
    tier: 'standard',
  });
  assert.equal(r.status, 201, r.text);
  const o = r.body.order;
  assert.equal((await agent.post(`/api/orders/${o.id}/checkout`)).status, 200);
  const done = await agent.post(`/api/payments/demo/${o.id}/complete`, { outcome: 'success' });
  assert.equal(done.status, 200, done.text);
  return o;
}
/** A contractor with a brand page (not submitted: the export and delete don't care) and leads. */
async function contractorWithPage(s, company) {
  const c = await s.user();
  await demoBuy(c, { kind: 'subscription', plan: 'contractor' });
  assert.equal((await c.put('/api/pro/profile', { company, phone: '555-0100', email: `hello@${company.toLowerCase().replace(/\W+/g, '')}.test`, website: '', serviceArea: 'Hamilton', defaultMarkupPct: 30 })).status, 200);
  const page = await c.put('/api/pro/brand', { tagline: `${company} cabinets`, about: 'Family shop.' });
  assert.equal(page.status, 200, page.text);
  const brand = s.db.prepare("SELECT * FROM brands WHERE owner_user_id = ? AND kind = 'contractor'").get(c.id);
  assert.ok(brand);
  const lead = (name, email) => {
    const t = Date.now();
    s.db
      .prepare(
        `INSERT INTO leads (id, brand_id, product_name, project_name, name, email, phone, location, message, status, notes, created_at, updated_at)
         VALUES (?, ?, '', '', ?, ?, '', 'Hamilton', 'Please call', 'new', '', ?, ?)`,
      )
      .run(randomId('ld_'), brand.id, name, email, t, t);
  };
  return { c, brand, lead };
}
const count = (s, sql, ...p) => s.db.prepare(sql).get(...p).n;

test('export: a JSON download of everything that is theirs, nobody else’s data, and nothing secret', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const ann = await s.user({ name: 'Ann Account' });
    const bob = await s.user({ name: 'Bob Other' });
    const k1 = await kitchen(ann, 'Ann Galley');
    await kitchen(ann, 'Ann Island');
    const annShare = await share(ann, k1.id);
    await upload(ann, makePng({ rgba: [1, 2, 3, 255] }));
    const order = await paidOrder(ann);
    const bk = await kitchen(bob, 'Bob Secret Kitchen');
    const bobShare = await share(bob, bk.id);
    await upload(bob, makePng({ rgba: [4, 5, 6, 255] }));

    assert.equal((await s.agent().get('/api/account/export')).status, 401);
    const r = await ann.get('/api/account/export');
    assert.equal(r.status, 200, r.text);
    assert.match(r.headers.get('content-disposition'), /^attachment; filename="blumodel-account-\d{4}-\d{2}-\d{2}\.json"$/);
    assert.match(r.headers.get('content-type'), /^application\/json/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const data = JSON.parse(r.text);

    assert.deepEqual(Object.keys(data.user).sort(), ['createdAt', 'email', 'name']);
    assert.equal(data.user.email, ann.user.email);
    assert.equal(data.user.name, 'Ann Account');
    assert.deepEqual(data.projects.map((p) => p.name).sort(), ['Ann Galley', 'Ann Island']);
    assert.equal(data.projects[0].doc.room.widthIn, 200, 'the kitchens themselves, not just their names');
    assert.equal(data.shares.length, 1);
    assert.equal(data.shares[0].projectId, k1.id);
    assert.equal(data.orders.length, 1);
    assert.equal(data.orders[0].id, order.id);
    assert.equal(data.orders[0].status, 'paid');
    assert.equal(data.uploads.length, 2, 'the photo and the order reference');
    assert.equal(data.brandPage, undefined, 'not a contractor: no brand page');
    assert.equal(data.leads, undefined);

    // Nobody else's data.
    for (const other of [bob.user.email, bob.id, bk.id, 'Bob Secret Kitchen', 'Bob Other', bobShare.token]) assert.ok(!r.text.includes(other), `the export holds someone else’s ${other}`);
    // No secrets: password hash, session token, share token, provider references.
    const session = ann.cookies.get('blumodel_session');
    for (const secret of [session, annShare.token, 'password', 'scrypt', 'token_hash', 'provider_ref', 'payment_intent', 'subscription_ref', 'customer_ref']) {
      assert.ok(!r.text.includes(secret), `the export holds ${secret}`);
    }
  } finally {
    await s.close();
  }
});

test('export: a contractor gets their brand page, their leads and their price book; never another contractor’s', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const carl = await contractorWithPage(s, 'Carl Cabinets');
    const dave = await contractorWithPage(s, 'Dave Doors');
    carl.lead('Hannah Homeowner', 'hannah@test.blumodel');
    dave.lead('Ivan Elsewhere', 'ivan@test.blumodel');
    const r = await carl.c.get('/api/account/export');
    assert.equal(r.status, 200, r.text);
    const data = JSON.parse(r.text);
    assert.equal(data.brandPage.name, carl.brand.name);
    assert.equal(data.brandPage.slug, carl.brand.slug);
    assert.deepEqual(data.leads.map((l) => l.email), ['hannah@test.blumodel']);
    assert.equal(data.contractor.company, 'Carl Cabinets');
    assert.ok(Array.isArray(data.contractor.priceBook));
    for (const other of ['Ivan Elsewhere', 'ivan@test.blumodel', 'Dave Doors', dave.brand.slug, dave.c.user.email]) assert.ok(!r.text.includes(other), other);
  } finally {
    await s.close();
  }
});

test('delete: signed in, CSRF header and the password again; a wrong password changes nothing', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const ann = await s.user();
    await kitchen(ann, 'Keep me');
    assert.equal((await s.agent().post('/api/account/delete', { password: 'x' })).status, 401);
    assert.equal((await ann.request('POST', '/api/account/delete', { body: { password: ann.user.password }, csrf: false })).status, 403);
    const wrong = await ann.post('/api/account/delete', { password: 'not it' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.code, 'wrong_password');
    const missing = await ann.post('/api/account/delete', {});
    assert.equal(missing.body.code, 'wrong_password');
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM users WHERE id = ?', ann.id), 1);
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM projects WHERE user_id = ?', ann.id), 1);
    assert.equal((await ann.get('/api/auth/me')).body.user.id, ann.id, 'still signed in');
  } finally {
    await s.close();
  }
});

test('delete: 409 active_subscription while a paid plan is active and not cancelled; allowed once it is set to end', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const ann = await s.user();
    await demoBuy(ann, { kind: 'subscription', plan: 'unlimited' });
    const r = await ann.post('/api/account/delete', { password: ann.user.password });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'active_subscription');
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM users WHERE id = ?', ann.id), 1);

    // Past due (Stripe still retrying) blocks too.
    s.db.prepare("UPDATE subscriptions SET status = 'past_due', grace_until = ? WHERE user_id = ?").run(Date.now() + 86_400_000, ann.id);
    assert.equal((await ann.post('/api/account/delete', { password: ann.user.password })).body.code, 'active_subscription');
    s.db.prepare("UPDATE subscriptions SET status = 'active', grace_until = NULL WHERE user_id = ?").run(ann.id);

    assert.equal((await ann.post('/api/billing/cancel')).status, 200);
    assert.equal((await ann.post('/api/account/delete', { password: ann.user.password })).status, 204);
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM users WHERE id = ?', ann.id), 0);

    // A complimentary plan is not a paid one.
    const admin = await s.user({ role: 'admin' });
    const cara = await s.user();
    assert.equal((await admin.post('/api/admin/billing/grant', { email: cara.user.email, plan: 'unlimited', note: '' })).status, 201);
    assert.equal((await cara.post('/api/account/delete', { password: cara.user.password })).status, 204);
  } finally {
    await s.close();
  }
});

test('delete: their kitchens, shares, uploads, sessions and brand page go; orders and receipts stay, anonymised; everyone else’s data is untouched', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const admin = await s.user({ role: 'admin' });
    const ann = await s.user();
    const bob = await s.user();
    const k = await kitchen(ann, 'Ann Galley');
    const annShare = await share(ann, k.id);
    await demoBuy(ann, { kind: 'kitchen_unlock', projectId: k.id });
    const order = await paidOrder(ann);
    // The same bytes uploaded by both: one blob on disk, two rows. Ann's own photo is hers alone.
    const same = makePng({ rgba: [77, 77, 77, 255] });
    const annSame = await upload(ann, same);
    const bobSame = await upload(bob, same);
    const annOnly = await upload(ann, makePng({ rgba: [11, 22, 33, 255] }));
    const blobOf = (f) => {
      const row = s.db.prepare('SELECT sha256, ext FROM files WHERE id = ?').get(f.id);
      return s.services.files.blobPath(row.sha256, row.ext);
    };
    const annOnlyBlob = blobOf(annOnly);
    const sharedBlob = blobOf(bobSame);
    assert.ok(fs.existsSync(annOnlyBlob) && fs.existsSync(sharedBlob));
    // Bob's kitchen and share, and an audit record that names Ann.
    const bk = await kitchen(bob, 'Bob Kitchen');
    const bobShare = await share(bob, bk.id);
    audit(s.db, { admin: admin.user, action: 'comp_grant', targetUserId: ann.id, targetEmail: ann.user.email, detail: { plan: 'unlimited' }, at: Date.now() });
    // A second device of Ann's.
    const annPhone = s.agent();
    assert.equal((await annPhone.post('/api/auth/login', { email: ann.user.email, password: ann.user.password })).status, 200);

    const before = {
      users: count(s, 'SELECT COUNT(*) AS n FROM users'),
      bobProjects: count(s, 'SELECT COUNT(*) AS n FROM projects WHERE user_id = ?', bob.id),
      bobFiles: count(s, 'SELECT COUNT(*) AS n FROM files WHERE owner_user_id = ?', bob.id),
    };
    const r = await ann.post('/api/account/delete', { password: ann.user.password });
    assert.equal(r.status, 204, r.text);
    assert.match(r.headers.get('set-cookie'), /^blumodel_session=; .*Max-Age=0/);

    // Signed out everywhere.
    assert.equal((await ann.get('/api/auth/me')).body.user, null);
    assert.equal((await annPhone.get('/api/auth/me')).body.user, null);
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', ann.id), 0);
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM users'), before.users - 1);

    // Ann's things are gone.
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM projects WHERE user_id = ?', ann.id), 0);
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM share_links WHERE project_id = ?', k.id), 0);
    assert.equal((await s.agent().get(`/api/share/${annShare.token}`)).status, 404);
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM kitchen_unlocks WHERE user_id = ?', ann.id), 0);
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM files WHERE id IN (?, ?)', annOnly.id, annSame.id), 0);
    assert.ok(!fs.existsSync(annOnlyBlob), 'a blob only Ann had is deleted from disk');

    // Kept for the accounts, without her.
    const o = s.db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    assert.ok(o, 'the order stays');
    assert.equal(o.user_id, null);
    const receipts = s.db.prepare("SELECT * FROM billing_payments WHERE kind = 'kitchen_unlock'").all();
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].user_id, null);
    assert.equal(receipts[0].project_name, '');
    assert.equal(count(s, "SELECT COUNT(*) AS n FROM admin_audit WHERE target_user_id = ?", ann.id), 1, 'the audit log stays as written');

    // Bob's things are untouched, including the bytes he shares with Ann's deleted upload.
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM projects WHERE user_id = ?', bob.id), before.bobProjects);
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM files WHERE owner_user_id = ?', bob.id), before.bobFiles);
    assert.ok(fs.existsSync(sharedBlob), 'bytes another account still uses stay on disk');
    assert.equal((await bob.get(`/api/files/${bobSame.id}/content`)).status, 200);
    assert.equal((await s.agent().get(`/api/share/${bobShare.token}`)).status, 200);
    assert.equal((await bob.get('/api/auth/me')).body.user.id, bob.id);

    // Signing up again with the same email is a new, empty account.
    const again = s.agent();
    assert.equal((await again.post('/api/auth/signup', { name: 'Ann Again', email: ann.user.email, password: 'a new password 1' })).status, 201);
    assert.deepEqual((await again.get('/api/projects')).body.projects, []);
  } finally {
    await s.close();
  }
});

test('delete: a contractor’s brand page, its leads and their catalog go; another contractor’s page and leads stay', async () => {
  const s = await startTestServer({ env: { PAYMENTS: 'demo' } });
  try {
    const carl = await contractorWithPage(s, 'Carl Cabinets');
    const dave = await contractorWithPage(s, 'Dave Doors');
    carl.lead('Hannah Homeowner', 'hannah@test.blumodel');
    dave.lead('Ivan Elsewhere', 'ivan@test.blumodel');
    const prod = await carl.c.post('/api/pro/products', {
      spec: { kind: 'base', variant: 'door-drawer', category: 'cabinets', name: 'Shaker Base', blurb: '', sku: 'SB24', widthIn: 24, depthIn: 24, heightIn: 34.5, elevationIn: 0, price: 0, finishes: [{ id: 'w', name: 'White', hex: '#ffffff', material: 'paint' }], imageFileIds: [] },
    });
    assert.equal(prod.status, 201, prod.text);
    // The contractor plan is cancelled first (409 otherwise).
    assert.equal((await carl.c.post('/api/account/delete', { password: carl.c.user.password })).body.code, 'active_subscription');
    assert.equal((await carl.c.post('/api/billing/cancel')).status, 200);
    assert.equal((await carl.c.post('/api/account/delete', { password: carl.c.user.password })).status, 204);

    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM brands WHERE id = ?', carl.brand.id), 0);
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM leads WHERE brand_id = ?', carl.brand.id), 0);
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM products WHERE id = ?', prod.body.product.id), 0);
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM contractor_profiles WHERE user_id = ?', carl.c.id), 0);
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM brands WHERE id = ?', dave.brand.id), 1);
    assert.equal(count(s, 'SELECT COUNT(*) AS n FROM leads WHERE brand_id = ?', dave.brand.id), 1);
    assert.equal((await dave.c.get('/api/pro/brand/leads')).status, 200);
  } finally {
    await s.close();
  }
});
