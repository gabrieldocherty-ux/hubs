# Handoff: the data lifecycle (what is kept, for how long, and how it leaves)

Written for the privacy page (FIXER 2 updates `src/features/legal/content.tsx` from it) and for anyone
answering "how long do you keep my data?". Every period here is enforced by code; the code is named
so the page never promises more than the server does. Added in the 2026-10 protection audit.

## Showroom leads (the people who use a company's showroom)

| What | How long | Enforced by |
|---|---|---|
| A lead that **never sent a design** and whose status the team **never changed** | deleted **LEAD_RETENTION_MONTHS (default 24) months** after its last activity, or sooner when the company chooses a shorter period in Workspace > Showroom (6, 12 or 18 months) | the daily job (`ctx.maintenance` → `leads.purgeStale`) |
| A lead that sent a design, or whose status the team changed | kept while the company is a customer; the company can delete it at any time (Workspace > Leads > Delete); deleted with the company | `leads.remove`, company deletion |
| The browser's visitor cookie (`blumodel_visitor`) | **180 days** | `VISITOR_DAYS` in `server/tenancy/leads.mjs` |

Deleting a lead (by the team or by the retention job) deletes its details, its browsers (visitor
tokens), its timeline, the designs only it owned, and revokes the "Sent to" view links. Designs that
belong to a showroom account are kept for that account and unlinked. Each retention sweep writes one
audit row with counts only.

**A second browser typing someone else's email or phone does not join that person's lead.** It
becomes its own lead marked "possible duplicate of <the first lead>", which the team can merge. Nothing
of either lead is shown to the other browser.

**Lead exports** (CSV of the whole list): owners only, unless an owner allows staff (Workspace > Team).
Every export is recorded (who, when, how many rows), and owners see the recent exports in Workspace > Leads.

## "Book a call" sales leads (blumodel.studio)

Kept **SALES_LEAD_RETENTION_MONTHS (default 24) months** after the lead was last updated, then deleted
by the daily job. An admin can delete one at any time (Admin > Sales leads > Delete).

## A company that leaves

- **Export all data** (Admin > Companies > a company): a zip, streamed, with the company's settings,
  team, products, designs, leads and their timelines (JSON, plus `leads.csv`), receipts and credit
  history, and every uploaded file (logo, product pictures and models, renders). Admin only, audited.
- **Delete company** (typed confirmation of the company's web address): removes the showroom's
  settings, hostnames, team, showroom accounts and their sessions, products, designs, share links,
  leads, renders, credits and uploads (files no longer used by anything else). **Billing records
  are kept, anonymised**: license and payment rows are copied to `deleted_tenant_billing` with
  amount, currency, dates, the payment provider's reference and the showroom's slug, because tax
  law requires them (6 years in Canada), but no names, notes, emails or phone numbers. Nothing
  deletes those rows automatically yet: removing them after 6 years is a manual step. The company's
  people are pseudonymised in the audit log. Audited with counts only (`tenant_delete`). The demo
  showroom can't be deleted this way.
- Nothing is deleted automatically when a showroom lapses or a trial ends: the data stays until the
  company or an admin asks for deletion.

## Accounts

- Deleting an account (Account > Delete) removes it, its designs, sessions, 2FA secret and recovery
  codes (unchanged behaviour: `server/account/service.mjs deleteAccount`).
- **The admin audit log** keeps a record of administrative actions (who did what, when). When an
  account, a lead or a company is deleted, the email addresses and phone numbers in its audit
  entries are replaced with a pseudonym (`deleted-<8 hex>`); the ids, actions and times are kept, so
  the record still shows what happened without saying to whom.

## Two-factor sign-in

- Accounts may turn on two-factor sign-in (an authenticator app, TOTP) in Account > Security.
  **Required for BluModel admins.** The secret is stored on our server; the 10 one-time recovery
  codes are stored only as hashes. Turning 2FA off or deleting the account deletes both.

## Money events

- A showroom monthly payment that is **refunded** or **disputed** (charged back): the month's render
  credits that weren't spent yet are taken back, the company is flagged for admin review, and a
  dispute starts the 14-day grace period as a failed payment does.

## Where each rule lives (for whoever changes one)

| Rule | Code | Test |
|---|---|---|
| lead retention, sales-lead retention | `ctx.retentionSweep` (server/app.mjs), `leads.purgeStale`, `purgeSalesLeads` | protect-retention |
| visitor cookie 180 days | `VISITOR_DAYS` (server/tenancy/leads.mjs) | protect-retention |
| possible duplicates | `upsert` / `merge` / `keepSeparate` (server/tenancy/leads.mjs) | showroom-leads |
| lead export owner-only, audited | `GET /api/workspace/leads/export` (server/routes/tenantsLeads.mjs) | protect-lead-export |
| company export and delete | server/tenancy/companyData.mjs | protect-company-data |
| audit pseudonyms | `pseudonymiseAudit` (server/lib/audit.mjs) | protect-audit-pseudonyms |
| two-factor sign-in | server/auth/mfa.mjs, server/auth/totp.mjs | protect-mfa |
| refunds and disputes | `paymentReversed` (server/billing/showroom.mjs) | protect-refunds |
