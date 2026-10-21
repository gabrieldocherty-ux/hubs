// Photoreal renders QA (docs/SHOWROOM_PIVOT.md §7, docs/handoff/renders.md), on the demo showroom
// at demo.localhost: the team's "Make it photoreal" in the editor end to end with the stamped demo
// renderer (qa.mjs runs the server with DEMO_RENDERS=1, never a real AI), the "being set up" state,
// visitors with visitor renders off and on, no button on the sales site, and the workspace's renders
// gallery, at 1440 and 390, light and dark.
// Run: node scripts/qa.mjs --pkg renders --port 8920

import crypto from 'node:crypto';

const views = [
  // Light said outright: without it Edge follows this machine's own setting.
  { suffix: '', viewport: 'desktop', colorScheme: 'light' },
  { suffix: '-dark', viewport: 'desktop', colorScheme: 'dark' },
  { suffix: '-phone', viewport: 'phone', colorScheme: 'light' },
  { suffix: '-phone-dark', viewport: 'phone', colorScheme: 'dark' },
];
const at = (v) => ({ viewport: v.viewport, ...(v.colorScheme ? { colorScheme: v.colorScheme } : {}) });

/** No horizontal page scroll. */
async function noSideScroll({ evaluate }) {
  const r = await evaluate(() => ({ sw: document.documentElement.scrollWidth, w: window.innerWidth }));
  if (r.sw > r.w + 1) throw new Error(`the page scrolls sideways: ${r.sw}px of content in a ${r.w}px viewport`);
}

/** Every visible control matching `sel` is at least 44 px both ways on a touch screen. */
async function touchTargets(h, sel) {
  if (h.viewport.w > 600) return;
  const small = await h.evaluate((s) => {
    return [...document.querySelectorAll(s)]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { t: (el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) };
      })
      .filter((x) => x.w < 44 || x.h < 44);
  }, sel);
  if (small.length) throw new Error(`touch targets under 44px: ${small.map((x) => `${x.t} ${x.w}×${x.h}`).join('; ')}`);
}

/** The demo showroom's ids. */
function demo(api) {
  const t = api.sql("SELECT id FROM tenants WHERE slug = 'demo'")[0];
  if (!t) throw new Error('no demo showroom: did the tenants seed run?');
  const person = (email) => api.sql('SELECT id FROM users WHERE email = ? AND tenant_id = ?', email, t.id)[0]?.id;
  return { tenantId: t.id, staff: person('demo-staff@blumodel.test'), visitor: person('demo-visitor@blumodel.test') };
}

/** A design of the staff member's own (a copy of the visitor's seeded one), made once. */
function staffDesign(api) {
  const d = demo(api);
  const name = 'Showroom meeting kitchen (QA)';
  const have = api.sql('SELECT id FROM projects WHERE user_id = ? AND tenant_id = ? AND name = ?', d.staff, d.tenantId, name)[0];
  if (have) return have.id;
  const src = api.sql("SELECT doc FROM projects WHERE user_id = ? AND tenant_id = ? ORDER BY created_at LIMIT 1", d.visitor, d.tenantId)[0];
  if (!src) throw new Error('the demo visitor has no seeded design');
  const doc = JSON.parse(src.doc);
  doc.name = name;
  const id = crypto.randomUUID();
  const t = Date.now();
  api.sql('INSERT INTO projects (id, user_id, name, client, doc, revision, created_at, updated_at, tenant_id) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)', id, d.staff, name, '', JSON.stringify(doc), t, t, d.tenantId);
  return id;
}

function visitorDesign(api) {
  const d = demo(api);
  return api.sql('SELECT id FROM projects WHERE user_id = ? AND tenant_id = ? ORDER BY created_at LIMIT 1', d.visitor, d.tenantId)[0].id;
}

/**
 * Sets how many of an account's free renders (config FREE_RENDERS, 3) are used: n = 3 uses them all,
 * so a route tests the paid path (credits, the visitor switch); n = 0 gives them all back.
 */
