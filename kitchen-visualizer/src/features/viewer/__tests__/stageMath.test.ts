import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dimText, fitDistance, pickWidth, productHash, stageCamera, stageFrame, widthChoices, PENDANT_CORD_IN, PENDANT_FLOAT_IN } from '../stageMath';
import { capSize } from '../studio';
import { feetInches } from '../../../lib/format';

const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('a floor product sits on the stage floor as declared', () => {
  const f = stageFrame({ w: 30, d: 27, h: 36, elevationIn: 0, kind: 'range' });
  assert.equal(f.lift, 0);
  assert.equal(f.bottom, 0);
  assert.equal(f.top, 36);
  assert.deepEqual(f.box, { min: [-15, 0, -13.5], max: [15, 36, 13.5] });
  // No chimney or cord above it.
  assert.equal(f.ceilingIn, 36);
});

test('a wall cabinet is brought down to the floor (lift = −elevation)', () => {
  const f = stageFrame({ w: 30, d: 12, h: 30, elevationIn: 54, kind: 'wall' });
  assert.equal(f.lift, -54);
  assert.equal(f.bottom, 0);
  assert.equal(f.top, 30);
  assert.equal(f.ceilingIn, 84);
});

test('a pendant floats above the floor on a short cord, and the cord is framed', () => {
  const f = stageFrame({ w: 14, d: 14, h: 11, elevationIn: 66, kind: 'pendant' });
  assert.equal(f.bottom, PENDANT_FLOAT_IN);
  assert.equal(f.lift, PENDANT_FLOAT_IN - 66);
  assert.equal(f.top, PENDANT_FLOAT_IN + 11);
  assert.equal(f.ceilingIn, 66 + 11 + PENDANT_CORD_IN);
  assert.equal(f.box.max[1], PENDANT_FLOAT_IN + 11 + PENDANT_CORD_IN);
});

test('fitDistance: a sphere touches the narrower field of view', () => {
  // 90° vertical fov, square: sin(45°) → r / 0.7071.
  close(fitDistance(1, 90, 1, 1), 1 / Math.sin(Math.PI / 4));
  // A tall, narrow canvas is limited by the horizontal fov, so the camera backs off.
  assert.ok(fitDistance(1, 40, 0.5, 1) > fitDistance(1, 40, 1, 1));
  // A wide canvas is limited by the vertical fov: the same as square.
  close(fitDistance(1, 40, 2, 1), fitDistance(1, 40, 1, 1));
  // The margin scales linearly.
  close(fitDistance(2, 30, 1.5, 1.1), fitDistance(2, 30, 1.5, 1) * 1.1);
});

test('stageCamera aims at the box centre (feet) and keeps the whole sphere in view', () => {
  const f = stageFrame({ w: 30, d: 27, h: 36, elevationIn: 0, kind: 'range' });
  const cam = stageCamera(f, 32, 4 / 3);
  close(cam.target[0], 0);
  close(cam.target[1], 1.5); // 18 in
  close(cam.target[2], 0);
  const r = Math.hypot(30, 36, 27) / 24;
  close(cam.radius, r);
  const dist = Math.hypot(cam.position[0] - cam.target[0], cam.position[1] - cam.target[1], cam.position[2] - cam.target[2]);
  close(dist, cam.distance);
  assert.ok(dist * Math.sin((32 * Math.PI) / 360) >= r, 'the bounding sphere fits the vertical fov');
  assert.ok(cam.minDistance > r && cam.maxDistance > dist);
  // In front (+z) and a little to the right and above.
  assert.ok(cam.position[2] > 0 && cam.position[0] > 0 && cam.position[1] > cam.target[1]);
});

test('dimText gives feet-inches and centimetres', () => {
  assert.equal(dimText(30, feetInches), `2' 6" · 76.2 cm`);
  assert.equal(dimText(84, feetInches), `7' 0" · 213 cm`);
  assert.equal(dimText(8, feetInches), `8" · 20.3 cm`);
});

test('width choices and the width in the URL', () => {
  assert.deepEqual(widthChoices(30, [36, 24, 30]), [24, 30, 36]);
  assert.deepEqual(widthChoices(30, undefined), [30]);
  assert.equal(pickWidth('36', 30, [24, 30, 36]), 36);
  assert.equal(pickWidth('33', 30, [24, 30, 36]), 30, 'a width the product does not offer falls back');
  assert.equal(pickWidth(null, 30, [24, 36]), 30);
  assert.equal(pickWidth('nonsense', 30, [24, 36]), 30);
});

test('productHash keeps finish and a non-default width in the URL', () => {
  assert.equal(productHash('range-30', undefined, 30, 30), '#/p/range-30');
  assert.equal(productHash('range-30', 'black-steel', 30, 30), '#/p/range-30?finish=black-steel');
  assert.equal(productHash('base-drawer', 'sage', 36, 30), '#/p/base-drawer?finish=sage&w=36');
});

test('capSize keeps the aspect ratio under the long-side cap', () => {
  assert.deepEqual(capSize(3840, 2160, 4096), { width: 3840, height: 2160, capped: false });
  assert.deepEqual(capSize(3840, 2160, 2048), { width: 2048, height: 1152, capped: true });
  assert.deepEqual(capSize(1080, 1920, 1024), { width: 576, height: 1024, capped: true });
});
