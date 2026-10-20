import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { addRoom, bumpWall, isError, moveWallTo, placeOpening, setMainOutline, setWallLength, type Draft } from './roomEdit';
import { wallSegs } from './outline';
import type { PlacedItem } from '../types';

const base = (): Draft => ({ room: { widthIn: 240, lengthIn: 168, ceilingIn: 108 }, items: [] });
const cab = (x: number, y: number): PlacedItem => ({ id: 'c', productId: 'base', x, y, rotation: 0, finishIndex: 0 });

describe('roomEdit', () => {
  test('moving the east wall out carries a cabinet standing against it', () => {
    const d: Draft = { ...base(), items: [{ ...cab(240 - 12, 80), rotation: 90 }] };
    const east = wallSegs(d.room).find((s) => s.wall === 'east')!;
    const out = moveWallTo(d, east.id, 300);
    assert.ok(!isError(out));
    assert.equal(out.room.widthIn, 300);
    assert.equal(out.items[0].x, 300 - 12);
  });
  test('moving the north wall past the origin rebases the plan and shifts the items', () => {
    const d: Draft = { ...base(), items: [cab(60, 80)] };
    const north = wallSegs(d.room).find((s) => s.wall === 'north')!;
    const out = moveWallTo(d, north.id, -36);
    assert.ok(!isError(out));
    assert.equal(out.room.lengthIn, 204);
    assert.equal(out.items[0].y, 80 + 36);
  });
  test('a wall cannot be dragged into the opposite one', () => {
    const d = base();
    const east = wallSegs(d.room).find((s) => s.wall === 'east')!;
    assert.ok(isError(moveWallTo(d, east.id, -10)));
  });
  test('setting a wall length works and an L can be built with a bump', () => {
    const d = base();
    const north = wallSegs(d.room).find((s) => s.wall === 'north')!;
    const longer = setWallLength(d, north.id, 300);
    assert.ok(!isError(longer));
    assert.equal(longer.room.widthIn, 300);
    const east = wallSegs(longer.room).find((s) => s.wall === 'east')!;
    const bumped = bumpWall(longer, east.id, 40, 100, 36);
    assert.ok(!isError(bumped));
    assert.equal(bumped.room.widthIn, 336);
    assert.ok(bumped.room.outline && bumped.room.outline.length === 8);
  });
  test('rooms can share a wall but not overlap', () => {
    const d = base();
    const ok = addRoom(d, [[240, 0], [340, 0], [340, 100], [240, 100]], 'Pantry');
    assert.ok(!isError(ok));
    assert.equal(ok.room.extra?.[0].name, 'Pantry');
    assert.ok(isError(addRoom(d, [[200, 0], [340, 0], [340, 100], [200, 100]])));
  });
  test('a doorway lands on the wall, facing the room, and cannot stack on another', () => {
    const d = base();
    const south = wallSegs(d.room).find((s) => s.wall === 'south')!;
    const a = placeOpening(d, 'opening', south.id, 100);
    assert.ok(!isError(a));
    assert.deepEqual([a.items[0].x, a.items[0].y, a.items[0].rotation], [100, 168, 180]);
    assert.ok(isError(placeOpening({ room: a.room, items: a.items }, 'door', south.id, 110)));
  });
  test('a drawn L through setMainOutline keeps the bounding box', () => {
    const out = setMainOutline(base(), [[0, 0], [240, 0], [240, 96], [144, 96], [144, 168], [0, 168]]);
    assert.ok(!isError(out));
    assert.equal(out.room.widthIn, 240);
    assert.equal(out.room.lengthIn, 168);
  });
});

import { setEdgeStyle, setSpaceStyle } from './roomEdit';
import { EDGE_STYLES, normalizeStyled, spaces, floorSqFt } from './outline';
import { flushSeg, resolve } from './geometry';

