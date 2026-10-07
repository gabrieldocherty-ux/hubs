import { useEffect, type SVGProps } from 'react';
import { useDesignStore } from '../store/useDesignStore';
import { useReport } from '../store/derived';
import { getProduct } from '../data/catalog';
import { findDropTarget, placeAtClient, usePlacement } from '../lib/interaction';
import type { ViewMode } from '../types';
import { CatalogPanel } from './CatalogPanel';
import { RoomPanel } from './RoomPanel';
import { RightPanel } from './RightPanel';
import { ProductArt } from './ProductArt';
import { Sheet } from './Sheet';
import { CubeIcon, Info, PlanIcon, Plus, WallsIcon } from './Icons';
import { isTap } from './MobileGeometry';
import { useMobileUI, type SheetId } from './MobileState';

const Swatches = (p: SVGProps<SVGSVGElement>) => (
  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden {...p}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <circle cx="17" cy="17" r="4" />
  </svg>
);

export type CompactView = Exclude<ViewMode, 'split'>;

/** The phone layout's bottom bar: which view fills the screen, and the three sheets. */
export function MobileBar({ view, readOnly = false }: { view: CompactView; readOnly?: boolean }) {
  const setUI = useDesignStore((s) => s.setUI);
  const hasSelection = useDesignStore((s) => s.selectedId !== null);
  const sheet = useMobileUI((s) => s.sheet);
  const toggle = useMobileUI((s) => s.toggleSheet);
  const report = useReport();
  const issues = report.checks.filter((c) => c.level === 'bad' || c.level === 'warn').length;

  const views: [CompactView, string, (p: SVGProps<SVGSVGElement>) => JSX.Element][] = [
    ['plan', 'Plan', PlanIcon],
    ['3d', '3D', CubeIcon],
    ['walls', 'Walls', WallsIcon],
  ];
  const sheets: [SheetId, string, JSX.Element, JSX.Element | null][] = readOnly
    ? [['details', 'Details', <Info key="i" width={20} height={20} />, null]]
    : [
        ['catalog', 'Add', <Plus key="i" width={20} height={20} />, null],
        ['room', 'Room', <Swatches key="i" />, null],
        ['details', hasSelection ? 'Item' : 'Details', <Info key="i" width={20} height={20} />, issues > 0 ? <i key="b" className="mbar-badge">{issues}</i> : null],
      ];

  return (
    <nav className="mbar" aria-label="Editor">
      <div className="mbar-views" role="tablist" aria-label="View">
        {views.map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={view === id} className={view === id ? 'on' : ''} onClick={() => setUI({ viewMode: id })}>
            <Icon width={20} height={20} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="mbar-actions">
        {sheets.map(([id, label, icon, badge]) => (
          <button
            key={id}
            className={sheet === id ? 'on' : ''}
            aria-expanded={sheet === id}
            aria-label={id === 'catalog' ? 'Add products' : id === 'room' ? 'Room and finishes' : label}
            onClick={() => {
              if (id === 'details' && sheet !== 'details' && hasSelection) setUI({ rightTab: 'details' });
              toggle(id);
            }}
          >
            {icon}
            <span>{label}</span>
            {badge}
          </button>
        ))}
      </div>
    </nav>
  );
}

/** Catalog, Room & finishes and Details, each in its own sheet. */
/** In view mode (share links) only the read-only Details sheet exists: nothing to add or restyle. */
export function MobileSheets({ mode = 'edit', showPrices = true }: { mode?: 'edit' | 'view'; showPrices?: boolean }) {
  const sheet = useMobileUI((s) => s.sheet);
  const close = useMobileUI((s) => s.closeSheet);
  const view = mode === 'view';
  return (
    <>
      {!view && (
        <Sheet title="Add products" open={sheet === 'catalog'} onClose={close} className="sheet--catalog">
          <CatalogPanel />
        </Sheet>
      )}
      {!view && (
        <Sheet title="Room & finishes" open={sheet === 'room'} onClose={close}>
          <div className="panel-scroll">
            <RoomPanel />
          </div>
        </Sheet>
      )}
      <Sheet title="Details" open={sheet === 'details'} onClose={close}>
        <RightPanel variant="sheet" mode={mode} showPrices={showPrices} />
      </Sheet>
    </>
  );
}

/** Shown while a product is armed for tap-to-place: what will be placed, and a way out. */
export function PlacementBanner({ compact }: { compact: boolean }) {
  const armed = usePlacement((s) => s.armedProductId);
  const disarm = usePlacement((s) => s.disarm);
  const surfaces = useDesignStore((s) => s.doc.surfaces);
  const product = armed ? getProduct(armed) : undefined;
  if (!product) return null;
  return (
    <div className="place-banner" role="status" aria-live="polite">
      <span className="place-banner-art">
        <ProductArt product={product} surfaces={surfaces} />
      </span>
      <span className="place-banner-text">
        {compact ? 'Tap' : 'Click'} the plan or floor to place <b>{product.name}</b>
      </span>
      <button className="place-banner-cancel" onClick={disarm}>
        Cancel
      </button>
    </div>
  );
}

/** Taps on these never place a product, even over a view (HUD buttons, the toolbar, sheets…). */
const UI_TARGET = 'button, a, input, select, textarea, label, [role="toolbar"], .plan-hud, .scene-hud, .place-banner, .sheet, .mbar, .topbar';
/** How long a view gets to consume the tap itself before this fallback places the product. */
const VIEW_GRACE_MS = 180;

/**
 * Tap-to-place, view-agnostic: while a product is armed, a tap (not a pan, pinch or
 * long press) over any registered view places it at that point. Each view may also
 * handle the tap itself (it has better context, e.g. a tap on an existing piece);
 * placeAt disarms, so this only acts if the armed product is still waiting a moment
 * after the tap, and a product is never placed twice.
 */
export function usePlacementTaps() {
  useEffect(() => {
    const downs = new Map<number, { x: number; y: number; t: number }>();
    let multi = false;
    let timer = 0;
    const onDown = (e: PointerEvent) => {
      if (!usePlacement.getState().armedProductId) return;
      downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
      if (downs.size > 1) multi = true;
    };
    const onEnd = (e: PointerEvent) => {
      const d = downs.get(e.pointerId);
      downs.delete(e.pointerId);
      const pinched = multi;
      if (downs.size === 0) multi = false;
      const product = usePlacement.getState().armedProductId;
      if (e.type !== 'pointerup' || !d || !product || pinched) return;
      if (!isTap(e.clientX - d.x, e.clientY - d.y, e.timeStamp - d.t)) return;
      if ((e.target as Element | null)?.closest?.(UI_TARGET)) return;
      if (!findDropTarget(e.clientX, e.clientY)) return;
      const { clientX, clientY } = e;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (usePlacement.getState().armedProductId === product) placeAtClient(product, clientX, clientY);
      }, VIEW_GRACE_MS);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onEnd, true);
    window.addEventListener('pointercancel', onEnd, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onEnd, true);
      window.removeEventListener('pointercancel', onEnd, true);
    };
  }, []);
}
