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
}

export interface Product {
  id: string;
  kind: Kind;
  variant?: string;
  category: CategoryId;
  brand: string;
  name: string;
  /** Industry-style code. `{w}` is replaced with the chosen width. */
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
  finishIndex: number;
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
}

export type ViewMode = 'plan' | 'split' | '3d' | 'walls';
export type PlanStyle = 'rendered' | 'drafting';
