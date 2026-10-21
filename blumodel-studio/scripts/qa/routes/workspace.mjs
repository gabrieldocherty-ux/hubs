// Company workspace QA (docs/SHOWROOM_PIVOT.md §5): #/studio on the seeded demo showroom at
// http://demo.localhost:<port> ("Northline Kitchen & Bath (Demo)"), for its owner and staff, at
// 1440 and 390, light and dark: the Showroom tab (branding with the live preview, the contrast
// warning, web addresses and the own-domain steps), Products (the catalog, Quick add, Request more
// products and a new request), Leads (the inbox and a lead), Renders (the credits), Team (an
// owner's invite form; staff see the team without it) and Plan (license, monthly plan, receipts);
// plus the workspace refusing a visitor and the sales site. Nothing of ours to buy anywhere in it.
// Run: node scripts/qa.mjs --pkg workspace --port 8915

const views = [
  // Light said outright: without it Edge follows the machine's setting.
  { suffix: '', viewport: 'desktop', colorScheme: 'light' },
  { suffix: '-dark', viewport: 'desktop', colorScheme: 'dark' },
  { suffix: '-phone', viewport: 'phone', colorScheme: 'light' },
  { suffix: '-phone-dark', viewport: 'phone', colorScheme: 'dark' },
];
const each = (r) => views.map((v) => ({ ...r, name: `${r.name}${v.suffix}`, viewport: v.viewport, colorScheme: v.colorScheme }));

/** No horizontal page scroll. */
async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

/** No Contractor-plan marketing, custom-model allowance or homeowner prices in the workspace. */
async function noOldPlans({ evaluate }) {
  const text = await evaluate(() => document.body.innerText);
  const words = [/contractor plan/i, /\b3 (custom )?models\b/i, /models? a month/i, /\bunlimited plan\b/i, /\bunlock\b/i, /\$5\b/, /start from a photo/i, /need a contractor/i, /\bwhere to buy\b/i];
  const hit = words.find((w) => w.test(text));
  if (hit) throw new Error(`the workspace shows "${text.match(hit)?.[0]}"`);
}

/**
 * Every visible link, button and field at least 44px tall on a touch screen (checkboxes and radios
 * sit inside 44px labels; links inside running text are exempt, WCAG 2.5.8).
 */
