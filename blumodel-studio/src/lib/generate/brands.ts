import type { BrandCategory, BrandPrefs, DesignDoc, Kind, Product } from '../../types';
import { getProduct, isBuiltin } from '../../data/catalog';
import { useCatalog } from '../../store/useCatalog';
import type { Picked } from './layout';

/**
 * Preferred brands: the setup wizard's "Choose your brands" step, the layout builder's brand
 * preference, and the default of Add products.
 *
 * Two sources feed the brand list. Products in the catalog registry (built-ins, the server's
 * catalog, a contractor's own lines) are what the layout can actually place. The retail catalog
 * (`catalog/retail/*.json`, researched by the retail package) adds how many products each brand
 * has and which stores carry it, through the summary in `src/data/retailBrands.json`. A brand the
 * layout can't place yet still counts as a preference: the builder uses it wherever one of its
 * products fits and falls back to BluModel Basics everywhere else.
 */

export type { BrandCategory, BrandPrefs };

/** The name the built-in products go by (decision 2026-10-15: the fictional built-in brands are relabelled). */
export const BASICS_BRAND = 'BluModel Basics';

export const BRAND_CATEGORIES: { id: BrandCategory; label: string; blurb: string }[] = [
  { id: 'cabinets', label: 'Cabinets', blurb: 'Base, wall and tall cabinets' },
  { id: 'appliances', label: 'Appliances', blurb: 'Ranges, fridges, dishwashers and hoods' },
  { id: 'sinks', label: 'Sinks & faucets', blurb: 'Sinks and the taps over them' },
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

// ─── The retail catalog's brand list ──────────────────────────────────────

/** One brand of the retail catalog in one wizard category. */
export interface RetailBrand {
  brand: string;
  category: BrandCategory;
  /** Researched products of this brand in the category. */
  products: number;
  /** Stores that carry it, most products first. */
  stores: string[];
}

export interface RetailBrandList {
  /** The newest `checkedAt` of the retail files. */
  checkedAt: string | null;
  brands: RetailBrand[];
}

/** Retail-catalog categories → the wizard's four. Countertops, flooring and the rest aren't brand-picked here. */
export const RETAIL_CATEGORY: Record<string, BrandCategory> = {
  cabinets: 'cabinets',
  appliances: 'appliances',
  hoods: 'appliances',
  sinks: 'sinks',
  faucets: 'sinks',
  lighting: 'lighting',
};

interface RetailFile {
  checkedAt?: unknown;
  products?: unknown;
}

/**
 * Summarises retail-catalog files (`{ checkedAt, products: [{ brand, category, stores: [{ store }] }] }`)
 * into one row per brand and wizard category. Spellings that share a `brandKey` merge under the
 * shortest one ("Eklipse (EBSU)" joins "Eklipse"). Sorted by category, then products, then name.
 */
export function summarizeRetail(files: RetailFile[]): RetailBrandList {
  let checkedAt: string | null = null;
  const rows = new Map<string, { names: Map<string, number>; category: BrandCategory; products: number; stores: Map<string, number> }>();
  for (const f of files) {
    if (!f || typeof f !== 'object' || !Array.isArray(f.products)) continue;
    if (typeof f.checkedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(f.checkedAt) && (!checkedAt || f.checkedAt > checkedAt)) checkedAt = f.checkedAt.slice(0, 10);
    for (const p of f.products as Record<string, unknown>[]) {
      if (!p || typeof p !== 'object') continue;
      const category = RETAIL_CATEGORY[String(p.category ?? '')];
      const brand = typeof p.brand === 'string' ? p.brand.replace(/\s+/g, ' ').trim() : '';
      if (!category || !brand) continue;
      const id = `${category}|${brandKey(brand)}`;
      const row = rows.get(id) ?? { names: new Map(), category, products: 0, stores: new Map() };
      row.names.set(brand, (row.names.get(brand) ?? 0) + 1);
      row.products++;
      const stores = new Set<string>();
      for (const s of Array.isArray(p.stores) ? (p.stores as Record<string, unknown>[]) : []) {
        const name = s && typeof s.store === 'string' ? s.store.trim() : '';
        if (name) stores.add(name);
      }
      for (const s of stores) row.stores.set(s, (row.stores.get(s) ?? 0) + 1);
      rows.set(id, row);
    }
  }
  const order = BRAND_CATEGORIES.map((c) => c.id);
  const brands = [...rows.values()].map((r) => ({
    brand: [...r.names.keys()].sort((a, b) => a.length - b.length || a.localeCompare(b))[0],
    category: r.category,
    products: r.products,
    stores: [...r.stores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s),
  }));
  brands.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || b.products - a.products || a.brand.localeCompare(b.brand));
  return { checkedAt, brands };
}

