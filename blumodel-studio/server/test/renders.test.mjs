// Photoreal AI renders (docs/SHOWROOM_PIVOT.md §7, docs/handoff/renders.md): not set up = nothing
// charged; credits reserved, then charged on success and released on failure or timeout; the
// architect adapter's request and every answer shape (fetch is always mocked); the visitor switch
// and daily cap; upload limits; one render at a time; isolation between showrooms; admin refunds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { Agent, sampleDoc, startTestServer } from './helpers.mjs';
import { makeJpeg, makePng } from '../lib/synth.mjs';
import { decodePng, encodePng } from '../renders/png.mjs';
import { cleanScene, scenePrompt } from '../renders/scene.mjs';
import { imageFromJson } from '../renders/providers.mjs';

const KEY = 'arch_FAKE_FOR_TESTS';
const URL_ = 'https://architect.example/v1/render';
const ARCH = { ARCHITECT_AI_URL: URL_, ARCHITECT_AI_KEY: KEY };

/** A 320×180 gradient PNG, base64: the "captured 3D view". */
const view = (w = 320, h = 180) => makePng({ w, h, rgba: (x, y) => [(x * 255) / w, (y * 255) / h, 160, 255] }).toString('base64');
const SCENE = {
  room: { kind: 'kitchen', widthIn: 200, lengthIn: 156, ceilingIn: 108 },
  style: 'Modern farmhouse',
  finishes: { cabinets: 'Navy', doorStyle: 'Shaker', countertop: 'Quartz', flooring: 'Oak' },
  products: [{ name: 'Lakeshore Shaker base 30″', brand: 'Northline', category: 'cabinets', finish: 'Navy', count: 3 }],
  camera: { view: 'current', widthPx: 320, heightPx: 180 },
};

/** A showroom with $25 of credits, an owner, a staff member, a visitor with a saved design. */
async function world(t, { slug = 'acme', credits = true, settings } = {}) {
  const tn = t.tenant({ name: `${slug} Kitchens`, slug, settings });
  if (credits) t.services.credits.grantMonth(tn.id, `in_${slug}`);
  const owner = await t.showroomUser(tn, { role: 'owner' });
  const staff = await t.showroomUser(tn, { role: 'staff' });
  const visitor = await t.showroomUser(tn);
  const vp = await visitor.post('/api/projects', { name: 'Visitor kitchen', doc: sampleDoc({ name: 'Visitor kitchen' }) });
  assert.equal(vp.status, 201);
  const sp = await staff.post('/api/projects', { name: 'Staff kitchen', doc: sampleDoc({ name: 'Staff kitchen' }) });
  return { tn, owner, staff, visitor, visitorProject: vp.body.project.id, staffProject: sp.body.project.id };
}

const ledger = (t, tenantId) => t.db.prepare('SELECT kind, cents FROM tenant_credit_entries WHERE tenant_id = ? ORDER BY id').all(tenantId).map((r) => `${r.kind}:${r.cents}`);

test('not set up: the status says so, a render answers 503 and nothing is charged or stored', async () => {
  const t = await startTestServer({ env: { RENDER_PROVIDER: 'off' } });
  try {
    const w = await world(t);
    const st = await w.staff.get('/api/renders/status');
    assert.equal(st.status, 200);
    assert.equal(st.body.configured, false);
    assert.equal(st.body.reason, 'not_configured');
    assert.equal(st.body.canRender, false);
    const before = ledger(t, w.tn.id);
    const r = await w.staff.post('/api/renders', { projectId: w.staffProject, image: view(), scene: SCENE });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, 'renders_not_configured');
    assert.deepEqual(ledger(t, w.tn.id), before, 'no ledger entries');
    assert.equal(t.services.credits.balance(w.tn.id), 2500);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM showroom_renders').get().n, 0);
    // In production without ARCHITECT_AI_* (and no DEMO_RENDERS) there is no provider either.
    const { loadConfig } = await import('../config.mjs');
    assert.equal(loadConfig({ DB_PATH: ':memory:' }, ['--prod']).rendersProvider, 'none');
    assert.equal(loadConfig({ DB_PATH: ':memory:', DEMO_RENDERS: '1' }, ['--prod']).rendersProvider, 'demo');
    assert.equal(loadConfig({ DB_PATH: ':memory:', ...ARCH }, ['--prod']).rendersProvider, 'architect');
    assert.equal(loadConfig({ DB_PATH: ':memory:', ARCHITECT_AI_URL: URL_ }, ['--prod']).rendersProvider, 'none', 'a URL without a key is not set up');
    assert.equal(loadConfig({ DB_PATH: ':memory:' }, []).rendersProvider, 'demo', 'development uses the demo');
    assert.throws(() => loadConfig({ DB_PATH: ':memory:', ARCHITECT_AI_URL: 'ftp://x' }, []), /ARCHITECT_AI_URL/);
  } finally {
    await t.close();
  }
});

