// Dark mode QA: every routed screen in the dark theme at 1440 and 390, with a contrast audit of
// the text the screen shows (WCAG AA from computed colours), a visible focus ring, and a few light
// routes to compare with the pre-dark build.
// Run: node scripts/qa.mjs --pkg dark --port 8920 --dist .build/dark --strict-external
//
// Dark is reached the way most people will: Appearance = System (the default) on a device set to
// dark (`colorScheme: 'dark'` emulates prefers-color-scheme). The account's own Dark choice is
// covered by the account package's theme-switch route.
//
// What it covers: the public pages (landing, pricing, the three legal pages, sign in, sign up,
// forgot and reset password, 404, the crash screen), the contractor directory empty and with a
// listed contractor, brand pages (a partner brand and a contractor with Ask for a quote), product
// pages (a demo product, a retail one with Where to buy, the photo viewer, Add to a kitchen),
// the DEMO checkouts, home, the wizard's four steps, Start from a photo, account (and its delete
// dialog), billing (free, contractor, the cancel dialog), Make custom models (with models left and
// with none), an order, the contractor workspace's every tab, the admin's every tab (and its
// dialogs, the studio drawer, a reset link), and the editor: plan, drafting, 3D, walls, Room &
// finishes, checks, estimate, the inspector, the catalog with store chips, the Export and account
// menus, Share, Render, Unlock, the conflict dialog, the offline banner, toasts, the "Need a
// contractor?" popover and its lead form, the photo reference, a contractor's editor, the phone
// sheets, and the shared kitchen (homeowner and contractor). Long phone pages are photographed a
// screen at a time (a full-page capture past 16384 device pixels wraps around).
//
// State: anything a route changes for a shared QA user or the whole server (a sponsored store, a
// listed contractor, requests against an allowance) is put back in the same route, so `--pkg all`
// runs the later packages against what they expect.

import crypto from 'node:crypto';
import { hashPassword } from '../../../server/auth/passwords.mjs';
import { kitchenDoc } from './core.mjs';

const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what} failed (${r.status}): ${r.body?.error ?? String(r.text ?? '').slice(0, 200)}`);
  return r.body;
};

async function newKitchen(me, name, extra = {}) {
  const { project } = must(await me.post('/api/projects', { name, doc: kitchenDoc(name), ...extra }), `Creating "${name}"`);
  return { path: `#/k/${project.id}`, projectId: project.id, name };
}

/** Sets a React-controlled <select> (CDP can't drive the native popup). */
async function pick(h, selector, value) {
  const ok = await h.evaluate(
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

const isPhone = (h) => !!h.viewport?.mobile;

/** A fresh user (the route's own) on the Contractor plan, with its company saved. */
async function freshContractor(api, company = 'Copper Kettle Kitchens (QA)') {
  const me = api.as('fresh');
  const c = must(await me.post('/api/billing/checkout', { kind: 'subscription', plan: 'contractor' }), 'Contractor demo checkout');
  must(await me.post(`/api/billing/demo/${c.ref}/complete`, { outcome: 'success' }), 'Completing the Contractor demo checkout');
  if (company) must(await me.put('/api/pro/profile', { company, phone: '905-555-0148', serviceArea: 'Testville', defaultMarkupPct: 30 }), 'Saving the company');
  return me;
}

// ── A listed contractor (not a demo page, so the directory and "Need a contractor?" show it) ──

const DARK_PRO = {
  email: 'qa-dark-pro@blumodel.test',
  name: 'Morgan Lantern',
  company: 'Lantern Lane Kitchens (QA)',
  phone: '905-555-0193',
  serviceArea: 'Hamilton, Burlington and Oakville, ON',
  website: 'https://lanternlane.example',
  tagline: 'Painted shaker kitchens, fitted in a week',
};
const PRO_PASSWORD = 'qa-dark-pro-password-1';

/** A small cookie-keeping client for our own contractor (the runner's agents are per role). */
function client(base) {
  const cookies = new Map();
  const request = async (method, p, body) => {
    const headers = {};
    if (method !== 'GET') {
      headers['X-BluModel'] = '1';
      headers['Content-Type'] = 'application/json';
    }
    if (cookies.size) headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + p, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}), redirect: 'manual' });
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

const proByBase = new Map();
/**
 * Lantern Lane Kitchens (QA): a contractor with a live, verified brand page, made once per run
 * and listed again on every call. Every route that calls this unlists it at the end
 * (`unlistPro`), so the finder package still finds exactly its own four contractors.
 */
async function listedPro(api) {
  if (!proByBase.has(api.base)) {
    const p = (async () => {
      if (!api.sql('SELECT id FROM users WHERE email = ?', DARK_PRO.email)[0]) {
        api.sql('INSERT INTO users (id, email, name, password_hash, created_at, role) VALUES (?, ?, ?, ?, ?, ?)', crypto.randomUUID(), DARK_PRO.email, DARK_PRO.name, await hashPassword(PRO_PASSWORD), Date.now(), 'customer');
      }
      const a = client(api.base);
      must(await a.post('/api/auth/login', { email: DARK_PRO.email, password: PRO_PASSWORD }), 'Signing in as the dark-mode contractor');
      const me = must(await a.get('/api/auth/me'), 'Reading the contractor').user;
      if (me.plan?.id !== 'contractor') {
        const co = must(await a.post('/api/billing/checkout', { kind: 'subscription', plan: 'contractor' }), 'Contractor demo checkout');
        must(await a.post(`/api/billing/demo/${co.ref}/complete`, { outcome: 'success' }), 'Completing the Contractor demo checkout');
      }
      must(await a.put('/api/pro/profile', { company: DARK_PRO.company, phone: DARK_PRO.phone, website: DARK_PRO.website, serviceArea: DARK_PRO.serviceArea, defaultMarkupPct: 30 }), 'The company profile');
      let row = api.sql("SELECT id, slug, status, verified_at FROM brands WHERE owner_user_id = ? AND kind = 'contractor'", me.id)[0];
      if (!row || row.status !== 'active') {
        must(await a.put('/api/pro/brand', { tagline: DARK_PRO.tagline, about: `${DARK_PRO.company} is a fictional QA business: painted shaker and slab kitchens, measured, supplied and fitted.` }), 'The brand page');
        const sub = must(await a.post('/api/pro/brand/submit'), 'Submitting the page');
        must(await api.as('admin').post(`/api/admin/brand-pages/${sub.brand.id}/approve`), 'Approving the page');
        row = api.sql("SELECT id, slug, status, verified_at FROM brands WHERE owner_user_id = ? AND kind = 'contractor'", me.id)[0];
      }
      if (!row || row.status !== 'active') throw new Error(`the dark-mode contractor's page is not live (${row?.status})`);
      return { brandId: row.id, slug: row.slug };
    })();
    proByBase.set(api.base, p);
    p.catch(() => proByBase.delete(api.base));
  }
  const pro = await proByBase.get(api.base);
  api.sql('UPDATE brands SET verified_at = COALESCE(verified_at, ?) WHERE id = ?', Date.now(), pro.brandId);
  return pro;
}

