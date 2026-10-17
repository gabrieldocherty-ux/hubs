// The owner's admin panel (src/features/admin, server/routes/adminPanel.mjs): every new tab at 1440
// and 390, light and dark, with a contrast audit (WCAG AA from computed colours) and no sideways
// scroll; the entry point in the account menu; non-admins kept out (screen and API); and the user
// actions driven through the UI (comp plan, disable / enable, delete with the typed email).
// Run: node scripts/qa.mjs --pkg admin --port 8950 --dist .build/admin --strict-external

import { contrastAudit } from './dark.mjs';

const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what} failed (${r.status}): ${r.body?.error ?? String(r.text ?? '').slice(0, 200)}`);
  return r.body;
};

/** Text that was already under AA in light before dark mode (muted ink, eyebrows): dark.mjs KNOWN_LIGHT. */
const KNOWN_LIGHT_FG = new Set(['#8c8477', '#c2542d', '#3f7d52', '#b7791f']);

async function settle(h) {
  await h.waitUntil(() => !document.querySelector('.screen-msg'), 10_000, 'the tab to finish loading');
  await h.sleep(250);
}

async function noSideScroll(h) {
  const r = await h.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
  // Content can also spill past the right edge while the page itself is clipped: check the panel.
  const spill = await h.evaluate(() => {
    const w = window.innerWidth;
    const out = [...document.querySelectorAll('.admin-main *')].find((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.right > w + 1;
    });
    return out ? `${out.tagName.toLowerCase()}.${String(out.className).split(' ')[0]} "${(out.textContent || '').trim().slice(0, 40)}"` : null;
  });
  if (spill) throw new Error(`something runs past the right edge: ${spill}`);
}

async function theme(h, want) {
  const scheme = await h.evaluate(() => document.documentElement.getAttribute('data-theme') || getComputedStyle(document.documentElement).colorScheme);
  if (!String(scheme).includes(want)) throw new Error(`expected the ${want} theme, got "${scheme}"`);
}

async function contrast(h, scheme) {
  const r = await contrastAudit(h);
  const fails = scheme === 'light' ? r.fails.filter((f) => !KNOWN_LIGHT_FG.has(f.fg)) : r.fails;
  h.note(`contrast (${scheme}): ${r.checked} checked, ${r.skipped} skipped, ${fails.length} under AA${scheme === 'light' ? ` (+${r.fails.length - fails.length} known from before dark mode)` : ''}`);
  if (fails.length) throw new Error(`${fails.length} text element(s) under WCAG AA in ${scheme}: ${fails.slice(0, 8).map((f) => `${f.el} "${f.text}" ${f.fg} on ${f.bg} = ${f.ratio}:1`).join('; ')}`);
}

/** No key, secret or token-looking value anywhere in the page's text. */
async function noSecrets(h) {
  const text = await h.evaluate(() => document.body.innerText);
  const m = /(sk|rk)_(live|test)_[A-Za-z0-9]{6,}|whsec_[A-Za-z0-9]{6,}|re_[A-Za-z0-9]{12,}|Bearer [A-Za-z0-9._-]{12,}/.exec(text);
  if (m) throw new Error(`the page shows something secret-looking: ${m[0].slice(0, 12)}…`);
}

const check =
  (scheme, extra) =>
  async (h) => {
    await settle(h);
    if (extra) await extra(h);
    await theme(h, scheme);
    await noSideScroll(h);
    await noSecrets(h);
    await contrast(h, scheme);
  };

/** The same route at 1440 and 390, in light and in dark. */
function four(route) {
  const out = [];
  for (const scheme of ['light', 'dark']) {
    for (const vp of ['desktop', 'phone']) {
      out.push({
        ...route,
        name: `${route.name}${vp === 'phone' ? '-phone' : ''}${scheme === 'dark' ? '-dark' : ''}`,
        viewport: vp,
        colorScheme: scheme,
        fullPage: true,
        check: check(scheme, route.extra),
      });
    }
  }
  return out.map(({ extra, ...r }) => r);
}

/** A contractor on a complimentary plan, with a company and an audit trail, for the screenshots. */
async function seedContractor(api) {
  const me = api.as('fresh');
  const u = await me.user();
  must(await api.as('admin').post(`/api/admin/users/${u.id}/comp`, { plan: 'contractor', endsOn: '2027-01-31', note: 'Launch partner (QA)' }), 'Complimentary plan');
  must(await me.put('/api/pro/profile', { company: 'Ridgeway Kitchens (QA)', phone: '905-555-0142', serviceArea: 'Testville', defaultMarkupPct: 30 }), 'Saving the company');
  return u;
}

/** Opens the account `email` from Admin > Users. */
async function openAccount(h, email) {
  await h.click('.admin-users .home-search input');
  await h.type(email);
  await h.click('.admin-users .home-search button[type="submit"]');
  await h.waitUntil(() => document.querySelectorAll('.adm-table tbody tr').length === 1, 8000, 'the search finding one user');
  await h.click('.adm-table tbody tr .adm-link');
  await h.waitForText(['Complimentary plan', 'Access', 'History']);
}

/** Clicks the first visible button whose text includes `text`. */
async function press(h, text) {
  const ok = await h.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].find((e) => !e.disabled && e.offsetParent && e.textContent.replace(/\s+/g, ' ').trim().toLowerCase().includes(t.toLowerCase()));
    if (b) b.setAttribute('data-qa-press', '1');
    return !!b;
  }, text);
  if (!ok) throw new Error(`no enabled button "${text}"`);
  await h.click('[data-qa-press="1"]');
  await h.evaluate(() => document.querySelector('[data-qa-press]')?.removeAttribute('data-qa-press'));
}

export default [
  // ── the tabs, 1440 / 390, light / dark ───────────────────────────────────
  ...four({ name: 'admin-overview', path: '#/admin/overview', as: 'admin', setup: async ({ api }) => (await seedContractor(api), {}), expectText: ['Overview', 'Monthly recurring revenue', 'Recent sign-ups', 'Recent payments'] }),
  ...four({ name: 'admin-users', path: '#/admin/users', as: 'admin', expectText: ['Users', 'Search by name or email'] }),
  ...four({
    name: 'admin-user-detail',
    path: '#/admin/users',
    as: 'admin',
    setup: async ({ api }) => {
      const u = await seedContractor(api);
      return { email: u.email };
    },
    expectText: ['Users'],
    extra: async (h) => {
      await openAccount(h, h.data.email);
      await h.waitForText(['complimentary', 'make-admin.mjs', 'Delete the account']);
    },
  }),
  ...four({ name: 'admin-contractors', path: '#/admin/contractors', as: 'admin', setup: async ({ api }) => (await seedContractor(api), {}), expectText: ['Contractors', 'Brand page', 'Models'] }),
  ...four({ name: 'admin-system', path: '#/admin/system', as: 'admin', expectText: ['System', 'Payments', 'Webhook signing secret', 'Database and backups', 'blumodel.env'] }),
  ...four({ name: 'admin-audit', path: '#/admin/audit', as: 'admin', setup: async ({ api }) => (await seedContractor(api), {}), expectText: ['Audit log', 'Complimentary plan given'] }),

  // ── entry point and access ───────────────────────────────────────────────
  {
    name: 'admin-menu-entry',
    path: '#/',
    as: 'admin',
    check: async (h) => {
      await h.waitFor('button.avatar');
      await h.click('button.avatar');
      await h.waitForText('Admin');
      await press(h, 'Admin');
      await h.waitUntil(() => location.hash === '#/admin/overview', 6000, 'Admin opening the overview');
      await h.waitForText(['Monthly recurring revenue', 'Contractors', 'System', 'Audit']);
    },
  },
  {
    name: 'admin-menu-hidden-for-customers',
    path: '#/',
    as: 'customer',
    check: async (h) => {
      await h.waitFor('button.avatar');
      await h.click('button.avatar');
      await h.waitForText('Account settings');
      const items = await h.evaluate(() => [...document.querySelectorAll('.menu [role="menuitem"]')].map((e) => e.textContent.trim()));
      if (items.some((t) => /^Admin/.test(t))) throw new Error(`a customer's menu offers Admin: ${items.join(', ')}`);
    },
  },
  {
    name: 'admin-forbidden-customer',
    path: '#/admin/system',
    as: 'customer',
    expectText: 'This area is for BluModel Studio staff.',
    check: async (h) => {
      for (const p of ['/api/admin/dashboard', '/api/admin/system', '/api/admin/audit', '/api/admin/contractors', '/api/admin/users']) {
        const status = await h.evaluate(async (u) => (await fetch(u, { credentials: 'same-origin' })).status, p);
        if (status !== 403) throw new Error(`${p} answered ${status} to a customer (expected 403)`);
      }
      const status = await h.evaluate(async () => (await fetch('/api/admin/users/x/disable', { method: 'POST', credentials: 'same-origin', headers: { 'X-BluModel': '1', 'Content-Type': 'application/json' }, body: '{}' })).status);
      if (status !== 403) throw new Error(`a customer's disable answered ${status}`);
    },
  },
  {
    name: 'admin-studio-sees-only-studio',
    path: '#/admin/users',
    as: 'studio',
    check: async (h) => {
      await h.waitUntil(() => location.hash === '#/admin/studio', 8000, 'the studio role being sent to its own tab');
      const tabs = await h.evaluate(() => [...document.querySelectorAll('.admin-tabs [role="tab"]')].map((e) => e.textContent.trim()));
      if (tabs.join(',') !== 'Studio') throw new Error(`the studio role sees tabs: ${tabs.join(', ')}`);
    },
  },

  // ── actions through the UI ───────────────────────────────────────────────
  {
    name: 'admin-disable-enable',
    path: '#/admin/users',
    as: 'admin',
    viewport: 'phone',
    setup: async ({ api }) => ({ email: (await api.as('fresh').user()).email }),
    check: async (h) => {
      await settle(h);
      await openAccount(h, h.data.email);
      await press(h, 'Disable account');
      await press(h, 'Yes, disable it');
      await h.waitForText(['Account disabled and signed out everywhere', 'can’t sign in until it is enabled again']);
      const res = await h.evaluate(async () => (await fetch('/api/admin/audit?action=account_disable', { credentials: 'same-origin' })).json());
      if (!res.entries?.length) throw new Error('the disable is not in the audit log');
      await press(h, 'Enable account');
      await h.waitForText('Account enabled.');
      await noSideScroll(h);
    },
  },
  {
    name: 'admin-comp-and-delete',
    path: '#/admin/users',
    as: 'admin',
    setup: async ({ api }) => ({ email: (await api.as('fresh').user()).email }),
    check: async (h) => {
      await settle(h);
      await openAccount(h, h.data.email);
      await press(h, 'Give complimentary plan');
      await h.waitForText(['Complimentary Contractor given', 'End it now']);
      await press(h, 'End it now');
      await h.waitForText('Complimentary plan ended.');
      // Delete: the button stays disabled until the email is typed exactly.
      const before = await h.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Delete account permanently'))?.disabled);
      if (before !== true) throw new Error('Delete is enabled before the email is typed');
      await h.click('input[aria-label="Type the account’s email to confirm deletion"]');
      await h.type(h.data.email);
      await press(h, 'Delete account permanently');
      await h.waitForText(['was deleted', 'The audit log keeps the record']);
      const res = await h.evaluate(async () => (await fetch('/api/admin/audit?action=account_delete', { credentials: 'same-origin' })).json());
      if (!res.entries?.some((e) => e.targetEmail)) throw new Error('the delete is not in the audit log');
    },
  },
];
