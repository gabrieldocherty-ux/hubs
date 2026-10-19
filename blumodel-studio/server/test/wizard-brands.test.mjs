// The setup wizard's "Choose your brands" answers (`doc.brandPrefs`) survive a save: the server
// keeps them cleaned like the client's cleanBrandPrefs (src/lib/generate/brands.ts) and refuses junk.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDoc } from '../lib/doc.mjs';
import { startTestServer, sampleDoc } from './helpers.mjs';

let t;
before(async () => {
  t = await startTestServer();
});
after(async () => {
  await t?.close();
});

test('normalizeDoc keeps preferred brands: known categories, trimmed, no repeats, 20 a category', () => {
  const many = Array.from({ length: 30 }, (_, i) => `Brand ${i}`);
  const r = normalizeDoc(
    sampleDoc({
      brandPrefs: {
        cabinets: ['  Landon   & Co ', 'landon & co', 'Eklipse (EBSU)', 'eklipse', '', 'x'.repeat(81)],
        appliances: many,
        sinks: [],
        lighting: null,
        flooring: ['Somebody'],
      },
    }),
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.doc.brandPrefs, { cabinets: ['Landon & Co', 'Eklipse (EBSU)'], appliances: many.slice(0, 20) });
});

test('normalizeDoc drops empty preferences and refuses anything but lists of names', () => {
  assert.equal('brandPrefs' in normalizeDoc(sampleDoc({ brandPrefs: { sinks: [] } })).doc, false);
  assert.equal('brandPrefs' in normalizeDoc(sampleDoc({ brandPrefs: null })).doc, false);
  assert.equal('brandPrefs' in normalizeDoc(sampleDoc()).doc, false);
  for (const bad of [['GE'], 'GE', 7, { cabinets: 'GE' }, { cabinets: [7] }, { cabinets: [{ name: 'GE' }] }]) {
    const r = normalizeDoc(sampleDoc({ brandPrefs: bad }));
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match(r.field, /^brandPrefs/);
  }
});

test('a kitchen created with preferred brands keeps them through create, save and duplicate', async () => {
  const a = await t.user();
  const brandPrefs = { cabinets: ['Landon & Co'], appliances: ['GE', 'Bosch'] };
  const created = await a.post('/api/projects', { name: 'Brand kitchen', doc: sampleDoc({ brandPrefs }) });
  assert.equal(created.status, 201);
  const p = created.body.project;
  assert.deepEqual(p.doc.brandPrefs, brandPrefs);

  const saved = await a.put(`/api/projects/${p.id}`, { revision: p.revision, doc: { ...p.doc, brandPrefs: { lighting: ['IKEA'] } } });
  assert.equal(saved.status, 200);
  assert.deepEqual((await a.get(`/api/projects/${p.id}`)).body.project.doc.brandPrefs, { lighting: ['IKEA'] });

  const dup = await a.post(`/api/projects/${p.id}/duplicate`);
  assert.deepEqual(dup.body.project.doc.brandPrefs, { lighting: ['IKEA'] });

  const junk = await a.post('/api/projects', { name: 'Junk', doc: sampleDoc({ brandPrefs: { cabinets: [1, 2] } }) });
  assert.equal(junk.status, 400);
});
