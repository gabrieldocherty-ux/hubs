// A showroom's pictures (server/tenancy/images.mjs, routes in server/routes/tenants.mjs): the team
// or an admin's generator ticket uploads renders; the team uploads photos, which win over renders;
// visitors get them in the public tenant; nothing crosses to another showroom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.mjs';
import { makePng } from '../lib/synth.mjs';
import { cleanTarget, lineKey, publicImages, withImage, withoutImage } from '../tenancy/images.mjs';

const png = (w, h, c = [200, 180, 150]) => makePng({ w, h, rgba: () => [...c, 255] });

test('showroom images: targets, photo over render, the tall hero only without a hero photo', () => {
  assert.throws(() => cleanTarget({ slot: 'banner' }), /Choose where/);
  assert.throws(() => cleanTarget({ slot: 'gallery', index: 4 }), /numbered 1 to 3/);
  assert.throws(() => cleanTarget({ slot: 'gallery', index: 1, source: 'photo' }), /main picture and for product lines/);
  assert.throws(() => cleanTarget({ slot: 'line' }), /Name the product line/);
  assert.deepEqual(cleanTarget({ slot: 'line', line: '  Lakeshore   Shaker ' }), { slot: 'line', source: 'render', line: 'Lakeshore Shaker' });
  assert.equal(lineKey('Lakeshore Shaker (Demo)'), 'lakeshore shaker');

  const img = (id) => ({ fileId: id, w: 1600, h: 900, at: 1 });
  let im = withImage({}, cleanTarget({ slot: 'hero' }), img('f_r1'));
  im = withImage(im, cleanTarget({ slot: 'heroTall' }), img('f_r2'));
  im = withImage(im, cleanTarget({ slot: 'line', line: 'Lakeshore Shaker' }), img('f_r3'));
  im = withImage(im, cleanTarget({ slot: 'gallery', index: 2, title: 'Sage island kitchen' }), img('f_r4'));
  const files = { url: (id) => `/files/${id}.webp` };
  let pub = publicImages(im, files);
  assert.equal(pub.hero.url, '/files/f_r1.webp');
  assert.equal(pub.hero.source, 'render');
  assert.equal(pub.heroTall.url, '/files/f_r2.webp');
  assert.equal(pub.lines['lakeshore shaker'].line, 'Lakeshore Shaker');
  assert.deepEqual(pub.gallery.map((g) => g.title), ['Sage island kitchen'], 'empty gallery places are skipped');

  im = withImage(im, cleanTarget({ slot: 'hero', source: 'photo' }), img('f_p1'));
  im = withImage(im, cleanTarget({ slot: 'line', line: 'lakeshore shaker', source: 'photo' }), img('f_p2'));
  pub = publicImages(im, files);
  assert.equal(pub.hero.url, '/files/f_p1.webp', 'a photo wins');
  assert.equal(pub.hero.source, 'photo');
  assert.equal(pub.heroTall, null, 'phones show the same photo, not a different render');
  assert.equal(pub.lines['lakeshore shaker'].url, '/files/f_p2.webp');

  im = withoutImage(im, cleanTarget({ slot: 'hero', source: 'photo' }));
  assert.equal(publicImages(im, files).hero.url, '/files/f_r1.webp', 'removing the photo brings the render back');
});

