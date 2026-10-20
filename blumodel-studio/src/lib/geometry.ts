import type { PlacedItem, Product, Room, Rotation } from '../types';
import { getProduct, hasCountertop, isOpening, itemWidth, snapsToWall } from '../data/catalog';
import { EDGE_STYLES, floorOutlines, pointInOutline, wallSegs, type WallSeg } from './outline';

export type { WallSeg } from './outline';

export interface Resolved {
  item: PlacedItem;
  product: Product;
  /** Nominal width (along the item's own x axis) and depth. */
  w: number;
  d: number;
  box: AABB;
  z0: number;
  z1: number;
}

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Wall = 'north' | 'east' | 'south' | 'west';
export const WALLS: Wall[] = ['north', 'east', 'south', 'west'];
export const WALL_ROTATION: Record<Wall, Rotation> = { north: 0, east: 90, south: 180, west: 270 };

export function wallForRotation(r: Rotation): Wall {
  return r === 0 ? 'north' : r === 90 ? 'east' : r === 180 ? 'south' : 'west';
}

/** Unit vector pointing out of the item's front face, in plan coordinates (y grows south). */
export function frontVector(r: Rotation): [number, number] {
  switch (r) {
    case 0:
      return [0, 1];
    case 90:
      return [-1, 0];
    case 180:
      return [0, -1];
    case 270:
      return [1, 0];
  }
}

export function footprint(x: number, y: number, rotation: Rotation, w: number, d: number): AABB {
  const swap = rotation === 90 || rotation === 270;
  const hx = (swap ? d : w) / 2;
  const hy = (swap ? w : d) / 2;
  return { minX: x - hx, maxX: x + hx, minY: y - hy, maxY: y + hy };
}

export function resolve(item: PlacedItem): Resolved | null {
  const product = getProduct(item.productId);
  if (!product) return null;
  const w = itemWidth(item, product);
  const d = product.depthIn;
  return {
    item,
    product,
    w,
    d,
    box: footprint(item.x, item.y, item.rotation, w, d),
    z0: product.elevationIn,
    z1: product.elevationIn + product.heightIn,
  };
}

export function resolveAll(items: PlacedItem[]): Resolved[] {
  const out: Resolved[] = [];
  for (const it of items) {
    const r = resolve(it);
    if (r) out.push(r);
  }
  return out;
}

export function wallLength(wall: Wall, room: Room): number {
  return wall === 'north' || wall === 'south' ? room.widthIn : room.lengthIn;
}

export function segLength(seg: WallSeg): number {
  return seg.a1 - seg.a0;
}

/** True when the wall runs east-west (a north or south wall): its along-axis is x. */
export const segAlongX = (seg: WallSeg): boolean => seg.wall === 'north' || seg.wall === 'south';

/** Distance from a point to the room side of `seg`'s line (negative: behind the wall), and its position along it. */
function segFrame(seg: WallSeg, x: number, y: number): { dn: number; along: number } {
  switch (seg.wall) {
    case 'north':
      return { dn: y - seg.at, along: x };
    case 'south':
      return { dn: seg.at - y, along: x };
    case 'west':
      return { dn: x - seg.at, along: y };
    case 'east':
      return { dn: seg.at - x, along: y };
  }
}

export function overlap1D(a0: number, a1: number, b0: number, b1: number): number {
  return Math.min(a1, b1) - Math.max(a0, b0);
}

export function boxesOverlap(a: AABB, b: AABB, tol = 0.5): boolean {
  return overlap1D(a.minX, a.maxX, b.minX, b.maxX) > tol && overlap1D(a.minY, a.maxY, b.minY, b.maxY) > tol;
}

export function boxGap(a: AABB, b: AABB): number {
  const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
  const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
  return Math.hypot(dx, dy);
}

/** The wall segment the item's back sits flush against, if any. */
export function flushSeg(r: Resolved, room: Room, tol = 1): WallSeg | null {
  const wall = wallForRotation(r.item.rotation);
  const opening = isOpening(r.product);
  const b = r.box;
  for (const seg of wallSegs(room)) {
    if (seg.wall !== wall) continue;
    // Doors and windows only go in full walls; cabinets and appliances also stand against half walls and glass.
    if (opening ? !EDGE_STYLES[seg.style].holdsOpenings : !EDGE_STYLES[seg.style].backs) continue;
    const face = opening
      ? segAlongX(seg) ? r.item.y : r.item.x
      : wall === 'north' ? b.minY : wall === 'south' ? b.maxY : wall === 'west' ? b.minX : b.maxX;
    if (Math.abs(face - seg.at) >= tol) continue;
    const [lo, hi] = opening ? (segAlongX(seg) ? [r.item.x, r.item.x] : [r.item.y, r.item.y]) : alongWall(wall, b);
    // An opening's centre must be on the wall; a cabinet must overlap the run it stands against.
    if (opening ? lo >= seg.a0 - tol && lo <= seg.a1 + tol : overlap1D(lo, hi, seg.a0, seg.a1) > tol) return seg;
  }
  return null;
}

