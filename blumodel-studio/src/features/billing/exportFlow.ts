import { useEffect, useRef } from 'react';
import { ApiError, call } from '../../lib/api';
import { clearSessionId, takeCheckoutReturn } from '../../lib/payments';
import { pageQuery } from '../../lib/router';
import { flushAutosave } from '../../hooks/useAutosave';
import { useDesignStore } from '../../store/useDesignStore';
import { useSession } from '../../store/useSession';
import type { ExportKind } from '../../types/platform';
import { clearIntent, isEntitled, loadEntitlements, peekIntent, type ExportFile, type ExportRunner } from './entitlements';

const toast = (text: string, tone: 'ok' | 'warn' | 'info' = 'warn') => useDesignStore.getState().toast(text, tone);

/**
 * Every export goes through here (PLANS_AND_CONTRACTORS §2). Since the showroom pivot downloads
 * are free for the kitchen's owner on every site: the server records the export and `run` makes
 * the file; for the CSV and the project file the server makes it and `run` receives it. Nothing
 * here asks for a payment. A kitchen that is only on this device has to be signed in and saved first.
 */
export async function requestExport(projectId: string | null, kind: ExportKind, run: ExportRunner): Promise<void> {
  if (!projectId || !isEntitled(projectId)) {
    toast('Downloads are free. Sign in and save this kitchen to your account, then download it.', 'info');
    return;
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
    toast(e instanceof ApiError ? e.message : 'That export didn’t work. Try again.');
    return;
  }
  if ((kind === 'csv' || kind === 'json') && !file) {
    toast('The server didn’t send the file. Try again.');
    return;
  }
  await run(file);
}

/** The kitchen a resume is running for (one at a time, and only once under StrictMode's double effects). */
let resuming: string | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Finishes the export the user paid for once they're back in the kitchen (after DEMO or Stripe
 * Checkout), with a toast. `runners` are the editor's export functions by kind. Coming back from a
 * cancelled checkout says so; a paid Stripe checkout the server hasn't confirmed yet is waited for
 * a little, then explained.
 */
export function useResumeExport(projectId: string | null, runners: Partial<Record<ExportKind, ExportRunner>>) {
  const latest = useRef(runners);
  latest.current = runners;
  useEffect(() => {
    if (!projectId || resuming === projectId) return;
    const kind = peekIntent(projectId);
    const back = takeCheckoutReturn(`#/k/${projectId}`);
    const sessionId = back?.sessionId ?? pageQuery().get('session_id');
    if (!kind && !back && !sessionId) return;
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
        if (back?.outcome === 'cancel' && !isEntitled(projectId)) {
          toast('Checkout cancelled. Nothing was charged, and exports for this kitchen are still locked.', 'info');
          return;
        }
        // Paid on Stripe, but the payment hasn't reached the server yet: give the webhook a moment.
        for (let i = 0; sessionId && i < 5 && !isEntitled(projectId); i++) {
          await sleep(2000);
          await loadEntitlements(true);
        }
        if (sessionId && !isEntitled(projectId)) {
          toast('Payment received. We’re still confirming it: reload in a minute and your exports will be unlocked.', 'info');
          return;
        }
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
