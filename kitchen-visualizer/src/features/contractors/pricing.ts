import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { call } from '../../lib/api';
import { useSession } from '../../store/useSession';
import { useDesignStore } from '../../store/useDesignStore';
import type { Product } from '../../types';
import type { PriceBookData, PriceQuote } from '../../types/platform';
import { brandKeyOf, makePriceOf } from './priceMath';

/**
 * A contractor's price book in the editor: their sell prices everywhere, and their costs only in
 * Contractor view. Loaded once per session for users with a contractor company (also while the
 * plan has lapsed: their kitchens keep their prices, read-only).
 */

interface PriceBookState {
  userId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  data: PriceBookData | null;
}

export const usePriceBookStore = create<PriceBookState>()(() => ({ userId: null, status: 'idle', data: null }));

let inflight: Promise<void> | null = null;

export function loadPriceBook(force = false): Promise<void> {
  const user = useSession.getState().user;
  const userId = user?.contractor ? user.id : null;
  const s = usePriceBookStore.getState();
  if (!userId) {
    if (s.userId || s.data) usePriceBookStore.setState({ userId: null, status: 'ready', data: null });
    return Promise.resolve();
  }
  if (!force && s.userId === userId && s.status !== 'idle' && s.status !== 'error') return inflight ?? Promise.resolve();
  usePriceBookStore.setState({ userId, status: 'loading' });
  const p = call<PriceBookData>('GET', '/api/pro/price-book/data')
    .then((data) => {
      if (useSession.getState().user?.id === userId) usePriceBookStore.setState({ userId, status: 'ready', data });
    })
    .catch(() => usePriceBookStore.setState({ userId, status: 'error', data: null }))
    .finally(() => {
      if (inflight === p) inflight = null;
    });
  inflight = p;
  return p;
}

const listPrice = makePriceOf(null);

/** BUILD_PLAN §13.2: `priceOf` gives the sell price everyone sees, and the cost only a contractor does. */
export function usePriceBook(): { ready: boolean; isContractor: boolean; priceOf: (product: Product, widthIn: number) => PriceQuote; data: PriceBookData | null } {
  const user = useSession((s) => s.user);
  const contractorId = user?.contractor ? user.id : null;
  const { userId, status, data } = usePriceBookStore();
  useEffect(() => {
    void loadPriceBook();
  }, [contractorId]);
  const mine = !!contractorId && userId === contractorId ? data : null;
  const priceOf = useMemo(() => (mine ? makePriceOf(mine) : listPrice), [mine]);
  return { ready: !contractorId || (userId === contractorId && status !== 'loading' && status !== 'idle'), isContractor: !!contractorId, priceOf, data: mine };
}

/**
 * The catalog panel's view for a contractor (PLANS_AND_CONTRACTORS §4.3): their own catalog first,
 * then the brands they carry; brands switched off are hidden. Everyone else gets the list unchanged.
 */
export function useContractorCatalog(products: Product[]): Product[] {
  const { isContractor, data } = usePriceBook();
  return useMemo(() => {
    if (!isContractor || !data) return products;
    const on = (p: Product) => {
      const key = brandKeyOf(p);
      return key === 'own' || data.brands[key]?.enabled !== false;
    };
    const own = products.filter((p) => brandKeyOf(p) === 'own' && p.source === 'contractor');
    const rest = products.filter((p) => !own.includes(p) && on(p));
    return [...own, ...rest];
  }, [products, isContractor, data]);
}

// ── prices on a shared (view-only) kitchen ───────────────────────────────

type SellPrices = Record<string, { price: number; priceByWidth?: Record<string, number> }>;

/**
 * A shared kitchen is priced by whoever shared it, never by the viewer's own price book. The share
 * page (package E) calls `setSharedPrices(wire.prices ?? null)` when it opens a contractor's
 * share, and `setSharedPrices(null)` when it closes; sell prices only, no costs.
 */
export const useSharedPrices = create<{ priceOf: ((p: Product, widthIn: number) => PriceQuote) | null }>()(() => ({ priceOf: null }));

export function setSharedPrices(prices: SellPrices | null) {
  if (!prices) {
    useSharedPrices.setState({ priceOf: null });
    return;
  }
  useSharedPrices.setState({
    priceOf: (p, w) => {
      const o = prices[p.id];
      if (!o) return listPrice(p, w);
      const v = o.priceByWidth?.[String(w)] ?? o.price;
      return { sell: v, list: v };
    },
  });
}

// ── Client / Contractor view, and presentation mode ──────────────────────

interface ViewState {
  /** 'client' hides every cost; the default, so nothing private shows by accident. */
  view: 'client' | 'contractor';
  presenting: boolean;
}

export const useClientView = create<ViewState>()(() => ({ view: 'client', presenting: false }));

/** True when costs may be on screen: a contractor, in their own kitchen, in Contractor view, not presenting. */
export function useShowCosts(): boolean {
  const { isContractor } = usePriceBook();
  const view = useClientView((s) => s.view);
  const presenting = useClientView((s) => s.presenting);
  const readOnly = useDesignStore((s) => s.readOnly);
  return isContractor && !readOnly && view === 'contractor' && !presenting;
}

/**
 * The prices for the kitchen open in the editor: the contractor's own price book in their own
 * kitchens, the sharer's sell prices on a shared kitchen, list prices otherwise.
 */
export function useKitchenPriceOf(): ((p: Product, widthIn: number) => PriceQuote) | null {
  const { isContractor, priceOf } = usePriceBook();
  const readOnly = useDesignStore((s) => s.readOnly);
  const shared = useSharedPrices((s) => s.priceOf);
  if (readOnly) return shared;
  return isContractor ? priceOf : null;
}
