import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { CATALOG, CATEGORIES, getProduct, priceFor } from '../data/catalog';
import type { CategoryId, Product, Surfaces } from '../types';
import { useDesignStore } from '../store/useDesignStore';
import { findDropTarget, placeAt, usePlacement, type ViewId } from '../lib/interaction';
import { ProductArt } from './ProductArt';
import { Plus, Search } from './Icons';
import { money } from '../lib/format';
import { finishList } from '../lib/finish';
import { CATALOG_DRAG_CLASS, isCompact, useMobileUI } from './MobileState';

/*
 * Catalog → room by pointer, so the same gesture works with a mouse, a finger or a pen
 * (HTML5 drag-and-drop never fires on touch screens).
 *
 *   mouse  press a card and move a few pixels: the drag starts.
 *   touch  the list must still scroll, so a drag starts only after a short hold
 *          (HOLD_MS) or a clearly sideways pull; a mostly vertical move is a scroll
 *          and is left to the browser.
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

function pressProduct(e: ReactPointerEvent<HTMLElement>, product: Product, catalogEl: HTMLElement | null) {
  if (pressing || dragActive) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const touchLike = e.pointerType !== 'mouse';
  const pid = e.pointerId;
  const x0 = e.clientX;
  const y0 = e.clientY;
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
    if (Math.abs(dx) > Math.abs(dy) * 1.2) begin();
    else finish(false); // a scroll: the browser takes it from here
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== pid) return;
    x = ev.clientX;
    y = ev.clientY;
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

  function finish(drop: boolean) {
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
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<CategoryId | 'all'>('all');
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const addItem = useDesignStore((s) => s.addItem);
  const toast = useDesignStore((s) => s.toast);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CATALOG.filter((p) => (cat === 'all' || p.category === cat) && (!q || `${p.name} ${p.brand} ${p.code} ${p.kind} ${p.blurb}`.toLowerCase().includes(q)));
  }, [query, cat]);

  const grouped = useMemo(() => {
    if (cat !== 'all' || query) return [{ id: 'results', label: '', items: results }];
    return CATEGORIES.map((c) => ({ id: c.id, label: c.label, items: results.filter((p) => p.category === c.id) }));
  }, [results, cat, query]);

  const pick = (p: Product) => {
    if (performance.now() < swallowClickUntil) return;
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
        />
        <kbd>/</kbd>
      </div>
      <div className="chips" role="tablist" aria-label="Categories">
        <button role="tab" aria-selected={cat === 'all'} className={cat === 'all' ? 'chip on' : 'chip'} onClick={() => setCat('all')}>All</button>
        {CATEGORIES.map((c) => (
          <button key={c.id} role="tab" aria-selected={cat === c.id} className={cat === c.id ? 'chip on' : 'chip'} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="catalog-hint">Tap a product, then tap the room. Or hold one and drag it in.</p>
      <div className="catalog-scroll">
        {results.length === 0 && <p className="empty-note">Nothing matches “{query}”. Try “range”, “brass” or “island”.</p>}
        {grouped.map((g) =>
          g.items.length ? (
            <section key={g.id} className="catalog-group">
              {g.label && <h4>{g.label}</h4>}
              <div className="catalog-grid">
                {g.items.map((p) => {
                  const finishes = finishList(p);
                  const from = p.widthOptions ? Math.min(...p.widthOptions.map((w) => priceFor(p, w))) : p.price;
                  return (
                    <button
                      key={p.id}
                      className="product-card"
                      data-product={p.id}
                      draggable={false}
                      onDragStart={(e) => e.preventDefault()}
                      onPointerDown={(e) => pressProduct(e, p, rootRef.current)}
                      onClick={() => pick(p)}
                      title={`${p.brand} ${p.name}: ${p.blurb}`}
                    >
                      <span className="product-art">
                        <ProductArt product={p} surfaces={surfaces} />
                        <span className="product-add"><Plus width={12} height={12} /></span>
                      </span>
                      <span className="product-name">{p.name}</span>
                      <span className="product-meta">
                        <span>{p.brand}</span>
                        <span className="mono">{p.widthOptions ? `${Math.min(...p.widthOptions)}–${Math.max(...p.widthOptions)}″` : `${p.widthIn}″`}</span>
                      </span>
                      <span className="product-foot">
                        <span className="dots">
                          {finishes.slice(0, 4).map((f) => (
                            <i key={f.id} style={{ background: f.material === 'panel' ? 'repeating-linear-gradient(45deg,#cfc8bb 0 3px,#fff 3px 5px)' : f.hex }} title={f.name} />
                          ))}
                          {finishes.length > 4 && <em>+{finishes.length - 4}</em>}
                        </span>
                        <span className="price">{money(from)}{p.widthOptions ? '+' : ''}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : null,
        )}
      </div>
      <DragGhost />
    </div>
  );
}
