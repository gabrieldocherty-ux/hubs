# Handoff: launch, the client side (blumodel.studio going public)

Built 2026-10-14 on `claude/gallant-ptolemy-lm7fux` by the LAUNCH-CLIENT agent, finishing the WIP the
previous attempt left in b5ada01. The server side (payments posture, account export/delete, ops) is
the LAUNCH-SERVER agent's and is described in its own notes. Owned here: `src/**`, `public/**`
(not `public/draco`), `index.html`, `vite.config.ts`, `scripts/make-icons.mjs`,
`scripts/qa/routes/launch.mjs`.

## The legal pages are AI-drafted templates: have a lawyer review them

`#/terms`, `#/privacy` and `#/refunds` (`src/features/legal/content.tsx`) were **written by Claude
(an AI) from what the code does. They are not legal advice and nobody qualified has reviewed them.**
Before relying on them, have a lawyer in the operator's jurisdiction check at least:

- the refund windows (14 days for an unused kitchen unlock, 7 days for an unwanted renewal, the
  custom-model rules after modelling starts) against the consumer law where customers live
  (EU/UK 14-day withdrawal rights for digital content need the buyer's explicit consent to lose
  them, which checkout does not currently collect);
- the minimum age (18), the liability cap (12 months of fees), the governing-law clause, and the
  30-day notice for price changes and closing the service;
- the privacy policy's list of processors (Stripe, Cloudflare, Anthropic for Start from a photo),
  retention ("drops out of backups as they are replaced": check how long backups are actually
  kept), and whether a cookie notice is needed where you operate (one strictly necessary session
  cookie, no analytics);
- whether leads (a homeowner's details sent to one contractor at their request) need wording of
  their own in your jurisdiction.

The source comment at the top of `content.tsx` says the same. "Last updated" is `LAST_UPDATED` there.

**Who runs the site** comes from `GET /api/config` → `legal`, which the server fills from
`LEGAL_NAME`, `SUPPORT_EMAIL` and `LEGAL_JURISDICTION` in its settings file. Until they are set the
pages say "the operator of this site" and "the place where the operator of this site is established"
(never a placeholder), the footer shows no Contact link, and **admins** (only) see a red
*Legal details not set* badge on the legal pages and in the footer.

## What shipped

1. **Payment states** (`/api/config` → `payments`, read once by `src/lib/config.ts`):
   - `none`: Pricing, Billing, the Unlock dialog, the custom-model request and order pages and the
     Contractor sign-up say *Payments open soon* with disabled buttons; no checkout is started, and
     a 503 `payments_unavailable` from any endpoint reads as the same message
     (`src/lib/payments.ts`). Designing, saving and sharing are untouched. A device draft can still be
     saved to a free account from the dialog.
   - `demo`: one labelled DEMO banner style (`components/PaymentNotice.tsx`) on every paying screen.
   - `stripe`: no demo wording anywhere (pricing FAQ, Unlock dialog, orders, legal pages); every pay
     button goes to the hosted Stripe Checkout; never a card field.
   - Coming back: before leaving for a checkout the app leaves a marker in sessionStorage; the page
     it returns to says *Checkout cancelled. Nothing was charged.*, or *Payment received* (and, if the
     webhook hasn't landed yet, *still confirming*). The kitchen, Billing, the order page and `#/pro`
     confirm a Stripe `?session_id=` themselves and drop it from the address. The export the user
     clicked before paying finishes by itself.
2. **Legal and customer safety:** the three pages above; a legal footer (Terms, Privacy, Refunds,
   Contact once set) on every public page (landing, pricing, sign in/up, product, brand, Start from a
   photo, 404, legal, home, billing, account; the share bar carries Terms and Privacy); "By paying you
   agree to the Terms and the Refund policy" under every pay button; "By creating an account you agree
   to the Terms and the Privacy policy" on sign-up (and the dialog's account step).
   **Account settings** (`#/account`, also the account menu's dialog): *Download my data*
   (`GET /api/account/export`, saved under the server's filename) and *Delete my account* (password,
   explains that a renewing plan must be cancelled first and links to Billing on the 409; on success
   the landing page says the account is gone).

## How to see every state

QA-only override, read only when the page URL has `?qa`:
`http://127.0.0.1:<port>/?qa=1#/pricing?qa-payments=none|demo|stripe&qa-legal=ready|unset`. It is
remembered for that tab (sessionStorage `blumodel.qa.config`). `qa-crash=route|root` throws inside the
route's or the root error boundary.

`node scripts/qa.mjs --pkg launch --port 8852 --dist .build/client --strict-external`
