import type { Product } from '../../types';
import { BUILTIN_PRODUCTS } from '../../data/builtins';

/**
 * Stands in for `src/store/useCatalog.ts` inside the export kit (scripts/build-kit.mjs aliases
 * it), so the estimate and CSV code run on the server without zustand or React. Only
 * `getState().byId` is used there (`getProduct`). The server swaps the product set per call with
 * `withProducts`; calls are synchronous, so nothing can interleave.
 */

const builtins = (): Map<string, Product> => new Map(BUILTIN_PRODUCTS.map((p) => [p.id, p]));

let byId = builtins();

export const useCatalog = {
  getState: () => ({ byId }),
};

/** Runs `fn` with the built-ins plus `products` resolvable by id, then restores the built-ins. */
export function withProducts<T>(products: Product[], fn: () => T): T {
  const map = builtins();
  for (const p of products) if (p && typeof p.id === 'string' && !map.has(p.id)) map.set(p.id, p);
  const prev = byId;
  byId = map;
  try {
    return fn();
  } finally {
    byId = prev;
  }
}
