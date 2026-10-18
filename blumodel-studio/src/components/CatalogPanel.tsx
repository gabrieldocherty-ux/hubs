import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { CATEGORIES, getProduct, isBuiltin, priceFor } from '../data/catalog';
import type { CategoryId, Product, Surfaces } from '../types';
import { useDesignStore } from '../store/useDesignStore';
import { useCatalog } from '../store/useCatalog';
import { useSession } from '../store/useSession';
import { findDropTarget, placeAt, usePlacement, type ViewId } from '../lib/interaction';
import { ProductArt } from './ProductArt';
import { Info, Plus, Search } from './Icons';
import { money } from '../lib/format';
import { finishList } from '../lib/finish';
import { hrefFor } from '../lib/router';
import { useContractorCatalog, useKitchenPriceOf } from '../features/contractors';
import { filterToPrefs, hasBrandPrefs, prefName } from '../lib/generate/brands';
import { useShowroom } from '../features/showroom';
import { BASICS_BRAND } from '../data/builtins';
import { loadRetail, retailOf, retailPriceKnown, storesOf, useRetail } from '../catalog/retail';
import '../catalog/retail.css';

const ALL = 'all';

interface Facet {
  id: string;
  label: string;
  n: number;
}

/** Brand facets with product counts: BluModel Basics first, then every other brand A–Z. On a showroom, the company's lines. */
const byBrand = (p: Product) => p.brand;

function brandFacets(list: Product[], nameOf: (p: Product) => string = byBrand, basicsLast = false): Facet[] {
  const n = new Map<string, number>();
  for (const p of list) n.set(nameOf(p), (n.get(nameOf(p)) ?? 0) + 1);
  // On a showroom the company's lines lead and BluModel Basics (only filling the gaps) comes last.
  const first = basicsLast ? 1 : -1;
  return [...n]
    .map(([id, count]) => ({ id, label: id, n: count }))
    .sort((a, b) => (a.id === BASICS_BRAND ? first : b.id === BASICS_BRAND ? -first : a.label.localeCompare(b.label)));
}

