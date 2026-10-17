# Onboarding a company (after a sale)

Gabe's runbook from "they said yes" to "their showroom is live". What we sell is in
[SHOWROOM_PIVOT.md](SHOWROOM_PIVOT.md): a yearly license (list price $1,995 CAD, including setup and up
to 50 products modelled) plus $50 CAD/month ($25 hosting with their web address, $25 of AI render
credits). Running the server itself is in [OPERATIONS.md](OPERATIONS.md) and [HOSTING.md](HOSTING.md).

Every step below is either in **Admin** (sign in at https://blumodel.studio as an admin, then
*Admin*) or in **Cloudflare** (dash.cloudflare.com, the `blumodel.studio` zone). Nothing here needs a
terminal except the one-time setup and the demo showroom.

Contents: [Once: Cloudflare](#once-cloudflare) · [1 Create the company](#1-create-the-company) ·
[2 Record the license](#2-record-the-license) · [3 Send the monthly link](#3-send-the-monthly-link) ·
[4 Model their products](#4-model-their-products) · [5 Their web address](#5-their-web-address) ·
[6 Their own domain](#6-their-own-domain-cloudflare-for-saas) · [7 Go-live checklist](#7-go-live-checklist) ·
[Later](#later-renewals-lapses-and-changes) · [Troubleshooting](#troubleshooting)

## Once: Cloudflare

Do this once, before the first company. Without it `<slug>.blumodel.studio` doesn't resolve and
every showroom is unreachable from the internet, even though the server is ready.

**A. The wildcard DNS record.** Cloudflare → `blumodel.studio` → *DNS → Records → Add record*:

| Type | Name | Target | Proxy status | TTL |
| --- | --- | --- | --- | --- |
| CNAME | `*` | `064671cd-a658-4240-8626-c697b9f148ac.cfargotunnel.com` | **Proxied** (orange cloud) | Auto |

Check that `blumodel.studio` and `www` are there too, both proxied CNAMEs to the same
`…cfargotunnel.com` target (add `www` the same way if it's missing). The same record from a terminal
where cloudflared is logged in (the PC) is `cloudflared tunnel route dns blumodel "*.blumodel.studio"`.

- A record with a specific name (say `mail`, or a CNAME someone made for `demo`) **wins over the
  wildcard** for that name. Don't make records for showroom names: the wildcard covers them all.
- Universal SSL already covers `blumodel.studio` and `*.blumodel.studio`: *SSL/TLS → Edge
  Certificates* lists both as Active. It covers one level only, which is all a showroom uses
  (`acme.blumodel.studio`, never `a.b.blumodel.studio`).

**B. The tunnel sends every host to the server.** The tunnel `blumodel` is configured by the file
`cloudflared.yml` on the machine that runs it (a locally managed tunnel), so this is done there, not
in the dashboard. `scripts/tunnel/setup-tunnel.mjs` writes it with these rules:

```
blumodel.studio, www.blumodel.studio   -> http://127.0.0.1:8790   the sales site
*.blumodel.studio                      -> http://127.0.0.1:8790   every showroom
anything else                          -> http://127.0.0.1:8790   companies' own domains (step 6)
```

The last rule is what makes custom domains work: Cloudflare for SaaS delivers them with the
company's own hostname, so the tunnel can't list them, and the server already answers "unknown
showroom" (404) for any host it has no showroom for. A deploy prints a warning when the machine's
`cloudflared.yml` is older than this. To rewrite it, on the machine that runs the tunnel:

- Windows PC (cmd, in `%USERPROFILE%\Projects\BluModelStudio`): `stop-tunnel.cmd`, then from the
  repo's `blumodel-studio` folder `node scripts/tunnel/setup-tunnel.mjs --validate`, then
  `start-tunnel.cmd`.
- The Wyse on Linux: `sudo node /srv/blumodel-studio/repo/blumodel-studio/scripts/tunnel/setup-tunnel.mjs --home /srv/blumodel-studio --validate`,
  then `sudo systemctl restart blumodel-tunnel`.

`--validate` must end with five PASS lines, among them `https://acme.blumodel.studio/ (a showroom) goes
to http://127.0.0.1:8790 by the rule for *.blumodel.studio`. The site is offline for the seconds the
tunnel takes to restart.

*Only if the tunnel was moved to the dashboard* (HOSTING.md section 6, way B): the file isn't used.
Zero Trust → *Networks → Tunnels → blumodel → Configure → Public Hostname → Add a public hostname*:
subdomain `*`, domain `blumodel.studio`, type `HTTP`, URL `127.0.0.1:8790`; and the same for `www`.
A dashboard-managed tunnel's catch-all is a 404, so for step 6 each custom domain would also need its
own public hostname there. Way A (the file) avoids that.

**C. The demo showroom** (`demo.blumodel.studio`, Northline Kitchen & Bath (Demo), which the sales
site links to and Gabe shows on calls). On the server, once:

- Windows: `cd %USERPROFILE%\Projects\BluModelStudio\app`, then `node server\scripts\seed-demo-tenant.mjs`
- Linux: `sudo -u blumodel node /srv/blumodel-studio/app/server/scripts/seed-demo-tenant.mjs`

It prints the database it used, makes no accounts and is safe to run again. Add yourself to its team
in Admin > Companies > Northline > Team to edit it.

**D. Check from outside** (a phone on mobile data): https://demo.blumodel.studio shows Northline, and
https://anything-made-up.blumodel.studio shows BluModel's "unknown showroom" page. Both mean DNS, TLS
and the tunnel are right.

**E. Cloudflare for SaaS (only when the first company wants its own domain).** Cloudflare →
`blumodel.studio` → *SSL/TLS → Custom Hostnames*:

1. Enable Cloudflare for SaaS if asked (it needs a payment method on the account; Cloudflare's
   pricing page says how many custom hostnames are included before it charges per hostname).
2. Add the DNS record the companies will point at: *DNS → Records → Add record*, CNAME, Name
   `tunnel`, Target `064671cd-a658-4240-8626-c697b9f148ac.cfargotunnel.com`, **Proxied**. `tunnel` is a
   reserved name, so no company can ever be given it as its showroom address.
3. Back in *Custom Hostnames*, *Fallback Origin*: enter `tunnel.blumodel.studio`, *Add Fallback
   Origin*, and wait until it says **Active**. (Admin's own step list says `showrooms.blumodel.studio`
   as its example; use `tunnel.blumodel.studio`, which can't collide with a company called Showrooms.)

## 1. Create the company

Admin → **Companies** → **New company**:

- **Name**: the trading name visitors see ("Acme Kitchens").
- **Web address**: the part before `.blumodel.studio` (`acme`). Lowercase letters, digits and
  hyphens; names like `www`, `admin`, `support`, `tunnel` are reserved. It previews as
  `acme.blumodel.studio`. It can't be changed later without breaking links they've shared, so agree it
  on the call.
- **Owner email**: the person who runs it on their side.

It is created in **setup** (visitors see "temporarily unavailable" until step 7), with its own
subdomain already attached. Admin shows the owner's **sign-in link once, valid 7 days**: copy it and
email it from your support address ("This is your link to set up your showroom"). If it expires,
remove and re-add them under *Team*, which makes a new link.

## 2. Record the license

The license is sold on the phone and invoiced, never through Stripe. Once it's paid (or on the
terms you agreed), open the company → **Yearly license** → **Record a license**:

- **Amount (CAD)**: what was agreed (1995 at list price).
- **How it was paid**: invoice, e-transfer, cheque, card, cash, complimentary or other.
- **Starts** (empty: today) and **Ends** (empty: a year, the day before the same date).
- **Note**: the invoice number and what it includes ("setup + 50 products", or any extra
  products quoted).

**Record license**. A wrong one is voided from its history (kept, never deleted). The license is one
of the two things a live showroom needs.

## 3. Send the monthly link

The company → **Monthly plan** → **Create checkout link** → copy the link and send it to the owner. It
opens Stripe Checkout for $50 CAD/month by card. When they pay, Stripe's webhook marks the plan
**paid** (Admin shows the renewal date and the card), and each paid month adds **$25 of render
credits** (they roll over 3 months, oldest used first).

- A failed renewal gets **14 days of grace** before the showroom lapses; Admin shows *Grace until*.
- **Complimentary** (for a pilot, or a deal that includes the hosting) needs a reason and is audited.
- The owner manages the card later from their own workspace (Plan → the Stripe portal).

The monthly plan is the second thing a live showroom needs.

## 4. Model their products

The license includes their starting range (default up to 50 products; Admin's company list shows
products against the 50 included). Get the list from them: product lines, door styles and finishes,
the sizes they sell, photos or spec sheets, and their prices if they want prices shown.

To load them, add yourself to their team: the company → **Team** → your email, role staff. That gives
you a sign-in link **on their showroom** (accounts there are separate from your blumodel.studio
account). Then on `https://acme.blumodel.studio/#/studio`:

- **Products → Quick add a product** for each one: name, product line, type, sizes, finishes,
  photos, and **Upload a .glb model** for the 3D model we made. **Add to my showroom**. Prices and
  costs are optional (costs and markup stay private to their team).
- **Showroom**: name, logo, colours, welcome text, featured lines, the contact details visitors see,
  and "fill the gaps with BluModel Basics" (on: visitors can finish a kitchen with our basic range
  where theirs has gaps; never with store links).

Products they ask for later come in as requests (their *Request more products*) and land in
**Admin → Studio**, where you quote, start and deliver them. They're not paid in the app.

Remove yourself from their team when you're done if they'd rather you weren't on it.

## 5. Their web address

Nothing to do: `acme.blumodel.studio` was attached in step 1 and the wildcard DNS record
([Once](#once-cloudflare), A) already routes it. Before launch it answers with "temporarily
unavailable"; after step 7 it is their showroom.

Another `.blumodel.studio` name (a second brand, say) is the company → **Web addresses** → **Add an
address**, kind *Another .blumodel.studio name*. No Cloudflare change is needed for it either.

## 6. Their own domain (Cloudflare for SaaS)

Included in the monthly plan. Use a **subdomain** of theirs, like `showroom.acmekitchens.ca` or
`design.acmekitchens.ca`: most DNS hosts can't point a bare `acmekitchens.ca` at another company with
a CNAME, and their main website usually lives there anyway. Needs [Once](#once-cloudflare), E.

1. **Admin**: the company → **Web addresses** → **Add an address** → `showroom.acmekitchens.ca`, kind
   *Their own domain* → **Add address**. It shows **Not verified**, and until step 6 below that
   address answers "unknown showroom", so nobody sees a half-set-up page.
2. **Cloudflare** → `blumodel.studio` → *SSL/TLS → Custom Hostnames* → **Add Custom Hostname**:
   - Custom hostname: `showroom.acmekitchens.ca`
   - Minimum TLS version: 1.2
   - Certificate validation method: **HTTP** (it completes by itself once their CNAME is in place).
     Choose **TXT** instead if they want the certificate issued before they switch the CNAME.
   - **Add Custom Hostname**.
3. **Send the company their DNS records** (copy them from the hostname's row in Cloudflare; it lists
   exactly what's needed):
   - a **CNAME**: name `showroom` (in the `acmekitchens.ca` zone), target `tunnel.blumodel.studio`;
   - the **TXT** record Cloudflare shows for hostname verification (`_cf-custom-hostname.showroom`),
     and a certificate TXT record if it shows one (with TXT validation).

   If their DNS is on Cloudflare too, tell them to leave the CNAME **DNS only** (grey cloud).
4. **Wait** until the row shows **Hostname status: Active** and **Certificate status: Active**. This
   is minutes once their records are in, occasionally a few hours (it depends on their DNS's TTL).
   *Refresh* on the row re-checks.
5. **Test**: open https://showroom.acmekitchens.ca. With a valid padlock you should see BluModel's
   "unknown showroom" page: traffic, certificate and tunnel all work, the server just doesn't know
   the address yet. A Cloudflare error page instead means a step above isn't finished
   ([Troubleshooting](#troubleshooting)).
6. **Admin**: the address → **Mark verified**. Reload https://showroom.acmekitchens.ca: their
   showroom. **Make main** if they want links (lead emails, shared designs) to use it instead of
   `acme.blumodel.studio`, which keeps working.

Removing it later: **remove** the address in Admin first, then delete the custom hostname in
Cloudflare, then they remove their CNAME.

## 7. Go-live checklist

On the company's page in Admin and on their showroom, every line true:

- [ ] **Yearly license** current (Admin: license dates cover today).
- [ ] **Monthly plan** paid or complimentary (Admin: *Paid* with a renewal date).
- [ ] **Products**: their starting range is in, each with a model or a photo, in the right product
      line, hidden ones hidden. Open the editor on their showroom and place one of each type.
- [ ] **Showroom tab**: logo, colours, welcome text, featured lines, contact details and service
      area are theirs; "fill the gaps" set the way they want; bathrooms on or off.
- [ ] **Team**: the owner has signed in (their link worked) and added the staff they want.
- [ ] **Web addresses**: `acme.blumodel.studio` listed; their own domain **Verified** (and *Main* if
      wanted), or not requested.
- [ ] **Launch**: the company → status → **Launch showroom**. Admin says why if it would come out
      lapsed (license or monthly plan missing).
- [ ] **From a phone on mobile data**, signed out: the landing page shows their brand, *Design your
      kitchen* opens the wizard with their lines, a saved design's **Send this design to Acme**
      arrives in their **Leads** tab (send one test lead, then mark it lost).
- [ ] **Renders**: their credits show $25 per paid month; one "Make it photoreal" works from staff
      (or says renders are being set up, until the render service is configured).
- [ ] Tell the owner: their address, how leads arrive (the Leads tab, and an email notice when email
      is on), where to change branding, and who to call.

## Later: renewals, lapses and changes

- **License renewal**: before the end date, invoice them and record the next license (it can start
  the day after the current one ends). An expired license lapses the showroom: visitors see
  "temporarily unavailable", nothing is deleted, and recording a license brings it straight back.
- **Monthly plan lapses** after the 14-day grace on a failed card. They fix the card in their portal
  (or you send a new checkout link); paying brings it back by itself.
- **Suspend** (non-payment, a dispute): the company → status → **Suspend**, with a reason. Restore
  with **Launch showroom**. Data is never removed automatically.
- **Credits**: the company → **Render credits** → add or remove with a reason (audited; never below
  zero).
- **Leaving**: cancel the monthly plan (at the end of the paid month), let the license run out, and
  remove their custom hostname in Cloudflare. Export their leads for them first if they ask (their
  Leads tab has a CSV export).

## Troubleshooting

| Symptom | Usually |
| --- | --- |
| `acme.blumodel.studio` doesn't resolve (browser: "server not found") | the wildcard `*` record is missing or not proxied ([Once](#once-cloudflare), A) |
| A bare "404 Not Found" (not BluModel's page) on a showroom while blumodel.studio works | the tunnel's `cloudflared.yml` predates showrooms: rewrite it and restart the tunnel ([Once](#once-cloudflare), B). A deploy's output says so too |
| Cloudflare **1033/502** everywhere | the tunnel or the server is down (OPERATIONS.md, Troubleshooting) |
| "unknown showroom" on `acme.blumodel.studio` | the web address isn't on any company: check the spelling in Admin > Companies > the company > Web addresses |
| "temporarily unavailable" | the showroom is in setup, lapsed or suspended: Admin shows which and why |
| Custom domain: Cloudflare error **1001** or **1014** | their CNAME is missing, points somewhere else, or is proxied in their own Cloudflare account: make it DNS only, target `tunnel.blumodel.studio` |
| Custom domain: certificate error, or the hostname stays *Pending* | the TXT records aren't in yet, or their DNS still serves an old record (TTL): check with `nslookup -type=cname showroom.acmekitchens.ca`, then *Refresh* in Custom Hostnames |
| Custom domain shows "unknown showroom" with a valid padlock | everything works except Admin: **Mark verified** (step 6.6) |
| Custom domain: error **1016** | the fallback origin record `tunnel` is missing or the fallback origin isn't Active ([Once](#once-cloudflare), E) |
| The owner's sign-in link says expired | it lasts 7 days: remove and re-add them in the company's Team for a new one |
