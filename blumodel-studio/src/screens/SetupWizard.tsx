import { useEffect, useMemo, useState } from 'react';
import type { BrandCategory, BrandPrefs, Room } from '../types';
import { api, ApiError } from '../lib/api';
import { navigate, useHashQuery } from '../lib/router';
import { TEMPLATES, type TemplateId } from '../data/templates';
import { composeNewKitchen } from '../data/compose';
import { DEFAULT_ROOM } from '../data/defaults';
import { prepareDocForSave } from '../lib/doc';
import { MiniPlan } from '../components/MiniPlan';
import { FeetInchesInput } from '../components/FeetInchesInput';
import { AccountMenu } from '../components/AccountMenu';
import { Check } from '../components/Icons';
import { feetInches } from '../lib/format';
import { useCatalog, useCatalogVersion } from '../store/useCatalog';
import { brandsForCategory } from '../catalog/retail';
import { BRAND_CATEGORIES, brandKey, brandOptions, brandPrefsLabel, brandShare, cleanBrandPrefs, hasBrandPrefs, type BrandCount, type BrandOption } from '../lib/generate/brands';
import { keepShowroomItems, lineFromQuery, linesIn, roomFromQuery, shortName, showroomLines, showroomPrefs, SiteMark, useShowroom, type PublicTenant, type ShowroomLine } from '../features/showroom';
import './setupWizard.css';

const STEPS = ['Basics', 'Room', 'Layout', 'Brands'] as const;
/** On a showroom the last step is the company's own product lines; a bathroom has no layout step (it starts as a blank room). */
const SHOWROOM_STEPS = ['Basics', 'Room', 'Layout', 'Our lines'] as const;
const BATHROOM_STEPS = ['Basics', 'Room', 'Our lines'] as const;
/** Brand chips shown per category before "Show all". */
const BRANDS_SHOWN = 6;

const SIZES: { label: string; room: Room }[] = [
  { label: 'Compact · 10′ × 10′', room: { widthIn: 120, lengthIn: 120, ceilingIn: 96 } },
  { label: 'Standard · 12′ × 14′', room: { widthIn: 168, lengthIn: 144, ceilingIn: 108 } },
  { label: 'Spacious · 16′8″ × 13′', room: { widthIn: 200, lengthIn: 156, ceilingIn: 108 } },
  { label: 'Open plan · 20′ × 16′', room: { widthIn: 240, lengthIn: 192, ceilingIn: 120 } },
];

const BATH_SIZES: { label: string; room: Room }[] = [
  { label: 'Powder room · 5′ × 6′', room: { widthIn: 60, lengthIn: 72, ceilingIn: 96 } },
  { label: 'Main bath · 5′ × 8′', room: { widthIn: 60, lengthIn: 96, ceilingIn: 96 } },
  { label: 'Ensuite · 8′ × 10′', room: { widthIn: 96, lengthIn: 120, ceilingIn: 96 } },
  { label: 'Primary bath · 10′ × 12′', room: { widthIn: 120, lengthIn: 144, ceilingIn: 108 } },
];

/** The wizard's starting line choices on a showroom: `?line=` picks that line in each category it sells in. */
function initialLines(lines: ShowroomLine[], raw: string | null): BrandPrefs {
  const line = lineFromQuery(lines, raw);
  if (!line) return {};
  const out: BrandPrefs = {};
  for (const c of line.categories) out[c] = [line.name];
  return out;
}

