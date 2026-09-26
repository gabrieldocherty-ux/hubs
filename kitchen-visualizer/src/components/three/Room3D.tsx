import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Room, Surfaces } from '../../types';
import { alongWall, backsplashSegments, flushWall, WALLS, type Resolved, type Wall } from '../../lib/geometry';
import { isOpening } from '../../data/catalog';
import { FLOORING, PAINTS, byId } from '../../data/finishes';
import { resolveFinish } from '../../lib/finish';
import { luminance, shade } from '../../lib/color';
import { Box, Front, type SceneCtx } from './parts';
import { M, cached, finishMaterial, skyMaterial, surfaceMaterial } from './materials';
import { boxGeo, worldUVBox } from './geom3d';
import { SelectionEdges } from './SelectionEdges';

const T = 5;

interface Props {
  room: Room;
  all: Resolved[];
  surfaces: Surfaces;
  ctx: SceneCtx;
  selectedId: string | null;
  problemIds: Set<string>;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}

interface Piece {
  a0: number;
  a1: number;
  y0: number;
  y1: number;
}

function wallPieces(start: number, end: number, height: number, openings: { s: number; e: number; z0: number; z1: number }[]): Piece[] {
  const out: Piece[] = [];
  let cursor = start;
  for (const o of [...openings].sort((a, b) => a.s - b.s)) {
    const s = Math.max(o.s, cursor);
    if (s > cursor + 0.01) out.push({ a0: cursor, a1: s, y0: 0, y1: height });
    if (o.e <= s) continue;
    if (o.z0 > 0.01) out.push({ a0: s, a1: o.e, y0: 0, y1: Math.min(o.z0, height) });
    if (o.z1 < height - 0.01) out.push({ a0: s, a1: o.e, y0: o.z1, y1: height });
    cursor = Math.max(cursor, o.e);
  }
  if (end > cursor + 0.01) out.push({ a0: cursor, a1: end, y0: 0, y1: height });
  return out;
}

/** Converts a span along a wall (a) at a depth into the room (inset) to a world-space box. */
function wallBox(wall: Wall, room: Room, a0: number, a1: number, y0: number, y1: number, z0: number, z1: number): { size: [number, number, number]; center: [number, number, number] } {
  const len = a1 - a0;
  const h = y1 - y0;
  const dep = z1 - z0;
  const am = (a0 + a1) / 2;
  const ym = (y0 + y1) / 2;
  const zm = (z0 + z1) / 2;
  switch (wall) {
    case 'north':
      return { size: [len, h, dep], center: [am, ym, zm] };
    case 'south':
      return { size: [len, h, dep], center: [am, ym, room.lengthIn - zm] };
    case 'west':
      return { size: [dep, h, len], center: [zm, ym, am] };
    case 'east':
      return { size: [dep, h, len], center: [room.widthIn - zm, ym, am] };
  }
}

