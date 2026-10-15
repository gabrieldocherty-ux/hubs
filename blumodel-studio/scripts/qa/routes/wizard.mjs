// New-kitchen wizard QA: the four steps (Basics, Room, Layout, Brands; no colour-palette step),
// the plain neutral start, "Choose your brands" with real retail brands, brand products placed in
// the layout and the choices saved on the kitchen, Add products opening on "Your brands", the
// compact-room / template path with Any brand, and the palettes in Room & finishes.
// Run: node scripts/qa.mjs --pkg wizard --port 8878 --dist .build/wizard --strict-external

const DESK = { w: 1440, h: 900 };
const PHONE = 'phone';

const next = '.wizard-nav .btn.primary';
const chips = (cat) => `.wiz-brand-cat[data-cat="${cat}"] .wiz-brand`;

/** No horizontal page scroll. */
async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

/** Basics → Room → Layout → Brands, checking each heading on the way. */
async function toBrandStep(h, { size } = {}) {
  await h.click(next);
  await h.waitForText('How big is the room?');
  if (size) {
    await h.evaluate((label) => [...document.querySelectorAll('.size-picks .chip')].find((b) => b.textContent.includes(label))?.click(), size);
    await h.sleep(150);
  }
  await h.click(next);
  await h.waitForText('Pick a starting layout.');
  await h.waitForText('Pick a colour palette any time in Room & finishes');
  await h.click(next);
  await h.waitForText('Choose your brands.');
  await h.waitUntil(() => document.querySelectorAll('.wiz-brand-cat[data-cat="cabinets"] .wiz-brand').length > 2, 15_000, 'the cabinet brands from the retail catalog');
}

