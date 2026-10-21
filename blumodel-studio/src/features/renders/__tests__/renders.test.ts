import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MONTHLY_CREDIT_CENTS, SETTING_UP, buildScene, captureSize, cents, entryLabel, plural, reasonCopy, rendersLeft, showButton, showroomRole, freeLine } from '../model';
import { qaSetupWanted } from '../qa';
import { getProduct } from '../../../data/catalog';
import type { DesignDoc } from '../../../types';

test('money and counts', () => {
  assert.equal(cents(2475), '$24.75');
  assert.equal(cents(25), '$0.25');
  assert.equal(cents(-2500), '−$25.00');
  assert.equal(rendersLeft(2475, 25), 99);
  assert.equal(rendersLeft(24, 25), 0);
  assert.equal(rendersLeft(100, 0), 0);
  assert.equal(plural(1, 'render'), '1 render');
  assert.equal(plural(3, 'render'), '3 renders');
  assert.equal(MONTHLY_CREDIT_CENTS, 2500, 'plans.json: $25 of credits a month');
  assert.equal(entryLabel('release'), 'Render failed: returned');
});

test('the copy for each reason; not set up says so and promises no charge', () => {
  assert.equal(reasonCopy(null), null);
  const setup = reasonCopy('not_configured');
  assert.ok(setup?.startsWith(SETTING_UP), setup ?? '');
  assert.match(setup ?? '', /Nothing is charged/);
  assert.match(reasonCopy('no_credits', { costCents: 25, balanceCents: 10 }) ?? '', /\$0\.10; one render is \$0\.25/);
  assert.match(reasonCopy('daily_cap') ?? '', /tomorrow/);
  for (const r of ['sign_in', 'visitor_off', 'unavailable'] as const) assert.ok(reasonCopy(r));
});

test('the button: showroom, signed in, a design, and the team or visitor renders on', () => {
  const base = { onShowroom: true, signedIn: true, team: true, visitorRenders: false, hasDesign: true };
  assert.equal(showButton(base), true);
  assert.equal(showButton({ ...base, onShowroom: false }), false, 'never on the sales site');
  assert.equal(showButton({ ...base, signedIn: false }), false);
  assert.equal(showButton({ ...base, hasDesign: false }), false, 'a local draft has nothing to render');
  assert.equal(showButton({ ...base, team: false }), false, 'visitors: off by default');
  assert.equal(showButton({ ...base, team: false, visitorRenders: true }), true);
  assert.equal(showButton({ ...base, team: false, freeLeft: 2 }), true, 'a visitor with free renders left');
  assert.equal(showButton({ ...base, team: false, freeLeft: 0 }), false);
  assert.equal(freeLine({ total: 3, left: 2 }), 'Free: 2 of 3 free photoreal renders left on your account. No credits are used.');
  assert.equal(freeLine({ total: 3, left: 0 }), null);
  assert.equal(freeLine(undefined), null);
  assert.equal(showroomRole({ showroom: { tenantId: 't', role: 'staff' } }), 'staff');
  assert.equal(showroomRole({ showroom: { tenantId: 't', role: null } }), null);
  assert.equal(showroomRole({ showroom: null }), null);
  assert.equal(showroomRole(null), null);
});

test('the scene: room, finishes by name, products grouped and counted, openings left out', () => {
  const doc: DesignDoc = {
    name: 'Test',
    room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
    surfaces: { cabinetFinishId: 'white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'marble', backsplashId: 'subway', flooringId: 'oak', paintId: 'white' },
    items: [
      { id: 'a', productId: 'range-30', x: 60, y: 14, rotation: 0, finishIndex: 0 },
      { id: 'b', productId: 'range-30', x: 100, y: 14, rotation: 0, finishIndex: 0 },
      { id: 'c', productId: 'nope-not-a-product', x: 10, y: 10, rotation: 0, finishIndex: 0 },
    ],
  };
  const s = buildScene(doc, getProduct, { width: 1600, height: 900 });
  assert.equal(s.room.kind, 'kitchen');
  assert.equal(s.room.widthIn, 200);
  assert.equal(s.camera.widthPx, 1600);
  assert.equal(s.finishes.doorStyle, 'Shaker');
  assert.ok(s.finishes.cabinets && s.finishes.countertop && s.finishes.flooring && s.finishes.walls && s.finishes.hardware);
  const range = getProduct('range-30');
  if (range) {
    assert.equal(s.products.length, 1);
    assert.equal(s.products[0].count, 2);
    assert.equal(s.products[0].name, range.name);
  }
  const win = buildScene({ ...doc, items: [{ id: 'w', productId: 'window-36', x: 0, y: 0, rotation: 0, finishIndex: 0 }] }, (id) => (id === 'window-36' ? ({ ...range!, id, kind: 'window', name: 'Window' } as never) : undefined), { width: 10, height: 10 });
  assert.equal(win.products.length, 0, 'windows and doors are in the picture, not the list');
});

test('capture size and the QA switch', () => {
  assert.deepEqual(captureSize(1200, 700), { width: 1600, height: 900 });
  assert.deepEqual(captureSize(390, 700), { width: 900, height: 1600 });
  assert.equal(qaSetupWanted('#/k/abc?qa-renders=setup'), true);
  assert.equal(qaSetupWanted('#/k/abc'), false);
});
