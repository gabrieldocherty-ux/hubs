// Showroom QA routes (docs/SHOWROOM_PIVOT.md §5): what homeowners see on a company's showroom, the
// seeded demo at http://demo.localhost:<port> ("Northline Kitchen & Bath (Demo)"), at 1440 and
// 390, light and dark: the branded landing, sign-up, the wizard with the company's lines, the
// editor with the company's catalog only (no store links, no prices or plans of ours), the free
// branded downloads, "Send this design to Northline" from the editor and the share page, and a
// whole visitor journey (signed out from the landing to a device design, then an account to send it) ending in a lead in the company's inbox.
// The landing page with its pictures (the hero first and the right one for the screen, every line
// card and gallery kitchen with its picture, lazy below the fold, sizes reserved, nothing shifting),
// the demo-only pitch (never on another showroom), the picture generator and the workspace's pictures.
// Run: node scripts/qa.mjs --pkg showroom --port 8910

/** No horizontal page scroll. */
async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

/** Nothing of ours to buy, and no stores, on a showroom page: its visible text and links. */
async function noUpsell({ evaluate }) {
  const r = await evaluate(() => {
    const text = document.body.innerText;
    const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
    return { text, hrefs };
  });
  const words = [/\bpricing\b/i, /\bunlimited plan\b/i, /\bcontractor plan\b/i, /\bupgrade\b/i, /\bunlock\b/i, /start from a photo/i, /need a contractor/i, /\bwhere to buy\b/i, /\bhome depot\b/i, /\brona\b/i, /\bikea\b/i, /\$5\b/];
  const hit = words.find((w) => w.test(r.text));
  if (hit) throw new Error(`the showroom page shows "${r.text.match(hit)?.[0]}"`);
  const bad = r.hrefs.filter((h) => /^#\/(pricing|generate|contractors|b\/|brand|orders|pro|account\/billing|local)\b/.test(h ?? ''));
  if (bad.length) throw new Error(`links to pages a showroom doesn't have: ${bad.join(', ')}`);
}

/** Every visible link and button at least 44px tall on a touch screen. */
async function touchTargets({ evaluate, viewport }) {
  if (!isPhone({ viewport })) return;
  const small = await evaluate(() =>
    [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[aria-hidden="true"]');
      })
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => r.height < 43.5 && !(el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')))
      // WCAG 2.5.8 exempts a link inside a sentence ("By creating an account you agree to the Terms").
      .filter(({ el }) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline' && (el.parentElement?.textContent ?? '').trim().length > (el.textContent ?? '').trim().length + 12))
      .map(({ el, r }) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(' ')[0]}` : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${Math.round(r.height)}px`),
  );
  if (small.length) throw new Error(`touch targets under 44px: ${small.slice(0, 8).join('; ')}`);
}

const views = [
  // Light said outright: without it Edge follows the machine's setting.
  { suffix: '', viewport: 'desktop', colorScheme: 'light' },
  { suffix: '-dark', viewport: 'desktop', colorScheme: 'dark' },
  { suffix: '-phone', viewport: 'phone', colorScheme: 'light' },
  { suffix: '-phone-dark', viewport: 'phone', colorScheme: 'dark' },
];
const each = (r) =>
  views.map((v) => ({ ...r, name: `${r.name}${v.suffix}`, viewport: v.viewport, ...(v.colorScheme ? { colorScheme: v.colorScheme } : {}) }));

export default [
  // ── the landing page ─────────────────────────────────────────────────────
  // Desktop: the whole page in one picture. Phone: a picture per section (a 390 px page at 3x is
  // taller than a screenshot can be), then the top again for the route's own picture.
  ...views.map((v) => ({
    name: `landing${v.suffix}`,
    host: 'demo',
    path: '#/',
    as: 'anon',
    viewport: v.viewport,
    colorScheme: v.colorScheme,
    fullPage: v.viewport === 'desktop',
    timeoutMs: 40000,
    waitFor: ['.sr-hero h1', '.sr-hero-pic img', '.sr-line img'],
    expectText: ['Design your kitchen', 'Design your bathroom', 'Lakeshore Shaker', 'Harbourfront Slab', 'Kitchens designed in our showroom', 'Talk to Northline'],
    check: async (h) => {
      const t = await h.evaluate(() => ({ title: document.title, brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(), desc: document.querySelector('meta[name="description"]')?.getAttribute('content') }));
      if (!/^Northline Kitchen & Bath/.test(t.title)) throw new Error(`the tab title is "${t.title}"`);
      if (!t.brand) throw new Error('the company colour tokens are not applied');
      if (!/Northline/.test(t.desc ?? '')) throw new Error(`the description is "${t.desc}"`);
      await heroChecks(h);
      await settleImages(h);
      await imageChecks(h);
      await noShift(h);
      await noSideScroll(h);
      await noUpsell(h);
      await touchTargets(h);
      await pitchChecks(h);
      if (isPhone(h)) {
        for (const [sel, name] of [['.sr-hero', 'hero'], ['#sr-lines', 'lines'], ['.sr-line:nth-child(2)', 'line-card'], ['.sr-pitch', 'pitch'], ['.sr-lead', 'lead'], ['#sr-gallery', 'gallery'], ['.sr-steps', 'steps'], ['#sr-contact', 'contact']]) {
          await h.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start' }), sel);
          await h.sleep(250);
          await h.shot(name);
        }
        await h.evaluate(() => window.scrollTo(0, 0));
        await h.sleep(200);
      }
    },
  })),
  // The link preview is the hero; the document preloads nothing (every route shares it).
  {
    name: 'landing-document',
    host: 'demo',
    path: '#/',
    as: 'anon',
    waitFor: ['.sr-hero h1'],
    check: async (h) => {
      const r = await h.evaluate(async () => {
        const html = await (await fetch('/', { headers: { Accept: 'text/html' } })).text();
        return {
          preload: [...html.matchAll(/<link rel="preload" as="image" href="([^"]+)"/g)].map((m) => m[1]),
          og: html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null,
          card: html.match(/<meta name="twitter:card" content="([^"]+)"/)?.[1] ?? null,
          hero: document.querySelector('.sr-hero-pic img')?.getAttribute('src'),
          tall: document.querySelector('.sr-hero-pic source')?.getAttribute('srcset'),
        };
      });
      if (r.preload.length) throw new Error(`the document preloads ${r.preload.join(', ')} for every route`);
      if (!r.og?.endsWith(r.hero)) throw new Error(`the link preview picture is ${r.og}`);
      if (r.card !== 'summary_large_image') throw new Error(`twitter:card is ${r.card}`);
    },
  },
  // Admin > Companies opens the generator with a ticket; it lists every scene and nothing is made until asked.
  ...[views[0], views[3]].map((v) => ({
    name: `images-generator${v.suffix}`,
    host: 'demo',
    as: 'showroom-owner',
    path: '#/showroom-images',
    viewport: v.viewport,
    colorScheme: v.colorScheme,
    waitFor: ['.sri-list li', '.sri-actions .btn'],
    expectText: ['Showroom pictures for Northline Kitchen & Bath', 'The main picture', 'Lakeshore Shaker', 'Bayview Bath'],
    check: async (h) => {
      const r = await h.evaluate(() => ({ rows: document.querySelectorAll('.sri-list li').length, skipped: [...document.querySelectorAll('.sri-list li[data-state="skipped"]')].map((li) => li.textContent), btn: document.querySelector('.sri-actions .btn')?.textContent }));
      if (r.rows < 10) throw new Error(`only ${r.rows} scenes`);
      if (r.skipped.length) throw new Error(`scenes with layout problems: ${r.skipped.join('; ')}`);
      if (!/^Make \d+ pictures$/.test(r.btn ?? '')) throw new Error(`the button says "${r.btn}"`);
      await noSideScroll(h);
      await touchTargets(h);
    },
  })),
  {
    name: 'images-generator-visitor',
    host: 'demo',
    as: 'showroom-visitor',
    path: '#/showroom-images',
    waitFor: ['.sri-msg--bad'],
    expectText: ['Only the showroom’s team can change its pictures'],
    ignoreConsole: [/403/],
  },
  // The workspace's Showroom tab: where each picture came from, and the team's own photos.
  ...[views[0], views[3]].map((v) => ({
    name: `workspace-pictures${v.suffix}`,
    host: 'demo',
    as: 'showroom-owner',
    path: '#/studio',
    viewport: v.viewport,
    colorScheme: v.colorScheme,
    waitFor: ['.ws-pics .ws-pic img'],
    expectText: ['Showroom pictures', 'Generate showroom images', 'Main picture', 'Made from your products'],
    check: async (h) => {
      await h.evaluate(() => document.querySelector('.ws-pics')?.scrollIntoView({ block: 'start' }));
      await h.sleep(300);
      await h.shot('pictures');
      await noSideScroll(h);
    },
  })),
  // A showroom that isn't the demo: no demo band, no pitch; without pictures, no picture hero.
  ...[views[0], views[3]].map((v) => ({
    name: `plain-showroom${v.suffix}`,
    host: 'qa-plain',
    as: 'anon',
    path: '#/',
    viewport: v.viewport,
    colorScheme: v.colorScheme,
    setup: async ({ api }) => plainCompany(api),
    waitFor: ['.sr-hero h1'],
    expectText: ['Plainfield Cabinets'],
    check: async (h) => {
      const r = await h.evaluate(() => ({ band: !!document.querySelector('.sr-demo-band'), pitch: !!document.querySelector('.sr-pitch, [data-demo-only]'), text: document.body.innerText, pic: !!document.querySelector('.sr-hero-pic') }));
      if (r.band || r.pitch) throw new Error('a real showroom shows the demo-only band or pitch');
      if (/What .* gets from this showroom|Get a showroom like this/i.test(r.text)) throw new Error('a real showroom shows the demo pitch');
      if (r.pic) throw new Error('a hero picture without any pictures');
      await noSideScroll(h);
      await touchTargets(h);
    },
  })),

  // ── signing up on the showroom, and a visitor's designs ─────────────────
  ...each({
    name: 'signup',
    host: 'demo',
    path: '#/signup?next=%23%2Fnew',
    as: 'anon',
    waitFor: ['.auth-form input[type="email"]', '.auth-brand .site-logo'],
    expectText: ['Design your room with Northline Kitchen & Bath', 'Create your account'],
    check: async (h) => {
      const local = await h.evaluate(() => !!document.querySelector('a[href="#/local"]'));
      if (local) throw new Error('the showroom offers device-only designs, which never reach the company');
      await noSideScroll(h);
      await noUpsell(h);
      await touchTargets(h);
    },
  }),
  ...each({
    name: 'visitor-home',
    host: 'demo',
    path: '#/',
    as: 'showroom-visitor',
    waitFor: ['.project-card .project-name', '.home-bar .site-logo'],
    expectText: ['2 designs saved', 'Riley’s sage shaker kitchen', 'New bathroom', 'New kitchen'],
    check: async (h) => {
      await noSideScroll(h);
      await noUpsell(h);
    },
  }),

  // ── the wizard: the company's lines, a bathroom ─────────────────────────
  ...each({
    name: 'wizard-lines',
    host: 'demo',
    path: '#/new?line=Lakeshore%20Shaker',
    as: 'showroom-visitor',
    waitFor: ['.wizard .steps', '.home-bar .site-logo'],
    expectText: ['Let’s design your kitchen.', 'Our lines'],
    check: async (h) => {
      for (let i = 0; i < 3; i++) await clickText(h, '.wizard .btn.primary', 'Continue');
      await h.waitForText(['Choose from our lines.', 'All our lines', 'Lakeshore Shaker', 'Create kitchen']);
      const r = await h.evaluate(() => ({
        on: [...document.querySelectorAll('.wiz-brand[aria-pressed="true"] b')].map((b) => b.textContent),
        share: document.querySelector('[data-testid="wiz-brand-share"]')?.textContent ?? '',
      }));
      if (!r.on.includes('Lakeshore Shaker')) throw new Error(`?line= didn't choose Lakeshore Shaker: ${JSON.stringify(r.on)}`);
      if (!/Lakeshore Shaker/.test(r.share)) throw new Error(`the summary says "${r.share}"`);
      await noSideScroll(h);
      await noUpsell(h);
      await touchTargets(h);
    },
  }),
  ...each({
    name: 'wizard-bathroom',
    host: 'demo',
    path: '#/new?room=bathroom',
    as: 'showroom-visitor',
    waitFor: ['.wizard .steps'],
    expectText: ['Let’s design your bathroom.', 'Bathroom name'],
    check: async (h) => {
      const steps = await h.evaluate(() => [...document.querySelectorAll('.wizard .steps li')].map((l) => l.textContent.trim()));
      if (steps.length !== 3) throw new Error(`a bathroom has ${steps.length} steps (no layout step expected): ${steps.join(' / ')}`);
      await noSideScroll(h);
      await noUpsell(h);
    },
  }),

  // ── the editor: the company's catalog only, free downloads, Send ───────
  ...each({
    name: 'editor',
    host: 'demo',
    as: 'showroom-visitor',
    setup: async ({ api }) => ({ path: `#/k/${api.sql(VISITOR_PROJECT)[0].id}` }),
    waitFor: ['.topbar .site-logo', '.plan-view canvas'],
    check: async (h) => {
      const r = await h.evaluate(() => ({
        store: !!document.querySelector('#catalog-store, .store-chip, .price--store'),
        lines: [...new Set([...document.querySelectorAll('.catalog-grid .product-card .product-meta > span:first-child')].map((s) => s.textContent))],
        send: !!document.querySelector('[data-testid="send-design"]'),
      }));
      if (r.store) throw new Error('the catalog shows stores on the showroom');
      if (!isPhone(h)) {
        if (!r.lines.length) throw new Error('the catalog panel shows no products');
        h.note(`catalog lines: ${r.lines.join(', ')}`);
        if (!r.send) throw new Error('no "Send this design to Northline" at the foot of the Overview');
      }
      await noUpsell(h);
      await noSideScroll(h);
    },
  }),
  {
    name: 'editor-export-menu',
    host: 'demo',
    as: 'showroom-visitor',
    setup: async ({ api }) => ({ path: `#/k/${api.sql(VISITOR_PROJECT)[0].id}` }),
    waitFor: ['.topbar .site-logo', '.plan-view canvas'],
    check: async (h) => {
      await h.click('.topbar .menu-wrap > .btn.primary');
      await h.waitFor('.topbar .menu[role="menu"]');
      await h.waitForText(['Floor plan', '3D render', 'Product list', 'Printable, with Northline Kitchen & Bath’s details']);
      const t = await h.evaluate(() => document.querySelector('.topbar .menu').innerText);
      if (/paid|unlock|\$5/i.test(t)) throw new Error(`the Export menu says: ${t}`);
      await h.shot('menu');
    },
  },
  {
    name: 'downloads-branded',
    host: 'demo',
    as: 'showroom-visitor',
    setup: async ({ api }) => ({ path: `#/k/${api.sql(VISITOR_PROJECT)[0].id}` }),
    waitFor: ['.topbar .site-logo', '.plan-view canvas'],
    timeoutMs: 40_000,
    check: async (h) => {
      await catchDownloads(h);
      await exportItem(h, 'Floor plan');
      await h.waitForText('Floor plan saved as PNG.');
      await brandedPlan(h);
      // After a download: the offer to send it, under the toast.
      await h.waitFor('[data-testid="send-after-download"]');
      await h.shot('after-download');
      await exportItem(h, 'Product list');
      await h.waitForText('Product list saved.');
      await h.waitUntil(() => (window.__qaDownloads ?? []).some((d) => /product-list\.html$/.test(d.name) && d.text), 10_000, 'the product list');
      const html = await h.evaluate(() => window.__qaDownloads.find((d) => /product-list\.html$/.test(d.name)).text);
      for (const want of ['Northline Kitchen &amp; Bath', '555-', 'Designed on demo.localhost']) if (!html.includes(want)) throw new Error(`the product list lacks "${want}"`);
      if (/home depot|\brona\b|buy from|where to buy/i.test(html)) throw new Error('the product list names a store');
      // The server recorded both downloads as free exports of the visitor's own kitchen.
      const n = h.api.sql("SELECT COUNT(*) AS n FROM export_events e JOIN projects p ON p.id = e.project_id WHERE p.tenant_id = 't_demo' AND e.kind IN ('plan_png', 'quote')")[0].n;
      if (n < 2) throw new Error(`the server recorded ${n} of the 2 downloads`);
    },
  },
  {
    name: 'send-from-editor',
    host: 'demo',
    as: 'showroom-visitor',
    setup: async ({ api }) => ({ path: `#/k/${api.sql(VISITOR_PROJECT)[0].id}` }),
    waitFor: ['[data-testid="send-design"]', '.plan-view canvas'],
    expectText: ['Happy with your design?'],
    timeoutMs: 40_000,
    check: async (h) => {
      await clickText(h, '[data-testid="send-design"] .btn', 'Send this design to Northline');
      await h.shot('dialog');
      await sendForm(h, {});
      await h.shot('sent');
      leadFor(h, 'demo-visitor@blumodel.test', { signedIn: true });
      await clickText(h, '.sr-send-done .btn', 'Done');
      await h.waitForText(['Sent to Northline', 'Send an update']);
    },
  },

  // ── the share page: branded, and anyone can send it to the company ──────
  ...each({
    name: 'share-page',
    host: 'demo',
    as: 'anon',
    setup: async ({ api }) => ({ path: `#/s/${api.sql(DEMO_SHARE)[0].token}` }),
    waitFor: ['.share-bar .site-logo', '[data-testid="send-design"]', '.plan-view canvas'],
    check: async (h) => {
      await noSideScroll(h);
      await noUpsell(h);
      await touchTargets(h);
    },
  }),
  {
    name: 'share-send-phone',
    host: 'demo',
    as: 'anon',
    viewport: 'phone',
    setup: async ({ api }) => ({ path: `#/s/${api.sql(DEMO_SHARE)[0].token}` }),
    waitFor: ['[data-testid="send-design"]', '.plan-view canvas'],
    timeoutMs: 40_000,
    check: async (h) => {
      await h.tap('[data-testid="send-design"]');
      await sendForm(h, { name: 'Jordan Okafor', email: 'jordan.share@example.test' });
      await h.shot('sent');
      leadFor(h, 'jordan.share@example.test', { signedIn: false });
      await touchTargets(h);
    },
  },
  {
    name: 'team-sees-no-send',
    host: 'demo',
    as: 'showroom-staff',
    setup: async ({ api }) => ({ path: `#/s/${api.sql(DEMO_SHARE)[0].token}` }),
    waitFor: ['.share-bar', '.plan-view canvas'],
    check: async (h) => {
      await h.sleep(500);
      if (await h.evaluate(() => !!document.querySelector('[data-testid="send-design"]'))) throw new Error('the company’s own staff are offered to send a lead to themselves');
    },
  },

  // ── the whole visitor journey: landing to a lead in the inbox ───────────
  ...[
    { suffix: '', viewport: 'desktop', colorScheme: 'light' },
    { suffix: '-phone-dark', viewport: 'phone', colorScheme: 'dark' },
  ].map((v) => ({
    name: `journey${v.suffix}`,
    host: 'demo',
    path: '#/',
    as: 'anon',
    viewport: v.viewport,
    colorScheme: v.colorScheme,
    waitFor: ['.sr-hero h1'],
    timeoutMs: 45_000,
    check: async (h) => {
      const email = `qa-journey-${v.viewport}-${Date.now()}@example.test`;
      // Signed out, straight to the wizard (SHOWROOM_PIVOT §5): the design starts on this device.
      await clickText(h, 'a', 'Design your kitchen');
      await h.waitForText('Let’s design your kitchen.', 20_000);
      await fill(h, '.wizard input', 'Casey’s kitchen (QA)');
      for (let i = 0; i < 3; i++) await clickText(h, '.wizard .btn.primary', 'Continue');
      await h.waitForText('Choose from our lines.');
      await h.shot('wizard');
      await clickText(h, '.wizard .btn.primary', 'Create kitchen');
      await h.waitUntil(() => location.hash === '#/local', 20_000, 'the device design opening');
      await h.waitFor('.plan-view canvas');
      await h.shot('device-design');
      // Sending needs an account: the card signs up, and the design comes along.
      // On a phone the card is in Details.
      if (isPhone(h)) {
        await clickText(h, 'button', 'Details');
        await h.waitFor('[data-testid="send-design"] a[href^="#/signup"]', 8000);
        await h.shot('device-send-card');
      }
      const claim = await h.evaluate(() => document.querySelector('[data-testid="send-design"] a[href^="#/signup"]')?.getAttribute('href'));
      if (!claim) throw new Error('the device design offers no way to send it to the company');
      await h.goto(claim);
      await h.waitFor('.auth-form input[type="email"]');
      await fill(h, '.auth-form input[autocomplete="name"]', 'Casey Journey');
      await fill(h, '.auth-form input[type="email"]', email);
      await fill(h, '.auth-form input[autocomplete="new-password"]', `qa-${Math.random().toString(36).slice(2)}-pw`);
      await clickText(h, '.auth-form button[type="submit"]', 'Create account');
      await h.waitUntil(() => /^#\/k\//.test(location.hash), 20_000, 'the new design opening');
      await h.waitFor('.plan-view canvas');
      const made = h.api.sql("SELECT p.id FROM projects p JOIN users u ON u.id = p.user_id WHERE u.email = ? AND p.tenant_id = 't_demo'", email)[0];
      if (!made) throw new Error('the design was not saved on the showroom');
      await catchDownloads(h);
      await h.sleep(1200);
      await exportItem(h, 'Floor plan');
      await brandedPlan(h);
      await h.waitFor('[data-testid="send-after-download"]');
      await h.shot('after-download');
      await clickText(h, '[data-testid="send-after-download"] .btn', 'Send this design to Northline');
      await sendForm(h, {});
      await h.shot('sent');
      const lead = leadFor(h, email, { signedIn: true });
      if (lead.design_name !== 'Casey’s kitchen (QA)') throw new Error(`the lead's design is "${lead.design_name}"`);
      await noSideScroll(h);
    },
  })),
];

// ── helpers for the journey ───────────────────────────────────────────────

const VISITOR_PROJECT = "SELECT p.id, p.name FROM projects p JOIN users u ON u.id = p.user_id WHERE u.email = 'demo-visitor@blumodel.test' ORDER BY p.name LIMIT 1";
const DEMO_SHARE = "SELECT s.token FROM share_links s JOIN projects p ON p.id = s.project_id WHERE p.tenant_id = 't_demo' AND s.revoked_at IS NULL ORDER BY s.created_at LIMIT 1";

/** Clicks (or taps, on a phone) the first visible `selector` whose text contains `text`. */
async function clickText(h, selector, text) {
  const ok = await h.evaluate(
    (sel, t) => {
      document.querySelectorAll('[data-qa-hit]').forEach((e) => e.removeAttribute('data-qa-hit'));
      const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(t) && e.getBoundingClientRect().width > 0);
      if (!el) return false;
      el.setAttribute('data-qa-hit', '1');
      return true;
    },
    selector,
    text,
  );
  if (!ok) throw new Error(`no ${selector} says "${text}"`);
  if (isPhone(h)) await h.tap('[data-qa-hit="1"]');
  else await h.click('[data-qa-hit="1"]');
}

