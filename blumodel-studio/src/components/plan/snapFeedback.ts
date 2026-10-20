/**
 * What the plan shows while a piece is being dragged: the wall it snapped to, the
 * neighbour edges it lines up with, the clear distance to the nearest neighbour or
 * wall on each side, and where it collides with something. Pure (room inches in,
 * room inches out) so it can be unit-tested; DragFeedback.tsx draws it.
 */
import type { Room } from '../../types';
import { isOpening } from '../../data/catalog';
import { planSize } from '../../lib/outline';
import { alongWall, boxGap, boxesOverlap, clearToWall, flushSeg, overlap1D, type AABB, type Resolved, type Wall, type WallSeg } from '../../lib/geometry';

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Gap extends Seg {
  /** Clear distance in inches. */
  value: number;
  /** What the gap runs to. */
  to: 'wall' | 'item';
}

export interface Feedback {
  /** The wall the piece's back is flush against, if any. */
  wall: Wall | null;
  /** That wall's inner face, for the snap guide. */
  wallLine: Seg | null;
  /** Edges lined up with a neighbour (abutting or aligned), drawn as guide lines. */
  guides: Seg[];
  /** Clear distance to the nearest neighbour or wall on each open side. */
  gaps: Gap[];
  /** Where the piece collides with something, as intersection boxes. */
  overlaps: AABB[];
  overlapIds: string[];
}

const ALIGN_TOL = 0.3;
const GUIDE_REACH = 48;
const MIN_GAP = 0.75;

const seating = (r: Resolved) => r.product.kind === 'stool' || r.product.kind === 'chair';

/** Same exclusions as findOverlaps in lib/geometry: rugs, stools and chairs never "collide". */
function collides(a: Resolved, b: Resolved): boolean {
  const skip = (r: Resolved) => r.product.kind === 'rug' || seating(r);
  if (skip(a) || skip(b)) return false;
  return boxesOverlap(a.box, b.box) && overlap1D(a.z0, a.z1, b.z0, b.z1) > 0.25;
}

/** Things that block the moving piece's sight line: same height band, not rugs; seating only counts for seating. */
function blocks(me: Resolved, o: Resolved): boolean {
  if (o.product.kind === 'rug' || isOpening(o.product)) return false;
  if (seating(o) && !seating(me)) return false;
  return overlap1D(me.z0, me.z1, o.z0, o.z1) > 0.25;
}

/** A wall segment's inner face as a line, for the snap guide. */
export function wallFace(seg: WallSeg): Seg {
  return seg.wall === 'north' || seg.wall === 'south'
    ? { x1: seg.a0, y1: seg.at, x2: seg.a1, y2: seg.at }
    : { x1: seg.at, y1: seg.a0, x2: seg.at, y2: seg.a1 };
}

/**
 * @param me     the piece being dragged, at its current (snapped) position
 * @param all    every piece in the design (me included is fine)
 * @param inset  for openings: how far into the room to draw the along-wall distances
 */
