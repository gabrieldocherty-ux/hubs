import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { AgreeToPay } from '../../components/PaymentNotice';
import { usePayments } from '../../lib/config';
import { isPaymentsUnavailable, markCheckout, PAYMENTS_SOON } from '../../lib/payments';
import { hrefFor, navigate, useHashQuery } from '../../lib/router';
import { useSession } from '../../store/useSession';
import { getProduct, CATEGORIES } from '../../data/catalog';
import { PRODUCT_TYPES, productType, productTypeFor } from '../../data/productTypes';
import type { Product } from '../../types';
import type { ModelTierId } from '../../types/platform';
import { goToCheckout, ordersApi, type OrderRequest, type OrderTarget, type QuoteWire, type TiersWire } from './api';
import { dollars, MAX_NOTES, MAX_REFERENCES, NAME_MAX, parseInches, stepProblem, STEPS, suggestedTier, type DraftItem, type Step } from './model';
import { OrdersPayNote, OrdersShell } from './parts';

const DRAFT_KEY = 'blumodel.orders.request';
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

interface Draft {
  target: OrderTarget;
  brandId: string;
  line: string;
  rush: boolean;
  items: DraftItem[];
  cur: number;
  step: Step;
  /** Thumbnails of uploaded reference photos, by file id. */
  files: Record<string, { url: string; name: string }>;
}

const blankItem = (from?: Partial<DraftItem>): DraftItem => ({
  productTypeId: '',
  name: '',
  widthIn: null,
  depthIn: null,
  heightIn: null,
  notes: '',
  referenceFileIds: [],
  tier: null,
  extraFinishes: 0,
  ...from,
});

function loadDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    const d = raw ? (JSON.parse(raw) as Draft) : null;
    return d && Array.isArray(d.items) && d.items.length ? d : null;
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

/** An item prefilled from a catalog product (`?ref=`): its type, name and size. */
function itemFromProduct(p: Product): DraftItem {
  const t = productTypeFor(p.kind, p.variant);
  return blankItem({
    productTypeId: t?.id ?? '',
    name: p.name.slice(0, NAME_MAX),
    widthIn: p.widthIn,
    depthIn: p.depthIn,
    heightIn: p.heightIn,
    refProductId: p.id,
    tier: suggestedTier(p.kind),
  });
}

