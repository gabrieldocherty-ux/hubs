import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlacedItem, Room, Rotation } from '../../types';
import { resolve, type Resolved } from '../../lib/geometry';
import { cycleAfter, hitsAt, itemRoomBox, localToRoom, pickAt, roomToLocal, touchPad } from './planHit';
import { dragFeedback } from './snapFeedback';

const ROOM: Room = { widthIn: 200, lengthIn: 156, ceilingIn: 108 };

function make(id: string, productId: string, x: number, y: number, rotation: Rotation = 0, widthIn?: number): Resolved {
  const item: PlacedItem = { id, productId, x, y, rotation, finishIndex: 0, ...(widthIn ? { widthIn } : {}) };
  const r = resolve(item);
  assert.ok(r, `unknown product ${productId}`);
  return r;
}

const mousePad = () => 0;

describe('plan hit-testing', () => {
  test('room <-> local round-trips at every rotation, and the drawn box matches the footprint', () => {
    for (const rot of [0, 90, 180, 270] as Rotation[]) {
      const it = { x: 50, y: 40, rotation: rot };
      const l = roomToLocal(it, 61, 33);
      const back = localToRoom(it, l.x, l.y);
      assert.ok(Math.abs(back.x - 61) < 1e-9 && Math.abs(back.y - 33) < 1e-9, `rotation ${rot}`);
      const r = make('a', 'base', 50, 40, rot, 30);
      const b = itemRoomBox(r);
      for (const k of ['minX', 'minY', 'maxX', 'maxY'] as const) assert.ok(Math.abs(b[k] - r.box[k]) < 1e-9, `${k} at ${rot}`);
    }
  });

  test('the island under a pendant wins the press; selecting the pendant makes it grabbable', () => {
    const island = make('island', 'island', 100, 89, 0, 84);
    const pendant = make('pendant', 'pendant-dome', 100, 89);
    const all = [island, pendant];
    assert.equal(pickAt(all, 100, 89, mousePad, null).dragId, 'island');
    assert.equal(pickAt(all, 100, 89, mousePad, 'pendant').dragId, 'pendant');
    // Away from the pendant the island is grabbed even while the pendant is selected.
    assert.equal(pickAt(all, 70, 89, mousePad, 'pendant').dragId, 'island');
  });

  test('tapping a stack again cycles through it', () => {
    const island = make('island', 'island', 100, 89, 0, 84);
    const pendant = make('pendant', 'pendant-dome', 100, 89);
    const all = [island, pendant];
    assert.equal(pickAt(all, 100, 89, mousePad, null).tapId, 'island');
    assert.equal(pickAt(all, 100, 89, mousePad, 'island').tapId, 'pendant');
    assert.equal(pickAt(all, 100, 89, mousePad, 'pendant').tapId, 'island');
    // A single item stays selected on a second tap.
    assert.equal(pickAt([island], 100, 89, mousePad, 'island').tapId, 'island');
  });

  test('fridge beats the bridge cabinet over it; range beats the hood', () => {
    const fridge = make('fridge', 'fridge-36', 18, 15);
    const bridge = make('bridge', 'bridge', 18, 12);
    const range = make('range', 'range-30', 80, 13);
    const hood = make('hood', 'hood-chimney', 80, 11);
    const all = [bridge, fridge, hood, range];
    assert.equal(pickAt(all, 18, 12, mousePad, null).dragId, 'fridge');
    assert.equal(pickAt(all, 80, 11, mousePad, null).dragId, 'range');
  });

  test('an unselected rug pans instead of dragging, but a tap selects it', () => {
    const rug = make('rug', 'rug-runner', 100, 78, 90);
    const stool = make('stool', 'stool', 100, 78);
    const p = pickAt([rug], 70, 78, mousePad, null); // runner turned 90: x 52..148, y 63..93
    assert.equal(p.dragId, null);
    assert.equal(p.tapId, 'rug');
    assert.equal(pickAt([rug], 70, 78, mousePad, 'rug').dragId, 'rug');
    // A selected rug never steals the press from what stands on it.
    assert.equal(pickAt([rug, stool], 100, 78, mousePad, 'rug').dragId, 'stool');
    // And tapping a selected stool doesn't hop down to the rug.
    assert.equal(pickAt([rug, stool], 100, 78, mousePad, 'stool').tapId, 'stool');
  });

  test('touch padding gives small pieces a finger-sized target without stealing exact hits', () => {
    const stool = make('stool', 'stool', 100, 100);
    const big = make('big', 'island', 40, 100, 0, 60);
    const all = [stool, big];
    const scale = 1.2;
    const pad = (r: Resolved) => touchPad(r, scale);
    // 14in right of the stool's edge: nothing for a mouse, the stool for a finger.
    const x = 100 + stool.w / 2 + 12;
    assert.equal(hitsAt(all, x, 100, mousePad, null).length, 0);
    assert.equal(pickAt(all, x, 100, pad, null).dragId, 'stool');
    // Inside the island: the island, even though the padded stool is nearer than nothing.
    assert.equal(pickAt(all, 69, 100, pad, null).dragId, 'big');
    const hits = hitsAt(all, 69.5, 100, pad, null);
    assert.equal(hits[0].id, 'big');
    assert.equal(hits[0].exact, true);
  });

  test('cycleAfter with no exact hits falls back to the best padded one', () => {
    assert.equal(cycleAfter([], null), null);
    assert.equal(cycleAfter([{ id: 'a', exact: false, dist: 3, rank: 0, area: 1, rug: false }], null), 'a');
  });
});

