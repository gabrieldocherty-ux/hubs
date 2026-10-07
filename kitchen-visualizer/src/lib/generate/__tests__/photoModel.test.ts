import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DesignDoc, PlacedItem } from '../../../types';
import { getProduct } from '../../../data/catalog';
import { CABINET_FINISHES, COUNTERTOPS, BACKSPLASHES, FLOORING, HARDWARE, PAINTS } from '../../../data/finishes';
import { DEFAULT_SURFACES } from '../../../data/defaults';
import { buildTemplate, TEMPLATES } from '../../../data/templates';
import { alongWall, flushWall, outsideRoom, resolveAll, type Wall } from '../../geometry';
import { runChecks } from '../../checks';
import { FINISH_CHOICES } from '../../../../server/llm/photoModel.mjs';
import {
  buildFromPhotoModel,
  defaultPhotoModel,
  layoutOf,
  photoModelFromDoc,
  rescaleModel,
  SEED_LAYOUTS,
  seedLayout,
  validatePhotoModel,
  type PhotoModel,
} from '../photoModel';

const ROOM = { widthIn: 168, lengthIn: 144, ceilingIn: 108 };

function model(over: Partial<PhotoModel> = {}): PhotoModel {
  return validatePhotoModel({
    room: ROOM,
    openings: [],
    runs: [],
    appliances: [],
    island: null,
    style: {},
    ...over,
  })!.model;
}

/** An L kitchen: sink and dishwasher on the north wall, range, hood and fridge on the west. */
const L_KITCHEN = () =>
  model({
    openings: [
      { type: 'window', wall: 'north', offsetIn: 55, widthIn: 36, sillIn: 42 },
      { type: 'door', wall: 'east', offsetIn: 60, widthIn: 32 },
    ],
    runs: [
      { wall: 'north', startIn: 0, endIn: 168, upper: true },
      { wall: 'west', startIn: 0, endIn: 144, upper: true },
    ],
    appliances: [
      { kind: 'sink', wall: 'north', offsetIn: 60, widthIn: 33 },
      { kind: 'dishwasher', wall: 'north', offsetIn: 93, widthIn: 24 },
      { kind: 'range', wall: 'west', offsetIn: 60, widthIn: 30 },
      { kind: 'hood', wall: 'west', offsetIn: 60, widthIn: 30 },
      { kind: 'fridge', wall: 'west', offsetIn: 105, widthIn: 36 },
    ],
  });

const kindOf = (it: PlacedItem) => getProduct(it.productId)?.kind;
const strip = (items: PlacedItem[]) => items.map(({ id: _id, ...rest }) => rest);
const bads = (doc: DesignDoc) => runChecks(resolveAll(doc.items), doc.room).checks.filter((c) => c.level === 'bad');

function placedOn(doc: DesignDoc, kind: string): { wall: Wall | null; start: number; end: number }[] {
  return resolveAll(doc.items)
    .filter((r) => r.product.kind === kind)
    .map((r) => {
      const wall = flushWall(r, doc.room);
      const [start, end] = wall ? alongWall(wall, r.box) : [NaN, NaN];
      return { wall, start, end };
    });
}

// ─── Validation ──────────────────────────────────────────────────────────

