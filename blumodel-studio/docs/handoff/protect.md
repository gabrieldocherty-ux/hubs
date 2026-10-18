# Copy protection: making our stuff hard to copy

What stops a competitor or a scraper from taking the catalog, the 3D models, the pictures and the
research, and what is only a request. Gabe's goal (2026-10-18): "make it hard to copy our stuff".
Nothing here makes copying impossible: anything a browser draws can be captured by the person
looking at it. The aim is that bulk copying is slow, noisy, against the terms, and leaves us a
clear legal position.

## 1. Rate limits on the public reads (`server/http/readLimits.mjs`)

Token buckets per visitor address, two per group: a per-minute bucket that a person never meets
(a showroom visit loads one catalog and about 40 thumbnails; browsers then cache the immutable
files), and a per-day bucket that slows a script copying everything to a crawl. Routes in a group
share their buckets. Over budget: `429` with `Retry-After`.

| Group | Routes | Per minute (burst, then refill) | Per day |
| --- | --- | --- | --- |
| catalog | `GET /api/catalog`, `/api/catalog/brands`, `/api/catalog/retailers` | 60, then 30/min | 1,500 |
| product | `GET /api/catalog/products/:id`, `/api/files/:id`, `/api/catalog/retail/upc/:upc` | 120, then 60/min | 4,000 |
| files | `GET /files/:name` (public models and images), `/api/files/:id/content` | 600, then 300/min | 20,000 |
| brand | `GET /api/brands/by-slug/:slug` | 60, then 30/min | 1,500 |
| share | `GET /api/share/:token` (also the older 600/hour window) | 60, then 30/min | 1,500 |
| showroom | `GET /api/showroom` | 120, then 60/min | 5,000 |
| retail | `GET /api/catalog/retail` (staff only) | 20, then 20/hour, per account and address | |

The address is the real visitor's (`app.mjs clientIp`): `CF-Connecting-IP` only with
`TRUST_PROXY=1` and a loopback peer (cloudflared on the same machine); otherwise the socket's
address, so a client can't pick a fresh budget by sending a header. `RATE_LIMITS=off` (development
and tests only) turns them off; production refuses it.

**Cloudflare in front (Gabe, no code):** Security > WAF > Rate limiting rules, e.g.
`(http.request.uri.path wildcard "/files/*" or starts_with(http.request.uri.path, "/api/catalog"))`,
120 requests per minute per IP, action Managed Challenge; Security > Bots > Bot Fight Mode; and
"Block AI bots" / AI Labyrinth where the plan offers them. These act before a request reaches the
Wyse, so they also save its bandwidth.

## 2. Nothing to guess, nothing listed all at once

- Public files are named by the sha256 of their bytes (`/files/<64 hex>.glb`): there is no number to
  count up. Products are `p_` + 24 random characters, files `f_` + 24, share tokens 24 random bytes.
  The audit found no guessable model or texture URL, so none were changed.
- `GET /api/catalog` answers in pages of at most 100 products (`?offset=`, `?limit=`; `next` is the
  next offset, null on the last page; `total` is the count; the brands come with the first page;
  `version` covers the whole catalog). The client (`src/lib/api.ts catalogPages`) reads every page
  and starts again once if the catalog changed meanwhile. A brand page lists at most that brand's
  products (`BRAND_PRODUCT_LIMIT`, 50).

## 3. Search engines yes, AI crawlers no

- `GET /robots.txt` (`server/routes/ops.mjs`): one group refusing everything to the known AI
  training and AI answer crawlers (GPTBot, ChatGPT-User, OAI-SearchBot, CCBot, Google-Extended,
  GoogleOther, Applebot-Extended, ClaudeBot, Claude-Web, Claude-User, Claude-SearchBot, anthropic-ai,
  PerplexityBot, Perplexity-User, Bytespider, Amazonbot, meta-externalagent, Meta-ExternalFetcher,
  FacebookBot, cohere-ai, Diffbot, ImagesiftBot, Omgilibot, Timpibot, YouBot, DuckAssistBot, AI2Bot,
  PanguBot, img2dataset and others in `AI_CRAWLERS`); then for everyone else (Googlebot, Bingbot)
  the pages are allowed and `/api` and `/files` are not, with
  `Content-Signal: search=yes, ai-input=no, ai-train=no`. The sales pages stay indexable for SEO,
  and so do a showroom's pages on its own host.