function freeUsed(api, who, n) {
  const d = demo(api);
  const userId = d[who];
  api.sql("DELETE FROM showroom_renders WHERE user_id = ? AND free = 1 AND id LIKE 'rn_qafree%'", userId);
  // Real free renders made by an earlier route count too: give those back as well.
  api.sql("UPDATE showroom_renders SET free = 0 WHERE user_id = ? AND free = 1", userId);
  for (let i = 0; i < n; i++)
    api.sql(
      "INSERT INTO showroom_renders (id, tenant_id, user_id, by_role, design_name, status, provider, cost_cents, free, hidden_at, created_at) VALUES (?, ?, ?, ?, 'QA free', 'done', 'demo', 0, 1, ?, ?)",
      `rn_qafree${who.slice(0, 2)}${i}${'x'.repeat(8)}`, d.tenantId, userId, who === 'staff' ? 'staff' : 'visitor', Date.now(), Date.now(),
    );
}

function visitorRenders(api, on, cap = 50) {
  api.sql("UPDATE tenants SET settings = json_set(settings, '$.visitorRenders', json(?), '$.dailyRenderCap', ?) WHERE slug = 'demo'", on ? 'true' : 'false', on ? cap : 0);
}

const press = (h, sel) => (h.viewport.w <= 600 ? h.tap(sel) : h.click(sel));

/** Opens the dialog, starts a render, waits for the demo result and checks it. */
async function renderOnce(h, { expectLine }) {
  await h.waitFor('.topbar .photoreal-btn');
  await press(h, '.topbar .photoreal-btn');
  await h.waitFor('.photoreal-dialog');
  await h.waitForText(expectLine);
  await h.waitUntil(() => !document.querySelector('.photoreal-actions .btn.primary')?.disabled, 10_000, 'the render button to be ready');
  const before = h.api.sql("SELECT COALESCE(SUM(remaining), 0) AS n FROM tenant_credit_lots WHERE tenant_id = 't_demo'")[0].n;
  await press(h, '.photoreal-actions .btn.primary');
  await h.waitFor('.photoreal-stage[data-phase="done"]', 60_000);
  const r = await h.evaluate(async () => {
    const img = document.querySelector('.photoreal-stage img');
    if (img && !img.complete) await img.decode().catch(() => {});
    const qa = window.__blumodelQa?.renders ?? {};
    return {
      w: img?.naturalWidth ?? 0,
      h: img?.naturalHeight ?? 0,
      demo: document.querySelector('.photoreal-stage')?.dataset.demo,
      tag: !!document.querySelector('.photoreal-demo-tag'),
      thumbs: document.querySelectorAll('.photoreal-gallery li').length,
      captured: qa.captured ?? null,
      finished: qa.finished ?? null,
    };
  });
  if (!(r.w >= 600)) throw new Error(`the render image didn't load (${r.w}×${r.h})`);
  if (r.demo !== '1' || !r.tag) throw new Error('the demo render isn’t labelled as a demo');
  if (r.thumbs < 1) throw new Error('the design’s gallery is empty after a render');
  if (!r.captured || r.captured.width < 600 || r.captured.bytes < 1000) throw new Error(`the captured view looks wrong: ${JSON.stringify(r.captured)}`);
  if (!(r.captured.products > 0)) throw new Error('the scene description lists no products');
  const after = h.api.sql("SELECT COALESCE(SUM(remaining), 0) AS n FROM tenant_credit_lots WHERE tenant_id = 't_demo'")[0].n;
  if (before - after !== 25) throw new Error(`a render took ${before - after} cents of credits, expected 25`);
  h.note(`captured ${r.captured.width}×${r.captured.height} ${r.captured.type} ${Math.round(r.captured.bytes / 1024)} KB, render ${r.w}×${r.h}`);
}

