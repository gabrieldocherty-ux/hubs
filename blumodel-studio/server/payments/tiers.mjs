// Custom-model tiers and quoting (PRODUCT_SPEC §7.2, BUILD_PLAN §7 C-T2, §13.3).
//
// This is the ONLY place prices for custom models come from. Routes, checkouts and the
// revenue report all read amounts produced here; any amount a client sends is ignored.
// Prices are placeholders Gabe may change (PRODUCT_SPEC §15 Q3).

export const TIERS = Object.freeze([
  Object.freeze({ id: 'simple', name: 'Simple', for: 'Hardware, faucets, decor, simple lights', priceCents: 12_900, businessDays: 7, revisions: 2 }),
  Object.freeze({ id: 'standard', name: 'Standard', for: 'Appliances, sinks, single cabinets, stools', priceCents: 27_900, businessDays: 10, revisions: 2 }),
  Object.freeze({ id: 'complex', name: 'Complex', for: 'Modular or multi-part products, pro ranges, chandeliers', priceCents: 54_900, businessDays: 15, revisions: 2 }),
]);

export const TIER_IDS = Object.freeze(TIERS.map((t) => t.id));
const BY_ID = new Map(TIERS.map((t) => [t.id, t]));

/** Finishes included in every tier; each one beyond this costs EXTRA_FINISH_CENTS. */
export const INCLUDED_FINISHES = 2;
export const EXTRA_FINISH_CENTS = 3_900;
/** A product has at most 24 finishes, so at most 22 extra. */
export const MAX_EXTRA_FINISHES = 22;
/** Rush: +50% on the item price, for half the turnaround (rounded up). */
export const RUSH_PCT = 50;
/** Revision rounds included with every tier. */
export const REVISIONS = 2;
/** One request may hold up to this many products of the same line (§13.3). */
export const MAX_ITEMS = 20;
export const CURRENCY = 'usd';

export const tierById = (id) => BY_ID.get(id) ?? null;

const money = (cents) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;

/**
 * The price of one item. `rush` is order-wide but priced per item, so a multi-item total is
 * always the sum of its items.
 * @param {{ tier: string, extraFinishes?: number }} item
 * @param {{ rush?: boolean }} [opts]
 */
export function quoteItem(item, { rush = false } = {}) {
  const tier = tierById(item?.tier);
  if (!tier) throw new Error(`Unknown model tier "${item?.tier}".`);
  const extra = Number.isInteger(item.extraFinishes) ? Math.min(MAX_EXTRA_FINISHES, Math.max(0, item.extraFinishes)) : 0;
  const baseCents = tier.priceCents;
  const finishCents = extra * EXTRA_FINISH_CENTS;
  const rushCents = rush ? Math.round(((baseCents + finishCents) * RUSH_PCT) / 100) : 0;
  return {
    tier: tier.id,
    extraFinishes: extra,
    baseCents,
    finishCents,
    rushCents,
    amountCents: baseCents + finishCents + rushCents,
    businessDays: rush ? Math.ceil(tier.businessDays / 2) : tier.businessDays,
  };
}

/**
 * Quotes a whole request: `{ items: [{ tier, extraFinishes, name? }], rush }`, or a single
 * `{ tier, extraFinishes, rush }`. Returns
 * `{ amountCents, currency, dueBusinessDays, rush, items: [...], lines: [{ label, amountCents, item }] }`.
 * The due date is the slowest item's turnaround: the studio delivers the request together.
 */
export function quote(input) {
  const rush = input?.rush === true;
  const list = Array.isArray(input?.items) ? input.items : [input ?? {}];
  if (!list.length) throw new Error('A quote needs at least one item.');
  if (list.length > MAX_ITEMS) throw new Error(`At most ${MAX_ITEMS} items per request.`);
  const items = list.map((it) => quoteItem(it, { rush }));
  const lines = [];
  items.forEach((q, i) => {
    const tier = tierById(q.tier);
    const name = typeof list[i]?.name === 'string' && list[i].name.trim() ? list[i].name.trim().slice(0, 80) : null;
    const prefix = items.length > 1 ? `${i + 1}. ` : '';
    lines.push({ label: `${prefix}${tier.name} model${name ? `: ${name}` : ''}`, amountCents: q.baseCents, item: i });
    if (q.extraFinishes) lines.push({ label: `${prefix}${q.extraFinishes} extra finish${q.extraFinishes === 1 ? '' : 'es'} at ${money(EXTRA_FINISH_CENTS)}`, amountCents: q.finishCents, item: i });
    if (q.rushCents) lines.push({ label: `${prefix}Rush (+${RUSH_PCT}%)`, amountCents: q.rushCents, item: i });
  });
  return {
    amountCents: items.reduce((s, q) => s + q.amountCents, 0),
    currency: CURRENCY,
    dueBusinessDays: Math.max(...items.map((q) => q.businessDays)),
    rush,
    items,
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

/** What `GET /api/orders/tiers` serves: everything the request form needs to explain prices. */
export function tiersWire() {
  return {
    tiers: TIERS.map((t) => ({ ...t })),
    includedFinishes: INCLUDED_FINISHES,
    extraFinishCents: EXTRA_FINISH_CENTS,
    maxExtraFinishes: MAX_EXTRA_FINISHES,
    rushPct: RUSH_PCT,
    maxItems: MAX_ITEMS,
    currency: CURRENCY,
  };
}
