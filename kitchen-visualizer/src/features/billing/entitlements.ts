import { useEffect } from 'react';
import { create } from 'zustand';
import { call } from '../../lib/api';
import { useSession } from '../../store/useSession';
import type { AccountPlanId, Entitlements, ExportKind, PlanId } from '../../types/platform';

/**
 * What the signed-in account may export: its plan and the kitchens it unlocked for $5. Loaded once
 * per user and refreshed after a payment. The server checks every export again; this only decides
 * whether the editor shows locks and opens the Unlock dialog.
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
  if (!userId) {
    useEntitlementStore.setState({ userId: null, status: 'ready', plan: 'free', unlocked: new Set() });
    return Promise.resolve();
  }
  if (!force && s.userId === userId && (s.status === 'ready' || s.status === 'loading')) return inflight ?? Promise.resolve();
  useEntitlementStore.setState({ userId, status: 'loading' });
  const p = call<Entitlements>('GET', '/api/billing/entitlements')
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

/** True when the signed-in account may export this kitchen (it owns it, and it's unlocked or on a plan). */
export function isEntitled(projectId: string | null): boolean {
  const s = useEntitlementStore.getState();
  const userId = useSession.getState().user?.id ?? null;
  return !!projectId && !!userId && s.userId === userId && (s.plan !== 'free' || s.unlocked.has(projectId));
}

/** BUILD_PLAN §13.2. `watermark` is true until the kitchen is unlocked or the account has a plan. */
export function useEntitlements(projectId: string | null): { loading: boolean; canExport: boolean; watermark: boolean; plan: PlanId } {
  const userId = useSession((s) => s.user?.id ?? null);
  const st = useEntitlementStore();
  useEffect(() => {
    void loadEntitlements();
  }, [userId]);
  const mine = st.userId === userId;
  const canExport = !!projectId && !!userId && mine && (st.plan !== 'free' || st.unlocked.has(projectId));
  return { loading: !!userId && (!mine || st.status === 'loading'), canExport, watermark: !canExport, plan: userId && mine ? st.plan : 'free' };
}

/** A file the server made for a paid export (the CSV and the project file). */
export interface ExportFile {
  filename: string;
  contentType: string;
  content: string;
}

export type ExportRunner = (file?: ExportFile) => Promise<void> | void;

// ── the Unlock dialog's request ───────────────────────────────────────────

export interface UnlockRequest {
  projectId: string | null;
  kind: ExportKind;
}

export const useUnlock = create<{ request: UnlockRequest | null }>()(() => ({ request: null }));

export const openUnlock = (request: UnlockRequest) => useUnlock.setState({ request });
export const closeUnlock = () => useUnlock.setState({ request: null });

// ── what to finish after paying (kept across the trip to Stripe) ─────────

const INTENT = 'mise.exportIntent';
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
