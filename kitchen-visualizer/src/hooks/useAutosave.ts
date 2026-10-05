import { useEffect } from 'react';
import { api, ApiError } from '../lib/api';
import { prepareDocForSave } from '../lib/doc';
import { useDesignStore, saveLocalDraft } from '../store/useDesignStore';
import { useSession } from '../store/useSession';
import type { DesignDoc } from '../types';

const DEBOUNCE_MS = 1200;
const RETRY_MS = 6000;

/** The open kitchen's save-now function, while one is mounted. */
let activeFlush: (() => Promise<void>) | null = null;

/**
 * Saves the open kitchen now (exports are made from the saved copy on the server). Resolves
 * true when it is saved, false when it can't be (offline, or changed elsewhere).
 */
export async function flushAutosave(): Promise<boolean> {
  if (activeFlush) await activeFlush();
  const { projectId, saveState } = useSession.getState();
  return !!projectId && saveState === 'saved';
}

/**
 * Keeps the open design saved without a save button: to the account when a project is open, or
 * to this browser in device-only mode. Never saves mid-drag, and does nothing when `enabled` is
 * false (view-only kitchens).
 *
 * A 409 means the kitchen was saved somewhere else first. Saving then pauses and a dialog asks
 * the user to keep theirs (re-save with `force`) or load the other version. There is no
 * automatic force: last-writer-wins would silently discard someone's work.
 */
export function useAutosave(projectId: string | null, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const { setSave, setConflict } = useSession.getState();
    let lastSaved: DesignDoc = useDesignStore.getState().doc;
    let timer: number | undefined;
    let inflight = false;
    let again = false;
    let conflicted = false;
    let disposed = false;

    if (!projectId) {
      const unsub = useDesignStore.subscribe((s, prev) => {
        if (s.doc === prev.doc || s.dragging) return;
        window.clearTimeout(timer);
        timer = window.setTimeout(() => saveLocalDraft(useDesignStore.getState().doc), 400);
      });
      return () => {
        unsub();
        window.clearTimeout(timer);
        saveLocalDraft(useDesignStore.getState().doc);
      };
    }

    const put = (doc: DesignDoc, force: boolean, keepalive: boolean) =>
      api.saveProject(
        projectId,
        { doc: prepareDocForSave(doc), name: doc.name, revision: useSession.getState().revision, ...(force ? { force: true } : {}) },
        keepalive,
      );

    const saved = (doc: DesignDoc, revision: number) => {
      lastSaved = doc;
      const dirty = useDesignStore.getState().doc !== doc;
      setSave({ revision, lastSavedAt: Date.now(), saveState: dirty ? 'unsaved' : 'saved' });
    };

    const resolve = async (choice: 'mine' | 'theirs') => {
      window.clearTimeout(timer);
      if (choice === 'mine') {
        const doc = useDesignStore.getState().doc;
        setSave({ saveState: 'saving' });
        const { project } = await put(doc, true, false);
        conflicted = false;
        setConflict(null);
        saved(doc, project.revision);
        if (useDesignStore.getState().doc !== doc) schedule();
      } else {
        const { project } = await api.getProject(projectId);
        if (disposed) return;
        conflicted = false;
        setConflict(null);
        useDesignStore.getState().loadDoc({ ...project.doc, name: project.name });
        lastSaved = useDesignStore.getState().doc;
        window.clearTimeout(timer);
        setSave({ revision: project.revision, lastSavedAt: Date.now(), saveState: 'saved' });
        useDesignStore.getState().toast('Loaded the other version of this kitchen.', 'info');
      }
    };

    const flush = async (keepalive = false): Promise<void> => {
      window.clearTimeout(timer);
      if (conflicted) return;
      const doc = useDesignStore.getState().doc;
      if (doc === lastSaved) return;
      if (inflight) {
        again = true;
        return;
      }
      inflight = true;
      setSave({ saveState: 'saving' });
      try {
        const { project } = await put(doc, false, keepalive);
        saved(doc, project.revision);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          conflicted = true;
          setSave({ saveState: 'conflict' });
          if (!disposed) setConflict({ open: true, resolve });
        } else {
          setSave({ saveState: 'error' });
          timer = window.setTimeout(() => void flush(), RETRY_MS);
        }
      } finally {
        inflight = false;
        if (again && !conflicted) {
          again = false;
          void flush();
        }
        again = false;
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void flush(), DEBOUNCE_MS);
    };

    const unsub = useDesignStore.subscribe((s, prev) => {
      if (s.doc !== prev.doc && !conflicted) setSave({ saveState: 'unsaved' });
      if (s.dragging || conflicted) return;
      if (s.doc !== prev.doc || (prev.dragging && !s.dragging)) schedule();
    });

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (conflicted) {
          const c = useSession.getState().conflict;
          if (c) setConflict({ ...c, open: true });
          return;
        }
        void flush().then(() => {
          if (useSession.getState().saveState === 'saved') useDesignStore.getState().toast('Saved.', 'ok');
        });
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (useDesignStore.getState().doc === lastSaved) return;
      void flush(true);
      e.preventDefault();
    };
    const onOnline = () => void flush();

    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onLeave);
    window.addEventListener('online', onOnline);
    const mine = async () => {
      await flush();
      // A save already in flight: wait for it to land.
      for (let i = 0; i < 50 && useSession.getState().saveState === 'saving'; i++) await new Promise((r) => setTimeout(r, 100));
    };
    activeFlush = mine;
    return () => {
      if (activeFlush === mine) activeFlush = null;
      disposed = true;
      unsub();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onLeave);
      window.removeEventListener('online', onOnline);
      setConflict(null);
      void flush(true);
    };
  }, [projectId, enabled]);
}
