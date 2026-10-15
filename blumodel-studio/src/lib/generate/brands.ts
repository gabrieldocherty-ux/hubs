import type { BrandCategory, BrandPrefs, DesignDoc, Kind, Product } from '../../types';
import { BASICS_BRAND } from '../../data/builtins';
import { getProduct, isBuiltin } from '../../data/catalog';
import { useCatalog } from '../../store/useCatalog';
import type { Picked } from './layout';

/**
 * Preferred brands: the setup wizard's "Choose your brands" step, the layout builder's brand
 * preference, and the default of Add products.
 *
 * Two sources feed the brand list. Products in the catalog registry (built-ins, the retail
 * catalog once `loadRetail` has registered it, the server's brand products, a contractor's own
 * lines) are what the layout can actually place. The retail catalog's brand counts
 * (`brandsForCategory` in `src/catalog/retail.ts`) add how many products each brand has and which
 * stores carry it. A brand the layout can't place in some slot still counts as a preference: the
 * builder uses it wherever one of its products fits and falls back to BluModel Basics elsewhere.
 */

export type { BrandCategory, BrandPrefs };
export { BASICS_BRAND };

export const BRAND_CATEGORIES: { id: BrandCategory; label: string; blurb: string }[] = [
  { id: 'cabinets', label: 'Cabinets', blurb: 'Base, wall and tall cabinets' },
  { id: 'appliances', label: 'Appliances', blurb: 'Ranges, fridges, dishwashers and hoods' },
  { id: 'sinks', label: 'Sinks & faucets', blurb: 'The sink and the base it sits in' },
  { id: 'lighting', label: 'Lighting', blurb: 'Pendants over the island' },
];

const CATEGORY_IDS = new Set<string>(BRAND_CATEGORIES.map((c) => c.id));
export const isBrandCategory = (v: unknown): v is BrandCategory => typeof v === 'string' && CATEGORY_IDS.has(v);

/** The built-ins' brand names from before the relabel, so a built-in still counts as Basics either way. */
const LEGACY_BASICS = new Set(['Nordwell', 'Haldor', 'Grainhouse', 'Corviq', 'Halvard Pro', 'Aurelle', 'Nordlys', 'Halbrook', 'Lumen & Lane', 'Oakhurst', 'Framewright', 'Hearth & Vine']);

/** Same limits as the server's `normalizeDoc` (server/lib/doc.mjs). */
export const BRAND_PREFS_LIMITS = Object.freeze({ perCategory: 20, name: 80 });

/** Matching key for a brand name: case, spacing and a trailing "(…)" qualifier don't make a new brand. */
export function brandKey(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const BASICS_KEY = brandKey(BASICS_BRAND);

/** True for a BluModel Basics product: the built-ins, whatever brand name they carry this release. */
export function isBasics(p: Product): boolean {
  return p.brand === BASICS_BRAND || (isBuiltin(p.id) && LEGACY_BASICS.has(p.brand));
}

/** The brand a person sees for a product: BluModel Basics for every built-in. */
export const brandName = (p: Product): string => (isBasics(p) ? BASICS_BRAND : p.brand);

/**
 * Brand choices as stored on a kitchen: known categories only, trimmed names, no duplicates
 * (by `brandKey`), at most 20 a category, empty lists dropped. Undefined when nothing is left.
 */
export function cleanBrandPrefs(raw: unknown): BrandPrefs | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: BrandPrefs = {};
  for (const c of BRAND_CATEGORIES) {
    const list = (raw as Record<string, unknown>)[c.id];
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    const names: string[] = [];
    for (const v of list) {
      if (typeof v !== 'string') continue;
      const name = v.replace(/\s+/g, ' ').trim();
      if (!name || name.length > BRAND_PREFS_LIMITS.name || seen.has(brandKey(name))) continue;
      seen.add(brandKey(name));
      names.push(name);
      if (names.length >= BRAND_PREFS_LIMITS.perCategory) break;
    }
    if (names.length) out[c.id] = names;
  }
  return Object.keys(out).length ? out : undefined;
}

