import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ProductArt } from '../../components/ProductArt';
import { DEFAULT_SURFACES } from '../../data/defaults';
import { CATEGORIES } from '../../data/catalog';
import { PRODUCT_TYPES, type ProductType } from '../../data/productTypes';
import { ApiError } from '../../lib/api';
import { money } from '../../lib/format';
import { hrefFor, navigateHash } from '../../lib/router';
import { useCatalog } from '../../store/useCatalog';
import { useDesignStore } from '../../store/useDesignStore';
import type { DoorStyle, MaterialKind, Product } from '../../types';
import type { GlbMeta, ProductSpecInput } from '../../types/platform';
import { wsApi, type PriceRow } from './api';
import { useWorkspace } from './context';
import { markupFor, parseDollars, toCents, workedPrices } from './pricing';

const COMMON_WIDTHS = [9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48];
const CABINET_KINDS = new Set(['base', 'corner', 'wall', 'tall', 'island']);
const MATERIALS: MaterialKind[] = ['paint', 'wood', 'metal', 'stone', 'glass', 'ceramic', 'fabric', 'leather'];
const DOOR_STYLES: DoorStyle[] = ['shaker', 'slab', 'fluted'];
const back = hrefFor({ name: 'studio', rest: 'products' });

interface FinishDraft {
  id: string;
  name: string;
  hex: string;
  material: MaterialKind;
}

const slugId = (s: string, i: number) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 36) || `finish-${i + 1}`;

function typeOf(p: Product): ProductType | undefined {
  return PRODUCT_TYPES.find((t) => t.kind === p.kind && (t.variant ?? null) === (p.variant ?? null)) ?? PRODUCT_TYPES.find((t) => t.kind === p.kind);
}

type PriceMode = 'direct' | 'cost';

/**
 * `#/studio/products/new` (quick add: drawn from its size, door style and finishes, no 3D model
 * needed) and `#/studio/products/<id>` (edit any of the showroom's products, including the ones we
 * modelled). The price visitors see is set directly or worked out from the team's private cost and
 * a markup.
 */
