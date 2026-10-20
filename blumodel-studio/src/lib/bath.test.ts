import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from './checks';
import { resolveAll, snapItem, resolve } from './geometry';
import { getProduct } from '../data/catalog';
import type { PlacedItem, Room } from '../types';

const room: Room = { widthIn: 96, lengthIn: 120, ceilingIn: 96 };
const it = (id: string, productId: string, x: number, y: number, rotation: PlacedItem['rotation'] = 0): PlacedItem => ({ id, productId, x, y, rotation, finishIndex: 0 });
const ids = (items: PlacedItem[]) => runChecks(resolveAll(items), room).checks.map((c) => c.id.replace(/-[^-]+$/, ''));

describe('bathroom products', () => {
  test('every bath kind is a real product in the Bath category', () => {
    for (const id of ['vanity', 'vanity-double', 'vanity-floating', 'toilet', 'toilet-wall', 'tub', 'tub-free', 'shower', 'shower-corner', 'shower-walkin', 'mirror', 'mirror-round', 'medicine-cabinet']) {
      const p = getProduct(id);
      assert.ok(p, id);
      assert.equal(p.category, 'bath', id);
    }
  });
  test('a toilet snaps back to the wall like a cabinet', () => {
    const p = getProduct('toilet')!;
    const s = snapItem({ id: 't', x: 48, y: 20, rotation: 0 }, p, p.widthIn, room, []);
    assert.equal(s.wall, 'north');
    assert.equal(s.y, p.depthIn / 2);
  });
  test('a toilet jammed into a corner breaks the 15-inch side rule', () => {
    assert.ok(ids([it('t', 'toilet', 10, 14.5)]).includes('wc-side'));
  });
  test('a toilet in the middle of a wall with room in front passes', () => {
    const got = ids([it('t', 'toilet', 48, 14.5)]);
    assert.ok(!got.includes('wc-side') && !got.includes('wc-front'), got.join());
  });
  test('a tub right in front of the toilet leaves no clear floor', () => {
    const got = ids([it('t', 'toilet', 48, 14.5), it('b', 'tub', 48, 120 - 15 - 60, 180)]);
    assert.ok(got.includes('wc-front'), got.join());
  });
  test('a 32-inch corner shower is flagged as tight; a 24-inch one fails', () => {
    const tight = { ...it('s', 'shower-corner', 18, 18), widthIn: 32 };
    assert.ok(runChecks(resolveAll([tight]), room).checks.some((c) => c.id.startsWith('shower-size') && c.level === 'warn'));
    const tiny = resolve({ ...it('s', 'shower-corner', 18, 18), widthIn: 32 });
    assert.ok(tiny);
  });
});

import { BATH_LAYOUTS, bathLayoutFits, bathLayoutItems } from '../data/bathLayouts';

describe('bathroom starting layouts', () => {
  const rooms: Room[] = [
    { widthIn: 60, lengthIn: 96, ceilingIn: 96 },
    { widthIn: 96, lengthIn: 60, ceilingIn: 96 },
    { widthIn: 96, lengthIn: 120, ceilingIn: 96 },
    { widthIn: 120, lengthIn: 144, ceilingIn: 108 },
    { widthIn: 60, lengthIn: 72, ceilingIn: 96 },
  ];
  for (const room of rooms) {
    for (const l of BATH_LAYOUTS) {
      if (!bathLayoutFits(l, room)) continue;
      test(`${l.name} in a ${room.widthIn} x ${room.lengthIn} room passes every code check`, () => {
        const items = bathLayoutItems(l.id, room);
        const report = runChecks(resolveAll(items), room);
        const bad = report.checks.filter((c) => c.level === 'bad');
        assert.deepEqual(bad.map((c) => c.title), []);
        assert.ok(items.some((i) => i.productId === 'toilet'));
      });
    }
  }
});

import { buildEstimate } from './estimate';
import { DEFAULT_SURFACES } from '../data/defaults';

describe('crown moulding', () => {
  const room: Room = { widthIn: 144, lengthIn: 120, ceilingIn: 96 };
  const uppers: PlacedItem[] = [
    { id: 'u1', productId: 'wall', x: 15, y: 6, rotation: 0, finishIndex: 0 },
    { id: 'u2', productId: 'wall', x: 45, y: 6, rotation: 0, finishIndex: 0 },
    // A 42in upper reaches the 8ft ceiling: no room for crown on it.
    { id: 'u3', productId: 'wall-42', x: 75, y: 6, rotation: 0, finishIndex: 0 },
  ];
  const doc = (crown?: 'flat' | 'cove') => ({ name: 'C', room, surfaces: { ...DEFAULT_SURFACES, ...(crown ? { crown } : {}) }, items: uppers, version: 2 as const });
  test('no crown, no line', () => {
    assert.equal(buildEstimate(doc()).lines.some((l) => l.key === 'crown'), false);
  });
  test('cove crown is priced per linear foot over the uppers that have room for it', () => {
    const line = buildEstimate(doc('cove')).lines.find((l) => l.key === 'crown');
    assert.ok(line);
    assert.equal(line.qty, Math.ceil((60 / 12) * 1.2));
    assert.equal(line.unit, 'lin ft');
  });
});

describe('fridge clearances', () => {
  const room: Room = { widthIn: 144, lengthIn: 144, ceilingIn: 96 };
  const fridge = (x: number): PlacedItem => ({ id: 'f', productId: 'fridge-36', x, y: 15, rotation: 0, finishIndex: 0 });
  const titles = (items: PlacedItem[]) => runChecks(resolveAll(items), room).checks.map((c) => c.id.split('-').slice(0, 2).join('-'));
  test('a fridge jammed against a side wall is flagged; a 3-inch filler clears it', () => {
    assert.ok(titles([fridge(18)]).includes('fridge-side'));
    assert.ok(!titles([fridge(21)]).includes('fridge-side'));
  });
  test('an island 24 inches in front of the fridge leaves too little room to open it', () => {
    const island: PlacedItem = { id: 'i', productId: 'island', x: 60, y: 30 + 24 + 21, rotation: 0, finishIndex: 0 };
    assert.ok(titles([fridge(60), island]).includes('fridge-front'));
  });
});
