import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import { accountApi, deviceName, type DeviceWire } from '../lib/accountApi';
import { attachmentName } from '../lib/attachment';
import { normalizePhone } from '../lib/phone';
import { setPrefs, usePrefs } from '../lib/prefs';
import { markDown } from '../lib/reachability';
import { navigateHash } from '../lib/router';
import { THEME_PREFS, type ThemePref } from '../lib/theme';
import { timeAgo, useSession } from '../store/useSession';
import { useConfig } from '../lib/config';
import { proApi } from '../features/contractors/api';
import { draftToInput, type CompanyDraft } from '../features/contractors/CompanyFields';
import { TwoFactorSettings } from './TwoFactor';
import './account.css';

/**
 * Account settings (`#/account`), in sections: Profile, Security, Preferences, Email notifications
 * (only when the server can send email), Plan & billing, Company (contractors only) and Data.
 * Every change saves on its own; nothing here waits for a single big Save.
 */

type Msg = { tone: 'ok' | 'bad'; text: string } | null;

const errText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

const date = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');

function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div className={msg.tone === 'ok' ? 'auth-ok' : 'auth-error'} role={msg.tone === 'ok' ? 'status' : 'alert'}>
      {msg.text}
    </div>
  );
}

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-section" id={`set-${id}`} aria-labelledby={`set-${id}-title`}>
      <header className="set-section-head">
        <h2 id={`set-${id}-title`}>{title}</h2>
        {intro && <p>{intro}</p>}
      </header>
      <div className="set-card">{children}</div>
    </section>
  );
}

/** An on/off switch with its label and a line of explanation. */
export function Switch({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: ReactNode; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <div className="set-switch-row">
      <div className="set-switch-text">
        <label htmlFor={id}>{label}</label>
        {hint && <p id={`${id}-hint`}>{hint}</p>}
      </div>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={checked ? 'set-switch on' : 'set-switch'}
        onClick={() => onChange(!checked)}
        disabled={disabled}
      >
        <span className="set-switch-word">{checked ? 'On' : 'Off'}</span>
        <span className="set-switch-track" aria-hidden>
          <span className="set-switch-knob" />
        </span>
      </button>
    </div>
  );
}

