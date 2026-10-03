# Handoff: Mise kitchen visualizer — start here

Read this first in a new session, or paste it as your first message. It's a snapshot of what was built, how far it was checked, and what to do next. It was written on 2026-10-03 at the end of the Claude Code cloud session that built the app. That cloud container is temporary, so everything that matters is in this repo; nothing else from it survives.

## Where the code is

- Repo `gabrieldocherty-ux/hubs`, branch **`claude/gpu-3090-performance-3tbisv`**. The branch name is left over from an unrelated first question in that session; it holds only this app plus the trading halt. It is pushed but **not merged into `main`**, and there's no pull request yet. Merging is Gabe's call.
- Everything lives in `kitchen-visualizer/` except three trading-bot files touched for the halt: `HALTED`, `scheduled_cycle.py` and `../CLAUDE.md`.
- Get it on a machine: `git fetch origin claude/gpu-3090-performance-3tbisv && git checkout claude/gpu-3090-performance-3tbisv`.

## What Gabe asked for, in his words

1. "make it for designing kitchens … people will be able to select branded stuff, give room dimensions, it will be used as a visualizer" (for layout and rendering). He also named an existing AI design product as inspiration. The app is original: none of that product's code, branding or name is used, so keep it that way.
2. "build out as a visualizer for many common kitchen products, make visuals awesome and unique but something people will use"
3. "keep going", then "keep building to improve this and stop all market testing"
4. "the site looks great, just build out the day to day login and set up features"

## What's built

`README.md` has the full feature list. In short:

- **Editor.** Four views: a 2D plan (Konva), live 3D (react-three-fiber), side by side, and wall elevations (SVG). There are about 45 products with front-elevation catalog art, and the room is set by dimensions. Kitchen-wide finishes (cabinet, door style, hardware, counter, backsplash, floor, paint) all use procedural textures, and 8 style presets set them in one click. Five one-click layouts are sized to the room with real cabinet widths. Pieces snap to walls and neighbours. Live design checks follow NKBA guidelines. There's an itemised estimate, plus exports to PNG, SVG, CSV and `.kitchen.json`, keyboard shortcuts and undo/redo.
- **Day-to-day use.** Sign up, sign in and sign out, with 30-day sessions. Account settings cover name and password. A "My kitchens" home shows cards with a mini plan, client, size, estimate and last-edited time, with rename, duplicate, delete and search. A 4-step new-kitchen wizard covers name, room, layout and style. Autosave fires about 1.2 s after edits, with a status chip, `Ctrl+S`, retry when back online, a flush on leave, and conflict handling. "Design on this device" mode works without an account or server.
- **Server.** `server/index.mjs` uses only Node built-ins (`http`, `crypto`, `node:sqlite`). Passwords use scrypt; session tokens are stored hashed and sent as httpOnly cookies. Writes need a CSRF header and failed logins are throttled. Data goes to `server/data/mise.db`, which is gitignored.

## Commit history

| Commit | What it added |
|---|---|
| `75cff2f` | First version: room dimensions + branded-product floor plan |
| `b602b5c` | v2: bigger catalog, architectural plan, live 3D, checks, estimate |
| `56c1447` | Faster swatch textures, 3D camera fitted to its pane, visual polish |
| `68116dc` | Wall elevations view; duplicates no longer land on other pieces |
| `7234f3c` | Style presets with island accents |
| `7391e79` | Trading halt: `HALTED` kill switch for `scheduled_cycle.py` |
| `5c6e3c8` | Accounts, saved kitchens, setup wizard, autosave |

## How far it was checked

These checks were all done by hand in the cloud session. **None of them are committed as automated tests.**

- `npm run build` passed (strict TypeScript) on every commit.
- In a real browser (Playwright + Chromium) I checked:
  - signup validation, wizard → editor, and autosave reaching "Saved just now"
  - kitchens persisting across reload, and rename, duplicate, delete and reopen
  - wrong vs right password, and device-only mode
  - no horizontal overflow at phone width on the auth, home and wizard screens
  - the plan, 3D and elevation views with the layouts and style presets (by screenshot, not pixel tests)
- Against the API with curl (13 checks, all passed):
  - signup and login, cookie flags (`Secure` in `--prod`), and the CSRF header being required
  - owner scoping (another user's project returns 404) and revision conflict (409)
  - login throttling, and the static-file path-traversal guard
- **It has never run on Gabe's PC or on Windows.** That's the first thing to confirm.

## Known limitations

- **Brands and prices are invented.** Nordwell, Haldor, Corviq and the rest don't exist. Real branded products need a licensed product feed or manufacturer data. `src/data/catalog.ts` shows the shape each product needs.
- No password reset. There's no email sending, so a forgotten password can't be recovered (signed-in users can change theirs).
- Rooms are rectangles only, and items rotate in 90° steps.
- One owner per kitchen. There's no sharing with a client or collaborator.
- Login throttling is in memory, so it resets when the server restarts.
- The editor is desktop-first. Home, wizard and sign-in work on phones; the editor on a phone is cramped.
- There's no automated test suite (see above).

## Next steps, in priority order

1. **Run it on the PC.** You need Node **22.13 or newer**: `node:sqlite` is behind a flag in 22.5–22.12, and the API fails to start there. Run `npm install`, `npm run api` and `npm run dev`, then open http://localhost:5173. Sign up, run the wizard, and confirm "Saved just now" survives a reload. Fix anything Windows-specific.
2. **Add tests**, so changes stop depending on manual clicking:
   - Vitest for the pure logic: `src/lib/geometry.ts` (snapping, overlaps), `checks.ts`, `estimate.ts` and `src/data/templates.ts`. Templates must produce no check errors at the sizes the wizard offers.
   - `node:test` for the API routes in `server/index.mjs`.
   - Add an `npm test` script and keep it green.
3. **Decide who uses it.** For Gabe alone on his PC, `npm run build && npm start` is enough. For other people, it needs hosting behind HTTPS (a TLS proxy in front of `npm start`), backups of `server/data/mise.db`, and a password-reset email (see limitations).
4. **Client-facing output.** A one-page proposal (plan + elevations + estimate) and/or a read-only share link for a kitchen. These are the most likely "people will use it" features.
5. **Real branded catalog**, once there's a licensed source (see limitations). Replace data, not code: the catalog and finishes files are the only places products are defined.

## Don't

- Don't resume trading or market research. It's halted at Gabe's request (`../HALTED`, `../CLAUDE.md`).
- Don't present invented brands or prices as real.
- Don't bump `@react-three/fiber` to v9 or React to 19 piecemeal (see `CLAUDE.md`).
- Don't commit `server/data/` (user accounts and saved kitchens).

## Paste-ready first message for a new local session

> Read `kitchen-visualizer/HANDOFF.md` and `kitchen-visualizer/CLAUDE.md`. Check out branch `claude/gpu-3090-performance-3tbisv` if it isn't already. Then do next step 1: get the app running on this PC and tell me what happened, including anything that broke. After that, start step 2 (tests) unless I say otherwise. Don't touch the trading bot; it's halted.
