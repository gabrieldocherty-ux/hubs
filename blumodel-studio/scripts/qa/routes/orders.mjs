// Package C (orders) QA routes, BUILD_PLAN §3.7 / §7 C-T8. Run with
//   node scripts/qa.mjs --pkg orders --port 8814 --dist .build/orders
//
// Needs the orders seed (server/seed/orders.mjs): demo-customer@mise.test owns four DEMO
// orders with fixed ids, one per state below. Checks only use `evaluate` (a JS expression run in
// the page, awaited), so they work whatever else the runner's context provides. expectText avoids
// text under `text-transform: uppercase` (eyebrows, banners' bold lead), so innerText and
// textContent both match. That another user gets a 404 for an order is a server test
// (orders.test.mjs), not a route here: the browser logs the 404 as a console error.

const DELIVERED = 'o_demoseedorder00000000003';
const PHONE = { w: 390, h: 844, mobile: true };

/** A fresh customer order (no uploads needed: it starts from a built-in catalog product). */
async function newOrder({ api }, { checkout = false } = {}) {
  const customer = api.as('customer');
  const r = await customer.post('/api/orders', {
    target: 'customer',
    rush: false,
    items: [
      {
        tier: 'standard',
        extraFinishes: 0,
        brief: { productTypeId: 'range-gas', kind: 'range', variant: 'gas-4', name: 'QA range (Demo)', widthIn: 30, depthIn: 28, heightIn: 36, notes: 'QA', referenceFileIds: [], refProductId: 'range-30' },
      },
    ],
  });
  if (r.status !== 201) throw new Error(`creating an order failed: ${r.status} ${JSON.stringify(r.body)}`);
  const id = r.body.order.id;
  if (checkout) {
    const c = await customer.post(`/api/orders/${id}/checkout`, {});
    if (c.status !== 200) throw new Error(`checkout failed: ${c.status} ${JSON.stringify(c.body)}`);
  }
  return id;
}

/** Fails if any payment screen renders a card-like field (PRODUCT_SPEC §7.4: none at all). */
const NO_CARD_FIELDS = `(() => {
  const bad = [...document.querySelectorAll('input, iframe')].filter((el) =>
    el.tagName === 'IFRAME' || /cc-|card|cvc|cvv|expir/i.test([el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label')].join(' ')));
  return bad.length;
})()`;

/** Clicks the first button whose text includes `label`. */
const click = (label) => `(() => {
  const b = [...document.querySelectorAll('button, a')].find((x) => x.textContent.includes(${JSON.stringify(label)}) && !x.disabled);
  if (!b) return false;
  b.click();
  return true;
})()`;

/**
 * The full DEMO lifecycle (BUILD_PLAN §7 acceptance 2) runs across two routes that share this
 * state: the studio starts and delivers through the drawer, then the customer places the model in
 * a kitchen and accepts it. The second route needs the first to have run (the runner runs routes
 * in file order).
 */
const life = { id: null, name: null };

