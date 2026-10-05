import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ProductArt } from '../../components/ProductArt';
import { DEFAULT_SURFACES } from '../../data/defaults';
import { CATEGORIES } from '../../data/catalog';
import { PRODUCT_TYPES, type ProductType } from '../../data/productTypes';
import { ApiError } from '../../lib/api';
import { money } from '../../lib/format';
import { hrefFor, navigateHash, useHashQuery } from '../../lib/router';
import { useCatalog } from '../../store/useCatalog';
import { useDesignStore } from '../../store/useDesignStore';
import type { DoorStyle, MaterialKind, Product } from '../../types';
import type { FileWire, GlbMeta, PriceBookEntry, ProductSpecInput } from '../../types/platform';
import { cents, parseDollars, proApi, type CostInput } from './api';
import { useWorkspace } from './ContractorRoot';
import { loadPriceBook, usePriceBook } from './pricing';
import { quoteFor } from './priceMath';

const COMMON_WIDTHS = [9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45, 48];
const CABINET_KINDS = new Set(['base', 'corner', 'wall', 'tall', 'island']);
const MATERIALS: MaterialKind[] = ['paint', 'wood', 'metal', 'stone', 'glass', 'ceramic', 'fabric', 'leather'];
const DOOR_STYLES: DoorStyle[] = ['shaker', 'slab', 'fluted'];

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

/** Which product type a saved product came from (kind + variant), for editing. */
function typeOf(p: Product): ProductType | undefined {
  return PRODUCT_TYPES.find((t) => t.kind === p.kind && (t.variant ?? null) === (p.variant ?? null)) ?? PRODUCT_TYPES.find((t) => t.kind === p.kind);
}

/**
 * `#/pro/catalog/new` and `#/pro/catalog/:id`: quick add (no 3D model needed) and editing, with an
 * optional GLB upload checked against the declared size (PLANS_AND_CONTRACTORS §4.2).
 */
