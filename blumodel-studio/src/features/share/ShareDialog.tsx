import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { Check, Copy } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { flushAutosave } from '../../hooks/useAutosave';
import { useSession, timeAgo } from '../../store/useSession';
import type { ShareLink } from '../../types/platform';
import { copyText, inFuture, shareApi, shareUrl, type ExpiryDays } from './api';
import './share.css';

const EXPIRY: { value: string; days: ExpiryDays; label: string }[] = [
  { value: 'never', days: null, label: 'Never' },
  { value: '7', days: 7, label: 'After 7 days' },
  { value: '30', days: 30, label: 'After 30 days' },
  { value: '90', days: 90, label: 'After 90 days' },
];

const isLive = (s: ShareLink, now: number) => s.revokedAt == null && (s.expiresAt == null || s.expiresAt > now);

function views(s: ShareLink): string {
  if (!s.viewCount) return 'No views yet';
  const n = `${s.viewCount} view${s.viewCount === 1 ? '' : 's'}`;
  return s.lastViewedAt ? `${n}, last ${timeAgo(s.lastViewedAt)}` : n;
}

/** The share dialog: make view-only links, copy them, see who's looked, turn them off. */
export default function ShareDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const contractor = useSession((s) => s.user?.contractor ?? null);
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [serverNow, setServerNow] = useState(() => Date.now());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [showPrices, setShowPrices] = useState(true);
  const [expiry, setExpiry] = useState('never');
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState<{ id: string; ok: boolean } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const copiedTimer = useRef<number>();

  const load = useCallback(async () => {
    try {
      const r = await shareApi.list(projectId);
      setLinks(r.shares);
      setServerNow(r.now);
      setError('');
    } catch (e) {
      setLinks((l) => l ?? []);
      setError(e instanceof ApiError ? e.message : 'Could not load your links.');
    }
  }, [projectId]);

  useEffect(() => {
    // A link shows the saved kitchen, so save what's on screen first.
    void flushAutosave().finally(load);
    return () => window.clearTimeout(copiedTimer.current);
  }, [load]);

  const copy = async (s: ShareLink) => {
    const ok = await copyText(shareUrl(s.token));
    setCopied({ id: s.id, ok });
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(null), 4000);
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await flushAutosave();
      const days = EXPIRY.find((x) => x.value === expiry)?.days ?? null;
      const { share } = await shareApi.create(projectId, { label: label.trim(), showPrices, expiresInDays: days });
      setLinks((l) => [share, ...(l ?? [])]);
      setServerNow(Date.now());
      setFresh(share.id);
      setLabel('');
      await copy(share);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not make a link. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (s: ShareLink) => {
    setConfirming(null);
    try {
      const { share } = await shareApi.revoke(projectId, s.id);
      setLinks((l) => (l ?? []).map((x) => (x.id === share.id ? share : x)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not turn that link off.');
    }
  };

  const live = (links ?? []).filter((s) => isLive(s, serverNow));
  const old = (links ?? []).filter((s) => !isLive(s, serverNow));

  return (
    <Dialog title="Share this kitchen" onClose={onClose} className="share-dialog">
      <p className="dialog-copy">
        {contractor
          ? `Your client sees the kitchen in 2D and 3D with “Prepared by ${contractor.company}”, a Contact button and your sell prices. Never your costs or margins. They can’t change anything.`
          : 'Anyone with the link can look around in 2D and 3D and see the products. They can’t change anything, and they never see your email. The link always shows your latest saved version.'}
      </p>

      <form className="share-new" onSubmit={create}>
        <label className="field">
          <span>
            Label <em>(only you see it)</em>
          </span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder={contractor ? 'e.g. Riley, first draft' : 'e.g. For Mum, or Contractor quote'} />
        </label>
        <div className="share-new-row">
          <label className="share-check">
            <input type="checkbox" checked={showPrices} onChange={(e) => setShowPrices(e.target.checked)} />
            <span>Show prices</span>
          </label>
          <label className="share-expiry">
            <span>Link expires</span>
            <select value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              {EXPIRY.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Making…' : 'Create link'}
          </button>
        </div>
      </form>

      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}

      <div className="share-list" aria-live="polite">
        <span className="mini-label">{live.length ? `Active links (${live.length})` : 'Active links'}</span>
        {links === null ? (
          <p className="share-empty">Loading your links…</p>
        ) : live.length === 0 ? (
          <p className="share-empty">No links yet. Make one above and it’s copied, ready to paste into a text or email.</p>
        ) : (
          <ul>
            {live.map((s) => (
              <li key={s.id} className={`share-link${fresh === s.id ? ' is-fresh' : ''}`}>
                <div className="share-link-main">
                  <b>{s.label || 'Untitled link'}</b>
                  <span className="share-link-meta">
                    {views(s)} · {s.showPrices ? 'prices shown' : 'prices hidden'} · {s.expiresAt ? `expires ${inFuture(s.expiresAt, serverNow)}` : 'never expires'}
                  </span>
                  <input className="share-link-url" readOnly value={shareUrl(s.token)} aria-label={`Link ${s.label || 'untitled'}`} onFocus={(e) => e.currentTarget.select()} />
                  {copied?.id === s.id && (
                    <span className={`share-copied${copied.ok ? '' : ' warn'}`} role="status">
                      {copied.ok ? (
                        <>
                          <Check width={13} height={13} /> Link copied
                        </>
                      ) : (
                        'Your browser blocked copying. Select the link above and copy it.'
                      )}
                    </span>
                  )}
                </div>
                <div className="share-link-actions">
                  {confirming === s.id ? (
                    <>
                      <span className="share-confirm">Turn off for everyone?</span>
                      <button type="button" className="btn danger-btn" onClick={() => revoke(s)}>
                        Turn off
                      </button>
                      <button type="button" className="btn" onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn" onClick={() => copy(s)}>
                        <Copy width={14} height={14} /> Copy
                      </button>
                      <a className="btn" href={`#/s/${s.token}`} target="_blank" rel="noopener">
                        Preview
                      </a>
                      <button type="button" className="btn ghost-btn" onClick={() => setConfirming(s.id)}>
                        Turn off
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {old.length > 0 && (
          <details className="share-old">
            <summary>
              {old.length} turned off or expired
            </summary>
            <ul>
              {old.map((s) => (
                <li key={s.id}>
                  <b>{s.label || 'Untitled link'}</b>
                  <span>
                    {s.revokedAt ? `Turned off ${timeAgo(s.revokedAt)}` : `Expired ${timeAgo(s.expiresAt!)}`} · {views(s)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Dialog>
  );
}