test('showroom images: who may upload, what visitors get, and isolation', async () => {
  const t = await startTestServer();
  try {
    const a = t.tenant({ name: 'Acme Kitchens', slug: 'acme' });
    const b = t.tenant({ name: 'Birch Bath', slug: 'birch' });
    const staff = await t.showroomUser(a, { role: 'staff' });
    const visitor = await t.showroomUser(a);
    const bStaff = await t.showroomUser(b, { role: 'owner' });
    const q = (o) => `/api/showroom-images?${new URLSearchParams(o)}`;

    // Nobody but the team (or a ticket).
    assert.equal((await t.agent({ host: a.host }).get('/api/showroom-images/access')).status, 403);
    assert.equal((await visitor.putRaw(q({ slot: 'hero' }), png(800, 450), 'image/png')).status, 403);
    assert.equal((await t.agent().putRaw(q({ slot: 'hero' }), png(800, 450), 'image/png')).status, 404, 'not on the sales site');
    assert.equal((await staff.get('/api/showroom-images/access')).body.via, 'staff');

    // Bad pictures.
    assert.equal((await staff.putRaw(q({ slot: 'hero' }), Buffer.from('<svg/>'), 'image/svg+xml')).status, 400);
    assert.equal((await staff.putRaw(q({ slot: 'hero' }), png(100, 100), 'image/png')).status, 400, 'too small');
    assert.equal((await staff.putRaw(q({ slot: 'gallery', index: '9' }), png(800, 450), 'image/png')).status, 400);

    let r = await staff.putRaw(q({ slot: 'hero' }), png(1200, 675), 'image/png');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.images.hero.w, 1200);
    assert.equal(r.body.images.hero.h, 675);
    r = await staff.putRaw(q({ slot: 'line', line: 'Lakeshore Shaker' }), png(800, 600), 'image/png');
    r = await staff.putRaw(q({ slot: 'gallery', index: '1', title: 'Sage shaker kitchen' }), png(800, 500), 'image/png');
    assert.equal(r.status, 200, r.text);

    // Visitors see them in the public tenant, and the files open on this showroom only.
    const cfg = (await t.agent({ host: a.host }).get('/api/config')).body;
    assert.equal(cfg.tenant.images.hero.source, 'render');
    assert.equal(cfg.tenant.images.gallery[0].title, 'Sage shaker kitchen');
    assert.equal(cfg.tenant.images.lines['lakeshore shaker'].w, 800);
    assert.equal((await t.agent({ host: a.host }).get(cfg.tenant.images.hero.url)).status, 200);
    assert.equal((await t.agent({ host: b.host }).get(cfg.tenant.images.hero.url)).status, 404, 'never on another showroom');
    assert.equal((await t.agent().get(cfg.tenant.images.hero.url)).status, 404, 'nor on the sales site');
    assert.equal((await t.agent({ host: b.host }).get('/api/config')).body.tenant.images.hero, null);
    // Another showroom's team can't touch it.
    assert.equal((await bStaff.request('DELETE', q({ slot: 'hero', source: 'render' }))).status, 200, 'deletes its own (nothing)');
    assert.ok((await t.agent({ host: a.host }).get('/api/config')).body.tenant.images.hero);

    // A photo wins; removing it brings the render back.
    r = await staff.putRaw(q({ slot: 'hero', source: 'photo' }), png(1600, 900, [90, 90, 90]), 'image/png');
    assert.equal(r.body.images.hero.source, 'photo');
    assert.equal(r.body.imageSources.render.hero.source, 'render');
    r = await staff.request('DELETE', q({ slot: 'hero', source: 'photo' }));
    assert.equal(r.status, 200);
    assert.equal(r.body.images.hero.source, 'render');

    // An admin's ticket: renders only, this showroom only, and it says where to open.
    const admin = await t.user({ role: 'admin' });
    assert.equal((await staff.post(`/api/admin/tenants/${a.id}/showroom-images`)).status, 404, 'admin routes are not on a showroom');
    const tk = await admin.post(`/api/admin/tenants/${a.id}/showroom-images`);
    assert.equal(tk.status, 200, tk.text);
    const url = new URL(tk.body.url.replace('#/', ''));
    assert.equal(url.host, a.host);
    const ticket = url.searchParams.get('ticket');
    assert.ok(ticket && ticket.length >= 40);
    const withTicket = (host) => ({ headers: { 'X-Showroom-Ticket': ticket } });
    const anon = t.agent({ host: a.host });
    assert.equal((await anon.request('GET', '/api/showroom-images/access', withTicket())).body.via, 'ticket');
    assert.equal((await anon.putRaw(q({ slot: 'heroTall' }), png(900, 1200), 'image/png', withTicket())).status, 200);
    assert.equal((await anon.putRaw(q({ slot: 'hero', source: 'photo' }), png(900, 600), 'image/png', withTicket())).status, 403, 'photos are the team’s');
    assert.equal((await t.agent({ host: b.host }).putRaw(q({ slot: 'hero' }), png(900, 600), 'image/png', withTicket())).status, 403, 'good for one showroom');
    assert.equal((await anon.request('DELETE', q({ slot: 'hero' }), withTicket())).status, 401, 'deleting is the team’s');
    const audit = t.db.prepare("SELECT action FROM admin_audit WHERE action = 'tenant_images_ticket'").all();
    assert.equal(audit.length, 1);
  } finally {
    await t.close();
  }
});
