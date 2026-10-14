// Integration QA routes (BUILD_PLAN §10): the chains that cross packages, run after every
// package's own routes are green. Format: BUILD_PLAN §3.7.
//
//   node scripts/qa.mjs --pkg integration --port 8818
//
// The chains share module state, so routes run in FILE ORDER and a chain needs its first route
// (use --pkg integration, not --only on a later route):
//
//   brand chain   1  the Contractor sets up the Brand page and publishes a My-catalog product with
//                    a GLB (Brand page tab, as the contractor)
//                 2  Admin approves the page and the product (Moderation tab, as admin)
//                 3  anonymous: #/b/:slug, the public catalog and #/p/:id show it, the GLB on the stage
//                 4  a homeowner adds it to a kitchen: the GLB is in the 3D room at its declared size
//                 5  an anonymous homeowner sends a lead from the page
//                 6  the lead is in that contractor's Leads inbox, and nobody else's
//   copy          no 'List your products' / brand-portal entry point, no 'Describe your kitchen'
//   photo         Start from a photo -> Check the space -> Build my kitchen -> the editor with the
//                 photo reference mounted
//   order         a custom model: demo pay -> studio delivers -> only the buyer can see it -> it is
//                 in a shared kitchen and the share link serves its GLB (and nothing else does)
//   contractor    a contractor's shared kitchen: Prepared by, sell prices, no cost data, no Export
//   export        a free user's export -> the Unlock dialog -> demo unlock -> the export runs
//
// Everything is fictional and made through the API in `setup`. The runner's `contractor` is the
// Contractor in the brand chain (it must run after the brands package routes, which expect the
// runner's contractor to have no page yet: --pkg all runs packages alphabetically).

import { makeGlb } from '../../../server/test/fixtures/glb.mjs';
import { makePng } from '../../../server/test/fixtures/images.mjs';
import { kitchenPhoto } from './generate.mjs';

const COMPANY = { company: 'Cedar & Sill Millwork (QA)', phone: '555-0173', email: 'hello@cedarsill.example', website: 'https://cedarsill.example', serviceArea: 'Hamilton and Burlington', defaultMarkupPct: 40 };
const PRODUCT_NAME = 'Cedar Sill Walnut Base 24 (QA)';
const COST_CENTS = 31337; // $313.37: a number that must never reach a public wire or a client's screen
const COST_TEXT = ['313.37', '31337'];
const PHONE = { w: 390, h: 844, mobile: true, dpr: 3 };

/** State handed from one route of a chain to the next. */
const brand = {};
const order = {};

// ─── helpers ─────────────────────────────────────────────────────────────────

const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what} failed (${r.status}): ${typeof r.body === 'object' ? r.body?.error ?? JSON.stringify(r.body).slice(0, 200) : String(r.text ?? '').slice(0, 200)}`);
  return r.body;
};

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

/** Nothing that looks like a cost or margin, anywhere in a JSON value. */
function assertNoCosts(value, where) {
  const bad = [];
  const walk = (v, p) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        if (/^(cost|costCents|costByWidth|unitCost|costTotal|margin|marginPct|markupPct|markup)$/i.test(k)) bad.push(`${p}.${k}`);
        walk(x, `${p}.${k}`);
      }
  };
  walk(value, '$');
  if (bad.length) throw new Error(`${where} carries cost fields: ${bad.slice(0, 5).join(', ')}`);
  const text = JSON.stringify(value);
  for (const n of COST_TEXT) if (text.includes(n)) throw new Error(`${where} contains the contractor's cost (${n})`);
}

const cabinetSpec = (over = {}) => ({
  kind: 'base',
  variant: 'door-drawer',
  category: 'cabinets',
  name: PRODUCT_NAME,
  blurb: 'Solid walnut face frame, dovetailed drawers.',
  sku: 'CSW{w}',
  widthIn: 24,
  depthIn: 24,
  heightIn: 34.5,
  elevationIn: 0,
  widthOptions: [18, 24, 30],
  price: 0,
  finishes: [{ id: 'walnut-oil', name: 'Walnut, oiled', hex: '#6b4a32', material: 'wood' }],
  imageFileIds: [],
  line: 'Cedar Sill Shaker',
  doorStyle: 'shaker',
  ...over,
});

/** A GLB sized 24 x 34.5 x 24 in (metres), uploaded as `who`. */
async function uploadModel(who, { w = 24, h = 34.5, d = 24, name = 'base.glb' } = {}) {
  const IN = 0.0254;
  const r = await who.putRaw(`/api/files?kind=model&name=${name}`, makeGlb({ w: w * IN, h: h * IN, d: d * IN }), 'model/gltf-binary');
  return must(r, 'Uploading the GLB').file.id;
}
async function uploadImage(who, name = 'photo.png', rgba = [107, 74, 50, 255]) {
  return must(await who.putRaw(`/api/files?kind=image&name=${name}`, makePng({ rgba }), 'image/png'), 'Uploading the photo').file.id;
}