test('validatePhotoModel clamps to the editor’s ranges and explains what it changed', () => {
  const r = validatePhotoModel({
    room: { widthIn: 600, lengthIn: 'x', ceilingIn: 40 },
    openings: [
      { type: 'window', wall: 'north', offsetIn: 470, widthIn: 36 },
      { type: 'skylight', wall: 'north', offsetIn: 0, widthIn: 36 },
      { type: 'door', wall: 'up', offsetIn: 0, widthIn: 36 },
    ],
    runs: [
      { wall: 'south', startIn: 300, endIn: 10, upper: false },
      { wall: 'east', startIn: 5, endIn: 9 },
    ],
    appliances: [
      { kind: 'fridge', wall: 'west', offsetIn: -20 },
      { kind: 'toaster', wall: 'west', offsetIn: 0 },
      { kind: 'sink', wall: 'island', offsetIn: 0 },
    ],
    island: null,
    style: { cabinetHex: '#2f3c51', cabinetDoor: 'glass', counter: '#222222', backsplash: 'nope', floor: 'checker', hardware: 'black' },
  })!;
  assert.ok(r);
  const m = r.model;
  assert.deepEqual(m.room, { widthIn: 480, lengthIn: 144, ceilingIn: 90 });
  assert.ok(r.warnings.some((w) => w.startsWith('Room width 600″')));
  assert.equal(m.openings.length, 1);
  assert.equal(m.openings[0].offsetIn, 480 - 36, 'kept inside the wall');
  assert.equal(m.runs.length, 1, 'the 4″ run is dropped');
  assert.deepEqual(m.runs[0], { wall: 'south', startIn: 10, endIn: 300, upper: false });
  assert.deepEqual(m.appliances, [{ kind: 'fridge', wall: 'west', offsetIn: 0, widthIn: 36 }], 'unknown kinds and island appliances without an island are dropped');
  assert.equal(m.style.cabinetDoor, 'glass');
  assert.equal(m.style.counter, 'nero', 'a colour maps to the closest counter');
  assert.equal(m.style.backsplash, 'subway-white', 'unknown ids fall back');
  assert.equal(m.style.floor, 'checker');
});

test('validatePhotoModel moves per-item confidence into the map and rejects junk', () => {
  const m = validatePhotoModel({
    room: { widthIn: 150, lengthIn: 130, ceilingIn: 100, confidence: 0.4 },
    openings: [{ type: 'window', wall: 'east', offsetIn: 10, widthIn: 30, confidence: 1.7 }],
    runs: [],
    appliances: [{ kind: 'range', wall: 'north', offsetIn: 40, confidence: 0.3 }],
    island: { widthIn: 80, depthIn: 40, seats: 9, confidence: 0.2 },
    style: { confidence: 0.9 },
  })!.model;
  assert.deepEqual(m.confidence, { room: 0.4, 'openings.0': 1, island: 0.2, 'appliances.0': 0.3, style: 0.9 });
  assert.equal(m.island?.seats, 6);
  for (const junk of [null, 'kitchen', 42, [], { room: 'big' }]) assert.equal(validatePhotoModel(junk), null);
});

test('the shared finish choices match src/data/finishes.ts', () => {
  const pairs: [string, { id: string; name: string; hex: string }[]][] = [
    ['cabinet', CABINET_FINISHES],
    ['countertop', COUNTERTOPS],
    ['backsplash', BACKSPLASHES],
    ['flooring', FLOORING],
    ['hardware', HARDWARE],
    ['paint', PAINTS],
  ];
  for (const [key, list] of pairs) {
    const shared = (FINISH_CHOICES as Record<string, { id: string; name: string; hex: string }[]>)[key];
    assert.deepEqual(shared, list.map((f) => ({ id: f.id, name: f.name, hex: f.hex })), key);
  }
});

// ─── Building ────────────────────────────────────────────────────────────

