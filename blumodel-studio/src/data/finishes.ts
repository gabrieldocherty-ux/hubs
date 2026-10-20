import type { DoorStyle, Finish } from '../types';
import type { PatternSpec } from '../lib/textures';
import { BASICS_BRAND } from './builtins';

/**
 * Brand names throughout are invented placeholders, not real manufacturers.
 * Prices are illustrative estimates so the budget view has something to add up.
 */

/** The kitchen-wide cabinet line, shown in Room & Finishes: BluModel Basics, like the built-in cabinets. */
export const CABINET_BRAND = BASICS_BRAND;

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
  /** The picker's filter chip (flooring: Hardwood, Vinyl & laminate, Tile, Stone, Concrete). */
  group?: string;
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

/** The order the flooring picker's type chips appear in. */
export const SURFACE_GROUP_ORDER = ['Hardwood', 'Vinyl & laminate', 'Tile', 'Stone', 'Concrete'];

export const FLOORING: SurfaceOption[] = [
  {
    id: 'oak-natural',
    group: 'Hardwood',
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
    group: 'Hardwood',
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
    group: 'Hardwood',
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
    group: 'Stone',
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
    group: 'Tile',
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
    group: 'Tile',
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
    group: 'Concrete',
    name: 'Polished Concrete',
    brand: 'Formwork',
    hex: '#9d9993',
    pattern: { type: 'concrete', base: '#9f9b94' },
    price: 9,
    unit: 'sq ft',
    gloss: 0.55,
  },
  // ── hardwood ──
  { id: 'oak-white', group: 'Hardwood', name: 'Wide Plank, White Oak Matte', brand: 'Groundwork', hex: '#d9c3a3', pattern: { type: 'planks', base: '#d8c2a2', plankIn: 8 }, price: 13, unit: 'sq ft', gloss: 0.2 },
  { id: 'oak-bleached', group: 'Hardwood', name: 'Wide Plank, Bleached Oak', brand: 'Groundwork', hex: '#e2d6c3', pattern: { type: 'planks', base: '#e1d5c2', plankIn: 9 }, price: 14, unit: 'sq ft', gloss: 0.2 },
  { id: 'walnut-plank', group: 'Hardwood', name: 'Plank, American Walnut', brand: 'Groundwork', hex: '#5e4232', pattern: { type: 'planks', base: '#5f4333', plankIn: 6 }, price: 15, unit: 'sq ft', gloss: 0.35 },
  { id: 'maple-strip', group: 'Hardwood', name: 'Strip, Hard Maple', brand: 'Groundwork', hex: '#e0c49b', pattern: { type: 'planks', base: '#dfc39a', plankIn: 3.25 }, price: 9, unit: 'sq ft', gloss: 0.45 },
  { id: 'hickory', group: 'Hardwood', name: 'Wide Plank, Rustic Hickory', brand: 'Groundwork', hex: '#a7764f', pattern: { type: 'planks', base: '#a8774f', plankIn: 7 }, price: 11, unit: 'sq ft', gloss: 0.3 },
  { id: 'chevron-oak', group: 'Hardwood', name: 'Chevron, Natural Oak', brand: 'Groundwork', hex: '#c8a37c', pattern: { type: 'chevron', base: '#c7a27b', plankIn: 4 }, price: 18, unit: 'sq ft', gloss: 0.3 },
  { id: 'chevron-smoked', group: 'Hardwood', name: 'Chevron, Smoked Oak', brand: 'Groundwork', hex: '#6f5442', pattern: { type: 'chevron', base: '#705543', plankIn: 4 }, price: 19, unit: 'sq ft', gloss: 0.3 },
  { id: 'herringbone-white', group: 'Hardwood', name: 'Herringbone, White Oak', brand: 'Groundwork', hex: '#d4bc9a', pattern: { type: 'herringbone', base: '#d3bb99', plankIn: 3.5 }, price: 17, unit: 'sq ft', gloss: 0.3 },
  // ── vinyl & laminate ──
  { id: 'lvp-greige', group: 'Vinyl & laminate', name: 'Luxury Vinyl Plank, Greige Oak', brand: 'Everlay', hex: '#b5a796', pattern: { type: 'planks', base: '#b4a695', plankIn: 7 }, price: 5, unit: 'sq ft', gloss: 0.25 },
  { id: 'lvp-grey', group: 'Vinyl & laminate', name: 'Luxury Vinyl Plank, Driftwood Grey', brand: 'Everlay', hex: '#a19d97', pattern: { type: 'planks', base: '#a09c96', plankIn: 7 }, price: 5, unit: 'sq ft', gloss: 0.25 },
  { id: 'lvp-honey', group: 'Vinyl & laminate', name: 'Luxury Vinyl Plank, Honey Oak', brand: 'Everlay', hex: '#bf9466', pattern: { type: 'planks', base: '#be9365', plankIn: 7 }, price: 5, unit: 'sq ft', gloss: 0.25 },
  { id: 'laminate-espresso', group: 'Vinyl & laminate', name: 'Laminate, Espresso Oak', brand: 'Everlay', hex: '#4e3b30', pattern: { type: 'planks', base: '#4f3c31', plankIn: 7.5 }, price: 4, unit: 'sq ft', gloss: 0.35 },
  { id: 'lvt-slate', group: 'Vinyl & laminate', name: 'Luxury Vinyl Tile, Slate', brand: 'Everlay', hex: '#5c5f62', pattern: { type: 'brick', base: '#5d6063', grout: '#4a4c4e', tileW: 24, tileH: 12, offset: 0.5, vary: 0.12 }, price: 6, unit: 'sq ft', gloss: 0.2 },
  // ── tile ──
  { id: 'porcelain-12x24', group: 'Tile', name: '12x24 Porcelain, Warm Grey', brand: 'Kiln & Glaze', hex: '#b6b0a6', pattern: { type: 'brick', base: '#b7b1a7', grout: '#a29b90', tileW: 24, tileH: 12, offset: 0.33, vary: 0.04 }, price: 8, unit: 'sq ft', gloss: 0.3 },
  { id: 'porcelain-white-24', group: 'Tile', name: '24x48 Porcelain, Statuario Look', brand: 'Kiln & Glaze', hex: '#ebe8e3', pattern: { type: 'brick', base: '#ece9e4', grout: '#d6d2cb', tileW: 48, tileH: 24, offset: 0.5, vary: 0.03, gloss: 0.5 }, price: 12, unit: 'sq ft', gloss: 0.55 },
  { id: 'wood-look-tile', group: 'Tile', name: '8x48 Wood-Look Porcelain, Oak', brand: 'Kiln & Glaze', hex: '#b48d68', pattern: { type: 'brick', base: '#b58e69', grout: '#8e7258', tileW: 48, tileH: 8, offset: 0.33, vary: 0.12, wood: true }, price: 7, unit: 'sq ft', gloss: 0.25 },
  { id: 'hex-white', group: 'Tile', name: 'Hexagon 8in, Matte White', brand: 'Kiln & Glaze', hex: '#e8e4dc', pattern: { type: 'hex', base: '#e9e5dd', grout: '#c9c3b8', tileIn: 8, vary: 0.04 }, price: 11, unit: 'sq ft', gloss: 0.2 },
  { id: 'hex-encaustic', group: 'Tile', name: 'Hexagon 8in, Cement Blue Mix', brand: 'Kiln & Glaze', hex: '#8fa2ad', pattern: { type: 'hex', base: '#d9d4c8', grout: '#bdb6a8', tileIn: 8, vary: 0.05, accent: '#5f7d8c' }, price: 15, unit: 'sq ft', gloss: 0.2 },
  { id: 'hex-mosaic', group: 'Tile', name: 'Hexagon 2in Mosaic, Carrara', brand: 'Kiln & Glaze', hex: '#e3e1dc', pattern: { type: 'hex', base: '#e4e2dd', grout: '#c7c4bd', tileIn: 2, vary: 0.06, accent: '#b9bcbf' }, price: 16, unit: 'sq ft', gloss: 0.35 },
  { id: 'penny-white', group: 'Tile', name: 'Penny Round, Gloss White', brand: 'Kiln & Glaze', hex: '#ecebe7', pattern: { type: 'penny', base: '#efeeea', grout: '#b3afa7', vary: 0.03 }, price: 14, unit: 'sq ft', gloss: 0.6 },
  { id: 'penny-black', group: 'Tile', name: 'Penny Round, Matte Black', brand: 'Kiln & Glaze', hex: '#2f2f30', pattern: { type: 'penny', base: '#303031', grout: '#8b8781', vary: 0.05 }, price: 14, unit: 'sq ft', gloss: 0.3 },
  { id: 'quarry-red', group: 'Tile', name: '6x6 Quarry Tile, Red', brand: 'Kiln & Glaze', hex: '#9b4b37', pattern: { type: 'tile', base: '#9c4c38', grout: '#8a7d6c', tileIn: 6, vary: 0.1 }, price: 6, unit: 'sq ft', gloss: 0.2 },
  // ── stone ──
  { id: 'travertine', group: 'Stone', name: 'Travertine, Versailles Ivory', brand: 'Quarry Row', hex: '#d7c4a5', pattern: { type: 'brick', base: '#d8c5a6', grout: '#c5b293', tileW: 16, tileH: 16, offset: 0.5, vary: 0.08 }, price: 15, unit: 'sq ft', gloss: 0.2 },
  { id: 'slate-natural', group: 'Stone', name: 'Natural Slate, Charcoal', brand: 'Quarry Row', hex: '#4c4f52', pattern: { type: 'tile', base: '#4d5053', grout: '#3b3c3d', tileIn: 16, vary: 0.16 }, price: 12, unit: 'sq ft', gloss: 0.15 },
  { id: 'marble-floor', group: 'Stone', name: 'Carrara Marble, Honed 18in', brand: 'Quarry Row', hex: '#e3e2de', pattern: { type: 'marble', base: '#e6e5e1', vein: '#8b8e93', intensity: 0.7 }, price: 22, unit: 'sq ft', gloss: 0.45 },
  { id: 'terrazzo-floor', group: 'Stone', name: 'Terrazzo, Warm Chip', brand: 'Quarry Row', hex: '#ddd4c6', pattern: { type: 'terrazzo', base: '#e0d8ca', chips: ['#b7a48d', '#8d8378', '#c98f6c', '#f4efe6', '#6d6862'] }, price: 26, unit: 'sq ft', gloss: 0.45 },
  // ── concrete ──
  { id: 'concrete-light', group: 'Concrete', name: 'Polished Concrete, Pale', brand: 'Formwork', hex: '#c4c0b9', pattern: { type: 'concrete', base: '#c5c1ba' }, price: 9, unit: 'sq ft', gloss: 0.55 },
  { id: 'concrete-dark', group: 'Concrete', name: 'Ground Concrete, Graphite', brand: 'Formwork', hex: '#5f5d5a', pattern: { type: 'concrete', base: '#605e5b' }, price: 10, unit: 'sq ft', gloss: 0.5 },
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
