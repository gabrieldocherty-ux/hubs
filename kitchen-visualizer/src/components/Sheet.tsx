import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Close } from './Icons';
import { sheetRelease, type SheetSnap } from './MobileGeometry';
import { SHORT_QUERY, useMedia } from './MobileState';

interface Gesture {
  id: number;
  x0: number;
  y0: number;
  h0: number;
  half: number;
  full: number;
  lastY: number;
  lastT: number;
  v: number;
}

/**
 * A sheet for the phone layout. Opens at half height over the canvas; drag the handle
 * up for full height, down (or flick) to shrink or close; tap the handle to toggle.
 * On a short landscape screen it becomes a panel on the right (drag right or down to
 * close). Closed, it is off-screen, invisible and inert, so it never blocks the canvas.
 */
export function Sheet({ title, open, onClose, className = '', children }: { title: string; open: boolean; onClose: () => void; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [snap, setSnap] = useState<SheetSnap>('half');
  const [live, setLive] = useState<{ h?: number; y?: number; x?: number } | null>(null);
  // Mount the contents on first open and keep them (the catalog keeps its search and scroll).
  const [seen, setSeen] = useState(open);
  const side = useMedia(SHORT_QUERY);

  useEffect(() => {
    if (open) setSeen(true);
    else {
      setSnap('half');
      setLive(null);
      gesture.current = null;
    }
    ref.current?.toggleAttribute('inert', !open);
  }, [open]);

  const onDown = (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    const full = parseFloat(getComputedStyle(el).maxHeight) || window.innerHeight * 0.85;
    const half = Math.min(full, window.innerHeight * 0.54);
    gesture.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, h0: el.getBoundingClientRect().height, half, full, lastY: e.clientY, lastT: e.timeStamp, v: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    const dt = e.timeStamp - g.lastT;
    if (dt > 0) g.v = 0.6 * ((e.clientY - g.lastY) / dt) + 0.4 * g.v;
    g.lastY = e.clientY;
    g.lastT = e.timeStamp;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (side) {
      setLive({ x: Math.max(0, Math.max(dx, dy)) });
      return;
    }
    const h = g.h0 - dy;
    setLive(h >= g.half ? { h: Math.min(h, g.full) } : { h: g.half, y: g.half - h });
  };

  const onUp = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    gesture.current = null;
    setLive(null);
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (e.type === 'pointercancel') return;
    if (Math.hypot(dx, dy) < 6) {
      if (!side) setSnap((s) => (s === 'half' ? 'full' : 'half'));
      return;
    }
    if (side) {
      if (dx > 70 || dy > 70) onClose();
      return;
    }
    const next = sheetRelease(snap, g.h0 - dy, g.v, dy, g.half, g.full);
    if (next === 'closed') onClose();
    else setSnap(next);
  };

  const style: CSSProperties | undefined = live
    ? {
        height: live.h,
        transform: live.x ? `translateX(${live.x}px)` : live.y ? `translateY(${live.y}px)` : undefined,
      }
    : undefined;

  return (
    <section
      ref={ref}
      className={`sheet sheet--${snap}${open ? ' is-open' : ''}${live ? ' is-dragging' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      role="dialog"
      aria-label={title}
      aria-hidden={!open}
    >
      <header className="sheet-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <span className="sheet-handle" aria-hidden />
        <div className="sheet-title">
          <h2>{title}</h2>
          <button className="sheet-close" onClick={onClose} aria-label={`Close ${title}`}>
            <Close width={20} height={20} />
          </button>
        </div>
      </header>
      <div className="sheet-body">{seen ? children : null}</div>
    </section>
  );
}
