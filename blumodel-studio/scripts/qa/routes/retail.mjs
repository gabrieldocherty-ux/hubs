// The real-retailer catalog's QA routes: the catalog panel's store chips and brand/store filters
// (with click-to-add, pointer-drag and phone tap-to-place still working on a retail product), the
// product page's "Where to buy" (sponsored first, the affiliate parameter, rel, the disclaimer, an
// anonymous click count), Admin > Retailers (admin only, audited), the wizard's brand list API, and
// the store faucets, pulls and knobs in Room & finishes (every drawn style, up close in 3D).
// Run: node scripts/qa.mjs --pkg retail --port 8875 --dist .build/retail --strict-external
//
// Nothing here follows a store link: the runner fails a route on any request to a non-local host,
// so a link-out is checked by its href and counted with its navigation cancelled.

import fs from 'node:fs';

const RETAIL = JSON.parse(fs.readFileSync(new URL('../../../src/data/retail.json', import.meta.url), 'utf8'));
const byId = (id) => {
  const p = RETAIL.products.find((x) => x.id === id);
  if (!p) throw new Error(`${id} is not in src/data/retail.json any more; pick another product for this route`);
  return p;
};
/** Sold at Best Buy, Home Depot and RONA, with two checked prices (Best Buy's is the lowest). */
const RANGE = 'r-samsung-ne63a6511ss';
/** A RONA cabinet line ("Landon & Co"), for the catalog filters and the drags. */
const RONA_CABINET = RETAIL.products.find((p) => p.category === 'cabinets' && p.brand === 'Landon & Co' && p.retail.stores.some((l) => l.store === 'rona'));
/** "Oct 15, 2026": the date a product's listing was checked (each research round has its own). */
const checkedOn = (p) => new Date(`${p.retail.checkedAt}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

const EMPTY_DOC = { name: 'QA Retail Kitchen', room: { widthIn: 168, lengthIn: 144, ceilingIn: 96 }, surfaces: {}, items: [], version: 2 };

/** No horizontal page scroll. */
async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

/** Sets a React-controlled <select> (CDP can't drive the native popup). */
async function pick({ evaluate }, selector, value) {
  const ok = await evaluate(
    (sel, v) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value === v;
    },
    selector,
    value,
  );
  if (!ok) throw new Error(`could not choose ${value} in ${selector}`);
}

/** A finger tap whose events carry their own times (see move.mjs: a busy renderer must not turn it into a hold). */
async function tap(h, selector) {
  const r = await h.rectOf(selector, { scroll: true });
  if (!(r.w > 0 && r.h > 0)) throw new Error(`tap: ${selector} has no size (hidden?)`);
  const t = Date.now() / 1000;
  await h.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.cx, y: r.cy, id: 1 }], timestamp: t });
  await h.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t + 0.06 });
}

/** The open editor with an empty room, so a drop lands on clear floor. */
async function emptyKitchen(h) {
  await h.waitUntil(() => !!window.__blumodel?.store, 15_000, 'window.__blumodel (the ?qa hook)');
  await h.evaluate((doc) => {
    const s = window.__blumodel.store.getState();
    s.loadDoc(doc);
    s.setUI({ viewMode: 'plan' });
  }, EMPTY_DOC);
  await h.waitFor('.plan-view canvas');
  await h.sleep(400);
}

const items = (h) => h.evaluate(() => window.__blumodel.store.getState().doc.items.map((i) => i.productId));

/** The visible catalog cards: product id, brand line and store chips. */
const cards = (h, scope) =>
  h.evaluate(
    (sc) =>
      [...document.querySelectorAll(`${sc} .product-card`)].map((c) => ({
        id: c.dataset.product,
        brand: c.querySelector('.product-meta span')?.textContent?.trim() ?? '',
        chips: [...c.querySelectorAll('.store-chip')].map((x) => x.textContent.trim()),
        title: c.querySelector('.product-stores')?.getAttribute('title') ?? '',
      })),
    scope,
  );

const options = (h, sel) => h.evaluate((s) => [...(document.querySelector(s)?.options ?? [])].map((o) => ({ value: o.value, text: o.textContent.trim() })), sel);

/** Store settings straight through the admin API (and back to plain at the end of a route). */
async function setStore(api, slug, body) {
  const r = await api.as('admin').patch(`/api/admin/retailers/${slug}`, body);
  if (r.status !== 200) throw new Error(`PATCH /api/admin/retailers/${slug} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.retailer;
}

