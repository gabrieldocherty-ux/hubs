# Payment test on the live site (showroom model)

A checklist for Gabe to prove the showroom money works on https://blumodel.studio with real money,
start to finish. It replaces the old homeowner checklist (the $5 unlock, Unlimited and the Contractor
plan are no longer sold; see docs/SHOWROOM_PIVOT.md §2-3).

**Run it only after the showroom release is deployed.** The live site at commit 9d90a64 still runs
the old model.

You will:

1. make a **test company** and record a **$0 test license** for it;
2. buy **one $50 CAD monthly plan** with your own card through the Checkout link;
3. confirm the webhook deliveries answer **200** and the company has **$25.00 (2,500 cents) of render
   credits**;
4. cancel the plan and refund the $50.

It takes about 30 minutes. The $50 is refunded at the end. Stripe keeps its processing fee on a
refund, so expect about $1.75 CAD of fees.

Never paste a key, a webhook secret or a password into a chat, a ticket or this file. Don't open
`blumodel.env`; `npm run stripe:check` reads it for you.

### What was already checked without real money

These flows were run on a clean copy of the code (commit 6074f7c) with a mocked Stripe. The keys were
fake and no real Stripe call was made:

- the admin's Checkout link: subscription mode, **CA$50.00 a month** from the server's own price,
  `metadata.kind = showroom_monthly`, and the company's email;
- webhook signatures: a wrong secret, a changed body, a `v0`-only header and no header are all
  refused, and so is a timestamp more than 5 minutes off in either direction;
- a resent event is recorded once;
- fulfilment, and the return sync, which only accepts a paid session made for that very link;
- `invoice.paid` grants exactly 2,500 cents once per invoice;
- a failed renewal: 14 days of grace, then lapsed and the "temporarily unavailable" page, then paid
  again and live;
- credits roll over for 3 months and the oldest is spent first;
- renders reserve credits first, then are charged, or refunded when they fail;
- admin credit adjustments are audited and can't go below zero;
- legacy receipts, the portal, cancel/resume and order refunds still work;
- every homeowner or contractor checkout and plan change answers **410 not_for_sale** before Stripe
  is called.

This checklist covers what only the real Stripe account can show.

---

## Known issues at commit 6074f7c (read before you start)

These came out of the verification. Until they are fixed, expect the following:

- **The return page after paying doesn't exist yet.** Stripe sends the payer back to
  `https://blumodel.studio/?session_id=…#/pay/showroom/<ref>`, and the app shows its *not found*
  page there. The payment is still recorded, because the webhook does that. Note what you see in
  step 2.6 and carry on.
- **The order of Stripe's events matters.** The first month's 2,500 credits are granted only if
  `customer.subscription.created` (or `checkout.session.completed`) is processed before
  `invoice.paid`. Stripe doesn't promise any order. If step 3 shows **$0.00** credits even though
  every delivery is 200, this is why. Add the $25 by hand: **Admin → Companies → the company → Render
  credits → Add or remove**, with the note "first month, event order".
- **A lapsed company can't fix its own card.** Every page and API call on a lapsed showroom answers
  "temporarily unavailable", including sign-in and the Plan tab's card portal. Before going live
  with real companies, set Stripe to email failed-payment links (section 0) so a company can pay
  from Stripe's own page.

---

## 0. Before you start

- [ ] In the home folder, `logs\server.log` has these lines from the last start, and no
  `Stripe is NOT on:` line:
  ```
  BluModel Studio listening on http://127.0.0.1:8790 (payments: stripe, production)
  Stripe: LIVE mode
  ```
  The server reports `stripe` with LIVE only when all of these hold:
  - the key starts with `sk_live_` or `rk_live_`;
  - `STRIPE_WEBHOOK_SECRET` starts with `whsec_`;
  - `PUBLIC_URL` is `https://blumodel.studio`;
  - the server runs in production.

  Otherwise it reports `none`, and creating a checkout link answers "Payments are not available
  yet".
