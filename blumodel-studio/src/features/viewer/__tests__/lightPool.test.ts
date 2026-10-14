import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignPendantLights, MAX_LIGHTS, pendantIntensity } from '../../../components/three/lightPool';

const pendant = (i: number, variant?: string) => ({ id: `p${i}`, x: 10 * i, y: 50, elevationIn: 66, variant });

test('always exactly MAX_LIGHTS slots, whatever the number of pendants', () => {
  for (const n of [0, 1, 3, MAX_LIGHTS, MAX_LIGHTS + 4]) {
    const slots = assignPendantLights(Array.from({ length: n }, (_, i) => pendant(i)));
    assert.equal(slots.length, MAX_LIGHTS);
    assert.equal(slots.filter((s) => s.intensity > 0).length, Math.min(n, MAX_LIGHTS));
  }
});

test('lights go to the first pendants in item order, 1″ under the shade', () => {
  const slots = assignPendantLights([pendant(0), pendant(1, 'linear'), pendant(2)], 4);
  assert.deepEqual(
    slots.map((s) => s.itemId),
    ['p0', 'p1', 'p2', null],
  );
  assert.deepEqual(slots[1].pos, [10, 65, 50]);
  assert.equal(slots[1].intensity, pendantIntensity('linear'));
  assert.equal(slots[0].intensity, pendantIntensity('dome'));
  assert.equal(slots[3].intensity, 0);
});

test('the assignment is deterministic (same input, same output)', () => {
  const list = Array.from({ length: 8 }, (_, i) => pendant(i));
  assert.deepEqual(assignPendantLights(list), assignPendantLights(list.slice()));
});

test('adding a pendant beyond the pool changes no slot', () => {
  const six = Array.from({ length: MAX_LIGHTS }, (_, i) => pendant(i));
  assert.deepEqual(assignPendantLights(six), assignPendantLights([...six, pendant(99)]));
});
