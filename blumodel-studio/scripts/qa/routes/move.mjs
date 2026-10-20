// QA for the `move` package: Gabe's requirement, "I SHOULD BE ABLE TO MOVE ITEMS AROUND EASILY
// ON COMPUTER AND MOBILE". Every route drives REAL input through CDP (mouse events on desktop,
// touch events with touch emulation on phones and tablets) and reads item x/y/rotation from the
// store (window.__blumodel, ?qa only) before and after each gesture.
//
//   node scripts/qa.mjs --pkg move --port 8817
//
// Positions are ROOM INCHES (PlacedItem.x/y, footprint centre). The plan and the 3D view expose
// toClient()/toRoom() on window.__blumodelQA (plan, scene3d) so a route can press exactly on a piece.
// The device planner (#/local) is used throughout: no account needed, and each route gets a fresh
// browser context, so the test kitchen below is loaded into the store first.

const SURFACES = { cabinetFinishId: 'white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'marble', backsplashId: 'subway', flooringId: 'oak', paintId: 'white' };

/**
 * A 200″ × 156″ room: a north run from the west corner to 120″ with a free stretch, one more base
 * at the east end (174–198″), and an 84″ × 42″ island in the middle (x 58–142, y 75–117).
 * Empty floor: around (25, 130) and (170, 125).
 */
export function moveDoc() {
  const n = (id, productId, x, y, extra = {}) => ({ id, productId, x, y, rotation: 0, finishIndex: 0, ...extra });
  return {
    name: 'QA Move Kitchen',
    room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
    surfaces: SURFACES,
    items: [
      n('mv-fridge', 'fridge-36', 18, 15),
      n('mv-base', 'base', 48, 12),
      n('mv-sink', 'sink-farm', 78, 12),
      n('mv-dw', 'dishwasher', 108, 12),
      n('mv-base-e', 'base', 186, 12),
      n('mv-island', 'island', 100, 96),
    ],
  };
}

/**
 * moveDoc plus the two kinds of wall-hung piece, which drag along the wall surface in 3D instead
 * of a floor plane: a 30″ wall cabinet (54″ up) in the free stretch of the north wall, and a 36″
 * casement window (sill 42″) above the sink. Openings sit on the wall line (y 0).
 */
export function wallDoc() {
  const d = moveDoc();
  d.name = 'QA Move Kitchen (wall pieces)';
  d.items.push(
    { id: 'mv-wall', productId: 'wall', x: 147, y: 6, rotation: 0, finishIndex: 0 },
    { id: 'mv-window', productId: 'window', x: 60, y: 0, rotation: 0, finishIndex: 0 },
  );
  return d;
}

/**
 * moveDoc plus two doorways in the west wall (x 0, facing east into the room), which the default
 * 3D camera looks at: a 32″ interior door at y 55 (its leaf swings open into the room) and a 48″
 * cased opening at y 112, which has no leaf at all, so a press in its middle sees the hall beyond.
 */
export function doorDoc() {
  const d = moveDoc();
  d.name = 'QA Move Kitchen (doors)';
  d.items.push(
    { id: 'mv-door', productId: 'door', x: 0, y: 55, rotation: 270, finishIndex: 0 },
    { id: 'mv-open', productId: 'opening', x: 0, y: 112, rotation: 270, finishIndex: 0 },
  );
  return d;
}

const ISLAND = { x: 100, y: 96, top: 36 };
const EMPTY_A = { x: 25, y: 132 };
const EMPTY_B = { x: 170, y: 128 };

// ─── reading state ────────────────────────────────────────────────────────────

const fmt = (p) => (p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)} @${p.rotation}°)` : 'missing');
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** Items (id → {x, y, rotation, productId}), undo depth, selection, drag flag, view. */
async function state(h) {
  return h.evaluate(() => {
    const s = window.__blumodel.store.getState();
    return {
      items: Object.fromEntries(s.doc.items.map((i) => [i.id, { x: i.x, y: i.y, rotation: i.rotation, productId: i.productId }])),
      count: s.doc.items.length,
      past: s.past.length,
      selectedId: s.selectedId,
      dragging: s.dragging,
      viewMode: s.ui.viewMode,
      armed: window.__blumodel.placement.getState().armedProductId,
    };
  });
}

function sameItems(a, b, what) {
  for (const id of new Set([...Object.keys(a.items), ...Object.keys(b.items)])) {
    const p = a.items[id];
    const q = b.items[id];
    if (!p || !q || p.x !== q.x || p.y !== q.y || p.rotation !== q.rotation) throw new Error(`${what}: ${id} changed ${fmt(p)} → ${fmt(q)}`);
  }
}

/** Polls a page function until it returns the same string twice in a row (a layout or camera settling). */
async function settle(h, fn, { gap = 250, max = 6000 } = {}) {
  const t0 = Date.now();
  let last = await h.evaluate(fn);
  for (;;) {
    await h.sleep(gap);
    const now = await h.evaluate(fn);
    if (now === last || Date.now() - t0 > max) return now;
    last = now;
  }
}

const planView = (h) => h.evaluate(() => window.__blumodelQA.plan.view());
const planPt = (h, p) => h.evaluate((x, y) => window.__blumodelQA.plan.toClient(x, y), p.x, p.y);
const scenePt = (h, p, z = 0) => h.evaluate((x, y, zz) => window.__blumodelQA.scene3d.toClient(x, y, zz), p.x, p.y, z);
const camera = (h) => h.evaluate(() => window.__blumodelQA.scene3d.cameraState());
/**
 * Waits until the 3D view has drawn `n` more frames, so what it shows (and what a press picks:
 * meshes are placed on screen when a frame is drawn) has caught up with the store. A fixed sleep
 * is not enough on a slow renderer: under --swiftshader one frame takes hundreds of ms. No-op
 * without a 3D view on screen.
 */
const drawn3d = (h, n = 2) =>
  h.evaluate(async (k) => {
    const s = window.__blumodelQA?.scene3d;
    const gl = s?.get().gl;
    if (!gl || !gl.domElement.isConnected) return;
    const f0 = gl.info.render.frame;
    const t0 = performance.now();
    while (gl.info.render.frame < f0 + k && performance.now() - t0 < 8000) await new Promise((r) => requestAnimationFrame(r));
  }, n);
const pick3d = async (h, c) => {
  await drawn3d(h);
  return h.evaluate((x, y) => window.__blumodelQA.scene3d.pick(x, y)?.id ?? null, c.x, c.y);
};

function cameraMoved(a, b) {
  const d = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
  return Math.max(d(a.position, b.position), a.target && b.target ? d(a.target, b.target) : 0);
}

async function readyPlan(h) {
  await h.waitFor('.plan-view canvas');
  await h.waitUntil(() => !!window.__blumodelQA?.plan?.toClient, 10_000, 'the plan QA hook');
  await settle(h, () => JSON.stringify(window.__blumodelQA.plan.view()));
}

async function ready3d(h) {
  await h.waitFor('.scene-view canvas');
  await h.waitUntil(() => !!window.__blumodelQA?.scene3d?.toClient && !!window.__blumodelQA.scene3d.get().controls, 25_000, 'the 3D view (scene3d QA hook and camera controls)');
  // The camera eases to its preset (0.95 s) whenever the canvas changes shape; wait it out.
  await settle(h, () => JSON.stringify(window.__blumodelQA.scene3d.cameraState()), { gap: 400, max: 8000 });
}

/** Loads the test kitchen into the open editor and shows `view` ('plan' | '3d' | 'split'). */
async function start(h, view = 'plan', doc = moveDoc()) {
  await h.waitUntil(() => !!window.__blumodel?.store, 15_000, 'window.__blumodel (the ?qa hook)');
  await h.evaluate(
    (doc, v) => {
      const s = window.__blumodel.store.getState();
      s.loadDoc(doc);
      s.setUI({ viewMode: v });
    },
    doc,
    view,
  );
  if (view !== '3d') await readyPlan(h);
  if (view !== 'plan') await ready3d(h);
  return state(h);
}

/** Switches view the way a person would: the top bar's tabs on a desktop, the bottom bar on a phone. */
async function showView(h, label) {
  const compact = await h.evaluate(() => !!document.querySelector('.mbar'));
  const sel = compact ? '.mbar-views [role="tab"]' : '.views [role="tab"]';
  const ok = await h.evaluate(
    (s, l) => {
      const b = [...document.querySelectorAll(s)].find((x) => x.textContent.trim() === l);
      if (b) b.setAttribute('data-qa-view', l);
      return !!b;
    },
    sel,
    label,
  );
  if (!ok) throw new Error(`no "${label}" view tab (${sel})`);
  if (compact) await tap(h, `[data-qa-view="${label}"]`);
  else await h.click(`[data-qa-view="${label}"]`);
  if (label === 'Plan' || label === 'Split') await readyPlan(h);
  if (label === '3D' || label === 'Split') await ready3d(h);
}

// ─── low-level input (for checks in the middle of a gesture) ─────────────────

const mouse = (h, type, p, buttons = 0) => h.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons, clickCount: 1 });
const touch = (h, type, points, timestamp) =>
  h.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })), ...(timestamp ? { timestamp } : {}) });
/**
 * A pen (stylus): CDP mouse events with pointerType 'pen', which Chromium delivers as pen pointer
 * events (pointerType "pen", a click after a press and release). The pen route checks the app
 * really saw "pen", so this can't silently test a mouse instead.
 */
const pen = (h, type, p, buttons = 0) => h.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons, clickCount: 1, pointerType: 'pen' });
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** {x, y} of a point or a rectOf result. */
const ptOf = (t) => (t && typeof t.cx === 'number' ? { x: t.cx, y: t.cy } : t);

/** Pen down, (optionally held), moved in `steps`, lifted. */
async function penDrag(h, from, to, { steps = 12, stepMs = 16, holdMs = 0 } = {}) {
  const a = ptOf(from);
  const b = ptOf(to);
  await pen(h, 'mouseMoved', a);
  await pen(h, 'mousePressed', a, 1);
  if (holdMs) await h.sleep(holdMs);
  for (let i = 1; i <= steps; i++) {
    await pen(h, 'mouseMoved', lerp(a, b, i / steps), 1);
    await h.sleep(stepMs);
  }
  await pen(h, 'mouseReleased', b);
}

/** A pen tap, lifted `wobble` px to the right of where it landed (a hand-held tap rarely lifts exactly where it landed). */
async function penTap(h, target, wobble = 0) {
  let p = ptOf(target);
  if (typeof target === 'string') {
    const r = await h.rectOf(target, { scroll: true });
    if (!(r.w > 0 && r.h > 0)) throw new Error(`pen tap: ${target} has no size (hidden?)`);
    p = { x: r.cx, y: r.cy };
  }
  await pen(h, 'mouseMoved', p);
  await pen(h, 'mousePressed', p, 1);
  await h.sleep(40);
  const q = { x: p.x + wobble, y: p.y };
  if (wobble) await pen(h, 'mouseMoved', q, 1);
  await pen(h, 'mouseReleased', q);
}

/** One press-move-release with `input`: 'mouse', 'touch' (one finger) or 'pen'. */
function drag(h, input, from, to, opts = {}) {
  if (input === 'mouse') return h.mouseDrag(from, to, opts);
  if (input === 'pen') return penDrag(h, from, to, opts);
  return h.touchDrag(from, to, opts);
}

/** A click, a finger tap or a pen tap on a selector, a rect or a point. */
function press(h, input, target) {
  if (input === 'mouse') return h.click(target);
  if (input === 'pen') return penTap(h, target);
  return tap(h, target);
}

/** Two fingers that move together by (dx, dy): a two-finger pan. */
async function twoFingerPan(h, a, b, dx, dy, steps = 12) {
  await touch(h, 'touchStart', [a, b]);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await touch(h, 'touchMove', [
      { x: a.x + dx * t, y: a.y + dy * t },
      { x: b.x + dx * t, y: b.y + dy * t },
    ]);
    await h.sleep(16);
  }
  await touch(h, 'touchEnd', []);
}

/**
 * A finger tap: touchStart, 60 ms of event time, touchEnd, so the browser makes the pointer events AND the
 * click a button needs. (The runner's h.tap uses Input.synthesizeTapGesture, which under Edge's
 * touch emulation delivers pointer/touch events but never a click: buttons ignore it. See
 * docs/handoff/move.md.) Targets: a selector (scrolled into view), a rectOf result, or {x, y}.
 */
async function tap(h, target) {
  let p = target;
  if (typeof target === 'string') {
    const r = await h.rectOf(target, { scroll: true });
    if (!(r.w > 0 && r.h > 0)) throw new Error(`tap: ${target} has no size (hidden?)`);
    p = { x: r.cx, y: r.cy };
  } else if (target && typeof target.cx === 'number') p = { x: target.cx, y: target.cy };
  // Input.dispatchTouchEvent returns when the renderer has handled the event, so on a busy page
  // (3D under --swiftshader: frames of seconds) the "50 ms" between the two calls became 400 ms or
  // more of EVENT time, and the app, rightly, took the press for a hold (catalog cards: HOLD_MS).
  // A finger's events carry the time it touched and lifted, whatever the page was doing: so do these.
  const t = Date.now() / 1000;
  await touch(h, 'touchStart', [p], t);
  await touch(h, 'touchEnd', [], t + 0.06);
}

/** What a drop or a tap at client (x, y) would hit: { id: 'plan' | '3d', point } or null. */
const dropAt = (h, c) =>
  h.evaluate((x, y) => {
    const t = window.__blumodel.findDropTarget(x, y);
    return t ? { id: t.id, point: t.point } : null;
  }, c.x, c.y);

/** No sideways scroll, no page scroll, no browser zoom: the canvas owns every gesture. */
async function pageStill(h, what) {
  const r = await h.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    w: innerWidth,
    sx: scrollX,
    sy: scrollY,
    top: document.scrollingElement ? document.scrollingElement.scrollTop : 0,
    ws: document.querySelector('.workspace')?.scrollTop ?? 0,
    zoom: window.visualViewport ? window.visualViewport.scale : 1,
  }));
  if (r.sw > r.w + 1) throw new Error(`${what}: the page scrolls sideways (${r.sw}px of content in ${r.w}px)`);
  if (r.sx || r.sy || r.top || r.ws) throw new Error(`${what}: the page scrolled (window ${r.sx},${r.sy}; document ${r.top}; workspace ${r.ws})`);
  if (Math.abs(r.zoom - 1) > 0.01) throw new Error(`${what}: the browser zoomed the page (visualViewport.scale ${r.zoom})`);
}

// ─── gestures + assertions, shared by the device routes ──────────────────────

/** Drags the island by (dx, dy) client px in the plan; it moves by that much in room inches; one undo step. */
async function planDragIsland(h, input, dx = 90, dy = 60) {
  const before = await state(h);
  const v = await planView(h);
  const from = await planPt(h, ISLAND);
  const to = { x: from.x + dx, y: from.y + dy };
  await drag(h, input, from, to, { steps: 16 });
  await h.sleep(120);
  const after = await state(h);
  const a = before.items['mv-island'];
  const b = after.items['mv-island'];
  const want = { x: a.x + dx / v.scale, y: a.y + dy / v.scale };
  h.note(`${input} plan drag: island ${fmt(a)} → ${fmt(b)} (pointer moved ${dx},${dy}px at ${v.scale.toFixed(2)}px/in, expected ≈ (${want.x.toFixed(1)}, ${want.y.toFixed(1)}))`);
  if (!near(b.x, want.x, 1.5) || !near(b.y, want.y, 1.5)) throw new Error(`${input} plan drag: the island went to ${fmt(b)}, expected about (${want.x.toFixed(1)}, ${want.y.toFixed(1)})`);
  if (after.past !== before.past + 1) throw new Error(`${input} plan drag: ${after.past - before.past} undo steps for one drag (want 1)`);
  if (after.dragging) throw new Error(`${input} plan drag: the store is still dragging after release`);
  if (after.selectedId !== 'mv-island') throw new Error(`${input} plan drag: the dragged island is not selected (${after.selectedId})`);
  for (const id of Object.keys(before.items)) if (id !== 'mv-island') sameItems({ items: { [id]: before.items[id] } }, { items: { [id]: after.items[id] } }, `${input} plan drag`);
  return { before, after };
}

/**
 * Drags the 24″ base along the north wall to the free stretch, 8″ off the wall and 2″ short of the
 * east base: it must snap flush to the wall (y = 12) and against that base (x = 162).
 */
async function planDragSnap(h, input) {
  const before = await state(h);
  const from = await planPt(h, { x: 48, y: 12 });
  const to = await planPt(h, { x: 160, y: 20 });
  await drag(h, input, from, to, { steps: 24 });
  await h.sleep(120);
  const after = await state(h);
  const b = after.items['mv-base'];
  h.note(`${input} snap: base ${fmt(before.items['mv-base'])} → ${fmt(b)} (released at about (160, 20))`);
  if (b.y !== 12 || b.rotation !== 0) throw new Error(`${input} snap: the base did not snap flush to the north wall: ${fmt(b)} (want y 12, 0°)`);
  if (!near(b.x, 162, 0.01)) throw new Error(`${input} snap: the base did not snap against its neighbour: x ${b.x.toFixed(2)} (want 162, edge to edge with the base at 174″)`);
  if (after.past !== before.past + 1) throw new Error(`${input} snap: ${after.past - before.past} undo steps for one drag`);
  return { before, after };
}

/** One undo puts everything back exactly as it was before the gesture. */
async function undoRestores(h, before, how) {
  if (how === 'key') await h.key('z', { modifiers: ['ctrl'] });
  else if (how === 'tap') await tap(h, '.topbar button[aria-label="Undo"]');
  else if (how === 'pen') await penTap(h, '.topbar button[aria-label="Undo"]');
  else await h.click('.topbar button[aria-label="Undo"]');
  await h.sleep(120);
  const now = await state(h);
  sameItems(before, now, `one undo (${how})`);
  if (now.count !== before.count) throw new Error(`one undo (${how}): ${now.count} items, was ${before.count}`);
}

/** A press and release with no travel selects the piece and moves nothing. */
async function tapSelects(h, input, p = ISLAND, id = 'mv-island') {
  await h.evaluate(() => window.__blumodel.store.getState().select(null));
  const before = await state(h);
  const c = await planPt(h, p);
  await press(h, input, c);
  await h.sleep(150);
  const after = await state(h);
  sameItems(before, after, `${input} tap`);
  if (after.past !== before.past) throw new Error(`${input} tap: a tap added an undo step`);
  if (after.selectedId !== id) throw new Error(`${input} tap on ${id}: selected ${after.selectedId}`);
}

/**
 * A pen tap on the island that lifts `wobble` px from where it landed selects it and moves nothing,
 * in the plan or in 3D: a hand-held stylus rarely lifts exactly where it touched down.
 */
async function penTapWobble(h, view, wobble) {
  await h.evaluate(() => window.__blumodel.store.getState().select(null));
  const before = await state(h);
  const at = view === 'plan' ? await planPt(h, ISLAND) : await scenePt(h, before.items['mv-island'], ISLAND.top);
  await penTap(h, at, wobble);
  await h.sleep(view === 'plan' ? 150 : 350);
  const after = await state(h);
  const what = `pen tap on the island in ${view === 'plan' ? 'the plan' : '3D'}, lifted ${wobble}px off`;
  h.note(`${what}: selected ${after.selectedId}, island ${fmt(before.items['mv-island'])} → ${fmt(after.items['mv-island'])}, ${after.past - before.past} undo steps`);
  sameItems(before, after, what);
  if (after.past !== before.past) throw new Error(`${what}: it added an undo step (taken as a drag)`);
  if (after.selectedId !== 'mv-island') throw new Error(`${what}: selected ${after.selectedId}`);
}

/** Records the pointerType of every press the page sees from now on. */
const watchPointerTypes = (h) =>
  h.evaluate(() => {
    window.__qaPointerTypes = new Set();
    window.addEventListener('pointerdown', (e) => window.__qaPointerTypes.add(e.pointerType), true);
  });
const pointerTypesSeen = (h) => h.evaluate(() => [...(window.__qaPointerTypes ?? [])].sort().join(', '));

/** The floating toolbar is next to the selected piece (above, or below when there's no room), and on screen. */
async function toolbarNextToSelection(h, what) {
  await h.waitFor('.sel-toolbar', 4000);
  await h.sleep(250);
  const r = await h.evaluate(() => {
    const el = document.querySelector('.sel-toolbar');
    const t = el.getBoundingClientRect();
    const o = window.__blumodel.overlay.getState();
    const stage = document.querySelector('.app .stage').getBoundingClientRect();
    const bar = document.querySelector('.mbar')?.getBoundingClientRect() ?? null;
    return {
      t: { l: t.left, t: t.top, r: t.right, b: t.bottom, w: t.width, h: t.height },
      side: [...el.classList].find((c) => c.startsWith('sel-toolbar--'))?.slice(13) ?? null,
      item: o.rect ? { l: o.rect.left, t: o.rect.top, r: o.rect.left + o.rect.width, b: o.rect.top + o.rect.height } : null,
      source: o.source,
      stage: { l: stage.left, t: stage.top, r: stage.right, b: stage.bottom },
      vw: innerWidth,
      vh: innerHeight,
      barTop: bar ? bar.top : null,
      position: getComputedStyle(el).position,
    };
  });
  h.note(`${what}: toolbar ${Math.round(r.t.w)}×${Math.round(r.t.h)} at ${Math.round(r.t.l)},${Math.round(r.t.t)} ${r.side} the ${r.source} item box ${r.item ? `${Math.round(r.item.l)},${Math.round(r.item.t)}–${Math.round(r.item.r)},${Math.round(r.item.b)}` : '(none)'}`);
  if (r.position !== 'fixed') throw new Error(`${what}: the toolbar is not floating (position ${r.position})`);
  if (r.t.h > 64 || r.t.w > 260) throw new Error(`${what}: the toolbar is ${Math.round(r.t.w)}×${Math.round(r.t.h)}px (a compact pill is wanted)`);
  if (r.t.l < r.stage.l - 0.5 || r.t.r > r.stage.r + 0.5 || r.t.t < r.stage.t - 0.5 || r.t.b > r.stage.b + 0.5) throw new Error(`${what}: the toolbar leaves the canvas (${JSON.stringify(r.t)} vs ${JSON.stringify(r.stage)})`);
  if (r.barTop !== null && r.t.b > r.barTop) throw new Error(`${what}: the toolbar is under the bottom bar`);
  if (!r.item) throw new Error(`${what}: no view published the selected item's box`);
  const gapAbove = r.item.t - r.t.b;
  const gapBelow = r.t.t - r.item.b;
  if (r.side === 'above' && !(gapAbove >= 4 && gapAbove <= 20)) throw new Error(`${what}: "above" but ${gapAbove.toFixed(0)}px from the item's top`);
  if (r.side === 'below' && !(gapBelow >= 4 && gapBelow <= 20)) throw new Error(`${what}: "below" but ${gapBelow.toFixed(0)}px from the item's bottom`);
  if (r.side !== 'above' && r.side !== 'below' && r.side !== 'over') throw new Error(`${what}: the toolbar is ${r.side}, not next to the item`);
  const cx = (r.t.l + r.t.r) / 2;
  const clampedL = r.t.l <= r.stage.l + 9;
  const clampedR = r.t.r >= r.stage.r - 9;
  if (!clampedL && !clampedR && (cx < r.item.l - 1 || cx > r.item.r + 1)) throw new Error(`${what}: the toolbar's centre (${cx.toFixed(0)}) is not over the item (${r.item.l.toFixed(0)}–${r.item.r.toFixed(0)})`);
  return r;
}

