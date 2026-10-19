import { Suspense, useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Close } from '../../components/Icons';
import { ApiError } from '../../lib/api';
import { useSession } from '../../store/useSession';
import { useCatalog } from '../../store/useCatalog';
import { productType } from '../../data/productTypes';
import type { Product } from '../../types';
import type { FileWire, GlbMeta, OrderStatus } from '../../types/platform';
import { ProductStage } from '../viewer';
import { money } from '../../lib/money';
import { ordersApi, type Allowance, type GlbReport, type ModelGrant, type OrderDetail, type OrderItemWire, type QueueOrder, type StudioFilter } from './api';
import { briefSize, modelsLeftText, orderPrice, pricingLabel, resetDay, shortDate, sizeText, statusLabel } from './model';
import { formatUpc, UPC_FORMAT_LABEL } from './upc';
import { StatusPill, Timeline } from './parts';
import { StudioProductRequests } from './StudioProductRequests';
import './orders.css';

const FILTERS: { id: StudioFilter; label: string; count?: OrderStatus[] }[] = [
  { id: 'active', label: 'Active', count: ['paid', 'in_progress', 'revision_requested'] },
  { id: 'paid', label: 'To start', count: ['paid'] },
  { id: 'in_progress', label: 'In progress', count: ['in_progress'] },
  { id: 'revision_requested', label: 'Revisions', count: ['revision_requested'] },
  { id: 'delivered', label: 'Delivered', count: ['delivered'] },
  { id: 'completed', label: 'Completed', count: ['completed'] },
  { id: 'refunded', label: 'Refunded', count: ['refunded'] },
  { id: 'all', label: 'All' },
];
const REFUNDABLE: OrderStatus[] = ['paid', 'in_progress', 'revision_requested', 'delivered'];
const MATERIALS = ['paint', 'metal', 'wood', 'stone', 'ceramic', 'glass', 'fabric', 'leather', 'panel', 'foliage'] as const;

/**
 * `#/admin/studio` (PRODUCT_SPEC §7.6): the custom-model queue, due date first, with a detail
 * drawer (brief, private reference photos, timeline, notes) where the studio starts, notes and
 * delivers: GLB + thumbnail upload, the GLB report, then the product preview. Requests included in
 * the Contractor plan can be cancelled before work starts (the models go back to the contractor's
 * allowance); admins grant extra models for the current period, and refund orders paid before.
 */
