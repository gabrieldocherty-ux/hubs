/**
 * Real retailer products (RONA, Home Depot, Home Hardware, IKEA, Best Buy…): the client side.
 *
 * The data is `src/data/retail.json`, generated from the research in `catalog/retail/*.json` by
 * `node server/catalog/retailBuild.mjs`. It is our internal research library, so it is NOT in the
 * client bundle: it comes from `GET /api/catalog/retail`, which answers only BluModel's own staff
 * (admin, studio) signed in on the sales site, rate-limited. A showroom never asks for it, and
 * nobody else gets it: for them the retail catalog is simply absent (status 'unavailable'). It loads
 * the first time the catalog panel or a retail product page opens, and again when a staff member
 * signs in. Nothing here calls a retailer: a store link is a plain navigation, and the only other
 * requests are the same-origin click count and the admin's affiliate settings
 * (`GET /api/catalog/retailers`).
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
import { useSession } from '../store/useSession';
import { useConfig } from '../lib/config';
import { looksLikeShowroomHost } from '../features/showroom/site';
import { fixtureFromWire, registerFixtures, type FixtureWire } from '../lib/fixtures';

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
  /** The finish id this listing sells, when the product comes in more than one. */
  finish?: string;
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
  /** Placed dimensions taken from the type's typical size because the listing had none (width only for stools and pendants). */
  typical: ('width' | 'depth' | 'height')[];
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

/** A faucet, pull or knob: chosen kitchen-wide in Room & finishes rather than placed (`src/lib/fixtures.ts`). */
export type RetailFixtureWire = FixtureWire & { retail: Omit<RetailInfo, 'typical'> & { typical: string[] } };

export interface RetailData {
  version: number;
  checkedAt: string | null;
  researched: number;
  stores: RetailStore[];
  products: RetailWire[];
  /** Faucets, pulls and knobs. Absent on data built before round 2. */
  fixtures?: RetailFixtureWire[];
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
  return { ...rest, sku: w.code, price: price ?? (basic ? priceFor(basic, w.widthIn) : 0), ...(price === null ? { priceAtStore: true } : {}), source: 'brand' };
}

interface RetailState {
  /** 'unavailable': not for this viewer (a showroom, or not BluModel staff); nothing was asked for. */
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
  data: RetailData | null;
  products: Product[];
  /** Store facts by id, for products and fixtures alike. */
  byId: Map<string, RetailInfo>;
  /** The faucets, pulls and knobs, in catalog order. */
  fixtures: RetailFixtureWire[];
  stores: Map<string, RetailStore>;
  /** UPC (upcKey) → retail id, for listings fetched one at a time (`retailByUpc`) without the library. */
  upcIds: Map<string, string>;
}

export const useRetail = create<RetailState>()(() => ({ status: 'idle', data: null, products: [], byId: new Map(), fixtures: [], stores: new Map(), upcIds: new Map() }));

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
  const fixtures = Array.isArray(data.fixtures) ? data.fixtures : [];
  useRetail.setState({
    status: 'ready',
    data,
    products,
    fixtures,
    upcIds: new Map(),
    byId: new Map<string, RetailInfo>([...data.products.map((p) => [p.id, p.retail] as const), ...fixtures.map((f) => [f.id, f.retail as RetailInfo] as const)]),
    stores: new Map(data.stores.map((s) => [s.slug, s])),
  });
  register(products);
  registerFixtures(fixtures.map(fixtureFromWire));
}

/** Who may have the research library: BluModel's own staff on the sales site, never a showroom. */
export function retailAllowed(): boolean {
  if (useConfig.getState().config?.tenant) return false;
  if (typeof location !== 'undefined' && location.hostname && looksLikeShowroomHost(location.hostname)) return false;
  const role = useSession.getState().user?.role;
  return role === 'admin' || role === 'studio';
}

let followingSession = false;
/** A staff member who signs in after the panel opened gets the library then, without a reload. */
function followSession() {
  if (followingSession) return;
  followingSession = true;
  useSession.subscribe((st, prev) => {
    if (st.user?.role !== prev.user?.role && useRetail.getState().status === 'unavailable' && retailAllowed()) void loadRetail();
  });
}