/** Which wall the item's back sits flush against, if any. */
export function flushWall(r: Resolved, room: Room, tol = 1): Wall | null {
  return flushSeg(r, room, tol)?.wall ?? null;
}

/** Every wall segment a footprint sits flush against (a piece in a corner touches two). */
export function segsTouched(b: AABB, room: Room, tol = 1): WallSeg[] {
  const out: WallSeg[] = [];
  for (const seg of wallSegs(room)) {
    if (!EDGE_STYLES[seg.style].backs) continue;
    const face = seg.wall === 'north' ? b.minY : seg.wall === 'south' ? b.maxY : seg.wall === 'west' ? b.minX : b.maxX;
    if (Math.abs(face - seg.at) >= tol) continue;
    const [lo, hi] = segAlongX(seg) ? [b.minX, b.maxX] : [b.minY, b.maxY];
    if (overlap1D(lo, hi, seg.a0, seg.a1) > tol) out.push(seg);
  }
  return out;
}

/** Every wall a footprint sits flush against (a piece in a corner touches two). */
export function wallsTouched(b: AABB, room: Room, tol = 1): Wall[] {
  const out: Wall[] = [];
  for (const seg of segsTouched(b, room, tol)) if (!out.includes(seg.wall)) out.push(seg.wall);
  return out;
}

/** Position along a wall, measured from its west/north end. */
export function alongWall(wall: Wall, box: AABB): [number, number] {
  return wall === 'north' || wall === 'south' ? [box.minX, box.maxX] : [box.minY, box.maxY];
}

export interface SnapResult {
  x: number;
  y: number;
  rotation: Rotation;
  wall: Wall | null;
}

/**
 * Where a dragged item actually landed after snapping: footprint centre in room
 * inches (same convention as `PlacedItem.x/y`), the rotation the snap chose (backs
 * auto-turn to face into the room) and the wall it is flush against, if any.
 */
export type DragResult = SnapResult;

const WALL_SNAP = 16;
const EDGE_SNAP = 6;

/** The wall nearest a point (by distance to the wall's own extent), with the point's frame on it. */
function nearestSeg(room: Room, x: number, y: number, behind = Infinity, usable: (seg: WallSeg) => boolean = () => true): { seg: WallSeg; dn: number; along: number; gap: number } | null {
  let best: { seg: WallSeg; dn: number; along: number; gap: number } | null = null;
  for (const seg of wallSegs(room)) {
    if (!usable(seg)) continue;
    const { dn, along } = segFrame(seg, x, y);
    if (dn < -behind) continue;
    const off = Math.max(seg.a0 - along, 0, along - seg.a1);
    const gap = Math.hypot(off, dn);
    if (!best || gap < best.gap) best = { seg, dn, along, gap };
  }
  return best;
}

/** Is the whole footprint inside one of the plan's rooms? Rectangles take the fast path. */
export function boxInRoom(room: Room, b: AABB, tol = 0.75): boolean {
  if (!room.outline && !room.extra?.length) {
    return b.minX >= -tol && b.minY >= -tol && b.maxX <= room.widthIn + tol && b.maxY <= room.lengthIn + tol;
  }
  const t = tol;
  for (const o of floorOutlines(room)) {
    // All four corners (shrunk by the tolerance) inside, and no corner of the room poking into the box.
    const inner = [
      [b.minX + t, b.minY + t],
      [b.maxX - t, b.minY + t],
      [b.maxX - t, b.maxY - t],
      [b.minX + t, b.maxY - t],
    ];
    if (!inner.every(([px, py]) => pointInOutline(o, px, py))) continue;
    if (o.some(([px, py]) => px > b.minX + t && px < b.maxX - t && py > b.minY + t && py < b.maxY - t)) continue;
    return true;
  }
  return false;
}

/**
 * Keeps a free-standing footprint (an island, a table, a rug) inside the plan. Inside already: untouched.
 * Otherwise the nearest spot that fits, searched outward from where it was dropped.
 */