/** The Where to buy rows as shown. */
const buyRows = (h) =>
  h.evaluate(() =>
    [...document.querySelectorAll('.pp-buy-row')].map((li) => {
      const a = li.querySelector('a.pp-buy-link');
      return {
        store: li.dataset.store,
        sponsored: !!li.querySelector('.pp-buy-sponsored'),
        text: li.textContent.replace(/\s+/g, ' ').trim(),
        href: a?.href ?? '',
        rel: a?.getAttribute('rel') ?? '',
        target: a?.getAttribute('target') ?? '',
      };
    }),
  );

// ── Faucets, pulls and knobs (the retail `fixtures`, chosen in Room & finishes) ──

const FIX = RETAIL.fixtures ?? [];
const fixture = (test, what) => {
  const f = FIX.find(test);
  if (!f) throw new Error(`no ${what} in src/data/retail.json fixtures; pick another for this route`);
  return f;
};
/** One of each drawn shape, so the screenshots show every style up close. */
const LOOKS = [
  { name: 'bar-spring', pull: fixture((f) => f.style === 'bar' && f.sizeIn.cc > 5, 'a 128 mm bar pull'), faucet: fixture((f) => f.style === 'spring', 'a coil-spring faucet') },
  { name: 'knob-pulldown', pull: fixture((f) => f.style === 'mushroom', 'a turned knob'), faucet: fixture((f) => f.style === 'pulldown' && f.extras?.soap, 'a pull-down faucet with a soap pump') },
  { name: 'arch-pullout', pull: fixture((f) => f.style === 'arch' && f.finish.name.toLowerCase().includes('black'), 'a black arched pull'), faucet: fixture((f) => f.style === 'pullout', 'a pull-out faucet') },
  { name: 'rect-sidespray', pull: fixture((f) => f.style === 'rect', 'a rectangular pull'), faucet: fixture((f) => f.style === 'side-spray', 'a faucet with a side spray') },
];
const FIXTURE_DOC = {
  name: 'QA Fixtures Kitchen',
  room: { widthIn: 120, lengthIn: 120, ceilingIn: 96 },
  surfaces: { cabinetFinishId: 'navy', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'calacatta', backsplashId: 'zellige-white', flooringId: 'oak-natural', paintId: 'chalk' },
  items: [
    { id: 'b1', productId: 'drawer-base', x: 15, y: 12, rotation: 0, finishIndex: 0, widthIn: 30 },
    { id: 's1', productId: 'sink-under', x: 46.5, y: 12, rotation: 0, finishIndex: 0, widthIn: 33 },
    { id: 'b2', productId: 'base', x: 78, y: 12, rotation: 0, finishIndex: 0, widthIn: 30 },
    { id: 'w1', productId: 'wall', x: 78, y: 6, rotation: 0, finishIndex: 0, widthIn: 30 },
  ],
  version: 2,
};
const HW_SELECT = 'select[aria-label="Cabinet pulls and knobs from stores"]';
const FAUCET_SELECT = 'select[aria-label="Faucet on every sink"]';

/** The editor with the fixtures kitchen and Room & finishes open. */
async function fixturesKitchen(h, { phone = false } = {}) {
  await h.waitUntil(() => !!window.__blumodel?.store, 15_000, 'window.__blumodel (the ?qa hook)');
  await h.evaluate((doc) => {
    const s = window.__blumodel.store.getState();
    s.loadDoc(doc);
    s.setUI({ viewMode: 'plan', leftTab: 'room' });
  }, FIXTURE_DOC);
  if (phone) {
    await tap(h, '.mbar-actions button[aria-label="Room and finishes"]');
    await h.waitFor('.sheet.is-open', 5000);
  }
  await h.waitFor(HW_SELECT, 15_000);
  await h.waitUntil(() => document.querySelectorAll('select[aria-label="Cabinet pulls and knobs from stores"] option').length > 20, 15_000, 'the store hardware list');
}

/** Camera views (feet): the sink run, the faucet (sink centre 3.875 ft east, deck at 3 ft), the 30″ base's door and drawer. */
const VIEWS = {
  run: { pos: [6.4, 4.6, 6.2], target: [4.0, 2.3, 1.0] },
  faucet: { pos: [5.0, 4.5, 3.3], target: [3.875, 3.75, 0.3] },
  pulls: { pos: [7.3, 2.75, 4.0], target: [6.4, 2.15, 2.0] },
};

/** A close look at the sink run in 3D: feet, the room's north-west corner at the origin. */
async function closeUp(h, at) {
  await h.evaluate(() => {
    const s = window.__blumodel.store.getState();
    s.select(null);
    s.setUI({ viewMode: '3d' });
  });
  await h.waitUntil(() => window.__blumodelQa?.canvas === 'room' && (window.__blumodelQa?.frames ?? 0) > 0, 25_000, 'the room canvas drawing');
  await h.waitUntil(() => !!window.__blumodelQA?.controls, 10_000, 'the 3D camera controls');
  await h.evaluate((v) => {
    const { camera, controls } = window.__blumodelQA;
    camera.position.set(...v.pos);
    controls.target.set(...v.target);
    controls.update();
    controls.dispatchEvent?.({ type: 'change' });
  }, at);
  await h.sleep(1500);
}

