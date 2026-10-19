import { Component, type ErrorInfo, type ReactNode } from 'react';
import { flushAutosave } from '../hooks/useAutosave';
import { QA, QA_LOCAL } from '../lib/qa';
import { splitHash } from '../lib/router';
import { Logo, Wordmark } from './Icons';

/** A lazy chunk that is gone (the app was redeployed while this tab was open). One reload fixes it. */
const STALE_CHUNK = /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError/i;
const RELOADED = 'blumodel.reloadedForChunk';

/**
 * Catches a screen that crashed while rendering and shows "Something went wrong" with Reload,
 * instead of a blank page. The root boundary wraps the whole app; App wraps each route in its own
 * (`inline`), keyed by the route, so moving to another screen clears it. Pending edits are saved
 * first, so "your design is saved" is true.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; inline?: boolean }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    void flushAutosave().catch(() => undefined);
    if (STALE_CHUNK.test(String(error?.message ?? error))) {
      try {
        if (!sessionStorage.getItem(RELOADED)) {
          sessionStorage.setItem(RELOADED, '1');
          location.reload();
        }
      } catch {
        /* storage blocked: the Reload button does the same */
      }
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <Crash inline={this.props.inline} error={this.state.error} />;
  }
}

function Crash({ inline, error }: { inline?: boolean; error: Error }) {
  const reload = () => {
    try {
      sessionStorage.removeItem(RELOADED);
    } catch {
      /* nothing to clear */
    }
    location.reload();
  };
  return (
    <div className={`crash${inline ? ' crash--inline' : ''}`} role="alert">
      <div className="crash-card">
        <a className="brand" href="#/" aria-label="BluModel Studio home">
          <Logo />
          <Wordmark />
        </a>
        <h1>Something went wrong</h1>
        <p>This screen hit a problem it couldn’t recover from. Your design is saved, so reloading picks up where you left off.</p>
        <div className="crash-actions">
          <button type="button" className="btn primary big" onClick={reload} autoFocus>
            Reload
          </button>
          <a className="btn big" href="#/">
            Go to the home page
          </a>
        </div>
        {QA && <p className="crash-detail">{String(error?.message ?? error).slice(0, 300)}</p>}
      </div>
    </div>
  );
}

/**
 * QA only (`?qa` in the URL, on a loopback address): `#/<route>?qa-crash=route` throws inside the
 * route's boundary and `qa-crash=root` inside the root one, so QA can see both screens. Inert
 * without the flag, and on the public site (where a crafted link would show a broken page).
 */
export function QaCrash({ where }: { where: 'route' | 'root' }) {
  if (QA_LOCAL && splitHash(location.hash).query.get('qa-crash') === where) throw new Error(`QA: a deliberate crash in the ${where} boundary`);
  return null;
}