export function keepInside(room: Room, x: number, y: number, hx: number, hy: number): { x: number; y: number } {
  if (!room.outline && !room.extra?.length) return { x: clamp(x, hx, room.widthIn - hx), y: clamp(y, hy, room.lengthIn - hy) };
  const fits = (px: number, py: number) => boxInRoom(room, { minX: px - hx, maxX: px + hx, minY: py - hy, maxY: py + hy }, 0.1);
  if (fits(x, y)) return { x, y };
  for (let r = 3; r <= 240; r += 3) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let i = 0; i < 24; i++) {
      const ang = (i / 24) * Math.PI * 2;
      const px = x + Math.cos(ang) * r;
      const py = y + Math.sin(ang) * r;
      if (fits(px, py) && (!best || Math.hypot(px - x, py - y) < best.d)) best = { x: px, y: py, d: Math.hypot(px - x, py - y) };
    }
    if (best) return { x: best.x, y: best.y };
  }
  return { x, y };
}

/**
 * Snaps a dragged item the way a kitchen planner expects: backs go flush to the
 * nearest wall (auto-rotating to face into the room), and side edges click
 * against neighbours, corners and the lowers/uppers above or below.
 */
export function snapItem(
  moving: { id: string; x: number; y: number; rotation: Rotation },
  product: Product,
  w: number,
  room: Room,
  others: Resolved[],
): SnapResult {
  const d = product.depthIn;
  const { x, y } = moving;

  if (isOpening(product)) {
    const hit = nearestSeg(room, x, y, Infinity, (sg) => EDGE_STYLES[sg.style].holdsOpenings);
    if (!hit) return { x, y, rotation: moving.rotation, wall: null };
    const { seg } = hit;
    const along = clamp(hit.along, seg.a0 + w / 2, seg.a1 - w / 2);
    const pos = placeOnWall(seg, along, 0);
    return { ...pos, rotation: WALL_ROTATION[seg.wall], wall: seg.wall };
  }

  const free = (): SnapResult => {
    const b = footprint(x, y, moving.rotation, w, d);
    const p = keepInside(room, x, y, (b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2);
    return { ...p, rotation: moving.rotation, wall: null };
  };

  if (!snapsToWall(product)) return free();

  // The wall whose face the back is closest to, among walls the item is in front of.
  let seg: WallSeg | null = null;
  let bestGap = Infinity;
  let alongRaw = 0;
  for (const sg of wallSegs(room)) {
    if (!EDGE_STYLES[sg.style].backs) continue;
    const f = segFrame(sg, x, y);
    if (f.dn < 0 || f.along < sg.a0 - w / 2 || f.along > sg.a1 + w / 2) continue;
    const gap = f.dn - d / 2;
    if (gap < WALL_SNAP && gap < bestGap) {
      bestGap = gap;
      seg = sg;
      alongRaw = f.along;
    }
  }
  if (!seg) return free();

  const wall = seg.wall;
  const rotation = WALL_ROTATION[wall];
  const lo = seg.a0;
  const hi = seg.a1;
  let along = clamp(alongRaw, lo + w / 2, hi - w / 2);

  const z0 = product.elevationIn;
  const z1 = z0 + product.heightIn;
  const band = wallBand(seg, d);
  const leftStops: number[] = [lo];
  const rightStops: number[] = [hi];
  for (const o of others) {
    if (o.item.id === moving.id || isOpening(o.product)) continue;
    if (!boxesOverlap(o.box, band, 0.1)) continue;
    const [o0, o1] = alongWall(wall, o.box);
    const sameLayer = overlap1D(z0, z1, o.z0, o.z1) > 0.25;
    leftStops.push(o1);
    rightStops.push(o0);
    if (!sameLayer) {
      leftStops.push(o0);
      rightStops.push(o1);
    }
  }
  const left = along - w / 2;
  const right = along + w / 2;
  let shift = 0;
  let bestShift = EDGE_SNAP;
  for (const st of leftStops) {
    const delta = st - left;
    if (Math.abs(delta) < Math.abs(bestShift)) bestShift = delta;
  }
  for (const st of rightStops) {
    const delta = st - right;
    if (Math.abs(delta) < Math.abs(bestShift)) bestShift = delta;
  }
  if (Math.abs(bestShift) < EDGE_SNAP) shift = bestShift;
  along = clamp(along + shift, lo + w / 2, hi - w / 2);

  const pos = placeOnWall(seg, along, d / 2);
  return { ...pos, rotation, wall };
}

/** Center point for an item on `seg`, `along` (absolute, in plan inches), with its center `inset` into the room. */
export function placeOnWall(seg: WallSeg | Wall, along: number, inset: number, room?: Room): { x: number; y: number } {
  if (typeof seg === 'string') {
    // The old four-wall form: the longest wall of that side (the only one in a plain rectangle).
    const sg = room && wallSegs(room).filter((q) => q.wall === seg).sort((a, b) => b.a1 - b.a0 - (a.a1 - a.a0))[0];
    if (!sg) return { x: along, y: inset };
    seg = sg;
  }
  switch (seg.wall) {
    case 'north':
      return { x: along, y: seg.at + inset };
    case 'south':
      return { x: along, y: seg.at - inset };
    case 'west':
      return { x: seg.at + inset, y: along };
    case 'east':
      return { x: seg.at - inset, y: along };
  }
}

/** The strip of floor along a wall, `depth` deep (what cabinets on that wall can occupy). */
function wallBand(seg: WallSeg, depth: number): AABB {
  switch (seg.wall) {
    case 'north':
      return { minX: seg.a0, maxX: seg.a1, minY: seg.at, maxY: seg.at + depth };
    case 'south':
      return { minX: seg.a0, maxX: seg.a1, minY: seg.at - depth, maxY: seg.at };
    case 'west':
      return { minX: seg.at, maxX: seg.at + depth, minY: seg.a0, maxY: seg.a1 };
    case 'east':
      return { minX: seg.at - depth, maxX: seg.at, minY: seg.a0, maxY: seg.a1 };
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return (lo + hi) / 2;
  return Math.min(Math.max(v, lo), hi);
}

/** Pairs that physically collide: same floor area and overlapping height. */
export function findOverlaps(all: Resolved[]): [Resolved, Resolved][] {
  const ignore = (r: Resolved) => r.product.kind === 'rug' || r.product.kind === 'stool' || r.product.kind === 'chair';
  const pairs: [Resolved, Resolved][] = [];
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    if (ignore(a)) continue;
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j];
      if (ignore(b)) continue;
      if (!boxesOverlap(a.box, b.box)) continue;
      if (overlap1D(a.z0, a.z1, b.z0, b.z1) <= 0.25) continue;
      pairs.push([a, b]);
    }
  }
  return pairs;
}

