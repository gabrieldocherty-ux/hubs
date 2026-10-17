# Payment test on the live site

A checklist for Gabe to prove payments work on https://blumodel.studio with real money, start to
finish. It takes about 30 minutes and costs $5 CAD (refunded) plus up to one month of Unlimited
($15 CAD, which you can refund too).

Use a **normal browser window** and an account that is **not your admin account**. Admins can
export without paying, so an admin account never sees the paywall. Use your own card.

Before a live run, the same flows were run on a temporary local deploy with a mocked Stripe (fake
keys, no real Stripe call): checkout in CAD, webhook signatures and the 5-minute tolerance,
duplicate events, fulfilment, the return sync, the portal, plan change, cancel and resume, a failed
renewal and its 7-day grace, the Contractor plan's 3 models a month, refunds of older USD orders,
and a customer that paid in USD being charged in CAD. All of them passed. This list checks the parts
only the real Stripe account can show.

Never paste a key, a webhook secret or a password into a chat, a ticket or this file.

---

## 0. Before you start

- [ ] In the home folder, `logs\server.log` has these lines from the last start, and no `Stripe is NOT on:` line:
  ```
  BluModel Studio listening on http://127.0.0.1:8790 (payments: stripe, production)
  Stripe: LIVE mode
  ```
  The server reports `stripe` + LIVE only when all of these are true: the key starts `sk_live_` or
  `rk_live_`, `STRIPE_WEBHOOK_SECRET` starts `whsec_`, `PUBLIC_URL` is `https://blumodel.studio`,
  and the server runs in production. Otherwise it reports `none`, and every checkout answers
  "Payments are not available yet". A test key (`sk_test_`) reports `stripe` in TEST mode.
- [ ] From the repo's `blumodel-studio\` folder, run `npm run stripe:check`. Every line is
  **PASS** or a NOTE you accept. **FIX** lines must be fixed first. It reads `blumodel.env` itself,
  so don't open or copy the file. It never prints a key.
- [ ] Stripe Dashboard → **Developers → Webhooks** → the endpoint
  `https://blumodel.studio/api/webhooks/stripe` is **Enabled**, in **Live** mode, and sends all
  ten events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `checkout.session.expired`,
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`.
  (`stripe:check` checks this too.)
- [ ] Keep that endpoint's **Event deliveries** tab open in a second tab. You check it after each step.

What a delivery that isn't 200 means:

| Response | Cause |
|---|---|
| 400 *Invalid signature* | `STRIPE_WEBHOOK_SECRET` is wrong, or the server clock is more than 5 minutes off |
| 503 *payments_unavailable* | the server isn't in Stripe mode (step 0) |
| Cloudflare challenge or 403 page | Bot Fight Mode or a WAF rule (LAUNCH.md part C) |
| 500 | a handler failed. Stripe retries it. Note the event id and tell Claude |

---

## 1. One $5 CAD kitchen unlock, then a refund

1. [ ] Sign out. **Sign up** with a fresh email that isn't your admin account, for example
   `gabe+paytest1@…`.
2. [ ] Look at the Pricing page and the landing page. Neither should mention a $5 unlock. Pricing
   shows Free, **Unlimited $15 CAD/month** and **Contractor $99 CAD/month** only.
3. [ ] Make a kitchen (any layout) and press **Export** (PNG, CSV or any other).
4. [ ] The export dialog offers **Unlock this kitchen - $5 CAD once** next to **Unlimited -
   $15 CAD/month**. There are no card fields and nothing says DEMO.
5. [ ] Choose **Unlock this kitchen**. The address bar shows `checkout.stripe.com`. The amount is
   **CA$5.00**. Pay.
6. [ ] You come back to `https://blumodel.studio/...#/k/...` (not some other address). The export you
   clicked finishes. Export again: no dialog this time.
7. [ ] **Account → Billing** lists the receipt: *Kitchen unlock: <kitchen name>*, **$5.00 CAD**.
8. [ ] Stripe → **Payments**: one CA$5.00 payment. Webhook deliveries: `checkout.session.completed`
   → **200**.
9. [ ] Refund it: open the payment → **Refund** → full amount. Deliveries: `charge.refunded` →
   **200**. Stripe emails a refund receipt.
   - Expected: the kitchen **stays unlocked** and the Billing receipt stays listed. A refund made in
     the Stripe dashboard changes nothing in the app for unlocks. This is how it is built
     (docs/LAUNCH.md B10), not a fault.