export function dragFeedback(me: Resolved, all: Resolved[], room: Room, inset = 8): Feedback {
  const others = all.filter((o) => o.item.id !== me.item.id);
  const seg = flushSeg(me, room);
  const wall = seg?.wall ?? null;
  const out: Feedback = { wall, wallLine: seg ? wallFace(seg) : null, guides: [], gaps: [], overlaps: [], overlapIds: [] };

  for (const o of others) {
    if (!collides(me, o)) continue;
    const a = me.box;
    const b = o.box;
    out.overlaps.push({ minX: Math.max(a.minX, b.minX), minY: Math.max(a.minY, b.minY), maxX: Math.min(a.maxX, b.maxX), maxY: Math.min(a.maxY, b.maxY) });
    out.overlapIds.push(o.item.id);
  }

  if (isOpening(me.product)) {
    if (!wall || !seg) return out;
    const [s, e] = alongWall(wall, me.box);
    let left = seg.a0;
    let right = seg.a1;
    let leftTo: Gap['to'] = 'wall';
    let rightTo: Gap['to'] = 'wall';
    for (const o of others) {
      if (!isOpening(o.product) || flushSeg(o, room)?.id !== seg.id) continue;
      const [os, oe] = alongWall(wall, o.box);
      if (oe <= s + 0.5 && oe > left) {
        left = oe;
        leftTo = 'item';
      }
      if (os >= e - 0.5 && os < right) {
        right = os;
        rightTo = 'item';
      }
    }
    const at = (a: number): [number, number] =>
      wall === 'north' ? [a, seg.at + inset] : wall === 'south' ? [a, seg.at - inset] : wall === 'west' ? [seg.at + inset, a] : [seg.at - inset, a];
    for (const [a, b, to] of [
      [left, s, leftTo],
      [e, right, rightTo],
    ] as const) {
      if (b - a <= MIN_GAP) continue;
      const [x1, y1] = at(a);
      const [x2, y2] = at(b);
      out.gaps.push({ x1, y1, x2, y2, value: b - a, to });
    }
    return out;
  }

  const m = me.box;
  const { W, L } = planSize(room);

  // Edge guides: any neighbour edge within a hair of one of ours, on either axis.
  const seen = new Set<string>();
  for (const o of others) {
    if (o.product.kind === 'rug' || isOpening(o.product)) continue;
    if (boxGap(m, o.box) > GUIDE_REACH) continue;
    const b = o.box;
    for (const mx of [m.minX, m.maxX]) {
      if (mx < 0.5 || mx > W - 0.5) continue;
      for (const ox of [b.minX, b.maxX]) {
        if (Math.abs(mx - ox) > ALIGN_TOL) continue;
        const key = `x${Math.round(mx * 2)}`;
        const y1 = Math.min(m.minY, b.minY) - 3;
        const y2 = Math.max(m.maxY, b.maxY) + 3;
        if (!seen.has(key)) out.guides.push({ x1: mx, y1, x2: mx, y2 });
        seen.add(key);
      }
    }
    for (const my of [m.minY, m.maxY]) {
      if (my < 0.5 || my > L - 0.5) continue;
      for (const oy of [b.minY, b.maxY]) {
        if (Math.abs(my - oy) > ALIGN_TOL) continue;
        const key = `y${Math.round(my * 2)}`;
        const x1 = Math.min(m.minX, b.minX) - 3;
        const x2 = Math.max(m.maxX, b.maxX) + 3;
        if (!seen.has(key)) out.guides.push({ x1, y1: my, x2, y2: my });
        seen.add(key);
      }
    }
  }

  // Clear distance on each side: nearest blocking neighbour whose span faces ours, else the wall.
  const cx = (m.minX + m.maxX) / 2;
  const cy = (m.minY + m.maxY) / 2;
  type Dir = 'east' | 'west' | 'south' | 'north';
  const dirs: Dir[] = ['west', 'east', 'north', 'south'];
  for (const dir of dirs) {
    const horizontal = dir === 'east' || dir === 'west';
    const toWall = clearToWall(room, m, dir);
    let best = toWall ? toWall.gap : Infinity;
    let to: Gap['to'] = 'wall';
    let lane = toWall ? toWall.lane : horizontal ? cy : cx;
    for (const o of others) {
      if (!blocks(me, o)) continue;
      const b = o.box;
      const facing = horizontal ? overlap1D(m.minY, m.maxY, b.minY, b.maxY) : overlap1D(m.minX, m.maxX, b.minX, b.maxX);
      if (facing <= 0.5) continue;
      const gap = dir === 'east' ? b.minX - m.maxX : dir === 'west' ? m.minX - b.maxX : dir === 'south' ? b.minY - m.maxY : m.minY - b.maxY;
      if (gap < -0.5 || gap >= best) continue;
      best = gap;
      to = 'item';
      lane = horizontal ? (Math.max(m.minY, b.minY) + Math.min(m.maxY, b.maxY)) / 2 : (Math.max(m.minX, b.minX) + Math.min(m.maxX, b.maxX)) / 2;
    }
    if (best <= MIN_GAP || !Number.isFinite(best)) continue;
    const seg: Seg =
      dir === 'east'
        ? { x1: m.maxX, y1: lane, x2: m.maxX + best, y2: lane }
        : dir === 'west'
          ? { x1: m.minX - best, y1: lane, x2: m.minX, y2: lane }
          : dir === 'south'
            ? { x1: lane, y1: m.maxY, x2: lane, y2: m.maxY + best }
            : { x1: lane, y1: m.minY - best, x2: lane, y2: m.minY };
    out.gaps.push({ ...seg, value: best, to });
  }
  return out;
}
