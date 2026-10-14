import type { DoorStyle, Finish } from '../types';
import type { PatternSpec } from '../lib/textures';

/**
 * Brand names throughout are invented placeholders, not real manufacturers.
 * Prices are illustrative estimates so the budget view has something to add up.
 */

/** The (fictional) maker of the kitchen-wide cabinet line, shown in Room & Finishes. */
export const CABINET_BRAND = 'Nordwell';

export const CABINET_FINISHES: Finish[] = [
  { id: 'white-oak', name: 'Rift White Oak', hex: '#c9a57a', material: 'wood' },
  { id: 'walnut', name: 'American Walnut', hex: '#6b4630', material: 'wood' },
  { id: 'warm-white', name: 'Warm Linen', hex: '#efe9dd', material: 'paint' },
  { id: 'greige', name: 'Stone Greige', hex: '#c8bfae', material: 'paint' },
  { id: 'sage', name: 'Sage Leaf', hex: '#9aa88c', material: 'paint' },
  { id: 'forest', name: 'Deep Forest', hex: '#3e5244', material: 'paint' },
  { id: 'navy', name: 'Harbor Navy', hex: '#2f3c52', material: 'paint' },
  { id: 'charcoal', name: 'Smoked Charcoal', hex: '#393835', material: 'paint' },
  { id: 'clay', name: 'Fired Clay', hex: '#b86a4b', material: 'paint' },
];

export const DOOR_STYLES: { id: DoorStyle; name: string; blurb: string }[] = [
  { id: 'shaker', name: 'Shaker', blurb: 'Recessed center panel, timeless' },
  { id: 'slab', name: 'Slab', blurb: 'Flat, handle-forward modern' },
  { id: 'fluted', name: 'Fluted', blurb: 'Vertical reeding, boutique feel' },
];

export interface HardwareOption {
  id: string;
  name: string;
  brand: string;
  hex: string;
  roughness: number;
  price: number;
}

export const HARDWARE: HardwareOption[] = [
  { id: 'brass', name: 'Brushed Brass', brand: 'Aldren & Co', hex: '#c6a15b', roughness: 0.35, price: 14 },
  { id: 'black', name: 'Matte Black', brand: 'Aldren & Co', hex: '#1d1d1d', roughness: 0.6, price: 11 },
  { id: 'nickel', name: 'Polished Nickel', brand: 'Aldren & Co', hex: '#d7d7d2', roughness: 0.18, price: 13 },
  { id: 'bronze', name: 'Oil-Rubbed Bronze', brand: 'Aldren & Co', hex: '#4a3527', roughness: 0.45, price: 12 },
];

export interface SurfaceOption {
  id: string;
  name: string;
  brand: string;
  pattern: PatternSpec;
  /** Representative color for flat fills and 3D tints. */
  hex: string;
  price: number;
  unit: 'sq ft' | 'gal';
  gloss: number;
}