/**
 * `#/orders/new?ref=&brand=&target=` (PRODUCT_SPEC §7.3): what, size, photos, notes, tier and
 * extras with the live server quote, then review & pay. One request may hold up to 20 products of
 * the same line (§13.3), each priced per item, with one checkout.
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
  const isContractor = user?.plan?.id === 'contractor';

  const initial = (): Draft => {
    const saved = refId || askedBrand || askedTarget ? null : loadDraft();
    if (saved) return saved;
    let target: OrderTarget = 'customer';
    let brandId = '';
    if (askedBrand && brands.some((b) => b.id === askedBrand)) {
      target = 'brand';
      brandId = askedBrand;
    } else if (askedTarget === 'contractor' && isContractor) target = 'contractor';
    const ref = refId ? getProduct(refId) : undefined;
    const item = ref && ref.source !== 'missing' ? itemFromProduct(ref) : blankItem();
    return { target, brandId, line: '', rush: false, items: [item], cur: 0, step: 'what', files: {} };
  };

  const [d, setD] = useState<Draft>(initial);
  const [tiers, setTiers] = useState<TiersWire | null>(null);
  const [quote, setQuote] = useState<QuoteWire | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [paying, setPaying] = useState(false);
  const [refProduct, setRefProduct] = useState<Product | null>(() => (refId ? getProduct(refId) ?? null : null));

  const item = d.items[d.cur] ?? d.items[0]!;
  const update = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const updateItem = (patch: Partial<DraftItem>) => setD((x) => ({ ...x, items: x.items.map((it, i) => (i === x.cur ? { ...it, ...patch } : it)) }));

  useEffect(() => saveDraft(d), [d]);

  useEffect(() => {
    ordersApi
      .tiers()
      .then(setTiers)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the model tiers.'));
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

  // The live quote: the server prices every item; nothing here computes a price.
  const quoteKey = JSON.stringify({ rush: d.rush, items: d.items.filter((it) => it.tier).map((it) => [it.tier, it.extraFinishes, it.name.trim()]) });
  useEffect(() => {
    const priced = d.items.filter((it) => it.tier);
    if (!priced.length) {
      setQuote(null);
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      ordersApi
        .quote({ rush: d.rush, items: priced.map((it) => ({ tier: it.tier as ModelTierId, extraFinishes: it.extraFinishes, name: it.name.trim() || undefined })) }, ctl.signal)
        .then((r) => {
          setQuote(r.quote);
          setQuoteError(null);
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          setQuoteError(e instanceof ApiError ? e.message : 'Couldn’t get a price.');
        });
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  const payments = usePayments();
  const demo = payments === 'demo';
  /** Payments aren't open: the request can be filled in and priced, not paid for. */
  const soon = payments === 'none';

  const stepIndex = STEPS.findIndex((s) => s.id === d.step);
  const problem = stepProblem(item, d.step);
  const firstBad = (it: DraftItem) => STEPS.find((s) => s.id !== 'review' && stepProblem(it, s.id))?.id ?? null;

  const go = (step: Step) => {
    setTouched(false);
    setError(null);
    update({ step });
    window.scrollTo?.({ top: 0 });
  };
  const next = () => {
    if (problem) {
      setTouched(true);
      return;
    }
    if (stepIndex < STEPS.length - 1) go(STEPS[stepIndex + 1]!.id);
  };
  const back = () => stepIndex > 0 && go(STEPS[stepIndex - 1]!.id);

  const addItem = () => {
    if (tiers && d.items.length >= tiers.maxItems) return;
    setD((x) => ({ ...x, items: [...x.items, blankItem({ productTypeId: item.productTypeId, tier: item.tier })], cur: x.items.length, step: 'what' }));
    setTouched(false);
  };
  const editItem = (i: number, step: Step = 'what') => {
    setD((x) => ({ ...x, cur: i, step }));
    setTouched(false);
  };
  const removeItem = (i: number) => setD((x) => (x.items.length < 2 ? x : { ...x, items: x.items.filter((_, j) => j !== i), cur: 0 }));

  const pay = async () => {
    const badIdx = d.items.findIndex((it) => firstBad(it));
    if (badIdx >= 0) {
      editItem(badIdx, firstBad(d.items[badIdx]!)!);
      setTouched(true);
      return;
    }
    if (soon) {
      setError(PAYMENTS_SOON);
      return;
    }
    setPaying(true);
    setError(null);
    const body: OrderRequest = {
      target: d.target,
      ...(d.target === 'brand' ? { brandId: d.brandId } : {}),
      ...(d.line.trim() ? { line: d.line.trim() } : {}),
      rush: d.rush,
      items: d.items.map((it) => {
        const t = productType(it.productTypeId);
        return {
          tier: it.tier as ModelTierId,
          extraFinishes: it.extraFinishes,
          brief: {
            productTypeId: it.productTypeId,
            kind: t?.kind,
            ...(t?.variant ? { variant: t.variant } : {}),
            name: it.name.trim(),
            widthIn: it.widthIn!,
            depthIn: it.depthIn!,
            heightIn: it.heightIn!,
            ...(t && t.defaults.elevationIn > 0 ? { elevationIn: t.defaults.elevationIn } : {}),
            notes: it.notes.trim(),
            referenceFileIds: it.referenceFileIds,
            ...(it.refProductId ? { refProductId: it.refProductId } : {}),
          },
        };
      }),
    };
    let orderId: string | null = null;
    try {
      orderId = (await ordersApi.create(body)).order.id;
      saveDraft(null);
      const { url } = await ordersApi.checkout(orderId);
      markCheckout('order', hrefFor({ name: 'orders', rest: orderId }));
      goToCheckout(url);
    } catch (e) {
      setPaying(false);
      if (orderId) {
        // The order exists; its page can retry the payment.
        navigate({ name: 'orders', rest: orderId }, true);
        return;
      }
      const msg = isPaymentsUnavailable(e) ? PAYMENTS_SOON : e instanceof ApiError ? e.message : 'Could not send the request.';
      const field = e instanceof ApiError ? (e.body as { errors?: { field: string; message: string }[] } | undefined)?.errors?.[0] : undefined;
      setError(field ? `${field.message}` : msg);
      const m = field?.field.match(/^items\[(\d+)\]\.(?:brief\.)?(\w+)/);
      if (m) {
        const k = m[2]!;
        const step: Step = k === 'tier' || k === 'extraFinishes' ? 'tier' : k === 'referenceFileIds' || k === 'refProductId' ? 'photos' : k === 'notes' ? 'notes' : /In$/.test(k) ? 'size' : 'what';
        editItem(Number(m[1]), step);
      }
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (d.step === 'review') void pay();
    else next();
  };

  const showTarget = brands.length > 0 || isContractor;
  const lineMatters = d.target !== 'customer' || d.items.length > 1;

  return (
    <OrdersShell wide>
      <div className="ord-head">
        <div>
          <span className="eyebrow">Custom 3D model</span>
          <h1>Request a model</h1>
          <p className="muted">The BluModel 3D studio models it to real scale with 2 revision rounds. Prices come from the tier you pick.</p>
        </div>
      </div>
      <OrdersPayNote payments={payments} />
      {askedTarget === 'contractor' && !isContractor && (
        <div className="auth-note">
          Modelling straight into My catalog is part of the Contractor plan. <a href={hrefFor({ name: 'pro', rest: '' })}>See the Contractor plan</a>, or request a model for your own kitchens below.
        </div>
      )}

      <ol className="ord-steps" aria-label="Steps">
        {STEPS.map((s, i) => {
          const reachable = i <= stepIndex || STEPS.slice(0, i).every((p) => p.id === 'review' || !stepProblem(item, p.id));
          return (
            <li key={s.id}>
              <button type="button" className={s.id === d.step ? 'ord-step on' : 'ord-step'} aria-current={s.id === d.step ? 'step' : undefined} disabled={!reachable} onClick={() => go(s.id)}>
                <span className="ord-step-n">{i + 1}</span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="ord-wizard">
        <form className="ord-card ord-form" onSubmit={onSubmit} noValidate>
          {d.items.length > 1 && d.step !== 'review' && (
            <div className="ord-item-tabs" role="group" aria-label="Products in this request">
              {d.items.map((it, i) => (
                <button key={i} type="button" className={i === d.cur ? 'chip on' : 'chip'} aria-pressed={i === d.cur} onClick={() => editItem(i, d.step)}>
                  {i + 1}. {it.name.trim() || 'New product'}
                </button>
              ))}
            </div>
          )}

          {d.step === 'what' && (
            <WhatStep
              item={item}
              updateItem={updateItem}
              refProduct={refProduct && item.refProductId === refProduct.id ? refProduct : null}
              target={showTarget && d.cur === 0 ? { value: d.target, brandId: d.brandId, brands, isContractor, onChange: (target, brandId) => update({ target, brandId }) } : null}
            />
          )}
          {d.step === 'size' && <SizeStep item={item} updateItem={updateItem} />}
          {d.step === 'photos' && <PhotosStep item={item} updateItem={updateItem} files={d.files} addFiles={(f) => setD((x) => ({ ...x, files: { ...x.files, ...f } }))} />}
          {d.step === 'notes' && (
            <section>
              <h2>Notes for the studio</h2>
              <p className="muted">Materials, finishes, anything the photos don’t show, and links to the manufacturer’s page.</p>
              <label className="field">
                <span>
                  Notes <em>(optional)</em>
                </span>
                <textarea className="ord-textarea" rows={8} maxLength={MAX_NOTES} value={item.notes} onChange={(e) => updateItem({ notes: e.target.value })} />
              </label>
              <p className="ord-count mono">
                {item.notes.length.toLocaleString('en-US')} / {MAX_NOTES.toLocaleString('en-US')}
              </p>
            </section>
          )}
          {d.step === 'tier' && <TierStep item={item} updateItem={updateItem} tiers={tiers} rush={d.rush} setRush={(rush) => update({ rush })} />}
          {d.step === 'review' && (
            <section>
              <h2>Review &amp; pay</h2>
              <ul className="ord-review">
                {d.items.map((it, i) => {
                  const t = productType(it.productTypeId);
                  const bad = firstBad(it);
                  return (
                    <li key={i} className={bad ? 'ord-review-item bad' : 'ord-review-item'}>
                      <div className="ord-review-thumbs">
                        {it.referenceFileIds.slice(0, 3).map((id) => (d.files[id] ? <img key={id} src={d.files[id]!.url} alt="" /> : null))}
                      </div>
                      <div className="ord-review-text">
                        <b>
                          {d.items.length > 1 ? `${i + 1}. ` : ''}
                          {it.name.trim() || 'Unnamed product'}
                        </b>
                        <span>
                          {t?.label ?? 'No type'} · {it.widthIn ?? '?'}″ W × {it.depthIn ?? '?'}″ D × {it.heightIn ?? '?'}″ H
                        </span>
                        <span>
                          {it.tier ? `${tiers?.tiers.find((x) => x.id === it.tier)?.name ?? it.tier} tier` : 'No tier'}
                          {it.extraFinishes ? ` · ${it.extraFinishes} extra finish${it.extraFinishes === 1 ? '' : 'es'}` : ''} · {it.referenceFileIds.length} photo
                          {it.referenceFileIds.length === 1 ? '' : 's'}
                        </span>
                        {bad && <span className="ord-bad">{stepProblem(it, bad)}</span>}
                      </div>
                      <div className="ord-review-actions">
                        <button type="button" className="btn" onClick={() => editItem(i, bad ?? 'what')}>
                          Edit
                        </button>
                        {d.items.length > 1 && (
                          <button type="button" className="btn" onClick={() => removeItem(i)} aria-label={`Remove ${it.name || `product ${i + 1}`}`}>
                            Remove
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {tiers && d.items.length < tiers.maxItems && (
                <button type="button" className="btn ord-add-item" onClick={addItem}>
                  + Add another product{lineMatters ? ' from this line' : ''}
                </button>
              )}
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

          {error && <div className="auth-error" role="alert">{error}</div>}
          {touched && problem && d.step !== 'review' && (
            <div className="auth-error" role="alert">
              {problem}
            </div>
          )}

          <div className="ord-form-actions">
            {stepIndex > 0 ? (
              <button type="button" className="btn big" onClick={back}>
                Back
              </button>
            ) : (
              <a className="btn big" href={hrefFor({ name: 'orders', rest: '' })}>
                Cancel
              </a>
            )}
            {d.step === 'review' ? (
              <button type="submit" className="btn primary big" disabled={paying || !quote || soon} title={soon ? 'Payments aren’t open yet' : undefined}>
                {soon ? 'Payments open soon' : paying ? 'Starting checkout…' : quote ? `Pay ${dollars(quote.amountCents)}${demo ? ' (demo)' : ''}` : 'Pay'}
              </button>
            ) : (
              <button type="submit" className="btn primary big">
                Next
              </button>
            )}
          </div>
          {d.step === 'review' && !soon && <AgreeToPay className="ord-agree" />}
        </form>

        <aside className="ord-card ord-quote" aria-live="polite" aria-label="Price">
          <span className="eyebrow">Your quote{demo ? ' · demo payments' : ''}</span>
          {!quote ? (
            <p className="muted">Pick a tier to see the price.</p>
          ) : (
            <>
              <ul className="ord-lines">
                {quote.lines.map((l, i) => (
                  <li key={i}>
                    <span>{l.label}</span>
                    <span className="mono">{dollars(l.amountCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="ord-total">
                <span>Total</span>
                <b className="mono">{dollars(quote.amountCents)}</b>
              </div>
              <p className="ord-due">
                Delivered in about {quote.dueBusinessDays} business days after payment{d.rush ? ' (rush)' : ''}. 2 revision rounds included.
              </p>
            </>
          )}
          {quoteError && <p className="ord-bad">{quoteError}</p>}
          <p className="fine">
            Prices are set by BluModel Studio’s servers from the tier and extras.
            {demo ? ' Demo payments: no money moves.' : soon ? ' Payments open soon.' : ' You pay on Stripe’s secure page; BluModel Studio never sees card details.'}
          </p>
        </aside>
      </div>
    </OrdersShell>
  );
}

// ─── Steps ──────────────────────────────────────────────────────────────

interface TargetPicker {
  value: OrderTarget;
  brandId: string;
  brands: { id: string; name: string }[];
  isContractor: boolean;
  onChange: (target: OrderTarget, brandId: string) => void;
}

function WhatStep({
  item,
  updateItem,
  refProduct,
  target,
}: {
  item: DraftItem;
  updateItem: (p: Partial<DraftItem>) => void;
  refProduct: Product | null;
  target: TargetPicker | null;
}) {
  const groups = useMemo(
    () => CATEGORIES.map((c) => ({ ...c, types: PRODUCT_TYPES.filter((t) => t.category === c.id) })).filter((g) => g.types.length),
    [],
  );
  const setType = (id: string) => {
    const t = productType(id);
    const prev = productType(item.productTypeId);
    // Sizes follow the type until the buyer types their own.
    const untouched = !prev || (item.widthIn === prev.defaults.widthIn && item.depthIn === prev.defaults.depthIn && item.heightIn === prev.defaults.heightIn) || item.widthIn == null;
    updateItem({
      productTypeId: id,
      ...(t && untouched && !item.refProductId ? { widthIn: t.defaults.widthIn, depthIn: t.defaults.depthIn, heightIn: t.defaults.heightIn } : {}),
      ...(t && !item.tier ? { tier: suggestedTier(t.kind) } : {}),
    });
  };

  const targetValue = target ? (target.value === 'brand' ? `brand:${target.brandId}` : target.value) : 'customer';
  return (
    <section>
      <h2>What should we model?</h2>
      {target && (
        <label className="field">
          <span>Who is it for?</span>
          <select
            className="ord-select"
            value={targetValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith('brand:')) target.onChange('brand', v.slice(6));
              else target.onChange(v as OrderTarget, '');
            }}
          >
            <option value="customer">My kitchens (private to me)</option>
            {target.isContractor && <option value="contractor">My catalog (Contractor)</option>}
            {target.brands.map((b) => (
              <option key={b.id} value={`brand:${b.id}`}>
                My brand: {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {refProduct && (
        <div className="ord-ref">
          {refProduct.thumbnailUrl && <img src={refProduct.thumbnailUrl} alt="" />}
          <div>
            <span className="mini-label">Starting from</span>
            <b>{refProduct.name}</b>
            <span className="muted"> · {refProduct.brand}</span>
          </div>
          <button type="button" className="btn" onClick={() => updateItem({ refProductId: undefined })}>
            Don’t use it
          </button>
        </div>
      )}
      <label className="field">
        <span>Product type</span>
        <select className="ord-select" value={item.productTypeId} onChange={(e) => setType(e.target.value)}>
          <option value="">Choose…</option>
          {groups.map((g) => (
            <optgroup key={g.id} label={g.label}>
              {g.types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Product name</span>
        <input value={item.name} maxLength={NAME_MAX} placeholder="e.g. 36″ dual-fuel range in cream" onChange={(e) => updateItem({ name: e.target.value })} />
      </label>
    </section>
  );
}

function InchField({ label, value, onChange, hint }: { label: string; value: number | null; onChange: (v: number | null) => void; hint?: string }) {
  const [raw, setRaw] = useState(value == null ? '' : String(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setRaw(value == null ? '' : String(value));
    }
  }, [value]);
  return (
    <label className="field">
      <span>
        {label} {hint && <em>{hint}</em>}
      </span>
      <div className="ord-inch">
        <input
          inputMode="decimal"
          value={raw}
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
    </label>
  );
}

function SizeStep({ item, updateItem }: { item: DraftItem; updateItem: (p: Partial<DraftItem>) => void }) {
  const t = productType(item.productTypeId);
  return (
    <section>
      <h2>How big is it?</h2>
      <p className="muted">Measure the real product, or copy the spec sheet. Inches, or feet and inches like 2′ 9″. The model is built to this size.</p>
      <div className="ord-dims">
        <InchField label="Width" value={item.widthIn} onChange={(widthIn) => updateItem({ widthIn })} />
        <InchField label="Depth" value={item.depthIn} onChange={(depthIn) => updateItem({ depthIn })} />
        <InchField label="Height" value={item.heightIn} onChange={(heightIn) => updateItem({ heightIn })} />
      </div>
      {t && (
        <p className="fine">
          A typical {t.label.toLowerCase()} is {t.defaults.widthIn}″ W × {t.defaults.depthIn}″ D × {t.defaults.heightIn}″ H
          {t.defaults.elevationIn > 0 ? `, mounted ${t.defaults.elevationIn}″ off the floor` : ''}.
        </p>
      )}
    </section>
  );
}

function PhotosStep({
  item,
  updateItem,
  files,
  addFiles,
}: {
  item: DraftItem;
  updateItem: (p: Partial<DraftItem>) => void;
  files: Record<string, { url: string; name: string }>;
  addFiles: (f: Record<string, { url: string; name: string }>) => void;
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
      setBusy((n) => n + 1);
      try {
        const { file } = await ordersApi.uploadFile(f, 'reference', f.name);
        addFiles({ [file.id]: { url: file.url, name: f.name } });
        const next = [...new Set([...ids.current, file.id])];
        ids.current = next;
        updateItem({ referenceFileIds: next });
      } catch (e) {
        setErr(e instanceof ApiError ? `${f.name}: ${e.message}` : `${f.name} didn’t upload.`);
      } finally {
        setBusy((n) => n - 1);
      }
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void take(e.dataTransfer.files);
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void take(e.target.files);
    e.target.value = '';
  };

  return (
    <section>
      <h2>Reference photos</h2>
      <p className="muted">1 to 8 photos: front, side, details and the spec-sheet drawing if you have one. They stay private to you and the BluModel 3D studio.</p>
      <div
        className={over ? 'ord-drop over' : 'ord-drop'}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <p>
          <b>Drop photos here</b> or
        </p>
        <button type="button" className="btn" onClick={() => input.current?.click()} disabled={item.referenceFileIds.length >= MAX_REFERENCES}>
          Choose photos
        </button>
        <input ref={input} type="file" accept={IMAGE_TYPES.join(',')} multiple hidden onChange={onPick} aria-label="Choose reference photos" />
        <span className="fine">PNG, JPEG or WebP, up to 8 MB each.</span>
      </div>
      {busy > 0 && <p className="muted">Uploading {busy} photo{busy === 1 ? '' : 's'}…</p>}
      {err && <div className="auth-error">{err}</div>}
      {item.referenceFileIds.length > 0 && (
        <ul className="ord-thumbs">
          {item.referenceFileIds.map((id) => (
            <li key={id}>
              {files[id] ? <img src={files[id]!.url} alt={files[id]!.name} /> : <span className="ord-thumb-missing">Photo</span>}
              <button type="button" className="ord-thumb-x" aria-label={`Remove ${files[id]?.name ?? 'photo'}`} onClick={() => updateItem({ referenceFileIds: item.referenceFileIds.filter((x) => x !== id) })}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {item.refProductId && item.referenceFileIds.length === 0 && <p className="fine">Photos are optional when you start from a catalog product, but they help the studio match it.</p>}
    </section>
  );
}

function TierStep({
  item,
  updateItem,
  tiers,
  rush,
  setRush,
}: {
  item: DraftItem;
  updateItem: (p: Partial<DraftItem>) => void;
  tiers: TiersWire | null;
  rush: boolean;
  setRush: (v: boolean) => void;
}) {
  if (!tiers) return <p className="muted">Loading the tiers…</p>;
  return (
    <section>
      <h2>Tier and extras</h2>
      <div className="ord-tiers" role="radiogroup" aria-label="Model tier">
        {tiers.tiers.map((t) => {
          const on = item.tier === t.id;
          return (
            <button key={t.id} type="button" role="radio" aria-checked={on} className={on ? 'ord-tier on' : 'ord-tier'} onClick={() => updateItem({ tier: t.id })}>
              <span className="ord-tier-name">
                {t.name}
                {on && <span className="ord-tier-check"> · selected</span>}
              </span>
              <b className="ord-tier-price">{dollars(t.priceCents)}</b>
              <span className="ord-tier-days">{t.businessDays} business days</span>
              <span className="ord-tier-for">{t.for}</span>
            </button>
          );
        })}
      </div>
      <div className="ord-extras">
        <div className="ord-extra">
          <div>
            <b>Extra finishes</b>
            <p className="fine">
              {tiers.includedFinishes} finishes are included. Each extra one is {dollars(tiers.extraFinishCents)}.
            </p>
          </div>
          <div className="ord-stepper">
            <button type="button" className="btn" aria-label="One fewer extra finish" disabled={item.extraFinishes <= 0} onClick={() => updateItem({ extraFinishes: item.extraFinishes - 1 })}>
              −
            </button>
            <span className="mono" aria-live="polite" aria-label="Extra finishes">
              {item.extraFinishes}
            </span>
            <button
              type="button"
              className="btn"
              aria-label="One more extra finish"
              disabled={item.extraFinishes >= tiers.maxExtraFinishes}
              onClick={() => updateItem({ extraFinishes: item.extraFinishes + 1 })}
            >
              +
            </button>
          </div>
        </div>
        <label className="ord-extra ord-rush">
          <div>
            <b>Rush</b>
            <p className="fine">
              +{tiers.rushPct}% for half the turnaround{' '}
              <em>(applies to every product in this request)</em>.
            </p>
          </div>
          <input type="checkbox" checked={rush} onChange={(e) => setRush(e.target.checked)} />
        </label>
      </div>
    </section>
  );
}
