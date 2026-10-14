import type { Finish, PlacedItem, Product, Surfaces } from '../types';
import { CABINET_FINISHES, byId } from '../data/finishes';

/** Used only if a product arrives with an empty finish list (the server requires at least one). */
const NO_FINISH: Finish = { id: 'default', name: 'Default', hex: '#cfc9bf', material: 'paint' };

export function finishList(product: Product): Finish[] {
  if (product.finishes === 'cabinet') return CABINET_FINISHES;
  return Array.isArray(product.finishes) && product.finishes.length ? product.finishes : [NO_FINISH];
}

export function defaultFinishIndex(product: Product, surfaces: Surfaces): number {
  if (product.finishes !== 'cabinet') return 0;
  return Math.max(0, CABINET_FINISHES.findIndex((f) => f.id === surfaces.cabinetFinishId));
}

/** The finish id a new item of this product starts with (the kitchen's cabinet finish for cabinetry). */
export function defaultFinishId(product: Product, surfaces: Surfaces): string | undefined {
  return finishList(product)[defaultFinishIndex(product, surfaces)]?.id;
}

/**
 * Where an item's finish sits in its product's list: by `finishId` first (stable when a brand
 * reorders its finishes), then the legacy `finishIndex`, then the first finish.
 */
export function finishPosition(item: Pick<PlacedItem, 'finishId' | 'finishIndex'>, product: Product): number {
  const list = finishList(product);
  if (item.finishId) {
    const at = list.findIndex((f) => f.id === item.finishId);
    if (at >= 0) return at;
  }
  return item.finishIndex >= 0 && item.finishIndex < list.length ? item.finishIndex : 0;
}

/** Both finish fields for a list position, so old readers (finishIndex) and new (finishId) agree. */
export function finishAt(product: Product, index: number): { finishIndex: number; finishId?: string } {
  const list = finishList(product);
  const i = index >= 0 && index < list.length ? index : 0;
  const id = list[i]?.id;
  return id ? { finishIndex: i, finishId: id } : { finishIndex: i };
}

/** Both finish fields for a finish id (falls back to the first finish if the product doesn't offer it). */
export function finishById(product: Product, id: string): { finishIndex: number; finishId?: string } {
  const at = finishList(product).findIndex((f) => f.id === id);
  return finishAt(product, Math.max(0, at));
}

/** True when the item wears the given finish id (or, with no id, sits at that list position). */
export function itemHasFinish(item: PlacedItem, product: Product, id: string): boolean {
  return finishList(product)[finishPosition(item, product)]?.id === id;
}

/** Panel-ready appliances wear the kitchen's cabinet finish; keeps id 'panel' so renderers can tell. */
export function resolveFinish(item: PlacedItem, product: Product, surfaces: Surfaces): Finish {
  const list = finishList(product);
  const f = list[finishPosition(item, product)] ?? list[0] ?? NO_FINISH;
  if (f.material !== 'panel') return f;
  const cab = byId(CABINET_FINISHES, surfaces.cabinetFinishId);
  return { id: 'panel', name: `Panel-Ready · ${cab.name}`, hex: cab.hex, material: cab.material };
}

export function cabinetFinish(surfaces: Surfaces): Finish {
  return byId(CABINET_FINISHES, surfaces.cabinetFinishId);
}
