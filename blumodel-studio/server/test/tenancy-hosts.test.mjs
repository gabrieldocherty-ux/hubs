// Tenants and host resolution (docs/SHOWROOM_PIVOT.md §4, docs/handoff/tenancy.md): the sales
// site, showrooms by subdomain and custom domain, unknown hosts, unavailable showrooms, and the
// admin's tenant API.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { createSiteResolver, hostnameOf } from '../tenancy/hosts.mjs';
import { slugify } from '../tenancy/service.mjs';

test('hostnameOf strips ports, brackets and trailing dots', () => {
  assert.equal(hostnameOf('Acme.Localhost:8900'), 'acme.localhost');
  assert.equal(hostnameOf('[::1]:80'), '::1');
  assert.equal(hostnameOf('blumodel.studio.'), 'blumodel.studio');
  assert.equal(hostnameOf(''), '');
  assert.equal(slugify('Acme Kitchens & Bath Ltd.'), 'acme-kitchens-bath-ltd');
  assert.equal(slugify('Électro Ménager'), 'electro-menager');
});

test('the sales site, a showroom by subdomain, and an unknown host', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const created = await admin.post('/api/admin/tenants', { name: 'Acme Kitchens', ownerEmail: 'owner@acme.test', ownerName: 'Ana Owner' });
    assert.equal(created.status, 201, created.text);
    const tn = created.body.tenant;
    assert.equal(tn.slug, 'acme-kitchens');
    assert.equal(tn.status, 'setup');
    assert.deepEqual(
      tn.hostnames.map((h) => [h.hostname, h.kind, h.primary]),
      [['acme-kitchens.localhost', 'subdomain', true]],
    );
    assert.equal(tn.members.length, 1);
    assert.equal(tn.members[0].role, 'owner');
    // The owner's set-your-password link is on their showroom's own address.
    assert.match(created.body.invite.url, new RegExp(`^http://acme-kitchens\\.localhost:${t.port}/#/signin\\?reset=[A-Za-z0-9_-]{43}$`));

    const sales = await t.agent().get('/api/config');
    assert.equal(sales.body.site, 'sales');
    assert.equal(sales.body.tenant, null);
    assert.equal(sales.body.baseDomain, 'localhost');

    const shop = t.agent({ host: t.hostFor('acme-kitchens') });
    const cfg = await shop.get('/api/config');
    assert.equal(cfg.status, 200);
    assert.equal(cfg.body.site, 'showroom');
    assert.equal(cfg.body.tenant.name, 'Acme Kitchens');
    assert.equal(cfg.body.tenant.url, `http://acme-kitchens.localhost:${t.port}`);
    assert.equal((await shop.get('/api/showroom')).body.tenant.slug, 'acme-kitchens');

    // Admin APIs don't exist on a showroom, whoever asks.
    assert.equal((await shop.get('/api/admin/tenants')).status, 404);

    const nowhere = t.agent({ host: `nobody.localhost:${t.port}` });
    const r = await nowhere.get('/api/config');
    assert.equal(r.status, 404);
    assert.equal(r.body.code, 'unknown_host');
    const page = await nowhere.get('/');
    assert.equal(page.status, 404);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(page.text, /no showroom at this address/i);
    // Two labels under the base domain is not a showroom either.
    assert.equal((await t.agent({ host: `a.acme-kitchens.localhost:${t.port}` }).get('/api/config')).status, 404);
  } finally {
    await t.close();
  }
});

