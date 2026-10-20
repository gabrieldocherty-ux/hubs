import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Room, Surfaces } from '../../types';
import { alongWall, backsplashSegments, flushSeg, type Resolved, type WallSeg } from '../../lib/geometry';
import { BEAM_DROP_IN, EDGE_STYLES, floorOutlines, floorRects, floorSpaces, planSize, pointInOutline, wallSegs } from '../../lib/outline';
import { isOpening } from '../../data/catalog';
import { FLOORING, PAINTS, byId } from '../../data/finishes';
import { resolveFinish } from '../../lib/finish';
import { luminance, shade } from '../../lib/color';
import { Box, Front, type SceneCtx } from './parts';
import { M, cached, finishMaterial, skyMaterial, surfaceMaterial } from './materials';
import { boxGeo, worldUVBox } from './geom3d';
import { SelectionEdges } from './SelectionEdges';

const T = 5;

let activeCutaway: ((cameraPos: THREE.Vector3) => boolean) | null = null;

/** Applies the mounted room's wall cut-away for a camera at `cameraPos` (feet). For offscreen renders. */
export function applyCutaway(cameraPos: THREE.Vector3): boolean {
  return activeCutaway ? activeCutaway(cameraPos) : false;
}

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

/**
 * Converts a span along a wall (a0..a1, plan inches along the wall) at a depth (z0..z1, positive into
 * the room, negative inside the wall's thickness) to a world-space box.
 */
function wallBox(seg: WallSeg, a0: number, a1: number, y0: number, y1: number, z0: number, z1: number): { size: [number, number, number]; center: [number, number, number] } {
  const len = a1 - a0;
  const h = y1 - y0;
  const dep = z1 - z0;
  const am = (a0 + a1) / 2;
  const ym = (y0 + y1) / 2;
  const zm = (z0 + z1) / 2;
  switch (seg.wall) {
    case 'north':
      return { size: [len, h, dep], center: [am, ym, seg.at + zm] };
    case 'south':
      return { size: [len, h, dep], center: [am, ym, seg.at - zm] };
    case 'west':
      return { size: [dep, h, len], center: [seg.at + zm, ym, am] };
    case 'east':
      return { size: [dep, h, len], center: [seg.at - zm, ym, am] };
  }
}

interface SegGeo {
  seg: WallSeg;
  walls: THREE.BufferGeometry[];
  base: { size: [number, number, number]; center: [number, number, number] }[];
  caps: { size: [number, number, number]; center: [number, number, number] }[];
  splash: THREE.BufferGeometry[];
  /** Everything that is not paint and plaster: a half wall's cap, a bar ledge, railings, glass. */
  parts: { size: [number, number, number]; center: [number, number, number]; kind: 'counter' | 'steel' | 'glass' | 'trim'; cast: boolean }[];
}

/** Is a wall's inside facing the camera? Walls seen from behind are cut away so the room can be looked into. */
function facesCamera(seg: WallSeg, camX: number, camZ: number): boolean {
  switch (seg.wall) {
    case 'north':
      return camZ > seg.at;
    case 'south':
      return camZ < seg.at;
    case 'west':
      return camX > seg.at;
    case 'east':
      return camX < seg.at;
  }
}

