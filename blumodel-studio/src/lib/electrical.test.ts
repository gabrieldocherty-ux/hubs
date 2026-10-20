import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from './checks';
import { resolveAll, snapItem } from './geometry';
import { getProduct } from '../data/catalog';
import type { PlacedItem, Room } from '../types';

const room: Room = { widthIn: 240, lengthIn: 168, ceilingIn: 108 };
const it = (id: string, productId: string, x: number, y: number, extra: Partial<PlacedItem> = {}): PlacedItem => ({ id, productId, x, y, rotation: 0, finishIndex: 0, ...extra });
/** A run of 30″ base cabinets along the north wall from x = 0. */
const bases = (n: number) => Array.from({ length: n }, (_, i) => it(`b${i}`, 'base', 15 + i * 30, 12, { widthIn: 30 }));
const outlet = (id: string, x: number, productId = 'outlet-counter') => it(id, productId, x, 0.25);
const checks = (items: PlacedItem[]) => runChecks(resolveAll(items), room).checks;

describe('outlets and switches', () => {
  test('every device is a real product in Lighting & electrical, snapping to the wall at its height', () => {
    for (const id of ['outlet-counter', 'outlet-gfci', 'outlet-usb', 'outlet-wall', 'light-switch', 'dimmer-switch']) {
      const p = getProduct(id);
      assert.ok(p, id);
      assert.equal(p.kind, 'outlet', id);
      assert.equal(p.category, 'lighting', id);
    }
    const p = getProduct('outlet-counter')!;
    const s = snapItem({ id: 'o', x: 60, y: 5, rotation: 0 }, p, p.widthIn, room, []);
    assert.equal(s.wall, 'north');
    assert.equal(p.elevationIn, 42);
  });

  test('a kitchen with no outlets isn’t asked for any', () => {
    assert.ok(!checks(bases(4)).some((c) => c.id.startsWith('outlets-')));
  });

  test('a 10′ counter with one outlet at one end has a stretch too far from it; outlets every 6′ cover it', () => {
    const far = checks([...bases(4), outlet('o1', 10)]).filter((c) => c.id.startsWith('outlets-'));
    assert.equal(far.length, 1);
    assert.match(far[0].title, /from an outlet/);
    const covered = checks([...bases(4), outlet('o1', 30), outlet('o2', 96)]).filter((c) => c.id.startsWith('outlets-'));
    assert.deepEqual(covered, []);
  });

  test('a plain outlet within 5′ of a sink asks for a GFCI; a GFCI there doesn’t', () => {
    const items = [it('s', 'sink-farm', 48, 12), ...bases(1), outlet('o1', 60)];
    assert.ok(checks(items).some((c) => c.id === 'gfci-o1'));
    const gfci = [it('s', 'sink-farm', 48, 12), ...bases(1), outlet('o1', 60, 'outlet-gfci')];
    assert.ok(!checks(gfci).some((c) => c.id.startsWith('gfci-')));
  });

  test('a light switch is never counted as a counter outlet', () => {
    assert.ok(checks([...bases(4), it('sw', 'light-switch', 60, 0.25)]).every((c) => !c.id.startsWith('outlets-')));
  });
});

test('an outlet on the backsplash over a cabinet is not a collision; a low outlet behind a cabinet is', () => {
  const up = checks([...bases(2), outlet('o1', 30)]);
  assert.deepEqual(up.filter((c) => c.itemIds.includes('o1') && !c.id.startsWith('outlets-')).map((c) => c.id), []);
  const low = checks([...bases(2), outlet('o2', 30, 'outlet-wall')]);
  assert.ok(low.some((c) => c.itemIds.includes('o2') && c.level !== 'ok'), JSON.stringify(low.map((c) => c.id)));
});
