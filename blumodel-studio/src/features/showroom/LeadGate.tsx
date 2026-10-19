import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError } from '../../lib/api';
import { signinHref } from '../../lib/router';
import { useSession } from '../../store/useSession';
import { CompanyLogo, SiteMark } from './SiteMark';
import { useShowroom } from './useShowroom';
import { shortName } from './site';
import { checkStart, EMPTY_START, loadVisitor, startConsentText, startServerErrors, startVisiting, useVisitorStore, type StartDraft, type StartErrors, type StartField } from './visitor';
import './gate.css';

/** The signed-in person's role on this showroom's team, if any. */
function useTeamRole(): 'owner' | 'staff' | null {
  return useSession((s) => (s.user as { showroom?: { role?: 'owner' | 'staff' | null } | null } | null)?.showroom?.role ?? null);
}

/**
 * "Before you start" (docs/handoff/leads.md): starting a design on a showroom (#/new, the editor
 * and a device design) first asks for a name and an email or phone, with the company's consent box.
 * The answer makes the visitor a lead of the company's and their designs save to the server under
 * it. Returning visitors, and the company's own team, go straight through. On the sales site it
 * renders its children.
 */
export function LeadGate({ children }: { children: ReactNode }) {
  const tenant = useShowroom();
  const session = useSession((s) => s.status);
  const userId = useSession((s) => s.user?.id ?? null);
  const team = useTeamRole();
  const status = useVisitorStore((s) => s.status);
  const visitor = useVisitorStore((s) => s.visitor);
  const asked = useRef<string | null | undefined>(undefined);

  // Who this browser is, once per account (signing in can link an earlier answer).
  useEffect(() => {
    if (!tenant || session === 'loading') return;
    if (asked.current === userId) return;
    const again = asked.current !== undefined;
    asked.current = userId;
    void loadVisitor(again);
  }, [tenant, session, userId]);

  if (!tenant) return <>{children}</>;
  if (session === 'loading') return <div className="screen-msg">Loading…</div>;
  if (team) return <>{children}</>;
  if (visitor) return <>{children}</>;
  if (status === 'idle' || status === 'loading') return <div className="screen-msg">Loading…</div>;
  return <StartForm />;
}

function StartForm() {
  const tenant = useShowroom()!;
  const user = useSession((s) => s.user);
  const name = shortName(tenant);
  const [d, setD] = useState<StartDraft>(() => ({ ...EMPTY_START, name: user?.name ?? '', email: user?.email ?? '' }));
  const [errors, setErrors] = useState<StartErrors>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const honeypot = useRef<HTMLInputElement>(null);
  const id = useId();
  const set = (k: keyof StartDraft, v: string | boolean) => {
    setD((x) => ({ ...x, [k]: v }));
    setErrors((e) => (e[k] || ((k === 'email' || k === 'phone') && e.contact) ? { ...e, [k]: undefined, ...(k === 'email' || k === 'phone' ? { contact: undefined } : {}) } : e));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setFailed('');
    const found = checkStart(d, tenant.name);
    setErrors(found);
    const first = (Object.keys(found) as StartField[])[0];
    if (first) {
      document.getElementById(`${id}-${first === 'contact' ? 'email' : first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      await startVisiting(d, honeypot.current?.value ?? '');
    } catch (err) {
      const fields = err instanceof ApiError ? startServerErrors(err.body) : {};
      if (Object.keys(fields).length) setErrors(fields);
      else if (err instanceof ApiError && err.status === 429) setFailed('That’s a lot of tries from here in a short while. Wait a few minutes, then try again.');
      else if (err instanceof ApiError && err.status === 0) setFailed('You’re offline. Your details are still here: try again once you’re connected.');
      else setFailed(err instanceof ApiError ? err.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const field = (k: StartField, describe = true) => ({
    id: `${id}-${k}`,
    'aria-invalid': errors[k] || ((k === 'email' || k === 'phone') && errors.contact) ? true : undefined,
    'aria-describedby': describe ? [errors[k] ? `${id}-${k}-err` : '', (k === 'email' || k === 'phone') && errors.contact ? `${id}-contact-err` : `${id}-either`].filter(Boolean).join(' ') || undefined : undefined,
  });
  const err = (k: StartField) =>
    errors[k] ? (
      <span className="sr-send-err" id={`${id}-${k}-err`}>
        {errors[k]}
      </span>
    ) : null;

  return (
    <div className="sr-gate">
      <header className="sr-gate-bar">
        <a className="brand" href="#/" aria-label={`${name} home`}>
          <SiteMark />
        </a>
      </header>
      <main className="sr-gate-main">
        <form className="sr-gate-card sr-send-form" onSubmit={submit} noValidate aria-labelledby={`${id}-title`} data-testid="lead-gate">
          <div className="sr-gate-head">
            <CompanyLogo tenant={tenant} size={48} />
            <div>
              <h1 id={`${id}-title`}>Before you start</h1>
              <p>Tell {name} who you are and your design is saved as you go, so you can come back to it. It’s free, with no obligation.</p>
            </div>
          </div>
          <label className="field">
            <span>Your name</span>
            <input {...field('name')} value={d.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" maxLength={100} autoFocus />
            {err('name')}
          </label>
          <p className="sr-gate-either" id={`${id}-either`}>
            An email or a phone number, so {name} can reach you. One is enough.
          </p>
          <div className="sr-gate-pair">
            <label className="field">
              <span>Email</span>
              <input {...field('email')} type="email" value={d.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" inputMode="email" maxLength={254} />
              {err('email')}
            </label>
            <label className="field">
              <span>Phone</span>
              <input {...field('phone')} type="tel" value={d.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" inputMode="tel" maxLength={40} placeholder="(905) 555-0142" />
              {err('phone')}
            </label>
          </div>
          {errors.contact && (
            <p className="sr-send-err sr-gate-contact-err" id={`${id}-contact-err`} role="alert">
              {errors.contact}
            </p>
          )}
          {/* Left empty by people; a bot that fills every field gets "accepted" and nothing is stored. */}
          <div className="sr-send-hp" aria-hidden="true">
            <label>
              Website <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
            </label>
          </div>
          <label className={errors.consent ? 'sr-send-consent is-bad' : 'sr-send-consent'}>
            <input {...field('consent', false)} type="checkbox" checked={d.consent} onChange={(e) => set('consent', e.target.checked)} aria-describedby={errors.consent ? `${id}-consent-err` : undefined} />
            <span>{startConsentText(tenant.name)}</span>
          </label>
          {err('consent')}
          {failed && (
            <p className="sr-send-failed" role="alert">
              {failed}
            </p>
          )}
          <button type="submit" className="btn primary sr-gate-go" disabled={busy}>
            {busy ? 'One moment…' : 'Start designing'}
          </button>
          <p className="sr-send-fine">
            Your details go to {name} only, and BluModel Studio keeps them for {name}. See the{' '}
            <a href="#/privacy" target="_blank" rel="noopener">
              privacy policy
            </a>
            .
          </p>
          {!user && (
            <p className="sr-gate-team">
              On {name}’s team? <a href={signinHref()}>Sign in</a>
            </p>
          )}
        </form>
      </main>
    </div>
  );
}
