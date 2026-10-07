// Viewer QA routes (BUILD_PLAN A-T10, §13.3 A): the product page for a built-in and a seeded GLB
// product (finish round trip, dimensions, phone layout), a GLB placed in a kitchen at its declared
// size, the procedural fallback for a broken model, the idle and pendant performance checks, the
// studio render at 4K from split and 3D view (watermarked for a free user, clean for an entitled
// one) and the tone-mapping A/B stills.
//
// Run: node scripts/qa.mjs --pkg viewer --port 8812 --dist <dist>
//      and once more with --swiftshader --only viewer/product-builtin (the software-GL pass).
//
// The GLB products come from server/seed/viewer.mjs: "Ashgrove 30″ Pro Range (Demo)" and
// "Ashgrove Dome Pendant (Demo)", brand slug ashgrove-studio-demo. The debug hooks used here exist
// only with ?qa in the URL: window.__miseQa (canvas stats, viewer.renderStill, stage, studio) and
// window.__miseQA (the design store, scene3d).

const GLB_BRAND = 'ashgrove-studio-demo';

/** A seeded GLB product of the viewer demo brand, as /api/catalog lists it. */
async function demoGlb(api, kind) {
  const r = await api.get('/api/catalog');
  const p = (r.body?.products ?? []).find((x) => x.brandSlug === GLB_BRAND && x.kind === kind);
  if (!p) throw new Error(`the viewer demo ${kind} (brand ${GLB_BRAND}) is not in /api/catalog: did server/seed/viewer.mjs run?`);
  return p;
}

/** A one-wall kitchen with an island, built from built-in products. */
function kitchenDoc(name) {
  const n = (id, productId, x, y, extra = {}) => ({ id, productId, x, y, rotation: 0, finishIndex: 0, ...extra });
  return {
    name,
    room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
    surfaces: { cabinetFinishId: 'white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'marble', backsplashId: 'subway', flooringId: 'oak', paintId: 'white' },
    items: [
      n('qa-fridge', 'fridge-36', 18, 15),
      n('qa-base-1', 'base', 48, 12),
      n('qa-sink', 'sink-farm', 78, 12),
      n('qa-dw', 'dishwasher', 108, 12),
      n('qa-base-2', 'base', 132, 12),
      n('qa-base-3', 'base', 186, 12),
      n('qa-island', 'island', 100, 93),
    ],
  };
}

async function newKitchen(me, name, query = '') {
  const r = await me.post('/api/projects', { name, doc: kitchenDoc(name) });
  if (r.status !== 201) throw new Error(`creating "${name}" failed (${r.status}): ${r.body?.error ?? r.text}`);
  return { path: `#/k/${r.body.project.id}${query}`, projectId: r.body.project.id };
}

async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

/** Polls an in-page predicate that takes one argument (waitUntil's fn takes none). */
async function until(h, fn, arg, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await h.evaluate(fn, arg)) return;
    await h.sleep(200);
  }
  throw new Error(`${what} never became true (${ms} ms)`);
}

/** The W / D / H values on the product page match the product (checked through the cm line). */
async function dimsMatch({ evaluate }, want) {
  const got = await evaluate(() => [...document.querySelectorAll('.pp-dims > div')].map((d) => ({ k: d.querySelector('dt')?.textContent.trim(), v: d.querySelector('dd')?.textContent ?? '' })));
  const problems = [];
  for (const [k, inches] of Object.entries(want)) {
    const row = got.find((g) => g.k === k);
    const cm = (inches * 2.54).toFixed(1);
    if (!row) problems.push(`no ${k} row`);
    else if (!row.v.includes(cm)) problems.push(`${k} shows "${row.v}", expected ${inches}″ (${cm} cm)`);
  }
  if (problems.length) throw new Error(problems.join('; '));
}

/** Switches the editor to the 3D view and waits for the room canvas to have drawn. */
async function show3d(h) {
  await h.evaluate(() => {
    const s = window.__miseQA.store.getState();
    s.select(null);
    s.setUI({ viewMode: '3d' });
  });
  await h.waitUntil(() => window.__miseQa?.canvas === 'room' && (window.__miseQa?.frames ?? 0) > 2 && !!window.__miseQa?.viewer?.renderStill, 20_000, 'the room canvas drawing');
}