/** Rotate, Duplicate and Delete on the toolbar each do their one thing. */
async function toolbarActions(h, input, id = 'mv-island') {
  // In 3D the toolbar follows the piece's box, which the view publishes as it draws a frame: after
  // Rotate, or Duplicate (the copy is selected), it moves a frame later. Press it where it is then.
  const ready = async () => {
    await h.waitFor('.sel-toolbar', 3000);
    await drawn3d(h);
  };
  const s0 = await state(h);
  const r0 = s0.items[id].rotation;
  await ready();
  await press(h, input, '.sel-toolbar button[aria-label="Rotate 90 degrees"]');
  await h.sleep(150);
  const s1 = await state(h);
  if (s1.items[id].rotation !== (r0 + 90) % 360) throw new Error(`toolbar Rotate: ${id} is at ${s1.items[id].rotation}°, was ${r0}°`);
  await ready();
  await press(h, input, '.sel-toolbar button[aria-label="Duplicate"]');
  await h.sleep(150);
  const s2 = await state(h);
  if (s2.count !== s1.count + 1) throw new Error(`toolbar Duplicate: ${s2.count} items, was ${s1.count}`);
  const copy = s2.selectedId;
  if (!copy || copy === id || s2.items[copy]?.productId !== s1.items[id].productId) throw new Error(`toolbar Duplicate: the copy is not selected (${copy})`);
  await ready();
  await press(h, input, '.sel-toolbar button[aria-label="Delete"]');
  await h.sleep(150);
  const s3 = await state(h);
  if (s3.count !== s1.count || s3.items[copy]) throw new Error(`toolbar Delete: ${s3.count} items (want ${s1.count}), copy ${s3.items[copy] ? 'still there' : 'gone'}`);
  if (await h.evaluate(() => !!document.querySelector('.sel-toolbar'))) throw new Error('toolbar Delete: the toolbar is still showing with nothing selected');
  h.note(`${input} toolbar: rotate ${r0}° → ${s1.items[id].rotation}°, duplicate → ${copy}, delete → ${s3.count} items`);
}

