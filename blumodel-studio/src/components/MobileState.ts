/**
 * Small pieces of UI state shared by the phone layout (bottom bar, sheets), the
 * catalog and the selection toolbar. Kept apart from the components so the catalog
 * can close a sheet without importing the shell that renders it.
 */
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

/** At or below this width the editor uses the phone layout: full-screen canvas, bottom bar, sheets. */
export const COMPACT_QUERY = '(max-width: 900px)';
/** A short landscape screen (a phone on its side): sheets slide in from the right instead of the bottom. */
export const SHORT_QUERY = '(max-height: 520px)';

function mql(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
}

export function matches(query: string): boolean {
  return !!mql(query)?.matches;
}

/** True while `query` matches; re-renders when it flips (rotation, window resize). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = mql(query);
      if (!m) return () => {};
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matches(query),
    () => false,
  );
}

/** The phone layout is active (see COMPACT_QUERY). */
export const useCompact = () => useMedia(COMPACT_QUERY);
export const isCompact = () => matches(COMPACT_QUERY);

export type SheetId = 'catalog' | 'room' | 'details';

interface MobileUIState {
  /** The sheet that is open in the phone layout, or null. Only one at a time. */
  sheet: SheetId | null;
  openSheet: (id: SheetId) => void;
  closeSheet: () => void;
  toggleSheet: (id: SheetId) => void;
}

export const useMobileUI = create<MobileUIState>()((set, get) => ({
  sheet: null,
  openSheet: (id) => set({ sheet: id }),
  closeSheet: () => {
    if (get().sheet !== null) set({ sheet: null });
  },
  toggleSheet: (id) => set({ sheet: get().sheet === id ? null : id }),
}));

/** Set on <body> while a product is being dragged out of the catalog; CSS fades sheets and the toolbar. */
export const CATALOG_DRAG_CLASS = 'is-catalog-dragging';
