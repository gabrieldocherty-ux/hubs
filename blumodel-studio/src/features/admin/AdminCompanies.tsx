/**
 * Admin > Companies (docs/SHOWROOM_PIVOT.md §8): the kitchen and bath companies we run a showroom
 * for. The list shows each one's standing at a glance; a company opens to everything about it:
 * status and why, the yearly license (recorded by hand: deals are closed by phone), the $50/month
 * plan (a Stripe Checkout link to send), web addresses (with the Cloudflare steps for a custom
 * domain), showroom settings, render credits (adjusted with a reason), the team, usage and its
 * studio modelling queue. Every write is an admin-only, CSRF-protected, audited server route
 * (server/routes/tenantsAdmin.mjs, tenantsBilling.mjs); the numbers come from adminShowrooms.mjs.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { amount as dollars, money } from '../../lib/money';
import plansJson from '../../data/plans.json';
import { useAppConfig } from '../../lib/config';
import { timeAgo } from '../../store/useSession';
import { showroomApi } from './showroomApi';
import { takePendingCompany } from './selection';
import type { AdminTenant, InviteLink, PaidHow, TenantHostname, TenantMember, TenantSettings, TenantStatus, TenantUsage } from './showroomTypes';
import { leadSummary } from './showroomTypes';
import { DataTable, Notice, Pill, Section, dateTime, day, errorText, useLoad, type PillTone } from './ui';

export const STATUS_PILL: Record<TenantStatus, [string, PillTone]> = {
  live: ['Live', 'ok'],
  lapsed: ['Lapsed', 'warn'],
  setup: ['Setting up', 'info'],
  suspended: ['Suspended', 'bad'],
};

const PAID_HOW: [PaidHow, string][] = [
  ['invoice', 'Invoice'],
  ['etransfer', 'e-Transfer'],
  ['cheque', 'Cheque'],
  ['card', 'Card'],
  ['cash', 'Cash'],
  ['comp', 'Complimentary'],
  ['other', 'Other'],
];
const PAID_LABEL = Object.fromEntries(PAID_HOW) as Record<PaidHow, string>;

// Prices from src/data/plans.json, the server's own price list (fallbacks: SHOWROOM_PIVOT §2). The
// setup and yearly license has no price there: it is quoted per company, and the admin types the
// amount agreed for each deal.
interface ShowroomPlanJson {
  id: string;
  priceCents: number | null;
  creditRolloverMonths?: number;
  breakdown?: { id: string; cents: number }[];
}
const PLAN_LIST = plansJson as unknown as ShowroomPlanJson[];
const MONTHLY_PLAN = PLAN_LIST.find((p) => p.id === 'showroom_monthly');
const MONTHLY_CENTS = MONTHLY_PLAN?.priceCents ?? 5000;
const part = (id: string, fallback: number) => MONTHLY_PLAN?.breakdown?.find((b) => b.id === id)?.cents ?? fallback;
const HOSTING_CENTS = part('hosting', 2500);
const CREDIT_CENTS = part('render_credits', 2500);
const ROLLOVER_MONTHS = MONTHLY_PLAN?.creditRolloverMonths ?? 3;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Like the server's slugify (server/tenancy/service.mjs), for the address preview only. */
export function slugPreview(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/&/g, ' ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'showroom'
  );
}

