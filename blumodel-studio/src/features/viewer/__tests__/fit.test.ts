import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFit, castsShadow, fitTransform, IN_PER_M, slotOf } from '../../../components/three/fit';

const close = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('a model already at its declared size keeps metres → inches (uniform 39.37)', () => {
  // 30 × 36 × 28 in, as a glTF in metres with its base centred on the origin.
  const w = 30 / IN_PER_M;
  const h = 36 / IN_PER_M;
  const d = 28 / IN_PER_M;
  const fit = fitTransform({ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] }, { w: 30, h: 36, d: 28 });
  close(fit.scale, IN_PER_M, 1e-9);
  close(fit.size.w, 30, 1e-9);
  close(fit.size.h, 36, 1e-9);
  close(fit.size.d, 28, 1e-9);
});

test('scale is uniform and limited by the tightest axis (min ratio)', () => {
  // A 1 × 1 × 1 m cube into 30 × 36 × 24 in: depth limits it (24 / 1).
  const fit = fitTransform({ min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, { w: 30, h: 36, d: 24 });
  close(fit.scale, 24);
  close(fit.size.w, 24);
  close(fit.size.h, 24);
  close(fit.size.d, 24);
  // Within 1% of the min-ratio scaling on every axis, and never larger than the declared box.
  assert.ok(fit.size.w <= 30 + 1e-9 && fit.size.h <= 36 + 1e-9 && fit.size.d <= 24 + 1e-9);
});

test('the fitted model is centred on x and z and sits on y = 0', () => {
  // An off-centre box: x 1..3, y -2..0, z 5..6 (model units).
  const fit = fitTransform({ min: [1, -2, 5], max: [3, 0, 6] }, { w: 20, h: 20, d: 10 });
  close(fit.scale, 10); // x: 20/2 = 10, y: 20/2 = 10, z: 10/1 = 10
  const lo = applyFit(fit, [1, -2, 5]);
  const hi = applyFit(fit, [3, 0, 6]);
  close((lo[0] + hi[0]) / 2, 0);
  close((lo[2] + hi[2]) / 2, 0);
  close(lo[1], 0);
  close(hi[1], 20);
});

test('a flat axis does not constrain the fit; an empty model keeps real size', () => {
  const rug = fitTransform({ min: [-1, 0, -0.75], max: [1, 0, 0.75] }, { w: 96, h: 0.5, d: 60 });
  close(rug.scale, 40); // min(96/2, 60/1.5) = min(48, 40)
  const empty = fitTransform({ min: [0, 0, 0], max: [0, 0, 0] }, { w: 10, h: 10, d: 10 });
  close(empty.scale, IN_PER_M);
});

test('material slots by name, tolerant of exporter suffixes', () => {
  assert.equal(slotOf('blumodel_finish'), 'finish');
  assert.equal(slotOf('blumodel_finish.001'), 'finish');
  assert.equal(slotOf('BLUMODEL_Cabinet_2'), 'cabinet');
  assert.equal(slotOf('blumodel_hardware'), 'hardware');
  assert.equal(slotOf('blumodel_counter'), 'counter');
  assert.equal(slotOf('blumodel_finishes'), null);
  // Models made before the rename name their slots mise_*: they still re-tint.
  assert.equal(slotOf('mise_finish'), 'finish');
  assert.equal(slotOf('MISE_Cabinet.001'), 'cabinet');
  assert.equal(slotOf('mise_hardware_2'), 'hardware');
  assert.equal(slotOf('mise_counter'), 'counter');
  assert.equal(slotOf('misc_finish'), null);
  assert.equal(slotOf('body'), null);
  assert.equal(slotOf(undefined), null);
});

test('only large meshes cast shadows', () => {
  assert.equal(castsShadow({ w: 30, h: 36, d: 24 }), true);
  assert.equal(castsShadow({ w: 1, h: 1, d: 6 }), false); // a knob
  assert.equal(castsShadow({ w: 20, h: 0.5, d: 0.5 }), false); // a thin bar pull
});
