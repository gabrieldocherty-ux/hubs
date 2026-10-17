# Operating BluModel Studio on the home server

How the public sites run on the Windows PC, and how to look after them. One server and one database
serve them all (docs/SHOWROOM_PIVOT.md): **blumodel.studio** (and www.) is our sales site for kitchen
and bath companies, **`<slug>.blumodel.studio`** is each company's showroom, and a company's own
domain (`showroom.acmekitchens.ca`) is the same showroom. The request's `Host` picks which.
Setting a company up after a sale is [ONBOARDING_A_COMPANY.md](ONBOARDING_A_COMPANY.md). The go-live
and payments steps are in [LAUNCH.md](LAUNCH.md). Running it on another computer (the Dell Wyse
5070, on Linux or Windows: install, cutover, updates from GitHub) is in [HOSTING.md](HOSTING.md), and
moving the data there in [MOVING_DATA.md](MOVING_DATA.md).

```
visitor ── https ──> Cloudflare ── tunnel 'blumodel' ──> cloudflared (this PC)
  blumodel.studio, www.                                   └─> http://127.0.0.1:8790  node server/index.mjs --prod
  <slug>.blumodel.studio  (wildcard DNS record *)              the Host header picks the sales site,
  showroom.acmekitchens.ca (Cloudflare for SaaS)               a showroom, or a 404
```

The server listens on 127.0.0.1 only: nothing on the LAN or the internet reaches it except through
the tunnel. Cloudflare terminates TLS; cloudflared forwards each request with `CF-Connecting-IP` and
`X-Forwarded-Proto: https`, which the server believes only because `TRUST_PROXY=1` and the request
comes from 127.0.0.1.

## The home folder

Everything lives in `%USERPROFILE%\Projects\BluModelStudio` (the "home"; `BLUMODEL_HOME` moves it).
The repo is only where new versions come from. On Linux the home is `/srv/blumodel-studio`, run by
systemd: [HOSTING.md](HOSTING.md) covers that machine (and a Windows machine nobody signs in to).

| Path | What | Kept by a deploy? |
| --- | --- | --- |
| `app\` | the deployed code: `dist\` (the built site), `server\`, `src\data\*.json`, `DEPLOYED.txt` (commit and time) | replaced |
| `app.previous\` | the app the last deploy replaced (`deploy-local --rollback` puts it back; `app.failed\` is the one a rollback replaced) | replaced |
| `data\blumodel.db` (+ `-wal`, `-shm`) | the database | kept |
| `data\uploads\` | uploaded models, images and photos | kept |
| `data\backups\daily\` | the server's own daily database copies (14 kept) | kept |
| `data\backups\uploads-mirror\` | a mirror of `data\uploads\`, refreshed daily | kept |
| `data\backups\<timestamp>\` | the deploy's copy of the database from just before each deploy (5 kept) | kept |
| `logs\server.log` | the server's log (rotated at 10 MB, 5 old files kept) | kept |
| `logs\console.log` | anything printed before the server's log was open, e.g. a failed start (rotated at each start) | kept |
| `logs\tunnel.log` | cloudflared's output (rotated at each tunnel start) | kept |
| `blumodel.env` | **private settings** (Stripe keys etc.): see *Settings* | never touched |
| `run-server.cmd` | the server's supervisor: starts it, restarts it 5 s after it exits | rewritten |
| `start-hidden.vbs` | runs `run-server.cmd` with no window (the `BluModelStudioServer` task runs this) | rewritten |
| `start-server.cmd`, `stop-server.cmd` | start / stop by hand | rewritten |
| `cloudflared.yml` | the tunnel's config | written by `setup-tunnel` |
| `run-tunnel.cmd`, `start-tunnel.vbs`, `start-tunnel.cmd`, `stop-tunnel.cmd` | the tunnel's supervisor and its start/stop | written by `setup-tunnel` |
| `stopped`, `tunnel.stopped` | "stopped on purpose" markers: the supervisors exit while these exist | |
| `deploying`, `shutdown.request` | a deploy is in progress / "please shut down gracefully" | |

`scripts/deploy-local.mjs` and `server/ops/home.mjs` describe the same layout in code. The helper
scripts below also have npm shortcuts in `blumodel-studio\`: `npm run home:migrate`, `npm run home:tasks`,
`npm run tunnel:setup` and `npm run stripe:check` (pass options after `--`, e.g. `npm run home:tasks -- --dry-run`).

## Start, stop, restart, status

From the home folder (double-click or a terminal):

- **Stop:** `stop-server.cmd`. It asks the server to shut down gracefully (finish open requests for up
  to 10 s, checkpoint the database, exit 0); after 20 s it ends it forcibly. It also writes `stopped`,
  so the supervisor doesn't restart it.
- **Start:** `start-server.cmd` (removes `stopped`, starts the supervisor hidden).
- **Restart** (e.g. after editing `blumodel.env`): `stop-server.cmd`, then `start-server.cmd`.
- **Status:** open http://127.0.0.1:8790/api/health. `{"ok":true,"version":"0.1.0","uptimeSec":…,"db":"ok"}`
  is healthy; a **503** means the database failed its check at startup (`"db":"corrupt"`), can't
  answer (`"db":"error"`), or the server is shutting down. From outside: https://blumodel.studio/api/health.
- **Which site a host is:** `curl -s -H "Host: demo.blumodel.studio" http://127.0.0.1:8790/api/config`
  answers `"site":"showroom"` with the company in `tenant`; `-H "Host: blumodel.studio"` answers
  `"site":"sales"`; a host with no showroom answers 404. Every deploy runs these checks itself and
  prints them under *Sites*.