test('demo provider: reserve, then charge; the result is a stamped PNG of the captured view', async () => {
  const t = await startTestServer({ env: { RENDER_PROVIDER: 'demo' } });
  try {
    const w = await world(t);
    const st = await w.staff.get('/api/renders/status');
    assert.equal(st.body.configured, true);
    assert.equal(st.body.demo, true);
    assert.equal(st.body.canRender, true);
    assert.equal(st.body.costCents, 25);
    assert.equal(st.body.balanceCents, 2500);
    const r = await w.staff.post('/api/renders', { projectId: w.staffProject, image: view(), scene: SCENE });
    assert.equal(r.status, 202, r.text);
    assert.equal(r.body.render.status, 'pending');
    await t.services.renders.settled();
    const g = await w.staff.get(`/api/renders/${r.body.render.id}`);
    assert.equal(g.body.render.status, 'done');
    assert.equal(g.body.render.demo, true);
    assert.equal(g.body.render.width, 320);
    assert.equal(g.body.render.scene.finishes.cabinets, 'Navy');
    assert.equal(g.body.render.scene.showroom, 'acme Kitchens');
    const img = await w.staff.get(g.body.render.imageUrl);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.match(img.headers.get('cache-control'), /no-store/);
    const px = decodePng(img.buffer);
    assert.ok(px, 'a decodable PNG');
    assert.equal(px.width, 320);
    // The stamp's band along the bottom is dark, with white letters in it.
    const at = (x, y) => [...px.rgba.subarray((y * px.width + x) * 4, (y * px.width + x) * 4 + 3)];
    assert.ok(at(2, 178).every((c) => c < 90), `band ${at(2, 178)}`);
    let white = 0;
    for (let y = 150; y < 180; y++) for (let x = 0; x < 320; x++) if (at(x, y).every((c) => c === 255)) white++;
    assert.ok(white > 50, `letters ${white}`);
    const input = await w.staff.get(g.body.render.inputUrl);
    assert.equal(input.status, 200);
    assert.equal(t.services.credits.balance(w.tn.id), 2475);
    assert.deepEqual(ledger(t, w.tn.id), ['grant:2500', 'reserve:-25', 'charge:0']);
    // The gallery for the design, and the workspace page.
    const list = await w.staff.get(`/api/renders?projectId=${w.staffProject}`);
    assert.deepEqual(list.body.renders.map((x) => x.id), [r.body.render.id]);
    const ws = await w.owner.get('/api/workspace/renders');
    assert.equal(ws.status, 200);
    assert.equal(ws.body.usage.thisMonth, 1);
    assert.equal(ws.body.usage.spentThisMonthCents, 25);
    assert.equal(ws.body.renders[0].byName.length > 0, true);
    // A JPEG can't be decoded here: the demo answers with a stamped card instead.
    const j = await w.staff.post('/api/renders', { projectId: w.staffProject, image: makeJpeg({ w: 640, h: 360 }).toString('base64'), scene: { ...SCENE, camera: { widthPx: 640, heightPx: 360 } } });
    assert.equal(j.status, 202, j.text);
    await t.services.renders.settled();
    assert.equal((await w.staff.get(`/api/renders/${j.body.render.id}`)).body.render.width, 640);
  } finally {
    await t.close();
  }
});

