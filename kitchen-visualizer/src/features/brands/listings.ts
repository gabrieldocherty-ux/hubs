import { useCallback, useEffect, useMemo, useState } from 'react';
import { brandApi, type BrandProducts, type ProductEntry } from './api';

/**
 * The brand-page state of every My-catalog product, for the "Show on my brand page" switches in
 * My catalog. `null` until loaded, and stays `null` if the brand page can't be read.
 */
export function useBrandListings() {
  const [data, setData] = useState<BrandProducts | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await brandApi.products());
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const byId = useMemo(() => new Map((data?.products ?? []).map((e) => [e.id, e])), [data]);

  const replace = useCallback((entry: ProductEntry, liveCount: number) => {
    setData((d) => (d ? { ...d, liveCount, products: d.products.map((p) => (p.id === entry.id ? entry : p)) } : d));
  }, []);

  return { data, byId, replace, reload };
}
