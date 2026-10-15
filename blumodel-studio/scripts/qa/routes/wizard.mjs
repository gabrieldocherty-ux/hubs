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

/** A step opens at its top: its heading is on screen (on a phone the preview is a compact strip
 *  above it, not a full screen). */
async function headingOnScreen(h) {
  const r = await h.evaluate(() => {
    const t = document.querySelector('.wizard-form h1').getBoundingClientRect();
    const card = document.querySelector('.wizard-card').getBoundingClientRect();
    return { top: Math.round(t.top), bottom: Math.round(t.bottom), vh: window.innerHeight, card: Math.round(card.height), phone: window.innerWidth <= 600, text: document.querySelector('.wizard-form h1').textContent };
  });
  if (r.top < 50 || r.bottom > r.vh) throw new Error(`"${r.text}" opens at ${r.top}–${r.bottom}px in a ${r.vh}px window`);
  if (r.phone && r.card > 160) throw new Error(`the phone preview is ${r.card}px tall`);
}

/** Types into an input the way React sees it (the native setter, then an input event). */
async function fill(h, selector, value) {
  const ok = await h.evaluate(
    (sel, v) => {
      const input = document.querySelector(sel);
      if (!input) return false;
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    },
    selector,
    value,
  );
  if (!ok) throw new Error(`no input ${selector}`);
}

