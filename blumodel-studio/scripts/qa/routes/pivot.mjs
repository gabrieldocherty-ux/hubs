// QA for the fixes made after the showroom pivot's review (key 'pivot-fix'), at 1440 and 390, light
// and dark where a screen is involved:
//   - #/pay/showroom/<ref>: the page a company's monthly-plan link and Stripe's return land on (sales
//     site, no sign-in): the demo payment completes and says the plan is active and the showroom live.
//   - a showroom still in setup: no empty sample preview, no "call or email us below" without contact
//     details, and sign-up refused (403 showroom_not_open).
//   - the demo showroom's seeded designs pass every design check (nothing through a wall), and every
//     demo lead has its design attached.
//   - the showroom catalog leads with the company's products; BluModel Basics come last, under their
//     own heading, and last in the line select.
//   - on a phone the links the review measured under 44 px (the editor's back link, the workspace's
//     company link, product names, the Renders tab's inline link) are 44 px tall.
//   - a showroom's 404 and legal pages keep the company's header and footer: no Refunds (visitors
//     never pay), the © is the company's, #/refunds goes to the terms, which open at the visitors' part.
// Every screen route checks: no sideways scroll, and 44 px touch targets on phones.
// Run: node scripts/qa.mjs --pkg pivot --port 8955

const views = [
  { suffix: '', viewport: 'desktop', colorScheme: 'light' },
  { suffix: '-dark', viewport: 'desktop', colorScheme: 'dark' },
  { suffix: '-phone', viewport: 'phone', colorScheme: 'light' },
  { suffix: '-phone-dark', viewport: 'phone', colorScheme: 'dark' },
];
const view = (v) => ({ viewport: v.viewport, colorScheme: v.colorScheme });
const isPhone = (h) => !!h.viewport?.mobile;

/** In the page: sideways scroll, and (on a touch screen) controls under 44 px tall. */
function audit(touch) {
  const out = { overflow: 0, small: [] };
  if (document.documentElement.scrollWidth > innerWidth + 1) out.overflow = document.documentElement.scrollWidth;
  if (touch)
    for (const el of document.querySelectorAll('a, button, summary, select, input:not([type="hidden"]), textarea')) {
      if (el.closest('[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      let hidden = false;
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) hidden = true;
      }
      if (hidden) continue;
      // A link inside running text is exempt (WCAG 2.5.8).
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li, dd')) continue;
      if (r.height < 43.5) out.small.push(`${String(el.textContent || el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)} <${el.tagName.toLowerCase()}${[...el.classList].slice(0, 2).map((c) => `.${c}`).join('')}> ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  out.small = [...new Set(out.small)].slice(0, 20);
  return out;
}

export async function layoutOk(h) {
  const a = await h.evaluate(audit, isPhone(h));
  const p = [];
  if (a.overflow) p.push(`scrolls sideways (${a.overflow}px)`);
  if (a.small.length) p.push(`touch targets under 44px: ${a.small.join('; ')}`);
  if (p.length) throw new Error(p.join(' | '));
}

const must = async (p, what) => {
  const r = await p;
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${r.text?.slice(0, 200)}`);
  return r.body;
};

/** A new company with a current license and a pending demo monthly-plan link: its checkout ref. */
async function pendingMonthly(api, tag) {
  const admin = api.as('admin');
  const slug = `qa-pay-${tag}-${Date.now().toString(36)}`.slice(0, 40);
  const t = (await must(admin.post('/api/admin/tenants', { name: 'Harbour Cabinet Co (QA)', slug, contact: { phone: '519-555-0142' } }), 'Creating the company')).tenant;
  await must(admin.post(`/api/admin/tenants/${t.id}/licenses`, { paidHow: 'comp', amountCents: 0 }), 'Recording the license');
  await must(admin.post(`/api/admin/tenants/${t.id}/status`, { status: 'live' }), 'Launching it');
  const c = (await must(admin.post(`/api/admin/tenants/${t.id}/monthly/checkout`), 'Making the monthly link')).checkout;
  if (!String(c.url).endsWith(`#/pay/showroom/${c.ref}`)) throw new Error(`the demo link is ${c.url}`);
  return { path: `/pay/showroom/${c.ref}`, tenantId: t.id, slug, ref: c.ref };
}

/** The company 'qa-setup' (status setup, no contact details), made once. */
async function setupCompany(api) {
  const admin = api.as('admin');
  const list = (await must(admin.get('/api/admin/tenants'), 'Listing companies')).tenants;
  if (!list.some((t) => t.slug === 'qa-setup')) await must(admin.post('/api/admin/tenants', { name: 'Setup Street Kitchens', slug: 'qa-setup' }), 'Creating the setup company');
  return { path: '/' };
}

/** Fails when any element matching `selector` is shown under 44 px tall. */
async function tall(h, selector) {
  const r = await h.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)]
        .map((el) => el.getBoundingClientRect())
        .filter((b) => b.width > 0)
        .map((b) => Math.round(b.height)),
    selector,
  );
  if (!r.length) throw new Error(`no ${selector} on the page`);
  const small = r.filter((x) => x < 44);
  if (small.length) throw new Error(`${selector} is ${small.join(', ')} px tall on a phone`);
}

