// Package E QA routes (BUILD_PLAN §9 E-T8 and acceptance, §13.3 E): the landing page (#/welcome
// and signed-out #/), the pricing page, the share dialog in the editor, and the shared kitchen
// (#/s/:token) for an anonymous visitor: prices on and off, a contractor's "Prepared by" share,
// duplicate, and the revoked / expired / unknown dead ends. Desktop, plus 375 px phones for the
// marketing pages and 390 px phones for the share pages.
//
// Run: node scripts/qa.mjs --pkg share --port 8816
//
// Every kitchen and link is made through the API in `setup`, so the routes need nothing from
// the seeds beyond the demo customer and the runner's QA contractor. Company details are
// fictional. A 404 from GET /api/share/:token on the dead-end routes is the expected answer
// (the runner lists it under apiErrors and does not fail on it).

/** Built-in products, laid out as the starter "Maple Street" kitchen (28 pieces). */
const ITEMS = [
  ['corner', 18, 18, 0, 2, 'warm-white'],
  ['trash-base', 45, 12, 0, 2, 'warm-white'],
  ['sink-farm', 72, 12, 0, 0, 'fireclay'],
  ['dishwasher', 102, 12, 0, 0, 'stainless'],
  ['base', 132, 12, 0, 2, 'warm-white', { widthIn: 36 }],
  ['base', 162, 12, 0, 2, 'warm-white'],
  ['pantry', 186, 12, 0, 2, 'warm-white'],
  ['window', 72, 0, 0, 0, 'white'],
  ['wall', 45, 6, 0, 2, 'warm-white', { widthIn: 18 }],
  ['wall', 102, 6, 0, 2, 'warm-white', { widthIn: 24 }],
  ['wall', 132, 6, 0, 2, 'warm-white', { widthIn: 36 }],
  ['wall', 162, 6, 0, 2, 'warm-white', { widthIn: 24 }],
  ['fridge-36', 15, 54, 270, 0, 'stainless'],
  ['base', 12, 85.5, 270, 2, 'warm-white', { widthIn: 27 }],
  ['range-30', 14, 114, 270, 0, 'stainless'],
  ['base', 12, 142.5, 270, 2, 'warm-white', { widthIn: 27 }],
  ['bridge', 12, 54, 270, 2, 'warm-white'],
  ['wall', 6, 85.5, 270, 2, 'warm-white', { widthIn: 27 }],
  ['hood-chimney', 10, 114, 270, 0, 'stainless'],
  ['wall', 6, 142.5, 270, 2, 'warm-white', { widthIn: 27 }],
  ['island', 118, 89, 0, 6, 'navy'],
  ['stool-backed', 90, 112, 180, 1, 'boucle'],
  ['stool-backed', 118, 112, 180, 1, 'boucle'],
  ['stool-backed', 146, 112, 180, 1, 'boucle'],
  ['pendant-dome', 90, 89, 0, 1, 'brass'],
  ['pendant-dome', 118, 89, 0, 1, 'brass'],
  ['pendant-dome', 146, 89, 0, 1, 'brass'],
  ['opening', 200, 126, 90, 0, 'white', { widthIn: 36 }],
];

/** A saved-kitchen doc (the wire shape POST /api/projects takes). */
export function shareDoc(name = 'Maple Street Kitchen') {
  return {
    version: 2,
    name,
    room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 },
    surfaces: { cabinetFinishId: 'warm-white', doorStyle: 'shaker', hardwareId: 'brass', countertopId: 'calacatta', backsplashId: 'zellige-white', flooringId: 'herringbone', paintId: 'chalk' },
    items: ITEMS.map(([productId, x, y, rotation, finishIndex, finishId, extra], i) => ({ id: `qa-share-${i + 1}`, productId, x, y, rotation, finishIndex, finishId, ...(extra ?? {}) })),
  };
}

const PHONE_375 = { w: 375, h: 812, mobile: true };
const COMPANY = { company: 'Birch & Bevel Kitchens', phone: '555-0142', email: 'hello@birchbevel.example', website: 'https://birchbevel.example' };

