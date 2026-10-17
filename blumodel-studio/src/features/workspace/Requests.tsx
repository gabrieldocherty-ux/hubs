import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import { amount } from '../../lib/money';
import { hrefFor, navigateHash } from '../../lib/router';
import { useDesignStore } from '../../store/useDesignStore';
import { BarcodeScanDialog, readBarcodeFromImage, useCanScan } from '../orders/BarcodeScan';
import { formatUpc, upcWhileTyping } from '../orders/upc';
import { day, when, wsApi, type ProductRequest, type RequestItemInput, type RequestStatus, type RequestsWire } from './api';
import { useWorkspace } from './context';

const href = (rest: string) => hrefFor({ name: 'studio', rest });

export const REQUEST_LABEL: Record<RequestStatus, string> = {
  requested: 'Waiting for a quote',
  quoted: 'Quote ready',
  approved: 'Accepted',
  in_progress: 'Being modelled',
  delivered: 'Delivered',
  declined: 'Declined',
  cancelled: 'Cancelled',
};
const TONE: Record<RequestStatus, string> = { requested: 'info', quoted: 'accent', approved: 'ok', in_progress: 'ok', delivered: 'ok', declined: 'bad', cancelled: '' };

export function RequestPill({ status }: { status: RequestStatus }) {
  return <span className={`ws-pill ${TONE[status]}`}>{REQUEST_LABEL[status]}</span>;
}

/** `#/studio/products/requests[/new|/<id>]`: "Request more products". */
export default function Requests({ sub }: { sub: string }) {
  if (sub === 'new') return <NewRequest />;
  if (sub) return <RequestDetail key={sub} id={sub} />;
  return <RequestList />;
}