/** Store facets: the real-retailer stores the listed products are sold at, most products first. */
function storeFacets(list: Product[], names: Map<string, { name: string }>): Facet[] {
  const n = new Map<string, number>();
  for (const p of list) for (const s of storesOf(retailOf(p.id))) n.set(s, (n.get(s) ?? 0) + 1);
  return [...n].map(([id, count]) => ({ id, label: names.get(id)?.name ?? id, n: count })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

/** A card's store chips: "at [RONA]", "at [RONA] [+2]" (the full list is in the label and on the product page). */
function StoreChips({ slugs, names }: { slugs: string[]; names: Map<string, { name: string }> }) {
  const label = (s: string) => names.get(s)?.name ?? s;
  const all = slugs.map(label);
  return (
    <span className="product-stores" title={`Sold at ${all.join(', ')}`}>
      <span>at</span>
      <span className="store-chip">{all[0]}</span>
      {all.length > 1 && <span className="store-chip more" aria-label={`and ${all.slice(1).join(', ')}`}>+{all.length - 1}</span>}
    </span>
  );
}

import { CATALOG_DRAG_CLASS, isCompact, useCompact, useMobileUI } from './MobileState';

/*
 * Catalog → room by pointer, so the same gesture works with a mouse, a finger or a pen
 * (HTML5 drag-and-drop never fires on touch screens).
 *
 *   mouse  press a card and move a few pixels: the drag starts.
 *   touch  the list must still scroll, so a drag starts only after a short hold
 *          (HOLD_MS) or a clearly sideways pull; a mostly vertical move is a scroll
 *          and is left to the browser.
 *
 * Tap or hold is decided by the events' own timestamps, not by which runs first, the hold
 * timer or the event handler. On a busy page (a slow phone drawing the 3D view) both can be
 * queued behind one long frame: the timer would then turn a quick tap into an empty drag
 * (the card never arms), and a held finger's first move would be taken for a scroll.
 *
 * A ghost follows the pointer. Releasing over a registered view (findDropTarget: the
 * plan, the 3D floor) places the product there with placeAt, snapped like a drag and
 * selected. Releasing anywhere else, or Escape, cancels.
 */

const HOLD_MS = 280;
const MOUSE_SLOP = 5;
const TOUCH_SLOP = 8;

interface Ghost {
  productId: string | null;
  x: number;
  y: number;
  over: ViewId | null;
  touch: boolean;
}

const useGhost = create<Ghost>()(() => ({ productId: null, x: 0, y: 0, over: null, touch: false }));

/** True from the moment a press turns into a drag until it ends; the touchmove guard reads it. */
let dragActive = false;
/** One press at a time (a second finger on another card is ignored). */
let pressing = false;
/** The browser may still deliver a click to the card after a drag; it must not also add the product. */
let swallowClickUntil = 0;

/** `onTap`: what a tap on the card does (the card's click handler, minus the after-a-drag check). */
function pressProduct(e: ReactPointerEvent<HTMLElement>, product: Product, catalogEl: HTMLElement | null, onTap: () => void) {
  if (pressing || dragActive) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const touchLike = e.pointerType !== 'mouse';
  const pid = e.pointerId;
  const x0 = e.clientX;
  const y0 = e.clientY;
  const t0 = e.nativeEvent.timeStamp;
  /** Whether the press had lasted HOLD_MS when an event happened (its timestamp, not now). */
  const heldAt = (ev: Event) => ev.timeStamp - t0 >= HOLD_MS;
  let x = x0;
  let y = y0;
  let dragging = false;
  let overEl: HTMLElement | null = null;
  pressing = true;

  const track = () => {
    const hit = findDropTarget(x, y);
    const el = hit?.el ?? null;
    if (el !== overEl) {
      overEl?.classList.remove('is-drop-over');
      el?.classList.add('is-drop-over');
      overEl = el;
    }
    useGhost.setState({ x, y, over: hit?.id ?? null });
  };

  const begin = () => {
    if (dragging) return;
    dragging = true;
    dragActive = true;
    window.clearTimeout(hold);
    document.body.classList.add(CATALOG_DRAG_CLASS);
    useGhost.setState({ productId: product.id, touch: touchLike });
    track();
    if (touchLike) navigator.vibrate?.(10);
  };

  const hold = touchLike ? window.setTimeout(begin, HOLD_MS) : 0;

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== pid) return;
    x = ev.clientX;
    y = ev.clientY;
    if (dragging) {
      track();
      return;
    }
    const dx = x - x0;
    const dy = y - y0;
    const dist = Math.hypot(dx, dy);
    if (!touchLike) {
      if (dist > MOUSE_SLOP) begin();
      return;
    }
    if (dist <= TOUCH_SLOP) return;
    // Held long enough before it moved (the hold timer just hasn't run yet), or pulled sideways.
    if (heldAt(ev) || Math.abs(dx) > Math.abs(dy) * 1.2) begin();
    else finish(false); // a scroll: the browser takes it from here
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pid) return;
    x = ev.clientX;
    y = ev.clientY;
    // A quick tap the late hold timer turned into a drag: it is still a tap (adds or arms the product).
    if (touchLike && dragging && !heldAt(ev) && Math.hypot(x - x0, y - y0) <= TOUCH_SLOP) {
      finish(false, true);
      return;
    }
    finish(true);
  };
  const onCancel = (ev: PointerEvent) => {
    if (ev.pointerId === pid) finish(false);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape' || !dragging) return;
    ev.preventDefault();
    ev.stopPropagation();
    finish(false);
  };
  // A long press opens the context menu on touch screens; a held card is a drag instead.
  const onContext = (ev: Event) => ev.preventDefault();

  /**
   * Ends the press. `drop`: place the product if released over a view. `tap`: it was a tap
   * after all; do what a tap on the card does here rather than trust the browser's click,
   * which may land elsewhere (the sheet had started sliding away for the drag).
   */
  function finish(drop: boolean, tap = false) {
    window.clearTimeout(hold);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('contextmenu', onContext, true);
    pressing = false;
    if (!dragging) return;
    dragging = false;
    dragActive = false;
    swallowClickUntil = performance.now() + 450;
    overEl?.classList.remove('is-drop-over');
    overEl = null;
    document.body.classList.remove(CATALOG_DRAG_CLASS);
    useGhost.setState({ productId: null, over: null });
    if (tap) onTap();
    if (!drop) return;
    const hit = findDropTarget(x, y);
    if (hit) {
      const id = placeAt(product.id, hit.point.x, hit.point.y);
      if (id && isCompact()) useMobileUI.getState().closeSheet();
      return;
    }
    const r = catalogEl?.getBoundingClientRect();
    const overCatalog = !!r && x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    if (!overCatalog && Math.hypot(x - x0, y - y0) > 60) {
      useDesignStore.getState().toast(`Drop ${product.name} on the plan or the 3D floor to add it.`, 'info');
    }
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('contextmenu', onContext, true);
}

