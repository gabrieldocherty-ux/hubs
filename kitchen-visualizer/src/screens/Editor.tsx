import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { TopBar } from '../components/TopBar';
import { LeftPanel } from '../components/LeftPanel';
import { RightPanel } from '../components/RightPanel';
import { PlanView } from '../components/plan/PlanView';
import { Toasts } from '../components/Toasts';
import { ElevationsView } from '../components/ElevationsView';
import { ConflictDialog } from '../components/ConflictDialog';
import { initialDoc, loadLocalDraft, useDesignStore } from '../store/useDesignStore';
import { useSession } from '../store/useSession';
import { catalogReady, useCatalog } from '../store/useCatalog';
import { useShortcuts } from '../hooks/useShortcuts';
import { useAutosave } from '../hooks/useAutosave';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import { getProduct } from '../data/catalog';

const SceneView = lazy(() => import('../components/three/SceneView').then((m) => ({ default: m.SceneView })));

export interface WorkspaceProps {
  projectId: string | null;
  /**
   * `'view'` is read-only (share links): the design store is `readOnly`, nothing autosaves, the
   * catalog panel is hidden, the right panel shows only the summary and estimate, and the plan
   * can't be dragged or dropped on. View shortcuts 1–4 still work.
   */
  mode: 'edit' | 'view';
  /** View mode only: hide every price (the estimate tab, the total chip, the CSV). Default true. */
  showPrices?: boolean;
  /** Optional strip above the TopBar, e.g. the share page's "Shared by …" header. */
  banner?: ReactNode;
}

export function Workspace({ projectId, mode, showPrices = true, banner }: WorkspaceProps) {
  const viewMode = useDesignStore((s) => s.ui.viewMode);
  const view = mode === 'view';
  const prices = !view || showPrices;
  useShortcuts();
  useAutosave(view ? null : projectId, !view);

  useEffect(() => {
    // The store's readOnly flag is what guards every mutating action; keep it in step with the mode.
    if (useDesignStore.getState().readOnly !== view) useDesignStore.setState({ readOnly: view });
  }, [view]);

  return (
    <div className={`app${banner ? ' app--banner' : ''}${view ? ' app--view' : ''}`}>
      {banner}
      <TopBar mode={mode} showPrices={prices} projectId={view ? null : projectId} />
      <div className={`workspace${view ? ' workspace--view' : ''}`}>
        {!view && <LeftPanel />}
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
        <RightPanel mode={mode} showPrices={prices} />
      </div>
      <Toasts />
      {!view && <ConflictDialog />}
    </div>
  );
}

/** Places a product once the kitchen is open (`#/k/:id?add=`), then clears the query. */
async function addFromLink(projectId: string, productId: string) {
  const store = useDesignStore.getState();
  let product = getProduct(productId);
  if (!product || product.source === 'missing') {
    try {
      const res = await api.catalogProduct(productId);
      useCatalog.getState().register([res.product]);
      product = getProduct(productId);
    } catch {
      product = undefined;
    }
  }
  if (product && product.source !== 'missing') {
    store.addItem(productId);
    store.toast(`Added ${product.name}. Drag it into place on the plan.`, 'ok');
  } else {
    store.toast('That product isn’t available any more, so nothing was added.', 'warn');
  }
  navigate({ name: 'kitchen', id: projectId }, true);
}

/** Opens a saved kitchen from the account. */
export function KitchenEditor({ id, add }: { id: string; add?: string }) {
  const [state, setState] = useState<'loading' | 'ready' | { error: string }>('loading');
  const added = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    setState('loading');
    // Wait (up to 4 s) for the catalog so server products resolve on first paint; a slow or
    // missing catalog still opens the kitchen, using its embedded snapshots.
    Promise.all([api.getProject(id), catalogReady(4000)])
      .then(([{ project }]) => {
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

  useEffect(() => {
    if (state !== 'ready' || !add || added.current === add) return;
    added.current = add;
    void addFromLink(id, add);
  }, [state, add, id]);

  if (state === 'loading') return <div className="screen-msg">Opening your kitchen…</div>;
  if (typeof state === 'object')
    return (
      <div className="screen-msg">
        <p>{state.error}</p>
        <button className="btn" onClick={() => navigate({ name: 'home' })}>Back to my kitchens</button>
      </div>
    );
  return <Workspace projectId={id} mode="edit" />;
}

/** Device-only mode: no account, the design lives in this browser. */
export function LocalEditor() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Not blocked on the catalog: #/local must work with no server. Snapshots embedded in the
    // draft cover server products until the catalog arrives and replaces them.
    useDesignStore.getState().loadDoc(loadLocalDraft() ?? initialDoc());
    useSession.getState().openProject(null, 0);
    setReady(true);
  }, []);
  return ready ? <Workspace projectId={null} mode="edit" /> : null;
}
