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
3. **Polish and phones:**
   - **Fonts are self-hosted**: Fraunces (roman + italic, with its optical-size axis), Instrument
     Sans (roman + italic) and JetBrains Mono, variable 400-700, latin and latin-ext subsets, as
     woff2 in `public/fonts/` with the SIL OFL in `public/fonts/OFL.txt`, declared in
     `src/fonts.css`. Nothing the site serves names a Google host: `index.html` has no font links,
     and `vite.config.ts` rewrites drei's unused default Draco URL (gstatic) to `/draco/`.
   - **Installable, no service worker**: `public/manifest.webmanifest` (*BluModel Studio* /
     *BluModel*, standalone, start `/#/`), icons 192, 512, maskable 512, an SVG favicon and a
     180px apple-touch-icon, all made from the brand mark by `node scripts/make-icons.mjs`
     (headless Edge through the QA driver; `--check` verifies sizes); theme-color; canonical,
     og and twitter tags for https://blumodel.studio/.
   - **Friendly failure screens**: a 404 for any unknown address; a root error boundary and one per
     route ("Something went wrong · Reload; your design is saved", pending edits are flushed
     first, a chunk missing after a redeploy reloads once by itself); a *Can't reach BluModel
     Studio · Retry* banner whenever the API doesn't answer.
   - **Phones and tablets** (`src/launch.css`, the `pointer: coarse` block): every control is at
     least 44 × 44 px and every text field 16 px; headers that also carry steps or a button drop
     the wordmark below 480px rather than overlap it; header buttons never wrap; 100dvh and the
     safe-area insets on modals, the editor shell and fixed bars. The known cosmetic issues (home
     card names below 980px, the top bar's "Sign in to save" wrapping) were fixed in the
     integration pass and their markers are gone; no QA route carries a `knownIssue`.
4. **QA** (`scripts/qa/routes/launch.mjs`, 69 routes): every payment state on pricing, Billing,
   the Unlock dialog (signed in and on a device), model orders and the Contractor sign-up; the
   DEMO checkout finishing the export the user clicked; the return from a cancelled or paid
   Stripe checkout on Billing, a kitchen, an order and `#/pro`; the three legal pages with and
   without the operator's details, the admins-only badge, and the footer on every public page;
   account export (no other user's data, no hash) and delete (the 409 for a renewing plan, a wrong
   password, then the real thing); the 404; both error boundaries; the connection banner; the
   manifest, icons, head tags and self-hosted fonts; and the **phone pass**: every routed screen
   for a visitor, a customer, a contractor, an admin and a brand at 360×740, 390×844, 414×896,
   844×390 and 820×1180, failing on sideways scroll, clipped or off-screen text, a tap target
   under 44px or a field under 16px (each problem names the element's tag and classes).

## How to see every state

QA-only override, read only when the page URL has `?qa` **and** the page is on a loopback address
(127.x, localhost, [::1]; never on blumodel.studio, so a crafted link can't show a DEMO banner over
real checkout or another business's name on the Terms):
`http://127.0.0.1:<port>/?qa=1#/pricing?qa-payments=none|demo|stripe&qa-legal=ready|unset`. It is
remembered for that tab (sessionStorage `blumodel.qa.config`). `qa-crash=route|root` throws inside the
route's or the root error boundary (also loopback only).

`node scripts/qa.mjs --pkg launch --port 8852 --dist .build/client --strict-external`
