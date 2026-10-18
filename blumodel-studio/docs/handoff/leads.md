# Handoff: leads are people (2026-10-17)

Gabe's decision: "every blumodel subscriber that signed up will get an admin page that shows the people
that have used the site; people that design (users) will be required to give an email or phone number
as well as name; this will be called leads on the admin side."

Covered by `server/test/showroom-leads.test.mjs`, `server/test/tenancy-leads.test.mjs`,
`src/features/showroom/__tests__/visitor.test.ts`, and QA (`showroom`: before-you-start, journey,
privacy-showroom; `workspace`: leads, lead, lead-design-3d; `admin`: admin-companies).

## The visitor side

- Starting a design on a showroom (`#/new`, `#/k/<id>`, `#/local`) goes through **LeadGate**
  (`src/features/showroom/LeadGate.tsx`): "Before you start", in the company's colours. Name (required),
  email or phone (at least one; the phone is normalised like Account settings: "(905) 555-0142" or
  "+<digits>"), and the box "<Company> may contact me about my design." (required; the words are
  `startConsentText`, identical on client and server, test-pinned). Gated at the route
  (`src/features/showroom/routes.tsx`), never in ShowroomLanding.
- Skipped by: the showroom's team (signed in, owner/staff), a browser that already answered (its
  visitor cookie), and a signed-in showroom account already linked to a lead.
- `POST /api/visitor` makes or joins the tenant's lead and sets **`blumodel_visitor`** (httpOnly,
  SameSite=Lax, host-only, 400 days; stored as SHA-256 in `tenant_lead_visitors.token_hash`).
  Rate limit 10 / 10 min and 60 / day per address; honeypot `website`; CSRF header. 409
  `team_member` for staff, 403 `showroom_not_open` in setup. `GET /api/visitor` →
  `{ visitor: { name, email, phone, consentText, since } | null, required }`; `DELETE` forgets the browser.
- **Duplicates, not dedupe** (protect-004, audit 2026-10): typed details prove nothing, so a form
  whose email (else phone, `phone_key`) matches an existing lead in the tenant does **not** join it.
  It makes its own lead with `duplicate_of` = that lead; the existing lead is not touched (no blank
  filled, no activity, no timeline entry). Only the same showroom account behind both (`user_id`)
  joins. The team sees "Possible duplicate of <name>" (`Lead.duplicateOf = { id, name }`) and
  decides: `POST /api/workspace/leads/:id/merge` moves its browsers, designs, sends and timeline into
  the other lead (a `merged` timeline entry), `POST /:id/keep-separate` drops the label. Each browser
  is its own **visitor** either way and only ever sees its own designs and what it typed. Deleting a
  lead makes its oldest duplicate the lead for the address.
- **Designs**: `projects.visitor_id` (leads-001 rebuilt projects: `user_id` nullable, `visitor_id`,
  `lead_id`, CHECK one owner). `/api/projects*` and the export route accept the visitor as owner, on
  showrooms only. Each new design gets `lead_id` (the visitor's lead, else the account's).
  Started/saved (≤ 1 per design per 30 min)/came back (after 6 h away) go on the timeline.
- **Send this design** (`POST /api/leads`) now accepts email or phone, joins the visitor's (or
  account's) lead, makes the lead unread again, and marks the design sent (`sentAt` on the design).
- **Old account path**: signing up/in still works. A signed-in customer answers the form once
  (prefilled) and their designs join the lead; a visitor who then signs up on the same browser gets
  the lead linked and their visitor designs moved into the account (`GET /api/visitor` does it).

## The company side (Workspace > Leads)

- `GET /api/workspace/leads?status=&q=&sent=yes|no&before=<lastActiveAt>&limit=` →
  `{ leads, counts: { new, contacted, quoted, won, lost, total, unread, sent } }`;
  `/summary` → `{ counts }` (the tab badge = unread = not opened since they arrived or last sent).
- `GET /:id` → detail with `designs[]`, `sendsList[]`, `timeline[]` (marks read); `PATCH /:id`
  `{ status?, staffNotes? }` (status changes go on the timeline with the staff email);
  `DELETE /:id` deletes the lead, its visitors, timeline, sends, visitor-owned designs, revokes the
  "Sent to" links, keeps account-owned designs (unlinked); audited in `admin_audit` as
  `showroom_lead_delete` with ids and counts only. `GET /:id/designs/:designId` → the whole doc for
  the view-only 3D (`#/studio/leads/<id>/design/<designId>`).
- CSV export: one row per person (first seen, last active, status, name, email, phone, designs, sent,
  the latest send's postal code/budget/timeline/notes, staff notes, consent), `csvCell`-escaped.

## Us (Admin > Companies)

`AdminTenant.leads = { total, new, thisMonth, sent }` (counts only; no cross-tenant personal data).

## Data (`server/db/migrations/leads.mjs`, leads-001)

`tenant_leads`, `tenant_lead_visitors`, `tenant_lead_events`, `showroom_leads.lead_id`, projects
rebuilt. Every existing `showroom_leads` row became (or joined) a lead; a lead made from one keeps
that row's id, so old `#/studio/leads/<id>` links open the person.

## Open questions for Gabe

- The old "Book a call"-style lead notice email is still sent only on **Send**, not when someone
  merely gives their details. Should the company be emailed for every new lead?
- Privacy text says visitor data is kept while the company is a customer. A retention limit for
  leads who never send a design (e.g. delete after 24 months inactive) is not implemented.
