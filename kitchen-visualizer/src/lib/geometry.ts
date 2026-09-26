import type { PlacedItem, Product, Room, Rotation } from '../types';
import { getProduct, hasCountertop, isOpening, itemWidth, snapsToWall } from '../data/catalog';

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

/** Which wall the item's back sits flush against, if any. */
export function flushWall(r: Resolved, room: Room, tol = 1): Wall | null {
  const wall = wallForRotation(r.item.rotation);
  if (isOpening(r.product)) {
    const onLine =
      (wall === 'north' && Math.abs(r.item.y) < tol) ||
      (wall === 'south' && Math.abs(r.item.y - room.lengthIn) < tol) ||
      (wall === 'west' && Math.abs(r.item.x) < tol) ||
      (wall === 'east' && Math.abs(r.item.x - room.widthIn) < tol);
    return onLine ? wall : null;
  }
  const b = r.box;
  const flush =
    (wall === 'north' && Math.abs(b.minY) < tol) ||
    (wall === 'south' && Math.abs(b.maxY - room.lengthIn) < tol) ||
    (wall === 'west' && Math.abs(b.minX) < tol) ||
    (wall === 'east' && Math.abs(b.maxX - room.widthIn) < tol);
  return flush ? wall : null;
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

const WALL_SNAP = 16;
const EDGE_SNAP = 6;

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
  const W = room.widthIn;
  const L = room.lengthIn;
  const { x, y } = moving;

  const dist: Record<Wall, number> = { north: y, south: L - y, west: x, east: W - x };

  if (isOpening(product)) {
    const wall = WALLS.reduce((best, k) => (dist[k] < dist[best] ? k : best), 'north' as Wall);
    const len = wallLength(wall, room);
    const along = clamp(wall === 'north' || wall === 'south' ? x : y, w / 2, len - w / 2);
    const pos = placeOnWall(wall, along, 0, room);
    return { ...pos, rotation: WALL_ROTATION[wall], wall };
  }

  if (!snapsToWall(product)) {
    const b = footprint(x, y, moving.rotation, w, d);
    const hx = (b.maxX - b.minX) / 2;
    const hy = (b.maxY - b.minY) / 2;
    return { x: clamp(x, hx, W - hx), y: clamp(y, hy, L - hy), rotation: moving.rotation, wall: null };
  }

  let wall: Wall | null = null;
  let bestDist = Infinity;
  for (const k of WALLS) {
    const gap = dist[k] - d / 2;
    if (gap < WALL_SNAP && gap < bestDist) {
      bestDist = gap;
      wall = k;
    }
  }

  if (!wall) {
    const b = footprint(x, y, moving.rotation, w, d);
    const hx = (b.maxX - b.minX) / 2;
    const hy = (b.maxY - b.minY) / 2;
    return { x: clamp(x, hx, W - hx), y: clamp(y, hy, L - hy), rotation: moving.rotation, wall: null };
  }

  const rotation = WALL_ROTATION[wall];
  const len = wallLength(wall, room);
  let along = clamp(wall === 'north' || wall === 'south' ? x : y, w / 2, len - w / 2);

  const z0 = product.elevationIn;
  const z1 = z0 + product.heightIn;
  const band = wallBand(wall, d, room);
  const leftStops: number[] = [0];
  const rightStops: number[] = [len];
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
  for (const s of leftStops) {
    const delta = s - left;
    if (Math.abs(delta) < Math.abs(bestShift)) bestShift = delta;
  }
  for (const s of rightStops) {
    const delta = s - right;
    if (Math.abs(delta) < Math.abs(bestShift)) bestShift = delta;
  }
  if (Math.abs(bestShift) < EDGE_SNAP) shift = bestShift;
  along = clamp(along + shift, w / 2, len - w / 2);

  const pos = placeOnWall(wall, along, d / 2, room);
  return { ...pos, rotation, wall };
}

/** Center point for an item on `wall`, `along` from its start, with its center `inset` into the room. */
export function placeOnWall(wall: Wall, along: number, inset: number, room: Room): { x: number; y: number } {
  switch (wall) {
    case 'north':
      return { x: along, y: inset };
    case 'south':
      return { x: along, y: room.lengthIn - inset };
    case 'west':
      return { x: inset, y: along };
    case 'east':
      return { x: room.widthIn - inset, y: along };
  }
}

function wallBand(wall: Wall, depth: number, room: Room): AABB {
  switch (wall) {
    case 'north':
      return { minX: 0, maxX: room.widthIn, minY: 0, maxY: depth };
    case 'south':
      return { minX: 0, maxX: room.widthIn, minY: room.lengthIn - depth, maxY: room.lengthIn };
    case 'west':
      return { minX: 0, maxX: depth, minY: 0, maxY: room.lengthIn };
    case 'east':
      return { minX: room.widthIn - depth, maxX: room.widthIn, minY: 0, maxY: room.lengthIn };
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
  const b = r.box;
  return b.minX < -tol || b.minY < -tol || b.maxX > room.widthIn + tol || b.maxY > room.lengthIn + tol;
}

export interface BacksplashSegment {
  wall: Wall;
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
    if (!(hasCountertop(r.product) || k === 'range') || k === 'island') continue;
    const wall = flushWall(r, room);
    if (!wall) continue;
    const [s, e] = alongWall(wall, r.box);
    let top = 54;
    let overheadFound = false;
    for (const o of all) {
      if (o === r || o.z0 < 40) continue;
      if (flushWall(o, room) !== wall) continue;
      const [os, oe] = alongWall(wall, o.box);
      if (overlap1D(s, e, os, oe) <= 1) continue;
      if (o.product.kind === 'window') continue;
      if (!overheadFound || o.z0 < top) top = o.z0;
      overheadFound = true;
    }
    if (!overheadFound && k === 'range') top = 66;
    top = Math.min(Math.max(top, 44), room.ceilingIn);
    raw.push({ wall, start: s, end: e, bottom: 36, top });
  }

  const windows = all.filter((r) => r.product.kind === 'window');
  const out: BacksplashSegment[] = [];
  for (const seg of raw) {
    const win = windows.find((wr) => {
      if (flushWall(wr, room) !== seg.wall) return false;
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