/** "1,250" or "1250.50" (dollars) → cents; null when it isn't an amount. */
export function dollarsToCents(s: string): number | null {
  const t = s.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/**
 * The base domain showrooms live under (blumodel.studio in production, localhost in dev and QA):
 * read off a company's own <slug>.<base> address, which the server always stores, else
 * GET /api/config's baseDomain when the client config carries it.
 */
export function baseDomainOf(cfg: unknown, tenants: AdminTenant[] = []): string {
  for (const t of tenants) {
    const own = t.hostnames?.find((h) => h.kind === 'subdomain' && h.hostname.startsWith(`${t.slug}.`));
    if (own) return own.hostname.slice(t.slug.length + 1);
  }
  const v = (cfg as { baseDomain?: unknown } | null)?.baseDomain;
  return typeof v === 'string' && v ? v : 'blumodel.studio';
}

/** `<host>` of an origin, for showing the address without the scheme. */
const hostOf = (url: string) => url.replace(/^[a-z]+:\/\//i, '').replace(/\/$/, '');

export function StatusPill({ status }: { status: TenantStatus }) {
  const [label, tone] = STATUS_PILL[status] ?? [status, 'plain'];
  return <Pill tone={tone}>{label}</Pill>;
}

/** The monthly plan in a few words. */
export function monthlyLabel(t: AdminTenant): [string, PillTone] {
  const m = t.monthly;
  if (!m) return ['Not started', 'warn'];
  const demo = m.provider === 'demo' ? ' (demo)' : '';
  if (m.provider === 'comp') return m.status === 'active' ? ['Complimentary', 'ok'] : ['Cancelled', 'bad'];
  if (m.status === 'canceled') return ['Cancelled', 'bad'];
  if (m.status === 'incomplete') return [`Not paid yet${demo}`, 'warn'];
  if (m.status === 'past_due') return m.paid && m.graceUntil ? [`Payment failed · grace to ${day(m.graceUntil)}${demo}`, 'warn'] : [`Past due${demo}`, 'bad'];
  if (m.cancelAtPeriodEnd) return [`Paid · ends ${day(m.periodEnd)}${demo}`, 'warn'];
  return m.paid ? [`Paid${demo}`, 'ok'] : [`Lapsed${demo}`, 'bad'];
}

function licenseLabel(t: AdminTenant): [string, PillTone] {
  if (t.license) return [`To ${t.license.endsOn}`, 'ok'];
  const next = (t.licenses ?? []).find((l) => !l.voidedAt && l.startsOn > new Date().toISOString().slice(0, 10));
  if (next) return [`Starts ${next.startsOn}`, 'info'];
  return [(t.licenses ?? []).some((l) => !l.voidedAt) ? 'Expired' : 'None', 'warn'];
}

/** Why a launched showroom is (or would be) lapsed, in plain words. */
function standingProblems(t: AdminTenant): string[] {
  const s = t.standing;
  if (!s) return [];
  const out: string[] = [];
  if (!s.licenseCurrent) out.push('no license covers today');
  if (!s.monthlyPaid) out.push('the monthly plan isn’t paid');
  return out;
}

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="adm-inline adm-copy">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn small"
        onClick={() =>
          void navigator.clipboard
            ?.writeText(value)
            .then(() => setCopied(true))
            .catch(() => setCopied(false))
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function InviteNotice({ invite, email, onDone }: { invite: InviteLink; email?: string; onDone: () => void }) {
  return (
    <div className="adm-form adm-callout" role="status">
      <b>Sign-in link{email ? ` for ${email}` : ''}</b>
      <p className="adm-note">
        {invite.emailed ? 'It was emailed to them. ' : 'Email isn’t set up here, so send it yourself. '}
        It sets their password on the showroom and works until {dateTime(invite.expiresAt)}. It won’t be shown again.
      </p>
      <CopyField value={invite.url} label="Sign-in link" />
      <div>
        <button type="button" className="btn small" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

// ── the list ────────────────────────────────────────────────────────────────

type Filter = 'all' | TenantStatus;
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['live', 'Live'],
  ['lapsed', 'Lapsed'],
  ['setup', 'Setting up'],
  ['suspended', 'Suspended'],
];

export default function AdminCompanies() {
  const [open, setOpen] = useState<string | null>(() => takePendingCompany());
  const [invite, setInvite] = useState<{ invite: InviteLink; email: string } | null>(null);
  const list = useLoad(() => showroomApi.list());
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);

  if (open)
    return (
      <CompanyView
        id={open}
        invite={invite}
        clearInvite={() => setInvite(null)}
        onBack={() => {
          setOpen(null);
          setInvite(null);
          void list.reload();
        }}
      />
    );

  const all = list.data?.tenants ?? null;
  const rows = (all ?? []).filter((t) => filter === 'all' || t.status === filter);
  const count = (f: Filter) => (all ?? []).filter((t) => f === 'all' || t.status === f).length;

  return (
    <div className="adm admin-companies">
      <div className="adm-head">
        <div>
          <h1>Companies</h1>
          <p>Every kitchen and bath company we run a showroom for. A showroom is live while its license covers today and its monthly plan is paid.</p>
        </div>
        <div className="adm-head-actions">
          <button type="button" className="btn primary" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
            {creating ? 'Close' : 'New company'}
          </button>
        </div>
      </div>
      {creating && (
        <CreateCompany
          tenants={all ?? []}
          onCreated={(t, inv, email) => {
            setCreating(false);
            if (inv) setInvite({ invite: inv, email });
            setOpen(t.id);
          }}
        />
      )}
      {list.error && <div className="auth-error">{list.error}</div>}
      <div className="adm-filters" role="group" aria-label="Show companies">
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" className={filter === f ? 'chip on' : 'chip'} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {label} <span className="mono">{all ? count(f) : ''}</span>
          </button>
        ))}
      </div>
      {all === null ? (
        <div className="screen-msg">Loading companies…</div>
      ) : (
        <Section title={filter === 'all' ? `${rows.length} compan${rows.length === 1 ? 'y' : 'ies'}` : `${rows.length} ${STATUS_PILL[filter as TenantStatus][0].toLowerCase()}`} id="adm-companies-list">
          <DataTable<AdminTenant>
            label="Companies"
            rows={rows}
            rowKey={(t) => t.id}
            empty={filter === 'all' ? 'No companies yet. Add the first one with New company.' : 'None right now.'}
            columns={[
              {
                label: 'Company',
                primary: true,
                cell: (t) => (
                  <span className="adm-who">
                    <button type="button" className="adm-link" onClick={() => setOpen(t.id)} aria-label={`Open ${t.name}`}>
                      {t.name}
                    </button>
                    <span>
                      {hostOf(t.url)}
                      {t.isDemo && (
                        <>
                          {' '}
                          <span className="adm-tag">demo</span>
                        </>
                      )}
                    </span>
                  </span>
                ),
              },
              { label: 'Status', cell: (t) => <StatusPill status={t.status} /> },
              {
                label: 'License',
                cell: (t) => {
                  const [l, tone] = licenseLabel(t);
                  return <Pill tone={tone}>{l}</Pill>;
                },
              },
              {
                label: 'Monthly',
                cell: (t) => {
                  const [l, tone] = monthlyLabel(t);
                  return <Pill tone={tone}>{l}</Pill>;
                },
              },
              { label: 'Credits', cell: (t) => <span className="mono">{money(t.credits?.balanceCents ?? 0)}</span> },
              {
                label: 'Leads',
                cell: (t) => (
                  <span className="mono">{leadSummary(t.leads)}</span>
                ),
              },
              { label: 'Renders', cell: (t) => <span className="mono">{t.usage?.rendersUsed ?? 0}</span> },
              {
                label: 'Products',
                cell: (t) => (
                  <span className="mono">
                    {t.usage?.products ?? 0} / {t.usage?.includedProducts ?? 50}
                  </span>
                ),
              },
              { label: 'Queue', cell: (t) => (t.usage?.queueOpen ? <Pill tone="info">{t.usage.queueOpen} open</Pill> : <span className="mono">0</span>) },
            ]}
          />
        </Section>
      )}
    </div>
  );
}