export const hasBrandPrefs = (prefs: BrandPrefs | undefined): prefs is BrandPrefs => !!prefs && BRAND_CATEGORIES.some((c) => (prefs[c.id]?.length ?? 0) > 0);

/** The kitchen's chosen brands for a product's category (empty: any brand). */
function chosenKeys(prefs: BrandPrefs | undefined, category: string): Set<string> {
  if (!prefs || !isBrandCategory(category)) return new Set();
  return new Set((prefs[category] ?? []).map(brandKey));
}

/** True when the product is one of the kitchen's chosen brands for its category. */
export function isPreferred(p: Product, prefs: BrandPrefs | undefined): boolean {
  const keys = chosenKeys(prefs, p.category);
  return keys.size > 0 && keys.has(brandKey(brandName(p)));
}

/** "3 brands" / "Any brand" summary of a kitchen's choices, for the wizard's preview card. */
export function brandPrefsLabel(prefs: BrandPrefs | undefined): string {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const c of BRAND_CATEGORIES) {
    for (const n of prefs?.[c.id] ?? []) {
      if (seen.has(brandKey(n))) continue;
      seen.add(brandKey(n));
      names.push(n);
    }
  }
  if (!names.length) return 'Any brand';
  return names.length <= 2 ? names.join(' & ') : `${names.length} chosen brands`;
}

// ─── What the wizard offers ───────────────────────────────────────────────

/**
 * One brand in one category as the retail catalog counts it: the shape `brandsForCategory`
 * (src/catalog/retail.ts) and `GET /api/catalog/brands?category=` return.
 */
export interface BrandCount {
  brand: string;
  /** Products of this brand in the category. */
  products: number;
  /** Store names that list them, most listings first. */
  stores: string[];
  /** True for BluModel Basics. */
  basics?: boolean;
}

export interface BrandOption {
  brand: string;
  key: string;
  category: BrandCategory;
  /** Products of the brand in this category (researched or in the catalog, whichever is more). */
  products: number;
  /** Of those, the ones in the app's catalog that the layout can place today. */
  inCatalog: number;
  /** Stores that carry it, most listings first. */
  stores: string[];
}

/** Catalog products that can stand for a brand: not placeholders for missing products, not other kitchens' snapshots. */
const usable = (p: Product) => p.source !== 'missing' && p.source !== 'snapshot';

/**
 * The brands to offer per category: every brand of the retail catalog's counts and every brand
 * with products in the catalog registry, merged by `brandKey`; most products first. BluModel
 * Basics is not offered: it is what fills every slot no chosen brand can, and "Any" means it.
 */
export function brandOptions(products: Product[], retail: Partial<Record<BrandCategory, BrandCount[]>> = {}): Record<BrandCategory, BrandOption[]> {
  const out = {} as Record<BrandCategory, BrandOption[]>;
  for (const c of BRAND_CATEGORIES) {
    const byKey = new Map<string, BrandOption>();
    for (const r of retail[c.id] ?? []) {
      const key = typeof r.brand === 'string' ? brandKey(r.brand) : '';
      if (!key || key === BASICS_KEY || r.basics) continue;
      const stores = Array.isArray(r.stores) ? r.stores.filter((x): x is string => typeof x === 'string' && !!x) : [];
      const products = Number.isFinite(r.products) ? Math.max(0, r.products) : 0;
      const prev = byKey.get(key);
      if (prev) {
        prev.products += products;
        prev.stores = [...new Set([...prev.stores, ...stores])];
      } else byKey.set(key, { brand: r.brand, key, category: c.id, products, inCatalog: 0, stores });
    }
    for (const p of products) {
      if (p.category !== c.id || !usable(p) || isBasics(p)) continue;
      const key = brandKey(p.brand);
      if (!key || key === BASICS_KEY) continue;
      const o = byKey.get(key) ?? { brand: p.brand, key, category: c.id, products: 0, inCatalog: 0, stores: [] };
      o.inCatalog++;
      byKey.set(key, o);
    }
    const list = [...byKey.values()].map((o) => ({ ...o, products: Math.max(o.products, o.inCatalog) }));
    list.sort((a, b) => b.products - a.products || a.brand.localeCompare(b.brand));
    out[c.id] = list;
  }
  return out;
}

