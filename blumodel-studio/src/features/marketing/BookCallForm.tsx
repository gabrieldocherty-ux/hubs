import { useId, useState, type FormEvent } from 'react';
import { ApiError, call, isUnreachable } from '../../lib/api';
import { useLegal } from '../../lib/config';
import { checkSalesLead, type SalesLeadField, type SalesLeadValues } from './logic';
import { CheckIcon } from './parts';

/*
 * "Book a call" (docs/SHOWROOM_PIVOT.md §6): company, name, phone, email, city and a message,
 * posted to the foundation's POST /api/sales-leads. It lands in Admin as a sales lead, and in
 * SUPPORT_EMAIL's inbox when email is set up. `website` is the honeypot: hidden from people and
 * from screen readers, so only a bot fills it in (the server then says "accepted" and keeps nothing).
 */

type Field = SalesLeadField;
type Values = SalesLeadValues;
const EMPTY: Values = { company: '', name: '', phone: '', email: '', city: '', message: '' };

export function BookCallForm({ headingId }: { headingId?: string }) {
  const uid = useId();
  const legal = useLegal();
  const [v, setV] = useState<Values>(EMPTY);
  const [trap, setTrap] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [sentName, setSentName] = useState('');

  const set = (f: Field) => (e: { target: { value: string } }) => {
    setV((x) => ({ ...x, [f]: e.target.value }));
    if (errors[f]) setErrors((x) => ({ ...x, [f]: undefined }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (state === 'sending') return;
    const found = checkSalesLead(v);
    setErrors(found);
    setProblem(null);
    const first = (Object.keys(found) as Field[])[0];
    if (first) {
      document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    setState('sending');
    try {
      await call('POST', '/api/sales-leads', {
        company: v.company.trim(),
        name: v.name.trim(),
        phone: v.phone.trim(),
        email: v.email.trim(),
        city: v.city.trim(),
        message: v.message.trim(),
        website: trap,
      });
      setSentName(v.name.trim().split(/\s+/)[0] ?? '');
      setV(EMPTY);
      setState('sent');
    } catch (err) {
      setState('idle');
      const body = err instanceof ApiError ? (err.body as { errors?: { field: string; message: string }[] } | undefined) : undefined;
      if (body?.errors?.length) {
        const map: Partial<Record<Field, string>> = {};
        for (const x of body.errors) if (x.field in EMPTY) map[x.field as Field] = x.message;
        setErrors(map);
        return;
      }
      const reach = legal.supportEmail ? ` You can also email us at ${legal.supportEmail}.` : '';
      if (err instanceof ApiError && err.status === 429) setProblem(`That’s a lot of requests from this connection. Please try again later.${reach}`);
      else if (isUnreachable(err)) setProblem(`We couldn’t reach our server just now. Check your connection and try again.${reach}`);
      else setProblem(`Something went wrong sending that. Please try again.${reach}`);
    }
  }

  if (state === 'sent')
    return (
      <div className="mk-form-done" role="status">
        <span className="mk-form-done-icon">
          <CheckIcon />
        </span>
        <h3>Thanks{sentName ? `, ${sentName}` : ''}. We’ve got your request.</h3>
        <p>We’ll get in touch to find a time that suits you, and we’ll walk you through the demo showroom on the call.</p>
        <button type="button" className="btn" onClick={() => setState('idle')}>
          Send another request
        </button>
      </div>
    );

  const input = (f: Field, label: string, opts: { type?: string; auto?: string; required?: boolean; hint?: string; inputMode?: 'tel' | 'email' } = {}) => (
    <div className={`mk-field${errors[f] ? ' has-error' : ''}`}>
      <label htmlFor={`${uid}-${f}`}>
        {label}
        {!opts.required && <span className="mk-field-opt"> (optional)</span>}
      </label>
      <input
        id={`${uid}-${f}`}
        name={f}
        type={opts.type ?? 'text'}
        inputMode={opts.inputMode}
        autoComplete={opts.auto}
        value={v[f]}
        onChange={set(f)}
        maxLength={f === 'email' ? 254 : f === 'phone' ? 40 : f === 'company' ? 120 : f === 'city' ? 80 : 100}
        aria-invalid={errors[f] ? true : undefined}
        aria-describedby={errors[f] ? `${uid}-${f}-err` : undefined}
        required={opts.required}
      />
      {errors[f] && (
        <span className="mk-field-err" id={`${uid}-${f}-err`}>
          {errors[f]}
        </span>
      )}
    </div>
  );

  return (
    <form className="mk-form" onSubmit={submit} noValidate aria-labelledby={headingId}>
      <div className="mk-form-grid">
        {input('company', 'Company', { auto: 'organization', required: true })}
        {input('name', 'Your name', { auto: 'name', required: true })}
        {input('email', 'Email', { type: 'email', auto: 'email', required: true, inputMode: 'email' })}
        {input('phone', 'Phone', { type: 'tel', auto: 'tel', inputMode: 'tel' })}
        {input('city', 'City', { auto: 'address-level2' })}
      </div>
      <div className="mk-field">
        <label htmlFor={`${uid}-message`}>
          Anything we should know? <span className="mk-field-opt">(optional)</span>
        </label>
        <textarea
          id={`${uid}-message`}
          name="message"
          rows={4}
          maxLength={2000}
          value={v.message}
          onChange={set('message')}
          placeholder="For example: we sell two cabinet lines and do bathrooms too. Best time to call is after 3."
        />
      </div>
      {/* The honeypot: people never see it. */}
      <div className="mk-hp" aria-hidden="true">
        <label htmlFor={`${uid}-website`}>Website</label>
        <input id={`${uid}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
      </div>
      {problem && (
        <p className="mk-form-problem" role="alert">
          {problem}
        </p>
      )}
      <div className="mk-form-actions">
        <button type="submit" className="btn primary big" disabled={state === 'sending'}>
          {state === 'sending' ? 'Sending…' : 'Book a call'}
        </button>
        <p className="mk-form-note">
          We use these details only to arrange the call. See the <a href="#/privacy">privacy policy</a>.
        </p>
      </div>
    </form>
  );
}