/** Takes the dark-mode contractor out of the directory again. */
async function unlistPro(api) {
  const p = proByBase.get(api.base);
  if (!p) return;
  const pro = await p.catch(() => null);
  if (pro) api.sql('UPDATE brands SET verified_at = NULL WHERE id = ?', pro.brandId);
}

/** A check that runs with the dark-mode contractor listed, and unlists it whatever happens. */
const withPro = (check) => async (h) => {
  try {
    await check(h);
  } finally {
    await unlistPro(h.api);
  }
};

// ── Retail: a sponsored store, put back afterwards ──

/** Sold at Best Buy, Home Depot and RONA (retail.mjs uses it too). */
const RETAIL_RANGE = 'r-samsung-ne63a6511ss';

async function setStore(api, slug, body) {
  const r = await api.as('admin').patch(`/api/admin/retailers/${slug}`, body);
  if (r.status !== 200) throw new Error(`PATCH /api/admin/retailers/${slug} → ${r.status} ${JSON.stringify(r.body)}`);
}

// ── Orders ──

/** An unpaid order made before custom models moved into the Contractor plan, for the demo customer (orders.mjs's way). */
async function priorOrder(api) {
  const userId = api.sql('SELECT id FROM users WHERE email = ?', 'demo-customer@blumodel.test')[0]?.id;
  if (!userId) throw new Error('the demo customer does not exist (did the core seed run?)');
  const id = `o_qadark${crypto.randomUUID().replace(/-/g, '').slice(0, 18)}`;
  const t = Date.now();
  const brief = JSON.stringify({ productTypeId: 'range-gas', kind: 'range', variant: 'gas-4', category: 'appliances', name: 'QA dark range (Demo)', upc: '200000041205', upcFormat: 'upc_a', widthIn: 30, depthIn: 28, heightIn: 36, notes: 'QA', referenceFileIds: [], refProductId: 'range-30' });
  api.sql(
    `INSERT INTO orders (id, user_id, target, status, tier, extras, amount_cents, currency, provider, brief, ref_product_id, pending_since, created_at, updated_at)
     VALUES (?, ?, 'customer', 'draft', 'standard', '{"rush":false,"extraFinishes":0}', 27900, 'usd', 'demo', ?, 'range-30', ?, ?, ?)`,
    id, userId, brief, t, t, t,
  );
  api.sql("INSERT INTO order_items (order_id, idx, brief, tier, extra_finishes, amount_cents) VALUES (?, 0, ?, 'standard', 0, 27900)", id, brief);
  api.sql("INSERT INTO order_events (order_id, type, to_status, by_user_id, created_at) VALUES (?, 'created', 'draft', ?, ?)", id, userId, t);
  must(await api.as('customer').post(`/api/orders/${id}/checkout`, {}), 'Starting the DEMO checkout');
  return id;
}

/** The seeded order the studio has delivered (server/seed/orders.mjs). */
const DELIVERED = 'o_demoseedorder00000000003';

const modelBrief = (name) => ({ brief: { productTypeId: 'base-cabinet', kind: 'base', variant: 'door-drawer', name, upc: '036000291452', notes: 'QA', referenceFileIds: [] } });

/** A reset link for the route's fresh user, made by the admin, as the `#/signin?reset=…` hash. */
async function resetHash(api) {
  const u = await api.as('fresh').user();
  const r = must(await api.as('admin').post(`/api/admin/users/${u.id}/reset-link`), 'Making a reset link');
  return { path: String(r.url).slice(String(r.url).indexOf('#')) };
}

/**
 * A long phone page a screen at a time (`--part1`, `--part2`, …), since a full-page capture of a
 * page taller than 16384 device pixels (5461 CSS px at 3x) wraps around to the top.
 */
async function screens(h, max = 10) {
  const { total, vh } = await h.evaluate(() => ({ total: document.documentElement.scrollHeight, vh: window.innerHeight }));
  const step = Math.round(vh * 0.85);
  for (let i = 0, y = 0; y < total - 40 && i < max; i++, y += step) {
    await h.evaluate((yy) => window.scrollTo(0, yy), y);
    await h.sleep(250);
    await h.shot(`part${i + 1}`);
  }
  await h.evaluate(() => window.scrollTo(0, 0));
}

/**
 * WCAG AA for every visible piece of text on the page, from computed colours: the text colour
 * (with the opacity of its ancestors) over the backgrounds stacked behind it. Text over an image
 * or a gradient can't be measured this way and is skipped (counted). Disabled controls are exempt,
 * as WCAG exempts them. Inputs are measured by their value. Returns { checked, skipped, fails }.
 */
