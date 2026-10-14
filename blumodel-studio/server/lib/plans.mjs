// The four plans and their prices, from src/data/plans.json (shared with the client;
// deploy-local ships it next to server/). The server is the only authority on what is
// charged: amounts sent by a client are never used.

import data from '../../src/data/plans.json' with { type: 'json' };

/** @typedef {{ id: 'free'|'kitchen_unlock'|'unlimited'|'contractor', name: string, priceCents: number, interval: null|'month', tagline: string, bullets: string[] }} Plan */

const EXPECTED = { free: 0, kitchen_unlock: 500, unlimited: 1500, contractor: 4000 };

/** @type {readonly Plan[]} */
export const PLANS = Object.freeze(data.map((p) => Object.freeze({ ...p, bullets: Object.freeze([...p.bullets]) })));

for (const [id, cents] of Object.entries(EXPECTED)) {
  const p = PLANS.find((x) => x.id === id);
  if (!p || !Number.isInteger(p.priceCents) || p.priceCents < 0) throw new Error(`src/data/plans.json: plan "${id}" is missing or has no price.`);
  // A price change is a deliberate decision: change it here and in the JSON together.
  if (p.priceCents !== cents) throw new Error(`src/data/plans.json: plan "${id}" costs ${p.priceCents}¢, expected ${cents}¢.`);
}

/** Plans a user can subscribe to (monthly). */
export const SUBSCRIPTION_PLANS = Object.freeze(['unlimited', 'contractor']);

/** @returns {Plan | null} */
export function planById(id) {
  return PLANS.find((p) => p.id === id) ?? null;
}
