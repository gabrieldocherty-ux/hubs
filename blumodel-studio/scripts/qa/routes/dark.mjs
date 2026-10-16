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

const editor = (name, extra, opts) => ({
  name,
  as: 'customer',
  setup: async ({ me }) => newKitchen(me, `Kitchen ${name}`),
  waitFor: ['.topbar'],
  check: darkCheck(extra, opts),
});

const crashNoise = [/deliberate crash/i, /The above error occurred/i, /React will try to recreate/i, /Consider adding an error boundary/i];

export default [
  // ── Public pages ──────────────────────────────────────────────────────────
  ...both({ name: 'dark-landing', path: '#/welcome', as: 'anon', fullPage: true, check: darkCheck(null, { focus: true }) }),
  ...both({ name: 'dark-pricing', path: '#/pricing', as: 'anon', fullPage: true, check: darkCheck() }),
  ...both({ name: 'dark-terms', path: '#/terms', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-privacy', path: '#/privacy', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-signin', path: '#/signin', as: 'anon', waitFor: ['input[type="password"]'], check: darkCheck(null, { focus: 'input' }) }),
  ...both({ name: 'dark-signup', path: '#/signup', as: 'anon', waitFor: ['input[type="password"]'], check: darkCheck() }),
  ...both({ name: 'dark-forgot', path: '#/signin?forgot=1', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-not-found', path: '#/no-such-page', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-error', path: '#/pricing?qa-crash=route', as: 'anon', ignoreConsole: crashNoise, check: darkCheck() }),
  ...both({ name: 'dark-contractors', path: '#/contractors', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-brand-page', path: '#/b/blumodel-sample-co-demo', as: 'anon', check: darkCheck() }),
  ...both({ name: 'dark-product', as: 'anon', setup: ({ api }) => demoProductPath(api), check: darkCheck() }),
  ...both({ name: 'dark-share', as: 'anon', setup: ({ api }) => sharedKitchen(api), waitFor: ['.share-bar'], check: darkCheck() }),
  ...both({ name: 'dark-local', path: '#/local', as: 'anon', waitFor: ['.topbar', '.plan-view canvas'], check: darkCheck() }),

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
  ...both({
    name: 'dark-wizard-brands',
    path: '#/new',
    as: 'customer',
    check: darkCheck(async (h) => {
      // Basics → Room → Layout → Brands, by the Continue button.
      for (let i = 0; i < 3; i++) {
        await h.evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => /^(Continue|Next)/.test(x.textContent.trim()) && !x.disabled);
          if (!b) throw new Error('no Continue button');
          b.click();
        });
        await h.sleep(500);
      }
    }),
  }),
  ...both({ name: 'dark-account', path: '#/account', as: 'customer', fullPage: true, check: darkCheck(null, { focus: 'input' }) }),
  ...both({ name: 'dark-billing', path: '#/account/billing', as: 'customer', fullPage: true, check: darkCheck() }),
  ...both({ name: 'dark-generate', path: '#/generate', as: 'customer', check: darkCheck() }),
  ...both({ name: 'dark-orders', as: 'contractor', setup: ({ api }) => contractorAt(api, '#/orders'), check: darkCheck() }),
  ...both({ name: 'dark-orders-new', as: 'contractor', setup: ({ api }) => contractorAt(api, '#/orders/new'), check: darkCheck() }),
  ...both({ name: 'dark-pro', as: 'contractor', setup: ({ api }) => contractorAt(api, '#/pro'), check: darkCheck() }),
  ...['catalog', 'price-book', 'quotes', 'modelling', 'brand', 'company'].map((tab) => ({
    name: `dark-pro-${tab}`,
    as: 'contractor',
    colorScheme: 'dark',
    setup: ({ api }) => contractorAt(api, `#/pro/${tab}`),
    check: darkCheck(),
  })),
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
  ...['moderation', 'brands', 'retailers', 'studio', 'revenue', 'billing', 'users'].map((tab) => ({ name: `dark-admin-${tab}`, path: `#/admin/${tab}`, as: 'admin', colorScheme: 'dark', check: darkCheck() })),
  { name: 'dark-admin-users-phone', path: '#/admin/users', as: 'admin', colorScheme: 'dark', viewport: 'phone', check: darkCheck() },

  // ── The editor: panels, sheets, toolbar, catalog, inspector, estimate, dialogs, toasts ──
  ...both(editor('dark-editor-plan', ui({ viewMode: 'plan', planStyle: 'rendered' }), { focus: '.topbar button' })),
  ...both(
    editor('dark-editor-drafting', async (h) => {
      await ui({ viewMode: 'plan', planStyle: 'drafting' })(h);
      await store(h, () => window.__blumodelQA.store.getState().select('qa-range'));
      await h.sleep(500);
    })
  ),
  ...both(
    editor('dark-editor-3d', async (h) => {
      await ui({ viewMode: '3d' })(h);
      await h.waitUntil(() => !!document.querySelector('.scene-view canvas') && !document.querySelector('.scene-loading'), 25_000, 'the 3D scene');
      await h.sleep(1500);
    })
  ),
  ...both(editor('dark-editor-walls', ui({ viewMode: 'walls' }))),
  ...both(editor('dark-editor-room', ui({ leftTab: 'room', viewMode: 'split' }))),
  ...both(editor('dark-editor-checks', ui({ rightTab: 'checks' }))),
  ...both({
    name: 'dark-editor-estimate',
    as: 'customer',
    setup: async ({ me }) => {
      must(await me.patch('/api/account/prefs', { showEstimator: true }), 'Turning the estimator on');
      return newKitchen(me, 'Dark Estimate Kitchen');
    },
    waitFor: ['.topbar', '.plan-view canvas'],
    check: darkCheck(ui({ rightTab: 'estimate', viewMode: 'split' })),
  }),
  ...both(
    editor('dark-editor-toast', async (h) => {
      await qaStore(h);
      await store(h, () => {
        const s = window.__blumodelQA.store.getState();
        s.toast('Plan saved as PNG.', 'ok');
        s.toast('Two pieces overlap.', 'warn');
      });
      await h.waitFor('.toast');
      await h.sleep(300);
    })
  ),
  {
    name: 'dark-editor-phone-catalog',
    as: 'customer',
    viewport: 'phone',
    colorScheme: 'dark',
    setup: async ({ me }) => newKitchen(me, 'Dark Sheet Kitchen'),
    waitFor: ['.mbar'],
    check: darkCheck(async (h) => {
      await h.evaluate(() => document.querySelector(".mbar-actions button[aria-label='Add products']")?.click());
      await h.waitFor('.sheet.is-open');
      await h.sleep(500);
    }),
  },
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
  { name: 'light-landing-phone', path: '#/welcome', as: 'anon', colorScheme: 'light', viewport: 'phone', fullPage: true, check: lightCheck() },
  { name: 'light-pricing', path: '#/pricing', as: 'anon', colorScheme: 'light', fullPage: true, check: lightCheck() },
  { name: 'light-signin', path: '#/signin', as: 'anon', colorScheme: 'light', waitFor: ['input[type="password"]'], check: lightCheck(null, { focus: 'input' }) },
  { name: 'light-account', path: '#/account', as: 'customer', colorScheme: 'light', fullPage: true, check: lightCheck() },
  { name: 'light-billing', path: '#/account/billing', as: 'customer', colorScheme: 'light', check: lightCheck() },
  { name: 'light-admin', path: '#/admin/overview', as: 'admin', colorScheme: 'light', check: lightCheck() },
  { name: 'light-pro', as: 'contractor', colorScheme: 'light', setup: ({ api }) => contractorAt(api, '#/pro'), check: lightCheck() },
  { name: 'light-product', as: 'anon', colorScheme: 'light', setup: ({ api }) => demoProductPath(api), check: lightCheck() },
  { name: 'light-share', as: 'anon', colorScheme: 'light', setup: ({ api }) => sharedKitchen(api), waitFor: ['.share-bar'], check: lightCheck() },
  { ...editor('light-editor-plan'), colorScheme: 'light', waitFor: ['.topbar', '.plan-view canvas'], check: lightCheck(ui({ viewMode: 'plan', planStyle: 'rendered' })) },
  { ...editor('light-editor-drafting'), colorScheme: 'light', waitFor: ['.topbar', '.plan-view canvas'], check: lightCheck(ui({ viewMode: 'plan', planStyle: 'drafting' })) },
  { ...editor('light-editor-walls'), colorScheme: 'light', check: lightCheck(ui({ viewMode: 'walls' })) },
  { ...editor('light-editor-phone'), colorScheme: 'light', viewport: 'phone', waitFor: ['.mbar'], check: lightCheck() },
];
