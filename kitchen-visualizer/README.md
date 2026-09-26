# Mise — Kitchen Visualizer

Plan a kitchen to scale with branded cabinets, appliances and finishes, check it
against real kitchen-planning guidelines, price it, and walk through it in 3D.

```bash
cd kitchen-visualizer
npm install
npm run dev        # then open the printed URL
npm run build      # static site in dist/
```

## What it does

- **Branded catalog (~45 products).** Cabinets with industry codes and width
  options (`B24`, `W3030`, `SB36`…), ranges from 30″ induction to a 48″ pro
  with griddle, fridges, hoods, sinks, wine columns, pendants, stools, tables,
  windows, doors and decor. Each card is a front-elevation drawing tinted with
  your current cabinet finish, door style and hardware. Search with `/`.
- **Room & finishes.** Room width/length/ceiling, plus kitchen-wide choices:
  cabinet finish, door style (shaker / slab / fluted), hardware, countertop,
  backsplash, flooring and wall paint, all with procedurally generated textures
  (marble, terrazzo, herringbone, zellige, subway…). No image assets.
- **One-click layouts.** One-wall, galley, L-shape, U-shape and L + island,
  filled with real cabinet widths for your room size.
- **Architectural plan (2D).** Drag products in; backs snap to walls
  (auto-rotating to face the room) and sides click against neighbours and the
  uppers/lowers above or below. Chained wall dimensions, live distances from the
  selected piece to each wall, door swings, a scale bar, and a rendered or
  pen-and-ink drafting style. Zoom with the wheel, pan by dragging empty floor.
- **3D view.** Dollhouse cutaway that hides walls facing the camera, real window
  and door openings, countertops and tile with continuous world-space texture
  mapping, lit pendants, and camera presets (overview, eye level, elevation, top).
  Plan, 3D, or both side by side.
- **Design checks**, live, based on NKBA planning guidelines: collisions, work
  aisles (36″ minimum, 42″ recommended), the sink–cooktop–fridge work triangle,
  hood coverage, landing counter beside the range and fridge, dishwasher-to-sink
  distance, and door swings.
- **Estimate.** Itemized by product, plus countertop/backsplash/flooring areas,
  paint gallons and cabinet pulls.
- **Export.** Floor plan PNG, 3D render PNG, shopping list CSV, and a
  `.kitchen.json` project file you can re-import. Work autosaves in the browser.
- **Keyboard.** `R` rotate · `Del` remove · arrows nudge 1″ (Shift 6″) ·
  `Ctrl/⌘+D` duplicate · `Ctrl/⌘+Z` undo · `1/2/3` plan/split/3D · `F` flip hinge.

Brand names and prices are invented placeholders. Swap `src/data/catalog.ts`
and `src/data/finishes.ts` for a real, licensed product feed.

## Code map

- `src/data/` — catalog, finishes/surfaces, layout templates
- `src/lib/geometry.ts` — footprints, wall/edge snapping, overlaps, backsplash runs
- `src/lib/checks.ts` — design checks; `estimate.ts` — pricing; `textures.ts` — procedural materials
- `src/store/` — zustand store with undo/redo and persistence
- `src/components/plan/` — Konva plan; `src/components/three/` — react-three-fiber scene

Stack: Vite, React 18, TypeScript, react-konva, @react-three/fiber + drei, zustand.
