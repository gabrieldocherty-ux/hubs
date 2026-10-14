/**
 * Room rendering quality and cost (BUILD_PLAN A-T3, A-T4):
 *
 *  - `RoomEffects`: an EffectComposer (MSAA 4; the Canvas itself has antialias off) with N8AO
 *    ambient occlusion (half resolution, medium quality) and the tone mapping last. High quality
 *    keeps AO on; Fast, or a device the governor flags as slow, turns it off. Memoised with no
 *    props: the composer rebuilds its passes whenever its children change.
 *  - `FrameGovernor`: drei's PerformanceMonitor counts frames per time window, which reads a
 *    demand-driven canvas (no frames while idle) as a slow device. This one only measures runs
 *    of consecutive frames (an orbit, a drag) and steps down DPR, then AO, when they're slow.
 *  - `QaStats` (qaStats.tsx, re-exported): with `?qa`, `window.__miseQa = { frames, calls, programs, triangles }`.
 */
import { memo, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, N8AO, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode, type EffectComposer as EffectComposerImpl, type ToneMappingEffect } from 'postprocessing';
import * as THREE from 'three';
import { useRoomQuality, type ToneMap } from '../../features/viewer/studio';

/** The N8AO pass (typed loosely: n8ao ships no types for the pass object). */
export interface AoPass {
  enabled: boolean;
  configuration: { halfRes: boolean; aoRadius: number; intensity: number };
  setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
}

export interface EffectsHandle {
  composer: EffectComposerImpl | null;
  ao: AoPass | null;
  tone: ToneMappingEffect | null;
}

/** The mounted room's effect chain, for the studio render (one room view at a time). */
export const roomEffects: EffectsHandle = { composer: null, ao: null, tone: null };

export function toneMode(t: ToneMap): ToneMappingMode {
  return t === 'agx' ? ToneMappingMode.AGX : t === 'aces' ? ToneMappingMode.ACES_FILMIC : ToneMappingMode.NEUTRAL;
}

/** The same choice for a renderer without the composer (the product stage). */
export function threeToneMapping(t: ToneMap): THREE.ToneMapping {
  return t === 'agx' ? THREE.AgXToneMapping : t === 'aces' ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
}

/** Ambient occlusion radius and strength, in room units (feet). */
export const AO = { radius: 1.5, intensity: 2 } as const;

export const RoomEffects = memo(function RoomEffects() {
  const quality = useRoomQuality((s) => s.quality);
  const toneMap = useRoomQuality((s) => s.toneMap);
  const degraded = useRoomQuality((s) => s.degraded);
  const invalidate = useThree((s) => s.invalidate);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const composer = useRef<EffectComposerImpl>(null);
  const ao = useRef<AoPass>(null);
  const tone = useRef<ToneMappingEffect>(null);
  const aoOn = quality === 'high' && degraded < 2;

  useEffect(() => {
    roomEffects.composer = composer.current;
    roomEffects.ao = ao.current;
    roomEffects.tone = tone.current;
    return () => {
      roomEffects.composer = roomEffects.ao = roomEffects.tone = null;
    };
  });

  useEffect(() => {
    if (ao.current) ao.current.enabled = aoOn;
    invalidate();
  }, [aoOn, invalidate]);

  // The composer resizes with the canvas but not with a DPR change; follow both.
  useEffect(() => {
    composer.current?.setSize(size.width, size.height, false);
    invalidate();
  }, [dpr, size.width, size.height, invalidate]);

  return (
    <EffectComposer ref={composer} multisampling={4}>
      {/* N8AO's types don't declare its ref; it forwards the N8AOPostPass. */}
      <N8AO ref={ao as never} halfRes quality="medium" aoRadius={AO.radius} intensity={AO.intensity} distanceFalloff={1} />
      <ToneMapping ref={tone as never} mode={toneMode(toneMap)} />
    </EffectComposer>
  );
});

/**
 * Watches runs of consecutive frames (gaps under 120 ms: an orbit, a drag, a tween) and, when the
 * median frame takes over 45 ms for two runs in a row, steps down: first DPR 1.5 → 1, then AO
 * off. Idle gaps are ignored, so a demand-driven canvas never looks slow by standing still.
 */
export function FrameGovernor({ busy }: { busy?: () => boolean }) {
  const setDegraded = useRoomQuality((s) => s.setDegraded);
  const degraded = useRoomQuality((s) => s.degraded);
  const setDpr = useThree((s) => s.setDpr);
  const st = useRef({ last: 0, run: [] as number[], slowRuns: 0 });

  useEffect(() => {
    setDpr(degraded >= 1 ? 1 : [1, 1.5]);
  }, [degraded, setDpr]);

  useFrame(() => {
    const now = performance.now();
    const s = st.current;
    const gap = now - s.last;
    s.last = now;
    if (busy?.() || gap > 120) {
      s.run = [];
      return;
    }
    s.run.push(gap);
    if (s.run.length < 30) return;
    const sorted = [...s.run].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    s.run = [];
    s.slowRuns = median > 45 ? s.slowRuns + 1 : 0;
    if (s.slowRuns >= 2 && degraded < 2) {
      s.slowRuns = 0;
      setDegraded((degraded + 1) as 1 | 2);
    }
  });
  return null;
}

export { QaStats, qaSet } from './qaStats';