export const Room3D = memo(function Room3D({ room, all, surfaces, ctx, selectedId, problemIds, onSelect, onHover }: Props) {
  const W = room.widthIn;
  const L = room.lengthIn;
  const H = room.ceilingIn;
  const floor = byId(FLOORING, surfaces.flooringId);
  const paint = byId(PAINTS, surfaces.paintId);
  const floorMat = surfaceMaterial(`floor:${floor.id}`, floor.pattern, floor.gloss);
  const wallMat = surfaceMaterial(`paint:${paint.id}`, paint.pattern, 0.05);
  const trimHex = luminance(paint.hex) < 0.2 ? shade(paint.hex, 0.05) : '#f3efe6';
  const trimMat = cached(`trim3d:${trimHex}`, () => new THREE.MeshStandardMaterial({ color: trimHex, roughness: 0.45 }));

  const floorGeo = useMemo(() => worldUVBox([W, 0.5, L], [W / 2, -0.25, L / 2], null, floorMat.tileIn), [W, L, floorMat.tileIn]);
  useEffect(() => () => floorGeo.dispose(), [floorGeo]);

  const openingsByWall = useMemo(() => {
    const map: Record<Wall, Resolved[]> = { north: [], east: [], south: [], west: [] };
    for (const r of all) {
      if (!isOpening(r.product)) continue;
      const wall = flushWall(r, room);
      if (wall) map[wall].push(r);
    }
    return map;
  }, [all, room]);

  const splash = useMemo(() => backsplashSegments(all, room), [all, room]);

  const wallGeos = useMemo(() => {
    const out: Record<Wall, { walls: THREE.BufferGeometry[]; base: { size: [number, number, number]; center: [number, number, number] }[]; caps: { size: [number, number, number]; center: [number, number, number] }[]; splash: THREE.BufferGeometry[] }> = {
      north: { walls: [], base: [], caps: [], splash: [] },
      east: { walls: [], base: [], caps: [], splash: [] },
      south: { walls: [], base: [], caps: [], splash: [] },
      west: { walls: [], base: [], caps: [], splash: [] },
    };
    for (const wall of WALLS) {
      const ns = wall === 'north' || wall === 'south';
      const len = ns ? W : L;
      const start = ns ? -T : 0;
      const end = ns ? len + T : len;
      const ops = openingsByWall[wall].map((r) => {
        const [s, e] = alongWall(wall, r.box);
        return { s, e, z0: r.z0, z1: r.z1 };
      });
      for (const p of wallPieces(start, end, H, ops)) {
        const b = wallBox(wall, room, p.a0, p.a1, p.y0, p.y1, -T, 0);
        out[wall].walls.push(worldUVBox(b.size, b.center, null, wallMat.tileIn));
        if (p.y0 === 0) {
          const a0 = Math.max(p.a0, 0);
          const a1 = Math.min(p.a1, len);
          if (a1 - a0 > 0.5) out[wall].base.push(wallBox(wall, room, a0, a1, 0, 4.5, 0, 0.6));
        }
        if (p.y1 >= H - 0.01) out[wall].caps.push(wallBox(wall, room, p.a0, p.a1, H, H + 0.6, -T - 0.05, 0.05));
      }
    }
    for (const seg of splash) {
      const b = wallBox(seg.wall, room, seg.start, seg.end, seg.bottom, seg.top, 0, 0.4);
      out[seg.wall].splash.push(worldUVBox(b.size, b.center, null, ctx.splashTile));
    }
    return out;
  }, [W, L, H, room, openingsByWall, splash, wallMat.tileIn, ctx.splashTile]);

  useEffect(
    () => () => {
      for (const wall of WALLS) {
        wallGeos[wall].walls.forEach((g) => g.dispose());
        wallGeos[wall].splash.forEach((g) => g.dispose());
      }
    },
    [wallGeos],
  );

  const groups = useRef<Record<Wall, THREE.Group | null>>({ north: null, east: null, south: null, west: null });
  const camLocal = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    camLocal.copy(camera.position).multiplyScalar(12);
    const g = groups.current;
    if (g.north) g.north.visible = camLocal.z > 0;
    if (g.south) g.south.visible = camLocal.z < L;
    if (g.west) g.west.visible = camLocal.x > 0;
    if (g.east) g.east.visible = camLocal.x < W;
  });

  return (
    <group>
      <mesh geometry={boxGeo(W + T * 2 + 36, 6, L + T * 2 + 36)} position={[W / 2, -3.5, L / 2]} material={M.plinth()} receiveShadow dispose={null} />
      <mesh geometry={floorGeo} material={floorMat.mat} receiveShadow />
      {WALLS.map((wall) => (
        <group key={wall} ref={(el) => (groups.current[wall] = el)}>
          {wallGeos[wall].walls.map((g, i) => (
            <mesh key={i} geometry={g} material={wallMat.mat} castShadow receiveShadow />
          ))}
          {wallGeos[wall].base.map((b, i) => (
            <Box key={`b${i}`} size={b.size} pos={b.center} mat={trimMat} />
          ))}
          {wallGeos[wall].caps.map((b, i) => (
            <Box key={`c${i}`} size={b.size} pos={b.center} mat={M.wallCap()} cast={false} />
          ))}
          {wallGeos[wall].splash.map((g, i) => (
            <mesh key={`s${i}`} geometry={g} material={ctx.splashMat} receiveShadow />
          ))}
          {openingsByWall[wall].map((r) => (
            <group
              key={r.item.id}
              position={[r.item.x, 0, r.item.y]}
              rotation={[0, (-r.item.rotation * Math.PI) / 180, 0]}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(r.item.id);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                onHover(r.item.id);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                onHover(null);
                document.body.style.cursor = '';
              }}
            >
              {r.product.kind === 'window' ? <WindowModel r={r} surfaces={surfaces} /> : <DoorModel r={r} surfaces={surfaces} ctx={ctx} />}
              {(r.item.id === selectedId || problemIds.has(r.item.id)) && (
                <SelectionEdges w={r.w + 7} d={T + 2} y0={r.z0 - 2} h={r.product.heightIn + 4} z={-T / 2} problem={problemIds.has(r.item.id)} />
              )}
            </group>
          ))}
        </group>
      ))}
    </group>
  );
});

