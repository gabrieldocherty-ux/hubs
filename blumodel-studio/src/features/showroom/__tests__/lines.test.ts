import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DesignDoc, PlacedItem } from '../../../types';
import { CATALOG } from '../../../data/catalog';
import { keepShowroomItems } from '../lines';

const item = (id: string, productId: string): PlacedItem => ({ id, productId, x: 10, y: 10, rotation: 0, finishIndex: 0 }) as PlacedItem;

test('without "fill the gaps" a new showroom design keeps only the company’s products (and the room’s doors and windows)', () => {
  const basic = CATALOG.find((p) => p.category === 'cabinets')!;
  const doc = {
    name: 'K',
    room: { widthIn: 144, lengthIn: 144, ceilingIn: 96 },
    surfaces: {},
    items: [item('a', basic.id), item('b', 'p_abcdefghijklmnopqrstuvwx'), item('c', 'window')],
  } as unknown as DesignDoc;
  const kept = keepShowroomItems(doc, false);
  assert.deepEqual(
    kept.items.map((i) => i.id),
    ['b', 'c'],
  );
  // With the switch on, nothing changes (the same object).
  assert.equal(keepShowroomItems(doc, true), doc);
  // Nothing to drop: the same object too.
  const own = { ...doc, items: [item('b', 'p_abcdefghijklmnopqrstuvwx')] } as DesignDoc;
  assert.equal(keepShowroomItems(own, false), own);
});