export async function contrastAudit(h, { ignore = [] } = {}) {
  return h.evaluate((ignoreSel) => {
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c || '');
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (t, u) => {
      const a = t.a + u.a * (1 - t.a);
      if (!a) return { r: 0, g: 0, b: 0, a: 0 };
      const mix = (k) => (t[k] * t.a + u[k] * u.a * (1 - t.a)) / a;
      return { r: mix('r'), g: mix('g'), b: mix('b'), a };
    };
    const lin = (v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    const pageBg = parse(getComputedStyle(document.documentElement).backgroundColor);
    const base = pageBg && pageBg.a > 0 ? pageBg : parse(getComputedStyle(document.body).backgroundColor) ?? { r: 255, g: 255, b: 255, a: 1 };
    /** The colour behind `el`, or null when an image or gradient is in the way. */
    const behind = (el) => {
      const layers = [];
      for (let e = el; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (s.backgroundImage && s.backgroundImage !== 'none' && !/^linear-gradient\((rgba?\([^)]*\)) 0px?, \1 0px?\)/.test(s.backgroundImage)) return null;
        if (e.tagName === 'CANVAS' || e.tagName === 'IMG' || e.tagName === 'VIDEO') return null;
        const c = parse(s.backgroundColor);
        if (c && c.a > 0) {
          layers.push(c);
          if (c.a >= 0.999) break;
        }
        // Something positioned over a canvas/image sibling: what's under it isn't in this chain.
        if (s.position === 'absolute' || s.position === 'fixed') {
          const host = e.parentElement;
          if (host && [...host.children].some((k) => k !== e && /^(CANVAS|IMG|VIDEO)$/.test(k.tagName)) && !(c && c.a >= 0.999)) return null;
        }
      }
      let acc = base;
      for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
      return acc;
    };
    const opacityOf = (el) => {
      let o = 1;
      for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return o;
    };
    const visible = (el) => {
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none') return false;
      const b = el.getBoundingClientRect();
      return b.width > 1 && b.height > 1;
    };
    const ignored = (el) => ignoreSel.some((s) => el.closest(s));
    const disabled = (el) => !!el.closest('[disabled], [aria-disabled="true"], .is-disabled, fieldset:disabled');
    const label = (el) => {
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    };
    const out = { checked: 0, skipped: 0, fails: [] };
    const seen = new Set();
    const consider = (el, text) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (!visible(el) || ignored(el) || disabled(el)) return;
      const op = opacityOf(el);
      if (op < 0.6) return; // faded on purpose (disabled look, an animation in progress)
      const s = getComputedStyle(el);
      const fg = parse(s.color);
      if (!fg) return;
      const bg = behind(el);
      if (!bg) {
        out.skipped++;
        return;
      }
      const eff = over({ ...fg, a: fg.a * op }, bg);
      const px = parseFloat(s.fontSize);
      const bold = Number(s.fontWeight) >= 700;
      const need = px >= 24 || (px >= 18.66 && bold) ? 3 : 4.5;
      const r = ratio(eff, bg);
      out.checked++;
      if (r + 0.005 < need) out.fails.push({ el: label(el), text: text.slice(0, 40), fg: hex(eff), bg: hex(bg), ratio: Math.round(r * 100) / 100, need, paper: !!el.closest('.theme-paper, .quote-sheet') });
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.trim();
      if (!t || !n.parentElement) continue;
      const el = n.parentElement;
      if (el.closest('script, style, noscript, svg, [aria-hidden="true"]')) continue;
      consider(el, t);
    }
    for (const el of document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea, select')) {
      const v = el.tagName === 'SELECT' ? el.selectedOptions?.[0]?.textContent ?? '' : el.value;
      if (String(v).trim()) consider(el, String(v).trim());
    }
    return out;
  }, ignore);
}

/** Fails the route on any AA failure (listing the first few); notes the counts. */
async function aa(h, opts) {
  const r = await contrastAudit(h, opts);
  // A printed page shown as one (a quote sheet) keeps the light tokens: judged as light.
  r.fails = r.fails.filter((f) => !(f.paper && knownLight(f)));
  h.note(`contrast: ${r.checked} text elements checked, ${r.skipped} over an image or gradient skipped, ${r.fails.length} under AA`);
  if (r.fails.length) {
    const list = r.fails
      .slice(0, 8)
      .map((f) => `${f.el} "${f.text}" ${f.fg} on ${f.bg} = ${f.ratio}:1 (needs ${f.need})`)
      .join('; ');
    throw new Error(`${r.fails.length} text element(s) under WCAG AA: ${list}`);
  }
}

/** The page is in the dark theme and its colours are the dark tokens, not the light ones. */
async function isDark(h) {
  const r = await h.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    bg: getComputedStyle(document.body).backgroundColor,
    meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    scheme: getComputedStyle(document.documentElement).colorScheme,
  }));
  if (r.theme !== 'dark') throw new Error(`<html data-theme> is "${r.theme}" on a dark device with Appearance = System`);
  if (r.bg !== 'rgb(22, 20, 17)') throw new Error(`the page background is ${r.bg}, not the dark paper`);
  if (r.meta !== '#161411') throw new Error(`theme-color is ${r.meta}`);
  if (r.scheme !== 'dark') throw new Error(`color-scheme is ${r.scheme}`);
}

async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

async function settle(h, ms = 600) {
  await h.waitUntil(() => (document.querySelector('#root')?.innerText ?? '').trim().length >= 10, 10_000, 'some text on the screen').catch(() => {});
  await h.sleep(ms);
}


/**
 * Light mode's text that was already under AA before dark mode (left as it was: light must look
 * exactly as before; see docs/handoff/dark.md): muted text (--ink-3 #8c8477, 2.9-3.7:1), the accent
 * as eyebrow text (#c2542d, 3.8-4.0:1), green and amber text on their soft fills (#3f7d52 4.2:1,
 * #b7791f 3.1:1), "Your model" on the accent (#fbf9f4, 4.3:1) and the faded wall counts in Walls.
 * Anything else under AA in light fails, so dark-mode work can't quietly break light.
 */
const KNOWN_LIGHT_FG = new Set(['#8c8477', '#c2542d', '#3f7d52', '#b7791f']);
function knownLight(f) {
  return KNOWN_LIGHT_FG.has(f.fg) || (f.fg === '#fbf9f4' && f.bg === '#c2542d') || f.el === 'span.count';
}

