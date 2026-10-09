import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PlacedItem, Room, Rotation } from '../../../types';
import { resolveAll } from '../../geometry';
import { bestTriangle, hoodCoverage, landingWidths, runChecks } from '../../checks';

// Regression tests for the checks fixes (BUILD_PLAN D-T1, known bugs #6 and #28). Each one is a
// layout the old checks got wrong.

const ROOM: Room = { widthIn: 200, lengthIn: 156, ceilingIn: 108 };
let seq = 0;
const it = (productId: string, x: number, y: number, rotation: Rotation = 0, widthIn?: number): PlacedItem => ({
  id: `t${++seq}`,
  productId,
  x,
  y,
  rotation,
  finishIndex: 0,
  ...(widthIn ? { widthIn } : {}),
});

const report = (items: PlacedItem[]) => runChecks(resolveAll(items), ROOM);
const ids = (items: PlacedItem[]) => report(items).checks.map((c) => `${c.level}:${c.id}`);

test('hood on a west wall that misses the range does not "cover" it (the map example)', () => {
  // Range along the west wall at Y 100..130; hood at Y 125..155. The old check compared x
  // extents only, which overlap for anything on the same wall, so it reported "covers".
  const range = it('range-30', 14, 115, 270);
  const hood = it('hood-chimney', 10, 140, 270);
  const checks = report([range, hood]).checks;
  assert.ok(!checks.some((c) => c.id === `vent-ok-${range.id}`), 'must not report the hood covers the range');
  const vent = checks.find((c) => c.id === `vent-${range.id}`);
  assert.equal(vent?.level, 'warn');
  assert.equal(hoodCoverage(resolveAll([range, hood])[0], resolveAll([range, hood])), null);
});

test('a hood centred over a range on the east or west wall does cover it', () => {
  for (const [rot, x, hx] of [
    [270, 14, 10],
    [90, ROOM.widthIn - 14, ROOM.widthIn - 10],
  ] as [Rotation, number, number][]) {
    const range = it('range-30', x, 115, rot);
    const hood = it('hood-chimney', hx, 115, rot);
    assert.ok(ids([range, hood]).includes(`ok:vent-ok-${range.id}`), `rotation ${rot}`);
  }
});

test('a hood that covers only part of the range is reported off-centre', () => {
  const range = it('range-30', 115, 14); // north wall, X 100..130
  const hood = it('hood-chimney', 127, 10); // X 112..142: 18″ of the 30″ cooktop
  const c = report([range, hood]).checks.find((k) => k.id.startsWith('vent-'));
  assert.equal(c?.id, `vent-offset-${range.id}`);
  assert.equal(c?.level, 'warn');
});

test('range landing measures real widths: 9″ + 30″ fails, 12″ + 15″ passes', () => {
  // The old check passed any piece 9″ or wider on each side.
  const range = it('range-30', 115, 14); // X 100..130
  const left9 = it('base', 95.5, 12, 0, 9); // X 91..100
  const right30 = it('base', 145, 12, 0, 30); // X 130..160
  const bad = report([range, left9, right30]).checks.find((c) => c.id === `landing-range-${range.id}`);
  assert.equal(bad?.level, 'warn');
  assert.match(bad!.title, /only 9"/);

  const left12 = it('base', 94, 12, 0, 12); // X 88..100
  const right15 = it('base', 137.5, 12, 0, 15); // X 130..145
  assert.ok(!report([range, left12, right15]).checks.some((c) => c.id === `landing-range-${range.id}`));
});

test('landing runs across touching pieces and stops at a sink', () => {
  const range = it('range-30', 115, 14); // X 100..130
  const a = it('base', 95.5, 12, 0, 9); // X 91..100
  const b = it('base', 86.5, 12, 0, 9); // X 82..91 → 18″ in total
  const right = it('base', 142, 12, 0, 24); // X 130..154
  const all = resolveAll([range, a, b, right]);
  assert.deepEqual(landingWidths(all[0], all, ROOM), { start: 18, end: 24 });

  const sink = it('sink-under', 116.5, 12, 0, 33); // X 100..133, then a base X 133..157
  const after = it('base', 145, 12, 0, 24);
  const fridge = it('fridge-36', 18, 15); // X 0..36, nothing touching
  const all2 = resolveAll([sink, after, fridge]);
  assert.deepEqual(landingWidths(all2[2], all2, ROOM), { start: 0, end: 0 });
});

test('fridge landing needs 15″, not any 9″ piece', () => {
  const fridge = it('fridge-36', 18, 15); // X 0..36
  const twelve = it('base', 42, 12, 0, 12); // X 36..48
  const warn = report([fridge, twelve]).checks.find((c) => c.id === `landing-fridge-${fridge.id}`);
  assert.equal(warn?.level, 'warn');
  const fifteen = it('base', 43.5, 12, 0, 15); // X 36..51
  assert.ok(!report([fridge, fifteen]).checks.some((c) => c.id === `landing-fridge-${fridge.id}`));
});

test('appliances away from a wall report info instead of auto-passing', () => {
  const range = it('range-30', 100, 80);
  const fridge = it('fridge-36', 150, 80);
  const checks = report([range, fridge]).checks;
  assert.equal(checks.find((c) => c.id === `landing-range-${range.id}`)?.level, 'info');
  assert.equal(checks.find((c) => c.id === `landing-fridge-${fridge.id}`)?.level, 'info');
});

test('the work triangle uses the best combination, whatever the item order', () => {
  const sink = it('sink-under', 100, 12); // north wall
  const range = it('range-30', 14, 80, 270); // west wall
  const farFridge = it('fridge-36', ROOM.widthIn - 15, 130, 90); // far south-east corner
  const nearFridge = it('fridge-36', 14 + 1, 30, 270); // west wall near the corner
  // Old code took the first fridge in the list.
  const a = report([sink, range, farFridge, nearFridge]).triangle!;
  const b = report([nearFridge, farFridge, range, sink]).triangle!;
  assert.ok(a && b);
  assert.equal(Math.round(a.total), Math.round(b.total));
  const all = resolveAll([sink, range, farFridge, nearFridge]);
  assert.equal(bestTriangle(all, ROOM)?.fridge.item.id, nearFridge.id);
});

test('a prep sink stands in only when there is no main sink', () => {
  const prep = it('sink-prep', 40, 12, 0);
  const main = it('sink-under', 120, 12, 0);
  const range = it('range-30', 14, 80, 270);
  const fridge = it('fridge-36', 15, 130, 270);
  const all = resolveAll([prep, main, range, fridge]);
  assert.equal(bestTriangle(all, ROOM)?.sink.item.id, main.id);
  const noMain = resolveAll([prep, range, fridge]);
  assert.equal(bestTriangle(noMain, ROOM)?.sink.item.id, prep.id);
});
