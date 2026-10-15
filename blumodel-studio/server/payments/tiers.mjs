// Custom-model pricing ("Make custom models"; docs/PLANS_AND_CONTRACTORS.md §8).
//
// This is the ONLY place prices for custom models come from. Routes, checkouts and the
// revenue report read amounts produced here; any amount a client sends is ignored.
//
// One offer since 2026-10-14: the Model pack. Up to 8 products for $129 (the app's currency),
// one 3D model per product, up to 3 finishes and 2 revision rounds per model. 9 to 16 products
// are 2 packs, 17 to 24 are 3, and so on. Rush is +50% for half the turnaround (rounded up).
//
// The per-product tiers it replaced (Simple $129 / Standard $279 / Complex $549, +$39 per extra
// finish beyond 2) are retired: no new order is priced with them. Every order stores its own
// price when it is created (orders.amount_cents, order_items.amount_cents and, for packs, the
// quote's lines in orders.extras), so a later price change never re-prices an existing order.
// LEGACY_TIERS only names and dates the orders placed before packs; their amounts come from
// the database.

export const PACK = Object.freeze({
  id: 'pack',
  name: 'Model pack',
  priceCents: 12_900,
  /** Products (one 3D model each) one pack covers. */
  productsPerPack: 8,
  /** Finishes per model, included. */
  finishesPerModel: 3,
  /** Revision rounds per model, included. */
  revisions: 2,
  /** Turnaround for the first pack, in business days after payment. */
  businessDays: 15,
  /** Each further pack in the same request adds this many business days. */
  extraPackBusinessDays: 5,
});

export const PRODUCTS_PER_PACK = PACK.productsPerPack;
export const MAX_FINISHES = PACK.finishesPerModel;
/** Rush: +50% on every pack, for half the turnaround (rounded up). */
export const RUSH_PCT = 50;
/** Revision rounds included with every model. */
export const REVISIONS = PACK.revisions;
/** One request holds at most this many packs (40 products); a bigger job is two requests. */
export const MAX_PACKS = 5;
export const MAX_ITEMS = MAX_PACKS * PRODUCTS_PER_PACK;
/** The app's currency (Stripe Checkout and every stored amount). */
export const CURRENCY = 'usd';

/**
 * The retired per-product tiers. Never used to price anything new: only to label and date
 * orders placed before the Model pack (their amounts are read from the database).
 */
export const LEGACY_TIERS = Object.freeze([
  Object.freeze({ id: 'simple', name: 'Simple', businessDays: 7 }),
  Object.freeze({ id: 'standard', name: 'Standard', businessDays: 10 }),
  Object.freeze({ id: 'complex', name: 'Complex', businessDays: 15 }),
]);
const LEGACY_BY_ID = new Map(LEGACY_TIERS.map((t) => [t.id, t]));
export const legacyTierById = (id) => LEGACY_BY_ID.get(id) ?? null;

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How many packs `products` products need. */
export const packsFor = (products) => Math.ceil(products / PRODUCTS_PER_PACK);

/** Business days for `packs` packs: 15 for the first, +5 per further pack; rush halves it (rounded up). */
export function packBusinessDays(packs, rush = false) {
  const days = PACK.businessDays + Math.max(0, packs - 1) * PACK.extraPackBusinessDays;
  return rush ? Math.ceil(days / 2) : days;
}