test('runs land on the right walls and appliances at the right offsets', () => {
  const { doc, notes } = buildFromPhotoModel(L_KITCHEN());
  assert.deepEqual(placedOn(doc, 'sink'), [{ wall: 'north', start: 60, end: 93 }]);
  assert.deepEqual(placedOn(doc, 'dishwasher'), [{ wall: 'north', start: 93, end: 117 }]);
  assert.deepEqual(placedOn(doc, 'range'), [{ wall: 'west', start: 60, end: 90 }]);
  assert.deepEqual(placedOn(doc, 'fridge'), [{ wall: 'west', start: 105, end: 141 }]);
  assert.equal(placedOn(doc, 'corner').length, 1, 'a corner cabinet where the runs meet');
  // Base cabinets fill both runs, wall cabinets go over them but not over the window or hood.
  const resolved = resolveAll(doc.items);
  const north = resolved.filter((r) => flushWall(r, doc.room) === 'north' && r.z0 < 30);
  assert.ok(north.reduce((s, r) => s + r.w, 0) >= 160, 'north run is filled');
  const uppers = resolved.filter((r) => r.product.kind === 'wall');
  assert.ok(uppers.length > 0);
  for (const u of uppers.filter((r) => flushWall(r, doc.room) === 'north')) {
    const [s, e] = alongWall('north', u.box);
    assert.ok(e <= 55 + 0.5 || s >= 91 - 0.5, 'no upper over the window');
  }
  assert.deepEqual(notes, []);
});

test('openings are placed where the photo shows them', () => {
  const { doc } = buildFromPhotoModel(L_KITCHEN());
  assert.deepEqual(placedOn(doc, 'window'), [{ wall: 'north', start: 55, end: 91 }]);
  assert.deepEqual(placedOn(doc, 'door'), [{ wall: 'east', start: 60, end: 92 }]);
});

test('the builder adds no bad checks, nothing outside the room, and the hood covers the range', () => {
  const { doc } = buildFromPhotoModel(L_KITCHEN());
  assert.deepEqual(bads(doc), []);
  const all = resolveAll(doc.items);
  assert.ok(all.every((r) => !outsideRoom(r, doc.room)));
  const checks = runChecks(all, doc.room).checks;
  assert.ok(checks.some((c) => c.id.startsWith('vent-ok-')));
  assert.equal(doc.version, 2);
  assert.ok(doc.items.every((i) => typeof i.finishId === 'string' || getProduct(i.productId)?.finishes === 'cabinet'));
});

test('building is deterministic (apart from item ids)', () => {
  const a = buildFromPhotoModel(L_KITCHEN());
  const b = buildFromPhotoModel(L_KITCHEN());
  assert.deepEqual(strip(a.doc.items), strip(b.doc.items));
  assert.deepEqual(a.notes, b.notes);
});

test('style is matched to Mise finishes', () => {
  const m = L_KITCHEN();
  m.style = { cabinetHex: '#304055', cabinetDoor: 'glass', counter: 'soapstone', backsplash: 'stack-ink', floor: 'oak-smoked', hardware: 'nickel', wall: 'fog' };
  const { doc } = buildFromPhotoModel(m);
  assert.deepEqual(doc.surfaces, { ...DEFAULT_SURFACES, cabinetFinishId: 'navy', doorStyle: 'shaker', countertopId: 'soapstone', backsplashId: 'stack-ink', flooringId: 'oak-smoked', hardwareId: 'nickel', paintId: 'fog' });
  assert.ok(doc.items.some((i) => i.productId === 'wall-glass'), 'glass doors become glass-front uppers');
});

test('a run is split around a door instead of blocking it', () => {
  const m = model({
    openings: [{ type: 'door', wall: 'north', offsetIn: 100, widthIn: 32 }],
    runs: [{ wall: 'north', startIn: 0, endIn: 168, upper: true }],
    appliances: [{ kind: 'sink', wall: 'north', offsetIn: 40, widthIn: 33 }],
  });
  const { doc } = buildFromPhotoModel(m);
  const floor = resolveAll(doc.items).filter((r) => r.product.kind !== 'door' && flushWall(r, doc.room) === 'north' && r.z0 < 30);
  for (const r of floor) {
    const [s, e] = alongWall('north', r.box);
    assert.ok(e <= 100 || s >= 132, `${r.product.id} at ${s}–${e} blocks the door`);
  }
  assert.ok(floor.some((r) => alongWall('north', r.box)[0] >= 132), 'cabinets continue past the door');
  assert.deepEqual(bads(doc), []);
});

