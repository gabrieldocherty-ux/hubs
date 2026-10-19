import { useId, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '../../components/Dialog';
import { Check } from '../../components/Icons';
import { ApiError, call } from '../../lib/api';
import { flushAutosave } from '../../hooks/useAutosave';
import { useSession } from '../../store/useSession';
import { CompanyLogo } from './SiteMark';
import { useVisitor } from './visitor';
import { shortName, telHref, type PublicTenant } from './site';
import { BUDGETS, checkLead, consentText, EMPTY_LEAD, leadBody, rememberSent, serverErrors, TIMELINES, type LeadDraft, type LeadErrors, type LeadField } from './send';

interface Props {
  tenant: PublicTenant;
  design: { projectId: string } | { shareToken: string };
  designName: string;
  /** Remembered on this device once sent (`k:<projectId>` or `s:<token>`). */
  sentKey: string;
  onSent: (at: number) => void;
  onClose: () => void;
}

/**
 * The form behind "Send this design to <Company>" (docs/SHOWROOM_PIVOT.md §5): name, email, phone,
 * postal code, an optional budget and timeline, notes and the consent box. It posts to
 * POST /api/leads with the visitor's own kitchen (the server makes a view-only link for the
 * company) or the share link being looked at, and ends on a calm "sent" page with the company's
 * contact details.
 */
export default function SendDialog({ tenant, design, designName, sentKey, onSent, onClose }: Props) {
  const user = useSession((s) => s.user);
  const name = shortName(tenant);
  // Prefilled from what this browser gave in "Before you start" (else the account).
  const visitor = useVisitor();
  const [d, setD] = useState<LeadDraft>(() => ({ ...EMPTY_LEAD, name: visitor?.name || user?.name || '', email: visitor?.email || user?.email || '', phone: visitor?.phone ?? '' }));
  const [errors, setErrors] = useState<LeadErrors>({});
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  const [done, setDone] = useState(false);
  const honeypot = useRef<HTMLInputElement>(null);
  const id = useId();
  const set = (k: LeadField, v: string | boolean) => {
    setD((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setFailed('');
    const found = checkLead(d, tenant.name);
    setErrors(found);
    const first = Object.keys(found)[0];
    if (first) {
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      // The company opens the saved design, so what is on screen is saved first.
      if ('projectId' in design && !(await flushAutosave())) {
        setFailed('Your latest changes aren’t saved yet (offline, or changed somewhere else). Save the design, then send it.');
        return;
      }
      const body = { ...leadBody(d, design), website: honeypot.current?.value ?? '' };
      await call<{ ok: true; id: string }>('POST', '/api/leads', body);
      const at = Date.now();
      rememberSent(sentKey, at);
      onSent(at);
      setDone(true);
    } catch (err) {
      const fields = err instanceof ApiError ? serverErrors(err.body) : {};
      if (Object.keys(fields).length) setErrors(fields);
      else if (err instanceof ApiError && err.status === 429) setFailed('That’s a lot of sends from here in a short while. Wait a few minutes, then try again.');
      else if (err instanceof ApiError && err.status === 0) setFailed('You’re offline. Your details are still here: send them once you’re connected.');
      else setFailed(err instanceof ApiError ? err.message : 'That didn’t send. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done)
    return (
      <Dialog title={`Sent to ${name}`} onClose={onClose} className="sr-send-dialog">
        <div className="sr-send-done" role="status" data-testid="send-done">
          <span className="sr-send-done-icon" aria-hidden="true">
            <Check width={22} height={22} />
          </span>
          <p className="sr-send-done-lead">
            <b>“{designName}”</b> is on its way to {name}, with a view-only link to your design.
          </p>
          <p>They’ll get back to you at {[d.email.trim(), d.phone.trim()].filter(Boolean).join(' or ')}. Keep designing: the changes you make show up on their link too.</p>
          <Contact tenant={tenant} />
          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={onClose} data-autofocus>
              Done
            </button>
          </div>
        </div>
      </Dialog>
    );

  const field = (k: LeadField) => ({
    id: `${id}-${k}`,
    'aria-invalid': errors[k] ? true : undefined,
    'aria-describedby': errors[k] ? `${id}-${k}-err` : undefined,
  });
  const err = (k: LeadField) =>
    errors[k] ? (
      <span className="sr-send-err" id={`${id}-${k}-err`}>
        {errors[k]}
      </span>
    ) : null;

  return (
    <Dialog title={`Send this design to ${name}`} onClose={onClose} className="sr-send-dialog">
      <form className="sr-send-form" onSubmit={submit} noValidate>
        <div className="sr-send-head">
          <CompanyLogo tenant={tenant} />
          <p>
            {name} gets <b>“{designName}”</b> as a view-only link with your details, and gets back to you about it. Free, with no obligation.
          </p>
        </div>
        <div className="sr-send-grid">
          <label className="field">
            <span>Your name</span>
            <input {...field('name')} value={d.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" maxLength={100} data-autofocus />
            {err('name')}
          </label>
          <label className="field">
            <span>Email</span>
            <input {...field('email')} type="email" value={d.email} onChange={(e) => set('email', e.target.value)} autoComplete="email" inputMode="email" maxLength={254} />
            {err('email')}
          </label>
          <label className="field">
            <span>
              Phone <em>· or email, one is enough</em>
            </span>
            <input {...field('phone')} type="tel" value={d.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" inputMode="tel" maxLength={40} />
            {err('phone')}
          </label>
          <label className="field">
            <span>
              Postal code <em>· optional</em>
            </span>
            <input {...field('postalCode')} value={d.postalCode} onChange={(e) => set('postalCode', e.target.value)} autoComplete="postal-code" maxLength={12} />
            {err('postalCode')}
          </label>
          <label className="field">
            <span>
              Budget <em>· optional</em>
            </span>
            <select {...field('budget')} value={d.budget} onChange={(e) => set('budget', e.target.value)}>
              <option value="">Choose…</option>
              {BUDGETS.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>
              When <em>· optional</em>
            </span>
            <select {...field('timeline')} value={d.timeline} onChange={(e) => set('timeline', e.target.value)}>
              <option value="">Choose…</option>
              {TIMELINES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field sr-send-wide">
            <span>
              Anything {name} should know <em>· optional</em>
            </span>
            <textarea {...field('notes')} value={d.notes} onChange={(e) => set('notes', e.target.value)} rows={3} maxLength={2000} placeholder="What you’d like to change, when to call, questions…" />
          </label>
        </div>
        {/* Left empty by people; a bot that fills every field gets "accepted" and nothing is stored. */}
        <div className="sr-send-hp" aria-hidden="true">
          <label>
            Website <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>
        <label className={errors.consent ? 'sr-send-consent is-bad' : 'sr-send-consent'}>
          <input {...field('consent')} type="checkbox" checked={d.consent} onChange={(e) => set('consent', e.target.checked)} />
          <span>{consentText(tenant.name)}</span>
        </label>
        {err('consent')}
        {failed && (
          <p className="sr-send-failed" role="alert">
            {failed}
          </p>
        )}
        <p className="sr-send-fine">
          Your details go to {name} only. See the{' '}
          <a href="#/privacy" target="_blank" rel="noopener">
            privacy policy
          </a>
          .
        </p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Sending…' : `Send to ${name}`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** The company's ways to reach it, under the "sent" message. */
function Contact({ tenant }: { tenant: PublicTenant }) {
  const c = tenant.contact;
  const tel = c.phone ? telHref(c.phone) : null;
  if (!tel && !c.email && !c.website) return null;
  return (
    <ul className="sr-send-contact" aria-label={`Contact ${shortName(tenant)}`}>
      {tel && (
        <li>
          <a href={tel}>Call {c.phone}</a>
        </li>
      )}
      {c.email && (
        <li>
          <a href={`mailto:${c.email}`}>{c.email}</a>
        </li>
      )}
      {c.website && (
        <li>
          <a href={c.website} target="_blank" rel="noopener noreferrer">
            {c.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
          </a>
        </li>
      )}
    </ul>
  );
}