/** A saved kitchen for `who`: a one-wall run on the default surfaces plus `items`. */
async function newKitchen(who, name, items = [], { client } = {}) {
  const doc = {
    version: 2,
    name,
    room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
    surfaces: { cabinetFinishId: 'warm-white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'calacatta', backsplashId: 'zellige-white', flooringId: 'herringbone', paintId: 'chalk' },
    items: [
      { id: 'i-base-1', productId: 'base', x: 48, y: 12, rotation: 0, finishIndex: 0 },
      { id: 'i-sink', productId: 'sink-farm', x: 78, y: 12, rotation: 0, finishIndex: 0 },
      { id: 'i-range', productId: 'range-30', x: 159, y: 14, rotation: 0, finishIndex: 0 },
      ...items,
    ],
  };
  const { project } = must(await who.post('/api/projects', { name, ...(client ? { client } : {}), doc }), `Creating "${name}"`);
  return project;
}

/** Switches the editor to 3D and waits for the room canvas to have drawn. */
async function show3d(h) {
  await h.evaluate(() => {
    const s = window.__blumodelQA.store.getState();
    s.select(null);
    s.setUI({ viewMode: '3d' });
  });
  await h.waitUntil(() => window.__blumodelQa?.canvas === 'room' && (window.__blumodelQa?.frames ?? 0) > 0, 25_000, 'the room canvas drawing');
}

/** The placed item's size in inches and whether it is a loaded GLB (a group tagged userData.gltf). Runs in the page. */
function itemBoxInPage(itemId) {
  const st = window.__blumodelQA.scene3d.get();
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
  g.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.visible) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv);
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], bb.min.getComponent(k));
      max[k] = Math.max(max[k], bb.max.getComponent(k));
    }
  });
  return { gltf, size: max.map((v, k) => +(v - min[k]).toFixed(2)) };
}

/** The GLB reaches the room (not the procedural stand-in) at no more than its declared size. */
async function glbInRoom(h, productId, want) {
  const itemId = await h.evaluate((id) => window.__blumodelQA.store.getState().doc.items.find((i) => i.productId === id)?.id ?? null, productId);
  if (!itemId) throw new Error('the product is not in the kitchen');
  let box = null;
  for (let i = 0; i < 80; i++) {
    box = await h.evaluate(itemBoxInPage, itemId);
    if (box?.gltf) break;
    await h.sleep(250);
  }
  if (!box) throw new Error('the item is not in the 3D scene');
  if (!box.gltf) throw new Error('the GLB never replaced the procedural stand-in in the room');
  const ratios = box.size.map((v, k) => v / want[k]);
  if (ratios.some((r) => r > 1.02) || Math.max(...ratios) < 0.97) throw new Error(`the GLB in the room is ${box.size.join(' x ')} in, declared ${want.join(' x ')}`);
  return box;
}

/** Marks the first element matching `selector` whose text includes `text`, so it can be clicked by selector. */
async function mark(h, selector, text, tag, root = 'document') {
  const ok = await h.evaluate(
    (sel, t, g, r) => {
      const scope = r === 'document' ? document : document.querySelector(r);
      const el = scope && [...scope.querySelectorAll(sel)].find((x) => x.textContent.includes(t));
      el?.setAttribute('data-qa', g);
      return !!el;
    },
    selector,
    text,
    tag,
    root,
  );
  if (!ok) throw new Error(`nothing matching ${selector} says "${text}"`);
  return `[data-qa="${tag}"]`;
}

/** Fills the open lead form and sends it; resolves once the confirmation shows. */
async function sendLead(h, { name, email }) {
  for (const [sel, value] of [
    ['.lead-modal input[autocomplete="name"]', name],
    ['.lead-modal input[type="email"]', email],
  ]) {
    await h.click(sel);
    await h.evaluate((s) => document.querySelector(s).select(), sel);
    await h.type(value);
  }
  const ticked = await h.evaluate(() => document.querySelector('.lead-consent input[type="checkbox"]').checked);
  if (!ticked) await h.click('.lead-consent input[type="checkbox"]');
  await h.click('.lead-modal button[type="submit"]');
  await h.waitFor('.lead-sent');
}

const FORBIDDEN_COPY = [
  [/describe your (dream )?kitchen/i, 'Describe your kitchen'],
  [/list your products/i, 'List your products'],
  [/brand portal/i, 'Brand portal'],
];
async function assertCopy(h, where) {
  const text = await h.evaluate(() => document.body.innerText);
  for (const [re, label] of FORBIDDEN_COPY) if (re.test(text)) throw new Error(`${where} still says "${label}"`);
}

// ─── brand chain ─────────────────────────────────────────────────────────────

