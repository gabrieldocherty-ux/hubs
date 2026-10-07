# Handoff: package A, viewer (BUILD_PLAN §5, §13.3 A)

Built 2026-10-06/07 on branch `mise/viewer`, from `claude/gallant-ptolemy-lm7fux` at 4f0a7a6.
Owned paths only (checked with `git diff --name-only 4f0a7a6`): `src/components/three/**` (not the
`Interact*` files), `src/features/viewer/**`, `public/draco/**`, `scripts/copy-decoders.mjs`,
`server/{routes,db/migrations,seed,test}/viewer*`, `scripts/qa/routes/viewer.mjs`, this note.
`src/lib/textures.ts` and `public/env/**` were not needed and are unchanged.

## Results

| Check | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npm test` | TS 90/90 (viewer: fit, light pool, stage maths, studio, grain); server 78 pass, 1 skipped (F's upgrade test, needs `MISE_UPGRADE_DB`), 0 fail |
| `npm run build` | OK |
| `node scripts/qa.mjs --pkg viewer --port 8812` | **11/11 pass**, GPU; `--swiftshader` pass of `product-builtin`, `product-glb`, `kitchen-glb-added`: 3/3 |
| `node scripts/qa.mjs --pkg core --port 8812` on this build | 35 pass, 2 known, 3 fail; the 3 (`local-phone`, `kitchen-open-phone`, `kitchen-selection-toolbar`) are the move.css issues fixed on `mise/qa` in 2e6cf2c, not viewer code |
| Easy-move drag in 3D | still works: a pointer drag on the island moved it 40″ (scripted CDP drag, viewer build). `SceneView` keeps every `Interact*` import and usage |
| Farmhouse sink | untouched (`sinkGeo.ts`, the sink models and `lib/fronts` have no diff) |

**How QA was run:** `scripts/qa.mjs` is not on this branch yet (it is on `mise/qa`). I ran it from a
scratch tree: `git archive` of this branch with `scripts/qa.mjs`, `scripts/qa-shot.mjs` and
`server/seed/{index,core}.mjs` from `mise/qa` laid over it, serving this branch's `dist/`. At
integration it runs as-is: `node scripts/qa.mjs --pkg viewer --port 8812 --dist <dist>`.

The only non-local request any viewer route makes is Google Fonts from `index.html` (F's, already
listed as `KNOWN_EXTERNAL` in `docs/handoff/qa.md`). The viewer adds none: Draco is served from
`/draco/`, the product stage uses three's `RoomEnvironment` through PMREM, the room uses
Lightformers, and there are no drei presets, `<Stage>`, `useKTX2` or `useDetectGPU`.

## What shipped, by task

- **A-T1 decoders.** `public/draco/{draco_decoder.wasm,draco_wasm_wrapper.js,draco_decoder.js}`,
  byte-identical to three's (`node scripts/copy-decoders.mjs --check`, also a server test), with a
  `.gitattributes` so git never converts their line endings. `useGLTF.setDecoderPath('/draco/')`
  and the app's own loader both point there; Meshopt inline; KTX2 not wired.
- **A-T2 GLB in the room** (`three/gltf.tsx`, `three/fit.ts`, `renderModel` in `models.tsx`):
  per-URL cache, `clone(true)` per item, uniform min-ratio fit to the declared W×H×D, centred,
  min.y = 0, then the item's elevation; `mise_finish | mise_cabinet | mise_hardware | mise_counter`
  slots (exporter suffixes like `.001` match); only meshes ≥ 8″ cast shadows; disposal 30 s after
  the last user. A load error never throws: the procedural model is both the Suspense fallback and
  the failure state, and `ModelBoundary` catches build errors and clears the URL. QA:
  `kitchen-glb-added` (placed GLB 29.95 × 36.94 × 29.00 in for a declared 30 × 37 × 29: binding
  axis within 0.2%), `kitchen-glb-broken-fallback` (a 200 response that isn't a GLB: procedural
  range drawn, room still renders, no console error).
- **A-T3 performance** (numbers below): `frameloop="demand"`, `invalidate()` from the camera tween,
  controls, cut-away, doc/surface/catalog changes; a fixed pool of 6 pendant lights
  (`three/lightPool.ts`, assigned in item order, spare lights at intensity 0); shadow map
  `autoUpdate=false` with `needsUpdate` on change; `dpr [1, 1.5]`; `FrameGovernor` steps DPR then AO
  down after slow *interaction* runs (drei's PerformanceMonitor reads an idle demand canvas as a
  slow device, so it isn't used); no `preserveDrawingBuffer`; `castShadow` only on large parts
  (`isLargePart` in `parts.tsx`); `window.__miseQa = { canvas, frames, calls, triangles, programs }`
  with `?qa` (the last three are live getters, see "QA hooks"). Selection outlines share two
  materials instead of compiling a program per selection.
- **A-T4 room quality:** EffectComposer (MSAA 4, Canvas `antialias:false`), N8AO (half-res,
  medium, radius 1.5, intensity 2), `<ToneMapping>` last; Fast/High toggle in the 3D view, stored
  in `localStorage` (`mise.room.quality`, `mise.room.tonemap`). Wood is mapped at real scale with
  its grain along the part (`grainUV` in `geom3d.ts`: stiles, doors and cabinet sides vertical;
  rails, drawer fronts and toe-kicks horizontal; shelves along their long side), fixing bug 17.
  **Not done:** the optional companion roughness/normal canvases.
- **A-T5** `three/sceneCtx.ts` (`makeSceneCtx` pure, `useSceneCtx` for the room).
- **A-T6 `ProductStage`** (its own demand-driven Canvas): RoomEnvironment through PMREM (disposed),
  NeutralToneMapping, `ContactShadows frames={1}` redrawn when the model or size changes,
  turntable that stops on interaction, zoom limits, framing from the product's box, W/D/H
  dimension lines in ft-in and cm, physical glass transmission (stage only), built-in and GLB
  products, square stills for *Download image*.
- **A-T7 `ProductPage`** `#/p/:id?finish=`: stage, finish swatches and width chips in the URL
  (round trip checked by `product-glb-finish`, including a reload), specs table, brand link and
  Demo / Verified / Private badges, gallery, *Add to a kitchen* (your kitchens → `#/k/:id?add=`, or
  the device planner), *Buy* (`track('buy_click')`, `noopener nofollow`), *Request a custom
  version* (`#/orders/new?ref=`), *Download image* (2048 px PNG), `track('view')`, loading / 404 /
  private states, stacked under 900 px (`product-glb-phone`).
