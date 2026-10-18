/**
 * Admin > Companies > Quick setup (docs/ONBOARDING_A_COMPANY.md "The quick path"): a company's own
 * showroom, live in a minute, during or right after a sales call. One short form and one button:
 * the server makes the company, its address, branding and (optionally) a starter catalog under
 * its own names in one transaction (server/routes/quickSetup.mjs); then this browser opens the
 * showroom-picture generator for it (the renders are made here, never on the server) and waits for
 * it; then the live link, the owner's invite and the next steps.
 */
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import { contrast, DARK_PAGE, LIGHT_PAGE } from '../showroom/palette';
import { showroomApi } from './showroomApi';
import type { AdminTenant, ImagesRun, InviteLink, SetupPurpose, SlugCheck, StarterCatalog } from './showroomTypes';
import { Notice, Pill, Section, dateTime, day, errorText } from './ui';
import './quick-setup.css';

const HEX = /^#[0-9a-f]{6}$/i;
const LOGO_MAX = 2 * 1024 * 1024;
const POLL_MS = 2000;

type Stage =
  | { name: 'form' }
  | { name: 'pictures'; tenant: AdminTenant; run: string | null; url: string | null; blocked: boolean; status: ImagesRun | null; error: string | null }
  | { name: 'done'; tenant: AdminTenant; pictures: ImagesRun | null; skipped: boolean };

/** The colours most of a logo is made of, most used first (transparent and near-white left out). */
export function logoColours(data: Uint8ClampedArray): string[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 200 || (r > 235 && g > 235 && b > 235)) continue;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const o = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    o.n++;
    o.r += r;
    o.g += g;
    o.b += b;
    buckets.set(key, o);
  }
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  const ranked = [...buckets.values()]
    .map((o) => {
      const [r, g, b] = [o.r / o.n, o.g / o.n, o.b / o.n];
      const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      return { r, g, b, w: o.n * (0.35 + sat) };
    })
    .sort((x, y) => y.w - x.w);
  const out: { r: number; g: number; b: number }[] = [];
  for (const c of ranked) {
    if (out.every((o) => Math.hypot(o.r - c.r, o.g - c.g, o.b - c.b) > 70)) out.push(c);
    if (out.length === 3) break;
  }
  // The darker of the two main ones first: the main colour is the fill behind white text.
  const lum = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const top = out.slice(0, 2).sort((a, b) => lum(a) - lum(b));
  return [...top, ...out.slice(2)].map((c) => `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`);
}

async function readLogo(file: File): Promise<{ dataUrl: string; colours: string[] }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPEG or WebP logo.');
  if (file.size > LOGO_MAX) throw new Error('The logo can be at most 2 MB.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('That file couldn’t be read.'));
    r.readAsDataURL(file);
  });
  let colours: string[] = [];
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const c = document.createElement('canvas');
    const k = 48 / Math.max(img.width, img.height, 1);
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    const g = c.getContext('2d', { willReadFrequently: true });
    g?.drawImage(img, 0, 0, c.width, c.height);
    if (g) colours = logoColours(g.getImageData(0, 0, c.width, c.height).data);
  } catch {
    colours = [];
  }
  return { dataUrl, colours };
}

const ratio = (a: string, b: string) => Math.round(contrast(a, b) * 10) / 10;

/** The live contrast check for the two colours, in plain words. */
function ContrastCheck({ primary, accent }: { primary: string; accent: string }) {
  if (!HEX.test(primary)) return null;
  const onWhite = ratio(primary, '#ffffff');
  const onLight = ratio(primary, LIGHT_PAGE.paper);
  const onDark = ratio(primary, DARK_PAGE.paper);
  const both = HEX.test(accent) ? ratio(primary, accent) : null;
  const pill = (v: number, need: number) => <Pill tone={v >= need ? 'ok' : 'warn'}>{`${v}:1`}</Pill>;
  return (
    <div className="qs-contrast" aria-live="polite">
      <span>White text on the main colour {pill(onWhite, 4.5)}</span>
      <span>As text on the page: light {pill(onLight, 4.5)} dark {pill(onDark, 4.5)}</span>
      {both !== null && <span>Main against second {pill(both, 1.5)}</span>}
      <span className="adm-note">
        {onWhite >= 4.5 && onLight >= 4.5 && onDark >= 4.5
          ? 'Readable everywhere as it is.'
          : 'Fine to keep: the showroom darkens or lightens it where text needs it (WCAG AA), so only buttons and links shift a shade.'}
        {both !== null && both < 1.5 ? ' The two colours are very close; a second colour that differs more reads better.' : ''}
      </span>
    </div>
  );
}

