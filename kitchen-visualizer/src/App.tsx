import { lazy, Suspense } from 'react';
import { TopBar } from './components/TopBar';
import { LeftPanel } from './components/LeftPanel';
import { RightPanel } from './components/RightPanel';
import { PlanView } from './components/plan/PlanView';
import { Toasts } from './components/Toasts';
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
          {viewMode !== '3d' && (
            <section className="stage-pane" aria-label="Floor plan">
              <PlanView />
            </section>
          )}
          {viewMode !== 'plan' && (
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