async function isLight(h) {
  const r = await h.evaluate(() => ({ theme: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor, meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') }));
  if (r.theme !== 'light') throw new Error(`<html data-theme> is "${r.theme}" on a light device`);
  if (r.bg !== 'rgb(243, 238, 229)') throw new Error(`the page background is ${r.bg}, not the light paper`);
  if (r.meta !== '#f3eee5') throw new Error(`theme-color is ${r.meta}`);
}

/**
 * The focus ring: Tab (as a keyboard user does, so :focus-visible applies) until a control
 * matching `selector` (or any control) has focus, then check its outline (or, without one, its
 * border) is at least 3:1 against what is behind it (WCAG 1.4.11).
 */
async function focusRing(h, selector) {
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    await h.key('Tab');
    found = await h.evaluate((sel) => {
      const a = document.activeElement;
      if (!a || a === document.body) return false;
      return sel ? a.matches(sel) : a.matches('a[href], button, input, select, textarea, [tabindex]');
    }, selector ?? null);
  }
  if (!found) throw new Error(`Tab never reached ${selector ?? 'a control'}`);
  await h.sleep(350); // focus styles transition in (0.15 s)
  const r = await h.evaluate(() => {
    const a = document.activeElement;
    const s = getComputedStyle(a);
    const parse = (c) => {
      const m = /rgba?\(([^)]+)\)/.exec(c || '');
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    let bg = null;
    for (let e = a.parentElement; e && !bg; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a >= 0.9) bg = c;
    }
    bg ??= parse(getComputedStyle(document.body).backgroundColor);
    const outlined = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1;
    const ring = outlined ? parse(s.outlineColor) : parse(s.borderColor);
    const [x, y] = [lum(ring), lum(bg)].sort((p, q) => q - p);
    const cls = typeof a.className === 'string' && a.className ? '.' + a.className.split(' ')[0] : '';
    return { el: `${a.tagName.toLowerCase()}${cls}`, how: outlined ? `outline ${s.outlineWidth} ${s.outlineColor}` : `border ${s.borderColor}`, ratio: Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100 };
  });
  h.note(`focus ring on ${r.el}: ${r.how}, ${r.ratio}:1 against what is behind it`);
  if (r.ratio < 3) throw new Error(`the focus ring on ${r.el} is ${r.ratio}:1 against its background (needs 3)`);
}

/** A dark screen: the theme is applied, nothing scrolls sideways, every piece of text passes AA. */
const darkCheck =
  (extra, opts = {}) =>
  async (h) => {
    await settle(h);
    if (extra) await extra(h);
    await isDark(h);
    await noSideScroll(h);
    await aa(h, opts);
    if (opts.focus) await focusRing(h, opts.focus === true ? null : opts.focus);
    if (opts.screens && isPhone(h)) await screens(h);
  };

/**
 * Several screens in one route: for each stop, go to `hash` (or run `go`), wait for `text`, then
 * the dark checks and a screenshot named after the stop. A failure names the stop.
 */
const darkTour =
  (stops, opts = {}) =>
  async (h) => {
    for (const s of stops) {
      try {
        if (s.hash) await h.goto(s.hash);
        if (s.go) await s.go(h);
        if (s.text) await h.waitForText(s.text);
        if (s.wait) await h.waitFor(s.wait);
        await h.sleep(s.ms ?? 500);
        await isDark(h);
        await noSideScroll(h);
        await aa(h, { ...opts, ...(s.opts ?? {}) });
        await h.shot(s.name);
      } catch (err) {
        throw new Error(`${s.name}: ${err?.message ?? err}`);
      }
    }
  };

/** A light screen: light tokens, and no text under AA beyond what was already there (KNOWN_LIGHT). */
const lightCheck =
  (extra, opts = {}) =>
  async (h) => {
    await settle(h);
    if (extra) await extra(h);
    await isLight(h);
    await noSideScroll(h);
    const r = await contrastAudit(h, opts);
    const known = r.fails.filter(knownLight);
    const fresh = r.fails.filter((f) => !known.includes(f));
    h.note(`contrast (light): ${r.checked} checked, ${known.length} already under AA before dark mode (muted, eyebrow and green-on-soft text), ${fresh.length} new`);
    if (fresh.length) throw new Error(`${fresh.length} text element(s) under WCAG AA in light: ${fresh.slice(0, 8).map((f) => `${f.el} "${f.text}" ${f.fg} on ${f.bg} = ${f.ratio}:1`).join('; ')}`);
    if (opts.focus) await focusRing(h, opts.focus === true ? null : opts.focus);
  };

/** One route at 1440 (desktop) and one at 390 (phone). */
function both(route) {
  return [
    { colorScheme: 'dark', ...route, viewport: 'desktop' },
    { colorScheme: 'dark', ...route, name: `${route.name}-phone`, viewport: 'phone', fullPage: route.phoneFullPage ?? route.fullPage },
  ];
}

const store = (h, fn, ...args) => h.evaluate(fn, ...args);
const qaStore = async (h) => h.waitUntil(() => !!window.__blumodelQA?.store, 10_000, 'window.__blumodelQA.store');
const ui = (patch) => async (h) => {
  await qaStore(h);
  await store(h, (p) => window.__blumodelQA.store.getState().setUI(p), patch);
  await h.sleep(600);
};

/** The QA contractor's company (a contractor needs the business name and phone). */
const COMPANY = { company: 'Ember & Oak Kitchens (QA)', phone: '905-555-0177', serviceArea: 'Testville', defaultMarkupPct: 30 };
async function contractorAt(api, path) {
  must(await api.as('contractor').put('/api/pro/profile', COMPANY), 'Saving the company');
  return { path };
}

async function sharedKitchen(api) {
  const me = api.as('customer');
  const k = await newKitchen(me, 'Dark Shared Kitchen');
  const link = must(await me.post(`/api/projects/${k.projectId}/shares`, {}), 'Creating the share link').share;
  return { path: `#/s/${link.token}` };
}

async function demoProductPath(api) {
  const p = (must(await api.get('/api/catalog'), 'The catalog').products ?? []).find((x) => x.name === 'Sample Gas Range 30″ (Demo)');
  if (!p) throw new Error('the seeded demo range is not in /api/catalog');
  return { path: `#/p/${p.id}` };
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

/** Opens the editor's Export menu (the icon on a phone, the button on a desktop). */
async function exportMenu(h) {
  const compact = await h.evaluate(() => !!document.querySelector('.export-btn'));
  await h.click(compact ? '.export-btn' : '.topbar .menu-wrap > .btn.primary');
  await h.waitFor('.topbar .menu[role="menu"]');
  await h.sleep(250);
}

/** Clicks (in the page) the first `selector` whose text includes `text`. Works the same on phones. */
async function press(h, selector, text) {
  const ok = await h.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.replace(/\s+/g, ' ').trim().includes(t) && !e.disabled);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.click();
      }
      return !!el;
    },
    selector,
    text,
  );
  if (!ok) throw new Error(`no ${selector} with "${text}"`);
}

/** Opens one of the phone editor's sheets by its bottom-bar button. */
async function openSheet(h, label) {
  await h.waitFor('.mbar');
  const ok = await h.evaluate((l) => {
    const b = document.querySelector(`.mbar-actions button[aria-label="${l}"]`);
    b?.click();
    return !!b;
  }, label);
  if (!ok) throw new Error(`no "${label}" button in the phone bar`);
  await h.waitFor('.sheet.is-open');
  await h.sleep(600);
}

const editor = (name, extra, opts) => ({
  name,
  as: 'customer',
  setup: async ({ me }) => newKitchen(me, `Kitchen ${name}`),
  waitFor: ['.topbar'],
  check: darkCheck(extra, opts),
});

/** A single dark route (desktop unless it says otherwise). */
const one = (route) => ({ colorScheme: 'dark', ...route });
/** An editor route on a phone. */
const phoneEditor = (name, extra, opts) => one({ ...editor(name, extra, opts), viewport: 'phone', waitFor: ['.mbar'] });

/** Through the setup wizard by its Continue button: 1 = Room, 2 = Layout, 3 = Choose your brands. */
const wizardStep = (n) => async (h) => {
  for (let i = 0; i < n; i++) {
    await h.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^(Continue|Next)/.test(x.textContent.trim()) && !x.disabled);
      if (!b) throw new Error('no Continue button');
      b.click();
    });
    await h.sleep(500);
  }
};

