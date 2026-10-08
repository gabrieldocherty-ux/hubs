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