test('an appliance in a corner where two runs meet steps out of the blind corner so its door opens', () => {
  // A fridge seen right in the corner would open into the west run's side: the west run takes
  // the corner, the north run starts flush against its front and the fridge moves along.
  const m = model({
    runs: [
      { wall: 'north', startIn: 0, endIn: 168, upper: false },
      { wall: 'west', startIn: 0, endIn: 144, upper: false },
    ],
    appliances: [{ kind: 'fridge', wall: 'north', offsetIn: 0, widthIn: 36 }],
  });
  const { doc, notes } = buildFromPhotoModel(m);
  assert.deepEqual(placedOn(doc, 'fridge'), [{ wall: 'north', start: 24, end: 60 }]);
  assert.equal(placedOn(doc, 'corner').length, 0);
  const west = resolveAll(doc.items).filter((r) => flushWall(r, doc.room) === 'west' && r.z0 < 30);
  assert.ok(west.some((r) => r.box.minY < 0.5), 'the west run goes into the corner');
  assert.ok(notes.some((n) => n.includes('fridge') && n.includes('moved 24″')));
  assert.deepEqual(bads(doc), []);
});

test('appliances that clash with a window or a door are left out with a note', () => {
  const m = model({
    openings: [
      { type: 'window', wall: 'north', offsetIn: 20, widthIn: 36, sillIn: 42 },
      { type: 'door', wall: 'west', offsetIn: 60, widthIn: 32 },
    ],
    runs: [{ wall: 'north', startIn: 0, endIn: 168, upper: true }],
    appliances: [
      { kind: 'fridge', wall: 'north', offsetIn: 10, widthIn: 36 },
      { kind: 'dishwasher', wall: 'west', offsetIn: 64, widthIn: 24 },
      { kind: 'sink', wall: 'north', offsetIn: 80 },
    ],
  });
  const { doc, notes } = buildFromPhotoModel(m);
  assert.equal(placedOn(doc, 'fridge').length, 0);
  assert.equal(placedOn(doc, 'dishwasher').length, 0);
  assert.equal(placedOn(doc, 'sink').length, 1);
  assert.ok(notes.some((n) => n.includes('fridge') && n.includes('window')));
  assert.ok(notes.some((n) => n.includes('dishwasher') && n.includes('door')));
});

test('a door seen a little too close to a corner moves clear of the next wall’s cabinets', () => {
  const m = model({
    openings: [{ type: 'door', wall: 'west', offsetIn: 14, widthIn: 32 }],
    runs: [{ wall: 'north', startIn: 0, endIn: 168, upper: false }],
  });
  const { doc, notes } = buildFromPhotoModel(m);
  assert.deepEqual(bads(doc), []);
  assert.deepEqual(placedOn(doc, 'door'), [{ wall: 'west', start: 24, end: 56 }]);
  assert.ok(notes.some((n) => n.includes('moved 10″')));
});

test('a door by a fridge in the corner moves past the fridge; the fridge stays', () => {
  const m = model({
    openings: [{ type: 'door', wall: 'west', offsetIn: 0, widthIn: 32 }],
    runs: [{ wall: 'north', startIn: 0, endIn: 168, upper: false }],
    appliances: [{ kind: 'fridge', wall: 'north', offsetIn: 0, widthIn: 36 }],
  });
  const { doc } = buildFromPhotoModel(m);
  assert.deepEqual(bads(doc), []);
  assert.deepEqual(placedOn(doc, 'fridge'), [{ wall: 'north', start: 0, end: 36 }]);
  assert.deepEqual(placedOn(doc, 'door'), [{ wall: 'west', start: 30, end: 62 }]);
});

