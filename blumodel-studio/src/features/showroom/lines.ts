import type { BrandCategory, BrandPrefs, Product } from '../../types';
import { BRAND_CATEGORIES, brandKey, cleanBrandPrefs, isBrandCategory, prefName } from '../../lib/generate/brands';

/**
 * A showroom's product lines (docs/SHOWROOM_PIVOT.md §5): the company's own products grouped by
 * their `line`, which is what its visitors choose between in the new-kitchen wizard and what the
 * landing page features. Pure, so it is tested without a page.
 */

export interface ShowroomLine {
  name: string;
  key: string;
  /** The wizard categories it has products in, most products first. */
  categories: BrandCategory[];
  products: Product[];
}

/** The company's own products in the catalog: live ones, not other kitchens' snapshots or placeholders. */
export const isOwnProduct = (p: Product) => p.source === 'tenant';

/** The product's line; a line-less product goes under the company's name, as the wizard matches it (prefName). */
const lineOf = (p: Product): string => prefName(p).replace(/\s+/g, ' ').trim() || p.brand;

/** Every line of the company's products, the one with most products first (then A to Z). */
export function showroomLines(products: Product[]): ShowroomLine[] {
  const by = new Map<string, ShowroomLine>();
  for (const p of products) {
    if (!isOwnProduct(p)) continue;
    const name = lineOf(p);
    const key = brandKey(name);
    const line = by.get(key) ?? { name, key, categories: [], products: [] };
    line.products.push(p);
    by.set(key, line);
  }
  for (const l of by.values()) {
    const n = new Map<BrandCategory, number>();
    for (const p of l.products) if (isBrandCategory(p.category)) n.set(p.category, (n.get(p.category) ?? 0) + 1);
    l.categories = [...n].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }
  return [...by.values()].sort((a, b) => b.products.length - a.products.length || a.name.localeCompare(b.name));
}

/** The lines to feature: the company's chosen ones that exist, in its order; else its biggest few. */
export function featuredLines(lines: ShowroomLine[], featured: string[], max = 6): ShowroomLine[] {
  const by = new Map(lines.map((l) => [l.key, l]));
  const picked = featured.map((f) => by.get(brandKey(f))).filter((l): l is ShowroomLine => !!l);
  return (picked.length ? picked : lines).slice(0, max);
}

/** The lines selling in one wizard category. */
export function linesIn(lines: ShowroomLine[], category: BrandCategory): ShowroomLine[] {
  return lines.filter((l) => l.categories.includes(category));
}

/**
 * The brand preferences a showroom kitchen is built with: the lines the visitor chose in each
 * category, and in a category where they chose none, every line the company sells there (biggest
 * first). So a new kitchen is always made of the company's products wherever one fits, and the
 * visitor's choice only narrows it.
 */
export function showroomPrefs(chosen: BrandPrefs | undefined, lines: ShowroomLine[]): BrandPrefs | undefined {
  const out: BrandPrefs = {};
  for (const c of BRAND_CATEGORIES) {
    const picked = chosen?.[c.id] ?? [];
    const names = picked.length ? picked : linesIn(lines, c.id).map((l) => l.name);
    if (names.length) out[c.id] = names;
  }
  return cleanBrandPrefs(out);
}

/** A line name as asked for in a link (`#/new?line=`), when the company has it. */
export function lineFromQuery(lines: ShowroomLine[], raw: string | null): ShowroomLine | null {
  if (!raw) return null;
  const key = brandKey(raw);
  return lines.find((l) => l.key === key) ?? null;
}