test('architect adapter: the request it sends, the answer shapes it takes, and the key stays out of everything', async () => {
  const calls = [];
  let answer = () => new Response(makePng({ w: 400, h: 225 }), { headers: { 'Content-Type': 'image/png' } });
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return answer(init);
  };
  const t = await startTestServer({ env: ARCH, fetch });
  try {
    const w = await world(t);
    const r = await w.staff.post('/api/renders', { projectId: w.staffProject, image: view(), scene: SCENE });
    assert.equal(r.status, 202, r.text);
    await t.services.renders.settled();
    assert.equal(calls.length, 1);
    const c = calls[0];
    assert.equal(c.url, URL_);
    assert.equal(c.init.method, 'POST');
    assert.equal(c.init.headers.Authorization, `Bearer ${KEY}`);
    const body = JSON.parse(c.init.body);
    assert.equal(body.requestId, r.body.render.id);
    assert.equal(body.image.mimeType, 'image/png');
    assert.equal(body.image.data, view());
    assert.match(body.prompt, /photorealistic/i);
    assert.match(body.prompt, /Navy/);
    assert.match(body.prompt, /3 × Lakeshore Shaker base/);
    assert.equal(body.scene.room.widthIn, 200);
    assert.ok(!c.init.body.includes(KEY), 'the key is only in the header');
    const g = await w.staff.get(`/api/renders/${r.body.render.id}`);
    assert.equal(g.body.render.status, 'done');
    assert.equal(g.body.render.provider, 'architect');
    assert.equal(g.body.render.width, 400);

    // JSON answers: base64 in image, a data: URL in output, images[0].b64_json.
    const png = makePng({ w: 100, h: 100 }).toString('base64');
    for (const json of [{ image: png }, { output: `data:image/png;base64,${png}` }, { images: [{ b64_json: png }] }]) {
      answer = () => new Response(JSON.stringify(json), { headers: { 'Content-Type': 'application/json' } });
      const x = await w.staff.post('/api/renders', { projectId: w.staffProject, image: view(), scene: SCENE });
      assert.equal(x.status, 202, x.text);
      await t.services.renders.settled();
      assert.equal((await w.staff.get(`/api/renders/${x.body.render.id}`)).body.render.status, 'done', JSON.stringify(json).slice(0, 40));
    }
    assert.equal(t.services.credits.balance(w.tn.id), 2500 - 4 * 25);

    // Failures: an error status, a non-image, an unreachable service. Credits go back each time,
    // and nothing the team sees carries the key or the service's body.
    const fails = [
      () => new Response(`internal error ${KEY}`, { status: 500 }),
      () => new Response('<html>hello</html>', { headers: { 'Content-Type': 'text/html' } }),
      () => new Response(JSON.stringify({ status: 'queued' }), { headers: { 'Content-Type': 'application/json' } }),
      () => {
        throw new TypeError('fetch failed');
      },
    ];
    for (const f of fails) {
      answer = f;
      const before = t.services.credits.balance(w.tn.id);
      const x = await w.staff.post('/api/renders', { projectId: w.staffProject, image: view(), scene: SCENE });
      assert.equal(x.status, 202);
      await t.services.renders.settled();
      const got = await w.staff.get(`/api/renders/${x.body.render.id}`);
      assert.equal(got.body.render.status, 'failed');
      assert.match(got.body.render.error, /credits were returned/);
      assert.ok(!got.text.includes(KEY));
      assert.ok(!got.text.includes('internal error'));
      assert.equal(t.services.credits.balance(w.tn.id), before);
    }
    const kinds = ledger(t, w.tn.id).map((e) => e.split(':')[0]);
    assert.equal(kinds.filter((k) => k === 'release').length, 4);
    // Every reserve is settled: as many reserves as charges + releases.
    assert.equal(kinds.filter((k) => k === 'reserve').length, kinds.filter((k) => k === 'charge' || k === 'release').length);
  } finally {
    await t.close();
  }
});

