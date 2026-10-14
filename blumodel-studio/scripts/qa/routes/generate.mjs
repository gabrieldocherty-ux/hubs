// QA routes for package D, "Start from a photo" (#/generate). Format: BUILD_PLAN §3.7.
//
// No route reaches Anthropic: the QA server runs without ANTHROPIC_API_KEY / BLUMODEL_LLM_MODEL, so
// /api/config.llm is false and the screen starts from its defaults (the manual flow). Headless
// runs can't drive a file picker, so the screen takes QA-only URL parameters (only when the page
// URL has `?qa`, see src/features/generate/qa.ts):
//   qaPhotos=synth:N        N drawn stand-in kitchen photos, kept on the device
//   qaPhotos=<id>,<id>      photos already uploaded through the files API (count as uploaded)
//   qaStep=space            open on "Check the space" (ignores any saved draft)
// `viewport.mobile` asks for phone emulation (390x844 @3x, touch) where the runner supports it.
import { makePng } from '../../../server/test/fixtures/images.mjs';

const DESK = { w: 1440, h: 900 };
const PHONE = { w: 390, h: 844, mobile: true, dpr: 3 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `expr` in the page until it is truthy; returns its value. */
async function until(evaluate, expr, what, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await evaluate(expr);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await sleep(150);
  }
}

/** Fetches JSON from the page (same cookies) without relying on the runner awaiting promises. */
async function fetchJson(evaluate, url) {
  const slot = `__genQa${Math.random().toString(36).slice(2, 8)}`;
  await evaluate(
    `(window.${slot} = null, fetch(${JSON.stringify(url)}, { credentials: 'same-origin' }).then((r) => r.json().then((b) => ({ status: r.status, body: b }))).catch((e) => ({ status: 0, body: String(e) })).then((v) => (window.${slot} = JSON.stringify(v))), 1)`,
  );
  return JSON.parse(await until(evaluate, `window.${slot}`, url));
}

