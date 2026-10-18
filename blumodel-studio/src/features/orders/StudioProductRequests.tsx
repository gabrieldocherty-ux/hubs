import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, call } from '../../lib/api';
import { amount } from '../../lib/money';
import type { FileWire } from '../../types/platform';
import { formatUpc } from './upc';

/**
 * The studio's queue of showroom product requests (`/api/studio/product-requests`, server/routes/
 * workspace.mjs), grouped by company: what a showroom asked us to model, quoted here (a price, or
 * included in its license), accepted by the company, then started and delivered. Nothing is paid
 * in the app; a priced quote is invoiced with the license.
 */

type Status = 'requested' | 'quoted' | 'approved' | 'in_progress' | 'delivered' | 'declined' | 'cancelled';
type Filter = 'open' | 'all' | Status;

interface Item {
  name: string;
  brand: string;
  sku: string;
  upc: string;
  url: string;
  widthIn: number | null;
  depthIn: number | null;
  heightIn: number | null;
  finishes: string;
  notes: string;
  referenceFileIds: string[];
}

interface Req {
  id: string;
  status: Status;
  items: Item[];
  note: string;
  quote: { amountCents: number; currency: string; note: string; turnaroundDays: number | null; includedInLicense: boolean; at: number } | null;
  requestedBy: { name: string; email: string } | null;
  tenant: { id: string; name: string; slug: string; status: string };
  assignee: string | null;
  createdAt: number;
  updatedAt: number;
  events?: { id: number; type: string; note: string; by: string; at: number }[];
  references?: FileWire[];
}

interface Queue {
  requests: Req[];
  groups: { tenant: Req['tenant']; requests: Req[]; items: number }[];
  counts: Partial<Record<Status, number>>;
}

const LABEL: Record<Status, string> = { requested: 'To quote', quoted: 'Quoted', approved: 'To start', in_progress: 'In progress', delivered: 'Delivered', declined: 'Declined', cancelled: 'Cancelled' };
const FILTERS: [Filter, string][] = [
  ['open', 'Open'],
  ['requested', 'To quote'],
  ['quoted', 'Waiting on the company'],
  ['approved', 'To start'],
  ['in_progress', 'In progress'],
  ['delivered', 'Delivered'],
  ['all', 'All'],
];
const enc = encodeURIComponent;
const api = {
  list: (s: Filter) => call<Queue>('GET', `/api/studio/product-requests?status=${enc(s)}`),
  get: (id: string) => call<{ request: Req }>('GET', `/api/studio/product-requests/${enc(id)}`),
  act: (id: string, action: string, body?: unknown) => call<{ request: Req }>('POST', `/api/studio/product-requests/${enc(id)}/${action}`, body),
};
const date = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });

