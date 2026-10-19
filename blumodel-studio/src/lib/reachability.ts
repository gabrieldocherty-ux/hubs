import { create } from 'zustand';

/**
 * Whether the BluModel Studio server answered the last request. `api.ts` reports every request
 * that never reached it (offline, the tunnel down, an HTML error page instead of the API) and
 * every one that did, so the connection banner can say "can't reach the server" and offer Retry
 * without each screen inventing its own message.
 */
interface ReachState {
  down: boolean;
  /** When the first failure in this run of failures happened. */
  since: number | null;
}

export const useReach = create<ReachState>()(() => ({ down: false, since: null }));

export function markDown() {
  if (!useReach.getState().down) useReach.setState({ down: true, since: Date.now() });
}

export function markUp() {
  if (useReach.getState().down) useReach.setState({ down: false, since: null });
}