export default [
  {
    // The Contractor submits the Brand page for review and turns a My-catalog product (with a
    // GLB and a photo) on for it. Setup is the API; the page submit and the switch are the UI.
    name: 'int-brand-1-contractor-publishes',
    as: 'contractor',
    setup: async ({ api }) => {
      const me = api.as('contractor');
      must(await me.put('/api/pro/profile', COMPANY), 'Saving the company');
      const modelFileId = await uploadModel(me);
      const photo = await uploadImage(me);
      const made = must(
        await me.post('/api/pro/products', { spec: cabinetSpec({ modelFileId, imageFileIds: [photo] }), cost: { costCents: COST_CENTS } }),
        'Creating the My-catalog product',
      );
      brand.productId = made.product.id;
      brand.modelFileId = modelFileId;
      // The page is made from the company (name, phone, website) and submitted by the UI below.
      const state = must(await me.put('/api/pro/brand', { tagline: 'Walnut and maple cabinetry, built in Hamilton', about: 'Family shop. Made to order.' }), 'Setting up the page');
      brand.slug = state.brand.slug;
      brand.name = state.brand.name;
      return { path: '#/pro/brand/settings' };
    },
    waitFor: ['.brand-settings'],
    expectText: ['From your company profile', 'Price on request'],
    check: async (h) => {
      await noSideScroll(h);
      // 1. Submit the page for review.
      await h.click(await mark(h, 'button', 'submit for review', 'submit'));
      await until(h, async () => (await (await fetch('/api/pro/brand', { credentials: 'same-origin' })).json()).brand?.pageStatus === 'in_review', null, 10_000, 'the page to be in review');
      // 2. Turn the product on for the page (Brand page > Products).
      await h.goto('#/pro/brand/products');
      await h.waitFor('.brand-row');
      const label = `Show ${PRODUCT_NAME} on my brand page`;
      const clicked = await h.evaluate((l) => {
        const el = document.querySelector(`input[role="switch"][aria-label="${l}"]`);
        if (!el || el.disabled) return el ? 'disabled' : 'missing';
        el.click();
        return 'clicked';
      }, label);
      if (clicked !== 'clicked') throw new Error(`the product's publish switch is ${clicked}`);
      await h.waitForText('In review');
      const listed = must(await h.api.as('contractor').get('/api/pro/brand/products'), 'Reading the Brand page products').products.find((p) => p.id === brand.productId);
      if (listed?.listing?.status !== 'submitted') throw new Error(`after the switch the product is "${listed?.listing?.status}", expected "submitted"`);
      brand.copyId = listed.listing.copyId;
      if (!brand.copyId || brand.copyId === brand.productId) throw new Error('publishing made no separate public copy of the product');
      // Nothing is public before the admin says so.
      if ((await h.api.get(`/api/brands/by-slug/${brand.slug}`)).status !== 404) throw new Error('the page was public before approval');
      if ((await h.api.get(`/api/catalog/products/${brand.copyId}`)).status !== 404) throw new Error('the product was public before approval');
      await h.shot('submitted');
    },
  },
  {
    name: 'int-brand-2-admin-approves',
    path: '#/admin/moderation',
    as: 'admin',
    waitFor: ['.mod-page'],
    expectText: ['Brand pages waiting for review', 'Products waiting for review'],
    check: async (h) => {
      await noSideScroll(h);
      if (!brand.slug) throw new Error('int-brand-1-contractor-publishes must run first');
      // Approve the page (the card for this contractor, not the seeded one in the same queue).
      const marked = await h.evaluate((n) => {
        const card = [...document.querySelectorAll('.mod-page')].find((p) => p.textContent.includes(n));
        const btn = card && [...card.querySelectorAll('button')].find((b) => b.textContent.includes('Approve and verify'));
        btn?.setAttribute('data-qa', 'page-ok');
        return !!btn;
      }, brand.name);
      if (!marked) throw new Error(`"${brand.name}" has no Approve button in the brand pages queue`);
      await h.click('[data-qa="page-ok"]');
      await until(h, async (slug) => (await fetch(`/api/brands/by-slug/${slug}`, { credentials: 'same-origin' })).status === 200, brand.slug, 10_000, 'the page to go live');
      // Approve the product: pick it in the queue, then Approve in the detail pane.
      await h.waitFor('.mod-queue');
      await h.click(await mark(h, '.mod-queue li, .mod-queue [role="option"], .mod-queue button', PRODUCT_NAME, 'queue-item'));
      await h.waitFor('.mod-detail');
      await h.waitForText('GLB report');
      await h.click(await mark(h, '.mod-detail .mod-actions button', 'Approve', 'prod-ok'));
      await until(h, async (id) => (await fetch(`/api/catalog/products/${id}`, { credentials: 'same-origin' })).status === 200, brand.copyId, 10_000, 'the product to go live');
      await h.shot('approved');
    },
  },
  {
    // What a homeowner sees: the brand page, the public catalog and the product page, with the
    // GLB on the stage. No cost anywhere on the wires.
    name: 'int-brand-3-public',
    as: 'anon',
    setup: async () => {
      if (!brand.slug) throw new Error('int-brand-1-contractor-publishes must run first');
      return { path: `#/b/${brand.slug}` };
    },
    waitFor: ['.bp-card'],
    expectText: ['Verified contractor', PRODUCT_NAME, 'Try in my kitchen'],
    check: async (h) => {
      await noSideScroll(h);
      const page = must(await h.api.get(`/api/brands/by-slug/${brand.slug}`), 'The public page wire');
      assertNoCosts(page, 'the public page wire');
      if (!page.products?.some((p) => p.id === brand.copyId)) throw new Error('the product is not on the public page');
      const cat = must(await h.api.get('/api/catalog'), 'The public catalog');
      assertNoCosts(cat, 'the public catalog');
      const inCatalog = cat.products.find((p) => p.id === brand.copyId);
      if (!inCatalog) throw new Error('the product is not in the public catalog');
      if (inCatalog.brandSlug !== brand.slug) throw new Error(`the catalog lists it under "${inCatalog.brandSlug}", expected ${brand.slug}`);
      if (!inCatalog.model?.url) throw new Error('the public product has no 3D model');
      // The private source stays private: the contractor's own product is not a public product.
      if ((await h.api.get(`/api/catalog/products/${brand.productId}`)).status === 200) throw new Error('the contractor\'s private My-catalog product is public');
      // The model file is public now (it was private before the approval).
      const glb = await h.api.get(inCatalog.model.url.replace(/^https?:\/\/[^/]+/, ''));
      if (glb.status !== 200) throw new Error(`the approved model file answers ${glb.status}`);
      await h.shot('brand-page');
      // The product page: the stage draws the GLB, not the procedural stand-in.
      await h.goto(`#/p/${brand.copyId}`);
      await h.waitFor('.product-stage[data-ready="1"] canvas');
      await h.waitForText([PRODUCT_NAME, 'Request a quote']);
      const fit = await h.evaluate(() => {
        let g = null;
        window.__blumodelQa.stage.get().scene.traverse((o) => {
          if (!g && o.userData?.gltf) g = o;
        });
        return !!g;
      });
      if (!fit) throw new Error('the GLB did not load on the product stage (the procedural fallback is showing)');
      await h.shot('product-page');
    },
  },
  {
    // A homeowner adds the brand's product to a kitchen: the GLB is in the 3D room at its size.
    name: 'int-brand-4-renders-in-a-kitchen',
    as: 'customer',
    setup: async ({ me }) => {
      if (!brand.copyId) throw new Error('int-brand-1-contractor-publishes must run first');
      const k = await newKitchen(me, 'QA Integration Kitchen');
      return { path: `#/k/${k.id}?add=${brand.copyId}`, projectId: k.id };
    },
    waitFor: ['.topbar'],
    check: async (h) => {
      await until(h, (id) => !!window.__blumodelQA?.store?.getState().doc.items.some((i) => i.productId === id), brand.copyId, 20_000, 'the ?add= product in the kitchen');
      await show3d(h);
      const box = await glbInRoom(h, brand.copyId, [24, 34.5, 24]);
      h.note(`room GLB ${box.size.join(' x ')} in (declared 24 x 34.5 x 24)`);
      await h.shot('room');
    },
  },
  {
    // An anonymous homeowner asks the contractor for a quote from the brand page.
    name: 'int-brand-5-lead',
    as: 'anon',
    setup: async () => {
      if (!brand.slug) throw new Error('int-brand-1-contractor-publishes must run first');
      return { path: `#/b/${brand.slug}` };
    },
    waitFor: ['.bp-card-actions'],
    check: async (h) => {
      await h.click(await mark(h, '.bp-card-actions button', 'Request a quote', 'quote'));
      await h.waitFor('.lead-modal');
      brand.leadName = `Ines Integration ${Date.now().toString(36)}`;
      await sendLead(h, { name: brand.leadName, email: 'ines.integration@example.test' });
      // The same visitor has no way to read the inbox.
      const peek = await h.api.get('/api/pro/brand/leads');
      if (peek.status !== 401 && peek.status !== 403) throw new Error(`an anonymous visitor reading the leads got ${peek.status}`);
    },
  },
  {
    // Only that contractor's inbox has the lead: the contractor sees it; the demo contractor, a
    // homeowner, the studio and the admin do not.
    name: 'int-brand-6-lead-only-in-that-inbox',
    path: '#/pro/brand/leads',
    as: 'contractor',
    waitFor: ['.brand-lead'],
    check: async (h) => {
      if (!brand.leadName) throw new Error('int-brand-5-lead must run first');
      await h.waitForText(brand.leadName);
      const mine = must(await h.api.as('contractor').get('/api/pro/brand/leads'), 'Reading my leads');
      const lead = mine.leads.find((l) => l.name === brand.leadName);
      if (!lead) throw new Error('the lead is not in the contractor\'s inbox');
      if (lead.status !== 'new') throw new Error(`a new lead has status "${lead.status}"`);
      if (lead.productName !== PRODUCT_NAME) throw new Error(`the lead came from "${lead.productName}", expected "${PRODUCT_NAME}"`);
      // Everyone else: not theirs.
      const demo = must(await h.api.as('brand').get('/api/pro/brand/leads'), 'Reading the demo contractor\'s leads');
      if (demo.leads.some((l) => l.name === brand.leadName)) throw new Error('the lead is in ANOTHER contractor\'s inbox');
      for (const role of ['customer', 'studio', 'admin']) {
        const r = await h.api.as(role).get('/api/pro/brand/leads');
        if (r.status !== 403 && r.status !== 401) throw new Error(`${role} can read the leads inbox (${r.status})`);
      }
      // Admin sees counts only, never the contents.
      const adminBrands = await h.api.as('admin').get('/api/admin/brands');
      if (JSON.stringify(adminBrands.body).includes(brand.leadName)) throw new Error('the lead\'s contents are in Admin > Brands');
      await h.shot('inbox');
    },
  },
  {
    // The other contractor's screen: the lead is not there.
    name: 'int-brand-6b-demo-contractor-inbox-lacks-it',
    path: '#/pro/brand/leads',
    as: 'brand',
    waitFor: ['.brand-lead'],
    check: async (h) => {
      if (!brand.leadName) throw new Error('int-brand-5-lead must run first');
      const text = await h.evaluate(() => document.body.innerText);
      if (text.includes(brand.leadName)) throw new Error('the lead shows in another contractor\'s Leads inbox');
    },
  },

  // ─── copy ──────────────────────────────────────────────────────────────────
  {
    // A homeowner: no brand-portal entry point anywhere, and the way in is a photo.
    name: 'int-copy-customer',
    path: '#/',
    as: 'customer',
    waitFor: ['.home-main'],
    expectText: ['Start from a photo'],
    check: async (h) => {
      await assertCopy(h, 'Home');
      // The account menu: For contractors, never List your products / Brand portal.
      await h.click('.home-bar .menu-wrap > button, .home-bar [aria-haspopup]');
      await h.waitFor('.menu[role="menu"]');
      await h.waitForText('For contractors');
      await assertCopy(h, 'the account menu');
      const items = await h.evaluate(() => [...document.querySelectorAll('.menu [role="menuitem"]')].map((b) => b.textContent.trim().replace(/\s+/g, ' ')));
      h.note(`account menu: ${items.join(' | ')}`);
      await h.key('Escape');
      for (const hash of ['#/new', '#/generate', '#/pricing', '#/welcome', '#/orders', '#/account/billing', '#/pro']) {
        await h.goto(hash);
        await h.sleep(900);
        await assertCopy(h, hash);
      }
      // The old portal address goes to the Contractor plan pitch, not to a brand sign-up.
      await h.goto('#/brand/join');
      await h.waitFor('.pro-pitch-brand');
      await assertCopy(h, '#/brand/join');
    },
  },
  {
    name: 'int-copy-anon',
    path: '#/',
    as: 'anon',
    waitFor: ['a[href="#/signin"]'],
    expectText: ['Start from a photo'],
    check: async (h) => {
      await assertCopy(h, 'the landing page');
      await h.goto('#/pricing');
      await h.sleep(900);
      await assertCopy(h, 'the pricing page');
    },
  },
  {
    // Signed in, the Home call to action is Start from a photo and it opens the photo screen.
    name: 'int-home-start-from-a-photo',
    path: '#/',
    as: 'customer',
    waitFor: ['.home-cta'],
    check: async (h) => {
      await h.click(await mark(h, '.home-cta button', 'Start from a photo', 'cta'));
      await h.waitUntil(() => location.hash.startsWith('#/generate'), 8000, '#/generate');
      await h.waitForText('Start from a photo of your kitchen');
    },
  },

  {
    // BRAND_PAGE §5: a contractor's live products sit in everyone's catalog under their company with
    // a "by <company>" line; a BluModel-curated partner brand shows its plain name.
    name: 'int-catalog-by-company',
    path: '#/local',
    as: 'anon',
    waitFor: ['.topbar', 'input[placeholder^="Search"]'],
    check: async (h) => {
      await h.click('input[placeholder^="Search"]');
      await h.type('Slab Wall');
      await h.waitForText('Slab Wall Cabinet');
      const metas = () =>
        h.evaluate(() => [...document.querySelectorAll('.product-card')].map((c) => ({ name: c.querySelector('.product-name')?.textContent?.trim(), brand: c.querySelector('.product-meta span')?.textContent?.trim() })));
      const slab = (await metas()).find((c) => c.name === 'Slab Wall Cabinet');
      if (!slab) throw new Error('the demo contractor’s Slab Wall Cabinet is not in the catalog');
      if (slab.brand !== 'by Alder & Pine Cabinetry (Demo)') throw new Error(`a contractor’s product shows “${slab.brand}”, not “by Alder & Pine Cabinetry (Demo)”`);
      await h.shot('contractor');
      // A partner brand: no “by”.
      await h.evaluate(() => {
        const input = document.querySelector('input[placeholder^="Search"]');
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(input, 'Harrier');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await h.waitForText('Harrier 36″ Dual-Fuel Range');
      const range = (await metas()).find((c) => c.name === 'Harrier 36″ Dual-Fuel Range');
      if (range?.brand !== 'Kestrel & Finch Appliances (Demo)') throw new Error(`a partner brand’s product shows “${range?.brand}”`);
    },
  },

  // ─── photo ─────────────────────────────────────────────────────────────────
  {
    // Photo -> Check the space (the manual form: the QA server has no model key) -> Build my
    // kitchen -> the editor, with the photo reference mounted and the photo attached.
    name: 'int-photo-to-editor',
    as: 'customer',
    setup: async ({ api }) => {
      const up = await api.as('customer').putRaw('/api/files?kind=reference&name=qa-kitchen.png', kitchenPhoto(), 'image/png');
      const id = must(up, 'Uploading the fixture photo').file.id;
      brand.photoId = id;
      return { path: `#/generate?qaPhotos=${id}&qaStep=space` };
    },
    waitFor: ['.gen-form', '.gen-footer .gen-go'],
    expectText: ['Check the space'],
    waitMs: 500,
    check: async (h) => {
      await noSideScroll(h);
      await assertCopy(h, 'Start from a photo');
      await h.click('.gen-footer .gen-go');
      await h.waitUntil(() => /^#\/k\//.test(location.hash), 25_000, 'the editor after Build my kitchen');
      const id = await h.evaluate(() => location.hash.slice(4).split('?')[0]);
      await h.waitFor('.topbar');
      await h.waitFor('.photo-ref, .photo-ref-pill');
      const photos = must(await h.api.as('customer').get(`/api/generate/photos/${id}`), 'Reading the kitchen\'s photos');
      if (!photos.files?.some((f) => f.id === brand.photoId)) throw new Error('the photo was not attached to the new kitchen');
      const items = await h.evaluate(() => window.__blumodelQA.store.getState().doc.items.length);
      if (items < 5) throw new Error(`the built kitchen has only ${items} pieces`);
      // A signed-in kitchen survives a reload with its photo reference.
      await h.reload();
      await h.waitFor('.photo-ref, .photo-ref-pill');
      await h.shot('editor');
    },
  },

  // ─── order ─────────────────────────────────────────────────────────────────
  {
    // A custom model, end to end through the API: demo payment, the studio delivers a GLB, and only
    // the buyer can see it. Then it goes into a kitchen and a share link of that kitchen serves it.
    name: 'int-order-custom-model',
    path: '#/orders',
    as: 'customer',
    waitFor: ['#root *'],
    check: async (h) => {
      const me = h.api.as('customer');
      const studio = h.api.as('studio');
      order.name = `Integration Farm Sink ${Date.now().toString(36)} (QA)`;
      const created = must(
        await me.post('/api/orders', {
          target: 'customer',
          items: [{ tier: 'simple', extraFinishes: 0, brief: { productTypeId: 'sink-farmhouse', kind: 'sink', variant: 'farmhouse', name: order.name, widthIn: 33, depthIn: 22, heightIn: 36, notes: 'integration', referenceFileIds: [], refProductId: 'sink-farm' } }],
        }),
        'Creating the order',
      );
      order.id = created.order.id;
      must(await me.post(`/api/orders/${order.id}/checkout`, {}), 'Starting the checkout');
      const paid = must(await me.post(`/api/payments/demo/${order.id}/complete`, { outcome: 'success' }), 'Completing the demo payment');
      if (paid.order?.status !== 'paid') throw new Error(`after the demo payment the order is "${paid.order?.status}"`);

      // The studio starts and delivers.
      must(await studio.post(`/api/studio/orders/${order.id}/start`, {}), 'Starting the order');
      const IN = 0.0254;
      const m = must(await studio.putRaw('/api/files?kind=model&name=sink.glb', makeGlb({ w: 33 * IN, h: 36 * IN, d: 22 * IN }), 'model/gltf-binary'), 'Uploading the delivered GLB');
      const t = must(await studio.putRaw('/api/files?kind=image&name=sink.png', makePng({ rgba: [200, 205, 210, 255] }), 'image/png'), 'Uploading the thumbnail');
      const delivered = must(await studio.post(`/api/studio/orders/${order.id}/deliver`, { item: 0, modelFileId: m.file.id, thumbFileId: t.file.id }), 'Delivering');
      if (delivered.order?.status !== 'delivered') throw new Error(`after delivery the order is "${delivered.order?.status}"`);
      const detail = must(await me.get(`/api/orders/${order.id}`), 'Reading the order');
      order.productId = detail.deliverables?.[0]?.id;
      if (!order.productId) throw new Error('the order has no deliverable');

      // Only the buyer sees the model: catalog, product page and its files.
      const mine = must(await me.get('/api/catalog'), 'The buyer\'s catalog');
      const product = mine.products.find((p) => p.id === order.productId);
      if (!product) throw new Error('the delivered model is not in the buyer\'s catalog');
      order.modelUrl = product.model?.url;
      if (!order.modelUrl) throw new Error('the delivered product has no model URL');
      const filePath = order.modelUrl.replace(/^https?:\/\/[^/]+/, '');
      if ((await me.get(filePath)).status !== 200) throw new Error('the buyer cannot fetch their own model');
      for (const role of ['anon', 'brand', 'contractor', 'studio', 'admin']) {
        const who = role === 'anon' ? h.api : h.api.as(role);
        const cat = must(await who.get('/api/catalog'), `${role}'s catalog`);
        if (cat.products.some((p) => p.id === order.productId)) throw new Error(`the private model is in ${role}'s catalog`);
        const direct = await who.get(`/api/catalog/products/${order.productId}`);
        if (direct.status === 200) throw new Error(`the private model's product page is readable by ${role}`);
        // Studio and admin staff may read any private file (server/files/policy.mjs); nobody else may.
        const file = await who.get(filePath);
        if (file.status === 200 && role !== 'studio' && role !== 'admin') throw new Error(`the private model's GLB is readable by ${role} (${file.status})`);
      }

      // The buyer places it in a kitchen and shares it.
      const kitchen = await newKitchen(me, 'QA Custom Model Kitchen', [{ id: 'i-custom', productId: order.productId, x: 110, y: 12, rotation: 0, finishIndex: 0 }]);
      order.kitchenId = kitchen.id;
      const link = must(await me.post(`/api/projects/${kitchen.id}/shares`, { label: 'Integration', showPrices: true }), 'Sharing the kitchen').share;
      order.token = link.token;
      const shared = must(await h.api.get(`/api/share/${link.token}`), 'Reading the share as a stranger');
      const sp = shared.products.find((p) => p.id === order.productId);
      if (!sp) throw new Error('the shared kitchen leaves out the custom model');
      if (!sp.model?.url) throw new Error('the shared custom model has no model URL');
      const viaShare = await h.api.get(sp.model.url.replace(/^https?:\/\/[^/]+/, ''));
      if (viaShare.status !== 200) throw new Error(`the share link does not serve the custom model's GLB (${viaShare.status})`);
      // ...but only through the link: the plain URL stays closed to strangers.
      const plain = await h.api.get(filePath);
      if (plain.status === 200) throw new Error('the custom model\'s GLB is open to strangers without the share token');
      const revoked = must(await me.get(`/api/projects/${kitchen.id}/shares`), 'Listing the links').shares[0];
      order.shareId = revoked.id;

      // The order page: the buyer sees the delivery.
      await h.goto(`#/orders/${order.id}`);
      await h.waitFor('.ord-deliverable');
      await h.waitForText(['Your model', 'Accept the model']);
      await h.shot('delivered');
    },
  },
  {
    // The stranger's view of the share: the custom model is drawn in 3D (its GLB, not a stand-in).
    name: 'int-order-shared-kitchen-shows-it',
    as: 'anon',
    setup: async () => {
      if (!order.token) throw new Error('int-order-custom-model must run first');
      return { path: `#/s/${order.token}` };
    },
    waitFor: ['.share-bar', '.plan-view canvas'],
    waitMs: 800,
    check: async (h) => {
      await show3d(h);
      const box = await glbInRoom(h, order.productId, [33, 36, 22]);
      h.note(`shared room GLB ${box.size.join(' x ')} in`);
      await h.shot('shared-3d');
    },
  },

  // ─── contractor share ──────────────────────────────────────────────────────
  {
    // The contractor's client opens the shared kitchen: Prepared by, the contractor's sell
    // prices, and nothing of the contractor's cost. No Export, no Duplicate, no client name.
    name: 'int-contractor-share-no-costs',
    as: 'anon',
    setup: async ({ api }) => {
      if (!brand.productId) throw new Error('int-brand-1-contractor-publishes must run first');
      const pro = api.as('contractor');
      const k = await newKitchen(pro, 'Okafor Kitchen (QA)', [{ id: 'i-mine', productId: brand.productId, x: 110, y: 12, rotation: 0, finishIndex: 0 }], { client: 'J. Okafor (QA client)' });
      const link = must(await pro.post(`/api/projects/${k.id}/shares`, { label: 'For the Okafors', showPrices: true }), 'Sharing').share;
      brand.shareToken = link.token;
      return { path: `#/s/${link.token}` };
    },
    waitFor: ['.share-bar.share-bar--pro', '.plan-view canvas'],
    expectText: ['Prepared by', COMPANY.company, 'Okafor Kitchen (QA)'],
    waitMs: 1200,
    check: async (h) => {
      // The wire: sell prices for the product, no cost, no client.
      const wire = must(await h.api.get(`/api/share/${brand.shareToken}`), 'The share wire');
      assertNoCosts(wire, 'the contractor share wire');
      if (JSON.stringify(wire).includes('J. Okafor')) throw new Error('the client\'s name is in the share wire');
      const price = wire.prices?.[brand.productId]?.price;
      if (!(price > COST_CENTS / 100)) throw new Error(`the share carries a sell price of ${price} for a product costing ${COST_CENTS / 100}`);
      if (wire.preparedBy?.company !== COMPANY.company) throw new Error(`preparedBy is ${JSON.stringify(wire.preparedBy)}`);
      if (!wire.hideDuplicate) throw new Error('a contractor share offers Duplicate');
      // The screen: sell prices on, cost words and numbers off, no Export, no Duplicate.
      const text = (await h.evaluate(() => document.body.innerText)).toLowerCase();
      for (const n of COST_TEXT) if (text.includes(n)) throw new Error(`the contractor's cost (${n}) is on the client's screen`);
      if (/\bcost\b|\bmargin\b|\bmarkup\b/.test(text)) throw new Error('cost, margin or markup is on the contractor share');
      if (text.includes('j. okafor')) throw new Error('the client name is on the shared page');
      if (text.includes('duplicate')) throw new Error('a contractor share offers Duplicate');
      const exportBtn = await h.evaluate(() => !!document.querySelector('.topbar .export-btn, .topbar .menu-wrap > .btn.primary'));
      if (exportBtn) throw new Error('a contractor share offers Export');
      if (!/\$\s?\d/.test(text)) throw new Error('no sell price is shown');
      // Open the Estimate to be sure the totals are sell prices too.
      await h.evaluate(() => window.__blumodelQA.store.getState().setUI({ rightTab: 'estimate' }));
      await h.sleep(500);
      const est = (await h.evaluate(() => document.body.innerText)).toLowerCase();
      for (const n of COST_TEXT) if (est.includes(n)) throw new Error(`the contractor's cost (${n}) is in the client's estimate`);
      await h.shot('estimate');
    },
  },
  {
    name: 'int-contractor-share-phone',
    as: 'anon',
    viewport: PHONE,
    setup: async () => {
      if (!brand.shareToken) throw new Error('int-contractor-share-no-costs must run first');
      return { path: `#/s/${brand.shareToken}` };
    },
    waitFor: ['.share-bar.share-bar--pro'],
    expectText: ['Prepared by', 'Contact'],
    waitMs: 1500,
    check: noSideScroll,
  },

  // ─── export ────────────────────────────────────────────────────────────────
  {
    // A free user: Export -> the Unlock dialog -> $5 unlock (demo checkout) -> back in the kitchen
    // the export they asked for runs by itself.
    name: 'int-free-export-unlock-runs',
    as: 'fresh',
    setup: async ({ me }) => {
      const k = await newKitchen(me, 'QA Unlock Kitchen');
      return { path: `#/k/${k.id}`, projectId: k.id };
    },
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      const before = await h.me.post(`/api/projects/${h.data.projectId}/exports`, { kind: 'csv' });
      if (before.status !== 403) throw new Error(`a free user's export answers ${before.status} before paying, expected 403`);
      const compact = await h.evaluate(() => !!document.querySelector('.export-btn'));
      await h.click(compact ? '.export-btn' : '.topbar .menu-wrap > .btn.primary');
      await h.waitFor('.topbar .menu[role="menu"]');
      await h.click(await mark(h, '.topbar .menu [role="menuitem"]', 'Shopping list', 'csv'));
      await h.waitFor('.modal.unlock[role="dialog"]');
      await h.waitForText(['Unlock “QA Unlock Kitchen”', 'Unlock this kitchen · $5']);
      await h.click(await mark(h, '.modal.unlock button', 'Unlock this kitchen', 'unlock'));
      await h.waitUntil(() => location.hash.startsWith('#/pay/'), 10_000, 'the demo checkout');
      await h.waitForText(['DEMO PAYMENT', 'BluModel Studio never sees or stores card details']);
      const cardish = await h.evaluate(() => [...document.querySelectorAll('input')].filter((i) => /card|cc-|cvc|cvv|expir/i.test(`${i.name} ${i.id} ${i.autocomplete} ${i.placeholder}`)).length);
      if (cardish) throw new Error(`${cardish} card-like field(s) on the demo checkout`);
      await h.click('.demo-pay-actions .btn.primary');
      // Back in the kitchen, the export finishes by itself.
      await h.waitUntil(() => /^#\/k\//.test(location.hash), 20_000, 'returning to the kitchen');
      await h.waitForText('Shopping list saved as CSV.', 25_000);
      const after = await h.me.post(`/api/projects/${h.data.projectId}/exports`, { kind: 'csv' });
      if (after.status !== 200) throw new Error(`after unlocking, the export answers ${after.status}`);
      // Unlocking one kitchen does not unlock another.
      const other = await newKitchen(h.me, 'QA Other Kitchen');
      const r = await h.me.post(`/api/projects/${other.id}/exports`, { kind: 'csv' });
      if (r.status !== 403) throw new Error(`a second kitchen exports without being unlocked (${r.status})`);
      await h.shot('exported');
    },
  },
];
