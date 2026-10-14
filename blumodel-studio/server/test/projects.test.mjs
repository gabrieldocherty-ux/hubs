// Saved kitchens: the existing flows, required revisions with a conditional UPDATE,
// and strict document validation.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, sampleDoc } from './helpers.mjs';

let t;
before(async () => {
  t = await startTestServer();
});
after(async () => {
  await t?.close();
});

test('create, list, get, duplicate, delete; another user gets 404', async () => {
  const a = await t.user();
  const b = await t.user();
  const created = await a.post('/api/projects', { name: '  Smith Kitchen ', client: 'Smiths', doc: sampleDoc() });
  assert.equal(created.status, 201);
  const p = created.body.project;
  assert.match(p.id, /^[0-9a-f-]{36}$/);
  assert.equal(p.name, 'Smith Kitchen');
  assert.equal(p.client, 'Smiths');
  assert.equal(p.revision, 1);
  assert.equal(p.doc.name, 'Smith Kitchen', 'the doc name follows the project name');
  assert.deepEqual(Object.keys(p).sort(), ['client', 'createdAt', 'doc', 'id', 'name', 'revision', 'updatedAt']);

  const untitled = await a.post('/api/projects', { doc: sampleDoc() });
  assert.equal(untitled.body.project.name, 'Untitled Kitchen');

  const list = await a.get('/api/projects');
  assert.equal(list.body.projects.length, 2);
  assert.equal((await b.get('/api/projects')).body.projects.length, 0);

  assert.equal((await a.get(`/api/projects/${p.id}`)).body.project.id, p.id);
  for (const [m, path] of [['GET', `/api/projects/${p.id}`], ['PUT', `/api/projects/${p.id}`], ['DELETE', `/api/projects/${p.id}`], ['POST', `/api/projects/${p.id}/duplicate`]]) {
    const r = await b.request(m, path, { body: { revision: 1, doc: sampleDoc() } });
    assert.equal(r.status, 404, `${m} ${path} as another user`);
    assert.deepEqual(r.body, { error: 'That kitchen does not exist.' });
  }

  const dup = await a.post(`/api/projects/${p.id}/duplicate`);
  assert.equal(dup.status, 201);
  assert.equal(dup.body.project.name, 'Smith Kitchen (copy)');
  assert.equal(dup.body.project.client, 'Smiths');
  assert.equal(dup.body.project.doc.name, 'Smith Kitchen (copy)');

  const del = await a.delete(`/api/projects/${p.id}`);
  assert.deepEqual(del.body, { ok: true });
  assert.equal((await a.get(`/api/projects/${p.id}`)).status, 404);
  assert.equal((await t.agent().get('/api/projects')).status, 401);
});

test('save: revision required; stale → 409 with the current project; force overwrites', async () => {
  const a = await t.user();
  const p = (await a.post('/api/projects', { name: 'K', doc: sampleDoc() })).body.project;
  const noRev = await a.put(`/api/projects/${p.id}`, { doc: sampleDoc({ items: [] }) });
  assert.equal(noRev.status, 400);
  assert.match(noRev.body.error, /^Reload this kitchen/);
  const strRev = await a.put(`/api/projects/${p.id}`, { revision: '1', doc: sampleDoc() });
  assert.equal(strRev.status, 400);

  const ok = await a.put(`/api/projects/${p.id}`, { revision: 1, doc: sampleDoc({ items: [] }), name: 'K2' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.project.revision, 2);
  assert.equal(ok.body.project.name, 'K2');
  assert.equal(ok.body.project.doc.name, 'K2');

  const stale = await a.put(`/api/projects/${p.id}`, { revision: 1, doc: sampleDoc() });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'This kitchen was changed somewhere else.');
  assert.equal(stale.body.project.revision, 2);
  assert.deepEqual(stale.body.project.doc.items, []);

  const forced = await a.put(`/api/projects/${p.id}`, { force: true, doc: sampleDoc() });
  assert.equal(forced.status, 200);
  assert.equal(forced.body.project.revision, 3);
  assert.equal(forced.body.project.doc.items.length, 1);

  const rename = await a.put(`/api/projects/${p.id}`, { name: 'Renamed', force: true });
  assert.equal(rename.body.project.doc.name, 'Renamed');
  const client = await a.put(`/api/projects/${p.id}`, { client: 'New client', revision: 4 });
  assert.equal(client.body.project.client, 'New client');
  assert.equal(client.body.project.name, 'Renamed');
});

test('two concurrent saves from the same revision: exactly one 409', async () => {
  const a = await t.user();
  const p = (await a.post('/api/projects', { name: 'Race', doc: sampleDoc() })).body.project;
  for (let round = 0; round < 3; round++) {
    const rev = (await a.get(`/api/projects/${p.id}`)).body.project.revision;
    const results = await Promise.all([
      a.put(`/api/projects/${p.id}`, { revision: rev, doc: sampleDoc({ items: [] }) }),
      a.put(`/api/projects/${p.id}`, { revision: rev, doc: sampleDoc() }),
    ]);
    const codes = results.map((r) => r.status).sort();
    assert.deepEqual(codes, [200, 409], `round ${round}`);
  }
});

