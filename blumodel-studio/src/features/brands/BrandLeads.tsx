import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { timeAgo } from '../../store/useSession';
import { useDesignStore } from '../../store/useDesignStore';
import { brandApi, type Lead, type LeadCounts, type LeadStatus } from './api';
import { useBrandTab } from './context';
import { LEAD_STATUS_LABEL, LEAD_STATUSES, leadMailto, telHref } from './logic';
import { useBrandSummary } from './summary';

/**
 * `#/pro/brand/leads` (BRAND_PAGE §6): newest first; New → Contacted → Won / Lost; private notes;
 * one-tap Call and Email; the attached kitchen opens as the read-only share view. Read-only while
 * the plan has lapsed (marking leads read still works: nobody else sees it).
 */
export default function BrandLeads() {
  const { state, readOnly } = useBrandTab();
  const [filter, setFilter] = useState<LeadStatus | 'all'>('all');
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [counts, setCounts] = useState<LeadCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Leads that were unread when this inbox opened keep their "New" mark until it closes. */
  const fresh = useRef(new Set<string>());

  useEffect(() => {
    let live = true;
    setError(null);
    brandApi
      .leads(filter === 'all' ? undefined : filter)
      .then((r) => {
        if (!live) return;
        for (const l of r.leads) if (l.unread) fresh.current.add(l.id);
        setLeads(r.leads);
        setCounts(r.counts);
        const unread = r.leads.filter((l) => l.unread).map((l) => l.id);
        if (unread.length)
          brandApi
            .markRead(unread)
            .then((m) => {
              setCounts(m.counts);
              useBrandSummary.getState().setUnread(m.counts.unread);
            })
            .catch(() => undefined);
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load your leads.'));
    return () => {
      live = false;
    };
  }, [filter]);

  const update = (lead: Lead, c: LeadCounts) => {
    setLeads((ls) => ls?.map((l) => (l.id === lead.id ? lead : l)) ?? null);
    setCounts(c);
  };

  if (!state.brand) return <div className="pro-empty"><h2>No leads yet</h2><p>Once your page is live, homeowners’ requests arrive here.</p></div>;

  const total = counts?.total ?? 0;
  return (
    <div className="brand-leads">
      <div className="brand-toolbar">
        <div className="chips" role="group" aria-label="Filter leads">
          <button className={filter === 'all' ? 'chip on' : 'chip'} onClick={() => setFilter('all')} aria-pressed={filter === 'all'}>
            All <span className="muted">{total}</span>
          </button>
          {LEAD_STATUSES.map((s) => (
            <button key={s} className={filter === s ? 'chip on' : 'chip'} onClick={() => setFilter(s)} aria-pressed={filter === s}>
              {LEAD_STATUS_LABEL[s]} <span className="muted">{counts?.byStatus[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <span className="fine">No email alerts yet: check here, or watch the badge on the workspace tabs.</span>
      </div>
      {error && <div className="auth-error">{error}</div>}
      {!leads && !error && <div className="screen-msg">Loading your leads…</div>}
      {leads && leads.length === 0 && (
        <div className="pro-empty">
          <h2>{filter === 'all' ? 'No leads yet' : `No ${LEAD_STATUS_LABEL[filter as LeadStatus].toLowerCase()} leads`}</h2>
          <p>
            {state.brand.pageStatus === 'live'
              ? 'When a homeowner taps Contact or Request a quote on your page or a product, their request lands here.'
              : 'Once your page is live, homeowners’ requests arrive here.'}
          </p>
        </div>
      )}
      {leads && leads.length > 0 && (
        <ul className="brand-lead-list">
          {leads.map((l) => (
            <LeadCard key={l.id} lead={l} fresh={fresh.current.has(l.id)} company={state.brand!.name} readOnly={readOnly} onSaved={update} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LeadCard({ lead: l, fresh, company, readOnly, onSaved }: { lead: Lead; fresh: boolean; company: string; readOnly: boolean; onSaved: (l: Lead, c: LeadCounts) => void }) {
  const [notes, setNotes] = useState(l.notes);
  const [saving, setSaving] = useState(false);
  const toast = useDesignStore((s) => s.toast);
  const dirty = notes !== l.notes;

  const save = async (patch: { status?: LeadStatus; notes?: string }) => {
    setSaving(true);
    try {
      const r = await brandApi.updateLead(l.id, patch);
      onSaved(r.lead, r.counts);
      if (patch.notes !== undefined) toast('Notes saved.', 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save.', 'warn');
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className={`brand-lead${fresh ? ' is-new' : ''}`}>
      <div className="brand-lead-head">
        <div>
          <b className="brand-lead-name">{l.name}</b>
          {fresh && <span className="badge bad">New</span>}
          <span className="muted">
            {l.location ? `${l.location} · ` : ''}
            {timeAgo(l.createdAt)}
          </span>
        </div>
        <label className="brand-lead-status">
          <span className="mini-label">Status</span>
          <select className="brand-select" value={l.status} disabled={readOnly || saving} onChange={(e) => void save({ status: e.target.value as LeadStatus })} aria-label={`Status for ${l.name}`}>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(l.productName || l.kitchenAttached) && (
        <p className="brand-lead-about">
          {l.productName && (
            <span>
              About <b>{l.productName}</b>
              {l.productId && (
                <>
                  {' '}
                  (<a href={`#/p/${l.productId}`}>view</a>)
                </>
              )}
            </span>
          )}
          {l.kitchenAttached &&
            (l.shareToken ? (
              <a className="brand-lead-kitchen" href={`#/s/${l.shareToken}`}>
                Open their kitchen{l.projectName ? ` “${l.projectName}”` : ''} (view only)
              </a>
            ) : (
              <span className="brand-lead-kitchen">Kitchen attached{l.projectName ? `: “${l.projectName}”` : ''}. Its view-only link arrives with share links.</span>
            ))}
        </p>
      )}
      {l.message && <p className="brand-lead-msg">{l.message}</p>}
      <div className="brand-lead-actions">
        {l.phone && (
          <a className="btn" href={telHref(l.phone)}>
            Call {l.phone}
          </a>
        )}
        <a className="btn" href={leadMailto(l, company)}>
          Email {l.email}
        </a>
      </div>
      <label className="brand-lead-notes">
        <span className="mini-label">Private notes</span>
        <textarea className="brand-textarea" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={readOnly} placeholder="Only you see these." maxLength={4000} />
      </label>
      {dirty && !readOnly && (
        <div className="brand-lead-save">
          <button className="btn" onClick={() => setNotes(l.notes)} disabled={saving}>
            Undo
          </button>
          <button className="btn primary" onClick={() => void save({ notes })} disabled={saving}>
            {saving ? 'Saving…' : 'Save notes'}
          </button>
        </div>
      )}
    </li>
  );
}
