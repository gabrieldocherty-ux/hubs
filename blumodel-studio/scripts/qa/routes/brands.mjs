// Package B2 QA routes (BRAND_PAGE.md, BUILD_PLAN §16): the Brand page tab in the Contractor
// workspace, the public page #/b/:slug with its lead form, the #/brand redirects and Admin
// moderation and brands, at desktop and phone sizes.
// Run: node scripts/qa.mjs --pkg brands --port 8813
//
// Data comes from server/seed/brands.mjs: demo-brand@blumodel.test ("brand") is the demo contractor
// whose company, Alder & Pine Cabinetry (Demo), has a live page with leads; Birchwood Kitchen
// Studio (Demo) waits in the review queue; two (Demo) partner brands carry models. The runner's
// "contractor" is a fresh Contractor-plan user with no page yet.

const SLUG = 'alder-and-pine-cabinetry';
const IN_REVIEW = 'birchwood-kitchen-studio';

/** No horizontal page scroll: layout breakage on phones usually shows up here first. */
async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

/** Nothing that looks like a cost or margin, anywhere in a JSON wire. */
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
}

/** Sets a React-controlled <select> (a real user picks with the native popup, which CDP can't drive). */
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

/** Marks the first element matching `selector` whose text includes `text`, so it can be clicked by selector. */
async function mark({ evaluate }, selector, text, tag) {
  const ok = await evaluate(
    (sel, t, g) => {
      const el = [...document.querySelectorAll(sel)].find((x) => x.textContent.includes(t));
      el?.setAttribute('data-qa', g);
      return !!el;
    },
    selector,
    text,
    tag,
  );
  if (!ok) throw new Error(`nothing matching ${selector} says "${text}"`);
  return `[data-qa="${tag}"]`;
}

/**
 * A finger tap: touchStart, 50 ms, touchEnd, so the browser makes the click a button needs. (The
 * runner's h.tap uses Input.synthesizeTapGesture, which under Edge's touch emulation never
 * delivers a click to a button; packages move and share found the same.)
 */
async function fingerTap(h, selector) {
  const r = await h.rectOf(selector, { scroll: true });
  if (!(r.w > 0 && r.h > 0)) throw new Error(`tap: ${selector} has no size (hidden?)`);
  await h.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.cx, y: r.cy, id: 1 }] });
  await h.sleep(50);
  await h.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
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

/** The newest lead in the demo contractor's inbox with this name. */
async function inboxLead(api, name) {
  const r = await api.as('brand').get('/api/pro/brand/leads');
  if (r.status !== 200) throw new Error(`reading the demo contractor's leads failed (${r.status})`);
  return r.body.leads.find((l) => l.name === name) ?? null;
}

