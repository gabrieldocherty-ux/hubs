import { create } from 'zustand';
import { brandApi, type BrandSummaryWire } from './api';

/**
 * The brand page at a glance, shared by the workspace nav badge, the Dashboard card and the
 * Leads inbox (which refreshes it after marking leads read). Not persisted.
 */
interface SummaryState {
  summary: BrandSummaryWire | null;
  loading: boolean;
  load: () => Promise<void>;
  setUnread: (n: number) => void;
}

let inflight: Promise<void> | null = null;

export const useBrandSummary = create<SummaryState>()((set) => ({
  summary: null,
  loading: false,
  load: () => {
    if (inflight) return inflight;
    set({ loading: true });
    inflight = brandApi
      .summary()
      .then((r) => set({ summary: r.summary }))
      .catch(() => set({ summary: null }))
      .finally(() => {
        inflight = null;
        set({ loading: false });
      });
    return inflight;
  },
  setUnread: (n) => set((s) => (s.summary ? { summary: { ...s.summary, unread: n } } : s)),
}));
