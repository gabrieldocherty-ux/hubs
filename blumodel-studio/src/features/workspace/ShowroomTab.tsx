import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import { useDesignStore } from '../../store/useDesignStore';
import { wsApi, type Branding, type Contact, type Hostname, type ShowroomPatch, type ShowroomSettings, type StaffTenant } from './api';
import { checkAccent, checkPrimary, normalizeHex, textOn } from './colour';
import { useWorkspace } from './context';
import { ShowroomPictures } from './ShowroomPictures';

interface Draft {
  name: string;
  branding: Omit<Branding, 'logoUrl'> & { logoUrl: string | null };
  contact: Contact;
  settings: ShowroomSettings;
}

const draftOf = (t: StaffTenant): Draft => ({
  name: t.name,
  branding: { ...t.branding, featuredLines: [...t.branding.featuredLines] },
  contact: { ...t.contact },
  settings: { ...t.settings },
});

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type FieldErrors = Record<string, string>;

/**
 * The Showroom tab: what visitors see of the company (name, logo, colours with a live preview and
 * a contrast warning, the welcome, featured lines, contact details, service area), its web
 * addresses (with how to connect the company's own domain) and, for owners, the switches: fill the
 * gaps with BluModel Basics, bathrooms, and visitor renders with a daily cap.
 */