/** A small saved kitchen for the route's user. */
async function newKitchen(me, name) {
  const doc = {
    name,
    room: { widthIn: 150, lengthIn: 120, ceilingIn: 96 },
    surfaces: { cabinetFinishId: 'white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'marble', backsplashId: 'subway', flooringId: 'oak', paintId: 'white' },
    items: [],
  };
  const r = await me.post('/api/projects', { name, doc });
  if (r.status !== 201) throw new Error(`creating "${name}" failed (${r.status})`);
  return r.body.project;
}

export default [
  // ── The Contractor workspace: Brand page tab ─────────────────────────────
  {
    name: 'pro-brand-overview',
    path: '#/pro/brand',
    as: 'brand',
    waitFor: ['.brand-stats', '.brand-chart'],
    expectText: ['Alder & Pine Cabinetry (Demo)', 'Page views', 'Top products', 'Demo data', 'Last 90 days'],
    check: async (h) => {
      await noSideScroll(h);
      // The unread-leads badge on the workspace's Brand page tab.
      const badge = await h.evaluate(() => [...document.querySelectorAll('a.chip')].find((a) => a.textContent.includes('Brand page'))?.querySelector('.badge')?.textContent ?? null);
      if (!badge) h.note('no unread-leads badge on the Brand page tab (an earlier route may have read the leads)');
      // 7 / 30 / 90 days switch the numbers.
      const sel = await mark(h, 'button', 'Last 7 days', 'd7');
      await h.click(sel);
      await h.waitUntil(() => {
        const b = document.querySelector('[data-qa="d7"]');
        return !!b && (b.classList.contains('on') || b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true');
      }, 5000, 'Last 7 days selected');
    },
  },
  {
    name: 'pro-brand-products',
    path: '#/pro/brand/products',
    as: 'brand',
    waitFor: ['.brand-row'],
    expectText: ['of 50 products on your page', 'Show on my brand page', 'Publish whole line', 'A photo or a 3D model', 'Live · edit in review', 'In review'],
    check: async (h) => {
      await noSideScroll(h);
      const r = await h.api.as('brand').get('/api/pro/brand/products');
      const shelf = r.body.products.find((p) => p.name === 'Shaker Open Wall Shelf');
      if (!shelf || shelf.readiness.ready) throw new Error('the demo shelf should be listed and not ready');
      // Its switch is off and disabled until it's ready.
      const sw = await h.evaluate(() => {
        const row = [...document.querySelectorAll('.brand-row')].find((x) => x.textContent.includes('Shaker Open Wall Shelf'));
        const el = row?.querySelector('input[type="checkbox"], [role="switch"]');
        if (!el) return null;
        return { disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', on: el.type === 'checkbox' ? el.checked : el.getAttribute('aria-checked') === 'true' };
      });
      if (!sw) throw new Error('no switch on the not-ready product');
      if (sw.on || !sw.disabled) throw new Error(`the not-ready product's switch is ${sw.on ? 'on' : 'enabled'}`);
    },
  },
  {
    name: 'pro-brand-leads',
    path: '#/pro/brand/leads',
    as: 'brand',
    waitFor: ['.brand-lead'],
    expectText: ['Priya Natarajan (Demo)', 'Private notes', 'Contacted', 'Won', 'Lost'],
    check: async (h) => {
      await noSideScroll(h);
      const links = await h.evaluate(() => ({
        tel: [...document.querySelectorAll('.brand-lead a[href^="tel:"]')].map((a) => a.getAttribute('href')),
        mail: [...document.querySelectorAll('.brand-lead a[href^="mailto:"]')].map((a) => a.getAttribute('href')),
      }));
      if (!links.tel.length || links.tel.some((x) => !/^tel:\+?[0-9]+$/.test(x))) throw new Error(`bad Call links: ${links.tel.join(', ')}`);
      if (!links.mail.length || !links.mail.every((x) => /\?subject=/.test(x))) throw new Error('an Email link has no pre-filled subject');
    },
  },
  {
    name: 'pro-brand-settings',
    path: '#/pro/brand/settings',
    as: 'brand',
    waitFor: ['.brand-settings'],
    expectText: ['From your company profile', 'Price on request', 'Show my phone number publicly', 'Lead form'],
    check: noSideScroll,
  },
  {
    name: 'pro-brand-preview',
    path: '#/pro/brand/preview',
    as: 'brand',
    waitFor: ['.brand-preview .bp-card'],
    expectText: ['Preview', 'Verified contractor', 'Alder Shaker'],
    check: noSideScroll,
  },
  {
    name: 'pro-dashboard-brand-card',
    path: '#/pro',
    as: 'brand',
    waitFor: ['.brand-dash'],
    expectText: ['Brand page', 'Live', 'page views this month', 'leads this month'],
    check: noSideScroll,
  },
  {
    name: 'pro-catalog-publish-toggles',
    path: '#/pro/catalog',
    as: 'brand',
    waitFor: ['.brand-catalog-switch'],
    expectText: ['Show on my brand page'],
    check: noSideScroll,
  },
  {
    name: 'pro-brand-setup-fresh-contractor',
    as: 'contractor',
    setup: async ({ me }) => {
      // The runner's contractor has the plan but maybe no company yet (another package's route may
      // have set one earlier in a --pkg all run): give it one, and compare with whichever it has.
      let p = await me.get('/api/pro/profile');
      if (!p.body?.profile?.company) {
        const r = await me.put('/api/pro/profile', { company: 'Quinn Kitchens (QA)', phone: '555-0188', email: 'quinn@example.test', website: 'quinn.test', serviceArea: 'Hamilton', defaultMarkupPct: 30 });
        if (r.status !== 200) throw new Error(`setting the QA contractor's company failed (${r.status})`);
        p = await me.get('/api/pro/profile');
      }
      return { path: '#/pro/brand', company: p.body.profile.company };
    },
    waitFor: ['.brand-pitch'],
    expectText: ['Homeowners on BluModel Studio can find you', 'Set up my page'],
    check: async (h) => {
      await noSideScroll(h);
      await h.click('.brand-pitch a.btn.primary');
      await h.waitFor('.brand-settings');
      // Pre-filled from Company: the public name is the company's.
      const t0 = Date.now();
      while (!(await h.evaluate((c) => [...document.querySelectorAll('.brand-settings input')].some((i) => i.value === c), h.data.company))) {
        if (Date.now() - t0 > 5000) throw new Error(`the public name was not pre-filled from Company ("${h.data.company}")`);
        await h.sleep(100);
      }
    },
  },

  // ── Old portal routes redirect ───────────────────────────────────────────
  {
    name: 'redirect-brand-contractor',
    path: '#/brand/products',
    as: 'brand',
    waitFor: ['.brand-row'],
    check: async (h) => {
      const hash = await h.evaluate(() => location.hash);
      if (hash !== '#/pro/brand/products') throw new Error(`#/brand/products went to ${hash}`);
    },
  },
  {
    name: 'redirect-brand-join-customer',
    path: '#/brand/join',
    as: 'customer',
    waitFor: ['.pro-pitch-brand'],
    expectText: ['Get found', 'Start the Contractor plan'],
    check: noSideScroll,
  },

  // ── The public page ──────────────────────────────────────────────────────
  {
    name: 'public-brand-page',
    path: `#/b/${SLUG}`,
    as: 'anon',
    waitFor: ['.bp-card'],
    expectText: ['Verified contractor', 'Alder Shaker', 'Pine Street Slab', 'From $', 'Try in my kitchen', 'Request a quote'],
    check: async (h) => {
      await noSideScroll(h);
      const page = await h.api.get(`/api/brands/by-slug/${SLUG}`);
      if (page.status !== 200) throw new Error(`the public page wire returned ${page.status}`);
      assertNoCosts(page.body, 'the public page wire');
      const cat = await h.api.get('/api/catalog');
      assertNoCosts(cat.body, 'the public catalog');
      // The live version shows while an edit waits for review; nothing unapproved is public.
      const text = await h.evaluate(() => document.body.innerText);
      if (text.includes('(Glass Option)')) throw new Error('an unapproved edit is public');
      if (text.includes('Shaker Tall Pantry')) throw new Error('a product still in review is public');
      if (text.includes('Shaker Open Wall Shelf')) throw new Error('an unpublished product is public');
    },
  },
  {
    name: 'public-brand-page-phone',
    path: `#/b/${SLUG}`,
    as: 'anon',
    viewport: 'phone',
    waitFor: ['.bp-card'],
    expectText: ['Verified contractor', 'Contact Alder & Pine Cabinetry (Demo)'],
    fullPage: true,
    check: noSideScroll,
  },
  {
    name: 'public-lead-anon',
    path: `#/b/${SLUG}`,
    as: 'anon',
    waitFor: ['.bp-cta button'],
    check: async (h) => {
      await h.click('.bp-cta button');
      await h.waitFor('.lead-modal');
      await h.waitForText('Share these details with Alder & Pine Cabinetry (Demo) so they can contact me');
      // Name first, then consent: nothing is sent without them.
      await h.click('.lead-modal button[type="submit"]');
      await h.waitForText('Tell them your name.');
      await sendLead(h, { name: 'QA Homeowner', email: 'qa.homeowner@example.test' });
      await h.waitForText('Sent to Alder & Pine Cabinetry (Demo)');
      const lead = await inboxLead(h.api, 'QA Homeowner');
      if (!lead) throw new Error('the lead did not reach the contractor’s inbox');
      if (lead.status !== 'new') throw new Error(`a new lead has status ${lead.status}`);
    },
  },
  {
    name: 'public-quote-with-kitchen',
    as: 'customer',
    setup: async ({ me }) => {
      const k = await newKitchen(me, 'QA Lead Kitchen');
      return { path: `#/b/${SLUG}`, projectId: k.id };
    },
    waitFor: ['.bp-card-actions'],
    check: async (h) => {
      // "Request a quote" on a card attaches that product.
      await h.click(await mark(h, '.bp-card-actions button', 'Request a quote', 'quote'));
      await h.waitFor('.lead-modal .lead-about');
      await h.waitFor('.lead-modal select.brand-select:not([disabled])');
      await pick(h, '.lead-modal select.brand-select', h.data.projectId);
      await h.waitForText('gets a view-only link to it');
      await sendLead(h, { name: 'QA Kitchen Owner', email: 'qa.kitchen@example.test' });
      const lead = await inboxLead(h.api, 'QA Kitchen Owner');
      if (!lead) throw new Error('the lead did not reach the contractor’s inbox');
      if (lead.projectName !== 'QA Lead Kitchen') throw new Error(`the attached kitchen is "${lead.projectName}"`);
      if (!lead.productName) throw new Error('the product the homeowner came from is not attached');
      h.note(lead.shareToken ? 'the kitchen went as a view-only share link' : 'no share link (package E not merged here): the kitchen name only');
    },
  },
  {
    name: 'public-lead-form-phone',
    path: `#/b/${SLUG}`,
    as: 'anon',
    viewport: 'phone',
    waitFor: ['.bp-card-actions'],
    check: async (h) => {
      await fingerTap(h, await mark(h, '.bp-card-actions button', 'Request a quote', 'quote'));
      await h.waitFor('.lead-modal');
      const r = await h.evaluate(() => {
        const m = document.querySelector('.lead-modal').getBoundingClientRect();
        return { left: m.left, right: m.right, w: innerWidth };
      });
      if (r.left < -1 || r.right > r.w + 1) throw new Error(`the lead form is wider than the screen (${Math.round(r.left)}–${Math.round(r.right)} in ${r.w}px)`);
    },
  },
  {
    name: 'public-page-in-review-unavailable',
    path: `#/b/${IN_REVIEW}`,
    as: 'anon',
    waitFor: ['.bp-gone'],
    expectText: ['This page is unavailable'],
  },
  {
    // The viewer's ProductPage renders the brands' QuoteButton (wired at integration).
    name: 'product-page-request-a-quote',
    as: 'anon',
    setup: async ({ api }) => {
      const r = await api.get(`/api/brands/by-slug/${SLUG}`);
      const p = r.body?.products?.[0];
      if (!p) throw new Error('the demo page has no products');
      return { path: `#/p/${p.id}` };
    },
    waitFor: ['.quote-by'],
    expectText: ['Request a quote', 'Verified contractor'],
    timeoutMs: 8000,
  },

  // ── The Brand page tab on a phone ─────────────────────────────────────────
  { name: 'pro-brand-overview-phone', path: '#/pro/brand', as: 'brand', viewport: 'phone', waitFor: ['.brand-stats'], expectText: ['Page views'], fullPage: true, check: noSideScroll },
  { name: 'pro-brand-products-phone', path: '#/pro/brand/products', as: 'brand', viewport: 'phone', waitFor: ['.brand-row'], expectText: ['Show on my brand page'], fullPage: true, check: noSideScroll },
  { name: 'pro-brand-leads-phone', path: '#/pro/brand/leads', as: 'brand', viewport: 'phone', waitFor: ['.brand-lead'], expectText: ['Private notes'], fullPage: true, check: noSideScroll },
  { name: 'pro-brand-settings-phone', path: '#/pro/brand/settings', as: 'brand', viewport: 'phone', waitFor: ['.brand-settings'], expectText: ['Price on request'], fullPage: true, check: noSideScroll },

  // ── Admin ────────────────────────────────────────────────────────────────
  {
    name: 'admin-moderation',
    path: '#/admin/moderation',
    as: 'admin',
    waitFor: ['.mod-queue', '.mod-page'],
    expectText: ['Brand pages waiting for review', 'Birchwood Kitchen Studio (Demo)', 'Products waiting for review', 'GLB report'],
    check: async (h) => {
      await noSideScroll(h);
      // The edit to a live product shows a field-level diff against the live version.
      await h.click(await mark(h, '.mod-queue button', 'edit to a live product', 'edit'));
      await h.waitFor('.mod-diff-table');
      await h.waitForText('Changes against the live version');
      // The preview stays inside its box.
      const r = await h.evaluate(() => {
        const s = document.querySelector('.mod-stage .product-stage')?.getBoundingClientRect();
        const art = document.querySelector('.mod-stage .product-stage-art')?.getBoundingClientRect();
        return s && art ? { over: Math.round(art.bottom - s.bottom) } : null;
      });
      if (r && r.over > 2) throw new Error(`the product preview spills ${r.over}px out of its box`);
    },
  },
  {
    name: 'admin-moderation-phone',
    path: '#/admin/moderation',
    as: 'admin',
    viewport: 'phone',
    waitFor: ['.mod-queue'],
    expectText: ['Approve and verify'],
    fullPage: true,
    check: noSideScroll,
  },
  {
    name: 'admin-brands',
    path: '#/admin/brands',
    as: 'admin',
    waitFor: ['.adm-brand'],
    expectText: ['New partner brand', 'Alder & Pine Cabinetry (Demo)', 'Kestrel & Finch Appliances (Demo)', 'Contractor', 'Partner', 'Leads'],
    check: async (h) => {
      await noSideScroll(h);
      // Lead contents stay with the contractor: counts only here.
      const text = await h.evaluate(() => document.body.innerText);
      if (/example\.test|galley kitchen/i.test(text)) throw new Error('lead contents are showing in Admin → Brands');
      const r = await h.api.as('admin').get('/api/admin/brands');
      if (/example\.test|galley kitchen/i.test(JSON.stringify(r.body))) throw new Error('lead contents are in the admin brands wire');
    },
  },
  {
    name: 'admin-brands-phone',
    path: '#/admin/brands',
    as: 'admin',
    viewport: 'phone',
    waitFor: ['.adm-brand'],
    expectText: ['New partner brand'],
    fullPage: true,
    check: noSideScroll,
  },
];
