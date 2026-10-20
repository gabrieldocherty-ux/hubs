import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { boxInRoom, flushSeg, resolve, snapItem } from './geometry';
import { cleanOutline, normalizeOutline, outlineProblem, pointInRoom, rectOutline, segsOf, snapDrawPoint, withOutline, type Pt } from './outline';
import { cleanRoom } from './doc';
import type { PlacedItem, Room } from '../types';

const L: Pt[] = [[0, 0], [240, 0], [240, 96], [144, 96], [144, 168], [0, 168]];
const room: Room = withOutline({ widthIn: 240, lengthIn: 168, ceilingIn: 108 }, L);

describe('outline', () => {
  test('a rectangle gives the four classic walls in north, east, south, west order', () => {
    const s = segsOf(rectOutline(200, 156));
    assert.deepEqual(s.map((x) => [x.wall, x.at, x.a0, x.a1]), [['north', 0, 0, 200], ['east', 200, 0, 156], ['south', 156, 0, 200], ['west', 0, 0, 156]]);
  });
  test('winding does not matter once normalized', () => {
    const a = segsOf(normalizeOutline(L)).map((x) => x.wall).sort();
    const b = segsOf(normalizeOutline([...L].reverse())).map((x) => x.wall).sort();
    assert.deepEqual(a, b);
  });
  test('an L has six walls, two of them facing the same way', () => {
    const walls = segsOf(normalizeOutline(L)).map((x) => x.wall);
    assert.equal(walls.length, 6);
    assert.equal(walls.filter((w) => w === 'north').length, 1);
    assert.equal(walls.filter((w) => w === 'east').length, 2);
  });
  test('collinear points merge', () => {
    assert.equal(cleanOutline([[0, 0], [100, 0], [200, 0], [200, 100], [0, 100]]).length, 4);
  });
  test('problems are reported in plain words', () => {
    assert.match(outlineProblem([[0, 0], [100, 0], [200, 100], [0, 100]]) ?? '', /straight/);
    assert.match(outlineProblem([[0, 0], [100, 0], [100, 100], [50, 100], [50, 95], [0, 95]]) ?? '', /shorter than 1/);
    assert.equal(outlineProblem(L), null);
    // a bow-tie: two walls cross
    assert.match(outlineProblem([[0, 0], [100, 0], [100, 50], [50, 50], [50, -50], [0, -50], [0, 0], [0, 60]]) ?? '', /cross|shorter|straight|four/);
  });
  test('inside and outside, including the notch of the L', () => {
    assert.equal(pointInRoom(room, 50, 50), true);
    assert.equal(pointInRoom(room, 200, 140), false);
    assert.equal(pointInRoom(room, 200, 50), true);
  });
  test('cleanRoom keeps a valid outline and drops a bad one', () => {
    assert.deepEqual(cleanRoom(room).outline, L);
    assert.equal(cleanRoom({ ...room, outline: [[0, 0], [100, 0], [200, 100], [0, 100]] }).outline, undefined);
  });
  test('drawing snaps square, to corners, and to the grid', () => {
    const corner = snapDrawPoint([3, 4], null, [[0, 0]]);
    assert.deepEqual(corner.point, [0, 0]);
    assert.equal(corner.kind, 'corner');
    const square = snapDrawPoint([101, 37], [0, 0], []);
    assert.deepEqual(square.point, [102, 0]);
    const aligned = snapDrawPoint([138, 40], [0, 40], [[144, 96]]);
    assert.deepEqual(aligned.point, [144, 40]);
  });
});

