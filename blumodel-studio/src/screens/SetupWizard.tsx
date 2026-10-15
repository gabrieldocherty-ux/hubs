import { useEffect, useMemo, useState } from 'react';
import type { BrandCategory, BrandPrefs, Room } from '../types';
import { api, ApiError } from '../lib/api';
import { hrefFor, navigate } from '../lib/router';
import { TEMPLATES, type TemplateId } from '../data/templates';
import { composeNewKitchen } from '../data/compose';
import { DEFAULT_ROOM } from '../data/defaults';
import { prepareDocForSave } from '../lib/doc';
import { MiniPlan } from '../components/MiniPlan';
import { FeetInchesInput } from '../components/FeetInchesInput';
import { AccountMenu } from '../components/AccountMenu';
import { Check, Logo, Wordmark } from '../components/Icons';
import { feetInches } from '../lib/format';
import { CameraIcon } from '../features/generate/icons';
import { useCatalog, useCatalogVersion } from '../store/useCatalog';
import { brandsForCategory } from '../catalog/retail';
import { BRAND_CATEGORIES, brandKey, brandOptions, brandPrefsLabel, brandShare, cleanBrandPrefs, hasBrandPrefs, type BrandCount, type BrandOption } from '../lib/generate/brands';
import '../features/generate/generate.css';
import './setupWizard.css';

const STEPS = ['Basics', 'Room', 'Layout', 'Brands'] as const;
const BRAND_STEP = 3;
/** Brand chips shown per category before "Show all". */
const BRANDS_SHOWN = 6;

const SIZES: { label: string; room: Room }[] = [
  { label: 'Compact · 10′ × 10′', room: { widthIn: 120, lengthIn: 120, ceilingIn: 96 } },
  { label: 'Standard · 12′ × 14′', room: { widthIn: 168, lengthIn: 144, ceilingIn: 108 } },
  { label: 'Spacious · 16′8″ × 13′', room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 } },
  { label: 'Open plan · 20′ × 16′', room: { widthIn: 240, lengthIn: 192, ceilingIn: 120 } },
];