function Casing({ w, h, y0, mat }: { w: number; h: number; y0: number; mat: THREE.Material }) {
  return (
    <group>
      <Box size={[w + 7, 3.5, 0.75]} pos={[0, y0 + h + 1.75, 0.375]} mat={mat} />
      <Box size={[3.5, h, 0.75]} pos={[-(w / 2 + 1.75), y0 + h / 2, 0.375]} mat={mat} />
      <Box size={[3.5, h, 0.75]} pos={[w / 2 + 1.75, y0 + h / 2, 0.375]} mat={mat} />
      <Box size={[w, 0.75, T]} pos={[0, y0 + h - 0.375, -T / 2]} mat={mat} />
      <Box size={[0.75, h, T]} pos={[-(w / 2 - 0.375), y0 + h / 2, -T / 2]} mat={mat} />
      <Box size={[0.75, h, T]} pos={[w / 2 - 0.375, y0 + h / 2, -T / 2]} mat={mat} />
    </group>
  );
}

function WindowModel({ r, surfaces }: { r: Resolved; surfaces: Surfaces }) {
  const { w, product, item } = r;
  const y0 = product.elevationIn;
  const h = product.heightIn;
  const f = resolveFinish(item, product, surfaces);
  const frame = finishMaterial(f);
  const sill = cached('sill', () => new THREE.MeshPhysicalMaterial({ color: '#f1ede6', roughness: 0.3, clearcoat: 0.5 }));
  const bar = 1.75;
  const zc = -T / 2;
  const muntins: [number, number, number, number][] = [];
  if (product.variant === 'casement') muntins.push([0, y0 + h / 2, 1.2, h - bar * 2]);
  else {
    for (const fx of [-1 / 6, 1 / 6]) muntins.push([fx * (w - bar * 2), y0 + h / 2, 0.7, h - bar * 2]);
    muntins.push([0, y0 + h * 0.62, w - bar * 2, 0.7]);
  }
  return (
    <group>
      <Casing w={w} h={h} y0={y0} mat={frame} />
      <Box size={[w + 9, 1.1, 3.8]} pos={[0, y0 - 0.55, 1.1]} mat={sill} />
      <Box size={[w + 5, 3, 0.75]} pos={[0, y0 - 2.6, 0.375]} mat={frame} />
      <Box size={[w, bar, 1.5]} pos={[0, y0 + bar / 2 + 0.75, zc]} mat={frame} />
      <Box size={[w, bar, 1.5]} pos={[0, y0 + h - bar / 2 - 0.75, zc]} mat={frame} />
      <Box size={[bar, h, 1.5]} pos={[-w / 2 + bar / 2 + 0.75, y0 + h / 2, zc]} mat={frame} />
      <Box size={[bar, h, 1.5]} pos={[w / 2 - bar / 2 - 0.75, y0 + h / 2, zc]} mat={frame} />
      {muntins.map(([x, y, mw, mh], i) => (
        <Box key={i} size={[mw, mh, 1.2]} pos={[x, y, zc]} mat={frame} />
      ))}
      <mesh geometry={boxGeo(w - 3, h - 3, 0.15)} position={[0, y0 + h / 2, zc - 0.2]} material={M.clearGlass()} dispose={null} />
      <mesh position={[0, y0 + h / 2, -T - 40]} material={skyMaterial()}>
        <planeGeometry args={[w + 90, h + 70]} />
      </mesh>
    </group>
  );
}