export default [
  // ── the team, in the editor ──────────────────────────────────────────────
  ...views.map((v) => ({
    name: `photoreal-staff${v.suffix}`,
    host: 'demo',
    as: 'showroom-staff',
    ...at(v),
    setup: async ({ api }) => {
      // The paid path: this account's free renders are used up.
      freeUsed(api, 'staff', 3);
      return { path: `#/k/${staffDesign(api)}` };
    },
    waitFor: ['.topbar'],
    timeoutMs: 90_000,
    check: async (h) => {
      await renderOnce(h, { expectLine: 'One render uses $0.25 of credits' });
      await touchTargets(h, '.topbar .photoreal-btn, .photoreal-actions .btn, .photoreal-remove, .photoreal-thumb');
      await noSideScroll(h);
    },
  })),
  ...[views[0], views[3]].map((v) => ({
    name: `photoreal-setting-up${v.suffix}`,
    host: 'demo',
    as: 'showroom-staff',
    ...at(v),
    setup: async ({ api }) => ({ path: `#/k/${staffDesign(api)}?qa-renders=setup` }),
    waitFor: ['.topbar .photoreal-btn'],
    check: async (h) => {
      const rows = h.api.sql('SELECT COUNT(*) AS n FROM showroom_renders')[0].n;
      await press(h, '.topbar .photoreal-btn');
      await h.waitForText('Photoreal renders are being set up');
      const said = await h.evaluate(() => (document.querySelector('.photoreal-dialog')?.textContent ?? '').split('Photoreal renders are being set up').length - 1);
      if (said !== 1) throw new Error(`the dialog says "being set up" ${said} times`);
      const b = await h.evaluate(() => {
        const btn = document.querySelector('.photoreal-actions .btn.primary');
        return { disabled: !!btn?.disabled, text: btn?.textContent?.trim() };
      });
      if (!b.disabled || b.text !== 'Coming soon') throw new Error(`the render button is ${JSON.stringify(b)} while renders are being set up`);
      await h.sleep(500);
      if (h.api.sql('SELECT COUNT(*) AS n FROM showroom_renders')[0].n !== rows) throw new Error('a render started while renders are being set up');
      await noSideScroll(h);
    },
  })),

  // ── visitors ─────────────────────────────────────────────────────────────
  {
    name: 'photoreal-visitor-off',
    host: 'demo',
    as: 'showroom-visitor',
    setup: async ({ api }) => {
      visitorRenders(api, false);
      // With their free renders used up, the company's switch decides.
      freeUsed(api, 'visitor', 3);
      return { path: `#/k/${visitorDesign(api)}` };
    },
    waitFor: ['.topbar .save-chip, .topbar .actions'],
    check: async (h) => {
      await h.sleep(1500);
      if (await h.evaluate(() => !!document.querySelector('.photoreal-btn'))) throw new Error('a visitor sees Make it photoreal while visitor renders are off');
    },
  },
  {
    // Every account's 3 free renders: shown even with visitor renders off, and free of credits.
    name: 'photoreal-visitor-free',
    host: 'demo',
    as: 'showroom-visitor',
    setup: async ({ api }) => {
      visitorRenders(api, false);
      freeUsed(api, 'visitor', 0);
      return { path: `#/k/${visitorDesign(api)}` };
    },
    waitFor: ['.topbar'],
    timeoutMs: 90_000,
    check: async (h) => {
      await h.waitFor('.topbar .photoreal-btn');
      await press(h, '.topbar .photoreal-btn');
      await h.waitForText('Free: 3 of 3 free photoreal renders left on your account');
      await h.waitUntil(() => !document.querySelector('.photoreal-actions .btn.primary')?.disabled, 10_000, 'the render button to be ready');
      const before = h.api.sql("SELECT COALESCE(SUM(remaining), 0) AS n FROM tenant_credit_lots WHERE tenant_id = 't_demo'")[0].n;
      await press(h, '.photoreal-actions .btn.primary');
      await h.waitFor('.photoreal-stage[data-phase="done"]', 60_000);
      await h.waitForText('Free: 2 of 3 free photoreal renders left on your account');
      const after = h.api.sql("SELECT COALESCE(SUM(remaining), 0) AS n FROM tenant_credit_lots WHERE tenant_id = 't_demo'")[0].n;
      if (after !== before) throw new Error(`a free render took ${before - after} cents of the company's credits`);
      await h.shot('free');
    },
  },
  ...[views[0], views[3]].map((v) => ({
    name: `photoreal-visitor-on${v.suffix}`,
    host: 'demo',
    as: 'showroom-visitor',
    ...at(v),
    setup: async ({ api }) => {
      visitorRenders(api, true, 50);
      freeUsed(api, 'visitor', 3);
      return { path: `#/k/${visitorDesign(api)}` };
    },
    waitFor: ['.topbar'],
    timeoutMs: 90_000,
    check: async (h) => {
      try {
        await renderOnce(h, { expectLine: 'left today on this showroom' });
        const text = await h.evaluate(() => document.querySelector('.photoreal-dialog')?.textContent ?? '');
        if (/\$24|credits left|balance/i.test(text)) throw new Error('a visitor is shown the showroom’s credit balance');
        await touchTargets(h, '.topbar .photoreal-btn, .photoreal-actions .btn, .photoreal-remove, .photoreal-thumb');
        await noSideScroll(h);
      } finally {
        visitorRenders(h.api, false);
      }
    },
  })),

  // ── the sales site has no renders ────────────────────────────────────────
  {
    name: 'photoreal-not-on-sales-site',
    path: '#/local',
    as: 'customer',
    waitFor: ['.topbar'],
    check: async (h) => {
      await h.sleep(1500);
      const r = await h.evaluate(() => ({ btn: !!document.querySelector('.photoreal-btn'), calls: performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/renders')).length }));
      if (r.btn) throw new Error('Make it photoreal shows on the sales site');
      if (r.calls) throw new Error(`the sales site asked /api/renders ${r.calls} times`);
    },
  },

  // ── the workspace's renders ──────────────────────────────────────────────
  ...views.map((v) => ({
    name: `workspace-renders${v.suffix}`,
    host: 'demo',
    as: 'showroom-owner',
    path: '#/studio/renders',
    ...at(v),
    waitFor: ['.rn-gallery[data-configured="1"]', '.rn-item img'],
    check: async (h) => {
      // The thumbnails load lazily: bring the gallery into view, then every thumbnail on screen must load.
      await h.evaluate(() => document.querySelector('.rn-item')?.scrollIntoView({ block: 'start' }));
      await h.waitUntil(
        () => {
          const shown = [...document.querySelectorAll('.rn-item img')].filter((i) => {
            const r = i.getBoundingClientRect();
            return r.bottom > 0 && r.top < window.innerHeight;
          });
          return shown.length > 0 && shown.every((i) => i.complete && i.naturalWidth > 0);
        },
        15_000,
        'the render thumbnails on screen',
      );
      const n = await h.evaluate(() => document.querySelectorAll('.rn-item').length);
      if (n < 4) throw new Error(`the workspace gallery shows ${n} renders, expected the ones made above`);
      const by = await h.evaluate(() => [...document.querySelectorAll('.rn-item-meta span')].map((s) => s.textContent).join(' | '));
      if (!/visitor/i.test(by)) throw new Error('the team can’t see who made a visitor’s render');
      await touchTargets(h, '.rn-item-remove, .rn-more');
      await noSideScroll(h);
      await press(h, '.rn-item-art');
      await h.waitFor('.rn-lightbox img');
      await h.waitUntil(() => document.querySelector('.rn-lightbox img')?.naturalWidth > 0, 10_000, 'the large render');
      await touchTargets(h, '.rn-lightbox-actions .btn');
      await h.shot('lightbox');
      await h.key('Escape');
      await h.sleep(200);
      if (await h.evaluate(() => !!document.querySelector('.rn-lightbox'))) throw new Error('Escape didn’t close the large render');
      await h.evaluate(() => window.scrollTo(0, document.querySelector('.rn-gallery')?.getBoundingClientRect().top + window.scrollY - 80));
    },
  })),
];
