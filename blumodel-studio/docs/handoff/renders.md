# Handoff: photoreal renders (package `renders`)

Plan: `docs/SHOWROOM_PIVOT.md` §5 and §7. Builds on the credits ledger from `docs/handoff/tenancy.md`.
Covered by `server/test/renders.test.mjs` (mocked fetch only), `src/features/renders/__tests__` and
the QA package `renders` (`node scripts/qa.mjs --pkg renders --port 8920`).

## 1. Settings

| Setting | Default | What it does |
|---|---|---|
| `ARCHITECT_AI_URL`, `ARCHITECT_AI_KEY` | empty | Gabe's architecture AI. Both set = real renders. |
| `RENDER_CREDIT_CENTS` | `25` | What one render costs in credits. |
| `FREE_RENDERS` | `3` | Free renders per account, once (`showroom_renders.free = 1`, no hold, `cost_cents` 0). They skip the visitor switch and daily cap; a failed one doesn't count; a free render can't be refunded. `0` turns them off. |
| `RENDER_PROVIDER` | `auto` | `architect`, `demo` or `off` forces one (`architect` still needs both settings above). |
| `DEMO_RENDERS` | off | Allows the stamped demo renderer in production. Outside production `auto` uses it when the AI isn't set. |
| `RENDER_MAX_IMAGE_MB` | `6` | Largest captured view accepted (PNG, JPEG or WebP, at least 64 px). |
| `RENDER_TIMEOUT_MS` | `180000` | A render that takes longer fails and its credits go back. |

With no provider, `GET /api/renders/status` says `configured: false`, the editor's dialog says
"Photoreal renders are being set up", its button is off, and `POST /api/renders` answers
503 `renders_not_configured` before anything is reserved. Nothing is charged.

## 2. The AI contract (`server/renders/providers.mjs`)

The API isn't settled, so the adapter speaks a small contract. Change the adapter, not the service:

```
POST <ARCHITECT_AI_URL>
Authorization: Bearer <ARCHITECT_AI_KEY>
{ requestId, prompt, scene, image: { mimeType, data: <base64> }, output: { format: 'png', widthPx, heightPx } }
-> 200 image/png|jpeg|webp bytes, or JSON with base64 / a data: URL in image, imageBase64, output or images[0]
```

Any other answer counts as a failure: the credits go back and the team sees a plain message. The key
is only sent in that header. It is never logged and never put in an error message.

The answer is read as a stream with a 25 MB cap enforced while reading: past 25 MB (or a
Content-Length over it) the stream is cancelled and the render fails, so a huge or endless answer
never sits in memory. Only `image/png`, `image/jpeg`, `image/webp` or a JSON type is read at all, and
the picture (sent as bytes or inside JSON) must start with PNG, JPEG or WebP magic bytes.
`RENDER_TIMEOUT_MS` covers the whole answer, body included. In production `ARCHITECT_AI_URL` must be
`https://` (plain `http://` only to `localhost` or `127.0.0.1`); the server refuses to start
otherwise. Tests: `server/test/protect-architect-stream.test.mjs`.

## 3. Money

The render row, the captured view and `credits.reserve` happen in one transaction. A finished
render calls `charge`. A failure, a timeout, or a render left pending by a restart (failed on the
next read) calls `release`. An admin can refund a finished render
(`POST /api/admin/tenants/:id/renders/:renderId/refund`, audited, once). That calls `credits.refund`.
Insufficient credits answer 402. Each person can run one render at a time (409).

## 4. Who can render

- The team (owner, staff) can render their own designs, any of the showroom's designs, and a
  lead's design opened from its share link (`shareToken`).
- Visitors can render their own designs, but only when the company switched `visitorRenders` on
  (Showroom tab, or Admin > Companies). Visitor renders count against `dailyRenderCap` across the
  whole showroom (429 `daily_cap_reached`). A visitor never sees the credit balance.
- On the sales site nothing exists: the routes are showroom-only, and the client never calls them.

Every route and shape is listed at the top of `server/routes/renders.mjs`.

## 5. Client (`src/features/renders`)

- `PhotorealButton` sits in the TopBar slot (main chunk, no three). It only shows on a showroom,
  signed in, on a saved design, and for someone allowed to render. The dialog is lazy.
- The dialog captures the current 3D view with the Studio render's offscreen renderer (the current
  camera, 1600 px on the long side). It sends PNG, or a JPEG when the PNG is over the limit. It also
  sends the scene description from `model.ts`: the room, finishes by name, and products grouped
  with their finishes and counts. Then it polls, shows the result with Download, and lists this
  design's earlier renders.
- `RendersGallery` (lazy) is the showroom's whole gallery. It is used by the workspace's Renders tab
  (`src/features/workspace/RendersTab.tsx`, which shows the credits itself).
- `RendersPage` (lazy) is a standalone page with the credits and the gallery, for anywhere that
  wants both.
- QA only: on this machine, `?qa-renders=setup` in the hash shows the "being set up" state against
  the demo server.

## 6. Open

- The real AI's API: the adapter follows the contract above until Gabe's service exists.
