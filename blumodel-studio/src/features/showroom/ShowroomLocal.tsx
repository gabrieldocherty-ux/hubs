import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { prepareDocForSave } from '../../lib/doc';
import { navigate } from '../../lib/router';
import { LocalEditor } from '../../screens/Editor';
import { clearLocalDraft, loadLocalDraft } from '../../store/useDesignStore';

/**
 * `#/local` on a showroom (docs/SHOWROOM_PIVOT.md §5): a signed-out visitor's design, kept on this
 * device (each showroom is its own origin, so its own storage). Signed in, the device design is
 * saved to the account and opened as a saved design, which is how it can be sent to the company:
 * "Send this design" in the device editor signs up with `next=#/local` to land here.
 */
export default function ShowroomLocal({ signedIn }: { signedIn: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (!signedIn || started.current) return;
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
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Your design couldn’t be saved to your account. Try again.'));
  }, [signedIn]);
  if (!signedIn) return <LocalEditor />;
  return error ? (
    <div className="screen-msg">
      <p>{error}</p>
      <button className="btn" onClick={() => location.reload()}>
        Try again
      </button>
    </div>
  ) : (
    <div className="screen-msg">Saving your design to your account…</div>
  );
}