function DoorModel({ r, surfaces, ctx }: { r: Resolved; surfaces: Surfaces; ctx: SceneCtx }) {
  const { w, product, item } = r;
  const h = product.heightIn;
  const f = resolveFinish(item, product, surfaces);
  const frame = finishMaterial(f);
  const v = product.variant;
  const beyond = v === 'double' ? skyMaterial() : cached('hall', () => new THREE.MeshBasicMaterial({ color: '#d9cfc0' }));
  const leafDepth = 1.6;
  const leaves: JSX.Element[] = [];
  if (v === 'single') {
    const sign = item.mirrored ? -1 : 1;
    const lw = w - 1.5;
    leaves.push(
      <group key="l" position={[sign * -(w / 2 - 0.75), 0, 0.2]} rotation={[0, sign * -1.2, 0]}>
        <Front f={{ x: (sign * lw) / 2, y: 0.4, w: lw, h: h - 1.2, pull: null }} z={-leafDepth} finish={f} style="shaker" hw={ctx.hwMat} />
        <mesh position={[sign * (lw - 2.6), 36, 0.3]} material={ctx.hwMat} castShadow>
          <sphereGeometry args={[1.1, 16, 12]} />
        </mesh>
      </group>,
    );
  } else if (v === 'double') {
    for (const sign of [1, -1]) {
      const lw = w / 2 - 1;
      leaves.push(
        <group key={sign} position={[sign * -(w / 2 - 0.75), 0, 0.2]} rotation={[0, sign * -1.0, 0]}>
          <GlazedLeaf sign={sign} lw={lw} h={h - 1.2} mat={frame} />
          <Box size={[0.6, 7, 0.6]} pos={[sign * (lw - 2.2), 38, 0.5]} mat={ctx.hwMat} />
        </group>,
      );
    }
  }
  return (
    <group>
      <Casing w={w} h={h} y0={0} mat={frame} />
      <Box size={[w, 0.5, T]} pos={[0, 0.25, -T / 2]} mat={finishMaterial({ id: 'oak', name: 'oak', hex: '#b88e61', material: 'wood' })} />
      {leaves}
      <mesh position={[0, h / 2 + 6, -T - 44]} material={beyond}>
        <planeGeometry args={[w + 70, h + 40]} />
      </mesh>
    </group>
  );
}

function GlazedLeaf({ sign, lw, h, mat }: { sign: number; lw: number; h: number; mat: THREE.Material }) {
  const x = (sign * lw) / 2;
  const s = 3;
  return (
    <group>
      <Box size={[lw, s, 1.6]} pos={[x, h - s / 2 + 0.4, -0.8]} mat={mat} />
      <Box size={[lw, s * 2.4, 1.6]} pos={[x, s * 1.2 + 0.4, -0.8]} mat={mat} />
      <Box size={[s, h, 1.6]} pos={[x - (lw / 2 - s / 2), h / 2 + 0.4, -0.8]} mat={mat} />
      <Box size={[s, h, 1.6]} pos={[x + (lw / 2 - s / 2), h / 2 + 0.4, -0.8]} mat={mat} />
      {[0.35, 0.6, 0.82].map((t) => (
        <Box key={t} size={[lw - s * 2, 0.8, 1.2]} pos={[x, h * t, -0.8]} mat={mat} />
      ))}
      <Box size={[0.8, h - s * 3.4, 1.2]} pos={[x, h / 2 + s * 0.7, -0.8]} mat={mat} />
      <mesh geometry={boxGeo(lw - s * 2, h - s * 3.4, 0.15)} position={[x, h / 2 + s * 0.7, -0.8]} material={M.clearGlass()} dispose={null} />
    </group>
  );
}
