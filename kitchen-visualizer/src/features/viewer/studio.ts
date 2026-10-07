import { create } from 'zustand';

/**
 * The seam between the room's 3D view and the Studio render dialog. Plain TypeScript (no three):
 * the TopBar's RenderButton lives in the main chunk and imports this.
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

const Q_KEY = 'mise.room.quality';
const T_KEY = 'mise.room.tonemap';

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

interface StudioState {
  open: boolean;
  /** Download as soon as a render is ready (the resume after paying for an unlock). */
  autoDownload: boolean;
}

export const useStudio = create<StudioState>()(() => ({ open: false, autoDownload: false }));

/** Opens the Studio render dialog (from the TopBar, or after an unlock to finish the download). */
export function openStudioRender(opts: { autoDownload?: boolean } = {}) {
  useStudio.setState({ open: true, autoDownload: !!opts.autoDownload });
}

export function closeStudioRender() {
  useStudio.setState({ open: false, autoDownload: false });
}
