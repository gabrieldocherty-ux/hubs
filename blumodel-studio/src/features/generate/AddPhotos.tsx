import { useRef, useState, type DragEvent } from 'react';
import { Close } from '../../components/Icons';
import { MAX_PHOTOS } from './photos';
import type { ViewerPhoto } from './PhotoViewer';
import { CameraIcon } from './icons';

const ImagesIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="m21 16-5-5-9 9" />
  </svg>
);

/** Step 1: add 1–6 photos (drop, pick or take), see them, remove or reorder them. */
export function AddPhotos({
  photos,
  busy,
  error,
  onAdd,
  onRemove,
  onMakeMain,
  onOpen,
}: {
  photos: (ViewerPhoto & { uploaded?: boolean })[];
  busy: boolean;
  error: string | null;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  onMakeMain: (id: string) => void;
  onOpen: (i: number) => void;
}) {
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const full = photos.length >= MAX_PHOTOS;
  // The camera button only where there is a camera to hand (phones, tablets).
  const [touch] = useState(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches);

  const take = (list: FileList | null) => {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name));
    if (files.length) onAdd(files);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!full) take(e.dataTransfer.files);
  };

  return (
    <div className="gen-add-photos">
      <div
        className={`gen-drop${over ? ' over' : ''}${photos.length ? ' has' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!full) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <p className="gen-drop-title">{full ? `That’s ${MAX_PHOTOS} photos, the most BluModel Studio uses.` : photos.length ? 'Add another angle' : 'Add photos of your kitchen as it is now'}</p>
        <p className="gen-drop-sub">{full ? 'Remove one to add another.' : <>Drop photos here, or use the buttons. JPEG, PNG or WebP · up to {MAX_PHOTOS}.</>}</p>
        <div className="gen-drop-buttons">
          {touch && (
            <button type="button" className="btn primary big gen-camera" onClick={() => camera.current?.click()} disabled={full || busy}>
              <CameraIcon /> Take a photo
            </button>
          )}
          <button type="button" className={touch ? 'btn big' : 'btn primary big'} onClick={() => pick.current?.click()} disabled={full || busy}>
            <ImagesIcon /> {touch ? 'From my photos' : 'Choose photos'}
          </button>
        </div>
        <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp,image/*" multiple hidden onChange={(e) => (take(e.target.files), (e.target.value = ''))} aria-label="Choose photos" />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (take(e.target.files), (e.target.value = ''))} aria-label="Take a photo" />
        {busy && (
          <p className="gen-hint" role="status">
            Preparing photos…
          </p>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
      </div>

      {photos.length > 0 && (
        <ol className="gen-thumbs" aria-label="Your photos">
          {photos.map((p, i) => (
            <li key={p.id} className={i === 0 ? 'gen-thumb main' : 'gen-thumb'}>
              <button type="button" className="gen-thumb-img" onClick={() => onOpen(i)} aria-label={`Enlarge photo ${i + 1}`}>
                <img src={p.url} alt={`Kitchen photo ${i + 1}`} />
              </button>
              <span className="gen-thumb-tag">{i === 0 ? 'Main wall · north' : `Photo ${i + 1}`}</span>
              {i > 0 && (
                <button type="button" className="gen-thumb-main" onClick={() => onMakeMain(p.id)}>
                  Make main
                </button>
              )}
              <button type="button" className="gen-thumb-x" onClick={() => onRemove(p.id)} aria-label={`Remove photo ${i + 1}`} disabled={busy}>
                <Close width={14} height={14} />
              </button>
            </li>
          ))}
        </ol>
      )}

      <ul className="gen-tips">
        <li>
          <b>Stand back</b> in a doorway or a corner so each photo takes in a whole wall, floor to ceiling.
        </li>
        <li>
          <b>Your first photo faces the main wall.</b> BluModel Studio calls it north and works out the others from it.
        </li>
        <li>
          <b>No need to tidy up.</b> Photos stay private to you.
        </li>
      </ul>
    </div>
  );
}
