import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Close } from '../../components/Icons';

/** A small dialog asking for a note (reject, suspend): the note is required and shown to the brand. */
export function NoteDialog({
  title,
  intro,
  action,
  danger = false,
  onSubmit,
  onClose,
}: {
  title: string;
  intro: string;
  action: string;
  danger?: boolean;
  onSubmit: (note: string) => Promise<void>;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) {
      setError('Write a note: the brand sees it.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(note.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="note-title">
        <header>
          <h3 id="note-title">{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </header>
        <p className="dialog-copy">{intro}</p>
        <label className="field">
          <span>Note</span>
          <textarea ref={ref} className="brand-textarea" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        </label>
        {error && <div className="auth-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={danger ? 'btn brand-danger' : 'btn primary'} disabled={busy}>
            {busy ? 'Saving…' : action}
          </button>
        </div>
      </form>
    </div>
  );
}
