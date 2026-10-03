import { create } from 'zustand';
import { api, isUnreachable, type User } from '../lib/api';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn' | 'offline';
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

interface SessionState {
  status: SessionStatus;
  user: User | null;
  /** The server project open in the editor, or null when editing on this device only. */
  projectId: string | null;
  revision: number;
  saveState: SaveState;
  lastSavedAt: number | null;
  init: () => Promise<void>;
  setUser: (user: User) => void;
  signOut: () => Promise<void>;
  openProject: (id: string | null, revision: number) => void;
  setSave: (patch: Partial<Pick<SessionState, 'saveState' | 'lastSavedAt' | 'revision'>>) => void;
}

export const useSession = create<SessionState>()((set) => ({
  status: 'loading',
  user: null,
  projectId: null,
  revision: 0,
  saveState: 'saved',
  lastSavedAt: null,

  init: async () => {
    try {
      const { user } = await api.me();
      set({ user, status: user ? 'signedIn' : 'signedOut' });
    } catch (e) {
      set({ status: isUnreachable(e) ? 'offline' : 'signedOut' });
    }
  },

  setUser: (user) => set({ user, status: 'signedIn' }),

  signOut: async () => {
    try {
      await api.logout();
    } catch {
      // The cookie is httpOnly; if the call fails the session simply expires.
    }
    set({ user: null, status: 'signedOut', projectId: null });
  },

  openProject: (id, revision) => set({ projectId: id, revision, saveState: 'saved', lastSavedAt: id ? Date.now() : null }),
  setSave: (patch) => set(patch),
}));

export function greeting(name: string): string {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name.split(' ')[0]}`;
}

export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? 's' : ''} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
}