function RequestList() {
  const [data, setData] = useState<RequestsWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    wsApi
      .requests()
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load your requests.'));
  }, []);
  return (
    <div className="ws-requests">
      <div className="ws-head">
        <div>
          <a className="ws-back" href={href('products')}>
            ← Products
          </a>
          <h1>Request more products</h1>
          <p>Send us the products you want on your showroom: a name and the UPC from the box, a link or a photo. Our studio models each one true to size. We quote every request first; nothing is charged in the app.</p>
        </div>
        <div className="ws-actions">
          <a className="btn primary" href={href('products/requests/new')}>
            New request
          </a>
        </div>
      </div>
      {data && (
        <div className="ws-stats">
          <div className="ws-stat">
            <b>{data.included.products}</b>
            <span>products modelled with your license</span>
          </div>
          <div className="ws-stat">
            <b>{data.included.modelled}</b>
            <span>products in your catalog now</span>
          </div>
          <div className="ws-stat">
            <b>{data.requests.filter((r) => ['requested', 'quoted', 'approved', 'in_progress'].includes(r.status)).length}</b>
            <span>open requests</span>
          </div>
        </div>
      )}
      {error && <div className="ws-error">{error}</div>}
      {!data && !error && <div className="screen-msg">Loading…</div>}
      {data && data.requests.length === 0 && (
        <div className="ws-empty">
          <b>No requests yet</b>
          <p>List one product or forty. Your license includes modelling your starting range; we tell you when a request is covered by it.</p>
          <a className="btn primary" href={href('products/requests/new')}>
            Start a request
          </a>
        </div>
      )}
      {data && data.requests.length > 0 && (
        <ul className="ws-request-list">
          {data.requests.map((r) => (
            <li key={r.id}>
              <a href={href(`products/requests/${r.id}`)}>
                <span className="ws-request-main">
                  <b>
                    {r.items[0]?.name}
                    {r.items.length > 1 ? ` and ${r.items.length - 1} more` : ''}
                  </b>
                  <span className="muted">
                    {day(r.createdAt)}
                    {r.requestedBy ? ` · ${r.requestedBy.name}` : ''}
                  </span>
                </span>
                <span className="ws-request-side">
                  {r.quote && <span className="ws-request-quote">{r.quote.includedInLicense ? 'Included' : amount(r.quote.amountCents)}</span>}
                  <RequestPill status={r.status} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface ItemDraft {
  name: string;
  brand: string;
  sku: string;
  upc: string;
  url: string;
  widthIn: string;
  depthIn: string;
  heightIn: string;
  finishes: string;
  notes: string;
  photos: { id: string; url: string }[];
}

const blank = (): ItemDraft => ({ name: '', brand: '', sku: '', upc: '', url: '', widthIn: '', depthIn: '', heightIn: '', finishes: '', notes: '', photos: [] });
const num = (s: string) => (s.trim() === '' ? null : Number(s));

function NewRequest() {
  const toast = useDesignStore((s) => s.toast);
  const [items, setItems] = useState<ItemDraft[]>([blank()]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (i: number, patch: Partial<ItemDraft>) => setItems((cur) => cur.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFields({});
    const bad = items.findIndex((it) => it.upc.trim() && upcWhileTyping(it.upc)?.ok === false);
    if (bad >= 0) return setError(`Product ${bad + 1}: the UPC doesn’t check out. Compare it with the numbers under the barcode, or leave it blank.`);
    const body: RequestItemInput[] = items.map((it) => ({
      name: it.name.trim(),
      ...(it.brand.trim() ? { brand: it.brand.trim() } : {}),
      ...(it.sku.trim() ? { sku: it.sku.trim() } : {}),
      ...(it.upc.trim() ? { upc: it.upc.trim() } : {}),
      ...(it.url.trim() ? { url: it.url.trim() } : {}),
      widthIn: num(it.widthIn),
      depthIn: num(it.depthIn),
      heightIn: num(it.heightIn),
      ...(it.finishes.trim() ? { finishes: it.finishes.trim() } : {}),
      ...(it.notes.trim() ? { notes: it.notes.trim() } : {}),
      referenceFileIds: it.photos.map((p) => p.id),
    }));
    setBusy(true);
    try {
      const r = await wsApi.createRequest({ items: body, note: note.trim() });
      toast('Sent to our studio. We’ll quote it, usually within two business days.', 'ok');
      navigateHash(href(`products/requests/${r.request.id}`));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const errs = (err.body as { errors?: { field: string; message: string }[] } | undefined)?.errors ?? [];
        setFields(Object.fromEntries(errs.map((x) => [x.field, x.message])));
      } else setError('Could not send the request. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ws-request-form" onSubmit={submit} noValidate>
      <div className="ws-head">
        <div>
          <a className="ws-back" href={href('products/requests')}>
            ← Requests
          </a>
          <h1>New request</h1>
          <p>For each product: its name, and whatever you have of the UPC from the box (scan it on a phone), a link to the maker’s page, photos and sizes. The more we have, the faster and closer the model.</p>
        </div>
      </div>
      {items.map((it, i) => (
        <ItemCard key={i} index={i} item={it} onChange={(p) => set(i, p)} onRemove={items.length > 1 ? () => setItems(items.filter((_, j) => j !== i)) : undefined} errors={fields} />
      ))}
      {items.length < 40 && (
        <button type="button" className="btn ws-add-item" onClick={() => setItems([...items, blank()])}>
          + Add another product
        </button>
      )}
      <div className="ws-card">
        <label className="field">
          <span>
            A note for the studio <em>· optional</em>
          </span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={3} placeholder="Anything that applies to the whole request: a deadline, a launch, which products matter most." />
        </label>
      </div>
      {error && (
        <div className="ws-error" role="alert">
          {error}
        </div>
      )}
      <div className="ws-save">
        <span className="muted">
          {items.length} product{items.length === 1 ? '' : 's'} · we quote before any work starts
        </span>
        <a className="btn" href={href('products/requests')}>
          Cancel
        </a>
        <button type="submit" className="btn primary" disabled={busy || items.some((x) => !x.name.trim())}>
          {busy ? 'Sending…' : 'Send for a quote'}
        </button>
      </div>
    </form>
  );
}

function ItemCard({ index, item, onChange, onRemove, errors }: { index: number; item: ItemDraft; onChange: (p: Partial<ItemDraft>) => void; onRemove?: () => void; errors: Record<string, string> }) {
  const canScan = useCanScan();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<'photo' | 'barcode' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const upc = upcWhileTyping(item.upc);
  const err = (k: string) => errors[`items[${index}].${k}`];

  const addPhoto = async (file: File) => {
    setBusy('photo');
    setMsg(null);
    try {
      const { file: f } = await wsApi.uploadReference(file, file.name || 'photo.jpg');
      onChange({ photos: [...item.photos, { id: f.id, url: f.url }].slice(0, 8) });
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'That photo didn’t upload.');
    } finally {
      setBusy(null);
    }
  };
  /** A photo of the barcode: read on the device when the browser can, and kept as a photo either way. */
  const barcodePhoto = async (file: File) => {
    setBusy('barcode');
    setMsg(null);
    try {
      const code = await readBarcodeFromImage(file).catch(() => null);
      const { file: f } = await wsApi.uploadReference(file, file.name || 'barcode.jpg');
      onChange({ photos: [...item.photos, { id: f.id, url: f.url }].slice(0, 8), ...(code ? { upc: code } : {}) });
      setMsg(code ? `Read ${code} from the photo.` : 'We couldn’t read the code from that photo; it’s attached for the studio. Type the digits if you can.');
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'That photo didn’t upload.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <fieldset className="ws-card ws-item">
      <legend>Product {index + 1}</legend>
      {onRemove && (
        <button type="button" className="btn ws-item-remove" onClick={onRemove}>
          Remove
        </button>
      )}
      <div className="ws-grid-2">
        <label className="field">
          <span>Name</span>
          <input value={item.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Precis 30″ undermount sink" maxLength={80} required aria-invalid={!!err('name')} />
          {err('name') && <em className="ws-field-error">{err('name')}</em>}
        </label>
        <label className="field">
          <span>Maker</span>
          <input value={item.brand} onChange={(e) => onChange({ brand: e.target.value })} placeholder="Blanco" maxLength={60} />
        </label>
      </div>
      <div className="ws-grid-2">
        <div className="field">
          <span>
            UPC or EAN <em>· the digits under the barcode</em>
          </span>
          <div className="ws-upc-row">
            <input value={item.upc} onChange={(e) => onChange({ upc: e.target.value })} inputMode="numeric" placeholder="0 36000 29145 2" maxLength={24} aria-label={`UPC of product ${index + 1}`} aria-invalid={upc?.ok === false || !!err('upc')} />
            {canScan ? (
              <button type="button" className="btn" onClick={() => setScanning(true)}>
                Scan
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => barcodeRef.current?.click()} disabled={busy !== null}>
                {busy === 'barcode' ? 'Reading…' : 'Photo of barcode'}
              </button>
            )}
          </div>
          {upc?.ok === false && <em className="ws-field-error">{upc.message}</em>}
          {upc?.ok && <em className="fine">{formatUpc(upc.code)} checks out.</em>}
          {err('upc') && <em className="ws-field-error">{err('upc')}</em>}
          <input ref={barcodeRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (e.target.files?.[0] && void barcodePhoto(e.target.files[0]), (e.target.value = ''))} />
        </div>
        <label className="field">
          <span>Model number or SKU</span>
          <input value={item.sku} onChange={(e) => onChange({ sku: e.target.value })} maxLength={60} />
        </label>
      </div>
      <label className="field">
        <span>Link to the product page</span>
        <input value={item.url} onChange={(e) => onChange({ url: e.target.value })} inputMode="url" placeholder="https://" maxLength={400} aria-invalid={!!err('url')} />
        {err('url') && <em className="ws-field-error">{err('url')}</em>}
      </label>
      <div className="ws-grid-3">
        {(['widthIn', 'depthIn', 'heightIn'] as const).map((k) => (
          <label key={k} className="field">
            <span>{k === 'widthIn' ? 'Width' : k === 'depthIn' ? 'Depth' : 'Height'} (in)</span>
            <input value={item[k]} onChange={(e) => onChange({ [k]: e.target.value })} inputMode="decimal" placeholder="if known" aria-invalid={!!err(k)} />
            {err(k) && <em className="ws-field-error">{err(k)}</em>}
          </label>
        ))}
      </div>
      <div className="ws-grid-2">
        <label className="field">
          <span>Finishes you sell</span>
          <input value={item.finishes} onChange={(e) => onChange({ finishes: e.target.value })} placeholder="Stainless, matte black" maxLength={300} />
        </label>
        <label className="field">
          <span>Notes</span>
          <input value={item.notes} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Undermount; we sell the 27″ and 30″" maxLength={1000} />
        </label>
      </div>
      <div className="ws-images">
        {item.photos.map((p, j) => (
          <div key={p.id} className="ws-image">
            {p.url ? <img src={p.url} alt={`Photo ${j + 1} of product ${index + 1}`} /> : <span>Photo {j + 1}</span>}
            <button type="button" className="icon-btn" onClick={() => onChange({ photos: item.photos.filter((x) => x.id !== p.id) })} aria-label={`Remove photo ${j + 1}`}>
              ×
            </button>
          </div>
        ))}
        {item.photos.length < 8 && (
          <button type="button" className="ws-image ws-image-add" onClick={() => photoRef.current?.click()} disabled={busy !== null}>
            {busy === 'photo' ? 'Uploading…' : '+ Photo'}
          </button>
        )}
        <input ref={photoRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => (e.target.files?.[0] && void addPhoto(e.target.files[0]), (e.target.value = ''))} />
      </div>
      {msg && <p className="fine" role="status">{msg}</p>}
      {err('referenceFileIds') && <em className="ws-field-error">{err('referenceFileIds')}</em>}
      {scanning && (
        <BarcodeScanDialog
          onCode={(code) => (onChange({ upc: code }), setScanning(false))}
          onClose={() => setScanning(false)}
          onFallback={() => (setScanning(false), barcodeRef.current?.click())}
        />
      )}
    </fieldset>
  );
}

function RequestDetail({ id }: { id: string }) {
  const { owner } = useWorkspace();
  const toast = useDesignStore((s) => s.toast);
  const [r, setR] = useState<ProductRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    wsApi
      .request(id)
      .then((x) => setR(x.request))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the request.'));
  }, [id]);

  const act = async (fn: () => Promise<{ request: ProductRequest }>, ok: string) => {
    setBusy(true);
    try {
      const x = await fn();
      setR(x.request);
      toast(ok, 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That didn’t work.', 'warn');
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="ws-error">{error}</div>;
  if (!r) return <div className="screen-msg">Loading…</div>;
  const canAccept = r.status === 'quoted' && (owner || r.quote?.includedInLicense);

  return (
    <div className="ws-request">
      <div className="ws-head">
        <div>
          <a className="ws-back" href={href('products/requests')}>
            ← Requests
          </a>
          <h1>
            {r.items.length} product{r.items.length === 1 ? '' : 's'} to model
          </h1>
          <p>
            Sent {day(r.createdAt)}
            {r.requestedBy ? ` by ${r.requestedBy.name}` : ''}. <RequestPill status={r.status} />
          </p>
        </div>
      </div>

      {r.quote && (
        <section className={`ws-card ws-quote${r.status === 'quoted' ? ' is-open' : ''}`} aria-label="Quote">
          <h2>{r.quote.includedInLicense ? 'Included in your license' : `Quote: ${amount(r.quote.amountCents)} ${r.quote.currency.toUpperCase()}`}</h2>
          <p>
            {r.quote.includedInLicense ? 'These products count toward the range we model as part of your license: nothing extra to pay.' : 'Invoiced with your account once you accept; nothing is charged in the app.'}
            {r.quote.turnaroundDays ? ` Ready about ${r.quote.turnaroundDays} business days after you accept.` : ''}
          </p>
          {r.quote.note && <p className="ws-quote-note">{r.quote.note}</p>}
          {r.status === 'quoted' && (
            <div className="ws-actions">
              {canAccept ? (
                <button type="button" className="btn primary" disabled={busy} onClick={() => void act(() => wsApi.approveRequest(r.id), 'Accepted. The studio starts on it next.')}>
                  {r.quote.includedInLicense ? 'Go ahead' : 'Accept the quote'}
                </button>
              ) : (
                <span className="muted">An owner of the showroom accepts priced quotes.</span>
              )}
              {owner && !r.quote.includedInLicense && (
                <button type="button" className="btn" disabled={busy} onClick={() => void act(() => wsApi.declineRequest(r.id, note.trim()), 'Declined. Nothing will be made or charged.')}>
                  Decline
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <section className="ws-card" aria-label="Products">
        <h2>Products</h2>
        <ol className="ws-request-items">
          {r.items.map((it, i) => (
            <li key={i}>
              <b>{it.name}</b>
              <span className="muted">{[it.brand, it.sku, it.upc && `UPC ${formatUpc(it.upc)}`, [it.widthIn, it.depthIn, it.heightIn].some(Boolean) ? `${it.widthIn ?? '?'}″ W × ${it.depthIn ?? '?'}″ D × ${it.heightIn ?? '?'}″ H` : ''].filter(Boolean).join(' · ')}</span>
              {it.finishes && <span>Finishes: {it.finishes}</span>}
              {it.notes && <span>{it.notes}</span>}
              {it.url && (
                <a href={it.url} target="_blank" rel="noopener noreferrer nofollow">
                  Product page
                </a>
              )}
              {it.referenceFileIds.length > 0 && (
                <span className="ws-images">
                  {(r.references ?? [])
                    .filter((f) => it.referenceFileIds.includes(f.id))
                    .map((f) => (
                      <a key={f.id} className="ws-image" href={f.url} target="_blank" rel="noopener">
                        <img src={f.url} alt="" />
                      </a>
                    ))}
                </span>
              )}
            </li>
          ))}
        </ol>
        {r.note && <p className="ws-quote-note">{r.note}</p>}
      </section>

      <section className="ws-card" aria-label="Timeline">
        <h2>Timeline</h2>
        <ul className="ws-timeline">
          {(r.events ?? []).map((e) => (
            <li key={e.id}>
              <span className="muted">{when(e.at)}</span>
              <span>
                <b>{e.by}</b> {EVENT_TEXT[e.type] ?? e.type}
                {e.note ? `: ${e.note}` : ''}
              </span>
            </li>
          ))}
        </ul>
        <form
          className="ws-note-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return;
            void act(() => wsApi.noteRequest(r.id, note.trim()), 'Note sent to the studio.').then(() => setNote(''));
          }}
        >
          <label className="field">
            <span>Add a note for the studio</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} />
          </label>
          <div className="ws-actions">
            <button type="submit" className="btn" disabled={busy || !note.trim()}>
              Send note
            </button>
            {(r.status === 'requested' || r.status === 'quoted') && (
              <button type="button" className="btn" disabled={busy} onClick={() => void act(() => wsApi.cancelRequest(r.id), 'Request cancelled.')}>
                Cancel this request
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}

const EVENT_TEXT: Record<string, string> = {
  requested: 'sent the request',
  quoted: 'quoted it',
  requoted: 'updated the quote',
  approved: 'accepted',
  declined: 'declined',
  cancelled: 'cancelled the request',
  started: 'started modelling',
  delivered: 'delivered the models',
  note: 'wrote',
};
