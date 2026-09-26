export type Category = 'cabinet' | 'appliance' | 'countertop' | 'flooring' | 'fixture';

export interface Finish {
  name: string;
  hex: string;
}

export interface CatalogItem {
  id: string;
  category: Category;
  brand: string;
  name: string;
  /** Footprint as seen from above, in inches. */
  widthIn: number;
  depthIn: number;
  finishes: Finish[];
}

export interface PlacedItem {
  instanceId: string;
  catalogId: string;
  /** Center point of the item, in inches from the room's top-left corner. */
  x: number;
  y: number;
  rotationDeg: 0 | 90 | 180 | 270;
  finishIndex: number;
}

export interface RoomDimensions {
  widthIn: number;
  lengthIn: number;
}
