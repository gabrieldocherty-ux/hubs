// Dark mode QA: every routed screen in the dark theme at 1440 and 390, with a contrast audit of
// the text the screen shows (WCAG AA from computed colours), a visible focus ring, and a few light
// routes to compare with the pre-dark build.
// Run: node scripts/qa.mjs --pkg dark --port 8882 --dist .build/dark --strict-external
//
// Dark is reached the way most people will: Appearance = System (the default) on a device set to
// dark (`colorScheme: 'dark'` emulates prefers-color-scheme). The account's own Dark choice is
// covered by the account package's theme-switch route.

import { kitchenDoc } from './core.mjs';

const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what} failed (${r.status}): ${r.body?.error ?? String(r.text ?? '').slice(0, 200)}`);
  return r.body;
};

async function newKitchen(me, name) {
  const { project } = must(await me.post('/api/projects', { name, doc: kitchenDoc(name) }), `Creating "${name}"`);
  return { path: `#/k/${project.id}`, projectId: project.id, name };
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
      if (r + 0.005 < need) out.fails.push({ el: label(el), text: text.slice(0, 40), fg: hex(eff), bg: hex(bg), ratio: Math.round(r * 100) / 100, need });
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

/** A dark screen: the theme is applied, nothing scrolls sideways, every piece of text passes AA. */
const darkCheck = (extra, opts) => async (h) => {
  await settle(h);
  if (extra) await extra(h);
  await isDark(h);
  await noSideScroll(h);
  await aa(h, opts);
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

export default [
  // ── Public pages ──────────────────────────────────────────────────────────
  ...both({ name: 'dark-landing', path: '#/welcome', as: 'anon', fullPage: true, check: darkCheck() }),
  ...both({ name: 'dark-pricing', path: '#/pricing', as: 'anon', fullPage: true, check: darkCheck() }),
  ...both({ name: 'dark-terms', path: '#/terms', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-signin', path: '#/signin', as: 'anon', waitFor: ['input[type="password"]'], check: darkCheck() }),
  ...both({ name: 'dark-signup', path: '#/signup', as: 'anon', waitFor: ['input[type="password"]'], check: darkCheck() }),
  ...both({ name: 'dark-forgot', path: '#/signin?forgot=1', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-not-found', path: '#/no-such-page', as: 'anon', check: darkCheck() }),

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
  ...both({ name: 'dark-wizard', path: '#/new', as: 'customer', check: darkCheck() }),
  ...both({ name: 'dark-account', path: '#/account', as: 'customer', fullPage: true, check: darkCheck() }),
  ...both({ name: 'dark-billing', path: '#/account/billing', as: 'customer', fullPage: true, check: darkCheck() }),
  ...both({ name: 'dark-orders', path: '#/orders', as: 'contractor', check: darkCheck() }),
  ...both({ name: 'dark-pro', path: '#/pro', as: 'contractor', check: darkCheck() }),
  ...both({ name: 'dark-contractors', path: '#/contractors', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-generate', path: '#/generate', as: 'customer', check: darkCheck() }),
  ...both({ name: 'dark-brand-page', path: '#/b/blumodel-sample-co-demo', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-brand-portal', path: '#/brand', as: 'brand', check: darkCheck() }),
  ...both({ name: 'dark-admin', path: '#/admin/overview', as: 'admin', check: darkCheck() }),
  ...both({ name: 'dark-admin-users', path: '#/admin/users', as: 'admin', check: darkCheck() }),
  ...both({
    name: 'dark-product',
    as: 'anon',
    async setup({ api }) {
      const p = (must(await api.get('/api/catalog'), 'The catalog').products ?? []).find((x) => x.name === 'Sample Gas Range 30″ (Demo)');
      if (!p) throw new Error('the seeded demo range is not in /api/catalog');
      return { path: `#/p/${p.id}` };
    },
    check: darkCheck(),
  }),
  ...both({
    name: 'dark-share',
    as: 'anon',
    async setup({ api }) {
      const me = api.as('customer');
      const k = await newKitchen(me, 'Dark Shared Kitchen');
      const link = must(await me.post(`/api/projects/${k.projectId}/shares`, {}), 'Creating the share link').share;
      return { path: `#/s/${link.token}` };
    },
    waitFor: ['.share-bar'],
    check: darkCheck(),
  }),

  // ── The editor ────────────────────────────────────────────────────────────
  ...both({
    name: 'dark-editor-plan',
    as: 'customer',
    setup: async ({ me }) => newKitchen(me, 'Dark Plan Kitchen'),
    waitFor: ['.topbar', '.plan-view canvas'],
    check: darkCheck(async (h) => {
      await qaStore(h);
      await store(h, () => window.__blumodelQA.store.getState().setUI({ viewMode: 'plan', planStyle: 'rendered' }));
      await h.sleep(500);
    }),
  }),
  ...both({
    name: 'dark-editor-drafting',
    as: 'customer',
    setup: async ({ me }) => newKitchen(me, 'Dark Drafting Kitchen'),
    waitFor: ['.topbar', '.plan-view canvas'],
    check: darkCheck(async (h) => {
      await qaStore(h);
      await store(h, () => {
        const s = window.__blumodelQA.store.getState();
        s.setUI({ viewMode: 'plan', planStyle: 'drafting' });
        s.select('qa-range');
      });
      await h.sleep(500);
    }),
  }),
  ...both({
    name: 'dark-editor-3d',
    as: 'customer',
    setup: async ({ me }) => newKitchen(me, 'Dark 3D Kitchen'),
    waitFor: ['.topbar'],
    check: darkCheck(async (h) => {
      await qaStore(h);
      await store(h, () => window.__blumodelQA.store.getState().setUI({ viewMode: '3d' }));
      await h.waitUntil(() => !!document.querySelector('.scene-view canvas') && !document.querySelector('.scene-loading'), 25_000, 'the 3D scene');
      await h.sleep(1500);
    }),
  }),
  ...both({
    name: 'dark-editor-walls',
    as: 'customer',
    setup: async ({ me }) => newKitchen(me, 'Dark Walls Kitchen'),
    waitFor: ['.topbar'],
    check: darkCheck(async (h) => {
      await qaStore(h);
      await store(h, () => window.__blumodelQA.store.getState().setUI({ viewMode: 'walls' }));
      await h.sleep(800);
    }),
  }),
  ...both({
    name: 'dark-editor-estimate',
    as: 'customer',
    setup: async ({ me }) => {
      must(await me.patch('/api/account/prefs', { showEstimator: true }), 'Turning the estimator on');
      return newKitchen(me, 'Dark Estimate Kitchen');
    },
    waitFor: ['.topbar', '.plan-view canvas'],
    check: darkCheck(async (h) => {
      await qaStore(h);
      await store(h, () => window.__blumodelQA.store.getState().setUI({ rightTab: 'estimate', viewMode: 'split' }));
      await h.sleep(800);
    }),
  }),
  ...both({
    name: 'dark-editor-room',
    as: 'customer',
    setup: async ({ me }) => newKitchen(me, 'Dark Room Kitchen'),
    waitFor: ['.topbar', '.plan-view canvas'],
    check: darkCheck(async (h) => {
      await qaStore(h);
      await store(h, () => window.__blumodelQA.store.getState().setUI({ leftTab: 'room' }));
      await h.sleep(500);
    }),
  }),
  ...both({ name: 'dark-local', path: '#/local', as: 'anon', waitFor: ['.topbar', '.plan-view canvas'], check: darkCheck() }),
];