/** In-page: a box GLB (one `mise_finish` material, w×h×d metres, base on y = 0) as a File. */
const GLB_FILE = `(() => {
  const w = 0.838, h = 0.914, d = 0.559;
  const F = [
    [[1,0,0],[[1,0,1],[1,0,-1],[1,1,-1],[1,1,1]]], [[-1,0,0],[[-1,0,-1],[-1,0,1],[-1,1,1],[-1,1,-1]]],
    [[0,1,0],[[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]], [[0,-1,0],[[-1,0,-1],[1,0,-1],[1,0,1],[-1,0,1]]],
    [[0,0,1],[[-1,0,1],[1,0,1],[1,1,1],[-1,1,1]]], [[0,0,-1],[[1,0,-1],[-1,0,-1],[-1,1,-1],[1,1,-1]]],
  ];
  const pos = [], nrm = [], uv = [], idx = [];
  F.forEach(([n, cs], f) => {
    for (const [x, y, z] of cs) { pos.push(x * w / 2, y * h, z * d / 2); nrm.push(...n); }
    uv.push(0, 1, 1, 1, 1, 0, 0, 0);
    idx.push(f * 4, f * 4 + 1, f * 4 + 2, f * 4, f * 4 + 2, f * 4 + 3);
  });
  const parts = [new Float32Array(pos), new Float32Array(nrm), new Float32Array(uv), new Uint16Array(idx)].map((a) => new Uint8Array(a.buffer));
  const binLen = parts.reduce((s, p) => s + p.length, 0);
  const bin = new Uint8Array(Math.ceil(binLen / 4) * 4);
  let o = 0;
  const views = [];
  parts.forEach((p, i) => { bin.set(p, o); views.push({ buffer: 0, byteOffset: o, byteLength: p.length, target: i === 3 ? 34963 : 34962 }); o += p.length; });
  const gltf = {
    asset: { version: '2.0', generator: 'mise qa' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'box' }],
    meshes: [{ name: 'box', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: 'mise_finish', pbrMetallicRoughness: { baseColorFactor: [0.9, 0.9, 0.88, 1], metallicFactor: 0, roughnessFactor: 0.6 } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 24, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  const js = new TextEncoder().encode(JSON.stringify(gltf));
  const json = new Uint8Array(Math.ceil(js.length / 4) * 4).fill(0x20);
  json.set(js);
  const out = new Uint8Array(12 + 8 + json.length + 8 + bin.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.length, true);
  v.setUint32(12, json.length, true); v.setUint32(16, 0x4e4f534a, true); out.set(json, 20);
  v.setUint32(20 + json.length, bin.length, true); v.setUint32(24 + json.length, 0x004e4942, true); out.set(bin, 28 + json.length);
  return new File([out], 'qa-sink.glb', { type: 'model/gltf-binary' });
})()`;

/** In-page: a 64×64 PNG thumbnail drawn on a canvas. */
const PNG_FILE = `new Promise((res) => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#e9e4da'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#8a7f70'; g.fillRect(8, 20, 48, 30);
  c.toBlob((b) => res(new File([b], 'qa-sink.png', { type: 'image/png' })), 'image/png');
})`;

