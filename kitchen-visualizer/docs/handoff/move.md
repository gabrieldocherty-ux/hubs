# Handoff: easy move (gesture QA and fixes)

Gabe's requirement: **"I SHOULD BE ABLE TO MOVE ITEMS AROUND EASILY ON COMPUTER AND MOBILE".**
This package drove real mouse and touch gestures against the built app, read every piece's
x / y / rotation from the store before and after each gesture, and fixed what failed.

Owned paths: `src/components/plan/**`, `src/components/three/Interact*`,
`src/components/{MobileShell,MobileState,MobileGeometry,Sheet,SelectionToolbar,CatalogPanel}.tsx/.ts`,
`src/lib/interaction.ts`, `src/components/move.css` (new; imported by `MobileShell.tsx` and
`SelectionToolbar.tsx`), `scripts/qa/routes/move.mjs`, this note. Branch `mise/qa`, port 8817.

## What shipped

| Commit | What |
| --- | --- |
| `2e6cf2c` | **Phone editor and selection toolbar styled** (they had no CSS at all). Phone: full-screen canvas over a fixed, safe-area-aware bottom bar (48px targets; 44px on a phone on its side); Add / Room / Details are real bottom sheets (fixed, handle, half 54vh / full, swipe down, backdrop that closes on tap, never inline), a right-hand panel when the screen is under 520px tall, centred on tablets; the tap-to-place banner floats over the canvas. Desktop and phone: the selection toolbar is a compact floating icon pill at the spot the component computes (above the piece, flips below, clamped to the canvas, hidden mid-drag). Also styles the catalog drag ghost and the drop-target outline. Removed the three core `knownIssue` markers this fixed (`local-phone`, `kitchen-open-phone`, `kitchen-selection-toolbar`). |
| `75bff3b` | **A finger drag in 3D stopped after 3-8 inches.** A finger is implicitly captured to the `<canvas>` it lands on; moving the capture to the canvas wrapper fires the canvas's `lostpointercapture`, which bubbles to the wrapper, where `InteractDrag` took it as its own capture being lost and ended the drag. Now only a `lostpointercapture` on the element it captured ends the drag. Mouse drags were never affected (no implicit capture). |
| `8f942f0` | **A tap right after flicking a sheet closed was swallowed.** The head is `touch-action: none`, but the browser still built a scroll gesture and, after a quick flick, a fling; the next tap only stopped the fling. Measured in headless Edge: 6 of 6 taps on the bar lost 300 ms after the flick, 3 of 6 after 1 s, none after 2.5 s or after a slow drag. The head now cancels its own `touchmove` while dragged (as the plan canvas already does): 12 of 12 taps land. |
| `326634c` | **A swipe across the top or bottom bar left the editor.** In Edge with touch, a quick sideways swipe that started on a bar (not the canvas) ran the browser's swipe-back to the previous page. `html:has(.app)` (and its body) get `overscroll-behavior: none`, which also stops Android's pull-to-refresh reloading the editor. Applies to the desktop editor too (touch laptops). |
| `8337c1c` | Phone placing banner read "Tap the plan or floor to place Counter…", cutting the product name; it reads "Tap to place **Counter Stool**" on phones now. The catalog search's clear button was the browser's blue cross; drawn in the app's ink. |
| `fafdcea` | `scripts/qa/routes/move.mjs`, 19 routes (below). `PlanView` exposes, under `?qa` only, its view and room/screen conversion; `InteractDrag` (in `75bff3b`) the 3D equivalent and the camera state. |
| `d850570`, `1120124` | Two more routes (21 now): a **wall cabinet and a window dragged along the wall in 3D** (mouse and finger). These use the wall-surface path in `InteractDrag`, which no route covered before. `move-phone-3d` also checks that the **toolbar hides during a finger drag in 3D**. Both passed first time: no app change was needed. |
| `2b60190` | The wall-piece routes also drag the wall cabinet **round the corner** from the north wall onto the west wall (mouse and finger). It lands on the west wall facing into the room (x 6 at 270°), under the pointer, camera still, one undo step. Passed first time. |
| `c5ee4ea` | Two more routes (23 now): **3D on a phone on its side (844×390) and on a tablet (820×1180)**, both with a finger. Tap to select, toolbar above the piece and hidden mid-drag, wall cabinet along the wall and round the corner; on the tablet also Rotate / Duplicate / Delete in 3D, the window along the wall, and a card dragged from the Add sheet onto the 3D floor. Passed first time. |
| `4115206` | **A press in the hole of a doorway didn't grab it in 3D.** A press in the middle of a cased opening (it has no leaf), between French doors or past an open door's leaf hit whatever was beyond the wall. A drag from there orbited the camera instead of moving the doorway. A click selected whichever opening's backdrop happened to be drawn first: in the QA kitchen, a click in the middle of the cased opening selected the door beside it. `InteractDrag` now also checks whether the ray went through a flush opening's hole before the nearest surface (`rayThroughOpening` in `InteractMath.ts`, 4 unit tests). A click or tap there selects that opening. New routes `move-desktop-3d-doors` and `move-phone-3d-doors` (25 now): both **fail on the previous build** ("a click in the middle of mv-open selected mv-door") and pass now. |
| `05e9c63` | **A pen tap that lifted a few px off nudged the piece in 3D.** 3D treated a pen as a mouse (4px before a press becomes a drag), so a stylus tap that lifted 5px from where it landed moved the island 1.5″ and added an undo step. The plan already gives a pen 6px (`usePlanGestures`); `InteractDrag` now does too. New route `move-tablet-pen` (26 now): it **fails on the previous build** at the 3D wobble tap and passes now. |
| `4330935` | **A quick tap on a catalog card could arm nothing on a busy page.** Tap or hold was decided by a wall-clock timer (`HOLD_MS`, 280 ms) racing the pointer events. On a slow phone drawing the 3D view, a frame of a second or more queues both: the timer ran first and turned a 60 ms tap into an empty drag (the card never armed), and a held finger's first move was taken for a scroll. `pressProduct` now compares each event's own `timeStamp` with the pointerdown's, and a tap that the late timer began as a drag finishes as the tap it was (adds, or arms on a phone). Seen for real under `--swiftshader`: a 3D tap-to-place card tap that reached the page 365 ms late, with the up event ~700 ms after the down in wall-clock time, armed the stool. |
| `1a66a8f`, `9586fde` | QA only: `openSheet`, `sheetGone`, the toolbar checks and `pick3d` wait for finished slides and drawn 3D frames instead of fixed sleeps, and the touch `tap` sends explicit event timestamps (60 ms apart). `Input.dispatchTouchEvent` returns only when the renderer has handled the event, so under `--swiftshader` a "50 ms" tap lasted 415 ms of event time, the app rightly read it as a press-and-hold, and `move-phone-tap-to-place` failed with "armed null". With the timestamps it passes; the app was not at fault. |

