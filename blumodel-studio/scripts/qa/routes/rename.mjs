// The rename from Mise to BluModel Studio: the name a person sees at every width, and what a device
// used before the rename keeps (its device-only kitchen, drafts and photos move to the new keys).
// Run: node scripts/qa.mjs --pkg rename --port 8850

import { kitchenDoc } from './core.mjs';

const PHONE_360 = { w: 360, h: 740, dpr: 2, mobile: true };

/** The page's tab title and its share-card tags name the product. */
async function titleAndMeta({ evaluate }) {
  const r = await evaluate(() => ({
    title: document.title,
    og: document.querySelector('meta[property="og:site_name"]')?.getAttribute('content'),
    app: document.querySelector('meta[name="application-name"]')?.getAttribute('content'),
  }));
  if (!/BluModel Studio/.test(r.title)) throw new Error(`the tab title is "${r.title}"`);
  if (r.og !== 'BluModel Studio' || r.app !== 'BluModel Studio') throw new Error(`og:site_name / application-name are ${r.og} / ${r.app}`);
}

/** Every visible wordmark reads `want`, sits on one line and stays inside the viewport. */
async function wordmarks({ evaluate }, want) {
  const r = await evaluate(() =>
    [...document.querySelectorAll('.wordmark')]
      .filter((el) => el.getBoundingClientRect().width > 0)
      .map((el) => {
        const b = el.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.4;
        return { text: el.innerText.replace(/\s+/g, ' ').trim(), h: b.height, lh, right: b.right, left: b.left, w: innerWidth };
      }),
  );
  if (!r.length) throw new Error('no wordmark on the page');
  for (const m of r) {
    if (m.text !== want) throw new Error(`a wordmark reads "${m.text}", expected "${want}"`);
    if (m.h > m.lh * 1.5) throw new Error(`the wordmark "${m.text}" wraps (${Math.round(m.h)}px tall)`);
    if (m.left < 0 || m.right > m.w + 0.5) throw new Error(`the wordmark "${m.text}" runs off the screen (${Math.round(m.left)}–${Math.round(m.right)} of ${m.w})`);
  }
}

async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

/** Nothing in the editor's top bar wraps or spills out (same rule as core's local-topbar-fits). */
async function topbarFits(h) {
  const r = await h.evaluate(() => {
    const bar = document.querySelector('.topbar').getBoundingClientRect();
    return [...document.querySelectorAll('.topbar .btn, .topbar [role="tab"], .topbar .wordmark, .topbar .project-name, .topbar svg')]
      .map((el) => ({ label: (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().replace(/\s+/g, ' '), b: el.getBoundingClientRect() }))
      .filter((x) => x.b.width > 0)
      .filter((x) => x.b.height > 44 || x.b.top < bar.top - 1 || x.b.bottom > bar.bottom + 1 || x.b.right > innerWidth + 0.5 || x.b.left < -0.5)
      .map((x) => `"${x.label}" ${Math.round(x.b.width)}×${Math.round(x.b.height)} at ${Math.round(x.b.left)},${Math.round(x.b.top)}`);
  });
  if (r.length) throw new Error(`top-bar items wrap or overflow: ${r.join('; ')}`);
  // …and no two of them overlap (a long name can run under the buttons without leaving the bar).
  const overlaps = await h.evaluate(() => {
    const vis = [...document.querySelectorAll('.topbar .brand > *, .topbar .actions > *, .topbar .views')]
      .filter((el) => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden')
      .map((el) => ({ el, b: el.getBoundingClientRect(), label: (el.textContent || el.getAttribute('aria-label') || el.className || el.tagName).toString().trim().replace(/\s+/g, ' ').slice(0, 24) }))
      .filter((x) => x.b.width > 0 && x.b.height > 0);
    const out = [];
    for (let i = 0; i < vis.length; i++)
      for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i].b;
        const b = vis[j].b;
        if (vis[i].el.contains(vis[j].el) || vis[j].el.contains(vis[i].el)) continue;
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 1 && y > 1) out.push(`"${vis[i].label}" (${Math.round(a.left)}–${Math.round(a.right)}) and "${vis[j].label}" (${Math.round(b.left)}–${Math.round(b.right)})`);
      }
    return out;
  });
  if (overlaps.length) throw new Error(`top-bar items overlap: ${overlaps.join('; ')}`);
}