export function outsideRoom(r: Resolved, room: Room, tol = 0.75): boolean {
  if (isOpening(r.product)) return false;
  return !boxInRoom(room, r.box, tol);
}

export interface BacksplashSegment {
  wall: Wall;
  /** The wall segment it sits on (an L-shaped room has several walls facing the same way). */
  seg: WallSeg;
  start: number;
  end: number;
  bottom: number;
  top: number;
}

/**
 * Tile runs between counter and uppers, merged per wall. Behind a range the
 * tile climbs to the underside of the hood, which is where it's most visible.
 */
export function backsplashSegments(all: Resolved[], room: Room): BacksplashSegment[] {
  const raw: BacksplashSegment[] = [];
  for (const r of all) {
    const k = r.product.kind;
    // A tub between walls and a shower get a tiled surround on every wall they stand against,
    // from the rim (or the shower base) to 80″ (or the top of the glass).
    if ((k === 'tub' && r.product.variant !== 'freestanding') || k === 'shower') {
      const back = flushSeg(r, room);
      if (!back) continue;
      const bottom = k === 'tub' ? r.z1 : 3;
      const top = Math.min(room.ceilingIn, k === 'tub' ? 80 : r.z1);
      for (const sg of [back, ...segsTouched(r.box, room).filter((q) => q.id !== back.id)]) {
        const [s, e] = alongWall(sg.wall, r.box);
        raw.push({ wall: sg.wall, seg: sg, start: s, end: e, bottom, top });
      }
      continue;
    }
    if (!(hasCountertop(r.product) || k === 'range') || k === 'island') continue;
    const backSeg = flushSeg(r, room);
    if (!backSeg) continue;
    // A corner cabinet's counter meets two walls, so it gets tile on both. Other pieces only
    // get it on their back wall: a base that merely butts a side wall has no counter along it.
    const segs = k === 'corner' ? [backSeg, ...segsTouched(r.box, room).filter((sg) => sg.id !== backSeg.id)] : [backSeg];
    for (const sg of segs) {
      const wall = sg.wall;
      const [s, e] = alongWall(wall, r.box);
      let top = 54;
      let overheadFound = false;
      for (const o of all) {
        if (o === r || o.z0 < 40) continue;
        if (flushSeg(o, room)?.id !== sg.id) continue;
        const [os, oe] = alongWall(wall, o.box);
        if (overlap1D(s, e, os, oe) <= 1) continue;
        if (o.product.kind === 'window') continue;
        if (!overheadFound || o.z0 < top) top = o.z0;
        overheadFound = true;
      }
      if (!overheadFound && k === 'range') top = 66;
      top = Math.min(Math.max(top, 44), room.ceilingIn);
      raw.push({ wall, seg: sg, start: s, end: e, bottom: 36, top });
    }
  }

  const windows = all.filter((r) => r.product.kind === 'window');
  const out: BacksplashSegment[] = [];
  for (const seg of raw) {
    const win = windows.find((wr) => {
      if (flushSeg(wr, room)?.id !== seg.seg.id) return false;
      const [ws, we] = alongWall(seg.wall, wr.box);
      return overlap1D(seg.start, seg.end, ws, we) > 0;
    });
    if (win) {
      const sill = win.z0;
      out.push({ ...seg, top: Math.min(seg.top, sill) });
    } else out.push(seg);
  }
  return out;
}

