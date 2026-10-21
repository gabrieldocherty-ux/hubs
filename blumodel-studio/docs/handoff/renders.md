# Handoff: photoreal renders (package `renders`)

Plan: `docs/SHOWROOM_PIVOT.md` §5 and §7. Builds on the credits ledger from `docs/handoff/tenancy.md`.
Covered by `server/test/renders.test.mjs` (mocked fetch only), `src/features/renders/__tests__` and
the QA package `renders` (`node scripts/qa.mjs --pkg renders --port 8920`).

## 1. Settings

| Setting | Default | What it does |
|---|---|---|
| `ARCHITECT_AI_KEY` (`ARCHITECT_AI_URL`) | empty | MyArchitectAI. The key alone = real renders; the address defaults to `https://api.myarchitectai.com/v1/render/interior`. Or paste the key in Admin > System > Render service (no restart). |
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

MyArchitectAI (spec: https://www.myarchitectai.com/openapi.json):

```
POST https://api.myarchitectai.com/v1/render/interior
x-api-key: <key>
{ image: "data:<mime>;base64,<the captured view>", outputFormat: "png", prompt: <the room description> }
-> 200 { output: [<image URL>, ...], balance, cost, requestId }   success: the first URL is downloaded and stored
-> 200 { error, code?, balance, cost, requestId }                 FAILURE (a 200 can still fail)
   code CONTENT_POLICY_VIOLATION (charged on their side, not retried), SAFETY_CHECK_UNAVAILABLE (try later)
-> 401/403 bad key, 402 out of balance, 413 over 10 MB, 429 busy (5 per second), 5xx down
```

The result arrives on the same request (about 13 s); there is no polling. Every failure gives the
credits back and shows the team a plain message, never the key or the service's body. The key is only
sent in that header (never to the picture's address), never logged or put in an error. The JSON
answer is capped at 256 KB and the picture at 25 MB, enforced while reading; only an `https://`
picture address is followed, and the bytes must start with PNG, JPEG or WebP magic bytes.
`RENDER_TIMEOUT_MS` covers both requests. A request body over 10 MB is refused before sending.
In production `ARCHITECT_AI_URL`, when set, must be `https://` (plain `http://` only to `localhost`
or `127.0.0.1`). Tests: `server/test/renders.test.mjs`, `server/test/protect-architect-stream.test.mjs`,
`server/test/render-settings.test.mjs`.

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