function ColourField({ label, value, onChange, id }: { label: string; value: string; onChange: (v: string) => void; id: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div className="adm-field qs-colour">
      <span id={`${id}-label`}>{label}</span>
      <div className="qs-colour-row">
        <input type="color" value={HEX.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} aria-labelledby={`${id}-label`} />
        <input
          value={text}
          onChange={(e) => {
            const v = e.target.value.trim();
            setText(v);
            if (HEX.test(v)) onChange(v.toLowerCase());
          }}
          aria-label={`${label} as a hex code`}
          aria-invalid={!HEX.test(text)}
          maxLength={7}
          spellCheck={false}
          className="mono"
        />
      </div>
    </div>
  );
}

function CopyRow({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="adm-inline adm-copy qs-copy">
      <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn"
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

const SLUG_WORDS: Record<NonNullable<SlugCheck['problem']>, string> = {
  invalid: 'Use lower-case letters, numbers and dashes (2 to 40), starting and ending with a letter or number.',
  reserved: 'That name is reserved.',
  taken: 'That address is taken.',
};

export default function QuickSetup({ base, onOpen, onCreated }: { base: string; onOpen: (id: string) => void; onCreated: () => void }) {
  const [stage, setStage] = useState<Stage>({ name: 'form' });
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [check, setCheck] = useState<SlugCheck | null>(null);
  const [logo, setLogo] = useState<{ dataUrl: string; colours: string[]; name: string } | null>(null);
  const [logoErr, setLogoErr] = useState<string | null>(null);
  const [primary, setPrimary] = useState('#1f4f8a');
  const [accent, setAccent] = useState('#e8a838');
  const [website, setWebsite] = useState('');
  const [area, setArea] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [catalog, setCatalog] = useState<StarterCatalog>('demo');
  const [purpose, setPurpose] = useState<SetupPurpose>('trial');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // The address: suggested from the name until it is typed, checked as it changes.
  useEffect(() => {
    if (stage.name !== 'form') return;
    const wanted = slugTouched ? slug.trim() : '';
    if (!name.trim() && !wanted) {
      setCheck(null);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      showroomApi
        .slugCheck(wanted, name.trim())
        .then((r) => {
          if (!live) return;
          setCheck(r);
          if (!slugTouched) setSlug(r.suggestion);
        })
        .catch(() => live && setCheck(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [name, slug, slugTouched, stage.name]);

  // Following the picture generator's run.
  const runKey = stage.name === 'pictures' ? `${stage.tenant.id}:${stage.run}` : '';
  useEffect(() => {
    if (stage.name !== 'pictures' || !stage.run) return;
    const { tenant, run } = stage;
    let live = true;
    const tick = async () => {
      try {
        const s = await showroomApi.imagesRun(tenant.id, run);
        if (!live) return;
        if (s.state === 'done') setStage({ name: 'done', tenant, pictures: s, skipped: false });
        else setStage((cur) => (cur.name === 'pictures' ? { ...cur, status: s, error: null } : cur));
      } catch (e) {
        if (live) setStage((cur) => (cur.name === 'pictures' ? { ...cur, error: errorText(e, 'Couldn’t check on the pictures.') } : cur));
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  const slugProblem = check && !check.available && check.problem ? SLUG_WORDS[check.problem] : null;
  const shownSlug = slug.trim() || check?.suggestion || '';

  const pickLogo = async (file: File | undefined) => {
    setLogoErr(null);
    if (!file) return;
    try {
      const l = await readLogo(file);
      setLogo({ ...l, name: file.name });
      if (l.colours[0]) setPrimary(l.colours[0]);
      if (l.colours[1]) setAccent(l.colours[1]);
    } catch (e) {
      setLogo(null);
      setLogoErr(e instanceof Error ? e.message : 'That logo couldn’t be used.');
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !name.trim() || slugProblem) return;
    setBusy(true);
    setErr(null);
    setFieldErr({});
    // Opened now, while the click still counts, so no pop-up blocker stops it; pointed at the generator below.
    const win = catalog === 'demo' ? window.open('about:blank', '_blank') : null;
    try {
      const out = await showroomApi.quickSetup({
        name: name.trim(),
        slug: slug.trim() || undefined,
        ...(logo ? { logo: logo.dataUrl } : {}),
        branding: { primaryColor: primary, accentColor: accent },
        contact: { website: website.trim(), serviceArea: area.trim(), phone: phone.trim(), email: email.trim() },
        catalog,
        purpose,
      });
      onCreated();
      if (catalog === 'empty') {
        win?.close();
        setStage({ name: 'done', tenant: out.tenant, pictures: null, skipped: true });
        return;
      }
      try {
        const link = await showroomApi.imagesLink(out.tenant.id, true);
        if (win && !win.closed) {
          win.opener = null;
          win.location.href = link.url;
        }
        setStage({ name: 'pictures', tenant: out.tenant, run: link.run, url: link.url, blocked: !win || win.closed, status: null, error: null });
      } catch (x) {
        win?.close();
        setStage({ name: 'pictures', tenant: out.tenant, run: null, url: null, blocked: false, status: null, error: errorText(x, 'Couldn’t open the picture maker.') });
      }
    } catch (x) {
      win?.close();
      const errors = x instanceof ApiError ? ((x.body as { errors?: { field: string; message: string }[] } | null)?.errors ?? []) : [];
      setFieldErr(Object.fromEntries(errors.map((f) => [f.field, f.message])));
      setErr(errorText(x, 'Could not set up the showroom.'));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStage({ name: 'form' });
    setName('');
    setSlug('');
    setSlugTouched(false);
    setCheck(null);
    setLogo(null);
    setWebsite('');
    setArea('');
    setPhone('');
    setEmail('');
    if (fileRef.current) fileRef.current.value = '';
  };

  if (stage.name === 'pictures') {
    const s = stage.status;
    return (
      <Section title="Quick setup" id="adm-quick-setup">
        <div className="qs-panel" role="status" aria-live="polite">
          <b>{stage.tenant.name} is set up.</b>
          <p className="adm-note">
            Now its showroom pictures (the main kitchen, one per product line and a small gallery) are being made from its own products in another tab of this browser. Keep that tab in front
            until it says Done: it takes a minute or two.
          </p>
          {stage.blocked && stage.url && (
            <Notice tone="warn">
              The browser blocked the new tab.{' '}
              <a className="adm-link" href={stage.url} target="_blank" rel="noopener noreferrer">
                Open the picture maker
              </a>
            </Notice>
          )}
          {stage.error && <Notice tone="warn">{stage.error}</Notice>}
          <p className="qs-progress">
            {!s || s.state === 'waiting' ? 'Waiting for the picture maker to open…' : `Making pictures… ${s.uploads} uploaded so far.`}
          </p>
          <div className="adm-actions">
            {stage.url && !stage.blocked && (
              <a className="btn" href={stage.url} target="_blank" rel="noopener noreferrer">
                Open the picture maker again
              </a>
            )}
            <button type="button" className="btn" onClick={() => setStage({ name: 'done', tenant: stage.tenant, pictures: s, skipped: true })}>
              Skip: show me the link
            </button>
          </div>
        </div>
      </Section>
    );
  }

  if (stage.name === 'done') return <SetupDone stage={stage} base={base} onOpen={onOpen} onAnother={reset} />;

  return (
    <Section title="Quick setup" id="adm-quick-setup">
      <form className="adm-form qs-form" onSubmit={(e) => void submit(e)} noValidate>
        <p className="adm-note">Their own showroom, live in a minute: during the call or right after it. The same steps are the real onboarding once they buy.</p>
        {err && <div className="auth-error">{err}</div>}
        <div className="adm-form-row">
          <label className="adm-field">
            <span>Company name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder="Acme Kitchens & Bath" autoComplete="organization" aria-invalid={!!fieldErr.name} />
          </label>
          <label className="adm-field">
            <span>Web address</span>
            <span className="qs-slug">
              <input
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'));
                }}
                maxLength={40}
                placeholder="acme"
                aria-invalid={!!slugProblem}
                aria-describedby="qs-slug-note"
                spellCheck={false}
              />
              <span className="qs-base mono">.{base}</span>
            </span>
          </label>
        </div>
        <p className="adm-note" id="qs-slug-note" aria-live="polite">
          {slugProblem ? (
            <>
              <b className="qs-bad">{slugProblem}</b>{' '}
              {check?.suggestion && check.suggestion !== slug && (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    setSlug(check.suggestion);
                    setSlugTouched(true);
                  }}
                >
                  Use {check.suggestion}
                </button>
              )}
            </>
          ) : shownSlug ? (
            <>
              <b className="mono">{`${shownSlug}.${base}`}</b> {check?.available ? 'is free.' : ''} Agree it on the call: links they share use it.
            </>
          ) : (
            'Suggested from the name as you type.'
          )}
        </p>

        <div className="qs-brand">
          <div className="adm-field qs-logo">
            <span id="qs-logo-label">Logo (optional)</span>
            <div className="qs-logo-row">
              {logo ? <img src={logo.dataUrl} alt="" className="qs-logo-img" /> : <span className="qs-logo-img qs-logo-empty" aria-hidden="true" />}
              <label className="btn qs-file">
                {logo ? 'Change logo' : 'Upload logo'}
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" aria-labelledby="qs-logo-label" onChange={(e) => void pickLogo(e.target.files?.[0])} />
              </label>
              {logo && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setLogo(null);
                    if (fileRef.current) fileRef.current.value = '';
                  }}
                >
                  Remove
                </button>
              )}
            </div>
            {logoErr && <span className="qs-bad" role="alert">{logoErr}</span>}
            {fieldErr.logo && <span className="qs-bad">{fieldErr.logo}</span>}
          </div>
          <div className="qs-colours">
            <ColourField id="qs-primary" label="Main colour" value={primary} onChange={setPrimary} />
            <ColourField id="qs-accent" label="Second colour" value={accent} onChange={setAccent} />
            <button
              type="button"
              className="btn small qs-swap"
              onClick={() => {
                setPrimary(accent);
                setAccent(primary);
              }}
            >
              Swap
            </button>
            {logo && logo.colours.length > 0 && (
              <div className="qs-picks" role="group" aria-label="Colours from the logo">
                <span className="adm-note">From the logo:</span>
                {logo.colours.map((c, i) => (
                  <button key={c} type="button" className="qs-pick" style={{ '--qs-swatch': c } as CSSProperties} aria-label={`Use ${c} as the ${i === 0 ? 'main' : 'second'} colour`} onClick={() => (i === 0 ? setPrimary(c) : setAccent(c))}>
                    <span className="qs-swatch" aria-hidden="true" />
                    <span className="mono">{c}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="qs-preview" style={{ '--qs-primary': HEX.test(primary) ? primary : undefined, '--qs-accent': HEX.test(accent) ? accent : undefined } as CSSProperties} aria-hidden="true">
            <span className="qs-preview-band" />
            <span className="qs-preview-line" />
          </div>
        </div>
        <ContrastCheck primary={primary} accent={accent} />
        {(fieldErr['branding.primaryColor'] || fieldErr['branding.accentColor']) && <span className="qs-bad">{fieldErr['branding.primaryColor'] || fieldErr['branding.accentColor']}</span>}

        <div className="adm-form-row">
          <label className="adm-field">
            <span>Their website (optional)</span>
            <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="acmekitchens.ca" inputMode="url" autoComplete="off" aria-invalid={!!fieldErr['contact.website']} />
          </label>
          <label className="adm-field">
            <span>City or service area</span>
            <input value={area} onChange={(e) => setArea(e.target.value)} maxLength={200} placeholder="Guelph and Wellington County" autoComplete="off" />
          </label>
        </div>
        <div className="adm-form-row">
          <label className="adm-field">
            <span>Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} placeholder="(519) 555-0142" inputMode="tel" autoComplete="off" aria-invalid={!!fieldErr['contact.phone']} />
          </label>
          <label className="adm-field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="hello@acmekitchens.ca" autoComplete="off" aria-invalid={!!fieldErr['contact.email']} />
          </label>
        </div>
        {['contact.website', 'contact.phone', 'contact.email'].map((f) => fieldErr[f] && <span key={f} className="qs-bad">{fieldErr[f]}</span>)}

        <fieldset className="qs-choice">
          <legend>Starter catalog</legend>
          <label className="adm-check">
            <input type="radio" name="qs-catalog" checked={catalog === 'demo'} onChange={() => setCatalog('demo')} />
            <span>
              <b>Demo range, renamed to theirs</b>
              <span>
                Northline’s cabinet lines, sinks, appliances, lighting and bath as their own: “{name.trim() ? `${shortStem(name)} Shaker` : 'Acme Shaker'}” and so on. The showroom’s pictures are made from it next.
              </span>
            </span>
          </label>
          <label className="adm-check">
            <input type="radio" name="qs-catalog" checked={catalog === 'empty'} onChange={() => setCatalog('empty')} />
            <span>
              <b>Empty, we’ll model theirs</b>
              <span>Visitors can design with BluModel Basics meanwhile.</span>
            </span>
          </label>
        </fieldset>
        <fieldset className="qs-choice">
          <legend>Purpose</legend>
          <label className="adm-check">
            <input type="radio" name="qs-purpose" checked={purpose === 'trial'} onChange={() => setPurpose('trial')} />
            <span>
              <b>Prospect trial</b>
              <span>Live now for 14 days, then “temporarily unavailable” until they buy. Never charges; nothing is deleted.</span>
            </span>
          </label>
          <label className="adm-check">
            <input type="radio" name="qs-purpose" checked={purpose === 'customer'} onChange={() => setPurpose('customer')} />
            <span>
              <b>Paying customer</b>
              <span>Starts in setup, as a new company does; launch it once the license and monthly plan are in.</span>
            </span>
          </label>
        </fieldset>
        <div>
          <button type="submit" className="btn primary qs-go" disabled={busy || !name.trim() || !!slugProblem}>
            {busy ? 'Setting it up…' : 'Set up the showroom'}
          </button>
        </div>
      </form>
    </Section>
  );
}

/** "Acme Kitchens & Bath Ltd." -> "Acme": a preview of the server's line names (server/tenancy/quickSetup.mjs lineStem). */
export function shortStem(name: string): string {
  const full = name.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
  let s = full;
  for (let i = 0; i < 6; i++) {
    const next = s
      .replace(/\s*(?:,?\s*(?:ltd|limited|inc|incorporated|corp|corporation|llc|co|company)\.?)$/i, '')
      .replace(/\s+(?:&|and|\+)?\s*(?:kitchens?|baths?|bathrooms?|cabinets?|cabinetry|designs?|renovations?|showrooms?|interiors?|millwork|studio)$/i, '')
      .replace(/[\s,&+-]+$/, '')
      .trim();
    if (next === s) break;
    s = next;
  }
  if (s.length < 2) s = full;
  return s.slice(0, 40).trim() || 'Showroom';
}

function SetupDone({ stage, base, onOpen, onAnother }: { stage: Extract<Stage, { name: 'done' }>; base: string; onOpen: (id: string) => void; onAnother: () => void }) {
  const t = stage.tenant;
  // https://<slug>.<base> in production; the server's own origin in dev and QA (http://<slug>.localhost:<port>).
  const url = t.url || `https://${t.slug}.${base}`;
  const [email, setEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [invite, setInvite] = useState<{ link: InviteLink; email: string; pending: boolean } | null>(null);

  const inviteOwner = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const out = await showroomApi.addMember(t.id, { email: email.trim(), name: ownerName.trim() || undefined, role: 'owner' });
      if (out.invite) setInvite({ link: out.invite, email: email.trim(), pending: !!out.pending });
      else if (out.pending) setMsg({ tone: 'ok', text: `${email.trim()} already has an account on the showroom. We emailed them an invitation; they become an owner once they accept it with their own password.` });
      else setMsg({ tone: 'ok', text: `${email.trim()} is an owner of the showroom.` });
      setEmail('');
      setOwnerName('');
    } catch (x) {
      setMsg({ tone: 'bad', text: errorText(x, 'Couldn’t invite them.') });
    } finally {
      setBusy(false);
    }
  };

  const p = stage.pictures;
  return (
    <Section title="Quick setup" id="adm-quick-setup">
      <div className="qs-panel qs-done" role="status">
        <div className="qs-done-head">
          <b>{t.name}’s showroom is {t.status === 'trial' ? 'live' : 'set up'}.</b>
          {t.status === 'trial' ? <Pill tone="info">{`Trial · ${t.trial?.daysLeft ?? 14} days left`}</Pill> : <Pill tone="info">Setting up</Pill>}
        </div>
        <p className="adm-note">
          {stage.pictures && !stage.skipped
            ? `${p?.made ?? 0} picture${p?.made === 1 ? '' : 's'} made${p?.failed ? `, ${p.failed} scene${p.failed === 1 ? '' : 's'} failed (make them again from the company’s page)` : ''}. `
            : stage.skipped && stage.pictures !== null
              ? 'The pictures keep going in the other tab; the showroom shows each one as it is uploaded. '
              : 'No catalog yet, so no pictures: make them from the company’s page once their products are in. '}
          {t.status === 'trial' && t.trial ? `The trial runs until ${day(t.trial.endsAt)}; nothing is charged.` : 'Visitors can open it while you set it up; launch it once the license and monthly plan are in.'}
        </p>
        <p className="qs-label">The live link</p>
        <CopyRow value={url} label="The showroom’s live link" />
        <div className="adm-actions">
          <a className="btn primary" href={url} target="_blank" rel="noopener noreferrer">
            Open the showroom
          </a>
          <button type="button" className="btn" onClick={() => onOpen(t.id)}>
            Open the company
          </button>
          <button type="button" className="btn" onClick={onAnother}>
            Set up another
          </button>
        </div>

        <form className="adm-form adm-subform" onSubmit={(e) => void inviteOwner(e)}>
          <b>Invite the owner</b>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {invite && (
            <div className="adm-callout">
              <b>Sign-in link for {invite.email}</b>
              <p className="adm-note">
                {invite.link.emailed ? 'It was emailed to them. ' : 'Email isn’t set up here, so send it yourself. '}
                It sets their password on the showroom and works until {dateTime(invite.link.expiresAt)}. It won’t be shown again.
              </p>
              <CopyRow value={invite.link.url} label="Sign-in link" />
            </div>
          )}
          <div className="adm-form-row">
            <label className="adm-field">
              <span>Owner’s email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@acmekitchens.ca" autoComplete="off" />
            </label>
            <label className="adm-field">
              <span>Owner’s name (optional)</span>
              <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} maxLength={80} autoComplete="off" />
            </label>
          </div>
          <div>
            <button type="submit" className="btn" disabled={busy || !email.trim()}>
              {busy ? 'Inviting…' : 'Invite the owner'}
            </button>
          </div>
        </form>

        <div className="adm-subform">
          <b>Next steps, when they buy</b>
          <ol className="qs-steps">
            <li>
              <b>Record the license</b>: the amount agreed, in the company’s <i>Yearly license</i>.
            </li>
            <li>
              <b>Send the $50 monthly link</b>: <i>Monthly plan</i> → Create checkout link (or make it complimentary).
            </li>
            <li>
              {t.status === 'trial' ? (
                <>
                  <b>Convert to a paying customer</b>: one button in the company’s <i>Trial</i>, once both are in. Everything they have is kept.
                </>
              ) : (
                <>
                  <b>Launch the showroom</b> from the company’s <i>Status</i>.
                </>
              )}
            </li>
          </ol>
          <button type="button" className="btn" onClick={() => onOpen(t.id)}>
            Go to {t.name}
          </button>
        </div>
      </div>
    </Section>
  );
}