// ─── What the wizard offers ───────────────────────────────────────────────

export interface BrandOption {
  brand: string;
  key: string;
  category: BrandCategory;
  /** Products of the brand in this category (researched or in the catalog, whichever is more). */
  products: number;
  /** Of those, the ones in the app's catalog that the layout can place today. */
  inCatalog: number;
  stores: string[];
  basics: boolean;
}

/** Catalog products that can stand for a brand: not placeholders for missing products, not other kitchens' snapshots. */
const usable = (p: Product) => p.source !== 'missing' && p.source !== 'snapshot';

/**
 * The brands to offer per category: every brand of the retail list and every brand with products
 * in the catalog, merged by `brandKey`; most products first, BluModel Basics last.
 */
export function brandOptions(products: Product[], retail: RetailBrand[] = []): Record<BrandCategory, BrandOption[]> {
  const out = {} as Record<BrandCategory, BrandOption[]>;
  for (const c of BRAND_CATEGORIES) {
    const byKey = new Map<string, BrandOption>();
    const basics: BrandOption = { brand: BASICS_BRAND, key: brandKey(BASICS_BRAND), category: c.id, products: 0, inCatalog: 0, stores: [], basics: true };
    for (const r of retail) {
      if (r.category !== c.id || brandKey(r.brand) === basics.key) continue;
      const key = brandKey(r.brand);
      const prev = byKey.get(key);
      if (prev) {
        prev.products += r.products;
        prev.stores = [...new Set([...prev.stores, ...r.stores])];
      } else byKey.set(key, { brand: r.brand, key, category: c.id, products: r.products, inCatalog: 0, stores: [...r.stores], basics: false });
    }
    for (const p of products) {
      if (p.category !== c.id || !usable(p)) continue;
      if (isBasics(p)) {
        basics.inCatalog++;
        continue;
      }
      const key = brandKey(p.brand);
      if (!key) continue;
      const o = byKey.get(key) ?? { brand: p.brand, key, category: c.id, products: 0, inCatalog: 0, stores: [], basics: false };
      o.inCatalog++;
      byKey.set(key, o);
    }
    basics.products = basics.inCatalog;
    const list = [...byKey.values()].map((o) => ({ ...o, products: Math.max(o.products, o.inCatalog) }));
    list.sort((a, b) => b.products - a.products || a.brand.localeCompare(b.brand));
    out[c.id] = basics.products ? [...list, basics] : list;
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

/** Same kind, and the same variant where the variant changes what the piece is (drawers vs doors, glass vs solid). */
function sameType(c: Product, base: Product, asked?: string): boolean {
  if (c.kind !== base.kind) return false;
  if (STYLE_ONLY.has(base.kind)) return !asked || !c.variant || c.variant === asked;
  return (c.variant ?? PLAIN_VARIANT[c.kind]) === (base.variant ?? PLAIN_VARIANT[base.kind]);
}

/** Sold in the width the layout needs, and no deeper than the Basics piece by more than a little. */
function fits(c: Product, base: Picked): boolean {
  if (SIZE_FREE.has(base.product.kind)) return true;
  const sizes = c.widthOptions?.length ? c.widthOptions : [c.widthIn];
  if (!sizes.includes(base.widthIn)) return false;
  return c.depthIn <= base.product.depthIn + (base.product.kind === 'fridge' ? 6 : 3);
}

/**
 * The layout builder's brand preference. `base` is the BluModel Basics pick for a slot; when the
 * kitchen prefers brands for that category and one of them sells the same type in the same size,
 * that product takes the slot (the chosen brands in order, then catalog order). Otherwise `base`
 * stands, so a layout's geometry never changes because of a brand choice.
 */
export function preferBrand(base: Picked, prefs: BrandPrefs | undefined, asked?: string, catalog?: Product[]): Picked {
  if (!prefs || !isBrandCategory(base.product.category)) return base;
  const wanted = (prefs[base.product.category] ?? []).map(brandKey).filter((k) => k !== brandKey(BASICS_BRAND));
  if (!wanted.length) return base;
  const list = (catalog ?? useCatalog.getState().products).filter(
    (c) => usable(c) && c.category === base.product.category && !isBasics(c) && wanted.includes(brandKey(c.brand)) && sameType(c, base.product, asked) && fits(c, base),
  );
  if (!list.length) return base;
  list.sort((a, b) => wanted.indexOf(brandKey(a.brand)) - wanted.indexOf(brandKey(b.brand)));
  const c = list[0];
  return { productId: c.id, product: c, widthIn: SIZE_FREE.has(c.kind) ? c.widthIn : base.widthIn };
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
