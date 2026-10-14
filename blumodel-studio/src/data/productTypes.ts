import type { CategoryId, Kind } from '../types';
import kinds from './kinds.json';

/**
 * The curated product types a brand (or a custom-model order) picks from. Each maps onto an
 * existing `kind` (+ optional `variant`) so snapping, checks, the plan symbol, elevations and the
 * estimate all work unchanged; a GLB only replaces the 3D mesh. Kinds stay a closed list
 * (PRODUCT_SPEC §5.3, decision 14). Defaults are typical sizes in inches, prefilled in the editor.
 */
export interface ProductType {
  id: string;
  label: string;
  kind: Kind;
  category: CategoryId;
  variant?: string;
  defaults: { widthIn: number; depthIn: number; heightIn: number; elevationIn: number };
}

const KIND_CATEGORY = kinds.kindCategory as Record<Kind, CategoryId>;

type Row = [id: string, label: string, kind: Kind, variant: string | undefined, w: number, d: number, h: number, elev: number];

const ROWS: Row[] = [
  // Cabinets
  ['base-cabinet', 'Base cabinet', 'base', 'door-drawer', 24, 24, 36, 0],
  ['drawer-base', 'Drawer base', 'base', 'drawers', 30, 24, 36, 0],
  ['trash-pullout', 'Trash pull-out', 'base', 'trash', 18, 24, 36, 0],
  ['corner-cabinet', 'Corner cabinet', 'corner', undefined, 36, 36, 36, 0],
  ['wall-cabinet', 'Wall cabinet', 'wall', 'door', 30, 12, 30, 54],
  ['wall-cabinet-glass', 'Wall cabinet – glass front', 'wall', 'glass', 30, 12, 30, 54],
  ['bridge-cabinet', 'Over-fridge cabinet', 'wall', 'bridge', 36, 24, 15, 72],
  ['pantry', 'Pantry / tall cabinet', 'tall', 'pantry', 24, 24, 84, 0],
  ['island', 'Kitchen island', 'island', undefined, 84, 42, 36, 0],
  ['shelf', 'Open shelf', 'shelf', undefined, 36, 10, 2, 62],
  // Appliances
  ['range-gas', 'Range – gas, 4 burner', 'range', 'gas-4', 30, 28, 36, 0],
  ['range-gas-6', 'Range – gas or dual-fuel, 6 burner', 'range', 'gas-6', 36, 28, 36, 0],
  ['range-griddle', 'Range – with griddle', 'range', 'griddle', 48, 28, 36, 0],
  ['range-induction', 'Range – induction', 'range', 'induction', 30, 28, 36, 0],
  ['hood-chimney', 'Hood – chimney', 'hood', 'chimney', 30, 20, 18, 66],
  ['hood-canopy', 'Hood – canopy / plaster', 'hood', 'plaster', 36, 22, 24, 64],
  ['fridge-french', 'Refrigerator – French door', 'fridge', 'french', 36, 30, 70, 0],
  ['fridge-column', 'Refrigerator – column', 'fridge', 'column', 30, 24, 84, 0],
  ['fridge-retro', 'Refrigerator – retro', 'fridge', 'retro', 24, 28, 60, 0],
  ['wall-oven', 'Wall oven tower', 'oven-tower', undefined, 30, 24, 84, 0],
  ['dishwasher', 'Dishwasher', 'dishwasher', undefined, 24, 24, 36, 0],
  ['microwave', 'Microwave – over the range', 'microwave', undefined, 30, 16, 17, 66],
  ['wine-column', 'Wine column', 'wine', 'wine', 24, 24, 36, 0],
  ['beverage-center', 'Beverage center', 'wine', 'beverage', 15, 24, 36, 0],
  // Sinks
  ['sink-undermount', 'Sink – undermount', 'sink', 'undermount', 33, 24, 36, 0],
  ['sink-farmhouse', 'Sink – farmhouse apron', 'sink', 'farmhouse', 36, 24, 36, 0],
  ['sink-double', 'Sink – double bowl', 'sink', 'double', 36, 24, 36, 0],
  ['sink-prep', 'Sink – prep', 'sink', 'prep', 18, 24, 36, 0],
  // Lighting
  ['pendant-dome', 'Pendant – dome', 'pendant', 'dome', 14, 14, 10, 68],
  ['pendant-globe', 'Pendant – globe', 'pendant', 'globe', 12, 12, 12, 66],
  ['pendant-cone', 'Pendant – cone', 'pendant', 'cone', 10, 10, 13, 66],
  ['pendant-woven', 'Pendant – woven shade', 'pendant', 'woven', 20, 20, 14, 64],
  ['pendant-linear', 'Linear chandelier', 'pendant', 'linear', 48, 6, 5, 70],
  // Seating & tables
  ['stool-counter', 'Counter stool – backless', 'stool', 'counter', 17, 17, 26, 0],
  ['stool-backed', 'Counter stool – with back', 'stool', 'backed', 19, 20, 38, 0],
  ['table-round', 'Dining table – round', 'table', 'round', 48, 48, 30, 0],
  ['table-rect', 'Dining table – rectangular', 'table', 'rect', 72, 36, 30, 0],
  ['chair', 'Dining chair', 'chair', undefined, 18, 20, 32, 0],
  // Doors & windows
  ['window-casement', 'Window – casement', 'window', 'casement', 36, 6, 42, 42],
  ['window-picture', 'Window – picture', 'window', 'picture', 60, 6, 48, 38],
  ['door-single', 'Door – single', 'door', 'single', 32, 6, 80, 0],
  ['door-double', 'Door – French pair', 'door', 'double', 60, 6, 80, 0],
  ['door-opening', 'Cased opening', 'door', 'opening', 48, 6, 84, 0],
  // Decor
  ['rug-runner', 'Rug – runner', 'rug', 'runner', 30, 96, 0.5, 0],
  ['rug-area', 'Rug – area', 'rug', 'area', 96, 60, 0.5, 0],
  ['plant-tree', 'Plant – potted tree', 'plant', 'olive', 22, 22, 62, 0],
  ['plant-floor', 'Plant – floor plant', 'plant', 'fig', 20, 20, 54, 0],
];

export const PRODUCT_TYPES: ProductType[] = ROWS.map(([id, label, kind, variant, widthIn, depthIn, heightIn, elevationIn]) => ({
  id,
  label,
  kind,
  category: KIND_CATEGORY[kind],
  ...(variant ? { variant } : {}),
  defaults: { widthIn, depthIn, heightIn, elevationIn },
}));

const BY_ID = new Map(PRODUCT_TYPES.map((t) => [t.id, t]));

export function productType(id: string): ProductType | undefined {
  return BY_ID.get(id);
}

/** The product type that best matches a kind + variant (first exact variant match, else the first of that kind). */
export function productTypeFor(kind: Kind, variant?: string): ProductType | undefined {
  return PRODUCT_TYPES.find((t) => t.kind === kind && t.variant === variant) ?? PRODUCT_TYPES.find((t) => t.kind === kind);
}
