// Free-form rooms QA (docs/handoff/rooms.md): an L-shaped design with a second room opens in the
// plan, in 3D and in the wall elevations without errors, and "Walls & rooms" shows its walls.
// Run: node scripts/qa.mjs --pkg rooms --port 8830 --dist .build/rooms

const DESK = { w: 1440, h: 900 };

/** 20' x 14' L (the north-east block is 12' deep) with a 6' x 8' pantry on its east side. */
const L = [[0, 0], [240, 0], [240, 96], [144, 96], [144, 168], [0, 168]];
const PANTRY = [[240, 0], [312, 0], [312, 96], [240, 96]];

const doc = () => ({
  name: 'QA Drawn Room',
  room: { widthIn: 240, lengthIn: 168, ceilingIn: 108, outline: L, extra: [{ id: 'pantry', name: 'Pantry', outline: PANTRY }] },
  surfaces: {},
  items: [
    { id: 'c1', productId: 'base', x: 12, y: 12, rotation: 0, finishIndex: 0 },
    { id: 'c2', productId: 'base', x: 36, y: 12, rotation: 0, finishIndex: 0 },
    // against the inner wall of the L (an east-facing wall at x = 144)
    { id: 'c3', productId: 'base', x: 132, y: 130, rotation: 90, finishIndex: 0 },
    { id: 'd1', productId: 'opening', x: 240, y: 48, rotation: 90, finishIndex: 0 },
    { id: 'w1', productId: 'window', x: 100, y: 168, rotation: 180, finishIndex: 0 },
  ],
  version: 2,
});

async function viewTab({ evaluate, click }, label) {
  const ok = await evaluate((l) => {
    const b = [...document.querySelectorAll('.views [role="tab"]')].find((x) => x.textContent.trim() === l);
    if (b) b.setAttribute('data-qa-tab', l);
    return !!b;
  }, label);
  if (!ok) throw new Error(`no "${label}" view tab`);
  await click(`[data-qa-tab="${label}"]`);
}

