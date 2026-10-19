// Launch QA routes (blumodel.studio going public): the three payment states, the legal pages and
// their footer links, account export and delete, the 404, the error boundaries, the connection
// banner, the manifest / head tags / self-hosted fonts, and the phone pass over every routed
// screen (a failure names the element's tag and classes, so it says which rule to fix).
// Run: node scripts/qa.mjs --pkg launch --port 8852 --dist .build/client --strict-external
//
// The QA server always runs with PAYMENTS=demo. The client's QA-only override shows the other
// states against it: `#/<route>?qa-payments=none|demo|stripe&qa-legal=ready|unset`, read only
// with `?qa` in the page URL (src/lib/config.ts) and remembered for that browser tab. It changes
// what the screens show, never what the server does, so these routes check wording, disabled
// buttons and where things link; the server's own 503 `payments_unavailable` is covered by the
// server tests and by src/lib/__tests__/launch.test.ts.

import { hashPassword } from '../../../server/auth/passwords.mjs';
import { kitchenDoc } from './core.mjs';

const PHONE = 'phone';

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Creates a kitchen for the route's user and returns `{ path, projectId, name }`. */
async function newKitchen(me, name, query = '') {
  const r = await me.post('/api/projects', { name, doc: kitchenDoc(name) });
  if (r.status !== 201) throw new Error(`creating "${name}" failed (${r.status}): ${r.body?.error ?? r.text}`);
  return { path: `#/k/${r.body.project.id}${query}`, projectId: r.body.project.id, name };
}

/** No horizontal page scroll. */
async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

/**
 * With real payments nothing on screen may talk about demos ("demolish" is fine). `scope` limits
 * the check to the app's own wording where the QA seed's "(Demo)" products or orders also show.
 */
async function noDemoWording({ evaluate }, where = 'the page', scope = 'body') {
  const hits = await evaluate((sel) => {
    const t = [...document.querySelectorAll(sel)].map((el) => el.innerText).join('\n');
    const out = [];
    const re = /\bdemo\b/gi;
    let m;
    while ((m = re.exec(t)) && out.length < 5) out.push(t.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' '));
    return out;
  }, scope);
  if (hits.length) throw new Error(`${where} mentions a demo with real payments on: “…${hits.join('…”, “…')}…”`);
}

/** No card-like field and no embedded payment frame on any payment screen (PRODUCT_SPEC §7.4). */
async function noCardFields({ evaluate }) {
  const n = await evaluate(
    () =>
      [...document.querySelectorAll('input, iframe')].filter(
        (el) => el.tagName === 'IFRAME' || /cc-|card|cvc|cvv|expir/i.test([el.name, el.id, el.autocomplete, el.placeholder, el.getAttribute('aria-label')].join(' ')),
      ).length,
  );
  if (n) throw new Error(`${n} card-like field(s) or payment frame(s) on the page`);
}

/** The visible, enabled state of the buttons whose text includes `label`. */
async function buttonsLabelled({ evaluate }, label) {
  return evaluate(
    (l) =>
      [...document.querySelectorAll('button, a.btn')]
        .filter((b) => b.textContent.includes(l) && b.getClientRects().length)
        .map((b) => ({ text: b.textContent.trim(), disabled: b.disabled === true || b.getAttribute('aria-disabled') === 'true' })),
    label,
  );
}

/** Clicks the first visible, enabled button or link whose text includes `label`. */
async function clickLabelled(h, label) {
  const ok = await h.evaluate((l) => {
    const b = [...document.querySelectorAll('button, a')].find((x) => x.textContent.includes(l) && !x.disabled && x.getClientRects().length);
    if (b) b.setAttribute('data-qa-click', l);
    return !!b;
  }, label);
  if (!ok) throw new Error(`no enabled “${label}” button`);
  await h.click(`[data-qa-click="${label.replace(/"/g, '\\"')}"]`);
}

/** Opens Export and picks a menu item by its bold label (as core.mjs does). */
async function exportItem(h, label) {
  const compact = await h.evaluate(() => !!document.querySelector('.export-btn'));
  await h.click(compact ? '.export-btn' : '.topbar .menu-wrap > .btn.primary');
  await h.waitFor('.topbar .menu[role="menu"]');
  const ok = await h.evaluate((l) => {
    const b = [...document.querySelectorAll('.topbar .menu [role="menuitem"]')].find((x) => x.querySelector('b')?.textContent.trim() === l);
    if (b) b.setAttribute('data-qa-item', l);
    return !!b;
  }, label);
  if (!ok) throw new Error(`no "${label}" item in the Export menu`);
  await h.click(`[data-qa-item="${label}"]`);
}