test('a door near a corner where two runs meet: no corner cabinet, nothing dropped, no stray gaps', () => {
  for (const offsetIn of [10, 26]) {
    const m = model({
      openings: [{ type: 'door', wall: 'west', offsetIn, widthIn: 32 }],
      runs: [
        { wall: 'north', startIn: 0, endIn: 168, upper: false },
        { wall: 'west', startIn: 0, endIn: 144, upper: false },
      ],
    });
    const { doc } = buildFromPhotoModel(m);
    assert.deepEqual(bads(doc), [], `offset ${offsetIn}`);
    assert.equal(placedOn(doc, 'door').length, 1, `offset ${offsetIn}: the door is kept`);
    assert.equal(placedOn(doc, 'corner').length, 0);
  }
});

test('a door that cannot be moved clear keeps its place; the cabinets in its way are left out', () => {
  // A 72″ wall between two runs: no spot on it clears both.
  const m = model({
    room: { widthIn: 120, lengthIn: 72, ceilingIn: 96 },
    openings: [{ type: 'door', wall: 'west', offsetIn: 20, widthIn: 32 }],
    runs: [
      { wall: 'north', startIn: 0, endIn: 120, upper: false },
      { wall: 'south', startIn: 0, endIn: 120, upper: false },
    ],
  });
  const { doc, notes } = buildFromPhotoModel(m);
  assert.ok(!bads(doc).some((c) => /^(swing|overlap|outside)-/.test(c.id)));
  assert.deepEqual(placedOn(doc, 'door'), [{ wall: 'west', start: 20, end: 52 }]);
  assert.ok(notes.some((n) => n.includes('didn')));
});

test('overlapping windows and doors: the later one is left out with a note', () => {
  const m = model({
    openings: [
      { type: 'window', wall: 'south', offsetIn: 60, widthIn: 48, sillIn: 42 },
      { type: 'door', wall: 'south', offsetIn: 50, widthIn: 32 },
    ],
  });
  const { doc, notes } = buildFromPhotoModel(m);
  assert.equal(placedOn(doc, 'window').length, 1);
  assert.equal(placedOn(doc, 'door').length, 0);
  assert.ok(notes.some((n) => n.includes('door') && n.includes('overlaps a window')));
});

test('an island is placed with clear walkways, or left out with a note', () => {
  const big = model({
    room: { widthIn: 240, lengthIn: 200, ceilingIn: 108 },
    runs: [
      { wall: 'north', startIn: 0, endIn: 240, upper: true },
      { wall: 'west', startIn: 0, endIn: 200, upper: true },
    ],
    appliances: [{ kind: 'sink', wall: 'north', offsetIn: 90 }],
    island: { widthIn: 96, depthIn: 42, seats: 4, pendants: true },
  });
  const { doc } = buildFromPhotoModel(big);
  const island = doc.items.filter((i) => kindOf(i) === 'island');
  assert.equal(island.length, 1);
  assert.equal(doc.items.filter((i) => kindOf(i) === 'stool').length, 4);
  assert.equal(doc.items.filter((i) => kindOf(i) === 'pendant').length, 3);
  assert.deepEqual(bads(doc), []);

  const small = { ...big, room: { widthIn: 120, lengthIn: 110, ceilingIn: 96 } };
  const r = buildFromPhotoModel(model(small));
  assert.equal(r.doc.items.filter((i) => kindOf(i) === 'island').length, 0);
  assert.ok(r.notes.some((n) => n.toLowerCase().includes('island')));
  assert.deepEqual(bads(r.doc), []);
});

test('island appliances are reported, not silently dropped', () => {
  const m = model({
    room: { widthIn: 240, lengthIn: 200, ceilingIn: 108 },
    runs: [{ wall: 'north', startIn: 0, endIn: 240, upper: true }],
    island: { widthIn: 96, depthIn: 42, seats: 2 },
    appliances: [{ kind: 'sink', wall: 'island', offsetIn: 30 }],
  });
  const { notes } = buildFromPhotoModel(m);
  assert.ok(notes.some((n) => n.includes('island sink')));
});

// A small deterministic PRNG so the fuzz test is repeatable.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

