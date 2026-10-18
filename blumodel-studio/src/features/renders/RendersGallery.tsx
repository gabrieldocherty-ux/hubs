/**
 * Every render a showroom made (the team's and visitors'), newest first: the picture, the design,
 * who made it and when, what it cost; open one large, download it, or take it out of the gallery.
 * With no rendering service on the server it says renders are being set up (nothing is charged).
 * Used by RendersPage and, on its own, by the workspace's Renders tab. Fetches
 * GET /api/workspace/renders itself (team only).
 */
import { useCallback, useEffect, useState } from 'react';
import { Download, Trash } from '../../components/Icons';
import { slug } from '../../lib/exporters';
import { rendersApi, type RenderWire, type WorkspaceRenders } from './api';
import { SETTING_UP, cents, plural, when } from './model';
import './renders.css';

const ROLE_LABEL = { owner: 'Owner', staff: 'Team', visitor: 'Visitor' } as const;

function Lightbox({ r, onClose }: { r: RenderWire; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop rn-lightbox" role="dialog" aria-modal="true" aria-label={`Render of ${r.designName}`} onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        {r.imageUrl && <img src={r.imageUrl} alt={`Photoreal rendering of ${r.designName}`} />}
        <figcaption>
          <span>
            {r.designName || 'Untitled design'} · {when(r.createdAt)}
            {r.byName ? ` · ${r.byName}` : ''}
            {r.demo ? ' · demo render' : ''}
          </span>
          <span className="rn-lightbox-actions">
            {r.imageUrl && (
              <a className="btn" href={r.imageUrl} download={`${slug(r.designName) || 'design'}-photoreal.png`}>
                <Download width={15} height={15} aria-hidden="true" /> Download
              </a>
            )}
            <button type="button" className="btn" onClick={onClose} autoFocus>
              Close
            </button>
          </span>
        </figcaption>
      </figure>
    </div>
  );
}

export default function RendersGallery({ title = 'All renders' }: { title?: string }) {
  const [data, setData] = useState<WorkspaceRenders | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<RenderWire | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await rendersApi.workspace());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load the renders.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const more = async () => {
    if (!data?.renders.length || loading) return;
    setLoading(true);
    try {
      const r = await rendersApi.workspace({ before: data.renders[data.renders.length - 1].createdAt });
      setData({ ...data, renders: [...data.renders, ...r.renders], more: r.more });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load more renders.');
    } finally {
      setLoading(false);
    }
  };
  const remove = async (r: RenderWire) => {
    try {
      await rendersApi.hide(r.id);
      setData((d) => (d ? { ...d, renders: d.renders.filter((x) => x.id !== r.id) } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t work. Try again.');
    }
  };

  return (
    <section className="rn-section rn-gallery" aria-label="Renders" data-configured={data ? (data.configured ? '1' : '0') : ''}>
      <h3>{title}</h3>
      {error && (
        <p className="photoreal-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && <p className="empty-note">Loading renders…</p>}
      {data && !data.configured && (
        <p className="rn-banner" role="status">
          <b>{SETTING_UP}.</b> “Make it photoreal” will work in the editor as soon as they’re ready. Nothing is charged until then.
        </p>
      )}
      {data?.configured && data.provider === 'demo' && <p className="rn-banner is-demo">Demo renders: this server stamps the captured view instead of calling the AI.</p>}
      {data && (
        <p className="rn-usage">
          This month: {plural(data.usage.thisMonth, 'render')}, {cents(data.usage.spentThisMonthCents)} of credits
          {data.usage.visitorToday ? ` · ${plural(data.usage.visitorToday, 'visitor render')} today` : ''}
          {data.usage.failedThisMonth ? ` · ${data.usage.failedThisMonth} didn’t work (credits returned)` : ''}. One render is {cents(data.costCents)}.
        </p>
      )}
      {data && data.renders.length === 0 && <p className="empty-note">No renders yet. Open a design in the editor and choose “Make it photoreal”.</p>}
      {data && data.renders.length > 0 && (
        <ul className="rn-grid">
          {data.renders.map((r) => (
            <li key={r.id} className={`rn-item is-${r.status}`}>
              <button type="button" className="rn-item-art" onClick={() => r.imageUrl && setOpen(r)} disabled={!r.imageUrl} aria-label={r.imageUrl ? `Open the render of ${r.designName}` : `${r.designName}: ${r.status}`}>
                {r.imageUrl ? <img src={r.imageUrl} alt="" loading="lazy" /> : <span>{r.status === 'pending' ? 'Rendering…' : 'Didn’t work'}</span>}
                {r.demo && <i className="rn-tag">Demo</i>}
              </button>
              <div className="rn-item-meta">
                <b title={r.designName}>{r.designName || 'Untitled design'}</b>
                <span>
                  {when(r.createdAt)} · {r.byName ?? ROLE_LABEL[r.byRole]}
                  {r.byRole === 'visitor' ? ' (visitor)' : ''}
                </span>
                <span>{r.status === 'refunded' ? 'Refunded' : r.status === 'failed' ? 'Credits returned' : r.status === 'pending' ? 'In progress' : cents(r.costCents)}</span>
              </div>
              {r.status !== 'pending' && (
                <button type="button" className="icon-btn rn-item-remove" onClick={() => void remove(r)} aria-label={`Remove the render of ${r.designName} from ${when(r.createdAt)}`} title="Remove">
                  <Trash width={15} height={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {data?.more && (
        <button type="button" className="btn rn-more" onClick={() => void more()} disabled={loading}>
          Show more renders
        </button>
      )}
      {open && <Lightbox r={open} onClose={() => setOpen(null)} />}
    </section>
  );
}