export const Room3D = memo(function Room3D({ room, all, surfaces, ctx, selectedId, problemIds, onSelect, onHover }: Props) {
  const { W, L } = planSize(room);
  const H = room.ceilingIn;
  const floor = byId(FLOORING, surfaces.flooringId);
  const paint = byId(PAINTS, surfaces.paintId);
  const floorMat = surfaceMaterial(`floor:${floor.id}`, floor.pattern, floor.gloss);
  const wallMat = surfaceMaterial(`paint:${paint.id}`, paint.pattern, 0.05);
  const trimHex = luminance(paint.hex) < 0.2 ? shade(paint.hex, 0.05) : '#f3efe6';
  const trimMat = cached(`trim3d:${trimHex}`, () => new THREE.MeshStandardMaterial({ color: trimHex, roughness: 0.45 }));

  const segs = useMemo(() => wallSegs(room), [room]);
  const outlines = useMemo(() => floorOutlines(room), [room]);
  const rects = useMemo(() => outlines.flatMap((o) => floorRects(o)), [outlines]);

  // Each room on its own floor (an added bathroom on tile); the kitchen's floor where a room has none of its own.
  const floorParts = useMemo(
    () =>
      floorSpaces(room).flatMap((sp) => {
        const f = sp.flooringId ? byId(FLOORING, sp.flooringId) : floor;
        const m = surfaceMaterial(`floor:${f.id}`, f.pattern, f.gloss);
        return floorRects(sp.pts).map((r) => ({ mat: m.mat, geo: worldUVBox([r.x1 - r.x0, 0.5, r.y1 - r.y0], [(r.x0 + r.x1) / 2, -0.25, (r.y0 + r.y1) / 2], null, m.tileIn) }));
      }),
    // floorMat follows the kitchen's floor, which rooms without their own use.
    [room, floor, floorMat],
  );
  useEffect(() => () => floorParts.forEach((p) => p.geo.dispose()), [floorParts]);

  // Each opening belongs to the wall it is flush against; it also cuts any wall sharing that line
  // (the partition between two rooms is two coincident walls, one per room).
  const openingsBySeg = useMemo(() => {
    const map = new Map<number, Resolved[]>();
    for (const sg of segs) map.set(sg.id, []);
    for (const r of all) {
      if (!isOpening(r.product)) continue;
      for (const sg of segs) {
        const alongX = sg.wall === 'north' || sg.wall === 'south';
        const line = alongX ? r.item.y : r.item.x;
        const along = alongX ? r.item.x : r.item.y;
        if (Math.abs(line - sg.at) < 1 && along >= sg.a0 - 1 && along <= sg.a1 + 1) map.get(sg.id)!.push(r);
      }
    }
    return map;
  }, [all, segs]);
  // The wall an opening's model is drawn on (once), not every coincident one.
  const ownSeg = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of all) {
      if (!isOpening(r.product)) continue;
      const sg = flushSeg(r, room);
      if (sg) map.set(r.item.id, sg.id);
    }
    return map;
  }, [all, room]);

  // A door, walkway or window with another room behind it shows that room, not a painted backdrop.
  const roomBehind = (r: Resolved): boolean => {
    const sg = flushSeg(r, room);
    if (!sg) return false;
    const d = 8;
    const px = sg.wall === 'west' ? r.item.x - d : sg.wall === 'east' ? r.item.x + d : r.item.x;
    const py = sg.wall === 'north' ? r.item.y - d : sg.wall === 'south' ? r.item.y + d : r.item.y;
    return outlines.some((o) => pointInOutline(o, px, py));
  };

  const splash = useMemo(() => backsplashSegments(all, room), [all, room]);

  const wallGeos = useMemo<SegGeo[]>(() => {
    return segs.map((seg) => {
      const out: SegGeo = { seg, walls: [], base: [], caps: [], splash: [], parts: [] };
      const st = seg.style;
      if (st !== 'wall') {
        // Anything but a full wall stands on its line (centred), not outside it.
        const half = EDGE_STYLES[st].thicknessIn / 2;
        const put = (a0: number, a1: number, y0: number, y1: number, z0: number, z1: number) => wallBox(seg, a0, a1, y0, y1, z0, z1);
        if (st === 'half' || st === 'bar') {
          const h = EDGE_STYLES[st].heightIn!;
          const b = put(seg.a0, seg.a1, 0, h, -half, half);
          out.walls.push(worldUVBox(b.size, b.center, null, wallMat.tileIn));
          out.parts.push({ ...put(seg.a0 - 1, seg.a1 + 1, h, h + 1.5, -half - 1, half + 1), kind: 'trim', cast: true });
          out.base.push(put(seg.a0, seg.a1, 0, 4.5, half, half + 0.6));
          // A bar wall's ledge juts out the far side, over the stools.
          if (st === 'bar') out.parts.push({ ...put(seg.a0 - 1, seg.a1 + 1, h, h + 1.5, -half - 12, -half), kind: 'counter', cast: true });
        } else if (st === 'rail') {
          out.parts.push({ ...put(seg.a0, seg.a1, 34.5, 36, -half, half), kind: 'steel', cast: true });
          const n = Math.max(1, Math.ceil((seg.a1 - seg.a0) / 36));
          for (let i = 0; i <= n; i++) {
            const a = seg.a0 + ((seg.a1 - seg.a0) * i) / n;
            out.parts.push({ ...put(a - 0.75, a + 0.75, 0, 34.5, -0.75, 0.75), kind: 'steel', cast: true });
          }
        } else if (st === 'glass') {
          out.parts.push({ ...put(seg.a0, seg.a1, 1.5, H - 1.5, -half, half), kind: 'glass', cast: false });
          out.parts.push({ ...put(seg.a0, seg.a1, 0, 1.5, -half - 0.5, half + 0.5), kind: 'steel', cast: true });
          out.parts.push({ ...put(seg.a0, seg.a1, H - 1.5, H, -half - 0.5, half + 0.5), kind: 'steel', cast: true });
        } else if (st === 'beam') {
          const b = put(seg.a0, seg.a1, H - BEAM_DROP_IN, H, -5, 5);
          out.walls.push(worldUVBox(b.size, b.center, null, wallMat.tileIn));
        }
        return out;
      }
      const alongX = seg.wall === 'north' || seg.wall === 'south';
      // North and south walls own the corners that stick out, as in the plan, so two walls never overlap there.
      const start = seg.a0 - (alongX && seg.convex0 ? T : 0);
      const end = seg.a1 + (alongX && seg.convex1 ? T : 0);
      const ops = (openingsBySeg.get(seg.id) ?? []).map((r) => {
        const [s, e] = alongWall(seg.wall, r.box);
        return { s, e, z0: r.z0, z1: r.z1 };
      });
      for (const p of wallPieces(start, end, H, ops)) {
        const b = wallBox(seg, p.a0, p.a1, p.y0, p.y1, -T, 0);
        out.walls.push(worldUVBox(b.size, b.center, null, wallMat.tileIn));
        if (p.y0 === 0) {
          const a0 = Math.max(p.a0, seg.a0);
          const a1 = Math.min(p.a1, seg.a1);
          if (a1 - a0 > 0.5) out.base.push(wallBox(seg, a0, a1, 0, 4.5, 0, 0.6));
        }
        if (p.y1 >= H - 0.01) out.caps.push(wallBox(seg, p.a0, p.a1, H, H + 0.6, -T - 0.05, 0.05));
      }
      for (const sp of splash) {
        if (sp.seg.id !== seg.id) continue;
        const b = wallBox(seg, sp.start, sp.end, sp.bottom, sp.top, 0, 0.4);
        out.splash.push(worldUVBox(b.size, b.center, null, ctx.splashTile));
      }
      return out;
    });
  }, [segs, H, openingsBySeg, splash, wallMat.tileIn, ctx.splashTile]);

  useEffect(
    () => () => {
      for (const g of wallGeos) {
        g.walls.forEach((x) => x.dispose());
        g.splash.forEach((x) => x.dispose());
      }
    },
    [wallGeos],
  );

  const groups = useRef<Map<number, THREE.Group>>(new Map());
  // A ceiling for a camera standing in the room (eye level, the showroom's pictures): without it
  // the tops of the walls end in the sky. Seen from above it never shows (it faces down, and it is
  // hidden whenever the camera is outside the room or above it).
  const ceiling = useRef<THREE.Group | null>(null);
  const ceilingMat = cached(`ceiling:${trimHex}`, () => new THREE.MeshStandardMaterial({ color: trimHex, roughness: 0.92 }));
  const gl = useThree((s) => s.gl);
  // The cut-away: walls between the camera and the room hide. Run every frame (cheap) and by the
  // studio render for its own camera. Hiding a wall changes what casts shadows, and the shadow
  // map only updates on demand, so a change marks it dirty.
  const cutaway = useMemo(() => {
    const camLocal = new THREE.Vector3();
    return (cameraPos: THREE.Vector3) => {
      camLocal.copy(cameraPos).multiplyScalar(12);
      let changed = false;
      for (const sg of segs) {
        const grp = groups.current.get(sg.id);
        const v = EDGE_STYLES[sg.style].cutaway ? facesCamera(sg, camLocal.x, camLocal.z) : true;
        if (grp && grp.visible !== v) {
          grp.visible = v;
          changed = true;
        }
      }
      const inside = camLocal.y < H && outlines.some((o) => pointInOutline(o, camLocal.x, camLocal.z));
      if (ceiling.current && ceiling.current.visible !== inside) ceiling.current.visible = inside;
      if (changed) gl.shadowMap.needsUpdate = true;
      return changed;
    };
  }, [segs, outlines, H, gl]);
  useEffect(() => {
    activeCutaway = cutaway;
    return () => {
      if (activeCutaway === cutaway) activeCutaway = null;
    };
  }, [cutaway]);
  useFrame(({ camera }) => {
    cutaway(camera.position);
  });

  return (
    <group>
      <mesh geometry={boxGeo(W + T * 2 + 36, 6, L + T * 2 + 36)} position={[W / 2, -3.5, L / 2]} material={M.plinth()} receiveShadow dispose={null} />
      {floorParts.map((p, i) => (
        <mesh key={i} geometry={p.geo} material={p.mat} receiveShadow />
      ))}
      <group ref={ceiling} visible={false}>
        {rects.map((r, i) => (
          <mesh key={i} position={[(r.x0 + r.x1) / 2, H, (r.y0 + r.y1) / 2]} rotation={[Math.PI / 2, 0, 0]} material={ceilingMat}>
            <planeGeometry args={[r.x1 - r.x0, r.y1 - r.y0]} />
          </mesh>
        ))}
      </group>
      {wallGeos.map((g) => (
        <group
          key={g.seg.id}
          ref={(el) => {
            if (el) groups.current.set(g.seg.id, el);
            else groups.current.delete(g.seg.id);
          }}
        >
          {g.walls.map((geo, i) => (
            <mesh key={i} geometry={geo} material={wallMat.mat} castShadow receiveShadow />
          ))}
          {g.base.map((b, i) => (
            <Box key={`b${i}`} size={b.size} pos={b.center} mat={trimMat} />
          ))}
          {g.caps.map((b, i) => (
            <Box key={`c${i}`} size={b.size} pos={b.center} mat={M.wallCap()} cast={false} />
          ))}
          {g.splash.map((geo, i) => (
            <mesh key={`s${i}`} geometry={geo} material={ctx.splashMat} receiveShadow />
          ))}
          {g.parts.map((pt, i) => (
            <Box key={`p${i}`} size={pt.size} pos={pt.center} mat={pt.kind === 'counter' ? ctx.counterMat : pt.kind === 'steel' ? M.steel() : pt.kind === 'glass' ? M.clearGlass() : trimMat} cast={pt.cast} />
          ))}
          {(openingsBySeg.get(g.seg.id) ?? [])
            .filter((r) => ownSeg.get(r.item.id) === g.seg.id)
            .map((r) => (
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
                {r.product.kind === 'window' ? <WindowModel r={r} surfaces={surfaces} bare={roomBehind(r)} /> : <DoorModel r={r} surfaces={surfaces} ctx={ctx} bare={roomBehind(r)} />}
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

/**
 * A window or door on its own (the product page): `bare` leaves out the view beyond the opening,
 * which only makes sense set into a wall.
 */
export function OpeningModel({ r, surfaces, ctx, bare = false }: { r: Resolved; surfaces: Surfaces; ctx: SceneCtx; bare?: boolean }) {
  return r.product.kind === 'window' ? <WindowModel r={r} surfaces={surfaces} bare={bare} /> : <DoorModel r={r} surfaces={surfaces} ctx={ctx} bare={bare} />;
}

function WindowModel({ r, surfaces, bare = false }: { r: Resolved; surfaces: Surfaces; bare?: boolean }) {
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
      {!bare && (
        // Just behind the wall and the size of the hole (the casing hides the margin). A sky 40 inches
        // back poked above the wall top from the raised overview camera.
        <mesh position={[0, y0 + h / 2, -T - 0.5]} material={skyMaterial()}>
          <planeGeometry args={[w + 2, h + 2]} />
        </mesh>
      )}
    </group>
  );
}

function DoorModel({ r, surfaces, ctx, bare = false }: { r: Resolved; surfaces: Surfaces; ctx: SceneCtx; bare?: boolean }) {
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
      {!bare && (
        <mesh position={[0, h / 2, -T - 0.5]} material={beyond}>
          <planeGeometry args={[w + 2, h + 2]} />
        </mesh>
      )}
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