const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what} failed (${r.status}): ${r.body?.error ?? String(r.text ?? '').slice(0, 200)}`);
  return r.body;
};

/** As `who` (an api.as(role) handle): a kitchen with a client name, and one share link to it. */
async function kitchenWithLink(who, { name = 'Maple Street Kitchen', client = 'Pat Client', ...share } = {}) {
  const { project } = must(await who.post('/api/projects', { name, client, doc: shareDoc(name) }), 'Creating the kitchen');
  const link = must(await who.post(`/api/projects/${project.id}/shares`, share), 'Creating the share link').share;
  return { projectId: project.id, shareId: link.id, token: link.token, path: `#/s/${link.token}` };
}

/** No sideways scroll, and nothing in the page pokes out past the right edge. */
async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => {
    const vw = document.documentElement.clientWidth;
    // An element inside a clipping box that itself fits is fine (a cropped image, a scroller).
    const clipped = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (/(hidden|clip|auto|scroll)/.test(getComputedStyle(p).overflowX)) return p.getBoundingClientRect().right <= vw + 1;
      }
      return false;
    };
    const wide = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const b = el.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && b.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !clipped(el);
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} (right ${Math.round(el.getBoundingClientRect().right)}px)`);
    return { sw: document.documentElement.scrollWidth, vw, wide };
  });
  if (r.sw > r.vw + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.vw}px viewport`);
  if (r.wide.length) throw new Error(`content past the right edge of a ${r.vw}px viewport: ${r.wide.join(', ')}`);
}

/** The visible page text, lower-cased (CSS text-transform changes innerText). */
const pageText = (evaluate) => evaluate(() => document.body.innerText.replace(/\s+/g, ' ').toLowerCase());

/** Fails if any dollar amount is on screen (prices off must hide every price, estimate included). */
async function noPrices(evaluate, where) {
  const t = await evaluate(() => document.body.innerText);
  const m = t.match(/.{0,40}\$\s?\d[\d,.]*.{0,20}/);
  if (m) throw new Error(`${where} shows a price with prices off: "${m[0].replace(/\s+/g, ' ')}"`);
}

/** Clicks the share bar's button whose text includes `label`. */
async function shareBarButton({ evaluate, click }, label) {
  const ok = await evaluate((l) => {
    const b = [...document.querySelectorAll('.share-bar button')].find((x) => x.textContent.toLowerCase().includes(l.toLowerCase()));
    if (b) b.setAttribute('data-qa-share', l);
    return !!b;
  }, label);
  if (!ok) throw new Error(`no "${label}" button in the share bar`);
  await click(`[data-qa-share="${label}"]`);
}

/** Landing-page content every visitor must see. */
async function landingContent(h) {
  const t = await pageText(h.evaluate);
  // Gabe rejected "describe your kitchen": the photo is the way in.
  if (/describe your (dream )?kitchen/.test(t)) throw new Error('the landing page still offers "describe your kitchen"');
  for (const want of ['start from a photo of your kitchen', 'try without an account', 'how it works', 'check the space', 'share', 'contractor', 'brands', 'blumodel studio is a visualizer'])
    if (!t.includes(want)) throw new Error(`the landing page is missing "${want}"`);
  const links = await h.evaluate(() => ['#/generate', '#/local', '#/signup', '#/pricing'].filter((href) => !document.querySelector(`a[href="${href}"]`)));
  if (links.length) throw new Error(`no link to ${links.join(', ')}`);
  const hero = await h.evaluate(() => {
    const img = document.querySelector('.mk-hero-render');
    return img ? { src: img.getAttribute('src'), w: img.naturalWidth, done: img.complete } : null;
  });
  if (hero && hero.done && !hero.w) throw new Error(`the hero render ${hero.src} did not load`);
  await noSideScroll(h);
}

/** Scrolls a long page section by section on a phone, screenshotting each. */
async function phoneTour(h, sections) {
  for (const sel of sections) {
    const found = await h.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      el.scrollIntoView({ block: 'start' });
      return true;
    }, sel);
    if (!found) throw new Error(`no ${sel} on the page`);
    await h.sleep(250);
    await noSideScroll(h);
    await h.shot(sel.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, ''));
  }
}

/**
 * A finger tap: touchStart, 50 ms, touchEnd, so the browser makes the click a button needs. (The
 * runner's h.tap uses Input.synthesizeTapGesture, which under Edge's touch emulation never
 * delivers a click to a button; package move found the same, see docs/handoff/move.md.)
 */