/** The toolbar gets out of the way while the piece is being dragged, and comes back after. `at`: where the island is pressed (default: its centre in the plan). */
async function toolbarHidesDuringDrag(h, input, at = null) {
  const from = at ?? (await planPt(h, ISLAND));
  const mid = { x: from.x + 30, y: from.y + 18 };
  if (input === 'mouse' || input === 'pen') {
    const send = input === 'pen' ? pen : mouse;
    await send(h, 'mouseMoved', from);
    await send(h, 'mousePressed', from, 1);
    await send(h, 'mouseMoved', { x: from.x + 10, y: from.y + 6 }, 1);
    await send(h, 'mouseMoved', mid, 1);
  } else {
    await touch(h, 'touchStart', [from]);
    await touch(h, 'touchMove', [{ x: from.x + 10, y: from.y + 6 }]);
    await touch(h, 'touchMove', [mid]);
  }
  await h.sleep(120);
  const during = await h.evaluate(() => ({ bar: !!document.querySelector('.sel-toolbar'), dragging: window.__blumodel.store.getState().dragging }));
  if (input === 'mouse') await mouse(h, 'mouseReleased', mid);
  else if (input === 'pen') await pen(h, 'mouseReleased', mid);
  else await touch(h, 'touchEnd', []);
  await h.sleep(150);
  if (!during.dragging) throw new Error(`${input}: pressing the island and moving 35px did not start a drag`);
  if (during.bar) throw new Error(`${input}: the selection toolbar stayed up while the piece was being dragged`);
  await h.waitFor('.sel-toolbar', 3000);
}

/**
 * In 3D with a finger: a tap on the island's top selects it and moves nothing; the toolbar comes up
 * next to it (following the 3D view), gets out of the way while the island is dragged, and is back
 * beside it afterwards. The drag is undone so the kitchen is as it was.
 */
async function toolbar3dTouch(h, what) {
  await h.evaluate(() => window.__blumodel.store.getState().select(null));
  const before = await state(h);
  await tap(h, await scenePt(h, before.items['mv-island'], ISLAND.top));
  await h.sleep(350);
  const after = await state(h);
  sameItems(before, after, `${what}: 3D tap`);
  if (after.past !== before.past) throw new Error(`${what}: a tap on the island in 3D added an undo step`);
  if (after.selectedId !== 'mv-island') throw new Error(`${what}: a tap on the island in 3D selected ${after.selectedId}`);
  const r = await toolbarNextToSelection(h, `${what}, island`);
  if (r.source !== '3d') throw new Error(`${what}: the toolbar follows the ${r.source} view, not 3D`);
  await h.shot('toolbar-3d');
  await toolbarHidesDuringDrag(h, 'touch', await scenePt(h, after.items['mv-island'], ISLAND.top));
  await toolbarNextToSelection(h, `${what}, after a drag`);
  await undoRestores(h, before, 'tap');
}

/** In 3D: a press on the island that moves slides it across the floor; the camera stays put. */
async function drag3dItem(h, input, dx = 110, dy = 30) {
  const before = await state(h);
  const cam0 = await camera(h);
  const from = await scenePt(h, ISLAND, ISLAND.top);
  const hit = await pick3d(h, from);
  if (hit !== 'mv-island') throw new Error(`3D: the island's top (${from.x.toFixed(0)},${from.y.toFixed(0)}) picks ${hit}, not the island`);
  const to = { x: from.x + dx, y: from.y + dy };
  await drag(h, input, from, to, { steps: 16 });
  await h.sleep(350);
  const after = await state(h);
  const cam1 = await camera(h);
  const a = before.items['mv-island'];
  const b = after.items['mv-island'];
  const moved = Math.hypot(b.x - a.x, b.y - a.y);
  // The island was grabbed by the middle of its top, so that point should end up under the finger.
  const land = await scenePt(h, b, ISLAND.top);
  const off = Math.hypot(land.x - to.x, land.y - to.y);
  h.note(`${input} 3D drag: island ${fmt(a)} → ${fmt(b)} (${moved.toFixed(1)}″); its top is ${off.toFixed(1)}px from the release point; camera moved ${cameraMoved(cam0, cam1).toFixed(4)}`);
  if (moved < 6) throw new Error(`${input} 3D drag: the island only moved ${moved.toFixed(1)}″ for a ${dx},${dy}px drag`);
  if (off > 10) throw new Error(`${input} 3D drag: the island stopped ${off.toFixed(0)}px short of the finger (it should follow it to the release point)`);
  if (b.rotation !== a.rotation) throw new Error(`${input} 3D drag: the island rotated`);
  if (cameraMoved(cam0, cam1) > 1e-3) throw new Error(`${input} 3D drag: the camera orbited while dragging the island (moved ${cameraMoved(cam0, cam1).toFixed(3)})`);
  if (after.past !== before.past + 1) throw new Error(`${input} 3D drag: ${after.past - before.past} undo steps for one drag`);
  if (after.dragging) throw new Error(`${input} 3D drag: the store is still dragging after release`);
  if (!cam1.enabled) throw new Error(`${input} 3D drag: the camera controls were left switched off`);
  return { before, after };
}

/**
 * In 3D: drags a wall-hung piece sideways along the north wall, from a point on its face to where
 * that point is when the piece sits at `toX` (chosen clear of every edge it could snap to). It must
 * slide along the wall to there (same wall, same rotation), end under the pointer, leave the camera
 * where it was, and be one undo step. `face` is the grabbed point: inches in front of the piece's
 * centre line (its y) and height off the floor.
 */
async function drag3dWallPiece(h, input, id, face, toX) {
  const before = await state(h);
  const cam0 = await camera(h);
  const a = before.items[id];
  const from = await scenePt(h, { x: a.x, y: a.y + face.front }, face.z);
  const hit = await pick3d(h, from);
  if (hit !== id) throw new Error(`3D: ${id}'s face (${from.x.toFixed(0)},${from.y.toFixed(0)}) picks ${hit}, not ${id}`);
  const to = await scenePt(h, { x: toX, y: a.y + face.front }, face.z);
  await drag(h, input, from, to, { steps: 16 });
  await h.sleep(350);
  const after = await state(h);
  const cam1 = await camera(h);
  const b = after.items[id];
  const land = await scenePt(h, { x: b.x, y: b.y + face.front }, face.z);
  const off = Math.hypot(land.x - to.x, land.y - to.y);
  h.note(`${input} 3D drag of ${id}: ${fmt(a)} → ${fmt(b)} (aimed at x ${toX}); its face is ${off.toFixed(1)}px from the release point; camera moved ${cameraMoved(cam0, cam1).toFixed(4)}`);
  if (!near(b.x, toX, 2)) throw new Error(`${input} 3D drag of ${id}: it slid to x ${b.x.toFixed(1)}, the pointer took it to x ${toX}`);
  if (b.y !== a.y || b.rotation !== a.rotation) throw new Error(`${input} 3D drag of ${id}: it left the north wall (${fmt(a)} → ${fmt(b)})`);
  if (off > 12) throw new Error(`${input} 3D drag of ${id}: it ended ${off.toFixed(0)}px from the pointer`);
  if (cameraMoved(cam0, cam1) > 1e-3) throw new Error(`${input} 3D drag of ${id}: the camera orbited (moved ${cameraMoved(cam0, cam1).toFixed(3)})`);
  if (after.past !== before.past + 1) throw new Error(`${input} 3D drag of ${id}: ${after.past - before.past} undo steps for one drag`);
  if (after.dragging) throw new Error(`${input} 3D drag of ${id}: the store is still dragging after release`);
  if (!cam1.enabled) throw new Error(`${input} 3D drag of ${id}: the camera controls were left switched off`);
  const others = { ...after, items: { ...after.items, [id]: a } };
  sameItems(before, others, `${input} 3D drag of ${id} (everything else)`);
  return { before, after };
}

