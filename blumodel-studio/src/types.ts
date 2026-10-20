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
  | 'plant'
  // Bathrooms (2026-10-19): a vanity with its own top and basin, a toilet, a tub, a shower, a mirror.
  | 'vanity'
  | 'toilet'
  | 'tub'
  | 'shower'
  | 'mirror';

export type CategoryId =
  | 'cabinets'
  | 'appliances'
  | 'sinks'
  | 'lighting'
  | 'seating'
  | 'openings'
  | 'bath'
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

/**
 * Where a product came from. Built-ins are compiled in; the rest come from the server or a saved
 * kitchen. `contractor` products are a contractor's private catalog (only they see them).
 */
/** `tenant`: a showroom company's own product (docs/handoff/tenancy.md), only ever on its showroom. */
export type ProductSource = 'builtin' | 'brand' | 'custom' | 'contractor' | 'tenant' | 'snapshot' | 'missing';

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
  /**
   * A retail product with no checked store price: `price` is only a typical one (BluModel Basics
   * of the same type) for sorting, and estimates show "Price at store" and leave it out of the total.
   */
  priceAtStore?: boolean;
  /** `'cabinet'` means the shared cabinet finish palette. */
  finishes: Finish[] | 'cabinet';
  blurb: string;

  // ── Platform fields (all optional; built-ins leave most of them unset) ──
  source?: ProductSource;
  brandId?: string;
  brandSlug?: string;
  /** `contractor`: sold by a Contractor account's brand page ("by <company>" in the catalog). */
  brandKind?: 'contractor' | 'partner';
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
  /** Uploaded image ids, on the working copy its editors get (brand portal, My catalog). */
  imageFileIds?: string[];
  /** A product line or collection ("Smith Shaker"); groups a contractor's catalog. */
  line?: string;
  /**
   * The maker of the real product a model stands for ("Bosch"), from the spec's `brand`. `brand`
   * above stays the catalog's display brand ("Your model", a contractor's company).
   */
  productBrand?: string;
  /** The real product's UPC/EAN, digits only (12, 13 or 8). Links it to the retail catalog's store listings. */
  upc?: string;
  /** The door style a cabinet line is sold in. The kitchen-wide style still draws the doors. */
  doorStyle?: DoorStyle;
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

/** Corner points in inches from the plan's north-west origin; see `lib/outline.ts`. */
export type OutlinePt = [number, number];

/**
 * What stands along one edge of an outline. `wall` is the default for a room's own walls and `open`
 * for an open area's border, so most plans never say.
 * - wall: a full-height wall (holds doors and windows)
 * - half: a half wall, 42″ (a pony wall between kitchen and living room)
 * - bar: a half wall with a bar-height counter ledge on the room side
 * - rail: a 36″ railing (an open stair, a step down)
 * - glass: a full-height glass partition
 * - beam: no wall, a dropped beam (bulkhead) overhead that marks the edge
 * - open: nothing, just the line where one area ends and the next begins
 */
export type EdgeStyle = 'wall' | 'half' | 'bar' | 'rail' | 'glass' | 'beam' | 'open';

/**
 * Another space in the same plan. A `room` has its own floor and walls (a pantry, a dining room, a
 * hall) and sits beside the others. A `zone` is an area marked inside open space (the kitchen part
 * of an open-plan kitchen and living room): it adds no floor, its border is `open` unless styled.
 */
export interface ExtraRoom {
  id: string;
  name: string;
  outline: OutlinePt[];
  ceilingIn?: number;
  kind?: 'room' | 'zone';
  /** One style per edge (edge i runs from corner i to corner i+1). Absent: every edge is the default. */
  styles?: EdgeStyle[];
  /** This room's own floor (a FLOORING id). Absent: the kitchen's (surfaces.flooringId). Open areas have no floor of their own. */
  flooringId?: string;
}

/** What covers a feature wall (lib/wallFinish.ts). */
export type WallPanel = 'wainscot' | 'board-batten' | 'shiplap' | 'tile';

/** One wall's own finish: an accent colour, and/or a panel treatment. */
export interface WallFinish {
  /** A PAINTS id for this wall (and its shiplap); absent: the room's paint. */
  paintId?: string;
  panel?: WallPanel;
  /** Wainscoting and board & batten: how high, inches. */
  panelHeightIn?: number;
  /** Tile: a BACKSPLASHES id. */
  tileId?: string;
}