/** A phone's editor bar: the mark stands for the name (whole and unsquashed), the words are hidden. */
async function markOnly({ evaluate }) {
  const r = await evaluate(() => {
    const mark = document.querySelector('.topbar .brand > svg');
    const b = mark?.getBoundingClientRect();
    const words = [...document.querySelectorAll('.topbar .wordmark')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.innerText);
    return { mark: b ? { w: Math.round(b.width), h: Math.round(b.height), left: Math.round(b.left) } : null, words };
  });
  if (!r.mark || r.mark.w < 24 || r.mark.h < 24 || r.mark.left < 0) throw new Error(`the mark isn't shown whole: ${JSON.stringify(r.mark)}`);
  if (r.words.length) throw new Error(`the phone bar shows the words "${r.words.join('", "')}" next to the mark`);
}

/** The kitchen's name keeps real room beside the wordmark (it was squeezed to "Unt…" once). */
async function nameHasRoom({ evaluate }, min) {
  const w = await evaluate(() => Math.round(document.querySelector('.topbar .project-name')?.getBoundingClientRect().width ?? 0));
  if (w < min) throw new Error(`the kitchen's name has only ${w}px in the top bar (want ≥ ${min})`);
}

/** Writes what a browser used before the rename holds: the old keys and the old photo database. */
async function seedPreRenameDevice(h, kitchenName) {
  return h.evaluate(async (doc) => {
    localStorage.clear();
    sessionStorage.clear();
    const del = (name) => new Promise((r) => { const q = indexedDB.deleteDatabase(name); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    await del('blumodel-generate');
    await del('mise-generate');
    localStorage.setItem('mise-local-draft', JSON.stringify(doc));
    localStorage.setItem('mise-kitchen-v1', JSON.stringify({ state: { ui: { viewMode: 'plan' } }, version: 1 }));
    localStorage.setItem('mise.studio.prefs', JSON.stringify({ size: '1440', camera: 'overview' }));
    sessionStorage.setItem('mise.exportIntent', JSON.stringify({ projectId: 'p-old', kind: 'csv', at: Date.now() }));
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 48;
    const g = c.getContext('2d');
    g.fillStyle = '#7a8f6a';
    g.fillRect(0, 0, 64, 48);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('mise-generate', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('photos');
      open.onerror = () => reject(new Error('could not create the old photo database'));
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('photos', 'readwrite');
        tx.objectStore('photos').put([{ id: 'old-1', blob, name: 'north wall.png' }], 'local');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(new Error('could not write the old photo'));
      };
    });
    // Point the page at the device kitchen without routing there (no hashchange), so nothing
    // writes the new keys before the reload boots the new build over the old storage.
    history.replaceState(null, '', `${location.pathname}${location.search}#/local`);
    return { keys: Object.keys(localStorage), dbs: (await indexedDB.databases()).map((d) => d.name) };
  }, kitchenDocFor(kitchenName));
}

function kitchenDocFor(name) {
  return { ...kitchenDoc(name), version: 2 };
}