/**
 * In 3D: the wall cabinet dragged off the north wall and onto the west wall, released over the
 * west wall's face at y 60. It must go onto the west wall facing into the room (rotation 270, back
 * flush at x 6), end under the pointer (the release point picks it), keep its camera and take one
 * undo step.
 */
async function drag3dWallCorner(h, input) {
  const before = await state(h);
  const cam0 = await camera(h);
  const a = before.items['mv-wall'];
  const from = await scenePt(h, { x: a.x, y: a.y + WALL_FACE.front }, WALL_FACE.z);
  if ((await pick3d(h, from)) !== 'mv-wall') throw new Error('3D corner: the wall cabinet is not under its own face point');
  const to = await scenePt(h, { x: 0, y: 60 }, WALL_FACE.z);
  await drag(h, input, from, to, { steps: 24 });
  await h.sleep(350);
  const after = await state(h);
  const cam1 = await camera(h);
  const b = after.items['mv-wall'];
  const under = await pick3d(h, to);
  h.note(`${input} 3D drag of mv-wall round the corner: ${fmt(a)} → ${fmt(b)}; the release point picks ${under}; camera moved ${cameraMoved(cam0, cam1).toFixed(4)}`);
  if (b.rotation !== 270 || Math.abs(b.x - 6) > 0.01) throw new Error(`${input} 3D corner: the wall cabinet is at ${fmt(b)}, not on the west wall facing the room (x 6 @270°)`);
  if (!(b.y > 40 && b.y < 80)) throw new Error(`${input} 3D corner: the wall cabinet landed at y ${b.y.toFixed(1)}, the pointer was at y 60`);
  if (under !== 'mv-wall') throw new Error(`${input} 3D corner: the cabinet is not under the pointer (${under} is)`);
  if (cameraMoved(cam0, cam1) > 1e-3) throw new Error(`${input} 3D corner: the camera orbited`);
  if (after.past !== before.past + 1) throw new Error(`${input} 3D corner: ${after.past - before.past} undo steps for one drag`);
  return { before, after };
}

/** The wall cabinet's door face (6″ in front of its centre, half way up) and the window's glass. */
const WALL_FACE = { front: 6, z: 54 + 15 };
const WINDOW_FACE = { front: 0, z: 42 + 21 };

/**
 * In 3D: a doorway in the west wall pressed in the MIDDLE of its hole (at height `z`, on the wall
 * line), not on its trim, and dragged along the wall to y `toY`. It must be grabbed (not orbit the
 * camera), slide there on the same wall at the same rotation, end under the pointer, and be one
 * undo step with nothing else moved.
 */
async function drag3dDoorway(h, input, id, toY, z = 40) {
  const before = await state(h);
  const cam0 = await camera(h);
  const a = before.items[id];
  const from = await scenePt(h, { x: a.x, y: a.y }, z);
  const hit = await pick3d(h, from);
  if (hit !== id) throw new Error(`3D: a press in the middle of ${id} (${from.x.toFixed(0)},${from.y.toFixed(0)}) picks ${hit}, not the doorway`);
  const to = await scenePt(h, { x: a.x, y: toY }, z);
  await drag(h, input, from, to, { steps: 16 });
  await h.sleep(350);
  const after = await state(h);
  const cam1 = await camera(h);
  const b = after.items[id];
  const land = await scenePt(h, { x: b.x, y: b.y }, z);
  const off = Math.hypot(land.x - to.x, land.y - to.y);
  h.note(`${input} 3D drag of ${id} from the middle of its hole: ${fmt(a)} → ${fmt(b)} (aimed at y ${toY}); ${off.toFixed(1)}px from the release point; camera moved ${cameraMoved(cam0, cam1).toFixed(4)}`);
  if (cameraMoved(cam0, cam1) > 1e-3) throw new Error(`${input} 3D drag of ${id}: the camera orbited instead (moved ${cameraMoved(cam0, cam1).toFixed(3)})`);
  if (!near(b.y, toY, 2)) throw new Error(`${input} 3D drag of ${id}: it slid to y ${b.y.toFixed(1)}, the pointer took it to y ${toY}`);
  if (b.x !== a.x || b.rotation !== a.rotation) throw new Error(`${input} 3D drag of ${id}: it left the west wall (${fmt(a)} → ${fmt(b)})`);
  if (off > 12) throw new Error(`${input} 3D drag of ${id}: it ended ${off.toFixed(0)}px from the pointer`);
  if (after.past !== before.past + 1) throw new Error(`${input} 3D drag of ${id}: ${after.past - before.past} undo steps for one drag`);
  if (after.dragging || !cam1.enabled) throw new Error(`${input} 3D drag of ${id}: still dragging, or the camera controls were left off`);
  sameItems(before, { ...after, items: { ...after.items, [id]: a } }, `${input} 3D drag of ${id} (everything else)`);
  return { before, after };
}

/** In 3D: a drag that starts on empty floor orbits the camera and moves nothing. */
async function orbit3d(h, input) {
  const before = await state(h);
  const cam0 = await camera(h);
  const from = await scenePt(h, EMPTY_B, 0);
  const hit = await pick3d(h, from);
  if (hit) throw new Error(`3D: empty floor at (${EMPTY_B.x}, ${EMPTY_B.y}) picks ${hit}`);
  const to = { x: from.x - 140, y: from.y + 10 };
  await drag(h, input, from, to, { steps: 16 });
  await h.sleep(400);
  const after = await state(h);
  const cam1 = await camera(h);
  h.note(`${input} 3D orbit: camera moved ${cameraMoved(cam0, cam1).toFixed(3)}`);
  sameItems(before, after, `${input} 3D orbit`);
  if (after.past !== before.past) throw new Error(`${input} 3D orbit: an undo step was added`);
  if (cameraMoved(cam0, cam1) < 0.05) throw new Error(`${input} 3D orbit: dragging empty space did not move the camera`);
  // Let the damping die down before anything else measures the camera.
  await settle(h, () => JSON.stringify(window.__blumodelQA.scene3d.cameraState()), { gap: 300, max: 5000 });
}

/** Pinch out over the island (fingers land on it): the plan zooms; nothing moves; the page stays put. */
async function pinchPlan(h) {
  const before = await state(h);
  const v0 = await planView(h);
  const c = await planPt(h, ISLAND);
  await h.pinch(c, { from: 70, to: 170, steps: 14 });
  await h.sleep(150);
  const v1 = await planView(h);
  const after = await state(h);
  h.note(`pinch: scale ${v0.scale.toFixed(2)} → ${v1.scale.toFixed(2)}`);
  sameItems(before, after, 'pinch over the island');
  if (after.past !== before.past || after.dragging) throw new Error('pinch: it touched the undo history or left a drag open');
  if (!(v1.scale > v0.scale * 1.8)) throw new Error(`pinch: the plan only zoomed ${v0.scale.toFixed(2)} → ${v1.scale.toFixed(2)} for fingers 70 → 170px apart`);
  // The room point under the fingers' midpoint stays under it.
  const back = await h.evaluate((x, y) => window.__blumodelQA.plan.toRoom(x, y), c.x, c.y);
  if (!near(back.x, ISLAND.x, 1.5) || !near(back.y, ISLAND.y, 1.5)) throw new Error(`pinch: the point under the fingers drifted to (${back.x.toFixed(1)}, ${back.y.toFixed(1)})`);
  await pageStill(h, 'pinch');
  // And back out again.
  await h.pinch(c, { from: 170, to: 80, steps: 10 });
  await h.sleep(150);
  const v2 = await planView(h);
  if (!(v2.scale < v1.scale * 0.7)) throw new Error(`pinch in: the plan did not zoom out (${v1.scale.toFixed(2)} → ${v2.scale.toFixed(2)})`);
  await pageStill(h, 'pinch in');
}

/** Two fingers moving together pan the plan (scale unchanged); nothing moves. */
async function twoFingerPanPlan(h) {
  const before = await state(h);
  const v0 = await planView(h);
  const c = await planPt(h, ISLAND);
  await twoFingerPan(h, { x: c.x - 40, y: c.y }, { x: c.x + 40, y: c.y }, 60, -45);
  await h.sleep(150);
  const v1 = await planView(h);
  const after = await state(h);
  h.note(`two-finger pan: view ${v0.x.toFixed(0)},${v0.y.toFixed(0)} → ${v1.x.toFixed(0)},${v1.y.toFixed(0)}, scale ${v0.scale.toFixed(2)} → ${v1.scale.toFixed(2)}`);
  sameItems(before, after, 'two-finger pan');
  if (!near(v1.x - v0.x, 60, 3) || !near(v1.y - v0.y, -45, 3)) throw new Error(`two-finger pan: the plan moved ${(v1.x - v0.x).toFixed(1)},${(v1.y - v0.y).toFixed(1)}px for a 60,-45px pan`);
  if (Math.abs(v1.scale / v0.scale - 1) > 0.02) throw new Error(`two-finger pan: the scale changed ${v0.scale.toFixed(3)} → ${v1.scale.toFixed(3)}`);
  await pageStill(h, 'two-finger pan');
}

/** One finger (or the mouse) on empty floor pans the plan; nothing moves; the selection stays. */
async function panEmpty(h, input) {
  const before = await state(h);
  const v0 = await planView(h);
  const from = await planPt(h, EMPTY_A);
  const to = { x: from.x + 70, y: from.y - 40 };
  await drag(h, input, from, to, { steps: 12 });
  await h.sleep(150);
  const v1 = await planView(h);
  const after = await state(h);
  h.note(`${input} pan on empty floor: view moved ${(v1.x - v0.x).toFixed(1)},${(v1.y - v0.y).toFixed(1)}px`);
  sameItems(before, after, `${input} pan`);
  if (!near(v1.x - v0.x, 70, 2) || !near(v1.y - v0.y, -40, 2)) throw new Error(`${input} pan: the plan moved ${(v1.x - v0.x).toFixed(1)},${(v1.y - v0.y).toFixed(1)}px for a 70,-40px drag`);
  if (after.selectedId !== before.selectedId) throw new Error(`${input} pan: the selection changed (${before.selectedId} → ${after.selectedId})`);
  if (after.past !== before.past) throw new Error(`${input} pan: an undo step was added`);
}

/** The newest item that wasn't in `before`. */
function added(before, after) {
  const ids = Object.keys(after.items).filter((id) => !before.items[id]);
  return ids.length === 1 ? { id: ids[0], ...after.items[ids[0]] } : null;
}

