import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Room } from '../../../types';
import { composeNewKitchen } from '../../../data/compose';
import { NEUTRAL_SURFACES, PLAIN_PRESET, STYLE_PRESETS } from '../../../data/styles';
import { TEMPLATES, buildTemplate } from '../../../data/templates';
import { DEFAULT_SURFACES } from '../../../data/defaults';
import { getProduct } from '../../../data/catalog';

const ROOM: Room = { widthIn: 200, lengthIn: 156, ceilingIn: 108 };

test('a new kitchen starts plain: neutral finishes, no colour palette applied', () => {
  const doc = composeNewKitchen('Plain', ROOM, 'l-island');
  assert.deepEqual(doc.surfaces, NEUTRAL_SURFACES);
  for (const p of STYLE_PRESETS) assert.notDeepEqual(p.surfaces, NEUTRAL_SURFACES, `${p.name} must not look chosen on a new kitchen`);
  assert.equal(PLAIN_PRESET.surfaces, NEUTRAL_SURFACES);
  // Every cabinet-palette piece, the island included, wears the plain cabinet finish (no two-tone accent).
  const cabinetry = doc.items.filter((it) => getProduct(it.productId)?.finishes === 'cabinet');
  assert.ok(cabinetry.length > 10);
  for (const it of cabinetry) assert.equal(it.finishId, NEUTRAL_SURFACES.cabinetFinishId, it.productId);
  assert.ok(doc.items.some((it) => it.productId === 'island'));
});

test('the plain start changes finishes only, never what is placed or where', () => {
  for (const t of TEMPLATES) {
    const plain = composeNewKitchen('', ROOM, t.id).items.map(({ productId, x, y, rotation, widthIn }) => ({ productId, x, y, rotation, widthIn }));
    const before = buildTemplate(t.id, ROOM, DEFAULT_SURFACES).items.map(({ productId, x, y, rotation, widthIn }) => ({ productId, x, y, rotation, widthIn }));
    assert.deepEqual(plain, before, t.id);
  }
  assert.deepEqual(composeNewKitchen('', ROOM, null).items, []);
});