export default function ProductForm({ id }: { id: string | null }) {
  const { tenant } = useWorkspace();
  const toast = useDesignStore((s) => s.toast);
  const [loaded, setLoaded] = useState<Product | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [defaultMarkup, setDefaultMarkup] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ field: string; message: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const [typeId, setTypeId] = useState('base-cabinet');
  const type = PRODUCT_TYPES.find((t) => t.id === typeId)!;
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [line, setLine] = useState('');
  const [doorStyle, setDoorStyle] = useState<DoorStyle | ''>('shaker');
  const [widths, setWidths] = useState<number[]>([24]);
  const [defaultWidth, setDefaultWidth] = useState(24);
  const [depth, setDepth] = useState('24');
  const [height, setHeight] = useState('34.5');
  const [elevation, setElevation] = useState('0');
  const [useKitchenColours, setUseKitchenColours] = useState(false);
  const [finishes, setFinishes] = useState<FinishDraft[]>([{ id: 'white', name: 'White', hex: '#f3f1ec', material: 'paint' }]);
  const [images, setImages] = useState<{ id: string; url: string }[]>([]);
  const [modelMeta, setModelMeta] = useState<{ fileId: string; bboxIn?: { w: number; h: number; d: number }; triangles?: number; warnings?: string[] } | null>(null);
  const [mode, setMode] = useState<PriceMode>('direct');
  const [price, setPrice] = useState('');
  const [priceBy, setPriceBy] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [markup, setMarkup] = useState('');
  const [uploading, setUploading] = useState<'image' | 'model' | null>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);

  const isCabinet = CABINET_KINDS.has(type.kind);

  const applyType = (t: ProductType) => {
    setTypeId(t.id);
    setWidths([t.defaults.widthIn]);
    setDefaultWidth(t.defaults.widthIn);
    setDepth(String(t.defaults.depthIn));
    setHeight(String(t.defaults.heightIn));
    setElevation(String(t.defaults.elevationIn));
    setUseKitchenColours(false);
  };

  useEffect(() => {
    let live = true;
    Promise.all([wsApi.products(), wsApi.pricing()])
      .then(([r, pr]) => {
        if (!live) return;
        setDefaultMarkup(pr.defaultMarkupPct);
        setLines([...new Set(r.products.map((p) => p.line).filter((l): l is string => !!l))].sort());
        if (!id) return;
        const p = r.products.find((x) => x.id === id);
        if (!p) return setError('That product isn’t in your catalog.');
        setLoaded(p);
        const t = typeOf(p);
        if (t) setTypeId(t.id);
        setName(p.name);
        setSku(p.sku ?? '');
        setLine(p.line ?? '');
        setDoorStyle(p.doorStyle ?? '');
        setWidths(p.widthOptions?.length ? p.widthOptions : [p.widthIn]);
        setDefaultWidth(p.widthIn);
        setDepth(String(p.depthIn));
        setHeight(String(p.heightIn));
        setElevation(String(p.elevationIn));
        setUseKitchenColours(p.finishes === 'cabinet');
        if (Array.isArray(p.finishes)) setFinishes(p.finishes.map((f) => ({ id: f.id, name: f.name, hex: f.hex, material: f.material })));
        setImages((p.imageFileIds ?? []).map((fid, i) => ({ id: fid, url: p.images?.[i]?.url ?? '' })));
        if (p.model?.fileId) setModelMeta({ fileId: p.model.fileId, bboxIn: p.model.bboxIn, triangles: p.model.triangles });
        setPrice(p.price ? String(p.price) : '');
        setPriceBy(Object.fromEntries(Object.entries(p.priceByWidth ?? {}).map(([w, v]) => [w, String(v)])));
        const row = pr.rows[p.id];
        if (row) {
          const c: Record<string, string> = {};
          if (row.costCents !== null) c.all = String(row.costCents / 100);
          for (const [w, v] of Object.entries(row.costByWidth ?? {})) c[w] = String(v / 100);
          setCosts(c);
          setMarkup(row.markupPct !== null ? String(row.markupPct) : '');
          setMode('cost');
        }
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load your catalog.'));
    return () => {
      live = false;
    };
  }, [id]);

  const sortedWidths = [...widths].sort((a, b) => a - b);
  const multi = sortedWidths.length > 1;

  const toggleWidth = (w: number) => {
    setWidths((cur) => {
      const next = cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w];
      if (!next.length) return cur;
      if (!next.includes(defaultWidth)) setDefaultWidth([...next].sort((a, b) => a - b)[0]);
      return next;
    });
  };
  const [customWidth, setCustomWidth] = useState('');
  const addCustomWidth = () => {
    const w = Number(customWidth);
    if (Number.isFinite(w) && w >= 1 && w <= 240 && !widths.includes(w)) setWidths([...widths, Math.round(w * 100) / 100]);
    setCustomWidth('');
  };

  const pickImage = async (file: File) => {
    setUploading('image');
    try {
      const { file: f } = await wsApi.uploadImage(file);
      setImages((cur) => [...cur, { id: f.id, url: f.url }].slice(0, 12));
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That image didn’t upload.', 'warn');
    } finally {
      setUploading(null);
    }
  };
  const pickModel = async (file: File) => {
    setUploading('model');
    try {
      const { file: f } = await wsApi.uploadModel(file);
      const meta = f.meta as GlbMeta;
      setModelMeta({ fileId: f.id, bboxIn: meta.bboxIn, triangles: meta.triangles, warnings: meta.warnings });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That model didn’t upload.', 'warn');
    } finally {
      setUploading(null);
    }
  };

  /** The private cost row from the form, or null when a value isn't a number. */
  const costRow = (): PriceRow | null => {
    const single = parseDollars(costs.all ?? '');
    if (Number.isNaN(single)) return null;
    const byWidth: Record<string, number> = {};
    if (multi) {
      for (const w of sortedWidths) {
        const v = parseDollars(costs[String(w)] ?? '');
        if (Number.isNaN(v)) return null;
        if (v !== null) byWidth[String(w)] = toCents(v);
      }
    }
    const m = markup.trim() === '' ? null : Number(markup);
    if (m !== null && (!Number.isFinite(m) || m < 0 || m > 1000)) return null;
    return { costCents: single === null ? null : toCents(single), costByWidth: Object.keys(byWidth).length ? byWidth : null, markupPct: m };
  };

  /** The prices visitors will see, from whichever way the team entered them. */
  const prices = useMemo((): { price: number; priceByWidth: Record<string, number> | null } | 'invalid' | null => {
    if (mode === 'cost') {
      const row = costRow();
      if (!row) return 'invalid';
      return workedPrices(row, defaultMarkup, sortedWidths, defaultWidth);
    }
    const p = parseDollars(price);
    if (Number.isNaN(p)) return 'invalid';
    const by: Record<string, number> = {};
    if (multi) {
      for (const w of sortedWidths) {
        const v = parseDollars(priceBy[String(w)] ?? '');
        if (Number.isNaN(v)) return 'invalid';
        if (v !== null) by[String(w)] = v;
      }
    }
    const placed = by[String(defaultWidth)] ?? p;
    if (placed === null) return Object.keys(by).length ? { price: Object.values(by)[0], priceByWidth: by } : null;
    return { price: placed, priceByWidth: Object.keys(by).length ? by : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, price, priceBy, costs, markup, defaultMarkup, sortedWidths.join(','), defaultWidth, multi]);

  const draft: Product = useMemo(
    () => ({
      id: id ?? 'draft',
      kind: type.kind,
      ...(type.variant ? { variant: type.variant } : {}),
      category: type.category,
      brand: tenant.name,
      name: name || type.label,
      code: sku,
      sku,
      widthIn: defaultWidth,
      depthIn: Number(depth) || type.defaults.depthIn,
      heightIn: Number(height) || type.defaults.heightIn,
      elevationIn: Number(elevation) || 0,
      ...(multi ? { widthOptions: sortedWidths } : {}),
      price: prices && prices !== 'invalid' ? prices.price : 0,
      finishes: useKitchenColours ? 'cabinet' : finishes.map((f, i) => ({ ...f, id: f.id || slugId(f.name, i) })),
      blurb: '',
      source: 'tenant',
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id, type, tenant.name, name, sku, defaultWidth, depth, height, elevation, multi, sortedWidths.join(','), prices, useKitchenColours, finishes],
  );

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors([]);
    if (prices === 'invalid') return setError('Prices and costs should be amounts like 450 or 1,250, and markup a percentage from 0 to 1000.');
    const row = mode === 'cost' ? costRow() : null;
    const spec: ProductSpecInput = {
      kind: type.kind,
      ...(type.variant ? { variant: type.variant } : {}),
      category: type.category,
      name: name.trim(),
      blurb: loaded?.blurb ?? '',
      sku: sku.trim(),
      widthIn: defaultWidth,
      depthIn: Number(depth),
      heightIn: Number(height),
      elevationIn: Number(elevation) || 0,
      ...(multi ? { widthOptions: sortedWidths } : {}),
      price: prices?.price ?? 0,
      ...(multi && prices?.priceByWidth ? { priceByWidth: prices.priceByWidth } : {}),
      finishes: useKitchenColours ? 'cabinet' : finishes.map((f, i) => ({ id: f.id || slugId(f.name, i), name: f.name.trim(), hex: f.hex, material: f.material })),
      imageFileIds: images.map((i) => i.id),
      ...(modelMeta ? { modelFileId: modelMeta.fileId } : {}),
      ...(line.trim() ? { line: line.trim() } : {}),
      ...(isCabinet && doorStyle ? { doorStyle } : {}),
    };
    setBusy(true);
    try {
      let productId: string;
      if (loaded) {
        const patch: Record<string, unknown> = { ...spec };
        if (!modelMeta) patch.modelFileId = null;
        if (!multi) patch.widthOptions = null;
        if (!(multi && prices?.priceByWidth)) patch.priceByWidth = null;
        if (!line.trim()) patch.line = null;
        if (!(isCabinet && doorStyle)) patch.doorStyle = null;
        const r = await wsApi.updateProduct(loaded.id, patch, loaded.revision ?? 1);
        productId = r.product.id;
      } else {
        productId = (await wsApi.createProduct(spec)).product.id;
      }
      // The private side: kept when working from cost, cleared when the price is typed directly.
      if (row) await wsApi.setPrice(productId, row);
      else if (loaded) await wsApi.setPrice(productId, { costCents: null, costByWidth: null, markupPct: null });
      toast(loaded ? `Saved ${spec.name}.` : `Added ${spec.name}. It’s on your showroom now.`, 'ok');
      void useCatalog.getState().load(true);
      navigateHash(back);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 409 ? 'Someone else saved this product while you were editing. Reload the page to see their changes.' : err.message);
        const errs = (err.body as { errors?: { field: string; message: string }[] } | undefined)?.errors;
        if (errs) setFieldErrors(errs);
      } else setError('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (error && id && !loaded) return <div className="ws-error">{error}</div>;

  const bbox = modelMeta?.bboxIn;
  const off = (got: number, want: number) => want > 0 && Math.abs(got - want) / want > 0.05;
  const effectiveMarkup = markupFor({ costCents: null, costByWidth: null, markupPct: markup.trim() === '' ? null : Number(markup) }, defaultMarkup);

  return (
    <form className="ws-form" onSubmit={save}>
      <div className="ws-head">
        <div>
          <a className="ws-back" href={back}>
            ← Products
          </a>
          <h1>{loaded ? `Edit ${loaded.name}` : 'Quick add a product'}</h1>
          {!loaded && <p>Pick its type, the widths you sell, its door style and finishes. It’s drawn at true size from those, so most cabinets and simple fixtures need no 3D model.</p>}
        </div>
      </div>
      <div className="ws-form-grid">
        <div className="ws-form-main">
          <fieldset className="ws-card">
            <legend>What it is</legend>
            <label className="field">
              <span>Product type</span>
              <select
                value={typeId}
                onChange={(e) => {
                  const t = PRODUCT_TYPES.find((x) => x.id === e.target.value);
                  if (t) applyType(t);
                }}
              >
                {CATEGORIES.map((c) => (
                  <optgroup key={c.id} label={c.label}>
                    {PRODUCT_TYPES.filter((t) => t.category === c.id).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="ws-grid-2">
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={type.label} maxLength={80} required />
              </label>
              <label className="field">
                <span>
                  SKU <em>· {'{w}'} becomes the width: SB{'{w}'} → SB24</em>
                </span>
                <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SB{w}" maxLength={40} />
              </label>
              <label className="field">
                <span>Product line</span>
                <input value={line} onChange={(e) => setLine(e.target.value)} list="ws-lines" placeholder="Lakeshore Shaker" maxLength={60} />
                <datalist id="ws-lines">
                  {lines.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
              </label>
              {isCabinet && (
                <label className="field">
                  <span>Door style</span>
                  <select value={doorStyle} onChange={(e) => setDoorStyle(e.target.value as DoorStyle | '')}>
                    <option value="">Not set</option>
                    {DOOR_STYLES.map((d) => (
                      <option key={d} value={d}>
                        {d[0].toUpperCase() + d.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </fieldset>

          <fieldset className="ws-card">
            <legend>Sizes</legend>
            <span className="mini-label">Widths you sell (inches)</span>
            <div className="chips ws-widths" role="group" aria-label="Widths">
              {[...new Set([...COMMON_WIDTHS, ...widths])]
                .sort((a, b) => a - b)
                .map((w) => (
                  <button type="button" key={w} className={widths.includes(w) ? 'chip on mono' : 'chip mono'} aria-pressed={widths.includes(w)} onClick={() => toggleWidth(w)}>
                    {w}″
                  </button>
                ))}
              <input className="ws-width-input" value={customWidth} onChange={(e) => setCustomWidth(e.target.value)} placeholder="Other" aria-label="Another width in inches" inputMode="decimal" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomWidth())} />
              <button type="button" className="btn" onClick={addCustomWidth} disabled={!customWidth}>
                Add
              </button>
            </div>
            {multi && (
              <label className="field ws-inline">
                <span>Placed at</span>
                <select value={defaultWidth} onChange={(e) => setDefaultWidth(Number(e.target.value))}>
                  {sortedWidths.map((w) => (
                    <option key={w} value={w}>
                      {w}″ by default
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="ws-grid-3">
              <label className="field">
                <span>Depth (in)</span>
                <input value={depth} onChange={(e) => setDepth(e.target.value)} inputMode="decimal" required />
              </label>
              <label className="field">
                <span>Height (in)</span>
                <input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" required />
              </label>
              <label className="field">
                <span>Off the floor (in)</span>
                <input value={elevation} onChange={(e) => setElevation(e.target.value)} inputMode="decimal" />
              </label>
            </div>
          </fieldset>

          <fieldset className="ws-card">
            <legend>Finishes</legend>
            {isCabinet && (
              <label className="ws-switch">
                <input type="checkbox" checked={useKitchenColours} onChange={(e) => setUseKitchenColours(e.target.checked)} />
                <span>
                  <b>Use the kitchen’s cabinet colour</b>
                  <em>Visitors pick from BluModel Studio’s palette instead of your own finishes.</em>
                </span>
              </label>
            )}
            {!useKitchenColours && (
              <div className="ws-finishes">
                {finishes.map((f, i) => (
                  <div key={i} className="ws-finish">
                    <input type="color" value={f.hex} onChange={(e) => setFinishes(finishes.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)))} aria-label={`Colour of finish ${i + 1}`} />
                    <input value={f.name} onChange={(e) => setFinishes(finishes.map((x, j) => (j === i ? { ...x, name: e.target.value, id: loaded ? x.id : slugId(e.target.value, j) } : x)))} placeholder="Dove White" aria-label={`Name of finish ${i + 1}`} maxLength={40} required />
                    <select value={f.material} onChange={(e) => setFinishes(finishes.map((x, j) => (j === i ? { ...x, material: e.target.value as MaterialKind } : x)))} aria-label={`Material of finish ${i + 1}`}>
                      {MATERIALS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="icon-btn" onClick={() => setFinishes(finishes.filter((_, j) => j !== i))} disabled={finishes.length === 1} aria-label={`Remove finish ${i + 1}`}>
                      ×
                    </button>
                  </div>
                ))}
                {finishes.length < 24 && (
                  <button type="button" className="btn ws-add-finish" onClick={() => setFinishes([...finishes, { id: `finish-${finishes.length + 1}`, name: '', hex: '#c9a57a', material: 'wood' }])}>
                    Add a finish
                  </button>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="ws-card">
            <legend>Price</legend>
            <div className="chips" role="radiogroup" aria-label="How to price it">
              <button type="button" role="radio" aria-checked={mode === 'direct'} className={mode === 'direct' ? 'chip on' : 'chip'} onClick={() => setMode('direct')}>
                Type the price
              </button>
              <button type="button" role="radio" aria-checked={mode === 'cost'} className={mode === 'cost' ? 'chip on' : 'chip'} onClick={() => setMode('cost')}>
                Work it out from my cost
              </button>
            </div>
            {mode === 'direct' ? (
              multi ? (
                <div className="ws-width-prices">
                  <span className="mini-label">Price customers see, per width (blank uses the first price)</span>
                  <label className="field">
                    <span>Price</span>
                    <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" inputMode="decimal" />
                  </label>
                  {sortedWidths.map((w) => (
                    <label key={w} className="ws-width-row">
                      <span className="mono">{w}″</span>
                      <input value={priceBy[String(w)] ?? ''} onChange={(e) => setPriceBy({ ...priceBy, [String(w)]: e.target.value })} placeholder={price || '0'} inputMode="decimal" aria-label={`Price at ${w} inches`} />
                    </label>
                  ))}
                </div>
              ) : (
                <label className="field">
                  <span>Price customers see</span>
                  <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" inputMode="decimal" />
                </label>
              )
            ) : (
              <>
                <div className="ws-grid-2">
                  <label className="field">
                    <span>
                      Your cost <em>· private to your team</em>
                    </span>
                    <input value={costs.all ?? ''} onChange={(e) => setCosts({ ...costs, all: e.target.value })} placeholder="What you pay" inputMode="decimal" />
                  </label>
                  <label className="field">
                    <span>
                      Markup % <em>· blank uses your default, {defaultMarkup}%</em>
                    </span>
                    <input value={markup} onChange={(e) => setMarkup(e.target.value)} placeholder={String(defaultMarkup)} inputMode="decimal" />
                  </label>
                </div>
                {multi && (
                  <div className="ws-width-prices">
                    <span className="mini-label">Cost per width, if it changes (blank uses the cost above)</span>
                    {sortedWidths.map((w) => (
                      <label key={w} className="ws-width-row">
                        <span className="mono">{w}″</span>
                        <input value={costs[String(w)] ?? ''} onChange={(e) => setCosts({ ...costs, [String(w)]: e.target.value })} placeholder={costs.all || 'Cost'} inputMode="decimal" aria-label={`Your cost at ${w} inches`} />
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
            <p className="ws-example" role="status">
              {prices === 'invalid'
                ? 'Use amounts like 450 or 1,250.'
                : prices === null
                  ? 'No price yet: visitors see it without one.'
                  : mode === 'cost'
                    ? `At ${defaultWidth}″ customers see ${money(prices.price)} (${effectiveMarkup}% on your cost).`
                    : `At ${defaultWidth}″ customers see ${money(prices.price)}.`}
            </p>
          </fieldset>

          <fieldset className="ws-card">
            <legend>Photos and 3D model (optional)</legend>
            <div className="ws-images">
              {images.map((im, i) => (
                <div key={im.id} className="ws-image">
                  {im.url ? <img src={im.url} alt={`Photo ${i + 1}`} /> : <span>Photo {i + 1}</span>}
                  <button type="button" className="icon-btn" onClick={() => setImages(images.filter((x) => x.id !== im.id))} aria-label={`Remove photo ${i + 1}`}>
                    ×
                  </button>
                </div>
              ))}
              {images.length < 12 && (
                <button type="button" className="ws-image ws-image-add" onClick={() => imageRef.current?.click()} disabled={uploading !== null}>
                  {uploading === 'image' ? 'Uploading…' : '+ Photo'}
                </button>
              )}
              <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => (e.target.files?.[0] && void pickImage(e.target.files[0]), (e.target.value = ''))} />
            </div>
            <div className="ws-actions">
              <button type="button" className="btn" onClick={() => modelRef.current?.click()} disabled={uploading !== null}>
                {uploading === 'model' ? 'Checking the model…' : modelMeta ? 'Replace the .glb model' : 'Upload a .glb model'}
              </button>
              {modelMeta && (
                <button type="button" className="btn" onClick={() => setModelMeta(null)}>
                  Remove model
                </button>
              )}
              <input ref={modelRef} type="file" accept=".glb,model/gltf-binary" hidden onChange={(e) => (e.target.files?.[0] && void pickModel(e.target.files[0]), (e.target.value = ''))} />
            </div>
            <p className="fine">
              Optional. Without one, it’s drawn from its size, door style and finish. For a product that needs a real model, <a href={hrefFor({ name: 'studio', rest: 'products/requests/new' })}>ask us to model it</a>.
            </p>
            {modelMeta && bbox && (
              <p className={off(bbox.w, defaultWidth) || off(bbox.d, Number(depth)) || off(bbox.h, Number(height)) ? 'ws-warn' : 'ws-ok'} role="status">
                Model {bbox.w.toFixed(1)}″ W × {bbox.d.toFixed(1)}″ D × {bbox.h.toFixed(1)}″ H against {defaultWidth}″ × {depth}″ × {height}″
                {off(bbox.w, defaultWidth) || off(bbox.d, Number(depth)) || off(bbox.h, Number(height)) ? ': more than 5% off, so it will be scaled to fit. Check the sizes.' : ': matches.'}
              </p>
            )}
          </fieldset>

          {error && (
            <div className="ws-error" role="alert">
              {error}
            </div>
          )}
          {fieldErrors.length > 0 && (
            <ul className="ws-field-errors">
              {fieldErrors.map((f) => (
                <li key={`${f.field}:${f.message}`}>
                  <b>{f.field}</b>: {f.message}
                </li>
              ))}
            </ul>
          )}
          <div className="ws-save">
            <a className="btn" href={back}>
              Cancel
            </a>
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : loaded ? 'Save changes' : 'Add to my showroom'}
            </button>
          </div>
        </div>
        <aside className="ws-form-preview" aria-label="Preview">
          <span className="eyebrow">Preview</span>
          <div className="ws-preview-art">
            <ProductArt product={draft} surfaces={DEFAULT_SURFACES} width={defaultWidth} />
          </div>
          <b>{draft.name}</b>
          <span className="muted">
            {tenant.name}
            {line.trim() ? ` · ${line.trim()}` : ''}
          </span>
          <span className="muted mono">
            {multi ? `${sortedWidths[0]}–${sortedWidths[sortedWidths.length - 1]}″ W` : `${defaultWidth}″ W`} × {depth}″ D × {height}″ H
          </span>
          {prices && prices !== 'invalid' && <span className="ws-pill">{money(prices.price)}</span>}
        </aside>
      </div>
    </form>
  );
}
