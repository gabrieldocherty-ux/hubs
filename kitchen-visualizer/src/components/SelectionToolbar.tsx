import { useEffect, useLayoutEffect, useRef, useState, type SVGProps } from 'react';
import { useDesignStore } from '../store/useDesignStore';
import { getProduct } from '../data/catalog';
import { useOverlay, usePlacement, type ScreenRect } from '../lib/interaction';
import { Copy, RotateCw, Trash } from './Icons';
import { dockToolbar, intersectRects, placeToolbar } from './MobileGeometry';
import { useMobileUI } from './MobileState';

const Sliders = (p: SVGProps<SVGSVGElement>) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden {...p}>
    <path d="M4 7h10" />
    <path d="M18 7h2" />
    <circle cx="16" cy="7" r="2" />
    <path d="M4 17h4" />
    <path d="M12 17h8" />
    <circle cx="10" cy="17" r="2" />
  </svg>
);

/** The visible canvas: the editor's stage, cut to the window. */
function stageBounds(): ScreenRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const view = { left: 0, top: 0, width: vw, height: vh };
  const el = document.querySelector('.app .stage');
  return el ? intersectRects(el.getBoundingClientRect(), view) : view;
}

/**
 * Floating Rotate / Duplicate / Delete / Details bar for the selected piece, anchored to
 * the box the active view publishes in useOverlay: centred above it, flipped below when
 * there's no room, clamped to the canvas, and out of the way while anything is being
 * dragged. On a phone it docks at the bottom of the canvas when the item's box isn't
 * known (e.g. the walls view), so the actions are always one tap away.
 */
export function SelectionToolbar({ compact, onDetails }: { compact: boolean; onDetails: () => void }) {
  const item = useDesignStore((s) => (s.selectedId ? s.doc.items.find((i) => i.id === s.selectedId) ?? null : null));
  const storeDragging = useDesignStore((s) => s.dragging);
  const rect = useOverlay((s) => s.rect);
  const overlayDragging = useOverlay((s) => s.dragging);
  const armed = usePlacement((s) => s.armedProductId);
  const sheet = useMobileUI((s) => s.sheet);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 236, h: 56 });
  const [, setTick] = useState(0);

  useEffect(() => {
    const onResize = () => setTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w && h && (w !== size.w || h !== size.h)) setSize({ w, h });
  });

  const product = item ? getProduct(item.productId) : undefined;
  if (!item || !product || storeDragging || overlayDragging || armed || (compact && sheet !== null)) return null;

  const bounds = stageBounds();
  const spot = (rect && placeToolbar(rect, size.w, size.h, bounds)) || (compact ? dockToolbar(size.w, size.h, bounds) : null);
  if (!spot) return null;

  const { rotate, duplicate, remove, toast } = useDesignStore.getState();
  const id = item.id;

  return (
    <div
      ref={ref}
      className={`sel-toolbar sel-toolbar--${spot.side}`}
      style={{ left: Math.round(spot.left), top: Math.round(spot.top) }}
      role="toolbar"
      aria-label={`${product.name} actions`}
    >
      <button onClick={() => rotate(id, 1)} title="Rotate 90° (R)" aria-label="Rotate 90 degrees">
        <RotateCw width={18} height={18} />
        <span>Rotate</span>
      </button>
      <button onClick={() => duplicate(id)} title="Duplicate (Ctrl+D)" aria-label="Duplicate">
        <Copy width={18} height={18} />
        <span>Duplicate</span>
      </button>
      <button
        className="danger"
        onClick={() => {
          remove(id);
          toast(`Removed ${product.name}. Undo brings it back.`, 'info');
        }}
        title="Delete (Del)"
        aria-label="Delete"
      >
        <Trash width={18} height={18} />
        <span>Delete</span>
      </button>
      <i className="sel-toolbar-sep" aria-hidden />
      <button onClick={onDetails} title="Finish, width and exact position" aria-label="Finish and details">
        <Sliders />
        <span>Details</span>
      </button>
    </div>
  );
}
