import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initialDoc, useDesignStore } from './useDesignStore';
import type { DesignDoc } from '../types';

const S = () => useDesignStore.getState();
const item = (id: string) => S().doc.items.find((i) => i.id === id)!;

/** 200″ × 156″ room; a 24″ base cabinet loose in the middle and an 84″ island. */
function fixture(): DesignDoc {
  const base = initialDoc();
  return {
    ...base,
    room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
    items: [
      { id: 'b1', productId: 'base', x: 40, y: 60, rotation: 0, finishIndex: 0 },
      { id: 'isl', productId: 'island', x: 100, y: 120, rotation: 0, finishIndex: 0 },
    ],
  };
}

beforeEach(() => S().loadDoc(fixture()));

describe('drag protocol (room inches, footprint centre)', () => {
  test('a whole drag is exactly one undo step, and undo puts the item back', () => {
    assert.equal(S().past.length, 0);
    assert.equal(S().dragStart('b1'), true);
    assert.equal(S().dragging, true);
    assert.equal(S().selectedId, 'b1');
    for (const [x, y] of [[50, 60], [60, 50], [70, 40], [80, 70]]) S().dragMove('b1', x, y);
    assert.equal(S().past.length, 0, 'moves mid-drag do not touch history');
    assert.equal(S().dragEnd('b1'), true);
    assert.equal(S().dragging, false);
    assert.equal(S().past.length, 1);
    assert.deepEqual([item('b1').x, item('b1').y], [80, 70]);
    S().undo();
    assert.deepEqual([item('b1').x, item('b1').y], [40, 60]);
    S().redo();
    assert.deepEqual([item('b1').x, item('b1').y], [80, 70]);
  });

  test('a click (start + end, no movement) records nothing', () => {
    S().dragStart('b1');
    S().dragMove('b1', 40, 60); // same spot
    assert.equal(S().dragEnd(), false);
    assert.equal(S().past.length, 0);
  });

  test('dragMove snaps a cabinet flush to the nearest wall and reports where it landed', () => {
    S().dragStart('b1');
    const north = S().dragMove('b1', 60, 14);
    assert.deepEqual(north, { x: 60, y: 12, rotation: 0, wall: 'north' });
    const east = S().dragMove('b1', 190, 78);
    assert.deepEqual(east, { x: 188, y: 78, rotation: 90, wall: 'east' });
    // The store holds exactly what dragMove returned.
    assert.deepEqual([item('b1').x, item('b1').y, item('b1').rotation], [188, 78, 90]);
    S().dragEnd();
  });

  test('free-standing pieces are kept inside the room', () => {
    const r = S().dragMove('isl', 500, 500);
    assert.deepEqual(r, { x: 200 - 42, y: 156 - 21, rotation: 0, wall: null });
    S().dragEnd();
  });

  test('dragMove without dragStart opens the drag implicitly (still one step)', () => {
    S().dragMove('b1', 90, 70);
    S().dragMove('b1', 95, 70);
    assert.equal(S().dragging, true);
    assert.equal(S().dragEnd(), true);
    assert.equal(S().past.length, 1);
  });

  test('unknown ids and non-finite coordinates are rejected', () => {
    assert.equal(S().dragStart('nope'), false);
    assert.equal(S().dragMove('nope', 10, 10), null);
    assert.equal(S().dragMove('b1', Number.NaN, 10), null);
    assert.equal(S().dragging, false);
  });

  test('dragCancel restores the start position without an undo step', () => {
    S().dragStart('b1');
    S().dragMove('b1', 120, 40);
    S().dragCancel();
    assert.deepEqual([item('b1').x, item('b1').y], [40, 60]);
    assert.equal(S().dragging, false);
    assert.equal(S().past.length, 0);
  });

  test('an edit mid-drag banks the drag so far as its own step', () => {
    S().dragStart('b1');
    S().dragMove('b1', 80, 70);
    S().rotate('b1', 1);
    S().dragMove('b1', 90, 70);
    S().dragEnd();
    assert.equal(S().past.length, 3, 'drag-so-far, rotate, rest of drag');
    S().undo();
    S().undo();
    S().undo();
    assert.deepEqual([item('b1').x, item('b1').y, item('b1').rotation], [40, 60, 0]);
  });
});

describe('addItem', () => {
  test('returns the new id, selects it, and snaps a positioned add like a drag', () => {
    const id = S().addItem('base', { x: 100, y: 5 });
    assert.ok(id);
    assert.equal(S().selectedId, id);
    const it = item(id!);
    assert.deepEqual([it.x, it.y, it.rotation], [100, 12, 0]);
    assert.equal(S().past.length, 1);
  });

  test('returns null for an unknown product', () => {
    assert.equal(S().addItem('not-a-product'), null);
  });
});
