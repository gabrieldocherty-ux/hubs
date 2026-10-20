// Free-form rooms (docs/handoff/rooms.md): a drawn outline and extra rooms survive a save, junk falls
// back to the plain rectangle. Needs no sign-in, so it can run on the Wyse: node --test server/test/rooms-doc.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDoc } from '../lib/doc.mjs';
import { sampleDoc } from './helpers.mjs';

const L = [[0, 0], [240, 0], [240, 96], [144, 96], [144, 168], [0, 168]];
const room = (extra = {}) => ({ widthIn: 240, lengthIn: 168, ceilingIn: 108, ...extra });
const keep = (r) => normalizeDoc(sampleDoc({ room: r }));

test('an L-shaped outline comes back identical', () => {
  const r = keep(room({ outline: L }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.doc.room.outline, L);
});

test('a plain rectangle has no outline key', () => {
  const r = keep(room());
  assert.equal(r.ok, true);
  assert.equal('outline' in r.doc.room, false);
});

test('a diagonal wall is dropped and the room keeps its rectangle', () => {
  const r = keep(room({ outline: [[0, 0], [100, 0], [200, 100], [0, 100]] }));
  assert.equal(r.ok, true);
  assert.equal('outline' in r.doc.room, false);
  assert.equal(r.doc.room.widthIn, 240);
});

test('a wall under a foot, a non-numeric corner and too many corners are dropped', () => {
  for (const outline of [[[0, 0], [5, 0], [5, 100], [0, 100]], [[0, 0], ['a', 0], [100, 100], [0, 100]], Array.from({ length: 70 }, (_, i) => [i, i])]) {
    const r = keep(room({ outline }));
    assert.equal(r.ok, true);
    assert.equal('outline' in r.doc.room, false);
  }
});

test('extra rooms are kept (max 8), bad ones skipped, ids and names cleaned', () => {
  const pantry = [[240, 0], [300, 0], [300, 60], [240, 60]];
  const extra = [{ id: 'pantry', name: 'Pantry', outline: pantry }, { id: 'bad id!', name: 'x'.repeat(80), outline: pantry }, { id: 'z', name: 'Bad', outline: [[0, 0], [1, 1]] }, ...Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, name: 'E', outline: pantry }))];
  const r = keep(room({ extra }));
  assert.equal(r.ok, true);
  assert.equal(r.doc.room.extra.length, 8);
  assert.deepEqual(r.doc.room.extra[0], { id: 'pantry', name: 'Pantry', outline: pantry });
  assert.match(r.doc.room.extra[1].id, /^[A-Za-z0-9_-]+$/);
  assert.equal(r.doc.room.extra[1].name.length, 40);
});

test('an open-plan kitchen: an open area with a styled border and a styled wall survive a save', () => {
  const zone = [[0, 0], [150, 0], [150, 120], [0, 120]];
  const styles = ['open', 'half', 'bar', 'open'];
  const r = keep(room({ styles: ['wall', 'glass', 'wall', 'wall'], extra: [{ id: 'k', name: 'Kitchen', kind: 'zone', outline: zone, styles }] }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.doc.room.styles, ['wall', 'glass', 'wall', 'wall']);
  assert.deepEqual(r.doc.room.extra[0], { id: 'k', name: 'Kitchen', outline: zone, kind: 'zone', styles });
});

test('edge styles that are the wrong length, unknown, or say nothing are dropped', () => {
  const zone = [[0, 0], [150, 0], [150, 120], [0, 120]];
  for (const styles of [['half', 'half'], ['half', 'half', 'half', 'castle'], ['open', 'open', 'open', 'open']]) {
    const r = keep(room({ extra: [{ id: 'k', name: 'Kitchen', kind: 'zone', outline: zone, styles }] }));
    assert.equal(r.ok, true);
    assert.equal('styles' in r.doc.room.extra[0], false, JSON.stringify(styles));
  }
  const r = keep(room({ styles: ['wall', 'wall', 'wall', 'wall'] }));
  assert.equal('styles' in r.doc.room, false);
});

test('crown moulding on the surfaces is kept when it is a known style and refused when it is not', () => {
  const ok = normalizeDoc(sampleDoc({ surfaces: { ...sampleDoc().surfaces, crown: 'cove' } }));
  assert.equal(ok.ok, true);
  assert.equal(ok.doc.surfaces.crown, 'cove');
  const bad = normalizeDoc(sampleDoc({ surfaces: { ...sampleDoc().surfaces, crown: 'gothic' } }));
  assert.equal(bad.ok, false);
});
