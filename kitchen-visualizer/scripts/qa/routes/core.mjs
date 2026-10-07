// Core QA routes (BUILD_PLAN F-T12): the device planner, landing, home, new kitchen, an opened
// kitchen, Billing, the Contractor workspace, Admin, the export paywall and a demo plan payment,
// at desktop and phone sizes, plus a render smoke of every other routed screen.
// Run: node scripts/qa.mjs --pkg core --port 8811
//
// Selectors and texts here belong to foundation screens. Feature packages keep their own
// routes in scripts/qa/routes/<key>.mjs; the landing check deliberately looks only for the
// sign-in link so package E can replace the placeholder without breaking it.

/** A one-wall kitchen with an island, built from built-in products, as a saved doc. */
export function kitchenDoc(name = 'QA Kitchen') {
  const n = (id, productId, x, y, extra = {}) => ({ id, productId, x, y, rotation: 0, finishIndex: 0, ...extra });
  return {
    name,
    room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
    surfaces: { cabinetFinishId: 'white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'marble', backsplashId: 'subway', flooringId: 'oak', paintId: 'white' },
    items: [
      n('qa-fridge', 'fridge-36', 18, 15),
      n('qa-base-1', 'base', 48, 12),
      n('qa-sink', 'sink-farm', 78, 12),
      n('qa-dw', 'dishwasher', 108, 12),
      n('qa-base-2', 'base', 132, 12),
      n('qa-range', 'range-30', 159, 14),
      n('qa-hood', 'hood-chimney', 159, 10),
      n('qa-base-3', 'base', 186, 12),
      n('qa-island', 'island', 100, 93),
    ],
  };
}

/** Creates a kitchen for the route's user and returns `{ path, projectId, name }`. */
async function newKitchen(me, name) {
  const r = await me.post('/api/projects', { name, doc: kitchenDoc(name) });
  if (r.status !== 201) throw new Error(`creating "${name}" failed (${r.status}): ${r.body?.error ?? r.text}`);
  return { path: `#/k/${r.body.project.id}`, projectId: r.body.project.id, name };
}

/** No horizontal page scroll: layout breakage on phones usually shows up here first. */
async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

/** The phone editor shell: bottom bar pinned to the bottom, closed sheets off-screen, canvas filling the screen. */
async function phoneShell({ evaluate }) {
  const r = await evaluate(() => {
    const vis = (el) => {
      if (!el) return false;
      const s = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight - 1 && b.right > 0 && b.left < innerWidth;
    };
    const bar = document.querySelector('.mbar');
    const b = bar?.getBoundingClientRect();
    const stage = document.querySelector('.plan-view, .scene-view');
    const s = stage?.getBoundingClientRect();
    return {
      bar: b ? { top: Math.round(b.top), bottom: Math.round(b.bottom), position: getComputedStyle(bar).position } : null,
      openSheetsShown: [...document.querySelectorAll('.sheet:not(.is-open)')].filter(vis).map((e) => e.querySelector('.sheet-title')?.textContent?.trim() || e.className),
      stage: s ? { h: Math.round(s.height), w: Math.round(s.width) } : null,
      vh: innerHeight,
      vw: innerWidth,
    };
  });
  const problems = [];
  if (!r.bar) problems.push('no .mbar bottom bar');
  else if (r.bar.bottom > r.vh + 1 || r.bar.top < r.vh - 160) problems.push(`the bottom bar is not at the bottom of the screen (top ${r.bar.top}px, bottom ${r.bar.bottom}px, viewport ${r.vh}px, position ${r.bar.position})`);
  if (r.openSheetsShown.length) problems.push(`closed sheets are showing on the page: ${r.openSheetsShown.join(', ')}`);
  if (!r.stage || r.stage.h < r.vh * 0.5) problems.push(`the plan/3D stage is only ${r.stage?.h ?? 0}px tall in a ${r.vh}px screen`);
  if (problems.length) throw new Error(problems.join('; '));
}

const PHONE_SHELL_BUG =
  'The phone editor shell is unstyled: .mbar, .sheet and .sheet-* (MobileShell.tsx, Sheet.tsx) have no CSS anywhere in src/, so the Add/Room/Details sheets render inline under the plan. Owner: foundation styles (src/styles.css); see docs/handoff/qa.md.';

const SEL_TOOLBAR_BUG =
  'The floating selection toolbar is unstyled: .sel-toolbar, .sel-toolbar--<side> and .sel-toolbar-sep (SelectionToolbar.tsx) have no CSS, so selecting anything on desktop adds a static row of Rotate/Duplicate/Delete/Details text under the whole workspace. Owner: foundation styles (src/styles.css); see docs/handoff/qa.md.';

/** Clicks a top-bar view tab (Plan, Split, 3D, Walls) by its label. */
async function viewTab({ evaluate, click }, label) {
  const ok = await evaluate((l) => {
    const b = [...document.querySelectorAll('.views [role="tab"]')].find((x) => x.textContent.trim() === l);
    if (b) b.setAttribute('data-qa-tab', l);
    return !!b;
  }, label);
  if (!ok) throw new Error(`no "${label}" view tab`);
  await click(`[data-qa-tab="${label}"]`);
}

/**
 * Every routed screen renders something real: no blank page (a render crash unmounts the whole
 * app, and the console error that comes with it already fails the route), no sideways scroll.
 * Deliberately text-agnostic, so a feature package can replace its placeholder without
 * touching this file; packages check their own screens in scripts/qa/routes/<key>.mjs.
 */
async function rendersSomething(h) {
  await h.waitUntil(() => (document.querySelector('#root')?.innerText ?? '').trim().length >= 10, 10_000, 'the screen showing some text').catch(() => {});
  await h.sleep(500); // a lazy screen's chunk, then its first fetch
  const r = await h.evaluate(() => ({ text: (document.querySelector('#root')?.innerText ?? '').trim().length, hash: location.hash }));
  if (r.text < 10) throw new Error(`the screen is blank (${r.text} characters of text at ${r.hash})`);
  await noSideScroll(h);
}

/** The seeded demo range (server/seed/core.mjs), as /api/catalog lists it. */
async function demoProduct(api) {
  const r = await api.get('/api/catalog');
  const p = (r.body?.products ?? []).find((x) => x.name === 'Sample Gas Range 30″ (Demo)');
  if (!p) throw new Error('the seeded demo range is not in /api/catalog');
  return p;
}

/** Opens Export and picks a menu item by its bold label. */
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

export default [
  // ── Device planner (no account) ──────────────────────────────────────────
  {
    name: 'local-plan',
    path: '#/local',
    as: 'anon',
    waitFor: ['.plan-view canvas', '.topbar'],
    expectText: ['On this device'],
    check: async (h) => {
      await viewTab(h, 'Plan');
      await h.waitFor('.plan-view canvas');
      await h.sleep(400);
      await noSideScroll(h);
    },
  },
  {
    name: 'local-3d',
    path: '#/local',
    as: 'anon',
    waitFor: ['.topbar'],
    check: async (h) => {
      await viewTab(h, '3D');
      await h.waitFor('.scene-view canvas');
      await h.waitUntil(() => !document.querySelector('.scene-loading'), 20_000, 'the 3D scene loading');
      await h.sleep(1500);
      const c = await h.evaluate(() => {
        const cv = document.querySelector('.scene-view canvas');
        const r = cv.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      if (c.w < 600 || c.h < 400) throw new Error(`the 3D canvas is only ${c.w}×${c.h}`);
    },
  },
  {
    name: 'local-catalog-demo-brand',
    path: '#/local',
    as: 'anon',
    waitFor: ['.topbar', 'input[placeholder^="Search"]'],
    check: async (h) => {
      // The seeded demo brand's products arrive from /api/catalog and show in the panel.
      await h.click('input[placeholder^="Search"]');
      await h.type('Sample');
      await h.waitForText(['Sample Gas Range 30″ (Demo)', 'Sample Dome Pendant (Demo)']);
      await h.sleep(300);
    },
  },
  {
    name: 'local-phone',
    path: '#/local',
    as: 'anon',
    viewport: 'phone',
    waitFor: ['.plan-view canvas'],
    knownIssue: PHONE_SHELL_BUG,
    check: async (h) => {
      await noSideScroll(h);
      await phoneShell(h);
    },
  },
  {
    name: 'local-export-account-step',
    path: '#/local',
    as: 'anon',
    waitFor: ['.topbar'],
    check: async (h) => {
      // A device draft can't export: the Unlock dialog first asks for a free account.
      await exportItem(h, 'Project file');
      await h.waitFor('.modal.unlock[role="dialog"]');
      await h.waitForText('Exports are a paid feature');
    },
  },

  // ── Signed out ───────────────────────────────────────────────────────────
  {
    name: 'landing-signed-out',
    path: '#/',
    as: 'anon',
    waitFor: ['a[href="#/signin"]'],
    check: noSideScroll,
  },
  {
    name: 'landing-signed-out-phone',
    path: '#/',
    as: 'anon',
    viewport: 'phone',
    waitFor: ['a[href="#/signin"]'],
    check: noSideScroll,
  },
  {
    name: 'account-route-needs-sign-in',
    path: '#/account/billing',
    as: 'anon',
    waitFor: ['input[type="password"]'],
    expectText: ['Sign in to open your kitchens.'],
    check: async ({ evaluate }) => {
      const hash = await evaluate(() => location.hash);
      if (!hash.startsWith('#/signin')) throw new Error(`expected a redirect to #/signin, got ${hash}`);
    },
  },

  // ── Signed in (homeowner) ────────────────────────────────────────────────
  {
    name: 'home-signed-in',
    path: '#/',
    as: 'customer',
    // Only the kitchen is wanted here, not its path: the home screen is what this route is about.
    setup: async ({ me }) => ({ name: (await newKitchen(me, 'QA Home Kitchen')).name }),
    waitFor: ['.home', '.home-main'],
    expectText: ['QA Home Kitchen'],
    check: noSideScroll,
  },
  {
    name: 'home-signed-in-phone',
    path: '#/',
    as: 'customer',
    viewport: 'phone',
    knownIssue:
      'Kitchen cards on phones and tablets show no kitchen name: src/styles.css hides `.project-name` at max-width 980px for the editor top bar, and HomeScreen uses the same class for the card title. Scope the rule to `.topbar .project-name`; see docs/handoff/qa.md.',
    waitFor: ['.home', '.home-main'],
    expectText: ['QA Home Kitchen'],
    check: noSideScroll,
  },
  {
    name: 'new-kitchen',
    path: '#/new',
    as: 'customer',
    expectText: ['Let’s set up a new kitchen.'],
    check: noSideScroll,
  },
  {
    name: 'kitchen-open',
    as: 'customer',
    setup: async ({ me }) => newKitchen(me, 'QA Opened Kitchen'),
    waitFor: ['.topbar', '.plan-view canvas', '.scene-view canvas'],
    check: async (h) => {
      const name = await h.evaluate(() => document.querySelector('.topbar .project-name')?.value ?? document.querySelector('.topbar .project-name')?.textContent);
      if (name !== h.data.name) throw new Error(`the top bar shows "${name}", expected "${h.data.name}"`);
      await h.waitUntil(() => !document.querySelector('.scene-loading'), 20_000, 'the 3D scene loading');
      await h.waitForText('Saved', 10_000).catch(() => h.note('no "Saved" chip text seen'));
      await h.sleep(1200);
      await noSideScroll(h);
    },
  },
  {
    name: 'kitchen-selection-toolbar',
    as: 'customer',
    knownIssue: SEL_TOOLBAR_BUG,
    setup: async ({ me }) => newKitchen(me, 'QA Selection Kitchen'),
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      // Select the range through the store (exposed only with ?qa), as a click on it would.
      await h.waitUntil(() => !!window.__miseQA?.store, 10_000, 'window.__miseQA.store');
      await h.evaluate(() => window.__miseQA.store.getState().select('qa-range'));
      await h.waitFor('.sel-toolbar');
      await h.sleep(300);
      const t = await h.evaluate(() => {
        const el = document.querySelector('.sel-toolbar');
        const s = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        return { position: s.position, h: Math.round(b.height), w: Math.round(b.width), top: Math.round(b.top), left: Math.round(b.left) };
      });
      h.note(`selection toolbar ${t.w}×${t.h} at ${t.left},${t.top} (${t.position})`);
      if (t.position !== 'absolute' && t.position !== 'fixed') throw new Error(`the selection toolbar is not floating (position: ${t.position}); it is ${t.w}×${t.h}px in the page flow`);
      if (t.h > 90) throw new Error(`the selection toolbar is ${t.h}px tall`);
    },
  },
  {
    name: 'kitchen-open-phone',
    as: 'customer',
    viewport: 'phone',
    setup: async ({ me }) => newKitchen(me, 'QA Phone Kitchen'),
    waitFor: ['.topbar', '.plan-view canvas'],
    knownIssue: PHONE_SHELL_BUG,
    check: async (h) => {
      await noSideScroll(h);
      await phoneShell(h);
    },
  },

  // ── The export paywall (free user) ───────────────────────────────────────
  {
    name: 'unlock-dialog-free-user',
    as: 'fresh',
    setup: async ({ me }) => newKitchen(me, 'QA Paywall Kitchen'),
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await exportItem(h, 'Shopping list');
      await h.waitFor('.modal.unlock[role="dialog"]');
      await h.waitForText(['Unlock “QA Paywall Kitchen”', 'Unlock this kitchen · $5', 'Go Unlimited · $15/month']);
      // The server agrees: a free user's export is refused (403, needs an unlock).
      const r = await h.me.post(`/api/projects/${h.data.projectId}/exports`, { kind: 'csv' });
      if (r.status !== 403) throw new Error(`a free user's CSV export returned ${r.status}, expected 403`);
    },
  },
  {
    name: 'unlock-dialog-free-user-phone',
    as: 'fresh',
    viewport: 'phone',
    setup: async ({ me }) => newKitchen(me, 'QA Phone Paywall'),
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await exportItem(h, 'Floor plan');
      await h.waitFor('.modal.unlock[role="dialog"]');
      await h.waitForText('Unlock this kitchen · $5');
      const r = await h.evaluate(() => {
        const m = document.querySelector('.modal.unlock').getBoundingClientRect();
        return { left: m.left, right: m.right, w: innerWidth };
      });
      if (r.left < -1 || r.right > r.w + 1) throw new Error(`the Unlock dialog is wider than the screen (${Math.round(r.left)}–${Math.round(r.right)} in ${r.w}px)`);
    },
  },

  // ── Account → Billing ────────────────────────────────────────────────────
  {
    name: 'billing-free',
    path: '#/account/billing',
    as: 'customer',
    waitFor: ['.billing-current'],
    expectText: ['Billing', 'Current plan', 'Demo payments'],
    check: noSideScroll,
  },
  {
    name: 'billing-free-phone',
    path: '#/account/billing',
    as: 'customer',
    viewport: 'phone',
    waitFor: ['.billing-current'],
    expectText: ['Billing', 'Current plan'],
    check: noSideScroll,
  },

  // ── Contractor workspace ─────────────────────────────────────────────────
  {
    name: 'pro-setup',
    path: '#/pro',
    as: 'contractor',
    setup: async ({ me }) => {
      const u = await me.user();
      if (u.plan?.id !== 'contractor') throw new Error(`the contractor is on plan ${u.plan?.id}`);
      return {};
    },
    expectText: ['Your company'],
    check: noSideScroll,
  },
  {
    name: 'pro-dashboard',
    path: '#/pro',
    as: 'contractor',
    setup: async ({ me }) => {
      const r = await me.put('/api/pro/profile', { company: 'Quinn & Co. Kitchens (QA)', serviceArea: 'Testville', defaultMarkupPct: 30 });
      if (r.status !== 200) throw new Error(`saving the company failed (${r.status}): ${r.body?.error ?? r.text}`);
      return {};
    },
    expectText: ['Quinn & Co. Kitchens (QA)'],
    check: noSideScroll,
  },
  {
    name: 'pro-dashboard-phone',
    path: '#/pro',
    as: 'contractor',
    viewport: 'phone',
    expectText: ['Quinn & Co. Kitchens (QA)'],
    check: noSideScroll,
  },

  // ── Admin ────────────────────────────────────────────────────────────────
  {
    name: 'admin-overview',
    path: '#/admin/overview',
    as: 'admin',
    waitFor: ['.admin-overview'],
    expectText: ['Overview', 'Users'],
    check: noSideScroll,
  },

  // ── Paying for a plan (demo checkout, end to end in the browser) ─────────
  {
    name: 'pay-demo-plan-unlimited',
    as: 'fresh',
    setup: async ({ me }) => {
      const k = await newKitchen(me, 'QA Unlimited Kitchen');
      const c = await me.post('/api/billing/checkout', { kind: 'subscription', plan: 'unlimited' });
      if (c.status >= 300 || !c.body?.ref) throw new Error(`starting the Unlimited demo checkout failed (${c.status}): ${c.body?.error ?? c.text}`);
      return { path: `#/pay/demo-plan/${c.body.ref}`, projectId: k.projectId };
    },
    waitFor: ['.demo-pay-card', '.demo-pay-actions .btn.primary'],
    expectText: ['Checkout · Demo', 'Mise never sees or stores card details'],
    check: async (h) => {
      // No card fields, ever: payments are demo or Stripe-hosted.
      const cardish = await h.evaluate(() => [...document.querySelectorAll('input')].filter((i) => /card|cc-|cvc|cvv|expir/i.test(`${i.name} ${i.id} ${i.autocomplete} ${i.placeholder}`)).length);
      if (cardish) throw new Error(`${cardish} card-like input(s) on the demo payment page`);
      await noSideScroll(h);
      await h.shot('checkout');
      await h.click('.demo-pay-actions .btn.primary');
      // Success goes back to where the checkout started (Billing, by default) on the new plan.
      await h.waitUntil(() => !location.hash.startsWith('#/pay/'), 15_000, 'returning from the demo checkout');
      await h.waitFor('.billing-current');
      await h.waitForText(['Unlimited', 'Renews on']);
      const me = await h.me.get('/api/auth/me');
      const plan = me.body?.user?.plan?.id;
      if (plan !== 'unlimited') throw new Error(`after a successful demo payment the plan is "${plan}", expected "unlimited"`);
      const r = await h.me.post(`/api/projects/${h.data.projectId}/exports`, { kind: 'csv' });
      if (r.status !== 200) throw new Error(`an Unlimited user's CSV export returned ${r.status}: ${r.body?.error ?? r.text.slice(0, 200)}`);
    },
  },

  // ── Every other routed screen renders (smoke; packages own the details) ──
  ...[
    { name: 'screen-signup-phone', path: '#/signup', as: 'anon', viewport: 'phone', waitFor: ['input[type="password"]'] },
    { name: 'screen-welcome', path: '#/welcome', as: 'anon' },
    { name: 'screen-welcome-phone', path: '#/welcome', as: 'anon', viewport: 'phone' },
    { name: 'screen-pricing', path: '#/pricing', as: 'anon' },
    { name: 'screen-pricing-phone', path: '#/pricing', as: 'anon', viewport: 'phone' },
    { name: 'screen-generate', path: '#/generate', as: 'customer' },
    {
      name: 'screen-product-demo',
      as: 'anon',
      setup: async ({ api }) => ({ path: `#/p/${(await demoProduct(api)).id}` }),
    },
    { name: 'screen-brand-page-demo', path: '#/b/mise-sample-co-demo', as: 'anon' },
    { name: 'screen-brand-portal', path: '#/brand', as: 'brand' },
    { name: 'screen-orders', path: '#/orders', as: 'customer' },
    ...['moderation', 'brands', 'studio', 'revenue', 'billing', 'users'].map((tab) => ({ name: `admin-${tab}`, path: `#/admin/${tab}`, as: 'admin' })),
  ].map((r) => ({ waitFor: ['#root *'], ...r, check: rendersSomething })),
];
