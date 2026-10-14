import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grainBoxGeo, grainUV } from '../../../components/three/geom3d';

const TILE: [number, number] = [12, 24];
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('grainUV maps faces at real scale: a 3″ rail and a 30″ door show the same grain width', () => {
  // Front faces (normal +z). One inch across is 1/12 of a tile whatever the part's size.
  const rail = grainUV([0, 0, 1], [1, 0, 0], [3, 30, 0.75], TILE);
  const door = grainUV([0, 0, 1], [1, 0, 0], [30, 30, 0.75], TILE);
  assert.ok(close(rail[0], 1 / 12) && close(door[0], 1 / 12));
});

test('grain runs up stiles, doors and cabinet sides, and along rails, drawer fronts and shelves', () => {
  // A stile (2 × 30, front): moving up moves along v (the grain).
  const up = grainUV([0, 0, 1], [0, 6, 0], [2, 30, 0.75], TILE);
  assert.ok(close(up[0], 0) && close(up[1], 6 / 24));
  // A rail (24 × 2.5, front): moving along x moves along v.
  const rail = grainUV([0, 0, 1], [6, 0, 0], [24, 2.5, 0.75], TILE);
  assert.ok(close(rail[0], 0) && close(rail[1], 6 / 24));
  // A cabinet side (normal +x, 24 deep × 30 high): vertical grain; depth runs across.
  const side = grainUV([1, 0, 0], [12, 0, 6], [24, 30, 24], TILE);
  assert.ok(close(side[0], 6 / 12) && close(side[1], 0));
  // A shelf top (30 wide × 12 deep): the grain follows the 30″ side (x).
  const shelf = grainUV([0, 1, 0], [6, 1, 0], [30, 1, 12], TILE);
  assert.ok(close(shelf[1], 6 / 24) && close(shelf[0], 0));
  // A deep top (12 wide × 30 deep): the grain follows z.
  const deep = grainUV([0, 1, 0], [0, 1, 6], [12, 1, 30], TILE);
  assert.ok(close(deep[1], 6 / 24) && close(deep[0], 0));
});

test('grainBoxGeo is shared per size and tile, and its UVs are in tiles, not 0..1 per face', () => {
  const a = grainBoxGeo(30, 30, 0.75, TILE);
  assert.equal(grainBoxGeo(30, 30, 0.75, TILE), a);
  const uv = a.getAttribute('uv');
  let maxU = 0;
  for (let i = 0; i < uv.count; i++) maxU = Math.max(maxU, Math.abs(uv.getX(i)));
  // A 30″ face spans ±15″, i.e. ±1.25 tiles across.
  assert.ok(close(maxU, 15 / 12), `max |u| ${maxU}`);
});