/** Types into an input or textarea (focused, its text selected so it is replaced). */
async function fill(h, selector, text) {
  await h.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.scrollIntoView({ block: 'center' });
    el.focus();
    el.select?.();
  }, selector);
  await h.type(text);
}

/**
 * Downloads are caught in the page (a data: or blob: URL, its file name and a blob's text) instead
 * of being saved. A blob is read from the Blob itself: the app's CSP (connect-src 'self') refuses a
 * fetch of a blob: URL.
 */
async function catchDownloads(h) {
  await h.evaluate(() => {
    window.__qaDownloads = [];
    const blobs = new Map();
    const make = URL.createObjectURL;
    URL.createObjectURL = (b) => {
      const u = make.call(URL, b);
      blobs.set(u, b);
      return u;
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) {
        const entry = { name: this.download, href: this.href, text: null };
        window.__qaDownloads.push(entry);
        const b = blobs.get(this.href);
        if (b) void b.text().then((t) => (entry.text = t));
        return;
      }
      return click.call(this);
    };
  });
}

/** A phone-sized, touch viewport. */
function isPhone(h) {
  const v = h.viewport;
  return v === 'phone' || !!(v && typeof v === 'object' && (v.mobile || v.w < 600));
}

/** Opens the editor's Export menu and picks an item. */
async function exportItem(h, label) {
  // Twice at most: a tap that lands while the editor is still settling can be lost.
  for (let attempt = 0; ; attempt++) {
    const compact = await h.evaluate(() => !!document.querySelector('.export-btn'));
    if (compact) await h.tap('.export-btn');
    else await h.click('.topbar .menu-wrap > .btn.primary');
    try {
      await h.waitFor('.topbar .menu[role="menu"]', 4000);
      break;
    } catch (e) {
      if (attempt) throw e;
    }
  }
  await clickText(h, '.topbar .menu [role="menuitem"]', label);
}

