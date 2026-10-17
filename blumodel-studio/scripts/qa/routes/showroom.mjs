// Showroom QA routes (docs/SHOWROOM_PIVOT.md §5): what homeowners see on a company's showroom, the
// seeded demo at http://demo.localhost:<port> ("Northline Kitchen & Bath (Demo)"), at 1440 and
// 390, light and dark: the branded landing, sign-up, the wizard with the company's lines, the
// editor with the company's catalog only (no store links, no prices or plans of ours), the free
// branded downloads, "Send this design to Northline" from the editor and the share page, and a
// whole visitor journey ending in a lead in the company's inbox.
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
  if (viewport !== 'phone') return;
  const small = await evaluate(() =>
    [...document.querySelectorAll('a[href], button, input, select, textarea, [role="button"]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !el.closest('[aria-hidden="true"]');
      })
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => r.height < 43.5 && !(el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')))
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
  ...each({
    name: 'landing',
    host: 'demo',
    path: '#/',
    as: 'anon',
    fullPage: true,
    waitFor: ['.sr-hero h1', '.sr-line'],
    expectText: ['Design your kitchen', 'Design your bathroom', 'Lakeshore Shaker', 'Harbourfront Slab', 'Talk to Northline'],
    check: async (h) => {
      const t = await h.evaluate(() => ({ title: document.title, brand: getComputedStyle(document.documentElement).getPropertyValue('--brand').trim(), desc: document.querySelector('meta[name="description"]')?.getAttribute('content') }));
      if (!/^Northline Kitchen & Bath/.test(t.title)) throw new Error(`the tab title is "${t.title}"`);
      if (!t.brand) throw new Error('the company colour tokens are not applied');
      if (!/Northline/.test(t.desc ?? '')) throw new Error(`the description is "${t.desc}"`);
      await noSideScroll(h);
      await noUpsell(h);
      await touchTargets(h);
    },
  }),

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
];