/** Loads the retail library once (staff only) and registers its products. Never throws. */
export function loadRetail(): Promise<void> {
  if (useRetail.getState().status === 'ready') return Promise.resolve();
  if (inflight) return inflight;
  followSession();
  if (!retailAllowed()) {
    useRetail.setState({ status: 'unavailable' });
    return Promise.resolve();
  }
  useRetail.setState({ status: 'loading' });
  inflight = call<RetailData>('GET', '/api/catalog/retail')
    .then((data) => applyRetailData(data))
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

/** A UPC as digits, with a 13-digit code that starts with 0 read as the 12-digit UPC-A it encodes (server/payments/upc.mjs). */
export function upcKey(raw: string | null | undefined): string {
  const s = String(raw ?? '').replace(/\D/g, '');
  return s.length === 13 && s.startsWith('0') ? s.slice(1) : s;
}

/**
 * The retail product or fixture listed under this UPC, by id (once the retail data is loaded): how
 * a delivered custom model whose request gave a UPC finds its stores. Undefined without a match.
 */
export function retailIdByUpc(upc: string | null | undefined, data: RetailData | null = useRetail.getState().data): string | undefined {
  const key = upcKey(upc);
  if (key.length < 8 || !data) return undefined;
  return [...data.products, ...(data.fixtures ?? [])].find((p) => p.retail.upc && upcKey(p.retail.upc) === key)?.id;
}

const upcAsked = new Map<string, Promise<string | undefined>>();

/**
 * The retail listing for a UPC, for a signed-in account that doesn't have the library (a delivered
 * custom model standing for a store product): `GET /api/catalog/retail/upc/:upc` gives just that
 * listing and its stores, which go into `byId` and `stores` so "Where to buy" can show them. With
 * the library loaded it answers from that. Never on a showroom. Resolves the retail id, or undefined.
 */
export function retailByUpc(upc: string | null | undefined): Promise<string | undefined> {
  const key = upcKey(upc);
  const st = useRetail.getState();
  if (key.length < 8) return Promise.resolve(undefined);
  if (st.status === 'ready') return Promise.resolve(retailIdByUpc(key, st.data));
  if (st.upcIds.has(key)) return Promise.resolve(st.upcIds.get(key));
  if (useConfig.getState().config?.tenant || !useSession.getState().user) return Promise.resolve(undefined);
  let asked = upcAsked.get(key);
  if (!asked) {
    asked = call<{ id: string; retail: RetailInfo; stores: RetailStore[] }>('GET', `/api/catalog/retail/upc/${encodeURIComponent(key)}`)
      .then(({ id, retail, stores }) => {
        useRetail.setState((s) => ({
          byId: new Map([...s.byId, [id, retail]]),
          stores: new Map([...s.stores, ...stores.map((x) => [x.slug, x] as const)]),
          upcIds: new Map([...s.upcIds, [key, id]]),
        }));
        return id;
      })
      .catch(() => undefined);
    upcAsked.set(key, asked);
  }
  return asked;
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

/** One brand in one category: the shape of `GET /api/catalog/brands?category=` → `retailBrands`. */
export interface RetailBrandCount {
  brand: string;
  /** Products of this brand in the category. */
  products: number;
  /** Store names that list them ("RONA", "Home Depot"), most listings first. */
  stores: string[];
  /** The same stores as slugs (`rona`, `home-depot`). */
  storeSlugs: string[];
  /** True for BluModel Basics (the built-ins; never on the server's list). */
  basics?: boolean;
}

/**
 * The brands with products in a category (or every category), with product counts and the stores
 * that carry them: the retail brands by product count, then BluModel Basics. Works offline: the
 * same retail numbers as `GET /api/catalog/brands?category=` (the server leaves Basics to the client).
 */
export async function brandsForCategory(category: CategoryId | 'all'): Promise<RetailBrandCount[]> {
  await loadRetail();
  return brandCounts(category, useRetail.getState().data, BUILTIN_PRODUCTS);
}

/** The pure part of `brandsForCategory` (shared with the tests). */
export function brandCounts(category: CategoryId | 'all', data: RetailData | null, builtins: Product[]): RetailBrandCount[] {
  const inCat = (c: string) => category === 'all' || c === category;
  const basics = builtins.filter((p) => inCat(p.category)).length;
  const storeNames = new Map((data?.stores ?? []).map((s) => [s.slug, s.name]));
  const map = new Map<string, { n: number; stores: Map<string, number> }>();
  for (const p of data?.products ?? []) {
    if (!inCat(p.category)) continue;
    const e = map.get(p.brand) ?? { n: 0, stores: new Map<string, number>() };
    e.n += 1;
    for (const s of new Set(p.retail.stores.map((l) => l.store))) e.stores.set(s, (e.stores.get(s) ?? 0) + 1);
    map.set(p.brand, e);
  }
  const retail: RetailBrandCount[] = [...map]
    .map(([brand, e]) => {
      const storeSlugs = [...e.stores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
      return { brand, products: e.n, stores: storeSlugs.map((s) => storeNames.get(s) ?? s), storeSlugs };
    })
    .sort((a, b) => b.products - a.products || a.brand.localeCompare(b.brand));
  return [...retail, ...(basics ? [{ brand: BASICS_BRAND, products: basics, stores: [], storeSlugs: [], basics: true }] : [])];
}