export const COUNTERTOPS: SurfaceOption[] = [
  {
    id: 'calacatta',
    name: 'Calacatta Luxe Quartz',
    brand: 'Petrastone',
    hex: '#efebe4',
    pattern: { type: 'marble', base: '#f1ede6', vein: '#8b8174', intensity: 1 },
    price: 92,
    unit: 'sq ft',
    gloss: 0.8,
  },
  {
    id: 'carrara',
    name: 'Carrara Mist Quartz',
    brand: 'Petrastone',
    hex: '#e9e9e7',
    pattern: { type: 'marble', base: '#ecebea', vein: '#a9adb1', intensity: 0.6 },
    price: 74,
    unit: 'sq ft',
    gloss: 0.75,
  },
  {
    id: 'nero',
    name: 'Nero Marquina',
    brand: 'Petrastone',
    hex: '#232221',
    pattern: { type: 'marble', base: '#232221', vein: '#b9b2a8', intensity: 0.5 },
    price: 110,
    unit: 'sq ft',
    gloss: 0.85,
  },
  {
    id: 'soapstone',
    name: 'Honed Soapstone',
    brand: 'Quarry Row',
    hex: '#4a4d4c',
    pattern: { type: 'marble', base: '#4b4e4d', vein: '#8b918e', intensity: 0.45 },
    price: 88,
    unit: 'sq ft',
    gloss: 0.25,
  },
  {
    id: 'terrazzo',
    name: 'Venetian Terrazzo',
    brand: 'Quarry Row',
    hex: '#ece6dc',
    pattern: { type: 'terrazzo', base: '#ece6dc', chips: ['#c9643f', '#8a9a84', '#2f2d2b', '#d9b477', '#b9b2a7'] },
    price: 96,
    unit: 'sq ft',
    gloss: 0.5,
  },
  {
    id: 'concrete',
    name: 'Cast Concrete',
    brand: 'Formwork',
    hex: '#a8a39b',
    pattern: { type: 'concrete', base: '#a9a49c' },
    price: 70,
    unit: 'sq ft',
    gloss: 0.15,
  },
  {
    id: 'butcher',
    name: 'Maple Butcher Block',
    brand: 'Grainhouse',
    hex: '#d2a86e',
    pattern: { type: 'wood', base: '#d4aa70', grain: 'block' },
    price: 48,
    unit: 'sq ft',
    gloss: 0.3,
  },
];

export const BACKSPLASHES: SurfaceOption[] = [
  {
    id: 'subway-white',
    name: 'Gloss Subway 3×6',
    brand: 'Kiln & Glaze',
    hex: '#f3f1ec',
    pattern: { type: 'subway', base: '#f4f2ed', grout: '#d8d3ca' },
    price: 18,
    unit: 'sq ft',
    gloss: 0.8,
  },
  {
    id: 'zellige-sage',
    name: 'Zellige, Sage',
    brand: 'Kiln & Glaze',
    hex: '#a3b29a',
    pattern: { type: 'zellige', base: '#9fb096', grout: '#e5e1d6' },
    price: 42,
    unit: 'sq ft',
    gloss: 0.85,
  },
  {
    id: 'zellige-white',
    name: 'Zellige, Chalk',
    brand: 'Kiln & Glaze',
    hex: '#efeae0',
    pattern: { type: 'zellige', base: '#efe9dd', grout: '#dcd5c7' },
    price: 42,
    unit: 'sq ft',
    gloss: 0.85,
  },
  {
    id: 'stack-terracotta',
    name: 'Vertical Stack, Terracotta',
    brand: 'Kiln & Glaze',
    hex: '#c07353',
    pattern: { type: 'stack', base: '#c27454', grout: '#e8ddcf' },
    price: 28,
    unit: 'sq ft',
    gloss: 0.6,
  },
  {
    id: 'stack-ink',
    name: 'Vertical Stack, Ink',
    brand: 'Kiln & Glaze',
    hex: '#2e3440',
    pattern: { type: 'stack', base: '#2f3542', grout: '#595f69' },
    price: 28,
    unit: 'sq ft',
    gloss: 0.7,
  },
  {
    id: 'slab-match',
    name: 'Full Slab (matches counter)',
    brand: 'Petrastone',
    hex: '#efebe4',
    pattern: { type: 'solid', color: '#efebe4' },
    price: 85,
    unit: 'sq ft',
    gloss: 0.8,
  },
];