test('slugs: reserved, taken, made from the name', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    assert.equal((await admin.post('/api/admin/tenants', { name: 'X', slug: 'www' })).status, 400);
    assert.equal((await admin.post('/api/admin/tenants', { name: 'X', slug: 'Bad Slug' })).status, 400);
    assert.equal((await admin.post('/api/admin/tenants', { name: 'Northline', slug: 'northline' })).status, 201);
    const dup = await admin.post('/api/admin/tenants', { name: 'Northline 2', slug: 'northline' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'slug_taken');
    const auto = await admin.post('/api/admin/tenants', { name: 'Northline' });
    assert.equal(auto.body.tenant.slug, 'northline-2');
    const reservedName = await admin.post('/api/admin/tenants', { name: 'Admin' });
    assert.equal(reservedName.body.tenant.slug, 'admin-showroom');
  } finally {
    await t.close();
  }
});

test('an extra subdomain reserves its slug: a later company with that slug is refused, never served the other showroom', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const bravo = (await admin.post('/api/admin/tenants', { name: 'Bravo Bath', slug: 'bravo' })).body.tenant;
    const alias = await admin.post(`/api/admin/tenants/${bravo.id}/hostnames`, { hostname: 'delta.localhost', kind: 'subdomain' });
    assert.equal(alias.status, 201);
    const delta = await admin.post('/api/admin/tenants', { name: 'Delta Design', slug: 'delta' });
    assert.equal(delta.status, 409);
    assert.equal(delta.body.code, 'slug_taken');
    // A slug made from the name skips it too.
    const auto = await admin.post('/api/admin/tenants', { name: 'Delta' });
    assert.equal(auto.status, 201);
    assert.equal(auto.body.tenant.slug, 'delta-2');
    assert.equal(t.db.prepare('SELECT tenant_id FROM tenant_hostnames WHERE hostname = ?').get('delta-2.localhost').tenant_id, auto.body.tenant.id);
    assert.equal((await t.agent({ host: t.hostFor('delta-2') }).get('/api/showroom')).body.tenant.name, 'Delta');
  } finally {
    await t.close();
  }
});

test('a suspended showroom is temporarily unavailable; data is kept', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const id = (await admin.post('/api/admin/tenants', { name: 'Pause Co', slug: 'pause', contact: { phone: '519-555-0100' } })).body.tenant.id;
    const s = await admin.post(`/api/admin/tenants/${id}/status`, { status: 'suspended', note: 'Asked to pause' });
    assert.equal(s.body.tenant.status, 'suspended');
    const shop = t.agent({ host: t.hostFor('pause') });
    const cfg = await shop.get('/api/config');
    assert.equal(cfg.status, 200);
    assert.equal(cfg.body.tenant.status, 'suspended');
    const api = await shop.get('/api/showroom');
    assert.equal(api.status, 503);
    assert.equal(api.body.code, 'showroom_unavailable');
    assert.equal(api.body.status, 'suspended');
    assert.equal((await shop.post('/api/auth/login', { email: 'a@b.c', password: 'x' })).status, 503);
    const page = await shop.get('/');
    assert.equal(page.status, 503);
    assert.match(page.text, /Pause Co’s online showroom is temporarily unavailable/);
    assert.match(page.text, /519-555-0100/);
    assert.equal((await shop.get('/api/health')).status, 200);
    // Restored: reachable again (it lapses at once without a license and a paid monthly plan).
    const back = await admin.post(`/api/admin/tenants/${id}/status`, { status: 'setup' });
    assert.equal(back.body.tenant.status, 'setup');
    assert.equal((await shop.get('/api/showroom')).status, 200);
    const audit = t.db.prepare("SELECT action FROM admin_audit WHERE action LIKE 'tenant_%' ORDER BY id").all().map((r) => r.action);
    assert.deepEqual(audit, ['tenant_create', 'tenant_status', 'tenant_status']);
  } finally {
    await t.close();
  }
});