## QA routes (`node scripts/qa.mjs --pkg move --port 8817`)

Every route loads a fixed 200″ × 156″ test kitchen into `#/local` (north run, a lone base at the
east end, an 84″ island; the wall-piece routes add a wall cabinet and a window on the north wall,
the doorway routes a 32″ door and a 48″ cased opening in the west wall),
then presses exactly on pieces via `window.__miseQA.plan.toClient` /
`scene3d.toClient`. Mouse on desktop 1440×900; touch (CDP touch events with touch emulation) on
phone 390×844, phone on its side 844×390 and tablet 820×1180; a pen (CDP mouse events with
`pointerType: 'pen'`) on the tablet.

- **Pen on a tablet** (`move-tablet-pen`): the route first checks the app really received
  `pointerType "pen"`, so it can't silently test a mouse. Then: a tap selects; a tap that lifts
  5px off selects only, in the plan and in 3D; plan drag, snap and undo; pan on empty floor;
  toolbar placement, hidden mid-drag, Rotate / Duplicate / Delete; catalog drag onto the plan and
  onto 3D; 3D drag of the island and of the wall cabinet; orbit on empty 3D floor.

- **Plan drag** (mouse, phone, side, tablet finger and pen): the island lands where the pointer says (±1.5″), a
  base dragged near the wall snaps flush to it (y 12) and edge to edge with its neighbour (x 162),
  exactly one undo step, and one undo (Ctrl+Z, the Undo button, or a tap on it) restores everything.
