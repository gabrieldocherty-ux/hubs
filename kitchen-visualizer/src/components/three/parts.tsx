import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { DoorStyle, Finish } from '../../types';
import type { Resolved } from '../../lib/geometry';
import { boxGeo, scaleUV, worldUVBox } from './geom3d';
import type { FrontSpec, PullSpec } from '../../lib/fronts';
export { baseFronts, type FrontSpec, type PullSpec } from '../../lib/fronts';
import { cached, finishMaterial, flutedMaterial } from './materials';

export interface SceneCtx {
  counterMat: THREE.Material;
  counterTile: number;
  counterIsStone: boolean;
  splashMat: THREE.Material;
  splashTile: number;
  cabinet: Finish;
  doorStyle: DoorStyle;
  hwMat: THREE.Material;
  ceiling: number;
  paintHex: string;
}

type V3 = [number, number, number];

export function Box({ size, pos, mat, rot, cast = true, receive = true }: { size: V3; pos: V3; mat: THREE.Material; rot?: V3; cast?: boolean; receive?: boolean }) {
  return <mesh geometry={boxGeo(size[0], size[1], size[2])} position={pos} rotation={rot} material={mat} castShadow={cast} receiveShadow={receive} dispose={null} />;
}

const cylCache = new Map<string, THREE.CylinderGeometry>();
export function cylGeo(rt: number, rb: number, h: number, seg = 16, open = false): THREE.CylinderGeometry {
  const key = `${rt}|${rb}|${h}|${seg}|${open}`;
  let g = cylCache.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    cylCache.set(key, g);
  }
  return g;
}

export function Cyl({ r, rb, h, pos, mat, rot, seg = 16, cast = true }: { r: number; rb?: number; h: number; pos: V3; mat: THREE.Material; rot?: V3; seg?: number; cast?: boolean }) {
  return <mesh geometry={cylGeo(r, rb ?? r, h, seg)} position={pos} rotation={rot} material={mat} castShadow={cast} receiveShadow dispose={null} />;
}


/** A bar pull on two posts, projecting from a front whose face is at `z`. */
export function Pull({ spec, z, mat }: { spec: PullSpec; z: number; mat: THREE.Material }) {
  if (!spec) return null;
  const { dir, x, y, len } = spec;
  const off = 1.1;
  const horizontal = dir === 'h';
  const post = (p: number) => (horizontal ? ([x + p, y, z + off / 2] as V3) : ([x, y + p, z + off / 2] as V3));
  return (
    <group>
      <Cyl r={0.26} h={len} pos={[x, y, z + off]} rot={horizontal ? [0, 0, Math.PI / 2] : [0, 0, 0]} mat={mat} seg={10} />
      <Cyl r={0.2} h={off} pos={post(-len / 2 + 0.6)} rot={[Math.PI / 2, 0, 0]} mat={mat} seg={8} />
      <Cyl r={0.2} h={off} pos={post(len / 2 - 0.6)} rot={[Math.PI / 2, 0, 0]} mat={mat} seg={8} />
    </group>
  );
}


const REVEAL = 0.125;
const T = 0.75;

/** One door or drawer face in the kitchen's door style, face-forward (+z) from `z`. */
export function Front({ f, z, finish, style, hw }: { f: FrontSpec; z: number; finish: Finish; style: DoorStyle; hw: THREE.Material }) {
  const w = f.w - REVEAL * 2;
  const h = f.h - REVEAL * 2;
  const cx = f.x;
  const cy = f.y + f.h / 2;
  const mat = finishMaterial(finish);
  const rail = Math.max(1.2, Math.min(2.75, w * 0.18, h * 0.18));
  const flutedGeo = useMemo(() => (style === 'fluted' && !f.glass ? scaleUV(new THREE.BoxGeometry(w, h, T), w / 1.25, 1) : null), [style, w, h, f.glass]);
  useEffect(() => () => flutedGeo?.dispose(), [flutedGeo]);

  let face: JSX.Element;
  if (f.glass) {
    const glass = cached('cabGlass', () => new THREE.MeshPhysicalMaterial({ color: '#e8eef0', roughness: 0.35, transparent: true, opacity: 0.35, depthWrite: false }));
    face = (
      <group>
        <Box size={[w, rail, T]} pos={[cx, cy + h / 2 - rail / 2, z + T / 2]} mat={mat} />
        <Box size={[w, rail, T]} pos={[cx, cy - h / 2 + rail / 2, z + T / 2]} mat={mat} />
        <Box size={[rail, h - rail * 2, T]} pos={[cx - w / 2 + rail / 2, cy, z + T / 2]} mat={mat} />
        <Box size={[rail, h - rail * 2, T]} pos={[cx + w / 2 - rail / 2, cy, z + T / 2]} mat={mat} />
        <mesh geometry={boxGeo(w - rail * 2, h - rail * 2, 0.2)} position={[cx, cy, z + T * 0.4]} material={glass} dispose={null} />
      </group>
    );
  } else if (style === 'shaker' && w > 6 && h > 5) {
    face = (
      <group>
        <Box size={[w, rail, T]} pos={[cx, cy + h / 2 - rail / 2, z + T / 2]} mat={mat} />
        <Box size={[w, rail, T]} pos={[cx, cy - h / 2 + rail / 2, z + T / 2]} mat={mat} />
        <Box size={[rail, h - rail * 2, T]} pos={[cx - w / 2 + rail / 2, cy, z + T / 2]} mat={mat} />
        <Box size={[rail, h - rail * 2, T]} pos={[cx + w / 2 - rail / 2, cy, z + T / 2]} mat={mat} />
        <Box size={[w - rail * 2, h - rail * 2, T * 0.45]} pos={[cx, cy, z + T * 0.22]} mat={mat} />
      </group>
    );
  } else if (flutedGeo) {
    face = <mesh geometry={flutedGeo} position={[cx, cy, z + T / 2]} material={flutedMaterial(finish)} castShadow receiveShadow />;
  } else {
    face = <Box size={[w, h, T]} pos={[cx, cy, z + T / 2]} mat={mat} />;
  }
  return (
    <group>
      {face}
      <Pull spec={f.pull} z={z + T} mat={hw} />
    </group>
  );
}

