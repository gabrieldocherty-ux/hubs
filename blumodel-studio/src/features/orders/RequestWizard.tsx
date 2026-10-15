import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { api, ApiError } from '../../lib/api';
import { hrefFor, navigate, useHashQuery } from '../../lib/router';
import { useSession } from '../../store/useSession';
import { getProduct, CATEGORIES } from '../../data/catalog';
import { PRODUCT_TYPES, productType, productTypeFor } from '../../data/productTypes';
import type { Product } from '../../types';
import { ordersApi, type Allowance, type ModelTerms, type OrderRequest, type OrderTarget } from './api';
import { BarcodeScanDialog, readBarcodeFromImage, useCanScan } from './BarcodeScan';
import {
  allowanceCheck,
  BRAND_MAX,
  briefSize,
  errorTarget,
  itemProblem,
  itemProblems,
  MAX_NOTES,
  MAX_REFERENCES,
  modelsLeftText,
  NAME_MAX,
  parseInches,
  resetDay,
  STEPS,
  type DraftItem,
  type ItemField,
  type Step,
} from './model';
import { formatUpc, normalizeUpc, UPC_FORMAT_LABEL, upcWhileTyping } from './upc';
import { OrdersShell, PlanOnlyNote } from './parts';

/** v2: the product list. A v1 draft (tiers) is left alone and simply not loaded; a v2 draft's old rush flag is ignored. */
const DRAFT_KEY = 'blumodel.orders.request.v2';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_ITEMS = 40;
/** What the plan includes, until the server's terms load (the server is the authority). */
const DEFAULT_TERMS: ModelTerms = { perMonth: 3, finishesPerModel: 3, revisions: 2, businessDays: 15 };

type Thumbs = Record<string, { url: string; name: string }>;

interface Draft {
  target: OrderTarget;
  brandId: string;
  line: string;
  items: DraftItem[];
  /** The product whose form is open (-1: none). */
  open: number;
  step: Step;
  /** Thumbnails of uploaded photos, by file id. */
  files: Thumbs;
}

const blankItem = (from?: Partial<DraftItem>): DraftItem => ({
  productTypeId: '',
  name: '',
  brand: '',
  upc: '',
  widthIn: null,
  depthIn: null,
  heightIn: null,
  notes: '',
  referenceFileIds: [],
  ...from,
});

function loadDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    const d = raw ? (JSON.parse(raw) as Draft & { rush?: boolean }) : null;
    if (!d || !Array.isArray(d.items) || !d.items.length) return null;
    const { rush: _rush, ...rest } = d;
    return { ...rest, items: d.items.map((it) => blankItem(it)), step: d.step === 'review' ? 'review' : 'products', open: Number.isInteger(d.open) ? d.open : 0 };
  } catch {
    return null;
  }
}
function saveDraft(d: Draft | null) {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    /* private mode: the draft just isn't kept */
  }
}

/**
 * A product prefilled from a catalog product (`?ref=`): its type, name, brand and size. A built-in
 * product's brand is BluModel's own placeholder line, not the maker of the real thing being
 * modelled, so it is left for the buyer to fill in.
 */
function itemFromProduct(p: Product): DraftItem {
  const t = productTypeFor(p.kind, p.variant);
  return blankItem({
    productTypeId: t?.id ?? '',
    name: p.name.slice(0, NAME_MAX),
    brand: p.source === 'builtin' ? '' : (p.brand ?? '').slice(0, BRAND_MAX),
    widthIn: p.widthIn,
    depthIn: p.depthIn,
    heightIn: p.heightIn,
    refProductId: p.id,
  });
}

/**
 * `#/orders/new?ref=&brand=&target=`: Make custom models, a Contractor-plan feature. A product list
 * (name, brand, UPC, size, photos and notes for each); each product is one of the plan's included
 * models (3 a month, made by our studio). Nothing is paid: the request goes straight to the studio,
 * and the server checks the plan and the allowance again when it arrives.
 */