function CreateCompany({ onCreated, tenants }: { onCreated: (t: AdminTenant, invite: InviteLink | undefined, email: string) => void; tenants: AdminTenant[] }) {
  const cfg = useAppConfig();
  const base = baseDomainOf(cfg, tenants);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const shownSlug = slug.trim() || slugPreview(name);
  const slugBad = !!slug.trim() && !SLUG_RE.test(slug.trim());

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const out = await showroomApi.create({ name: name.trim(), slug: slug.trim() || undefined, ownerEmail: ownerEmail.trim() || undefined, ownerName: ownerName.trim() || undefined });
      onCreated(out.tenant, out.invite, ownerEmail.trim());
    } catch (x) {
      setErr(errorText(x, 'Could not create the company.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="New company" id="adm-new-company">
      <form className="adm-form" onSubmit={(e) => void submit(e)}>
        {err && <div className="auth-error">{err}</div>}
        <div className="adm-form-row">
          <label className="adm-field">
            <span>Company name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="Acme Kitchens" autoComplete="organization" />
          </label>
          <label className="adm-field">
            <span>Web address</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder={slugPreview(name || 'acme kitchens')} maxLength={40} aria-invalid={slugBad} />
          </label>
        </div>
        <p className="adm-note">
          Their showroom will be at <b className="mono">{`${shownSlug}.${base}`}</b>
          {slugBad ? ' — use lower-case letters, numbers and dashes.' : '.'} A custom domain can be added once it exists.
        </p>
        <div className="adm-form-row">
          <label className="adm-field">
            <span>Owner’s email (optional)</span>
            <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="owner@acmekitchens.ca" autoComplete="off" />
          </label>
          <label className="adm-field">
            <span>Owner’s name (optional)</span>
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} maxLength={80} autoComplete="off" />
          </label>
        </div>
        <p className="adm-note">The company starts in setup: reachable for its team, not yet launched. With an owner email, they get an account on the showroom and a 7-day sign-in link.</p>
        <div>
          <button type="submit" className="btn primary" disabled={busy || !name.trim() || slugBad}>
            {busy ? 'Creating…' : 'Create company'}
          </button>
        </div>
      </form>
    </Section>
  );
}

// ── one company ─────────────────────────────────────────────────────────────

type Act = <R>(name: string, fn: () => Promise<R>, message?: string | ((r: R) => string)) => Promise<R | null>;

