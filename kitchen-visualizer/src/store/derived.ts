import { useMemo } from 'react';
import { useDesignStore } from './useDesignStore';
import { useCatalogVersion } from './useCatalog';
import { resolveAll } from '../lib/geometry';
import { runChecks } from '../lib/checks';
import { buildEstimate } from '../lib/estimate';

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

export function useEstimate() {
  const doc = useDesignStore((s) => s.doc);
  const catalogVersion = useCatalogVersion();
  return useMemo(() => buildEstimate(doc), [doc, catalogVersion]);
}
