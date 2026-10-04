import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dropTargetIds,
  findDropTarget,
  placeAt,
  placeAtClient,
  planClientToRoom,
  planRoomToClient,
  pointInRect,
  rectsEqual,
  registerDropTarget,
  roomToWorld,
  useOverlay,
  usePlacement,
  worldToRoom,
  type ScreenRect,
} from './interaction';
import { initialDoc, useDesignStore } from '../store/useDesignStore';

/** Stand-in for an HTMLElement: only what the registry reads. */
function fakeEl(rect: ScreenRect, connected = true): HTMLElement {
  return {
    isConnected: connected,
    getBoundingClientRect: () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top }),
  } as unknown as HTMLElement;
}

describe('coordinates', () => {
  test('3D world feet <-> room inches', () => {
    assert.deepEqual(worldToRoom(10, 6.5), { x: 120, y: 78 });
    assert.deepEqual(roomToWorld(120, 78), [10, 0, 6.5]);
    assert.deepEqual(roomToWorld(120, 78, 36), [10, 3, 6.5]);
  });

  test('plan client px <-> room inches round-trip through the stage transform', () => {
    const container = { left: 318, top: 58 };
    const view = { x: 60, y: 40, scale: 2.5 };
    const p = planClientToRoom(318 + 60 + 100 * 2.5, 58 + 40 + 30 * 2.5, container, view);
    assert.deepEqual(p, { x: 100, y: 30 });
    assert.deepEqual(planRoomToClient(p, container, view), { x: 318 + 60 + 250, y: 58 + 40 + 75 });
  });

  test('pointInRect: left/top inclusive, right/bottom exclusive', () => {
    const r = { left: 10, top: 20, width: 100, height: 50 };
    assert.equal(pointInRect(10, 20, r), true);
    assert.equal(pointInRect(109.9, 69.9, r), true);
    assert.equal(pointInRect(110, 40, r), false);
    assert.equal(pointInRect(50, 70, r), false);
  });

  test('rectsEqual tolerates sub-pixel jitter', () => {
    const a = { left: 10, top: 10, width: 40, height: 40 };
    assert.equal(rectsEqual(a, { ...a, left: 10.4 }), true);
    assert.equal(rectsEqual(a, { ...a, left: 11 }), false);
    assert.equal(rectsEqual(null, null), true);
    assert.equal(rectsEqual(a, null), false);
  });
});

describe('drop targets', () => {
  const unregister: (() => void)[] = [];
  beforeEach(() => {
    while (unregister.length) unregister.pop()!();
  });

  test('finds the view under the pointer and maps it to room inches', () => {
    unregister.push(registerDropTarget('plan', fakeEl({ left: 0, top: 0, width: 400, height: 300 }), (x, y) => ({ x: x / 2, y: y / 2 })));
    unregister.push(registerDropTarget('3d', fakeEl({ left: 0, top: 300, width: 400, height: 300 }), (x, y) => ({ x, y: y - 300 })));
    assert.deepEqual(dropTargetIds(), ['plan', '3d']);
    assert.deepEqual(findDropTarget(100, 50)?.point, { x: 50, y: 25 });
    assert.equal(findDropTarget(100, 50)?.id, 'plan');
    const hit = findDropTarget(100, 350);
    assert.equal(hit?.id, '3d');
    assert.deepEqual(hit?.point, { x: 100, y: 50 });
    assert.equal(findDropTarget(500, 50), null);
  });

  test('a null or non-finite mapping is a miss (e.g. a 3D ray into the sky)', () => {
    unregister.push(registerDropTarget('3d', fakeEl({ left: 0, top: 0, width: 100, height: 100 }), () => null));
    assert.equal(findDropTarget(50, 50), null);
    unregister.push(registerDropTarget('plan', fakeEl({ left: 0, top: 0, width: 100, height: 100 }), () => ({ x: Number.NaN, y: 1 })));
    assert.equal(findDropTarget(50, 50), null);
  });

  test('re-registering an id replaces it; a stale unregister does not remove the new one', () => {
    const first = registerDropTarget('plan', fakeEl({ left: 0, top: 0, width: 10, height: 10 }), () => ({ x: 1, y: 1 }));
    unregister.push(registerDropTarget('plan', fakeEl({ left: 0, top: 0, width: 10, height: 10 }), () => ({ x: 2, y: 2 })));
    first(); // StrictMode-style late cleanup of the first mount
    assert.deepEqual(dropTargetIds(), ['plan']);
    assert.deepEqual(findDropTarget(5, 5)?.point, { x: 2, y: 2 });
  });

  test('detached or zero-size elements are skipped', () => {
    unregister.push(registerDropTarget('plan', fakeEl({ left: 0, top: 0, width: 10, height: 10 }, false), () => ({ x: 1, y: 1 })));
    assert.equal(findDropTarget(5, 5), null);
    unregister.push(registerDropTarget('3d', fakeEl({ left: 0, top: 0, width: 0, height: 10 }), () => ({ x: 1, y: 1 })));
    assert.equal(findDropTarget(0, 5), null);
  });

  test('overlapping rects: the latest registration wins', () => {
    unregister.push(registerDropTarget('plan', fakeEl({ left: 0, top: 0, width: 100, height: 100 }), () => ({ x: 1, y: 1 })));
    unregister.push(registerDropTarget('3d', fakeEl({ left: 50, top: 0, width: 100, height: 100 }), () => ({ x: 2, y: 2 })));
    assert.equal(findDropTarget(75, 50)?.id, '3d');
    assert.equal(findDropTarget(25, 50)?.id, 'plan');
  });
});

