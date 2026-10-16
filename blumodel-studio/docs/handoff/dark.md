# Handoff: dark mode (key `dark`)

Dark mode follows Account settings > Preferences > Appearance (System, Light, Dark; System follows
the device). Built in four steps on `claude/gallant-payne-2d148f`; light mode looks as it did
before (checked pixel for pixel, below), except for three bugs the dark QA found that were bugs in
light too and are fixed in both (the Pricing button, the second password reveal, the dashboard
badge).

## What shipped

1. **Colours as tokens with a dark value for each** (3f96e2a). `src/styles.css` defines every
   token on `:root` (light, unchanged) and again for `[data-theme="dark"]`, plus the same block
   under `prefers-color-scheme: dark` for a page whose script never ran (System before
   `public/theme-boot.js`). Both dark blocks are `@media screen`: printing always uses the light
   tokens. New tokens for what used to be hard-coded (accent as text, solid status fills, ink on
   soft fills, the inverse surfaces, rgb channels for glass and shadows, the art tile, the 3D and
   product stage backdrops). A one-off light colour keeps its literal and gets a dark override in a
   "Dark theme" block at the end of its own stylesheet. Product art keeps a light tile; a quote
   sheet (`.quote-sheet`, `.theme-paper`) keeps the light tokens as a printed page on the dark page.
   `theme-color` and `color-scheme` follow the theme; `useResolvedTheme()` is for canvases.
2. **Canvases follow the theme** (57a7f5a). The 2D plan has a dark palette (`planStyle.ts`
   `PLAN_DARK`): drafting is light line work on a dark sheet; the rendered style keeps the floor
   and every piece in real colours with the surround, walls, dimensions and compass in the theme.
   Elevations draw their sheet, walls and dimensions in the theme and keep paint, tile and products
   real. Plan, SVG and PNG exports are always drawn light (paper). The 3D room keeps its physically
   based colours; its backdrop and HUD come from the stage tokens.
3. **WCAG AA contrast and focus rings** (2f6b93c). `src/lib/__tests__/theme.test.ts` checks every
   light token has a dark value, the two dark blocks match, the light values are unchanged and the
   dark plan's line work reads.
4. **Final QA** (this note): `scripts/qa/routes/dark.mjs` and the fixes it found.

## The QA routes (`scripts/qa/routes/dark.mjs`)

`node scripts/qa.mjs --pkg dark --port 8920 --dist .build/dark --strict-external`

176 routes: 161 in dark, every routed screen at 1440 and 390 (the header of the file lists them),
and 15 in light. Dark is reached as most people will: Appearance = System on a device set to dark
(`colorScheme: 'dark'`). Each dark route checks:

- `<html data-theme="dark">`, the dark page background, `theme-color` and `color-scheme`;
- no sideways scroll;
- **every visible piece of text against WCAG AA**, from computed colours: the text colour (with its
  ancestors' opacity) over the backgrounds stacked behind it; text over an image or gradient is
  skipped and counted; disabled controls are exempt (as in WCAG); inputs are measured by value;
- on some routes, Tab to a control and measure its focus ring (3:1).

Long phone pages are photographed a screen at a time (`--part1`, `--part2`, …): a full-page
capture past 16384 device pixels (5461 CSS px at 3x) wraps around to the top. Routes that change
shared state put it back in the same route (`--pkg all` runs the later packages against what they
expect): the sponsored store, the listed QA contractor (`qa-dark-pro@blumodel.test`, unlisted at
the end of each route so the finder package still finds its own four), requests against a
contractor's allowance (withdrawn). The estimator routes use a fresh user so the demo customer
keeps the estimator off.

**Light is unchanged.** The light routes allow only the text that was already under AA before dark
mode (listed in `KNOWN_LIGHT_FG`: muted `--ink-3` text, the accent as eyebrow text, green and amber
text on their soft fills); anything else under AA in light fails. The 15 light screenshots were
also taken from a build of 148439c (the commit before dark mode) and compared pixel by pixel with
this branch: 14 identical, and Pricing differs only where the fix below made its Contractor
button tall enough for its label (the page above the cards is identical).

## What the screenshots found (each its own commit)

- **Pricing's Contractor button** (86f3733): "Become a BluModel Studio contractor" wraps to two
  lines at 1440 and a fixed 44px height cut the second line off, in both themes. Now `min-height`.
- **Two reveal buttons in a password field** (a4e2fc5): Edge draws its own eye next to our Show
  once the field has text. The native one is hidden (`::-ms-reveal`).
- **A count on a selected chip** (ad907a8): the leads filter's "All 5" read 2.4:1 on the light
  chip in dark.
- **Start from a photo's Scale button** (ae19b5c): dark primary-button text on the accent, 3.5:1.
- **The dashboard's "2 new" badge** (9bb2d22): the label's grey hit the badge too, 1.6:1 in light
  and 3:1 in dark. Fixed in both (light was under AA before).
- **Floating surfaces** (9edb4c1): the offline banner, toasts, the photo pill and the tap-to-place
  banner are dark pills; in dark they melted into the top bar and plan. A light hairline in dark.

Looked at and left as they are: the admin Users table's role selects (native selects, readable),
the 3D view and product stages (real colours, by design), product art tiles (light, by design),
the quote sheet (a light printed page on the dark page, by design).

## Open points for Gabe

- Light mode's muted grey (`--ink-3`, 2.9–3.7:1) and the accent as small text (3.8–4.0:1) were
  under AA before dark mode and were kept as they were, since light must look exactly as before.
  Darkening `--ink-3` to about `#756e62` would bring light to AA; say if you want it.
