import { create } from 'zustand';
import { api, isUnreachable, type User } from '../lib/api';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn' | 'offline';
export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict';

/**
 * Set by autosave when the server answers 409 (someone saved this kitchen elsewhere first).
 * Saving pauses until the user picks one; there is never an automatic overwrite.
 */
export interface SaveConflict {
  /** Whether the dialog is showing; the TopBar chip reopens it. */
  open: boolean;
  resolve: (choice: 'mine' | 'theirs') => Promise<void>;
}

interface SessionState {
  status: SessionStatus;
  user: User | null;
  /** The server project open in the editor, or null when editing on this device only. */
  projectId: string | null;
  revision: number;
  saveState: SaveState;
  lastSavedAt: number | null;
  conflict: SaveConflict | null;
  init: () => Promise<void>;
  setUser: (user: User) => void;
  signOut: () => Promise<void>;
  openProject: (id: string | null, revision: number) => void;
  setSave: (patch: Partial<Pick<SessionState, 'saveState' | 'lastSavedAt' | 'revision'>>) => void;
  setConflict: (conflict: SaveConflict | null) => void;
}

/** Fills role and brands if an older server leaves them out, so callers can rely on both. */
function normalizeUser(user: User | null): User | null {
  if (!user) return null;
  return { ...user, role: user.role ?? 'customer', brands: Array.isArray(user.brands) ? user.brands : [] };
}

export const useSession = create<SessionState>()((set) => ({
  status: 'loading',
  user: null,
  projectId: null,
  revision: 0,
  saveState: 'saved',
  lastSavedAt: null,
  conflict: null,

  init: async () => {
    try {
      const user = normalizeUser((await api.me()).user);
      set({ user, status: user ? 'signedIn' : 'signedOut' });
    } catch (e) {
      set({ status: isUnreachable(e) ? 'offline' : 'signedOut' });
    }
  },

  setUser: (user) => set({ user: normalizeUser(user), status: 'signedIn' }),

  signOut: async () => {
    try {
      await api.logout();
    } catch {
      // The cookie is httpOnly; if the call fails the session simply expires.
    }
    set({ user: null, status: 'signedOut', projectId: null, conflict: null });
  },

  openProject: (id, revision) => set({ projectId: id, revision, saveState: 'saved', lastSavedAt: id ? Date.now() : null, conflict: null }),
  setSave: (patch) => set(patch),
  setConflict: (conflict) => set({ conflict }),
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
