import type { DesignDoc, Product } from '../types';
import type { PriceQuote } from '../types/platform';
import { hasCountertop, isBuiltin, priceFor, productCode } from '../data/catalog';
import { BACKSPLASHES, COUNTERTOPS, FLOORING, HARDWARE, PAINTS, byId, resolveBacksplash } from '../data/finishes';
import { backsplashSegments, resolveAll } from './geometry';
import { resolveFinish } from './finish';

export type EstimateGroup =
  | 'Cabinetry'
  | 'Appliances'
  | 'Sinks & faucets'
  | 'Lighting'
  | 'Furniture & decor'
  | 'Doors & windows'
  | 'Surfaces'
  | 'Hardware'
  | 'Other'
  | 'Services';

export interface EstimateLine {
  key: string;
  group: EstimateGroup;
  label: string;
  sub: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
  /** The product's SKU at this width (product lines only). */
  sku?: string;
  /** The brand's buy link, when it has one (product lines only). */
  buyUrl?: string;
  productId?: string;
  /** A contractor's cost per unit, when they entered one. Only ever shown in Contractor view. */
  unitCost?: number;
  /** The markup that produced `unitPrice` from `unitCost`, in percent. */
  markupPct?: number;
  /** An extra line (installation, delivery…) rather than a product or surface. */
  extraId?: string;
}

export interface Estimate {
  lines: EstimateLine[];
  groups: { name: EstimateGroup; total: number }[];
  total: number;
  /** True when a built-in demo product is in the kitchen, so the "placeholder prices" note applies. */
  hasBuiltin: boolean;
  /** Sum of the known costs (null when no line has one). */
  costTotal: number | null;
  /** The sell total of the lines that have a cost, so margin = costedTotal - costTotal. */
  costedTotal: number;
  /** Lines priced at list because no cost was entered. */
  uncosted: number;
}

export interface EstimateOptions {
  /**
   * A contractor's prices (`usePriceBook().priceOf`): the sell price, and their cost when known.
   * Without it every product is at its list price.
   */
  priceOf?: (product: Product, widthIn: number) => PriceQuote;
}

const GROUP_BY_CATEGORY: Partial<Record<string, EstimateGroup>> = {
  cabinets: 'Cabinetry',
  appliances: 'Appliances',
  sinks: 'Sinks & faucets',
  lighting: 'Lighting',
  seating: 'Furniture & decor',
  decor: 'Furniture & decor',
  openings: 'Doors & windows',
};

export function pullCount(p: Product, w: number): number {
  if (p.source === 'missing') return 0;
  switch (p.kind) {
    case 'base':
      if (p.variant === 'drawers') return 3;
      if (p.variant === 'trash') return 1;
      return w > 21 ? 4 : 2;
    case 'corner':
      return 2;
    case 'wall':
      return w > 21 ? 2 : 1;
    case 'tall':
      return w > 21 ? 4 : 2;
    case 'island':
      return Math.max(2, Math.round(w / 18) * 2);
    case 'sink':
      return w > 21 ? 2 : 1;
    default:
      return 0;
  }
}

