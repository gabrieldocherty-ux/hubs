# Handoff: the owner's admin panel (2026-10-16)

Gabe asked for "an admin panel as well". `#/admin/:tab` already existed (overview, moderation,
brands, retailers, studio, revenue, billing, users); it is now a complete owner's panel. Every
earlier tab still works. Tab order: Overview, Users, Contractors, Moderation, Brands, Retailers,
Studio, Revenue, Billing, System, Audit. The studio role still sees only Studio.

## Where it lives

| Part | Files |
|---|---|
| Server routes | `server/routes/adminPanel.mjs` (module `admin-panel`), `server/routes/admin.mjs` (list + role PATCH) |
| Server logic | `server/admin/dashboard.mjs`, `people.mjs` (user detail, contractors, audit page), `system.mjs`, `status.mjs` (disabled accounts), `redact.mjs`, `webhookFailures.mjs` |
| Migration | `server/db/migrations/admin.mjs`: `admin-001-status-webhook-failures` (`account_status`, `webhook_failures`, audit and users indexes) |
| Client | `src/features/admin/*` (each tab a lazy chunk), wired in `src/screens/AdminScreen.tsx` and `src/lib/router.ts` |
| Tests | `server/test/admin-panel.test.mjs`; QA `scripts/qa/routes/admin.mjs` (30 routes) |

Small hunks in shared files, each needed for the feature:
- `server/auth/sessions.mjs`: `start()` refuses a disabled account (403 `account_disabled`) and
  `currentUser()` ignores a session belonging to one.
- `server/routes/auth.mjs` login: the disabled check runs after the password is verified (so it
  reveals nothing about an address) and before the new-device email.
- `server/billing/service.mjs` `planOf`: a complimentary plan ends at `current_period_end` when it
  has one, whatever its cancel flag says (so the account's own "resume" can't make it permanent).
- `server/routes/webhooks.mjs`: every refusal or failure is recorded in `webhook_failures` (reason,
  status, event type only; never the body, signature or secret).

## Rules

- Every `/api/admin/*` route is `auth: 'admin'` (401 signed out, 403 otherwise), CSRF on writes,
  rate-limited per admin (reads 1200/h, writes 120/h, deletes 20/h). A test walks the whole route
  table as anon, customer and studio.
- **Admin is never granted or removed through the API.** Role changes are customer <-> studio only;
  an admin target is refused (409). The old `PATCH /api/admin/users/:id` follows the same rule now.
  `node server/scripts/make-admin.mjs` on the server is the only way, and the UI says so.
- No action on your own account (role, disable, delete, sign out everywhere). Disable and delete
  also refuse admins (demote on the server first).
- Delete needs the account's email typed back, and is refused while a Stripe plan still renews.
  It reuses the self-delete path (`server/account/service.mjs`), so the same data is kept or removed.
- Disable: no sign-in, every session ended, reset links voided. Enable removes the row; nothing else
  changes.
- Complimentary plan: `endsOn: 'YYYY-MM-DD'` runs through that whole UTC day; empty means no end.
  Stored as `current_period_end`; the contractor model allowance then counts monthly periods ending
  on that date instead of calendar months.
- Every action is in `admin_audit`: `role_change`, `comp_grant` (with `endsAt`), `comp_revoke`,
  `sign_out_all`, `account_disable`, `account_enable`, `account_delete`, `contractor_verify`,
  `contractor_unverify`, plus the existing `reset_link`, `model_grant`, `export_without_payment`,
  `retailer_update`.
- Money on the Overview: Stripe and demo never added together; amounts per currency, CAD first and
  legacy USD on its own line.
- System never returns a secret: every key is a yes/no; payments notes come from
  `config.paymentsNotes` (already log-safe); log lines go through `redact()`. The log is read from
  `BLUMODEL_LOG_FILE` (the home server sets it); without it the page says there is nothing to show.
  The deployed commit comes from `DEPLOYED.txt`, which `scripts/deploy-local.mjs` writes. There is
  no key-entry UI: keys stay in `blumodel.env`, edited by hand.
- Contractor "verify" sets the Verified badge on their contractor brand page (`brands.verified_at`),
  logged in both `brand_moderation_log` and `admin_audit`. No brand page, nothing to verify (409).

## Checks

```
node --no-warnings --test server/test/admin-panel.test.mjs
npx vite build --outDir .build/admin --emptyOutDir
node scripts/qa.mjs --pkg admin --port 8950 --dist .build/admin --strict-external
```

## Not done / for later

- No deep link to one account (`#/admin/users` opens the list; other tabs hand the id over in memory).
- Webhook failures are only recorded from this deploy on; signature failures before it aren't known.
- "Last seen" comes from live sessions, so it is empty for an account that signed out everywhere.
