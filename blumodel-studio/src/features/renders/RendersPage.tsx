/**
 * The company workspace's Renders page (docs/SHOWROOM_PIVOT.md §5): the credit balance, what one
 * render costs, when credits expire, this month's use, every render the showroom made (the team's
 * and visitors'), and the credits ledger. Exported for the workspace's Renders tab; it fetches its
 * own data (GET /api/workspace/renders and /api/workspace/credits) and needs only to be on a
 * showroom, signed in as a team member.
 */
import { useCallback, useEffect, useState } from 'react';
import { Download, Trash } from '../../components/Icons';
import { slug } from '../../lib/exporters';
import { rendersApi, type CreditEntry, type RenderWire, type WorkspaceCredits, type WorkspaceRenders } from './api';
import { MONTHLY_CREDIT_CENTS, SETTING_UP, cents, day, entryLabel, plural, rendersLeft, when } from './model';
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
            <button type="button" className="btn" onClick={onClose} data-autofocus>
              Close
            </button>
          </span>
        </figcaption>
      </figure>
    </div>
  );
}

export default function RendersPage() {
  const [data, setData] = useState<WorkspaceRenders | null>(null);
  const [credits, setCredits] = useState<WorkspaceCredits | null>(null);
  const [history, setHistory] = useState<CreditEntry[]>([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<RenderWire | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([rendersApi.workspace(), rendersApi.credits()]);
      setData(r);
      setCredits(c);
      setHistory(c.history);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load the renders.');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const moreRenders = async () => {
    if (!data?.renders.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await rendersApi.workspace({ before: data.renders[data.renders.length - 1].createdAt });
      setData({ ...data, renders: [...data.renders, ...r.renders], more: r.more });
    } finally {
      setLoadingMore(false);
    }
  };
  const moreHistory = async () => {
    if (!history.length || loadingMore) return;
    setLoadingMore(true);
    try {
      const c = await rendersApi.credits({ before: history[history.length - 1].id });
      setHistory([...history, ...c.history]);
    } finally {
      setLoadingMore(false);
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

  if (error && !data) return <div className="rn-page"><p className="photoreal-error" role="alert">{error}</p></div>;
  if (!data || !credits) return <div className="rn-page screen-msg" role="status">Loading renders…</div>;

  const left = rendersLeft(credits.balanceCents, data.costCents);
  return (
    <div className="rn-page" data-configured={data.configured ? '1' : '0'}>
      <header className="rn-head">
        <div>
          <h2>Renders</h2>
          <p>Photoreal AI renderings of your showroom’s designs. Each paid month adds {cents(MONTHLY_CREDIT_CENTS)} of credits, kept for {plural(credits.rolloverMonths, 'month')}.</p>
        </div>
      </header>

      {!data.configured && (
        <p className="rn-banner" role="status">
          <b>{SETTING_UP}.</b> “Make it photoreal” will work in the editor as soon as they’re ready. Nothing is charged until then.
        </p>
      )}
      {data.configured && data.provider === 'demo' && <p className="rn-banner is-demo">Demo renders: this server stamps the captured view instead of calling the AI.</p>}

      <section className="rn-cards" aria-label="Credits">
        <div className="rn-card">
          <span className="rn-card-label">Balance</span>
          <b className="rn-card-value">{cents(credits.balanceCents)}</b>
          <span className="rn-card-sub">about {plural(left, 'render')} at {cents(data.costCents)} each</span>
        </div>
        <div className="rn-card">
          <span className="rn-card-label">Next expiry</span>
          <b className="rn-card-value">{credits.nextExpiry ? cents(credits.nextExpiry.cents) : '—'}</b>
          <span className="rn-card-sub">{credits.nextExpiry ? `on ${day(credits.nextExpiry.at)}, oldest first` : 'nothing is due to expire'}</span>
        </div>
        <div className="rn-card">
          <span className="rn-card-label">This month</span>
          <b className="rn-card-value">{plural(data.usage.thisMonth, 'render')}</b>
          <span className="rn-card-sub">
            {cents(data.usage.spentThisMonthCents)} used{data.usage.visitorToday ? ` · ${plural(data.usage.visitorToday, 'visitor render')} today` : ''}
            {credits.heldCents ? ` · ${cents(credits.heldCents)} in progress` : ''}
          </span>
        </div>
      </section>

      {credits.lots.length > 1 && (
        <section className="rn-section" aria-label="Credits by month">
          <h3>Credits by expiry</h3>
          <ul className="rn-lots">
            {credits.lots.map((l) => (
              <li key={l.id}>
                <span>{l.source === 'monthly' ? 'Monthly credits' : 'Added credits'} from {day(l.createdAt)}</span>
                <span className="mono">
                  {cents(l.remaining)} of {cents(l.cents)} · expires {day(l.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rn-section" aria-label="Renders">
        <h3>All renders</h3>
        {data.renders.length === 0 ? (
          <p className="empty-note">No renders yet. Open a design in the editor and choose “Make it photoreal”.</p>
        ) : (
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
        {data.more && (
          <button type="button" className="btn rn-more" onClick={() => void moreRenders()} disabled={loadingMore}>
            Show more renders
          </button>
        )}
      </section>

      <section className="rn-section" aria-label="Credit history">
        <h3>Credit history</h3>
        {history.length === 0 ? (
          <p className="empty-note">No credits yet. They arrive with the first paid month.</p>
        ) : (
          <div className="rn-table-wrap">
            <table className="rn-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">What</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col" className="num">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((e) => (
                  <tr key={e.id} className={`is-${e.kind}`}>
                    <td>{day(e.at)}</td>
                    <td>
                      {entryLabel(e.kind)}
                      {e.note && e.kind !== 'reserve' && e.kind !== 'charge' ? <span className="rn-note"> · {e.note}</span> : null}
                    </td>
                    <td className="num mono">{e.cents === 0 ? '—' : `${e.cents > 0 ? '+' : ''}${cents(e.cents)}`}</td>
                    <td className="num mono">{cents(e.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {history.length >= 50 && history.length % 50 === 0 && (
          <button type="button" className="btn rn-more" onClick={() => void moreHistory()} disabled={loadingMore}>
            Show older entries
          </button>
        )}
      </section>

      {error && (
        <p className="photoreal-error" role="alert">
          {error}
        </p>
      )}
      {open && <Lightbox r={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