/** In-page: drops `file` (an expression) on the file input whose aria-label starts with `label`. */
const putFile = (label, file) => `(async () => {
  const input = [...document.querySelectorAll('input[type=file]')].find((x) => (x.getAttribute('aria-label') || '').startsWith(${JSON.stringify(label)}));
  if (!input) return false;
  const dt = new DataTransfer();
  dt.items.add(await (${file}));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

const waitFor = (expr, ms = 5000) => `(async () => {
  const end = Date.now() + ${ms};
  while (Date.now() < end) {
    if (${expr}) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
})()`;

export default [
  // ── the request wizard, each step ─────────────────────────────────────
  {
    name: 'orders-new-what',
    path: '#/orders/new',
    as: 'customer',
    viewport: { w: 1440, h: 900 },
    waitFor: '.ord-wizard',
    expectText: ['Request a model', 'What should we model?', 'no card details are collected'],
  },
  {
    name: 'orders-new-steps',
    path: '#/orders/new?ref=range-30',
    as: 'customer',
    viewport: { w: 1440, h: 900 },
    waitFor: '.ord-wizard',
    expectText: ['Gas Range', 'Don’t use it'],
    check: async ({ evaluate }) => {
      // what → size → photos (optional with a catalog product) → notes → tier → review
      for (const [label, heading] of [
        ['Next', 'How big is it?'],
        ['Next', 'Reference photos'],
        ['Next', 'Notes for the studio'],
        ['Next', 'Tier and extras'],
        ['Next', 'Review & pay'],
      ]) {
        if (!(await evaluate(click(label)))) throw new Error(`no "${label}" button`);
        if (!(await evaluate(waitFor(`document.querySelector('.ord-form h2')?.textContent.includes(${JSON.stringify(heading)})`)))) throw new Error(`step "${heading}" never showed`);
      }
      if (!(await evaluate(waitFor(`document.querySelector('.ord-quote .ord-total')?.textContent.includes('$279')`)))) throw new Error('the live quote never showed $279');
      if (await evaluate(NO_CARD_FIELDS)) throw new Error('a card-like field is on the request page');
    },
  },
  {
    name: 'orders-new-phone',
    path: '#/orders/new?ref=range-30',
    as: 'customer',
    viewport: PHONE,
    waitFor: '.ord-wizard',
    expectText: ['What should we model?'],
    check: async ({ evaluate }) => {
      if (await evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')) throw new Error('the page scrolls sideways on a phone');
    },
  },

  // ── list and detail ───────────────────────────────────────────────────
  {
    name: 'orders-list',
    path: '#/orders',
    as: 'customer',
    viewport: { w: 1440, h: 900 },
    waitFor: '.ord-list',
    expectText: ['My orders', 'Fireclay apron-front sink (Demo)', 'Delivered', 'In progress'],
  },
  {
    name: 'orders-list-phone',
    path: '#/orders',
    as: 'customer',
    viewport: PHONE,
    waitFor: '.ord-list',
    expectText: ['My orders'],
    check: async ({ evaluate }) => {
      if (await evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')) throw new Error('the list scrolls sideways on a phone');
    },
  },
  {
    name: 'orders-delivered',
    path: `#/orders/${DELIVERED}`,
    as: 'customer',
    viewport: { w: 1440, h: 900 },
    waitFor: '.ord-deliverable',
    waitMs: 800,
    expectText: ['Fireclay apron-front sink (Demo)', 'Accept the model', 'Request revision', 'Add to a kitchen', 'Timeline'],
  },
  {
    name: 'orders-delivered-phone',
    path: `#/orders/${DELIVERED}`,
    as: 'customer',
    viewport: PHONE,
    waitFor: '.ord-deliverable',
    expectText: ['Accept the model'],
    check: async ({ evaluate }) => {
      if (await evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')) throw new Error('the order page scrolls sideways on a phone');
    },
  },
  // ── DEMO checkout ─────────────────────────────────────────────────────
  {
    name: 'pay-demo',
    as: 'customer',
    viewport: { w: 1440, h: 900 },
    setup: async (ctx) => ({ path: `#/pay/demo/${await newOrder(ctx, { checkout: true })}` }),
    waitFor: '.ord-pay-card',
    expectText: ['DEMO', 'no real money moves', 'Simulate successful payment', 'Simulate declined payment', 'Cancel'],
    check: async ({ evaluate }) => {
      if (await evaluate(NO_CARD_FIELDS)) throw new Error('the DEMO checkout renders a card-like field');
      if (await evaluate('document.querySelectorAll("input").length')) throw new Error('the DEMO checkout has input fields');
    },
  },
  {
    name: 'pay-demo-phone',
    as: 'customer',
    viewport: PHONE,
    setup: async (ctx) => ({ path: `#/pay/demo/${await newOrder(ctx, { checkout: true })}` }),
    waitFor: '.ord-pay-card',
    expectText: ['DEMO'],
    check: async ({ evaluate }) => {
      if (await evaluate('document.documentElement.scrollWidth > window.innerWidth + 1')) throw new Error('the DEMO checkout scrolls sideways on a phone');
    },
  },
  {
    // A full DEMO purchase: decline once, then pay; the order page shows it paid.
    name: 'pay-demo-purchase',
    as: 'customer',
    viewport: { w: 1440, h: 900 },
    setup: async (ctx) => ({ path: `#/pay/demo/${await newOrder(ctx, { checkout: true })}` }),
    waitFor: '.ord-pay-card',
    expectText: ['DEMO'],
    check: async ({ evaluate }) => {
      if (!(await evaluate(click('Simulate declined payment')))) throw new Error('no decline button');
      if (!(await evaluate(waitFor(`document.body.textContent.includes('Payment declined (simulated)')`)))) throw new Error('decline was not shown');
      if (!(await evaluate(click('Simulate successful payment')))) throw new Error('no pay button');
      if (!(await evaluate(waitFor(`location.hash.startsWith('#/orders/o_')`)))) throw new Error('did not return to the order page');
      if (!(await evaluate(waitFor(`document.body.textContent.includes('Paid · in the queue')`)))) throw new Error('the order page does not show paid');
      const status = await evaluate(`fetch('/api/orders/' + location.hash.split('/')[2], { credentials: 'same-origin' }).then((r) => r.json()).then((d) => d.order.status)`);
      if (status !== 'paid') throw new Error(`order status is ${status}, not paid`);
    },
  },

  // ── the full DEMO lifecycle (two routes, in order) ─────────────────────
  {
    // The customer has paid (DEMO); the studio starts the order and delivers a GLB + thumbnail
    // through the drawer's real upload inputs.
    name: 'orders-lifecycle-deliver',
    as: 'studio',
    viewport: { w: 1440, h: 900 },
    setup: async ({ api }) => {
      const customer = api.as('customer');
      life.name = `QA lifecycle sink ${Date.now().toString(36)} (Demo)`;
      const r = await customer.post('/api/orders', {
        target: 'customer',
        items: [{ tier: 'simple', extraFinishes: 0, brief: { productTypeId: 'sink-farmhouse', kind: 'sink', variant: 'farmhouse', name: life.name, widthIn: 33, depthIn: 22, heightIn: 36, notes: 'QA lifecycle', referenceFileIds: [], refProductId: 'sink-farm' } }],
      });
      if (r.status !== 201) throw new Error(`creating the order failed: ${r.status} ${JSON.stringify(r.body)}`);
      life.id = r.body.order.id;
      const c = await customer.post(`/api/orders/${life.id}/checkout`, {});
      if (c.status !== 200) throw new Error(`checkout failed: ${c.status}`);
      const p = await customer.post(`/api/payments/demo/${life.id}/complete`, { outcome: 'success' });
      if (p.status !== 200 || p.body?.order?.status !== 'paid') throw new Error(`demo payment failed: ${p.status} ${JSON.stringify(p.body)}`);
      return { path: '#/admin/studio' };
    },
    waitFor: '.ord-queue',
    expectText: ['Studio queue'],
    check: async ({ evaluate, api }) => {
      if (!(await evaluate(click(life.name)))) throw new Error('the paid order is not in the queue');
      if (!(await evaluate(waitFor(`!!document.querySelector('.ord-drawer') && document.querySelector('.ord-drawer').textContent.includes('Start (assign to me)')`)))) throw new Error('the drawer did not offer Start');
      await evaluate(click('Start (assign to me)'));
      if (!(await evaluate(waitFor(`!!document.querySelector('.ord-drawer input[type=file]')`)))) throw new Error('no deliver form after Start');
      if (!(await evaluate(putFile('GLB model for', GLB_FILE)))) throw new Error('no GLB input');
      if (!(await evaluate(waitFor(`document.querySelector('.ord-drawer').textContent.includes('qa-sink.glb')`, 8000)))) throw new Error('the GLB did not upload');
      if (!(await evaluate(putFile('Thumbnail for', PNG_FILE)))) throw new Error('no thumbnail input');
      if (!(await evaluate(waitFor(`document.querySelector('.ord-drawer').textContent.includes('qa-sink.png')`, 8000)))) throw new Error('the thumbnail did not upload');
      const deliver = `(() => {
        const b = [...document.querySelectorAll('.ord-drawer button')].find((x) => x.textContent.trim() === 'Deliver' && !x.disabled);
        if (!b) return false;
        b.click();
        return true;
      })()`;
      if (!(await evaluate(waitFor(deliver)))) throw new Error('no enabled Deliver button');
      if (!(await evaluate(waitFor(`document.querySelector('.ord-drawer').textContent.includes('Delivered: ')`, 8000)))) throw new Error('the drawer did not show the delivery');
      const o = await api.as('customer').get(`/api/orders/${life.id}`);
      if (o.body?.order?.status !== 'delivered' || !o.body.deliverables?.length) throw new Error(`after delivery the order is ${o.body?.order?.status}`);
    },
  },
  {
    // The buyer sees the model, places it in a kitchen, comes back and accepts. The model is in
    // the buyer's catalog and nobody else's.
    name: 'orders-lifecycle-accept',
    as: 'customer',
    viewport: { w: 1440, h: 900 },
    setup: async ({ api }) => {
      if (!life.id) throw new Error('orders-lifecycle-deliver must run first');
      const k = await api.as('customer').post('/api/projects', {
        name: 'QA lifecycle kitchen',
        doc: {
          name: 'QA lifecycle kitchen',
          room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
          surfaces: { cabinetFinishId: 'white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'marble', backsplashId: 'subway', flooringId: 'oak', paintId: 'white' },
          items: [],
        },
      });
      if (k.status !== 201) throw new Error(`creating a kitchen failed: ${k.status} ${JSON.stringify(k.body)}`);
      return { path: `#/orders/${life.id}` };
    },
    waitFor: '.ord-deliverable',
    expectText: ['Your model', 'Add to a kitchen', 'Accept the model'],
    check: async ({ evaluate, api }) => {
      const d = await api.as('customer').get(`/api/orders/${life.id}`);
      const productId = d.body?.deliverables?.[0]?.id;
      if (!productId) throw new Error('no deliverable on the order');
      const mine = await api.as('customer').get('/api/catalog');
      if (!mine.body.products.some((p) => p.id === productId)) throw new Error('the model is not in the buyer’s catalog');
      for (const role of ['brand', 'studio']) {
        const other = await api.as(role).get('/api/catalog');
        if (other.body.products.some((p) => p.id === productId)) throw new Error(`the private model is in ${role}’s catalog`);
      }
      if (!(await evaluate(click('Add to a kitchen')))) throw new Error('no Add to a kitchen');
      if (!(await evaluate(waitFor(`!!document.querySelector('.ord-kitchen')`)))) throw new Error('the kitchen picker did not list a kitchen');
      await evaluate(`document.querySelector('.ord-kitchen').click()`);
      if (!(await evaluate(waitFor(`location.hash.startsWith('#/k/') && document.body.textContent.includes('Drag it into place')`, 10000)))) throw new Error('the model was not added in the kitchen');
      await evaluate(`location.hash = '#/orders/${life.id}'`);
      if (!(await evaluate(waitFor(`document.body.textContent.includes('Accept the model')`, 8000)))) throw new Error('back on the order, no Accept');
      await evaluate(click('Accept the model'));
      if (!(await evaluate(waitFor(`await fetch('/api/orders/${life.id}', { credentials: 'same-origin' }).then((r) => r.json()).then((x) => x.order.status === 'completed')`, 8000)))) throw new Error('the order did not complete');
    },
  },

  // ── staff ─────────────────────────────────────────────────────────────
  {
    name: 'admin-studio',
    path: '#/admin/studio',
    as: 'admin',
    viewport: { w: 1440, h: 900 },
    waitFor: '.ord-queue',
    expectText: ['Studio queue', 'Enamel dome pendant (Demo)', 'Heritage 36″ dual-fuel range (Demo)'],
    check: async ({ evaluate }) => {
      if (!(await evaluate(click('Enamel dome pendant (Demo)')))) throw new Error('no queue row to open');
      if (!(await evaluate(waitFor(`!!document.querySelector('.ord-drawer') && document.querySelector('.ord-drawer').textContent.includes('Start (assign to me)')`)))) throw new Error('the drawer did not open with Start');
      if (!(await evaluate(waitFor(`!!document.querySelector('.ord-drawer img')`)))) throw new Error('the private reference photo is not shown to staff');
    },
  },
  {
    name: 'admin-studio-as-studio',
    path: '#/admin/studio',
    as: 'studio',
    viewport: { w: 1440, h: 900 },
    waitFor: '.ord-queue',
    expectText: ['Studio queue'],
  },
  {
    name: 'admin-studio-phone',
    path: '#/admin/studio',
    as: 'studio',
    viewport: PHONE,
    waitFor: '.ord-queue',
    expectText: ['Studio queue'],
  },
  {
    name: 'admin-revenue',
    path: '#/admin/revenue',
    as: 'admin',
    viewport: { w: 1440, h: 900 },
    waitFor: '.ord-kpis',
    expectText: ['Revenue', 'Custom-model orders only', 'simulated orders, not money', 'Simple', 'Table view'],
  },
];
