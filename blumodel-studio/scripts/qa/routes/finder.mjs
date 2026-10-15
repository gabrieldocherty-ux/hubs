// Package 'finder' QA routes: choose your contractor. The quiet "Need a contractor?" link at the
// end of the journey (the editor's Overview, under the toast after an export, the shared
// kitchen's fine print), its hover / tap / keyboard popover, "Ask for a quote" with the open
// kitchen attached, and the #/contractors directory with its city / postal-code search. Plus the
// places it must NOT appear: no contractors listed, a contractor's own editor, a kitchen a
// contractor prepared and shared. Desktop 1440 and 390 px phones.
//
// Run: node scripts/qa.mjs --pkg finder --port 8880 --dist .build/finder --strict-external
//
// Four fictional contractors are made through the real API in `setup` (a demo Contractor
// checkout, the company profile, the brand page, an admin's approval), with their own QA users,
// so the runner's QA contractor and the seeds are left as they are. Company names, phone numbers
// and websites are made up (.example domains, 555 numbers).

import { hashPassword } from '../../../server/auth/passwords.mjs';
import { kitchenDoc } from './core.mjs';

const PHONE = { w: 390, h: 844, mobile: true };
const PASSWORD = 'qa-finder-password-1';

const CONTRACTORS = [
  { key: 'birch', email: 'qa-finder-birch@blumodel.test', name: 'Robin Birch', company: 'Birchline Kitchens', phone: '905-555-0181', serviceArea: 'Hamilton, Burlington and Oakville, ON', website: 'https://birchline.example', tagline: 'Shaker and slab kitchens, fitted in a week' },
  { key: 'north', email: 'qa-finder-north@blumodel.test', name: 'Sam Northgate', company: 'Northgate Cabinet Co', phone: '416-555-0122', serviceArea: 'Toronto and the GTA', website: 'https://northgate.example', tagline: 'Custom cabinetry for city kitchens' },
  { key: 'harbour', email: 'qa-finder-harbour@blumodel.test', name: 'Alex Harbour', company: 'Harbourview Renovations', phone: '902-555-0163', serviceArea: 'Halifax and Dartmouth, NS', website: 'https://harbourview.example', tagline: 'Kitchens and baths on the South Shore' },
  { key: 'prairie', email: 'qa-finder-prairie@blumodel.test', name: 'Jo Prairie', company: 'Prairie Oak Kitchens', phone: '403-555-0190', serviceArea: 'Calgary and Edmonton, AB', website: 'https://prairieoak.example', tagline: 'Solid oak, built in Alberta' },
];