/**
 * Clear distance from a footprint's face to the nearest wall in `dir`, looking only at walls the
 * footprint actually faces (their run overlaps its span), and the lane (cross coordinate) to draw
 * the dimension along. In a plain rectangle this is the usual distance to the four walls.
 */
export function clearToWall(room: Room, b: AABB, dir: Wall): { gap: number; lane: number } | null {
  const horizontal = dir === 'east' || dir === 'west';
  const [lo, hi] = horizontal ? [b.minY, b.maxY] : [b.minX, b.maxX];
  const mid = (lo + hi) / 2;
  // Looking east we meet an 'east' wall (its inside faces west), and so on.
  let best: { gap: number; lane: number } | null = null;
  for (const seg of wallSegs(room)) {
    if (seg.wall !== dir) continue;
    // Open edges and beams are not in the way of a walkway; a half wall or railing is.
    if (seg.style === 'open' || seg.style === 'beam') continue;
    const face = dir === 'east' ? b.maxX : dir === 'west' ? b.minX : dir === 'south' ? b.maxY : b.minY;
    const gap = dir === 'east' || dir === 'south' ? seg.at - face : face - seg.at;
    if (gap < -0.75) continue;
    const ov = overlap1D(lo, hi, seg.a0, seg.a1);
    if (ov <= 0.5) continue;
    if (!best || gap < best.gap) best = { gap, lane: mid >= seg.a0 && mid <= seg.a1 ? mid : (Math.max(lo, seg.a0) + Math.min(hi, seg.a1)) / 2 };
  }
  return best;
}

const CROWNED = new Set(['wall', 'tall', 'oven-tower']);

/**
 * Which ends of each upper or tall cabinet are open to the room (no neighbour of the same run
 * butting against it), as [left, right] in the cabinet's own frame (left is its -x side: the west
 * end of a cabinet on the north wall). Crown moulding returns only on open ends.
 */
export function openEnds(all: Resolved[]): Map<string, [boolean, boolean]> {
  const out = new Map<string, [boolean, boolean]>();
  const runs = all.filter((r) => CROWNED.has(r.product.kind));
  for (const r of runs) {
    const rot = r.item.rotation;
    const alongX = rot === 0 || rot === 180;
    const [lo, hi] = alongX ? [r.box.minX, r.box.maxX] : [r.box.minY, r.box.maxY];
    const [c0, c1] = alongX ? [r.box.minY, r.box.maxY] : [r.box.minX, r.box.maxX];
    const touches = (edge: number) =>
      runs.some((o) => {
        if (o === r || Math.abs(o.z1 - r.z1) > 1) return false;
        const [olo, ohi] = alongX ? [o.box.minX, o.box.maxX] : [o.box.minY, o.box.maxY];
        const [oc0, oc1] = alongX ? [o.box.minY, o.box.maxY] : [o.box.minX, o.box.maxX];
        if (overlap1D(c0, c1, oc0, oc1) <= 1) return false;
        return Math.abs(olo - edge) < 0.6 || Math.abs(ohi - edge) < 0.6;
      });
    const minEnd = !touches(lo);
    const maxEnd = !touches(hi);
    // The local -x side is the min end facing north or east (rotation 0, 90) and the max end otherwise.
    out.set(r.item.id, rot === 0 || rot === 90 ? [minEnd, maxEnd] : [maxEnd, minEnd]);
  }
  return out;
}
