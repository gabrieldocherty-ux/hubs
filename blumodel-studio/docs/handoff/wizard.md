# New-kitchen wizard (key `wizard`)

`#/new`, `src/screens/SetupWizard.tsx`. Four steps: **Basics** (name, client, or "Start from a photo
of my kitchen" → `#/generate`), **Room** (size chips and wall-to-wall inputs), **Layout** (the five
templates or a blank room), **Brands** ("Choose your brands").

## Plain start (2026-10-15)

The colour-palette step is gone. `composeNewKitchen` (`src/data/compose.ts`) builds every new
kitchen with `PLAIN_PRESET`: `NEUTRAL_SURFACES`, no palette, the island in the cabinet finish.
Palettes (with "Plain" first) are the first section of Room & finishes (`RoomPanel`).

## Choose your brands

- Per category (Cabinets, Appliances, Sinks & faucets, Lighting): **Any** (the default) or one or
  more brands. Each chip shows the brand's product count and the stores that carry it. The list
  comes from `brandsForCategory` (`src/catalog/retail.ts`, the retail catalog, loaded as its own
  lazy chunk when the wizard opens) merged with brands that have products in the catalog registry
  (`brandOptions` in `src/lib/generate/brands.ts`). BluModel Basics is never a chip: it is what
  fills every slot no chosen brand can.
- The choices go on the kitchen as `doc.brandPrefs` (`{ cabinets?: string[], … }`), cleaned by
  `cleanBrandPrefs` on the client (`sanitizeDoc` keeps them) and `normalizeDoc` on the server
  (`server/lib/doc.mjs`: known categories, 20 names a category, 80 characters, no repeats).
- **Layout**: `buildFromSpec(spec, room, surfaces, brands)` (and `buildTemplate(…, brands)`)
  makes a `brandPicker` for the build. Each run slot, upper, hood, over-fridge cabinet, island and
  pendant first gets its BluModel Basics pick; a chosen brand's product replaces it only when it
  is the same type (kind, and variant where the variant changes the piece), sold in that width,
  hung at the same height, within 3″ of the depth (a fridge 6″), a counter-height piece within 2″
  of the height, a fridge no taller, and under the ceiling. Chosen brands win in the order chosen;
  within a brand the line and finish already used in the kitchen, else the one it sells most of,
  so the cabinets match. Geometry never changes, and `keepEveryPiece` reverts any brand piece that
  would make `prune` drop a piece the Basics build keeps. With no brands the build is exactly the
  Basics one (the golden template test is untouched).
- The preview card on the Brands step says how many pieces come from the chosen brands.
- **Add products** (`CatalogPanel`) opens with "Your brands" on when the kitchen has brand
  choices: in a category with a chosen brand in the catalog, only those brands; tapping "Your
  brands" again (or picking a brand in the Brand select) shows every brand.
- **The editor's layouts** (the blank room's L + Island / Galley / U-Shape / One Wall buttons,
  `applyTemplate` in `useDesignStore`) use the kitchen's `brandPrefs` too, so a blank room set up
  with brands fills from them when a layout is applied later.

## Phones (390 px)

Under 600 px the preview card is a compact strip (a 112 px plan beside the name and size) above
the step instead of a full-width card that pushed the step below the fold; the layouts sit two a
row; every step opens at its top (`scrollIntoView` on step change), since Continue sits at the
bottom of long steps. Brand chips are two a row with the stores wrapping under the count.

Known data gaps (the retail catalog, not the picker): IKEA SEKTION bases are listed at their 30″
box height, so they never replace a 36″ counter-height base; a few sink bases and lighting brands
have no size that fits the templates' slots, so those stay BluModel Basics.

## Tests and QA

- `src/lib/generate/__tests__/brands.test.ts`, `wizard.test.ts`, `templates.golden.test.ts`.
- `server/test/wizard-brands.test.mjs` (normalizeDoc, create/save/duplicate keep the choices).
- `node scripts/qa.mjs --pkg wizard --port 8878 --dist .build/wizard --strict-external` (7 routes,
  all passing 2026-10-15):
  - `wizard-steps`: four steps, four brand categories all on Any, every chip "N products · stores",
    a cabinet brand at RONA, Show all, no sideways scroll.
  - `wizard-brands-create`: a cabinet + an appliance brand, the preview's "x of y pieces", the saved
    kitchen matching it (retail pieces with snapshots), Add products on Your brands (only the
    chosen cabinet brand listed) and off again.
  - `wizard-compact-any`: 10′ × 10′ refuses U-Shape and L + Island, a template with Any brand saves
    no `brandPrefs` and no retail pieces; Room & finishes shows Plain chosen and Moody Green applies.
  - `wizard-custom-blank`: name + client, a typed 15′ 4″ width and a + step on length, Blank room,
    Back and forward keep both, cabinet + lighting brands saved on an empty kitchen, then the blank
    room's L + Island in the editor fills from the cabinet brand.
  - `wizard-photo-entry-phone`: the photo entry on a phone opens `#/generate`.
  - `wizard-brands-phone`: every step's heading on screen at 390 px, the compact preview, layouts
    two a row, brand chips two a row and inside the screen (shots of each step).
  - `room-finishes-palettes`: Colour palettes is the first section of Room & finishes.