function CompanyView({ id, onBack, invite, clearInvite }: { id: string; onBack: () => void; invite: { invite: InviteLink; email: string } | null; clearInvite: () => void }) {
  const { data, setData, error, reload } = useLoad(() => showroomApi.get(id), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [usageKey, setUsageKey] = useState(0);
  const usage = useLoad(() => showroomApi.usage(id), [id, usageKey]);

  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [id]);

  /** Runs one action; a `{ tenant }` answer replaces what is shown. */
  const act: Act = async (name, fn, message) => {
    setBusy(name);
    setMsg(null);
    try {
      const out = await fn();
      const t = (out as { tenant?: AdminTenant } | null)?.tenant;
      if (t) setData({ tenant: t });
      if (message) setMsg({ tone: 'ok', text: typeof message === 'function' ? message(out) : message });
      return out;
    } catch (err) {
      setMsg({ tone: 'bad', text: errorText(err, 'That didn’t work. Try again.') });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const back = (
    <div>
      <button type="button" className="btn small" onClick={onBack}>
        ← All companies
      </button>
    </div>
  );
  if (error && !data)
    return (
      <div className="adm">
        {back}
        <div className="auth-error">{error}</div>
      </div>
    );
  if (!data) return <div className="screen-msg">Loading the company…</div>;
  const t = data.tenant;
  const problems = standingProblems(t);

  return (
    <div className="adm adm-company">
      {back}
      <div className="adm-detail-head">
        <h1>{t.name}</h1>
        <div className="adm-badges">
          <StatusPill status={t.status} />
          {t.isDemo && <Pill tone="info">Our demo showroom</Pill>}
          <a className="adm-link" href={t.url} target="_blank" rel="noreferrer">
            {hostOf(t.url)}
          </a>
          <span className="adm-sub">Added {day(t.createdAt)}</span>
          <ImagesButton id={t.id} />
        </div>
      </div>
      {invite && <InviteNotice invite={invite.invite} email={invite.email} onDone={clearInvite} />}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {t.status === 'lapsed' && <Notice tone="warn">Visitors see “temporarily unavailable” because {problems.join(' and ') || 'it isn’t paid up'}. Nothing is deleted; it goes live by itself once both are in place.</Notice>}
      {t.status === 'suspended' && <Notice tone="bad">Suspended{t.statusNote ? `: ${t.statusNote}` : ''}. Visitors see “temporarily unavailable”; all data is kept.</Notice>}

      <div className="adm-cols">
        <StatusSection t={t} act={act} busy={busy} />
        <UsageSection t={t} data={usage.data} error={usage.error} />
      </div>
      <div className="adm-cols">
        <LicenseSection t={t} act={act} busy={busy} />
        <MonthlySection t={t} act={act} busy={busy} />
      </div>
      <div className="adm-cols">
        <HostnamesSection t={t} act={act} busy={busy} />
        <SettingsSection t={t} act={act} busy={busy} />
      </div>
      <div className="adm-cols">
        <CreditsSection id={t.id} onChange={() => (void reload(), setUsageKey((k) => k + 1))} />
        <TeamSection t={t} onChange={() => void reload()} />
      </div>
      <QueueSection data={usage.data} error={usage.error} />
    </div>
  );
}

/**
 * Admin > Companies > Generate showroom images: opens the showroom's picture generator in a new
 * tab, in this browser (the renders are made here, never on the server), with a 2-hour ticket.
 */
function ImagesButton({ id }: { id: string }) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const go = async () => {
    // Opened now, while the click still counts, so no pop-up blocker stops it; pointed at the link below.
    const win = window.open('about:blank', '_blank');
    setState({ busy: true, error: null });
    try {
      const { url } = await showroomApi.imagesLink(id);
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else location.href = url;
      setState({ busy: false, error: null });
    } catch (e) {
      win?.close();
      setState({ busy: false, error: e instanceof Error ? e.message : 'Couldn’t open the generator.' });
    }
  };
  return (
    <>
      <button type="button" className="btn small" onClick={() => void go()} disabled={state.busy}>
        {state.busy ? 'Opening…' : 'Generate showroom images'}
      </button>
      {state.error && <span className="adm-sub" role="alert">{state.error}</span>}
    </>
  );
}

interface SectionProps {
  t: AdminTenant;
  act: Act;
  busy: string | null;
}

function Confirm({ text, yes, onYes, onNo, busy, danger }: { text: string; yes: string; onYes: () => void; onNo: () => void; busy: boolean; danger?: boolean }) {
  return (
    <div className="adm-inline">
      <span className="adm-note">{text}</span>
      <button type="button" className={danger ? 'btn danger small' : 'btn small'} disabled={busy} onClick={onYes}>
        {yes}
      </button>
      <button type="button" className="btn small" onClick={onNo}>
        Cancel
      </button>
    </div>
  );
}

function StatusSection({ t, act, busy }: SectionProps) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<null | 'suspend' | 'setup'>(null);
  const problems = standingProblems(t);
  const launch = (label: string) => (
    <button type="button" className="btn primary" disabled={!!busy} onClick={() => void act('status', () => showroomApi.setStatus(t.id, 'live'), (r) => (r.tenant.status === 'live' ? `${t.name} is live.` : `${t.name} is launched but lapsed: ${standingProblems(r.tenant).join(' and ')}.`))}>
      {label}
    </button>
  );
  return (
    <Section title="Status" id="adm-co-status">
      <dl className="adm-kv">
        <dt>Now</dt>
        <dd>
          <StatusPill status={t.status} />
        </dd>
        <dt>License</dt>
        <dd>{t.standing?.licenseCurrent ? <Pill tone="ok">Covers today</Pill> : <Pill tone="warn">Not current</Pill>}</dd>
        <dt>Monthly plan</dt>
        <dd>{t.standing?.monthlyPaid ? <Pill tone="ok">Paid</Pill> : <Pill tone="warn">Not paid</Pill>}</dd>
        {t.statusNote && (
          <>
            <dt>Last status note</dt>
            <dd>{t.statusNote}</dd>
          </>
        )}
      </dl>
      <div className="adm-form">
        {t.status === 'setup' && (
          <>
            <p className="adm-note">{problems.length ? `Launching now leaves it lapsed (${problems.join(' and ')}). Record the license and start the monthly plan first.` : 'License and monthly plan are in place: launching makes it live for visitors.'}</p>
            <div className="adm-actions">{launch('Launch showroom')}</div>
          </>
        )}
        {t.status === 'suspended' && (
          <>
            <p className="adm-note">Restoring makes it live again (lapsed if the license or monthly plan ran out meanwhile).</p>
            <div className="adm-actions">{launch('Restore showroom')}</div>
          </>
        )}
        {(t.status === 'live' || t.status === 'lapsed') && (
          <>
            <label className="adm-field">
              <span>Reason (shown to us, required to suspend)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Asked to pause over the winter" />
            </label>
            {confirm ? (
              <Confirm
                text={confirm === 'suspend' ? `Suspend ${t.name}? Visitors and staff see “temporarily unavailable” until you restore it.` : `Move ${t.name} back to setup? Visitors can reach it while staff rebuild it.`}
                yes={confirm === 'suspend' ? 'Yes, suspend' : 'Yes, back to setup'}
                danger={confirm === 'suspend'}
                busy={!!busy}
                onNo={() => setConfirm(null)}
                onYes={() =>
                  void act('status', () => showroomApi.setStatus(t.id, confirm === 'suspend' ? 'suspended' : 'setup', reason.trim() || undefined), confirm === 'suspend' ? `${t.name} is suspended.` : `${t.name} is back in setup.`).then(() => setConfirm(null))
                }
              />
            ) : (
              <div className="adm-actions">
                <button type="button" className="btn danger" disabled={!!busy || !reason.trim()} onClick={() => setConfirm('suspend')}>
                  Suspend
                </button>
                <button type="button" className="btn" disabled={!!busy} onClick={() => setConfirm('setup')}>
                  Back to setup
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

/** Most a license can be recorded at (the server's limit, 100,000,000 cents). */
const MAX_LICENSE_CENTS = 100_000_000;

/** Why the typed license amount can't be recorded, or null when it can. There is no default amount. */
export function licenseAmountProblem(s: string): string | null {
  if (!s.trim()) return 'Type the amount agreed with the company.';
  const cents = dollarsToCents(s);
  if (cents === null) return 'Type an amount in dollars, like 1250 or 1250.50.';
  if (cents > MAX_LICENSE_CENTS) return 'That amount is too large.';
  return null;
}

function LicenseSection({ t, act, busy }: SectionProps) {
  const [amount, setAmount] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [paidHow, setPaidHow] = useState<PaidHow>('invoice');
  const [note, setNote] = useState('');
  const [voiding, setVoiding] = useState<string | null>(null);
  const cents = dollarsToCents(amount);
  const problem = licenseAmountProblem(amount);
  const licenses = t.licenses ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problem || cents === null) return;
    const ok = await act(
      'license',
      () => showroomApi.recordLicense(t.id, { amountCents: cents, startsOn: startsOn || undefined, endsOn: endsOn || undefined, paidHow, note: note.trim() }),
      (r) => `License recorded: ${money(r.license.amountCents, r.license.currency)}, ${r.license.startsOn} to ${r.license.endsOn}.`,
    );
    if (ok) {
      setAmount('');
      setNote('');
      setStartsOn('');
      setEndsOn('');
    }
  };

  return (
    <Section title="Yearly license" id="adm-co-license">
      {t.license ? (
        <p className="adm-note">
          <b>
            {money(t.license.amountCents, t.license.currency)} · {t.license.startsOn} to {t.license.endsOn}
          </b>{' '}
          ({PAID_LABEL[t.license.paidHow] ?? t.license.paidHow})
        </p>
      ) : (
        <Notice tone="warn">No license covers today.</Notice>
      )}
      {licenses.length > 0 && (
        <ul className="adm-log adm-rows">
          {licenses.map((l) => (
            <li key={l.id}>
              <span className="mono">
                {l.startsOn} → {l.endsOn}
              </span>
              <b>
                {money(l.amountCents, l.currency)} · {PAID_LABEL[l.paidHow] ?? l.paidHow}
                {l.voidedAt && (
                  <>
                    {' '}
                    <Pill tone="bad">Voided</Pill>
                  </>
                )}
              </b>
              <span>
                {l.note || ''}
                {l.recordedBy ? `${l.note ? ' · ' : ''}by ${l.recordedBy}` : ''}
                {!l.voidedAt &&
                  (voiding === l.id ? (
                    <Confirm text="Void it? It stays in the record." yes="Yes, void" danger busy={!!busy} onNo={() => setVoiding(null)} onYes={() => void act('void', () => showroomApi.voidLicense(t.id, l.id), 'License voided.').then(() => setVoiding(null))} />
                  ) : (
                    <>
                      {' '}
                      <button type="button" className="btn small" onClick={() => setVoiding(l.id)}>
                        Void
                      </button>
                    </>
                  ))}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="adm-form adm-subform" onSubmit={(e) => void submit(e)}>
        <b>Record a license</b>
        <div className="adm-form-row">
          <label className="adm-field">
            <span>Amount (CAD)</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="The amount agreed"
              required
              aria-invalid={amount.trim() !== '' && problem !== null}
              aria-describedby="adm-license-amount-hint"
            />
          </label>
          <label className="adm-field">
            <span>How it was paid</span>
            <select value={paidHow} onChange={(e) => setPaidHow(e.target.value as PaidHow)}>
              {PAID_HOW.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="adm-form-row">
          <label className="adm-field">
            <span>Starts (empty: today)</span>
            <input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </label>
          <label className="adm-field">
            <span>Ends (empty: a year)</span>
            <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </label>
        </div>
        <label className="adm-field">
          <span>Note</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Invoice 1042, starting range as quoted" />
        </label>
        <p className="adm-note" id="adm-license-amount-hint">
          {amount.trim() !== '' && problem ? <b>{problem} </b> : null}
          There is no list price: the setup and license are quoted per company, so type the amount on this company’s order or invoice. Dates are calendar days (UTC), both
          included.
        </p>
        <div>
          <button type="submit" className="btn" disabled={!!busy || problem !== null}>
            {busy === 'license' ? 'Recording…' : 'Record license'}
          </button>
        </div>
      </form>
    </Section>
  );
}

function MonthlySection({ t, act, busy }: SectionProps) {
  const cfg = useAppConfig();
  const m = t.monthly ?? null;
  const [label, tone] = monthlyLabel(t);
  const [confirm, setConfirm] = useState(false);
  const [compNote, setCompNote] = useState('');
  const pending = (t.checkouts ?? []).filter((c) => c.status === 'pending' && c.url);
  const latest = pending[0] ?? null;
  const running = !!m && m.status !== 'canceled';
  const stripePaid = !!m && m.provider === 'stripe' && m.status !== 'canceled' && m.paid;
  const demoPayments = cfg?.payments === 'demo';

  return (
    <Section title={`Monthly plan (${dollars(MONTHLY_CENTS)}/month)`} id="adm-co-monthly">
      <dl className="adm-kv">
        <dt>Plan</dt>
        <dd>
          <Pill tone={tone}>{label}</Pill>
        </dd>
        {m && m.provider !== 'comp' && (
          <>
            <dt>{m.cancelAtPeriodEnd ? 'Ends' : 'Renews'}</dt>
            <dd>{m.periodEnd ? day(m.periodEnd) : '—'}</dd>
          </>
        )}
        {m?.graceUntil && (
          <>
            <dt>Grace until</dt>
            <dd>{dateTime(m.graceUntil)}</dd>
          </>
        )}
        {m && (
          <>
            <dt>Card on file</dt>
            <dd>{m.hasPaymentMethod ? 'Yes' : 'No'}</dd>
          </>
        )}
        {m?.note && (
          <>
            <dt>Note</dt>
            <dd>{m.note}</dd>
          </>
        )}
      </dl>
      <p className="adm-note">{dollars(HOSTING_CENTS)} hosting with their web address + {dollars(CREDIT_CENTS)} of render credits a month, through Stripe. A failed payment gets 14 days of grace before the showroom lapses.</p>
      <div className="adm-form">
        {latest && (
          <>
            <b>Checkout link to send</b>
            <CopyField value={latest.url ?? ''} label="Monthly plan checkout link" />
            <p className="adm-note">
              Made {timeAgo(latest.createdAt)}
              {latest.provider === 'demo' ? ' (demo payments: nothing is charged)' : ''}. Send it to the company by email; the plan starts when they pay.
            </p>
          </>
        )}
        <div className="adm-actions">
          <button type="button" className="btn primary" disabled={!!busy || stripePaid} onClick={() => void act('checkout', () => showroomApi.monthlyCheckout(t.id), 'Checkout link created. Copy it and send it to the company.')}>
            {busy === 'checkout' ? 'Creating…' : latest ? 'New checkout link' : 'Create checkout link'}
          </button>
          {running &&
            (confirm ? (
              <Confirm
                text={m?.provider === 'stripe' ? 'Cancel when the month already paid for ends?' : 'Cancel the monthly plan?'}
                yes="Yes, cancel"
                danger
                busy={!!busy}
                onNo={() => setConfirm(false)}
                onYes={() => void act('cancel', () => showroomApi.monthlyCancel(t.id), 'Monthly plan cancelled.').then(() => setConfirm(false))}
              />
            ) : (
              <button type="button" className="btn" disabled={!!busy} onClick={() => setConfirm(true)}>
                Cancel plan
              </button>
            ))}
        </div>
        {(!m || m.provider === 'comp' || m.status === 'canceled') && (
          <div className="adm-form adm-subform">
            <b>Complimentary</b>
            {m?.provider === 'comp' && m.status === 'active' ? (
              <div>
                <button type="button" className="btn small" disabled={!!busy} onClick={() => void act('comp', () => showroomApi.monthlyComp(t.id, false), 'Complimentary plan ended.')}>
                  End complimentary plan
                </button>
              </div>
            ) : (
              <div className="adm-inline">
                <input value={compNote} onChange={(e) => setCompNote(e.target.value)} placeholder="Why (e.g. launch partner)" aria-label="Why the plan is complimentary" maxLength={500} />
                <button type="button" className="btn small" disabled={!!busy || !compNote.trim()} onClick={() => void act('comp', () => showroomApi.monthlyComp(t.id, true, compNote.trim()), 'Complimentary monthly plan on.')}>
                  Make it complimentary
                </button>
              </div>
            )}
          </div>
        )}
        {demoPayments && m?.provider === 'demo' && (
          <div className="adm-actions" aria-label="Demo payment events">
            <span className="adm-tag">demo</span>
            <button type="button" className="btn small" disabled={!!busy} onClick={() => void act('demo', () => showroomApi.monthlyDemo(t.id, 'renewal'), 'Demo renewal paid.')}>
              Renewal paid
            </button>
            <button type="button" className="btn small" disabled={!!busy} onClick={() => void act('demo', () => showroomApi.monthlyDemo(t.id, 'renewal_failed'), 'Demo renewal failed: grace started.')}>
              Renewal failed
            </button>
            <button type="button" className="btn small" disabled={!!busy} onClick={() => void act('demo', () => showroomApi.monthlyDemo(t.id, 'grace_end'), 'Demo grace ended.')}>
              End grace
            </button>
          </div>
        )}
      </div>
    </Section>
  );
}

function HostnamesSection({ t, act, busy }: SectionProps) {
  const cfg = useAppConfig();
  const base = baseDomainOf(cfg, [t]);
  const [host, setHost] = useState('');
  const [kind, setKind] = useState<'custom' | 'subdomain'>('custom');
  const own = `${t.slug}.${base}`;
  const sample = t.hostnames.find((h) => h.kind === 'custom')?.hostname || host.trim().toLowerCase() || 'showroom.theircompany.ca';
  const label = sample.split('.')[0];

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await act('host-add', () => showroomApi.addHostname(t.id, host.trim(), kind), kind === 'custom' ? `Added. Follow the Cloudflare steps below, then mark it verified.` : 'Address added.');
    if (ok) setHost('');
  };
  const rowActions = (h: TenantHostname) => (
    <div className="adm-actions">
      {h.kind === 'custom' && (
        <button type="button" className="btn small" disabled={!!busy} onClick={() => void act('host', () => showroomApi.updateHostname(t.id, h.hostname, { verified: !h.verified }), h.verified ? `${h.hostname} marked not verified: it stops answering.` : `${h.hostname} verified: it now opens the showroom.`)}>
          {h.verified ? 'Unverify' : 'Mark verified'}
        </button>
      )}
      {!h.primary && (h.verified || h.kind === 'subdomain') && (
        <button type="button" className="btn small" disabled={!!busy} onClick={() => void act('host', () => showroomApi.updateHostname(t.id, h.hostname, { primary: true }), `${h.hostname} is now the main address (links and emails use it).`)}>
          Make main
        </button>
      )}
      {h.hostname !== own && (
        <button type="button" className="btn small danger" disabled={!!busy} onClick={() => void act('host', () => showroomApi.removeHostname(t.id, h.hostname), `${h.hostname} removed.`)}>
          Remove
        </button>
      )}
    </div>
  );

  return (
    <Section title="Web addresses" id="adm-co-hosts">
      <p className="adm-note">
        Included in the monthly plan. Every company has <b className="mono">{own}</b> from day one; a domain they own can point at us at no charge.
      </p>
      <DataTable<TenantHostname>
        label="Web addresses"
        rows={t.hostnames}
        rowKey={(h) => h.hostname}
        empty="No addresses yet."
        columns={[
          { label: 'Address', primary: true, cell: (h) => <span className="mono adm-wrap">{h.hostname}</span> },
          {
            label: 'State',
            cell: (h) => (
              <span className="adm-actions">
                {h.primary && <Pill tone="info">Main</Pill>}
                {h.verified ? <Pill tone="ok">{h.kind === 'subdomain' ? 'Ours' : 'Verified'}</Pill> : <Pill tone="warn">Not verified</Pill>}
              </span>
            ),
          },
          { label: 'Actions', cell: rowActions },
        ]}
      />
      <form className="adm-form adm-subform" onSubmit={(e) => void add(e)}>
        <b>Add an address</b>
        <div className="adm-form-row">
          <label className="adm-field">
            <span>Address</span>
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder={kind === 'custom' ? 'showroom.acmekitchens.ca' : `acme.${base}`} maxLength={253} autoCapitalize="none" spellCheck={false} />
          </label>
          <label className="adm-field">
            <span>Kind</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as 'custom' | 'subdomain')}>
              <option value="custom">Their own domain</option>
              <option value="subdomain">{`Another .${base} name`}</option>
            </select>
          </label>
        </div>
        <div>
          <button type="submit" className="btn" disabled={!!busy || !host.trim()}>
            Add address
          </button>
        </div>
      </form>
      <details className="adm-steps">
        <summary>Connecting a custom domain in Cloudflare</summary>
        <ol>
          <li>
            In Cloudflare, open the <b>{base}</b> zone, then <b>SSL/TLS › Custom Hostnames</b> (Cloudflare for SaaS). The first time only: set the <b>fallback origin</b> to a proxied record that goes to our tunnel (for example <span className="mono">showrooms.{base}</span>, a CNAME to the tunnel).
          </li>
          <li>
            <b>Add Custom Hostname</b>: <span className="mono adm-wrap">{sample}</span>, certificate validation by HTTP (or TXT if their DNS host needs it).
          </li>
          <li>
            Ask the company to add a <b>CNAME</b> at their DNS host: <span className="mono adm-wrap">{label}</span> → <span className="mono">showrooms.{base}</span> (the fallback origin), plus any TXT record Cloudflare lists for validation.
          </li>
          <li>The tunnel must hand every hostname to the server: its ingress needs a catch-all rule to the app after the *.{base} rule (docs/HOSTING.md).</li>
          <li>
            When Cloudflare shows the hostname and its certificate as <b>Active</b> and <span className="mono adm-wrap">https://{sample}</span> loads, add it here and press <b>Mark verified</b>. Until then that address answers “unknown showroom”.
          </li>
        </ol>
      </details>
    </Section>
  );
}

function SettingsSection({ t, act, busy }: SectionProps) {
  const [s, setS] = useState<TenantSettings>(t.settings);
  useEffect(() => setS(t.settings), [t.settings]);
  const dirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(t.settings), [s, t.settings]);
  const toggle = (k: 'fillGaps' | 'bathrooms' | 'visitorRenders', label: string, note: ReactNode) => (
    <label className="adm-check">
      <input type="checkbox" checked={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />
      <span>
        <b>{label}</b>
        <span className="adm-note">{note}</span>
      </span>
    </label>
  );
  return (
    <Section title="Showroom settings" id="adm-co-settings">
      <div className="adm-form">
        {toggle('fillGaps', 'Fill the gaps with BluModel Basics', 'Our basic cabinets and appliances next to their own products, never with store links.')}
        {toggle('bathrooms', 'Bathrooms', 'A “Design your bathroom” button on their landing page.')}
        {toggle('visitorRenders', 'Visitor renders', 'Signed-in visitors can make photoreal renders, paid from the company’s credits. Staff always can.')}
        <label className="adm-field adm-narrow">
          <span>Visitor renders a day (whole showroom)</span>
          <input type="number" min={0} max={1000} step={1} value={s.dailyRenderCap} disabled={!s.visitorRenders} onChange={(e) => setS({ ...s, dailyRenderCap: Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0))) })} />
        </label>
        <div className="adm-actions">
          <button type="button" className="btn" disabled={!!busy || !dirty} onClick={() => void act('settings', () => showroomApi.update(t.id, { settings: s }), 'Settings saved.')}>
            Save settings
          </button>
          {dirty && (
            <button type="button" className="btn small" onClick={() => setS(t.settings)}>
              Undo
            </button>
          )}
        </div>
      </div>
    </Section>
  );
}

const ENTRY_LABEL: Record<string, string> = {
  grant: 'Monthly credits',
  expire: 'Expired',
  reserve: 'Render started',
  charge: 'Render charged',
  release: 'Render failed, returned',
  refund: 'Refunded',
  adjust: 'Adjusted by us',
};

function CreditsSection({ id, onChange }: { id: string; onChange: () => void }) {
  const { data, setData, error } = useLoad(() => showroomApi.credits(id), [id]);
  const [sign, setSign] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [all, setAll] = useState(false);
  const cents = dollarsToCents(amount);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!cents || !reason.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      setData(await showroomApi.adjustCredits(id, sign === 'add' ? cents : -cents, reason.trim()));
      setMsg({ tone: 'ok', text: `${sign === 'add' ? 'Added' : 'Removed'} ${money(cents)} of credits.` });
      setAmount('');
      setReason('');
      onChange();
    } catch (x) {
      setMsg({ tone: 'bad', text: errorText(x, 'Could not adjust the credits.') });
    } finally {
      setBusy(false);
    }
  };

  const history = data?.history ?? [];
  return (
    <Section title="Render credits" id="adm-co-credits">
      {error && <div className="auth-error">{error}</div>}
      {!data ? (
        <p className="empty-note">Loading credits…</p>
      ) : (
        <>
          <dl className="adm-kv">
            <dt>Balance</dt>
            <dd>
              <b className="mono">{money(data.balanceCents)}</b>
            </dd>
            {data.heldCents > 0 && (
              <>
                <dt>Held for renders</dt>
                <dd className="mono">{money(data.heldCents)}</dd>
              </>
            )}
            <dt>Next expiry</dt>
            <dd>{data.nextExpiry ? `${money(data.nextExpiry.cents)} on ${day(data.nextExpiry.at)}` : '—'}</dd>
          </dl>
          <p className="adm-note">Each paid month adds {dollars(CREDIT_CENTS)}. Credits last {ROLLOVER_MONTHS} months and the oldest are spent first.</p>
        </>
      )}
      <form className="adm-form adm-subform" onSubmit={(e) => void submit(e)}>
        <b>Adjust</b>
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
        <div className="adm-form-row">
          <label className="adm-field">
            <span>Add or remove</span>
            <select value={sign} onChange={(e) => setSign(e.target.value as 'add' | 'remove')}>
              <option value="add">Add</option>
              <option value="remove">Remove</option>
            </select>
          </label>
          <label className="adm-field">
            <span>Amount (CAD)</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25" aria-invalid={!!amount && !cents} />
          </label>
        </div>
        <label className="adm-field">
          <span>Reason (required, kept in the audit log)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Make-good for the failed renders on Oct 12" />
        </label>
        <div>
          <button type="submit" className="btn" disabled={busy || !cents || !reason.trim()}>
            {busy ? 'Saving…' : sign === 'add' ? 'Add credits' : 'Remove credits'}
          </button>
        </div>
      </form>
      {history.length > 0 && (
        <>
          <ul className="adm-log" aria-label="Credit history">
            {(all ? history : history.slice(0, 8)).map((e) => (
              <li key={e.id}>
                <time>{dateTime(e.at)}</time>
                <b>
                  {ENTRY_LABEL[e.kind] ?? e.kind} <span className="mono">{e.cents > 0 ? '+' : ''}{e.cents ? money(e.cents) : ''}</span>
                </b>
                <span>
                  balance {money(e.balanceAfter)}
                  {e.note ? ` · ${e.note}` : ''}
                  {e.by ? ` · ${e.by}` : ''}
                </span>
              </li>
            ))}
          </ul>
          {history.length > 8 && (
            <div>
              <button type="button" className="btn small" onClick={() => setAll((v) => !v)}>
                {all ? 'Show fewer' : `Show all ${history.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function TeamSection({ t, onChange }: { t: AdminTenant; onChange: () => void }) {
  const [members, setMembers] = useState<TenantMember[]>(t.members);
  useEffect(() => setMembers(t.members), [t.members]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'owner' | 'staff'>('staff');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [invite, setInvite] = useState<{ invite: InviteLink; email: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const out = await showroomApi.addMember(t.id, { email: email.trim(), role, name: name.trim() || undefined });
      setMembers((ms) => [...ms.filter((m) => m.userId !== out.member.userId), out.member]);
      if (out.invite) setInvite({ invite: out.invite, email: out.member.email });
      setMsg({ tone: 'ok', text: out.invite ? `${out.member.email} added as ${out.member.role}.` : `${out.member.email} already had an account on the showroom and is now ${out.member.role}.` });
      setEmail('');
      setName('');
      onChange();
    } catch (x) {
      setMsg({ tone: 'bad', text: errorText(x, 'Could not add them.') });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (m: TenantMember) => {
    setBusy(true);
    setMsg(null);
    try {
      setMembers((await showroomApi.removeMember(t.id, m.userId)).members);
      setMsg({ tone: 'ok', text: `${m.email} removed from the team. Their showroom sign-in ended.` });
      onChange();
    } catch (x) {
      setMsg({ tone: 'bad', text: errorText(x, 'Could not remove them.') });
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  return (
    <Section title="Team" id="adm-co-team">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {invite && <InviteNotice invite={invite.invite} email={invite.email} onDone={() => setInvite(null)} />}
      <DataTable<TenantMember>
        label="Team"
        rows={members}
        rowKey={(m) => m.userId}
        empty="Nobody yet. Add the owner below."
        columns={[
          {
            label: 'Person',
            primary: true,
            cell: (m) => (
              <span className="adm-who">
                <b>{m.name || m.email}</b>
                <span>{m.email}</span>
              </span>
            ),
          },
          { label: 'Role', cell: (m) => <Pill tone={m.role === 'owner' ? 'info' : 'plain'}>{m.role}</Pill> },
          { label: 'Last seen', cell: (m) => (m.pending ? 'Invited (link not used yet)' : m.lastSeenAt ? timeAgo(m.lastSeenAt) : 'Never') },
          {
            label: 'Actions',
            cell: (m) =>
              removing === m.userId ? (
                <Confirm text={`Remove ${m.email}?`} yes="Yes, remove" danger busy={busy} onNo={() => setRemoving(null)} onYes={() => void remove(m)} />
              ) : (
                <button type="button" className="btn small" disabled={busy} onClick={() => setRemoving(m.userId)}>
                  Remove
                </button>
              ),
          },
        ]}
      />
      <form className="adm-form adm-subform" onSubmit={(e) => void add(e)}>
        <b>Add someone</b>
        <div className="adm-form-row">
          <label className="adm-field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
          </label>
          <label className="adm-field">
            <span>Name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" />
          </label>
          <label className="adm-field">
            <span>Role</span>
            <select value={role} onChange={(e) => setRole(e.target.value as 'owner' | 'staff')}>
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </select>
          </label>
        </div>
        <div>
          <button type="submit" className="btn" disabled={busy || !email.trim()}>
            Add to team
          </button>
        </div>
      </form>
    </Section>
  );
}

function UsageSection({ t, data, error }: { t: AdminTenant; data: TenantUsage | null; error: string | null }) {
  return (
    <Section title="Usage" id="adm-co-usage">
      {error && <div className="auth-error">{error}</div>}
      <dl className="adm-kv">
        <dt>Leads</dt>
        <dd className="mono">{leadSummary(data?.leads ?? t.leads)}</dd>
        <dt>Renders used</dt>
        <dd className="mono">{data ? `${data.renders.total.count} (${money(data.renders.total.cents)}) · ${data.renders.month.count} this month` : t.usage?.rendersUsed ?? 0}</dd>
        <dt>Products live</dt>
        <dd className="mono">
          {data ? `${data.products.live} of ${data.products.included} included` : `${t.usage?.products ?? 0}`}
          {data?.products.hidden ? ` · ${data.products.hidden} hidden` : ''}
        </dd>
        <dt>Credits</dt>
        <dd className="mono">{money(t.credits?.balanceCents ?? 0)}</dd>
        <dt>Contact</dt>
        <dd className="adm-wrap">{[t.contact.phone, t.contact.email].filter(Boolean).join(' · ') || '—'}</dd>
      </dl>
      {data && data.products.live > data.products.included && <Notice tone="warn">More live products than the license includes: quote the extra modelling.</Notice>}
    </Section>
  );
}

function QueueSection({ data, error }: { data: TenantUsage | null; error: string | null }) {
  const q = data?.queue;
  return (
    <Section title={q ? `Studio queue · ${q.open} open${q.overdue ? `, ${q.overdue} overdue` : ''}` : 'Studio queue'} id="adm-co-queue">
      {error && <div className="auth-error">{error}</div>}
      {!q ? (
        <p className="empty-note">Loading…</p>
      ) : (
        <DataTable
          label="Studio queue"
          rows={q.orders}
          rowKey={(o) => o.id}
          empty="Nothing being modelled for this company."
          columns={[
            {
              label: 'Request',
              primary: true,
              cell: (o) => (
                <span className="adm-who">
                  <b className="adm-wrap">{o.brief || o.line || o.id}</b>
                  <span>
                    {o.email ?? 'Deleted account'} · <code className="mono">{o.id}</code>
                  </span>
                </span>
              ),
            },
            { label: 'Status', cell: (o) => <Pill tone={o.overdue ? 'bad' : o.status === 'revision_requested' ? 'warn' : 'info'}>{o.overdue ? 'Overdue' : o.status.replace('_', ' ')}</Pill> },
            { label: 'Due', cell: (o) => day(o.dueAt) },
            { label: 'Assigned', cell: (o) => o.assignedTo ?? '—' },
          ]}
        />
      )}
      <p className="adm-note">
        Work these in{' '}
        <a className="adm-link" href="#/admin/studio">
          Admin › Studio
        </a>
        .
      </p>
    </Section>
  );
}
