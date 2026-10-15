/**
 * Real retailer products (RONA, Home Depot, Home Hardware, IKEA, Best Buy…): the client side.
 *
 * The data is `src/data/retail.json`, generated from the research in `catalog/retail/*.json` by
 * `node server/catalog/retailBuild.mjs`. It loads as its own lazy chunk the first time the catalog
 * panel or a retail product page opens, so it works offline and costs nothing until then. Nothing
 * here calls a retailer: a store link is a plain navigation, and the only request is the
 * same-origin click count (and the admin's affiliate settings, `GET /api/catalog/retailers`).
 *
 * Each retail entry becomes an ordinary `Product` (one of the app's kinds, so it snaps, renders
 * and prices like any other) registered in the catalog with source `brand`. Its store facts stay
 * here, keyed by id (`retailOf`), so a saved kitchen's snapshot stays small.
 */
import { create } from 'zustand';
import type { CategoryId, Kind, Product } from '../types';
import { BASICS_BRAND, BUILTIN_PRODUCTS } from '../data/builtins';
import { priceFor } from '../data/catalog';
import { call } from '../lib/api';
import { useCatalog } from '../store/useCatalog';

export const RETAIL_PREFIX = 'r-';
/** True for a retail product id (`r-…`). No built-in id starts this way. */
export const isRetailId = (id: string | null | undefined): boolean => typeof id === 'string' && id.startsWith(RETAIL_PREFIX);

export interface RetailListing {
  /** Store slug (`rona`, `home-depot`…). */
  store: string;
  url: string;
  sku: string | null;
  priceCad: number | null;
  inStock: boolean | null;
}

export interface RetailInfo {
  key: string;
  /** The product type it was drawn as (`src/data/productTypes.ts`). */
  type: string;
  upc: string | null;
  confidence: 'low' | 'medium' | 'high';
  /** When the listing was checked, `YYYY-MM-DD`. */
  checkedAt: string;
  /** The size the listing gave, in inches; null where it gave none. */
  size: { w: number | null; d: number | null; h: number | null };
  /** Placed dimensions taken from the type's typical size because the listing had none. */
  typical: ('depth' | 'height')[];
  /** How it is drawn when that differs from the listing (a sink in its base cabinet…). */
  note?: string;
  /** A door style the app doesn't draw (raised panel…), for the facts. */
  style?: string;
  stores: RetailListing[];
}

export interface RetailStore {
  slug: string;
  name: string;
  domain: string;
}

type RetailWire = Omit<Product, 'price' | 'source'> & { price: number | null; retail: RetailInfo };

export interface RetailData {
  version: number;
  checkedAt: string | null;
  researched: number;
  stores: RetailStore[];
  products: RetailWire[];
  leftOut: { count: number; byReason: Record<string, number> };
}

/** The BluModel Basics product an unpriced retail product borrows a typical price from. */
function basicFor(kind: Kind, variant?: string): Product | undefined {
  return BUILTIN_PRODUCTS.find((p) => p.kind === kind && p.variant === variant) ?? BUILTIN_PRODUCTS.find((p) => p.kind === kind);
}

/**
 * A retail entry as a catalog `Product`. Its price is the lowest store price checked, in whole
 * dollars; with none, the typical price of the BluModel Basics product of the same type
 * (`retailPriceKnown` tells them apart).
 */
export function toProduct(w: RetailWire): Product {
  const { retail: _retail, price, ...rest } = w;
  const basic = price === null ? basicFor(w.kind, w.variant) : undefined;
  return { ...rest, sku: w.code, price: price ?? (basic ? priceFor(basic, w.widthIn) : 0), source: 'brand' };
}

interface RetailState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: RetailData | null;
  products: Product[];
  byId: Map<string, RetailInfo>;
  stores: Map<string, RetailStore>;
}

export const useRetail = create<RetailState>()(() => ({ status: 'idle', data: null, products: [], byId: new Map(), stores: new Map() }));

let inflight: Promise<void> | null = null;
let watching = false;

/** Puts the retail products in the catalog, and back again after a forced catalog reload drops them. */
function register(products: Product[]) {
  if (!products.length) return;
  useCatalog.getState().register(products);
  if (watching) return;
  watching = true;
  const probe = products[0].id;
  useCatalog.subscribe((st, prev) => {
    if (st.products !== prev.products && !st.products.some((p) => p.id === probe)) useCatalog.getState().register(useRetail.getState().products);
  });
}

/** Applies loaded data (exported for tests, which can't use the lazy chunk). */
export function applyRetailData(data: RetailData): void {
  const products = data.products.map(toProduct);
  useRetail.setState({
    status: 'ready',
    data,
    products,
    byId: new Map(data.products.map((p) => [p.id, p.retail])),
    stores: new Map(data.stores.map((s) => [s.slug, s])),
  });
  register(products);
}

