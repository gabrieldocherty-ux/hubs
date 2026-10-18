import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { prepareDocForSave } from '../../lib/doc';
import { navigate } from '../../lib/router';
import { LocalEditor } from '../../screens/Editor';
import { clearLocalDraft, loadLocalDraft } from '../../store/useDesignStore';
import { useVisitor } from './visitor';

/**
 * `#/local` on a showroom (docs/SHOWROOM_PIVOT.md §5): a design kept on this device (each showroom
 * is its own origin, so its own storage), from before visitors gave their details first. Once
 * this browser is known (it answered "Before you start", docs/handoff/leads.md, or is signed in),
 * the device design is saved to the server and opened as a saved design, which is how it can be
 * sent to the company. Only the company's team (who skip the form) can still land in the device
 * editor here, signed out.
 */
export default function ShowroomLocal({ signedIn }: { signedIn: boolean }) {
  const visitor = useVisitor();
  const known = signedIn || !!visitor;
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!known || started.current) return;
    started.current = true;
    const draft = loadLocalDraft();
    if (!draft) {
      navigate({ name: 'home' }, true);
      return;
    }
    api
      .createProject(draft.name?.trim() || 'My Kitchen', '', prepareDocForSave(draft))
      .then(({ project }) => {
        clearLocalDraft();
        navigate({ name: 'kitchen', id: project.id }, true);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Your design couldn’t be saved. Try again.'));
  }, [known]);
  if (!known) return <LocalEditor />;
  return error ? (
    <div className="screen-msg">
      <p>{error}</p>
      <button className="btn" onClick={() => location.reload()}>
        Try again
      </button>
    </div>
  ) : (
    <div className="screen-msg">Saving your design…</div>
  );
}