const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what} failed (${r.status}): ${r.body?.error ?? String(r.text ?? '').slice(0, 200)}`);
  return r.body;
};

/** A tiny cookie-keeping client for one of our own contractors (the runner's Agent is per role). */
function client(base) {
  const cookies = new Map();
  const request = async (method, p, body) => {
    const h = {};
    if (method !== 'GET') {
      h['X-BluModel'] = '1';
      h['Content-Type'] = 'application/json';
    }
    if (cookies.size) h.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + p, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}), redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    const text = await res.text();
    let parsed = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body: parsed, text };
  };
  return { get: (p) => request('GET', p), post: (p, b) => request('POST', p, b), put: (p, b) => request('PUT', p, b) };
}

const listed = new Map();
/** Pages the "nobody listed" route hid, with their original verified_at, put back by `ensureListed`. */
let hidden = [];

/**
 * Our four contractors, live and verified (made once per run, re-checked every time): returns
 * `{ [key]: { slug, brandId, agent } }`. Also restores whatever the "nobody listed" route hid.
 */
function ensureListed(api) {
  if (hidden.length) {
    for (const h of hidden) api.sql('UPDATE brands SET verified_at = ? WHERE id = ?', h.verified_at, h.id);
    hidden = [];
  }
  if (!listed.has(api.base)) {
    const p = (async () => {
      const out = {};
      const hash = await hashPassword(PASSWORD);
      for (const c of CONTRACTORS) {
        if (!api.sql('SELECT id FROM users WHERE email = ?', c.email)[0]) {
          api.sql('INSERT INTO users (id, email, name, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?, ?)', crypto.randomUUID(), c.email, c.name, hash, Date.now(), 'customer');
        }
        const a = client(api.base);
        must(await a.post('/api/auth/login', { email: c.email, password: PASSWORD }), `Signing in as ${c.email}`);
        const me = must(await a.get('/api/auth/me'), 'Reading the contractor').user;
        if (me.plan?.id !== 'contractor') {
          const co = must(await a.post('/api/billing/checkout', { kind: 'subscription', plan: 'contractor' }), 'Contractor demo checkout');
          must(await a.post(`/api/billing/demo/${co.ref}/complete`, { outcome: 'success' }), 'Completing the Contractor demo checkout');
        }
        must(await a.put('/api/pro/profile', { company: c.company, phone: c.phone, email: c.email.replace('@blumodel.test', '@example.com'), website: c.website, serviceArea: c.serviceArea, defaultMarkupPct: 30 }), `${c.company}: company profile`);
        let row = api.sql("SELECT id, slug, status, verified_at FROM brands WHERE owner_user_id = ? AND kind = 'contractor'", me.id)[0];
        if (!row || row.status !== 'active' || !row.verified_at) {
          must(await a.put('/api/pro/brand', { tagline: c.tagline, about: `${c.company} is a fictional QA business.` }), `${c.company}: brand page`);
          const sub = must(await a.post('/api/pro/brand/submit'), `${c.company}: submitting the page`);
          must(await api.as('admin').post(`/api/admin/brand-pages/${sub.brand.id}/approve`), `${c.company}: approving the page`);
          row = api.sql("SELECT id, slug, status, verified_at FROM brands WHERE owner_user_id = ? AND kind = 'contractor'", me.id)[0];
        }
        if (!row || row.status !== 'active' || !row.verified_at) throw new Error(`${c.company}'s page is not live after approval (${row?.status}).`);
        out[c.key] = { slug: row.slug, brandId: row.id, agent: a, company: c.company };
      }
      return out;
    })();
    listed.set(api.base, p);
    p.catch(() => listed.delete(api.base));
  }
  return listed.get(api.base);
}

/** A kitchen for `who` (the route's `me`, or one of our contractors' clients). */
async function kitchen(who, name = 'Finder QA Kitchen') {
  const r = await who.post('/api/projects', { name, doc: kitchenDoc(name) });
  if (r.status !== 201) throw new Error(`creating "${name}" failed (${r.status}): ${r.body?.error ?? r.text}`);
  return { path: `#/k/${r.body.project.id}`, projectId: r.body.project.id };
}

/** No sideways scroll on the page. */
async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

/** What the open popover shows. */
function readPop({ evaluate }) {
  return evaluate(() => {
    const pop = document.querySelector('.finder-pop');
    if (!pop) return null;
    const r = pop.getBoundingClientRect();
    return {
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width },
      vw: window.innerWidth,
      vh: window.innerHeight,
      names: [...pop.querySelectorAll('.finder-name')].map((n) => n.textContent.trim()),
      views: [...pop.querySelectorAll('.finder-item a.finder-btn')].map((a) => a.getAttribute('href')),
      asks: pop.querySelectorAll('.finder-btn--ask').length,
      all: pop.querySelector('.finder-all')?.getAttribute('href') ?? null,
      allText: pop.querySelector('.finder-all')?.textContent.trim() ?? '',
      text: pop.innerText,
    };
  });
}