## 2. One subscription start, then cancel

Use the same test account (or a second one, `gabe+paytest2@…`).

1. [ ] **Pricing → Unlimited**, or **Account → Billing → Unlimited**. On `checkout.stripe.com` the
   price reads **CA$15.00 per month**. Pay.
2. [ ] Back on the site, Billing shows **Unlimited**, the renewal date about a month away and
   **$15.00 CAD / month**. Every kitchen exports without the dialog.
3. [ ] Deliveries, all **200**: `checkout.session.completed`, `customer.subscription.created`,
   `invoice.paid` (`customer.subscription.updated` may arrive as well).
4. [ ] Billing → **Manage payment & invoices** opens `billing.stripe.com`. The portal's return link (it carries your Stripe business name)
   lands on `https://blumodel.studio/#/account/billing`.
5. [ ] Billing → **Cancel plan** → confirm. Billing says the plan ends on the renewal date and you
   still have Unlimited until then. Deliveries: `customer.subscription.updated` → **200**. In
   Stripe → **Subscriptions**, the subscription shows *Cancels <date>*.
6. [ ] Optional: **Keep my plan**. Billing shows it renewing again, and `customer.subscription.updated` →
   **200**. Then cancel again.
7. [ ] Optional: refund the $15 in Stripe → Payments (`charge.refunded` → **200**). The plan stays
   until the period ends. To end it now, cancel the subscription **immediately** in the Stripe
   dashboard: `customer.subscription.deleted` → **200**, and Billing shows Free.

Don't switch plans up and down during this test (see *Known issue* below).

## 3. One Contractor custom-model request using the allowance

This needs an account on the Contractor plan. Either:

- **Paid:** subscribe a test account to **Contractor - $99 CAD/month** as in section 2. Checkout reads
  **CA$99.00 per month**. Refund it afterwards. Or
- **Free:** give the test account a complimentary **Contractor** plan from **Admin → Users**, once that
  screen ships. (At commit 7bc673f only the admin API, `POST /api/admin/billing/grant`, does this.)
  This makes no charge. The grant's allowance follows the calendar month rather than a billing
  period.

Then, signed in as that contractor:

1. [ ] Contractors complete their company details first, including the business name and phone.
2. [ ] The account menu shows **Make custom models**. A non-contractor account doesn't have it.
3. [ ] Open it. The form says **3 of 3 models left this month - resets <date>**. There's no price,
   no rush option and no checkout.
4. [ ] Add one product: type, name, and a UPC. For a test, `036000291452` checks out; `036000291453`
   must be refused with "That code doesn't check out". Or scan or photograph a barcode. Send it.
5. [ ] The request opens marked **Included** (nothing to pay), and the form now says **2 of 3 left**.
   Nothing new shows in Stripe → Payments, and no webhook is sent for it.
6. [ ] As admin, **Admin → Studio**: the request is under *To start*, with the UPC shown.
7. [ ] Withdraw it (as the contractor, before the studio starts it) or cancel it from the studio
   drawer. The allowance goes back to **3 of 3**.
8. [ ] If you subscribed with money, refund it and cancel the subscription in Stripe. Deliveries →
   **200**.

## 4. Afterwards

- [ ] Stripe → Webhooks → the endpoint → **Event deliveries**: every event from today shows
  **200**. Retry any that don't once the cause is fixed. Stripe retries failed deliveries for 3 days
  on its own.
- [ ] **Admin → Billing** (as admin) shows the payments under *Stripe*, in CAD, separate from any
  demo numbers.
- [ ] Delete the test accounts if you like (Account settings → **Delete my account**; cancel any plan first).

---

## Issue found while verifying (fixed in 037ff20)

Moving from **Unlimited to Contractor** and back used to be prorated, so an Unlimited subscriber
could upgrade, send 3 custom-model requests, downgrade, and pay close to nothing for the models.
Now an upgrade is invoiced and charged at once (a declined card changes nothing), and leaving
Contractor after requesting models in the period gives no proration credit. Worth a glance at
**Admin → Studio** now and then for requests from accounts that are back on Unlimited.
