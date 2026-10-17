// Tenant isolation, the pivot's most important security property (docs/SHOWROOM_PIVOT.md §4):
// company A can't read or write anything of company B's through any route family, and a session
// from one host is never accepted on another. Every route family that answers on a showroom is
// covered here; leads and credits add theirs in tenancy-leads / tenancy-billing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Agent, defaultSpec, sampleDoc, startTestServer } from './helpers.mjs';
import { makePng } from '../lib/synth.mjs';
import { SHOWROOM_MODULES } from '../routes/index.mjs';

/** Two showrooms, each with an owner and a signed-in visitor, and a sales-site user. */
async function world(t) {
  const A = t.tenant({ name: 'Alpha Kitchens', slug: 'alpha', status: 'setup' });
  const B = t.tenant({ name: 'Bravo Baths', slug: 'bravo', status: 'setup' });
  const aOwner = await t.showroomUser(A, { role: 'owner' });
  const bOwner = await t.showroomUser(B, { role: 'owner' });
  const aVisitor = await t.showroomUser(A);
  const bVisitor = await t.showroomUser(B);
  const sales = await t.user();
  return { A, B, aOwner, bOwner, aVisitor, bVisitor, sales };
}

/** A copy of `agent`'s cookies on another host: what a stolen or replayed cookie would do. */
const replay = (t, agent, host) => {
  const a = new Agent(t.url, { host });
  for (const [k, v] of agent.cookies) a.cookies.set(k, v);
  return a;
};

test('a session works only on the host it was started on', async () => {
  const t = await startTestServer();
  try {
    const { A, B, aVisitor, aOwner, sales } = await world(t);
    assert.equal((await aVisitor.get('/api/auth/me')).body.user.id, aVisitor.id);
    for (const host of [B.host, `127.0.0.1:${t.port}`]) {
      const thief = replay(t, aVisitor, host);
      assert.equal((await thief.get('/api/auth/me')).body.user, null, host);
      assert.equal((await thief.get('/api/projects')).status, 401, host);
    }
    // The owner's session on A is not a session on B, so B's workspace doesn't know them.
    assert.equal((await replay(t, aOwner, B.host).get('/api/workspace/showroom')).status, 401);
    // A sales-site session is nothing on a showroom.
    assert.equal((await replay(t, sales, A.host).get('/api/auth/me')).body.user, null);
    // The cookie is host-only: no Domain attribute, ever.
    const fresh = new Agent(t.url, { host: A.host });
    const r = await fresh.post('/api/auth/login', { email: aVisitor.user.email, password: aVisitor.user.password });
    assert.equal(r.status, 200);
    assert.doesNotMatch(r.headers.get('set-cookie'), /domain=/i);
    assert.deepEqual(r.body.user.showroom, { tenantId: A.id, role: null });
  } finally {
    await t.close();
  }
});

test('accounts belong to one site: same address, separate accounts; no cross-site sign-in', async () => {
  const t = await startTestServer();
  try {
    const { A, B, aVisitor } = await world(t);
    const onB = new Agent(t.url, { host: B.host });
    assert.equal((await onB.post('/api/auth/login', { email: aVisitor.user.email, password: aVisitor.user.password })).status, 401);
    const onSales = t.agent();
    assert.equal((await onSales.post('/api/auth/login', { email: aVisitor.user.email, password: aVisitor.user.password })).status, 401);
    // The same address can sign up on B: a different account.
    const s = await onB.post('/api/auth/signup', { name: 'Same Person', email: aVisitor.user.email, password: 'another password' });
    assert.equal(s.status, 201);
    assert.notEqual(s.body.user.id, aVisitor.id);
    // ...and not twice on A.
    assert.equal((await new Agent(t.url, { host: A.host }).post('/api/auth/signup', { name: 'X', email: aVisitor.user.email, password: 'whatever123' })).status, 409);
    // Admin roles mean nothing on a showroom: an admin's own account can't sign in there at all.
    const admin = await t.user({ role: 'admin' });
    assert.equal((await new Agent(t.url, { host: A.host }).post('/api/auth/login', { email: admin.user.email, password: admin.user.password })).status, 401);
  } finally {
    await t.close();
  }
});