/** The popover is on screen, holds 1–3 verified contractors with View links, and nothing private. */
function checkPop(p, { count = 3 } = {}) {
  if (!p) throw new Error('the popover is not open');
  if (p.names.length !== count) throw new Error(`the popover lists ${p.names.length} contractors, expected ${count}: ${p.names.join(', ')}`);
  if (p.views.some((h) => !/^#\/b\/[A-Za-z0-9_-]+$/.test(h ?? ''))) throw new Error(`a View link isn't a brand page: ${p.views.join(', ')}`);
  if (!p.all?.startsWith('#/contractors')) throw new Error(`See all goes to ${p.all}`);
  if (p.rect.left < 0 || p.rect.top < 0 || p.rect.right > p.vw + 1 || p.rect.bottom > p.vh + 1) throw new Error(`the popover pokes off screen: ${JSON.stringify(p.rect)} in ${p.vw}x${p.vh}`);
  // Phone numbers and emails are private unless a contractor shows them; none of ours do.
  if (/@|555-01/.test(p.text)) throw new Error('the popover shows a phone number or email the contractor did not choose to show');
}

const linkGone = async ({ evaluate, sleep }, where) => {
  // Long enough for GET /api/contractors and the lazy chunk.
  await sleep(2500);
  const n = await evaluate(() => document.querySelectorAll('.finder-link').length);
  if (n) throw new Error(`"Need a contractor?" shows ${where}`);
};

export default [
  // ── nobody listed: the link isn't there at all ─────────────────────────────
  {
    name: 'finder-none',
    as: 'customer',
    viewport: 'desktop',
    waitFor: '.summary',
    async setup({ api, me }) {
      // Hide every listed contractor for this route (ensureListed puts them back).
      hidden = api.sql("SELECT id, verified_at FROM brands WHERE kind = 'contractor' AND verified_at IS NOT NULL");
      for (const h of hidden) api.sql('UPDATE brands SET verified_at = NULL WHERE id = ?', h.id);
      return kitchen(me, 'Finder QA Kitchen (nobody listed)');
    },
    async check(h) {
      try {
        const r = await (await fetch(`${h.base}/api/contractors`)).json();
        if (r.total !== 0) throw new Error(`GET /api/contractors still lists ${r.total}`);
        await linkGone(h, 'with no contractors listed');
      } finally {
        await ensureListed(h.api);
      }
    },
  },

  // ── the editor's Overview: hover, keyboard, click, Ask for a quote ─────────
  {
    name: 'finder-summary',
    as: 'customer',
    viewport: 'desktop',
    waitFor: ['.summary', '.finder--summary .finder-link'],
    async setup({ api, me }) {
      await ensureListed(api);
      return kitchen(me, 'Finder QA Kitchen');
    },
    async check(h) {
      const { evaluate, send, sleep, waitFor, key, click, rectOf, shot, data } = h;
      const text = await evaluate(() => document.querySelector('.finder--summary .finder-link').textContent.trim());
      if (text !== 'Need a contractor?') throw new Error(`the link reads "${text}"`);
      // A text link at the end of the panel, not a banner: small, no fill.
      const look = await evaluate(() => {
        const el = document.querySelector('.finder--summary .finder-link');
        el.scrollIntoView({ block: 'center' });
        const cs = getComputedStyle(el);
        const panel = el.closest('.right-panel').getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const last = [...el.closest('.panel-scroll').children].pop();
        return { bg: cs.backgroundColor, size: parseFloat(cs.fontSize), h: r.height, inside: r.left >= panel.left && r.right <= panel.right, isLast: last.contains(el) };
      });
      if (!/rgba\(0, 0, 0, 0\)|transparent/.test(look.bg) || look.size > 14 || look.h > 32) throw new Error(`the link looks like a button or banner: ${JSON.stringify(look)}`);
      if (!look.inside || !look.isLast) throw new Error(`the link isn't at the bottom of the panel: ${JSON.stringify(look)}`);

      // Hover opens it (after a short delay), with three of the four and See all.
      const r = await rectOf('.finder--summary .finder-link');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.cx, y: r.cy });
      await waitFor('.finder-pop', 3000);
      await sleep(250);
      const p = await readPop(h);
      checkPop(p);
      if (p.asks !== 3) throw new Error(`${p.asks} of 3 contractors offer Ask for a quote`);
      if (!/See all contractors \(4\)/.test(p.allText)) throw new Error(`See all reads "${p.allText}"`);
      if (!p.all.includes(`kitchen=${data.projectId}`)) throw new Error(`See all doesn't carry the open kitchen: ${p.all}`);
      if (!(p.rect.bottom <= r.y)) throw new Error('the popover should open above a link at the bottom of the panel');
      await shot('hover');

      // Leaving it closes it.
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: 300 });
      await sleep(700);
      if (await evaluate(() => !!document.querySelector('.finder-pop'))) throw new Error('the popover stays open after the mouse leaves');

      // Keyboard: focus, ArrowDown opens, Tab steps in, Escape closes and returns focus to the link.
      await evaluate(() => document.querySelector('.finder--summary .finder-link').focus());
      await key('ArrowDown');
      await waitFor('.finder-pop', 2000);
      const expanded = await evaluate(() => document.querySelector('.finder--summary .finder-link').getAttribute('aria-expanded'));
      if (expanded !== 'true') throw new Error(`aria-expanded is ${expanded} while open`);
      await key('Tab');
      await sleep(100);
      const inside = await evaluate(() => !!document.activeElement?.closest('.finder-pop'));
      if (!inside) throw new Error('Tab from the open link does not move into the popover');
      await key('Escape');
      await sleep(200);
      const after = await evaluate(() => ({ open: !!document.querySelector('.finder-pop'), onLink: document.activeElement?.classList.contains('finder-link') ?? false }));
      if (after.open || !after.onLink) throw new Error(`Escape: ${JSON.stringify(after)}`);

      // Click pins it; Ask for a quote opens the lead form with this kitchen attached.
      await click('.finder--summary .finder-link');
      await waitFor('.finder-pop .finder-btn--ask', 2000);
      await click('.finder-pop .finder-btn--ask');
      await h.waitForText('Attach one of my kitchens', 8000);
      await sleep(800);
      const attached = await evaluate(() => [...document.querySelectorAll('select')].map((s) => s.value));
      if (!attached.includes(data.projectId)) throw new Error(`the lead form doesn't have this kitchen attached (selects: ${attached.join(', ')})`);
      if (await evaluate(() => !!document.querySelector('.finder-pop'))) throw new Error('the popover stays open behind the lead form');
      await shot('quote');
      await key('Escape');
    },
  },

  // ── the same on a phone: inside the Details sheet, tap to open ────────────
  {
    name: 'finder-summary-phone',
    as: 'customer',
    viewport: PHONE,
    waitFor: '.mbar',
    async setup({ api, me }) {
      await ensureListed(api);
      return kitchen(me, 'Finder QA Phone Kitchen');
    },
    async check(h) {
      const { evaluate, sleep, waitFor, tap, shot } = h;
      await tap('.mbar-actions button[aria-label="Details"]');
      await waitFor('.right-panel--sheet .finder-link', 8000);
      await sleep(400);
      const size = await evaluate(() => {
        const el = document.querySelector('.right-panel--sheet .finder-link');
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return { h: r.height, w: r.width };
      });
      // pointer: coarse makes the target taller than the text.
      if (size.h < 36) throw new Error(`the link is ${Math.round(size.h)}px tall: too small to tap`);
      await sleep(300);
      await tap('.right-panel--sheet .finder-link');
      await waitFor('.finder-pop', 3000);
      await sleep(250);
      const p = await readPop(h);
      checkPop(p);
      if (Math.round(p.rect.width) !== 390 - 24 || Math.round(p.rect.left) !== 12) throw new Error(`on a phone the popover should span the width less 12px gutters: ${JSON.stringify(p.rect)}`);
      const btn = await evaluate(() => document.querySelector('.finder-pop .finder-btn').getBoundingClientRect().height);
      if (btn < 34) throw new Error(`the popover's buttons are ${Math.round(btn)}px tall: too small to tap`);
      await shot('popover');
      await noSideScroll(h);
      // A tap on the link again closes it.
      await tap('.right-panel--sheet .finder-link');
      await sleep(300);
      if (await evaluate(() => !!document.querySelector('.finder-pop'))) throw new Error('a second tap does not close the popover');
    },
  },

  // ── after an export: a chip under the toast, for a while ───────────────────
  {
    name: 'finder-export',
    as: 'fresh',
    viewport: 'desktop',
    waitFor: '.topbar',
    async setup({ api, me }) {
      await ensureListed(api);
      // Exports are paid: the fresh user gets a demo Unlimited plan through the real demo checkout.
      const c = must(await me.post('/api/billing/checkout', { kind: 'subscription', plan: 'unlimited' }), 'Unlimited demo checkout');
      must(await me.post(`/api/billing/demo/${c.ref}/complete`, { outcome: 'success' }), 'Completing the Unlimited demo checkout');
      return kitchen(me, 'Finder QA Export Kitchen');
    },
    async check(h) {
      const { evaluate, send, sleep, waitFor, click, rectOf, shot } = h;
      if (await evaluate(() => !!document.querySelector('.finder--export'))) throw new Error('the after-export link shows before any export');
      await sleep(800);
      await evaluate(() => [...document.querySelectorAll('.topbar button')].find((b) => /Export/.test(b.textContent))?.setAttribute('data-qa-export', ''));
      await click('[data-qa-export]');
      await waitFor('.menu [role="menuitem"]', 3000);
      await evaluate(() => [...document.querySelectorAll('.menu [role="menuitem"]')].find((b) => /Project file/.test(b.textContent))?.setAttribute('data-qa-json', ''));
      await click('[data-qa-json]');
      await h.waitForText('Project saved.', 10_000);
      await waitFor('.finder--export .finder-link', 8000);
      await sleep(400);
      const pos = await evaluate(() => {
        const chip = document.querySelector('.finder--export').getBoundingClientRect();
        const toast = document.querySelector('.toast')?.getBoundingClientRect();
        return { chipTop: chip.top, toastBottom: toast?.bottom ?? null, bottom: window.innerHeight - chip.bottom };
      });
      if (pos.toastBottom !== null && pos.chipTop < pos.toastBottom) throw new Error(`the chip isn't under the toast: ${JSON.stringify(pos)}`);
      await shot('chip');
      const r = await rectOf('.finder--export .finder-link');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.cx, y: r.cy });
      await waitFor('.finder-pop', 3000);
      await sleep(250);
      checkPop(await readPop(h));
      await shot('hover');
      // Hovering keeps it; after the mouse leaves it goes away by itself (12 s) - not waited for here.
    },
  },

  // ── the shared kitchen: in the fine print ─────────────────────────────────
  {
    name: 'finder-share',
    as: 'anon',
    viewport: 'desktop',
    waitFor: ['.share-bar', '.share-bar-note .finder-link'],
    async setup({ api }) {
      await ensureListed(api);
      const k = await kitchen(api.as('customer'), 'Finder QA Shared Kitchen');
      const link = must(await api.as('customer').post(`/api/projects/${k.projectId}/shares`, {}), 'Creating the share link').share;
      return { path: `#/s/${link.token}` };
    },
    async check(h) {
      const { evaluate, send, sleep, waitFor, rectOf, shot } = h;
      const line = await evaluate(() => document.querySelector('.share-bar-note').innerText.replace(/\s+/g, ' '));
      if (!/Privacy · Need a contractor\? ·/.test(line)) throw new Error(`the fine print reads "${line.slice(0, 120)}"`);
      const r = await rectOf('.share-bar-note .finder-link');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.cx, y: r.cy });
      await waitFor('.finder-pop', 3000);
      await sleep(250);
      const p = await readPop(h);
      checkPop(p);
      if (p.all.includes('kitchen=')) throw new Error('a visitor to a shared kitchen gets someone else’s kitchen id in See all');
      if (!(p.rect.top >= r.y + r.h)) throw new Error('the popover should open below a link at the top of the page');
      await shot('hover');
    },
  },
  {
    name: 'finder-share-phone',
    as: 'anon',
    viewport: PHONE,
    waitFor: ['.share-bar', '.share-bar-note .finder-link'],
    async setup({ api }) {
      await ensureListed(api);
      const k = await kitchen(api.as('customer'), 'Finder QA Shared Kitchen (phone)');
      const link = must(await api.as('customer').post(`/api/projects/${k.projectId}/shares`, {}), 'Creating the share link').share;
      return { path: `#/s/${link.token}` };
    },
    async check(h) {
      const { evaluate, sleep, waitFor, tap, shot } = h;
      // Only the link survives of the fine print on a phone, as a slim line under "Shared by" (the
      // line's text is sized to nothing, its Terms and Privacy links hidden).
      const seen = await evaluate(() => {
        const note = document.querySelector('.share-bar-note');
        const link = note.querySelector('.finder-link');
        const a = [...note.querySelectorAll(':scope > a')].filter((x) => x.getClientRects().length).length;
        const r = note.getBoundingClientRect();
        const l = link.getBoundingClientRect();
        return { visibleLegalLinks: a, h: r.height, noteFont: getComputedStyle(note).fontSize, linkFont: getComputedStyle(link).fontSize, linkW: l.width, inside: l.left >= 0 && l.right <= window.innerWidth };
      });
      if (seen.visibleLegalLinks || seen.noteFont !== '0px' || seen.linkFont !== '12px' || seen.h > 24 || !seen.inside || seen.linkW < 60) throw new Error(`the phone fine print: ${JSON.stringify(seen)}`);
      await tap('.share-bar-note .finder-link');
      await waitFor('.finder-pop', 3000);
      await sleep(250);
      checkPop(await readPop(h));
      await shot('popover');
      await noSideScroll(h);
    },
  },

  // ── never on a kitchen a contractor prepared, never for a contractor ──────
  {
    name: 'finder-share-pro',
    as: 'anon',
    viewport: 'desktop',
    waitFor: '.share-bar--pro',
    async setup({ api }) {
      const pros = await ensureListed(api);
      const k = await kitchen(pros.birch.agent, 'Finder QA Client Kitchen');
      const link = must(await pros.birch.agent.post(`/api/projects/${k.projectId}/shares`, {}), 'Creating the contractor’s share link').share;
      return { path: `#/s/${link.token}` };
    },
    check: (h) => linkGone(h, 'on a kitchen a contractor prepared'),
  },
  {
    name: 'finder-contractor',
    as: 'contractor',
    viewport: 'desktop',
    waitFor: '.summary',
    async setup({ api, me }) {
      await ensureListed(api);
      return kitchen(me, 'Finder QA Contractor Kitchen');
    },
    check: (h) => linkGone(h, 'to a contractor in their own editor'),
  },

  // ── #/contractors: the directory ──────────────────────────────────────────
  {
    name: 'finder-directory',
    path: '#/contractors',
    as: 'anon',
    viewport: 'desktop',
    waitFor: '.fd-card',
    expectText: ['Find a contractor', 'Verified contractor'],
    async setup({ api }) {
      await ensureListed(api);
      return {};
    },
    async check(h) {
      const { evaluate, sleep, click, type, waitFor, shot } = h;
      const cards = () => evaluate(() => [...document.querySelectorAll('.fd-card .fd-name')].map((n) => n.textContent.trim()));
      const all = await cards();
      for (const c of CONTRACTORS) if (!all.includes(c.company)) throw new Error(`${c.company} is missing from the directory (${all.join(', ')})`);
      const text = await evaluate(() => document.querySelector('.fd-grid').innerText);
      if (/@|555-01/.test(text)) throw new Error('the directory shows a phone number or email the contractor did not choose to show');
      await shot('all');

      // A postal code finds who serves it (L8P is Hamilton; Birchline names Hamilton).
      // A postal code finds who serves its region: L8P is Ontario, so Birchline (Hamilton…, ON)
      // and Northgate (the GTA), not Halifax or Calgary.
      await click('.fd-search input');
      await type('L8P 4R5');
      await h.waitForText('2 of 4 serve “L8P 4R5”', 6000);
      await sleep(300);
      const near = await cards();
      if (!near.includes('Birchline Kitchens') || !near.includes('Northgate Cabinet Co')) throw new Error(`L8P 4R5 should find the Ontario contractors, got ${near.join(', ')}`);
      if (near.includes('Harbourview Renovations') || near.includes('Prairie Oak Kitchens')) throw new Error(`L8P 4R5 lists a contractor far away: ${near.join(', ')}`);
      const hash = await evaluate(() => location.hash);
      if (!/near=L8P/.test(hash)) throw new Error(`the address doesn't keep the search: ${hash}`);
      await shot('postal');

      // A city a contractor names: just them.
      await evaluate(() => document.querySelector('.fd-search input').select());
      await type('Hamilton');
      await h.waitForText('1 of 4 serves “Hamilton”', 6000);
      await sleep(300);
      const city = await cards();
      if (city.join() !== 'Birchline Kitchens') throw new Error(`Hamilton should find only Birchline, got ${city.join(', ')}`);

      // A city nobody names: the empty state, and Show all brings everyone back.
      await evaluate(() => document.querySelector('.fd-search input').select());
      await type('Winnipeg');
      await h.waitForText('No one lists “Winnipeg” yet', 6000);
      await shot('nobody');
      await evaluate(() => [...document.querySelectorAll('.fd-empty button')].find((b) => /Show all/.test(b.textContent))?.setAttribute('data-qa-all', ''));
      await click('[data-qa-all]');
      await waitFor('.fd-card', 6000);
      await sleep(300);
      if ((await cards()).length < CONTRACTORS.length) throw new Error('Show all does not bring every contractor back');
    },
  },
  {
    name: 'finder-directory-phone',
    path: '#/contractors?near=Toronto',
    as: 'anon',
    viewport: PHONE,
    waitFor: '.fd-card',
    expectText: 'serves “Toronto”',
    async setup({ api }) {
      await ensureListed(api);
      return {};
    },
    async check(h) {
      const names = await h.evaluate(() => [...document.querySelectorAll('.fd-card .fd-name')].map((n) => n.textContent.trim()));
      if (names[0] !== 'Northgate Cabinet Co') throw new Error(`Toronto should find Northgate first, got ${names.join(', ')}`);
      await h.shot('toronto');
      await noSideScroll(h);
    },
  },
  {
    name: 'finder-directory-dark',
    path: '#/contractors',
    as: 'customer',
    viewport: 'desktop',
    waitFor: '.fd-card',
    async setup({ api }) {
      await ensureListed(api);
      return {};
    },
    async check(h) {
      await h.evaluate(() => localStorage.setItem('blumodel.theme', 'dark'));
      await h.reload();
      await h.waitFor('.fd-card', 8000);
      await h.sleep(400);
      const t = await h.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.querySelector('.fd-card')).backgroundColor }));
      h.note(`dark theme: ${JSON.stringify(t)}`);
      if (t.theme !== 'dark') throw new Error(`the page did not switch to the dark theme (${t.theme})`);
      await h.shot('dark');
    },
  },
];
