// What BluModel Studio sells, and what it used to, from src/data/plans.json (shared with the client;
// deploy-local ships it next to server/). The server is the only authority on what is charged:
// amounts sent by a client are never used.
//
// Since the showroom pivot (docs/SHOWROOM_PIVOT.md §2, 2026-10-17) two things are for sale, both to
// kitchen and bath companies, in CAD:
//   showroom_license   yearly, set per company when the deal is signed (list price $1,995 including
//                      up to 50 products modelled), recorded by an admin, invoiced, not Stripe
//   showroom_monthly   $50/month through Stripe: $25 hosting (including the web address) and $25 of
//                      AI render credits, which roll over for 3 months
// Homeowners never pay. The four homeowner/contractor plans below are legacy: nothing new can be
// bought (the checkout refuses them), and what was paid keeps working until it ends (receipts,
// refunds, the portal, an existing subscription's renewals).
//
// Since 2026-10-15 every price is in Canadian dollars. Rows stored before that keep their own
// currency and amount (see server/db/migrations/pricing.mjs).

import data from '../../src/data/plans.json' with { type: 'json' };

/** @typedef {{ id: string, name: string, priceCents: number, currency: 'cad', interval: null|'month'|'year', tagline: string, bullets: string[], forSale: boolean, legacy?: boolean, includedModels?: number, includedProducts?: number, breakdown?: { id: string, label: string, cents: number }[], creditRolloverMonths?: number, billing?: 'invoice'|'stripe' }} Plan */

/** The currency of every new checkout, subscription, receipt and order. */
export const CURRENCY = 'cad';

// A price change is a deliberate decision: change it here and in the JSON together.
const EXPECTED = { showroom_license: 199500, showroom_monthly: 5000, free: 0, kitchen_unlock: 500, unlimited: 1500, contractor: 9900 };

/**
 * What the plans cost before 2026-10-15, in US dollars. Never charged again: only used to
 * recognise a subscription Stripe still bills at the old price (and to backfill old rows).
 */
export const LEGACY_PRICES = Object.freeze({ currency: 'usd', unlimited: 1500, contractor: 4000, kitchen_unlock: 500 });

/** @type {readonly Plan[]} */
export const PLANS = Object.freeze(data.map((p) => Object.freeze({ ...p, bullets: Object.freeze([...p.bullets]) })));

for (const [id, cents] of Object.entries(EXPECTED)) {
  const p = PLANS.find((x) => x.id === id);
  if (!p || !Number.isInteger(p.priceCents) || p.priceCents < 0) throw new Error(`src/data/plans.json: plan "${id}" is missing or has no price.`);
  if (p.priceCents !== cents) throw new Error(`src/data/plans.json: plan "${id}" costs ${p.priceCents} cents, expected ${cents}.`);
  if (p.currency !== CURRENCY) throw new Error(`src/data/plans.json: plan "${id}" is priced in "${p.currency}", expected "${CURRENCY}".`);
}

/** Plans nobody can buy any more (the homeowner and contractor plans and the $5 unlock). */
export const LEGACY_PLAN_IDS = Object.freeze(['free', 'kitchen_unlock', 'unlimited', 'contractor']);
for (const id of LEGACY_PLAN_IDS) if (PLANS.find((p) => p.id === id)?.forSale !== false) throw new Error(`src/data/plans.json: legacy plan "${id}" must have forSale: false.`);

/** The yearly license's list price and what it includes (an admin records the real amount per deal). */
export const SHOWROOM_LICENSE = Object.freeze({
  id: 'showroom_license',
  priceCents: EXPECTED.showroom_license,
  includedProducts: PLANS.find((p) => p.id === 'showroom_license')?.includedProducts ?? 50,
});

/** The monthly plan: $50 = $25 hosting (with the web address) + $25 of render credits. */
const monthly = PLANS.find((p) => p.id === 'showroom_monthly');
const part = (id) => monthly?.breakdown?.find((b) => b.id === id)?.cents;
export const SHOWROOM_MONTHLY = Object.freeze({
  id: 'showroom_monthly',
  priceCents: EXPECTED.showroom_monthly,
  hostingCents: part('hosting'),
  creditCents: part('render_credits'),
  creditRolloverMonths: monthly?.creditRolloverMonths ?? 3,
});
if (SHOWROOM_MONTHLY.hostingCents !== 2500 || SHOWROOM_MONTHLY.creditCents !== 2500 || SHOWROOM_MONTHLY.hostingCents + SHOWROOM_MONTHLY.creditCents !== SHOWROOM_MONTHLY.priceCents) {
  throw new Error('src/data/plans.json: the monthly plan must break down as 2500 hosting + 2500 render credits.');
}
if (SHOWROOM_MONTHLY.creditRolloverMonths !== 3) throw new Error('src/data/plans.json: render credits roll over for 3 months (creditRolloverMonths).');

/**
 * Custom 3D models a month the (legacy) Contractor plan includes, made by the BluModel studio
 * (since 2026-10-15 custom models aren't sold; server/payments/allowance.mjs counts them).
 */
export const INCLUDED_MODELS = 3;
if (PLANS.find((p) => p.id === 'contractor')?.includedModels !== INCLUDED_MODELS) {
  throw new Error(`src/data/plans.json: the Contractor plan must include ${INCLUDED_MODELS} custom models a month (includedModels).`);
}

/** The legacy monthly plans an account can be on (and renew). No new subscription can start. */
export const SUBSCRIPTION_PLANS = Object.freeze(['unlimited', 'contractor']);

/** @returns {Plan | null} */
export function planById(id) {
  return PLANS.find((p) => p.id === id) ?? null;
}