test('a render that takes too long fails, and its credits go back', async () => {
  const fetch = (url, init) =>
    new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
    });
  const t = await startTestServer({ env: { ...ARCH, RENDER_TIMEOUT_MS: '1000' }, fetch });
  try {
    const w = await world(t);
    const r = await w.staff.post('/api/renders', { projectId: w.staffProject, image: view(), scene: SCENE });
    assert.equal(t.services.credits.balance(w.tn.id), 2475, 'reserved while it runs');
    // One at a time per person.
    const again = await w.staff.post('/api/renders', { projectId: w.staffProject, image: view(), scene: SCENE });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'render_in_progress');
    await t.services.renders.settled();
    const g = await w.staff.get(`/api/renders/${r.body.render.id}`);
    assert.equal(g.body.render.status, 'failed');
    assert.match(g.body.render.error, /too long/);
    assert.equal(t.services.credits.balance(w.tn.id), 2500);
  } finally {
    await t.close();
  }
});

test('a render left pending by a restart is failed and released the next time renders are read', async () => {
  const t = await startTestServer({ env: { RENDER_PROVIDER: 'demo' } });
  try {
    const w = await world(t);
    const hold = t.services.credits.reserve(w.tn.id, 25, { purpose: 'render', ref: 'rn_stalestalestale1' });
    t.db
      .prepare("INSERT INTO showroom_renders (id, tenant_id, user_id, by_role, project_id, design_name, status, provider, cost_cents, hold_id, created_at) VALUES ('rn_stalestalestale1', ?, ?, 'staff', ?, 'x', 'pending', 'demo', 25, ?, ?)")
      .run(w.tn.id, w.staff.user.id, w.staffProject, hold.id, Date.now() - 3_600_000);
    assert.equal(t.services.credits.balance(w.tn.id), 2475);
    await w.staff.get('/api/renders/status');
    const r = t.db.prepare("SELECT status, error FROM showroom_renders WHERE id = 'rn_stalestalestale1'").get();
    assert.equal(r.status, 'failed');
    assert.match(r.error, /interrupted/);
    assert.equal(t.services.credits.balance(w.tn.id), 2500);
  } finally {
    await t.close();
  }
});

test('credits: with too few, the render is refused (402) before anything is stored', async () => {
  const t = await startTestServer({ env: { RENDER_PROVIDER: 'demo' } });
  try {
    const w = await world(t, { credits: false });
    const st = await w.staff.get('/api/renders/status');
    assert.equal(st.body.reason, 'no_credits');
    const files = t.db.prepare('SELECT COUNT(*) AS n FROM files').get().n;
    const r = await w.staff.post('/api/renders', { projectId: w.staffProject, image: view(), scene: SCENE });
    assert.equal(r.status, 402);
    assert.equal(r.body.code, 'insufficient_credits');
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM showroom_renders').get().n, 0);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM files').get().n, files);
  } finally {
    await t.close();
  }
});

