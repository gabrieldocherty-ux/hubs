import { useEffect, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { ApiError } from '../../lib/api';
import { useSession } from '../../store/useSession';
import { useDesignStore } from '../../store/useDesignStore';
import { day, wsApi, type Member, type MemberRole } from './api';
import { useWorkspace } from './context';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The Team tab: who can open this workspace. Owners invite people by email (owner or staff), change
 * roles and remove people; staff see the team. A new person gets a 7-day link to set their password
 * on this showroom (emailed when email is set up, otherwise shown here once to pass on).
 */
export default function TeamTab() {
  const { owner, tenant } = useWorkspace();
  const me = useSession((s) => s.user?.id ?? null);
  const toast = useDesignStore((s) => s.toast);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Member | null>(null);

  useEffect(() => {
    wsApi
      .team()
      .then((r) => setMembers(r.members))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the team.'));
  }, []);

  const setRole = async (m: Member, role: MemberRole) => {
    setBusy(m.userId);
    try {
      const r = await wsApi.setRole(m.userId, role);
      setMembers((cur) => (cur ?? []).map((x) => (x.userId === m.userId ? r.member : x)));
      toast(`${m.name || m.email} is ${role === 'owner' ? 'an owner' : 'staff'} now.`, 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That didn’t change.', 'warn');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (m: Member) => {
    setBusy(m.userId);
    try {
      const r = await wsApi.removeMember(m.userId);
      setMembers(r.members);
      toast(`${m.name || m.email} can no longer open the workspace.`, 'ok');
      setRemoving(null);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That didn’t work.', 'warn');
    } finally {
      setBusy(null);
    }
  };

  const owners = (members ?? []).filter((m) => m.role === 'owner').length;

  return (
    <div className="ws-team">
      <div className="ws-head">
        <div>
          <span className="eyebrow">Team</span>
          <h1>Who can open the workspace</h1>
          <p>
            Your team signs in at {new URL(tenant.url).host}. <b>Staff</b> manage products and leads and use the showroom in sales meetings. <b>Owners</b> can also change the showroom’s switches, the team and the card on file.
          </p>
        </div>
      </div>
      {error && <div className="ws-error">{error}</div>}
      {!members && !error && <div className="screen-msg">Loading the team…</div>}
      {members && (
        <section className="ws-card" aria-label="Team members">
          <ul className="ws-members">
            {members.map((m) => {
              const lastOwner = m.role === 'owner' && owners <= 1;
              return (
                <li key={m.userId} className="ws-member">
                  <span className="ws-avatar" aria-hidden="true">
                    {(m.name || m.email).slice(0, 1).toUpperCase()}
                  </span>
                  <span className="ws-member-who">
                    <b>
                      {m.name || m.email}
                      {m.userId === me ? ' (you)' : ''}
                    </b>
                    <span className="muted">{m.email}</span>
                    <span className="fine">
                      Added {day(m.addedAt)}
                      {m.pending ? ' · invited, joins once they accept the emailed invitation' : m.lastSeenAt ? ` · last seen ${day(m.lastSeenAt)}` : ' · hasn’t signed in yet'}
                    </span>
                  </span>
                  <span className="ws-member-actions">
                    {owner ? (
                      <select value={m.role} onChange={(e) => void setRole(m, e.target.value as MemberRole)} disabled={busy === m.userId || lastOwner} aria-label={`Role of ${m.name || m.email}`} title={lastOwner ? 'A showroom always keeps at least one owner.' : undefined}>
                        <option value="owner">Owner</option>
                        <option value="staff">Staff</option>
                      </select>
                    ) : (
                      <span className={m.role === 'owner' ? 'ws-pill accent' : 'ws-pill'}>{m.role === 'owner' ? 'Owner' : 'Staff'}</span>
                    )}
                    {owner && m.userId !== me && (
                      <button type="button" className="btn" onClick={() => setRemoving(m)} disabled={busy === m.userId || lastOwner}>
                        Remove
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {owner ? <InviteForm onAdded={(m) => setMembers((cur) => [...(cur ?? []).filter((x) => x.userId !== m.userId), m])} /> : <p className="fine">Ask an owner to invite someone new.</p>}
      {owner && <ExportSwitch />}
      {removing && (
        <Dialog title={`Remove ${removing.name || removing.email}?`} onClose={() => setRemoving(null)}>
          <p>They’re signed out of this workspace at once and can’t open it again. Their leads, notes and the designs they made stay with the showroom.</p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setRemoving(null)} data-autofocus>
              Keep them
            </button>
            <button type="button" className="btn danger" onClick={() => void remove(removing)} disabled={busy === removing.userId}>
              Remove from the team
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function InviteForm({ onAdded }: { onAdded: (m: Member) => void }) {
  const toast = useDesignStore((s) => s.toast);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<MemberRole>('staff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string; expiresAt: number } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLink(null);
    if (!EMAIL.test(email.trim())) return setError('Enter the person’s email address.');
    setBusy(true);
    try {
      const r = await wsApi.invite({ email: email.trim(), ...(name.trim() ? { name: name.trim() } : {}), role });
      onAdded(r.member);
      if (r.invite && !r.invite.emailed) setLink({ email: email.trim(), url: r.invite.url, expiresAt: r.invite.expiresAt });
      const who = email.trim();
      toast(
        r.pending
          ? `${who} already has an account here. We emailed them an invitation; they join once they accept it with their own password.`
          : r.invite
            ? r.invite.emailed
              ? `Invitation emailed to ${who}.`
              : `${who} is on the team. Send them the link below.`
            : `${who} is on the team.`,
        'ok',
      );
      setEmail('');
      setName('');
      setRole('staff');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The invitation didn’t go through.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ws-card ws-invite" onSubmit={submit} noValidate>
      <h2>Invite someone</h2>
      <div className="ws-invite-row">
        <label className="field">
          <span>Email</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" inputMode="email" autoComplete="off" maxLength={254} placeholder="name@yourcompany.ca" />
        </label>
        <label className="field">
          <span>
            Name <em>· optional</em>
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <button type="submit" className="btn primary" disabled={busy || !email.trim()}>
          {busy ? 'Inviting…' : 'Invite'}
        </button>
      </div>
      {error && (
        <div className="ws-error" role="alert">
          {error}
        </div>
      )}
      {link && (
        <div className="ws-note" role="status">
          <p>
            Email isn’t set up on this server, so send {link.email} this link yourself. It lets them set a password and works once, until {day(link.expiresAt)}. It won’t be shown again.
          </p>
          <div className="ws-copy">
            <code>{link.url}</code>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void navigator.clipboard?.writeText(link.url).then(
                  () => (setCopied(true), setTimeout(() => setCopied(false), 1600)),
                  () => {},
                )
              }
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

/** Owners decide whether staff may download the whole lead list (off by default; every export is recorded). */
function ExportSwitch() {
  const { tenant, setTenant } = useWorkspace();
  const toast = useDesignStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const on = !!tenant.settings.staffLeadExport;
  const flip = async (next: boolean) => {
    setBusy(true);
    try {
      const r = await wsApi.saveShowroom({ settings: { ...tenant.settings, staffLeadExport: next } });
      setTenant(r.tenant);
      toast(next ? 'Staff can export the lead list now. Every export is recorded under Leads.' : 'Only owners can export the lead list now.', 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That didn’t change.', 'warn');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ws-card" aria-label="Lead list export">
      <label className="ws-switch">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void flip(e.target.checked)} />
        <span>
          <b>Let staff export the lead list</b>
          <em>Off: only owners can download every lead as a spreadsheet. Either way, each export is recorded with who made it and how many people it held (Leads, at the bottom).</em>
        </span>
      </label>
    </section>
  );
}