- [ ] From the repo's `blumodel-studio\` folder, run `npm run stripe:check`. Every line must be
  **PASS**, or a NOTE you accept. Fix any **FIX** line before going on. The check never prints a
  key.
- [ ] In the Stripe Dashboard, go to **Developers → Webhooks**. The endpoint
  `https://blumodel.studio/api/webhooks/stripe` must be **Enabled** in **Live** mode and send all ten
  events (`stripe:check` checks this too):
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `charge.refunded`
- [ ] Keep that endpoint's **Event deliveries** tab open in a second tab. You check it after each step.
- [ ] Set these once in the Stripe Dashboard, for real companies later:
  - **Settings → Billing → Customer portal** is activated. It lets the company update its card and
    see invoices.
  - **Settings → Billing → Revenue recovery → Retries**: when all retries fail, **cancel the
    subscription**. If it is left *past due*, Stripe keeps retrying the old plan after the showroom
    has lapsed. A new link would then start a second plan, and a late payment on the old one would
    charge the company twice, with nothing recorded here.
  - **Revenue recovery → Emails**: turn on the failed-payment emails, with Stripe's link to update
    the card. A lapsed company can't reach the portal from its own showroom.
- [ ] `https://<anything>.blumodel.studio` resolves, because the wildcard DNS record exists
  (ONBOARDING_A_COMPANY.md, part A).

What a delivery that isn't 200 means:

| Response | Cause |
|---|---|
| 400 *Invalid signature* | `STRIPE_WEBHOOK_SECRET` is wrong, or the server clock is more than 5 minutes off |
| 503 *payments_unavailable* | the server isn't in Stripe mode (step 0) |
| Cloudflare challenge or 403 page | Bot Fight Mode or a WAF rule (LAUNCH.md part C) |
| 500 | a handler failed and Stripe will retry it. Note the event id and tell Claude |

---

## 1. A test company and a $0 test license

Sign in on `https://blumodel.studio` with your **admin** account.

1. [ ] Go to **Admin → Companies → New company**:
   - Name: `Payment Test Co (delete me)`.
   - Slug: `paytest`.
   - Owner's email: an address you read, for example `gabe+paytest@…`.

   With no contact email set, Stripe's Checkout and receipts use the owner's email. The page shows a
   **Sign-in link** for that owner: copy it for step 3.
2. [ ] Open it. In **Yearly license → Record a license**:
   - **Amount (CAD)**: `0`.
   - **How it was paid**: *Complimentary*.
   - **Note**: `PAYMENT TEST`.
   - Leave both dates empty: today, and a year.

   Press **Record license**. The license shows today to a year less a day, and **$0.00 CAD**. A $0
   complimentary license adds no receipt and no revenue.
3. [ ] In **Status**, launch the company. It must come out **lapsed**, with *monthly plan not paid*
   as the reason. Open `https://paytest.blumodel.studio`: it shows the **temporarily unavailable**
   page. That proves a showroom needs both halves.

## 2. Buy one $50 CAD monthly plan

1. [ ] In **Monthly plan ($50/month)**, press **Create checkout link**. A link starting
   `https://checkout.stripe.com/` appears under *Checkout link to send*.
2. [ ] Open it in a **private window**, as the company would. The page shows:
   - your Stripe business name;
   - **BluModel Studio showroom - Payment Test Co (delete me)**;
   - **CA$50.00 per month**;
   - the owner's email from step 1.1.

   Nothing on the page should say USD or show another amount.
3. [ ] Pay with **your own card**.
4. [ ] Stripe → **Payments**: one **CA$50.00** payment. Stripe → **Subscriptions**: one active
   subscription, renewing in a month.
5. [ ] Event deliveries, all **200**:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `invoice.paid`

   `customer.subscription.updated` may also arrive.
6. [ ] Where Stripe sent you back: the address is
   `https://blumodel.studio/?session_id=cs_live_…#/pay/showroom/tc_…`.
   - Expected once fixed: a page saying the plan is paid and the showroom is live.
   - At 6074f7c: the *not found* page (see *Known issues*).