- What it decided at start (payments, warnings) is at the top of each start in `logs\server.log`, e.g.
  `Stripe: LIVE mode`, `Payments: none. …`, `Warning: …`.

The tunnel the same way: `stop-tunnel.cmd`, `start-tunnel.cmd` (they only touch the cloudflared that
runs with *this folder's* `cloudflared.yml`; any other cloudflared on the PC is left alone).

## Update (deploy a new version)

From the repo, in `blumodel-studio\`:

```
git pull                  (or check out the commit you want)
npm ci                    (only when package-lock.json changed)
npm test                  (should be green)
npm run deploy:local      (builds, then deploys to the home and restarts the server)
```

`node scripts/deploy-local.mjs --dist <folder>` deploys a build you already made (a `vite build` output).

**It ships a commit, not a working tree.** Before it stops or copies anything, the deploy runs
`git status` over everything it ships or builds from (`server`, `src`, `public`, `index.html`,
`package.json`, `package-lock.json`, `vite.config.ts`, `tsconfig.json`: `DEPLOY_SOURCE_PATHS` in
`server/ops/home.mjs`). If any of those files is changed or untracked it lists them and exits 1,
leaving the home untouched: a migration that is only on disk would be applied to the real database,
recorded as done, and never re-run once it changed and was committed. Commit the work or, when the
checkout holds someone else's unfinished changes, deploy from a clean worktree of the commit you want:

```
git worktree add --detach %TEMP%\bm-deploy <commit>
cd %TEMP%\bm-deploy\blumodel-studio
npm ci
npm run deploy:local
git worktree remove %TEMP%\bm-deploy      (afterwards, from the main checkout)
```

`--allow-dirty` deploys the files on disk anyway (it lists them first), and `app\DEPLOYED.txt`
records whether a deploy was clean, so a dirty one stays visible. Without git on PATH the check is
skipped with a warning.

The deploy:

1. stops this home's server gracefully and ends its supervisor (never the tunnel; never anything not
   started from this home), and refuses if something else holds port 8790;
2. copies the database (with `-wal`/`-shm`) to `data\backups\<timestamp>\`;
3. renames a pre-rename `data\mise.db` / `mise.env` if it finds them (`mise.env` is renamed, never opened);
   creates a `blumodel.env` **template** only if there is no settings file at all;
4. puts the new `app\` in place, keeping the one it replaces as `app.previous\`, rewrites the
   supervisor scripts, starts the server and waits for `/api/health`. It exits 0 when healthy, 1 when
   it refused before changing anything (the old app keeps running), 3 when the new app is in place
   but unhealthy;
5. when healthy, asks the server on 127.0.0.1 which site `blumodel.studio`, `www.`, `demo.` and a
   made-up showroom are (by `Host`; the base domain is the server's own, from `/api/config`) and
   prints a *Sites* block (`ok`, `NOTE` for a missing demo showroom, `FIX`), then warns when
   `cloudflared.yml` doesn't send `www.` and `*.blumodel.studio` here (a config from before showrooms:
   see *The tunnel*). These are reported only; they never fail or roll back a deploy.

The site is down for a few seconds (Cloudflare shows its 502 page). New database migrations run when
the new code starts; they are forward-only, which is why step 2 exists (see *Rollback* in LAUNCH.md).

**Roll back** to the app the last deploy replaced: `node scripts/deploy-local.mjs --rollback` (from the
repo). It stops the server, swaps `app.previous\` back in (the failed app is kept as `app.failed\`),
starts it and checks its health. The database is left alone; if the newer version migrated it, the
rollback prints the `restore.mjs` command for the copy the deploy made first.

On a machine set up with `scripts/host/install-*` (the Wyse), one command pulls, builds, deploys and
rolls back by itself when the health check fails: HOSTING.md, *Update from GitHub*.

Settings for the deploy itself (rarely needed): `BLUMODEL_HOME` (another folder), `BLUMODEL_PORT`,
`BLUMODEL_HOST`, `BLUMODEL_ADMIN_EMAILS` (only for a new template). `MISE_HOME` / `MISE_PORT` /
`MISE_HOST` still work but are deprecated. `BLUMODEL_DEMO_PAYMENTS` is gone: `DEMO_PAYMENTS` lives in
`blumodel.env`.

## Settings: `blumodel.env`

One `KEY=VALUE` per line; `#` starts a comment; values may be quoted. **It holds live secrets:** never
paste it (or a value from it) into a chat, email, issue, screenshot or git. Edit it with Notepad
(`notepad %USERPROFILE%\Projects\BluModelStudio\blumodel.env`) and restart the server. The deploy made
it readable only by your Windows account (`icacls`); keep it that way.

| Key | Value on the public server | What it does |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | `rk_live_…` (restricted key; LAUNCH.md lists its permissions) | Stripe API calls. A live key works only in production with an https `PUBLIC_URL`. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | verifies Stripe's webhook signatures (5-minute tolerance) |
| `PUBLIC_URL` | `https://blumodel.studio` | checkout success/cancel/portal return links and the webhook check; never taken from a request |
| `BASE_DOMAIN` | empty (= `blumodel.studio`) | the domain showrooms live under: `<slug>.<BASE_DOMAIN>` is a showroom, the domain and `www.` the sales site. Change it only together with the tunnel (`setup-tunnel.mjs --hostname`) and DNS. Dev and QA use `localhost` |
| `ADMIN_EMAILS` | your email(s), comma separated | **grants nothing and reserves nothing** (signing up or changing an email to a listed address is like any other). Admins are made with `make-admin` (below) |
| `DEMO_PAYMENTS` | `0` | `1` allows the labelled DEMO checkout in production when Stripe isn't set (never with a live key) |
| `SHOW_DEMO_BRANDS` | `0` | `1` shows the seeded "(Demo)" brands, their products and pages in production (QA sets it); without it production hides every `is_demo` brand |
| `TRUST_PROXY` | `1` | believe `CF-Connecting-IP` / `X-Forwarded-For` / `X-Forwarded-Proto` from 127.0.0.1 (per-visitor rate limits, Secure cookies, HSTS) |
| `LEGAL_NAME`, `SUPPORT_EMAIL`, `LEGAL_JURISDICTION` | the business's legal name, a support address, where it's established | the terms, privacy and refund pages, receipts and the footer's Contact link |
| `ANTHROPIC_API_KEY`, `BLUMODEL_LLM_MODEL` | optional, legacy | the retired *Start from a photo* read photos with Claude when both were set |
| `ARCHITECT_AI_URL`, `ARCHITECT_AI_KEY` | optional: the render service's address and key | "Make it photoreal" on the showrooms. Without both, the button says renders are being set up and nothing is charged |
| `RENDER_CREDIT_CENTS` | empty (= 25) | the credits one render costs a company, in cents |
| `RESEND_API_KEY` **or** `POSTMARK_TOKEN` | optional: a Resend API key (`re_…`) or a Postmark server API token | emails password-reset links and account notices (see *Password resets*). Set one; with both, Resend is used |
| `EMAIL_FROM` | `"BluModel Studio <hello@blumodel.studio>"` (quoted, since it has spaces) | the sender; the provider must have verified that address or domain. Without it no email is sent even with a key |

Payments are decided at start, and the log says why: **`stripe`** when both Stripe values are set and
valid (a live key also needs production mode and an https `PUBLIC_URL`); otherwise **`demo`** if
`DEMO_PAYMENTS=1` and the key isn't live; otherwise **`none`** (the site says *Payments open soon*;
checkout, billing changes and order payments answer 503). The log prints `Stripe: LIVE mode` or
`TEST mode` from the key's prefix, never the key.