export function buildEstimate(doc: DesignDoc, opts: EstimateOptions = {}): Estimate {
  const all = resolveAll(doc.items);
  const map = new Map<string, EstimateLine>();
  let pulls = 0;
  let hasBuiltin = false;

  for (const r of all) {
    if (isBuiltin(r.product.id)) hasBuiltin = true;
    const finish = resolveFinish(r.item, r.product, doc.surfaces);
    const code = productCode(r.product, r.w);
    const key = `${r.product.id}|${r.w}|${finish.id}`;
    const missing = r.product.source === 'missing';
    const quote = opts.priceOf && !missing ? opts.priceOf(r.product, r.w) : null;
    const unitPrice = quote ? quote.sell : priceFor(r.product, r.w);
    const line = map.get(key);
    if (line) {
      line.qty += 1;
      line.total += unitPrice;
    } else {
      map.set(key, {
        key,
        // A category this build doesn't know still counts: it lands in "Other", never out of the total.
        group: GROUP_BY_CATEGORY[r.product.category] ?? 'Other',
        label: missing ? r.product.name : `${r.product.brand} ${r.product.name}`,
        sub: missing ? 'Price unavailable until the product is listed again' : `${code} · ${finish.name}`,
        qty: 1,
        unit: 'ea',
        unitPrice,
        total: unitPrice,
        productId: r.product.id,
        ...(missing ? {} : { sku: code }),
        ...(r.product.buyUrl ? { buyUrl: r.product.buyUrl } : {}),
        ...(quote && typeof quote.cost === 'number' ? { unitCost: quote.cost, markupPct: quote.markupPct } : {}),
      });
    }
    pulls += pullCount(r.product, r.w);
  }

  const lines = [...map.values()];
  const { room, surfaces } = doc;

  const counterIn2 = all
    .filter((r) => hasCountertop(r.product))
    .reduce((s, r) => s + r.w * (r.product.kind === 'island' ? r.d : r.d + 1.5), 0);
  if (counterIn2 > 0) {
    const ct = byId(COUNTERTOPS, surfaces.countertopId);
    const sq = Math.ceil(counterIn2 / 144);
    lines.push({ key: 'counter', group: 'Surfaces', label: `${ct.brand} ${ct.name}`, sub: 'Countertop, fabricated + installed', qty: sq, unit: 'sq ft', unitPrice: ct.price, total: sq * ct.price });
  }

  const splashIn2 = backsplashSegments(all, room).reduce((s, seg) => s + (seg.end - seg.start) * (seg.top - seg.bottom), 0);
  if (splashIn2 > 0) {
    const bs = resolveBacksplash(surfaces.backsplashId, surfaces.countertopId);
    const src = byId(BACKSPLASHES, surfaces.backsplashId);
    const sq = Math.ceil((splashIn2 / 144) * 1.1);
    lines.push({ key: 'splash', group: 'Surfaces', label: `${src.brand} ${src.name}`, sub: `Backsplash${bs.id === 'slab-match' ? ', book-matched slab' : ', incl. 10% overage'}`, qty: sq, unit: 'sq ft', unitPrice: src.price, total: sq * src.price });
  }

  const floor = byId(FLOORING, surfaces.flooringId);
  const floorSq = Math.ceil(((room.widthIn * room.lengthIn) / 144) * 1.1);
  lines.push({ key: 'floor', group: 'Surfaces', label: `${floor.brand} ${floor.name}`, sub: 'Flooring, incl. 10% overage', qty: floorSq, unit: 'sq ft', unitPrice: floor.price, total: floorSq * floor.price });

  const paint = byId(PAINTS, surfaces.paintId);
  const openingsIn2 = all
    .filter((r) => r.product.kind === 'window' || r.product.kind === 'door')
    .reduce((s, r) => s + r.w * r.product.heightIn, 0);
  const wallSq = (2 * (room.widthIn + room.lengthIn) * room.ceilingIn - openingsIn2) / 144;
  const gallons = Math.max(1, Math.ceil((wallSq * 2) / 350));
  lines.push({ key: 'paint', group: 'Surfaces', label: `${paint.brand} ${paint.name}`, sub: 'Wall paint, two coats', qty: gallons, unit: 'gal', unitPrice: paint.price, total: gallons * paint.price });

  if (pulls > 0) {
    const hw = byId(HARDWARE, surfaces.hardwareId);
    lines.push({ key: 'hardware', group: 'Hardware', label: `${hw.brand} ${hw.name} pulls`, sub: 'Cabinet pulls and knobs', qty: pulls, unit: 'ea', unitPrice: hw.price, total: pulls * hw.price });
  }

  // Labour and services the contractor added, in the order they were entered.
  for (const x of doc.extras ?? []) {
    if (!x || typeof x.amount !== 'number' || !Number.isFinite(x.amount)) continue;
    lines.push({
      key: `extra|${x.id}`,
      group: 'Services',
      label: x.label,
      sub: 'Labour & services',
      qty: 1,
      unit: 'job',
      unitPrice: x.amount,
      total: x.amount,
      extraId: x.id,
      ...(typeof x.cost === 'number' && Number.isFinite(x.cost) ? { unitCost: x.cost } : {}),
    });
  }

  const order: EstimateGroup[] = ['Cabinetry', 'Appliances', 'Sinks & faucets', 'Surfaces', 'Hardware', 'Lighting', 'Doors & windows', 'Furniture & decor', 'Other', 'Services'];
  // Stable within a group: extras keep their entered order, everything else is by total.
  lines.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || (a.extraId || b.extraId ? 0 : b.total - a.total));
  const groups = order
    .map((name) => ({ name, total: lines.filter((l) => l.group === name).reduce((s, l) => s + l.total, 0) }))
    .filter((g) => g.total > 0);
  const costed = lines.filter((l) => typeof l.unitCost === 'number');
  const costTotal = costed.length ? costed.reduce((s, l) => s + (l.unitCost as number) * l.qty, 0) : null;
  // The total is every line, so nothing can fall out of it even if a group were somehow unlisted.
  return {
    lines,
    groups,
    total: lines.reduce((s, l) => s + l.total, 0),
    hasBuiltin,
    costTotal,
    costedTotal: costed.reduce((s, l) => s + l.total, 0),
    uncosted: lines.length - costed.length,
  };
}