export function SetupWizard() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [room, setRoom] = useState<Room>(DEFAULT_ROOM);
  const [templateId, setTemplateId] = useState<TemplateId | null>('l-island');
  const [brands, setBrands] = useState<BrandPrefs>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retail = useRetailBrands();
  const catalogVersion = useCatalogVersion();

  const fits = (t: (typeof TEMPLATES)[number]) => room.widthIn >= t.minWidth && room.lengthIn >= t.minLength;
  const layoutOk = templateId === null || fits(TEMPLATES.find((t) => t.id === templateId)!);
  const kitchenName = name.trim() || 'My Kitchen';

  // New kitchens start plain: neutral finishes, no colour palette (those live in Room & finishes).
  const layoutPreviews = useMemo(() => TEMPLATES.map((t) => ({ t, doc: composeNewKitchen('', room, fits(t) ? t.id : null) })), [room]);
  // The chosen brands fill every slot one of them sells in that size (see brandPicker). The
  // catalog version is a dependency because the retail products register after the page opens.
  const brandPrefs = useMemo(() => cleanBrandPrefs(brands), [brands]);
  const preview = useMemo(
    () => composeNewKitchen(kitchenName, room, layoutOk ? templateId : null, brandPrefs),
    [kitchenName, room, templateId, layoutOk, brandPrefs, catalogVersion],
  );
  const share = useMemo(() => brandShare(preview, brandPrefs), [preview, brandPrefs]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.createProject(kitchenName, client.trim(), prepareDocForSave(preview));
      navigate({ name: 'kitchen', id: project.id }, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the kitchen. Try again.');
      setBusy(false);
    }
  };

  const canNext = step !== 2 || layoutOk;
  const toggleBrand = (cat: BrandCategory, name: string) =>
    setBrands((b) => {
      const list = b[cat] ?? [];
      const on = list.some((n) => brandKey(n) === brandKey(name));
      return { ...b, [cat]: on ? list.filter((n) => brandKey(n) !== brandKey(name)) : [...list, name] };
    });
  const anyBrand = (cat: BrandCategory) => setBrands((b) => ({ ...b, [cat]: [] }));

  return (
    <div className="wizard">
      <header className="home-bar">
        <a className="brand" href="#/">
          <Logo />
          <Wordmark />
        </a>
        <ol className="steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
              <button onClick={() => i < step && setStep(i)} disabled={i > step}>
                <span className="dot">{i < step ? <Check width={12} height={12} /> : i + 1}</span>
                {s}
              </button>
            </li>
          ))}
        </ol>
        <AccountMenu />
      </header>

      <main className="wizard-main">
        <section className="wizard-form">
          {step === 0 && (
            <>
              <h1>Let’s set up a new kitchen.</h1>
              <a className="gen-wiz-photo" href={hrefFor({ name: 'generate' })}>
                <span className="gen-wiz-photo-icon" aria-hidden>
                  <CameraIcon width={22} height={22} />
                </span>
                <span className="gen-wiz-photo-text">
                  <b>Start from a photo of my kitchen</b>
                  <span>Already have a kitchen? Add photos of it and BluModel Studio models the space for you to redesign.</span>
                </span>
                <span className="gen-wiz-photo-go" aria-hidden>
                  →
                </span>
              </a>
              <p className="wizard-sub">Or set it up step by step. Give it a name you’ll recognise on your projects page.</p>
              <label className="field">
                <span>Kitchen name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maple Street Remodel" autoFocus maxLength={120} />
              </label>
              <label className="field">
                <span>Who it’s for <em>· optional</em></span>
                <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client or household" maxLength={120} />
              </label>
            </>
          )}

          {step === 1 && (
            <>
              <h1>How big is the room?</h1>
              <p className="wizard-sub">Measure wall to wall. You can fine-tune this any time.</p>
              <div className="size-picks">
                {SIZES.map((s) => (
                  <button key={s.label} className={s.room.widthIn === room.widthIn && s.room.lengthIn === room.lengthIn ? 'chip on' : 'chip'} onClick={() => setRoom(s.room)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="dims">
                <FeetInchesInput label="Width (E–W)" valueIn={room.widthIn} min={72} max={480} onCommit={(v) => setRoom({ ...room, widthIn: v })} />
                <FeetInchesInput label="Length (N–S)" valueIn={room.lengthIn} min={72} max={480} onCommit={(v) => setRoom({ ...room, lengthIn: v })} />
                <FeetInchesInput label="Ceiling" valueIn={room.ceilingIn} min={90} max={144} onCommit={(v) => setRoom({ ...room, ceilingIn: v })} />
              </div>
              <p className="wizard-note mono">{Math.round((room.widthIn * room.lengthIn) / 144)} sq ft</p>
            </>
          )}

          {step === 2 && (
            <>
              <h1>Pick a starting layout.</h1>
              <p className="wizard-sub">Filled with real cabinet sizes for a {feetInches(room.widthIn)} × {feetInches(room.lengthIn)} room.</p>
              <div className="layout-picks">
                {layoutPreviews.map(({ t, doc }) => {
                  const ok = fits(t);
                  return (
                    <button key={t.id} className={templateId === t.id ? 'layout-pick on' : 'layout-pick'} disabled={!ok} onClick={() => setTemplateId(t.id)}>
                      <MiniPlan doc={doc} />
                      <b>{t.name}</b>
                      <span>{ok ? t.blurb : `Needs ${Math.ceil(t.minWidth / 12)}′ × ${Math.ceil(t.minLength / 12)}′`}</span>
                    </button>
                  );
                })}
                <button className={templateId === null ? 'layout-pick on' : 'layout-pick'} onClick={() => setTemplateId(null)}>
                  <MiniPlan doc={{ name: '', room, surfaces: preview.surfaces, items: [] }} />
                  <b>Blank room</b>
                  <span>Start from scratch and drag everything in.</span>
                </button>
              </div>
              <p className="wizard-note wiz-plain-note">Your kitchen starts in plain, neutral finishes. Pick a colour palette any time in <b>Room &amp; finishes</b>.</p>
            </>
          )}

          {step === BRAND_STEP && (
            <>
              <h1>Choose your brands.</h1>
              <p className="wizard-sub">
                Optional. Pick brands you like and we use their products wherever one fits your {templateId && layoutOk ? 'layout' : 'kitchen'}; BluModel Basics fill in the rest. Add products shows your brands first.
              </p>
              <BrandStep retail={retail} brands={brands} onToggle={toggleBrand} onAny={anyBrand} />
            </>
          )}

          {error && <div className="auth-error">{error}</div>}

          <div className="wizard-nav">
            {step > 0 ? (
              <button className="btn" onClick={() => setStep(step - 1)}>
                Back
              </button>
            ) : (
              <a className="btn" href="#/">
                Cancel
              </a>
            )}
            {step < STEPS.length - 1 ? (
              <button className="btn primary" onClick={() => setStep(step + 1)} disabled={!canNext}>
                Continue
              </button>
            ) : (
              <button className="btn primary" onClick={create} disabled={busy}>
                {busy ? 'Creating…' : 'Create kitchen'}
              </button>
            )}
          </div>
        </section>

        <aside className="wizard-preview" aria-label="Preview">
          <div className="wizard-card">
            <MiniPlan doc={preview} />
            <div className="wizard-card-meta">
              <b>{kitchenName}</b>
              <span>
                {client.trim() ? `${client.trim()} · ` : ''}
                {feetInches(room.widthIn)} × {feetInches(room.lengthIn)} · {preview.items.length} pieces
              </span>
              <span className="muted">Plain finishes · palettes in Room &amp; finishes</span>
              {step === BRAND_STEP && (
                <span className="wiz-brand-share" data-testid="wiz-brand-share">
                  {brandPrefsLabel(brandPrefs)}
                  {hasBrandPrefs(brandPrefs) && share.inCategories > 0 ? ` · ${share.fromBrands} of ${share.inCategories} pieces from your brands` : ''}
                </span>
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

/**
 * The retail catalog's brand counts per wizard category (`brandsForCategory`, which loads the
 * retail chunk and registers its products so the layout can place them). Null while loading.
 * Also asks for the server catalog, so partner brands are offered too.
 */
function useRetailBrands(): Partial<Record<BrandCategory, BrandCount[]>> | null {
  const [retail, setRetail] = useState<Partial<Record<BrandCategory, BrandCount[]>> | null>(null);
  useEffect(() => {
    let alive = true;
    void useCatalog.getState().load();
    Promise.all(BRAND_CATEGORIES.map((c) => brandsForCategory(c.id).then((list) => [c.id, list] as const)))
      .then((rows) => alive && setRetail(Object.fromEntries(rows)))
      .catch(() => alive && setRetail({}));
    return () => {
      alive = false;
    };
  }, []);
  return retail;
}

/** "RONA, Home Depot +2" */
function storesLabel(names: string[]): string {
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
}

function BrandStep({
  retail,
  brands,
  onToggle,
  onAny,
}: {
  retail: Partial<Record<BrandCategory, BrandCount[]>> | null;
  brands: BrandPrefs;
  onToggle: (cat: BrandCategory, name: string) => void;
  onAny: (cat: BrandCategory) => void;
}) {
  const products = useCatalog((s) => s.products);
  const options = useMemo(() => brandOptions(products, retail ?? {}), [products, retail]);
  const [open, setOpen] = useState<Partial<Record<BrandCategory, boolean>>>({});
  return (
    <div className="wiz-brands" aria-busy={retail === null}>
      {BRAND_CATEGORIES.map((c) => {
        const chosen = new Set((brands[c.id] ?? []).map(brandKey));
        const list = options[c.id];
        // A chosen brand stays visible when the list is folded.
        const shown = open[c.id] ? list : list.filter((o, i) => i < BRANDS_SHOWN || chosen.has(o.key));
        return (
          <fieldset key={c.id} className="wiz-brand-cat" data-cat={c.id}>
            <legend>
              <b>{c.label}</b>
              <span>{c.blurb}</span>
            </legend>
            <div className="wiz-brand-picks">
              <button type="button" className={chosen.size === 0 ? 'wiz-brand on' : 'wiz-brand'} aria-pressed={chosen.size === 0} onClick={() => onAny(c.id)}>
                <b>Any</b>
                <span>No preference</span>
              </button>
              {shown.map((o) => (
                <BrandChip key={o.key} option={o} on={chosen.has(o.key)} onClick={() => onToggle(c.id, o.brand)} />
              ))}
              {retail === null && <span className="wiz-brand-loading">Loading brands…</span>}
            </div>
            {list.length > BRANDS_SHOWN && (
              <button type="button" className="wiz-brand-more" aria-expanded={!!open[c.id]} onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}>
                {open[c.id] ? 'Show fewer' : `Show all ${list.length} brands`}
              </button>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

function BrandChip({ option, on, onClick }: { option: BrandOption; on: boolean; onClick: () => void }) {
  const count = `${option.products} product${option.products === 1 ? '' : 's'}`;
  const stores = storesLabel(option.stores);
  const title = option.stores.length ? `${option.brand}: ${count}, at ${option.stores.join(', ')}` : `${option.brand}: ${count}`;
  return (
    <button type="button" className={on ? 'wiz-brand on' : 'wiz-brand'} aria-pressed={on} onClick={onClick} title={title}>
      <b>{option.brand}</b>
      <span>
        {count}
        {stores ? ` · ${stores}` : ''}
      </span>
    </button>
  );
}
