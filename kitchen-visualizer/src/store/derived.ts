import { useMemo } from 'react';
import { useDesignStore } from './useDesignStore';
import { resolveAll } from '../lib/geometry';
import { runChecks } from '../lib/checks';
import { buildEstimate } from '../lib/estimate';

export function useResolvedItems() {
  const items = useDesignStore((s) => s.doc.items);
  return useMemo(() => resolveAll(items), [items]);
}

export function useReport() {
  const all = useResolvedItems();
  const room = useDesignStore((s) => s.doc.room);
  return useMemo(() => runChecks(all, room), [all, room]);
}

export function useEstimate() {
  const doc = useDesignStore((s) => s.doc);
  return useMemo(() => buildEstimate(doc), [doc]);
}
