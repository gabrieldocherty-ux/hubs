import type { Product } from '../../types';
import type { PriceBookData, PriceQuote } from '../../types/platform';
import { isBuiltin, priceFor } from '../../data/catalog';

/**
 * A contractor's sell price for a product (PLANS_AND_CONTRACTORS §4.4). One implementation,
 * used by the editor (usePriceBook) and, bundled into the export kit, by the server for
 * exports, quotes and share links, so every surface shows the same number.
 *
 *   cost   = per-width cost → the product's cost (other widths scale like its list price)
 *            → the brand's "% off list" → none
 *   markup = the product's markup → its line's → its brand's → the company default
 *   sell   = cost × (1 + markup), or the list price (flagged) when there's no cost
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const clampPct = (v: number) => Math.min(1000, Math.max(0, v));

/**
 * The key a product's brand settings live under: 'builtin' (Mise's built-in catalog), a
 * brand id, or 'own' (the contractor's own products and custom models). Decided from the
 * id and brand rather than `source`, which a saved-kitchen snapshot replaces.
 */
export function brandKeyOf(p: Product): string {
  if (p.brandId) return p.brandId;
  return isBuiltin(p.id) ? 'builtin' : 'own';
}

/** Lines are matched case-insensitively ("Smith Shaker" and "smith shaker" are one line). */
export function lineKeyOf(p: Product): string | null {
  return p.line ? `line:${p.line.trim().toLowerCase()}` : null;
}

/** Cost in cents at a width, before markup; null when the contractor hasn't entered one. */
export function costCentsAt(book: PriceBookData, p: Product, widthIn: number): number | null {
  const row = book.rows[p.id];
  const byWidth = row?.costByWidth?.[String(widthIn)];
  if (typeof byWidth === 'number' && Number.isFinite(byWidth)) return Math.max(0, Math.round(byWidth));
  if (row && typeof row.costCents === 'number' && Number.isFinite(row.costCents)) {
    const base = Math.max(0, Math.round(row.costCents));
    // One cost for a product sold in several widths: other widths scale like the list price.
    const baseList = priceFor(p, p.widthIn);
    if (widthIn !== p.widthIn && p.widthOptions?.length && baseList > 0) return Math.round((base * priceFor(p, widthIn)) / baseList);
    return base;
  }
  const brand = book.brands[brandKeyOf(p)];
  if (brand && typeof brand.pctOffList === 'number' && Number.isFinite(brand.pctOffList)) {
    const list = priceFor(p, widthIn);
    if (list > 0) return Math.round(list * 100 * (1 - Math.min(100, Math.max(0, brand.pctOffList)) / 100));
  }
  return null;
}

/** The markup that applies to a product, in percent. */
export function markupPctFor(book: PriceBookData, p: Product): number {
  const own = book.rows[p.id]?.markupPct;
  if (typeof own === 'number' && Number.isFinite(own)) return clampPct(own);
  const line = lineKeyOf(p);
  const lineMarkup = line ? book.brands[line]?.markupPct : null;
  if (typeof lineMarkup === 'number' && Number.isFinite(lineMarkup)) return clampPct(lineMarkup);
  const brandMarkup = book.brands[brandKeyOf(p)]?.markupPct;
  if (typeof brandMarkup === 'number' && Number.isFinite(brandMarkup)) return clampPct(brandMarkup);
  return clampPct(book.defaultMarkupPct);
}

export function quoteFor(book: PriceBookData, p: Product, widthIn: number): PriceQuote {
  const list = priceFor(p, widthIn);
  const costCents = costCentsAt(book, p, widthIn);
  if (costCents === null) return { sell: list, list, noCost: true };
  const markupPct = markupPctFor(book, p);
  const cost = costCents / 100;
  return { sell: round2(cost * (1 + markupPct / 100)), cost, markupPct, list };
}

/** `(product, widthIn) => PriceQuote` for a price book, or list prices when there is none. */
export function makePriceOf(book: PriceBookData | null): (p: Product, widthIn: number) => PriceQuote {
  if (!book) return (p, w) => ({ sell: priceFor(p, w), list: priceFor(p, w), noCost: true });
  return (p, w) => quoteFor(book, p, w);
}

/** Sell prices a client may see: `{ price, priceByWidth? }` at every width the product offers. */
export function sellPricesOf(book: PriceBookData, p: Product): { price: number; priceByWidth?: Record<string, number> } {
  const price = quoteFor(book, p, p.widthIn).sell;
  if (!p.widthOptions?.length) return { price };
  const priceByWidth: Record<string, number> = {};
  for (const w of p.widthOptions) priceByWidth[String(w)] = quoteFor(book, p, w).sell;
  return { price, priceByWidth };
}
