/**
 * Admin > Contractors: every contractor with their company, phone, plan, brand page and custom-model
 * allowance this period. Verify puts the Verified badge on their brand page (only once you are
 * satisfied the account really is that company); Extra models uses the existing grant
 * (POST /api/admin/model-grants), which only applies to the current period.
 */
import { useState, type FormEvent } from 'react';
import { Search } from '../../components/Icons';
import { adminApi } from './api';
import { openUser } from './selection';
import type { ContractorRow } from './types';
import { DataTable, Notice, PLAN_LABEL, Pill, Section, day, errorText, useLoad, type PillTone } from './ui';

const PAGE_LABEL: Record<string, [string, PillTone]> = {
  none: ['No page', 'plain'],
  draft: ['Draft', 'plain'],
  in_review: ['In review', 'info'],
  live: ['Live', 'ok'],
  hidden: ['Hidden (plan lapsed)', 'warn'],
  rejected: ['Rejected', 'bad'],
  suspended: ['Suspended', 'bad'],
};

function planCell(c: ContractorRow) {
  const p = c.plan;
  if (p.id === 'free') return <Pill tone="warn">{p.status === 'none' ? 'No plan' : `Free (${p.status.replace('_', ' ')})`}</Pill>;
  const extra = p.provider === 'comp' ? ' · comp' : p.provider === 'demo' ? ' · demo' : '';
  if (p.graceUntil) return <Pill tone="warn">{PLAN_LABEL[p.id]} · payment retrying</Pill>;
  if (p.cancelAtPeriodEnd) return <Pill tone="warn">{PLAN_LABEL[p.id]} · cancelling</Pill>;
  return <Pill tone="ok">{`${PLAN_LABEL[p.id]}${extra}`}</Pill>;
}

export default function AdminContractors() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, setData, error } = useLoad(() => adminApi.contractors(query), [query]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [grantFor, setGrantFor] = useState<string | null>(null);
  const [models, setModels] = useState(1);
  const [note, setNote] = useState('');

  const replace = (row: ContractorRow | null) => row && setData((d) => (d ? { contractors: d.contractors.map((c) => (c.userId === row.userId ? row : c)) } : d));
  const refreshRow = async (id: string, email: string) => replace((await adminApi.contractors(email)).contractors.find((c) => c.userId === id) ?? null);

  const verify = async (c: ContractorRow, verified: boolean) => {
    setBusy(`v-${c.userId}`);
    setMsg(null);
    try {
      replace((await adminApi.verifyContractor(c.userId, verified)).contractor);
      setMsg({ tone: 'ok', text: `${c.company || c.email} is ${verified ? 'now verified' : 'no longer verified'}.` });
    } catch (err) {
      setMsg({ tone: 'bad', text: errorText(err, 'Could not change verification.') });
    } finally {
      setBusy(null);
    }
  };

  const grant = async (e: FormEvent, c: ContractorRow) => {
    e.preventDefault();
    setBusy(`g-${c.userId}`);
    setMsg(null);
    try {
      await adminApi.grantModels(c.userId, models, note.trim());
      await refreshRow(c.userId, c.email);
      setMsg({ tone: 'ok', text: `${models} extra model${models === 1 ? '' : 's'} for ${c.company || c.email}, this period only.` });
      setGrantFor(null);
      setNote('');
      setModels(1);
    } catch (err) {
      setMsg({ tone: 'bad', text: errorText(err, 'Could not grant models.') });
    } finally {
      setBusy(null);
    }
  };

  const rows = data?.contractors ?? null;
  return (
    <div className="adm adm-contractors">
      <div className="adm-head">
        <div>
          <h1>Contractors</h1>
          <p>Company, plan, brand page and custom models this period. Verify only once you are satisfied the account really is that company.</p>
        </div>
      </div>
      <div className="adm-toolbar">
        <form
          className="home-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            setQuery(q);
          }}
        >
          <Search />
          <input placeholder="Search by company, name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search contractors" />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </div>
      {error && <div className="auth-error">{error}</div>}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {rows === null ? (
        <div className="screen-msg">Loading contractors…</div>
      ) : (
        <Section title={`${rows.length} contractor${rows.length === 1 ? '' : 's'}`} id="adm-contractors-list">
          <DataTable<ContractorRow>
            label="Contractors"
            rows={rows}
            rowKey={(c) => c.userId}
            empty={query ? 'No contractors match.' : 'No contractors yet.'}
            columns={[
              {
                label: 'Company',
                primary: true,
                cell: (c) => (
                  <span className="adm-who">
                    <button type="button" className="adm-link" onClick={() => openUser(c.userId)}>
                      {c.company || c.name}
                    </button>
                    <span>
                      {c.name} · {c.email}
                    </span>
                    {c.disabled && <Pill tone="bad">Disabled</Pill>}
                  </span>
                ),
              },
              { label: 'Phone', cell: (c) => c.phone || '—' },
              { label: 'Plan', cell: planCell },
              {
                label: 'Brand page',
                cell: (c) => {
                  const [text, tone] = PAGE_LABEL[c.brandPage?.state ?? 'none'] ?? [c.brandPage?.state ?? '', 'plain'];
                  return (
                    <span className="adm-actions">
                      <Pill tone={tone}>{text}</Pill>
                      {c.brandPage?.verified && <Pill tone="ok">Verified</Pill>}
                    </span>
                  );
                },
              },
              {
                label: 'Models',
                cell: (c) =>
                  c.models.active ? (
                    <span>
                      <span className="mono">
                        {c.models.used}/{c.models.total}
                      </span>{' '}
                      used · {c.models.left} left
                      <span className="adm-sub"> · resets {day(c.models.resetsAt)}</span>
                    </span>
                  ) : (
                    '—'
                  ),
              },
              {
                label: 'Actions',
                cell: (c) =>
                  grantFor === c.userId ? (
                    <form className="adm-inline" onSubmit={(e) => void grant(e, c)} aria-label={`Extra models for ${c.email}`}>
                      <input type="number" min={1} max={50} value={models} onChange={(e) => setModels(Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1))))} aria-label="Models" />
                      <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Note" aria-label="Note" style={{ width: 120 }} />
                      <button type="submit" className="btn small" disabled={busy === `g-${c.userId}`}>
                        {busy === `g-${c.userId}` ? 'Granting…' : 'Grant'}
                      </button>
                      <button type="button" className="btn small" onClick={() => setGrantFor(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <span className="adm-actions">
                      <button
                        type="button"
                        className="btn small"
                        disabled={!c.brandPage || busy === `v-${c.userId}`}
                        title={c.brandPage ? undefined : 'No brand page yet'}
                        onClick={() => void verify(c, !c.brandPage?.verified)}
                      >
                        {c.brandPage?.verified ? 'Unverify' : 'Verify'}
                      </button>
                      <button type="button" className="btn small" disabled={!c.models.active} title={c.models.active ? undefined : 'Not on the Contractor plan'} onClick={() => setGrantFor(c.userId)}>
                        Extra models
                      </button>
                    </span>
                  ),
              },
            ]}
          />
        </Section>
      )}
    </div>
  );
}