export const FLOORING: SurfaceOption[] = [
  {
    id: 'oak-natural',
    name: 'Wide Plank, Natural Oak',
    brand: 'Groundwork',
    hex: '#caa27a',
    pattern: { type: 'planks', base: '#c9a179', plankIn: 7 },
    price: 11,
    unit: 'sq ft',
    gloss: 0.3,
  },
  {
    id: 'oak-smoked',
    name: 'Wide Plank, Smoked Oak',
    brand: 'Groundwork',
    hex: '#7b5d45',
    pattern: { type: 'planks', base: '#7c5e46', plankIn: 7 },
    price: 12,
    unit: 'sq ft',
    gloss: 0.3,
  },
  {
    id: 'herringbone',
    name: 'Herringbone, Honey Oak',
    brand: 'Groundwork',
    hex: '#c39062',
    pattern: { type: 'herringbone', base: '#c28f61', plankIn: 3.5 },
    price: 16,
    unit: 'sq ft',
    gloss: 0.35,
  },
  {
    id: 'checker',
    name: 'Checkerboard Marble',
    brand: 'Quarry Row',
    hex: '#bdb6aa',
    pattern: { type: 'checker', a: '#eeeae3', b: '#3a3834', tileIn: 12 },
    price: 24,
    unit: 'sq ft',
    gloss: 0.6,
  },
  {
    id: 'terracotta',
    name: 'Terracotta Square',
    brand: 'Kiln & Glaze',
    hex: '#b8694a',
    pattern: { type: 'tile', base: '#b9694a', grout: '#d9cbb8', tileIn: 8, vary: 0.12 },
    price: 14,
    unit: 'sq ft',
    gloss: 0.25,
  },
  {
    id: 'porcelain',
    name: 'Large Format, Limestone',
    brand: 'Kiln & Glaze',
    hex: '#d8d1c4',
    pattern: { type: 'tile', base: '#d8d1c4', grout: '#bfb7a8', tileIn: 24, vary: 0.04 },
    price: 13,
    unit: 'sq ft',
    gloss: 0.4,
  },
  {
    id: 'concrete-floor',
    name: 'Polished Concrete',
    brand: 'Formwork',
    hex: '#9d9993',
    pattern: { type: 'concrete', base: '#9f9b94' },
    price: 9,
    unit: 'sq ft',
    gloss: 0.55,
  },
];

export const PAINTS: SurfaceOption[] = [
  { id: 'chalk', name: 'Chalk White', brand: 'Loam & Co', hex: '#f1ece3', pattern: { type: 'plaster', color: '#f1ece3' }, price: 68, unit: 'gal', gloss: 0.1 },
  { id: 'bone', name: 'Bone Greige', brand: 'Loam & Co', hex: '#ddd4c4', pattern: { type: 'plaster', color: '#ddd4c4' }, price: 68, unit: 'gal', gloss: 0.1 },
  { id: 'butter', name: 'Soft Butter', brand: 'Loam & Co', hex: '#eee0b8', pattern: { type: 'plaster', color: '#eee0b8' }, price: 68, unit: 'gal', gloss: 0.1 },
  { id: 'sage-wall', name: 'Garden Sage', brand: 'Loam & Co', hex: '#b9c2ad', pattern: { type: 'plaster', color: '#b9c2ad' }, price: 68, unit: 'gal', gloss: 0.1 },
  { id: 'blush', name: 'Plaster Blush', brand: 'Loam & Co', hex: '#e6cdbf', pattern: { type: 'plaster', color: '#e6cdbf' }, price: 68, unit: 'gal', gloss: 0.1 },
  { id: 'fog', name: 'Harbor Fog', brand: 'Loam & Co', hex: '#c3cacd', pattern: { type: 'plaster', color: '#c3cacd' }, price: 68, unit: 'gal', gloss: 0.1 },
  { id: 'olive', name: 'Olive Grove', brand: 'Loam & Co', hex: '#7d7c5a', pattern: { type: 'plaster', color: '#7d7c5a' }, price: 68, unit: 'gal', gloss: 0.1 },
  { id: 'ink', name: 'Night Ink', brand: 'Loam & Co', hex: '#353a43', pattern: { type: 'plaster', color: '#353a43' }, price: 68, unit: 'gal', gloss: 0.1 },
];

export function byId<T extends { id: string }>(list: T[], id: string): T {
  return list.find((o) => o.id === id) ?? list[0];
}

/** A slab backsplash reuses the countertop's stone so the two read as one piece. */
export function resolveBacksplash(backsplashId: string, countertopId: string): SurfaceOption {
  const bs = byId(BACKSPLASHES, backsplashId);
  if (bs.id !== 'slab-match') return bs;
  const ct = byId(COUNTERTOPS, countertopId);
  return { ...bs, hex: ct.hex, pattern: ct.pattern, gloss: ct.gloss };
}