export default function ProductForm({ id }: { id: string | null }) {
  const { readOnly, profile } = useWorkspace();
  const { data } = usePriceBook();
  const query = useHashQuery();
  const toast = useDesignStore((s) => s.toast);
  const [loaded, setLoaded] = useState<Product | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ field: string; message: string }[]>([]);
  const [busy, setBusy] = useState(false);

  // ── the form ──
  const [typeId, setTypeId] = useState('base-cabinet');
  const type = PRODUCT_TYPES.find((t) => t.id === typeId)!;
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [line, setLine] = useState('');
  const [doorStyle, setDoorStyle] = useState<DoorStyle | ''>('shaker');
  const [widths, setWidths] = useState<number[]>([24]);
  const [defaultWidth, setDefaultWidth] = useState(24);
  const [depth, setDepth] = useState('24');
  const [height, setHeight] = useState('36');
  const [elevation, setElevation] = useState('0');
  const [useKitchenColours, setUseKitchenColours] = useState(false);
  const [finishes, setFinishes] = useState<FinishDraft[]>([{ id: 'white', name: 'White', hex: '#f3f1ec', material: 'paint' }]);
  const [images, setImages] = useState<{ id: string; url: string }[]>([]);
  const [model, setModel] = useState<FileWire | null>(null);
  const [modelMeta, setModelMeta] = useState<{ fileId: string; bboxIn?: { w: number; h: number; d: number }; triangles?: number } | null>(null);
  const [list, setList] = useState('');
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [markup, setMarkup] = useState('');
  const [uploading, setUploading] = useState<'image' | 'model' | null>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);

  const isCabinet = CABINET_KINDS.has(type.kind);

  const applyType = (t: ProductType, keepName = false) => {
    setTypeId(t.id);
    setWidths([t.defaults.widthIn]);
    setDefaultWidth(t.defaults.widthIn);
    setDepth(String(t.defaults.depthIn));
    setHeight(String(t.defaults.heightIn));
    setElevation(String(t.defaults.elevationIn));
    if (!keepName && !name) setName('');
    setUseKitchenColours(false);
  };

  useEffect(() => {
    let live = true;
    proApi
      .products(true)
      .then((r) => {
        if (!live) return;
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
        setList(p.price ? String(p.price) : '');
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load your catalog.'));
    void loadPriceBook();
    return () => {
      live = false;
    };
  }, [id]);

  // Costs and markup come from the price book row (only the owner ever gets these).
  useEffect(() => {
    if (!id || !data) return;
    const row = data.rows[id];
    if (!row) return;
    const next: Record<string, string> = {};
    if (row.costByWidth) for (const [w, c] of Object.entries(row.costByWidth)) next[w] = String(c / 100);
    if (row.costCents !== null) next.all = String(row.costCents / 100);
    setCosts(next);
    setMarkup(row.markupPct !== null ? String(row.markupPct) : '');
  }, [id, data]);

  useEffect(() => {
    if (query.get('model') === '1' && !id) modelRef.current?.scrollIntoView({ block: 'center' });
  }, [query, id]);

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
      const { file: f } = await proApi.uploadImage(file);
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
      const { file: f } = await proApi.uploadModel(file);
      setModel(f);
      const meta = f.meta as GlbMeta;
      setModelMeta({ fileId: f.id, bboxIn: meta.bboxIn, triangles: meta.triangles });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'That model didn’t upload.', 'warn');
    } finally {
      setUploading(null);
    }
  };

  // The draft as a product, for the live drawing and the sell-price preview.
  const draft: Product = useMemo(
    () => ({
      id: id ?? 'draft',
      kind: type.kind,
      ...(type.variant ? { variant: type.variant } : {}),
      category: type.category,
      brand: profile.company,
      name: name || type.label,
      code: sku,
      sku,
      widthIn: defaultWidth,
      depthIn: Number(depth) || type.defaults.depthIn,
      heightIn: Number(height) || type.defaults.heightIn,
      elevationIn: Number(elevation) || 0,
      ...(multi ? { widthOptions: sortedWidths } : {}),
      price: parseDollars(list) || 0,
      finishes: useKitchenColours ? 'cabinet' : finishes.map((f, i) => ({ ...f, id: f.id || slugId(f.name, i) })),
      blurb: '',
      source: 'contractor',
    }),
    [id, type, profile.company, name, sku, defaultWidth, depth, height, elevation, multi, sortedWidths.join(','), list, useKitchenColours, finishes],
  );

  const costInput = (): CostInput | null => {
    const byWidth: Record<string, number | null> = {};
    let any = false;
    if (multi) {
      for (const w of sortedWidths) {
        const v = parseDollars(costs[String(w)] ?? '');
        if (Number.isNaN(v)) return null;
        byWidth[String(w)] = v === null ? null : cents(v);
        if (v !== null) any = true;
      }
    }
    const single = multi ? null : parseDollars(costs.all ?? '');
    if (Number.isNaN(single)) return null;
    const m = markup.trim() === '' ? null : Number(markup);
    if (m !== null && (!Number.isFinite(m) || m < 0 || m > 1000)) return null;
    return {
      costCents: single === null ? null : cents(single),
      costByWidth: multi && any ? byWidth : null,
      markupPct: m,
    };
  };

  // The sell price at the default width, as the editor will price it.
  const preview = useMemo(() => {
    if (!data) return null;
    const c = costInput();
    if (!c) return null;
    const row: PriceBookEntry = {
      costCents: c.costCents ?? null,
      costByWidth: c.costByWidth ? (Object.fromEntries(Object.entries(c.costByWidth).filter(([, v]) => v !== null)) as Record<string, number>) : null,
      markupPct: c.markupPct ?? null,
    };
    return quoteFor({ ...data, rows: { ...data.rows, [draft.id]: row } }, draft, defaultWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, draft, costs, markup, defaultWidth]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors([]);
    const listPrice = parseDollars(list);
    if (Number.isNaN(listPrice)) return setError('The list price should be a number, like 450 or 1,250.');
    const cost = costInput();
    if (!cost) return setError('Costs should be numbers like 450 or 1,250, and markup a percentage from 0 to 1000.');
    const spec: ProductSpecInput = {
      kind: type.kind,
      ...(type.variant ? { variant: type.variant } : {}),
      category: type.category,
      name: name.trim(),
      blurb: '',
      sku: sku.trim(),
      widthIn: defaultWidth,
      depthIn: Number(depth),
      heightIn: Number(height),
      elevationIn: Number(elevation) || 0,
      ...(multi ? { widthOptions: sortedWidths } : {}),
      price: listPrice ?? 0,
      finishes: useKitchenColours ? 'cabinet' : finishes.map((f, i) => ({ id: f.id || slugId(f.name, i), name: f.name.trim(), hex: f.hex, material: f.material })),
      imageFileIds: images.map((i) => i.id),
      ...(modelMeta ? { modelFileId: modelMeta.fileId } : {}),
      ...(line.trim() ? { line: line.trim() } : {}),
      ...(isCabinet && doorStyle ? { doorStyle } : {}),
    };
    setBusy(true);
    try {
      if (loaded) {
        const patch: Record<string, unknown> = { ...spec };
        if (!modelMeta) patch.modelFileId = null;
        if (!multi) patch.widthOptions = null;
        if (!line.trim()) patch.line = null;
        if (!(isCabinet && doorStyle)) patch.doorStyle = null;
        await proApi.updateProduct(loaded.id, patch, loaded.revision ?? 1, cost);
        toast(`Saved ${spec.name}.`, 'ok');
      } else {
        await proApi.createProduct(spec, cost);
        toast(`Added ${spec.name} to your catalog. It’s in your catalog panel now.`, 'ok');
      }
      await Promise.all([loadPriceBook(true), useCatalog.getState().load(true)]);
      navigateHash(hrefFor({ name: 'pro', rest: 'catalog' }));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        const errs = (err.body as { errors?: { field: string; message: string }[] } | undefined)?.errors;
        if (errs) setFieldErrors(errs);
      } else setError('Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (error && id && !loaded) return <div className="auth-error">{error}</div>;

  const bbox = modelMeta?.bboxIn;
  const off = (got: number, want: number) => want > 0 && Math.abs(got - want) / want > 0.05;
  const disabled = readOnly || busy;

  return (
    <form className="pro-form" onSubmit={save}>
      <div className="pro-head">
        <div>
          <a className="pro-back" href={hrefFor({ name: 'pro', rest: 'catalog' })}>
            ← My catalog
          </a>
          <h1>{loaded ? `Edit ${loaded.name}` : 'Quick add a product'}</h1>
        </div>
      </div>
      <div className="pro-form-grid">
        <div className="pro-form-main">
          <fieldset className="pro-section" disabled={disabled}>
            <legend>What it is</legend>
            <label className="field">
              <span>Product type</span>
              <select
                value={typeId}
                onChange={(e) => {
                  const t = PRODUCT_TYPES.find((x) => x.id === e.target.value);
                  if (t) applyType(t, true);
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
            <div className="pro-grid-2">
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder={type.label} maxLength={80} required data-autofocus />
              </label>
              <label className="field">
                <span>SKU <em>· {'{w}'} becomes the width, e.g. SB{'{w}'} → SB24</em></span>
                <input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SB{w}" maxLength={40} />
              </label>
              <label className="field">
                <span>Line or collection</span>
                <input value={line} onChange={(e) => setLine(e.target.value)} list="pro-lines" placeholder="Smith Shaker" maxLength={60} />
                <datalist id="pro-lines">
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
                  {type.kind === 'wall' && <em className="fine">Glass fronts are their own type: “Wall cabinet – glass front”.</em>}
                </label>
              )}
            </div>
          </fieldset>

          <fieldset className="pro-section" disabled={disabled}>
            <legend>Sizes</legend>
            <span className="mini-label">Widths you sell (inches)</span>
            <div className="chips pro-widths" role="group" aria-label="Widths">
              {[...new Set([...COMMON_WIDTHS, ...widths])]
                .sort((a, b) => a - b)
                .map((w) => (
                  <button type="button" key={w} className={widths.includes(w) ? 'chip on mono' : 'chip mono'} aria-pressed={widths.includes(w)} onClick={() => toggleWidth(w)}>
                    {w}″
                  </button>
                ))}
              <input className="pro-width-input" value={customWidth} onChange={(e) => setCustomWidth(e.target.value)} placeholder="Other" aria-label="Another width in inches" inputMode="decimal" onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustomWidth())} />
              <button type="button" className="btn" onClick={addCustomWidth} disabled={!customWidth}>
                Add
              </button>
            </div>
            {multi && (
              <label className="field pro-inline">
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
            <div className="pro-grid-3">
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

          <fieldset className="pro-section" disabled={disabled}>
            <legend>Finishes</legend>
            {isCabinet && (
              <label className="pro-check">
                <input type="checkbox" checked={useKitchenColours} onChange={(e) => setUseKitchenColours(e.target.checked)} /> Use the kitchen’s cabinet colour (Mise’s palette) instead of my own finishes
              </label>
            )}
            {!useKitchenColours && (
              <div className="pro-finishes">
                {finishes.map((f, i) => (
                  <div key={i} className="pro-finish">
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
                  <button type="button" className="btn" onClick={() => setFinishes([...finishes, { id: `finish-${finishes.length + 1}`, name: '', hex: '#c9a57a', material: 'wood' }])}>
                    Add a finish
                  </button>
                )}
              </div>
            )}
          </fieldset>

          <fieldset className="pro-section" disabled={disabled}>
            <legend>Photos and 3D model (optional)</legend>
            <div className="pro-images">
              {images.map((im, i) => (
                <div key={im.id} className="pro-image">
                  {im.url ? <img src={im.url} alt={`Photo ${i + 1}`} /> : <span>Photo {i + 1}</span>}
                  <button type="button" className="icon-btn" onClick={() => setImages(images.filter((x) => x.id !== im.id))} aria-label={`Remove photo ${i + 1}`}>
                    ×
                  </button>
                  {i === 0 && <em>Card image</em>}
                </div>
              ))}
              {images.length < 12 && (
                <button type="button" className="pro-image pro-image-add" onClick={() => imageRef.current?.click()} disabled={uploading !== null}>
                  {uploading === 'image' ? 'Uploading…' : '+ Photo'}
                </button>
              )}
              <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => (e.target.files?.[0] && void pickImage(e.target.files[0]), (e.target.value = ''))} />
            </div>
            <div className="pro-model">
              <button type="button" className="btn" onClick={() => modelRef.current?.click()} disabled={uploading !== null}>
                {uploading === 'model' ? 'Checking the model…' : modelMeta ? 'Replace the .glb model' : 'Upload a .glb model'}
              </button>
              {modelMeta && (
                <button type="button" className="btn" onClick={() => (setModel(null), setModelMeta(null))}>
                  Remove model
                </button>
              )}
              <input ref={modelRef} type="file" accept=".glb,model/gltf-binary" hidden onChange={(e) => (e.target.files?.[0] && void pickModel(e.target.files[0]), (e.target.value = ''))} />
              <p className="fine">Optional: without one, Mise draws the product from its size, door style and finish.</p>
            </div>
            {modelMeta && (
              <div className="pro-glb-report" role="status" aria-label="Model check">
                <b>Model check</b>
                <ul>
                  {model && <li>File size: {(model.sizeBytes / 1048576).toFixed(1)} MB</li>}
                  {typeof modelMeta.triangles === 'number' && <li>Triangles: {modelMeta.triangles.toLocaleString()}</li>}
                  {bbox && (
                    <li className={off(bbox.w, defaultWidth) || off(bbox.d, Number(depth)) || off(bbox.h, Number(height)) ? 'warn' : 'ok'}>
                      Model size {bbox.w.toFixed(1)}″ W × {bbox.d.toFixed(1)}″ D × {bbox.h.toFixed(1)}″ H vs. declared {defaultWidth}″ × {depth}″ × {height}″
                      {off(bbox.w, defaultWidth) || off(bbox.d, Number(depth)) || off(bbox.h, Number(height)) ? ': more than 5% off. It will be scaled to fit; check the sizes.' : ': matches.'}
                    </li>
                  )}
                  {((model?.meta as GlbMeta | undefined)?.warnings ?? []).map((w) => (
                    <li key={w} className="warn">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </fieldset>

          <fieldset className="pro-section" disabled={disabled}>
            <legend>Price</legend>
            <div className="pro-grid-2">
              <label className="field">
                <span>List price / MSRP (optional)</span>
                <input value={list} onChange={(e) => setList(e.target.value)} placeholder="0" inputMode="decimal" />
              </label>
              <label className="field">
                <span>Markup % for this product <em>· blank uses {line.trim() ? 'the line’s or ' : ''}your default</em></span>
                <input value={markup} onChange={(e) => setMarkup(e.target.value)} placeholder={String(profile.defaultMarkupPct)} inputMode="decimal" />
              </label>
            </div>
            {multi ? (
              <div className="pro-costs">
                <span className="mini-label">Your cost per width (private)</span>
                {sortedWidths.map((w) => (
                  <label key={w} className="pro-cost-row">
                    <span className="mono">{w}″</span>
                    <input value={costs[String(w)] ?? ''} onChange={(e) => setCosts({ ...costs, [String(w)]: e.target.value })} placeholder="Cost" inputMode="decimal" aria-label={`Your cost at ${w} inches`} />
                  </label>
                ))}
              </div>
            ) : (
              <label className="field">
                <span>Your cost (private)</span>
                <input value={costs.all ?? ''} onChange={(e) => setCosts({ ...costs, all: e.target.value })} placeholder="What you pay" inputMode="decimal" />
              </label>
            )}
            {preview && (
              <p className="pro-example">
                {preview.noCost ? (
                  <>No cost entered: it sells at its list price, {money(preview.sell)}.</>
                ) : (
                  <>
                    At {defaultWidth}″ it costs you <b>{money(preview.cost ?? 0)}</b> and sells for <b>{money(preview.sell)}</b> ({preview.markupPct}% markup).
                  </>
                )}
              </p>
            )}
          </fieldset>

          {error && <div className="auth-error">{error}</div>}
          {fieldErrors.length > 0 && (
            <ul className="pro-field-errors">
              {fieldErrors.map((f) => (
                <li key={`${f.field}:${f.message}`}>
                  <b>{f.field}</b>: {f.message}
                </li>
              ))}
            </ul>
          )}
          {!readOnly && (
            <div className="modal-actions">
              <a className="btn" href={hrefFor({ name: 'pro', rest: 'catalog' })}>
                Cancel
              </a>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'Saving…' : loaded ? 'Save changes' : 'Add to my catalog'}
              </button>
            </div>
          )}
        </div>
        <aside className="pro-form-preview" aria-label="Preview">
          <span className="eyebrow">Preview</span>
          <div className="pro-preview-art">
            <ProductArt product={draft} surfaces={DEFAULT_SURFACES} width={defaultWidth} />
          </div>
          <b>{draft.name}</b>
          <span className="muted">
            {profile.company}
            {line.trim() ? ` · ${line.trim()}` : ''}
          </span>
          <span className="muted mono">
            {multi ? `${sortedWidths[0]}–${sortedWidths[sortedWidths.length - 1]}″ W` : `${defaultWidth}″ W`} × {depth}″ D × {height}″ H
          </span>
        </aside>
      </div>
    </form>
  );
}
