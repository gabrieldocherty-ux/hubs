// Package C (orders) QA routes, BUILD_PLAN §3.7 / §7 C-T8. Run with
//   node scripts/qa.mjs --pkg orders --port 8814 --dist .build/orders
//
// Needs the orders seed (server/seed/orders.mjs): demo-customer@blumodel.test owns four DEMO
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
        brief: { productTypeId: 'range-gas', kind: 'range', variant: 'gas-4', name: 'QA range (Demo)', upc: '200000041205', widthIn: 30, depthIn: 28, heightIn: 36, notes: 'QA', referenceFileIds: [], refProductId: 'range-30' },
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

/** In-page: a box GLB (one `blumodel_finish` material, w×h×d metres, base on y = 0) as a File. */
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
    asset: { version: '2.0', generator: 'blumodel qa' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'box' }],
    meshes: [{ name: 'box', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: 'blumodel_finish', pbrMetallicRoughness: { baseColorFactor: [0.9, 0.9, 0.88, 1], metallicFactor: 0, roughnessFactor: 0.6 } }],
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

const SIDEWAYS = 'document.documentElement.scrollWidth > window.innerWidth + 1';
// Parenthesised: `a ?? ''.includes(x)` would test only the '' and pass on any total.
const quoteTotal = `(document.querySelector('.ord-quote .ord-total')?.textContent ?? '')`;
const bodyHas = (t) => `document.body.textContent.includes(${JSON.stringify(t)})`;

