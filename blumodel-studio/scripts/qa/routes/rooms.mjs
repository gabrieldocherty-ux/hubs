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
    // The plan's HUD on a phone: every control on screen, big enough to tap, none on top of another,
    // and the Add a room menu inside the screen and usable.
    name: 'plan-hud-phone',
    as: 'studio',
    viewport: 'phone',
    setup: async ({ me }) => {
      const d = { name: 'QA HUD', room: { widthIn: 168, lengthIn: 144, ceilingIn: 96 }, surfaces: {}, items: [{ id: 'b0', productId: 'base', x: 15, y: 12, rotation: 0, finishIndex: 0, widthIn: 30 }], version: 2 };
      const r = await me.post('/api/projects', { name: 'QA HUD', doc: d });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status})`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar'],
    check: async (h) => {
      // Phones open on the 3D; the plan's HUD is on Plan.
      await h.evaluate(() => window.__blumodelQA.store.getState().setUI({ viewMode: 'plan' }));
      await h.waitFor('.plan-view canvas');
      await h.sleep(500);
      const r = await h.evaluate(() => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const boxes = [...document.querySelectorAll('.plan-view .plan-hud')]
          .filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0)
          .map((e) => ({ name: e.className, b: e.getBoundingClientRect() }));
        const off = boxes.filter(({ b }) => b.left < -1 || b.right > vw + 1 || b.bottom > vh + 1 || b.top < -1).map((x) => x.name);
        const hit = [];
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i].b;
            const c = boxes[j].b;
            if (Math.min(a.right, c.right) - Math.max(a.left, c.left) > 2 && Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top) > 2) hit.push(`${boxes[i].name} / ${boxes[j].name}`);
          }
        const small = [...document.querySelectorAll('.plan-view .plan-hud button, .plan-view .plan-hud label')]
          .map((e) => ({ t: (e.textContent || e.getAttribute('aria-label') || '').trim(), b: e.getBoundingClientRect() }))
          .filter((x) => x.b.width > 0 && Math.max(x.b.height, x.b.width) < 32)
          .map((x) => `${x.t} ${Math.round(x.b.width)}x${Math.round(x.b.height)}`);
        return { off, hit, small, sw: document.documentElement.scrollWidth, vw };
      });
      if (r.sw > r.vw + 1) throw new Error(`the page scrolls sideways (${r.sw} in ${r.vw})`);
      if (r.off.length) throw new Error(`HUD off screen: ${r.off.join(', ')}`);
      if (r.hit.length) throw new Error(`HUD pieces on top of each other: ${r.hit.join('; ')}`);
      if (r.small.length) throw new Error(`HUD controls too small to tap: ${r.small.join(', ')}`);
      await h.shot('plan');
      await h.click('[data-testid="add-room"]');
      await h.waitFor('.plan-menu-list');
      const m = await h.evaluate(() => {
        const b = document.querySelector('.plan-menu-list').getBoundingClientRect();
        return { l: b.left, r: b.right, t: b.top, bt: b.bottom, vw: window.innerWidth, vh: window.innerHeight, scroll: document.querySelector('.plan-menu-list').scrollHeight > document.querySelector('.plan-menu-list').clientHeight };
      });
      if (m.l < 0 || m.r > m.vw || m.t < 0) throw new Error(`the Add a room menu spills off screen: ${JSON.stringify(m)}`);
      if (m.bt > m.vh && !m.scroll) throw new Error(`the Add a room menu runs past the bottom and doesn't scroll: ${JSON.stringify(m)}`);
      await h.shot('menu');
      await h.click('[data-testid="add-room-dining"]');
      await h.waitUntil(() => window.__blumodelQA.store.getState().doc.room.extra?.length === 1, 4000, 'the dining room being added');
      await h.click('[data-testid="add-zone"]');
      await h.waitForText('Cancel');
      await h.shot('open-area');
    },
  },
  {
    // Catalog cards show the product's own 3D model in the kitchen's finishes once on screen.
    name: 'catalog-3d-thumbs',
    as: 'studio',
    viewport: DESK,
    setup: async ({ me }) => {
      const d = { name: 'QA Thumbs', room: { widthIn: 168, lengthIn: 144, ceilingIn: 96 }, surfaces: { cabinetFinishId: 'forest', doorStyle: 'shaker', hardwareId: 'brass' }, items: [], version: 2 };
      const r = await me.post('/api/projects', { name: 'QA Thumbs', doc: d });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status})`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.product-card'],
    check: async (h) => {
      await h.waitUntil(() => [...document.querySelectorAll('.product-card .product-3d > img[src^="data:"]')].filter((i) => i.complete && i.naturalWidth > 0).length >= 6, 20_000, 'six catalog cards drawn in 3D');
      await h.sleep(800);
      const r = await h.evaluate(() => {
        const imgs = [...document.querySelectorAll('.product-card .product-3d > img[src^="data:"]')];
        return { n: imgs.length, cards: document.querySelectorAll('.product-card').length, bad: imgs.filter((i) => i.complete && i.naturalWidth < 100).map((i) => `${i.closest('.product-card').dataset.product} ${i.naturalWidth}x${i.naturalHeight} ${i.src.slice(0, 40)}`).join('; '), src: imgs[0]?.src.slice(0, 15) };
      });
      if (r.bad) throw new Error(`3D card pictures that didn't load: ${r.bad}`);
      h.note(`${r.n} of ${r.cards} cards in 3D (${r.src}…)`);
      await h.shot('cards');
      // A new cabinet finish redraws them in it.
      await h.evaluate(() => {
        window.__qaThumbBefore = document.querySelector('.product-card .product-3d > img[src^="data:"]').src;
        window.__blumodelQA.store.getState().setSurfaces({ cabinetFinishId: 'navy' });
      });
      await h.waitUntil(() => {
        const src = document.querySelector('.product-card .product-3d > img[src^="data:"]')?.src;
        return !!src && src !== window.__qaThumbBefore;
      }, 15_000, 'the cards redrawn in the new finish');
      await h.sleep(600);
      await h.shot('navy');
      // The branded appliances.
      await h.evaluate(() => [...document.querySelectorAll('.catalog-panel button, .chip')].find((b) => b.textContent.trim() === 'Appliances')?.click());
      await h.waitUntil(() => [...document.querySelectorAll('.product-card .product-3d > img[src^="data:"]')].filter((i) => i.complete && i.naturalWidth > 0).length >= 6, 20_000, 'appliance cards drawn in 3D');
      await h.sleep(1500);
      await h.shot('appliances');
    },
  },
  {
    // A floor per room: an added bathroom starts on tile, the picker sets each room's floor, 3D shows both.
    name: 'floor-per-room',
    as: 'studio',
    viewport: DESK,
    setup: async ({ me }) => {
      const items = [0, 1, 2].map((i) => ({ id: `b${i}`, productId: 'base', x: 15 + i * 30, y: 12, rotation: 0, finishIndex: 0, widthIn: 30 }));
      const d = { name: 'QA Floors per room', room: { widthIn: 168, lengthIn: 144, ceilingIn: 96 }, surfaces: { flooringId: 'oak-natural' }, items, version: 2 };
      const r = await me.post('/api/projects', { name: 'QA Floors per room', doc: d });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status})`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await h.click('[data-testid="add-room"]');
      await h.click('[data-testid="add-room-bath"]');
      await h.waitUntil(() => window.__blumodelQA.store.getState().doc.room.extra?.[0]?.flooringId === 'porcelain-12x24', 4000, 'the bathroom starting on tile');
      await h.evaluate(() => [...document.querySelectorAll('.left-panel [role="tab"]')].find((b) => /Room/.test(b.textContent))?.click());
      await h.waitFor('[data-testid="floor-for"]');
      const opts = await h.evaluate(() => [...document.querySelectorAll('[data-testid="floor-for"] option')].map((o) => o.textContent));
      if (opts.length !== 2 || !/kitchen/.test(opts[0]) || !/Bathroom/.test(opts[1])) throw new Error(`Floor for: ${opts.join(' | ')}`);
      // Pick the bathroom, then a hex floor for it, through the UI.
      await h.evaluate(() => {
        const sel = document.querySelector('[data-testid="floor-for"]');
        const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        set.call(sel, sel.options[1].value);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await h.waitForText('Same as the kitchen');
      await h.evaluate(() => [...document.querySelectorAll('.tex-groups .chip')].find((b) => b.firstChild.textContent.trim() === 'Tile').click());
      await h.click('.tex[aria-label="Hexagon 8in, Cement Blue Mix"]');
      await h.waitUntil(() => window.__blumodelQA.store.getState().doc.room.extra[0].flooringId === 'hex-encaustic', 4000, 'the bathroom floor set');
      if (await h.evaluate(() => window.__blumodelQA.store.getState().doc.surfaces.flooringId) !== 'oak-natural') throw new Error('setting the bathroom floor changed the kitchen floor');
      const est = await h.evaluate(() => window.__blumodelQA.store.getState().doc.room.extra.length);
      h.note(`rooms: ${est + 1}`);
      await h.shot('plan');
      await viewTab(h, '3D');
      await h.waitFor('canvas');
      await h.sleep(1500);
      await h.shot('3d');
    },
  },
  {
    // Feature walls: tile floor to ceiling on the north wall (around its window), olive wainscoting on the west.
    name: 'feature-walls',
    as: 'studio',
    viewport: DESK,
    setup: async ({ me }) => {
      const items = [0, 1, 2].map((i) => ({ id: `b${i}`, productId: 'base', x: 15 + i * 30, y: 12, rotation: 0, finishIndex: 0, widthIn: 30 }))
        .concat([{ id: 'w1', productId: 'window', x: 130, y: 0, rotation: 0, finishIndex: 0 }]);
      const d = { name: 'QA Feature walls', room: { widthIn: 168, lengthIn: 144, ceilingIn: 96 }, surfaces: { flooringId: 'oak-natural', paintId: 'chalk' }, items, version: 2 };
      const r = await me.post('/api/projects', { name: 'QA Feature walls', doc: d });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status})`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.left-panel'],
    check: async (h) => {
      await h.evaluate(() => [...document.querySelectorAll('.left-panel [role="tab"]')].find((b) => /Room/.test(b.textContent))?.click());
      await h.waitFor('[data-testid="feature-wall"]');
      const pick = async (re) =>
        h.evaluate((src) => {
          const sel = document.querySelector('[data-testid="feature-wall"]');
          const opt = [...sel.options].find((o) => new RegExp(src).test(o.textContent));
          const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          set.call(sel, opt.value);
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return opt.value;
        }, re);
      const north = await pick('north wall');
      await h.click('[data-testid="panel-tile"]');
      await h.waitUntil(() => Object.values(window.__blumodelQA.store.getState().doc.room.wallFinishes ?? {}).some((f) => f.panel === 'tile'), 4000, 'the north wall tiled');
      const west = await pick('west wall');
      await h.click('[data-testid="panel-wainscot"]');
      await h.click('.feature-walls .swatch[aria-label="Olive Grove"]');
      const wf = await h.evaluate(() => window.__blumodelQA.store.getState().doc.room.wallFinishes);
      if (wf[north]?.panel !== 'tile' || wf[north]?.tileId !== 'subway-white') throw new Error(`north: ${JSON.stringify(wf[north])}`);
      if (wf[west]?.panel !== 'wainscot' || wf[west]?.paintId !== 'olive') throw new Error(`west: ${JSON.stringify(wf[west])}`);
      await h.shot('panel');
      await viewTab(h, '3D');
      await h.waitFor('canvas');
      await h.sleep(1800);
      await h.shot('3d');
      // The wall elevations draw them: tile to the ceiling on the north wall, framed wainscoting on the west.
      await viewTab(h, 'Walls');
      await h.waitFor('.elev-bar');
      for (const w of ['North', 'West']) {
        await h.evaluate((name) => [...document.querySelectorAll('[role="tab"]')].find((b) => b.closest('.elev-bar') && b.textContent.trim().startsWith(name))?.click(), w);
        await h.sleep(300);
        const txt = await h.evaluate(() => document.querySelector('svg[aria-label$="elevation"]')?.textContent ?? '');
        if (w === 'North' && !/TO THE CEILING/.test(txt)) throw new Error(`north elevation: ${txt.slice(0, 120)}`);
        if (w === 'West' && !/WAINSCOTING/.test(txt)) throw new Error(`west elevation: ${txt.slice(0, 120)}`);
        await h.shot(`elev-${w.toLowerCase()}`);
      }
      // Undo takes the last change back.
      await h.evaluate(() => window.__blumodelQA.store.getState().undo());
      const after = await h.evaluate(() => window.__blumodelQA.store.getState().doc.room.wallFinishes);
      if (after[west]?.paintId) throw new Error('undo didn’t take the olive back');
    },
  },
  {
    // Outlets and switches: the plan's electrical symbols, the 3D plates, and the code checks.
    name: 'electrical',
    as: 'studio',
    viewport: DESK,
    setup: async ({ me }) => {
      const items = [0, 1, 2, 3].map((i) => ({ id: `b${i}`, productId: 'base', x: 15 + i * 30, y: 12, rotation: 0, finishIndex: 0, widthIn: 30 }))
        .concat([
          { id: 'sk', productId: 'sink-farm', x: 138, y: 12, rotation: 0, finishIndex: 0 },
          { id: 'o1', productId: 'outlet-counter', x: 20, y: 0.25, rotation: 0, finishIndex: 0 },
          { id: 'o2', productId: 'outlet-counter', x: 112, y: 0.25, rotation: 0, finishIndex: 0 },
          { id: 'sw', productId: 'dimmer-switch', x: 200, y: 0.25, rotation: 0, finishIndex: 0 },
        ]);
      const d = { name: 'QA Electrical', room: { widthIn: 240, lengthIn: 144, ceilingIn: 96 }, surfaces: { flooringId: 'oak-natural' }, items, version: 2 };
      const r = await me.post('/api/projects', { name: 'QA Electrical', doc: d });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status} ${JSON.stringify(r.body)})`);
      if (r.body.project.doc.items.length !== items.length) throw new Error('the server dropped the outlets');
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      // The Overview's scope of work lists the electrician's work for these devices.
      await h.evaluate(() => window.__blumodelQA.store.getState().setUI({ rightTab: 'details' }));
      await h.waitFor('[data-testid="scope-card"]');
      await h.evaluate(() => (document.querySelector('[data-testid="scope-card"]').open = true));
      await h.waitForText(['Scope of work', 'Electrical', 'GFCI', 'Light switches (1 dimmer)']);
      await h.shot('scope');
      // o2 sits 5′ from the sink and isn't a GFCI; the run between the outlets is fine.
      await h.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim().startsWith('Checks'))?.click());
      await h.waitUntil(() => document.body.innerText.includes('Use a GFCI outlet near the sink'), 6000, 'the GFCI check');
      await h.shot('plan');
      await viewTab(h, '3D');
      await h.waitFor('canvas');
      await h.evaluate(() => window.__blumodelQA.store.getState().select('o1'));
      await h.sleep(1500);
      await h.shot('3d');
    },
  },
  {
    // An empty room on a phone: the plan is clear, with only a quiet hint at the bottom (no layout picker over it).
    name: 'empty-room-phone',
    as: 'studio',
    viewport: 'phone',
    setup: async ({ me }) => {
      const d = { name: 'QA Empty', room: { widthIn: 212, lengthIn: 156, ceilingIn: 96 }, surfaces: {}, items: [], version: 2 };
      const r = await me.post('/api/projects', { name: 'QA Empty', doc: d });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status})`);
      return { path: `#/k/${r.body.project.id}` };
    },
    // Phones open on the 3D: the hint shows there too.
    waitFor: ['.topbar', '.scene-view canvas', '.plan-empty-hint'],
    check: async (h) => {
      const r = await h.evaluate(() => {
        const hint = document.querySelector('.plan-empty-hint');
        const b = hint.getBoundingClientRect();
        return { buttons: hint.querySelectorAll('button').length, text: hint.innerText.trim(), pe: getComputedStyle(hint).pointerEvents, h: Math.round(b.height), bottom: Math.round(b.bottom), vh: innerHeight };
      });
      if (r.buttons) throw new Error('the hint has buttons');
      if (r.pe !== 'none') throw new Error('the hint catches taps meant for the plan');
      if (!/Tap Add/.test(r.text)) throw new Error(`a phone should get the tap hint: ${r.text}`);
      if (r.h > 90) throw new Error(`the hint is ${r.h}px tall`);
      h.note(r.text);
      await h.shot('plan');
    },
  },
  {
    // The Item sheet on a phone: the selected piece in 3D, in its own finish, inside its picture box
    // (not a flat drawing spilling over the name and price).
    name: 'item-sheet-phone',
    as: 'studio',
    viewport: 'phone',
    setup: async ({ me }) => {
      const d = { name: 'QA Item', room: { widthIn: 168, lengthIn: 144, ceilingIn: 96 }, surfaces: {}, items: [{ id: 'w0', productId: 'wall', x: 30, y: 6, rotation: 0, finishIndex: 2, widthIn: 36 }, { id: 'b0', productId: 'base', x: 30, y: 12, rotation: 0, finishIndex: 0, widthIn: 36 }], version: 2 };
      const r = await me.post('/api/projects', { name: 'QA Item', doc: d });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status})`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.scene-view canvas'],
    check: async (h) => {
      await h.evaluate(() => window.__blumodelQA.store.getState().select('w0'));
      await h.evaluate(() => [...document.querySelectorAll('.mbar button')].find((b) => /Item|Details/.test(b.textContent))?.click());
      await h.waitUntil(() => !!document.querySelector('.insp-hero .product-3d img[src^="data:"]'), 15_000, 'the Item sheet’s 3D picture');
      await h.sleep(500);
      const r = await h.evaluate(() => {
        const hero = document.querySelector('.insp-hero').getBoundingClientRect();
        const img = document.querySelector('.insp-hero img').getBoundingClientRect();
        const name = document.querySelector('.insp-head h3').getBoundingClientRect();
        return { hero: [Math.round(hero.top), Math.round(hero.bottom)], img: [Math.round(img.top), Math.round(img.bottom)], nameTop: Math.round(name.top) };
      });
      if (r.img[0] < r.hero[0] - 1 || r.img[1] > r.hero[1] + 1) throw new Error(`the picture spills out of its box: ${JSON.stringify(r)}`);
      if (r.nameTop < r.hero[1]) throw new Error(`the name sits under the picture: ${JSON.stringify(r)}`);
      await h.shot('item');
    },
  },
  {
    name: 'flooring-picker',
    as: 'studio',
    viewport: DESK,
    setup: async ({ me }) => {
      const items = [0, 1, 2].map((i) => ({ id: `b${i}`, productId: 'base', x: 15 + i * 30, y: 12, rotation: 0, finishIndex: 0, widthIn: 30 }));
      const d = { name: 'QA Floors', room: { widthIn: 168, lengthIn: 144, ceilingIn: 96 }, surfaces: { flooringId: 'oak-natural' }, items, version: 2 };
      const r = await me.post('/api/projects', { name: 'QA Floors', doc: d });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status})`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.left-panel'],
    check: async (h) => {
      await h.evaluate(() => [...document.querySelectorAll('.left-panel [role="tab"]')].find((b) => /Room/.test(b.textContent))?.click());
      await h.waitFor('.tex-groups');
      const groups = await h.evaluate(() => [...document.querySelectorAll('.tex-groups .chip')].map((b) => b.firstChild.textContent.trim()));
      if (groups.join('|') !== 'Hardwood|Vinyl & laminate|Tile|Stone|Concrete') throw new Error(`flooring groups: ${groups.join(', ')}`);
      const on = await h.evaluate(() => document.querySelector('.tex-groups .chip.on')?.firstChild.textContent.trim());
      if (on !== 'Hardwood') throw new Error(`the chips opened on ${on}, not the current floor's group`);
      await h.shot('hardwood');
      // Every floor in every group draws (no blank swatch), then each new pattern in 3D.
      for (const g of groups) {
        await h.evaluate((name) => [...document.querySelectorAll('.tex-groups .chip')].find((b) => b.firstChild.textContent.trim() === name).click(), g);
        await h.sleep(150);
        const blank = await h.evaluate(() => [...document.querySelectorAll('.tex-groups + .tex-grid .tex')].filter((b) => !/url\(/.test(b.style.backgroundImage)).map((b) => b.getAttribute('aria-label')));
        if (blank.length) throw new Error(`no swatch for ${blank.join(', ')}`);
      }
      await viewTab(h, '3D');
      await h.waitFor('canvas');
      // A new floor is laid over the old one, row by row: half way through, both show.
      await h.sleep(800);
      await h.evaluate(() => window.__blumodelQA.store.getState().setSurfaces({ flooringId: 'walnut-plank' }));
      await h.sleep(450);
      await h.shot('laying');
      await h.sleep(1200);
      for (const id of ['chevron-oak', 'hex-encaustic', 'penny-white', 'wood-look-tile', 'porcelain-12x24', 'travertine']) {
        await h.evaluate((fid) => window.__blumodelQA.store.getState().setSurfaces({ flooringId: fid }), id);
        await h.sleep(900);
        await h.shot(id);
      }
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
