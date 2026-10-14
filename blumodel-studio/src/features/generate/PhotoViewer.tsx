import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Close } from '../../components/Icons';
import './generate.css';

export interface ViewerPhoto {
  id: string;
  url: string;
  name: string;
}

const Arrow = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {dir === 'left' ? <path d="m15 18-6-6 6-6" /> : <path d="m9 18 6-6-6-6" />}
  </svg>
);

/**
 * Photos one at a time: swipe on a phone (native scroll snapping), arrows or ←/→ elsewhere.
 * `onOpen` makes a tap on the photo enlarge it.
 */
export function PhotoCarousel({
  photos,
  index,
  onIndex,
  onOpen,
  className = '',
  style,
  fit = 'cover',
  caption,
}: {
  photos: ViewerPhoto[];
  index: number;
  onIndex: (i: number) => void;
  onOpen?: (i: number) => void;
  className?: string;
  style?: CSSProperties;
  fit?: 'cover' | 'contain';
  caption?: (i: number) => string | null;
}) {
  const track = useRef<HTMLDivElement>(null);
  const current = Math.min(index, Math.max(0, photos.length - 1));
  const settling = useRef(false);

  // Keep the scroll position in step with `index` (arrows, thumbnails, a removed photo).
  useEffect(() => {
    const el = track.current;
    if (!el || !el.clientWidth) return;
    const want = current * el.clientWidth;
    if (Math.abs(el.scrollLeft - want) > 2) {
      settling.current = true;
      el.scrollTo({ left: want, behavior: 'smooth' });
      const t = window.setTimeout(() => (settling.current = false), 400);
      return () => window.clearTimeout(t);
    }
  }, [current, photos.length]);

  const onScroll = useCallback(() => {
    const el = track.current;
    if (!el || !el.clientWidth || settling.current) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== current && i >= 0 && i < photos.length) onIndex(i);
  }, [current, photos.length, onIndex]);

  const go = (d: number) => onIndex((current + d + photos.length) % photos.length);

  if (!photos.length) return null;
  const cap = caption?.(current);
  return (
    <div
      className={`gen-carousel ${className}`}
      style={style}
      role="group"
      aria-roledescription="carousel"
      aria-label="Your photos"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(-1);
        else if (e.key === 'ArrowRight') go(1);
      }}
    >
      <div className="gen-carousel-track" ref={track} onScroll={onScroll}>
        {photos.map((p, i) => (
          <div className="gen-carousel-slide" key={p.id} aria-hidden={i !== current} aria-roledescription="slide" aria-label={`Photo ${i + 1} of ${photos.length}`}>
            {onOpen ? (
              <button type="button" className="gen-carousel-open" onClick={() => onOpen(i)} aria-label={`Enlarge photo ${i + 1}`} tabIndex={i === current ? 0 : -1}>
                <img src={p.url} alt={`Kitchen photo ${i + 1}`} draggable={false} style={{ objectFit: fit }} />
              </button>
            ) : (
              <img src={p.url} alt={`Kitchen photo ${i + 1}`} draggable={false} style={{ objectFit: fit }} />
            )}
          </div>
        ))}
      </div>
      {photos.length > 1 && (
        <>
          <button type="button" className="gen-carousel-arrow left" onClick={() => go(-1)} aria-label="Previous photo">
            <Arrow dir="left" />
          </button>
          <button type="button" className="gen-carousel-arrow right" onClick={() => go(1)} aria-label="Next photo">
            <Arrow dir="right" />
          </button>
        </>
      )}
      <div className="gen-carousel-meta">
        {cap && <span className="gen-carousel-cap">{cap}</span>}
        {photos.length > 1 && (
          <span className="gen-carousel-count mono" aria-live="polite">
            {current + 1} / {photos.length}
          </span>
        )}
      </div>
    </div>
  );
}

/** Full-screen photo viewer: swipe or arrows, Esc or × to close. */
export function Lightbox({ photos, index, onIndex, onClose }: { photos: ViewerPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('.gen-lightbox-close')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      } else if (e.key === 'Tab') {
        // Keep focus inside the viewer.
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('button') ?? [])].filter((b) => b.offsetParent !== null && b.tabIndex >= 0);
        if (!items.length) return;
        const [a, z] = [items[0], items[items.length - 1]];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      back?.focus?.();
    };
  }, []);
  return createPortal(
    <div className="gen-lightbox" ref={ref} role="dialog" aria-modal="true" aria-label="Photo viewer">
      <PhotoCarousel photos={photos} index={index} onIndex={onIndex} fit="contain" className="gen-lightbox-carousel" />
      <button type="button" className="gen-lightbox-close" onClick={onClose} aria-label="Close photo viewer">
        <Close width={20} height={20} />
      </button>
    </div>,
    document.body,
  );
}