/** The legal footer: Terms, Privacy and Refunds links, visible. */
async function hasLegalLinks({ evaluate }, where, docs = ['terms', 'privacy', 'refunds']) {
  const missing = await evaluate(
    (ds) => ds.filter((d) => ![...document.querySelectorAll(`a[href="#/${d}"]`)].some((a) => a.getClientRects().length && getComputedStyle(a).visibility !== 'hidden')),
    docs,
  );
  if (missing.length) throw new Error(`${where}: no visible link to ${missing.map((d) => `#/${d}`).join(', ')}`);
}

/** Leaves a "went to checkout" marker, as the app does right before it navigates to one. */
function markCheckout(h, what, returnTo) {
  return h.evaluate((w, r) => sessionStorage.setItem('blumodel.checkout', JSON.stringify({ what: w, returnTo: r, at: Date.now() })), what, returnTo);
}

/** Gives a fresh QA user a known password, so a route can type it (the run's seed password is never shown). */
const KNOWN_PASSWORD = 'qa-launch-password-1';
async function knownPassword(api, me) {
  const u = await me.user();
  api.sql('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(KNOWN_PASSWORD), u.id);
  return u;
}

/**
 * A legacy demo Unlimited plan for the route's user: a pre-pivot checkout (new ones answer 410
 * since the showroom pivot), completed through the app's demo payment as it was then.
 */
async function demoUnlimited(api, me) {
  const ref = api.legacyCheckout((await me.user()).id, { kind: 'subscription', plan: 'unlimited' });
  const d = await me.post(`/api/billing/demo/${ref}/complete`, { outcome: 'success' });
  if (d.status >= 300) throw new Error(`completing the demo checkout failed (${d.status}): ${d.body?.error ?? d.text}`);
}

/**
 * An unpaid custom-model order the seeded customer made before 2026-10-15 (a Standard model at
 * $279 USD), as orders.mjs makes them: custom models aren't sold any more (they come with the
 * Contractor plan), so the API refuses a customer's request and the old order goes straight into
 * the DB. It keeps its price and its checkout.
 */
async function newOrder(api) {
  const userId = api.sql('SELECT id FROM users WHERE email = ?', 'demo-customer@blumodel.test')[0]?.id;
  if (!userId) throw new Error('the demo customer does not exist (did the core seed run?)');
  const id = `o_qalaunch${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const t = Date.now();
  const brief = JSON.stringify({ productTypeId: 'range-gas', kind: 'range', variant: 'gas-4', category: 'appliances', name: 'QA launch range', widthIn: 30, depthIn: 28, heightIn: 36, notes: 'QA', referenceFileIds: [], refProductId: 'range-30' });
  api.sql(
    `INSERT INTO orders (id, user_id, target, status, tier, extras, amount_cents, currency, provider, brief, ref_product_id, pending_since, created_at, updated_at)
     VALUES (?, ?, 'customer', 'draft', 'standard', '{"rush":false,"extraFinishes":0}', 27900, 'usd', 'demo', ?, 'range-30', ?, ?, ?)`,
    id, userId, brief, t, t, t,
  );
  api.sql("INSERT INTO order_items (order_id, idx, brief, tier, extra_finishes, amount_cents) VALUES (?, 0, ?, 'standard', 0, 27900)", id, brief);
  api.sql("INSERT INTO order_events (order_id, type, to_status, by_user_id, created_at) VALUES (?, 'created', 'draft', ?, ?)", id, userId, t);
  return id;
}

/** The seeded demo range (server/seed/core.mjs). */
async function demoProductId(api) {
  const r = await api.get('/api/catalog');
  const p = (r.body?.products ?? []).find((x) => x.name === 'Sample Gas Range 30″ (Demo)');
  if (!p) throw new Error('the seeded demo range is not in /api/catalog');
  return p.id;
}

// React reports an error a boundary caught with console.error; these routes cause one on purpose.
const DELIBERATE_CRASH = [/deliberate crash/i, /The above error occurred/i];

// ─── the phone pass ───────────────────────────────────────────────────────────
// Every routed screen at five touch sizes. On each: no sideways scroll, no text clipped or running
// off the screen, every tap target at least 44×44 px, every text field at 16 px or more (smaller
// makes iOS zoom in on focus). One route per size and role keeps the browser contexts few; each
// screen is screenshotted as `phone-<size>-<role>--<screen>.png`.

const PASS_SIZES = [
  { key: '360', viewport: { w: 360, h: 740, dpr: 3, mobile: true } },
  { key: '390', viewport: { w: 390, h: 844, dpr: 3, mobile: true } },
  { key: '414', viewport: { w: 414, h: 896, dpr: 3, mobile: true } },
  { key: 'land', viewport: { w: 844, h: 390, dpr: 3, mobile: true } },
  { key: 'tablet', viewport: { w: 820, h: 1180, dpr: 2, mobile: true } },
];

/** In the page: what is wrong with the screen as laid out now. */
function audit() {
  const vw = innerWidth;
  const out = { overflow: 0, clipped: [], offscreen: [], small: [], font: [] };
  const sw = document.documentElement.scrollWidth;
  if (sw > vw + 1) out.overflow = sw;
  const shown = (el) => {
    if (el.closest('[inert], [aria-hidden="true"], .sr-only, .visually-hidden')) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return null;
    }
    return r;
  };
  const name = (el) =>
    String(el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.getAttribute('name') || el.className || el.tagName)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 36);
  /** `tag.class.class`, so a failure says which rule to fix. */
  const sel = (el) => `${el.tagName.toLowerCase()}${[...el.classList].slice(0, 3).map((c) => `.${c}`).join('')}`;
  /** Inside something that scrolls sideways on purpose (chip rows, tables), or a canvas overlay. */
  const inScroller = (el) => {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && e.scrollWidth > e.clientWidth + 1) return true;
    }
    return false;
  };
  const targets = 'button, a.btn, a.chip, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], select, summary, input:not([type="hidden"]), textarea';
  for (const el of document.querySelectorAll(targets)) {
    const r = shown(el);
    if (!r || r.right <= 0 || r.left >= vw) continue;
    const type = (el.getAttribute('type') || '').toLowerCase();
    let box = r;
    // A checkbox, radio or file input is tapped through its label.
    if (['checkbox', 'radio', 'file', 'color', 'range'].includes(type)) {
      const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`));
      const lr = lab && shown(lab);
      if (type === 'range') {
        if (r.height >= 24 && r.width >= 44) continue;
      }
      if (!lr) continue;
      box = lr;
    }
    if (box.height < 43.5 || box.width < 43.5) out.small.push(`${name(el)} ${sel(el)} (${Math.round(box.width)}×${Math.round(box.height)})`);
  }
  for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]), select, textarea')) {
    if (!shown(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 15.5) out.font.push(`${name(el)} ${sel(el)} (${fs}px)`);
  }
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('canvas, svg')) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = shown(el);
    if (!r) continue;
    const s = getComputedStyle(el);
    const cut = (s.overflowX === 'hidden' || s.overflowX === 'clip') && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && s.whiteSpace !== 'normal';
    if (cut) out.clipped.push(`${name(el)} (${el.scrollWidth} in ${el.clientWidth}px)`);
    if ((r.right > vw + 1 || r.left < -1) && !inScroller(el) && s.position !== 'fixed') out.offscreen.push(`${name(el)} (${Math.round(r.left)}–${Math.round(r.right)})`);
  }
  const uniq = (a) => [...new Set(a)].slice(0, 40);
  return { overflow: out.overflow, clipped: uniq(out.clipped), offscreen: uniq(out.offscreen), small: uniq(out.small), font: uniq(out.font) };
}