export default function ShowroomTab() {
  const { tenant, owner, setTenant } = useWorkspace();
  const toast = useDesignStore((s) => s.toast);
  const [draft, setDraft] = useState<Draft>(() => draftOf(tenant));
  const [base, setBase] = useState<Draft>(() => draftOf(tenant));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldErrors>({});
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    wsApi
      .products()
      .then((r) => live && setLines([...new Set(r.products.map((p) => p.line).filter((l): l is string => !!l))].sort()))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setB = (patch: Partial<Draft['branding']>) => setDraft((d) => ({ ...d, branding: { ...d.branding, ...patch } }));
  const setC = (patch: Partial<Contact>) => setDraft((d) => ({ ...d, contact: { ...d.contact, ...patch } }));
  const setS = (patch: Partial<ShowroomSettings>) => setDraft((d) => ({ ...d, settings: { ...d.settings, ...patch } }));

  const patch = useMemo((): ShowroomPatch => {
    const p: ShowroomPatch = {};
    if (draft.name.trim() !== base.name) p.name = draft.name.trim();
    const { logoUrl: _a, ...b } = draft.branding;
    const { logoUrl: _b, ...bb } = base.branding;
    const bp: Record<string, unknown> = {};
    for (const k of Object.keys(b) as (keyof typeof b)[]) if (!same(b[k], bb[k])) bp[k] = b[k];
    if (Object.keys(bp).length) p.branding = bp as ShowroomPatch['branding'];
    const cp: Partial<Contact> = {};
    for (const k of Object.keys(draft.contact) as (keyof Contact)[]) if (draft.contact[k] !== base.contact[k]) cp[k] = draft.contact[k].trim();
    if (Object.keys(cp).length) p.contact = cp;
    if (owner && !same(draft.settings, base.settings)) p.settings = draft.settings;
    return p;
  }, [draft, base, owner]);
  const dirty = Object.keys(patch).length > 0;

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!dirty) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const r = await wsApi.saveShowroom(patch);
      setTenant(r.tenant);
      setDraft(draftOf(r.tenant));
      setBase(draftOf(r.tenant));
      toast('Showroom saved. Visitors see the changes on their next visit.', 'ok');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const errs = (err.body as { errors?: { field: string; message: string }[] } | undefined)?.errors ?? [];
        setFields(Object.fromEntries(errs.map((x) => [x.field, x.message])));
      } else setError('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const primary = normalizeHex(draft.branding.primaryColor) ?? '#2e3d55';
  const accent = normalizeHex(draft.branding.accentColor) ?? '#9aa892';
  const pCheck = checkPrimary(draft.branding.primaryColor);
  const aCheck = checkAccent(draft.branding.accentColor, draft.branding.primaryColor);

  return (
    <form className="ws-showroom" onSubmit={save} noValidate>
      <div className="ws-head">
        <div>
          <span className="eyebrow">Showroom</span>
          <h1>How your showroom looks</h1>
          <p>Your name, logo and colours are on every page your customers see. Changes show on their next visit.</p>
        </div>
        <div className="ws-actions">
          <a className="btn" href={tenant.url} target="_blank" rel="noopener">
            Open the showroom
          </a>
        </div>
      </div>

      <div className="ws-showroom-grid">
        <div className="ws-showroom-main">
          <fieldset className="ws-card">
            <legend>Your brand</legend>
            <label className="field">
              <span>Company name</span>
              <input value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={80} required aria-invalid={!!fields.name} />
              {fields.name && <em className="ws-field-error">{fields.name}</em>}
            </label>
            <LogoField
              url={draft.branding.logoUrl}
              onUploaded={(fileId, url) => setB({ logoFileId: fileId, logoUrl: url })}
              onRemove={() => setB({ logoFileId: null, logoUrl: null })}
              error={fields['branding.logoFileId']}
            />
            <div className="ws-grid-2">
              <ColourField label="Main colour" hint="Buttons, the header and links" value={draft.branding.primaryColor} onChange={(v) => setB({ primaryColor: v })} check={pCheck} error={fields['branding.primaryColor']} />
              <ColourField label="Accent colour" hint="Highlights and chips" value={draft.branding.accentColor} onChange={(v) => setB({ accentColor: v })} check={aCheck} error={fields['branding.accentColor']} />
            </div>
          </fieldset>

          <fieldset className="ws-card">
            <legend>Welcome</legend>
            <label className="field">
              <span>Headline</span>
              <input value={draft.branding.welcomeTitle} onChange={(e) => setB({ welcomeTitle: e.target.value })} maxLength={90} placeholder={`Design your kitchen with ${draft.name || 'us'}`} />
            </label>
            <label className="field">
              <span>
                Welcome text <em>· a sentence or two</em>
              </span>
              <textarea value={draft.branding.welcomeText} onChange={(e) => setB({ welcomeText: e.target.value })} maxLength={600} rows={3} placeholder="Plan your new kitchen in 3D with our cabinets and fixtures, then send it to us for a free consultation." />
            </label>
            <FeaturedLines value={draft.branding.featuredLines} suggestions={lines} onChange={(v) => setB({ featuredLines: v })} error={fields['branding.featuredLines']} />
          </fieldset>

          <ShowroomPictures tenant={tenant} featured={base.branding.featuredLines} onChange={setTenant} />

          <fieldset className="ws-card">
            <legend>Contact details shown to visitors</legend>
            <div className="ws-grid-2">
              <label className="field">
                <span>Phone</span>
                <input value={draft.contact.phone} onChange={(e) => setC({ phone: e.target.value })} inputMode="tel" maxLength={40} aria-invalid={!!fields['contact.phone']} />
                {fields['contact.phone'] && <em className="ws-field-error">{fields['contact.phone']}</em>}
              </label>
              <label className="field">
                <span>Email</span>
                <input value={draft.contact.email} onChange={(e) => setC({ email: e.target.value })} inputMode="email" maxLength={254} aria-invalid={!!fields['contact.email']} />
                {fields['contact.email'] && <em className="ws-field-error">{fields['contact.email']}</em>}
              </label>
              <label className="field">
                <span>Your website</span>
                <input value={draft.contact.website} onChange={(e) => setC({ website: e.target.value })} inputMode="url" maxLength={200} placeholder="https://" aria-invalid={!!fields['contact.website']} />
                {fields['contact.website'] && <em className="ws-field-error">{fields['contact.website']}</em>}
              </label>
              <label className="field">
                <span>Opening hours</span>
                <input value={draft.contact.hours} onChange={(e) => setC({ hours: e.target.value })} maxLength={120} placeholder="Mon–Fri 9–5, Sat 10–4" />
              </label>
            </div>
            <label className="field">
              <span>Showroom address</span>
              <input value={draft.contact.address} onChange={(e) => setC({ address: e.target.value })} maxLength={200} />
            </label>
            <label className="field">
              <span>
                Service area <em>· where you take on work</em>
              </span>
              <input value={draft.contact.serviceArea} onChange={(e) => setC({ serviceArea: e.target.value })} maxLength={160} placeholder="Guelph, Kitchener-Waterloo and Wellington County" />
            </label>
            <p className="fine">Visitors see these on your showroom and when they send you a design. Leave any of them blank to hide it.</p>
          </fieldset>

          <SwitchesCard settings={draft.settings} owner={owner} onChange={setS} errors={fields} />

          <Addresses tenant={tenant} />
        </div>

        <aside className="ws-showroom-side" aria-label="Live preview">
          <Preview name={draft.name || tenant.name} logoUrl={draft.branding.logoUrl} primary={primary} accent={accent} title={draft.branding.welcomeTitle} text={draft.branding.welcomeText} lines={draft.branding.featuredLines} bathrooms={draft.settings.bathrooms} contact={draft.contact} />
        </aside>
      </div>

      {error && (
        <div className="ws-error" role="alert">
          {error}
        </div>
      )}
      <div className="ws-save">
        <span className="muted">{dirty ? 'You have unsaved changes.' : 'Everything is saved.'}</span>
        <button type="button" className="btn" disabled={!dirty || busy} onClick={() => (setDraft(base), setFields({}), setError(null))}>
          Undo changes
        </button>
        <button type="submit" className="btn primary" disabled={!dirty || busy}>
          {busy ? 'Saving…' : 'Save showroom'}
        </button>
      </div>
    </form>
  );
}

