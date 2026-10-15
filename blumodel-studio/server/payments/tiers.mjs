// Custom models ("Make custom models"; docs/PLANS_AND_CONTRACTORS.md §8).
//
// Since 2026-10-15 custom models are NOT sold: the Contractor plan ($99 CAD/month) includes
// INCLUDED_MODELS custom 3D models a month, made by the BluModel studio. A request is free to
// submit and counts against that month's allowance (server/payments/allowance.mjs). There is no
// checkout, no rush and no per-model price for anything new.
//
// Orders placed before that keep what they were sold at: every order stores its own price when
// it is created (orders.amount_cents, order_items.amount_cents and, for the short-lived pack
// pricing, the quote's lines in orders.extras), so nothing here re-prices an existing order.
// LEGACY_TIERS and PACK only name and date those older orders; their amounts come from the
// database, in the order's own currency.

import { CURRENCY, INCLUDED_MODELS } from '../lib/plans.mjs';

/** The app's currency for anything new (CAD since 2026-10-15); a stored order keeps its own. */
export { CURRENCY, INCLUDED_MODELS };

/** What every included model comes with. */
export const MODEL_TERMS = Object.freeze({
  /** Custom 3D models a month on the Contractor plan; unused ones don't roll over. */
  perMonth: INCLUDED_MODELS,
  /** Finishes per model, included. */
  finishesPerModel: 3,
  /** Revision rounds per model, included. */
  revisions: 2,
  /** Turnaround in business days after the request is submitted. */
  businessDays: 15,
});

export const MAX_FINISHES = MODEL_TERMS.finishesPerModel;
/** Revision rounds included with every model. */
export const REVISIONS = MODEL_TERMS.revisions;
/** One request holds at most this many products (the allowance is usually the tighter limit). */
export const MAX_ITEMS = 40;

/**
 * The short-lived Model pack (14-15 October 2026, never on the live site). Only to read an order
 * that was priced with it on a development database; nothing new is priced with it.
 */
export const PACK = Object.freeze({ id: 'pack', productsPerPack: 8, finishesPerModel: 3, businessDays: 15 });

/**
 * The retired per-product tiers. Never used to price anything new: only to label and date
 * orders placed before 2026-10-14 (their amounts are read from the database).
 */
export const LEGACY_TIERS = Object.freeze([
  Object.freeze({ id: 'simple', name: 'Simple', businessDays: 7 }),
  Object.freeze({ id: 'standard', name: 'Standard', businessDays: 10 }),
  Object.freeze({ id: 'complex', name: 'Complex', businessDays: 15 }),
]);
const LEGACY_BY_ID = new Map(LEGACY_TIERS.map((t) => [t.id, t]));
export const legacyTierById = (id) => LEGACY_BY_ID.get(id) ?? null;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The "quote" of a request included in the Contractor plan: nothing to pay, one line saying so.
 *   { pricing: 'plan', amountCents: 0, currency, dueBusinessDays, rush: false, products, packs: 0,
 *     items: [{ amountCents: 0 }], lines: [{ label, amountCents: 0 }] }
 */
export function includedQuote(products, currency = CURRENCY) {
  if (!Number.isInteger(products) || products < 1) throw new Error('A request needs at least one product.');
  if (products > MAX_ITEMS) throw new Error(`At most ${MAX_ITEMS} products per request.`);
  return {
    pricing: 'plan',
    amountCents: 0,
    currency,
    dueBusinessDays: MODEL_TERMS.businessDays,
    rush: false,
    products,
    packs: 0,
    items: Array.from({ length: products }, () => ({ amountCents: 0 })),
    lines: [{ label: `${plural(products, 'custom 3D model')}, included in the Contractor plan`, amountCents: 0 }],
  };
}

/**
 * The quote of an order placed before 2026-10-14, rebuilt from what is STORED on it: each item's
 * amount_cents and the order's amount_cents are what was charged (or will be), never re-priced.
 * The retired tier names and turnarounds only label the lines and date the order.
 * @param {{ items: { tier: string, extraFinishes?: number, amountCents: number, name?: string }[], rush?: boolean, amountCents: number, currency?: string }} input
 */
export function legacyQuote({ items, rush = false, amountCents, currency = 'usd' }) {
  const lines = items.map((it, i) => {
    const t = legacyTierById(it.tier);
    const prefix = items.length > 1 ? `${i + 1}. ` : '';
    const name = typeof it.name === 'string' && it.name.trim() ? `: ${it.name.trim().slice(0, 80)}` : '';
    const extra = it.extraFinishes ? `, ${plural(it.extraFinishes, 'extra finish', 'extra finishes')}` : '';
    return { label: `${prefix}${t?.name ?? 'Custom'} model${name}${extra}${rush ? ', rush' : ''}`, amountCents: it.amountCents, item: i };
  });
  const days = Math.max(1, ...items.map((it) => legacyTierById(it.tier)?.businessDays ?? MODEL_TERMS.businessDays));
  return {
    pricing: 'tiers',
    amountCents,
    currency,
    dueBusinessDays: rush ? Math.ceil(days / 2) : days,
    rush,
    products: items.length,
    packs: 0,
    items: items.map((it) => ({ amountCents: it.amountCents })),
    lines,
  };
}

/** `ms` plus `days` business days (Monday–Friday, UTC), keeping the time of day. */
export function addBusinessDays(ms, days) {
  const d = new Date(ms);
  let left = Math.max(0, Math.floor(days));
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left--;
  }
  return d.getTime();
}

/**
 * What `GET /api/orders/tiers` serves (the name is kept for older pages): the terms of the custom
 * models the Contractor plan includes. There is no price: they aren't sold.
 */
export function tiersWire() {
  return {
    pricing: 'plan',
    plan: 'contractor',
    models: { ...MODEL_TERMS },
    maxItems: MAX_ITEMS,
    currency: CURRENCY,
    tiers: [],
  };
}
