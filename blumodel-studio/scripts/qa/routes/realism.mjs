// A realism bench, not a regression test: one reference kitchen (the L + island template, oak
// floor, warm white shaker, marble) drawn at the overview and at eye level under each lighting
// variant in VARIANTS, for comparing side by side. A variant is a partial ROOM_LIGHT
// (SceneView.tsx) passed through the QA build's localStorage override, plus optional material
// switches read by the QA build.
// Run: node scripts/qa.mjs --pkg realism --port 8990

const VARIANTS = {
  base: {},
  // Under-cabinet LED lights on.
  ucl: { _surfaces: { underCabinet: 'led' } },
};

const DESK = { w: 1440, h: 900 };

export default Object.entries(VARIANTS).map(([name, light]) => ({
  name: `realism-${name}`,
  as: 'studio',
  viewport: DESK,
  setup: async ({ me }) => {
    const d = { name: `Realism ${name}`, room: { widthIn: 192, lengthIn: 168, ceilingIn: 108 }, surfaces: { cabinetFinishId: 'warm-white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'calacatta', backsplashId: 'zellige-white', flooringId: 'oak-natural', paintId: 'chalk', ...(light._surfaces ?? {}) }, items: [], version: 2 };
    const r = await me.post('/api/projects', { name: d.name, doc: d });
    if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status})`);
    return { path: `#/k/${r.body.project.id}` };
  },
  waitFor: ['.topbar'],
  check: async (h) => {
    await h.evaluate((l) => {
      const { _relief, _surfaces, ...light } = l;
      localStorage.setItem('blumodel.qa.relief', String(_relief ?? 1));
      localStorage.setItem('blumodel.qa.roomLight', JSON.stringify(light));
      localStorage.setItem('blumodel.viewMode', '3d');
    }, light);
    await h.evaluate(() => location.reload());
    await h.sleep(1500);
    await h.waitFor('.topbar');
    await h.evaluate(() => {
      const s = window.__blumodelQA.store.getState();
      s.applyTemplate('l-island');
      s.setUI({ viewMode: '3d' });
    });
    await h.waitUntil(() => !!document.querySelector('.scene-view canvas') && !document.querySelector('.scene-loading'), 25_000, 'the 3D scene');
    await h.sleep(2500);
    h.note(JSON.stringify(await h.evaluate(() => { const d = window.__blumodelQA.store.getState().doc; return { ucl: d.surfaces.underCabinet ?? null, walls: d.items.filter((i) => /^wall/.test(i.productId)).length }; })));
    await h.shot('overview');
    await h.evaluate(() => window.__blumodelQA.store.getState().requestCamera('eye'));
    await h.sleep(2500);
    await h.shot('eye');
  },
}));
