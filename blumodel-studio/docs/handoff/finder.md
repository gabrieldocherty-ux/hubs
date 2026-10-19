# Handoff: package 'finder' (choose your contractor)

Built 2026-10-15 on `claude/gallant-ptolemy-lm7fux` (QA ports 8880–8881). Gabe's brief: "a subtle
'choose your contractor' option toward the end of the journey, hover style, natural, not in your
face". The decision: a quiet **Need a contractor?** text link near the end of the summary/estimate
and after an export, a hover/tap popover with a few verified contractors, and a "see all" directory.

## What shipped

**Server** (`server/routes/finder.mjs`, registered in `server/routes/index.mjs`)
- `GET /api/contractors?near=&limit=`: public (`auth: 'none'`), `Cache-Control: no-store`,
  rate-limited 120 per 10 minutes per address (`FINDER_RATE`). Lists contractor brand pages that
  are live: `kind = 'contractor'`, `status = 'active'`, `verified_at` set, an owner, and (through
  `syncVisibilityDue`) a Contractor plan that hasn't lapsed. Demo pages never in production.
- Each card is the brand page's own public header (`services.brandPages.publicWire`): slug, name,
  tagline, logo, service area, website, `leadForm`, `isDemo`; phone and email **only** when the
  contractor ticked "show on my page". Never costs, the owner's account or anything private.
- `near` (city, region, postal code or ZIP) is folded (accents, case) and scored against the free-text
  service area (`matchScore`): 3 names the place / the postal area (FSA "L8P") / the ZIP; 2 one
  telling word of a longer phrase; 1 the province or region of the postal code's first letter, or
  "nationwide". A postal code therefore finds everyone in its region; a city finds who names it.
- Order: real pages before demo ones, best match, then a **daily rotation** (sha256 of day + slug), so
  nobody is always first. That is the groundwork for fair placement if listings are ever sold.
- Response `{ contractors, matched, total, near }`. `total` 0 means the link renders nothing.
- Tests: `server/test/finder.test.mjs` (8): empty list, public fields only (no private phone/email,
  no costs), lapsed plan hides / renewal restores, `near` and `limit`, the daily order, production
  never lists demo pages, the rate limit, `matchScore`.

**Client** (`src/features/finder/`)
- `index.tsx`: `ContractorFinder` (with its own `Suspense fallback={null}`, so the lazy chunk never
  suspends the route's boundary and blanks the editor) and the lazy `ContractorsPage`. It renders
  nothing for contractors (on the plan, or with a company whose plan lapsed) and, for
  `where="export"`, anywhere but the editor.
- `ContractorFinder.tsx`: the link and popover. **Hover** (mouse, 140 ms delay, closes 260 ms after
  leaving), **tap/click** (pins it; a second tap closes), **keyboard** (focus-visible or ArrowDown
  opens, Tab steps into the popover which is a portal at the end of the page, Shift+Tab back, Tab
  past the end leaves it, Escape closes and returns focus to the link), outside taps close it. Up to
  three contractors (logo or initials, name, "Serves …", **View** → `#/b/:slug`, **Ask for a quote**
  → the brand page's existing `LeadForm`), **See all contractors (n)** → `#/contractors`, and a line
  saying they're independent businesses BluModel checks are real. The short list is fetched once per
  5 minutes per page; who serves the place the visitor last searched comes first.
- Ask for a quote attaches the open kitchen: `LeadForm` takes `kitchenId` and preselects it when it is
  one of the signed-in person's kitchens; on send it becomes a **view-only share link** (the lead
  form's existing path). From the editor, See all carries `?kitchen=<id>` so the directory's Ask for a
  quote attaches it too. A shared-kitchen visitor never gets the sharer's kitchen id.
- `ContractorsPage.tsx`: `#/contractors?near=&kitchen=`, public. Search by city or postal code (typing
  searches after 400 ms; the address keeps the search; the last search is remembered on the device for
  the popover), cards with Verified, tagline, service area, website, phone/email only if shown, View
  page and Ask for a quote; empty states for "nobody listed yet" and "nobody names that place";
  429 / offline / error messages; the legal footer; "Are you a contractor? Get listed" for everyone
  else.
- `finder.css`: tokens only, so the dark theme follows. `logic.ts`: pure helpers, unit-tested in
  `__tests__/logic.test.ts` (placement, export-toast match, initials, the route).

**Placements** (one element each, in other packages' files)
- `src/components/RightPanel.tsx`: the bottom of the Overview and the Estimate (`where="summary"`),
  hidden on Checks, with a piece selected, and in view mode (a shared kitchen has its own).
- `src/components/Toasts.tsx`: `where="export"`, a small chip under the toast after an export
  succeeds ("… saved as CSV/PNG/SVG/PDF." or "Project saved."), only in the editor, at most once
  every 10 minutes per tab, gone after 12 s unless someone is using it.
- `src/features/share/SharedKitchen.tsx`: the shared kitchen's fine print, "View only · Terms ·
  Privacy · Need a contractor? · …", `hidden` when a contractor prepared the kitchen. On a phone the
  fine print is hidden (share.css), so `finder.css` keeps just the link as a slim line under
  "Shared by …".
- `src/App.tsx` routes `contractors`; `src/lib/router.ts` parses and builds it.

## QA

`node scripts/qa.mjs --pkg finder --port 8880 --dist .build/finder --strict-external` (11 routes).
Setup makes four fictional contractors through the real API (demo Contractor checkout, profile,
brand page, an admin's approval) with their own QA users, so the runner's QA contractor is untouched.
Covers: nobody listed (no link), the editor's Overview on desktop (hover, keyboard, click, Ask for a
quote with the kitchen attached) and on a phone (Details sheet, tap, tap target sizes, full-width
popover), the chip after an export, the shared kitchen on desktop and phone, never on a
contractor-prepared share or for a contractor, the directory (all, postal code, city, nobody, show
all), the directory on a phone, and in the dark theme.

## Notes and limits

- Postal codes match by region unless a contractor writes the FSA ("L8P") into their service area:
  there is no postal-code-to-city table. Good enough to keep Halifax out of a Hamilton search.
- The popover shows "Demo" on demo pages outside production; production never lists them.
- Analytics: Ask for a quote records the brand page's existing `quote_click` event; nothing new is
  stored about visitors (the search stays in their browser's localStorage).