const fixtureRoutes = [
  {
    name: 'retail-fixtures-desktop',
    path: '#/local',
    as: 'anon',
    waitFor: ['.topbar', '.left-panel'],
    timeoutMs: 90_000,
    check: async (h) => {
      await fixturesKitchen(h);
      const hwOpts = await options(h, HW_SELECT);
      const faucetOpts = await options(h, FAUCET_SELECT);
      const pulls = FIX.filter((f) => f.kind !== 'faucet').length;
      const faucets = FIX.filter((f) => f.kind === 'faucet').length;
      h.note(`store hardware: ${hwOpts.length - 1} options (data ${pulls}); faucets: ${faucetOpts.length - 1} (data ${faucets})`);
      if (hwOpts.length - 1 !== pulls || faucetOpts.length - 1 !== faucets) throw new Error('the pickers do not list every fixture');
      if (await h.evaluate(() => !!document.querySelector('.fixture-chosen'))) throw new Error('a store fixture shows as chosen in a kitchen with the built-in hardware');

      for (const look of LOOKS) {
        await h.evaluate(() => window.__blumodel.store.getState().setUI({ viewMode: 'plan', leftTab: 'room' }));
        await h.waitFor(HW_SELECT, 8000);
        await pick(h, HW_SELECT, look.pull.id);
        await pick(h, FAUCET_SELECT, look.faucet.id);
        await h.sleep(250);
        const s = await h.evaluate(() => window.__blumodel.store.getState().doc.surfaces);
        if (s.hardwareId !== look.pull.id || s.faucetId !== look.faucet.id) throw new Error(`${look.name}: the surfaces read ${JSON.stringify(s)}`);
        const chosen = await h.evaluate(() => [...document.querySelectorAll('.fixture-chosen')].map((c) => ({ id: c.dataset.fixture, text: c.textContent.replace(/\s+/g, ' ').trim(), links: [...c.querySelectorAll('a')].map((a) => ({ href: a.href, rel: a.rel, text: a.textContent.trim() })) })));
        if (chosen.map((c) => c.id).join() !== `${look.pull.id},${look.faucet.id}`) throw new Error(`${look.name}: chosen cards ${JSON.stringify(chosen.map((c) => c.id))}`);
        for (const c of chosen) {
          if (!c.links.length || !c.links.every((l) => l.href.startsWith('https://') && l.rel === 'sponsored nofollow noopener' && /^View at /.test(l.text))) throw new Error(`${look.name}: ${c.id} store links ${JSON.stringify(c.links)}`);
        }
        await h.shot(`${look.name}-panel`);
        // 3D: the run, then close on the faucet, then close on a door and drawer's hardware.
        for (const [view, at] of Object.entries(VIEWS)) {
          await closeUp(h, at);
          await h.shot(`${look.name}-${view}`);
        }
      }

      const last = LOOKS.at(-1);
      // A link-out from Room & finishes is counted like the product page's.
      const before = h.api.sql('SELECT COALESCE(SUM(clicks), 0) AS n FROM retail_clicks WHERE product_id = ?', last.faucet.id)[0].n;
      await h.evaluate(() => window.__blumodel.store.getState().setUI({ viewMode: 'plan', leftTab: 'room' }));
      await h.waitFor(`.fixture-chosen[data-fixture="${last.faucet.id}"] a`, 8000);
      await h.evaluate((id) => {
        window.addEventListener('click', (e) => e.preventDefault(), { capture: true });
        document.querySelector(`.fixture-chosen[data-fixture="${id}"] a`).click();
      }, last.faucet.id);
      await h.sleep(800);
      const after = h.api.sql('SELECT COALESCE(SUM(clicks), 0) AS n FROM retail_clicks WHERE product_id = ?', last.faucet.id)[0].n;
      if (after !== before + 1) throw new Error(`the faucet link-out was counted ${after - before} times`);
      // Back to the sink's own faucet and a built-in finish: the cards go.
      await pick(h, FAUCET_SELECT, '');
      await h.click('.hardware .swatch[aria-label="Matte Black"]');
      await h.sleep(250);
      const back = await h.evaluate(() => window.__blumodel.store.getState().doc.surfaces);
      if (back.faucetId || back.hardwareId !== 'black') throw new Error(`back to built-ins: ${JSON.stringify(back)}`);
      if (await h.evaluate(() => document.querySelectorAll('.fixture-chosen').length)) throw new Error('a chosen card is still shown');
      await noSideScroll(h);
    },
  },
  {
    name: 'retail-fixtures-phone',
    path: '#/local',
    as: 'anon',
    viewport: 'phone',
    waitFor: ['.plan-view canvas', '.mbar-actions'],
    timeoutMs: 60_000,
    check: async (h) => {
      await fixturesKitchen(h, { phone: true });
      const look = LOOKS[1];
      await pick(h, `.sheet ${HW_SELECT}`, look.pull.id);
      await pick(h, `.sheet ${FAUCET_SELECT}`, look.faucet.id);
      await h.sleep(300);
      await h.evaluate(() => document.querySelector('.sheet .fixtures')?.scrollIntoView({ block: 'center' }));
      await h.sleep(300);
      const fit = await h.evaluate(() => [...document.querySelectorAll('.sheet .fixtures select, .sheet .fixture-chosen, .sheet .fixture-chosen a')].map((e) => e.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right })));
      if (!fit.length || fit.some((r) => r.l < 0 || r.r > 391)) throw new Error(`the store hardware and faucet pickers run off a phone screen: ${JSON.stringify(fit)}`);
      await h.shot('sheet');
      await noSideScroll(h);
    },
  },
];

