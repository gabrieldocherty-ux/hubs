# Mise — kitchen visualizer: project context

A web app for Gabe: enter a room's dimensions, drag in branded cabinets, appliances and finishes, check the layout against kitchen-planning guidelines, price it, and see it in 2D plan, 3D and wall elevations. Accounts, saved kitchens, a setup wizard and autosave are built. This is the **active project** in this repo; the trading bot one level up is halted (see `../CLAUDE.md`).

Start a new session by reading `HANDOFF.md` in this folder: current state, what's unfinished, and the next steps in priority order. `README.md` covers features and how to run it.

## Run it

```bash
npm install
npm run api   # terminal 1: accounts + saved kitchens on :8787 (Node 22.13+, uses built-in node:sqlite)
npm run dev   # terminal 2: the app on :5173, proxies /api to :8787
```

`npm run build` runs `tsc -b` (strict, `noUnusedLocals`) then Vite. **It must pass before every commit**: it is the only automated check this project has so far. Production is `npm run build && npm start`, one process serving `dist/` and the API.

## Conventions that aren't obvious from one file

- **Units are inches everywhere.** A `PlacedItem`'s `x`/`y` is the *centre* of its footprint, measured from the west and north walls; `y` grows south. Rotation is 0/90/180/270 and names the wall the item's back sits on (0 = north, front faces south). See `src/lib/geometry.ts`.
- **Rooms are rectangles** (`widthIn` E–W, `lengthIn` N–S, `ceilingIn`).
- **Catalog and finishes are data**, in `src/data/catalog.ts` and `src/data/finishes.ts`. Brand names and prices are invented placeholders; never present them as real products.
- **All textures are procedural** (canvas, `src/lib/textures.ts`), not image files. Avoid `ctx.filter` blur and full-size PNG data URLs there: both froze the Room panel once.
- **Version pins:** `@react-three/fiber` 8, `drei` 9 and `three` 0.169 are the React-18-compatible line. Fiber 9 needs React 19, so don't bump one without the others.
- **The repo root `.gitignore` ignores every `data/` folder.** `kitchen-visualizer/.gitignore` re-includes `src/data/`. A new folder named `data` anywhere else will silently not be committed.
- The design store (`src/store/useDesignStore.ts`) owns undo/redo. Route every edit through its actions so undo and autosave see it. Autosave (`src/hooks/useAutosave.ts`) skips saving while `dragging` is true.
- **Server** (`server/index.mjs`) has no npm dependencies. Every non-GET request must send the header `X-Mise: 1` (CSRF guard; `src/lib/api.ts` adds it). Every project query is scoped to its owner. Saves carry a `revision` and get a 409 on conflict.

## Checking UI changes

Run both servers and look at the change in a browser. Check the plan, 3D and walls views if you touched shared data. Headless 3D (WebGL) is very memory-hungry under software rendering, so keep automated 3D runs short.

## Working style Gabe has asked for

Explain non-obvious choices. Report what didn't work as plainly as what did. He cares that it looks distinctive and that people would actually use it day to day.
