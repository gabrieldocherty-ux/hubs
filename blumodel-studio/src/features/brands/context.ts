import { createContext, useContext } from 'react';
import type { BrandState } from './api';

/** The Brand page tab's shared state: the page, its checks, the lapsed flag and a reload. */
export interface BrandTab {
  state: BrandState;
  /** True while the Contractor plan has lapsed: everything shows, nothing changes. */
  readOnly: boolean;
  /** Replaces the state with a server response (save, submit) or re-reads it. */
  setState: (s: BrandState) => void;
  reload: () => Promise<void>;
}

export const BrandTabContext = createContext<BrandTab | null>(null);

export function useBrandTab(): BrandTab {
  const v = useContext(BrandTabContext);
  if (!v) throw new Error('useBrandTab outside the Brand page tab');
  return v;
}