export default [
  {
    name: 'drawn-room-views',
    as: 'studio',
    viewport: DESK,
    setup: async ({ me }) => {
      const r = await me.post('/api/projects', { name: 'QA Drawn Room', doc: doc() });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status} ${JSON.stringify(r.body)})`);
      const back = r.body.project.doc.room;
      if (!back.outline || back.outline.length !== 6 || back.extra?.length !== 1) throw new Error(`the server dropped the drawn walls: ${JSON.stringify(back)}`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await viewTab(h, '3D');
      await h.waitFor('canvas');
      await h.sleep(800);
      await viewTab(h, 'Walls');
      await h.waitForText('North 20');
      const tabs = await h.evaluate(() => [...document.querySelectorAll('.elev-bar [role="tab"]')].map((b) => b.textContent.trim()));
      // 6 walls in the L and 4 in the pantry.
      if (tabs.length !== 10) throw new Error(`expected 10 wall elevations, got ${tabs.length}: ${tabs.join(' | ')}`);
      h.note(`${tabs.length} wall elevations`);
    },
  },
  {
    name: 'drawn-room-walls-dialog',
    as: 'studio',
    viewport: DESK,
    setup: async ({ me }) => {
      const r = await me.post('/api/projects', { name: 'QA Drawn Room 2', doc: doc() });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status})`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.left-panel'],
    check: async (h) => {
      await h.evaluate(() => [...document.querySelectorAll('.left-panel [role="tab"]')].find((b) => /Room/.test(b.textContent))?.click());
      await h.waitForText('Walls & rooms');
      await h.click('[data-testid="edit-walls"]');
      await h.waitFor('.sk-canvas');
      const n = await h.evaluate(() => document.querySelectorAll('.sk-canvas .sk-wall').length);
      if (n !== 10) throw new Error(`the sketch shows ${n} walls, expected 10`);
      const names = await h.evaluate(() => [...document.querySelectorAll('.sk-rooms input')].map((i) => i.value));
      if (names.join() !== 'Pantry') throw new Error(`rooms listed: ${names.join(', ')}`);
      await h.shot('walls-dialog');
    },
  },
  {
    name: 'open-plan-kitchen',
    as: 'studio',
    viewport: DESK,
    setup: async ({ me }) => {
      // A 26' x 16' open room; the kitchen is marked in its north-west corner: a bar wall on its south edge,
      // a half wall on its east edge, the other two edges open (they sit on the room's own walls).
      const kitchen = [[0, 0], [168, 0], [168, 132], [0, 132]];
      const d = {
        name: 'QA Open Plan',
        room: {
          widthIn: 312,
          lengthIn: 192,
          ceilingIn: 108,
          extra: [{ id: 'kitchen', name: 'Kitchen', kind: 'zone', outline: kitchen, styles: ['wall', 'half', 'bar', 'wall'] }],
        },
        surfaces: {},
        items: [
          { id: 'c1', productId: 'base', x: 12, y: 12, rotation: 0, finishIndex: 0 },
          { id: 'c2', productId: 'base', x: 36, y: 12, rotation: 0, finishIndex: 0 },
          { id: 'c3', productId: 'base', x: 156, y: 40, rotation: 90, finishIndex: 0 },
          { id: 'w1', productId: 'window', x: 100, y: 0, rotation: 0, finishIndex: 0 },
          { id: 'st1', productId: 'stool', x: 60, y: 146, rotation: 0, finishIndex: 0 },
        ],
        version: 2,
      };
      const r = await me.post('/api/projects', { name: 'QA Open Plan', doc: d });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status} ${JSON.stringify(r.body)})`);
      const back = r.body.project.doc.room.extra?.[0];
      if (back?.kind !== 'zone' || back.styles?.join() !== 'wall,half,bar,wall') throw new Error(`the server changed the open area: ${JSON.stringify(back)}`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await h.sleep(500);
      await h.shot('plan');
      await viewTab(h, '3D');
      await h.waitFor('canvas');
      await h.sleep(1200);
      await h.shot('3d');
    },
  },
  {
    name: 'add-room-by-kind',
    as: 'studio',
    viewport: DESK,
    setup: async ({ me }) => {
      const d = { name: 'QA Add Room', room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 }, surfaces: {}, items: [], version: 2 };
      const r = await me.post('/api/projects', { name: 'QA Add Room', doc: d });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status})`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await h.click('[data-testid="add-room"]');
      await h.click('[data-testid="add-room-living"]');
      await h.waitForText('Living room added');
      await h.click('[data-testid="add-room"]');
      await h.click('[data-testid="add-room-bath"]');
      await h.sleep(600);
      await h.shot('rooms-added');
      await viewTab(h, '3D');
      await h.waitFor('canvas');
      await h.sleep(1200);
      await h.shot('rooms-3d');
      await h.evaluate(() => [...document.querySelectorAll('.left-panel [role="tab"]')].find((b) => /Room/.test(b.textContent))?.click());
      await h.waitForText('Walls & rooms');
      await h.click('[data-testid="edit-walls"]');
      await h.waitFor('.sk-canvas');
      const names = await h.evaluate(() => [...document.querySelectorAll('.sk-rooms input')].map((i) => i.value));
      if (names.join() !== 'Living room,Bathroom') throw new Error(`rooms listed: ${names.join(', ')}`);
    },
  },
  {
    name: 'bathroom-pieces',
    as: 'studio',
    viewport: DESK,
    setup: async ({ me }) => {
      // A 10' x 9' ensuite: double vanity and mirror on the north wall, toilet on the west, tub across the south, corner shower.
      const d = {
        name: 'QA Ensuite',
        room: { widthIn: 120, lengthIn: 108, ceilingIn: 96 },
        surfaces: {},
        items: [
          { id: 'v', productId: 'vanity-double', x: 44, y: 10.5, rotation: 0, finishIndex: 0 },
          { id: 'm', productId: 'mirror', x: 44, y: 0.75, rotation: 0, finishIndex: 0, widthIn: 48 },
          { id: 't', productId: 'toilet', x: 14.5, y: 50, rotation: 270, finishIndex: 0 },
          { id: 'b', productId: 'tub', x: 60, y: 93, rotation: 180, finishIndex: 0 },
          { id: 'door', productId: 'door', x: 120, y: 40, rotation: 90, finishIndex: 0 },
          { id: 's', productId: 'shower-corner', x: 102, y: 18, rotation: 0, finishIndex: 0 },
        ],
        version: 2,
      };
      const r = await me.post('/api/projects', { name: 'QA Ensuite', doc: d });
      if (r.status !== 201) throw new Error(`creating the bathroom failed (${r.status} ${JSON.stringify(r.body)})`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await h.sleep(500);
      await viewTab(h, 'Plan');
      await h.sleep(500);
      await h.shot('plan');
      await viewTab(h, '3D');
      await h.waitFor('canvas');
      await h.sleep(1500);
      await h.shot('3d');
      await viewTab(h, 'Walls');
      await h.sleep(500);
      await h.shot('walls');
      const problems = await h.evaluate(() => document.querySelector('.right-panel, .rp')?.textContent ?? document.body.textContent);
      if (/problem/i.test(problems) && !/passes every/i.test(problems)) h.note('the sample bathroom reports problems; see the Checks tab in the shot');
    },
  },
  {
    name: 'sketch-phone',
    path: '#/new',
    as: 'fresh',
    viewport: 'phone',
    waitFor: '.wizard',
    check: async (h) => {
      await h.click('.wizard-nav .btn.primary');
      await h.waitForText('Draw the room.');
      await h.sleep(300);
      const r = await h.evaluate(() => {
        const c = document.querySelector('.sk-canvas').getBoundingClientRect();
        const tools = [...document.querySelectorAll('.sk-tool')].map((b) => b.getBoundingClientRect());
        return { cw: Math.round(c.width), ch: Math.round(c.height), vw: window.innerWidth, sw: document.documentElement.scrollWidth, small: tools.filter((t) => t.height < 44).length };
      });
      if (r.sw > r.vw + 1) throw new Error(`the page scrolls sideways (${r.sw}px in ${r.vw}px)`);
      if (r.cw < r.vw - 40) throw new Error(`the sketch is only ${r.cw}px wide on a ${r.vw}px phone`);
      if (r.small) throw new Error(`${r.small} sketch buttons are under 44px tall on a touch screen`);
      await h.shot('room-step');
    },
  },
  {
    name: 'bathroom-wizard-layouts',
    host: 'demo',
    path: '#/new?room=bathroom',
    as: 'showroom-visitor',
    viewport: DESK,
    waitFor: '.wizard',
    check: async (h) => {
      await h.click('.wizard-nav .btn.primary');
      await h.waitForText('Draw the room.');
      await h.click('.wizard-nav .btn.primary');
      await h.waitForText('Pick a starting layout.');
      const picks = await h.evaluate(() => [...document.querySelectorAll('.layout-pick')].map((b) => `${b.querySelector('b').textContent}${b.disabled ? ' (off)' : ''}`));
      if (!picks.some((p) => p.startsWith('Tub, toilet and vanity') && !p.includes('(off)'))) throw new Error(`layouts: ${picks.join(', ')}`);
      h.note(picks.join(', '));
      await h.shot('layouts');
    },
  },
  {
    name: 'drag-wall-on-plan',
    as: 'studio',
    viewport: DESK,
    setup: async ({ me }) => {
      const d = { name: 'QA Drag Wall', room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 }, surfaces: {}, items: [{ id: 'e1', productId: 'base', x: 188, y: 60, rotation: 90, finishIndex: 0 }], version: 2 };
      const r = await me.post('/api/projects', { name: 'QA Drag Wall', doc: d });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status})`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await viewTab(h, 'Plan');
      await h.sleep(600);
      // Press on the east wall's line (x = 200) away from the cabinet, drag 24 inches east.
      const a = await h.evaluate(() => window.__blumodelQA.plan.toClient(200, 130));
      const b = await h.evaluate(() => window.__blumodelQA.plan.toClient(224, 130));
      await h.mouseDrag(a, b, { steps: 14 });
      await h.sleep(400);
      const r = await h.evaluate(() => window.__blumodelQA.store?.getState?.().doc ?? null);
      const doc = r ?? (await h.evaluate(() => JSON.parse(localStorage.getItem('blumodel-design') ?? 'null')?.state?.doc ?? null));
      if (!doc) throw new Error('could not read the design');
      if (doc.room.widthIn !== 224) throw new Error(`the room is ${doc.room.widthIn} wide after dragging the east wall 24in (expected 224)`);
      const cab = doc.items.find((i) => i.id === 'e1');
      if (cab.x !== 212) throw new Error(`the cabinet against the east wall is at x=${cab.x} (expected 212: it moves with the wall)`);
      await h.shot('after');
    },
  },
  {
    name: 'crown-moulding',
    as: 'studio',
    viewport: DESK,
    setup: async ({ me }) => {
      const items = [0, 1, 2, 3].map((i) => ({ id: `b${i}`, productId: 'base', x: 15 + i * 30, y: 12, rotation: 0, finishIndex: 0, widthIn: 30 }))
        .concat([0, 1, 2, 3].map((i) => ({ id: `u${i}`, productId: 'wall', x: 15 + i * 30, y: 6, rotation: 0, finishIndex: 0 })))
        .concat([{ id: 'p', productId: 'pantry', x: 132, y: 12, rotation: 0, finishIndex: 0 }]);
      const d = { name: 'QA Crown', room: { widthIn: 168, lengthIn: 144, ceilingIn: 96 }, surfaces: { crown: 'cove' }, items, version: 2 };
      const r = await me.post('/api/projects', { name: 'QA Crown', doc: d });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status} ${JSON.stringify(r.body)})`);
      if (r.body.project.doc.surfaces.crown !== 'cove') throw new Error('the server dropped the crown');
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await viewTab(h, '3D');
      await h.waitFor('canvas');
      await h.sleep(1500);
      await h.shot('3d');
    },
  },
  {
    name: 'pot-lights',
    as: 'studio',
    viewport: DESK,
    setup: async ({ me }) => {
      const d = { name: 'QA Pot Lights', room: { widthIn: 168, lengthIn: 144, ceilingIn: 108 }, surfaces: {}, items: [{ id: 'b0', productId: 'base', x: 15, y: 12, rotation: 0, finishIndex: 0, widthIn: 30 }], version: 2 };
      const r = await me.post('/api/projects', { name: 'QA Pot Lights', doc: d });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status})`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.left-panel'],
    check: async (h) => {
      await h.evaluate(() => [...document.querySelectorAll('.left-panel [role="tab"]')].find((b) => /Room/.test(b.textContent))?.click());
      await h.waitForText('Lay out pot lights');
      await h.sleep(300);
      await h.click('[data-testid="pot-lights"]');
      await h.waitForText('pot lights laid out');
      const n = await h.evaluate(() => window.__blumodelQA.store.getState().doc.items.filter((i) => i.productId === 'pot-light').length);
      if (n < 6) throw new Error(`only ${n} pot lights in a 14' x 12' kitchen`);
      h.note(`${n} pot lights`);
      await viewTab(h, 'Plan');
      await h.sleep(500);
      await h.shot('plan');
    },
  },
];