// ── A product carrying a UPC (a delivered custom model) gets the matching retail listing's stores ──

/** A retail product with a UPC: the custom model below stands for it. */
const UPC_LISTED = RETAIL.products.find((p) => p.retail.upc);

const upcRoutes = [
  {
    name: 'retail-upc-where-to-buy',
    as: 'contractor',
    waitFor: ['.pp-buy-list:not([aria-busy]) .pp-buy-row'],
    expectText: ['Where to buy', 'Made by', `These stores list UPC ${UPC_LISTED.retail.upc}`],
    timeoutMs: 30_000,
    setup: async ({ api }) => {
      const me = api.as('contractor');
      const ok = (r, what) => {
        if (r.status >= 300) throw new Error(`${what} failed (${r.status}): ${JSON.stringify(r.body).slice(0, 200)}`);
        return r.body;
      };
      ok(await me.put('/api/pro/profile', { company: 'Quinn & Co. Kitchens (QA)', phone: '905-555-0164', serviceArea: 'Testville', defaultMarkupPct: 30 }), 'Saving the company');
      const made = ok(
        await me.post('/api/pro/products', {
          spec: {
            kind: UPC_LISTED.kind,
            ...(UPC_LISTED.variant ? { variant: UPC_LISTED.variant } : {}),
            category: UPC_LISTED.category,
            name: `${UPC_LISTED.brand} model (QA, by UPC)`,
            widthIn: UPC_LISTED.widthIn,
            depthIn: UPC_LISTED.depthIn,
            heightIn: UPC_LISTED.heightIn,
            elevationIn: UPC_LISTED.elevationIn,
            price: 0,
            finishes: [{ id: 'as-modelled', name: 'As modelled', hex: '#c4c8cb', material: 'metal' }],
            brand: UPC_LISTED.brand,
            upc: UPC_LISTED.retail.upc,
          },
        }),
        'Creating the product',
      );
      if (made.product.upc !== UPC_LISTED.retail.upc || made.product.productBrand !== UPC_LISTED.brand) throw new Error(`the product came back with ${JSON.stringify({ upc: made.product.upc, productBrand: made.product.productBrand })}`);
      return { path: `#/p/${made.product.id}`, data: { id: made.product.id } };
    },
    check: async (h) => {
      const rows = await buyRows(h);
      const want = [...new Set(UPC_LISTED.retail.stores.map((l) => l.store))];
      if (rows.map((r) => r.store).sort().join() !== want.sort().join()) throw new Error(`rows for ${rows.map((r) => r.store)}; the listing has ${want}`);
      const upcCell = await h.evaluate(() => [...document.querySelectorAll('.pp-specs tr')].find((tr) => tr.querySelector('th')?.textContent === 'UPC')?.querySelector('td')?.textContent ?? '');
      if (upcCell !== UPC_LISTED.retail.upc) throw new Error(`the UPC row reads "${upcCell}"`);
      // A click is counted against the retail listing (the server only counts real listings).
      const before = h.api.sql('SELECT COALESCE(SUM(clicks), 0) AS n FROM retail_clicks WHERE product_id = ?', UPC_LISTED.id)[0].n;
      await h.evaluate(() => {
        window.addEventListener('click', (e) => e.preventDefault(), { capture: true });
        document.querySelector('.pp-buy-row a.pp-buy-link').click();
      });
      await h.sleep(800);
      const after = h.api.sql('SELECT COALESCE(SUM(clicks), 0) AS n FROM retail_clicks WHERE product_id = ?', UPC_LISTED.id)[0].n;
      if (after !== before + 1) throw new Error(`the link-out was counted ${after - before} times against ${UPC_LISTED.id}`);
      await h.shot('linked');
      await noSideScroll(h);
    },
  },
];

