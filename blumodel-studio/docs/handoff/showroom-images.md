# Handoff: showroom pictures (package `showroom-visuals`)

A showroom's landing page shows real-looking pictures of finished kitchens made from the company's
own products: a hero at the top, one picture per featured line and a gallery of sample kitchens.
They are made by the app's own 3D renderer (the Studio render path), never by hand.

## Where the pictures come from

| Source | Made by | Wins |
|---|---|---|
| `render` | the generator page `#/showroom-images` on the showroom, in a browser | |
| `photo` | the company, in the workspace (Showroom tab > Showroom pictures) | always, over a render |

- **The server never renders.** Rendering needs WebGL and a GPU; the Wyse (and any headless Linux
  box) has neither. The generator runs in the browser of whoever opens it, builds each scene,
  renders it with `renderRoomStill` (an exact camera through `StillOptions.view`) and uploads each
  WebP as it is made. Request handling is never blocked.
- Who can open it:
  - the company's **team** (owner or staff), from the workspace: Showroom tab > *Generate showroom images*;
  - **an admin**, from Admin > Companies > (company) > *Generate showroom images*: the server issues a
    2-hour ticket (`POST /api/admin/tenants/:id/showroom-images`, audited, kept hashed in memory) and
    opens `https://<showroom>/#/showroom-images?ticket=…` in the admin's own browser. A ticket can
    upload renders for that one showroom only; never photos, never delete.
- The scenes (`src/features/showroom/images/scenes.ts`): the app's layout builder (`buildFromSpec`)
  with the company's lines as brand preferences, staged with finishes that suit each line (door
  style, countertop, backsplash, floor, hardware; the kitchen-wide cabinet finish matched to the
  line's), the company's own stools, and checked with the editor's design checks (`runChecks`): a
  scene with a problem is skipped, never rendered. Built-in BluModel Basics pieces stay out unless
  the company fills the gaps. Every camera stands inside the room under a ceiling (Room3D now has
  one that only shows when the camera is inside).

| Picture | Size | Notes |
|---|---|---|
| hero | 2400 × 1350 | a finished kitchen at eye level, the company's first featured cabinet line |
| heroTall | 1080 × 1440 | the same kitchen, portrait, for phones (`<picture>` media query); not used when the hero is a photo |
| line (one per line, 8 at most) | 1200 × 900 | the line installed in context (cabinets: sink-to-range run; sinks: the sink set in a counter with its faucet; appliances; lighting over an island; seating at an island; a bath line: its vanity and tower in a bathroom) |
| gallery 1-3 | 1600 × 1000 | three different kitchens: layouts, lines and finishes |

## Storage and API

Pictures are ordinary tenant files (kind image, public), so a showroom serves only its own and the
sales site never shows them. Their places are on the tenant: `branding.images` =
`{ render: Set, photo: Set, renderedAt }` (server/tenancy/images.mjs). Width and height are read
from the bytes on upload and travel with every picture so the page reserves the space.

| Method | Path | Who | |
|---|---|---|---|
| GET | `/api/showroom-images/access` | team, or `X-Showroom-Ticket` | `{ ok, via }` / 403 |
| PUT | `/api/showroom-images?slot=&line=&index=&title=&source=` | team (render or photo), ticket (render) | raw PNG/JPEG/WebP, 320 to 4096 px; `{ images, imageSources }` |
| DELETE | `/api/showroom-images?slot=&line=&source=` | team | `{ images, imageSources }` |
| POST | `/api/admin/tenants/:id/showroom-images` | admin (sales site) | `{ url, expiresAt }` |

`GET /api/config` / `/api/showroom` → `tenant.images` = `{ hero, heroTall, lines: { [lineKey]: pic },
gallery: [pic & { title, design }] }` with a photo in place of a render. `design` is a view-only link
token to open that kitchen in 3D (the demo's gallery has them). The workspace gets
`imageSources: { render, photo }` too. Photos are shrunk in the browser first (2400 px wide, WebP).

## The demo showroom: committed pictures

The demo's pictures and sample kitchens are **committed** in `server/tenancy/demo-images/` (about
720 KB of WebP plus `manifest.json` with the plans, product ids written as `sku:<SKU>`), and the
demo seed installs them. This is the robust option: the live server only copies files, so it works
on the Windows PC and the Wyse alike and needs no browser there.

- Re-make them after changing the demo catalog or the renderer (on a PC with Edge):
  ```
  npx vite build --outDir .build/vis
  node scripts/make-showroom-images.mjs --dist .build/vis --port 8987
  ```
  A throwaway server, the generator page signed in as the demo owner, the files copied out. It
  refuses to write if any scene failed or has a layout problem.
- Install or update them on the live server (also brings new/changed demo products and lines):
  ```
  node server/scripts/seed-demo-tenant.mjs
  ```
  Idempotent: a picture is replaced only when its bytes changed, a product only when its spec did.
  The gallery kitchens (with view-only links) belong to "Northline design team"
  (`demo-gallery@blumodel.test`), an account nobody can sign in to and on no team.

## Tests and QA

- `server/test/showroom-images.test.mjs`: targets, a photo over a render, access (team, ticket,
  visitor, another showroom, the sales site), isolation of the files, the admin ticket.
- `src/features/showroom/images/__tests__/scenes.test.ts`: every scene of the demo catalog is a clean
  layout of the company's own products with its camera inside the room; the committed kitchens pass
  the design checks; the committed pictures exist, are sensible sizes and compressed.
- `server/test/tenancy-demo.test.mjs`: the seed installs the pictures, every featured line has one,
  the gallery kitchens open, and a second run changes nothing.
- QA `showroom`: see scripts/qa/routes/showroom.mjs (`landing-*`, `images-*`, `demo-pitch-*`).
