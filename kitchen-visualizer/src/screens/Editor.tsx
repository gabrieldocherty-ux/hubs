import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { TopBar } from '../components/TopBar';
import { LeftPanel } from '../components/LeftPanel';
import { RightPanel } from '../components/RightPanel';
import { PlanView } from '../components/plan/PlanView';
import { Toasts } from '../components/Toasts';
import { ElevationsView } from '../components/ElevationsView';
import { SelectionToolbar } from '../components/SelectionToolbar';
import { MobileBar, MobileSheets, PlacementBanner, usePlacementTaps, type CompactView } from '../components/MobileShell';
import { isCompact, useCompact, useMobileUI } from '../components/MobileState';
import { initialDoc, loadLocalDraft, useDesignStore } from '../store/useDesignStore';
import { useSession } from '../store/useSession';
import { useShortcuts } from '../hooks/useShortcuts';
import { useAutosave } from '../hooks/useAutosave';
import { usePlacement } from '../lib/interaction';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import type { ViewMode } from '../types';

const SceneView = lazy(() => import('../components/three/SceneView').then((m) => ({ default: m.SceneView })));

/** Brings the inspector into view on a desktop (it lives in the right column) and makes it blink once. */
function revealInspector() {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>('.right-panel');
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  });
}

function Workspace({ projectId }: { projectId: string | null }) {
  const viewMode = useDesignStore((s) => s.ui.viewMode);
  const placing = usePlacement((s) => s.armedProductId !== null);
  const compact = useCompact();
  useShortcuts();
  useAutosave(projectId);
  usePlacementTaps();

  // A phone has room for one view at a time: Split shows the plan.
  const view: ViewMode = compact && viewMode === 'split' ? 'plan' : viewMode;

  useEffect(() => {
    if (!compact) useMobileUI.getState().closeSheet();
  }, [compact]);

  const onDetails = useCallback(() => {
    useDesignStore.getState().setUI({ rightTab: 'details' });
    if (isCompact()) useMobileUI.getState().openSheet('details');
    else revealInspector();
  }, []);

  return (
    <div className={`app${compact ? ' app--compact' : ''}${placing ? ' is-placing' : ''}`}>
      <TopBar compact={compact} />
      <div className="workspace">
        {!compact && <LeftPanel />}
        <main className={`stage stage--${view}`}>
          {view === 'walls' && (
            <section className="stage-pane" aria-label="Wall elevations">
              <ElevationsView />
            </section>
          )}
          {(view === 'plan' || view === 'split') && (
            <section className="stage-pane" aria-label="Floor plan">
              <PlanView />
            </section>
          )}
          {(view === '3d' || view === 'split') && (
            <section className="stage-pane" aria-label="3D view">
              <Suspense fallback={<div className="scene-loading">Building your kitchen in 3D…</div>}>
                <SceneView />
              </Suspense>
            </section>
          )}
          <PlacementBanner compact={compact} />
        </main>
        {!compact && <RightPanel />}
      </div>
      {compact && <MobileSheets />}
      {compact && <MobileBar view={view as CompactView} />}
      <SelectionToolbar compact={compact} onDetails={onDetails} />
      <Toasts />
    </div>
  );
}

/** Opens a saved kitchen from the account. */
export function KitchenEditor({ id }: { id: string }) {
  const [state, setState] = useState<'loading' | 'ready' | { error: string }>('loading');
  useEffect(() => {
    let live = true;
    setState('loading');
    api
      .getProject(id)
      .then(({ project }) => {
        if (!live) return;
        useDesignStore.getState().loadDoc({ ...project.doc, name: project.name });
        useSession.getState().openProject(project.id, project.revision);
        setState('ready');
      })
      .catch((err) => live && setState({ error: err instanceof ApiError ? err.message : 'Could not open this kitchen.' }));
    return () => {
      live = false;
    };
  }, [id]);

  if (state === 'loading') return <div className="screen-msg">Opening your kitchen…</div>;
  if (typeof state === 'object')
    return (
      <div className="screen-msg">
        <p>{state.error}</p>
        <button className="btn" onClick={() => navigate({ name: 'home' })}>Back to my kitchens</button>
      </div>
    );
  return <Workspace projectId={id} />;
}

/** Device-only mode: no account, the design lives in this browser. */
export function LocalEditor() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    useDesignStore.getState().loadDoc(loadLocalDraft() ?? initialDoc());
    useSession.getState().openProject(null, 0);
    setReady(true);
  }, []);
  return ready ? <Workspace projectId={null} /> : null;
}
