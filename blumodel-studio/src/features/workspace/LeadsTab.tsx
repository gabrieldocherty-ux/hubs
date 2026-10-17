import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { hrefFor } from '../../lib/router';
import { useDesignStore } from '../../store/useDesignStore';
import { LEAD_STATUSES, saveText, when, wsApi, type Lead, type LeadCounts, type LeadStatus } from './api';
import { useWorkspace } from './context';
import './leads.css';

const PAGE = 50;
const href = (rest: string) => hrefFor({ name: 'studio', rest });

export const LEAD_LABEL: Record<LeadStatus, string> = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', won: 'Won', lost: 'Lost' };
const TONE: Record<LeadStatus, string> = { new: 'accent', contacted: 'info', quoted: 'warn', won: 'ok', lost: '' };

/**
 * The Leads tab: every "Send this design to <Company>" from the showroom, newest first, with its
 * status (new, contacted, quoted, won, lost), the team's notes, the customer's design and a CSV
 * export. `#/studio/leads/<id>` opens one (and marks it read).
 */
export default function LeadsTab({ sub }: { sub: string }) {
  return sub ? <LeadDetail key={sub} id={sub} /> : <Inbox />;
}

function Inbox() {
  const { refreshBadge } = useWorkspace();
  const toast = useDesignStore((s) => s.toast);
  const [status, setStatus] = useState<LeadStatus | ''>('');
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
        const r = await wsApi.leads({ status, q: query, before, limit: PAGE });
        setLeads((cur) => (append && cur ? [...cur, ...r.leads] : r.leads));
        setCounts(r.counts);
        setMore(r.leads.length === PAGE);
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not load your leads.');
      }
    },
    [status, query],
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
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'The export didn’t work.', 'warn');
    } finally {
      setBusy(false);
    }
  };

  const filters: [LeadStatus | '', string][] = [['', 'All'], ...LEAD_STATUSES.map((s) => [s, LEAD_LABEL[s]] as [LeadStatus, string])];

  return (
    <div className="ws-leads">
      <div className="ws-head">
        <div>
          <span className="eyebrow">Leads</span>
          <h1>Your inbox</h1>
          <p>Every design a customer sends you from the showroom, with their details and a link to the design. Only your team sees these.</p>
        </div>
        <div className="ws-actions">
          <button type="button" className="btn" onClick={() => void exportCsv()} disabled={busy || !counts?.total}>
            {busy ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>
      <div className="ws-filters">
        <div className="chips" role="group" aria-label="Status">
          {filters.map(([k, label]) => (
            <button key={k || 'all'} type="button" className={status === k ? 'chip on' : 'chip'} aria-pressed={status === k} onClick={() => setStatus(k)}>
              {label}
              {counts && <span className="ws-count">{k ? counts[k] : counts.total}</span>}
            </button>
          ))}
        </div>
        <input className="ws-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone or postal code" aria-label="Search leads" />
      </div>
      {error && <div className="ws-error">{error}</div>}
      {!leads && !error && <div className="screen-msg">Loading your leads…</div>}
      {leads && leads.length === 0 && (
        <div className="ws-empty">
          {counts?.total ? (
            <p>No leads match.</p>
          ) : (
            <>
              <b>No leads yet</b>
              <p>When a customer finishes a design on your showroom and taps “Send this design to you”, it lands here, and the people on your team get an email.</p>
            </>
          )}
        </div>
      )}
      {leads && leads.length > 0 && (
        <ul className="ws-lead-list">
          {leads.map((l) => (
            <li key={l.id}>
              <a className={l.read ? 'ws-lead' : 'ws-lead is-unread'} href={href(`leads/${l.id}`)}>
                <span className="ws-lead-who">
                  {!l.read && <span className="ws-dot" aria-label="Unread" />}
                  <b>{l.name}</b>
                  <span className="muted">{[l.postalCode, l.design?.name].filter(Boolean).join(' · ') || l.email}</span>
                </span>
                <span className="ws-lead-meta">
                  {l.budget && <span className="muted ws-lead-budget">{l.budget}</span>}
                  <span className={`ws-pill ${TONE[l.status]}`}>{LEAD_LABEL[l.status]}</span>
                  <span className="muted ws-lead-when">{when(l.createdAt)}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {more && leads && (
        <button type="button" className="btn ws-more" onClick={() => void load(true, leads[leads.length - 1]?.createdAt)}>
          Show older leads
        </button>
      )}
    </div>
  );
}

function LeadDetail({ id }: { id: string }) {
  const { refreshBadge } = useWorkspace();
  const toast = useDesignStore((s) => s.toast);
  const [lead, setLead] = useState<Lead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    wsApi
      .lead(id)
      .then((r) => {
        setLead(r.lead);
        setNotes(r.lead.staffNotes);
        refreshBadge();
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not open this lead.'));
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

  if (error)
    return (
      <div className="ws-empty">
        <p>{error}</p>
        <a className="btn" href={href('leads')}>
          Back to leads
        </a>
      </div>
    );
  if (!lead) return <div className="screen-msg">Opening the lead…</div>;

  return (
    <div className="ws-lead-detail">
      <div className="ws-head">
        <div>
          <a className="ws-back" href={href('leads')}>
            ← Leads
          </a>
          <h1>{lead.name}</h1>
          <p>
            Sent {when(lead.createdAt)}
            {lead.signedIn ? ' · signed in on your showroom' : ''}
          </p>
        </div>
        {lead.design && (
          <div className="ws-actions">
            <a className="btn primary" href={lead.design.url} target="_blank" rel="noopener">
              Open the design
            </a>
          </div>
        )}
      </div>
      <div className="ws-lead-grid">
        <section className="ws-card" aria-label="Contact">
          <h2>Contact</h2>
          <dl className="ws-kv">
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${lead.email}`}>{lead.email}</a>
            </dd>
            {lead.phone && (
              <>
                <dt>Phone</dt>
                <dd>
                  <a href={`tel:${lead.phone.replace(/[^0-9+]/g, '')}`}>{lead.phone}</a>
                </dd>
              </>
            )}
            {lead.postalCode && (
              <>
                <dt>Postal code</dt>
                <dd>{lead.postalCode}</dd>
              </>
            )}
            {lead.budget && (
              <>
                <dt>Budget</dt>
                <dd>{lead.budget}</dd>
              </>
            )}
            {lead.timeline && (
              <>
                <dt>Timeline</dt>
                <dd>{lead.timeline}</dd>
              </>
            )}
            {lead.design && (
              <>
                <dt>Design</dt>
                <dd>
                  <a href={lead.design.url} target="_blank" rel="noopener">
                    {lead.design.name || 'Their design'}
                  </a>
                </dd>
              </>
            )}
          </dl>
          {lead.notes && (
            <>
              <span className="mini-label">Their message</span>
              <p className="ws-quote-note">{lead.notes}</p>
            </>
          )}
          <p className="fine">{lead.consent ? `They agreed: “${lead.consentText}”` : 'No consent was recorded with this lead.'}</p>
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
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={4000} rows={6} placeholder="Called Tuesday, booking a showroom visit…" />
          </label>
          <div className="ws-actions">
            <button type="button" className="btn primary" disabled={busy || notes === lead.staffNotes} onClick={() => void save({ staffNotes: notes }, 'Notes saved.')}>
              Save notes
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
