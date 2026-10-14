import { useEffect, useState } from 'react';
import { call } from '../lib/api';
import { loadConfig } from '../lib/config';
import { markDown, useReach } from '../lib/reachability';
import { useSession } from '../store/useSession';

/**
 * "Can't reach BluModel Studio" with a Retry, shown over every screen while the server isn't
 * answering (offline, or the server or its tunnel is down). Work in progress is never lost: the
 * editor keeps unsaved changes and saves them when the connection is back.
 */
export function ConnectionBanner({ local = false }: { local?: boolean }) {
  const down = useReach((s) => s.down);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const offline = () => markDown();
    const online = () => void retry();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) markDown();
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!down) setHidden(false);
  }, [down]);

  const retry = async () => {
    setBusy(true);
    try {
      // Any answer from the API clears the banner (api.ts reports it); then catch up on what failed.
      await call('GET', '/api/config');
      void loadConfig(true);
      if (useSession.getState().status === 'offline') await useSession.getState().init();
    } catch {
      // Still down: the banner stays.
    } finally {
      setBusy(false);
    }
  };

  if (!down || hidden) return null;
  return (
    <div className="conn-banner" role="status" aria-live="polite">
      <span>
        <b>Can’t reach BluModel Studio.</b> {local ? 'Your design stays on this device.' : 'Your changes are kept and save when the connection is back.'}
      </span>
      <button type="button" className="btn" onClick={() => void retry()} disabled={busy}>
        {busy ? 'Trying…' : 'Retry'}
      </button>
      <button type="button" className="btn" onClick={() => setHidden(true)} aria-label="Hide this message">
        Hide
      </button>
    </div>
  );
}
