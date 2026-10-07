# Handoff: package D (generate), "Start from a photo"

Built 2026-10-07 on branch `mise/generate` (from `b78193a`), in the worktree
`.claude/worktrees/wf_04c76bf9-e45-5`. Gabe turned down BUILD_PLAN §8's "describe your kitchen"
("i dont like discribe your kitchen but uploading a photo and being able to model that space would
be nice"), so this package keeps D's key, directories and the `#/generate` route but builds
**Start from a photo**: a homeowner or contractor adds photos of the kitchen they have now and gets
that space modelled in Mise to redesign. There is no free-text box and no text parser anywhere.

## What shipped

1. **Golden test first** (`src/lib/generate/__tests__/templates.golden.test.ts` + fixture): the
   exact `buildTemplate` output for the 5 templates × 8 room sizes × 2 surface sets (80 cases),
   recorded before anything changed. It still passes after the refactor.
2. **Checks fixes** (`src/lib/checks.ts`), each with a regression test
   (`__tests__/checks.test.ts`):
   - hood coverage along the range's own wall axis (bug #6: the west-wall range Y 100..130 /
     hood Y 125..155 case no longer "covers");
   - landing checks measure real continuous counter (12″ + 15″ for a range, 15″ for a fridge);
   - ranges and fridges away from a wall report `info` instead of auto-passing;
   - the work triangle picks the best sink/cooktop/fridge combination (bug #28);
   - pure helpers exported (`hoodCoverage`, `landingWidths`, `bestTriangle`, `facingGap`, `alongAxis`).
3. **Declarative layouts** (`src/lib/generate/layout.ts`): `LayoutSpec` (wall runs of role slots,
   fixed gaps, flex fill, island, openings, decor), `pickProduct(role, prefs)` against the
   built-ins, `fill` / `layRun` / `prune` / `layIsland` / `buildFromSpec`. A role nothing can fill
   is skipped with a note (no `getProduct(id)!`). `templates.ts` is now five specs and reproduces
   the golden output exactly. `composeDoc` accepts a template id, a `LayoutSpec`, ready items or null.
4. **PhotoModel** (`src/lib/generate/photoModel.ts`, validator shared with the server in
   `server/llm/photoModel.mjs`): room, openings, runs, appliances, island, style (mapped to the
   closest Mise finishes), per-field confidence. `validatePhotoModel` clamps to the editor's
   ranges. `buildFromPhotoModel(model)` → a `DesignDoc` through the declarative specs and built-in
   products: pure, deterministic, with a 300-case fuzz of realistic photos building with **no bad
   checks at all** and a 60-case adversarial fuzz with no collision, poke-through, door swing or
   blocked island. Seed layouts (single wall, galley, L, U, each ± island), "measure one wall"
   rescaling, doc → model (for `#/generate?from=<id>`). Pure edit helpers in `edit.ts`.
5. **Server** (`server/routes/generate.mjs`, `server/llm/anthropic.mjs`, migration
   `generate-001-photo-refs`):
   - `POST /api/generate/photo {fileIds}`: signed-in users, 10/h/user. **503 "Photo analysis is
     not configured."** unless `ANTHROPIC_API_KEY` and `MISE_LLM_MODEL` are both set. Files the
     caller can't read are a 404; photos over 5 MB a 413 with a clear message (the server can't
     downscale without a dependency; the browser already shrinks photos to a 1600 px JPEG before
     upload). Sends base64 image blocks to the Messages API through `ctx.fetch` with structured
     output (`output_config.format` json_schema, checked against the claude-api skill; a test keeps
     the schema inside the structured-output limits), 30 s timeout, then validates and clamps.
     Junk, prose, refusals and API errors → 502 (busy → 503, timeout → 504). Logs status codes
     only, never the key, the photos or the answer.
   - `GET/PUT /api/generate/photos/:projectId`: the reference photos a kitchen was started from
     (owner only, own uploads only, cascade-deleted with the kitchen).
   - 12 server tests with a mocked fetch (valid → clamped; junk → 502; unconfigured → 503;
     another user's file → 404; key and image bytes absent from logs; timeout; rate limit; schema).
6. **UI `#/generate`** ("Start from a photo"): step 1 add 1–6 photos (drop, picker, and on phones
   **Take a photo** with `capture="environment"`), thumbnails, remove, make main. Step 2 **Check
   the space**: photos (tap to enlarge, swipe) beside a live plan you can drag labels on, and a
   form: the tape-measure prompt ("Measure one wall with a tape and enter it — the rest is scaled
   from it."), room in ft-in or cm, layout picker that seeds runs, cabinet runs, appliances,
   windows and doors, island, style swatches. With analysis it pre-fills everything and flags
   low-confidence fields ("Check this" / "Looks right", a jump list at the top); without it the
   same form starts from a typical L-shape and the photos are the reference. Step 3 **Build my
   kitchen**: signed in → `api.createProject` + photos attached → `#/k/:id`; signed out →
   `saveLocalDraft` + photos in IndexedDB → `#/local` (asks before replacing the device kitchen).
   Signed-out users can do everything on the device; reading the photos for them needs a free
   account, and the screen offers one. The draft survives a reload or signing up halfway.
   Mobile-first; checked at 390×844.
7. **PhotoReference** (exported from `src/features/generate/index.ts`): a floating, collapsible,
   draggable "Your photos" viewer for the editor (lazy, inside its own Suspense, renders nothing
   when the kitchen has no photos; position remembered per browser; Remove detaches the photos).
8. **Wizard**: SetupWizard step 1 has a "Start from a photo of my kitchen" option → `#/generate`.
   The four existing steps are unchanged (the golden test covers the template output).
9. **QA routes** `scripts/qa/routes/generate.mjs` (12 routes, §3.7 format). No route reaches
   Anthropic: the QA server has no keys.

## Requests for the integration pass (files D doesn't own)

1. **Mount the photo reference in the editor** (`src/App.tsx`). Tested with exactly this diff in a
   throwaway build (not committed); the `editor-photo-reference` QA route fails until it lands:

   ```diff
   -import { GenerateScreen } from './features/generate';
   +import { GenerateScreen, PhotoReference } from './features/generate';
   @@ if (route.name === 'local')
            <LocalEditor />
   +        <PhotoReference />
            <BillingHost />
   @@ case 'kitchen':
   -      return <KitchenEditor key={route.id} id={route.id} add={route.add} />;
   +      return (
   +        <>
   +          <KitchenEditor key={route.id} id={route.id} add={route.add} />
   +          <PhotoReference key={`ref-${route.id}`} projectId={route.id} />
   +        </>
   +      );
   ```

   Don't mount it on `#/s/:token` share views: the photos are private to the owner (the GET is a
   404 for anyone else, so it would render nothing anyway).
2. **Phone position of the closed "Photos" pill**: it sits at `right: 12px; bottom: 84px` to clear
   a bottom tab bar. The editor's phone shell has **no CSS on this branch** (see below), so I could
   not check the clearance; adjust `.photo-ref, .photo-ref-pill` in the `max-width: 900px` block of
   `src/features/generate/generate.css` once the shell is styled (D will happily take a request).
3. **Duplicating a kitchen** (`server/routes/projects.mjs`, F): the copy doesn't carry the
   reference photos. If it should, copy the `generate_photo_refs` row for the new id in the
   duplicate handler (`INSERT INTO generate_photo_refs (project_id, user_id, file_ids, updated_at)
   SELECT ?, user_id, file_ids, ? FROM generate_photo_refs WHERE project_id = ?`).
4. **Deploy/README** (not D's files): to switch analysis on, set `ANTHROPIC_API_KEY` and
   `MISE_LLM_MODEL` (suggest `claude-opus-5-5`; the request works with any current vision model
   that supports structured outputs). `/api/config.llm` already reports it.
5. **External requests in QA** (F): `index.html` loads Google Fonts, so every route the §3.7
   runner checks will see requests to `fonts.googleapis.com` / `fonts.gstatic.com`. Self-host the
   fonts or let the runner allow them.

## Deviations from the plan

- §8's text brief, parser, enumerator, scorer, worker, "Improve with AI" and the wizard's
  *Generate options* tab were not built: replaced by the photo flow above. `POST
  /api/generate/brief` doesn't exist; `POST /api/generate/photo` and `/api/generate/photos/:id` do.
  `GenerateBrief` in `src/types/platform.ts` is unused by D (left for the owner to remove).
- `#/generate?q=` is still accepted (route contract) and ignored. `from=<projectId>` re-opens an
  account kitchen in Check the space with its photos.
- QA-only URL parameters on `#/generate` (only with `?qa` in the page URL): `qaPhotos=synth:N` or
  `qaPhotos=<fileId>,…`, and `qaStep=space`. `window.__miseQa.generate` exposes the model and the
  photo count.

## Verified, and how

- `npx tsc --noEmit -p tsconfig.json`: clean. `npm test`: TS 103/103, server 82 passed +
  1 pre-existing skip (no real `mise.db` to copy). `npm run build`: OK.
- QA routes run with a stand-in runner (the real `scripts/qa.mjs` isn't on this branch) against
  the built app on port 8815 with a temp DB, headless Edge over CDP, desktop 1440×900 and phone
  390×844 @3x with touch: **11/12 pass**; `editor-photo-reference` fails only because of request 1
  (passes with the diff applied). Zero console errors; no external requests apart from the Google
  Fonts above.
- The analysis path was exercised end to end with the real server and a **mocked** fetch (canned
  answer, nothing left the machine): reading spinner → pre-filled form → 5 "Check this" flags →
  jumping to one lands it below the sticky plan on a phone → Build → `#/k/:id` with the room, runs,
  appliances and the photo attached.
- Screenshots looked at: both steps at desktop and phone, lightbox, the editor after Build
  (layout passes every design check), the reference panel dragged / collapsed / reopened / enlarged.

## Not done, or not verified

- **No real Anthropic call has ever been made.** How well a real model reads real kitchen photos
  (wall lengths, offsets) is unknown until someone runs it with a key. The flow is built so that
  doesn't matter much: one tape-measured wall rescales everything, every field is editable, and
  low-confidence fields are flagged.
- **Pre-existing, not D's:** the editor's phone layout (`MobileShell` / `Sheet`) has no styles on
  this branch, so `#/local` and `#/k/:id` on a phone render the sheets as unstyled stacked text
  (`.sheet`, `.sheet-head`, `.app--compact` match no CSS rule anywhere in `src`). D's own screens
  are fine on phones.
- No seed (D needs no demo data). HEIC photos open only where the browser can decode them
  (Safari); elsewhere the screen says how to switch an iPhone to JPEG.
- An island the photos show is left out (with a note in the form) when 36″ walkways don't fit,
  because Mise's island is a fixed 42″ deep.