## 3. The webhook did its job: live, and 2,500 credits

1. [ ] **Admin → Companies → paytest**:
   - **Status** says **live**.
   - **Monthly plan** reads *Stripe, active, paid*, with the renewal date a month away and
     **$50.00 CAD**.
   - The checkout link is marked **completed**.
2. [ ] **Render credits** shows a balance of **$25.00**. The history has one *Monthly plan credits*
   line of **+$25.00**, and it expires in **3 months**.
   - If the balance is $0.00, see *Known issues*.
   - If it is $50.00, `invoice.paid` was counted twice. That is a fault: note both event ids.
3. [ ] In Stripe, find the `invoice.paid` delivery and press **Resend**. It answers **200** with
   `"duplicate": true`. Reload the company: the credits are **still $25.00**, and there is still one
   receipt.
4. [ ] Open `https://paytest.blumodel.studio`. The showroom loads; it is no longer "temporarily
   unavailable".
5. [ ] Open the owner's sign-in link from step 1.1 in the private window, then go to the account
   menu → **Staff → Plan** (`#/studio/plan`).
   - The license reads $0.00 and *Complimentary*.
   - The monthly plan reads **$50 a month: $25 hosting with your web address + $25 of render
     credits**, paid.
   - The receipts list one **$50.00 CAD** monthly payment.
6. [ ] **Update card or see invoices** opens `billing.stripe.com` for this customer. Its
   return link lands on `https://paytest.blumodel.studio/#/studio/plan`.
7. [ ] **Staff → Renders** shows **$25.00** of credits and the same history line.

## 4. Cancel and refund

1. [ ] **Admin → Companies → paytest → Monthly plan → Cancel plan → Yes, cancel.**
   - The plan shows *cancels at the end of the period*, and the company stays **live** until then.
   - Deliveries: `customer.subscription.updated` → **200**.
   - Stripe → Subscriptions shows *Cancels <date>*.
2. [ ] Refund the $50: Stripe → **Payments** → the payment → **Refund** → full amount.
   - Deliveries: `charge.refunded` → **200**.
   - Stripe emails a refund receipt.
   - Expected: nothing changes in the app. The receipt stays and the $25 of credits stay, because a
     dashboard refund doesn't take credits back. Remove them by hand in the next step.
3. [ ] End it now: in Stripe → Subscriptions, cancel the subscription **immediately**.
   - Deliveries: `customer.subscription.deleted` → **200**.
   - The company turns **lapsed**, and `https://paytest.blumodel.studio` shows the **temporarily
     unavailable** page. Its data is kept.
4. [ ] **Render credits → Add or remove**: remove **$25** with the note "payment test refunded". The
   balance is **$0.00**. The change is in the history, and in **Admin → Audit** as
   `tenant_credit_adjust`.
5. [ ] **Yearly license**: void the test license. Then set the company's status to **suspended** with
   the note "payment test".

## 5. Afterwards

- [ ] Stripe → Webhooks → the endpoint → **Event deliveries**: every event from today shows **200**.
  Retry any that don't, once the cause is fixed. Stripe retries failed deliveries by itself for 3
  days.
- [ ] **Admin → Dashboard**:
  - Monthly revenue doesn't count the cancelled test plan.
  - Licenses booked this year shows $0 from the test.
  - Every amount is in CAD.
- [ ] The test company stays suspended, which is harmless. Remove its team member if you like.

## 6. Legacy customers (only if any exist)

People who paid before the pivot keep what they paid for:

- [ ] A legacy Unlimited or Contractor subscriber still sees **Account → Billing** with their
  receipts, **Manage payment & invoices** (the portal), and **Cancel plan / Keep my plan**.
- [ ] Choosing a plan or an unlock anywhere answers *BluModel Studio no longer sells plans or kitchen
  unlocks*. No Checkout page opens.
- [ ] A refund of an old custom-model order from **Admin → Studio** still works, and
  `charge.refunded` → **200**.
