// The real-retailer catalog's QA routes: the catalog panel's store chips and brand/store filters
// (with click-to-add, pointer-drag and phone tap-to-place still working on a retail product), the
// product page's "Where to buy" (sponsored first, the affiliate parameter, rel, the disclaimer, an
// anonymous click count), Admin > Retailers (admin only, audited) and the wizard's brand list API.
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
const CHECKED = new Date(`${RETAIL.checkedAt}T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

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
    waitFor: ['.pp-buy-row'],
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
        if (!r.text.includes(`checked ${CHECKED}`)) throw new Error(`${r.store}: no "checked ${CHECKED}" in "${r.text}"`);
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
    waitFor: ['.pp-buy-row'],
    expectText: ['Where to buy', 'Prices and availability change'],
    setup: async () => ({ path: `#/p/${RONA_CABINET.id}` }),
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
];