function LogoField({ url, onUploaded, onRemove, error }: { url: string | null; onUploaded: (fileId: string, url: string) => void; onRemove: () => void; error?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const { file: f } = await wsApi.uploadLogo(file);
      onUploaded(f.id, f.url);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'That image didn’t upload.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ws-logo">
      <span className="mini-label">Logo</span>
      <div className="ws-logo-row">
        <div className="ws-logo-box">{url ? <img src={url} alt="Your logo" /> : <span>No logo yet</span>}</div>
        <div className="ws-actions">
          <button type="button" className="btn" onClick={() => ref.current?.click()} disabled={busy}>
            {busy ? 'Uploading…' : url ? 'Replace logo' : 'Upload a logo'}
          </button>
          {url && (
            <button type="button" className="btn" onClick={onRemove} disabled={busy}>
              Remove
            </button>
          )}
        </div>
        <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => (e.target.files?.[0] && void pick(e.target.files[0]), (e.target.value = ''))} />
      </div>
      <p className="fine">A PNG with a transparent background looks best. It’s also printed on your customers’ downloads.</p>
      {(err || error) && <em className="ws-field-error">{err || error}</em>}
    </div>
  );
}

function ColourField({ label, hint, value, onChange, check, error }: { label: string; hint: string; value: string; onChange: (v: string) => void; check: { ok: boolean; message: string | null }; error?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const hex = normalizeHex(value) ?? '#000000';
  return (
    <div className="field ws-colour">
      <span>
        {label} <em>· {hint}</em>
      </span>
      <div className="ws-colour-row">
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: pick a colour`} />
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = normalizeHex(e.target.value);
            if (n) onChange(n);
          }}
          onBlur={() => setText(value)}
          aria-label={`${label} as a hex code`}
          maxLength={7}
          spellCheck={false}
          className="mono"
        />
      </div>
      {!check.ok && check.message && (
        <em className="ws-warn" role="status">
          {check.message}
        </em>
      )}
      {error && <em className="ws-field-error">{error}</em>}
    </div>
  );
}

function FeaturedLines({ value, suggestions, onChange, error }: { value: string[]; suggestions: string[]; onChange: (v: string[]) => void; error?: string }) {
  const [text, setText] = useState('');
  const add = (v: string) => {
    const s = v.trim().slice(0, 60);
    if (!s || value.includes(s) || value.length >= 12) return;
    onChange([...value, s]);
    setText('');
  };
  const left = suggestions.filter((s) => !value.includes(s));
  return (
    <div className="ws-lines">
      <span className="mini-label">Featured product lines</span>
      {value.length > 0 ? (
        <ul className="ws-line-list">
          {value.map((l, i) => (
            <li key={l}>
              <span>{l}</span>
              <button type="button" className="icon-btn" onClick={() => onChange(value.filter((x) => x !== l))} aria-label={`Remove ${l}`}>
                ×
              </button>
              {i > 0 && (
                <button type="button" className="icon-btn" onClick={() => onChange(value.map((x, j) => (j === i - 1 ? l : j === i ? value[i - 1] : x)))} aria-label={`Move ${l} up`}>
                  ↑
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="fine">None yet: your landing page shows your products without a featured list.</p>
      )}
      <div className="ws-line-add">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Lakeshore Shaker" maxLength={60} aria-label="A product line to feature" list="ws-line-suggest" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add(text))} />
        <datalist id="ws-line-suggest">
          {left.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        <button type="button" className="btn" onClick={() => add(text)} disabled={!text.trim() || value.length >= 12}>
          Add
        </button>
      </div>
      {left.length > 0 && value.length < 12 && (
        <div className="chips" role="group" aria-label="Your product lines">
          {left.slice(0, 8).map((l) => (
            <button type="button" key={l} className="chip" onClick={() => add(l)}>
              + {l}
            </button>
          ))}
        </div>
      )}
      {error && <em className="ws-field-error">{error}</em>}
    </div>
  );
}

function SwitchesCard({ settings, owner, onChange, errors }: { settings: ShowroomSettings; owner: boolean; onChange: (p: Partial<ShowroomSettings>) => void; errors: FieldErrors }) {
  return (
    <fieldset className="ws-card" disabled={!owner}>
      <legend>What visitors can do</legend>
      {!owner && <p className="fine">Only an owner of the showroom can change these.</p>}
      <label className="ws-switch">
        <input type="checkbox" checked={settings.fillGaps} onChange={(e) => onChange({ fillGaps: e.target.checked })} />
        <span>
          <b>Fill the gaps with BluModel Basics</b>
          <em>Plain appliances, sinks and fixtures for anything you don’t sell, so a kitchen never looks unfinished. They carry no store links.</em>
        </span>
      </label>
      <label className="ws-switch">
        <input type="checkbox" checked={settings.bathrooms} onChange={(e) => onChange({ bathrooms: e.target.checked })} />
        <span>
          <b>Bathrooms</b>
          <em>A “Design your bathroom” button beside “Design your kitchen”.</em>
        </span>
      </label>
      <label className="ws-switch">
        <input type="checkbox" checked={!!settings.visitorEstimate} onChange={(e) => onChange({ visitorEstimate: e.target.checked })} data-testid="visitor-estimate" />
        <span>
          <b>Show visitors an estimate</b>
          <em>Off by default. On: the designer shows your prices and a running total as they design. Your team always sees it.</em>
        </span>
      </label>
      <label className="ws-switch">
        <input type="checkbox" checked={settings.visitorRenders} onChange={(e) => onChange({ visitorRenders: e.target.checked, ...(e.target.checked && !settings.dailyRenderCap ? { dailyRenderCap: 5 } : {}) })} />
        <span>
          <b>Photoreal renders for visitors</b>
          <em>Off by default. Each render uses your render credits, so set a daily cap for the whole showroom.</em>
        </span>
      </label>
      {settings.visitorRenders && (
        <label className="field ws-cap">
          <span>Visitor renders a day, across the showroom</span>
          <input type="number" min={0} max={1000} step={1} inputMode="numeric" value={settings.dailyRenderCap} onChange={(e) => onChange({ dailyRenderCap: Math.max(0, Math.min(1000, Math.round(Number(e.target.value) || 0))) })} aria-invalid={!!errors['settings.dailyRenderCap']} />
          {errors['settings.dailyRenderCap'] && <em className="ws-field-error">{errors['settings.dailyRenderCap']}</em>}
        </label>
      )}
      <label className="field ws-cap">
        <span>Keep potential customers who never sent you a design</span>
        <select value={settings.leadRetentionMonths ?? 0} onChange={(e) => onChange({ leadRetentionMonths: Number(e.target.value) })} aria-invalid={!!errors['settings.leadRetentionMonths']}>
          <option value={0}>24 months after they were last active (default)</option>
          <option value={18}>18 months</option>
          <option value={12}>12 months</option>
          <option value={6}>6 months</option>
        </select>
        <em className="fine">
          Someone who gave their details but never sent a design, and whose status you never changed, is deleted with their designs this long after their last visit. People you’ve worked with are kept until you delete them.
        </em>
        {errors['settings.leadRetentionMonths'] && <em className="ws-field-error">{errors['settings.leadRetentionMonths']}</em>}
      </label>
    </fieldset>
  );
}

/** The showroom's web addresses, and how to connect the company's own domain (included). */
function Addresses({ tenant }: { tenant: StaffTenant }) {
  const own = tenant.hostnames.find((h) => h.kind === 'subdomain')?.hostname ?? new URL(tenant.url).hostname;
  const custom = tenant.hostnames.filter((h) => h.kind === 'custom');
  const [open, setOpen] = useState(custom.length === 0);
  return (
    <section className="ws-card" aria-labelledby="ws-addr-title">
      <h2 id="ws-addr-title">Web addresses</h2>
      <p>Your web address is included in your monthly plan. Share it, link to it from your own website, or print it on your business cards.</p>
      <ul className="ws-hosts">
        {(tenant.hostnames.length ? tenant.hostnames : [{ hostname: own, kind: 'subdomain', verified: true, primary: true, createdAt: 0 } as Hostname]).map((h) => (
          <li key={h.hostname}>
            <CopyLine text={`https://${h.hostname}`} />
            <span className="ws-host-tags">
              {h.primary && <span className="ws-pill accent">Main address</span>}
              {h.kind === 'custom' ? h.verified ? <span className="ws-pill ok">Connected</span> : <span className="ws-pill warn">Waiting to connect</span> : <span className="ws-pill">Included</span>}
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="btn ws-domain-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide' : 'Show'} how to connect your own domain
      </button>
      {open && (
        <ol className="ws-steps">
          <li>
            Choose the address, for example <code>showroom.yourcompany.ca</code> or <code>design.yourcompany.ca</code>. Keep your main website where it is.
          </li>
          <li>
            Where you manage your domain (GoDaddy, Namecheap, Cloudflare, your web designer…), add a <b>CNAME</b> record: name <code>showroom</code> (the first part of the address you chose), pointing to <code>{own}</code>.
          </li>
          <li>Email us the address you chose. We connect it and set up its security certificate, at no extra charge.</li>
          <li>It usually works within the hour. It shows here as <b>Connected</b>, and becomes your main address if you like. Your {own} address keeps working too.</li>
        </ol>
      )}
    </section>
  );
}

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ws-copy">
      <code>{text}</code>
      <button
        type="button"
        className="btn"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(
            () => (setCopied(true), setTimeout(() => setCopied(false), 1600)),
            () => {},
          );
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

/** A small likeness of the landing page in the company's colours, live as they type. */
function Preview({ name, logoUrl, primary, accent, title, text, lines, bathrooms, contact }: { name: string; logoUrl: string | null; primary: string; accent: string; title: string; text: string; lines: string[]; bathrooms: boolean; contact: Contact }) {
  const style = { '--brand': primary, '--brand-ink': textOn(primary), '--brand-accent': accent, '--brand-accent-ink': textOn(accent) } as CSSProperties;
  return (
    <div className="ws-preview-wrap">
      <span className="eyebrow">Live preview</span>
      <div className="ws-preview" style={style}>
        <div className="ws-preview-bar">
          {logoUrl ? <img src={logoUrl} alt="" /> : <b>{name}</b>}
          {contact.phone && <span>{contact.phone}</span>}
        </div>
        <div className="ws-preview-hero">
          <b className="ws-preview-title">{title || `Design your kitchen with ${name}`}</b>
          <p>{text || 'Plan your new kitchen in 3D with our products, then send it to us.'}</p>
          <div className="ws-preview-buttons">
            <span className="ws-preview-btn">Design your kitchen</span>
            {bathrooms && <span className="ws-preview-btn ghost">Design your bathroom</span>}
          </div>
        </div>
        {lines.length > 0 && (
          <div className="ws-preview-lines">
            {lines.slice(0, 4).map((l) => (
              <span key={l} className="ws-preview-chip">
                {l}
              </span>
            ))}
          </div>
        )}
        {contact.serviceArea && <div className="ws-preview-foot">Serving {contact.serviceArea}</div>}
      </div>
      <p className="fine">A sketch of your landing page, not the exact layout.</p>
    </div>
  );
}