async function fingerTap(h, selector) {
  const r = await h.rectOf(selector, { scroll: true });
  if (!(r.w > 0 && r.h > 0)) throw new Error(`tap: ${selector} has no size (hidden?)`);
  await h.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.cx, y: r.cy, id: 1 }] });
  await h.sleep(50);
  await h.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

/** Pixels of an element, for "nothing moved" comparisons. */
async function grab({ send, rectOf, sleep }, selector) {
  // Park the mouse outside the element first: hover outlines are not moves.
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await sleep(400);
  const r = await rectOf(selector);
  return (await send('Page.captureScreenshot', { format: 'png', clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } })).data;
}

export default [
  // ── Landing ──────────────────────────────────────────────────────────────
  {
    name: 'welcome',
    path: '#/welcome',
    as: 'anon',
    waitFor: ['.mk-hero', 'a[href="#/signin"]'],
    expectText: ['See your new kitchen before anyone picks up a hammer', 'Start from a photo of your kitchen'],
    waitMs: 300,
    fullPage: true,
    check: landingContent,
  },
  {
    name: 'home-signed-out',
    path: '#/',
    as: 'anon',
    waitFor: ['.mk-hero', 'a[href="#/signin"]'],
    expectText: ['Start from a photo of your kitchen', 'How it works'],
    check: landingContent,
  },
  {
    name: 'welcome-signed-in',
    path: '#/welcome',
    as: 'customer',
    waitFor: ['.mk-hero', '.mk-bar-actions a[href="#/"]'],
    expectText: ['My kitchens', 'Start from a photo of your kitchen'],
    check: async (h) => {
      if (await h.evaluate(() => !!document.querySelector('a.mk-signin'))) throw new Error('a signed-in visitor is offered "Sign in"');
    },
  },
  {
    name: 'welcome-phone',
    path: '#/welcome',
    as: 'anon',
    viewport: PHONE_375,
    waitFor: ['.mk-hero'],
    expectText: ['Start from a photo of your kitchen', 'Try without an account'],
    waitMs: 300,
    check: async (h) => {
      await landingContent(h);
      await phoneTour(h, ['#how', '#contractors', '#brands', '.mk-foot']);
      await h.evaluate(() => window.scrollTo(0, 0));
    },
  },

  // ── Pricing ──────────────────────────────────────────────────────────────
  {
    name: 'pricing',
    path: '#/pricing',
    as: 'anon',
    waitFor: ['.mk-plans', '.mk-tiers'],
    expectText: [
      'Design for free. Pay when you take it with you.',
      'Free',
      'Kitchen unlock',
      'Unlimited',
      'Contractor',
      '$5',
      '$15',
      '$40',
      'Show your customers the exact cabinets you sell, in their kitchen, at your price.',
      'Why are exports paid?',
      'What does the $5 unlock cover?',
      'Can I cancel?',
      'BluModel Studio is a visualizer',
    ],
    fullPage: true,
    check: async (h) => {
      const n = await h.evaluate(() => document.querySelectorAll('.mk-plans .mk-plan').length);
      if (n !== 4) throw new Error(`expected the 4 plans from src/data/plans.json, found ${n} plan cards`);
      const tiers = await h.evaluate(() => document.querySelectorAll('.mk-tiers .mk-tier').length);
      if (tiers < 1) throw new Error('no custom-model tiers (neither GET /api/orders/tiers nor the fallback)');
      const tierNote = await h.evaluate(() => document.querySelector('.mk-tiers-note')?.textContent ?? '');
      h.note(`tiers: ${tierNote}`);
      if (!/exact amount before you pay/.test(tierNote)) throw new Error(`the custom-model note lost its "exact amount" promise: ${tierNote}`);
      const ctas = await h.evaluate(() => [...document.querySelectorAll('.mk-plan-cta a')].map((a) => a.getAttribute('href')));
      if (ctas.some((href) => !href || !href.startsWith('#/'))) throw new Error(`a plan button goes nowhere: ${JSON.stringify(ctas)}`);
      // No card fields anywhere: payments are Stripe-hosted (or demo).
      if (await h.evaluate(() => !!document.querySelector('input[autocomplete^="cc-"], input[name*="card" i]'))) throw new Error('the pricing page has a card field');
      await noSideScroll(h);
    },
  },
  {
    name: 'pricing-phone',
    path: '#/pricing',
    as: 'anon',
    viewport: PHONE_375,
    waitFor: ['.mk-plans', '.mk-tiers'],
    expectText: ['Kitchen unlock', 'Why are exports paid?'],
    waitMs: 300,
    check: async (h) => {
      await noSideScroll(h);
      await phoneTour(h, ['.mk-plans', '#contractor', '#models', '#faq']);
      await h.evaluate(() => window.scrollTo(0, 0));
    },
  },
  {
    name: 'pricing-contractor',
    path: '#/pricing',
    as: 'contractor',
    waitFor: ['.mk-plans .mk-plan-badge'],
    expectText: ['Your plan', 'Open your workspace'],
  },

  // ── The share dialog in the editor ───────────────────────────────────────
  {
    name: 'share-dialog',
    as: 'customer',
    setup: async ({ me }) => {
      const k = await kitchenWithLink(me, { label: 'For Sam', showPrices: true, expiresInDays: 30 });
      must(await me.post(`/api/projects/${k.projectId}/shares`, { label: 'Walk-through, no prices', showPrices: false }), 'A second link');
      const old = must(await me.post(`/api/projects/${k.projectId}/shares`, { label: 'Turned off already' }), 'A third link').share;
      must(await me.delete(`/api/projects/${k.projectId}/shares/${old.id}`), 'Turning a link off');
      return { path: `#/k/${k.projectId}`, projectId: k.projectId };
    },
    waitFor: ['.share-btn'],
    waitMs: 800,
    check: async (h) => {
      await h.click('.share-btn');
      await h.waitFor('.share-dialog .share-link');
      await h.waitForText(['For Sam', 'Walk-through, no prices', 'prices hidden', 'expires in 30 days', '1 turned off or expired']);
      const active = await h.evaluate(() => [...document.querySelectorAll('.share-list > ul .share-link, .share-list .share-link')].filter((li) => !li.closest('.share-old')).map((li) => li.innerText));
      if (active.some((x) => x.includes('Turned off already'))) throw new Error('a turned-off link is listed as active');
      await h.shot('open');
      // Make a link from the dialog: a label, prices off, 7 days.
      await h.click('.share-new input:not([type="checkbox"])');
      await h.type('For the Okafors');
      await h.evaluate(() => {
        const box = document.querySelector('.share-new input[type="checkbox"]');
        if (box && box.checked) box.click();
        const sel = document.querySelector('.share-new select');
        if (sel) {
          const opt = [...sel.options].find((o) => /7/.test(o.textContent));
          const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
          set.call(sel, opt ? opt.value : '7');
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await h.evaluate(() => document.querySelector('.share-new button[type="submit"]').click());
      await h.waitForText('For the Okafors');
      await h.sleep(300);
      const r = must(await h.me.get(`/api/projects/${h.data.projectId}/shares`), 'Listing links');
      const made = r.shares.find((s) => s.label === 'For the Okafors');
      if (!made) throw new Error('the dialog did not create the link');
      if (made.showPrices !== false) throw new Error('the new link should have prices off');
      if (!(made.expiresAt > r.now + 6 * 86_400_000 && made.expiresAt <= r.now + 7 * 86_400_000)) throw new Error('the new link should expire in 7 days');
      if (!/^[A-Za-z0-9_-]{32}$/.test(made.token)) throw new Error(`token is not 32 base64url characters: ${made.token}`);
      const urls = await h.evaluate(() => [...document.querySelectorAll('.share-link-url')].map((i) => i.value));
      if (!urls.some((u) => u.endsWith(`/#/s/${made.token}`))) throw new Error('the dialog does not show the new link address');
    },
  },
  {
    name: 'share-dialog-phone',
    as: 'customer',
    viewport: 'phone',
    setup: async ({ me }) => {
      const k = await kitchenWithLink(me, { label: 'For Sam', showPrices: true, expiresInDays: 30 });
      return { path: `#/k/${k.projectId}` };
    },
    waitFor: ['.share-btn'],
    waitMs: 800,
    check: async (h) => {
      await fingerTap(h, '.share-btn');
      await h.waitFor('.share-dialog .share-link');
      await h.sleep(300);
      const r = await h.evaluate(() => {
        const b = document.querySelector('.share-dialog').getBoundingClientRect();
        return { left: b.left, right: b.right, vw: innerWidth, sw: document.documentElement.scrollWidth };
      });
      if (r.left < -0.5 || r.right > r.vw + 0.5) throw new Error(`the share dialog doesn't fit a ${r.vw}px phone (${Math.round(r.left)}–${Math.round(r.right)})`);
      if (r.sw > r.vw + 1) throw new Error('the page scrolls sideways with the share dialog open');
    },
  },

  // ── The shared kitchen, anonymously ──────────────────────────────────────
  {
    name: 'shared-kitchen',
    as: 'anon',
    setup: async ({ api }) => kitchenWithLink(api.as('customer'), { label: 'For Sam', showPrices: true }),
    waitFor: ['.share-bar', '.plan-view canvas'],
    expectText: ['Shared by', 'View only', 'BluModel Studio is a visualizer', 'Maple Street Kitchen'],
    waitMs: 1500,
    check: async (h) => {
      const t = await pageText(h.evaluate);
      if (t.includes('pat client')) throw new Error('the client name is on the shared page');
      if (t.includes('@')) throw new Error('an email address is on the shared page');
      if (!/\$\d/.test(await h.evaluate(() => document.body.innerText))) throw new Error('prices are on, but no estimate is shown');
      if (await h.evaluate(() => !!document.querySelector('.left-panel'))) throw new Error('the catalog panel is shown to a share viewer');
      // Dragging in the plan moves nothing (view mode), and nothing is saved.
      const before = await grab(h, '.plan-view');
      const r = await h.rectOf('.plan-view');
      await h.mouseDrag({ x: r.x + r.w * 0.5, y: r.y + r.h * 0.55 }, { x: r.x + r.w * 0.5 + 120, y: r.y + r.h * 0.55 + 64 });
      await h.sleep(1200);
      await h.key('Escape');
      await h.sleep(400);
      if ((await grab(h, '.plan-view')) !== before) throw new Error('the plan changed after a drag in a view-only share');
      // 3D.
      const tab = await h.evaluate(() => {
        const b = [...document.querySelectorAll('.views [role="tab"], .views button')].find((x) => x.textContent.trim() === '3D');
        if (b) b.setAttribute('data-qa-tab', '3D');
        return !!b;
      });
      if (!tab) throw new Error('no 3D view tab');
      await h.click('[data-qa-tab="3D"]');
      await h.waitFor('.scene-view canvas', 30_000);
      await h.sleep(4000);
      await h.shot('3d');
      const writes = h.page.events.responses.filter((x) => x.method && x.method !== 'GET' && /\/api\/projects/.test(x.url));
      if (writes.length) throw new Error(`a share viewer sent project writes: ${writes.map((w) => `${w.method} ${w.url}`).join(', ')}`);
      // The products in this kitchen.
      await shareBarButton(h, 'Products');
      await h.waitFor('.share-products');
      await h.waitForText(['In this kitchen', 'See it in 3D']);
      await h.shot('products');
    },
  },
  {
    name: 'shared-kitchen-no-prices',
    as: 'anon',
    setup: async ({ api }) => kitchenWithLink(api.as('customer'), { label: 'No prices', showPrices: false }),
    waitFor: ['.share-bar', '.plan-view canvas'],
    expectText: ['Shared by', 'View only'],
    waitMs: 1500,
    check: async (h) => {
      await noPrices(h.evaluate, 'the shared page');
      await shareBarButton(h, 'Products');
      await h.waitFor('.share-products');
      await h.waitForText('chose not to show prices');
      await noPrices(h.evaluate, 'the products list');
      await h.shot('products');
    },
  },
  {
    name: 'shared-kitchen-contractor',
    as: 'anon',
    setup: async ({ api }) => {
      const pro = api.as('contractor');
      must(await pro.put('/api/pro/profile', { ...COMPANY, defaultMarkupPct: 35 }), 'Saving the contractor profile');
      return kitchenWithLink(pro, { name: 'Okafor Kitchen', client: 'J. Okafor', label: 'For the Okafors', showPrices: true });
    },
    waitFor: ['.share-bar.share-bar--pro', '.plan-view canvas'],
    expectText: ['Prepared by', 'Birch & Bevel Kitchens', 'Okafor Kitchen'],
    waitMs: 1500,
    check: async (h) => {
      const t = await pageText(h.evaluate);
      if (t.includes('duplicate')) throw new Error('a contractor share offers Duplicate');
      if (t.includes('j. okafor')) throw new Error('the client name is on the shared page');
      if (/\bcost\b|\bmargin\b|\bmarkup\b/.test(t)) throw new Error('cost, margin or markup is on a contractor share');
      await shareBarButton(h, 'Contact');
      await h.waitFor('.share-contact');
      await h.waitForText(['555-0142', 'hello@birchbevel.example', 'birchbevel.example']);
      const hrefs = await h.evaluate(() => [...document.querySelectorAll('.share-contact a')].map((a) => a.getAttribute('href')));
      if (!hrefs.some((x) => x.startsWith('tel:')) || !hrefs.some((x) => x.startsWith('mailto:'))) throw new Error(`Contact needs tel: and mailto: links, got ${JSON.stringify(hrefs)}`);
      // The menu pops in (0.14 s); let it finish so the shot shows it opaque, and prove it sits on top.
      await h.sleep(400);
      const onTop = await h.evaluate(() => {
        const m = document.querySelector('.share-contact')?.getBoundingClientRect();
        if (!m) return 'no menu';
        const hit = document.elementFromPoint(m.left + m.width / 2, m.bottom - 12);
        return hit && hit.closest('.share-contact') ? true : `covered by ${hit?.className || hit?.tagName}`;
      });
      if (onTop !== true) throw new Error(`the Contact menu is under the editor: ${onTop}`);
      await h.shot('contact');
    },
  },
  {
    name: 'shared-kitchen-duplicate',
    as: 'fresh',
    setup: async ({ api }) => kitchenWithLink(api.as('customer'), { name: 'Maple Street Kitchen', label: 'For a friend' }),
    waitFor: ['.share-bar', '.plan-view canvas'],
    expectText: ['Duplicate to my kitchens'],
    waitMs: 800,
    check: async (h) => {
      await shareBarButton(h, 'Duplicate');
      await h.waitUntil(() => /^#\/k\//.test(location.hash), 15_000, 'opening the copy in the editor');
      await h.waitForText('Maple Street Kitchen (copy)');
      const mine = must(await h.me.get('/api/projects'), 'Listing my kitchens');
      const list = Array.isArray(mine) ? mine : mine.projects;
      if (!Array.isArray(list) || !list.some((p) => p.name === 'Maple Street Kitchen (copy)')) throw new Error('the copy is not in my kitchens');
    },
  },
  {
    // The signed-out path end to end: Duplicate sends a visitor to sign in (remembering the link),
    // they make an account there, and the copy finishes by itself when they come back.
    name: 'shared-kitchen-duplicate-signed-out',
    as: 'anon',
    setup: async ({ api }) => kitchenWithLink(api.as('customer'), { name: 'Elm Court Kitchen', label: 'For a neighbour' }),
    waitFor: ['.share-bar', '.plan-view canvas'],
    expectText: ['Sign in to duplicate'],
    waitMs: 800,
    check: async (h) => {
      // Let the 3D canvas finish starting before leaving the page: react-three-fiber's Canvas throws an
      // uncaught "reading 'addEventListener'" from its own onCreated when it is unmounted while it is
      // still being created (harmless to a visitor, but the runner fails on any uncaught error). The
      // same race used to hit after sign-up, when the shared page opened and the copy moved on 150 ms
      // later; SharedKitchen's ResumeDuplicate now makes that copy without opening the page.
      await h.waitUntil(() => (window.__blumodelQa?.frames ?? 0) > 0, 30_000, 'the 3D view drawing its first frame');
      await shareBarButton(h, 'Duplicate');
      await h.waitUntil(() => /^#\/signin\?next=/.test(location.hash), 10_000, 'being sent to sign in');
      const next = await h.evaluate(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('next'));
      if (!/^#\/s\//.test(next ?? '')) throw new Error(`sign-in does not remember the shared link: next=${next}`);
      // New here: the sign-up page keeps the same `next`.
      await h.click('.auth-switch a');
      await h.waitUntil(() => /^#\/signup\?next=/.test(location.hash), 10_000, 'the sign-up page keeping the shared link');
      const stamp = Date.now().toString(36);
      await h.click('.auth-form input[autocomplete="name"]');
      await h.type('Nina Neighbour');
      await h.click('.auth-form input[type="email"]');
      await h.type(`qa-neighbour-${stamp}@blumodel.test`);
      await h.click('.auth-form .pw input');
      await h.type('qa-neighbour-pass-1');
      await h.click('.auth-form button[type="submit"]');
      await h.waitUntil(() => /^#\/k\//.test(location.hash), 20_000, 'the copy opening in the editor after sign-up');
      await h.waitForText('Elm Court Kitchen (copy)');
      const list = await h.evaluate(async () => {
        const r = await fetch('/api/projects', { credentials: 'same-origin' });
        const b = await r.json();
        return (Array.isArray(b) ? b : b.projects).map((p) => p.name);
      });
      if (list.filter((n) => n === 'Elm Court Kitchen (copy)').length !== 1) throw new Error(`expected exactly one copy in my kitchens, saw ${JSON.stringify(list)}`);
      await h.shot('copied');
    },
  },
  {
    name: 'shared-kitchen-phone',
    as: 'anon',
    viewport: 'phone',
    setup: async ({ api }) => kitchenWithLink(api.as('customer'), { label: 'Phone', showPrices: true }),
    waitFor: ['.share-bar'],
    expectText: ['Shared by', 'Products', 'Duplicate'],
    waitMs: 2500,
    check: async (h) => {
      await noSideScroll(h);
      const bar = await h.evaluate(() => {
        const b = document.querySelector('.share-bar').getBoundingClientRect();
        return { top: b.top, h: b.height };
      });
      if (bar.top < -1 || bar.h > 160) throw new Error(`the share bar is ${Math.round(bar.h)}px tall at ${Math.round(bar.top)}px on a phone`);
    },
  },
  {
    name: 'shared-kitchen-contractor-phone',
    as: 'anon',
    viewport: 'phone',
    setup: async ({ api }) => {
      const pro = api.as('contractor');
      must(await pro.put('/api/pro/profile', { ...COMPANY, defaultMarkupPct: 35 }), 'Saving the contractor profile');
      return kitchenWithLink(pro, { name: 'Okafor Kitchen', client: 'J. Okafor', label: 'Phone', showPrices: true });
    },
    waitFor: ['.share-bar.share-bar--pro'],
    expectText: ['Prepared by', 'Contact'],
    waitMs: 2500,
    check: noSideScroll,
  },

  // ── Dead ends ────────────────────────────────────────────────────────────
  {
    name: 'shared-kitchen-revoked',
    as: 'anon',
    setup: async ({ api }) => {
      const me = api.as('customer');
      const k = await kitchenWithLink(me, { label: 'Soon off' });
      must(await me.delete(`/api/projects/${k.projectId}/shares/${k.shareId}`), 'Turning the link off');
      return k;
    },
    waitFor: ['.share-state'],
    expectText: ['This link is no longer available', 'Design your own kitchen'],
    check: async (h) => {
      if (await h.evaluate(() => !!document.querySelector('.plan-view, .scene-view'))) throw new Error('a revoked link still shows the kitchen');
    },
  },
  {
    name: 'shared-kitchen-expired',
    as: 'anon',
    setup: async ({ api }) => {
      const k = await kitchenWithLink(api.as('customer'), { label: 'A week', expiresInDays: 7 });
      api.sql('UPDATE share_links SET expires_at = ? WHERE id = ?', Date.now() - 60_000, k.shareId);
      return k;
    },
    waitFor: ['.share-state'],
    expectText: ['This link has expired'],
  },
  {
    name: 'shared-kitchen-expired-phone',
    as: 'anon',
    viewport: 'phone',
    setup: async ({ api }) => {
      const k = await kitchenWithLink(api.as('customer'), { label: 'A week', expiresInDays: 7 });
      api.sql('UPDATE share_links SET expires_at = ? WHERE id = ?', Date.now() - 60_000, k.shareId);
      return k;
    },
    waitFor: ['.share-state'],
    expectText: ['This link has expired'],
    check: noSideScroll,
  },
  {
    name: 'shared-kitchen-unknown',
    path: '#/s/not-a-real-token',
    as: 'anon',
    waitFor: ['.share-state'],
    expectText: ['We couldn’t find this kitchen'],
  },
];