export function SetupWizard() {
  // On a company's showroom: its mark, its product lines in place of brands, and a bathroom when
  // the company offers them (`#/new?room=bathroom`); `?line=` starts on one of its lines.
  const showroom = useShowroom();
  const query = useHashQuery();
  const bathroom = !!showroom?.features.bathrooms && roomFromQuery(query) === 'bathroom';
  const steps: readonly string[] = bathroom ? BATHROOM_STEPS : showroom ? SHOWROOM_STEPS : STEPS;
  const BRAND_STEP = steps.length - 1;
  const LAYOUT_STEP = bathroom ? -1 : 2;
  const products = useCatalog((s) => s.products);
  const lines = useMemo(() => (showroom ? showroomLines(products) : []), [showroom, products]);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [room, setRoom] = useState<Room>(bathroom ? BATH_SIZES[1].room : DEFAULT_ROOM);
  const [templateId, setTemplateId] = useState<TemplateId | null>(bathroom ? null : 'l-island');
  const [brands, setBrands] = useState<BrandPrefs>({});
  // `?line=` once the company's products have arrived (the catalog loads in the background).
  const lineParam = query.get('line');
  const [lineApplied, setLineApplied] = useState(false);
  useEffect(() => {
    if (lineApplied || !lineParam || !lines.length) return;
    setBrands(initialLines(lines, lineParam));
    setLineApplied(true);
  }, [lines, lineParam, lineApplied]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retail = useRetailBrands(!showroom);
  const catalogVersion = useCatalogVersion();

  const fits = (t: (typeof TEMPLATES)[number]) => room.widthIn >= t.minWidth && room.lengthIn >= t.minLength;
  const layoutOk = templateId === null || fits(TEMPLATES.find((t) => t.id === templateId)!);
  const kitchenName = name.trim() || (bathroom ? 'My Bathroom' : 'My Kitchen');
  const roomWord = bathroom ? 'bathroom' : 'kitchen';

  // New kitchens start plain: neutral finishes, no colour palette (those live in Room & finishes).
  const layoutPreviews = useMemo(() => TEMPLATES.map((t) => ({ t, doc: composeNewKitchen('', room, fits(t) ? t.id : null) })), [room]);
  // The chosen brands fill every slot one of them sells in that size (see brandPicker). The
  // catalog version is a dependency because the retail products register after the page opens.
  // On a showroom a category with no choice means every line the company sells there, so a new
  // design is the company's products wherever one fits (showroomPrefs).
  const brandPrefs = useMemo(() => (showroom ? showroomPrefs(brands, lines) : cleanBrandPrefs(brands)), [brands, showroom, lines]);
  // Without "fill the gaps" a showroom design holds only the company's own products.
  const fillGaps = !showroom || showroom.features.fillGaps;
  const preview = useMemo(
    () => keepShowroomItems(composeNewKitchen(kitchenName, room, layoutOk ? templateId : null, brandPrefs), fillGaps),
    [kitchenName, room, templateId, layoutOk, brandPrefs, catalogVersion, fillGaps],
  );
  const share = useMemo(() => brandShare(preview, brandPrefs), [preview, brandPrefs]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.createProject(kitchenName, client.trim(), prepareDocForSave(preview));
      navigate({ name: 'kitchen', id: project.id }, true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not create the ${roomWord}. Try again.`);
      setBusy(false);
    }
  };

  // Each step opens at its top: Continue sits at the bottom of a long step (the brands, or a
  // phone's stacked layouts), and the next step would otherwise open scrolled past its heading.
  useEffect(() => {
    document.querySelector('.wizard')?.scrollIntoView({ block: 'start' });
  }, [step]);

  const canNext = step !== LAYOUT_STEP || layoutOk;
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
          <SiteMark compact={!!showroom} />
        </a>
        <ol className="steps" aria-label="Setup steps">
          {steps.map((s, i) => (
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
              <h1>{showroom ? `Let’s design your ${roomWord}.` : 'Let’s set up a new kitchen.'}</h1>
              <p className="wizard-sub">
                {showroom
                  ? `A few quick steps: a name, the room${bathroom ? '' : ', a starting layout'} and ${shortName(showroom)}’s product lines. You can change everything afterwards.`
                  : 'Set it up step by step. Give it a name you’ll recognise on your projects page.'}
              </p>
              <label className="field">
                <span>{bathroom ? 'Bathroom name' : 'Kitchen name'}</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={bathroom ? 'e.g. Main floor bathroom' : 'e.g. Maple Street Remodel'} autoFocus maxLength={120} />
              </label>
              {!showroom && (
                <label className="field">
                  <span>Who it’s for <em>· optional</em></span>
                  <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client or household" maxLength={120} />
                </label>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <h1>How big is the room?</h1>
              <p className="wizard-sub">Measure wall to wall. You can fine-tune this any time.</p>
              <div className="size-picks">
                {(bathroom ? BATH_SIZES : SIZES).map((s) => (
                  <button key={s.label} className={s.room.widthIn === room.widthIn && s.room.lengthIn === room.lengthIn ? 'chip on' : 'chip'} onClick={() => setRoom(s.room)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="dims">
                <FeetInchesInput label="Width (E–W)" valueIn={room.widthIn} min={bathroom ? 48 : 72} max={480} onCommit={(v) => setRoom({ ...room, widthIn: v })} />
                <FeetInchesInput label="Length (N–S)" valueIn={room.lengthIn} min={bathroom ? 48 : 72} max={480} onCommit={(v) => setRoom({ ...room, lengthIn: v })} />
                <FeetInchesInput label="Ceiling" valueIn={room.ceilingIn} min={90} max={144} onCommit={(v) => setRoom({ ...room, ceilingIn: v })} />
              </div>
              <p className="wizard-note mono">{Math.round((room.widthIn * room.lengthIn) / 144)} sq ft</p>
            </>
          )}

          {step === LAYOUT_STEP && (
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

          {step === BRAND_STEP && showroom && (
            <>
              <h1>Choose from our lines.</h1>
              <p className="wizard-sub">
                Optional. Your {roomWord} starts with {shortName(showroom)}’s products wherever one fits; pick a line to use only that one.
                {showroom.features.fillGaps ? ' Standard pieces fill any gap.' : ''} You can swap anything in the designer.
              </p>
              <LineStep tenant={showroom} lines={lines} brands={brands} onToggle={toggleBrand} onAny={anyBrand} />
            </>
          )}

          {step === BRAND_STEP && !showroom && (
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
            {step < steps.length - 1 ? (
              <button className="btn primary" onClick={() => setStep(step + 1)} disabled={!canNext}>
                Continue
              </button>
            ) : (
              <button className="btn primary" onClick={create} disabled={busy}>
                {busy ? 'Creating…' : bathroom ? 'Create bathroom' : 'Create kitchen'}
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
              {step === BRAND_STEP && showroom && (
                <span className="wiz-brand-share" data-testid="wiz-brand-share">
                  {lineSummary(brands, showroom)}
                </span>
              )}
              {step === BRAND_STEP && !showroom && (
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
function useRetailBrands(withRetail = true): Partial<Record<BrandCategory, BrandCount[]>> | null {
  const [retail, setRetail] = useState<Partial<Record<BrandCategory, BrandCount[]>> | null>(null);
  useEffect(() => {
    let alive = true;
    void useCatalog.getState().load();
    // A showroom never loads the retail catalog: its visitors design with the company's products.
    if (!withRetail) return;
    Promise.all(BRAND_CATEGORIES.map((c) => brandsForCategory(c.id).then((list) => [c.id, list] as const)))
      .then((rows) => alive && setRetail(Object.fromEntries(rows)))
      .catch(() => alive && setRetail({}));
    return () => {
      alive = false;
    };
  }, [withRetail]);
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

/** "All of Northline's lines" / "Lakeshore Shaker" / "3 chosen lines": the wizard card's summary on a showroom. */
function lineSummary(chosen: BrandPrefs, t: PublicTenant): string {
  const names = [...new Set(BRAND_CATEGORIES.flatMap((c) => chosen[c.id] ?? []))];
  if (!names.length) return `All of ${shortName(t)}’s lines`;
  return names.length <= 2 ? names.join(' & ') : `${names.length} chosen lines`;
}

/** The brand step on a showroom: per category, "All our lines" or one or more of the company's lines. */
function LineStep({
  tenant,
  lines,
  brands,
  onToggle,
  onAny,
}: {
  tenant: PublicTenant;
  lines: ShowroomLine[];
  brands: BrandPrefs;
  onToggle: (cat: BrandCategory, name: string) => void;
  onAny: (cat: BrandCategory) => void;
}) {
  const loading = useCatalog((s) => s.status !== 'ready' && s.status !== 'error');
  const cats = BRAND_CATEGORIES.filter((c) => linesIn(lines, c.id).length > 0);
  if (!cats.length)
    return <p className="wizard-note">{loading ? 'Loading our lines…' : `${shortName(tenant)}’s products are on their way. Create your design now and add them in the designer.`}</p>;
  return (
    <div className="wiz-brands">
      {cats.map((c) => {
        const chosen = new Set((brands[c.id] ?? []).map(brandKey));
        const list = linesIn(lines, c.id);
        return (
          <fieldset key={c.id} className="wiz-brand-cat" data-cat={c.id}>
            <legend>
              <b>{c.label}</b>
              <span>{c.blurb}</span>
            </legend>
            <div className="wiz-brand-picks">
              <button type="button" className={chosen.size === 0 ? 'wiz-brand on' : 'wiz-brand'} aria-pressed={chosen.size === 0} onClick={() => onAny(c.id)}>
                <b>All our lines</b>
                <span>{list.length === 1 ? list[0].name : `${list.length} lines`}</span>
              </button>
              {list.length > 1 &&
                list.map((l) => {
                  const n = l.products.filter((p) => p.category === c.id).length;
                  return (
                    <button key={l.key} type="button" className={chosen.has(l.key) ? 'wiz-brand on' : 'wiz-brand'} aria-pressed={chosen.has(l.key)} onClick={() => onToggle(c.id, l.name)}>
                      <b>{l.name}</b>
                      <span>
                        {n} product{n === 1 ? '' : 's'}
                      </span>
                    </button>
                  );
                })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
