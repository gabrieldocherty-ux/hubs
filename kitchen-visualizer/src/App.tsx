import { lazy, Suspense } from 'react';
import { TopBar } from './components/TopBar';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { PlanView } from './components/plan/PlanView';
import { Toasts } from './components/Toasts';
import { ElevationsView } from './components/ElevationsView';
import { useDesignStore } from './store/useDesignStore';
import { useShortcuts } from './hooks/useShortcuts';

const SceneView = lazy(() => import('./components/three/SceneView').then((m) => ({ default: m.SceneView })));

export default function App() {
  const viewMode = useDesignStore((s) => s.ui.viewMode);
  useShortcuts();
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
