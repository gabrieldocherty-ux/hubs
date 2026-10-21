import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { ApiError } from '../../lib/api';
import { buildEstimate } from '../../lib/estimate';
import { hrefFor, navigate } from '../../lib/router';
import { useCatalog } from '../../store/useCatalog';
import { useDesignStore } from '../../store/useDesignStore';
import type { DesignDoc } from '../../types';
import { LEAD_STATUSES, saveText, when, wsApi, type Lead, type LeadCounts, type LeadDesign, type LeadDetail as LeadDetailWire, type LeadEvent, type LeadStatus, type LeadExport } from './api';
import { useWorkspace } from './context';
import './leads.css';
import { roomLabel } from '../../lib/outline';

const LeadDesignView = lazy(() => import('./LeadDesignView'));

const PAGE = 50;
const href = (rest: string) => hrefFor({ name: 'studio', rest });

export const LEAD_LABEL: Record<LeadStatus, string> = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', won: 'Won', lost: 'Lost' };
const TONE: Record<LeadStatus, string> = { new: 'accent', contacted: 'info', quoted: 'warn', won: 'ok', lost: '' };

/** A phone link, without the extension (which a dialler can't take). */
export function telOf(phone: string): string | null {
  const main = phone.replace(/\s*ext\.?\s*\d+$/i, '');
  const d = main.replace(/[^\d+]/g, '');
  return d.replace(/\D/g, '').length >= 7 ? `tel:${d}` : null;
}

/** "Oct 17" this year, "Oct 17, 2025" before. */
function shortDay(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const same = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', ...(same ? {} : { year: 'numeric' }) });
}

/**
 * The Leads tab (docs/handoff/leads.md): everyone who used the showroom, most recently active
 * first: who they are, when they first came and were last active, how many designs they made,
 * whether they sent one, the team's status and notes. `#/studio/leads/<id>` opens a lead (and
 * marks it read); `#/studio/leads/<id>/design/<designId>` opens one of their designs in 3D, view-only.
 */
export default function LeadsTab({ sub }: { sub: string }) {
  const [id, part, designId] = sub.split('/');
  if (id && part === 'design' && designId)
    return (
      <Suspense fallback={<div className="screen-msg">Opening the design…</div>}>
        <LeadDesignView key={designId} leadId={id} designId={designId} />
      </Suspense>
    );
  return id ? <LeadDetail key={id} id={id} /> : <Inbox />;
}