describe('drag feedback', () => {
  test('a base flush on the north wall reports the wall, the neighbour edge it abuts and the gaps', () => {
    const a = make('a', 'base', 15, 12, 0, 30); // x 0..30, y 0..24
    const b = make('b', 'base', 45, 12, 0, 30); // x 30..60
    const fb = dragFeedback(b, [a, b], ROOM);
    assert.equal(fb.wall, 'north');
    assert.deepEqual(fb.wallLine, { x1: 0, y1: 0, x2: 200, y2: 0 });
    assert.ok(fb.guides.some((g) => g.x1 === 30 && g.x2 === 30), 'guide on the shared edge');
    const east = fb.gaps.find((g) => g.x1 === 60);
    assert.ok(east, 'gap to the east wall');
    assert.equal(east.value, 140);
    assert.equal(east.to, 'wall');
    // West side touches the neighbour: no gap shown. South: open to the far wall.
    assert.ok(!fb.gaps.some((g) => g.x2 === 30));
    assert.ok(fb.gaps.some((g) => g.y1 === 24 && g.value === 156 - 24));
    assert.equal(fb.overlaps.length, 0);
  });

  test('the gap to a neighbour ignores pieces at another height and seating', () => {
    const me = make('me', 'island', 100, 89, 0, 60); // x 70..130, y 68..110
    const upper = make('up', 'wall', 150, 89, 0, 30); // overhead, not in the way
    const run = make('run', 'base', 150, 89, 0, 20); // x 140..160
    const stool = make('stool', 'stool', 135, 89);
    const fb = dragFeedback(me, [me, upper, run, stool], ROOM);
    const east = fb.gaps.find((g) => g.x1 === 130);
    assert.ok(east);
    assert.equal(east.value, 10);
    assert.equal(east.to, 'item');
  });

  test('overlapping a piece at the same height is reported with the intersection', () => {
    const a = make('a', 'base', 15, 12, 0, 30);
    const b = make('b', 'base', 35, 12, 0, 30); // x 20..50 overlaps a by 10
    const fb = dragFeedback(b, [a, b], ROOM);
    assert.deepEqual(fb.overlapIds, ['a']);
    assert.deepEqual(fb.overlaps[0], { minX: 20, minY: 0, maxX: 30, maxY: 24 });
    // A pendant over it is not a collision.
    const p = make('p', 'pendant-dome', 35, 12);
    assert.equal(dragFeedback(p, [a, b, p], ROOM).overlaps.length, 0);
  });

  test('an opening reports distances along its wall to the next opening or the corner', () => {
    const w1 = make('w1', 'window', 60, 0, 0);
    const w2 = make('w2', 'window', 140, 0, 0);
    const fb = dragFeedback(w2, [w1, w2], ROOM, 8);
    assert.equal(fb.wall, 'north');
    const vals = fb.gaps.map((g) => [g.to, Math.round(g.value)]);
    assert.ok(vals.some(([to]) => to === 'item'), JSON.stringify(vals));
    assert.ok(vals.some(([to]) => to === 'wall'), JSON.stringify(vals));
  });
});
