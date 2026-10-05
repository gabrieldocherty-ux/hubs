import { create } from 'zustand';
import type { Product } from '../types';
import type { BrandSummary } from '../types/platform';
import { BUILTIN_IDS, BUILTIN_PRODUCTS } from '../data/builtins';
import { api } from '../lib/api';

/**
 * The catalog registry: every product the app can resolve by id.
 *
 * Precedence, highest first: built-in (compiled in, never replaced) → live (from the server:
 * `/api/catalog`, a product page, a share link) → snapshot (embedded in a saved kitchen's
 * `doc.products`) → missing (a placeholder so an unknown item is kept, never deleted).
 *
 * `products` is what the catalog panel browses: built-ins plus live server products.
 * `byId` resolves everything, snapshots and placeholders included.
 * Every change bumps `version` and replaces `byId`, so memo dependencies can follow it.
 */
export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface CatalogState {
  version: number;
  status: CatalogStatus;
  products: Product[];
  byId: Map<string, Product>;
  brands: BrandSummary[];
  /** Fetches `/api/catalog` once (or again with `force`). Never throws; offline leaves the built-ins. */
  load(force?: boolean): Promise<void>;
  /** Adds or replaces live server products. Built-in ids are ignored. */
  register(list: Product[]): void;
  /** Adds saved-kitchen snapshots for ids that aren't known live (or are only placeholders). */
  registerSnapshots(rec: Record<string, Product>): void;
  /** Adds `missingProduct` placeholders for ids nothing else knows. */
  registerMissing(list: Product[]): void;
}

const RANK: Record<string, number> = { builtin: 4, brand: 3, custom: 3, contractor: 3, snapshot: 2, missing: 1 };
const LIVE_SOURCES = new Set(['brand', 'custom', 'contractor']);
const rank = (p: Product | undefined) => (p ? RANK[p.source ?? 'brand'] ?? 3 : 0);

let inflight: Promise<void> | null = null;

export const useCatalog = create<CatalogState>()((set, get) => {
  /** Applies `next` entries that outrank what is there; `browse` also lists them in `products`. */
  const merge = (next: Product[], browse: boolean) => {
    const { byId, products } = get();
    let changed = false;
    let map: Map<string, Product> | null = null;
    const listed = new Map(products.map((p, i) => [p.id, i]));
    let list: Product[] | null = null;
    for (const p of next) {
      if (!p || typeof p.id !== 'string' || BUILTIN_IDS.has(p.id)) continue;
      const cur = (map ?? byId).get(p.id);
      if (cur && rank(cur) > rank(p)) continue;
      map ??= new Map(byId);
      map.set(p.id, p);
      changed = true;
      if (browse) {
        list ??= [...products];
        const at = listed.get(p.id);
        if (at === undefined) {
          listed.set(p.id, list.length);
          list.push(p);
        } else list[at] = p;
      }
    }
    if (!changed) return;
    set((s) => ({ byId: map!, products: list ?? s.products, version: s.version + 1 }));
  };

  return {
    version: 0,
    status: 'idle',
    products: BUILTIN_PRODUCTS,
    byId: new Map(BUILTIN_PRODUCTS.map((p) => [p.id, p])),
    brands: [],

    load: (force = false) => {
      const { status } = get();
      if (inflight) return inflight;
      if (status === 'ready' && !force) return Promise.resolve();
      set({ status: 'loading' });
      inflight = api
        .catalog()
        .then(({ products, brands }) => {
          const live = (Array.isArray(products) ? products : []).map((p) => ({ ...p, source: LIVE_SOURCES.has(p.source ?? '') ? p.source : 'brand' }) as Product);
          if (force) {
            // A forced reload re-lists exactly what the server serves now; unpublished products
            // drop out of the browse list but stay resolvable for kitchens that use them.
            set((st) => ({ products: [...BUILTIN_PRODUCTS, ...live.filter((p) => !BUILTIN_IDS.has(p.id))], version: st.version + 1 }));
          }
          merge(live, true);
          set({ status: 'ready', brands: Array.isArray(brands) ? brands : [] });
        })
        .catch(() => {
          set({ status: 'error' });
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },

    register: (list) => merge(list.map((p) => (LIVE_SOURCES.has(p.source ?? '') ? p : { ...p, source: 'brand' as const })), true),

    registerSnapshots: (rec) => {
      if (!rec || typeof rec !== 'object') return;
      const list: Product[] = [];
      for (const [id, p] of Object.entries(rec)) {
        if (!p || typeof p !== 'object') continue;
        list.push({ ...p, id, source: 'snapshot' });
      }
      merge(list, false);
    },

    registerMissing: (list) => merge(list.map((p) => ({ ...p, source: 'missing' as const })), false),
  };
});

export function useCatalogVersion(): number {
  return useCatalog((s) => s.version);
}

/**
 * Resolves once the catalog has loaded (or failed), or after `timeoutMs`, whichever is first.
 * The editor waits on this before opening a kitchen so server products resolve on first paint.
 */
export function catalogReady(timeoutMs = 4000): Promise<void> {
  const s = useCatalog.getState();
  if (s.status === 'ready' || s.status === 'error') return Promise.resolve();
  const loading = s.load();
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    loading.finally(() => {
      clearTimeout(t);
      resolve();
    });
  });
}