// ─── Picking products for a layout ────────────────────────────────────────

/** Kinds whose variant is only a look (gas or induction, chimney or plaster): any of them fills the slot. */
const STYLE_ONLY = new Set<Kind>(['range', 'hood', 'fridge', 'dishwasher', 'microwave', 'wine', 'sink', 'pendant']);
/** For these, a product that names no variant is taken to be the plain one. */
const PLAIN_VARIANT: Partial<Record<Kind, string>> = { base: 'door-drawer', wall: 'door', tall: 'pantry' };
/** Hung overhead with nothing beside it: any size will do. */
const SIZE_FREE = new Set<Kind>(['pendant']);
/** Pieces under the one countertop: a brand's must stand within 2″ of the Basics height. */
const COUNTER_HEIGHT = new Set<Kind>(['base', 'corner', 'sink', 'dishwasher', 'range', 'wine', 'island']);

/** Same kind, and the same variant where the variant changes what the piece is (drawers vs doors, glass vs solid). */
function sameType(c: Product, base: Product, asked?: string): boolean {
  if (c.kind !== base.kind) return false;
  if (STYLE_ONLY.has(base.kind)) return !asked || !c.variant || c.variant === asked;
  return (c.variant ?? PLAIN_VARIANT[c.kind]) === (base.variant ?? PLAIN_VARIANT[base.kind]);
}

/**
 * Takes the Basics piece's place without changing the layout around it: under the ceiling, sold in
 * the width the layout needs, hung at the same height, within 3″ of its depth (a fridge may stand
 * 6″ proud), a counter-height piece within 2″ of its height, and a fridge no taller (the cabinet
 * over it sits right on top).
 */
function fits(c: Product, base: Picked, ceilingIn?: number): boolean {
  const b = base.product;
  if (ceilingIn && (c.elevationIn ?? 0) + c.heightIn > ceilingIn) return false;
  if (SIZE_FREE.has(b.kind)) return true;
  const sizes = c.widthOptions?.length ? c.widthOptions : [c.widthIn];
  if (!sizes.includes(base.widthIn)) return false;
  if (Math.abs((c.elevationIn ?? 0) - (b.elevationIn ?? 0)) > 1) return false;
  const dd = c.depthIn - b.depthIn;
  if (dd < -3 || dd > (b.kind === 'fridge' ? 6 : 3)) return false;
  if (COUNTER_HEIGHT.has(b.kind) && Math.abs(c.heightIn - b.heightIn) > 2) return false;
  if (b.kind === 'fridge' && c.heightIn > b.heightIn + 0.5) return false;
  return true;
}

/** Swaps a BluModel Basics pick for one of the kitchen's chosen brands where it can. */
export type BrandSwap = (base: Picked, asked?: string) => Picked;

export interface BrandPickOptions {
  /** The room's ceiling: a tall or wall piece must fit under it. */
  ceilingIn?: number;
  /** The products to choose from (tests); the catalog registry otherwise. */
  catalog?: Product[];
}

/** A product's look within its brand: line and finish, so a kitchen's cabinets come from one line in one colour. */
function lookOf(p: Product): string {
  const finish = Array.isArray(p.finishes) ? (p.finishes[0]?.id ?? '') : p.finishes;
  return `${brandKey(p.brand)}|${(p.line ?? '').toLowerCase()}|${finish}`;
}

