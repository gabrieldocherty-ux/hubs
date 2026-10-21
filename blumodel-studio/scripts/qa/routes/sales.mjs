// Sales site QA (docs/SHOWROOM_PIVOT.md §6): blumodel.studio itself, for kitchen and bath companies.
// The landing page, pricing, Book a call (a real request through POST /api/sales-leads, and its
// field errors), the legal pages, and the header for a signed-in admin, at 1440 and 390, light and
// dark. Every route checks: no homeowner sign-up funnel and no homeowner pricing, the demo link
// goes to the demo showroom on this server (http://demo.localhost:<port>), no sideways scroll, and on
// phones every link, button and field is a 44 px touch target. Since 2026-10-17 the setup and yearly
// license is quoted per company: no page names a license amount or a product count (no 1,995, no
// "up to 50"), while the $50 monthly plan and "quoted" do appear, and no $25 of render credits is promised.
// Run: node scripts/qa.mjs --pkg sales --port 8925

const SALES_TITLE = 'BluModel Studio (blue model) | 3D Kitchen Design Showrooms for Kitchen & Bath Companies';
const HERO = 'Let your customers see it before it’s installed.';

const views = [
  // Light is said outright: without it the browser follows this machine's own setting.
  { suffix: '', viewport: 'desktop', colorScheme: 'light' },
  { suffix: '-dark', viewport: 'desktop', colorScheme: 'dark' },
  { suffix: '-phone', viewport: 'phone', colorScheme: 'light' },
  { suffix: '-phone-dark', viewport: 'phone', colorScheme: 'dark' },
];
const view = (v) => ({ viewport: v.viewport, ...(v.colorScheme ? { colorScheme: v.colorScheme } : {}) });
const isPhone = (h) => !!h.viewport?.mobile;

