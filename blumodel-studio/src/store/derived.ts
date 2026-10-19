import { useMemo } from 'react';
import { useDesignStore } from './useDesignStore';
import { useCatalogVersion } from './useCatalog';
import { resolveAll } from '../lib/geometry';
import { runChecks } from '../lib/checks';
import { buildEstimate } from '../lib/estimate';
import { useKitchenPriceOf } from '../features/contractors';

// The catalog version is a dependency everywhere: when a server product (or its snapshot) loads,
// the same items resolve to different products, sizes and prices.

export function useResolvedItems() {
  const items = useDesignStore((s) => s.doc.items);
  const catalogVersion = useCatalogVersion();
  return useMemo(() => resolveAll(items), [items, catalogVersion]);
}

export function useReport() {
  const all = useResolvedItems();
  const room = useDesignStore((s) => s.doc.room);
  return useMemo(() => runChecks(all, room), [all, room]);
}

/**
 * The kitchen's estimate: at a contractor's sell prices (with their costs) in their own kitchens,
 * at the sharer's sell prices on a shared kitchen, at list prices otherwise.
 */
export function useEstimate() {
  const doc = useDesignStore((s) => s.doc);
  const catalogVersion = useCatalogVersion();
  const priceOf = useKitchenPriceOf();
  return useMemo(() => buildEstimate(doc, priceOf ? { priceOf } : {}), [doc, catalogVersion, priceOf]);
}
