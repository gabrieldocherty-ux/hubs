# Operating BluModel Studio on the home server

How the public site https://blumodel.studio runs on the Windows PC, and how to look after it. The
go-live and payments steps are in [LAUNCH.md](LAUNCH.md).

```
visitor ── https ──> Cloudflare ── tunnel 'blumodel' ──> cloudflared (this PC)
                                                          └─> http://127.0.0.1:8790  node server/index.mjs --prod
```

The server listens on 127.0.0.1 only: nothing on the LAN or the internet reaches it except through
the tunnel. Cloudflare terminates TLS; cloudflared forwards each request with `CF-Connecting-IP` and
`X-Forwarded-Proto: https`, which the server believes only because `TRUST_PROXY=1` and the request
comes from 127.0.0.1.

## The home folder

Everything lives in `%USERPROFILE%\Projects\BluModelStudio` (the "home"; `C:\Users\gdoch\Projects\BluModelStudio`).
The repo is only where new versions come from.

| Path | What | Kept by a deploy? |
| --- | --- | --- |
| `app\` | the deployed code: `dist\` (the built site), `server\`, `src\data\*.json`, `DEPLOYED.txt` (commit and time) | replaced |
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
The deploy:

1. stops this home's server gracefully and ends its supervisor (never the tunnel; never anything not
   started from this home), and refuses if something else holds port 8790;
2. copies the database (with `-wal`/`-shm`) to `data\backups\<timestamp>\`;
3. renames a pre-rename `data\mise.db` / `mise.env` if it finds them (`mise.env` is renamed, never opened);
   creates a `blumodel.env` **template** only if there is no settings file at all;
4. replaces `app\`, rewrites the supervisor scripts, starts the server and waits for `/api/health`.

The site is down for a few seconds (Cloudflare shows its 502 page). New database migrations run when
the new code starts; they are forward-only, which is why step 2 exists (see *Rollback* in LAUNCH.md).

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
| `ADMIN_EMAILS` | your email(s), comma separated | **grants nothing.** It only reserves the addresses: no other account can change its email to one. Admins are made with `make-admin` (below) |
| `DEMO_PAYMENTS` | `0` | `1` allows the labelled DEMO checkout in production when Stripe isn't set (never with a live key) |
| `TRUST_PROXY` | `1` | believe `CF-Connecting-IP` / `X-Forwarded-For` / `X-Forwarded-Proto` from 127.0.0.1 (per-visitor rate limits, Secure cookies, HSTS) |
| `LEGAL_NAME`, `SUPPORT_EMAIL`, `LEGAL_JURISDICTION` | the business's legal name, a support address, where it's established | the terms, privacy and refund pages, receipts and the footer's Contact link |
| `ANTHROPIC_API_KEY`, `BLUMODEL_LLM_MODEL` | optional | *Start from a photo* reads photos with Claude when both are set |
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

A home folder made before email existed has no email lines in `blumodel.env`. To turn email on, add
them yourself with Notepad (the deploy never edits an existing settings file):

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
set DB_PATH=%USERPROFILE%\Projects\BluModelStudio\data\blumodel.db
node server\scripts\make-admin.mjs you@example.com
```

It prints `you@example.com is now an admin.` (or that no account has that email). `--role studio`
makes a studio member instead; `--role customer` takes a role away. Admin > Users can change roles
too, but never your own. Until an admin exists, the server log says `Warning: No admin account
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

## Prices and custom models (since 2026-10-15)

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

They run only while you're logged on. A reboot with nobody logged on leaves the site down until you
log on (set Windows to sign you in automatically, or accept it).

## The tunnel

The tunnel `blumodel` (`064671cd-a658-4240-8626-c697b9f148ac`) already exists in Cloudflare, with DNS for
blumodel.studio routed to it; its credentials are `%USERPROFILE%\.cloudflared\064671cd-….json`. Nothing
in this repo creates, routes, logs into or deletes a tunnel.

```
node scripts/tunnel/setup-tunnel.mjs --dry-run      print the files it would write
node scripts/tunnel/setup-tunnel.mjs --validate     write them into the home, then check the config offline
```

`cloudflared.yml`: `blumodel.studio` → `http://127.0.0.1:8790` (connect timeout 10 s, no IPv6 racing,
keep-alive to the origin), anything else → 404. `--validate` runs `cloudflared tunnel --config <file>
ingress validate` and `ingress rule https://blumodel.studio/`, which only read the file. It refuses to
rewrite `run-tunnel.cmd` while that tunnel runs (stop it first); cloudflared reads `cloudflared.yml`
only when it starts, so restart the tunnel after a change.

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

## Optional: Tailscale

Not needed for the public site. If you want the server on your own devices without going through
Cloudflare (say, to reach `/api/health` from your phone), `tailscale serve --bg http://127.0.0.1:8790`
publishes it inside your tailnet only. With `TRUST_PROXY=1` the server treats Tailscale's forwarded
headers like cloudflared's (both come from 127.0.0.1). Keep `PUBLIC_URL=https://blumodel.studio`:
checkout always returns to the public address. Don't use `tailscale funnel` for this; the tunnel is the
public door.