/** The floor plan PNG carries the company's band: its top-left pixel is the company's navy, not white. */
async function brandedPlan(h) {
  await h.waitUntil(() => (window.__qaDownloads ?? []).some((d) => /floor-plan\.png$/.test(d.name)), 20_000, 'the floor plan download');
  const px = await h.evaluate(async () => {
    const d = window.__qaDownloads.find((x) => /floor-plan\.png$/.test(x.name));
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = d.href;
    });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return { rgb: [...ctx.getImageData(4, 4, 1, 1).data].slice(0, 3), w: img.naturalWidth, h: img.naturalHeight };
  });
  if (px.rgb.reduce((a, b) => a + b, 0) > 300) throw new Error(`the floor plan PNG has no company band (top-left pixel ${px.rgb.join(',')})`);
  h.note(`branded floor plan ${px.w}×${px.h}`);
}

/** Fills and sends the Send form (name and email are prefilled for a signed-in visitor). */
async function sendForm(h, { name, email } = {}) {
  await h.waitFor('.sr-send-form input[autocomplete="name"]');
  await h.waitForText('Send this design to Northline');
  if (name) await fill(h, '.sr-send-form input[autocomplete="name"]', name);
  if (email) await fill(h, '.sr-send-form input[autocomplete="email"]', email);
  // A mistake is caught on the field before anything is sent.
  await clickText(h, '.sr-send-form button[type="submit"]', 'Send to Northline');
  await h.waitForText('Tick the box so Northline Kitchen & Bath (Demo) can contact you.');
  await fill(h, '.sr-send-form input[autocomplete="tel"]', '(519) 555-0175');
  await fill(h, '.sr-send-form input[autocomplete="postal-code"]', 'N1H 6J2');
  await h.evaluate(() => {
    const s = document.querySelectorAll('.sr-send-form select');
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    set.call(s[0], '$25,000 - $40,000');
    s[0].dispatchEvent(new Event('change', { bubbles: true }));
    set.call(s[1], '3-6 months');
    s[1].dispatchEvent(new Event('change', { bubbles: true }));
  });
  await fill(h, '.sr-send-form textarea', 'Could the island seat four? (QA)');
  if (isPhone(h)) await h.tap('.sr-send-consent input');
  else await h.click('.sr-send-consent input');
  await h.shot('form');
  await clickText(h, '.sr-send-form button[type="submit"]', 'Send to Northline');
  await h.waitFor('[data-testid="send-done"]');
  await h.waitForText('Sent to Northline');
}

