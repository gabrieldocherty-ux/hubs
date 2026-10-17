// server/ops/sites.mjs: the deploy's after-check that the server answers as the sales site, the
// demo showroom and a 404 by Host, and that cloudflared.yml sends every kind of host to it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { DEMO_SLUG, NO_SUCH_SHOWROOM, checkSites, getWithHost, tunnelGaps } from '../ops/sites.mjs';
import { tunnelConfigYaml, tunnelRoutes } from '../../scripts/tunnel/tunnel.mjs';

/** A stand-in server: /api/config answered by Host the way server/tenancy/hosts.mjs does. */
const fakeGet = ({ base = 'blumodel.studio', demo = true, wwwAs = 'sales' } = {}) => {
  const asked = [];
  const get = async (port, path, host) => {
    asked.push({ port, path, host });
    if (host === '127.0.0.1' || host === base) return { status: 200, body: { site: 'sales', tenant: null, baseDomain: base } };
    if (host === `www.${base}`) return { status: 200, body: { site: wwwAs, tenant: null, baseDomain: base } };
    if (host === `${DEMO_SLUG}.${base}` && demo) return { status: 200, body: { site: 'showroom', tenant: { name: 'Northline Kitchen & Bath (Demo)', status: 'live' }, baseDomain: base } };
    return { status: 404, body: { error: 'not_found' } };
  };
  return { get, asked };
};

test('checkSites: the base domain and www are the sales site, demo.<base> the demo showroom, an unknown slug a 404', async () => {
  const f = fakeGet();
  const r = await checkSites({ port: 8938, get: f.get });
  assert.equal(r.ok, true, JSON.stringify(r.lines));
  assert.equal(r.baseDomain, 'blumodel.studio');
  assert.deepEqual(f.asked.map((a) => a.host), ['127.0.0.1', 'blumodel.studio', 'www.blumodel.studio', 'demo.blumodel.studio', `${NO_SUCH_SHOWROOM}.blumodel.studio`]);
  assert.ok(f.asked.every((a) => a.port === 8938 && a.path === '/api/config'));
  assert.match(r.lines[2].text, /demo\.blumodel\.studio: the showroom of Northline Kitchen & Bath \(Demo\) \(live\)/);
});

test('checkSites follows the server’s own base domain (a custom BASE_DOMAIN, read from /api/config, never from blumodel.env)', async () => {
  const f = fakeGet({ base: 'showrooms.example.ca' });
  const r = await checkSites({ port: 1, get: f.get });
  assert.equal(r.ok, true);
  assert.equal(r.baseDomain, 'showrooms.example.ca');
  assert.ok(f.asked.some((a) => a.host === 'demo.showrooms.example.ca'));
});

test('checkSites: no demo showroom is a note (with the seed command); www answering as a showroom is a fault; an old server is a fault', async () => {
  const noDemo = await checkSites({ port: 1, get: fakeGet({ demo: false }).get });
  assert.equal(noDemo.ok, true);
  const note = noDemo.lines.find((l) => l.note);
  assert.match(note.text, /no demo showroom yet.*seed-demo-tenant\.mjs/);
  const wrong = await checkSites({ port: 1, get: fakeGet({ wwwAs: 'showroom' }).get });
  assert.equal(wrong.ok, false);
  assert.match(wrong.lines.find((l) => !l.ok).text, /www\.blumodel\.studio: the showroom site \(expected the sales site\)/);
  const old = await checkSites({ port: 1, get: async () => ({ status: 200, body: { payments: 'none' } }) });
  assert.deepEqual([old.ok, old.baseDomain], [false, null]);
  const down = await checkSites({ port: 1, get: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal(down.ok, false);
});

test('getWithHost sends the Host header it is given to 127.0.0.1 (a real local socket)', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push(req.headers.host);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ host: req.headers.host }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const port = /** @type {any} */ (srv.address()).port;
    const r = await getWithHost(port, '/api/config', 'demo.blumodel.studio');
    assert.deepEqual(r, { status: 200, body: { host: 'demo.blumodel.studio' } });
    assert.deepEqual(seen, ['demo.blumodel.studio']);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('tunnelGaps: nothing for the generated config; a pre-showroom config is told to rerun setup-tunnel and restart the tunnel', () => {
  const file = '/srv/blumodel-studio/cloudflared.yml';
  const good = tunnelConfigYaml({ credentials: '/x.json' });
  assert.deepEqual(tunnelGaps({ file, baseDomain: 'blumodel.studio', routes: tunnelRoutes(good, 'blumodel.studio') }), []);
  const old = 'tunnel: x\ningress:\n  - hostname: blumodel.studio\n    service: http://127.0.0.1:8790\n  - service: http_status:404\n';
  const gaps = tunnelGaps({ file, baseDomain: 'blumodel.studio', routes: tunnelRoutes(old, 'blumodel.studio'), rerun: 'node scripts/tunnel/setup-tunnel.mjs --home /srv/blumodel-studio --validate' });
  assert.equal(gaps.length, 2);
  assert.match(gaps[0], /does not send www\.blumodel\.studio, \*\.blumodel\.studio \(every showroom\) to this server/);
  assert.match(gaps[1], /setup-tunnel\.mjs --home \/srv\/blumodel-studio --validate, then restart the tunnel/);
  // A config made for another base domain is missing everything for this one... except via the catch-all.
  const other = tunnelConfigYaml({ credentials: '/x.json', hostname: 'other.example', customDomains: false });
  assert.match(tunnelGaps({ file, baseDomain: 'blumodel.studio', routes: tunnelRoutes(other, 'blumodel.studio') })[0], /does not send blumodel\.studio, www\.blumodel\.studio, \*\.blumodel\.studio/);
});

test('checkSites against the real app (BASE_DOMAIN localhost): sales on localhost and www.localhost, a live demo showroom, a 404 for an unknown slug; suspended reads as a showroom still', async () => {
  const { startTestServer } = await import('./helpers.mjs');
  const t = await startTestServer();
  try {
    const before = await checkSites({ port: t.port });
    assert.equal(before.ok, true, JSON.stringify(before.lines));
    assert.equal(before.baseDomain, 'localhost');
    assert.ok(before.lines.some((l) => l.note && /no demo showroom yet/.test(l.text)));
    const demo = t.tenant({ name: 'Northline Kitchen & Bath (Demo)', slug: DEMO_SLUG });
    const after = await checkSites({ port: t.port });
    assert.equal(after.ok, true, JSON.stringify(after.lines));
    assert.match(after.lines.map((l) => l.text).join('\n'), /demo\.localhost: the showroom of Northline Kitchen & Bath \(Demo\) \(live\)/);
    assert.match(after.lines.at(-1).text, /an unknown showroom: HTTP 404$/);
    t.services.tenants.setStatus(demo.id, 'suspended');
    const off = await checkSites({ port: t.port });
    assert.match(off.lines.map((l) => l.text).join('\n'), /demo\.localhost: the showroom of .* \(suspended\)/, '/api/config still answers on a suspended showroom');
  } finally {
    await t.close();
  }
});