/** Basics → Room → Layout → Brands, checking each heading on the way. */
async function toBrandStep(h, { size, shots = false } = {}) {
  if (shots) {
    await headingOnScreen(h);
    await h.shot('basics');
  }
  await h.click(next);
  await h.waitForText('How big is the room?');
  if (size) {
    await h.evaluate((label) => [...document.querySelectorAll('.size-picks .chip')].find((b) => b.textContent.includes(label))?.click(), size);
    await h.sleep(150);
  }
  if (shots) {
    await headingOnScreen(h);
    await noSideScroll(h);
    await h.shot('room');
  }
  await h.click(next);
  await h.waitForText('Pick a starting layout.');
  await h.waitForText('Pick a colour palette any time in Room & finishes');
  if (shots) {
    await headingOnScreen(h);
    await noSideScroll(h);
    // Two layouts a row on a phone.
    const cols = await h.evaluate(() => new Set([...document.querySelectorAll('.layout-pick')].map((b) => Math.round(b.getBoundingClientRect().top))).size);
    const n = await h.evaluate(() => document.querySelectorAll('.layout-pick').length);
    if (cols > Math.ceil(n / 2)) throw new Error(`${n} layouts take ${cols} rows`);
    await h.shot('layout');
  }
  await h.click(next);
  await h.waitForText('Choose your brands.');
  await h.waitUntil(() => document.querySelectorAll('.wiz-brand-cat[data-cat="cabinets"] .wiz-brand').length > 2, 15_000, 'the cabinet brands from the retail catalog');
  if (shots) await headingOnScreen(h);
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
      await h.sleep(250); // the chips' border transition
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

      // Add products opens on the kitchen's brands: "Your brands" is on and the cabinets listed are
      // the chosen brand's; one tap on it shows every brand again.
      const mine = '.left-panel .catalog-filters button[aria-pressed]';
      await h.waitFor(mine, 20_000);
      await h.waitUntil(() => document.querySelectorAll('.left-panel .product-card').length > 0, 20_000, 'the product list');
      const listed = () =>
        h.evaluate(() => ({
          on: document.querySelector('.left-panel .catalog-filters button[aria-pressed]')?.getAttribute('aria-pressed'),
          label: document.querySelector('.left-panel .catalog-filters button[aria-pressed]')?.textContent?.trim(),
          brand: document.querySelector('#catalog-brand')?.value ?? null,
          cards: document.querySelectorAll('.left-panel .product-card').length,
          cabinetBrands: [...new Set([...document.querySelectorAll('.left-panel .catalog-group')].filter((g) => /^Cabinets/.test(g.querySelector('h4')?.textContent ?? '')).flatMap((g) => [...g.querySelectorAll('.product-card .product-meta > span:first-child')].map((b) => b.textContent.trim())))],
        }));
      const before = await listed();
      if (before.label !== 'Your brands' || before.on !== 'true') throw new Error(`Add products opens with "${before.label}" ${before.on === 'true' ? 'on' : 'off'}, not Your brands on`);
      if (before.cabinetBrands.length && before.cabinetBrands.some((b) => b !== cabinet)) throw new Error(`Your brands lists cabinets by ${before.cabinetBrands.join(', ')} (chose ${cabinet})`);
      await h.click(mine);
      await h.sleep(150);
      const after = await listed();
      if (after.on !== 'false') throw new Error('tapping Your brands left it on');
      if (!(after.cards > before.cards)) throw new Error(`every brand lists ${after.cards} products, Your brands ${before.cards}`);
      h.note(`Add products: ${before.cards} products with Your brands, ${after.cards} with every brand`);
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
      // Room & finishes opens with Plain chosen, and a palette is one tap away.
      await h.waitFor('.left-panel [role="tab"]', 20_000);
      await h.evaluate(() => [...document.querySelectorAll('.left-panel [role="tab"]')].find((b) => /Room/.test(b.textContent))?.click());
      await h.waitFor('.room-palettes .preset', 10_000);
      const pressed = () => h.evaluate(() => [...document.querySelectorAll('.room-palettes .preset[aria-pressed="true"] b')].map((b) => b.textContent));
      const start = await pressed();
      if (start.join() !== 'Plain') throw new Error(`a new kitchen's Room & finishes shows ${start.join(', ') || 'no palette'} chosen, not Plain`);
      await h.evaluate(() => [...document.querySelectorAll('.room-palettes .preset')].find((b) => b.querySelector('b').textContent === 'Moody Green').click());
      await h.sleep(200);
      const after = await pressed();
      if (after.join() !== 'Moody Green') throw new Error(`choosing Moody Green left ${after.join(', ') || 'nothing'} chosen`);
    },
  },
  {
    // A measured room typed wall to wall, a blank room, Back keeping what was entered, a cabinet and
    // a lighting brand: the kitchen keeps the size, the client, no pieces and the preferences; then
    // a layout applied from the blank room's own buttons in the editor uses those brands too.
    name: 'wizard-custom-blank',
    path: '#/new',
    as: 'fresh',
    viewport: DESK,
    waitFor: '.wizard',
    check: async (h) => {
      await fill(h, '.wizard-form label.field:nth-of-type(1) input', 'QA Measured Kitchen');
      await fill(h, '.wizard-form label.field:nth-of-type(2) input', 'The Okafors');
      await h.click(next);
      await h.waitForText('How big is the room?');
      // Width 15′ 4″ typed and committed on blur; length one 6″ step up from the 13′ default.
      for (const [part, v] of [['feet', '15'], ['inches', '4']]) {
        await fill(h, `input[aria-label="Width (E–W) ${part}"]`, v);
        await h.evaluate(() => document.activeElement?.blur());
        await h.sleep(100);
      }
      await h.click('button[aria-label="Increase Length (N–S)"]');
      await h.sleep(150);
      const sq = await h.evaluate(() => document.querySelector('.wizard-note.mono')?.textContent);
      await h.click(next);
      await h.waitForText('Pick a starting layout.');
      await h.evaluate(() => [...document.querySelectorAll('.layout-pick')].find((b) => b.querySelector('b').textContent === 'Blank room')?.click());
      // Back to Room and forward again: the size and the blank room are still chosen.
      await h.click('.wizard-nav .btn:not(.primary)');
      await h.waitForText('How big is the room?');
      const kept = await h.evaluate(() => ({ ft: document.querySelector('input[aria-label="Width (E–W) feet"]').value, inch: document.querySelector('input[aria-label="Width (E–W) inches"]').value, sq: document.querySelector('.wizard-note.mono')?.textContent }));
      if (kept.ft !== '15' || kept.inch !== '4' || kept.sq !== sq) throw new Error(`Back shows ${kept.ft}′ ${kept.inch}″ (${kept.sq}), not 15′ 4″ (${sq})`);
      await h.click(next);
      await h.waitForText('Pick a starting layout.');
      const on = await h.evaluate(() => document.querySelector('.layout-pick.on b')?.textContent);
      if (on !== 'Blank room') throw new Error(`Back and forward left "${on}" chosen`);
      await h.click(next);
      await h.waitForText('Choose your brands.');
      await h.waitUntil(() => document.querySelectorAll('.wiz-brand-cat[data-cat="lighting"] .wiz-brand').length > 1, 15_000, 'the lighting brands');
      const cabinet = await h.evaluate((sel) => document.querySelectorAll(sel)[1].querySelector('b').textContent, chips('cabinets'));
      const light = await h.evaluate((sel) => document.querySelectorAll(sel)[1].querySelector('b').textContent, chips('lighting'));
      await h.click(`${chips('cabinets')}:nth-child(2)`);
      await h.click(`${chips('lighting')}:nth-child(2)`);
      await h.sleep(100);
      const share = await h.evaluate(() => document.querySelector('[data-testid="wiz-brand-share"]')?.textContent ?? '');
      if (!share.startsWith(`${cabinet} & ${light}`)) throw new Error(`the preview reads "${share}" after choosing ${cabinet} and ${light}`);
      const id = await createdId(h);
      const r = await h.me.get(`/api/projects/${id}`);
      const { doc, client, name } = r.body.project;
      if (name !== 'QA Measured Kitchen' || client !== 'The Okafors') throw new Error(`the kitchen was saved as "${name}" for "${client}"`);
      if (doc.room.widthIn !== 184 || doc.room.lengthIn !== 162) throw new Error(`the room is ${doc.room.widthIn}×${doc.room.lengthIn}, not 184×162`);
      if (doc.items.length) throw new Error(`a blank room was created with ${doc.items.length} pieces`);
      if (JSON.stringify(doc.brandPrefs) !== JSON.stringify({ cabinets: [cabinet], lighting: [light] })) throw new Error(`the kitchen saved brandPrefs ${JSON.stringify(doc.brandPrefs)}`);
      h.note(`blank 15′4″ × 13′6″ room, ${cabinet} + ${light}, ${sq}`);

      // The blank room's "L + Island" in the editor, once the retail products have loaded.
      await h.waitFor('.plan-empty-actions button', 20_000);
      await h.waitUntil(() => document.querySelectorAll('.left-panel .product-card').length > 0, 20_000, 'the product list');
      await h.evaluate(() => [...document.querySelectorAll('.plan-empty-actions button')].find((b) => b.textContent === 'L + Island').click());
      await h.waitUntil(() => !document.querySelector('.plan-empty'), 10_000, 'the layout being applied');
      // Autosave carries it to the server.
      let saved = null;
      for (let t = Date.now(); Date.now() - t < 15_000; await h.sleep(250)) {
        saved = (await h.me.get(`/api/projects/${id}`)).body.project.doc;
        if (saved.items.length) break;
      }
      const fromBrand = saved.items.filter((it) => saved.products?.[it.productId]?.brand === cabinet).length;
      if (!saved.items.length) throw new Error('L + Island placed nothing');
      if (!fromBrand) throw new Error(`L + Island applied in the editor has no ${cabinet} piece (${saved.items.length} pieces)`);
      h.note(`L + Island in the editor: ${fromBrand} of ${saved.items.length} pieces by ${cabinet}`);
    },
  },
  {
    // "Start from a photo of my kitchen" is the first thing on Basics, and on a phone it opens the
    // photo flow.
    name: 'wizard-photo-entry-phone',
    path: '#/new',
    as: 'fresh',
    viewport: PHONE,
    waitFor: ['.wizard', '.gen-wiz-photo'],
    check: async (h) => {
      await noSideScroll(h);
      await h.shot('basics');
      await h.click('.gen-wiz-photo');
      await h.waitUntil(() => location.hash.startsWith('#/generate'), 10_000, 'the photo flow opening');
      await h.waitFor('.gen-drop', 15_000);
      await noSideScroll(h);
    },
  },
  {
    name: 'wizard-brands-phone',
    path: '#/new',
    as: 'fresh',
    viewport: PHONE,
    waitFor: '.wizard',
    check: async (h) => {
      await toBrandStep(h, { shots: true });
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