test('custom domains reach the showroom only once verified; hosts are unique', async () => {
  const t = await startTestServer();
  try {
    const admin = await t.user({ role: 'admin' });
    const a = (await admin.post('/api/admin/tenants', { name: 'A Co', slug: 'aco' })).body.tenant;
    const b = (await admin.post('/api/admin/tenants', { name: 'B Co', slug: 'bco' })).body.tenant;
    const add = await admin.post(`/api/admin/tenants/${a.id}/hostnames`, { hostname: 'https://Showroom.ACo-Kitchens.ca/' });
    assert.equal(add.status, 201, add.text);
    assert.deepEqual(add.body.hostname, { hostname: 'showroom.aco-kitchens.ca', kind: 'custom', verified: false, primary: false, createdAt: add.body.hostname.createdAt });
    const custom = t.agent({ host: 'showroom.aco-kitchens.ca' });
    assert.equal((await custom.get('/api/config')).status, 404);
    await admin.patch(`/api/admin/tenants/${a.id}/hostnames/showroom.aco-kitchens.ca`, { verified: true, primary: true });
    const cfg = await custom.get('/api/config');
    assert.equal(cfg.body.tenant.slug, 'aco');
    assert.equal(cfg.body.tenant.url, 'https://showroom.aco-kitchens.ca');
    // Another tenant can't take it, nor the sales site's own name, nor another's subdomain.
    assert.equal((await admin.post(`/api/admin/tenants/${b.id}/hostnames`, { hostname: 'showroom.aco-kitchens.ca' })).status, 409);
    assert.equal((await admin.post(`/api/admin/tenants/${b.id}/hostnames`, { hostname: 'localhost.test' })).status, 201);
    assert.equal((await admin.post(`/api/admin/tenants/${b.id}/hostnames`, { hostname: 'aco.localhost', kind: 'subdomain' })).status, 409);
    // The own subdomain can't be removed; a custom one can.
    assert.equal((await admin.delete(`/api/admin/tenants/${a.id}/hostnames/aco.localhost`)).status, 409);
    assert.equal((await admin.delete(`/api/admin/tenants/${a.id}/hostnames/showroom.aco-kitchens.ca`)).status, 200);
    assert.equal((await custom.get('/api/config')).status, 404);
  } finally {
    await t.close();
  }
});

test('X-Forwarded-Host never picks the site, not even from a trusted loopback proxy', async () => {
  for (const env of [{}, { TRUST_PROXY: '1' }]) {
    const t = await startTestServer({ env });
    try {
      t.ctx.services.tenants.create({ name: 'Fwd', slug: 'fwd' });
      const spoof = await t.agent().get('/api/config', { headers: { 'X-Forwarded-Host': 'fwd.localhost' } });
      assert.equal(spoof.body.site, 'sales');
      // The showroom's own Host does, and its links come from the database, not the request.
      const r = await t.agent({ host: t.hostFor('fwd') }).get('/api/config', { headers: { 'X-Forwarded-Host': 'evil.example' } });
      assert.equal(r.body.site, 'showroom');
      assert.ok(!r.text.includes('evil.example'));
    } finally {
      await t.close();
    }
  }
});

test('the resolver: production base domain, www, IPs and localhost are the sales site', () => {
  const tenants = { byHostname: () => null, bySlug: (s) => (s === 'acme' ? { id: 't1', slug: 'acme', status: 'setup' } : null), refresh: (id) => ({ id, status: 'setup' }), isAvailable: () => true };
  const r = createSiteResolver({ tenants, config: { BASE_DOMAIN: 'blumodel.studio', PUBLIC_URL: 'https://blumodel.studio' } });
  for (const h of ['blumodel.studio', 'www.blumodel.studio', 'localhost', '127.0.0.1', '192.168.1.20', '::1', '']) assert.equal(r.classify(h).kind, 'sales', h);
  assert.equal(r.classify('acme.blumodel.studio').kind, 'showroom');
  assert.equal(r.classify('acme.blumodel.studio').tenantId, 't1');
  assert.equal(r.classify('other.blumodel.studio').kind, 'unknown');
  assert.equal(r.classify('acme.localhost').kind, 'unknown');
  assert.equal(r.classify('blumodel.studio.evil.com').kind, 'unknown');
});