`run-server.cmd` clears all of these keys (and `PAYMENTS`, `NODE_ENV`, `RATE_LIMITS`) from the
environment Windows gives it, so `blumodel.env` is the only source: a variable set for other work
(an `ANTHROPIC_API_KEY` in your user environment, say) can't leak into the public server. It always
names `%~dp0blumodel.env`; if that file is missing the server refuses to start (`logs\server.log`
says so, naming the path only) rather than run without its keys.

Other variables the server reads (set by `run-server.cmd` or left at their defaults): `PORT` (8790),
`HOST` (127.0.0.1), `DB_PATH` (`data\blumodel.db`), `UPLOAD_DIR`, `DIST_DIR`, `BACKUP_DIR`
(`data\backups`), `BACKUPS` (`off` disables them), `BACKUP_KEEP` (14), `MAX_GLB_MB` (25),
`MAX_IMAGE_MB` (8), `BRAND_PRODUCT_LIMIT` (50), `BLUMODEL_LOG_FILE`, `BLUMODEL_SHUTDOWN_FILE`.

Check the Stripe side any time with `npm run stripe:check` (read-only; prints PASS / FIX lines, never a key).

A home folder made before showrooms has no `BASE_DOMAIN`, `ARCHITECT_AI_*` or `RENDER_CREDIT_CENTS`
lines; that's fine, their defaults are right. Add any of them yourself with Notepad when needed (the
deploy never edits an existing settings file). Likewise one made before email existed has no email
lines. To turn email on, add:

```
# Optional: email password-reset links and account notices. ONE provider key, and the sender.
RESEND_API_KEY=
POSTMARK_TOKEN=
EMAIL_FROM="BluModel Studio <hello@blumodel.studio>"
```

At start the log says which is in use, e.g. `Email: Resend (password-reset links and account notices
are emailed).` or `Email: none (…)`, never a key. A failed send is logged as the provider and the
HTTP status only.

## Admins

Nobody becomes an admin by signing up or signing in, whatever `ADMIN_EMAILS` says: the site has no
email verification, so anyone could register the owner's address first. An admin is made only on
this machine, against the live database, after that person has signed up:

```
cd %USERPROFILE%\Projects\BluModelStudio\app
node server\scripts\make-admin.mjs you@example.com
```

Run from the home's `app\`, it finds the home's `data\blumodel.db` by itself, the same way
`restore.mjs` does, so no `DB_PATH` is needed (before 2026-10-16 it opened
`app\server\data\blumodel.db` instead and reported no account). `--db <file>` or `DB_PATH` names
another database and wins. It first prints the database it used (`Database: ...\data\blumodel.db
(the deployed home's database)`), and stops with an error if there is no database at that path
rather than creating an empty one. Then it prints `you@example.com is now an admin.` (or that no
account has that email). `--role studio`
makes a studio member instead; `--role customer` takes a role away. Admin > Users can switch an
account between customer and studio, never your own, and never to or from admin: that is only
this script. Until an admin exists, the server log says `Warning: No admin account
exists: run node server/scripts/make-admin.mjs <email>` at every start. Run it only for an account
you know is the right person's: you signed it up yourself and can sign in to it.

