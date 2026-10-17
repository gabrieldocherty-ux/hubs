/**
 * Admin > Sales leads: the "Book a call" requests from blumodel.studio (POST /api/sales-leads),
 * newest first, with a status for the call pipeline (new → contacted → demo → won / lost) and our
 * own notes. Changes go through PATCH /api/admin/sales-leads/:id (admin-only, CSRF, audited).
 */
import { useEffect, useState } from 'react';
import { showroomApi } from './showroomApi';
import { SALES_LEAD_STATUSES, type SalesLead, type SalesLeadStatus } from './showroomTypes';
import { Notice, Pill, Section, dateTime, errorText, useLoad, type PillTone } from './ui';

export const SALES_STATUS: Record<SalesLeadStatus, [string, PillTone]> = {
  new: ['New', 'info'],
  contacted: ['Contacted', 'plain'],
  demo: ['Demo booked', 'warn'],
  won: ['Won', 'ok'],
  lost: ['Lost', 'bad'],
};

type Filter = 'all' | SalesLeadStatus;

export default function AdminSalesLeads() {
  const [filter, setFilter] = useState<Filter>('all');
  const { data, setData, error, loading, reload } = useLoad(() => showroomApi.salesLeads(filter === 'all' ? undefined : filter), [filter]);

  const replace = (lead: SalesLead) =>
    setData((d) => {
      if (!d) return d;
      const was = d.leads.find((l) => l.id === lead.id);
      const counts = { ...d.counts };
      if (was && was.status !== lead.status) {
        counts[was.status] = Math.max(0, (counts[was.status] ?? 0) - 1);
        counts[lead.status] = (counts[lead.status] ?? 0) + 1;
      }
      const leads = d.leads.map((l) => (l.id === lead.id ? lead : l)).filter((l) => filter === 'all' || l.status === filter);
      return { leads, counts };
    });

  const counts = data?.counts;
  return (
    <div className="adm admin-sales-leads">
      <div className="adm-head">
        <div>
          <h1>Sales leads</h1>
          <p>Companies that asked for a call on blumodel.studio. Call them, then move them along.</p>
        </div>
        <div className="adm-head-actions">
          <button type="button" className="btn small" onClick={() => void reload()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      <div className="adm-filters" role="group" aria-label="Show sales leads">
        {(['all', ...SALES_LEAD_STATUSES] as Filter[]).map((f) => (
          <button key={f} type="button" className={filter === f ? 'chip on' : 'chip'} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : SALES_STATUS[f][0]} <span className="mono">{counts ? (f === 'all' ? counts.total : counts[f] ?? 0) : ''}</span>
          </button>
        ))}
      </div>
      {error && <div className="auth-error">{error}</div>}
      {!data ? (
        <div className="screen-msg">Loading sales leads…</div>
      ) : data.leads.length === 0 ? (
        <Section title={filter === 'all' ? 'No leads yet' : `No ${SALES_STATUS[filter][0].toLowerCase()} leads`} id="adm-sales-empty">
          <p className="empty-note">{filter === 'all' ? 'Book a call requests from the sales site land here.' : 'None right now.'}</p>
        </Section>
      ) : (
        <div className="adm-leads">
          {data.leads.map((l) => (
            <LeadCard key={l.id} lead={l} onSaved={replace} />
          ))}
        </div>
      )}
    </div>
  );
}

function LeadCard({ lead, onSaved }: { lead: SalesLead; onSaved: (l: SalesLead) => void }) {
  const [notes, setNotes] = useState(lead.adminNotes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setNotes(lead.adminNotes), [lead.adminNotes]);
  const [label, tone] = SALES_STATUS[lead.status] ?? [lead.status, 'plain'];

  const save = async (b: { status?: SalesLeadStatus; adminNotes?: string }) => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      onSaved((await showroomApi.updateSalesLead(lead.id, b)).lead);
      setSaved(true);
    } catch (x) {
      setErr(errorText(x, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };
  const id = `sl-${lead.id}`;

  return (
    <section className="adm-section adm-lead" aria-labelledby={id}>
      <div className="adm-section-head">
        <h2 id={id}>{lead.company}</h2>
        <Pill tone={tone}>{label}</Pill>
      </div>
      <dl className="adm-kv">
        <dt>Contact</dt>
        <dd>{lead.name}</dd>
        {lead.phone && (
          <>
            <dt>Phone</dt>
            <dd>
              <a className="adm-link" href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}>
                {lead.phone}
              </a>
            </dd>
          </>
        )}
        <dt>Email</dt>
        <dd className="adm-wrap">
          <a className="adm-link" href={`mailto:${lead.email}`}>
            {lead.email}
          </a>
        </dd>
        {lead.city && (
          <>
            <dt>City</dt>
            <dd>{lead.city}</dd>
          </>
        )}
        <dt>Asked</dt>
        <dd>
          {dateTime(lead.createdAt)}
          {lead.emailed ? ' · emailed to support' : ''}
        </dd>
      </dl>
      {lead.message && <p className="adm-lead-msg">{lead.message}</p>}
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="adm-form">
        <label className="adm-field adm-narrow">
          <span>Status</span>
          <select value={lead.status} disabled={busy} onChange={(e) => void save({ status: e.target.value as SalesLeadStatus })}>
            {SALES_LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SALES_STATUS[s][0]}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-field">
          <span>Our notes</span>
          <textarea value={notes} onChange={(e) => (setNotes(e.target.value), setSaved(false))} maxLength={4000} rows={2} placeholder="Called Tue, wants a demo after the holidays…" />
        </label>
        <div className="adm-actions">
          <button type="button" className="btn small" disabled={busy || notes.trim() === lead.adminNotes} onClick={() => void save({ adminNotes: notes })}>
            Save notes
          </button>
          {saved && <span className="adm-note">Saved.</span>}
        </div>
      </div>
    </section>
  );
}