test('visitors: off by default, then on with a daily cap across the showroom; their own designs only', async () => {
  const t = await startTestServer({ env: { RENDER_PROVIDER: 'demo' } });
  try {
    const w = await world(t);
    const st = await w.visitor.get('/api/renders/status');
    assert.equal(st.body.role, 'visitor');
    assert.equal(st.body.reason, 'visitor_off');
    assert.equal(st.body.balanceCents, null, 'a visitor never sees the balance');
    const off = await w.visitor.post('/api/renders', { projectId: w.visitorProject, image: view(), scene: SCENE });
    assert.equal(off.status, 403);
    assert.equal(off.body.code, 'visitor_renders_off');
    // The owner switches visitor renders on with a cap of 1 a day.
    const on = await w.owner.patch('/api/workspace/showroom', { settings: { visitorRenders: true, dailyRenderCap: 1 } });
    assert.equal(on.status, 200, on.text);
    assert.equal((await w.visitor.get('/api/renders/status')).body.canRender, true);
    // Not someone else's design, and never through a share link.
    assert.equal((await w.visitor.post('/api/renders', { projectId: w.staffProject, image: view(), scene: SCENE })).status, 404);
    const share = await w.staff.post(`/api/projects/${w.staffProject}/shares`, {});
    assert.equal((await w.visitor.post('/api/renders', { shareToken: share.body.share.token, image: view(), scene: SCENE })).status, 404);
    const ok = await w.visitor.post('/api/renders', { projectId: w.visitorProject, image: view(), scene: SCENE });
    assert.equal(ok.status, 202, ok.text);
    await t.services.renders.settled();
    const st2 = await w.visitor.get('/api/renders/status');
    assert.equal(st2.body.reason, 'daily_cap');
    const capped = await w.visitor.post('/api/renders', { projectId: w.visitorProject, image: view(), scene: SCENE });
    assert.equal(capped.status, 429);
    assert.equal(capped.body.code, 'daily_cap_reached');
    // Another visitor is under the same cap.
    const other = await t.showroomUser(w.tn);
    const op = await other.post('/api/projects', { name: 'Other', doc: sampleDoc() });
    assert.equal((await other.post('/api/renders', { projectId: op.body.project.id, image: view(), scene: SCENE })).status, 429);
    // The team isn't capped, and renders a lead's design through its share link.
    const vshare = await w.visitor.post(`/api/projects/${w.visitorProject}/shares`, {});
    const s = await w.staff.post('/api/renders', { shareToken: vshare.body.share.token, image: view(), scene: SCENE });
    assert.equal(s.status, 202, s.text);
    await t.services.renders.settled();
    // A visitor sees their own renders only; the team sees all, and the visitor's render's maker.
    const mine = await w.visitor.get('/api/renders');
    assert.deepEqual(mine.body.renders.map((x) => x.id), [ok.body.render.id]);
    assert.equal(mine.body.renders[0].byName, null);
    assert.equal((await w.visitor.get(`/api/renders/${s.body.render.id}`)).status, 404);
    assert.equal((await w.visitor.get(`/api/renders/${s.body.render.id}/image`)).status, 404);
    const all = await w.staff.get(`/api/renders?projectId=${w.visitorProject}`);
    assert.deepEqual(all.body.renders.map((x) => x.id).sort(), [ok.body.render.id, s.body.render.id].sort());
    // The team's gallery for a lead's design opened from its share link; a visitor gets nothing that way.
    const byShare = await w.staff.get(`/api/renders?shareToken=${vshare.body.share.token}`);
    assert.deepEqual(byShare.body.renders.map((x) => x.id).sort(), [ok.body.render.id, s.body.render.id].sort());
    assert.deepEqual((await w.visitor.get(`/api/renders?shareToken=${vshare.body.share.token}`)).body.renders, []);
    // Signed out: told to sign in; can't render.
    const anon = new Agent(t.url, { host: w.tn.host });
    assert.equal((await anon.get('/api/renders/status')).body.reason, 'sign_in');
    assert.equal((await anon.post('/api/renders', { projectId: w.visitorProject, image: view() })).status, 401);
  } finally {
    await t.close();
  }
});