const GhostArt = memo(function GhostArt({ product, surfaces }: { product: Product; surfaces: Surfaces }) {
  return <ProductArt product={product} surfaces={surfaces} />;
});

/** The card that follows the pointer while a product is dragged out of the catalog. */
function DragGhost() {
  const g = useGhost();
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const product = g.productId ? getProduct(g.productId) : undefined;
  if (!product) return null;
  return createPortal(
    <div
      className={`drag-ghost${g.touch ? ' touch' : ''}${g.over ? ' over' : ''}`}
      style={{ transform: `translate3d(${Math.round(g.x)}px, ${Math.round(g.y)}px, 0)` }}
      aria-hidden
    >
      <span className="drag-ghost-pin" />
      <span className="drag-ghost-card">
        <span className="drag-ghost-art">
          <GhostArt product={product} surfaces={surfaces} />
        </span>
        <span className="drag-ghost-text">
          <b>{product.name}</b>
          <span>{g.over ? 'Release to place' : g.touch ? 'Drag onto the plan' : 'Drop on the plan or 3D floor'}</span>
        </span>
      </span>
    </div>,
    document.body,
  );
}

export function CatalogPanel() {
  // Custom models come with the Contractor plan (the server refuses anyone else).
  const canRequestModel = useSession((s) => s.user?.plan.id === 'contractor');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<CategoryId | typeof ALL>(ALL);
  const [brand, setBrand] = useState<string>(ALL);
  // "Your brands": on by default when the kitchen was set up with preferred brands (setup wizard).
  const [mine, setMine] = useState(true);
  const brandPrefs = useDesignStore((s) => s.doc.brandPrefs);
  // A contractor sees their own catalog first and only the brands they carry (§4.3).
  const all = useContractorCatalog(useCatalog((s) => s.products));
  // On a company's showroom: its own products only, plus BluModel Basics when it fills the gaps
  // with them; never the retail catalog or any store (docs/SHOWROOM_PIVOT.md §3).
  const showroom = useShowroom();
  const fillGaps = !!showroom?.features.fillGaps;
  // The company's own products first; Basics after them (SHOWROOM_PIVOT §5: they only fill gaps).
  const products = useMemo(
    () => (showroom ? [...all.filter((p) => p.source === 'tenant'), ...(fillGaps ? all.filter((p) => p.source !== 'tenant' && isBuiltin(p.id)) : [])] : all),
    [all, showroom, fillGaps],
  );
  const nameOf = showroom ? prefName : byBrand;
  const priceOf = useKitchenPriceOf();
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const addItem = useDesignStore((s) => s.addItem);
  const toast = useDesignStore((s) => s.toast);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const compact = useCompact();

  // Once a touch press has become a drag, the list must not scroll under the finger.
  // A permanent non-passive listener keeps the browser asking before it scrolls.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const guard = (ev: TouchEvent) => {
      if (dragActive && ev.cancelable) ev.preventDefault();
    };
    el.addEventListener('touchmove', guard, { passive: false });
    return () => el.removeEventListener('touchmove', guard);
  }, []);

  // The real-retailer products (RONA, Home Depot…) load as their own chunk the first time the
  // catalog opens, then sit in the registry with everything else. Offline they still load (bundled).
  useEffect(() => {
    if (!showroom) void loadRetail();
  }, [showroom]);
  const stores = useRetail((s) => s.stores);
  const [store, setStore] = useState<string>(ALL);

  const inCategory = useMemo(() => products.filter((p) => cat === ALL || p.category === cat), [products, cat]);
  const brands = useMemo(() => brandFacets(inCategory, nameOf, !!showroom), [inCategory, nameOf, showroom]);
  const activeBrand = brand !== ALL && brands.some((b) => b.id === brand) ? brand : ALL;
  const prefsOn = hasBrandPrefs(brandPrefs) && mine && activeBrand === ALL;
  // No store on a showroom: the company sells its products itself.
  const storeList = useMemo(() => (showroom ? [] : storeFacets(inCategory, stores)), [inCategory, stores, showroom]);
  const activeStore = store !== ALL && storeList.some((s) => s.id === store) ? store : ALL;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (prefsOn ? filterToPrefs(inCategory, brandPrefs) : inCategory).filter((p) => {
      if (activeBrand !== ALL && nameOf(p) !== activeBrand) return false;
      const sold = showroom ? [] : storesOf(retailOf(p.id));
      if (activeStore !== ALL && !sold.includes(activeStore)) return false;
      if (!q) return true;
      const where = sold.map((s) => stores.get(s)?.name ?? s).join(' ');
      return `${p.name} ${p.brand} ${p.line ?? ''} ${p.sku ?? ''} ${p.code} ${p.kind} ${p.blurb} ${where}`.toLowerCase().includes(q);
    });
  }, [inCategory, activeBrand, activeStore, query, prefsOn, brandPrefs, stores, nameOf, showroom]);

  const grouped = useMemo(() => {
    if (cat !== ALL || query || activeBrand !== ALL || activeStore !== ALL) return [{ id: 'results', label: '', items: results }];
    // A contractor's own products come first, one group per line ("Smith Shaker: 14 pieces").
    const own = results.filter((p) => p.source === 'contractor');
    const lines = new Map<string, Product[]>();
    for (const p of own) lines.set(p.line || 'My catalog', [...(lines.get(p.line || 'My catalog') ?? []), p]);
    const mine = [...lines].map(([line, items]) => ({ id: `line:${line}`, label: `${line === 'My catalog' ? line : `My catalog · ${line}`}: ${items.length} piece${items.length === 1 ? '' : 's'}`, items }));
    const rest = results.filter((p) => p.source !== 'contractor');
    const known = new Set<string>(CATEGORIES.map((c) => c.id));
    // On a showroom each category shows the company's products, then BluModel Basics under their own heading.
    const groups = CATEGORIES.flatMap((c) => {
      const items = rest.filter((p) => p.category === c.id);
      if (!showroom) return [{ id: c.id as string, label: c.label, items }];
      const own = items.filter((p) => p.source === 'tenant');
      const basics = items.filter((p) => p.source !== 'tenant');
      return [
        { id: c.id as string, label: c.label, items: own },
        { id: `${c.id}:basics`, label: own.length ? `More basics: ${c.label.toLowerCase()}` : `${c.label}: BluModel Basics`, items: basics },
      ];
    });
    const other = rest.filter((p) => !known.has(p.category));
    return [...mine, ...groups, ...(other.length ? [{ id: 'other', label: 'Other', items: other }] : [])];
  }, [results, cat, query, activeBrand, activeStore, showroom]);

  const pick = (p: Product) => {
    if (performance.now() < swallowClickUntil) return;
    tapProduct(p);
  };

  const tapProduct = (p: Product) => {
    if (isCompact()) {
      // On a phone the room is hidden behind the catalog: arm the product, get out of
      // the way, and let the next tap on the plan or the 3D floor say where it goes.
      usePlacement.getState().arm(p.id);
      useMobileUI.getState().closeSheet();
      return;
    }
    addItem(p.id);
    toast(`Added ${p.name}. Drag it into place on the plan.`, 'ok');
  };

  return (
    <div className="catalog" ref={rootRef}>
      <div className="catalog-search">
        <Search />
        <input
          ref={searchRef}
          id="catalog-search"
          type="search"
          enterKeyHint="search"
          placeholder="Search ranges, sinks, pendants…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), searchRef.current?.blur())}
          aria-label="Search products"
        />
        <kbd>/</kbd>
      </div>
      <div className="chips" role="tablist" aria-label="Categories">
        <button role="tab" aria-selected={cat === ALL} className={cat === ALL ? 'chip on' : 'chip'} onClick={() => setCat(ALL)}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id} className={cat === c.id ? 'chip on' : 'chip'} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      {(brands.length > 1 || storeList.length > 0 || hasBrandPrefs(brandPrefs)) && (
        <div className="catalog-filters" role="group" aria-label="Filter products">
          {hasBrandPrefs(brandPrefs) && (
            <button
              type="button"
              aria-pressed={prefsOn}
              className={prefsOn ? 'chip on' : 'chip'}
              onClick={() => (prefsOn ? setMine(false) : (setBrand(ALL), setMine(true)))}
              title={showroom ? 'The lines chosen when this design was set up' : 'The brands chosen when this kitchen was set up'}
            >
              {showroom ? 'Your lines' : 'Your brands'}
            </button>
          )}
          {/* The two dropdowns wrap as one row under the chip when they don't fit beside it. */}
          {(brands.length > 1 || storeList.length > 0) && (
            <span className="catalog-selects">
              {brands.length > 1 && (
                <span className={activeBrand !== ALL ? 'catalog-filter on' : 'catalog-filter'}>
                  <select
                    id="catalog-brand"
                    aria-label={showroom ? 'Line' : 'Brand'}
                    value={activeBrand}
                    onChange={(e) => {
                      setBrand(e.target.value);
                      if (e.target.value === ALL) setMine(false);
                    }}
                  >
                    <option value={ALL}>{showroom ? 'All lines' : 'All brands'}</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label} ({b.n})
                      </option>
                    ))}
                  </select>
                </span>
              )}
              {storeList.length > 0 && (
                <span className={activeStore !== ALL ? 'catalog-filter on' : 'catalog-filter'}>
                  <select id="catalog-store" aria-label="Store" value={activeStore} onChange={(e) => setStore(e.target.value)}>
                    <option value={ALL}>Any store</option>
                    {storeList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label} ({s.n})
                      </option>
                    ))}
                  </select>
                </span>
              )}
            </span>
          )}
        </div>
      )}
      <p className="catalog-hint">
        {compact ? 'Tap a product, then tap the room. Or hold one and drag it in.' : 'Click a product to add it, or drag it onto the plan or the 3D floor.'}
      </p>
      <div className="catalog-scroll">
        {results.length === 0 && <p className="empty-note">Nothing matches{query ? ` “${query}”` : ''}. Try “range”, “brass” or “island”.</p>}
        {grouped.map((g) =>
          g.items.length ? (
            <section key={g.id} className="catalog-group">
              {g.label && <h4>{g.label}</h4>}
              <div className="catalog-grid">
                {g.items.map((p) => {
                  const finishes = finishList(p);
                  const at = (w: number) => (priceOf ? priceOf(p, w).sell : priceFor(p, w));
                  const from = p.widthOptions?.length ? Math.min(...p.widthOptions.map(at)) : at(p.widthIn);
                  const custom = p.source === 'custom';
                  const mine = p.source === 'contractor';
                  const info = showroom ? undefined : retailOf(p.id);
                  const sold = storesOf(info);
                  // A real product with no checked store price shows none rather than a made-up one.
                  const priceText = info && !priceOf && !retailPriceKnown(info) ? 'See store' : `${money(from)}${p.widthOptions?.length ? '+' : ''}`;
                  return (
                    <div key={p.id} className="product-card-wrap">
                      <button
                        className="product-card"
                        data-product={p.id}
                        draggable={false}
                        onDragStart={(e) => e.preventDefault()}
                        onPointerDown={(e) => pressProduct(e, p, rootRef.current, () => tapProduct(p))}
                        onClick={() => pick(p)}
                        title={`${p.brand} ${p.name}: ${p.blurb}`}
                      >
                        <span className="product-art">
                          <ProductArt product={p} surfaces={surfaces} />
                          <span className="product-add"><Plus width={12} height={12} /></span>
                          {(p.model || custom || mine) && (
                            <span className="product-badges">
                              {p.model && <span className="product-badge">3D model</span>}
                              {custom && <span className="product-badge mine">Your model</span>}
                              {mine && <span className="product-badge mine">My catalog</span>}
                            </span>
                          )}
                        </span>
                        <span className="product-name">{p.name}</span>
                        <span className="product-meta">
                          <span>{showroom ? nameOf(p) : p.brandKind === 'contractor' ? `by ${p.brand}` : p.brand}</span>
                          <span className="mono">{p.widthOptions?.length ? `${Math.min(...p.widthOptions)}–${Math.max(...p.widthOptions)}″` : `${p.widthIn}″`}</span>
                        </span>
                        {sold.length > 0 && <StoreChips slugs={sold} names={stores} />}
                        <span className="product-foot">
                          <span className="dots">
                            {finishes.slice(0, 4).map((f) => (
                              <i key={f.id} style={{ background: f.material === 'panel' ? 'repeating-linear-gradient(45deg,#cfc8bb 0 3px,#fff 3px 5px)' : f.hex }} title={f.name} />
                            ))}
                            {finishes.length > 4 && <em>+{finishes.length - 4}</em>}
                          </span>
                          <span className={priceText === 'See store' ? 'price price--store' : 'price'}>{priceText}</span>
                        </span>
                      </button>
                      <a className="product-info" href={hrefFor({ name: 'product', id: p.id })} aria-label={`About ${p.name}`} title="Product details">
                        <Info width={13} height={13} />
                      </a>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null,
        )}
        {canRequestModel && (
          <p className="catalog-foot">
            Can’t find it? <a href={hrefFor({ name: 'orders', rest: 'new' })}>Request a custom model</a>
          </p>
        )}
      </div>
      <DragGhost />
    </div>
  );
}
