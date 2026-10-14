import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type Project } from '../../lib/api';
import { useSession } from '../../store/useSession';
import { Check, Close } from '../../components/Icons';
import { brandApi } from './api';
import './brands.css';

export interface LeadFormProps {
  slug: string;
  company: string;
  /** The product the homeowner came from; attached automatically. */
  product?: { id: string; name: string } | null;
  /** In the owner's preview nothing is sent. */
  preview?: boolean;
  onClose: () => void;
}

/**
 * "Contact <company>" / "Request a quote" (BRAND_PAGE §5): name, email, optional phone, city or
 * postcode and a message; optionally one of the homeowner's kitchens; a required consent box; a
 * hidden honeypot field for bots. The server rate-limits by IP without storing it.
 */
export default function LeadForm({ slug, company, product, preview = false, onClose }: LeadFormProps) {
  const user = useSession((s) => s.user);
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [message, setMessage] = useState(product ? `I’d like a quote for the ${product.name}.` : '');
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState('');
  const [projectId, setProjectId] = useState('');
  const [kitchens, setKitchens] = useState<Pick<Project, 'id' | 'name' | 'updatedAt'>[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const [sent, setSent] = useState(false);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!user || preview) return;
    let live = true;
    api
      .listProjects()
      .then((r) => live && setKitchens(r.projects.map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })).sort((a, b) => b.updatedAt - a.updatedAt)))
      .catch(() => live && setKitchens([]));
    return () => {
      live = false;
    };
  }, [user, preview]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // The server checks these too; checking first means no share link is made for a lead that can't go.
    if (!name.trim()) {
      setError({ text: 'Tell them your name.', field: 'name' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError({ text: 'That email address does not look right.', field: 'email' });
      return;
    }
    if (!consent) {
      setError({ text: `Tick the box to share your details with ${company}.`, field: 'consent' });
      return;
    }
    if (preview) {
      setSent(true);
      return;
    }
    setBusy(true);
    // An attached kitchen goes as a view-only share link the contractor can open.
    let share: { id: string; token: string } | null = null;
    try {
      if (projectId) share = await brandApi.shareKitchen(projectId, `Sent to ${company}`);
      await brandApi.sendLead(slug, {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        location: location.trim() || undefined,
        message: message.trim() || undefined,
        consent: true,
        ...(product ? { productId: product.id } : {}),
        ...(projectId ? { projectId } : {}),
        ...(share ? { shareToken: share.token } : {}),
        website_url: trap,
      });
      setSent(true);
    } catch (err) {
      if (share) void brandApi.revokeShare(projectId, share.id);
      const body = err instanceof ApiError ? (err.body as { field?: string } | undefined) : undefined;
      setError({ text: err instanceof ApiError ? err.message : 'That didn’t send. Try again.', field: body?.field });
    } finally {
      setBusy(false);
    }
  };

  const bad = (f: string) => (error?.field === f ? 'is-bad' : undefined);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {sent ? (
        <div className="modal lead-modal lead-sent" role="dialog" aria-modal="true" aria-labelledby="lead-title">
          <header>
            <h3 id="lead-title">Sent to {company}</h3>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <Close />
            </button>
          </header>
          <div className="lead-sent-mark" aria-hidden="true">
            <Check width={28} height={28} />
          </div>
          <p className="dialog-copy">
            {preview
              ? 'This is the preview, so nothing was sent. Homeowners see this confirmation once their request reaches you.'
              : `${company} has your details and will contact you${email ? ` at ${email}` : ''}. BluModel Studio doesn’t share them with anyone else.`}
          </p>
          <div className="modal-actions">
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form className="modal lead-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="lead-title" noValidate>
          <header>
            <h3 id="lead-title">{product ? 'Request a quote' : `Contact ${company}`}</h3>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <Close />
            </button>
          </header>
          {preview && <div className="auth-note">Preview: the form works, but nothing is sent.</div>}
          {product && (
            <p className="lead-about">
              About <b>{product.name}</b>
            </p>
          )}
          <div className="lead-grid">
            <label className={`field ${bad('name') ?? ''}`}>
              <span>Your name</span>
              <input ref={first} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} />
            </label>
            <label className={`field ${bad('email') ?? ''}`}>
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={254} />
            </label>
            <label className={`field ${bad('phone') ?? ''}`}>
              <span>
                Phone <em>· optional</em>
              </span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={40} />
            </label>
            <label className="field">
              <span>
                City or postcode <em>· optional</em>
              </span>
              <input value={location} onChange={(e) => setLocation(e.target.value)} autoComplete="postal-code" maxLength={80} />
            </label>
          </div>
          <label className="field">
            <span>Message</span>
            <textarea className="brand-textarea" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
          </label>
          {user && !preview && (
            <label className={`field ${bad('projectId') ?? ''}`}>
              <span>
                Attach one of my kitchens <em>· optional</em>
              </span>
              <select className="brand-select" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!kitchens?.length} aria-describedby={projectId ? 'lead-kitchen-note' : undefined}>
                <option value="">{kitchens === null ? 'Loading your kitchens…' : kitchens.length ? 'Don’t attach a kitchen' : 'You have no saved kitchens yet'}</option>
                {kitchens?.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
              {projectId && (
                <em className="lead-kitchen-note" id="lead-kitchen-note">
                  {company} gets a view-only link to it. Your other kitchens stay private.
                </em>
              )}
            </label>
          )}
          {/* A field people never see: bots fill it in, and the server then keeps nothing. */}
          <div className="lead-trap" aria-hidden="true">
            <label>
              Website
              <input tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} name="website_url" />
            </label>
          </div>
          <label className={`lead-consent ${bad('consent') ?? ''}`}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>Share these details with {company} so they can contact me</span>
          </label>
          {error && <div className="auth-error">{error.text}</div>}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
          {!user && !preview && (
            <p className="fine lead-fine">
              <a href={`#/signin?next=${encodeURIComponent(location_())}`}>Sign in</a> to attach one of your kitchens.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

/** The current hash (a function so the name doesn't shadow the form's `location` field). */
const location_ = () => window.location.hash || '#/';