test('a doc over 600 KB is a 413; a body over 1 MB is a 413', async () => {
  const a = await t.user();
  // Big but valid: many saved product snapshots (each under 8 KB).
  const products = {};
  for (let i = 0; i < 100; i++) products[`p_${String(i).padStart(24, '0')}`] = { id: `p_${String(i).padStart(24, '0')}`, name: 'X', blurb: 'y'.repeat(7000) };
  const big = await a.post('/api/projects', { name: 'Big', doc: sampleDoc({ products }) });
  assert.equal(big.status, 413);
  assert.deepEqual(big.body, { error: 'That design is too large to save.' });
});

test('strict doc validation: junk is rejected, unknown keys are stripped', async () => {
  const a = await t.user();
  const post = (doc) => a.post('/api/projects', { name: 'V', doc });
  const item = (over) => ({ id: 'it-9', productId: 'base', x: 50, y: 12, rotation: 0, finishIndex: 0, ...over });
  const rejects = [
    ['null doc', null],
    ['no room', { ...sampleDoc(), room: undefined }],
    ['room not numbers', sampleDoc({ room: { widthIn: '200', lengthIn: 156, ceilingIn: 108 } })],
    ['items not array', sampleDoc({ items: {} })],
    ['negative width', sampleDoc({ items: [item({ widthIn: -24 })] })],
    ['zero width', sampleDoc({ items: [item({ widthIn: 0 })] })],
    ['NaN-ish x', sampleDoc({ items: [item({ x: 'a' })] })],
    ['far away', sampleDoc({ items: [item({ x: 99999 })] })],
    ['bad rotation', sampleDoc({ items: [item({ rotation: 45 })] })],
    ['bad product id', sampleDoc({ items: [item({ productId: '../../etc' })] })],
    ['uppercase product id', sampleDoc({ items: [item({ productId: 'BASE' })] })],
    ['missing item id', sampleDoc({ items: [item({ id: '' })] })],
    ['negative finish', sampleDoc({ items: [item({ finishIndex: -1 })] })],
    ['long finishId', sampleDoc({ items: [item({ finishId: 'x'.repeat(65) })] })],
    ['junk item', sampleDoc({ items: ['junk'] })],
    ['bad door style', sampleDoc({ surfaces: { ...sampleDoc().surfaces, doorStyle: 'gothic' } })],
    ['version 3', sampleDoc({ version: 3 })],
    ['too many items', sampleDoc({ items: Array.from({ length: 401 }, (_, i) => item({ id: `it-${i}` })) })],
    ['too many products', sampleDoc({ products: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`p_${String(i).padStart(24, '0')}`, { name: 'x' }])) })],
    ['oversized product', sampleDoc({ products: { p_aaaaaaaaaaaaaaaaaaaaaaaa: { blurb: 'x'.repeat(9000) } } })],
    ['bad product key', sampleDoc({ products: { 'Evil Key': { name: 'x' } } })],
  ];
  for (const [label, doc] of rejects) {
    const r = await post(doc);
    assert.equal(r.status, 400, label);
    assert.equal(typeof r.body.error, 'string', label);
  }
  const legacyMessage = await post({ room: null });
  assert.equal(legacyMessage.body.error, 'That is not a kitchen design.');

  const ok = await post(
    sampleDoc({
      junk: 'dropped',
      version: 2,
      room: { widthIn: 9999, lengthIn: 10, ceilingIn: 100, extra: 1 },
      surfaces: { ...sampleDoc().surfaces, evil: '<script>' },
      items: [item({ widthIn: 30, mirrored: true, finishId: 'oak', extra: 'x' }), item({ id: 'it-10', productId: 'p_abcdefghijklmnopqrstuvwx' })],
      products: {
        p_abcdefghijklmnopqrstuvwx: {
          id: 'p_abcdefghijklmnopqrstuvwx',
          name: 'Brand Range',
          buyUrl: 'javascript:alert(1)',
          specSheetUrl: 'https://brand.example/spec.pdf',
          thumbnailUrl: 'https://tracker.example/pixel.png',
          images: [{ url: '/files/abc.png' }, { url: '//evil.example/x.png' }],
          model: { url: 'https://cdn.example/model.glb' },
        },
      },
    }),
  );
  assert.equal(ok.status, 201, ok.text);
  const doc = ok.body.project.doc;
  assert.equal(doc.junk, undefined);
  assert.equal(doc.version, 2);
  assert.deepEqual(doc.room, { widthIn: 480, lengthIn: 72, ceilingIn: 100 }, 'room clamped, extra keys dropped');
  assert.equal(doc.surfaces.evil, undefined);
  assert.deepEqual(doc.items[0], { id: 'it-9', productId: 'base', x: 50, y: 12, rotation: 0, finishIndex: 0, finishId: 'oak', widthIn: 30, mirrored: true });
  assert.equal(doc.items[1].productId, 'p_abcdefghijklmnopqrstuvwx', 'an unknown server product id is kept');
  const snap = doc.products.p_abcdefghijklmnopqrstuvwx;
  assert.equal(snap.buyUrl, undefined, 'javascript: link dropped');
  assert.equal(snap.specSheetUrl, 'https://brand.example/spec.pdf');
  assert.equal(snap.thumbnailUrl, undefined, 'third-party image dropped');
  assert.deepEqual(snap.images, [{ url: '/files/abc.png' }]);
  assert.equal(snap.model, undefined);

  // A v1 doc with no version and no finishId still saves unchanged.
  const v1 = await post(sampleDoc());
  assert.equal(v1.status, 201);
  assert.equal(v1.body.project.doc.version, undefined);
});