describe('geometry on a drawn room', () => {
  const mk = (id: string, productId: string, x: number, y: number, rotation: PlacedItem['rotation']): PlacedItem => ({ id, productId, x, y, rotation, finishIndex: 0 });
  test('free pieces are kept out of the notch', () => {
    const island = resolve(mk('i', 'island', 200, 140, 0));
    assert.ok(island);
    const p = snapItem({ id: 'i', x: 200, y: 140, rotation: 0 }, island.product, island.w, room, []);
    assert.equal(boxInRoom(room, { minX: p.x - island.w / 2, maxX: p.x + island.w / 2, minY: p.y - island.product.depthIn / 2, maxY: p.y + island.product.depthIn / 2 }, 0.5), true);
  });
  test('a cabinet dropped near the inner wall of the L snaps to it and faces into the room', () => {
    const base = resolve(mk('b', 'base', 100, 130, 0));
    assert.ok(base);
    // The inside wall at x=144 runs y 96..168 and faces west (the room is to its west): an east wall.
    const p = snapItem({ id: 'b', x: 138, y: 140, rotation: 0 }, base.product, base.w, room, []);
    assert.equal(p.wall, 'east');
    assert.equal(p.rotation, 90);
    assert.ok(Math.abs(p.x - (144 - base.product.depthIn / 2)) < 0.01);
    const placed = resolve(mk('b', 'base', p.x, p.y, p.rotation));
    assert.ok(placed);
    assert.equal(flushSeg(placed, room)?.at, 144);
  });
});

import { bumpEdge, closeDrawing, outlinesOverlap, setEdgeLength } from './outline';

describe('editing operations', () => {
  test('a bump-out on the north wall adds four corners and grows the room outward', () => {
    const r = normalizeOutline(rectOutline(240, 168));
    const out = bumpEdge(r, 0, 60, 120, 24);
    assert.ok(out);
    assert.equal(outlineProblem(out), null);
    assert.equal(out.length, 8);
    assert.equal(Math.min(...out.map((p) => p[1])), -24);
  });
  test('a notch (negative depth) on the east wall goes inward', () => {
    const r = normalizeOutline(rectOutline(240, 168));
    const out = bumpEdge(r, 1, 40, 100, -18);
    assert.ok(out);
    assert.equal(outlineProblem(out), null);
    assert.equal(Math.max(...out.map((p) => p[0])), 240);
    assert.ok(out.some((p) => p[0] === 222));
  });
  test('setting a wall length moves the wall at its far end', () => {
    const r = normalizeOutline(rectOutline(240, 168));
    const out = setEdgeLength(r, 0, 300);
    assert.deepEqual(out[1], [300, 0]);
    assert.deepEqual(out[2], [300, 168]);
  });
  test('closing a three-corner path adds the square corner', () => {
    assert.deepEqual(closeDrawing([[0, 0], [100, 0], [100, 80]]), [[0, 0], [100, 0], [100, 80], [0, 80]]);
  });
  test('overlapping rooms are found; touching rooms are not', () => {
    assert.equal(outlinesOverlap(rectOutline(100, 100), [[50, 50], [150, 50], [150, 150], [50, 150]]), true);
    assert.equal(outlinesOverlap(rectOutline(100, 100), [[100, 0], [200, 0], [200, 100], [100, 100]]), false);
  });
});

import { parseLengthIn } from './outline';

describe('parseLengthIn', () => {
  test('reads lengths the way designers type them', () => {
    assert.equal(parseLengthIn("12'6"), 150);
    assert.equal(parseLengthIn('12\' 6"'), 150);
    assert.equal(parseLengthIn('12-6'), 150);
    assert.equal(parseLengthIn('12 6'), 150);
    assert.equal(parseLengthIn('12.5'), 150);
    assert.equal(parseLengthIn('12'), 144);
    assert.equal(parseLengthIn('150"'), 150);
    assert.equal(parseLengthIn('150in'), 150);
    assert.equal(parseLengthIn("9'"), 108);
    assert.equal(parseLengthIn('abc'), null);
    assert.equal(parseLengthIn(''), null);
  });
});

import { floorRects } from './outline';

describe('floorRects', () => {
  test('an L splits into two rectangles that add up to its area', () => {
    const r = floorRects(normalizeOutline(L));
    const total = r.reduce((n, q) => n + (q.x1 - q.x0) * (q.y1 - q.y0), 0);
    assert.equal(total, 240 * 96 + 144 * 72);
  });
});
