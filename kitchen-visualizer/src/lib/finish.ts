import type { Finish, PlacedItem, Product, Surfaces } from '../types';
import { CABINET_FINISHES, byId } from '../data/finishes';

export function finishList(product: Product): Finish[] {
  return product.finishes === 'cabinet' ? CABINET_FINISHES : product.finishes;
}

export function defaultFinishIndex(product: Product, surfaces: Surfaces): number {
  if (product.finishes !== 'cabinet') return 0;
  return Math.max(0, CABINET_FINISHES.findIndex((f) => f.id === surfaces.cabinetFinishId));
}

/** Panel-ready appliances wear the kitchen's cabinet finish; keeps id 'panel' so renderers can tell. */
export function resolveFinish(item: PlacedItem, product: Product, surfaces: Surfaces): Finish {
  const list = finishList(product);
  const f = list[item.finishIndex] ?? list[0];
  if (f.material !== 'panel') return f;
  const cab = byId(CABINET_FINISHES, surfaces.cabinetFinishId);
  return { id: 'panel', name: `Panel-Ready · ${cab.name}`, hex: cab.hex, material: cab.material };
}

export function cabinetFinish(surfaces: Surfaces): Finish {
  return byId(CABINET_FINISHES, surfaces.cabinetFinishId);
}