test('a reset link works only on its account’s site', async () => {
  const t = await startTestServer();
  try {
    const { A, B, aVisitor } = await world(t);
    const admin = await t.user({ role: 'admin' });
    const link = await admin.post(`/api/admin/users/${aVisitor.id}/reset-link`);
    assert.equal(link.status, 200);
    assert.ok(link.body.url.startsWith(`http://alpha.localhost:${t.port}/#/signin?reset=`), link.body.url);
    const token = new URL(link.body.url.replace('#/signin', 'signin')).searchParams.get('reset');
    const onB = new Agent(t.url, { host: B.host });
    assert.deepEqual((await onB.post('/api/auth/reset/check', { token })).body, { valid: false });
    assert.equal((await onB.post('/api/auth/reset', { token, password: 'brand new pass' })).status, 400);
    assert.deepEqual((await t.agent().post('/api/auth/reset/check', { token })).body, { valid: false });
    const onA = new Agent(t.url, { host: A.host });
    assert.equal((await onA.post('/api/auth/reset/check', { token })).body.valid, true);
    assert.equal((await onA.post('/api/auth/reset', { token, password: 'brand new pass' })).status, 200);
  } finally {
    await t.close();
  }
});

test('kitchens: A’s are invisible and untouchable from B, and from A’s sales-site twin', async () => {
  const t = await startTestServer();
  try {
    const { B, aVisitor, bVisitor } = await world(t);
    const made = await aVisitor.post('/api/projects', { name: 'A kitchen', doc: sampleDoc() });
    assert.equal(made.status, 201);
    const id = made.body.project.id;
    assert.equal(t.db.prepare('SELECT tenant_id FROM projects WHERE id = ?').get(id).tenant_id, aVisitor.user.tenantId);
    assert.equal((await bVisitor.get(`/api/projects/${id}`)).status, 404);
    assert.equal((await bVisitor.put(`/api/projects/${id}`, { revision: 1, name: 'mine now' })).status, 404);
    assert.equal((await bVisitor.post(`/api/projects/${id}/duplicate`)).status, 404);
    assert.equal((await bVisitor.post(`/api/projects/${id}/shares`, {})).status, 404);
    assert.equal((await bVisitor.delete(`/api/projects/${id}`)).status, 404);
    assert.deepEqual((await bVisitor.get('/api/projects')).body.projects, []);
    void B;

    // A sales-site account on both teams sees each showroom's kitchens only there.
    const twin = await t.user();
    const A2 = t.tenant({ name: 'Two A', slug: 'two-a', status: 'setup' });
    const B2 = t.tenant({ name: 'Two B', slug: 'two-b', status: 'setup' });
    t.ctx.services.tenants.addMember(A2.id, twin.id, 'staff');
    t.ctx.services.tenants.addMember(B2.id, twin.id, 'staff');
    const onA2 = new Agent(t.url, { host: A2.host });
    const onB2 = new Agent(t.url, { host: B2.host });
    for (const a of [onA2, onB2]) assert.equal((await a.post('/api/auth/login', { email: twin.user.email, password: twin.user.password })).status, 200);
    const k = (await onA2.post('/api/projects', { name: 'On A2', doc: sampleDoc() })).body.project.id;
    assert.equal((await onB2.get(`/api/projects/${k}`)).status, 404);
    assert.equal((await twin.get(`/api/projects/${k}`)).status, 404);
    assert.deepEqual((await onB2.get('/api/projects')).body.projects, []);
    // Removed from A2's team: the session there stops working at once.
    t.ctx.services.tenants.removeMember(A2.id, twin.id);
    assert.equal((await onA2.get('/api/projects')).status, 401);
  } finally {
    await t.close();
  }
});

test('share links open only on the showroom the kitchen was saved on', async () => {
  const t = await startTestServer();
  try {
    const { A, B, aVisitor } = await world(t);
    const id = (await aVisitor.post('/api/projects', { name: 'Shared', doc: sampleDoc() })).body.project.id;
    const share = await aVisitor.post(`/api/projects/${id}/shares`, {});
    assert.equal(share.status, 201);
    const token = share.body.share.token;
    assert.equal((await new Agent(t.url, { host: A.host }).get(`/api/share/${token}`)).status, 200);
    assert.equal((await new Agent(t.url, { host: B.host }).get(`/api/share/${token}`)).status, 404);
    assert.equal((await t.agent().get(`/api/share/${token}`)).status, 404);
    const bUser = await t.showroomUser(B);
    assert.equal((await bUser.post(`/api/share/${token}/duplicate`)).status, 404);
  } finally {
    await t.close();
  }
});