export function AccountSettingsPage() {
  const user = useSession((s) => s.user)!;
  const emailEnabled = usePrefs((s) => s.emailEnabled);
  // A showroom visitor or team member has no plan of ours to see or buy (docs/SHOWROOM_PIVOT.md §3).
  const onShowroom = !!useConfig((s) => s.config?.tenant);
  const contractor = !onShowroom && (user.plan.id === 'contractor' || !!user.contractor);
  const sections: [string, string][] = [
    ['profile', 'Profile'],
    ['security', 'Security'],
    ['preferences', 'Preferences'],
    ...(emailEnabled ? ([['email', 'Email notifications']] as [string, string][]) : []),
    ...(onShowroom ? [] : ([['plan', 'Plan & billing']] as [string, string][])),
    ...(contractor ? ([['company', 'Company']] as [string, string][]) : []),
    ['data', 'Your data'],
  ];
  const jump = (id: string) => document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="set-layout">
      <nav className="set-nav" aria-label="Settings sections">
        {sections.map(([id, label]) => (
          <button key={id} type="button" onClick={() => jump(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="set-sections">
        <ProfileSection />
        <SecuritySection />
        <PreferencesSection />
        {emailEnabled && <EmailSection />}
        {!onShowroom && <PlanSection />}
        {contractor && <CompanySection />}
        <Section id="data" title="Your data">
          <YourData />
        </Section>
      </div>
    </div>
  );
}

// ── Profile ────────────────────────────────────────────────────────────────

function ProfileSection() {
  const user = useSession((s) => s.user)!;
  const setUser = useSession((s) => s.setUser);
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState('');
  const [savedPhone, setSavedPhone] = useState('');
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    accountApi
      .profile()
      .then(({ profile }) => {
        if (!live) return;
        setPhone(profile.phone);
        setSavedPhone(profile.phone);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const p = normalizePhone(phone);
    if (!p.ok) return setPhoneError(p.reason);
    setPhoneError(null);
    if (!name.trim()) return setMsg({ tone: 'bad', text: 'Name cannot be empty.' });
    setBusy(true);
    try {
      const r = await accountApi.saveProfile({ name: name.trim(), phone: p.value });
      setUser(r.user);
      setName(r.profile.name);
      setPhone(r.profile.phone);
      setSavedPhone(r.profile.phone);
      setMsg({ tone: 'ok', text: 'Saved.' });
    } catch (err) {
      if (err instanceof ApiError && (err.body as { field?: string } | undefined)?.field === 'phone') setPhoneError(err.message);
      else setMsg({ tone: 'bad', text: errText(err, 'Could not save. Try again.') });
    } finally {
      setBusy(false);
    }
  };

  const dirty = name.trim() !== user.name || phone.trim() !== savedPhone;

  return (
    <Section id="profile" title="Profile" intro="Your name and how to reach you.">
      <form onSubmit={save} aria-label="Profile" noValidate>
        <div className="set-grid">
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} required />
          </label>
          <label className="field">
            <span>
              Phone <em>· optional</em>
            </span>
            <input
              value={phone}
              onChange={(e) => (setPhone(e.target.value), setPhoneError(null))}
              onBlur={() => {
                const p = normalizePhone(phone);
                if (p.ok) setPhone(p.value);
                else setPhoneError(p.reason);
              }}
              inputMode="tel"
              autoComplete="tel"
              placeholder="(905) 555-0142"
              aria-invalid={!!phoneError}
              aria-describedby={phoneError ? 'set-phone-error' : undefined}
            />
            {phoneError && (
              <small className="set-field-error" id="set-phone-error">
                {phoneError}
              </small>
            )}
          </label>
        </div>
        <Note msg={msg} />
        <div className="set-actions">
          <button type="submit" className="btn primary" disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
      <div className="set-divider" />
      <ChangeEmail />
    </Section>
  );
}

function ChangeEmail() {
  const user = useSession((s) => s.user)!;
  const setUser = useSession((s) => s.setUser);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!email.trim() || !password) return setMsg({ tone: 'bad', text: 'Enter the new address and your current password.' });
    setBusy(true);
    try {
      const r = await accountApi.changeEmail(email.trim(), password);
      setUser(r.user);
      setOpen(false);
      setEmail('');
      setPassword('');
      setMsg({ tone: 'ok', text: `Your email is now ${r.user.email}.${r.signedOut ? ` ${r.signedOut} other device${r.signedOut === 1 ? ' was' : 's were'} signed out.` : ''}` });
    } catch (err) {
      setMsg({ tone: 'bad', text: errText(err, 'Could not change your email. Try again.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="set-email">
      <div className="set-row">
        <div>
          <span className="set-label">Email</span>
          <b className="set-value">{user.email}</b>
          <p className="set-hint">You sign in with this address.</p>
        </div>
        {!open && (
          <button type="button" className="btn" onClick={() => (setOpen(true), setMsg(null))}>
            Change email
          </button>
        )}
      </div>
      {open && (
        <form className="set-inline-form" onSubmit={submit} aria-label="Change email" noValidate>
          <div className="set-grid">
            <label className="field">
              <span>New email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </label>
            <label className="field">
              <span>Current password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </label>
          </div>
          <p className="set-hint">Changing it signs you out on your other devices.</p>
          <Note msg={msg} />
          <div className="set-actions">
            <button type="button" className="btn" onClick={() => (setOpen(false), setMsg(null))} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Changing…' : 'Change email'}
            </button>
          </div>
        </form>
      )}
      {!open && <Note msg={msg} />}
    </div>
  );
}

// ── Security ───────────────────────────────────────────────────────────────

function SecuritySection() {
  return (
    <Section id="security" title="Security" intro="Your password, two-factor sign-in and the devices signed in to your account.">
      <ChangePassword />
      <div className="set-divider" />
      <TwoFactorSettings />
      <div className="set-divider" />
      <Devices />
    </Section>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [bump, setBump] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) return setMsg({ tone: 'bad', text: 'Use at least 8 characters for your new password.' });
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setMsg({ tone: 'ok', text: 'Password changed. Your other devices have been signed out.' });
      setBump((b) => b + 1);
      window.dispatchEvent(new Event('blumodel:sessions-changed'));
    } catch (err) {
      setMsg({ tone: 'bad', text: errText(err, 'Could not change your password. Try again.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} aria-label="Change password" key={bump} noValidate>
      <h3 className="set-sub">Change password</h3>
      <div className="set-grid">
        <label className="field">
          <span>Current password</span>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label className="field">
          <span>
            New password <em>· at least 8 characters</em>
          </span>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
        </label>
      </div>
      <Note msg={msg} />
      <div className="set-actions">
        <button type="submit" className="btn primary" disabled={busy || !current || !next}>
          {busy ? 'Saving…' : 'Change password'}
        </button>
      </div>
    </form>
  );
}

function Devices() {
  const [list, setList] = useState<DeviceWire[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  const load = async () => {
    try {
      setList((await accountApi.sessions()).sessions);
      setError(null);
    } catch (err) {
      setError(errText(err, 'Your devices couldn’t be loaded.'));
    }
  };

  useEffect(() => {
    void load();
    const again = () => void load();
    window.addEventListener('blumodel:sessions-changed', again);
    return () => window.removeEventListener('blumodel:sessions-changed', again);
  }, []);

  const end = async (d: DeviceWire) => {
    setBusy(d.id);
    setMsg(null);
    try {
      await accountApi.endSession(d.id);
      setList((l) => l?.filter((x) => x.id !== d.id) ?? null);
      setMsg({ tone: 'ok', text: `${deviceName(d)} was signed out.` });
    } catch (err) {
      setMsg({ tone: 'bad', text: errText(err, 'That device couldn’t be signed out.') });
      void load();
    } finally {
      setBusy(null);
    }
  };

  const endOthers = async () => {
    setBusy('others');
    setMsg(null);
    try {
      const r = await accountApi.endOtherSessions();
      setMsg({ tone: 'ok', text: r.signedOut ? `${r.signedOut} other device${r.signedOut === 1 ? ' was' : 's were'} signed out.` : 'No other device was signed in.' });
      await load();
    } catch (err) {
      setMsg({ tone: 'bad', text: errText(err, 'Your other devices couldn’t be signed out.') });
    } finally {
      setBusy(null);
    }
  };

  const others = list?.filter((d) => !d.current).length ?? 0;

  return (
    <div className="set-devices">
      <div className="set-row">
        <h3 className="set-sub">Signed-in devices</h3>
        {others > 0 && (
          <button type="button" className="btn" onClick={() => void endOthers()} disabled={busy !== null}>
            {busy === 'others' ? 'Signing out…' : 'Sign out all other devices'}
          </button>
        )}
      </div>
      {error && <div className="auth-error">{error}</div>}
      {list === null && !error && <p className="set-hint">Loading your devices…</p>}
      {list && (
        <ul className="set-device-list">
          {list.map((d) => (
            <li key={d.id} className="set-device">
              <div>
                <b>
                  {deviceName(d)}
                  {d.current && <span className="set-badge">This device</span>}
                </b>
                <span>
                  Signed in {date(d.createdAt)}
                  {d.lastSeenAt ? ` · active ${d.current ? 'now' : timeAgo(d.lastSeenAt)}` : ''}
                </span>
              </div>
              {!d.current && (
                <button type="button" className="btn" onClick={() => void end(d)} disabled={busy !== null} aria-label={`Sign out ${deviceName(d)}`}>
                  {busy === d.id ? 'Signing out…' : 'Sign out'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Note msg={msg} />
    </div>
  );
}

// ── Preferences ────────────────────────────────────────────────────────────

const THEME_LABEL: Record<ThemePref, string> = { system: 'System', light: 'Light', dark: 'Dark' };

function PreferencesSection() {
  const prefs = usePrefs((s) => s.prefs);
  const isContractor = useSession((s) => s.user?.plan.id === 'contractor');
  const [msg, setMsg] = useState<Msg>(null);

  const change = async (patch: Parameters<typeof setPrefs>[0]) => {
    setMsg(null);
    try {
      await setPrefs(patch);
    } catch (err) {
      setMsg({ tone: 'bad', text: errText(err, 'That couldn’t be saved. Try again.') });
    }
  };

  return (
    <Section id="preferences" title="Preferences" intro="How BluModel Studio looks and what the editor shows. Saved to your account.">
      <div className="set-row set-row--top">
        <div className="set-switch-text">
          <span className="set-label" id="set-theme-label">
            Appearance
          </span>
          <p>System follows your device’s light or dark setting.</p>
        </div>
        <div className="seg set-seg" role="radiogroup" aria-labelledby="set-theme-label">
          {THEME_PREFS.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={prefs.theme === t} className={prefs.theme === t ? 'on' : ''} onClick={() => void change({ theme: t })}>
              {THEME_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      <div className="set-divider" />
      <Switch
        id="set-estimator"
        label="Show cost estimator"
        hint={
          <>
            Adds an estimated total to the editor and an Estimate tab with every product, surface and hardware line. Prices are estimates, not quotes.
            {isContractor ? ' Your quotes and price book work either way; turn this on to see totals and add labour lines while you design.' : ''}
          </>
        }
        checked={prefs.showEstimator}
        onChange={(on) => void change({ showEstimator: on })}
      />
      <Note msg={msg} />
    </Section>
  );
}

function EmailSection() {
  const prefs = usePrefs((s) => s.prefs);
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <Section id="email" title="Email notifications" intro="Account security emails always go out: password resets and changes to your email or password.">
      <Switch
        id="set-alerts"
        label="New sign-in alerts"
        hint="An email when your account is signed in from a browser it hasn’t used before."
        checked={prefs.signInAlerts}
        onChange={(on) => {
          setMsg(null);
          setPrefs({ signInAlerts: on }).catch((err) => setMsg({ tone: 'bad', text: errText(err, 'That couldn’t be saved. Try again.') }));
        }}
      />
      <Note msg={msg} />
    </Section>
  );
}

// ── Plan & billing ─────────────────────────────────────────────────────────

const PLAN_NAME = { free: 'Free', unlimited: 'Unlimited', contractor: 'Contractor' } as const;

function PlanSection() {
  const plan = useSession((s) => s.user!.plan);
  const status =
    plan.id === 'free'
      ? 'Design, save and share for free. Unlimited and Contractor plans add more.'
      : plan.provider === 'comp'
        ? 'Complimentary.'
        : plan.graceUntil
          ? `A renewal payment failed; the plan stays on until ${date(plan.graceUntil)} while it’s retried.`
          : plan.cancelAtPeriodEnd
            ? `Cancelled: it ends ${date(plan.periodEnd)}.`
            : plan.periodEnd
              ? `Renews ${date(plan.periodEnd)}.`
              : 'Active.';
  return (
    <Section id="plan" title="Plan & billing">
      <div className="set-row">
        <div>
          <span className="set-label">Current plan</span>
          <b className="set-value">{PLAN_NAME[plan.id]}</b>
          <p className="set-hint">
            {status}
            {plan.id === 'free' && (
              <>
                {' '}
                <a href="#/pricing">See pricing</a>
              </>
            )}
          </p>
        </div>
        <a className="btn" href="#/account/billing">
          {plan.id === 'free' ? 'See plans' : 'Manage billing'}
        </a>
      </div>
    </Section>
  );
}

// ── Company (contractors) ──────────────────────────────────────────────────

function CompanySection() {
  const refresh = useSession((s) => s.refresh);
  const [draft, setDraft] = useState<CompanyDraft | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ company?: string; phone?: string }>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    proApi
      .profile()
      .then((w) => {
        if (!live) return;
        setReadOnly(w.readOnly);
        if (!w.profile) return setMissing(true);
        const p = w.profile;
        setDraft({ company: p.company, phone: p.phone, email: p.email, website: p.website, serviceArea: p.serviceArea, defaultMarkupPct: p.defaultMarkupPct, taxPct: p.taxPct, logoFileId: p.logoFileId, logoUrl: p.logoUrl });
      })
      .catch((err) => live && setLoadError(errText(err, 'Your company details couldn’t be loaded.')));
    return () => {
      live = false;
    };
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setMsg(null);
    const next: typeof errors = {};
    if (!draft.company.trim()) next.company = 'Enter your business name.';
    const p = normalizePhone(draft.phone);
    if (!p.ok) next.phone = p.reason;
    else if (!p.value) next.phone = 'Enter a business phone number.';
    setErrors(next);
    if (next.company || next.phone) return;
    setBusy(true);
    try {
      const w = await proApi.saveProfile(draftToInput({ ...draft, phone: p.ok ? p.value : draft.phone }));
      if (w.profile) setDraft((d) => (d ? { ...d, company: w.profile!.company, phone: w.profile!.phone } : d));
      await refresh();
      setMsg({ tone: 'ok', text: 'Company details saved.' });
    } catch (err) {
      const field = err instanceof ApiError ? (err.body as { field?: string } | undefined)?.field : undefined;
      if (field === 'company' || field === 'phone') setErrors({ [field]: (err as ApiError).message });
      else setMsg({ tone: 'bad', text: errText(err, 'Could not save. Try again.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      id="company"
      title="Company"
      intro={
        <>
          Your business name and phone go on quotes and share links. Logo, website and pricing are in the <a href="#/pro/company">Contractor workspace</a>.
        </>
      }
    >
      {loadError && <div className="auth-error">{loadError}</div>}
      {missing && (
        <p className="set-hint">
          You haven’t set up your company yet. <a href="#/pro">Set it up</a> in the Contractor workspace.
        </p>
      )}
      {draft && (
        <form onSubmit={save} aria-label="Company" noValidate>
          <div className="set-grid">
            <label className="field">
              <span>Business name</span>
              <input value={draft.company} onChange={(e) => (setDraft({ ...draft, company: e.target.value }), setErrors((x) => ({ ...x, company: undefined })))} maxLength={80} required disabled={readOnly} aria-invalid={!!errors.company} autoComplete="organization" />
              {errors.company && <small className="set-field-error">{errors.company}</small>}
            </label>
            <label className="field">
              <span>Business phone</span>
              <input
                value={draft.phone}
                onChange={(e) => (setDraft({ ...draft, phone: e.target.value }), setErrors((x) => ({ ...x, phone: undefined })))}
                onBlur={() => {
                  const p = normalizePhone(draft.phone);
                  if (p.ok && p.value) setDraft({ ...draft, phone: p.value });
                }}
                inputMode="tel"
                autoComplete="tel"
                placeholder="(905) 555-0142"
                required
                disabled={readOnly}
                aria-invalid={!!errors.phone}
              />
              {errors.phone && <small className="set-field-error">{errors.phone}</small>}
            </label>
          </div>
          {readOnly ? (
            <p className="set-hint">Your Contractor plan has lapsed, so these are read-only. Renew it in Billing to change them.</p>
          ) : (
            <>
              <Note msg={msg} />
              <div className="set-actions">
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save company'}
                </button>
              </div>
            </>
          )}
        </form>
      )}
    </Section>
  );
}

// ── Your data ──────────────────────────────────────────────────────────────

function YourData() {
  const [state, setState] = useState<'idle' | 'downloading' | 'done' | { error: string }>('idle');
  const [deleting, setDeleting] = useState(false);

  const download = async () => {
    setState('downloading');
    try {
      let res: Response;
      try {
        res = await fetch('/api/account/export', { credentials: 'same-origin' });
      } catch {
        markDown();
        throw new Error('Can’t reach the server. Check your connection and try again.');
      }
      const type = res.headers.get('content-type') || '';
      if (!res.ok) {
        const body = type.includes('application/json') ? await res.json().catch(() => null) : null;
        throw new Error(body?.error || 'Your data couldn’t be prepared. Try again in a minute.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachmentName(res.headers.get('content-disposition'), 'blumodel-studio-my-data.json');
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setState('done');
    } catch (e) {
      setState({ error: e instanceof Error ? e.message : 'Your data couldn’t be prepared. Try again.' });
    }
  };

  return (
    <div className="acct-data">
      <p className="acct-copy">
        Download everything your account holds as a file: your details and preferences, kitchens, share links, orders and, for contractors, your brand page and leads. See the{' '}
        <a href="#/privacy" target="_blank" rel="noopener">
          Privacy policy
        </a>{' '}
        for what is kept and why.
      </p>
      <div className="acct-actions">
        <button type="button" className="btn" onClick={() => void download()} disabled={state === 'downloading'}>
          {state === 'downloading' ? 'Preparing…' : 'Download my data'}
        </button>
        <button type="button" className="btn acct-danger" onClick={() => setDeleting(true)} aria-expanded={deleting}>
          Delete my account
        </button>
      </div>
      {state === 'done' && (
        <div className="auth-ok" role="status">
          Your data file is downloading.
        </div>
      )}
      {typeof state === 'object' && (
        <div className="auth-error" role="alert">
          {state.error}
        </div>
      )}
      {deleting && <DeleteAccount onCancel={() => setDeleting(false)} />}
    </div>
  );
}

function DeleteAccount({ onCancel }: { onCancel: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; billing?: boolean } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return setError({ text: 'Type your password to confirm.' });
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(password);
      // The server has signed this browser out (cookie cleared). Forget the session here too.
      useSession.setState({ user: null, status: 'signedOut', projectId: null, conflict: null });
      navigateHash('#/?deleted=1', true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.body as { code?: string } | undefined)?.code === 'active_subscription')
        setError({ text: 'Your paid plan still renews. Cancel it in Billing first (you keep it to the end of the period you paid for), then delete your account.', billing: true });
      else setError({ text: errText(err, 'Your account couldn’t be deleted. Try again.') });
      setBusy(false);
    }
  };

  return (
    <form className="acct-delete" onSubmit={submit} aria-labelledby="acct-delete-title">
      <h4 id="acct-delete-title">Delete your account?</h4>
      <ul>
        <li>Your kitchens, the photos and files only you uploaded, your share links (they stop working) and any leads you received are deleted, and you are signed out everywhere.</li>
        <li>Records of payments and model orders are kept for accounting, without your name or email.</li>
        <li>If you’re on a paid plan that still renews, cancel it in Billing first.</li>
      </ul>
      <p className="acct-copy">This can’t be undone. Download your data first if you want a copy.</p>
      <label className="field">
        <span>Your password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {error && (
        <div className="auth-error" role="alert">
          {error.text}
          {error.billing && (
            <>
              {' '}
              <a href="#/account/billing">Go to Billing</a>
            </>
          )}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Keep my account
        </button>
        <button type="submit" className="btn acct-danger acct-danger--solid" disabled={busy}>
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>
    </form>
  );
}