/** The lead in the company's inbox: the details, the consent and a live view-only link. */
function leadFor(h, email, { signedIn }) {
  const r = h.api.sql(
    "SELECT l.*, s.revoked_at FROM showroom_leads l LEFT JOIN share_links s ON s.token = l.share_token WHERE l.tenant_id = 't_demo' AND l.email = ? AND l.notes LIKE '%(QA)%' ORDER BY l.created_at DESC LIMIT 1",
    email,
  )[0];
  if (!r) throw new Error(`no lead from ${email} in Northline's inbox`);
  if (!r.share_token || r.revoked_at) throw new Error('the lead has no live view-only link to the design');
  if (r.consent !== 1 || !/Northline Kitchen & Bath \(Demo\) may contact me/.test(r.consent_text)) throw new Error('the consent was not stored with the lead');
  const got = { phone: r.phone, postal: r.postal_code, budget: r.budget, timeline: r.timeline };
  if (got.phone !== '(519) 555-0175' || got.postal !== 'N1H 6J2' || got.budget !== '$25,000 - $40,000' || got.timeline !== '3-6 months') throw new Error(`the lead's details are ${JSON.stringify(got)}`);
  if (signedIn !== !!r.user_id) throw new Error(`the lead's account is ${r.user_id}`);
  return r;
}