- Every model, image and file answer carries `X-Robots-Tag: noindex, noimageindex, noai, noimageai`:
  `/files/:name`, `/api/files/:id/content`, render images, and the pictures and models the app ships
  in `dist/` (`server/http/static.mjs`).
- robots.txt and these headers are requests. Well-behaved crawlers honour them; a scraper doesn't.
  They record the reservation of rights, which the terms (section 5) then make binding.

## 4. The retail research library stays ours

`src/data/retail.json` (458 researched store products: dimensions, finishes, store links, SKUs,
confidence, research notes) is built from `catalog/retail/*.json` by `server/catalog/retailBuild.mjs`.

- It is **not in the client bundle**: no `import()` of it remains in `src/`, so Vite emits no
  `retail-*.js` chunk and nothing in `dist/` names a RONA or Home Depot URL (checked by grepping a
  build, and by QA's `retail-library-not-public-*` routes). `catalog/retail/*.json` lives only in the
  repo; the deploy ships `src/data/*.json` to the server, never into `dist/`.
- `GET /api/catalog/retail` gives the library to BluModel staff only (auth level `studio`: studio and
  admin accounts, an admin with its 2FA session), on the sales site only (a showroom answers 404),
  never cached, rate-limited. `src/catalog/retail.ts loadRetail()` asks for it only for staff; for
  everyone else, and on every showroom, the status is `unavailable` and nothing is requested.
- A signed-in account whose delivered custom model carries a UPC still sees that product's
  "Where to buy": `GET /api/catalog/retail/upc/:upc` returns just that listing and its stores (no
  confidence, no research notes), rate-limited per account.
- Consequence: on the sales site the retail range, its store chips and the wizard's retail brand
  chips are for our staff. That matches the pivot (docs/SHOWROOM_PIVOT.md §3): the retail catalog is
  the internal library we model from.

## 5. The terms

`src/features/legal/content.tsx`: the service agreement and the site terms (visitors included) say
we own the software, its designs, the 3D models we make and the showroom template, and the
customer owns its brand and product data; the service is licensed, not sold; no copying, reverse
engineering, decompiling, scraping, bots or automated access outside our interfaces, and no use to
build a competing product; no use of any part of the service or its content to train or improve
AI; "BluModel Studio" and its logo are our trademarks; each side keeps the other's non-public
information confidential. Every site's footer says © <year> <LEGAL_NAME, else BluModel Studio>.

**A lawyer must review these before anyone relies on them.** They are plain-language drafts written
without legal advice. Gabe: set `LEGAL_NAME`,
`LEGAL_JURISDICTION` and `SUPPORT_EMAIL` in `blumodel.env` so the terms name their owner, and
consider registering "BluModel Studio" with CIPO (without it there are only common-law trademark
rights).

## 6. Backups and bundles that leave the machine

Encrypted (AES-256-GCM, key from `BACKUP_PASSPHRASE`): the daily off-site copy and every export
bundle. OPERATIONS.md, "Off-site backups" and "How long each copy is kept".

## Tests

`server/test/protect-scraping.test.mjs` (the buckets, a normal visit never limited, 429 per real
visitor, every route covered, pages, headers, the staff-only library and the by-UPC listing),
`server/test/edge.test.mjs` (robots.txt), `src/catalog/retail-access.test.ts` (the client never asks
unless staff), QA `retail` (staff routes, `retail-library-not-public-anon` / `-customer`,
`retail-library-not-on-showroom`), `server/test/protect-offsite.test.mjs` (the encrypted copies).
