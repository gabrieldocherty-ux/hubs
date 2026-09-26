# Kitchen Visualizer

A browser-based kitchen design visualizer: set your room's real-world dimensions,
then drag branded cabinets, appliances, countertops, flooring, and fixtures onto
a scaled 2D top-down floor plan. Rotate and reposition items, switch finishes/colors,
and the layout autosaves to your browser (localStorage).

This is v1 scope: a 2D top-down planner, not a 3D renderer. The product catalog
(`src/data/catalog.ts`) uses placeholder brand names and swatch colors, not real
manufacturer data or licensed imagery — swap that file for a real product feed
when one's available.

## Running locally

```bash
cd kitchen-visualizer
npm install
npm run dev
```

Then open the printed local URL. `npm run build` produces a static production
build in `dist/`.

## How it works

- **Room setup** (top bar): enter width/length in feet+inches; the floor plan
  scales to fit.
- **Catalog** (left sidebar): drag any item onto the floor plan to place it.
- **Floor plan** (center): click an item to select it, drag to reposition
  (snapped to stay inside the room walls).
- **Properties** (right sidebar): rotate the selected item 90° at a time, pick
  a finish/color, or remove it.

State (room size + placed items) persists automatically via `zustand`'s
`persist` middleware, keyed to `kitchen-visualizer-design` in localStorage.

## Stack

Vite + React + TypeScript, `react-konva`/`konva` for the 2D canvas, `zustand`
for state + persistence. No backend — everything runs client-side.

## Not yet built

- 3D/elevation views
- Real product data, pricing, or a materials/brand API integration
- Collision detection between placed items
- Export (image/PDF) of the finished layout