export default [
  // ── The name, as a person sees it ───────────────────────────────────────
  {
    name: 'rename-landing',
    path: '#/',
    as: 'anon',
    waitFor: ['a[href="#/signin"]', '.wordmark'],
    expectText: ['BluModel Studio'],
    check: async (h) => {
      await titleAndMeta(h);
      await wordmarks(h, 'BluModel Studio');
      await noSideScroll(h);
    },
  },
  {
    name: 'rename-landing-360',
    path: '#/',
    as: 'anon',
    viewport: PHONE_360,
    waitFor: ['a[href="#/signin"]', '.wordmark'],
    check: async (h) => {
      await wordmarks(h, 'BluModel Studio');
      await noSideScroll(h);
    },
  },
  {
    name: 'rename-signin-360',
    path: '#/signin',
    as: 'anon',
    viewport: PHONE_360,
    waitFor: ['input[type="password"]', '.wordmark'],
    expectText: ['New to BluModel Studio?'],
    check: async (h) => {
      await wordmarks(h, 'BluModel Studio');
      await noSideScroll(h);
    },
  },
  {
    name: 'rename-pricing-360',
    path: '#/pricing',
    as: 'anon',
    viewport: PHONE_360,
    waitFor: ['.wordmark'],
    check: async (h) => {
      await wordmarks(h, 'BluModel Studio');
      await noSideScroll(h);
    },
  },
  {
    name: 'rename-home-360',
    path: '#/',
    as: 'customer',
    viewport: PHONE_360,
    waitFor: ['.home', '.wordmark'],
    check: async (h) => {
      await noSideScroll(h);
      // Whichever the bar has room for; never wrapped or cut off.
      const text = await h.evaluate(() => document.querySelector('.home-bar .wordmark')?.innerText.trim());
      await wordmarks(h, text === 'BluModel' ? 'BluModel' : 'BluModel Studio');
    },
  },
  {
    name: 'rename-editor-topbar-1440',
    path: '#/local',
    as: 'anon',
    viewport: { w: 1440, h: 900 },
    waitFor: ['.topbar', '.topbar .wordmark'],
    check: async (h) => {
      await titleAndMeta(h);
      await wordmarks(h, 'BluModel Studio');
      await topbarFits(h);
      await nameHasRoom(h, 150);
    },
  },
  {
    name: 'rename-editor-topbar-1366',
    path: '#/local',
    as: 'anon',
    viewport: { w: 1366, h: 768 },
    waitFor: ['.topbar', '.topbar .wordmark'],
    check: async (h) => {
      await wordmarks(h, 'BluModel');
      await topbarFits(h);
      await nameHasRoom(h, 150);
    },
  },
  {
    name: 'rename-editor-topbar-1100',
    path: '#/local',
    as: 'anon',
    viewport: { w: 1100, h: 800 },
    waitFor: ['.topbar', '.topbar .project-name'],
    check: async (h) => {
      await markOnly(h);
      await topbarFits(h);
      await nameHasRoom(h, 140);
    },
  },
  {
    name: 'rename-editor-topbar-390',
    path: '#/local',
    as: 'anon',
    viewport: 'phone',
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await topbarFits(h);
      await noSideScroll(h);
      await markOnly(h);
    },
  },
  {
    name: 'rename-editor-topbar-360',
    path: '#/local',
    as: 'anon',
    viewport: PHONE_360,
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await topbarFits(h);
      await noSideScroll(h);
      await markOnly(h);
    },
  },
  {
    name: 'rename-editor-topbar-landscape',
    path: '#/local',
    as: 'anon',
    viewport: 'phone-landscape',
    waitFor: ['.topbar', '.plan-view canvas'],
    check: async (h) => {
      await topbarFits(h);
      await noSideScroll(h);
      await wordmarks(h, 'BluModel');
    },
  },
  {
    name: 'rename-billing',
    path: '#/account/billing',
    as: 'customer',
    waitFor: ['.wordmark'],
    check: async (h) => {
      await wordmarks(h, 'BluModel Studio');
      await noSideScroll(h);
    },
  },

  // ── A device used before the rename keeps its work ──────────────────────
  {
    name: 'rename-device-kitchen-survives',
    path: '#/',
    as: 'anon',
    waitFor: ['a[href="#/signin"]'],
    check: async (h) => {
      const name = 'Kitchen from before the rename';
      const seeded = await seedPreRenameDevice(h, name);
      if (!seeded.keys.includes('mise-local-draft') || !seeded.dbs.includes('mise-generate')) throw new Error(`seeding failed: ${JSON.stringify(seeded)}`);
      await h.reload();
      await h.waitFor('.plan-view canvas');
      await h.waitUntil(() => document.querySelector('.topbar .project-name')?.value === 'Kitchen from before the rename', 10_000, 'the device kitchen from before the rename in the editor');
      // (Start from a photo went in the showroom pivot, and with it the photo database's move: the
      // old 'mise-generate' database is left alone now. The keys still move.)
      const r = await h.evaluate(() => ({
        local: Object.keys(localStorage).sort(),
        session: Object.keys(sessionStorage).sort(),
        draftName: JSON.parse(localStorage.getItem('blumodel-local-draft') || 'null')?.name ?? null,
        prefs: localStorage.getItem('blumodel.studio.prefs'),
      }));
      const old = [...r.local, ...r.session].filter((k) => /^mise[.-]/.test(k));
      if (old.length) throw new Error(`old keys left behind: ${old.join(', ')}`);
      if (r.draftName !== name) throw new Error(`blumodel-local-draft holds "${r.draftName}"`);
      if (!r.prefs || !r.session.includes('blumodel.exportIntent')) throw new Error(`studio prefs or the export intent didn't move: ${JSON.stringify(r)}`);
      h.note(`moved: ${r.local.join(', ')} | session ${r.session.join(', ')}`);
    },
  },
];
