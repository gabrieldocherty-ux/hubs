import { lazy, Suspense, useEffect, useState, type SVGProps } from 'react';
import { useSession } from '../../store/useSession';
import { useDesignStore } from '../../store/useDesignStore';
import { useCompact } from '../../components/MobileState';
import { loadEntitlements, useEntitlements } from '../billing';
// The paid-export intent is billing's; it isn't on billing's public index (see docs/handoff/viewer.md).
import { clearIntent, peekIntent } from '../billing/entitlements';
import { closeStudioRender, openStudioRender, useStudio } from './studio';

/**
 * The TopBar's "Studio render" slot (BUILD_PLAN §3.8, A-T8). Lives in the main chunk, so it
 * imports no three or drei: the dialog (and everything it renders with) loads on first open.
 */
const RenderDialog = lazy(() => import('./RenderDialog'));

function StudioIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

/**
 * After paying for an unlock (DEMO or Stripe), the editor reopens with the export intent saved by
 * billing's Unlock dialog. The TopBar's own resume handles the other export kinds; this one takes
 * `render`: it clears the intent first (child effects run before the TopBar's), waits until the
 * account is entitled, then reopens the dialog, which renders and downloads by itself.
 */
function useResumeRender(projectId: string | null) {
  const { canExport } = useEntitlements(projectId);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!projectId || peekIntent(projectId) !== 'render') return;
    clearIntent();
    setWaiting(true);
    void loadEntitlements(true);
  }, [projectId]);

  useEffect(() => {
    if (!waiting) return;
    // The webhook or sync may lag; give up quietly after 30 s (the user can render again).
    const t = window.setTimeout(() => setWaiting(false), 30_000);
    return () => window.clearTimeout(t);
  }, [waiting]);

  useEffect(() => {
    if (!waiting || !canExport) return;
    setWaiting(false);
    const s = useDesignStore.getState();
    s.toast(`Unlocked: exports for “${s.doc.name}” are yours.`, 'ok');
    openStudioRender({ autoDownload: true });
  }, [waiting, canExport]);
}

export function RenderButton(): JSX.Element | null {
  const readOnly = useDesignStore((s) => s.readOnly);
  const projectId = useSession((s) => s.projectId);
  const open = useStudio((s) => s.open);
  const compact = useCompact();
  useResumeRender(readOnly ? null : projectId);
  // Leaving the editor closes the dialog.
  useEffect(() => () => closeStudioRender(), []);

  // Share links and other read-only views have nothing to render for an export.
  if (readOnly) return null;
  return (
    <>
      <button
        type="button"
        className={compact ? 'icon-btn studio-btn' : 'btn studio-btn'}
        onClick={() => openStudioRender()}
        aria-haspopup="dialog"
        aria-label="Studio render"
        title="Studio render: a high-resolution image of this kitchen"
      >
        <StudioIcon width={compact ? 20 : 16} height={compact ? 20 : 16} />
        {!compact && <span>Studio render</span>}
      </button>
      {open && (
        <Suspense fallback={null}>
          <RenderDialog projectId={projectId} />
        </Suspense>
      )}
    </>
  );
}