async function phonePass(h, screens) {
  const problems = [];
  for (const [key, hash] of screens) {
    await h.goto(hash);
    await h.waitUntil(() => (document.querySelector('#root')?.innerText ?? '').trim().length >= 10 && !/^Loading|^Opening/.test(document.querySelector('.screen-msg')?.innerText ?? ''), 8000, `${key} rendering`).catch(() => {});
    await h.sleep(700);
    const a = await h.evaluate(audit);
    await h.shot(key);
    const p = [];
    if (a.overflow) p.push(`scrolls sideways (${a.overflow}px wide)`);
    if (a.clipped.length) p.push(`clipped text: ${a.clipped.join('; ')}`);
    if (a.offscreen.length) p.push(`text off the screen: ${a.offscreen.join('; ')}`);
    if (a.small.length) p.push(`tap targets under 44px: ${a.small.join('; ')}`);
    if (a.font.length) p.push(`fields under 16px: ${a.font.join('; ')}`);
    if (p.length) problems.push(`${key} (${hash}): ${p.join(' | ')}`);
  }
  if (problems.length) throw new Error(`\n    ${problems.join('\n    ')}`);
}

const PASS_GROUPS = [
  {
    key: 'public',
    as: 'anon',
    setup: async ({ api }) => {
      const token = api.sql('SELECT token FROM share_links WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY show_prices DESC LIMIT 1', Date.now())[0]?.token;
      if (!token) throw new Error('no live seeded share link');
      return { path: '#/', productId: await demoProductId(api), token };
    },
    screens: (d) => [
      ['landing', '#/'],
      ['pricing', '#/pricing'],
      ['signin', '#/signin'],
      ['signup', '#/signup'],
      ['product', `#/p/${d.productId}`],
      ['brand', '#/b/blumodel-sample-co-demo'],
      ['share', `#/s/${d.token}`],
      ['terms', '#/terms'],
      ['privacy', '#/privacy'],
      ['refunds', '#/refunds'],
      ['404', '#/no-such-page'],
      ['local', '#/local'],
    ],
  },
  {
    key: 'customer',
    as: 'customer',
    setup: async ({ api, me }) => {
      const k = await newKitchen(me, 'QA Phone Pass');
      // A legacy (pre-pivot) unlock checkout still opens its demo page; new ones answer 410.
      const ref = api.legacyCheckout((await me.user()).id, { kind: 'kitchen_unlock', projectId: k.projectId });
      const orderId = await newOrder(api);
      const oc = await me.post(`/api/orders/${orderId}/checkout`, {});
      if (oc.status >= 300) throw new Error(`starting an order checkout failed (${oc.status})`);
      return { path: '#/', projectId: k.projectId, ref, orderId };
    },
    screens: (d) => [
      ['home', '#/'],
      ['new', '#/new'],
      ['kitchen', `#/k/${d.projectId}`],
      ['account', '#/account'],
      ['billing', '#/account/billing'],
      ['orders', '#/orders'],
      ['order-new', '#/orders/new'],
      ['order', '#/orders/o_demoseedorder00000000003'],
      ['pay-unlock', `#/pay/demo-plan/${d.ref}`],
      ['pay-order', `#/pay/demo/${d.orderId}`],
      ['pro-pitch', '#/pro'],
    ],
  },
  {
    key: 'pro',
    as: 'contractor',
    setup: async ({ me }) => {
      const p = await me.get('/api/pro/profile');
      if (!p.body?.profile) {
        const r = await me.put('/api/pro/profile', { company: 'Quinn & Co. Kitchens (QA)', phone: '905-555-0164', serviceArea: 'Testville', defaultMarkupPct: 30 });
        if (r.status !== 200) throw new Error(`saving the company failed (${r.status})`);
      }
      return { path: '#/pro' };
    },
    screens: () => [
      ['pro', '#/pro'],
      ['pro-catalog', '#/pro/catalog'],
      ['pro-product-new', '#/pro/catalog/new'],
      ['pro-price-book', '#/pro/price-book'],
      ['pro-brand', '#/pro/brand'],
      ['pro-brands', '#/pro/brands'],
      ['pro-quotes', '#/pro/quotes'],
      ['pro-modelling', '#/pro/modelling'],
      ['pro-company', '#/pro/company'],
    ],
  },
  {
    key: 'staff',
    as: 'admin',
    path: '#/admin/overview',
    screens: () => [
      ['admin-overview', '#/admin/overview'],
      ['admin-users', '#/admin/users'],
      ['admin-moderation', '#/admin/moderation'],
      ['admin-brands', '#/admin/brands'],
      ['admin-studio', '#/admin/studio'],
      ['admin-revenue', '#/admin/revenue'],
      ['admin-billing', '#/admin/billing'],
    ],
  },
  {
    key: 'brand',
    as: 'brand',
    path: '#/brand',
    screens: () => [['brand-portal', '#/brand']],
  },
];