- **Tap / click without moving** selects only: no move, no undo step. Click on empty floor deselects.
- **Pinch** over the island zooms ≥1.8× with the point under the fingers fixed; **two-finger pan**
  moves the view by the fingers' travel (±3px) at the same scale; nothing moves, the page doesn't
  scroll, scroll sideways or browser-zoom. **One finger / mouse on empty floor pans** (±2px), keeps
  the selection. **Wheel** zooms at the pointer.
- **3D drag** (mouse, phone, side, tablet): the island's grabbed point ends ≤10px from the release
  point (0-4px measured), it doesn't rotate, the camera moves 0, controls are re-enabled, one undo
  step. **Drag on empty 3D floor orbits** and moves nothing. Pinch in 3D zooms the camera.
- **3D drag of wall-hung pieces** (mouse, phone; finger on a phone on its side and a tablet): a
  wall cabinet and a window, each pressed on its face and dragged sideways, slide along the north
  wall to the aimed x (±2″; measured 126.2-126.5 for 127, and exactly 90 for the window). They
  stay on the same wall at the same rotation, end ≤12px from the pointer (0-2.1px measured), the
  camera moves 0, there is one undo step and nothing else moves. The wall cabinet dragged **round
  the corner** onto the west wall turns to face the room (x 6 at 270°), under the pointer.
- **3D doorways** (mouse, phone): a click or tap in the **middle of the hole** of a cased opening
  and of a door (not on the trim) selects that doorway and moves nothing; a drag from there slides
  it along the west wall to the aimed y (exact), same wall and rotation, 0px from the pointer,
  camera still, one undo step, one undo restores.
- **Catalog drag** onto the plan and onto 3D (mouse on desktop, touch-and-hold on the phone and
  the tablet):
  the piece lands at the drop point (±1″), selected, one undo step, the ghost is gone, the sheet
  is closed; dropped back on the catalog adds nothing.
- **Phone tap-to-place** in plan and 3D: tapping a card arms it and closes the sheet, the banner
  floats over the canvas with the full name and Cancel, no toolbar while placing, a tap places at
  that point (±1″) and disarms; Cancel disarms and a later tap places nothing.
- **Selection toolbar** placement in plan and 3D (mouse, phone, side, tablet finger and pen):
  fixed, ≤260×64px, 4-20px above (or below) the piece and centred on it unless clamped, inside the
  canvas, never under the bottom bar, hidden while dragging and back after (mouse, finger and pen,
  plan and 3D); Rotate, Duplicate, Delete each do exactly one thing (desktop plan and 3D with the
  mouse, phone plan and 3D and tablet 3D with a finger, tablet plan with a pen); flips below a piece at the top edge; stays on the
  canvas for a piece half off the left edge; steps aside while the Details sheet is open.
- **Phone sheets**: Add opens at half height right above the bar, full width; dragging the handle
  up makes it full; the close button, a tap on the backdrop, a flick down on the handle, the bar
  button again, and Escape each close it; closed sheets are invisible and inert; no sideways
  overflow; the shell is intact afterwards. On its side: a right-hand panel, swipe right closes.
- **Swipes on the bars** (right/left across the top and bottom bars, a pull down from the top bar)
  stay in the editor; nothing moves.
- **Desktop keyboard**: R, arrows, Shift+arrows, Ctrl+D, Delete, Ctrl+Z, Ctrl+Shift+Z, Escape, 1/3
  (views), `/` (search).
- **Reload in `#/local`** keeps the moved piece (also when reloaded straight after the drag):
  **known issue**, see request 1.
- The runner fails any route on a console error or uncaught exception; none occurred.

## Last run

2026-10-08, on `dist/` freshly built from the app code of `4330935` (the later commits only
touch `move.mjs` and this note), Edge 154 / Chrome 154:

- `node scripts/qa.mjs --pkg move --port 8817`, Edge, GPU (ANGLE D3D11): **PASS: 24 passed, 2 known
  issues, 0 failed** (26 routes). The 2 known issues are the reload routes (request 1).
- The same with `--chrome` (Chrome 154.0.8037.99): **PASS: 24 passed, 2 known issues, 0 failed.**
- The same with `--swiftshader --timeout 40000` (software WebGL, frames of seconds in 3D), after
  the `4330935` / `9586fde` fixes: **PASS: 24 passed, 2 known issues, 0 failed.** The first
  software-WebGL run, before the tap timestamps, **failed** `move-phone-tap-to-place` (see the
  table): QA harness latency, not an app fault.
