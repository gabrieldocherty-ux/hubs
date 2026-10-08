import { Suspense, useCallback, useEffect, useState } from 'react';
import { ProductStage } from '../viewer';
import { ApiError } from '../../lib/api';
import { money } from '../../lib/format';
import { timeAgo } from '../../store/useSession';
import { Alert, Check, Close } from '../../components/Icons';
import { brandApi, type AdminBrand, type GlbReport, type PagePreview, type ReviewItem } from './api';
import { needsDemoTag } from './logic';
import { NoteDialog } from './NoteDialog';
import { PublicBrandView } from './PublicBrandView';
import './brands.css';

type Pending = { kind: 'page'; brand: AdminBrand } | { kind: 'product'; item: ReviewItem };

/**
 * `#/admin/moderation` (BRAND_PAGE §9): brand-page applications (business details, preview,
 * Approve → Live + Verified, or Reject with a note) and submitted products (GLB report, preview,
 * a field-level diff against the live version, Approve / Reject with a note).
 */
export default function AdminModerationTab() {
  const [data, setData] = useState<{ brands: AdminBrand[]; products: ReviewItem[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Pending | null>(null);
  const [preview, setPreview] = useState<PagePreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await brandApi.moderation();
      setData(r);
      setError(null);
      setSelected((s) => (s && r.products.some((p) => p.id === s) ? s : (r.products[0]?.id ?? null)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the queue.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setFlash(null);
    try {
      await fn();
      setFlash(done);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That didn’t work.');
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) return <div className="auth-error">{error}</div>;
  if (!data) return <div className="screen-msg">Loading the queue…</div>;

  const item = data.products.find((p) => p.id === selected) ?? null;

  return (
    <div className="mod">
      <h1>Moderation</h1>
      {flash && (
        <div className="auth-ok" role="status">
          {flash}
        </div>
      )}
      {error && <div className="auth-error">{error}</div>}

      <section className="admin-card mod-section" aria-labelledby="mod-pages">
        <span className="eyebrow" id="mod-pages">
          Brand pages waiting for review · {data.brands.length}
        </span>
        {data.brands.length === 0 ? (
          <p className="empty-note">No applications waiting.</p>
        ) : (
          <div className="mod-pages">
            {data.brands.map((b) => (
              <article key={b.id} className="mod-page">
                <div className="mod-page-main">
                  <h3>
                    {b.name} {needsDemoTag(b) && <span className="tag">Demo</span>}
                  </h3>
                  {b.tagline && <p className="muted">{b.tagline}</p>}
                  <dl className="mod-facts">
                    <dt>Company</dt>
                    <dd>{b.company?.company ?? '—'}</dd>
                    <dt>Website</dt>
                    <dd>{b.company?.website ? <a href={b.company.website} target="_blank" rel="noopener nofollow noreferrer">{b.company.website}</a> : '—'}</dd>
                    <dt>Phone</dt>
                    <dd>{b.company?.phone || '—'}</dd>
                    <dt>Email</dt>
                    <dd>{b.company?.email || '—'}</dd>
                    <dt>Service area</dt>
                    <dd>{b.company?.serviceArea || '—'}</dd>
                    <dt>Account</dt>
                    <dd>
                      {b.owner ? `${b.owner.name} · ${b.owner.email}` : '—'} {b.planActive === false && <span className="tag warn">Plan lapsed</span>}
                    </dd>
                    <dt>Address</dt>
                    <dd className="mono">#/b/{b.slug}</dd>
                    <dt>Submitted</dt>
                    <dd>{b.submittedAt ? timeAgo(b.submittedAt) : '—'}</dd>
                  </dl>
                  {b.about && <p className="mod-about">{b.about}</p>}
                </div>
                <div className="mod-actions">
                  <button className="btn" onClick={() => void brandApi.adminPreview(b.id).then(setPreview).catch(() => setError('Could not load the preview.'))}>
                    Preview page
                  </button>
                  <button className="btn" onClick={() => setRejecting({ kind: 'page', brand: b })} disabled={busy !== null}>
                    Reject…
                  </button>
                  <button className="btn primary" onClick={() => void act(`page:${b.id}`, () => brandApi.approvePage(b.id), `${b.name} is live with a Verified contractor badge.`)} disabled={busy !== null}>
                    {busy === `page:${b.id}` ? 'Approving…' : 'Approve and verify'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="admin-card mod-section" aria-labelledby="mod-products">
        <span className="eyebrow" id="mod-products">
          Products waiting for review · {data.products.length}
        </span>
        {data.products.length === 0 ? (
          <p className="empty-note">No products waiting.</p>
        ) : (
          <div className="mod-split">
            <ul className="mod-queue" role="listbox" aria-label="Submitted products">
              {data.products.map((p) => (
                <li key={p.id}>
                  <button role="option" aria-selected={p.id === selected} className={p.id === selected ? 'on' : ''} onClick={() => setSelected(p.id)}>
                    <b>{p.working.name}</b>
                    <span>
                      {p.brand?.name ?? '—'} · {p.live ? 'edit to a live product' : 'new'}
                    </span>
                    <span className="muted">{p.submittedAt ? timeAgo(p.submittedAt) : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
            {item && (
              <div className="mod-detail">
                <div className="mod-detail-head">
                  <div>
                    <span className="eyebrow">
                      {item.brand?.name} · {item.brand?.kind === 'contractor' ? 'contractor brand' : 'partner brand'}
                      {item.brand && item.brand.pageStatus !== 'live' ? ` · page ${item.brand.pageStatus.replace('_', ' ')}` : ''}
                    </span>
                    <h2>{item.working.name}</h2>
                    <p className="muted">
                      {item.working.widthIn}″ w · {item.working.depthIn}″ d · {item.working.heightIn}″ h · {item.working.price > 0 ? money(item.working.price) : 'price on request'}
                    </p>
                  </div>
                  <div className="mod-actions">
                    <button className="btn" onClick={() => setRejecting({ kind: 'product', item })} disabled={busy !== null}>
                      Reject…
                    </button>
                    <button className="btn primary" onClick={() => void act(`p:${item.id}`, () => brandApi.approveProduct(item.id), `${item.working.name} approved.`)} disabled={busy !== null}>
                      {busy === `p:${item.id}` ? 'Approving…' : 'Approve'}
                    </button>
                  </div>
                </div>
                <div className="mod-detail-grid">
                  <div className="mod-stage">
                    <Suspense fallback={<div className="screen-msg">Loading the preview…</div>}>
                      <ProductStage key={item.id} product={item.working} showDims height={300} />
                    </Suspense>
                    {(item.working.images?.length ?? 0) > 0 && (
                      <div className="mod-images">
                        {item.working.images!.map((im) => (
                          <img key={im.url} src={im.url} alt={im.alt ?? ''} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <GlbPanel report={item.glb} />
                    <DiffPanel item={item} />
                    {item.history.length > 0 && (
                      <div className="mod-history">
                        <span className="mini-label">History</span>
                        <ul>
                          {item.history.map((h) => (
                            <li key={`${h.at}${h.action}`}>
                              <b>{h.action}</b> {timeAgo(h.at)}
                              {h.note ? `: ${h.note}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {rejecting && (
        <NoteDialog
          title={rejecting.kind === 'page' ? `Reject ${rejecting.brand.name}` : `Reject ${rejecting.item.working.name}`}
          intro={
            rejecting.kind === 'page'
              ? 'Say what needs fixing. The contractor sees this note and can resubmit.'
              : 'Say what needs fixing. The note shows on the product; a live version stays public.'
          }
          action="Reject with this note"
          danger
          onClose={() => setRejecting(null)}
          onSubmit={async (note) => {
            if (rejecting.kind === 'page') await brandApi.rejectPage(rejecting.brand.id, note);
            else await brandApi.rejectProduct(rejecting.item.id, note);
            setFlash('Rejected. The note was sent.');
            await load();
          }}
        />
      )}

      {preview && (
        <div className="modal-backdrop mod-preview-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setPreview(null)}>
          <div className="mod-preview" role="dialog" aria-modal="true" aria-label={`Preview of ${preview.brand.name}`}>
            <div className="brand-preview-bar">
              <span>
                <b>Preview.</b> What homeowners will see once approved.
              </span>
              <button className="icon-btn" onClick={() => setPreview(null)} aria-label="Close preview">
                <Close />
              </button>
            </div>
            <PublicBrandView brand={preview.brand} products={preview.products} preview />
          </div>
        </div>
      )}
    </div>
  );
}

const AXIS: Record<string, string> = { w: 'Width', h: 'Height', d: 'Depth' };

function GlbPanel({ report }: { report: GlbReport | null }) {
  if (!report)
    return (
      <div className="mod-glb">
        <span className="mini-label">3D model</span>
        <p className="muted">No GLB: the product is drawn from its dimensions and photos.</p>
      </div>
    );
  const off = new Set(report.mismatches.map((m) => m.axis));
  return (
    <div className="mod-glb">
      <span className="mini-label">GLB report</span>
      <ul className="mod-glb-list">
        <li>
          <Check width={13} height={13} /> {(report.sizeBytes / 1_048_576).toFixed(2)} MB · {report.triangles?.toLocaleString() ?? '?'} triangles
        </li>
        <li className={report.slots.length ? '' : 'warn'}>
          {report.slots.length ? <Check width={13} height={13} /> : <Alert width={13} height={13} />} {report.slots.length ? `Finish slots: ${report.slots.join(', ')}` : 'No mise_* finish slot: finishes won’t recolour it'}
        </li>
        {(['w', 'h', 'd'] as const).map((k) => {
          const m = report.mismatches.find((x) => x.axis === k);
          const model = report.bboxIn ? Math.round(report.bboxIn[k] * 10) / 10 : null;
          return (
            <li key={k} className={off.has(k) ? 'bad' : ''}>
              {off.has(k) ? <Alert width={13} height={13} /> : <Check width={13} height={13} />} {AXIS[k]}: model {model ?? '?'}″, declared {report.declared[k]}″
              {m ? ` (${Math.round((Math.abs(m.model - m.declared) / m.declared) * 100)}% off)` : ''}
            </li>
          );
        })}
        {report.warnings.map((w) => (
          <li key={w} className="warn">
            <Alert width={13} height={13} /> {w}
          </li>
        ))}
      </ul>
    </div>
  );
}

const show = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = JSON.stringify(v);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
};

function DiffPanel({ item }: { item: ReviewItem }) {
  if (!item.live)
    return (
      <div className="mod-diff">
        <span className="mini-label">New product</span>
        <p className="muted">Nothing is live yet: approving publishes everything shown.</p>
      </div>
    );
  return (
    <div className="mod-diff">
      <span className="mini-label">Changes against the live version</span>
      {item.diff.length === 0 ? (
        <p className="muted">No field changes (re-submitted as it was).</p>
      ) : (
        <div className="brand-table-wrap">
          <table className="brand-table mod-diff-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Live</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {item.diff.map((d) => (
                <tr key={d.field}>
                  <td className="mono">{d.field}</td>
                  <td className="mod-before">{show(d.before)}</td>
                  <td className="mod-after">{show(d.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