test('fuzz: whatever the photo says, the builder never adds a collision, a wall poke-through, a door swing or a blocked island', () => {
  const r = rng(7);
  const walls: Wall[] = ['north', 'east', 'south', 'west'];
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const kinds = ['sink', 'range', 'cooktop', 'wall-oven', 'fridge', 'dishwasher', 'hood', 'microwave'] as const;
  for (let n = 0; n < 60; n++) {
    const room = { widthIn: 96 + Math.round(r() * 240), lengthIn: 96 + Math.round(r() * 200), ceilingIn: 96 + Math.round(r() * 24) };
    const len = (w: Wall) => (w === 'north' || w === 'south' ? room.widthIn : room.lengthIn);
    const runWalls = walls.filter(() => r() < 0.6);
    const m = model({
      room,
      runs: runWalls.map((w) => ({ wall: w, startIn: r() < 0.7 ? 0 : Math.round(r() * 40), endIn: len(w) - (r() < 0.7 ? 0 : Math.round(r() * 40)), upper: r() < 0.7 })),
      openings: Array.from({ length: Math.floor(r() * 4) }, () => {
        const w = pick(walls);
        return { type: r() < 0.5 ? 'window' : 'door', wall: w, offsetIn: Math.round(r() * len(w)), widthIn: 24 + Math.round(r() * 48), sillIn: 30 + Math.round(r() * 20) };
      }) as PhotoModel['openings'],
      appliances: Array.from({ length: Math.floor(r() * 7) }, () => {
        const w = pick(walls);
        return { kind: pick([...kinds]), wall: w, offsetIn: Math.round(r() * len(w)) };
      }),
      island: r() < 0.4 ? { widthIn: 60 + Math.round(r() * 48), depthIn: 42, seats: Math.floor(r() * 5), pendants: r() < 0.5 } : null,
    });
    const { doc, notes } = buildFromPhotoModel(m);
    const island = doc.items.find((i) => kindOf(i) === 'island');
    for (const c of bads(doc)) {
      assert.ok(!/^(overlap|outside|swing)-/.test(c.id), `case ${n}: ${c.id} ${c.title}`);
      assert.ok(!island || !c.itemIds.includes(island.id), `case ${n}: island ${c.title}`);
    }
    // Every door in the photo is in the kitchen (as a door or a cased opening), or a note says why not.
    const doors = m.openings.filter((o) => o.type === 'door').length;
    const placedDoors = doc.items.filter((i) => kindOf(i) === 'door').length;
    assert.ok(placedDoors >= doors || notes.some((x) => x.includes('door')), `case ${n}: ${doors - placedDoors} door(s) silently dropped`);
  }
});

test('fuzz: realistic photos (a layout, measured a few inches out, with windows and doors) build with no bad checks at all', () => {
  const r = rng(99);
  const walls: Wall[] = ['north', 'east', 'south', 'west'];
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const jitter = (v: number, k: number) => Math.round(v + (r() * 2 - 1) * k);
  for (let n = 0; n < 300; n++) {
    const room = { widthIn: 120 + Math.round(r() * 144), lengthIn: 108 + Math.round(r() * 132), ceilingIn: 96 + Math.round(r() * 24) };
    const len = (w: Wall) => (w === 'north' || w === 'south' ? room.widthIn : room.lengthIn);
    const seeded = seedLayout(pick(SEED_LAYOUTS).id, model({ room }));
    const m = model({
      ...seeded,
      runs: seeded.runs.map((x) => ({ ...x, startIn: x.startIn === 0 && r() < 0.8 ? 0 : jitter(x.startIn, 6), endIn: x.endIn === len(x.wall) && r() < 0.8 ? x.endIn : jitter(x.endIn, 6) })),
      appliances: seeded.appliances.map((a) => (a.wall === 'island' ? a : { ...a, offsetIn: jitter(a.offsetIn, 9) })),
      openings: [
        ...Array.from({ length: Math.floor(r() * 3) }, () => {
          const w = pick(walls);
          return { type: 'window' as const, wall: w, offsetIn: Math.round(r() * len(w)), widthIn: 24 + Math.round(r() * 36), sillIn: 36 + Math.round(r() * 12) };
        }),
        ...Array.from({ length: Math.floor(r() * 2) }, () => {
          const w = pick(walls);
          return { type: 'door' as const, wall: w, offsetIn: Math.round(r() * len(w)), widthIn: 30 + Math.round(r() * 6) };
        }),
      ],
    });
    const { doc } = buildFromPhotoModel(m);
    assert.deepEqual(bads(doc).map((c) => c.title), [], `case ${n}: ${JSON.stringify(m)}`);
  }
});