/** Drags a catalog card onto a view at room point `p` (mouse, or touch with a hold first). */
async function catalogDrop(h, input, card, view, p) {
  const before = await state(h);
  const to = view === 'plan' ? await planPt(h, p) : await scenePt(h, p, 0);
  const expect = await dropAt(h, to);
  if (!expect || expect.id !== (view === 'plan' ? 'plan' : '3d')) throw new Error(`catalog drop: (${to.x.toFixed(0)},${to.y.toFixed(0)}) is over ${expect?.id ?? 'nothing'}, not the ${view}`);
  const from = await h.rectOf(card);
  if (!(from.w > 0)) throw new Error(`catalog drop: ${card} is not visible`);
  await drag(h, input, from, to, input === 'mouse' ? { steps: 20 } : { steps: 20, holdMs: 380 });
  await h.sleep(250);
  const after = await state(h);
  const n = added(before, after);
  if (!n) throw new Error(`${input} catalog drag onto the ${view}: ${after.count - before.count} items added (want 1)`);
  h.note(`${input} catalog drag onto the ${view}: added ${n.productId} at ${fmt(n)} (dropped at (${expect.point.x.toFixed(1)}, ${expect.point.y.toFixed(1)}))`);
  if (!near(n.x, expect.point.x, 1) || !near(n.y, expect.point.y, 1)) throw new Error(`${input} catalog drop onto the ${view}: placed at ${fmt(n)}, dropped at (${expect.point.x.toFixed(1)}, ${expect.point.y.toFixed(1)})`);
  if (after.past !== before.past + 1) throw new Error(`${input} catalog drop: ${after.past - before.past} undo steps`);
  if (after.selectedId !== n.id) throw new Error(`${input} catalog drop: the new piece is not selected`);
  if (await h.evaluate(() => document.body.classList.contains('is-catalog-dragging') || !!document.querySelector('.drag-ghost'))) throw new Error(`${input} catalog drop: the drag ghost is still up`);
  return { before, after, item: n };
}

/** The bottom bar's buttons. */
const ADD = '.mbar-actions button[aria-label="Add products"]';
const ROOM = '.mbar-actions button[aria-label="Room and finishes"]';

async function openSheet(h, btn, sheetSel) {
  await tap(h, btn);
  await h.waitFor(`${sheetSel}.is-open`, 4000);
  await h.sleep(380); // the slide-up transition
  // A slow renderer (--swiftshader, 3D on screen) can still be mid-slide: wait for it to land, or
  // the next tap is aimed at where a card was a moment ago.
  await h.waitUntil(
    `() => { const s = document.querySelector(${JSON.stringify(`${sheetSel}.is-open`)}); return !!s && s.getAnimations().every((a) => a.playState === 'finished'); }`,
    4000,
    `${sheetSel} to finish sliding open`,
  );
}

async function sheetGone(h, what) {
  const sheets = () =>
    [...document.querySelectorAll('.sheet')].map((s) => {
      const b = s.getBoundingClientRect();
      const st = getComputedStyle(s);
      const open = s.classList.contains('is-open');
      return { open, shown: open || (st.visibility !== 'hidden' && b.top < innerHeight && b.left < innerWidth), title: s.getAttribute('aria-label'), vis: st.visibility, top: b.top, left: b.left, inert: s.hasAttribute('inert') };
    });
  // The slide-away transition is 0.38 s; give a slow renderer (--swiftshader) longer to finish it.
  await h.sleep(420);
  await h.waitUntil(`() => (${sheets})().every((s) => !s.shown)`, 3000, `${what}: every sheet to finish closing`).catch(() => {});
  const r = await h.evaluate(sheets);
  const shown = r.filter((s) => s.shown);
  if (shown.length) throw new Error(`${what}: a sheet is still showing: ${JSON.stringify(shown)}`);
  if (r.some((s) => !s.inert)) throw new Error(`${what}: a closed sheet is not inert`);
  const veil = await h.evaluate(() => getComputedStyle(document.querySelector('.sheet-backdrop')).visibility);
  if (veil !== 'hidden') throw new Error(`${what}: the backdrop is still up`);
}

/** Search the catalog (desktop panel or the phone sheet) so `productId`'s card is first. */
async function searchCatalog(h, text, input) {
  await press(h, input, '#catalog-search');
  await h.evaluate(() => {
    const el = document.getElementById('catalog-search');
    el.focus();
    el.select(); // the search keeps its text between openings: replace it, don't append to it
  });
  await h.type(text);
  await h.sleep(200);
  await h.evaluate(() => document.activeElement && document.activeElement.blur());
}

/** Phone tap-to-place: tap a card (sheet closes, banner shows), tap the room (placed there, banner gone). */
async function tapToPlace(h, view, p) {
  const before = await state(h);
  await openSheet(h, ADD, '.sheet--catalog');
  await tap(h, '.sheet .product-card[data-product="stool"]');
  await h.sleep(450);
  const armed = await state(h);
  if (armed.armed !== 'stool') throw new Error(`tap-to-place: tapping the Counter Stool card armed ${armed.armed}`);
  await sheetGone(h, 'tap-to-place (card tapped)');
  const banner = await h.evaluate(() => {
    const b = document.querySelector('.place-banner');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const stage = document.querySelector('.app .stage').getBoundingClientRect();
    const t = b.querySelector('.place-banner-text');
    return { text: b.textContent, inside: r.left >= stage.left && r.right <= stage.right && r.top >= stage.top && r.bottom <= stage.bottom, h: r.height, cut: t.scrollWidth > t.clientWidth + 1 };
  });
  if (!banner) throw new Error('tap-to-place: no banner while a product is armed');
  if (!/Counter Stool/.test(banner.text) || !/Cancel/.test(banner.text)) throw new Error(`tap-to-place: the banner reads "${banner.text}"`);
  if (banner.cut) throw new Error(`tap-to-place: the banner's text is cut off ("${banner.text}")`);
  if (!banner.inside) throw new Error('tap-to-place: the banner is not over the canvas');
  if (await h.evaluate(() => !!document.querySelector('.sel-toolbar'))) throw new Error('tap-to-place: the selection toolbar is up while placing');
  await h.shot(`placing-${view}`);
  const c = view === 'plan' ? await planPt(h, p) : await scenePt(h, p, 0);
  const expect = await dropAt(h, c);
  await tap(h, c);
  await h.sleep(450);
  const after = await state(h);
  const n = added(before, after);
  if (!n || n.productId !== 'stool') throw new Error(`tap-to-place in ${view}: ${after.count - before.count} items added (${n?.productId ?? 'none'})`);
  h.note(`tap-to-place in ${view}: stool at ${fmt(n)} (tapped (${expect.point.x.toFixed(1)}, ${expect.point.y.toFixed(1)}))`);
  if (!near(n.x, expect.point.x, 1) || !near(n.y, expect.point.y, 1)) throw new Error(`tap-to-place in ${view}: placed at ${fmt(n)}, tapped (${expect.point.x.toFixed(1)}, ${expect.point.y.toFixed(1)})`);
  if (after.armed) throw new Error('tap-to-place: still armed after placing');
  if (await h.evaluate(() => !!document.querySelector('.place-banner'))) throw new Error('tap-to-place: the banner stayed after placing');
  if (after.past !== before.past + 1) throw new Error(`tap-to-place: ${after.past - before.past} undo steps`);
  return n;
}

async function tapToPlaceCancel(h) {
  const before = await state(h);
  await openSheet(h, ADD, '.sheet--catalog');
  await tap(h, '.sheet .product-card[data-product="stool"]');
  await h.waitFor('.place-banner', 3000);
  await h.sleep(250);
  await tap(h, '.place-banner-cancel');
  await h.sleep(400);
  const after = await state(h);
  if (after.armed) throw new Error('tap-to-place Cancel: still armed');
  if (await h.evaluate(() => !!document.querySelector('.place-banner'))) throw new Error('tap-to-place Cancel: the banner is still up');
  if (after.count !== before.count) throw new Error(`tap-to-place Cancel: ${after.count - before.count} items added`);
  // A tap on the room afterwards only selects/deselects: nothing is placed.
  await tap(h, await planPt(h, EMPTY_A));
  await h.sleep(400);
  const later = await state(h);
  if (later.count !== before.count) throw new Error('tap-to-place Cancel: a later tap on the room still placed the product');
}

/** The phone shell: bar pinned to the bottom with ≥44px targets, canvas filling the rest, nothing inline. */
async function phoneShell(h, what) {
  const r = await h.evaluate(() => {
    const bar = document.querySelector('.mbar').getBoundingClientRect();
    const btns = [...document.querySelectorAll('.mbar button')].map((b) => {
      const x = b.getBoundingClientRect();
      return { w: x.width, h: x.height, label: b.textContent.trim() };
    });
    const stage = document.querySelector('.app .stage').getBoundingClientRect();
    const top = document.querySelector('.topbar').getBoundingClientRect();
    return { bar: { t: bar.top, b: bar.bottom }, btns, stage: { t: stage.top, b: stage.bottom, h: stage.height, w: stage.width }, topB: top.bottom, vh: innerHeight, vw: innerWidth, docH: document.documentElement.scrollHeight };
  });
  h.note(`${what}: top bar to ${Math.round(r.topB)}px, canvas ${Math.round(r.stage.w)}×${Math.round(r.stage.h)}, bottom bar ${Math.round(r.bar.t)}–${Math.round(r.bar.b)} of ${r.vh}`);
  if (Math.abs(r.bar.b - r.vh) > 1) throw new Error(`${what}: the bottom bar ends at ${r.bar.b}px in a ${r.vh}px screen`);
  const small = r.btns.filter((b) => b.h < 44 || b.w < 44);
  if (small.length) throw new Error(`${what}: bottom-bar buttons under 44px: ${small.map((b) => `${b.label} ${Math.round(b.w)}×${Math.round(b.h)}`).join(', ')}`);
  if (r.stage.b > r.bar.t + 1) throw new Error(`${what}: the canvas runs under the bottom bar (${r.stage.b} > ${r.bar.t})`);
  if (r.bar.t - r.stage.b > 2) throw new Error(`${what}: a ${Math.round(r.bar.t - r.stage.b)}px gap between the canvas and the bar`);
  if (r.stage.t < r.topB - 1) throw new Error(`${what}: the canvas is under the top bar`);
  if (r.stage.h < r.vh * 0.5) throw new Error(`${what}: the canvas is only ${Math.round(r.stage.h)}px of ${r.vh}px`);
  if (r.docH > r.vh + 1) throw new Error(`${what}: the page is ${r.docH}px tall in a ${r.vh}px screen (something renders inline)`);
}

/** Sideways swipes (and a pull down) across the top and bottom bars: the browser must not go back or reload. */
async function swipesStay(h) {
  const before = await state(h);
  const { vw, vh, tY, bY } = await h.evaluate(() => {
    const mid = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return r.top + r.height / 2;
    };
    return { vw: innerWidth, vh: innerHeight, tY: mid('.topbar'), bY: mid('.mbar') };
  });
  const swipes = [
    ['right across the top bar', { x: 24, y: tY }, { x: vw - 24, y: tY }],
    ['left across the top bar', { x: vw - 24, y: tY }, { x: 24, y: tY }],
    ['right across the bottom bar', { x: 24, y: bY }, { x: vw - 24, y: bY }],
    ['left across the bottom bar', { x: vw - 24, y: bY }, { x: 24, y: bY }],
    ['down from the top bar', { x: vw / 2, y: tY }, { x: vw / 2, y: Math.min(vh - 120, tY + 420) }],
  ];
  for (const [what, a, b] of swipes) {
    await h.touchDrag(a, b, { steps: 6, stepMs: 12 }); // a quick flick, the kind that triggers swipe-back
    await h.sleep(900);
    const now = await h.evaluate(() => ({ href: location.href, editor: !!document.querySelector('.app .mbar') }));
    if (!/#\/local$/.test(now.href) || !now.editor) throw new Error(`a swipe ${what} left the editor (now at ${now.href})`);
  }
  const after = await state(h);
  sameItems(before, after, 'swipes on the bars');
  if (after.past !== before.past) throw new Error('swipes on the bars added an undo step');
  await pageStill(h, 'swipes on the bars');
}