/** Types `text` into the field `selector` the way a person does (focus, select all, insert). */
async function typeInto({ evaluate, send }, selector, text) {
  const ok = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.scrollIntoView({ block: 'center' });
    el.focus();
    el.select?.();
    return true;
  })()`);
  if (!ok) throw new Error(`no field ${selector}`);
  await send('Input.insertText', { text });
}

/**
 * A stand-in camera and BarcodeDetector, installed before the app loads: the camera is a canvas
 * stream and the detector reads a fixed UPC-A, so the scan flow runs in headless Edge (which has
 * neither). Only for the scan route.
 */
const SCAN_STUB = `(() => {
  class FakeBarcodeDetector {
    static async getSupportedFormats() { return ['upc_a', 'ean_13', 'ean_8', 'upc_e', 'qr_code']; }
    constructor(opts) { this.formats = opts?.formats ?? []; this.n = 0; }
    async detect() {
      this.n += 1;
      // Nothing for ~2 s (so the open scanner can be photographed), a misread (wrong check
      // digit, skipped), then the real code.
      return this.n < 12 ? [] : this.n === 12 ? [{ rawValue: '036000291453', format: 'upc_a' }] : [{ rawValue: '036000291452', format: 'upc_a' }];
    }
  }
  window.BarcodeDetector = FakeBarcodeDetector;
  const md = navigator.mediaDevices || {};
  md.getUserMedia = async () => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 240;
    const g = c.getContext('2d');
    const draw = () => { g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 240); for (let x = 40; x < 280; x += 6) { g.fillStyle = (x / 6) % 2 ? '#000' : '#fff'; g.fillRect(x, 70, 3, 100); } };
    draw();
    setInterval(draw, 100);
    return c.captureStream(10);
  };
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: md });
})();`;

export default [
  // ── Make custom models: the product list ──────────────────────────────
  {
    // A blank request: one product open, the pack meter at 1 of 8, the server's $129 quote.
    name: 'orders-new-products',
    path: '#/orders/new',
    as: 'customer',
    viewport: { w: 1440, h: 900 },
    waitFor: ['.ord-wizard', '.ord-product.open'],
    expectText: ['Make custom models', 'New request', 'Products to model', 'UPC or EAN', '1 of 8 products', '7 more fit in this pack', 'no card details are collected'],
    check: async ({ evaluate, note }) => {
      if (!(await evaluate(waitFor(`${quoteTotal}.includes('$129')`)))) throw new Error('the server quote never showed $129 for one product');
      // Headless Edge on Windows has no BarcodeDetector: the photo fallback is what it offers.
      const scan = await evaluate(`[...document.querySelectorAll('.ord-upc button')].map((b) => b.textContent.trim())`);
      note(`UPC buttons: ${JSON.stringify(scan)}`);
      if (!scan.some((t) => /photo of the barcode/.test(t))) throw new Error('no "Upload a photo of the barcode" offer');
      if (await evaluate(NO_CARD_FIELDS)) throw new Error('a card-like field is on the request page');
    },
  },
  {
    // UPC checking as you type, a second product, the first-problem message, review and rush.
    name: 'orders-new-upc',
    path: '#/orders/new?ref=range-30',
    as: 'customer',
    viewport: { w: 1440, h: 900 },
    waitFor: '.ord-product.open',
    expectText: ['Gas Range', 'Don’t use it'],
    check: async (h) => {
      const { evaluate, shot } = h;
      await typeInto(h, '#ord-p0-upc', '036000291453');
      if (!(await evaluate(waitFor(bodyHas('doesn’t check out'))))) throw new Error('a wrong check digit was not flagged');
      // The message reads as an error (red, not the label's bold grey).
      /** [the message's colour, the theme token's colour], both as computed rgb(). */
      const colors = (token) => `(() => {
        const probe = document.createElement('span');
        probe.style.color = 'var(${token})';
        document.body.append(probe);
        const want = getComputedStyle(probe).color;
        probe.remove();
        return [getComputedStyle(document.querySelector('#ord-p0-upc-msg')).color, want];
      })()`;
      const [bad, red] = await evaluate(colors('--bad'));
      if (bad !== red) throw new Error(`the UPC error is ${bad}, not the error colour ${red}`);
      await typeInto(h, '#ord-p0-upc', '0 36000 29145 2');
      if (!(await evaluate(waitFor(bodyHas('✓ UPC-A 0 36000 29145 2'))))) throw new Error('a good UPC-A was not confirmed');
      const [good, green] = await evaluate(colors('--ok'));
      if (good !== green) throw new Error(`the UPC check is ${good}, not the ok colour ${green}`);
      await shot('upc');
      if (!(await evaluate(click('+ Add a product')))) throw new Error('no add-a-product button');
      if (!(await evaluate(waitFor(`!!document.querySelector('#ord-product-1 .ord-product.open')`)))) throw new Error('the second product did not open');
      if (!(await evaluate(waitFor(bodyHas('2 of 8 products'))))) throw new Error('the pack meter did not count 2');
      // Two products are still one pack: the server's quote stays $129.
      if (!(await evaluate(waitFor(`${quoteTotal}.includes('$129')`)))) throw new Error('two products did not stay one $129 pack');
      // Moving on with an empty product names the problem and marks the product.
      if (!(await evaluate(click('Review 2 products')))) throw new Error('no review button');
      if (!(await evaluate(waitFor(`${bodyHas('Product 2: Name the product.')} && !!document.querySelector('#ord-product-1 .ord-product.bad')`)))) throw new Error('the empty product was not flagged');
      await shot('problem');
      await typeInto(h, '#ord-product-1 .ord-grid-2 input[maxlength="80"]', 'QA wall oven (Demo)');
      await typeInto(h, '#ord-p1-upc', '4006381333931');
      if (!(await evaluate(waitFor(bodyHas('✓ EAN-13'))))) throw new Error('a good EAN-13 was not confirmed');
      if (!(await evaluate(click('Review 2 products')))) throw new Error('no review button');
      if (!(await evaluate(waitFor(`document.querySelector('.ord-form h2')?.textContent.includes('Review & pay')`)))) throw new Error('review never showed');
      if (!(await evaluate(waitFor(`${bodyHas('UPC 0 36000 29145 2')} && ${bodyHas('UPC 4 006381 333931')}`)))) throw new Error('the review does not list both UPCs');
      await evaluate(`document.querySelector('.ord-rush input').click()`);
      if (!(await evaluate(waitFor(`${quoteTotal}.includes('$193.50')`)))) throw new Error('rush did not make the quote $193.50');
      if (await evaluate(NO_CARD_FIELDS)) throw new Error('a card-like field is on the request page');
    },
  },
  {
    // Adding products fills pack 1, then the 9th starts pack 2: two packs, $258, one checkout.
    name: 'orders-new-packs',
    path: '#/orders/new',
    as: 'customer',
    viewport: { w: 1440, h: 900 },
    waitFor: '.ord-product.open',
    expectText: ['1 of 8 products'],
    check: async ({ evaluate, shot }) => {
      for (let i = 0; i < 7; i++) if (!(await evaluate(click('+ Add a product')))) throw new Error('no add-a-product button');
      if (!(await evaluate(waitFor(bodyHas('This pack is full: the next product starts pack 2 (+$129)'))))) throw new Error('a full pack was not called out');
      if (!(await evaluate(waitFor(`${quoteTotal}.includes('$129')`)))) throw new Error('8 products did not stay one $129 pack');
      if (!(await evaluate(click('+ Add a product')))) throw new Error('no add-a-product button');
      if (!(await evaluate(waitFor(`${quoteTotal}.includes('$258')`)))) throw new Error('9 products did not quote two packs ($258)');
      if (!(await evaluate(waitFor(`${bodyHas('Model pack 2 of 2: 1 product')} && !!document.querySelector('.ord-pack-divider')`)))) throw new Error('no pack 2 line or divider');
      await shot('two-packs');
    },
  },
  {
    // The camera scan: a stand-in BarcodeDetector and camera (headless Edge has neither) prove
    // the flow: Scan opens the camera dialog, a misread is skipped, the code fills in.
    name: 'orders-new-scan',
    path: '#/orders/new',
    as: 'customer',
    viewport: PHONE,
    waitFor: '.ord-product.open',
    expectText: ['UPC or EAN'],
    check: async (h) => {
      const { evaluate, send, reload, shot, sleep } = h;
      await send('Page.addScriptToEvaluateOnNewDocument', { source: SCAN_STUB });
      await reload();
      if (!(await evaluate(waitFor(`[...document.querySelectorAll('.ord-upc button')].some((b) => b.textContent.trim() === 'Scan')`, 8000)))) throw new Error('no Scan button where BarcodeDetector exists');
      await evaluate(`[...document.querySelectorAll('.ord-upc button')].find((b) => b.textContent.trim() === 'Scan').click()`);
      if (!(await evaluate(waitFor(`!!document.querySelector('.ord-scan-video')`)))) throw new Error('the scanner did not open');
      // The camera is live (no "Starting the camera…") and the dialog has finished fading in.
      if (!(await evaluate(waitFor(`!document.querySelector('.ord-scan-status')`)))) throw new Error('the camera never started');
      await sleep(400);
      await shot('scanner');
      if (!(await evaluate(waitFor(`document.querySelector('#ord-p0-upc')?.value === '0 36000 29145 2'`, 8000)))) throw new Error('the scanned code was not filled in');
      if (!(await evaluate(waitFor(`!document.querySelector('.ord-scan-video') && ${bodyHas('✓ UPC-A 0 36000 29145 2')}`)))) throw new Error('the scanner did not close with the code confirmed');
    },
  },
  {
    // The whole form on a phone. Starting from a built-in product fills its type, name and size,
    // but not its brand: a built-in's brand is BluModel's own line, not the real product's maker.
    name: 'orders-new-phone',
    path: '#/orders/new?ref=range-30',
    as: 'customer',
    viewport: PHONE,
    fullPage: true,
    waitFor: '.ord-product.open',
    expectText: ['Products to model', 'UPC or EAN', 'Gas Range'],
    check: async ({ evaluate }) => {
      if (await evaluate(SIDEWAYS)) throw new Error('the page scrolls sideways on a phone');
      const brand = await evaluate(`document.querySelector('#ord-product-0 input[placeholder^="e.g. the maker"]')?.value`);
      if (brand !== '') throw new Error(`a built-in product's brand was copied into the request: ${JSON.stringify(brand)}`);
    },
  },
  {
    // No camera scanning (headless Edge has no BarcodeDetector): a photo of the barcode alone
    // identifies the product. It uploads as a private reference image and the review says so.
    name: 'orders-new-barcode-photo',
    path: '#/orders/new',
    as: 'customer',
    viewport: PHONE,
    waitFor: '.ord-product.open',
    expectText: ['Upload a photo of the barcode'],
    check: async (h) => {
      const { evaluate, shot } = h;
      await evaluate(`(() => {
        const s = document.querySelector('#ord-product-0 select');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'range-gas');
        s.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await typeInto(h, '#ord-product-0 input[maxlength="80"]', 'QA barcode range (Demo)');
      if (!(await evaluate(putFile('Upload a photo of the barcode', PNG_FILE)))) throw new Error('no barcode photo input');
      if (!(await evaluate(waitFor(`!!document.querySelector('.ord-barcode img') && ${bodyHas('The studio reads the code from the photo.')}`, 8000)))) throw new Error('the barcode photo did not upload');
      const said = await evaluate(`document.querySelector('#ord-product-0').textContent.split('The studio reads the code from the photo.').length - 1`);
      if (said !== 1) throw new Error(`the barcode note shows ${said} times`);
      await shot('photo');
      // The draft keeps the uploaded file's id; the buyer can read the private file.
      const fileId = await evaluate(`JSON.parse(sessionStorage.getItem('blumodel.orders.request.v2')).items[0].barcodeFileId ?? null`);
      if (!fileId) throw new Error('the draft has no barcode photo id');
      const status = await evaluate(`fetch('/api/files/' + ${JSON.stringify(fileId)}, { credentials: 'same-origin' }).then((r) => r.status)`);
      if (status !== 200) throw new Error(`the buyer cannot read their own barcode photo (${status})`);
      if (!(await evaluate(click('Review 1 product')))) throw new Error('no review button');
      if (!(await evaluate(waitFor(`document.querySelector('.ord-form h2')?.textContent.includes('Review & pay') && ${bodyHas('Barcode photo')}`)))) throw new Error('the review does not show the barcode photo');
      if (await evaluate(SIDEWAYS)) throw new Error('the page scrolls sideways on a phone');
    },
  },
  // ── contractors: the same pack flow, into My catalog ───────────────────
  {
    // (The workspace opens once the company has a business name and phone; scripts/qa/routes/
    // contractors.mjs saves its own company when it runs, so only fill one in if there is none.)
    // The workspace's Make custom models page prices from the server and opens the same request
    // form with My catalog chosen.
    name: 'orders-pro-modelling',
    path: '#/pro/modelling',
    as: 'contractor',
    setup: async ({ api }) => {
      const me = api.as('contractor');
      const p = (await me.get('/api/pro/profile')).body?.profile;
      if (!p?.company || !p?.phone) {
        const r = await me.put('/api/pro/profile', { company: 'Harbor Kitchens (QA)', phone: '905-555-0177', serviceArea: 'Testville' });
        if (r.status !== 200) throw new Error(`saving the QA contractor's company failed: ${r.status} ${JSON.stringify(r.body)}`);
      }
      return {};
    },
    viewport: { w: 1440, h: 900 },
    waitFor: '.pro-modelling',
    expectText: ['Have BluModel Studio model your products', 'Delivered models land straight in My catalog'],
    check: async ({ evaluate, shot }) => {
      if (!(await evaluate(waitFor(bodyHas('A Model pack covers up to 8 products for $129'))))) throw new Error('the page does not show the server’s Model pack');
      if (await evaluate(bodyHas('per item'))) throw new Error('the page still prices per item');
      await shot('page');
      const go = await evaluate(`(() => {
        const a = [...document.querySelectorAll('.pro-modelling .btn.primary')].find((x) => x.textContent.trim() === 'Make custom models');
        if (!a) return false;
        a.click();
        return true;
      })()`);
      if (!go) throw new Error('no Make custom models button');
      if (!(await evaluate(waitFor(`location.hash.startsWith('#/orders/new') && document.querySelector('.ord-target select')?.value === 'contractor'`)))) throw new Error('the request form did not open with My catalog chosen');
    },
  },
  {
    // A contractor's line identified by UPC alone, reviewed: the same $129 pack, delivered to My catalog.
    name: 'orders-new-contractor',
    path: '#/orders/new?target=contractor',
    as: 'contractor',
    viewport: { w: 1440, h: 900 },
    waitFor: ['.ord-product.open', '.ord-target select'],
    expectText: ['Who are the models for?', 'Products to model'],
    check: async (h) => {
      const { evaluate, shot } = h;
      if ((await evaluate(`document.querySelector('.ord-target select').value`)) !== 'contractor') throw new Error('My catalog is not the target');
      await evaluate(`(() => {
        const s = document.querySelector('#ord-product-0 select');
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'base-cabinet');
        s.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await typeInto(h, '#ord-product-0 input[maxlength="80"]', 'QA Harbor Base 18 (Demo)');
      await typeInto(h, '#ord-p0-upc', '036000291452');
      if (!(await evaluate(waitFor(bodyHas('✓ UPC-A 0 36000 29145 2'))))) throw new Error('the UPC was not confirmed');
      if (!(await evaluate(click('Review 1 product')))) throw new Error('no review button');
      if (!(await evaluate(waitFor(`${bodyHas('Delivered models land privately in My catalog')} && ${quoteTotal}.includes('$129')`)))) throw new Error('the review does not say My catalog at $129');
      if (!(await evaluate(waitFor(bodyHas('Line or collection'))))) throw new Error('a contractor request has no line field');
      await shot('review');
    },
  },
  {
    name: 'orders-new-contractor-phone',
    path: '#/orders/new?target=contractor',
    as: 'contractor',
    viewport: PHONE,
    waitFor: ['.ord-product.open', '.ord-target select'],
    expectText: ['Who are the models for?'],
    check: async ({ evaluate }) => {
      if (await evaluate(SIDEWAYS)) throw new Error('the contractor request scrolls sideways on a phone');
    },
  },
  {
    // The pricing page's custom-model section: the one offer, from the server.
    name: 'pricing-model-pack',
    path: '#/pricing',
    as: 'anon',
    viewport: { w: 1440, h: 900 },
    waitFor: '.mk-pack',
    expectText: ['Model pack', 'up to 8 products', '9–16 products', 'What you send', 'exact amount before you pay'],
    check: async ({ evaluate, shot }) => {
      const n = await evaluate(`document.querySelectorAll('.mk-tiers .mk-tier').length`);
      if (n !== 3) throw new Error(`expected 3 custom-model cards, found ${n}`);
      if (await evaluate(`document.querySelector('#models').textContent.includes('$279')`)) throw new Error('a retired tier price is still on the pricing page');
      await evaluate(`document.getElementById('models').scrollIntoView({ block: 'start' })`);
      await shot('models');
    },
  },
  {
    name: 'pricing-model-pack-phone',
    path: '#/pricing',
    as: 'anon',
    viewport: PHONE,
    waitFor: '.mk-pack',
    expectText: ['Model pack'],
    check: async ({ evaluate, shot }) => {
      if (await evaluate(SIDEWAYS)) throw new Error('the pricing page scrolls sideways on a phone');
      await evaluate(`document.getElementById('models').scrollIntoView({ block: 'start' })`);
      await shot('models');
    },
  },

  // ── list and detail ───────────────────────────────────────────────────
  {
    name: 'orders-list',
    path: '#/orders',
    as: 'customer',
    viewport: { w: 1440, h: 900 },
    waitFor: '.ord-list',
    expectText: ['Make custom models', 'Fireclay apron-front sink (Demo)', 'Delivered', 'In progress'],
  },
  {
    name: 'orders-list-phone',
    path: '#/orders',
    as: 'customer',
    viewport: PHONE,
    waitFor: '.ord-list',
    expectText: ['Make custom models'],
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
        // No size: the studio's delivery takes it from the model.
        items: [{ brief: { productTypeId: 'sink-farmhouse', kind: 'sink', variant: 'farmhouse', name: life.name, brand: 'QA Sinks (Demo)', upc: '96385074', notes: 'QA lifecycle', referenceFileIds: [], refProductId: 'sink-farm' } }],
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
      if (!(await evaluate(waitFor(`document.querySelector('.ord-drawer').textContent.includes('9638 5074 (EAN-8)')`)))) throw new Error('the drawer does not show the product’s UPC');
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
    expectText: ['Studio queue', 'Enamel dome pendant (Demo)', 'Heritage 36″ dual-fuel range (Demo)', 'UPC 2 00000 04120 5'],
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
    expectText: ['Revenue', 'Custom-model orders only', 'simulated orders, not money', 'Model pack', 'Simple (retired)', 'Table view'],
  },
];
