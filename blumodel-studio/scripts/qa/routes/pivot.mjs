// QA for the fixes made after the showroom pivot's review (key 'pivot-fix'), at 1440 and 390, light
// and dark where a screen is involved:
//   - #/pay/showroom/<ref>: the page a company's monthly-plan link and Stripe's return land on (sales
//     site, no sign-in): the demo payment completes and says the plan is active and the showroom live.
//   - a showroom still in setup: no empty sample preview, no "call or email us below" without contact
//     details, and sign-up refused (403 showroom_not_open).
//   - the demo showroom's seeded designs pass every design check (nothing through a wall), and every
//     demo lead has its design attached.
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
  await must(admin.post(`/api/admin/tenants/${t.id}/licenses`, { paidHow: 'comp' }), 'Recording the license');
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