test('products and files: A’s catalog, models and pictures never reach B or the sales site', async () => {
  const t = await startTestServer();
  try {
    const { A, B, aOwner, bOwner, aVisitor, bVisitor } = await world(t);
    // Only a showroom's team uploads there.
    assert.equal((await aVisitor.putRaw('/api/files?kind=image&name=x.png', makePng({ w: 4, h: 4 }), 'image/png')).status, 403);
    const up = await aOwner.putRaw('/api/files?kind=image&name=door.png', makePng({ w: 5, h: 5, rgba: [10, 20, 30, 255] }), 'image/png');
    assert.equal(up.status, 201, up.text);
    const fileId = up.body.file.id;
    assert.equal(up.body.file.tenantId, A.id);

    const made = await aOwner.post('/api/workspace/products', { spec: defaultSpec({ name: 'Alpha Shaker Base', line: 'Alpha Shaker', imageFileIds: [fileId] }) });
    assert.equal(made.status, 201, made.text);
    const pid = made.body.product.id;
    assert.equal(made.body.product.brand, 'Alpha Kitchens');
    assert.equal(made.body.product.status, 'published');

    const aCat = (await aVisitor.get('/api/catalog')).body;
    assert.deepEqual(aCat.products.map((p) => p.id), [pid]);
    assert.deepEqual(aCat.brands, []);
    const imgUrl = aCat.products[0].images[0].url;
    assert.equal((await aVisitor.get(imgUrl)).status, 200);
    assert.equal((await new Agent(t.url, { host: A.host }).get(imgUrl)).status, 200, 'a signed-out visitor sees the product picture');
    const lines = (await aVisitor.get('/api/catalog/brands?category=appliances')).body;
    assert.deepEqual(lines.lines, [{ name: 'Alpha Shaker', categories: ['appliances'], products: 1 }]);
    assert.deepEqual(lines.retailBrands, []);

    assert.deepEqual((await bVisitor.get('/api/catalog')).body.products, []);
    assert.equal((await bVisitor.get(`/api/catalog/products/${pid}`)).status, 404);
    assert.equal((await bVisitor.get(`/api/catalog/products/${pid}?working=1`)).status, 404);
    assert.equal((await bVisitor.get(imgUrl)).status, 404);
    assert.equal((await bVisitor.get(`/api/files/${fileId}`)).status, 404);
    assert.ok(!(await t.agent().get('/api/catalog')).body.products.some((p) => p.id === pid), 'not in the sales-site catalog');
    assert.equal((await t.agent().get(`/api/catalog/products/${pid}`)).status, 404);
    assert.equal((await t.agent().get(imgUrl)).status, 404);
    // Stores and link-outs don't exist on a showroom.
    assert.equal((await aVisitor.get('/api/catalog/retailers')).status, 404);
    assert.equal((await aVisitor.post('/api/catalog/retail/clicks', { productId: 'x', store: 'y' })).status, 404);

    // B's team can't change, hide or reuse A's product or file.
    assert.equal((await bOwner.patch(`/api/workspace/products/${pid}`, { spec: { name: 'Taken' }, revision: 1 })).status, 404);
    assert.equal((await bOwner.post(`/api/workspace/products/${pid}/hide`)).status, 404);
    assert.deepEqual((await bOwner.get('/api/workspace/products')).body.products, []);
    const steal = await bOwner.post('/api/workspace/products', { spec: defaultSpec({ imageFileIds: [fileId] }) });
    assert.equal(steal.status, 400);
    // A public upload of A's isn't served on B either.
    const pub = await aOwner.putRaw('/api/files?kind=image&visibility=public&name=logo.png', makePng({ w: 7, h: 7, rgba: [200, 20, 30, 255] }), 'image/png');
    assert.equal((await aVisitor.get(pub.body.file.url)).status, 200);
    assert.equal((await bVisitor.get(pub.body.file.url)).status, 404);
    // Events about A's product from B are dropped.
    await bVisitor.post('/api/events', { productId: pid, type: 'view' });
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM product_events WHERE product_id = ?').get(pid).n, 0);
    await aVisitor.post('/api/events', { productId: pid, type: 'view' });
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM product_events WHERE product_id = ?').get(pid).n, 1);
    // Hidden: off A's catalog, back when shown.
    assert.equal((await aOwner.post(`/api/workspace/products/${pid}/hide`)).body.product.status, 'archived');
    assert.deepEqual((await aVisitor.get('/api/catalog')).body.products, []);
    assert.equal((await aOwner.post(`/api/workspace/products/${pid}/show`)).body.product.status, 'published');
    void B;
  } finally {
    await t.close();
  }
});

