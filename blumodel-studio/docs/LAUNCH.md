# Going live: blumodel.studio with real payments

An ordered runbook. Part A puts the server in its new home behind the tunnel (the main Claude
session does it; it's here so you can check or redo it). Part B is yours: the Stripe account, the keys
and the first real purchase. Part C is Cloudflare. Then *Rollback*. Day-to-day running is in
[OPERATIONS.md](OPERATIONS.md).

Part A is the original Windows PC. Moving the site to another machine (the Dell Wyse 5070, on Ubuntu
Server or Windows) is [HOSTING.md](HOSTING.md): there the install scripts do part A's work, the
settings file is made fresh with a **new** Stripe key (part B's B3 and B6), and the cutover follows
the one-machine-runs-the-tunnel rule. Parts B and C apply unchanged.

Rules for every step that touches a key or secret:

- Paste keys **only** into `blumodel.env` with Notepad. Never into a chat (including Claude), an
  email, a screenshot, a ticket or git.
- Nothing in this repo prints a key. If a tool ever shows you one, treat that key as exposed and roll it.
- `npm run stripe:check` is the way to confirm the setup: it reads the file itself and prints only
  PASS / FIX lines.

## Part A: the home server (reference)

Run from the repo's `blumodel-studio\` folder unless it says otherwise.

1. **Stop the old server.** `%USERPROFILE%\Projects\Mise\stop-server.cmd`, then wait 10 seconds for its
   supervisor to notice and exit. Confirm nothing listens: `netstat -ano -p tcp | findstr :8790`
   prints nothing. (The `stopped` marker it leaves is removed by the move in step 2.)
2. **Move the home.** `node scripts/migrate-home.mjs --dry-run`, read it, then
   `node scripts/migrate-home.mjs`. Result: `%USERPROFILE%\Projects\BluModelStudio` with
   `data\blumodel.db` (the old `mise.db` and its `-wal`/`-shm`, renamed), `blumodel.env` (the old
   `mise.env`, renamed without being opened, now readable only by your account), backups, uploads and
   logs; the old supervisor scripts set aside as `*.pre-migration`. It refuses, changing nothing, if
   step 1 didn't stop everything.
3. **Deploy the new code.** `npm run deploy:local`. It writes the new supervisor and starts the server.
   The last line should read `BluModel Studio 0.1.0 is up at http://127.0.0.1:8790 (payments: …)`.
   If there was no settings file at all, it creates a `blumodel.env` template (payments off until
   part B).
4. **Tunnel files.** `node scripts/tunnel/setup-tunnel.mjs --validate`: three PASS lines
   (config valid, `https://blumodel.studio/` → `http://127.0.0.1:8790`, anything else → 404).
5. **Tasks.** `schtasks /Delete /TN MiseKitchenServer /F`, then
   `node scripts/register-tasks.mjs --dry-run` and `node scripts/register-tasks.mjs`
   (`BluModelStudioServer`, `BluModelTunnel`, both at logon, hidden; it refuses a task whose
   launcher doesn't exist yet, which is why the tunnel files come first).
6. **Switch the tunnel over.** Today blumodel.studio is served by a holding page through a cloudflared
   started with `%USERPROFILE%\Projects\BluModelHolding\cloudflared.yml` (→ port 8795). Stop that
   cloudflared (Task Manager, or `Stop-Process` on the cloudflared whose command line names
   `BluModelHolding`), then start the new one: `%USERPROFILE%\Projects\BluModelStudio\start-tunnel.cmd`
   (or `schtasks /Run /TN BluModelTunnel`). `logs\tunnel.log` shows `Registered tunnel connection`;
   https://blumodel.studio/api/health answers `{"ok":true,…}`. Only one connector should serve the
   tunnel: don't leave the holding one running alongside.
7. **Check from outside** (a phone on mobile data): https://blumodel.studio loads, signs up, saves a
   kitchen. `https://blumodel.studio/robots.txt` is served.

## Part B: payments (you)

### B1. Roll the exposed key — first

The live secret key that went into the old settings file (`mise.env`, now `blumodel.env`) counts as
exposed. Retire it before anything else:

1. Stripe Dashboard → **Developers → API keys** → the **Secret key** row → **⋯ → Roll key…** →
   expiration **Now** → Roll.
2. Don't copy the new secret key into anything; part B3 makes a restricted key instead. (If you ever
   need the full secret key, keep it in Stripe.)

Until B6 the server has a dead key in `blumodel.env`: checkout will fail with a Stripe error. If you
want the site to say *Payments open soon* meanwhile, empty `STRIPE_SECRET_KEY=` in `blumodel.env` and
restart (`stop-server.cmd`, `start-server.cmd`).

### B2. Activate the account and set what customers see

Stripe Dashboard, live mode:

1. **Activate payments** (Settings → Business → *Account details* / the activation banner): business
   type and details, your identity, the bank account for payouts. Until this is done `charges_enabled`
   is false and `stripe:check` says so.
2. **Public details** (Settings → Business → *Public details*): business name, support email (the one
   you'll put in `SUPPORT_EMAIL`), website `https://blumodel.studio`.
3. **Statement descriptor** (Settings → Business → *Public details* / *Statement descriptor*):
   `BLUMODEL STUDIO` (5-22 characters; what appears on card statements; `stripe:check` shows the
   one it finds).
4. **Customer emails** (Settings → *Customer emails*): turn on *Successful payments* and *Refunds*.
   The app sends no email of its own; Stripe's receipts are the customer's record.
5. **Tax:** prices are fixed in Canadian dollars since 2026-10-15 ($5 CAD kitchen unlock, offered only in
   the export dialog; $15 CAD/month Unlimited; $99 CAD/month Contractor, which includes 3 custom models a
   month; custom models aren't sold on their own) and checkout adds no tax. If you are required to collect sales tax/VAT
   where your customers are, register and turn on **Stripe Tax**, and ask for checkout to set
   `automatic_tax` (a code change: the server doesn't do it today). Get advice for your jurisdiction;
   this runbook can't decide it.

### B3. A restricted key for the server

Developers → API keys → **Create restricted key** → name it `BluModel Studio server`. Set exactly
these (everything else **None**); they come from `server/payments/webhookEvents.mjs`:

| Resource (as Stripe names it) | Access | Why |
| --- | --- | --- |
| Checkout Sessions | Write | start a checkout, and read it back when the buyer returns |
| Customers | Write | Checkout creates the customer on a first purchase and reuses it after |
| Products | Write | the plan product a plan change is billed against (made once per plan) |
| Prices | Write | the inline monthly price a plan change sets |
| Subscriptions | Write | cancel, resume and change a plan |
| Customer portal | Write | the *Manage payment & invoices* button |
| Refunds | Write | refunding a custom-model order from Admin |
| Webhook Endpoints | Read | `stripe:check` confirms the endpoint and its events |
| Account (Connect → Accounts, or *All core resources* read) | Read | `stripe:check` reads the business name and charges enabled |

Create it and copy the `rk_live_…` value straight into B6. If `stripe:check` later says a permission
is missing, it names it (Stripe's `rak_…` name): edit the key and add just that.

### B4. The webhook endpoint

Developers → **Webhooks** (in Workbench: *Webhooks → Add destination*) → **Add endpoint**:

- Endpoint URL: `https://blumodel.studio/api/webhooks/stripe`
- Events from your account, exactly these ten (the server acts on all of them; a test checks this
  list against the code):
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `charge.refunded`
- API version: your account's default is fine (the server reads both the old and the 2025+ shapes of
  subscriptions and invoices).

Save, then **Reveal** the endpoint's **Signing secret** (`whsec_…`) and copy it into B6. The server
checks every delivery's signature with a 5-minute tolerance, ignores repeats, checks amount and
currency against what it asked for, and answers 503 (so Stripe retries for up to 3 days) whenever
its own Stripe setup is off.

### B5. The Customer portal

Settings → **Billing → Customer portal** (live mode):

- Customers can **update payment methods** and **view invoice history**: on.
- **Cancel subscriptions**: on, **at the end of the billing period** (what the app promises).
- **Switch plans**: off (plan changes go through the app, which knows the plans).
- Business information: Terms `https://blumodel.studio/#/terms`, Privacy `https://blumodel.studio/#/privacy`.
- **Save**. The portal's return link is `https://blumodel.studio/#/account/billing`, set by the server.

### B6. Fill in `blumodel.env`

`notepad %USERPROFILE%\Projects\BluModelStudio\blumodel.env`. It should end up with:

```
STRIPE_SECRET_KEY=rk_live_…           (B3)
STRIPE_WEBHOOK_SECRET=whsec_…         (B4)
PUBLIC_URL=https://blumodel.studio
ADMIN_EMAILS=<your email>
DEMO_PAYMENTS=0
TRUST_PROXY=1
LEGAL_NAME=<the business's legal name>
SUPPORT_EMAIL=<the support address from B2>
LEGAL_JURISDICTION=<where the business is established, e.g. Ontario, Canada>
```

`ANTHROPIC_API_KEY` / `BLUMODEL_LLM_MODEL` are optional (Start from a photo). Remove any line you
don't recognise. Save and close.

The terms, privacy and refund pages were drafted by Claude from what the code does and **have not been
reviewed by a lawyer**; `docs/handoff/launch.md` lists what to have checked (refund windows, consumer
withdrawal rights, the age limit, liability, governing law). Do that before taking money from the public.

### B7. Restart and read the log

In the home folder: `stop-server.cmd`, then `start-server.cmd`. The newest lines of
`logs\server.log` should include:

```
INFO  Read <n> settings from …\blumodel.env …
INFO  BluModel Studio listening on http://127.0.0.1:8790 (payments: stripe, production)
INFO  Stripe: LIVE mode
```

and no `Warning:` lines except ones you've decided to accept. `Stripe is NOT on:` followed by reasons
means a value is wrong; fix it and restart.

### B8. `npm run stripe:check`

From the repo's `blumodel-studio\` folder: `npm run stripe:check`. It finds the home's `blumodel.env`,
says `live` or `test`, and checks (read-only): the key works; the account's business name; charges
enabled; an enabled webhook endpoint for `https://blumodel.studio/api/webhooks/stripe` sending all ten
events; an active Customer portal; `LEGAL_NAME`, `SUPPORT_EMAIL`, `LEGAL_JURISDICTION`,
`TRUST_PROXY`, `DEMO_PAYMENTS`; and whether the production server would take payments through Stripe.
Fix every `FIX` line and run it again until the summary has none.

Admins are not made by `ADMIN_EMAILS` (there is no email verification, so anyone could sign up
with your address first). Sign up on https://blumodel.studio with your own email, then on the home
machine run `make-admin` (OPERATIONS.md, *Admins*). The server log warns `No admin account exists`
until one does.

### B9. Part C (Cloudflare) now

Do part C before the first purchase: Bot Fight Mode can affect webhook deliveries, and you want to
see that before a customer does.

### B10. The first real purchase, and a refund

With your own card, on https://blumodel.studio from a normal browser window:

1. Sign up with an email that is **not** your admin account (admins can export without paying, so
   an admin account would skip the paywall).
2. Make a kitchen, press any **Export**, choose **Unlock this kitchen - $5 CAD once**. You land on Stripe's
   checkout page (`checkout.stripe.com`): pay.
3. You return to the kitchen: *Payment received*; the export you clicked finishes; Account → Billing
   lists the receipt.
4. Stripe Dashboard → **Payments**: the $5 CAD payment. **Webhooks** → the endpoint → recent deliveries:
   `checkout.session.completed` answered **200**.
5. Refund it: the payment → **Refund** → full amount. The delivery `charge.refunded` answers 200 and
   Stripe emails a refund receipt. Note: the app **keeps the kitchen unlocked** after a refund made in
   the Stripe dashboard (only custom-model orders change state on a refund).
6. Optional, the subscription path: **Unlimited - $15 CAD/month** with the same account; then Billing →
   *Manage payment & invoices* opens the Stripe portal and comes back; *Cancel* keeps the plan to the
   end of the month; refund the charge in the dashboard.

If a delivery isn't 200: Stripe shows the response. 400 *Invalid signature* = the wrong
`STRIPE_WEBHOOK_SECRET`; 503 = the server isn't in Stripe mode (B7); a Cloudflare challenge/403 page =
part C's bot or WAF settings (see C2).

## Part C: Cloudflare dashboard (blumodel.studio zone)

1. **SSL/TLS → Edge Certificates:** *Always Use HTTPS* **on**; *Minimum TLS Version* **1.2**;
   *Automatic HTTPS Rewrites* on. Leave Cloudflare's own HSTS **off**: the server already sends
   `Strict-Transport-Security: max-age=31536000` over https, without `includeSubDomains` or `preload`,
   which are hard to undo.
2. **Security → Bots:** *Bot Fight Mode* **on**. Then repeat B10 step 4 (or send a test event from the
   Stripe endpoint page) and confirm deliveries still answer 200. If they show a Cloudflare challenge
   or 403, turn Bot Fight Mode off: on the Free plan it can't exempt one path.
3. **Security → WAF → Rate limiting rules → Create rule** (the Free plan allows one):
   - Name: `API writes`
   - If incoming requests match: *URI Path* `starts with` `/api/` **and** *Request Method*
     `is not equal to` `GET` **and** *URI Path* `does not equal` `/api/webhooks/stripe`
     (expression: `(starts_with(http.request.uri.path, "/api/") and http.request.method ne "GET" and http.request.uri.path ne "/api/webhooks/stripe")`)
   - Same characteristics: IP. When rate exceeds: **30 requests per 10 seconds**. Then: **Block** for 10 seconds.
   The server has its own per-visitor limits on sign-up, login, uploads, leads and photo analysis; this
   rule takes floods off the PC before they reach it.
4. **Security → WAF → Managed rules:** turn on the **Cloudflare Free Managed Ruleset** (on a paid plan,
   the Cloudflare Managed Ruleset and the OWASP Core Ruleset too). After B10, check **Security → Events**
   for anything blocked on `/api/webhooks/stripe` or uploads (`PUT /api/files`); add a skip for that path
   if so.
5. **Things that inject scripts** — turn them **off**, because the site's Content-Security-Policy
   blocks scripts and connections that aren't its own and they would only fill the console with errors:
   *Speed → Optimization → Rocket Loader*, *Scrape Shield → Email Address Obfuscation*, and the automatic
   *Web Analytics* (RUM) injection.
6. Caching needs nothing: hashed files under `/assets/` are `immutable` for a year, `index.html` is
   `no-cache`, and `/api/*` is `no-store`.

## Rollback

- **Stop taking payments now** (keep the site up): in `blumodel.env` empty `STRIPE_SECRET_KEY=`, restart.
  The site says *Payments open soon*; checkout and billing answer 503. Webhooks then answer 503 too and
  Stripe retries them for 3 days, so existing subscriptions catch up once you restore the key. To refund
  or cancel customers, use the Stripe dashboard.
- **Bad key or secret pasted:** restart shows `Stripe is NOT on:` with the reason; fix the line and
  restart. If a key was exposed, roll it (B1) and make a new restricted key (B3).
- **Back to the holding page:** `stop-tunnel.cmd` in the home, then start the holding page's
  cloudflared again (`cloudflared tunnel --config %USERPROFILE%\Projects\BluModelHolding\cloudflared.yml run`,
  with its server on 8795 running). The BluModel server can keep running on 127.0.0.1.
- **A deploy went wrong:** `node scripts/deploy-local.mjs --rollback` puts back the app that deploy
  replaced (every deploy keeps it as `app.previous\`), restarts the server and checks its health; on a
  machine set up from HOSTING.md the update does this by itself. Older than that: redeploy the commit
  you want (check it out in another folder, build, `node scripts/deploy-local.mjs --dist <its dist>`).
  If that version can't read the database the new code migrated, stop the server and restore the
  copy the bad deploy made first:
  `node app\server\scripts\restore.mjs --from data\backups\<timestamp>\blumodel.db` (OPERATIONS.md).
  Anything written since that copy is lost, so prefer fixing forward when only code is wrong.
- **Undo the move** (before customers): stop the server, `schtasks /Delete /TN BluModelStudioServer /F`
  and `BluModelTunnel`, and put the holding page back. The old `app\` was replaced by the deploy, so the
  old version runs only from a redeploy of its commit (`2e6cf2c`) into a home of its own; the data is in
  `data\blumodel.db` and in `data\backups\`.
