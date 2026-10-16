// The fixer's QA routes (key 'fix'): one or more per fixed finding, so each would catch it again.
// Run: node scripts/qa.mjs --pkg fix --port 8896 --dist .build/fix --strict-external
//
//   - custom-model links ('Request a custom version', 'Request a custom model') show only on the
//     Contractor plan;
//   - a retail product with no checked store price reads 'Price at store' in the inspector and the
//     estimate, and the estimate says how many items are priced at the store;
//   - at 1440 the Add products filters never cut 'All brands' / 'Any store' short beside the
//     'Your brands' chip (they wrap under it as one row);
//   - a password-reset link opens in a browser that is signed in as someone else;
//   - Home's 'Start a new kitchen' card says brands, not style.

import fs from 'node:fs';

const RETAIL = JSON.parse(fs.readFileSync(new URL('../../../src/data/retail.json', import.meta.url), 'utf8'));
/** An unpriced retail base cabinet (no store price was checked). */
const UNPRICED = RETAIL.products.find((p) => p.price === null && p.kind === 'base' && !p.widthOptions);
const DESKTOP = { w: 1440, h: 900 };
const PHONE = { w: 390, h: 844, mobile: true };

async function must(r, what) {
  if (r.status >= 300) throw new Error(`${what} failed (${r.status}): ${r.body?.error ?? r.text}`);
  return r.body;
}

async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

const hasText = (h, t) => h.evaluate((s) => document.body.innerText.includes(s), t);

/** A kitchen with one unpriced retail cabinet beside a built-in base, set up with that cabinet's brand. */
function atStoreDoc() {
  if (!UNPRICED) throw new Error('src/data/retail.json has no unpriced base cabinet any more; pick another product for this route');
  const { retail: _r, ...wire } = UNPRICED;
  return {
    name: 'QA At Store',
    room: { widthIn: 168, lengthIn: 144, ceilingIn: 96 },
    surfaces: { cabinetFinishId: 'warm-white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'calacatta', backsplashId: 'zellige-white', flooringId: 'herringbone', paintId: 'chalk' },
    items: [
      { id: 'qa-retail', productId: UNPRICED.id, x: 30, y: 12, rotation: 0, finishIndex: 0 },
      { id: 'qa-basic', productId: 'base', x: 80, y: 12, rotation: 0, finishIndex: 0 },
    ],
    products: { [UNPRICED.id]: { ...wire, sku: UNPRICED.code, price: 300, priceAtStore: true, source: 'brand' } },
    brandPrefs: { cabinets: [UNPRICED.brand] },
    version: 2,
  };
}

async function atStoreKitchen(me, { estimator = false } = {}) {
  if (estimator) await must(await me.patch('/api/account/prefs', { showEstimator: true }), 'Turning the estimator on');
  const p = (await must(await me.post('/api/projects', { name: 'QA At Store', doc: atStoreDoc() }), 'Creating the kitchen')).project;
  return { path: `#/k/${p.id}`, projectId: p.id };
}

/** Each filter dropdown's chosen text fits inside it (a <select> can't report its own overflow). */
async function filtersFit(h) {
  const r = await h.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    return [...document.querySelectorAll('.left-panel .catalog-filter select, .sheet .catalog-filter select')].map((s) => {
      const cs = getComputedStyle(s);
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const text = s.options[s.selectedIndex]?.text ?? '';
      const room = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { id: s.id, text, need: Math.ceil(ctx.measureText(text).width), room: Math.floor(room), top: Math.round(s.getBoundingClientRect().top) };
    });
  });
  h.note(`filters: ${r.map((x) => `${x.id} "${x.text}" ${x.need}/${x.room}px`).join(', ')}`);
  if (r.length < 2) throw new Error(`expected the brand and store filters, found ${r.length}`);
  for (const x of r) if (x.need > x.room) throw new Error(`${x.id} cuts "${x.text}" short: it needs ${x.need}px and has ${x.room}px`);
  if (r[0].top !== r[1].top) throw new Error('the brand and store filters are not on one line');
  return r;
}

/** An admin's reset link for a throwaway account made for this route: `{ path, email }`. */
async function resetLinkFor(api) {
  const id = `u_qafixreset${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const email = `${id.slice(2)}@blumodel.test`;
  api.sql('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', id, email, 'QA Reset Target', 'x', Date.now());
  const link = await must(await api.as('admin').post(`/api/admin/users/${id}/reset-link`, {}), 'Making a reset link');
  const token = /reset=([A-Za-z0-9_-]{43})/.exec(link.url ?? '')?.[1];
  if (!token) throw new Error('the admin reset link has no token');
  return { path: `#/signin?reset=${token}`, email };
}

