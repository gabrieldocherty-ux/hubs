/**
 * One rectangle of a room's floor. When its flooring changes, the new floor is laid across the old
 * one row by row (about a second): each row of planks or tiles runs in from the room's west side a
 * little behind the row before, the old floor showing until it's covered, the way a floor goes down.
 * Nothing animates on first show, for someone who prefers reduced motion, or while dragging.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { worldUVBox } from './geom3d';
import { floorLayCued } from '../../lib/floorLay';

export interface FloorRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const LAY_MS = 1100;
/** Inches between staggered rows (a plank's width or a small tile). */
const ROW_IN = 8;

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** A copy of `base` that hides everything not yet "laid": x beyond the moving edge, staggered per row. */
function layingMaterial(base: THREE.Material, uniforms: { uEdge: { value: number }; uRow: { value: number } }): THREE.Material {
  const m = base.clone();
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uEdge = uniforms.uEdge;
    shader.uniforms.uRow = uniforms.uRow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLayPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLayPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLayPos;\nuniform float uEdge;\nuniform float uRow;')
      .replace(
        'void main() {',
        `void main() {
  float row = floor(vLayPos.z / uRow);
  float lag = fract(sin(row * 12.9898) * 43758.5453) * uRow * 2.5 + mod(row, 2.0) * uRow * 0.8;
  if (vLayPos.x > uEdge - lag) discard;`,
      );
  };
  m.customProgramCacheKey = () => 'floor-laying';
  return m;
}

export function FloorPiece({ rect, mat, tileIn }: { rect: FloorRect; mat: THREE.Material; tileIn: number }) {
  const invalidate = useThree((s) => s.invalidate);
  const geo = useMemo(() => worldUVBox([rect.x1 - rect.x0, 0.5, rect.y1 - rect.y0], [(rect.x0 + rect.x1) / 2, -0.25, (rect.y0 + rect.y1) / 2], null, tileIn), [rect.x0, rect.y0, rect.x1, rect.y1, tileIn]);
  useEffect(() => () => geo.dispose(), [geo]);

  // The floor that was there, kept (with its own UV scale) while the new one is laid over it.
  const shown = useRef<{ mat: THREE.Material; tileIn: number } | null>(null);
  const [laying, setLaying] = useState<{ old: { mat: THREE.Material; tileIn: number }; t0: number } | null>(null);
  const uniforms = useMemo(() => ({ uEdge: { value: -1e6 }, uRow: { value: ROW_IN / 12 } }), []);
  const layMat = useMemo(() => (laying ? layingMaterial(mat, uniforms) : null), [laying, mat, uniforms]);
  useEffect(() => () => layMat?.dispose(), [layMat]);

  useEffect(() => {
    const prev = shown.current;
    shown.current = { mat, tileIn };
    // Only a floor someone just picked is laid; a design loading or a scene switching just shows its floor.
    if (!prev || prev.mat === mat || reduced() || !floorLayCued()) return;
    setLaying({ old: prev, t0: performance.now() });
    invalidate();
  }, [mat, tileIn, invalidate]);

  const oldGeo = useMemo(
    () => (laying ? worldUVBox([rect.x1 - rect.x0, 0.5, rect.y1 - rect.y0], [(rect.x0 + rect.x1) / 2, -0.26, (rect.y0 + rect.y1) / 2], null, laying.old.tileIn) : null),
    [laying, rect.x0, rect.y0, rect.x1, rect.y1],
  );
  useEffect(() => () => oldGeo?.dispose(), [oldGeo]);

  useFrame(() => {
    if (!laying) return;
    const t = Math.min(1, (performance.now() - laying.t0) / LAY_MS);
    const ease = 1 - Math.pow(1 - t, 2);
    // World feet (the room's group is scaled 1/12): from before the west edge to past the east one,
    // far enough that the most-lagging row is covered at the end.
    const from = rect.x0 / 12 - 0.1;
    const to = rect.x1 / 12 + (ROW_IN / 12) * 3.5;
    uniforms.uEdge.value = from + (to - from) * ease;
    if (t >= 1) setLaying(null);
    else invalidate();
  });

  if (laying && layMat && oldGeo) {
    return (
      <>
        <mesh geometry={oldGeo} material={laying.old.mat} receiveShadow />
        <mesh geometry={geo} material={layMat} receiveShadow />
      </>
    );
  }
  return <mesh geometry={geo} material={mat} receiveShadow />;
}