/** `total` cents in `n` shares that add up to it exactly (the first shares take the odd cents). */
function split(total, n) {
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** How many products a quote input asks for: `items.length`, or `products`. */
function productsOf(input) {
  if (Array.isArray(input?.items)) return input.items.length;
  if (input?.products !== undefined) return input.products;
  return 1;
}

/**
 * Quotes a request: `{ items: [...], rush }` (only the number of items matters) or
 * `{ products: n, rush }`. Returns
 *   { pricing: 'pack', amountCents, currency, dueBusinessDays, rush, products, packs,
 *     perPack, packCents, rushPct, rushCents,
 *     items: [{ pack, amountCents }],          // each product's share; they sum to amountCents
 *     lines: [{ label, amountCents, pack? }] } // the receipt and the Stripe line items
 * A pack costs the same with 1 product or 8. Throws on a count outside 1..MAX_ITEMS.
 */
export function quote(input) {
  const rush = input?.rush === true;
  const products = productsOf(input);
  if (!Number.isInteger(products) || products < 1) throw new Error('A quote needs at least one product.');
  if (products > MAX_ITEMS) throw new Error(`At most ${MAX_ITEMS} products per request.`);
  const packs = packsFor(products);
  const rushPerPack = rush ? Math.round((PACK.priceCents * RUSH_PCT) / 100) : 0;
  const items = [];
  const lines = [];
  for (let p = 0; p < packs; p++) {
    const size = Math.min(PRODUCTS_PER_PACK, products - p * PRODUCTS_PER_PACK);
    const name = packs > 1 ? `${PACK.name} ${p + 1} of ${packs}` : PACK.name;
    lines.push({ label: `${name}: ${plural(size, 'product')}`, amountCents: PACK.priceCents, pack: p + 1 });
    for (const c of split(PACK.priceCents + rushPerPack, size)) items.push({ pack: p + 1, amountCents: c });
  }
  if (rush) lines.push({ label: `Rush (+${RUSH_PCT}%, half the turnaround)`, amountCents: rushPerPack * packs });
  return {
    pricing: 'pack',
    amountCents: packs * (PACK.priceCents + rushPerPack),
    currency: CURRENCY,
    dueBusinessDays: packBusinessDays(packs, rush),
    rush,
    products,
    packs,
    perPack: PRODUCTS_PER_PACK,
    packCents: PACK.priceCents,
    rushPct: RUSH_PCT,
    rushCents: rushPerPack * packs,
    items,
    lines,
  };
}

/**
 * The quote of an order placed before the Model pack, rebuilt from what is STORED on it: each
 * item's amount_cents and the order's amount_cents are what was charged (or will be), never
 * re-priced. The retired tier names and turnarounds only label the lines and date the order.
 * @param {{ items: { tier: string, extraFinishes?: number, amountCents: number, name?: string }[], rush?: boolean, amountCents: number }} input
 */
export function legacyQuote({ items, rush = false, amountCents }) {
  const lines = items.map((it, i) => {
    const t = legacyTierById(it.tier);
    const prefix = items.length > 1 ? `${i + 1}. ` : '';
    const name = typeof it.name === 'string' && it.name.trim() ? `: ${it.name.trim().slice(0, 80)}` : '';
    const extra = it.extraFinishes ? `, ${plural(it.extraFinishes, 'extra finish', 'extra finishes')}` : '';
    return { label: `${prefix}${t?.name ?? 'Custom'} model${name}${extra}${rush ? ', rush' : ''}`, amountCents: it.amountCents, item: i };
  });
  const days = Math.max(1, ...items.map((it) => legacyTierById(it.tier)?.businessDays ?? PACK.businessDays));
  return {
    pricing: 'tiers',
    amountCents,
    currency: CURRENCY,
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

/** What `GET /api/orders/tiers` serves: everything the request form and the pricing page show. */
export function tiersWire() {
  return {
    pricing: 'pack',
    pack: { ...PACK },
    rushPct: RUSH_PCT,
    maxItems: MAX_ITEMS,
    maxPacks: MAX_PACKS,
    currency: CURRENCY,
    // The one offer in the old `tiers` shape, for a page loaded before packs replaced the tiers.
    tiers: [{ id: PACK.id, name: PACK.name, for: `Up to ${PRODUCTS_PER_PACK} products, one 3D model each`, priceCents: PACK.priceCents, businessDays: PACK.businessDays, revisions: PACK.revisions }],
  };
}
