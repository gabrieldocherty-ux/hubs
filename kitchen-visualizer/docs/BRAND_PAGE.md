# Mise: The Brand Page (part of the Contractor account)

**Decision (Gabe, 2026-10-06):** "make brand portal a small part of the contractors account … make this fully fleshed out."
**Supersedes:** PRODUCT_SPEC §6 (self-serve brand portal for outside brands) and BUILD_PLAN §6 as a standalone product. The machinery built for §6 is kept: product editor, GLB report, moderation, brand page and analytics. **What changes is who uses it and where it lives.**
**Package:** B2 `brand-in-pro` (BUILD_PLAN §16).

There is no separate brand account and no portal for outsiders. **A contractor's company is the brand.** The Brand page is one tab of the Contractor workspace, included in the $40/month plan.

---

## 1. Why a contractor wants it

Today a contractor pays Mise to design with clients. The Brand page also makes Mise **send them clients**:
- Homeowners browsing Mise find the contractor's own cabinets and products.
- They see those products in realistic 3D.
- They drop them straight into their own kitchen designs.
- Then they contact the contractor.

The pitch line on the tab and on Pricing: *"Get found: put the cabinets you sell in front of homeowners designing their kitchens."*

## 2. Where it lives
- **Contractor workspace → Brand page** (`#/pro/brand`), the tab after *Price book*. Sub-pages: *Overview*, *Products*, *Leads*, *Settings*.
- The workspace Dashboard gets a Brand page card. It shows status (Not set up / In review / Live / Hidden: plan lapsed), plus this month's page views and new leads, with a badge for unread leads.
- Old portal routes redirect:
  - `#/brand` and `#/brand/*` → `#/pro/brand` for contractors.
  - Anyone else sees the Contractor plan pitch.

## 3. Setting it up (about two minutes)
One screen. Most of it is pre-filled from **Company** (name, logo, website, phone, email, service area), so nothing is retyped.

| Field | Notes |
|---|---|
| Public name | Defaults to the company name |
| Page address | `#/b/<slug>`, derived from the name; it can be changed until the page first goes live |
| Tagline | ≤ 80 chars, e.g. "Custom shaker cabinetry for the Hamilton area" |
| About | ≤ 600 chars |
| Cover image | Optional, through the files API (image, public on approval) |
| Price display | **From $X** (default: the lowest sell price) · **Show prices** (the sell price from the price book) · **Price on request**. Cost and margin are **never** public, whatever the setting |
| Contact | Lead form on/off (default on). Show phone publicly (default off). Show email publicly (default off) |

**Submit for review.** An admin checks the business is real (name, website, phone) and approves it, which makes the page **Live** with a **Verified contractor** badge. A rejection comes with a note, and the contractor can fix the page and resubmit. While it's in review the contractor sees a preview of exactly what will be public.

## 4. Choosing what to publish
- **Brand page → Products** lists their **My catalog** products, grouped by line. Each product has a **Show on my brand page** toggle, and there's also a *Publish whole line* action.
- Only the contractor's own catalog products can be published. Built-in products and other brands' products can't be re-published.
- Each product shows a **readiness checklist**. These must be met before it can be published:
  - a photo or a 3D model;
  - a name and dimensions;
  - at least one finish;
  - a price, or the page set to Price on request.
- **Publishing** sends the product to moderation (*Submitted*). Approved → **Live** on the brand page and in the public catalog. Rejected → the admin's note is shown on the product.
- **Editing a live product** keeps the live version public until the change is approved, the same way PRODUCT_SPEC §6.3 works.
- **Unpublish** is instant. **Limit:** 50 live products (`BRAND_PRODUCT_LIMIT`).
- The public copy of a product carries only what the price display allows. The **price book (cost, markup) is never part of it**.

## 5. What homeowners see
- **Brand page** `#/b/:slug`:
  - cover, logo, public name and the **Verified contractor** badge;
  - service area, tagline and about;
  - products grouped by line, each card linking to its product page (`#/p/:id`, realistic 3D viewer);
  - **Try in my kitchen** (adds it to one of their kitchens, or to the device planner);
  - **Contact <company>**.