/** Countertop pieces around rectangular cutouts, with UVs that flow across neighbouring cabinets. */
export function Counter({ r, ctx, x0, x1, z0, z1, cutouts = [], yTop = 36, thick = 1.5 }: { r: Resolved; ctx: SceneCtx; x0: number; x1: number; z0: number; z1: number; cutouts?: { x0: number; x1: number; z0: number; z1: number }[]; yTop?: number; thick?: number }) {
  const { x, y, rotation } = r.item;
  const geos = useMemo(() => {
    const xf = { x, y, rotation };
    const yc = yTop - thick / 2;
    const out: THREE.BufferGeometry[] = [];
    const add = (a0: number, a1: number, b0: number, b1: number) => {
      if (a1 - a0 > 0.05 && b1 - b0 > 0.05) out.push(worldUVBox([a1 - a0, thick, b1 - b0], [(a0 + a1) / 2, yc, (b0 + b1) / 2], xf, ctx.counterTile));
    };
    if (!cutouts.length) {
      add(x0, x1, z0, z1);
      return out;
    }
    const cz0 = Math.min(...cutouts.map((c) => c.z0));
    const cz1 = Math.max(...cutouts.map((c) => c.z1));
    add(x0, x1, z0, cz0);
    add(x0, x1, cz1, z1);
    const xs = [...cutouts].sort((a, b) => a.x0 - b.x0);
    let cursor = x0;
    for (const c of xs) {
      add(cursor, c.x0, cz0, cz1);
      cursor = c.x1;
    }
    add(cursor, x1, cz0, cz1);
    return out;
  }, [x, y, rotation, x0, x1, z0, z1, JSON.stringify(cutouts), yTop, thick, ctx.counterTile]);
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
  return (
    <group>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={ctx.counterMat} castShadow receiveShadow />
      ))}
    </group>
  );
}

const faucetCache = new Map<string, THREE.TubeGeometry>();
function faucetGeo(bridge: boolean): THREE.TubeGeometry {
  const key = bridge ? 'bridge' : 'goose';
  let g = faucetCache.get(key);
  if (!g) {
    const pts = bridge
      ? [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 9, 0), new THREE.Vector3(0, 12.5, 2.2), new THREE.Vector3(0, 11.5, 6.5), new THREE.Vector3(0, 8.5, 7.2)]
      : [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 11, 0), new THREE.Vector3(0, 15, 3), new THREE.Vector3(0, 13.2, 8), new THREE.Vector3(0, 9.5, 8.6)];
    g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.5, 12, false);
    faucetCache.set(key, g);
  }
  return g;
}

export function Faucet({ z, y = 36, mat, bridge = false }: { z: number; y?: number; mat: THREE.Material; bridge?: boolean }) {
  return (
    <group position={[0, y, z]}>
      <Cyl r={1.1} h={1.4} pos={[0, 0.7, 0]} mat={mat} />
      <mesh geometry={faucetGeo(bridge)} material={mat} castShadow dispose={null} position={[0, 1.2, 0]} />
      <Box size={[0.5, 0.5, 3]} pos={[2, 4, 0.8]} rot={[-0.4, 0, 0]} mat={mat} />
      {bridge && <Box size={[0.5, 0.5, 3]} pos={[-2, 4, 0.8]} rot={[-0.4, 0, 0]} mat={mat} />}
    </group>
  );
}

/** Open-topped basin hung under a countertop cutout. */
export function Basin({ cx, cz, w, d, depth = 9, top = 34.5, mat, wall = 0.45 }: { cx: number; cz: number; w: number; d: number; depth?: number; top?: number; mat: THREE.Material; wall?: number }) {
  const y0 = top - depth;
  return (
    <group>
      <Box size={[w, wall, d]} pos={[cx, y0 + wall / 2, cz]} mat={mat} />
      <Box size={[w, depth, wall]} pos={[cx, y0 + depth / 2, cz - d / 2 + wall / 2]} mat={mat} />
      <Box size={[w, depth, wall]} pos={[cx, y0 + depth / 2, cz + d / 2 - wall / 2]} mat={mat} />
      <Box size={[wall, depth, d]} pos={[cx - w / 2 + wall / 2, y0 + depth / 2, cz]} mat={mat} />
      <Box size={[wall, depth, d]} pos={[cx + w / 2 - wall / 2, y0 + depth / 2, cz]} mat={mat} />
      <Cyl r={1.2} h={0.1} pos={[cx, y0 + wall + 0.06, cz]} mat={cached('drain', () => new THREE.MeshStandardMaterial({ color: '#555', metalness: 0.8, roughness: 0.3 }))} />
    </group>
  );
}