/** Every tab of the contractor workspace, for the demo contractor (a live brand page with leads). */
const PRO_TOUR = [
  { name: 'dashboard', wait: '.pro-main' },
  { name: 'catalog', hash: '#/pro/catalog', text: 'The products you sell' },
  { name: 'price-book', hash: '#/pro/price-book', text: 'Cost, markup and sell price' },
  { name: 'brands', hash: '#/pro/brands', text: 'What shows while you design' },
  { name: 'quotes', hash: '#/pro/quotes', text: 'Your kitchens, priced' },
  { name: 'modelling', hash: '#/pro/modelling', text: 'Have BluModel Studio model your products' },
  { name: 'company', hash: '#/pro/company', text: 'What your clients see' },
  { name: 'brand', hash: '#/pro/brand', wait: '.brand-stats' },
  { name: 'brand-products', hash: '#/pro/brand/products', wait: '.brand-row' },
  { name: 'brand-leads', hash: '#/pro/brand/leads', wait: '.brand-lead' },
  { name: 'brand-settings', hash: '#/pro/brand/settings', wait: '.brand-settings' },
];

/** Every admin tab, for the phone (the desktop has a route each). */
const ADMIN_TOUR = [
  { name: 'overview', wait: '.admin-main, main' },
  { name: 'moderation', hash: '#/admin/moderation', wait: '.mod-queue' },
  { name: 'brands', hash: '#/admin/brands', wait: '.adm-brand' },
  { name: 'retailers', hash: '#/admin/retailers', wait: '.rt-card' },
  { name: 'studio', hash: '#/admin/studio', wait: '.ord-queue' },
  { name: 'revenue', hash: '#/admin/revenue', wait: '.ord-kpis' },
  { name: 'billing', hash: '#/admin/billing', text: 'Cancelling at period end' },
  { name: 'users', hash: '#/admin/users', text: 'Create reset link' },
];

const crashNoise = [/deliberate crash/i, /The above error occurred/i, /React will try to recreate/i, /Consider adding an error boundary/i];