export interface Room {
  /** Bounding box of the main room. For a drawn room these are derived from `outline`. */
  widthIn: number;
  lengthIn: number;
  ceilingIn: number;
  /** Walls the person drew: a closed rectilinear outline. Absent means the plain rectangle. */
  outline?: OutlinePt[];
  /** Edge styles of `outline` (or of the rectangle), same length as its corners. Absent: all walls. */
  styles?: EdgeStyle[];
  /** Further rooms and open areas that share the plan (and its walls and doorways). */
  extra?: ExtraRoom[];
  /** Feature walls, keyed `${spaceId}:${edge}` (lib/wallFinish.ts). */
  wallFinishes?: Record<string, WallFinish>;
}

export type DoorStyle = 'shaker' | 'slab' | 'fluted';

/** A real faucet, pull or knob from the retail catalog, chosen kitchen-wide in Room & finishes. */
export type FixtureKind = 'faucet' | 'pull' | 'knob';
/** How it is drawn: faucet pulldown/pullout/single/side-spray/spring; pull bar/arch/rect/finger; knob mushroom/disc. */
export type FixtureStyle = 'pulldown' | 'pullout' | 'single' | 'side-spray' | 'spring' | 'bar' | 'arch' | 'rect' | 'finger' | 'mushroom' | 'disc';

/**
 * The parts of a retail fixture a kitchen needs to draw and price it (`doc.fixtures`, like
 * `doc.products`): kept in the saved kitchen so it renders and prices with the catalog unloaded,
 * and on the server (paid exports).
 */
export interface Fixture {
  id: string;
  kind: FixtureKind;
  style: FixtureStyle;
  brand: string;
  name: string;
  code: string;
  finish: { id: string; name: string; hex: string };
  roughness: number;
  /** Inches: `length` and `cc` (post spacing) for a pull, `dia` for a knob, `height` for a faucet. */
  sizeIn: { length?: number; cc?: number; dia?: number; height?: number };
  /** Per piece, in the kitchen's currency. */
  price: number;
  /** False when no store price was checked and `price` is a typical one. */
  priceKnown: boolean;
  extras?: { soap?: boolean; sideSpray?: boolean };
}

export interface Surfaces {
  cabinetFinishId: string;
  doorStyle: DoorStyle;
  /** A built-in hardware finish (`brass`…) or a retail pull or knob (`r-…`, see `Fixture`). */
  hardwareId: string;
  /** A retail faucet (`r-…`) drawn on every sink. Absent: each sink draws its own, in the hardware finish. */
  faucetId?: string;
  countertopId: string;
  backsplashId: string;
  flooringId: string;
  paintId: string;
  /** Crown moulding along the tops of wall and tall cabinets. Absent: none. */
  crown?: CrownStyle;
}

export type CrownStyle = 'none' | 'flat' | 'cove';

/**
 * An extra estimate line: labour or a service such as installation, demolition or delivery.
 * `amount` is what the client pays; `cost` is the contractor's own number and never leaves their
 * account (the server strips it from shares and exports).
 */
export interface EstimateExtra {
  id: string;
  label: string;
  amount: number;
  cost?: number;
}

/** The catalog categories a kitchen can name preferred brands for (the setup wizard's brand step). */
export type BrandCategory = 'cabinets' | 'appliances' | 'sinks' | 'lighting';

/** Preferred brand names per category. A missing or empty list means any brand. */
export type BrandPrefs = Partial<Record<BrandCategory, string[]>>;

export interface DesignDoc {
  name: string;
  room: Room;
  surfaces: Surfaces;
  items: PlacedItem[];
  /** Brands chosen when the kitchen was set up: the layout builder and Add products start from them. */
  brandPrefs?: BrandPrefs;
  /** 2 once the doc carries `finishId`s and product snapshots. Absent on old files. */
  version?: 2;
  /** Snapshots of every non-built-in product the kitchen uses, so it still renders after a product is unpublished. */
  products?: Record<string, Product>;
  /** Snapshots of the retail faucet and hardware the surfaces name (`faucetId`, `hardwareId`). */
  fixtures?: Record<string, Fixture>;
  /** Extra estimate lines (installation, delivery…). */
  extras?: EstimateExtra[];
}

export type ViewMode = 'plan' | 'split' | '3d' | 'walls';
export type PlanStyle = 'rendered' | 'drafting';
