/**
 * Admin > Prospects: everyone in the sales pipeline in one searchable place. The companies we reach
 * out to come from the outreach spreadsheet (uploaded here; a re-upload updates the same rows and
 * keeps the stage and notes set in this panel), and the search also finds the "Book a call"
 * requests from the sales site. Routes: server/routes/adminProspects.mjs (admin-only, audited).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { call } from '../../lib/api';
import { downloadText } from '../../lib/exporters';
import { hrefFor } from '../../lib/router';
import { Search } from '../../components/Icons';
import { SALES_STATUS } from './AdminSalesLeads';
import type { SalesLeadStatus } from './showroomTypes';
import { DataTable, Notice, Pill, Section, dateTime, day, errorText, useLoad, type PillTone } from './ui';

export const PROSPECT_STAGES = ['new', 'emailed', 'bounced', 'replied', 'call', 'demo', 'won', 'lost', 'do-not-contact'] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];

export const STAGE: Record<ProspectStage, [string, PillTone]> = {
  new: ['Not contacted', 'plain'],
  emailed: ['Emailed', 'info'],
  bounced: ['Bounced', 'bad'],
  replied: ['Replied', 'warn'],
  call: ['Call booked', 'warn'],
  demo: ['Demo', 'warn'],
  won: ['Won', 'ok'],
  lost: ['Lost', 'plain'],
  'do-not-contact': ['Do not contact', 'bad'],
};

export interface Prospect {
  id: string;
  company: string;
  city: string;
  province: string;
  type: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  contactName: string;
  contactRole: string;
  fit: number | null;
  pitch: string;
  outreach: string;
  notes: string;
  stage: ProspectStage;
  adminNotes: string;
  emailedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

interface FoundLead {
  id: string;
  company: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  message: string;
  status: SalesLeadStatus;
  adminNotes: string;
  createdAt: number;
}

interface ProspectList {
  prospects: Prospect[];
  total: number;
  page: number;
  pageSize: number;
  counts: Record<ProspectStage, number> & { total: number };
  provinces: { province: string; n: number }[];
  salesLeads: FoundLead[];
  importedAt: number | null;
}

type Sort = 'recent' | 'company' | 'fit';
type ImportResult = { added: number; updated: number; unchanged: number; skipped: number; total: number };

const enc = encodeURIComponent;
const api = {
  list: (p: { q: string; stage: string; province: string; sort: Sort; page: number }) =>
    call<ProspectList>('GET', `/api/admin/prospects?q=${enc(p.q)}&stage=${enc(p.stage)}&province=${enc(p.province)}&sort=${p.sort}&page=${p.page}`),
  importCsv: (csv: string) => call<ImportResult>('POST', '/api/admin/prospects/import', { csv }),
  add: (b: Partial<Prospect>) => call<{ prospect: Prospect }>('POST', '/api/admin/prospects', b),
  update: (id: string, b: { stage?: ProspectStage; adminNotes?: string }) => call<{ prospect: Prospect }>('PATCH', `/api/admin/prospects/${enc(id)}`, b),
  remove: (id: string) => call<{ ok: true }>('DELETE', `/api/admin/prospects/${enc(id)}`),
  exportCsv: () => call<{ filename: string; contentType: string; content: string }>('GET', '/api/admin/prospects/export'),
};

const site = (url: string) => url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
const href = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);
const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

export default function AdminProspects() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<'' | ProspectStage>('');
  const [province, setProvince] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Prospect | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const { data, setData, error, loading, reload } = useLoad(() => api.list({ q: query, stage, province, sort, page }), [query, stage, province, sort, page]);

  // Search as you type, a beat after the last key.
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (q.trim() !== query) {
        setQuery(q.trim());
        setPage(1);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [q, query]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(q.trim());
    setPage(1);
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setMsg(null);
    try {
      if (f.size > 3_900_000) throw new Error('big');
      const r = await api.importCsv(await f.text());
      const parts = [`${r.added} added`, `${r.updated} updated`, `${r.unchanged} unchanged`];
      if (r.skipped) parts.push(`${r.skipped} skipped (no company name)`);
      setMsg({ tone: 'ok', text: `Imported ${f.name}: ${parts.join(', ')}. ${r.total} companies on the list.` });
      await reload();
    } catch (x) {
      setMsg({ tone: 'bad', text: x instanceof Error && x.message === 'big' ? 'That file is over 4 MB. Split it into smaller files.' : errorText(x, 'Could not import that file.') });
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  const exportAll = async () => {
    setBusy(true);
    try {
      const f = await api.exportCsv();
      downloadText(f.content, f.filename, f.contentType);
    } catch (x) {
      setMsg({ tone: 'bad', text: errorText(x, 'Could not export.') });
    } finally {
      setBusy(false);
    }
  };

  const replace = (p: Prospect) => {
    setOpen((o) => (o?.id === p.id ? p : o));
    setData((d) => (d ? { ...d, prospects: d.prospects.map((x) => (x.id === p.id ? p : x)) } : d));
  };

  if (open)
    return (
      <ProspectView
        p={open}
        onBack={() => (setOpen(null), void reload())}
        onSaved={replace}
        onDeleted={() => {
          setOpen(null);
          void reload();
        }}
      />
    );

  const counts = data?.counts;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const leads = data?.salesLeads ?? [];

  return (
    <div className="adm admin-prospects">
      <div className="adm-head">
        <div>
          <h1>Prospects</h1>
          <p>
            The companies you reach out to and the ones who asked for a call, searchable together. Upload the outreach spreadsheet (.csv) to add or refresh the list: rows are matched on email, web address, or name and city, and what you set here
            is kept.
            {data?.importedAt ? ` Last imported ${dateTime(data.importedAt).replace(/\.$/, '')}.` : ''}
          </p>
        </div>
        <div className="adm-head-actions">
          <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => void upload(e.target.files?.[0])} aria-label="Spreadsheet to import" />
          <button type="button" className="btn small primary" disabled={busy} onClick={() => file.current?.click()}>
            {busy ? 'Working…' : 'Import spreadsheet'}
          </button>
          <button type="button" className="btn small" disabled={busy || !counts?.total} onClick={() => void exportAll()}>
            Export CSV
          </button>
          <button type="button" className="btn small" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
            Add a company
          </button>
        </div>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {adding && (
        <AddProspect
          onAdded={(p) => {
            setAdding(false);
            setMsg({ tone: 'ok', text: `${p.company} added.` });
            void reload();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      <div className="adm-toolbar adm-prospect-tools">
        <form className="home-search" onSubmit={submit} role="search">
          <Search />
          <input placeholder="Search company, city, contact, email, phone, notes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search prospects and leads" />
          {q && (
            <button type="button" className="btn small" onClick={() => (setQ(''), setQuery(''), setPage(1))}>
              Clear
            </button>
          )}
        </form>
        <label className="adm-field adm-inline">
          <span>Province</span>
          <select value={province} onChange={(e) => (setProvince(e.target.value), setPage(1))}>
            <option value="">All</option>
            {(data?.provinces ?? []).map((p) => (
              <option key={p.province} value={p.province}>
                {p.province} ({p.n})
              </option>
            ))}
          </select>
        </label>
        <label className="adm-field adm-inline">
          <span>Sort</span>
          <select value={sort} onChange={(e) => (setSort(e.target.value as Sort), setPage(1))}>
            <option value="recent">Recently emailed</option>
            <option value="fit">Best fit</option>
            <option value="company">Company A–Z</option>
          </select>
        </label>
      </div>
      <div className="adm-filters" role="group" aria-label="Show prospects at stage">
        <button type="button" className={stage === '' ? 'chip on' : 'chip'} aria-pressed={stage === ''} onClick={() => (setStage(''), setPage(1))}>
          All <span className="mono">{counts?.total ?? ''}</span>
        </button>
        {PROSPECT_STAGES.filter((s) => s === stage || (counts?.[s] ?? 0) > 0).map((s) => (
          <button key={s} type="button" className={stage === s ? 'chip on' : 'chip'} aria-pressed={stage === s} onClick={() => (setStage(s), setPage(1))}>
            {STAGE[s][0]} <span className="mono">{counts?.[s] ?? 0}</span>
          </button>
        ))}
      </div>
      {error && <div className="auth-error">{error}</div>}

      {leads.length > 0 && (
        <Section
          title={query ? `Asked for a call: ${leads.length} match${leads.length === 1 ? '' : 'es'}` : 'Asked for a call'}
          id="adm-prospect-leads"
          actions={
            <a className="adm-link" href={hrefFor({ name: 'admin', tab: 'sales-leads' })}>
              Open Sales leads
            </a>
          }
        >
          <DataTable<FoundLead>
            label="Book a call requests"
            rows={leads}
            rowKey={(l) => l.id}
            columns={[
              { label: 'Company', primary: true, cell: (l) => <b>{l.company}</b> },
              {
                label: 'Contact',
                cell: (l) => (
                  <span className="adm-stack">
                    <span>{l.name}</span>
                    <a className="adm-link adm-wrap" href={`mailto:${l.email}`}>
                      {l.email}
                    </a>
                    {l.phone && (
                      <a className="adm-link" href={tel(l.phone)}>
                        {l.phone}
                      </a>
                    )}
                  </span>
                ),
              },
              { label: 'City', cell: (l) => l.city || '—' },
              { label: 'Status', cell: (l) => <Pill tone={SALES_STATUS[l.status]?.[1] ?? 'plain'}>{SALES_STATUS[l.status]?.[0] ?? l.status}</Pill> },
              { label: 'Asked', cell: (l) => day(l.createdAt) },
            ]}
          />
        </Section>
      )}

      {!data ? (
        <div className="screen-msg">{loading ? 'Loading prospects…' : ''}</div>
      ) : counts?.total === 0 && !query && !province ? (
        <Section title="No prospects yet" id="adm-prospects-empty">
          <p className="empty-note">Import the outreach spreadsheet (BluModel-Prospects-ON-AB.csv) with Import spreadsheet. It needs a Name column; City, Province, Type, Phone, Website, Email, Contact name, Fit, Status and Notes are read when present.</p>
        </Section>
      ) : (
        <Section title={`${data.total} ${data.total === 1 ? 'company' : 'companies'}${query ? ` matching “${query}”` : ''}`} id="adm-prospects-list">
          <DataTable<Prospect>
            label="Prospects"
            rows={data.prospects}
            rowKey={(p) => p.id}
            empty={query ? 'No companies match that search.' : 'None at this stage.'}
            columns={[
              {
                label: 'Company',
                primary: true,
                cell: (p) => (
                  <span className="adm-stack">
                    <button type="button" className="adm-link adm-open" onClick={() => setOpen(p)}>
                      {p.company}
                    </button>
                    {p.type && <span className="adm-sub">{p.type}</span>}
                  </span>
                ),
              },
              { label: 'Where', cell: (p) => [p.city, p.province].filter(Boolean).join(', ') || '—' },
              {
                label: 'Contact',
                cell: (p) => (
                  <span className="adm-stack">
                    {p.contactName && <span>{p.contactName}</span>}
                    {p.email && (
                      <a className="adm-link adm-wrap" href={`mailto:${p.email}`}>
                        {p.email}
                      </a>
                    )}
                    {p.phone && (
                      <a className="adm-link" href={tel(p.phone)}>
                        {p.phone}
                      </a>
                    )}
                    {!p.contactName && !p.email && !p.phone && '—'}
                  </span>
                ),
              },
              { label: 'Fit', cell: (p) => (p.fit ? <span className="mono" title={`Fit ${p.fit} of 5`}>{'●'.repeat(p.fit)}{'○'.repeat(5 - p.fit)}</span> : '—') },
              { label: 'Stage', cell: (p) => <Pill tone={STAGE[p.stage]?.[1] ?? 'plain'}>{STAGE[p.stage]?.[0] ?? p.stage}</Pill> },
              { label: 'Emailed', cell: (p) => (p.emailedAt ? day(p.emailedAt) : '—') },
            ]}
          />
          {pages > 1 && (
            <div className="adm-pager">
              <button type="button" className="btn small" disabled={page <= 1 || loading} onClick={() => setPage((n) => n - 1)}>
                Previous
              </button>
              <span className="adm-note">
                Page {page} of {pages}
              </span>
              <button type="button" className="btn small" disabled={page >= pages || loading} onClick={() => setPage((n) => n + 1)}>
                Next
              </button>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function ProspectView({ p, onBack, onSaved, onDeleted }: { p: Prospect; onBack: () => void; onSaved: (p: Prospect) => void; onDeleted: () => void }) {
  const [notes, setNotes] = useState(p.adminNotes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setNotes(p.adminNotes), [p.adminNotes]);

  const save = async (b: { stage?: ProspectStage; adminNotes?: string }) => {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      onSaved((await api.update(p.id, b)).prospect);
      setSaved(true);
    } catch (x) {
      setErr(errorText(x, 'Could not save.'));
    } finally {
      setBusy(false);
    }
  };
  const row = (label: string, value: React.ReactNode) =>
    value ? (
      <>
        <dt>{label}</dt>
        <dd className="adm-wrap">{value}</dd>
      </>
    ) : null;

  return (
    <div className="adm admin-prospect">
      <div className="adm-head">
        <div>
          <button type="button" className="btn small" onClick={onBack}>
            ← All prospects
          </button>
          <h1>{p.company}</h1>
          <p>
            {[p.type, [p.city, p.province].filter(Boolean).join(', ')].filter(Boolean).join(' · ')} <Pill tone={STAGE[p.stage]?.[1] ?? 'plain'}>{STAGE[p.stage]?.[0] ?? p.stage}</Pill>
          </p>
        </div>
      </div>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="adm-cols">
        <Section title="Company" id="adm-prospect-company">
          <dl className="adm-kv">
            {row('Contact', [p.contactName, p.contactRole].filter(Boolean).join(', '))}
            {row(
              'Email',
              p.email && (
                <a className="adm-link" href={`mailto:${p.email}`}>
                  {p.email}
                </a>
              ),
            )}
            {row(
              'Phone',
              p.phone && (
                <a className="adm-link" href={tel(p.phone)}>
                  {p.phone}
                </a>
              ),
            )}
            {row(
              'Website',
              p.website && (
                <a className="adm-link" href={href(p.website)} target="_blank" rel="noopener noreferrer">
                  {site(p.website)}
                </a>
              ),
            )}
            {row('Address', p.address)}
            {row('Fit', p.fit ? `${p.fit} of 5` : '')}
            {row('Pitch', p.pitch)}
          </dl>
        </Section>
        <Section title="Outreach" id="adm-prospect-outreach">
          <dl className="adm-kv">
            {row('Spreadsheet', p.outreach || 'Not contacted')}
            {row('Emailed', p.emailedAt ? dateTime(p.emailedAt) : '')}
            {row('Research', p.notes)}
            {row('Added', day(p.createdAt))}
            {row('Updated', dateTime(p.updatedAt))}
          </dl>
          <div className="adm-form">
            <label className="adm-field adm-narrow">
              <span>Stage</span>
              <select value={p.stage} disabled={busy} onChange={(e) => void save({ stage: e.target.value as ProspectStage })}>
                {PROSPECT_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE[s][0]}
                  </option>
                ))}
              </select>
            </label>
            <label className="adm-field">
              <span>Our notes</span>
              <textarea value={notes} onChange={(e) => (setNotes(e.target.value), setSaved(false))} maxLength={4000} rows={4} placeholder="Spoke to the owner, call back after the 15th…" />
            </label>
            <div className="adm-actions">
              <button type="button" className="btn small" disabled={busy || notes.trim() === p.adminNotes} onClick={() => void save({ adminNotes: notes })}>
                Save notes
              </button>
              {saved && <span className="adm-note">Saved.</span>}
              {!confirming ? (
                <button type="button" className="btn small" disabled={busy} onClick={() => setConfirming(true)}>
                  Remove…
                </button>
              ) : (
                <>
                  <span className="adm-note">Remove {p.company} from the list? A later import adds it back unless it’s gone from the spreadsheet too.</span>
                  <button
                    type="button"
                    className="btn small danger"
                    disabled={busy}
                    onClick={() =>
                      void (async () => {
                        setBusy(true);
                        setErr(null);
                        try {
                          await api.remove(p.id);
                          onDeleted();
                        } catch (x) {
                          setErr(errorText(x, 'Could not remove it.'));
                          setBusy(false);
                        }
                      })()
                    }
                  >
                    Remove it
                  </button>
                  <button type="button" className="btn small" disabled={busy} onClick={() => setConfirming(false)}>
                    Keep
                  </button>
                </>
              )}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function AddProspect({ onAdded, onCancel }: { onAdded: (p: Prospect) => void; onCancel: () => void }) {
  const [f, setF] = useState({ company: '', city: '', province: '', type: '', phone: '', email: '', website: '', contactName: '', fit: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onAdded((await api.add({ ...f, fit: f.fit ? Number(f.fit) : null })).prospect);
    } catch (x) {
      setErr(errorText(x, 'Could not add it.'));
      setBusy(false);
    }
  };
  const field = (k: keyof typeof f, label: string, extra: Record<string, unknown> = {}) => (
    <label className="adm-field">
      <span>{label}</span>
      <input value={f[k]} onChange={set(k)} {...extra} />
    </label>
  );
  return (
    <Section title="Add a company" id="adm-prospect-add">
      <form className="adm-form adm-grid2" onSubmit={(e) => void submit(e)}>
        {field('company', 'Company', { required: true, maxLength: 200, autoFocus: true })}
        {field('type', 'Type', { placeholder: 'cabinet showroom', maxLength: 120 })}
        {field('city', 'City', { maxLength: 120 })}
        {field('province', 'Province', { placeholder: 'ON', maxLength: 40 })}
        {field('contactName', 'Contact', { maxLength: 120 })}
        {field('email', 'Email', { type: 'email', maxLength: 254 })}
        {field('phone', 'Phone', { type: 'tel', maxLength: 60 })}
        {field('website', 'Website', { maxLength: 300 })}
        <label className="adm-field">
          <span>Fit</span>
          <select value={f.fit} onChange={set('fit')}>
            <option value="">—</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} of 5
              </option>
            ))}
          </select>
        </label>
        {err && <Notice tone="bad">{err}</Notice>}
        <div className="adm-actions">
          <button type="submit" className="btn small primary" disabled={busy || !f.company.trim()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button type="button" className="btn small" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </Section>
  );
}
