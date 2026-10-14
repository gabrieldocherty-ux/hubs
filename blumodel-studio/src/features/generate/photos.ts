/**
 * Photos on the device (package D): shrinking them before upload, and keeping them in this
 * browser (IndexedDB) for signed-out kitchens and for a "Start from a photo" draft in progress.
 * Everything here fails soft: no IndexedDB (private mode, blocked storage) just means nothing
 * is remembered between visits.
 */

export const MAX_PHOTOS = 6;
/** Long edge of a prepared photo. The photo analyser works at about this size anyway. */
export const LONG_EDGE = 1600;
/** The server's per-photo cap for analysis. Prepared photos are far under it. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Where a signed-out kitchen's photos live (the `#/local` kitchen). */
export const LOCAL_KITCHEN_KEY = 'local';
/** The "Start from a photo" flow's own draft. */
export const DRAFT_KEY = 'draft';

export interface StoredPhoto {
  id: string;
  blob: Blob;
  name: string;
  /** Set once the photo is uploaded to the account (files API). */
  fileId?: string;
}

const OK_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class PhotoError extends Error {}

function decodeWithImg(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode'));
    };
    img.src = url;
  });
}

const jpegName = (name: string) => `${(name || 'photo').replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 80) || 'photo'}.jpg`;

/**
 * Decodes a photo (upright, from its EXIF orientation), shrinks it to `LONG_EDGE` and re-encodes
 * it as JPEG. Phone photos go from 3–12 MB to a few hundred KB, which keeps uploads quick on a
 * phone connection and every photo well under the analyser's 5 MB cap.
 */
export async function preparePhoto(file: File): Promise<{ blob: Blob; name: string }> {
  let source: ImageBitmap | HTMLImageElement | null = null;
  let w = 0;
  let h = 0;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    source = bmp;
    w = bmp.width;
    h = bmp.height;
  } catch {
    try {
      const img = await decodeWithImg(file);
      source = img;
      w = img.naturalWidth;
      h = img.naturalHeight;
    } catch {
      source = null;
    }
  }
  if (!source || !w || !h) {
    throw new PhotoError(`“${file.name || 'That photo'}” can’t be opened here. Use a JPEG, PNG or WebP photo (on an iPhone, Settings → Camera → Formats → Most Compatible).`);
  }
  const k = Math.min(1, LONG_EDGE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext('2d');
  if (g) {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, cw, ch);
    g.drawImage(source, 0, 0, cw, ch);
  }
  if ('close' in source && typeof source.close === 'function') source.close();
  const blob = g ? await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86)) : null;
  if (blob) return { blob, name: jpegName(file.name) };
  // No canvas encoder: send the original if the server can take it.
  if (OK_TYPES.has(file.type) && file.size <= MAX_PHOTO_BYTES) return { blob: file, name: file.name || 'photo.jpg' };
  throw new PhotoError(`“${file.name || 'That photo'}” is too large to use here. Export a smaller copy (a phone’s “medium” size is plenty).`);
}

export const newPhotoId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ─── IndexedDB ───────────────────────────────────────────────────────────

const DB_NAME = 'blumodel-generate';
/** The same database under its name from before the rename to BluModel Studio. */
const LEGACY_DB_NAME = 'mise-generate';
const STORE = 'photos';

function openCurrentDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Opens the pre-rename database only if it exists (never creates it). */
function openLegacyDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(LEGACY_DB_NAME);
      // An upgrade means it didn't exist: abort, so the open fails and creates nothing.
      req.onupgradeneeded = () => req.transaction?.abort();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const done = (tx: IDBTransaction) =>
  new Promise<boolean>((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = tx.onabort = () => resolve(false);
  });

/**
 * Photos kept on this device before the rename (the signed-out kitchen's and the "Start from a
 * photo" draft's) move once into the current database: each key is copied unless the current
 * database already has it, then the old database is deleted. Any failure leaves the old
 * database for the next visit. Never rejects.
 */
async function moveLegacyPhotos(): Promise<void> {
  try {
    if (typeof indexedDB === 'undefined') return;
    if (typeof indexedDB.databases === 'function') {
      const names = (await indexedDB.databases()).map((d) => d.name);
      if (!names.includes(LEGACY_DB_NAME)) return;
    }
    const old = await openLegacyDb();
    if (!old) return;
    const rows: [IDBValidKey, unknown][] = [];
    if (old.objectStoreNames.contains(STORE)) {
      const tx = old.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const keys = store.getAllKeys();
      const values = store.getAll();
      const ok = await done(tx);
      if (!ok) return old.close();
      keys.result.forEach((k, i) => rows.push([k, values.result[i]]));
    }
    old.close();
    if (rows.length) {
      const db = await openCurrentDb();
      if (!db) return;
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const [key, value] of rows) {
        const has = store.count(key);
        has.onsuccess = () => {
          if (!has.result) store.put(value, key);
        };
      }
      const ok = await done(tx);
      db.close();
      if (!ok) return;
    }
    indexedDB.deleteDatabase(LEGACY_DB_NAME);
  } catch {
    // Leave the old database for next time.
  }
}

let legacyMoved: Promise<void> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  legacyMoved ??= moveLegacyPhotos();
  return legacyMoved.then(openCurrentDb);
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | null): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      let value: T | null = null;
      if (req) req.onsuccess = () => (value = req.result);
      tx.oncomplete = () => {
        db.close();
        resolve(value);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        resolve(null);
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

/** Keeps these photos on this device under `key` (replacing what was there). False if it can't. */
export async function savePhotos(key: string, photos: StoredPhoto[]): Promise<boolean> {
  const rows = photos.slice(0, MAX_PHOTOS).map(({ id, blob, name, fileId }) => ({ id, blob, name, ...(fileId ? { fileId } : {}) }));
  const done = await withStore('readwrite', (s) => s.put(rows, key));
  return done !== null;
}

export async function loadPhotos(key: string): Promise<StoredPhoto[]> {
  const rows = await withStore<unknown>('readonly', (s) => s.get(key));
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is StoredPhoto => !!r && typeof r === 'object' && (r as StoredPhoto).blob instanceof Blob && typeof (r as StoredPhoto).id === 'string');
}

export async function deletePhotos(key: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(key));
}

// ─── The draft's model (small: localStorage) ─────────────────────────────

const DRAFT_MODEL = 'blumodel-generate-draft';

export interface DraftState {
  step: 'photos' | 'space';
  model: unknown;
  /** Where the model came from: the photo analyser or the defaults. */
  source: 'analysis' | 'manual';
  name: string;
}

export function loadDraftState(): DraftState | null {
  try {
    const raw = localStorage.getItem(DRAFT_MODEL);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object' || (v.step !== 'photos' && v.step !== 'space')) return null;
    return { step: v.step, model: v.model, source: v.source === 'analysis' ? 'analysis' : 'manual', name: typeof v.name === 'string' ? v.name.slice(0, 120) : '' };
  } catch {
    return null;
  }
}

export function saveDraftState(state: DraftState) {
  try {
    localStorage.setItem(DRAFT_MODEL, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the flow still works for this visit.
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_MODEL);
  } catch {
    // ignore
  }
  void deletePhotos(DRAFT_KEY);
}
