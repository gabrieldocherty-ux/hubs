import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { ApiError } from '../../lib/api';
import { Dialog } from '../../components/Dialog';
import { Close } from '../../components/Icons';
import { generateApi } from './api';
import { LOCAL_KITCHEN_KEY, deletePhotos, loadPhotos } from './photos';
import { Lightbox, PhotoCarousel, type ViewerPhoto } from './PhotoViewer';
import { CameraIcon } from './icons';
import './generate.css';

const POS_KEY = 'mise-photo-ref';

interface Saved {
  open: boolean;
  /** Panel's top-left, in px from the viewport's top-left; null = the default corner. */
  x: number | null;
  y: number | null;
}

function loadSaved(): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (!v || typeof v !== 'object') return null;
    return { open: v.open !== false, x: Number.isFinite(v.x) ? v.x : null, y: Number.isFinite(v.y) ? v.y : null };
  } catch {
    return null;
  }
}

function save(s: Saved) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

const compactNow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches;

/**
 * The photos a kitchen was started from, floating over the editor so the model can be compared
 * with the real room: collapsible, draggable by its header, tap a photo to enlarge it. Renders
 * nothing when the kitchen has no photos. `projectId` for an account kitchen; none (or
 * `localKey`) for the kitchen kept on this device.
 */
export default function PhotoReference({ projectId = null, localKey = LOCAL_KITCHEN_KEY }: { projectId?: string | null; localKey?: string }) {
  const [photos, setPhotos] = useState<ViewerPhoto[] | null>(null);
  const [state, setState] = useState<Saved>(() => loadSaved() ?? { open: !compactNow(), x: null, y: null });
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    (async () => {
      if (projectId) {
        try {
          const { files } = await generateApi.photosOf(projectId);
          if (live) setPhotos(files.map((f, i) => ({ id: f.id, url: f.url, name: f.originalName || `Photo ${i + 1}` })));
        } catch {
          if (live) setPhotos([]);
        }
        return;
      }
      const stored = await loadPhotos(localKey);
      const list = stored.map((p) => {
        const url = URL.createObjectURL(p.blob);
        urls.push(url);
        return { id: p.id, url, name: p.name };
      });
      if (live) setPhotos(list);
      else urls.forEach((u) => URL.revokeObjectURL(u));
    })();
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [projectId, localKey]);

  // Keep a dragged panel on screen when the window shrinks.
  useEffect(() => {
    const fit = () => setState((s) => (s.x === null ? s : { ...s, ...clampPos(s.x, s.y ?? 0, panel.current) }));
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const update = (patch: Partial<Saved>) =>
    setState((s) => {
      const next = { ...s, ...patch };
      save(next);
      return next;
    });

  if (!photos || !photos.length) return null;

  const onDown = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const r = panel.current?.getBoundingClientRect();
    if (!r) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
  };
  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    setState((s) => ({ ...s, ...clampPos(e.clientX - drag.current!.dx, e.clientY - drag.current!.dy, panel.current) }));
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    setState((s) => (save(s), s));
  };

  const remove = async () => {
    setError(null);
    try {
      if (projectId) await generateApi.attachPhotos(projectId, []);
      else await deletePhotos(localKey);
      setPhotos([]);
      setConfirm(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The photos couldn’t be removed. Try again.');
    }
  };

  const placed = state.x !== null && state.y !== null ? { left: state.x, top: state.y, right: 'auto', bottom: 'auto' } : undefined;

  return (
    <>
      {state.open ? (
        <div ref={panel} className="photo-ref" style={placed} role="region" aria-label="Your kitchen photos">
          <header className="photo-ref-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} title="Drag to move">
            <span className="photo-ref-grip" aria-hidden />
            <b>Your photos</b>
            <button type="button" className="photo-ref-more" onClick={() => setConfirm(true)}>
              Remove
            </button>
            <button type="button" className="icon-btn photo-ref-close" onClick={() => update({ open: false })} aria-label="Hide your photos">
              <Close width={16} height={16} />
            </button>
          </header>
          <PhotoCarousel photos={photos} index={index} onIndex={setIndex} onOpen={setLightbox} className="photo-ref-carousel" />
        </div>
      ) : (
        <button type="button" className="photo-ref-pill" onClick={() => update({ open: true })} aria-label={`Show your photos (${photos.length})`}>
          <CameraIcon width={16} height={16} /> Photos <span className="mono">{photos.length}</span>
        </button>
      )}
      {lightbox !== null && <Lightbox photos={photos} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />}
      {confirm && (
        <Dialog title="Remove the photos from this kitchen?" onClose={() => setConfirm(false)}>
          <p className="gen-dialog-text">They stop showing here. The kitchen itself doesn’t change.</p>
          {error && <p className="auth-error">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn" data-autofocus onClick={() => setConfirm(false)}>
              Keep them
            </button>
            <button type="button" className="btn primary" onClick={() => void remove()}>
              Remove photos
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function clampPos(x: number, y: number, el: HTMLElement | null): { x: number; y: number } {
  const w = el?.offsetWidth ?? 300;
  const h = el?.offsetHeight ?? 240;
  return {
    x: Math.round(Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8))),
    y: Math.round(Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8))),
  };
}