test('upload limits and bad pictures are refused before anything is charged', async () => {
  const t = await startTestServer({ env: { RENDER_PROVIDER: 'demo', RENDER_MAX_IMAGE_MB: '1' } });
  try {
    const w = await world(t);
    const post = (image, extra = {}) => w.staff.post('/api/renders', { projectId: w.staffProject, image, scene: SCENE, ...extra });
    const big = makePng({ w: 1200, h: 1200, rgba: (x, y) => [(x * 7919 + y * 104729) % 256, (x * y) % 256, (x ^ y) % 256, 255] });
    assert.ok(big.length > 1024 * 1024, `fixture is ${big.length} bytes`);
    assert.equal((await post(big.toString('base64'))).status, 413);
    assert.equal((await post(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'))).status, 400);
    assert.equal((await post(makePng({ w: 8, h: 8 }).toString('base64'))).status, 400, 'too small');
    assert.equal((await post('not base64 at all!')).status, 400);
    assert.equal((await post(undefined)).status, 400);
    assert.equal((await post(view(), { projectId: undefined })).status, 400, 'a design is needed');
    assert.equal((await post(view(), { projectId: 'nope' })).status, 404);
    assert.equal(t.services.credits.balance(w.tn.id), 2500);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM showroom_renders').get().n, 0);
    // A data: URL is fine.
    assert.equal((await post(`data:image/png;base64,${view()}`)).status, 202);
    await t.services.renders.settled();
  } finally {
    await t.close();
  }
});

test('isolation: another showroom sees nothing, and the sales site has no render routes', async () => {
  const t = await startTestServer({ env: { RENDER_PROVIDER: 'demo' } });
  try {
    const a = await world(t, { slug: 'alpha' });
    const b = await world(t, { slug: 'bravo' });
    const r = await a.staff.post('/api/renders', { projectId: a.staffProject, image: view(), scene: SCENE });
    await t.services.renders.settled();
    const id = r.body.render.id;
    for (const p of [`/api/renders/${id}`, `/api/renders/${id}/image`, `/api/renders/${id}/input`]) assert.equal((await b.owner.get(p)).status, 404, p);
    assert.equal((await b.owner.delete(`/api/renders/${id}`)).status, 404);
    assert.deepEqual((await b.owner.get('/api/workspace/renders')).body.renders, []);
    // B can't render A's design, nor through A's share link.
    assert.equal((await b.owner.post('/api/renders', { projectId: a.staffProject, image: view() })).status, 404);
    const share = await a.staff.post(`/api/projects/${a.staffProject}/shares`, {});
    assert.equal((await b.owner.post('/api/renders', { shareToken: share.body.share.token, image: view() })).status, 404);
    // A's session cookie means nothing on B's host.
    const stolen = new Agent(t.url, { host: b.tn.host });
    stolen.cookies = new Map(a.staff.cookies);
    assert.equal((await stolen.get(`/api/renders/${id}`)).status, 401);
    // The sales site: 404 for every render route.
    const sales = await t.user();
    for (const p of ['/api/renders/status', '/api/renders', `/api/renders/${id}`, `/api/renders/${id}/image`, '/api/workspace/renders']) assert.equal((await sales.get(p)).status, 404, p);
    assert.equal((await sales.post('/api/renders', { image: view() })).status, 404);
  } finally {
    await t.close();
  }
});

test('the gallery: taking a render out of it, and an admin refund (audited, once)', async () => {
  const t = await startTestServer({ env: { RENDER_PROVIDER: 'demo' } });
  try {
    const w = await world(t);
    const r = await w.staff.post('/api/renders', { projectId: w.staffProject, image: view(), scene: SCENE });
    await t.services.renders.settled();
    const id = r.body.render.id;
    const admin = await t.user({ role: 'admin' });
    const ref = await admin.post(`/api/admin/tenants/${w.tn.id}/renders/${id}/refund`, { note: 'Blurry result' });
    assert.equal(ref.status, 200, ref.text);
    assert.equal(ref.body.render.status, 'refunded');
    assert.equal(t.services.credits.balance(w.tn.id), 2500);
    assert.equal((await admin.post(`/api/admin/tenants/${w.tn.id}/renders/${id}/refund`, {})).status, 409);
    const a = t.db.prepare("SELECT detail FROM admin_audit WHERE action = 'tenant_render_refund'").all();
    assert.equal(a.length, 1);
    assert.equal(JSON.parse(a[0].detail).renderId, id);
    // A refunded render still shows (it was made); the team can take it out of the gallery.
    assert.equal((await w.staff.get(`/api/renders/${id}/image`)).status, 200);
    assert.equal((await w.staff.delete(`/api/renders/${id}`)).status, 200);
    assert.deepEqual((await w.staff.get('/api/renders')).body.renders, []);
    assert.equal((await w.staff.get(`/api/renders/${id}`)).status, 404);
    // Admin > Tenants shows the usage.
    const list = await admin.get('/api/admin/tenants');
    const row = list.body.tenants.find((x) => x.id === w.tn.id);
    assert.equal(row.renders.total, 0, 'a refunded render is not counted as used');
  } finally {
    await t.close();
  }
});

test('png: decodes what it encodes and every scanline filter; refuses what it can’t read', () => {
  const w = 7;
  const h = 5;
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37 + 11) % 256;
  const round = decodePng(encodePng({ width: w, height: h, rgba }));
  assert.deepEqual(round.rgba, rgba);
  // Filters 1–4 (what browsers write), RGB, encoded by hand.
  const bpp = 3;
  const stride = w * bpp;
  const pix = Buffer.alloc(stride * h);
  for (let i = 0; i < pix.length; i++) pix[i] = (i * 53 + 7) % 256;
  const raw = [];
  for (let y = 0; y < h; y++) {
    const f = (y % 4) + 1;
    raw.push(f);
    for (let i = 0; i < stride; i++) {
      const cur = pix[y * stride + i];
      const a = i >= bpp ? pix[y * stride + i - bpp] : 0;
      const b = y ? pix[(y - 1) * stride + i] : 0;
      const c = y && i >= bpp ? pix[(y - 1) * stride + i - bpp] : 0;
      let pred = 0;
      if (f === 1) pred = a;
      else if (f === 2) pred = b;
      else if (f === 3) pred = (a + b) >> 1;
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw.push((cur - pred + 256) % 256);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.from(raw))), chunk('IEND', Buffer.alloc(0))]);
  const d = decodePng(png);
  assert.ok(d);
  for (let p = 0; p < w * h; p++) assert.deepEqual([...d.rgba.subarray(p * 4, p * 4 + 4)], [pix[p * 3], pix[p * 3 + 1], pix[p * 3 + 2], 255]);
  assert.equal(decodePng(makeJpeg()), null);
  assert.equal(decodePng(Buffer.from('nope')), null);
  assert.equal(decodePng(png.subarray(0, 40)), null);
});