/** The hero picture: loaded, the right one for the screen, fetched first, its size reserved, and the words readable on it. */
async function heroChecks(h) {
  await h.waitUntil(() => {
    const img = document.querySelector('.sr-hero-pic img');
    return !!img && img.complete && img.naturalWidth > 0;
  }, 20000, 'the hero picture loading');
  const r = await h.evaluate(() => {
    const img = document.querySelector('.sr-hero-pic img');
    const box = img.getBoundingClientRect();
    const h1 = document.querySelector('.sr-hero h1');
    return {
      src: img.currentSrc,
      natural: [img.naturalWidth, img.naturalHeight],
      attrs: [img.getAttribute('width'), img.getAttribute('height')],
      lazy: img.getAttribute('loading'),
      priority: img.getAttribute('fetchpriority'),
      box: [box.width, box.height],
      h1: getComputedStyle(h1).color,
      ink: getComputedStyle(document.documentElement).getPropertyValue('--brand-ink').trim(),
      w: innerWidth,
    };
  });
  if (r.lazy === 'lazy') throw new Error('the hero picture is lazy-loaded');
  if (r.priority !== 'high') throw new Error('the hero picture is not fetched first');
  if (!r.attrs[0] || !r.attrs[1]) throw new Error('the hero picture has no width and height');
  const tall = r.natural[1] > r.natural[0];
  if (r.w <= 700 && !tall) throw new Error(`a phone got the wide hero (${r.natural.join('x')})`);
  if (r.w > 700 && tall) throw new Error(`a wide screen got the portrait hero (${r.natural.join('x')})`);
  if (r.box[1] < 300) throw new Error(`the hero picture is only ${Math.round(r.box[1])}px tall`);
  // The headline is the brand's own text colour (palette.ts makes that AA on the brand), over the brand scrim.
  if (r.h1 !== 'rgb(255, 255, 255)') throw new Error(`the hero headline is ${r.h1}, not the brand's text colour`);
}