// ─── routes ──────────────────────────────────────────────────────────────────

// Any view's canvas: a phone opens on the 3D, a desktop on Split; each route's start() picks its own.
const LOCAL = { path: '#/local', as: 'anon', waitFor: ['.topbar', '.stage canvas'] };

export default [
  // ── Desktop, mouse ──────────────────────────────────────────────────────
  {
    ...LOCAL,
    name: 'move-desktop-plan-drag',
    check: async (h) => {
      await start(h, 'plan');
      const island = await planDragIsland(h, 'mouse');
      await h.shot('dragged');
      await undoRestores(h, island.before, 'key');
      const snap = await planDragSnap(h, 'mouse');
      await h.shot('snapped');
      await undoRestores(h, snap.before, 'click');
    },
  },
  {
    ...LOCAL,
    name: 'move-desktop-plan-click-pan-zoom',
    check: async (h) => {
      await start(h, 'plan');
      await tapSelects(h, 'mouse');
      // A click on empty floor deselects.
      await h.click(await planPt(h, EMPTY_A));
      await h.sleep(150);
      if ((await state(h)).selectedId !== null) throw new Error('a click on empty floor did not deselect');
      await tapSelects(h, 'mouse', { x: 48, y: 12 }, 'mv-base');
      await panEmpty(h, 'mouse');
      // The wheel zooms at the pointer.
      const v0 = await planView(h);
      const c = await planPt(h, ISLAND);
      await h.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: c.x, y: c.y, deltaX: 0, deltaY: -240 });
      await h.sleep(200);
      const v1 = await planView(h);
      const back = await h.evaluate((x, y) => window.__blumodelQA.plan.toRoom(x, y), c.x, c.y);
      h.note(`wheel: scale ${v0.scale.toFixed(2)} → ${v1.scale.toFixed(2)}`);
      if (!(v1.scale > v0.scale * 1.2)) throw new Error(`the wheel did not zoom in (${v0.scale.toFixed(2)} → ${v1.scale.toFixed(2)})`);
      if (!near(back.x, ISLAND.x, 1) || !near(back.y, ISLAND.y, 1)) throw new Error('the wheel zoom did not keep the point under the pointer');
      await pageStill(h, 'wheel');
    },
  },
  {
    ...LOCAL,
    name: 'move-desktop-3d-drag-orbit',
    timeoutMs: 40_000,
    check: async (h) => {
      await start(h, '3d');
      const d = await drag3dItem(h, 'mouse');
      await h.shot('dragged');
      await undoRestores(h, d.before, 'key');
      await orbit3d(h, 'mouse');
      // A click (no travel) on the island selects it and moves nothing.
      const before = await state(h);
      const c = await scenePt(h, before.items['mv-island'], ISLAND.top);
      await h.click(c);
      await h.sleep(300);
      const after = await state(h);
      sameItems(before, after, '3D click');
      if (after.selectedId !== 'mv-island') throw new Error(`a click on the island in 3D selected ${after.selectedId}`);
    },
  },
  {
    ...LOCAL,
    name: 'move-desktop-3d-wall-pieces',
    timeoutMs: 40_000,
    check: async (h) => {
      await start(h, '3d', wallDoc());
      // x 127 is clear of every edge the cabinet could snap to (6″ edge snap); the window at x 90
      // stays clear of the fridge and the cabinet (no collision in Checks).
      const w = await drag3dWallPiece(h, 'mouse', 'mv-wall', WALL_FACE, 127);
      await h.shot('wall-cabinet');
      await undoRestores(h, w.before, 'key');
      const corner = await drag3dWallCorner(h, 'mouse');
      await h.shot('corner');
      await undoRestores(h, corner.before, 'key');
      const win = await drag3dWallPiece(h, 'mouse', 'mv-window', WINDOW_FACE, 90);
      await h.shot('window');
      await undoRestores(h, win.before, 'key');
    },
  },
  {
    ...LOCAL,
    name: 'move-desktop-3d-doors',
    timeoutMs: 40_000,
    check: async (h) => {
      await start(h, '3d', doorDoc());
      // A click in the middle of each doorway selects that doorway (and moves nothing); a drag
      // from there moves it.
      for (const [id, y] of [['mv-open', 112], ['mv-door', 55]]) {
        const s0 = await state(h);
        await h.click(await scenePt(h, { x: 0, y }, 40));
        await h.sleep(300);
        const s1 = await state(h);
        sameItems(s0, s1, `a click in the middle of ${id}`);
        if (s1.selectedId !== id) throw new Error(`a click in the middle of ${id} selected ${s1.selectedId}`);
      }
      const o = await drag3dDoorway(h, 'mouse', 'mv-open', 125);
      await h.shot('opening');
      await undoRestores(h, o.before, 'key');
      const d = await drag3dDoorway(h, 'mouse', 'mv-door', 66);
      await undoRestores(h, d.before, 'key');
    },
  },
  {
    ...LOCAL,
    name: 'move-desktop-catalog-drop',
    timeoutMs: 40_000,
    check: async (h) => {
      await start(h, 'split');
      await searchCatalog(h, 'stool', 'mouse');
      const card = '.left-panel .product-card[data-product="stool"]';
      await h.waitFor(card, 4000);
      const onPlan = await catalogDrop(h, 'mouse', card, 'plan', EMPTY_A);
      await undoRestores(h, onPlan.before, 'key');
      const on3d = await catalogDrop(h, 'mouse', card, '3d', EMPTY_B);
      await h.shot('dropped-3d');
      await undoRestores(h, on3d.before, 'key');
      // Released over neither view: nothing is added.
      const before = await state(h);
      const from = await h.rectOf(card);
      await h.mouseDrag(from, { x: from.cx + 40, y: from.cy + 220 }, { steps: 12 });
      await h.sleep(250);
      if ((await state(h)).count !== before.count) throw new Error('a product dropped back on the catalog was added anyway');
    },
  },
  {
    ...LOCAL,
    name: 'move-desktop-toolbar-plan',
    check: async (h) => {
      await start(h, 'plan');
      await tapSelects(h, 'mouse');
      await toolbarNextToSelection(h, 'plan, island');
      await h.shot('island');
      await toolbarHidesDuringDrag(h, 'mouse');
      await toolbarNextToSelection(h, 'plan, after a drag');
      await toolbarActions(h, 'mouse');
      // A piece hard against the top of the canvas: the toolbar flips below it.
      await tapSelects(h, 'mouse', { x: 48, y: 12 }, 'mv-base');
      const b = await planPt(h, { x: 48, y: 0 });
      const top = await h.evaluate(() => document.querySelector('.plan-view').getBoundingClientRect().top);
      const from = await planPt(h, EMPTY_A);
      await h.mouseDrag(from, { x: from.x, y: from.y - (b.y - top - 14) }, { steps: 14 });
      await h.sleep(250);
      const flipped = await toolbarNextToSelection(h, 'plan, base at the top edge');
      if (flipped.side !== 'below') throw new Error(`with the base at the top of the canvas the toolbar is ${flipped.side}, not below`);
      await h.shot('flipped-below');
      // Half off the left edge: the toolbar stays on the canvas.
      const left = await h.evaluate(() => document.querySelector('.plan-view').getBoundingClientRect().left);
      const b2 = await planPt(h, { x: 48, y: 12 });
      const from2 = await planPt(h, EMPTY_B);
      await h.mouseDrag(from2, { x: from2.x - (b2.x - left), y: from2.y + 120 }, { steps: 14 });
      await h.sleep(250);
      await toolbarNextToSelection(h, 'plan, base half off the left edge');
      await h.shot('clamped-left');
    },
  },
  {
    ...LOCAL,
    name: 'move-desktop-toolbar-3d',
    timeoutMs: 40_000,
    check: async (h) => {
      await start(h, '3d');
      const c = await scenePt(h, ISLAND, ISLAND.top);
      await h.click(c);
      await h.sleep(300);
      if ((await state(h)).selectedId !== 'mv-island') throw new Error('a click on the island in 3D did not select it');
      const r = await toolbarNextToSelection(h, '3D, island');
      if (r.source !== '3d') throw new Error(`the toolbar follows the ${r.source} view, not 3D`);
      await h.shot('island');
      // Hidden while the piece is dragged in 3D.
      const from = await scenePt(h, ISLAND, ISLAND.top);
      await mouse(h, 'mouseMoved', from);
      await mouse(h, 'mousePressed', from, 1);
      await mouse(h, 'mouseMoved', { x: from.x + 12, y: from.y + 4 }, 1);
      await mouse(h, 'mouseMoved', { x: from.x + 40, y: from.y + 12 }, 1);
      await h.sleep(150);
      const during = await h.evaluate(() => ({ bar: !!document.querySelector('.sel-toolbar'), dragging: window.__blumodel.store.getState().dragging }));
      await mouse(h, 'mouseReleased', { x: from.x + 40, y: from.y + 12 });
      await h.sleep(300);
      if (!during.dragging) throw new Error('3D: pressing the island and moving 40px did not start a drag');
      if (during.bar) throw new Error('3D: the toolbar stayed up during the drag');
      await toolbarNextToSelection(h, '3D, after a drag');
      await toolbarActions(h, 'mouse');
    },
  },
  {
    ...LOCAL,
    name: 'move-desktop-keyboard',
    check: async (h) => {
      await start(h, 'plan');
      await tapSelects(h, 'mouse');
      const s0 = await state(h);
      const i0 = s0.items['mv-island'];
      await h.key('r');
      await h.key('ArrowRight');
      await h.key('ArrowDown', { modifiers: ['shift'] });
      await h.sleep(100);
      const s1 = await state(h);
      const i1 = s1.items['mv-island'];
      h.note(`keys R, →, Shift+↓: island ${fmt(i0)} → ${fmt(i1)}`);
      if (i1.rotation !== 90) throw new Error(`R: the island is at ${i1.rotation}°`);
      if (!near(i1.x, i0.x + 1, 0.01) || !near(i1.y, i0.y + 6, 0.01)) throw new Error(`arrows: the island went ${fmt(i0)} → ${fmt(i1)} (want +1, +6)`);
      await h.key('d', { modifiers: ['ctrl'] });
      await h.sleep(100);
      const s2 = await state(h);
      if (s2.count !== s1.count + 1) throw new Error('Ctrl+D did not duplicate');
      await h.key('Delete');
      await h.sleep(100);
      const s3 = await state(h);
      if (s3.count !== s1.count) throw new Error('Delete did not remove the selected copy');
      await h.key('z', { modifiers: ['ctrl'] });
      await h.sleep(100);
      if ((await state(h)).count !== s2.count) throw new Error('Ctrl+Z did not bring the deleted copy back');
      await h.key('z', { modifiers: ['ctrl', 'shift'] });
      await h.sleep(100);
      if ((await state(h)).count !== s3.count) throw new Error('Ctrl+Shift+Z did not redo the delete');
      await h.key('Escape');
      await h.sleep(100);
      if ((await state(h)).selectedId !== null) throw new Error('Escape did not clear the selection');
      // 1–4 follow the view tabs: 3D, Split, Plan, Walls.
      await h.key('1');
      await h.sleep(150);
      if ((await state(h)).viewMode !== '3d') throw new Error('1 did not switch to the 3D view');
      await h.key('3');
      await readyPlan(h);
      if ((await state(h)).viewMode !== 'plan') throw new Error('3 did not switch back to the plan');
      await h.key('/');
      // The shortcut focuses the search on the next animation frame (late on a slow renderer).
      await h.waitUntil(() => document.activeElement?.id === 'catalog-search', 3000, '/ focusing the catalog search');
    },
  },
  {
    ...LOCAL,
    name: 'move-desktop-persist-reload',
    check: async (h) => {
      await start(h, 'plan');
      const { after } = await planDragIsland(h, 'mouse', -70, 40);
      await h.sleep(900); // the device draft saves 400 ms after the last change
      await h.reload();
      await readyPlan(h);
      const now = await state(h);
      const a = after.items['mv-island'];
      const b = now.items['mv-island'];
      h.note(`after reload: island ${fmt(b)} (moved to ${fmt(a)})`);
      if (!b || b.x !== a.x || b.y !== a.y) throw new Error(`after a reload the island is at ${fmt(b)}, it was moved to ${fmt(a)}`);
      // Reloading straight after a drag (inside the 400 ms) keeps it too.
      const quick = await planDragIsland(h, 'mouse', 50, -30);
      await h.reload();
      await readyPlan(h);
      const c = (await state(h)).items['mv-island'];
      const q = quick.after.items['mv-island'];
      if (!c || c.x !== q.x || c.y !== q.y) throw new Error(`reloading right after a drag: the island is at ${fmt(c)}, it was moved to ${fmt(q)}`);
    },
  },

  // ── Phone, touch (390×844) ──────────────────────────────────────────────
  {
    ...LOCAL,
    name: 'move-phone-plan-drag',
    viewport: 'phone',
    check: async (h) => {
      await start(h, 'plan');
      await phoneShell(h, 'phone');
      const island = await planDragIsland(h, 'touch', 60, 40);
      await h.shot('dragged');
      await undoRestores(h, island.before, 'tap');
      const snap = await planDragSnap(h, 'touch');
      await undoRestores(h, snap.before, 'tap');
      await pageStill(h, 'phone drags');
    },
  },
  {
    ...LOCAL,
    name: 'move-phone-plan-tap-pinch-pan',
    viewport: 'phone',
    check: async (h) => {
      await start(h, 'plan');
      await tapSelects(h, 'touch');
      await tap(h, await planPt(h, EMPTY_A));
      await h.sleep(200);
      if ((await state(h)).selectedId !== null) throw new Error('a tap on empty floor did not deselect');
      await pinchPlan(h);
      await twoFingerPanPlan(h);
      await tapSelects(h, 'touch');
      await panEmpty(h, 'touch');
      await h.shot('after');
    },
  },
  {
    ...LOCAL,
    name: 'move-phone-3d',
    viewport: 'phone',
    timeoutMs: 40_000,
    check: async (h) => {
      await start(h, 'plan');
      await showView(h, '3D');
      await phoneShell(h, 'phone 3D');
      const d = await drag3dItem(h, 'touch', 60, 20);
      await undoRestores(h, d.before, 'tap');
      await orbit3d(h, 'touch');
      // A tap on the island selects it, and the toolbar comes up next to it in 3D.
      const before = await state(h);
      await tap(h, await scenePt(h, before.items['mv-island'], ISLAND.top));
      await h.sleep(350);
      const after = await state(h);
      sameItems(before, after, '3D tap');
      if (after.selectedId !== 'mv-island') throw new Error(`a tap on the island in 3D selected ${after.selectedId}`);
      await toolbarNextToSelection(h, 'phone 3D, island');
      await h.shot('selected');
      await toolbarHidesDuringDrag(h, 'touch', await scenePt(h, after.items['mv-island'], ISLAND.top));
      await toolbarNextToSelection(h, 'phone 3D, after a drag');
      await toolbarActions(h, 'touch');
      // Pinch zooms the camera; nothing moves.
      const s0 = await state(h);
      const cam0 = await camera(h);
      const c = await scenePt(h, EMPTY_B, 0);
      await h.pinch(c, { from: 60, to: 160, steps: 12 });
      await h.sleep(400);
      const cam1 = await camera(h);
      sameItems(s0, await state(h), '3D pinch');
      if (cameraMoved(cam0, cam1) < 0.05) throw new Error('a pinch in 3D did not zoom the camera');
      await pageStill(h, '3D gestures');
    },
  },
  {
    ...LOCAL,
    name: 'move-phone-3d-wall-pieces',
    viewport: 'phone',
    timeoutMs: 40_000,
    check: async (h) => {
      await start(h, 'plan', wallDoc());
      await showView(h, '3D');
      const w = await drag3dWallPiece(h, 'touch', 'mv-wall', WALL_FACE, 127);
      await h.shot('wall-cabinet');
      await undoRestores(h, w.before, 'tap');
      const corner = await drag3dWallCorner(h, 'touch');
      await h.shot('corner');
      await undoRestores(h, corner.before, 'tap');
      const win = await drag3dWallPiece(h, 'touch', 'mv-window', WINDOW_FACE, 90);
      await undoRestores(h, win.before, 'tap');
      await pageStill(h, '3D wall-piece drags');
    },
  },
  {
    ...LOCAL,
    name: 'move-phone-3d-doors',
    viewport: 'phone',
    timeoutMs: 40_000,
    check: async (h) => {
      await start(h, 'plan', doorDoc());
      await showView(h, '3D');
      // A tap in the middle of each doorway selects that doorway and moves nothing.
      for (const [id, y] of [['mv-open', 112], ['mv-door', 55]]) {
        const s0 = await state(h);
        await tap(h, await scenePt(h, { x: 0, y }, 40));
        await h.sleep(350);
        const s1 = await state(h);
        sameItems(s0, s1, `a tap in the middle of ${id}`);
        if (s1.selectedId !== id) throw new Error(`a tap in the middle of ${id} selected ${s1.selectedId}`);
      }
      const o = await drag3dDoorway(h, 'touch', 'mv-open', 125);
      await h.shot('opening');
      await undoRestores(h, o.before, 'tap');
      const d = await drag3dDoorway(h, 'touch', 'mv-door', 66);
      await undoRestores(h, d.before, 'tap');
      await pageStill(h, '3D doorway drags');
    },
  },
  {
    ...LOCAL,
    name: 'move-phone-catalog-drag',
    viewport: 'phone',
    timeoutMs: 40_000,
    check: async (h) => {
      await start(h, 'plan');
      await openSheet(h, ADD, '.sheet--catalog');
      await searchCatalog(h, 'stool', 'touch');
      const card = '.sheet .product-card[data-product="stool"]';
      await h.waitFor(card, 4000);
      await catalogDrop(h, 'touch', card, 'plan', { x: 40, y: 50 });
      await sheetGone(h, 'phone catalog drag onto the plan');
      await h.shot('on-plan');
      await showView(h, '3D');
      await openSheet(h, ADD, '.sheet--catalog');
      await catalogDrop(h, 'touch', card, '3d', EMPTY_B);
      await sheetGone(h, 'phone catalog drag onto 3D');
      await pageStill(h, 'phone catalog drags');
    },
  },
  {
    ...LOCAL,
    name: 'move-phone-tap-to-place',
    viewport: 'phone',
    timeoutMs: 40_000,
    check: async (h) => {
      await start(h, 'plan');
      await openSheet(h, ADD, '.sheet--catalog');
      await searchCatalog(h, 'stool', 'touch');
      await tap(h, '.sheet-close');
      await sheetGone(h, 'search, then close');
      await tapToPlace(h, 'plan', EMPTY_A);
      await tapToPlaceCancel(h);
      await showView(h, '3D');
      await tapToPlace(h, '3d', EMPTY_B);
    },
  },
  {
    ...LOCAL,
    name: 'move-phone-toolbar',
    viewport: 'phone',
    check: async (h) => {
      await start(h, 'plan');
      await tapSelects(h, 'touch');
      await toolbarNextToSelection(h, 'phone plan, island');
      await h.shot('island');
      await toolbarHidesDuringDrag(h, 'touch');
      await toolbarActions(h, 'touch');
      // Details opens the Details sheet; the toolbar steps aside while it's open.
      await tapSelects(h, 'touch');
      await h.waitFor('.sel-toolbar', 3000);
      await tap(h, '.sel-toolbar button[aria-label="Finish and details"]');
      await h.waitFor('.sheet.is-open[aria-label="Details"]', 3000);
      await h.sleep(400);
      if (await h.evaluate(() => !!document.querySelector('.sel-toolbar'))) throw new Error('the toolbar stays up over the open Details sheet');
      await h.waitForText('Kitchen Island', 3000);
      await h.shot('details');
    },
  },
  {
    ...LOCAL,
    name: 'move-phone-sheets',
    viewport: 'phone',
    check: async (h) => {
      await start(h, 'plan');
      await phoneShell(h, 'phone, no sheet');
      // Add: opens at half height, right above the bottom bar.
      await openSheet(h, ADD, '.sheet--catalog');
      const half = await h.evaluate(() => {
        const s = document.querySelector('.sheet--catalog').getBoundingClientRect();
        const bar = document.querySelector('.mbar').getBoundingClientRect();
        return { top: s.top, bottom: s.bottom, h: s.height, w: s.width, barTop: bar.top, vh: innerHeight, vw: innerWidth };
      });
      h.note(`Add sheet: ${Math.round(half.w)}×${Math.round(half.h)} from ${Math.round(half.top)} to ${Math.round(half.bottom)} (bar at ${Math.round(half.barTop)})`);
      if (Math.abs(half.bottom - half.barTop) > 1) throw new Error(`the Add sheet ends at ${half.bottom}px, the bar starts at ${half.barTop}px`);
      if (!near(half.h, half.vh * 0.54, 6)) throw new Error(`the Add sheet opens ${Math.round(half.h)}px tall, not half height (${Math.round(half.vh * 0.54)})`);
      if (Math.round(half.w) !== half.vw) throw new Error(`the Add sheet is ${half.w}px wide on a ${half.vw}px phone`);
      await pageStill(h, 'Add sheet open');
      await h.shot('add-half');
      // Drag the handle up: full height.
      const handle = await h.rectOf('.sheet--catalog .sheet-handle');
      await h.touchDrag(handle, { x: handle.cx, y: 90 }, { steps: 14 });
      await h.sleep(400);
      const full = await h.evaluate(() => ({ cls: document.querySelector('.sheet--catalog').className, top: document.querySelector('.sheet--catalog').getBoundingClientRect().top, topBar: document.querySelector('.topbar').getBoundingClientRect().bottom }));
      if (!/sheet--full/.test(full.cls)) throw new Error(`dragging the handle up left the sheet at "${full.cls}"`);
      h.note(`full sheet top ${Math.round(full.top)}px (top bar ends ${Math.round(full.topBar)}px)`);
      await h.shot('add-full');
      await tap(h, '.sheet--catalog .sheet-close');
      await sheetGone(h, 'the close button');
      // Room: the backdrop closes it.
      await openSheet(h, ROOM, '.sheet[aria-label="Room & finishes"]');
      await h.shot('room');
      await tap(h, { x: 195, y: 140 });
      await sheetGone(h, 'a tap on the backdrop');
      // Details: a flick down on the handle closes it.
      await openSheet(h, '.mbar-actions button[aria-label="Details"]', '.sheet[aria-label="Details"]');
      const dh = await h.rectOf('.sheet[aria-label="Details"] .sheet-handle');
      await h.touchDrag(dh, { x: dh.cx, y: dh.cy + 260 }, { steps: 6, stepMs: 12 });
      await sheetGone(h, 'a swipe down on the handle');
      // The bar's own button toggles a sheet closed again; Escape closes too.
      await openSheet(h, ROOM, '.sheet[aria-label="Room & finishes"]');
      await tap(h, ROOM);
      await sheetGone(h, 'the Room button again');
      await openSheet(h, ADD, '.sheet--catalog');
      await h.key('Escape');
      await sheetGone(h, 'Escape');
      await pageStill(h, 'after the sheets');
      await phoneShell(h, 'phone, sheets closed again');
    },
  },
  {
    ...LOCAL,
    name: 'move-phone-persist-reload',
    viewport: 'phone',
    check: async (h) => {
      await start(h, 'plan');
      const { after } = await planDragIsland(h, 'touch', -50, 30);
      await h.sleep(900);
      await h.reload();
      await readyPlan(h);
      const b = (await state(h)).items['mv-island'];
      const a = after.items['mv-island'];
      if (!b || b.x !== a.x || b.y !== a.y) throw new Error(`after a reload the island is at ${fmt(b)}, it was moved to ${fmt(a)}`);
    },
  },

  {
    ...LOCAL,
    name: 'move-phone-swipes-stay',
    viewport: 'phone',
    check: async (h) => {
      await start(h, 'plan');
      await swipesStay(h);
    },
  },

  // ── Phone on its side (844×390) ─────────────────────────────────────────
  {
    ...LOCAL,
    name: 'move-landscape',
    viewport: 'phone-landscape',
    timeoutMs: 40_000,
    check: async (h) => {
      await start(h, 'plan');
      await phoneShell(h, 'landscape');
      const d = await planDragIsland(h, 'touch', 50, 20);
      await undoRestores(h, d.before, 'tap');
      await pinchPlan(h);
      await h.evaluate(() => window.__blumodel.store.getState().select(null));
      // Fit again so the island is on screen for the toolbar.
      await tap(h, '.plan-hud--br .zoom-pct');
      await h.sleep(300);
      await tapSelects(h, 'touch');
      await toolbarNextToSelection(h, 'landscape plan, island');
      await h.shot('toolbar');
      // Sheets are a panel on the right, above the bar.
      await openSheet(h, ADD, '.sheet--catalog');
      const r = await h.evaluate(() => {
        const s = document.querySelector('.sheet--catalog').getBoundingClientRect();
        const bar = document.querySelector('.mbar').getBoundingClientRect();
        return { l: s.left, r: s.right, t: s.top, b: s.bottom, w: s.width, barTop: bar.top, vw: innerWidth };
      });
      h.note(`landscape Add panel ${Math.round(r.w)}px wide, ${Math.round(r.t)}–${Math.round(r.b)} (bar at ${Math.round(r.barTop)})`);
      if (Math.abs(r.r - r.vw) > 1 || r.w > 401 || r.t > 1 || Math.abs(r.b - r.barTop) > 1) throw new Error(`the landscape sheet is not a right-hand panel: ${JSON.stringify(r)}`);
      await h.shot('panel');
      const head = await h.rectOf('.sheet--catalog .sheet-title h2');
      await h.touchDrag(head, { x: head.cx + 160, y: head.cy }, { steps: 8 });
      await sheetGone(h, 'landscape: a swipe right on the panel');
      await pageStill(h, 'landscape');
      // 3D on a phone on its side: a finger drags the island, empty floor orbits.
      await h.evaluate(() => window.__blumodel.store.getState().select(null));
      await showView(h, '3D');
      const d3 = await drag3dItem(h, 'touch', 70, 15);
      await undoRestores(h, d3.before, 'tap');
      await orbit3d(h, 'touch');
      await pageStill(h, 'landscape 3D');
    },
  },
  {
    ...LOCAL,
    name: 'move-landscape-3d',
    viewport: 'phone-landscape',
    timeoutMs: 40_000,
    check: async (h) => {
      // A phone on its side in 3D: the toolbar beside the island (and out of the way mid-drag),
      // then the wall cabinet slid along the wall and round the corner with a finger.
      await start(h, 'plan', wallDoc());
      await showView(h, '3D');
      await toolbar3dTouch(h, 'landscape 3D');
      await h.evaluate(() => window.__blumodel.store.getState().select(null));
      const w = await drag3dWallPiece(h, 'touch', 'mv-wall', WALL_FACE, 127);
      await undoRestores(h, w.before, 'tap');
      const corner = await drag3dWallCorner(h, 'touch');
      await h.shot('corner');
      await undoRestores(h, corner.before, 'tap');
      await pageStill(h, 'landscape 3D wall pieces');
    },
  },

  // ── Tablet, touch (820×1180) ────────────────────────────────────────────
  {
    ...LOCAL,
    name: 'move-tablet',
    viewport: 'tablet',
    timeoutMs: 40_000,
    check: async (h) => {
      await start(h, 'plan');
      await phoneShell(h, 'tablet');
      const d = await planDragIsland(h, 'touch', 80, 50);
      await undoRestores(h, d.before, 'tap');
      await pinchPlan(h);
      await tap(h, '.plan-hud--br .zoom-pct');
      await h.sleep(300);
      await tapSelects(h, 'touch');
      await toolbarNextToSelection(h, 'tablet plan, island');
      await h.evaluate(() => window.__blumodel.store.getState().select(null));
      await openSheet(h, ADD, '.sheet--catalog');
      await searchCatalog(h, 'stool', 'touch');
      await h.shot('sheet');
      await catalogDrop(h, 'touch', '.sheet .product-card[data-product="stool"]', 'plan', EMPTY_B);
      await sheetGone(h, 'tablet catalog drag');
      await tapToPlace(h, 'plan', EMPTY_A);
      await showView(h, '3D');
      const d3 = await drag3dItem(h, 'touch', 70, 25);
      await undoRestores(h, d3.before, 'tap');
      await orbit3d(h, 'touch');
      await pageStill(h, 'tablet');
    },
  },
  {
    ...LOCAL,
    name: 'move-tablet-3d',
    viewport: 'tablet',
    timeoutMs: 45_000,
    check: async (h) => {
      // Tablet in 3D: the toolbar and its buttons with a finger, wall pieces along the wall and
      // round the corner, and a card from the Add sheet held and dragged onto the 3D floor.
      await start(h, 'plan', wallDoc());
      await showView(h, '3D');
      await toolbar3dTouch(h, 'tablet 3D');
      await tap(h, await scenePt(h, (await state(h)).items['mv-island'], ISLAND.top));
      await h.sleep(350);
      await toolbarActions(h, 'touch');
      const w = await drag3dWallPiece(h, 'touch', 'mv-wall', WALL_FACE, 127);
      await undoRestores(h, w.before, 'tap');
      const corner = await drag3dWallCorner(h, 'touch');
      await undoRestores(h, corner.before, 'tap');
      const win = await drag3dWallPiece(h, 'touch', 'mv-window', WINDOW_FACE, 90);
      await undoRestores(h, win.before, 'tap');
      await openSheet(h, ADD, '.sheet--catalog');
      await searchCatalog(h, 'stool', 'touch');
      const card = '.sheet .product-card[data-product="stool"]';
      await h.waitFor(card, 4000);
      await catalogDrop(h, 'touch', card, '3d', EMPTY_B);
      await sheetGone(h, 'tablet catalog drag onto 3D');
      await h.shot('dropped-3d');
      await pageStill(h, 'tablet 3D');
    },
  },

  // ── Tablet, pen (820×1180) ──────────────────────────────────────────────
  {
    ...LOCAL,
    name: 'move-tablet-pen',
    viewport: 'tablet',
    timeoutMs: 60_000,
    check: async (h) => {
      // A stylus (Apple Pencil, Surface pen) on a tablet: the same gestures as a finger, with pen
      // pointer events, plus a tap that lifts a few px from where it landed.
      await start(h, 'plan');
      await watchPointerTypes(h);
      await tapSelects(h, 'pen');
      const seen = await pointerTypesSeen(h);
      if (seen !== 'pen') throw new Error(`the pen's presses reached the app as "${seen}", not "pen": this route would test the wrong input`);
      await penTapWobble(h, 'plan', 5);
      const d = await planDragIsland(h, 'pen', 80, 50);
      await undoRestores(h, d.before, 'pen');
      const sn = await planDragSnap(h, 'pen');
      await undoRestores(h, sn.before, 'pen');
      await panEmpty(h, 'pen');
      await tapSelects(h, 'pen');
      await toolbarNextToSelection(h, 'tablet plan, pen');
      const t0 = await state(h);
      await toolbarHidesDuringDrag(h, 'pen');
      await undoRestores(h, t0, 'pen');
      await toolbarActions(h, 'pen');
      await openSheet(h, ADD, '.sheet--catalog');
      await searchCatalog(h, 'stool', 'pen');
      const card = '.sheet .product-card[data-product="stool"]';
      await h.waitFor(card, 4000);
      await catalogDrop(h, 'pen', card, 'plan', EMPTY_B);
      await sheetGone(h, 'pen catalog drag onto the plan');

      // 3D, in the kitchen with a wall cabinet on the north wall.
      await start(h, 'plan', wallDoc());
      await showView(h, '3D');
      await penTapWobble(h, '3d', 0);
      await penTapWobble(h, '3d', 5);
      const r = await toolbarNextToSelection(h, 'tablet 3D, pen');
      if (r.source !== '3d') throw new Error(`tablet 3D, pen: the toolbar follows the ${r.source} view, not 3D`);
      const t1 = await state(h);
      await toolbarHidesDuringDrag(h, 'pen', await scenePt(h, t1.items['mv-island'], ISLAND.top));
      await undoRestores(h, t1, 'pen');
      const d3 = await drag3dItem(h, 'pen', 70, 25);
      await undoRestores(h, d3.before, 'pen');
      const w = await drag3dWallPiece(h, 'pen', 'mv-wall', WALL_FACE, 127);
      await undoRestores(h, w.before, 'pen');
      await openSheet(h, ADD, '.sheet--catalog');
      await searchCatalog(h, 'stool', 'pen');
      await h.waitFor(card, 4000);
      await catalogDrop(h, 'pen', card, '3d', EMPTY_A);
      await sheetGone(h, 'pen catalog drag onto 3D');
      await h.shot('pen-3d');
      await orbit3d(h, 'pen');
      await pageStill(h, 'tablet pen');
    },
  },
];
