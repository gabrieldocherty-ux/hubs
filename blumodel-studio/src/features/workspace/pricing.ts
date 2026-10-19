import type { PriceRow } from './api';

/**
 * A showroom's prices: what visitors see is the product's own `price` (and `priceByWidth`), in
 * dollars. The team may work it out from what they pay (private, cents) and a markup; the product's
 * own markup wins over the showroom's default.
 */

/** The markup a product sells at: its own, else the showroom's default. */
export const markupFor = (row: PriceRow | undefined | null, defaultMarkupPct: number): number => (row?.markupPct ?? null) ?? defaultMarkupPct;

/** Cost (cents) plus markup (%) as a selling price in dollars, to the cent. */
export function sellFrom(costCents: number, markupPct: number): number {
  return Math.round(costCents * (1 + markupPct / 100)) / 100;
}

export interface WorkedPrices {
  /** The price at the product's placed width (or its only price). */
  price: number;
  /** Per width, when the product has several and costs per width were given. */
  priceByWidth: Record<string, number> | null;
}

/**
 * The prices visitors will see, worked out from `row`: per width when costs per width were given
 * (a width without one falls back to the single cost), else one price. Null without any cost.
 */
export function workedPrices(row: PriceRow, defaultMarkupPct: number, widths: number[], placedWidth: number): WorkedPrices | null {
  const m = markupFor(row, defaultMarkupPct);
  const byWidth: Record<string, number> = {};
  if (widths.length > 1) {
    for (const w of widths) {
      const c = row.costByWidth?.[String(w)] ?? row.costCents;
      if (typeof c === 'number') byWidth[String(w)] = sellFrom(c, m);
    }
  }
  const anyWidth = Object.keys(byWidth).length > 0;
  const placed = byWidth[String(placedWidth)] ?? (typeof row.costCents === 'number' ? sellFrom(row.costCents, m) : anyWidth ? Object.values(byWidth)[0] : null);
  if (placed === null || placed === undefined) return null;
  return { price: placed, priceByWidth: anyWidth ? byWidth : null };
}

/** "$1,250.50" / "1250.5" -> 1250.5; '' -> null; NaN for anything that isn't an amount. */
export function parseDollars(v: string): number | null {
  const s = v.trim().replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;
}

export const toCents = (dollars: number) => Math.round(dollars * 100);