/** Scrolls the page through so lazy pictures load, waits for them, and goes back to the top. */
async function settleImages(h) {
  await h.evaluate(async () => {
    const step = innerHeight * 0.8;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await h.waitUntil(() => [...document.images].every((i) => i.complete), 20000, 'every picture loading');
  await h.evaluate(() => window.scrollTo(0, 0));
  await h.sleep(250);
}

/** Every line card and gallery kitchen has its picture, loaded lazily, with its size reserved; nothing failed. */
async function imageChecks(h) {
  const r = await h.evaluate(() => {
    const info = (img) => ({ src: img.getAttribute('src'), ok: img.complete && img.naturalWidth > 0, lazy: img.getAttribute('loading'), w: img.getAttribute('width'), h: img.getAttribute('height') });
    return {
      cards: [...document.querySelectorAll('.sr-line')].map((c) => ({ name: c.querySelector('h3')?.textContent, img: c.querySelector('.sr-line-media > img') ? info(c.querySelector('.sr-line-media > img')) : null })),
      gallery: [...document.querySelectorAll('.sr-shot img')].map(info),
      broken: [...document.images].filter((i) => !(i.naturalWidth > 0)).map((i) => i.getAttribute('src')),
    };
  });
  const noPic = r.cards.filter((c) => !c.img).map((c) => c.name);
  if (noPic.length) throw new Error(`line cards without a picture: ${noPic.join(', ')}`);
  for (const p of [...r.cards.map((c) => c.img), ...r.gallery]) {
    if (!p.ok) throw new Error(`a picture didn't load: ${p.src}`);
    if (p.lazy !== 'lazy') throw new Error(`a picture below the hero isn't lazy: ${p.src}`);
    if (!p.w || !p.h) throw new Error(`a picture has no width and height: ${p.src}`);
  }
  if (r.gallery.length < 3) throw new Error(`the gallery shows ${r.gallery.length} kitchens`);
  if (r.broken.length) throw new Error(`broken pictures: ${r.broken.join(', ')}`);
}

/** Nothing shifts as the page loads (cumulative layout shift, from the first paint). */
async function noShift(h) {
  const cls = await h.evaluate(
    () =>
      new Promise((resolve) => {
        let sum = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (!e.hadRecentInput) sum += e.value;
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => resolve(sum), 300);
      }),
  );
  h.note(`layout shift ${cls.toFixed(4)}`);
  if (cls > 0.05) throw new Error(`the page shifts as it loads (layout shift ${cls.toFixed(3)})`);
}

/** The demo's pitch: after the featured lines, a lead with its picture, product list and a link that opens the design; the way back to Book a call. */
async function pitchChecks(h) {
  await h.waitUntil(() => document.querySelectorAll('.sr-lead-lines li:not(.sr-lead-wait)').length >= 3, 20000, 'the lead’s product list');
  const r = await h.evaluate(() => {
    const pitch = document.querySelector('.sr-pitch');
    const lines = document.querySelector('#sr-lines');
    return {
      after: !!(pitch && lines && lines.compareDocumentPosition(pitch) & Node.DOCUMENT_POSITION_FOLLOWING),
      title: pitch?.querySelector('h2')?.textContent,
      points: [...(pitch?.querySelectorAll('.sr-pitch-points b') ?? [])].map((b) => b.textContent),
      cta: pitch?.querySelector('.sr-pitch-cta')?.getAttribute('href'),
      open: pitch?.querySelector('a.sr-lead-btn')?.getAttribute('href'),
      img: (() => {
        const i = pitch?.querySelector('.sr-lead-design img');
        return i ? i.complete && i.naturalWidth > 0 : false;
      })(),
      products: [...document.querySelectorAll('.sr-lead-lines li b')].map((b) => b.textContent),
      facts: pitch?.querySelector('.sr-lead-facts')?.textContent,
      who: pitch?.querySelector('.sr-lead-who')?.textContent,
    };
  });
  if (!r.after) throw new Error('the demo pitch is not after the featured lines');
  if (r.title !== 'What Northline Kitchen & Bath gets from this showroom') throw new Error(`the pitch title is "${r.title}"`);
  const want = ['Your products, your brand, your web address', 'Every design arrives as a lead with the plan and product list', 'Your team uses it in sales meetings, with photoreal AI renders'];
  if (JSON.stringify(r.points) !== JSON.stringify(want)) throw new Error(`the pitch points are ${JSON.stringify(r.points)}`);
  if (!/^http:\/\/localhost:\d+\/#\/book$/.test(r.cta ?? '')) throw new Error(`the pitch button goes to ${r.cta}`);
  if (!/^#\/s\/[A-Za-z0-9_-]{16,}$/.test(r.open ?? '')) throw new Error(`"Open the design in 3D" goes to ${r.open}`);
  if (!r.img) throw new Error('the lead has no design picture');
  if (!/Budget/.test(r.facts ?? '') || !/Timeline/.test(r.facts ?? '') || !/\(\d{3}\) 555-\d{4}/.test(r.who ?? '') || !/[A-Z]\d[A-Z] \d[A-Z]\d/.test(r.who ?? '')) throw new Error('the lead misses its phone, postal code, budget or timeline');
  if (!r.products.some((p) => /Lakeshore|Harbourfront/.test(p))) throw new Error(`the lead's product list has none of the company's lines: ${r.products.join(', ')}`);
  // It opens: the link is a live view of a design on this showroom.
  const status = await h.evaluate(async (href) => (await fetch(`/api/share/${href.slice(4)}`)).status, r.open);
  if (status !== 200) throw new Error(`the lead's design answers ${status}`);
}

/** A live showroom that isn't the demo (no products, no pictures): "Plainfield Cabinets" at qa-plain. */
async function plainCompany(api) {
  const admin = api.as('admin');
  const list = (await admin.get('/api/admin/tenants')).body.tenants;
  let t = list.find((x) => x.slug === 'qa-plain');
  if (!t) {
    t = (await admin.post('/api/admin/tenants', { name: 'Plainfield Cabinets', slug: 'qa-plain' })).body.tenant;
    await admin.post(`/api/admin/tenants/${t.id}/licenses`, { amountCents: 0, paidHow: 'comp' });
    await admin.post(`/api/admin/tenants/${t.id}/monthly/comp`, { on: true });
    const r = await admin.post(`/api/admin/tenants/${t.id}/status`, { status: 'live' });
    if (r.body?.tenant?.status !== 'live') throw new Error(`qa-plain is ${r.body?.tenant?.status}`);
  }
  return { path: '/' };
}