describe('open plan: zones and edge styles', () => {
  const kitchenZone = [[0, 0], [150, 0], [150, 120], [0, 120]] as [number, number][];
  const open = (): Draft => ({ room: { widthIn: 300, lengthIn: 200, ceilingIn: 108 }, items: [] });

  test('an open area is drawn inside the room, adds no floor, and starts with an open border', () => {
    const out = addRoom(open(), kitchenZone, undefined, 'zone');
    assert.ok(!isError(out));
    assert.equal(out.room.extra?.[0].kind, 'zone');
    assert.equal(out.room.extra?.[0].name, 'Kitchen');
    assert.equal(floorSqFt(out.room), floorSqFt(open().room));
    assert.ok(wallSegs(out.room).filter((s) => s.zone).every((s) => s.style === 'open'));
  });
  test('an open area must sit on the floor of the rooms', () => {
    assert.ok(isError(addRoom(open(), [[250, 150], [400, 150], [400, 250], [250, 250]], undefined, 'zone')));
  });
  test('two open areas cannot overlap', () => {
    const one = addRoom(open(), kitchenZone, undefined, 'zone');
    assert.ok(!isError(one));
    assert.ok(isError(addRoom(one, [[100, 50], [250, 50], [250, 150], [100, 150]], undefined, 'zone')));
  });
  test('the whole border takes one style; a half wall holds cabinets but not doors', () => {
    const one = addRoom(open(), kitchenZone, undefined, 'zone');
    assert.ok(!isError(one));
    const half = setSpaceStyle(one, 1, 'half');
    assert.ok(!isError(half));
    assert.ok(wallSegs(half.room).filter((s) => s.zone).every((s) => s.style === 'half'));
    // a base cabinet backed onto the half wall at x = 150 (it faces west, into the kitchen)
    const cab: PlacedItem = { id: 'b', productId: 'base', x: 138, y: 60, rotation: 90, finishIndex: 0 };
    const r = resolve(cab)!;
    assert.equal(flushSeg(r, half.room)?.style, 'half');
    const door = placeOpening(half, 'door', wallSegs(half.room).find((s) => s.zone && s.wall === 'east')!.id, 60);
    assert.ok(isError(door));
    assert.match(door.error, /half wall/i);
  });
  test('an open border attracts nothing, so a cabinet there is not flush to anything', () => {
    const one = addRoom(open(), kitchenZone, undefined, 'zone');
    assert.ok(!isError(one));
    const cab: PlacedItem = { id: 'b', productId: 'base', x: 138, y: 60, rotation: 90, finishIndex: 0 };
    assert.equal(flushSeg(resolve(cab)!, one.room), null);
  });
  test('a style cannot take the doors out from under a wall silently', () => {
    const d = open();
    const south = wallSegs(d.room).find((s) => s.wall === 'south')!;
    const withDoor = placeOpening(d, 'door', south.id, 100);
    assert.ok(!isError(withDoor));
    assert.ok(isError(setEdgeStyle({ room: withDoor.room, items: withDoor.items }, south.id, 'half')));
  });
  test('a wall shared by two rooms changes on both sides, so open is open from either room', () => {
    const two = addRoom(open(), [[300, 0], [420, 0], [420, 200], [300, 200]], 'Living');
    assert.ok(!isError(two));
    const shared = wallSegs(two.room).find((s) => s.room === 0 && s.wall === 'east')!;
    const opened = setEdgeStyle(two, shared.id, 'open');
    assert.ok(!isError(opened));
    const styles = wallSegs(opened.room).filter((s) => s.at === 300 && (s.wall === 'east' || s.wall === 'west')).map((s) => s.style);
    assert.deepEqual(styles, ['open', 'open']);
  });
  test('styles follow their walls when the outline is reversed or a section is bumped', () => {
    const rev = normalizeStyled([[0, 0], [0, 100], [100, 100], [100, 0]], ['wall', 'half', 'glass', 'rail']);
    // Edges as drawn (counter-clockwise): west 'wall', south 'half', east 'glass', north 'rail'.
    const room = { widthIn: 100, lengthIn: 100, ceilingIn: 96, outline: rev.pts, styles: rev.styles };
    const pick = (w: string) => wallSegs(room).find((s) => s.wall === w)!.style;
    assert.deepEqual([pick('west'), pick('south'), pick('east'), pick('north')], ['wall', 'half', 'glass', 'rail']);
    const north = wallSegs(room).find((s) => s.wall === 'north')!;
    const bumped = bumpWall({ room, items: [] }, north.id, 30, 70, 20);
    assert.ok(!isError(bumped));
    const styles = wallSegs(bumped.room).map((s) => `${s.wall}:${s.style}`);
    assert.equal(styles.filter((x) => x === 'south:half').length, 1);
    assert.equal(styles.filter((x) => x === 'east:glass').length, 1);
    // the bumped north wall keeps its railing on the front and both pieces
    assert.equal(styles.filter((x) => x === 'north:rail').length, 3);
  });
  test('every style says whether it holds openings and backs cabinets', () => {
    assert.equal(EDGE_STYLES.wall.holdsOpenings, true);
    for (const k of ['half', 'bar', 'rail', 'glass', 'beam', 'open'] as const) assert.equal(EDGE_STYLES[k].holdsOpenings, false);
    assert.equal(EDGE_STYLES.rail.backs, false);
    assert.equal(EDGE_STYLES.half.backs, true);
  });
});

