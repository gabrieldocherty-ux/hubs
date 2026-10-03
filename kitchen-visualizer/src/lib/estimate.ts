import type { DesignDoc, Product } from '../types';
import { hasCountertop, priceFor, productCode } from '../data/catalog';
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
  | 'Hardware';

export interface EstimateLine {
  key: string;
  group: EstimateGroup;
  label: string;
  sub: string;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
}

export interface Estimate {
  lines: EstimateLine[];
  groups: { name: EstimateGroup; total: number }[];
  total: number;
}

const GROUP_BY_CATEGORY: Record<Product['category'], EstimateGroup> = {
  cabinets: 'Cabinetry',
  appliances: 'Appliances',
  sinks: 'Sinks & faucets',
  lighting: 'Lighting',
  seating: 'Furniture & decor',
  decor: 'Furniture & decor',
  openings: 'Doors & windows',
};

export function pullCount(p: Product, w: number): number {
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

export function buildEstimate(doc: DesignDoc): Estimate {
  const all = resolveAll(doc.items);
  const map = new Map<string, EstimateLine>();
  let pulls = 0;

  for (const r of all) {
    const finish = resolveFinish(r.item, r.product, doc.surfaces);
    const code = productCode(r.product, r.w);
    const key = `${r.product.id}|${r.w}|${finish.id}`;
    const unitPrice = priceFor(r.product, r.w);
    const line = map.get(key);
    if (line) {
      line.qty += 1;
      line.total += unitPrice;
    } else {
      map.set(key, {
        key,
        group: GROUP_BY_CATEGORY[r.product.category],
        label: `${r.product.brand} ${r.product.name}`,
        sub: `${code} · ${finish.name}`,
        qty: 1,
        unit: 'ea',
        unitPrice,
        total: unitPrice,
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

  const order: EstimateGroup[] = ['Cabinetry', 'Appliances', 'Sinks & faucets', 'Surfaces', 'Hardware', 'Lighting', 'Doors & windows', 'Furniture & decor'];
  lines.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.total - a.total);
  const groups = order
    .map((name) => ({ name, total: lines.filter((l) => l.group === name).reduce((s, l) => s + l.total, 0) }))
    .filter((g) => g.total > 0);
  return { lines, groups, total: groups.reduce((s, g) => s + g.total, 0) };
}
