import { useEffect, useRef, useState } from 'react';
import { useSession } from '../store/useSession';
import { ApiError } from '../lib/api';

/**
 * Shown when autosave gets a 409: this kitchen was saved from another window or device after it
 * was opened here. Saving is paused until the user chooses; nothing is overwritten automatically.
 */
export function ConflictDialog() {
  const conflict = useSession((s) => s.conflict);
  const setConflict = useSession((s) => s.setConflict);
  const [busy, setBusy] = useState<'mine' | 'theirs' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const open = !!conflict?.open;

  useEffect(() => {
    if (!open) return;
    setError(null);
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // While the dialog is up, editor shortcuts (Delete, arrows, undo…) must not reach the kitchen.
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        const c = useSession.getState().conflict;
        if (c) setConflict({ ...c, open: false });
      }
      if (e.key === 'Tab' && dialog.current) {
        // Keep focus inside the dialog.
        const els = dialog.current.querySelectorAll<HTMLElement>('button:not([disabled])');
        if (!els.length) return;
        const a = els[0];
        const z = els[els.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, setConflict]);

  if (!conflict || !open) return null;

  const choose = async (choice: 'mine' | 'theirs') => {
    setBusy(choice);
    setError(null);
    try {
      await conflict.resolve(choice);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That didn’t work. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal conflict-modal" ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" aria-describedby="conflict-body">
        <header>
          <h3 id="conflict-title">This kitchen changed somewhere else</h3>
        </header>
        <p id="conflict-body" className="conflict-body">
          It was saved from another window or device after you opened it here. Your recent changes haven’t been saved yet. Choose which
          version to keep.
        </p>
        {error && <div className="auth-error">{error}</div>}
        <div className="modal-actions">
          <button ref={first} className="btn" disabled={!!busy} onClick={() => choose('theirs')}>
            {busy === 'theirs' ? 'Loading…' : 'Load the other version'}
          </button>
          <button className="btn primary" disabled={!!busy} onClick={() => choose('mine')}>
            {busy === 'mine' ? 'Saving…' : 'Keep mine'}
          </button>
        </div>
      </div>
    </div>
  );
}