/**
 * The placed item's size in its own frame (inches: x = width, y = height, z = depth) and whether
 * it is the loaded GLB (a group tagged userData.gltf) rather than the procedural stand-in.
 * Runs in the page.
 */
function itemBoxInPage(itemId) {
  const st = window.__miseQA.scene3d.get();
  let g = null;
  st.scene.traverse((o) => {
    if (!g && o.userData?.itemId === itemId) g = o;
  });
  if (!g) return null;
  let gltf = false;
  g.traverse((o) => {
    if (o.userData?.gltf) gltf = true;
  });
  g.updateWorldMatrix(true, true);
  const inv = g.matrixWorld.clone().invert();
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let meshes = 0;
  g.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.visible) return;
    meshes++;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], bb.min.getComponent(k));
      max[k] = Math.max(max[k], bb.max.getComponent(k));
    }
  });
  return { gltf, meshes, size: max.map((v, k) => +(v - min[k]).toFixed(3)) };
}

/** A fitted size against the declared box: never over it, touching it on the binding axis (1%). */
function fitError(size, want) {
  const ratios = size.map((v, k) => v / want[k]);
  if (ratios.some((r) => r > 1.01)) return `exceeds its declared size: ${size.map((v) => v.toFixed(2)).join(' × ')} in vs ${want.join(' × ')}`;
  if (Math.max(...ratios) < 0.99) return `reaches its declared size on no axis: ${size.map((v) => v.toFixed(2)).join(' × ')} in vs ${want.join(' × ')}`;
  return null;
}

