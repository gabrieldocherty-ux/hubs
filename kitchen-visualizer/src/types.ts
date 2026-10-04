export type Kind =
  | 'base'
  | 'corner'
  | 'wall'
  | 'tall'
  | 'oven-tower'
  | 'island'
  | 'sink'
  | 'range'
  | 'fridge'
  | 'dishwasher'
  | 'hood'
  | 'microwave'
  | 'wine'
  | 'stool'
  | 'pendant'
  | 'table'
  | 'chair'
  | 'shelf'
  | 'window'
  | 'door'
  | 'rug'
  | 'plant';

export type CategoryId =
  | 'cabinets'
  | 'appliances'
  | 'sinks'
  | 'lighting'
  | 'seating'
  | 'openings'
  | 'decor';

export type MaterialKind =
  | 'wood'
  | 'paint'
  | 'metal'
  | 'glass'
  | 'stone'
  | 'fabric'
  | 'ceramic'
  | 'foliage'
  | 'leather'
  | 'panel';

export interface Finish {
  id: string;
  name: string;
  hex: string;
  material: MaterialKind;
  /** Optional swatch image (brand products). */
  swatchUrl?: string;
}

/** Where a product came from. Built-ins are compiled in; the rest come from the server or a saved kitchen. */
export type ProductSource = 'builtin' | 'brand' | 'custom' | 'snapshot' | 'missing';

/** Look flags that used to be keyed off brand names (brass knobs, pro backguard). */
export interface ProductFlags {
  trim?: 'brass' | 'steel';
  backguard?: boolean;
}

export interface ProductModel {
  url: string;
  fileId?: string;
  bboxIn?: { w: number; h: number; d: number };
  triangles?: number;
  slots?: string[];
}

export interface Product {
  id: string;
  kind: Kind;
  variant?: string;
  category: CategoryId;
  brand: string;
  name: string;
  /** Industry-style code. `{w}` is replaced with the chosen width. On the wire this is the SKU. */
  code: string;
  widthIn: number;
  depthIn: number;
  heightIn: number;
  /** Height of the item's underside above the finished floor. */
  elevationIn: number;
  widthOptions?: number[];
  price: number;
  /** `'cabinet'` means the shared cabinet finish palette. */
  finishes: Finish[] | 'cabinet';
  blurb: string;

  // ── Platform fields (all optional; built-ins leave most of them unset) ──
  source?: ProductSource;
  brandId?: string;
  brandSlug?: string;
  isDemo?: boolean;
  sku?: string;
  skuByWidth?: Record<string, string>;
  priceByWidth?: Record<string, number>;
  images?: { url: string; alt?: string }[];
  thumbnailUrl?: string;
  buyUrl?: string;
  specSheetUrl?: string;
  model?: ProductModel;
  flags?: ProductFlags;
  status?: 'draft' | 'submitted' | 'published' | 'rejected' | 'archived';
  visibility?: 'public' | 'private';
  revision?: number;
  updatedAt?: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface PlacedItem {
  id: string;
  productId: string;
  /** Center of the footprint, inches from the west (x) and north (y) walls. */
  x: number;
  y: number;
  /** Clockwise. At 0 the item's back faces north and its front faces south. */
  rotation: Rotation;
  /** Position in the product's finish list. Kept for old files; `finishId` wins when both are set. */
  finishIndex: number;
  /** Stable finish id, so a brand reordering its finishes never changes a saved kitchen. */
  finishId?: string;
  widthIn?: number;
  mirrored?: boolean;
}

export interface Room {
  widthIn: number;
  lengthIn: number;
  ceilingIn: number;
}

export type DoorStyle = 'shaker' | 'slab' | 'fluted';

export interface Surfaces {
  cabinetFinishId: string;
  doorStyle: DoorStyle;
  hardwareId: string;
  countertopId: string;
  backsplashId: string;
  flooringId: string;
  paintId: string;
}

export interface DesignDoc {
  name: string;
  room: Room;
  surfaces: Surfaces;
  items: PlacedItem[];
  /** 2 once the doc carries `finishId`s and product snapshots. Absent on old files. */
  version?: 2;
  /** Snapshots of every non-built-in product the kitchen uses, so it still renders after a product is unpublished. */
  products?: Record<string, Product>;
}

export type ViewMode = 'plan' | 'split' | '3d' | 'walls';
export type PlanStyle = 'rendered' | 'drafting';
