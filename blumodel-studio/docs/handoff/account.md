# Handoff: the account package (settings, navigation, password resets, contractor details)

Built 2026-10-14/15 (three sittings, two usage-limit cut-offs). Commits are prefixed
`blumodel(account):`. QA: `node scripts/qa.mjs --pkg account --port 8870 --dist .build/account --strict-external`.

## What shipped

- **Account settings (`#/account`), in sections** (`src/components/AccountSettings.tsx`, `account.css`):
  Profile (name, optional phone normalised like every phone here, sign-in email changed only with
  the current password, which signs other devices out and tells the old address when email is on);
  Security (change password; signed-in devices with browser and system names, signed in / last
  active, sign out one or all others); Preferences (Appearance System / Light / Dark, Show cost
  estimator); Email notifications (sign-in alerts; only shown when the server has an email
  provider); Plan & billing; Company (contractors only: business name and phone, both required);
  Your data (export / delete). Server: `server/routes/account.mjs`, `server/account/*`,
  `server/auth/{device,sessions,userWire}.mjs`, migration `account-001` in
  `server/db/migrations/account.mjs`.
- **Appearance:** `src/lib/theme.ts` sets `data-theme="light|dark"` (resolved) and
  `data-theme-pref` on `<html>`; `public/theme-boot.js` (a classic script in the head) applies the
  saved choice before the first paint. Saved in this browser (`blumodel.theme`) and to the account
  (`/api/account/prefs`); the account's saved choice wins on sign-in. **The dark styles themselves
  are not part of this package**: stylesheets use the design tokens and only need
  `[data-theme="dark"]` to redefine them.
- **Cost estimator switch, default OFF** for everyone, signed out and device-only included
  (`src/lib/prefs.ts` `useShowEstimator`). Off hides the editor's Est. chip, the Estimate tab and the
  overview's estimated total; on restores them. A shared kitchen follows its link's own price
  setting; contractor quotes and the price book don't depend on it.
- **Navigation:** no orders item beside the account menu; the menu says *Make custom models* (route
  `#/orders` unchanged); *Contractor workspace* only for users on the Contractor plan (or with a
  company); everyone still sees the Contractor plan on Pricing.
- **Admins are never made by signing up or signing in.** `ADMIN_EMAILS` grants nothing; it only
  reserves its addresses (no non-admin account can change its email to one). Admins come from
  `node server/scripts/make-admin.mjs <email>` on the server; the startup log
  (`server/ops/startup.mjs`) and `npm run stripe:check` say so when no admin exists.
- **Forgot password:** *Forgot password?* on sign-in (`#/signin?forgot=1`). With
  `RESEND_API_KEY` or `POSTMARK_TOKEN` plus `EMAIL_FROM` (`server/email/`, plain fetch, never logs a
  key, address or body), the person gets a single-use link `#/signin?reset=<token>`; the answer is
  the same whether or not the address has an account; 3 emails an hour per address, 10 requests an
  hour per IP. With no provider the page says to contact support and **Admin > Users > Create reset
  link** makes one (admin only, audited without the link, shown once with Copy). Links: 256-bit,
  SHA-256 at rest (`password_resets`), 60 minutes, single use, newest only; using one sets the
  password, signs out every device and signs that browser in. A password change, an email change
  or deleting the account cancels outstanding links. Docs: `docs/OPERATIONS.md` *Settings* and
  *Password resets*.
- **Contractor business name and phone, required:** `PUT /api/pro/profile` refuses a company without
  both (`readCompanyContact` in `server/contractors/service.mjs`), the phone normalised. Setup step
  1 and the workspace Company page show field errors and focus the first one; Account settings >
  Company shows them too. A company saved before the rule with either missing opens a *Finish your company
  details* card instead of the workspace until fixed (not for a lapsed, read-only plan, which can't
  save).

## Tests

`server/test/account-settings.test.mjs`, `account-resets.test.mjs`, `account-contractor.test.mjs`,
`auth.test.mjs` (ADMIN_EMAILS grants nothing; make-admin works). Fake provider keys only and mocked
fetch: no test calls Resend, Postmark or Stripe.

## Left open / for Gabe

- Turning email on is Gabe's call: create a Resend or Postmark account, verify the sending domain,
  and add the three lines to `blumodel.env` himself (OPERATIONS.md shows them). Until then resets
  go through support and Admin > Users.
- `SUPPORT_EMAIL` should be set on the live server; without it the forgot page can only say
  "contact the BluModel Studio team" with no address.
- Existing live contractors with no business phone will see the *Finish your company details* card
  the next time they open the workspace. Existing phones in an old format (e.g. `555-0100`, no area
  code) still load, but the next save of the company asks for a full number.
- A browser that is already signed in and opens a reset link is sent to its home page (the app
  sends signed-in people away from the sign-in route); sign out first. Rare, and the link stays valid
  for its hour.