export default [
  // ── Product page ─────────────────────────────────────────────────────────
  {
    name: 'product-builtin',
    path: '#/p/range-30',
    as: 'anon',
    waitFor: ['.product-stage[data-ready="1"] canvas', '.pp-dims'],
    expectText: ['Gas Range 30″', 'Add to a kitchen', 'Request a custom version'],
    check: async (h) => {
      await dimsMatch(h, { W: 30, D: 28, H: 36 });
      // The turntable spins, so frames are expected; the stage must have drawn something.
      const stats = await h.evaluate(() => ({ canvas: window.__miseQa?.canvas, frames: window.__miseQa?.frames ?? 0, calls: window.__miseQa?.calls ?? 0 }));
      if (stats.canvas !== 'stage' || stats.calls < 1) throw new Error(`the product stage did not draw (${JSON.stringify(stats)})`);
      await noSideScroll(h);
    },
  },
  {
    name: 'product-glb',
    as: 'anon',
    setup: async ({ api }) => {
      const p = await demoGlb(api, 'range');
      return { path: `#/p/${p.id}`, product: { id: p.id, w: p.widthIn, d: p.depthIn, h: p.heightIn } };
    },
    waitFor: ['.product-stage[data-ready="1"] canvas', '.pp-dims'],
    expectText: ['Ashgrove 30″ Pro Range (Demo)', 'Buy from'],
    check: async (h) => {
      const p = h.data.product;
      await dimsMatch(h, { W: p.w, D: p.d, H: p.h });
      // The GLB loaded (not the procedural stand-in) and fills its declared box (uniform fit).
      const fit = await h.evaluate(() => {
        let g = null;
        window.__miseQa.stage.get().scene.traverse((o) => {
          if (!g && o.userData?.gltf) g = o;
        });
        if (!g) return null;
        g.updateWorldMatrix(true, true);
        const min = [Infinity, Infinity, Infinity];
        const max = [-Infinity, -Infinity, -Infinity];
        g.traverse((o) => {
          if (!o.isMesh) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
          for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k], bb.min.getComponent(k));
            max[k] = Math.max(max[k], bb.max.getComponent(k));
          }
        });
        // The stage draws inches at 1/12 scale (feet).
        return max.map((v, k) => (v - min[k]) * 12);
      });
      if (!fit) throw new Error('the GLB did not load on the stage (no userData.gltf group): the procedural fallback is showing');
      const err = fitError(fit, [p.w, p.h, p.d]);
      if (err) throw new Error(`the stage model ${err}`);
      h.note(`stage GLB fitted ${fit.map((v) => v.toFixed(2)).join(' × ')} in (declared ${p.w} × ${p.h} × ${p.d})`);
    },
  },
  {
    name: 'product-glb-finish',
    as: 'anon',
    setup: async ({ api }) => {
      const p = await demoGlb(api, 'range');
      const fins = p.finishes ?? [];
      if (fins.length < 3) throw new Error(`the demo range has ${fins.length} finishes; the round trip needs 3`);
      return { path: `#/p/${p.id}?finish=${fins[2].id}`, finishes: fins.map((f) => ({ id: f.id, name: f.name, hex: f.hex })) };
    },
    waitFor: ['.product-stage[data-ready="1"] canvas', '.swatches .swatch.on'],
    check: async (h) => {
      const [, other, start] = h.data.finishes;
      // ?finish= selects the swatch and the model wears it (the mise_finish slot).
      const on = await h.evaluate(() => document.querySelector('.swatches .swatch.on')?.getAttribute('aria-label'));
      if (on !== start.name) throw new Error(`?finish=${start.id} selected "${on}", expected "${start.name}"`);
      const wears = (hex) =>
        h.evaluate((want) => {
          let hit = false;
          window.__miseQa.stage.get().scene.traverse((o) => {
            if (!o.isMesh) return;
            for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m?.color && '#' + m.color.getHexString() === want.toLowerCase()) hit = true;
          });
          return hit;
        }, hex);
      if (!(await wears(start.hex))) throw new Error(`no mesh on the stage wears ${start.name} (${start.hex})`);
      // Choosing another swatch updates the URL and the model.
      await h.evaluate((name) => {
        const b = [...document.querySelectorAll('.swatches .swatch')].find((x) => x.getAttribute('aria-label') === name);
        b?.setAttribute('data-qa-swatch', '1');
      }, other.name);
      await h.click('[data-qa-swatch="1"]');
      await until(h, (id) => location.hash.includes(`finish=${encodeURIComponent(id)}`), other.id, 5_000, `the hash carrying finish=${other.id}`);
      await h.sleep(600);
      if (!(await wears(other.hex))) throw new Error(`after choosing ${other.name} no mesh wears ${other.hex}`);
      // And the URL round-trips: a reload keeps the choice.
      await h.reload();
      await h.waitFor('.swatches .swatch.on');
      const after = await h.evaluate(() => document.querySelector('.swatches .swatch.on')?.getAttribute('aria-label'));
      if (after !== other.name) throw new Error(`after a reload the selected finish is "${after}", expected "${other.name}"`);
    },
  },
  {
    name: 'product-glb-phone',
    as: 'anon',
    viewport: 'phone',
    setup: async ({ api }) => ({ path: `#/p/${(await demoGlb(api, 'pendant')).id}` }),
    waitFor: ['.product-stage[data-ready="1"] canvas', '.pp-dims'],
    expectText: ['Ashgrove Dome Pendant (Demo)', 'Add to a kitchen'],
    check: async (h) => {
      await noSideScroll(h);
      // Stacked: the stage on top at full width, the details panel under it.
      const r = await h.evaluate(() => {
        const s = document.querySelector('.product-stage').getBoundingClientRect();
        const p = document.querySelector('.pp-panel').getBoundingClientRect();
        return { sw: s.width, sh: s.height, sBottom: s.bottom, pTop: p.top, vw: innerWidth };
      });
      if (r.sw < r.vw - 48) throw new Error(`the stage is ${Math.round(r.sw)}px wide on a ${r.vw}px phone`);
      if (r.sh < 220) throw new Error(`the stage is only ${Math.round(r.sh)}px tall`);
      if (r.pTop < r.sBottom - 1) throw new Error('the details panel overlaps the stage instead of stacking under it');
    },
  },
  {
    name: 'product-missing',
    path: '#/p/p_qa0000000000000000000000',
    as: 'anon',
    // The page asks for the product and gets a 404, which the browser logs.
    ignoreConsole: [/404/],
    waitFor: ['.pp-missing'],
  },

  // ── GLB in the room ──────────────────────────────────────────────────────
  {
    name: 'kitchen-glb-added',
    as: 'customer',
    setup: async ({ api, me }) => {
      const p = await demoGlb(api, 'range');
      const k = await newKitchen(me, 'QA Viewer GLB Kitchen', `?add=${p.id}`);
      return { ...k, product: { id: p.id, w: p.widthIn, d: p.depthIn, h: p.heightIn } };
    },
    waitFor: ['.topbar'],
    check: async (h) => {
      const p = h.data.product;
      await until(h, (id) => !!window.__miseQA?.store?.getState().doc.items.some((i) => i.productId === id), p.id, 20_000, 'the ?add= product in the kitchen');
      await show3d(h);
      const itemId = await h.evaluate((id) => window.__miseQA.store.getState().doc.items.find((i) => i.productId === id).id, p.id);
      let box = null;
      for (let i = 0; i < 60; i++) {
        box = await h.evaluate(itemBoxInPage, itemId);
        if (box?.gltf) break;
        await h.sleep(250);
      }
      if (!box) throw new Error('the added item is not in the 3D scene');
      if (!box.gltf) throw new Error('the GLB never replaced the procedural stand-in in the room');
      const err = fitError(box.size, [p.w, p.h, p.d]);
      if (err) throw new Error(`the placed GLB ${err}`);
      h.note(`room GLB ${box.size.join(' × ')} in (declared ${p.w} × ${p.h} × ${p.d})`);
    },
  },
  {
    name: 'kitchen-glb-broken-fallback',
    path: '#/local',
    as: 'anon',
    waitFor: ['.topbar'],
    check: async (h) => {
      await show3d(h);
      // A product whose model URL answers 200 but isn't a GLB: the loader fails, the procedural
      // model stays, nothing throws and the room keeps rendering.
      const id = await h.evaluate(() => {
        const cat = window.__miseQa.viewer.catalog;
        const base = cat.getState().byId.get('range-30');
        const pid = 'p_qabrokenmodel0000000000';
        cat.getState().register([{ ...base, id: pid, source: 'brand', name: 'QA Broken Model Range', model: { url: '/draco/draco_wasm_wrapper.js' } }]);
        const s = window.__miseQA.store.getState();
        const itemId = s.addItem(pid);
        s.select(null);
        return itemId;
      });
      if (!id) throw new Error('could not add the broken-model product');
      await h.sleep(2500);
      const box = await h.evaluate(itemBoxInPage, id);
      if (!box) throw new Error('the broken-model item vanished from the scene');
      if (box.gltf) throw new Error('a non-GLB file was shown as a model');
      if (box.meshes < 3 || box.size[1] < 30) throw new Error(`the procedural fallback is not drawn (${box.meshes} meshes, ${box.size.join(' × ')} in)`);
      const flat = await h.evaluate(async () => {
        const c = await window.__miseQa.viewer.renderStill({ width: 320, height: 180, camera: 'overview', quality: 'fast', toneMap: 'neutral' });
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let lo = 765;
        let hi = 0;
        for (let i = 0; i < d.length; i += 16) {
          const v = d[i] + d[i + 1] + d[i + 2];
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        return hi - lo < 30;
      });
      if (flat) throw new Error('the room renders blank after the broken model');
    },
  },

  // ── 3D performance (A-T3, acceptance 3) ──────────────────────────────────
  {
    name: 'kitchen-idle-and-pendant',
    path: '#/local',
    as: 'anon',
    waitFor: ['.topbar'],
    check: async (h) => {
      await show3d(h);
      await h.sleep(2500);
      const f0 = await h.evaluate(() => window.__miseQa.frames);
      await h.sleep(2000);
      const s1 = await h.evaluate(() => ({ frames: window.__miseQa.frames, calls: window.__miseQa.calls, triangles: window.__miseQa.triangles, programs: window.__miseQa.programs }));
      if (s1.frames - f0 !== 0) throw new Error(`the idle room drew ${s1.frames - f0} frames in 2 s (want 0)`);
      h.note(`idle: 0 frames in 2 s; last frame ${s1.calls} draw calls, ${s1.triangles} triangles, ${s1.programs} programs`);
      // Adding a pendant: no new shader programs and no long frame.
      await h.evaluate(() => {
        window.__qaGaps = [];
        let last = performance.now();
        const tick = (t) => {
          window.__qaGaps.push(t - last);
          last = t;
          if (window.__qaGaps.length < 90) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        const s = window.__miseQA.store.getState();
        s.addItem('pendant-globe');
        s.select(null);
      });
      await h.sleep(2500);
      const after = await h.evaluate(() => ({ programs: window.__miseQa.programs, worst: Math.round(Math.max(...window.__qaGaps)) }));
      if (after.programs !== s1.programs) throw new Error(`adding a pendant changed the shader programs ${s1.programs} → ${after.programs}`);
      if (after.worst > 100) throw new Error(`adding a pendant took a ${after.worst} ms frame (budget 100 ms)`);
      h.note(`pendant: programs ${s1.programs} → ${after.programs}, worst frame ${after.worst} ms`);
    },
  },

  // ── Studio render (A-T8, §13.3 A) ────────────────────────────────────────
  {
    name: 'studio-4k-split-free',
    as: 'fresh',
    setup: async ({ me }) => newKitchen(me, 'QA Studio Free'),
    waitFor: ['.topbar .studio-btn'],
    check: async (h) => {
      await h.evaluate(() => window.__miseQA.store.getState().setUI({ viewMode: 'split' }));
      await h.waitUntil(() => window.__miseQa?.canvas === 'room' && !!window.__miseQa?.viewer?.renderStill, 20_000, 'the split-view room canvas');
      await h.click('.topbar .studio-btn');
      await h.waitFor('.studio-preview[data-state="done"]', 30_000);
      await h.evaluate(() => {
        const b = [...document.querySelectorAll('.studio-opt button')].find((x) => x.textContent.includes('4K'));
        b?.setAttribute('data-qa-4k', '1');
      });
      await h.click('[data-qa-4k="1"]');
      await h.evaluate(() => {
        const b = [...document.querySelectorAll('.studio-actions button')].find((x) => x.textContent.includes('Render again'));
        b?.click();
      });
      await h.sleep(300);
      await h.waitFor('.studio-preview[data-state="done"]', 60_000);
      const d = await h.evaluate(() => ({ ...document.querySelector('.studio-preview').dataset, max: window.__miseQa.viewer.maxSide }));
      const wantW = Math.min(3840, d.max);
      if (+d.width !== wantW || +d.height !== Math.round((wantW * 9) / 16)) throw new Error(`the 4K render from split view is ${d.width}×${d.height} (max side ${d.max})`);
      if (d.watermark !== '1') throw new Error('a free user’s preview has no watermark');
      await h.shot('preview');
    },
  },
  {
    name: 'studio-4k-3d-entitled',
    as: 'contractor',
    setup: async ({ me }) => newKitchen(me, 'QA Studio Contractor'),
    waitFor: ['.topbar .studio-btn'],
    check: async (h) => {
      await show3d(h);
      await h.click('.topbar .studio-btn');
      await h.waitFor('.studio-preview[data-state="done"]', 30_000);
      const wm = await h.evaluate(() => document.querySelector('.studio-preview')?.dataset.watermark);
      if (wm !== '0') throw new Error('an entitled (Contractor) user’s preview is watermarked');
      // The renderer itself at 4K: the canvas it returns is the size asked for (or the GPU cap).
      const r = await h.evaluate(async () => {
        const max = window.__miseQa.viewer.maxSide;
        const c = await window.__miseQa.viewer.renderStill({ width: 3840, height: 2160, camera: 'current', quality: 'high', toneMap: 'neutral' });
        return { w: c.width, h: c.height, max };
      });
      const wantW = Math.min(3840, r.max);
      if (r.w !== wantW || r.h !== Math.round((wantW * 9) / 16)) throw new Error(`renderStill(3840×2160) returned ${r.w}×${r.h} (max side ${r.max})`);
      await h.shot('preview');
    },
  },

  // ── Tone mapping A/B (A-T4, acceptance 7) ────────────────────────────────
  {
    name: 'tonemap-ab',
    path: '#/local',
    as: 'anon',
    waitFor: ['.topbar'],
    check: async (h) => {
      await show3d(h);
      await h.sleep(1500);
      for (const tm of ['aces', 'neutral', 'agx']) {
        await h.evaluate(async (t) => {
          const c = await window.__miseQa.viewer.renderStill({ width: 1440, height: 810, camera: 'eye', quality: 'high', toneMap: t });
          let img = document.getElementById('qa-tonemap');
          if (!img) {
            img = document.createElement('img');
            img.id = 'qa-tonemap';
            img.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;background:#111;z-index:99999';
            document.body.appendChild(img);
          }
          img.src = c.toDataURL('image/png');
          await img.decode();
        }, tm);
        await h.shot(`tonemap-${tm}`);
      }
      await h.evaluate(() => document.getElementById('qa-tonemap')?.remove());
    },
  },
];
