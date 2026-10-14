import { create } from 'zustand';

/**
 * The seam between the room's 3D view and the Studio render dialog. Plain TypeScript (no three),
 * loaded only by the lazy 3D view and the lazy dialog; the TopBar's RenderButton (main chunk)
 * imports just the small open/close store in studioDialog.ts.
 *
 * The 3D view registers a still renderer while it is mounted; the dialog asks it for an
 * offscreen render at any size. Room quality settings (Fast/High, tone mapping) live here too,
 * kept in localStorage, so the dialog and the on-screen view agree.
 */

export type StudioCamera = 'current' | 'overview' | 'eye' | 'front';
export type StudioQuality = 'high' | 'fast';
export type ToneMap = 'neutral' | 'agx' | 'aces';

export interface StillOptions {
  width: number;
  height: number;
  camera: StudioCamera;
  quality: StudioQuality;
  toneMap: ToneMap;
}

/** Renders the kitchen offscreen; resolves to a canvas of exactly width × height. */
export type StillRenderer = (o: StillOptions) => Promise<HTMLCanvasElement>;

interface Registered {
  render: StillRenderer;
  /** Longest side this GPU can render offscreen: min(4096, max texture / renderbuffer / viewport size). */
  maxSide: number;
}

let still: Registered | null = null;
const waiters = new Set<() => void>();

export function registerStillRenderer(r: Registered | null) {
  still = r;
  if (r) {
    waiters.forEach((w) => w());
    waiters.clear();
  }
}

export function stillRenderer(): Registered | null {
  return still;
}

/** Resolves once the 3D view is mounted and ready to render (or null after `ms`). */
export function waitForStillRenderer(ms = 8000): Promise<Registered | null> {
  if (still) return Promise.resolve(still);
  return new Promise((resolve) => {
    const done = () => {
      window.clearTimeout(t);
      waiters.delete(done);
      resolve(still);
    };
    const t = window.setTimeout(done, ms);
    waiters.add(done);
  });
}

/** Fits a requested size under the long-side cap, keeping the aspect ratio. */
export function capSize(width: number, height: number, maxSide: number): { width: number; height: number; capped: boolean } {
  const long = Math.max(width, height);
  if (long <= maxSide) return { width, height, capped: false };
  const k = maxSide / long;
  return { width: Math.round(width * k), height: Math.round(height * k), capped: true };
}

// ── room quality (on screen) ─────────────────────────────────────────────

const Q_KEY = 'blumodel.room.quality';
const T_KEY = 'blumodel.room.tonemap';

function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage blocked: the choice lasts for this visit */
  }
}

/**
 * Room tone mapping default: Khronos PBR Neutral (decision and A/B screenshots in
 * docs/handoff/viewer.md). ACES stays selectable only for the A/B comparison.
 */
export const DEFAULT_TONEMAP: ToneMap = 'neutral';

interface QualityState {
  quality: StudioQuality;
  toneMap: ToneMap;
  /** Set by the frame-time governor when the device can't keep up: lower DPR, then no AO. */
  degraded: 0 | 1 | 2;
  setQuality(q: StudioQuality): void;
  setToneMap(t: ToneMap): void;
  setDegraded(d: 0 | 1 | 2): void;
}

export const useRoomQuality = create<QualityState>()((set) => ({
  quality: read(Q_KEY, ['high', 'fast'] as const, 'high'),
  toneMap: read(T_KEY, ['neutral', 'agx', 'aces'] as const, DEFAULT_TONEMAP),
  degraded: 0,
  setQuality: (quality) => {
    write(Q_KEY, quality);
    set({ quality, degraded: 0 });
  },
  setToneMap: (toneMap) => {
    write(T_KEY, toneMap);
    set({ toneMap });
  },
  setDegraded: (degraded) => set({ degraded }),
}));

// ── the dialog ───────────────────────────────────────────────────────────

/** The Studio render sizes (PRODUCT_SPEC §5.5); the long side is capped per GPU at render time. */
export const STUDIO_SIZES = [
  { id: '1080', label: '1080p', width: 1920, height: 1080 },
  { id: '1440', label: '1440p', width: 2560, height: 1440 },
  { id: '4k', label: '4K', width: 3840, height: 2160 },
] as const;
export type StudioSize = (typeof STUDIO_SIZES)[number]['id'];

/** What the dialog renders with; remembered on this device (it survives the trip to checkout). */
export interface StudioPrefs {
  camera: StudioCamera;
  size: StudioSize;
  quality: StudioQuality;
  toneMap: Exclude<ToneMap, 'aces'>;
}

const P_KEY = 'blumodel.studio.prefs';
export const DEFAULT_STUDIO_PREFS: StudioPrefs = { camera: 'current', size: '1080', quality: 'high', toneMap: 'neutral' };

/** Reads saved prefs, keeping only known values (anything else falls back to the default). */
export function parsePrefs(raw: string | null): StudioPrefs {
  let v: Partial<Record<keyof StudioPrefs, unknown>> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') v = parsed;
  } catch {
    /* corrupt: defaults */
  }
  const pick = <T extends string>(x: unknown, allowed: readonly T[], d: T): T => (allowed.includes(x as T) ? (x as T) : d);
  return {
    camera: pick(v.camera, ['current', 'overview', 'eye', 'front'] as const, DEFAULT_STUDIO_PREFS.camera),
    size: pick(v.size, STUDIO_SIZES.map((s) => s.id), DEFAULT_STUDIO_PREFS.size),
    quality: pick(v.quality, ['high', 'fast'] as const, DEFAULT_STUDIO_PREFS.quality),
    toneMap: pick(v.toneMap, ['neutral', 'agx'] as const, DEFAULT_STUDIO_PREFS.toneMap),
  };
}

function readPrefs(): StudioPrefs {
  try {
    return parsePrefs(localStorage.getItem(P_KEY));
  } catch {
    return { ...DEFAULT_STUDIO_PREFS };
  }
}

/** The pixel size and full options for a set of prefs. */
export function stillOptionsFor(p: StudioPrefs): StillOptions {
  const s = STUDIO_SIZES.find((x) => x.id === p.size) ?? STUDIO_SIZES[0];
  return { width: s.width, height: s.height, camera: p.camera, quality: p.quality, toneMap: p.toneMap };
}

/** `<kitchen>-render-<w>x<h>.png` (BUILD_PLAN A-T8). */
export function renderFilename(kitchenSlug: string, width: number, height: number): string {
  return `${kitchenSlug || 'kitchen'}-render-${width}x${height}.png`;
}

interface StudioPrefsState {
  prefs: StudioPrefs;
  setPrefs(p: Partial<StudioPrefs>): void;
}

export const useStudioPrefs = create<StudioPrefsState>()((set, get) => ({
  prefs: readPrefs(),
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    write(P_KEY, JSON.stringify(prefs));
    set({ prefs });
  },
}));
