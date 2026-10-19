import { useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import { hrefFor } from '../../lib/router';
import { useDesignStore } from '../../store/useDesignStore';
import { Check, Alert } from '../../components/Icons';
import { brandApi, type BrandSettingsInput, type PriceDisplay } from './api';
import { useBrandTab } from './context';
import { slugify, SLUG_RE } from './logic';

const PRICE_OPTIONS: [PriceDisplay, string, string][] = [
  ['from', 'From $X', 'The lowest sell price across a product’s widths, e.g. “From $520”. The default.'],
  ['show', 'Show prices', 'Your sell price from the price book, per width.'],
  ['on_request', 'Price on request', 'No prices on the page; homeowners ask you for a quote.'],
];

/**
 * `#/pro/brand/settings` (BRAND_PAGE §3): one screen, pre-filled from Company. The public name and
 * address can change until the page first goes live. Cost and markup are never public, whatever
 * the price setting.
 */
export default function BrandSettings() {
  const { state, readOnly, setState } = useBrandTab();
  const b = state.brand;
  const d = state.defaults;
  const [name, setName] = useState(b?.name ?? d.name);
  const [slug, setSlug] = useState(b?.slug ?? d.slug);
  const [slugTouched, setSlugTouched] = useState(!!b);
  const [tagline, setTagline] = useState(b?.tagline ?? '');
  const [about, setAbout] = useState(b?.about ?? '');
  const [priceDisplay, setPriceDisplay] = useState<PriceDisplay>(b?.priceDisplay ?? 'from');
  const [leadForm, setLeadForm] = useState(b?.leadForm ?? true);
  const [showPhone, setShowPhone] = useState(b?.showPhone ?? false);
  const [showEmail, setShowEmail] = useState(b?.showEmail ?? false);
  const [cover, setCover] = useState<{ id: string | null; url: string | null }>({ id: b?.coverFileId ?? null, url: b?.coverUrl ?? null });
  const [busy, setBusy] = useState<'save' | 'submit' | 'cover' | null>(null);
  const [error, setError] = useState<{ text: string; field?: string } | null>(null);
  const toast = useDesignStore((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);

  const locked = !!b?.slugLocked;
  const ps = b?.pageStatus ?? 'none';
  const canSubmit = !readOnly && (ps === 'none' || ps === 'draft' || ps === 'rejected');

  const body = (): BrandSettingsInput => ({
    ...(locked ? {} : { name: name.trim(), slug: slug.trim() }),
    tagline: tagline.trim(),
    about: about.trim(),
    priceDisplay,
    leadForm,
    showPhone,
    showEmail,
    ...(cover.id !== (b?.coverFileId ?? null) ? { coverFileId: cover.id } : {}),
  });

  const fail = (e: unknown, fallback: string) => {
    const field = e instanceof ApiError ? (e.body as { field?: string } | undefined)?.field : undefined;
    setError({ text: e instanceof ApiError ? e.message : fallback, field });
  };

  const save = async (ev?: FormEvent) => {
    ev?.preventDefault();
    setError(null);
    if (!locked && !SLUG_RE.test(slug.trim())) {
      setError({ text: 'Use 2–60 lowercase letters, digits and dashes for the page address.', field: 'slug' });
      return false;
    }
    setBusy('save');
    try {
      setState(await brandApi.save(body()));
      toast(b ? 'Saved.' : 'Your page is set up. Submit it for review when it looks right.', 'ok');
      return true;
    } catch (e) {
      fail(e, 'Could not save. Try again.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!(await save())) return;
    setBusy('submit');
    try {
      setState(await brandApi.submit());
      toast('Submitted. BluModel Studio checks the business is real, usually within a day.', 'ok');
    } catch (e) {
      fail(e, 'Could not submit. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const pickCover = async (file: File | undefined) => {
    if (!file) return;
    setBusy('cover');
    setError(null);
    try {
      const { file: f } = await brandApi.uploadCover(file);
      setCover({ id: f.id, url: f.url });
    } catch (e) {
      fail(e, 'That image didn’t upload.');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const bad = (f: string) => (error?.field === f ? ' is-bad' : '');
  const checks = state.checks.map((c) => (c.id === 'tagline' ? { ...c, ok: !!tagline.trim() } : c.id === 'name' ? { ...c, ok: !!name.trim() } : c));

  return (
    <form className="brand-settings" onSubmit={save} noValidate>
      <div className="brand-settings-grid">
        <div className="brand-settings-main">
          <section className="pro-card">
            <span className="eyebrow">Your page</span>
            <label className={`field${bad('name')}`}>
              <span>
                Public name {locked && <em>· set once the page has been live; ask BluModel Studio to change it</em>}
              </span>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched && !locked) setSlug(slugify(e.target.value));
                }}
                disabled={readOnly || locked}
                maxLength={80}
              />
            </label>
            <label className={`field${bad('slug')}`}>
              <span>
                Page address {locked ? <em>· fixed once live</em> : <em>· can change until your page first goes live</em>}
              </span>
              <span className="brand-slug">
                <span className="brand-slug-prefix mono">#/b/</span>
                <input
                  className="mono"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''));
                  }}
                  disabled={readOnly || locked}
                  maxLength={60}
                  aria-label="Page address"
                />
              </span>
            </label>
            <label className={`field${bad('tagline')}`}>
              <span>
                Tagline <em>· {tagline.length}/80</em>
              </span>
              <input value={tagline} onChange={(e) => setTagline(e.target.value)} disabled={readOnly} maxLength={80} placeholder="Custom shaker cabinetry for the Hamilton area" />
            </label>
            <label className={`field${bad('about')}`}>
              <span>
                About <em>· {about.length}/600</em>
              </span>
              <textarea className="brand-textarea" rows={5} value={about} onChange={(e) => setAbout(e.target.value)} disabled={readOnly} maxLength={600} placeholder="Who you are, what you build, where you work." />
            </label>
            <div className={`field${bad('coverFileId')}`}>
              <span>
                Cover image <em>· optional; public once your page is approved</em>
              </span>
              <div className="brand-cover-pick">
                <div className="brand-cover-box">{cover.url ? <img src={cover.url} alt="Cover" /> : <span className="muted">No cover: a plain band is used</span>}</div>
                {!readOnly && (
                  <div className="brand-cover-actions">
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void pickCover(e.target.files?.[0])} />
                    <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
                      {busy === 'cover' ? 'Uploading…' : cover.url ? 'Replace' : 'Upload'}
                    </button>
                    {cover.url && (
                      <button type="button" className="btn" onClick={() => setCover({ id: null, url: null })} disabled={busy !== null}>
                        Remove
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="pro-card">
            <span className="eyebrow">Prices on your page</span>
            <div className="brand-radios" role="radiogroup" aria-label="Price display">
              {PRICE_OPTIONS.map(([k, label, why]) => (
                <label key={k} className={`brand-radio${priceDisplay === k ? ' on' : ''}`}>
                  <input type="radio" name="priceDisplay" value={k} checked={priceDisplay === k} onChange={() => setPriceDisplay(k)} disabled={readOnly} />
                  <span>
                    <b>{label}</b>
                    <span className="muted">{why}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="fine">Your cost and markup are never public, whatever you pick. Prices follow your price book: change a cost and the page updates, with no new review.</p>
          </section>

          <section className="pro-card">
            <span className="eyebrow">How homeowners reach you</span>
            <label className="pro-check">
              <input type="checkbox" checked={leadForm} onChange={(e) => setLeadForm(e.target.checked)} disabled={readOnly} /> Lead form: “Contact” and “Request a quote” buttons
            </label>
            <label className="pro-check">
              <input type="checkbox" checked={showPhone} onChange={(e) => setShowPhone(e.target.checked)} disabled={readOnly || !d.phone} /> Show my phone number publicly {d.phone ? <span className="muted">({d.phone})</span> : <span className="muted">(none in Company)</span>}
            </label>
            <label className="pro-check">
              <input type="checkbox" checked={showEmail} onChange={(e) => setShowEmail(e.target.checked)} disabled={readOnly || !d.email} /> Show my email publicly {d.email ? <span className="muted">({d.email})</span> : <span className="muted">(none in Company)</span>}
            </label>
          </section>
        </div>

        <aside className="brand-settings-side">
          <section className="pro-card">
            <span className="eyebrow">From your Company profile</span>
            <div className="brand-company">
              {d.logoUrl ? <img src={d.logoUrl} alt="Logo" /> : <span className="brand-company-nologo">No logo</span>}
              <dl>
                <dt>Website</dt>
                <dd>{d.website || '—'}</dd>
                <dt>Phone</dt>
                <dd>{d.phone || '—'}</dd>
                <dt>Email</dt>
                <dd>{d.email || '—'}</dd>
                <dt>Service area</dt>
                <dd>{d.serviceArea || '—'}</dd>
              </dl>
            </div>
            <a className="btn" href={hrefFor({ name: 'pro', rest: 'company' })}>
              Edit in Company
            </a>
          </section>
          {canSubmit && (
            <section className="pro-card">
              <span className="eyebrow">Before you submit</span>
              <ul className="brand-ready brand-ready--page">
                {checks.map((c) => (
                  <li key={c.id} className={c.ok ? 'ok' : 'missing'}>
                    {c.ok ? <Check width={13} height={13} /> : <Alert width={13} height={13} />} {c.label}
                  </li>
                ))}
              </ul>
              <p className="fine">BluModel Studio checks the name, website and phone are a real business, then the page goes live with a Verified contractor badge. While it’s in review you can preview exactly what will be public.</p>
            </section>
          )}
          {ps === 'in_review' && (
            <section className="pro-card">
              <span className="eyebrow">In review</span>
              <p>BluModel Studio is checking your business. You can still change these settings; the reviewer sees the latest.</p>
            </section>
          )}
          {state.history.length > 0 && (
            <section className="pro-card">
              <span className="eyebrow">Notes from BluModel Studio</span>
              <ul className="brand-history">
                {state.history.map((h) => (
                  <li key={h.at + h.action}>
                    <b>{h.action === 'reject' ? 'Changes requested' : h.action}</b> {h.note}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>

      {error && <div className="auth-error">{error.text}</div>}
      {!readOnly && (
        <div className="brand-settings-bar">
          {b && (
            <a className="btn" href={hrefFor({ name: 'pro', rest: 'brand/preview' })}>
              Preview
            </a>
          )}
          <button type="submit" className="btn" disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : b ? 'Save' : 'Create my page'}
          </button>
          {canSubmit && (
            <button type="button" className="btn primary" onClick={() => void submit()} disabled={busy !== null || !checks.every((c) => c.ok)}>
              {busy === 'submit' ? 'Submitting…' : ps === 'rejected' ? 'Save and resubmit' : 'Save and submit for review'}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
