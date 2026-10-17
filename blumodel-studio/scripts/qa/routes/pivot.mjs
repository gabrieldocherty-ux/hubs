// QA for the fixes made after the showroom pivot's review (key 'pivot-fix'), at 1440 and 390, light
// and dark where a screen is involved:
//   - #/pay/showroom/<ref>: the page a company's monthly-plan link and Stripe's return land on (sales
//     site, no sign-in): the demo payment completes and says the plan is active and the showroom live.
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
  {
    name: 'pay-showroom-unknown',
    path: '#/pay/showroom/tc_doesNotExist0000000',
    as: 'anon',
    expectText: ['That payment link doesn’t exist.'],
  },
];
