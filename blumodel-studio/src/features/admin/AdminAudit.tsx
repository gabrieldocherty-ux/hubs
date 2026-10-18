/**
 * Admin > Audit: every admin action that changed money or access (admin_audit), filtered by who,
 * what and when, 50 a page, newest first (GET /api/admin/audit). The account's email is copied in
 * when the action happens, so entries still read after an account is deleted.
 */
import { useState, type FormEvent } from 'react';
import { adminApi } from './api';
import { openUser } from './selection';
import type { AuditEntry } from './types';
import { DataTable, Section, dateTime, endDay, useLoad } from './ui';

export const ACTION_LABEL: Record<string, string> = {
  comp_grant: 'Complimentary plan given',
  comp_revoke: 'Complimentary plan ended',
  reset_link: 'Reset link made',
  model_grant: 'Extra models granted',
  export_without_payment: 'Admin export (unpaid)',
  retailer_update: 'Retailer settings changed',
  role_change: 'Role changed',
  sign_out_all: 'Signed out everywhere',
  account_disable: 'Account disabled',
  account_enable: 'Account enabled',
  account_delete: 'Account deleted',
  contractor_verify: 'Contractor verified',
  contractor_unverify: 'Contractor unverified',
  tenant_create: 'Company created',
  tenant_quick_setup: 'Showroom made with Quick setup',
  tenant_trial_extend: 'Trial extended',
  tenant_trial_end: 'Trial ended',
  tenant_trial_convert: 'Trial converted to a paying customer',
  tenant_images_ticket: 'Showroom picture generator opened',
  tenant_update: 'Company settings changed',
  tenant_status: 'Showroom status changed',
  tenant_hostname_add: 'Web address added',
  tenant_hostname_update: 'Web address changed',
  tenant_hostname_remove: 'Web address removed',
  tenant_member_add: 'Team member added',
  tenant_member_remove: 'Team member removed',
  tenant_license_record: 'License recorded',
  tenant_license_void: 'License voided',
  tenant_monthly_checkout: 'Monthly checkout link made',
  tenant_monthly_comp_on: 'Monthly plan made complimentary',
  tenant_monthly_comp_off: 'Complimentary monthly plan ended',
  tenant_monthly_cancel: 'Monthly plan cancelled',
  tenant_credit_adjust: 'Render credits adjusted',
  sales_lead_update: 'Sales lead updated',
};

const SKIP = new Set(['replaced', 'grantId', 'periodStart', 'periodEnd', 'brandId', 'counts', 'tenantId', 'licenseId', 'leadId']);

/** The detail object as a short line: "plan: contractor · ends: Oct 20, 2026 · note: Pilot". */
function detailLine(e: AuditEntry): string {
  const d = e.detail ?? {};
  const parts: string[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (SKIP.has(k) || v === null || v === undefined || v === '') continue;
    if (k === 'endsAt' && typeof v === 'number') parts.push(`ends after ${endDay(v)}`);
    else if (k === 'expiresAt' && typeof v === 'number') parts.push(`expires ${dateTime(v)}`);
    else if (typeof v === 'object') continue;
    else parts.push(`${k}: ${String(v)}`);
  }
  return parts.join(' · ');
}

export function AuditList({ entries, empty }: { entries: AuditEntry[]; empty: string }) {
  if (!entries.length) return <p className="empty-note">{empty}</p>;
  return (
    <ul className="adm-log">
      {entries.map((e) => (
        <li key={e.id}>
          <time>{dateTime(e.at)}</time>
          <b>{ACTION_LABEL[e.action] ?? e.action}</b>
          <span>
            by {e.adminEmail || 'the server'}
            {detailLine(e) ? ` · ${detailLine(e)}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

interface Filters {
  actor: string;
  action: string;
  from: string;
  to: string;
}
const NONE: Filters = { actor: '', action: '', from: '', to: '' };

export default function AdminAudit() {
  const [draft, setDraft] = useState<Filters>(NONE);
  const [filters, setFilters] = useState<Filters>(NONE);
  const [page, setPage] = useState(1);
  const { data, error, loading } = useLoad(() => adminApi.audit({ ...filters, page }), [filters, page]);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    setFilters({ ...draft, actor: draft.actor.trim() });
  };
  const clear = () => {
    setDraft(NONE);
    setFilters(NONE);
    setPage(1);
  };
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setDraft((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="adm adm-audit">
      <div className="adm-head">
        <div>
          <h1>Audit log</h1>
          <p>Every admin action that changed money or access: who did it, to which account, and when.</p>
        </div>
      </div>
      <form className="adm-toolbar" onSubmit={apply} aria-label="Filter the audit log">
        <label className="adm-field">
          <span>Admin</span>
          <input list="adm-audit-actors" value={draft.actor} onChange={set('actor')} placeholder="Any admin" />
          <datalist id="adm-audit-actors">
            {(data?.actors ?? []).map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
        </label>
        <label className="adm-field">
          <span>Action</span>
          <select value={draft.action} onChange={set('action')}>
            <option value="">Any action</option>
            {(data?.actions ?? []).map((a) => (
              <option key={a} value={a}>
                {ACTION_LABEL[a] ?? a}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-field">
          <span>From</span>
          <input type="date" value={draft.from} onChange={set('from')} />
        </label>
        <label className="adm-field">
          <span>To</span>
          <input type="date" value={draft.to} onChange={set('to')} />
        </label>
        <button type="submit" className="btn">
          Apply
        </button>
        <button type="button" className="btn" onClick={clear}>
          Clear
        </button>
      </form>
      {error && <div className="auth-error">{error}</div>}
      {!data ? (
        <div className="screen-msg">Loading the audit log…</div>
      ) : (
        <Section title={`${data.total} entr${data.total === 1 ? 'y' : 'ies'}`} id="adm-audit-list">
          <DataTable<AuditEntry>
            label="Audit log"
            rows={data.entries}
            rowKey={(e) => String(e.id)}
            empty="Nothing matches these filters."
            columns={[
              { label: 'Action', primary: true, cell: (e) => <b>{ACTION_LABEL[e.action] ?? e.action}</b> },
              { label: 'When', cell: (e) => dateTime(e.at) },
              { label: 'Admin', cell: (e) => e.adminEmail || 'the server' },
              {
                label: 'Account',
                cell: (e) =>
                  e.targetUserId && e.action !== 'account_delete' ? (
                    <button type="button" className="adm-link" onClick={() => openUser(e.targetUserId!)}>
                      {e.targetEmail || e.targetUserId}
                    </button>
                  ) : (
                    e.targetEmail || '—'
                  ),
              },
              { label: 'Details', cell: (e) => detailLine(e) || '—' },
            ]}
          />
          <div className="adm-pager">
            <span>
              Page {data.page} of {data.pages}
              {loading ? ' · loading…' : ''}
            </span>
            <span className="adm-actions">
              <button type="button" className="btn small" disabled={data.page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Newer
              </button>
              <button type="button" className="btn small" disabled={data.page >= data.pages || loading} onClick={() => setPage((p) => p + 1)}>
                Older
              </button>
            </span>
          </div>
        </Section>
      )}
    </div>
  );
}