## Password resets

*Forgot password?* on the sign-in page works two ways, depending on whether email is set up:

- **With a provider** (`RESEND_API_KEY` or `POSTMARK_TOKEN`, plus `EMAIL_FROM`): the person types
  their address and gets a single-use link (`PUBLIC_URL/#/signin?reset=…`). The page answers the same
  whether or not an account uses that address. Limits: 3 emails an hour per address, 10 requests an
  hour per visitor.
- **With none:** the page tells them to write to `SUPPORT_EMAIL`. Check the request comes **from the
  account's own address**, then in **Admin > Users** search for them and press **Create reset link**.
  The link is shown once, with a Copy button; reply with it from the support address. The audit log
  records that you made one, for whom, never the link.

Either way a link works **once, for 60 minutes**; only the newest link for an account works; only its
SHA-256 is stored, so a copy of the database can't be used to reset anyone. Using it sets the new
password, signs the account out on **every** device and signs that browser in. Changing the password
or the sign-in email in Account settings, or deleting the account, cancels any outstanding link.

## Showrooms, licenses and the monthly plan (since 2026-10-17)

What we sell (docs/SHOWROOM_PIVOT.md): a **yearly license** per company (list $1,995 CAD incl. setup
and up to 50 products modelled), recorded by hand in **Admin > Companies** (no Stripe), plus **$50
CAD/month** by Stripe Checkout ($25 hosting with their web address, $25 of render credits that roll
over 3 months). A showroom is live only while both are current; a failed renewal has 14 days of
grace; a lapsed or suspended showroom shows "temporarily unavailable" and keeps all its data.
Homeowners never pay: designing, saving, sharing and downloading are free everywhere.

The whole procedure after a sale, including the Cloudflare steps for a company's own domain and the
go-live checklist, is [ONBOARDING_A_COMPANY.md](ONBOARDING_A_COMPANY.md). Day to day:

- **Admin > Companies**: every company's status, license, monthly plan, credits, leads, renders and
  products; record or void a license, create a monthly checkout link, complimentary plans, web
  addresses, settings, credits (add/remove with a reason), team, suspend and launch. Everything is
  in the audit log.
- **Admin > Sales leads**: the sales site's *Book a call* requests (also emailed to `SUPPORT_EMAIL`
  when email is on).
- **The demo showroom** `demo.blumodel.studio` (Northline Kitchen & Bath (Demo)) is made once with
  `node server\scripts\seed-demo-tenant.mjs` from the home's `app\` (safe to run again).
- **Nothing new can be bought on the old plans.** Homeowner Unlimited, the $5 unlock and Contractor
  are closed to new purchases (checkout answers 410); what was already paid keeps its receipts,
  cancel/resume, portal and refunds until it ends.

### The legacy plans and custom models (2026-10-15, still true for existing customers)