/**
 * The layout builder's brand preference, for one build. Undefined when the kitchen chose no
 * brands, so the builder's output is exactly what it was without this.
 *
 * For each slot, `base` is the BluModel Basics pick. When the kitchen prefers brands for that
 * category and one of them sells the same type in the same size, that product takes the slot: the
 * chosen brands in the order they were chosen; within a brand the look (line and finish) already
 * used in this kitchen, else the look the brand sells most of. Otherwise `base` stands, so a
 * layout's geometry never changes because of a brand choice.
 */
export function brandPicker(prefs: BrandPrefs | undefined, opts: BrandPickOptions = {}): BrandSwap | undefined {
  if (!hasBrandPrefs(prefs)) return undefined;
  const wanted = new Map<BrandCategory, string[]>();
  for (const c of BRAND_CATEGORIES) {
    const keys = [...new Set((prefs[c.id] ?? []).map(brandKey))].filter((k) => k && k !== BASICS_KEY);
    if (keys.length) wanted.set(c.id, keys);
  }
  if (!wanted.size) return undefined;
  const pool = (opts.catalog ?? useCatalog.getState().products).filter((p) => usable(p) && !isBasics(p) && wanted.get(p.category as BrandCategory)?.includes(brandKey(p.brand)));
  if (!pool.length) return undefined;
  const lookSize = new Map<string, number>();
  for (const p of pool) lookSize.set(lookOf(p), (lookSize.get(lookOf(p)) ?? 0) + 1);
  const order = new Map(pool.map((p, i) => [p.id, i]));
  const used = new Map<string, string>(); // brand key → look chosen first

  return (base, asked) => {
    const cat = base.product.category;
    const keys = isBrandCategory(cat) ? wanted.get(cat) : undefined;
    if (!keys) return base;
    const list = pool.filter((c) => c.category === cat && sameType(c, base.product, asked) && fits(c, base, opts.ceilingIn));
    if (!list.length) return base;
    const rank = (c: Product): number[] => {
      const brand = brandKey(c.brand);
      const look = lookOf(c);
      return [keys.indexOf(brand), used.get(brand) === look ? 0 : 1, -(lookSize.get(look) ?? 0), order.get(c.id) ?? 0];
    };
    const ranked = list.map((c) => ({ c, r: rank(c) }));
    ranked.sort((a, b) => {
      for (let i = 0; i < a.r.length; i++) if (a.r[i] !== b.r[i]) return a.r[i] - b.r[i];
      return 0;
    });
    const c = ranked[0].c;
    if (!used.has(brandKey(c.brand))) used.set(brandKey(c.brand), lookOf(c));
    return { productId: c.id, product: c, widthIn: SIZE_FREE.has(c.kind) ? c.widthIn : base.widthIn };
  };
}

/** How many of a kitchen's pieces come from its chosen brands, of the pieces in those categories. */
export function brandShare(doc: Pick<DesignDoc, 'items'>, prefs: BrandPrefs | undefined): { fromBrands: number; inCategories: number } {
  let fromBrands = 0;
  let inCategories = 0;
  for (const it of doc.items) {
    const p = getProduct(it.productId);
    if (!p || chosenKeys(prefs, p.category).size === 0) continue;
    inCategories++;
    if (!isBasics(p) && isPreferred(p, prefs)) fromBrands++;
  }
  return { fromBrands, inCategories };
}

/**
 * Add products' "Your brands" filter: in a category with chosen brands, only their products;
 * other categories as they are. A category whose chosen brands have nothing in the catalog yet
 * stays whole rather than empty.
 */
export function filterToPrefs(products: Product[], prefs: BrandPrefs | undefined): Product[] {
  if (!hasBrandPrefs(prefs)) return products;
  const hit = new Set<string>();
  for (const p of products) if (isPreferred(p, prefs)) hit.add(p.category);
  return products.filter((p) => !hit.has(p.category) || isPreferred(p, prefs));
}
