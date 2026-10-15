// Account QA routes (the 'account' package): Account settings and its sections, the appearance
// switch (data-theme on <html>, saved locally and to the account), the cost estimator switch (off by
// default), the account menu (Make custom models; contractor entries for contractors only),
// forgot password (support path, reset link, expired link, Admin > Users > Create reset link) and
// the contractor company's required business name and phone.
// Run: node scripts/qa.mjs --pkg account --port 8870 --dist .build/account --strict-external
//
// The QA server has no email provider (qa.mjs strips the keys), so "Forgot password?" shows the
// contact-support path and reset links come from an admin, as they do on a server without email.

import { kitchenDoc } from './core.mjs';

/** No horizontal page scroll. */
async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what} failed (${r.status}): ${r.body?.error ?? String(r.text ?? '').slice(0, 200)}`);
  return r;
};

/** Marks the first element matching `selector` whose text includes `text`, and returns its selector. */
async function mark({ evaluate }, selector, text, tag) {
  const ok = await evaluate(
    (sel, t, q) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.replace(/\s+/g, ' ').trim().toLowerCase().includes(t.toLowerCase()));
      if (el) el.setAttribute('data-qa-mark', q);
      return !!el;
    },
    selector,
    text,
    tag,
  );
  if (!ok) throw new Error(`no ${selector} with "${text}"`);
  return `[data-qa-mark="${tag}"]`;
}

/** A fresh user on the Contractor plan (the demo checkout, as the app does it). */
async function freshContractor(api) {
  const me = api.as('fresh');
  const c = must(await me.post('/api/billing/checkout', { kind: 'subscription', plan: 'contractor' }), 'Contractor demo checkout');
  must(await me.post(`/api/billing/demo/${c.body.ref}/complete`, { outcome: 'success' }), 'Completing the demo checkout');
  return me;
}

/** A reset link for a fresh account, made by the admin, as the `#/signin?reset=…` hash. */
async function adminResetHash(api) {
  const u = await api.as('fresh').user();
  const r = must(await api.as('admin').post(`/api/admin/users/${u.id}/reset-link`), 'Making a reset link');
  const hash = String(r.body.url).slice(String(r.body.url).indexOf('#'));
  if (!/^#\/signin\?reset=[A-Za-z0-9_-]{43}$/.test(hash)) throw new Error(`unexpected reset link ${hash.slice(0, 30)}…`);
  return { path: hash, email: u.email };
}

const settingsTexts = ['Profile', 'Security', 'Preferences', 'Appearance', 'Show cost estimator', 'Plan & billing', 'Your data'];

/** Settings for a non-contractor: no Company section, no email section (no provider), the estimator off. */
async function settingsBasics(h) {
  await noSideScroll(h);
  const r = await h.evaluate(() => ({
    nav: [...document.querySelectorAll('.set-nav button')].map((b) => b.textContent.trim()),
    switches: [...document.querySelectorAll('[role="switch"]')].map((s) => [s.id, s.getAttribute('aria-checked')]),
    theme: document.documentElement.getAttribute('data-theme'),
  }));
  if (r.nav.includes('Company')) throw new Error('a non-contractor sees the Company section');
  if (r.nav.includes('Email notifications')) throw new Error('Email notifications shows with no email provider');
  const est = r.switches.find(([id]) => /estimator/.test(id));
  if (!est) throw new Error(`no cost estimator switch (switches: ${JSON.stringify(r.switches)})`);
  if (est[1] !== 'false') throw new Error('the cost estimator is not off by default');
  if (r.theme !== 'light' && r.theme !== 'dark') throw new Error(`<html data-theme> is ${r.theme}`);
}

export default [
  // ── Account settings ──────────────────────────────────────────────────────
  {
    name: 'settings',
    path: '#/account',
    as: 'fresh',
    expectText: settingsTexts,
    check: settingsBasics,
  },
  {
    name: 'settings-phone',
    path: '#/account',
    as: 'fresh',
    viewport: 'phone',
    expectText: settingsTexts,
    check: settingsBasics,
  },
  {
    name: 'settings-security',
    path: '#/account',
    as: 'fresh',
    expectText: ['This device', 'Change password'],
    check: async (h) => {
      await h.evaluate(() => document.getElementById('set-security')?.scrollIntoView({ block: 'start' }));
      await h.sleep(200);
      await noSideScroll(h);
    },
  },
  {
    name: 'settings-dark',
    path: '#/account',
    as: 'fresh',
    expectText: ['Appearance'],
    check: async (h) => {
      await h.evaluate(() => document.getElementById('set-preferences')?.scrollIntoView({ block: 'start' }));
      await h.click(await mark(h, '.set-seg [role="radio"]', 'Dark', 'theme-dark'));
      await h.waitUntil(() => document.documentElement.getAttribute('data-theme') === 'dark', 4000, 'data-theme="dark" on <html>');
      const saved = (await h.me.get('/api/account/prefs')).body.prefs.theme;
      if (saved !== 'dark') throw new Error(`the account saved theme "${saved}"`);
      const local = await h.evaluate(() => localStorage.getItem('blumodel.theme'));
      if (local !== 'dark') throw new Error(`this browser saved "${local}"`);
      // Before first paint on a reload: theme-boot.js sets it from the saved choice.
      await h.reload();
      const boot = await h.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (boot !== 'dark') throw new Error(`after a reload <html data-theme> is ${boot}`);
      await h.waitForText('Appearance');
      await h.evaluate(() => document.getElementById('set-preferences')?.scrollIntoView({ block: 'start' }));
      await h.sleep(200);
      await h.shot('dark');
      // Back to System, so later routes in this browser start from the default.
      await h.click(await mark(h, '.set-seg [role="radio"]', 'System', 'theme-system'));
      await h.waitUntil(() => document.documentElement.getAttribute('data-theme-pref') === 'system', 4000, 'data-theme-pref="system"');
      const back = (await h.me.get('/api/account/prefs')).body.prefs.theme;
      if (back !== 'system') throw new Error(`the account kept theme "${back}"`);
    },
  },

  // ── the cost estimator switch ─────────────────────────────────────────────
  {
    name: 'editor-estimator-off',
    as: 'fresh',
    setup: async ({ me }) => {
      const r = must(await me.post('/api/projects', { name: 'QA Estimator', doc: kitchenDoc('QA Estimator') }), 'Creating a kitchen');
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: '.plan-view canvas',
    check: async (h) => {
      const off = await h.evaluate(() => ({
        est: [...document.querySelectorAll('span')].some((e) => e.children.length === 0 && e.textContent.trim() === 'Est.'),
        tab: [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.trim().startsWith('Estimate')),
        total: /estimated/i.test(document.querySelector('.right-panel')?.innerText ?? ''),
      }));
      if (off.est) throw new Error('the Est. chip shows with the estimator off (the default)');
      if (off.tab) throw new Error('the Estimate tab shows with the estimator off (the default)');
      if (off.total) throw new Error('the overview shows an estimated total with the estimator off (the default)');
      await h.shot('off');
      must(await h.me.patch('/api/account/prefs', { showEstimator: true }), 'Turning the estimator on');
      await h.reload();
      await h.waitFor('.plan-view canvas');
      await h.waitUntil(() => [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.trim().startsWith('Estimate')), 8000, 'the Estimate tab once the estimator is on');
      await h.shot('on');
    },
  },

  // ── the account menu ──────────────────────────────────────────────────────
  {
    name: 'menu-customer',
    path: '#/',
    as: 'fresh',
    waitFor: '.avatar',
    check: async (h) => {
      const bar = await h.evaluate(() => [...document.querySelectorAll('header')].map((e) => e.innerText).join(' '));
      for (const gone of ['My orders', 'Request a model', 'Make custom models']) if (bar.includes(gone)) throw new Error(`"${gone}" is still in the bar beside the account menu`);
      await h.click('.avatar');
      await h.waitFor('.menu[role="menu"]');
      const items = await h.evaluate(() => [...document.querySelectorAll('.menu [role="menuitem"]')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
      if (!items.some((t) => t.startsWith('Make custom models'))) throw new Error(`no "Make custom models" in the menu: ${items.join(' | ')}`);
      if (items.some((t) => /contractor/i.test(t))) throw new Error(`a customer sees a contractor entry: ${items.join(' | ')}`);
    },
  },
  {
    name: 'menu-contractor',
    path: '#/',
    as: 'contractor',
    waitFor: '.avatar',
    check: async (h) => {
      await h.click('.avatar');
      await h.waitFor('.menu[role="menu"]');
      const items = await h.evaluate(() => [...document.querySelectorAll('.menu [role="menuitem"]')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
      if (!items.some((t) => t.startsWith('Contractor workspace'))) throw new Error(`a contractor has no "Contractor workspace": ${items.join(' | ')}`);
    },
  },

  // ── forgot password ───────────────────────────────────────────────────────
  {
    name: 'signin-forgot-link',
    path: '#/signin',
    expectText: ['Welcome back', 'Forgot password?'],
    check: async (h) => {
      await h.click(await mark(h, '.auth-forgot a', 'Forgot password?', 'forgot'));
      await h.waitForText(['Reset your password', 'support']);
      await noSideScroll(h);
    },
  },
  {
    name: 'forgot-support-phone',
    path: '#/signin?forgot=1',
    viewport: 'phone',
    expectText: ['Reset your password', 'support', 'Remembered it?'],
    check: noSideScroll,
  },
  {
    name: 'reset-page',
    setup: async ({ api }) => adminResetHash(api),
    expectText: ['Choose a new password', 'Saving it signs this account out'],
    check: async (h) => {
      await noSideScroll(h);
      await h.shot('form');
      await h.click('.auth-form input[autocomplete="new-password"]');
      await h.type('a new QA password 7');
      await h.click(await mark(h, '.auth-form button[type="submit"]', 'Save and sign in', 'save'));
      await h.waitUntil(() => !location.hash.includes('reset='), 8000, 'leaving the reset page');
      await h.waitFor('.avatar');
      const r = await h.api.post('/api/auth/login', { email: h.data.email, password: 'a new QA password 7' });
      // The shared anonymous agent must stay signed out for later routes.
      await h.api.post('/api/auth/logout');
      if (r.status !== 200) throw new Error(`signing in with the new password: ${r.status}`);
    },
  },
  {
    name: 'reset-page-phone',
    viewport: 'phone',
    setup: async ({ api }) => adminResetHash(api),
    expectText: ['Choose a new password'],
    check: noSideScroll,
  },
  {
    name: 'reset-expired',
    path: `#/signin?reset=${'A'.repeat(43)}`,
    expectText: ['This link has expired', 'Ask for a new link'],
    check: noSideScroll,
  },
  {
    name: 'admin-reset-link',
    path: '#/admin/users',
    as: 'admin',
    setup: async ({ api }) => {
      const u = await api.as('fresh').user();
      return { email: u.email };
    },
    expectText: ['Users', 'Create reset link'],
    check: async (h) => {
      await h.click('.admin-users .home-search input');
      await h.type(h.data.email);
      await h.click(await mark(h, '.admin-users .home-search button', 'Search', 'search'));
      await h.waitUntil(() => document.querySelectorAll('.admin-table tbody tr').length === 1, 6000, 'the search finding one user');
      await h.click('.admin-table tbody tr button');
      await h.waitForText(['Reset link for', 'won’t be shown again']);
      const url = await h.evaluate(() => document.querySelector('.admin-reset-url input')?.value ?? '');
      if (!/#\/signin\?reset=[A-Za-z0-9_-]{43}$/.test(url)) throw new Error(`the panel shows ${url.slice(0, 40)}…`);
      await noSideScroll(h);
    },
  },

  // ── contractor company: business name and phone required ──────────────────
  {
    name: 'contractor-setup-required',
    as: 'fresh',
    setup: async ({ api }) => {
      await freshContractor(api);
      return { path: '#/pro' };
    },
    expectText: ['Your company', 'Business name', 'Business phone'],
    check: async (h) => {
      await h.click(await mark(h, '.pro-setup-card button[type="submit"]', 'Continue', 'continue'));
      await h.waitForText(['Enter your business name.', 'Enter a business phone number']);
      await h.click('.pro-setup-card input[autocomplete="organization"]');
      await h.type('Ridgeway Kitchens (QA)');
      await h.click('.pro-setup-card input[autocomplete="tel"]');
      await h.type('555-0100');
      await h.click(await mark(h, '.pro-setup-card button[type="submit"]', 'Continue', 'continue'));
      await h.waitForText('Include the area code');
      await h.shot('errors');
      await h.click('.pro-setup-card input[autocomplete="tel"]');
      await h.evaluate(() => document.querySelector('.pro-setup-card input[autocomplete="tel"]').select());
      await h.type('905 555 0100');
      await h.click(await mark(h, '.pro-setup-card button[type="submit"]', 'Continue', 'continue'));
      await h.waitForText('Pricing defaults');
    },
  },
  {
    name: 'contractor-setup-required-phone',
    as: 'fresh',
    viewport: 'phone',
    setup: async ({ api }) => {
      await freshContractor(api);
      return { path: '#/pro' };
    },
    expectText: ['Your company', 'Business phone'],
    check: async (h) => {
      await h.click(await mark(h, '.pro-setup-card button[type="submit"]', 'Continue', 'continue'));
      await h.waitForText('Enter a business phone number');
      await noSideScroll(h);
    },
  },
  {
    name: 'contractor-finish-details',
    as: 'fresh',
    setup: async ({ api }) => {
      const me = await freshContractor(api);
      const u = await me.user();
      const t = Date.now();
      // A company saved before the phone was required.
      api.sql(
        'INSERT INTO contractor_profiles (user_id, company, logo_file_id, phone, email, website, service_area, default_markup_pct, tax_pct, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)',
        u.id,
        'Old Mill Cabinets (QA)',
        '',
        '',
        '',
        'Dundas',
        30,
        0,
        t,
        t,
      );
      return { path: '#/pro' };
    },
    expectText: ['Finish your company details', 'Business phone'],
    check: async (h) => {
      const name = await h.evaluate(() => document.querySelector('.pro-setup-card input[autocomplete="organization"]')?.value);
      if (name !== 'Old Mill Cabinets (QA)') throw new Error(`the card shows business name "${name}"`);
      await noSideScroll(h);
      await h.shot('card');
      await h.click('.pro-setup-card input[autocomplete="tel"]');
      await h.type('289-555-0123');
      await h.click(await mark(h, '.pro-setup-card button[type="submit"]', 'Save and open the workspace', 'save'));
      await h.waitUntil(() => !document.querySelector('.pro-setup-card'), 8000, 'the workspace opening');
      const p = (await h.me.get('/api/pro/profile')).body.profile;
      if (p.phone !== '(289) 555-0123') throw new Error(`saved phone "${p.phone}"`);
    },
  },
];