- **Public catalog:** live products appear in every user's catalog panel under the brand's chip, with a "by <company>" line. Product pages show the brand's **Request a quote** button.
- **Lead form**, opened from the brand page or a product page:
  - name, email, optional phone, city/postcode and a message;
  - optionally **"Attach one of my kitchens"** (signed-in users pick a kitchen, and a view-only share link is created and attached);
  - the product they came from is attached automatically;
  - a required consent checkbox: "Share these details with <company> so they can contact me";
  - a confirmation screen afterwards;
  - spam protection: a rate limit per IP (not stored) and a honeypot field.

## 6. Leads inbox (`#/pro/brand/leads`)
- A list, newest first, showing name, location, the product or kitchen attached, the message, and the time.
- **Status:** New → Contacted → Won / Lost, plus private notes.
- One-tap **Call** (tel:) and **Email** (mailto:, with a pre-filled subject naming the product).
- The attached kitchen opens as the read-only share view.
- **New-lead badge** on the workspace nav and the Dashboard card.
- **No email notifications in this build** (there is no email infrastructure yet; this is listed as a next step).

## 7. Analytics (Brand page → Overview)
Last 7 / 30 / 90 days:
- brand page views, product views, adds to kitchens, quote/contact clicks and leads;
- a by-day chart;
- top products.

These come from the existing `product_events` plus new `brand_view` and `lead` types. No IPs are stored. Demo brands show "demo data".

## 8. Plan rules
- Included in the **$40/month Contractor plan**. No extra charge.
- **Plan lapses:** the brand page and its live products are **hidden** from the public (`#/b/:slug` shows "This page is unavailable", and the products leave the public catalog). Homeowners' kitchens that already use them keep them through snapshots. The leads inbox becomes read-only.
- **Renewal** restores everything that was live before, with **no re-review**.

## 9. Admin
- **Moderation:**
  - *Brand pages*, an application queue: business details, preview link, and Approve (→ Live + Verified) or Reject with a note;
  - *Products*, the submitted queue with the GLB report, `ProductStage` preview and a field-level diff against the live version: Approve / Reject with a note.
- **Brands:**
  - every brand, of kind **contractor** or **partner**, with status, live product count and lead count. Lead *contents* stay private to the contractor;
  - Suspend / Reinstate with a note, and Verify / Unverify.
- **Partner brands:** admins can create brands that aren't tied to a contractor, for curated catalog content. The fictional "(Demo)" seed brands are partner brands. They have no portal login and are managed from Admin → Brands.

## 10. Data (summary)
- `brands` gains:
  - `kind` (`contractor` | `partner`), `owner_user_id` (the contractor; null for partner brands), `tagline`, `about`, `cover_file_id`;
  - `price_display` (`from` | `show` | `on_request`);
  - `lead_form`, `show_phone`, `show_email`, `submitted_at`, `hidden_reason` (`lapsed` | null).
  - One brand per contractor.
- **Published products:** the contractor's product row gets `brand_id` and goes through `submitted → published`. On approval its public `live_spec` is written with only public fields, and its files become public. `price` follows `price_display`.
- `leads(id, brand_id → brands, product_id NULL, name, email, phone, location, message, share_token NULL, status new|contacted|won|lost, notes, created_at, updated_at)`. Only that brand's owner (and admins, as counts only) can read leads.
- `product_events.type` gains `brand_view`, `quote_click` and `lead`.

## 11. Open questions for Gabe (decisions made while fleshing out)
1. Verification is a **manual admin check**. There's no automated business lookup.
2. Leads are **not emailed** yet. The contractor sees them in Mise, with a badge.
3. The default public price display is **"From $X"**.
4. **50** live products per contractor brand.
5. Partner (non-contractor) brands exist only as **admin-created** catalog content.
6. Other contractors **can** see and use a contractor's published products in their own designs (it's the public catalog), but they never see costs.
