import { useEffect } from 'react';
import { api, ApiError } from '../lib/api';
import { useDesignStore, saveLocalDraft } from '../store/useDesignStore';
import { useSession } from '../store/useSession';
import type { DesignDoc } from '../types';

const DEBOUNCE_MS = 1200;
const RETRY_MS = 6000;

/**
 * Keeps the open design saved without a save button: to the account when a
 * project is open, or to this browser in device-only mode. Never saves mid-drag.
 */
export function useAutosave(projectId: string | null) {
  useEffect(() => {
    const { setSave } = useSession.getState();
    let lastSaved: DesignDoc = useDesignStore.getState().doc;
    let timer: number | undefined;
    let inflight = false;
    let again = false;

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

    const flush = async (keepalive = false): Promise<void> => {
      window.clearTimeout(timer);
      const doc = useDesignStore.getState().doc;
      if (doc === lastSaved) return;
      if (inflight) {
        again = true;
        return;
      }
      inflight = true;
      setSave({ saveState: 'saving' });
      try {
        const body = { doc, name: doc.name, revision: useSession.getState().revision };
        let project;
        try {
          project = (await api.saveProject(projectId, body, keepalive)).project;
        } catch (err) {
          if (!(err instanceof ApiError) || err.status !== 409) throw err;
          useDesignStore.getState().toast('This kitchen was also changed in another window. Your version was kept.', 'warn');
          project = (await api.saveProject(projectId, { ...body, force: true }, keepalive)).project;
        }
        lastSaved = doc;
        const dirty = useDesignStore.getState().doc !== doc;
        setSave({ revision: project.revision, lastSavedAt: Date.now(), saveState: dirty ? 'unsaved' : 'saved' });
      } catch {
        setSave({ saveState: 'error' });
        timer = window.setTimeout(() => void flush(), RETRY_MS);
      } finally {
        inflight = false;
        if (again) {
          again = false;
          void flush();
        }
      }
    };

    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void flush(), DEBOUNCE_MS);
    };

    const unsub = useDesignStore.subscribe((s, prev) => {
      if (s.doc !== prev.doc) setSave({ saveState: 'unsaved' });
      if (s.dragging) return;
      if (s.doc !== prev.doc || (prev.dragging && !s.dragging)) schedule();
    });

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
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
    return () => {
      unsub();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('beforeunload', onLeave);
      window.removeEventListener('online', onOnline);
      void flush(true);
    };
  }, [projectId]);
}
