/**
 * Headless-QA statistics for a canvas (BUILD_PLAN A-T3): with `?qa` in the page URL,
 * `window.__miseQa = { canvas, frames, calls, programs, triangles, lastFrameAt }` plus whatever a
 * view adds with `qaSet`. Inert without the flag. Kept apart from roomEffects so the product stage
 * can use it without pulling in the postprocessing chunk.
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { QA } from '../../lib/qa';

interface QaWindow {
  __miseQa?: Record<string, unknown>;
}

/** Merges values into `window.__miseQa` (only with `?qa` in the page URL). */
export function qaSet(values: Record<string, unknown>) {
  if (!QA) return;
  const w = window as unknown as QaWindow;
  w.__miseQa = Object.assign(w.__miseQa ?? {}, values);
}

/**
 * Frame and draw statistics for headless checks. Counts every rendered frame; `calls`,
 * `triangles` are the totals of the last complete frame (all composer passes), `programs` the
 * number of compiled shader programs. They are live getters on the renderer's counters: a
 * demand-driven canvas goes idle right after a frame, so a value copied at the start of each frame
 * would stay one frame stale for as long as it idles. Mounted only with `?qa`.
 */
export function QaStats({ name }: { name: string }) {
  const gl = useThree((s) => s.gl);
  const frames = useRef(0);
  useEffect(() => {
    gl.info.autoReset = false;
    gl.info.reset();
    qaSet({ canvas: name, frames: 0 });
    const w = window as unknown as QaWindow;
    const q = (w.__miseQa ??= {});
    const live: [string, () => number][] = [
      ['calls', () => gl.info.render.calls],
      ['triangles', () => gl.info.render.triangles],
      ['programs', () => gl.info.programs?.length ?? 0],
    ];
    for (const [k, get] of live) Object.defineProperty(q, k, { get, configurable: true, enumerable: true });
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl, name]);
  // Runs first in each frame: count it, then start the frame's totals afresh.
  useFrame(() => {
    frames.current++;
    qaSet({ canvas: name, frames: frames.current, lastFrameAt: performance.now() });
    gl.info.reset();
  }, -1000);
  return null;
}