- **A-T8 + §13.3 A Studio render** (`RenderButton` in the TopBar slot, lazy `RenderDialog`): camera
  (current / overview / eye / elevation), 1080p / 1440p / 4K capped at `min(4096, maxTextureSize)`,
  High (full-resolution AO; 8× MSAA up to 1440p, 4× at 4K to keep the buffer in memory) / Fast,
  Neutral / AgX. Offscreen render via `setPixelRatio`/`setSize`
  → `composer.render()` → canvas in the same task → restore → `invalidate()`. A still of the
  *current* view from a narrow pane (split view, phone) widens to the image's aspect instead of
  shrinking the kitchen into the middle (`stillFov`). `useEntitlements(projectId).watermark` puts
  the repeated diagonal "Mise · Preview" plus a corner badge on the preview; *Download PNG* goes
  through `requestExport(projectId, 'render', …)`, downloads
  `<kitchen>-render-<w>x<h>.png`, and the full-resolution file is never watermarked. After a demo
  unlock the dialog reopens and the download resumes by itself. The `scene` exporter (TopBar 3D
  PNG) now uses the same path at 1920 × 1080, so it is no longer half width from split view
  (bug 16). QA: `studio-4k-split-free` (3840 × 2160 from split view, watermarked),
  `studio-4k-3d-entitled` (Contractor plan, no watermark, `renderStill` returns 3840 × 2160).
  Below 1200 px the button is an icon with a tooltip (the TopBar is crowded there).
- **A-T9 server:** `server/routes/viewer.mjs` and `server/db/migrations/viewer.mjs` are
  **deliberately empty** (a test asserts it). `view` / `buy_click` use F's `/api/events`.
- **A-T10:** TS tests listed above; `server/test/viewer.test.mjs` (Draco served `200
  application/wasm` from a `DIST_DIR` fixture and identical to three's; the demo GLBs are valid,
  carry `mise_*` slots and match their declared size; the seed is idempotent; `view` and
  `buy_click` are recorded with the brand). Seed `server/seed/viewer.mjs`: one fictional brand
  *Ashgrove Studio (Demo)* with two published GLBs built from real geometry, *Ashgrove 30″ Pro
  Range (Demo)* and *Ashgrove Dome Pendant (Demo)*. It runs under the seed runner (which guards
  production itself and passes `demo`, not `forceDemo`).

## Acceptance (§5) with numbers

1. **Green:** see Results. Zero console errors; zero non-local requests from viewer code.
2. **GLB at its declared footprint:** room 29.95 × 36.94 × 29.00 in vs 30 × 37 × 29 (uniform
   fit, binding axis 0.2% under); stage the same. Broken model → procedural fallback, no blank
   canvas, no uncaught error.
