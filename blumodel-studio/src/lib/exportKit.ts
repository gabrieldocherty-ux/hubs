import type { DesignDoc, Product } from '../types';
import type { PriceBookData } from '../types/platform';
import { getProduct, isBuiltin, missingProduct, priceFor, productCode } from '../data/catalog';
import { BUILTIN_PRODUCTS } from '../data/builtins';
import { buildEstimate, type Estimate } from './estimate';
import { estimateCsv } from './csv';
import { slug } from './exporters';
import { withProducts } from './kit/catalogShim';
import { makePriceOf, sellPricesOf } from '../features/contractors/priceMath';

/**
 * The export kit: the browser's estimate, CSV and contractor price math, bundled by
 * `scripts/build-kit.mjs` into `server/generated/export-kit.mjs`. The server uses it to make the
 * paid exports itself (PLANS_AND_CONTRACTORS §2) byte for byte as the editor would, and to price a
 * contractor's kitchen exactly as their editor does.
 *
 * `products` are the non-built-in products the doc uses (live, else its embedded snapshots).
 * Anything still unknown is an unavailable placeholder, as in the editor.
 */

type SellPrices = Record<string, { price: number; priceByWidth?: Record<string, number> }>;
interface KitOptions {
  products?: Product[];
  priceBook?: PriceBookData | null;
}

function productsFor(doc: DesignDoc, products: Product[]): Product[] {
  const known = new Map(products.filter(Boolean).map((p) => [p.id, p]));
  for (const [id, p] of Object.entries(doc.products ?? {})) if (p && !known.has(id)) known.set(id, { ...p, id, source: 'snapshot' });
  for (const it of doc.items) if (!isBuiltin(it.productId) && !known.has(it.productId)) known.set(it.productId, missingProduct(it.productId));
  return [...known.values()];
}

const optionsFor = (priceBook?: PriceBookData | null) => (priceBook ? { priceOf: makePriceOf(priceBook) } : {});

export function estimateFor(doc: DesignDoc, opts: KitOptions = {}): Estimate {
  return withProducts(productsFor(doc, opts.products ?? []), () => buildEstimate(doc, optionsFor(opts.priceBook)));
}

/** The shopping-list CSV: exactly what the editor's Export → Shopping list produces. */
export function csvFor(doc: DesignDoc, opts: KitOptions = {}): { filename: string; content: string } {
  const content = withProducts(productsFor(doc, opts.products ?? []), () => estimateCsv(doc, buildEstimate(doc, optionsFor(opts.priceBook))));
  return { filename: `${slug(doc.name)}-shopping-list.csv`, content };
}

/** A contractor's sell prices for every product the doc uses, built-ins included (share pages). */
export function sellPricesFor(doc: DesignDoc, priceBook: PriceBookData, products: Product[] = []): SellPrices {
  return withProducts(productsFor(doc, products), () => {
    const out: SellPrices = {};
    for (const it of doc.items) {
      if (out[it.productId]) continue;
      const p = getProduct(it.productId);
      if (p && p.source !== 'missing') out[it.productId] = sellPricesOf(priceBook, p);
    }
    return out;
  });
}

/** Wire products with their list prices replaced by sell prices (no cost fields are added). */
export function applySellPrices(products: Product[], priceBook: PriceBookData): Product[] {
  return withProducts(products, () =>
    products.map((p) => {
      const sell = sellPricesOf(priceBook, p); // from the list prices, so before they are replaced
      const { priceByWidth: _list, ...rest } = p;
      return { ...rest, ...sell };
    }),
  );
}

/** A contractor's quote for a product at a width (sell price, and their cost). */
export function quoteAt(priceBook: PriceBookData | null, p: Product, widthIn: number) {
  return makePriceOf(priceBook)(p, widthIn);
}

export { BUILTIN_PRODUCTS, makePriceOf, priceFor, productCode, slug };