- `node scripts/qa.mjs --pkg core --port 8817`: **PASS: 38 passed, 2 known issues, 0 failed**
  (40 routes; `local-topbar-fits` and `home-signed-in-phone`, both in `docs/handoff/qa.md`, not
  move's). `local-phone`, `kitchen-open-phone` and `kitchen-selection-toolbar` pass with no marker.
- Request 1's diff, re-checked on this HEAD: built from a scratch copy (the worktree untouched)
  and run with `--dist`, both reload routes **pass** (the runner then fails them only for the
  stale `knownIssue` marker, as designed). `useAutosave.ts` has not changed since `0b57b37`.
- `npx tsc --noEmit -p tsconfig.json` clean; `npm test` 63/63 TS tests, 71/72 server tests
  (1 skipped: the real-`mise.db` upgrade test); `npm run build` succeeds (the usual >500 kB
  chunk warning).

Screenshots in `.qa/move/` and `.qa/core/`. Looked at on this build: move
`move-phone-sheets--add-half` and `--add-full`, `move-phone-toolbar--island`,
`move-phone-3d--selected`, `move-phone-tap-to-place--placing-3d`, `move-landscape--panel`,
`move-tablet--sheet`, `move-desktop-toolbar-3d--island`. Earlier builds: core
`kitchen-open-phone` and `kitchen-selection-toolbar`, `move-tablet-pen--pen-3d`, phone sheets
(Room), tap-to-place in plan, the desktop toolbar in plan.

## Requests for the integration pass (files I don't own)

1. **A moved piece is lost on reload in `#/local`** (routes `move-desktop-persist-reload`,
   `move-phone-persist-reload`). `src/hooks/useAutosave.ts`, device-only branch: the subscriber
   returns while `dragging`, and a drag ends with `dragging → false` and `doc` unchanged since the
   last move, so no save is ever scheduled for where the piece landed. Worse, a timer left over
   from an earlier change can fire mid-drag and save a half-dragged position (the routes caught
   the island saved 2 mouse-steps into its drag). The account branch already handles this
   (`prev.dragging && !s.dragging`). Suggested diff (verified: applied on a side build, both routes
   pass, including a reload 0 ms after the drag; typecheck clean; then reverted):
   ```diff
        if (!projectId) {
   +      const save = () => {
   +        window.clearTimeout(timer);
   +        // Never mid-drag: the drag's end schedules the save of where the piece landed.
   +        if (!useDesignStore.getState().dragging) saveLocalDraft(useDesignStore.getState().doc);
   +      };
          const unsub = useDesignStore.subscribe((s, prev) => {
   -        if (s.doc === prev.doc || s.dragging) return;
   +        if (s.dragging) return;
   +        // A drag ends with dragging -> false and the doc unchanged since its last move.
   +        if (s.doc === prev.doc && !prev.dragging) return;
            window.clearTimeout(timer);
   -        timer = window.setTimeout(() => saveLocalDraft(useDesignStore.getState().doc), 400);
   +        timer = window.setTimeout(save, 400);
          });
   +      // A reload or a closed tab within the 400 ms still keeps the last change.
   +      window.addEventListener('pagehide', save);
          return () => {
            unsub();
   +        window.removeEventListener('pagehide', save);
            window.clearTimeout(timer);
            saveLocalDraft(useDesignStore.getState().doc);
          };
   ```
   Then delete `knownIssue: PERSIST_BUG` from both routes in `scripts/qa/routes/move.mjs` (and the
   `PERSIST_BUG` constant); the runner fails the run until you do. The signed-in path has the same
   mid-drag-timer weakness in `flush()` (it saves whatever `doc` is when the 1.2 s timer fires);
   consider skipping `flush` while `dragging` there too.
2. **`h.tap` in `scripts/qa.mjs` never clicks.** It sends `Input.synthesizeTapGesture`; under Edge's
   touch emulation that delivers pointerdown/touchstart/pointerup/touchend but **no click**
   (verified: a tap on the bottom bar's Room button did not open the sheet). Any route that taps a
   button with it silently does nothing. `move.mjs` uses its own `tap` (touchStart, touchEnd 60 ms
   later in event time), which does click. Suggested replacement in `inputHelpers`. The explicit
   `timestamp`s matter: `Input.dispatchTouchEvent` returns when the renderer has handled the event,
   so without them a tap on a busy page (3D under `--swiftshader`) lasts hundreds of ms of event
   time and the app reads it as a press-and-hold:
   ```js
   async tap(target) {
     const p = await pointOf(target, true);
     const t = Date.now() / 1000;
     await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 1 }], timestamp: t });
     await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t + 0.06 });
   },
   ```
   (Touch events need `Emulation.setTouchEmulationEnabled`, which the phone/tablet viewports
   already turn on.)
3. **`docs/handoff/qa.md` requests 1 and 2 are done** (phone shell and selection toolbar CSS, in
   `src/components/move.css`, commit `2e6cf2c`); drop them from that list.
4. **A window draws a blue sky rectangle above the wall in 3D.** This is not a move bug. The
   wall-piece routes found it. See `.qa/move/move-desktop-3d-wall-pieces--wall-cabinet.png` and
   `move-phone-3d-wall-pieces--wall-cabinet.png`: a pale blue slab pokes up behind the north wall
   over the window. The cause is in `src/components/three/Room3D.tsx`, `WindowModel`. The sky
   plane sits 40″ behind the wall and is `h + 70` tall (it reaches 119″ in a 108″ room). From the
   raised overview camera, the line of sight over the wall top drops ~25″ within those 40″, so
   anything behind the wall above about 80″ shows over it. `DoorModel` has the same pattern
   (44″ back, `h + 40` tall, top at 106″). The plane is visible only through the opening anyway,
   so put it just behind the wall and size it to the hole (the casing hides the 1″ margin).
   I applied this on a side build: the slab is gone in both screenshots, the sky still shows
   through the glass, and both wall-piece routes still pass. Then I reverted it. A door was not
   checked on screen: the default cameras hide the east wall.
   ```diff
   @@ function WindowModel
   -      <mesh position={[0, y0 + h / 2, -T - 40]} material={skyMaterial()}>
   -        <planeGeometry args={[w + 90, h + 70]} />
   +      <mesh position={[0, y0 + h / 2, -T - 0.5]} material={skyMaterial()}>
   +        <planeGeometry args={[w + 2, h + 2]} />
   @@ function DoorModel
   -      <mesh position={[0, h / 2 + 6, -T - 44]} material={beyond}>
   -        <planeGeometry args={[w + 70, h + 40]} />
   +      <mesh position={[0, h / 2, -T - 0.5]} material={beyond}>
   +        <planeGeometry args={[w + 2, h + 2]} />
   ```
   This loses the little parallax of a sky 40″ away. A depth-only mask (stencil) would keep it,
   but that is more work for a flat gradient.

## Decisions (overrule freely)

- Phone banner wording is "Tap to place **{name}**"; desktop keeps "Click the plan or floor to
  place **{name}**".
- `overscroll-behavior: none` on the root applies whenever the editor is on screen, desktop too;
  it doesn't stop normal scrolling inside panels, only chaining, swipe-back and pull-to-refresh.
- Sheet sizes: half 54vh (what `Sheet.tsx` assumes), full = everything above the bar minus 56px.

## Not done, or not verified

- **No real devices.** Everything above is headless Edge with CDP touch and pen emulation. The
  lost tap after a flick and the swipe-back were seen there; the fixes are the standard ones
  (cancel `touchmove`; root `overscroll-behavior`), but iOS Safari and Android Chrome were not
  tried. A real stylus (Apple Pencil, Surface pen) was not tried either: the pen route uses CDP's
  pen pointer events, which carry no pressure or tilt. `env(safe-area-inset-bottom)` can't be
  exercised headless (no notch). `:has()` needs iOS 15.4+ / Chrome 105+; older browsers just keep
  their swipe-back.
- Chrome and Edge are both Chromium: `--chrome` passing is the same engine at another build, not
  Safari or Firefox, which were not tried (WebKit's touch and pointer-capture behaviour is the
  likeliest place for a gesture to differ).
- Software WebGL is the only slow-machine test. It showed the tap-or-hold race (`4330935`), but a
  phone's real input timing, thermals and a CPU-bound main thread were not reproduced.
- 3D wall pieces are dragged from the default overview camera only, and only along and round the
  north/west corner. A door is dragged in 3D only along the west wall; a door round a corner was
  not tried.
- Reload persistence (request 1) can't be fixed inside this package: `useAutosave.ts` is not mine.
