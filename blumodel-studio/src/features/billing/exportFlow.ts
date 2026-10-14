import { useEffect, useRef } from 'react';
import { ApiError, call } from '../../lib/api';
import { pageQuery } from '../../lib/router';
import { flushAutosave } from '../../hooks/useAutosave';
import { useDesignStore } from '../../store/useDesignStore';
import { useSession } from '../../store/useSession';
import type { ExportKind } from '../../types/platform';
import { clearIntent, isEntitled, loadEntitlements, openUnlock, peekIntent, type ExportFile, type ExportRunner } from './entitlements';

const toast = (text: string, tone: 'ok' | 'warn' | 'info' = 'warn') => useDesignStore.getState().toast(text, tone);

/**
 * Every export goes through here (PLANS_AND_CONTRACTORS §2). When the account may export this
 * kitchen, the server records the export and `run` makes the file; for the CSV and the project
 * file the server makes it and `run` receives it. Otherwise the Unlock dialog opens, remembering
 * the export so it finishes by itself after payment.
 */
export async function requestExport(projectId: string | null, kind: ExportKind, run: ExportRunner): Promise<void> {
  if (!projectId || !useSession.getState().user) {
    openUnlock({ projectId, kind });
    return;
  }
  // Known not to be entitled: straight to the options (the server would only say 403).
  if (!isEntitled(projectId)) {
    await loadEntitlements();
    if (!isEntitled(projectId)) {
      openUnlock({ projectId, kind });
      return;
    }
  }
  // Exports are made from the saved kitchen, so save what's on screen first.
  if (useSession.getState().projectId === projectId && !(await flushAutosave())) {
    toast('This kitchen isn’t saved yet (offline, or changed somewhere else). Save it, then export.');
    return;
  }
  let file: ExportFile | undefined;
  try {
    const res = await call<{ ok: true; file?: ExportFile }>('POST', `/api/projects/${encodeURIComponent(projectId)}/exports`, { kind });
    file = res.file;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403 && (e.body as { needs?: string } | undefined)?.needs === 'unlock') {
      void loadEntitlements(true);
      openUnlock({ projectId, kind });
      return;
    }
    toast(e instanceof ApiError ? e.message : 'That export didn’t work. Try again.');
    return;
  }
  if ((kind === 'csv' || kind === 'json') && !file) {
    toast('The server didn’t send the file. Try again.');
    return;
  }
  await run(file);
}

/** Drops Stripe's `?session_id=` from the address bar, keeping the hash route. */
function clearSessionId() {
  history.replaceState(null, '', `${location.pathname}${location.hash}`);
}

/** The kitchen a resume is running for (one at a time, and only once under StrictMode's double effects). */
let resuming: string | null = null;

/**
 * Finishes the export the user paid for once they're back in the kitchen (after DEMO or Stripe
 * Checkout), with a toast. `runners` are the editor's export functions by kind.
 */
export function useResumeExport(projectId: string | null, runners: Partial<Record<ExportKind, ExportRunner>>) {
  const latest = useRef(runners);
  latest.current = runners;
  useEffect(() => {
    if (!projectId || resuming === projectId) return;
    const kind = peekIntent(projectId);
    const sessionId = pageQuery().get('session_id');
    if (!kind && !sessionId) return;
    resuming = projectId;
    const stillHere = () => useSession.getState().projectId === projectId;
    void (async () => {
      try {
        if (sessionId) {
          try {
            await call('POST', '/api/billing/sync', { sessionId });
          } catch {
            // The webhook will catch up; entitlements reload below either way.
          }
          clearSessionId();
        }
        if (kind) clearIntent();
        await Promise.all([loadEntitlements(true), useSession.getState().refresh()]);
        if (!kind || !isEntitled(projectId) || !stillHere()) return;
        toast(`Unlocked: exports for “${useDesignStore.getState().doc.name}” are yours.`, 'ok');
        // Let the plan and 3D views mount and register their exporters first.
        await new Promise((r) => setTimeout(r, 700));
        const run = latest.current[kind];
        if (run && stillHere()) await requestExport(projectId, kind, run);
      } finally {
        resuming = null;
      }
    })();
  }, [projectId]);
}
