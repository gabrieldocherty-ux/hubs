import type { CategoryId, PlacedItem, Product } from '../types';
import { BUILTIN_IDS, BUILTIN_PRODUCTS } from './builtins';
import { useCatalog } from '../store/useCatalog';
import kinds from './kinds.json';

/** Categories in catalog order, from `kinds.json` (shared with the server). */
export const CATEGORIES: { id: CategoryId; label: string }[] = kinds.categories as { id: CategoryId; label: string }[];

/** The built-in products (compiled in; see `builtins.ts`). Server products live in the registry. */
export const CATALOG: Product[] = BUILTIN_PRODUCTS;

const BUILTIN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const SERVER_ID = /^p_[a-z0-9]{24}$/;

/** True for an id compiled into the app. */
export function isBuiltin(id: string): boolean {
  return BUILTIN_IDS.has(id);
}

/** True for a server product id (`p_` + 24). */
export function isServerProductId(id: string): boolean {
  return SERVER_ID.test(id);
}

/** True for anything shaped like a product id the server accepts in a kitchen doc. */
export function isProductIdShape(id: unknown): id is string {
  return typeof id === 'string' && (BUILTIN_ID.test(id) || SERVER_ID.test(id));
}

/**
 * Resolves a product by id through the catalog registry: built-ins, live server products,
 * saved-kitchen snapshots and missing-product placeholders.
 */
export function getProduct(id: string): Product | undefined {
  return useCatalog.getState().byId.get(id);
}

/**
 * A stand-in for a product that isn't available (unpublished, deleted, or not loaded yet), so a
 * kitchen that uses it keeps the item instead of silently losing it. Renders as a neutral box.
 */
export function missingProduct(id: string): Product {
  return {
    id,
    kind: 'base',
    variant: 'missing',
    category: 'cabinets',
    brand: 'Unavailable',
    name: 'Unavailable product',
    code: '—',
    widthIn: 24,
    depthIn: 24,
    heightIn: 36,
    elevationIn: 0,
    price: 0,
    finishes: [{ id: 'missing', name: 'Unavailable', hex: '#d9d4cb', material: 'paint' }],
    blurb: 'This product is no longer listed or hasn’t loaded yet. It stays in your kitchen where you put it.',
    source: 'missing',
  };
}

export const isMissing = (p: Product) => p.source === 'missing';

export function itemWidth(item: PlacedItem, product: Product): number {
  return item.widthIn ?? product.widthIn;
}

/** The SKU for a width: a per-width SKU if the brand gave one, else the code with `{w}` filled in. */
export function productCode(product: Product, width: number): string {
  const byWidth = product.skuByWidth?.[String(width)];
  if (byWidth) return byWidth;
  return (product.sku || product.code).replace('{w}', String(width));
}

/**
 * Price at a width. A brand's per-width price wins; otherwise wider variants cost more, but not
 * linearly: the box, hinges and labor are fixed.
 */
export function priceFor(product: Product, width: number): number {
  const byWidth = product.priceByWidth?.[String(width)];
  if (typeof byWidth === 'number' && Number.isFinite(byWidth)) return byWidth;
  if (!product.widthOptions) return product.price;
  const ratio = width / product.widthIn;
  return Math.round((product.price * (0.45 + 0.55 * ratio)) / 5) * 5;
}

export const isOpening = (p: Product) => p.kind === 'window' || p.kind === 'door';
export const isCabinetry = (p: Product) =>
  p.kind === 'base' || p.kind === 'corner' || p.kind === 'wall' || p.kind === 'tall' || p.kind === 'island';
/** Items that sit under a countertop and get one automatically. */
export const hasCountertop = (p: Product) =>
  p.source !== 'missing' &&
  (p.kind === 'base' || p.kind === 'corner' || p.kind === 'island' || p.kind === 'sink' || p.kind === 'dishwasher' || p.kind === 'wine');
/** Items that make sense flush against a wall and should snap to it. */
export const snapsToWall = (p: Product) =>
  !['island', 'stool', 'pendant', 'table', 'chair', 'rug', 'plant'].includes(p.kind);
export const isOverhead = (p: Product) => p.elevationIn >= 48;