export default [
  // ── Catalog panel ───────────────────────────────────────────────────────
  {
    name: 'retail-catalog-desktop',
    path: '#/local',
    as: 'anon',
    waitFor: ['.topbar', '.left-panel .product-card', '#catalog-store'],
    timeoutMs: 40_000,
    check: async (h) => {
      await emptyKitchen(h);
      const brands = await options(h, '#catalog-brand');
      const stores = await options(h, '#catalog-store');
      h.note(`brand filter: ${brands.length - 1} brands; store filter: ${stores.map((s) => s.text).join(', ')}`);
      if (brands[0]?.value !== 'all' || !brands[1]?.text.startsWith('BluModel Basics')) throw new Error(`the brand filter should start All brands, BluModel Basics: ${JSON.stringify(brands.slice(0, 3))}`);
      for (const b of ['IKEA', 'Samsung', 'Landon & Co']) if (!brands.some((o) => o.value === b)) throw new Error(`no ${b} in the brand filter`);
      for (const s of ['rona', 'home-depot', 'home-hardware', 'ikea', 'best-buy']) if (!stores.some((o) => o.value === s)) throw new Error(`no ${s} in the store filter`);
      const all = await cards(h, '.left-panel');
      const withChips = all.filter((c) => c.chips.length);
      if (withChips.length < 100) throw new Error(`only ${withChips.length} cards carry store chips`);
      if (!all.some((c) => c.id === 'base-30' || c.brand === 'BluModel Basics')) throw new Error('the BluModel Basics products are gone from the catalog');
      if (all.some((c) => !c.id.startsWith('r-') && c.chips.length)) throw new Error('a built-in product shows store chips');

      // At RONA: every card is a RONA listing and says so.
      await pick(h, '#catalog-store', 'rona');
      await h.sleep(200);
      const rona = await cards(h, '.left-panel');
      const want = RETAIL.products.filter((p) => p.retail.stores.some((l) => l.store === 'rona')).length;
      h.note(`At RONA: ${rona.length} products (the data lists ${want})`);
      if (rona.length !== want) throw new Error(`the RONA filter shows ${rona.length} products, the data lists ${want}`);
      if (!rona.every((c) => c.title.includes('RONA'))) throw new Error('a card under the RONA filter is not sold at RONA');
      // And one brand on top of it.
      await pick(h, '#catalog-brand', 'Landon & Co');
      await h.sleep(200);
      const landon = await cards(h, '.left-panel');
      if (!landon.length || !landon.every((c) => c.brand === 'Landon & Co' && c.chips[0] === 'RONA')) throw new Error(`Landon & Co at RONA: ${JSON.stringify(landon.slice(0, 3))}`);
      await h.shot('rona-landon');

      // Click to add still adds the real product.
      const card = `.left-panel .product-card[data-product="${RONA_CABINET.id}"]`;
      await h.waitFor(card, 4000);
      const n0 = (await items(h)).length;
      await h.click(card);
      await h.sleep(250);
      const afterClick = await items(h);
      if (afterClick.length !== n0 + 1 || afterClick.at(-1) !== RONA_CABINET.id) throw new Error(`clicking ${RONA_CABINET.id} added ${JSON.stringify(afterClick.slice(n0))}`);
      // And a pointer drag onto the plan places it too.
      const plan = await h.rectOf('.plan-view canvas');
      await h.mouseDrag(card, { x: plan.x + plan.w * 0.35, y: plan.y + plan.h * 0.6 }, { steps: 20 });
      await h.sleep(300);
      const afterDrag = await items(h);
      if (afterDrag.length !== n0 + 2 || afterDrag.at(-1) !== RONA_CABINET.id) throw new Error(`dragging ${RONA_CABINET.id} onto the plan gave ${JSON.stringify(afterDrag.slice(n0))}`);
      if (await h.evaluate(() => !!document.querySelector('.drag-ghost'))) throw new Error('the drag ghost is still up after the drop');
      await h.shot('placed');

      // Back to everything: the filters clear.
      await pick(h, '#catalog-store', 'all');
      await pick(h, '#catalog-brand', 'all');
      await h.sleep(200);
      if ((await cards(h, '.left-panel')).length !== all.length) throw new Error('clearing the filters did not bring every product back');
      await noSideScroll(h);
    },
  },
  {
    name: 'retail-catalog-phone',
    path: '#/local',
    as: 'anon',
    viewport: 'phone',
    waitFor: ['.plan-view canvas', '.mbar-actions'],
    timeoutMs: 40_000,
    check: async (h) => {
      await emptyKitchen(h);
      await tap(h, '.mbar-actions button[aria-label="Add products"]');
      await h.waitFor('.sheet--catalog.is-open', 5000);
      await h.waitFor('.sheet #catalog-store', 8000);
      await pick(h, '.sheet #catalog-store', 'home-depot');
      await h.sleep(300);
      const list = await cards(h, '.sheet');
      if (!list.length || !list.every((c) => c.title.includes('Home Depot'))) throw new Error(`the Home Depot filter on a phone: ${JSON.stringify(list.slice(0, 3))}`);
      // The two filters sit side by side on one line, inside the sheet.
      const fit = await h.evaluate(() => {
        const [a, b] = [...document.querySelectorAll('.sheet .catalog-filter')].map((x) => x.getBoundingClientRect());
        const sheet = document.querySelector('.sheet--catalog').getBoundingClientRect();
        return { aTop: a.top, bTop: b.top, right: b.right, sheet: sheet.right };
      });
      if (Math.abs(fit.aTop - fit.bTop) > 1 || fit.right > fit.sheet + 1) throw new Error(`the brand and store filters don't fit on one line on a phone: ${JSON.stringify(fit)}`);
      await h.shot('home-depot');
      // Tap to place: a tap arms the product and gets the sheet out of the way.
      const id = list[0].id;
      await tap(h, `.sheet .product-card[data-product="${id}"]`);
      await h.waitUntil(`() => window.__blumodel.placement.getState().armedProductId === ${JSON.stringify(id)}`, 4000, `${id} to be armed by the tap`);
      await h.sleep(500);
      const plan = await h.rectOf('.plan-view canvas');
      const t = Date.now() / 1000;
      const p = { x: plan.x + plan.w / 2, y: plan.y + plan.h / 2 };
      await h.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }], timestamp: t });
      await h.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t + 0.06 });
      await h.sleep(400);
      const placed = await items(h);
      if (placed.at(-1) !== id) throw new Error(`tapping the room after arming ${id} placed ${JSON.stringify(placed)}`);
      await noSideScroll(h);
    },
  },

  // ── Product page: Where to buy ──────────────────────────────────────────
  {
    name: 'retail-product-where-to-buy',
    as: 'anon',
    // The rows show once the store settings (sponsored first) have loaded: read them then.
    waitFor: ['.pp-buy-list:not([aria-busy]) .pp-buy-row'],
    expectText: ['Where to buy', 'Prices in CAD', 'Prices and availability change', 'confirm with the store'],
    timeoutMs: 30_000,
    setup: async ({ api }) => {
      // RONA sponsored with a tracking parameter; Home Depot plain.
      await setStore(api, 'rona', { sponsored: true, affiliate: 'aff=blumodel-qa' });
      await setStore(api, 'home-depot', { sponsored: false, affiliate: '' });
      return { path: `#/p/${RANGE}` };
    },
    check: async (h) => {
      const p = byId(RANGE);
      const rows = await buyRows(h);
      h.note(`rows: ${rows.map((r) => `${r.store}${r.sponsored ? ' (sponsored)' : ''}`).join(', ')}`);
      if (rows.length !== p.retail.stores.length) throw new Error(`${rows.length} rows for ${p.retail.stores.length} listings`);
      if (rows[0].store !== 'rona' || !rows[0].sponsored) throw new Error('the sponsored store (RONA) is not first with its label');
      if (rows.slice(1).some((r) => r.sponsored)) throw new Error('a store that is not sponsored says Sponsored');
      // After the sponsored one, the lowest checked price first.
      if (rows[1].store !== 'best-buy') throw new Error(`after RONA, Best Buy (lowest price) should come first, got ${rows[1].store}`);
      for (const r of rows) {
        if (r.rel !== 'sponsored nofollow noopener') throw new Error(`${r.store}: rel="${r.rel}"`);
        if (r.target !== '_blank') throw new Error(`${r.store}: target="${r.target}"`);
        if (!r.href.startsWith('https://')) throw new Error(`${r.store}: ${r.href}`);
        if (!r.text.includes(`checked ${checkedOn(p)}`)) throw new Error(`${r.store}: no "checked ${checkedOn(p)}" in "${r.text}"`);
      }
      const rona = new URL(rows[0].href);
      if (rona.searchParams.get('aff') !== 'blumodel-qa') throw new Error(`RONA's link has no affiliate parameter: ${rows[0].href}`);
      if (rows.slice(1).some((r) => new URL(r.href).searchParams.has('aff'))) throw new Error('a store with no parameter got one');
      if (!rows.find((r) => r.store === 'best-buy').text.includes('$1,024.99')) throw new Error('Best Buy\'s checked price is not shown in CAD');
      if (!rows.find((r) => r.store === 'home-depot').text.includes('Price not listed')) throw new Error('a listing with no price should say so');
      // The page's price: the lowest checked one, and where.
      const price = await h.evaluate(() => document.querySelector('.pp-price')?.textContent ?? '');
      if (!price.includes('$1,024.99') || !price.includes('Best Buy')) throw new Error(`the price block reads "${price}"`);

      // A link-out is counted (store + product, nothing else). The navigation itself is cancelled:
      // QA must not reach a real store.
      const before = h.api.sql('SELECT COALESCE(SUM(clicks), 0) AS n FROM retail_clicks WHERE store = ? AND product_id = ?', 'best-buy', RANGE)[0].n;
      await h.evaluate(() => {
        window.addEventListener('click', (e) => e.preventDefault(), { capture: true });
        document.querySelector('.pp-buy-row[data-store="best-buy"] a.pp-buy-link').click();
      });
      await h.sleep(800);
      const after = h.api.sql('SELECT COALESCE(SUM(clicks), 0) AS n FROM retail_clicks WHERE store = ? AND product_id = ?', 'best-buy', RANGE)[0].n;
      if (after !== before + 1) throw new Error(`the Best Buy link-out was counted ${after - before} times`);
      const cols = h.api.sql('PRAGMA table_info(retail_clicks)').map((c) => c.name);
      if (cols.join(',') !== 'store,product_id,day,clicks') throw new Error(`retail_clicks has columns ${cols}`);
      await noSideScroll(h);
      await setStore(h.api, 'rona', { sponsored: false, affiliate: '' });
    },
  },
  {
    name: 'retail-product-phone',
    as: 'anon',
    viewport: 'phone',
    waitFor: ['.pp-buy-list:not([aria-busy]) .pp-buy-row'],
    expectText: ['Where to buy', 'Prices and availability change'],
    setup: async ({ api }) => {
      // Plain RONA whatever the route before left behind.
      await setStore(api, 'rona', { sponsored: false, affiliate: '' });
      return { path: `#/p/${RONA_CABINET.id}` };
    },
    check: async (h) => {
      await noSideScroll(h);
      const rows = await buyRows(h);
      if (!rows.length || rows[0].store !== 'rona') throw new Error(`the Landon & Co cabinet's rows: ${JSON.stringify(rows)}`);
      if (rows.some((r) => r.sponsored)) throw new Error('nothing is sponsored now, but a row says so');
      // The link button sits inside the screen.
      const r = await h.rectOf('.pp-buy-row a.pp-buy-link', { scroll: true });
      if (r.x < 0 || r.x + r.w > 390) throw new Error(`the store link runs off a phone screen: ${JSON.stringify(r)}`);
      await h.shot('buy');
    },
  },
  {
    // A product id that isn't in the catalog: the missing page, not a crash.
    name: 'retail-product-missing',
    path: '#/p/r-no-such-product',
    as: 'anon',
    expectText: ['We can’t find that product'],
  },

  // ── Admin > Retailers ───────────────────────────────────────────────────
  {
    name: 'retail-admin-desktop',
    path: '#/admin/retailers',
    as: 'admin',
    waitFor: ['.rt-card[data-store="rona"]', '.rt-card[data-store="home-depot"]'],
    expectText: ['Retailers', 'real products in the catalog', 'left out', 'Tracking parameter', 'Link-outs, 30 days'],
    timeoutMs: 30_000,
    check: async (h) => {
      const stores = await h.evaluate(() => [...document.querySelectorAll('.rt-card')].map((c) => c.dataset.store));
      if (stores.join(',') !== RETAIL.stores.map((s) => s.slug).join(',')) throw new Error(`cards for ${stores}`);
      // The Retailers tab sits among the admin tabs.
      const tabs = await h.evaluate(() => [...document.querySelectorAll('.admin-tabs a')].map((a) => a.textContent.trim()));
      if (!tabs.includes('Retailers')) throw new Error(`admin tabs: ${tabs}`);

      const card = '.rt-card[data-store="home-depot"]';
      const input = `${card} input`;
      // A bad parameter: the server's message, nothing saved.
      await h.click(input);
      await h.evaluate((s) => document.querySelector(s).select(), input);
      await h.type('https://evil.example/?x=1');
      await h.click(`${card} button[type="submit"]`);
      await h.waitFor(`${card} .rt-msg:not(.ok)`, 4000);
      if (h.api.sql("SELECT COUNT(*) AS n FROM retailers WHERE slug = 'home-depot' AND affiliate != ''")[0].n) throw new Error('a refused parameter was saved');

      // A good one, plus Sponsored: saved, shown, audited, and in the example link.
      await h.evaluate((s) => document.querySelector(s).select(), input);
      await h.type('utm_source=blumodel&aff=qa');
      await h.click(`${card} button[role="switch"]`);
      const example = await h.evaluate((c) => document.querySelector(`${c} .rt-example code`)?.textContent ?? '', card);
      if (!example.includes('utm_source=blumodel') || !example.startsWith('https://')) throw new Error(`the example link reads ${example}`);
      await h.click(`${card} button[type="submit"]`);
      await h.waitFor(`${card} .rt-msg.ok`, 4000);
      await h.waitFor(`${card} h2 .pp-buy-sponsored`, 4000);
      const row = h.api.sql("SELECT affiliate, sponsored FROM retailers WHERE slug = 'home-depot'")[0];
      if (row?.affiliate !== 'utm_source=blumodel&aff=qa' || row?.sponsored !== 1) throw new Error(`saved ${JSON.stringify(row)}`);
      const audit = h.api.sql("SELECT detail FROM admin_audit WHERE action = 'retailer_update' ORDER BY rowid DESC LIMIT 1")[0];
      if (!audit || JSON.parse(audit.detail).store !== 'home-depot') throw new Error('the change is not in the admin log');
      // The public settings now carry it.
      const pub = (await h.api.get('/api/catalog/retailers')).body.retailers.find((r) => r.slug === 'home-depot');
      if (!pub.sponsored || pub.affiliate !== 'utm_source=blumodel&aff=qa') throw new Error(`public settings: ${JSON.stringify(pub)}`);
      await h.shot('saved');
      await noSideScroll(h);
      await setStore(h.api, 'home-depot', { sponsored: false, affiliate: '' });
    },
  },
  {
    name: 'retail-admin-phone',
    path: '#/admin/retailers',
    as: 'admin',
    viewport: 'phone',
    waitFor: ['.rt-card[data-store="rona"]'],
    expectText: ['Retailers', 'Tracking parameter'],
    check: async (h) => {
      await noSideScroll(h);
      const r = await h.rectOf('.rt-card[data-store="rona"] button[type="submit"]', { scroll: true });
      if (r.x + r.w > 390) throw new Error(`the Save button runs off a phone screen: ${JSON.stringify(r)}`);
    },
  },
  {
    // Not an admin: no tab, and the server refuses the API.
    name: 'retail-admin-customer',
    path: '#/admin/retailers',
    as: 'customer',
    expectText: ['This area is for BluModel Studio staff.'],
    check: async (h) => {
      for (const role of ['customer', 'studio', 'contractor']) {
        const g = await h.api.as(role).get('/api/admin/retailers');
        const p = await h.api.as(role).patch('/api/admin/retailers/rona', { sponsored: true });
        if (g.status !== 403 || p.status !== 403) throw new Error(`${role}: GET ${g.status}, PATCH ${p.status} (want 403)`);
      }
      const anon = await h.api.get('/api/admin/retailers');
      if (anon.status !== 401) throw new Error(`signed out: ${anon.status}`);
    },
  },

  // ── Brand lists per category (the wizard's brand step) ──────────────────
  {
    name: 'retail-brands-api',
    path: '#/',
    as: 'anon',
    check: async (h) => {
      const cab = await h.api.get('/api/catalog/brands?category=cabinets');
      if (cab.status !== 200) throw new Error(`GET /api/catalog/brands?category=cabinets → ${cab.status}`);
      const list = cab.body.retailBrands;
      const total = list.reduce((n, b) => n + b.products, 0);
      const want = RETAIL.products.filter((p) => p.category === 'cabinets').length;
      if (total !== want) throw new Error(`cabinet brands count ${total} products, the data has ${want}`);
      if (!list.every((b) => Array.isArray(b.stores) && b.stores.length && b.products > 0)) throw new Error('a brand has no stores or no products');
      h.note(`cabinet brands: ${list.map((b) => `${b.brand} ${b.products} (${b.stores.join(', ')})`).join('; ')}`);
      const bad = await h.api.get('/api/catalog/brands?category=nope');
      if (bad.status !== 400) throw new Error(`an unknown category → ${bad.status}`);
    },
  },
  ...fixtureRoutes,
  ...upcRoutes,
];