export default [
  // ── custom models are a Contractor-plan feature ──────────────────────────
  {
    name: 'fix-product-no-request-anon',
    path: '#/p/range-30',
    as: 'anon',
    waitFor: ['.pp-dims'],
    expectText: ['Add to a kitchen'],
    check: async (h) => {
      if (await hasText(h, 'Request a custom version')) throw new Error('a visitor is offered "Request a custom version"');
      await noSideScroll(h);
    },
  },
  {
    name: 'fix-product-no-request-customer-phone',
    path: '#/p/range-30',
    as: 'customer',
    viewport: PHONE,
    waitFor: ['.pp-dims'],
    expectText: ['Add to a kitchen'],
    check: async (h) => {
      if (await hasText(h, 'Request a custom version')) throw new Error('a customer is offered "Request a custom version"');
      await noSideScroll(h);
    },
  },
  {
    name: 'fix-product-request-contractor',
    path: '#/p/range-30',
    as: 'contractor',
    waitFor: ['.pp-dims'],
    expectText: ['Add to a kitchen', 'Request a custom version'],
  },
  {
    name: 'fix-catalog-foot-customer',
    as: 'customer',
    viewport: DESKTOP,
    setup: async ({ me }) => atStoreKitchen(me),
    waitFor: ['.plan-view canvas', '.left-panel .product-card'],
    check: async (h) => {
      if (await h.evaluate(() => !!document.querySelector('.catalog-foot'))) throw new Error('a customer is offered "Request a custom model" at the catalog foot');
    },
  },
  {
    name: 'fix-catalog-foot-contractor',
    as: 'contractor',
    viewport: DESKTOP,
    setup: async ({ me }) => atStoreKitchen(me),
    waitFor: ['.plan-view canvas', '.left-panel .catalog-foot'],
    expectText: ['Request a custom model'],
  },

  // ── Price at store ───────────────────────────────────────────────────────
  {
    name: 'fix-inspector-price-at-store',
    as: 'fresh',
    viewport: DESKTOP,
    setup: async ({ me }) => atStoreKitchen(me),
    waitFor: ['.plan-view canvas'],
    check: async (h) => {
      await h.waitUntil(() => !!window.__blumodel?.store, 15_000, 'window.__blumodel (the ?qa hook)');
      await h.evaluate(() => window.__blumodel.store.getState().select('qa-retail'));
      await h.waitFor('.insp-price');
      const price = await h.evaluate(() => document.querySelector('.insp-price span')?.textContent?.trim());
      if (price !== 'Price at store') throw new Error(`the inspector shows "${price}" for a product with no checked store price`);
      await h.shot('inspector');
    },
  },
  {
    name: 'fix-estimate-price-at-store',
    as: 'fresh',
    viewport: DESKTOP,
    setup: async ({ me }) => atStoreKitchen(me, { estimator: true }),
    waitFor: ['.plan-view canvas'],
    check: async (h) => {
      await h.waitUntil(() => [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.trim().startsWith('Estimate')), 10_000, 'the Estimate tab');
      await h.evaluate(() => [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim().startsWith('Estimate')).click());
      await h.waitFor('.est-lines');
      const r = await h.evaluate((name) => {
        const line = [...document.querySelectorAll('.est-line')].find((l) => l.textContent.includes(name));
        return { right: line?.querySelector(':scope > div:last-child b')?.textContent?.trim() ?? null, note: document.querySelector('.est-at-store-note')?.textContent ?? '' };
      }, UNPRICED.name);
      if (r.right !== 'Price at store') throw new Error(`the estimate line for the unpriced cabinet shows "${r.right}"`);
      if (!/1 item is priced at the store and not in this total/.test(r.note)) throw new Error(`no line saying an item is priced at the store (got "${r.note}")`);
      await h.shot('estimate');
    },
  },

  // ── Add products filters at desktop width ────────────────────────────────
  {
    name: 'fix-catalog-filters-desktop',
    as: 'customer',
    viewport: DESKTOP,
    setup: async ({ me }) => atStoreKitchen(me),
    waitFor: ['.plan-view canvas', '.left-panel .catalog-filters button[aria-pressed]', '#catalog-store'],
    check: async (h) => {
      await filtersFit(h);
      await h.shot('filters');
      await noSideScroll(h);
    },
  },

  // ── A reset link in a signed-in browser ──────────────────────────────────
  // The browser is the route's own fresh user (saving the reset ends that browser's session, so
  // never a shared QA role); the link is for a throwaway account made here.
  {
    name: 'fix-reset-link-signed-in',
    as: 'fresh',
    viewport: DESKTOP,
    setup: async ({ api }) => resetLinkFor(api),
    waitFor: ['.auth-form input[type="password"]'],
    expectText: ['Choose a new password', 'This browser is signed in as'],
    check: async (h) => {
      await h.shot('form');
      await h.click('.auth-form input[type="password"]');
      await h.type('qa reset password 1');
      await h.click('.auth-form button[type="submit"]');
      await h.waitUntil(() => !location.hash.includes('reset='), 10_000, 'leaving the reset page');
      const me = await h.evaluate(() => fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.json()));
      if (me.user?.email !== h.data.email) throw new Error(`after the reset the browser is signed in as ${me.user?.email ?? 'nobody'}, not the link's account`);
    },
  },
  {
    name: 'fix-reset-link-signed-in-phone',
    as: 'fresh',
    viewport: PHONE,
    setup: async ({ api }) => resetLinkFor(api),
    waitFor: ['.auth-form input[type="password"]'],
    expectText: ['Choose a new password', 'This browser is signed in as'],
    check: noSideScroll,
  },

  // ── copy ─────────────────────────────────────────────────────────────────
  {
    name: 'fix-home-new-kitchen-copy',
    path: '#/',
    as: 'customer',
    waitFor: ['.home-main'],
    expectText: ['Room size, layout and brands in four quick steps'],
    check: async (h) => {
      if (await hasText(h, 'layout and style')) throw new Error('Home still says "layout and style"');
    },
  },
];