const click = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; })()`;
const clickText = (sel, text) =>
  `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`;

async function noSideScroll(evaluate) {
  const over = await evaluate('document.documentElement.scrollWidth - window.innerWidth');
  if (over > 1) throw new Error(`the page scrolls sideways by ${over}px`);
}

/** A stand-in kitchen photo (640x480 PNG): wall, window, upper and base cabinets, a range, floor. */
export function kitchenPhoto() {
  const cab = [47, 60, 82, 255];
  return makePng({
    w: 640,
    h: 480,
    rgba: (x, y) => {
      if (y > 380) return [184, 148, 106, 255];
      if (y > 250 && y < 264) return [239, 235, 228, 255];
      if (y >= 264 && y <= 380) {
        if (x > 200 && x < 290) return [154, 160, 166, 255];
        return x % 72 < 68 ? cab : [30, 30, 30, 255];
      }
      if (y > 60 && y < 200 && x > 260 && x < 400) return [207, 224, 234, 255];
      if (y > 50 && y < 210 && (x < 230 || x > 430)) return x % 70 < 66 ? cab : [30, 30, 30, 255];
      return [233, 226, 212, 255];
    },
  });
}

/** Uploads the fixture photo as `as` (private, kind=reference); resolves its file id. */
async function uploadFixture(api, as = 'customer') {
  const r = await api.as(as).putRaw('/api/files?kind=reference&name=qa-kitchen.png', kitchenPhoto(), 'image/png');
  if (r.status !== 201 || !r.body?.file?.id) throw new Error(`fixture upload failed (${r.status})`);
  return r.body.file.id;
}

/** The model the screen is building from (QA hook). */
const MODEL = 'JSON.stringify(window.__blumodelQa?.generate?.model?.() ?? null)';

async function checkSpace({ evaluate }) {
  await noSideScroll(evaluate);
  const model = JSON.parse(await until(evaluate, MODEL, 'the QA hook'));
  if (!model.runs?.length || !model.appliances?.length) throw new Error('the starting model has no cabinet runs or appliances');
  const handles = await evaluate('document.querySelectorAll(".gen-h-app").length');
  if (handles < model.appliances.length) throw new Error(`the plan shows ${handles} appliance handles for ${model.appliances.length} appliances`);
}

/** Clicks "Build my kitchen" and waits for the editor route. */
async function build(evaluate, target) {
  if (!(await evaluate(click('.gen-footer .gen-go')))) throw new Error('no Build my kitchen button');
  // A signed-out build asks before replacing a kitchen already kept on the device.
  await sleep(400);
  await evaluate(clickText('.modal-actions button', 'Replace it'));
  return until(evaluate, `location.hash.startsWith(${JSON.stringify(target)}) && location.hash`, `the ${target} route`, 20000);
}

export default [
  // ─── Step 1: add photos ────────────────────────────────────────────────
  {
    name: 'photos-empty-desktop',
    path: '#/generate',
    as: 'anon',
    viewport: DESK,
    waitFor: '.gen-drop',
    expectText: ['Start from a photo of your kitchen', 'Skip photos'],
  },
  {
    name: 'photos-fixture-upload',
    path: '#/generate',
    as: 'customer',
    viewport: DESK,
    setup: async ({ api }) => ({ path: `#/generate?qaPhotos=${await uploadFixture(api)}` }),
    waitFor: '.gen-thumb img',
    waitMs: 500,
    expectText: ['1 of 6 photos', 'Continue'],
    check: async ({ evaluate }) => {
      const n = await until(evaluate, 'window.__blumodelQa?.generate?.photos?.()', 'the photo to load');
      if (n !== 1) throw new Error(`expected 1 photo, got ${n}`);
      await until(evaluate, '[...document.querySelectorAll(".gen-thumb img")].every((i) => i.complete && i.naturalWidth > 0)', 'the thumbnail to render');
    },
  },
  {
    name: 'photos-phone',
    path: '#/generate?qaPhotos=synth:3',
    as: 'anon',
    viewport: PHONE,
    waitFor: '.gen-thumb img',
    waitMs: 500,
    expectText: ['3 of 6 photos'],
    check: async ({ evaluate }) => {
      await noSideScroll(evaluate);
      if (!(await evaluate('!!document.querySelector(\'input[type=file][capture="environment"]\')'))) throw new Error('no camera input');
      if (!(await evaluate('!!document.querySelector("input[type=file][multiple]")'))) throw new Error('no photo library input');
    },
  },

  // ─── Step 2: check the space (manual: no photo analysis on the QA server) ──
  {
    name: 'space-manual-desktop',
    path: '#/generate?qaPhotos=synth:2&qaStep=space',
    as: 'anon',
    viewport: DESK,
    waitFor: '.gen-form',
    waitMs: 600,
    expectText: ['Check the space.', 'Measure one wall with a tape and enter it', 'Build my kitchen'],
    check: checkSpace,
  },
  {
    name: 'space-manual-phone',
    path: '#/generate?qaPhotos=synth:2&qaStep=space',
    as: 'anon',
    viewport: PHONE,
    waitFor: '.gen-form',
    waitMs: 600,
    expectText: ['Check the space.', 'Measure one wall', 'Build my kitchen'],
    check: async (ctx) => {
      await checkSpace(ctx);
      const r = await ctx.evaluate('JSON.stringify(document.querySelector(".gen-footer .gen-go")?.getBoundingClientRect())');
      const b = r && JSON.parse(r);
      if (!b || b.bottom > 844 + 1 || b.right > 390 + 1) throw new Error('Build my kitchen is off screen on a phone');
    },
  },
  {
    name: 'space-phone-photos-tab',
    path: '#/generate?qaPhotos=synth:2&qaStep=space',
    as: 'anon',
    viewport: PHONE,
    waitFor: '.gen-compare-tabs',
    expectText: ['Photos (2)'],
    check: async ({ evaluate }) => {
      if (!(await evaluate(clickText('.gen-compare-tabs button', 'Photos')))) throw new Error('no Photos tab');
      await until(evaluate, '!!document.querySelector(".gen-pane--photo.on img")', 'the photo pane');
      await noSideScroll(evaluate);
    },
  },
  {
    name: 'space-signed-in-no-analysis',
    path: '#/generate',
    as: 'customer',
    viewport: DESK,
    setup: async ({ api }) => ({ path: `#/generate?qaPhotos=${await uploadFixture(api)}&qaStep=space` }),
    waitFor: '.gen-form',
    waitMs: 600,
    // Without keys the server can't read photos, and the screen says so instead of failing.
    expectText: ['Photo analysis isn’t switched on', 'Measure one wall'],
    check: checkSpace,
  },

  // ─── Step 3: build → the editor ────────────────────────────────────────
  {
    name: 'build-signed-in-editor',
    path: '#/generate',
    as: 'customer',
    viewport: DESK,
    setup: async ({ api }) => ({ path: `#/generate?qaPhotos=${await uploadFixture(api)}&qaStep=space` }),
    waitFor: '.gen-form',
    waitMs: 400,
    check: async ({ evaluate }) => {
      const model = JSON.parse(await until(evaluate, MODEL, 'the QA hook'));
      const hash = await build(evaluate, '#/k/');
      const id = hash.slice('#/k/'.length).split(/[?/]/)[0];
      const { status, body } = await fetchJson(evaluate, `/api/projects/${id}`);
      if (status !== 200) throw new Error(`the new kitchen is a ${status}`);
      const doc = body.project.doc;
      if (doc.room.widthIn !== model.room.widthIn || doc.room.lengthIn !== model.room.lengthIn) throw new Error('the kitchen’s room does not match the checked space');
      if (doc.items.length < 8) throw new Error(`the built kitchen has only ${doc.items.length} pieces`);
      const photos = await fetchJson(evaluate, `/api/generate/photos/${id}`);
      if (photos.status !== 200 || photos.body.files?.length !== 1) throw new Error('the photo did not stay with the kitchen');
      await until(evaluate, '!!document.querySelector("canvas")', 'the editor', 20000);
      await sleep(1500);
    },
  },
  {
    name: 'build-signed-out-local',
    path: '#/generate?qaPhotos=synth:2&qaStep=space',
    as: 'anon',
    viewport: PHONE,
    waitFor: '.gen-form',
    waitMs: 400,
    check: async ({ evaluate }) => {
      await build(evaluate, '#/local');
      const n = await evaluate("JSON.parse(localStorage.getItem('blumodel-local-draft') || '{}').items?.length ?? 0");
      if (n < 8) throw new Error(`the device kitchen has ${n} pieces`);
      await until(evaluate, '!!document.querySelector("canvas")', 'the editor', 20000);
      await sleep(1500);
    },
  },
  {
    // <PhotoReference projectId /> is mounted in the editor by App.tsx (the integration pass).
    name: 'editor-photo-reference',
    path: '#/',
    as: 'customer',
    viewport: DESK,
    setup: async ({ api }) => {
      const me = api.as('customer');
      const fileId = await uploadFixture(api);
      const doc = { version: 2, name: 'QA photo kitchen', room: { widthIn: 144, lengthIn: 168, ceilingIn: 96 }, surfaces: {}, items: [] };
      const p = await me.post('/api/projects', { name: 'QA photo kitchen', doc });
      if (p.status !== 201 && p.status !== 200) throw new Error(`project create failed (${p.status})`);
      const id = p.body.project.id;
      const a = await me.put(`/api/generate/photos/${id}`, { fileIds: [fileId] });
      if (a.status !== 200) throw new Error(`attach failed (${a.status})`);
      return { path: `#/k/${id}` };
    },
    waitFor: '.photo-ref, .photo-ref-pill',
    waitMs: 1200,
    check: async ({ evaluate }) => {
      await until(evaluate, '!!document.querySelector(".photo-ref img, .photo-ref-pill")', 'the photo reference');
    },
  },

  // ─── The wizard's way in ───────────────────────────────────────────────
  {
    name: 'wizard-photo-option',
    path: '#/new',
    as: 'customer',
    viewport: DESK,
    waitFor: '.gen-wiz-photo',
    expectText: ['Start from a photo of my kitchen', 'Kitchen name'],
    check: async ({ evaluate }) => {
      await evaluate(click('.gen-wiz-photo'));
      await until(evaluate, 'location.hash.startsWith("#/generate")', '#/generate');
    },
  },
  {
    name: 'wizard-photo-option-phone',
    path: '#/new',
    as: 'customer',
    viewport: PHONE,
    waitFor: '.gen-wiz-photo',
    expectText: ['Start from a photo of my kitchen'],
    check: async ({ evaluate }) => noSideScroll(evaluate),
  },
];