async function touchTargets({ evaluate, viewport }) {
  if (viewport !== 'phone') return;
  const small = await evaluate(() =>
    [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        if (!(r.width > 0 && r.height > 0) || s.visibility === 'hidden' || el.closest('[aria-hidden="true"]')) return false;
        if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file')) return false;
        if (el.tagName === 'A' && el.closest('p, li, td, .fine, .muted, span.ws-stat-note') && getComputedStyle(el).display === 'inline') return false;
        return true;
      })
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.height < 43.5)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(r.height)}px`),
  );
  if (small.length) throw new Error(`touch targets under 44px: ${small.slice(0, 8).join('; ')}`);
}

/** The usual checks for a workspace page. */
async function page(h) {
  await h.waitUntil(() => !document.querySelector('.ws-main .screen-msg'), 10_000, 'the tab to finish loading');
  await noSideScroll(h);
  await noOldPlans(h);
  await touchTargets(h);
}

/** The demo showroom's id. */
const demoId = (api) => api.sql("SELECT id FROM tenants WHERE slug = 'demo'")[0]?.id;

export default [
  // ── Showroom ─────────────────────────────────────────────────────────────
  ...each({
    name: 'showroom',
    host: 'demo',
    path: '#/studio',
    as: 'showroom-owner',
    fullPage: true,
    waitFor: ['.ws-tabs a[aria-current="page"]', '.ws-preview', '.ws-hosts li'],
    expectText: ['How your showroom looks', 'Northline Kitchen & Bath', 'Web addresses', 'demo.localhost', 'connect your own domain'],
    check: async (h) => {
      const t = await h.evaluate(() => ({ tab: document.querySelector('.ws-tabs a[aria-current="page"]')?.textContent, tabs: [...document.querySelectorAll('.ws-tabs a')].map((a) => a.textContent.replace(/\d+$/, '').trim()) }));
      if (t.tab !== 'Showroom') throw new Error(`#/studio opens the "${t.tab}" tab`);
      const want = ['Showroom', 'Products', 'Leads', 'Renders', 'Team', 'Plan'];
      if (t.tabs.join() !== want.join()) throw new Error(`the tabs are ${t.tabs.join(', ')}`);
      const unread = await h.evaluate(() => document.querySelector('.ws-tabs .badge')?.textContent ?? '');
      if (!/^\d+$/.test(unread)) throw new Error('the Leads tab has no unread badge for the seeded leads');
      await page(h);
    },
  }),
  // The contrast warning while typing a faint main colour (not saved).
  ...each({
    name: 'showroom-contrast',
    host: 'demo',
    path: '#/studio',
    as: 'showroom-owner',
    waitFor: ['input[aria-label="Main colour as a hex code"]', '.ws-preview'],
    check: async (h) => {
      if (await h.evaluate(() => !!document.querySelector('.ws-colour .ws-warn'))) throw new Error('the demo’s own colours already warn');
      await h.click('input[aria-label="Main colour as a hex code"]');
      await h.key('a', { modifiers: ['ctrl'] });
      await h.type('#ffee55');
      await h.waitFor('.ws-colour .ws-warn');
      const warn = await h.evaluate(() => document.querySelector('.ws-colour .ws-warn')?.textContent ?? '');
      if (!/faint on a white page/.test(warn)) throw new Error(`the warning reads "${warn}"`);
      const bg = await h.evaluate(() => getComputedStyle(document.querySelector('.ws-preview-bar') ?? document.querySelector('.ws-preview')).backgroundColor);
      if (!/255, 238, 85/.test(bg)) throw new Error(`the live preview didn’t take the new colour (${bg})`);
      await h.evaluate(() => document.querySelector('.ws-colour .ws-warn')?.scrollIntoView({ block: 'center' }));
      await noSideScroll(h);
    },
  }),

  // ── Products ─────────────────────────────────────────────────────────────
  ...each({
    name: 'products',
    host: 'demo',
    path: '#/studio/products',
    as: 'showroom-owner',
    waitFor: ['.ws-product-grid', '.ws-line'],
    expectText: ['Your catalog', 'Lakeshore Shaker', 'Harbourfront Slab', 'Request more products', 'Quick add'],
    check: page,
  }),
  ...each({
    name: 'product-new',
    host: 'demo',
    path: '#/studio/products/new',
    as: 'showroom-owner',
    waitFor: ['.ws-form', '.ws-form-preview'],
    expectText: ['Quick add a product'],
    check: page,
  }),
  ...each({
    name: 'requests',
    host: 'demo',
    path: '#/studio/products/requests',
    as: 'showroom-owner',
    waitFor: ['.ws-head h1'],
    expectText: ['Request more products'],
    check: page,
  }),
  ...each({
    name: 'request-new',
    host: 'demo',
    path: '#/studio/products/requests/new',
    as: 'showroom-owner',
    waitFor: ['.ws-head h1', 'input'],
    expectText: ['New request', 'UPC'],
    check: async (h) => {
      await page(h);
      const pay = await h.evaluate(() => /card number|pay now|checkout/i.test(document.body.innerText));
      if (pay) throw new Error('a product request asks for a payment in the app');
    },
  }),

  // ── Leads ────────────────────────────────────────────────────────────────
  // Everyone who used the showroom (docs/handoff/leads.md): the list with its columns, a lead with
  // tap-to-call/mailto, consent, the activity, each design's products and Open in 3D (view-only).
  ...each({
    name: 'leads',
    host: 'demo',
    path: '#/studio/leads',
    as: 'showroom-owner',
    waitFor: ['.ws-lead-table tbody tr', '.ws-filters'],
    expectText: ['Everyone who used your showroom', 'Riley Okafor', 'Morgan Lee', 'Sam Patel', 'Export CSV', 'Recent exports of this list'],
    check: async (h) => {
      const t = await h.evaluate(() => ({
        head: [...document.querySelectorAll('.ws-lead-table th')].map((th) => th.textContent.trim()),
        labels: [...document.querySelectorAll('.ws-lead-table tbody tr:first-child td')].map((td) => td.dataset.label),
        rows: document.querySelectorAll('.ws-lead-table tbody tr').length,
        mail: !!document.querySelector('.ws-lead-table a[href^="mailto:"]'),
        tel: !!document.querySelector('.ws-lead-table a[href^="tel:"]'),
        sent: !!document.querySelector('.ws-lead-sent'),
      }));
      const want = ['Name', 'Email', 'Phone', 'First seen', 'Last active', 'Designs', 'Sent', 'Status', 'Notes'];
      if (t.labels.join() !== want.join()) throw new Error(`the columns are ${t.labels.join(', ')}`);
      if (t.rows < 3) throw new Error(`${t.rows} leads listed`);
      if (!t.mail || !t.tel) throw new Error('the list’s email and phone are not mailto/tel links');
      if (!t.sent) throw new Error('no Sent filter');
      await page(h);
    },
  }),
  ...each({
    name: 'lead',
    host: 'demo',
    as: 'showroom-owner',
    setup: ({ api }) => {
      const id = api.sql("SELECT id FROM tenant_leads WHERE tenant_id = ? AND name = 'Riley Okafor' LIMIT 1", demoId(api))[0]?.id;
      if (!id) throw new Error('the demo showroom has no lead for Riley');
      return { path: `#/studio/leads/${id}` };
    },
    waitFor: ['.ws-lead-detail', '.ws-kv', '.ws-design-products li', '.ws-timeline li'],
    expectText: ['Riley Okafor', 'Contact', 'Consent', 'Your follow-up', 'Designs', 'Open in 3D', 'Activity', 'Sent a design to you', 'Contacted', 'Delete lead and designs'],
    timeoutMs: 30_000,
    check: async (h) => {
      const links = await h.evaluate(() => ({ mail: !!document.querySelector('.ws-lead-detail a[href^="mailto:"]'), tel: !!document.querySelector('.ws-lead-detail a[href^="tel:"]'), open: [...document.querySelectorAll('a[href]')].some((a) => /#\/studio\/leads\/[^/]+\/design\//.test(a.getAttribute('href') ?? '')) }));
      const notes = await h.evaluate(() => document.querySelector('.ws-lead-detail textarea')?.value ?? '');
      const consent = await h.evaluate(() => document.querySelector('[data-testid="lead-consent"]')?.textContent ?? '');
      if (!/site measure booked/.test(notes)) throw new Error(`the team's notes read "${notes}"`);
      if (!links.mail || !links.tel) throw new Error('the lead’s email and phone are not mailto/tel links');
      if (!links.open) throw new Error('no Open in 3D for the lead’s designs');
      if (!/may contact me/.test(consent) || !/Agreed/.test(consent)) throw new Error(`the consent reads "${consent}"`);
      await page(h);
    },
  }),
  {
    // Staff can't download the whole list unless an owner allows it (protect, 2026-10).
    name: 'leads-staff-no-export',
    host: 'demo',
    path: '#/studio/leads',
    as: 'showroom-staff',
    waitFor: ['.ws-lead-table tbody tr'],
    expectText: ['Everyone who used your showroom', 'Only an owner can export this list.'],
    check: async (h) => {
      const has = await h.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Export CSV')));
      if (has) throw new Error('staff are offered Export CSV');
      const status = await h.evaluate(async () => (await fetch('/api/workspace/leads/export', { credentials: 'same-origin' })).status);
      if (status !== 403) throw new Error(`a staff export answered ${status}`);
    },
  },
  ...[
    { suffix: '', viewport: 'desktop', colorScheme: 'light' },
    { suffix: '-phone-dark', viewport: 'phone', colorScheme: 'dark' },
  ].map((v) => ({
    name: `lead-design-3d${v.suffix}`,
    host: 'demo',
    as: 'showroom-staff',
    viewport: v.viewport,
    colorScheme: v.colorScheme,
    setup: ({ api }) => {
      const r = api.sql("SELECT l.id, p.id AS design FROM tenant_leads l JOIN projects p ON p.lead_id = l.id WHERE l.tenant_id = ? AND l.name = 'Riley Okafor' ORDER BY p.updated_at DESC LIMIT 1", demoId(api))[0];
      if (!r) throw new Error('Riley has no design');
      return { path: `#/studio/leads/${r.id}/design/${r.design}` };
    },
    waitFor: ['[data-testid="lead-design-view"]', '.plan-view canvas, .scene-view canvas'],
    expectText: ['Back to the lead', 'view only'],
    timeoutMs: 40_000,
    check: async (h) => {
      const r = await h.evaluate(() => ({ ro: window.__blumodel?.store?.getState?.().readOnly, send: !!document.querySelector('[data-testid="send-design"]'), save: !!document.querySelector('.save-chip.saved, .save-chip.unsaved') }));
      if (r.ro === false) throw new Error('the lead’s design opened editable');
      if (r.send) throw new Error('the team is offered to send the design to themselves');
      if (r.save) throw new Error('the view shows a save status');
      await noSideScroll(h);
    },
  })),

  // ── Renders ──────────────────────────────────────────────────────────────
  ...each({
    name: 'renders',
    host: 'demo',
    path: '#/studio/renders',
    as: 'showroom-owner',
    waitFor: ['.ws-renders .ws-stats'],
    expectText: ['Photoreal renders', 'credits left', 'History'],
    check: page,
  }),

  // ── Team ─────────────────────────────────────────────────────────────────
  ...each({
    name: 'team',
    host: 'demo',
    path: '#/studio/team',
    as: 'showroom-owner',
    waitFor: ['.ws-members .ws-member'],
    expectText: ['Who can open the workspace', 'Invite someone', 'demo-owner@blumodel.test', 'demo-staff@blumodel.test'],
    check: async (h) => {
      const n = await h.evaluate(() => document.querySelectorAll('.ws-member').length);
      if (n < 2) throw new Error(`the team shows ${n} people`);
      if (await h.evaluate(() => /demo-visitor@/.test(document.querySelector('.ws-members')?.textContent ?? ''))) throw new Error('a showroom visitor is listed on the team');
      await page(h);
    },
  }),
  {
    name: 'team-staff-phone',
    host: 'demo',
    path: '#/studio/team',
    as: 'showroom-staff',
    viewport: 'phone',
    colorScheme: 'light',
    waitFor: ['.ws-members .ws-member'],
    expectText: ['Who can open the workspace'],
    check: async (h) => {
      const r = await h.evaluate(() => ({ invite: /Invite someone/.test(document.body.innerText), roleSelect: !!document.querySelector('.ws-member select') }));
      if (r.invite || r.roleSelect) throw new Error('staff can invite people or change roles');
      await page(h);
    },
  },

  // ── Plan ─────────────────────────────────────────────────────────────────
  ...each({
    name: 'plan',
    host: 'demo',
    path: '#/studio/plan',
    as: 'showroom-owner',
    fullPage: true,
    waitFor: ['.ws-plan-grid', '.ws-breakdown'],
    expectText: ['Your plan', 'Yearly license', 'Monthly plan', 'Receipts'],
    check: async (h) => {
      const text = await h.evaluate(() => document.body.innerText);
      // The plan is hosting, running and the web address: no render credits promised (2026-10-20).
      if (!/\$50\.00 CAD|\$50 CAD/.test(text) || /render credits/i.test(text)) throw new Error('the monthly plan should read $50 for hosting, with no render credits');
      if (!/complimentary/i.test(text)) throw new Error('the demo’s complimentary plan isn’t said');
      await page(h);
    },
  }),

  // ── who can't open it ────────────────────────────────────────────────────
  {
    name: 'not-on-team',
    host: 'demo',
    path: '#/studio',
    as: 'showroom-visitor',
    waitFor: ['.ws-closed'],
    expectText: ['isn’t on this showroom’s team'],
    check: async (h) => {
      if (await h.evaluate(() => !!document.querySelector('.ws-tabs'))) throw new Error('a visitor sees the workspace tabs');
      await noSideScroll(h);
    },
  },
  {
    name: 'sales-site-phone',
    path: '#/studio',
    as: 'customer',
    viewport: 'phone',
    colorScheme: 'light',
    waitFor: ['.ws-closed'],
    expectText: ['opens on your showroom’s own web address'],
    check: async (h) => {
      if (await h.evaluate(() => !!document.querySelector('.ws-tabs'))) throw new Error('the sales site shows workspace tabs');
      await noSideScroll(h);
      await touchTargets(h);
    },
  },
  // The account menu opens the workspace for the team.
  {
    name: 'account-menu-phone',
    host: 'demo',
    path: '#/',
    as: 'showroom-staff',
    viewport: 'phone',
    colorScheme: 'light',
    waitFor: ['button.avatar'],
    check: async (h) => {
      await h.click('button.avatar');
      await h.waitForText('Staff');
      await h.shot('menu');
      const item = await h.evaluate(() => {
        const b = [...document.querySelectorAll('[role="menuitem"]')].find((x) => /Staff/.test(x.textContent ?? ''));
        if (!b) return null;
        b.setAttribute('data-qa-press', '1');
        return Math.round(b.getBoundingClientRect().height);
      });
      if (item === null) throw new Error('the account menu has no workspace entry for staff');
      if (item < 44) throw new Error(`the workspace menu entry is ${item}px tall`);
      await h.click('[data-qa-press="1"]');
      await h.waitUntil(() => location.hash.startsWith('#/studio'), 6000, 'the menu opening the workspace');
      await h.waitFor('.ws-tabs');
    },
  },
];