describe('usePlacement', () => {
  beforeEach(() => usePlacement.getState().disarm());

  test('arm / disarm, ignoring unknown products', () => {
    usePlacement.getState().arm('base');
    assert.equal(usePlacement.getState().armedProductId, 'base');
    usePlacement.getState().arm('island');
    assert.equal(usePlacement.getState().armedProductId, 'island');
    usePlacement.getState().arm('no-such-product');
    assert.equal(usePlacement.getState().armedProductId, 'island');
    usePlacement.getState().disarm();
    assert.equal(usePlacement.getState().armedProductId, null);
  });
});

describe('useOverlay', () => {
  beforeEach(() => useOverlay.getState().clear());

  test('publishing the same rect again does not notify subscribers', () => {
    let calls = 0;
    const off = useOverlay.subscribe(() => calls++);
    const r = { left: 10, top: 20, width: 30, height: 40 };
    useOverlay.getState().set({ rect: r, source: 'plan' });
    useOverlay.getState().set({ rect: { ...r, top: 20.2 }, source: 'plan' });
    useOverlay.getState().set({ rect: { ...r } });
    off();
    assert.equal(calls, 1);
    assert.deepEqual(useOverlay.getState().rect, r);
  });

  test('stores a plain copy of a DOMRect-like value', () => {
    useOverlay.getState().set({ rect: { left: 1, top: 2, width: 3, height: 4, right: 4, bottom: 6 } as ScreenRect, source: '3d' });
    assert.deepEqual(useOverlay.getState().rect, { left: 1, top: 2, width: 3, height: 4 });
  });

  test('clear(source) only withdraws that view’s rect', () => {
    useOverlay.getState().set({ rect: { left: 1, top: 1, width: 1, height: 1 }, source: '3d', dragging: true });
    useOverlay.getState().clear('plan');
    assert.equal(useOverlay.getState().source, '3d');
    useOverlay.getState().clear('3d');
    assert.deepEqual([useOverlay.getState().rect, useOverlay.getState().source, useOverlay.getState().dragging], [null, null, false]);
  });
});

describe('placeAt', () => {
  beforeEach(() => {
    useDesignStore.getState().loadDoc({ ...initialDoc(), room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 }, items: [] });
    usePlacement.getState().disarm();
  });

  test('adds the product snapped like a drag, selects it, disarms, one undo step', () => {
    usePlacement.getState().arm('base');
    const id = placeAt('base', 60, 8);
    assert.ok(id);
    const s = useDesignStore.getState();
    const it = s.doc.items.find((i) => i.id === id)!;
    assert.deepEqual([it.productId, it.x, it.y, it.rotation], ['base', 60, 12, 0]);
    assert.equal(s.selectedId, id);
    assert.equal(s.past.length, 1);
    assert.equal(usePlacement.getState().armedProductId, null);
  });

  test('a free-standing piece lands centred on the point', () => {
    const id = placeAt('island', 100, 80)!;
    const it = useDesignStore.getState().doc.items.find((i) => i.id === id)!;
    assert.deepEqual([it.x, it.y], [100, 80]);
  });

  test('rejects unknown products and non-finite points without disarming', () => {
    usePlacement.getState().arm('base');
    assert.equal(placeAt('nope', 10, 10), null);
    assert.equal(placeAt('base', Number.NaN, 10), null);
    assert.equal(useDesignStore.getState().doc.items.length, 0);
    assert.equal(usePlacement.getState().armedProductId, 'base');
  });

  test('placeAtClient drops onto the registered view under the pointer', () => {
    const off = registerDropTarget('plan', fakeEl({ left: 0, top: 0, width: 400, height: 400 }), (x, y) => ({ x: x / 2, y: y / 2 }));
    try {
      const id = placeAtClient('island', 200, 160)!;
      const it = useDesignStore.getState().doc.items.find((i) => i.id === id)!;
      assert.deepEqual([it.x, it.y], [100, 80]);
      assert.equal(placeAtClient('island', 900, 900), null);
    } finally {
      off();
    }
  });
});