/** Owners: the last exports of the lead list (who, when, how many people). */
function RecentExports({ bump }: { bump: number }) {
  const [list, setList] = useState<LeadExport[] | null>(null);
  useEffect(() => {
    wsApi
      .leadExports()
      .then((r) => setList(r.exports))
      .catch(() => setList([]));
  }, [bump]);
  if (!list) return null;
  return (
    <section className="ws-card ws-exports" aria-label="Recent exports">
      <h2>Recent exports of this list</h2>
      {list.length === 0 ? (
        <p className="fine">Nobody has exported this list yet. Every export is recorded here.</p>
      ) : (
        <ul>
          {list.map((e) => (
            <li key={`${e.at}-${e.by}`}>
              <b>{e.by}</b> ({e.role === 'owner' ? 'owner' : 'staff'}) exported {e.rows} {e.rows === 1 ? 'person' : 'people'} · {when(e.at)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Inbox() {
  const { refreshBadge, owner, tenant } = useWorkspace();
  const canExport = owner || !!tenant.settings.staffLeadExport;
  const [exportsBump, setExportsBump] = useState(0);
  const toast = useDesignStore((s) => s.toast);
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [sent, setSent] = useState<'' | 'yes' | 'no'>('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [counts, setCounts] = useState<LeadCounts | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Search waits for a pause in typing.
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(timer.current);
  }, [q]);

  const load = useCallback(
    async (append = false, before?: number) => {
      try {
        const r = await wsApi.leads({ status, sent, q: query, before, limit: PAGE });
        setLeads((cur) => (append && cur ? [...cur, ...r.leads] : r.leads));
        setCounts(r.counts);
        setMore(r.leads.length === PAGE);
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not load your potential customers.');
      }
    },
    [status, sent, query],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => refreshBadge(), [refreshBadge]);

  const exportCsv = async () => {
    setBusy(true);
    try {
      const r = await wsApi.exportLeads();
      saveText(r.filename, r.content, r.contentType);
      setExportsBump((n) => n + 1);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'The export didn’t work.', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const filters: [LeadStatus | '', string][] = [['', 'All'], ...LEAD_STATUSES.map((s) => [s, LEAD_LABEL[s]] as [LeadStatus, string])];
  const filtered = !!(status || sent || query);

  return (
    <div className="ws-leads">
      <div className="ws-head">
        <div>
          <span className="eyebrow">Potential customers</span>
          <h1>Everyone who signed up to see your products</h1>
          <p>
            Each person who signed up on your showroom to design with your products, with how to reach them, their designs and whether they sent you one. Only your team sees these.
            {counts ? ` ${counts.total} ${counts.total === 1 ? 'person' : 'people'}, ${counts.sent} sent a design.` : ''}
          </p>
        </div>
        <div className="ws-actions">
          {canExport ? (
            <button type="button" className="btn" onClick={() => void exportCsv()} disabled={busy || !counts?.total} title="Every export is recorded, and owners can see who exported the list">
              {busy ? 'Exporting…' : 'Export CSV'}
            </button>
          ) : (
            <span className="fine">Only an owner can export this list.</span>
          )}
        </div>
      </div>
      <div className="ws-filters ws-lead-filters">
        <div className="chips" role="group" aria-label="Status">
          {filters.map(([k, label]) => (
            <button key={k || 'all'} type="button" className={status === k ? 'chip on' : 'chip'} aria-pressed={status === k} onClick={() => setStatus(k)}>
              {label}
              {counts && <span className="ws-count">{k ? counts[k] : counts.total}</span>}
            </button>
          ))}
        </div>
        <select className="ws-lead-sent" value={sent} onChange={(e) => setSent(e.target.value as '' | 'yes' | 'no')} aria-label="Sent a design">
          <option value="">Sent or not</option>
          <option value="yes">Sent a design</option>
          <option value="no">Hasn’t sent one</option>
        </select>
        <input className="ws-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone or notes" aria-label="Search potential customers" />
      </div>
      {error && <div className="ws-error">{error}</div>}
      {!leads && !error && <div className="screen-msg">Loading your potential customers…</div>}
      {leads && leads.length === 0 && (
        <div className="ws-empty">
          {counts?.total || filtered ? (
            <p>No one matches.</p>
          ) : (
            <>
              <b>No potential customers yet</b>
              <p>When someone starts a design on your showroom, they give their name and an email or phone first, and they show up here. You hear about it by email when they send you a design.</p>
            </>
          )}
        </div>
      )}
      {leads && leads.length > 0 && (
        <div className="ws-lead-table-wrap">
          <table className="ws-lead-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Phone</th>
                <th scope="col">First seen</th>
                <th scope="col">Last active</th>
                <th scope="col" className="num">
                  Designs
                </th>
                <th scope="col">Sent</th>
                <th scope="col">Status</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className={l.read ? '' : 'is-unread'} onClick={(e) => !(e.target as HTMLElement).closest('a') && navigate({ name: 'studio', rest: `leads/${l.id}` })}>
                  <td data-label="Name" className="ws-lt-name">
                    <a href={href(`leads/${l.id}`)}>
                      {!l.read && <span className="ws-dot" aria-label="New" />}
                      <b>{l.name}</b>
                    </a>
                    {l.duplicateOf && <span className="ws-pill warn ws-dup-pill">Possible duplicate of {l.duplicateOf.name}</span>}
                  </td>
                  <td data-label="Email" className="ws-lt-email">
                    {l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : <span className="muted">—</span>}
                  </td>
                  <td data-label="Phone">{l.phone ? <a href={telOf(l.phone) ?? undefined}>{l.phone}</a> : <span className="muted">—</span>}</td>
                  <td data-label="First seen" className="muted">
                    {shortDay(l.firstSeenAt)}
                  </td>
                  <td data-label="Last active" className="muted">
                    {shortDay(l.lastActiveAt)}
                  </td>
                  <td data-label="Designs" className="num">
                    {l.designs}
                  </td>
                  <td data-label="Sent">{l.sent ? <span className="ws-pill ok">Sent</span> : <span className="muted">No</span>}</td>
                  <td data-label="Status">
                    <span className={`ws-pill ${TONE[l.status]}`}>{LEAD_LABEL[l.status]}</span>
                  </td>
                  <td data-label="Notes" className="ws-lt-notes muted">
                    {l.staffNotes || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && leads && (
        <button type="button" className="btn ws-more" onClick={() => void load(true, leads[leads.length - 1]?.lastActiveAt)}>
          Show more
        </button>
      )}
      {owner && <RecentExports bump={exportsBump} />}
    </div>
  );
}

const EVENT_LABEL: Record<LeadEvent['kind'], string> = {
  captured: 'Gave their details and started',
  returned: 'Came back',
  started: 'Started a design',
  saved: 'Saved a design',
  sent: 'Sent a design to you',
  status: 'Status changed',
  account: 'Made an account on your showroom',
  merged: 'A possible duplicate was merged in',
};

function eventText(e: LeadEvent): string {
  if (e.kind === 'status') return `${LEAD_LABEL[e.to ?? 'new']}${e.by ? ` · by ${e.by}` : ''}`;
  if (e.kind === 'returned' && e.form) return 'Came back on another browser and gave their details again';
  return e.design ? `“${e.design}”` : '';
}

function LeadDetail({ id }: { id: string }) {
  const { refreshBadge } = useWorkspace();
  const toast = useDesignStore((s) => s.toast);
  const [lead, setLead] = useState<LeadDetailWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    wsApi
      .lead(id)
      .then((r) => {
        setLead(r.lead);
        setNotes(r.lead.staffNotes);
        refreshBadge();
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not open this person.'));
  }, [id, refreshBadge]);

  const save = async (patch: { status?: LeadStatus; staffNotes?: string }, ok: string) => {
    setBusy(true);
    try {
      const r = await wsApi.saveLead(id, patch);
      setLead(r.lead);
      if (patch.staffNotes !== undefined) setNotes(r.lead.staffNotes);
      toast(ok, 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That didn’t save.', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const merge = async (keep: boolean) => {
    setBusy(true);
    try {
      const r = keep ? await wsApi.keepLeadSeparate(id) : await wsApi.mergeLead(id);
      toast(keep ? 'Kept as a separate person.' : `Merged into ${r.lead.name}.`, 'ok');
      if (keep) setLead(r.lead);
      else navigate({ name: 'studio', rest: `leads/${r.lead.id}` }, true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That didn’t work.', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await wsApi.deleteLead(id);
      toast(`Deleted ${lead?.name ?? 'this person'}${r.removed.designs ? ` and ${r.removed.designs} design${r.removed.designs === 1 ? '' : 's'}` : ''}.`, 'ok');
      refreshBadge();
      navigate({ name: 'studio', rest: 'leads' }, true);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That didn’t delete.', 'warn');
      setBusy(false);
      setConfirm(false);
    }
  };

  if (error)
    return (
      <div className="ws-empty">
        <p>{error}</p>
        <a className="btn" href={href('leads')}>
          Back to potential customers
        </a>
      </div>
    );
  if (!lead) return <div className="screen-msg">Opening…</div>;
  const tel = lead.phone ? telOf(lead.phone) : null;

  return (
    <div className="ws-lead-detail">
      <div className="ws-head">
        <div>
          <a className="ws-back" href={href('leads')}>
            ← Potential customers
          </a>
          <h1>{lead.name}</h1>
          <p>
            First seen {when(lead.firstSeenAt)} · last active {when(lead.lastActiveAt)}
            {lead.signedIn ? ' · has an account on your showroom' : ''}
          </p>
        </div>
        <div className="ws-actions">
          {tel && (
            <a className="btn primary" href={tel}>
              Call {lead.phone}
            </a>
          )}
          {lead.email && (
            <a className={tel ? 'btn' : 'btn primary'} href={`mailto:${lead.email}`}>
              Email
            </a>
          )}
        </div>
      </div>
      {lead.duplicateOf && (
        <section className="ws-card ws-note ws-dup" aria-label="Possible duplicate">
          <p>
            <b>Possible duplicate of <a href={href(`leads/${lead.duplicateOf.id}`)}>{lead.duplicateOf.name}</a>.</b> This person typed an email or phone that person already has. Typing an address doesn’t prove it’s theirs, so the two are kept apart until you decide.
          </p>
          <div className="ws-actions">
            <button type="button" className="btn" disabled={busy} onClick={() => void merge(false)}>
              Same person: merge into {lead.duplicateOf.name}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void merge(true)}>
              Someone else: keep separate
            </button>
          </div>
        </section>
      )}
      <div className="ws-lead-grid">
        <section className="ws-card" aria-label="Contact">
          <h2>Contact</h2>
          <dl className="ws-kv">
            <dt>Email</dt>
            <dd>{lead.email ? <a href={`mailto:${lead.email}`}>{lead.email}</a> : '—'}</dd>
            <dt>Phone</dt>
            <dd>{lead.phone ? tel ? <a href={tel}>{lead.phone}</a> : lead.phone : '—'}</dd>
            <dt>Designs</dt>
            <dd>
              {lead.designs.length}
              {lead.sent ? ` · sent ${lead.sends} time${lead.sends === 1 ? '' : 's'}` : ' · none sent yet'}
            </dd>
          </dl>
          <span className="mini-label">Consent</span>
          <p className="fine" data-testid="lead-consent">
            {lead.consent ? (
              <>
                “{lead.consentText}”{lead.consentAt ? ` Agreed ${when(lead.consentAt)}.` : ''}
              </>
            ) : (
              'No consent was recorded with this person.'
            )}
          </p>
        </section>

        <section className="ws-card" aria-label="Your follow-up">
          <h2>Your follow-up</h2>
          <div className="chips" role="radiogroup" aria-label="Status">
            {LEAD_STATUSES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={lead.status === s} className={lead.status === s ? 'chip on' : 'chip'} disabled={busy} onClick={() => lead.status !== s && void save({ status: s }, `Marked ${LEAD_LABEL[s].toLowerCase()}.`)}>
                {LEAD_LABEL[s]}
              </button>
            ))}
          </div>
          <label className="field">
            <span>
              Team notes <em>· only your team sees these</em>
            </span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} rows={5} placeholder="Called Tuesday, booking a showroom visit…" />
          </label>
          <div className="ws-actions">
            <button type="button" className="btn primary" disabled={busy || notes === lead.staffNotes} onClick={() => void save({ staffNotes: notes }, 'Notes saved.')}>
              Save notes
            </button>
          </div>
        </section>
      </div>

      <section className="ws-card ws-lead-designs" aria-label="Designs">
        <h2>Designs</h2>
        {lead.designs.length === 0 ? (
          <p className="muted">No designs yet. They gave their details but haven’t saved a design.</p>
        ) : (
          <ul className="ws-design-list">
            {lead.designs.map((d) => (
              <DesignRow key={d.id} leadId={lead.id} design={d} />
            ))}
          </ul>
        )}
      </section>

      {lead.sendsList.length > 0 && (
        <section className="ws-card" aria-label="What they sent">
          <h2>What they sent</h2>
          <ul className="ws-send-list">
            {lead.sendsList.map((s) => (
              <li key={s.id}>
                <div className="ws-send-top">
                  <b>{s.designName ? `“${s.designName}”` : 'A design'}</b>
                  <span className="muted">{when(s.at)}</span>
                </div>
                <dl className="ws-kv">
                  {s.budget && (
                    <>
                      <dt>Budget</dt>
                      <dd>{s.budget}</dd>
                    </>
                  )}
                  {s.timeline && (
                    <>
                      <dt>When</dt>
                      <dd>{s.timeline}</dd>
                    </>
                  )}
                  {s.postalCode && (
                    <>
                      <dt>Postal code</dt>
                      <dd>{s.postalCode}</dd>
                    </>
                  )}
                  {(s.email !== lead.email || s.phone !== lead.phone) && (
                    <>
                      <dt>Gave</dt>
                      <dd>{[s.email, s.phone].filter(Boolean).join(' · ')}</dd>
                    </>
                  )}
                </dl>
                {s.notes && <p className="ws-quote-note">{s.notes}</p>}
                {s.url && (
                  <a href={s.url} target="_blank" rel="noopener">
                    Their view-only link
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="ws-card" aria-label="Activity">
        <h2>Activity</h2>
        <ol className="ws-timeline">
          {lead.timeline.map((e, i) => (
            <li key={`${e.at}-${i}`} className={`ws-tl-${e.kind}`}>
              <span className="ws-tl-dot" aria-hidden="true" />
              <span className="ws-tl-what">
                <b>{EVENT_LABEL[e.kind]}</b> {eventText(e)}
              </span>
              <time className="muted" dateTime={new Date(e.at).toISOString()}>
                {when(e.at)}
              </time>
            </li>
          ))}
        </ol>
      </section>

      <section className="ws-card ws-danger" aria-label="Delete this person">
        <h2>Delete this person</h2>
        <p>If {lead.name} asks you to forget them, delete their details, their designs and this history. It can’t be undone.</p>
        <button type="button" className="btn danger" onClick={() => setConfirm(true)} disabled={busy}>
          Delete their details and designs
        </button>
      </section>
      {confirm && (
        <Dialog title={`Delete ${lead.name}?`} onClose={() => !busy && setConfirm(false)}>
          <p>
            This deletes their contact details, consent, {lead.designs.length} design{lead.designs.length === 1 ? '' : 's'} and this activity. A design they keep in an account of their own stays in that account.
          </p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setConfirm(false)} disabled={busy} data-autofocus>
              Keep
            </button>
            <button type="button" className="btn danger" onClick={() => void remove()} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** One of the lead's designs: its size, when it changed, whether it was sent, its products, and Open in 3D. */
function DesignRow({ leadId, design }: { leadId: string; design: LeadDesign }) {
  // The company's own products carry its name as their brand: the list leaves it out.
  const company = useWorkspace().tenant.name;
  const [doc, setDoc] = useState<DesignDoc | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    wsApi
      .leadDesign(leadId, design.id)
      .then((r) => {
        if (!live) return;
        if (r.design.doc.products) useCatalog.getState().registerSnapshots(r.design.doc.products);
        setDoc(r.design.doc);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [leadId, design.id]);
  const lines = useMemo(() => (doc ? buildEstimate(doc).lines.filter((l) => l.productId) : []), [doc]);
  return (
    <li className="ws-design">
      <div className="ws-design-top">
        <div>
          <b>{design.name}</b>
          <span className="muted">
            {design.room ? `${roomLabel({ ...design.room, ceilingIn: 0 })} · ` : ''}
            {design.items} piece{design.items === 1 ? '' : 's'} · changed {when(design.updatedAt)}
          </span>
        </div>
        <div className="ws-actions">
          {design.sentAt && <span className="ws-pill ok">Sent {shortDay(design.sentAt)}</span>}
          <a className="btn primary" href={href(`leads/${leadId}/design/${design.id}`)}>
            Open in 3D
          </a>
        </div>
      </div>
      {failed ? (
        <p className="muted">The product list couldn’t be read.</p>
      ) : !doc ? (
        <p className="muted">Reading the products…</p>
      ) : lines.length === 0 ? (
        <p className="muted">No products placed yet.</p>
      ) : (
        <ul className="ws-design-products" aria-label={`Products in ${design.name}`}>
          {lines.map((l) => (
            <li key={l.key}>
              <span className="ws-qty">{l.qty}×</span>
              <span>
                {l.label.startsWith(`${company} `) ? l.label.slice(company.length + 1) : l.label}
                {l.sub ? <span className="muted"> · {l.sub}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