const phonePassRoutes = PASS_SIZES.flatMap((size) =>
  PASS_GROUPS.map((g) => ({
    name: `phone-${size.key}-${g.key}`,
    as: g.as,
    viewport: size.viewport,
    ...(g.setup ? { setup: g.setup } : { path: g.path }),
    timeoutMs: 120_000,
    check: async (h) => phonePass(h, g.screens(h.data)),
  })),
);

// ─── routes ───────────────────────────────────────────────────────────────────

export default [
  // ── Payments: not open yet ('none') ──────────────────────────────────────
  // (Retired with SHOWROOM_PIVOT §3, nothing left to sell to homeowners: pay-none-pricing(-phone),
  // pay-none-billing(-phone), pay-none-pro-signup(-phone), pay-demo-billing, pay-stripe-pricing,
  // pay-stripe-billing, pay-stripe-pro-signup, pay-return-cancel-unlock, pay-return-cancel-pro.)
  ...['none', 'demo', 'stripe'].map((mode) => ({
    name: `pay-${mode}-billing-nothing-for-sale`,
    path: `#/account/billing?qa-payments=${mode}`,
    as: 'fresh',
    waitFor: ['.billing-current'],
    check: async (h) => {
      const t = await h.evaluate(() => document.body.innerText);
      for (const bad of ['Choose Unlimited', 'Choose Contractor', 'Switch to', 'By paying you agree', 'Opens soon']) if (t.includes(bad)) throw new Error(`Billing still offers a plan: "${bad}"`);
      if (await h.evaluate(() => !!document.querySelector('#plans-title, .billing-plans'))) throw new Error('Billing still lists plans');
      await noCardFields(h);
      await noSideScroll(h);
    },
  })),
  {
    name: 'pay-stripe-pricing-companies',
    path: '#/pricing?qa-payments=stripe',
    as: 'anon',
    expectText: ['a month, plus a setup quoted for your company.'],
    check: async (h) => {
      // ("demo showroom" is the product's own wording here, so no DEMO-payment wording check.)
      for (const bad of ['Go Unlimited', 'Become a BluModel Studio contractor', 'Start free']) if ((await buttonsLabelled(h, bad)).length) throw new Error(`the pricing page still offers "${bad}"`);
      await noSideScroll(h);
    },
  },
  {
    // Payments off: downloading is free anyway (the showroom pivot), so nothing asks for money.
    name: 'pay-none-export-free',
    as: 'fresh',
    setup: async ({ me }) => newKitchen(me, 'QA Soon Kitchen', '?qa-payments=none'),
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      if (!(await h.evaluate(() => [...document.querySelectorAll('.topbar button')].some((b) => /share/i.test(b.textContent))))) throw new Error('no Share button in the editor');
      await exportItem(h, 'Shopping list');
      await h.waitForText('Shopping list saved as CSV.');
      if (await h.evaluate(() => !!document.querySelector('.modal.unlock'))) throw new Error('a payment dialog opened for a free download');
      await noCardFields(h);
    },
  },
  {
    name: 'pay-none-export-device',
    path: '#/local?qa-payments=none',
    as: 'anon',
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await exportItem(h, 'Shopping list');
      await h.waitForText('Downloads are free. Sign in and save this kitchen');
    },
  },
  {
    // Custom models need no payment (they come with the Contractor plan), so requests stay open
    // while payments are off.
    name: 'pay-none-orders-new',
    path: '#/orders/new?qa-payments=none',
    as: 'contractor',
    waitFor: ['.ord-allowance'],
    expectText: ['Make custom models', 'models left this month'],
    check: async (h) => {
      await noDemoWording(h, 'the model request');
      await noSideScroll(h);
    },
  },
  {
    name: 'pay-none-order-unpaid',
    as: 'customer',
    setup: async ({ api }) => ({ path: `#/orders/${await newOrder(api)}?qa-payments=none` }),
    expectText: ['QA launch range', 'Payments open soon'],
    check: async (h) => {
      const b = await buttonsLabelled(h, 'Payments open soon');
      if (!b.length || b.some((x) => !x.disabled)) throw new Error(`the Pay button should be a disabled “Payments open soon”: ${JSON.stringify(b)}`);
      // The order was made on the QA server's demo provider, but nothing about it is a demo while payments are off.
      await noDemoWording(h, 'an unpaid order', '.ord-head, .ord-status-card');
    },
  },
  {
    name: 'pay-stripe-orders-new',
    path: '#/orders/new?qa-payments=stripe',
    as: 'contractor',
    waitFor: ['.ord-allowance'],
    expectText: ['Make custom models', 'models left this month'],
    check: async (h) => {
      await noDemoWording(h, 'the model request');
      await noCardFields(h);
    },
  },
  {
    name: 'pay-stripe-legal',
    path: '#/refunds?qa-payments=stripe&qa-legal=ready',
    as: 'anon',
    expectText: ['Refund policy', 'The monthly plan'],
    check: async (h) => {
      await noDemoWording(h, 'the Refund policy');
      await h.goto('#/terms');
      await h.waitForText('Service agreement');
      await noDemoWording(h, 'the Terms');
      await h.goto('#/privacy');
      await h.waitForText('Privacy policy');
      await noDemoWording(h, 'the Privacy policy');
    },
  },

  // ── Coming back from a checkout ──────────────────────────────────────────
  {
    name: 'pay-return-cancel-billing',
    path: '#/account/billing?qa-payments=stripe',
    as: 'fresh',
    waitFor: ['.billing-current'],
    check: async (h) => {
      await markCheckout(h, 'unlimited', '#/account/billing');
      await h.reload();
      await h.waitForText('Checkout cancelled. Nothing was charged.');
      await h.reload();
      await h.waitFor('.billing-current');
      await h.sleep(400);
      if (await h.evaluate(() => /Checkout cancelled/.test(document.body.innerText))) throw new Error('“Checkout cancelled” is said again after a reload');
    },
  },
  {
    // Stripe's success URL carries ?session_id=; the page confirms it, says so, and drops it from the address.
    name: 'pay-return-success-billing',
    path: '#/account/billing?qa-payments=stripe',
    as: 'fresh',
    waitFor: ['.billing-current'],
    check: async (h) => {
      await markCheckout(h, 'unlimited', '#/account/billing');
      await h.page.goto(`${h.base}/?qa=1&session_id=cs_test_QA_LAUNCH#/account/billing`, 20_000);
      await h.waitForText('Payment received');
      const search = await h.evaluate(() => location.search);
      if (/session_id/.test(search) || !/qa=1/.test(search)) throw new Error(`the address still reads ${search} after the return`);
    },
  },
  {
    name: 'pay-return-cancel-order',
    as: 'customer',
    setup: async ({ api }) => {
      const id = await newOrder(api);
      return { path: `#/orders/${id}?qa-payments=stripe`, orderId: id };
    },
    expectText: ['QA launch range'],
    check: async (h) => {
      await markCheckout(h, 'order', `#/orders/${h.data.orderId}`);
      await h.reload();
      await h.waitForText('Checkout cancelled. Nothing was charged; your request is saved');
      // The order itself was made on the QA server's demo provider and says so; the payment controls must not.
      await noDemoWording(h, 'the order’s payment controls', '.ord-status-card');
    },
  },
  {
    name: 'legal-terms',
    path: '#/terms?qa-legal=ready',
    as: 'anon',
    waitFor: ['.legal-doc'],
    expectText: ['Service agreement', 'Sample Kitchen Co. (QA)', 'help@example.test', 'governed by the laws of Ontario, Canada', 'You can cancel the monthly plan at any time'],
    check: async (h) => {
      await hasLegalLinks(h, 'the Terms page');
      await noSideScroll(h);
      if (!(await h.evaluate(() => /Service agreement · BluModel Studio/.test(document.title)))) throw new Error(`the tab title is “${await h.evaluate(() => document.title)}”`);
    },
  },
  {
    name: 'legal-privacy-phone',
    path: '#/privacy?qa-legal=unset',
    as: 'anon',
    viewport: PHONE,
    waitFor: ['.legal-doc'],
    expectText: ['Privacy policy', 'The operator of this site runs BluModel Studio', 'blumodel_session', 'Download my data', 'Delete my account'],
    check: async (h) => {
      const raw = await h.evaluate(() => {
        const t = document.querySelector('.legal-doc').innerText;
        return ['null', 'undefined', 'LEGAL_NAME', 'SUPPORT_EMAIL', '{', '}'].filter((x) => t.includes(x));
      });
      if (raw.length) throw new Error(`the page shows raw placeholders: ${raw.join(', ')}`);
      if (await h.evaluate(() => !!document.querySelector('.legal-unset'))) throw new Error('a visitor sees the admins-only “Legal details not set” badge');
      await noSideScroll(h);
    },
  },
  {
    name: 'legal-refunds',
    path: '#/refunds?qa-legal=unset',
    as: 'customer',
    waitFor: ['.legal-doc'],
    expectText: ['Refund policy', 'The monthly plan', 'Rendering credits', 'Purchases made before 17 October 2026', 'the operator of this site'],
    check: async (h) => {
      await h.evaluate(() => document.querySelector('.legal-toc button:last-child, .legal-toc li:last-child button')?.click());
      await h.sleep(600);
      await h.shot('toc-jump');
    },
  },
  {
    name: 'legal-admin-badge',
    path: '#/terms?qa-legal=unset',
    as: 'admin',
    waitFor: ['.legal-doc', '.legal-unset'],
    expectText: ['Legal details not set'],
  },
  {
    name: 'legal-admin-badge-when-set',
    path: '#/terms?qa-legal=ready',
    as: 'admin',
    waitFor: ['.legal-doc'],
    check: async (h) => {
      await h.sleep(300);
      if (await h.evaluate(() => !!document.querySelector('.legal-unset'))) throw new Error('the “Legal details not set” badge shows with the details set');
    },
  },
  {
    // Every public page carries the legal footer; sign-up says what creating an account agrees to.
    name: 'legal-footer-links',
    path: '#/',
    as: 'anon',
    setup: async ({ api }) => ({ path: '#/', productId: await demoProductId(api) }),
    expectText: ['Sign in'],
    timeoutMs: 30_000,
    check: async (h) => {
      const pages = [
        ['#/', 'the landing page', 'Your own virtual showroom, with your products, under your name.'],
        ['#/pricing', 'pricing', 'a month, plus a setup quoted for your company.'],
        ['#/signin', 'sign in', 'Welcome back'],
        ['#/signup', 'sign up', 'By creating an account you agree to the Terms and the Privacy policy'],
        [`#/p/${h.data.productId}`, 'a product page', 'Sample Gas Range'],
        ['#/b/blumodel-sample-co-demo', 'a brand page', 'BluModel Sample Co.'],
        ['#/no-such-page', 'the 404', 'We can’t find that page'],
        ['#/privacy', 'the Privacy policy', 'Privacy policy'],
      ];
      for (const [hash, where, text] of pages) {
        await h.goto(hash);
        await h.waitForText(text, 10_000);
        await h.sleep(250);
        await hasLegalLinks(h, where);
      }
    },
  },
  {
    name: 'legal-footer-signed-in',
    path: '#/',
    as: 'customer',
    waitFor: ['.home-main'],
    check: async (h) => {
      await hasLegalLinks(h, 'My kitchens');
      await h.goto('#/account/billing');
      await h.waitFor('.billing-current');
      await hasLegalLinks(h, 'Billing');
      await h.goto('#/account');
      await h.waitForText('Account settings');
      await hasLegalLinks(h, 'Account settings');
    },
  },
  {
    name: 'legal-share-bar',
    as: 'customer',
    setup: async ({ me }) => {
      const k = await newKitchen(me, 'QA Shared Legal');
      const s = await me.post(`/api/projects/${k.projectId}/shares`, {});
      if (s.status >= 300) throw new Error(`making a share link failed (${s.status}): ${s.body?.error ?? s.text}`);
      const token = s.body?.share?.token ?? s.body?.token;
      if (!token) throw new Error(`no share token in ${JSON.stringify(s.body).slice(0, 200)}`);
      return { path: `#/s/${token}` };
    },
    waitFor: ['.share-bar'],
    check: async (h) => hasLegalLinks(h, 'the shared kitchen', ['terms', 'privacy']),
  },

  // ── Account settings: download my data, delete my account ────────────────
  {
    name: 'account-settings',
    path: '#/account',
    as: 'fresh',
    expectText: ['Account settings', 'Your data', 'Download my data', 'Delete my account'],
    check: noSideScroll,
  },
  {
    name: 'account-settings-phone',
    path: '#/account',
    as: 'fresh',
    viewport: PHONE,
    expectText: ['Account settings', 'Download my data', 'Delete my account'],
    check: async (h) => {
      await clickLabelled(h, 'Delete my account');
      await h.waitForText(['Delete your account?', 'Keep my account']);
      await noSideScroll(h);
      await h.shot('delete-open');
    },
  },
  {
    name: 'account-export',
    as: 'fresh',
    setup: async ({ me }) => {
      await newKitchen(me, 'QA Export Me');
      return { path: '#/account' };
    },
    expectText: ['Download my data'],
    check: async (h) => {
      const r = await h.me.get('/api/account/export');
      if (r.status !== 200) throw new Error(`GET /api/account/export answered ${r.status}`);
      const body = typeof r.body === 'object' && r.body ? r.body : JSON.parse(r.text);
      const u = await h.me.user();
      if (body.user?.email !== u.email) throw new Error('the export is not this user’s');
      if (!Array.isArray(body.projects) || !body.projects.some((p) => JSON.stringify(p).includes('QA Export Me'))) throw new Error('the export is missing the kitchen');
      if (/password|_hash|session/i.test(JSON.stringify(body))) throw new Error('the export carries a password hash or session');
      await clickLabelled(h, 'Download my data');
      await h.waitForText('Your data file is downloading.');
    },
  },
  {
    name: 'account-delete-active-plan',
    as: 'fresh',
    setup: async ({ api, me }) => {
      await demoUnlimited(api, me);
      await knownPassword(api, me);
      return { path: '#/account' };
    },
    expectText: ['Delete my account'],
    check: async (h) => {
      await clickLabelled(h, 'Delete my account');
      await h.waitFor('.acct-delete input[type="password"]');
      await h.click('.acct-delete input[type="password"]');
      await h.type(KNOWN_PASSWORD);
      await h.click('.acct-delete button[type="submit"]');
      await h.waitForText('Your paid plan still renews. Cancel it in Billing first');
      if (!(await h.evaluate(() => !!document.querySelector('.acct-delete a[href="#/account/billing"]')))) throw new Error('no link to Billing next to the explanation');
      const me = await h.me.get('/api/auth/me');
      if (me.status !== 200) throw new Error('the account was deleted with a renewing plan');
    },
  },
  {
    name: 'account-delete',
    as: 'fresh',
    setup: async ({ api, me }) => {
      const k = await newKitchen(me, 'QA Delete Me');
      const u = await knownPassword(api, me);
      return { path: '#/account', projectId: k.projectId, userId: u.id };
    },
    expectText: ['Delete my account'],
    check: async (h) => {
      await clickLabelled(h, 'Delete my account');
      await h.waitFor('.acct-delete input[type="password"]');
      await h.click('.acct-delete input[type="password"]');
      await h.type('not-the-password');
      await h.click('.acct-delete button[type="submit"]');
      await h.waitForText('password');
      await h.waitFor('.acct-delete .auth-error');
      await h.click('.acct-delete input[type="password"]');
      await h.evaluate(() => {
        const i = document.querySelector('.acct-delete input[type="password"]');
        i.select();
      });
      await h.type(KNOWN_PASSWORD);
      await h.shot('confirm');
      await h.click('.acct-delete button[type="submit"]');
      await h.waitForText('Your account has been deleted', 15_000);
      const left = h.api.sql('SELECT (SELECT COUNT(*) FROM users WHERE id = ?) AS users, (SELECT COUNT(*) FROM projects WHERE id = ?) AS projects', h.data.userId, h.data.projectId)[0];
      if (left.users || left.projects) throw new Error(`after deleting, ${left.users} user row(s) and ${left.projects} kitchen(s) remain`);
    },
  },

  // ── 404, error boundaries, connection banner ─────────────────────────────
  {
    name: 'not-found',
    path: '#/no-such-page',
    as: 'anon',
    expectText: ['404', 'We can’t find that page', 'Go to the home page', 'See a live demo showroom'],
    check: async (h) => {
      await hasLegalLinks(h, 'the 404');
      if (!(await h.evaluate(() => /Page not found/.test(document.title)))) throw new Error('the tab title does not say “Page not found”');
    },
  },
  {
    name: 'not-found-phone',
    path: '#/kitchen/missing/parts',
    as: 'customer',
    viewport: PHONE,
    expectText: ['We can’t find that page', 'Go to my account'],
    check: noSideScroll,
  },
  {
    // A typed or shared https://blumodel.studio/terms (no hash) is served the app; boot.ts moves the
    // path into the hash, so it opens the Terms rather than the landing page, and an unknown path is the 404.
    name: 'path-to-hash',
    path: '#/welcome',
    as: 'anon',
    expectText: ['Your own virtual showroom, with your products, under your name.'],
    check: async (h) => {
      const where = () => h.evaluate(() => `${location.pathname}${location.search}${location.hash}`);
      await h.page.goto(`${h.base}/terms?qa=1`, 20_000);
      await h.waitForText('Service agreement');
      if ((await where()) !== '/?qa=1#/terms') throw new Error(`/terms became ${await where()}, not /?qa=1#/terms`);
      await h.page.goto(`${h.base}/pricing/?qa=1`, 20_000);
      await h.waitFor('.mk-pricing-hero');
      if ((await where()) !== '/?qa=1#/pricing') throw new Error(`/pricing/ became ${await where()}, not /?qa=1#/pricing`);
      await h.page.goto(`${h.base}/no/such/page?qa=1`, 20_000);
      await h.waitForText('We can’t find that page');
      if ((await where()) !== '/?qa=1#/no/such/page') throw new Error(`/no/such/page became ${await where()}`);
    },
  },
  {
    name: 'crash-route',
    path: '#/pricing?qa-crash=route',
    as: 'anon',
    ignoreConsole: DELIBERATE_CRASH,
    expectText: ['Something went wrong', 'Your design is saved', 'Reload', 'Go to the home page'],
    check: async (h) => {
      await h.shot('crashed');
      // Only the screen is replaced: moving to another screen clears it.
      await h.goto('#/welcome');
      await h.waitForText('Your own virtual showroom, with your products, under your name.');
    },
  },
  {
    name: 'crash-root',
    path: '#/pricing?qa-crash=root',
    as: 'anon',
    viewport: PHONE,
    ignoreConsole: DELIBERATE_CRASH,
    expectText: ['Something went wrong', 'Your design is saved', 'Reload'],
    check: noSideScroll,
  },
  {
    name: 'offline-banner',
    path: '#/',
    as: 'customer',
    waitFor: ['.home-main'],
    check: async (h) => {
      await h.evaluate(() => window.dispatchEvent(new Event('offline')));
      await h.waitForText(['Can’t reach BluModel Studio', 'Retry']);
      await h.shot('down');
      // Still down: Retry keeps the banner.
      await h.evaluate(() => {
        window.__qaFetch = window.fetch;
        window.fetch = (u, o) => (String(u).includes('/api/') ? Promise.reject(new TypeError('Failed to fetch')) : window.__qaFetch(u, o));
      });
      await clickLabelled(h, 'Retry');
      await h.sleep(500);
      if (!(await h.evaluate(() => /Can’t reach BluModel Studio/.test(document.body.innerText)))) throw new Error('the banner went away while the server was still unreachable');
      // Back: Retry clears it.
      await h.evaluate(() => {
        window.fetch = window.__qaFetch;
      });
      await clickLabelled(h, 'Retry');
      await h.waitUntil(() => !document.querySelector('.conn-banner'), 5000, 'the banner clearing');
    },
  },

  // ── Installable, self-hosted, findable ───────────────────────────────────
  {
    // The manifest and every icon it names are served (no service worker), the head carries the
    // canonical and share tags for blumodel.studio, and the web fonts came from this server.
    name: 'pwa-head-fonts',
    path: '#/',
    as: 'anon',
    expectText: ['Your own virtual showroom, with your products, under your name.'],
    check: async (h) => {
      const r = await h.evaluate(async () => {
        const meta = (sel, attr = 'content') => document.querySelector(sel)?.getAttribute(attr) ?? null;
        const link = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
        const res = await fetch(link);
        const manifest = await res.json();
        const icons = [];
        for (const i of manifest.icons ?? []) {
          const ir = await fetch(i.src);
          const blob = await ir.blob();
          let size = null;
          if (i.type === 'image/png') {
            const bmp = await createImageBitmap(blob);
            size = `${bmp.width}x${bmp.height}`;
          }
          icons.push({ src: i.src, status: ir.status, type: ir.headers.get('content-type'), declared: i.sizes, size, purpose: i.purpose });
        }
        const touch = await fetch(meta('link[rel="apple-touch-icon"]', 'href'));
        await document.fonts.ready;
        const fontFiles = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\.woff2(\?|$)/.test(n));
        return {
          manifestType: res.headers.get('content-type'),
          manifest,
          icons,
          touch: touch.status,
          themeColor: meta('meta[name="theme-color"]'),
          canonical: meta('link[rel="canonical"]', 'href'),
          ogUrl: meta('meta[property="og:url"]'),
          ogImage: meta('meta[property="og:image"]'),
          title: document.title,
          workers: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
          fonts: ['Fraunces', 'Instrument Sans'].map((f) => [f, document.fonts.check(`16px "${f}"`)]),
          fontFiles,
        };
      });
      const bad = [];
      if (!/application\/manifest\+json/.test(r.manifestType ?? '')) bad.push(`manifest served as ${r.manifestType}`);
      if (r.manifest.name !== 'BluModel Studio' || r.manifest.short_name !== 'BluModel') bad.push(`manifest names ${r.manifest.name} / ${r.manifest.short_name}`);
      if (r.manifest.display !== 'standalone' || r.manifest.start_url !== '/#/') bad.push(`manifest display ${r.manifest.display}, start_url ${r.manifest.start_url}`);
      for (const want of ['192x192', '512x512']) if (!r.icons.some((i) => i.size === want && i.declared === want && i.purpose === 'any')) bad.push(`no ${want} "any" icon`);
      if (!r.icons.some((i) => i.purpose === 'maskable' && i.size === '512x512')) bad.push('no 512px maskable icon');
      for (const i of r.icons) if (i.status !== 200 || (i.size && i.size !== i.declared)) bad.push(`icon ${i.src}: ${i.status}, ${i.size} for ${i.declared}`);
      if (r.touch !== 200) bad.push(`apple-touch-icon answered ${r.touch}`);
      if (!r.themeColor) bad.push('no theme-color');
      if (r.canonical !== 'https://blumodel.studio/' || r.ogUrl !== 'https://blumodel.studio/' || !String(r.ogImage).startsWith('https://blumodel.studio/')) bad.push(`canonical ${r.canonical}, og:url ${r.ogUrl}, og:image ${r.ogImage}`);
      if (!/BluModel Studio/.test(r.title)) bad.push(`title “${r.title}”`);
      if (r.workers) bad.push(`${r.workers} service worker(s) registered`);
      for (const [f, ok] of r.fonts) if (!ok) bad.push(`${f} is not loaded`);
      if (!r.fontFiles.length || r.fontFiles.some((u) => !u.startsWith(`${h.base}/fonts/`))) bad.push(`font files: ${JSON.stringify(r.fontFiles)}`);
      if (bad.length) throw new Error(bad.join('; '));
      h.note(`icons ${r.icons.map((i) => i.size ?? i.type).join(', ')}; fonts ${r.fontFiles.length} files from /fonts/`);
    },
  },

  ...phonePassRoutes,
];
