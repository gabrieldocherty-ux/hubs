/**
 * Admin > Users: search accounts, open one, and act on it. Every action is a server route that is
 * admin-only, CSRF-protected, rate-limited and audit-logged (server/routes/adminPanel.mjs). Admin
 * itself is never granted or taken away here: that stays `node server/scripts/make-admin.mjs`.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { accountApi } from '../../lib/accountApi';
import { money } from '../../lib/money';
import { timeAgo, useSession } from '../../store/useSession';
import { Search } from '../../components/Icons';
import { adminApi } from './api';
import { takePendingUser } from './selection';
import type { PanelUser, UserDetail } from './types';
import { DataTable, Notice, PLAN_LABEL, Pill, Section, dateTime, day, endDay, errorText, useLoad, type PillTone } from './ui';
import { AuditList } from './AdminAudit';

const ROLE_TONE: Record<string, PillTone> = { admin: 'info', studio: 'ok', customer: 'plain' };

export default function AdminUsers() {
  const [open, setOpen] = useState<string | null>(() => takePendingUser());
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const list = useLoad(() => adminApi.users(query), [query]);

  if (open) return <UserView id={open} onBack={() => (setOpen(null), void list.reload())} />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQuery(q);
  };
  const users = list.data?.users ?? null;

  return (
    <div className="adm admin-users">
      <div className="adm-head">
        <div>
          <h1>Users</h1>
          <p>Search by name or email, then open an account to see everything about it and act on it.</p>
        </div>
      </div>
      <div className="adm-toolbar">
        <form className="home-search" onSubmit={submit} role="search">
          <Search />
          <input placeholder="Search by name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
      </div>
      {list.error && <div className="auth-error">{list.error}</div>}
      {users === null ? (
        <div className="screen-msg">Loading users…</div>
      ) : (
        <Section title={query ? `${users.length} match${users.length === 1 ? '' : 'es'}` : `Newest ${users.length} accounts`} id="adm-users-list">
          <DataTable<PanelUser>
            label="Users"
            rows={users}
            rowKey={(u) => u.id}
            empty="No users match."
            columns={[
              {
                label: 'Account',
                primary: true,
                cell: (u) => (
                  <span className="adm-who">
                    <button type="button" className="adm-link" onClick={() => setOpen(u.id)} aria-label={`Open ${u.email}`}>
                      {u.name}
                    </button>
                    <span>{u.email}</span>
                  </span>
                ),
              },
              { label: 'Role', cell: (u) => <Pill tone={ROLE_TONE[u.role]}>{u.role}</Pill> },
              {
                label: 'Plan',
                cell: (u) => (
                  <>
                    {PLAN_LABEL[u.plan ?? 'free'] ?? u.plan}
                    {u.planProvider === 'comp' && ' (comp)'}
                    {u.planProvider === 'demo' && ' (demo)'}
                  </>
                ),
              },
              { label: 'Kitchens', cell: (u) => <span className="mono">{u.projects ?? 0}</span> },
              { label: 'Joined', cell: (u) => day(u.createdAt) },
              { label: 'Last seen', cell: (u) => (u.lastSeenAt ? timeAgo(u.lastSeenAt) : '—') },
              { label: 'Status', cell: (u) => (u.disabled ? <Pill tone="bad">Disabled</Pill> : <Pill tone="ok">Active</Pill>) },
            ]}
          />
        </Section>
      )}
    </div>
  );
}

function UserView({ id, onBack }: { id: string; onBack: () => void }) {
  const me = useSession((s) => s.user);
  const { data, setData, error, reload } = useLoad(() => adminApi.user(id), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [id]);

  /** Runs one action; on success the server's fresh detail replaces what is shown. */
  const act = async (name: string, fn: () => Promise<UserDetail | void>, message?: string) => {
    setBusy(name);
    setActionError(null);
    setDone(null);
    try {
      const out = await fn();
      if (out) setData(out);
      else await reload();
      if (message) setDone(message);
      return true;
    } catch (err) {
      setActionError(errorText(err, 'That didn’t work. Try again.'));
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (deleted)
    return (
      <div className="adm">
        <Notice tone="ok">The account {deleted} was deleted. The audit log keeps the record.</Notice>
        <div>
          <button type="button" className="btn" onClick={onBack}>
            Back to users
          </button>
        </div>
      </div>
    );
  if (error && !data)
    return (
      <div className="adm">
        <div className="auth-error">{error}</div>
        <div>
          <button type="button" className="btn" onClick={onBack}>
            Back to users
          </button>
        </div>
      </div>
    );
  if (!data) return <div className="screen-msg">Loading the account…</div>;

  const u = data.user;
  const self = u.id === me?.id;
  const isAdmin = u.role === 'admin';

  return (
    <div className="adm adm-user">
      <div>
        <button type="button" className="btn small" onClick={onBack}>
          ← All users
        </button>
      </div>
      <div className="adm-detail-head">
        <h1>{u.name}</h1>
        <div className="adm-badges">
          <span className="adm-sub">{u.email}</span>
          <Pill tone={ROLE_TONE[u.role]}>{u.role}</Pill>
          <Pill tone={data.plan.id === 'free' ? 'plain' : 'ok'}>
            {PLAN_LABEL[data.plan.id] ?? data.plan.id}
            {data.plan.provider === 'comp' ? ' · complimentary' : data.plan.provider === 'demo' ? ' · demo' : ''}
          </Pill>
          {u.disabled && <Pill tone="bad">Disabled</Pill>}
          {self && <Pill tone="info">You</Pill>}
        </div>
        <span className="adm-sub">
          Joined {day(u.createdAt)} · last seen {u.lastSeenAt ? timeAgo(u.lastSeenAt) : 'never (no live session)'}
          {u.phone ? ` · ${u.phone}` : ''}
        </span>
      </div>
      {u.disabled && (
        <Notice tone="bad">
          Disabled {dateTime(u.disabled.disabledAt)}
          {u.disabled.reason ? `: ${u.disabled.reason}` : ''}. This account can’t sign in until it is enabled again.
        </Notice>
      )}
      {actionError && <div className="auth-error">{actionError}</div>}
      {done && <Notice tone="ok">{done}</Notice>}

      <div className="adm-cols3">
        <Section title="Plan" id="adm-plan">
          <dl className="adm-kv">
            <dt>Plan</dt>
            <dd>{PLAN_LABEL[data.plan.id] ?? data.plan.id}</dd>
            <dt>Billed through</dt>
            <dd>{data.subscription ? (data.subscription.provider === 'comp' ? 'Complimentary' : data.subscription.provider === 'demo' ? 'Demo' : 'Stripe') : '—'}</dd>
            <dt>Status</dt>
            <dd>{data.subscription ? data.subscription.status.replace('_', ' ') : 'Never subscribed'}</dd>
            {data.subscription?.provider === 'comp' ? (
              <>
                <dt>Ends</dt>
                <dd>{data.subscription.compEndsAt ? endDay(data.subscription.compEndsAt) : 'No end date'}</dd>
              </>
            ) : data.subscription?.currentPeriodEnd ? (
              <>
                <dt>{data.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'}</dt>
                <dd>{day(data.subscription.currentPeriodEnd)}</dd>
              </>
            ) : null}
            {data.subscription?.amountCents ? (
              <>
                <dt>Price</dt>
                <dd>{money(data.subscription.amountCents, data.subscription.currency)}/month</dd>
              </>
            ) : null}
            <dt>Unlocked kitchens</dt>
            <dd>{data.entitlements.unlockedKitchens}</dd>
            {data.entitlements.adminBypass && (
              <>
                <dt>Exports</dt>
                <dd>Free (admin), each one audit-logged</dd>
              </>
            )}
          </dl>
        </Section>
        <Section title={`Kitchens (${data.kitchens.count})`} id="adm-kitchens">
          {data.kitchens.recent.length === 0 ? (
            <p className="empty-note">No kitchens yet.</p>
          ) : (
            <ul className="adm-log">
              {data.kitchens.recent.map((k) => (
                <li key={k.id}>
                  <time>{day(k.updatedAt)}</time>
                  <span />
                  <span>{k.name}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Contractor" id="adm-contractor">
          {data.contractor ? (
            <dl className="adm-kv">
              <dt>Company</dt>
              <dd>{data.contractor.company || '—'}</dd>
              <dt>Phone</dt>
              <dd>{data.contractor.phone || '—'}</dd>
              <dt>Brand page</dt>
              <dd>
                {data.contractor.brandPage ? (
                  <>
                    {data.contractor.brandPage.state.replace('_', ' ')} {data.contractor.brandPage.verified && <Pill tone="ok">Verified</Pill>}
                  </>
                ) : (
                  'None'
                )}
              </dd>
              <dt>Models</dt>
              <dd>
                {data.contractor.allowance.active
                  ? `${data.contractor.allowance.used} used of ${data.contractor.allowance.total}, resets ${day(data.contractor.allowance.resetsAt)}`
                  : 'Not on the Contractor plan'}
              </dd>
            </dl>
          ) : (
            <p className="empty-note">Not a contractor.</p>
          )}
        </Section>
      </div>

      <div className="adm-cols">
        <RoleBox data={data} self={self} busy={busy} act={act} />
        <CompBox data={data} busy={busy} act={act} />
      </div>
      <div className="adm-cols">
        <ResetLinkBox data={data} />
        <SessionsBox data={data} self={self} busy={busy} act={act} />
      </div>

      <Section title="Orders" id="adm-orders">
        <DataTable
          label="Orders"
          rows={data.orders}
          rowKey={(o) => o.id}
          empty="No custom-model orders."
          columns={[
            { label: 'Order', primary: true, cell: (o) => <code className="mono">{o.id}</code> },
            { label: 'Status', cell: (o) => o.status.replace(/_/g, ' ') },
            { label: 'Tier', cell: (o) => o.tier },
            { label: 'Amount', cell: (o) => (o.provider === 'plan' ? 'Included in plan' : `${money(o.amountCents, o.currency)}${o.provider === 'demo' ? ' (demo)' : ''}`) },
            { label: 'Placed', cell: (o) => day(o.createdAt) },
          ]}
        />
      </Section>
      <Section title="Payments" id="adm-payments">
        <DataTable
          label="Payments"
          rows={data.payments}
          rowKey={(p) => `${p.kind}-${p.at}-${p.amountCents}`}
          empty="No payments."
          columns={[
            { label: 'What', primary: true, cell: (p) => (p.kind === 'kitchen_unlock' ? 'Kitchen unlock' : `${PLAN_LABEL[p.plan ?? ''] ?? 'Plan'} ${p.kind === 'renewal' ? 'renewal' : 'plan'}`) },
            { label: 'Amount', cell: (p) => `${money(p.amountCents, p.currency)}${p.provider === 'demo' ? ' (demo)' : ''}` },
            { label: 'When', cell: (p) => dateTime(p.at) },
          ]}
        />
      </Section>

      <AccessBox data={data} self={self} isAdmin={isAdmin} busy={busy} act={act} onDeleted={(email) => setDeleted(email)} />

      <Section title="History" id="adm-history">
        <AuditList entries={data.audit} empty="No admin actions on this account yet." />
      </Section>
    </div>
  );
}

type Act = (name: string, fn: () => Promise<UserDetail | void>, message?: string) => Promise<boolean>;
interface BoxProps {
  data: UserDetail;
  busy: string | null;
  act: Act;
}

function RoleBox({ data, self, busy, act }: BoxProps & { self: boolean }) {
  const u = data.user;
  const [role, setRole] = useState<'customer' | 'studio'>(u.role === 'studio' ? 'studio' : 'customer');
  useEffect(() => setRole(u.role === 'studio' ? 'studio' : 'customer'), [u.role]);
  const locked = u.role === 'admin' || self;
  return (
    <Section title="Role" id="adm-role">
      <div className="adm-form">
        <div className="adm-form-row">
          <label className="adm-field">
            <span>Role</span>
            <select value={locked ? u.role : role} disabled={locked} onChange={(e) => setRole(e.target.value as 'customer' | 'studio')} aria-label="Role">
              {u.role === 'admin' && <option value="admin">admin</option>}
              <option value="customer">customer</option>
              <option value="studio">studio (sees the studio queue)</option>
            </select>
          </label>
          <button type="button" className="btn" disabled={locked || role === u.role || busy === 'role'} onClick={() => void act('role', () => adminApi.setRole(u.id, role), `Role changed to ${role}.`)}>
            {busy === 'role' ? 'Saving…' : 'Save role'}
          </button>
        </div>
        <p className="adm-note">
          {self ? 'You can’t change your own role. ' : ''}
          Admin is never granted or removed here. On the server, run <code>node server/scripts/make-admin.mjs {u.email}</code> (add <code>--role customer</code> to take it away).
        </p>
      </div>
    </Section>
  );
}

function CompBox({ data, busy, act }: BoxProps) {
  const u = data.user;
  const sub = data.subscription;
  const activeComp = sub?.provider === 'comp' && sub.status === 'active' && data.plan.provider === 'comp';
  const paidStripe = sub?.provider === 'stripe' && data.plan.id !== 'free';
  const [plan, setPlan] = useState<'unlimited' | 'contractor'>('contractor');
  const [endsOn, setEndsOn] = useState('');
  const [note, setNote] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await act('comp', () => adminApi.grantComp(u.id, plan, endsOn || null, note.trim()), `Complimentary ${PLAN_LABEL[plan]} given${endsOn ? ` through ${endsOn}` : ''}.`);
    if (ok) setNote('');
  };
  return (
    <Section title="Complimentary plan" id="adm-comp">
      {activeComp && (
        <div className="adm-form" style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
          <p className="adm-note">
            On a complimentary {PLAN_LABEL[data.plan.id]} plan {sub?.compEndsAt ? `through ${endDay(sub.compEndsAt)}` : 'with no end date'}
            {sub?.compNote ? ` (“${sub.compNote}”)` : ''}.
          </p>
          <div>
            <button type="button" className="btn danger small" disabled={busy === 'revoke'} onClick={() => void act('revoke', () => adminApi.revokeComp(u.id), 'Complimentary plan ended.')}>
              {busy === 'revoke' ? 'Ending…' : 'End it now'}
            </button>
          </div>
        </div>
      )}
      {paidStripe ? (
        <p className="adm-note">This account pays for a plan through Stripe. Cancel that first, then give a complimentary plan.</p>
      ) : (
        <form className="adm-form" onSubmit={(e) => void submit(e)}>
          <div className="adm-form-row">
            <label className="adm-field">
              <span>Plan</span>
              <select value={plan} onChange={(e) => setPlan(e.target.value as 'unlimited' | 'contractor')}>
                <option value="contractor">Contractor</option>
                <option value="unlimited">Unlimited</option>
              </select>
            </label>
            <label className="adm-field">
              <span>Ends after (optional)</span>
              <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} aria-label="Complimentary plan end date" />
            </label>
          </div>
          <label className="adm-field">
            <span>Note (for the audit log)</span>
            <input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Why, e.g. launch partner" />
          </label>
          <div>
            <button type="submit" className="btn" disabled={busy === 'comp'}>
              {busy === 'comp' ? 'Giving…' : activeComp ? 'Replace complimentary plan' : 'Give complimentary plan'}
            </button>
          </div>
          <p className="adm-note">No charge and no receipt. It ends at the end of the chosen day (UTC); leave the date empty for no end.</p>
        </form>
      )}
    </Section>
  );
}

function ResetLinkBox({ data }: { data: UserDetail }) {
  const u = data.user;
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const make = async () => {
    setBusy(true);
    setErr(null);
    setCopied(false);
    try {
      setLink(await accountApi.adminResetLink(u.id));
    } catch (e) {
      setErr(errorText(e, 'Could not make a reset link.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Password reset link" id="adm-reset">
      {err && <div className="auth-error">{err}</div>}
      {link ? (
        <div className="adm-form" role="status">
          <b>Reset link for {u.email}</b>
          <p className="adm-note">
            Works once, until {new Date(link.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, and signs the account out everywhere when used. Send it only to {u.email}, from the support address. It won’t be shown again.
          </p>
          <div className="adm-inline adm-reset-url">
            <input readOnly value={link.url} aria-label="Reset link" onFocus={(e) => e.currentTarget.select()} style={{ flex: '1 1 200px' }} />
            <button
              type="button"
              className="btn small"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(link.url)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="btn small" onClick={() => setLink(null)}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="adm-form">
          <p className="adm-note">For when the person can’t get the reset email (or email isn’t set up). Any older link stops working.</p>
          <div>
            <button type="button" className="btn" disabled={busy} onClick={() => void make()} aria-label={`Create a reset link for ${u.email}`}>
              {busy ? 'Making…' : 'Create reset link'}
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

function SessionsBox({ data, self, busy, act }: BoxProps & { self: boolean }) {
  const u = data.user;
  const [confirm, setConfirm] = useState(false);
  return (
    <Section title={`Signed-in devices (${data.sessions.length})`} id="adm-sessions">
      {data.sessions.length === 0 ? (
        <p className="empty-note">No live sessions.</p>
      ) : (
        <ul className="adm-log">
          {data.sessions.map((s, i) => (
            <li key={s.id ?? i}>
              <time>{s.lastSeenAt ? timeAgo(s.lastSeenAt) : '—'}</time>
              <span />
              <span>
                {[s.browser, s.os].filter(Boolean).join(' on ') || 'Unknown device'} · signed in {day(s.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="adm-inline" style={{ marginTop: 10 }}>
        {confirm ? (
          <>
            <span className="adm-note">Sign {u.email} out on every device?</span>
            <button
              type="button"
              className="btn danger small"
              disabled={busy === 'signout'}
              onClick={() => void act('signout', async () => (setConfirm(false), adminApi.signOutAll(u.id)), 'Signed out everywhere.')}
            >
              {busy === 'signout' ? 'Signing out…' : 'Yes, sign out everywhere'}
            </button>
            <button type="button" className="btn small" onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn small" disabled={self || data.sessions.length === 0} onClick={() => setConfirm(true)}>
            Sign out everywhere
          </button>
        )}
      </div>
      {self && <p className="adm-note">Your own devices are in Account settings › Security.</p>}
    </Section>
  );
}

function AccessBox({ data, self, isAdmin, busy, act, onDeleted }: BoxProps & { self: boolean; isAdmin: boolean; onDeleted: (email: string) => void }) {
  const u = data.user;
  const [reason, setReason] = useState('');
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [typed, setTyped] = useState('');
  const blocked = self || isAdmin;
  const matches = typed.trim().toLowerCase() === u.email.toLowerCase();
  return (
    <Section title="Access" id="adm-access">
      {blocked && (
        <p className="adm-note">
          {self ? 'These don’t apply to your own account.' : 'This account is an admin: take the role away on the server first (make-admin --role customer), then disable or delete it.'}
        </p>
      )}
      <div className="adm-cols">
        <div className="adm-form">
          <b>{u.disabled ? 'Enable the account' : 'Disable the account'}</b>
          {u.disabled ? (
            <>
              <p className="adm-note">It can sign in again with its password. Nothing else changes.</p>
              <div>
                <button type="button" className="btn" disabled={blocked || busy === 'enable'} onClick={() => void act('enable', () => adminApi.enable(u.id), 'Account enabled.')}>
                  {busy === 'enable' ? 'Enabling…' : 'Enable account'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="adm-note">It can’t sign in, every session ends now and any reset link stops working. Kitchens, plan and data stay; enable it to undo.</p>
              <label className="adm-field">
                <span>Reason (for the audit log)</span>
                <input value={reason} maxLength={500} disabled={blocked} onChange={(e) => setReason(e.target.value)} placeholder="e.g. chargeback, abuse" />
              </label>
              <div className="adm-inline">
                {confirmDisable ? (
                  <>
                    <button
                      type="button"
                      className="btn danger"
                      disabled={blocked || busy === 'disable'}
                      onClick={() => void act('disable', async () => (setConfirmDisable(false), adminApi.disable(u.id, reason.trim())), 'Account disabled and signed out everywhere.')}
                    >
                      {busy === 'disable' ? 'Disabling…' : 'Yes, disable it'}
                    </button>
                    <button type="button" className="btn" onClick={() => setConfirmDisable(false)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn danger" disabled={blocked} onClick={() => setConfirmDisable(true)}>
                    Disable account
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <div className="adm-form">
          <b>Delete the account</b>
          <p className="adm-note">
            Permanent. Their kitchens, uploads, brand page, sessions and settings go; receipts and orders stay, made anonymous. Refused while a Stripe plan still renews. Type <code>{u.email}</code> to confirm.
          </p>
          <label className="adm-field">
            <span>Email address</span>
            <input value={typed} disabled={blocked} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label="Type the account’s email to confirm deletion" />
          </label>
          <div>
            <button
              type="button"
              className="btn danger"
              disabled={blocked || !matches || busy === 'delete'}
              onClick={() =>
                void act('delete', async () => {
                  await adminApi.remove(u.id, typed.trim());
                  onDeleted(u.email);
                  return data;
                })
              }
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete account permanently'}
            </button>
          </div>
        </div>
      </div>
    </Section>
  );
}