3. **Idle and pendant** (default L + island kitchen, `#/local`, 3D, 1440 × 900, Edge headless,
   same script on both builds; the baseline is a build of 4f0a7a6):

   | | before (4f0a7a6) | after |
   |---|---|---|
   | frames drawn while idle, 2 s | **253** | **0** |
   | draw calls per frame | 565 (shadow pass every frame) | 566 Fast / 572 High while moving (the QA runner's last-frame figure was 677 when it included a shadow-map update); 0 per second idle |
   | triangles per frame | 27,774 | 27,775–27,781 |
   | shader programs, add a pendant | 12 → 19 | 18 → 18 |
   | worst frame while adding a pendant | **1,866 ms** | **8–10 ms** |

   Honest reading: the per-frame cost while orbiting is about the same (N8AO and the composer
   add a few calls; casting fewer shadows and not redrawing the shadow map every frame take a few
   away). The gains are that an idle kitchen costs nothing and a pendant no longer recompiles every
   lit material. Instancing (bug 15's stretch goal) was not attempted.
4. **Product page:** W×D×H correct for `range-30` (30 × 28 × 36) and the seeded GLB range
   (30 × 29 × 37), checked through the cm values; swatches change the model (checked on the
   material colour) and `?finish=` round-trips through a reload; `view` and `buy_click` recorded
   (server test).
5. **Studio render:** 3840 × 2160 from split view and from 3D view (cap = `min(4096,
   maxTextureSize)`, 4096 on this GPU; the studio routes were not run under SwiftShader).
6. **Bundle** (gzip -9 of the built files; the 3D code now lives in two chunks because the product
   page shares three/R3F/drei with the room; Rollup names the shared one after a module in it, so
   it is `qaStats-*.js`):

   | chunk | before | after |
   |---|---|---|
   | room 3D total | 258.7 KB (`SceneView`, no postprocessing) | **382.3 KB** (shared 256.8 + `SceneView` 125.5, with postprocessing and N8AO) — budget 400 KB, met |
   | product page | (stub) | `ProductPage` 4.3 + `ProductStage` 13.7 + shared 256.8 |
   | `RenderDialog` (lazy) | – | 3.4 KB |
   | main `index-*.js` | 213.2 KB | **214.0 KB (+0.8 KB)** |

   The main chunk does grow by 0.8 KB: that is the `RenderButton` itself (the TopBar slot, which
   must render without a lazy load), its open-state store and the resume-after-unlock hook. Every
   heavier piece (dialog, prefs, renderer) is lazy. If that 0.8 KB matters, the hook could move
   behind the first click, at the cost of the automatic resume after a demo unlock.
7. **Tone mapping:** below.

## Tone mapping: Neutral, with the room lights retuned for it

Screenshots: `.qa/viewer/tonemap-{aces,neutral,agx}-{eye,overview}.png` (1600 × 900 offscreen
stills of the default kitchen with the GLB range in Sage), and the `tonemap-ab` QA route writes
`.qa/viewer/tonemap-ab--tonemap-{aces,neutral,agx}.png` on every run.

Measured colour error (CIE76 ΔE between the rendered pixels and the swatch, overview still,
9 × 9 px patches; lower is truer):

| | Warm Linen cabinet `#efe9dd` | Sage range `#8a9a7b` | Chalk wall `#f1ece3` | mean |
|---|---|---|---|---|
| ACES, old lights | 1.4 | 12.1 | 6.3 | 11.4* |
| AgX, old lights | 9.8 | 7.6 | 15.2 | 13.3* |
| Neutral, old lights | 12.2 | 9.7 | 9.1 | 11.8* |
| **Neutral, new lights (shipped)** | **4.9** | **5.5** | **5.4** | **7.9*** |
| AgX, new lights | 10.7 | 8.3 | 15.9 | 14.2* |
| ACES, new lights | 3.6 | 11.5 | 7.2 | 12.4* |

\* the mean includes the oak floor `#c28f61`, which is in direct sun (ΔE 16 Neutral, 22 AgX, 27 ACES).

**Decision: Neutral (Khronos PBR Neutral) stays the room default; AgX is offered in the studio
dialog; ACES remains only for this comparison.** Reasoning:
- With the original light palette, Neutral looked *worse* than ACES on white cabinets: the lights
  were warm (sun `#fff1dd`, ceiling `#ffe6c4`, pendants `#ffcf8f` at 16 cd) and ACES's desaturated,
  compressed highlights had been hiding that. Neutral shows colour as lit, so Warm Linen came out
  cream and the island top peach.
- So the lights were retuned rather than the tone mapping: near-white sun, sky and environment
  (`#fff8f0`, `#fbf9f6`, Lightformers `#fffaf3`), ceiling light `#fff1e0` at 10, pendants
  `#ffe4c4` (~3500 K) at half intensity (8, linear 13). Neutral then has the lowest error on every
  painted surface, and keeps brand colours saturated (the Sage range is ΔE 5.5 vs 11.5 under ACES,
  which washes it toward grey-green).
- AgX is the most "photographic" (soft highlights) but greys every light colour: white cabinets
  read light grey (ΔE ~10) and walls ΔE ~16. Not the default for a product whose point is showing
  a brand's real colour.
- Scaling all lights down (0.6–0.75×) to tame the sunlit floor made walls and cabinets too dark
  (ΔE 10–22), so it was not shipped. The floor stays bright where the sun hits it, as a real floor
  would.
- `?qa` plus `localStorage['mise.qa.roomLight']` (JSON) overrides any key of the palette, so the
  A/B can be re-run without a rebuild.

## Requests for other owners (not applied; for the integration pass)

1. **Billing (`src/features/billing/index.ts`):** export the paid-export intent helpers the studio
   uses to resume after a demo unlock. Today `src/features/viewer/RenderButton.tsx` imports them
   from the non-public module:
   ```ts
   // src/features/billing/index.ts, add:
   export { peekIntent, clearIntent } from './entitlements';
   ```
   then in `RenderButton.tsx` change `from '../billing/entitlements'` to `from '../billing'`.
   (Viewer may not edit billing; the import works as is.)
2. **F, `vite.config.ts` (optional, cosmetic):** name the shared 3D chunk so it isn't
   `qaStats-*.js`. Keep postprocessing out of it so the product page doesn't load N8AO:
   ```ts
   build: { rollupOptions: { output: { manualChunks(id) {
     if (/node_modules[\\/](postprocessing|n8ao|@react-three[\\/]postprocessing)[\\/]/.test(id)) return 'postfx';
     if (/node_modules[\\/](three|three-stdlib|@react-three[\\/](fiber|drei))[\\/]/.test(id)) return 'three';
   } } } }
   ```
   Re-measure the chunk sizes after it; the product page must still not fetch `postfx`.
3. **F, `index.html`:** self-host the three Google Fonts (already in `docs/handoff/qa.md`). It is
   the only non-local request on every viewer route.
4. **F, `src/styles.css`:** `.topbar .btn { white-space: nowrap; }` (already in qa.md;
   `local-topbar-fits` is KNOWN because "Sign in to save" wraps). The Render button sets
   `white-space: nowrap` inline because it lives in the main chunk without the viewer stylesheet.

## QA hooks (only with `?qa`)

- `window.__miseQa.{canvas, frames, lastFrameAt}`, plus **live getters** `calls`, `triangles`,
  `programs` on the current canvas's renderer. They used to be copied at the start of each frame,
  which left them one frame stale for as long as a demand canvas idled (the runner saw
  `programs: 1` before a pendant and 18 after). Anything that writes to `__miseQa` must mutate it
  in place (`Object.assign`), not spread a copy, or the getters freeze.
- `__miseQa.viewer = { renderStill(opts) → canvas, maxSide, setToneMap, setQuality, catalog }`
  (room); `__miseQa.stage = { get, renderStill(size) }` (product page); `__miseQa.studio` (dialog
  state). A loaded GLB's group has `userData.gltf = <url>`.

## Known issues and things not done

- **Not done:** companion roughness/normal canvases (optional in A-T4); instancing (bug 15's
  stretch goal); bug 29 for the room (room glass is still the faked emissive/opacity material; the
  product stage has real transmission); bug 30 (rug materials are cached per item seed in a
  module-global map and never disposed, a small leak in long sessions).
- N8AO logs a D3D compiler warning (`X3595: gradient instruction used in a loop`) once per page on
  Windows/ANGLE. It is a `console.warn` from the shader compiler, harmless; QA reports it as a
  warning, not a failure.
- The QA kitchen doc in `core.mjs` (and copied in `viewer.mjs`) uses `cabinetFinishId: 'white'`,
  which is not a finish id, so those kitchens render with the fallback wood finish. Harmless for
  the checks; worth fixing in both files (`'warm-white'`).
- The light palette and pendant intensities changed, so room screenshots taken before this branch
  will look warmer than the same kitchen now. That is the intended fix, not a regression.