export function RequestWizard() {
  const query = useHashQuery();
  const user = useSession((s) => s.user);
  const refId = query.get('ref');
  const askedBrand = query.get('brand');
  const askedTarget = query.get('target');

  // A contractor's own brand page is fed from My catalog (Brand page → Products), so the only brand
  // drafts an order can target are partner brands the user belongs to.
  const brands = (user?.brands ?? []).filter((b) => b.kind !== 'contractor' && b.status !== 'rejected' && b.status !== 'suspended');

  const initial = (): Draft => {
    const saved = refId || askedBrand || askedTarget ? null : loadDraft();
    if (saved) return saved;
    let target: OrderTarget = 'contractor';
    let brandId = '';
    if (askedBrand && brands.some((b) => b.id === askedBrand)) {
      target = 'brand';
      brandId = askedBrand;
    } else if (askedTarget === 'customer') target = 'customer';
    const ref = refId ? getProduct(refId) : undefined;
    const item = ref && ref.source !== 'missing' ? itemFromProduct(ref) : blankItem();
    return { target, brandId, line: '', items: [item], open: 0, step: 'products', files: {} };
  };

  const [d, setD] = useState<Draft>(initial);
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  const [terms, setTerms] = useState<ModelTerms>(DEFAULT_TERMS);
  const [error, setError] = useState<string | null>(null);
  /** Field errors are shown once someone tries to move on (or the server sends some back). */
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<number, Partial<Record<string, string>>>>({});
  const [sending, setSending] = useState(false);
  const [refProduct, setRefProduct] = useState<Product | null>(() => (refId ? getProduct(refId) ?? null : null));

  const maxItems = DEFAULT_MAX_ITEMS;
  const update = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const updateItem = (i: number, patch: Partial<DraftItem>) => {
    setD((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
    // A field the buyer changes is no longer the server's complaint.
    setServerErrors((s) => {
      if (!s[i]) return s;
      const next = { ...s[i] };
      for (const k of Object.keys(patch)) delete next[k];
      return { ...s, [i]: next };
    });
  };
  const addFiles = (f: Thumbs) => setD((x) => ({ ...x, files: { ...x.files, ...f } }));

  useEffect(() => saveDraft(d), [d]);

  useEffect(() => {
    let live = true;
    ordersApi
      .allowance()
      .then((r) => {
        if (!live) return;
        setAllowance(r.allowance);
        setTerms(r.terms);
      })
      .catch((e) => live && setError(e instanceof ApiError ? e.message : 'Could not load your Contractor plan’s models.'));
    return () => {
      live = false;
    };
  }, []);

  // `?ref=` for a server product the registry hasn't loaded yet.
  useEffect(() => {
    if (!refId || refProduct) return;
    let live = true;
    api
      .catalogProduct(refId)
      .then(({ product }) => {
        if (!live) return;
        setRefProduct(product);
        setD((x) => (x.items.length === 1 && !x.items[0]!.productTypeId ? { ...x, items: [itemFromProduct(product)] } : x));
      })
      .catch(() => live && setError('That catalog product isn’t available, so the request starts blank.'));
    return () => {
      live = false;
    };
  }, [refId, refProduct]);

  const count = d.items.length;
  const fits = allowanceCheck(count, allowance);
  const stepIndex = STEPS.findIndex((s) => s.id === d.step);
  const firstBad = d.items.findIndex((it) => itemProblem(it));
  /** Products can be added up to what is left (or to the request limit). */
  const room = allowance?.active ? Math.min(maxItems, Math.max(allowance.left, 1)) : maxItems;

  const go = (step: Step) => {
    setError(null);
    update({ step });
    window.scrollTo?.({ top: 0 });
  };
  const toReview = () => {
    if (firstBad >= 0) {
      setShowErrors(true);
      update({ open: firstBad, step: 'products' });
      focusItem(firstBad);
      return;
    }
    go('review');
  };

  const focusItem = (i: number) =>
    requestAnimationFrame(() => {
      const el = document.getElementById(`ord-product-${i}`);
      el?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
      el?.querySelector<HTMLElement>('[aria-invalid="true"], select, input')?.focus({ preventScroll: true });
    });

  const addItem = () => {
    if (count >= room) return;
    const prev = d.items[d.items.length - 1];
    // A line of products usually shares its type and brand: start the next one from them.
    setD((x) => ({ ...x, items: [...x.items, blankItem({ productTypeId: prev?.productTypeId ?? '', brand: prev?.brand ?? '' })], open: x.items.length, step: 'products' }));
    setShowErrors(false);
    focusItem(count);
  };
  const removeItem = (i: number) => {
    setD((x) => (x.items.length < 2 ? x : { ...x, items: x.items.filter((_, j) => j !== i), open: -1 }));
    setServerErrors({});
  };

  const send = async () => {
    if (firstBad >= 0) {
      setShowErrors(true);
      update({ step: 'products', open: firstBad });
      focusItem(firstBad);
      return;
    }
    if (!fits.ok) {
      setError(fits.message);
      return;
    }
    setSending(true);
    setError(null);
    const body: OrderRequest = {
      target: d.target,
      ...(d.target === 'brand' ? { brandId: d.brandId } : {}),
      ...(d.line.trim() ? { line: d.line.trim() } : {}),
      items: d.items.map((it) => {
        const t = productType(it.productTypeId);
        const upc = it.upc.trim() ? normalizeUpc(it.upc) : null;
        return {
          brief: {
            productTypeId: it.productTypeId,
            kind: t?.kind,
            ...(t?.variant ? { variant: t.variant } : {}),
            name: it.name.trim(),
            ...(it.brand.trim() ? { brand: it.brand.trim() } : {}),
            ...(upc?.ok ? { upc: upc.code } : {}),
            ...(it.barcodeFileId ? { barcodeFileId: it.barcodeFileId } : {}),
            ...(it.widthIn != null ? { widthIn: it.widthIn } : {}),
            ...(it.depthIn != null ? { depthIn: it.depthIn } : {}),
            ...(it.heightIn != null ? { heightIn: it.heightIn } : {}),
            ...(t && t.defaults.elevationIn > 0 ? { elevationIn: t.defaults.elevationIn } : {}),
            notes: it.notes.trim(),
            referenceFileIds: it.referenceFileIds,
            ...(it.refProductId ? { refProductId: it.refProductId } : {}),
          },
        };
      }),
    };
    try {
      const r = await ordersApi.create(body);
      saveDraft(null);
      navigate({ name: 'orders', rest: r.order.id });
    } catch (e) {
      setSending(false);
      const b = e instanceof ApiError ? (e.body as { errors?: { field: string; message: string }[]; allowance?: Allowance } | undefined) : undefined;
      // The server is the authority on the allowance: take what it says (another request may have used it).
      if (b?.allowance) setAllowance(b.allowance);
      const errors = b?.errors ?? [];
      const byItem: Record<number, Record<string, string>> = {};
      for (const fe of errors) {
        const at = errorTarget(fe.field);
        if (at) (byItem[at.item] ??= {})[at.field] = fe.message;
      }
      const firstItem = Object.keys(byItem).map(Number).sort((a, b2) => a - b2)[0];
      setError(errors[0]?.message ?? (e instanceof ApiError ? e.message : 'Could not send the request.'));
      if (firstItem != null) {
        setServerErrors(byItem);
        setShowErrors(true);
        update({ step: 'products', open: firstItem });
        focusItem(firstItem);
      }
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (d.step === 'review') void send();
    else toReview();
  };

  // Not on the Contractor plan (or it lapsed): custom models come with it. Nothing to fill in.
  if (allowance && !allowance.active) {
    return (
      <OrdersShell>
        <div className="ord-head">
          <div>
            <span className="eyebrow">Make custom models</span>
            <h1>New request</h1>
          </div>
        </div>
        <PlanOnlyNote lapsed={!!user?.contractor} terms={terms} />
        <p className="fine">
          <a href={hrefFor({ name: 'orders', rest: '' })}>Back to your custom models</a>
        </p>
      </OrdersShell>
    );
  }

  const showTarget = brands.length > 0;
  const lineMatters = d.target !== 'customer' || count > 1;

  return (
    <OrdersShell wide>
      <div className="ord-head">
        <div>
          <span className="eyebrow">Make custom models</span>
          <h1>New request</h1>
          <p className="muted">
            List the products you want modelled. Your Contractor plan includes {terms.perMonth} custom 3D models a month, made by our studio: one true-to-size model per product, with up to{' '}
            {terms.finishesPerModel} finishes and {terms.revisions} revision rounds each.
          </p>
        </div>
      </div>

      <ol className="ord-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              className={s.id === d.step ? 'ord-step on' : 'ord-step'}
              aria-current={s.id === d.step ? 'step' : undefined}
              onClick={() => (s.id === 'review' ? toReview() : go(s.id))}
            >
              <span className="ord-step-n">{i + 1}</span>
              {s.label}
            </button>
          </li>
        ))}
      </ol>

      <div className="ord-wizard">
        <form className="ord-card ord-form" onSubmit={onSubmit} noValidate>
          {d.step === 'products' && (
            <section>
              <h2>Products to model</h2>
              <TargetPicker value={d.target} brandId={d.brandId} brands={brands} show={showTarget} onChange={(target, brandId) => update({ target, brandId })} />
              {refProduct && d.items.some((it) => it.refProductId === refProduct.id) && (
                <div className="ord-ref">
                  {refProduct.thumbnailUrl && <img src={refProduct.thumbnailUrl} alt="" />}
                  <div>
                    <span className="mini-label">Starting from</span>
                    <b>{refProduct.name}</b>
                    <span className="muted"> · {refProduct.brand}</span>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setD((x) => ({ ...x, items: x.items.map((it) => (it.refProductId === refProduct.id ? { ...it, refProductId: undefined } : it)) }))}
                  >
                    Don’t use it
                  </button>
                </div>
              )}

              <ol className="ord-products" aria-label="Products in this request">
                {d.items.map((it, i) => (
                  <li key={i} id={`ord-product-${i}`} className="ord-product-slot">
                    <ProductCard
                      index={i}
                      item={it}
                      open={d.open === i}
                      onToggle={() => update({ open: d.open === i ? -1 : i })}
                      onChange={(patch) => updateItem(i, patch)}
                      onRemove={count > 1 ? () => removeItem(i) : undefined}
                      files={d.files}
                      addFiles={addFiles}
                      showErrors={showErrors}
                      serverErrors={serverErrors[i] ?? {}}
                    />
                  </li>
                ))}
              </ol>

              <AllowanceMeter allowance={allowance} count={count} />
              {count < room ? (
                <button type="button" className="btn ord-add-item" onClick={addItem}>
                  + Add a product
                </button>
              ) : allowance?.active ? (
                <p className="fine">
                  That’s every model left this month. <NeedMore allowance={allowance} />
                </p>
              ) : (
                <p className="fine">One request holds up to {maxItems} products. Send the rest as another request.</p>
              )}
            </section>
          )}

          {d.step === 'review' && (
            <section>
              <h2>Review &amp; send</h2>
              <ul className="ord-review">
                {d.items.map((it, i) => {
                  const t = productType(it.productTypeId);
                  const upc = it.upc.trim() ? normalizeUpc(it.upc) : null;
                  const thumb = it.referenceFileIds.find((id) => d.files[id]);
                  return (
                    <li key={i} className="ord-review-item">
                      <div className="ord-review-thumbs">{thumb ? <img src={d.files[thumb]!.url} alt="" /> : <span className="ord-review-n">{i + 1}</span>}</div>
                      <div className="ord-review-text">
                        <b>
                          {count > 1 ? `${i + 1}. ` : ''}
                          {it.name.trim() || 'Unnamed product'}
                        </b>
                        <span>{[it.brand.trim(), t?.label, briefSize(it)].filter(Boolean).join(' · ')}</span>
                        <span>
                          {upc?.ok ? <span className="mono">UPC {formatUpc(upc.code)}</span> : it.barcodeFileId ? 'Barcode photo' : 'No UPC'} · {it.referenceFileIds.length} photo
                          {it.referenceFileIds.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="ord-review-actions">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            update({ step: 'products', open: i });
                            focusItem(i);
                          }}
                          aria-label={`Edit ${it.name.trim() || `product ${i + 1}`}`}
                        >
                          Edit
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="btn ord-add-item" onClick={addItem} disabled={count >= room}>
                + Add a product
              </button>
              {lineMatters && (
                <label className="field ord-line">
                  <span>
                    Line or collection <em>(optional, e.g. “Harbor Shaker”)</em>
                  </span>
                  <input value={d.line} maxLength={60} onChange={(e) => update({ line: e.target.value })} />
                </label>
              )}
              <p className="muted">
                {d.target === 'brand'
                  ? `Delivered models become drafts in ${brands.find((b) => b.id === d.brandId)?.name ?? 'your brand'}, ready for review before they go live.`
                  : d.target === 'contractor'
                    ? 'Delivered models land privately in My catalog, ready to price and place.'
                    : 'Delivered models are private to you: only you can see and place them, and they show in kitchens you share.'}
              </p>
            </section>
          )}

          {error && (
            <div className="auth-error" role="alert">
              {error}
              {allowance?.active && !fits.ok && (
                <>
                  {' '}
                  <NeedMore allowance={allowance} />
                </>
              )}
            </div>
          )}
          {showErrors && firstBad >= 0 && d.step === 'products' && !error && (
            <div className="auth-error" role="alert">
              Product {firstBad + 1}: {itemProblem(d.items[firstBad]!)}
            </div>
          )}

          <div className="ord-form-actions">
            {stepIndex > 0 ? (
              <button type="button" className="btn big" onClick={() => go('products')}>
                Back
              </button>
            ) : (
              <a className="btn big" href={hrefFor({ name: 'orders', rest: '' })}>
                Cancel
              </a>
            )}
            {d.step === 'review' ? (
              <button type="submit" className="btn primary big" disabled={sending || !allowance || !fits.ok} title={!fits.ok && fits.message ? fits.message : undefined}>
                {sending ? 'Sending…' : `Send ${count} product${count === 1 ? '' : 's'} to the studio`}
              </button>
            ) : (
              <button type="submit" className="btn primary big">
                Review {count} product{count === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </form>

        <aside className="ord-card ord-quote" aria-live="polite" aria-label="Your plan’s models">
          <span className="eyebrow">Included in your plan</span>
          {!allowance ? (
            <p className="muted">Checking your models…</p>
          ) : (
            <>
              <ul className="ord-lines">
                <li>
                  <span>
                    {count} custom 3D model{count === 1 ? '' : 's'}
                  </span>
                  <span className="mono">Included</span>
                </li>
                <li>
                  <span>Left this month after this request</span>
                  <span className="mono">
                    {Math.max(0, allowance.left - count)} of {allowance.total}
                  </span>
                </li>
              </ul>
              <p className="ord-due">
                Delivered in about {terms.businessDays} business days. {terms.revisions} revision rounds and up to {terms.finishesPerModel} finishes per model included.
              </p>
              <p className="fine">Your allowance resets on {resetDay(allowance.resetsAt)}; unused models don’t carry over.</p>
            </>
          )}
        </aside>
      </div>
    </OrdersShell>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────

/** "Need more? Contact us": the support address when this server has one. */
function NeedMore({ allowance }: { allowance: Allowance }) {
  if (!allowance.supportEmail) return <span>Need more? Contact BluModel Studio.</span>;
  return (
    <span>
      Need more?{' '}
      <a href={`mailto:${allowance.supportEmail}?subject=${encodeURIComponent('More custom models this month')}`}>Contact us</a>
    </span>
  );
}

/** "2 of 3 models left this month · resets November 15", and what this request uses. */
function AllowanceMeter({ allowance, count }: { allowance: Allowance | null; count: number }) {
  if (!allowance) return <div className="ord-pack-meter">Checking your models…</div>;
  const over = count > allowance.left;
  return (
    <div className={over ? 'ord-pack-meter ord-allowance over' : 'ord-pack-meter ord-allowance'} aria-live="polite">
      <div className="ord-pack-bar" aria-hidden>
        {Array.from({ length: Math.max(allowance.total, 1) }, (_, i) => {
          const usedBefore = allowance.total - allowance.left;
          const cls = i < usedBefore ? 'used' : i < usedBefore + count ? 'on' : '';
          return <span key={i} className={cls} />;
        })}
      </div>
      <p>
        <b>
          {modelsLeftText(allowance)} - resets {resetDay(allowance.resetsAt)}
        </b>
        {allowance.granted > 0 ? ` (includes ${allowance.granted} extra from BluModel)` : ''}.{' '}
        {over
          ? allowance.left > 0
            ? `This request has ${count} products: remove ${count - allowance.left} to send it.`
            : 'You can prepare this request now and send it after the reset.'
          : `This request uses ${count}.`}
        {over && (
          <>
            {' '}
            <NeedMore allowance={allowance} />
          </>
        )}
      </p>
    </div>
  );
}

function TargetPicker({
  value,
  brandId,
  brands,
  show,
  onChange,
}: {
  value: OrderTarget;
  brandId: string;
  brands: { id: string; name: string }[];
  show: boolean;
  onChange: (target: OrderTarget, brandId: string) => void;
}) {
  const v = value === 'brand' ? `brand:${brandId}` : value;
  return (
    <label className="field ord-target">
      <span>Where should the models go?</span>
      <select
        className="ord-select"
        value={v}
        onChange={(e) => {
          const x = e.target.value;
          if (x.startsWith('brand:')) onChange('brand', x.slice(6));
          else onChange(x as OrderTarget, '');
        }}
      >
        <option value="contractor">My catalog (ready to price and place)</option>
        <option value="customer">Just my kitchens (private to me)</option>
        {show &&
          brands.map((b) => (
            <option key={b.id} value={`brand:${b.id}`}>
              My brand: {b.name}
            </option>
          ))}
      </select>
    </label>
  );
}

function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <span id={id} className="ord-field-err" role="alert">
      {message}
    </span>
  );
}

function ProductCard({
  index,
  item,
  open,
  onToggle,
  onChange,
  onRemove,
  files,
  addFiles,
  showErrors,
  serverErrors,
}: {
  index: number;
  item: DraftItem;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<DraftItem>) => void;
  onRemove?: () => void;
  files: Thumbs;
  addFiles: (f: Thumbs) => void;
  showErrors: boolean;
  serverErrors: Partial<Record<string, string>>;
}) {
  const problems = itemProblems(item);
  const errOf = (f: ItemField | 'barcodeFileId' | 'refProductId') => serverErrors[f] ?? (showErrors ? problems[f as ItemField] : undefined) ?? null;
  const hasProblem = Object.keys(problems).length > 0 || Object.values(serverErrors).some(Boolean);
  const t = productType(item.productTypeId);
  const upc = item.upc.trim() ? normalizeUpc(item.upc) : null;
  const n = index + 1;
  const idp = `ord-p${index}`;
  const groups = useMemo(() => CATEGORIES.map((c) => ({ ...c, types: PRODUCT_TYPES.filter((pt) => pt.category === c.id) })).filter((g) => g.types.length), []);
  const summary = [item.brand.trim(), t?.label, upc?.ok ? `UPC ${formatUpc(upc.code)}` : item.barcodeFileId ? 'Barcode photo' : null, `${item.referenceFileIds.length} photo${item.referenceFileIds.length === 1 ? '' : 's'}`]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`ord-product${open ? ' open' : ''}${showErrors && hasProblem ? ' bad' : ''}`}>
      <div className="ord-product-head">
        <button type="button" className="ord-product-toggle" aria-expanded={open} aria-controls={`${idp}-body`} onClick={onToggle}>
          <span className="ord-product-n" aria-hidden>
            {n}
          </span>
          <span className="ord-product-title">
            <b>{item.name.trim() || `Product ${n}`}</b>
            <span>{showErrors && hasProblem ? <span className="ord-bad-inline">Needs a fix</span> : summary}</span>
          </span>
          <span className="ord-product-chev" aria-hidden>
            {open ? '−' : '+'}
          </span>
        </button>
        {onRemove && (
          <button type="button" className="btn ord-product-remove" onClick={onRemove} aria-label={`Remove ${item.name.trim() || `product ${n}`}`}>
            Remove
          </button>
        )}
      </div>

      {open && (
        <div className="ord-product-body" id={`${idp}-body`}>
          <div className="ord-grid-2">
            <label className="field">
              <span>What is it?</span>
              <select
                className="ord-select"
                value={item.productTypeId}
                aria-invalid={!!errOf('productTypeId')}
                aria-describedby={`${idp}-type-err`}
                onChange={(e) => onChange({ productTypeId: e.target.value })}
              >
                <option value="">Choose…</option>
                {groups.map((g) => (
                  <optgroup key={g.id} label={g.label}>
                    {g.types.map((pt) => (
                      <option key={pt.id} value={pt.id}>
                        {pt.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <FieldError id={`${idp}-type-err`} message={errOf('productTypeId')} />
            </label>
            <label className="field">
              <span>Product name</span>
              <input
                value={item.name}
                maxLength={NAME_MAX}
                placeholder="e.g. 36″ dual-fuel range in cream"
                aria-invalid={!!errOf('name')}
                aria-describedby={`${idp}-name-err`}
                onChange={(e) => onChange({ name: e.target.value })}
              />
              <FieldError id={`${idp}-name-err`} message={errOf('name')} />
            </label>
            <label className="field">
              <span>
                Brand <em>(optional)</em>
              </span>
              <input value={item.brand} maxLength={BRAND_MAX} placeholder="e.g. the maker on the box" autoComplete="off" aria-invalid={!!errOf('brand')} aria-describedby={`${idp}-brand-err`} onChange={(e) => onChange({ brand: e.target.value })} />
              <FieldError id={`${idp}-brand-err`} message={errOf('brand')} />
            </label>
            <UpcField item={item} idp={idp} onChange={onChange} files={files} addFiles={addFiles} error={errOf('upc') ?? errOf('barcodeFileId')} />
          </div>

          <fieldset className="ord-fieldset">
            <legend>
              Size <em>(optional: leave it blank if you don’t know; the studio sizes the model from the photos and spec)</em>
            </legend>
            <div className="ord-dims">
              <InchField label="Width" value={item.widthIn} onChange={(widthIn) => onChange({ widthIn })} error={errOf('widthIn')} id={`${idp}-w`} />
              <InchField label="Depth" value={item.depthIn} onChange={(depthIn) => onChange({ depthIn })} error={errOf('depthIn')} id={`${idp}-d`} />
              <InchField label="Height" value={item.heightIn} onChange={(heightIn) => onChange({ heightIn })} error={errOf('heightIn')} id={`${idp}-h`} />
            </div>
            {t && (
              <p className="fine">
                A typical {t.label.toLowerCase()} is {t.defaults.widthIn}″ W × {t.defaults.depthIn}″ D × {t.defaults.heightIn}″ H.
              </p>
            )}
          </fieldset>

          <PhotoDrop item={item} onChange={onChange} files={files} addFiles={addFiles} error={errOf('referenceFileIds') ?? errOf('refProductId')} idp={idp} />

          <label className="field">
            <span>
              Notes <em>(optional: finishes you want, links to the maker’s page, anything the photos don’t show)</em>
            </span>
            <textarea className="ord-textarea" rows={3} maxLength={MAX_NOTES} value={item.notes} aria-invalid={!!errOf('notes')} onChange={(e) => onChange({ notes: e.target.value })} />
          </label>
          <FieldError id={`${idp}-notes-err`} message={errOf('notes')} />
        </div>
      )}
    </div>
  );
}

/** The UPC: typed or pasted (checked as you type), scanned with the camera, or a photo of the barcode. */
function UpcField({
  item,
  idp,
  onChange,
  files,
  addFiles,
  error,
}: {
  item: DraftItem;
  idp: string;
  onChange: (patch: Partial<DraftItem>) => void;
  files: Thumbs;
  addFiles: (f: Thumbs) => void;
  error: string | null;
}) {
  const canScan = useCanScan();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [upErr, setUpErr] = useState<string | null>(null);
  const photo = useRef<HTMLInputElement>(null);
  const live = upcWhileTyping(item.upc);
  const shown = error ?? (live && !live.ok ? live.message : null);

  const takePhoto = async (f: File) => {
    setUpErr(null);
    setNote(null);
    if (!IMAGE_TYPES.includes(f.type)) return setUpErr('Use a PNG, JPEG or WebP photo of the barcode.');
    if (f.size > MAX_IMAGE_BYTES) return setUpErr('That photo is over 8 MB.');
    setBusy(true);
    try {
      const { file } = await ordersApi.uploadFile(f, 'reference', f.name || 'barcode.jpg');
      addFiles({ [file.id]: { url: file.url, name: 'Barcode photo' } });
      onChange({ barcodeFileId: file.id });
      // Where the browser can read barcodes, fill the code in from the photo too.
      const code = item.upc.trim() ? null : await readBarcodeFromImage(f);
      if (code) {
        onChange({ upc: code });
        setNote(`Read ${formatUpc(code)} from the photo.`);
      } else setNote('The studio reads the code from the photo.');
    } catch (e) {
      setUpErr(e instanceof ApiError ? e.message : 'The photo didn’t upload.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field ord-upc">
      <label htmlFor={`${idp}-upc`}>
        UPC or EAN <em>(the number under the barcode)</em>
      </label>
      <div className="ord-upc-row">
        <input
          id={`${idp}-upc`}
          value={item.upc}
          inputMode="numeric"
          autoComplete="off"
          maxLength={20}
          placeholder="e.g. 0 36000 29145 2"
          aria-invalid={!!shown}
          aria-describedby={`${idp}-upc-msg`}
          onChange={(e) => {
            setNote(null);
            onChange({ upc: e.target.value });
          }}
          onBlur={() => {
            // Tidy a good code into its printed grouping.
            const r = item.upc.trim() ? normalizeUpc(item.upc) : null;
            if (r?.ok) onChange({ upc: formatUpc(r.code) });
          }}
        />
        {canScan && (
          <button type="button" className="btn ord-scan-btn" onClick={() => setScanning(true)}>
            Scan
          </button>
        )}
      </div>
      <span id={`${idp}-upc-msg`} className={shown ? 'ord-field-err' : 'ord-upc-ok'} role={shown ? 'alert' : undefined}>
        {/* With a barcode photo, its own box below carries the note. */}
        {shown ?? (live?.ok ? `✓ ${UPC_FORMAT_LABEL[live.format]} ${formatUpc(live.code)}` : item.barcodeFileId ? '' : note ?? '')}
      </span>
      {!item.barcodeFileId ? (
        <button type="button" className="ord-linkish" onClick={() => photo.current?.click()} disabled={busy}>
          {busy ? 'Uploading…' : canScan ? 'Or upload a photo of the barcode' : 'Upload a photo of the barcode'}
        </button>
      ) : (
        <div className="ord-barcode">
          {files[item.barcodeFileId] ? <img src={files[item.barcodeFileId]!.url} alt="Barcode photo" /> : <span className="ord-thumb-missing">Barcode</span>}
          <span className="fine">{note ?? 'Barcode photo added. It stays private to you and the studio.'}</span>
          <button type="button" className="ord-thumb-x" aria-label="Remove the barcode photo" onClick={() => onChange({ barcodeFileId: undefined })}>
            ×
          </button>
        </div>
      )}
      <input
        ref={photo}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        capture="environment"
        hidden
        aria-label="Upload a photo of the barcode"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void takePhoto(f);
        }}
      />
      {upErr && <span className="ord-field-err">{upErr}</span>}
      {scanning && (
        <BarcodeScanDialog
          onCode={(code) => {
            setScanning(false);
            onChange({ upc: formatUpc(code) });
            setNote(`Scanned ${formatUpc(code)}.`);
          }}
          onClose={() => setScanning(false)}
          onFallback={() => {
            setScanning(false);
            photo.current?.click();
          }}
        />
      )}
    </div>
  );
}

function InchField({ label, value, onChange, error, id }: { label: string; value: number | null; onChange: (v: number | null) => void; error: string | null; id: string }) {
  const [raw, setRaw] = useState(value == null ? '' : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setRaw(value == null ? '' : String(value));
    }
  }, [value]);
  const unreadable = raw.trim() !== '' && parseInches(raw) == null;
  const msg = unreadable ? 'Inches, like 33 or 2′ 9″.' : error;
  return (
    <label className="field">
      <span>{label}</span>
      <div className="ord-inch">
        <input
          inputMode="decimal"
          value={raw}
          aria-invalid={!!msg}
          aria-describedby={`${id}-err`}
          onChange={(e) => {
            setRaw(e.target.value);
            const v = parseInches(e.target.value);
            last.current = v;
            onChange(v);
          }}
          aria-label={`${label} in inches`}
        />
        <span aria-hidden>in</span>
      </div>
      <FieldError id={`${id}-err`} message={msg} />
    </label>
  );
}

function PhotoDrop({
  item,
  onChange,
  files,
  addFiles,
  error,
  idp,
}: {
  item: DraftItem;
  onChange: (p: Partial<DraftItem>) => void;
  files: Thumbs;
  addFiles: (f: Thumbs) => void;
  error: string | null;
  idp: string;
}) {
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const ids = useRef(item.referenceFileIds);
  ids.current = item.referenceFileIds;

  const take = async (list: FileList | File[]) => {
    setErr(null);
    const room = MAX_REFERENCES - ids.current.length;
    const picked = [...list].slice(0, Math.max(0, room));
    if (list.length > room) setErr(`Up to ${MAX_REFERENCES} photos per product.`);
    for (const f of picked) {
      if (!IMAGE_TYPES.includes(f.type)) {
        setErr(`${f.name}: use PNG, JPEG or WebP photos.`);
        continue;
      }
      if (f.size > MAX_IMAGE_BYTES) {
        setErr(`${f.name} is over 8 MB.`);
        continue;
      }
      setBusy((x) => x + 1);
      try {
        const { file } = await ordersApi.uploadFile(f, 'reference', f.name);
        addFiles({ [file.id]: { url: file.url, name: f.name } });
        const next = [...new Set([...ids.current, file.id])];
        ids.current = next;
        onChange({ referenceFileIds: next });
      } catch (e) {
        setErr(e instanceof ApiError ? `${f.name}: ${e.message}` : `${f.name} didn’t upload.`);
      } finally {
        setBusy((x) => x - 1);
      }
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void take(e.dataTransfer.files);
  };

  const label: ReactNode = (
    <>
      Photos <em>(up to {MAX_REFERENCES}: front, side, details, the spec-sheet drawing. Private to you and the studio.)</em>
    </>
  );
  return (
    <div className="field ord-photos">
      <span id={`${idp}-photos-label`}>{label}</span>
      <div
        className={over ? 'ord-drop compact over' : 'ord-drop compact'}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        aria-invalid={!!error}
      >
        <button type="button" className="btn" onClick={() => input.current?.click()} disabled={item.referenceFileIds.length >= MAX_REFERENCES} aria-describedby={`${idp}-photos-label`}>
          Add photos
        </button>
        <span className="fine">or drop them here · PNG, JPEG or WebP, up to 8 MB each</span>
        <input
          ref={input}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void take(e.target.files);
            e.target.value = '';
          }}
          aria-label="Choose reference photos"
        />
      </div>
      {busy > 0 && <p className="muted">Uploading {busy} photo{busy === 1 ? '' : 's'}…</p>}
      {err && <span className="ord-field-err">{err}</span>}
      <FieldError id={`${idp}-photos-err`} message={error} />
      {item.referenceFileIds.length > 0 && (
        <ul className="ord-thumbs small">
          {item.referenceFileIds.map((id) => (
            <li key={id}>
              {files[id] ? <img src={files[id]!.url} alt={files[id]!.name} /> : <span className="ord-thumb-missing">Photo</span>}
              <button type="button" className="ord-thumb-x" aria-label={`Remove ${files[id]?.name ?? 'photo'}`} onClick={() => onChange({ referenceFileIds: item.referenceFileIds.filter((x) => x !== id) })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {item.refProductId && item.referenceFileIds.length === 0 && <p className="fine">Photos are optional when you start from a catalog product, but they help the studio match it.</p>}
    </div>
  );
}
