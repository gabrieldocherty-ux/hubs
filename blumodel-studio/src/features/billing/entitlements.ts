import { useEffect } from 'react';
import { create } from 'zustand';
import { call } from '../../lib/api';
import { loadConfig, useConfig } from '../../lib/config';
import { useSession } from '../../store/useSession';
import { useVisitorStore } from '../showroom/visitor';
import type { AccountPlanId, Entitlements, ExportKind, PlanId } from '../../types/platform';

/**
 * The signed-in account's plan (a legacy subscriber's) and its kitchens, from
 * /api/billing/entitlements. Loaded once per user and refreshed after a payment. Exports are free
 * since the showroom pivot, so nothing here locks the editor any more.
 */

interface EntitlementState {
  userId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  plan: AccountPlanId;
  unlocked: ReadonlySet<string>;
}

export const useEntitlementStore = create<EntitlementState>()(() => ({ userId: null, status: 'idle', plan: 'free', unlocked: new Set() }));

let inflight: Promise<void> | null = null;

/** Loads entitlements for the current user (again with `force`). Never throws. */
export function loadEntitlements(force = false): Promise<void> {
  const userId = useSession.getState().user?.id ?? null;
  const s = useEntitlementStore.getState();
  // A showroom has no billing (its routes answer 404 there) and exports are free: nothing to ask.
  if (!userId || useConfig.getState().config?.site === 'showroom') {
    useEntitlementStore.setState({ userId, status: 'ready', plan: 'free', unlocked: new Set() });
    return Promise.resolve();
  }
  if (!force && s.userId === userId && (s.status === 'ready' || s.status === 'loading')) return inflight ?? Promise.resolve();
  useEntitlementStore.setState({ userId, status: 'loading' });
  // Which site this is decides whether to ask at all (a showroom has no billing): config first.
  const p = loadConfig()
    .then((cfg) => (cfg?.site === 'showroom' ? ({ plan: 'free', unlockedProjectIds: [] } as unknown as Entitlements) : call<Entitlements>('GET', '/api/billing/entitlements')))
    .then((e) => {
      if (useSession.getState().user?.id !== userId) return;
      useEntitlementStore.setState({ userId, status: 'ready', plan: e.plan, unlocked: new Set(e.unlockedProjectIds) });
    })
    .catch(() => useEntitlementStore.setState({ userId, status: 'error', plan: useSession.getState().user?.plan.id ?? 'free' }))
    .finally(() => {
      if (inflight === p) inflight = null;
    });
  inflight = p;
  return p;
}

/**
 * True when the signed-in account may export this kitchen. Since the showroom pivot
 * (docs/SHOWROOM_PIVOT.md §3) downloads are free: being signed in on a saved kitchen is enough,
 * and the server still checks that the kitchen is the account's own.
 */
export function isEntitled(projectId: string | null): boolean {
  // A showroom visitor who gave their details owns their saved designs too (docs/handoff/leads.md).
  return !!projectId && (!!useSession.getState().user || !!useVisitorStore.getState().visitor);
}

/** What the editor shows on its Export menu. `watermark` is always false: nothing is watermarked any more. */
export function useEntitlements(projectId: string | null): { loading: boolean; canExport: boolean; watermark: boolean; plan: PlanId } {
  const userId = useSession((s) => s.user?.id ?? null);
  const st = useEntitlementStore();
  useEffect(() => {
    void loadEntitlements();
  }, [userId]);
  const mine = st.userId === userId;
  const visitor = useVisitorStore((s) => !!s.visitor);
  return { loading: false, canExport: !!projectId && (!!userId || visitor), watermark: false, plan: userId && mine ? st.plan : 'free' };
}

/** A file the server made for a paid export (the CSV and the project file). */
export interface ExportFile {
  filename: string;
  contentType: string;
  content: string;
}

export type ExportRunner = (file?: ExportFile) => Promise<void> | void;

// ── what to finish after paying (kept across the trip to Stripe) ─────────

const INTENT = 'blumodel.exportIntent';
const INTENT_TTL = 2 * 3600 * 1000;

export function saveIntent(i: { projectId: string; kind: ExportKind }) {
  try {
    sessionStorage.setItem(INTENT, JSON.stringify({ ...i, at: Date.now() }));
  } catch {
    // Storage blocked: the export just won't start by itself on return.
  }
}

export function peekIntent(projectId: string): ExportKind | null {
  try {
    const raw = sessionStorage.getItem(INTENT);
    const i = raw ? JSON.parse(raw) : null;
    if (!i || i.projectId !== projectId || Date.now() - i.at > INTENT_TTL) return null;
    return i.kind as ExportKind;
  } catch {
    return null;
  }
}

export function clearIntent() {
  try {
    sessionStorage.removeItem(INTENT);
  } catch {
    /* nothing to clear */
  }
}