/** The editor's project id once the wizard has created the kitchen. */
async function createdId(h) {
  await h.click(next);
  await h.waitUntil(() => /^#\/k\/[0-9a-f-]{36}/.test(location.hash), 20_000, 'the new kitchen opening in the editor');
  return (await h.evaluate(() => location.hash)).slice(4, 40);
}

export default [
  {
    name: 'wizard-steps',
    path: '#/new',
    as: 'fresh',
    viewport: DESK,
    waitFor: ['.wizard', '.gen-wiz-photo'],
    expectText: ['Let’s set up a new kitchen.', 'Start from a photo of my kitchen'],
    check: async (h) => {
      const steps = await h.evaluate(() => [...document.querySelectorAll('.steps li')].map((li) => li.textContent.replace(/\d/g, '').trim()));
      if (steps.join('|') !== 'Basics|Room|Layout|Brands') throw new Error(`the steps are ${steps.join(', ')}`);
      await toBrandStep(h);
      const cats = await h.evaluate(() => [...document.querySelectorAll('.wiz-brand-cat legend b')].map((b) => b.textContent));
      if (cats.join('|') !== 'Cabinets|Appliances|Sinks & faucets|Lighting') throw new Error(`the brand categories are ${cats.join(', ')}`);
      // Every category starts on Any, and every brand chip names its product count and stores.
      const state = await h.evaluate(() =>
        [...document.querySelectorAll('.wiz-brand-cat')].map((f) => {
          const b = [...f.querySelectorAll('.wiz-brand')];
          return {
            cat: f.dataset.cat,
            any: b[0]?.getAttribute('aria-pressed') === 'true' && b[0].textContent.startsWith('Any'),
            on: b.slice(1).filter((x) => x.getAttribute('aria-pressed') === 'true').length,
            metas: b.slice(1).map((x) => x.querySelector('span')?.textContent ?? ''),
            names: b.slice(1).map((x) => x.querySelector('b')?.textContent ?? ''),
          };
        }),
      );
      for (const c of state) {
        if (!c.any || c.on) throw new Error(`${c.cat} does not start on Any`);
        if (c.names.includes('BluModel Basics')) throw new Error(`${c.cat} offers BluModel Basics as a brand`);
        for (const m of c.metas) if (!/^\d+ products?( · .+)?$/.test(m)) throw new Error(`${c.cat}: a brand chip reads "${m}"`);
      }
      const cab = state.find((c) => c.cat === 'cabinets');
      if (!cab.metas.some((m) => /RONA/.test(m))) throw new Error('no cabinet brand names RONA as a store');
      h.note(`cabinet brands shown: ${cab.names.join(', ')}`);
      // "Show all" unfolds a long list.
      const more = await h.evaluate(() => document.querySelector('.wiz-brand-cat[data-cat="appliances"] .wiz-brand-more')?.textContent ?? '');
      if (more) {
        const before = await h.evaluate(() => document.querySelectorAll('.wiz-brand-cat[data-cat="appliances"] .wiz-brand').length);
        await h.click('.wiz-brand-cat[data-cat="appliances"] .wiz-brand-more');
        await h.sleep(150);
        const after = await h.evaluate(() => document.querySelectorAll('.wiz-brand-cat[data-cat="appliances"] .wiz-brand').length);
        if (after <= before) throw new Error(`"${more}" showed ${after} chips (was ${before})`);
        await h.click('.wiz-brand-cat[data-cat="appliances"] .wiz-brand-more');
      }
      const share = await h.evaluate(() => document.querySelector('[data-testid="wiz-brand-share"]')?.textContent ?? '');
      if (share !== 'Any brand') throw new Error(`the preview says "${share}" before any brand is chosen`);
      await noSideScroll(h);
    },
  },
  {
    name: 'wizard-brands-create',
    path: '#/new',
    as: 'fresh',
    viewport: DESK,
    waitFor: '.wizard',
    check: async (h) => {
      await h.evaluate(() => {
        const input = document.querySelector('.wizard-form input');
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(input, 'QA Brand Kitchen');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await toBrandStep(h);
      const cabinet = await h.evaluate((sel) => document.querySelectorAll(sel)[1].querySelector('b').textContent, chips('cabinets'));
      const appliance = await h.evaluate((sel) => document.querySelectorAll(sel)[1].querySelector('b').textContent, chips('appliances'));
      await h.click(`${chips('cabinets')}:nth-child(2)`);
      await h.click(`${chips('appliances')}:nth-child(2)`);
      const pressed = await h.evaluate((sel) => [...document.querySelectorAll(sel)].map((b) => b.getAttribute('aria-pressed')), chips('cabinets'));
      if (pressed[0] !== 'false' || pressed[1] !== 'true') throw new Error(`choosing ${cabinet} left the cabinet chips at ${pressed.slice(0, 3).join(', ')}`);
      await h.waitUntil(() => /\d+ of \d+ pieces from your brands/.test(document.querySelector('[data-testid="wiz-brand-share"]')?.textContent ?? ''), 5000, 'the preview counting pieces from the chosen brands');
      const share = await h.evaluate(() => document.querySelector('[data-testid="wiz-brand-share"]').textContent);
      const from = Number(/(\d+) of/.exec(share)[1]);
      h.note(`chose ${cabinet} + ${appliance}: "${share}"`);
      if (!(from > 0)) throw new Error(`no piece of the starting layout comes from ${cabinet} or ${appliance}: "${share}"`);
      await h.shot('chosen');

      const id = await createdId(h);
      const r = await h.me.get(`/api/projects/${id}`);
      if (r.status !== 200) throw new Error(`GET the new kitchen: ${r.status}`);
      const doc = r.body.project.doc;
      if (doc.brandPrefs?.cabinets?.[0] !== cabinet || doc.brandPrefs?.appliances?.[0] !== appliance) throw new Error(`the kitchen saved brandPrefs ${JSON.stringify(doc.brandPrefs)}`);
      const branded = doc.items.filter((it) => it.productId.startsWith('r-'));
      if (branded.length !== from) throw new Error(`the saved kitchen has ${branded.length} retail pieces; the preview promised ${from}`);
      if (!branded.every((it) => doc.products?.[it.productId])) throw new Error('a retail piece was saved without its snapshot');
      if (doc.surfaces.cabinetFinishId !== 'warm-white' && !doc.surfaces.cabinetFinishId) throw new Error('the kitchen has no cabinet finish');

      // Add products opens on the kitchen's brands.
      await h.waitFor('.left-panel .chips--brands', 20_000);
      const on = await h.evaluate(() => document.querySelector('.left-panel .chips--brands [aria-pressed="true"]')?.textContent?.trim());
      if (on !== 'Your brands') throw new Error(`Add products opens on "${on}", not Your brands`);
      await h.click('.left-panel .chips--brands .chip:nth-child(2)'); // All brands
      await h.sleep(100);
      const all = await h.evaluate(() => document.querySelector('.left-panel .chips--brands [aria-pressed="true"]')?.textContent?.trim());
      if (all !== 'All brands') throw new Error(`clicking All brands left "${all}" on`);
    },
  },
  {
    name: 'wizard-compact-any',
    path: '#/new',
    as: 'fresh',
    viewport: DESK,
    waitFor: '.wizard',
    check: async (h) => {
      await h.click(next);
      await h.waitForText('How big is the room?');
      await h.evaluate(() => [...document.querySelectorAll('.size-picks .chip')].find((b) => b.textContent.includes('Compact'))?.click());
      await h.click(next);
      await h.waitForText('Pick a starting layout.');
      const picks = await h.evaluate(() => [...document.querySelectorAll('.layout-pick')].map((b) => ({ name: b.querySelector('b').textContent, off: b.disabled })));
      h.note(`compact room layouts: ${picks.map((p) => `${p.name}${p.off ? ' (too small)' : ''}`).join(', ')}`);
      if (!picks.some((p) => p.off) || !picks.some((p) => !p.off && p.name !== 'Blank room')) throw new Error('a compact room should allow some templates and refuse others');
      await h.evaluate(() => [...document.querySelectorAll('.layout-pick')].find((b) => !b.disabled && b.querySelector('b').textContent !== 'Blank room')?.click());
      await h.click(next);
      await h.waitForText('Choose your brands.');
      const id = await createdId(h);
      const doc = (await h.me.get(`/api/projects/${id}`)).body.project.doc;
      if (doc.brandPrefs) throw new Error(`Any brand saved brandPrefs ${JSON.stringify(doc.brandPrefs)}`);
      if (doc.room.widthIn !== 120 || doc.room.lengthIn !== 120) throw new Error(`the room is ${doc.room.widthIn}×${doc.room.lengthIn}`);
      if (!doc.items.length) throw new Error('the template placed nothing');
      if (doc.items.some((it) => it.productId.startsWith('r-'))) throw new Error('Any brand placed retail products');
      // Plain start: the neutral cabinet finish, no palette.
      if (doc.surfaces.cabinetFinishId !== 'warm-white') h.note(`cabinet finish ${doc.surfaces.cabinetFinishId}`);
    },
  },
  {
    name: 'wizard-brands-phone',
    path: '#/new',
    as: 'fresh',
    viewport: PHONE,
    waitFor: '.wizard',
    check: async (h) => {
      await toBrandStep(h);
      await h.click(`${chips('cabinets')}:nth-child(2)`);
      await h.sleep(200);
      await noSideScroll(h);
      // Two brand chips a row, none clipped past the screen edge.
      const r = await h.evaluate(() => {
        const b = [...document.querySelectorAll('.wiz-brand')].map((x) => x.getBoundingClientRect());
        return { right: Math.max(...b.map((x) => x.right)), w: window.innerWidth, minW: Math.min(...b.map((x) => x.width)) };
      });
      if (r.right > r.w) throw new Error(`a brand chip reaches ${Math.round(r.right)}px on a ${r.w}px screen`);
      if (r.minW < 120) throw new Error(`brand chips are ${Math.round(r.minW)}px wide`);
      await h.evaluate(() => document.querySelector('.wiz-brand-cat[data-cat="cabinets"]').scrollIntoView({ block: 'start' }));
      await h.sleep(150);
    },
  },
  {
    name: 'room-finishes-palettes',
    as: 'fresh',
    viewport: DESK,
    setup: async ({ me }) => {
      const doc = { name: 'QA Plain Kitchen', room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 }, surfaces: {}, items: [], version: 2 };
      const r = await me.post('/api/projects', { name: 'QA Plain Kitchen', doc });
      if (r.status !== 201) throw new Error(`creating the kitchen failed (${r.status})`);
      return { path: `#/k/${r.body.project.id}` };
    },
    waitFor: ['.topbar', '.left-panel'],
    check: async (h) => {
      await h.evaluate(() => [...document.querySelectorAll('.left-panel [role="tab"]')].find((b) => /Room/.test(b.textContent))?.click());
      await h.waitForText('Colour palettes');
      const first = await h.evaluate(() => document.querySelector('.room-panel .room-section')?.classList.contains('room-palettes'));
      if (!first) throw new Error('Colour palettes is not the first section of Room & finishes');
    },
  },
];
