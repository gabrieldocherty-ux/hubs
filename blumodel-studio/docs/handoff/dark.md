# Handoff: dark mode (key `dark`)

Built 2026-10-15 on `claude/gallant-ptolemy-lm7fux`. Commits: 3f96e2a (tokens), 57a7f5a (canvases),
2f6b93c (contrast and focus rings), and the QA pass after them.

## How it works

- **Tokens.** `src/styles.css` defines every colour token on `:root` (light, unchanged from before)
  and again under `[data-theme="dark"]`. The same dark block applies under
  `@media (prefers-color-scheme: dark)` when no script has set `data-theme` yet. Both are
  `@media screen` only, so printing stays light. One-off literal colours in feature CSS files keep
  their light value and get a dark override at the end of their own file.
- **The switch.** Account settings > Preferences > Appearance (System / Light / Dark, from the
  account package) sets `data-theme` on `<html>` before first paint. `src/lib/theme.ts` resolves
  System, and `useResolvedTheme()` gives canvases the current theme. `theme-color` and
  `color-scheme` follow it.
- **Stays light on purpose:** quote sheets (`.quote-sheet`, `.theme-paper`, they are printed pages),
  product art tiles, and every export (plan PNG/SVG, elevations): `PLAN_LIGHT` is always used for
  files.
- **2D plan** (`src/components/plan/planStyle.ts`): `PLAN_DARK` through `PlanPaletteContext`.
  Drafting is light line work on a dark sheet; rendered keeps the floor and products in their real
  colours with dark line work, while the surround, walls, openings, dimensions and compass follow the
  theme. The drafting sheet is a slightly lighter rectangle than the page around it, as the white
  sheet is on the paper colour in light (on a phone you can see its edge).
- **3D:** physically based colours are untouched; the backdrop and HUD come from the stage tokens.

## Checks

- `src/lib/__tests__/theme.test.ts`: every light token has a dark value, the two dark blocks match,
  the light values are unchanged, the dark plan's line work reads.
- `scripts/qa/routes/dark.mjs` (101 routes): every routed screen in dark at 1440 and 390 (public
  pages, auth, 404, error boundary, home, wizard, account, billing, photo start, custom models, the
  contractor workspace and every tab, the quote, the brand portal, every admin tab, the editor in
  plan, drafting, 3D, walls, split with Room & finishes, checks, estimate, toasts, the phone sheets
  for catalog, Room & finishes, Details, Estimate and a selected item, and the unlock dialog), plus
  14 light routes (87 dark). Each route checks the theme is applied, nothing scrolls sideways, and **every
  visible piece of text passes WCAG AA from computed colours** (text colour with ancestor opacity
  over the stacked backgrounds; text over an image or gradient is skipped and counted; disabled
  controls are exempt). Some routes Tab to a control and check its focus ring is at least 3:1.
- Light routes allow only the pairs that were already under AA before dark mode (muted `--ink-3`
  text, the accent as eyebrow text, green and amber text on their soft fills, "Your model" on the
  accent, the faded wall counts). They were left as they were because light must not change.
  Anything new under AA in light fails.
- Tall phone pages (landing, pricing) are shot screen by screen (`--p2`, `--p3`, ...), because a
  full-page capture at 3x stops at 16384 device pixels and repeats the top of the page after that.
  This is a limit of the capture, not of the page.

## Light is unchanged: how it was checked

The pre-dark commit (148439c) was built separately (`git archive` of `src`, `server`, `catalog`
into a temp dir with `node_modules` linked, `vite build --outDir .build/dark-base`). The light routes
were then run against it and against this build, and the screenshots were pixel-diffed. Landing
(desktop and phone), pricing, sign-in, billing, share and the editor on a phone were **identical**.
The others differed only in data and state: the estimator was switched on for the QA customer by an
earlier route, the admin user counts and the contractor's recent kitchens differed, and the 3D
product turntable was caught at a different angle.

## Seen in the screenshots, not dark-mode issues (left for their owners)

- Catalog cards: "BluModel Basics" wraps onto two lines and pushes the width range ("9–36″") into a
  narrow column. The rename made the brand longer. Same in light.
- Pricing: the Contractor card's button "Become a BluModel Studio contractor" wraps to two lines.
  Same in light.
- Home: the "Start a new kitchen" tile still says "Room size, layout and style in four quick steps".
  The fourth step is now brands.
- Account > Plan & billing says "Exports are paid per kitchen or with a plan". That hints at the
  per-kitchen unlock that isn't meant to be advertised.
- The product page offers "Request a custom version" to signed-out visitors, though custom models are
  now a Contractor-plan feature.
- Brands I carry: the "Shown" checkboxes use the browser's default blue instead of the accent.