- **Prices are in Canadian dollars**: the $5 CAD kitchen unlock (offered only in the export dialog),
  Unlimited $15 CAD/month, Contractor $99 CAD/month. They live in `src/data/plans.json`; the server
  won't start if they change there without `server/lib/plans.mjs`. Checkout sends the amount and
  currency inline, so **nothing needs setting up in Stripe**. A subscription started in US dollars
  keeps renewing at its US price until the person changes or cancels it; a Stripe customer that paid
  in USD gets a fresh customer for CAD automatically (Stripe can't mix currencies on one customer).
- **Custom models aren't sold.** The Contractor plan includes **3 a month**, made by the studio. A
  contractor's request lands in **Admin > Studio** as *To start* with no payment. Start it, deliver
  it and handle revisions as before.
- **Cancel a request you won't make** (before starting it): open it in the queue, *Cancel request…*,
  give a reason (the contractor sees it). The model goes back to their allowance for that month.
- **"Need more?"** The request form points contractors who run out to `SUPPORT_EMAIL`. To give
  someone extra models for their **current** month: **Admin > Studio > Extra models for a
  contractor**, look them up by email, enter how many (1-50) and a note, *Grant*. It's also in the
  drawer of any of their requests. Every grant is in the audit log (`model_grant`). Extra models
  don't carry over to the next month.
- **Orders paid for before** keep their prices (in US dollars), receipts and refunds: refund one from
  its drawer as before.
- The first start of this version runs the `pricing-001` and `pricing-002` migrations: the second
  rebuilds the `orders` and `order_items` tables (every row copied as is). The update procedure's
  backup covers it; nothing else to do.

## Backups and restore

Automatic, while the server runs:

- **Daily:** at start and then hourly it makes today's copy if there isn't one: `VACUUM INTO`
  `data\backups\daily\blumodel-YYYY-MM-DD.db`, integrity-checked before it's kept; the newest 14 are
  kept. Then `data\backups\uploads-mirror\` is brought up to date with `data\uploads\`.
- **Before every deploy:** `data\backups\<timestamp>\blumodel.db` (5 kept).
- **At start:** `PRAGMA integrity_check`. If it fails, the server still starts, the log says
  `DATABASE INTEGRITY CHECK FAILED`, `/api/health` answers 503 and daily backups pause so the good ones
  aren't rotated out.

All of these are on the same disk as the database. **Copy `data\backups\` somewhere else regularly**
(OneDrive, a USB drive): a dead disk takes the backups with it.

Restore (the server must be stopped; the restore refuses while anything listens on 8790):

```
cd %USERPROFILE%\Projects\BluModelStudio
stop-server.cmd
node app\server\scripts\restore.mjs --list                    the daily backups, newest first
node app\server\scripts\restore.mjs --latest                  the newest daily backup
node app\server\scripts\restore.mjs --from data\backups\2026-10-14T14-51-14-589Z\blumodel.db
node app\server\scripts\restore.mjs --latest --uploads        also copy back uploads missing from data\uploads
start-server.cmd
```

The backup is integrity-checked before anything changes. The database it replaces is kept as
`data\blumodel.db.before-restore-<time>` (with its `-wal`/`-shm`), never deleted. `--uploads` only adds
files that are missing; it never overwrites one.

## Logs

- `logs\server.log`: every line stamped `2026-10-14T14:51:15.309Z INFO  …` / `WARN ` / `ERROR`. Route
  errors are logged with their request id and stack; the visitor only sees `{"error": …, "requestId": …}`.
  Long tokens in paths are written as `:token`. No key, secret, password or settings value is ever logged.
- `logs\console.log`: the supervisor's own lines (`starting on 127.0.0.1:8790`, `server exited with code N`)
  and anything printed before the server's log opened.
- `logs\tunnel.log`: cloudflared. `Registered tunnel connection` lines mean it's connected.

## Scheduled tasks

Two tasks start everything at your logon, hidden:

| Task | Runs | |
| --- | --- | --- |
| `BluModelStudioServer` | `wscript.exe "<home>\start-hidden.vbs"` | the server's supervisor |
| `BluModelTunnel` | `wscript.exe "<home>\start-tunnel.vbs"` | the tunnel's supervisor |

Register (or re-register) them with `node scripts/register-tasks.mjs` (`--dry-run` first prints exactly
what it would create; `--only server|tunnel`; `--delete-old` also removes the pre-rename
`MiseKitchenServer`). They use your interactive logon, no time limit, run on battery, start late if
the logon was missed, and never run twice at once. The supervisors do the restarting.

- Check: `schtasks /Query /TN BluModelStudioServer /V /FO LIST` (and `BluModelTunnel`).
- Run now: `schtasks /Run /TN BluModelStudioServer`.
- Remove: `schtasks /Delete /TN BluModelStudioServer /F`.

Registered this way they run only while you're logged on: a reboot with nobody logged on leaves the
site down until you log on. For a machine nobody signs in to, register them **at startup** instead,
from PowerShell run as administrator: `node scripts/register-tasks.mjs --at-startup` (`--dry-run`
first). They then run as your account when Windows starts, signed in or not; `schtasks` asks for your
Windows password once (Windows stores it to start the task; no script passes a password), and you
register them again after changing that password. The tasks are listed in `<home>\startup-tasks`, so
`start-server.cmd`, `start-tunnel.cmd` and the deploy start them through Task Scheduler and they keep
running after you sign out. Registering them without `--at-startup` goes back to logon.

On Linux the same job is done by systemd units: HOSTING.md.

## The tunnel

The tunnel `blumodel` (`064671cd-a658-4240-8626-c697b9f148ac`) already exists in Cloudflare, with DNS for
blumodel.studio routed to it; its credentials are `%USERPROFILE%\.cloudflared\064671cd-….json`. Nothing
in this repo creates, routes, logs into or deletes a tunnel. **Showrooms also need, once, a wildcard
DNS record `*` → the tunnel** in Cloudflare: [ONBOARDING_A_COMPANY.md](ONBOARDING_A_COMPANY.md),
*Once: Cloudflare*, has that and the Cloudflare for SaaS setup for companies' own domains.

```
node scripts/tunnel/setup-tunnel.mjs --dry-run      print the files it would write
node scripts/tunnel/setup-tunnel.mjs --validate     write them into the home, then check the config offline
```

`cloudflared.yml` sends `blumodel.studio`, `www.blumodel.studio`, `*.blumodel.studio` (every showroom:
one rule, so adding a company never changes the file) and, last, any other host to
`http://127.0.0.1:8790` (connect timeout 10 s, no IPv6 racing, keep-alive to the origin). The last rule
is for companies' own domains: Cloudflare for SaaS hands them over with the company's hostname, which
the tunnel can't list, and the server answers 404 for any host it has no showroom for. Only hostnames
routed to this tunnel in our Cloudflare account ever reach it. `--no-custom-domains` makes that last
rule a 404 from cloudflared instead. `--hostname` is the base domain (`www.` and `*.` are added).
`--validate` runs `cloudflared tunnel --config <file> ingress validate` and `ingress rule` for the
sales site, `www.`, `acme.blumodel.studio` and a custom domain, which only read the file, and prints
which rule each one matched. A config written before showrooms (only `blumodel.studio`, then 404)
still serves the sales site; the deploy warns about it. Rewrite it with `stop-tunnel.cmd`,
`node scripts/tunnel/setup-tunnel.mjs --validate`, `start-tunnel.cmd`. It refuses to
rewrite `run-tunnel.cmd` while that tunnel runs (stop it first); cloudflared reads `cloudflared.yml`
only when it starts, so restart the tunnel after a change. `--credentials <file>` names the
credentials JSON when it isn't in `%USERPROFILE%\.cloudflared\` (on Linux the default is
`<home>/.cloudflared/<id>.json`).