// ─── Seeding, scaling and round trips ────────────────────────────────────

test('every seed layout builds a working kitchen in a standard room', () => {
  for (const l of SEED_LAYOUTS) {
    const m = seedLayout(l.id, model({ room: { widthIn: 200, lengthIn: 180, ceilingIn: 108 } }));
    assert.equal(layoutOf(m), l.id === 'galley' ? 'galley' : l.id, l.id);
    const { doc } = buildFromPhotoModel(m);
    for (const k of ['sink', 'range', 'fridge']) assert.ok(doc.items.some((i) => kindOf(i) === k), `${l.id}: ${k}`);
    assert.deepEqual(bads(doc), [], l.id);
  }
});

test('seed layouts squeeze into small rooms without collisions', () => {
  for (const l of SEED_LAYOUTS) {
    const m = seedLayout(l.id, model({ room: { widthIn: 96, lengthIn: 96, ceilingIn: 96 } }));
    const { doc } = buildFromPhotoModel(m);
    for (const c of bads(doc)) assert.ok(!/^(overlap|outside|swing)-/.test(c.id), `${l.id}: ${c.title}`);
  }
});

test('the default model is an L-shape in the default style', () => {
  const m = defaultPhotoModel();
  assert.equal(layoutOf(m), 'l-shape');
  assert.deepEqual(m.confidence, {});
});

test('templates survive a round trip through the photo model', () => {
  const room = { widthIn: 200, lengthIn: 156, ceilingIn: 108 };
  for (const t of TEMPLATES) {
    const { items } = buildTemplate(t.id, room, DEFAULT_SURFACES);
    const doc = { name: '', room, surfaces: DEFAULT_SURFACES, items };
    const m = photoModelFromDoc(doc);
    const rebuilt = buildFromPhotoModel(m).doc;
    for (const kind of ['sink', 'range', 'fridge', 'dishwasher']) {
      const before = placedOn(doc, kind);
      const after = placedOn(rebuilt, kind);
      assert.equal(after.length, before.length, `${t.id} ${kind}`);
      before.forEach((b, i) => {
        assert.equal(after[i].wall, b.wall, `${t.id} ${kind} wall`);
        assert.ok(Math.abs(after[i].start - b.start) <= 6, `${t.id} ${kind}: ${b.start} → ${after[i].start}`);
      });
    }
    assert.deepEqual(bads(rebuilt), [], t.id);
  }
});

test('measuring one wall scales the rest; appliance widths stay standard', () => {
  const m = L_KITCHEN();
  const k = 200 / 168;
  const s = rescaleModel(m, 'north', 200);
  assert.equal(s.room.widthIn, 200);
  assert.equal(s.room.lengthIn, Math.round(144 * k * 2) / 2);
  const sink = s.appliances.find((a) => a.kind === 'sink')!;
  assert.equal(sink.offsetIn, Math.round(60 * k * 2) / 2);
  assert.equal(sink.widthIn, 33);
  assert.equal(s.openings[0].widthIn, Math.round(36 * k * 2) / 2);
  assert.equal(rescaleModel(m, 'west', 144), m, 'no change when it already measures that');
});