export default [
  // ── the monthly-plan payment page ──────────────────────────────────────────
  ...views.map((v) => ({
    name: `pay-showroom${v.suffix}`,
    as: 'anon',
    ...view(v),
    setup: async ({ api }) => pendingMonthly(api, v.suffix.replace(/-/g, '') || 'd'),
    waitFor: ['.demo-pay-card h1'],
    expectText: ['Harbour Cabinet Co (QA)', '$50 CAD', 'Simulate successful payment', 'DEMO PAYMENT'],
    check: async (h) => {
      await layoutOk(h);
      await h.shot('pending');
      await h.click('.demo-pay-actions .btn.primary');
      await h.waitForText('monthly plan is active and the showroom is live');
      const href = await h.evaluate(() => document.querySelector('.demo-pay-card a.btn.primary')?.getAttribute('href'));
      const port = new URL(await h.evaluate(() => location.href)).port;
      if (href !== `http://${h.data.slug}.localhost:${port}`) throw new Error(`"Open the showroom" goes to ${href}`);
      const t = (await must(h.api.as('admin').get(`/api/admin/tenants/${h.data.tenantId}`), 'Reading the company')).tenant;
      if (t.status !== 'live' || !t.monthly || t.monthly.status !== 'active') throw new Error(`after paying the company is ${t.status}, monthly ${t.monthly?.status}`);
      await layoutOk(h);
    },
  })),
  {
    name: 'pay-showroom-cancel-phone',
    as: 'anon',
    viewport: 'phone',
    colorScheme: 'light',
    setup: async ({ api }) => pendingMonthly(api, 'c'),
    waitFor: ['.demo-pay-actions'],
    check: async (h) => {
      await h.click('.demo-pay-actions .btn:not(.primary)');
      await h.waitForText('Payment didn’t go through');
      await layoutOk(h);
    },
  },
  ...[views[0], views[3]].map((v) => ({
    name: `setup-landing${v.suffix}`,
    as: 'anon',
    host: 'qa-setup',
    ...view(v),
    setup: async ({ api }) => setupCompany(api),
    waitFor: ['#sr-title'],
    expectText: ['Our virtual showroom opens soon.'],
    check: async (h) => {
      const r = await h.evaluate(() => ({ text: document.body.innerText, plan: !!document.querySelector('.sr-hero-plan'), cta: !!document.querySelector('.sr-cta') }));
      if (/call or email us below/i.test(r.text)) throw new Error('it says "call or email us below" with no contact details');
      if (r.plan) throw new Error('the empty sample preview is shown');
      if (r.cta) throw new Error('a Design button is offered before the showroom opens');
      const su = await h.evaluate(async () => {
        const res = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BluModel': '1' }, body: JSON.stringify({ name: 'QA', email: `qa${Date.now()}@walk.test`, password: 'qa password 123' }) });
        return { status: res.status, code: (await res.json()).code };
      });
      if (su.status !== 403 || su.code !== 'showroom_not_open') throw new Error(`sign-up answered ${su.status} ${su.code}`);
      await layoutOk(h);
    },
  })),
  ...[
    { name: 'Riley’s sage shaker kitchen', as: 'showroom-visitor', who: 'demo-visitor@blumodel.test' },
    { name: 'Morgan’s condo kitchen', as: 'showroom-staff', who: 'demo-staff@blumodel.test' },
    { name: 'Patel family kitchen', as: 'showroom-staff', who: 'demo-staff@blumodel.test' },
  ].map((d, i) => ({
    name: `demo-design-checks-${i + 1}`,
    host: 'demo',
    as: d.as,
    viewport: 'desktop',
    colorScheme: i === 1 ? 'dark' : 'light',
    setup: async ({ api }) => {
      const row = api.sql("SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id WHERE u.email = ? AND p.tenant_id = 't_demo' AND p.name = ?", d.who, d.name)[0];
      if (!row) throw new Error(`no seeded design "${d.name}"`);
      return { path: `/k/${row.id}` };
    },
    waitFor: ['.plan-view canvas'],
    expectText: ['Layout passes every design check'],
    waitMs: 1500,
  })),
  ...[views[0], views[3]].map((v) => ({
    name: `catalog-company-first${v.suffix}`,
    host: 'demo',
    as: 'showroom-visitor',
    ...view(v),
    setup: async ({ api }) => {
      const row = api.sql("SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id WHERE u.email = 'demo-visitor@blumodel.test' AND p.tenant_id = 't_demo' ORDER BY p.name LIMIT 1")[0];
      return { path: `/k/${row.id}` };
    },
    waitFor: ['.plan-view canvas'],
    check: async (h) => {
      if (isPhone(h)) {
        await h.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^\s*Add\s*$/.test(b.textContent))?.click());
      }
      await h.waitFor('.catalog-group h4', 10_000);
      const r = await h.evaluate(() => ({
        groups: [...document.querySelectorAll('.catalog-group')].map((g) => ({ h: g.querySelector('h4')?.textContent ?? '', first: g.querySelector('.product-card')?.textContent ?? '' })),
        options: [...document.querySelectorAll('#catalog-brand option, select[aria-label="Line"] option')].map((o) => o.textContent),
      }));
      const cab = r.groups[0];
      if (!cab || cab.h !== 'Cabinets') throw new Error(`the first group is ${JSON.stringify(cab)}`);
      if (/BluModel Basics/.test(cab.first)) throw new Error(`the first cabinet is a Basics one: ${cab.first.slice(0, 80)}`);
      const basicsAt = r.groups.findIndex((g) => /basics/i.test(g.h));
      if (basicsAt < 1) throw new Error(`no Basics heading after the company's cabinets: ${r.groups.map((g) => g.h).join(' | ')}`);
      const opts = r.options.filter((o) => !/^All lines/.test(o));
      if (opts.length && !/BluModel Basics/.test(opts[opts.length - 1])) throw new Error(`Basics isn't last in the line select: ${opts.join(', ')}`);
      await h.shot('catalog');
      // A showroom has no billing: the editor never asks for entitlements there (it was a 404 each load).
      const asked = await h.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/billing/')).length);
      if (asked) throw new Error(`the showroom editor called /api/billing/ ${asked} time(s)`);
    },
  })),
  {
    name: 'touch-workspace-products-phone',
    host: 'demo',
    as: 'showroom-owner',
    path: '#/studio/products',
    viewport: 'phone',
    colorScheme: 'light',
    waitFor: ['.ws-product-name'],
    check: async (h) => {
      await tall(h, '.ws-company');
      await tall(h, '.ws-product-name');
    },
  },
  {
    name: 'touch-workspace-renders-phone',
    host: 'demo',
    as: 'showroom-owner',
    path: '#/studio/renders',
    viewport: 'phone',
    colorScheme: 'dark',
    waitFor: ['.ws-inline-link'],
    check: async (h) => tall(h, '.ws-inline-link'),
  },
  {
    name: 'touch-editor-back-phone',
    host: 'demo',
    as: 'showroom-visitor',
    viewport: 'phone',
    colorScheme: 'light',
    setup: async ({ api }) => ({ path: `/k/${api.sql("SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id WHERE u.email = 'demo-visitor@blumodel.test' ORDER BY p.name LIMIT 1")[0].id}` }),
    waitFor: ['.plan-view canvas'],
    check: async (h) => {
      if (await h.evaluate(() => !!document.querySelector('.back-link'))) await tall(h, '.back-link');
    },
  },
  ...[views[0], views[3]].map((v) => ({
    name: `showroom-404${v.suffix}`,
    host: 'demo',
    as: 'anon',
    path: '#/no/such/page',
    ...view(v),
    expectText: ['We can’t find that page', 'Design your kitchen', '© 2026 Northline Kitchen & Bath'],
    check: async (h) => {
      const r = await h.evaluate(() => ({ refunds: !!document.querySelector('a[href="#/refunds"]'), text: document.body.innerText }));
      if (r.refunds) throw new Error('the showroom 404 links Refunds');
      if (/BluModel Studio/.test(r.text)) throw new Error('the showroom 404 says BluModel Studio');
      await layoutOk(h);
    },
  })),
  ...[views[0], views[3]].map((v) => ({
    name: `showroom-terms${v.suffix}`,
    host: 'demo',
    as: 'anon',
    path: '#/refunds',
    ...view(v),
    waitFor: ['#legal-visitors', '.legal-bar .site-logo, .legal-bar .brand'],
    expectText: ['If you are visiting a showroom', 'Northline Kitchen & Bath’s showroom'],
    check: async (h) => {
      await h.waitUntil(() => location.hash === '#/terms', 5000, '#/refunds going to #/terms');
      const r = await h.evaluate(() => ({
        refunds: !!document.querySelector('a[href="#/refunds"]'),
        owner: document.querySelector('.legal-links-owner')?.textContent ?? '',
        top: Math.round(document.getElementById('legal-visitors').getBoundingClientRect().top),
        brand: document.querySelector('.legal-bar .brand')?.getAttribute('aria-label') ?? '',
      }));
      if (r.refunds) throw new Error('the showroom legal pages link Refunds');
      if (!/Northline/.test(r.owner)) throw new Error(`the footer says ${r.owner}`);
      if (!/Northline/.test(r.brand)) throw new Error(`the header is ${r.brand}`);
      if (r.top > 300) throw new Error(`the terms didn't open at the visitors' part (it is ${r.top}px down)`);
      await layoutOk(h);
    },
  })),
  {
    name: 'demo-leads-have-designs',
    host: 'demo',
    as: 'showroom-owner',
    path: '#/studio/leads',
    viewport: 'desktop',
    colorScheme: 'light',
    waitFor: ['.ws-tabs'],
    expectText: ['Riley Okafor', 'Morgan Lee', 'Sam Patel'],
    check: async (h) => {
      const n = h.api.sql("SELECT COUNT(*) AS n FROM showroom_leads WHERE tenant_id = 't_demo' AND share_token IS NULL")[0].n;
      if (n) throw new Error(`${n} demo lead(s) have no design`);
    },
  },
  {
    name: 'pay-showroom-unknown',
    path: '#/pay/showroom/tc_doesNotExist0000000',
    as: 'anon',
    expectText: ['That payment link doesn’t exist.'],
  },
];
