// The four plans and their prices, from src/data/plans.json (shared with the client;
// deploy-local ships it next to server/). The server is the only authority on what is
// charged: amounts sent by a client are never used.
//
// Since 2026-10-15 every price is in Canadian dollars (Gabe's market: the Contractor price and
// the retail data are Canadian, and one Stripe customer can't mix currencies). Rows stored
// before that keep their own currency and amount: a receipt, an unlock, a subscription or an
// order made in US dollars stays in US dollars (see server/db/migrations/pricing.mjs).

import data from '../../src/data/plans.json' with { type: 'json' };

/** @typedef {{ id: 'free'|'kitchen_unlock'|'unlimited'|'contractor', name: string, priceCents: number, currency: 'cad', interval: null|'month', tagline: string, bullets: string[], includedModels?: number }} Plan */

/** The currency of every new checkout, subscription, receipt and order. */
export const CURRENCY = 'cad';

// A price change is a deliberate decision: change it here and in the JSON together.
const EXPECTED = { free: 0, kitchen_unlock: 500, unlimited: 1500, contractor: 9900 };

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

/** Plans a user can subscribe to (monthly). */
export const SUBSCRIPTION_PLANS = Object.freeze(['unlimited', 'contractor']);

/** @returns {Plan | null} */
export function planById(id) {
  return PLANS.find((p) => p.id === id) ?? null;
}
