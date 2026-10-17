# BluModel Studio: the showroom pivot (decided 2026-10-17)

Gabe's decision: stop selling monthly plans to homeowners and contractors. BluModel Studio becomes
a **white-label virtual showroom that we build, host and run for kitchen and bath companies**. This
document is the plan every build package works from. Where it conflicts with PRODUCT_SPEC.md or
PLANS_AND_CONTRACTORS.md, this document wins. Those documents stay as history.

## 1. The product in one paragraph

A kitchen and bath company (a cabinet showroom, a design-build renovator, a bath shop) gets **its own
showroom website**: its name, logo, colours and web address. On it, homeowners design their kitchen or
bathroom in 3D **using that company's actual products**, which we model for them. Every saved design
becomes a lead in the company's inbox, with the plan, the product list and the customer's contact
details. The company's staff use the same showroom in their own sales meetings, and can turn any
design into a photoreal AI rendering. **We build it, host it and keep it running. The company never
installs anything.**

The pitch: *"Your own in-house virtual showroom, with your products, under your name, without hiring a
developer or learning Blender."* The AI renderings are a perk, not the headline.

What it is not: a precision CAD tool. It's a fast, believable rough draft that sells the job. Final
drawings still come from the company's designer.

## 2. Who pays for what

All prices are in CAD and set in `src/data/plans.json`, with the server as the only price authority.

| What | Price | What it covers |
|---|---|---|
| **Yearly license** | set per company when the deal is signed (default list price **$1,995/year**) | The showroom software, the setup, and modelling of the company's starting product range (default: up to **50 products**). More products are quoted separately. |
| **Monthly plan** | **$50/month** | **$25** for hosting and running the showroom, *including its own web address*. **$25** of AI rendering credits. |

- **The web address is included.** Every company gets `<company>.blumodel.studio` from day one. A company
  that owns a domain (for example `showroom.acmekitchens.ca`) can point it at us, and we connect it at
  no extra charge.
- **The license is sold by phone and invoiced.** Gabe closes deals by cold calling, so an admin records
  each license by hand: company, amount, start date, end date and how it was paid. Stripe isn't needed
  for this.
- **The monthly plan goes through Stripe.** An admin sends the company a Checkout link, and the company
  pays by card. A showroom is **live** only while its license is current **and** its monthly plan is paid,
  with a 14-day grace period on a failed payment. A lapsed showroom shows a polite "temporarily
  unavailable" page and keeps all data. It is never deleted automatically.
- **Rendering credits:** each paid month adds $25 of credits. Unused credits roll over for **3 months**,
  then expire, oldest first. Admins can add or remove credits, and every change is audited. The company
  sees its balance and a usage history.
- **Homeowners never pay.** Designing, saving, sharing and downloading a design are free on every
  showroom. The homeowner's design is the company's lead.

## 3. What gets removed

- **The homeowner plans:** Free/Unlimited, the $5 kitchen unlock, export paywalls and studio-render
  watermarks.
- **The Contractor plan,** its marketing and its 3 included models a month. The workspace itself is
  reshaped into the **company workspace** (section 5).
- **"Start from a photo":** the photo upload, the AI photo reading and the manual check-the-space form.
- **The public contractor directory** and the "Need a contractor?" finder on blumodel.studio. On a
  showroom, the end of the journey is **"Send this design to <Company>"** instead.
- **Retailer "Where to buy" links on showrooms.** A showroom sells the company's own products, so it
  must never send its visitors to RONA or Home Depot. The retail catalog stays as an internal library we
  model from, and as an optional "fill the gaps" range the company can switch on, but never with store
  links.

**Existing customers:** anything already paid keeps working until it ends. That covers unlocks,
subscriptions and orders, which need receipts, refunds and portal access. Nothing new can be bought.
Legacy data is kept.

## 4. Sites and hosts

One server and one database serve every showroom. **The request's host picks the tenant.**

- `blumodel.studio` (and `www.`) is **our sales site**, aimed at kitchen and bath companies. See section 6.
- `<slug>.blumodel.studio` is a company showroom.
- A custom domain recorded on the tenant is the same showroom.
- An unknown host returns 404, and a suspended showroom returns a "temporarily unavailable" page.
- Host comes from the `Host` header. Behind the Cloudflare tunnel this is the visitor's hostname. Never
  trust `X-Forwarded-Host` unless TRUST_PROXY applies.
- **Tenant isolation is the most important security property of the pivot.** Every query for
  products, kitchens, leads, files, team members and credits is scoped to the tenant resolved from the
  host. A session cookie set on one showroom must never work on another: cookies are host-only, so no
  `Domain=` attribute. Tests must prove that company A can't read or write anything of company B's
  through any route.