export default function AdminStudioTab() {
  const role = useSession((s) => s.user?.role);
  const [filter, setFilter] = useState<StudioFilter>('active');
  const [rows, setRows] = useState<QueueOrder[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<OrderStatus, number>>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (f: StudioFilter) => {
    setError(null);
    try {
      const r = await ordersApi.queue(f);
      setRows(r.orders);
      setCounts(r.counts);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the queue.');
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const now = Date.now();
  const countOf = (f: (typeof FILTERS)[number]) =>
    f.count ? f.count.reduce((s, k) => s + (counts[k] ?? 0), 0) : FILTERS.slice(1, 7).reduce((s, x) => s + (x.count ?? []).reduce((a, k) => a + (counts[k] ?? 0), 0), 0);

  return (
    <div className="ord-studio">
      <h1>Studio queue</h1>
      <StudioProductRequests />
      <h2 className="ord-legacy-head">Custom-model orders from before the showroom pivot</h2>
      <div className="chips ord-studio-chips" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className={f.id === filter ? 'chip on' : 'chip'} aria-pressed={f.id === filter} onClick={() => setFilter(f.id)}>
            {f.label} <span className="ord-chip-n">{countOf(f)}</span>
          </button>
        ))}
      </div>
      {role === 'admin' && (
        <details className="ord-grant-lookup">
          <summary>Extra models for a contractor</summary>
          <GrantLookup />
        </details>
      )}
      {error && <div className="auth-error">{error}</div>}
      {!rows && !error && <div className="ord-loading">Loading the queue…</div>}
      {rows && rows.length === 0 && <p className="empty-note">Nothing here. Contractors’ requests show up in this queue, oldest due date first.</p>}
      {rows && rows.length > 0 && (
        <table className="admin-table ord-queue">
          <thead>
            <tr>
              <th>Due</th>
              <th>Order</th>
              <th>Terms</th>
              <th>Status</th>
              <th>Assignee</th>
              <th className="ord-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const overdue = !!o.dueAt && o.dueAt < now && ['paid', 'in_progress', 'revision_requested'].includes(o.status);
              return (
                <tr key={o.id} className={open === o.id ? 'ord-q-row on' : 'ord-q-row'} onClick={() => setOpen(o.id)}>
                  <td className={overdue ? 'ord-q-due ord-overdue' : 'ord-q-due'}>
                    <span className="ord-q-label">Due </span>
                    {shortDate(o.dueAt)}
                    {overdue ? ' · overdue' : ''}
                  </td>
                  <td className="ord-q-order">
                    <div className="ord-q-title">
                      <button type="button" onClick={(e) => (e.stopPropagation(), setOpen(o.id))}>
                        {o.title}
                      </button>
                      <span className="ord-buyer">
                        {o.buyer?.name ?? 'Deleted account'}
                        {o.target === 'brand' ? ` · brand: ${o.brandName ?? '?'}` : o.target === 'contractor' ? ' · contractor' : ''}
                        {o.items.length > 1 ? ` · ${o.delivered}/${o.items.length} delivered` : ''}
                      </span>
                      <QueueUpcs order={o} />
                    </div>
                  </td>
                  <td className="ord-q-tier">
                    {o.items.length > 1 ? `${o.items.length} products · ` : ''}
                    {pricingLabel(o)}
                    {o.extras.rush ? ' · rush' : ''}
                  </td>
                  <td className="ord-q-status">
                    <StatusPill status={o.status} label={statusLabel(o, true)} />
                  </td>
                  <td className="ord-q-who">
                    <span className="ord-q-label">Assignee: </span>
                    {o.assignee ?? '—'}
                  </td>
                  <td className="ord-num ord-q-amt">
                    {o.provider === 'demo' && <span className="ord-tag">Demo</span>} <span className={o.pricing !== 'plan' ? 'mono' : o.status === 'cancelled' ? 'muted' : 'ord-included'}>{orderPrice(o)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {open && <StudioDrawer id={open} isAdmin={role === 'admin'} onClose={() => setOpen(null)} onChanged={() => void load(filter)} />}
    </div>
  );
}

// ─── The drawer ─────────────────────────────────────────────────────────

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Drawer({ title, onClose, children, head }: { title: string; onClose: () => void; children: ReactNode; head?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      const el = ref.current;
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const [a, z] = [items[0]!, items[items.length - 1]!];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      back?.focus?.();
    };
  }, []);
  return (
    <>
      <div className="ord-drawer-backdrop" onMouseDown={onClose} />
      <div ref={ref} className="ord-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="ord-drawer-head">
          <div>{head}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Close />
          </button>
        </div>
        <div className="ord-drawer-body">{children}</div>
      </div>
    </>
  );
}

function StudioDrawer({ id, isAdmin, onClose, onChanged }: { id: string; isAdmin: boolean; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const catalog = useCatalog((s) => s.byId);
  const [confirmRefund, setConfirmRefund] = useState(false);
  const [refundNote, setRefundNote] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelNote, setCancelNote] = useState('');
  const [delivered, setDelivered] = useState<{ product: Product; report: GlbReport } | null>(null);

  useEffect(() => {
    let live = true;
    ordersApi
      .get(id)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load the order.'));
    return () => {
      live = false;
    };
  }, [id]);

  const run = async (key: string, fn: () => Promise<OrderDetail>) => {
    setBusy(key);
    setError(null);
    try {
      setData(await fn());
      onChanged();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That didn’t work.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const sendNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    if (await run('note', () => ordersApi.note(id, note.trim()))) setNote('');
  };

  const o = data?.order;
  const head = o ? (
    <>
      <span className="eyebrow">
        {o.target === 'brand' ? `Brand order · ${o.brandName ?? ''}` : o.target === 'contractor' ? 'Contractor order' : 'Customer order'}
        {o.pricing === 'plan' ? ' · included in the Contractor plan' : ''}
      </span>
      <span className="ord-id mono">{o.id}</span>
      <h2>{o.title}</h2>
      <div className="ord-head-meta">
        <StatusPill status={o.status} label={statusLabel(o, true)} />
        <span className="mono">{orderPrice(o)}</span>
        {o.provider === 'demo' && <span className="ord-tag">Demo payment</span>}
        {o.dueAt && <span className="muted">Due {shortDate(o.dueAt)}</span>}
      </div>
      {data?.buyer && (
        <p className="ord-buyer">
          {data.buyer.name} · {data.buyer.email}
          {data.assignee ? ` · assigned to ${data.assignee}` : ''}
        </p>
      )}
    </>
  ) : (
    <h2>Order</h2>
  );

  return (
    <Drawer title={o ? `Order: ${o.title}` : 'Order'} onClose={onClose} head={head}>
      {!data && !error && <div className="ord-loading">Loading…</div>}
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      {o && data && (
        <>
          <section>
            <div className="ord-actions">
              {(o.status === 'paid' || o.status === 'revision_requested') && (
                <button className="btn primary" onClick={() => void run('start', () => ordersApi.start(id))} disabled={!!busy}>
                  {busy === 'start' ? 'Starting…' : o.status === 'revision_requested' ? 'Start the revision' : 'Start (assign to me)'}
                </button>
              )}
              {o.pricing === 'plan' && o.status === 'paid' && !confirmCancel && (
                <button className="btn" onClick={() => setConfirmCancel(true)} disabled={!!busy}>
                  Cancel request…
                </button>
              )}
              {isAdmin && o.pricing !== 'plan' && REFUNDABLE.includes(o.status) && !confirmRefund && (
                <button className="btn" onClick={() => setConfirmRefund(true)} disabled={!!busy}>
                  Refund…
                </button>
              )}
            </div>
            {confirmRefund && (
              <div className="ord-deliver">
                <b>
                  Refund {money(o.amountCents, o.currency)}
                  {o.provider === 'demo' ? ' (demo: nothing moves)' : ' through Stripe'}?
                </b>
                <p className="fine">The order becomes refunded. A delivered model stays in kitchens that use it, but leaves the buyer’s catalog.</p>
                <label className="field">
                  <span>
                    Note <em>(optional, shown to the buyer)</em>
                  </span>
                  <input value={refundNote} maxLength={2000} onChange={(e) => setRefundNote(e.target.value)} />
                </label>
                <div className="ord-actions">
                  <button className="btn" onClick={() => setConfirmRefund(false)}>
                    Keep it
                  </button>
                  <button
                    className="btn primary"
                    disabled={busy === 'refund'}
                    onClick={async () => {
                      if (await run('refund', () => ordersApi.refund(id, refundNote.trim()))) setConfirmRefund(false);
                    }}
                  >
                    {busy === 'refund' ? 'Refunding…' : 'Refund'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {confirmCancel && (
            <section className="ord-deliver">
              <b>Cancel this request?</b>
              <p className="fine">
                Only before work starts. {o.items.length === 1 ? 'Its model goes' : `Its ${o.items.length} models go`} back to the contractor’s allowance for that month, and they see your reason on the timeline.
              </p>
              <label className="field">
                <span>
                  Reason <em>(shown to the contractor)</em>
                </span>
                <input value={cancelNote} maxLength={2000} onChange={(e) => setCancelNote(e.target.value)} placeholder="e.g. We can’t source enough of this product to model it." />
              </label>
              <div className="ord-actions">
                <button className="btn" onClick={() => setConfirmCancel(false)}>
                  Keep it
                </button>
                <button
                  className="btn primary"
                  disabled={busy === 'cancel'}
                  onClick={async () => {
                    if (await run('cancel', () => ordersApi.studioCancel(id, cancelNote.trim()))) setConfirmCancel(false);
                  }}
                >
                  {busy === 'cancel' ? 'Cancelling…' : 'Cancel request'}
                </button>
              </div>
            </section>
          )}

          {data.buyerAllowance && data.buyer && (
            <section>
              <h3>Contractor’s models</h3>
              <AllowanceSummary allowance={data.buyerAllowance} grants={data.buyerAllowance.grants} />
              {isAdmin && (
                <GrantForm
                  userId={data.buyer.id}
                  allowance={data.buyerAllowance}
                  onGranted={(a, grants) => setData((d) => (d ? { ...d, buyerAllowance: { ...a, grants } } : d))}
                />
              )}
            </section>
          )}

          {o.status === 'in_progress' && (
            <section>
              <h3>Deliver</h3>
              {o.items.map((it) => (
                <DeliverForm
                  key={`${it.idx}-${it.deliverableProductId ?? ''}`}
                  orderId={id}
                  item={it}
                  multi={o.items.length > 1}
                  includedFinishes={o.finishesPerModel}
                  onDelivered={(r) => {
                    setData(r);
                    setDelivered({ product: r.product, report: r.report });
                    onChanged();
                  }}
                />
              ))}
            </section>
          )}

          {delivered && (
            <section>
              <h3>Delivered: {delivered.product.name}</h3>
              <div className="ord-stage">
                <Suspense fallback={<div className="ord-stage-wait">Loading the preview…</div>}>
                  <ProductStage product={delivered.product} height={280} showDims />
                </Suspense>
              </div>
              {delivered.report.warnings.length > 0 && <Report report={delivered.report} />}
            </section>
          )}

          {data.deliverables.length > 0 && !delivered && (
            <section>
              <h3>Delivered model{data.deliverables.length > 1 ? 's' : ''}</h3>
              {data.deliverables.map((p) => (
                <div key={p.id} className="ord-deliverable">
                  <div className="ord-stage">
                    <Suspense fallback={<div className="ord-stage-wait">Loading the preview…</div>}>
                      <ProductStage product={p} height={240} />
                    </Suspense>
                  </div>
                  <p className="fine">
                    {p.name} · {p.status ?? ''} · {p.visibility ?? ''}
                  </p>
                </div>
              ))}
            </section>
          )}

          <section>
            <h3>Brief</h3>
            {o.items.map((it) => (
              <div key={it.idx} className="ord-card ord-brief">
                <div className="ord-brief-head">
                  <b>
                    {o.items.length > 1 ? `${it.idx + 1}. ` : ''}
                    {it.brief.name}
                  </b>
                  <span>
                    {o.pricing === 'plan' ? 'Included' : o.pricing === 'pack' ? (o.packs > 1 ? `Pack ${it.pack ?? 1}` : 'Model pack') : pricingLabel({ tier: it.tier })}
                    {it.extraFinishes ? ` + ${it.extraFinishes} finishes` : ''}
                  </span>
                </div>
                <dl className="ord-dl">
                  <div>
                    <dt>Type</dt>
                    <dd>{productType(it.brief.productTypeId)?.label ?? it.brief.productTypeId}</dd>
                  </div>
                  {it.brief.brand && (
                    <div>
                      <dt>Brand</dt>
                      <dd>{it.brief.brand}</dd>
                    </div>
                  )}
                  <div>
                    <dt>UPC</dt>
                    <dd className={it.brief.upc ? 'mono ord-upc-value' : undefined}>
                      {it.brief.upc ? `${formatUpc(it.brief.upc)}${it.brief.upcFormat ? ` (${UPC_FORMAT_LABEL[it.brief.upcFormat]})` : ''}` : it.brief.barcodeFileId ? 'Read it from the barcode photo below' : 'Not given'}
                    </dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>{briefSize(it.brief)}</dd>
                  </div>
                  {it.brief.refProductId && (
                    <div>
                      <dt>From</dt>
                      <dd>
                        <a href={`#/p/${it.brief.refProductId}`} target="_blank" rel="noreferrer">
                          {catalog.get(it.brief.refProductId)?.name ?? it.brief.refProductId}
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
                {it.brief.notes && <p className="ord-notes">{it.brief.notes}</p>}
              </div>
            ))}
            {data.references.length > 0 && (
              <>
                <span className="mini-label">Reference photos (private)</span>
                <ul className="ord-thumbs ord-thumbs--static">
                  {data.references.map((f) => (
                    <li key={f.id}>
                      <a href={f.url} target="_blank" rel="noreferrer" aria-label={`Open ${f.originalName || 'reference photo'}`}>
                        <img src={f.url} alt={f.originalName || 'Reference photo'} />
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section>
            <h3>Timeline and notes</h3>
            <Timeline events={data.events} />
            <form className="ord-note-form" onSubmit={sendNote}>
              <label className="field">
                <span>Add a note (the buyer sees it)</span>
                <textarea className="ord-textarea" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <button className="btn" type="submit" disabled={!note.trim() || busy === 'note'}>
                {busy === 'note' ? 'Adding…' : 'Add note'}
              </button>
            </form>
          </section>
        </>
      )}
    </Drawer>
  );
}

// ─── Delivery ───────────────────────────────────────────────────────────

const slug = (s: string, i: number) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || `finish-${i + 1}`;

interface FinishRow {
  name: string;
  hex: string;
  material: (typeof MATERIALS)[number];
}

/** The queue row's UPCs, one per product (the studio looks the products up by them). */
function QueueUpcs({ order }: { order: QueueOrder }) {
  const codes = order.items.map((it) => (it.brief.upc ? formatUpc(it.brief.upc) : it.brief.barcodeFileId ? 'barcode photo' : null));
  const given = codes.filter(Boolean) as string[];
  if (!given.length) return null;
  const shown = given.slice(0, 2);
  return (
    <span className="ord-q-upcs" title={codes.map((c, i) => `${i + 1}. ${c ?? 'no UPC'}`).join('\n')}>
      <span className="ord-q-label">UPC </span>
      <span className="mono">{shown.join(', ')}</span>
      {given.length > shown.length ? ` +${given.length - shown.length} more` : ''}
      {given.length < codes.length ? ` · ${codes.length - given.length} without` : ''}
    </span>
  );
}

type Dims = { widthIn: number | null; depthIn: number | null; heightIn: number | null };

function DeliverForm({
  orderId,
  item,
  multi,
  includedFinishes,
  onDelivered,
}: {
  orderId: string;
  item: OrderItemWire;
  multi: boolean;
  /** Finishes included per model (a plan request or a pack order); null on an order priced per tier. */
  includedFinishes: number | null;
  onDelivered: (r: OrderDetail & { product: Product; report: GlbReport }) => void;
}) {
  const [model, setModel] = useState<FileWire | null>(null);
  const [thumb, setThumb] = useState<FileWire | null>(null);
  const [report, setReport] = useState<GlbReport | null>(null);
  const [uploading, setUploading] = useState<'model' | 'image' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(item.brief.name);
  // The request's size where it gave one; the rest comes from the model once it's uploaded.
  const [dims, setDims] = useState<Dims>({ widthIn: item.brief.widthIn ?? null, depthIn: item.brief.depthIn ?? null, heightIn: item.brief.heightIn ?? null });
  const [finishes, setFinishes] = useState<FinishRow[]>([{ name: 'As modelled', hex: '#d6d0c6', material: 'paint' }]);

  const up = async (e: ChangeEvent<HTMLInputElement>, kind: 'model' | 'image') => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    setUploading(kind);
    try {
      const { file } = await ordersApi.uploadFile(f, kind, f.name);
      if (kind === 'model') {
        setModel(file);
        // Fill any size the request didn't give from the model's measured size.
        const bb = (file.meta as GlbMeta | undefined)?.bboxIn;
        const r2 = (n: number) => Math.round(n * 100) / 100;
        if (bb) setDims((d) => ({ widthIn: d.widthIn ?? r2(bb.w), depthIn: d.depthIn ?? r2(bb.d), heightIn: d.heightIn ?? r2(bb.h) }));
        setReport((await ordersApi.report(orderId, item.idx, file.id)).report);
      } else setThumb(file);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${f.name} didn’t upload.`);
    } finally {
      setUploading(null);
    }
  };

  const useModelSize = () => {
    const bb = (model?.meta as GlbMeta | undefined)?.bboxIn;
    if (bb) setDims({ widthIn: Math.round(bb.w * 100) / 100, depthIn: Math.round(bb.d * 100) / 100, heightIn: Math.round(bb.h * 100) / 100 });
  };

  const deliver = async () => {
    if (!model || !thumb) return;
    setBusy(true);
    setError(null);
    try {
      const r = await ordersApi.deliver(orderId, {
        item: item.idx,
        modelFileId: model.id,
        thumbFileId: thumb.id,
        name: name.trim() || item.brief.name,
        // Only the sizes that are known; the server falls back to the model's measured size.
        dims: {
          ...(dims.widthIn ? { widthIn: dims.widthIn } : {}),
          ...(dims.depthIn ? { depthIn: dims.depthIn } : {}),
          ...(dims.heightIn ? { heightIn: dims.heightIn } : {}),
        },
        finishes: finishes.map((f, i) => ({ id: slug(f.name, i), name: f.name.trim() || `Finish ${i + 1}`, hex: f.hex, material: f.material })),
      });
      onDelivered(r);
    } catch (err) {
      const fe = err instanceof ApiError ? (err.body as { errors?: { message: string }[] } | undefined)?.errors?.[0]?.message : undefined;
      setError(fe ?? (err instanceof ApiError ? err.message : 'The delivery failed.'));
    } finally {
      setBusy(false);
    }
  };

  const setFinish = (i: number, patch: Partial<FinishRow>) => setFinishes((l) => l.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="ord-deliver">
      <b>
        {multi ? `${item.idx + 1}. ` : ''}
        {item.brief.name}
        {item.deliverableProductId ? ' · delivered (upload again to replace)' : ''}
      </b>
      <div className="ord-deliver-files">
        <label className="ord-file">
          <b>GLB model</b>
          <span className="ord-file-name">{model ? `${model.originalName || 'model.glb'} · ${(model.sizeBytes / 1_048_576).toFixed(1)} MB` : 'Not uploaded'}</span>
          <input type="file" accept=".glb,model/gltf-binary" onChange={(e) => void up(e, 'model')} disabled={!!uploading} aria-label={`GLB model for ${item.brief.name}`} />
        </label>
        <label className="ord-file">
          <b>Thumbnail</b>
          <span className="ord-file-name">{thumb ? thumb.originalName || 'thumbnail' : 'Not uploaded'}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void up(e, 'image')} disabled={!!uploading} aria-label={`Thumbnail for ${item.brief.name}`} />
        </label>
      </div>
      {uploading && <p className="muted">Uploading the {uploading === 'model' ? 'model' : 'thumbnail'}…</p>}
      {report && <Report report={report} onUseModelSize={useModelSize} />}
      <label className="field">
        <span>Product name</span>
        <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="ord-dims">
        {(['widthIn', 'depthIn', 'heightIn'] as const).map((k) => (
          <label key={k} className="field">
            <span>{k === 'widthIn' ? 'Width' : k === 'depthIn' ? 'Depth' : 'Height'} (in)</span>
            <input
              type="number"
              step="0.25"
              min={0.25}
              value={dims[k] ?? ''}
              placeholder="From the model"
              onChange={(e) => setDims((d) => ({ ...d, [k]: e.target.value === '' ? null : Number(e.target.value) }))}
            />
          </label>
        ))}
      </div>
      <span className="mini-label">Finishes{includedFinishes ? ` (each model includes up to ${includedFinishes})` : ''}</span>
      {finishes.map((f, i) => (
        <div key={i} className="ord-finish-row">
          <label className="field">
            <span>Name</span>
            <input value={f.name} maxLength={40} onChange={(e) => setFinish(i, { name: e.target.value })} />
          </label>
          <label className="field">
            <span>Colour</span>
            <input type="color" value={f.hex} onChange={(e) => setFinish(i, { hex: e.target.value })} />
          </label>
          <label className="field">
            <span>Material</span>
            <select className="ord-select" value={f.material} onChange={(e) => setFinish(i, { material: e.target.value as FinishRow['material'] })}>
              {MATERIALS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
      ))}
      <div className="ord-actions">
        {finishes.length < (includedFinishes ?? 24) && (
          <button type="button" className="btn" onClick={() => setFinishes((l) => [...l, { name: '', hex: '#888888', material: 'paint' }])}>
            + Finish
          </button>
        )}
        {finishes.length > 1 && (
          <button type="button" className="btn" onClick={() => setFinishes((l) => l.slice(0, -1))}>
            Remove last finish
          </button>
        )}
      </div>
      {error && <div className="auth-error">{error}</div>}
      <button type="button" className="btn primary" disabled={!model || !thumb || busy || !!uploading} onClick={() => void deliver()}>
        {busy ? 'Delivering…' : item.deliverableProductId ? 'Deliver the revision' : 'Deliver'}
      </button>
      {(!model || !thumb) && <p className="fine">Upload the GLB and a thumbnail to deliver.</p>}
    </div>
  );
}

function Report({ report, onUseModelSize }: { report: GlbReport; onUseModelSize?: () => void }) {
  return (
    <div className="ord-report" aria-label="GLB report">
      <b>GLB report</b> · {(report.sizeBytes / 1_048_576).toFixed(2)} MB · {report.triangles?.toLocaleString('en-US') ?? '?'} triangles · slots: {report.slots.length ? report.slots.join(', ') : 'none'}
      {report.bboxIn && (
        <div>
          Model size: {sizeText(report.bboxIn.w, report.bboxIn.d, report.bboxIn.h)}
          {onUseModelSize && (
            <>
              {' '}
              <button type="button" className="btn" onClick={onUseModelSize}>
                Use the model’s size
              </button>
            </>
          )}
        </div>
      )}
      {report.warnings.length > 0 ? (
        <ul>
          {report.warnings.map((w, i) => (
            <li key={i} className="ord-warn">
              ⚠ {w}
            </li>
          ))}
        </ul>
      ) : (
        <div>✓ No warnings.</div>
      )}
    </div>
  );
}

// ─── The Contractor plan's included models (admin) ──────────────────────

/** "1 of 3 models left this month - resets November 15 (2 extra granted)". */
function AllowanceSummary({ allowance: a, grants }: { allowance: Allowance; grants: ModelGrant[] }) {
  if (!a.active) return <p className="fine">Not on the Contractor plan now: nothing new can be requested. Requests already sent are still delivered.</p>;
  return (
    <>
      <p>
        <b>
          {modelsLeftText(a)} - resets {resetDay(a.resetsAt)}
        </b>
        <span className="muted">
          {' '}
          · {a.used} used of {a.included} included{a.granted ? ` + ${a.granted} extra` : ''}
        </span>
      </p>
      {grants.length > 0 && (
        <ul className="ord-grants">
          {grants.map((g) => (
            <li key={g.id} className="fine">
              +{g.models} on {shortDate(g.createdAt)}
              {g.note ? `: ${g.note}` : ''}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Admin: give a contractor extra models for their current period only (audit-logged on the server). */
function GrantForm({ userId, allowance, onGranted }: { userId: string; allowance: Allowance; onGranted: (a: Allowance, grants: ModelGrant[]) => void }) {
  const [models, setModels] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!allowance.active) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await ordersApi.grantModels({ userId, models, note: note.trim() });
      onGranted(r.allowance, r.grants);
      setMsg({ ok: true, text: `Granted ${models} extra model${models === 1 ? '' : 's'} until ${resetDay(r.allowance.resetsAt)}.` });
      setNote('');
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'That didn’t work.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="ord-grant-form" onSubmit={submit}>
      <label className="field">
        <span>Extra models this month</span>
        <input type="number" min={1} max={50} value={models} onChange={(e) => setModels(Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 1))))} />
      </label>
      <label className="field">
        <span>
          Note <em>(for the audit log)</em>
        </span>
        <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Launch week: their first cabinet line" />
      </label>
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Granting…' : 'Grant'}
      </button>
      {msg && <p className={msg.ok ? 'fine' : 'auth-error'}>{msg.text}</p>}
    </form>
  );
}

/** Admin: find a contractor by email, see where they stand, grant extra models. */
function GrantLookup() {
  const [email, setEmail] = useState('');
  const [found, setFound] = useState<{ user: { id: string; email: string; name: string }; allowance: Allowance; grants: ModelGrant[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const look = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFound(null);
    try {
      setFound(await ordersApi.modelAllowance({ email: email.trim() }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not look that account up.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ord-grant-box">
      <form className="ord-grant-form" onSubmit={look}>
        <label className="field">
          <span>Contractor’s email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </label>
        <button className="btn" type="submit" disabled={busy || !email.trim()}>
          {busy ? 'Looking…' : 'Look up'}
        </button>
      </form>
      {error && <p className="auth-error">{error}</p>}
      {found && (
        <>
          <p className="fine">
            {found.user.name} · {found.user.email}
          </p>
          <AllowanceSummary allowance={found.allowance} grants={found.grants} />
          <GrantForm userId={found.user.id} allowance={found.allowance} onGranted={(allowance, grants) => setFound((f) => (f ? { ...f, allowance, grants } : f))} />
        </>
      )}
    </div>
  );
}