export function StudioProductRequests() {
  const [filter, setFilter] = useState<Filter>('open');
  const [data, setData] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.list(filter));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the showroom requests.');
    }
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);

  const c = data?.counts ?? {};
  const n = (f: Filter) => (f === 'all' ? Object.values(c).reduce((a, b) => a + (b ?? 0), 0) : f === 'open' ? (c.requested ?? 0) + (c.quoted ?? 0) + (c.approved ?? 0) + (c.in_progress ?? 0) : (c[f] ?? 0));

  return (
    <section className="ord-spr" aria-labelledby="ord-spr-title">
      <h2 id="ord-spr-title">Showroom product requests</h2>
      <p className="muted">Products companies asked us to model for their showrooms, by company. Quote each one (or mark it included in the license); the company accepts, then start and deliver it into their catalog.</p>
      <div className="chips ord-studio-chips" role="group" aria-label="Filter showroom requests">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" className={filter === k ? 'chip on' : 'chip'} aria-pressed={filter === k} onClick={() => setFilter(k)}>
            {label} <span className="ord-chip-n">{n(k)}</span>
          </button>
        ))}
      </div>
      {error && <div className="auth-error">{error}</div>}
      {!data && !error && <div className="ord-loading">Loading…</div>}
      {data && data.groups.length === 0 && <p className="empty-note">No showroom requests here.</p>}
      {data?.groups.map((g) => (
        <div key={g.tenant.id} className="ord-spr-group">
          <h3>
            {g.tenant.name} <span className="muted">· {g.tenant.slug} · {g.requests.length} request{g.requests.length === 1 ? '' : 's'}, {g.items} product{g.items === 1 ? '' : 's'}</span>
          </h3>
          <ul className="ord-spr-list">
            {g.requests.map((r) => (
              <li key={r.id}>
                <button type="button" className="ord-spr-row" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span>
                    <b>
                      {r.items[0]?.name}
                      {r.items.length > 1 ? ` + ${r.items.length - 1} more` : ''}
                    </b>
                    <span className="muted">
                      {' '}
                      · {date(r.createdAt)}
                      {r.requestedBy ? ` · ${r.requestedBy.name}` : ''}
                    </span>
                  </span>
                  <span className="ord-spr-side">
                    {r.quote && <span>{r.quote.includedInLicense ? 'Included' : amount(r.quote.amountCents)}</span>}
                    <span className={`ord-spr-pill is-${r.status}`}>{LABEL[r.status]}</span>
                  </span>
                </button>
                {open === r.id && <Detail id={r.id} onChanged={load} />}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Detail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const [r, setR] = useState<Req | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState('');
  const [included, setIncluded] = useState(false);
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    api
      .get(id)
      .then((x) => {
        setR(x.request);
        if (x.request.quote) {
          setIncluded(x.request.quote.includedInLicense);
          setPrice(x.request.quote.includedInLicense ? '' : String(x.request.quote.amountCents / 100));
          setDays(x.request.quote.turnaroundDays ? String(x.request.quote.turnaroundDays) : '');
        }
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not open the request.'));
  }, [id]);

  const act = async (action: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const x = await api.act(id, action, body);
      setR(x.request);
      setNote('');
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'That didn’t work.');
    } finally {
      setBusy(false);
    }
  };

  const quote = (e: FormEvent) => {
    e.preventDefault();
    const cents = Math.round(Number(price.replace(/[$,\s]/g, '')) * 100);
    const d = days.trim() ? Number(days) : null;
    void act('quote', { includedInLicense: included, ...(included ? {} : { amountCents: Number.isFinite(cents) ? cents : -1 }), ...(d ? { turnaroundDays: d } : {}), note: note.trim() });
  };

  if (error && !r) return <div className="auth-error">{error}</div>;
  if (!r) return <div className="ord-loading">Loading…</div>;

  return (
    <div className="ord-spr-detail">
      <ol className="ord-spr-items">
        {r.items.map((it, i) => (
          <li key={i}>
            <b>{it.name}</b>
            <span className="muted">
              {[it.brand, it.sku && `SKU ${it.sku}`, it.upc && `UPC ${formatUpc(it.upc)}`, [it.widthIn, it.depthIn, it.heightIn].some(Boolean) ? `${it.widthIn ?? '?'} × ${it.depthIn ?? '?'} × ${it.heightIn ?? '?'} in` : ''].filter(Boolean).join(' · ')}
            </span>
            {it.finishes && <span>Finishes: {it.finishes}</span>}
            {it.notes && <span>{it.notes}</span>}
            {it.url && (
              <a href={it.url} target="_blank" rel="noopener noreferrer nofollow">
                {it.url}
              </a>
            )}
            {it.referenceFileIds.length > 0 && (
              <span className="ord-spr-refs">
                {(r.references ?? [])
                  .filter((f) => it.referenceFileIds.includes(f.id))
                  .map((f) => (
                    <a key={f.id} href={f.url} target="_blank" rel="noopener">
                      <img src={f.url} alt="" />
                    </a>
                  ))}
              </span>
            )}
          </li>
        ))}
      </ol>
      {r.note && <p className="ord-spr-note">{r.note}</p>}
      <ul className="ord-spr-events">
        {(r.events ?? []).map((e) => (
          <li key={e.id}>
            <span className="muted">{new Date(e.at).toLocaleString('en-CA')}</span> <b>{e.by}</b> {e.type}
            {e.note ? `: ${e.note}` : ''}
          </li>
        ))}
      </ul>
      {(r.status === 'requested' || r.status === 'quoted') && (
        <form className="ord-spr-quote" onSubmit={quote}>
          <label className="ord-spr-check">
            <input type="checkbox" checked={included} onChange={(e) => setIncluded(e.target.checked)} /> Included in the license
          </label>
          {!included && (
            <label>
              Price (CAD) <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="180" />
            </label>
          )}
          <label>
            Business days <input value={days} onChange={(e) => setDays(e.target.value)} inputMode="numeric" placeholder="10" />
          </label>
          <button type="submit" className="btn primary" disabled={busy || (!included && !price.trim())}>
            {r.status === 'quoted' ? 'Update the quote' : 'Send the quote'}
          </button>
        </form>
      )}
      <label className="ord-spr-notefield">
        Note <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} />
      </label>
      <div className="ord-spr-actions">
        {r.status === 'approved' && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => void act('start')}>
            Start
          </button>
        )}
        {r.status === 'in_progress' && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => void act('deliver', { note: note.trim() })}>
            Mark delivered
          </button>
        )}
        <button type="button" className="btn" disabled={busy || !note.trim()} onClick={() => void act('note', { note: note.trim() })}>
          Add note
        </button>
        {(r.status === 'requested' || r.status === 'quoted') && (
          <button type="button" className="btn" disabled={busy || !note.trim()} onClick={() => void act('decline', { note: note.trim() })} title="Needs a note saying why">
            Decline
          </button>
        )}
      </div>
      {r.status === 'in_progress' && <p className="fine">Add the finished products to the company’s catalog first (Products in their workspace; an admin can add you to their team), then mark it delivered.</p>}
      {error && <div className="auth-error">{error}</div>}
    </div>
  );
}