**Moving the tunnel to another machine** (the Dell Wyse) is in [HOSTING.md](HOSTING.md), *Move the
tunnel*: the credentials JSON is copied by hand (never by a script, never `cert.pem`), and **only one
machine may run the tunnel at a time**. Cloudflare spreads visitors over every connector that runs
it, so two machines with different databases would split the site's accounts, kitchens and payments
between them. Stop this PC's tunnel and server before the other machine's tunnel starts; going back
means stopping that one first.

## Moving the home (once, from before the rename)

`node scripts/migrate-home.mjs --dry-run`, then without `--dry-run`, moves
`%USERPROFILE%\Projects\Mise` to `%USERPROFILE%\Projects\BluModelStudio` (or merges into it): the
database with its `-wal`/`-shm` becomes `data\blumodel.db`, `mise.env` becomes `blumodel.env` by a file
rename (never opened), backups, uploads and logs come along, the old supervisor scripts are set
aside as `*.pre-migration`. It refuses while a server listens on 8790 or anything runs from either
folder, and when both folders have a database or a settings file. Running it twice is safe. It
prints the Task Scheduler changes to make. The steps in order are in LAUNCH.md, part A.

## Troubleshooting

| Symptom | Look at | Usually |
| --- | --- | --- |
| blumodel.studio shows a Cloudflare 502/1033 | `logs\console.log`, http://127.0.0.1:8790/api/health, `logs\tunnel.log` | the server is stopped (`stopped` file?) or the tunnel isn't running |
| `server exited with code 1` repeating in `console.log` | the last lines of `server.log` | `blumodel.env` missing (`Can't read the settings file …`), a bad `PUBLIC_URL`, or port 8790 taken |
| `port 8790 is already in use by another process: not starting` | `netstat -ano -p tcp \| findstr :8790` | another copy of the server, or the old Mise server, holds the port |
| `/api/health` 503 `"db":"corrupt"` | `server.log` at start | restore the newest good backup (above) |
| `Payments: none` after pasting keys | the `Stripe is NOT on:` lines under it, then `npm run stripe:check` | a typo in a key, a test key with a live webhook secret, or `PUBLIC_URL` not https |
| Visitors share one rate limit; no `Secure` cookie | `TRUST_PROXY` | set `TRUST_PROXY=1` |
| A showroom (`acme.blumodel.studio`) doesn't resolve | Cloudflare DNS | the wildcard `*` record is missing (ONBOARDING_A_COMPANY.md, *Once*) |
| A showroom shows a bare "404 Not Found", not BluModel's page | the deploy's warning, `cloudflared.yml` | the tunnel config predates showrooms: rewrite it (*The tunnel*) and restart the tunnel |
| A showroom says "unknown showroom" or "temporarily unavailable" | Admin > Companies | the address isn't on a company (or a custom domain isn't marked verified), or the showroom is in setup, lapsed or suspended |
| Accounts or kitchens seem to come and go | the Cloudflare dashboard: the connectors of the `blumodel` tunnel | **two machines run the tunnel** (this PC and the Wyse): stop one at once (HOSTING.md, the split-brain rule) |
| A deploy ended `unhealthy` (exit 3) | `logs\server.log`, `logs\console.log` | `node scripts/deploy-local.mjs --rollback` puts the previous app back |

## Optional: Tailscale

Not needed for the public site. If you want the server on your own devices without going through
Cloudflare (say, to reach `/api/health` from your phone), `tailscale serve --bg http://127.0.0.1:8790`
publishes it inside your tailnet only. With `TRUST_PROXY=1` the server treats Tailscale's forwarded
headers like cloudflared's (both come from 127.0.0.1). Keep `PUBLIC_URL=https://blumodel.studio`:
checkout always returns to the public address. Don't use `tailscale funnel` for this; the tunnel is the
public door.