/** Loads the retail chunk once and registers its products. Never throws. */
export function loadRetail(): Promise<void> {
  if (useRetail.getState().status === 'ready') return Promise.resolve();
  if (inflight) return inflight;
  useRetail.setState({ status: 'loading' });
  inflight = import('../data/retail.json')
    .then((m) => applyRetailData(((m as { default?: unknown }).default ?? m) as RetailData))
    .catch(() => useRetail.setState({ status: 'error' }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The store facts for a retail product id (once loaded). */
export function retailOf(id: string): RetailInfo | undefined {
  return useRetail.getState().byId.get(id);
}

/** The store's display name for a slug. */
export function storeName(slug: string): string {
  return useRetail.getState().stores.get(slug)?.name ?? slug;
}

/** True when a store price was checked (otherwise the price is a typical one). */
export function retailPriceKnown(info: RetailInfo | undefined): boolean {
  return !!info?.stores.some((s) => s.priceCad !== null);
}

/** Distinct store slugs a product is listed at, in listing order. */
export function storesOf(info: RetailInfo | undefined): string[] {
  return info ? [...new Set(info.stores.map((s) => s.store))] : [];
}

// ── the admin's settings per store: affiliate parameter and the sponsored flag ──

export interface RetailerConfig {
  slug: string;
  name: string;
  sponsored: boolean;
  /** A query string added to the store's links (`aff=blumodel`), or ''. */
  affiliate: string;
}

export const useRetailers = create<{ status: 'idle' | 'loading' | 'ready' | 'error'; bySlug: Map<string, RetailerConfig> }>()(() => ({ status: 'idle', bySlug: new Map() }));

/** Fetches the store settings once. Offline or failing, links go out plain and nothing is sponsored. */
export function loadRetailers(force = false): Promise<void> {
  const { status } = useRetailers.getState();
  if (!force && (status === 'ready' || status === 'loading')) return Promise.resolve();
  useRetailers.setState({ status: 'loading' });
  return call<{ retailers: RetailerConfig[] }>('GET', '/api/catalog/retailers')
    .then(({ retailers }) => useRetailers.setState({ status: 'ready', bySlug: new Map((Array.isArray(retailers) ? retailers : []).map((r) => [r.slug, r])) }))
    .catch(() => useRetailers.setState({ status: 'error' }));
}

/** The store link with the store's affiliate parameter added (it replaces a same-named one). */
export function storeLink(url: string, affiliate: string | undefined): string {
  if (!affiliate) return url;
  try {
    const u = new URL(url);
    for (const [k, v] of new URLSearchParams(affiliate)) u.searchParams.set(k, v);
    return u.protocol === 'https:' ? u.toString() : url;
  } catch {
    return url;
  }
}

/** Listings in the order to show: sponsored stores first, then the lowest checked price, then by store name. */
export function sortListings(list: RetailListing[], bySlug: Map<string, RetailerConfig>): RetailListing[] {
  const sp = (l: RetailListing) => (bySlug.get(l.store)?.sponsored ? 0 : 1);
  return [...list].sort((a, b) => sp(a) - sp(b) || (a.priceCad ?? Infinity) - (b.priceCad ?? Infinity) || storeName(a.store).localeCompare(storeName(b.store)));
}

/** Counts a link-out (store + product only, nothing about the person). Fire and forget. */
export function countClick(productId: string, store: string): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  call('POST', '/api/catalog/retail/clicks', { productId, store }, { keepalive: true }).catch(() => undefined);
}

/** "Oct 15, 2026" for a `YYYY-MM-DD` date. */
export function checkedLabel(day: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function cad(n: number): string {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', currencyDisplay: 'symbol', minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

// ── brand lists for the new-kitchen wizard's brand step ──

export interface BrandCount {
  name: string;
  source: 'basics' | 'retail';
  productCount: number;
  /** Store slugs that list this brand's products in the category, most listings first. */
  stores: string[];
}

/**
 * The brands with products in a category (or every category), with product counts and the stores
 * that carry them: BluModel Basics first, then the retail brands by product count. Works offline
 * (the same numbers as `GET /api/catalog/brands?category=`, minus partner brands on the server).
 */
export async function brandsForCategory(category: CategoryId | 'all'): Promise<BrandCount[]> {
  await loadRetail();
  return brandCounts(category, useRetail.getState().data, BUILTIN_PRODUCTS);
}

/** The pure part of `brandsForCategory` (shared with the tests). */
export function brandCounts(category: CategoryId | 'all', data: RetailData | null, builtins: Product[]): BrandCount[] {
  const inCat = (c: string) => category === 'all' || c === category;
  const basics = builtins.filter((p) => inCat(p.category)).length;
  const map = new Map<string, { n: number; stores: Map<string, number> }>();
  for (const p of data?.products ?? []) {
    if (!inCat(p.category)) continue;
    const e = map.get(p.brand) ?? { n: 0, stores: new Map<string, number>() };
    e.n += 1;
    for (const s of new Set(p.retail.stores.map((l) => l.store))) e.stores.set(s, (e.stores.get(s) ?? 0) + 1);
    map.set(p.brand, e);
  }
  const retail = [...map]
    .map(([name, e]) => ({ name, source: 'retail' as const, productCount: e.n, stores: [...e.stores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s) }))
    .sort((a, b) => b.productCount - a.productCount || a.name.localeCompare(b.name));
  return [...(basics ? [{ name: BASICS_BRAND, source: 'basics' as const, productCount: basics, stores: [] }] : []), ...retail];
}