export default [
  // ── Public pages ──────────────────────────────────────────────────────────
  ...both({ name: 'dark-landing', path: '#/welcome', as: 'anon', fullPage: true, phoneFullPage: false, check: darkCheck(null, { focus: true, screens: true }) }),
  ...both({ name: 'dark-pricing', path: '#/pricing', as: 'anon', fullPage: true, phoneFullPage: false, check: darkCheck(null, { screens: true }) }),
  ...both({ name: 'dark-terms', path: '#/terms', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-privacy', path: '#/privacy', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-refunds', path: '#/refunds', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-signin', path: '#/signin', as: 'anon', waitFor: ['input[type="password"]'], check: darkCheck(null, { focus: 'input' }) }),
  ...both({
    // A wrong password: the error under the form.
    name: 'dark-signin-error',
    path: '#/signin',
    as: 'anon',
    waitFor: ['input[type="password"]'],
    check: darkCheck(async (h) => {
      await h.click('.auth-form input[type="email"]');
      await h.type('nobody-here@blumodel.test');
      await h.click('.auth-form input[type="password"]');
      await h.type('not the password 1');
      await h.evaluate(() => document.querySelector('.auth-form button[type="submit"]').click());
      await h.waitFor('.auth-error');
      await h.sleep(300);
    }),
  }),
  ...both({ name: 'dark-signup', path: '#/signup', as: 'anon', waitFor: ['input[type="password"]'], check: darkCheck() }),
  ...both({ name: 'dark-forgot', path: '#/signin?forgot=1', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-reset', as: 'anon', setup: ({ api }) => resetHash(api), waitFor: ['input[autocomplete="new-password"]'], check: darkCheck() }),
  one({ name: 'dark-reset-expired', path: `#/signin?reset=${'A'.repeat(43)}`, as: 'anon', expectText: ['This link has expired'], check: darkCheck() }),
  ...both({ name: 'dark-not-found', path: '#/no-such-page', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-error', path: '#/pricing?qa-crash=route', as: 'anon', ignoreConsole: crashNoise, check: darkCheck() }),
  ...both({ name: 'dark-brand-page', path: '#/b/blumodel-sample-co-demo', as: 'anon', fullPage: true, phoneFullPage: false, check: darkCheck(null, { screens: true }) }),
  ...both({
    name: 'dark-contractor-page',
    as: 'anon',
    setup: async ({ api }) => ({ path: `#/b/${(await listedPro(api)).slug}` }),
    check: withPro(darkCheck((h) => h.waitFor('.bp-cta button'))),
  }),
  ...both({
    // Ask for a quote, sent empty: the form's own errors.
    name: 'dark-lead-form',
    as: 'anon',
    setup: async ({ api }) => ({ path: `#/b/${(await listedPro(api)).slug}` }),
    check: withPro(
      darkCheck(async (h) => {
        await h.waitFor('.bp-cta button');
        await h.evaluate(() => document.querySelector('.bp-cta button').click());
        await h.waitFor('.lead-modal');
        await h.evaluate(() => document.querySelector('.lead-modal button[type="submit"]').click());
        await h.waitForText('Tell them your name.');
        await h.sleep(300);
      }),
    ),
  }),
  ...both({ name: 'dark-product', as: 'anon', setup: ({ api }) => demoProductPath(api), fullPage: true, phoneFullPage: false, check: darkCheck(null, { screens: true }) }),
  ...both({
    // Where to buy, with a sponsored store first (put back afterwards).
    name: 'dark-product-retail',
    as: 'anon',
    fullPage: true,
    phoneFullPage: false,
    setup: async ({ api }) => {
      await setStore(api, 'rona', { sponsored: true, affiliate: 'aff=blumodel-dark-qa' });
      return { path: `#/p/${RETAIL_RANGE}` };
    },
    check: async (h) => {
      try {
        await darkCheck((x) => x.waitFor('.pp-buy-row'), { screens: true })(h);
      } finally {
        await setStore(h.api, 'rona', { sponsored: false, affiliate: '' });
      }
    },
  }),
  one({
    name: 'dark-product-photo',
    as: 'anon',
    setup: ({ api }) => demoProductPath(api),
    check: darkCheck(async (h) => {
      await h.waitFor('.pp-thumb');
      await h.click('.pp-thumb');
      await h.waitFor('.modal.pp-photo');
      await h.sleep(500);
    }),
  }),
  ...both({
    name: 'dark-product-add',
    as: 'customer',
    setup: async ({ api, me }) => {
      await newKitchen(me, 'Dark Product Kitchen');
      return demoProductPath(api);
    },
    check: darkCheck(async (h) => {
      await press(h, 'button', 'Add to a kitchen');
      await h.waitFor('.modal.pp-add');
      await h.sleep(500);
    }),
  }),
  one({
    name: 'dark-brand-try',
    path: '#/b/blumodel-sample-co-demo',
    as: 'customer',
    check: darkCheck(async (h) => {
      await press(h, 'button', 'Try in my kitchen');
      await h.waitFor('.modal.try-modal');
      await h.sleep(500);
    }),
  }),
  ...both({ name: 'dark-share', as: 'anon', setup: ({ api }) => sharedKitchen(api), waitFor: ['.share-bar'], check: darkCheck() }),
  ...both({
    // A kitchen a contractor prepared: "Prepared by" with Contact, prices on.
    name: 'dark-share-contractor',
    as: 'anon',
    async setup({ api }) {
      await contractorAt(api, '#/');
      const pro = api.as('contractor');
      const k = await newKitchen(pro, 'Dark Client Share', { client: 'J. Okafor (QA)' });
      const link = must(await pro.post(`/api/projects/${k.projectId}/shares`, { label: 'For the Okafors', showPrices: true }), 'Creating the share link').share;
      return { path: `#/s/${link.token}` };
    },
    waitFor: ['.share-bar'],
    check: darkCheck(),
  }),
  ...both({ name: 'dark-local', path: '#/local', as: 'anon', waitFor: ['.topbar', '.plan-view canvas'], check: darkCheck() }),
  one({
    // A device draft can't export: the Unlock dialog asks for a free account first.
    name: 'dark-local-export',
    path: '#/local',
    as: 'anon',
    waitFor: ['.topbar', '.plan-view canvas'],
    check: darkCheck(async (h) => {
      await exportItem(h, 'Project file');
      await h.waitFor('.modal.unlock[role="dialog"]');
      await h.sleep(400);
    }),
  }),
  ...both({ name: 'dark-pay-demo', as: 'customer', setup: async ({ api }) => ({ path: `#/pay/demo/${await priorOrder(api)}` }), waitFor: ['.ord-pay-card'], check: darkCheck() }),
  ...both({
    name: 'dark-pay-demo-plan',
    as: 'fresh',
    setup: async ({ me }) => {
      const c = must(await me.post('/api/billing/checkout', { kind: 'subscription', plan: 'unlimited' }), 'Unlimited demo checkout');
      return { path: `#/pay/demo-plan/${c.ref}` };
    },
    check: darkCheck(),
  }),

  // ── Signed in ─────────────────────────────────────────────────────────────
  ...both({
    name: 'dark-home',
    as: 'customer',
    setup: async ({ me }) => {
      await newKitchen(me, 'Dark Home Kitchen');
      return { path: '#/' };
    },
    check: darkCheck(),
  }),
  one({
    name: 'dark-home-delete',
    as: 'customer',
    setup: async ({ me }) => {
      await newKitchen(me, 'Dark Delete Kitchen');
      return { path: '#/' };
    },
    check: darkCheck(async (h) => {
      const sel = 'button[aria-label="Delete Dark Delete Kitchen"]';
      await h.waitFor(sel);
      await h.evaluate((s) => document.querySelector(s).click(), sel);
      await h.waitForText('Delete?');
      await h.sleep(300);
    }),
  }),
  ...both({ name: 'dark-wizard', path: '#/new', as: 'customer', check: darkCheck() }),
  ...both({ name: 'dark-wizard-room', path: '#/new', as: 'customer', check: darkCheck(wizardStep(1)) }),
  ...both({ name: 'dark-wizard-layout', path: '#/new', as: 'customer', check: darkCheck(wizardStep(2)) }),
  ...both({ name: 'dark-wizard-brands', path: '#/new', as: 'customer', check: darkCheck(wizardStep(3)) }),
  ...both({ name: 'dark-account', path: '#/account', as: 'customer', fullPage: true, check: darkCheck(null, { focus: 'input' }) }),
  one({
    name: 'dark-account-delete',
    path: '#/account',
    as: 'fresh',
    fullPage: true,
    check: darkCheck(async (h) => {
      await press(h, '.acct-actions button', 'Delete my account');
      await h.waitForText('This can’t be undone');
      await h.sleep(300);
    }),
  }),
  ...both({ name: 'dark-billing', path: '#/account/billing', as: 'customer', fullPage: true, check: darkCheck() }),
  ...both({ name: 'dark-billing-contractor', path: '#/account/billing', as: 'contractor', fullPage: true, check: darkCheck() }),
  one({
    name: 'dark-billing-cancel',
    path: '#/account/billing',
    as: 'contractor',
    check: darkCheck(async (h) => {
      await press(h, 'button', 'Cancel plan');
      await h.waitForText('Cancel your plan?');
      await h.sleep(300);
    }),
  }),
  ...both({ name: 'dark-orders', as: 'contractor', setup: ({ api }) => contractorAt(api, '#/orders'), check: darkCheck() }),
  ...both({ name: 'dark-orders-new', as: 'contractor', setup: ({ api }) => contractorAt(api, '#/orders/new'), fullPage: true, check: darkCheck() }),
  ...both({
    // Every model used this month: the list and the form say so and offer Need more?
    name: 'dark-models-none-left',
    as: 'fresh',
    setup: async ({ api }) => {
      const me = await freshContractor(api);
      const a = must(await me.get('/api/orders/allowance'), 'The allowance').allowance;
      const r = must(await me.post('/api/orders', { target: 'contractor', items: Array.from({ length: a.left }, (_, i) => modelBrief(`Dark Harbor Base ${i + 1} (Demo)`)) }), 'Using the allowance');
      return { path: '#/orders', orderId: r.order.id };
    },
    check: async (h) => {
      try {
        await darkTour([
          { name: 'list', wait: '.ord-allowance-bar', text: 'No models left this month' },
          { name: 'form', hash: '#/orders/new?target=contractor', wait: '.ord-allowance', text: 'Need more?' },
        ])(h);
      } finally {
        await h.me.post(`/api/orders/${h.data.orderId}/cancel`, {});
      }
    },
  }),
  ...both({ name: 'dark-orders-customer', path: '#/orders', as: 'customer', check: darkCheck((h) => h.waitFor('.ord-list')) }),
  ...both({ name: 'dark-order-delivered', path: `#/orders/${DELIVERED}`, as: 'customer', fullPage: true, phoneFullPage: false, check: darkCheck((h) => h.waitFor('.ord-deliverable'), { screens: true }) }),
  ...both({ name: 'dark-pro', as: 'contractor', setup: ({ api }) => contractorAt(api, '#/pro'), check: darkCheck() }),
  ...['catalog', 'price-book', 'brands', 'quotes', 'modelling', 'brand', 'company'].map((tab) =>
    one({ name: `dark-pro-${tab}`, as: 'contractor', setup: ({ api }) => contractorAt(api, `#/pro/${tab}`), check: darkCheck() }),
  ),
  ...both({
    // The workspace with content: the demo contractor's catalog, price book, brand page and leads.
    name: 'dark-pro-tour',
    path: '#/pro',
    as: 'brand',
    check: darkTour(PRO_TOUR),
  }),
  ...both({
    // A new contractor's company form, sent empty: the required-field errors.
    name: 'dark-pro-setup',
    as: 'fresh',
    setup: async ({ api }) => {
      await freshContractor(api, null);
      return { path: '#/pro' };
    },
    check: darkCheck(async (h) => {
      await h.waitFor('.pro-setup-card');
      await press(h, '.pro-setup-card button[type="submit"]', 'Continue');
      await h.waitForText('Enter your business name.');
      await h.sleep(300);
    }),
  }),
  ...both({
    name: 'dark-pro-quote',
    as: 'contractor',
    async setup({ api }) {
      await contractorAt(api, '#/pro');
      const k = await newKitchen(api.as('contractor'), 'Dark Quote Kitchen');
      return { path: `#/pro/quote/${k.projectId}` };
    },
    check: darkCheck(),
  }),
  ...both({ name: 'dark-brand-portal', path: '#/brand', as: 'brand', check: darkCheck() }),
  ...both({ name: 'dark-admin', path: '#/admin/overview', as: 'admin', check: darkCheck() }),
  ...['moderation', 'brands', 'retailers', 'studio', 'revenue', 'billing', 'users'].map((tab) => one({ name: `dark-admin-${tab}`, path: `#/admin/${tab}`, as: 'admin', fullPage: true, check: darkCheck() })),
  one({ name: 'dark-admin-tour-phone', path: '#/admin/overview', as: 'admin', viewport: 'phone', check: darkTour(ADMIN_TOUR) }),
  one({
    name: 'dark-admin-preview',
    path: '#/admin/moderation',
    as: 'admin',
    check: darkCheck(async (h) => {
      await h.waitFor('.mod-queue');
      await press(h, 'button', 'Preview page');
      await h.waitFor('.mod-preview-backdrop');
      await h.sleep(600);
    }),
  }),
  one({
    name: 'dark-admin-reject',
    path: '#/admin/moderation',
    as: 'admin',
    check: darkCheck(async (h) => {
      await h.waitFor('.mod-queue');
      await press(h, 'button', 'Reject…');
      await h.waitFor('.modal[role="dialog"]');
      await h.sleep(400);
    }),
  }),
  one({
    name: 'dark-admin-partner',
    path: '#/admin/brands',
    as: 'admin',
    check: darkCheck(async (h) => {
      await h.waitFor('.adm-brand');
      await press(h, 'button', 'New partner brand');
      await h.waitFor('.modal[role="dialog"]');
      await h.sleep(400);
    }),
  }),
  one({
    name: 'dark-admin-drawer',
    path: '#/admin/studio',
    as: 'admin',
    check: darkCheck(async (h) => {
      await h.waitFor('.ord-q-row');
      await press(h, '.ord-q-row', 'Enamel dome pendant (Demo)');
      await h.waitFor('.ord-drawer');
      await h.sleep(800);
    }),
  }),
  one({
    name: 'dark-admin-reset-link',
    path: '#/admin/users',
    as: 'admin',
    setup: async ({ api }) => ({ email: (await api.as('fresh').user()).email }),
    check: darkCheck(async (h) => {
      await h.waitFor('.admin-users .home-search input');
      await h.click('.admin-users .home-search input');
      await h.type(h.data.email);
      await press(h, '.admin-users .home-search button', 'Search');
      await h.waitUntil(() => document.querySelectorAll('.admin-table tbody tr').length === 1, 6000, 'the search finding one user');
      await h.evaluate(() => document.querySelector('.admin-table tbody tr button').click());
      await h.waitFor('.admin-reset-url');
      await h.sleep(300);
    }),
  }),

  // ── The editor: panels, sheets, toolbar, catalog, inspector, estimate, dialogs, toasts ──
  ...both(editor('dark-editor-plan', ui({ viewMode: 'plan', planStyle: 'rendered' }), { focus: '.topbar button' })),
  ...both(
    editor('dark-editor-drafting', async (h) => {
      await ui({ viewMode: 'plan', planStyle: 'drafting' })(h);
      await store(h, () => window.__blumodelQA.store.getState().select('qa-range'));
      await h.sleep(500);
    }),
  ),
  ...both(
    editor('dark-editor-3d', async (h) => {
      await ui({ viewMode: '3d' })(h);
      await h.waitUntil(() => !!document.querySelector('.scene-view canvas') && !document.querySelector('.scene-loading'), 25_000, 'the 3D scene');
      await h.sleep(1500);
    }),
  ),
  ...both(editor('dark-editor-walls', ui({ viewMode: 'walls' }))),
  one(editor('dark-editor-room', ui({ leftTab: 'room', viewMode: 'split' }))),
  one(editor('dark-editor-checks', ui({ rightTab: 'checks' }))),
  one(
    // Store chips on the catalog cards: the RONA filter.
    editor('dark-editor-catalog-stores', async (h) => {
      await h.waitFor('.left-panel #catalog-store');
      await pick(h, '.left-panel #catalog-store', 'rona');
      await h.waitFor('.left-panel .store-chip');
      await h.sleep(400);
    }),
  ),
  ...both({
    name: 'dark-editor-estimate',
    as: 'fresh',
    setup: async ({ me }) => {
      must(await me.patch('/api/account/prefs', { showEstimator: true }), 'Turning the estimator on');
      return newKitchen(me, 'Dark Estimate Kitchen');
    },
    waitFor: ['.topbar'],
    check: darkCheck(async (h) => {
      if (isPhone(h)) await openSheet(h, 'Details');
      await ui({ rightTab: 'estimate', viewMode: 'split' })(h);
    }),
  }),
  ...both(
    editor('dark-editor-toast', async (h) => {
      await qaStore(h);
      await store(h, () => {
        const s = window.__blumodelQA.store.getState();
        s.toast('Plan saved as PNG.', 'ok');
        s.toast('Two pieces overlap.', 'warn');
        s.toast('Loaded the other version of this kitchen.', 'info');
      });
      await h.waitFor('.toast');
      await h.sleep(300);
    }),
  ),
  ...both(editor('dark-editor-export-menu', exportMenu)),
  ...both(
    editor('dark-editor-account-menu', async (h) => {
      await h.evaluate(() => document.querySelector('.menu-wrap .avatar')?.click());
      await h.waitFor('.menu-wrap .menu');
      await h.sleep(300);
    }),
  ),
  ...both({
    name: 'dark-editor-share',
    as: 'customer',
    setup: async ({ me }) => {
      const k = await newKitchen(me, 'Dark Share Dialog Kitchen');
      must(await me.post(`/api/projects/${k.projectId}/shares`, { label: 'For Sam', showPrices: true, expiresInDays: 30 }), 'A link');
      must(await me.post(`/api/projects/${k.projectId}/shares`, { label: 'Walk-through, no prices', showPrices: false }), 'A second link');
      const old = must(await me.post(`/api/projects/${k.projectId}/shares`, { label: 'Turned off already' }), 'A third link').share;
      must(await me.delete(`/api/projects/${k.projectId}/shares/${old.id}`), 'Turning a link off');
      return k;
    },
    waitFor: ['.share-btn'],
    check: darkCheck(async (h) => {
      await h.evaluate(() => document.querySelector('.share-btn').click());
      await h.waitFor('.share-dialog .share-link');
      await h.sleep(500);
    }),
  }),
  ...both(
    editor('dark-editor-render', async (h) => {
      await h.waitFor('.studio-btn');
      await h.evaluate(() => document.querySelector('.studio-btn').click());
      await h.waitFor('.studio-dialog');
      await h.sleep(1500);
    }),
  ),
  ...both(
    editor('dark-editor-offline', async (h) => {
      await h.evaluate(() => window.dispatchEvent(new Event('offline')));
      await h.waitFor('.conn-banner');
      await h.sleep(300);
    }),
  ),
  one(
    // Saved somewhere else first: the conflict dialog.
    editor('dark-editor-conflict', async (h) => {
      await qaStore(h);
      await h.waitFor('.plan-view canvas');
      await h.sleep(800);
      h.api.sql('UPDATE projects SET revision = revision + 1 WHERE id = ?', h.data.projectId);
      await store(h, () => window.__blumodelQA.store.getState().nudge('qa-island', 2, 0));
      await h.waitFor('.conflict-modal', 10_000);
      await h.sleep(400);
    }),
  ),
  one({
    // A contractor's own kitchen: Present, the estimate's Client / Contractor view, Quote in Export.
    name: 'dark-editor-contractor',
    as: 'fresh',
    setup: async ({ api }) => {
      const me = await freshContractor(api);
      must(await me.patch('/api/account/prefs', { showEstimator: true }), 'Turning the estimator on');
      return newKitchen(me, 'Dark Client Kitchen', { client: 'P. Client (QA)' });
    },
    waitFor: ['.topbar'],
    check: darkCheck(async (h) => {
      await h.waitFor('.plan-view canvas');
      await ui({ rightTab: 'estimate', viewMode: 'split' })(h);
      await exportMenu(h);
    }),
  }),
  phoneEditor('dark-editor-phone-catalog', (h) => openSheet(h, 'Add products')),
  phoneEditor('dark-editor-phone-catalog-stores', async (h) => {
    await openSheet(h, 'Add products');
    await h.waitFor('.sheet #catalog-store');
    await pick(h, '.sheet #catalog-store', 'home-depot');
    await h.waitFor('.sheet .store-chip');
    await h.sleep(400);
  }),
  phoneEditor('dark-editor-phone-place', async (h) => {
    // A tap on a product arms it and shows "Tap the room to place" over the plan.
    await openSheet(h, 'Add products');
    await h.waitFor('.sheet .product-card');
    await h.tap('.sheet .product-card');
    await h.waitFor('.place-banner');
    await h.sleep(600);
  }),
  phoneEditor('dark-editor-phone-room', (h) => openSheet(h, 'Room and finishes')),
  phoneEditor('dark-editor-phone-details', (h) => openSheet(h, 'Details')),
  phoneEditor('dark-editor-phone-checks', async (h) => {
    await openSheet(h, 'Details');
    await ui({ rightTab: 'checks' })(h);
  }),
  phoneEditor('dark-editor-phone-inspector', async (h) => {
    await qaStore(h);
    await store(h, () => window.__blumodelQA.store.getState().select('qa-range'));
    await h.sleep(400);
    // With a piece selected the bar's Details button is "Item".
    await openSheet(h, 'Item');
  }),
  ...both({
    name: 'dark-unlock-dialog',
    as: 'fresh',
    setup: async ({ me }) => newKitchen(me, 'Dark Paywall Kitchen'),
    waitFor: ['.topbar', '.plan-view canvas'],
    check: darkCheck(async (h) => {
      await exportItem(h, 'Shopping list');
      await h.waitFor('.modal.unlock[role="dialog"]');
      await h.sleep(400);
    }),
  }),

  // ── Light: the same screens as before dark mode (compare with a pre-dark build, docs/handoff/dark.md) ──
  { name: 'light-landing', path: '#/welcome', as: 'anon', colorScheme: 'light', fullPage: true, check: lightCheck(null, { focus: true }) },
  { name: 'light-landing-phone', path: '#/welcome', as: 'anon', colorScheme: 'light', viewport: 'phone', check: lightCheck() },
  { name: 'light-pricing', path: '#/pricing', as: 'anon', colorScheme: 'light', fullPage: true, check: lightCheck() },
  { name: 'light-signin', path: '#/signin', as: 'anon', colorScheme: 'light', waitFor: ['input[type="password"]'], check: lightCheck(null, { focus: 'input' }) },
  { name: 'light-account', path: '#/account', as: 'customer', colorScheme: 'light', fullPage: true, check: lightCheck() },
  { name: 'light-billing', path: '#/account/billing', as: 'customer', colorScheme: 'light', check: lightCheck() },
  { name: 'light-admin', path: '#/admin/overview', as: 'admin', colorScheme: 'light', check: lightCheck() },
  { name: 'light-pro', as: 'contractor', colorScheme: 'light', setup: ({ api }) => contractorAt(api, '#/pro'), check: lightCheck() },
  { name: 'light-product', as: 'anon', colorScheme: 'light', setup: ({ api }) => demoProductPath(api), check: lightCheck() },
  { name: 'light-wizard-brands', path: '#/new', as: 'customer', colorScheme: 'light', check: lightCheck(wizardStep(3)) },
  { name: 'light-share', as: 'anon', colorScheme: 'light', setup: ({ api }) => sharedKitchen(api), waitFor: ['.share-bar'], check: lightCheck() },
  { ...editor('light-editor-plan'), colorScheme: 'light', waitFor: ['.topbar', '.plan-view canvas'], check: lightCheck(ui({ viewMode: 'plan', planStyle: 'rendered' })) },
  { ...editor('light-editor-drafting'), colorScheme: 'light', waitFor: ['.topbar', '.plan-view canvas'], check: lightCheck(ui({ viewMode: 'plan', planStyle: 'drafting' })) },
  { ...editor('light-editor-walls'), colorScheme: 'light', check: lightCheck(ui({ viewMode: 'walls' })) },
  { ...editor('light-editor-phone'), colorScheme: 'light', viewport: 'phone', waitFor: ['.mbar'], check: lightCheck() },
];