test('scene: cleaned and bounded; the prompt names the room, finishes and products', () => {
  const s = cleanScene(
    {
      room: { kind: 'bathroom', widthIn: 96, lengthIn: 'x', ceilingIn: 1e9 },
      finishes: { cabinets: 'White\u0000oak'.padEnd(500, '!'), evil: 'x' },
      products: [...Array.from({ length: 200 }, (_, i) => ({ name: `P${i}`, count: 2 })), { name: '' }, 'junk'],
      camera: { view: 'drone' },
      extra: { anything: true },
    },
    { showroom: 'Northline', designName: 'Ensuite' },
  );
  assert.equal(s.room.kind, 'bathroom');
  assert.equal(s.room.lengthIn, null);
  assert.equal(s.room.ceilingIn, null);
  assert.equal(s.finishes.cabinets.length, 80);
  assert.ok(!s.finishes.cabinets.includes('\u0000'));
  assert.equal(s.finishes.evil, undefined);
  assert.equal(s.products.length, 60);
  assert.equal(s.camera.view, 'current');
  assert.equal(s.extra, undefined);
  assert.equal(s.showroom, 'Northline');
  const p = scenePrompt(cleanScene(SCENE));
  assert.match(p, /kitchen about 16′8″ by 13′/);
  assert.match(p, /Navy \(Shaker doors\)/);
  assert.match(p, /Quartz countertops/);
  assert.match(p, /do not add, remove or move anything/);
  assert.equal(imageFromJson({ nothing: 1 }), null);
  assert.equal(imageFromJson(null), null);
});