- **Hosting (Gabe's job, documented in OPERATIONS/HOSTING):** add a wildcard DNS record
  `*.blumodel.studio` pointing at the tunnel, and add `*.blumodel.studio` to the tunnel ingress. The
  generated `cloudflared.yml` must include it. Custom domains are added as Cloudflare custom hostnames
  (Cloudflare for SaaS), step by step in the docs.

## 5. Inside a showroom

**Visitors (homeowners), signed out or signed in on that showroom only:**

- The landing page is the company's brand, a short welcome, their featured product lines and a
  "Design your kitchen" button. If the company enables bathrooms, there's a "Design your bathroom"
  button too.
- The new-kitchen wizard covers room size, layout and the company's product lines. The brand step now
  lists the company's own lines.
- The editor works as today, with only that company's catalog, plus BluModel Basics if the company
  turns on "fill the gaps".
- At the end of the journey, the quiet hover-style link becomes a clear but calm **"Send this design to
  <Company>"**. It takes name, email, phone, postal code, an optional budget, timeline and notes, and
  shows a consent checkbox. The lead lands in the company's inbox with a link to the design.
- Downloads (plan PNG, product list) are free and branded with the company's logo and contact details.

**Company staff (the company workspace, `#/studio` on their showroom):**

- **Showroom:** name, logo, colours, welcome text, featured lines, contact details shown to visitors,
  service area, the web address(es), and a "fill the gaps with BluModel Basics" switch.
- **Products:** their catalog. Products modelled by us arrive here. Staff can quick-add parametric
  products, set their own prices and markup, and hide products. Model requests ("Request more products",
  with the UPC/scan flow we already built) go to our studio queue and are quoted, not paid in-app.
- **Leads:** the inbox, with status (new, contacted, quoted, won, lost), notes, the design link and a CSV
  export.
- **Renders:** "Make it photoreal" in the editor for staff, using credits. The page shows the balance,
  history and expiry dates. Visitor renders are off by default. A company can switch them on with a daily
  cap.
- **Team:** invite staff by email, with roles owner and staff.
- **Plan:** license dates, monthly plan status, receipts, and the Stripe portal for the card.

## 6. blumodel.studio, the sales site

Aimed at owners and sales managers of kitchen and bath companies. Plain, confident and specific.

- **Hero:** "Your own virtual showroom, with your products, under your name." Under it: "We build,
  host and run a 3D design website for your kitchen and bath company. Your customers design with your
  actual cabinets and fixtures, and every design comes to you as a lead." Buttons: "See a live demo
  showroom" goes to `demo.blumodel.studio`, and "Book a call".
- **How it works:** (1) We set up your showroom and model your products. (2) Customers design on your
  site, under your name. (3) You get leads with the plan and product list, and your team uses it in
  sales meetings.
- **What's included:**
  - your own web address
  - hosting and updates
  - modelling of your starting range
  - lead inbox
  - team accounts
  - photoreal AI renders ($25/month of credits)
- **Pricing:** the yearly license ("from $1,995/year, including setup and up to 50 of your products
  modelled") plus $50/month, broken down as **$25 hosting and your web address** and **$25 AI rendering
  credits**. All CAD.
- **Who it's for:** cabinet showrooms, kitchen and bath design-build firms, bath and plumbing
  showrooms, renovation companies with a showroom.
- **FAQ:**
  - Do we need to install anything? No.
  - Can we use our own domain? Yes, included.
  - What if we add products? We model them, quoted.
  - Is it a CAD tool? No, it's a sales tool; your designer still does final drawings.
  - Who owns the leads? You do.
  - Can we cancel? Yes.
- **Book a call / contact form:** company, name, phone, email, city and message. It goes to the admin
  panel as a sales lead, and to SUPPORT_EMAIL when email is configured.
- **Page `<title>` and meta description, plus Open Graph tags:** "BluModel Studio · Virtual showrooms
  for kitchen and bath companies" / "We build, host and run your own 3D kitchen and bath design website,
  with your products and your brand. Every customer design arrives as a lead."
- **Legal pages:** a B2B service agreement replaces the consumer Terms. There's a privacy policy that
  covers visitor data collected for companies, with the company as controller and us as processor, and
  a refund policy for the monthly plan. Business details come from LEGAL_NAME, SUPPORT_EMAIL and
  LEGAL_JURISDICTION.

## 7. AI renderings

Gabe's own architecture AI does the rendering. Its API isn't known yet, so:

- A provider interface, `server/renders/`, with `render(scene) -> image`.
- A **`demo`** provider for tests and QA that returns a stamped preview.
- An **`architect`** HTTP adapter configured by `ARCHITECT_AI_URL` and `ARCHITECT_AI_KEY` in
  `blumodel.env`. When those aren't set, the button shows "Photoreal renders are being set up" and
  nothing is charged.
- **Cost:** each render costs credits (`RENDER_CREDIT_CENTS`, default 25¢ until Gabe sets it). Credits
  are reserved before the call and refunded if it fails.
- The input is the current 3D view captured as an image, plus a short structured description of the
  room, its finishes and the products.

## 8. The admin panel (us)

Tenants are a new top-level tab. An admin can:

- create a company (name, slug, owner email);
- record a license (amount, dates, how paid);
- send the monthly Checkout link;
- see live/lapsed status;
- add hostnames;
- set "fill the gaps";
- adjust credits;
- suspend or restore a showroom.

The admin can also see each showroom's leads count and renders used, the sales-site "Book a call"
leads, and the studio modelling queue, grouped by company. Everything is audited.

## 9. The demo showroom

The `demo` tenant is a fictional company, "Northline Kitchen & Bath (Demo)". It uses a curated set of
real-looking products from our library, with no retailer links. The sales site links to it, and Gabe
uses it on calls. It must look excellent on a phone and a laptop.
