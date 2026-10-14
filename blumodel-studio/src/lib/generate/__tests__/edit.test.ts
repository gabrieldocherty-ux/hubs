import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePhotoModel, type PhotoModel } from '../photoModel';
import {
  addAppliance,
  addOpening,
  addRun,
  confirmField,
  formatLength,
  freeSpot,
  fromCm,
  needsCheck,
  removeItem,
  setIsland,
  setRoom,
  setStyle,
  toCm,
  uncheckedKeys,
  updateItem,
} from '../edit';

const analysed = (): PhotoModel =>
  validatePhotoModel({
    room: { widthIn: 168, lengthIn: 144, ceilingIn: 108, confidence: 0.9 },
    openings: [
      { type: 'window', wall: 'north', offsetIn: 60, widthIn: 36, confidence: 0.4 },
      { type: 'door', wall: 'east', offsetIn: 50, widthIn: 32, confidence: 0.95 },
      { type: 'window', wall: 'west', offsetIn: 20, widthIn: 30, confidence: 0.3 },
    ],
    runs: [
      { wall: 'north', startIn: 0, endIn: 168, upper: true, confidence: 0.5 },
      { wall: 'west', startIn: 0, endIn: 120, upper: false, confidence: 0.8 },
    ],
    appliances: [{ kind: 'sink', wall: 'north', offsetIn: 60, widthIn: 33, confidence: 0.2 }],
    island: { widthIn: 72, depthIn: 36, seats: 2, confidence: 0.55 },
    style: { cabinetHex: '#2f3c52', confidence: 0.4 },
  })!.model;

test('low-confidence fields are listed in form order; editing or confirming one clears it', () => {
  const m = analysed();
  assert.deepEqual(uncheckedKeys(m), ['runs.0', 'appliances.0', 'openings.0', 'openings.2', 'island', 'style']);
  assert.equal(needsCheck(m, 'room'), false);
  assert.equal(needsCheck(m, 'openings.1'), false);

  const a = updateItem(m, 'openings', 0, { offsetIn: 64 });
  assert.equal(a.openings[0].offsetIn, 64);
  assert.equal(needsCheck(a, 'openings.0'), false);
  assert.equal(needsCheck(a, 'openings.2'), true, 'other items keep their flag');

  const b = confirmField(m, 'style');
  assert.deepEqual(b.style, m.style, 'confirming changes nothing else');
  assert.equal(needsCheck(b, 'style'), false);
  assert.equal(needsCheck(setStyle(m, { counter: 'nero' }), 'style'), false);
  assert.equal(needsCheck(setIsland(m, { widthIn: 84, depthIn: 42, seats: 3 }), 'island'), false);
  assert.equal(setRoom(m, { widthIn: 170 }).confidence.room, undefined);
});

test('removing an item shifts the confidence of the items after it', () => {
  const m = removeItem(analysed(), 'openings', 0);
  assert.equal(m.openings.length, 2);
  assert.equal(m.openings[0].type, 'door');
  assert.equal(m.confidence['openings.0'], 0.95, 'the door keeps its confidence at its new index');
  assert.equal(m.confidence['openings.1'], 0.3, 'the west window keeps its flag');
  assert.equal(m.confidence['openings.2'], undefined);
  assert.equal(m.confidence['runs.0'], 0.5, 'other lists are untouched');
  assert.deepEqual(removeItem(m, 'openings', 9), m, 'an out-of-range index changes nothing');
});

test('a run never shrinks below a foot while one end is edited, and stays on its wall', () => {
  const m = analysed();
  const a = updateItem(m, 'runs', 1, { startIn: 115 });
  assert.equal(a.runs.length, 2, 'the run is kept');
  assert.ok(a.runs[1].endIn - a.runs[1].startIn >= 12);
  assert.equal(a.runs[1].startIn, 115);
  const b = updateItem(m, 'runs', 1, { endIn: 4 });
  assert.equal(b.runs[1].endIn, 12, 'the end stops at a foot from the start of the wall');
  assert.equal(b.runs[1].startIn, 0);
  const c = updateItem(m, 'runs', 0, { wall: 'west' });
  assert.equal(c.runs[0].wall, 'west');
  assert.ok(c.runs[0].endIn <= 144, 'a run moved to a shorter wall fits it');
  const d = updateItem(m, 'runs', 0, { endIn: 999 });
  assert.equal(d.runs[0].endIn, 168, 'clamped to the wall');
});

test('changing an appliance’s kind resets it to that kind’s standard width', () => {
  const m = updateItem(analysed(), 'appliances', 0, { kind: 'fridge' });
  assert.equal(m.appliances[0].kind, 'fridge');
  assert.equal(m.appliances[0].widthIn, 36);
  const n = updateItem(analysed(), 'appliances', 0, { kind: 'dishwasher', widthIn: 18 });
  assert.equal(n.appliances[0].widthIn, 18);
});

test('new things go in the biggest free stretch of their wall', () => {
  assert.equal(freeSpot(168, [], 36), 66);
  assert.equal(freeSpot(168, [[0, 100]], 36), 116);
  assert.equal(freeSpot(100, [[0, 90]], 36), 64, 'never past the end of the wall');
  const m = addOpening(analysed(), 'window', 'north');
  const w = m.openings[m.openings.length - 1];
  assert.equal(w.wall, 'north');
  assert.ok(w.offsetIn >= 96 || w.offsetIn + w.widthIn <= 60, 'clear of the window already there');

  const r = addRun(analysed());
  assert.equal(r.runs[2].wall, 'east', 'the first wall without cabinets');
  assert.equal(r.runs[2].endIn, 144);

  const withRange = addAppliance(analysed(), 'range', 'west');
  const hood = addAppliance(withRange, 'hood', 'west');
  const range = hood.appliances.find((a) => a.kind === 'range')!;
  const h = hood.appliances.find((a) => a.kind === 'hood')!;
  assert.equal(h.offsetIn + h.widthIn! / 2, range.offsetIn + range.widthIn! / 2, 'a hood is centred over the range');
});

test('removing the island takes its appliances with it', () => {
  const m = addAppliance(analysed(), 'sink', 'island');
  assert.equal(m.appliances.filter((a) => a.wall === 'island').length, 1);
  const n = setIsland(m, null);
  assert.equal(n.island, null);
  assert.equal(n.appliances.filter((a) => a.wall === 'island').length, 0);
  assert.equal(addAppliance(n, 'sink', 'island').appliances.length, n.appliances.length, 'no island, no island appliance');
});

test('units: centimetres round-trip to the half inch; labels read naturally', () => {
  assert.equal(toCm(168), 427);
  assert.equal(fromCm(427), 168);
  assert.equal(fromCm(100), 39.5);
  assert.equal(formatLength(168, 'ftin'), '14′');
  assert.equal(formatLength(66.5, 'ftin'), '5′ 6.5″');
  assert.equal(formatLength(8, 'ftin'), '8″');
  assert.equal(formatLength(143.9, 'ftin'), '12′');
  assert.equal(formatLength(168, 'cm'), '427 cm');
});
