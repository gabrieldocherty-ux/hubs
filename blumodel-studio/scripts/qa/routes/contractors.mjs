// Contractor workspace QA routes (package H, which shipped before the QA runner existed): every
// tab of #/pro renders at desktop and phone size, and the contractor's own cost never reaches the
// client's view of a kitchen (the estimate's Client view, the printable quote).
//
//   node scripts/qa.mjs --pkg contractors --port 8818
//
// They use the runner's `contractor` (a paying Contractor) and make their own product and kitchen
// through the API. Nothing here creates a Brand page: the brands routes and the integration
// chain (which run before and after, alphabetically) own that.

import { makePng } from '../../../server/test/fixtures/images.mjs';

const COMPANY = { company: 'Quinn & Co. Kitchens (QA)', serviceArea: 'Testville', defaultMarkupPct: 30 };
const PRODUCT_NAME = 'Quinn Maple Base 24 (QA)';
const COST_CENTS = 27182; // $271.82: a number that must never reach the client's view
const COST_TEXT = ['271.82', '27182'];

const state = {};

const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what} failed (${r.status}): ${typeof r.body === 'object' ? r.body?.error ?? JSON.stringify(r.body).slice(0, 200) : String(r.text ?? '').slice(0, 200)}`);
  return r.body;
};

async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

/** What a person could read on the page: the text plus what sits in inputs, lower-cased. */
const pageText = (h) => h.evaluate(() => `${document.body.innerText} ${[...document.querySelectorAll('input, textarea')].map((i) => i.value).join(' ')}`.toLowerCase());

/** The company, one product with a cost, and a kitchen that uses it. Idempotent per run. */
async function ensureWorkspace(api) {
  const me = api.as('contractor');
  must(await me.put('/api/pro/profile', COMPANY), 'Saving the company');
  if (state.kitchenId) return state;
  const photo = must(await me.putRaw('/api/files?kind=image&name=quinn.png', makePng({ rgba: [190, 150, 100, 255] }), 'image/png'), 'Uploading the photo').file.id;
  const made = must(
    await me.post('/api/pro/products', {
      spec: {
        kind: 'base',
        variant: 'door-drawer',
        category: 'cabinets',
        name: PRODUCT_NAME,
        blurb: 'Maple, painted to order.',
        sku: 'QM{w}',
        widthIn: 24,
        depthIn: 24,
        heightIn: 34.5,
        elevationIn: 0,
        widthOptions: [18, 24, 30],
        price: 0,
        finishes: [{ id: 'maple', name: 'Maple', hex: '#c9a46c', material: 'wood' }],
        imageFileIds: [photo],
        line: 'Quinn Shaker',
        doorStyle: 'shaker',
      },
      cost: { costCents: COST_CENTS },
    }),
    'Creating the My-catalog product',
  );
  state.productId = made.product.id;
  const doc = {
    version: 2,
    name: 'Quinn Client Kitchen (QA)',
    room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
    surfaces: { cabinetFinishId: 'warm-white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'calacatta', backsplashId: 'zellige-white', flooringId: 'herringbone', paintId: 'chalk' },
    items: [
      { id: 'i-mine-1', productId: state.productId, x: 48, y: 12, rotation: 0, finishIndex: 0 },
      { id: 'i-mine-2', productId: state.productId, x: 100, y: 12, rotation: 0, finishIndex: 0 },
      { id: 'i-sink', productId: 'sink-farm', x: 78, y: 12, rotation: 0, finishIndex: 0 },
      { id: 'i-range', productId: 'range-30', x: 159, y: 14, rotation: 0, finishIndex: 0 },
    ],
  };
  const { project } = must(await me.post('/api/projects', { name: doc.name, client: 'R. Client (QA)', doc }), 'Creating the kitchen');
  state.kitchenId = project.id;
  return state;
}

const TABS = [
  ['#/pro/catalog', 'The products you sell'],
  ['#/pro/price-book', 'Cost, markup and sell price'],
  ['#/pro/brands', 'What shows while you design'],
  ['#/pro/quotes', 'Your kitchens, priced'],
  ['#/pro/modelling', 'Have BluModel Studio model your products'],
  ['#/pro/company', 'What your clients see'],
];

async function tour(h, tabs, where) {
  for (const [hash, heading] of tabs) {
    await h.goto(hash);
    await h.waitFor('.pro-main');
    await h.waitForText(heading);
    await h.sleep(250);
    await noSideScroll(h);
    const text = await h.evaluate(() => document.body.innerText);
    if (/something went wrong|unexpected error/i.test(text)) throw new Error(`${hash} shows an error at ${where}`);
  }
}

export default [
  {
    name: 'pro-tabs-desktop',
    path: '#/pro/catalog',
    as: 'contractor',
    setup: async ({ api }) => {
      await ensureWorkspace(api);
      return {};
    },
    waitFor: ['.pro-main', '.pro-tabs'],
    expectText: ['The products you sell', PRODUCT_NAME],
    check: async (h) => {
      await noSideScroll(h);
      await h.shot('catalog');
      await tour(h, TABS.slice(1), 'desktop');
      // The price book is the contractor's own screen: it does show the cost.
      await h.goto('#/pro/price-book');
      await h.waitForText(PRODUCT_NAME);
      // The cost sits in an input, so read the values as well as the text.
      const text = await pageText(h);
      if (!COST_TEXT.some((n) => text.includes(n))) throw new Error('the price book does not show the contractor their own cost');
      await h.shot('price-book');
    },
  },
  {
    name: 'pro-tabs-phone',
    path: '#/pro/catalog',
    as: 'contractor',
    viewport: 'phone',
    setup: async ({ api }) => {
      await ensureWorkspace(api);
      return {};
    },
    waitFor: ['.pro-main', '.pro-tabs'],
    expectText: ['The products you sell'],
    check: async (h) => {
      await noSideScroll(h);
      await h.shot('catalog');
      await tour(h, TABS.slice(1), 'phone');
    },
  },
  {
    // The estimate opens in Client view; Contractor view is a deliberate switch.
    name: 'pro-estimate-client-then-contractor-view',
    as: 'contractor',
    setup: async ({ api }) => {
      const s = await ensureWorkspace(api);
      return { path: `#/k/${s.kitchenId}` };
    },
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await h.evaluate(() => window.__blumodelQA.store.getState().setUI({ rightTab: 'estimate' }));
      await h.waitFor('.client-view-toggle');
      await h.sleep(500);
      const client = await pageText(h);
      for (const n of COST_TEXT) if (client.includes(n)) throw new Error(`Client view shows the contractor's cost (${n})`);
      if (/\bcost\b|\bmargin\b|\bmarkup\b/.test(client)) throw new Error('Client view mentions cost, margin or markup');
      if (!/\$\s?\d/.test(client)) throw new Error('Client view shows no sell price');
      const on = await h.evaluate(() => document.querySelector('.client-view-toggle [aria-checked="true"]')?.textContent?.trim());
      if (on !== 'Client view') throw new Error(`the estimate opened in "${on}", expected Client view`);
      await h.shot('client-view');
      // Contractor view: the contractor's own numbers appear.
      await h.evaluate(() => [...document.querySelectorAll('.client-view-toggle button')].find((b) => b.textContent.trim() === 'Contractor view')?.click());
      await h.sleep(500);
      const own = await pageText(h);
      if (!/\bmargin\b/.test(own) || !/\bmarkup\b/.test(own)) throw new Error('Contractor view shows no margin and markup');
      await h.shot('contractor-view');
      // And back: switching again hides them.
      await h.evaluate(() => [...document.querySelectorAll('.client-view-toggle button')].find((b) => b.textContent.trim() === 'Client view')?.click());
      await h.sleep(400);
      const again = await pageText(h);
      for (const n of COST_TEXT) if (again.includes(n)) throw new Error(`the cost (${n}) stays on screen after switching back to Client view`);
      if (/\bcost\b|\bmargin\b|\bmarkup\b/.test(again)) throw new Error('cost, margin or markup stays on screen after switching back to Client view');
    },
  },
  {
    // The printable quote is a client document: sell prices, the company, never the cost.
    name: 'pro-quote-no-costs',
    as: 'contractor',
    setup: async ({ api }) => {
      const s = await ensureWorkspace(api);
      return { path: `#/pro/quote/${s.kitchenId}` };
    },
    waitFor: ['#root *'],
    expectText: [COMPANY.company],
    waitMs: 1200,
    check: async (h) => {
      await noSideScroll(h);
      const text = await pageText(h);
      for (const n of COST_TEXT) if (text.includes(n)) throw new Error(`the quote shows the contractor's cost (${n})`);
      if (/\bcost\b|\bmargin\b|\bmarkup\b/.test(text)) throw new Error('the quote mentions cost, margin or markup');
      if (!/\$\s?\d/.test(text)) throw new Error('the quote shows no price');
      await h.shot('quote');
      // pageText is lower-cased, so the exact casing is checked on the footer element itself.
      const madeWith = await h.evaluate(() => {
        const el = document.querySelector('.quote-made-with');
        el?.scrollIntoView({ block: 'center' });
        return el?.textContent?.trim() ?? null;
      });
      if (madeWith !== 'Prepared with BluModel Studio') throw new Error(`the quote's footer reads ${JSON.stringify(madeWith)}, not "Prepared with BluModel Studio"`);
      await h.sleep(200);
      await h.shot('quote-footer');
    },
  },
];