import { addRoomOfKind } from './roomEdit';

describe('add a room by kind', () => {
  const plain = (): Draft => ({ room: { widthIn: 240, lengthIn: 168, ceilingIn: 108 }, items: [] });
  test('a living room lands beside the kitchen and shares a wall', () => {
    const out = addRoomOfKind(plain(), 'living');
    assert.ok(!isError(out));
    const room = out.room.extra![0];
    assert.equal(room.name, 'Living room');
    assert.equal(room.kind, undefined);
    const xs = room.outline.map((p) => p[0]);
    assert.equal(Math.min(...xs), 240);
    assert.equal(Math.max(...xs) - Math.min(...xs), 192);
  });
  test('rooms keep stacking up without overlapping, and repeat names are numbered', () => {
    let d: Draft = plain();
    for (const id of ['bath', 'bath', 'pantry', 'bedroom']) {
      const out = addRoomOfKind(d, id);
      assert.ok(!isError(out), JSON.stringify(out));
      d = out;
    }
    assert.deepEqual(d.room.extra!.map((e) => e.name), ['Bathroom', 'Bathroom 2', 'Pantry', 'Bedroom']);
  });
  test('an unknown kind is refused', () => {
    assert.ok(isError(addRoomOfKind(plain(), 'castle')));
  });
});

describe('rooms joined by walkways and doors', () => {
  const plain = (): Draft => ({ room: { widthIn: 240, lengthIn: 168, ceilingIn: 108 }, items: [] });
  test('a living room opens onto the kitchen with a walkway; a bathroom gets a door', () => {
    const living = addRoomOfKind(plain(), 'living');
    assert.ok(!isError(living));
    assert.equal(living.items.length, 1);
    assert.equal(living.items[0].productId, 'walkway');
    assert.equal(living.items[0].widthIn, 96);
    const bath = addRoomOfKind(plain(), 'bath');
    assert.ok(!isError(bath));
    assert.equal(bath.items[0].productId, 'door');
  });
  test('the passage sits on the wall the two rooms share, in the middle of the shared stretch', () => {
    const out = addRoomOfKind(plain(), 'living');
    assert.ok(!isError(out));
    assert.equal(out.items[0].x, 240);
    assert.ok(out.items[0].y > 0 && out.items[0].y < 168);
  });
  test('a hallway is a narrow room joined by a walkway as wide as itself', () => {
    const out = addRoomOfKind(plain(), 'hallway');
    assert.ok(!isError(out));
    assert.equal(out.items[0].productId, 'walkway');
    assert.equal(out.items[0].widthIn, 42);
  });
});