test('the workspace and the team are the showroom’s own', async () => {
  const t = await startTestServer();
  try {
    const { A, B, aOwner, bOwner, aVisitor } = await world(t);
    assert.equal((await aVisitor.get('/api/workspace/showroom')).status, 403);
    assert.equal((await aVisitor.get('/api/workspace/showroom')).body.code, 'not_staff');
    const mine = await aOwner.get('/api/workspace/showroom');
    assert.equal(mine.body.tenant.id, A.id);
    assert.equal(mine.body.role, 'owner');
    const bMembers = (await bOwner.get('/api/workspace/team')).body.members;
    assert.equal((await aOwner.delete(`/api/workspace/team/${bMembers[0].userId}`)).status, 404);
    assert.equal((await aOwner.patch(`/api/workspace/team/${bMembers[0].userId}`, { role: 'staff' })).status, 404);
    // Inviting B's owner's address onto A makes a separate A account; B's account is untouched.
    const inv = await aOwner.post('/api/workspace/team', { email: bOwner.user.email, role: 'staff' });
    assert.equal(inv.status, 201);
    assert.notEqual(inv.body.member.userId, bOwner.id);
    assert.ok(inv.body.invite.url.startsWith(`http://alpha.localhost:${t.port}/#/signin?reset=`));
    assert.equal(t.ctx.services.tenants.roleOf(B.id, bOwner.id), 'owner');
    // Staff can't manage the team; the last owner can't be removed or demoted.
    const staffId = inv.body.member.userId;
    assert.equal((await aOwner.delete(`/api/workspace/team/${aOwner.id}`)).status, 409);
    assert.equal((await aOwner.patch(`/api/workspace/team/${aOwner.id}`, { role: 'staff' })).status, 409);
    assert.equal((await aOwner.patch(`/api/workspace/team/${staffId}`, { role: 'staff' })).status, 200);
    // Settings are owner-only; branding is anyone on the team.
    t.ctx.services.tenants.setMemberRole(A.id, staffId, 'staff');
    const patched = await aOwner.patch('/api/workspace/showroom', { branding: { primaryColor: '#123456', welcomeTitle: 'Welcome' }, settings: { fillGaps: true } });
    assert.equal(patched.status, 200, patched.text);
    assert.equal(patched.body.tenant.branding.primaryColor, '#123456');
    assert.equal(patched.body.tenant.settings.fillGaps, true);
    assert.equal(t.ctx.services.tenants.get(B.id).settings.fillGaps, false);
  } finally {
    await t.close();
  }
});

test('modules that answer on showrooms are exactly the scoped ones; every other route is a 404 there', async () => {
  const t = await startTestServer();
  try {
    const { aOwner } = await world(t);
    assert.deepEqual([...SHOWROOM_MODULES].sort(), ['account', 'auth', 'catalog', 'config', 'events', 'files', 'ops', 'projects', 'share', 'tenants', 'tenants-admin', 'tenants-billing', 'tenants-leads'].sort());
    const fill = (p) => p.replace(/:([A-Za-z_]+)/g, 'nobody_here');
    for (const r of t.ctx.routes) {
      if (r.hosts !== 'sales') continue;
      const res = await aOwner.request(r.method, fill(r.path), { body: r.method === 'GET' ? undefined : {} });
      assert.ok(res.status === 404 || (res.status === 405 && !String(res.headers.get('allow')).split(', ').includes(r.method)), `${r.method} ${r.path} on a showroom: ${res.status}`);
    }
    // Admin and studio routes are sales-only whatever module they're in.
    for (const r of t.ctx.routes) if (r.auth === 'admin' || r.auth === 'studio') assert.equal(r.hosts, 'sales', `${r.method} ${r.path}`);
  } finally {
    await t.close();
  }
});