/** In the page: layout problems (sideways scroll, small touch targets, small fields, text off screen). */
function audit(touch) {
  const vw = innerWidth;
  const out = { overflow: 0, small: [], font: [], offscreen: [] };
  if (document.documentElement.scrollWidth > vw + 1) out.overflow = document.documentElement.scrollWidth;
  const shown = (el) => {
    if (el.closest('[aria-hidden="true"]')) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return null;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) return null;
    }
    return r;
  };
  const name = (el) => `${String(el.textContent || el.getAttribute('aria-label') || el.getAttribute('name') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 40)} <${el.tagName.toLowerCase()}${[...el.classList].slice(0, 2).map((c) => `.${c}`).join('')}>`;
  if (touch)
    for (const el of document.querySelectorAll('a, button, summary, input:not([type="hidden"]), textarea')) {
      const r = shown(el);
      if (!r) continue;
      // A link inside running text is exempt, as WCAG 2.5.8 allows: it is sized by its line.
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li, dd')) continue;
      if (r.height < 43.5) out.small.push(`${name(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  for (const el of document.querySelectorAll('input:not([type="hidden"]), textarea')) {
    if (!shown(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (touch && fs < 15.5) out.font.push(`${name(el)} ${fs}px`);
  }
  for (const el of document.querySelectorAll('.mk *')) {
    if (el.closest('svg')) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = shown(el);
    if (r && (r.right > vw + 1 || r.left < -1)) out.offscreen.push(`${name(el)} ${Math.round(r.left)}–${Math.round(r.right)}`);
  }
  return { overflow: out.overflow, small: [...new Set(out.small)].slice(0, 20), font: out.font.slice(0, 10), offscreen: [...new Set(out.offscreen)].slice(0, 20) };
}

async function layoutOk(h) {
  const a = await h.evaluate(audit, isPhone(h));
  const p = [];
  if (a.overflow) p.push(`scrolls sideways (${a.overflow}px)`);
  if (a.small.length) p.push(`touch targets under 44px: ${a.small.join('; ')}`);
  if (a.font.length) p.push(`fields under 16px: ${a.font.join('; ')}`);
  if (a.offscreen.length) p.push(`text off the screen: ${a.offscreen.join('; ')}`);
  if (p.length) throw new Error(p.join(' | '));
}

/** Nothing for homeowners to buy or sign up for, and none of the removed product. */
async function salesOnly(h) {
  const r = await h.evaluate(() => ({
    hrefs: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
    text: document.body.innerText,
  }));
  const bad = r.hrefs.filter((x) => /^#\/(signup|generate|contractors|local|orders|pro)\b/.test(x));
  if (bad.length) throw new Error(`homeowner or removed links on the sales site: ${bad.join(', ')}`);
  for (const re of [/\bUnlimited\b/, /Contractor plan/i, /\$5(\.00)?\b/, /Start free/i, /Start from a photo/i, /\$15\b/, /\$99\b/, /Where to buy/i]) if (re.test(r.text)) throw new Error(`the page still says ${re}`);
  noLicenseAmount(r.text);
}

/** The setup and license is quoted per company: no license amount or product count, in any form. */
const LICENSE_AMOUNTS = [/1,995/, /1995/, /199500/, /up to 50/i, /\b50 (of your )?products\b/i, /list price/i];
function noLicenseAmount(text, where = 'the page') {
  for (const re of LICENSE_AMOUNTS) if (re.test(text)) throw new Error(`${where} names a license amount or product count: ${re}`);
}

/** The demo link points at this server's demo showroom. */
async function demoLinkOk(h) {
  const hrefs = await h.evaluate(() => [...document.querySelectorAll('a[data-demo-link]')].map((a) => a.href));
  if (!hrefs.length) throw new Error('no "See a live demo showroom" link');
  const port = new URL(await h.evaluate(() => location.href)).port;
  const want = `http://demo.localhost:${port}/`;
  const wrong = hrefs.filter((x) => x !== want);
  if (wrong.length) throw new Error(`demo links go to ${wrong.join(', ')}, expected ${want}`);
}

/** A screenshot with each of these sections at the top of the screen (phones, instead of a full-page shot). */
async function sectionShots(h, ids) {
  for (const id of ids) {
    await h.evaluate((x) => document.getElementById(x)?.scrollIntoView({ block: 'start' }), id);
    await h.sleep(250);
    await h.shot(id);
  }
  // The route's own screenshot, taken after the check, shows the top of the page.
  await h.evaluate(() => window.scrollTo(0, 0));
  await h.sleep(250);
}

/** The demo links settle once /api/config has said the base domain. */
const waitDemo = (h) => h.waitUntil(() => [...document.querySelectorAll('a[data-demo-link]')].every((a) => a.href.includes('demo.localhost')), 8000, 'the demo links');

export default [
  // ── the landing page ───────────────────────────────────────────────────────
  ...views.map((v) => ({
    name: `landing${v.suffix}`,
    path: '#/',
    as: 'anon',
    ...view(v),
    // A whole-page shot at 1440; a phone (dpr 3) gets one shot per section instead.
    fullPage: v.viewport === 'desktop',
    waitFor: ['.mk-hero h1', '#book form', '.mk-window-stage img'],
    expectText: [HERO, 'See a live demo showroom', 'Book a call', 'yourcompany.blumodel.studio'],
    check: async (h) => {
      await waitDemo(h);
      if ((await h.evaluate(() => document.title)) !== SALES_TITLE) throw new Error(`the title is "${await h.evaluate(() => document.title)}"`);
      const lede = await h.evaluate(() => document.querySelector('.mk-lede').textContent);
      if (!/We build, host and run/.test(lede)) throw new Error('the hero doesn’t say we build, host and run it');
      const fine = await h.evaluate(() => document.querySelector('.mk-hero-fine')?.textContent.replace(/\s+/g, ' ').trim() ?? '');
      if (fine !== '$50/month in CAD plus a one-time setup quoted for your company. Nothing to install. No developer, no Blender.') throw new Error(`the line under the hero buttons says: ${fine}`);
      const text = await h.evaluate(() => document.body.innerText);
      if (/\$25|rendering credits/i.test(await h.evaluate(() => document.body.innerText))) throw new Error('the landing page still promises render credits');
      for (const s of ['$50', 'quoted', 'How it works', 'Who it’s for', 'What’s included', 'Your own web address', 'Hosting and updates', 'A potential-customer inbox', 'Team accounts'])
        if (!text.toLowerCase().includes(s.toLowerCase())) throw new Error(`the landing page doesn’t say "${s}"`);
      for (const q of ['Do we need to install anything?', 'Can we use our own domain?', 'What if we add products?', 'Is it a CAD tool?', 'Who owns my potential customers’ details?', 'Can we cancel?'])
        if (!text.includes(q)) throw new Error(`the FAQ is missing "${q}"`);
      const signIn = await h.evaluate(() => !!document.querySelector('.mk-bar a[href="#/signin"]'));
      if (!signIn) throw new Error('Sign in is gone from the header');
      await salesOnly(h);
      await demoLinkOk(h);
      await layoutOk(h);
      if (isPhone(h)) await sectionShots(h, ['how', 'leads', 'included', 'who', 'pricing', 'book']);
    },
  })),
  {
    name: 'landing-meta',
    path: '#/',
    as: 'anon',
    waitFor: ['.mk-hero h1'],
    check: async (h) => {
      const m = await h.evaluate(() => Object.fromEntries([...document.head.querySelectorAll('meta[name], meta[property]')].map((x) => [x.getAttribute('name') ?? x.getAttribute('property'), x.getAttribute('content')])));
      const want = "BluModel Studio builds, hosts and runs a 3D kitchen and bath design website under your company's name: an online kitchen planner with your products, where customers see it before it's installed and everyone who signs up comes to you as a potential customer. From Guelph, Ontario.";
      for (const k of ['description', 'og:description', 'twitter:description']) if (m[k] !== want) throw new Error(`${k} is "${m[k]}"`);
      for (const k of ['og:title', 'twitter:title']) if (m[k] !== SALES_TITLE) throw new Error(`${k} is "${m[k]}"`);
      if (m['og:image'] !== 'https://blumodel.studio/marketing/og.png') throw new Error(`og:image is ${m['og:image']}`);
      const img = await h.evaluate(async () => {
        const r = await fetch('/marketing/og.png');
        const b = new Uint8Array(await r.arrayBuffer());
        const v = new DataView(b.buffer);
        return { status: r.status, type: r.headers.get('content-type'), w: v.getUint32(16), h: v.getUint32(20) };
      });
      if (img.status !== 200 || !/png/.test(img.type) || img.w !== 1200 || img.h !== 630) throw new Error(`og.png: ${JSON.stringify(img)}`);
    },
  },
  {
    name: 'landing-phone-faq-open',
    path: '#/',
    as: 'anon',
    viewport: 'phone',
    waitFor: ['#faq details'],
    check: async (h) => {
      await h.evaluate(() => {
        document.querySelectorAll('.mk-faq details').forEach((d) => (d.open = true));
        document.getElementById('faq').scrollIntoView({ block: 'start' });
      });
      await h.sleep(300);
      await h.shot('faq');
      await layoutOk(h);
    },
  },
  {
    name: 'landing-signed-in-admin',
    path: '#/welcome',
    as: 'admin',
    waitFor: ['.mk-hero h1'],
    check: async (h) => {
      const r = await h.evaluate(() => ({ account: !!document.querySelector('.mk-bar a[href="#/"]'), signIn: !!document.querySelector('.mk-bar a[href="#/signin"]') }));
      if (!r.account || r.signIn) throw new Error(`signed in, the header shows ${JSON.stringify(r)}`);
      await salesOnly(h);
    },
  },

  // ── pricing ────────────────────────────────────────────────────────────────
  ...views.map((v) => ({
    name: `pricing${v.suffix}`,
    path: '#/pricing',
    as: 'anon',
    ...view(v),
    fullPage: v.viewport === 'desktop',
    waitFor: ['.mk-prices', '#billing'],
    expectText: ['Setup and yearly license', 'Monthly plan', 'How paying works'],
    check: async (h) => {
      await waitDemo(h);
      const price = await h.evaluate(() => ({
        license: document.querySelector('#price-license')?.closest('.mk-price')?.innerText ?? '',
        monthly: document.querySelector('#price-monthly')?.closest('.mk-price')?.innerText ?? '',
      }));
      // The license card names no amount at all: no dollar sign and no number ("3D" aside).
      if (/\$|\d/.test(price.license.replace(/\b3D\b/g, ''))) throw new Error(`the license card names an amount: ${price.license}`);
      if (!/Quoted\s+for your company/.test(price.license)) throw new Error(`the license card doesn’t say it’s quoted: ${price.license}`);
      if (!price.license.includes('Setup and yearly license: quoted for your company. Book a call and we’ll price it for your product range.')) throw new Error(`the license card says: ${price.license}`);
      const all = await h.evaluate(() => document.body.innerText);
      for (const s of ['$50', 'quoted']) if (!all.includes(s)) throw new Error(`the pricing page doesn’t say "${s}"`);
      if (/\$25|rendering credits/i.test(all)) throw new Error('the pricing page still promises render credits');
      if (!/\$50\s+CAD \/ month/.test(price.monthly)) throw new Error(`the monthly card says: ${price.monthly}`);
      if (!/Hosting and running your showroom/i.test(price.monthly)) throw new Error(`the monthly card says: ${price.monthly}`);
      await salesOnly(h);
      await demoLinkOk(h);
      await layoutOk(h);
      if (isPhone(h)) await sectionShots(h, ['price-license', 'price-monthly', 'billing']);
    },
  })),

  // ── Book a call ────────────────────────────────────────────────────────────
  ...views.map((v) => ({
    name: `book${v.suffix}`,
    path: '#/book',
    as: 'anon',
    ...view(v),
    waitFor: ['#book form'],
    expectText: ['See your showroom before you sign anything'],
    check: async (h) => {
      await salesOnly(h);
      await layoutOk(h);
    },
  })),
  {
    name: 'book-errors',
    path: '#/book',
    as: 'anon',
    viewport: 'phone',
    waitFor: ['#book form'],
    check: async (h) => {
      await h.tap('#book button[type="submit"]');
      await h.waitFor('.mk-field-err');
      const errs = await h.evaluate(() => [...document.querySelectorAll('.mk-field-err')].map((e) => e.textContent));
      for (const want of ['company', 'name', 'email']) if (!errs.some((e) => e.toLowerCase().includes(want === 'company' ? 'company' : want === 'name' ? 'your name' : 'email'))) throw new Error(`no error for ${want}: ${errs.join(' / ')}`);
      const focused = await h.evaluate(() => document.activeElement?.getAttribute('name'));
      if (focused !== 'company') throw new Error(`focus went to ${focused}, not the first wrong field`);
      await h.shot('errors');
      await layoutOk(h);
    },
  },
  ...['desktop', 'phone'].map((vp) => ({
    name: `book-send-${vp}`,
    path: '#/book',
    as: 'anon',
    viewport: vp,
    waitFor: ['#book form'],
    check: async (h) => {
      const company = `QA Kitchens ${vp} ${Date.now()}`;
      const fill = async (name, value) => {
        await h.click(`#book [name="${name}"]`);
        await h.type(value);
      };
      await fill('company', company);
      await fill('name', 'Robin Example');
      await fill('email', 'robin@example.test');
      await fill('phone', '(519) 555-0199');
      await fill('city', 'Guelph');
      await fill('message', 'Two cabinet lines and a bath showroom.');
      await h.click('#book button[type="submit"]');
      await h.waitForText('We’ve got your request');
      await h.shot('sent');
      const rows = h.api.sql('SELECT company, name, email, phone, city, message, status FROM sales_leads WHERE company = ?', company);
      if (rows.length !== 1) throw new Error(`${rows.length} sales leads saved for ${company}`);
      const r = rows[0];
      if (r.name !== 'Robin Example' || r.email !== 'robin@example.test' || r.city !== 'Guelph' || r.status !== 'new') throw new Error(`saved ${JSON.stringify(r)}`);
    },
  })),

  // ── the legal pages ────────────────────────────────────────────────────────
  ...['terms', 'privacy', 'refunds'].flatMap((doc) =>
    [views[0], views[3]].map((v) => ({
      name: `legal-${doc}${v.suffix}`,
      path: `#/${doc}`,
      as: 'anon',
      ...view(v),
      waitFor: ['.legal-doc h1'],
      check: async (h) => {
        const text = await h.evaluate(() => document.body.innerText);
        if (doc === 'terms' && !/Service agreement/i.test(text)) throw new Error('the terms page isn’t the B2B service agreement');
        if (doc === 'privacy' && !/processor/i.test(text)) throw new Error('the privacy policy doesn’t explain we process visitor data for companies');
        if (doc === 'refunds' && !/monthly plan/i.test(text)) throw new Error('the refund policy doesn’t cover the monthly plan');
        // The removed homeowner and contractor products are named only in the earlier-purchases section.
        const current = await h.evaluate(() => [...document.querySelectorAll('.legal-doc section:not(#legal-earlier)')].map((x) => x.innerText).join('\n'));
        for (const re of [/\bUnlimited\b/, /Start from a photo/i, /kitchen unlock/i, /Contractor plan/i]) if (re.test(current)) throw new Error(`${doc} still says ${re} outside the earlier-purchases section`);
        noLicenseAmount(text, doc);
        if (doc === 'terms' && !/the setup and license fee set out in your order or invoice/.test(text)) throw new Error('the agreement doesn’t refer to the fee in the order or invoice');
        await layoutOk(h);
      },
    })),
  ),
];
