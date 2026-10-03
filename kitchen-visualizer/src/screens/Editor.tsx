import { lazy, Suspense, useEffect, useState } from 'react';
import { TopBar } from '../components/TopBar';
import { LeftPanel } from '../components/LeftPanel';
import { RightPanel } from '../components/RightPanel';
import { PlanView } from '../components/plan/PlanView';
import { Toasts } from '../components/Toasts';
import { ElevationsView } from '../components/ElevationsView';
import { initialDoc, loadLocalDraft, useDesignStore } from '../store/useDesignStore';
import { useSession } from '../store/useSession';
import { useShortcuts } from '../hooks/useShortcuts';
import { useAutosave } from '../hooks/useAutosave';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';

const SceneView = lazy(() => import('../components/three/SceneView').then((m) => ({ default: m.SceneView })));

function Workspace({ projectId }: { projectId: string | null }) {
  const viewMode = useDesignStore((s) => s.ui.viewMode);
  useShortcuts();
  useAutosave(projectId);
  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <LeftPanel />
        <main className={`stage stage--${viewMode}`}>
          {viewMode === 'walls' && (
            <section className="stage-pane" aria-label="Wall elevations">
              <ElevationsView />
            </section>
          )}
          {(viewMode === 'plan' || viewMode === 'split') && (
            <section className="stage-pane" aria-label="Floor plan">
              <PlanView />
            </section>
          )}
          {(viewMode === '3d' || viewMode === 'split') && (
            <section className="stage-pane" aria-label="3D view">
              <Suspense fallback={<div className="scene-loading">Building your kitchen in 3D…</div>}>
                <SceneView />
              </Suspense>
            </section>
          )}
        </main>
        <RightPanel />
      </div>
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
